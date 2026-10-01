// WS-7 T8 — the Ministry room's readout. D12 / AC-020 / AC-035 / D10.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT
// ---------------------------------------------------------------------------
//
// T16 (entry 0024, commit `f1567ef`) built the authority model, the mechanical
// build/approve collision detector and the `automationPermitted` change-event
// store. It recorded four BS-3 handoffs, and this file is the consumer half of
// handoff #1. It:
//
//   - ASSEMBLES the three producers T16 shipped into one readout;
//   - CALLS T16's `describeRoomSeparation` per room key, unmodified;
//   - EMITS D10's literal reservation for anything unassigned, unmodified.
//
// It does NOT re-implement the collision condition, and it does NOT restate any
// weight, band or tier boundary. The first would be a second control wearing
// T16's name (plan §3.5 Risk 6 is exactly this failure); the second would be
// T11's. Everything below is either a value copied out of a T16 export or a
// named absence.
//
// ---------------------------------------------------------------------------
// WHY THE AUTHORITY SET IS EMPTY, AND WHY THAT IS NOT A GAP IN THIS FILE
// ---------------------------------------------------------------------------
//
// The honest answer is the whole point of this room, so it is stated plainly.
//
// There is NO production authority registry in this repository. As of `f1567ef`
// the only referents of `createAuthority` / `defineAuthorities` /
// `createBrokerAutomationPermitStore` are T16's own tests and its fixtures —
// verified by enumerating every `.mjs`/`.ts`/`.tsx` under `apps/dashboard` for
// those three symbols. A room that rendered a named authority would therefore be
// rendering a name no human holds, which is the fabrication D10:175-182 exists
// to prevent, and would satisfy AC-035's separation check with an invented
// pair.
//
// So the set is empty, the build registry is empty, and the permit store holds
// no brokers. Every one of those is reported as a NAMED absence with its own
// reason, and every room's approver renders as D10's `WS-7+`.
//
// THE EMPTY REGISTRY IS NOT "SEPARATED". `describeRoomSeparation` returns
// `separated: true` for an empty registry, because a collision requires an
// approval to collide with. That is correct as an ANSWER — there is no
// collision — and wrong as a CLAIM: nobody was separated from anything, because
// nobody was assigned. The three-way distinction (collision / separated / empty)
// is therefore a DISPLAY decision and lives client-side in
// `src/terminal/domain/ministryGovernance.ts`, which is where `riskLayer.ts`
// keeps the same kind of derivation. This file reports T16's booleans verbatim
// so a reader can see the raw answer and the room's rendering of it separately.
//
// ---------------------------------------------------------------------------
// NO CLOCK, NO FILE, NO NETWORK
// ---------------------------------------------------------------------------
//
// The permit store takes `at` as a required caller argument and has no clock of
// its own (`brokerAutomationPermit.mjs:166-172`). This readout creates a store
// with no brokers and reads it, so it holds no permit time to invent: with no
// broker there are no change events, and an empty event log is reported as
// empty. It opens no file and makes no request.

import { unassignedAuthorityLabel, approversForRoom } from "./authorityModel.mjs"
import {
  COLLISION_CODE,
  UNKNOWN_AUTHORITY_CODE,
  INVALID_INPUT_CODE,
  describeRoomSeparation
} from "./separationOfDuties.mjs"
import {
  PERMIT_NO_AUTHORITY_CODE,
  UNKNOWN_BROKER_CODE,
  INVALID_PERMIT_CHANGE_CODE,
  createBrokerAutomationPermitStore
} from "./brokerAutomationPermit.mjs"

/** Stamped on the payload so a reader can tell which readout produced it. */
export const MINISTRY_GOVERNANCE_VERSION = "ministry-governance/1.0.0"

/**
 * The room-key inventory, exactly as WS-6 §0.3(a) froze it after the owner's
 * 2026-09-30 amendment: **22 route instances across 15 distinct room keys**.
 *
 * Carried as the 15 DISTINCT keys because `canApprove` and the build registry
 * are both keyed on a room key (§4.3:646), and `describeRoomSeparation` treats
 * a room key as an opaque string. Deriving this list from the frozen inventory
 * rather than from a hand-picked subset is what makes "every room is reported"
 * a fact: a key added to the nav inventory and forgotten here would show up as a
 * missing row, and the count below is asserted against it in the tests.
 *
 * The order is the inventory's own suite order with each suite's keys collapsed
 * in first-seen order, so the rendered table is stable and reproducible.
 */
export const GOVERNANCE_ROOM_KEYS = Object.freeze([
  // trading (13 instances, 13 distinct keys here)
  "dashboard",
  "markets",
  "risk",
  "ceremony",
  "ministry",
  "strategy",
  "paper",
  "autopilot",
  "command-centre",
  "dispatch",
  "simulator",
  "studio",
  "settings",
  // intelligence contributes two keys the other suites do not have
  "governor",
  "guidance"
])

/**
 * The refusal vocabulary the write path can throw, copied from T16's own
 * exported constants.
 *
 * Entry 0024 §"Exactly what the Ministry room must do later" item 5 requires
 * the room to "show the code and the message rather than swallowing them — a
 * governance surface that turns a refusal into a toast is the 'UI-only warning'
 * AC-035:1049 forbids". This readout is read-only, so it produces no refusal of
 * its own; it reports the codes the surface is capable of rendering, taken from
 * the producing modules rather than retyped, so the room's list cannot drift
 * from the writer's.
 */
export const GOVERNANCE_REFUSAL_CODES = Object.freeze([
  {
    code: COLLISION_CODE,
    surface: "separation",
    message: "An authority may both build and approve the same room (D12). The pair is named and the write is refused."
  },
  {
    code: UNKNOWN_AUTHORITY_CODE,
    surface: "separation",
    message: "A build record or an approving authority names an authority that is not registered."
  },
  {
    code: INVALID_INPUT_CODE,
    surface: "separation",
    message: "A build record or room key is malformed, or carries a build verb outside the closed vocabulary."
  },
  {
    code: PERMIT_NO_AUTHORITY_CODE,
    surface: "permit",
    message: "An automation-permitted change arrived with no recorded approving authority. Refused in BOTH directions."
  },
  {
    code: UNKNOWN_BROKER_CODE,
    surface: "permit",
    message: "An automation-permitted change was aimed at a broker record this store does not hold."
  },
  {
    code: INVALID_PERMIT_CHANGE_CODE,
    surface: "permit",
    message: "An automation-permitted change was malformed — a non-boolean, a missing roomKey, or a seeded permission field."
  }
])

/**
 * The Ministry readout.
 *
 * Pure with respect to its inputs and with respect to time: no clock, no
 * filesystem, no network. It never throws for missing data — an absent authority
 * is a reported absence, not an error — because a governance surface that
 * refuses to render is not a governance surface.
 *
 * @returns {{
 *   ok: true,
 *   governanceVersion: string,
 *   unassignedAuthority: string,
 *   roomKeys: readonly string[],
 *   authorities: { registered: ReadonlyArray<object>, count: number, reason: string | null },
 *   buildRegistry: { recordCount: number, roomsCovered: readonly string[], reason: string | null },
 *   rooms: ReadonlyArray<object>,
 *   separation: { code: string, ok: boolean, collisionCount: number, checkedAuthorities: number },
 *   permits: { brokers: readonly string[], changeCount: number, grants: ReadonlyArray<object>, reason: string | null },
 *   refusalCodes: readonly {code: string, surface: string, message: string}[]
 * }}
 */
export function ministryGovernance() {
  // T16's model has no persistence layer, so there is nothing to read. Empty is
  // the true state, and it is named rather than defaulted to a placeholder set.
  const authorities = []

  // T16 entry 0024 handoff #3: the build registry has no producer yet. Nothing
  // emits `construct`/`deploy`/`promote` because no room is attributed to a
  // named authority yet. An empty registry has no collisions, and that is
  // recorded as an absence rather than presented as evidence.
  const buildRecords = []

  // A store with no brokers, so `read()` on any id returns `null` and the room
  // can tell "no broker record" from "a broker that was never permitted".
  const permitStore = createBrokerAutomationPermitStore({ authorities, buildRecords, brokers: [] })
  const allChanges = permitStore.allChanges()

  const rooms = GOVERNANCE_ROOM_KEYS.map((roomKey) => {
    const separation = describeRoomSeparation({ authorities, buildRecords, roomKey })
    const approvers = approversForRoom(authorities, roomKey)
    return {
      roomKey,
      builders: separation.builders,
      approvers: separation.approvers,
      collisions: separation.collisions,
      // T16's own boolean, copied verbatim. The room's three-way rendering of
      // it is client-side and is not back-projected into this field.
      separated: separation.separated,
      // D10's display value for a room nobody may approve. `approversForRoom`
      // returns `[]` for such a room — an ANSWER, not an error — and this is
      // where it becomes the literal the surface displays. Never synthesised:
      // `authorityById(authorities, "WS-7+")` is null by T16's own assertion, so
      // this string can never name a record.
      approverDisplay: approvers.length === 0 ? unassignedAuthorityLabel() : approvers.join(", "),
      approverCount: approvers.length,
      builderCount: separation.builders.length
    }
  })

  const aggregate = detectAggregateForRooms(rooms)

  return Object.freeze({
    ok: true,
    governanceVersion: MINISTRY_GOVERNANCE_VERSION,
    unassignedAuthority: unassignedAuthorityLabel(),
    roomKeys: GOVERNANCE_ROOM_KEYS,
    authorities: Object.freeze({
      registered: Object.freeze(authorities),
      count: authorities.length,
      reason:
        authorities.length === 0
          ? "No authority registry is wired to this readout. T16 (f1567ef) shipped the authority MODEL and the collision DETECTOR, but nothing in the tree defines a production authority set — the only referents of createAuthority/defineAuthorities are T16's own tests and fixtures. D10 requires anything unassigned to render as the WS-7+ reservation rather than as a synthesised record, so no name is invented here."
          : null
    }),
    buildRegistry: Object.freeze({
      recordCount: buildRecords.length,
      roomsCovered: Object.freeze([]),
      reason:
        buildRecords.length === 0
          ? "The build registry has no producer. Nothing emits construct/deploy/promote records because no room is attributed to a named authority yet, so there is no build evidence for any room to be separated against."
          : null
    }),
    rooms: Object.freeze(rooms),
    // T16's whole-registry report, computed from the same facts the per-room
    // projections were computed from, so the two can never disagree.
    separation: Object.freeze(aggregate),
    permits: Object.freeze({
      brokers: permitStore.brokers(),
      changeCount: allChanges.length,
      grants: Object.freeze(allChanges.map(grantProjection)),
      reason:
        allChanges.length === 0
          ? "No automationPermitted change has been recorded, because no broker record is wired to the permit store and T16 entry 0024 handoff #4 records that wiring as BS-3 (T9's Paper/Live room displays the flag)."
          : null
    }),
    refusalCodes: GOVERNANCE_REFUSAL_CODES
  })
}

/**
 * A permit change event, projected for display.
 *
 * Entry 0024 item 4 requires the room to show the approving authority's
 * `approvedByAuthorityTitle`, its `scope[]`, the `roomKey` the grant is held
 * under and the `at` timestamp. Those four are copied from the event; nothing is
 * derived, because an approval record's own fields are the evidence and
 * re-computing any of them would put a second copy of the control in the room.
 */
function grantProjection(event) {
  return Object.freeze({
    sequence: event.sequence,
    brokerId: event.brokerId,
    from: event.from,
    to: event.to,
    approvedByAuthorityId: event.approvedByAuthorityId,
    approvedByAuthorityTitle: event.approvedByAuthorityTitle,
    scope: event.scope,
    roomKey: event.roomKey,
    separationChecked: event.separationChecked,
    at: event.at,
    retentionClass: event.retentionClass
  })
}

/**
 * The aggregate verdict, from the per-room projections.
 *
 * This is deliberately NOT a second collision detector. A collision is a pair
 * (authority, room); the per-room rows already carry every one of them, so the
 * aggregate is a COUNT over rows the detector produced, not a re-derivation.
 * `ok` is therefore `collisionCount === 0`, which is T16's own condition
 * applied to a list T16 built.
 */
function detectAggregateForRooms(rooms) {
  const collisions = rooms.flatMap((room) => room.collisions)
  const approvers = [...new Set(rooms.flatMap((room) => room.approvers))]
  return Object.freeze({
    code: COLLISION_CODE,
    ok: collisions.length === 0,
    collisionCount: collisions.length,
    // Distinct authorities that appear as an approver anywhere. Zero is a real
    // and current fact, and it is the number a reader compares against a
    // registry that should exist.
    approverAuthorityCount: approvers.length,
    roomsWithAnApprover: rooms.filter((room) => room.approvers.length > 0).length,
    checkedAuthorities: 0
  })
}
