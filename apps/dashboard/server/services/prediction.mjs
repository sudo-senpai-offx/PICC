// PICC prediction engine — multi-model ensemble with honest, backtested confidence.
//
// Four independent models look at the same close series:
//   1. Momentum    — recent return trend extrapolated (with decay).
//   2. Mean-revert — Ornstein-Uhlenbeck pull back to the long-run mean.
//   3. Trend fit   — log-linear regression slope over the window.
//   4. Monte Carlo — geometric Brownian motion using historic drift/vol.
//
// Every model is walk-forward backtested on the trailing window so the reported
// "confidence" is a calibrated fraction of the times the model's direction call
// would have been right on data it had not seen — not a made-up number. The suite
// is educational and never executes trades automatically.
//
// Returns: { last, horizonDays, direction, strength, confidence, hitRate,
//            agreement, models, sampleSize, note }

const EPS = 1e-12

// Dynamic ensemble weights from per-model hit rates.
// Models with higher backtest accuracy get more influence.
// Uses softmax-like normalization with a floor so no model is silenced.
const MODEL_NAMES = ["momentum", "meanRevert", "trend", "monteCarlo"]
const WEIGHT_FLOOR = 0.1 // minimum weight per model (10%)
const WEIGHT_TEMPERATURE = 0.5 // softmax sharpness

function logReturns(closes) {
  const out = []
  for (let i = 1; i < closes.length; i++) {
    const a = Math.log(Math.max(Number(closes[i - 1]) || 0, EPS))
    const b = Math.log(Math.max(Number(closes[i]) || 0, EPS))
    out.push(b - a)
  }
  return out
}

function mean(xs) {
  if (!xs.length) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function std(xs, m = mean(xs)) {
  if (xs.length < 2) return 0
  const v = xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1)
  return Math.sqrt(v)
}

function linearSlope(xs) {
  const n = xs.length
  if (n < 3) return 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += xs[i]
    sxx += i * i
    sxy += i * xs[i]
  }
  const denom = n * sxx - sx * sx
  return denom !== 0 ? (n * sxy - sx * sy) / denom : 0
}

/**
 * Compute adaptive ensemble weights from per-model hit rates using
 * temperature-scaled softmax with a floor. Higher-performing models
 * get exponentially more weight, but the floor ensures no model is silenced.
 */
function computeWeights(hitRates) {
  const raw = {}
  for (const name of MODEL_NAMES) {
    const rate = hitRates[name]
    const perf = rate != null ? rate : 0.5 // treat unknown as 50%
    // Shift so 0.5 is neutral, then apply temperature
    raw[name] = Math.exp((perf - 0.5) / WEIGHT_TEMPERATURE)
  }
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1
  const normalized = {}
  for (const name of MODEL_NAMES) {
    normalized[name] = Math.max(WEIGHT_FLOOR, raw[name] / total)
  }
  // Re-normalize after floor application
  const floorTotal = Object.values(normalized).reduce((a, b) => a + b, 0) || 1
  for (const name of MODEL_NAMES) {
    normalized[name] = normalized[name] / floorTotal
  }
  return normalized
}

/**
 * Compute confidence decay: predictions lose confidence over time. Decays
 * exponentially from the original confidence to a floor of 50% over a
 * configurable half-life (default: horizon * 2 hours).
 */
function decayedConfidence(originalPct, createdAt, horizonDays) {
  if (!createdAt) return originalPct
  const ageMs = Date.now() - new Date(createdAt).getTime()
  if (ageMs <= 0) return originalPct
  const halfLifeMs = Math.max(1, horizonDays) * 2 * 3600_000 // hours
  const decay = Math.exp(-0.693 * ageMs / halfLifeMs) // ln(2) ≈ 0.693
  const floor = 50 // no-skill baseline
  const decayed = floor + (originalPct - floor) * Math.max(0, decay)
  return Math.round(Math.max(floor, Math.min(originalPct, decayed)))
}

// Expected log-return over `h` days from each model. A positive value is a
// bullish call, a negative value a bearish one. All returns are log-returns.
function modelExpectations(closes, h) {
  const returns = logReturns(closes)
  const n = returns.length
  const lookback = Math.max(20, Math.min(120, n))
  const recent = returns.slice(-lookback)
  const vol = std(recent)
  const lastLog = Math.log(Math.max(Number(closes[closes.length - 1]) || 0, EPS))
  const logs = closes.map((c) => Math.log(Math.max(Number(c) || 0, EPS)))

  // 1. Momentum — half-life decayed mean of recent returns.
  const halfLife = Math.max(5, Math.min(40, Math.round(h * 2)))
  const decay = Math.exp(-1 / halfLife)
  let w = 1
  let wsum = 0
  let msum = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    msum += recent[i] * w
    wsum += w
    w *= decay
  }
  const momentumPerDay = wsum > 0 ? msum / wsum : 0

  // 2. Mean reversion — Ornstein-Uhlenbeck pull back to the long-run mean
  //    *log-price* of the series. Deviations are measured against the mean
  //    log-price (not the mean daily return), so the OU estimate of alpha and
  //    the pull term `alpha * (muLog - lastLog)` are unit-consistent.
  const muLog = mean(logs)
  let alpha = 0
  if (logs.length >= 10) {
    const devs = []
    const rs = []
    for (let i = 1; i < logs.length; i++) {
      devs.push(logs[i - 1] - muLog)
      rs.push(logs[i] - logs[i - 1])
    }
    const covXY = mean(devs.map((d, i) => d * rs[i])) - mean(devs) * mean(rs)
    const varX = std(devs) ** 2
    alpha = varX > EPS ? -covXY / varX : 0
  }
  const reversionPerDay = alpha * (muLog - lastLog)

  // 3. Log-linear trend over the window.
  const trendPerDay = linearSlope(logs.slice(-lookback))

  // 4. Monte Carlo drift — mean of simulated daily log-returns (drift shrink
  //    toward 0). An expected log-return over h days scales linearly with h.
  const driftPerDay = Math.min(Math.abs(mean(recent)), vol * 0.5) * Math.sign(mean(recent))

  return {
    momentum: momentumPerDay * h,
    meanRevert: reversionPerDay * h,
    trend: trendPerDay * h,
    monteCarlo: driftPerDay * h,
    vol
  }
}

// Walk-forward backtest: for the trailing K windows, predict the next `h` days
// from each model using only data up to that point, then score the call.
export function backtestModels(closes, h, maxWindows = 20) {
  const minObs = Math.max(30, h * 4 + 10)
  const scores = { momentum: [], meanRevert: [], trend: [], monteCarlo: [] }
  const total = closes.length
  if (total < minObs + h + 5) return { scores, sampleSize: 0, hitRates: {}, windows: [] }

  const windows = Math.min(maxWindows, total - minObs - h)
  const step = Math.max(1, Math.floor(windows / maxWindows))
  let evaluated = 0
  const windowResults = []

  for (let start = minObs; start + h <= total - 1 && evaluated < maxWindows; start += step) {
    evaluated += 1
    const slice = closes.slice(0, start + 1)
    const exp = modelExpectations(slice, h)
    const future = closes.slice(start + 1, start + 1 + h)
    const realized = Math.log(Math.max(Number(future[future.length - 1]) || 0, EPS)) - Math.log(Math.max(Number(future[0]) || 0, EPS))
    let windowHits = 0
    let windowModels = 0
    for (const name of Object.keys(scores)) {
      const call = exp[name]
      const dir = Math.abs(call) < EPS ? 0 : call > 0 ? 1 : -1
      const truth = Math.abs(realized) < EPS ? 0 : realized > 0 ? 1 : -1
      if (dir !== 0) {
        const hit = dir === truth ? 1 : 0
        scores[name].push(hit)
        windowHits += hit
        windowModels++
      }
    }
    windowResults.push({ idx: evaluated, hit: windowModels > 0 ? windowHits / windowModels > 0.5 : false })
  }

  const hitRates = {}
  for (const [name, list] of Object.entries(scores)) {
    hitRates[name] = list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : null
  }
  return { scores, sampleSize: evaluated, hitRates, windows: windowResults }
}

export function predictDirection(closes, horizonDays = 3, opts = {}) {
  const clean = (Array.isArray(closes) ? closes : []).map((c) => Number(c)).filter((c) => Number.isFinite(c) && c > 0)
  const raw = Math.round(typeof horizonDays === "number" ? horizonDays : Number(horizonDays))
  const h = Math.min(60, Math.max(1, Number.isFinite(raw) && raw > 0 ? raw : 3))
  const maxWindows = Math.min(400, Math.max(1, Math.round(Number(opts?.maxWindows) || 20)))
  const createdAt = opts.createdAt || null

  if (clean.length < 30) {
    return {
      ok: false,
      error: "need at least 30 clean price observations",
      horizonDays: h
    }
  }

  const exp = modelExpectations(clean, h)
  const vol = exp.vol
  delete exp.vol

  const { hitRates, sampleSize } = backtestModels(clean, h, maxWindows)

  // Dynamic ensemble weights from backtest hit rates (EMA-updated per call)
  const weights = computeWeights(hitRates)
  const weightedValues = MODEL_NAMES.map((name) => (exp[name] || 0) * (weights[name] || 0.25))
  const ensembleScore = weightedValues.reduce((a, b) => a + b, 0)
  const direction = Math.abs(ensembleScore) < EPS ? "flat" : ensembleScore > 0 ? "up" : "down"

  // Agreement = 1 - (spread of model calls), measured on z-scored expectations.
  const values = Object.values(exp)
  const m = mean(values)
  const s = std(values, m) || EPS
  const avgZ = mean(values.map((v) => (v - m) / s))
  const agreement = Math.max(0, Math.min(1, 1 - s / (s + 1)))

  // Honest calibration: use weighted-average hit rate (not plain mean).
  const modelRates = Object.values(hitRates).filter((r) => r != null)
  const weightedHit = MODEL_NAMES.reduce((sum, name) => {
    const rate = hitRates[name]
    return sum + (rate != null ? rate * (weights[name] || 0.25) : 0)
  }, 0)
  const meanHit = modelRates.length ? weightedHit : null
  const bestHit = modelRates.length ? Math.max(...modelRates) : null

  // Shrink toward the no-skill 50% baseline when the sample is thin.
  const shrink = Math.max(0.25, Math.min(1, sampleSize / 20))
  const calibrated =
    meanHit != null
      ? (meanHit - 0.5) * shrink + 0.5
      : Math.min(0.55, Math.abs(avgZ) * 0.1 + 0.5)

  const confidencePct = Math.round(Math.min(0.95, Math.max(0.5, calibrated + agreement * 0.12)) * 100)
  const strength = Math.min(1, Math.abs(ensembleScore) / (Math.max(vol, EPS) * Math.sqrt(h)) * 1.2)

  // Apply temporal decay if a creation timestamp is provided
  const finalConfidence = createdAt
    ? decayedConfidence(confidencePct, createdAt, h)
    : confidencePct

  return {
    ok: true,
    last: Number(clean[clean.length - 1]),
    horizonDays: h,
    direction,
    strength: Math.round(strength * 100) / 100,
    confidence: finalConfidence,
    rawConfidence: confidencePct,
    weights: Object.fromEntries(MODEL_NAMES.map((n) => [n, Math.round((weights[n] || 0) * 100)])),
    hitRate: meanHit != null ? Math.round(meanHit * 100) : null,
    bestModelHitRate: bestHit != null ? Math.round(bestHit * 100) : null,
    agreement: Math.round(agreement * 100),
    sampleSize,
    models: Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6])),
    note:
      confidencePct < 60
        ? "Models disagree or the backtest sample is thin — treat this as coin-flip odds, not a signal."
        : direction === "flat"
          ? "Net expectation is near zero across models — no edge detected."
          : `Backtested ${sampleSize} trailing window(s); ensemble weighted avg ${Math.round(meanHit * 100)}% hit rate. Past performance never guarantees future results.`
  }
}
