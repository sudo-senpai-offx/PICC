/**
 * WS-7 T8 — the Ministry room's view of the D12 authority model and the
 * separation-of-duties state.
 *
 * THE THREE-WAY SEPARATION STATE IS THIS FILE'S OWN CONTRIBUTION, and it is the
 * one obligation T16 entry 0024 called out that a naive consumer gets wrong.
 *
 * T16's `describeRoomSeparation` returns `separated: boolean`, and for an empty
 * registry that boolean is `true` — correctly, because a collision requires an
 * approval to collide with and there are none. But a boolean cannot distinguish
 * "separation was checked and holds" from "there was nothing to separate". This
 * module renders three states instead:
 *
 *   - `collision`   — an authority both built and approves the room. The pair is
 *                     named, per AC-035:1048.
 *   - `separated`   — something was actually assigned and the collision check
 *                     passed over it.
 *   - `empty`       — no builders and no approvers. NOT clean, NOT verified:
 *                     nothing was checked because nothing exists.
 *
 * Collapsing `empty` into `separated` is the specific defect entry 0024 item 2
 * names, so the empty state carries its own label and its own reason.
 *
 * `WS-7+` IS NOT A LITERAL IN THIS FILE, AND THAT IS DELIBERATE.
 *
 * D10:175-182 reserves `WS-7+` for anything unassigned, and T16 asserts
 * `authorityById(authorities, "WS-7+")` is `null` — it is a DISPLAY value, never
 * an authority id. The string is emitted by the server from T16's own
 * `unassignedAuthorityLabel()`, and this module renders whatever it was given.
 * If the server ever stops sending it, the room renders a NAMED ABSENCE rather
 * than substituting a local guess, because a second copy of the reservation is
 * exactly how the client ends up inventing a name no human holds.
 * `MinistryRoom.test.tsx` asserts this module's own source contains no `WS-7+`
 * literal at all, which is the structural version of that claim.
 *
 * PURE. No clock, no transport, no credential. It projects what the route
 * produced and refuses to compute a separation verdict of its own.
 */

import { unavailable } from "./availability"
import type { Availability } from "./availability"

/**
 * Who owns an absent governance fact.
 *
 * Not a task name: T16 (`f1567ef`) shipped, so naming it as the owner of an
 * absence would be the drift AC-020 exists to prevent — the same defect T7R-B
 * corrected in `riskLayer.ts`'s `RISK_LAYER_OWNER`.
 */
export const GOVERNANCE_OWNER = "WS-7 authority-registry supply"

/** D10's reservation, as a NAME. Never synthesised here — only displayed. */
export type UnassignedLabel = string

export type AuthorityRow = {
  id: string
  title: string
  scope: readonly string[]
  canApprove: readonly string[]
}

export type CollisionRow = {
  authorityId: string
  authorityTitle: string | null
  roomKey: string
  approvedVia: string
  builds: readonly { action: string }[]
  buildCount: number
}

export type SeparationState = "collision" | "separated" | "empty"

export type RoomSeparationRow = {
  roomKey: string
  state: SeparationState
  builders: readonly string[]
  approvers: readonly string[]
  collisions: readonly CollisionRow[]
  /**
   * D10's display value for this room's approver: the approving authority ids,
   * or the reservation when nobody may approve it. Always a string — the room
   * never renders "no approver" as a blank cell.
   */
  approverDisplay: string
  /** One line saying what the state MEANS, so the empty state cannot read as clean. */
  detail: string
}

export type PermitGrantRow = {
  sequence: number
  brokerId: string
  from: boolean
  to: boolean
  approvedByAuthorityId: string
  approvedByAuthorityTitle: string
  scope: readonly string[]
  roomKey: string
  at: number
}

export type RefusalCodeRow = {
  code: string
  surface: string
  message: string
}

export type MinistryGovernanceView = {
  /** `null` when the readout itself could not be obtained — one reason for the room. */
  reason: string | null
  governanceVersion: string | null
  /** The availability of the AUTHORITY SET as a whole, and of the permit log. */
  authorities: Availability
  authoritiesRows: readonly AuthorityRow[]
  buildRegistryReason: string | null
  rooms: readonly RoomSeparationRow[]
  aggregate: {
    code: string
    collisionCount: number
    approverAuthorityCount: number
    roomsWithAnApprover: number
    ok: boolean
  } | null
  permits: Availability
  grants: readonly PermitGrantRow[]
  refusalCodes: readonly RefusalCodeRow[]
  /** True only when every room key has a row AND the readout was obtained. */
  complete: boolean
}

/** The route's response shape, as far as this projection reads it. */
type GovernanceResponse = {
  ok?: boolean
  governanceVersion?: string | null
  unassignedAuthority?: string | null
  authorities?: { registered?: unknown; count?: number; reason?: string | null } | null
  buildRegistry?: { recordCount?: number; roomsCovered?: unknown; reason?: string | null } | null
  rooms?: unknown
  separation?: {
    code?: string
    ok?: boolean
    collisionCount?: number
    approverAuthorityCount?: number
    roomsWithAnApprover?: number
  } | null
  permits?: { brokers?: unknown; changeCount?: number; grants?: unknown; reason?: string | null } | null
  refusalCodes?: unknown
}

/**
 * Project the governance readout into what the room may say.
 *
 * Every narrowing is a refusal to invent: a malformed authority record, a
 * non-string reservation, or a room row the server did not send all become
 * NAMED ABSENCES rather than defaults. The one value this module does not hold
 * is D10's reservation — it comes from the route.
 */
export function ministryGovernanceView(body: GovernanceResponse | null | undefined): MinistryGovernanceView {
  if (body === null || body === undefined) {
    return emptyView("The Ministry governance readout was not obtained, so no authority, approval or separation state is shown.")
  }

  const unassigned = typeof body.unassignedAuthority === "string" ? body.unassignedAuthority : null
  // THE CLIENT DOES NOT SUPPLY THE RESERVATION. If the server did not send a
  // non-empty string, the room says so rather than falling back to a literal
  // held here — see this module's header for why that fallback is the defect
  // D10 prevents.
  const reservationMissing = unassigned === null || unassigned.trim().length === 0

  const authoritiesRows = Array.isArray(body.authorities?.registered)
    ? body.authorities!.registered.filter(isAuthorityRow).map((a) => ({
        id: a.id,
        title: a.title,
        scope: [...a.scope],
        canApprove: [...a.canApprove]
      }))
    : []

  const rooms = Array.isArray(body.rooms) ? projectRooms(body.rooms, unassigned, reservationMissing) : []

  const authoritiesAvailable: Availability =
    authoritiesRows.length > 0
      ? {
          status: "live",
          source: "GET /api/trading/ministry",
          observedAt: 0,
          freshnessMs: 0
        }
      : unavailable({
          reason:
            body.authorities?.reason ??
            "no authority registry is registered for this readout, so every capability is unassigned",
          owner: GOVERNANCE_OWNER,
          since: 0
        })

  const grants = Array.isArray(body.permits?.grants)
    ? body.permits!.grants.filter(isGrant).map(projectGrant)
    : []

  const permitsAvailable: Availability =
    grants.length > 0
      ? { status: "live", source: "GET /api/trading/ministry", observedAt: 0, freshnessMs: 0 }
      : unavailable({
          reason:
            body.permits?.reason ??
            "no automationPermitted change has been recorded, because no broker record is wired to the permit store",
          owner: GOVERNANCE_OWNER,
          since: 0
        })

  const refusalCodes = Array.isArray(body.refusalCodes)
    ? body.refusalCodes.filter(isRefusalCode).map((r) => ({ code: r.code, surface: r.surface, message: r.message }))
    : []

  const sep = body.separation
  const aggregate =
    sep && typeof sep.code === "string" && Number.isInteger(sep.collisionCount)
      ? {
          code: sep.code,
          // Copied, and only ever `=== true`. T16's own boolean, not a
          // re-derivation, and never coerced from a truthy value.
          ok: sep.ok === true,
          collisionCount: sep.collisionCount as number,
          approverAuthorityCount: Number.isInteger(sep.approverAuthorityCount) ? (sep.approverAuthorityCount as number) : 0,
          roomsWithAnApprover: Number.isInteger(sep.roomsWithAnApprover) ? (sep.roomsWithAnApprover as number) : 0
        }
      : null

  const complete = rooms.length > 0 && !reservationMissing && aggregate !== null

  return {
    reason: null,
    governanceVersion: typeof body.governanceVersion === "string" ? body.governanceVersion : null,
    authorities: authoritiesAvailable,
    authoritiesRows,
    buildRegistryReason:
      typeof body.buildRegistry?.reason === "string" ? body.buildRegistry.reason : null,
    rooms,
    aggregate,
    permits: permitsAvailable,
    grants,
    refusalCodes,
    complete
  }
}

/**
 * The three-way state, and the one place it is decided.
 *
 * Exported so a test can assert the boundary directly rather than inferring it
 * from rendered HTML: an empty registry must be `empty`, never `separated`.
 */
export function separationStateFor(input: {
  builders: readonly string[]
  approvers: readonly string[]
  collisions: readonly unknown[]
}): SeparationState {
  if (input.collisions.length > 0) return "collision"
  // NOTHING ASSIGNED IS NOT NOTHING VERIFIED. With no builder and no approver
  // there is no pair to compare, so the collision check is vacuous rather than
  // passed — and reporting that as `separated` is the defect entry 0024 item 2
  // names. The build-registry reason is what makes the vacuity legible.
  if (input.builders.length === 0 && input.approvers.length === 0) return "empty"
  return "separated"
}

function projectRooms(raw: unknown, unassigned: string | null, reservationMissing: boolean): RoomSeparationRow[] {
  if (!Array.isArray(raw)) return []
  const out: RoomSeparationRow[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue
    const room = entry as Record<string, unknown>
    if (typeof room.roomKey !== "string" || room.roomKey.length === 0) continue

    const builders = Array.isArray(room.builders) ? room.builders.filter((b): b is string => typeof b === "string") : []
    const approvers = Array.isArray(room.approvers) ? room.approvers.filter((a): a is string => typeof a === "string") : []
    const collisions = Array.isArray(room.collisions) ? room.collisions.filter(isCollision).map(projectCollision) : []

    const state = separationStateFor({ builders, approvers, collisions })

    // The approver DISPLAY. The server's `approverDisplay` is authoritative when
    // it is a non-empty string; otherwise it is reconstructed from T16's own
    // rule (empty approvers -> the reservation) using the reservation the SERVER
    // sent. If the server sent none, the cell names the absence instead of
    // showing a value, so an unassigned room is never silently blank and never
    // filled with a locally-invented string.
    let approverDisplay: string
    if (typeof room.approverDisplay === "string" && room.approverDisplay.length > 0) {
      approverDisplay = room.approverDisplay
    } else if (approvers.length > 0) {
      approverDisplay = approvers.join(", ")
    } else if (reservationMissing || unassigned === null) {
      approverDisplay = "unavailable — the readout supplied no reservation for unassigned capabilities"
    } else {
      approverDisplay = unassigned
    }

    out.push({
      roomKey: room.roomKey,
      state,
      builders,
      approvers,
      collisions,
      approverDisplay,
      detail: detailFor(state, room.roomKey, builders, approvers, collisions)
    })
  }
  return out
}

function detailFor(
  state: SeparationState,
  roomKey: string,
  builders: readonly string[],
  approvers: readonly string[],
  collisions: readonly CollisionRow[]
): string {
  if (state === "collision") {
    // AC-035:1048 asks for the PAIR. A row that says "separation violation"
    // without naming who and what is not actionable.
    const pairs = collisions
      .map((c) => `${c.authorityTitle ?? c.authorityId} (${c.authorityId}) built ${roomKey} via ${c.builds.map((b) => b.action).join(", ")} and may approve it`)
      .join("; ")
    return `COLLISION — ${pairs}. Separation of duties (D12) forbids an authority that both builds and approves the same room.`
  }
  if (state === "empty") {
    return `No authority builds ${roomKey} and none may approve it, so there was nothing to separate. This is an EMPTY separation state, not a verified one: with no registry entries the collision check is vacuous rather than passed.`
  }
  const buildersText = builders.length > 0 ? builders.join(", ") : "no recorded builder"
  const approversText = approvers.length > 0 ? approvers.join(", ") : "no recorded approver"
  return `Separated — builders: ${buildersText}; approvers: ${approversText}. No authority both built and approves this room.`
}

/** The room with no readout at all. Every capability carries its own absence. */
function emptyView(reason: string): MinistryGovernanceView {
  return {
    reason,
    governanceVersion: null,
    authorities: unavailable({ reason, owner: GOVERNANCE_OWNER, since: 0 }),
    authoritiesRows: [],
    buildRegistryReason: null,
    rooms: [],
    aggregate: null,
    permits: unavailable({ reason, owner: GOVERNANCE_OWNER, since: 0 }),
    grants: [],
    refusalCodes: [],
    complete: false
  }
}

function projectCollision(c: Record<string, unknown>): CollisionRow {
  const builds = Array.isArray(c.builds)
    ? c.builds
        .map((b) => (b !== null && typeof b === "object" && typeof (b as { action?: unknown }).action === "string" ? (b as { action: string }).action : null))
        .filter((a): a is string => a !== null)
    : []
  return {
    authorityId: String(c.authorityId ?? ""),
    authorityTitle: typeof c.authorityTitle === "string" ? c.authorityTitle : null,
    roomKey: String(c.roomKey ?? ""),
    approvedVia: typeof c.approvedVia === "string" ? c.approvedVia : "canApprove",
    builds: builds.map((action) => ({ action })),
    buildCount: Number.isInteger(c.buildCount) ? (c.buildCount as number) : builds.length
  }
}

/**
 * A grant, projected for display.
 *
 * Entry 0024 item 4 requires the approving authority's title, its `scope[]`, the
 * `roomKey` the grant is held under, and the `at` timestamp. `scope` is shown on
 * every approval because that is the only place the word "scope" is
 * load-bearing in D5's chain (entry 0024 item 6) — so it is carried here and
 * rendered by the surface, never dropped as redundant detail.
 */
function projectGrant(g: Record<string, unknown>): PermitGrantRow {
  return {
    sequence: Number.isInteger(g.sequence) ? (g.sequence as number) : 0,
    brokerId: String(g.brokerId ?? ""),
    from: g.from === true,
    to: g.to === true,
    approvedByAuthorityId: String(g.approvedByAuthorityId ?? ""),
    approvedByAuthorityTitle: typeof g.approvedByAuthorityTitle === "string" ? g.approvedByAuthorityTitle : String(g.approvedByAuthorityId ?? ""),
    scope: Array.isArray(g.scope) ? g.scope.filter((s): s is string => typeof s === "string") : [],
    roomKey: String(g.roomKey ?? ""),
    at: typeof g.at === "number" && Number.isFinite(g.at) ? g.at : 0
  }
}

function isAuthorityRow(value: unknown): value is { id: string; title: string; scope: string[]; canApprove: string[] } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const a = value as Record<string, unknown>
  return (
    typeof a.id === "string" &&
    a.id.length > 0 &&
    typeof a.title === "string" &&
    Array.isArray(a.scope) &&
    Array.isArray(a.canApprove)
  )
}

function isGrant(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { brokerId?: unknown }).brokerId === "string"
}

function isCollision(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { authorityId?: unknown }).authorityId === "string"
}

function isRefusalCode(value: unknown): value is { code: string; surface: string; message: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return typeof r.code === "string" && typeof r.surface === "string" && typeof r.message === "string"
}
