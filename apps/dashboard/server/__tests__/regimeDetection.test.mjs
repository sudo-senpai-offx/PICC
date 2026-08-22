import { describe, expect, it } from "vitest"
import { detectRegime } from "../services/regimeDetection.mjs"
import { computeAdaptiveStops } from "../services/trading.mjs"

function trendCandles(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i
    return { time: i * 60000, open: close - 1, high: close + 0.6, low: close - 0.6, close }
  })
}

function noiseCandles(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const close = i % 2 === 0 ? 100 : 101
    return { time: i * 60000, open: i % 2 === 0 ? 101 : 100, high: close + 0.5, low: close - 0.5, close }
  })
}

function rangingCandles(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const wide = i < 30
    const close = wide ? (i % 2 === 0 ? 103 : 97) : i % 2 === 0 ? 100.4 : 99.6
    const pad = wide ? 1 : 0.2
    return { time: i * 60000, open: close, high: close + pad, low: close - pad, close }
  })
}

function volatileCandles(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    let close
    if (i < 48) close = i % 2 === 0 ? 100 : 100.1
    else if (i < 59) close = i % 2 === 0 ? 106 : 94
    else close = 100
    const pad = i < 48 ? 0.1 : 1
    return { time: i * 60000, open: close, high: close + pad, low: close - pad, close }
  })
}

describe("detectRegime (regimeDetection.mjs)", () => {
  it("is deterministic and derived from price action, not a random signal", () => {
    expect(detectRegime(volatileCandles())).toEqual(detectRegime(volatileCandles()))
    expect(detectRegime(trendCandles()).regime).not.toBe(detectRegime(noiseCandles()).regime)
    expect(detectRegime(trendCandles()).factors.length).toBeGreaterThan(0)
  })

  it("classifies sustained directional price action as trending", () => {
    const r = detectRegime(trendCandles())
    expect(r.regime).toBe("trending")
    expect(r.confidence).toBeGreaterThanOrEqual(90)
    expect(r.metrics.adx).toBeGreaterThan(25)
    expect(r.suggestedStrategy).toBe("momentum")
    expect(r.factors.join(" ")).toMatch(/ADX/)
  })

  it("never labels noisy back-and-forth movement as trending", () => {
    const r = detectRegime(noiseCandles())
    expect(r.regime).not.toBe("trending")
    expect(r.metrics.adx).toBeLessThan(20)
    expect(r.confidence).toBeLessThan(detectRegime(trendCandles()).confidence)
  })

  it("labels bounded contracting ranges as ranging with the mean-reversion strategy", () => {
    const r = detectRegime(rangingCandles())
    expect(r.regime).toBe("ranging")
    expect(r.confidence).toBeGreaterThanOrEqual(70)
    expect(r.metrics.adx).toBeLessThan(20)
    expect(r.metrics.atrRatio).toBeLessThan(0.8)
    expect(r.suggestedStrategy).toBe("mean-reversion")
  })

  it("does not label a trending market as ranging", () => {
    expect(detectRegime(trendCandles()).regime).not.toBe("ranging")
  })

  it("labels recent ATR expansion as volatile relative to its own history", () => {
    const r = detectRegime(volatileCandles())
    expect(r.regime).toBe("volatile")
    expect(r.metrics.atrRatio).toBeGreaterThan(1.5)
    expect(r.suggestedStrategy).toBe("volatility-breakout")
    expect(r.factors.join(" ")).toMatch(/ATR ratio/)
  })

  it("returns unknown with zero confidence for insufficient candles", () => {
    const r = detectRegime(noiseCandles(29))
    expect(r.regime).toBe("unknown")
    expect(r.confidence).toBe(0)
    expect(r.factors).toEqual([])
  })
})

describe("computeAdaptiveStops regime classification (trading.mjs)", () => {
  it("maps a trending series to trending multipliers", () => {
    const candles = trendCandles()
    const stops = computeAdaptiveStops(candles, "up")
    expect(stops.regime).toBe("trending")
    expect(stops.multipliers).toEqual({ tp: 2.5, sl: 1.2 })
    const last = candles[candles.length - 1].close
    expect(Math.abs(stops.takeProfit - (last + stops.atr * 2.5))).toBeLessThan(1e-6)
    expect(Math.abs(stops.stopLoss - (last - stops.atr * 1.2))).toBeLessThan(1e-6)
  })

  it("maps an ATR spike to volatile multipliers", () => {
    const stops = computeAdaptiveStops(volatileCandles(), "up")
    expect(stops.regime).toBe("volatile")
    expect(stops.multipliers).toEqual({ tp: 2, sl: 1.8 })
    expect(stops.atrRatio).toBeGreaterThan(1.5)
  })

  it("maps a quiet bounded range to ranging multipliers", () => {
    const stops = computeAdaptiveStops(rangingCandles(), "up")
    expect(stops.regime).toBe("ranging")
    expect(stops.multipliers).toEqual({ tp: 1.8, sl: 1.5 })
  })
})
