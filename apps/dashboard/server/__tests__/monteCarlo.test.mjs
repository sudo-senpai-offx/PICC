import { describe, expect, it } from "vitest"
import { runMonteCarlo } from "../monteCarlo.mjs"

describe("server Monte Carlo engine", () => {
  it("returns a sane distribution for positive drift", () => {
    const p = runMonteCarlo({ capital: 10000, horizonYears: 10, simulations: 3000, drift: 0.07, vol: 0.15 })
    expect(p.simulatedPaths).toBe(3000)
    expect(p.horizonYears).toBe(10)
    expect(p.p10).toBeLessThan(p.medianEnd)
    expect(p.medianEnd).toBeLessThan(p.p90)
    expect(p.medianEnd).toBeGreaterThan(10000)
    expect(p.annualizedReturn).toBeGreaterThan(0.01)
  })

  it("pessimistic tail stays below capital for high volatility", () => {
    const p = runMonteCarlo({ capital: 100000, horizonYears: 30, simulations: 2000, drift: 0.03, vol: 0.4 })
    expect(p.p10).toBeLessThan(100000)
    expect(p.p90).toBeGreaterThan(100000)
  })

  it("accumulates monthly contributions and tracks total contributed", () => {
    const p = runMonteCarlo({
      capital: 10000,
      horizonYears: 10,
      simulations: 3000,
      drift: 0.07,
      vol: 0.15,
      monthlyContribution: 500
    })
    expect(p.totalContributions).toBe(10000 + 500 * 120)
    expect(p.medianEnd).toBeGreaterThan(p.totalContributions)
    expect(p.p5).toBeLessThan(p.medianEnd)
    expect(p.maxDrawdownP50).toBeGreaterThan(0)
    expect(p.winRate).toBeGreaterThan(0.5)
  })

  it("inflation-adjusted percentiles sit below nominal ones", () => {
    const p = runMonteCarlo({
      capital: 100000,
      horizonYears: 20,
      simulations: 2000,
      drift: 0.08,
      vol: 0.16,
      monthlyContribution: 200,
      inflationRate: 0.03
    })
    expect(p.medianEndReal).toBeLessThan(p.medianEnd)
    expect(p.p10Real).toBeLessThan(p.p10)
    expect(p.annualizedRealReturn).toBeLessThan(p.annualizedReturn)
  })

  it("keeps win rate and percentiles coherent for a lump sum", () => {
    const p = runMonteCarlo({ capital: 1000, horizonYears: 5, simulations: 5000, drift: 0.09, vol: 0.2 })
    expect(p.winRate).toBeGreaterThan(0.5)
    expect(p.p10).toBeLessThan(p.medianEnd)
    expect(p.medianEnd).toBeLessThan(p.p90)
    expect(p.p5).toBeLessThan(p.p10)
  })
})
