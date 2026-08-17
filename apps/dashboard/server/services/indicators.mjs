// PICC indicator masterclass — pure, dependency-free technical analysis math.
//
// Every function takes plain numeric arrays (or candle objects) and returns
// arrays aligned to the input length (null during the warm-up window), plus a
// convenience "dashboard" that computes the whole suite at once. Formulas
// follow the canonical implementations (Wilder smoothing for RSI/ADX/ATR,
// Bill Williams for Alligator/AO/Fractals, TA-Lib conventions for BB/CCI/APO).
//
// Educational decision support only. Nothing here executes trades.

const EPS = 1e-12

const isNum = (v) => typeof v === "number" && Number.isFinite(v)

function numArr(xs) {
  return (Array.isArray(xs) ? xs : []).map((x) => (isNum(x) ? x : null))
}

function fillNull(n) {
  return Array(n).fill(null)
}

// ---------------------------------------------------------------------
// Basic statistics + smoothing primitives
// ---------------------------------------------------------------------

export function mean(xs) {
  const a = numArr(xs)
  if (!a.length) return NaN
  return a.reduce((s, v) => s + v, 0) / a.length
}

export function std(xs, m = mean(xs)) {
  const a = numArr(xs).filter((v) => v != null)
  if (a.length < 2) return 0
  const d = a.reduce((s, v) => s + (v - m) * (v - m), 0)
  return Math.sqrt(d / a.length) // population std (TA-Lib convention)
}

/** Simple moving average. */
export function sma(xs, period = 20) {
  const a = numArr(xs)
  const out = fillNull(a.length)
  const n = Math.max(1, Math.round(period))
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] != null) sum += a[i]
    if (i >= n && a[i - n] != null) sum -= a[i - n]
    if (i >= n - 1) out[i] = sum / n
  }
  return out
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(xs, period = 20) {
  const a = numArr(xs)
  const out = fillNull(a.length)
  const n = Math.max(1, Math.round(period))
  const k = 2 / (n + 1)
  let prev = null
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null) continue
    if (prev == null) {
      const seed = a.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null)
      if (seed.length < n) continue
      prev = seed.reduce((s, v) => s + v, 0) / seed.length
      out[i] = prev
      continue
    }
    prev = a[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/**
 * Smoothed moving average (Wilder / SMMA): first value is the SMA of the first
 * `period` points, then `(prev * (period-1) + value) / period`. Used by the
 * Bill Williams Alligator and Wilder RSI/ATR/ADX smoothing.
 */
export function smma(xs, period = 14) {
  const a = numArr(xs)
  const out = fillNull(a.length)
  const n = Math.max(1, Math.round(period))
  let prev = null
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null) continue
    if (prev == null) {
      const seed = a.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null)
      if (seed.length < n) continue
      prev = seed.reduce((s, v) => s + v, 0) / seed.length
      out[i] = prev
      continue
    }
    prev = (prev * (n - 1) + a[i]) / n
    out[i] = prev
  }
  return out
}

/** Percentage-change series: (x[i] - x[i-1]) / x[i-1] * 100. */
export function pctChange(xs) {
  const a = numArr(xs)
  const out = fillNull(a.length)
  for (let i = 1; i < a.length; i++) {
    if (a[i - 1] != null && Math.abs(a[i - 1]) > EPS) out[i] = ((a[i] - a[i - 1]) / a[i - 1]) * 100
  }
  return out
}

// ---------------------------------------------------------------------
// Candles: normalization + aggregation
// ---------------------------------------------------------------------

/**
 * Normalize a raw series (Yahoo history or ExpertOption candles) into an array
 * of candle objects. When high/low/open are missing (close-only inputs, as in
 * tests), they are synthesized from the close so the indicator math still runs.
 */
export function candlesFromSeries({ closes = [], opens = [], highs = [], lows = [], volumes = [], times = [] } = {}) {
  const n = Math.max(closes.length, opens.length, highs.length, lows.length)
  const out = []
  for (let i = 0; i < n; i++) {
    const c = Number(closes[i])
    if (!isNum(c) || c <= 0) continue
    const o = isNum(opens[i]) && opens[i] > 0 ? Number(opens[i]) : c
    const h = isNum(highs[i]) && highs[i] > 0 ? Number(highs[i]) : c
    const l = isNum(lows[i]) && lows[i] > 0 ? Number(lows[i]) : c
    out.push({
      time: isNum(times[i]) ? Number(times[i]) : i,
      open: Math.min(Math.max(o, l), h),
      high: Math.max(h, o, l, c),
      low: Math.min(l, o, c),
      close: c,
      volume: isNum(volumes[i]) ? Number(volumes[i]) : 0
    })
  }
  return out
}

/** Convert an array of candle objects into aligned named arrays. */
export function candleArrays(candles) {
  const opens = [], highs = [], lows = [], closes = [], volumes = [], times = []
  for (const c of candles || []) {
    opens.push(Number(c.open) ?? 0)
    highs.push(Number(c.high) ?? 0)
    lows.push(Number(c.low) ?? 0)
    closes.push(Number(c.close) ?? 0)
    volumes.push(Number(c.volume) ?? 0)
    times.push(Number(c.time) ?? 0)
  }
  return { opens, highs, lows, closes, volumes, times }
}

/** Aggregate every `factor` bars into a single higher-timeframe candle. */
export function aggregateCandles(candles, factor = 5) {
  const n = Math.max(1, Math.round(factor))
  const out = []
  for (let i = 0; i < candles.length; i += n) {
    const group = candles.slice(i, i + n)
    if (!group.length) continue
    const o = group[0].open
    const h = Math.max(...group.map((c) => c.high))
    const l = Math.min(...group.map((c) => c.low))
    const c = group[group.length - 1].close
    const v = group.reduce((s, x) => s + (Number(x.volume) || 0), 0)
    const t = group[group.length - 1].time
    out.push({ time: t, open: o, high: h, low: l, close: c, volume: v })
  }
  return out
}

// ---------------------------------------------------------------------
// Trend / structure
// ---------------------------------------------------------------------

/**
 * Bill Williams Alligator. Each line is an SMMA of the median price
 * (high+low)/2 shifted forward (jaw 13/8, teeth 8/5, lips 5/3). The shifted
 * value for bar i is the SMMA as it stood `offset` bars ago (i.e. SMMA[i+offset]
 * lives at bar i for charting), so the *current* line value is the SMMA at
 * `i - offset`.
 */
export function alligator(highs, lows, { jawPeriod = 13, teethPeriod = 8, lipsPeriod = 5, jawOffset = 8, teethOffset = 5, lipsOffset = 3 } = {}) {
  const h = numArr(highs)
  const l = numArr(lows)
  const n = h.length
  const med = h.map((v, i) => (v != null && l[i] != null ? (v + l[i]) / 2 : null))
  const jawS = smma(med, jawPeriod)
  const teethS = smma(med, teethPeriod)
  const lipsS = smma(med, lipsPeriod)
  const jaw = fillNull(n), teeth = fillNull(n), lips = fillNull(n)
  for (let i = 0; i < n; i++) {
    if (i >= jawOffset && jawS[i - jawOffset] != null) jaw[i] = jawS[i - jawOffset]
    if (i >= teethOffset && teethS[i - teethOffset] != null) teeth[i] = teethS[i - teethOffset]
    if (i >= lipsOffset && lipsS[i - lipsOffset] != null) lips[i] = lipsS[i - lipsOffset]
  }
  return { jaw, teeth, lips, med }
}

/** Alligator state at index i: bullish / bearish / sleeping, plus label. */
export function alligatorState(alligator, atr, i) {
  const { jaw, teeth, lips } = alligator
  const j = jaw[i], t = teeth[i], l = lips[i]
  if (j == null || t == null || l == null || atr == null || atr <= 0) {
    return { state: "unknown", label: "warm-up" }
  }
  const sep = Math.abs(l - j)
  const spread = Math.abs(l - t) + Math.abs(t - j) + Math.abs(l - j)
  const sepOk = sep > 0.5 * atr
  if (l > t && t > j) {
    return {
      state: sepOk ? "eating" : "awakening",
      label: sepOk ? "bullish — alligator eating" : "bullish — awakening",
      bull: 1
    }
  }
  if (l < t && t < j) {
    return {
      state: sepOk ? "eating" : "awakening",
      label: sepOk ? "bearish — alligator eating" : "bearish — awakening",
      bull: -1
    }
  }
  const tight = spread < 2 * atr
  return { state: tight ? "sleeping" : "tangled", label: "sleeping — range-bound", bull: 0 }
}

/**
 * Linear regression over the trailing `period` closes. Returns the fitted line,
 * a normalized slope (per-bar % of the mean price), the regression angle, R²,
 * and a 2-sigma channel.
 */
export function linearRegression(closes, period = 50) {
  const a = numArr(closes)
  const out = { slope: fillNull(a.length), angle: fillNull(a.length), r2: fillNull(a.length), fit: fillNull(a.length), upper: fillNull(a.length), lower: fillNull(a.length), slopePct: fillNull(a.length) }
  const n = Math.max(5, Math.round(period))
  for (let end = n; end <= a.length; end++) {
    const win = a.slice(end - n, end)
    if (win.some((v) => v == null)) continue
    const m = win.reduce((s, v) => s + v, 0) / n
    const xm = (n - 1) / 2
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (i - xm) * (win[i] - m)
      den += (i - xm) * (i - xm)
    }
    const slope = den > 0 ? num / den : 0
    const intercept = m - slope * xm
    let sse = 0, sst = 0
    for (let i = 0; i < n; i++) {
      const yHat = intercept + slope * i
      sse += (win[i] - yHat) * (win[i] - yHat)
      sst += (win[i] - m) * (win[i] - m)
    }
    const resStd = Math.sqrt(sse / Math.max(n - 2, 1))
    const idx = end - 1
    out.slope[idx] = slope
    out.slopePct[idx] = (slope / Math.max(m, EPS)) * 100
    out.angle[idx] = Math.atan(slope) * 180 / Math.PI
    out.r2[idx] = sst > 0 ? 1 - sse / sst : 0
    out.fit[idx] = intercept + slope * (n - 1)
    out.upper[idx] = out.fit[idx] + 2 * resStd
    out.lower[idx] = out.fit[idx] - 2 * resStd
  }
  return out
}

/**
 * Parabolic SAR (Wilder 0.02 / 0.2). Standard iterative algorithm on the
 * high/low series. Returns the SAR value, the current trend (+1 / -1), and
 * reversal flags.
 */
export function parabolicSAR(highs, lows, { afStart = 0.02, afStep = 0.02, afMax = 0.2 } = {}) {
  const h = numArr(highs)
  const l = numArr(lows)
  const n = h.length
  const sar = fillNull(n)
  const trend = fillNull(n)
  const reversal = fillNull(n)
  if (n < 2) return { sar, trend, reversal }
  let af = afStart
  let t = h[1] >= h[0] ? 1 : -1
  let ep = t === 1 ? h[0] : l[0]
  let curSar = t === 1 ? l[0] : h[0]
  for (let i = 1; i < n; i++) {
    if (h[i] == null || l[i] == null) continue
    const prevSar = curSar
    curSar = prevSar + af * (ep - prevSar)
    if (t === 1) {
      if (l[i] < curSar) {
        // reversal to downtrend
        t = -1
        curSar = ep
        ep = l[i]
        af = afStart
        reversal[i] = 1
      } else {
        if (h[i] > ep) {
          ep = h[i]
          af = Math.min(afMax, af + afStep)
        }
      }
      // SAR must not exceed the prior two lows
      if (i >= 2) curSar = Math.min(curSar, l[i - 1], l[i - 2])
    } else {
      if (h[i] > curSar) {
        t = 1
        curSar = ep
        ep = h[i]
        af = afStart
        reversal[i] = 1
      } else {
        if (l[i] < ep) {
          ep = l[i]
          af = Math.min(afMax, af + afStep)
        }
      }
      if (i >= 2) curSar = Math.max(curSar, h[i - 1], h[i - 2])
    }
    sar[i] = curSar
    trend[i] = t
  }
  return { sar, trend, reversal }
}

/**
 * Aroon up/down + oscillator over `period` bars.
 */
export function aroon(highs, lows, period = 25) {
  const h = numArr(highs)
  const l = numArr(lows)
  const n = h.length
  const up = fillNull(n), down = fillNull(n), osc = fillNull(n)
  const p = Math.max(5, Math.round(period))
  for (let i = p; i < n; i++) {
    const winH = h.slice(i - p, i + 1)
    const winL = l.slice(i - p, i + 1)
    const hiIdx = winH.reduce((bi, v, idx) => (v != null && (winH[bi] == null || v > winH[bi]) ? idx : bi), 0)
    const loIdx = winL.reduce((bi, v, idx) => (v != null && (winL[bi] == null || v < winL[bi]) ? idx : bi), 0)
    const sinceHigh = p - hiIdx
    const sinceLow = p - loIdx
    const u = ((p - sinceHigh) / p) * 100
    const d = ((p - sinceLow) / p) * 100
    up[i] = u
    down[i] = d
    osc[i] = u - d
  }
  return { up, down, osc }
}

/** Average Directional Index + +/-DI + ADXR (Wilder, period 14). */
export function adx(highs, lows, closes, period = 14) {
  const h = numArr(highs)
  const l = numArr(lows)
  const c = numArr(closes)
  const n = h.length
  const adxOut = fillNull(n), plusDI = fillNull(n), minusDI = fillNull(n), adxrOut = fillNull(n)
  const p = Math.max(5, Math.round(period))
  if (n < p + 2) return { adx: adxOut, plusDI, minusDI, adxr: adxrOut }

  const tr = fillNull(n), plusDM = fillNull(n), minusDM = fillNull(n), dx = fillNull(n)
  for (let i = 1; i < n; i++) {
    if (h[i] == null || l[i] == null || c[i] == null || h[i - 1] == null || l[i - 1] == null || c[i - 1] == null) continue
    const up = h[i] - h[i - 1]
    const dn = l[i - 1] - l[i]
    plusDM[i] = up > dn && up > 0 ? up : 0
    minusDM[i] = dn > up && dn > 0 ? dn : 0
    tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))
  }
  const trSm = smma(tr, p)
  const pdmSm = smma(plusDM, p)
  const mdmSm = smma(minusDM, p)
  for (let i = 0; i < n; i++) {
    if (trSm[i] == null || trSm[i] <= EPS) continue
    const pdi = (100 * (pdmSm[i] ?? 0)) / trSm[i]
    const mdi = (100 * (mdmSm[i] ?? 0)) / trSm[i]
    plusDI[i] = pdi
    minusDI[i] = mdi
    dx[i] = pdi + mdi > 0 ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0
  }
  const adxS = smma(dx, p)
  for (let i = 0; i < n; i++) {
    if (adxS[i] == null) continue
    adxOut[i] = adxS[i]
    if (i >= p && adxS[i - p] != null) adxrOut[i] = (adxS[i] + adxS[i - p]) / 2
  }
  return { adx: adxOut, plusDI, minusDI, adxr: adxrOut }
}

// ---------------------------------------------------------------------
// Momentum / oscillators
// ---------------------------------------------------------------------

/** Relative Strength Index (Wilder smoothing). */
export function rsi(closes, period = 14) {
  const c = numArr(closes)
  const n = c.length
  const out = fillNull(n)
  const p = Math.max(2, Math.round(period))
  let avgGain = null, avgLoss = null
  for (let i = 1; i < n; i++) {
    if (c[i] == null || c[i - 1] == null) continue
    const chg = c[i] - c[i - 1]
    const gain = Math.max(chg, 0)
    const loss = Math.max(-chg, 0)
    if (avgGain == null) {
      const seed = []
      for (let j = Math.max(1, i - p + 1); j <= i; j++) {
        const d = c[j] - c[j - 1]
        seed.push(d)
      }
      if (seed.length < p) continue
      avgGain = seed.reduce((s, d) => s + Math.max(d, 0), 0) / p
      avgLoss = seed.reduce((s, d) => s + Math.max(-d, 0), 0) / p
      out[i] = 100 - 100 / (1 + (avgLoss > 0 ? avgGain / avgLoss : Infinity))
      continue
    }
    avgGain = (avgGain * (p - 1) + gain) / p
    avgLoss = (avgLoss * (p - 1) + loss) / p
    out[i] = 100 - 100 / (1 + (avgLoss > 0 ? avgGain / avgLoss : Infinity))
  }
  return out
}

/** Stochastic RSI: Stoch applied to the RSI series. */
export function stochRSI(closes, { period = 14, smoothK = 3, smoothD = 3 } = {}) {
  const r = rsi(closes, period)
  const k = fillNull(r.length), d = fillNull(r.length), rsiVal = fillNull(r.length)
  const p = Math.max(5, Math.round(period))
  for (let i = p; i < r.length; i++) {
    if (r[i] == null) continue
    const win = r.slice(i - p + 1, i + 1).filter((v) => v != null)
    if (win.length < p) continue
    const hi = Math.max(...win)
    const lo = Math.min(...win)
    rsiVal[i] = r[i]
    k[i] = hi > lo ? ((r[i] - lo) / (hi - lo)) * 100 : 50
  }
  const kSm = sma(k, smoothK)
  const dSm = sma(kSm, smoothD)
  for (let i = 0; i < r.length; i++) {
    if (kSm[i] != null) k[i] = kSm[i]
    if (dSm[i] != null) d[i] = dSm[i]
  }
  return { k, d, rsi: rsiVal }
}

/** Full Stochastic oscillator (%K smoothed, %D = SMA of %K). */
export function stochastic(highs, lows, closes, { kPeriod = 14, kSmooth = 3, dPeriod = 3 } = {}) {
  const h = numArr(highs), l = numArr(lows), c = numArr(closes)
  const n = h.length
  const kRaw = fillNull(n), k = fillNull(n), d = fillNull(n)
  const kp = Math.max(2, Math.round(kPeriod))
  for (let i = kp - 1; i < n; i++) {
    if (c[i] == null) continue
    const winH = h.slice(i - kp + 1, i + 1)
    const winL = l.slice(i - kp + 1, i + 1)
    if (winH.some((v) => v == null) || winL.some((v) => v == null)) continue
    const hi = Math.max(...winH)
    const lo = Math.min(...winL)
    kRaw[i] = hi > lo ? ((c[i] - lo) / (hi - lo)) * 100 : 50
  }
  const kSm = sma(kRaw, kSmooth)
  const dSm = sma(kSm, dPeriod)
  for (let i = 0; i < n; i++) {
    if (kSm[i] != null) k[i] = kSm[i]
    if (dSm[i] != null) d[i] = dSm[i]
  }
  return { k, d, kRaw }
}

/** MACD (12/26/9): line, signal, histogram. */
export function macd(closes, { fast = 12, slow = 26, signal = 9 } = {}) {
  const c = numArr(closes)
  const n = c.length
  const line = fillNull(n), sig = fillNull(n), hist = fillNull(n)
  const f = ema(c, fast)
  const s = ema(c, slow)
  for (let i = 0; i < n; i++) {
    if (f[i] != null && s[i] != null) line[i] = f[i] - s[i]
  }
  const sigS = ema(line, signal)
  for (let i = 0; i < n; i++) {
    if (sigS[i] != null) {
      sig[i] = sigS[i]
      if (line[i] != null) hist[i] = line[i] - sig[i]
    }
  }
  return { line, signal: sig, hist }
}

/** Awesome Oscillator: SMA(median,5) − SMA(median,34). */
export function awesomeOscillator(highs, lows, { fast = 5, slow = 34 } = {}) {
  const h = numArr(highs), l = numArr(lows)
  const med = h.map((v, i) => (v != null && l[i] != null ? (v + l[i]) / 2 : null))
  const f = sma(med, fast)
  const s = sma(med, slow)
  const ao = med.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null))
  return { ao }
}

/** Momentum: close − close[period]. */
export function momentum(closes, period = 10) {
  const c = numArr(closes)
  const out = fillNull(c.length)
  const p = Math.max(2, Math.round(period))
  for (let i = p; i < c.length; i++) {
    if (c[i] != null && c[i - p] != null) out[i] = c[i] - c[i - p]
  }
  return out
}

/** Rate of change, %. */
export function roc(closes, period = 12) {
  const c = numArr(closes)
  const out = fillNull(c.length)
  const p = Math.max(2, Math.round(period))
  for (let i = p; i < c.length; i++) {
    if (c[i] != null && c[i - p] != null && Math.abs(c[i - p]) > EPS) out[i] = ((c[i] - c[i - p]) / c[i - p]) * 100
  }
  return out
}

/** Commodity Channel Index. */
export function cci(highs, lows, closes, period = 20) {
  const h = numArr(highs), l = numArr(lows), c = numArr(closes)
  const n = h.length
  const out = fillNull(n)
  const p = Math.max(5, Math.round(period))
  const tp = h.map((v, i) => (v != null && l[i] != null && c[i] != null ? (v + l[i] + c[i]) / 3 : null))
  const tpSma = sma(tp, p)
  for (let i = p - 1; i < n; i++) {
    if (tpSma[i] == null) continue
    const win = tp.slice(i - p + 1, i + 1)
    if (win.some((v) => v == null)) continue
    const md = win.reduce((s, v) => s + Math.abs(v - tpSma[i]), 0) / p
    out[i] = md > EPS ? (tp[i] - tpSma[i]) / (0.015 * md) : 0
  }
  return out
}

/** Chande Momentum Oscillator. */
export function cmo(closes, period = 14) {
  const c = numArr(closes)
  const n = c.length
  const out = fillNull(n)
  const p = Math.max(2, Math.round(period))
  for (let i = p; i < n; i++) {
    const seed = []
    for (let j = i - p + 1; j <= i; j++) {
      if (c[j] == null || c[j - 1] == null) continue
      seed.push(c[j] - c[j - 1])
    }
    if (seed.length < p) continue
    const gains = seed.reduce((s, d) => s + (d > 0 ? d : 0), 0)
    const losses = seed.reduce((s, d) => s + (d < 0 ? -d : 0), 0)
    out[i] = gains + losses > 0 ? (100 * (gains - losses)) / (gains + losses) : 0
  }
  return out
}

/** Williams %R. */
export function williamsR(highs, lows, closes, period = 14) {
  const h = numArr(highs), l = numArr(lows), c = numArr(closes)
  const n = h.length
  const out = fillNull(n)
  const p = Math.max(2, Math.round(period))
  for (let i = p - 1; i < n; i++) {
    if (c[i] == null) continue
    const winH = h.slice(i - p + 1, i + 1)
    const winL = l.slice(i - p + 1, i + 1)
    if (winH.some((v) => v == null) || winL.some((v) => v == null)) continue
    const hi = Math.max(...winH)
    const lo = Math.min(...winL)
    out[i] = hi > lo ? (-100 * (hi - c[i])) / (hi - lo) : 0
  }
  return out
}

/** Absolute Price Oscillator: EMA(fast) − EMA(slow). */
export function apo(closes, { fast = 10, slow = 20 } = {}) {
  const c = numArr(closes)
  const f = ema(c, fast)
  const s = ema(c, slow)
  return c.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null))
}

// ---------------------------------------------------------------------
// Volatility / volume
// ---------------------------------------------------------------------

/** True range series. */
export function trueRange(highs, lows, closes) {
  const h = numArr(highs), l = numArr(lows), c = numArr(closes)
  const n = h.length
  const out = fillNull(n)
  for (let i = 0; i < n; i++) {
    if (h[i] == null || l[i] == null) continue
    if (i === 0 || c[i - 1] == null) out[i] = h[i] - l[i]
    else out[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))
  }
  return out
}

/** Average True Range (Wilder). */
export function atr(highs, lows, closes, period = 14) {
  return smma(trueRange(highs, lows, closes), period)
}

/** Normalized ATR: ATR / close * 100. */
export function natr(highs, lows, closes, period = 14) {
  const c = numArr(closes)
  const a = atr(highs, lows, closes, period)
  return c.map((v, i) => (a[i] != null && v != null && v > 0 ? (a[i] / v) * 100 : null))
}

/** Bollinger Bands (population std), with bandwidth and %B. */
export function bollinger(closes, { period = 20, mult = 2 } = {}) {
  const c = numArr(closes)
  const n = c.length
  const mid = fillNull(n), upper = fillNull(n), lower = fillNull(n), bandwidth = fillNull(n), percentB = fillNull(n)
  const p = Math.max(2, Math.round(period))
  for (let i = p - 1; i < n; i++) {
    const win = c.slice(i - p + 1, i + 1)
    if (win.some((v) => v == null)) continue
    const m = win.reduce((s, v) => s + v, 0) / p
    const sd = std(win, m)
    const up = m + mult * sd
    const lo = m - mult * sd
    mid[i] = m
    upper[i] = up
    lower[i] = lo
    bandwidth[i] = m > 0 ? ((up - lo) / m) * 100 : 0
    percentB[i] = up > lo ? (c[i] - lo) / (up - lo) : 0.5
  }
  return { upper, mid, lower, bandwidth, percentB }
}

/** Average price: (high+low+close)/3 (or /4 with open). */
export function averagePrice(highs, lows, closes, opens = []) {
  const h = numArr(highs), l = numArr(lows), c = numArr(closes), o = numArr(opens)
  return c.map((v, i) => {
    if (v == null) return null
    if (o[i] != null && o[i] > 0) return (h[i] + l[i] + c[i] + o[i]) / 4
    return (h[i] + l[i] + c[i]) / 3
  })
}

/** Anchored (cumulative) VWAP — resets at each null/candle-boundary gap > 5× median. */
export function vwap(highs, lows, closes, volumes) {
  const h = numArr(highs), l = numArr(lows), c = numArr(closes), v = numArr(volumes)
  const n = c.length
  const out = fillNull(n)
  let cumPV = 0, cumV = 0
  for (let i = 0; i < n; i++) {
    if (c[i] == null) continue
    const tp = (h[i] ?? c[i]) + (l[i] ?? c[i]) + c[i]
    const vol = v[i] > 0 ? v[i] : 1
    cumPV += (tp / 3) * vol
    cumV += vol
    out[i] = cumV > 0 ? cumPV / cumV : null
  }
  return out
}

// ---------------------------------------------------------------------
// Structure: fractals, swings, support/resistance
// ---------------------------------------------------------------------

/** Bill Williams fractals (2-bar confirmation on each side). */
export function fractals(highs, lows, { lookback = 2 } = {}) {
  const h = numArr(highs), l = numArr(lows)
  const n = h.length
  const up = Array(n).fill(false), down = Array(n).fill(false)
  const lb = Math.max(1, Math.round(lookback))
  for (let i = lb; i < n - lb; i++) {
    if (h[i] == null) continue
    let isUp = true, isDown = true
    for (let k = 1; k <= lb; k++) {
      if (h[i - k] == null || h[i + k] == null) { isUp = isDown = false; break }
      if (h[i] <= h[i - k] || h[i] <= h[i + k]) isUp = false
      if (l[i] >= l[i - k] || l[i] >= l[i + k]) isDown = false
    }
    if (isUp) up[i] = true
    if (isDown) down[i] = true
  }
  return { up, down }
}

/** Confirmed pivot highs/lows (center of a 2k+1 window). Returns index arrays. */
export function swingPoints(highs, lows, { lookback = 2 } = {}) {
  const h = numArr(highs), l = numArr(lows)
  const n = h.length
  const lb = Math.max(1, Math.round(lookback))
  const highsIdx = [], lowsIdx = []
  for (let i = lb; i < n - lb; i++) {
    if (h[i] == null || l[i] == null) continue
    let isHigh = true, isLow = true
    for (let k = 1; k <= lb; k++) {
      if (h[i] <= h[i - k] || h[i] <= h[i + k]) isHigh = false
      if (l[i] >= l[i - k] || l[i] >= l[i + k]) isLow = false
    }
    if (isHigh) highsIdx.push(i)
    if (isLow) lowsIdx.push(i)
  }
  return {
    highs: highsIdx.map((i) => ({ index: i, price: h[i] })),
    lows: lowsIdx.map((i) => ({ index: i, price: l[i] }))
  }
}

/**
 * Support/resistance levels by clustering swing points within a tolerance
 * (default 0.5×ATR). Returns the most recent, most-touched levels.
 */
export function supportResistance(candles, { lookback = 2, maxLevels = 6 } = {}) {
  const { highs, lows, closes } = candleArrays(candles)
  const a = atr(highs, lows, closes, 14)
  const lastAtr = a[a.length - 1] || Math.max(...highs.slice(-20)) * 0.01 || 1
  const tol = lastAtr * 0.5
  const { highs: pivH, lows: pivL } = swingPoints(highs, lows, { lookback })

  const cluster = (points, kind) => {
    const groups = []
    for (const p of points) {
      const near = groups.find((g) => Math.abs(g.level - p.price) <= tol)
      if (near) {
        near.touches += 1
        near.last = Math.max(near.last, p.index)
      } else {
        groups.push({ level: p.price, kind, touches: 1, last: p.index, index: p.index })
      }
    }
    return groups.sort((a, b) => b.touches - a.touches || b.last - a.last).slice(0, maxLevels)
  }
  const levels = [...cluster(pivH, "resistance"), ...cluster(pivL, "support")]
  return levels
    .sort((a, b) => b.last - a.last || b.touches - a.touches)
    .slice(0, maxLevels)
    .map((x) => ({ ...x, level: Math.round(x.level * 1e6) / 1e6 }))
}

// ---------------------------------------------------------------------
// Divergence detection (pivot based, regular + hidden)
// ---------------------------------------------------------------------

/**
 * Detect divergences between a price series and an oscillator. Uses confirmed
 * pivots (center of a 2k+1 window) and compares consecutive same-kind pivots
 * separated by at least `minDistance` bars. Returns the most recent findings.
 */
export function findDivergences(price, osc, { lookback = 3, minDistance = 6, maxResults = 4 } = {}) {
  const p = numArr(price), o = numArr(osc)
  const n = Math.min(p.length, o.length)
  const lb = Math.max(2, Math.round(lookback))
  const minD = Math.max(2, Math.round(minDistance))
  const pivH = [], pivL = []
  for (let i = lb; i < n - lb; i++) {
    if (p[i] == null || o[i] == null) continue
    let isH = true, isL = true
    for (let k = 1; k <= lb; k++) {
      if (p[i] <= p[i - k] || p[i] <= p[i + k]) isH = false
      if (p[i] >= p[i - k] || p[i] >= p[i + k]) isL = false
    }
    if (isH) pivH.push({ i, price: p[i], osc: o[i] })
    if (isL) pivL.push({ i, price: p[i], osc: o[i] })
  }
  const divergences = []
  for (let x = 1; x < pivH.length; x++) {
    const a = pivH[x - 1], b = pivH[x]
    if (b.i - a.i < minD) continue
    if (b.price > a.price && b.osc < a.osc) {
      divergences.push({ type: "regular_bearish", kind: "bearish", bar: b.i, price: b.price, osc: b.osc, prevBar: a.i })
    } else if (b.price < a.price && b.osc > a.osc) {
      divergences.push({ type: "hidden_bullish", kind: "bullish", bar: b.i, price: b.price, osc: b.osc, prevBar: a.i })
    }
  }
  for (let x = 1; x < pivL.length; x++) {
    const a = pivL[x - 1], b = pivL[x]
    if (b.i - a.i < minD) continue
    if (b.price < a.price && b.osc > a.osc) {
      divergences.push({ type: "regular_bullish", kind: "bullish", bar: b.i, price: b.price, osc: b.osc, prevBar: a.i })
    } else if (b.price > a.price && b.osc < a.osc) {
      divergences.push({ type: "hidden_bearish", kind: "bearish", bar: b.i, price: b.price, osc: b.osc, prevBar: a.i })
    }
  }
  divergences.sort((a, b) => b.bar - a.bar)
  return divergences.slice(0, maxResults)
}

// ---------------------------------------------------------------------
// Regime statistics
// ---------------------------------------------------------------------

/** Lag-1 autocorrelation of returns — a cheap Hurst proxy (persistence). */
export function returnAutocorrelation(closes, { maxLag = 1, window = 100 } = {}) {
  const c = numArr(closes).slice(-window)
  const rets = []
  for (let i = 1; i < c.length; i++) {
    if (c[i] != null && c[i - 1] != null && Math.abs(c[i - 1]) > EPS) rets.push(Math.log(c[i] / c[i - 1]))
  }
  if (rets.length < 20) return 0
  const m = mean(rets)
  let num = 0, den = 0
  for (let i = 1; i < rets.length; i++) {
    num += (rets[i] - m) * (rets[i - 1] - m)
  }
  for (const r of rets) den += (r - m) * (r - m)
  return den > 0 ? num / den : 0
}

// ---------------------------------------------------------------------
// Full dashboard
// ---------------------------------------------------------------------

/**
 * Compute the entire indicator suite over a candle array and return a flat
 * snapshot of the latest values plus a few derived readings. `closes`-only
 * input is normalized first.
 */
export function computeIndicatorDashboard(candles) {
  const { opens, highs, lows, closes, volumes, times } = candleArrays(candles)
  const last = closes.length - 1

  const a = atr(highs, lows, closes, 14)
  const r = rsi(closes, 14)
  const r7 = rsi(closes, 7)
  const stoch = stochastic(highs, lows, closes)
  const sRSI = stochRSI(closes)
  const m = macd(closes)
  const ao = awesomeOscillator(highs, lows)
  const b = bollinger(closes)
  const cci20 = cci(highs, lows, closes, 20)
  const cci50 = cci(highs, lows, closes, 50)
  const adx14 = adx(highs, lows, closes, 14)
  const alli = alligator(highs, lows)
  const psar = parabolicSAR(highs, lows)
  const lr = linearRegression(closes, 50)
  const aroon25 = aroon(highs, lows, 25)
  const wr = williamsR(highs, lows, closes, 14)
  const cmo14 = cmo(closes, 14)
  const roc12 = roc(closes, 12)
  const mom10 = momentum(closes, 10)
  const ap = apo(closes)
  const natr14 = natr(highs, lows, closes, 14)
  const avgP = averagePrice(highs, lows, closes, opens)
  const vw = vwap(highs, lows, closes, volumes)
  const fr = fractals(highs, lows)
  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  const ema200 = ema(closes, 200)

  const g = (arr, i = last) => (arr && isNum(arr[i]) ? arr[i] : null)
  const close = g(closes)
  const atrNow = g(a)

  const rsiNow = g(r)
  const bNow = {
    upper: g(b.upper), mid: g(b.mid), lower: g(b.lower),
    bandwidth: g(b.bandwidth), percentB: g(b.percentB)
  }
  const bwPrev = g(b.bandwidth, last - 5)
  const mNow = { line: g(m.line), signal: g(m.signal), hist: g(m.hist) }
  const mPrev = { hist: g(m.hist, last - 1) }
  const stochNow = { k: g(stoch.k), d: g(stoch.d) }
  const stochPrev = { k: g(stoch.k, last - 1), d: g(stoch.d, last - 1) }
  const sRsiNow = { k: g(sRSI.k), d: g(sRSI.d) }
  const adxNow = { adx: g(adx14.adx), plusDI: g(adx14.plusDI), minusDI: g(adx14.minusDI), adxr: g(adx14.adxr) }
  const aroonNow = { up: g(aroon25.up), down: g(aroon25.down), osc: g(aroon25.osc) }
  const alliState = alligatorState(alli, atrNow, last)

  const aroonRead = aroonNow.osc != null
    ? aroonNow.osc > 50 ? "strong up" : aroonNow.osc < -50 ? "strong down" : "neutral"
    : "n/a"

  const macdCross = mNow.line != null && mPrev.hist != null && mNow.signal != null
    ? (mPrev.hist <= 0 && mNow.hist > 0 ? "bullish" : mPrev.hist >= 0 && mNow.hist < 0 ? "bearish" : mNow.hist > 0 ? "positive" : mNow.hist < 0 ? "negative" : "flat")
    : "n/a"
  const macdZero = mNow.line != null ? (mNow.line > 0 ? "above" : mNow.line < 0 ? "below" : "at") : "n/a"

  const stochCross = stochNow.k != null && stochPrev.k != null && stochNow.d != null
    ? (stochPrev.k <= stochPrev.d && stochNow.k > stochNow.d ? "bullish" : stochPrev.k >= stochPrev.d && stochNow.k < stochNow.d ? "bearish" : "none")
    : "n/a"

  const psarTrend = g(psar.trend)
  const psarRead = psarTrend == null ? "n/a" : psarTrend === 1 ? "bullish" : "bearish"

  const lrNow = { slope: g(lr.slope), slopePct: g(lr.slopePct), r2: g(lr.r2), angle: g(lr.angle), fit: g(lr.fit), upper: g(lr.upper), lower: g(lr.lower) }
  const ema20Now = g(ema20), ema50Now = g(ema50), ema200Now = g(ema200)
  const emaRead = close != null && ema20Now != null && ema50Now != null && ema200Now != null
    ? (close > ema200Now && ema20Now > ema50Now ? "bullish alignment" : close < ema200Now && ema20Now < ema50Now ? "bearish alignment" : "mixed")
    : "n/a"

  return {
    bars: closes.length,
    lastBarIndex: last,
    last: close,
    candles,
    atr: { value: atrNow, series: a },
    natr: natr14[last],
    averagePrice: g(avgP),
    vwap: g(vw),
    ema: { ema20: ema20Now, ema50: ema50Now, ema200: ema200Now, read: emaRead },
    alligator: { ...alliState, jaw: g(alli.jaw), teeth: g(alli.teeth), lips: g(alli.lips) },
    fractalUp: fr.up[last] === true,
    fractalDown: fr.down[last] === true,
    psar: { trend: psarRead, value: g(psar.sar), reversed: psar.reversal[last] === 1 },
    linearRegression: lrNow,
    aroon: { ...aroonNow, read: aroonRead },
    adx: { ...adxNow, read: adxNow.adx == null ? "n/a" : adxNow.adx > 25 ? "trending" : adxNow.adx < 20 ? "ranging" : "transitional" },
    rsi: { value: rsiNow, read: rsiNow == null ? "n/a" : rsiNow >= 70 ? "overbought" : rsiNow <= 30 ? "oversold" : rsiNow > 50 ? "bullish" : rsiNow < 50 ? "bearish" : "neutral" },
    rsi7: g(r7),
    stochRSI: { ...sRsiNow, read: sRsiNow.k == null ? "n/a" : sRsiNow.k >= 80 ? "overbought" : sRsiNow.k <= 20 ? "oversold" : sRsiNow.k > 50 ? "bullish" : "bearish" },
    stochastic: { ...stochNow, cross: stochCross, read: stochNow.k == null ? "n/a" : stochNow.k >= 80 ? "overbought" : stochNow.k <= 20 ? "oversold" : "neutral" },
    macd: { ...mNow, cross: macdCross, zero: macdZero },
    awesome: { value: g(ao.ao), read: ao.ao[last] == null ? "n/a" : ao.ao[last] > 0 ? "bullish" : "bearish" },
    momentum: g(mom10),
    roc: g(roc12),
    cci: { value20: g(cci20), value50: g(cci50), read: g(cci20) == null ? "n/a" : g(cci20) > 100 ? "overbought" : g(cci20) < -100 ? "oversold" : g(cci20) > 0 ? "bullish" : "bearish" },
    williamsR: g(wr),
    cmo: g(cmo14),
    apo: g(ap),
    bollinger: { ...bNow, bandwidthSeries: b.bandwidth, bbUpperSeries: b.upper, bbLowerSeries: b.lower },
    supportResistance: supportResistance(candles),
    autocorrelation: returnAutocorrelation(closes),
    chartSeries: {
      closes: closes.slice(-200),
      highs: highs.slice(-200),
      lows: lows.slice(-200),
      volumes: volumes.slice(-200),
      ema20: ema20.slice(-200),
      ema50: ema50.slice(-200),
      ema200: ema200.slice(-200),
      bbUpper: b.upper.slice(-200),
      bbMid: b.mid.slice(-200),
      bbLower: b.lower.slice(-200),
      sar: psar.sar.slice(-200),
      jaw: alli.jaw.slice(-200),
      teeth: alli.teeth.slice(-200),
      lips: alli.lips.slice(-200),
      vwap: vw.slice(-200)
    }
  }
}

// ---------------------------------------------------------------------
// Market phase detection
// ---------------------------------------------------------------------

/**
 * Classify the current market phase from the indicator dashboard. Uses ADX,
 * Bollinger bandwidth percentile, ATR percentile, linear-regression R²/slope,
 * the Alligator state, and the return autocorrelation (persistence proxy).
 */
export function detectMarketPhase(dash) {
  const adxVal = dash.adx.adx
  const bw = dash.bollinger.bandwidth
  const bwSeries = dash.bollinger.bandwidthSeries
  const natrVal = dash.natr
  const r2 = dash.linearRegression.r2
  const slopePct = dash.linearRegression.slopePct
  const atrVal = dash.atr.value
  const autocorr = dash.autocorrelation

  const histLen = Math.max(30, dash.bars)
  const bwNow = bw
  let bwPctile = 0.5
  if (bwSeries && Array.isArray(bwSeries)) {
    const bwWins = bwSeries.filter((v) => v != null).slice(-histLen)
    if (bwWins.length > 10) {
      const below = bwWins.filter((v) => v <= bwNow).length
      bwPctile = below / bwWins.length
    }
  }
  const natrWins = dash.atr && dash.atr.series ? dash.atr.series.filter((v) => v != null).slice(-histLen) : []
  let atrPctile = 0.5
  if (natrWins.length > 10) {
    const below = natrWins.filter((v) => v <= atrVal).length
    atrPctile = below / natrWins.length
  }

  const strongTrend = adxVal != null && adxVal > 25
  const weakTrend = adxVal != null && adxVal < 20
  const highVol = atrPctile > 0.7 || (natrVal != null && natrVal > 4)
  const lowVol = atrPctile < 0.3
  const squeeze = bwPctile < 0.2
  const expanding = bwPctile > 0.8
  const cleanTrend = r2 != null && Math.abs(r2) >= 0.6
  const persistent = autocorr > 0.05
  const meanReverting = autocorr < -0.05

  let direction = "sideways"
  if (slopePct != null && Math.abs(slopePct) >= 0.05) direction = slopePct > 0 ? "up" : "down"

  let trendLabel = "ranging"
  if (strongTrend) trendLabel = "trending"
  else if (weakTrend) trendLabel = "ranging"

  let phase, label, quadrant
  if (squeeze && !expanding) {
    phase = "compression"
    label = "Volatility compression (squeeze) — breakout pending"
    quadrant = "pre-breakout"
  } else if (strongTrend && highVol) {
    phase = "volatile_trend"
    label = `Volatile ${direction} trend — trade with trend, wider stops`
    quadrant = "volatile_trend"
  } else if (strongTrend) {
    phase = "trend"
    label = `Clean ${direction} trend — trend-following regime`
    quadrant = "quiet_trend"
  } else if (!strongTrend && highVol) {
    phase = "volatile_range"
    label = "Choppy high-volatility range — reduce size or stand aside"
    quadrant = "volatile_range"
  } else if (trendLabel === "ranging" && lowVol) {
    phase = "quiet_range"
    label = "Quiet range — mean-reversion regime"
    quadrant = "quiet_range"
  } else {
    phase = "transition"
    label = "Transitional — no dominant regime, be selective"
    quadrant = "transitional"
  }

  const strategy = {
    compression: "Anticipate breakout: place orders beyond the range edges with ATR-scaled stops.",
    trend: "Trade with the trend: pullbacks to the Teeth/EMA20 or trend-continuation breakouts.",
    volatile_trend: "Trade with the trend at reduced size (≈50%) and wider (2.5–3×ATR) stops.",
    quiet_range: "Mean-revert at the Bollinger extremes; fade into range edges.",
    volatile_range: "Stand aside or trade tiny size — both trend and reversal logic whipsaw here.",
    transition: "Wait for confirmation; only take high-confluence signals.",
  }

  return {
    phase,
    label,
    quadrant,
    trend: direction,
    trendStrength: adxVal,
    trendStrengthLabel: adxVal == null ? "n/a" : adxVal > 40 ? "very strong" : adxVal > 25 ? "strong" : adxVal > 20 ? "weak" : "none",
    volatility: atrPctile > 0.7 ? "high" : atrPctile < 0.3 ? "low" : "normal",
    volatilityPercentile: Math.round(atrPctile * 100),
    bandwidthPercentile: Math.round(bwPctile * 100),
    squeeze,
    expanding,
    regressionR2: r2,
    persistence: autocorr,
    persistenceLabel: persistent ? "trending (persistent)" : meanReverting ? "mean-reverting" : "random walk",
    alligator: dash.alligator.state,
    strategy
  }
}

