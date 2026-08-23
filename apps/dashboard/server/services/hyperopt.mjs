// PICC Gate-threshold hyperopt — walk-forward hyperparameter search for the
// adaptive-confluence honesty gates (adaptiveConfluence.mjs).
//
// The search space mirrors the live gate knobs: the multi-timeframe agreement
// veto (minMtfAgree), the sentiment-alignment floor (minSentimentAlignment) and
// the AI composite weight (aiGateWeight). The objective is OUT-OF-SAMPLE Sharpe
// ratio over binary-option style trades (win = +payout, loss = -1 stake).
//
// Look-ahead bias is prevented STRUCTURALLY, not by convention:
//
//   chronologicalSplit()  — cuts the series into a leading TRAIN slice and a
//                           trailing VALIDATE slice. The split index is fixed
//                           before any candidate is scored.
//   searchGateGrid()      — the inner search loop accepts ONLY the train slice
//                           as its data argument. The validate candles are not
//                           reachable from inside the loop, so no candidate can
//                           be scored on data it must never see.
//   The selected parameters are handed to evaluateGateParams() exactly once,
//   after the loop has finished, on the untouched validation slice.
//
// walkForwardBacktest() repeats that discipline across N contiguous folds: for
// fold i the grid search trains on folds 0..i-1 and validates on fold i only.
import { MIN_BARS } from "./adaptiveConfluence.mjs"

export const GATE_GRID = {
  minMtfAgree: [2, 3, 4],
  minSentimentAlignment: [0.5, 0.6, 0.7, 0.8],
  aiGateWeight: [0.25, 0.4, 0.6]
}

export const HYPEROPT_DEFAULTS = {
  trainFrac: 0.7,
  minTrades: 8,
  payoutPct: 80,
  horizonBars: 3,
  windows: 5,
  maxLeaderboard: 10
}

const BASE_GATE_SCORE = 0.12
const MTF_HORIZONS = [5, 10, 20]
const SENTIMENT_LAG = 30
const TREND_FAST = 10
const TREND_SLOW = 20
const MOMENTUM_LAG = 5
const ATR_WINDOW = 14

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = (v, d = 6) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)
const EPS = 1e-12

function cleanCloses(candles) {
  if (!Array.isArray(candles)) return []
  return candles
    .map((c) => {
      const close = Number(c?.close ?? c?.c ?? c)
      const time = Number(c?.time ?? c?.t ?? 0)
      return Number.isFinite(close) && close > 0 ? { time, close } : null
    })
    .filter(Boolean)
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null)
  let sum = 0
  let prev = null
  const k = 2 / (period + 1)
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      sum += values[i]
      continue
    }
    if (i === period - 1) {
      sum += values[i]
      prev = sum / period
    } else {
      prev = values[i] * k + prev * (1 - k)
    }
    out[i] = prev
  }
  return out
}

function atrSeries(closes) {
  const out = new Array(closes.length).fill(null)
  let sum = 0
  for (let i = 1; i < closes.length; i++) {
    const d = Math.abs(closes[i] - closes[i - 1])
    sum += d
    if (i > ATR_WINDOW) sum -= Math.abs(closes[i - ATR_WINDOW] - closes[i - ATR_WINDOW - 1])
    if (i >= ATR_WINDOW) out[i] = sum / ATR_WINDOW
  }
  return out
}

function precomputeFeatures(slice) {
  const closes = slice.map((c) => c.close)
  return {
    slice,
    closes,
    emaFast: emaSeries(closes, TREND_FAST),
    emaSlow: emaSeries(closes, TREND_SLOW),
    atr: atrSeries(closes),
    warmup: Math.max(TREND_SLOW, SENTIMENT_LAG, MTF_HORIZONS[MTF_HORIZONS.length - 1]) + 1
  }
}

function featuresForBar(feat, i, params) {
  const c = feat.closes[i]
  const atr = feat.atr[i]
  if (atr == null || !Number.isFinite(atr) || atr <= EPS) return null
  const trendScore = clamp((feat.emaFast[i] - feat.emaSlow[i]) / (2 * atr), -1, 1)
  const momScore = clamp((c - feat.closes[i - MOMENTUM_LAG]) / (3 * atr), -1, 1)
  const w = clamp(Number(params.aiGateWeight), 0, 1)
  const composite = w * trendScore + (1 - w) * momScore
  if (Math.abs(composite) < BASE_GATE_SCORE) return null
  const direction = composite > 0 ? 1 : -1
  let mtfAgree = 0
  for (const h of MTF_HORIZONS) {
    if (i < h) continue
    if ((feat.closes[i] - feat.closes[i - h]) * direction > 0) mtfAgree++
  }
  if (mtfAgree < params.minMtfAgree) return null
  const sentimentScore = clamp((feat.closes[i] - feat.closes[i - SENTIMENT_LAG]) / (atr * SENTIMENT_LAG * 0.5), -1, 1)
  const alignment = sentimentScore * direction
  if (alignment < params.minSentimentAlignment) return null
  return { direction }
}

export function evaluateGateParams(candles, params, options = {}) {
  const opts = { ...HYPEROPT_DEFAULTS, ...options }
  const slice = cleanCloses(candles)
  const k = clamp(Math.round(opts.horizonBars), 1, 20)
  const payout = clamp(Number(opts.payoutPct) || 80, 1, 500) / 100
  const feat = precomputeFeatures(slice)
  const pnls = []
  let wins = 0
  let losses = 0
  let pushes = 0
  for (let i = feat.warmup; i <= slice.length - 1 - k; i++) {
    const sig = featuresForBar(feat, i, params)
    if (!sig) continue
    const entry = feat.closes[i]
    const exit = feat.closes[i + k]
    const delta = exit - entry
    let pnl
    if (Math.abs(delta) <= EPS) {
      pnl = 0
      pushes++
    } else if (delta * sig.direction > 0) {
      pnl = payout
      wins++
    } else {
      pnl = -1
      losses++
    }
    pnls.push(pnl)
  }
  const trades = pnls.length
  const decided = wins + losses
  const mean = trades ? pnls.reduce((a, b) => a + b, 0) / trades : null
  let std = null
  if (trades > 1 && mean != null) {
    const varr = pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / (trades - 1)
    std = Math.sqrt(varr)
  }
  return {
    bars: slice.length,
    trades,
    wins,
    losses,
    pushes,
    hitRate: decided > 0 ? round(wins / decided) : null,
    totalPnl: round(trades ? pnls.reduce((a, b) => a + b, 0) : 0),
    avgPnlPerTrade: round(mean),
    sharpe: trades >= 2 && std > EPS ? round(mean / std) : null
  }
}

export function expandGrid(grid = GATE_GRID) {
  const keys = Object.keys(grid)
  if (!keys.length) return []
  let combos = [{}]
  for (const key of keys) {
    const vals = [...new Set(grid[key].map(Number))].sort((a, b) => a - b)
    const next = []
    for (const combo of combos) {
      for (const v of vals) next.push({ ...combo, [key]: v })
    }
    combos = next
  }
  return combos
}

export function chronologicalSplit(candles, { trainFrac = HYPEROPT_DEFAULTS.trainFrac } = {}) {
  const clean = cleanCloses(candles)
  const n = clean.length
  const frac = clamp(Number(trainFrac) || 0.7, 0.5, 0.9)
  const splitIndex = Math.floor(n * frac)
  return {
    train: clean.slice(0, splitIndex),
    validate: clean.slice(splitIndex),
    trainRange: [0, splitIndex],
    validateRange: [splitIndex, n],
    splitIndex,
    total: n
  }
}

function rankKey(m, minTrades) {
  const sharpe = m.sharpe ?? -Infinity
  const qualified = m.trades >= minTrades ? 1 : 0
  return { qualified, sharpe, trades: m.trades }
}

function compareCandidates(a, b, minTrades) {
  const ra = rankKey(a.trainMetrics, minTrades)
  const rb = rankKey(b.trainMetrics, minTrades)
  if (ra.qualified !== rb.qualified) return rb.qualified - ra.qualified
  if (ra.sharpe !== rb.sharpe) return rb.sharpe - ra.sharpe
  return rb.trades - ra.trades
}

export function searchGateGrid(trainCandles, options = {}) {
  const opts = { ...HYPEROPT_DEFAULTS, ...options }
  const grid = options.grid ?? GATE_GRID
  const combos = expandGrid(grid)
  const leaderboard = []
  for (const params of combos) {
    leaderboard.push({
      params,
      trainMetrics: evaluateGateParams(trainCandles, params, opts)
    })
  }
  leaderboard.sort((a, b) => compareCandidates(a, b, opts.minTrades))
  return { leaderboard, combos: combos.length }
}

export function gridSearchGateThresholds(candles, options = {}) {
  const opts = { ...HYPEROPT_DEFAULTS, ...options }
  const clean = cleanCloses(candles)
  if (clean.length < MIN_BARS * 2) {
    return { ok: false, error: `need at least ${MIN_BARS * 2} candles, got ${clean.length}` }
  }
  const split = chronologicalSplit(clean, opts)
  if (split.validate.length < 10) {
    return { ok: false, error: "validation window too small" }
  }
  const { leaderboard, combos } = searchGateGrid(split.train, opts)
  const best = leaderboard[0] ?? null
  const validationMetrics =
    best && best.trainMetrics.trades > 0
      ? evaluateGateParams(split.validate, best.params, opts)
      : null
  return {
    ok: true,
    protocol: "grid search scored on the train slice only; the validation slice was evaluated once, after selection",
    bars: split.total,
    splitIndex: split.splitIndex,
    trainBars: split.trainRange[1],
    validateBars: split.total - split.splitIndex,
    searchSpace: { combos },
    bestParams: best?.params ?? null,
    trainMetrics: best?.trainMetrics ?? null,
    validationMetrics,
    leaderboard: leaderboard.slice(0, Math.max(1, opts.maxLeaderboard))
  }
}

export function walkForwardBacktest(candles, options = {}) {
  const opts = { ...HYPEROPT_DEFAULTS, ...options }
  const clean = cleanCloses(candles)
  const requestedWindows = clamp(Math.round(opts.windows) || 5, 2, 20)
  const minFold = MIN_BARS
  if (clean.length < minFold * (requestedWindows + 1)) {
    return { ok: false, error: `need at least ${minFold * (requestedWindows + 1)} candles for ${requestedWindows} windows`, bars: clean.length }
  }
  const folds = []
  const base = Math.floor(clean.length / requestedWindows)
  let cursor = 0
  for (let f = 0; f < requestedWindows; f++) {
    const size = f === requestedWindows - 1 ? clean.length - cursor : base
    folds.push({ start: cursor, end: cursor + size, candles: clean.slice(cursor, cursor + size) })
    cursor += size
  }
  const results = []
  for (let i = 1; i < folds.length; i++) {
    const trainCandles = folds.slice(0, i).flatMap((f) => f.candles)
    const validateFold = folds[i]
    const { leaderboard } = searchGateGrid(trainCandles, opts)
    const best = leaderboard[0] ?? null
    if (!best || best.trainMetrics.trades === 0) continue
    const validationMetrics = evaluateGateParams(validateFold.candles, best.params, opts)
    results.push({
      window: i,
      trainRange: [folds[0].start, folds[i - 1].end],
      validateRange: [validateFold.start, validateFold.end],
      trainBars: trainCandles.length,
      validateBars: validateFold.candles.length,
      bestParams: best.params,
      trainSharpe: best.trainMetrics.sharpe,
      trainTrades: best.trainMetrics.trades,
      validationSharpe: validationMetrics.sharpe,
      validationTrades: validationMetrics.trades,
      validationHitRate: validationMetrics.hitRate,
      validationTotalPnl: validationMetrics.totalPnl
    })
  }
  const withSharpe = results.filter((r) => r.validationSharpe != null)
  const avgValidationSharpe = withSharpe.length
    ? withSharpe.reduce((a, r) => a + r.validationSharpe, 0) / withSharpe.length
    : null
  const totalValTrades = results.reduce((a, r) => a + r.validationTrades, 0)
  // Aggregate wins directly (trades × hitRate miscounts pushes: trades
  // include them, hitRate excludes them).
  const valWins = results.reduce(
    (a, r) => a + Math.round(r.validationTrades * (r.validationHitRate ?? 0)),
    0
  )
  return {
    ok: true,
    bars: clean.length,
    windowsRequested: requestedWindows,
    windowsEvaluated: results.length,
    folds: folds.map((f) => ({ start: f.start, end: f.end })),
    windows: results,
    aggregate: {
      avgValidationSharpe: round(avgValidationSharpe),
      positiveValidationWindows: withSharpe.filter((r) => r.validationSharpe > 0).length,
      stability: withSharpe.length
        ? round(withSharpe.filter((r) => r.validationSharpe > 0).length / withSharpe.length, 3)
        : null,
      totalValidationTrades: totalValTrades,
      validationHitRate: totalValTrades > 0 ? round(valWins / totalValTrades) : null
    },
    protocol: "anchored walk-forward: fold i is validated only after the search trained on folds 0..i-1"
  }
}
