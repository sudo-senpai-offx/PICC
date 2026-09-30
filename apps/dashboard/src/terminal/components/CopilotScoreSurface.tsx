import { UnavailableState } from "./UnavailableState"
import type { CopilotDecisionView } from "../domain/copilotDecision"
import { COPILOT_ENGINE_OWNER } from "../domain/copilotDecision"

/**
 * WS-7 T7 — the deterministic Copilot score surface for the Markets room
 * (COP-22, AC-020's first room).
 *
 * WHAT THIS RENDERS, and why each of the three things T7 names is here:
 *
 *  - THE SCORE — or, honestly, its absence. `score` is `null` both when the
 *    engine has not run and when the state was unscoreable, and the two are
 *    told apart by the view's `available` flag and `unavailableReason`. There
 *    is no code path in this component that can print a number for an absent
 *    score.
 *  - PER-EXPERT CONTRIBUTIONS — always all six, in spec order, each carrying
 *    its own weight, so a reader can see the 5% sentiment gap rather than a
 *    renormalized total. An unavailable expert renders its reason IN the row.
 *  - FIRED VETOES — only the fired ones, each with its rule id, rule version,
 *    what it suppressed, and its inputs. AC-022's prohibited side effect is
 *    "a veto may not be absorbed into a lower score or hidden behind a
 *    boolean", so the veto list is a first-class block, not a footnote, and it
 *    is never collapsed to a count.
 *
 * WHAT IT DELIBERATELY DOES NOT RENDER. No execution control, no order button,
 * no size, and no confirmation affordance of any kind. The tier is displayed
 * as a READ of what the engine concluded, and the surface exposes no way to act
 * on it: the Paper/Live room owns the execution rails (T9) and D6/§1's
 * "no live-money order placement" guardrail is absolute.
 *
 * IT IS NOT THE REMOTE COPILOT PANEL. `CopilotPanel` renders remote LLM prose
 * and AC-014 forbids that prose becoming a score. This component renders a
 * deterministic function's output. The two are separate components with
 * separate provenance labels precisely so a future edit cannot quietly merge
 * them.
 */
export type CopilotScoreSurfaceProps = {
  view: CopilotDecisionView
}

function stamp(ms: number | null): string {
  return ms == null ? "not observed" : new Date(ms).toISOString()
}

export function CopilotScoreSurface({ view }: CopilotScoreSurfaceProps) {
  if (!view.available) {
    return (
      <section className="terminal-copilot-score" data-copilot-decision="unavailable" aria-label="Copilot decision">
        <p className="terminal-copilot-score__provenance">copilot: deterministic (local)</p>
        <UnavailableState
          availability={{ status: "unavailable", reason: view.unavailableReason ?? "no reading", owner: COPILOT_ENGINE_OWNER, since: 0 }}
          label="Copilot score, expert contributions and vetoes"
        />
      </section>
    )
  }

  const tier = view.tier

  return (
    <section className="terminal-copilot-score" data-copilot-decision="live" aria-label="Copilot decision">
      <p className="terminal-copilot-score__provenance">copilot: deterministic (local)</p>
      <p className="terminal-copilot-score__meta">
        engine {view.engineVersion} · computed {stamp(view.computedAt)} · regime {view.regime} · confidence{" "}
        {view.confidence}
      </p>

      <p className="terminal-copilot-score__score" data-score={view.score == null ? "unscoreable" : String(view.score)}>
        {/* The two states are different sentences. `0` is a real confluence
            result; "unscoreable" is the absence of one. Rendering them
            identically - or rendering the absence as 0 - is the fabrication
            this branch exists to prevent. */}
        {view.score == null ? "unscoreable" : `score ${view.score}`}
      </p>

      {tier ? (
        <p className="terminal-copilot-score__tier" data-tier={tier.tier} data-action={tier.action}>
          tier {tier.tier} · action {tier.action} · risk {tier.riskPct * 100}% · rung {tier.rung} · automationPermitted{" "}
          {String(tier.automationPermitted)}
        </p>
      ) : null}

      {view.activeBoosters.length > 0 ? (
        <p className="terminal-copilot-score__boosters">active boosters: {view.activeBoosters.join(", ")}</p>
      ) : null}
      {view.conflictOverrides.length > 0 ? (
        <p className="terminal-copilot-score__conflicts">conflict overrides: {view.conflictOverrides.join(", ")}</p>
      ) : null}

      <h3 className="terminal-copilot-score__heading">Expert contributions</h3>
      <ul className="terminal-copilot-score__experts">
        {view.contributions.map((c) => (
          <li key={c.expert} data-expert={c.expert} data-available={String(c.available)}>
            <span className="terminal-copilot-score__expert-id">{c.expert}</span>{" "}
            <span className="terminal-copilot-score__expert-weight">weight {c.weightPct}%</span>{" "}
            {c.available ? (
              <span className="terminal-copilot-score__expert-delta">
                {c.rawDelta == null ? "no delta reported" : `delta ${c.rawDelta >= 0 ? "+" : ""}${c.rawDelta}`}
              </span>
            ) : (
              // The reason is IN the row, not in a tooltip and not in a
              // footnote: an expert that contributed nothing because it could
              // not be evaluated is a different fact from one that
              // contributed nothing because it found nothing.
              <span className="terminal-copilot-score__expert-unavailable">
                unavailable — {c.unavailableReason}
              </span>
            )}
          </li>
        ))}
      </ul>

      <h3 className="terminal-copilot-score__heading">Fired vetoes</h3>
      {view.firedVetoes.length === 0 ? (
        <p className="terminal-copilot-score__no-vetoes" data-vetoes="none">
          none fired
        </p>
      ) : (
        <ul className="terminal-copilot-score__vetoes">
          {view.firedVetoes.map((v) => (
            <li key={v.ruleId} data-veto={v.ruleId}>
              <span className="terminal-copilot-score__veto-id">{v.ruleId}</span>{" "}
              <span className="terminal-copilot-score__veto-version">v{v.ruleVersion}</span>{" "}
              <span className="terminal-copilot-score__veto-suppressed">suppressed: {v.suppressed}</span>{" "}
              <span className="terminal-copilot-score__veto-inputs">
                inputs: {Object.entries(v.inputs).map(([k, val]) => `${k}=${String(val)}`).join(", ")}
              </span>{" "}
              <span className="terminal-copilot-score__veto-at">{stamp(v.evaluatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
