import { useEffect, useMemo, useState } from "react"
import { getToken } from "@/lib/auth"

// T6 — capability-driven chart buttons.
//
// The broker registry advertises each configured venue's `timeframes` curve
// via /api/trading/brokers. The chart uses that to disable resolutions the
// configured sources CANNOT serve, instead of requesting them and hoping the
// server relabels. Honesty rule: when the fetch fails or no configured
// market-data source is visible, we restrict NOTHING (unknown ≠ zero) and let
// the served-timeframe warning carry the truth once candles arrive.

export interface BrokerCapabilities {
  /** Timeframes any configured market-data source can serve. */
  servableTimeframes: Set<number>
  /** slug → curve, for restricting to the currently-SERVED source. */
  sourceTimeframes: Map<string, number[]>
  /** True while the capability fetch is in flight. */
  loading: boolean
}

interface BrokerRow {
  slug: string
  capabilities: string[]
  timeframes?: number[]
  configured?: boolean
  connected?: boolean
}

const FULL_RANGE = [5, 15, 30, 60, 300, 900, 1800, 3600, 14400, 86400, 604800, 2592000]

export function useBrokerCapabilities(): BrokerCapabilities {
  const [rows, setRows] = useState<BrokerRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const headers: Record<string, string> = {}
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    fetch("/api/trading/brokers", { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive) return
        setRows(Array.isArray(data?.brokers) ? data.brokers : null)
      })
      .catch(() => { if (alive) setRows(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return useMemo(() => {
    // Data providers only: paper claims market-data but serves no candles — it
    // must not widen the enabled set. Unknown sources stay unrestricted.
    const providers = (rows ?? []).filter(
      (b) => b.slug !== "paper" && b.capabilities?.includes("market-data") && Array.isArray(b.timeframes) && b.timeframes.length > 0
    )
    const active = providers.filter((b) => b.configured === true || b.connected === true)
    const sourceTimeframes = new Map<string, number[]>()
    for (const b of providers) sourceTimeframes.set(b.slug, b.timeframes as number[])
    if (!active.length) {
      // No configured source visible (fetch failed or nothing configured) —
      // do not block resolutions, the served-tf warning covers honesty.
      return { servableTimeframes: new Set(FULL_RANGE), sourceTimeframes, loading }
    }
    const union = new Set<number>()
    for (const b of active) for (const tf of b.timeframes as number[]) union.add(tf)
    return { servableTimeframes: union, sourceTimeframes, loading }
  }, [rows, loading])
}