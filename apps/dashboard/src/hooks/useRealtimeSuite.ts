import { useEffect, useRef, useState } from "react"
import type { LiveEvent, LiveStats, LiveTick, TradingSuiteSnapshot } from "@/lib/liveTrading"
import { streamLiveTrading } from "@/lib/liveTrading"

// Shared realtime feed for the whole trading suite. Every consumer that wants
// the aggregated `suite` snapshot subscribes here so the whole dashboard opens
// exactly ONE extra SSE connection instead of one per card. The stream is
// refcounted: closed when the last subscriber unmounts.
//
// Resilience: the transport reports failures (HTTP error, dropped connection,
// server end) through onFail, which flips everyone to disconnected and
// reconnects with backoff — a dead stream heals instead of freezing on stale
// data until a page reload.
type SuiteListener = {
  setSnapshot: (s: TradingSuiteSnapshot) => void
  setLive: (l: LiveStats) => void
  setConnected: (c: boolean) => void
  setError: (e: string | null) => void
  onEvent?: (e: LiveEvent) => void
}

// Singleton stream manager — survives HMR by attaching to globalThis.
// Module-level `let` variables reset on HMR, breaking the singleton contract.
// It doubles as the shared TICK bus (T8): charts subscribe per assetId and
// ride the SAME connection as the suite cards, so N charts open exactly one
// /api/trading/realtime fetch. The stream is closed when the last consumer of
// EITHER kind unsubscribes.
type TickListener = (tick: LiveTick) => void

class SuiteStreamManager {
  private streamHandle: { close: () => void } | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 2000
  private listeners = new Set<SuiteListener>()
  private tickListeners = new Map<string, Set<TickListener>>()
  private lastSnapshot: TradingSuiteSnapshot | null = null
  private lastLive: LiveStats | null = null

  getSnapshot() { return this.lastSnapshot }
  getLive() { return this.lastLive }

  private tickSubCount() {
    let n = 0
    for (const subs of this.tickListeners.values()) n += subs.size
    return n
  }

  private hasAnyConsumer() {
    return this.listeners.size > 0 || this.tickSubCount() > 0
  }

  private clearStream() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.streamHandle) {
      this.streamHandle.close()
      this.streamHandle = null
    }
    this.retryDelay = 2000
  }

  private startStream() {
    if (this.streamHandle || this.retryTimer) return
    this.streamHandle = streamLiveTrading(
      (e: LiveEvent) => {
        if (e.type === "suite") {
          this.lastSnapshot = e.snapshot
          for (const l of this.listeners) l.setSnapshot(e.snapshot)
        } else if (e.type === "stats") {
          this.lastLive = e.stats
          for (const l of this.listeners) l.setLive(e.stats)
        } else if (e.type === "ready") {
          if (e.ok) for (const l of this.listeners) l.setError(null)
        }
        // Raw tick events (transport emits them as bare LiveTick payloads)
        // route to the per-asset subscribers — the chart tick bus (T8).
        const maybeTick = e as LiveTick
        if (typeof maybeTick.assetId === "string" && typeof maybeTick.price === "number") {
          const subs = this.tickListeners.get(maybeTick.assetId)
          if (subs) for (const cb of [...subs]) cb(maybeTick)
        }
        for (const l of this.listeners) l.onEvent?.(e)
      },
      () => {
        for (const l of this.listeners) {
          l.setConnected(true)
          l.setError(null)
        }
      },
      (err) => {
        this.streamHandle = null
        for (const l of this.listeners) {
          l.setConnected(false)
          l.setError(err.message)
        }
        this.retryDelay = Math.min(this.retryDelay * 1.5, 15000)
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null
          this.startStream()
        }, this.retryDelay)
      }
    )
  }

  add(listener: SuiteListener) {
    this.listeners.add(listener)
    this.startStream()
  }

  remove(listener: SuiteListener) {
    this.listeners.delete(listener)
    if (!this.hasAnyConsumer()) this.clearStream()
  }

  /** Subscribe to live ticks for one asset. Returns an unsubscribe function. */
  subscribeTicks(assetId: string, cb: TickListener) {
    let subs = this.tickListeners.get(assetId)
    if (!subs) {
      subs = new Set()
      this.tickListeners.set(assetId, subs)
    }
    subs.add(cb)
    this.startStream()
    return () => this.unsubscribeTicks(assetId, cb)
  }

  unsubscribeTicks(assetId: string, cb: TickListener) {
    const subs = this.tickListeners.get(assetId)
    if (subs) {
      subs.delete(cb)
      if (!subs.size) this.tickListeners.delete(assetId)
    }
    if (!this.hasAnyConsumer()) this.clearStream()
  }
}

// Singleton: attach to globalThis so it survives HMR reloads.
const g = globalThis as unknown as { __picc_suite_stream?: SuiteStreamManager }
if (!g.__picc_suite_stream) g.__picc_suite_stream = new SuiteStreamManager()
const manager = g.__picc_suite_stream

/**
 * Subscribe to live ticks for one asset on the SHARED realtime connection.
 * Returns an unsubscribe function; the connection is opened when the first
 * consumer subscribes and closed when the last one (suite or tick) leaves
 * (T8 — N charts → exactly one /api/trading/realtime fetch).
 */
export function subscribeTicks(assetId: string, cb: (tick: LiveTick) => void): () => void {
  return manager.subscribeTicks(assetId, cb)
}

/**
 * Live aggregated snapshot of the whole trading suite (paper status/positions/
 * history/signals, accuracy ledger, and the ExpertOption demo/autopilot state),
 * streamed every few seconds over the realtime feed. Falls back to `null`
 * sections until the first `suite` event arrives — consumers keep their REST
 * initial load for instant paint.
 *
 * `onEvent` (optional) receives every raw event on the shared stream — use it
 * instead of opening a second connection (e.g. the live market board).
 *
 * `error` is non-null when the stream has failed and is being reconnected;
 * `connected` is true only while a live stream is actually established.
 */
export function useRealtimeSuite(onEvent?: (e: LiveEvent) => void): {
  snapshot: TradingSuiteSnapshot | null
  live: LiveStats | null
  connected: boolean
  error: string | null
} {
  const [snapshot, setSnapshot] = useState<TradingSuiteSnapshot | null>(manager.getSnapshot())
  const [live, setLive] = useState<LiveStats | null>(manager.getLive())
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    const listener: SuiteListener = {
      setSnapshot,
      setLive,
      setConnected,
      setError,
      onEvent: (e) => onEventRef.current?.(e)
    }
    manager.add(listener)
    return () => { manager.remove(listener) }
  }, [])

  return { snapshot, live, connected, error }
}
