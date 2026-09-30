// WS-7 T16 — the mechanical build/approve collision detector. AC-035 / R12.2 /
// D12. T16's bisect line (:1343): "The detector is a pure function testable with
// fixtures; the Ministry room consumes it."
//
// AC-035:1045-1051 is the binding criterion:
//   Scenario:  An authority whose `canApprove` includes a room also appears as
//              that room's builder.
//   Action:    Evaluate the separation check.
//   Expected:  A hard failure naming the authority and the room.
//   Prohibited: The rule may not be a convention or a UI-only warning.
//   Verification: A collision test plus a positive test for a compliant pair.
//
// THE CONDITION, IN ONE SENTENCE:
//
//   A collision exists for authority A and room R when and only when R is in
//   A.canApprove AND A appears in the build registry for R — over ANY build
//   verb, for ANY authority, and for ANY room, with no regard to `scope`, to how
//   many authorities exist, or to what any room is called.
//
// Three things the condition deliberately does NOT contain, each with its own
// test below:
//
//   - `scope`. §4.3:642-648 annotates `canApprove` and says nothing about
//     `scope`; D12 states the collision in terms of builds. A `scope`-based rule
//     would be a second, different control wearing this one's name.
//   - A verb allowlist. D12 says "builds", and a build is a construct, a deploy
//     or a promotion. Treating "deploy" as not-a-build because only
//     "construct" was implemented would leave the hole open on the exact verb a
//     promotion goes through. The verb is validated as a member of a closed
//     vocabulary, not used to decide whether a build happened.
//   - A special case. The near-miss control is the one that matters: an
//     authority that builds room X and approves room Y is the normal, correct
//     ministry arrangement and must pass.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { defineAuthorities } from "../authorityModel.mjs"
import {
  BUILD_ACTIONS,
  COLLISION_CODE,
  UNKNOWN_AUTHORITY_CODE,
  assertNoBuildApproveCollisionFor,
  assertNoBuildApproveCollisions,
  buildersOfRoom,
  detectBuildApproveCollisions,
  describeRoomSeparation
} from "../separationOfDuties.mjs"
import {
  AUDIT_ONLY,
  AUTHORITIES,
  BUILD_LEAD,
  COLLIDING_BUILDS,
  COMPLIANT_BUILDS,
  REVIEW_LEAD,
  TRADING_OPS,
  UNREGISTERED_BUILDS,
  assertFixtureGeometry,
  build
} from "./fixtures/authorityFixtures.mjs"

const authorities = defineAuthorities(AUTHORITIES)

describe("T16 fixtures — the registries still encode the geometry under test", () => {
  it("still describes that geometry, or it throws with a named reason", () => {
    expect(assertFixtureGeometry()).toBe(true)
  })
})

describe("T16 AC-035 — the collision is detected and both offenders are named", () => {
  it("fails when one authority both builds and approves the same room", () => {
    const report = detectBuildApproveCollisions({ authorities, buildRecords: COLLIDING_BUILDS })
    expect(report.ok).toBe(false)
    expect(report.collisions).toHaveLength(1)
    expect(report.collisions[0]).toMatchObject({
      authorityId: "auth:build-lead",
      authorityTitle: "Trading build lead",
      roomKey: "risk",
      approvedVia: "canApprove"
    })
  })

  it("names the build verb and the record that produced the collision", () => {
    // AC-035:1048 asks for "a hard failure naming the authority and the room".
    // A report that named neither would be a boolean wearing a report's shape,
    // and the governance surface could not act on it.
    const [collision] = detectBuildApproveCollisions({
      authorities,
      buildRecords: COLLIDING_BUILDS
    }).collisions

    expect(collision.authorityId).toBe("auth:build-lead")
    expect(collision.roomKey).toBe("risk")
    expect(collision.builds.length).toBeGreaterThan(0)
    expect(collision.builds[0]).toMatchObject({ action: "construct" })
  })

  it("throws from the asserting form, with a stable code and both names in the message", () => {
    // "The rule may not be a convention" (AC-035:1049) means something has to
    // THROW. The message is what an operator reads, so it carries the pair.
    let thrown = null
    try {
      assertNoBuildApproveCollisions({ authorities, buildRecords: COLLIDING_BUILDS })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.code).toBe(COLLISION_CODE)
    expect(thrown.message).toContain("auth:build-lead")
    expect(thrown.message).toContain("risk")
  })

  it("is not a warning: the throwing form is what the persistence path calls", () => {
    // The detector's own `ok: false` is the readable verdict. The refusal is
    // `assertNoBuildApproveCollisions`. Both exist, and only one of them is used
    // to block — see `brokerAutomationPermit.test.mjs`, which asserts the write
    // path refuses.
    expect(() =>
      detectBuildApproveCollisions({ authorities, buildRecords: COLLIDING_BUILDS })
    ).not.toThrow()
    expect(() =>
      assertNoBuildApproveCollisions({ authorities, buildRecords: COLLIDING_BUILDS })
    ).toThrow(COLLISION_CODE)
  })
})

describe("T16 AC-035 — the compliant pair passes, and the near-miss is not a collision", () => {
  it("passes a registry with no overlap", () => {
    const report = detectBuildApproveCollisions({ authorities, buildRecords: COMPLIANT_BUILDS })
    expect(report.ok).toBe(true)
    expect(report.collisions).toEqual([])
    expect(() => assertNoBuildApproveCollisions({ authorities, buildRecords: COMPLIANT_BUILDS })).not.toThrow()
  })

  it("does not treat an authority that builds X and approves Y as a collision", () => {
    // THE near-miss control. `auth:build-lead` builds `markets` and approves
    // `risk`/`ceremony`; `auth:review-lead` builds `markets` and approves three
    // rooms. Both are the ordinary ministry arrangement.
    const report = detectBuildApproveCollisions({ authorities, buildRecords: COMPLIANT_BUILDS })
    expect(report.ok).toBe(true)

    const buildLeadRoom = describeRoomSeparation({
      authorities,
      buildRecords: COMPLIANT_BUILDS,
      roomKey: "markets"
    })
    expect(buildLeadRoom.builders).toEqual(["auth:build-lead"])
    expect(buildLeadRoom.approvers).not.toContain("auth:build-lead")
  })

  it("does not treat two authorities on the same room as a collision by themselves", () => {
    // `auth:trading-ops` BUILDS `risk`; `auth:build-lead` APPROVES `risk`.
    // Different authorities, so no pair collides — which is the entire point of
    // the model. A detector keyed on the ROOM rather than on the (authority,
    // room) pair would fail here.
    const only = [build(TRADING_OPS.id, "risk", "construct")]
    const report = detectBuildApproveCollisions({ authorities, buildRecords: only })
    expect(report.ok).toBe(true)
    expect(report.collisions).toEqual([])

    const view = describeRoomSeparation({ authorities, buildRecords: only, roomKey: "risk" })
    expect(view.builders).toEqual(["auth:trading-ops"])
    expect(view.approvers).toEqual(["auth:build-lead"])
    expect(view.separated).toBe(true)
  })

  it("does not treat an authority that only builds, or only approves, as a collision", () => {
    const onlyBuilds = [build(AUDIT_ONLY.id, "risk", "deploy")]
    expect(detectBuildApproveCollisions({ authorities, buildRecords: onlyBuilds }).ok).toBe(true)

    const onlyApproves = defineAuthorities([TRADING_OPS])
    expect(detectBuildApproveCollisions({ authorities: onlyApproves, buildRecords: [] }).ok).toBe(true)
  })
})

describe("T16 — the condition is general, not an example", () => {
  it("evaluates every (authority, room) pair, across the whole registry", () => {
    // Exhaustive matrix over four authorities x four rooms, for every build verb.
    // The expected verdict is computed from the CONDITION, independently of the
    // implementation: an (A, R) pair collides iff approve(A, R) and A built R.
    const rooms = ["risk", "markets", "ceremony", "dispatch"]
    const verbs = [...BUILD_ACTIONS]

    for (const verb of verbs) {
      for (const room of rooms) {
        for (const authority of AUTHORITIES) {
          const records = [build(authority.id, room, verb)]
          const report = detectBuildApproveCollisions({ authorities, buildRecords: records })

          const approves = authority.canApprove.includes(room)
          expect(
            report.ok,
            `verb=${verb} room=${room} authority=${authority.id} approves=${approves}`
          ).toBe(!approves)

          if (approves) {
            expect(report.collisions).toHaveLength(1)
            expect(report.collisions[0].authorityId).toBe(authority.id)
            expect(report.collisions[0].roomKey).toBe(room)
          } else {
            expect(report.collisions).toEqual([])
          }
        }
      }
    }
  })

  it("reports every colliding pair, not just the first", () => {
    const records = [
      build(BUILD_LEAD.id, "risk", "construct"),
      build(BUILD_LEAD.id, "ceremony", "deploy"),
      build(REVIEW_LEAD.id, "markets", "promote")
    ]
    const report = detectBuildApproveCollisions({ authorities, buildRecords: records })
    expect(report.ok).toBe(false)
    expect(report.collisions.map((c) => `${c.authorityId}/${c.roomKey}`)).toEqual([
      "auth:build-lead/risk",
      "auth:build-lead/ceremony",
      "auth:review-lead/markets"
    ])
  })

  it("collides on a build record that arrived after the approval grant", () => {
    // The registry is a set of facts, not a log, so "when" is not part of the
    // condition. A build recorded after the grant collides exactly as one
    // recorded before it does — otherwise the order of two appends would decide
    // whether a control holds.
    const grantedFirst = detectBuildApproveCollisions({
      authorities,
      buildRecords: [
        build(REVIEW_LEAD.id, "risk", "construct"),
        build(BUILD_LEAD.id, "risk", "deploy")
      ]
    })
    expect(grantedFirst.ok).toBe(false)
    expect(grantedFirst.collisions[0]).toMatchObject({ authorityId: "auth:build-lead", roomKey: "risk" })
  })

  it("counts all three build verbs as building", () => {
    // `BUILD_ACTIONS` is the closed vocabulary. A verb outside it is REJECTED
    // rather than ignored: a typo that silently dropped a build record would
    // leave the control passing on missing evidence.
    for (const action of BUILD_ACTIONS) {
      const report = detectBuildApproveCollisions({
        authorities,
        buildRecords: [build(BUILD_LEAD.id, "risk", action)]
      })
      expect(report.ok, `action=${action}`).toBe(false)
      expect(report.collisions[0].builds[0].action).toBe(action)
    }
    expect(() =>
      detectBuildApproveCollisions({
        authorities,
        buildRecords: [build(BUILD_LEAD.id, "risk", "ship-it")]
      })
    ).toThrow(/ship-it/)
  })

  it("handles empty registries as an answer, not a crash", () => {
    expect(detectBuildApproveCollisions({ authorities: [], buildRecords: [] })).toMatchObject({
      ok: true,
      collisions: []
    })
    expect(detectBuildApproveCollisions({ authorities, buildRecords: [] }).ok).toBe(true)
    expect(detectBuildApproveCollisions({ authorities: [], buildRecords: COLLIDING_BUILDS }).ok).toBe(true)
  })

  it("collects a room's builders, deduplicated and in first-seen order", () => {
    const records = [
      build(REVIEW_LEAD.id, "risk", "construct"),
      build(BUILD_LEAD.id, "risk", "deploy"),
      build(REVIEW_LEAD.id, "risk", "promote")
    ]
    expect(buildersOfRoom(records, "risk")).toEqual(["auth:review-lead", "auth:build-lead"])
    expect(buildersOfRoom(records, "no-such-room")).toEqual([])
  })
})

describe("T16 — purity: no clock, no network, no randomness, no I/O", () => {
  it("the detector source reaches for none of them", () => {
    // Asserted against the module's own source rather than trusted, because the
    // anti-goal is a property of the code, not of this test's inputs. The
    // detector is consumed from fixtures at arbitrary times; a `Date.now()`
    // inside it would make an AC-035 verdict unreproducible.
    const path = fileURLToPath(new URL("../separationOfDuties.mjs", import.meta.url))
    const source = readFileSync(path, "utf8")

    for (const forbidden of [
      "Date.now",
      "new Date",
      "performance.now",
      "Math.random",
      "fetch(",
      "node:fs",
      "node:net",
      "node:http",
      "require(",
      "await "
    ]) {
      expect(source.includes(forbidden), `separationOfDuties.mjs must not contain ${forbidden}`).toBe(false)
    }
  })

  it("imports nothing at all — a detector that reads no input it was not handed", () => {
    const path = fileURLToPath(new URL("../separationOfDuties.mjs", import.meta.url))
    const source = readFileSync(path, "utf8")
    const importLines = source.split(/\r?\n/).filter((line) => /^\s*import\s/.test(line))
    expect(importLines).toEqual([])
  })

  it("returns the same answer for permuted inputs", () => {
    const permuted = [...COLLIDING_BUILDS].reverse()
    const a = detectBuildApproveCollisions({ authorities, buildRecords: COLLIDING_BUILDS })
    const b = detectBuildApproveCollisions({ authorities, buildRecords: permuted })
    // Collision ORDER is derived from the authority set, not from the registry
    // order, so two runs over the same facts are byte-identical. Ordering luck
    // is what T12 had to refute for C1-vs-C2; the same defence applies here.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("does not mutate its inputs", () => {
    const records = [...COLLIDING_BUILDS]
    const before = JSON.stringify(records)
    const snapshot = authorities.map((a) => a.canApprove.slice())
    detectBuildApproveCollisions({ authorities, buildRecords: records })
    expect(JSON.stringify(records)).toBe(before)
    expect(authorities.map((a) => a.canApprove)).toEqual(snapshot)
  })
})

describe("T16 — referential integrity is reported separately from a collision", () => {
  it("names a build record whose authority is not registered", () => {
    // A build by an unregistered authority is not a build/approve collision —
    // there is no `canApprove` to collide with — but it is a hole: a build that
    // no record can be matched against can never collide. Kept as its own field
    // so the collision condition stays exactly AC-035's.
    const report = detectBuildApproveCollisions({
      authorities,
      buildRecords: [...COLLIDING_BUILDS, ...UNREGISTERED_BUILDS]
    })
    expect(report.unknownAuthorityIds).toEqual(["auth:ghost"])
    expect(report.collisions.map((c) => c.roomKey)).toEqual(["risk"])  })

  it("refuses to certify a registry with an unregistered builder", () => {
    let thrown = null
    try {
      assertNoBuildApproveCollisions({ authorities, buildRecords: UNREGISTERED_BUILDS })
    } catch (error) {
      thrown = error
    }
    expect(thrown.code).toBe(UNKNOWN_AUTHORITY_CODE)
    expect(thrown.message).toContain("auth:ghost")
  })
})

describe("T16 — the focused single-pair check the persistence path uses", () => {
  it("throws naming the pair when the approving authority built the room", () => {
    let thrown = null
    try {
      assertNoBuildApproveCollisionFor({
        authorities,
        buildRecords: COLLIDING_BUILDS,
        authorityId: "auth:build-lead",
        roomKey: "risk"
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown.code).toBe(COLLISION_CODE)
    expect(thrown.message).toContain("auth:build-lead")
    expect(thrown.message).toContain("risk")
  })

  it("passes the same authority on a room it did not build", () => {
    // `auth:build-lead` builds `risk` and `markets` in COLLIDING_BUILDS.
    // `simulator` is a room it never touched.
    expect(() =>
      assertNoBuildApproveCollisionFor({
        authorities,
        buildRecords: COLLIDING_BUILDS,
        authorityId: "auth:build-lead",
        roomKey: "simulator"
      })
    ).not.toThrow()
  })

  it("refuses a builder of the room even when that authority does not approve it", () => {
    // THE deliberate difference between the two forms, and the one a reader is
    // most likely to get wrong.
    //
    //   detectBuildApproveCollisions   needs approve(A, R) AND built(A, R).
    //   assertNoBuildApproveCollisionFor needs built(A, R) only.
    //
    // The focused form is the WRITE-PATH guard, and its `authorityId` is by
    // construction the party APPROVING the grant. It therefore does not re-ask
    // whether the authority approves the room — the caller is asserting it. What
    // it does ask is whether that same party built the room the grant is held
    // under. Keying it on `canApprove` instead would let an authority that built
    // a room but holds no approval over it pass a check whose entire question is
    // "did the approver also build it".
    //
    // So `markets` is refused here while the aggregate report calls it clean —
    // correctly, since build-lead never approves `markets` and there is no
    // approval to collide with. Both are asserted below.
    expect(() =>
      assertNoBuildApproveCollisionFor({
        authorities,
        buildRecords: COLLIDING_BUILDS,
        authorityId: "auth:build-lead",
        roomKey: "markets"
      })
    ).toThrow(COLLISION_CODE)

    const aggregate = describeRoomSeparation({
      authorities,
      buildRecords: COLLIDING_BUILDS,
      roomKey: "markets"
    })
    expect(aggregate.collisions).toEqual([])
    expect(aggregate.separated).toBe(true)
  })

  it("passes an approving authority that built nothing", () => {
    expect(() =>
      assertNoBuildApproveCollisionFor({
        authorities,
        buildRecords: COLLIDING_BUILDS,
        authorityId: "auth:audit-only",
        roomKey: "risk"
      })
    ).not.toThrow()
  })

  it("refuses an approving authority that is not registered at all", () => {
    // "Absent is not permitted", applied to identity. An unknown approver is
    // refused, not treated as an authority with an empty build history.
    expect(() =>
      assertNoBuildApproveCollisionFor({
        authorities,
        buildRecords: COLLIDING_BUILDS,
        authorityId: "auth:ghost",
        roomKey: "risk"
      })
    ).toThrow(/auth:ghost/)
  })
})

describe("T16 — the per-room projection the Ministry room will consume", () => {
  it("reports builders, approvers and collisions for one room", () => {
    const view = describeRoomSeparation({
      authorities,
      buildRecords: COLLIDING_BUILDS,
      roomKey: "risk"
    })
    expect(view.roomKey).toBe("risk")
    expect(view.builders).toEqual(["auth:build-lead"])
    expect(view.approvers).toEqual(["auth:build-lead"])
    expect(view.collisions.map((c) => c.authorityId)).toEqual(["auth:build-lead"])
    expect(view.separated).toBe(false)
  })

  it("reports the near-miss room in the SAME colliding registry as separated", () => {
    // `markets` sits in COLLIDING_BUILDS beside the `risk` collision, is built by
    // build-lead and approved by review-lead, and is separated. A per-room
    // projection that could not say "this one is clean" would be useless to a
    // governance surface, and one that said "clean" for `risk` would be worse.
    const view = describeRoomSeparation({
      authorities,
      buildRecords: COLLIDING_BUILDS,
      roomKey: "markets"
    })
    expect(view.separated).toBe(true)
    expect(view.builders).toEqual(["auth:build-lead"])
    expect(view.approvers).toEqual(["auth:review-lead"])
    expect(view.collisions).toEqual([])
  })

  it("reports a clean room as separated, with its builders and approvers still named", () => {
    const view = describeRoomSeparation({
      authorities,
      buildRecords: COMPLIANT_BUILDS,
      roomKey: "markets"
    })
    expect(view.separated).toBe(true)
    expect(view.collisions).toEqual([])
    expect(view.builders).toEqual(["auth:build-lead"])
    expect(view.approvers).toEqual(["auth:review-lead"])
  })

  it("does not need a room key that exists anywhere else in the system", () => {
    // The Ministry room has no route key yet — T7R-A owns that amendment. The
    // projection therefore treats a room key as an opaque string and never
    // looks it up in a room table, so T16 needs no key of its own.
    const view = describeRoomSeparation({
      authorities,
      buildRecords: [],
      roomKey: "ministry"
    })
    expect(view.roomKey).toBe("ministry")
    expect(view.builders).toEqual([])
    expect(view.approvers).toEqual([])
    expect(view.separated).toBe(true)
  })
})
