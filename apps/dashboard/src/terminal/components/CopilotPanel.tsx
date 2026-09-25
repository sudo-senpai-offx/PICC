import { describeCopilot } from "../domain/copilot"
import type { CopilotExplanation } from "../contracts"
import { redactSecrets } from "../adapters/redaction"

/**
 * WS-6 T3 — remote copilot surface (AC-014).
 *
 * Displays an EXPLANATION, never an input. Specifically:
 *  - Always discloses `copilot: remote` (D6: the LLM cannot run on the
 *    owner-locked Atom/Snapdragon floor).
 *  - Shows model and cache age only when actually observed, otherwise `null`.
 *  - Renders an explicit pending / stale / unavailable state with its reason.
 *  - Renders NO score, confidence, size, notional, or execution control, and no
 *    button or link, because AC-014 forbids a remote response from becoming a
 *    signal, risk input, sizing value, or execution authorization.
 *
 * Presentational only: opens no transport and requests no credential.
 */
export type CopilotPanelProps = {
  /** `null` means no explanation has been obtained yet — still rendered honestly. */
  copilot: CopilotExplanation | null
  /** Injectable clock so cache-age rendering is deterministic under test. */
  now?: number
}

export function CopilotPanel({ copilot, now }: CopilotPanelProps) {
  if (copilot == null) {
    return (
      <section className="terminal-copilot" data-copilot="absent" aria-label="Copilot">
        <p className="terminal-copilot__provenance">copilot: remote</p>
        <p className="terminal-copilot__state">pending — awaiting a remote explanation</p>
      </section>
    )
  }

  const view = describeCopilot(redactSecrets(copilot), now)
  const cacheAge =
    view.cacheAgeMs == null
      ? null
      : view.cacheAgeMs < 1000
        ? `${view.cacheAgeMs}ms`
        : `${Math.round(view.cacheAgeMs / 1000)}s`

  return (
    <section className="terminal-copilot" data-copilot={view.effectiveStatus} aria-label="Copilot">
      <p className="terminal-copilot__provenance">{view.provenance}</p>
      <p className="terminal-copilot__state">{view.label}</p>
      <p className="terminal-copilot__model">
        Model: {view.model ?? "not observed"}
      </p>
      <p className="terminal-copilot__cache">
        Cache age: {cacheAge ?? "not observed"}
      </p>
      {view.reason ? <p className="terminal-copilot__reason">{view.reason}</p> : null}
    </section>
  )
}
