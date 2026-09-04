import { describe, expect, test } from "vitest"
import {
  realizedVolatility,
  volatilityRegime,
  volatilityPositionSize,
  garmanKlassVolatility,
  yangZhangVolatility,
  annualizedVolatility
} from "../services/volatility.mjs"

function closesSeries(n, step) {
  return Array.from({ length: n }, (_, i) => 100 + i * step)
}

function candle(open, high, low, close) {
  return { open, high, low, close }
}

describe("volatility math (slice 5d coverage)", () => {
  test("realizedVolatility is 0 on a perfectly steady series and > 0 on a choppy one", () => {
    // Constant PERCENTAGE growth → identical log returns → zero variance.
    const steadyPrices = Array.from({ length: 60 }, (_, i) => 100 * 1.001 ** i)
    const steady = realizedVolatility(steadyPrices, { period: 20, annualize: 252 })
    expect(steady.daily).toBe(0)
    expect(steady.annual).toBe(0)
    expect(steady.annualPct).toBe("0%")

    const choppy = []
    for (let i = 0; i < 60; i++) choppy.push(100 + (i % 2 === 0 ? i : -i * 0.5))
    const noisy = realizedVolatility(choppy, { period: 20, annualize: 252 })
    expect(noisy.annual).toBeGreaterThan(0)
    expect(noisy.sampleSize).toBeGreaterThanOrEqual(20)
  })

  test("garman-klass / yang-zhang return positive annualized estimates on OHLC data", () => {
    const candles = []
    for (let i = 0; i < 40; i++) {
      const c = 100 + i * 0.3
      candles.push(candle(c - 0.4, c + 0.8, c - 0.8, c + 0.2))
    }
    const gk = garmanKlassVolatility(candles, { period: 20, annualize: 252 })
    const yz = yangZhangVolatility(candles, { period: 20, annualize: 252 })
    expect(gk.annual).toBeGreaterThan(0)
    expect(yz.annual).toBeGreaterThan(0)
  })

  test("annualizedVolatility picks the best estimator the data supports", () => {
    // Close-only → close-close method.
    const closes = closesSeries(60, 1)
    expect(annualizedVolatility(closes).method).toBe("close-close")
    // OHLC present → an OHLC estimator (yang-zhang is most efficient).
    const candles = []
    for (let i = 0; i < 60; i++) {
      const c = 100 + i * 0.3
      candles.push(candle(c - 0.4, c + 0.8, c - 0.8, c + 0.2))
    }
    const est = annualizedVolatility(candles)
    expect(["yang-zhang", "garman-klass", "parkinson", "close-close"]).toContain(est.method)
    expect(est.annual).toBeGreaterThan(0)
  })

  test("volatilityPositionSize scales inversely to volatility with exact math", () => {
    const size = volatilityPositionSize({ capital: 10000, riskPct: 0.02, currentVol: 0.3, targetVol: 0.2, entryPrice: 100 })
    expect(size.volScale).toBeCloseTo(0.6667, 4)
    expect(size.riskBudget).toBeCloseTo(133.33, 2)
    expect(size.units).toBe(1)
    expect(size.positionValue).toBeCloseTo(100, 2)
  })

  test("volatilityRegime flags a late ATR spike as high/elevated", () => {
    const candles = []
    for (let i = 0; i < 40; i++) {
      // First 30 bars calm, last 10 wide.
      const wide = i >= 30
      const c = 100 + i * 0.1
      const half = wide ? 3 : 0.05
      candles.push(candle(c - half, c + half, c - half, c))
    }
    const r = volatilityRegime(candles, { period: 14 })
    expect(r.percentile).toBeGreaterThanOrEqual(70)
    expect(["high", "elevated"]).toContain(r.regime)
    expect(r.atr).toBeGreaterThan(0)
  })
})
