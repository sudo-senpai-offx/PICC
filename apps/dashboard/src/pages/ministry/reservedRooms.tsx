import { RoomFrame } from "@/terminal/components/RoomFrame"
import { reserved } from "@/terminal/domain/availability"

/**
 * WS-7 T7R-A — reserved bodies for the three authorised room keys whose
 * implementations belong to later WS-7 tasks.
 *
 * WHY THESE EXIST AT ALL. The 2026-09-30 amendment to WS-6 §0.3 authorised four
 * new ministry room keys — `risk`, `ceremony`, `ministry`, `strategy` — taking
 * the inventory from 18 instances / 11 keys to 22 / 15. `risk` has a real room
 * (`terminal/routes/RiskRoom.tsx`). The other three do not: Ceremony and
 * Ministry are WS-7 T8, and Strategy is WS-7 T9.
 *
 * They still need an entry in `MINISTRY_ROOMS`, because the route parity guard
 * (`src/terminal/components/__tests__/TerminalShell.test.tsx:45-59`) requires
 * `INNER_NAV`'s key set to EQUAL `MINISTRY_ROOMS`'s key set in both directions.
 * Without these three the guard fails and the amendment cannot land.
 *
 * WHY THEY ARE NOT BUILDINGS. Each renders the explicit reserved state from
 * `RoomFrame`, naming the task that owns the room, and shows no number, chart
 * point, score, or control. That is the contract of WS-6 §4.7 and of this
 * repository's honesty rules: a reserved capability states what is missing and
 * who owns it rather than showing an empty or fabricated success.
 *
 * Writing a plausible-looking surface here instead would be the D27 failure
 * mode exactly — scope that looks assigned and is a placeholder. Each of these
 * is a NAMED absence with an owner, which is a legitimate outcome; an unflagged
 * one is a defect.
 *
 * `data-room` is emitted for the same reason the existing rooms emit it: WS-6
 * R2.3 requires the hooks used by tests and Browser Studio, and the amended
 * R2.3 extends that obligation to the four new keys unchanged.
 */

type ReservedRoomProps = {
  roomKey: string
  title: string
  owner: string
  reason: string
}

function ReservedMinistryRoom({ roomKey, title, owner, reason }: ReservedRoomProps) {
  return (
    <div className="stack">
      <header data-room={roomKey}>
        <h2>{title}</h2>
        <span className="badge badge-muted">reserved</span>
      </header>
      <RoomFrame
        roomKey={roomKey}
        title={title}
        capabilityLabel="Room"
        reserved={reserved({ workstream: owner, reason })}
      />
    </div>
  )
}

/** WS-7 T8 — the Ceremony room. Its producer (`commandCentre/ceremonyState.mjs`) already exists. */
export function CeremonyRoom() {
  return (
    <ReservedMinistryRoom
      roomKey="ceremony"
      title="Ceremony"
      owner="WS-7 T8"
      reason="The Ceremony room is authorised and routed, and its producer (commandCentre/ceremonyState.mjs) already exists. The room surface is WS-7 T8 and has not been built. Nothing is shown because nothing is known about the room's contents yet."
    />
  )
}

/** WS-7 T8 — the Ministry room. Its authority model and separation-of-duties detector are WS-7 T16 and ship. */
export function MinistryAuthorityRoom() {
  return (
    <ReservedMinistryRoom
      roomKey="ministry"
      title="Ministry"
      owner="WS-7 T8"
      reason="The Ministry room is authorised and routed. Its producer — the WS-7 T16 authority model, separation-of-duties detector, and automationPermitted change events — ships complete. The room surface that renders it is WS-7 T8 and has not been built, so no authority, approval, or separation record is displayed."
    />
  )
}

/** WS-7 T9 — the Strategy room. */
export function StrategyRoom() {
  return (
    <ReservedMinistryRoom
      roomKey="strategy"
      title="Strategy"
      owner="WS-7 T9"
      reason="The Strategy room is authorised and routed. Its surface is WS-7 T9 and has not been built, and no producer for it has been verified. Nothing is shown because nothing is known about the room's contents yet."
    />
  )
}