import { useEffect, useState } from "react"
import { fetchCostsOverview } from "@/lib/costs"
import type { CostsOverview, CostWindow } from "@/lib/costs"

/**
 * Costs section — the realized-cost scorecard surface (fee-intelligence Task 7).
 *
 * Ships INSIDE the wealth room (spec decision 4+6: wealth-section surface, no
 * separate room) and stays unwired like its host: the WS-6 T0 room-key contract
 * is frozen, so no INNER_NAV / MINISTRY_ROOMS key is added here.
 *
 * Honest absence is the contract, mirrored from the API: venues appear only
 * with observed fills; near-empty windows render their reason (never a zero);
 * every number carries its measured|modeled|calibrated badge; the paper drag
 * panel is a SEPARATE modeled series beside the real curve, never summed into
 * venue totals.
 */
export function CostsSection() {
  const [overview, setOverview] = useState<CostsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchCostsOverview()
      .then((o) => { if (alive) setOverview(o) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  function renderWindow(label: string, window: CostWindow, testId: string) {
    if (window.totalUsd === null) {
      return (
        <div className="muted small" data-testid={testId}>
          {label}: no observed costs{window.reason ? ` — ${window.reason}` : ""}
        </div>
      )
    }
    return (
      <div data-testid={testId}>
        <span>
          {label}: USD {window.totalUsd}
        </span>{" "}
        <span className="muted small" data-testid={`${testId}-provenance`}>
          {window.provenance}
        </span>
        <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {window.byKind.map((line) => (
            <li key={line.kind} className="muted small">
              {line.kind}: USD {line.totalUsd}{" "}
              <span data-testid={`${testId}-${line.kind}-provenance`}>{line.provenance}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="panel" data-testid="costs-section">
      <strong>Realized costs</strong>
      <p className="muted small">
        Per-venue day + all-time spend with provenance on every number. Absent data reads as an
        absence, never a zero.
      </p>

      {error ? (
        <div className="panel muted">
          <p>costs unavailable — {error}</p>
          <p className="muted small">no total is shown rather than a stale one.</p>
        </div>
      ) : null}

      {!overview && !error ? <p className="muted small">loading costs…</p> : null}

      {overview ? (
        <>
          {overview.venues.length === 0 ? (
            <p className="muted small" data-testid="costs-absence">
              no observed costs{overview.reason ? ` — ${overview.reason}` : ""}
            </p>
          ) : null}

          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {overview.venues.map((row) => (
              <li key={row.venue} className="panel" data-testid={`costs-venue-${row.venue}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{row.venue}</strong>
                  {row.waste ? (
                    <span className="muted small" data-testid={`costs-venue-${row.venue}-waste`}>
                      {row.waste.refused} refused · {row.waste.failed} failed
                    </span>
                  ) : null}
                </div>
                {renderWindow("day", row.day, `costs-venue-${row.venue}-day`)}
                {renderWindow("all-time", row.allTime, `costs-venue-${row.venue}-alltime`)}
              </li>
            ))}
          </ul>

          <div className="panel" data-testid="costs-paper">
            <strong>Paper cost drag — {overview.paper.label}</strong>
            <p className="muted small">
              Modeled spread + slippage beside the real curve. Paper charges no explicit fee, so
              the fee leg is a modeled zero. Never summed into venue totals.
            </p>
            {overview.paper.reason ? (
              <p className="muted small" data-testid="costs-paper-absence">
                {overview.paper.reason}
              </p>
            ) : null}
            <div className="muted small" data-testid="costs-paper-total">
              cumulative drag: USD{" "}
              {overview.paper.series.length > 0
                ? overview.paper.series[overview.paper.series.length - 1].cumulativeCostUsd
                : "—"}
              {" · "}
              {overview.paper.lines.length} closes modeled
            </div>
            {overview.paper.skipped.length > 0 ? (
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {overview.paper.skipped.map((s, i) => (
                  <li key={`${s.closeId}-${i}`} className="muted small">
                    {s.closeId ?? "unknown close"}: {s.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
