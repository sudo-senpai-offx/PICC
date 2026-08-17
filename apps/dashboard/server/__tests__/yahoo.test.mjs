import { describe, expect, it } from "vitest"
import { statsFromHistory, downsample, clampDrift, clampVol } from "../services/yahoo.mjs"

describe("yahoo stats", () => {
  it("computes ~0 vol and constant drift for a fixed daily return series", () => {
    const closes = []
    let v = 100
    for (let i = 0; i < 252; i++) {
      v *= 1.01
      closes.push(v)
    }
    const s = statsFromHistory({ closes })
    expect(s.observations).toBeGreaterThan(200)
    expect(s.annualizedVol).toBeLessThan(0.001)
    expect(s.annualizedDrift).toBeGreaterThan(2.4)
    expect(s.annualizedDrift).toBeLessThan(2.6)
  })

  it("measures vol on an alternating series", () => {
    const closes = []
    for (let i = 0; i < 252; i++) closes.push(100 + (i % 2 === 0 ? 2 : -2))
    const s = statsFromHistory({ closes })
    expect(s.annualizedVol).toBeGreaterThan(0.5)
  })

  it("throws when history is too short", () => {
    expect(() => statsFromHistory({ closes: [100, 101, 102] })).toThrow()
  })
})

describe("downsample", () => {
  it("returns as-is when under the max", () => {
    const dates = [1, 2, 3]
    const closes = [10, 11, 12]
    const out = downsample(dates, closes, 260)
    expect(out.dates).toEqual(dates)
    expect(out.closes).toEqual(closes)
  })

  it("reduces a long series to the max points", () => {
    const dates = Array.from({ length: 1000 }, (_, i) => i)
    const closes = Array.from({ length: 1000 }, (_, i) => i)
    const out = downsample(dates, closes, 260)
    expect(out.dates.length).toBeLessThanOrEqual(260)
    expect(out.dates.length).toBeGreaterThan(0)
  })
})

describe("clamping", () => {
  it("bounds drift and vol to sensible ranges", () => {
    expect(clampDrift(0.5)).toBe(0.25)
    expect(clampDrift(-0.5)).toBe(-0.12)
    expect(clampVol(0.99)).toBe(0.8)
    expect(clampVol(0.01)).toBe(0.05)
  })
})
