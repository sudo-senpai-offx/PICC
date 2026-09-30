// WS-7 T12 — C1: the ADX-lag conflict resolution. AC-027.
//
// §4.4:699 — "**C1 — ADX lag vs scoring.** When Booster1 **and** Booster2 both
// fire, disable the ADX penalty and set `Trend_Score` to max for the next 5
// candles. Rationale: ADX lags; BBW and the 20/50 cross lead."
//
// AC-027 (:981-987) is the binding criterion:
//   Scenario:  Booster1 and Booster2 both fire on a candle.
//   Action:    Evaluate trend strength across seven candles.
//   Expected:  The ADX penalty is disabled and `Trend_Score` is set to max for
//              exactly the next 5 candles, then the override expires.
//   Prohibited: The override may not be permanent, and it may not fire when
//               only one booster fires.
//   Verification: A 7-candle fixture asserting override on candles 1–5 and
//               expiry on 6.
//   Priority:  P0.
//
// THE SEVEN CANDLES. AC-027's verification is a 7-candle fixture with the
// override on candles 1–5 and expired on candle 6. The window is therefore five
// candles wide and the anchor is the trigger candle itself: §4.4:699 says "for
// the next 5 candles", and AC-027's own scenario puts both boosters firing on
// a candle *inside* the fixture. Anchoring on the trigger (offsets 0–4) is what
// makes "override on candles 1–5, expiry on 6" true of a single fixture, and it
// is the reading that is safest: the bar on which two leading indicators both
// fire is exactly the bar on which ADX is most likely to lag. The anchor is a
// named constant (`WINDOW_ANCHOR`) rather than an unstated assumption, and the
// exclusive form (offsets 1–5) is asserted to behave identically for every
// other input, so a reader can see precisely what the choice is and is not.

import { describe, expect, it } from "vitest"

import { EXPERT_WEIGHTS, evaluateConfluence } from "../confluence.mjs"
import { BAND as TREND_BAND, WEIGHT_PCT as TREND_WEIGHT } from "../experts/trendStrength.mjs"
import { BOOSTER_IDS, BOOSTER_LEG_KEYS } from "../experts/volatilityBoosters.mjs"
import * as volatilityBoosters from "../experts/volatilityBoosters.mjs"
import {
  C1_RULE,
  WINDOW_ANCHOR,
  c1WindowAt,
  createC1WindowTracker,
  evaluateC1,
  observeDualBooster,
  observeTrend
} from "../conflicts/c1AdxLagging.mjs"
import { deriveMarketState } from "../marketState.mjs"
import {
  ADX_LAGGING_TRIGGER_INDEX,
  adxLaggingState,
  assertFixtureGeometry,
  singleBoosterState
} from "./fixtures/conflictFixtures.mjs"

const bothBoosters = ["booster1EmaCross", "booster2BbwExpanding"]

describe("T12 fixtures — the market shapes the AC-027/028 cases describe", () => {
  it("still describe those shapes, or it throws with a named reason", () => {
    const fired = (state) => {
      const r = volatilityBoosters.evaluate(state, { regime: "londonTrend" })
      return { booster1: r.legs.booster1.fired, booster2: r.legs.booster2.fired }
    }
    expect(assertFixtureGeometry(fired)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// THE `activeBoosters` DEFECT T12 DEPENDS ON
// ---------------------------------------------------------------------------
//
// §4.3:618 puts `activeBoosters: string[]` on the score, and C1's condition is
// specified in those terms (§4.4:699, "When Booster1 **and** Booster2 both
// fire"). T11's `activeBoostersOf` indexed the `legs` object with
// `BOOSTER_IDS` while `legs` is keyed `booster1`…`booster4`, so every lookup was
// `undefined` and the array was ALWAYS `[]` — `ConfluenceScore.activeBoosters`
// could never name a booster, and AC-027 was unimplementable.
//
// The fix introduced `BOOSTER_LEG_KEYS` as data. These tests pin the
// correspondence in BOTH directions, so a rename on either side fails here
// instead of silently emptying the array again.

describe("`activeBoosters` can actually name a booster (the defect T12 found)", () => {
  const state = deriveMarketState(adxLaggingState())

  it("maps every declared booster id to a leg that exists", () => {
    for (const id of BOOSTER_IDS) {
      const legKey = BOOSTER_LEG_KEYS[id]
      expect(legKey, `${id} has no leg key`).toBeTypeOf("string")
    }
    expect(Object.keys(BOOSTER_LEG_KEYS).sort()).toEqual([...BOOSTER_IDS].sort())
  })

  it("reports the boosters that actually fired, on a bar where two did", () => {
    const result = volatilityBoosters.evaluate(state, { regime: "londonTrend" })
    const active = volatilityBoosters.activeBoostersOf(result)
    expect(active).toEqual(expect.arrayContaining(["booster1EmaCross", "booster2BbwExpanding"]))
    expect(active).not.toEqual([])
  })

  it("agrees with the legs it reports, booster for booster", () => {
    const result = volatilityBoosters.evaluate(state, { regime: "londonTrend" })
    const active = volatilityBoosters.activeBoostersOf(result)
    for (const id of BOOSTER_IDS) {
      const fired = result.legs[BOOSTER_LEG_KEYS[id]]?.fired === true
      expect(active.includes(id), `${id} reported=${active.includes(id)} legs=${fired}`).toBe(fired)
    }
  })

  it("reaches the confluence's own `activeBoosters`, so a score is self-describing", () => {
    const c = evaluateConfluence(adxLaggingState())
    expect(c.activeBoosters).toEqual(expect.arrayContaining(["booster1EmaCross", "booster2BbwExpanding"]))
  })

  it("would have caught the defect: the ids and the leg keys are not the same words", () => {
    // The control. If a future refactor "simplified" these to one vocabulary,
    // this fails and the mapping is re-examined rather than assumed harmless.
    for (const id of BOOSTER_IDS) {
      expect(BOOSTER_LEG_KEYS[id], `${id} is spelled differently from its leg key`).not.toBe(id)
    }
  })
})

describe("C1 is a NAMED, VERSIONED rule", () => {
  it("carries the spec's own id, a ruleVersion, and its window", () => {
    expect(C1_RULE.id).toBe("C1")
    expect(C1_RULE.ruleId).toBe("copilot.conflict.c1AdxLagging")
    expect(C1_RULE.ruleVersion).toMatch(/^copilot-conflict-c1AdxLagging\/\d+\.\d+\.\d+$/)
    expect(C1_RULE.windowCandles).toBe(5)
  })

  it("names the two boosters that must BOTH fire, and they are the spec's", () => {
    expect([...C1_RULE.triggerBoosters]).toEqual(bothBoosters)
    for (const id of C1_RULE.triggerBoosters) {
      expect(BOOSTER_IDS, `${id} must be one of the four declared boosters`).toContain(id)
    }
  })

  it("is frozen, so a caller cannot widen its own window", () => {
    expect(Object.isFrozen(C1_RULE)).toBe(true)
    expect(Object.isFrozen(C1_RULE.triggerBoosters)).toBe(true)
  })

  it("targets the Trend & Strength expert, reusing T11's declared weight", () => {
    // Risk 6: a second copy of an expert's weight is how a table drifts. C1 must
    // reach T11's number, not restate it.
    expect(C1_RULE.targetExpert).toBe("trendStrength")
    expect(EXPERT_WEIGHTS.find((e) => e.expert === "trendStrength").weightPct).toBe(TREND_WEIGHT)
  })

  it("sets Trend_Score to the trend expert's OWN band maximum, not an invented one", () => {
    // §4.4:684's band is [-10, +20] and "max" is +20. A hard-coded 20 would be a
    // second copy of the band; if the band moves, C1 must follow it.
    expect(C1_RULE.forcedRawDelta).toBe(TREND_BAND.max)
  })
})

describe("AC-027 — the 7-candle fixture: override on candles 1-5, expiry on 6", () => {
  const state = deriveMarketState(adxLaggingState())

  it("observes BOTH boosters firing on the fixture's last bar", () => {
    const observation = observeDualBooster(state)
    expect(observation.dualBoosterFired).toBe(true)
    expect([...observation.activeBoosters]).toEqual(expect.arrayContaining(bothBoosters))
  })

  it("maxes Trend_Score on candles 1 to 5 and lets it expire on candle 6", () => {
    // The fixture is anchored on the trigger bar, so candle N of the seven is
    // `triggerIndex + N - 1`.
    const verdicts = [1, 2, 3, 4, 5, 6, 7].map((n) => {
      const window = c1WindowAt({
        triggerIndex: ADX_LAGGING_TRIGGER_INDEX,
        candleIndex: ADX_LAGGING_TRIGGER_INDEX + n - 1
      })
      return evaluateC1({ observation: observeDualBooster(state), trend: observeTrend(state), window }).applied
    })

    expect(verdicts).toEqual([true, true, true, true, true, false, false])
  })

  it("counts the window from the trigger candle, and says so", () => {
    expect(WINDOW_ANCHOR).toBe("triggerCandleInclusive")
    const at0 = c1WindowAt({ triggerIndex: 10, candleIndex: 10 })
    expect(at0).toMatchObject({ active: true, candlesElapsed: 0, candlesRemaining: 5, expired: false })
  })

  it("reports candlesRemaining so a caller can show the window closing", () => {
    expect(c1WindowAt({ triggerIndex: 0, candleIndex: 4 }).candlesRemaining).toBe(1)
  })
})

describe("AC-027 — the prohibited side effects", () => {
  it("does NOT fire when only Booster1 fires", () => {
    const state = deriveMarketState(singleBoosterState())
    const observation = observeDualBooster(state)
    expect(observation.booster1Fired).toBe(true)
    expect(observation.booster2Fired).toBe(false)
    expect(observation.dualBoosterFired).toBe(false)

    const resolution = evaluateC1({
      observation,
      window: c1WindowAt({ triggerIndex: 78, candleIndex: 78 }),
      trend: observeTrend(state)
    })
    expect(resolution.applied).toBe(false)
    expect(resolution.status).toBe("notTriggered")
    expect(resolution.adjustments).toEqual([])
    // The ADX penalty must be left exactly as the engine read it.
    expect(resolution.adxPenaltyDisabled).toBe(false)
  })

  it("is not permanent: the same trigger yields nothing on candle 6", () => {
    const state = deriveMarketState(adxLaggingState())
    const observation = observeDualBooster(state)
    const resolution = evaluateC1({
      observation,
      window: c1WindowAt({ triggerIndex: ADX_LAGGING_TRIGGER_INDEX, candleIndex: ADX_LAGGING_TRIGGER_INDEX + 5 }),
      trend: observeTrend(state)
    })
    expect(resolution.applied).toBe(false)
    expect(resolution.status).toBe("expired")
    expect(resolution.window.expired).toBe(true)
  })

  it("never treats an EXPIRED window as active, even with both boosters firing", () => {
    // The anti-goal this exists for: an expiry that defaults to true.
    for (const offset of [5, 6, 7, 50]) {
      const w = c1WindowAt({ triggerIndex: 3, candleIndex: 3 + offset })
      expect(w.active, `offset ${offset} must not be active`).toBe(false)
      expect(w.expired).toBe(true)
    }
  })

  it("refuses a candle BEFORE the trigger rather than reading it as active", () => {
    const w = c1WindowAt({ triggerIndex: 10, candleIndex: 9 })
    expect(w.active).toBe(false)
    expect(w.notYetActive).toBe(true)
    expect(w.expired).toBe(false)
  })
})

describe("C1 — what it does to the score", () => {
  const raw = adxLaggingState()
  const state = deriveMarketState(raw)
  const trend = observeTrend(state)
  const resolution = evaluateC1({
    observation: observeDualBooster(state),
    window: c1WindowAt({ triggerIndex: ADX_LAGGING_TRIGGER_INDEX, candleIndex: ADX_LAGGING_TRIGGER_INDEX }),
    trend
  })

  it("disables the ADX penalty and maxes Trend_Score", () => {
    expect(resolution.applied).toBe(true)
    expect(resolution.adxPenaltyDisabled).toBe(true)
    expect(resolution.adjustments).toHaveLength(1)
    expect(resolution.adjustments[0]).toMatchObject({
      expert: "trendStrength",
      rule: "C1",
      rawDelta: TREND_BAND.max
    })
  })

  it("is applied to a bar where ADX genuinely has not caught up", () => {
    // §4.4:699's premise, made checkable. On the growing-amplitude family every
    // dual-booster bar already read `above-25-rising` with a trend sub-score of
    // 100, so C1's maxing was a no-op there and could only demonstrate that it
    // FIRES. This fixture is the case the rule was written for.
    expect(trend.adxLegState).toBe("below-threshold")
    expect(trend.subScore).toBeLessThan(100)
    expect(resolution.adxPenaltyWasActive).toBe(false)
  })

  it("RAISES the score, by exactly the gap the band maximum is worth, and no more", () => {
    const plain = evaluateConfluence(raw)
    const maxed = evaluateConfluence(raw, {
      adjustments: resolution.adjustments,
      conflictOverrides: ["C1"]
    })
    const trendPlain = plain.expertScores.find((e) => e.expert === "trendStrength")
    const trendMaxed = maxed.expertScores.find((e) => e.expert === "trendStrength")

    expect(trendMaxed.subScore).toBe(100)
    expect(trendMaxed.weightedPoints).toBe(TREND_WEIGHT)
    expect(maxed.score - plain.score).toBeCloseTo(trendMaxed.weightedPoints - trendPlain.weightedPoints, 10)
    for (const e of maxed.expertScores.filter((x) => x.expert !== "trendStrength")) {
      const before = plain.expertScores.find((x) => x.expert === e.expert)
      expect(e.weightedPoints, `${e.expert} must not move`).toBe(before.weightedPoints)
    }
  })

  it("records whether an ADX penalty actually existed to disable", () => {
    // A rule that claims to have disabled something that was not there would be
    // reporting a repair it did not make. The record says which.
    expect(typeof resolution.adxPenaltyWasActive).toBe("boolean")
    expect(resolution.inputs.adxLegState).not.toBeNull()
  })

  it("does not invent a weight: the adjustment carries no weight at all", () => {
    expect(resolution.adjustments[0].weightPct).toBeUndefined()
  })

  it("names the rule version on the adjustment, so a score is attributable", () => {
    expect(resolution.adjustments[0].ruleId).toBe("copilot.conflict.c1AdxLagging")
    expect(resolution.adjustments[0].ruleVersion).toBe(C1_RULE.ruleVersion)
    expect(resolution.adjustments[0].reason).toContain("C1")
  })
})

describe("C1 — independently disable-able", () => {
  it("produces no adjustment when told it is disabled, whatever the market says", () => {
    const state = deriveMarketState(adxLaggingState())
    const resolution = evaluateC1({
      observation: observeDualBooster(state),
      window: c1WindowAt({ triggerIndex: ADX_LAGGING_TRIGGER_INDEX, candleIndex: ADX_LAGGING_TRIGGER_INDEX }),
      trend: observeTrend(state),
      enabled: false
    })
    expect(resolution.status).toBe("disabled")
    expect(resolution.applied).toBe(false)
    expect(resolution.adjustments).toEqual([])
  })
})

describe("C1 — the window tracker is bookkeeping, not a decision", () => {
  it("records trigger bars and answers the same pure window the tests pin", () => {
    const tracker = createC1WindowTracker()
    const state = deriveMarketState(adxLaggingState())

    tracker.observe({ candleIndex: 3, observation: observeDualBooster(state) })
    expect(tracker.hasTriggerAt(3)).toBe(true)

    // The tracker's answer IS `c1WindowAt`'s — the same function, no second
    // expiry arithmetic that could drift from the one under test.
    const w = tracker.windowAt(5)
    expect(w).toEqual(c1WindowAt({ triggerIndex: 3, candleIndex: 5, windowCandles: w.windowCandles }))
    expect(w.active).toBe(true)
    expect(tracker.windowAt(8).active).toBe(false)
  })

  it("keeps the MOST RECENT trigger, so a second dual-booster bar restarts the window", () => {
    const tracker = createC1WindowTracker()
    const state = deriveMarketState(adxLaggingState())
    tracker.observe({ candleIndex: 3, observation: observeDualBooster(state) })
    tracker.observe({ candleIndex: 4, observation: observeDualBooster(state) })
    expect(tracker.latestTriggerIndex).toBe(4)
    expect(tracker.windowAt(8).active).toBe(true)
    expect(tracker.windowAt(9).active).toBe(false)
  })

  it("records a single-booster bar as NOT a trigger", () => {
    const tracker = createC1WindowTracker()
    const state = deriveMarketState(singleBoosterState())
    tracker.observe({ candleIndex: 78, observation: observeDualBooster(state) })
    expect(tracker.hasTriggerAt(78)).toBe(false)
    expect(tracker.latestTriggerIndex).toBeNull()
  })

  it("never reports a trigger it was not given, and holds no clock", () => {
    const tracker = createC1WindowTracker()
    expect(tracker.latestTriggerIndex).toBeNull()
    expect(tracker.windowAt(0).active).toBe(false)
    // A default-true tracker is the anti-goal. An empty tracker opens nothing.
    expect(tracker.windowAt(0).triggerIndex).toBeNull()
  })
})
