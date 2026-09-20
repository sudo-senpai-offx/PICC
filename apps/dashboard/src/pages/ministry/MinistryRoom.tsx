import { lazy, useEffect } from "react"
import type { ComponentType, LazyExoticComponent } from "react"
import { useParams } from "react-router-dom"
import { rememberRoom } from "@/lib/ministryNav"

// T7 — per-suite code-split: every room is its own async chunk, fetched only
// when a room of that ministry renders. Trading / earnings / intelligence thus
// never enter the initial (hub shell + login) bundle; each suite's rooms and
// their shared sub-chunks load lazily on first navigation.
// T9 — the shared StudioRoom is imported once and reused by all three suites
// (REQ-E.3): one wrapper, no forked logic.
const StudioRoomComponent: LazyExoticComponent<ComponentType> = lazy(() =>
  import("./StudioRoom").then((m) => ({ default: m.StudioRoom }))
)

const TRADING_ROOMS: Record<string, LazyExoticComponent<ComponentType>> = {
  dashboard: lazy(() => import("./DashboardRoom").then((m) => ({ default: m.DashboardRoom }))),
  markets: lazy(() => import("./MarketsRoom").then((m) => ({ default: m.MarketsRoom }))),
  paper: lazy(() => import("./PaperRoom").then((m) => ({ default: m.PaperRoom }))),
  autopilot: lazy(() => import("./AutopilotRoom").then((m) => ({ default: m.AutopilotRoom }))),
  "command-centre": lazy(() => import("./CommandCentreRoom").then((m) => ({ default: m.CommandCentreRoom }))),
  dispatch: lazy(() => import("./DispatchRoom").then((m) => ({ default: m.DispatchRoom }))),
  simulator: lazy(() => import("./SimulatorRoom").then((m) => ({ default: m.SimulatorRoom }))),
  studio: StudioRoomComponent,
  settings: lazy(() => import("./SettingsRoom").then((m) => ({ default: m.SettingsRoom }))),
}

const EARNINGS_ROOMS: Record<string, LazyExoticComponent<ComponentType>> = {
  dashboard: lazy(() => import("./EarningsRooms").then((m) => ({ default: m.EarningsDashboardRoom }))),
  simulator: lazy(() => import("./EarningsRooms").then((m) => ({ default: m.EarningsSimulatorRoom }))),
  studio: StudioRoomComponent,
  settings: lazy(() => import("./EarningsRooms").then((m) => ({ default: m.EarningsSettingsRoom }))),
}

const INTELLIGENCE_ROOMS: Record<string, LazyExoticComponent<ComponentType>> = {
  dashboard: lazy(() => import("./IntelligenceRooms").then((m) => ({ default: m.IntelligenceDashboardRoom }))),
  governor: lazy(() => import("./IntelligenceRooms").then((m) => ({ default: m.IntelligenceGovernorRoom }))),
  guidance: lazy(() => import("./IntelligenceRooms").then((m) => ({ default: m.IntelligenceGuidanceRoom }))),
  studio: StudioRoomComponent,
  settings: lazy(() => import("./IntelligenceRooms").then((m) => ({ default: m.IntelligenceSettingsRoom }))),
}

const MINISTRY_ROOMS: Record<string, Record<string, LazyExoticComponent<ComponentType>>> = {
  trading: TRADING_ROOMS,
  earnings: EARNINGS_ROOMS,
  intelligence: INTELLIGENCE_ROOMS,
}

export function MinistryRoom() {
  const { suiteId, "*": roomPath } = useParams<{ suiteId: string; "*": string }>()
  const rooms = MINISTRY_ROOMS[suiteId ?? ""]
  const Room = rooms?.[roomPath ?? ""]
  // Record the resolved room so opening the suite again resumes where the
  // user left off (per-suite lastRoom preference). Only resolved rooms are
  // remembered — a bogus path never persists.
  const resolved = Room !== undefined
  useEffect(() => {
    if (resolved) rememberRoom(suiteId, roomPath)
  }, [suiteId, roomPath, resolved])

  if (!Room) return null
  return <Room />
}