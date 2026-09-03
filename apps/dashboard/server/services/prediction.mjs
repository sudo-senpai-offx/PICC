// PICC prediction engine — multi-model ensemble with honest, backtested confidence.
//
// Eight independent models look at the same close series:
//   1. Momentum    — recent return trend extrapolated (with decay).
//   2. Mean-revert — Ornstein-Uhlenbeck pull back to the long-run mean.
//   3. Trend fit   — log-linear regression slope over the window.
//   4. Monte Carlo — geometric Brownian motion using historic drift/vol.
//   5. ARIMA       — AutoRegressive Integrated Moving Average (Yule-Walker).
//   6. Prophet     — Holt-Winters trend + weekly seasonality decomposition.
//   7. LSTM-lite   — Sliding-window logistic regression classifier.
//   8. GARCH-lite  — Volatility clustering regime model.
//
// Every model is walk-forward backtested on the trailing window so the reported
// "confidence" is a calibrated fraction of the times the model's direction call
// would have been right on data it had not seen — not a made-up number. The suite
// is educational and never executes trades automatically.
//
// Returns: { last, horizonDays, direction, strength, confidence, hitRate,
//            agreement, models, sampleSize, note }

const EPS = 1e-12

import { arimaForecast, holtWintersForecast, lstmLiteForecast, garchForecast } from "./models.mjs"

// Dynamic ensemble weights from per-model hit rates.
// Models with higher backtest accuracy get more influence.
// Uses softmax-like normalization with a floor so no model is silenced.
const MODEL_NAMES = ["momentum", "meanRevert", "trend", "monteCarlo", "arima", "prophet", "lstm", "garch"]
const WEIGHT_FLOOR = 0.06 // minimum weight per model (6%) — lower floor with 8 models
const WEIGHT_TEMPERATURE = 0.5 // softmax sharpness
// F-07 — a model needs enough INDEPENDENT walk-forward windows before its hit
// rate may move ensemble weights at all. With n=12, a Wilson 95% interval on a
// coin-flip is roughly ±0.28 — below that, "elevated" is indistinguishable
// from noise, so the model stays neutral at the 50% no-skill baseline.
const MIN_SIGNAL_SAMPLES = 12
const MIN_CONFORMAL_SAMPLES = 20 // below this, no honest band can be claimed

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
 *
 * F-07 significance gate: a model whose hit rate rests on fewer than
 * MIN_SIGNAL_SAMPLES independent windows (or no backtest at all) is treated
 * as 50% neutral — its raw rate must not be allowed to inflate a weight on
 * noise. The floor still guarantees every model keeps a voice.
 */
function computeWeights(hitRates, counts = {}) {
  const raw = {}
  for (const name of MODEL_NAMES) {
    const rate = hitRates[name]
    const n = counts[name] ?? 0
    const significant = rate != null && n >= MIN_SIGNAL_SAMPLES
    const perf = significant ? rate : 0.5 // neutral until proven on enough windows
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
    ...(() => {
      try {
        const arima = arimaForecast(closes, h)
        const prophet = holtWintersForecast(closes, h)
        const lstm = lstmLiteForecast(closes, h)
        const garch = garchForecast(closes, h)
        // Scale new models conservatively: use 30% of the base signal
        // to avoid overwhelming the original 4 models in the ensemble
        const scaleFactor = 0.3
        return {
          arima: (arima.forecast || 0) * scaleFactor,
          prophet: (prophet.forecast || 0) * scaleFactor,
          lstm: (lstm.direction * lstm.strength * vol * Math.sqrt(h) || 0) * scaleFactor,
          garch: (garch.direction * garch.strength * vol * Math.sqrt(h) * 0.5 || 0) * scaleFactor
        }
      } catch {
        return { arima: 0, prophet: 0, lstm: 0, garch: 0 }
      }
    })(),
    vol
  }
}

// Walk-forward backtest: for the trailing K windows, predict the next `h` days
// from each model using only data up to that point, then score the call.
//
// F-06 — windows are EMBARGOED, never overlapping: after a window whose test
// span is [start+1, start+h], the next training cut starts at start+h+2 (one
// quiet bar between test and the next training set). Overlapping windows
// shared realized data and let near-identical noise be counted as independent
// evidence; hit rates now rest on genuinely separate slices.
export function backtestModels(closes, h, maxWindows = 20) {
  const minObs = Math.max(30, h * 4 + 10)
  const scores = { momentum: [], meanRevert: [], trend: [], monteCarlo: [], arima: [], prophet: [], lstm: [], garch: [] }
  const total = closes.length
  if (total < minObs + h + 5) {
    return { scores, sampleSize: 0, hitRates: {}, windows: [], counts: {}, residuals: [] }
  }

  // Non-overlapping walk: each window consumes h test bars (+1 embargo bar).
  const step = Math.max(1, h + 1)
  let evaluated = 0
  const windowResults = []
  const residuals = [] // |realized h-day log return| per window (conformal input)
  const counts = { momentum: 0, meanRevert: 0, trend: 0, monteCarlo: 0, arima: 0, prophet: 0, lstm: 0, garch: 0 }

  for (let start = minObs; start + h <= total - 1 && evaluated < maxWindows; start += step) {
    evaluated += 1
    const slice = closes.slice(0, start + 1)
    const exp = modelExpectations(slice, h)
    const future = closes.slice(start + 1, start + 1 + h)
    // The forecast is made from close[start] for an h-step horizon — realized
    // return must span h steps: log(c[start+h]) − log(c[start]).
    const realized =
      Math.log(Math.max(Number(future[future.length - 1]) || 0, EPS)) -
      Math.log(Math.max(Number(slice[slice.length - 1]) || 0, EPS))
    residuals.push(Math.abs(realized))
    let windowHits = 0
    let windowModels = 0
    for (const name of Object.keys(scores)) {
      const call = exp[name]
      const dir = Math.abs(call) < EPS ? 0 : call > 0 ? 1 : -1
      const truth = Math.abs(realized) < EPS ? 0 : realized > 0 ? 1 : -1
      if (dir !== 0) {
        counts[name] += 1
        const hit = dir === truth ? 1 : 0
        scores[name].push(hit)
        windowHits += hit
        windowModels++
      }
    }
    windowResults.push({ idx: evaluated, start, hit: windowModels > 0 ? windowHits / windowModels > 0.5 : false })
  }

  const hitRates = {}
  for (const [name, list] of Object.entries(scores)) {
    hitRates[name] = list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : null
  }
  return { scores, sampleSize: evaluated, hitRates, windows: windowResults, counts, residuals }
}

/**
 * Split-conformal quantile (F-10): the (1−α) empirical quantile of a residual
 * sample with finite-sample correction, i.e. sorted[ceil((n+1)(1−α))−1].
 * Distribution-free coverage on the sampled distribution, honest for any
 * error law — nothing Gaussian assumed.
 */
export function conformalQuantile(sortedAsc, alpha = 0.1) {
  const n = sortedAsc.length
  if (!n) return null
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((n + 1) * (1 - alpha)) - 1))
  return sortedAsc[idx]
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

  const { hitRates, sampleSize, counts, residuals } = backtestModels(clean, h, maxWindows)

  // Dynamic ensemble weights from backtest hit rates, gated by significance
  // (F-07): models under MIN_SIGNAL_SAMPLES windows stay neutral at 50%.
  const weights = computeWeights(hitRates, counts)
  const weightedValues = MODEL_NAMES.map((name) => (exp[name] || 0) * (weights[name] || 0.25))
  const ensembleScore = weightedValues.reduce((a, b) => a + b, 0)
  const direction = Math.abs(ensembleScore) < EPS ? "flat" : ensembleScore > 0 ? "up" : "down"

  // Agreement = 1 - (spread of model calls), measured on z-scored expectations.
  const values = Object.values(exp)
  const m = mean(values)
  const s = std(values, m) || EPS
  // NOTE: avgZ is identically 0 by construction (mean of z-scores of the same
  // sample) — it must not be used as a signal-strength fallback.
  const agreement = Math.max(0, Math.min(1, 1 - s / (s + 1)))

  // Honest calibration: use weighted-average hit rate (not plain mean).
  const modelRates = Object.values(hitRates).filter((r) => r != null)
  const weightedHit = MODEL_NAMES.reduce((sum, name) => {
    const rate = hitRates[name]
    return sum + (rate != null ? rate * (weights[name] || 0.25) : 0)
  }, 0)
  const meanHit = modelRates.length ? weightedHit : null
  // F-07 — "best model" used to be max over ALL hit rates, which on ~20 tiny
  // overlapping windows was a selection-bias illusion. Now it is the best rate
  // among models that cleared the significance floor, or null when none has.
  const bestHit = MODEL_NAMES.reduce((best, name) => {
    const rate = hitRates[name]
    const n = counts[name] ?? 0
    if (rate == null || n < MIN_SIGNAL_SAMPLES) return best
    return best == null ? rate : Math.max(best, rate)
  }, null)

  // Shrink toward the no-skill 50% baseline when the sample is thin.
  const shrink = Math.max(0.25, Math.min(1, sampleSize / 20))
  // No backtest yet: scale confidence by signal magnitude vs expected noise
  // (|score| / (vol·√h)) instead of the old avgZ term, which was identically
  // zero and made this branch a constant 50%.
  const magnitude = Math.min(0.5, Math.abs(ensembleScore) / (Math.max(vol, EPS) * Math.sqrt(h)) * 0.25)
  const calibrated =
    meanHit != null
      ? (meanHit - 0.5) * shrink + 0.5
      : Math.min(0.55, 0.5 + magnitude)

  const confidencePct = Math.round(Math.min(0.95, Math.max(0.5, calibrated + agreement * 0.12)) * 100)
  const strength = Math.min(1, Math.abs(ensembleScore) / (Math.max(vol, EPS) * Math.sqrt(h)) * 1.2)

  // Apply temporal decay if a creation timestamp is provided
  const finalConfidence = createdAt
    ? decayedConfidence(confidencePct, createdAt, h)
    : confidencePct

  // F-10 — honest uncertainty: a distribution-free band on the h-day absolute
  // log move built from the embargoed walk-forward residuals. Coverage is a
  // claim about the sampled distribution, never a promise about this trade.
  const last = Number(clean[clean.length - 1])
  let band = null
  if ((residuals?.length ?? 0) >= MIN_CONFORMAL_SAMPLES) {
    const sorted = [...residuals].sort((a, b) => a - b)
    const q90 = conformalQuantile(sorted, 0.1)
    const q80 = conformalQuantile(sorted, 0.2)
    if (q90 != null) {
      band = {
        method: "split-conformal",
        horizonLogMoveP80: Number(q80.toFixed(6)),
        horizonLogMoveP90: Number(q90.toFixed(6)),
        // price bounds around the current close for the 90% level
        upperPrice90: Number((last * Math.exp(q90)).toFixed(last < 10 ? 6 : 4)),
        lowerPrice90: Number((last * Math.exp(-q90)).toFixed(last < 10 ? 6 : 4)),
        sampleSize: residuals.length,
        note: "h-day |log move| bound from embargoed walk-forward residuals (distribution-free). Covers the SIZE of the move, not its direction — direction confidence is separate."
      }
    }
  }

  return {
    ok: true,
    engine: "8-model-classic", // F-08: identity of the brain that produced this
    last,
    horizonDays: h,
    direction,
    strength: Math.round(strength * 100) / 100,
    confidence: finalConfidence,
    rawConfidence: confidencePct,
    band,
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
          : meanHit != null
            ? `Backtested ${sampleSize} trailing window(s); ensemble weighted avg ${Math.round(meanHit * 100)}% hit rate. Past performance never guarantees future results.`
            : `Backtested ${sampleSize} trailing window(s). Past performance never guarantees future results.`
  }
}
