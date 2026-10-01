import { NO_LIVE_AFFORDANCE_REASON, PAPER_LIVE_INTERACTIVE_AFFORDANCES } from "../domain/paperLive"
import type { PaperLiveBrokerRow, PaperLiveConjunct, PaperLiveRail, PaperLiveView } from "../domain/paperLive"

/**
 * WS-7 T9 — the Paper/Live room's surface.
 *
 * ===========================================================================
 * READ-ONLY BY CONSTRUCTION, NOT BY DISCIPLINE
 * ===========================================================================
 *
 * There is not one interactive element in this file. Not "no control that
 * advances execution" — no `<button>`, no `<input>`, no `<select>`, no `<a>`, no
 * `onClick`, no `role="button"`, no `contentEditable`, no `<form>`. That is a
 * stronger claim than the acceptance needs, and it is the right one: a room that
 * merely had no LIVE control could still grow a non-live one that a later edit
 * re-purposes, and the affordance audit would have to be re-run each time to
 * notice. A surface with no interactive primitive has nothing to re-audit.
 *
 * `PaperLiveRoom.test.tsx` proves this from the RENDERED MARKUP, not from this
 * comment and not from `PAPER_LIVE_INTERACTIVE_AFFORDANCES` — so adding a button
 * here is a failing test even if the enumeration is also updated.
 *
 * ===========================================================================
 * WHY THE VERDICT IS THE FIRST THING RENDERED
 * ===========================================================================
 *
 * The verdict sits at the top, before any table, because a reader who scrolls to
 * the broker table first will read `recordedFlag` and could take it for the
 * permission. The gated read is labelled as the permission everywhere it
 * appears, and the raw flag is labelled as the raw flag.
 *
 * `UNKNOWN` IS ITS OWN STATE, and it is styled apart from a derived denial
 * because it means something different: the question could not be asked. A
 * reader who sees "no live-trading affordance" has been told a fact; a reader who
 * sees "not determined" has been told the room does not know. Collapsing the two
 * would let an outage read as a clean bill of health, which is the WS-6 failure
 * this repository keeps guarding against.
 */
export type PaperLiveSurfaceProps = {
  view: PaperLiveView
}

export function PaperLiveSurface({ view }: PaperLiveSurfaceProps) {
  const unknown = view.verdict === "unknown"
  return (
    <section
      className="terminal-paper-live"
      data-paper-live-verdict={view.verdict}
      data-paper-live-complete={String(view.complete)}
      aria-label="Paper/Live execution boundary"
    >
      {/* The verdict, first and unmissable. */}
      <p className="terminal-paper-live__verdict" data-verdict-label={unknown ? "unknown" : "no-live-affordance"}>
        <span className="terminal-paper-live__verdict-word">{view.verdictLabel}</span> — {view.verdictReason}
      </p>

      {view.missing.length > 0 ? (
        <ul className="terminal-paper-live__missing" data-missing-count={view.missing.length}>
          {view.missing.map((item) => (
            <li key={item} data-missing={item}>
              Not obtained: {item}. An unobserved input is not a satisfied requirement.
            </li>
          ))}
        </ul>
      ) : null}

      {/* D6's ladder and the current rung. The rung is rendered as a FACT with its
          own provenance sentence, never as a position the reader can move. */}
      <section className="terminal-paper-live__ladder" aria-label="D6 escalation ladder">
        <h3>D6 escalation ladder</h3>
        {view.ladder === null ? (
          <p data-ladder="absent">The ladder was not obtained, so no rung is shown. It is not defaulted here.</p>
        ) : (
          <>
            <ol data-ladder-rungs={view.ladder.rungs.length}>
              {view.ladder.rungs.map((rung) => (
                <li key={rung} data-rung={rung} data-current={String(view.currentRung === rung)}>
                  {rung}
                  {view.currentRung === rung ? " — current rung" : ""}
                </li>
              ))}
            </ol>
            <p data-ladder-rule>{view.ladder.rule}</p>
          </>
        )}
        <p data-current-rung={view.currentRung ?? "none"}>{view.currentRungReason}</p>
      </section>

      {/* D5's permit state, per broker, with the provenance gate made VISIBLE. */}
      <section className="terminal-paper-live__permits" aria-label="automationPermitted state">
        <h3>automationPermitted, per broker record (D5)</h3>
        <ul data-broker-rows={view.brokers.length}>
          {view.brokers.map((row) => (
            <BrokerRow key={row.brokerId} row={row} />
          ))}
        </ul>
        {view.brokers.length === 0 ? (
          <p data-broker-rows="0">
            No broker record was reported. An absent broker record and an unpermitted broker record are different facts, and
            neither is rendered as the other.
          </p>
        ) : null}
      </section>

      {/* The named observations, one per requirement, each with its own observed value. */}
      <section className="terminal-paper-live__conjuncts" aria-label="requirements">
        <h3>What was observed, per requirement</h3>
        <ul data-conjunct-count={view.conjuncts.length}>
          {view.conjuncts.map((conjunct) => (
            <ConjunctRow key={`${conjunct.requirement}-${conjunct.label}`} conjunct={conjunct} />
          ))}
        </ul>
        <p data-tier-ownership>
          These are observations, not decisions. What a permit means for an action is the Copilot engine&rsquo;s
          (<code>tiers.mjs</code>), and this room does not restate it: no consumer of these rows can turn one into an order.
        </p>
      </section>

      <RailSection
        title="Consent rails — the command-centre gate set, with the producer's own notes"
        rails={view.consentRails}
        emptyReason="No consent rail was reported. The command-centre gate set was not obtained, so the consent and opt-in state is not shown. It is not summarised as 'none required'."
      />
      <RailSection
        title="Ceremony rails — the WS-3 ceremony store"
        rails={view.ceremonyRails}
        emptyReason="No ceremony rail was reported. The WS-3 ceremony readout was not obtained, so no venue class's ceremony state is claimed."
      />

      {/* T16's residual, stated where a reader deciding to trust the table will see it. */}
      {view.permitResidual ? (
        <p className="terminal-paper-live__residual" data-permit-residual="present">
          <strong>Recorded residual, not hidden:</strong> {view.permitResidual}
        </p>
      ) : null}

      {view.absences.length > 0 ? (
        <section className="terminal-paper-live__absences" aria-label="named absences" data-absence-count={view.absences.length}>
          <h3>Named absences</h3>
          {view.absences.map((absence) => (
            <p key={absence.what} data-absence={absence.what}>
              <strong>{absence.what}.</strong> {absence.detail}
            </p>
          ))}
        </section>
      ) : null}

      {/* The affordance audit, rendered rather than promised. The count is data so a
          test can assert it without parsing prose. */}
      <p className="terminal-paper-live__no-affordance" data-live-affordance="none" data-interactive-affordance-count={PAPER_LIVE_INTERACTIVE_AFFORDANCES.length}>
        {NO_LIVE_AFFORDANCE_REASON}
      </p>
    </section>
  )
}

function BrokerRow({ row }: { row: PaperLiveBrokerRow }) {
  return (
    <li
      className="terminal-paper-live__broker"
      data-broker={row.brokerId}
      // The GATED read is the permission. Everything else is context.
      data-automation-permitted={String(row.automationPermitted)}
      data-recorded-flag={String(row.recordedFlag)}
      data-provenance-resolves={String(row.provenanceResolves)}
      data-ceremony-unlocked={String(row.ceremonyUnlocked)}
      data-change-count={row.changeCount}
    >
      <p className="terminal-paper-live__broker-label">
        {row.brokerId} —{" "}
        <span data-permission={row.automationPermitted ? "permitted" : "not-permitted"}>
          {row.automationPermitted ? "PERMITTED (provenance-gated)" : "not permitted"}
        </span>
      </p>
      {/* The raw flag, labelled as the raw flag. Showing it without this label is
          exactly how a recorded `true` gets read as a permission. */}
      <p data-recorded-flag-label="raw">
        The record&rsquo;s own <code>automationPermitted</code> field reads{" "}
        <span data-raw-flag={String(row.recordedFlag)}>{String(row.recordedFlag)}</span>. That is the stored value, not the
        permission: T16&rsquo;s read is provenance-gated, so a record whose flag is <code>true</code> with no resolving
        approving authority reads as not permitted.
      </p>
      <p data-provenance>
        Approving authority on record:{" "}
        <span data-permit-authority={row.permitChangedByAuthorityId ?? "none"}>
          {row.permitChangedByAuthorityId ?? "none — no authority has ever signed for this broker"}
        </span>
        {row.provenanceResolves ? " (resolves)" : " (does not resolve, or was never set)"} · changed at:{" "}
        <span data-permit-changed-at={row.permitChangedAt ?? "never"}>
          {row.permitChangedAt ?? "never"}
        </span>{" "}
        · recorded changes: <span data-change-count={row.changeCount}>{row.changeCount}</span>
      </p>
      <p data-ceremony-unlocked-label>
        Ceremony unlock on this broker record:{" "}
        <span data-broker-ceremony={String(row.ceremonyUnlocked)}>{String(row.ceremonyUnlocked)}</span>. AC-026 requires this
        independently of the permit; a true permit does not substitute for it.
      </p>
      <p data-broker-reason>{row.verdictReason}</p>
    </li>
  )
}

function ConjunctRow({ conjunct }: { conjunct: PaperLiveConjunct }) {
  // `null` is rendered as its own token and never as `false`: "not observed" and
  // "observed to be unmet" are different claims, and this room does not make the
  // first one in place of the second.
  const state = conjunct.observed === null ? "not-observed" : conjunct.observed === true ? "observed-true" : "observed-false"
  return (
    <li data-requirement={conjunct.requirement} data-observed={state} data-observed-value={String(conjunct.observed)}>
      <span className="terminal-paper-live__requirement">{conjunct.requirement}</span> —{" "}
      <span className="terminal-paper-live__observed">{state}</span>
      {conjunct.value !== null ? (
        <>
          {" "}
          (fact: <span className="terminal-paper-live__observed-value">{conjunct.value}</span>)
        </>
      ) : null}
      : {conjunct.label}
    </li>
  )
}

function RailSection({ title, rails, emptyReason }: { title: string; rails: readonly PaperLiveRail[]; emptyReason: string }) {
  return (
    <section className="terminal-paper-live__rails" aria-label={title}>
      <h3>{title}</h3>
      <ul data-rail-count={rails.length}>
        {rails.map((rail) => (
          <li key={`${rail.source}:${rail.id}`} data-rail-source={rail.source} data-rail-id={rail.id} data-rail-status={rail.status}>
            <p className="terminal-paper-live__rail-label">
              {rail.id} —{" "}
              <span className="terminal-paper-live__rail-status">{rail.status}</span>
            </p>
            {/* The producer's own note, verbatim. Never summarised into a count:
                a gate set summarised as "3 of 8 passed" reads as progress. */}
            {rail.note ? <p className="terminal-paper-live__rail-note">{rail.note}</p> : null}
          </li>
        ))}
      </ul>
      {rails.length === 0 ? <p data-rail-count="0">{emptyReason}</p> : null}
    </section>
  )
}