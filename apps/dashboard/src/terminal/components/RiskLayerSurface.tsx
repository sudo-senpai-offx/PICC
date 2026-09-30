import { UnavailableState } from "./UnavailableState"
import type { RiskLayerView } from "../domain/riskLayer"

/**
 * WS-7 T7 — the Risk room's surface for the spec §4.4 risk layer.
 *
 * THREE ROWS, THREE INDEPENDENT AVAILABILITIES.
 *
 * The room's acceptance line is "Risk surfaces ATR, the 2% drawdown disable,
 * and the 3-strike state with honest unavailability". The honest
 * unavailability is not a fallback for a broken display — it is the specified
 * behaviour, and today it is the correct reading for two of the three rows,
 * because only the ATR(14) stop is implemented in this tree.
 *
 * Each row therefore carries its OWN availability rather than the room
 * carrying one. A single "risk layer: live" banner above a real ATR would let
 * a reader conclude the 2% drawdown disable and the 24h key lock are also
 * active. They are not. A safety rail that looks present and is not is worse
 * than one that is visibly absent, so the row states the spec's value, the
 * reading, and the reason there is no reading.
 *
 * NO WRITE AFFORDANCE. There is no button, no toggle, no "clear strikes", no
 * "unlock key". The room surfaces state; T9's Paper/Live room owns the rails
 * and the execution gates, and the 1280x800 read-only contract for the
 * remaining rooms (T10) is stricter still. A read-only surface that grows a
 * control is a scope change, and one nobody notices.
 */
export type RiskLayerSurfaceProps = {
  view: RiskLayerView
}

function freshnessOf(availability: RiskLayerView["readings"][number]["availability"]): string {
  if (availability.status === "live") return `live from ${availability.source}`
  if (availability.status === "stale") return `stale from ${availability.source}: ${availability.reason}`
  if (availability.status === "unavailable") return `unavailable (owner ${availability.owner})`
  return `reserved for ${availability.workstream}`
}

export function RiskLayerSurface({ view }: RiskLayerSurfaceProps) {
  return (
    <section className="terminal-risk-layer" data-risk-layer={view.complete ? "complete" : "incomplete"} aria-label="Risk layer">
      <p className="terminal-risk-layer__summary" data-risk-complete={String(view.complete)}>
        {view.complete
          ? "All three risk-layer capabilities are reporting a live reading."
          : `Risk layer incomplete — awaiting: ${view.incompleteOwners.join(", ")}.`}
      </p>

      <ul className="terminal-risk-layer__rows">
        {view.readings.map((r) => (
          <li key={r.key} data-risk-capability={r.key} data-availability={r.availability.status}>
            <p className="terminal-risk-layer__label">
              {r.label} <span className="terminal-risk-layer__spec">({r.specValue})</span>
            </p>
            {r.availability.status === "live" ? (
              <p className="terminal-risk-layer__value" data-risk-value={r.value ?? "unavailable"}>
                {r.value}
              </p>
            ) : (
              // The unavailable branch renders the shared component, which by
              // construction has no code path that can emit a number. That is
              // deliberate: a `—` or a `0` standing in for an absent safety
              // rail is the exact defect the WS-6 unavailable state was built
              // to prevent.
              <UnavailableState availability={r.availability} label={r.label} />
            )}
            <p className="terminal-risk-layer__detail">{r.detail}</p>
            <p className="terminal-risk-layer__provenance">{freshnessOf(r.availability)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
