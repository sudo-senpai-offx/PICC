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
  /** Why the explanation is pending/stale/unavailable. AC-014 requires this be shown. */
  reason: string | null
  redacted: true
}

/** Execution is paper-only until WS-9/WS-11 ceremony gates are cleared. */
export type ExecutionMode = "paper" | "reserved"

/** A capability the terminal may render, whether live, reserved, or blocked. */
export type TerminalCapability<T> = {
  availability: Availability
  data: T | null
}

// ---------------------------------------------------------------------------
// WS-7 T7 — the DETERMINISTIC decision path (COP-22).
//
// These are the spec §4.3 shapes verbatim, and they are deliberately NOT the
// same object as `CopilotExplanation` above. The distinction is the whole
// point of AC-014 and must not be blurred by a shared name:
//
//   CopilotExplanation  - REMOTE prose from the LLM. May explain. May never be
//                         a signal, a score, a risk input, a sizing value, or
//                         an execution authorization (`isAdmissibleAsSignal`).
//   ConfluenceScore     - DETERMINISTIC output of a pure function of market
//                         state, produced by the WS-7 T11 engine. It IS the
//                         decision path. No model call occurs on it.
//
// A renderer that merged the two would let remote text acquire a score, which
// AC-014 names as a prohibited side effect. The engine that produces
// `ConfluenceScore` is WS-7 T11 and is not built yet; until it is, these types
// are the contract the Markets room renders and the room reports the engine's
// absence honestly rather than synthesizing a score.
// ---------------------------------------------------------------------------

/** The six weighted experts. T11 asserts the weight sum is exactly 100. */
export type ExpertId =
  | "macroBias"
  | "structural"
  | "trendStrength"
  | "momentumExhaustion"
  | "volatilityBoosters"
  | "sentiment"

/**
 * Per-expert contribution. `contributions` is ALWAYS all six, even when an
 * expert is unavailable — an honest score reports the missing 5% rather than
 * silently renormalizing the other 95% (spec §4.1: "never a fabricated
 * sentiment and never a silent renormalization that hides the gap").
 */
export type ExpertContribution = {
  expert: ExpertId
  weightPct: 20 | 20 | 20 | 15 | 20 | 5
  /** Points this expert added, within its own band. Null when unavailable. */
  rawDelta: number | null
  available: boolean
  /** Required when `available === false`; null otherwise. */
  unavailableReason: string | null
}

/** The six vetoes, each overriding any score (AC-022, D7). */
export type VetoRuleId =
  | "topDownHierarchy"
  | "correlationTrap"
  | "wickVsClose"
  | "spreadVsTarget"
  | "newsLockout"
  | "sessionOpen"

export type VetoOutcome = {
  ruleId: VetoRuleId
  fired: boolean
  inputs: Record<string, number | string | boolean>
  /** What this veto blocked. Never folded into a lower score. */
  suppressed: string
  evaluatedAt: number
  ruleVersion: string
}

export type Regimes = "tokyoRange" | "londonTrend" | "nyVolatility" | "hypertrend" | "deadZone"

/**
 * `score` is `null` when the state is unscoreable — never `0`, which is a
 * legitimate score and means "the confluence engine evaluated this and found
 * nothing". `deadZone` is a regime, not a score.
 */
export type ConfluenceScore = {
  score: number | null
  contributions: ExpertContribution[]
  confidence: "high" | "medium" | "low" | "unavailable"
  regime: Regimes
  activeBoosters: string[]
  conflictOverrides: Array<"C1" | "C2" | "C3">
  computedAt: number
  engineVersion: string
}

/** AC-023: 85+ -> A+, 70-84 -> B, <70 -> ignore. No interpolation, no fourth band. */
export type ExecutionTier = {
  tier: "A+" | "B" | "ignore"
  riskPct: 0.01 | 0.005 | 0
  action: "autoExecute" | "notifyForApproval" | "hold"
  /** D5: `false` forces `autoExecute` down to `notifyForApproval`. Defaults false. */
  automationPermitted: boolean
  /** D6: a read-only input to the copilot, never set by it. */
  rung: "paper" | "demo" | "live"
  /** Non-empty forces `action` to `hold` regardless of tier. */
  vetoes: VetoOutcome[]
}

// ---------------------------------------------------------------------------
// WS-7 T7 — the Risk room's render contract (spec §4.4 risk layer).
//
// ATR(14) with a 1.5x stop exists today (`indicators.mjs:614`,
// `v32Context.mjs:185-213`). The 2% daily drawdown disable and the 3-strike
// 24h key lock DO NOT exist anywhere in the tree and are owned by the same
// WS-7 T11 risk layer. Each capability therefore carries its OWN availability
// rather than one shared flag, because "ATR is real" must never render as
// "the whole risk layer is real" — a 2% disable shown next to a live ATR and
// no availability marker is the fabrication the constitution forbids.
// ---------------------------------------------------------------------------

export type RiskCapabilityKey = "atrStop" | "drawdownDisable" | "threeStrike"

/** One risk-layer reading. `value` is null when the capability is unavailable. */
export type RiskLayerReading = {
  key: RiskCapabilityKey
  availability: Availability
  /** Human label for the room's row. */
  label: string
  /** What PICC's own spec fixes for this capability, stated so the room never invents a threshold. */
  specValue: string
  value: string | null
  /** Why the reading is what it is, or why there is none. Always present. */
  detail: string
}
