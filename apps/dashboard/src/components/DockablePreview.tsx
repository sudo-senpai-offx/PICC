import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { SUITE_DOCKABLES, type DockableConfig } from "@/lib/overlaySettings"
import { post } from "@/lib/api"

const EDGE_DOCK_THRESHOLD = 24
const MIN_DOCK_W = 200
const MIN_DOCK_H = 100

// ── Live data feed ──────────────────────────────────────────────────────────
// One consolidated poll shared by every dock — mirrors what the extension
// overlay receives from POST /api/extension/trading-data. Replaces the old
// hard-coded PlaceholderContent so the webui preview shows REAL numbers.
interface LiveFeed {
  viewed: string
  assets: Array<{ id: string; name: string; price: number | null; changePct: number | null }>
  openDeals: Array<Record<string, unknown>>
  settled: Array<Record<string, unknown>>
  decisions: Array<Record<string, unknown>>
  autopilot: Record<string, unknown> | null
  demo: Record<string, unknown> | null
  account: { balance: number | null; currency: string } | null
  kelly: Record<string, unknown> | null
  regime: Record<string, unknown> | null
  orderFlow: Record<string, unknown> | null
  expiry: Record<string, unknown> | null
  sentiment: Record<string, unknown> | null
  entryLevels: Record<string, unknown> | null
  models: Record<string, unknown> | null
  online: boolean
  lastAt: number
}

const EMPTY_FEED: LiveFeed = {
  viewed: "EURUSD", assets: [], openDeals: [], settled: [], decisions: [],
  autopilot: null, demo: null, account: null, kelly: null, regime: null,
  orderFlow: null, expiry: null, sentiment: null, entryLevels: null,
  models: null,
  online: false, lastAt: 0
}

function useTradingFeed(): LiveFeed {
  const [feed, setFeed] = useState<LiveFeed>(EMPTY_FEED)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const r = await post<Record<string, unknown>>("/extension/trading-data", { assetId: feed.viewed || "EURUSD", candleCount: 60 })
        if (!alive) return
        if (r?.ok) {
          const d = r as Record<string, any>
          setFeed({
            viewed: String(d.viewed ?? "EURUSD"),
            assets: d.candles?.length
              ? [{
                  id: String(d.viewed ?? "EURUSD"),
                  name: String(d.viewed ?? "EURUSD"),
                  price: Number(d.candles[d.candles.length - 1]?.close) || null,
                  changePct: d.candles.length > 1 && d.candles[d.candles.length - 2]?.close
                    ? ((d.candles[d.candles.length - 1].close - d.candles[d.candles.length - 2].close) / d.candles[d.candles.length - 2].close) * 100
                    : null
                }]
              : [],
            openDeals: Array.isArray(d.openDeals) ? d.openDeals : [],
            settled: d.demo?.settled ?? [],
            decisions: Array.isArray(d.decisions) ? d.decisions : d.decisions?.decisions ?? [],
            autopilot: d.autopilot ?? null,
            demo: d.demo ?? null,
            account: d.status?.expertOption
              ? { balance: d.status.expertOption.balance ?? null, currency: d.status.expertOption.currency || "USD" }
              : null,
            kelly: d.kelly ?? null,
            regime: d.regime ?? null,
            orderFlow: d.orderFlow ?? null,
            expiry: d.expiry ?? null,
            sentiment: d.sentiment ?? null,
            entryLevels: d.entryLevels ?? null,
            models: d.models ?? null,
            online: true,
            lastAt: Date.now()
          })
        } else if (alive) {
          setFeed((f) => ({ ...f, online: false }))
        }
      } catch {
        if (alive) setFeed((f) => ({ ...f, online: false }))
      } finally {
        if (alive) timer = setTimeout(tick, 5000)
      }
    }
    void tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return feed
}

const FeedContext = createContext<LiveFeed>(EMPTY_FEED)

interface DockableState {
  id: string
  config: DockableConfig
  visible: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  collapsed: boolean
  dragging: boolean
  resizing: boolean
  pinned: boolean
  group: string | null
  tabActive: boolean
}

// ── Real per-dock content ───────────────────────────────────────────────────
function DockContent({ dockId, config }: { dockId: string; config: DockableConfig }) {
  const feed = useContext(FeedContext)
  const [busy, setBusy] = useState(false)

  const row = (label: string, value: string, valColor?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
      <span style={{ color: "#9aa0c0" }}>{label}</span>
      <span style={{ color: valColor || "#eef0ff", fontWeight: 500 }}>{value}</span>
    </div>
  )
  const money = (n: unknown) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return "—"
    return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const px = (n: unknown, digits = 4) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return "—"
    return v.toFixed(digits)
  }
  const waiting = (text: string) => <div style={{ color: "#a5a0ff", padding: 4, fontSize: 11 }}>{text}</div>
  const offline = !feed.online ? (
    <div style={{ color: "#ff6b6b", fontSize: 11, padding: 4 }}>Server offline — start the PICC server.</div>
  ) : null

  // Real autopilot engine controls (the old preview had decorative divs).
  const autopilotAction = async (action: "start" | "stop") => {
    setBusy(true)
    try {
      await post(`/trading/autopilot/${action}`, action === "stop" ? { reason: "user" } : {})
    } catch { /* surfaced on next poll */ }
    setBusy(false)
  }

  switch (dockId) {
    case "price-ticker": {
      if (!feed.assets.length) return <>{offline}{waiting("Waiting for market data…")}</>
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {feed.assets.slice(0, 6).map((a) => {
            const c = (a.changePct ?? 0) >= 0 ? "#4ade80" : "#ff6b6b"
            return (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: a.name === feed.viewed ? "#6c63ff" : undefined }}>{a.name}{a.name === feed.viewed ? " ●" : ""}</span>
                <span style={{ color: c }}>{px(a.price)}</span>
                <span style={{ color: c, fontSize: 10 }}>{a.changePct != null ? `${a.changePct >= 0 ? "+" : ""}${a.changePct.toFixed(2)}%` : ""}</span>
              </div>
            )
          })}
          {feed.account?.balance != null ? row("Balance", money(feed.account.balance), "#6c63ff") : null}
        </div>
      )
    }
    case "portfolio": {
      const paper = feed.demo
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {offline}
          {feed.account?.balance != null ? (
            <>
              <div style={{ fontWeight: 600, fontSize: 11, color: "#6c63ff", marginBottom: 2 }}>Live Session</div>
              {row("Balance", money(feed.account.balance))}
              {row("Today", money(feed.demo?.todayPnl), Number(feed.demo?.todayPnl) >= 0 ? "#4ade80" : "#ff6b6b")}
              {row("Trades today", String(feed.demo?.todayTrades ?? 0))}
            </>
          ) : paper?.balance != null ? (
            <>
              <div style={{ fontWeight: 600, fontSize: 11, color: "#6c63ff", marginBottom: 2 }}>Demo Account</div>
              {row("Balance", money(paper.balance))}
              {row("Today", money(paper.todayPnl), Number(paper.todayPnl) >= 0 ? "#4ade80" : "#ff6b6b")}
              {row("Trades today", String(paper.todayTrades ?? 0))}
            </>
          ) : (
            waiting("No position data yet…")
          )}
        </div>
      )
    }
    case "ai-signals": {
      if (!feed.decisions.length) return <>{offline}{waiting("Waiting for AI analysis…")}</>
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {feed.decisions.slice(0, 5).map((dec, i) => {
            const verdict = String(dec.verdict ?? "—")
            const verdictColor = verdict === "TRADE" ? "#4ade80" : verdict === "OBSERVE" ? "#f59e0b" : "#a5a0ff"
            const conf = Number(dec.confidence)
            const dir = String(dec.direction ?? "").toUpperCase()
            return (
              <div key={i} style={{ borderBottom: "1px solid #6c63ff15", paddingBottom: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 11 }}>{String(dec.asset ?? dec.assetId ?? "")}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: verdictColor }}>{verdict}</span>
                </div>
                <div style={{ display: "flex", gap: 6, fontSize: 9, color: "#9aa0c0" }}>
                  {Number.isFinite(conf) ? <span>{conf.toFixed(0)}%</span> : null}
                  <span style={{ color: dir === "UP" ? "#4ade80" : dir === "DOWN" ? "#ff6b6b" : "#9aa0c0" }}>{dir || "—"}</span>
                  {dec.ev != null && Number.isFinite(Number(dec.ev)) ? <span>EV {(Number(dec.ev) * 100).toFixed(1)}%</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      )
    }
    case "risk-mgr": {
      const ap = feed.autopilot
      if (!ap && !feed.demo) return <>{offline}{waiting("Risk metrics loading…")}</>
      const limitPct = Number(ap?.dailyLossLimitPct ?? 10) || 10
      const todayLoss = Math.max(0, -(Number(feed.demo?.todayPnl) || 0))
      const pct = Math.min(100, limitPct > 0 && todayLoss > 0 ? (todayLoss / (limitPct / 100)) * 100 : 0)
      const barColor = pct > 80 ? "#ff6b6b" : pct > 50 ? "#f59e0b" : "#4ade80"
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: "#6c63ff" }}>Daily Loss Limit</div>
          <div style={{ background: "#1a1a2e", borderRadius: 3, height: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 3 }} />
          </div>
          {row("Used", `${money(todayLoss)} of ${limitPct}% limit`)}
          {row("Open positions", `${feed.openDeals.length}/${ap?.maxConcurrent ?? "—"}`)}
          {row("Trades today", `${feed.demo?.todayTrades ?? 0}${Number(ap?.maxDailyTrades) > 0 ? `/${String(ap?.maxDailyTrades)}` : "/∞"}`)}
        </div>
      )
    }
    case "autopilot": {
      const ap = feed.autopilot
      const running = Boolean(ap?.enabled)
      const scopeProblems =
        ((feed.demo?.autopilot as { scopeHealth?: { problems?: string[] } } | undefined)?.scopeHealth?.problems ?? [])
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: running ? "#4ade80" : "#666" }} />
            <span style={{ fontWeight: 600, fontSize: 11 }}>{running ? "Running" : "Idle"}</span>
          </div>
          {Array.isArray(ap?.assetScope) && ap.assetScope.length ? (
            row("Scope", ap.assetScope.map((a: { assetId: string }) => a.assetId).join(", "), "#6c63ff")
          ) : ap?.assetId ? row("Asset", String(ap.assetId)) : null}
          {scopeProblems.length ? (
            <div style={{ fontSize: 9, color: "#ff6b6b", padding: 3, background: "#ff6b6b10", borderRadius: 3, border: "1px solid #ff6b6b", wordBreak: "break-word" }}>
              Unresolvable: {scopeProblems.join(", ")} — remove from scope
            </div>
          ) : null}
          {ap?.lastDecision ? (
            <div style={{ fontSize: 9, color: "#9aa0c0", padding: 3, background: "#0d0d1a", borderRadius: 3, borderLeft: "2px solid #6c63ff", wordBreak: "break-word" }}>
              {String(ap.lastDecision)}
            </div>
          ) : null}
          {row("Today PnL", money(feed.demo?.todayPnl), Number(feed.demo?.todayPnl) >= 0 ? "#4ade80" : "#ff6b6b")}
          <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
            <button
              disabled={busy}
              onClick={() => void autopilotAction(running ? "stop" : "start")}
              style={{
                flex: 1, textAlign: "center",
                background: running ? "#ff6b6b30" : "#4ade8030",
                border: `1px solid ${running ? "#ff6b6b" : "#4ade80"}`,
                borderRadius: 4, padding: "2px 0", fontSize: 10,
                color: running ? "#ff6b6b" : "#4ade80", cursor: "pointer", fontWeight: 600,
              }}
            >
              {running ? "Stop" : "Start"}
            </button>
            <button
              disabled={busy}
              onClick={() => void autopilotAction("stop")}
              style={{
                textAlign: "center", background: "#ff6b6b30", border: "1px solid #ff6b6b",
                borderRadius: 4, padding: "2px 8px", fontSize: 10, color: "#ff6b6b", cursor: "pointer", fontWeight: 600,
              }}
            >
              Kill
            </button>
          </div>
        </div>
      )
    }
    case "kelly-sizing": {
      const stats = (feed.kelly?.stats ?? {}) as Record<string, unknown>
      const k = (feed.kelly?.kelly ?? {}) as Record<string, unknown>
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {offline}
          {row("Active asset", feed.viewed, "#6c63ff")}
          {row("Win rate", stats.winRate != null ? `${stats.winRate}%` : "—")}
          {row("Avg payout", stats.avgPayout != null ? `${stats.avgPayout}x` : "—")}
          <div style={{ borderTop: "1px solid #6c63ff20", margin: "4px 0" }} />
          {row("Full Kelly", k.fullKelly != null ? `${k.fullKelly}%` : "—", "#6c63ff")}
          {row(`Suggested (${k.mode ?? "half"})`, k.suggested != null ? `${k.suggested}%` : "—", "#4ade80")}
          {row("Break-even WR", k.breakEven != null ? `${k.breakEven}%` : "—")}
        </div>
      )
    }
    case "regime-detect": {
      const regime = feed.regime as Record<string, unknown> | null
      if (!regime || regime.regime === "unknown" || !regime.regime) return <>{offline}{waiting("Analyzing market regime…")}</>
      const colors: Record<string, string> = { trending: "#4ade80", ranging: "#f59e0b", volatile: "#ff6b6b", breakout: "#6c63ff" }
      const c = colors[String(regime.regime)] ?? "#a5a0ff"
      const metrics = regime.metrics as Record<string, unknown> | null
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
            <span style={{ fontWeight: 600, fontSize: 12, color: c }}>{String(regime.regime).toUpperCase()}</span>
            <span style={{ fontSize: 10, color: "#9aa0c0" }}>{Number(regime.confidence) || 0}%</span>
          </div>
          {metrics ? <div style={{ fontSize: 10, color: "#9aa0c0" }}>ADX: {String(metrics.adx)} · ATR ratio: {String(metrics.atrRatio)}x</div> : null}
          {regime.suggestedStrategy ? row("Strategy", String(regime.suggestedStrategy), "#6c63ff") : null}
        </div>
      )
    }
    case "order-flow": {
      const of = feed.orderFlow as Record<string, unknown> | null
      const delta = of?.delta as unknown[] | undefined
      if (!of || !delta?.length) return <>{offline}{waiting("Loading order flow…")}</>
      const imb = String(of.imbalance ?? "")
      const imbColor = imb === "buy-heavy" ? "#4ade80" : imb === "sell-heavy" ? "#ff6b6b" : "#f59e0b"
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 11 }}>Net Delta</span>
            <span style={{ color: Number(of.cumulative) >= 0 ? "#4ade80" : "#ff6b6b", fontWeight: 600 }}>
              {Number(of.cumulative) >= 0 ? "+" : ""}{String(of.cumulative)}
            </span>
            <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: `${imbColor}30`, color: imbColor }}>{imb}</span>
          </div>
          {of.avgDelta != null ? row("Avg delta", String(of.avgDelta)) : null}
          {(of.signals as Array<{ desc?: string; type?: string }> | undefined)?.slice(0, 3).map((sig, i) => (
            <div key={i} style={{ fontSize: 9, color: sig.type === "divergence" ? "#f59e0b" : "#6c63ff" }}>⚡ {sig.desc}</div>
          ))}
        </div>
      )
    }
    case "expiry-opt": {
      const exp = feed.expiry as Record<string, unknown> | null
      if (!exp?.recommended) return <>{offline}{waiting("Analyzing optimal expiry…")}</>
      const rec = exp.recommended as Record<string, unknown>
      const all = (exp.all ?? []) as Array<{ label: string; score: number }>
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: "#6c63ff" }}>Recommended: {String(rec.label)}</div>
          <div style={{ fontSize: 10, color: "#9aa0c0" }}>Score: {String(rec.score)}/100 · Vol: {String(exp.volatility ?? "—")}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            {all.slice(0, 3).map((e) => (
              <div key={e.label} style={{ flex: 1, textAlign: "center", fontSize: 9 }}>
                <div style={{ marginBottom: 2 }}>{e.label}</div>
                <div style={{ background: "#1a1a2e", borderRadius: 2, height: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(10, e.score)}%`, background: "#6c63ff", borderRadius: 2 }} />
                </div>
                <div style={{ color: "#9aa0c0", marginTop: 1 }}>{e.score}</div>
              </div>
            ))}
          </div>
        </div>
      )
    }
    case "sentiment": {
      const sent = feed.sentiment as Record<string, unknown> | null
      if (!sent?.composite) return <>{offline}{waiting("Loading sentiment…")}</>
      const composite = sent.composite as Record<string, unknown>
      const scoreColor = Number(composite.score) > 0.2 ? "#4ade80" : Number(composite.score) < -0.2 ? "#ff6b6b" : "#f59e0b"
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: scoreColor }}>{String(composite.label ?? "Neutral")}</span>
            <span style={{ fontSize: 10, color: "#9aa0c0" }}>Score: {String(composite.score)}</span>
          </div>
          {sent.news ? row("News sample size", String((sent.news as Record<string, unknown>).sampleSize ?? "—")) : null}
        </div>
      )
    }
    case "positions": {
      const openDeals = feed.openDeals
      const settled = feed.settled
      if (!openDeals.length && !settled.length) return <>{offline}<div style={{ color: "#a5a0ff", padding: 4, fontSize: 11 }}>No open positions</div></>
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 10, color: "#9aa0c0" }}>{openDeals.length} open position{openDeals.length !== 1 ? "s" : ""}</div>
          {openDeals.map((dealRaw, i) => {
            const deal = dealRaw as Record<string, unknown>
            const dir = String(deal.direction ?? deal.type ?? "").toLowerCase()
            const dirColor = dir === "call" ? "#4ade80" : dir === "put" ? "#ff6b6b" : "#f59e0b"
            const pnl = deal.livePnl
            return (
              <div key={String(deal.serverId ?? i)} style={{ padding: "3px 0", borderBottom: "1px solid #6c63ff15" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 11 }}>{String(deal.asset ?? deal.assetId ?? "—")}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: dirColor, border: `1px solid ${dirColor}44`, borderRadius: 3, padding: "0 4px" }}>{dir.toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9aa0c0" }}>
                  <span>{money(deal.amount)} · {deal.duration ? `${deal.duration}s` : "—"}</span>
                  <span style={{ color: Number(pnl) > 0 ? "#4ade80" : Number(pnl) < 0 ? "#ff6b6b" : "#a5a0ff", fontWeight: 600 }}>
                    {pnl != null && Number.isFinite(Number(pnl)) ? `${Number(pnl) >= 0 ? "+" : ""}${Number(pnl).toFixed(4)}` : "—"}
                  </span>
                </div>
              </div>
            )
          })}
          {settled.length ? (
            <>
              <div style={{ borderTop: "1px solid #6c63ff20", marginTop: 4, paddingTop: 4, fontSize: 9, color: "#9aa0c0" }}>Recent settled</div>
              {settled.slice(0, 5).map((sRaw, i) => {
                const s = sRaw as Record<string, unknown>
                const sPnl = s.pnl ?? s.profit
                return (
                  <div key={String(s.serverId ?? i)} style={{ display: "flex", justifyContent: "space-between", fontSize: 9 }}>
                    <span>{String(s.asset ?? s.assetId ?? "")} {String(s.type ?? "").toUpperCase()}</span>
                    <span style={{ color: s.result === "win" ? "#4ade80" : s.result === "loss" ? "#ff6b6b" : "#a5a0ff" }}>
                      {String(s.result ?? "")} {sPnl != null ? money(sPnl) : ""}
                    </span>
                  </div>
                )
              })}
            </>
          ) : null}
        </div>
      )
    }
    case "entry-points": {
      const levels = feed.entryLevels as Record<string, unknown> | null
      if (!levels?.ok) return <>{offline}{waiting(String(levels?.reason ?? "Computing ideal buy/sell zones…"))}</>
      const spot = Number(levels.spot)
      const buyZone = levels.buyZone as Record<string, number> | null
      const sellZone = levels.sellZone as Record<string, number> | null
      const allLevels = (levels.levels ?? []) as Array<Record<string, unknown>>
      const simulatePaper = async (side: "up" | "down") => {
        const label = `${side.toUpperCase()} ${feed.viewed} @ ${px(spot)}`
        if (!window.confirm(`SIMULATE TRADE (paper only)\n\n${label}\nAmount: $100\n\nOpen this paper position?`)) return
        try {
          const { openPaperTrade } = await import("@/lib/trading")
          await openPaperTrade({ symbol: feed.viewed, side, entry: spot, amount: 100 })
        } catch { /* surfaced via paper ledger */ }
      }
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {offline}
          {row(`${feed.viewed} spot`, px(spot), "#eef0ff")}
          {buyZone ? (
            <div style={{ border: "1px solid #4ade8044", borderRadius: 4, padding: "3px 6px", background: "#4ade8008" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 600, color: "#4ade80" }}>
                <span>▼ IDEAL BUY</span><span>{px(buyZone.low)} – {px(buyZone.high)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9, color: "#9aa0c0" }}>
                <span>{(((buyZone.anchor as number) - spot) / spot * 100).toFixed(2)}% below spot · strength {buyZone.strength}/5</span>
                <button onClick={() => void simulatePaper("up")} style={{ background: "#4ade8025", border: "1px solid #4ade80", color: "#4ade80", fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 3, cursor: "pointer" }}>▶ simulate</button>
              </div>
            </div>
          ) : null}
          {sellZone ? (
            <div style={{ border: "1px solid #ff6b6b44", borderRadius: 4, padding: "3px 6px", background: "#ff6b6b08" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 600, color: "#ff6b6b" }}>
                <span>▲ IDEAL SELL</span><span>{px(sellZone.low)} – {px(sellZone.high)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9, color: "#9aa0c0" }}>
                <span>{(((sellZone.anchor as number) - spot) / spot * 100).toFixed(2)}% above spot · strength {sellZone.strength}/5</span>
                <button onClick={() => void simulatePaper("down")} style={{ background: "#ff6b6b25", border: "1px solid #ff6b6b", color: "#ff6b6b", fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 3, cursor: "pointer" }}>▶ simulate</button>
              </div>
            </div>
          ) : null}
          {(allLevels as Array<{ kind?: string; price?: unknown; distancePct?: unknown; sources?: string[] }>)
            .filter((l) => l.kind !== "spot")
            .slice(0, 5)
            .map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#9aa0c0" }}>
                <span>{l.kind === "support" ? "🟢" : "🔴"} {px(l.price)}</span>
                <span>+{Math.abs(Number(l.distancePct)).toFixed(2)}% · {String(l.sources?.[0] ?? "")}</span>
              </div>
            ))}
          <div style={{ fontSize: 8, color: "#5a6078", marginTop: 2 }}>pivots · swings · EMA confluence — adapts to active asset</div>
        </div>
      )
    }
    case "model-matrix": {
      const matrix = feed.models as Record<string, unknown> | null
      if (!matrix?.ok) return <>{offline}{waiting(String(matrix?.reason ?? "Running model battery…"))}</>
      const consensus = matrix.consensus as Record<string, unknown>
      const dirColor = consensus.direction === "up" ? "#4ade80" : consensus.direction === "down" ? "#ff6b6b" : "#f59e0b"
      const arrow = consensus.direction === "up" ? "▲" : consensus.direction === "down" ? "▼" : "◆"
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {offline}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 3 }}>
            <span style={{ color: "#6c63ff" }}>{feed.viewed} ● {String(matrix.modelsRun)} models</span>
            <span style={{ color: "#9aa0c0" }}>agree {String(consensus.agree)}/{String(consensus.total)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: dirColor }}>{arrow} {String(consensus.direction).toUpperCase()}</span>
            <span style={{ fontSize: 10, color: "#9aa0c0" }}>{String(consensus.confidence)}% conf</span>
            <div style={{ flex: 1, background: "#1a1a2e", borderRadius: 3, height: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(Number(consensus.confidence))}%`, background: dirColor, borderRadius: 3 }} />
            </div>
          </div>
          {((matrix.votes ?? []) as Array<Record<string, unknown>>).slice(0, 7).map((v, i) => {
            const vc = v.direction === "up" ? "#4ade80" : v.direction === "down" ? "#ff6b6b" : "#a5a0ff"
            const va = v.direction === "up" ? "▲" : v.direction === "down" ? "▼" : "◆"
            return (
              <div key={i} title={String(v.note ?? "")} style={{ padding: "2px 0", borderBottom: "1px solid #6c63ff10" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                  <span style={{ color: "#c9cdf0" }}>{String(v.name)}</span>
                  <span style={{ color: vc, fontWeight: 600 }}>{va} {Math.round(Number(v.confidence))}%</span>
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <div style={{ flex: 1, background: "#1a1a2e", borderRadius: 2, height: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round(Number(v.confidence))}%`, background: vc, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 8, color: "#5a6078" }}>×{String(v.weight)}</span>
                </div>
              </div>
            )
          })}
          <div style={{ fontSize: 8, color: "#5a6078", marginTop: 3 }}>weights adapt online from settled outcomes · multiplexed per tick</div>
        </div>
      )
    }
    case "server-status":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {row("Server", feed.online ? "Connected" : "Offline", feed.online ? "#4ade80" : "#ff6b6b")}
          {row("Tracking", feed.viewed)}
          {row("Last update", feed.lastAt ? new Date(feed.lastAt).toLocaleTimeString() : "—")}
        </div>
      )
    case "data-sources":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {row("Candle feed", feed.entryLevels || feed.kelly ? "answering" : "checking")}
          {config.description}
        </div>
      )
    default:
      return (
        <div style={{ color: "#9aa0c0", fontSize: 11, padding: 4 }}>
          {config.description}
        </div>
      )
  }
}

function clampEdge(pos: { x: number; y: number }, size: { width: number; height: number }, vw: number, vh: number) {
  let { x, y } = pos
  if (x < EDGE_DOCK_THRESHOLD) x = 0
  if (y < EDGE_DOCK_THRESHOLD) y = 0
  if (x + size.width > vw - EDGE_DOCK_THRESHOLD) x = vw - size.width
  if (y + size.height > vh - EDGE_DOCK_THRESHOLD) y = vh - size.height
  x = Math.max(0, Math.min(vw - size.width, x))
  y = Math.max(0, Math.min(vh - size.height, y))
  return { x, y }
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

function positionFromLabel(label: string, idx: number, total: number, vw: number, vh: number): { x: number; y: number } {
  const margin = 16
  const cols = Math.ceil(Math.sqrt(total))
  const row = Math.floor(idx / cols)
  const col = idx % cols
  const cellW = (vw - margin * 2) / cols
  const cellH = (vh - margin * 2) / Math.ceil(total / cols)
  switch (label) {
    case "top-left": return { x: margin, y: margin + 50 }
    case "top-right": return { x: vw - 280 - margin, y: margin + 50 }
    case "bottom-left": return { x: margin, y: vh - 180 - margin - 40 }
    case "bottom-right": return { x: vw - 280 - margin, y: vh - 180 - margin - 40 }
    case "left": return { x: margin, y: margin + 50 + row * (cellH * 0.6) }
    case "right": return { x: vw - 280 - margin, y: margin + 50 + row * (cellH * 0.6) }
    default: return { x: col * cellW + margin, y: margin + 50 + row * cellH }
  }
}

// ── Grouped dock container (tabbed) ──
function GroupContainer({
  groupId,
  docks,
  globalOpacity,
  focused,
  onFocus,
  onTabSelect,
  onTabDragStart,
  onTabDrag,
  onTabDragEnd,
  onDragStart,
  onResizeStart,
  onToggleCollapse,
  onTogglePin,
  onClose,
}: {
  groupId: string
  docks: DockableState[]
  globalOpacity: number
  focused: boolean
  onFocus: () => void
  onTabSelect: (groupId: string, dockId: string) => void
  onTabDragStart: (e: React.MouseEvent, dockId: string) => void
  onTabDrag: (e: globalThis.MouseEvent, dockId: string) => void
  onTabDragEnd: (e: globalThis.MouseEvent, dockId: string) => void
  onDragStart: (e: React.MouseEvent, id: string) => void
  onResizeStart: (e: React.MouseEvent, id: string) => void
  onToggleCollapse: (id: string) => void
  onTogglePin: (id: string) => void
  onClose: (id: string) => void
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const activeDock = docks.find((d) => d.tabActive) || docks[0]

  // Tab drag listeners. Declared before any conditional return — hook order
  // must stay stable across renders, including when a group is transiently empty.
  useEffect(() => {
    const draggingTab = docks.find((d) => (d as any)._tabDragging)
    if (!draggingTab) return
    const onMove = (e: MouseEvent) => onTabDrag(e, draggingTab.id)
    const onUp = (e: MouseEvent) => onTabDragEnd(e, draggingTab.id)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [docks, onTabDrag, onTabDragEnd])

  if (!activeDock) return null

  return (
    <div
      ref={groupRef}
      style={{
        position: "fixed",
        left: activeDock.position.x,
        top: activeDock.position.y,
        width: activeDock.size.width,
        height: activeDock.collapsed ? 36 : activeDock.size.height,
        opacity: globalOpacity,
        background: "rgba(13, 13, 26, 0.92)",
        border: activeDock.pinned ? "1px solid var(--accent, #6c63ff)" : "1px solid rgba(42, 42, 74, 0.8)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,.5)",
        zIndex: activeDock.dragging ? 100 : focused ? 50 : 10,
        transition: activeDock.dragging || activeDock.resizing ? "none" : "opacity 0.2s, border-color 0.2s",
        overflow: "hidden",
        fontFamily: "13px/1.5 system-ui, sans-serif",
        color: "#eef0ff",
      }}
    >
      {/* Tab bar */}
      <div
        onMouseDown={(e) => { onFocus(); onDragStart(e, activeDock.id) }}
        style={{
          display: "flex",
          alignItems: "center",
          background: activeDock.dragging ? "rgba(108, 99, 255, 0.15)" : "rgba(26, 26, 46, 0.6)",
          cursor: activeDock.dragging ? "grabbing" : "grab",
          borderBottom: "1px solid rgba(42, 42, 74, 0.4)",
          userSelect: "none",
          minHeight: 32,
        }}
      >
        {docks.map((d) => (
          <div
            key={d.id}
            role="tab"
            aria-selected={d.tabActive}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onTabSelect(groupId, d.id)
              }
            }}
            onMouseDown={(e) => { e.stopPropagation(); onTabDragStart(e, d.id) }}
            onClick={(e) => { e.stopPropagation(); onTabSelect(groupId, d.id) }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: d.tabActive ? 600 : 400,
              color: d.tabActive ? "#eef0ff" : "#9aa0c0",
              background: d.tabActive ? "rgba(108, 99, 255, 0.12)" : "transparent",
              borderBottom: d.tabActive ? "2px solid #6c63ff" : "2px solid transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.15s",
              borderRight: "1px solid rgba(42, 42, 74, 0.3)",
            }}
          >
            <span style={{ fontSize: 12 }}>{d.config.icon}</span>
            <span>{d.config.title}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 2, padding: "0 6px" }}>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(activeDock.id) }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: activeDock.pinned ? "#6c63ff" : "#9aa0c0",
              fontSize: 11, padding: "0 2px", lineHeight: 1,
            }}
          >📌</button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(activeDock.id) }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#9aa0c0", fontSize: 13, padding: "0 2px", lineHeight: 1,
            }}
          >{activeDock.collapsed ? "▸" : "▾"}</button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(activeDock.id) }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#9aa0c0", fontSize: 13, padding: "0 2px", lineHeight: 1,
            }}
          >✕</button>
        </div>
      </div>

      {/* Active tab content */}
      {!activeDock.collapsed && (
        <div style={{ padding: "8px 10px", overflow: "auto", maxHeight: activeDock.size.height - 36 }}>
          <DockContent dockId={activeDock.id} config={activeDock.config} />
        </div>
      )}

      {/* Resize handle */}
      {!activeDock.collapsed && (
        <div
          onMouseDown={(e) => onResizeStart(e, activeDock.id)}
          style={{
            position: "absolute", right: 0, bottom: 0, width: 16, height: 16,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 50%, rgba(108,99,255,0.4) 50%)",
            borderRadius: "0 0 10px 0",
          }}
        />
      )}
    </div>
  )
}

// ── Single standalone dock ──
function StandaloneDock({
  dock,
  globalOpacity,
  dropTarget,
  focused,
  onFocus,
  onDragStart,
  onDrag,
  onDragEnd,
  onResizeStart,
  onResize,
  onResizeEnd,
  onToggleCollapse,
  onTogglePin,
  onClose,
}: {
  dock: DockableState
  globalOpacity: number
  dropTarget: string | null
  focused: boolean
  onFocus: () => void
  onDragStart: (e: React.MouseEvent, id: string) => void
  onDrag: (e: globalThis.MouseEvent, id: string) => void
  onDragEnd: (e: globalThis.MouseEvent, id: string) => void
  onResizeStart: (e: React.MouseEvent, id: string) => void
  onResize: (e: globalThis.MouseEvent, id: string) => void
  onResizeEnd: (e: globalThis.MouseEvent, id: string) => void
  onToggleCollapse: (id: string) => void
  onTogglePin: (id: string) => void
  onClose: (id: string) => void
}) {
  const dockRef = useRef<HTMLDivElement>(null)
  const isDropTarget = dropTarget === dock.id

  useEffect(() => {
    if (!dock.dragging) return
    const onMove = (e: MouseEvent) => onDrag(e, dock.id)
    const onUp = (e: MouseEvent) => onDragEnd(e, dock.id)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [dock.dragging, dock.id, onDrag, onDragEnd])

  useEffect(() => {
    if (!dock.resizing) return
    const onMove = (e: MouseEvent) => onResize(e, dock.id)
    const onUp = (e: MouseEvent) => onResizeEnd(e, dock.id)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [dock.resizing, dock.id, onResize, onResizeEnd])

  if (!dock.visible) return null

  return (
    <div
      ref={dockRef}
      data-dock-id={dock.id}
      style={{
        position: "fixed",
        left: dock.position.x,
        top: dock.position.y,
        width: dock.size.width,
        height: dock.collapsed ? 36 : dock.size.height,
        opacity: globalOpacity,
        background: "rgba(13, 13, 26, 0.92)",
        border: isDropTarget
          ? "2px solid #6c63ff"
          : dock.pinned ? "1px solid var(--accent, #6c63ff)" : "1px solid rgba(42, 42, 74, 0.8)",
        borderRadius: 10,
        boxShadow: isDropTarget ? "0 0 20px rgba(108,99,255,0.4)" : "0 8px 32px rgba(0,0,0,.5)",
        zIndex: dock.dragging ? 100 : focused ? 50 : 10,
        transition: dock.dragging || dock.resizing ? "none" : "opacity 0.2s, border-color 0.2s, box-shadow 0.2s",
        overflow: "hidden",
        fontFamily: "13px/1.5 system-ui, sans-serif",
        color: "#eef0ff",
      }}
    >
      {/* Title bar — click focuses, double-click toggles collapse */}
      <div
        onMouseDown={(e) => { onFocus(); onDragStart(e, dock.id) }}
        onDoubleClick={(e) => { e.preventDefault(); onToggleCollapse(dock.id) }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: dock.dragging ? "rgba(108, 99, 255, 0.15)" : "rgba(26, 26, 46, 0.6)",
          cursor: dock.dragging ? "grabbing" : "grab",
          borderBottom: "1px solid rgba(42, 42, 74, 0.4)",
          userSelect: "none",
          fontSize: 12,
        }}
      >
        <span style={{ fontSize: 14 }}>{dock.config.icon}</span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 12 }}>{dock.config.title}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(dock.id) }}
          title={dock.pinned ? "Unpin" : "Pin to top"}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: dock.pinned ? "#6c63ff" : "#9aa0c0",
            fontSize: 11, padding: "0 2px", lineHeight: 1,
          }}
        >📌</button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(dock.id) }}
          title={dock.collapsed ? "Expand" : "Collapse"}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#9aa0c0", fontSize: 13, padding: "0 2px", lineHeight: 1,
          }}
        >{dock.collapsed ? "▸" : "▾"}</button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(dock.id) }}
          title="Hide panel"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#9aa0c0", fontSize: 13, padding: "0 2px", lineHeight: 1,
          }}
        >✕</button>
      </div>

      {/* Content */}
      {!dock.collapsed && (
        <div style={{ padding: "8px 10px", overflow: "auto", maxHeight: dock.size.height - 36 }}>
          <DockContent dockId={dock.id} config={dock.config} />
        </div>
      )}

      {/* Resize handle */}
      {!dock.collapsed && (
        <div
          onMouseDown={(e) => onResizeStart(e, dock.id)}
          style={{
            position: "absolute", right: 0, bottom: 0, width: 16, height: 16,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 50%, rgba(108,99,255,0.4) 50%)",
            borderRadius: "0 0 10px 0",
          }}
        />
      )}
    </div>
  )
}

export function DockablePreview({ suiteId, onClose }: { suiteId: string; onClose: () => void }) {
  const configs = SUITE_DOCKABLES[suiteId] || SUITE_DOCKABLES.generic
  const feed = useTradingFeed()
  const [docks, setDocks] = useState<DockableState[]>(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200
    const vh = typeof window !== "undefined" ? window.innerHeight : 800
    return configs.map((c, i) => ({
      id: c.id,
      config: c,
      visible: true,
      position: positionFromLabel(c.defaultPosition, i, configs.length, vw, vh),
      size: { ...c.defaultSize },
      opacity: c.defaultOpacity,
      collapsed: c.defaultCollapsed,
      dragging: false,
      resizing: false,
      pinned: false,
      group: null,
      tabActive: true,
    }))
  })

  const [globalOpacity, setGlobalOpacity] = useState(0.92)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // Focus stacking: the last-interacted dock floats above its siblings.
  const [focusedId, setFocusedId] = useState<string | null>(null)

  // ESC + backdrop close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  // Viewport containment: when the window shrinks/rotates, pull every visible
  // dock back inside so nothing ends up unreachable off-screen.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setDocks((prev) => prev.map((d) => ({
          ...d,
          position: clampEdge(d.position, d.size, window.innerWidth, window.innerHeight)
        })))
      }, 120)
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      if (timer) clearTimeout(timer)
    }
  }, [])

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setFocusedId(id)
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      return { ...d, dragging: true, _dragStart: { mouseX: e.clientX, mouseY: e.clientY, elX: d.position.x, elY: d.position.y } } as any
    }))
  }, [])

  const handleDrag = useCallback((e: MouseEvent, id: string) => {
    setDocks((prev) => {
      let newDropTarget: string | null = null
      const updated = prev.map((d) => {
        if (d.id !== id || !d.dragging) return d
        const ds = (d as any)._dragStart
        if (!ds) return d
        const newX = ds.elX + (e.clientX - ds.mouseX)
        const newY = ds.elY + (e.clientY - ds.mouseY)
        const pos = clampEdge({ x: newX, y: newY }, d.size, window.innerWidth, window.innerHeight)
        // Check for drop targets (other visible non-grouped docks)
        for (const other of prev) {
          if (other.id === id || !other.visible || other.dragging || other.group) continue
          const overlap = rectsOverlap(
            { x: pos.x, y: pos.y, w: d.size.width, h: d.size.height },
            { x: other.position.x, y: other.position.y, w: other.size.width, h: other.size.height }
          )
          if (overlap) {
            newDropTarget = other.id
            break
          }
        }
        return { ...d, position: pos }
      })
      // Only update dropTarget if it changed
      if (newDropTarget !== dropTarget) setDropTarget(newDropTarget)
      return updated
    })
  }, [dropTarget])

  const handleDragEnd = useCallback((_e: MouseEvent, id: string) => {
    setDocks((prev) => {
      const dragged = prev.find((d) => d.id === id)
      const target = dropTarget
      setDropTarget(null)

      if (target && dragged) {
        // Group: put dragged dock into target's group (or create a new group)
        const targetDock = prev.find((d) => d.id === target)
        const groupId = targetDock?.group || `group-${target}-${Date.now()}`
        return prev.map((d) => {
          if (d.id === id) {
            const { _dragStart, ...rest } = d as any
            return { ...rest, dragging: false, group: groupId, tabActive: false, position: targetDock?.position || d.position, size: targetDock?.size || d.size }
          }
          if (d.id === target) {
            return { ...d, group: groupId, tabActive: true }
          }
          if (d.group === groupId && d.id !== target) {
            return { ...d, group: groupId, tabActive: false }
          }
          return d
        })
      }

      return prev.map((d) => {
        if (d.id !== id) return d
        const { _dragStart, ...rest } = d as any
        return { ...rest, dragging: false }
      })
    })
  }, [dropTarget])

  const handleResizeStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      return { ...d, resizing: true, _resizeStart: { mouseX: e.clientX, mouseY: e.clientY, w: d.size.width, h: d.size.height, x: d.position.x, y: d.position.y } } as any
    }))
  }, [])

  const handleResize = useCallback((e: MouseEvent, id: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id || !d.resizing) return d
      const rs = (d as any)._resizeStart
      if (!rs) return d
      // Never grow past the viewport edge — width/height are capped by the
      // space remaining between the dock's top-left corner and the window.
      const maxW = Math.max(MIN_DOCK_W, window.innerWidth - rs.x - EDGE_DOCK_THRESHOLD)
      const maxH = Math.max(MIN_DOCK_H, window.innerHeight - rs.y - EDGE_DOCK_THRESHOLD)
      const newSize = {
        width: Math.min(maxW, Math.max(MIN_DOCK_W, rs.w + (e.clientX - rs.mouseX))),
        height: Math.min(maxH, Math.max(MIN_DOCK_H, rs.h + (e.clientY - rs.mouseY))),
      }
      // If grouped, resize all docks in the group
      if (d.group) {
        return prev.map((gd) => gd.group === d.group ? { ...gd, size: newSize } : gd).find((gd) => gd.id === d.id) || d
      }
      return { ...d, size: newSize }
    }))
  }, [])

  const handleResizeEnd = useCallback((_e: MouseEvent, id: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      const { _resizeStart, ...rest } = d as any
      return { ...rest, resizing: false }
    }))
  }, [])

  // Tab drag (ungroup)
  const handleTabDragStart = useCallback((e: React.MouseEvent, dockId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDocks((prev) => prev.map((d) => {
      if (d.id !== dockId) return d
      return { ...d, _tabDragging: true, _tabDragStart: { mouseX: e.clientX, mouseY: e.clientY, elX: d.position.x, elY: d.position.y } } as any
    }))
  }, [])

  const handleTabDrag = useCallback((e: MouseEvent, dockId: string) => {
    setDocks((prev) => {
      const dock = prev.find((d) => d.id === dockId) as any
      if (!dock?._tabDragging) return prev
      const ds = dock._tabDragStart
      const dx = Math.abs(e.clientX - ds.mouseX)
      const dy = Math.abs(e.clientY - ds.mouseY)
      // Only ungroup if dragged far enough (not just a click)
      if (dx < 10 && dy < 10) return prev
      const groupId = dock.group
      if (!groupId) return prev
      // Ungroup: remove from group, create standalone
      return prev.map((d) => {
        if (d.id === dockId) {
          const { _tabDragging, _tabDragStart, ...rest } = d as any
          return { ...rest, group: null, tabActive: true, position: { x: e.clientX - 50, y: e.clientY - 16 }, _dragStart: { mouseX: e.clientX, mouseY: e.clientY, elX: e.clientX - 50, elY: e.clientY - 16 }, dragging: true }
        }
        // If only 2 in group and one leaves, dissolve group
        if (d.group === groupId) {
          const remaining = prev.filter((rd) => rd.group === groupId && rd.id !== dockId)
          if (remaining.length === 1) {
            return { ...d, group: null, tabActive: true }
          }
          return { ...d, tabActive: true }
        }
        return d
      })
    })
  }, [])

  const handleTabDragEnd = useCallback((_e: MouseEvent, dockId: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== dockId) return d
      const { _tabDragging, _tabDragStart, ...rest } = d as any
      return { ...rest, dragging: false }
    }))
  }, [])

  const toggleCollapse = useCallback((id: string) => {
    setDocks((prev) => {
      const dock = prev.find((d) => d.id === id)
      if (dock?.group) {
        return prev.map((d) => d.group === dock.group ? { ...d, collapsed: !d.collapsed } : d)
      }
      return prev.map((d) => d.id === id ? { ...d, collapsed: !d.collapsed } : d)
    })
  }, [])

  const togglePin = useCallback((id: string) => {
    setDocks((prev) => {
      const dock = prev.find((d) => d.id === id)
      if (dock?.group) {
        return prev.map((d) => d.group === dock.group ? { ...d, pinned: !d.pinned } : d)
      }
      return prev.map((d) => d.id === id ? { ...d, pinned: !d.pinned } : d)
    })
  }, [])

  const hideDock = useCallback((id: string) => {
    setDocks((prev) => {
      const dock = prev.find((d) => d.id === id)
      if (dock?.group) {
        const groupId = dock.group
        const remaining = prev.filter((d) => d.group === groupId && d.id !== id)
        if (remaining.length <= 1) {
          // Dissolve group
          return prev.map((d) => {
            if (d.id === id) return { ...d, visible: false, group: null }
            if (d.group === groupId) return { ...d, group: null, tabActive: true }
            return d
          })
        }
        return prev.map((d) => {
          if (d.id === id) return { ...d, visible: false, group: null }
          if (d.group === groupId && d.tabActive) {
            const next = remaining[0]
            return { ...d, tabActive: d.id === next.id }
          }
          return d
        })
      }
      return prev.map((d) => d.id === id ? { ...d, visible: false } : d)
    })
  }, [])

  const selectTab = useCallback((groupId: string, dockId: string) => {
    setDocks((prev) => prev.map((d) => d.group === groupId ? { ...d, tabActive: d.id === dockId } : d))
  }, [])

  const resetAll = useCallback(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    setDocks((prev) => prev.map((d, i) => ({
      ...d,
      visible: true,
      position: positionFromLabel(d.config.defaultPosition, i, prev.length, vw, vh),
      size: { ...d.config.defaultSize },
      collapsed: d.config.defaultCollapsed,
      pinned: false,
      group: null,
      tabActive: true,
    })))
  }, [])

  const visibleDocks = docks.filter((d) => d.visible)
  const ungrouped = visibleDocks.filter((d) => !d.group)
  const groups = new Map<string, DockableState[]>()
  for (const d of visibleDocks) {
    if (!d.group) continue
    if (!groups.has(d.group)) groups.set(d.group, [])
    groups.get(d.group)!.push(d)
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483646,
        background: "rgba(10, 10, 30, 0.7)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          background: "rgba(13, 13, 26, 0.85)",
          borderBottom: "1px solid rgba(42, 42, 74, 0.5)",
          zIndex: 200,
          fontFamily: "13px/1.5 system-ui, sans-serif",
          color: "#eef0ff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🎯</span>
          <strong>Overlay Preview</strong>
          <span style={{ opacity: 0.6, fontSize: 12 }}>
            {visibleDocks.length}/{docks.length} panels · Drag onto another dock to group · Drag tab out to ungroup · ESC to close
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Global opacity */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9aa0c0" }}>
            <span>Opacity</span>
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(globalOpacity * 100)}
              onChange={(e) => setGlobalOpacity(Number(e.target.value) / 100)}
              title={`Opacity: ${Math.round(globalOpacity * 100)}%`}
              style={{ width: 80, height: 3 }}
            />
            <span style={{ width: 28, textAlign: "right" }}>{Math.round(globalOpacity * 100)}%</span>
          </div>
          <button
            onClick={() => setShowSettings((s) => !s)}
            style={{
              background: showSettings ? "rgba(108, 99, 255, 0.25)" : "rgba(108, 99, 255, 0.15)",
              border: "1px solid rgba(108, 99, 255, 0.3)",
              borderRadius: 6, color: "#eef0ff", padding: "4px 12px", cursor: "pointer", fontSize: 12,
            }}
          >
            ⚙ Settings
          </button>
          <button
            onClick={resetAll}
            style={{
              background: "rgba(108, 99, 255, 0.15)",
              border: "1px solid rgba(108, 99, 255, 0.3)",
              borderRadius: 6, color: "#eef0ff", padding: "4px 12px", cursor: "pointer", fontSize: 12,
            }}
          >
            ↺ Reset
          </button>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255, 107, 107, 0.15)",
              border: "1px solid rgba(255, 107, 107, 0.3)",
              borderRadius: 6, color: "#eef0ff", padding: "4px 12px", cursor: "pointer", fontSize: 12,
            }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Settings flyout */}
      {showSettings && (
        <div
          style={{
            position: "absolute",
            top: 52,
            right: 20,
            width: 240,
            background: "rgba(13, 13, 26, 0.95)",
            border: "1px solid #2a2a4a",
            borderRadius: 8,
            padding: 12,
            zIndex: 201,
            boxShadow: "0 8px 32px rgba(0,0,0,.5)",
            fontFamily: "12px/1.4 system-ui, sans-serif",
            color: "#eef0ff",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12, color: "#6c63ff", marginBottom: 8 }}>Panel Visibility</div>
          {docks.map((d) => (
            <label
              key={d.id}
              style={{
                display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "3px 0",
                cursor: "pointer", opacity: d.visible ? 1 : 0.5,
              }}
            >
              <input
                type="checkbox"
                checked={d.visible}
                onChange={() => {
                  if (d.visible) hideDock(d.id)
                  else setDocks((prev) => prev.map((p) => p.id === d.id ? { ...p, visible: true } : p))
                }}
                style={{ width: 12, height: 12 }}
              />
              <span>{d.config.icon}</span>
              <span>{d.config.title}</span>
            </label>
          ))}
        </div>
      )}

      {/* Grouped dock containers */}
      <FeedContext.Provider value={feed}>
        {Array.from(groups.entries()).map(([groupId, groupDocks]) => (
          <GroupContainer
            key={groupId}
            groupId={groupId}
            docks={groupDocks}
            globalOpacity={globalOpacity}
            focused={groupDocks.some((d) => d.id === focusedId)}
            onFocus={() => setFocusedId(groupId)}
            onTabSelect={selectTab}
            onTabDragStart={handleTabDragStart}
            onTabDrag={handleTabDrag}
            onTabDragEnd={handleTabDragEnd}
            onDragStart={handleDragStart}
            onResizeStart={handleResizeStart}
            onToggleCollapse={toggleCollapse}
            onTogglePin={togglePin}
            onClose={hideDock}
          />
        ))}

        {/* Standalone docks */}
        {ungrouped.map((dock) => (
          <StandaloneDock
            key={dock.id}
            dock={dock}
            globalOpacity={globalOpacity}
            dropTarget={dropTarget}
            focused={focusedId === dock.id}
            onFocus={() => setFocusedId(dock.id)}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
            onToggleCollapse={toggleCollapse}
            onTogglePin={togglePin}
            onClose={hideDock}
          />
        ))}
      </FeedContext.Provider>

      {/* Bottom legend */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "10px 20px",
          background: "rgba(13, 13, 26, 0.85)",
          borderTop: "1px solid rgba(42, 42, 74, 0.5)",
          zIndex: 200,
          fontFamily: "11px/1.5 system-ui, sans-serif",
          color: "#9aa0c0",
        }}
      >
        {docks.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              if (d.visible) hideDock(d.id)
              else setDocks((prev) => prev.map((p) => p.id === d.id ? { ...p, visible: true } : p))
            }}
            style={{
              background: d.visible ? "rgba(108, 99, 255, 0.2)" : "transparent",
              border: `1px solid ${d.visible ? "#6c63ff" : "#333"}`,
              borderRadius: 4,
              color: d.visible ? "#eef0ff" : "#9aa0c0",
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 11,
              transition: "all 0.15s",
            }}
          >
            {d.config.icon} {d.config.title}
          </button>
        ))}
      </div>
    </div>
  )
}
