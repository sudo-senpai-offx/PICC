import { nextRegimeState, resolveStructureLevels, sessionInWindow, blackoutViolations, spreadGateF1, correlationBlocked } from "./fourFactor.mjs"
import { adx as computeAdx, atr as computeAtr, ema as computeEma } from "./indicators.mjs"
import { voteTrend, voteMomentum, voteStructure, voteVolatility } from "./mtfConvergence.mjs"
import { percentileOfLast } from "./contextCoordinates.mjs"
import { calendarImpactSummary } from "./economicCalendar.mjs"

export const REQ_CTX_5_BLACKOUT_MIN = 15

export const REQ_CTX_1_ADX_PERIOD = 14
export const REQ_CTX_7_ATR_PERIOD = 14
export const REQ_CTX_7_MIN_BARS = 30
export const REQ_CTX_6_MAX_SPREAD_PIPS = 1.5
export const REQ_CTX_6_CORRELATION_PAUSE_MS = 900000

function round2(x) {
  return Math.round(x * 100) / 100
}

// ---------------------------------------------------------------------
// REQ-CTX-1 — ADX(14) trend + Regime-3 Chop halt.
// Re-homes the existing nextRegimeState latch (fourFactor.mjs): chop
// latches on a sub-threshold reading and re-arms after confirmBars
// consecutive above-threshold readings (anti-flicker). Trend direction
// comes from +DI/-DI (ADX is direction-blind). Honest when bars are short.
// ---------------------------------------------------------------------
export function adxChop({ highs, lows, closes, state = { chop: false, streak: 0 }, threshold = 25, confirmBars = 2 } = {}) {
  const res = computeAdx(highs, lows, closes, REQ_CTX_1_ADX_PERIOD)
  const last = Array.isArray(closes) ? closes.length - 1 : -1
  const adxVal = res?.adx?.[last]
  if (adxVal == null || !Number.isFinite(adxVal)) {
    return {
      available: false,
      adx: null,
      plusDI: null,
      minusDI: null,
      tier: "none",
      chop: false,
      trend: "n/a",
      nextState: { ...state },
      reason: "insufficient bars for ADX(14)"
    }
  }
  const plusDI = res.plusDI?.[last] ?? null
  const minusDI = res.minusDI?.[last] ?? null
  const tier = adxVal > 40 ? "extreme" : adxVal > 25 ? "trend" : adxVal > 20 ? "forming" : "no-trend"
  const good = adxVal >= threshold
  const nextState = nextRegimeState(state, good, confirmBars)
  const trend = plusDI > minusDI ? "up" : minusDI > plusDI ? "down" : "flat"
  return {
    available: true,
    adx: round2(adxVal),
    plusDI: plusDI != null ? round2(plusDI) : null,
    minusDI: minusDI != null ? round2(minusDI) : null,
    tier,
    chop: nextState.chop,
    trend,
    nextState,
    confirmBars
  }
}

// ---------------------------------------------------------------------
// REQ-CTX-2 — 4H/daily S/R register. Re-homes resolveStructureLevels
// (fourFactor.mjs) which enforces the min-history guards internally; thin
// honesty wrapper on top (unavailable when the inputs could never yield a
// plane, or when price/pipSize are absent).
// ---------------------------------------------------------------------
export function structureRegister({ hourlyCandles = null, dailyCandles = null, price, pipSize, tolerancePips = 10 } = {}) {
  const p = Number(price)
  if (price == null || !Number.isFinite(p) || pipSize == null) {
    return {
      available: false,
      sources: "none",
      call: { hit: false, legs: [] },
      put: { hit: false, legs: [] },
      legs: {},
      reason: "no price/pipSize supplied — structure unavailable"
    }
  }
  const resolved = resolveStructureLevels({ hourlyCandles, dailyCandles, price: p, pipSize, tolerancePips })
  const anyLeg = resolved.sources !== "none"
  return {
    ...resolved,
    available: anyLeg,
    reason: anyLeg ? undefined : "no S/R plane derivable (min-history guards) — structure unavailable"
  }
}

// ---------------------------------------------------------------------
// REQ-CTX-3 — MTF HTF bias register. Composes the existing per-dimension
// MTF voters (mtfConvergence.mjs) over each caller-supplied timeframe's
// indicator dashboard + swings. Register-only semantics: it reports how the
// HTFs are aligned, it NEVER vetoes — the register says what the vote
// distribution is (agreed/conflicted), the caller decides what to do.
// Honest: a TF with unobserved voters still appears, flagging exactly which
// dimensions had no read.
// ---------------------------------------------------------------------
export function biasRegister({ byTf = {} } = {}) {
  const tfs = Object.keys(byTf)
  if (tfs.length === 0) {
    return { available: false, register: {}, agreed: 0, conflicted: 0, reason: "no TF inputs supplied" }
  }
  const register = {}
  let totalAgreed = 0
  let totalConflicted = 0
  for (const tf of tfs) {
    const input = byTf[tf] || {}
    const d = input.dash || {}
    const votes = {
      trend: voteTrend(d),
      momentum: voteMomentum(d),
      structure: voteStructure(input.swings, input.lastIndex),
      volatility: voteVolatility(d)
    }
    register[tf] = votes
    const observed = Object.values(votes).filter((v) => v.observed && v.value != null && v.value !== 0)
    const pos = observed.filter((v) => v.value > 0).length
    const neg = observed.filter((v) => v.value < 0).length
    totalAgreed += Math.max(pos, neg)
    totalConflicted += Math.min(pos, neg)
  }
  return {
    available: true,
    register,
    agreed: totalAgreed,
    conflicted: totalConflicted,
    reason: tfs.map((tf) => `${tf}:${Object.keys(register[tf]).length}dim`).join(",")
  }
}

// ---------------------------------------------------------------------
// REQ-CTX-4 — EMA400 top-down context register. For each caller-supplied
// plane, price-vs-MA400 chain establishes the HTF bias. Honest: fewer than
// 400 closed bars means the 400-EMA is not meaningful → that plane is
// reported unavailable (never invented). Register only — a context read,
// never a trigger; provenance ("aggregate-plan", "caller-supplied", ...) is
// caller-declared because this register cannot derive it.
// ---------------------------------------------------------------------
export function ema400Context({ planes = {}, sourceByTf = {} } = {}) {
  const register = {}
  const unavailable = []
  for (const [tf, candles] of Object.entries(planes)) {
    if (!Array.isArray(candles) || candles.length === 0) continue
    if (candles.length < 400) {
      unavailable.push(`${tf}:<400 bars`)
      continue
    }
    const closes = candles.map((c) => Number(c?.close))
    const ma100 = computeEma(closes, 100)
    const ma200 = computeEma(closes, 200)
    const ma400 = computeEma(closes, 400)
    const last = candles.length - 1
    const price = Number(closes[last])
    const p400 = ma400?.[last]
    const p200 = ma200?.[last]
    const p100 = ma100?.[last]
    const chainMeasured = [price, p400, p200, p100].every((v) => v != null && Number.isFinite(v))
    if (!chainMeasured) {
      unavailable.push(`${tf}:ema chain incomplete`)
      continue
    }
    const longContext = price >= p400 && p200 >= p400
    const shortContext = price <= p400 && p200 <= p400
    register[tf] = {
      price,
      ma400: p400,
      ma200: p200,
      ma100: p100,
      longContext,
      shortContext,
      available: true,
      source: sourceByTf[tf] ?? "caller-supplied",
      candles: candles.length
    }
  }
  const reason = unavailable.length > 0 ? unavailable.join("; ") : undefined
  const measured = Object.keys(register).length > 0
  if (!measured) {
    return { available: false, register: {}, reason: reason ?? "no measurable planes supplied" }
  }
  return { available: true, register, reason }
}

// ---------------------------------------------------------------------
// REQ-CTX-7 — volatility regime classifier + size cut. The current ATR(14)
// is ranked against its own trailing window: top crown (>0.7) → HIGH with a
// 50% size cut; bottom (<0.3) → LOW; else NORMAL. Mirrors the existing
// detectMarketPhase percentile read but reuses the shared percentileOfLast
// helper. Honest on short/finite-only series; the size cut is a default a
// consumer may override.
// ---------------------------------------------------------------------
export function volatilityRegime({ candles = [], window = 100, highCutPct = 0.5 } = {}) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { available: false, regime: "NORMAL", percentile: null, sizeCutPct: null, atr: null, reason: "no candles supplied" }
  }
  const highs = candles.map((c) => Number(c?.high))
  const lows = candles.map((c) => Number(c?.low))
  const closes = candles.map((c) => Number(c?.close))
  const a = computeAtr(highs, lows, closes, REQ_CTX_7_ATR_PERIOD)
  const last = candles.length - 1
  const atrNow = a?.[last]
  if (!Number.isFinite(atrNow)) {
    return { available: false, regime: "NORMAL", percentile: null, sizeCutPct: null, atr: null, reason: "insufficient candles for ATR(14)" }
  }
  const finite = a.filter((v) => v != null && Number.isFinite(v))
  if (finite.length < REQ_CTX_7_MIN_BARS) {
    return {
      available: false,
      regime: "NORMAL",
      percentile: null,
      sizeCutPct: null,
      atr: atrNow,
      reason: `insufficient ATR samples (${finite.length}) — need at least ${REQ_CTX_7_MIN_BARS}`
    }
  }
  const { percentile } = percentileOfLast(finite, { window })
  let regime = "NORMAL"
  if (percentile > 0.7) regime = "HIGH"
  else if (percentile < 0.3) regime = "LOW"
  return {
    available: true,
    regime,
    percentile: Math.round(percentile * 100) / 100,
    sizeCutPct: regime === "HIGH" ? highCutPct : null,
    atr: Math.round(atrNow * 100) / 100,
    reason: undefined
  }
}

// Calendar event times are treated as UTC wall-clock (faireconomy feed times
// are GMT) — same documented assumption as fourFactor.blackoutViolations.
function contextEventAtMs(e) {
  return Date.parse(`${e.date}T${e.time}:00Z`)
}

// ---------------------------------------------------------------------
// REQ-CTX-5 — dead-zone / red-folder session classes. Re-homes
// sessionInWindow + blackoutViolations (fourFactor.mjs) and reports an
// upcoming high-impact slice derived from nowMs (deterministic; the upstream
// upcomingHighImpact anchors to the real clock, which a pure register must
// not do). Honesty: when events is null there was no calendar read at all →
// source "fallback-schedule", and the classifier reports the session window
// but never fabricates news.
// ---------------------------------------------------------------------
export function sessionClassify({ tz, start, end, nowMs = Date.now(), events = [], currencies = [], days = 7 } = {}) {
  const observed = Array.isArray(events)
  const window = sessionInWindow({ tz, start, end }, nowMs)
  const list = observed ? events : []
  const blackout = blackoutViolations({ events: list, nowMs, minutes: REQ_CTX_5_BLACKOUT_MIN, currencies })
  const upcoming = observed
    ? list
        .filter((e) => String(e.impact ?? "").toLowerCase() === "high")
        .map((e) => ({ ...e, atMs: contextEventAtMs(e) }))
        .filter((e) => Number.isFinite(e.atMs) && e.atMs >= nowMs && e.atMs <= nowMs + days * 86_400_000)
        .sort((a, b) => a.atMs - b.atMs)
        .map((e) => ({ date: e.date, time: e.time, currency: e.currency, event: e.event, impact: e.impact, atMs: e.atMs }))
    : []
  const redFolder = blackout.blocked
  const deadZone = !window.ok
  let label = "normal"
  if (redFolder && deadZone) label = "red-folder+dead-zone"
  else if (redFolder) label = "red-folder"
  else if (deadZone) label = "dead-zone"
  let reason
  if (redFolder && deadZone) reason = `blackout (${blackout.hits.length} hits) + closed session`
  else if (redFolder) reason = `blackout ${blackout.hits.length}min away`
  else if (deadZone) reason = `outside session ${start}-${end}`
  return {
    available: true,
    label,
    source: observed ? "observed" : "fallback-schedule",
    window,
    blackout,
    upcoming,
    summary: observed ? calendarImpactSummary(list) : { total: 0, high: 0, medium: 0, low: 0, currencies: [], nextHigh: null },
    reason
  }
}

// ---------------------------------------------------------------------
// REQ-CTX-6 — F1 safety gates re-homed. Each gate wraps the existing
// fourFactor implementation (sessionInWindow, spreadGateF1,
// blackoutViolations, correlationBlocked) so the tested behavior is reused
// byte-for-byte; this register only composes them and reports honesty.
// `ok` is the strict AND of every gate.
// ---------------------------------------------------------------------
export function f1GateRegister({
  assetId,
  spread,
  maxSpreadPips = REQ_CTX_6_MAX_SPREAD_PIPS,
  losses = [],
  correlations = {},
  session = {},
  sessionType = null,
  news = {},
  nowMs = Date.now(),
  currencies = [],
  events = []
} = {}) {
  const spreadGate = spreadGateF1(spread, maxSpreadPips, nowMs)
  const sessionGate = session.ok === true ? { ok: true, check: "open", reason: undefined } : sessionInWindow(session, nowMs)
  const newsGate = { blocked: Boolean(news?.blocked), hits: news?.hits ?? [], check: news?.blocked ? "blocked" : "clear", reason: undefined }
  const correlationGate = correlationBlocked({ assetId, losses, correlations, nowMs })
  const checks = {
    session: { ok: sessionGate.ok, check: sessionGate.ok ? "open" : sessionGate.check ?? "closed", reason: sessionGate.reason },
    spread: { ok: spreadGate.ok, check: spreadGate.check, reason: spreadGate.reason, spreadPips: spreadGate.spreadPips, source: spreadGate.source },
    news: { ok: !newsGate.blocked, check: newsGate.check, reason: newsGate.reason, hits: newsGate.hits },
    correlation: { ok: !correlationGate.blocked, blocked: correlationGate.blocked, triggeredBy: correlationGate.triggeredBy, pauseMs: correlationGate.pauseMs, reason: undefined }
  }
  const ok = sessionGate.ok === true && spreadGate.ok === true && !newsGate.blocked && !correlationGate.blocked
  const reasons = []
  if (sessionGate.ok !== true) reasons.push(checks.session.reason ?? `session ${checks.session.check}`)
  if (spreadGate.ok !== true) reasons.push(spreadGate.reason ?? "spread gate closed")
  if (newsGate.blocked) reasons.push("news blackout")
  if (correlationGate.blocked) reasons.push(`correlation lock ${correlationGate.triggeredBy}`)
  return {
    ok,
    sessionType: sessionType?.label ?? "unknown",
    checks,
    reasons: reasons.length ? reasons : ["all F1 gates open"]
  }
}

// ---------------------------------------------------------------------
// assembleRegime — single envelope for the Context/Regime layer. Each
// register stays independent and honest; this only folds them together and
// stamps one `sources` map so a consumer can tell where every register came
// from (REQ-CTX-n tags). No vetoes here — it is a composition boundary.
// ---------------------------------------------------------------------
export function assembleRegime({
  highs,
  lows,
  closes,
  state = {},
  planes = {},
  sourceByTf = {},
  candles = [],
  byTf = {},
  structure = {},
  session = {},
  f1 = {},
  spread,
  maxSpreadPips,
  losses = [],
  correlations = {},
  news = {},
  events = [],
  currencies = [],
  vol = {},
  nowMs = Date.now()
} = {}) {
  const adx = adxChop({ highs, lows, closes, state })
  const struct = f1.structureForwarded
    ? structure
    : structureRegister({
        hourlyCandles: structure.hourlyCandles,
        dailyCandles: structure.dailyCandles,
        price: structure.price,
        pipSize: structure.pipSize,
        tolerancePips: structure.tolerancePips
      })
  const bias = biasRegister({ byTf })
  const ema = ema400Context({ planes, sourceByTf })
  const volatility = volatilityRegime({ candles, ...vol })
  const sessionReg = sessionClassify({ ...session, nowMs, events, currencies })
  const f1Gate = f1.forwarded
    ? f1
    : f1GateRegister({
        assetId: structure.assetId,
        spread,
        maxSpreadPips,
        losses,
        correlations,
        session: { ok: sessionReg.window.ok },
        news,
        nowMs,
        currencies,
        events
      })
  const registers = { adx, structure: struct, bias, ema400: ema, vol: volatility, session: sessionReg }
  const sources = {
    adx: "fourFactor.nextRegimeState + indicators.adx (REQ-CTX-1)",
    structure: struct.sources ?? "none (REQ-CTX-2)",
    bias: "mtfConvergence voters (REQ-CTX-3)",
    ema400: "caller-supplied planes (REQ-CTX-4)",
    vol: "indicators.atr + percentileOfLast (REQ-CTX-7)",
    session: "fourFactor.sessionInWindow + blackoutViolations (REQ-CTX-5)",
    f1: "fourFactor.spreadGateF1/correlationBlocked + session gate (REQ-CTX-6)"
  }
  return { registers, f1: f1Gate, sources, at: nowMs }
}