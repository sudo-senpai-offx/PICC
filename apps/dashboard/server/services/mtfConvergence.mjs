// PICC MTF convergence engine — pure, dependency-free multi-timeframe read.
//
// Advisory decision-support only. Nothing here executes trades.
//
// Each active (enabled, data-sufficient) timeframe ("plane") produces a sign
// from six indicator dimensions; the composite is the weighted sign-sum across
// planes (equal weights by default -> pure sign-sum), normalized to [-1, +1].
// The module is pure: it never touches the network; the caller supplies
// `{ planes: { tf: candles[] }, sourceByTf }` (see `fetchPlanes` for the thin
// data seam). Repaint safety is the `dropOpen` flag + the closed-bar invariant
// (R9): when set, every plane computes on `[0 .. N-2]`.
//
// Dimension semantics follow docs/specs/MTF_CONVERGENCE_ENGINE.md §2.3; the
// StochRSI trigger band 40/60 is a documented design choice (spec §2.6), NOT a
// sourced "zone" — the canonical overbought/oversold extremes stay 80/20.

import { computeIndicatorDashboard, stochRSI, swingPoints, candleArrays } from "./indicators.mjs"

/** The six per-plane dimensions, in evaluation order (spec §2.3). */
export const DIMENSIONS = Object.freeze([
  "trend",
  "momentum",
  "market_structure",
  "trend_strength",
  "momentum_trigger",
  "volatility"
])

/** Planes with fewer bars than this abstain (spec R5 / §2.7). */
export const MIN_BARS = 30

/**
 * %K/%D cross trigger band, percent-scaled (the dashboard's stochRSI runs
 * 0-100, with canonical overbought/oversold at 80/20). Design choice, spec §2.6.
 */
export const STOCHRSI_TRIGGER_BAND = Object.freeze({ lo: 40, hi: 60 })

// ---------------------------------------------------------------------
// Five-tier presets (spec §2.5). Each preset binds three timeframes to the
// entry/confirm/bias roles and carries per-role default weights. The semantic
// five-tier ladder (entry -> confirm -> bias -> swing -> context) is exposed
// via plane labels; an optional TOP plane above bias exists for the two
// highest presets and is OFF by default (2c).
// ---------------------------------------------------------------------

export const TF_SECONDS = Object.freeze({
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
  W1: 604800,
  MN: 2592000 // calendar month
})

export const PRESETS = Object.freeze({
  scalping: { entry: TF_SECONDS.M1, confirm: TF_SECONDS.M5, bias: TF_SECONDS.M15, weights: { entry: 0.3, confirm: 0.3, bias: 0.4 } },
  intraday: { entry: TF_SECONDS.M5, confirm: TF_SECONDS.M15, bias: TF_SECONDS.H1, weights: { entry: 0.3, confirm: 0.3, bias: 0.4 } },
  swingIntraday: { entry: TF_SECONDS.M15, confirm: TF_SECONDS.H1, bias: TF_SECONDS.H4, weights: { entry: 0.3, confirm: 0.3, bias: 0.4 } },
  swing: { entry: TF_SECONDS.H1, confirm: TF_SECONDS.H4, bias: TF_SECONDS.D1, weights: { entry: 0.25, confirm: 0.3, bias: 0.45 } },
  position: { entry: TF_SECONDS.D1, confirm: TF_SECONDS.W1, bias: TF_SECONDS.MN, weights: { entry: 0.2, confirm: 0.35, bias: 0.45 } }
})

/** Optional top plane (above bias) for the two highest presets; default OFF.
 * `tf: null` means no higher standard timeframe exists (data-undefined -> the
 * plane can never be satisfied and abstains honestly when requested, 2c). */
export const PRESET_TOPS = Object.freeze({
  swing: { tf: TF_SECONDS.W1, label: "context" },
  position: { tf: null, label: "context" }
})

/**
 * Resolve a preset into its timeframe ladder, role labels, and default weights.
 * @param {string} key - one of PRESETS keys
 * @param {object} [opts]
 * @param {boolean} [opts.top=false] - include the optional top plane (2c)
 * @returns {object|null} { key, tfs, labels, weights, top } or null for unknown keys
 */
export function resolvePreset(key, { top = false } = {}) {
  const p = PRESETS[key]
  if (!p) return null
  const tfs = []
  const labels = {}
  const weights = {}
  for (const role of ["entry", "confirm", "bias"]) {
    const tf = p[role]
    tfs.push(tf)
    labels[tf] = role
    weights[tf] = p.weights[role]
  }
  const topPlane = top ? (PRESET_TOPS[key] ?? null) : null
  if (topPlane?.tf != null) {
    tfs.push(topPlane.tf)
    labels[topPlane.tf] = topPlane.label
    weights[topPlane.tf] = 1 // neutral default for the optional context plane
  }
  return { key, tfs, labels, weights, top: topPlane }
}

const NONE = Object.freeze({ enabled: true, observed: false, value: null, reason: "n/a" })
const vote = (v, observed, reason) => ({ enabled: true, observed, value: observed ? v : null, reason })

// ---------------------------------------------------------------------
// Per-dimension voters (exported for unit tests). Each returns
// { enabled, observed, value, reason }:
//   enabled  - the dimension participated in this run (3a)
//   observed - the underlying read existed and produced a determination
//   value    - +1|0|-1 when observed; null when unobserved (3b). An
//              unobserved read NEVER counts as a zero vote.
// ---------------------------------------------------------------------

/** Trend: EMA alignment read (dash.ema.read). */
export function voteTrend(dash) {
  const read = dash?.ema?.read
  if (read === "bullish alignment") return vote(1, true, "ema bull align")
  if (read === "bearish alignment") return vote(-1, true, "ema bear align")
  if (read === "mixed") return vote(0, true, "ema mixed")
  return { ...NONE, reason: "ema n/a" }
}

/** Momentum: RSI vs 50 AND MACD histogram sign. */
export function voteMomentum(dash) {
  const r = dash?.rsi?.value
  const h = dash?.macd?.hist
  if (r == null || h == null) return { ...NONE, reason: "rsi/macd n/a" }
  if (r > 50 && h > 0) return vote(1, true, "rsi+macd bull")
  if (r < 50 && h < 0) return vote(-1, true, "rsi+macd bear")
  return vote(0, true, "rsi/macd mixed")
}

/**
 * Market structure: confirmed swing points (HH/HL vs LH/LL), using only the
 * two most recent confirmed pivots on each side (reversal of a 2k+1 window —
 * repaint-safe by construction, swingPoints never marks the last lb bars).
 */
export function voteStructure(swings, lastIndex) {
  const highs = (swings?.highs || []).filter((p) => p.index <= lastIndex)
  const lows = (swings?.lows || []).filter((p) => p.index <= lastIndex)
  if (highs.length < 2 || lows.length < 2) return { ...NONE, reason: "structure n/a" }
  const lastHigh = highs[highs.length - 1].price
  const prevHigh = highs[highs.length - 2].price
  const lastLow = lows[lows.length - 1].price
  const prevLow = lows[lows.length - 2].price
  if (lastHigh > prevHigh && lastLow > prevLow) return vote(1, true, "HH/HL")
  if (lastHigh < prevHigh && lastLow < prevLow) return vote(-1, true, "LH/LL")
  return vote(0, true, "mixed structure")
}

/**
 * Trend strength: ADX >= 25 gate, direction from +DI vs -DI (ADX is
 * direction-blind; spec §2.6). 20-25 gray and <20 no-trend both abstain from
 * voting (0) but are observed determinations.
 */
export function voteTrendStrength(dash) {
  const adxVal = dash?.adx?.adx
  if (adxVal == null) return { ...NONE, reason: "adx n/a" }
  if (adxVal >= 25) {
    const p = dash.adx.plusDI ?? 0
    const m = dash.adx.minusDI ?? 0
    if (p > m) return vote(1, true, "adx +DI")
    if (m > p) return vote(-1, true, "adx -DI")
    return vote(0, true, "adx tie")
  }
  return vote(0, true, adxVal < 20 ? "no trend" : "trend forming")
}

/**
 * Momentum trigger: StochRSI %K/%D cross confined to the 40/60 trigger band
 * (percent scale). Design choice — this is a %K/%D CROSS, not an OB/OS "zone".
 */
export function voteMomentumTrigger(sRSI, lastIndex, band = STOCHRSI_TRIGGER_BAND) {
  const last = lastIndex ?? (sRSI?.k?.length ?? 0) - 1
  const k = sRSI?.k
  const d = sRSI?.d
  const kc = k?.[last]
  const dc = d?.[last]
  const kp = k?.[last - 1]
  const dp = d?.[last - 1]
  if ([kc, dc, kp, dp].some((v) => v == null)) return { ...NONE, reason: "stochRSI n/a" }
  const inBand = (v) => v >= band.lo && v <= band.hi
  if (kp <= dp && kc > dc && inBand(kc)) return vote(1, true, "stochRSI cross up")
  if (kp >= dp && kc < dc && inBand(kc)) return vote(-1, true, "stochRSI cross down")
  return vote(0, true, "no in-band cross")
}

/**
 * Volatility/range: price above the Bollinger mid but not overextended
 * (%B<0.8) => +1 pull from the band; mirrored below => -1.
 */
export function voteVolatility(dash) {
  const price = dash?.last
  const mid = dash?.bollinger?.mid
  const pctB = dash?.bollinger?.percentB
  if (price == null || mid == null || pctB == null) return { ...NONE, reason: "boll n/a" }
  if (price > mid && pctB < 0.8) return vote(1, true, "bull pull")
  if (price < mid && pctB > 0.2) return vote(-1, true, "bear pull")
  return vote(0, true, "band extreme")
}

/** Dimension voters keyed by dimension name. ctx = { dash, sRSI, swings, lastIndex }. */
export const VOTERS = Object.freeze({
  trend: (ctx) => voteTrend(ctx.dash),
  momentum: (ctx) => voteMomentum(ctx.dash),
  market_structure: (ctx) => voteStructure(ctx.swings, ctx.lastIndex),
  trend_strength: (ctx) => voteTrendStrength(ctx.dash),
  momentum_trigger: (ctx) => voteMomentumTrigger(ctx.sRSI, ctx.lastIndex),
  volatility: (ctx) => voteVolatility(ctx.dash)
})

const ABSTAIN_NO_DATA = Object.freeze({ active: false, abstain: "no data", sign: 0, amplitude: 0, observed: 0, votes: {}, score: null })
const ABSTAIN_LOW_BARS = (closedLen, minBars) =>
  ({ active: false, abstain: `low bars (<${minBars})`, sign: 0, amplitude: 0, observed: 0, votes: {}, score: null })

/**
 * Score one plane (one timeframe). Pure; no I/O.
 * @param {object} opts
 * @param {Array} opts.candles - closed-candle objects {open,high,low,close,volume,time}
 * @param {boolean} [opts.dropOpen=false] - compute on [0..N-2] (drop the forming bar)
 * @param {object} [opts.dims={}] - dimension enable map (present for slice-3 parity; default all enabled)
 * @param {number} [opts.minBars=MIN_BARS]
 */
export function planeScore({ candles, dropOpen = false, dims = {}, minBars = MIN_BARS } = {}) {
  if (!Array.isArray(candles) || candles.length === 0) return { ...ABSTAIN_NO_DATA }

  const closed = dropOpen ? candles.slice(0, -1) : candles
  if (closed.length < 2) return ABSTAIN_LOW_BARS(closed.length, minBars)

  const dash = computeIndicatorDashboard(closed)
  const { highs, lows, closes } = candleArrays(closed)
  const lastIndex = closed.length - 1
  const ctx = { dash, sRSI: stochRSI(closes), swings: swingPoints(highs, lows), lastIndex }

  const votes = {}
  let amplitude = 0
  let observed = 0
  let enabledDims = 0
  for (const dim of DIMENSIONS) {
    if (dims[dim] === false) {
      votes[dim] = { enabled: false, observed: false, value: null, reason: "disabled" }
      continue
    }
    enabledDims++
    const r = VOTERS[dim](ctx)
    votes[dim] = r
    if (r.observed) {
      observed++
      amplitude += r.value
    }
  }
  amplitude = Math.max(-enabledDims, Math.min(enabledDims, amplitude))

  if (closed.length < minBars) return ABSTAIN_LOW_BARS(closed.length, minBars)

  return {
    active: true,
    abstain: null,
    sign: amplitude > 0 ? 1 : amplitude < 0 ? -1 : 0,
    amplitude,
    observed,
    enabledDims,
    votes,
    score: amplitude > 0 ? 1 : amplitude < 0 ? -1 : 0
  }
}

/**
 * Converge multiple planes into one read (spec R3/R5). Pure; no I/O.
 * @param {object} opts
 * @param {object} opts.planes - { tfSeconds: candles[] }
 * @param {object} [opts.sourceByTf={}] - { tfSeconds: "live"|"aggregate"|"backfill"|"unknown" }
 * @param {boolean} [opts.dropOpen=false]
 * @param {object} [opts.dims={}] - dimension enable map (3a). Either flat
 *   { dim: boolean } applied to every plane, or per-timeframe
 *   { tfSeconds: { dim: boolean } }; default all enabled.
 * @param {object} [opts.weights=null] - { tfSeconds: weight }; null => equal (pure sign-sum)
 * @param {object} [opts.labels={}] - { tfSeconds: "entry"|"confirm"|"bias"|"context" } plane labels (2a)
 * @param {number} [opts.minBars=MIN_BARS]
 * @returns {object} { ok, meta, composite, compositeDirection, score5, quality, confidence, planes }
 *   score5 = round(5 * aligned/active); quality 1-10; confidence %. All three are
 *   null when no plane is active ("no samples -> \u2014", R5).
 */
export function converge({ planes = {}, sourceByTf = {}, dropOpen = false, dims = {}, weights = null, labels = {}, minBars = MIN_BARS } = {}) {
  const tfKeys = Object.keys(planes)
  const requested = tfKeys.length
  const available = tfKeys.filter((tf) => Array.isArray(planes[tf]) && planes[tf].length > 0).length

  // Object keys are strings; numeric timeframe-seconds are emitted as numbers
  // so callers (and tests) can compare `p.tf === 60` directly.
  const NUMERIC_KEY = /^-?\d+(\.\d+)?$/
  const tfOf = (key) => (NUMERIC_KEY.test(key) ? Number(key) : key)

  // Per-timeframe dimension config (3a): flat {dim:boolean} applies to every
  // plane; a map keyed by timeframe seconds overrides per plane.
  const dimsIsFlat = DIMENSIONS.some((d) => dims[d] !== undefined)
  const dimsFor = (tf) => (dimsIsFlat ? dims : (dims[String(tf)] ?? dims[tf] ?? {}))

  const perPlane = tfKeys.map((key) => {
    const tf = tfOf(key)
    const source = sourceByTf[key] ?? "unknown"
    const label = labels[key] ?? labels[tf] ?? null
    const ps = planeScore({ candles: planes[key], dropOpen, dims: dimsFor(tf), minBars })
    if (!ps.active) return { tf, ...ps, source, label, abstain: ps.abstain }
    return { tf, ...ps, source, label }
  })

  const active = perPlane.filter((p) => p.active)
  const nActive = active.length

  // Weighted composite, normalized to [-1, +1]; default weights equal (pure sign-sum).
  let num = 0
  let den = 0
  for (const p of active) {
    const w = weights?.[p.tf] ?? 1
    num += w * p.sign
    den += w
  }
  const composite = den > 0 ? num / den : 0
  const compositeDirection = composite > 0 ? 1 : composite < 0 ? -1 : 0

  const aligned = nActive > 0 && compositeDirection !== 0 ? active.filter((p) => p.sign === compositeDirection).length : 0
  const agreement = nActive > 0 && compositeDirection !== 0 ? aligned / nActive : 0
  // Strength is normalized per plane by THAT plane's enabled dimension count
  // (so per-timeframe configs cannot inflate or deflate the number).
  const avgStrength = nActive > 0
    ? active.reduce((s, p) => s + Math.abs(p.amplitude) / Math.max(p.enabledDims, 1), 0) / nActive
    : 0

  const score5 = nActive === 0 ? null : Math.round((5 * aligned) / nActive)
  const quality = nActive === 0 ? null : Math.round(10 * (0.5 * (nActive / Math.max(available, 1)) + 0.5 * agreement))
  const confidence = nActive === 0 ? null : Math.round(100 * (0.6 * agreement + 0.4 * avgStrength))

  return {
    ok: requested > 0,
    meta: {
      requested,
      available,
      active: nActive,
      aligned,
      compositeDirection,
      enabledDims: DIMENSIONS.filter((d) => dims[d] !== false).length,
      minBars,
      dropOpen
    },
    composite,
    compositeDirection,
    score5,
    quality,
    confidence,
    planes: perPlane
  }
}

/**
 * Thin async data seam (spec 1d): gather candles + source labels for a list of
 * timeframes through a caller-supplied fetcher. Slice 6 wires the real
 * fetchers; this stays testable with mocked brokers.
 * @param {number[]} tfs - timeframe seconds
 * @param {(tf:number)=>(Promise<{candles:Array, source?:string}|Array>)} fetcher
 */
export async function fetchPlanes(tfs, fetcher) {
  const planes = {}
  const sourceByTf = {}
  for (const tf of tfs) {
    try {
      const res = await fetcher(tf)
      if (Array.isArray(res)) {
        planes[tf] = res
        sourceByTf[tf] = "unknown"
      } else {
        planes[tf] = Array.isArray(res?.candles) ? res.candles : []
        sourceByTf[tf] = res?.source ?? "unknown"
      }
    } catch {
      // Honest failure: the plane is absent and the absence is labeled, never
      // silently zero-filled.
      planes[tf] = []
      sourceByTf[tf] = "error"
    }
  }
  return { planes, sourceByTf }
}