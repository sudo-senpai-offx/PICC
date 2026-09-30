// WS-7 T12 — C3: the hypertrend weight reallocation. AC-029.
//
// §4.4:701 — "**C3 — Hypertrend vs macro bias.** When `regime == hypertrend`,
// temporarily reduce Macro Bias weight from 20% to **0%**, because a 4H wall is
// irrelevant in a 1–3 minute high-velocity window. The reallocation has a stated
// window and expires; it is not sticky."
//
// AC-029 (:997-1003) is the binding criterion:
//   Scenario:  `regime == hypertrend`.
//   Action:    Evaluate the confluence before, during, and after the window.
//   Expected:  Macro Bias weight is 0% for the window; the remaining weights
//              are used as declared; on regime exit the 20% weight returns.
//   Prohibited: The reallocation may not be permanent, and it may not silently
//               renormalize in a way that hides the change.
//   Verification: A weight-snapshot assertion across the three states; the
//               displayed weights must show the reallocation.
//   Priority:  P0.
//
// R9.3 (:432) — "C3 … is a temporary weight reallocation with a stated window".
//
// ---------------------------------------------------------------------------
// THE STATED WINDOW IS THE REGIME, AND THAT IS NOT A FIGURE THE SPEC OMITS
// ---------------------------------------------------------------------------
//
// §4.4:701 requires "a stated window" and says it "expires". It gives no candle
// count, and it does not need one: the window OPENS when the regime classifier
// says `hypertrend` and CLOSES when it stops saying so. C3 is therefore scoped to
// a STATE, not to a span of bars, and its expiry is derived from the same
// classifier the regime itself comes from — never from a counter, a timer, or a
// remembered flag. That is what makes "it is not sticky" a structural property
// rather than a promise: there is nothing in the module that could keep it open.
//
// The `window` record on the resolution states the anchor (`"regimeWindow"`)
// and the expiry condition (`"regimeExit"`), so a caller rendering the rule can
// see the mechanism rather than infer it.
//
// ---------------------------------------------------------------------------
// NO RENORMALISATION — THE POINT OF THE WHOLE RULE
// ---------------------------------------------------------------------------
//
// AC-029's prohibited side effect names it: "it may not silently renormalize in
// a way that hides the change". So during hypertrend the effective table sums to
// **80, not 100**: the five surviving experts keep their DECLARED weights and
// the macro slot's 20 points are simply not distributed. Rescaling the other
// five so the total returns to 100 would give every survivor a share the spec
// never granted it, and it would restore a score ceiling the rule exists to
// lower. A score of 100 in a hypertrend would mean "every surviving expert was
// perfect AND the macro view was ignored" — a state the spec does not describe.
//
// `effectiveWeightSum` is on the score for exactly this reason: a caller that
// wanted to renormalise could, but it would have to do it visibly, and the
// honest total is the first thing a reader sees.

import { describe, expect, it } from "vitest"

import { EXPERT_WEIGHTS, EXPERT_WEIGHT_SUM, evaluateConfluence } from "../confluence.mjs"
import { classifyRegime } from "../regime.mjs"
import { WEIGHT_PCT as MACRO_WEIGHT } from "../experts/macroBias.mjs"
import { C3_RULE, c3Adjustments, effectiveWeightsWith, evaluateC3 } from "../conflicts/c3HypertrendMacro.mjs"
import { deriveMarketState } from "../marketState.mjs"
import { fullMarketState, rangingMarketState } from "./fixtures/marketFixtures.mjs"

const HYPERTREND = fullMarketState() // hypertrend: the default fixture clears the overlay
const NOT_HYPERTREND = rangingMarketState() // a ranging market, so the session regime stands

describe("C3 is a NAMED, VERSIONED rule", () => {
  it("carries the spec's own id and a ruleVersion", () => {
    expect(C3_RULE.id).toBe("C3")
    expect(C3_RULE.ruleId).toBe("copilot.conflict.c3HypertrendMacro")
    expect(C3_RULE.ruleVersion).toMatch(/^copilot-conflict-c3HypertrendMacro\/\d+\.\d+\.\d+$/)
    expect(C3_RULE.specRef).toContain("§4.4:701")
  })

  it("names the regime that opens the window and the condition that closes it", () => {
    expect(C3_RULE.regime).toBe("hypertrend")
    expect(C3_RULE.windowAnchor).toBe("regimeWindow")
    expect(C3_RULE.expiryCondition).toBe("regimeExit")
  })

  it("reads 20% and 0% from T11's table rather than restating them", () => {
    // Risk 6. `macroBias.mjs` owns the expert's weight; §4.4:701 names the same
    // 20 → 0 reallocation. A literal 20 here would be a third copy.
    expect(C3_RULE.declaredWeightPct).toBe(MACRO_WEIGHT)
    expect(C3_RULE.declaredWeightPct).toBe(EXPERT_WEIGHTS.find((e) => e.expert === "macroBias").weightPct)
    expect(C3_RULE.reallocatedWeightPct).toBe(0)
  })

  it("declares that it does NOT renormalise, so the property is a stated contract", () => {
    expect(C3_RULE.renormalises).toBe(false)
  })

  it("is frozen", () => {
    expect(Object.isFrozen(C3_RULE)).toBe(true)
  })
})

describe("AC-029 — the three-state weight snapshot", () => {
  it("reads 20% before the window, 0% during it, and 20% after", () => {
    const before = evaluateC3({ state: deriveMarketState(NOT_HYPERTREND) })
    const during = evaluateC3({ state: deriveMarketState(HYPERTREND) })
    const after = evaluateC3({ state: deriveMarketState(NOT_HYPERTREND) })

    expect(before.macroWeightPct).toBe(20)
    expect(during.macroWeightPct).toBe(0)
    expect(after.macroWeightPct).toBe(20)
  })

  it("names each of the three states, so a caller is never guessing", () => {
    expect(evaluateC3({ state: deriveMarketState(NOT_HYPERTREND) }).status).toBe("notHypertrend")
    expect(evaluateC3({ state: deriveMarketState(HYPERTREND) }).status).toBe("applied")
  })

  it("reads the regime from T11's classifier, not from a second classifier", () => {
    for (const raw of [HYPERTREND, NOT_HYPERTREND]) {
      const state = deriveMarketState(raw)
      expect(evaluateC3({ state }).inputs.regime).toBe(classifyRegime(state).regime)
    }
  })

  it("proves the fixtures really are hypertrend and not", () => {
    // Without this the snapshot could pass because both states were hypertrend.
    expect(classifyRegime(deriveMarketState(HYPERTREND)).regime).toBe("hypertrend")
    expect(classifyRegime(deriveMarketState(NOT_HYPERTREND)).regime).not.toBe("hypertrend")
  })
})

describe("AC-029 — the prohibited side effect: no silent renormalisation", () => {
  it("sums to 80 during the window, not 100", () => {
    const weights = effectiveWeightsWith(EXPERT_WEIGHTS, evaluateC3({ state: deriveMarketState(HYPERTREND) }))
    const sum = weights.reduce((t, w) => t + w.effectiveWeightPct, 0)
    expect(sum).toBe(80)
  })

  it("leaves the other five at their DECLARED weights", () => {
    const resolution = evaluateC3({ state: deriveMarketState(HYPERTREND) })
    const weights = effectiveWeightsWith(EXPERT_WEIGHTS, resolution)
    for (const row of weights.filter((w) => w.expert !== "macroBias")) {
      const declared = EXPERT_WEIGHTS.find((e) => e.expert === row.expert).weightPct
      expect(row.effectiveWeightPct, `${row.expert} must keep its declared weight`).toBe(declared)
    }
  })

  it("leaves the DECLARED table at exactly 100 throughout", () => {
    // AC-022's invariant is about the table, and C3 must not be able to break it.
    expect(EXPERT_WEIGHT_SUM).toBe(100)
    const resolution = evaluateC3({ state: deriveMarketState(HYPERTREND) })
    expect(effectiveWeightsWith(EXPERT_WEIGHTS, resolution).reduce((t, w) => t + w.declaredWeightPct, 0)).toBe(100)
  })

  it("says the change is visible: every row names who adjusted it and why", () => {
    const weights = effectiveWeightsWith(EXPERT_WEIGHTS, evaluateC3({ state: deriveMarketState(HYPERTREND) }))
    const macro = weights.find((w) => w.expert === "macroBias")
    expect(macro.declaredWeightPct).toBe(20)
    expect(macro.effectiveWeightPct).toBe(0)
    expect(macro.adjustedBy).toBe("C3")
    expect(macro.reason).toContain("C3")
    for (const row of weights.filter((w) => w.expert !== "macroBias")) {
      expect(row.adjustedBy, `${row.expert} was not adjusted`).toBeNull()
    }
  })
})

describe("AC-029 — the prohibited side effect: it is not sticky", () => {
  it("opens no window at all when the regime is not hypertrend", () => {
    const r = evaluateC3({ state: deriveMarketState(NOT_HYPERTREND) })
    expect(r.applied).toBe(false)
    expect(r.macroWeightPct).toBe(20)
    expect(r.window).toMatchObject({ open: false, expired: false, anchor: "regimeWindow" })
    expect(c3Adjustments(r)).toEqual([])
  })

  it("carries no counter, timer, or remembered flag that could keep it open", () => {
    // A sticky reallocation needs state. The rule holds none: two evaluations of
    // the same non-hypertrend state are identical however many hypertrend
    // evaluations came before them.
    const state = deriveMarketState(NOT_HYPERTREND)
    const resolution = evaluateC3({ state })
    const keys = Object.keys(resolution).sort()
    expect(keys).toEqual([
      "adjustments",
      "applied",
      "inputs",
      "macroWeightPct",
      "reason",
      "regime",
      "rule",
      "ruleId",
      "ruleVersion",
      "specRef",
      "status",
      "supersededBy",
      "targetExpert",
      "window"
    ])
  })

  it("is a pure function of the state: the same state always gives the same answer", () => {
    const state = deriveMarketState(HYPERTREND)
    expect(JSON.stringify(evaluateC3({ state }))).toBe(JSON.stringify(evaluateC3({ state })))
  })
})

describe("C3 — what it does to the score", () => {
  const resolution = evaluateC3({ state: deriveMarketState(HYPERTREND) })

  it("reallocates the macro weight to zero and nothing else", () => {
    expect(resolution.adjustments).toHaveLength(1)
    expect(resolution.adjustments[0]).toMatchObject({
      expert: "macroBias",
      rule: "C3",
      weightPct: 0
    })
    expect(resolution.adjustments[0].rawDelta).toBeUndefined()
  })

  it("states the window's anchor and expiry on the record", () => {
    expect(resolution.window).toMatchObject({
      anchor: "regimeWindow",
      expiryCondition: "regimeExit",
      open: true,
      expired: false,
      openedForRegime: "hypertrend",
      candleCount: null
    })
  })

  it("explains itself in the spec's own terms", () => {
    expect(resolution.reason).toContain("4H wall")
    expect(resolution.reason).toContain("1–3 minute")
  })

  it("is independently disable-able", () => {
    const off = evaluateC3({ state: deriveMarketState(HYPERTREND), enabled: false })
    expect(off.status).toBe("disabled")
    expect(off.applied).toBe(false)
    expect(off.macroWeightPct).toBe(20)
    expect(c3Adjustments(off)).toEqual([])
  })
})

describe("C3 — the confluence carries the reallocation where AC-029 can see it", () => {
  it("reports an effective weight table whose macro row is 0 and whose total is 80", () => {
    const c = evaluateConfluence(HYPERTREND, {
      adjustments: c3Adjustments(evaluateC3({ state: deriveMarketState(HYPERTREND) })),
      conflictOverrides: ["C3"]
    })
    const macro = c.effectiveWeights.find((w) => w.expert === "macroBias")
    expect(macro.effectiveWeightPct).toBe(0)
    expect(macro.declaredWeightPct).toBe(20)
    expect(c.effectiveWeightSum).toBe(80)
  })

  it("leaves `contributions` reporting the DECLARED weight, so AC-030's row is unchanged", () => {
    // contracts.ts:162-164 types `weightPct` as a literal union of the six
    // declared values, and T11's test pins the exact key set of a contribution.
    // The reallocation is therefore carried in `effectiveWeights`, which is the
    // display surface AC-029 asks for, and NOT by rewriting a declared field.
    const c = evaluateConfluence(HYPERTREND, {
      adjustments: c3Adjustments(evaluateC3({ state: deriveMarketState(HYPERTREND) })),
      conflictOverrides: ["C3"]
    })
    for (const row of c.contributions) {
      expect(row.weightPct).toBe(EXPERT_WEIGHTS.find((e) => e.expert === row.expert).weightPct)
    }
  })

  it("recomputes the score from the effective weights, so the hole lowers it", () => {
    const plain = evaluateConfluence(HYPERTREND)
    const reallocated = evaluateConfluence(HYPERTREND, {
      adjustments: c3Adjustments(evaluateC3({ state: deriveMarketState(HYPERTREND) })),
      conflictOverrides: ["C3"]
    })
    const macroPlain = plain.expertScores.find((e) => e.expert === "macroBias")
    const macroReallocated = reallocated.expertScores.find((e) => e.expert === "macroBias")
    expect(macroReallocated.weightedPoints).toBe(0)
    expect(macroPlain.weightedPoints).toBeGreaterThan(0)
    expect(reallocated.score).toBeCloseTo(plain.score - macroPlain.weightedPoints, 10)
  })

  it("is a no-op with no conflict context, so the T11 path is byte-identical", () => {
    const withoutContext = evaluateConfluence(HYPERTREND)
    const withEmptyContext = evaluateConfluence(HYPERTREND, { adjustments: [], conflictOverrides: [] })
    expect(JSON.stringify(withEmptyContext)).toBe(JSON.stringify(withoutContext))
    expect(withoutContext.conflictOverrides).toEqual([])
    expect(withoutContext.effectiveWeightSum).toBe(100)
  })
})
