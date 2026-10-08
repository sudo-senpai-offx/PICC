import { getToken } from "./auth"

export type WealthLegStatus = "LIVE" | "STALE" | "ABSENT" | "ENTERED"

export interface WealthLeg {
  id: string
  kind: string
  ccy: string | null
  amount: number | null
  observedAt: string | null
  status: WealthLegStatus
  reason: string | null
  fxSource: string | null
  fxAt: string | null
  usd: number | null
  asOf?: string | null
  ageDays?: number | null
  unconfirmed?: number | null
}

export interface WealthPaper {
  equity: number | null
  cash: number | null
  committed: number | null
  open: number | null
  closed: number | null
}

export interface WealthTransfer {
  id: string
  fromLeg: string
  toLeg: string
  ccy: string
  amount: number
  at: string
  note: string
}

export interface WealthSnapshot {
  at: string
  totalUsd: number | null
  incomplete: boolean
  legStatus: Array<{ id: string; status: string }>
  tzDate: string
}

export interface WealthSuggestion {
  fromLeg: string
  toLeg: string
  ccy: string
  amount: number
  at: string
  confidence: "candidate"
  status: "unconfirmed"
}

export interface WealthOverview {
  ok: boolean
  totalUsd: number | null
  incomplete: boolean
  reason?: string | null
  legs: WealthLeg[]
  paper: WealthPaper
  transfers: WealthTransfer[]
  snapshots: WealthSnapshot[]
  suggestions: WealthSuggestion[]
}

export interface WealthTransferInput {
  fromLeg: string
  toLeg: string
  ccy: string
  amount: number | string
  at: string
  note?: string
}

// Same header construction as lib/dispatch.ts: auth token when logged in.
// The read itself is permission-free: no permit, no prop, just the session.
function headers(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchWealthOverview(): Promise<WealthOverview> {
  const res = await fetch("/api/wealth/overview", { headers: headers() })
  if (!res.ok) throw new Error(`wealth overview GET failed: ${res.status}`)
  return (await res.json()) as WealthOverview
}

export async function postWealthTransfer(
  input: WealthTransferInput
): Promise<{ ok: boolean; transfer?: WealthTransfer; reason?: string }> {
  const res = await fetch("/api/wealth/transfers", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers() },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw new Error(`wealth transfer POST failed: ${res.status}`)
  return (await res.json()) as { ok: boolean; transfer?: WealthTransfer; reason?: string }
}
