import { useEffect, useRef, useCallback, memo } from "react"
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType } from "lightweight-charts"
import type { IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, DeepPartial, TimeChartOptions } from "lightweight-charts"

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
  const onCrosshairRef = useRef(onCrosshair)
  onCrosshairRef.current = onCrosshair

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      ...THEME,
      width: containerRef.current.clientWidth,
      height,
      autoSize: true
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
  }, []) // Only create chart once on mount

  // Apply height changes without recreating the chart
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height })
    }
  }, [height])

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return
    const sorted = [...candles].sort((a, b) => {
      const ta = typeof a.time === "number" ? a.time : new Date(a.time as string).getTime() / 1000
      const tb = typeof b.time === "number" ? b.time : new Date(b.time as string).getTime() / 1000
      return ta - tb
    })
    candleSeriesRef.current.setData(sorted as CandlestickData[])
    if (autoScroll) {
      chartRef.current?.timeScale().scrollToRealTime()
    }
  }, [candles, autoScroll])

  // Update volume data
  useEffect(() => {
    if (!volumeSeriesRef.current || !volumes?.length) return
    const sorted = [...volumes].sort((a, b) => {
      const ta = typeof a.time === "number" ? a.time : new Date(a.time as string).getTime() / 1000
      const tb = typeof b.time === "number" ? b.time : new Date(b.time as string).getTime() / 1000
      return ta - tb
    })
    volumeSeriesRef.current.setData(sorted as HistogramData[])
  }, [volumes])

  // Update EMA lines
  useEffect(() => {
    if (ema20SeriesRef.current && ema20?.length) {
      ema20SeriesRef.current.setData(ema20 as never[])
    }
  }, [ema20])

  useEffect(() => {
    if (ema50SeriesRef.current && ema50?.length) {
      ema50SeriesRef.current.setData(ema50 as never[])
    }
  }, [ema50])

  useEffect(() => { if (tenkanSeriesRef.current && tenkan?.length) tenkanSeriesRef.current.setData(tenkan as never[]) }, [tenkan])
  useEffect(() => { if (kijunSeriesRef.current && kijun?.length) kijunSeriesRef.current.setData(kijun as never[]) }, [kijun])
  useEffect(() => { if (senkouASeriesRef.current && senkouA?.length) senkouASeriesRef.current.setData(senkouA as never[]) }, [senkouA])
  useEffect(() => { if (senkouBSeriesRef.current && senkouB?.length) senkouBSeriesRef.current.setData(senkouB as never[]) }, [senkouB])
  useEffect(() => { if (kcUpperSeriesRef.current && kcUpper?.length) kcUpperSeriesRef.current.setData(kcUpper as never[]) }, [kcUpper])
  useEffect(() => { if (kcMiddleSeriesRef.current && kcMiddle?.length) kcMiddleSeriesRef.current.setData(kcMiddle as never[]) }, [kcMiddle])
  useEffect(() => { if (kcLowerSeriesRef.current && kcLower?.length) kcLowerSeriesRef.current.setData(kcLower as never[]) }, [kcLower])

  const refFn = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
  }, [])

  return (
    <div
      ref={refFn}
      style={{ width: "100%", height, borderRadius: 4, overflow: "hidden" }}
    />
  )
}

export const CandlestickChart = memo(CandlestickChartInner)
