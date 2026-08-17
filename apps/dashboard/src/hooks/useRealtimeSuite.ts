import { useEffect, useRef, useState } from "react"
import type { LiveEvent, LiveStats, TradingSuiteSnapshot } from "@/lib/liveTrading"
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

let streamHandle: { close: () => void } | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = 2000
const listeners = new Set<SuiteListener>()
let lastSnapshot: TradingSuiteSnapshot | null = null
let lastLive: LiveStats | null = null

function clearStream() {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  if (streamHandle) {
    streamHandle.close()
    streamHandle = null
  }
  retryDelay = 2000
}

function startStream() {
  if (streamHandle || retryTimer) return
  streamHandle = streamLiveTrading(
    (e: LiveEvent) => {
      if (e.type === "suite") {
        lastSnapshot = e.snapshot
        for (const l of listeners) l.setSnapshot(e.snapshot)
      } else if (e.type === "stats") {
        lastLive = e.stats
        for (const l of listeners) l.setLive(e.stats)
      } else if (e.type === "ready") {
        // A real `ready` payload means the server accepted the connection —
        // clear any prior failure and mark live. (The transport already treats
        // an HTTP 401 as a hard failure, so this path is genuinely reachable.)
        if (e.ok) for (const l of listeners) l.setError(null)
      }
      // Raw forwarding for consumers that need the live stream itself
      // (tick/account/status/snapshot/decision) without their own connection.
      for (const l of listeners) l.onEvent?.(e)
    },
    () => {
      for (const l of listeners) {
        l.setConnected(true)
        l.setError(null)
      }
    },
    (err) => {
      streamHandle = null
      for (const l of listeners) {
        l.setConnected(false)
        l.setError(err.message)
      }
      // Reconnect with exponential backoff; the transport re-registers the
      // server-side subscriptions on each new connection.
      retryDelay = Math.min(retryDelay * 1.5, 15000)
      retryTimer = setTimeout(() => {
        retryTimer = null
        startStream()
      }, retryDelay)
    }
  )
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
  const [snapshot, setSnapshot] = useState<TradingSuiteSnapshot | null>(lastSnapshot)
  const [live, setLive] = useState<LiveStats | null>(lastLive)
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
    listeners.add(listener)
    startStream()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) clearStream()
    }
  }, [])

  return { snapshot, live, connected, error }
}
