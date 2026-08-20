import { describe, it, expect } from "vitest"
import { arimaForecast, holtWintersForecast, lstmLiteForecast, garchForecast } from "../services/models.mjs"

function genPrices(n, start = 100, drift = 0.001, vol = 0.01) {
  const prices = [start]
  for (let i = 1; i < n; i++) {
    const ret = drift + vol * (Math.sin(i * 0.1) * 0.5 + (Math.random() - 0.5))
    prices.push(prices[i - 1] * (1 + ret))
  }
  return prices
}

function deterministicPrices(n, start, drift) {
  const prices = [start]
  for (let i = 1; i < n; i++) prices.push(prices[i - 1] * (1 + drift))
  return prices
}

describe("arimaForecast", () => {
  it("returns direction and strength", () => {
    const closes = genPrices(100)
    const r = arimaForecast(closes, 3)
    expect(r.model).toBe("arima")
    expect(typeof r.direction).toBe("number")
    expect(typeof r.strength).toBe("number")
    expect(r.direction).toBeGreaterThanOrEqual(-1)
    expect(r.direction).toBeLessThanOrEqual(1)
  })

  it("returns insufficient signal for short series", () => {
    const r = arimaForecast([1, 2, 3], 3)
    expect(r.direction).toBe(0)
    expect(r.strength).toBe(0)
  })

  it("produces AR coefficients", () => {
    const closes = genPrices(100)
    const r = arimaForecast(closes, 3, 3, 1)
    expect(Array.isArray(r.arCoeffs)).toBe(true)
    expect(r.arCoeffs.length).toBe(3)
  })

  it("handles trending data", () => {
    const closes = deterministicPrices(100, 100, 0.005).map((p, i) => p + Math.sin(i * 0.3) * 0.1)
    const r = arimaForecast(closes, 3)
    expect(r.model).toBe("arima")
    expect(typeof r.direction).toBe("number")
  })
})

describe("holtWintersForecast", () => {
  it("returns direction and strength", () => {
    const closes = genPrices(100)
    const r = holtWintersForecast(closes, 3)
    expect(r.model).toBe("prophet")
    expect(typeof r.direction).toBe("number")
    expect(typeof r.strength).toBe("number")
  })

  it("returns insufficient for short series", () => {
    const r = holtWintersForecast([1, 2, 3, 4, 5], 3)
    expect(r.direction).toBe(0)
  })

  it("detects uptrend", () => {
    // Strong sustained uptrend with enough data to overcome noise
    const closes = genPrices(120, 100, 0.005, 0.002)
    const r = holtWintersForecast(closes, 3)
    expect(r.direction).toBe(1)
  })

  it("provides level and trend", () => {
    const closes = genPrices(100)
    const r = holtWintersForecast(closes, 3)
    expect(typeof r.level).toBe("number")
    expect(typeof r.trend).toBe("number")
  })
})

describe("lstmLiteForecast", () => {
  it("returns direction and probability", () => {
    const closes = genPrices(100)
    const r = lstmLiteForecast(closes, 3)
    expect(r.model).toBe("lstm")
    expect(typeof r.direction).toBe("number")
    expect(typeof r.probability).toBe("number")
  })

  it("returns zero for short series", () => {
    const r = lstmLiteForecast([1, 2, 3], 3)
    expect(r.direction).toBe(0)
  })

  it("produces trained weights", () => {
    const closes = genPrices(100)
    const r = lstmLiteForecast(closes, 3)
    expect(Array.isArray(r.weights)).toBe(true)
  })
})

describe("garchForecast", () => {
  it("returns direction and volatility data", () => {
    const closes = genPrices(100)
    const r = garchForecast(closes, 3)
    expect(r.model).toBe("garch")
    expect(typeof r.direction).toBe("number")
    expect(typeof r.currentVol).toBe("number")
    expect(typeof r.forecastVol).toBe("number")
  })

  it("returns insufficient for short series", () => {
    const r = garchForecast([1, 2, 3], 3)
    expect(r.direction).toBe(0)
  })

  it("volatility forecast is positive", () => {
    const closes = genPrices(100)
    const r = garchForecast(closes, 3)
    expect(r.currentVol).toBeGreaterThan(0)
    expect(r.forecastVol).toBeGreaterThan(0)
  })
})
