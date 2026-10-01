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

// WS-7 T10 room instances 7-22 of D1's order: the remaining read-only rooms.
// ONE surface and ONE projection for NINE keys across SIXTEEN instances, so the
// exports are correspondingly small. The sixteen D27 verdicts are a single frozen
// ARRAY rather than sixteen named constants, because T21's guard has to
// enumerate every room's completion record (`:1386`) and a verdict reachable only
// by a hand-written name is a verdict nobody looks at.
export { ReadOnlyRoom } from "./routes/ReadOnlyRoom"
export { ReadOnlyRoomSurface } from "./components/ReadOnlyRoomSurface"
export { fetchReadOnlyView } from "./adapters/readOnlyReading"
export {
  READ_ONLY_AFFORDANCE_REASON,
  READ_ONLY_INTERACTIVE_AFFORDANCES,
  READ_ONLY_OWNER,
  READ_ONLY_ROOM_KEYS,
  READ_ONLY_VERDICTS,
  buildReadOnlyRoomView,
  readOnlySectionsFor
} from "./domain/readOnlyRooms"
export {
  READ_ONLY_RESIDUAL_ORDER_BASIS,
  READ_ONLY_RESIDUAL_ORDER_JUDGEMENT,
  READ_ONLY_ROOM_COMPLETIONS,
  readOnlyCompletion
} from "./domain/readOnlyRoomCompletions"
export type {
  ReadOnlyAbsence,
  ReadOnlyFact,
  ReadOnlyRoomKey,
  ReadOnlyRoomView,
  ReadOnlySection,
  ReadOnlySuiteId,
  ReadOnlyVerdict
} from "./domain/readOnlyRooms"
export type {
  ReadOnlyRoomCompletion,
  ReadOnlyWriteAffordance
} from "./domain/readOnlyRoomCompletions"

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
