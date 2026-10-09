// Provider-consistency signal — dual-provider sampling on TRADING SIGNALS ONLY.
// OFF by default behind PICC_PROVIDER_CONSISTENCY=on.
//
// COST WARNING (2x spend/latency): when enabled, every trading-signal call
// issues TWO provider calls with the same input (primary via the normal
// failover order + one second-provider sample). Expect ~2x token spend and
// ~2x latency on signal calls only. All other callers (listing, content,
// briefs, digests) are NEVER dual-sampled.
//
// ADVISORY CEILING: this module never authorises a trade. Agreement proceeds
// with the PRIMARY output as advisory text; divergence emits a HOLD advisory
// with BOTH outputs attached for audit. NEVER auto-GO on either output.
// Default provider order/selection is NEVER changed — the primary is whatever
// runAll() in llm.mjs selects first, and the second sample is the next
// configured provider distinct from the primary.
//
// AGREEMENT RULE (stated, documented): structured-field agreement.
//   - strings: trimmed exact equality (whitespace-trimmed, case-sensitive).
//   - objects/arrays: canonical JSON equality with recursively sorted keys.
//   - mixed types or anything else: DIVERGENT (safe side → HOLD).
// Rationale: trading signals are short directives where even a wording change
// can flip meaning; fuzzy matching would hide real disagreement.

export const CONSISTENCY_ENV = "PICC_PROVIDER_CONSISTENCY"

/** OFF by default — only the exact string "on" enables dual sampling. */
export function isConsistencyEnabled(env = process.env) {
  return env?.[CONSISTENCY_ENV] === "on"
}

/** Canonical form for the agreement rule. Returns a comparable string. */
export function canonicalize(value) {
  if (typeof value === "string") return `str:${value.trim()}`
  if (value !== null && typeof value === "object") return `json:${stableStringify(value)}`
  return `other:${String(value)}`
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** True when two signal outputs agree under the stated rule. */
export function signalOutputsAgree(a, b) {
  return canonicalize(a) === canonicalize(b)
}

/**
 * HOLD-on-divergence advisory. Both outputs attached for audit.
 * Advisory only — carries no execution directive, never auto-GO.
 */
export function holdAdvisory({ primary, secondary, primaryProvider, secondaryProvider }) {
  return {
    ok: true,
    advisory: "HOLD",
    verdict: "HOLD",
    reason: "provider-divergence",
    primary: { provider: primaryProvider, output: primary },
    secondary: { provider: secondaryProvider, output: secondary },
    note: "Advisory only — providers diverged, so HOLD. Both outputs attached for audit. Never auto-GO."
  }
}
