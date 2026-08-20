// PICC Advanced Prediction Models
//
// Pure-JS implementations of time-series forecasting models that extend the
// base 4-model ensemble. Each model takes a close-price array and returns an
// expected log-return direction for the forecast horizon.
//
// Models:
//   1. ARIMA(p,d,q) — AutoRegressive Integrated Moving Average
//   2. Prophet-like — Trend + seasonality decomposition (Holt-Winters)
//   3. LSTM-lite    — Sliding-window neural classifier (logistic regression)
//   4. GARCH-lite   — Volatility clustering model
//
// All are dependency-free and designed for short-horizon binary options (1-7 days).

const EPS = 1e-12

function mean(xs) {
  if (!xs.length) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function std(xs, m = mean(xs)) {
  if (xs.length < 2) return 0
  const v = xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length
  return Math.sqrt(v)
}

function logReturns(closes) {
  const out = []
  for (let i = 1; i < closes.length; i++) {
    const a = Math.log(Math.max(Number(closes[i - 1]) || EPS, EPS))
    const b = Math.log(Math.max(Number(closes[i]) || EPS, EPS))
    out.push(b - a)
  }
  return out
}

// ---------------------------------------------------------------------
// 1. ARIMA(p,d,q) — simplified but mathematically grounded
// ---------------------------------------------------------------------

/**
 * Estimate AR coefficients using Yule-Walker equations.
 * Returns array of p coefficients.
 */
function yuleWalker(series, p) {
  const n = series.length
  if (n <= p) return Array(p).fill(0)
  const m = mean(series)
  const centered = series.map(x => x - m)

  // Autocovariance at lags 0..p
  const gamma = new Array(p + 1).fill(0)
  for (let k = 0; k <= p; k++) {
    for (let t = 0; t < n - k; t++) {
      gamma[k] += centered[t] * centered[t + k]
    }
    gamma[k] /= n
  }

  if (gamma[0] < EPS) return Array(p).fill(0)

  // Solve Toeplitz system via Levinson-Durbin
  const a = new Array(p).fill(0)
  const f = gamma.slice(0, p + 1)

  for (let i = 0; i < p; i++) {
    let num = f[i + 1]
    for (let j = 0; j < i; j++) {
      num -= a[j] * f[i - j]
    }
    const denom = f[0] < EPS ? EPS : f[0]
    a[i] = num / denom
    for (let j = 0; j < Math.floor(i / 2) + 1; j++) {
      const aj = a[j]
      a[j] = a[j] - a[i] * a[i - 1 - j]
      if (j !== i - 1 - j) a[i - 1 - j] = a[i - 1 - j] - a[i] * aj
    }
  }
  return a
}

/**
 * ARIMA forecast: difference the series, fit AR model, forecast, integrate back.
 * Returns expected log-return over the horizon.
 */
export function arimaForecast(closes, horizon = 3, p = 3, q = 1) {
  if (closes.length < p + horizon + 5) return { direction: 0, strength: 0, model: "arima" }

  // Step 1: First differencing (d=1)
  const returns = logReturns(closes)
  if (returns.length < p + 5) return { direction: 0, strength: 0, model: "arima" }

  // Step 2: Fit AR(p) on differenced series
  const arCoeffs = yuleWalker(returns, p)

  // Step 3: Forecast h steps ahead using AR recursion
  const recent = returns.slice(-p)
  let forecast = 0
  for (let step = 1; step <= horizon; step++) {
    let pred = 0
    for (let j = 0; j < p; j++) {
      const idx = recent.length - 1 - j
      pred += arCoeffs[j] * (idx >= 0 ? recent[idx] : 0)
    }
    forecast += pred
    // Shift window for multi-step
    if (step <= recent.length) recent[recent.length - step] = pred
  }

  // Step 4: MA correction — use residual variance as a shrinkage factor
  const residuals = returns.slice(-Math.min(50, returns.length))
  const residStd = std(residuals)
  const shrinkage = Math.max(0.3, 1 - residStd * 10) // higher vol → more shrinkage
  forecast *= shrinkage

  const direction = Math.abs(forecast) < EPS ? 0 : forecast > 0 ? 1 : -1
  const strength = Math.min(1, Math.abs(forecast) / (residStd + EPS) * 2)

  return {
    direction,
    strength: Math.round(strength * 100) / 100,
    forecast,
    arCoeffs: arCoeffs.map(c => Math.round(c * 10000) / 10000),
    model: "arima"
  }
}

// ---------------------------------------------------------------------
// 2. Prophet-like — Trend + weekly seasonality (Holt-Winters)
// ---------------------------------------------------------------------

/**
 * Holt-Winters exponential smoothing with additive trend and seasonality.
 * Uses weekly seasonality (period=7) for daily data.
 */
export function holtWintersForecast(closes, horizon = 3, period = 7, alpha = 0.3, beta = 0.1, gamma = 0.2) {
  if (closes.length < period * 2 + horizon) return { direction: 0, strength: 0, model: "prophet" }

  const logs = closes.map(c => Math.log(Math.max(Number(c) || EPS, EPS)))
  const n = logs.length

  // Initialize level and trend from first two periods
  let level = mean(logs.slice(0, period))
  let trend = (mean(logs.slice(period, period * 2)) - mean(logs.slice(0, period))) / period

  // Seasonal indices
  const seasonal = new Array(period).fill(0)
  for (let i = 0; i < period; i++) {
    seasonal[i] = logs[i] - level
  }

  // Fit Holt-Winters
  for (let t = period; t < n; t++) {
    const prevLevel = level
    const val = logs[t]
    const sIdx = t % period

    level = alpha * (val - seasonal[sIdx]) + (1 - alpha) * (prevLevel + trend)
    trend = beta * (level - prevLevel) + (1 - beta) * trend
    seasonal[sIdx] = gamma * (val - level) + (1 - gamma) * seasonal[sIdx]
  }

  // Forecast
  let forecast = 0
  for (let h = 1; h <= horizon; h++) {
    const sIdx = (n - period + h - 1) % period
    forecast += (level + h * trend + seasonal[sIdx]) - logs[n - 1]
  }
  forecast /= horizon // average daily forecast

  // Volatility adjustment
  const recentReturns = logReturns(closes.slice(-Math.min(30, closes.length)))
  const vol = std(recentReturns)
  const strength = Math.min(1, Math.abs(forecast) / (vol + EPS) * 3)

  const direction = Math.abs(forecast) < EPS ? 0 : forecast > 0 ? 1 : -1

  return {
    direction,
    strength: Math.round(strength * 100) / 100,
    forecast,
    level: Math.round(level * 10000) / 10000,
    trend: Math.round(trend * 10000) / 10000,
    model: "prophet"
  }
}

// ---------------------------------------------------------------------
// 3. LSTM-lite — Sliding-window logistic regression
// ---------------------------------------------------------------------

/**
 * Extract features from a window of returns: [mean, std, skew, momentum, autocorr].
 */
function extractFeatures(returns, windowSize = 10) {
  if (returns.length < windowSize) return null
  const w = returns.slice(-windowSize)
  const m = mean(w)
  const s = std(w, m)
  const skew = s > EPS ? w.reduce((a, x) => a + Math.pow((x - m) / s, 3), 0) / w.length : 0
  const momentum = w[w.length - 1] - w[0]
  // Lag-1 autocorrelation
  let autocorr = 0
  if (w.length > 1) {
    const lag1 = w.slice(1)
    const lag0 = w.slice(0, -1)
    const m0 = mean(lag0), m1 = mean(lag1)
    const s0 = std(lag0, m0), s1 = std(lag1, m1)
    autocorr = s0 > EPS && s1 > EPS
      ? lag0.reduce((a, x, i) => a + (x - m0) * (lag1[i] - m1), 0) / (w.length * s0 * s1)
      : 0
  }
  // Volatility regime change
  const recentVol = std(w.slice(-Math.floor(windowSize / 2)))
  const olderVol = std(w.slice(0, Math.floor(windowSize / 2)))
  const volChange = olderVol > EPS ? (recentVol - olderVol) / olderVol : 0

  return [m, s, skew, momentum, autocorr, volChange]
}

/**
 * Simple logistic regression for direction prediction.
 * Uses gradient descent on the feature vector.
 */
export function lstmLiteForecast(closes, horizon = 3, windowSize = 10) {
  if (closes.length < windowSize + horizon + 20) return { direction: 0, strength: 0, model: "lstm" }

  const returns = logReturns(closes)
  const n = returns.length

  // Training: sliding window of features → label (future return > 0)
  const X = []
  const y = []
  for (let i = windowSize; i < n - horizon; i++) {
    const features = extractFeatures(returns, windowSize)
    if (!features) continue
    // Shift the window
    const shiftedReturns = returns.slice(i - windowSize, i)
    const feat = extractFeatures(shiftedReturns, windowSize)
    if (!feat) continue

    // Label: did price go up over the next `horizon` returns?
    const futureReturn = returns.slice(i, i + horizon).reduce((a, b) => a + b, 0)
    X.push(feat)
    y.push(futureReturn > 0 ? 1 : 0)
  }

  if (X.length < 10) return { direction: 0, strength: 0, model: "lstm" }

  // Logistic regression via gradient descent
  const nFeatures = X[0].length
  const weights = new Array(nFeatures).fill(0)
  const bias = 0
  const lr = 0.01
  const epochs = 50

  function sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z)))) }

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = 0; i < X.length; i++) {
      let z = bias
      for (let j = 0; j < nFeatures; j++) z += weights[j] * X[i][j]
      const pred = sigmoid(z)
      const error = pred - y[i]
      for (let j = 0; j < nFeatures; j++) {
        weights[j] -= lr * error * X[i][j]
      }
    }
  }

  // Predict on the latest window
  const latestFeatures = extractFeatures(returns, windowSize)
  if (!latestFeatures) return { direction: 0, strength: 0, model: "lstm" }

  let z = bias
  for (let j = 0; j < nFeatures; j++) z += weights[j] * latestFeatures[j]
  const prob = sigmoid(z)
  const direction = Math.abs(prob - 0.5) < 0.05 ? 0 : prob > 0.5 ? 1 : -1
  const strength = Math.abs(prob - 0.5) * 2 // 0 to 1

  return {
    direction,
    strength: Math.round(strength * 100) / 100,
    probability: Math.round(prob * 1000) / 1000,
    weights: weights.map(w => Math.round(w * 10000) / 10000),
    model: "lstm"
  }
}

// ---------------------------------------------------------------------
// 4. GARCH-lite — Volatility clustering (EGARCH simplified)
// ---------------------------------------------------------------------

/**
 * Simple GARCH(1,1) volatility forecast.
 * Returns expected volatility regime (expanding/contracting) which implies direction.
 */
export function garchForecast(closes, horizon = 3) {
  if (closes.length < 30) return { direction: 0, strength: 0, model: "garch" }

  const returns = logReturns(closes)
  const n = returns.length
  const m = mean(returns)

  // GARCH(1,1) parameters via method of moments approximation
  const sqReturns = returns.map(r => (r - m) * (r - m))
  const longRunVar = mean(sqReturns)

  // Estimate omega, alpha, beta from sample
  let omega = longRunVar * 0.1
  let alpha = 0.1
  let beta = 0.85

  // Fit via simple iterative scheme (5 iterations)
  for (let iter = 0; iter < 5; iter++) {
    let conditionalVar = longRunVar
    let logLik = 0
    for (let t = 1; t < n; t++) {
      const residual = returns[t - 1] - m
      conditionalVar = omega + alpha * residual * residual + beta * conditionalVar
      conditionalVar = Math.max(EPS, conditionalVar)
      logLik += -0.5 * (Math.log(2 * Math.PI * conditionalVar) + (returns[t] - m) * (returns[t] - m) / conditionalVar)
    }
    // Simple gradient adjustment
    const scale = Math.exp(logLik / n) > 0 ? 1.01 : 0.99
    omega *= scale
    alpha = Math.min(0.3, Math.max(0.01, alpha * scale))
    beta = Math.min(0.98, Math.max(0.5, beta * (2 - scale)))
  }

  // Forecast volatility path
  let h = longRunVar
  const volPath = []
  const recentResidual = returns[n - 1] - m
  h = omega + alpha * recentResidual * recentResidual + beta * h
  for (let i = 0; i < horizon; i++) {
    volPath.push(Math.sqrt(Math.max(EPS, h)))
    h = omega + alpha * h * 0.5 + beta * h
  }

  // Direction from volatility regime change
  const currentVol = volPath[0]
  const forecastVol = volPath[volPath.length - 1]
  const volTrend = (forecastVol - currentVol) / (currentVol + EPS)

  // In GARCH, expanding vol often precedes reversals; contracting vol favors continuation
  // Use recent return direction + vol regime to infer
  const recentMean = mean(returns.slice(-10))
  const direction = Math.abs(recentMean) < EPS ? 0
    : volTrend > 0.1 ? -Math.sign(recentMean) // vol expanding → mean reversion
    : Math.sign(recentMean) // vol contracting → continuation

  const strength = Math.min(1, Math.abs(volTrend) * 2 + Math.abs(recentMean) / (currentVol + EPS))

  return {
    direction,
    strength: Math.round(Math.min(1, Math.max(0, strength)) * 100) / 100,
    currentVol: Math.round(currentVol * 10000) / 10000,
    forecastVol: Math.round(forecastVol * 10000) / 10000,
    volTrend: Math.round(volTrend * 1000) / 1000,
    model: "garch"
  }
}
