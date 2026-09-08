import { useParams } from "react-router-dom"
import { DashboardRoom } from "./DashboardRoom"
import { MarketsRoom } from "./MarketsRoom"
import { PaperRoom } from "./PaperRoom"
import { AutopilotRoom } from "./AutopilotRoom"
import { CommandCentreRoom } from "./CommandCentreRoom"
import { SimulatorRoom } from "./SimulatorRoom"
import { SettingsRoom } from "./SettingsRoom"
import { EarningsDashboardRoom, EarningsSimulatorRoom, EarningsSettingsRoom } from "./EarningsRooms"
import { IntelligenceDashboardRoom, IntelligenceGovernorRoom, IntelligenceGuidanceRoom, IntelligenceSettingsRoom } from "./IntelligenceRooms"

const TRADING_ROOMS: Record<string, React.FC> = {
  dashboard: DashboardRoom,
  markets: MarketsRoom,
  paper: PaperRoom,
  autopilot: AutopilotRoom,
  "command-centre": CommandCentreRoom,
  simulator: SimulatorRoom,
  settings: SettingsRoom,
}

const EARNINGS_ROOMS: Record<string, React.FC> = {
  dashboard: EarningsDashboardRoom,
  simulator: EarningsSimulatorRoom,
  settings: EarningsSettingsRoom,
}

const INTELLIGENCE_ROOMS: Record<string, React.FC> = {
  dashboard: IntelligenceDashboardRoom,
  governor: IntelligenceGovernorRoom,
  guidance: IntelligenceGuidanceRoom,
  settings: IntelligenceSettingsRoom,
}

const MINISTRY_ROOMS: Record<string, Record<string, React.FC>> = {
  trading: TRADING_ROOMS,
  earnings: EARNINGS_ROOMS,
  intelligence: INTELLIGENCE_ROOMS,
}

export function MinistryRoom() {
  const { suiteId, "*": roomPath } = useParams<{ suiteId: string; "*": string }>()
  const rooms = MINISTRY_ROOMS[suiteId ?? ""]
  const Room = rooms?.[roomPath ?? ""]
  if (!Room) return null
  return <Room />
}
