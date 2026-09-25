/**
 * WS-6 T1 — terminal contracts.
 *
 * Single source of truth for the shapes the terminal UI is allowed to render.
 * The governing rule (spec §4.3): "The shapes are contracts, not permission to
 * invent values. A field that cannot be observed is `null`/`unavailable`, never
 * `0`, a candle approximation, or a silent default."
 *
 * Pure types plus the minimum structural helpers needed by adapters. No React,
 * no sockets, no server imports — the bisect matrix requires this slice to be
 * inspectable in isolation.
 */

import type { Availability } from "./domain/availability"
import type { SampleKey } from "./domain/sampleKeys"

export type { Availability }
export type { SampleKey }

/** A resolved, cost-aware observation belonging to exactly one sample bucket. */
export type ResolvedSample = {
  key: SampleKey
  resolvedAt: number
  netPnl: number
  costBasis: { fees: number; slippage: number; currency: string }
  procedureEvidenceId: string
}

/**
 * Cost-adjusted expectancy. The ONLY quantity permitted to size a position.
 * `requiredCount` is owner-locked at 500 resolved samples per bucket (D9);
 * below that the value is `null` and the status is `insufficient` — never a
 * number computed from a smaller sample.
 */
export type Expectancy = {
  status: "live" | "insufficient" | "unavailable"
  key: SampleKey
  resolvedCount: number
  requiredCount: 500
  value: number | null
  costBasis: string
  confidence: string
}

/**
 * Procedure drill score. Bounded and explicitly NON-statistical (D13). It may
 * only marginally nudge copilot confidence; it may never gate a trade or size a
 * position. `sizingEligible` is typed as the literal `false` so that any future
 * attempt to make it true is a compile error rather than a runtime surprise.
 *
 * D13 requires this metric to stay metrically DISJOINT from `Expectancy`: never
 * summed, averaged, or displayed as one combined number.
 */
export type ProcedureDrillScore = {
  status: "live" | "unavailable"
  runId: string
  rubricVersion: string
  value: number | null
  sizingEligible: false
}

/** Deterministic session routing (D10). `no_trade` is the Dead Zone outcome. */
export type SessionRouteName =
  | "trend_following"
  | "mean_reversion"
  | "intermediary"
  | "no_trade"
  | "reserved"

export type SessionRoute = {
  route: SessionRouteName
  matchedRule: string
  evaluatedAt: number
  timezone: "UTC"
}

/**
 * Per-venue integrity register (D11). A venue may not be counterparty, price
 * feed authority, and settlement authority simultaneously; a conflict is
 * surfaced as `integrityStatus: "conflict"` with a named blocker rather than
 * being resolved silently.
 */
export type VenueIntegrity = {
  venueId: string
  feedAuthority: string
  counterpartyAuthority: string
  settlementAuthority: string
  credentialStatus: Availability
  integrityStatus: "verified" | "conflict" | "unverified" | "blocked"
  blocker: string | null
}

/**
 * Remote copilot provenance (D6). `provenance` is the literal
 * `"copilot: remote"` because the LLM cannot run on the owner-locked
 * Atom/Snapdragon hardware floor; every remote output must be labelled as such
 * and must never fill a deterministic `unavailable` field.
 */
export type CopilotProvenance = "copilot: remote"

export type CopilotExplanation = {
  status: "ready" | "pending" | "stale" | "unavailable"
  provenance: CopilotProvenance
  model: string | null
  generatedAt: number | null
  cacheExpiresAt: number | null
  redacted: true
}

/** Execution is paper-only until WS-9/WS-11 ceremony gates are cleared. */
export type ExecutionMode = "paper" | "reserved"

/** A capability the terminal may render, whether live, reserved, or blocked. */
export type TerminalCapability<T> = {
  availability: Availability
  data: T | null
}
