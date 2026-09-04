// PICC Model Matrix — the multiplexing trading-infrastructure core.
//
// One candle series in, NINE independent model votes out, fused into a
// single weighted consensus. This is what powers the "Model Matrix" panel
// and (optionally) a consensus entry-gate for the autopilot.
//
// Design constraints:
//   • Lightweight: every model is O(n) statistics over the candle window —
//     no external services, no training runs, safe to call on every poll.
//   • Honest: models report flat when their signal is genuinely neutral; the
//     consensus confidence reflects DISAGREEMENT by shrinking toward 50%.
//   • Adaptive: per-model weights are an exponential recency-weighted win
//     rate learned from resolved demo/paper outcomes (online learning —
//     models that keep being wrong decay toward weight 0.4, accurate ones
//     grow toward 1.6). Weights persist via localStore. Every settlement
//     tick also decays all stored win-rates toward chance, and models that
//     persist at-or-below chance across PRUNE_MIN_SAMPLES resolved outcomes
//     are pruned from fusion (record kept, weighting stopped).
//
// Keep every model PURE: candles in → vote out. No I/O inside model fns.

import { localStore } from "./localstore.mjs"

const WEIGHTS_STORE = "modelMatrix"
const EMA_ALPHA = 0.18 // recency factor for online win-rate updates
const DECAY_ALPHA = 0.05 // per-tick drift of every stored weight toward chance
const WEIGHT_FLOOR = 0.4
const WEIGHT_CEIL = 1.6
const PRUNE_MIN_SAMPLES = 50 // resolved outcomes before a stale model can be pruned

function last(arr, n) {
  return arr.slice(Math.max(0, arr.length - n))
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null
  const k = 2 / (period + 1)
  let e = values.slice(0, period).reduce((s, v) => s + v, 0) / period
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k)
  return e
}

/** Full EMA run — out[i] = EMA(period) over values[0..i], null until warmup. */
function emaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return values.map(() => null)
  const k = 2 / (period + 1)
  const out = new Array(values.length).fill(null)
  let e = values.slice(0, period).reduce((s, v) => s + v, 0) / period
  out[period - 1] = e
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k)
    out[i] = e
  }
  return out
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null
  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gains += d
    else losses -= d
  }
  const avgG = gains / period
  const avgL = losses / period
  // No losses AND no gains = a perfectly flat window → neutral, not "100".
  if (avgG === 0 && avgL === 0) return 50
  if (avgL === 0) return 100
  const rs = avgG / avgL
  return 100 - 100 / (1 + rs)
}

function atrFrom(candles, period = 14) {
  if (candles.length < 2) return null
  let atr = null
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      Number(candles[i].high) - Number(candles[i].low),
      Math.abs(Number(candles[i].high) - Number(candles[i - 1].close)),
      Math.abs(Number(candles[i].low) - Number(candles[i - 1].close))
    )
    atr = atr == null ? tr : (atr * (Math.min(i, period) - 1) + tr) / Math.min(i, period)
  }
  return atr
}

// ── The model battery ───────────────────────────────────────────────────────
// Every model receives the candle array and derives its own closes — uniform
// signature so the runner can multiplex blindly. Each returns
// { name, short, direction: up|down|flat, confidence: 0-100, note } or null.

function toCloses(candles) {
  return Array.isArray(candles) ? candles.map((c) => Number(c.close)) : []
}

/** Trend follower: fast/slow EMA cross plus spread conviction. */
function modelTrendEma(candles) {
  const closes = toCloses(candles)
  const fast = ema(closes.slice(-40), 9)
  const slow = ema(closes.slice(-80), 21)
  if (fast == null || slow == null || slow === 0) return null
  const spread = ((fast - slow) / slow) * 100 // % distance
  const dir = spread > 0 ? "up" : spread < 0 ? "down" : "flat"
  const strength = Math.min(100, Math.abs(spread) * 25 + 20)
  return {
    name: "Trend EMA 9/21",
    short: "trend",
    direction: dir,
    confidence: Math.round(spread === 0 ? 35 : 35 + strength * 0.6),
    note: `spread ${spread.toFixed(3)}%`
  }
}

/** Momentum: rate of change over 10 bars. */
function modelMomentum(candles) {
  const closes = toCloses(candles)
  if (closes.length < 15) return null
  const roc = ((closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]) * 100
  const dir = roc > 0 ? "up" : roc < 0 ? "down" : "flat"
  return {
    name: "Momentum ROC-10",
    short: "momentum",
    direction: dir,
    confidence: roc === 0 ? 40 : Math.round(Math.min(90, 40 + Math.abs(roc) * 30)),
    note: `roc ${roc.toFixed(3)}%`
  }
}

/** Mean reversion: RSI extremes fade, mid-band follows the drift. */
function modelRsiReversion(candles) {
  const r = rsi(toCloses(candles), 14)
  if (r == null) return null
  if (r <= 30) return { name: "RSI Reversion", short: "rsi", direction: "up", confidence: Math.round(55 + (30 - r)), note: `RSI ${r.toFixed(1)} oversold` }
  if (r >= 70) return { name: "RSI Reversion", short: "rsi", direction: "down", confidence: Math.round(55 + (r - 70)), note: `RSI ${r.toFixed(1)} overbought` }
  const dir = r > 55 ? "up" : r < 45 ? "down" : "flat"
  return { name: "RSI Reversion", short: "rsi", direction: dir, confidence: Math.round(50 + Math.abs(r - 50) * 0.8), note: `RSI ${r.toFixed(1)}` }
}

/** Breakout: Donchian(20) channel position with ATR-scaled conviction. */
function modelBreakout(candles) {
  if (candles.length < 25) return null
  const window = candles.slice(-21, -1)
  const hi = Math.max(...window.map((c) => Number(c.high)))
  const lo = Math.min(...window.map((c) => Number(c.low)))
  const close = Number(candles[candles.length - 1].close)
  const range = hi - lo
  if (!(range > 0)) return null
  const pos = (close - lo) / range // 0..1 within channel
  const atr = atrFrom(candles.slice(-30), 14) ?? range / 10
  const edge = close > hi ? close - hi : close < lo ? lo - close : 0
  const breakoutStrength = atr > 0 ? Math.min(1, edge / (atr * 0.5)) : 0
  // Mid-band neutrality (audit §5.4): inside 0.40–0.60 the channel position
  // carries no directional edge — a range-bound market votes flat, never a
  // coin-flip up/down. The 0.15/0.85 tails stay breakout-fresh; the shoulders
  // keep the mild positional tilt without mid-band noise.
  const dir =
    pos > 0.85 ? "up" : pos < 0.15 ? "down" : pos >= 0.6 ? "up" : pos <= 0.4 ? "down" : "flat"
  const confidence = Math.round(38 + breakoutStrength * 45 + Math.abs(pos - 0.5) * 40)
  return {
    name: "Donchian Breakout",
    short: "breakout",
    direction: dir,
    confidence: Math.min(92, dir === "flat" ? Math.max(35, confidence) : confidence),
    note: `channel pos ${(pos * 100).toFixed(0)}%${edge > 0 ? " · breakout!" : dir === "flat" ? " · mid-band" : ""}`
  }
}

/** MACD histogram: classic 12/26/9 convergence signal. */
function modelMacd(candles) {
  const closes = toCloses(candles)
  if (closes.length < 40) return null
  // MACD series computed in ONE O(n) pass over the closes (audit §5.5): a full
  // EMA12/EMA26 run, differenced. The old per-end slice recompute was quadratic
  // and re-derived identical prefix values on every iteration.
  const e12run = emaSeries(closes, 12)
  const e26run = emaSeries(closes, 26)
  const macdSeries = []
  for (let i = 25; i < closes.length; i++) {
    const f = e12run[i]
    const s = e26run[i]
    if (f != null && s != null) macdSeries.push(f - s)
  }
  if (!macdSeries.length) return null
  // Approximate the signal line as EMA9 of the MACD values.
  const signal = ema(macdSeries, 9)
  const macd = macdSeries[macdSeries.length - 1]
  if (signal == null || !Number.isFinite(macd)) return null
  const hist = macd - signal
  const normHist = closes[closes.length - 1] > 0 ? (hist / closes[closes.length - 1]) * 100 : 0
  return {
    name: "MACD 12/26/9",
    short: "macd",
    direction: hist > 0 ? "up" : hist < 0 ? "down" : "flat",
    confidence: Math.round(Math.min(88, 42 + Math.abs(normHist) * 400)),
    note: `hist ${normHist.toFixed(4)}%`
  }
}

/** Volatility Monte-Carlo: GBM drift estimate with realized-vol scaling. */
function modelMonteCarlo(candles) {
  const closes = toCloses(candles)
  if (closes.length < 60) return null
  const rets = []
  for (let i = closes.length - 60 + 1; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]))
  }
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length
  const variance = rets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, rets.length - 1)
  const sigma = Math.sqrt(variance)
  if (!Number.isFinite(sigma) || sigma === 0) return null
  // t-statistic of the drift: mean / (sigma/sqrt(n)) — how SIGNIFICANT is the drift?
  const tStat = mean / (sigma / Math.sqrt(rets.length))
  const dir = mean > 0 ? "up" : mean < 0 ? "down" : "flat"
  return {
    name: "MC Drift σ",
    short: "montecarlo",
    direction: dir,
    confidence: Math.round(Math.min(85, 40 + Math.abs(tStat) * 22)),
    note: `t=${tStat.toFixed(2)}, σ=${(sigma * 100).toFixed(3)}%`
  }
}

/** Candle pressure: body/wick asymmetry over the trailing 10 bars. */
function modelCandlePressure(candles) {
  if (candles.length < 12) return null
  let score = 0
  for (const c of candles.slice(-10)) {
    const o = Number(c.open)
    const h = Number(c.high)
    const l = Number(c.low)
    const cl = Number(c.close)
    const range = h - l
    if (!(range > 0)) continue
    score += ((cl - o) / range) * 2 // body direction dominates
    score += (cl >= o ? h - cl : h - o) / range * -0.5 // upper wick = selling pressure
    score += ((cl >= o ? o - l : cl - l) / range) * 0.5 // lower wick = buying pressure
  }
  const normalized = score / 10 // roughly -2..2
  const dir = normalized > 0.15 ? "up" : normalized < -0.15 ? "down" : "flat"
  return {
    name: "Candle Pressure",
    short: "pressure",
    direction: dir,
    confidence: Math.round(Math.min(86, 42 + Math.abs(normalized) * 28)),
    note: `score ${normalized.toFixed(2)}`
  }
}

/** Stochastic reversion: %K extremes fade; mid-band stays neutral (no drift chase). */
function modelStochasticReversion(candles) {
  if (candles.length < 20) return null
  const window = candles.slice(-14)
  const hi = Math.max(...window.map((c) => Number(c.high)))
  const lo = Math.min(...window.map((c) => Number(c.low)))
  const close = Number(candles[candles.length - 1].close)
  const rng = hi - lo
  if (!(rng > 0)) return null
  const k = ((close - lo) / rng) * 100
  if (k >= 80) {
    return { name: "Stochastic Reversion", short: "stoch", direction: "down", confidence: Math.round(Math.min(92, 55 + (k - 80) * 0.6)), note: `%K ${k.toFixed(1)} overbought` }
  }
  if (k <= 20) {
    return { name: "Stochastic Reversion", short: "stoch", direction: "up", confidence: Math.round(Math.min(92, 55 + (20 - k) * 0.6)), note: `%K ${k.toFixed(1)} oversold` }
  }
  return { name: "Stochastic Reversion", short: "stoch", direction: "flat", confidence: Math.round(48 + Math.abs(k - 50) * 0.4), note: `%K ${k.toFixed(1)} mid-band` }
}

/** Anchored-VWAP deviation: distance from the volume-weighted anchor (reversion beyond ±1%). */
function modelAnchoredVwap(candles) {
  const window = candles.slice(-50)
  if (window.length < 30) return null
  let pv = 0
  let vol = 0
  for (const c of window) {
    const typical = (Number(c.high) + Number(c.low) + Number(c.close)) / 3
    // Volume-less sources fall back to bar range as a size proxy — still pure.
    const v = Number(c.volume) > 0 ? Number(c.volume) : Number(c.high) - Number(c.low)
    pv += typical * v
    vol += v
  }
  if (!(vol > 0)) return null
  const vwap = pv / vol
  const close = Number(candles[candles.length - 1].close)
  if (!(vwap > 0)) return null
  const dev = ((close - vwap) / vwap) * 100
  if (dev >= 1) return { name: "Anchored VWAP Dev", short: "avwap", direction: "down", confidence: Math.round(Math.min(90, 55 + (dev - 1) * 12)), note: `dev +${dev.toFixed(2)}% overextended` }
  if (dev <= -1) return { name: "Anchored VWAP Dev", short: "avwap", direction: "up", confidence: Math.round(Math.min(90, 55 + (-1 - dev) * 12)), note: `dev ${dev.toFixed(2)}% underbought` }
  return { name: "Anchored VWAP Dev", short: "avwap", direction: "flat", confidence: Math.round(48 + Math.abs(dev) * 12), note: `dev ${dev.toFixed(2)}% in band` }
}

const MODELS = [
  [modelTrendEma, "trend"],
  [modelMomentum, "momentum"],
  [modelRsiReversion, "rsi"],
  [modelBreakout, "breakout"],
  [modelMacd, "macd"],
  [modelMonteCarlo, "montecarlo"],
  [modelCandlePressure, "pressure"],
  [modelStochasticReversion, "stoch"],
  [modelAnchoredVwap, "avwap"]
].map(([fn, short]) => Object.assign(fn, { __short: short }))

// ── Online weight adaptation ────────────────────────────────────────────────

function weightsStore() {
  const store = localStore(WEIGHTS_STORE, { data: { wins: {}, counts: {}, pruned: {} } })
  if (!store.data.wins || typeof store.data.wins !== "object") store.data.wins = {}
  if (!store.data.counts || typeof store.data.counts !== "object") store.data.counts = {}
  if (!store.data.pruned || typeof store.data.pruned !== "object") store.data.pruned = {}
  return store
}

/** Has a model been pruned? Pruned models are kept on record but never weighted. */
export function isPruned(short) {
  try {
    return Boolean(weightsStore().data.pruned?.[short])
  } catch {
    return false
  }
}

/**
 * Record each model's vote outcome after a trade resolves. Called from the
 * settlement pipeline so weights track REALIZED accuracy per model.
 *
 * Every call also decays ALL stored win-rates toward 0.5 — an elevated weight
 * must keep proving itself or it erodes toward equilibrium (no negative
 * outcome needs to accumulate for a stale run of luck to fade).
 *
 * Models that persist at or below chance across PRUNE_MIN_SAMPLES resolved
 * outcomes are pruned from fusion (record kept, weighting stopped).
 * @param votes Array<{short, direction}> — what each model said at entry
 * @param wentUp boolean — actual price direction at resolution
 */
export function recordModelOutcomes(votes, wentUp) {
  try {
    const store = weightsStore()
    // 1. Decay every stored win-rate toward chance before applying new evidence.
    for (const key of Object.keys(store.data.wins)) {
      const acc = store.data.wins[key]
      store.data.wins[key] = 0.5 + (acc - 0.5) * (1 - DECAY_ALPHA)
    }
    // 2. Apply the new evidence (EMA of correctness — recent trades count most).
    for (const v of Array.isArray(votes) ? votes : []) {
      if (!v?.short || !v?.direction || v.direction === "flat") continue
      store.data.counts[v.short] = (store.data.counts[v.short] ?? 0) + 1
      const correct = (v.direction === "up") === Boolean(wentUp)
      const prevWins = store.data.wins[v.short] ?? 0.5
      store.data.wins[v.short] = prevWins * (1 - EMA_ALPHA) + (correct ? 1 : 0) * EMA_ALPHA
    }
    // 3. Prune degenerate models: at-or-below chance (≤50%) over enough samples.
    for (const [short, acc] of Object.entries(store.data.wins)) {
      if (store.data.pruned[short]) continue
      const count = store.data.counts[short] ?? 0
      if (count >= PRUNE_MIN_SAMPLES && acc <= 0.5) {
        store.data.pruned[short] = {
          at: Date.now(),
          reason: `persistent realized accuracy ${Math.round(acc * 100)}% over ${count} resolved outcomes`
        }
      }
    }
    store.write()
  } catch {
    /* best-effort — never break settlement */
  }
}

function modelWeight(short) {
  try {
    if (isPruned(short)) return 0
    const { wins } = weightsStore().data
    const acc = wins[short]
    if (!Number.isFinite(acc)) return 1
    return Math.min(WEIGHT_CEIL, Math.max(WEIGHT_FLOOR, acc / 0.5))
  } catch {
    return 1
  }
}

export function getModelWeights() {
  try {
    const { wins, counts, pruned } = weightsStore().data
    const out = {}
    // Build directly from stored keys so persisted models survive refactors.
    for (const key of new Set([...Object.keys(wins ?? {})])) {
      const prunedInfo = pruned?.[key]
      out[key] = {
        accuracy: Math.round((wins[key] ?? 0.5) * 1000) / 10,
        samples: counts[key] ?? 0,
        weight: Math.round(modelWeight(key) * 100) / 100,
        pruned: Boolean(prunedInfo),
        prunedReason: prunedInfo?.reason ?? null
      }
    }
    return out
  } catch {
    return {}
  }
}

// ── Consensus fusion ────────────────────────────────────────────────────────

/**
 * Run the full battery against one candle series and fuse the votes.
 * @returns {ok, spot, consensus:{direction,confidence,agree,total}, votes[], weights}
 */
export function computeModelMatrix(candles) {
  const rows = Array.isArray(candles) ? candles.filter((c) =>
    c && [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(Number(v)) && Number(v) > 0)
  ) : []
  if (rows.length < 40) {
    return { ok: false, reason: `not enough candles (${rows.length}/40)` }
  }
  const closes = rows.map((c) => Number(c.close))
  const spot = closes[closes.length - 1]

  const votes = []
  for (const model of MODELS) {
    // Pruned models are excluded from fusion — their record stays, weighting stops.
    if (isPruned(model.__short)) continue
    try {
      const v = model(rows)
      if (v && ["up", "down", "flat"].includes(v.direction)) votes.push(v)
    } catch {
      /* a broken model must never kill the matrix */
    }
  }
  if (!votes.length) return { ok: false, reason: "all models abstained" }

  let upScore = 0
  let downScore = 0
  let totalWeight = 0
  for (const v of votes) {
    if (v.direction === "flat") continue
    const w = modelWeight(v.short) * (v.confidence / 100)
    totalWeight += w
    if (v.direction === "up") upScore += w
    else downScore += w
  }

  const directional = votes.filter((v) => v.direction !== "flat")
  const agree = directional.length
    ? Math.max(
        directional.filter((v) => v.direction === "up").length,
        directional.filter((v) => v.direction === "down").length
      )
    : 0

  let direction = "flat"
  let confidence = 50
  if (totalWeight > 0) {
    const bullShare = upScore / (upScore + downScore)
    direction = bullShare > 0.58 ? "up" : bullShare < 0.42 ? "down" : "flat"
    // Confidence shrinks when models disagree — honest uncertainty. It is
    // also scaled by how much of the battery actually voted: one directional
    // model among seven flat ones must NEVER read as a strong signal.
    const dominance = Math.abs(bullShare - 0.5) * 2 // 0..1
    const participation = agree / votes.length // 0..1
    confidence = Math.round(46 + dominance * 44 * (0.35 + 0.65 * participation))
  }

  const prunedModels = MODELS.filter((m) => isPruned(m.__short)).map((m) => m.__short)

  return {
    ok: true,
    spot,
    engine: "9-model-fusion", // F-08: identity of the brain that produced this
    generatedAt: new Date().toISOString(),
    modelsRun: MODELS.length - prunedModels.length,
    pruned: prunedModels,
    consensus: { direction, confidence, agree, total: votes.length },
    votes: votes.map((v) => ({
      name: v.name,
      short: v.short,
      direction: v.direction,
      confidence: v.confidence,
      note: v.note,
      weight: Math.round(modelWeight(v.short) * 100) / 100
    })),
    weights: getModelWeights()
  }
}
