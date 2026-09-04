import { describe, expect, test } from "vitest"
import {
  correlationMatrix,
  highlyCorrelated,
  diversificationScore
} from "../services/correlation.mjs"

describe("correlation utilities (audit §5.8 — dead code removed)", () => {
  test("correlationMatrix + highlyCorrelated flag true and false positives", () => {
    // Perfectly correlated (A vs B) and perfectly anti-correlated (A vs C) pairs.
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const b = a.map((v) => v * 2) // corr = +1 (log returns identical)
    const c = a.map((v) => 100 / v) // corr = -1 (log returns negated)
    const prices = { A: a, B: b, C: c }
    const res = correlationMatrix(prices)
    expect(res.ok).toBe(true)
    expect(res.symbols).toEqual(["A", "B", "C"])
    expect(res.matrix[0][1]).toBeCloseTo(1, 6)
    expect(res.matrix[0][2]).toBeCloseTo(-1, 6)

    const high = highlyCorrelated(prices, 0.8)
    // All three pairs clear |corr| = 1 ≥ 0.8.
    expect(high).toHaveLength(3)
    expect(high.every((p) => Math.abs(p.correlation) >= 0.8)).toBe(true)
  })

  test("diversificationScore rewards low correlation and penalizes concentration", () => {
    const equal = [0.5, 0.5]
    // Perfectly positively correlated pair → corrScore 0, concScore 0.5 → 0.2
    expect(diversificationScore(equal, [[1, 1], [1, 1]])).toBeCloseTo(0.2, 6)
    // Perfectly negatively correlated pair → corrScore 1, concScore 0.5 → 0.8
    expect(diversificationScore(equal, [[1, -1], [-1, 1]])).toBeCloseTo(0.8, 6)
    // Concentrated single asset → concScore 0; corrScore 0.5 (no pair evidence)
    expect(diversificationScore([1], [[1]])).toBeCloseTo(0.3, 6)
    // Degenerate inputs never throw and score 0
    expect(diversificationScore([], [])).toBe(0)
    expect(diversificationScore([0.5, 0.5], null)).toBe(0)
  })
})
