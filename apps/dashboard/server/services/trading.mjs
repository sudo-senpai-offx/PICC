// PICC Trading Suite — signal generation, paper trading, and a read-only
// ExpertOption bridge. No auto-execution: nothing here places a real order.
// Signals are decision support; any live trade must be executed by the human
// (and the paper ledger exists so you can validate a strategy first).

import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"
import { getHistory } from "./yahoo.mjs"
import { predictDirection } from "./prediction.mjs"
import { metricsFrom } from "./analytics.mjs"
import {
  connectSession,
  balanceFrom,
  assetsFrom,
  candlesFrom,
  DEFAULT_WS_URL
} from "./expertoption.mjs"
import { chatText, llmConfigured } from "./llm.mjs"
import { env } from "../config.mjs"
import { news as serperNews } from "./serper.mjs"

const DATA_DIR =
  process.env.PICC_TRADING_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const CREDS_FILE = join(DATA_DIR, "trading-credentials.json")
const LEDGER_FILE = join(DATA_DIR, "trading-ledger.json")
const WATCHLIST_FILE = join(DATA_DIR, "trading-watchlist.json")

try {
  mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* already exists */
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJSON(file, value) {
  try {
    await writeFile(file, JSON.stringify(value, null, 2), "utf8")
    return true
  } catch (err) {
    // ENOENT happens when the data dir was created after import time (tests,
    // or a fresh machine where the parent was never made). Ensure it exists
    // and retry once instead of silently dropping the write.
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(value, null, 2), "utf8")
        return true
      } catch (retryErr) {
        console.warn(`[picc-trading] write failed ${file}:`, retryErr.message)
        return false
      }
    }
    console.warn(`[picc-trading] write failed ${file}:`, err.message)
    return false
  }
}

const DEFAULT_CREDS = {
  expertoptionToken: "",
  expertoptionDemo: true,
  expertoptionWsUrl: DEFAULT_WS_URL,
  paperStartingBalance: 10000,
  riskPerTradePct: 2
}

const DEFAULT_LEDGER = { positions: [], closed: [], signals: [] }

// ---------------------------------------------------------------------
// Credentials (server-side, masked when read by the UI)
// ---------------------------------------------------------------------
export async function getCredentials() {
  const saved = await readJSON(CREDS_FILE, {})
  return { ...DEFAULT_CREDS, ...saved }
}

export async function saveCredentials(patch) {
  const next = { ...(await getCredentials()), ...sanitizePatch(patch) }
  next.paperStartingBalance = Math.max(100, Number(next.paperStartingBalance) || 10000)
  next.riskPerTradePct = Math.min(20, Math.max(1, Number(next.riskPerTradePct) || 2))
  next.expertoptionDemo = patch.expertoptionDemo != null ? Boolean(patch.expertoptionDemo) : next.expertoptionDemo
  await writeJSON(CREDS_FILE, next)
  return getCredentials()
}

function sanitizePatch(patch) {
  const out = {}
  // A blank token means "keep the saved one" — the UI only sends a value when
  // the user pastes a replacement, and never sends back the masked one.
  if (typeof patch.expertoptionToken === "string" && patch.expertoptionToken.trim()) {
    out.expertoptionToken = patch.expertoptionToken.trim()
  }
  if (typeof patch.expertoptionWsUrl === "string" && patch.expertoptionWsUrl.trim()) {
    out.expertoptionWsUrl = patch.expertoptionWsUrl.trim()
  }
  if (patch.paperStartingBalance != null) out.paperStartingBalance = Number(patch.paperStartingBalance)
  if (patch.riskPerTradePct != null) out.riskPerTradePct = Number(patch.riskPerTradePct)
  return out
}

// ---------------------------------------------------------------------
// Paper ledger
// ---------------------------------------------------------------------
async function getLedger() {
  const saved = await readJSON(LEDGER_FILE, {})
  return {
    positions: Array.isArray(saved.positions) ? saved.positions : [],
    closed: Array.isArray(saved.closed) ? saved.closed : [],
    signals: Array.isArray(saved.signals) ? saved.signals : []
  }
}

async function saveLedger(ledger) {
  await writeJSON(LEDGER_FILE, {
    positions: ledger.positions.slice(-200),
    closed: ledger.closed.slice(-500),
    signals: ledger.signals.slice(-200)
  })
}

// The ledger is read-modify-write on a single JSON file. Serialize the
// mutating operations through a promise-chain lock so concurrent requests
// cannot clobber each other's updates.
let ledgerWrite = Promise.resolve()
function withLedgerLock(task) {
  const run = ledgerWrite.then(task, task)
  ledgerWrite = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** Cash balance = starting balance − cash committed to open positions + realized PnL. */
export async function paperOverview() {
  const creds = await getCredentials()
  const ledger = await getLedger()
  const starting = creds.paperStartingBalance
  const committed = ledger.positions.reduce((a, p) => a + p.amount, 0)
  const realized = ledger.closed.reduce((a, c) => a + c.pnl, 0)
  const cash = starting - committed + realized
  const wins = ledger.closed.filter((c) => c.pnl > 0).length
  return {
    starting,
    cash: Math.round(cash * 100) / 100,
    committed: Math.round(committed * 100) / 100,
    realizedPnl: Math.round(realized * 100) / 100,
    openCount: ledger.positions.length,
    closedCount: ledger.closed.length,
    winRate: ledger.closed.length ? Math.round((wins / ledger.closed.length) * 100) : null,
    best: ledger.closed.length ? Math.max(...ledger.closed.map((c) => c.pnl)) : null,
    worst: ledger.closed.length ? Math.min(...ledger.closed.map((c) => c.pnl)) : null
  }
}

export async function paperPositions() {
  const ledger = await getLedger()
  return ledger.positions
}

export async function paperHistory(limit = 50) {
  const ledger = await getLedger()
  return ledger.closed.slice(-limit).reverse()
}

const round2 = (x) => Math.round(x * 100) / 100

/**
 * Full paper analytics: mark open positions to market via Yahoo quotes,
 * auto-close any position whose TP/SL has been hit, then compute the full
 * metrics suite (equity curve, drawdown, profit factor, streaks, monthly,
 * per-symbol) over the closed-trade history.
 */
export async function paperAnalytics() {
  const creds = await getCredentials()
  const starting = creds.paperStartingBalance
  let ledger = await getLedger()

  // Fetch a current quote for every symbol with an open position.
  const symbols = [...new Set(ledger.positions.map((p) => p.symbol))]
  const quotes = {}
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const h = await getHistory(s, "1d")
        quotes[s] = h.lastPrice
      } catch {
        quotes[s] = null
      }
    })
  )

  // 1) Auto-close positions whose TP/SL was tripped at the current quote.
  const autoClosed = []
  for (const p of ledger.positions) {
    const mark = quotes[p.symbol]
    if (mark == null) continue
    const mult = p.side === "down" ? -1 : 1
    let hit = null
    if (p.takeProfit != null && (mult === 1 ? mark >= Number(p.takeProfit) : mark <= Number(p.takeProfit))) {
      hit = { reason: "tp", level: Number(p.takeProfit) }
    } else if (p.stopLoss != null && (mult === 1 ? mark <= Number(p.stopLoss) : mark >= Number(p.stopLoss))) {
      hit = { reason: "sl", level: Number(p.stopLoss) }
    }
    if (hit) {
      const closed = await closePaperTradeLocked({ id: p.id, exit: hit.level, reason: hit.reason, exitSource: "mark" })
      autoClosed.push(closed)
    }
  }

  // 2) Reload (positions may have changed) and mark remaining positions.
  ledger = await getLedger()
  const open = []
  let unrealizedTotal = 0
  for (const p of ledger.positions) {
    const mark = quotes[p.symbol]
    const mult = p.side === "down" ? -1 : 1
    const unrealized = mark ? p.amount * (mark / p.entry - 1) * mult : null
    open.push({ ...p, currentPrice: mark, unrealized: unrealized == null ? null : round2(unrealized) })
    if (unrealized != null) unrealizedTotal += unrealized
  }

  // 3) Metrics over closed trades, oldest -> newest.
  const closedOldestFirst = [...ledger.closed].sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1))
  const metrics = metricsFrom(closedOldestFirst, starting)
  const realized = closedOldestFirst.reduce((a, c) => a + Number(c.pnl), 0)
  const committed = ledger.positions.reduce((a, p) => a + p.amount, 0)
  const cash = starting - committed + realized

  return {
    ok: true,
    overview: {
      starting: round2(starting),
      cash: round2(cash),
      committed: round2(committed),
      realizedPnl: round2(realized),
      unrealizedPnl: round2(unrealizedTotal),
      equity: round2(starting + realized + unrealizedTotal),
      openCount: ledger.positions.length,
      closedCount: ledger.closed.length,
      autoClosed: autoClosed.length
    },
    metrics,
    open,
    autoClosed
  }
}

// ---------------------------------------------------------------------
// Watchlist (symbols you want to track + scan)
// ---------------------------------------------------------------------
export async function getWatchlist() {
  const saved = await readJSON(WATCHLIST_FILE, [])
  return Array.isArray(saved) ? saved : []
}

export async function addToWatchlist(symbol) {
  const sym = String(symbol || "").trim().toUpperCase()
  if (!sym) throw new Error("symbol required")
  const list = await getWatchlist()
  if (!list.includes(sym)) {
    list.push(sym)
    await writeJSON(WATCHLIST_FILE, list)
  }
  return { ok: true, symbols: list }
}

export async function removeFromWatchlist(symbol) {
  const sym = String(symbol || "").trim().toUpperCase()
  const list = (await getWatchlist()).filter((s) => s !== sym)
  await writeJSON(WATCHLIST_FILE, list)
  return { ok: true, symbols: list }
}

/** Live quotes for every watchlist symbol (best-effort per symbol). */
export async function watchlistQuotes() {
  const list = await getWatchlist()
  const out = []
  await Promise.all(
    list.map(async (s) => {
      try {
        const h = await getHistory(s, "1d")
        out.push({
          symbol: h.symbol,
          name: h.name,
          currency: h.currency,
          last: h.lastPrice,
          source: "yahoo"
        })
      } catch (err) {
        out.push({ symbol: s, last: null, source: null, error: err.message })
      }
    })
  )
  return { ok: true, symbols: out }
}

// ---------------------------------------------------------------------
// Market news (Serper) + multi-asset scanner
// ---------------------------------------------------------------------
export async function marketNews({ symbol, query, num = 5 } = {}) {
  if (!env.serperApiKey) throw new Error("Serper not configured — set SERPER_API_KEY in the server env")
  const q = String(query || (symbol ? `${symbol} finance` : "financial markets today")).trim()
  if (!q) throw new Error("query required")
  const items = await serperNews(q, num)
  return { ok: true, query: q, source: "serper", items }
}

/**
 * Run the prediction engine across a set of symbols (defaults to the
 * watchlist) and rank the results by confidence. Pure decision support.
 */
export async function scanSymbols({ symbols, horizonDays = 3 } = {}) {
  const list = (Array.isArray(symbols) && symbols.length ? symbols : await getWatchlist()).map((s) =>
    String(s).trim().toUpperCase()
  )
  if (!list.length) throw new Error("no symbols to scan — pass symbols or add to the watchlist first")
  const results = await Promise.all(
    list.map(async (s) => {
      try {
        const p = await predictSymbol(s, horizonDays)
        return {
          ok: true,
          symbol: p.symbol,
          name: p.name,
          currency: p.currency,
          last: p.last,
          direction: p.direction,
          confidence: p.confidence,
          strength: p.strength,
          hitRate: p.hitRate,
          horizonDays: p.horizonDays,
          sampleSize: p.sampleSize,
          note: p.note
        }
      } catch (err) {
        return { ok: false, symbol: s, error: err.message }
      }
    })
  )
  const signals = results.filter((r) => r.ok).sort((a, b) => b.confidence - a.confidence)
  return {
    ok: true,
    horizonDays,
    scanned: results.length,
    signals,
    errors: results.filter((r) => !r.ok)
  }
}

export function openPaperTrade(input) {
  return withLedgerLock(() => openPaperTradeLocked(input))
}

async function openPaperTradeLocked({ symbol, side, entry, amount, takeProfit, stopLoss }) {
  const creds = await getCredentials()
  const ledger = await getLedger()
  const symbolName = String(symbol || "UNKNOWN").toUpperCase()
  const sideName = side === "down" ? "down" : "up"
  const entryPrice = Number(entry)
  const tradeAmount = Number(amount)
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new Error("entry price required")
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) throw new Error("amount required")

  // Stop-loss/take-profit levels are plain price levels on the position. For an
  // "up" position SL sits below entry and TP above; the reverse for "down".
  const mult = sideName === "down" ? -1 : 1
  const tp = takeProfit != null && takeProfit !== "" ? Number(takeProfit) : null
  const sl = stopLoss != null && stopLoss !== "" ? Number(stopLoss) : null
  if (tp != null) {
    if (!Number.isFinite(tp) || tp <= 0) throw new Error("take-profit must be a valid price")
    if (mult === 1 ? tp <= entryPrice : tp >= entryPrice) {
      throw new Error("take-profit must sit beyond the entry price for this direction")
    }
  }
  if (sl != null) {
    if (!Number.isFinite(sl) || sl <= 0) throw new Error("stop-loss must be a valid price")
    if (mult === 1 ? sl >= entryPrice : sl <= entryPrice) {
      throw new Error("stop-loss must sit beyond the entry price for this direction")
    }
  }

  const maxRisk = Math.round((creds.paperStartingBalance * creds.riskPerTradePct) / 100)
  if (tradeAmount > maxRisk) {
    throw new Error(`amount $${tradeAmount} exceeds ${creds.riskPerTradePct}% risk cap ($${maxRisk})`)
  }

  const { cash } = await paperOverview()
  if (tradeAmount > cash) throw new Error(`insufficient paper cash (available $${cash.toFixed(2)})`)

  const position = {
    id: randomBytes(6).toString("hex"),
    symbol: symbolName,
    side: sideName,
    entry: Math.round(entryPrice * 1e6) / 1e6,
    amount: Math.round(tradeAmount * 100) / 100,
    takeProfit: tp == null ? null : Math.round(tp * 1e6) / 1e6,
    stopLoss: sl == null ? null : Math.round(sl * 1e6) / 1e6,
    openedAt: new Date().toISOString(),
    status: "open"
  }
  ledger.positions.push(position)
  await saveLedger(ledger)
  return position
}

export function closePaperTrade(input) {
  return withLedgerLock(() => closePaperTradeLocked(input))
}

async function closePaperTradeLocked({ id, exit, reason = "manual", exitSource = "manual" }) {
  const ledger = await getLedger()
  const idx = ledger.positions.findIndex((p) => p.id === id && p.status === "open")
  if (idx < 0) throw new Error("open position not found")
  const exitPrice = Number(exit)
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) throw new Error("exit price required")

  const p = ledger.positions[idx]
  const mult = p.side === "down" ? -1 : 1
  const pnl = Math.round(p.amount * (exitPrice / p.entry - 1) * mult * 100) / 100
  const closed = {
    ...p,
    status: "closed",
    exit: Math.round(exitPrice * 1e6) / 1e6,
    pnl,
    reason,
    exitSource,
    closedAt: new Date().toISOString(),
    holdingMs: Date.now() - new Date(p.openedAt).getTime()
  }
  ledger.positions.splice(idx, 1)
  ledger.closed.push(closed)
  await saveLedger(ledger)
  return closed
}

/**
 * Check whether the current price has tripped a position's take-profit or
 * stop-loss and close it at the trip level if so. Returns null when nothing
 * trips OR the position no longer exists (already closed) — safe for polling.
 */
export function checkPaperExit(input) {
  return withLedgerLock(() => checkPaperExitLocked(input))
}

async function checkPaperExitLocked({ id, price }) {
  const ledger = await getLedger()
  const idx = ledger.positions.findIndex((p) => p.id === id && p.status === "open")
  if (idx < 0) return null
  const p = ledger.positions[idx]
  const mark = Number(price)
  if (!Number.isFinite(mark) || mark <= 0) throw new Error("price required")
  const mult = p.side === "down" ? -1 : 1

  let hit = null
  if (p.takeProfit != null && (mult === 1 ? mark >= Number(p.takeProfit) : mark <= Number(p.takeProfit))) {
    hit = { reason: "tp", level: Number(p.takeProfit) }
  } else if (p.stopLoss != null && (mult === 1 ? mark <= Number(p.stopLoss) : mark >= Number(p.stopLoss))) {
    hit = { reason: "sl", level: Number(p.stopLoss) }
  }
  if (!hit) return null
  return closePaperTradeLocked({ id, exit: hit.level, reason: hit.reason, exitSource: "price-check" })
}

export function recordSignal(signal) {
  return withLedgerLock(() => recordSignalLocked(signal))
}

async function recordSignalLocked(signal) {
  const ledger = await getLedger()
  const entry = {
    id: randomBytes(6).toString("hex"),
    createdAt: new Date().toISOString(),
    ...signal
  }
  ledger.signals.push(entry)
  await saveLedger(ledger)
  return entry
}

export async function recentSignals(limit = 20) {
  const ledger = await getLedger()
  return ledger.signals.slice(-limit).reverse()
}

export function resolveSignal(input) {
  return withLedgerLock(() => resolveSignalLocked(input))
}

/**
 * Resolve a pending signal against a realized outcome price. The prediction
 * engine says "up" or "down" from an entry price; when the observed price moves
 * with the forecast it is a win, against it a loss, and unchanged a draw.
 */
async function resolveSignalLocked({ id, resultPrice, resolvedAt }) {
  const ledger = await getLedger()
  const idx = ledger.signals.findIndex((s) => s.id === id && s.status !== "resolved")
  if (idx < 0) throw new Error("pending signal not found")
  const s = ledger.signals[idx]
  const price = Number(resultPrice)
  if (!Number.isFinite(price) || price <= 0) throw new Error("result price required")
  const entry = Number(s.entry)
  if (!Number.isFinite(entry) || entry <= 0) throw new Error("signal has no entry price — cannot resolve")

  const diff = price - entry
  let resolution = "draw"
  if (Math.abs(diff) > 1e-9) {
    resolution = s.direction === "up" ? (diff > 0 ? "win" : "loss") : diff > 0 ? "loss" : "win"
  }
  const resolved = {
    ...s,
    status: "resolved",
    resolution,
    outcomePct: Math.round((diff / entry) * 10000) / 100,
    resultPrice: Math.round(price * 1e6) / 1e6,
    resolvedAt: resolvedAt || new Date().toISOString()
  }
  ledger.signals[idx] = resolved
  await saveLedger(ledger)
  return resolved
}

/**
 * Accuracy report over resolved signals: overall win rate plus breakdowns by
 * direction, symbol and horizon, so a strategy's edge (or lack of one) is
 * visible instead of buried in a raw signal list.
 */
export async function signalAccuracy() {
  const ledger = await getLedger()
  const resolved = ledger.signals.filter((s) => s.status === "resolved")
  const total = resolved.length
  const wins = resolved.filter((s) => s.resolution === "win").length
  const losses = resolved.filter((s) => s.resolution === "loss").length
  const draws = resolved.filter((s) => s.resolution === "draw").length
  const winRate = total ? Math.round((wins / total) * 100) : null

  const bucket = (acc, key, s) => {
    const k = String(key)
    if (!acc[k]) acc[k] = { key: k, total: 0, wins: 0, losses: 0, draws: 0 }
    acc[k].total += 1
    if (s.resolution === "win") acc[k].wins += 1
    else if (s.resolution === "loss") acc[k].losses += 1
    else acc[k].draws += 1
  }
  const byDirection = {}
  const bySymbol = {}
  const byHorizon = {}
  for (const s of resolved) {
    bucket(byDirection, s.direction, s)
    bucket(bySymbol, s.symbol || "UNKNOWN", s)
    bucket(byHorizon, String(s.horizonDays ?? "?"), s)
  }
  const finalize = (map) =>
    Object.values(map)
      .map((b) => ({ ...b, winRate: b.total ? Math.round((b.wins / b.total) * 100) : null }))
      .sort((a, b) => b.total - a.total || b.winRate - a.winRate)

  return {
    ok: true,
    total,
    wins,
    losses,
    draws,
    winRate,
    byDirection: finalize(byDirection),
    bySymbol: finalize(bySymbol).slice(0, 20),
    byHorizon: finalize(byHorizon),
    recent: resolved.slice(-20).reverse()
  }
}

/** Test hook — wipe ledger, credentials and watchlist back to defaults. */
export async function _resetTradingData() {
  await writeJSON(CREDS_FILE, { ...DEFAULT_CREDS })
  await writeJSON(LEDGER_FILE, { ...DEFAULT_LEDGER })
  await writeJSON(WATCHLIST_FILE, [])
}

// ---------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------
export async function tradingStatus() {
  const creds = await getCredentials()
  const overview = await paperOverview()
  return {
    ok: true,
    mode: "paper",
    updatedAt: new Date().toISOString(),
    riskPerTradePct: creds.riskPerTradePct,
    expertOption: {
      configured: Boolean(creds.expertoptionToken),
      demo: creds.expertoptionDemo,
      wsUrl: creds.expertoptionWsUrl
    },
    paper: overview
  }
}

// ---------------------------------------------------------------------
// Prediction (works for any symbol via Yahoo, or ExpertOption candles)
// ---------------------------------------------------------------------
export async function predictSymbol(symbol, horizonDays = 3) {
  const sym = String(symbol || "").trim().toUpperCase()
  if (!sym) throw new Error("symbol required")
  const history = await getHistory(sym, "2y")
  const result = predictDirection(history.closes, horizonDays)
  if (!result.ok) throw new Error(result.error)
  return {
    symbol: history.symbol,
    name: history.name,
    currency: history.currency,
    last: history.lastPrice,
    ...result
  }
}

/**
 * Read-only ExpertOption analysis: connect, pull candles for one asset,
 * run the prediction engine, and attach account balance + asset metadata.
 * Never places an order.
 */
export async function analyzeExpertOptionAsset({ assetId, timeframe = 60, count = 120, horizonDays = 3 }) {
  const creds = await getCredentials()
  if (!creds.expertoptionToken) {
    throw new Error("ExpertOption not configured — add your session token in the Trading Suite settings first")
  }

  const session = await connectSession({
    token: creds.expertoptionToken,
    isDemo: creds.expertoptionDemo,
    wsUrl: creds.expertoptionWsUrl
  })

  try {
    const [profile, candles, balance] = await Promise.allSettled([
      session.assets(),
      session.candles(assetId, timeframe, count),
      session.balance()
    ])

    const balanceData =
      balance.status === "fulfilled" ? balanceFrom(balance.value) : { balance: null, currency: null, demo: null }

    let asset = null
    if (profile.status === "fulfilled") {
      const found = assetsFrom(profile.value).find((a) => a.id === String(assetId))
      asset = found ?? null
    }

    if (candles.status !== "fulfilled") {
      throw new Error(`candle history failed: ${candles.reason?.message ?? "unknown"}`)
    }
    const { closes } = candlesFrom(candles.value)
    if (closes.length < 30) throw new Error("not enough candles from ExpertOption yet — try a longer timeframe")

    const prediction = predictDirection(closes, horizonDays)
    return {
      ok: true,
      platform: "ExpertOption",
      asset: asset ?? { id: String(assetId), name: String(assetId) },
      timeframe,
      account: balanceData,
      candles: closes.length,
      ...prediction,
      advisory:
        "Read-only analysis. No order was placed. If you choose to trade, use the paper ledger first and only then the platform UI yourself."
    }
  } finally {
    session.close()
  }
}

// ---------------------------------------------------------------------
// LLM trading assistant (decision support only)
// ---------------------------------------------------------------------
export async function tradingAssist(question = "", context = {}) {
  const q = String(question || "").trim()
  if (!q) throw new Error("question required")

  const system =
    "You are PICC's trading assistant. You give honest, risk-aware decision support only. " +
    "You never claim guaranteed profits, never encourage reckless leverage, and always remind that " +
    "short-term binary options have negative expected value for most retail traders. Keep answers under 180 words, use plain text."

  const contextLine = context && Object.keys(context).length
    ? `\nCurrent dashboard context:\n${JSON.stringify(context, null, 2)}`
    : ""

  if (!llmConfigured()) {
    return {
      ok: true,
      source: "local",
      advice:
        "No LLM provider is configured, so here is the built-in guidance:\n\n" +
        "1. Binary options are high-risk, short-dated bets with a house edge; most retail traders lose.\n" +
        "2. Never risk money you cannot afford to lose; cap each trade at 1-2% of your balance.\n" +
        "3. Use the paper ledger to validate any strategy for at least 50 trades before going live.\n" +
        "4. The prediction engine reports honest, backtested confidence — treat anything under ~60% as a coin flip.\n" +
        "5. Connect an LLM key (Settings -> Agents) for tailored answers to your specific question."
    }
  }

  try {
    const advice = await chatText(system, q + contextLine)
    return { ok: true, source: "llm", advice }
  } catch (err) {
    return { ok: true, source: "local", advice: `LLM unavailable (${err.message}). Rule of thumb: 1-2% risk per trade, paper-trade first, and expect most short-dated options to expire worthless.` }
  }
}
