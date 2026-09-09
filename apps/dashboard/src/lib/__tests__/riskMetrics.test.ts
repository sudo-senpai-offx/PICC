import { describe, expect, it } from "vitest"
import {
  calculateHistoricalVaR,
  calculateParametricVaR
} from "@railpath/finance-toolkit"
import { computeRiskMetrics, MIN_OBSERVATIONS } from "../riskMetrics"

// A 20-return per-trade series with known, hand-computed values.
// mean = 0.0235 (sum 0.47 / 20), sample std = 0.0566870448...
// Sharpe (per trade, rf=0) = mean / std = 0.4145568016
// Sortino (target 0) = mean / downsideDev = 0.8441449195
// Calmar = per-trade mean / maxDrawdown = 0.2937500000
// Historical VaR(95) = 0.06, Historical CVaR(95) = 0.07
const SERIES = [
  0.1, -0.05, 0.05, 0.02, -0.03, 0.08, -0.06, 0.04, 0.12, -0.02,
  0.07, 0.03, -0.08, 0.09, -0.04, 0.06, 0.02, 0.05, -0.01, 0.03
]

const EPS = 1e-9

describe("computeRiskMetrics wrapper", () => {
  it("returns null for fewer than MIN_OBSERVATIONS returns", () => {
    expect(MIN_OBSERVATIONS).toBe(20)
    expect(computeRiskMetrics(SERIES.slice(0, 19))).toBeNull()
    expect(computeRiskMetrics([])).toBeNull()
  })

  it("returns null for a degenerate (all-equal) series instead of NaN/Infinity", () => {
    const flat = new Array(MIN_OBSERVATIONS).fill(0.02)
    expect(computeRiskMetrics(flat)).toBeNull()
  })

  it("returns null when returns contain non-finite values", () => {
    const bad = [...SERIES]
    bad[3] = Number.NaN
    expect(computeRiskMetrics(bad)).toBeNull()
    const inf = [...SERIES]
    inf[1] = Number.POSITIVE_INFINITY
    expect(computeRiskMetrics(inf)).toBeNull()
  })

  it("returns null when the compounded price path is non-positive", () => {
    const crash = [...SERIES]
    crash[0] = -1.5 // pushes price <= 0 immediately
    expect(computeRiskMetrics(crash)).toBeNull()
  })

  it("never returns NaN or Infinity for a valid series", () => {
    const r = computeRiskMetrics(SERIES)
    expect(r).not.toBeNull()
    if (!r) return
    const allNums = [
      r.n, r.historicalVaR, r.historicalCVaR, r.parametricVaR, r.parametricCVaR,
      r.monteCarloVaR, r.sharpe, r.sortino, r.calmar, r.maxDrawdownPct
    ]
    for (const v of allNums) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it("reports the per-trade Sharpe/Sortino/Calmar exactly (hand-computed)", () => {
    const r = computeRiskMetrics(SERIES)
    expect(r).not.toBeNull()
    if (!r) return
    expect(r.n).toBe(20)
    expect(r.sharpe).toBeCloseTo(0.41455680158580577, EPS)
    expect(r.sortino).toBeCloseTo(0.844144919525842, EPS)
    expect(r.calmar).toBeCloseTo(0.29375000000000023, EPS)
    expect(r.maxDrawdownPct).toBeCloseTo(7.999999999999993, 12)
  })

  it("reports historical VaR/CVaR as positive losses (-> %)", () => {
    const r = computeRiskMetrics(SERIES)
    expect(r).not.toBeNull()
    if (!r) return
    expect(r.historicalVaR).toBeCloseTo(0.06, 12)
    expect(r.historicalCVaR).toBeCloseTo(0.07, 12)
    expect(r.historicalVaR).toBeGreaterThan(0)
    expect(r.historicalCVaR).toBeGreaterThan(0)
  })

  it("keeps the CVaR >= VaR convention for the wrapper's own 95% output", () => {
    const r = computeRiskMetrics(SERIES)
    expect(r).not.toBeNull()
    if (!r) return
    expect(r.historicalCVaR).toBeGreaterThanOrEqual(r.historicalVaR)
    expect(r.parametricCVaR).toBeGreaterThanOrEqual(r.parametricVaR)
  })

  it("produces Monte-Carlo VaR as a finite positive number (not pinned)", () => {
    const r = computeRiskMetrics(SERIES)
    expect(r).not.toBeNull()
    if (!r) return
    expect(typeof r.monteCarloVaR).toBe("number")
    expect(Number.isFinite(r.monteCarloVaR)).toBe(true)
    expect(r.monteCarloVaR).toBeGreaterThan(0)
  })
})

describe("toolkit VaR/CVaR conventions", () => {
  it("VaR(99) >= VaR(95) and cvar >= value for both methods", () => {
    for (const method of [calculateHistoricalVaR, calculateParametricVaR]) {
      const v95 = method(SERIES, 0.95)
      const v99 = method(SERIES, 0.99)
      expect(v99.value).toBeGreaterThanOrEqual(v95.value)
      expect(v95.cvar).toBeGreaterThanOrEqual(v95.value)
      expect(v99.cvar).toBeGreaterThanOrEqual(v99.value)
      // positive-loss side
      expect(v95.value).toBeGreaterThan(0)
      expect(v99.value).toBeGreaterThan(0)
    }
  })

  it("historical VaR/CVaR increase on a loss-heavy series", () => {
    // Same volatility, but losses dominate -> larger tail losses.
    const lossHeavy = SERIES.map((r) => -Math.abs(r))
    const base = calculateHistoricalVaR(SERIES, 0.95)
    const heavy = calculateHistoricalVaR(lossHeavy, 0.95)
    expect(heavy.value).toBeGreaterThan(base.value)
    expect(heavy.cvar).toBeGreaterThan(0)
  })
})
