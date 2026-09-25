import type { CopilotExplanation, CopilotProvenance } from "../contracts"

/**
 * WS-6 T3 — remote copilot state contract (AC-014, D6).
 *
 * The LLM cannot run on the owner-locked Atom/Snapdragon floor, so every
 * explanation is remote and must be labelled `copilot: remote`. Remote text is
 * an EXPLANATION, never an input: it must not become a signal, risk input,
 * score, sizing value, or execution authorization. `isAdmissibleAsSignal` exists
 * so that prohibition is executable rather than a comment.
 *
 * Nothing here performs I/O. The cache and provider live behind the adapters;
 * this module only derives what may be displayed.
 */

/** Remote explanations are cached briefly; a long TTL would read as authoritative. */
export const CACHE_TTL_MS = 60_000

export type CopilotStatus = CopilotExplanation["status"]

export type CopilotView = {
  provenance: CopilotProvenance
  /** Status after applying cache expiry — a `ready` entry past TTL reads stale. */
  effectiveStatus: CopilotStatus
  label: string
  model: string | null
  generatedAt: number | null
  cacheAgeMs: number | null
  reason: string | null
  redacted: true
}

export function copilotState(
  input: Omit<CopilotExplanation, "provenance" | "redacted" | "reason"> & { reason?: string | null },
  reason: string | null = null
): CopilotExplanation {
  // `provenance` and `redacted` are re-asserted here so a caller cannot
  // construct an unlabelled or unredacted copilot object by widening the type.
  return {
    ...input,
    provenance: "copilot: remote",
    redacted: true,
    reason: reason ?? input.reason ?? null
  }
}

export function describeCopilot(c: CopilotExplanation, now: number = Date.now()): CopilotView {
  const expired = c.cacheExpiresAt != null && c.cacheExpiresAt <= now
  const effectiveStatus: CopilotStatus = c.status === "ready" && expired ? "stale" : c.status

  const cacheAgeMs = c.generatedAt != null ? Math.max(0, now - c.generatedAt) : null

  // An operator/provider-supplied reason always wins; the derived fallbacks
  // only fill in when none was recorded, so "provider timeout" is not flattened
  // into a generic "unavailable".
  const derived: string | null =
    effectiveStatus === "pending"
      ? "awaiting a remote explanation"
      : effectiveStatus === "stale"
        ? "cached explanation has expired"
        : effectiveStatus === "unavailable"
          ? "remote explanation unavailable"
          : null

  return {
    provenance: "copilot: remote",
    effectiveStatus,
    // Provenance is embedded in the label as well as exposed as a field, so a
    // renderer that forgets the field still discloses that this is remote.
    label: `copilot: remote — ${effectiveStatus}`,
    model: c.model,
    generatedAt: c.generatedAt,
    cacheAgeMs,
    reason: c.reason ?? derived,
    redacted: true
  }
}

/**
 * Always false. AC-014's prohibited side effect, made executable: a remote
 * explanation can never be promoted into the deterministic decision path, so a
 * future caller that tries gains a failing test rather than a silent trade.
 */
export function isAdmissibleAsSignal(_c: CopilotExplanation): false {
  return false
}
