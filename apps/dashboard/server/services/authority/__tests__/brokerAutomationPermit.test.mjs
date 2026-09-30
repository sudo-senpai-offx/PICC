// WS-7 T16 — the `automationPermitted` change-event wiring. D5 / AC-024 /
// AC-035's persistence-path half.
//
// D5:130-137 — "Autopilot/auto-execute only on brokers flagged
// `automationPermitted`":
//   Decision:  Auto-execute is permitted ONLY on brokers whose record carries
//              `automationPermitted === true`. The flag defaults to FALSE.
//              Setting it true requires ministry-authority sign-off.
//   Why:       An A+ tier that can auto-execute anywhere is a live-money decision
//              engine wearing a scoring badge.
//   Consequence: The flag is a first-class field on the broker record with an
//              audit event on every change. Absent flag ≠ permitted. AC-024.
//
// T16's acceptance (:1341) — "Every `automationPermitted` change records the
// approving authority."
// Plan v1 §3.5:293-295 — "Assert `permitChangedByAuthorityId` is non-null on a
// change event and that a change with no authority is refused — the field
// defaults to `null` and must never be written `null` by a successful change."
//
// §4.3:634-640 —
//   type BrokerRecord = {
//     id: string;
//     automationPermitted: boolean;              // D5: defaults FALSE
//     permitChangedAt: number | null;
//     permitChangedByAuthorityId: string | null;  // D12: ministry sign-off
//     ceremonyUnlocked: boolean;
//   }
//
// THE DECISION THIS FILE MAKES: A DECLINE REQUIRES A RECORDED AUTHORITY TOO.
//
// The literal narrow reading is "setting it true requires sign-off", which would
// let a change to `false` be a bare boolean assignment. Four things in the spec
// say no:
//
//   1. §4.3:638 types `permitChangedByAuthorityId` as a SINGLE field, not a log.
//      An unattributed decline has to write `null` into it, destroying the
//      record of who granted permission in the first place. Requiring
//      attribution on both directions is what keeps a single-valued field
//      honest after every successful change.
//   2. T16's acceptance says "EVERY change", and the plan makes a change with no
//      authority a REFUSAL rather than a permitted write.
//   3. D5's threat is unattended PROMOTION. A sequence true → false → true with
//      an unattributed middle link is exactly the sequence an audit needs to
//      read, and it is the sequence a decline-only waiver would erase.
//   4. D7:148-155 makes a safety-relevant transition a first-class inspectable
//      outcome "not a boolean folded into a score". Revoking automation is
//      safety-improving; it is owed the same provenance as granting it.
//
// The cost is real and is stated rather than hidden: refusing an unattributed
// decline is the fail-OPEN direction, because a refused decline leaves the flag
// as it was — possibly `true`. Two things bound that cost, and both are tested:
// the refusal is a loud named throw, never a silent no-op; and
// `isAutomationPermitted` is PROVENANCE-GATED, so a record reading `true` with
// no resolvable approver does not read as permitted. The dangerous state —
// "flag says auto-execute, nobody signed for it" — is therefore not reachable by
// reading either.
//
// WHAT THIS MODULE DOES NOT DO: it does not re-implement `tierFor`. T11's
// `tiers.mjs:56-101` is the authority on what a flag means for an action, and
// the last test in this file proves the store's read composes with it unchanged.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { evaluateCopilot } from "../../copilot/engine.mjs"
import { tierFor } from "../../copilot/tiers.mjs"
import { atUtc, fullMarketState } from "../../copilot/__tests__/fixtures/marketFixtures.mjs"
import { COLLISION_CODE, UNKNOWN_AUTHORITY_CODE } from "../separationOfDuties.mjs"
import { defineAuthorities } from "../authorityModel.mjs"
import {
  PERMIT_CHANGE_EVENT,
  PERMIT_CHANGE_RETENTION_CLASS,
  PERMIT_NO_AUTHORITY_CODE,
  UNKNOWN_BROKER_CODE,
  createBrokerAutomationPermitStore,
  createBrokerRecord
} from "../brokerAutomationPermit.mjs"
import {
  AUTHORITIES,
  BUILD_LEAD,
  COLLIDING_BUILDS,
  COMPLIANT_BUILDS,
  NEUTRAL_ROOM,
  REVIEW_LEAD,
  assertFixtureGeometry,
  build
} from "./fixtures/authorityFixtures.mjs"

const AT = 1_757_000_000_000
const LATER = AT + 86_400_000
const BROKER = "kraken"

const authorities = defineAuthorities(AUTHORITIES)

const storeOver = (over = {}) =>
  createBrokerAutomationPermitStore({
    authorities,
    buildRecords: COMPLIANT_BUILDS,
    brokers: [{ id: BROKER }],
    ...over
  })

/**
 * Assert a call throws with a given `.code`.
 *
 * Vitest's `toThrow(string)` matches the MESSAGE, and these errors carry a
 * machine-readable `code` that callers branch on — so the code is what gets
 * asserted, and the message is checked separately where its wording matters.
 */
function expectCode(fn, code) {
  let thrown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  expect(thrown, `expected a throw with code ${code}; nothing was thrown`).toBeInstanceOf(Error)
  expect(thrown.code).toBe(code)
  return thrown
}

describe("T16 fixtures — the registries still encode the geometry under test", () => {
  it("still describes that geometry, or it throws with a named reason", () => {
    expect(assertFixtureGeometry()).toBe(true)
  })
})

describe("T16 AC-024 — the flag defaults to false, at the record and at persistence", () => {
  it("creates a broker record with the flag false and the provenance fields null", () => {
    // AC-024:962 requires the default asserted "at the record type and at
    // persistence". This is the record type; `createBrokerAutomationPermitStore`
    // below is the persistence.
    const record = createBrokerRecord({ id: BROKER })
    expect(record).toEqual({
      id: BROKER,
      automationPermitted: false,
      permitChangedAt: null,
      permitChangedByAuthorityId: null,
      ceremonyUnlocked: false
    })
  })

  it("does not accept an incoming automationPermitted, so a caller cannot seed a permitted broker", () => {
    // A broker record that could be constructed already-permitted would make the
    // flag's default decorative: AC-024:961's "an absent flag must not mean
    // permitted" would hold only for records nobody built by hand.
    expect(() => createBrokerRecord({ id: BROKER, automationPermitted: true })).toThrow(/automationPermitted/)
    expect(() => createBrokerRecord({ id: BROKER, permitChangedByAuthorityId: REVIEW_LEAD.id })).toThrow(
      /permitChangedByAuthorityId/
    )
  })

  it("seeds a persisted broker at the same default", () => {
    const store = storeOver()
    expect(store.read(BROKER)).toEqual(createBrokerRecord({ id: BROKER }))
    expect(store.isAutomationPermitted(BROKER)).toBe(false)
  })

  it("refuses a broker record whose seed claims a permit, naming the field", () => {
    expect(() => storeOver({ brokers: [{ id: BROKER, automationPermitted: true }] })).toThrow(
      /automationPermitted/
    )
  })
})

describe("T16 — every change records the approving authority, in BOTH directions", () => {
  it("records the granting authority: who, when, and under what scope", () => {
    const store = storeOver()
    const result = store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })

    expect(result.changed).toBe(true)
    expect(result.record.automationPermitted).toBe(true)
    expect(result.record.permitChangedByAuthorityId).toBe(REVIEW_LEAD.id)
    expect(result.record.permitChangedAt).toBe(AT)

    const [event] = store.changes(BROKER)
    expect(event).toMatchObject({
      event: PERMIT_CHANGE_EVENT,
      field: "automationPermitted",
      brokerId: BROKER,
      from: false,
      to: true,
      approvedByAuthorityId: REVIEW_LEAD.id,
      approvedByAuthorityTitle: "Trading review lead",
      scope: ["trading", "release-governance"],
      roomKey: "markets",
      at: AT,
      retentionClass: PERMIT_CHANGE_RETENTION_CLASS
    })
    expect(event.approvedByAuthorityId).not.toBeNull()
  })

  it("records the DECLINING authority too — the decision under test", () => {
    const store = storeOver()
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    const decline = store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: false,
      authorityId: BUILD_LEAD.id,
      // NEUTRAL_ROOM, not the grant's own room. Under COMPLIANT_BUILDS build-lead
      // BUILT `markets`, so it may not sign anything held under that room — and the
      // decline names the scope the decliner acted in, which need not be the scope
      // the grant was made under. That the two cannot coincide when the decliner
      // built the granted room is the separation rule working.
      roomKey: NEUTRAL_ROOM,
      at: LATER
    })

    expect(decline.changed).toBe(true)
    expect(decline.record.automationPermitted).toBe(false)
    // The single-valued §4.3 field now names the DECLINER, not `null`. That is
    // the whole argument for requiring attribution on both directions: an
    // unattributed decline would write `null` here and erase the fact that
    // REVIEW_LEAD ever granted it.
    expect(decline.record.permitChangedByAuthorityId).toBe(BUILD_LEAD.id)

    const history = store.changes(BROKER)
    expect(history).toHaveLength(2)
    expect(history[1]).toMatchObject({
      from: true,
      to: false,
      approvedByAuthorityId: BUILD_LEAD.id,
      at: LATER
    })
  })

  it("refuses a grant with no approving authority, and writes nothing", () => {
    const store = storeOver()
    const error = expectCode(
      () => store.setAutomationPermitted({ brokerId: BROKER, permitted: true, roomKey: "markets", at: AT }),
      PERMIT_NO_AUTHORITY_CODE
    )
    expect(error.message).toMatch(/GRANT/)
    expect(error.message).toMatch(/approving authority/)

    expect(store.read(BROKER)).toEqual(createBrokerRecord({ id: BROKER }))
    expect(store.changes(BROKER)).toEqual([])
    expect(store.isAutomationPermitted(BROKER)).toBe(false)
  })

  it("refuses a decline with no approving authority, and writes nothing", () => {
    // The counter-case to the test above, and the one the literal reading of D5
    // would let through. Both are refused, for the reasons in the header.
    const store = storeOver()
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    const before = store.read(BROKER)

    const error = expectCode(
      () => store.setAutomationPermitted({ brokerId: BROKER, permitted: false, roomKey: "markets", at: LATER }),
      PERMIT_NO_AUTHORITY_CODE
    )
    expect(error.message).toMatch(/DECLINE/)

    expect(store.read(BROKER)).toEqual(before)
    expect(store.changes(BROKER)).toHaveLength(1)
  })

  it("treats an absent, empty and unknown authority id as the same refusal", () => {
    const store = storeOver()
    for (const authorityId of [undefined, null, "", "   "]) {
      expectCode(
        () =>
          store.setAutomationPermitted({
            brokerId: BROKER,
            permitted: true,
            authorityId,
            roomKey: "markets",
            at: AT
          }),
        PERMIT_NO_AUTHORITY_CODE
      )
    }
    // Unknown-but-present is a different, also-refused error: an approver nobody
    // registered cannot have signed anything.
    const error = expectCode(
      () =>
        store.setAutomationPermitted({
          brokerId: BROKER,
          permitted: true,
          authorityId: "auth:ghost",
          roomKey: "markets",
          at: AT
        }),
      UNKNOWN_AUTHORITY_CODE
    )
    expect(error.message).toContain("auth:ghost")
    expect(store.changes(BROKER)).toEqual([])
  })

  it("records a repeat of the same value, because a write assertion is an event too", () => {
    const store = storeOver()
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    const again = store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: LATER
    })

    // `changed: false` is the derived answer; the event is still written. The
    // alternative — silently succeeding — would give the caller no way to know
    // whether its assertion had any effect.
    expect(again.changed).toBe(false)
    expect(again.record.automationPermitted).toBe(true)
    expect(again.record.permitChangedAt).toBe(LATER)
    expect(store.changes(BROKER)).toHaveLength(2)
    expect(store.changes(BROKER)[1]).toMatchObject({ from: true, to: true, at: LATER })
  })
})

describe("T16 AC-035 — the separation check is on the write path, not only in a render", () => {
  it("refuses a grant whose approving authority built the room it is held under", () => {
    // This is what "may not be a convention or a UI-only warning" (AC-035:1049)
    // means in practice. The registry collides on `auth:build-lead`/`risk`, so a
    // grant approved by build-lead under `risk` cannot be written at all.
    const store = storeOver({ buildRecords: COLLIDING_BUILDS })
    const error = expectCode(
      () =>
        store.setAutomationPermitted({
          brokerId: BROKER,
          permitted: true,
          authorityId: BUILD_LEAD.id,
          roomKey: "risk",
          at: AT
        }),
      COLLISION_CODE
    )
    expect(error.message).toContain("auth:build-lead")
    expect(error.message).toContain("risk")

    expect(store.read(BROKER)).toEqual(createBrokerRecord({ id: BROKER }))
    expect(store.changes(BROKER)).toEqual([])
  })

  it("allows the same authority on a room it did not build", () => {
    const store = storeOver({ buildRecords: COLLIDING_BUILDS })
    const result = store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: BUILD_LEAD.id,
      roomKey: NEUTRAL_ROOM,
      at: AT
    })
    expect(result.record.automationPermitted).toBe(true)
  })

  it("allows a different approving authority on the colliding room", () => {
    // review-lead builds `ceremony` and approves `risk`; it never built `risk`,
    // so the grant is separable and is allowed.
    const store = storeOver({ buildRecords: COLLIDING_BUILDS })
    const result = store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "risk",
      at: AT
    })
    expect(result.record.automationPermitted).toBe(true)
  })

  it("refuses a DECLINE blocked by a collision, loudly, and leaves the record alone", () => {
    // The fail-open direction named in the header, pinned. The refusal is a named
    // throw and nothing is written — it is not a silent success, and the caller
    // cannot mistake a refused revoke for a performed one.
    const store = storeOver({ buildRecords: COLLIDING_BUILDS })
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "risk",
      at: AT
    })
    const before = store.read(BROKER)

    expectCode(
      () =>
        store.setAutomationPermitted({
          brokerId: BROKER,
          permitted: false,
          authorityId: BUILD_LEAD.id,
          roomKey: "risk",
          at: LATER
        }),
      COLLISION_CODE
    )

    expect(store.read(BROKER)).toEqual(before)
    expect(store.changes(BROKER)).toHaveLength(1)
  })
})

describe("T16 — the read is provenance-gated, so an unattributed grant is not readable as a permit", () => {
  it("reads false when the flag is true but the approver does not resolve", () => {
    // The mitigation for the fail-open direction. `isAutomationPermitted` needs
    // BOTH a true flag AND a resolvable approving authority, so a record patched
    // with a bare boolean — by a migration, a hand edit, or a future caller that
    // bypasses this store — does not read as permission. This is AC-024:961's
    // "an absent flag must not mean permitted" applied to provenance as well as
    // to value.
    //
    // Two halves. First: a correctly granted permit reads true.
    const store = storeOver()
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    expect(store.read(BROKER).automationPermitted).toBe(true)
    expect(store.isAutomationPermitted(BROKER)).toBe(true)

    // Second: the same record read against an authority set that no longer
    // contains the approver reads FALSE. The flag still says true; the grant no
    // longer has a signer, and a grant with no signer is not a permit.
    expect(store.isAutomationPermitted(BROKER, { authorities: defineAuthorities([BUILD_LEAD]) })).toBe(false)
    expect(store.isAutomationPermitted(BROKER, { authorities: defineAuthorities([]) })).toBe(false)

    // And a decline always reads false, whoever approved it.
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: false,
      authorityId: BUILD_LEAD.id,
      roomKey: NEUTRAL_ROOM,
      at: LATER
    })
    expect(store.read(BROKER).automationPermitted).toBe(false)
    expect(store.isAutomationPermitted(BROKER)).toBe(false)
  })

  it("reads false for an unknown broker rather than inventing one", () => {
    const store = storeOver()
    expect(store.read("no-such-broker")).toBeNull()
    expect(store.isAutomationPermitted("no-such-broker")).toBe(false)
    expect(store.changes("no-such-broker")).toEqual([])
  })

  it("refuses to change a broker that does not exist", () => {
    const store = storeOver()
    expectCode(
      () =>
        store.setAutomationPermitted({
          brokerId: "no-such-broker",
          permitted: true,
          authorityId: REVIEW_LEAD.id,
          roomKey: "markets",
          at: AT
        }),
      UNKNOWN_BROKER_CODE
    )
  })

  it("requires the caller to supply `at`, so the module owns no clock", () => {
    const store = storeOver()
    expect(() =>
      store.setAutomationPermitted({
        brokerId: BROKER,
        permitted: true,
        authorityId: REVIEW_LEAD.id,
        roomKey: "markets"
      })
    ).toThrow(/at/)
    expect(() =>
      store.setAutomationPermitted({
        brokerId: BROKER,
        permitted: true,
        authorityId: REVIEW_LEAD.id,
        roomKey: "markets",
        at: "yesterday"
      })
    ).toThrow(/at/)
  })

  it("requires a roomKey, because the grant is held under a named scope of authority", () => {
    const store = storeOver()
    expect(() =>
      store.setAutomationPermitted({
        brokerId: BROKER,
        permitted: true,
        authorityId: REVIEW_LEAD.id,
        at: AT
      })
    ).toThrow(/roomKey/)
  })
})

describe("T16 — the change log is append-only, like the veto record", () => {
  it("has no update, delete, clear or set", () => {
    // D8:157-165 and §4.3:601 make veto/score/receipt records permanently
    // append-only. A permit-change event is the evidence that auto-execute was
    // authorised at all, so it is held to the same rule, and the test asserts the
    // ABSENCE of every mutator by name — so it fails if one is ever added.
    const store = storeOver()
    for (const mutator of ["update", "delete", "remove", "clear", "reset", "set", "patch"]) {
      expect(store[mutator], `store must not expose ${mutator}()`).toBeUndefined()
    }
    expect(typeof store.setAutomationPermitted).toBe("function")
  })

  it("hands out copies, so a caller cannot mutate a logged event", () => {
    const store = storeOver()
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    const events = store.changes(BROKER)
    expect(Object.isFrozen(events)).toBe(true)
    expect(Object.isFrozen(events[0])).toBe(true)
    expect(Object.isFrozen(events[0].scope)).toBe(true)
    // Both the array and its entries resist mutation, so the log is only ever
    // appended to through the setter.
    expect(() => events.push({})).toThrow()
    expect(() => {
      events[0].to = false
    }).toThrow()
    expect(store.changes(BROKER)).toHaveLength(1)
    expect(store.changes(BROKER)[0].to).toBe(true)
  })

  it("numbers events per store, so the grant/decline pair is ordered and complete", () => {
    const store = storeOver({ brokers: [{ id: BROKER }, { id: "coinbase" }] })
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    store.setAutomationPermitted({
      brokerId: "coinbase",
      permitted: true,
      authorityId: BUILD_LEAD.id,
      roomKey: NEUTRAL_ROOM,
      at: AT + 1
    })
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: false,
authorityId: BUILD_LEAD.id,
      roomKey: NEUTRAL_ROOM,
      at: LATER
    })
    expect(store.changes(BROKER).map((e) => [e.sequence, e.to])).toEqual([
      [1, true],
      [3, false]
    ])
    expect(store.changes("coinbase").map((e) => [e.sequence, e.to])).toEqual([[2, true]])
    expect(store.allChanges().map((e) => e.sequence)).toEqual([1, 2, 3])
  })

  it("forwards every event to an injected sink, and a throwing sink propagates", () => {
    const seen = []
    const store = storeOver({ changeSink: (event) => seen.push(event) })
    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].approvedByAuthorityId).toBe(REVIEW_LEAD.id)

    const loud = storeOver({
      changeSink: () => {
        throw new Error("sink: downstream refused the audit write")
      }
    })
    expect(() =>
      loud.setAutomationPermitted({
        brokerId: BROKER,
        permitted: true,
        authorityId: REVIEW_LEAD.id,
        roomKey: "markets",
        at: AT
      })
    ).toThrow(/audit write/)
  })

  it("uses a retention class from D8's vocabulary, and says why it chose it", () => {
    // D8:157-165 names three classes and assigns `permanent_append_only` to
    // veto decisions, score breakdowns and execution receipts. A permit-change
    // event is none of those three, so the assignment is T16's judgement — the
    // conservative one, because deleting the event removes the only evidence
    // that auto-execute was ever authorised. T15 owns `retention.mjs` and may
    // re-route it; no purge path exists here either way.
    expect(PERMIT_CHANGE_RETENTION_CLASS).toBe("permanent_append_only")
  })
})

describe("T16 — the store composes with T11's tier decision and does not restate it", () => {
  it("hands the engine exactly the store's boolean, so the two agree on every broker", () => {
    // The wire-up, proved without inventing a market shape. T16 owns no tier
    // logic and derives no score; it produces one boolean, and this asserts the
    // engine receives it. The state is T11's own `fullMarketState` fixture with
    // T11's own overrides, so a change in T11's inputs shows up here as a T11
    // failure rather than as a T16 one.
    const state = fullMarketState({
      computedAt: atUtc(2026, 3, 10, 12, 0),
      newsEvents: [],
      proposals: [{ symbol: "BTCUSD", correlationGroup: "crypto" }],
      facts: { direction: "long", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 }
    })

    const store = storeOver()
    const before = evaluateCopilot({
      marketState: state,
      broker: { automationPermitted: store.isAutomationPermitted(BROKER), rung: "paper" },
      recordVetoes: false
    })
    expect(before.tier.automationPermitted).toBe(false)
    expect(before.tier.action).not.toBe("autoExecute")

    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    const after = evaluateCopilot({
      marketState: state,
      broker: { automationPermitted: store.isAutomationPermitted(BROKER), rung: "paper" },
      recordVetoes: false
    })
    expect(after.tier.automationPermitted).toBe(true)
  })

  it("changes AC-024's outcome, at a score T11 itself placed above the boundary", () => {
    // T11 tests `tierFor` with explicit scores because no market fixture of its
    // own scores A+; inventing one here would mean reverse-engineering T11's
    // confluence, which is a second copy of the arithmetic and exactly what plan
    // v1 §2's Risk 6 warns against. So this calls T11's OWN exported `tierFor`
    // with T11's OWN boundary value, changing only the store's boolean.
    //
    // If T16 had its own idea of what a permit authorises, this is where it would
    // show: the same score, the same rung, the same empty veto set, two
    // different actions.
    const store = storeOver()
    const decisionFor = () =>
      tierFor(90, {
        vetoes: [],
        automationPermitted: store.isAutomationPermitted(BROKER),
        rung: "paper"
      }).action

    expect(decisionFor()).toBe("notifyForApproval")

    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: true,
      authorityId: REVIEW_LEAD.id,
      roomKey: "markets",
      at: AT
    })
    expect(decisionFor()).toBe("autoExecute")

    store.setAutomationPermitted({
      brokerId: BROKER,
      permitted: false,
      authorityId: BUILD_LEAD.id,
      roomKey: NEUTRAL_ROOM,
      at: LATER
    })
    expect(decisionFor()).toBe("notifyForApproval")
  })
})

describe("T16 — purity: the store takes its timestamp, it does not read one", () => {
  it("the module source reaches for no clock, network, randomness or filesystem", () => {
    const path = fileURLToPath(new URL("../brokerAutomationPermit.mjs", import.meta.url))
    const source = readFileSync(path, "utf8")
    for (const forbidden of ["Date.now", "new Date", "Math.random", "fetch(", "node:fs", "node:net", "node:http"]) {
      expect(source.includes(forbidden), `brokerAutomationPermit.mjs must not contain ${forbidden}`).toBe(false)
    }
  })
})
