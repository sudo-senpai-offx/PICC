import type { ReactNode } from "react"
import type { Availability } from "../domain/availability"
import { describeAvailability } from "../domain/availability"

/**
 * WS-6 T2 — terminal room frame with an honest reserved/unavailable body.
 *
 * Spec §4.7: a reserved capability renders the capability label, the owning
 * workstream, the reason, and a timestamp — and NOTHING fabricated. In
 * particular this component must never render a numeric placeholder, a source
 * badge, or a live/success treatment for a capability that has no data. The
 * order-flow P0 (`ddc4c91`) shipped a fabricated `0` delta; a reserved panel
 * that rendered `0` would repeat exactly that failure.
 *
 * The frame is presentational and opens no transport and reads no secret. All
 * data access belongs to the adapters under `src/terminal/adapters/`.
 */

export type RoomFrameProps = {
  roomKey: string
  title: string
  /** When present and not `live`, the frame renders a reserved panel instead of claiming data. */
  reserved?: Availability
  /** Human label for the capability the reserved state refers to. */
  capabilityLabel?: string
  children?: ReactNode
}

function ReservedPanel({
  availability,
  capabilityLabel
}: {
  availability: Exclude<Availability, { status: "live" }>
  capabilityLabel?: string
}) {
  // The three non-live states carry DIFFERENT provenance and must not be
  // conflated: `reserved` names a future workstream, `unavailable` names the
  // owning workstream plus a since-timestamp, and `stale` names the SOURCE
  // that is serving old data. `stale` deliberately has no owner, so the frame
  // must not claim one.
  const owner =
    availability.status === "reserved"
      ? availability.workstream
      : availability.status === "unavailable"
        ? availability.owner
        : null
  const since = availability.status === "unavailable" ? new Date(availability.since).toISOString() : null
  const source = availability.status === "stale" ? availability.source : null

  return (
    <section
      className="terminal-reserved"
      data-availability={availability.status}
      data-workstream={owner ?? undefined}
      role="status"
      aria-live="polite"
    >
      <p className="terminal-reserved__label">
        {capabilityLabel ?? "Capability"} — {availability.status}
      </p>
      {owner ? <p className="terminal-reserved__owner">Owned by {owner}</p> : null}
      {source ? <p className="terminal-reserved__source">Source: {source}</p> : null}
      <p className="terminal-reserved__reason">{availability.reason}</p>
      {since ? <p className="terminal-reserved__since">Unavailable since {since}</p> : null}
      <p className="terminal-reserved__hint">{describeAvailability(availability)}</p>
    </section>
  )
}

export function RoomFrame({ roomKey, title, reserved, capabilityLabel, children }: RoomFrameProps) {
  const showReserved = reserved != null && reserved.status !== "live"

  return (
    <div className="terminal-room" data-room-key={roomKey} data-testid="terminal-room">
      <header className="terminal-room__header">
        <h1 className="terminal-room__title">{title}</h1>
      </header>
      <div className="terminal-room__body">
        {showReserved ? (
          <ReservedPanel
            availability={reserved as Exclude<Availability, { status: "live" }>}
            capabilityLabel={capabilityLabel}
          />
        ) : null}
        {children}
      </div>
    </div>
  )
}
