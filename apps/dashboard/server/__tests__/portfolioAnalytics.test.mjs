import { describe, expect, it, vi } from "vitest"
import {
  computePortfolioAnalytics,
  maxDrawdown,
  mean,
  pearsonCorr,
  sharpeRatio,
  sortinoRatio,
  stdDev,
  stressTest,
  valueAtRisk,
} from "../services/portfolioAnalytics.mjs"

vi.mock("../services/yahoo.mjs", () => ({
  getHistory: async (sym) => {
    if (sym === "FLAT") return { closes: Array(12).fill(100) }
    return { closes: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111] }
  },
}))

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

describe("portfolioAnalytics null-honesty (Task 8)", () => {
  it("mean abstains on empty, still computes on sufficient data", () => {
    expect(mean([])).toBe(null)
    expect(mean([1, 2, 3])).toBe(2)
  })

  it("stdDev abstains on n<2, still computes on sufficient data", () => {
    expect(stdDev([])).toBe(null)
    expect(stdDev([0.01])).toBe(null)
    expect(stdDev([1, 2, 3])).toBeCloseTo(1, 10)
  })

  it("pearsonCorr abstains on n<5 and zero-variance, still computes perfect correlation", () => {
    expect(pearsonCorr([1, 2, 3], [1, 2, 3])).toBe(null)
    expect(pearsonCorr([1, 1, 1, 1, 1], [2, 3, 4, 5, 6])).toBe(null)
    expect(pearsonCorr([1, 2, 3, 4, 5], [7, 7, 7, 7, 7])).toBe(null)
    expect(pearsonCorr([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 10)
  })

  it("sharpeRatio abstains on n<2 and zero-variance", () => {
    expect(sharpeRatio([])).toBe(null)
    expect(sharpeRatio([0.01])).toBe(null)
    expect(sharpeRatio([0.01, 0.01, 0.01], 0)).toBe(null)
  })

  it("sortinoRatio abstains on n<2 and on no-downside (never fabricates)", () => {
    expect(sortinoRatio([])).toBe(null)
    expect(sortinoRatio([0.01])).toBe(null)
    expect(sortinoRatio([0.02, 0.03, 0.04], 0)).toBe(null)
  })

  it("maxDrawdown abstains on n<2, still computes on sufficient data", () => {
    expect(maxDrawdown([])).toBe(null)
    expect(maxDrawdown([1])).toBe(null)
    expect(maxDrawdown([1, 1.2, 1.1, 1.3])).toBeCloseTo((1.2 - 1.1) / 1.2, 10)
  })

  it("valueAtRisk abstains on n<5, still computes on sufficient data", () => {
    expect(valueAtRisk([])).toBe(null)
    expect(valueAtRisk([1, 2, 3, 4])).toBe(null)
    expect(valueAtRisk([1, 2, 3, 4, 5])).toBe(1)
  })

  it("single-asset overview abstains on correlation-derived fields", async () => {
    const one = await computePortfolioAnalytics({ symbols: ["AAPL"], days: 30 })
    expect(one.avgCorrelation).toBe(null)
    expect(one.diversificationScore).toBe(null)
    expect(typeof one.metrics.sharpeRatio).toBe("number")
  })

  it("zero-variance leg abstains in the correlation matrix", async () => {
    const two = await computePortfolioAnalytics({ symbols: ["AAPL", "FLAT"], days: 30 })
    expect(two.corrMatrix[0][1]).toBe(null)
    expect(two.corrMatrix[1][0]).toBe(null)
    expect(two.avgCorrelation).toBe(null)
    expect(two.diversificationScore).toBe(null)
  })
})
