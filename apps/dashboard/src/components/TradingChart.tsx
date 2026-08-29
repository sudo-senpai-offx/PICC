import { useEffect, useMemo, useState } from "react"
import { Badge, Button } from "@/components/ui"
import { CandlestickChart, type PriceLine } from "@/components/CandlestickChart"
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary"
import { useCandleData, TIMEFRAME_LABELS, type Timeframe } from "@/hooks/useCandleData"
import { getEntryLevels, openPaperTrade, type EntryLevelsResult } from "@/lib/trading"

const TIMEFRAMES: Timeframe[] = [5, 15, 30, 60, 300, 900, 1800, 3600, 14400, 86400, 604800, 2592000]

interface TradingChartProps {
  assetId: string
  label?: string
  height?: number
  onCrosshair?: (data: { time: import("lightweight-charts").Time; open: number; high: number; low: number; close: number } | null) => void
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n < 10 ? n.toFixed(4) : n < 1000 ? n.toFixed(2) : n.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

const SOURCE_BADGES: Record<string, { text: string; tone: "success" | "warn" | "muted" }> = {
  live: { text: "EO live", tone: "success" },
  buffer: { text: "EO live", tone: "success" },
  yahoo: { text: "Yahoo daily · delayed", tone: "warn" },
  "yahoo-daily": { text: "Yahoo daily · delayed", tone: "warn" }
}

export function TradingChart({ assetId, label, height = 380, onCrosshair }: TradingChartProps) {
  const {
    candles, volumes, ema20, ema50, tenkan, kijun, senkouA, senkouB, kcUpper, kcMiddle, kcLower,
    loading, error, streamError, lastPrice, timeframe, setTimeframe, source, resolvedTimeframe, resolved
  } = useCandleData({ assetId, timeframe: 300 })
  const [hover, setHover] = useState<{ open: number; high: number; low: number; close: number } | null>(null)
  const [showIchimoku, setShowIchimoku] = useState(false)
  const [showKeltner, setShowKeltner] = useState(false)
  const [showLevels, setShowLevels] = useState(true)
  const [levels, setLevels] = useState<EntryLevelsResult | null>(null)
  // Hover emphasis: which zone the pointer is on ("buy" | "sell" | null) and
  // simulation feedback.
  const [hoverZone, setHoverZone] = useState<"buy" | "sell" | null>(null)
  const [simMsg, setSimMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Ideal buy/sell price points for the active asset + selected timeframe.
  useEffect(() => {
    let alive = true
    setLevels(null)
    getEntryLevels(assetId, timeframe)
      .then((r) => { if (alive) setLevels(r) })
      .catch(() => { /* levels stay hidden — never breaks the chart */ })
    return () => { alive = false }
  }, [assetId, timeframe])

  const crosshair = (data: { time: import("lightweight-charts").Time; open: number; high: number; low: number; close: number } | null) => {
    setHover(data)
    onCrosshair?.(data)
  }

  const priceLines = useMemo<PriceLine[]>(() => {
    if (!showLevels || !levels?.ok) return []
    const lines: PriceLine[] = []
    const zoneLines = (zone: NonNullable<EntryLevelsResult["buyZone"]>, color: string, label: string, emphasized: boolean) => {
      lines.push({ price: zone.anchor, color: emphasized ? "#fbbf24" : color, title: emphasized ? `▶ ${label}` : label })
      lines.push({ price: zone.low, color: emphasized ? "rgba(251,191,36,0.75)" : `${color}66`, title: "" })
      lines.push({ price: zone.high, color: emphasized ? "rgba(251,191,36,0.75)" : `${color}66`, title: "" })
    }
    if (levels.buyZone) zoneLines(levels.buyZone, "#4ade80", `BUY ${levels.buyZone.strength}x`, hoverZone === "buy")
    if (levels.sellZone) zoneLines(levels.sellZone, "#ff6b6b", `SELL ${levels.sellZone.strength}x`, hoverZone === "sell")
    return lines
  }, [showLevels, levels, hoverZone])

  const simulate = async (side: "up" | "down", anchor: number | undefined) => {
    const entry = lastPrice ?? anchor
    if (entry == null) return
    const label = `${side.toUpperCase()} ${assetId} @ ${fmtPrice(entry)}`
    if (!window.confirm(`SIMULATE TRADE (paper only)\n\n${label}\nAmount: $100\n\nOpen this paper position?`)) return
    try {
      const r = await openPaperTrade({ symbol: assetId, side, entry, amount: 100 })
      setSimMsg(r.ok ? { ok: true, text: `Simulated ${label} — open in paper ledger` } : { ok: false, text: "Paper engine rejected the trade" })
    } catch (e) {
      setSimMsg({ ok: false, text: (e as Error).message })
    }
  }

  const display = hover ?? (candles.length > 0 ? candles[candles.length - 1] : null)
  const change = display ? display.close - display.open : 0
  const changePct = display && display.open ? (change / display.open) * 100 : 0
  const isUp = change >= 0
  const sourceBadge = SOURCE_BADGES[source ?? ""] ?? null
  // Honest resolution label: the SERVER decides the bar size (broker
  // resolveTimeframe), never the client's echo of the request. Any mismatch
  // between what the user picked and what the server served triggers the
  // warning — a 5s request that comes back as 1m bars must say so.
  const resolutionMismatch = resolved || (resolvedTimeframe != null && resolvedTimeframe !== timeframe)
  const servedTfLabel = () => {
    if (resolvedTimeframe == null) return null
    return (TIMEFRAME_LABELS as Record<number, string | undefined>)[resolvedTimeframe] ?? `${resolvedTimeframe}s`
  }

  const nearestBuy = levels?.buyZone ? levels.levels?.find((l) => l.price === levels.buyZone?.anchor) ?? null : null
  const nearestSell = levels?.sellZone ? levels.levels?.find((l) => l.price === levels.sellZone?.anchor) ?? null : null

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
          {sourceBadge ? <Badge tone={sourceBadge.tone}>{sourceBadge.text}</Badge> : null}
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

      {resolutionMismatch ? (
        <p className="muted small" style={{ margin: 0 }}>
          ⚠️ No live {TIMEFRAME_LABELS[timeframe]} feed for {assetId} — showing {source === "yahoo" || source === "yahoo-daily" ? "Yahoo DAILY" : `${servedTfLabel() ?? "coarser"} `}bars instead. Levels below are computed from the served resolution.
        </p>
      ) : null}

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
            priceLines={priceLines}
            height={height}
            onCrosshair={crosshair}
            autoScroll
          />
        </ChartErrorBoundary>
      )}

      {showLevels && levels?.ok ? (
        <div className="row gap" style={{ flexWrap: "wrap", paddingLeft: 4, alignItems: "center" }}>
          {nearestBuy ? (
            <span
              onMouseEnter={() => setHoverZone("buy")}
              onMouseLeave={() => setHoverZone(null)}
              style={{ display: "inline-flex", gap: 6, alignItems: "center", borderRadius: 4, padding: "1px 4px", background: hoverZone === "buy" ? "rgba(74,222,128,0.12)" : "transparent" }}
            >
              <Badge tone="success">
                ▼ Buy {fmtPrice(levels!.buyZone!.low)}–{fmtPrice(levels!.buyZone!.high)} ({nearestBuy.distancePct > 0 ? "+" : ""}{nearestBuy.distancePct.toFixed(2)}%)
              </Badge>
              <Button variant="ghost" className="btn-sm" title="Simulate a paper buy at this zone" onClick={() => void simulate("up", levels!.buyZone!.anchor)}>
                ▶ sim
              </Button>
            </span>
          ) : null}
          {nearestSell ? (
            <span
              onMouseEnter={() => setHoverZone("sell")}
              onMouseLeave={() => setHoverZone(null)}
              style={{ display: "inline-flex", gap: 6, alignItems: "center", borderRadius: 4, padding: "1px 4px", background: hoverZone === "sell" ? "rgba(255,107,107,0.10)" : "transparent" }}
            >
              <Badge tone="danger">
                ▲ Sell {fmtPrice(levels!.sellZone!.low)}–{fmtPrice(levels!.sellZone!.high)} ({nearestSell.distancePct > 0 ? "+" : ""}{nearestSell.distancePct.toFixed(2)}%)
              </Badge>
              <Button variant="ghost" className="btn-sm" title="Simulate a paper sell at this zone" onClick={() => void simulate("down", levels!.sellZone!.anchor)}>
                ▶ sim
              </Button>
            </span>
          ) : null}
          {!nearestBuy && !nearestSell ? <span className="muted small">{levels.reason ?? "no near-money levels"}</span> : null}
          {simMsg ? (
            <span className={simMsg.ok ? "muted small" : "danger-text small"}>{simMsg.text}</span>
          ) : null}
        </div>
      ) : null}

      <div className="row gap" style={{ alignItems: "center", paddingLeft: 4 }}>
        <span className="muted small" style={{ color: "#e2e8f0" }}>Price</span>
        <span className="muted small" style={{ color: "#4ade80" }}>EMA20</span>
        <span className="muted small" style={{ color: "#f59e0b" }}>EMA50</span>
        <button
          onClick={() => setShowLevels(!showLevels)}
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showLevels ? "rgba(74, 222, 128, 0.25)" : "transparent",
            color: showLevels ? "#4ade80" : "var(--text-muted)"
          }}
        >
          Buy/Sell Levels
        </button>
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
