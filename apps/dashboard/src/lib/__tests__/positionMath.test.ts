import { describe, expect, it } from "vitest"
import { computePositionSize, computeRiskReward, computeHalfKelly } from "@/lib/positionMath"

describe("computePositionSize", () => {
  it("round-trips a known long case (10000 / 2% / entry 1.1000 / stop 1.0900)", () => {
    const r = computePositionSize(10000, 2, 1.1, 1.09)
    expect(r).not.toBeNull()
    expect(r!.riskUsd).toBeCloseTo(200, 6)
    expect(r!.riskPerUnit).toBeCloseTo(0.01, 6)
    expect(r!.positionUnits).toBeCloseTo(20000, 2)
    expect(r!.notional).toBeCloseTo(22000, 2)
    expect(r!.stopPct).toBeCloseTo(0.909090909, 6)
  })

  it("handles a short mirror with the same magnitudes", () => {
    // entry below stop for a short: risk per unit identical regardless of direction
    const r = computePositionSize(10000, 2, 1.09, 1.1)
    expect(r).not.toBeNull()
    expect(r!.riskPerUnit).toBeCloseTo(0.01, 6)
    expect(r!.positionUnits).toBeCloseTo(20000, 2)
    expect(r!.notional).toBeCloseTo(21800, 2)
  })

  it("returns null when stop equals entry", () => {
    expect(computePositionSize(10000, 2, 1.1, 1.1)).toBeNull()
  })

  it("returns null for zero/negative inputs", () => {
    expect(computePositionSize(0, 2, 1.1, 1.09)).toBeNull()
    expect(computePositionSize(10000, 0, 1.1, 1.09)).toBeNull()
    expect(computePositionSize(10000, 2, 0, 1.09)).toBeNull()
    expect(computePositionSize(10000, 2, 1.1, -1)).toBeNull()
    expect(computePositionSize(-100, 2, 1.1, 1.09)).toBeNull()
  })

  it("returns null for NaN inputs", () => {
    expect(computePositionSize(NaN, 2, 1.1, 1.09)).toBeNull()
    expect(computePositionSize(10000, NaN, 1.1, 1.09)).toBeNull()
    expect(computePositionSize(10000, 2, NaN, 1.09)).toBeNull()
  })
})

describe("computeRiskReward", () => {
  it("computes R:R for a long setup", () => {
    const r = computeRiskReward(1.1, 1.09, 1.13)
    expect(r).not.toBeNull()
    expect(r!.riskPerUnit).toBeCloseTo(0.01, 6)
    expect(r!.rewardPerUnit).toBeCloseTo(0.03, 6)
    expect(r!.rR).toBeCloseTo(3, 6)
  })

  it("computes R:R for a short setup (target below entry)", () => {
    // risk |1.1-1.12=0.02|, reward |1.1-1.04=0.06| → 3R
    const r = computeRiskReward(1.1, 1.12, 1.04)
    expect(r).not.toBeNull()
    expect(r!.rR).toBeCloseTo(3, 6)
  })

  it("returns null when stop equals entry", () => {
    expect(computeRiskReward(1.1, 1.1, 1.13)).toBeNull()
  })

  it("returns null when target equals entry", () => {
    expect(computeRiskReward(1.1, 1.09, 1.1)).toBeNull()
  })

  it("returns null for zero/negative/NaN inputs", () => {
    expect(computeRiskReward(0, 1.09, 1.13)).toBeNull()
    expect(computeRiskReward(1.1, 0, 1.13)).toBeNull()
    expect(computeRiskReward(1.1, 1.09, 0)).toBeNull()
    expect(computeRiskReward(NaN, 1.09, 1.13)).toBeNull()
    expect(computeRiskReward(1.1, -1, 1.13)).toBeNull()
  })
})

describe("computeHalfKelly", () => {
  it("computes half-Kelly from corpus example (W=0.55, R=1.5 → 0.125)", () => {
    expect(computeHalfKelly(0.55, 1.5)).toBeCloseTo(0.125, 6)
  })

  it("accepts win rate as a percent (55 → same as 0.55)", () => {
    expect(computeHalfKelly(55, 1.5)).toBeCloseTo(0.125, 6)
  })

  it("computes W=0.5 R=2 → 0.125", () => {
    expect(computeHalfKelly(0.5, 2)).toBeCloseTo(0.125, 6)
  })

  it("returns null when win/loss ratio <= 0", () => {
    expect(computeHalfKelly(0.55, 0)).toBeNull()
    expect(computeHalfKelly(0.55, -1)).toBeNull()
  })

  it("returns null when W is 1 or 0 (or outside (0,1) exclusive)", () => {
    expect(computeHalfKelly(1, 1.5)).toBeNull()
    expect(computeHalfKelly(0, 1.5)).toBeNull()
    expect(computeHalfKelly(-0.1, 1.5)).toBeNull()
    expect(computeHalfKelly(NaN, 1.5)).toBeNull()
  })

  it("never returns a negative fraction", () => {
    // W=0.3, R=1 → 0.3 - 0.7 = -0.4 → clamped to 0
    expect(computeHalfKelly(0.3, 1)).toBe(0)
  })
})
