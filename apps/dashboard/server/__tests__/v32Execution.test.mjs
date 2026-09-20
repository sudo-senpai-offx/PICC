// v3.2 Plan 3 — Task 2 test bed: v32Execution pillars (REQ-P3-2/3/4/5).
import { describe, it, expect } from "vitest"
import {
  vwapPillar,
  emaPair,
  volumeDelta,
  cumulativeVolumeDelta,
  relativeVolume,
  executionScore
} from "../services/v32Execution.mjs"

const CANDLE = (i, price, volume = 100) => ({
  open: price - 1,
  high: price + 2,
  low: price - 2,
  close: price,
  volume
})

function candlesFrom(closes, volumes = null) {
  return closes.map((c, i) => CANDLE(i, c, volumes == null ? 100 : volumes[i]))
}

describe("vwapPillar — VWAP dual-anchor (REQ-P3-2)", () => {
  it("cumulative anchor matches indicators.vwap last value on a fixture", () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]
    const candles = candlesFrom(closes)
    const res = vwapPillar({ candles, anchor: "cumulative" })
    expect(res.available).toBe(true)
    expect(res.anchor).toBe("cumulative")
    const highs = candles.map((c) => c.high)
    const lows = candles.map((c) => c.low)
    const vols = candles.map((c) => c.volume)
    // Cross-check: the module wraps indicators.vwap — recompute the last value here.
    const lastIndex = closes.length - 1
    let cumPV = 0, cumV = 0
    for (let i = 0; i <= lastIndex; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3
      cumPV += tp * 100
      cumV += 100
    }
    expect(res.vwap).toBeCloseTo(cumPV / cumV, 6)
  })

  it("session-reset anchor recomputes from the session-open bar only", () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]
    const candles = candlesFrom(closes)
    const sessionOpenIndex = 8
    const res = vwapPillar({ candles, anchor: "session", sessionOpenIndex })
    expect(res.available).toBe(true)
    // Only bars 8..15 contribute.
    const sub = candles.slice(sessionOpenIndex)
    let cumPV = 0, cumV = 0
    for (const c of sub) {
      const tp = (c.high + c.low + c.close) / 3
      cumPV += tp * 100
      cumV += 100
    }
    expect(res.vwap).toBeCloseTo(cumPV / cumV, 6)
    expect(res.price).toBe(115)
    expect(res.side).toBe("above") // price above session-open-anchored VWAP
  })

  it("reports honest unavailable below 15 bars", () => {
    const candles = candlesFrom([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113])
    const res = vwapPillar({ candles, anchor: "cumulative" })
    expect(res.available).toBe(false)
    expect(res.reason).toMatch(/15 bars/)
  })

  it("reports honest unavailable for an out-of-range sessionOpenIndex", () => {
    const candles = candlesFrom(Array.from({ length: 20 }, (_, i) => 100 + i))
    const res = vwapPillar({ candles, anchor: "session", sessionOpenIndex: 99 })
    expect(res.available).toBe(false)
    expect(res.reason).toMatch(/sessionOpenIndex/)
  })

  it("rejects an unknown anchor honestly", () => {
    const candles = candlesFrom(Array.from({ length: 20 }, (_, i) => 100 + i))
    const res = vwapPillar({ candles, anchor: "bogus" })
    expect(res.available).toBe(false)
    expect(res.reason).toMatch(/anchor/)
  })
})

describe("emaPair — EMA 9/21 alignment + spread (REQ-P3-3)", () => {
  it("monotonic up fixture aligns long with ema9 > ema21", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 1.5)
    const res = emaPair({ closes })
    expect(res.available).toBe(true)
    expect(res.aligned).toBe("long")
    expect(res.ema9).toBeGreaterThan(res.ema21)
    expect(res.spread).toBe(res.ema9 - res.ema21)
    expect(res.spreadPct).toBeCloseTo(Math.round(((res.ema9 - res.ema21) / res.ema9) * 10000) / 10000, 4)
  })

  it("monotonic down fixture aligns short", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 200 - i * 1.5)
    const res = emaPair({ closes })
    expect(res.available).toBe(true)
    expect(res.aligned).toBe("short")
    expect(res.ema9).toBeLessThan(res.ema21)
  })

  it("flat series aligns flat", () => {
    const closes = Array(40).fill(100)
    const res = emaPair({ closes })
    expect(res.available).toBe(true)
    expect(res.aligned).toBe("flat")
  })

  it("reports honest unavailable on insufficient bars", () => {
    const closes = Array.from({ length: 9 }, (_, i) => 100 + i)
    const res = emaPair({ closes })
    expect(res.available).toBe(false)
    expect(res.reason).toMatch(/bars/)
  })
})

describe("volumeDelta / cumulativeVolumeDelta — maker-flow over signed trades (REQ-P3-4)", () => {
  const TRADES = [
    { timeMs: 1000, price: 100, side: "buy", amount: 10 },
    { timeMs: 2000, price: 101, side: "sell", amount: 5 },
    { timeMs: 3000, price: 102, side: "buy", amount: 7 },
    { timeMs: 4000, price: 103, side: "take", amount: 3 }
  ]

  it("volumeDelta computes buy - sell maker flow", () => {
    const res = volumeDelta({ trades: TRADES })
    expect(res.available).toBe(true)
    expect(res.delta).toBe(10 - 5 + 7)
    expect(res.trades).toBe(4)
    expect(res.takeFill).toBe(3)
  })

  it("volumeDelta is honest without a feed", () => {
    const res = volumeDelta({})
    expect(res.available).toBe(false)
    expect(res.reason).toMatch(/no trades feed/)
  })

  it("cumulativeVolumeDelta walks the series cumulatively", () => {
    const res = cumulativeVolumeDelta({ trades: TRADES })
    expect(res.available).toBe(true)
    expect(res.series.length).toBe(4)
    expect(res.series[0]).toBe(10) // buy
    expect(res.series[1]).toBe(5) // 10 - 5
    expect(res.series[2]).toBe(12) // + 7
    expect(res.series[3]).toBe(12) // take fills consume resting size, delta unchanged
    expect(res.last).toBe(12)
  })

  it("cumulativeVolumeDelta is honest without a feed", () => {
    const res = cumulativeVolumeDelta({})
    expect(res.available).toBe(false)
    expect(res.reason).toMatch(/no trades feed/)
  })
})

describe("relativeVolume — bar volume vs trailing average (REQ-P3-4)", () => {
  it("computes bar volume over a trailing window", () => {
    // 10 flat bars then 6 elevated bars; prev window (10) spans 5 flat + 5 elevated.
    const vols = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 200, 200, 200, 200, 200, 200]
    const candles = candlesFrom(vols.map((v, i) => 100 + i), vols)
    const res = relativeVolume({ candles, window: 10 })
    expect(res.available).toBe(true)
    const avg = (100 * 5 + 200 * 5) / 10
    expect(res.last).toBeCloseTo(200, 4)
    expect(res.avg).toBeCloseTo(avg, 4)
    expect(res.ratio).toBeCloseTo(Math.round((200 / avg) * 10000) / 10000, 4)
  })

  it("reports honest unavailable when candles carry no volume", () => {
    const candles = Array.from({ length: 30 }, (_, i) => CANDLE(i, 100 + i, 0))
    const res = relativeVolume({ candles })
    expect(res.available).toBe(false)
    expect(res.reason).toMatch(/volume/)
  })

  it("reports honest unavailable on insufficient bars", () => {
    const candles = candlesFrom([100, 101, 102])
    const res = relativeVolume({ candles })
    expect(res.available).toBe(false)
  })
})

describe("executionScore — venue degradation (REQ-P3-5)", () => {
  const mkPillars = (overrides = {}) => ({
    vwap: { available: true, anchor: "cumulative", vwap: 100, price: 101, side: "above", distancePct: 0.01 },
    ema: { available: true, ema9: 99, ema21: 98, aligned: "long", spread: 1, spreadPct: 0.01 },
    volumeDelta: { available: true, delta: 5, trades: 10 },
    cvd: { available: true, last: 5, series: [5] },
    relativeVolume: { available: true, last: 1.5, ratio: 1.5 },
    ...overrides
  })

  it("crypto with full feed scores on the full 5-point", () => {
    const res = executionScore({ pillars: mkPillars(), venue: "crypto" })
    expect(res.available).toBe(true)
    expect(res.pillars).toHaveLength(5)
    expect(res.degraded).toHaveLength(0)
    expect(res.score).toBeGreaterThan(0)
    expect(res.score).toBeLessThanOrEqual(1)
    expect(res).not.toHaveProperty("confidence") // banned shape (REQ-CON-5)
  })

  it("forex/EO degrades to VWAP + EMA only, listing Δ/CVD/rel-vol honestly", () => {
    const res = executionScore({ pillars: mkPillars(), venue: "forex" })
    expect(res.available).toBe(true)
    expect(res.pillars).toHaveLength(2)
    expect(res.degraded).toHaveLength(3)
    for (const d of res.degraded) {
      expect(d.reason).toBeTruthy()
      expect(d.reason.toLowerCase()).toMatch(/forex|eo|not measured|no trades/)
    }
  })

  it("crypto honestly degrades when the trades feed is absent", () => {
    const res = executionScore({ pillars: mkPillars({ volumeDelta: { available: false, reason: "no trades feed" }, cvd: { available: false, reason: "no trades feed" } }), venue: "crypto" })
    expect(res.available).toBe(true)
    expect(res.pillars).toHaveLength(3) // vwap + ema + relativeVolume
    const reasons = res.degraded.map((d) => d.reason).join(" ")
    expect(reasons).toMatch(/no trades feed/)
  })

  it("reports unavailable when no pillar is usable", () => {
    const res = executionScore({ pillars: {}, venue: "crypto" })
    expect(res.available).toBe(false)
    expect(res.reason).toBeTruthy()
  })
})