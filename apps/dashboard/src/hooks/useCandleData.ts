import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { CandleDatum, EmaDatum, VolumeDatum } from "@/components/CandlestickChart"
import { getToken } from "@/lib/auth"
import { subscribeTicks, useRealtimeSuite } from "./useRealtimeSuite"
import { sma, bollinger, rsi, macd } from "@/lib/indicators"

export type Timeframe =
  | 5 | 15 | 30 | 60 | 300 | 900 | 1800 | 3600 | 14400 | 86400 | 604800 | 2592000

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  5: "5s",
  15: "15s",
  30: "30s",
  60: "1m",
  300: "5m",
  900: "15m",
  1800: "30m",
  3600: "1h",
  14400: "4h",
  86400: "1D",
  604800: "1W",
  2592000: "1M"
}

export { TIMEFRAME_LABELS }

interface UseCandleDataOpts {
  assetId: string
  timeframe?: Timeframe
  count?: number
  /** T6 — optional pinned source ("auto" = best/ideal fan-in default). */
  source?: string
}

/** T6 — one selectable market-data source for the chart dropdown. */
export interface AvailableSource {
  slug: string
  label: string
  weight: number
  /** Capability only (resolution curve covers the request) — NOT a live-data guarantee. */
  serves: boolean
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
  /** T10 — SMA(20) overlay (mirrors server indicators.mjs sma). */
  sma20: EmaDatum[]
  /** T10 — Bollinger bands (20, 2σ), matching the server bollinger. */
  bbUpper: EmaDatum[]
  bbMid: EmaDatum[]
  bbLower: EmaDatum[]
  /** T10 — RSI(14) secondary-pane line. */
  rsiLine: EmaDatum[]
  /** T10 — MACD (12/26/9): line, signal, histogram. */
  macdLine: EmaDatum[]
  macdSignal: EmaDatum[]
  macdHist: EmaDatum[]
  loading: boolean
  error: string | null
  streamError: string | null
  lastPrice: number | null
  timeframe: Timeframe
  setTimeframe: (tf: Timeframe) => void
  /** Where the candles came from: live / buffer / yahoo-daily fallback. */
  source: string | null
  /** T6 — the currently-selected dropdown lens ("auto" = best/ideal). */
  pinnedSource: string
  /** T6 — the selectable source set driving the chart's source dropdown. */
  availableSources: AvailableSource[]
  /** T6 — pin the next fetch to one source slug ("auto" = best/ideal). */
  setSource: (source: string) => void
  /** Which live leg fed the series when the EO source served: "extension" | "studio" | null. */
  feed: string | null
  /** Actual bar resolution of the returned series (86400 = Yahoo daily). */
  resolvedTimeframe: number | null
  /** True when the SERVER served a different resolution than requested. */
  resolved: boolean
  /** Number of independent sibling brokers the server consulted (verify mode). */
  verifySources: number
  /** How many of the returned bars the server tagged verified:true. */
  verifiedCount: number
  /** verifiedCount / returned bars (0..1). 0 when nothing cross-verified. */
  verifiedRatio: number
}

const BASE = "/api"

interface CandleResponse {
  ok: boolean
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; timeframe?: number }>
  source?: string
  error?: string
  /** Which live leg fed the series: "extension" | "studio" | null (EO source only). */
  feed?: string | null
  /** T6 — the selectable source set for the dropdown (additive). */
  availableSources?: AvailableSource[]
  /** SERVED bar resolution (post broker.resolveTimeframe) — the honest tag. */
  timeframe?: number
  /** Requested resolution, kept for the mismatch warning. */
  requestedTimeframe?: number
  /** True when the served resolution differs from the requested one. */
  resolved?: boolean
  /** Number of independent sibling brokers that served the same (verified) data. */
  verifySources?: number
  /** How many of the returned bars are tagged verified:true. */
  verifiedCount?: number
  /** verifiedCount / returned bars (0..1). */
  verifiedRatio?: number
}

export async function fetchCandles(assetId: string, timeframe: Timeframe, count: number, source: string = "auto", verify: boolean = false): Promise<{ rows: CandleDatum[]; source: string | null; feed: string | null; resolvedTimeframe: number | null; resolved: boolean; availableSources: AvailableSource[]; verifySources: number; verifiedCount: number; verifiedRatio: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}/trading/candles`, {
    method: "POST",
    headers,
    body: JSON.stringify({ assetId, timeframe, count, source, verify })
  })
  if (!res.ok) {
    const j = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(j?.error ?? `candles request failed (${res.status})`)
  }
  const data = await res.json() as CandleResponse
  if (!data.ok) throw new Error(data.error ?? "candles fetch failed")
  const rows = data.candles
    .filter((c) => typeof c.open === "number" && typeof c.high === "number" && typeof c.low === "number" && typeof c.close === "number" && c.open > 0 && c.close > 0)
    .map((c) => ({
      time: c.time as unknown as import("lightweight-charts").Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }))
  // Trust the SERVER's served-resolution tag (data.timeframe) — that is the
  // broker-resolved, honest bar size the UI must display. Falls back to the
  // request only when the server omits a tag entirely.
  const served = typeof data.timeframe === "number" && data.timeframe > 0
    ? data.timeframe
    : (data.candles[0]?.timeframe ?? timeframe)
  return { rows, source: data.source ?? null, feed: data.feed ?? null, resolvedTimeframe: served, resolved: data.resolved === true || served !== timeframe, availableSources: data.availableSources ?? [], verifySources: data.verifySources ?? 0, verifiedCount: data.verifiedCount ?? 0, verifiedRatio: data.verifiedRatio ?? 0 }
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

export function useCandleData({ assetId, timeframe: initialTf = 60, count = 240, source: initialSource = "auto" }: UseCandleDataOpts): UseCandleDataResult {
  const [candles, setCandles] = useState<CandleDatum[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [lastPrice, setLastPrice] = useState<number | null>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTf)
  // T6 — two distinct source signals:
  //   pinned  — the user's dropdown choice ("auto" = best/ideal fan-in default)
  //   served  — the slug the SERVER actually served (the honest label)
  const [pinned, setPinned] = useState<string>(initialSource)
  const [served, setServed] = useState<string | null>(null)
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>([])
  const [feed, setFeed] = useState<string | null>(null)
  const [resolvedTimeframe, setResolvedTimeframe] = useState<number | null>(null)
  const [resolved, setResolved] = useState(false)
  // Cross-source verification tags (server `verify:true` mode). Zero by default
  // — honest (unconfigured ≠ verified), so the chart can show a neutral/absent
  // badge until the server actually reports an agreement.
  const [verifySources, setVerifySources] = useState(0)
  const [verifiedCount, setVerifiedCount] = useState(0)
  const [verifiedRatio, setVerifiedRatio] = useState(0)
  const candlesRef = useRef<CandleDatum[]>([])

  // Allow a PARENT to drive the timeframe (Slice C — multi-timeframe). When the
  // `timeframe` arg changes externally, resync the internal state so the fetch
  // and the tick-bucketing effect rerun. Unchanged behavior when nothing passes
  // a different value.
  useEffect(() => { setTimeframe(initialTf) }, [initialTf])

  // T6 — allow a PARENT to drive the pinned source too (dropdown lives in the
  // chart, but nothing stops an outer component passing a default).
  useEffect(() => { setPinned(initialSource) }, [initialSource])

  // Fetch initial candle data
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fetchCandles(assetId, timeframe, count, pinned, true)
      .then(({ rows, source: src, feed: fd, resolvedTimeframe: rtf, resolved: isResolved, availableSources: avail, verifySources, verifiedCount, verifiedRatio }) => {
        if (!alive) return
        candlesRef.current = rows
        setCandles(rows)
        setServed(src)
        setFeed(fd)
        setResolvedTimeframe(rtf)
        setResolved(isResolved)
        setAvailableSources(avail.length ? avail : [])
        setVerifySources(verifySources)
        setVerifiedCount(verifiedCount)
        setVerifiedRatio(verifiedRatio)
        if (rows.length > 0) setLastPrice(rows[rows.length - 1].close)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { alive = false }
  }, [assetId, timeframe, count, pinned])

  // Subscribe to the SHARED realtime tick bus (T8): every chart rides the one
  // /api/trading/realtime connection the suite already opens, refcounted by
  // assetId — the connection closes only when the last consumer leaves.
  // `useRealtimeSuite` also reports transport health: a dropped stream flips
  // streamError on for every chart and heals it on reconnect.
  const { error: streamStatusError } = useRealtimeSuite()
  useEffect(() => { setStreamError(streamStatusError) }, [streamStatusError])

  useEffect(() => {
    // `timeframe` and `resolvedTimeframe` drive tick bucketing, so they are
    // dependencies on purpose: after a switch the current candle must be
    // bucketed at the new resolution, and the coarse-series guard must follow.
    const unsubscribe = subscribeTicks(assetId, (tick) => {
      if (typeof tick.price !== "number" || tick.price <= 0) return
      setLastPrice(tick.price)
      const tfSec = timeframe
      // Mixed-resolution guard: when the base series is a coarser
      // fallback (e.g. Yahoo daily bars), minute ticks must NOT
      // append buckets onto it — only the live price updates.
      const rtf = resolvedTimeframe ?? tfSec
      const bucket = Math.floor(tick.ts / 1000 / tfSec) * tfSec
      if (!(rtf > tfSec * 4)) {
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
      } else {
        // Coarse series — keep the displayed candle's close in
        // sync with the live price without mutating history.
        setCandles((prev) => {
          if (!prev.length) return prev
          const next = [...prev]
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, close: tick.price, high: Math.max(last.high, tick.price), low: Math.min(last.low, tick.price) }
          return next
        })
      }
    })
    return unsubscribe
  }, [assetId, count, timeframe, resolvedTimeframe])

  const volumes = computeVolumes(candles)
  const ema20 = computeEma(candles, 20)
  const ema50 = computeEma(candles, 50)
  const { tenkan, kijun, senkouA, senkouB } = useMemo(() => computeIchimoku(candles), [candles])
  const { kcUpper, kcMiddle, kcLower } = useMemo(() => computeKeltner(candles), [candles])

  // T10 — SMA / Bollinger / RSI / MACD via the client-side indicators lib,
  // mirroring the server indicators.mjs formulas so the overlays and the
  // dashboard panel always agree.
  const sma20 = useMemo(() => sma(candles, 20), [candles])
  const bb = useMemo(() => bollinger(candles, { period: 20 }), [candles])
  const rsiLine = useMemo(() => rsi(candles, 14), [candles])
  const macdSeries = useMemo(() => macd(candles), [candles])

  const handleSetTimeframe = useCallback((tf: Timeframe) => {
    setTimeframe(tf)
  }, [])

  const handleSetSource = useCallback((slug: string) => {
    setPinned(slug)
  }, [])

  return {
    candles, volumes, ema20, ema50, tenkan, kijun, senkouA, senkouB, kcUpper, kcMiddle, kcLower,
    sma20,
    bbUpper: bb.upper, bbMid: bb.mid, bbLower: bb.lower,
    rsiLine,
    macdLine: macdSeries.line, macdSignal: macdSeries.signal, macdHist: macdSeries.hist,
    loading, error, streamError, lastPrice, timeframe, setTimeframe: handleSetTimeframe, source: served, pinnedSource: pinned, availableSources, setSource: handleSetSource, feed, resolvedTimeframe, resolved, verifySources, verifiedCount, verifiedRatio
  }
}
