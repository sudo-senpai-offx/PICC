// PICC Trading Suite — ExpertOption demo trading + autopilot.
//
// EVERYTHING here is DEMO-ONLY. The autopilot refuses to run unless the
// ExpertOption account is configured as a demo account (`expertoptionDemo: true`)
// and a session token is present. Every decision and settlement is written to
// the local demo-deals file and the agent log so the experiment is fully
// auditable. This is NOT investment advice and nothing here risks real money.

import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { connectTradingSession, candlesFrom } from "./expertoption.mjs"
import { getCredentials, recordSignal, resolveSignal } from "./trading.mjs"
import { predictDirection } from "./prediction.mjs"
import { proAnalyzeCandles } from "./proanalysis.mjs"
import { metricsFrom } from "./analytics.mjs"
import { appendRow } from "./localstore.mjs"
import { chatText, llmConfigured } from "./llm.mjs"
import { volatilityPositionSize, realizedVolatility } from "./volatility.mjs"

const DATA_DIR =
  process.env.PICC_TRADING_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const CONFIG_FILE = join(DATA_DIR, "trading-autopilot.json")
const DEALS_FILE = join(DATA_DIR, "trading-demo-deals.json")

try {
  mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* already exists */
}

const DEFAULTS = {
  enabled: false,
  assetId: "BTCUSD",
  duration: 60,
  amount: null, // null => auto: riskPerTradePct of balance
  minConfidence: 55,
  cooldownMs: 15 * 60 * 1000,
  maxConcurrent: 3,
  dailyLossLimitPct: 10,
  maxDailyTrades: 0, // 0 = unlimited
  aiGate: false,
  proGate: false,
  timeframe: 60,
  count: 120,
  stopReason: null,
  dayKey: null,
  dayStartBalance: null,
  lastEntryAt: 0
}

const state = {
  session: null,
  sessionPromise: null,
  sessionError: null,
  loopTimer: null,
  lastRun: null,
  lastDecision: null
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100
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
        console.warn(`[picc-autopilot] write failed ${file}:`, retryErr.message)
        return false
      }
    }
    console.warn(`[picc-autopilot] write failed ${file}:`, err.message)
    return false
  }
}

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

export async function getAutopilotConfig() {
  const saved = await readJSON(CONFIG_FILE, {})
  return { ...DEFAULTS, ...saved }
}

export async function saveAutopilotConfig(patch) {
  const next = { ...(await getAutopilotConfig()), ...(patch ?? {}) }
  next.enabled = Boolean(next.enabled)
  next.assetId = String(next.assetId || "BTCUSD").trim().toUpperCase()
  next.duration = clamp(Math.round(Number(next.duration) || 60), 5, 43200)
  next.amount = next.amount != null && Number(next.amount) > 0 ? clamp(Number(next.amount), 1, 1000) : null
  next.minConfidence = clamp(Number(next.minConfidence) || 55, 30, 95)
  next.cooldownMs = clamp(Math.round(Number(next.cooldownMs) || 900000), 10000, 86400000)
  next.maxConcurrent = clamp(Math.round(Number(next.maxConcurrent) || 3), 1, 10)
  next.dailyLossLimitPct = clamp(Number(next.dailyLossLimitPct) || 10, 1, 100)
  next.maxDailyTrades = clamp(Math.round(Number(next.maxDailyTrades) || 0), 0, 100)
  next.aiGate = Boolean(next.aiGate)
  next.proGate = Boolean(next.proGate)
  next.timeframe = clamp(Math.round(Number(next.timeframe) || 60), 5, 3600)
  next.count = clamp(Math.round(Number(next.count) || 120), 30, 500)
  if (typeof next.stopReason !== "string") next.stopReason = next.stopReason ?? null
  next.lastEntryAt = Math.max(0, Number(next.lastEntryAt) || 0)
  await writeJSON(CONFIG_FILE, next)
  return getAutopilotConfig()
}

// ---------------------------------------------------------------------
// Demo trades + session
// ---------------------------------------------------------------------

function ensureSession() {
  if (state.session && state.session.connected) return Promise.resolve(state.session)
  if (state.sessionPromise) return state.sessionPromise

  state.sessionPromise = (async () => {
    const creds = await getCredentials()
    if (!creds.expertoptionToken) throw new Error("ExpertOption not configured — add your session token first")
    if (!creds.expertoptionDemo) throw new Error("demo mode disabled — autopilot refuses to trade a live account")
    const session = await connectTradingSession({
      token: creds.expertoptionToken,
      isDemo: creds.expertoptionDemo,
      wsUrl: creds.expertoptionWsUrl
    })
    state.session = session
    state.sessionError = null
    session.onDeal((kind, deal) => {
      if (kind === "settled") void recordDeal(deal)
    })
    return session
  })().catch((err) => {
    state.sessionError = err.message
    throw err
  }).finally(() => {
    state.sessionPromise = null
  })

  return state.sessionPromise
}

export async function _closeSession() {
  if (state.loopTimer) {
    clearInterval(state.loopTimer)
    state.loopTimer = null
  }
  if (state.session) {
    try {
      state.session.close()
    } catch {
      /* ignore */
    }
    state.session = null
  }
  state.sessionPromise = null
  state.sessionError = null
}

async function recordDeal(deal) {
  const write = dealWrite.then(
    () => recordDealLocked(deal),
    () => recordDealLocked(deal)
  )
  dealWrite = write.then(
    () => undefined,
    () => undefined
  )
  return write
}

let dealWrite = Promise.resolve()

async function recordDealLocked(deal) {
  const file = await readJSON(DEALS_FILE, { deals: [] })
  file.deals.unshift({
    ...deal,
    recordAt: new Date().toISOString()
  })
  file.deals = file.deals.slice(0, 500)
  await writeJSON(DEALS_FILE, file)
  await appendRow("agent_logs", {
    role: "tool",
    name: "expertoption_settle",
    content: JSON.stringify({
      serverId: deal.serverId,
      symbol: deal.asset ?? deal.assetId,
      type: deal.type,
      amount: deal.amount,
      result: deal.result,
      profit: deal.profit
    })
  })
  await recordFeedback(deal)
}

/**
 * Feedback loop: every settled demo deal becomes a resolved signal in the paper
 * ledger, so the engine's direction accuracy is measured against real (demo)
 * outcomes instead of being an untested opinion. Best-effort — a malformed deal
 * never breaks the settlement pipeline.
 */
async function recordFeedback(deal) {
  try {
    const entry = Number(deal.openPrice)
    const close = Number(deal.closePrice)
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(close) || close <= 0) return
    const signal = await recordSignal({
      symbol: String(deal.asset ?? deal.assetId ?? "UNKNOWN").toUpperCase(),
      direction: deal.type === "put" ? "down" : "up",
      confidence: null,
      horizonDays: 3,
      entry,
      source: "autopilot",
      serverId: deal.serverId
    })
    await resolveSignal({ id: signal.id, resultPrice: close })
  } catch (err) {
    // "pending signal not found" just means a duplicate settlement arrived for
    // an already-resolved deal — not an error worth logging.
    if (!/pending signal not found/.test(err.message)) {
      console.warn(`[picc-autopilot] feedback record failed: ${err.message}`)
    }
  }
}

async function todayPnl() {
  const file = await readJSON(DEALS_FILE, { deals: [] })
  const today = new Date().toISOString().slice(0, 10)
  return file.deals
    .filter((d) => (d.closedAt ?? "").startsWith(today))
    .reduce((s, d) => s + (Number(d.profit) || 0), 0)
}

/** Number of deals settled so far today — feeds the maxDailyTrades cap. */
async function todayTradeCount() {
  const file = await readJSON(DEALS_FILE, { deals: [] })
  const today = new Date().toISOString().slice(0, 10)
  return file.deals.filter((d) => (d.recordAt ?? "").startsWith(today)).length
}

async function defaultAmount(balance, riskPct, closes) {
  // Volatility-adjusted sizing: use GARCH/realized vol to scale position inversely
  if (Array.isArray(closes) && closes.length >= 30) {
    try {
      const rv = realizedVolatility(closes, { period: 20 })
      const currentVol = rv.annual || 0.30
      const sizing = volatilityPositionSize({
        capital: balance,
        riskPct: (Number(riskPct) || 2) / 100,
        currentVol,
        targetVol: 0.20,
        entryPrice: closes[closes.length - 1]
      })
      // Use vol-scaled amount but fallback to simple pct if units < 1
      if (sizing.units >= 1 && Number.isFinite(sizing.riskBudget)) {
        return clamp(round2(sizing.riskBudget), 1, 1000)
      }
    } catch {
      // fallback to simple sizing
    }
  }
  return clamp(round2((Number(balance) || 0) * (Number(riskPct) || 2) / 100), 1, 1000)
}

/**
 * Place a single demo trade (explicit, from the UI). Validates that the account
 * is a demo account before anything is sent to the broker.
 */
export async function placeDemoTrade({ assetId, type, amount, duration }) {
  const creds = await getCredentials()
  if (!creds.expertoptionToken) throw new Error("ExpertOption not configured — add your session token first")
  if (!creds.expertoptionDemo) throw new Error("demo trading disabled — expertoptionDemo is off")

  const session = await ensureSession()
  const direction = type === "put" ? "put" : "call"
  const balance = (await session.balance()).balance ?? 0
  const finalAmount =
    amount != null && Number(amount) > 0
      ? clamp(Number(amount), 1, 50000)
      : await defaultAmount(balance, creds.riskPerTradePct)
  const dur = Math.round(Number(duration) || 60)

  const deal = await session.buy({ assetId, type: direction, amount: finalAmount, duration: dur })
  await appendRow("agent_logs", {
    role: "tool",
    name: "expertoption_demo_trade",
    content: JSON.stringify({
      symbol: String(assetId),
      direction,
      amount: finalAmount,
      duration: dur,
      serverId: deal.serverId
    })
  })
  return deal
}

// ---------------------------------------------------------------------
// Autopilot decision + loop
// ---------------------------------------------------------------------

/**
 * Pure decision function — no I/O, easy to unit test.
 * `pred` is the predictDirection result ({ direction, confidence, reason }).
 * `pro` is the optional proAnalyzeCandles report; when config.proGate is on the
 * trade is refused unless pro agrees with the ensemble.
 */
export function decideAutopilot({ config, pred, pro = null, openCount = 0, lastEntryAt = 0, now = Date.now(), dailyPnl = 0, dayStartBalance = null, todayTrades = 0, aiVeto = false }) {
  const refuse = (reason) => ({ trade: false, reason })
  if (!config.enabled) return refuse("autopilot disabled")
  if (!pred || !pred.direction || pred.direction === "flat") return refuse("no directional signal")
  const confidence = Number(pred.confidence) || 0
  if (confidence < Number(config.minConfidence)) {
    return refuse(`confidence ${confidence}% below ${config.minConfidence}%`)
  }
  if (now - Number(lastEntryAt) < Number(config.cooldownMs)) return refuse("cooldown in effect")
  if (Number(openCount) >= Number(config.maxConcurrent)) return refuse("max concurrent deals reached")
  if (Number(config.maxDailyTrades) > 0 && Number(todayTrades) >= Number(config.maxDailyTrades)) {
    return refuse(`daily trade cap ${config.maxDailyTrades} reached`)
  }
  if (aiVeto) return refuse("AI gate vetoed the signal")

  // Pro-analysis confluence gate: the ensemble signal must survive the full
  // indicator read before any (demo) order is considered.
  if (config.proGate) {
    const verdict = pro?.confluence?.verdict
    const proDir = pro?.bias?.direction
    if (!pro) return refuse("pro analysis unavailable")
    if (!verdict || verdict === "NEUTRAL") return refuse("pro confluence is NEUTRAL — no edge")
    if (proDir && proDir !== "flat" && proDir !== pred.direction) {
      return refuse(`pro analysis (${proDir}) and ensemble (${pred.direction}) disagree`)
    }
    if (pro.phase?.phase === "volatile_range") return refuse("pro analysis flags a whipsaw range")
  }

  const start = Number(dayStartBalance)
  if (Number.isFinite(start) && start > 0 && Number(dailyPnl) <= (-Number(config.dailyLossLimitPct) * start) / 100) {
    return refuse(`daily loss limit ${config.dailyLossLimitPct}% reached`)
  }

  return {
    trade: true,
    direction: pred.direction === "down" ? "put" : "call",
    confidence,
    proConfidence: pro?.confluence?.confidence ?? null,
    reason: pred.note ?? pred.reason ?? "signal"
  }
}

async function aiConsents(pred) {
  if (!llmConfigured()) return true // gate is advisory without a configured model
  try {
    const out = await chatText(
      "You are the PICC binary-options DEMO risk gate. Judge the trade signal and decide whether a demo trade is reasonable.",
      `Signal: ${pred.direction} with ${pred.confidence}% confidence.\nModels: ${JSON.stringify(pred.models ?? {})}\nReason: ${pred.note ?? pred.reason}\n\nReply with exactly one word: APPROVE or REJECT.`
    )
    return /approve/i.test(String(out ?? ""))
  } catch {
    return true
  }
}

export async function autopilotTick() {
  const config = await getAutopilotConfig()
  if (!config.enabled) return { ok: false, reason: "autopilot disabled" }

  const creds = await getCredentials()
  if (!creds.expertoptionToken) {
    state.lastDecision = "no token configured"
    return { ok: false, reason: "no token" }
  }
  if (!creds.expertoptionDemo) {
    await stopAutopilot("demo mode disabled")
    state.lastDecision = "demo mode disabled"
    return { ok: false, reason: "demo mode disabled" }
  }

  const session = await ensureSession()
  const balance = (await session.balance()).balance ?? 0
  const open = session.deals()

  // Daily reset: lock the day-start balance once per day for the loss limit.
  const today = new Date().toISOString().slice(0, 10)
  if (config.dayKey !== today) {
    config.dayStartBalance = balance
    config.dayKey = today
    await saveAutopilotConfig({ dayKey: today, dayStartBalance: balance })
  }

  const raw = await session.candles(config.assetId, config.timeframe, config.count)
  const { closes, ohlc } = candlesFrom(raw)
  if (closes.length < 30) {
    state.lastDecision = `not enough candles (${closes.length})`
    return { ok: false, reason: "not enough candles" }
  }

  const pred = predictDirection(closes, 3, { maxWindows: 200 })

  // Optional pro-analysis confluence gate (full indicator dashboard + regime
  // classification + weekly bias). Best-effort: on failure it vetoes when the
  // gate is enabled and otherwise is ignored.
  let pro = null
  if (config.proGate) {
    try {
      pro = proAnalyzeCandles({
        candles: ohlc,
        symbol: config.assetId,
        timeframe: `${config.timeframe}s`,
        horizonDays: 3
      })
      if (!pro.ok) pro = null
    } catch (err) {
      pro = null
      console.warn("[picc-autopilot] pro analysis failed:", err.message)
    }
  }

  const pnl = await todayPnl()
  const todayTrades = await todayTradeCount()
  const aiVeto = config.aiGate ? !(await aiConsents(pred)) : false
  const decision = decideAutopilot({
    config,
    pred,
    pro,
    openCount: open.length,
    lastEntryAt: config.lastEntryAt || 0,
    now: Date.now(),
    dailyPnl: pnl,
    dayStartBalance: config.dayStartBalance,
    todayTrades,
    aiVeto
  })

  state.lastRun = {
    at: new Date().toISOString(),
    ok: decision.trade,
    reason: decision.reason,
    direction: decision.direction ?? null,
    confidence: decision.confidence ?? null,
    proVerdict: pro?.confluence?.verdict ?? null,
    proConfidence: pro?.confluence?.confidence ?? null,
    proPhase: pro?.phase?.phase ?? null,
    balance,
    open: open.length
  }
  state.lastDecision = decision.trade
    ? `${decision.direction} ${decision.confidence}% — ${decision.reason}`
    : decision.reason

  if (!decision.trade) return { ok: false, reason: decision.reason }

  const amount = await defaultAmount(balance, creds.riskPerTradePct, closes)
  const deal = await session.buy({
    assetId: config.assetId,
    type: decision.direction,
    amount,
    duration: config.duration
  })
  const now = Date.now()
  await saveAutopilotConfig({ lastEntryAt: now })
  state.lastRun.deal = deal.serverId
  state.lastRun.amount = amount
  return { ok: true, reason: decision.reason, deal, amount, direction: decision.direction }
}

export async function startAutopilot() {
  await saveAutopilotConfig({ enabled: true, stopReason: null })
  if (!state.loopTimer) {
    state.loopTimer = setInterval(() => {
      void autopilotTick()
    }, 60_000)
  }
  void autopilotTick()
  return getAutopilotConfig()
}

export async function stopAutopilot(reason = "manual") {
  if (state.loopTimer) {
    clearInterval(state.loopTimer)
    state.loopTimer = null
  }
  await saveAutopilotConfig({ enabled: false, stopReason: reason })
  return getAutopilotConfig()
}

// ---------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------

export async function demoStatus() {
  const creds = await getCredentials()
  const config = await getAutopilotConfig()
  const file = await readJSON(DEALS_FILE, { deals: [] })
  const open = state.session && state.session.connected ? state.session.deals() : []
  let balance = null
  let currency = "USD"
  if (state.session && state.session.connected) {
    try {
      const b = await state.session.balance()
      balance = b.balance
      currency = b.currency
    } catch {
      /* status stays best-effort */
    }
  }
  return {
    ok: true,
    configured: Boolean(creds.expertoptionToken),
    demo: creds.expertoptionDemo,
    connected: Boolean(state.session && state.session.connected),
    sessionError: state.sessionError,
    balance,
    currency,
    openDeals: open.map((d) => ({ ...d })),
    settled: file.deals.slice(0, 20),
    todayPnl: round2(await todayPnl()),
    todayTrades: await todayTradeCount(),
    autopilot: {
      ...config,
      running: Boolean(state.loopTimer),
      lastRun: state.lastRun,
      lastDecision: state.lastDecision
    }
  }
}

/** Test hook — wipe config + demo deals and drop the socket. */
export async function _resetAutopilotData() {
  await _closeSession()
  await writeJSON(CONFIG_FILE, { ...DEFAULTS })
  await writeJSON(DEALS_FILE, { deals: [] })
  state.lastRun = null
  state.lastDecision = null
}

// ---------------------------------------------------------------------
// Demo analytics + deal history
// ---------------------------------------------------------------------

export async function demoDeals(limit = 50) {
  const file = await readJSON(DEALS_FILE, { deals: [] })
  return { ok: true, deals: file.deals.slice(0, Math.max(1, Number(limit) || 50)) }
}

/**
 * Performance analytics over the settled demo-deal history, using the same
 * metrics suite as the paper ledger (equity curve, drawdown, profit factor,
 * streaks, monthly, per-symbol) plus a call-vs-put breakdown. `starting` is
 * inferred as current balance minus net profit, so the equity curve is relative.
 */
export async function demoAnalytics() {
  const file = await readJSON(DEALS_FILE, { deals: [] })
  const rows = [...file.deals].reverse() // file is newest-first
  const net = rows.reduce((s, d) => s + (Number(d.profit) || 0), 0)

  const status = await demoStatus()
  const balance = status.balance
  const starting = balance != null && Number.isFinite(balance) ? Math.max(0, balance - net) : 0

  const metrics = metricsFrom(
    rows.map((d) => ({
      pnl: Number(d.profit) || 0,
      symbol: String(d.asset ?? d.assetId ?? "UNKNOWN").toUpperCase(),
      closedAt: d.closedAt,
      holdingMs: d.expiresAt ? Math.max(0, new Date(d.closedAt).getTime() - new Date(d.expiresAt).getTime()) : null
    })),
    starting
  )

  const byType = {
    call: { type: "call", trades: 0, wins: 0, losses: 0, draws: 0, pnl: 0 },
    put: { type: "put", trades: 0, wins: 0, losses: 0, draws: 0, pnl: 0 }
  }
  for (const d of rows) {
    const b = byType[d.type === "put" ? "put" : "call"]
    b.trades += 1
    b.pnl = round2(b.pnl + (Number(d.profit) || 0))
    if (d.result === "win") b.wins += 1
    else if (d.result === "loss") b.losses += 1
    else b.draws += 1
  }
  const byTypeList = Object.values(byType).map((b) => ({ ...b, winRate: b.trades ? Math.round((b.wins / b.trades) * 100) : null }))

  const wins = rows.filter((d) => d.result === "win").length
  return {
    ok: true,
    overview: {
      deals: rows.length,
      wins,
      losses: rows.filter((d) => d.result === "loss").length,
      draws: rows.filter((d) => d.result === "draw").length,
      winRate: rows.length ? Math.round((wins / rows.length) * 100) : null,
      netProfit: round2(net),
      todayPnl: round2(await todayPnl()),
      balance,
      currency: status.currency,
      starting: round2(starting),
      avgDurationSec: rows.length
        ? Math.round(rows.reduce((s, d) => s + (Number(d.duration) || 0), 0) / rows.length)
        : null
    },
    metrics,
    byType: byTypeList
  }
}

// ---------------------------------------------------------------------
// Bootstrap — auto-restart autopilot on server boot if enabled on disk
// ---------------------------------------------------------------------
export async function bootstrapAutopilot() {
  try {
    const config = await getAutopilotConfig()
    if (config.enabled) {
      console.log("[autopilot] resuming from previous session")
      if (!state.loopTimer) {
        state.loopTimer = setInterval(() => {
          void autopilotTick()
        }, 60_000)
      }
      void autopilotTick()
    }
  } catch {
    /* config file missing — nothing to resume */
  }
}
