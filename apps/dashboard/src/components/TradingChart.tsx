import { useEffect, useMemo, useState } from "react"
import { Badge, Button } from "@/components/ui"
import { CandlestickChart, type EmaDatum, type PriceLine, type U4faMarker } from "@/components/CandlestickChart"
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary"
import { useCandleData, fetchCandles, TIMEFRAME_LABELS, type Timeframe } from "@/hooks/useCandleData"
import { useBrokerCapabilities } from "@/hooks/useBrokerCapabilities"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { getEntryLevels, openPaperTrade, type EntryLevelsResult } from "@/lib/trading"
import { u4faMarkersFor } from "@/lib/u4faOverlay"
import type { LiveEvent, LiveU4faSignal } from "@/lib/liveTrading"

const TIMEFRAMES: Timeframe[] = [5, 15, 30, 60, 300, 900, 1800, 3600, 14400, 86400, 604800, 2592000]

interface TradingChartProps {
  assetId: string
  label?: string
  height?: number
  onCrosshair?: (data: { time: import("lightweight-charts").Time; open: number; high: number; low: number; close: number } | null) => void
  /** Slice C — controlled timeframe (defaults to internal 5m when omitted). */
  timeframe?: Timeframe
  onTimeframeChange?: (tf: Timeframe) => void
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

export function TradingChart({ assetId, label, height = 380, onCrosshair, timeframe, onTimeframeChange }: TradingChartProps) {
  const {
    candles, volumes, ema20, ema50, tenkan, kijun, senkouA, senkouB, kcUpper, kcMiddle, kcLower,
    sma20, bbUpper, bbMid, bbLower, rsiLine, macdLine, macdSignal, macdHist,
    loading, error, streamError, lastPrice, timeframe: activeTf, setTimeframe, source, pinnedSource, availableSources, setSource, feed, resolvedTimeframe, resolved, verifySources, verifiedCount, verifiedRatio
  } = useCandleData({ assetId, timeframe: timeframe ?? 300, count: 2000 }) // T3: request the full deep-history window (Yahoo intraday caps ~7d of 5m) — the server returns what each source can honestly serve
  // Slice C — when the parent controls the timeframe, its change wins; the
  // hook's own state stays in sync via the initialTf effect in useCandleData.
  const chooseTimeframe = (tf: Timeframe) => {
    if (onTimeframeChange) onTimeframeChange(tf)
    else setTimeframe(tf)
  }
  // T6 — source dropdown. Options come from the server's additive
  // `availableSources` (slug + label + capability). "auto" = default = the
  // broker-priority fan-in ideal/best source; picking a slug pins the NEXT
  // fetch to that source only. Only sources that CAN serve the current
  // resolution are selectable — honest options, never fabricated.
  const sourceOptions: { value: string; label: string; serves: boolean }[] = [
    { value: "auto", label: "Auto (best)", serves: true },
    ...(availableSources ?? []).map((s) => ({ value: s.slug, label: s.label, serves: s.serves }))
  ]
  const chooseSource = (slug: string) => setSource(slug)
  const { servableTimeframes, sourceTimeframes } = useBrokerCapabilities()
  const [hover, setHover] = useState<{ open: number; high: number; low: number; close: number } | null>(null)
  const [showIchimoku, setShowIchimoku] = useState(false)
  const [showKeltner, setShowKeltner] = useState(false)
  const [showLevels, setShowLevels] = useState(true)
  const [showU4fa, setShowU4fa] = useState(true)
  // T10 — indicator overlays. EMA/SMA and Volume default ON (pre-T10 look
  // preserved); Bollinger/RSI/MACD start off.
  const [showSma, setShowSma] = useState(true)
  const [showVolume, setShowVolume] = useState(true)
  const [showBollinger, setShowBollinger] = useState(false)
  const [showRsi, setShowRsi] = useState(false)
  const [showMacd, setShowMacd] = useState(false)
  const [levels, setLevels] = useState<EntryLevelsResult | null>(null)
  // Hover emphasis: which zone the pointer is on ("buy" | "sell" | null) and
  // simulation feedback.
  const [hoverZone, setHoverZone] = useState<"buy" | "sell" | null>(null)
  const [simMsg, setSimMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // T7 — real U4FA engine signals for THIS asset, captured off the shared
  // realtime stream (no second connection). Ring buffer keeps the last 60;
  // markers are derived via u4faMarkersFor, never fabricated client-side.
  const [u4faEvents, setU4faEvents] = useState<LiveEvent[]>([])
  // Past/present browsing: autoScroll ON keeps the chart pinned to real-time
  // (snaps to the newest bar on every tick). The moment the user drags/zooms
  // off the present, we flip it OFF so the view stays put while live ticks
  // keep arriving — otherwise self-scrolling destroys past browsing. The
  // header "recent" button flips it back ON (recenter + follow live).
  const [autoScroll, setAutoScroll] = useState(true)
  const leavePresent = () => setAutoScroll(false)
  const recenter = () => setAutoScroll(true)
  // Fullscreen toggle: pins this chart card over the viewport with a taller
  // canvas. The FS canvas height is captured from the viewport at entry so the
  // chart actually resizes (CandlestickChart re-applies options on height
  // change); the toggle or Escape exits.
  const [fullscreen, setFullscreen] = useState(false)
  const [fsHeight, setFsHeight] = useState(0)
  const enterFullscreen = () => { setFsHeight((window.innerHeight || 800) - 116); setFullscreen(true) }
  const exitFullscreen = () => setFullscreen(false)
  const toggleFullscreen = () => (fullscreen ? exitFullscreen() : enterFullscreen())
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitFullscreen() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fullscreen])
  const chartHeight = fullscreen && fsHeight > 0 ? fsHeight : height
  // Multi-timeframe overlay: a coarser timeframe's close line drawn over the
  // active candle series so the chart itself shows multiple timeframes at once.
  const [showHtf, setShowHtf] = useState(false)
  const [htfLine, setHtfLine] = useState<EmaDatum[]>([])
  useRealtimeSuite((e: LiveEvent) => {
    if (e.type !== "u4fa") return
    if (e.assetId !== assetId) return
    setU4faEvents((prev) => (prev.length >= 60 ? [...prev.slice(prev.length - 59), e] : [...prev, e]))
  })

  // HTF overlay data: pick a coarser timeframe relative to the active one and
  // fetch its close line when the overlay is enabled. Honest — if the fetch
  // fails or the source can't serve it, htfLine stays empty and the toggle
  // explains itself (no fabricated bars).
  useEffect(() => {
    if (!showHtf) { setHtfLine([]); return }
    let alive = true
    setHtfLine([])
    const overlayTf = activeTf < 3600 ? 14400 : activeTf < 86400 ? 86400 : 604800
    fetchCandles(assetId, overlayTf, 400, "auto", true)
      .then(({ rows }) => {
        if (!alive) return
        setHtfLine(rows.map((r) => ({ time: r.time, value: r.close })))
      })
      .catch(() => { if (alive) setHtfLine([]) })
    return () => { alive = false }
  }, [showHtf, assetId, activeTf])

  // Ideal buy/sell price points for the active asset + selected timeframe.
  useEffect(() => {
    let alive = true
    setLevels(null)
    getEntryLevels(assetId, activeTf)
      .then((r) => { if (alive) setLevels(r) })
      .catch(() => { /* levels stay hidden — never breaks the chart */ })
    return () => { alive = false }
  }, [assetId, activeTf])

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
  // The SERVED source (when known) gets the final say: restrict the enabled
  // button set to its curve. Legacy "live"/"buffer" labels mean EO buffers.
  const servedSource = source === "live" || source === "buffer" ? "expertoption" : source
  const sourceCurve = servedSource ? sourceTimeframes.get(servedSource) : undefined
  const servable = new Set<number>(sourceCurve?.length ? sourceCurve : [...servableTimeframes])
  const sourceLabel = feed === "studio" ? "ExpertOption headless"
      : source === "yahoo" || source === "yahoo-daily" ? "Yahoo"
        : servedSource === "expertoption" ? "ExpertOption"
          : servedSource === "ccxt" ? "CCXT"
            : servedSource && servedSource !== "none" ? servedSource : "no visible source"
  // Honest resolution label: the SERVER decides the bar size (broker
  // resolveTimeframe), never the client's echo of the request. Any mismatch
  // between what the user picked and what the server served triggers the
  // warning — a 5s request that comes back as 1m bars must say so.
  const resolutionMismatch = resolved || (resolvedTimeframe != null && resolvedTimeframe !== activeTf)
  const servedTfLabel = () => {
    if (resolvedTimeframe == null) return null
    return (TIMEFRAME_LABELS as Record<number, string | undefined>)[resolvedTimeframe] ?? `${resolvedTimeframe}s`
  }

  const nearestBuy = levels?.buyZone ? levels.levels?.find((l) => l.price === levels.buyZone?.anchor) ?? null : null
  const nearestSell = levels?.sellZone ? levels.levels?.find((l) => l.price === levels.sellZone?.anchor) ?? null : null

  // T7 — advisory decision markers: drawn when toggled, strictly from real u4fa
  // events for this asset (honesty gate lives in u4faMarkersFor).
  const u4faMarkers = useMemo<U4faMarker[]>(
    () => (showU4fa ? u4faMarkersFor(u4faEvents, assetId, candles) : []),
    [showU4fa, u4faEvents, assetId, candles]
  )
  const latestU4fa = useMemo(() => {
    for (let i = u4faEvents.length - 1; i >= 0; i--) {
      const e = u4faEvents[i]
      if (e.type === "u4fa" && e.assetId === assetId && e.honesty) return e as LiveEvent & LiveU4faSignal
    }
    return null
  }, [u4faEvents, assetId])

  return (
    <div
      className="stack"
      style={{
        gap: 6,
        ...(fullscreen
          ? { position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg)", padding: 16, overflow: "auto" }
          : {})
      }}
    >
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
          {feed === "studio" ? <Badge tone="success">EO headless live</Badge>
            : sourceBadge ? <Badge tone={sourceBadge.tone}>{sourceBadge.text}</Badge> : null}
          {/* T6 — show when the user pinned a specific source (not "auto"). */}
          {pinnedSource !== "auto" ? <span title={`Pinned to source: ${sourceLabel} — fetch from this broker only`}><Badge tone="muted">Source: {sourceLabel}</Badge></span> : null}
          {/* Cross-source verification (server `verify:true`). Honest: a badge
              only appears when the server actually consulted siblings. Verified
              = independent sources AGREED on the same bars; "no agreement" says
              the check ran but the data disagreed (never fabricated). Absent =
              no cross-check was available — NOT "verified". */}
          {verifySources > 0 && verifiedRatio > 0 ? (
            <Badge tone="success">
              ✓ cross-verified ({verifySources} {verifySources === 1 ? "source" : "sources"})
            </Badge>
          ) : verifySources > 0 && verifiedCount === 0 ? (
            <Badge tone="warn">cross-checked · no agreement</Badge>
          ) : null}
          {streamError ? <Badge tone="warn">stream offline — retrying</Badge> : null}
          {latestU4fa ? (
            <span
              title={`U4FA advisory (decision readout only — never auto-executes) · producers: ${JSON.stringify(latestU4fa.honesty)}`}
              style={{ display: "inline-flex" }}
            >
              <Badge tone={latestU4fa.verdict === "TRADE" ? "success" : latestU4fa.verdict === "OBSERVE" ? "warn" : "muted"}>
                U4FA {latestU4fa.verdict} {latestU4fa.direction === "up" ? "↑" : latestU4fa.direction === "down" ? "↓" : "→"}
              </Badge>
            </span>
          ) : null}
        </div>
        <div className="row gap" style={{ alignItems: "center" }}>
          {display ? (
            <div className="muted small" style={{ marginRight: 8 }}>
              O {fmtPrice(display.open)} H {fmtPrice(display.high)} L {fmtPrice(display.low)} C {fmtPrice(display.close)}
            </div>
          ) : null}
          {!autoScroll ? (
            <Button variant="primary" className="btn-sm" onClick={recenter} style={{ marginRight: 8 }}>
              ⟳ Recent
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="btn-sm"
            onClick={toggleFullscreen}
            style={{ marginRight: 8 }}
            title={fullscreen ? "Exit fullscreen (Esc)" : "Expand this chart to fullscreen"}
          >
            {fullscreen ? "✕ Exit FS" : "⛶ Fullscreen"}
          </Button>
          <Button
            variant={showHtf ? "primary" : "ghost"}
            className="btn-sm"
            onClick={() => setShowHtf((v) => !v)}
            style={{ marginRight: 8 }}
            title={`Overlay a coarser timeframe (${TIMEFRAME_LABELS[activeTf < 3600 ? 14400 : activeTf < 86400 ? 86400 : 604800]}) close line on these candles`}
          >
            {showHtf ? "HTF: on" : "HTF"}
          </Button>
          {/* T6 — source dropdown: selects the market-data lens for this chart.
              Options come from the server's additive `availableSources` response.
              "Auto (best)" is the default fan-in; picking a specific source pins
              the fetch to that broker slug (resolveTimeframe + honest decline
              still apply). Only brokers that CAN serve the current resolution
              are selectable (serves=true); others are shown disabled so the user
              knows they exist but can't serve this timeframe. */}
          {sourceOptions.length > 1 ? (
            <select
              value={pinnedSource}
              onChange={(e) => chooseSource(e.target.value)}
              style={{
                marginRight: 8,
                padding: "2px 6px",
                fontSize: 11,
                borderRadius: 4,
                border: "1px solid rgba(148,163,184,0.3)",
                background: "rgba(30,41,59,0.8)",
                color: "#e2e8f0",
                cursor: "pointer"
              }}
              title="Data source: Auto uses the best available; picking a source fetches from that broker only."
            >
              {sourceOptions.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={!opt.serves && opt.value !== "auto"}>
                  {opt.label}{!opt.serves && opt.value !== "auto" ? " (can't serve this TF)" : ""}
                </option>
              ))}
            </select>
          ) : null}
          {TIMEFRAMES.map((tf) => {
            const enabled = servable.has(tf)
            const button = (
              <Button
                key={tf}
                variant={tf === activeTf ? "primary" : "ghost"}
                className="btn-sm"
                disabled={!enabled}
                onClick={() => chooseTimeframe(tf)}
              >
                {TIMEFRAME_LABELS[tf]}
              </Button>
            )
            if (enabled) return button
            // Native disabled buttons swallow mouse events, so the tooltip
            // explaining WHY sits on a wrapper span (T6).
            return (
              <span
                key={tf}
                title={`${TIMEFRAME_LABELS[tf]} — no configured source serves it (${sourceLabel} provides ${[...servable].map((t) => (TIMEFRAME_LABELS as Record<number, string | undefined>)[t] ?? `${t}s`).join(", ") || "no candle data"})`}
                style={{ display: "inline-block" }}
              >
                {button}
              </span>
            )
          })}
        </div>
      </div>

      {resolutionMismatch ? (
        <p className="muted small" style={{ margin: 0 }}>
          ⚠️ No live {TIMEFRAME_LABELS[activeTf]} feed for {assetId} — showing {source === "yahoo" || source === "yahoo-daily" ? "Yahoo DAILY" : `${servedTfLabel() ?? "coarser"} `}bars from {sourceLabel} instead. Levels below are computed from the served resolution.
        </p>
      ) : null}

      {loading && !candles.length ? (
        <div style={{ height: chartHeight, display: "flex", alignItems: "center", justifyContent: "center" }} className="muted">
          Loading chart data...
        </div>
      ) : error ? (
        <div style={{ height: chartHeight, display: "flex", alignItems: "center", justifyContent: "center" }} className="danger-text">
          {error}
        </div>
      ) : candles.length ? (
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
            sma20={sma20}
            bbUpper={bbUpper}
            bbMid={bbMid}
            bbLower={bbLower}
            rsiLine={rsiLine}
            macdLine={macdLine}
            macdSignal={macdSignal}
            macdHist={macdHist}
            showVolume={showVolume}
            showSma={showSma}
            showBollinger={showBollinger}
            showRsi={showRsi}
            showMacd={showMacd}
            priceLines={priceLines}
            u4faMarkers={u4faMarkers}
            height={chartHeight}
            onCrosshair={crosshair}
            autoScroll={autoScroll}
            onUserScroll={leavePresent}
            htfLine={htfLine}
            showHtf={showHtf}
          />
        </ChartErrorBoundary>
      ) : (
        // Honest empty state (T11 live finding 2026-08-29): a dead live
        // feed plus no fallback covering this asset/resolution returned NO
        // candles, and the old code rendered a blank canvas. Say WHY instead.
        <div
          style={{ height: chartHeight, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}
          className="muted"
        >
          <span>No data for {label ?? assetId} at {TIMEFRAME_LABELS[activeTf]}</span>
          <span className="small" style={{ maxWidth: 420, textAlign: "center" }}>
            No configured source is serving it — live-feed legs are offline and the fallbacks
            ({sourceLabel}) have no candles at this resolution{streamError ? "; the realtime stream is offline and retrying" : ""}.
            Check the feed legs in Data Sources.
          </span>
        </div>
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
        <span className="muted small" style={{ color: "#38bdf8" }}>SMA20</span>
        <span className="muted small" style={{ color: "#facc15" }}>BB</span>
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
        <button
          onClick={() => setShowSma(!showSma)}
          title="SMA/EMA overlays (SMA20 + EMA20 + EMA50)"
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showSma ? "rgba(56, 189, 248, 0.3)" : "transparent",
            color: showSma ? "#38bdf8" : "var(--text-muted)"
          }}
        >
          SMA/EMA
        </button>
        <button
          onClick={() => setShowBollinger(!showBollinger)}
          title="Bollinger Bands (20, 2σ)"
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showBollinger ? "rgba(250, 204, 21, 0.3)" : "transparent",
            color: showBollinger ? "#facc15" : "var(--text-muted)"
          }}
        >
          Bollinger
        </button>
        <button
          onClick={() => setShowVolume(!showVolume)}
          title="Volume histogram"
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showVolume ? "rgba(148, 163, 184, 0.3)" : "transparent",
            color: showVolume ? "#94a3b8" : "var(--text-muted)"
          }}
        >
          Volume
        </button>
        <button
          onClick={() => setShowRsi(!showRsi)}
          title="RSI(14) in a secondary pane"
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showRsi ? "rgba(167, 139, 250, 0.3)" : "transparent",
            color: showRsi ? "#a78bfa" : "var(--text-muted)"
          }}
        >
          RSI
        </button>
        <button
          onClick={() => setShowMacd(!showMacd)}
          title="MACD (12, 26, 9) in a secondary pane"
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showMacd ? "rgba(74, 222, 128, 0.25)" : "transparent",
            color: showMacd ? "#4ade80" : "var(--text-muted)"
          }}
        >
          MACD
        </button>
        <button
          onClick={() => setShowU4fa(!showU4fa)}
          title="U4FA decision markers — advisory readout only, never auto-executes; shown only from engine events with named producers"
          style={{
            padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
            background: showU4fa ? "rgba(74, 222, 128, 0.25)" : "transparent",
            color: showU4fa ? "#4ade80" : "var(--text-muted)"
          }}
        >
          U4FA
        </button>
      </div>
    </div>
  )
}
