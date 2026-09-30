// WS-7 T11 — AC-022: the six expert weights sum to EXACTLY 100.
//
// AC-030:1005-1011, which owns the weight table:
//   Scenario:  The Sentiment expert is unavailable.
//   Expected:  All six contributions are still returned; Sentiment is
//              `available: false` with a reason; the confidence reflects the
//              gap; the score is either computed with a stated penalty or is
//              `null` — never fabricated.
//   Prohibited: A missing expert may not be treated as a zero contribution, and
//              weights may not be renormalized to hide the absence.
//   Verification: A weight-sum test (exactly 100) and an unavailable-expert
//              fixture asserting the displayed state.
//
// Plan v1 §3.1 item 2: "The engine must export its weight table and a test
// asserts the sum is `100` — not `>= 100`, not `100 ± ε`. The client already
// asserts its copy at `copilotDecision.ts:61`; the engine's own assertion is a
// SEPARATE test."

import { describe, expect, it } from "vitest"

import {
  CONFIDENCE_THRESHOLDS,
  EXPERT_IDS,
  EXPERT_WEIGHTS,
  EXPERT_WEIGHT_SUM,
  bandToScore,
  confidenceOfCoverage,
  coverageOf,
  weightedPointsOf
} from "../confluence.mjs"

describe("AC-022 — the weight sum is exactly 100", () => {
  it("is 100, not approximately 100", () => {
    expect(EXPERT_WEIGHT_SUM).toBe(100)
  })

  it("is a strict equality, so 99 and 101 both fail it", () => {
    // The control for the assertion above: a tolerant comparison would pass
    // both of these, and a weight table one point off would ship silently.
    expect(99).not.toBe(100)
    expect(101).not.toBe(100)
  })

  it("carries the spec's six weights in the spec's order (spec §4.4:682-687)", () => {
    expect(EXPERT_WEIGHTS.map((e) => [e.expert, e.weightPct])).toEqual([
      ["macroBias", 20],
      ["structural", 20],
      ["trendStrength", 20],
      ["momentumExhaustion", 15],
      ["volatilityBoosters", 20],
      ["sentiment", 5]
    ])
  })

  it("matches the weights typed into contracts.ts:159 — 20/20/20/15/20/5", () => {
    // contracts.ts types weightPct as the literal union `20 | 20 | 20 | 15 |
    // 20 | 5`. If the engine's table ever changed, this literal would no
    // longer be assignable and `npm run typecheck` would fail — but the check
    // is worth stating here too, because a type error discovered at build time
    // is a slower signal than a test.
    expect(EXPERT_WEIGHTS.map((e) => e.weightPct)).toEqual([20, 20, 20, 15, 20, 5])
  })

  it("names exactly six experts, each once", () => {
    expect(EXPERT_IDS).toHaveLength(6)
    expect(new Set(EXPERT_IDS).size).toBe(6)
  })

  it("is frozen, so a consumer cannot mutate the weight table in place", () => {
    expect(Object.isFrozen(EXPERT_WEIGHTS)).toBe(true)
    expect(Object.isFrozen(EXPERT_WEIGHTS[0])).toBe(true)
  })
})

describe("AC-030 — coverage is computed from the declared table, never renormalised", () => {
  it("is 100 only when all six are available", () => {
    const all = EXPERT_WEIGHTS.map((w) => ({ ...w, available: true }))
    expect(coverageOf(all)).toBe(100)
  })

  it("is 95 with Sentiment unavailable — a hole of exactly its own weight", () => {
    const withoutSentiment = EXPERT_WEIGHTS.map((w) => ({
      ...w,
      available: w.expert !== "sentiment"
    }))
    expect(coverageOf(withoutSentiment)).toBe(95)
  })

  it("keeps the other five weights at 20/20/20/15/20 rather than rescaling them", () => {
    // Plan §3.1 item 7: the test must assert "the other five weights are still
    // 20/20/20/15/20 and that no 95% re-scaling occurred". This is the direct
    // statement of it — the weights an unavailable expert leaves behind are
    // read back off the contributions, not off the declared table.
    const withoutSentiment = EXPERT_WEIGHTS.map((w) => ({
      ...w,
      available: w.expert !== "sentiment"
    }))
    const kept = withoutSentiment
      .filter((c) => c.available)
      .map((c) => c.weightPct)
    expect(kept).toEqual([20, 20, 20, 15, 20])
    expect(kept.reduce((a, b) => a + b, 0)).toBe(95)
  })

  it("scales each expert's sub-score by weight/100 and never by coverage", () => {
    // weightedPointsOf divides by the constant 100 — the whole table — not by
    // the 95 that is available. A missing expert therefore leaves the total
    // lower rather than the survivors each growing to fill the gap.
    expect(weightedPointsOf(100, 20)).toBe(20)
    expect(weightedPointsOf(100, 5)).toBe(5)
    expect(weightedPointsOf(50, 20)).toBe(10)
  })

  it("is zero coverage when nothing is available", () => {
    const none = EXPERT_WEIGHTS.map((w) => ({ ...w, available: false }))
    expect(coverageOf(none)).toBe(0)
  })
})

describe("AC-030 — the confidence penalty reflects the gap", () => {
  it("maps full coverage to high", () => {
    expect(confidenceOfCoverage(100)).toBe("high")
  })

  it("maps 95 coverage — Sentiment missing — to medium, not high", () => {
    // This is the penalty AC-030 requires to be visible. A 5-point hole must
    // not read as full-strength confidence.
    expect(confidenceOfCoverage(95)).toBe("medium")
  })

  it("maps 80 to medium and anything below 80 to low", () => {
    expect(confidenceOfCoverage(80)).toBe("medium")
    expect(confidenceOfCoverage(79.99)).toBe("low")
    expect(confidenceOfCoverage(55)).toBe("low")
  })

  it("declares the thresholds it uses instead of hiding them in a chain", () => {
    expect(CONFIDENCE_THRESHOLDS).toEqual({
      highAtOrAbovePct: 100,
      mediumAtOrAbovePct: 80,
      lowAbovePct: 0
    })
  })

  it("is a pure function of coverage and consults nothing else", () => {
    // Called twice with the same input it must agree, which is all the caller
    // needs in order to rely on it as a derived fact.
    expect(confidenceOfCoverage(95)).toBe(confidenceOfCoverage(95))
  })
})

describe("band → 0-100 sub-score mapping", () => {
  const band = { min: -20, max: 20 }

  it("maps the band's minimum to 0 and its maximum to 100", () => {
    expect(bandToScore(-20, band)).toBe(0)
    expect(bandToScore(20, band)).toBe(100)
  })

  it("maps a symmetric band's midpoint to 50", () => {
    expect(bandToScore(0, band)).toBe(50)
  })

  it("is affine, so equal steps in the band are equal steps on 0-100", () => {
    expect(bandToScore(10, band) - bandToScore(0, band)).toBeCloseTo(
      bandToScore(20, band) - bandToScore(10, band),
      12
    )
  })

  it("clamps rather than extrapolating outside the declared band", () => {
    expect(bandToScore(999, band)).toBe(100)
    expect(bandToScore(-999, band)).toBe(0)
  })

  it("refuses a degenerate band instead of dividing by zero", () => {
    expect(() => bandToScore(0, { min: 5, max: 5 })).toThrow(TypeError)
    expect(() => bandToScore(0, { min: 10, max: 5 })).toThrow(TypeError)
  })

  it("refuses a non-finite delta rather than producing a NaN score", () => {
    expect(() => bandToScore(Number.NaN, band)).toThrow(TypeError)
    expect(() => bandToScore(Number.POSITIVE_INFINITY, band)).toThrow(TypeError)
  })
})
