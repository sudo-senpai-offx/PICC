/**
 * WS-6 terminal — public entry point.
 *
 * The strangler seam: legacy rooms remain the fallback, and a room is only
 * promoted once it reaches parity. Importing from this module rather than deep
 * paths keeps the migration boundary explicit, and keeps the surface a future
 * cleanup can audit in one place.
 *
 * Everything exported here is presentational or pure. No export opens a
 * transport, reads a credential, or bypasses the server's consent/risk rails.
 */

export { TerminalShell } from "./components/TerminalShell"
export { RoomFrame } from "./components/RoomFrame"
export { UnavailableState } from "./components/UnavailableState"
export { StatusBoundary } from "./components/StatusBoundary"
export { CopilotPanel } from "./components/CopilotPanel"
// WS-7 T7. `CopilotScoreSurface` renders the DETERMINISTIC decision path and
// `CopilotPanel` above renders REMOTE prose; they are exported side by side
// rather than merged so AC-014's separation stays visible at the entry point.
export { CopilotScoreSurface } from "./components/CopilotScoreSurface"
export { RiskLayerSurface } from "./components/RiskLayerSurface"
export { DenseTable } from "./components/DenseTable"
export { MotionValue } from "./components/MotionValue"
export { planChartUpdate } from "./components/IncrementalChart"
export { buildCommands, filterCommands } from "./components/CommandPalette"

// WS-7 T7 room instances 1 and 2 of D1's order, plus their D27 verdicts.
export { MarketsRoom, MARKETS_COMPLETION, MARKETS_NO_READING_REASON, buildMarketsDecision } from "./routes/MarketsRoom"
export { RiskRoom, RISK_COMPLETION, buildRiskLayer } from "./routes/RiskRoom"

export { useTerminalSnapshot } from "./hooks/useTerminalSnapshot"
export { useMotionPreference } from "./hooks/useMotionPreference"

export { parseDeepLink, resolveAssetSelection, shouldLandVenue } from "./adapters/deepLink"
export { normalizeRealtime } from "./adapters/realtime"
export { assessVenue, assessRegister } from "./adapters/venueIntegrity"
export { redactSecrets, containsSecretMaterial } from "./adapters/redaction"

export { routeSession, SESSION_BOUNDS_UTC } from "./domain/sessionRouting"
export { computeExpectancy, computeProcedureDrillScore, combineMetrics } from "./domain/metrics"
export { makeSampleKey, sampleKeyId, sameSampleKey, canAggregate, groupBySampleKey } from "./domain/sampleKeys"
export { copilotState, describeCopilot, isAdmissibleAsSignal } from "./domain/copilot"
// WS-7 T7. The deterministic decision path, kept separate from the remote
// explanation above: nothing here accepts a CopilotExplanation.
export {
  EXPERT_WEIGHTS,
  EXPERT_WEIGHT_SUM,
  VETO_RULE_IDS,
  COPILOT_ENGINE_OWNER,
  copilotUnavailable,
  describeConfluence,
  tierFor
} from "./domain/copilotDecision"
export { RISK_LAYER_SPEC, RISK_LAYER_OWNER, riskLayerView, atrStopReading, drawdownDisableReading, threeStrikeReading } from "./domain/riskLayer"
export * from "./domain/availability"

export type * from "./contracts"

// The stylesheet is imported here so it is actually bundled. An unimported CSS
// file is dead code and would leave every `terminal-*` class unstyled.
import "./styles/terminal.css"
