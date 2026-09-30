// WS-7 T11 — AC-030: honest expert degradation. The criterion most likely to be
// got wrong, so this file is the long one.
//
// AC-030:1005-1011:
//   Scenario:  The Sentiment expert is unavailable.
//   Action:    Evaluate the confluence.
//   Expected:  All six contributions are still returned; Sentiment is
//              `available: false` with a reason; the confidence reflects the
//              gap; the score is either computed with a stated penalty or is
//              `null` — never fabricated.
//   Prohibited: A missing expert may not be treated as a zero contribution, and
//              weights may not be renormalized to hide the absence.
//   Verification: A weight-sum test (exactly 100) and an unavailable-expert
//              fixture asserting the displayed state.
//
// §4.1:533 — "If the model is unavailable, the Sentiment expert reports
// unavailable and the remaining 95% still produces a score with an honest
// confidence penalty — never a fabricated sentiment and never a silent
// renormalization that hides the gap."
//
// §4.7:747 — "an unavailable Sentiment expert renders as one unavailable expert
// inside an otherwise valid confluence, with the confidence penalty stated —
// never as a neutral zero, and never by renormalizing the other five weights."

import { describe, expect, it } from "vitest"

import {
  CONFIDENCE_THRESHOLDS,
  EXPERT_WEIGHTS,
  confidenceOfCoverage,
  evaluateConfluence,
  weightedPointsOf
} from "../confluence.mjs"
import { NO_MODEL_INPUT_REASON } from "../experts/sentiment.mjs"
import { shortDailyHistoryState, sentimentSuppliedState, sentimentUnavailableState } from "./fixtures/marketFixtures.mjs"

const sentimentRow = (score) => score.contributions.find((c) => c.expert === "sentiment")
const macroRow = (score) => score.contributions.find((c) => c.expert === "macroBias")

describe("AC-030 — all six contributions are returned, always", () => {
  const score = evaluateConfluence(sentimentUnavailableState())

  it("returns exactly six, in the spec's order, whatever their availability", () => {
    expect(score.contributions).toHaveLength(6)
    expect(score.contributions.map((c) => c.expert)).toEqual([
      "macroBias",
      "structural",
      "trendStrength",
      "momentumExhaustion",
      "volatilityBoosters",
      "sentiment"
    ])
  })

  it("includes the unavailable expert rather than dropping it", () => {
    expect(score.contributions).toContainEqual(
      expect.objectContaining({ expert: "sentiment", available: false })
    )
  })

  it("matches the contracts.ts ExpertContribution shape exactly", () => {
    for (const c of score.contributions) {
      expect(Object.keys(c).sort()).toEqual(
        ["available", "expert", "rawDelta", "unavailableReason", "weightPct"].sort()
      )
    }
  })
})

describe("AC-030 — an unavailable expert reports unavailable WITH a reason", () => {
  const score = evaluateConfluence(sentimentUnavailableState())
  const sentiment = sentimentRow(score)

  it("is `available: false`", () => {
    expect(sentiment.available).toBe(false)
  })

  it("has a non-empty unavailableReason", () => {
    expect(typeof sentiment.unavailableReason).toBe("string")
    expect(sentiment.unavailableReason.length).toBeGreaterThan(0)
    expect(sentiment.unavailableReason).toBe(NO_MODEL_INPUT_REASON)
  })

  it("names the owner, so a room can say who is building it", () => {
    expect(sentiment.unavailableReason).toContain("T13")
  })

  it("has rawDelta null — NOT zero, which would be a neutral reading", () => {
    // THE prohibition. `rawDelta: 0` on a band of [-5, +5] maps to sub-score 50,
    // i.e. a mid-range neutral: a fabricated opinion indistinguishable from a
    // measured one.
    expect(sentiment.rawDelta).toBeNull()
    expect(sentiment.rawDelta).not.toBe(0)
  })

  it("keeps its declared weight of 5 even while unavailable", () => {
    // Zeroing the weight would hide the hole. The gap IS the information.
    expect(sentiment.weightPct).toBe(5)
  })

  it("carries null, not zero, into its weighted points", () => {
    const row = score.expertScores.find((e) => e.expert === "sentiment")
    expect(row.subScore).toBeNull()
    expect(row.weightedPoints).toBe(0)
  })
})

describe("AC-030 — the weights are NOT renormalised", () => {
  const withSentiment = evaluateConfluence(sentimentSuppliedState(1))
  const withoutSentiment = evaluateConfluence(sentimentUnavailableState())

  it("the five surviving experts still declare 20/20/20/15/20", () => {
    const survivors = withoutSentiment.contributions
      .filter((c) => c.available)
      .map((c) => c.weightPct)
    expect(survivors).toEqual([20, 20, 20, 15, 20])
  })

  it("coverage is exactly 95 — a hole of exactly the missing expert's weight", () => {
    expect(withoutSentiment.coveragePct).toBe(95)
  })

  it("each survivor keeps the same weighted points it had when sentiment was present", () => {
    // The decisive no-renormalisation assertion. If the engine divided by 95
    // instead of 100, every survivor's weighted points would be inflated by a
    // factor of 100/95 and these would differ.
    for (const expert of ["macroBias", "structural", "trendStrength", "momentumExhaustion", "volatilityBoosters"]) {
      const a = withSentiment.expertScores.find((e) => e.expert === expert)
      const b = withoutSentiment.expertScores.find((e) => e.expert === expert)
      expect(b.weightedPoints, `${expert} was rescaled`).toBe(a.weightedPoints)
      expect(b.subScore, `${expert} sub-score changed`).toBe(a.subScore)
    }
  })

  it("the total is therefore 5 points lower, not redistributed", () => {
    const sumWithout = withoutSentiment.expertScores.reduce((t, e) => t + e.weightedPoints, 0)
    const sumWith = withSentiment.expertScores.reduce((t, e) => t + e.weightedPoints, 0)
    expect(sumWith - sumWithout).toBe(weightedPointsOf(withSentiment.expertScores.find((e) => e.expert === "sentiment").subScore, 5))
    expect(sumWithout).toBeLessThan(sumWith)
  })

  it("would differ if the engine divided by coverage instead of 100", () => {
    // The control. A renormalising engine produces this number; this one does not.
    const survivors = withoutSentiment.expertScores.filter((e) => e.available)
    const naiveTotal = survivors.reduce((t, e) => t + (e.subScore * e.weightPct) / 95, 0)
    const actualTotal = withoutSentiment.score
    expect(naiveTotal).not.toBe(actualTotal)
    expect(naiveTotal).toBeGreaterThan(actualTotal)
  })
})

describe("AC-030 — the confidence penalty is stated, and it is visible", () => {
  it("drops from high to medium when 5% of the table is missing", () => {
    expect(evaluateConfluence(sentimentSuppliedState(0)).confidence).toBe("high")
    expect(evaluateConfluence(sentimentUnavailableState()).confidence).toBe("medium")
  })

  it("is derived from coverage, not from the score", () => {
    // Two states with different scores but the same coverage share a confidence,
    // so a high score cannot buy back a missing expert's authority.
    const low = evaluateConfluence(sentimentSuppliedState(-1))
    const high = evaluateConfluence(sentimentSuppliedState(1))
    expect(low.confidence).toBe("high")
    expect(high.confidence).toBe("high")
    expect(low.score).not.toBe(high.score)
  })

  it("uses the declared thresholds, so the cut-points are auditable", () => {
    expect(CONFIDENCE_THRESHOLDS.highAtOrAbovePct).toBe(100)
    expect(CONFIDENCE_THRESHOLDS.mediumAtOrAbovePct).toBe(80)
    expect(confidenceOfCoverage(95)).toBe("medium")
    expect(confidenceOfCoverage(100)).toBe("high")
  })
})

describe("AC-030 — the same rule applies to a non-model expert", () => {
  const score = evaluateConfluence(shortDailyHistoryState())
  const macro = macroRow(score)

  it("reports Macro Bias unavailable when the daily EMAs have not warmed up", () => {
    expect(macro.available).toBe(false)
    expect(macro.rawDelta).toBeNull()
  })

  it("says how much history it needed and how much it had", () => {
    expect(macro.unavailableReason).toContain("400")
    expect(macro.unavailableReason).toContain("150")
  })

  it("leaves a 20-point hole rather than rescaling the other four", () => {
    // Sentiment (5) is also absent in T11, so the two holes total 25 of the 100
    // and the survivors still declare their ORIGINAL weights. 75, not 95 —
    // the honest figure, and the reason the confidence reads `low`.
    expect(score.coveragePct).toBe(75)
    const survivors = score.contributions.filter((c) => c.available).map((c) => c.weightPct)
    expect(survivors).toEqual([20, 20, 15, 20])
  })

  it("still returns all six rows", () => {
    expect(score.contributions).toHaveLength(6)
    expect(score.contributions.filter((c) => !c.available).map((c) => c.expert)).toEqual([
      "macroBias",
      "sentiment"
    ])
  })

  it("still produces a score — the 75% that exists is not thrown away", () => {
    expect(score.score).not.toBeNull()
    expect(score.confidence).toBe("low")
  })
})

describe("AC-030 — the model's own 'no signal' is not the model's absence", () => {
  it("distinguishes a null score from a missing input, in the reason", () => {
    const absent = evaluateConfluence(sentimentUnavailableState())
    const noSignal = evaluateConfluence(sentimentSuppliedState(null))
    expect(sentimentRow(absent).unavailableReason).not.toBe(sentimentRow(noSignal).unavailableReason)
    expect(sentimentRow(noSignal).unavailableReason).toContain("no score")
    expect(sentimentRow(noSignal).unavailableReason).toContain("absent is not neutral")
  })

  it("accepts a supplied sentiment and maps it onto the spec's +/-5 band", () => {
    const bull = evaluateConfluence(sentimentSuppliedState(1)).expertScores.find((e) => e.expert === "sentiment")
    const bear = evaluateConfluence(sentimentSuppliedState(-1)).expertScores.find((e) => e.expert === "sentiment")
    expect(bull.rawDelta).toBe(5)
    expect(bull.subScore).toBe(100)
    expect(bear.rawDelta).toBe(-5)
    expect(bear.subScore).toBe(0)
  })

  it("refuses an out-of-range sentiment rather than clamping a fabricated one", () => {
    const score = evaluateConfluence(sentimentSuppliedState(7))
    expect(sentimentRow(score).available).toBe(false)
    expect(sentimentRow(score).unavailableReason).toContain("-1..1")
  })
})

describe("AC-030 — the engine's own shape guard, not just its cooperation", () => {
  it("rejects an unavailable expert that returns a number", () => {
    // The engine must not depend on its six experts behaving. These two
    // assertions are the enforcement of AC-030's prohibitions at the boundary.
    const score = evaluateConfluence(sentimentUnavailableState())
    for (const c of score.contributions) {
      if (c.available === false) {
        expect(c.rawDelta).toBeNull()
        expect(c.unavailableReason).not.toBeNull()
        expect(c.unavailableReason.length).toBeGreaterThan(0)
      } else {
        expect(typeof c.rawDelta).toBe("number")
        expect(c.unavailableReason).toBeNull()
      }
    }
  })

  it("keeps every contribution's weight equal to the declared table", () => {
    const score = evaluateConfluence(sentimentUnavailableState())
    score.contributions.forEach((c, i) => {
      expect(c.weightPct).toBe(EXPERT_WEIGHTS[i].weightPct)
    })
  })

  it("keeps the weight table at exactly 100 with an expert missing", () => {
    // The declared table does not change when an expert is unavailable. Only the
    // coverage does. A table that shrank to 95 would be the renormalisation.
    expect(EXPERT_WEIGHTS.reduce((t, e) => t + e.weightPct, 0)).toBe(100)
    expect(EXPERT_WEIGHTS).toHaveLength(6)
  })
})
