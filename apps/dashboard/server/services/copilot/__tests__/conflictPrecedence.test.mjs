// WS-7 T12 — the PRECEDENCE between the three resolutions, and the composition
// seam that exposes them through T11's engine.
//
// T12's bisect line (spec :1307) — "Each of C1/C2/C3 is independently testable
// and independently revertible; a conflict between them (for example C1's
// override and C2's stop) is resolved by an explicit precedence recorded in
// `conflictOverrides`, not by ordering luck."
//
// §4.3:619 types `conflictOverrides: Array<"C1" | "C2" | "C3">` — strings only.
// That is the APPLIED set, and it is kept exactly that shape. The full record —
// every rule considered, why it did or did not apply, and which rule beat which
// — is `conflicts.resolutions`, a sibling field. A caller reading only
// `conflictOverrides` sees which rules won; a caller reading `resolutions` sees
// everything, INCLUDING the losers, which is the half that "not silently
// dropped" requires.
//
// ---------------------------------------------------------------------------
// WHAT THE PRECEDENCE IS, AND WHY IT IS DATA
// ---------------------------------------------------------------------------
//
// A stop governs whether an OPEN POSITION is exited. A score governs whether a
// position is ENTERED. When both speak about the same candle, no entry-side
// reading can outrank an exit-side one: a maxed trend score (C1) that could
// promote the tier while C2 reports the position's stop geometry is breached
// would be the engine arguing itself into a new trade on the bar that says the
// existing one is in trouble.
//
// So C2 outranks C1 and C3, and C1 and C3 do not outrank each other — they
// touch different experts (Trend & Strength versus Macro Bias) and there is
// nothing for them to disagree about. The empty cell is the CONTROL: if the
// table said "C2 always wins", the C1-vs-C3 pair would also resolve to C2 and
// the test below would not distinguish a real table from a blanket rule.
//
// The table is a FROZEN LITERAL with a `reason` per row, and the resolver reads
// nothing else to decide. A test hands the resolver the same three candidates in
// two different array orders and asserts byte-identical output — that is the
// direct, mechanical refutation of "ordering luck".

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { evaluateConfluence } from "../confluence.mjs"
import { C1_RULE, c1WindowAt, evaluateC1, observeDualBooster, observeTrend } from "../conflicts/c1AdxLagging.mjs"
import { BAND as TREND_BAND } from "../experts/trendStrength.mjs"
import { C2_RULE, evaluateC2 } from "../conflicts/c2TwoTierStop.mjs"
import { C3_RULE, evaluateC3 } from "../conflicts/c3HypertrendMacro.mjs"
import { CONFLICT_PRECEDENCE, PRECEDENCE_VERSION, resolvePrecedence } from "../conflicts/precedence.mjs"
import { CONFLICT_RULE_IDS, c2AsCandidate, evaluateConflicts } from "../conflicts/index.mjs"
import { evaluateCopilot } from "../engine.mjs"
import { deriveMarketState } from "../marketState.mjs"
import {
  ADX_LAGGING_HARD_STOP_OFFSET,
  ADX_LAGGING_TRIGGER_INDEX,
  adxLaggingState,
  dualBoosterState
} from "./fixtures/conflictFixtures.mjs"
import { fullMarketState } from "./fixtures/marketFixtures.mjs"

// ---------------------------------------------------------------------------
// ONE state in which C1 and C2 both want to speak.
// ---------------------------------------------------------------------------
// `adxLaggingState` is the chop-then-ramp fixture: both boosters fire while the
// ADX leg still reads below-threshold, so C1 maxes a trend sub-score of 66.67
// up to 100. Entering a long 8 points above the current price puts the 1.5x-ATR
// stop level below the CLOSE, so C2 is hard-stopping on the same candle. That is
// a single real market state in which both rules fire — the collision the spec
// names at :1307 — rather than two states stitched together.

const COLLIDING_RAW = adxLaggingState()
const COLLIDING = deriveMarketState(COLLIDING_RAW)
const COLLIDING_ENTRY = COLLIDING.last.close + ADX_LAGGING_HARD_STOP_OFFSET

const c1On = (state = COLLIDING) => ({
  observation: observeDualBooster(state),
  trend: observeTrend(state),
  window: c1WindowAt({ triggerIndex: ADX_LAGGING_TRIGGER_INDEX, candleIndex: ADX_LAGGING_TRIGGER_INDEX })
})

const c2On = (state = COLLIDING) => ({ direction: "long", entryPrice: COLLIDING_ENTRY })

function conflictsFor({ c1Enabled = true, c2Enabled = true, c3Enabled = true } = {}) {
  return {
    enabled: { C1: c1Enabled, C2: c2Enabled, C3: c3Enabled },
    c1: c1On(),
    c2: c2On(),
    c3: {}
  }
}

/** The two candidate resolutions, built fresh so each test owns its objects. */
const c1Candidate = () => evaluateC1(c1On())
const c2Candidate = () => c2AsCandidate(evaluateC2({ state: COLLIDING, ...c2On() }))

describe("the precedence table is EXPLICIT, FROZEN, and reasoned", () => {
  it("names the winning rule, the losing rule, and WHY, for every colliding pair", () => {
    expect(CONFLICT_PRECEDENCE.length).toBeGreaterThan(0)
    for (const row of CONFLICT_PRECEDENCE) {
      expect(CONFLICT_RULE_IDS).toContain(row.winner)
      expect(CONFLICT_RULE_IDS).toContain(row.loser)
      expect(row.loser).not.toBe(row.winner)
      expect(typeof row.reason).toBe("string")
      expect(row.reason.length).toBeGreaterThan(20)
    }
  })

  it("is frozen, and versioned", () => {
    expect(Object.isFrozen(CONFLICT_PRECEDENCE)).toBe(true)
    for (const row of CONFLICT_PRECEDENCE) expect(Object.isFrozen(row)).toBe(true)
    expect(PRECEDENCE_VERSION).toMatch(/^copilot-conflict-precedence\/\d+\.\d+\.\d+$/)
  })

  it("puts the position stop above both score-side rules", () => {
    const winnerFor = (loser) => CONFLICT_PRECEDENCE.find((r) => r.loser === loser)?.winner
    expect(winnerFor("C1")).toBe("C2")
    expect(winnerFor("C3")).toBe("C2")
  })

  it("has NO row between C1 and C3, because they touch different experts", () => {
    // The control. A table that resolved every pair to C2 would pass the two
    // assertions above and would be a blanket rule wearing a table's clothes.
    const between = CONFLICT_PRECEDENCE.filter(
      (r) => (r.loser === "C1" && r.winner === "C3") || (r.loser === "C3" && r.winner === "C1")
    )
    expect(between).toEqual([])
  })

  it("rejects a table that would cycle, rather than resolving it by luck", () => {
    const cyclic = [
      { loser: "C1", winner: "C2", reason: "a" },
      { loser: "C2", winner: "C1", reason: "b" }
    ]
    expect(() => resolvePrecedence([c1Candidate(), c2Candidate()], { table: cyclic })).toThrow(/cycle/i)
  })
})

describe("the C1-vs-C2 collision the spec names — AC ordering is not ordering luck", () => {
  it("puts both rules in the record, so neither is silently dropped", () => {
    const out = evaluateConflicts(COLLIDING, conflictsFor())
    const rules = out.resolutions.map((r) => r.rule)
    expect(rules).toEqual(["C1", "C2", "C3"])
  })

  it("reports C1 as SUPERSEDED by C2, with the reason on the record", () => {
    const out = evaluateConflicts(COLLIDING, conflictsFor())
    const c1 = out.resolutions.find((r) => r.rule === "C1")
    expect(c1.status).toBe("superseded")
    expect(c1.supersededBy).toBe("C2")
    expect(c1.supersededReason).toContain("C2")
    expect(c1.applied).toBe(false)
  })

  it("keeps what the superseded rule WOULD have done, so nothing is lost", () => {
    const out = evaluateConflicts(COLLIDING, conflictsFor())
    const c1 = out.resolutions.find((r) => r.rule === "C1")
    // The losing rule's own decision is preserved verbatim under a distinct key.
    // Emptying `adjustments` alone would be the silent drop AC-027's
    // inspectability and D7's record-keeping both forbid.
    expect(c1.wouldHaveApplied).toBe(true)
    expect(c1.supersededAdjustments).toHaveLength(1)
    expect(c1.supersededAdjustments[0].rule).toBe("C1")
  })

  it("applies C2, and only C2, to the score", () => {
    const out = evaluateConflicts(COLLIDING, conflictsFor())
    expect([...out.conflictOverrides]).toEqual(["C2"])
    expect(out.adjustments).toEqual([])
    expect(out.resolutions.find((r) => r.rule === "C2").status).toBe("applied")
  })

  it("leaves C3 untouched, because C2 does not outrank it here", () => {
    // C3 is not hypertrend on this fixture's own state, so it is
    // `notHypertrend` — present on the record, and reported as such rather than
    // omitted.
    const out = evaluateConflicts(COLLIDING, conflictsFor())
    const c3 = out.resolutions.find((r) => r.rule === "C3")
    expect(c3.status).toBe("notHypertrend")
    expect(c3.supersededBy).toBeNull()
  })

  it("gives the same answer whatever order the candidates arrive in", () => {
    // THE ordering-luck refutation. Same inputs, two array orders, byte-identical
    // output. A resolver that read `candidates[0]` first would differ here.
    const forward = resolvePrecedence([c1Candidate(), c2Candidate()])

    const backward = resolvePrecedence([c2Candidate(), c1Candidate()])

    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward))
  })
})

describe("C1-vs-C3: orthogonal rules, both applied", () => {
  it("applies both, and records both in conflictOverrides", () => {
    // `dualBoosterState` is the one fixture that is BOTH a dual-booster bar AND
    // `hypertrend`, so C1 and C3 genuinely collide here without either being
    // forced. The window is supplied open because the state ends on the trigger
    // bar and the rule counts that bar as its first.
    const state = deriveMarketState(dualBoosterState())
    expect(evaluateC3({ state }).regime).toBe("hypertrend")
    const out = evaluateConflicts(state, {
      c1: c1On(state),
      c2: { direction: "long", entryPrice: state.last.close },
      c3: {}
    })
    expect([...out.conflictOverrides].sort()).toEqual(["C1", "C3"])
    expect(out.adjustments.map((a) => a.rule).sort()).toEqual(["C1", "C3"])
    expect(out.adjustments.map((a) => a.expert).sort()).toEqual(["macroBias", "trendStrength"])
  })
})

describe("each resolution is INDIVIDUALLY DISABLE-ABLE", () => {
  it("C2 off → C1 applies again, with no trace of C2 on the record", () => {
    const out = evaluateConflicts(COLLIDING, conflictsFor({ c2Enabled: false }))
    expect([...out.conflictOverrides]).toEqual(["C1"])
    const c2 = out.resolutions.find((r) => r.rule === "C2")
    expect(c2.status).toBe("disabled")
    expect(c2.applied).toBe(false)
  })

  it("C1 off → C2 applies, and C1 reports `disabled` rather than `notTriggered`", () => {
    const out = evaluateConflicts(COLLIDING, conflictsFor({ c1Enabled: false }))
    expect([...out.conflictOverrides]).toEqual(["C2"])
    const c1 = out.resolutions.find((r) => r.rule === "C1")
    expect(c1.status).toBe("disabled")
    expect(c1.applied).toBe(false)
    expect(c1.supersededBy).toBeNull()
  })

  it("all three off → no overrides, no adjustments, and all three still on the record", () => {
    const out = evaluateConflicts(COLLIDING, conflictsFor({ c1Enabled: false, c2Enabled: false, c3Enabled: false }))
    expect([...out.conflictOverrides]).toEqual([])
    expect(out.adjustments).toEqual([])
    expect(out.resolutions.map((r) => r.status)).toEqual(["disabled", "disabled", "disabled"])
  })
})

describe("each resolution is INDEPENDENTLY TESTABLE — no module needs another", () => {
  const sourceOf = (name) =>
    readFileSync(fileURLToPath(new URL(`../conflicts/${name}.mjs`, import.meta.url)), "utf8")

  it("C1 imports neither C2 nor C3", () => {
    const src = sourceOf("c1AdxLagging")
    expect(src).not.toMatch(/from\s+["'][^"']*c2TwoTierStop/)
    expect(src).not.toMatch(/from\s+["'][^"']*c3HypertrendMacro/)
  })

  it("C2 imports neither C1 nor C3", () => {
    const src = sourceOf("c2TwoTierStop")
    expect(src).not.toMatch(/from\s+["'][^"']*c1AdxLagging/)
    expect(src).not.toMatch(/from\s+["'][^"']*c3HypertrendMacro/)
  })

  it("C3 imports neither C1 nor C2", () => {
    const src = sourceOf("c3HypertrendMacro")
    expect(src).not.toMatch(/from\s+["'][^"']*c1AdxLagging/)
    expect(src).not.toMatch(/from\s+["'][^"']*c2TwoTierStop/)
  })

  it("the precedence table imports NO rule module at all", () => {
    // A table that imported the rules would be reachable only through them, and
    // the "not by ordering luck" claim would rest on the import graph again.
    const src = readFileSync(
      fileURLToPath(new URL("../conflicts/precedence.mjs", import.meta.url)),
      "utf8"
    )
    expect(src).not.toMatch(/from\s+["'][^"']*c1AdxLagging/)
    expect(src).not.toMatch(/from\s+["'][^"']*c2TwoTierStop/)
    expect(src).not.toMatch(/from\s+["'][^"']*c3HypertrendMacro/)
  })

  it("declares all three ids, in the spec's own order", () => {
    expect([...CONFLICT_RULE_IDS]).toEqual(["C1", "C2", "C3"])
    expect([CONFLICT_RULE_IDS[0], CONFLICT_RULE_IDS[1], CONFLICT_RULE_IDS[2]]).toEqual([
      C1_RULE.id,
      C2_RULE.id,
      C3_RULE.id
    ])
  })

  it("keeps the layering that makes the two copies of the id vocabulary safe", () => {
    // `confluence.mjs` declares the same three ids so it can validate
    // `context.conflictOverrides` (§4.3:619's union) without importing the layer
    // above it. That is only safe while the dependency does not exist, so the
    // dependency is asserted rather than assumed: if this ever fails, the two
    // copies become one and the second declaration is dead code.
    const src = readFileSync(
      fileURLToPath(new URL("../confluence.mjs", import.meta.url)),
      "utf8"
    )
    expect(src).not.toMatch(/from\s+["'][^"']*conflicts\//)
    // And the rule id is still a hard-validated union there, not `any`.
    expect(src).toMatch(/CONFLICT_RULE_IDS\s*=\s*Object\.freeze\(\["C1",\s*"C2",\s*"C3"\]\)/)
  })
})

describe("the confluence REFUSES two rules fighting over one expert", () => {
  it("throws naming both rules, rather than letting array order pick", () => {
    const state = deriveMarketState(fullMarketState())
    const clash = [
      { expert: "macroBias", rule: "C3", weightPct: 0, reason: "C3 zeroes macro" },
      { expert: "macroBias", rule: "C1", weightPct: 0, reason: "C1 also claims it" }
    ]
    let message = null
    try {
      evaluateConfluence(state, { adjustments: clash, conflictOverrides: ["C1", "C3"] })
    } catch (e) {
      message = e.message
    }
    expect(message, "the throw must name both rules, the expert, and where it belongs").toMatch(/C1/)
    expect(message).toMatch(/C3/)
    expect(message).toMatch(/macroBias/)
    expect(message).toMatch(/precedence\.mjs/)
  })

  it("rejects an adjustment with no reason, and one that changes nothing", () => {
    const state = deriveMarketState(fullMarketState())
    expect(() =>
      evaluateConfluence(state, { adjustments: [{ expert: "macroBias", rule: "C3", weightPct: 0 }] })
    ).toThrow(/reason/)
    expect(() =>
      evaluateConfluence(state, { adjustments: [{ expert: "macroBias", rule: "C3", reason: "x" }] })
    ).toThrow(/does nothing/)
  })

  it("rejects a conflictOverrides entry that is not one of the three ids", () => {
    const state = deriveMarketState(fullMarketState())
    expect(() => evaluateConfluence(state, { conflictOverrides: ["C4"] })).toThrow(/C4/)
  })
})

describe("the confluence REFUSES a rule asking for a value outside an expert's band", () => {
  it("throws, rather than letting bandToScore's clamp hide it", () => {
    // `bandToScore` CLAMPS. That is right for an expert's own reading and wrong
    // for a rule's: a rule asking for +9999 would silently become the band
    // maximum — the very value it was trying to exceed — and be reported back as
    // if it had been asked for. C1 asks for `BAND.max`; anything outside the
    // band is a bug in the rule, and the band it violated is named.
    const state = deriveMarketState(fullMarketState())
    let message = null
    try {
      evaluateConfluence(state, {
        adjustments: [{ expert: "trendStrength", rule: "C1", rawDelta: 9999, reason: "out of band" }],
        conflictOverrides: ["C1"]
      })
    } catch (e) {
      message = e.message
    }
    expect(message, "the throw must name the expert and the band").toMatch(/trendStrength/)
    expect(message).toMatch(/band/)
  })

  it("accepts an adjusted rawDelta exactly on either band edge", () => {
    const state = deriveMarketState(fullMarketState())
    for (const edge of [TREND_BAND.min, TREND_BAND.max]) {
      const c = evaluateConfluence(state, {
        adjustments: [{ expert: "trendStrength", rule: "C1", rawDelta: edge, reason: "on the edge" }],
        conflictOverrides: ["C1"]
      })
      expect(c.expertScores.find((e) => e.expert === "trendStrength").adjustedBy).toBe("C1")
    }
  })
})

describe("T11's engine carries the conflicts without changing its default", () => {
  it("is byte-identical to the T11 path when no conflicts are supplied", () => {
    const withNone = evaluateCopilot({ marketState: fullMarketState() })
    const withEmpty = evaluateCopilot({ marketState: fullMarketState(), conflicts: null })
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(withNone))
    expect(withNone.confluence.conflictOverrides).toEqual([])
  })

  it("distinguishes 'not asked' from 'asked, and none applied'", () => {
    // The same distinction `marketState.mjs:212-222` makes for `null` versus
    // `[]`: "no caller supplied conflict options" and "every rule was considered
    // and none applied" are opposite facts, and collapsing them would report a
    // check that never happened.
    const notAsked = evaluateCopilot({ marketState: fullMarketState() })
    const asked = evaluateCopilot({ marketState: fullMarketState(), conflicts: conflictsFor() })
    expect(notAsked.conflicts.notEvaluated).toBe(true)
    expect(notAsked.conflicts.resolutions).toEqual([])
    expect(asked.conflicts.notEvaluated).toBeUndefined()
    expect(asked.conflicts.resolutions).toHaveLength(3)
  })

  it("puts the applied rules on the score's own `conflictOverrides`", () => {
    const out = evaluateCopilot({ marketState: COLLIDING_RAW, conflicts: conflictsFor() })
    expect([...out.confluence.conflictOverrides]).toEqual(["C2"])
  })

  it("exposes the full record beside the spec's string array", () => {
    const out = evaluateCopilot({ marketState: COLLIDING_RAW, conflicts: conflictsFor() })
    expect(out.conflicts.resolutions).toHaveLength(3)
    expect(out.conflicts.resolutions.find((r) => r.rule === "C1").supersededBy).toBe("C2")
    expect(out.conflicts.precedence).toBe(CONFLICT_PRECEDENCE)
    expect(out.conflicts.precedenceVersion).toBe(PRECEDENCE_VERSION)
  })

  it("computes C2's stop from the same market state it is given, not a different one", () => {
    const out = evaluateCopilot({ marketState: COLLIDING_RAW, conflicts: conflictsFor() })
    const c2 = out.conflicts.resolutions.find((r) => r.rule === "C2")
    expect(c2.verdict).toBe("hardStop")
    expect(c2.inputs.entryPrice).toBe(COLLIDING_ENTRY)
  })

  it("leaves the tier decision to T11's table, with the conflicted score", () => {
    // A conflict changes the SCORE. It never re-implements the tier boundary,
    // and it never re-derives a risk percentage.
    const out = evaluateCopilot({ marketState: COLLIDING_RAW, conflicts: conflictsFor() })
    expect(out.tier.tier === "A+" || out.tier.tier === "B" || out.tier.tier === "ignore").toBe(true)
    expect([0, 0.005, 0.01]).toContain(out.tier.riskPct)
  })
})
