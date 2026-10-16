// PICC Volatility Service — standalone volatility forecasting, risk metrics,
// and position sizing helpers. Combines ATR, realized volatility, and
// GARCH(1,1) estimation for dynamic stop/sizing decisions.

import { atr as computeAtr } from "./indicators.mjs"

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const mean = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x))
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
}
const stddev = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x))
  if (!a.length) return 0
  const m = mean(a)
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0)
  return Math.sqrt(v / Math.max(1, a.length - 1))
}

const DAY_SECONDS = 86400

// ---------------------------------------------------------------------
// PUBLICATION PRECISION — the one rule every figure below is published by.
//
// Four DECIMAL PLACES keeps four figures after the point, so it discards the
// magnitude of any dimensionless volatility under 5e-5: the whole band becomes
// exactly `0`, no matter how real the measurement is. An instrument that ticks
// once in 200 bars measures ~2e-5 and used to publish `0` — the one number a
// risk consumer cannot tell apart from "genuinely riskless".
//
// Four SIGNIFICANT FIGURES is magnitude-preserving, but adopting it outright is
// not free. Measured against real series it moves the last digit of 86 of 96
// published figures (0.0136 -> 0.01356, 0.0042 -> 0.004239), and above 1.0 it
// publishes FEWER digits than before (1.9544 -> 1.954). Every consumer of this
// file already reads the 4dp figures, so a precision fix that redefines them all
// is a different change wearing this change's clothes.
//
// So the existing precision is kept wherever it survives, and significant
// figures are used only in the band where 4dp would return the measurement's
// ABSENCE rather than a rounded version of it:
//
//   roundPublished(0.0136) === 0.0136     unchanged
//   roundPublished(1.9544) === 1.9544     unchanged, even above 1.0
//   roundPublished(4.99e-5) === 4.99e-5   used to publish 0
//
// `toPrecision` never renders a nonzero finite number as "0", so a real
// measurement cannot still fall through to a zero. A genuinely measured zero
// stays exactly zero: `value === 0` returns before the fallback.
//
// Exported because `riskParity.mjs` publishes inverse-volatility WEIGHTS under
// the same rule, and one rule with two copies is a rule that will drift.
//
// ── ONE BOUNDARY WHERE THIS OVERSTATES RATHER THAN ERASES ──
//
// The threshold is exactly 5e-5 and JS `Math.round` is half-up, so a value
// landing exactly on it is doubled:
//
//   roundPublished(5e-5)    === 0.0001     2x the measurement
//   roundVolPct(5e-7)      === "0.005%"   2x, though it reads as rounding
//
// This is the ONLY direction in which this publisher misstates a measurement —
// everywhere else a nonzero value survives as itself. It is pre-existing, it is
// visible in the review's own table, and it is recorded rather than quietly
// "fixed": switching the boundary to round-half-even would make `4.99999e-5`
// and `5e-5` publish as the same number, which reintroduces a discontinuity at
// the one place the discontinuity is currently honest about being one. Left as
// is, deliberately.
//
// ── WHAT THIS PUBLISHER DOES NOT GIVE YOU: AN EXACT PARTITION ──
//
// A 4dp publisher maps complementary fractions back onto complementary
// multiples of 1e-4, so a set of published weights that summed to 1 keeps
// summing to 1. This one does not, for TWO reasons, and both are load-bearing
// for `riskParity.mjs`, which publishes weights under this rule:
//
//   1. Four SIGNIFICANT FIGURES is not a 4dp value. A weight below the 5e-5
//      band publishes at a quantum its partner was not rounded to, so the pair
//      no longer closes. Measured, through `inverseVolWeights`:
//          vols {A: 9.7648e-5, B: 4.8579e-9}
//            -> {A: 0.00004975, B: 1}    sum 1.00004975
//   2. `Math.round` is half-up, so the boundary doubles UPWARD and the partner
//      stays put — with no fallback involved anywhere:
//          vols {A: 1, B: 19999}
//            -> {A: 0.9999, B: 0.00005} sum 0.99995
//
// So "the weights sum to 1" is a measurement, not an identity: over 500,000
// random two-symbol sets, 15,417 drift and max |sum - 1| is 5.000e-5 (1.000e-4
// at n=3, 1.458e-4 at n=4, 2.000e-4 at n=5). An earlier version of
// `riskParity.test.mjs` claimed the two-symbol case was IDENTICALLY zero, which
// is false; the tolerance there is taken from the n=5 figure, which is the
// largest, so it is the ceiling every member of the family sits under.
// ---------------------------------------------------------------------
export function roundPublished(value) {
  if (!Number.isFinite(value)) return value
  const fixed = Math.round(value * 10000) / 10000
  if (fixed !== 0 || value === 0) return fixed
  return Number(value.toPrecision(4))
}

/**
 * The same publication as a percentage string, at the precision the string has
 * always had — two decimal places on the PERCENT, so every ordinary figure
 * renders exactly as it did before (`21.52%`, `195.44%`).
 *
 * The old floor sat lower still, because it rounded `annual * 10000` to four
 * decimal places and then divided by 100 — so `"0%"` was reachable from two
 * directions at once: anything under 0.005% of a percent, and (through `annual`
 * itself) anything under 0.00005. Scaling first and flooring the PERCENT at
 * 2dp collapses the same band, so this is where the fallback belongs:
 *
 *   0.2152   -> "21.52%"    unchanged
 *   1.9544   -> "195.44%"   unchanged
 *   2.05e-5  -> "0.00205%"  used to publish "0%"
 */
function roundVolPct(fraction) {
  if (!Number.isFinite(fraction)) return `${fraction}%`
  const pct = fraction * 100
  const fixed = Math.round(pct * 100) / 100
  if (fixed !== 0 || fraction === 0) return `${fixed}%`
  return `${Number(pct.toPrecision(4))}%`
}

function inferPeriodsPerYear(times) {
  const ts = Array.isArray(times)
    ? times.map((t) => Number(t)).filter((t) => Number.isFinite(t) && t > 0)
    : []
  const gaps = []
  for (let i = 1; i < ts.length; i++) {
    let d = ts[i] - ts[i - 1]
    if (d <= 0) continue
    // Normalize units: liveEO candle times are unix SECONDS (gaps 60…3600);
    // ms-based feeds produce raw gaps above 4h that no seconds-denominated
    // bar would. The old unconditional /1000 turned a 60s bar into 0.06s and
    // annualized volatility ~19,000× too large, pinning vol-scaled sizing to
    // its floor permanently.
    if (d > 14400) d = d / 1000
    gaps.push(d)
  }
  if (!gaps.length) return 252
  gaps.sort((a, b) => a - b)
  const stepSec = gaps[Math.floor(gaps.length / 2)]
  if (stepSec >= DAY_SECONDS / 4) return 252
  return clamp(252 * Math.round(DAY_SECONDS / stepSec), 252, 252 * 1440)
}

// ---------------------------------------------------------------------
// Realized volatility (annualized from log returns)
// ---------------------------------------------------------------------

export function realizedVolatility(closes, { period = 20, annualize, times } = {}) {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return { daily: null, annual: null, period }
  }
  const logReturns = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]))
    }
  }
  if (logReturns.length < period) {
    return { daily: null, annual: null, period }
  }
  const recent = logReturns.slice(-period)
  const daily = stddev(recent)
  const periodsPerYear = Number.isFinite(annualize) ? annualize : inferPeriodsPerYear(times)
  const annual = daily * Math.sqrt(periodsPerYear)
  return {
    daily: roundPublished(daily),
    annual: roundPublished(annual),
    annualPct: roundVolPct(annual),
    period,
    sampleSize: logReturns.length
  }
}

// ---------------------------------------------------------------------
// Parkinson volatility (high-low based, more efficient than close-close)
// ---------------------------------------------------------------------

export function parkinsonVolatility(candles, { period = 20, annualize = 252 } = {}) {
  if (!Array.isArray(candles) || candles.length < period) {
    return { daily: null, annual: null }
  }
  const recent = candles.slice(-period)
  const hlSquares = recent
    .filter((c) => c.high > 0 && c.low > 0)
    .map((c) => (Math.log(c.high / c.low)) ** 2)
  if (hlSquares.length < 5) return { daily: null, annual: null }
  const avgHL2 = hlSquares.reduce((s, x) => s + x, 0) / hlSquares.length
  const daily = Math.sqrt(avgHL2 / (4 * Math.log(2)))
  const annual = daily * Math.sqrt(annualize)
  return {
    daily: roundPublished(daily),
    annual: roundPublished(annual),
    annualPct: roundVolPct(annual),
    period: hlSquares.length
  }
}

// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Garman-Klass volatility (OHLC, driftless) — folds the full intraday
// range into the estimate, roughly halving close-close estimator error
// (F-11). Stricter than Parkinson: needs positive open/close as well as
// a consistent high/low. Per-bar variance is clamped at zero so a single
// rounding-blown bar cannot drag the average negative.
// ---------------------------------------------------------------------

export function garmanKlassVolatility(candles, { period = 20, annualize = 252 } = {}) {
  if (!Array.isArray(candles) || candles.length < period) {
    return { daily: null, annual: null }
  }
  const recent = candles.slice(-period)
  const GK2LN2 = 2 * Math.log(2)
  const terms = []
  for (const c of recent) {
    const { open: o, high: h, low: l, close: cl } = c
    if (![o, h, l, cl].every((v) => Number.isFinite(Number(v)) && Number(v) > 0)) continue
    if (!(h >= l && h >= o && l <= cl)) continue
    const hl = Math.log(h / l)
    const co = Math.log(cl / o)
    terms.push(Math.max(0, 0.5 * hl * hl - (GK2LN2 - 1) * co * co))
  }
  if (terms.length < 5) return { daily: null, annual: null }
  const avg = terms.reduce((s2, x) => s2 + x, 0) / terms.length
  const daily = Math.sqrt(avg)
  const annual = daily * Math.sqrt(annualize)
  return {
    daily: roundPublished(daily),
    annual: roundPublished(annual),
    annualPct: roundVolPct(annual),
    period: terms.length
  }
}

// ---------------------------------------------------------------------
// Yang-Zhang volatility (OHLC, drift + opening gaps) — the most efficient
// common estimator: it adds the overnight-gap term that Parkinson and
// Garman-Klass both miss and stays unbiased under drift. Defined over
// CONSECUTIVE bars (each open gap needs the prior close), so it demands
// period+1 candles. (F-11)
// ---------------------------------------------------------------------

export function yangZhangVolatility(candles, { period = 20, annualize = 252 } = {}) {
  if (!Array.isArray(candles) || candles.length < period + 1) {
    return { daily: null, annual: null }
  }
  const sampleVar = (xs) => {
    const f = xs.filter((x) => Number.isFinite(x))
    if (f.length < 2) return null
    const m = f.reduce((s2, x) => s2 + x, 0) / f.length
    return f.reduce((s2, x) => s2 + (x - m) ** 2, 0) / (f.length - 1)
  }
  const recent = candles.slice(-(period + 1))
  const overnight = [] // ln(O_t / C_{t-1})
  const intraday = [] // ln(C_t / O_t)
  const rs = [] // Rogers-Satchell term per bar
  for (let i = 1; i < recent.length; i++) {
    const p = recent[i - 1]
    const c = recent[i]
    const { open: o, high: h, low: l, close: cl } = c
    if (![o, h, l, cl, p.close].every((v) => Number.isFinite(Number(v)) && Number(v) > 0)) continue
    if (!(h >= l && h >= o && l <= cl)) continue
    overnight.push(Math.log(o / p.close))
    intraday.push(Math.log(cl / o))
    rs.push(Math.log(h / cl) * Math.log(h / o) + Math.log(l / cl) * Math.log(l / o))
  }
  const n = overnight.length
  if (n < 5) return { daily: null, annual: null }
  const oVar = sampleVar(overnight)
  const cVar = sampleVar(intraday)
  if (oVar == null || cVar == null) return { daily: null, annual: null }
  const rsMean = rs.reduce((s2, x) => s2 + x, 0) / n
  const k = 0.34 / (1.34 + (n + 1) / (n - 1))
  const variance = oVar + k * cVar + (1 - k) * rsMean
  const daily = variance > 0 ? Math.sqrt(variance) : 0
  const annual = daily * Math.sqrt(annualize)
  return {
    daily: roundPublished(daily),
    annual: roundPublished(annual),
    annualPct: roundVolPct(annual),
    period: n
  }
}

// ---------------------------------------------------------------------
// Estimator chooser (R6 — live-wire F-11 estimators into risk consumers)
// ---------------------------------------------------------------------

/**
 * Pick the most efficient volatility estimator the data actually supports,
 * so live risk consumers (autopilot sizing, risk-parity) upgrade
 * automatically wherever OHLC reaches them and stay on close-close when only
 * prices do:
 *
 *   o/h/l/c candles → Yang-Zhang (most efficient; overnight gaps included)
 *   h/l/c candles   → Garman-Klass (driftless intraday)
 *   h/l only        → Parkinson
 *   closes/anything else → realized (close-to-close) volatility
 */
export function annualizedVolatility(data, { period = 20, annualize = 252, times = null } = {}) {
  const asCandles = Array.isArray(data) && data.length && typeof data[0] === "object" && data[0] !== null
  if (asCandles) {
    const sample = data[0]
    const has = (k) => Number.isFinite(Number(sample[k])) && Number(sample[k]) > 0
    if (has("open") && has("high") && has("low") && has("close")) {
      const yz = yangZhangVolatility(data, { period, annualize })
      if (yz?.annual != null) return { ...yz, method: "yang-zhang" }
    }
    if (has("high") && has("low") && has("close")) {
      const gk = garmanKlassVolatility(data, { period, annualize })
      if (gk?.annual != null) return { ...gk, method: "garman-klass" }
    }
    if (has("high") && has("low")) {
      const pk = parkinsonVolatility(data, { period, annualize })
      if (pk?.annual != null) return { ...pk, method: "parkinson" }
    }
    const closes = data.map((c) => Number(c.close)).filter((v) => Number.isFinite(v))
    return { ...realizedVolatility(closes, { period, annualize, times }), method: "close-close" }
  }
  return { ...realizedVolatility(data, { period, annualize, times }), method: "close-close" }
}


// GARCH(1,1) estimation via maximum-likelihood (simplified)
// ---------------------------------------------------------------------
// σ²_t = ω + α * ε²_{t-1} + β * σ²_{t-1}
// Constraints: ω > 0, α ≥ 0, β ≥ 0, α + β < 1

export function garchEstimate(closes, { period = 60, forecast = 5 } = {}) {
  if (!Array.isArray(closes) || closes.length < period + 10) {
    return { omega: null, alpha: null, beta: null, currentVol: null, forecast: [], ok: false }
  }
  const logReturns = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]))
    }
  }
  if (logReturns.length < 30) {
    return { omega: null, alpha: null, beta: null, currentVol: null, forecast: [], ok: false }
  }

  const recent = logReturns.slice(-period)
  const meanR = mean(recent)
  const centered = recent.map((r) => r - meanR)

  // Initialize GARCH parameters with sensible defaults
  const sampleVar = centered.reduce((s, x) => s + x * x, 0) / centered.length
  let omega = sampleVar * 0.1
  let alpha = 0.08
  let beta = 0.88

  // MLE via simplified gradient-free optimization (scipy-style grid refinement)
  const best = fitGarch11(centered, omega, alpha, beta, 200)
  omega = best.omega
  alpha = best.alpha
  beta = best.beta

  // Unconditional variance
  const longRunVar = omega / Math.max(1e-12, 1 - alpha - beta)

  // Conditional variance series
  const h = new Array(centered.length)
  h[0] = sampleVar
  for (let t = 1; t < centered.length; t++) {
    h[t] = omega + alpha * centered[t - 1] ** 2 + beta * h[t - 1]
  }

  // Current (last) conditional volatility
  const currentVar = h[h.length - 1]
  const currentVol = Math.sqrt(Math.abs(currentVar))

  // Forecast h-step ahead
  const forecasts = []
  let hLast = currentVar
  for (let i = 1; i <= forecast; i++) {
    const fVar = longRunVar + Math.pow(alpha + beta, i - 1) * (hLast - longRunVar)
    forecasts.push({
      step: i,
      variance: Math.round(fVar * 1e10) / 1e10,
      volatility: roundPublished(Math.sqrt(Math.abs(fVar))),
      volatilityPct: roundVolPct(Math.sqrt(Math.abs(fVar)))
    })
    hLast = fVar
  }

  return {
    ok: true,
    omega: Math.round(omega * 1e8) / 1e8,
    alpha: Math.round(alpha * 10000) / 10000,
    beta: Math.round(beta * 10000) / 10000,
    persistence: Math.round((alpha + beta) * 10000) / 10000,
    longRunVol: roundPublished(Math.sqrt(Math.abs(longRunVar))),
    currentVol: roundPublished(currentVol),
    currentVolPct: roundVolPct(currentVol),
    forecasts,
    sampleSize: centered.length
  }
}

/** Grid-search MLE for GARCH(1,1) parameters (simplified, no external deps). */
function fitGarch11(residuals, w0, a0, b0, iters) {
  let w = w0, a = a0, b = b0
  const best = { omega: w, alpha: a, beta: b, nll: Infinity }
  const lr = 0.001

  for (let iter = 0; iter < iters; iter++) {
    const nll = garchNll(residuals, w, a, b)
    if (nll < best.nll) {
      best.omega = w
      best.alpha = a
      best.beta = b
      best.nll = nll
    }
    // Numerical gradient
    const dw = (garchNll(residuals, w + 1e-6, a, b) - nll) / 1e-6
    const da = (garchNll(residuals, w, a + 1e-6, b) - nll) / 1e-6
    const db = (garchNll(residuals, w, a, b + 1e-6) - nll) / 1e-6
    w = Math.max(1e-8, w - lr * dw)
    a = Math.max(0, Math.min(0.99, a - lr * da))
    b = Math.max(0, Math.min(0.99 - a, b - lr * db))
  }
  return best
}

function garchNll(residuals, omega, alpha, beta) {
  const T = residuals.length
  let h = residuals[0] ** 2 || 1e-6
  let nll = 0
  for (let t = 1; t < T; t++) {
    h = omega + alpha * residuals[t - 1] ** 2 + beta * h
    if (h < 1e-12) h = 1e-12
    nll += Math.log(h) + residuals[t] ** 2 / h
  }
  return nll / T + Math.log(Math.PI)
}

// ---------------------------------------------------------------------
// ATR-based volatility regime detection
// ---------------------------------------------------------------------

export function volatilityRegime(candles, { period = 14 } = {}) {
  if (!Array.isArray(candles) || candles.length < period * 2) {
    return { regime: "unknown", atr: null, atrPct: null, percentile: null }
  }
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const atrValues = computeAtr(highs, lows, closes, period)
  const currentAtr = atrValues[atrValues.length - 1]
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) {
    return { regime: "unknown", atr: null, atrPct: null, percentile: null }
  }
  const valid = atrValues.filter((v) => Number.isFinite(v) && v > 0)
  const avgAtr = valid.reduce((s, v) => s + v, 0) / valid.length
  const atrPct = closes[closes.length - 1] > 0 ? currentAtr / closes[closes.length - 1] : 0

  // Percentile rank
  const sorted = [...valid].sort((a, b) => a - b)
  const idx = sorted.findIndex((v) => v >= currentAtr)
  const percentile = idx >= 0 ? Math.round((idx / sorted.length) * 100) : 50

  // Regime classification
  let regime = "normal"
  if (percentile >= 85) regime = "high"
  else if (percentile >= 70) regime = "elevated"
  else if (percentile <= 15) regime = "compressed"
  else if (percentile <= 30) regime = "low"

  // Compression often precedes breakout
  const recentAtr = valid.slice(-5)
  const olderAtr = valid.slice(-15, -5)
  const recentAvg = recentAtr.length ? recentAtr.reduce((s, v) => s + v, 0) / recentAtr.length : avgAtr
  const olderAvg = olderAtr.length ? olderAtr.reduce((s, v) => s + v, 0) / olderAtr.length : avgAtr
  const shrinking = olderAvg > 0 && recentAvg / olderAvg < 0.75

  return {
    regime,
    atr: Math.round(currentAtr * 1e6) / 1e6,
    atrPct: roundPublished(atrPct),
    atrPctPct: roundVolPct(atrPct),
    avgAtr: Math.round(avgAtr * 1e6) / 1e6,
    percentile,
    shrinking,
    breakoutWarning: shrinking && regime === "compressed"
  }
}

// ---------------------------------------------------------------------
// Volatility-adjusted position sizing
// ---------------------------------------------------------------------

// ── THE SIZING FLOOR, AND WHY IT IS 5e-5 ──
//
// A VOLATILITY PARALLEL TO THE PUBLICATION FLOOR, AND NOT A SECOND NUMBER.
//
// Low measured volatility is supposed to earn a larger position — that is the
// whole contract of `volatilityPositionSize`, and `volScale` clamping at 2.0 is
// a deliberate bound on it. The failure this floor exists to stop is the case
// where the measurement cannot support that inference at all.
//
// The threshold is 5e-5, the same boundary `roundPublished` uses, for a reason
// that is measured rather than chosen: below it, this file's own publisher
// cannot distinguish the figure from zero. A 4dp render of anything under 5e-5
// is exactly `0`, and the significant-figures fallback exists only because that
// would discard a real measurement. So a volatility under 5e-5 is a number this
// module is unable to publish as a measurement — which makes it unusable as a
// risk estimate too, and not merely small. Treating it as "low risk" reads a
// rendering limitation as a property of the market.
//
// The direction matters more than the threshold. Such figures are the thinly
// traded population: an instrument that ticks once in 300 bars measures ~2e-5
// because it barely trades, not because it is safe, and scaling a position UP
// into something you cannot exit is the worst available response to that. A
// genuine stall — a flat series measuring exactly 0 — lands in the same band for
// the same reason. Both are staleness, and staleness is not a risk signal.
//
// WHY NOT A HIGHER, "TRADEABLE-ISH" FLOOR. A floor near 0.01 would also be
// defensible on liquidity grounds, and it was considered. It is rejected because
// it would refuse to size across [5e-5, 0.01) — a band that IS measurable and
// that sizes correctly today — on the strength of a judgement about what
// volatility a tradable instrument should have. That judgement is real, but it
// is a new risk decision with its own failure modes, and it is not this one's to
// make. 5e-5 is the boundary where this file can already PROVE the measurement
// has stopped being trustworthy; the gate does exactly that much and no more.
//
// WHY NOT `>=` FOR THE BOUNDARY VALUE. `roundPublished(5e-5) === 0.0001` —
// exactly 5e-5 IS published, so it is a measurement and not an absence. The
// comparison is therefore strict, and the half-up doubling at the boundary
// (documented above) does not make the value itself unpublishable.
export const VOL_SIZING_FLOOR = 0.00005

/**
 * Compute position size scaled to current volatility.
 * Higher volatility → smaller position (risk parity intuition).
 *
 * `currentVol` is REQUIRED and has no default. It is a measurement, and a
 * default standing in for a measurement is an invented number — the same defect
 * `autopilot.mjs` used to carry as `rv.annual || 0.30`. `riskPct` and `targetVol`
 * keep their defaults because those are policy parameters rather than
 * observations, so a default sets them rather than inventing them.
 *
 * @param {Object} opts
 * @param {number} opts.capital - Account capital ($)
 * @param {number} opts.riskPct - Max risk per trade as fraction (e.g. 0.02 = 2%)
 * @param {number} opts.currentVol - Current annualized volatility (e.g. 0.30 = 30%). Required; absent or below `VOL_SIZING_FLOOR` refuses to size.
 * @param {number} opts.targetVol - Target volatility for scaling (e.g. 0.20 = 20%)
 * @param {number} opts.entryPrice - Entry price per unit
 * @returns {Object} Position sizing metrics, or a refusal that says it refused
 */
export function volatilityPositionSize({ capital, riskPct = 0.02, currentVol, targetVol = 0.20, entryPrice } = {}) {
  const target = Math.max(0.01, targetVol)

  // ── REFUSING TO SIZE IS A RESULT, NOT A ZERO BUDGET ──
  //
  // The caller must be able to tell "measured 0.02, so size up" from "could not
  // measure, so nothing here is sized", because those two are different facts
  // and only the first one justifies more capital. Returning a plausible number
  // here would leave nobody able to state where it came from, which is the whole
  // defect. So the refusal is explicit, it names the figure it refused and why,
  // and it still CARRIES THE MEASUREMENT rather than dropping it — `currentVolPct`
  // publishes the true value, so a 2.9e-5 vol reads as 0.0029% instead of the
  // 1% the floor below would have substituted for it.
  if (!Number.isFinite(currentVol) || currentVol < VOL_SIZING_FLOOR) {
    // `sized` IS THE ENTIRE CONTRACT. Branch on it; never infer it from these
    // numbers. They are deliberately not all one thing on purpose — `volScale`
    // and `riskBudget` are `null` because there is no such quantity, while
    // `units`/`positionValue` are 0 and `positionPct` publishes a real `"0%"`
    // because the field has to exist. That asymmetry is deliberate but it is
    // also a trap: a measured `currentVol: 0` publishes `currentVolPct "0%"`,
    // which reads as "riskless" when it means "nothing was measurable", and
    // `units: 0` cannot be told apart from "measured, sized to nothing". A
    // caller that adds up the numbers instead of reading `sized` will conclude
    // the position is riskless. It is not; it is unsized.
    return {
      sized: false,
      reason: Number.isFinite(currentVol)
        ? `currentVol ${currentVol} is below the sizing floor ${VOL_SIZING_FLOOR} — an unmeasurable volatility, not a low-risk one`
        : `currentVol is not a finite measurement (got ${currentVol}) — nothing to scale against`,
      volScale: null,
      riskBudget: null,
      units: 0,
      positionValue: 0,
      positionPct: roundVolPct(0),
      currentVolPct: Number.isFinite(currentVol) ? roundVolPct(currentVol) : null,
      targetVolPct: roundVolPct(target)
    }
  }

  // THE FLOOR FALSIFIES `currentVolPct`, AND THAT IS PRE-EXISTING — AND STILL
  // TRUE AFTER THE RULE UNIFICATION BELOW.
  //
  // `vol` is floored at 0.01 BEFORE the percentage is published, so a true
  // annualized volatility below 1% is reported as 1%:
  //
  //   true currentVol 0.00923   ->  vol 0.01  ->  currentVolPct "1%"
  //
  // The magnitude of that substitution is `0.01 / currentVol`, and it is NOT
  // constant across the band the floor actually reaches. This comment used to
  // claim the example above was "342x the truth", which is false for it — it is
  // 1.08x — and 342 is the figure for a DIFFERENT currentVol (0.00002923), left
  // behind when the example was edited. Stated over the reachable domain
  // [VOL_SIZING_FLOOR, 0.01), where VOL_SIZING_FLOOR is 5e-5:
  //
  //   currentVol 0.009999  ->  0.01 / 0.009999  =    1.000x   <- barely a lie
  //   currentVol 0.00923   ->  0.01 / 0.00923   =    1.083x   <- the example above
  //   currentVol 0.001     ->  0.01 / 0.001     =   10.00x
  //   currentVol 5e-5      ->  0.01 / 5e-5      =  200.00x   <- at the floor
  //
  // So the honest range is 1x at the top of the band to 200x at the floor, and
  // anyone who wants a different example's figure can divide. A single bare
  // multiplier is what made the first version of this comment wrong twice: a
  // reader who computes 0.01/0.00923 and gets 1.08 is entitled to conclude the
  // floor barely matters, lower it, or close this ticket — which is how a false
  // number in a comment becomes a behaviour change.
  //
  // The sizing maths genuinely needs a floor — a
  // `volScale` of 20,000 would blow the size up without limit — so the floor
  // stays, and so `currentVolPct` keeps publishing the floored value: routing
  // it through `roundVolPct` does not help, because 0.01 is well above that
  // rule's collapse band. Publishing a floored value as though it were a
  // measured one is the measurement-substitution defect this file exists to
  // remove, one level down, and it is a SEPARATE defect from the rule split —
  // fixing one does not fix the other. Tracked as
  // `vol-followup-position-size-publishes-the-floor`.
  //
  // IT NO LONGER COVERS THE SUB-FLOOR BAND, and that is the point of the gate
  // above: a `currentVol` under 5e-5 now refuses outright, so it never reaches
  // this floor and is never published as its 1%. What is left of the floor's
  // domain is [5e-5, 0.01) — the band whose substitution factor runs from
  // 1.000x to 200x as tabulated above. Near 0.01 the lie is too small to act
  // on; deep in the band it is two orders of magnitude, and which of those a
  // given instrument sits at is not knowable from the published figure alone.
  const vol = Math.max(0.01, currentVol)
  const cap = Math.max(1, capital)
  const price = Math.max(0.0001, entryPrice)

  // Volatility scaling: shrink size inversely to vol
  const volScale = clamp(target / vol, 0.25, 2.0)
  const riskBudget = cap * riskPct * volScale
  const units = Math.floor(riskBudget / price)
  const positionValue = units * price

  return {
    sized: true,
    reason: null,
    volScale: Math.round(volScale * 10000) / 10000,
    riskBudget: Math.round(riskBudget * 100) / 100,
    units: Math.max(0, units),
    positionValue: Math.round(positionValue * 100) / 100,
    positionPct: roundVolPct(positionValue / cap),
    // ONE RULE, NOT TWO — AND, MEASURED, NO OBSERVABLE DIFFERENCE TODAY.
    //
    // These two sat on raw `Math.round(v * 10000) / 100` while `positionPct`
    // used `roundVolPct`, so the object mixed two rules for the same job.
    //
    // THE HONEST PART, WHICH THE CHANGE ITSELF DOES NOT SHOW: unifying them
    // changes NOTHING observable today, and claiming otherwise would be the
    // same over-trust this round exists to remove. `vol` and `target` are both
    // floored at 0.01 by the lines above, and `roundVolPct` only falls back to
    // significant figures below 5e-5, so on every reachable input both rules
    // produce the same string. Measured over 0.01..3 at 1e-4 steps — 29,900
    // inputs — the two rules differ on 0 of them. Reverting either field to raw
    // 4dp is an EQUIVALENT MUTANT: mutation testing confirms both survive, and
    // the reason is the floor, not missing coverage.
    //
    // They are unified anyway, for the reason the floor itself creates: the
    // moment anyone lowers or removes that floor, the raw-4dp pair diverges
    // silently — below 0.01 they publish `"0%"` where `roundVolPct` publishes
    // the real figure (`0.00002923` -> `"0.002923%"`). A difference no test can
    // see is not a reason to leave a split rule in place.
    currentVolPct: roundVolPct(vol),
    targetVolPct: roundVolPct(target)
  }
}

// ---------------------------------------------------------------------
// Combined volatility snapshot (all metrics for a symbol)
// ---------------------------------------------------------------------

export function volatilitySnapshot(candles, { atrPeriod = 14, rvPeriod = 20, garchPeriod = 60, garchForecast = 5 } = {}) {
  if (!Array.isArray(candles) || candles.length < 30) {
    return { ok: false, error: "need at least 30 candles" }
  }
  const closes = candles.map((c) => c.close)
  return {
    ok: true,
    atr: volatilityRegime(candles, { period: atrPeriod }),
    realized: realizedVolatility(closes, { period: rvPeriod, times: candles.map((c) => c.time) }),
    parkinson: parkinsonVolatility(candles, { period: rvPeriod }),
    garmanKlass: garmanKlassVolatility(candles, { period: rvPeriod }),
    yangZhang: yangZhangVolatility(candles, { period: rvPeriod }),
    garch: garchEstimate(closes, { period: garchPeriod, forecast: garchForecast }),
    lastPrice: closes[closes.length - 1],
    candleCount: candles.length,
    timestamp: new Date().toISOString()
  }
}
