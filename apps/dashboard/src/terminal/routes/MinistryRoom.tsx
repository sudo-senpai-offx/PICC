import { RoomFrame } from "../components/RoomFrame"
import { MinistrySurface } from "../components/MinistrySurface"
import { ministryGovernanceView } from "../domain/ministryGovernance"
import type { MinistryGovernanceView } from "../domain/ministryGovernance"

/**
 * WS-7 T8 — room instance 4 of 22 (D1's order): Ministry.
 *
 * SCOPE, STATED PRECISELY, BECAUSE D27 FORBIDS TRIMMING IT QUIETLY.
 *
 * T8's acceptance line is: "Ministry surfaces authorities and separation-of-duties
 * state, marking anything unassigned as `WS-7+`". All three clauses are met.
 *
 * THE AUTHORITY MODEL IS CONSUMED HERE, NOT BUILT HERE, and T8's own file line
 * (spec :1267) says so. It is WS-7 T16's, shipping at `f1567ef`: the
 * `{ id, title, scope[], canApprove[] }` record, the pure build/approve
 * collision detector, and the `automationPermitted` change-event store. This
 * room:
 *
 *   - does NOT re-implement the collision condition. `separationOfDuties.mjs`
 *     imports nothing at all and is proven pure by a test that reads its own
 *     source; a second copy of the condition in a room would be a second control
 *     wearing its name (plan §3.5 Risk 6), and T16 proved a `recordIndex` field
 *     turns position into a fact within a single module.
 *   - does NOT restate a weight, band or tier boundary. Those are T11's
 *     (`tiers.mjs:56-101`), and T16 deliberately contributed exactly one boolean
 *     to that path.
 *   - calls `describeRoomSeparation` per room key through the route, unchanged.
 *
 * WHAT `WS-7+` IS, AND WHY IT IS NOT A STRING THIS ROOM INVENTS.
 *
 * D10:175-182 reserves `WS-7+` for anything unassigned. T16 asserts
 * `authorityById(authorities, "WS-7+")` is `null` — it is a DISPLAY value, never
 * an authority id — and `MinistryRoom.test.tsx` goes further by asserting that
 * this module, the domain projection and the surface contain NO `WS-7+` literal
 * at all. The string reaches the room from the route, which gets it from T16's
 * own `unassignedAuthorityLabel()`. So a second copy of the reservation cannot
 * exist in the client, and an unassigned capability is distinguishable from a
 * genuinely-absent one: the former shows `WS-7+` as an approver cell, the latter
 * shows the named unavailable state.
 *
 * THE THREE-WAY SEPARATION STATE, which is this room's own contribution and the
 * obligation entry 0024 item 2 names. T16's `separated: boolean` is `true` for
 * an empty registry, which is correct as an answer and wrong as a claim: nothing
 * was separated from anything, because nothing was assigned. The room therefore
 * renders `collision` / `separated` / `empty`, and `empty` is a DISTINCT label
 * with its own reason.
 *
 * PRESENTATIONAL ONLY. No transport, no clock of its own, no credential, and NO
 * WRITE AFFORDANCE: nothing here approves, grants, declines or acknowledges. T16's
 * write path owns refusals and T9's Paper/Live room owns the permit flag.
 */
type GovernanceReadout = Parameters<typeof ministryGovernanceView>[0]

export type MinistryRoomProps = {
  /** The governance readout, or `null` when there is none. */
  readout: GovernanceReadout
}

export function buildMinistryView(props: MinistryRoomProps): MinistryGovernanceView {
  return ministryGovernanceView(props.readout ?? null)
}

export function MinistryRoom(props: MinistryRoomProps) {
  const view = buildMinistryView(props)
  return (
    <RoomFrame roomKey="ministry" title="Ministry" capabilityLabel="D12 authority model and separation of duties">
      <MinistrySurface view={view} />
    </RoomFrame>
  )
}

/**
 * The room's D27 completeness verdict, carried in code so it cannot drift from
 * the report.
 */
export const MINISTRY_COMPLETION = {
  room: "ministry",
  d1Order: 4,
  /**
   * GENUINELY COMPLETE AS A SURFACE, WITH TWO NAMED ABSENCES THAT ARE NOT
   * TRIMS — and the distinction matters, because both absences are things the
   * owner, not this task, is being asked to decide.
   *
   * WHAT "COMPLETE" MEANS HERE, PRECISELY:
   *
   *  - COMPLETE means T8's acceptance line is met: "Ministry surfaces
   *    authorities and separation-of-duties state, marking anything unassigned as
   *    `WS-7+`." It does. Every one of the 15 frozen room keys has a row; the
   *    authority set renders per record with `id`, `title`, `scope[]` and
   *    `canApprove[]`; each room renders `builders[]`, `approvers[]`,
   *    `collisions[]` and the three-way state; and every unassigned capability
   *    renders as `WS-7+`, emitted from T16's own `unassignedAuthorityLabel()`.
   *  - It does NOT mean any authority exists. NONE DOES. As of `f1567ef` the only
   *    referents of `createAuthority` / `defineAuthorities` /
   *    `createBrokerAutomationPermitStore` in the whole tree are T16's own tests
   *    and fixtures — verified by enumerating every `.mjs`/`.ts`/`.tsx` under
   *    `apps/dashboard` for those three symbols. So the room renders an empty
   *    authority set, every room's approver as `WS-7+`, and an EMPTY separation
   *    state rather than a verified one. That is the acceptance met: the room
   *    marks what is unassigned exactly as specified, and inventing an authority
   *    to fill the table is the fabrication D10 exists to prevent.
   *
   * THE TWO ABSENCES, EACH NAMED, NEITHER A WS-8 BOUNDARY:
   *
   *  1. NO AUTHORITY REGISTRY and 2. NO BUILD REGISTRY. Entry 0024 handoff #3
   *     records that nothing emits `construct`/`deploy`/`promote` records,
   *     "because no room is attributed to a named authority yet". Both registries
   *     are INPUTS to T16's model, and inventing a build record would mean
   *     attributing a room to a named authority that does not exist — which
   *     T16's own `UNKNOWN_AUTHORITY_CODE` refuses, correctly. Producing them
   *     requires the owner to name real authorities and say who builds what;
   *     that is an owner decision, not WS-8 scope and not a trim this task could
   *     make honestly.
   *
   * WHAT WAS DISCHARGED HERE: entry 0024 handoff #2 (the `ministry` room key),
   *     already landed by the 2026-09-30 amendment at `e9c8137`; and handoff #1's
   *     SIX enumerated render obligations, all six of which this room meets —
   *     the authority set with D10's reservation, the per-room projection with an
   *     explicit empty state, the collision rows naming both offenders, the
   *     approving authority's title / `scope[]` / `roomKey` / `at` on any grant,
   *     the refusal codes and their messages, and `scope` displayed as the
   *     approving authority's declared remit. Obligation 4 and 5 render their
   *     surfaces with no rows, because the permit store holds no broker and the
   *     readout is read-only; the RENDERING exists and is tested, the DATA does
   *     not yet exist, and that is recorded here rather than absorbed.
   */
  verdict: "complete",
  ws8Handoff: null,
  /**
   * The two absences are named HERE as well as in the prose above, deliberately.
   *
   * `JSON.stringify(MINISTRY_COMPLETION)` serialises the DATA fields only, so a
   * verdict that named its boundaries solely in its JSDoc would serialise to
   * something that reads as a bare "complete". D27 asks for the boundary to be a
   * stated, reviewable thing; putting it in the string that survives
   * serialisation is what makes it so.
   */
  absences: Object.freeze([
    Object.freeze({
      what: "NO AUTHORITY REGISTRY",
      detail:
        "No production authority set is wired to this readout. T16 shipped the MODEL and the DETECTOR; nothing in the tree " +
        "defines the SET — the only referents of createAuthority/defineAuthorities are T16's own tests and fixtures. Every " +
        "room's approver therefore renders as D10's reservation.",
      owner: "owner decision — naming real authorities is not derivable from the repository",
      isWs8Scope: false
    }),
    Object.freeze({
      what: "NO BUILD REGISTRY",
      detail:
        "Nothing emits construct/deploy/promote records, because no room is attributed to a named authority yet. Inventing " +
        "one would mean attributing a room to an authority that does not exist, which T16's own UNKNOWN_AUTHORITY_CODE refuses.",
      owner: "owner decision — who builds what is not derivable from the repository",
      isWs8Scope: false
    })
  ]),
  reason:
    `No scope in this room logically belongs to WS-8. The authority record, the build/approve collision detector and the automationPermitted change events are all WS-7 T16 work, shipped complete at f1567ef and consumed here through GET /api/trading/ministry; this room re-implements none of them. TWO ABSENCES ARE NAMED IN THE \`absences\` FIELD AND NEITHER IS WS-8 SCOPE: NO AUTHORITY REGISTRY, and NO BUILD REGISTRY — both owned by an owner decision rather than a later workstream. T9's Paper/Live room owns the permit FLAG's display and T21's seam guard owns the aggregate separation guard — neither is scope this surface trims. Because no authority is registered, every room's approver renders as D10's reservation and every room's separation state renders as EMPTY rather than verified, which is what the acceptance line asks for. A WS-8 handoff here would be false — nothing in this room's subject matter is a WS-8 concern — and recording none while those registries were missing would be the unflagged trim AC-020 prohibits.`
} as const
