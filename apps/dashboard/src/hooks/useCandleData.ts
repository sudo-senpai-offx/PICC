import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { CandleDatum, EmaDatum, VolumeDatum } from "@/components/CandlestickChart"
import type { LiveTick } from "@/lib/liveTrading"
import { getToken } from "@/lib/auth"

export type Timeframe = 60 | 300 | 900 | 3600

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  60: "1m",
  300: "5m",
  900: "15m",
  3600: "1h"
}

export { TIMEFRAME_LABELS }

interface UseCandleDataOpts {
  assetId: string
  timeframe?: Timeframe
  count?: number
}

interface UseCandleDataResult {
  candles: CandleDatum[]
  volumes: VolumeDatum[]
  ema20: EmaDatum[]
  ema50: EmaDatum[]
  tenkan: EmaDatum[]
  kijun: EmaDatum[]
  senkouA: EmaDatum[]
  senkouB: EmaDatum[]
  kcUpper: EmaDatum[]
  kcMiddle: EmaDatum[]
  kcLower: EmaDatum[]
  loading: boolean
  error: string | null
  streamError: string | null
  lastPrice: number | null
  timeframe: Timeframe
  setTimeframe: (tf: Timeframe) => void
}

const BASE = "/api"

async function fetchCandles(assetId: string, timeframe: Timeframe, count: number): Promise<CandleDatum[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}/trading/candles`, {
    method: "POST",
    headers,
    body: JSON.stringify({ assetId, timeframe, count })
  })
  if (!res.ok) {
    const j = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(j?.error ?? `candles request failed (${res.status})`)
  }
  const data = await res.json() as { ok: boolean; candles: Array<{ time: number; open: number; high: number; low: number; close: number }>; error?: string }
  if (!data.ok) throw new Error(data.error ?? "candles fetch failed")
  return data.candles
    .filter((c) => typeof c.open === "number" && typeof c.high === "number" && typeof c.low === "number" && typeof c.close === "number" && c.open > 0 && c.close > 0)
    .map((c) => ({
      time: c.time as unknown as import("lightweight-charts").Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }))
}

function computeEma(candles: CandleDatum[], period: number): EmaDatum[] {
  const closes = candles.map((c) => c.close)
  if (closes.length < period) return []
  const k = 2 / (period + 1)
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period
  const result: EmaDatum[] = []
  for (let i = period - 1; i < closes.length; i++) {
    if (i === period - 1) {
      result.push({ time: candles[i].time, value: ema })
    } else {
      ema = closes[i] * k + ema * (1 - k)
      result.push({ time: candles[i].time, value: ema })
    }
  }
  return result
}

function computeVolumes(candles: CandleDatum[]): VolumeDatum[] {
  return candles.map((c) => ({
    time: c.time,
    value: Math.abs(c.close - c.open) * 1000 || 1,
    color: c.close >= c.open ? "rgba(74, 222, 128, 0.3)" : "rgba(255, 107, 107, 0.3)"
  }))
}

function hlWin(candles: CandleDatum[], end: number, period: number) {
  let hi = -Infinity, lo = Infinity
  for (let k = end - period + 1; k <= end; k++) {
    if (k < 0 || k >= candles.length) return { hi: null, lo: null }
    if (candles[k].high > hi) hi = candles[k].high
    if (candles[k].low < lo) lo = candles[k].low
  }
  return { hi, lo }
}

function computeIchimoku(candles: CandleDatum[]) {
  const n = candles.length
  const tenkan: EmaDatum[] = []
  const kijun: EmaDatum[] = []
  const senkouA: EmaDatum[] = []
  const senkouB: EmaDatum[] = []
  const DISPLACEMENT = 26

  for (let i = 0; i < n; i++) {
    if (i >= 8) {
      const { hi, lo } = hlWin(candles, i, 9)
      if (hi != null) tenkan.push({ time: candles[i].time, value: (hi + lo) / 2 })
    }
    if (i >= 25) {
      const { hi, lo } = hlWin(candles, i, 26)
      if (hi != null) kijun.push({ time: candles[i].time, value: (hi + lo) / 2 })
    }
    if (i >= 51) {
      const { hi, lo } = hlWin(candles, i, 52)
      if (hi != null && i + DISPLACEMENT < n) {
        senkouB.push({ time: candles[i + DISPLACEMENT].time, value: (hi + lo) / 2 })
      }
    }
  }

  for (const t of tenkan) {
    const k = kijun.find((k) => (k.time as unknown as number) === (t.time as unknown as number))
    if (k && senkouB.find((s) => (s.time as unknown as number) === (t.time as unknown as number))) {
      senkouA.push({ time: t.time, value: (t.value + k.value) / 2 })
    }
  }

  return { tenkan, kijun, senkouA, senkouB }
}

function computeKeltner(candles: CandleDatum[]) {
  const n = candles.length
  if (n < 20) return { kcUpper: [], kcMiddle: [], kcLower: [] }
  const closes = candles.map((c) => c.close)
  const kcMiddle = computeEma(candles, 20)

  const atrArr: number[] = []
  for (let i = 0; i < n; i++) {
    if (i === 0) { atrArr.push(candles[i].high - candles[i].low); continue }
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - closes[i - 1]), Math.abs(candles[i].low - closes[i - 1]))
    atrArr.push(i < 10 ? tr : (atrArr[i - 1] * 9 + tr) / 10)
  }

  const kcUpper: EmaDatum[] = []
  const kcLower: EmaDatum[] = []
  for (let i = 19; i < n; i++) {
    const mid = kcMiddle.find((m) => (m.time as unknown as number) === (candles[i].time as unknown as number))
    if (!mid) continue
    kcUpper.push({ time: candles[i].time, value: mid.value + 2 * atrArr[i] })
    kcLower.push({ time: candles[i].time, value: mid.value - 2 * atrArr[i] })
  }

  return { kcUpper, kcMiddle, kcLower }
}

export function useCandleData({ assetId, timeframe: initialTf = 60, count = 240 }: UseCandleDataOpts): UseCandleDataResult {
  const [candles, setCandles] = useState<CandleDatum[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [lastPrice, setLastPrice] = useState<number | null>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTf)
  const candlesRef = useRef<CandleDatum[]>([])

  // Fetch initial candle data
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fetchCandles(assetId, timeframe, count)
      .then((data) => {
        if (!alive) return
        candlesRef.current = data
        setCandles(data)
        if (data.length > 0) setLastPrice(data[data.length - 1].close)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { alive = false }
  }, [assetId, timeframe, count])

  // Subscribe to SSE live ticks for real-time updates. Reconnects with capped
  // exponential backoff — a dropped stream used to freeze the chart silently.
  // `timeframe` is a dependency on purpose: tick bucketing must track it or the
  // current candle gets built for a stale timeframe after a switch.
  useEffect(() => {
    const ctrl = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const connect = () => {
      const headers: Record<string, string> = {}
      const token = getToken()
      if (token) headers.Authorization = `Bearer ${token}`

      fetch(`${BASE}/trading/realtime`, { headers, signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok || !res.body) throw new Error(`realtime stream failed (${res.status})`)
          attempt = 0
          setStreamError(null)
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

              if (lastEvent === "tick") {
                try {
                  const tick = JSON.parse(dataLine.slice(5).trim()) as LiveTick
                  if (tick.assetId === assetId && typeof tick.price === "number" && tick.price > 0) {
                    setLastPrice(tick.price)
                    const tfSec = timeframe
                    const bucket = Math.floor(tick.ts / 1000 / tfSec) * tfSec
                    setCandles((prev) => {
                      const next = [...prev]
                      const last = next[next.length - 1]
                      if (last && (last.time as unknown as number) === bucket) {
                        next[next.length - 1] = {
                          ...last,
                          high: Math.max(last.high, tick.price),
                          low: Math.min(last.low, tick.price),
                          close: tick.price
                        }
                      } else if (!last || (last.time as unknown as number) < bucket) {
                        next.push({
                          time: bucket as unknown as import("lightweight-charts").Time,
                          open: tick.price,
                          high: tick.price,
                          low: tick.price,
                          close: tick.price
                        })
                        if (next.length > count) next.shift()
                      }
                      candlesRef.current = next
                      return next
                    })
                  }
                } catch {
                  /* ignore malformed ticks */
                }
              }
            }
          }
          // Clean server-side close still counts as stream death so we reconnect.
          throw new Error("realtime stream ended")
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return // intentional close — not a failure
          setStreamError(err instanceof Error ? err.message : "realtime stream failed")
          const delay = Math.min(15000, 1000 * 2 ** attempt)
          attempt += 1
          retryTimer = setTimeout(connect, delay)
        })
    }

    connect()
    return () => {
      ctrl.abort()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [assetId, count, timeframe])

  const volumes = computeVolumes(candles)
  const ema20 = computeEma(candles, 20)
  const ema50 = computeEma(candles, 50)
  const { tenkan, kijun, senkouA, senkouB } = useMemo(() => computeIchimoku(candles), [candles])
  const { kcUpper, kcMiddle, kcLower } = useMemo(() => computeKeltner(candles), [candles])

  const handleSetTimeframe = useCallback((tf: Timeframe) => {
    setTimeframe(tf)
  }, [])

  return { candles, volumes, ema20, ema50, tenkan, kijun, senkouA, senkouB, kcUpper, kcMiddle, kcLower, loading, error, streamError, lastPrice, timeframe, setTimeframe: handleSetTimeframe }
}
