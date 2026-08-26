// PICC Trading Suite — ExpertOption demo trading + autopilot.
//
// EVERYTHING here is DEMO-ONLY. The autopilot refuses to run unless the
// ExpertOption account is configured as a demo account (`expertoptionDemo: true`)
// and a session token is present. Every decision and settlement is written to
// the local demo-deals file and the agent log so the experiment is fully
// auditable. This is NOT investment advice and nothing here risks real money.

import { mkdirSync, unlinkSync } from "node:fs"
import { readFile, writeFile, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"
import { connectTradingSession, candlesFrom } from "./expertoption.mjs"
import { getCredentials, recordSignal, resolveSignal, signalAccuracy } from "./trading.mjs"
import { predictDirection } from "./prediction.mjs"
import { proAnalyzeCandles } from "./proanalysis.mjs"
import { metricsFrom } from "./analytics.mjs"
import { appendRow, localStore } from "./localstore.mjs"
import { chatText, llmConfigured } from "./llm.mjs"
import { volatilityPositionSize, realizedVolatility } from "./volatility.mjs"
import { quickMtfCheck } from "./multiTimeframe.mjs"
import { liveEOData } from "./liveEO.mjs"
import { detectRegime } from "./regimeDetection.mjs"
import { computeModelMatrix, recordModelOutcomes } from "./modelMatrix.mjs"
import { aiGatePrompts, GATE_PROMPT_VERSION } from "./prompts.mjs"

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
  // Multi-asset scope: each entry can carry its own overrides. Empty list =
  // legacy single-asset mode driven by `assetId` above (backward compatible).
  assets: [], // [{ assetId, enabled, duration?, amount?, minConfidence? }]
  duration: 60,
  amount: null, // null => auto: riskPerTradePct of balance
  minConfidence: 55,
  cooldownMs: 15 * 60 * 1000,
  humanReviewMs: 5000,
  maxConcurrent: 3,
  dailyLossLimitPct: 10,
  maxDailyTrades: 0, // 0 = unlimited
  aiGate: false,
  proGate: false,
  mtfGate: true,
  minMtfAgree: 0,
  sentimentGate: false, // when true, block trades if sentiment strongly opposes signal direction
  minSentimentAlignment: 0.3, // minimum sentiment alignment threshold (0-1) for sentimentGate
  consensusGate: false, // require the model-matrix consensus to agree with the entry signal
  minConsensusAgree: 4, // minimum directional models agreeing when consensusGate is on
  consecutiveLossLimit: 3, // consecutive-loss circuit breaker: pause after N straight losses
  consecutiveLossWindowMs: 30 * 60 * 1000, // ...only when those losses happened inside this window
  regimeShiftPause: true, // regime-shift breaker: pause entries until the new regime stabilizes
  maxCandleAgeSec: 60, // refuse to trade on candle data older than this (seconds)
  timeframe: 60,
  count: 120,
  stopReason: null,
  dayKey: null,
  dayStartBalance: null,
  lastEntryAt: 0,
  assetLastEntryAt: {} // per-asset cooldown bookkeeping { ASSETID: epochMs }
}

const state = {
  session: null,
  sessionPromise: null,
  sessionError: null,
  loopTimer: null,
  lastRun: null,
  lastDecision: null,
  dataHealth: "unknown",
  // Rolling decision log (Phase 14): every tick's outcome with a human-readable
  // reason, newest first. Turns "why didn't it trade just now" into "why has
  // it been skipping for the last 20 minutes".
  decisionLog: [],
  // Phase 13: cached liveness verdict from the scheduler's periodic re-check.
  sessionLive: null,
  sessionLiveReason: "not checked yet"
}

const DECISION_LOG_CAP = 50

/** Record a decision-log entry and set state.lastDecision in one place. */
function setLastDecision(reason, extra = {}) {
  state.lastDecision = reason
  state.decisionLog.unshift({
    at: new Date().toISOString(),
    reason,
    ...extra
  })
  if (state.decisionLog.length > DECISION_LOG_CAP) state.decisionLog.length = DECISION_LOG_CAP
}

/** Classify a refusal reason into its gate bucket (Phase 15 rejection tally). */
export function classifyGateReason(reason) {
  const r = String(reason ?? "")
  if (/disabled/i.test(r)) return "disabled"
  if (/no directional signal|flat/i.test(r)) return "no-signal"
  if (/below .*minConfidence|confidence .* below/i.test(r)) return "confidence"
  if (/cooldown/i.test(r)) return "cooldown"
  if (/max concurrent/i.test(r)) return "max-concurrent"
  if (/daily trade cap/i.test(r)) return "daily-cap"
  if (/AI gate/i.test(r)) return "ai-veto"
  if (/MTF gate/i.test(r)) return "mtf-gate"
  if (/pro analysis|pro confluence/i.test(r)) return "pro-gate"
  if (/sentiment gate/i.test(r)) return "sentiment-gate"
  if (/loss limit/i.test(r)) return "daily-loss-limit"
  if (/consecutive-loss/i.test(r)) return "loss-breaker"
  if (/regime-shift/i.test(r)) return "regime-breaker"
  if (/stale|not enough candles|candle fetch failed/i.test(r)) return "data-quality"
  if (/balance fetch failed|no token|demo mode disabled/i.test(r)) return "session"
  if (/no live browser session/i.test(r)) return "liveness"
  if (/tick error/i.test(r)) return "error"
  return "other"
}

/** Rolling decision log + per-gate rejection tally over the log window. */
export function getAutopilotDecisions(limit = 50) {
  const decisions = state.decisionLog.slice(0, Math.max(1, Math.min(Number(limit) || 50, DECISION_LOG_CAP)))
  const tally = {}
  for (const d of decisions) {
    if (d.trade) continue
    const gate = d.gate || classifyGateReason(d.reason)
    tally[gate] = (tally[gate] || 0) + 1
  }
  const trades = decisions.filter((d) => d.trade).length
  return {
    ok: true,
    decisions,
    tally,
    window: { size: decisions.length, trades, skips: decisions.length - trades }
  }
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
  const payload = JSON.stringify(value, null, 2)
  // Atomic write: truncate-then-write leaves a torn JSON file if the process
  // dies mid-write; the next reader then silently falls back to an empty
  // ledger and the daily-loss gate sees a clean slate. tmp+rename is atomic
  // on POSIX and effectively atomic on Windows (rename over existing).
  const tmp = `${file}.${process.pid}.tmp`
  const attemptRename = async () => {
    await writeFile(tmp, payload, "utf8")
    // Windows: AV/indexer briefly holds freshly-written files → EPERM on
    // rename. Retry with a short backoff before giving up.
    for (let i = 0; ; i++) {
      try {
        await rename(tmp, file)
        return true
      } catch (err) {
        if (err?.code === "EPERM" && i < 4) {
          await new Promise((r) => setTimeout(r, 25 * (i + 1)))
          continue
        }
        throw err
      }
    }
  }
  try {
    try {
      return await attemptRename()
    } catch (err) {
      if (err && err.code === "ENOENT") {
        mkdirSync(dirname(file), { recursive: true })
        return await attemptRename()
      }
      throw err
    }
  } catch (err) {
    console.warn(`[picc-autopilot] write failed ${file}:`, err.message)
    try { unlinkSync(tmp) } catch { /* already gone */ }
    // Last resort: non-atomic direct write beats losing the data entirely.
    try {
      mkdirSync(dirname(file), { recursive: true })
      await writeFile(file, payload, "utf8")
      return true
    } catch (finalErr) {
      console.warn(`[picc-autopilot] fallback write failed ${file}:`, finalErr.message)
      return false
    }
  }
}

/**
 * Serialize read-modify-write mutations of one JSON file through a promise
 * chain (same pattern as dealWrite). Prevents concurrent config saves from
 * losing each other's fields.
 */
function makeFileChain() {
  let chain = Promise.resolve()
  return (fn) => {
    const run = chain.then(fn, fn)
    chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

export async function getAutopilotConfig() {
  const saved = await readJSON(CONFIG_FILE, {})
  return { ...DEFAULTS, ...saved }
}

/**
 * Resolve the effective per-asset targets. Legacy configs (no `assets` array)
 * keep working: the single `assetId` field becomes the only target, inheriting
 * every global knob.
 */
export function enabledAssetTargets(config) {
  const raw = Array.isArray(config.assets) ? config.assets : []
  const cleaned = raw
    .filter((a) => a && typeof a === "object" && String(a.assetId ?? "").trim())
    .map((a) => ({
      assetId: String(a.assetId).trim().toUpperCase(),
      enabled: a.enabled !== false,
      duration: a.duration != null ? Number(a.duration) : null,
      amount: a.amount != null && Number(a.amount) > 0 ? Number(a.amount) : null,
      minConfidence: a.minConfidence != null && Number.isFinite(Number(a.minConfidence)) ? Number(a.minConfidence) : null
    }))
    .filter((a, i, arr) => arr.findIndex((b) => b.assetId === a.assetId) === i)
  if (cleaned.length > 0) return cleaned.filter((a) => a.enabled)
  // Legacy fallback — single asset, always "enabled" (engine-level flag rules).
  return [{
    assetId: String(config.assetId || "BTCUSD").trim().toUpperCase(),
    enabled: true,
    duration: null,
    amount: null,
    minConfidence: null
  }]
}

/** Per-asset overrides merged over the global config for decision purposes. */
function configForAsset(config, target) {
  const override = (Array.isArray(config.assets) ? config.assets : [])
    .find((a) => a && String(a.assetId ?? "").trim().toUpperCase() === target.assetId)
  return {
    ...config,
    assetId: target.assetId,
    duration: override?.duration != null ? clamp(Math.round(Number(override.duration)), 5, 43200) : config.duration,
    amount: override?.amount != null && Number(override.amount) > 0 ? Number(override.amount) : config.amount,
    minConfidence:
      override?.minConfidence != null && Number.isFinite(Number(override.minConfidence))
        ? clamp(Number(override.minConfidence), 30, 95)
        : config.minConfidence
  }
}

// Serialized config mutations: two concurrent saveAutopilotConfig calls used
// to read-modify-write the same file and silently drop each other's fields.
const mutateConfig = makeFileChain()

export async function saveAutopilotConfig(patch) {
  await mutateConfig(async () => {
    const next = { ...(await getAutopilotConfig()), ...(patch ?? {}) }
    next.enabled = Boolean(next.enabled)
    next.assetId = String(next.assetId || "BTCUSD").trim().toUpperCase()
    next.duration = clamp(Math.round(Number(next.duration) || 60), 5, 43200)
    next.amount = next.amount != null && Number(next.amount) > 0 ? clamp(Number(next.amount), 1, 1000) : null
    next.minConfidence = clamp(Number(next.minConfidence) || 55, 30, 95)
    next.cooldownMs = clamp(Math.round(Number(next.cooldownMs) || 900000), 10000, 86400000)
    next.humanReviewMs = clamp(Math.round(Number(next.humanReviewMs ?? 5000)) || 0, 0, 60000)
    next.maxConcurrent = clamp(Math.round(Number(next.maxConcurrent) || 3), 1, 10)
    next.dailyLossLimitPct = clamp(Number(next.dailyLossLimitPct) || 10, 1, 100)
    next.maxDailyTrades = clamp(Math.round(Number(next.maxDailyTrades) || 0), 0, 100)
    next.aiGate = Boolean(next.aiGate)
    next.proGate = Boolean(next.proGate)
    next.mtfGate = next.mtfGate !== false
    next.minMtfAgree = clamp(Math.round(Number(next.minMtfAgree) || 0), 0, 3)
    next.sentimentGate = Boolean(next.sentimentGate)
    next.minSentimentAlignment = clamp(Number(next.minSentimentAlignment) || 0.3, 0, 1)
    next.consensusGate = Boolean(next.consensusGate)
    next.minConsensusAgree = clamp(Math.round(Number(next.minConsensusAgree) || 4), 1, 7)
    next.consecutiveLossLimit = clamp(Math.round(Number(next.consecutiveLossLimit) || 3), 1, 20)
    next.consecutiveLossWindowMs = clamp(Math.round(Number(next.consecutiveLossWindowMs) || 1800000), 60000, 86400000)
    next.regimeShiftPause = next.regimeShiftPause !== false
    next.maxCandleAgeSec = clamp(Math.round(Number(next.maxCandleAgeSec) || 60), 10, 3600)
    next.timeframe = clamp(Math.round(Number(next.timeframe) || 60), 5, 3600)
    next.count = clamp(Math.round(Number(next.count) || 120), 30, 500)
    // Multi-asset scope: sanitize each entry (dedupe, cap, normalize). Entries
    // with enabled:false are KEPT so the suite's asset table remembers them.
    if (Array.isArray(next.assets)) {
      const seen = new Set()
      next.assets = next.assets
        .filter((a) => a && typeof a === "object" && String(a.assetId ?? "").trim())
        .map((a) => ({
          assetId: String(a.assetId).trim().toUpperCase().slice(0, 24),
          enabled: a.enabled !== false,
          duration: a.duration != null ? clamp(Math.round(Number(a.duration)), 5, 43200) : null,
          amount: a.amount != null && Number(a.amount) > 0 ? clamp(Number(a.amount), 1, 1000) : null,
          minConfidence: a.minConfidence != null && Number.isFinite(Number(a.minConfidence)) ? clamp(Number(a.minConfidence), 30, 95) : null
        }))
        .filter((a) => (seen.has(a.assetId) ? false : (seen.add(a.assetId), true)))
        .slice(0, 20)
      if (!next.assets.some((a) => a.assetId === next.assetId)) {
        next.assetId = next.assets[0]?.assetId ?? String(next.assetId || "BTCUSD").trim().toUpperCase()
      }
    } else {
      next.assets = []
    }
    if (next.assetLastEntryAt == null || typeof next.assetLastEntryAt !== "object" || Array.isArray(next.assetLastEntryAt)) {
      next.assetLastEntryAt = {}
    } else {
      const clean = {}
      for (const [k, v] of Object.entries(next.assetLastEntryAt)) {
        const t = Number(v)
        if (Number.isFinite(t) && t >= 0) clean[String(k).toUpperCase().slice(0, 24)] = Math.floor(t)
      }
      next.assetLastEntryAt = clean
    }
    if (typeof next.stopReason !== "string") next.stopReason = next.stopReason ?? null
    next.lastEntryAt = Math.max(0, Number(next.lastEntryAt) || 0)
    await writeJSON(CONFIG_FILE, next)
  })
  return getAutopilotConfig()
}

// ---------------------------------------------------------------------
// Circuit breakers
// ---------------------------------------------------------------------
//
// Two independent pauses that sit in front of every entry decision:
//
//   • Consecutive-loss breaker — trips when the accuracy ledger shows N
//     straight losses all inside one time window. It LATCHES: resuming only
//     once those losses age out of the window or a manual reset clears it
//     (a later win does not unlatch it early).
//
//   • Regime-shift breaker — when regimeDetection flags a change away from
//     the last stable regime, entries pause until the detector reports the
//     SAME new regime twice consecutively (2-reading stabilization).

const breakers = {
  lossTrippedUntil: 0,
  lossTrigger: null,
  lossManualHold: false
}

const regimeBreaker = {
  stable: null,
  candidate: null,
  candidateCount: 0,
  paused: false,
  lastTransition: null
}

export function evaluateLossBreaker(signalsNewestFirst, { limit = 3, windowMs = 30 * 60 * 1000, now = Date.now() } = {}) {
  const lim = Math.max(1, Math.round(Number(limit) || 3))
  const win = Math.max(1, Number(windowMs) || 1800000)
  let streak = 0
  let oldestLossAt = null
  for (const s of Array.isArray(signalsNewestFirst) ? signalsNewestFirst : []) {
    if (s?.resolution === "loss") {
      streak++
      oldestLossAt = s.resolvedAt ?? s.resolvedTs ?? null
    } else {
      break
    }
  }
  if (streak < lim) return { tripped: false, streak }
  const oldestMs = oldestLossAt != null ? new Date(oldestLossAt).getTime() : NaN
  if (!Number.isFinite(oldestMs)) return { tripped: true, streak, until: now + win }
  if (now - oldestMs > win) return { tripped: false, streak }
  return { tripped: true, streak, until: oldestMs + win, oldestLossAt }
}

let ledgerReadFailures = 0

/**
 * Re-evaluate the consecutive-loss latch from the accuracy ledger. Returns a
 * refusal reason while the breaker holds, or null when trading may proceed.
 * FAIL-CLOSED: if the ledger cannot be read the engine must NOT assume "no
 * losses" — repeated failures pause entries until the ledger answers again.
 */
async function checkLossBreaker(config, now = Date.now()) {
  let signals = []
  try {
    const acc = await signalAccuracy()
    signals = Array.isArray(acc?.recent) ? acc.recent : []
    ledgerReadFailures = 0
  } catch {
    ledgerReadFailures += 1
    if (ledgerReadFailures >= 2) {
      return `loss breaker cannot read the trade ledger (${ledgerReadFailures} consecutive failures) — entries paused for safety`
    }
    // One transient failure: use an empty set but remember — next failure blocks.
    signals = []
  }
  const evaluation = evaluateLossBreaker(signals, {
    limit: config.consecutiveLossLimit,
    windowMs: config.consecutiveLossWindowMs,
    now
  })
  if (!evaluation.tripped) {
    if (breakers.lossTrippedUntil > now) {
      return `consecutive-loss breaker latched — resumes at ${new Date(breakers.lossTrippedUntil).toISOString()} or via manual reset`
    }
    if (breakers.lossTrippedUntil) {
      breakers.lossTrippedUntil = 0
      breakers.lossTrigger = null
      console.log("[picc-autopilot] consecutive-loss breaker cleared — losses aged out of the window")
    }
    breakers.lossManualHold = false
    return null
  }
  if (breakers.lossManualHold) return null
  const until = evaluation.until ?? now + Number(config.consecutiveLossWindowMs)
  if (breakers.lossTrippedUntil <= now) {
    breakers.lossTrigger = {
      streak: evaluation.streak,
      limit: Number(config.consecutiveLossLimit),
      windowMs: Number(config.consecutiveLossWindowMs),
      oldestLossAt: evaluation.oldestLossAt ?? null,
      at: now
    }
    console.warn(
      `[picc-autopilot] consecutive-loss BREAKER TRIPPED — ${evaluation.streak} straight losses within ${Math.round(Number(config.consecutiveLossWindowMs) / 60000)} min (limit ${config.consecutiveLossLimit}); entries paused until ${new Date(until).toISOString()} or manual reset`
    )
  }
  breakers.lossTrippedUntil = Math.max(breakers.lossTrippedUntil, until)
  return `consecutive-loss breaker engaged (${evaluation.streak} straight losses inside ${Math.round(Number(config.consecutiveLossWindowMs) / 60000)} min)`
}

/**
 * Feed one regime reading into the shift breaker. A reading equal to the last
 * stable regime keeps trading open; any different reading starts a transition
 * (pause) that lasts until the NEW regime is seen twice consecutively.
 * Returns the post-update status; "unknown" readings are ignored entirely.
 */
export function updateRegimeBreaker(regime, now = Date.now()) {
  if (!regime || regime === "unknown") return regimeStatus()
  if (regimeBreaker.stable == null) {
    if (regimeBreaker.candidate !== regime) {
      regimeBreaker.candidate = regime
      regimeBreaker.candidateCount = 1
    } else {
      regimeBreaker.candidateCount++
      if (regimeBreaker.candidateCount >= 2) {
        regimeBreaker.stable = regime
        regimeBreaker.candidate = null
        regimeBreaker.candidateCount = 0
      }
    }
    return regimeStatus()
  }
  if (regime === regimeBreaker.stable) {
    if (regimeBreaker.paused || regimeBreaker.candidate) {
      console.log(`[picc-autopilot] regime-shift breaker resumed — regime stable at "${regime}"`)
    }
    regimeBreaker.candidate = null
    regimeBackToStable()
    return regimeStatus()
  }
  if (regimeBreaker.candidate !== regime) {
    regimeBreaker.candidate = regime
    regimeBreaker.candidateCount = 1
    regimeBreaker.lastTransition = { from: regimeBreaker.stable, to: regime, at: now }
    regimeBreaker.paused = true
    console.warn(
      `[picc-autopilot] regime-shift BREAKER PAUSED entries — transition ${regimeBreaker.stable} -> ${regime}; waiting for two stable "${regime}" readings`
    )
  } else {
    regimeBreaker.candidateCount++
    if (regimeBreaker.candidateCount >= 2) {
      console.log(
        `[picc-autopilot] regime-shift breaker resumed — "${regime}" confirmed stable after ${regimeBreaker.candidateCount} readings`
      )
      regimeBreaker.stable = regime
      regimeBreaker.candidate = null
      regimeBreaker.candidateCount = 0
      regimeBackToStable()
    }
  }
  return regimeStatus()
}

function regimeBackToStable() {
  regimeBreaker.paused = false
}

function regimeStatus() {
  return {
    stable: regimeBreaker.stable,
    candidate: regimeBreaker.candidate,
    candidateReadings: regimeBreaker.candidateCount,
    paused: Boolean(regimeBreaker.paused && regimeBreaker.candidate),
    lastTransition: regimeBreaker.lastTransition
  }
}

export function breakerStatus(now = Date.now()) {
  return {
    lossBreaker: {
      tripped: breakers.lossTrippedUntil > now,
      until: breakers.lossTrippedUntil > now ? new Date(breakers.lossTrippedUntil).toISOString() : null,
      trigger: breakers.lossTrigger
    },
    regimeBreaker: regimeStatus()
  }
}

/** Manual reset — clear both breaker latches immediately. The loss breaker
 *  stays disarmed (manual hold) until the losing streak actually clears, so a
 *  reset is not undone by the very next evaluation of an unchanged ledger.
 *  Pass { manualHold: false } for a clean-slate reset (tests). */
export function resetBreakers({ manualHold = true } = {}) {
  breakers.lossTrippedUntil = 0
  breakers.lossTrigger = null
  breakers.lossManualHold = Boolean(manualHold)
  regimeBreaker.stable = null
  regimeBreaker.candidate = null
  regimeBreaker.candidateCount = 0
  regimeBreaker.paused = false
  regimeBreaker.lastTransition = null
}

function emitAutopilotEvent(event, data) {
  import("./notificationCenter.mjs")
    .then((m) => m.emitEvent(event, data))
    .catch(() => {})
}

const riskNotify = { dayKey: null, approached: false, hit: false }

function maybeEmitRiskEvents(config, dayKey, dayStartBalance, pnl) {
  const startBal = Number(dayStartBalance)
  if (!Number.isFinite(startBal) || startBal <= 0) return
  const limitAbs = (Number(config.dailyLossLimitPct) / 100) * startBal
  if (!(limitAbs > 0)) return
  if (riskNotify.dayKey !== dayKey) {
    riskNotify.dayKey = dayKey
    riskNotify.approached = false
    riskNotify.hit = false
  }
  const drawdown = -Number(pnl)
  const data = {
    dayStartBalance: round2(startBal),
    dailyPnl: round2(Number(pnl)),
    limitPct: Number(config.dailyLossLimitPct),
    drawdown: round2(Math.max(0, drawdown))
  }
  if (drawdown >= limitAbs) {
    if (riskNotify.hit) return
    riskNotify.hit = true
    emitAutopilotEvent("risk.dailyLossHit", { ...data, thresholdPct: 100 })
  } else if (drawdown >= limitAbs * 0.8) {
    if (riskNotify.approached) return
    riskNotify.approached = true
    emitAutopilotEvent("risk.dailyLossApproached", { ...data, thresholdPct: 80 })
  }
}

// ---------------------------------------------------------------------
// Demo trades + session
// ---------------------------------------------------------------------

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

/** Serialized read of the deals file — never observes a torn/partial write. */
function readDealsSerialized() {
  return dealWrite.then(
    () => readJSON(DEALS_FILE, { deals: [] }),
    () => readJSON(DEALS_FILE, { deals: [] })
  )
}

async function recordDealLocked(deal) {
  const file = await readJSON(DEALS_FILE, { deals: [] })
  // Cross-session idempotency: during a session handover both sockets can
  // broadcast the same settlement. Without this dedupe the deal (and its
  // PnL) is recorded twice — a doubled loss stops trading early, a doubled
  // win masks real drawdown.
  if (deal.serverId != null && file.deals.some((d) => d.serverId === deal.serverId)) {
    return
  }
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
  await recordKelly(deal)
  await settleModelOutcomes(deal)
}

// ── Model-matrix online learning ────────────────────────────────────────────
// Votes are snapshotted per open deal at entry time; on settlement the
// outcome feeds each model's EMA win-rate, which drives its consensus weight.

const PENDING_VOTES_STORE = "modelMatrixPending"

function pendingVotesStore() {
  const store = localStore(PENDING_VOTES_STORE, { pending: {} })
  if (!store.data.pending || typeof store.data.pending !== "object") store.data.pending = {}
  return store
}

function stashModelVotes(serverId, votes) {
  try {
    if (!serverId || !Array.isArray(votes) || !votes.length) return
    const store = pendingVotesStore()
    store.data.pending[String(serverId)] = {
      votes: votes.map((v) => ({ short: v.short, direction: v.direction })),
      at: Date.now()
    }
    // Prune entries older than 7 days — unsettled deals shouldn't leak.
    for (const [id, entry] of Object.entries(store.data.pending)) {
      if (Date.now() - (entry.at ?? 0) > 7 * 86400_000) delete store.data.pending[id]
    }
    store.write()
  } catch { /* best-effort */ }
}

function settleModelOutcomes(deal) {
  try {
    const serverId = String(deal?.serverId ?? "")
    if (!serverId) return
    const store = pendingVotesStore()
    const entry = store.data.pending[serverId]
    if (!entry?.votes?.length) return
    delete store.data.pending[serverId]
    store.write()
    // Binary outcome direction: win for a call = price went up (and vice versa).
    const wentUp = deal.type === "put" ? deal.result === "loss" : deal.result === "win"
    recordModelOutcomes(entry.votes, wentUp)
  } catch { /* best-effort */ }
}

/**
 * Feed every settled demo deal into the Kelly criterion history so position
 * sizing is derived from real outcomes. Best-effort — never breaks settlement.
 */
async function recordKelly(deal) {
  try {
    const store = localStore("kelly", { history: [] })
    if (!Array.isArray(store.data.history)) store.data.history = []
    const profit = Number(deal.profit) || 0
    const stake = Number(deal.amount) || 0
    // Payout (b in the Kelly formula) is the per-contract win odds and must be
    // estimated from WINS ONLY. Storing 0 for losers made the snapshot's
    // `|| 1` coercion count every loss as a 100% payout, biasing avgPayout
    // upward and oversizing positions by ~25-45%.
    store.data.history.push({
      outcome: profit > 0 ? "win" : profit < 0 ? "loss" : "draw",
      win: profit > 0,
      stake,
      payout: profit > 0 && stake > 0 ? Math.round((profit / stake) * 100) / 100 : null,
      timestamp: Date.now()
    })
    if (store.data.history.length > 200) store.data.history = store.data.history.slice(-200)
    store.write()
  } catch (err) {
    console.warn(`[picc-autopilot] kelly history write failed: ${err?.message ?? err}`)
  }
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
  const file = await readDealsSerialized()
  const today = new Date().toISOString().slice(0, 10)
  return file.deals
    .filter((d) => (d.closedAt ?? "").startsWith(today))
    .reduce((s, d) => s + (Number(d.profit) || 0), 0)
}

/** Number of deals settled so far today — feeds the maxDailyTrades cap. */
async function todayTradeCount() {
  const file = await readDealsSerialized()
  const today = new Date().toISOString().slice(0, 10)
  return file.deals.filter((d) => (d.recordAt ?? "").startsWith(today)).length
}

async function defaultAmount(balance, riskPct, closes, times) {
  // Volatility-adjusted sizing: use GARCH/realized vol to scale position inversely
  if (Array.isArray(closes) && closes.length >= 30) {
    try {
      const rv = realizedVolatility(closes, { period: 20, times })
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
export function decideAutopilot({ config, pred, pro = null, mtf = null, sentiment = null, consensus = null, openCount = 0, lastEntryAt = 0, now = Date.now(), dailyPnl = 0, dayStartBalance = null, todayTrades = 0, aiVeto = false }) {
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

  // Multi-timeframe confluence gate: higher timeframes (5m, 15m) must
  // agree with the entry direction. Mismatches indicate noise/counter-trend.
  // When minMtfAgree is 0 (default), the gate passes if no MTF data is available
  // (e.g., after restart while buffers are seeding). Set minMtfAgree >= 1 to
  // require at least one higher-TF confirmation before trading.
  const minAgree = Number(config.minMtfAgree) || 0
  if (mtf && mtf.total > 0 && mtf.agree < minAgree) {
    return refuse(`MTF gate: insufficient higher-TF agreement (${mtf.agree}/${mtf.total} agree, min ${minAgree})`)
  }

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

  // Sentiment gate: when enabled, block trades if sentiment strongly opposes
  // the signal direction. Only active when sentiment data is available.
  if (config.sentimentGate && sentiment) {
    const score = Number(sentiment.score) || 0
    const dirSign = pred.direction === "up" ? 1 : pred.direction === "down" ? -1 : 0
    const aligned = score * dirSign > 0
    const minAlign = Number(config.minSentimentAlignment) || 0.3
    if (Math.abs(score) >= minAlign && !aligned) {
      return refuse(`sentiment gate: ${score > 0 ? "bullish" : "bearish"} sentiment opposes ${pred.direction} signal (score ${score.toFixed(2)})`)
    }
  }

  // Model-matrix consensus gate: the multiplexing model battery must agree
  // with the entry direction by at least minConsensusAgree models.
  if (config.consensusGate) {
    const minModels = Math.max(1, Math.round(Number(config.minConsensusAgree) || 4))
    if (!consensus || !consensus.ok) return refuse("consensus gate: model matrix unavailable")
    const dirMatches = consensus.consensus?.direction === pred.direction
    const agree = consensus.consensus?.agree ?? 0
    if (!dirMatches) {
      return refuse(`consensus gate: matrix says ${consensus.consensus?.direction ?? "flat"}, ensemble says ${pred.direction}`)
    }
    if (agree < minModels) {
      return refuse(`consensus gate: only ${agree}/${consensus.consensus?.total ?? "?"} models agree (min ${minModels})`)
    }
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
  // Prompt template lives in prompts.mjs (versioned) — patterns P3/P4/P5 of
  // docs/PROMPT_PATTERNS.md: role/rules/policy blocks, fail-open on missing
  // context, one-word verdict.
  const p = aiGatePrompts({
    direction: pred.direction,
    confidence: pred.confidence,
    models: pred.models,
    reason: pred.note ?? pred.reason,
    assetId: pred.assetId
  })
  try {
    const out = await chatText(p.system, p.user)
    return /approve/i.test(String(out ?? ""))
  } catch {
    return true
  }
}

let tickInFlight = false

export async function getSessionLive() {
  // Leg 0: an authenticated gateway session IS a live session — the broker
  // validated the token at connect and keeps the socket alive.
  try {
    if (state.session && state.session.connected) {
      return { live: true, reason: "authenticated gateway session active", url: null, via: "gateway-session" }
    }
  } catch { /* ignore */ }
  try {
    const { checkExpertOptionSessionLive } = await import("./browserStudio.mjs")
    const studioCheck = checkExpertOptionSessionLive()
    if (studioCheck.live) return { ...studioCheck, via: "studio" }
    var studioReason = studioCheck.reason
  } catch { var studioReason = "studio browser unavailable" }
  try {
    const { liveEOStats } = await import("./liveEO.mjs")
    const upAt = Number(liveEOStats()?.upstream?.lastAt) || 0
    if (upAt && Date.now() - upAt < 60_000) {
      return { live: true, reason: "extension feed streaming from your browser", url: null, via: "extension" }
    }
  } catch { /* ignore */ }
  return { live: false, reason: studioReason, url: null, via: "none" }
}

/** Cached liveness for status endpoints — refreshed by the scheduler job. */
export function cachedSessionLive() {
  return { sessionLive: state.sessionLive, sessionLiveReason: state.sessionLiveReason }
}

export function refreshSessionLiveCache(verdict) {
  state.sessionLive = Boolean(verdict?.live)
  state.sessionLiveReason = String(verdict?.reason ?? "")
  return cachedSessionLive()
}

/**
 * One autopilot pass across EVERY enabled asset.
 *
 * Shared preconditions (token/demo/session/liveness/balance/day-reset/loss
 * breaker/daily caps) are evaluated ONCE — they are account-level facts. The
 * per-asset pipeline (candles → freshness → prediction → gates → decision →
 * order) then runs for each target, honoring per-asset overrides for duration,
 * amount and min-confidence, and per-asset cooldowns via assetLastEntryAt.
 * maxConcurrent is enforced across ALL assets combined (open-deal budget).
 */
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
    sessionLive: state.sessionLive,
    sessionLiveReason: state.sessionLiveReason,
    sessionError: state.sessionError,
    balance,
    currency,
    openDeals: open.map((d) => ({ ...d })),
    settled: file.deals.slice(0, 20),
    todayPnl: round2(await todayPnl()),
    todayTrades: await todayTradeCount(),
    autopilot: {
      ...config,
      running: false, // execution removed — advisory-only
      // Resolved per-asset scope: what the engine will actually trade.
      assetScope: enabledAssetTargets(config).map((t) => ({
        assetId: t.assetId,
        duration: t.duration ?? config.duration,
        amount: t.amount ?? config.amount,
        minConfidence: t.minConfidence ?? config.minConfidence
      })),
      lastRun: state.lastRun,
      lastDecision: state.lastDecision,
      decisionWindow: getAutopilotDecisions(50).window,
      dataHealth: state.dataHealth,
      breakers: breakerStatus()
    }
  }
}

/**
 * Phase 11 — go-live READINESS REPORT (the honest gate before demo → real).
 * This is decision support, NOT an unlock: PICC has no live-trading path at
 * all. It aggregates the evidence you asked for: enough resolved decisions,
 * realized win-rate durably above the instrument's breakeven, calibration
 * adequacy per confidence bucket, feed reliability over 24h, and data-source
 * health. Blockers = do not even think about real money yet; warnings =
 * proceed-with-humility items.
 */
export async function tradingReadiness() {
  const blockers = []
  const warnings = []
  const facts = {}

  // Demo-only reminder — always present, never removable.
  warnings.push("Demo results are a hypothesis about live conditions, not proof: fills, psychology, and account-level scrutiny all differ once real money is involved.")

  let resolvedCount = 0
  try {
    const { ledgerStats } = await import("./accuracyLedger.mjs")
    const stats = ledgerStats()
    facts.decisionsResolved = stats.resolved
    facts.hitRate = stats.hitRate
    facts.calibrationEdge = stats.edge
    resolvedCount = Number(stats.resolved) || 0
    if (resolvedCount < 200) {
      blockers.push(`only ${resolvedCount} resolved decisions — need ≥200 for a statistically meaningful sample`)
    } else if (resolvedCount < 500) {
      warnings.push(`${resolvedCount} resolved decisions is a thin-but-usable sample; 500+ preferred`)
    }
    if (resolvedCount >= 100 && stats.hitRate == null) {
      blockers.push("no measurable hit rate despite resolved history")
    }
    if (stats.edge != null && stats.edge <= 0 && resolvedCount >= 200) {
      blockers.push(`realized-vs-predicted EV edge is ${stats.edge.toFixed(3)} (≤0): the engine is not beating its own predictions`)
    }
    try {
      const { getCalibrationSummary } = await import("./calibration.mjs")
      const cal = getCalibrationSummary()
      facts.calibration = {
        totalResolved: cal?.totalResolved ?? null,
        adequacy: cal?.adequacy ?? null,
        calibrationGap: cal?.calibrationGap ?? null
      }
      if (cal?.adequacy === "insufficient") {
        warnings.push("calibration buckets marked insufficient — confidence numbers are not yet trustworthy")
      }
      if (cal?.calibrationGap != null && cal.calibrationGap < -0.08) {
        blockers.push(`engine is overconfident: realized win-rate runs ${(Math.abs(cal.calibrationGap) * 100).toFixed(1)} pts below predicted`)
      }
    } catch { /* calibration module unavailable */ }
  } catch {
    blockers.push("accuracy ledger unavailable")
  }

  // Breakeven vs realized, using the payout actually offered.
  try {
    const creds = await getCredentials()
    facts.demoMode = Boolean(creds.expertoptionDemo)
    if (!creds.expertoptionDemo) {
      blockers.push("demo mode is OFF in credentials — this report is only meaningful in demo mode")
    }
    void creds
    const dealsFile = await readJSON(DEALS_FILE, { deals: [] })
    const withPayout = (dealsFile.deals || []).find((d) => d.payout != null)
    const payoutPct = Number(withPayout?.payout) || 82
    facts.payoutPct = payoutPct
    // Binary breakeven win rate: 1 / (1 + payout) as a fraction of stake.
    const breakeven = 1 / (1 + payoutPct / 100)
    facts.breakevenWinRatePct = Math.round(breakeven * 1000) / 10
    try {
      const file = await readDealsSerialized()
      const today = new Date().toISOString().slice(0, 10)
      const recent = (file.deals || []).filter((d) => (d.recordAt ?? "").startsWith(today))
      const wins = recent.filter((d) => d.result === "win").length
      const losses = recent.filter((d) => d.result === "loss").length
      if (wins + losses >= 20) {
        facts.todayWinRatePct = Math.round((wins / (wins + losses)) * 1000) / 10
        if (facts.todayWinRatePct <= breakeven * 100) {
          warnings.push(`today's demo win rate (${facts.todayWinRatePct}%) is at/below the ${(breakeven * 100).toFixed(1)}% breakeven for ${payoutPct}% payout`)
        }
      }
    } catch { /* deal history unavailable */ }
  } catch { /* credentials unavailable */ }

  // Feed reliability.
  try {
    const { sessionUptime24h } = await import("./scheduler.mjs")
    const up = sessionUptime24h()
    facts.uptime24h = up
    if (up.samples >= 60) {
      if ((up.livePct ?? 0) < 80) blockers.push(`live-session uptime over ${up.windowHours}h is only ${up.livePct}% — fix feed reliability first`)
      else if ((up.livePct ?? 0) < 95) warnings.push(`live-session uptime ${up.livePct}% — decent but not rock-solid`)
    } else {
      warnings.push("less than 30 minutes of uptime samples — reliability is unmeasured")
    }
  } catch { /* scheduler unavailable */ }

  // Data source health.
  try {
    const { collectSourceStatuses } = await import("./dataSources.mjs")
    const sources = collectSourceStatuses()
    const problems = Object.entries(sources).filter(([, s]) => s?.status === "unconfigured" || s?.status === "stale").map(([k]) => k)
    facts.degradedSources = problems
    if (problems.includes("candles")) blockers.push("candle feed is unconfigured/stale — no live data behind any number")
    else if (problems.length) warnings.push(`degraded sources: ${problems.join(", ")}`)
  } catch { /* ignore */ }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    readyForRealConsideration: blockers.length === 0,
    blockers,
    warnings,
    facts
  }
}

/** Test hook — wipe config + demo deals and drop the socket. */
export async function _resetAutopilotData() {
  await writeJSON(CONFIG_FILE, { ...DEFAULTS })
  await writeJSON(DEALS_FILE, { deals: [] })
  state.lastRun = null
  state.lastDecision = null
  state.decisionLog = []
  state.dataHealth = "unknown"
  resetBreakers({ manualHold: false })
}

/**
 * Phase 14 — dry-run decision support: run the FULL gate chain against
 * current data and report exactly what would happen, WITHOUT placing any
 * order, waiting the review delay, or mutating breaker/latch/config state.
 * This is what powers the "why would it trade right now?" button.
 *
 * KEEP IN SYNC with runAutopilotTick()'s data-gathering sequence — the value
 * of this feature is that its answer matches what the next real tick would do.
 */
export async function whyAutopilot({ assetId } = {}) {
  const config = { ...(await getAutopilotConfig()) }
  if (assetId) {
    config.assetId = String(assetId).trim().toUpperCase() || config.assetId
  }
  // Honor per-asset overrides (duration/amount/min-confidence) for the
  // evaluated asset so the dry-run matches what a real tick would decide.
  Object.assign(config, configForAsset(config, { assetId: config.assetId }))
  const gates = []
  const note = (name, pass, detail) => gates.push({ name, pass: Boolean(pass), detail: detail ?? null })

  note("enabled", config.enabled, config.enabled ? null : "autopilot disabled")

  const creds = await getCredentials()
  note("token", Boolean(creds.expertoptionToken), creds.expertoptionToken ? null : "no token configured")
  note("demo-only", Boolean(creds.expertoptionDemo), creds.expertoptionDemo ? null : "demo mode disabled")
  if (!config.enabled || !creds.expertoptionToken || !creds.expertoptionDemo) {
    return { ok: true, dryRun: true, wouldTrade: false, gates, reason: "precondition failed" }
  }

  // Liveness (read-only cache refresh is fine here).
  const liveVerdict = await getSessionLive()
  refreshSessionLiveCache(liveVerdict)
  note("liveness", liveVerdict.live, `${liveVerdict.via}: ${liveVerdict.reason}`)

  let balance = 0
  try {
    const session = await ensureSession()
    balance = (await session.balance()).balance ?? 0
    note("session", true, `balance ${balance}`)
    var sessionRef = session
  } catch (err) {
    note("session", false, `balance fetch failed: ${err?.message ?? err}`)
    return { ok: true, dryRun: true, wouldTrade: false, gates, reason: "session unreachable" }
  }

  let raw = null
  try {
    raw = await sessionRef.candles(config.assetId, config.timeframe, config.count)
  } catch (err) {
    note("candles", false, `candle fetch failed: ${err?.message ?? err}`)
    return { ok: true, dryRun: true, wouldTrade: false, gates, reason: "candle fetch failed" }
  }
  const { closes, ohlc } = candlesFrom(raw)
  note("candles", closes.length >= 30, `${closes.length} bars`)
  if (closes.length < 30) return { ok: true, dryRun: true, wouldTrade: false, gates, reason: "not enough candles" }

  // Freshness mirror of the tick guard.
  const newestCandleSec = Number(ohlc[ohlc.length - 1]?.time)
  const tfSec = Math.max(1, Math.round(Number(config.timeframe) || 60))
  let fresh = true
  if (Number.isFinite(newestCandleSec) && newestCandleSec > 1_000_000_000 && Number(config.maxCandleAgeSec) > 0) {
    fresh = Math.floor(Date.now() / 1000) <= newestCandleSec + tfSec + Number(config.maxCandleAgeSec)
  }
  note("freshness", fresh, fresh ? null : "candle data stale")

  const pred = predictDirection(closes, 3, { maxWindows: 200 })
  note("signal", Boolean(pred.direction && pred.direction !== "flat"), `${pred.direction ?? "flat"} @ ${pred.confidence ?? "?"}%`)

  let pro = null
  if (config.proGate) {
    try {
      pro = proAnalyzeCandles({ candles: ohlc, symbol: config.assetId, timeframe: `${config.timeframe}s`, horizonDays: 3 })
      if (!pro.ok) pro = null
    } catch { pro = null }
  }

  const pnl = await todayPnl()
  const todayTrades = await todayTradeCount()

  // Breakers evaluated WITHOUT mutating their latch state (pure evaluation).
  const regimeNow = regimeStatus()
  note(
    "regime-breaker",
    !(config.regimeShiftPause && regimeNow.paused),
    regimeNow.paused ? `${regimeNow.stable} -> ${regimeNow.candidate} pending stabilization` : null
  )
  let lossSignals = []
  try {
    const acc = await signalAccuracy()
    lossSignals = Array.isArray(acc?.recent) ? acc.recent : []
  } catch { /* treat as empty */ }
  const lossEval = evaluateLossBreaker(lossSignals, { limit: config.consecutiveLossLimit, windowMs: config.consecutiveLossWindowMs })
  const lossBlocked = lossEval.tripped || breakers.lossTrippedUntil > Date.now()
  note("loss-breaker", !lossBlocked, lossBlocked ? `streak ${lossEval.streak}/${config.consecutiveLossLimit}` : null)

  const aiVeto = config.aiGate ? !(await aiConsents(pred)) : false
  note("ai-gate", !aiVeto, config.aiGate ? (aiVeto ? "AI vetoed the signal" : "AI consents") : "off")

  let mtf = null
  if (config.mtfGate !== false) {
    try {
      const eoData = liveEOData()
      const asset = (eoData.assets || []).find((a) => a.id === config.assetId)
      if (asset) {
        const dir = pred.direction === "down" ? -1 : pred.direction === "up" ? 1 : 0
        mtf = quickMtfCheck(asset, dir)
      }
    } catch { /* skip */ }
  }
  note("mtf-gate", true, mtf ? `agree ${mtf.agree}/${mtf.total}` : "no MTF data (skipped)")

  let sent = null
  if (config.sentimentGate) {
    try {
      const { getSentiment } = await import("./sentimentEngine.mjs")
      sent = await getSentiment(config.assetId)
    } catch { /* skip */ }
  }

  const decision = decideAutopilot({
    config,
    pred,
    pro,
    mtf,
    sentiment: sent,
    openCount: sessionRef.deals().length,
    lastEntryAt: config.lastEntryAt || 0,
    now: Date.now(),
    dailyPnl: pnl,
    dayStartBalance: config.dayStartBalance,
    todayTrades,
    aiVeto
  })

  return {
    ok: true,
    dryRun: true,
    wouldTrade: Boolean(decision.trade),
    reason: decision.trade ? decision.reason : decision.reason,
    direction: decision.direction ?? null,
    confidence: decision.confidence ?? null,
    assetId: config.assetId,
    balance,
    openDeals: sessionRef.deals().length,
    todayTrades,
    todayPnl: round2(pnl),
    durationSec: config.duration,
    signalNote: pred.note ?? null,
    gates
  }
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
// DEPRECATED (execution removal): bootstrapAutopilot, autopilotTick,
// runAutopilotTick, startAutopilot/stopAutopilot and placeDemoTrade were
// removed — PICC is advisory-first. The dry-run evaluator (whyAutopilot),
// decision log, config/scope APIs and read-only demo history remain as the
// Signal Engine's foundation. See docs/TRADING_MULTIPLATFORM_ROADMAP.md.
// ---------------------------------------------------------------------
