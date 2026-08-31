import { useEffect, useRef, useCallback, useMemo, memo } from "react"
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, ColorType } from "lightweight-charts"
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, CandlestickData, HistogramData, Time, DeepPartial, TimeChartOptions, IPriceLine, SeriesMarker } from "lightweight-charts"

export interface CandleDatum {
  time: Time
  open: number
  high: number
  low: number
  close: number
}

export interface VolumeDatum {
  time: Time
  value: number
  color?: string
}

export interface EmaDatum {
  time: Time
  value: number
}

export interface PriceLine {
  price: number
  color: string
  title: string
  dashed?: boolean
}

/** T7 — U4FA advisory decision markers (mapped by lib/u4faOverlay). */
export interface U4faMarker {
  time: Time
  position: "aboveBar" | "belowBar"
  shape: "arrowUp" | "arrowDown" | "circle"
  color: string
  text: string
}

interface CandlestickChartProps {
  candles: CandleDatum[]
  volumes?: VolumeDatum[]
  ema20?: EmaDatum[]
  ema50?: EmaDatum[]
  tenkan?: EmaDatum[]
  kijun?: EmaDatum[]
  senkouA?: EmaDatum[]
  senkouB?: EmaDatum[]
  kcUpper?: EmaDatum[]
  kcMiddle?: EmaDatum[]
  kcLower?: EmaDatum[]
  /** Ideal buy/sell levels drawn as horizontal price lines. */
  priceLines?: PriceLine[]
  /** T7 — U4FA advisory decision markers drawn on the candle series. */
  u4faMarkers?: U4faMarker[]
  height?: number
  onCrosshair?: (data: { time: Time; open: number; high: number; low: number; close: number } | null) => void
  autoScroll?: boolean
}

const THEME: DeepPartial<TimeChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: "transparent" },
    textColor: "#9aa0c0",
    fontSize: 11,
    fontFamily: "inherit"
  },
  grid: {
    vertLines: { color: "rgba(42, 42, 74, 0.5)" },
    horzLines: { color: "rgba(42, 42, 74, 0.5)" }
  },
  crosshair: {
    mode: 0,
    vertLine: { color: "rgba(108, 99, 255, 0.4)", width: 1, style: 2, labelBackgroundColor: "#6c63ff" },
    horzLine: { color: "rgba(108, 99, 255, 0.4)", width: 1, style: 2, labelBackgroundColor: "#6c63ff" }
  },
  rightPriceScale: {
    borderColor: "#2a2a4a",
    scaleMargins: { top: 0.1, bottom: 0.25 }
  },
  timeScale: {
    borderColor: "#2a2a4a",
    timeVisible: true,
    secondsVisible: false
  }
}

/**
 * lightweight-charts requires STRICTLY ascending, unique timestamps — equal
 * times throw "data must be asc ordered by time" and kill the chart (seen in
 * picc-errors.log with duplicated Yahoo daily bars). Sort AND dedupe every
 * series; the newest row wins for duplicate timestamps.
 */
function toSec(t: Time): number {
  return typeof t === "number" ? t : new Date(t as string).getTime() / 1000
}

function sanitizeSeries<T extends { time: Time }>(rows: T[] | undefined): T[] {
  if (!rows?.length) return []
  const byTime = new Map<number, T>()
  for (const row of rows) {
    const sec = toSec(row.time)
    if (!Number.isFinite(sec)) continue
    byTime.set(sec, row) // later rows overwrite earlier duplicates
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}

function CandlestickChartInner({
  candles,
  volumes,
  ema20,
  ema50,
  tenkan,
  kijun,
  senkouA,
  senkouB,
  kcUpper,
  kcMiddle,
  kcLower,
  priceLines,
  u4faMarkers,
  height = 360,
  onCrosshair,
  autoScroll = true
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null)
  const ema20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const ema50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const tenkanSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const kijunSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const senkouASeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const senkouBSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const kcUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const kcMiddleSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const kcLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const priceLineRefs = useRef<IPriceLine[]>([])
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const onCrosshairRef = useRef(onCrosshair)
  onCrosshairRef.current = onCrosshair

  // Sanitize once per render pass — every series below consumes sorted output.
  const safeCandles = useMemo(() => sanitizeSeries(candles), [candles])
  const safeVolumes = useMemo(() => sanitizeSeries(volumes), [volumes])
  const safeEma20 = useMemo(() => sanitizeSeries(ema20), [ema20])
  const safeEma50 = useMemo(() => sanitizeSeries(ema50), [ema50])
  const safeTenkan = useMemo(() => sanitizeSeries(tenkan), [tenkan])
  const safeKijun = useMemo(() => sanitizeSeries(kijun), [kijun])
  const safeSenkouA = useMemo(() => sanitizeSeries(senkouA), [senkouA])
  const safeSenkouB = useMemo(() => sanitizeSeries(senkouB), [senkouB])
  const safeKcUpper = useMemo(() => sanitizeSeries(kcUpper), [kcUpper])
  const safeKcMiddle = useMemo(() => sanitizeSeries(kcMiddle), [kcMiddle])
  const safeKcLower = useMemo(() => sanitizeSeries(kcLower), [kcLower])
  // Markers: same ascending/unique treatment (newest row wins a duplicate time),
  // matching the candle series contract setMarkers requires.
  const safeU4faMarkers = useMemo(() => {
    if (!u4faMarkers?.length) return []
    const byTime = new Map<number, U4faMarker>()
    for (const m of u4faMarkers) {
      const sec = toSec(m.time)
      if (!Number.isFinite(sec)) continue
      byTime.set(sec, m)
    }
    return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  }, [u4faMarkers])

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      ...THEME,
      width: containerRef.current.clientWidth,
      height,
      autoSize: false
    })

    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#4ade80",
      downColor: "#ff6b6b",
      borderUpColor: "#4ade80",
      borderDownColor: "#ff6b6b",
      wickUpColor: "#4ade80",
      wickDownColor: "#ff6b6b",
      borderVisible: true,
      wickVisible: true
    })

    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume"
    })
    vs.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }
    })

    const e20 = chart.addSeries(LineSeries, {
      color: "#4ade80",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    })

    const e50 = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    })

    const tk = chart.addSeries(LineSeries, {
      color: "#06b6d4", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    })
    const kj = chart.addSeries(LineSeries, {
      color: "#a855f7", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    })
    const sA = chart.addSeries(LineSeries, {
      color: "rgba(74, 222, 128, 0.35)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    })
    const sB = chart.addSeries(LineSeries, {
      color: "rgba(255, 107, 107, 0.35)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    })
    const ku = chart.addSeries(LineSeries, {
      color: "rgba(236, 72, 153, 0.5)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    })
    const kl = chart.addSeries(LineSeries, {
      color: "rgba(236, 72, 153, 0.5)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    })
    const km = chart.addSeries(LineSeries, {
      color: "rgba(236, 72, 153, 0.8)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    })

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        onCrosshairRef.current?.(null)
        return
      }
      const data = param.seriesData.get(cs) as CandlestickData | undefined
      if (data && "open" in data) {
        onCrosshairRef.current?.({
          time: param.time,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close
        })
      }
    })

    chartRef.current = chart
    candleSeriesRef.current = cs
    // T7 — lightweight-charts v5 marker plugin (series.setMarkers is gone).
    markersPluginRef.current = createSeriesMarkers(cs)
    volumeSeriesRef.current = vs
    ema20SeriesRef.current = e20
    ema50SeriesRef.current = e50
    tenkanSeriesRef.current = tk
    kijunSeriesRef.current = kj
    senkouASeriesRef.current = sA
    senkouBSeriesRef.current = sB
    kcUpperSeriesRef.current = ku
    kcMiddleSeriesRef.current = km
    kcLowerSeriesRef.current = kl

    return () => {
      priceLineRefs.current = []
      try { markersPluginRef.current?.detach() } catch { /* plugin already gone */ }
      markersPluginRef.current = null
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      ema20SeriesRef.current = null
      ema50SeriesRef.current = null
      tenkanSeriesRef.current = null
      kijunSeriesRef.current = null
      senkouASeriesRef.current = null
      senkouBSeriesRef.current = null
      kcUpperSeriesRef.current = null
      kcMiddleSeriesRef.current = null
      kcLowerSeriesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only create chart once on mount

  // Keep the fixed-size option in sync with prop changes (autoSize is off).
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height, width: containerRef.current?.clientWidth })
    }
  }, [height])

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || !safeCandles.length) return
    candleSeriesRef.current.setData(safeCandles as unknown as CandlestickData[])
    if (autoScroll) {
      chartRef.current?.timeScale().scrollToRealTime()
    }
  }, [safeCandles, autoScroll])

  // Update volume data
  useEffect(() => {
    if (!volumeSeriesRef.current) return
    volumeSeriesRef.current.setData(safeVolumes as unknown as HistogramData[])
  }, [safeVolumes])

  // Update overlay line series
  useEffect(() => {
    if (ema20SeriesRef.current && safeEma20.length) ema20SeriesRef.current.setData(safeEma20 as never[])
    if (ema50SeriesRef.current && safeEma50.length) ema50SeriesRef.current.setData(safeEma50 as never[])
    if (tenkanSeriesRef.current && safeTenkan.length) tenkanSeriesRef.current.setData(safeTenkan as never[])
    if (kijunSeriesRef.current && safeKijun.length) kijunSeriesRef.current.setData(safeKijun as never[])
    if (senkouASeriesRef.current && safeSenkouA.length) senkouASeriesRef.current.setData(safeSenkouA as never[])
    if (senkouBSeriesRef.current && safeSenkouB.length) senkouBSeriesRef.current.setData(safeSenkouB as never[])
    if (kcUpperSeriesRef.current && safeKcUpper.length) kcUpperSeriesRef.current.setData(safeKcUpper as never[])
    if (kcMiddleSeriesRef.current && safeKcMiddle.length) kcMiddleSeriesRef.current.setData(safeKcMiddle as never[])
    if (kcLowerSeriesRef.current && safeKcLower.length) kcLowerSeriesRef.current.setData(safeKcLower as never[])
  }, [safeEma20, safeEma50, safeTenkan, safeKijun, safeSenkouA, safeSenkouB, safeKcUpper, safeKcMiddle, safeKcLower])

  // Ideal buy/sell level price lines — recreated whenever the set changes.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return
    for (const line of priceLineRefs.current) {
      try { series.removePriceLine(line) } catch { /* series already detached */ }
    }
    priceLineRefs.current = []
    for (const pl of priceLines ?? []) {
      if (!Number.isFinite(pl.price) || pl.price <= 0) continue
      try {
        priceLineRefs.current.push(
          series.createPriceLine({
            price: pl.price,
            color: pl.color,
            lineWidth: 1,
            lineStyle: pl.dashed === false ? 0 : 2,
            axisLabelVisible: true,
            title: pl.title
          })
        )
      } catch { /* skip malformed line */ }
    }
  }, [priceLines])

  const refFn = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
  }, [])

  // T7 — U4FA advisory markers on the candle series (decision points only).
  useEffect(() => {
    const plugin = markersPluginRef.current
    if (!plugin) return
    if (!safeU4faMarkers.length) {
      plugin.setMarkers([])
      return
    }
    try {
      plugin.setMarkers(safeU4faMarkers as unknown as SeriesMarker<Time>[])
    } catch {
      /* malformed marker input must never kill the chart */
    }
  }, [safeU4faMarkers])

  return (
    <div
      ref={refFn}
      style={{ width: "100%", height, borderRadius: 4, overflow: "hidden" }}
    />
  )
}

export const CandlestickChart = memo(CandlestickChartInner)
