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