import { describe, expect, it } from "vitest"
import {
  inverseVolWeights,
  equalRiskContribution,
  riskParityAllocation
} from "../services/riskParity.mjs"

describe("riskParity.inverseVolWeights", () => {
  it("returns empty weights when no finite positive vols", () => {
    expect(inverseVolWeights({})).toEqual({ weights: {}, method: "inverse-vol" })
    expect(inverseVolWeights({ A: 0, B: NaN, C: -1 })).toEqual({ weights: {}, method: "inverse-vol" })
  })

  it("gives equal weights for equal vols", () => {
    const { weights } = inverseVolWeights({ A: 0.2, B: 0.2, C: 0.2 })
    expect(weights.A).toBeCloseTo(1 / 3, 2)
    expect(weights.B).toBeCloseTo(1 / 3, 2)
    expect(weights.C).toBeCloseTo(1 / 3, 2)
  })

  it("weights sum to 1 and higher vol gets lower weight", () => {
    const { weights } = inverseVolWeights({ Volatile: 0.1, Calm: 0.01 })
    const sum = Object.values(weights).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 3)
    expect(weights.Calm).toBeGreaterThan(weights.Volatile)
  })
})

describe("riskParity.equalRiskContribution", () => {
  it("distributes equally across independent (diagonal) assets", () => {
    const cov = [
      [0.04, 0, 0],
      [0, 0.04, 0],
      [0, 0, 0.04]
    ]
    const { weights, portfolioVol, riskContributions } = equalRiskContribution(cov, ["A", "B", "C"], 1000)
    expect(weights.A).toBeCloseTo(1 / 3, 2)
    expect(weights.B).toBeCloseTo(1 / 3, 2)
    expect(weights.C).toBeCloseTo(1 / 3, 2)
    expect(portfolioVol).toBeGreaterThan(0)
    expect(riskContributions).toHaveLength(3)
  })

  it("allocates less to a higher-variance asset so risk is equalized", () => {
    // Asset C dominates variance -> should get a smaller weight than A/B.
    const cov = [
      [0.01, 0, 0],
      [0, 0.01, 0],
      [0, 0, 0.15]
    ]
    const { weights } = equalRiskContribution(cov, ["A", "B", "C"], 2000)
    expect(weights.C).toBeLessThan(weights.A)
    expect(weights.C).toBeLessThan(weights.B)
  })

  it("guards against malformed input", () => {
    expect(equalRiskContribution([], [])).toEqual({
      weights: {},
      riskContributions: [],
      portfolioVol: 0
    })
    expect(equalRiskContribution(null, [])).toEqual({
      weights: {},
      riskContributions: [],
      portfolioVol: 0
    })
  })
})

describe("riskParity.riskParityAllocation", () => {
  it("returns error when no symbol has sufficient data", () => {
    const r = riskParityAllocation({ A: [1, 2, 3] }, { window: 60 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/data/)
  })

  it("returns single-asset allocation when only one symbol qualifies", () => {
    const long = Array.from({ length: 120 }, (_, i) => 100 + i)
    const r = riskParityAllocation({ A: long, B: [1, 2] }, { window: 60 })
    expect(r.ok).toBe(true)
    expect(r.weights.A).toBe(1)
    expect(r.method).toBe("single-asset")
  })

  it("computes inverse-vol weights summing to 1 across assets", () => {
    const histories = {}
    for (const base of [100, 80, 120]) {
      histories[`SYM${base}`] = Array.from({ length: 200 }, (_, i) =>
        base * (1 + 0.001 * Math.sin(i) + 0.0005 * i)
      )
    }
    const r = riskParityAllocation(histories, { window: 60, method: "inverse-vol" })
    expect(r.ok).toBe(true)
    const sum = Object.values(r.weights).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 2)
    expect(r.symbolCount).toBe(3)
  })

  it("computes equal-risk-contribution allocation from price series", () => {
    const histories = {}
    for (const base of [100, 80, 120]) {
      histories[`SYM${base}`] = Array.from({ length: 250 }, (_, i) =>
        base * (1 + 0.001 * Math.sin(i + base) + 0.0004 * i)
      )
    }
    const r = riskParityAllocation(histories, { window: 120, method: "erc" })
    expect(r.ok).toBe(true)
    const sum = Object.values(r.weights).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 2)
    expect(r.method).toBe("equal-risk-contribution")
    expect(r.portfolioVol).toBeGreaterThan(0)
  })
})
