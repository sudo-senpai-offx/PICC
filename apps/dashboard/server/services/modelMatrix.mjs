// PICC Model Matrix — the multiplexing trading-infrastructure core.
//
// One candle series in, SEVEN independent model votes out, fused into a
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
//     grow toward 1.6). Weights persist via localStore.
//
// Keep every model PURE: candles in → vote out. No I/O inside model fns.

import { localStore } from "./localstore.mjs"

const WEIGHTS_STORE = "modelMatrix"
const EMA_ALPHA = 0.18 // recency factor for online win-rate updates
const WEIGHT_FLOOR = 0.4
const WEIGHT_CEIL = 1.6

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
  const dir = pos > 0.85 ? "up" : pos < 0.15 ? "down" : pos >= 0.5 ? "up" : "down"
  const confidence = Math.round(38 + breakoutStrength * 45 + Math.abs(pos - 0.5) * 40)
  return {
    name: "Donchian Breakout",
    short: "breakout",
    direction: dir,
    confidence: Math.min(92, confidence),
    note: `channel pos ${(pos * 100).toFixed(0)}%${edge > 0 ? " · breakout!" : ""}`
  }
}

/** MACD histogram: classic 12/26/9 convergence signal. */
function modelMacd(candles) {
  const closes = toCloses(candles)
  if (closes.length < 40) return null
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  if (e12 == null || e26 == null) return null
  // Approximate the signal line as EMA9 of recent MACD values.
  const macdSeries = []
  for (let end = 26; end <= closes.length; end++) {
    const f = ema(closes.slice(0, end), 12)
    const s = ema(closes.slice(0, end), 26)
    if (f != null && s != null) macdSeries.push(f - s)
  }
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

const MODELS = [modelTrendEma, modelMomentum, modelRsiReversion, modelBreakout, modelMacd, modelMonteCarlo, modelCandlePressure]

// ── Online weight adaptation ────────────────────────────────────────────────

function weightsStore() {
  const store = localStore(WEIGHTS_STORE, { data: { wins: {}, counts: {} } })
  if (!store.data.wins || typeof store.data.wins !== "object") store.data.wins = {}
  if (!store.data.counts || typeof store.data.counts !== "object") store.data.counts = {}
  return store
}

/**
 * Record each model's vote outcome after a trade resolves. Called from the
 * settlement pipeline so weights track REALIZED accuracy per model.
 * @param votes Array<{short, direction}> — what each model said at entry
 * @param wentUp boolean — actual price direction at resolution
 */
export function recordModelOutcomes(votes, wentUp) {
  try {
    const store = weightsStore()
    for (const v of Array.isArray(votes) ? votes : []) {
      if (!v?.short || !v?.direction || v.direction === "flat") continue
      store.data.counts[v.short] = (store.data.counts[v.short] ?? 0) + 1
      const correct = (v.direction === "up") === Boolean(wentUp)
      const prevWins = store.data.wins[v.short] ?? 0.5
      // EMA of correctness — recent trades matter most.
      store.data.wins[v.short] = prevWins * (1 - EMA_ALPHA) + (correct ? 1 : 0) * EMA_ALPHA
    }
    store.write()
  } catch {
    /* best-effort — never break settlement */
  }
}

function modelWeight(short) {
  try {
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
    const { wins, counts } = weightsStore().data
    const out = {}
    for (const m of MODELS) {
      const probe = m.__short ?? MODELS.indexOf(m)
      void probe
    }
    // Build directly from stored keys so persisted models survive refactors.
    for (const key of new Set([...Object.keys(wins ?? {})])) {
      out[key] = {
        accuracy: Math.round((wins[key] ?? 0.5) * 1000) / 10,
        samples: counts[key] ?? 0,
        weight: Math.round(modelWeight(key) * 100) / 100
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

  return {
    ok: true,
    spot,
    generatedAt: new Date().toISOString(),
    modelsRun: MODELS.length,
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
