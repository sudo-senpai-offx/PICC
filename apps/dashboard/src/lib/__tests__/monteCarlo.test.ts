import { describe, expect, it } from "vitest"
import { assumptionsFor, runMonteCarlo, formatCurrency, formatPercent } from "../monteCarlo"
import type { FinancialTwinParams } from "../types"

const base: FinancialTwinParams = {
  ticker: "VOO",
  assetClass: "stock",
  capital: 10000,
  riskTolerance: "moderate",
  horizonYears: 10,
  simulations: 2000
}

describe("assumptionsFor", () => {
  it("returns the base assumptions for a moderate stock allocation", () => {
    const a = assumptionsFor(base)
    expect(a.drift).toBe(0.075)
    expect(a.vol).toBe(0.14)
    expect(a.allocation.equities).toBe(0.6)
  })

  it("shifts assumptions by asset class", () => {
    const bonds = assumptionsFor({ ...base, assetClass: "bonds", riskTolerance: "conservative" })
    expect(bonds.drift).toBeCloseTo(0.04, 5)
    expect(bonds.vol).toBe(0.04)
    expect(bonds.vol).toBeLessThan(0.09)
  })

  it("applies a higher drift and vol band for crypto", () => {
    const crypto = assumptionsFor({ ...base, assetClass: "crypto", riskTolerance: "aggressive" })
    expect(crypto.drift).toBeCloseTo(0.125, 5)
    expect(crypto.vol).toBeGreaterThanOrEqual(0.19)
  })
})

describe("runMonteCarlo (client fallback)", () => {
  it("produces an ordered distribution with a growing median", () => {
    const p = runMonteCarlo({ ...base, simulations: 5000 })
    expect(p.p10).toBeLessThan(p.medianEnd)
    expect(p.medianEnd).toBeLessThan(p.p90)
    expect(p.medianEnd).toBeGreaterThan(base.capital)
    expect(p.simulatedPaths).toBe(5000)
  })

  it("includes contributions and inflation-adjusted stats", () => {
    const p = runMonteCarlo({
      ...base,
      simulations: 3000,
      monthlyContribution: 200,
      inflationRate: 0.03
    })
    expect(p.totalContributions).toBe(base.capital + 200 * 120)
    expect(p.medianEndReal).toBeLessThan(p.medianEnd)
    expect(p.medianProfit).toBe(p.medianEnd - p.totalContributions)
    expect(p.winRate).toBeGreaterThan(0.5)
    expect(p.p5).toBeLessThan(p.p10)
  })

  it("grows contributions with inflation when enabled", () => {
    const flat = runMonteCarlo({ ...base, simulations: 1500, monthlyContribution: 100 })
    const growing = runMonteCarlo({
      ...base,
      simulations: 1500,
      monthlyContribution: 100,
      inflationRate: 0.03,
      inflationAdjustContributions: true
    })
    expect(growing.totalContributions).toBeGreaterThan(flat.totalContributions)
  })
})

describe("formatters", () => {
  it("formats currency and percent", () => {
    expect(formatCurrency(25125)).toBe("$25,125")
    expect(formatPercent(0.075)).toBe("7.5%")
    expect(formatPercent(0.3, 0)).toBe("30%")
  })
})
