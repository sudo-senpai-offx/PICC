import type { Availability } from "../domain/availability"
import { describeAvailability } from "../domain/availability"

/**
 * WS-6 T5 — unavailable state renderer.
 *
 * The single component every room uses to say "this capability has no data, and
 * here is exactly why". It renders a reason and an owner; it NEVER renders a
 * number, a dash standing in for a value, a zero, or a success treatment.
 *
 * An unconfigured or missing capability must be visibly different from a
 * legitimate zero (AC-007). The rule here is that this component has no code
 * path that can emit a numeric value at all — the omission is the message.
 */
export type UnavailableStateProps = {
  availability: Availability
  label?: string
}

export function UnavailableState({ availability, label = "Capability" }: UnavailableStateProps) {
  const owner =
    availability.status === "reserved"
      ? availability.workstream
      : availability.status === "unavailable"
        ? availability.owner
        : null
  const source = availability.status === "stale" ? availability.source : null
  // Only `unavailable` and `reserved` carry a machine reason. `live` and
  // `stale` deliberately do not, so a reason is rendered only when one exists
  // rather than fabricating one for the other branches.
  const reason =
    availability.status === "unavailable" || availability.status === "reserved"
      ? availability.reason
      : null

  return (
    <div
      className="terminal-reserved"
      data-availability={availability.status}
      data-workstream={owner ?? undefined}
      role="status"
      aria-live="polite"
    >
      <p className="terminal-reserved__label">
        {label} — {availability.status}
      </p>
      {owner ? <p className="terminal-reserved__owner">Owned by {owner}</p> : null}
      {source ? <p className="terminal-reserved__source">Source: {source}</p> : null}
      {reason ? <p className="terminal-reserved__reason">{reason}</p> : null}
      <p className="terminal-reserved__hint">{describeAvailability(availability)}</p>
    </div>
  )
}
