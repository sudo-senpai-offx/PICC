import type { RegisterAssessment } from "../adapters/venueIntegrity"
import { redactSecrets } from "../adapters/redaction"

/**
 * WS-6 T3 — status/venue integrity surface (AC-012, AC-017).
 *
 * Renders the read-only venue integrity register. Two invariants:
 *  - A conflict is NAMED with the entity and the roles it holds. The surface
 *    never presents a conflicted venue as verified and never silently awards
 *    independence (AC-012 prohibited side effect).
 *  - An empty register is rendered as UNCONFIGURED, never as "all clear"
 *    (AC-007: unconfigured is not the same as verified).
 *
 * Everything rendered passes through `redactSecrets` first, so a malformed
 * record carrying credential material cannot reach the DOM (AC-017).
 *
 * Presentational only: opens no transport and reads no secret directly.
 */
export type StatusBoundaryProps = {
  register: RegisterAssessment
}

export function StatusBoundary({ register }: StatusBoundaryProps) {
  const safe = redactSecrets(register)

  return (
    <section className="terminal-status" aria-label="Venue integrity">
      <header className="terminal-status__header">
        <h2>Venue integrity</h2>
        {safe.allVerified ? (
          <p className="terminal-status__summary" data-all-clear="true">
            All {safe.venues.length} venue(s) verified.
          </p>
        ) : (
          <p className="terminal-status__summary" data-all-clear="false">
            {safe.venues.length === 0
              ? "No venues configured — integrity is unverified."
              : `${safe.conflicted.length} conflicted of ${safe.venues.length} venue(s). Execution stays disabled.`}
          </p>
        )}
      </header>

      {safe.venues.length === 0 ? null : (
        <ul className="terminal-status__list">
          {safe.venues.map((venue) => (
            <li
              key={venue.venueId}
              data-venue-id={venue.venueId}
              data-integrity={venue.integrityStatus}
              className="terminal-status__row"
            >
              <span className="terminal-status__id">{venue.venueId}</span>
              <span className="terminal-status__state">{venue.integrityStatus}</span>
              {venue.blocker ? (
                <span className="terminal-status__blocker" data-testid="blocker">
                  {venue.blocker}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
