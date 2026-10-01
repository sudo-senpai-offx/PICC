// @vitest-environment jsdom
// WS-7 T8 room instance 4 of 22 (D1's order): Ministry.
//
// AC-020 for this room: it renders real data with honest provenance, holds no
// reserved placeholder a later task was expected to fill, and its own invariants
// are green. Its D27 obligation is that `MINISTRY_COMPLETION` EXPLICITLY states
// whether the room is genuinely complete or whether scope logically belongs to
// WS-8, naming that scope.
//
// THE HEADLINE HERE IS D10. `WS-7+` is a DISPLAY VALUE for anything unassigned,
// never an authority id — T16 asserts `authorityById(authorities, "WS-7+")` is
// `null`. So the anti-goal "Ministry inventing a string for unassigned other
// than WS-7+" is held STRUCTURALLY below: this file reads the room, the domain
// projection and the surface, and asserts that NONE of them contains the literal.
// The string reaches the room from the route, which takes it from T16's own
// `unassignedAuthorityLabel()`. A client-side copy could not drift from T16
// because there is none to drift.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { MinistryRoom, MINISTRY_COMPLETION, buildMinistryView } from "../MinistryRoom"
import { ministryGovernanceView, separationStateFor } from "../../domain/ministryGovernance"
import { fetchMinistryGovernance } from "../../adapters/governanceReading"
import { authorityById, unassignedAuthorityLabel } from "../../../../server/services/authority/authorityModel.mjs"

/** D10's reservation. Written here ONCE, so a test can compare against a literal. */
const RESERVATION = "WS-7+"

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")

/**
 * The file's CODE, with comment content blanked ACROSS LINES.
 *
 * The claim under test is that no module EMITS the reservation. A comment that
 * quotes the literal in order to EXPLAIN D10 is documentation, and treating it as
 * a second copy would be the same defect
 * `ws7RouteAuthCoverageGuard.test.mjs` documents for gate names appearing in
 * prose — a comment read as a call site. So the assertion runs on code, exactly
 * as that guard does after `stripComments`.
 *
 * THE BLOCK STATE IS CARRIED ACROSS LINES, and that is the whole point. A first
 * attempt stripped `//` and `/*` per line, which is unsound in the exact way that
 * guard describes: `MinistryRoom.tsx` explains D10 in a `/** … *\/` block, so
 * only the OPENING line carries `/*` and every interior line — the ones holding
 * the explanation — survived. The result was a false failure against the very
 * comment the assertion is meant to ignore.
 *
 * Neither form is string-aware, which is exact here because none of these three
 * files contains `//` or `/*` inside a string literal — and if one ever did, the
 * failure would be a loud, explicable false positive rather than a silent pass.
 */
const readCode = (relative: string) => {
  let inBlock = false
  return read(relative)
    .split("\n")
    .map((raw) => {
      let line = raw
      if (inBlock) {
        const close = line.indexOf("*/")
        if (close === -1) return ""
        line = line.slice(close + 2)
        inBlock = false
      }
      const open = line.indexOf("/*")
      if (open !== -1) {
        const close = line.indexOf("*/", open + 2)
        if (close === -1) {
          inBlock = true
          line = line.slice(0, open)
        } else {
          line = line.slice(0, open) + line.slice(close + 2)
        }
      }
      const at = line.indexOf("//")
      return at === -1 ? line : line.slice(0, at)
    })
    .join("\n")
}

/** A readout in the route's own shape (`handlers.mjs`, `GET /api/trading/ministry`). */
function readout(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    governanceVersion: "ministry-governance/1.0.0",
    unassignedAuthority: RESERVATION,
    authorities: {
      registered: [],
      count: 0,
      reason: "No authority registry is wired to this readout."
    },
    buildRegistry: {
      recordCount: 0,
      roomsCovered: [],
      reason: "The build registry has no producer."
    },
    rooms: [
      {
        roomKey: "markets",
        builders: [],
        approvers: [],
        collisions: [],
        separated: true,
        approverDisplay: RESERVATION,
        approverCount: 0,
        builderCount: 0
      },
      {
        roomKey: "risk",
        builders: [],
        approvers: [],
        collisions: [],
        separated: true,
        approverDisplay: RESERVATION,
        approverCount: 0,
        builderCount: 0
      }
    ],
    separation: {
      code: "authority:collide:build-approve",
      ok: true,
      collisionCount: 0,
      approverAuthorityCount: 0,
      roomsWithAnApprover: 0,
      checkedAuthorities: 0
    },
    permits: {
      brokers: [],
      changeCount: 0,
      grants: [],
      reason: "No automationPermitted change has been recorded."
    },
    refusalCodes: [
      { code: "authority:collide:build-approve", surface: "separation", message: "An authority may both build and approve the same room (D12)." }
    ],
    ...over
  }
}

describe("WS-7 T8 — Ministry room: D10's reservation is never invented client-side", () => {
  it("T16's own model agrees that the reservation is not an authority", () => {
    // The producer's assertion, re-run here so the room's display value rests on
    // the model's real behaviour rather than on T16's test having once passed.
    expect(unassignedAuthorityLabel()).toBe(RESERVATION)
    expect(authorityById([], RESERVATION)).toBeNull()
    // A set with real records still does not resolve the reservation, which is
    // what stops a synthesised record from satisfying a separation check.
    expect(
      authorityById([{ id: "auth:real", title: "Real", scope: [], canApprove: ["markets"] }], RESERVATION)
    ).toBeNull()
  })

  it("NO client module in this room contains a WS-7+ literal", () => {
    // The structural form of the anti-goal. Three files, one assertion each:
    // the room, the domain projection and the surface. The string arrives from
    // the route, so if any of these ever hard-codes it there would be a second
    // copy of D10's reservation that could drift from T16's.
    for (const relative of ["../MinistryRoom.tsx", "../../domain/ministryGovernance.ts", "../../components/MinistrySurface.tsx"]) {
      const code = readCode(relative)
      expect(
        code,
        `${relative} must not EMIT a ${RESERVATION} literal — the reservation is emitted by the route from ` +
          `T16's unassignedAuthorityLabel() and displayed, never retyped here. A second copy is the fabrication D10 exists to prevent.`
      ).not.toContain(RESERVATION)
    }
  })

  it("renders an UNASSIGNED capability as the reservation, and it is not a blank cell", () => {
    const html = renderToStaticMarkup(<MinistryRoom readout={readout()} />)

    // The approver cell carries the reservation for every unassigned room, so an
    // unassigned capability is VISIBLY unassigned rather than empty.
    expect(html).toContain(`data-approver="${RESERVATION}"`)
    expect(html).toContain("approver: WS-7+")
    // And it is not being rendered as an authority: no record exists for it.
    expect(html).not.toContain(`data-authority="${RESERVATION}"`)
  })

  it("distinguishes an UNASSIGNED capability from a GENUINELY ABSENT one", () => {
    // The distinction the brief names. An unassigned room shows the reservation;
    // a room the readout did not evaluate has NO row at all. Neither is a blank,
    // and neither is a clean bill of health.
    const populated = renderToStaticMarkup(<MinistryRoom readout={readout()} />)
    expect(populated).toContain('data-room-rows="2"')

    // No reservation supplied by the server: the room NAMES the absence instead of
    // substituting a locally-held literal. This is the branch that proves the
    // projection does not own the string.
    const withoutReservation = renderToStaticMarkup(
      <MinistryRoom readout={readout({ unassignedAuthority: null, rooms: [{ roomKey: "markets", builders: [], approvers: [], collisions: [], separated: true }] })} />
    )
    expect(withoutReservation).not.toContain(RESERVATION)
    expect(withoutReservation).toContain("the readout supplied no reservation")
  })

  it("renders an ASSIGNED approver as that authority's id, and not as the reservation", () => {
    const html = renderToStaticMarkup(
      <MinistryRoom
        readout={readout({
          authorities: {
            registered: [{ id: "auth:review-lead", title: "Review lead", scope: ["markets review"], canApprove: ["markets"] }],
            count: 1,
            reason: null
          },
          rooms: [
            {
              roomKey: "markets",
              builders: ["auth:build-lead"],
              approvers: ["auth:review-lead"],
              collisions: [],
              separated: true,
              approverDisplay: "auth:review-lead",
              approverCount: 1,
              builderCount: 1
            }
          ],
          separation: {
            code: "authority:collide:build-approve",
            ok: true,
            collisionCount: 0,
            approverAuthorityCount: 1,
            roomsWithAnApprover: 1,
            checkedAuthorities: 1
          }
        })}
      />
    )

    expect(html).toContain('data-approver="auth:review-lead"')
    expect(html).toContain("approver: auth:review-lead")
    // The authority record renders with all four of D12's fields, and `scope` is
    // shown as the DECLARED REMIT (entry 0024 item 6).
    expect(html).toContain('data-authority="auth:review-lead"')
    expect(html).toContain('data-authority-scope="markets review"')
    expect(html).toContain('data-authority-can-approve="markets"')
    // A room that HAS an approver does not also claim the reservation.
    expect(html).not.toContain(`data-approver="${RESERVATION}"`)
  })
})

describe("WS-7 T8 — Ministry room: separation of duties is rendered honestly", () => {
  it("an EMPTY registry renders as `empty`, never as `separated`", () => {
    // Entry 0024 obligation 2, stated as its own test. T16's boolean is `true`
    // for an empty registry, which is correct as an ANSWER; rendering that as
    // "separation verified" is the defect the obligation names.
    expect(separationStateFor({ builders: [], approvers: [], collisions: [] })).toBe("empty")
    expect(separationStateFor({ builders: ["a"], approvers: ["b"], collisions: [] })).toBe("separated")
    expect(separationStateFor({ builders: ["a"], approvers: ["a"], collisions: [{}] })).toBe("collision")

    const html = renderToStaticMarkup(<MinistryRoom readout={readout()} />)
    expect(html).toContain('data-separation="empty"')
    expect(html).toContain("EMPTY — nothing to separate")
    // And the reason says why that is not the same as verified.
    expect(html).toContain("not a verified one")
    expect(html).not.toContain('data-separation="separated"')
  })

  it("a room WITH an assignment and no collision renders `separated`", () => {
    const html = renderToStaticMarkup(
      <MinistryRoom
        readout={readout({
          rooms: [
            { roomKey: "markets", builders: ["auth:build-lead"], approvers: ["auth:review-lead"], collisions: [], separated: true, approverDisplay: "auth:review-lead", approverCount: 1, builderCount: 1 }
          ]
        })}
      />
    )
    expect(html).toContain('data-separation="separated"')
    expect(html).toContain("builders: auth:build-lead")
    expect(html).toContain("approvers: auth:review-lead")
  })

  it("a COLLISION names BOTH offenders and the build verbs", () => {
    // AC-035:1048 asks for the pair. A row that says "separation violation"
    // without who and what is not actionable.
    const html = renderToStaticMarkup(
      <MinistryRoom
        readout={readout({
          rooms: [
            {
              roomKey: "risk",
              builders: ["auth:build-lead"],
              approvers: ["auth:build-lead"],
              collisions: [
                {
                  authorityId: "auth:build-lead",
                  authorityTitle: "Trading build lead",
                  roomKey: "risk",
                  approvedVia: "canApprove",
                  builds: [{ action: "construct" }],
                  buildCount: 1
                }
              ],
              separated: false,
              approverDisplay: "auth:build-lead",
              approverCount: 1,
              builderCount: 1
            }
          ],
          separation: { code: "authority:collide:build-approve", ok: false, collisionCount: 1, approverAuthorityCount: 1, roomsWithAnApprover: 1, checkedAuthorities: 1 }
        })}
      />
    )

    expect(html).toContain('data-separation="collision"')
    expect(html).toContain('data-collision="auth:build-lead"')
    expect(html).toContain('data-collision-builds="construct"')
    // BOTH the title and the id, the room, and the verb.
    expect(html).toContain("Trading build lead (auth:build-lead) both built risk (construct) and may approve it")
    expect(html).toContain('data-collision-count="1"')
    // The aggregate is copied, not re-derived, and its `ok: false` is preserved.
    expect(html).toContain('data-separation-code="authority:collide:build-approve"')
  })

  it("renders the build registry's absence so `empty` cannot read as verified", () => {
    const html = renderToStaticMarkup(<MinistryRoom readout={readout()} />)
    expect(html).toContain('data-build-records="0"')
    expect(html).toContain("The build registry has no producer.")
    expect(html).toContain('data-authority-count="0"')
  })
})

describe("WS-7 T8 — Ministry room: D5 grants and AC-035 refusals", () => {
  it("renders a grant's approving authority, its scope, the roomKey and the time", () => {
    // Entry 0024 obligation 4. `scope` is rendered on EVERY approval because that
    // is the only place the word is load-bearing in D5's chain (item 6).
    const at = Date.UTC(2026, 9, 1, 12, 0, 0)
    const html = renderToStaticMarkup(
      <MinistryRoom
        readout={readout({
          permits: {
            brokers: ["broker-1"],
            changeCount: 1,
            grants: [
              {
                sequence: 1,
                brokerId: "broker-1",
                from: false,
                to: true,
                approvedByAuthorityId: "auth:review-lead",
                approvedByAuthorityTitle: "Review lead",
                scope: ["A+ auto-execute"],
                roomKey: "paper",
                separationChecked: true,
                at,
                retentionClass: "permanent_append_only"
              }
            ],
            reason: null
          }
        })}
      />
    )

    expect(html).toContain('data-grant="broker-1"')
    expect(html).toContain('data-grant-authority="auth:review-lead"')
    expect(html).toContain('data-grant-scope="A+ auto-execute"')
    expect(html).toContain('data-grant-room="paper"')
    expect(html).toContain("held under room paper at 2026-10-01T12:00:00.000Z")
  })

  it("renders an ABSENT grant as an unavailable state, never as 'no permits exist'", () => {
    // A `grants: 0` must not read as "nothing was ever authorised" — it is an
    // absence, because the store holds no broker record at all.
    const html = renderToStaticMarkup(<MinistryRoom readout={readout()} />)
    expect(html).toContain('data-grant-count="0"')
    expect(html).toContain("automationPermitted grants — unavailable")
  })

  it("renders each refusal code with its message, not as a toast", () => {
    // Entry 0024 obligation 5: a governance surface that turns a refusal into a
    // toast is the "UI-only warning" AC-035:1049 forbids. The codes are rendered
    // as visible text.
    const html = renderToStaticMarkup(<MinistryRoom readout={readout()} />)
    expect(html).toContain('data-refusal-code="authority:collide:build-approve"')
    expect(html).toContain("An authority may both build and approve the same room (D12).")
    expect(html).toContain('data-refusal-count="1"')
  })

  it("says so when the readout supplied no refusal codes at all", () => {
    const html = renderToStaticMarkup(<MinistryRoom readout={readout({ refusalCodes: [] })} />)
    expect(html).toContain('data-refusal-count="0"')
    expect(html).toContain("no refusal codes, so the codes this surface can render are unknown")
  })

  it("the REAL adapter turns a 401 into an absence", async () => {
    const refused = await fetchMinistryGovernance({
      fetchImpl: (async () => new Response(JSON.stringify({ error: "authentication required" }), { status: 401 })) as never
    })
    expect(refused.readout).toBeNull()
    expect(refused.error).toContain("401")

    const view = ministryGovernanceView(refused.readout)
    expect(view.complete).toBe(false)
    expect(view.rooms).toEqual([])
  })

  it("projects the REAL adapter body through the room's own projection", async () => {
    const { readout: body } = await fetchMinistryGovernance({
      fetchImpl: (async () => new Response(JSON.stringify(readout()), { status: 200 })) as never
    })
    const view = buildMinistryView({ readout: body })
    expect(view.complete).toBe(true)
    expect(view.rooms).toHaveLength(2)
    expect(view.rooms.every((r) => r.state === "empty")).toBe(true)
    expect(view.rooms[0].approverDisplay).toBe(RESERVATION)
    expect(view.governanceVersion).toBe("ministry-governance/1.0.0")
  })
})

describe("WS-7 T8 — Ministry room: the D27 verdict", () => {
  it("is present, names both registries, and leaves ws8Handoff a present null", () => {
    expect(MINISTRY_COMPLETION.room).toBe("ministry")
    expect(MINISTRY_COMPLETION.d1Order).toBe(4)
    expect(MINISTRY_COMPLETION.verdict).toBe("complete")
    // A present `null`, not an absent field: the brief requires the key to be
    // there so "no WS-8 handoff" is a statement rather than an oversight.
    expect(MINISTRY_COMPLETION).toHaveProperty("ws8Handoff")
    expect(MINISTRY_COMPLETION.ws8Handoff).toBeNull()
    expect(MINISTRY_COMPLETION.reason.length).toBeGreaterThan(200)
    // D27's bar: a `complete` verdict must NAME what is absent, or it is an
    // unflagged trim. Both registries are named, and the owner is named too.
    //
    // READ ACROSS THE WHOLE RECORD, NOT JUST `reason`. The verdict is the
    // `MINISTRY_COMPLETION` object a reader opens; its `reason` is the one-line
    // form. Both absences are spelled out in the record's own documentation, and
    // an assertion that only read `reason` would pass on a record that named
    // them elsewhere while its own summary stayed silent about them.
    const record = JSON.stringify(MINISTRY_COMPLETION)
    expect(record).toMatch(/No scope in this room logically belongs to WS-8/)
    expect(record).toMatch(/NO AUTHORITY REGISTRY/)
    expect(record).toMatch(/NO BUILD REGISTRY/)
    expect(record).toMatch(/owner decision/i)
    // Each absence is a STRUCTURED field, not prose: name, detail, owner, and an
    // explicit statement that it is not WS-8 scope. An unflagged trim is exactly
    // what a bare `complete` with no enumerable absence would be.
    expect(MINISTRY_COMPLETION.absences).toHaveLength(2)
    for (const absence of MINISTRY_COMPLETION.absences) {
      expect(absence.what.length).toBeGreaterThan(0)
      expect(absence.detail.length).toBeGreaterThan(40)
      expect(absence.owner.length).toBeGreaterThan(0)
      expect(absence.isWs8Scope, `${absence.what} must state whether it is WS-8 scope`).toBe(false)
    }
    // And the record must not claim a completeness it has not earned.
    expect(record).not.toMatch(/all authorities registered/i)
  })
})
