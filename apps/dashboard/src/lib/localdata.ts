// Client for the self-hosted JSON data store (replaces Supabase tables).
import { getToken } from "./auth"

export type LocalTable =
  | "agent_logs"
  | "human_confirmations"
  | "overlay_settings"
  | "content_drafts"
  | "simulations"
  | "listing_analyses"
  | "billing"
  | "financial_accounts"
  | "transactions"
  | "income_streams"
  | "nft_holdings"
  | "nft_royalty_earnings"
  | "depin_nodes"
  | "agent_configs"
  | "agent_earnings"
  | "agent_bounties"
  | "predictions"
  | "human_review_logs"

export interface DataRow {
  id?: string
  created_at?: string
  user_id?: string | null
  [key: string]: unknown
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`)
  return data as T
}

export function listData<T = DataRow>(table: LocalTable): Promise<{ ok: boolean; rows: T[] }> {
  return fetch(`/api/data/${table}`, { headers: authHeaders() }).then((r) => parse(r))
}

export function appendData<T = DataRow>(table: LocalTable, row: unknown): Promise<{ ok: boolean; row: T }> {
  return fetch(`/api/data/${table}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ row })
  }).then((r) => parse(r))
}

export function upsertData<T = DataRow>(table: LocalTable, row: unknown): Promise<{ ok: boolean; row: T }> {
  return fetch(`/api/data/${table}/upsert`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ row })
  }).then((r) => parse(r))
}

export function removeData(table: LocalTable, id: string): Promise<{ ok: boolean; removed: boolean }> {
  return fetch(`/api/data/${table}/remove`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  }).then((r) => parse(r))
}
