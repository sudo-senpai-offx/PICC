import { useEffect, useRef, useState } from "react"
import { Badge, Button, Card, Field, Input, Select, Spinner, Textarea } from "@/components/ui"
import { LiveMarketBoard } from "@/components/LiveMarketBoard"
import { MarketIntelPanel } from "@/components/MarketIntelPanel"
import { LiveDecisionsPanel } from "@/components/LiveDecisionsPanel"
import { LedgerPanel } from "@/components/LedgerPanel"
import { TradingChart } from "@/components/TradingChart"
import { BacktestPanel } from "@/components/BacktestPanel"
import { AdvancedIndicatorsPanel } from "@/components/AdvancedIndicatorsPanel"
import { AlertPanel } from "@/components/AlertPanel"
import { CalendarPanel } from "@/components/CalendarPanel"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { getExtensionStatus } from "@/lib/api"
import type { ExtensionStatus } from "@/lib/api"
import {
  addToWatchlist,
  analyzeExpertOptionAsset,
  askTradingAssistant,
  closePaperTrade,
  EXPERTOPTION_QUICK_ASSETS,
  getAutopilotConfig,
  getDemoAnalytics,
  getDemoDeals,
  getExpertOptionDemoStatus,
  getMarketNews,
  getPaperAnalytics,
  getPaperHistory,
  getPaperPositions,
  getSignalAccuracy,
  getTradingSignals,
  getTradingStatus,
  getWatchlistQuotes,
  logSignal,
  openPaperTrade,
  predictSymbol,
  proAnalyzeExpertOption,
  proAnalyzeSymbol,
  removeFromWatchlist,
  resolveTradingSignal,
  saveAutopilotConfig,
  scanSymbols,
  startAutopilot,
  stopAutopilot,
  summarizeProAnalysis
} from "@/lib/trading"
import type {
  AutopilotConfig,
  ClosedTrade,
  DemoAnalyticsResult,
  DemoDeal,
  ExpertOptionDemoStatus,
  MarketNewsResult,
  PaperAnalyticsResult,
  PaperPosition,
  PaperOverview,
  PredictionResult,
  ProAnalysisResult,
  ProNarrativeResult,
  ScanResult,
  SignalAccuracy,
  TradingMetrics,
  TradingSignal,
  WatchlistQuote
} from "@/lib/trading"

const STRATEGY_PROFILES = [
  { id: "grid", label: "Grid Trading", desc: "Orders at fixed intervals across a price range. Buy low, sell high on every swing." },
  { id: "dca", label: "DCA (Dollar-Cost)", desc: "Buys dips via dollar-cost averaging. Lowers average cost over time." },
  { id: "trailing", label: "Adaptive Trailing", desc: "Grid + DCA with trailing. Follows trends upward, sells on reversals." },
  { id: "momentum", label: "Momentum", desc: "Rides directional moves with RSI/MACD entry signals and ATR-based stops." },
  { id: "mean-reversion", label: "Mean Reversion", desc: "Fades extended moves. Enters when price deviates >2σ from rolling mean." },
  { id: "custom", label: "Custom / Pro Analysis", desc: "Uses PICC pro-analysis confluence score as the entry gate. Full indicator fusion." }
] as const

type StrategyId = typeof STRATEGY_PROFILES[number]["id"]

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—"
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Human duration from a millisecond span (e.g. "3m 12s"). */
function fmtHold(ms: number | null): string {
  if (ms == null) return "—"
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

/** Markets & prediction — analytics, decisions, paper trading, signals, watchlist. */
export function MarketsSuite() {
  const [status, setStatus] = useState<{ paper: PaperOverview; riskPerTradePct: number } | null>(null)
  const [positions, setPositions] = useState<PaperPosition[]>([])
  const [closed, setClosed] = useState<ClosedTrade[]>([])
  const [signals, setSignals] = useState<TradingSignal[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [chartAsset, setChartAsset] = useState("EURUSD")
  const lastLoadAt = useRef(0)
  const { snapshot, error: streamError } = useRealtimeSuite()

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      getTradingStatus(),
      getPaperPositions(),
      getPaperHistory(),
      getTradingSignals()
    ]).then(([s, p, h, g]) => {
      if (!alive) return
      if (s.status === "fulfilled") setStatus(s.value)
      if (p.status === "fulfilled") setPositions(p.value.positions)
      if (h.status === "fulfilled") setClosed(h.value.closed)
      if (g.status === "fulfilled") setSignals(g.value.signals)
      lastLoadAt.current = Date.now()
      setLoaded(true)
    })
    return () => { alive = false }
  }, [reloadKey])

  useEffect(() => {
    if (!snapshot || snapshot.ts < lastLoadAt.current) return
    if (snapshot.trading) setStatus(snapshot.trading)
    if (snapshot.positions) setPositions(snapshot.positions)
    if (snapshot.closed) setClosed(snapshot.closed)
    if (snapshot.signals) setSignals(snapshot.signals)
  }, [snapshot])

  const watchedAssets = snapshot?.live?.watched ?? []

  const refresh = () => setReloadKey((k) => k + 1)

  return (
    <div className="stack">
      {streamError ? <p className="danger-text small">{streamError}</p> : null}
      {!loaded ? (
        <Spinner label="Loading trading suite…" />
      ) : (
        <>
          <StatusCards
            paper={status?.paper ?? null}
            riskPct={status?.riskPerTradePct ?? 2}
            demo={snapshot?.demo ?? null}
            liveAccount={snapshot?.live?.account ?? null}
          />
          <Card className="pad stack">
            <div className="row-between" style={{ alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Live Chart</h3>
              <div className="row gap" style={{ alignItems: "center" }}>
                <Select value={chartAsset} onChange={(e) => setChartAsset(e.target.value)}>
                  {watchedAssets.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                  <option value="EURUSD">EURUSD</option>
                  <option value="BTCUSD">BTCUSD</option>
                  <option value="AAPL">AAPL</option>
                  <option value="TSLA">TSLA</option>
                </Select>
                <span className="muted small">
                  {chartAsset} · {watchedAssets.includes(chartAsset) ? "EO live" : "Yahoo"}
                </span>
              </div>
            </div>
            <TradingChart assetId={chartAsset} height={380} />
          </Card>
          <MarketIntelPanel />
          <LiveMarketBoard />
          <LiveDecisionsPanel />
          <LedgerPanel />
          <PredictionCard recordSignal={refresh} />
          <ProAnalysisCard />
          <BacktestPanel />
          <AdvancedIndicatorsPanel assetId={chartAsset} timeframe="daily" />
          <AlertPanel />
          <CalendarPanel />
          <div className="grid">
            <PaperTradingCard positions={positions} closed={closed} refresh={refresh} />
            <div className="stack">
              <TradePlannerCard />
              <SignalsCard signals={signals} refresh={refresh} />
              <AssistantCard status={status?.paper ?? null} />
            </div>
          </div>
          <div className="grid">
            <WatchlistScannerCard />
            <NewsCard />
          </div>
          <PaperAnalyticsCard />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Autopilot Suite — automation-focused with extension metrics
// ---------------------------------------------------------------------
export function AutopilotSuite() {
  const [config, setConfig] = useState<AutopilotConfig | null>(null)
  const [cfg, setCfg] = useState<AutopilotConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [strategy, setStrategy] = useState<StrategyId>("grid")
  const [demo, setDemo] = useState<ExpertOptionDemoStatus | null>(null)
  const [analytics, setAnalytics] = useState<DemoAnalyticsResult | null>(null)
  const [deals, setDeals] = useState<DemoDeal[]>([])
  const [extension, setExtension] = useState<ExtensionStatus | null>(null)
  const lastLoadAt = useRef(0)
  const { snapshot } = useRealtimeSuite()

  const load = async () => {
    try {
      const [c, d, a, dl, ext] = await Promise.allSettled([
        getAutopilotConfig(),
        getExpertOptionDemoStatus(),
        getDemoAnalytics().catch(() => null),
        getDemoDeals(30).catch(() => ({ ok: false, deals: [] as DemoDeal[] })),
        getExtensionStatus()
      ])
      lastLoadAt.current = Date.now()
      if (c.status === "fulfilled" && c.value.ok) {
        setConfig(c.value.config)
        setCfg(c.value.config)
      }
      if (d.status === "fulfilled") setDemo(d.value)
      if (a.status === "fulfilled" && a.value) setAnalytics(a.value)
      if (dl.status === "fulfilled" && dl.value.ok) setDeals(dl.value.deals)
      if (ext.status === "fulfilled") setExtension(ext.value)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (!snapshot || snapshot.ts < lastLoadAt.current) return
    if (snapshot.demo) setDemo(snapshot.demo)
    if (snapshot.analytics) setAnalytics(snapshot.analytics)
    if (snapshot.deals) setDeals(snapshot.deals.ok ? snapshot.deals.deals : [])
  }, [snapshot])

  const toggleAuto = async () => {
    setBusy(true)
    try {
      const r = config?.enabled ? await stopAutopilot("user") : await startAutopilot()
      if (r.ok) { setConfig(r.config); setCfg(r.config) }
      await load()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const emergencyStop = async () => {
    setBusy(true)
    try {
      const r = await stopAutopilot("emergency-kill-switch")
      if (r.ok) { setConfig(r.config); setCfg(r.config) }
      setMsg({ ok: true, text: "Emergency stop executed. All autopilot activity halted." })
      await load()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const saveCfg = async () => {
    if (!cfg) return
    setBusy(true)
    try {
      const patch: Record<string, unknown> = { ...cfg, strategy }
      const r = await saveAutopilotConfig(patch as Partial<AutopilotConfig>)
      if (r.ok) { setConfig(r.config); setCfg(r.config); setMsg({ ok: true, text: "Autopilot settings saved." }) }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const updateCfg = (patch: Partial<AutopilotConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c))
  const running = config?.enabled ?? false
  const auto = demo?.autopilot ?? null

  return (
    <div className="stack">
      <p className="muted">
        Automated trading engine — configure strategy, risk controls, and asset scope.
        The autopilot monitors markets and executes within your rules. You always stay in control.
      </p>

      {/* ─── Control Bar ─── */}
      <Card className="pad" style={{ border: running ? "1px solid var(--success, #22c55e)" : undefined }}>
        <div className="row-between" style={{ alignItems: "center" }}>
          <div className="row gap" style={{ alignItems: "center" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: running ? "#22c55e" : "#666" }} />
            <strong>{running ? "Autopilot Running" : "Autopilot Stopped"}</strong>
            {auto?.lastDecision ? <span className="muted small">last: {auto.lastDecision}</span> : null}
          </div>
          <div className="row gap">
            <Button variant="danger" className="btn-sm" disabled={busy} onClick={emergencyStop}>
              Kill Switch
            </Button>
            <Button variant={running ? "secondary" : "primary"} disabled={busy} onClick={toggleAuto}>
              {running ? "Stop Autopilot" : "Start Autopilot"}
            </Button>
          </div>
        </div>
      </Card>

      {/* ─── Live Chart ─── */}
      {cfg?.assetId ? (
        <Card className="pad stack">
          <TradingChart assetId={cfg.assetId} height={340} />
        </Card>
      ) : null}

      {/* ─── Quick Stats ─── */}
      <div className="grid grid-4">
        <Card className="pad">
          <div className="stat-label muted">Today PnL</div>
          <div className="stat-value">{fmtMoney(demo?.todayPnl)}</div>
          <div className="muted small">{demo?.todayTrades ?? 0} trades today</div>
        </Card>
        <Card className="pad">
          <div className="stat-label muted">Win Rate</div>
          <div className="stat-value">{analytics?.overview.winRate != null ? `${analytics.overview.winRate}%` : "—"}</div>
          <div className="muted small">{analytics?.overview.wins ?? 0}W · {analytics?.overview.losses ?? 0}L</div>
        </Card>
        <Card className="pad">
          <div className="stat-label muted">Balance</div>
          <div className="stat-value">{fmtMoney(demo?.balance)}</div>
          <div className="muted small">{demo?.currency ?? "USD"} · {demo?.demo ? "demo" : "live"}</div>
        </Card>
        <Card className="pad">
          <div className="stat-label muted">Max Drawdown</div>
          <div className="stat-value">{analytics?.metrics.maxDrawdown != null ? `${analytics.metrics.maxDrawdown}%` : "—"}</div>
          <div className="muted small">avg hold {analytics?.overview.avgDurationSec != null ? `${analytics.overview.avgDurationSec}s` : "—"}</div>
        </Card>
      </div>

      {/* ─── Extension Status ─── */}
      {extension?.installed ? (
        <Card className="pad" style={{ border: "1px solid var(--success, #22c55e)" }}>
          <div className="row-between" style={{ alignItems: "center" }}>
            <div className="row gap" style={{ alignItems: "center" }}>
              <span>🧩</span>
              <strong className="small">PICC Extension Connected</strong>
              {extension.lastHeartbeat?.version ? <Badge tone="success">v{extension.lastHeartbeat.version}</Badge> : null}
            </div>
            <Badge tone="success">active — heartbeat live</Badge>
          </div>
          <div className="grid grid-3 muted small" style={{ marginTop: 6 }}>
            <div>active tab: <strong>{extension.lastHeartbeat?.activeTab?.title || extension.lastHeartbeat?.activeTab?.url || "none"}</strong></div>
            <div>cookies: <strong>{extension.lastHeartbeat?.cookieCount ?? 0}</strong></div>
            <div>last heartbeat: <strong>{extension.lastHeartbeat?.timestamp ? new Date(extension.lastHeartbeat.timestamp).toLocaleTimeString() : "—"}</strong></div>
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>
            Extension is injecting automation hooks into target pages. Background service worker
            relays heartbeat every 12s. Autopilot can leverage browser-level metrics, page state,
            form detection, safe clicking, cookie access, and DOM analysis for smarter decisions.
          </p>
        </Card>
      ) : (
        <Card className="pad">
          <div className="row-between" style={{ alignItems: "center" }}>
            <div className="row gap" style={{ alignItems: "center" }}>
              <span>🧩</span>
              <strong className="small">PICC Extension</strong>
            </div>
            <Badge tone="muted">not installed</Badge>
          </div>
          <p className="muted small">
            Install the PICC browser extension for full autopilot automation. It provides page-level hooks,
            form detection, safe clicking, cookie access, and real-time metrics relay to the server.
            Load as unpacked from <code>extensions/picc-overlay/</code>.
          </p>
        </Card>
      )}

      <div className="grid">
        {/* ─── Strategy Selector ─── */}
        <Card className="pad stack">
          <h3>Strategy</h3>
          <p className="muted small">Pick the engine logic. Each strategy has different entry/exit rules and risk behavior.</p>
          <div className="stack">
            {STRATEGY_PROFILES.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                className="card pad"
                style={{
                  border: strategy === s.id ? "1px solid var(--accent, #6c63ff)" : "1px solid transparent",
                  cursor: "pointer",
                  transition: "border-color 0.15s"
                }}
                onClick={() => setStrategy(s.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setStrategy(s.id) }}
              >
                <div className="row-between">
                  <strong className="small">{s.label}</strong>
                  {strategy === s.id ? <Badge tone="success">selected</Badge> : null}
                </div>
                <p className="muted small" style={{ margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* ─── Risk Controls ─── */}
        <Card className="pad stack">
          <h3>Risk Controls</h3>
          <p className="muted small">Hard limits that the autopilot must respect. These cannot be overridden during runtime.</p>
          {cfg ? (
            <div className="stack">
              <div className="grid grid-2">
                <Field label="Asset">
                  <Input value={cfg.assetId} onChange={(e) => updateCfg({ assetId: e.target.value.toUpperCase() })} />
                </Field>
                <Field label="Duration (s)">
                  <Input type="number" value={cfg.duration} onChange={(e) => updateCfg({ duration: Number(e.target.value) || 60 })} />
                </Field>
                <Field label="Amount per trade">
                  <Input type="number" min={1} placeholder="auto" value={cfg.amount ?? ""} onChange={(e) => updateCfg({ amount: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <Field label="Min confidence %">
                  <Input type="number" min={1} max={100} value={cfg.minConfidence} onChange={(e) => updateCfg({ minConfidence: Number(e.target.value) })} />
                </Field>
              </div>

              <h4 className="small" style={{ marginTop: 8 }}>Position Management</h4>
              <div className="grid grid-2">
                <Field label="Cooldown between trades (ms)">
                  <Input type="number" min={0} value={cfg.cooldownMs} onChange={(e) => updateCfg({ cooldownMs: Number(e.target.value) })} />
                </Field>
                <Field label="Max concurrent positions">
                  <Input type="number" min={1} value={cfg.maxConcurrent} onChange={(e) => updateCfg({ maxConcurrent: Number(e.target.value) })} />
                </Field>
              </div>

              <h4 className="small" style={{ marginTop: 8 }}>Loss Limits</h4>
              <div className="grid grid-2">
                <Field label="Daily loss limit %">
                  <Input type="number" min={0} max={100} value={cfg.dailyLossLimitPct} onChange={(e) => updateCfg({ dailyLossLimitPct: Number(e.target.value) })} />
                </Field>
                <Field label="Max daily trades (0 = unlimited)">
                  <Input type="number" min={0} value={cfg.maxDailyTrades} onChange={(e) => updateCfg({ maxDailyTrades: Number(e.target.value) })} />
                </Field>
              </div>

              <h4 className="small" style={{ marginTop: 8 }}>Signal Gates</h4>
              <div className="grid grid-2">
                <Field label="Confidence horizon (s)">
                  <Input type="number" value={cfg.timeframe} onChange={(e) => updateCfg({ timeframe: Number(e.target.value) || 60 })} />
                </Field>
                <div />
              </div>
              <ToggleRow label="AI gate (confirm with assistant)" checked={cfg.aiGate} onChange={() => updateCfg({ aiGate: !cfg.aiGate })} />
              <ToggleRow label="Pro-analysis gate (full indicator read)" checked={cfg.proGate} onChange={() => updateCfg({ proGate: !cfg.proGate })} />

              <Button variant="primary" disabled={busy} onClick={saveCfg}>
                {busy ? "Saving…" : "Save Autopilot Settings"}
              </Button>
            </div>
          ) : (
            <Spinner label="Loading config…" />
          )}
        </Card>
      </div>

      {/* ─── Open Deals + Settlements ─── */}
      <div className="grid">
        <Card className="pad stack">
          <h3>Open Deals ({demo?.openDeals?.length ?? 0})</h3>
          {demo?.openDeals?.length ? (
            demo.openDeals.map((d) => (
              <div key={d.serverId || d.requestId} className="row-between">
                <span className="muted small">
                  {d.asset} {d.type.toUpperCase()} {fmtMoney(d.amount)} · {d.status}
                </span>
                <span className="muted small">{d.expiresAt ? `exp ${new Date(d.expiresAt).toLocaleTimeString()}` : ""}</span>
              </div>
            ))
          ) : (
            <p className="muted small">No open deals. Start the autopilot to begin.</p>
          )}
        </Card>
        <Card className="pad stack">
          <h3>Recent Settlements</h3>
          {demo?.settled?.length ? (
            demo.settled.slice(0, 8).map((d, i) => (
              <div key={d.serverId || `${d.closedAt}-${i}`} className="row-between">
                <span className="muted small">
                  {d.asset} {d.type.toUpperCase()} {fmtMoney(d.amount)}
                </span>
                <Badge tone={d.result === "win" ? "success" : d.result === "loss" ? "danger" : "muted"}>
                  {d.result ?? "—"} {d.profit != null ? (d.profit >= 0 ? "+" : "") + d.profit.toFixed(2) : ""}
                </Badge>
              </div>
            ))
          ) : (
            <p className="muted small">No settlements yet.</p>
          )}
        </Card>
      </div>

      {/* ─── Analytics ─── */}
      {analytics ? (
        <Card className="pad stack">
          <div className="row-between">
            <h3>Autopilot Performance</h3>
            <Badge tone="muted">{analytics.overview.deals} total deals</Badge>
          </div>
          <div className="grid grid-4">
            <div>
              <div className="stat-label muted">Net Profit</div>
              <strong>{fmtMoney(analytics.overview.netProfit)}</strong>
            </div>
            <div>
              <div className="stat-label muted">Win Rate</div>
              <strong>{analytics.overview.winRate != null ? `${analytics.overview.winRate}%` : "—"}</strong>
            </div>
            <div>
              <div className="stat-label muted">Balance</div>
              <strong>{fmtMoney(analytics.overview.balance)}</strong>
            </div>
            <div>
              <div className="stat-label muted">Starting</div>
              <strong>{fmtMoney(analytics.overview.starting)}</strong>
            </div>
          </div>
          {analytics.metrics.equity.length > 1 ? (
            <div>
              <h4 className="small">Equity Curve</h4>
              <div className="row" style={{ gap: 2, alignItems: "flex-end", height: 64 }}>
                {(() => {
                  const eq = analytics.metrics.equity
                  const max = Math.max(...eq.map((x) => x.equity), 0.01)
                  const min = Math.min(...eq.map((x) => x.equity), 0)
                  const range = Math.max(max - min, 0.01)
                  return eq.map((p, i) => (
                    <div
                      key={i}
                      title={`${p.t ?? "start"} · ${fmtMoney(p.equity)}`}
                      className={p.pnl >= 0 ? "bar-fill" : "bar-fill bar-danger"}
                      style={{ height: `${Math.max(4, ((p.equity - min) / range) * 100)}%`, flex: 1, minWidth: 3 }}
                    />
                  ))
                })()}
              </div>
            </div>
          ) : null}
          {deals.length > 0 ? (
            <div>
              <h4 className="small">Deal History</h4>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Asset</th><th>Type</th><th>Amount</th><th>Open</th><th>Result</th><th>PnL</th></tr>
                  </thead>
                  <tbody>
                    {deals.slice(0, 15).map((d) => (
                      <tr key={d.serverId || d.requestId}>
                        <td>{d.asset}</td>
                        <td>{d.type.toUpperCase()}</td>
                        <td>{fmtMoney(d.amount)}</td>
                        <td>{d.openPrice}</td>
                        <td>{d.result ?? (d.status === "active" ? "active" : "—")}</td>
                        <td className={d.profit != null && d.profit < 0 ? "danger-text" : ""}>
                          {d.profit != null ? (d.profit >= 0 ? "+" : "") + d.profit.toFixed(2) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {msg ? <p className={msg.ok ? "muted" : "danger-text"}>{msg.text}</p> : null}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="row-between">
      <span className="field-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={checked ? "toggle toggle-on" : "toggle"}
        onClick={onChange}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------
// Status cards
// ---------------------------------------------------------------------
function StatusCards({
  paper,
  riskPct,
  demo,
  liveAccount
}: {
  paper: PaperOverview | null
  riskPct: number
  demo: ExpertOptionDemoStatus | null
  liveAccount: import("@/lib/liveTrading").LiveAccount | null
}) {
  const stat = (label: string, value: string, tone?: "success" | "danger") => (
    <Card className="pad">
      <div className="stat-label muted">{label}</div>
      <div className="stat-value">{value}</div>
      {tone ? <div className="muted small">{" "}</div> : null}
    </Card>
  )
  return (
    <div className="grid grid-4">
      {stat("Paper cash available", fmtMoney(paper?.cash))}
      {stat("Open notional", fmtMoney(paper?.committed))}
      {stat(
        "Realized PnL",
        fmtMoney(paper?.realizedPnl),
        paper && paper.realizedPnl >= 0 ? "success" : "danger"
      )}
      {stat(
        "Win rate",
        paper && paper.winRate != null ? `${paper.winRate}%` : "—",
        paper && paper.winRate != null && paper.winRate < 50 ? "danger" : "success"
      )}
      <Card className="pad">
        <div className="stat-label muted">Risk cap / trade</div>
        <div className="stat-value">{riskPct}%</div>
        <div className="muted small">of starting balance</div>
      </Card>
      <Card className="pad">
        <div className="stat-label muted">Closed trades</div>
        <div className="stat-value">{paper?.closedCount ?? 0}</div>
        <div className="muted small">best {fmtMoney(paper?.best)} · worst {fmtMoney(paper?.worst)}</div>
      </Card>
      <Card className="pad">
        <div className="stat-label muted">Today</div>
        <div className="stat-value">
          {fmtMoney(demo?.todayPnl)}
          {demo?.todayTrades ? <span className="muted small"> · {demo.todayTrades} deal{demo.todayTrades === 1 ? "" : "s"}</span> : null}
        </div>
        <div className="muted small">
          {demo?.autopilot?.maxDailyTrades
            ? `cap ${demo.todayTrades}/${demo.autopilot.maxDailyTrades} · daily loss ${demo.autopilot.dailyLossLimitPct}%`
            : demo?.autopilot
              ? `daily loss limit ${demo.autopilot.dailyLossLimitPct}%`
              : "no demo account linked"}
        </div>
      </Card>
      <Card className="pad">
        <div className="stat-label muted">ExpertOption account</div>
        {liveAccount ? (
          <div className="stat-value" style={{ fontSize: "0.95rem" }}>
            demo {fmtMoney(liveAccount.demoWallet?.balance)} · real {fmtMoney(liveAccount.realWallet?.balance)}
          </div>
        ) : (
          <div className="stat-value">{demo?.connected ? fmtMoney(demo.balance) : "—"}</div>
        )}
        <div className="muted small">
          {liveAccount
            ? `${liveAccount.name ?? "account"} · active: ${liveAccount.active ?? (liveAccount.demo ? "demo" : "real")}`
            : demo?.connected
              ? `${demo.currency ?? ""} · ${demo.demo ? "demo" : "real"} account`
              : demo?.configured
                ? "not connected"
                : "configure via card below"}
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------
// Prediction engine
// ---------------------------------------------------------------------
function PredictionCard({ recordSignal }: { recordSignal: () => void }) {
  const [symbol, setSymbol] = useState("EURUSD")
  const [days, setDays] = useState(3)
  const [result, setResult] = useState<PredictionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  // Predictions feed the signal ledger (which demands resolution). Opt-out so
  // a quick look doesn't silently create bookkeeping entries.
  const [autoSignal, setAutoSignal] = useState(true)

  const runPredict = async (sym: string, horizon: number, viaExpertOption: boolean) => {
    setBusy(true)
    setErr("")
    setResult(null)
    try {
      const r = viaExpertOption
        ? await analyzeExpertOptionAsset(sym, { timeframe: 60, count: 120, days: horizon })
        : await predictSymbol(sym, horizon)
      setResult(r)
      if (r.ok && r.direction && r.direction !== "flat" && autoSignal) {
        try {
          await logSignal({
            symbol: r.symbol ?? sym,
            direction: r.direction,
            confidence: r.confidence,
            strength: r.strength,
            note: r.note
          })
          recordSignal()
        } catch {
          /* best-effort signal log */
        }
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="pad stack">
      <h3>Prediction engine</h3>
      <p className="muted small">
        Momentum, mean-reversion, trend-fit and Monte-Carlo models, walk-forward backtested on the trailing window.
        Confidence below ~60% is effectively a coin flip — shown honestly.
      </p>
      <div className="grid grid-3">
        <Field label="Symbol / asset">
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Horizon (days)">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={5}>5 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
          </Select>
        </Field>
        <div className="row-end">
          <Button disabled={busy} onClick={() => runPredict(symbol, days, false)}>
            {busy ? "Analyzing…" : "Predict (Yahoo)"}
          </Button>
        </div>
      </div>
      <div className="row gap">
        <span className="muted small">ExpertOption quick assets:</span>
        {EXPERTOPTION_QUICK_ASSETS.map((a) => (
          <Button key={a.id} variant="ghost" disabled={busy} onClick={() => runPredict(a.id, days, true)}>
            {a.name}
          </Button>
        ))}
      </div>
      <div className="row gap" style={{ alignItems: "center" }}>
        <input
          type="checkbox"
          id="picc-predict-autosignal"
          checked={autoSignal}
          onChange={(e) => setAutoSignal(e.target.checked)}
        />
        <label htmlFor="picc-predict-autosignal" className="muted small">
          Auto-log a non-flat prediction as a signal (shows up in the signal ledger, where it awaits resolution)
        </label>
      </div>
      {err ? <p className="danger-text">{err}</p> : null}
      {result ? <PredictionResultView result={result} /> : null}
    </Card>
  )
}

function PredictionResultView({ result }: { result: PredictionResult }) {
  const tone: "success" | "danger" | "muted" =
    result.direction === "up" ? "success" : result.direction === "down" ? "danger" : "muted"
  return (
    <div className="card pad stack">
      <div className="row-between">
        <strong>
          {result.symbol ?? result.asset?.name ?? result.asset?.id} → {result.direction.toUpperCase()}
        </strong>
        <Badge tone={tone}>confidence {result.confidence}%</Badge>
      </div>
      <div className="grid grid-4">
        <div>
          <div className="stat-label muted">Backtested hit rate</div>
          <div className="stat-value">{result.hitRate != null ? `${result.hitRate}%` : "—"}</div>
        </div>
        <div>
          <div className="stat-label muted">Strength</div>
          <div className="stat-value">{result.strength}</div>
        </div>
        <div>
          <div className="stat-label muted">Model agreement</div>
          <div className="stat-value">{result.agreement}%</div>
        </div>
        <div>
          <div className="stat-label muted">Backtest windows</div>
          <div className="stat-value">{result.sampleSize}</div>
        </div>
      </div>
      <div className="grid grid-4 muted small">
        <div>momentum {result.models?.momentum?.toFixed(4)}</div>
        <div>mean-rev {result.models?.meanRevert?.toFixed(4)}</div>
        <div>trend {result.models?.trend?.toFixed(4)}</div>
        <div>MC {result.models?.monteCarlo?.toFixed(4)}</div>
      </div>
      <p className="muted small">{result.note}</p>
      {result.account?.balance != null ? (
        <p className="muted small">
          ExpertOption {result.account.demo ? "demo" : "live"} balance: {fmtMoney(result.account.balance)}{" "}
          {result.account.currency}
        </p>
      ) : null}
      {result.advisory ? <p className="muted small">{result.advisory}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// Pro Analysis — layered confluence report
// ---------------------------------------------------------------------
function ProAnalysisCard() {
  const [symbol, setSymbol] = useState("EURUSD")
  const [days, setDays] = useState(3)
  const [result, setResult] = useState<ProAnalysisResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const run = async (viaExpertOption: boolean, assetId?: string) => {
    setBusy(true)
    setErr("")
    setResult(null)
    try {
      const r = viaExpertOption
        ? await proAnalyzeExpertOption({ assetId: assetId ?? symbol, timeframe: 60, count: 240, days })
        : await proAnalyzeSymbol(symbol, { interval: "1d", days })
      setResult(r)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="pad stack">
      <h3>Pro analysis</h3>
      <p className="muted small">
        Full indicator dashboard + market-regime classification + weekly bias + divergence scan + a weighted
        trend/momentum/volatility confluence score, fused with the backtested prediction ensemble. Read-only.
      </p>
      <div className="grid grid-3">
        <Field label="Symbol / asset">
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Horizon (days)">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={5}>5 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
          </Select>
        </Field>
        <div className="row-end">
          <Button disabled={busy} onClick={() => run(false)}>
            {busy ? "Analyzing…" : "Pro analyze (Yahoo)"}
          </Button>
        </div>
      </div>
      <div className="row gap">
        <span className="muted small">ExpertOption quick assets:</span>
        {EXPERTOPTION_QUICK_ASSETS.map((a) => (
          <Button key={a.id} variant="ghost" disabled={busy} onClick={() => run(true, a.id)}>
            {a.name}
          </Button>
        ))}
      </div>
      {err ? <p className="danger-text">{err}</p> : null}
      {result ? <ProAnalysisResultView result={result} /> : null}
    </Card>
  )
}

function ProAnalysisResultView({ result }: { result: ProAnalysisResult }) {
  const [narrative, setNarrative] = useState<ProNarrativeResult | null>(null)
  const [narrativeBusy, setNarrativeBusy] = useState(false)

  const requestNarrative = async () => {
    setNarrativeBusy(true)
    setNarrative(null)
    try {
      setNarrative(await summarizeProAnalysis(result))
    } catch (err) {
      setNarrative({ ok: false, source: "local", summary: "", error: String(err) })
    } finally {
      setNarrativeBusy(false)
    }
  }

  if (!result.ok || !result.confluence) {
    return (
      <div className="card pad">
        <p className="danger-text">{result.error ?? "Analysis failed."}</p>
        {result.error ? <p className="muted small">{result.error}</p> : null}
      </div>
    )
  }
  const c = result.confluence
  const tone: "success" | "danger" | "muted" =
    c.verdict === "BUY" ? "success" : c.verdict === "SELL" ? "danger" : "muted"
  const scorePct = Math.round((c.score + 1) * 50)
  const phase = result.phase
  const alignTone: "success" | "danger" | "muted" =
    result.bias?.aligned ? "success" : result.bias?.aligned === false ? "danger" : "muted"

  return (
    <div className="card pad stack">
      <div className="row-between">
        <strong>
          {result.symbol ?? result.name} → {c.verdict}{" "}
          <span className="muted small">
            ({c.direction} {Math.abs(c.score).toFixed(2)}, {result.bars} bars, {result.timeframe})
          </span>
        </strong>
        <Badge tone={tone}>confidence {c.confidence}%</Badge>
      </div>

      <div className="grid grid-4">
        <div>
          <div className="stat-label muted">Confluence score</div>
          <div className="stat-value">{c.score > 0 ? "+" : ""}{c.score.toFixed(2)}</div>
        </div>
        <div>
          <div className="stat-label muted">Score gauge</div>
          <div className="stat-value">{scorePct}/100</div>
        </div>
        <div>
          <div className="stat-label muted">Regime</div>
          <div className="stat-value small">{phase?.quadrant ?? "—"}</div>
        </div>
        <div>
          <div className="stat-label muted">HTF alignment</div>
          <div className="stat-value">
            <Badge tone={alignTone}>{result.bias?.aligned ? "aligned" : result.bias?.aligned === false ? "conflict" : "neutral"}</Badge>
          </div>
        </div>
      </div>

      {result.chartSeries ? (
        <div className="card pad" style={{ padding: 4 }}>
          <TradingChart
            assetId={result.symbol ?? result.name ?? ""}
            label={`${result.symbol ?? result.name} — Analysis`}
            height={160}
          />
          <p className="muted small" style={{ padding: "0 6px 4px" }}>Live candlestick chart with EMA overlays</p>
        </div>
      ) : null}

      {phase ? <p className="muted small">{phase.label} — {phase.strategy}</p> : null}
      {result.htf ? (
        <p className="muted small">
          Weekly: {result.htf.biasLabel} ({result.htf.phaseLabel}, ADX {result.htf.adx ?? "n/a"}, R² {result.htf.r2 ?? "n/a"})
        </p>
      ) : null}

      {c.confidenceNotes.length ? (
        <p className="muted small">Note: {c.confidenceNotes.join("; ")}.</p>
      ) : null}

      <div className="stack">
        {c.groups.map((gr) => (
          <div key={gr.id} className="card pad">
            <div className="row-between">
              <strong className="small">{gr.name}</strong>
              <Badge tone={gr.score > 0 ? "success" : gr.score < 0 ? "danger" : "muted"}>
                {gr.score > 0 ? "+" : ""}{gr.score.toFixed(2)}
              </Badge>
            </div>
            <div className="grid grid-2 small muted">
              {gr.evidence.map((e) => (
                <div key={e.name} title={e.read}>
                  <strong>{e.name}:</strong> {e.read}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {result.divergences && result.divergences.length ? (
        <div className="grid grid-3 small">
          {result.divergences.slice(0, 6).map((d, i) => (
            <div key={i} className="muted">
              {d.kind === "bullish" ? "▲" : "▼"} {d.oscillator} {d.type.replace("_", " ")} {d.ago} bars ago
            </div>
          ))}
        </div>
      ) : null}

      {result.setups && result.setups.length ? (
        <div className="stack">
          <h4 className="small">Setups</h4>
          {result.setups.map((s) => (
            <div key={s.id} className="card pad small">
              <div className="row-between">
                <strong>{s.name}</strong>
                <Badge tone={s.bias === "up" ? "success" : "danger"}>{s.bias.toUpperCase()}</Badge>
              </div>
              <div className="grid grid-4 muted">
                <div>Entry {s.entry}</div>
                <div>Stop {s.stop}</div>
                <div>Target {s.target}</div>
                <div>R:R {s.rr}</div>
              </div>
              <p className="muted small">{s.trigger}</p>
            </div>
          ))}
        </div>
      ) : null}

      {result.risk?.atrPct != null ? (
        <p className="muted small">
          Risk: ATR {result.risk.atrPct}% → suggested stop {result.risk.suggestedStopPct}%, target{" "}
          {result.risk.suggestedTargetPct}%.
        </p>
      ) : null}

      {c.reasoning.length ? (
        <div className="stack small">
          {c.reasoning.map((r, i) => (
            <p key={i} className="muted small">{r}</p>
          ))}
        </div>
      ) : null}

      {result.honesty ? <p className="muted small">{result.honesty}</p> : null}
      {result.advisory ? <p className="muted small">{result.advisory}</p> : null}

      <div className="card pad">
        <div className="row-between">
          <strong className="small">AI narrative</strong>
          <Button variant="secondary" className="btn-sm" disabled={narrativeBusy} onClick={() => void requestNarrative()}>
            {narrativeBusy ? "Summarizing…" : narrative ? "Re-summarize" : "Explain this report"}
          </Button>
        </div>
        {narrative ? (
          <p className="muted small" style={{ marginTop: 6 }}>
            {narrative.summary}
            {narrative.source === "llm" && narrative.provider ? (
              <em className="muted"> — via {narrative.provider}</em>
            ) : null}
            {narrative.error ? <span className="danger-text"> ({narrative.error})</span> : null}
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: 6 }}>
            Ask an AI (or the local rule engine when no provider is configured) to explain this report in plain language.
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Paper trading ledger
// ---------------------------------------------------------------------
function PaperTradingCard({
  positions,
  closed,
  refresh
}: {
  positions: PaperPosition[]
  closed: ClosedTrade[]
  refresh: () => void
}) {
  const [symbol, setSymbol] = useState("EURUSD")
  const [side, setSide] = useState<"up" | "down">("up")
  const [entry, setEntry] = useState("1.0000")
  const [amount, setAmount] = useState("100")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const open = async () => {
    try {
      await openPaperTrade({ symbol, side, entry: Number(entry), amount: Number(amount) })
      setMsg({ ok: true, text: "Paper position opened (no real money moved)." })
      refresh()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  const close = async (id: string, exit: string) => {
    try {
      await closePaperTrade({ id, exit: Number(exit) })
      refresh()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  return (
    <Card className="pad stack">
      <h3>Paper trading</h3>
      <div className="grid grid-2">
        <Field label="Symbol">
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Side">
          <Select value={side} onChange={(e) => setSide(e.target.value as "up" | "down")}>
            <option value="up">Up (call)</option>
            <option value="down">Down (put)</option>
          </Select>
        </Field>
        <Field label="Entry price">
          <Input value={entry} onChange={(e) => setEntry(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <Button onClick={open}>Open paper position</Button>
      {msg ? <p className={msg.ok ? "muted" : "danger-text"}>{msg.text}</p> : null}

      <div className="stack">
        <h4>Open positions ({positions.length})</h4>
        {positions.length === 0 ? <p className="muted small">None open.</p> : null}
        {positions.map((p) => (
          <ExitRow key={p.id} position={p} onClose={close} />
        ))}
        <h4>Recent closed ({closed.length})</h4>
        {closed.length === 0 ? <p className="muted small">No closed trades yet.</p> : null}
        <div className="stack">
          {closed.slice(0, 10).map((c) => (
            <div key={c.id} className="row-between">
              <div className="muted small">
                {c.symbol} {c.side.toUpperCase()} · {fmtMoney(c.amount)} @ {c.entry}
              </div>
              <Badge tone={c.pnl >= 0 ? "success" : "danger"}>
                {c.pnl >= 0 ? "+" : ""}{c.pnl.toFixed(2)}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------
// Trade planner (position-size + R:R calculator) — local math, no network.
// Mirrors what serious journals/tools (TradeBench, Edgewonk) call "plan
// before you enter": size every position off a fixed % risk, not feelings.
// ---------------------------------------------------------------------
function TradePlannerCard() {
  const [balance, setBalance] = useState("10000")
  const [riskPct, setRiskPct] = useState("2")
  const [entry, setEntry] = useState("1.1000")
  const [stop, setStop] = useState("1.0900")
  const [target, setTarget] = useState("1.1300")
  const [side, setSide] = useState<"up" | "down">("up")

  const b = Number(balance) || 0
  const e = Number(entry) || 0
  const s = Number(stop) || 0
  const t = Number(target) || 0
  const rp = Number(riskPct) || 0

  const valid = b > 0 && e > 0 && s > 0 && t > 0 && e !== s && t !== e
  const stopOk = side === "up" ? s < e : s > e
  const targetOk = side === "up" ? t > e : t < e
  const ok = valid && stopOk && targetOk

  const riskPerUnit = ok ? Math.abs(e - s) : 0
  const rewardPerUnit = ok ? Math.abs(t - e) : 0
  const riskUsd = ok ? (b * rp) / 100 : 0
  const positionUnits = ok && riskPerUnit > 0 ? riskUsd / riskPerUnit : 0
  const notional = positionUnits * e
  const rewardUsd = rewardPerUnit * positionUnits
  const rR = rewardPerUnit > 0 && riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0
  const stopPct = riskPerUnit > 0 ? (riskPerUnit / e) * 100 : 0
  const targetPct = rewardPerUnit > 0 ? (rewardPerUnit / e) * 100 : 0

  return (
    <Card className="pad stack">
      <h3>Trade planner</h3>
      <p className="muted small">
        Size every trade by risk first: pick how much you are willing to lose, and PICC works out the position size and
        whether the setup is worth the R:R. No order is placed from here — this is decision support.
      </p>
      <div className="grid grid-2">
        <Field label="Account balance">
          <Input type="number" min={1} value={balance} onChange={(e) => setBalance(e.target.value)} />
        </Field>
        <Field label="Risk per trade %">
          <Input type="number" min={0.1} max={20} step={0.1} value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
        </Field>
        <Field label="Side">
          <Select value={side} onChange={(e) => setSide(e.target.value as "up" | "down")}>
            <option value="up">Long (up)</option>
            <option value="down">Short (down)</option>
          </Select>
        </Field>
        <Field label="Entry price">
          <Input type="number" value={entry} onChange={(e) => setEntry(e.target.value)} />
        </Field>
        <Field label="Stop loss">
          <Input type="number" value={stop} onChange={(e) => setStop(e.target.value)} />
        </Field>
        <Field label="Take profit">
          <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
      </div>
      {!ok ? (
        <p className="muted small">
          {!valid ? "Enter positive balance, entry, stop and target." : !stopOk ? "Stop must be below entry for long / above entry for short." : "Take profit must be above entry for long / below entry for short."}
        </p>
      ) : (
        <div className="grid grid-4 muted small">
          <div>risk per trade: <strong className="danger-text">{fmtMoney(riskUsd)}</strong></div>
          <div>position size: <strong>{positionUnits.toLocaleString("en-US", { maximumFractionDigits: 2 })} units</strong></div>
          <div>notional: <strong>{fmtMoney(notional)}</strong></div>
          <div>reward at target: <strong className="success-text">{fmtMoney(rewardUsd)}</strong></div>
          <div>reward:risk: <strong>{rR.toFixed(2)}R</strong></div>
          <div>to stop: <strong>-{stopPct.toFixed(2)}%</strong></div>
          <div>to target: <strong>+{targetPct.toFixed(2)}%</strong></div>
          <div>viability: <strong>{rR >= 1 ? "acceptable (≥1R)" : "poor (<1R)"}</strong></div>
        </div>
      )}
    </Card>
  )
}

function ExitRow({
  position,
  onClose
}: {
  position: PaperPosition
  onClose: (id: string, exit: string) => void
}) {
  const [exit, setExit] = useState(String(position.entry))
  return (
    <div className="row-between">
      <div className="muted small">
        {position.symbol} {position.side.toUpperCase()} · {fmtMoney(position.amount)} @ {position.entry}
      </div>
      <div className="row gap">
        <Input className="input-sm" value={exit} onChange={(e) => setExit(e.target.value)} />
        <Button variant="secondary" onClick={() => onClose(position.id, exit)}>
          Close
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Watchlist + multi-asset scanner (covers /trading/watchlist + /scan)
// ---------------------------------------------------------------------
function WatchlistScannerCard() {
  const [quotes, setQuotes] = useState<WatchlistQuote[]>([])
  const [symbol, setSymbol] = useState("")
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = async () => {
    try {
      const r = await getWatchlistQuotes()
      setQuotes(r.ok ? r.symbols : [])
      setMsg(null)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async () => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    try {
      await addToWatchlist(sym)
      setSymbol("")
      await load()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  const remove = async (sym: string) => {
    try {
      await removeFromWatchlist(sym)
      await load()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  const runScan = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await scanSymbols({ days: 3 })
      setScan(r)
      if (r.errors.length && r.signals.length === 0) setMsg({ ok: false, text: `Scan failed: ${r.errors[0].error}` })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="pad stack">
      <div className="row-between">
        <h3>Watchlist & scanner</h3>
        <Button variant="ghost" onClick={load}>Refresh</Button>
      </div>
      <div className="row gap">
        <Input placeholder="Symbol (e.g. BTC-USD, 2330.KL)" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} style={{ flex: 1 }} />
        <Button onClick={add}>Add</Button>
        <Button variant="secondary" disabled={busy} onClick={runScan}>
          {busy ? "Scanning…" : "Scan watchlist"}
        </Button>
      </div>
      <p className="muted small">Tracked symbols with live Yahoo quotes. Scan runs the prediction engine across every watchlist entry and ranks by confidence.</p>
      {quotes.length === 0 ? <p className="muted small">Watchlist is empty — add a symbol above.</p> : null}
      {quotes.map((q) => (
        <div key={q.symbol} className="row-between">
          <div>
            <strong>{q.symbol}</strong>
            {q.name ? <span className="muted small"> · {q.name}</span> : null}
          </div>
          <div className="row gap">
            {q.error ? (
              <span className="muted small" title={q.error}>quote unavailable</span>
            ) : q.last != null ? (
              <span className="muted small">{fmtMoney(q.last)}{q.currency ? ` ${q.currency}` : ""}</span>
            ) : null}
            <Button variant="ghost" onClick={() => remove(q.symbol)}>✕</Button>
          </div>
        </div>
      ))}
      {scan && scan.signals.length > 0 ? (
        <div className="stack">
          <h4>Scan results — {scan.horizonDays}-day horizon</h4>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Symbol</th><th>Direction</th><th>Conf</th><th>Strength</th><th>Hit rate</th><th>Last</th></tr>
              </thead>
              <tbody>
                {scan.signals.map((s) => (
                  <tr key={s.symbol}>
                    <td><strong>{s.symbol}</strong></td>
                    <td>{String(s.direction ?? "").toUpperCase()}</td>
                    <td>{s.confidence != null ? `${s.confidence}%` : "—"}</td>
                    <td>{s.strength ?? "—"}</td>
                    <td>{s.hitRate != null ? `${s.hitRate}%` : "—"}</td>
                    <td>{s.last != null ? fmtMoney(s.last) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scan.errors.length > 0 ? <p className="muted small">{scan.errors.length} symbols failed: {scan.errors[0].error}</p> : null}
        </div>
      ) : null}
      {msg ? <p className={msg.ok ? "muted" : "danger-text"}>{msg.text}</p> : null}
    </Card>
  )
}

// ---------------------------------------------------------------------
// Market news (Serper) — covers /trading/news
// ---------------------------------------------------------------------
function NewsCard() {
  const [query, setQuery] = useState("")
  const [news, setNews] = useState<MarketNewsResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchNews = async (q?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await getMarketNews({ query: (q ?? query.trim()) || undefined, num: 8 })
      setNews(r)
      if (r.items.length === 0) setMsg({ ok: false, text: "No news found for that query." })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void fetchNews()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card className="pad stack">
      <h3>Market news</h3>
      <div className="row gap">
        <Input placeholder="Query or symbol (e.g. BTC-USD)" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
        <Button variant="secondary" disabled={busy} onClick={() => fetchNews()}>
          {busy ? "Searching…" : "Search"}
        </Button>
      </div>
      <p className="muted small">Real-time Google News via Serper. Decision research only.</p>
      {news && news.items.length > 0 ? (
        <div className="stack">
          {news.items.map((it, i) => (
            <div key={`${it.link}-${i}`} className="stack" style={{ gap: 2 }}>
              <a href={it.link} target="_blank" rel="noreferrer" className="link">
                {it.title}
              </a>
              <span className="muted small">{it.source ? `${it.source} · ` : ""}{it.date ? it.date : ""}</span>
              {it.snippet ? <p className="muted small">{it.snippet}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {msg ? <p className={msg.ok ? "muted" : "danger-text"}>{msg.text}</p> : null}
    </Card>
  )
}

// ---------------------------------------------------------------------
// Paper analytics (equity curve, drawdown, full metrics) — /trading/paper/analytics
// ---------------------------------------------------------------------
function PaperAnalyticsCard() {
  const [analytics, setAnalytics] = useState<PaperAnalyticsResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await getPaperAnalytics()
      if (r.ok) setAnalytics(r)
      else setMsg({ ok: false, text: "Analytics unavailable." })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const m: TradingMetrics | null = analytics?.metrics ?? null

  return (
    <Card className="pad stack">
      <div className="row-between">
        <h3>Paper analytics</h3>
        <Button variant={analytics ? "ghost" : "secondary"} disabled={busy} onClick={load}>
          {busy ? "Marking to market…" : analytics ? "Refresh" : "Load analytics"}
        </Button>
      </div>
      <p className="muted small">
        Marks open positions to market, auto-closes any TP/SL that has been hit, then computes the full metrics suite over closed trades.
      </p>
      {msg ? <p className={msg.ok ? "muted" : "danger-text"}>{msg.text}</p> : null}
      {analytics ? (
        <div className="stack">
          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">Equity</span>
              <strong>{fmtMoney(analytics.overview.equity)}</strong>
              <span className="muted">realized + unrealized</span>
            </div>
            <div className="stat">
              <span className="stat-label">Realized PnL</span>
              <strong>{fmtMoney(analytics.overview.realizedPnl)}</strong>
              <span className="muted">{analytics.overview.closedCount} closed</span>
            </div>
            <div className="stat">
              <span className="stat-label">Unrealized PnL</span>
              <strong>{fmtMoney(analytics.overview.unrealizedPnl)}</strong>
              <span className="muted">{analytics.overview.openCount} open</span>
            </div>
            <div className="stat">
              <span className="stat-label">Max drawdown</span>
              <strong>{m ? `${m.maxDrawdown}%` : "—"}</strong>
              <span className="muted">{m ? fmtMoney(m.maxDrawdownDollars) : ""}</span>
            </div>
          </div>
          {m ? (
            <div className="grid grid-4 muted small">
              <div>win rate: {m.winRate != null ? `${m.winRate}%` : "—"}</div>
              <div>avg win: {m.avgWin != null ? fmtMoney(m.avgWin) : "—"}</div>
              <div>avg loss: {m.avgLoss != null ? fmtMoney(m.avgLoss) : "—"}</div>
              <div>profit factor: {m.profitFactor ?? "—"}</div>
              <div>per-trade Sharpe: {m.perTradeSharpe ?? "—"}</div>
              <div>annualized Sharpe: {m.annualizedSharpe ?? "—"}</div>
              <div>expectancy: {fmtMoney(m.expectancy)}</div>
              <div>total return: {m.totalReturnPct != null ? `${m.totalReturnPct}%` : "—"}</div>
              <div>gross profit: {fmtMoney(m.grossProfit)}</div>
              <div>gross loss: {fmtMoney(m.grossLoss)}</div>
              <div>best: {fmtMoney(m.best)}</div>
              <div>worst: {fmtMoney(m.worst)}</div>
              <div>avg hold: {fmtHold(m.avgHoldMs)}</div>
              <div>best streak: {m.maxWin}</div>
              <div>worst streak: {m.maxLoss}</div>
              <div>current streak: {m.currentWin > m.currentLoss ? `+${m.currentWin}` : m.currentLoss}</div>
            </div>
          ) : null}
          {m && m.equity.length > 1 ? (
            <div>
              <h4>Equity curve</h4>
              <div className="row" style={{ gap: 2, alignItems: "flex-end", height: 64 }}>
                {(() => {
                  const max = Math.max(...m.equity.map((x) => x.equity), 0.01)
                  const min = Math.min(...m.equity.map((x) => x.equity), 0)
                  const range = Math.max(max - min, 0.01)
                  return m.equity.map((p, i) => (
                    <div
                      key={i}
                      title={`${p.t ?? "start"} · ${fmtMoney(p.equity)}`}
                      className={p.pnl >= 0 ? "bar-fill" : "bar-fill bar-danger"}
                      style={{ height: `${Math.max(4, ((p.equity - min) / range) * 100)}%`, flex: 1, minWidth: 3 }}
                    />
                  ))
                })()}
              </div>
            </div>
          ) : null}
          {m && m.monthly.length > 0 ? (
            <div>
              <h4>Monthly</h4>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Month</th><th>Trades</th><th>PnL</th><th>Win rate</th></tr>
                  </thead>
                  <tbody>
                    {m.monthly.slice(-12).map((r) => (
                      <tr key={r.month}>
                        <td>{r.month}</td>
                        <td>{r.trades}</td>
                        <td className={r.pnl >= 0 ? "" : "danger-text"}>{fmtMoney(r.pnl)}</td>
                        <td>{r.winRate != null ? `${r.winRate}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {m && m.perSymbol.length > 0 ? (
            <div>
              <h4>Per symbol</h4>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Symbol</th><th>Trades</th><th>PnL</th><th>Win rate</th></tr>
                  </thead>
                  <tbody>
                    {m.perSymbol.slice(0, 12).map((r) => (
                      <tr key={r.symbol}>
                        <td>{r.symbol}</td>
                        <td>{r.trades}</td>
                        <td className={r.pnl >= 0 ? "" : "danger-text"}>{fmtMoney(r.pnl)}</td>
                        <td>{r.winRate != null ? `${r.winRate}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

// ---------------------------------------------------------------------
// Signals + assistant
// ---------------------------------------------------------------------
function SignalsCard({ signals, refresh }: { signals: TradingSignal[]; refresh: () => void }) {
  const [accuracy, setAccuracy] = useState<SignalAccuracy | null>(null)
  const [resolvePrice, setResolvePrice] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadAccuracy = async () => {
    try {
      setAccuracy(await getSignalAccuracy())
    } catch {
      setAccuracy(null)
    }
  }

  useEffect(() => {
    void loadAccuracy()
  }, [signals.length])

  const resolve = async (s: TradingSignal) => {
    const price = Number(resolvePrice[s.id] ?? "")
    if (!Number.isFinite(price) || price <= 0) {
      setMsg({ ok: false, text: "Enter a result price first." })
      return
    }
    try {
      await resolveTradingSignal({ id: s.id, resultPrice: price })
      setMsg({ ok: true, text: `Signal ${s.id} resolved against $${price.toFixed(4)}.` })
      refresh()
      void loadAccuracy()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  const pending = signals.filter((s) => s.status !== "resolved")

  return (
    <Card className="pad stack">
      <div className="row-between">
        <h3>Signal log</h3>
        {accuracy ? (
          <Badge tone={accuracy.winRate != null && accuracy.winRate >= 50 ? "success" : "muted"}>
            accuracy {accuracy.winRate != null ? `${accuracy.winRate}%` : "—"} ({accuracy.total} resolved)
          </Badge>
        ) : null}
      </div>
      {signals.length === 0 ? <p className="muted small">No signals recorded yet. Run a prediction to log one.</p> : null}
      {signals.slice(0, 8).map((s) => (
        <div key={s.id} className="row-between">
          <span className="muted small">
            {String(s.symbol ?? "")} {String(s.direction ?? "").toUpperCase()}
          </span>
          <Badge tone={Number(s.confidence) >= 60 ? "success" : "muted"}>
            conf {Number(s.confidence ?? 0)}%
          </Badge>
        </div>
      ))}
      {accuracy && accuracy.byDirection.length > 0 ? (
        <div className="stack">
          <h4>Accuracy by direction</h4>
          {accuracy.byDirection.map((b) => (
            <div key={b.key} className="row-between">
              <span className="muted small">{b.key}</span>
              <span className="muted small">{b.wins}/{b.total} · {b.winRate != null ? `${b.winRate}%` : "—"}</span>
            </div>
          ))}
        </div>
      ) : null}
      {pending.length > 0 ? (
        <div className="stack">
          <h4>Resolve pending signals</h4>
          <p className="muted small">Enter the realized price and resolve to train the accuracy report.</p>
          {pending.slice(0, 5).map((s) => (
            <div key={s.id} className="row gap">
              <span className="muted small" style={{ minWidth: 90 }}>
                {String(s.symbol ?? "?")} {String(s.direction ?? "").toUpperCase()}
              </span>
              <Input
                className="input-sm"
                placeholder="result price"
                value={resolvePrice[s.id] ?? ""}
                onChange={(e) => setResolvePrice((m) => ({ ...m, [s.id]: e.target.value }))}
              />
              <Button variant="secondary" onClick={() => resolve(s)}>Resolve</Button>
            </div>
          ))}
        </div>
      ) : null}
      {msg ? <p className={msg.ok ? "muted" : "danger-text"}>{msg.text}</p> : null}
    </Card>
  )
}

function AssistantCard({ status }: { status: PaperOverview | null }) {
  const [q, setQ] = useState("")
  const [answer, setAnswer] = useState("")
  const [busy, setBusy] = useState(false)

  const ask = async () => {
    if (!q.trim()) return
    setBusy(true)
    try {
      const r = await askTradingAssistant(q, { paper: status })
      setAnswer(r.advice)
    } catch (e) {
      setAnswer((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="pad stack">
      <h3>Assistant</h3>
      <Textarea
        rows={2}
        placeholder="Ask anything about a strategy, risk, or an asset…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Button disabled={busy || !q.trim()} onClick={ask}>
        {busy ? "Thinking…" : "Ask"}
      </Button>
      {answer ? <p className="muted small" style={{ whiteSpace: "pre-wrap" }}>{answer}</p> : null}
    </Card>
  )
}
