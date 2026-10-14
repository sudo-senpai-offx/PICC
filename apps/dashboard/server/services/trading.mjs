// PICC Trading Suite — signal generation and paper trading. No auto-execution:
// nothing here places a real order. Signals are decision support; any live trade
// must be executed by the human (and the paper ledger exists so you can validate
// a strategy first).
//
// D2/AC-005 removed the read-only ExpertOption bridge along with the venue, so
// the `connectSession`/`balanceFrom`/`assetsFrom`/`candlesFrom` import from
// expertoption.mjs is gone and `analyzeExpertOptionAsset` is deleted below.
// The paper ledger, the credential store and the prediction surface are
// unchanged.

import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"
import { getHistory } from "./yahoo.mjs"
import { predictDirection } from "./prediction.mjs"
import { metricsFrom } from "./analytics.mjs"
import { chatSignalText, llmConfigured } from "./llm.mjs"
import { env } from "../config.mjs"
import { news as serperNews } from "./serper.mjs"
import { kellySnapshot } from "./kellyCriterion.mjs"
import { atr as computeAtr, adx as computeAdx } from "./indicators.mjs"

const DATA_DIR =
  process.env.PICC_TRADING_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const CREDS_FILE = join(DATA_DIR, "trading-credentials.json")
// T11 — headless-captured tokens for non-EO venues (storage-scan capture).
// Deliberately a SEPARATE file from trading-credentials.json: handlers spread
// the entire getCredentials() object into API responses (handlers.mjs:1305),
// so a venueTokens map riding on the creds file would leak raw tokens to the
// UI. This file is read only by the capture runner's before/after compare.
const VENUE_TOKENS_FILE = join(DATA_DIR, "trading-venue-tokens.json")
const LEDGER_FILE = join(DATA_DIR, "trading-ledger.json")
const WATCHLIST_FILE = join(DATA_DIR, "trading-watchlist.json")

try {
  mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* already exists */
}

// trading-credentials.json (EO live-session token) and
// trading-venue-tokens.json (captured venue session tokens) are REAL secrets
// and go through the at-rest vault; ledger/watchlist stay plain JSON.
const SECRET_FILES = new Set([CREDS_FILE, VENUE_TOKENS_FILE])

async function readJSON(file, fallback) {
  if (SECRET_FILES.has(file)) {
    return (await import("./vault.mjs")).readSecretJson(file, fallback)
  }
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJSON(file, value) {
  if (SECRET_FILES.has(file)) {
    try {
      await (await import("./vault.mjs")).writeSecretJson(file, value)
      return true
    } catch (err) {
      console.warn(`[picc-trading] vault write failed ${file}:`, err.message)
      return false
    }
  }
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
  // D2/AC-005: the three expertoption* credential fields are removed with the
  // venue. A credentials file written before this change may still carry them on
  // disk; they are simply no longer read, defaulted, or written back, so a stale
  // key is inert rather than resurrected. It is NOT migrated or deleted from
  // existing files — that is a separate local-data cleanup, and silently
  // rewriting a user's credential store is not this task's authority.
  paperStartingBalance: 10000,
  riskPerTradePct: 2,
  // Phase 9 — read-only multi-exchange market data (CCXT). Each entry:
  // { exchange: "binance", symbol: "BTC/USDT", timeframe?: "1m", limit?: 200 }
  ccxtExchanges: []
}

const DEFAULT_LEDGER = { positions: [], closed: [], signals: [] }

const SYMBOL_NAME_TO_BASE = {
  BITCOIN: "BTC",
  ETHEREUM: "ETH",
  LITECOIN: "LTC",
  SOLANA: "SOL",
  DOGECOIN: "DOGE",
  CARDANO: "ADA",
  RIPPLE: "XRP",
  GOLD: "XAU",
  SILVER: "XAG"
}

export function translateSymbol(raw, targetPlatform = "") {
  const cleaned = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\(OTC\)/g, "")
    .replace(/-OTC\b/g, "")
    .replace(/[^A-Z0-9]/g, "")
  if (!cleaned || /^\d+$/.test(cleaned)) return null
  let base = null
  let quote = "USD"
  for (const q of ["USDT", "USD"]) {
    if (cleaned.endsWith(q) && cleaned.length > q.length) {
      base = cleaned.slice(0, cleaned.length - q.length)
      quote = q
      break
    }
  }
  if (!base) {
    base = SYMBOL_NAME_TO_BASE[cleaned] ?? cleaned
  } else if (!SYMBOL_NAME_TO_BASE[base]) {
    // Quote-suffix slice bypassed the name map — "BITCOINUSDT" would become
    // the invalid ticker "BITCOIN". Fall back to the name map on the base.
    base = SYMBOL_NAME_TO_BASE[base] ?? base
  }
  const platform = String(targetPlatform ?? "").toLowerCase()
  if (platform === "binance") return `${base}USDT`
  if (platform === "coinbase") return `${base}-USD`
  if (platform === "yahoo") return `${base}-${quote}`
  return `${base}${quote}`
}

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
  await writeJSON(CREDS_FILE, next)
  return getCredentials()
}

function sanitizePatch(patch) {
  const out = {}
  // D2/AC-005: the expertoptionToken / expertoptionWsUrl / expertoptionDemo
  // branches are removed with the venue. A caller still sending them is ignored
  // rather than stored, so the venue's credentials can no longer be re-persisted
  // by any surviving caller.
  if (patch.paperStartingBalance != null) out.paperStartingBalance = Number(patch.paperStartingBalance)
  if (patch.riskPerTradePct != null) out.riskPerTradePct = Number(patch.riskPerTradePct)
  // CCXT pairs: keep only well-formed entries — the scheduler treats a
  // malformed one as "skip this pair", not "crash the poll".
  if (patch.ccxtExchanges != null) {
    out.ccxtExchanges = Array.isArray(patch.ccxtExchanges)
      ? patch.ccxtExchanges
          .slice(0, 12)
          .filter((p) => p && typeof p === "object" && String(p.exchange ?? "").trim() && String(p.symbol ?? "").trim())
          .map((p) => ({
            exchange: String(p.exchange).trim().toLowerCase(),
            symbol: String(p.symbol).trim(),
            ...(p.timeframe ? { timeframe: String(p.timeframe).trim() } : {}),
            ...(p.limit != null ? { limit: Math.max(1, Math.min(Number(p.limit) || 200, 1000)) } : {})
          }))
      : []
  }
  return out
}

// ---------------------------------------------------------------------
// Per-venue headless tokens (T11 storage-scan capture)
// ---------------------------------------------------------------------
// Saved by browserStudio.captureViaStorageScan into VENUE_TOKENS_FILE (NOT the
// creds file — see the file split note above). Before/after comparison happens
// here: captureVenue reads getVenueToken before and after the hook, so a
// token that did not change never triggers a reconnect.
export async function getVenueToken(venueId) {
  const saved = await readJSON(VENUE_TOKENS_FILE, {})
  const map = saved?.venueTokens ?? {}
  const t = map[String(venueId || "").toLowerCase()]
  return typeof t === "string" && t ? t : null
}

export async function saveVenueToken(venueId, token) {
  const t = String(token ?? "").trim()
  if (!t) return null // a blank token never overwrites a saved one
  const saved = await readJSON(VENUE_TOKENS_FILE, {})
  const venueTokens = { ...(saved.venueTokens ?? {}), [String(venueId).toLowerCase()]: t }
  await writeJSON(VENUE_TOKENS_FILE, { ...saved, venueTokens })
  return getVenueToken(venueId)
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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round2 = (x) => Math.round(x * 100) / 100

// Wave 0 Task 3 — the Copilot `finiteOrNull` vocabulary (copilot/vetoes/
// outcome.mjs, ccxtConnector.mjs:235), mirrored here rather than reinvented:
// a finite number, or null. Absent legs stay null; genuine 0 stays 0.
const finiteOrNull = (v) => {
  if (v == null) return null // absent (null/undefined) is never coerced to 0
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Compute adaptive SL/TP from volatility regime. Uses ATR (Average True Range)
 * to set dynamic stop-loss and take-profit levels based on the current market
 * volatility, regime, and direction.
 *
 * Regime-adaptive multipliers:
 *   - Trending:   wider TP (2.5× ATR), tighter SL (1.2× ATR) — ride the wave
 *   - Ranging:    tight TP (1.5× ATR), wider SL (1.8× ATR) — mean reversion
 *   - Volatile:   wide TP (2.0× ATR), wide SL (2.0× ATR) — accommodate noise
 *   - Breakout:   target previous high/low, SL at ATR midpoint
 *
 * @param {Array} candles - OHLC candles [{time, open, high, low, close}]
 * @param {"up"|"down"} direction - trade direction
 * @param {Object} opts - { atrPeriod, regime, tpMult, slMult }
 * @returns {{ takeProfit: number|null, stopLoss: number|null, atr: number|null, adx: number|null, regime: string, reason: string|null }}
 *   `reason` names the absence whenever a null is returned (unobserved ADX →
 *   regime "unknown", never a neutral default); null when everything observed.
 */
export function computeAdaptiveStops(candles, direction, opts = {}) {
  if (!Array.isArray(candles) || candles.length < 20 || !direction) {
    return {
      takeProfit: null,
      stopLoss: null,
      atr: null,
      adx: null,
      regime: "unknown",
      reason: "insufficient-candles: computeAdaptiveStops needs ≥20 candles; no regime is claimed"
    }
  }
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const atrPeriod = opts.atrPeriod || 14
  const atrValues = computeAtr(highs, lows, closes, atrPeriod)
  const currentAtr = atrValues[atrValues.length - 1]
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) {
    return {
      takeProfit: null,
      stopLoss: null,
      atr: null,
      adx: null,
      regime: "unknown",
      reason: "atr-unobservable: no measurable ATR on these candles; no stops or regime are claimed"
    }
  }

  // Detect regime for multiplier selection. An ADX that has not warmed up is
  // null — never forced to 0, because 0 would read as "ranging" and an
  // unobserved read never counts as a neutral vote (regimeEngine.mjs:10).
  const adxValues = computeAdx(highs, lows, closes, atrPeriod)
  const currentAdx = finiteOrNull(adxValues.adx[adxValues.adx.length - 1])
  const avgAtr = atrValues.filter((v) => v != null).reduce((s, v) => s + v, 0) / atrValues.filter((v) => v != null).length || currentAtr
  const atrRatio = avgAtr > 0 ? currentAtr / avgAtr : 1

  if (currentAdx == null) {
    return {
      takeProfit: null,
      stopLoss: null,
      atr: currentAtr,
      adx: null,
      regime: "unknown",
      atrRatio,
      reason: "adx-unobservable: ADX has not warmed up on these candles, so no trend regime is claimed (unobserved never counts as neutral)"
    }
  }

  let regime = "ranging"
  if (currentAdx > 25 && atrRatio > 1.3) regime = "volatile_trend"
  else if (currentAdx > 25) regime = "trending"
  else if (atrRatio > 1.5) regime = "volatile"

  // Regime-adaptive multipliers (research-backed: trending = wider TP, tighter SL)
  const multipliers = {
    trending:        { tp: 2.5, sl: 1.2 },
    volatile_trend:  { tp: 3.0, sl: 1.5 },
    volatile:        { tp: 2.0, sl: 1.8 },
    ranging:         { tp: 1.8, sl: 1.5 },
    unknown:         { tp: 2.0, sl: 1.5 }
  }
  const m = multipliers[regime]
  const tpMult = opts.tpMult || m.tp
  const slMult = opts.slMult || m.sl

  const last = closes[closes.length - 1]
  const isUp = direction === "up"
  const takeProfit = isUp
    ? Math.round((last + currentAtr * tpMult) * 1e6) / 1e6
    : Math.round((last - currentAtr * tpMult) * 1e6) / 1e6
  const stopLoss = isUp
    ? Math.round((last - currentAtr * slMult) * 1e6) / 1e6
    : Math.round((last + currentAtr * slMult) * 1e6) / 1e6

  return { takeProfit, stopLoss, atr: currentAtr, regime, adx: currentAdx, atrRatio, reason: null, multipliers: { tp: tpMult, sl: slMult } }
}

/**
 * Wave 0 Task 3 — honest candle synthesis from a Yahoo history frame.
 * Every OHLC leg goes through `finiteOrNull`: a null/undefined/NaN/"junk"
 * leg drops the whole row (an unparseable leg is never a 0-filled candle).
 * The pre-existing `close > 0` filter semantic stays — a non-positive close
 * is dropped, while a genuine parseable 0 elsewhere is kept.
 * Returns the usable candles (possibly []); the caller maps [] to null.
 */
export function synthesizeCandles(history) {
  if (!history || !Array.isArray(history.dates)) return []
  const n = history.dates.length
  const out = []
  for (let i = 0; i < n; i++) {
    const open = finiteOrNull(history.opens?.[i])
    const high = finiteOrNull(history.highs?.[i])
    const low = finiteOrNull(history.lows?.[i])
    const close = finiteOrNull(history.closes?.[i])
    if (open == null || high == null || low == null || close == null) continue
    if (!(close > 0)) continue
    out.push({ time: Math.floor(history.dates[i] / 1000), open, high, low, close })
  }
  return out
}

/**
 * Compute adaptive stops for a symbol by fetching its recent candle data.
 * Tries liveEO first (for EO assets), falls back to Yahoo Finance history.
 */
async function computeAdaptiveStopsFromSymbol(symbol, timeframe = 60) {
  try {
    const { getBrokerData } = await import("./brokers/index.mjs")
    const data = getBrokerData()
    const asset = data.assets?.find((a) => a.id === symbol || a.name === symbol)
    if (asset?.periods?.[timeframe]?.length >= 30) {
      return computeAdaptiveStops(asset.periods[timeframe], "up") // direction-neutral — only the magnitude matters
    }
  } catch { /* broker data not available */ }
  try {
    const history = await getHistory(symbol, "1mo")
    if (history?.dates?.length >= 30) {
      const candles = synthesizeCandles(history)
      if (!candles.length) return null // nothing usable observed — never synthesised
      return computeAdaptiveStops(candles, "up")
    }
  } catch { /* Yahoo not available */ }
  return null
}

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
      try {
        const closed = await closePaperTradeLocked({ id: p.id, exit: hit.level, reason: hit.reason, exitSource: "mark" })
        autoClosed.push(closed)
      } catch {
        // Position may have been closed concurrently — skip and continue
      }
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
// Market news — Serper, over its licensed API
//
// WS-7 T18 / D17. Serper is NOT a D17 news/sentiment source and T18 removed it
// from the sentiment path (`sentimentEngine.mjs` no longer imports it). It stays
// here because this is the /api/trading/news SEARCH surface, not the Copilot's
// 5% sentiment input, and T5 (AC-017) resolved Serper by making the documentation
// tell the truth rather than by deleting a live import.
//
// What D17:245 requires of it is labelling, and it had none: the response named
// `source: "serper"` and nothing said HOW the items were retrieved. So each item
// now carries `retrievalMode` and a `provenance` record, and the response
// carries the retrieval mode alongside the source name.
//
// SERPER'S LICENSED BASIS IS STATED, NOT ASSUMED: it is a commercial API reseller
// for Google Search, which is a licensed API and not a scrape of a ToS-
// prohibited publisher. That is a claim an operator can read and contest, which
// is the difference between labelling and asserting.
// ---------------------------------------------------------------------
export async function marketNews({ symbol, query, num = 5 } = {}) {
  const q = String(query || (symbol ? `${symbol} finance` : "financial markets today")).trim()
  // Unconfigured ≠ broken: never fake news, never a 500. The client renders
  // the honest degraded state instead. Configured-but-failing Serper still
  // throws below (real 502 with the real error).
  if (!env.serperApiKey) {
    return {
      ok: true,
      query: q,
      source: "serper",
      retrievalMode: null,
      items: [],
      degraded: { reason: "news_api_unconfigured" }
    }
  }
  if (!q) throw new Error("query required")
  const retrievedAt = new Date().toISOString()
  const raw = await serperNews(q, num)
  const items = (Array.isArray(raw) ? raw : []).map((item) => ({
    ...item,
    // AC-038: every datum carries source and retrieval mode. `verified` is
    // `null`, never `false` — nothing in this tree has verified Serper's
    // licence, and T10's `boolean | null` discipline says an unverified fact is
    // null rather than a coerced zero.
    provenance: {
      source: "serper",
      retrievalMode: SERPER_RETRIEVAL_MODE,
      licensedBasis: SERPER_LICENSED_BASIS,
      retrievedAt,
      verified: null
    }
  }))
  return { ok: true, query: q, source: "serper", retrievalMode: SERPER_RETRIEVAL_MODE, items }
}

/** The D17 retrieval mode Serper's licensed API is reached by. */
const SERPER_RETRIEVAL_MODE = "licensed-api"

/** Why Serper is on this surface at all — stated so a reader can contest it. */
const SERPER_LICENSED_BASIS =
  "Serper is a commercial API reseller for Google Search, reached over its documented HTTP API with a " +
  "credential. It is a licensed API, not a scrape of a ToS-prohibited publisher. D17:241 prohibits " +
  "Bloomberg, X and ForexFactory specifically; Serper is none of them. It is NOT one of the four sources " +
  "D17:241 permits for the Copilot's 5% Sentiment input, and T18 removed it from that path."

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

async function openPaperTradeLocked({ symbol, side, entry, amount, takeProfit, stopLoss, signalId }) {
  const creds = await getCredentials()
  const ledger = await getLedger()
  const symbolName = String(symbol || "UNKNOWN").toUpperCase()
  const sideName = side === "down" ? "down" : "up"
  const entryPrice = Number(entry)
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new Error("entry price required")

  // Position sizing: use Kelly when no explicit amount is provided
  let tradeAmount = Number(amount)
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) {
    const { stats, kelly } = kellySnapshot()
    const { cash } = await paperOverview()
    const fraction = kelly.suggested > 0 ? kelly.suggested / 100 : creds.riskPerTradePct / 100
    tradeAmount = Math.round(cash * fraction * 100) / 100
    tradeAmount = Math.max(1, Math.min(tradeAmount, cash)) // floor $1, cap at available cash
  }
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) throw new Error("amount required")

  // Stop-loss/take-profit levels are plain price levels on the position. For an
  // "up" position SL sits below entry and TP above; the reverse for "down".
  const mult = sideName === "down" ? -1 : 1
  let tp = takeProfit != null && takeProfit !== "" ? Number(takeProfit) : null
  let sl = stopLoss != null && stopLoss !== "" ? Number(stopLoss) : null

  // Adaptive stops: auto-compute SL/TP from volatility when not explicitly provided
  if (tp == null && sl == null) {
    try {
      const adaptive = await computeAdaptiveStopsFromSymbol(symbolName)
      if (adaptive) {
        // Only apply if the computed levels sit on the correct side of entry
        const tpValid = mult === 1 ? adaptive.takeProfit > entryPrice : adaptive.takeProfit < entryPrice
        const slValid = mult === 1 ? adaptive.stopLoss < entryPrice : adaptive.stopLoss > entryPrice
        if (tpValid) tp = adaptive.takeProfit
        if (slValid) sl = adaptive.stopLoss
      }
    } catch {
      /* adaptive stops are best-effort — never block a trade */
    }
  }

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

  // Model-matrix calibration: snapshot each model's vote at entry so the
  // resolved close can feed per-model realized accuracy. Best-effort — when
  // the broker feed has no candles for this symbol, no votes are captured
  // and no calibration happens (honest: nothing observed, nothing recorded).
  let modelVotes = null
  try {
    const { getBrokerData } = await import("./brokers/index.mjs")
    const { computeModelMatrix } = await import("./modelMatrix.mjs")
    const data = getBrokerData()
    const asset = (data?.assets ?? []).find((a) => a.id === symbolName || a.name === symbolName)
    const candles = asset?.periods?.[60] ?? []
    const m = computeModelMatrix(candles)
    if (m.ok && Array.isArray(m.votes) && m.votes.length) {
      modelVotes = m.votes.map((v) => ({ short: v.short, direction: v.direction }))
    }
  } catch {
    /* best-effort — a broken snapshot must never block a paper trade */
  }

  const position = {
    id: randomBytes(6).toString("hex"),
    correlationId: randomBytes(8).toString("hex"),
    signalId: signalId || null,
    symbol: symbolName,
    side: sideName,
    entry: Math.round(entryPrice * 1e6) / 1e6,
    amount: Math.round(tradeAmount * 100) / 100,
    takeProfit: tp == null ? null : Math.round(tp * 1e6) / 1e6,
    stopLoss: sl == null ? null : Math.round(sl * 1e6) / 1e6,
    modelVotes,
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

  // Auto-resolve linked signal if present
  if (p.signalId) {
    const sIdx = ledger.signals.findIndex((s) => s.id === p.signalId && s.status !== "resolved")
    if (sIdx >= 0) {
      const s = ledger.signals[sIdx]
      const diff = exitPrice - s.entry
      let resolution = "draw"
      if (Math.abs(diff) > 1e-9) {
        resolution = s.direction === "up" ? (diff > 0 ? "win" : "loss") : diff > 0 ? "loss" : "win"
      }
      ledger.signals[sIdx] = {
        ...s,
        status: "resolved",
        resolution,
        outcomePct: Math.round((diff / s.entry) * 10000) / 100,
        resultPrice: Math.round(exitPrice * 1e6) / 1e6,
        resolvedAt: new Date().toISOString(),
        tradeId: closed.id
      }
    }
  }

  // Model-matrix calibration on close: feed the resolved direction into each
  // model's EMA win-rate. Best-effort — only when votes were snapshotted at
  // entry does a closed trade teach the models anything.
  if (Array.isArray(p.modelVotes) && p.modelVotes.length) {
    try {
      const { recordModelOutcomes } = await import("./modelMatrix.mjs")
      recordModelOutcomes(p.modelVotes, exitPrice > p.entry)
    } catch {
      /* calibration must never break a close */
    }
  }

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
    ...signal,
    id: randomBytes(6).toString("hex"),
    createdAt: new Date().toISOString(),
    status: "pending"
  }
  ledger.signals.push(entry)
  await saveLedger(ledger)
  return entry
}

export function recentSignals(limit = 20) {
  return withLedgerLock(async () => {
    await flushStaleSignalsLocked()
    const ledger = await getLedger()
    return ledger.signals.slice(-limit).reverse()
  })
}

/**
 * The signal ledger's staleness policy — mirror of accuracyLedger's
 * MAX_PENDING_MS → unresolved cap. A pending signal that never got resolved
 * within the cap is marked unresolvable HONESTLY (status "unresolved") rather
 * than lingering as "pending" forever and inflating the pending count. We
 * never guess a win/loss for it — that would be fabricating outcomes.
 */
export const MAX_SIGNAL_PENDING_MS = 30 * 60 * 1000

export async function flushStaleSignals({ now = Date.now() } = {}) {
  return withLedgerLock(() => flushStaleSignalsLocked({ now }))
}

async function flushStaleSignalsLocked({ now = Date.now() } = {}) {
  const ledger = await getLedger()
  const staleAt = Number(now) - MAX_SIGNAL_PENDING_MS
  let flushed = 0
  for (const s of ledger.signals) {
    if (s.status !== "pending") continue
    const createdMs = new Date(s.createdAt ?? 0).getTime()
    if (!Number.isFinite(createdMs) || createdMs > staleAt) continue
    s.status = "unresolved"
    s.resolution = "unresolved"
    s.outcomePct = null
    s.resolvedAt = new Date(Number(now)).toISOString()
    s.flushReason =
      s.entry == null
        ? "signal recorded with no entry price — cannot be resolved against a result price"
        : "no result price arrived within the pending window — left unresolved rather than guessed"
    flushed += 1
  }
  if (flushed > 0) await saveLedger(ledger)
  return flushed
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
export function signalAccuracy() {
  return withLedgerLock(async () => {
    await flushStaleSignalsLocked()
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
  })
}

/** Test hook — wipe ledger, credentials, venue tokens and watchlist back to defaults. */
export async function _resetTradingData() {
  await writeJSON(CREDS_FILE, { ...DEFAULT_CREDS })
  await writeJSON(LEDGER_FILE, { ...DEFAULT_LEDGER })
  await writeJSON(WATCHLIST_FILE, [])
  await writeJSON(VENUE_TOKENS_FILE, {})
}

/**
 * Test hook — replace the whole signals array (used to back-date entries for
 * staleness tests, mirroring accuracyLedger's entryTs manipulation).
 */
export async function _overwriteSignals(signals) {
  return withLedgerLock(async () => {
    const ledger = await getLedger()
    ledger.signals = signals
    await saveLedger(ledger)
  })
}

// ---------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------
export async function tradingStatus() {
  const creds = await getCredentials()
  const overview = await paperOverview()
  // D2/AC-005: the `expertOption` status block is REMOVED. It reported the EO
  // session (connected / balance / wallets / gateway rpm), all of which came
  // from the deleted transport. The fourth dead call site lived here too:
  // `getDemoSession()` (old `:991`) is defined nowhere, so it threw on every
  // call and the `catch` turned the gateway meter into a permanent silent null.
  // It is deleted rather than kept as a try/catch around a missing symbol.
  let uptime24h = null
  try {
    const { sessionUptime24h } = await import("./scheduler.mjs")
    uptime24h = sessionUptime24h()
  } catch { /* ignore */ }
  return {
    ok: true,
    mode: "paper",
    updatedAt: new Date().toISOString(),
    riskPerTradePct: creds.riskPerTradePct,
    uptime24h,
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

// D2/AC-005: `analyzeExpertOptionAsset` is REMOVED. It connected to the
// ExpertOption websocket via `connectSession` and parsed the response with
// `assetsFrom`/`candlesFrom`/`balanceFrom` — all from the deleted
// expertoption.mjs. It had exactly one caller, the `/api/trading/analyze/
// expertoption` route in handlers.mjs, which is removed in the same change.
// Nothing is rewired to another venue: an EO analysis request is no longer a
// route, and the surviving `/api/trading/analyze` and `/api/trading/pro/analyze`
// routes are the venue-agnostic symbol/asset analyses that never touched EO.

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
    // Provider-consistency signal (TRADING SIGNALS ONLY, OFF by default):
    // PICC_PROVIDER_CONSISTENCY=on dual-samples a second provider with the
    // same input. Agreement → primary advice; divergence → HOLD advisory with
    // both outputs; advisory ceiling holds (never auto-GO).
    const advice = await chatSignalText(system, q + contextLine)
    if (advice !== null && typeof advice === "object") {
      return {
        ok: true,
        source: "llm-consistency-hold",
        advice: `HOLD — providers diverged, so no signal. Primary (${advice.primary?.provider}): ${String(advice.primary?.output ?? "").slice(0, 500)} | Secondary (${advice.secondary?.provider}): ${String(advice.secondary?.output ?? "").slice(0, 500)}`,
        consistency: advice
      }
    }
    return { ok: true, source: "llm", advice }
  } catch (err) {
    return { ok: true, source: "local", advice: `LLM unavailable (${err.message}). Rule of thumb: 1-2% risk per trade, paper-trade first, and expect most short-dated options to expire worthless.` }
  }
}

/**
 * Risk-of-ruin calculator using the classic formula:
 *   RoR = ((1 - edge) / (1 + edge)) ^ units
 * where edge = winRate * avgPayout - (1 - winRate)  (expected profit per unit
 * wagered — reduces to 2p−1 in the even-money case the formula was derived for)
 * and units = balance / riskPerTrade.
 *
 * For binary options the payout is fixed (typically 0.70-0.90x), so we use
 * the actual avgPayout from the paper ledger when available.
 *
 * ── UI-4: THE FOUR INPUTS ARE NOT ALL THE CALLER'S ───────────────────────────
 *
 * A caller that posts NOTHING used to receive a full, confident, precisely
 * formatted readout — riskOfRuin, edge, unitsToRuin, kellyFraction, a rounded
 * `inputs` block — computed entirely from values this function invented, and not
 * one field of the response said so. The client could not be honest about it,
 * because it had nothing to be honest WITH.
 *
 * TWO LAYERS, BOTH SILENT. The route substituted four numbers for whatever the
 * body omitted, and then this function substituted four MORE with `||`, at a
 * different layer, for different reasons, recording neither. `||` is also why an
 * explicit `0` was destroyed: `0 || 50` is 50, so a caller who genuinely posted
 * `riskPct: 0` was silently overridden, and the answer it got back was to a
 * question it had not asked.
 *
 * ONE SUBSTITUTION POINT, WHICH IS THE DESIGN DECISION. The route no longer
 * substitutes. It passes the caller's values through UNTOUCHED and passes the
 * ledger-derived fallbacks in a `defaults` map whose every entry NAMES its
 * `source`; this function is the only place a value can be replaced. Two
 * reasons, and the second is the one that decided it:
 *
 *  - It makes the record COMPLETE BY CONSTRUCTION. "Every number in `inputs`
 *    that is not the caller's is named in `provenance`" is checkable in one
 *    function. With two substitution points it was a claim about two files.
 *  - It gives ONE author the whole question. "Where did this number come from,
 *    and was it changed on the way in?" is answerable by reading one function.
 *    Layering it would have left the reader holding two records that can
 *    disagree, and the disagreement is invisible — which is the defect.
 *
 * The cost is that this function's signature grows a fifth key. It is additive:
 * `riskOfRuin()` and `riskOfRuin({winRate, avgPayout, riskPct, balance})` behave
 * as before for every in-range value, which `auditRegressions.test.mjs:48-59`
 * pins, and `provenance` is a NEW key — no existing field is removed or renamed.
 */

/** The three states a value can be in once this function is done with it. */
export const ROE_SUPPLIED = "supplied"
export const ROE_SUBSTITUTED = "substituted"
export const ROE_CLAMPED = "clamped"

/** The four inputs, in the order the UI renders them. */
const ROE_FIELDS = ["winRate", "avgPayout", "riskPct", "balance"]

/**
 * Read a caller-supplied value as a number, or say in words why it is not one.
 *
 * `Number(x)` IS NOT THIS FUNCTION, and the difference is the whole point of the
 * third state. `Number(null)` is `0` and `Number("")` is `0`, so the old route
 * read an explicit JSON `null` and a blank form field as a MEASURED ZERO and
 * reported it as supplied. A null is the absence of a number, not the number
 * zero, and a caller who sent null has said nothing about their win rate.
 *
 * Numeric strings ARE accepted, because the old route ran everything through
 * `Number()` and `{"riskPct": "5"}` has always worked. Narrowing that would
 * break a caller for a reason that has nothing to do with this defect.
 */
function readRoeNumber(raw) {
  if (raw === undefined) return { ok: false, reason: "caller sent no value" }
  if (raw === null) return { ok: false, reason: "caller sent null, which is not a number" }
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, reason: "caller sent a non-finite number" }
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed === "") return { ok: false, reason: "caller sent an empty string, which is not a number" }
    const n = Number(trimmed)
    return Number.isFinite(n)
      ? { ok: true, value: n }
      : { ok: false, reason: `caller sent "${trimmed}", which is not a number` }
  }
  return { ok: false, reason: `caller sent a ${Array.isArray(raw) ? "list" : typeof raw}, which is not a number` }
}

/**
 * Per input: the value to use, and the CLAMP record when a bound moved it.
 *
 * EVERY BOUND HERE IS ONE THIS FUNCTION HAS ALWAYS ENFORCED. NO RANGE IS MOVED
 * by UI-4: the `avgPayout` floor was lowered to 0 for one round and that is
 * reverted, so an out-of-range value today produced the same number it produced
 * before this task. What changed is not the RANGE, it is that a caller-supplied
 * value in the range is no longer discarded by `||` first, so reaching a bound
 * now means what it says on the tin: the caller sent something out of range.
 *
 * AND A BOUND IS DECIDED WITHOUT ARITHMETIC THAT CAN DISAGREE WITH THE CALLER'S
 * OWN UNIT. `clamp` returns its argument unchanged when it is already in range,
 * so `used !== n` is a sound test for the three fields whose bound is a single
 * comparison against `n`. `riskPct` is the exception and the reason this note
 * exists: it converts to a fraction and back, and that round-trip is lossy, so
 * it compares in the fraction domain and reports the caller's own `n`.
 */
const ROE_SPEC = {
  // ── winRate (percent). Clamped to 1-99, as always.
  winRate: {
    serverDefault: { value: 50, source: "server-constant" },
    prepare(n) {
      const used = clamp(n, 1, 99)
      return {
        used,
        clamp:
          used === n
            ? null
            : {
                from: n,
                to: used,
                bound: "win rate outside 1%-99%",
                // The note does not name the endpoints as the trigger, because the
                // endpoints are not where the clamp starts: 99.5 is out of range
                // too. It says what the bound IS FOR, which is the part a reader
                // cannot get from the numbers.
                note:
                  "a win rate below 1% or above 99% makes the formula's edge degenerate, " +
                  "so the readout is computed at the nearest value this calculator supports"
              }
      }
    }
  },

  // ── avgPayout (x). Floor 0.01 for anything non-zero, EXCEPT an explicit 0.
  //
  // The 0.01 floor was there to stop a nonsense payout dividing something by
  // zero, and `kellyFraction`'s `ap > 0 ? … : 0` guard already does that job
  // explicitly. What the floor ALSO did was make an explicit zero inexpressible:
  // a trade that returns nothing per win is a real thing that happens, and a
  // caller asking "what does this look like if the payout is zero?" was answered
  // with 0.01 — the same fabrication as the 0.8 it used to be answered with, one
  // layer down. Nothing here is NaN at ap = 0: `log(1 + 0)` is 0, `edge` is
  // `wr - 1`, and the Kelly guard is already there. So a caller who SENDS a zero
  // is obeyed.
  //
  // THE BAND ITSELF IS NOT MOVED, and this is the whole point of the `=== 0`
  // guard. Lowering the floor to 0 was in the brief's gift and is reverted: it
  // was never asked for, and it moved `(0, 0.01)` — values that were never absent
  // and never an explicit zero — so `avgPayout: 0.005` silently took
  // `kellyFraction` from -4950% to -9950%. A caller who sent 0.005 still gets
  // 0.01, exactly as they always have, and the clamp record names the move.
  avgPayout: {
    serverDefault: { value: 0.8, source: "server-constant" },
    prepare(n) {
      const used = n === 0 ? 0 : Math.max(0.01, n)
      return {
        used,
        clamp:
          used === n
            ? null
            : {
                from: n,
                to: used,
                // NAMES BOTH REASONS, because the bound now fires for either: a
                // negative payout AND anything between zero and 0.01. The old
                // label said "negative payout", which would be untrue for the
                // 0.005 case this floor has always handled.
                bound: "payout below 0.01 — negative, or between zero and 0.01",
                note:
                  n < 0
                    ? "a negative payout means paying to take the trade, not being paid for it"
                    : "this is the smallest payout this calculator supports, so 0.01 is the floor rather than the number you sent"
              }
      }
    }
  },

  // ── riskPct (percent). Clamped to a 0.1%-100% fraction, as always.
  //
  // THIS IS THE CASE WHERE A ZERO GENUINELY CANNOT BE HONOURED, and the brief's
  // own example. `units = 1 / risk`, so a risk fraction of zero has NO FINITE
  // NUMBER OF UNITS TO RUIN — 1/0 is unbounded. The old `|| 2` answered a
  // different question entirely, and silently. So the response computes at the
  // documented 0.1% floor AND says so in words, because a caller who typed 0
  // needs to learn that the number on the screen is a floor and not their
  // number. This is also why the `units` line below can no longer reach its
  // `: 1000` fallback: `risk >= 0.001` and `balance >= 1` are both enforced
  // above, so `balance * risk > 0` is now always true.
  riskPct: {
    serverDefault: { value: 2, source: "server-constant" },
    prepare(n) {
      const fraction = n / 100
      const floored = clamp(fraction, 0.001, 1)
      // THE CLAMP IS DECIDED IN THE FRACTION DOMAIN, and never as
      // `floored * 100 === n`. That comparison was a FLOAT ROUND-TRIP: `7 / 100`
      // is not exactly 0.07, and `0.07 * 100` is 7.000000000000001, so nine of
      // the integers in 0..100 (0, 7, 14, 28, 29, 55, 56, 57, 58) disagreed with
      // their own round-trip and were reported as having hit the bound. The bound
      // was never reached and the note was untrue — `clamp` returns its argument
      // UNCHANGED when the argument is already in range, so `floored !== fraction`
      // is exactly "a bound moved this" with no arithmetic to disagree about.
      const moved = floored !== fraction
      // REPORTED IN PERCENT, like the value the caller sent. Every `used` in
      // this table is in its caller's own unit, so the UI can print "assumed
      // 2%" without knowing which fields happen to be fractions internally.
      //
      // AND WHEN NO BOUND FIRED, `used` IS `n` — NOT `floored * 100`. The
      // round-trip is lossy, so `floored * 100` would put 7.000000000000001 on
      // the screen beside the words "used as you typed it", and `used` exists to
      // answer exactly one question: is this the number the caller sent. When a
      // bound DID fire the two are equal in every case that matters, so the
      // clamped branch still reports the bound as a value in the caller's unit.
      const used = moved ? floored * 100 : n
      return {
        used,
        clamp: moved
          ? {
              from: n,
              to: used,
              bound: "risk per trade outside 0.1%-100%",
              // THREE CASES, NOT TWO. The note used to branch on `n <= 0` alone,
              // so a value between zero and the 0.1% floor — clamped UP, for
              // neither reason the note knew — was told it risked more than the
              // account holds. A note that names the wrong bound is worse than no
              // note, so each side of the range gets the reason that actually
              // applies to it.
              note:
                n <= 0
                  ? "a risk fraction of zero or less has no finite number of units to ruin — " +
                    "1/0 is unbounded — so this is the 0.1% FLOOR, not the number you sent"
                  : n < 0.1
                    ? "anything below 0.1% rounds up to the floor, so this is the smallest risk " +
                      "per trade this calculator supports — not the number you sent"
                    : "a risk fraction above 100% risks more than the account holds"
            }
          : null
      }
    }
  },

  // ── balance. Floored at 1, as always.
  balance: {
    serverDefault: { value: 1000, source: "server-constant" },
    prepare(n) {
      const used = Math.max(1, n)
      return {
        used,
        clamp:
          used === n
            ? null
            : {
                from: n,
                to: used,
                bound: "balance below 1",
                note: "a balance under 1 has no fractional unit to size a wager against"
              }
      }
    }
  }
}

export function riskOfRuin(input = {}) {
  const args = input && typeof input === "object" ? input : {}
  const defaults = args.defaults && typeof args.defaults === "object" ? args.defaults : {}

  const provenance = {}
  const used = {}
  const assumedInputs = []
  const clampedInputs = []

  for (const field of ROE_FIELDS) {
    const spec = ROE_SPEC[field]
    const read = readRoeNumber(args[field])

    // A DEFAULT OFFER IS ONLY HONOURED WHEN IT IS A USABLE NUMBER **AND SAYS
    // WHERE IT CAME FROM**. Both halves are load-bearing: the value guard keeps
    // `Number(null) === 0` from reappearing one layer down as an "offer" of zero
    // from a ledger that had nothing, and the LABEL guard is what makes the
    // record true by construction — an offer this function cannot attribute is
    // worse than no offer, because it would reach `provenance` as a substitute
    // with an undefined origin. An unlabelled offer is refused, and the server
    // constant — which is labelled — is used instead.
    const offer = read.ok ? null : defaults[field]
    const labelled =
      offer !== null &&
      typeof offer === "object" &&
      Number.isFinite(offer.value) &&
      typeof offer.source === "string" &&
      offer.source !== ""
    const chosen = labelled
      ? { value: offer.value, source: offer.source }
      : { value: spec.serverDefault.value, source: spec.serverDefault.source }

    const prepared = spec.prepare(read.ok ? read.value : chosen.value)

    if (!read.ok) assumedInputs.push(field)
    if (prepared.clamp) clampedInputs.push(field)

    provenance[field] = {
      // The state names what CHANGED THE NUMBER. An input that was both assumed
      // and clamped is reported as clamped, because that is the transformation a
      // reader would be misled by — and `substitute` below still carries the fact
      // that the caller did not choose it, so neither lie survives.
      state: prepared.clamp ? ROE_CLAMPED : read.ok ? ROE_SUPPLIED : ROE_SUBSTITUTED,
      supplied: read.ok,
      used: prepared.used,
      substitute: read.ok ? null : { value: chosen.value, source: chosen.source, reason: read.reason },
      clamp: prepared.clamp
    }
    used[field] = prepared.used
  }

  const wr = used.winRate / 100
  const ap = used.avgPayout
  const risk = used.riskPct / 100
  const bal = used.balance

  const units = Math.floor(bal * risk > 0 ? 1 / risk : 1000)
  // The old /(ap+1) divisor HALVED the edge: at p=0.55 it reported ~13.9% RoR
  // where the formula gives ~1.9% — overstating ruin risk ~7×.
  const edge = wr * ap - (1 - wr)
  const base = Math.max(0, Math.min(1, (1 - edge) / (1 + edge)))
  const ror = Math.pow(base, units)

  const expectedGrowth = wr * Math.log(1 + ap * risk) + (1 - wr) * Math.log(1 - risk)
  const kellyFraction = ap > 0 ? (wr * (1 + ap) - 1) / ap : 0
  const halfKelly = Math.max(0, kellyFraction / 2)

  return {
    ok: true,
    riskOfRuin: Math.round(ror * 10000) / 10000,
    riskOfRuinPct: Math.round(ror * 10000) / 100 + "%",
    edge: Math.round(edge * 10000) / 100 + "%",
    unitsToRuin: units,
    expectedGrowthPct: Math.round(expectedGrowth * 10000) / 100 + "%",
    kellyFraction: Math.round(kellyFraction * 10000) / 100 + "%",
    halfKellyPct: Math.round(halfKelly * 10000) / 100 + "%",
    inputs: { winRate: Math.round(wr * 100), avgPayout: ap, riskPct: Math.round(risk * 10000) / 100, balance: bal },
    /**
     * WHICH OF THE FOUR INPUTS THE CALLER ACTUALLY SUPPLIED (UI-4).
     *
     * Additive: everything above is exactly as it was. `inputs` stays the
     * ROUNDED echo it has always been — `provenance.<field>.used` carries the
     * unrounded value the arithmetic actually ran on, so the two can differ by
     * rounding and that is not a contradiction.
     */
    provenance: {
      ...provenance,
      /** Names, never counts: which inputs the caller did not supply. */
      assumedInputs,
      /** Names: which inputs had a bound applied on the way in. */
      clampedInputs
    }
  }
}
