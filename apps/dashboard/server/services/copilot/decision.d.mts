/**
 * Typed surface for `decision.mjs`, for the CLIENT tests that drive it.
 *
 * This declaration exists for the same reason as `engine.d.mts` and
 * `riskLayer.d.mts`: `decision.mjs` is plain `.mjs`, so a client-side importer
 * would otherwise get TS7016 and an `any` at the call site — which would let a
 * shape mismatch become a fabricated reading at runtime instead of a compile
 * error.
 *
 * The shapes are deliberately the DECISION service's own return contract, and
 * `confluence` / `firedVetoes` are typed as the loose server shapes rather than
 * the client's strict `ConfluenceScore`. That asymmetry is the point: the server
 * is authoritative and this boundary is where its output is NARROWED to the
 * client contract (`adapters/copilotReading.ts` does the narrowing, explicitly,
 * with visible fall-backs). Typing it as `ConfluenceScore` here would assert a
 * narrowing that has not happened yet.
 */

export type DecisionUnavailable = { leg: string; reason: string }

export type DecisionAtr = {
  atr: number
  period: number
  stopDistance: number
  multiple: number
  observedAt: number | null
}

export type DecisionConflictResolution = {
  rule: string
  ruleId: string
  status: string
  applied: boolean
  reason: string
  adjustments: unknown[]
  [key: string]: unknown
}

export type DecisionResponse = {
  ok: boolean
  decisionVersion: string
  engineVersion: string | null
  assetId: string
  computedAt: number | null
  /** Loose on purpose — see the header. Narrowed by `projectDecision`. */
  confluence: {
    score: number | null
    contributions: Array<{
      expert: string
      weightPct: number
      rawDelta: number | null
      available: boolean
      unavailableReason: string | null
    }>
    confidence: string
    regime: string
    activeBoosters: string[]
    conflictOverrides: string[]
    computedAt: number
    engineVersion: string
  } | null
  vetoes: Array<{ ruleId: string; fired: boolean; suppressed: string; [key: string]: unknown }>
  firedVetoes: Array<{ ruleId: string; suppressed: string; [key: string]: unknown }>
  tier: {
    tier: string
    riskPct: number
    action: string
    automationPermitted: boolean
    rung: string
    vetoes: unknown[]
  } | null
  conflicts: {
    conflictOverrides: string[]
    adjustments: unknown[]
    resolutions: DecisionConflictResolution[]
    precedence: string[]
    precedenceVersion: string | null
    notEvaluated?: boolean
  } | null
  risk: {
    atr: DecisionAtr | null
    atrUnavailableReason: string | null
    drawdown: null
    drawdownUnavailableReason: string
    threeStrike: null
    threeStrikeUnavailableReason: string
  }
  coverage: {
    workingBars: number
    h4Bars: number
    dailyCloses: number
    source: Record<string, string>
    stale: boolean
  }
  unavailable: DecisionUnavailable[]
}

export type DecisionFetchCandles = (
  assetId: string,
  opts: { timeframe: number; count: number; source: string }
) => Promise<{ candles: Array<Record<string, number>>; source?: string | null; stale?: boolean }>

export const LEG_HISTORY: { readonly working: number; readonly h4: number; readonly daily: number }
export const WORKING_TIMEFRAME: number
export const H4_TIMEFRAME: number
export const DAILY_TIMEFRAME: number
export const COPILOT_DECISION_VERSION: string

export function copilotDecisionForAsset(params: {
  assetId: string
  source?: string
  fetchCandles?: DecisionFetchCandles
}): Promise<DecisionResponse>
