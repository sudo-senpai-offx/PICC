/**
 * Live ExpertOption market stream (SSE).
 *
 * Mirrors the server-side liveEO events. The realtime source is the
 * app.expertoption.com tab held open in the PICC browser — that tab's own
 * WebSocket frames carry live ticks (tf:0) and 5s bars (tf:5) for the asset
 * currently open, aggregated locally into 1m/5m/15m/1h. The headless session
 * re-seeds the whole watch set (~20s) so every card stays fresh.
 */

import { getToken } from "@/lib/auth"
import type {
  ClosedTrade,
  DemoAnalyticsResult,
  DemoDeal,
  ExpertOptionDemoStatus,
  LedgerEntry,
  PaperPosition,
  SignalAccuracy,
  TradingSignal,
  TradingStatus
} from "@/lib/trading"

export interface LiveWallet {
  balance: number
  currency: string
}

/**
 * ExpertOption account model. EO advertises BOTH wallets in every profile
 * response (demo_balance + real_balance), so the suite shows demo and real
 * side by side. `active` is the context the live stream is bound to;
 * `balance`/`demo` mirror the active wallet for backward compatibility.
 */
export interface LiveAccount {
  balance: number
  currency: string
  demo: boolean
  active: "demo" | "real"
  demoWallet: LiveWallet
  realWallet: LiveWallet
  email: string | null
  name: string | null
}

export interface LiveAsset {
  id: string
  name: string
  type: string
  price: number | null
  change: number
  changePct: number
  spark: number[]
  periods: Record<string, number | null>
}

export interface LiveSnapshot {
  assets: LiveAsset[]
  account: LiveAccount | null
  viewed: string | null
  watching: string[]
  ts: number
}

export interface LiveStats {
  status: string
  error: string | null
  startedAt: number
  watched: string[]
  buffers: number
  tickCount: number
  subscribers: number
  viewed: string | null
  lastSeen: number
  account: LiveAccount | null
}

export type LiveTick = {
  type: "tick"
  ts: number
  assetId: string
  name: string
  price: number
  change: number
  changePct: number
  period: number
}

export type LiveEvent =
  | { type: "ready"; ok: boolean }
  | { type: "stats"; stats: LiveStats }
  | { type: "snapshot"; snapshot: LiveSnapshot }
  | LiveTick
  | { type: "account"; account: LiveAccount; mode: string; ts: number }
  | { type: "status"; status: string; mode?: string; account?: LiveAccount | null; error?: string; ts: number }
  | ({ type: "decision" } & LiveDecisions)
  | { type: "suite"; snapshot: TradingSuiteSnapshot }

export interface LiveDecisionGates {
  score: boolean
  winProb: boolean
  priceRR: boolean
  evRR: boolean
  payout: boolean
}

export interface LiveDecision {
  assetId: string
  asset: string
  verdict: "TRADE" | "OBSERVE" | "NEUTRAL"
  direction: "up" | "down" | "flat"
  score: number | null
  confidence: number | null
  phase: string | null
  phaseLabel: string | null
  expiry: number | null
  winProb: number | null
  empirical: number | null
  sampled: number | null
  ev: number | null
  payout: number | null
  payoutSource: "assumed" | "observed" | null
  evRR: number | null
  priceRR: number | null
  favorable: number | null
  adverse: number | null
  mttdSec: number | null
  gates: LiveDecisionGates
  volume: { proxy: string; ratePerMin: number | null; delta: number | null; upRatio: number | null; bars: number }
  bars: number
  reasons: string[]
  ts: number
  // Adaptive-confluence extras attached server-side (REST snapshots and the
  // enriched SSE "decision" event carry them; see adaptiveConfluence.mjs).
  quadrant?: string | null
  adx?: number | null
  atrPct?: number | null
  groups?: { trend: number; momentum: number; volatility: number; volume: number }
  mtf?: { agree: number; total: number; details: { tf: number; dir: number; matches: boolean }[] }
  sentiment?: { score: number; source: string; aligned: boolean }
}

export interface LiveDecisions {
  ts: number
  status: string
  mode: string | null
  account: LiveAccount | null
  viewed: string | null
  decisions: LiveDecision[]
}

export interface MarketIntelStrategy {
  score: number
  signal: "up" | "down" | "flat"
  reason: string
  details?: Record<string, unknown>
}

export interface MarketIntelDuration {
  atrPct: number | null
  label: string
  suggestedSec: number | null
  window: string | null
  mttdSec: number | null
  reason: string
}

/** One market's meta-analysis row: the six expert strategies + composite score. */
export interface MarketIntelRow {
  assetId: string
  asset: string
  action: "call" | "put" | null
  intelScore: number
  confidence: number | null
  verdict: "TRADE" | "OBSERVE" | "NEUTRAL" | null
  direction: "up" | "down" | "flat" | null
  expirySec: number | null
  winProb: number | null
  ev: number | null
  phase: string | null
  phaseLabel: string | null
  atrPct: number | null
  tradable: boolean
  strategies: {
    mtf: MarketIntelStrategy
    phase: MarketIntelStrategy
    volume: MarketIntelStrategy
    rr: MarketIntelStrategy
    edge: MarketIntelStrategy
    duration: MarketIntelDuration | null
  }
  reasons: string[]
  ts: number
}

/** Precise manual-entry recommendation — only present when a market clears the bar. */
export interface MarketIntelRecommendation {
  market: string
  action: "call" | "put"
  expirySec: number
  confidence: number
  intelScore: number
  phase: string | null
  phaseLabel: string | null
  volatility: string | null
  durationSec: number | null
  reasons: string[]
}

/**
 * Realtime meta-analysis over the whole watch set: best market to trade,
 * volatility / trade-duration considerations, six-strategy adherence per market
 * and (when warranted) a precise manual buy/sell recommendation.
 */
export interface MarketIntel {
  ok: boolean
  ts: number
  status: string
  mode: string | null
  account: LiveAccount | null
  viewed: string | null
  best: MarketIntelRow | null
  ranked: MarketIntelRow[]
  recommendation: MarketIntelRecommendation | null
  honesty: string | null
  error?: string
}

/**
 * One aggregated snapshot of the whole trading suite, streamed as periodic
 * `suite` events over the realtime feed. Sections that failed server-side are
 * `null`; `live` mirrors the ExpertOption stream stats.
 */
export interface TradingSuiteSnapshot {
  ts: number
  live: LiveStats | null
  trading: TradingStatus | null
  positions: PaperPosition[] | null
  closed: ClosedTrade[] | null
  signals: TradingSignal[] | null
  accuracy: SignalAccuracy | null
  intel: MarketIntel | null
  ledger: { stats: unknown; engine: unknown; entries: LedgerEntry[] } | null
  demo: ExpertOptionDemoStatus | null
  deals: { ok: boolean; deals: DemoDeal[] } | null
  analytics: DemoAnalyticsResult | null
}

/**
 * Open the realtime market stream. Calls onEvent for every SSE message and
 * onOpen once the stream is established. onFail fires when the stream dies for
 * any reason other than an explicit close() (HTTP error, dropped connection,
 * server end) so callers can reconnect. Returns a close handle.
 */
export function streamLiveTrading(
  onEvent: (e: LiveEvent) => void,
  onOpen?: () => void,
  onFail?: (err: Error) => void
): { close: () => void } {
  const ctrl = new AbortController()
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let opened = false
  fetch(`${BASE}/trading/realtime`, { headers, signal: ctrl.signal })
    .then(async (res) => {
      // A non-200 (e.g. 401) previously got read as an SSE byte stream → zero
      // events → a "connected but empty" dead stream with no error anywhere.
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ? String(j.error) : `stream failed (${res.status})`)
      }
      if (!res.body) throw new Error("stream failed (empty response)")
      if (!opened) {
        opened = true
        onOpen?.()
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let lastEvent = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""
        for (const part of parts) {
          const evLine = part.split("\n").find((l) => l.startsWith("event:"))
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"))
          if (evLine) lastEvent = evLine.slice(6).trim()
          if (!dataLine) continue
          try {
            const payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>
            if (lastEvent === "tick") {
              onEvent(payload as LiveTick)
            } else if (lastEvent === "snapshot") {
              onEvent({ type: "snapshot", snapshot: payload as unknown as LiveSnapshot })
            } else if (lastEvent === "stats") {
              onEvent({ type: "stats", stats: payload as unknown as LiveStats })
            } else if (lastEvent === "account") {
              onEvent({
                type: "account",
                account: payload.account as LiveAccount,
                mode: String(payload.mode ?? ""),
                ts: Number(payload.ts ?? Date.now())
              })
            } else if (lastEvent === "status") {
              onEvent({
                type: "status",
                status: String(payload.status ?? ""),
                mode: payload.mode != null ? String(payload.mode) : undefined,
                account: (payload.account as LiveAccount) ?? null,
                error: payload.error != null ? String(payload.error) : undefined,
                ts: Number(payload.ts ?? Date.now())
              })
            } else if (lastEvent === "decision" || lastEvent === "decisions") {
              const p = payload as unknown as LiveDecisions & { ok?: boolean; error?: string }
              if (p.ok === false) {
                // The engine failed (cold timeout, broker session rejected) —
                // surface it as a status error instead of silently dropping it.
                onEvent({
                  type: "status",
                  status: "error",
                  mode: p.mode ?? undefined,
                  account: (p.account as LiveAccount) ?? null,
                  error: p.error ?? "decision engine failed",
                  ts: Number(p.ts ?? Date.now())
                })
              } else {
                onEvent({ type: "decision", ...p })
              }
            } else if (lastEvent === "suite") {
              onEvent({ type: "suite", snapshot: payload as unknown as TradingSuiteSnapshot })
            } else {
              onEvent({ type: "ready", ok: Boolean((payload as { ok?: boolean })?.ok) } as LiveEvent)
            }
          } catch {
            /* ignore malformed events */
          }
        }
      }
      // Clean server-side close counts as a stream death so the shared feed can
      // reconnect (dev-server restart, idle proxy, etc.).
      throw new Error("stream ended")
    })
    .catch((err) => {
      if (ctrl.signal.aborted) return // intentional close() — not a failure
      onFail?.(err instanceof Error ? err : new Error(String(err)))
    })
  return { close: () => ctrl.abort() }
}

// --- token plumbing (kept local to this module) ---------------------------------

const BASE = "/api"

/**
 * On-demand snapshot of the adaptive-confluence decision engine (see
 * /api/trading/decisions). Returns the same shape the SSE "decision" event
 * carries, computed server-side and cached for a few seconds.
 */
export async function getTradingDecisions(): Promise<LiveDecisions> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}/trading/decisions`, { headers })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new Error(j?.error ? String(j.error) : `decisions request failed (${res.status})`)
  }
  return (await res.json()) as LiveDecisions
}

/**
 * On-demand market meta-analysis (see /api/trading/intel). Same shape as the
 * `intel` section carried inside the realtime `suite` events; used for instant
 * paint before the first streamed snapshot arrives.
 */
export async function getMarketIntel(): Promise<MarketIntel> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}/trading/intel`, { headers })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new Error(j?.error ? String(j.error) : `market intel request failed (${res.status})`)
  }
  return (await res.json()) as MarketIntel
}

