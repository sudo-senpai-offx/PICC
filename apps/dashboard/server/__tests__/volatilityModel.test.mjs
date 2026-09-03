import { describe, expect, it } from "vitest"
import { computeAdaptiveStops } from "../services/trading.mjs"
import { garmanKlassVolatility, parkinsonVolatility, realizedVolatility, volatilitySnapshot, yangZhangVolatility } from "../services/volatility.mjs"
import { optimizeExpiry } from "../services/expiryOptimizer.mjs"

function flatRangeCandles(n, close, halfRange) {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 60000,
    open: close,
    high: close + halfRange,
    low: close - halfRange,
    close
  }))
}

function alternatingCandles(n, base, step) {
  return Array.from({ length: n }, (_, i) => {
    const close = i % 2 === 0 ? base : base + step
    return { time: i * 60000, open: close, high: close + 1, low: close - 1, close }
  })
}

function trendCandles(n) {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i
    return { time: i * 60000, open: close - 1, high: close + 0.6, low: close - 0.6, close }
  })
}

function logReturnCloses() {
  const a = 0.01
  const closes = [100]
  for (let i = 1; i <= 20; i++) {
    closes.push(closes[i - 1] * Math.exp(i % 2 === 1 ? a : -a))
  }
  return closes
}

describe("ATR computation (computeAdaptiveStops)", () => {
  it("derives ATR and stops from actual candle high/low/close ranges", () => {
    const narrow = computeAdaptiveStops(flatRangeCandles(30, 100, 1), "up")
    expect(narrow.atr).toBe(2)
    expect(narrow.takeProfit).toBe(103.6)
    expect(narrow.stopLoss).toBe(97)

    const wide = computeAdaptiveStops(flatRangeCandles(30, 100, 2), "up")
    expect(wide.atr).toBe(4)
    expect(wide.takeProfit).toBe(107.2)
    expect(wide.stopLoss).toBe(94)
  })

  it("reports no volatility for perfectly flat candles instead of fabricating stops", () => {
    const r = computeAdaptiveStops(flatRangeCandles(30, 100, 0), "up")
    expect(r.atr).toBeNull()
    expect(r.takeProfit).toBeNull()
    expect(r.stopLoss).toBeNull()
    expect(r.regime).toBe("unknown")
  })
})

describe("volatility annualization (realizedVolatility)", () => {
  const closes = logReturnCloses()
  const expectedDaily = 0.01 * Math.sqrt(20 / 19)

  it("annualizes daily-frequency data by sqrt(252)", () => {
    const rv = realizedVolatility(closes, { period: 20 })
    expect(rv.daily).toBeCloseTo(expectedDaily, 3)
    expect(rv.annual).toBeCloseTo(expectedDaily * Math.sqrt(252), 3)
  })

  it("annualizes crypto (365-day) data by sqrt(365)", () => {
    const rv = realizedVolatility(closes, { period: 20, annualize: 365 })
    expect(rv.annual).toBeCloseTo(expectedDaily * Math.sqrt(365), 3)
    expect(rv.annual).toBeGreaterThan(realizedVolatility(closes, { period: 20 }).annual)
  })

  it("infers the 252-period year from daily candle timestamps", () => {
    const fromTimes = realizedVolatility(closes, { period: 20, times: closes.map((_, i) => i * 86400000) })
    const explicit = realizedVolatility(closes, { period: 20, annualize: 252 })
    expect(fromTimes.annual).toBe(explicit.annual)
  })
})

describe("expiry optimizer uses computed volatility, not hardcoded defaults", () => {
  it("scores expiries from candle-derived volatility", () => {
    const candles = alternatingCandles(40, 100, 2)
    const rets = []
    for (let i = 1; i < candles.length; i++) {
      rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close)
    }
    const rms = Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length)
    const avgAbs = rets.reduce((s, r) => s + Math.abs(r), 0) / rets.length
    expect(rms).toBeGreaterThan(0.001)

    const wild = optimizeExpiry(candles, "volatile")
    const calm = optimizeExpiry(alternatingCandles(40, 100, 0), "volatile")

    expect(wild.volatility).toBe(Math.round(rms * 10000) / 100)
    expect(wild.avgMove).toBe(Math.round(avgAbs * 10000) / 100)
    expect(calm.volatility).toBe(0)
    expect(calm.avgMove).toBe(0)

    expect(wild.all.find((e) => e.seconds === 5).score).toBe(60)
    expect(calm.all.find((e) => e.seconds === 5).score).toBe(75)
    expect(wild.all.find((e) => e.seconds === 60).score).toBe(75)
    expect(wild.all.find((e) => e.seconds === 900).score).toBe(35)
  })

  it("derives expectedMove per expiry from measured candle movement", () => {
    const candles = alternatingCandles(40, 100, 2)
    const rets = []
    for (let i = 1; i < candles.length; i++) {
      rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close)
    }
    const avgAbs = rets.reduce((s, r) => s + Math.abs(r), 0) / rets.length
    const out = optimizeExpiry(candles, "volatile")
    expect(out.all.find((e) => e.seconds === 300).expectedMove).toBe(
      Math.round(avgAbs * Math.sqrt(300 / 60) * 10000) / 100
    )
    expect(out.all.find((e) => e.seconds === 60).expectedMove).toBe(
      Math.round(avgAbs * 10000) / 100
    )
  })

  it("steers the recommendation by regime derived from ATR analysis", () => {
    const candles = flatRangeCandles(60, 100, 1)
    const trending = optimizeExpiry(candles, "trending")
    const volatileRegime = optimizeExpiry(candles, "volatile")
    expect(trending.recommended.seconds).toBe(300)
    expect(volatileRegime.recommended.seconds).not.toBe(trending.recommended.seconds)
  })

  it("consumes the regime produced by the ATR-based stop calculator", () => {
    const stops = computeAdaptiveStops(trendCandles(60), "up")
    expect(stops.regime).toBe("trending")
    const optimized = optimizeExpiry(flatRangeCandles(60, 100, 1), stops.regime)
    expect(optimized.recommended.seconds).toBeGreaterThanOrEqual(300)
    expect(optimizeExpiry(flatRangeCandles(60, 100, 1), "ranging").recommended.seconds).toBeLessThan(
      optimized.recommended.seconds
    )
  })
})

describe("conservative defaults for insufficient data", () => {
  it("falls back to the neutral 1m expiry with flat scores under 20 candles", () => {
    for (const input of [null, [], flatRangeCandles(12, 100, 1)]) {
      const out = optimizeExpiry(input, "trending", 0.9)
      expect(out.recommended.seconds).toBe(60)
      expect(out.recommended.label).toBe("1m")
      expect(out.all.every((e) => e.score === 50)).toBe(true)
      expect(out.volatility).toBeUndefined()
    }
  })

  it("returns nulls instead of fabricated values for short series", () => {
    const stops = computeAdaptiveStops(flatRangeCandles(19, 100, 1), "up")
    expect(stops.takeProfit).toBeNull()
    expect(stops.stopLoss).toBeNull()
    expect(stops.atr).toBeNull()
    expect(stops.regime).toBe("unknown")

    const rv = realizedVolatility([100, 101, 100, 101], { period: 20 })
    expect(rv.daily).toBeNull()
    expect(rv.annual).toBeNull()
  })
})


describe("F-11 — OHLC-aware estimators vs close-only std (same sample)", () => {
  // Mean-reverting path: closes barely move while every bar prints a wide
  // intraday range. Close-close std sees almost nothing; GK/YZ must see the
  // range — this is precisely the information the old estimator discarded.
  function meanRevertingWideRangeCandles(n) {
    const out = []
    let close = 100
    for (let i = 0; i < n; i++) {
      close = 100 + (i % 2 === 0 ? 0.001 : -0.001)
      out.push({
        time: i * 60000,
        open: close,
        high: close + 1.5,
        low: close - 1.5,
        close
        })
    }
    return out
  }

  it("GK and YZ capture intraday range that realized (std-only) discards", () => {
    const candles = meanRevertingWideRangeCandles(60)
    const closes = candles.map((c) => c.close)
    const realized = realizedVolatility(closes, { period: 20 })
    const gk = garmanKlassVolatility(candles, { period: 20 })
    const yz = yangZhangVolatility(candles, { period: 20 })
    expect(realized.daily).toBeLessThan(0.0005)
    expect(gk.daily).toBeGreaterThan(0.01)
    expect(yz.daily).toBeGreaterThan(0.01)
    expect(gk.daily).toBeGreaterThan(realized.daily * 10)
    expect(yz.daily).toBeGreaterThan(realized.daily * 10)
  })

  it("YZ adds the overnight-gap term that Parkinson (high-low only) misses", () => {
    // Doji bars with alternating overnight gaps and flat intraday paths:
    // Parkinson reads zero range, YZ must still see the gap variance.
    const candles = []
    let prevClose = 100
    for (let i = 0; i < 40; i++) {
      const gap = i % 2 === 0 ? 1.01 : 0.99
      const open = prevClose * gap
      candles.push({ time: i * 60000, open, high: open, low: open, close: open })
      prevClose = open
    }
    const p = parkinsonVolatility(candles, { period: 20 })
    const yz = yangZhangVolatility(candles, { period: 20 })
    expect(p.daily).toBe(0)
    expect(yz.daily).toBeGreaterThan(0)
    expect(yz.daily).toBeGreaterThan(p.daily)
  })

  it("returns nulls instead of fabricated values when the sample is too short", () => {
    const short = meanRevertingWideRangeCandles(4)
    expect(garmanKlassVolatility(short, { period: 20 }).daily).toBeNull()
    expect(yangZhangVolatility(short, { period: 20 }).daily).toBeNull()
    expect(garmanKlassVolatility([], { period: 20 }).daily).toBeNull()
    expect(yangZhangVolatility(null, { period: 20 }).daily).toBeNull()
  })

  it("volatilitySnapshot now carries GK + YZ alongside realized/Parkinson", () => {
    const candles = meanRevertingWideRangeCandles(80)
    const snap = volatilitySnapshot(candles)
    expect(snap.ok).toBe(true)
    expect(snap.garmanKlass.daily).toBeGreaterThan(0)
    expect(snap.yangZhang.daily).toBeGreaterThan(0)
    expect(snap.realized.daily).toBeDefined()
    expect(snap.parkinson.daily).toBeDefined()
  })
})
