// Chart overlay indicator math (T10) — pure, dependency-free, mirrors the
// canonical formulas in `server/services/indicators.mjs` (sma/ema/bollinger/
// rsi/macd) so the chart overlays agree with the server dashboard exactly.
// Every function takes candles ({time, open, high, low, close, volume?}) and
// returns {time, value}[] points aligned to real candle times — warm-up bars
// emit no points (same convention as the existing computeEma in useCandleData).

export interface OverlayCandle<T = unknown> {
  time: T
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface OverlayPoint<T = unknown> {
  time: T
  value: number
}

const isFin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

function closesOf<T>(candles: OverlayCandle<T>[]): number[] {
  return candles.map((c) => c.close)
}

/** Null-padded EMA indexed by candle position — the indicators.mjs ema core. */
function emaPadded(values: number[], period: number): Array<number | null> {
  const n = Math.max(1, Math.round(period))
  const out: Array<number | null> = Array(values.length).fill(null)
  const k = 2 / (n + 1)
  let prev: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (!isFin(values[i])) continue
    if (prev == null) {
      const seed = values.slice(Math.max(0, i - n + 1), i + 1).filter(isFin)
      if (seed.length < n) continue
      prev = seed.reduce((s, v) => s + v, 0) / seed.length
      out[i] = prev
      continue
    }
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

function zip<T>(candles: OverlayCandle<T>[], values: Array<number | null>): OverlayPoint<T>[] {
  const out: OverlayPoint<T>[] = []
  for (let i = 0; i < candles.length && i < values.length; i++) {
    if (values[i] == null) continue
    out.push({ time: candles[i].time, value: values[i] as number })
  }
  return out
}

/** Simple moving average — first point after `period - 1` bars (indicators.mjs sma). */
export function sma<T>(candles: OverlayCandle<T>[], period = 20): OverlayPoint<T>[] {
  const n = Math.max(1, Math.round(period))
  const closes = closesOf(candles)
  const out: OverlayPoint<T>[] = []
  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    if (!isFin(closes[i])) continue
    sum += closes[i]
    if (i >= n && isFin(closes[i - n])) sum -= closes[i - n]
    if (i >= n - 1) out.push({ time: candles[i].time, value: sum / n })
  }
  return out
}

/** Exponential moving average — SMA-seeded, k = 2/(n+1) (indicators.mjs ema). */
export function ema<T>(candles: OverlayCandle<T>[], period = 20): OverlayPoint<T>[] {
  return zip(candles, emaPadded(closesOf(candles), period))
}

/** Population standard deviation of an array of finite numbers. */
export function std(xs: number[]): number {
  const a = xs.filter(isFin)
  if (a.length < 2) return 0
  const m = a.reduce((s, v) => s + v, 0) / a.length
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length)
}

/** Bollinger bands — mid = SMA(period), bands = mid ± 2·std (indicators.mjs bollinger). */
export function bollinger<T>(candles: OverlayCandle<T>[], { period = 20, mult = 2 } = {}): { upper: OverlayPoint<T>[]; mid: OverlayPoint<T>[]; lower: OverlayPoint<T>[] } {
  const p = Math.max(2, Math.round(period))
  const closes = closesOf(candles)
  const upper: OverlayPoint<T>[] = []
  const mid: OverlayPoint<T>[] = []
  const lower: OverlayPoint<T>[] = []
  for (let i = p - 1; i < closes.length; i++) {
    const win = closes.slice(i - p + 1, i + 1)
    if (win.some((v) => !isFin(v))) continue
    const m = win.reduce((s, v) => s + v, 0) / p
    const sd = std(win)
    mid.push({ time: candles[i].time, value: m })
    upper.push({ time: candles[i].time, value: m + mult * sd })
    lower.push({ time: candles[i].time, value: m - mult * sd })
  }
  return { upper, mid, lower }
}

/** Relative Strength Index (Wilder smoothing) — indicators.mjs rsi, same warm-up + flat-series rule. */
export function rsi<T>(candles: OverlayCandle<T>[], period = 14): OverlayPoint<T>[] {
  const p = Math.max(2, Math.round(period))
  const closes = closesOf(candles)
  const out: OverlayPoint<T>[] = []
  let avgGain: number | null = null
  let avgLoss: number | null = null
  for (let i = 1; i < closes.length; i++) {
    if (!isFin(closes[i]) || !isFin(closes[i - 1])) continue
    const chg = closes[i] - closes[i - 1]
    const gain = Math.max(chg, 0)
    const loss = Math.max(-chg, 0)
    if (avgGain != null && avgLoss != null) {
      avgGain = (avgGain * (p - 1) + gain) / p
      avgLoss = (avgLoss * (p - 1) + loss) / p
      out.push({ time: candles[i].time, value: 100 - 100 / (1 + (avgLoss > 0 ? avgGain / avgLoss : Infinity)) })
      continue
    }
    const seed: number[] = []
    let seedOk = true
    for (let j = Math.max(1, i - p + 1); j <= i; j++) {
      if (!isFin(closes[j]) || !isFin(closes[j - 1])) { seedOk = false; break }
      seed.push(closes[j] - closes[j - 1])
    }
    if (!seedOk || seed.length < p) continue
    avgGain = seed.reduce((s, d) => s + Math.max(d, 0), 0) / p
    avgLoss = seed.reduce((s, d) => s + Math.max(-d, 0), 0) / p
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + (avgLoss > 0 ? avgGain / avgLoss : Infinity)) })
  }
  return out
}

/** MACD (12/26/9): line = EMA12 − EMA26, signal = EMA9(line), histogram = line − signal (indicators.mjs macd). */
export function macd<T>(candles: OverlayCandle<T>[], { fast = 12, slow = 26, signal = 9 } = {}): { line: OverlayPoint<T>[]; signal: OverlayPoint<T>[]; hist: OverlayPoint<T>[] } {
  const closes = closesOf(candles)
  const f = emaPadded(closes, fast)
  const s = emaPadded(closes, slow)
  const raw = Array(closes.length).fill(null) as Array<number | null>
  for (let i = 0; i < closes.length; i++) {
    if (f[i] != null && s[i] != null) raw[i] = f[i] as number - (s[i] as number)
  }
  const sigPadded = emaPadded(raw as number[], signal)
  const line: OverlayPoint<T>[] = []
  const sig: OverlayPoint<T>[] = []
  const hist: OverlayPoint<T>[] = []
  for (let i = 0; i < closes.length; i++) {
    if (raw[i] == null) continue
    const l = raw[i] as number
    line.push({ time: candles[i].time, value: l })
    if (sigPadded[i] == null) continue
    sig.push({ time: candles[i].time, value: sigPadded[i] as number })
    hist.push({ time: candles[i].time, value: l - (sigPadded[i] as number) })
  }
  return { line, signal: sig, hist }
}

// ---------------------------------------------------------------------------
// Niche indicators (in-house) — pure, dependency-free, canonical formulas
// from COMPREHENSIVE_TRADING_KNOWLEDGE_BASE.md
// ---------------------------------------------------------------------------

/** Wilder smoothing: SMA-seeded then `(prev*(p-1)+current)/p`. Same pattern as the RSI avgGain smoothing. */
function wilderSmooth(values: number[], period: number): Array<number | null> {
  const p = Math.max(1, Math.round(period))
  const out: Array<number | null> = Array(values.length).fill(null)
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    if (!isFin(values[i])) continue
    if (count < p) {
      sum += values[i]
      count++
      if (count === p) { out[i] = sum / p }
      continue
    }
    const prev = out[i - 1]
    if (prev == null) continue
    out[i] = (prev * (p - 1) + values[i]) / p
  }
  return out
}

/** Weighted moving average: weights descending `period, period-1, …, 1`, denominator = sum(1..period). */
function wma(values: number[], period: number): Array<number | null> {
  const p = Math.max(1, Math.round(period))
  const denom = (p * (p + 1)) / 2
  const out: Array<number | null> = Array(values.length).fill(null)
  for (let i = p - 1; i < values.length; i++) {
    let sum = 0
    let valid = true
    for (let j = 0; j < p; j++) {
      if (!isFin(values[i - j])) { valid = false; break }
      sum += values[i - j] * (p - j)
    }
    if (valid) out[i] = sum / denom
  }
  return out
}

/** Choppiness Index (period=14): 100×log₁₀(ATR_sum/(HH-LL))/log₁₀(period). Range 0–100. */
export function choppinessIndex<T>(candles: OverlayCandle<T>[], period = 14): OverlayPoint<T>[] {
  const p = Math.max(2, Math.round(period))
  const out: OverlayPoint<T>[] = []
  if (candles.length < p + 1) return out
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const closes = closesOf(candles)
  const trArr: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (!isFin(highs[i]) || !isFin(lows[i]) || !isFin(closes[i - 1])) { trArr.push(NaN); continue }
    trArr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  }
  let atrSum = 0
  for (let i = p - 1; i < trArr.length; i++) {
    if (i === p - 1) {
      atrSum = 0
      for (let j = 0; j < p; j++) atrSum += isFin(trArr[i - j]) ? trArr[i - j] : 0
    } else {
      atrSum += isFin(trArr[i]) ? trArr[i] : 0
      atrSum -= isFin(trArr[i - p]) ? trArr[i - p] : 0
    }
    const ci = i + 1
    if (ci < p) continue
    let hh = -Infinity, ll = Infinity
    for (let j = ci - p; j < ci; j++) {
      if (highs[j] > hh) hh = highs[j]
      if (lows[j] < ll) ll = lows[j]
    }
    const chop = hh !== ll ? 100 * Math.log10(atrSum / (hh - ll)) / Math.log10(p) : 50
    if (ci < candles.length) out.push({ time: candles[ci].time, value: chop })
  }
  return out
}

/** True Strength Index (long=25, short=13): double-smoothed momentum ratio. Range -100..100. */
export function trueStrengthIndex<T>(candles: OverlayCandle<T>[], { long = 25, short = 13 } = {}): OverlayPoint<T>[] {
  const closes = closesOf(candles)
  const pc: number[] = Array(closes.length).fill(NaN)
  for (let i = 1; i < closes.length; i++) {
    if (isFin(closes[i]) && isFin(closes[i - 1])) pc[i] = closes[i] - closes[i - 1]
  }
  const absPc = pc.map((v) => Math.abs(v))
  const doubleSmoothPC = emaPadded(emaPadded(pc, long).map((v) => v ?? NaN), short)
  const doubleSmoothAbsPC = emaPadded(emaPadded(absPc, long).map((v) => v ?? NaN), short)
  const out: OverlayPoint<T>[] = []
  for (let i = 0; i < closes.length; i++) {
    if (doubleSmoothPC[i] == null || doubleSmoothAbsPC[i] == null) continue
    const denom = doubleSmoothAbsPC[i] as number
    out.push({ time: candles[i].time, value: denom !== 0 ? 100 * (doubleSmoothPC[i] as number) / denom : 0 })
  }
  return out
}

/** DeMarker (period=14): Wilder-smoothed DeMax/(DeMax+DeMin). Range 0–100. */
export function deMarker<T>(candles: OverlayCandle<T>[], period = 14): OverlayPoint<T>[] {
  const p = Math.max(2, Math.round(period))
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const deMax: number[] = []
  const deMin: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (i === 0 || !isFin(highs[i]) || !isFin(highs[i - 1]) || !isFin(lows[i]) || !isFin(lows[i - 1])) {
      deMax.push(NaN); deMin.push(NaN); continue
    }
    deMax.push(Math.max(highs[i] - highs[i - 1], 0))
    deMin.push(Math.max(lows[i - 1] - lows[i], 0))
  }
  const sMax = wilderSmooth(deMax, p)
  const sMin = wilderSmooth(deMin, p)
  const out: OverlayPoint<T>[] = []
  for (let i = 0; i < candles.length; i++) {
    if (sMax[i] == null || sMin[i] == null) continue
    const denom = (sMax[i] as number) + (sMin[i] as number)
    out.push({ time: candles[i].time, value: denom !== 0 ? 100 * (sMax[i] as number) / denom : 50 })
  }
  return out
}

/**
 * Fisher Transform (period=9): smoothed mid→atanh normalization.
 * Returns `{ fisher, signal }` (same shape pattern as macd).
 */
export function fisherTransform<T>(candles: OverlayCandle<T>[], period = 9): { fisher: OverlayPoint<T>[]; signal: OverlayPoint<T>[] } {
  const p = Math.max(2, Math.round(period))
  const fisherOut: OverlayPoint<T>[] = []
  const signalOut: OverlayPoint<T>[] = []
  if (candles.length < p) return { fisher: fisherOut, signal: signalOut }
  const mid = candles.map((c) => (c.high + c.low) / 2)
  const fisherArr: number[] = []
  let smoothedPrev = 0
  for (let i = p - 1; i < candles.length; i++) {
    let hh = -Infinity, ll = Infinity
    for (let j = i - p + 1; j <= i; j++) {
      if (mid[j] > hh) hh = mid[j]
      if (mid[j] < ll) ll = mid[j]
    }
    const raw = hh !== ll ? 2 * ((mid[i] - ll) / (hh - ll) - 0.5) : 0
    const clamped = Math.max(-0.999, Math.min(0.999, raw))
    const smoothed = clamped * 0.666 + smoothedPrev * 0.334
    smoothedPrev = smoothed
    const f = 0.5 * Math.log((1 + smoothed) / (1 - smoothed))
    fisherArr.push(f)
    fisherOut.push({ time: candles[i].time, value: f })
    if (fisherArr.length >= 2) {
      const prev = fisherArr[fisherArr.length - 2]
      signalOut.push({ time: candles[i].time, value: f * 0.5 + prev * 0.5 })
    }
  }
  return { fisher: fisherOut, signal: signalOut }
}

/**
 * Coppock Curve (wmaPeriod=10, rocLong=14, rocShort=11): WMA(10) of ROC14+ROC11.
 * First emit at bar `rocLong + wmaPeriod - 1` (needs rocLong+1 closes).
 */
export function coppockCurve<T>(candles: OverlayCandle<T>[], { wmaPeriod = 10, rocLong = 14, rocShort = 11 } = {}): OverlayPoint<T>[] {
  const closes = closesOf(candles)
  const rocArr: number[] = Array(closes.length).fill(NaN)
  for (let i = rocLong; i < closes.length; i++) {
    if (!isFin(closes[i]) || !isFin(closes[i - rocLong]) || !isFin(closes[i - rocShort])) continue
    rocArr[i] = ((closes[i] - closes[i - rocLong]) / closes[i - rocLong]) * 100
      + ((closes[i] - closes[i - rocShort]) / closes[i - rocShort]) * 100
  }
  return zip(candles, wma(rocArr, wmaPeriod))
}

/** Convenience aggregator: runs all five niche indicators. Returns null when candles < MIN_NICH (25). */
export function nicheIndicators<T>(candles: OverlayCandle<T>[]): {
  choppiness: OverlayPoint<T>[]
  tsi: OverlayPoint<T>[]
  deMarker: OverlayPoint<T>[]
  fisher: { fisher: OverlayPoint<T>[]; signal: OverlayPoint<T>[] }
  coppock: OverlayPoint<T>[]
} | null {
  const MIN_NICH = 25
  if (candles.length < MIN_NICH) return null
  return {
    choppiness: choppinessIndex(candles),
    tsi: trueStrengthIndex(candles),
    deMarker: deMarker(candles),
    fisher: fisherTransform(candles),
    coppock: coppockCurve(candles),
  }
}