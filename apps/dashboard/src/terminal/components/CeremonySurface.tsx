import { UnavailableState } from "./UnavailableState"
import type { CeremonyView, CeremonyClassRow } from "../domain/ceremonyRoom"
import { CEREMONY_NO_UNLOCK_AFFORDANCE_REASON } from "../domain/ceremonyRoom"

/**
 * WS-7 T8 — the Ceremony room's surface.
 *
 * PER VENUE CLASS, EVERY GATE WITH ITS OWN DENY REASON.
 *
 * The store's own honesty contract (ADR-0005, restated at `ceremonyState.mjs:1`)
 * is that every un-evaluable input is a named `ceremony:deny:*` reason and never
 * a silent pass. This surface renders it literally: each gate is its own row,
 * carrying the producer's own `reason` string. A summary like "2 of 4 gates
 * passed" would be the room's own invention, and a class whose gates ALL fail
 * must never be summarised in a way that reads as progress.
 *
 * `ok` FROM THE READOUT IS NOT AN UNLOCK.
 *
 * The route's top-level `ok: true` means THE READOUT EXECUTED — an unhealthy
 * store still answers 200 with every gate naming `ceremony:deny:store-unhealthy`,
 * by design (`handlers.mjs:1866-1867`). The surface labels it exactly that way,
 * because a reader who took it as "the ceremony is fine" would be wrong exactly
 * when the store is broken.
 *
 * NO UNLOCK CONTROL. See `CEREMONY_NO_UNLOCK_AFFORDANCE_REASON`: the store's
 * unlock seam refuses outside a test run, so a button here could never succeed.
 * An unlock is RENDERED when the store holds a real record and is never
 * otherwise.
 */
export type CeremonySurfaceProps = {
  view: CeremonyView
}

export function CeremonySurface({ view }: CeremonySurfaceProps) {
  return (
    <section className="terminal-ceremony" data-ceremony={view.complete ? "complete" : "incomplete"} aria-label="Ceremony">
      <p className="terminal-ceremony__readout" data-readout-executed={String(view.readoutExecuted)} data-observed-at={view.observedAt ?? "none"}>
        {/* The honest label. `ok` means the readout ran, never that a gate passed. */}
        {view.readoutExecuted
          ? `Readout executed at ${view.observedAt ?? "an unreported time"}. This states that the ceremony readout ran; it is not a claim that any gate passed.`
          : "The ceremony readout did not execute."}
      </p>

      {view.reason ? (
        <p className="terminal-ceremony__absent" data-ceremony-readout="absent">
          {view.reason}
        </p>
      ) : null}

      {view.scaleEnvError ? (
        <p className="terminal-ceremony__scale-error" data-scale-env-error={view.scaleEnvError}>
          {view.scaleEnvError}
        </p>
      ) : null}

      <ul className="terminal-ceremony__classes" data-class-rows={view.classes.length}>
        {view.classes.map((row) => (
          <CeremonyClass key={row.venueClass} row={row} />
        ))}
      </ul>

      {view.classes.length === 0 ? (
        <p className="terminal-ceremony__no-classes" data-class-rows="0">
          No venue class was reported. The store's known venue classes are reported by the readout; none arrived, so nothing
          is claimed about any of them.
        </p>
      ) : null}

      <p className="terminal-ceremony__no-affordance" data-unlock-affordance="none">
        {CEREMONY_NO_UNLOCK_AFFORDANCE_REASON}
      </p>
    </section>
  )
}

function CeremonyClass({ row }: { row: CeremonyClassRow }) {
  return (
    <li className="terminal-ceremony__class" data-venue-class={row.venueClass} data-unlocked={String(row.unlocked)}>
      <p className="terminal-ceremony__class-label">
        {row.venueClass} —{" "}
        {/* R1.4: this word is derived from a real `enablement` record and from
            nothing else. */}
        <span className="terminal-ceremony__unlock" data-unlock={row.unlocked ? "unlocked" : "not-unlocked"}>
          {row.unlocked ? "UNLOCKED" : "not unlocked"}
        </span>
      </p>

      {row.enablement ? (
        <p className="terminal-ceremony__enablement" data-enablement-at={row.enablement.at ?? "none"} data-enablement-by={row.enablement.by ?? "none"}>
          Enablement record: unlocked {row.enablement.at ?? "at an unreported time"} by {row.enablement.by ?? "an unattributed actor"}.
        </p>
      ) : (
        <p className="terminal-ceremony__enablement" data-enablement="none">
          No enablement record. This is an ABSENCE, not a pending approval: on the real rail nothing can create one.
        </p>
      )}

      <p className="terminal-ceremony__spendable" data-spendable-resolved={row.spendableResolved ?? "unavailable"}>
        Spendable resolved: {row.spendableResolved ?? "unavailable"}
        {row.scaleResolved !== null ? ` · scale resolved: ${row.scaleResolved}` : ""}
      </p>

      <ul className="terminal-ceremony__gates" data-gate-count={row.gatesTotal} data-gate-passed={row.gatesPassed}>
        {row.gates.map((gate) => (
          <li key={gate.id} data-gate={gate.id} data-pass={String(gate.pass)}>
            <p className="terminal-ceremony__gate-label">
              {gate.id} — <span className="terminal-ceremony__gate-state">{gate.pass ? "pass" : "not satisfied"}</span>
            </p>
            {gate.reason ? <p className="terminal-ceremony__gate-reason">{gate.reason}</p> : null}
          </li>
        ))}
      </ul>
      {row.gatesTotal === 0 ? (
        <UnavailableState availability={row.availability} label={`Ceremony gates for ${row.venueClass}`} />
      ) : null}

      {row.platformVerification ? (
        <p
          className="terminal-ceremony__platform"
          data-platform-verified="true"
          data-payout-floor={row.platformVerification.payoutFloorPct ?? "unrecorded"}
          data-withdrawal-tested={String(row.platformVerification.withdrawalTested)}
        >
          Platform verification recorded: verified {row.platformVerification.at ?? "at an unreported time"} by{" "}
          {row.platformVerification.by ?? "an unattributed actor"}; payout floor{" "}
          {row.platformVerification.payoutFloorPct ?? "unrecorded"}
          {row.platformVerification.regulator ? `; regulator recorded as ${row.platformVerification.regulator}` : ""}; withdrawal
          tested: {String(row.platformVerification.withdrawalTested)}.
        </p>
      ) : (
        <p className="terminal-ceremony__platform" data-platform-verified="false">
          No platform-verification record. This is an absence; it is not a statement that the venue is unsafe, and it is not
          a verification either.
        </p>
      )}

      <p className="terminal-ceremony__meta">
        Ledger resolver running: {String(row.ledgerRunning)} · last credit: {row.lastCreditAt ?? "never"} · binary options:{" "}
        {String(row.binaryOptions)}
      </p>
    </li>
  )
}
