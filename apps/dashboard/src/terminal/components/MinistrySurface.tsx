import { UnavailableState } from "./UnavailableState"
import type { MinistryGovernanceView, RoomSeparationRow } from "../domain/ministryGovernance"

/**
 * WS-7 T8 — the Ministry room's surface.
 *
 * FOUR SECTIONS, EACH INDEPENDENTLY UNAVAILABLE, because entry 0024's six
 * obligations are six separate things and one shared "governance: live" banner
 * would let a reader infer that the absence of one is covered by the presence of
 * another.
 *
 *   1. THE AUTHORITY SET — every record's `id`, `title`, `scope[]` and
 *      `canApprove[]`. Absent here means every capability in this room is
 *      UNASSIGNED, and each room row below then shows D10's reservation.
 *   2. SEPARATION OF DUTIES, PER ROOM — `builders[]`, `approvers[]`,
 *      `collisions[]` and the three-way state. On a collision the row names
 *      BOTH offenders, because AC-035:1048 asks for the pair and a row that
 *      says "separation violation" without it is not actionable.
 *   3. `automationPermitted` GRANTS — the approving authority's title, its
 *      `scope[]`, the `roomKey` and the `at` timestamp. `scope` is shown on every
 *      approval because that is the only place the word is load-bearing in D5's
 *      chain.
 *   4. REFUSAL CODES — the codes the write path throws, with their messages. A
 *      governance surface that turned these into a toast is the "UI-only
 *      warning" AC-035:1049 forbids, so they are displayed as text.
 *
 * NO WRITE AFFORDANCE. Nothing here approves, grants, declines or acknowledges.
 * T9's Paper/Live room owns the permit flag and T16's write path owns the
 * refusal; a read-only governance surface that grew a button would be a scope
 * change nobody notices.
 *
 * `data-` ATTRIBUTES ARE LOAD-BEARING, not decoration: the room's tests assert
 * the rendered state through them, and `src/terminal/routes/__tests__/`
 * consumers use them as hooks.
 */
export type MinistrySurfaceProps = {
  view: MinistryGovernanceView
}

function separationLabel(row: RoomSeparationRow): string {
  if (row.state === "collision") return "COLLISION"
  if (row.state === "empty") return "EMPTY — nothing to separate"
  return "separated"
}

export function MinistrySurface({ view }: MinistrySurfaceProps) {
  const authorityList = view.authoritiesRows
  const grants = view.grants

  return (
    <section className="terminal-ministry" data-ministry={view.complete ? "complete" : "incomplete"} aria-label="Ministry governance">
      {view.reason ? <p className="terminal-ministry__summary" data-ministry-readout="absent">{view.reason}</p> : null}

      <h3 className="terminal-ministry__heading">Authorities (D12)</h3>
      {/* The COUNT is emitted in both branches, because "zero authorities are
          registered" is a real and current fact a reader — and the room's test —
          needs to see. Emitting it only on the live branch would make an absent
          registry indistinguishable from an unrendered one. */}
      {view.authorities.status === "live" ? (
        <ul className="terminal-ministry__authorities" data-authority-count={authorityList.length}>
          {authorityList.map((authority) => (
            <li key={authority.id} data-authority={authority.id}>
              <p className="terminal-ministry__authority-title">{authority.title}</p>
              <p className="terminal-ministry__authority-id">{authority.id}</p>
              {/* Entry 0024 item 6: `scope` is the authority's DECLARED REMIT. It
                  is rendered on every record, not only on approvals, so a reader
                  can see what a record claims to cover before seeing what it may
                  approve. */}
              <p className="terminal-ministry__authority-scope" data-authority-scope={authority.scope.join("|") || "none"}>
                scope: {authority.scope.length > 0 ? authority.scope.join(", ") : "none declared"}
              </p>
              <p className="terminal-ministry__authority-approves" data-authority-can-approve={authority.canApprove.join("|") || "none"}>
                may approve: {authority.canApprove.length > 0 ? authority.canApprove.join(", ") : "no room"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div data-authority-count={authorityList.length}>
          <UnavailableState availability={view.authorities} label="Authority set" />
        </div>
      )}

      <h3 className="terminal-ministry__heading">Separation of duties, per room</h3>
      {view.buildRegistryReason ? (
        <p className="terminal-ministry__build-registry" data-build-records="0">
          {view.buildRegistryReason}
        </p>
      ) : null}
      <ul className="terminal-ministry__rooms" data-room-rows={view.rooms.length}>
        {view.rooms.map((room) => (
          <li
            key={room.roomKey}
            data-room-key={room.roomKey}
            data-separation={room.state}
            data-approver={room.approverDisplay}
          >
            <p className="terminal-ministry__room-label">
              {room.roomKey} — <span className="terminal-ministry__room-state">{separationLabel(room)}</span>
            </p>
            {/* The approver cell is ALWAYS a string, so an unassigned room is
                visibly `WS-7+` rather than blank, and it is distinguishable from
                a room that was never evaluated. */}
            <p className="terminal-ministry__room-approver">approver: {room.approverDisplay}</p>
            <p className="terminal-ministry__room-builders">builders: {room.builders.length > 0 ? room.builders.join(", ") : "none recorded"}</p>
            {room.collisions.length > 0 ? (
              <ul className="terminal-ministry__collisions">
                {room.collisions.map((collision) => (
                  <li
                    key={`${collision.authorityId}:${collision.roomKey}`}
                    data-collision={collision.authorityId}
                    data-collision-builds={collision.builds.map((b) => b.action).join("|")}
                  >
                    {collision.authorityTitle ?? collision.authorityId} ({collision.authorityId}) both built {collision.roomKey}{" "}
                    ({collision.builds.map((b) => b.action).join(", ")}) and may approve it via {collision.approvedVia}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="terminal-ministry__room-detail">{room.detail}</p>
          </li>
        ))}
      </ul>
      {view.aggregate ? (
        <p
          className="terminal-ministry__aggregate"
          data-separation-code={view.aggregate.code}
          data-collision-count={view.aggregate.collisionCount}
          data-approver-authorities={view.aggregate.approverAuthorityCount}
        >
          Aggregate separation [{view.aggregate.code}]: {view.aggregate.collisionCount} collision(s);{" "}
          {view.aggregate.approverAuthorityCount} authority/authorities may approve at least one room.
        </p>
      ) : null}

      <h3 className="terminal-ministry__heading">automationPermitted grants (D5)</h3>
      {/* As with the authority count, the grant count is emitted in BOTH branches:
          "zero grants recorded" and "this section did not render" must not look
          alike, and `grants: 0` must be legible as a fact rather than inferred
          from an empty page. */}
      {view.permits.status === "live" ? (
        <ul className="terminal-ministry__grants" data-grant-count={grants.length}>
          {grants.map((grant) => (
            <li key={`${grant.sequence}:${grant.brokerId}`} data-grant={grant.brokerId} data-grant-room={grant.roomKey}>
              <p className="terminal-ministry__grant-title">
                {grant.brokerId}: {grant.from ? "permitted" : "not permitted"} → {grant.to ? "permitted" : "not permitted"}
              </p>
              <p className="terminal-ministry__grant-authority" data-grant-authority={grant.approvedByAuthorityId}>
                approved by {grant.approvedByAuthorityTitle} ({grant.approvedByAuthorityId})
              </p>
              <p className="terminal-ministry__grant-scope" data-grant-scope={grant.scope.join("|") || "none"}>
                scope: {grant.scope.length > 0 ? grant.scope.join(", ") : "none declared"}
              </p>
              <p className="terminal-ministry__grant-meta">
                held under room {grant.roomKey} at {new Date(grant.at).toISOString()}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div data-grant-count={grants.length}>
          <UnavailableState availability={view.permits} label="automationPermitted grants" />
        </div>
      )}

      <h3 className="terminal-ministry__heading">Refusal codes this surface renders</h3>
      <ul className="terminal-ministry__refusals" data-refusal-count={view.refusalCodes.length}>
        {view.refusalCodes.map((refusal) => (
          <li key={refusal.code} data-refusal-code={refusal.code} data-refusal-surface={refusal.surface}>
            <p className="terminal-ministry__refusal-code">{refusal.code}</p>
            <p className="terminal-ministry__refusal-message">{refusal.message}</p>
          </li>
        ))}
      </ul>
      {view.refusalCodes.length === 0 ? (
        <p className="terminal-ministry__refusals-empty">
          The readout supplied no refusal codes, so the codes this surface can render are unknown.
        </p>
      ) : null}
    </section>
  )
}
