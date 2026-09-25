import { sameSampleKey, type SampleKey } from "./sampleKeys"
import type { Expectancy, ProcedureDrillScore, ResolvedSample } from "../contracts"

/**
 * WS-6 T4 — separated metrics (AC-009, AC-011, D9, D13).
 *
 * Two metrics that must never be blended:
 *
 *  `expectancy` — cost-adjusted, statistical, and the ONLY quantity permitted
 *  to size a position. Requires 500+ RESOLVED samples for the exact
 *  (setup, market, timeframe, dataFidelity, regimeClass) bucket. Below the
 *  floor the value is `null` and the status is `insufficient`; it is never
 *  extrapolated, and samples from another key are never borrowed.
 *
 *  `procedureDrillScore` — bounded, explicitly NON-statistical, and never
 *  sizing-eligible. It may only marginally nudge copilot confidence. A rubric
 *  result is not an expected profit, so it has no per-trade or net-P&L shape.
 *
 * `combineMetrics` exists solely to THROW. AC-011 forbids averaging the two or
 * displaying them as one number; making that a runtime failure means a future
 * caller gets an immediate, obvious test failure instead of a blended "score"
 * that looks authoritative.
 */

/** Owner-locked: resolved samples required before expectancy is meaningful. */
export const REQUIRED_SAMPLE_COUNT = 500 as const

export function computeExpectancy(
  key: SampleKey,
  samples: readonly ResolvedSample[]
): Expectancy {
  // Count ONLY samples whose full five-part key matches. This is the D8/D9
  // isolation rule and the reason a large loss in a neighbouring bucket cannot
  // drag this bucket below its floor.
  const matching = samples.filter((s) => sameSampleKey(s.key, key))
  const resolvedCount = matching.length

  if (resolvedCount < REQUIRED_SAMPLE_COUNT) {
    return {
      status: "insufficient",
      key,
      resolvedCount,
      requiredCount: REQUIRED_SAMPLE_COUNT,
      value: null,
      costBasis: "net of recorded fees and slippage",
      confidence: `insufficient: ${resolvedCount}/${REQUIRED_SAMPLE_COUNT} resolved samples`
    }
  }

  const total = matching.reduce((sum, s) => sum + (Number(s.netPnl) || 0), 0)
  return {
    status: "live",
    key,
    resolvedCount,
    requiredCount: REQUIRED_SAMPLE_COUNT,
    value: total / resolvedCount,
    costBasis: "net of recorded fees and slippage",
    confidence: `${resolvedCount} resolved samples`
  }
}

export type ProcedureEvidence = {
  runId: string
  rubricVersion: string
  /** Rubric result in [0,1]; `null` means no evidence was recorded. */
  score: number | null
}

export function computeProcedureDrillScore(evidence: ProcedureEvidence): ProcedureDrillScore {
  const observed = typeof evidence.score === "number" && Number.isFinite(evidence.score)
  // An unrecorded rubric is `unavailable`, not a zero — a zero would read as
  // "the operator performed badly" rather than "we have no evidence".
  const value = observed ? Math.min(1, Math.max(0, evidence.score as number)) : null

  return {
    status: value == null ? "unavailable" : "live",
    runId: evidence.runId,
    rubricVersion: evidence.rubricVersion,
    value,
    // Literal false: any attempt to make drill score size a position is a
    // compile error against the contract, not a runtime surprise.
    sizingEligible: false
  }
}

/**
 * Always throws. The two metrics are metrically disjoint (D13) and AC-011
 * forbids averaging them or copying one into the other.
 */
export function combineMetrics(_expectancy: Expectancy, _procedure: ProcedureDrillScore): never {
  throw new Error(
    "expectancy and procedureDrillScore must not be combined, averaged, or displayed as one number (D13 / AC-011)"
  )
}
