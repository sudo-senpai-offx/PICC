import { describe, expect, it } from "vitest"
import { sma, ema, bollinger, rsi, macd, std, type OverlayCandle } from "../indicators"

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