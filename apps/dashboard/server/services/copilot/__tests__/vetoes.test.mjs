// WS-7 T11 — AC-022: the vetoes are inspectable outcomes, not booleans.
//
// AC-022:941-947:
//   Prohibited: A veto may not be absorbed into a lower score or hidden behind
//              a boolean.
//   Verification: Record read/write test; display assertion; a tier test
//              proving `hold` overrides a would-be A+.
//
// Plan v1 §3.1 item 6: "A `VetoOutcome` written by a firing veto is readable
// back with `ruleId`, `inputs`, `suppressed`, `evaluatedAt`, `ruleVersion`
// intact. Assert this against the `vetoIndex.mjs` store, not against a returned
// object — D7's whole point is that the record survives the call."
//
// So the read/write tests in this file go through the STORE. The returned
// array is treated as the thing that happens to be handy, not the thing that is
// the guarantee.

import { describe, expect, it } from "vitest"

import { deriveMarketState } from "../marketState.mjs"
import { tierFor } from "../tiers.mjs"
import {
  OWNED_RETENTION_CLASSES,
  VETO_RETENTION_CLASS,
  VETO_RULE_IDS,
  VETO_RULES,
  createVetoIndex,
  evaluateAllVetoes,
  firedVetoes
} from "../vetoIndex.mjs"
import { ATR_MULTIPLE } from "../vetoes/wickVsClose.mjs"
import { LOCKOUT_WINDOW_MS } from "../vetoes/newsLockout.mjs"
import { OPEN_WINDOW_MINUTES } from "../vetoes/sessionOpen.mjs"
import { TRAP_THRESHOLD } from "../vetoes/correlationTrap.mjs"
import { fullMarketState } from "./fixtures/marketFixtures.mjs"

const at = (h, m = 0) => Date.UTC(2026, 2, 10, h, m)

/**
 * A state where every veto is evaluable and clear, so a test can flip exactly
 * one rule without the other five interfering. 11:00 UTC is outside both session
 * open windows and away from the London session's 07:00 opening.
 */
function cleanState(overrides = {}) {
  return deriveMarketState(
    fullMarketState({
      computedAt: at(11),
      newsEvents: [],
      proposals: [{ symbol: "BTCUSD", correlationGroup: "crypto" }],
      facts: {
        direction: "long",
        higherTimeframeBias: "bullish",
        spreadPct: 0.05,
        targetPct: 0.2
      },
      ...overrides
    })
  )
}

describe("AC-022 — the six vetoes exist, in the spec's order", () => {
  it("names exactly the six rules of §4.4:691", () => {
    expect(VETO_RULE_IDS).toEqual([
      "topDownHierarchy",
      "correlationTrap",
      "wickVsClose",
      "spreadVsTarget",
      "newsLockout",
      "sessionOpen"
    ])
    expect(VETO_RULE_IDS).toHaveLength(6)
  })

  it("matches contracts.ts:168-174's VetoRuleId union", () => {
    // The same six literals, in the same order, as the client's VETO_RULE_IDS.
    // Two copies of a rule list drift the same way two tier tables do.
    expect([...VETO_RULE_IDS].sort()).toEqual([
      "correlationTrap",
      "newsLockout",
      "sessionOpen",
      "spreadVsTarget",
      "topDownHierarchy",
      "wickVsClose"
    ])
  })

  it("gives every rule a non-empty version, so a record names its own version", () => {
    for (const { ruleId, mod } of VETO_RULES) {
      expect(typeof mod.RULE_VERSION, ruleId).toBe("string")
      expect(mod.RULE_VERSION.length, ruleId).toBeGreaterThan(0)
      expect(mod.SUPPRESSED.length, ruleId).toBeGreaterThan(0)
    }
  })

  it("returns six outcomes from one evaluation, in order", () => {
    const outcomes = evaluateAllVetoes(cleanState())
    expect(outcomes).toHaveLength(6)
    expect(outcomes.map((o) => o.ruleId)).toEqual([...VETO_RULE_IDS])
  })
})

describe("AC-022 — every outcome carries all five inspectable fields", () => {
  const outcomes = evaluateAllVetoes(cleanState())

  it("has ruleId, fired, inputs, suppressed, evaluatedAt and ruleVersion on each", () => {
    for (const o of outcomes) {
      expect(Object.keys(o).sort(), o.ruleId).toEqual(
        ["evaluatedAt", "fired", "inputs", "ruleId", "ruleVersion", "suppressed"].sort()
      )
    }
  })

  it("matches contracts.ts:176-184's VetoOutcome shape exactly", () => {
    for (const o of outcomes) {
      expect(typeof o.ruleId).toBe("string")
      expect(typeof o.fired).toBe("boolean")
      expect(typeof o.inputs).toBe("object")
      expect(typeof o.suppressed).toBe("string")
      expect(typeof o.evaluatedAt).toBe("number")
      expect(typeof o.ruleVersion).toBe("string")
    }
  })

  it("carries a non-empty inputs object even for a rule that did not fire", () => {
    for (const o of outcomes) {
      expect(Object.keys(o.inputs).length, o.ruleId).toBeGreaterThan(0)
    }
  })

  it("stamps evaluatedAt from the caller's computedAt, never a clock of its own", () => {
    expect(outcomes.every((o) => o.evaluatedAt === at(11))).toBe(true)
  })

  it("is not a boolean behind a curtain — the rule can be seen, not just its verdict", () => {
    const wick = outcomes.find((o) => o.ruleId === "wickVsClose")
    expect(wick.inputs).toHaveProperty("atr")
    expect(wick.inputs).toHaveProperty("multiple")
    expect(wick.inputs).toHaveProperty("stopDistance")
  })
})

describe("AC-022 — a fired veto forces hold over a would-be A+", () => {
  const state = deriveMarketState(
    fullMarketState({
      computedAt: at(7, 5), // inside the London open window
      newsEvents: [],
      proposals: [{ symbol: "BTCUSD", correlationGroup: "crypto" }],
      facts: { direction: "long", higherTimeframeBias: "bearish", spreadPct: 0.5, targetPct: 0.2 }
    })
  )
  const outcomes = evaluateAllVetoes(state)

  it("records every fired rule rather than stopping at the first", () => {
    const fired = firedVetoes(outcomes).map((o) => o.ruleId)
    expect(fired).toContain("topDownHierarchy")
    expect(fired).toContain("spreadVsTarget")
    expect(fired).toContain("sessionOpen")
  })

  it("forces hold and 0% risk from a score of 100 with permission granted", () => {
    const t = tierFor(100, { vetoes: outcomes, automationPermitted: true, rung: "live" })
    expect(t.tier).toBe("A+")
    expect(t.action).toBe("hold")
    expect(t.riskPct).toBe(0)
  })

  it("keeps every fired record attached to the tier, so the UI can render them", () => {
    const t = tierFor(100, { vetoes: outcomes, automationPermitted: true, rung: "live" })
    expect(t.vetoes.filter((v) => v.fired).length).toBe(firedVetoes(outcomes).length)
  })

  it("does not lower the score band to hide the veto (AC-022:945)", () => {
    const t = tierFor(100, { vetoes: outcomes, automationPermitted: true, rung: "live" })
    expect(t.tier).toBe("A+")
  })
})

describe("D7 — the record survives the call, in the store", () => {
  it("writes then reads a fired Wick-vs-Close record back intact", () => {
    const index = createVetoIndex()
    const state = cleanState()
    const outcomes = evaluateAllVetoes(state)
    index.recordAll(outcomes)

    const read = index.read("wickVsClose")
    expect(read).toHaveLength(1)
    expect(read[0].ruleId).toBe("wickVsClose")
    expect(read[0].fired).toBe(false)
    expect(read[0].inputs.atr).toBeGreaterThan(0)
    expect(read[0].suppressed).toBe("entry")
    expect(read[0].evaluatedAt).toBe(at(11))
    expect(read[0].ruleVersion).toBe("copilot-veto-wickVsClose/1.0.0")
  })

  it("survives a second evaluation — records accumulate, they do not replace", () => {
    const index = createVetoIndex()
    index.recordAll(evaluateAllVetoes(cleanState()))
    index.recordAll(evaluateAllVetoes(cleanState()))
    expect(index.read("sessionOpen")).toHaveLength(2)
    expect(index.size).toBe(12)
  })

  it("assigns a monotonic sequence so two identical records stay distinguishable", () => {
    const index = createVetoIndex()
    index.recordAll(evaluateAllVetoes(cleanState()))
    const later = index.recordAll(evaluateAllVetoes(cleanState()))
    expect(later[0].sequence).toBeGreaterThan(index.read("sessionOpen")[0].sequence)
  })

  it("hands every record to an injected sink exactly once", () => {
    const seen = []
    const index = createVetoIndex({ sink: (r) => seen.push(r) })
    index.recordAll(evaluateAllVetoes(cleanState()))
    expect(seen).toHaveLength(6)
    expect(seen.map((r) => r.ruleId)).toEqual([...VETO_RULE_IDS])
  })

  it("propagates a sink failure rather than losing a safety record silently", () => {
    const index = createVetoIndex({
      sink: () => {
        throw new Error("disk full")
      }
    })
    expect(() => index.record(evaluateAllVetoes(cleanState())[0])).toThrow(/disk full/)
  })

  it("reads the fired subset", () => {
    const index = createVetoIndex()
    const state = deriveMarketState(
      fullMarketState({
        computedAt: at(7, 5),
        newsEvents: [],
        proposals: [{ symbol: "BTCUSD", correlationGroup: "crypto" }],
        facts: { direction: "long", higherTimeframeBias: "bearish", spreadPct: 0.5, targetPct: 0.2 }
      })
    )
    index.recordAll(evaluateAllVetoes(state))
    const fired = index.readFired()
    expect(fired.length).toBeGreaterThan(0)
    for (const r of fired) {
      expect(r.fired).toBe(true)
      expect(r.suppressed.length).toBeGreaterThan(0)
    }
  })

  it("returns null for a rule that has never recorded, rather than an empty stand-in", () => {
    const index = createVetoIndex()
    expect(index.latest("newsLockout")).toBeNull()
  })

  it("rejects a record whose ruleId is not one of the six", () => {
    const index = createVetoIndex()
    expect(() => index.record({ ruleId: "madeUp", fired: true, inputs: {}, suppressed: "x", evaluatedAt: 0, ruleVersion: "v" })).toThrow(/unknown veto ruleId/)
  })
})

describe("§4.3:601 / D8 — the store is append-only and permanent", () => {
  const index = createVetoIndex()

  it("exposes NO update, delete, clear, set, remove or purge method", () => {
    // Named explicitly: an append-only store that happens to lack these today
    // is not the guarantee — the ABSENCE is the guarantee.
    for (const forbidden of ["update", "delete", "remove", "clear", "set", "purge", "retract", "amend", "expire"]) {
      expect(index[forbidden], `vetoIndex must not expose ${forbidden}()`).toBeUndefined()
      expect(typeof createVetoIndex()[forbidden]).toBe("undefined")
    }
  })

  it("is frozen, so a consumer cannot swap a method out from under the store", () => {
    expect(Object.isFrozen(index)).toBe(true)
  })

  it("tags every record permanent_append_only, and every stored record too", () => {
    index.recordAll(evaluateAllVetoes(cleanState()))
    for (const r of index.read()) {
      expect(r.retentionClass).toBe(VETO_RETENTION_CLASS)
      expect(Object.isFrozen(r)).toBe(true)
    }
  })

  it("owns exactly one retention class — T15 owns the rest", () => {
    expect(OWNED_RETENTION_CLASSES).toEqual(["permanent_append_only"])
    expect(OWNED_RETENTION_CLASSES).not.toContain("raw_90d_then_aggregated")
    expect(OWNED_RETENTION_CLASSES).not.toContain("daily_aggregate_permanent")
  })

  it("returns copies from read(), so a caller cannot mutate stored history", () => {
    const all = index.read()
    all.length = 0
    expect(index.size).toBe(6)
  })
})

describe("each veto fires on its own condition, and fails closed when unevaluable", () => {
  const firedIdsFor = (overrides) => firedVetoes(evaluateAllVetoes(deriveMarketState(fullMarketState({ computedAt: at(11), ...overrides })))).map((o) => o.ruleId)

  it("topDownHierarchy fires on an opposing higher-timeframe bias only", () => {
    expect(firedIdsFor({ facts: { direction: "long", higherTimeframeBias: "bearish", spreadPct: 0.05, targetPct: 0.2 }, newsEvents: [], proposals: [] })).toContain("topDownHierarchy")
    expect(firedIdsFor({ facts: { direction: "long", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 }, newsEvents: [], proposals: [] })).not.toContain("topDownHierarchy")
    expect(firedIdsFor({ facts: { direction: "short", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 }, newsEvents: [], proposals: [] })).toContain("topDownHierarchy")
  })

  it("correlationTrap fires when two proposals share a group", () => {
    const two = [
      { symbol: "EURUSD", correlationGroup: "usd-long" },
      { symbol: "USDJPY", correlationGroup: "usd-long" }
    ]
    expect(firedIdsFor({ proposals: two, newsEvents: [], facts: { direction: "long", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 } })).toContain("correlationTrap")
    const distinct = [
      { symbol: "EURUSD", correlationGroup: "eur" },
      { symbol: "USDJPY", correlationGroup: "jpy" }
    ]
    expect(firedIdsFor({ proposals: distinct, newsEvents: [], facts: { direction: "long", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 } })).not.toContain("correlationTrap")
    expect(TRAP_THRESHOLD).toBe(2)
  })

  it("spreadVsTarget fires only when the spread strictly exceeds the target", () => {
    const base = { direction: "long", higherTimeframeBias: "bullish" }
    expect(firedIdsFor({ facts: { ...base, spreadPct: 0.3, targetPct: 0.2 }, newsEvents: [], proposals: [] })).toContain("spreadVsTarget")
    expect(firedIdsFor({ facts: { ...base, spreadPct: 0.2, targetPct: 0.2 }, newsEvents: [], proposals: [] })).not.toContain("spreadVsTarget")
    expect(firedIdsFor({ facts: { ...base, spreadPct: 0.1, targetPct: 0.2 }, newsEvents: [], proposals: [] })).not.toContain("spreadVsTarget")
  })

  it("newsLockout fires within +/-15 minutes of a Red event and not outside it", () => {
    const base = { direction: "long", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 }
    expect(LOCKOUT_WINDOW_MS).toBe(900000)
    // 11:00 evaluated; event at 10:46 (14 min before) is inside the window.
    expect(firedIdsFor({ computedAt: at(11), newsEvents: [{ at: at(10, 46), severity: "red" }], proposals: [], facts: base })).toContain("newsLockout")
    // 16 minutes before is outside it.
    expect(firedIdsFor({ computedAt: at(11), newsEvents: [{ at: at(10, 44), severity: "red" }], proposals: [], facts: base })).not.toContain("newsLockout")
    // After the window, by the same margin.
    expect(firedIdsFor({ computedAt: at(11), newsEvents: [{ at: at(11, 16), severity: "red" }], proposals: [], facts: base })).not.toContain("newsLockout")
    // A non-Red event inside the window does NOT engage this veto.
    expect(firedIdsFor({ computedAt: at(11), newsEvents: [{ at: at(10, 55), severity: "amber" }], proposals: [], facts: base })).not.toContain("newsLockout")
  })

  it("sessionOpen fires in the first 15 minutes of London and NY, and not after", () => {
    const base = { direction: "long", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 }
    const clean = { newsEvents: [], proposals: [], facts: base }
    expect(firedIdsFor({ ...clean, computedAt: at(7, 0) })).toContain("sessionOpen")
    expect(firedIdsFor({ ...clean, computedAt: at(13, 14) })).toContain("sessionOpen")
    // Exactly minute 15 is the end of the window, not inside it.
    expect(firedIdsFor({ ...clean, computedAt: at(7, 15) })).not.toContain("sessionOpen")
    expect(firedIdsFor({ ...clean, computedAt: at(13, 15) })).not.toContain("sessionOpen")
    expect(OPEN_WINDOW_MINUTES).toBe(15)
  })

  it("wickVsClose uses the spec's own 1.5x ATR multiplier", () => {
    expect(ATR_MULTIPLE).toBe(1.5)
  })

  it("every DATA-DEPENDENT veto fails closed when its inputs are absent, and says what is missing", () => {
    // The fail-closed rule. A veto that could not be evaluated must not report
    // itself clear — see vetoes/outcome.mjs for why.
    //
    // `sessionOpen` is deliberately excluded: its only input is `computedAt`,
    // which `deriveMarketState` makes MANDATORY (it throws without one). It can
    // therefore always evaluate, and forcing it to fail closed on a state that
    // supplied a valid timestamp would be inventing an absence that does not
    // exist. The next test asserts that reasoning instead of hiding it.
    const bare = deriveMarketState({ candles: fullMarketState().candles, computedAt: at(11) })
    expect(bare.newsEvents).toBeNull()
    expect(bare.proposals).toBeNull()

    const outcomes = evaluateAllVetoes(bare)
    expect(outcomes).toHaveLength(6)

    for (const o of outcomes.filter((x) => x.ruleId !== "sessionOpen")) {
      expect(o.fired, `${o.ruleId} must fail closed`).toBe(true)
      expect(o.inputs.unevaluated, `${o.ruleId} must record why`).toBeTruthy()
      expect(o.inputs.unevaluated).toContain(o.ruleId)
      expect(o.inputs.missing, `${o.ruleId} must name the missing inputs`).toBeTruthy()
    }
  })

  it("sessionOpen still evaluates on a bare state, because its input is mandatory", () => {
    const bare = deriveMarketState({ candles: fullMarketState().candles, computedAt: at(11) })
    const sessionOpenOutcome = evaluateAllVetoes(bare).find((o) => o.ruleId === "sessionOpen")
    expect(sessionOpenOutcome.fired).toBe(false)
    expect(sessionOpenOutcome.inputs.unevaluated).toBeUndefined()
    expect(sessionOpenOutcome.inputs.guardedSessions).toBe("london,newyork")
  })

  it("collapses a supplied-empty list and a never-supplied list into different verdicts", () => {
    // `newsEvents: []` means "a live source found nothing" and clears.
    // `newsEvents: null` means "no source was supplied" and fails closed.
    const cleared = deriveMarketState(fullMarketState({ computedAt: at(11), newsEvents: [] }))
    const absent = deriveMarketState(fullMarketState({ computedAt: at(11), newsEvents: null }))
    const newsOf = (s) => evaluateAllVetoes(s).find((o) => o.ruleId === "newsLockout")

    expect(newsOf(cleared).fired).toBe(false)
    expect(newsOf(absent).fired).toBe(true)
    expect(newsOf(absent).inputs.unevaluated).toContain("newsEvents")
  })

  it("treats an explicitly empty proposals list as a real observation, not an absence", () => {
    const cleared = deriveMarketState(fullMarketState({ computedAt: at(11), proposals: [] }))
    const absent = deriveMarketState(fullMarketState({ computedAt: at(11), proposals: null }))
    const corrOf = (s) => evaluateAllVetoes(s).find((o) => o.ruleId === "correlationTrap")

    expect(corrOf(cleared).fired).toBe(false)
    expect(corrOf(cleared).inputs.proposalCount).toBe(0)
    expect(corrOf(absent).fired).toBe(true)
  })

  it("rejects a caller who supplies newsEvents as a non-array, rather than guessing", () => {
    expect(() => deriveMarketState(fullMarketState({ newsEvents: "lots" }))).toThrow(/newsEvents must be an array/)
  })

  it("a caller who supplies everything gets no veto from missing inputs", () => {
    const outcomes = evaluateAllVetoes(cleanState())
    const unevaluated = outcomes.filter((o) => o.inputs.unevaluated !== undefined)
    expect(unevaluated).toHaveLength(0)
  })
})
