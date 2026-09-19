import { useEffect, useRef, useCallback, useMemo, memo } from "react"
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, ColorType } from "lightweight-charts"
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, CandlestickData, HistogramData, Time, DeepPartial, TimeChartOptions, IPriceLine, SeriesMarker, LineSeriesOptions, HistogramSeriesOptions } from "lightweight-charts"
import { activePaneKeys } from "@/lib/chartOverlays"

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
  /** T10 — SMA(20) overlay (shown when showSma). */
  sma20?: EmaDatum[]
  /** T10 — Bollinger bands (20, 2σ), shown when showBollinger. */
  bbUpper?: EmaDatum[]
  bbMid?: EmaDatum[]
  bbLower?: EmaDatum[]
  /** T10 — RSI(14) / MACD (12/26/9) secondary-pane series. */
  rsiLine?: EmaDatum[]
  macdLine?: EmaDatum[]
  macdSignal?: EmaDatum[]
  macdHist?: EmaDatum[]
  /** T10 — overlay toggles. Volume and SMA default on (keeps the pre-T10 look). */
  showVolume?: boolean
  showSma?: boolean
  showBollinger?: boolean
  showRsi?: boolean
  showMacd?: boolean
  /** Ideal buy/sell levels drawn as horizontal price lines. */
  priceLines?: PriceLine[]
  /** T7 — U4FA advisory decision markers drawn on the candle series. */
  u4faMarkers?: U4faMarker[]
  height?: number
  onCrosshair?: (data: { time: Time; open: number; high: number; low: number; close: number } | null) => void
  autoScroll?: boolean
  /**
   * Fired when the user drags or zooms the time axis away from real-time,
   * so the parent can disable autoScroll (stop snapping back to the present
   * on every tick) until the user explicitly recenters.
   */
  onUserScroll?: () => void
  /**
   * Multi-timeframe overlay: a higher-timeframe close line plotted over the
   * active candle series, so the chart itself shows more than one timeframe
   * at once instead of a separate duplicate widget. Toggled via showHtf.
   */
  htfLine?: EmaDatum[]
  showHtf?: boolean
}

const THEME: DeepPartial<TimeChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: "transparent" },
    textColor: "var(--text-muted)",
    fontSize: 11,
    fontFamily: "inherit"
  },
  grid: {
    vertLines: { color: "rgba(42, 42, 74, 0.5)" },
    horzLines: { color: "rgba(42, 42, 74, 0.5)" }
  },
  crosshair: {
    mode: 0,
    vertLine: { color: "rgba(108, 99, 255, 0.4)", width: 1, style: 2, labelBackgroundColor: "var(--accent)" },
    horzLine: { color: "rgba(108, 99, 255, 0.4)", width: 1, style: 2, labelBackgroundColor: "var(--accent)" }
  },
  rightPriceScale: {
    borderColor: "var(--border)",
    scaleMargins: { top: 0.1, bottom: 0.25 }
  },
  timeScale: {
    borderColor: "var(--border)",
    timeVisible: true,
    secondsVisible: false
  }
}

// T10 — RSI/MACD secondary pane series options, mirroring the specs in
// lib/chartOverlays.ts (single source of truth lives there; these are the
// concrete v5 options the chart passes to addSeries).
// token-exempt: indicator-series hue (RSI violet)
const RSI_LINE_OPTIONS: DeepPartial<LineSeriesOptions> = { color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
// token-exempt: indicator-series hue (MACD line green)
const MACD_LINE_OPTIONS: DeepPartial<LineSeriesOptions> = { color: "#4ade80", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
// token-exempt: indicator-series hue (MACD signal amber)
const MACD_SIGNAL_OPTIONS: DeepPartial<LineSeriesOptions> = { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
const MACD_HIST_OPTIONS: DeepPartial<HistogramSeriesOptions> = { color: "rgba(108, 99, 255, 0.35)", priceLineVisible: false, lastValueVisible: false }

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
  sma20,
  bbUpper,
  bbMid,
  bbLower,
  rsiLine,
  macdLine,
  macdSignal,
  macdHist,
  showVolume = true,
  showSma = false,
  showBollinger = false,
  showRsi = false,
  showMacd = false,
  priceLines,
  u4faMarkers,
  height = 360,
  onCrosshair,
  autoScroll = true,
  onUserScroll,
  htfLine,
  showHtf = false
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
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const bbUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const bbMidSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const bbLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const htfSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  // T10 — RSI/MACD secondary pane: created lazily on first enable (each toggle
  // ADDS its series), torn down with chart.removeSeries + chart.removePane
  // when the last one turns off (each toggle REMOVES its series).
  const paneIndexRef = useRef<number | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null)
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null)
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null)
  const priceLineRefs = useRef<IPriceLine[]>([])
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const onCrosshairRef = useRef(onCrosshair)
  onCrosshairRef.current = onCrosshair
  const onUserScrollRef = useRef(onUserScroll)
  onUserScrollRef.current = onUserScroll

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
  const safeSma20 = useMemo(() => sanitizeSeries(sma20), [sma20])
  const safeBbUpper = useMemo(() => sanitizeSeries(bbUpper), [bbUpper])
  const safeBbMid = useMemo(() => sanitizeSeries(bbMid), [bbMid])
  const safeBbLower = useMemo(() => sanitizeSeries(bbLower), [bbLower])
  const safeHtfLine = useMemo(() => sanitizeSeries(htfLine), [htfLine])
  const safeRsiLine = useMemo(() => sanitizeSeries(rsiLine), [rsiLine])
  const safeMacdLine = useMemo(() => sanitizeSeries(macdLine), [macdLine])
  const safeMacdSignal = useMemo(() => sanitizeSeries(macdSignal), [macdSignal])
  const safeMacdHist = useMemo(() => sanitizeSeries(macdHist), [macdHist])
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
      upColor: "var(--gain)",
      downColor: "var(--loss)",
      borderUpColor: "var(--gain)",
      borderDownColor: "var(--loss)",
      wickUpColor: "var(--gain)",
      wickDownColor: "var(--loss)",
      borderVisible: true,
      wickVisible: true
    })

    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      visible: showVolume
    })
    vs.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }
    })

    const e20 = chart.addSeries(LineSeries, {
      // token-exempt: indicator-series hue (EMA20 green)
      color: "#4ade80",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    })

    const e50 = chart.addSeries(LineSeries, {
      // token-exempt: indicator-series hue (EMA50 amber)
      color: "#f59e0b",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    })

    const tk = chart.addSeries(LineSeries, {
      // token-exempt: indicator-series hue (Ichimoku cloud cyan)
      color: "#06b6d4", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    })
    const kj = chart.addSeries(LineSeries, {
      // token-exempt: indicator-series hue (Keltner purple)
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

    // T10 — SMA(20) + Bollinger (20, 2σ): always created, visibility-gated.
    const sm20 = chart.addSeries(LineSeries, {
      // token-exempt: indicator-series hue (SMA20 sky)
      color: "#38bdf8", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: showSma
    })
    const bu = chart.addSeries(LineSeries, {
      color: "rgba(250, 204, 21, 0.35)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: showBollinger
    })
    const bm = chart.addSeries(LineSeries, {
      color: "rgba(250, 204, 21, 0.8)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: showBollinger
    })
    const bl = chart.addSeries(LineSeries, {
      color: "rgba(250, 204, 21, 0.35)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: showBollinger
    })

    // MTF overlay — a higher-timeframe close line (e.g. 4h/1D) plotted over the
    // active candle series so the chart itself shows multiple timeframes.
    const htf = chart.addSeries(LineSeries, {
      // token-exempt: indicator-series hue (HTF close line indigo)
      color: "#818cf8", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 0, visible: showHtf
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

    // AutoScroll trip-wire: when the user drags the time axis so the newest
    // candle is no longer visible (right edge < latest bar), tell the parent to
    // suppress the per-tick snap-to-present — otherwise past browsing is
    // destroyed while live ticks keep self-scrolling. Recentering via
    // scrollToRealTime puts the latest bar back in view (to == latest), so this
    // does NOT re-fire; the parent's "recent" button flips autoScroll back on.
    chart
      .timeScale()
      .subscribeVisibleLogicalRangeChange?.((_range) => {
        if (!_range || !candles.length) return
        const latestIdx = candles.length - 1
        if (_range.to < latestIdx) onUserScrollRef.current?.()
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
    sma20SeriesRef.current = sm20
    bbUpperSeriesRef.current = bu
    bbMidSeriesRef.current = bm
    bbLowerSeriesRef.current = bl
    htfSeriesRef.current = htf

    return () => {
      priceLineRefs.current = []
      try { markersPluginRef.current?.detach() } catch { /* plugin already gone */ }
      markersPluginRef.current = null
      // T10 — pane refs die with the chart; the chart's own remove() drops the
      // pane and its series. Leave the refs null so a remount starts clean.
      paneIndexRef.current = null
      rsiSeriesRef.current = null
      macdLineRef.current = null
      macdSignalRef.current = null
      macdHistRef.current = null
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
      sma20SeriesRef.current = null
      bbUpperSeriesRef.current = null
      bbMidSeriesRef.current = null
      bbLowerSeriesRef.current = null
      htfSeriesRef.current = null
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
    if (sma20SeriesRef.current && safeSma20.length) sma20SeriesRef.current.setData(safeSma20 as never[])
    if (bbUpperSeriesRef.current && safeBbUpper.length) bbUpperSeriesRef.current.setData(safeBbUpper as never[])
    if (bbMidSeriesRef.current && safeBbMid.length) bbMidSeriesRef.current.setData(safeBbMid as never[])
    if (bbLowerSeriesRef.current && safeBbLower.length) bbLowerSeriesRef.current.setData(safeBbLower as never[])
    if (htfSeriesRef.current && safeHtfLine.length) htfSeriesRef.current.setData(safeHtfLine as never[])
  }, [safeEma20, safeEma50, safeTenkan, safeKijun, safeSenkouA, safeSenkouB, safeKcUpper, safeKcMiddle, safeKcLower, safeSma20, safeBbUpper, safeBbMid, safeBbLower, safeHtfLine])

  // T10 — main-pane overlay visibility follows the toggles (series are created
  // once on mount; the toggle only flips `visible`, matching the mock-executor
  // contract tested in chartOverlays.test.ts).
  useEffect(() => {
    ema20SeriesRef.current?.applyOptions({ visible: showSma })
    ema50SeriesRef.current?.applyOptions({ visible: showSma })
    sma20SeriesRef.current?.applyOptions({ visible: showSma })
    volumeSeriesRef.current?.applyOptions({ visible: showVolume })
  }, [showSma, showVolume])

  useEffect(() => {
    bbUpperSeriesRef.current?.applyOptions({ visible: showBollinger })
    bbMidSeriesRef.current?.applyOptions({ visible: showBollinger })
    bbLowerSeriesRef.current?.applyOptions({ visible: showBollinger })
  }, [showBollinger])

  useEffect(() => {
    htfSeriesRef.current?.applyOptions({ visible: showHtf })
  }, [showHtf])

  // T10 — RSI/MACD secondary pane lifecycle. Enabling an indicator ADDS its
  // series (plus the pane when none exists); disabling the last one REMOVES
  // the series and the whole pane. Data is refreshed on every pass, so warm-up
  // (empty rows) renders nothing instead of crashing.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const requested = activePaneKeys({ rsi: showRsi, macd: showMacd })
    const mounted = paneIndexRef.current != null
    if (!requested.length) {
      if (mounted) {
        for (const s of [rsiSeriesRef, macdLineRef, macdSignalRef, macdHistRef]) {
          if (s.current) {
            try { chart.removeSeries(s.current) } catch { /* series already gone */ }
            s.current = null
          }
        }
        try { chart.removePane(paneIndexRef.current as number) } catch { /* pane already gone */ }
        paneIndexRef.current = null
      }
      return
    }
    if (!mounted) {
      try {
        paneIndexRef.current = chart.addPane().paneIndex()
      } catch {
        paneIndexRef.current = null
        return
      }
    }
    const pi = paneIndexRef.current as number
    if (requested.includes("rsi") && !rsiSeriesRef.current) {
      rsiSeriesRef.current = chart.addSeries(LineSeries, RSI_LINE_OPTIONS, pi)
    }
    if (requested.includes("macd")) {
      if (!macdLineRef.current) macdLineRef.current = chart.addSeries(LineSeries, MACD_LINE_OPTIONS, pi)
      if (!macdSignalRef.current) macdSignalRef.current = chart.addSeries(LineSeries, MACD_SIGNAL_OPTIONS, pi)
      if (!macdHistRef.current) macdHistRef.current = chart.addSeries(HistogramSeries, MACD_HIST_OPTIONS, pi)
    }
  }, [showRsi, showMacd])

  useEffect(() => {
    if (rsiSeriesRef.current) rsiSeriesRef.current.setData(safeRsiLine as never[])
    if (macdLineRef.current) macdLineRef.current.setData(safeMacdLine as never[])
    if (macdSignalRef.current) macdSignalRef.current.setData(safeMacdSignal as never[])
    if (macdHistRef.current) macdHistRef.current.setData(safeMacdHist as never[])
  }, [safeRsiLine, safeMacdLine, safeMacdSignal, safeMacdHist])

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
