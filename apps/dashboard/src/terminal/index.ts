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
export { StatusBoundary } from "./components/StatusBoundary"
export { CopilotPanel } from "./components/CopilotPanel"
export { DenseTable } from "./components/DenseTable"
export { MotionValue } from "./components/MotionValue"
export { planChartUpdate } from "./components/IncrementalChart"
export { buildCommands, filterCommands } from "./components/CommandPalette"

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
export * from "./domain/availability"

export type * from "./contracts"
