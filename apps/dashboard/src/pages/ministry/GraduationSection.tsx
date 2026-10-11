import { useEffect, useState } from "react"
import { fetchGraduationOverview } from "@/lib/graduation"
import type { GraduationOverview, GraduationStrategy } from "@/lib/graduation"

/**
 * Graduation section — the per-tag graduation readout (W3-04 Task 4).
 *
 * SHIPS INSIDE the paper room, in its OWN region so it disturbs neither of the
 * two documented ones: the boundary half stays at zero interactive controls and
 * the ledger half stays exactly the pre-existing controls. The room renders
 * read-only tables with no buttons and no form fields, so the affordance audit
 * in `PaperLiveRoom.test.tsx` is unaffected by this section existing.
 *
 * HONEST ABSENCE IS THE WHOLE CONTRACT, and it is stricter here than anywhere
 * else in the room, because every input to this readout is usually missing. A
 * statistic that was not measured renders as `absent — <reason>`; it is never a
 * `0`, never a bare dash, and never an empty cell. The reason a bare dash is
 * refused is specific: a dash is the glyph that means "nothing here, and nothing
 * is wrong" — so it would turn "nobody measured this" into a clean bill of
 * health, which is precisely the reading this readout must never support. And an
 * empty cell is indistinguishable from a failed render, so a reader could not
 * tell a real absence from a broken panel.
 *
 * THE SAME RULE GOVERNS A WHOLE LEG. The backtest and live legs contribute
 * nothing today, and the table says so by name rather than omitting them: an
 * omitted leg is a leg a reader will assume was fine.
 */
export function GraduationSection() {
  const [overview, setOverview] = useState<GraduationOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchGraduationOverview()
      .then((o) => { if (alive) setOverview(o) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  return (
    <div className="panel" data-testid="graduation-section">
      <strong>Graduation readout</strong>
      <p className="muted small">
        Advisory only — nothing here promotes a strategy, flips a permit or unlocks a venue. Absent
        data reads as an absence with its reason, never as a zero.
      </p>

      {error ? (
        <div className="panel muted" data-testid="graduation-error">
          <p>graduation readout unavailable — {error}</p>
          <p className="muted small">
            no table is shown rather than an empty one that would read as "nothing to report".
          </p>
        </div>
      ) : null}

      {!overview && !error ? <p className="muted small">loading graduation readout…</p> : null}

      {overview ? (
        <>
          <div className="muted small" data-testid="graduation-tag-semantics">
            Grouped by {overview.tagSemantics.field} — {overview.tagSemantics.scope}.{" "}
            {overview.tagSemantics.note}
          </div>

          <div className="muted small" data-testid="graduation-bars">
            {overview.bars.supplied
              ? "promotion bars supplied"
              : `no promotion bar exists in the platform — ${overview.bars.reason}, so nothing can be argued over a line`}
          </div>

          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="graduation-legs">
            {(["backtest", "paper", "live"] as const).map((name) => {
              const leg = overview.legs[name]
              // The paper leg carries a LIST: a capped read and an empty pile are
              // different facts that can hold at once, and collapsing them into
              // one string would lose whichever one did not win.
              const reasons =
                name === "paper"
                  ? (overview.legs.paper as { reasons: string[] }).reasons
                  : leg.reason
                    ? [leg.reason]
                    : []
              return (
                <li key={name} className="muted small" data-testid={`graduation-leg-${name}`}>
                  {name}:{" "}
                  {leg.present ? (
                    <>present — {leg.rowsSeen} rows, {leg.windows} windows</>
                  ) : (
                    <>
                      absent{reasons.length > 0 ? ` — ${reasons.join(" · ")}` : ""} ({leg.rowsSeen} rows
                      read)
                    </>
                  )}
                  {/* The read limit is shown beside the count it bounds, so a
                      count sitting at the cap cannot be read as a whole history. */}
                  {name === "paper" ? (
                    <span data-testid="graduation-leg-paper-limit">
                      {" "}
                      · read limit {overview.legs.paper.readLimit} closes
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {overview.strategies.length === 0 ? (
            <p className="muted small" data-testid="graduation-absence">
              {/* WHY there are no rows, not merely that the readout is
                  incomplete: the top-level reason is usually `bar-unavailable`,
                  which explains the verdict but not the empty table, so every
                  absent leg's own reason is named alongside it. */}
              no strategy readout —{" "}
              {[
                ...(["backtest", "paper", "live"] as const)
                  .filter((name) => !overview.legs[name].present)
                  .flatMap((name) =>
                    name === "paper"
                      ? overview.legs.paper.reasons
                      : overview.legs[name].reason
                        ? [overview.legs[name].reason as string]
                        : []
                  ),
                ...(overview.unattributed.reason ? [overview.unattributed.reason] : []),
                ...(overview.reason ? [overview.reason] : [])
              ].join(" · ")}
            </p>
          ) : null}

          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {overview.strategies.map((row) => (
              <StrategyRow key={row.tag} row={row} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

/**
 * One tag's row: stage, gate evidence, warnings, and every statistic in a state
 * that distinguishes "measured zero" from "not measured".
 */
function StrategyRow({ row }: { row: GraduationStrategy }) {
  return (
    <li className="panel" data-testid={`graduation-row-${row.tag}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{row.tag}</strong>
        <span data-testid={`graduation-row-${row.tag}-stage`}>stage: {row.stage}</span>
      </div>

      {/* BOTH COUNTS, because they are different facts: `used` is what the gate
          argued from, `seen` is what the evidence pile held. */}
      <div className="muted small" data-testid={`graduation-row-${row.tag}-windows`}>
        windows used {row.windowsUsed} of {row.windowsSeen} ·{" "}
        <span data-testid={`graduation-row-${row.tag}-verdict`}>verdict: {row.verdict}</span>
      </div>

      <div data-testid={`graduation-row-${row.tag}-stats`}>
        <div data-testid={`graduation-row-${row.tag}-return`}>
          return (recency-weighted):{" "}
          {formatStat(row.stats.returnPct.value, row.stats.returnPct.reason)}
        </div>
        <div data-testid={`graduation-row-${row.tag}-sharpe`}>
          sharpe (aggregated): {formatStat(row.stats.sharpe.value, row.stats.sharpe.reason)}
        </div>
        <div data-testid={`graduation-row-${row.tag}-maxdd`}>
          max drawdown: {formatStat(row.stats.maxDd.value, row.stats.maxDd.reason)}
        </div>
        <div data-testid={`graduation-row-${row.tag}-capital`}>
          capital committed:{" "}
          {formatStat(row.stats.capitalCommittedUsd, row.stats.capitalCommittedUsd === null ? "no-measured-capital-base" : null, "USD ")}
        </div>
        <div className="muted small" data-testid={`graduation-row-${row.tag}-drag`}>
          cost drag: {formatDrag(row)}
        </div>
      </div>

      <div className="muted small" data-testid={`graduation-row-${row.tag}-warnings`}>
        warnings: {row.warnings.length === 0 ? "none" : row.warnings.join(" · ")}
      </div>
      <div className="muted small" data-testid={`graduation-row-${row.tag}-reasons`}>
        reasons: {row.reasons.length === 0 ? "none" : row.reasons.join(" · ")}
      </div>
    </li>
  )
}

/**
 * A measured number, or an explicit absence carrying its reason.
 *
 * THE THREE FORBIDDEN READINGS, all refused here rather than at each call site:
 * a `0` for a statistic nobody measured (which would argue a strategy over a
 * line on a blank field), a bare dash (which reads as "no data, and that is
 * fine"), and an empty cell (which a failed render would reproduce exactly).
 *
 * `Number.isFinite` is the test, not truthiness and not `!= null`, so a genuine
 * measured `0` still prints as `0` and stays distinguishable from an absence.
 */
function formatStat(value: number | null, reason: string | null, prefix = ""): string {
  if (!Number.isFinite(value)) return `absent${reason ? ` — ${reason}` : ""}`
  return `${prefix}${value}`
}

/**
 * Cost drag, with the two labels a reader cannot infer: that it is MODELED
 * rather than measured, and that it has NOT been applied to anything. A modeled
 * number printed without its provenance is a modeled number read as a measured
 * one, and a drag printed beside an unadjusted return without saying so invites
 * the reader to subtract one from the other — an arithmetic no policy in the
 * stack defines.
 */
function formatDrag(row: GraduationStrategy): string {
  const drag = row.stats.costDragUsd
  if (!Number.isFinite(drag.value)) return `absent — ${drag.reason ?? "not measured"}`
  const provenance = drag.provenances.length > 0 ? drag.provenances.join(", ") : "unlabelled"
  const applied = drag.adjusted ? "drag-adjusted" : "not drag-adjusted"
  return `USD ${drag.value} (${provenance}, ${applied})`
}