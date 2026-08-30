// U4FA 4-factor engine — pure pipeline. Spec docs/specs/PICC_UNIVERSAL_4FA_ENGINE.md
// M1/M2/M3 + T3..T8. Advisory decision-support only; nothing here executes trades.
//
// Pipeline order is hard (blueprint): F1 -> F2 -> F3 -> F4. F1-F3 failures return
// NEUTRAL (NO_TRADE) with the failing factor + honest reason; F4 evaluates only
// when F1-F3 pass; >= 2 of 3 boosters -> TRADE, else OBSERVE (blueprint "no
// majority" -> no signal).
//
// Honesty (G2): every unverifiable input (spread, D1 levels, calendar source)
// degrades to unavailable/abort with a truthful reason string. Nothing here is
// zero-filled to pass a gate.
//
// Pure + dependency-light: no network, no file IO. The caller supplies the data
// (live layer feeds candles/calendar/spread; the integration seam is T9).

import { sma, ema, adx, bollinger, stochRSI, candleArrays, supportResistance, atr } from "./indicators.mjs"
import { deriveAggregatePlanes } from "./mtfConvergence.mjs"
import { U4FA_DEFAULTS, resolveAssetConfig, CURRENCY_CODES } from "./u4faConfig.mjs"

export const MIN_5M_BARS = 60

// ---------------------------------------------------------------------
// T4 — F1 session clock (IANA, DST-aware; no manual UTC offsets)
// ---------------------------------------------------------------------
/**
 * Is `nowMs` inside the session window, where the window is wall-clock time in
 * an IANA tz ("07:00"-"16:00" Europe/London = blueprint's 07:00-16:00 GMT,
 * DST-shifted by the tz database — not a hardcoded offset).
 * @param {{tz: string, start: string, end: string}} window
 * @param {number} [nowMs]
 */
export function sessionInWindow({ tz, start, end }, nowMs = Date.now()) {
  if (!tz || typeof start !== "string" || typeof end !== "string" || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return { ok: false, wall: null, tz, error: "invalid session window" }
  }
  let wall
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit"
    }).formatToParts(nowMs)
    let h = "", m = ""
    for (const p of parts) {
      if (p.type === "hour") h = p.value
      if (p.type === "minute") m = p.value
    }
    if (h === "24") h = "00" // some ICU builds emit 24 at midnight under h23
    wall = `${h}:${m}`
  } catch {
    return { ok: false, wall: null, tz, error: `unknown timeZone "${tz}"` }
  }
  const open = start <= end ? wall >= start && wall <= end : wall >= start || wall <= end
  return { ok: open, wall, tz }
}

// T4/REQ-MAIN — next 5-min (or style-TF) candle open + delayMs (blueprint: +2s).
export function nextBarAtMs(nowMs, baseTfSec = 300, delayMs = 2000) {
  const period = baseTfSec * 1000
  return Math.ceil(Number(nowMs) / period) * period + delayMs
}

// ---------------------------------------------------------------------
// T5 — F1 news blackout (economicCalendar reuse; honest source label rides)
// ---------------------------------------------------------------------
// Calendar event times are treated as UTC wall-clock (faireconomy feed times
// are GMT). Documented assumption; the feed does not declare a tz.
function eventAtMs(e) {
  return Date.parse(`${e.date}T${e.time}:00Z`)
}

/**
 * High-impact events within ±minutes of now whose currency touches the asset's
 * quote/base currencies. Events must carry { date, time, currency, impact, event }.
 * @returns {{ blocked: boolean, hits: Array, checkedCurrencies: string[] }}
 */
export function blackoutViolations({ events = [], nowMs = Date.now(), minutes = 15, currencies = [] } = {}) {
  const list = Array.isArray(events) ? events : []
  const checked = Array.isArray(currencies) ? currencies : []
  const hits = []
  for (const e of list) {
    if (String(e.impact ?? "").toLowerCase() !== "high") continue
    const cur = String(e.currency ?? "").toUpperCase()
    if (checked.length && !checked.includes(cur)) continue
    const at = eventAtMs(e)
    if (!Number.isFinite(at)) continue
    if (Math.abs(at - nowMs) <= minutes * 60_000) {
      hits.push({ date: e.date, time: e.time, currency: cur, event: e.event, atMs: at, minutesAway: Math.round((at - nowMs) / 60_000) })
    }
  }
  hits.sort((a, b) => Math.abs(a.minutesAway) - Math.abs(b.minutesAway))
  return { blocked: hits.length > 0, hits, checkedCurrencies: checked }
}

// ---------------------------------------------------------------------
// T6 — F1 spread gate probe + honest abort
// ---------------------------------------------------------------------
/**
 * @param {null|{spreadPips: number, source: string, at: number}} spread
 *   null = no spread source anywhere (T6 probe result: DATA-GAP).
 *   A future wired source must return honest {spreadPips, source, at}.
 */
export function spreadGateF1(spread, maxSpreadPips = 1.5, nowMs = Date.now()) {
  if (spread == null || typeof spread !== "object") {
    return { ok: false, check: "unmeasurable", reason: "spread unmeasurable — no bid/ask source", spreadPips: null, source: null, at: null }
  }
  const pips = Number(spread.spreadPips)
  if (!Number.isFinite(pips) || pips < 0) {
    return { ok: false, check: "unmeasurable", reason: "spread unmeasurable — non-finite reading", spreadPips: null, source: spread.source ?? null, at: spread.at ?? null }
  }
  const ok = pips <= maxSpreadPips
  return {
    ok,
    check: ok ? "ok" : "over-limit",
    reason: ok ? `spread ${pips} pips <= ${maxSpreadPips}` : `spread ${pips} pips > ${maxSpreadPips} pips`,
    spreadPips: pips,
    source: spread.source ?? "wired",
    at: Number(spread.at) || nowMs
  }
}

// ---------------------------------------------------------------------
// T7 — F1 correlation lock (static config, not measured covariance)
// ---------------------------------------------------------------------
/**
 * @param {object} opts
 * @param {string} opts.assetId - the asset being evaluated (e.g. "GBPUSD")
 * @param {Array<{asset: string, ts: number}>} opts.losses - normalized resolved
 *   losses (accuracy-ledger misses + demo-deal losses); the T9 seam converts the
 *   ledger/deal shapes into this normalized {asset, ts} form.
 * @param {object} opts.correlations - config.correlations (static, declared)
 */
export function correlationBlocked({ assetId, losses = [], correlations = {}, nowMs = Date.now() } = {}) {
  const rule = correlations[String(assetId)]
  if (!rule || !Array.isArray(rule.triggers) || !rule.triggers.length) {
    return { blocked: false, triggeredBy: null, at: null, label: rule?.label ?? null }
  }
  const pauseMs = Number(rule.pauseMs) || 900000
  for (const trig of rule.triggers) {
    const hit = (Array.isArray(losses) ? losses : []).find(
      (l) => l && l.asset === trig && Number.isFinite(l.ts) && nowMs - l.ts <= pauseMs && nowMs - l.ts >= 0
    )
    if (hit) {
      return { blocked: true, triggeredBy: trig, at: hit.ts, pauseMs, label: rule.label }
    }
  }
  return { blocked: false, triggeredBy: null, at: null, pauseMs, label: rule.label }
}

// ---------------------------------------------------------------------
// T8 — F2 structure levels (H4 derived from hourly; D1 Yahoo-EOD only; G2 min-history)
// ---------------------------------------------------------------------
function levelLeg(plane, price, pipSize, tolerancePips, source) {
  const levels = supportResistance(plane, { lookback: 2, maxLevels: 6 })
  const supports = levels.filter((l) => l.kind === "support").sort((a, b) => b.level - a.level)
  const resistances = levels.filter((l) => l.kind === "resistance").sort((a, b) => a.level - b.level)
  const sup = supports.find((l) => l.level <= price)
  const res = resistances.find((l) => l.level >= price)
  const sd = sup && pipSize > 0 ? (price - sup.level) / pipSize : null
  const rd = res && pipSize > 0 ? (res.level - price) / pipSize : null
  return {
    available: true, source, levelCount: levels.length,
    closestSupport: sup ? { level: sup.level, distancePips: sd, touches: sup.touches } : null,
    closestResistance: res ? { level: res.level, distancePips: rd, touches: res.touches } : null,
    supportHit: sup != null && sd != null && sd <= tolerancePips,
    resistanceHit: res != null && rd != null && rd <= tolerancePips,
    supportDistancePips: sd,
    resistanceDistancePips: rd
  }
}

/**
 * Resolve F2 swing S/R levels on the H4 (derived) and D1 (Yahoo-EOD) legs.
 * Min-history guard (G2): H4 needs >=120 hourly bars and >=30 derived H4 bricks;
 * D1 needs >=60 daily candles; anything short is `unavailable`, never invented.
 * @returns {{ legs: object, call: {hit, legs}, put: {hit, legs}, sources: string }}
 */
export function resolveStructureLevels({ hourlyCandles = null, dailyCandles = null, price, pipSize, tolerancePips = 10 } = {}) {
  const legs = {}
  if (Array.isArray(hourlyCandles) && hourlyCandles.length >= 120) {
    const plane = deriveAggregatePlanes(hourlyCandles, [14400], { baseTf: 3600 }).planes?.[14400] ?? null
    if (Array.isArray(plane) && plane.length >= 30) {
      legs.h4 = levelLeg(plane, price, pipSize, tolerancePips, "aggregate-h4")
    } else {
      legs.h4 = { available: false, source: "none", reason: `derived H4 plane < 30 bricks (${Array.isArray(plane) ? plane.length : 0})` }
    }
  } else {
    legs.h4 = { available: false, source: "none", reason: "< 120 hourly bars (H4 not derivable)" }
  }
  if (Array.isArray(dailyCandles) && dailyCandles.length >= 60) {
    legs.d1 = levelLeg(dailyCandles, price, pipSize, tolerancePips, "yahoo-d1")
  } else if (Array.isArray(dailyCandles)) {
    legs.d1 = { available: false, source: "none", reason: `< 60 daily candles (${dailyCandles.length})` }
  } else {
    legs.d1 = { available: false, source: "none", reason: "no daily candles supplied (D1 = Yahoo EOD only; not derivable from live buffers)" }
  }
  const callLegs = Object.entries(legs).filter(([, v]) => v.available && v.supportHit).map(([k]) => k)
  const putLegs = Object.entries(legs).filter(([, v]) => v.available && v.resistanceHit).map(([k]) => k)
  const sources = ["h4", "d1"].filter((k) => legs[k]?.available)
  return {
    legs,
    call: { hit: callLegs.length > 0, legs: callLegs },
    put: { hit: putLegs.length > 0, legs: putLegs },
    sources: sources.length
      ? sources.map((k) => legs[k].source).join("+")
      : (Array.isArray(hourlyCandles) || Array.isArray(dailyCandles) ? "none" : "none")
  }
}

// ---------------------------------------------------------------------
// F2 trigger candle (pure math on the last closed 5-min bar)
// ---------------------------------------------------------------------
/** Pin bar: wick > 2x body (blueprint REQ-F2). */
export function pinBarHit({ open, high, low, close }) {
  const body = Math.abs(Number(close) - Number(open))
  if (!Number.isFinite(body) || body <= 0) return false
  const wick = Math.max(Number(high) - Number(close), Number(open) - Number(low))
  return Number.isFinite(wick) && wick > 2 * body
}

/** Trigger candle per direction: pin-bar OR close fully beyond the 20 SMA (open on opposite side). */
export function triggerFromCandle(candle, sma20Last, direction) {
  const o = Number(candle?.open)
  const c = Number(candle?.close)
  if (!Number.isFinite(o) || !Number.isFinite(c) || !Number.isFinite(sma20Last)) {
    return { trigger: "none", pinBar: false, smaBreak: false, reason: "price/SMA unavailable" }
  }
  if (pinBarHit(candle)) return { trigger: "pin-bar", pinBar: true, smaBreak: false }
  const beyond = direction === "up"
    ? c > sma20Last && o <= sma20Last
    : c < sma20Last && o >= sma20Last
  if (beyond) return { trigger: "sma-break", pinBar: false, smaBreak: true }
  return { trigger: "none", pinBar: false, smaBreak: false }
}

// ---------------------------------------------------------------------
// F4 boosters (pure; direction-specific)
// ---------------------------------------------------------------------
/** B1 — StochRSI(14,14,3,3) %K/%D cross: CALL %K<long-level crosses UP; PUT %K>short-level crosses DOWN. */
export function boosterB1({ kCur, dCur, kPrev, dPrev, direction, levels = { long: 60, short: 40 } } = {}) {
  const nums = [kCur, dCur, kPrev, dPrev]
  if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return { pass: false, reason: "insufficient stochRSI history for cross detection" }
  }
  if (direction === "up") {
    const pass = kPrev < levels.long && kPrev <= dPrev && kCur > dCur
    return { pass, reason: pass ? `%K ${kCur.toFixed(1)} crossed up through %D (prev below ${levels.long})` : "no %K up-cross below long level" }
  }
  if (direction === "down") {
    const pass = kPrev > levels.short && kPrev >= dPrev && kCur < dCur
    return { pass, reason: pass ? `%K ${kCur.toFixed(1)} crossed down through %D (prev above ${levels.short})` : "no %K down-cross above short level" }
  }
  return { pass: false, reason: "no direction" }
}

/** B2 — trigger candle body strictly beyond the 20 SMA with the right color (green CALL / red PUT). */
export function boosterB2({ open, close, sma20, direction } = {}) {
  const o = Number(open); const c = Number(close); const s = Number(sma20)
  if (![o, c, s].every((v) => Number.isFinite(v))) return { pass: false, reason: "price/SMA unavailable" }
  if (direction === "up") {
    const pass = c > o && o > s && c > s // entire body above the SMA
    return { pass, reason: pass ? "green candle body fully above 20 SMA" : "candle body not fully above 20 SMA" }
  }
  if (direction === "down") {
    const pass = c < o && o < s && c < s // entire body below the SMA
    return { pass, reason: pass ? "red candle body fully below 20 SMA" : "candle body not fully below 20 SMA" }
  }
  return { pass: false, reason: "no direction" }
}

/** B3 — BB exhaustion: if ADX<=30 price must not hug the band; ADX>30 rule ignored (auto-passes). */
export function boosterB3({ percentB, adxLast, bbHugPct = 0.9, direction } = {}) {
  if (adxLast != null && Number.isFinite(adxLast) && adxLast > 30) {
    return { pass: true, ignored: "adx>30", reason: "ADX > 30 — exhaustion rule ignored per blueprint" }
  }
  if (percentB == null || !Number.isFinite(percentB)) return { pass: false, reason: "BB percentB unavailable" }
  if (direction === "up") {
    const pass = percentB < bbHugPct
    return { pass, percentB, reason: pass ? `not hugging upper band (percentB ${percentB.toFixed(2)} < ${bbHugPct})` : `hugging upper band (percentB ${percentB.toFixed(2)})` }
  }
  if (direction === "down") {
    const pass = percentB > 1 - bbHugPct
    return { pass, percentB, reason: pass ? `not hugging lower band (percentB ${percentB.toFixed(2)} > ${(1 - bbHugPct).toFixed(2)})` : `hugging lower band (percentB ${percentB.toFixed(2)})` }
  }
  return { pass: false, reason: "no direction" }
}

// ---------------------------------------------------------------------
// Regime-3 Chop latch (anti-flicker; mirrors updateRegimeBreaker latch pattern)
// ---------------------------------------------------------------------
/**
 * Fold one ADX reading into the chop state. `goodReading` = current reading is
 * above the asset's ADX threshold. Once chop latches, `confirmBars` consecutive
 * good readings are required to re-arm (blueprint: "until recovery"; research
 * consensus 2-3 bars; default 2, configurable).
 */
export function nextRegimeState(state = { chop: false, streak: 0 }, goodReading, confirmBars = 2) {
  const s = state ?? {}
  const chop = s.chop === true
  const streak = Number.isFinite(s.streak) ? s.streak : 0
  const need = Number.isInteger(confirmBars) && confirmBars >= 1 ? confirmBars : 2
  if (chop) {
    if (goodReading) {
      const ns = streak + 1
      return ns >= need ? { chop: false, streak: 0, rearmed: true } : { chop: true, streak: ns, rearmed: false }
    }
    return { chop: true, streak: 0, rearmed: false }
  }
  if (!goodReading) return { chop: true, streak: 0, rearmed: false }
  return { chop: false, streak: 0, rearmed: false }
}

// ---------------------------------------------------------------------
// REQ-MAIN timing recommendation (advisory; PICC never auto-orders)
// ---------------------------------------------------------------------
/** ADX<threshold abort; [threshold,30] enter at next-bar open + delay; >30 immediate (close). */
export function timingRecommendation(adxValue, adxThreshold, { nowMs = Date.now(), baseTfSec = 300, delayMs = 2000 } = {}) {
  if (adxValue == null || !Number.isFinite(adxValue)) {
    return { mode: "abort", atMs: null, note: "ADX unavailable (insufficient bars) — no timing advice" }
  }
  if (adxValue < adxThreshold) {
    return { mode: "abort", atMs: null, note: `ADX ${adxValue.toFixed(1)} < ${adxThreshold} — Regime 3 Chop, all signals halted` }
  }
  if (adxValue <= 30) {
    return {
      mode: "next-bar",
      atMs: nextBarAtMs(nowMs, baseTfSec, delayMs),
      note: `ADX ${adxValue.toFixed(1)} in [${adxThreshold},30] — enter at open of next ${baseTfSec / 60}-min candle +${delayMs}ms`
    }
  }
  return { mode: "immediate", atMs: nowMs, note: "ADX > 30 — enter at confirmation candle close" }
}

// ---------------------------------------------------------------------
// T3 — the pipeline
// ---------------------------------------------------------------------
/**
 * Evaluate the U4FA factor pipeline for one asset.
 * @param {object} opts
 * @param {string} opts.assetId
 * @param {Array} opts.candles5m - 5-min candles (periods[300]); newest last
 * @param {Array|null} [opts.hourlyCandles] - 3600s candles for the H4 plane
 * @param {Array|null} [opts.dailyCandles] - 86400s Yahoo EOD candles for D1
 * @param {Array} [opts.calendarEvents] - economicCalendar events ({date,time,currency,impact,event})
 * @param {string} [opts.calendarSource] - "feed" | "fallback-schedule" (honest label)
 * @param {null|{spreadPips,source,at}} [opts.spread] - null = unmeasurable (abort)
 * @param {Array<{asset:string, ts:number}>} [opts.losses] - normalized resolved losses
 * @param {object} [opts.config] - full U4FA config (u4faConfig.U4FA_DEFAULTS shape)
 * @param {object} [opts.regimeState] - {chop, streak} latch, caller-persisted
 * @param {number} [opts.nowMs]
 * @param {string} [opts.candleSource] - honesty label for the candle producer
 * @returns {object} M8-core verdict payload + `regimeState` (next latch state)
 */
export function evaluateU4FA({
  assetId,
  candles5m = [],
  hourlyCandles = null,
  dailyCandles = null,
  calendarEvents = [],
  calendarSource = "unknown",
  spread = null,
  losses = [],
  config = U4FA_DEFAULTS,
  regimeState = { chop: false, streak: 0 },
  nowMs = Date.now(),
  candleSource = "pure"
} = {}) {
  const id = String(assetId ?? "")
  const assetCfg = resolveAssetConfig(id, config)
  const risk = config.risk ?? U4FA_DEFAULTS.risk
  const base = {
    assetId: id,
    style: assetCfg.style ?? String(config.activeStyle ?? "2"),
    direction: "flat",
    verdict: "NEUTRAL",
    expiry: assetCfg.expiry ?? null,
    factors: { f1: { pass: false, checks: {} }, f2: { pass: false, structure: null }, f3: null, f4: null },
    regime: null,
    timing: null,
    indicators: null,
    risk: { riskPct: risk.riskPerTradePct, dailyLossLimitPct: risk.dailyLossLimitPct, maxDailyTrades: risk.maxDailyTrades },
    compliance: { requiresHumanApproval: true, proposalId: null },
    honesty: { spreadSource: null, structureSource: null, calendarSource, candleSource },
    reasons: [],
    // Unauditable readings (refused/insufficient) carry no opinion about the
    // regime latch — a transient data gap must not wedge the engine into chop.
    regimeState: regimeState
  }

  if (assetCfg.accessibility !== "trade") {
    base.reasons.push(assetCfg.reason)
    base.factors.f1.checks.eligibility = "refused"
    return base
  }

  if (!Array.isArray(candles5m) || candles5m.length < MIN_5M_BARS) {
    base.reasons.push(`insufficient 5m history (${Array.isArray(candles5m) ? candles5m.length : 0} bars, min ${MIN_5M_BARS})`)
    return base
  }

  const { opens, highs, lows, closes } = candleArrays(candles5m)
  const last = candles5m[candles5m.length - 1]
  const price = Number(last.close)

  // --- indicator series ---------------------------------------------------
  const sma20 = sma(closes, 20)
  const ema50 = ema(closes, 50)
  const adxRes = adx(highs, lows, closes, 14)
  const adxSeries = adxRes.adx
  const lastNonNull = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]
    return null
  }
  const adxVal = lastNonNull(adxSeries)
  const ema50Val = lastNonNull(ema50)
  const sma20Val = lastNonNull(sma20)

  const bbRes = bollinger(closes, { period: 20, mult: assetCfg.bbMult })
  const bb = {
    upper: lastNonNull(bbRes.upper), mid: lastNonNull(bbRes.mid),
    lower: lastNonNull(bbRes.lower), percentB: lastNonNull(bbRes.percentB)
  }

  const sk = stochRSI(closes, { period: 14, smoothK: 3, smoothD: 3 })
  let kCur = null, dCur = null, kPrev = null, dPrev = null
  for (let i = sk.k.length - 1; i >= 1; i--) {
    if (sk.k[i] != null && sk.d[i] != null && sk.k[i - 1] != null && sk.d[i - 1] != null) {
      kCur = sk.k[i]; dCur = sk.d[i]; kPrev = sk.k[i - 1]; dPrev = sk.d[i - 1]
      break
    }
  }

  // ATR% (relative to own recent volatility) for the PICC-phase label.
  const atrVals = atr(highs, lows, closes, 14)
  const atrLast = lastNonNull(atrVals)
  const atrPctCur = atrLast != null && price > 0 ? (atrLast / price) * 100 : null
  const recentPcts = []
  for (let i = atrVals.length - 1; i >= 0 && recentPcts.length < 60; i--) {
    if (atrVals[i] != null && closes[i] > 0) recentPcts.push((atrVals[i] / closes[i]) * 100)
  }
  const medianPct = recentPcts.length ? recentPcts.slice().sort((a, b) => a - b)[Math.floor(recentPcts.length / 2)] : null
  const volatileAtr = medianPct != null && atrPctCur != null && medianPct > 0 && atrPctCur >= 1.5 * medianPct

  // --- regime latch (computed from every reading, before the factors) ------
  const goodReading = adxVal != null && adxVal > assetCfg.adxThreshold
  const newRegime = nextRegimeState(regimeState, goodReading, config.regimeConfirmBars ?? 2)
  const chop = newRegime.chop

  const atrPctLabel = atrPctCur != null ? atrPctCur.toFixed(3) : null
  let pccPhase
  if (adxVal == null) pccPhase = "unknown"
  else if (adxVal > assetCfg.adxThreshold) pccPhase = volatileAtr ? "volatile_trend" : "trend"
  else if (adxVal > 20) pccPhase = volatileAtr ? "volatile_range" : "transition"
  else pccPhase = volatileAtr ? "volatile_range" : "quiet_range"

  // --- F1 (Override) --------------------------------------------------------
  const session = sessionInWindow(assetCfg.session, nowMs)
  const spreadRes = spreadGateF1(spread, assetCfg.maxSpreadPips, nowMs)
  const news = blackoutViolations({ events: calendarEvents, nowMs, minutes: config.newsBlackoutMin ?? 15, currencies: assetCfg.currencies })
  const correl = correlationBlocked({ assetId: id, losses, correlations: config.correlations ?? {}, nowMs })

  const f1 = {
    pass: session.ok && spreadRes.ok && !news.blocked && !correl.blocked,
    checks: {
      session: session.ok ? "open" : "closed",
      spread: spreadRes.check ?? "unmeasurable",
      news: news.blocked ? "blocked" : "clear",
      correlation: correl.blocked ? "blocked" : "clear"
    },
    details: {
      session: { wall: session.wall, tz: session.tz, window: assetCfg.session },
      spread: { spreadPips: spreadRes.spreadPips, reason: spreadRes.reason },
      news: { hits: news.hits, blocked: news.blocked },
      correlation: { triggeredBy: correl.triggeredBy, at: correl.at, label: correl.label ?? null }
    }
  }
  if (f1.pass) base.honesty.spreadSource = spreadRes.source

  // --- F2 (Structure) --------------------------------------------------------
  const struct = resolveStructureLevels({
    hourlyCandles, dailyCandles, price, pipSize: assetCfg.pipSize,
    tolerancePips: 10 // blueprint: within 10 pips of D1/H4 swing S/R
  })
  base.honesty.structureSource = struct.sources

  const f2 = { pass: false, structure: null, legs: struct.legs }
  let direction = "flat"
  if (struct.call.hit && struct.put.hit) {
    f2.reasons = ["structure level ambiguous — price within tolerance of BOTH support and resistance; standing aside"]
  } else if (struct.call.hit) {
    direction = "up"
  } else if (struct.put.hit) {
    direction = "down"
  } else {
    const avail = ["h4", "d1"].filter((k) => struct.legs[k]?.available)
    f2.reasons = [
      avail.length === 0
        ? "structure unavailable — no H4/D1 levels (both legs unmeasurable, never invented)"
        : "no swing level within 10 pips on any available leg"
    ]
  }

  if (direction !== "flat") {
    const trig = triggerFromCandle(last, sma20Val, direction)
    const hitLegKey = direction === "up" ? struct.call.legs[0] : struct.put.legs[0]
    const hitLeg = hitLegKey ? struct.legs[hitLegKey] : null
    const levelInfo = hitLeg
      ? (direction === "up" ? hitLeg.closestSupport : hitLeg.closestResistance)
      : null
    f2.pass = trig.trigger !== "none"
    f2.trigger = trig
    f2.structure = levelInfo
      ? {
          tf: hitLegKey === "h4" ? 14400 : 86400,
          side: direction === "up" ? "support" : "resistance",
          level: levelInfo.level,
          distancePips: round4(levelInfo.distancePips),
          tolerancePips: 10,
          trigger: trig.trigger
        }
      : null
    if (!f2.pass) {
      f2.reasons = [`trigger candle not pin-bar or full 20-SMA break for ${direction}`]
    } else {
      f2.reasons = []
    }
  }

  // --- F3 (Compulsory: EMA50 + ADX, chop halt) --------------------------------
  const slopeLookback = config.emaSlopeLookback ?? 5
  let ema50LastVal = null, ema50PrevVal = null
  for (let i = ema50.length - 1; i >= 0; i--) {
    if (ema50[i] != null) {
      ema50LastVal = ema50[i]
      if (i - slopeLookback >= 0 && ema50[i - slopeLookback] != null) ema50PrevVal = ema50[i - slopeLookback]
      break
    }
  }
  const ema50Slope = ema50LastVal != null && ema50PrevVal != null ? ema50LastVal - ema50PrevVal : null
  const ema50Side = ema50LastVal != null ? (price >= ema50LastVal ? "above" : "below") : null

  const f3 = {
    pass: false,
    adx: adxVal,
    adxThreshold: assetCfg.adxThreshold,
    ema50Side,
    ema50Slope: round6(ema50Slope),
    ema50SlopeLookback: slopeLookback,
    chop,
    streak: newRegime.streak,
    confirmBars: config.regimeConfirmBars ?? 2
  }
  if (chop) {
    const inChopBand = adxVal != null && adxVal <= assetCfg.adxThreshold
    f3.reason = inChopBand
      ? `Regime 3 Chop (ADX ${adxVal.toFixed(1)} <= ${assetCfg.adxThreshold}) — halted until recovery`
      : `post-chop recovery — ${newRegime.streak}/${config.regimeConfirmBars ?? 2} consecutive above-threshold readings required`
  } else if (direction === "flat") {
    f3.reason = "no structure direction (F2)"
  } else {
    const aligned = direction === "up"
      ? (ema50Slope != null && ema50Slope > 0 && ema50Side === "above")
      : direction === "down"
        ? (ema50Slope != null && ema50Slope < 0 && ema50Side === "below")
        : false
    if (!aligned) {
      f3.reason = `EMA50 not aligned with ${direction} (slope ${ema50Slope == null ? "n/a" : ema50Slope.toFixed(5)}, price ${ema50Side ?? "n/a"} EMA50)`
    } else {
      f3.pass = true
      f3.reason = `EMA50 aligned (slope ${ema50Slope.toFixed(5)}, price ${ema50Side})`
    }
  }

  // --- F4 (Boosters; only meaningful when F1-F3 pass) -------------------------
  let f4 = null
  if (f1.pass && f2.pass && f3.pass) {
    const b1 = boosterB1({ kCur, dCur, kPrev, dPrev, direction, levels: assetCfg.stoch })
    const b2 = boosterB2({ open: last.open, close: last.close, sma20: sma20Val, direction })
    const b3 = boosterB3({ percentB: bb.percentB, adxLast: adxVal, bbHugPct: config.bbHugPct ?? 0.9, direction })
    const passing = [b1.pass ? 1 : null, b2.pass ? 2 : null, b3.pass ? 3 : null].filter(Boolean)
    f4 = {
      boosters: passing,
      passed: passing.length,
      required: 2,
      detail: {
        stochCross: b1.pass,
        candle20Sma: b2.pass,
        bbExhaustion: b3.ignored ? "ignored-adx>30" : b3.pass ? "pass" : "fail"
      }
    }
  }

  // --- verdict ---------------------------------------------------------------
  let verdict = "NEUTRAL", verdictReasons = []
  if (!f1.pass) {
    if (!session.ok) verdictReasons.push(`F1: session closed (wall ${session.wall ?? "?"}, ${session.tz})`)
    if (!spreadRes.ok) verdictReasons.push(`F1: spread gate — ${spreadRes.reason}`)
    if (news.blocked) verdictReasons.push(`F1: news blackout — ${news.hits.map((h) => `${h.event} (${h.currency}) ${h.minutesAway}min`).join(", ")}`)
    if (correl.blocked) verdictReasons.push(`F1: correlation lock — ${correl.triggeredBy} loss within ${correl.pauseMs / 60000} min`)
  } else if (!f2.pass) {
    verdictReasons.push(`F2: ${f2.reasons?.join("; ") ?? "no structure"}`)
  } else if (!f3.pass) {
    verdictReasons.push(`F3: ${f3.reason}`)
  } else {
    verdict = f4.passed >= f4.required ? "TRADE" : "OBSERVE"
    if (verdict === "OBSERVE") {
      verdictReasons.push(`F4: ${f4.passed}/${f4.required} boosters — no majority, standing aside`)
    } else {
      verdictReasons.push(`F1-F3 pass; F4 ${f4.passed}/${f4.required} boosters (${f4.boosters.join("/")})`)
    }
  }
  // chop halt overrides every strategy until the latch re-arms (REQ-F3)
  if (chop && verdict !== "NEUTRAL") {
    verdict = "NEUTRAL"
    verdictReasons.push(`Regime 3 Chop — hard halt active`) // overrides the booster majority
  }

  verdictReasons.push("decision support only — no order is placed")

  const timing = timingRecommendation(adxVal, assetCfg.adxThreshold, {
    nowMs,
    baseTfSec: assetCfg.preset?.chartTf ?? 300,
    delayMs: config.timingAtNextBarMs ?? 2000
  })

  return {
    assetId: id,
    style: assetCfg.style,
    direction,
    verdict,
    expiry: assetCfg.expiry,
    factors: { f1, f2, f3, f4 },
    regime: {
      adx: round2(adxVal),
      adxThreshold: assetCfg.adxThreshold,
      phase: chop ? "regime3-chop" : adxVal == null ? "unknown" : "trend",
      pccPhase,
      chop,
      streak: newRegime.streak,
      atrPct: atrPctLabel
    },
    timing,
    indicators: {
      close: price,
      ema50: round6(ema50LastVal),
      adx: round2(adxVal),
      bb: { upper: round6(bb.upper), mid: round6(bb.mid), lower: round6(bb.lower), percentB: round4(bb.percentB) },
      stochRsi: { k: round2(kCur), d: round2(dCur) }
    },
    risk: { riskPct: risk.riskPerTradePct, dailyLossLimitPct: risk.dailyLossLimitPct, maxDailyTrades: risk.maxDailyTrades },
    compliance: { requiresHumanApproval: true, proposalId: null },
    honesty: {
      spreadSource: base.honesty.spreadSource,
      structureSource: struct.sources,
      calendarSource: calendarSource || "unknown",
      candleSource: candleSource || "pure"
    },
    reasons: verdictReasons,
    regimeState: newRegime
  }
}

// ---------------------------------------------------------------------
function round2(v) { return v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100 }
function round4(v) { return v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000 }
function round6(v) { return v == null || !Number.isFinite(v) ? null : Math.round(v * 1000000) / 1000000 }

export { CURRENCY_CODES }