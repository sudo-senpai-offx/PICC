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
  const m = mean(arr)
  const v = arr.filter((x) => Number.isFinite(x)).reduce((s, x) => s + (x - m) ** 2, 0)
  return Math.sqrt(v / Math.max(1, arr.length - 1))
}

// ---------------------------------------------------------------------
// Realized volatility (annualized from log returns)
// ---------------------------------------------------------------------

export function realizedVolatility(closes, { period = 20, annualize = 252 } = {}) {
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
  const annual = daily * Math.sqrt(annualize)
  return {
    daily: Math.round(daily * 10000) / 10000,
    annual: Math.round(annual * 10000) / 10000,
    annualPct: Math.round(annual * 10000) / 100 + "%",
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
    daily: Math.round(daily * 10000) / 10000,
    annual: Math.round(annual * 10000) / 10000,
    annualPct: Math.round(annual * 10000) / 100 + "%",
    period: hlSquares.length
  }
}

// ---------------------------------------------------------------------
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
      volatility: Math.round(Math.sqrt(Math.abs(fVar)) * 10000) / 10000,
      volatilityPct: Math.round(Math.sqrt(Math.abs(fVar)) * 10000) / 100 + "%"
    })
    hLast = fVar
  }

  return {
    ok: true,
    omega: Math.round(omega * 1e8) / 1e8,
    alpha: Math.round(alpha * 10000) / 10000,
    beta: Math.round(beta * 10000) / 10000,
    persistence: Math.round((alpha + beta) * 10000) / 10000,
    longRunVol: Math.round(Math.sqrt(Math.abs(longRunVar)) * 10000) / 10000,
    currentVol: Math.round(currentVol * 10000) / 10000,
    currentVolPct: Math.round(currentVol * 10000) / 100 + "%",
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
    atrPct: Math.round(atrPct * 10000) / 10000,
    atrPctPct: Math.round(atrPct * 10000) / 100 + "%",
    avgAtr: Math.round(avgAtr * 1e6) / 1e6,
    percentile,
    shrinking,
    breakoutWarning: shrinking && regime === "compressed"
  }
}

// ---------------------------------------------------------------------
// Volatility-adjusted position sizing
// ---------------------------------------------------------------------

/**
 * Compute position size scaled to current volatility.
 * Higher volatility → smaller position (risk parity intuition).
 *
 * @param {Object} opts
 * @param {number} opts.capital - Account capital ($)
 * @param {number} opts.riskPct - Max risk per trade as fraction (e.g. 0.02 = 2%)
 * @param {number} opts.currentVol - Current annualized volatility (e.g. 0.30 = 30%)
 * @param {number} opts.targetVol - Target volatility for scaling (e.g. 0.20 = 20%)
 * @param {number} opts.entryPrice - Entry price per unit
 * @returns {Object} Position sizing metrics
 */
export function volatilityPositionSize({ capital, riskPct = 0.02, currentVol = 0.30, targetVol = 0.20, entryPrice } = {}) {
  const vol = Math.max(0.01, currentVol)
  const target = Math.max(0.01, targetVol)
  const cap = Math.max(1, capital)
  const price = Math.max(0.0001, entryPrice)

  // Volatility scaling: shrink size inversely to vol
  const volScale = clamp(target / vol, 0.25, 2.0)
  const riskBudget = cap * riskPct * volScale
  const units = Math.floor(riskBudget / price)
  const positionValue = units * price

  return {
    volScale: Math.round(volScale * 10000) / 10000,
    riskBudget: Math.round(riskBudget * 100) / 100,
    units: Math.max(0, units),
    positionValue: Math.round(positionValue * 100) / 100,
    positionPct: Math.round((positionValue / cap) * 10000) / 100 + "%",
    currentVolPct: Math.round(vol * 10000) / 100 + "%",
    targetVolPct: Math.round(target * 10000) / 100 + "%"
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
    realized: realizedVolatility(closes, { period: rvPeriod }),
    parkinson: parkinsonVolatility(candles, { period: rvPeriod }),
    garch: garchEstimate(closes, { period: garchPeriod, forecast: garchForecast }),
    lastPrice: closes[closes.length - 1],
    candleCount: candles.length,
    timestamp: new Date().toISOString()
  }
}
