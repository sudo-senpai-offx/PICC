import { useState } from "react"
import { Badge, Button } from "@/components/ui"
import { CandlestickChart } from "@/components/CandlestickChart"
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary"
import { useCandleData, TIMEFRAME_LABELS, type Timeframe } from "@/hooks/useCandleData"

const TIMEFRAMES: Timeframe[] = [60, 300, 900, 3600]

interface TradingChartProps {
  assetId: string
  label?: string
  height?: number
  onCrosshair?: (data: { time: import("lightweight-charts").Time; open: number; high: number; low: number; close: number } | null) => void
}

function fmtPrice(n: number | null): string {
  if (n == null) return "—"
  return n < 10 ? n.toFixed(4) : n < 1000 ? n.toFixed(2) : n.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

export function TradingChart({ assetId, label, height = 380, onCrosshair }: TradingChartProps) {
  const { candles, volumes, ema20, ema50, tenkan, kijun, senkouA, senkouB, kcUpper, kcMiddle, kcLower, loading, error, streamError, lastPrice, timeframe, setTimeframe } = useCandleData({
    assetId,
    timeframe: 300
  })
  const [hover, setHover] = useState<{ open: number; high: number; low: number; close: number } | null>(null)
  const [showIchimoku, setShowIchimoku] = useState(false)
  const [showKeltner, setShowKeltner] = useState(false)

  const crosshair = (data: { time: import("lightweight-charts").Time; open: number; high: number; low: number; close: number } | null) => {
    setHover(data)
    onCrosshair?.(data)
  }

  const display = hover ?? (candles.length > 0 ? candles[candles.length - 1] : null)
  const change = display ? display.close - display.open : 0
  const changePct = display && display.open ? (change / display.open) * 100 : 0
  const isUp = change >= 0

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row-between" style={{ alignItems: "center" }}>
        <div className="row gap" style={{ alignItems: "center" }}>
          <strong>{label ?? assetId}</strong>
          {lastPrice != null ? (
            <span className="stat-value" style={{ fontSize: "1rem" }}>
              {fmtPrice(lastPrice)}
            </span>
          ) : null}
          {display ? (
            <Badge tone={isUp ? "success" : "danger"}>
              {isUp ? "+" : ""}{change.toFixed(4)} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
            </Badge>
          ) : null}
          {streamError ? <Badge tone="warn">stream offline — retrying</Badge> : null}
        </div>
        <div className="row gap" style={{ alignItems: "center" }}>
          {display ? (
            <div className="muted small" style={{ marginRight: 8 }}>
              O {fmtPrice(display.open)} H {fmtPrice(display.high)} L {fmtPrice(display.low)} C {fmtPrice(display.close)}
            </div>
          ) : null}
          {TIMEFRAMES.map((tf) => (
            <Button
              key={tf}
              variant={tf === timeframe ? "primary" : "ghost"}
              className="btn-sm"
              onClick={() => setTimeframe(tf)}
            >
              {TIMEFRAME_LABELS[tf]}
            </Button>
          ))}
        </div>
      </div>

      {loading && !candles.length ? (
        <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }} className="muted">
          Loading chart data...
        </div>
      ) : error ? (
        <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }} className="danger-text">
          {error}
        </div>
      ) : (
        <ChartErrorBoundary>
          <CandlestickChart
            candles={candles}
            volumes={volumes}
            ema20={ema20}
            ema50={ema50}
            tenkan={showIchimoku ? tenkan : undefined}
            kijun={showIchimoku ? kijun : undefined}
            senkouA={showIchimoku ? senkouA : undefined}
            senkouB={showIchimoku ? senkouB : undefined}
            kcUpper={showKeltner ? kcUpper : undefined}
            kcMiddle={showKeltner ? kcMiddle : undefined}
            kcLower={showKeltner ? kcLower : undefined}
            height={height}
            onCrosshair={crosshair}
            autoScroll
          />
        </ChartErrorBoundary>
      )}

      <div className="row gap" style={{ alignItems: "center", paddingLeft: 4 }}>
        <span className="muted small" style={{ color: "#e2e8f0" }}>Price</span>
        <span className="muted small" style={{ color: "#4ade80" }}>EMA20</span>
        <span className="muted small" style={{ color: "#f59e0b" }}>EMA50</span>
        <button
          onClick={() => setShowIchimoku(!showIchimoku)}
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showIchimoku ? "rgba(6, 182, 212, 0.3)" : "transparent",
            color: showIchimoku ? "#06b6d4" : "var(--text-muted)"
          }}
        >
          Ichimoku
        </button>
        <button
          onClick={() => setShowKeltner(!showKeltner)}
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showKeltner ? "rgba(236, 72, 153, 0.3)" : "transparent",
            color: showKeltner ? "#ec4899" : "var(--text-muted)"
          }}
        >
          Keltner
        </button>
      </div>
    </div>
  )
}
