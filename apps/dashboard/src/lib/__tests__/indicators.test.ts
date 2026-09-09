import { describe, expect, it } from "vitest"
import { sma, ema, bollinger, rsi, macd, std, choppinessIndex, trueStrengthIndex, deMarker, fisherTransform, coppockCurve, nicheIndicators, type OverlayCandle } from "../indicators"

// Boundary fixtures mirror the U4FA factor-boundary test style: constructed
// inputs pin warm-up, flat-series, and empty-input behavior so the chart
// overlays can never crash or emit garbage.

function candles(closes: number[], time0 = 1_700_000_000, step = 300): OverlayCandle[] {
  return closes.map((c, i) => ({ time: time0 + i * step, open: c, high: c, low: c, close: c }))
}

const ups = Array.from({ length: 60 }, (_, i) => 100 + i) // monotonic rise
const flats = Array.from({ length: 60 }, () => 100) // perfectly flat
const saw = Array.from({ length: 80 }, (_, i) => 100 + (i % 2 === 0 ? 10 : -10)) // alternating

describe("sma", () => {
  it("emits no points on empty or warm-up-only input", () => {
    expect(sma([], 20)).toHaveLength(0)
    expect(sma(candles(Array(19).fill(50)), 20)).toHaveLength(0)
  })

  it("first point lands on the 20th bar and equals the 20-bar mean", () => {
    const out = sma(candles(Array.from({ length: 30 }, (_, i) => i + 1)), 20)
    expect(out).toHaveLength(11)
    expect(out[0].value).toBeCloseTo(10.5) // mean of 1..20
    expect(out[0].time).toBe(1_700_000_000 + 19 * 300)
  })

  it("constant closes produce a constant line", () => {
    const out = sma(candles(flats), 20)
    expect(out.every((p) => p.value === 100)).toBe(true)
  })
})

describe("ema", () => {
  it("empty input yields no points", () => {
    expect(ema([], 20)).toHaveLength(0)
  })

  it("converges on the flat series immediately", () => {
    const out = ema(candles(flats), 20)
    expect(out.every((p) => p.value === 100)).toBe(true)
  })

  it("rises with the trend and lags it (value strictly below the last close)", () => {
    const out = ema(candles(ups), 20)
    const last = out[out.length - 1]
    expect(last.value).toBeGreaterThan(100)
    expect(last.value).toBeLessThan(ups[ups.length - 1])
  })
})

describe("std", () => {
  it("is zero for flat and singleton input, positive for variance", () => {
    expect(std([])).toBe(0)
    expect(std([5])).toBe(0)
    expect(std([1, 1, 1])).toBe(0)
    expect(std([1, 3])).toBeCloseTo(1)
  })
})

describe("bollinger", () => {
  it("empty input yields no bands", () => {
    const b = bollinger(candles(Array(19).fill(50)))
    expect(b.upper).toHaveLength(0)
    expect(b.mid).toHaveLength(0)
    expect(b.lower).toHaveLength(0)
  })

  it("flat closes collapse the band width to zero", () => {
    const b = bollinger(candles(flats), { period: 20 })
    expect(b.upper.length).toBeGreaterThan(0)
    for (const i of [0, b.upper.length - 1]) {
      expect(b.upper[i].value).toBe(100)
      expect(b.mid[i].value).toBe(100)
      expect(b.lower[i].value).toBe(100)
    }
  })

  it("mid equals the SMA and bands bracket the mean ± 2σ", () => {
    const b = bollinger(candles(saw), { period: 20 })
    const m = sma(candles(saw), 20)
    expect(b.mid).toEqual(m)
    for (let i = 0; i < b.mid.length; i++) {
      expect(b.upper[i].value).toBeGreaterThanOrEqual(b.mid[i].value)
      expect(b.lower[i].value).toBeLessThanOrEqual(b.mid[i].value)
    }
  })
})

describe("rsi", () => {
  it("empty and warm-up input yield no points", () => {
    expect(rsi([], 14)).toHaveLength(0)
    expect(rsi(candles(Array(14).fill(100)), 14)).toHaveLength(0) // needs 15 closes
  })

  it("a monotonic rise reads 100 (all gains, zero losses)", () => {
    const out = rsi(candles(ups), 14)
    expect(out.length).toBeGreaterThan(0)
    expect(out[out.length - 1].value).toBe(100)
  })

  it("a monotonic fall reads 0 (all losses)", () => {
    const out = rsi(candles(ups.map((v) => 200 - v)), 14)
    expect(out[out.length - 1].value).toBe(0)
  })

  it("a flat series reads 100, matching the server's Infinity-branch rule", () => {
    const out = rsi(candles(flats), 14)
    expect(out.length).toBeGreaterThan(0)
    expect(out[out.length - 1].value).toBe(100)
  })

  it("alternating closes sit near the 50 midline", () => {
    const out = rsi(candles(saw), 14)
    const v = out[out.length - 1].value
    expect(v).toBeGreaterThan(40)
    expect(v).toBeLessThan(60)
  })
})

describe("macd", () => {
  it("empty input yields no series", () => {
    const m = macd([])
    expect(m.line).toHaveLength(0)
    expect(m.signal).toHaveLength(0)
    expect(m.hist).toHaveLength(0)
  })

  it("warm-up is honest: no line before the slow EMA (26 bars) exists", () => {
    const m = macd(candles(Array(25).fill(100)), { slow: 26 })
    expect(m.line).toHaveLength(0)
    const m2 = macd(candles(Array(60).fill(100)), { slow: 26 })
    expect(m2.line.length).toBeGreaterThan(0)
  })

  it("flat closes produce a zero line, signal, and histogram", () => {
    const m = macd(candles(flats))
    expect(m.line.length).toBeGreaterThan(0)
    for (const p of [...m.line, ...m.signal, ...m.hist]) expect(p.value).toBeCloseTo(0)
  })

  it("an accelerating rise yields a positive line and the signal lags it", () => {
    const m = macd(candles(ups.map((_, i) => 100 + i * i)))
    expect(m.line.length).toBeGreaterThan(0)
    for (const p of m.line) expect(p.value).toBeGreaterThan(0)
    expect(m.signal[m.signal.length - 1].value).toBeLessThan(m.line[m.line.length - 1].value)
  })
})

// --- Niche indicators (in-house) ---

const spread: OverlayCandle[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1_700_000_000 + i * 300,
  open: 100 + i % 10,
  high: 100 + i % 10 + 2,
  low: 100 + i % 10 - 2,
  close: 100 + i % 10
}))

const downs = Array.from({ length: 60 }, (_, i) => 200 - i)

describe("niche indicators", () => {
  it("nicheIndicators([]) returns null", () => {
    expect(nicheIndicators([])).toBeNull()
  })

  it("nicheIndicators on flat series returns all five with finite values", () => {
    const r = nicheIndicators(candles(flats))
    expect(r).not.toBeNull()
    expect(r!.choppiness.length).toBeGreaterThan(0)
    expect(r!.tsi.length).toBeGreaterThan(0)
    expect(r!.deMarker.length).toBeGreaterThan(0)
    expect(r!.fisher.fisher.length).toBeGreaterThan(0)
    expect(r!.fisher.signal.length).toBeGreaterThan(0)
    expect(r!.coppock.length).toBeGreaterThan(0)
    const all = [...r!.choppiness, ...r!.tsi, ...r!.deMarker, ...r!.fisher.fisher, ...r!.fisher.signal, ...r!.coppock]
    expect(all.every((p) => Number.isFinite(p.value))).toBe(true)
  })

  it("choppiness on flat series (equal H/L) = 50 (honest fallback)", () => {
    const out = choppinessIndex(candles(flats))
    expect(out.length).toBeGreaterThan(0)
    expect(out[out.length - 1].value).toBe(50)
  })

  it("choppiness on spread series stays in [0, 100]", () => {
    const out = choppinessIndex(spread)
    expect(out.length).toBeGreaterThan(0)
    for (const p of out) {
      expect(p.value).toBeGreaterThanOrEqual(0)
      expect(p.value).toBeLessThanOrEqual(100)
    }
  })

  it("TSI: alternating (saw) → near 0; monotonic rise → > 25", () => {
    const sawTsi = trueStrengthIndex(candles(saw))
    expect(sawTsi.length).toBeGreaterThan(0)
    expect(Math.abs(sawTsi[sawTsi.length - 1].value)).toBeLessThan(30)
    const upTsi = trueStrengthIndex(candles(ups))
    expect(upTsi.length).toBeGreaterThan(0)
    expect(upTsi[upTsi.length - 1].value).toBeGreaterThan(25)
  })

  it("deMarker: monotonic rise → > 50; monotonic fall → < 50", () => {
    const upDe = deMarker(candles(ups))
    expect(upDe.length).toBeGreaterThan(0)
    expect(upDe[upDe.length - 1].value).toBeGreaterThan(50)
    const downDe = deMarker(candles(downs))
    expect(downDe.length).toBeGreaterThan(0)
    expect(downDe[downDe.length - 1].value).toBeLessThan(50)
  })

  it("fisherTransform: returns both arrays with equal length; rising (unsaturated) series → fisher > signal", () => {
    // 20-bar linear rise — long enough to warm up but short enough that the
    // atanh transform has not yet saturated at its ~3.8 asymptote, so the
    // signal still lags fisher on the last bar.
    const rise20 = Array.from({ length: 20 }, (_, i) => 100 + i)
    const out = fisherTransform(candles(rise20))
    expect(out.fisher.length).toBeGreaterThan(0)
    expect(out.signal.length).toBe(out.fisher.length - 1)
    expect(out.fisher[out.fisher.length - 1].value).toBeGreaterThan(out.signal[out.signal.length - 1].value)
  })

  it("fisherTransform crossover: append a sharp drop, verify Fisher crosses below signal", () => {
    const rising = Array.from({ length: 40 }, (_, i) => 100 + i)
    const drop = Array.from({ length: 15 }, (_, i) => 140 - i * 5)
    const combined = [...rising, ...drop]
    const out = fisherTransform(candles(combined))
    expect(out.fisher.length).toBeGreaterThan(0)
    expect(out.signal.length).toBeGreaterThan(0)
    const lastF = out.fisher[out.fisher.length - 1].value
    const lastS = out.signal[out.signal.length - 1].value
    expect(lastF).toBeLessThan(lastS)
  })

  it("coppockCurve: empty → []; warm-up (< 23 bars) → []; steady series → finite", () => {
    expect(coppockCurve([])).toHaveLength(0)
    expect(coppockCurve(candles(Array(23).fill(100)))).toHaveLength(0)
    const out = coppockCurve(candles(flats))
    expect(out.length).toBeGreaterThan(0)
    expect(Number.isFinite(out[out.length - 1].value)).toBe(true)
  })

  it("warm-up: each indicator emits 0 points when N < warm-up, > 0 when N sufficient", () => {
    const chopShort = choppinessIndex(candles(Array(14).fill(100)))
    const chopLong = choppinessIndex(candles(Array(16).fill(100)))
    expect(chopShort).toHaveLength(0)
    expect(chopLong.length).toBeGreaterThan(0)

    const tsiShort = trueStrengthIndex(candles(Array(30).fill(100)))
    const tsiLong = trueStrengthIndex(candles(Array(40).fill(100)))
    expect(tsiShort).toHaveLength(0)
    expect(tsiLong.length).toBeGreaterThan(0)

    const deShort = deMarker(candles(Array(14).fill(100)))
    const deLong = deMarker(candles(Array(16).fill(100)))
    expect(deShort).toHaveLength(0)
    expect(deLong.length).toBeGreaterThan(0)

    const fiShort = fisherTransform(candles(Array(8).fill(100)))
    const fiLong = fisherTransform(candles(Array(9).fill(100)))
    expect(fiShort.fisher).toHaveLength(0)
    expect(fiLong.fisher.length).toBeGreaterThan(0)

    const coShort = coppockCurve(candles(Array(23).fill(100)))
    const coLong = coppockCurve(candles(Array(24).fill(100)))
    expect(coShort).toHaveLength(0)
    expect(coLong.length).toBeGreaterThan(0)
  })

  it("non-finite guard: NaN candle does not crash; remaining valid bars produce output", () => {
    const withNaN = [...flats.slice(0, 30), NaN, ...flats.slice(31)]
    const c = withNaN.map((c, i) => ({
      time: 1_700_000_000 + i * 300, open: c, high: c, low: c, close: c
    })) as OverlayCandle[]
    const r = nicheIndicators(c)
    expect(r).not.toBeNull()
    expect(r!.choppiness.length).toBeGreaterThan(0)
    expect(r!.tsi.length).toBeGreaterThan(0)
    expect(r!.deMarker.length).toBeGreaterThan(0)
    expect(r!.fisher.fisher.length).toBeGreaterThan(0)
    expect(r!.coppock.length).toBeGreaterThan(0)
  })
})