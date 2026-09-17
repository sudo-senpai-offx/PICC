// PICC regime engine — pure, dependency-free market-mode classification.
//
// Advisory decision-support only. Nothing here executes trades.
//
// Per-plane regime voters (choppiness, atr_ratio, adx, supertrend) each return
// { enabled, observed, value, reason } in the mtfConvergence voter style:
//   enabled  - the dimension participated in this run
//   observed - the underlying read existed (enough bars, indicator available)
//   value    - the categorical regime contribution when observed; null otherwise.
//              An unobserved read NEVER counts as a neutral vote (consensus in
//              B-REG-2 excludes it).
// The module is pure: no network, no I/O; callers supply candles.
//
// Spec: docs/specs/PICC_TRADING_SUITE_REBUILD_v1.md §5 D1 (B-REG slice).

import { atr as computeAtr, adx as computeAdx } from "./indicators.mjs"
// The ONLY coupling to the convergence engine (spec §5 D1, B-REG-3): the
// preset weight ladder, consumed read-only as the base for `regimeKnobs`.
// mtfConvergence itself never changes — modulation rides its own knobs.
import { PRESETS } from "./mtfConvergence.mjs"

/** Planes with fewer bars than this abstain (spec REQ-R1; matches
 * mtfConvergence.mjs:30 and regimeDetection.mjs:8). */
export const MIN_BARS = 30

/** The four per-plane regime dimensions, in evaluation order (spec D1). */
export const REGIME_DIMS = Object.freeze([
  "choppiness",
  "atr_ratio",
  "adx",
  "supertrend"
])

/**
 * Regime voter thresholds (spec D1). Choppiness band per the PHANTOM row:
 * trend < 38.2 / chop > 61.8, 50 midline neutral. ATR-ratio 1.5 matches
 * regimeDetection.mjs:27. ADX gates 25/20 match adxGate
 * (mtfConvergence.mjs:300-306). supertrend.available is FALSE because
 * indicators.mjs has no Supertrend helper (R6 confirmed at B-REG-1): that
 * voter abstains honestly rather than fabricate a read.
 */
export const REGIME_CONSTANTS = Object.freeze({
  choppiness: Object.freeze({ n: 14, trend: 38.2, chop: 61.8 }),
  atrRatio: Object.freeze({ volatile: 1.5, quiet: 0.8 }),
  adx: Object.freeze({ period: 14, trend: 25, noTrend: 20 }),
  supertrend: Object.freeze({ available: false })
})

const NONE = Object.freeze({ enabled: true, observed: false, value: null, reason: "n/a" })
const vote = (value, observed, reason) => ({ enabled: true, observed, value: observed ? value : null, reason })

// ---------------------------------------------------------------------
// Choppiness Index (computed in-module — indicators.mjs has no helper, spec R6).
// CHI = 100 * log10( sum(range_i, n) / (maxHigh - minLow over n) ) / log10(n).
// Lower = more directional; higher = more choppy.
// ---------------------------------------------------------------------

/**
 * Raw Choppiness Index over the last `n` bars (textbook formula).
 * @returns {number|null} CHI percent-scaled, or null when undefined
 * (insufficient bars, zero/negative range, or zero net span).
 */
export function choppinessIndex(candles, { n = REGIME_CONSTANTS.choppiness.n } = {}) {
  if (!candles || candles.length < n + 1) return null
  const window = candles.slice(-n)
  let sumRange = 0
  let maxHigh = -Infinity
  let minLow = Infinity
  for (const c of window) {
    const r = c.high - c.low
    if (!(r > 0)) return null // non-positive range makes the index undefined
    sumRange += r
    if (c.high > maxHigh) maxHigh = c.high
    if (c.low < minLow) minLow = c.low
  }
  const span = maxHigh - minLow
  if (!(span > 0)) return null
  return (100 * Math.log10(sumRange / span)) / Math.log10(n)
}

/**
 * Choppiness voter: value "trend" (CHI < 38.2), "chop" (CHI > 61.8), or
 * "neutral" (in-band). Thin or undefined data abstains — never a guess.
 */
export function voteChoppiness(candles, { n = REGIME_CONSTANTS.choppiness.n } = {}) {
  if (!candles) return NONE
  if (candles.length < MIN_BARS) {
    return vote(null, false, `insufficient bars (${candles.length} < MIN_BARS ${MIN_BARS})`)
  }
  const chi = choppinessIndex(candles, { n })
  if (chi == null) return vote(null, false, "choppiness undefined (zero range/span)")
  const { trend, chop } = REGIME_CONSTANTS.choppiness
  if (chi < trend) return vote("trend", true, `CHI ${chi.toFixed(1)} < ${trend}`)
  if (chi > chop) return vote("chop", true, `CHI ${chi.toFixed(1)} > ${chop}`)
  return vote("neutral", true, `CHI ${chi.toFixed(1)} in ${trend}-${chop}`)
}

// ---------------------------------------------------------------------
// ATR-ratio voter (volatility contribution).
// ---------------------------------------------------------------------

/**
 * ATR-ratio voter: current ATR vs its average over the series.
 * value "volatile" (ratio > 1.5), "quiet" (ratio < 0.8), else "neutral".
 * Thin data abstains. Computed from the same ATR(14) as regimeDetection.mjs:27.
 */
export function voteAtrRatio(candles) {
  if (!candles) return NONE
  if (candles.length < MIN_BARS) {
    return vote(null, false, `insufficient bars (${candles.length} < MIN_BARS ${MIN_BARS})`)
  }
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const closes = candles.map((c) => c.close)
  const atrSeries = computeAtr(highs, lows, closes, REGIME_CONSTANTS.adx.period)
  const values = atrSeries.filter((v) => v != null && v > 0)
  if (values.length === 0) return vote(null, false, "atr undefined")
  const current = values[values.length - 1]
  const avg = values.reduce((s, v) => s + v, 0) / values.length
  const ratio = avg > 0 ? current / avg : 1
  const { volatile, quiet } = REGIME_CONSTANTS.atrRatio
  if (ratio > volatile) return vote("volatile", true, `ATR ratio ${ratio.toFixed(2)}x > ${volatile}`)
  if (ratio < quiet) return vote("quiet", true, `ATR ratio ${ratio.toFixed(2)}x < ${quiet}`)
  return vote("neutral", true, `ATR ratio ${ratio.toFixed(2)}x in ${quiet}-${volatile}`)
}

// ---------------------------------------------------------------------
// ADX voter (trend-strength contribution).
// ---------------------------------------------------------------------

/**
 * ADX voter: value "trend" (ADX >= 25), "no-trend" (ADX < 20), else "neutral".
 * Thin data abstains. Same ADX(14) as adxGate (mtfConvergence.mjs:300-306).
 */
export function voteAdxRegime(candles) {
  if (!candles) return NONE
  if (candles.length < MIN_BARS) {
    return vote(null, false, `insufficient bars (${candles.length} < MIN_BARS ${MIN_BARS})`)
  }
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const closes = candles.map((c) => c.close)
  const adxResult = computeAdx(highs, lows, closes, REGIME_CONSTANTS.adx.period)
  const values = (adxResult.adx ?? []).filter((v) => v != null && v > 0)
  if (values.length === 0) return vote(null, false, "adx undefined")
  const current = values[values.length - 1]
  const { trend, noTrend } = REGIME_CONSTANTS.adx
  if (current >= trend) return vote("trend", true, `ADX ${current.toFixed(1)} >= ${trend}`)
  if (current < noTrend) return vote("no-trend", true, `ADX ${current.toFixed(1)} < ${noTrend}`)
  return vote("neutral", true, `ADX ${current.toFixed(1)} in ${noTrend}-${trend}`)
}

// ---------------------------------------------------------------------
// Supertrend voter — honestly unavailable (R6 confirmed: indicators.mjs has
// no Supertrend helper). Dimension is part of REGIME_DIMS so consensus knows
// it participates in the model, but it always abstains with a documented
// reason; it NEVER fabricates a read.
// ---------------------------------------------------------------------

/**
 * Supertrend voter: always abstains until indicators.mjs gains a Supertrend
 * helper (spec D1 confirmed-gate). Never a fabricated read.
 */
export function voteSupertrend() {
  return vote(null, false, "indicator unavailable (no Supertrend in indicators.mjs)")
}

// ---------------------------------------------------------------------
// Multi-timeframe consensus (spec REQ-R1/R2, D1).
// Per-plane observed votes lean "trend" or "range"; the bias plane (the TF
// resolvePreset labels `bias`) is weighted BIAS_WEIGHT. A regime is emitted
// only from coherent consensus: TRENDING (>= TREND_MAJORITY trend weight,
// strictly dominant), RANGING (>= TREND_MAJORITY range weight, strictly
// dominant, or a completely directionless read), else UNCERTAIN. The
// `volatile` annotation rides along from any plane's ATR-ratio read.
// ---------------------------------------------------------------------

/** Bias-plane consensus weight (REQ-R2: bias label from resolvePreset). */
export const BIAS_WEIGHT = 1.5

/** Minimum lean weight required to emit a directional regime (anti-noise). */
export const TREND_MAJORITY = 2

/** Voter value -> consensus lean. Neutral values carry no lean (they are
 * counted as observed, diluting confidence, but never vote). */
const LEANS = Object.freeze({
  choppiness: Object.freeze({ trend: "trend", chop: "range" }),
  atr_ratio: Object.freeze({ quiet: "range" }), // volatile -> annotation only
  adx: Object.freeze({ trend: "trend", "no-trend": "range" }),
  supertrend: Object.freeze({})
})

/**
 * Pure regime read over the plane set.
 * @param {object} opts.planes - { tfSeconds: candles[] }
 * @param {number} [opts.biasTf] - bias plane's tf seconds (bias weighting)
 * @returns {{ regime: "TRENDING"|"RANGING"|"UNCERTAIN"|"unknown", volatile,
 *   confidence:number, factors:string[], perPlane:object, latency:object,
 *   legacy:string|null }}
 * Thin planes abstain: regime "unknown" with confidence 0 — never a guess.
 */
export function detectRegimeEnhanced({ planes = {}, biasTf = null } = {}) {
  const perPlane = {}
  const factors = []
  let volatile = false
  let trend = 0
  let range = 0
  let observedWeight = 0
  let observedCount = 0
  let minBars = Infinity
  const tfs = Object.keys(planes)

  for (const tf of tfs) {
    const candles = planes[tf]
    const w = Number(tf) === Number(biasTf) ? BIAS_WEIGHT : 1
    const bars = Array.isArray(candles) ? candles.length : 0
    minBars = Math.min(minBars, bars)
    if (!Array.isArray(candles) || bars < MIN_BARS) {
      perPlane[tf] = { bars, abstain: true, reason: `insufficient bars (< MIN_BARS ${MIN_BARS})` }
      factors.push(`plane ${tf}: ${perPlane[tf].reason}`)
      continue
    }
    const votes = {
      choppiness: voteChoppiness(candles),
      atr_ratio: voteAtrRatio(candles),
      adx: voteAdxRegime(candles),
      supertrend: voteSupertrend()
    }
    let observed = 0
    for (const dim of REGIME_DIMS) {
      const v = votes[dim]
      if (!v.observed) continue
      observed++
      observedCount++
      observedWeight += w
      factors.push(`plane ${tf} ${dim}: ${v.reason}`)
      if (v.value === "volatile") volatile = true
      const lean = LEANS[dim]?.[v.value] ?? null
      if (lean === "trend") trend += w
      else if (lean === "range") range += w
    }
    perPlane[tf] = { bars, abstain: false, votes, observed }
  }

  const directional = trend + range
  let regime
  let confidence
  let legacy
  if (observedCount === 0) {
    regime = "unknown"
    confidence = 0
    legacy = null
    if (factors.length === 0) factors.push(`no plane has enough bars (MIN_BARS ${MIN_BARS})`)
  } else if (trend >= TREND_MAJORITY && trend > range) {
    regime = "TRENDING"
    confidence = Math.round((100 * trend) / directional)
    legacy = "trending"
  } else if (range >= TREND_MAJORITY && range > trend) {
    regime = "RANGING"
    confidence = Math.round((100 * range) / directional)
    legacy = "ranging"
  } else if (directional > 0) {
    regime = "UNCERTAIN" // conflict: no side dominant (spec REQ-R4 escalation premise)
    confidence = Math.round((100 * Math.max(trend, range)) / directional)
    legacy = volatile ? "volatile" : null // no honest single legacy equivalent otherwise
  } else {
    regime = "RANGING" // directionless observed market
    confidence = 0
    legacy = "ranging"
  }

  return {
    regime,
    volatile,
    confidence,
    factors,
    perPlane,
    latency: { planes: tfs.map(Number), minBars: tfs.length ? minBars : 0 },
    legacy
  }
}

// ---------------------------------------------------------------------
// Anti-flicker latch (spec D1: caller-owned, 2 consecutive agreeing reads).
// Pure reads below; latch state lives HERE in the module so the caller
// (marketConvergence) owns it without persisting across resets — mirror of
// resetU4faRegimeStates (adaptiveConfluence.mjs:649).
// ---------------------------------------------------------------------

const REGIME_LATCHES = new Map() // assetId -> { pending, count, settled }

/** Test hook: clear all per-asset latch state (mirrors resetU4faRegimeStates). */
export function resetRegimeLatches() {
  REGIME_LATCHES.clear()
}

/**
 * Latched regime read: emits a committed regime only after `minConfirm`
 * consecutive agreeing pure reads; a conflicting read is held until re-confirmed.
 * Thin data clears the latch and emits honest "unknown".
 * @returns pure read fields plus { unsettled:boolean, confirmCount:number,
 *   raw?:object } — `raw` is attached when the live read differs from the
 *   emitted settled state so the caller can show the divergence honestly.
 */
export function detectRegimeLatched({ assetId = "default", planes = {}, biasTf = null, minConfirm = 2 } = {}) {
  const raw = detectRegimeEnhanced({ planes, biasTf })
  if (raw.regime === "unknown") {
    REGIME_LATCHES.delete(assetId)
    return { ...raw, unsettled: false, confirmCount: 0 }
  }
  const prior = REGIME_LATCHES.get(assetId) ?? null
  const same = prior != null && prior.pending != null && prior.pending.regime === raw.regime
  const count = same ? prior.count + 1 : 1
  const settled = count >= minConfirm
  const entry = { pending: raw, count, settled: settled ? raw : prior?.settled ?? null }
  REGIME_LATCHES.set(assetId, entry)
  if (settled) return { ...raw, unsettled: false, confirmCount: count }
  if (prior?.settled && !same) return { ...prior.settled, unsettled: true, confirmCount: count, raw }
  return { ...raw, unsettled: true, confirmCount: count }
}

// ---------------------------------------------------------------------
// Regime -> engine-knob mapping (spec REQ-R3, D2; B-REG-3).
// The ONLY place a regime read touches the convergence engine: it returns the
// engine's OWN existing knobs (`weights`, `conservative`) or null/none. It can
// only tighten or reweight perception — it never loosens a gate.
// ---------------------------------------------------------------------

/** Allowed modulation modes (REQ-R3): soft = default, hard = per-asset
 * deterministic, off = read-only regime display. */
export const REGIME_MODES = Object.freeze(["soft", "hard", "off"])

/** Confidence floor for soft weight modulation (REQ-R3: floor 60). Below the
 * floor the regime read is advisory only — weights stay untouched. */
export const DEFAULT_FLOORS = Object.freeze({ soft: 60 })

/** Soft TRENDING bias scale: 1.0 at 100% confidence, 0.5 at 0%. */
const softScaleTrend = (conf) => 0.5 + conf / 200

/** Soft RANGING bias scale: 1.0 at 0% confidence down to 0.5 at 100%
 * (a confident ranging read is trusted LESS for HTF extrapolation). */
const softScaleRange = (conf) => 1 - conf / 200

const PRESET_DEFAULT = "intraday" // the live-buffer ladder (marketConvergence)

/**
 * Translate a regime state into the convergence engine's own knobs.
 * @param {object} state - a detectRegimeLatched/LatchedEnhanced result
 * @param {object} [opts]
 * @param {"soft"|"hard"|"off"} [opts.mode="soft"]
 * @param {object} [opts.floors={soft:60}]
 * @param {string} [opts.preset="intraday"] - base weight ladder (read-only)
 * @returns {{ weights:object|null, conservative:boolean, labels:{suffix:string}|null }}
 *   weights/conservative are engine knobs; `labels.suffix` names the regime
 *   modulation for honest display. All-null = no modulation applied.
 */
export function regimeKnobs(state, { mode = "soft", floors = DEFAULT_FLOORS, preset = PRESET_DEFAULT } = {}) {
  const reg = state?.regime ?? "unknown"
  const conf = Math.max(0, Math.min(100, state?.confidence ?? 0))
  const volatile = state?.volatile ?? false
  const none = { weights: null, conservative: false, labels: null }
  if (mode === "off" || reg === "unknown") return none
  const p = PRESETS[preset]
  if (!p) return none // unknown preset: honest no-op, never a guessed ladder
  const suffix = `regime:${reg.toLowerCase()}${volatile ? "·volatile" : ""}:${conf}%`

  if (mode === "hard") {
    if (reg === "TRENDING") return { weights: { ...p.weights }, conservative: false, labels: { suffix } }
    if (reg === "RANGING") {
      // Deterministic mean-reversion posture: distrust HTF extrapolation.
      // Reuses the engine's per-role weight ladder — no new dimensions.
      return { weights: { entry: 0.4, confirm: 0.4, bias: 0.2 }, conservative: false, labels: { suffix } }
    }
    return { weights: null, conservative: true, labels: { suffix } } // UNCERTAIN
  }

  // mode "soft"
  if (reg === "UNCERTAIN") {
    // Conservative can only tighten — applied unconditionally, even below the
    // confidence floor (a low-confidence uncertain read is still uncertain).
    return { weights: null, conservative: true, labels: { suffix } }
  }
  if (conf < (floors?.soft ?? DEFAULT_FLOORS.soft)) return none // advisory, not applied
  if (reg === "TRENDING") {
    return { weights: { entry: 0.3, confirm: 0.3, bias: 0.4 * softScaleTrend(conf) }, conservative: false, labels: { suffix } }
  }
  if (reg === "RANGING") {
    return { weights: { entry: 0.3, confirm: 0.3, bias: 0.4 * softScaleRange(conf) }, conservative: false, labels: { suffix } }
  }
  return none
}