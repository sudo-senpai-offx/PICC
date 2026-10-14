import { useState } from "react"
import { fetchPremortemOverview } from "@/lib/premortem"
import type { PreMortemOverview, MutationVerdict, Verdict } from "@/lib/premortem"

/**
 * Pre-mortem section — the "which failure modes would we catch" readout (W3-05).
 *
 * THE RUN BUTTON IS THE DESIGN, NOT AN OPTIMISATION. The route costs about eleven
 * seconds: it builds a disposable git worktree outside the repository and runs
 * real guard suites against a deliberately broken implementation. That is exactly
 * what gives the mutation verdicts their meaning — a tier that can only ever
 * return `not-run` reports on nothing — and it is also why nothing here fetches on
 * mount. An eleven-second spinner reads as a broken page, and firing it per
 * visitor multiplies checkouts instead of reusing one. So the cost is opt-in and
 * visible, and once paid the result is kept with the time it was measured, because
 * the readout describes one tree at one commit and silently drifting under a
 * "current" label would be the one dishonest thing this screen could do.
 *
 * BOTH CHANNELS RENDER, AND NEITHER IS THE OTHER. `catalogFindings` is the
 * catalog's self-audit and `results` is each claim's evaluation. They are not
 * redundant: the audit deliberately takes no inventory, so it structurally cannot
 * see a claim that resolves to nothing — that is the `stale-catalog-entry` verdict
 * in `results`. A view built from either one alone is confidently wrong about half
 * the catalog, so the audit is rendered first and separately.
 */

const VERDICT_TONE: Record<Verdict, string> = {
  verified: "ok",
  "partially-covered": "warn",
  "guard-missing": "bad",
  "guard-cannot-fail": "bad",
  unclaimed: "warn",
  "unverified-manual": "warn",
  "stale-catalog-entry": "bad"
}

const MUTATION_TONE: Record<MutationVerdict, string> = {
  bites: "ok",
  "does-not-bite": "bad",
  "not-run": "muted"
}

function clockOf(when: number): string {
  return new Date(when).toLocaleTimeString()
}

export function PreMortemSection() {
  const [data, setData] = useState<PreMortemOverview | null>(null)
  const [measuredAt, setMeasuredAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setData(await fetchPremortemOverview())
      setMeasuredAt(Date.now())
    } catch (e) {
      // THIS CATCH DOES NOT CLEAR `data`, AND THIS SECTION IS NOW THE ODD ONE OUT.
      // `MarketAnalysisSection` calls `setData(null)` on failure; this one leaves the
      // previous readout on screen beside the new error, so the two can be read as one
      // answer. That divergence is deliberate and settled: there, the readout is
      // per-symbol and per-moment, and the button label changes between runs, so a
      // stale EURUSD snapshot sitting under a fresh "re-read volatility" label invites
      // the misreading those panels exist to prevent. Here, the readout describes one
      // tree at one commit and the label is always "re-run pre-mortem", so leaving the
      // last successful run visible is informative rather than misleading.
      //
      // Recorded here so the next reader does not read this as an oversight and
      // "fix" it to match. Changing it is a behaviour change and needs its own
      // decision, not a consistency edit.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const stale = measuredAt !== null && Date.now() - measuredAt > 15 * 60 * 1000

  return (
    <section className="panel" data-testid="premortem-section">
      <header className="panel-head">
        <h3>Pre-mortem</h3>
        <button type="button" onClick={run} disabled={busy} data-testid="premortem-run">
          {busy ? "running…" : data ? "re-run pre-mortem" : "run pre-mortem"}
        </button>
      </header>

      <p className="muted small">
        Runs the real guard suites against a broken implementation. About eleven
        seconds; the result is a measurement of this tree at one commit.
      </p>

      {error ? (
        <div className="panel muted" data-testid="premortem-error">
          <p>pre-mortem unavailable — {error}</p>
        </div>
      ) : null}

      {!data && !error ? (
        <p className="muted small" data-testid="premortem-idle">
          not yet run.
        </p>
      ) : null}

      {data && measuredAt !== null ? (
        <p className="muted small" data-testid="premortem-measured-at">
          measured {clockOf(measuredAt)}
          {stale ? " — may be out of date, re-run to refresh" : ""}
        </p>
      ) : null}

      {data ? (
        <>
          {/* The audit renders first because it ran first, and separately because
              a consumer reading only this array misses every unresolvable claim. */}
          <div data-testid="premortem-audit">
            <h4>
              Catalog self-audit{" "}
              <span className="muted small">
                ({data.catalogFindings.length === 0
                  ? "clean"
                  : `${data.catalogFindings.length} finding(s)`})
              </span>
            </h4>
            {data.catalogFindings.length === 0 ? (
              <p className="muted small" data-testid="premortem-audit-clean">
                every entry names a subsystem that exists and carries a claim or a
                recorded disposition.
              </p>
            ) : (
              <ul>
                {data.catalogFindings.map((f) => (
                  <li key={f.id} data-testid="premortem-finding">
                    <strong>{f.id}</strong> — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div data-testid="premortem-results">
            <h4>Claims</h4>
            <ul>
              {data.results.map((r) => (
                <li key={r.id} data-testid="premortem-result">
                  <strong>{r.id}</strong>{" "}
                  <span className={VERDICT_TONE[r.verdict]}>{r.verdict}</span>
                  {r.manualCheck ? (
                    <div className="muted small" data-testid="premortem-manual">
                      human check: {r.manualCheck}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div data-testid="premortem-mutation">
            <h4>Do the guards bite?</h4>
            <p className="muted small">
              Each marked guard was run against a broken implementation. A guard
              that does not bite is worse than one that is missing — it looks like
              coverage.
            </p>
            <ul>
              {data.mutation
                .filter((m) => m.verdict !== "not-run" || m.id)
                .map((m) => (
                  <li key={m.id} data-testid="premortem-mutation-row">
                    <strong>{m.id}</strong>{" "}
                    <span className={MUTATION_TONE[m.verdict]}>{m.verdict}</span>
                    {m.verdict === "not-run" && m.evidence ? (
                      <span className="muted small"> — {m.evidence.reason}</span>
                    ) : null}
                  </li>
                ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  )
}