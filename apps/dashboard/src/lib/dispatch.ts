import { getToken } from "./auth"

export type DispatchKind = "decision" | "milestone" | "venue" | "system"
export type DispatchSeverity = "info" | "warning" | "critical"

export interface DispatchEntry {
  id: string
  kind: DispatchKind
  severity: DispatchSeverity
  title: string
  body: string
  ref: string | null
  ts: number
  read: boolean
}

export interface DispatchInbox {
  ok: boolean
  unread: number
  entries: DispatchEntry[]
}

export const KIND_LABEL: Record<DispatchKind, string> = {
  decision: "Decision",
  milestone: "Milestone",
  venue: "Venue",
  system: "System"
}

export const SEVERITY_LABEL: Record<DispatchSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical"
}

// Same header construction as lib/liveTrading.ts:377 (auth token when logged in)
function headers(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchDispatch(limit = 50, unreadOnly = false): Promise<DispatchInbox> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (unreadOnly) q.set("unreadOnly", "true")
  const res = await fetch(`/api/trading/dispatch?${q}`, { headers: headers() })
  if (!res.ok) throw new Error(`dispatch GET failed: ${res.status}`)
  return (await res.json()) as DispatchInbox
}

export async function markDispatchRead(id: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/trading/dispatch/read", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers() },
    body: JSON.stringify({ id })
  })
  if (!res.ok) throw new Error(`dispatch read failed: ${res.status}`)
  return (await res.json()) as { ok: boolean }
}