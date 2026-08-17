// PICC income-streams data layer — passive income orchestration, stored locally.
import type { IncomeStream, StreamEarning } from "./types"
import { uid } from "./finance"

const K_STREAMS = "picc.streams"
const K_EARNINGS = "picc.streamEarnings"
const K_COLLECTORS = "picc.collectorCredentials"

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------
export function getStreams(): IncomeStream[] {
  return read<IncomeStream[]>(K_STREAMS, [])
}

export function saveStreams(streams: IncomeStream[]) {
  write(K_STREAMS, streams)
}

export function addStream(input: Omit<IncomeStream, "id">): IncomeStream[] {
  const stream: IncomeStream = { ...input, id: uid() }
  const next = [...getStreams(), stream]
  saveStreams(next)
  return next
}

export function updateStream(id: string, patch: Partial<IncomeStream>): IncomeStream[] {
  const next = getStreams().map((s) => (s.id === id ? { ...s, ...patch } : s))
  saveStreams(next)
  return next
}

export function removeStream(id: string): IncomeStream[] {
  const next = getStreams().filter((s) => s.id !== id)
  saveStreams(next)
  saveEarnings(getEarnings().filter((e) => e.streamId !== id))
  return next
}

// ---------------------------------------------------------------------
// Earnings events
// ---------------------------------------------------------------------
export function getEarnings(): StreamEarning[] {
  return read<StreamEarning[]>(K_EARNINGS, [])
}

export function saveEarnings(entries: StreamEarning[]) {
  write(K_EARNINGS, entries)
}

/** Record a day's earnings for a stream, replacing any prior value for the same (stream, date). */
export function recordEarning(streamId: string, date: string, amount: number, source: "auto" | "manual"): StreamEarning[] {
  const next = getEarnings().filter((e) => !(e.streamId === streamId && e.date === date))
  next.push({ id: uid(), streamId, date, amount, source })
  next.sort((a, b) => b.date.localeCompare(a.date))
  saveEarnings(next)
  return next
}

export function removeEarning(id: string): StreamEarning[] {
  const next = getEarnings().filter((e) => e.id !== id)
  saveEarnings(next)
  return next
}

// ---------------------------------------------------------------------
// Collector credentials (persisted locally so you enter them once)
// ---------------------------------------------------------------------
export interface CollectorCredentials {
  honeygainToken: string
  cashpilotUrl: string
  cashpilotKey: string
}

export function getCollectorCredentials(): CollectorCredentials {
  return read<CollectorCredentials>(K_COLLECTORS, { honeygainToken: "", cashpilotUrl: "", cashpilotKey: "" })
}

export function saveCollectorCredentials(creds: CollectorCredentials) {
  write(K_COLLECTORS, creds)
}

// ---------------------------------------------------------------------
// Auto-estimation of $/day
// ---------------------------------------------------------------------
/** Average daily earnings over the last `windowDays`, from a collector daily history. */
export function estimateDailyFromHistory(history: { date: string; usd: number }[], windowDays = 30): number {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - windowDays)
  const since = cutoff.toISOString().slice(0, 10)
  const days = history.filter((d) => d.date >= since && d.usd > 0)
  if (days.length < 3) return 0
  const total = days.reduce((acc, d) => acc + d.usd, 0)
  return Math.round((total / windowDays) * 100) / 100
}

/** Recompute estimatedDaily for every stream from recorded earnings (needs >=3 earning days). */
export function applyAutoEstimates(streams: IncomeStream[], earnings: StreamEarning[]): IncomeStream[] {
  let changed = false
  const next = streams.map((s) => {
    const est = estimateDailyFromEarnings(s.id, earnings)
    if (est != null && Math.abs(est - s.estimatedDaily) > 0.005) {
      changed = true
      return { ...s, estimatedDaily: est }
    }
    return s
  })
  if (changed) saveStreams(next)
  return next
}

function estimateDailyFromEarnings(streamId: string, earnings: StreamEarning[]): number | null {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const since = cutoff.toISOString().slice(0, 10)
  const days = earnings
    .filter((e) => e.streamId === streamId && e.date >= since && e.amount > 0)
    .map((e) => e.date)
  if (days.length < 3) return null
  const total = earnings
    .filter((e) => e.streamId === streamId && e.date >= since && e.amount > 0)
    .reduce((acc, e) => acc + e.amount, 0)
  return Math.round((total / 30) * 100) / 100
}

// ---------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------
export interface StreamSummary {
  monthly: number // last 30 days across all streams
  lifetime: number
  today: number
  activeCount: number
  projectedAnnual: number
  cashoutReady: IncomeStream[]
  daily: { date: string; total: number }[]
}

export function streamSummary(streams: IncomeStream[], earnings: StreamEarning[]): StreamSummary {
  const active = streams.filter((s) => s.status === "active")
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date()
  monthAgo.setDate(monthAgo.getDate() - 30)

  const byDay = new Map<string, number>()
  let monthly = 0
  let lifetime = 0
  let todayTotal = 0
  for (const e of earnings) {
    if (e.amount <= 0) continue
    lifetime += e.amount
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.amount)
    if (e.date >= monthAgo.toISOString().slice(0, 10)) monthly += e.amount
    if (e.date === today) todayTotal += e.amount
  }
  const daily = [...byDay.entries()]
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60)

  const projectedAnnual = active.reduce((acc, s) => acc + s.estimatedDaily * 365, 0)
  const cashoutReady = streams.filter((s) => s.status === "active" && s.payoutThreshold > 0 && s.balance >= s.payoutThreshold)

  return { monthly, lifetime, today: todayTotal, activeCount: active.length, projectedAnnual, cashoutReady, daily }
}

// ---------------------------------------------------------------------
// Collector-driven upserts
// ---------------------------------------------------------------------
/** Upsert (create or update) a stream by platform name; returns the stream and new stream list. */
export function upsertPlatformStream(
  platform: string,
  fields: Partial<IncomeStream>
): { stream: IncomeStream; streams: IncomeStream[] } {
  let streams = getStreams()
  const existing = streams.find((s) => s.platform.toLowerCase() === platform.toLowerCase())
  let stream: IncomeStream
  if (existing) {
    stream = { ...existing, ...fields, id: existing.id }
    streams = streams.map((s) => (s.id === existing.id ? stream : s))
  } else {
    stream = {
      id: uid(),
      name: platform,
      platform,
      category: "bandwidth",
      status: "active",
      balance: 0,
      totalEarned: 0,
      payoutThreshold: 0,
      payoutMethod: "—",
      estimatedDaily: 0,
      collector: "manual",
      ...fields
    }
    streams = [...streams, stream]
  }
  saveStreams(streams)
  return { stream, streams }
}
