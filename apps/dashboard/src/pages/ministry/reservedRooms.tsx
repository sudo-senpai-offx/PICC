import { RoomFrame } from "@/terminal/components/RoomFrame"
import { reserved } from "@/terminal/domain/availability"

/**
 * WS-7 T7R-A — reserved body for the ONE authorised room key whose surface
 * belongs to a later WS-7 task.
 *
 * WHY ONE REMAINS. The 2026-09-30 amendment to WS-6 §0.3 authorised four new
 * ministry room keys — `risk`, `ceremony`, `ministry`, `strategy` — taking the
 * inventory from 18 instances / 11 keys to 22 / 15. All four now have real
 * surfaces: `risk` at `terminal/routes/RiskRoom.tsx` (T7/T7R-B), `ceremony` at
 * `terminal/routes/CeremonyRoom.tsx` and `ministry` at
 * `terminal/routes/MinistryRoom.tsx`, both WS-7 T8. `strategy` is WS-7 T9 and
 * still has no producer, so it keeps a reserved body.
 *
 * `CeremonyRoom` and `MinistryAuthorityRoom` were DELETED from this file by T8
 * rather than left exported and unrouted. An unused export of a reserved body
 * for a key that now has a real room is a trap: it reads as a live fallback, and
 * a later edit that re-points the router at the import path finds a placeholder
 * waiting rather than a missing module. Deleting them makes the absence of a
 * fallback visible.
 *
 * WHY THE REMAINING ENTRY IS NOT A BUILDING. It renders the explicit reserved
 * state from `RoomFrame`, naming the task that owns the room, and shows no
 * number, chart point, score, or control. That is the contract of WS-6 §4.7 and
 * of this repository's honesty rules: a reserved capability states what is
 * missing and who owns it rather than showing an empty or fabricated success.
 *
 * Writing a plausible-looking surface here instead would be the D27 failure
 * mode exactly — scope that looks assigned and is a placeholder. This is a
 * NAMED absence with an owner, which is a legitimate outcome; an unflagged one is
 * a defect.
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