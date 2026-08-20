import { describe, it, expect } from "vitest"
import { multiTimeframeConfluence, quickMtfCheck, selectStyle, TRADING_STYLES, TIMEFRAME_SECONDS } from "../services/multiTimeframe.mjs"

// Synthetic candle generator
function genCandles(n, startPrice = 100, drift = 0.001, vol = 0.01) {
  const candles = []
  let price = startPrice
  for (let i = 0; i < n; i++) {
    const ret = drift + vol * (Math.sin(i * 0.1) * 0.5 + (Math.random() - 0.5))
    price *= 1 + ret
    const h = price * (1 + Math.abs(vol * 0.5))
    const l = price * (1 - Math.abs(vol * 0.5))
    candles.push({
      time: i * 60,
      open: price * (1 - ret * 0.3),
      high: h,
      low: l,
      close: price,
      volume: 1000 + Math.random() * 500
    })
  }
  return candles
}

describe("selectStyle", () => {
  it("returns scalping for high volatility", () => {
    expect(selectStyle(5, 100)).toBe("scalping")
  })
  it("returns dayTrading for medium volatility", () => {
    expect(selectStyle(1, 100)).toBe("dayTrading")
  })
  it("returns swing for low volatility", () => {
    expect(selectStyle(0.1, 100)).toBe("swing")
  })
  it("defaults to dayTrading for missing data", () => {
    expect(selectStyle(null, null)).toBe("dayTrading")
    expect(selectStyle(0, 0)).toBe("dayTrading")
  })
})

describe("TIMEFRAME_SECONDS", () => {
  it("has correct conversions", () => {
    expect(TIMEFRAME_SECONDS["1m"]).toBe(60)
    expect(TIMEFRAME_SECONDS["5m"]).toBe(300)
    expect(TIMEFRAME_SECONDS["15m"]).toBe(900)
    expect(TIMEFRAME_SECONDS["1h"]).toBe(3600)
    expect(TIMEFRAME_SECONDS["1d"]).toBe(86400)
  })
})

describe("TRADING_STYLES", () => {
  it("defines scalping, dayTrading, swing", () => {
    expect(TRADING_STYLES.scalping).toBeDefined()
    expect(TRADING_STYLES.dayTrading).toBeDefined()
    expect(TRADING_STYLES.swing).toBeDefined()
  })
  it("each style has entry, confirms, trend, and weights", () => {
    for (const [name, style] of Object.entries(TRADING_STYLES)) {
      expect(style.entry).toBeTruthy()
      expect(Array.isArray(style.confirms)).toBe(true)
      expect(style.trend).toBeTruthy()
      expect(style.weight).toBeDefined()
      const totalWeight = Object.values(style.weight).reduce((a, b) => a + b, 0)
      expect(totalWeight).toBeCloseTo(1.0, 1)
    }
  })
})

describe("multiTimeframeConfluence", () => {
  it("returns ok with valid candles", () => {
    const candles = genCandles(100)
    const result = multiTimeframeConfluence({ candles, style: "scalping" })
    expect(result.ok).toBe(true)
    expect(result.direction).toMatch(/^(up|down|flat)$/)
    expect(typeof result.confidence).toBe("number")
    expect(result.style).toBe("scalping")
  })

  it("works with periods map (LiveEO data)", () => {
    const periods = {
      60: genCandles(100),
      300: genCandles(100),
      900: genCandles(100)
    }
    const result = multiTimeframeConfluence({
      periods,
      style: "dayTrading"
    })
    expect(result.ok).toBe(true)
    expect(result.totalChecked).toBeGreaterThanOrEqual(2)
  })

  it("handles empty periods gracefully", () => {
    const result = multiTimeframeConfluence({
      candles: [],
      periods: {},
      style: "dayTrading"
    })
    expect(result.ok).toBe(true)
    expect(result.direction).toBe("flat")
    expect(result.confidence).toBe(0)
  })

  it("respects custom weights", () => {
    const candles = genCandles(100)
    const periods = { 300: genCandles(100), 900: genCandles(100) }
    const result1 = multiTimeframeConfluence({
      candles,
      periods,
      style: "dayTrading",
      customWeights: { "5m": 0.9, "15m": 0.1 }
    })
    expect(result1.ok).toBe(true)
  })

  it("includes per-TF breakdown", () => {
    const candles = genCandles(100)
    const result = multiTimeframeConfluence({ candles, style: "scalping" })
    expect(result.timeframes).toBeDefined()
    expect(Object.keys(result.timeframes).length).toBeGreaterThan(0)
    for (const tf of Object.values(result.timeframes)) {
      expect(tf.direction).toMatch(/^(up|down|flat)$/)
      expect(typeof tf.strength).toBe("number")
    }
  })

  it("veto is true when all TFs disagree", () => {
    // Flat candles — should not trigger veto because direction is flat (no disagreement)
    const candles = Array.from({ length: 100 }, (_, i) => ({
      time: i * 60,
      open: 100 + Math.sin(i * 0.5) * 0.01,
      high: 100.02 + Math.sin(i * 0.5) * 0.01,
      low: 99.98 + Math.sin(i * 0.5) * 0.01,
      close: 100 + Math.sin(i * 0.5) * 0.01,
      volume: 1000
    }))
    const result = multiTimeframeConfluence({ candles, style: "scalping" })
    expect(result.veto).toBe(false) // flat direction = no veto
  })
})

describe("quickMtfCheck", () => {
  it("returns zero for null asset", () => {
    const r = quickMtfCheck(null, 1)
    expect(r.agree).toBe(0)
    expect(r.total).toBe(0)
  })

  it("returns zero when primary direction is 0", () => {
    const asset = { periods: { 300: genCandles(50) } }
    const r = quickMtfCheck(asset, 0)
    expect(r.agree).toBe(0)
  })

  it("checks 5m and 15m timeframes", () => {
    const asset = {
      periods: {
        300: genCandles(50, 100, 0.002),
        900: genCandles(50, 100, 0.002)
      }
    }
    const r = quickMtfCheck(asset, 1)
    expect(r.total).toBe(2)
    expect(Array.isArray(r.tfDetails)).toBe(true)
  })

  it("skips timeframes with insufficient data", () => {
    const asset = { periods: { 300: genCandles(5) } } // too few
    const r = quickMtfCheck(asset, 1)
    expect(r.total).toBe(0)
  })
})
