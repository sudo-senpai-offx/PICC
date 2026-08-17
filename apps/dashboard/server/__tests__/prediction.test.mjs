import { describe, expect, it } from "vitest"
import { predictDirection } from "../services/prediction.mjs"

// Deterministic synthetic series so tests never depend on the network.
function series(start, dailyReturn, n) {
  const out = []
  let v = start
  for (let i = 0; i < n; i++) {
    out.push(v)
    v = v * (1 + dailyReturn)
  }
  return out
}

describe("predictDirection", () => {
  it("needs at least 30 observations", () => {
    const r = predictDirection(series(100, 0.001, 20), 3)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/30/)
  })

  it("calls a sustained uptrend up", () => {
    const r = predictDirection(series(100, 0.002, 200), 3)
    expect(r.ok).toBe(true)
    expect(r.direction).toBe("up")
    expect(r.confidence).toBeGreaterThanOrEqual(50)
    expect(r.confidence).toBeLessThanOrEqual(95)
  })

  it("calls a sustained downtrend down", () => {
    const r = predictDirection(series(100, -0.002, 200), 3)
    expect(r.ok).toBe(true)
    expect(r.direction).toBe("down")
  })

  it("is deterministic for identical input", () => {
    const closes = series(100, 0.001, 150)
    expect(predictDirection(closes, 5)).toEqual(predictDirection(closes, 5))
  })

  it("reports honest backtest metadata", () => {
    const r = predictDirection(series(100, 0.0015, 300), 3)
    expect(r.horizonDays).toBe(3)
    expect(r.sampleSize).toBeGreaterThan(0)
    expect(r.hitRate).toBeGreaterThanOrEqual(0)
    expect(r.hitRate).toBeLessThanOrEqual(100)
    expect(typeof r.models.momentum).toBe("number")
    expect(typeof r.models.trend).toBe("number")
    expect(typeof r.models.monteCarlo).toBe("number")
    expect(typeof r.agreement).toBe("number")
    expect(r.note.length).toBeGreaterThan(0)
  })

  it("clamps the horizon to a sane range", () => {
    const closes = series(100, 0.001, 200)
    expect(predictDirection(closes, 5000).horizonDays).toBe(60)
    expect(predictDirection(closes, 0).horizonDays).toBe(3) // 0 => default
    expect(predictDirection(closes, -2).horizonDays).toBe(3) // negative => default
  })

  it("cleans non-finite and non-positive values", () => {
    const closes = [100, 0, NaN, 105, "bad"]
    for (let v = 108; v <= 220; v += 3) closes.push(v)
    const r = predictDirection(closes, 3)
    expect(r.ok).toBe(true)
    expect(r.last).toBeGreaterThan(0)
  })

  it("mean-reversion model pulls toward the long-run mean log-price", () => {
    // A series that sits well below its own historical mean (long high plateau,
    // then a step down and flat). The mean-reversion model must lean "up"
    // toward the long-run mean. This catches the old unit bug where the long-run
    // mean was taken from the mean *daily return* instead of the mean
    // *log-price*, which flipped the pull term negative for prices above 1.
    const closes = []
    for (let i = 0; i < 300; i++) closes.push(200)
    for (let i = 0; i < 60; i++) closes.push(100)
    const r = predictDirection(closes, 3)
    expect(r.ok).toBe(true)
    expect(r.models.meanRevert).toBeGreaterThan(0)
  })
})
