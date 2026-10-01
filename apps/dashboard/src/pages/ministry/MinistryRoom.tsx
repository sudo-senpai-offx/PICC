import { lazy, useEffect } from "react"
import type { ComponentType, LazyExoticComponent } from "react"
import { useParams } from "react-router-dom"
import { rememberRoom } from "@/lib/ministryNav"
import { RoomFrame } from "@/terminal/components/RoomFrame"
import { reserved } from "@/terminal/domain/availability"

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
  // WS-7 T7R-A — the four keys authorised by the 2026-09-30 amendment to WS-6
  // §0.3 (18/11 -> 22/15). `risk` has a real room. `ceremony`, `ministry` and
  // `strategy` are routed to their reserved bodies, which name the task that
  // owns each surface and show nothing; see reservedRooms.tsx for why they are
  // named absences rather than built rooms.
  //
  // WS-7 T7R-B — `risk` now points at the PAGE composition, not the terminal room
  // directly. `MinistryRoom` renders `<Room />` with no props, and the terminal
  // Risk room is presentational by design, so routing at it directly mounted a
  // room that rendered three unavailable rows forever. `pages/ministry/RiskRoom`
  // is the caller that fetches the decision and supplies the observations;
  // `terminal/routes/RiskRoom` stays prop-only and testable.
  risk: lazy(() => import("./RiskRoom").then((m) => ({ default: m.RiskRoom }))),
  ceremony: lazy(() => import("./reservedRooms").then((m) => ({ default: m.CeremonyRoom }))),
  ministry: lazy(() => import("./reservedRooms").then((m) => ({ default: m.MinistryAuthorityRoom }))),
  strategy: lazy(() => import("./reservedRooms").then((m) => ({ default: m.StrategyRoom }))),
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

/**
 * Exported so WS-6 can pin parity against `INNER_NAV`. These per-suite maps are
 * a hand-maintained duplicate of the nav's room keys; before WS-6 nothing
 * asserted the two agreed, so a valid nav link could silently render nothing.
 * The parity guard lives in
 * `src/terminal/components/__tests__/TerminalShell.test.tsx`.
 */
export { MINISTRY_ROOMS }

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

  // WS-6 T2: an unmapped room used to render `null` — a blank body with no
  // explanation. Spec 4.7 requires an explicit reserved state instead, naming
  // what was requested and who owns it. No number, chart point, or score is
  // shown, because nothing is known about the room yet.
  if (!Room) {
    return (
      <RoomFrame
        roomKey={roomPath ?? ""}
        title={`${roomPath ?? "Unknown room"}`}
        capabilityLabel="Room"
        reserved={reserved({
          workstream: "WS-6",
          reason: `No room is mapped for "${roomPath ?? ""}" in the ${suiteId ?? "unknown"} suite.`
        })}
      />
    )
  }
  return <Room />
}