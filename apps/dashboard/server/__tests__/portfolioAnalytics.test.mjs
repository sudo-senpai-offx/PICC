import { describe, expect, it } from "vitest"
import { stressTest } from "../services/portfolioAnalytics.mjs"

describe("portfolioAnalytics.stressTest", () => {
  const assets = [{ symbol: "AAPL" }, { symbol: "GOLD" }]
  const weights = [0.6, 0.4]

  it("computes portfolio impact = sum(weight * shock) and sorts worst-first", () => {
    const scenarios = [
      { name: "Mild", shocks: { AAPL: -0.10, GOLD: 0.05 } },  // impact = -0.06 + 0.02 = -0.04
      { name: "Severe", shocks: { AAPL: -0.30, GOLD: 0.10 } } // impact = -0.18 + 0.04 = -0.14
    ]
    const r = stressTest(weights, assets, scenarios)
    expect(r.scenarios).toHaveLength(2)
    // worst (most negative) first
    expect(r.scenarios[0].name).toBe("Severe")
    expect(r.scenarios[0].portfolioImpact).toBe(-14) // percent
    expect(r.worstCase.name).toBe("Severe")
    expect(r.bestCase.name).toBe("Mild")
    expect(r.avgImpact).toBe(-9) // (-14 + -4) / 2
  })

  it("reports per-asset impacts with weights and shocks as %", () => {
    const scenarios = [{ name: "S", shocks: { AAPL: -0.10, GOLD: 0.05 } }]
    const r = stressTest(weights, assets, scenarios)
    const imp = r.scenarios[0].assetImpacts
    expect(imp).toHaveLength(2)
    expect(imp.find((a) => a.symbol === "AAPL")).toMatchObject({ weight: 60, shock: -10, impact: -6 })
    expect(imp.find((a) => a.symbol === "GOLD")).toMatchObject({ weight: 40, shock: 5, impact: 2 })
  })

  it("handles unlisted assets as a zero shock", () => {
    const scenarios = [{ name: "OnlyAAPL", shocks: { AAPL: -0.05 } }]
    const r = stressTest(weights, assets, scenarios)
    expect(r.scenarios[0].portfolioImpact).toBe(-3) // 0.6 * -5
  })

  it("runs the default scenario suite when none provided", () => {
    const r = stressTest(weights, assets)
    expect(r.scenarios.length).toBeGreaterThanOrEqual(5)
    expect(r.worstCase).toBeTruthy()
    expect(r.bestCase).toBeTruthy()
    expect(Number.isFinite(r.avgImpact)).toBe(true)
  })
})
