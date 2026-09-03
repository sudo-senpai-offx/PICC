// PICC income overview + server-backed streams layer (Q5).
//
// The income surface is SERVER-BACKED: streams migrate from localStorage to the
// user-scoped JSON store (/api/data/income_streams) and the overview aggregate
// comes from GET /api/income/overview. The client-only streams.ts layer is kept
// ONLY for the offline / migration-pending fallback (the independence rule: a
// web-app-alone or still-migrating install stays functional).
import { useEffect, useState } from "react"
import type { IncomeStream } from "./types"
import { getStreams, getEarnings, saveStreams, streamSummary, type StreamSummary } from "./streams"
import { listData, upsertData, removeData, type LocalTable } from "./localdata"
import { getToken } from "./auth"

const STREAMS_TABLE: LocalTable = "income_streams"
const MIGRATION_KEY = "picc.incomeMigrationComplete"

function migrationComplete(): boolean {
  try {
    return localStorage.getItem(MIGRATION_KEY) === "1"
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------
// Server-backed stream CRUD
// ---------------------------------------------------------------------

/** List this user's income streams from the server. Returns null when offline. */
export async function listIncomeStreams(): Promise<IncomeStream[] | null> {
  await ensureIncomeMigrated()
  try {
    const res = await listData<IncomeStream>(STREAMS_TABLE)
    return res.rows ?? []
  } catch {
    return null
  }
}

/** Upsert a stream server-side (id is preserved — idempotent). Returns null when offline. */
export async function upsertIncomeStream(stream: Partial<IncomeStream> & { id?: string }): Promise<IncomeStream | null> {
  try {
    const res = await upsertData<IncomeStream>(STREAMS_TABLE, stream)
    return res.row ?? null
  } catch {
    return null
  }
}

/** Remove a stream server-side. Returns false when offline or the row is missing. */
export async function removeIncomeStream(id: string): Promise<boolean> {
  try {
    const res = await removeData(STREAMS_TABLE, id)
    return res.removed === true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------
// localStorage → server migration (Task 10)
//
// Reads the user's locally-stored streams (picc.streams), upserts EACH to the
// user-scoped income_streams table KEEPING its existing id (idempotent — a
// re-run never duplicates), and only then, one-by-one, clears the LOCAL copy of
// each stream that the server confirmed. NEVER destructive on partial failure:
// a stream whose server write did not confirm stays local. The migration is
// marked complete only after every local stream is safely server-side. This is
// FLAGGED user-owned data — no clearing happens unless the server confirmed the
// write first (and launch-verification is the final gate, Task 14/15).
// ---------------------------------------------------------------------
export async function migrateLocalStreams(): Promise<{
  migrated: number
  failed: number
  complete: boolean
}> {
  if (migrationComplete()) return { migrated: 0, failed: 0, complete: true }

  const local = getStreams()
  if (!local.length) {
    try {
      localStorage.setItem(MIGRATION_KEY, "1")
    } catch { /* ignore */ }
    return { migrated: 0, failed: 0, complete: true }
  }

  let migrated = 0
  let failed = 0
  const toKeep: IncomeStream[] = []

  for (const s of local) {
    const ok = await upsertIncomeStream(s)
    if (ok) {
      migrated += 1 // server confirmed this row — safe to drop from the local list
    } else {
      failed += 1
      toKeep.push(s) // server unreachable / rejected — keep this one local, untouched
    }
  }

  // Persist only the streams that were NOT confirmed server-side (partial
  // success never destroys the remainder), then record migration completion
  // only when every local stream has a confirmed server copy.
  saveStreams(toKeep)
  const complete = failed === 0
  if (complete) {
    try {
      localStorage.setItem(MIGRATION_KEY, "1")
    } catch { /* ignore */ }
  }
  return { migrated, failed, complete }
}

// ---------------------------------------------------------------------
// Migration call-site (Task 10)
//
// Any read of the SERVER-backed income surface (listIncomeStreams from the
// Streams tab, getIncomeOverview from the Overview tab) first runs the
// localStorage → server migration, so a still-unmigrated install sees its
// streams after one open — the web-app-alone + extension-alone rule holds and
// nothing is cleared until the server confirms each row. One in-flight promise
// is shared by concurrent readers; it is released on settle so a later read
// retries, and migrateLocalStreams itself is idempotent (completed → no-op,
// empty local store → marks done instantly).
// ---------------------------------------------------------------------
let migrationInFlight: Promise<{ migrated: number; failed: number; complete: boolean }> | null = null

export function ensureIncomeMigrated() {
  if (!migrationInFlight) {
    migrationInFlight = migrateLocalStreams().finally(() => {
      migrationInFlight = null
    })
  }
  return migrationInFlight
}

// ---------------------------------------------------------------------
// Unified overview (Task 11/12)
// ---------------------------------------------------------------------

/** Normalized connector earnings snapshot (mirrors `normalizeEarnings`). */
export interface ConnectorSnapshot {
  provider: string
  platform?: string
  balance: number | null
  today: number | null
  lifetime: number | null
  payoutThreshold: number | null
  estimatedDaily: number | null
  currency?: string | null
  source?: string | null
  status: "ok" | "error" | "stale" | "unconfigured" | string | null
  error?: string | null
  lastChecked?: number | null
  extra?: Record<string, unknown> | null
}

/** User holdings grouped by owning table (the §4 shape). */
export interface IncomeHoldings {
  nft: Record<string, unknown>[]
  depin: Record<string, unknown>[]
  financial: Record<string, unknown>[]
  transactions: Record<string, unknown>[]
}

export const EMPTY_HOLDINGS: IncomeHoldings = {
  nft: [],
  depin: [],
  financial: [],
  transactions: []
}

export interface IncomeOverview {
  snapshots: Record<string, ConnectorSnapshot>
  streams: IncomeStream[]
  holdings: IncomeHoldings
  summary: StreamSummary
  source: "server" | "local"
}

/** Best-effort: fetch the server overview; fall back to the local summary. */
export async function getIncomeOverview(): Promise<IncomeOverview> {
  await ensureIncomeMigrated()
  try {
    const res = await fetch("/api/income/overview", {
      headers: authHeaders()
    })
    if (!res.ok) throw new Error("overview unavailable")
    const data = await res.json()
    return {
      snapshots: data.snapshots ?? {},
      streams: (data.streams ?? []).map(normalizeStreamRow),
      holdings: {
        nft: data.holdings?.nft ?? [],
        depin: data.holdings?.depin ?? [],
        financial: data.holdings?.financial ?? [],
        transactions: data.holdings?.transactions ?? []
      },
      summary: normalizeSummary(data.summary),
      source: "server"
    }
  } catch {
    // Independence rule: when the server is unreachable (or still migrating),
    // serve the local streams/earnings summary so the app stays functional.
    const streams = getStreams()
    const earnings = getEarnings()
    return {
      snapshots: {},
      streams,
      holdings: EMPTY_HOLDINGS,
      summary: streamSummary(streams, earnings),
      source: "local"
    }
  }
}

/**
 * Live overview hook: server-backed with a local fallback. `reload()` re-fetches
 * so mutations elsewhere can re-render the aggregates synchronously.
 */
export function useIncomeOverview() {
  const [overview, setOverview] = useState<IncomeOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getIncomeOverview()
      .then((o) => {
        if (alive) {
          setOverview(o)
          setError(null)
        }
      })
      .catch((err) => {
        if (alive) setError((err as Error).message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  return { overview, loading, error, reload: () => setReloadKey((k) => k + 1) }
}

// Rich server rows may come back sparse (raw localstore rows); coerce every
// stream into the full IncomeStream shape so the UI never chokes on a missing
// field. Absent numerics stay 0 ONLY here (UI coercion), never fabricated as
// real data — the server-marked summary still owns the honest nulls.
function normalizeStreamRow(r: Record<string, unknown>): IncomeStream {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? r.platform ?? r.provider ?? "Unnamed stream"),
    category: (r.category as IncomeStream["category"]) ?? "other",
    platform: String(r.platform ?? ""),
    status: (r.status as IncomeStream["status"]) ?? "active",
    balance: Number(r.balance ?? 0) || 0,
    totalEarned: Number(r.totalEarned ?? 0) || 0,
    payoutThreshold: Number(r.payoutThreshold ?? 0) || 0,
    payoutMethod: String(r.payoutMethod ?? "—"),
    estimatedDaily: Number(r.estimatedDaily ?? 0) || 0,
    lastCollected: r.lastCollected ? String(r.lastCollected) : undefined,
    url: r.url ? String(r.url) : undefined,
    note: r.note ? String(r.note) : undefined,
    collector: (r.collector as IncomeStream["collector"]) ?? "manual"
  }
}

// The server summary may omit monthly/daily (no server-side series) and use
// null for unobservable monetaries; coerce null -> 0 for the UI's number-loving
// StreamSummary while preserving the honesty that "we simply don't have it".
function normalizeSummary(s: Partial<StreamSummary> | null | undefined): StreamSummary {
  const base = emptySummary()
  if (!s) return base
  return {
    monthly: typeof s.monthly === "number" ? s.monthly : 0,
    lifetime: typeof s.lifetime === "number" ? s.lifetime : 0,
    today: typeof s.today === "number" ? s.today : 0,
    activeCount: typeof s.activeCount === "number" ? s.activeCount : 0,
    projectedAnnual: typeof s.projectedAnnual === "number" ? s.projectedAnnual : 0,
    cashoutReady: Array.isArray(s.cashoutReady) ? s.cashoutReady : [],
    daily: Array.isArray(s.daily) ? s.daily : []
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function emptySummary(): StreamSummary {
  return {
    monthly: 0,
    lifetime: 0,
    today: 0,
    activeCount: 0,
    projectedAnnual: 0,
    cashoutReady: [],
    daily: []
  }
}
