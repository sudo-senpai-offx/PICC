import { getToken } from "./auth"

export type CostProvenance = "measured" | "modeled" | "modeled-with-calibrated-inputs"

export interface CostKindLine {
  kind: string
  totalUsd: number
  provenance: CostProvenance
}

export interface CostWindow {
  totalUsd: number | null
  provenance: CostProvenance | null
  reason: string | null
  byKind: CostKindLine[]
}

export interface CostVenueRow {
  venue: string
  day: CostWindow
  allTime: CostWindow
  waste: { refused: number; failed: number } | null
}

export interface CostDragPoint {
  t: string | null
  equity: number | null
  dragEquity: number
  cumulativeCostUsd: number
}

export interface CostDragLine {
  closeId: string | null
  feeUsd: number
  spreadUsd: number
  slipUsd: number
  provenance: CostProvenance
}

export interface CostsOverview {
  ok: boolean
  venues: CostVenueRow[]
  totalUsd: number | null
  provenance: CostProvenance | null
  incomplete: boolean
  reason: string | null
  skipped: Array<{ index?: number | null; venue?: string; kind?: string; reason: string }>
  window: { tzDate: string | null; tz: string }
  paper: {
    label: string
    starting: number | null
    lines: CostDragLine[]
    series: CostDragPoint[]
    skipped: Array<{ closeId: string | null; kind?: string; reason: string }>
    reason: string | null
  }
}

// Same header construction as lib/wealth.ts: auth token when logged in.
function headers(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchCostsOverview(): Promise<CostsOverview> {
  const res = await fetch("/api/costs/overview", { headers: headers() })
  if (!res.ok) throw new Error(`costs overview GET failed: ${res.status}`)
  return (await res.json()) as CostsOverview
}
