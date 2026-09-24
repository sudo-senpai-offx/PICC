import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { openBrokerTab, validateVenueTradeUrl } from "@/lib/brokerLink"
import { Badge, Button, Card, Field, Input, Select, Spinner, Textarea } from "@/components/ui"
import { LiveMarketBoard } from "@/components/LiveMarketBoard"
import { MarketIntelPanel } from "@/components/MarketIntelPanel"
import { LiveDecisionsPanel } from "@/components/LiveDecisionsPanel"
import { LedgerPanel } from "@/components/LedgerPanel"
import { TradingChart } from "@/components/TradingChart"
import { DataSourcesPanel } from "@/components/DataSourcesPanel"
import { SpreadPanel } from "@/components/SpreadPanel"
import { PortfolioAggregatePanel } from "@/components/PortfolioAggregatePanel"
import { CorrelationScreen } from "@/components/CorrelationScreen"
import { AccountMetricsPanel } from "@/components/AccountMetricsPanel"
import { CapabilitiesPanel } from "@/components/CapabilitiesPanel"
import { BacktestPanel } from "@/components/BacktestPanel"
import { AdvancedIndicatorsPanel } from "@/components/AdvancedIndicatorsPanel"
import { AlertPanel } from "@/components/AlertPanel"
import { CalendarPanel } from "@/components/CalendarPanel"
import { WatchlistPanel } from "@/components/WatchlistPanel"
import { ScreenerPanel } from "@/components/ScreenerPanel"
import { PatternPanel } from "@/components/PatternPanel"
import { ModelMatrixPanel } from "@/components/ModelMatrixPanel"
import { getTradingVenues, getTradingCatalog, assetOptionGroups, type CatalogCategory } from "@/lib/trading"
import { computePositionSize, computeRiskReward, computeHalfKelly } from "@/lib/positionMath"
import { request, post } from "@/lib/api"
import { isPushSupported } from "@/lib/push"
import { useWebPush } from "@/hooks/useWebPush"
import { TradeJournalPanel } from "@/components/TradeJournalPanel"
import { SessionPanel } from "@/components/SessionPanel"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import {
  addToWatchlist,
  analyzeAsset,
  askTradingAssistant,
  closePaperTrade,
  QUICK_ASSETS,
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
  proAnalyze,
  proAnalyzeSymbol,
  removeFromWatchlist,
  resolveTradingSignal,
  scanSymbols,
  summarizeProAnalysis
} from "@/lib/trading"
import type {
  BrokerDemoStatus,
  ClosedTrade,
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

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "\u20AC", GBP: "\u00A3", JPY: "\u00A5", CNY: "\u00A5", KRW: "\u20A9", INR: "\u20B9", BRL: "R$", RUB: "\u20BD", AUD: "A$", CAD: "C$", CHF: "CHF ", NGN: "\u20A6", PHP: "\u20B1", THB: "\u0E3F", VND: "\u20AB", MYR: "RM", IDR: "Rp" }
function fmtMoney(n: number | null | undefined, currency?: string | null): string {
  if (n == null) return "\u2014"
  const sym = CURRENCY_SYMBOLS[(currency || "USD").toUpperCase()] || (currency || "$") + " "
  return sym + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Price formatter sized by magnitude — FX ticks at 5 decimals, large prices at 0–2. */
function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "\u2014"
  const abs = Math.abs(n)
  const digits = abs < 1 ? 6 : abs < 10 ? 5 : abs < 1000 ? 2 : 0
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
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

/** T6 / Decision E: focus + scroll a flat-stack panel by its data-panel id. */
function panelAnchor(panel: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-panel="${panel}"]`)
  if (!el) return null
  el.scrollIntoView?.({ behavior: "smooth", block: "start" })
  el.focus?.()
  return el
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
  const [catalog, setCatalog] = useState<CatalogCategory[]>([])
  const [searchParams] = useSearchParams()
  const lastLoadAt = useRef(0)
  const lastLandedVenue = useRef<string | null>(null)
  const { snapshot, error: streamError } = useRealtimeSuite()

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      getTradingStatus(),
      getPaperPositions(),
      getPaperHistory(),
      getTradingSignals(),
      getTradingCatalog()
    ]).then(([s, p, h, g, c]) => {
      if (!alive) return
      if (s.status === "fulfilled") setStatus(s.value)
      // Null-guards: a well-formed-but-non-ok body (HTTP 200 that parses to
      // { ok:false, ... } with no data arrays) must NOT overwrite the initial
      // empty arrays with `undefined` — that would crash PaperTradingCard on
      // `positions.length`. Leave the empty/observed state intact instead.
      if (p.status === "fulfilled" && Array.isArray(p.value?.positions)) setPositions(p.value.positions)
      if (h.status === "fulfilled" && Array.isArray(h.value?.closed)) setClosed(h.value.closed)
      if (g.status === "fulfilled" && Array.isArray(g.value?.signals)) setSignals(g.value.signals)
      if (c.status === "fulfilled" && c.value.ok) setCatalog(c.value.categories)
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

  // T6 / REQ-9: /suites?asset=A&panel=chart[&venue=V] landing. Unknown values
  // degrade to the current view — logged, never thrown, never auto-executed.
  // The chartAsset fallback is intentionally NOT a dependency: the landing must
  // run once per deep link, not re-fire on every select change.
  useEffect(() => {
    if (!loaded) return
    const asset = searchParams.get("asset")
    const panel = searchParams.get("panel")
    const venue = searchParams.get("venue")
    if (!asset && panel !== "chart" && !venue) return
    if (asset) {
      const known = assetOptionGroups(catalog, watchedAssets)
        .flatMap((g) => g.options)
        .some((o) => o.value === asset)
      if (known) {
        if (chartAsset !== asset) setChartAsset(asset)
      } else {
        console.info(`[suites] deep-link asset "${asset}" is unknown — selection unchanged`)
      }
    }
    if (panel === "chart") panelAnchor("chart")
    if (venue) {
      // One landing per venue key — reruns (catalog/realtime churn) must not
      // re-post the command or re-open the fallback tab.
      const venueKey = `${venue}|${asset ?? ""}`
      if (lastLandedVenue.current !== venueKey) {
        lastLandedVenue.current = venueKey
        void (async () => {
          try {
            const res = await getTradingVenues(asset ?? chartAsset)
            const tradeUrl = res.ok ? validateVenueTradeUrl(venue, res.venues) : null
            if (tradeUrl) void openBrokerTab({ venueId: venue, url: tradeUrl })
            else console.info(`[suites] deep-link venue "${venue}" unresolved or unverified — no tab opened`)
          } catch {
            console.info("[suites] deep-link venue resolution failed — no tab opened")
          }
        })()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, catalog, watchedAssets, searchParams])

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
          <div className="card pad stack" data-panel="chart" tabIndex={-1}>
            <div className="row-between" style={{ alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Live Chart</h3>
              <div className="row gap" style={{ alignItems: "center" }}>
                <Select value={chartAsset} onChange={(e) => setChartAsset(e.target.value)}>
                  {assetOptionGroups(catalog, watchedAssets).map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <span className="muted small">
                  {chartAsset} · {watchedAssets.includes(chartAsset) ? "EO leg" : "Yahoo fallback"}
                </span>
              </div>
            </div>
            <TradingChart assetId={chartAsset} height={380} />
            <div className="grid">
              <SpreadPanel assetId={chartAsset} />
              <PortfolioAggregatePanel paperAvailable={Boolean(status?.paper)} />
              <CorrelationScreen />
            </div>
          </div>
          <DataSourcesPanel />
          <ModelMatrixPanel assetId={chartAsset} />
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
          <AccountMetricsPanel />
          <WatchlistPanel />
          <ScreenerPanel />
          <PatternPanel />
          <TradeJournalPanel />
          <SessionPanel />
          <CapabilitiesPanel />
          <div className="grid">
            <PaperTradingCard positions={positions} closed={closed} refresh={refresh} />
            <div className="stack">
              <TradePlannerCard />
              <SignalsCard signals={signals} refresh={refresh} />
              <AssistantCard status={status?.paper ?? null} />
            </div>
          </div>
          <NewsCard />
        </>
      )}
    </div>
  )
}

export { AutopilotSuite } from "./AutopilotSuite";

/** Advisory notification preferences — channels, thresholds, test send. */
export function SignalNotificationsCard() {
  const [status, setStatus] = useState<{ ok: boolean; prefs: { minConfidence: number; leadMinutes: number; windowMinutes: number; channels: Record<string, boolean> }; subscriptions: number; channels: Array<{ name: string; configured: boolean; userEnabled: boolean }> } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ minConfidence: number; leadMinutes: number } | null>(null)
  // T8 — single shared web-push hook (suite card + bell both consume it).
  const wp = useWebPush()

  const load = useCallback(async () => {
    try {
      const r = await request<{ ok: boolean; prefs: any; subscriptions: number; channels: any[] }>("/notifications/status")
      setStatus(r)
      setDraft({ minConfidence: r.prefs.minConfidence, leadMinutes: r.prefs.leadMinutes })
    } catch { setStatus(null) }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    try {
      await post("/notifications/prefs", draft)
      setMsg("Notification preferences saved.")
      await load()
    } catch (e) { setMsg((e as Error).message) }
  }

  const testSend = async () => {
    try {
      await post("/notifications/test", {})
      setMsg("Test dispatched — check bell/push.")
    } catch (e) { setMsg((e as Error).message) }
  }

  const toggleChannel = async (name: string, enabled: boolean) => {
    try {
      await post("/notifications/prefs", { channels: { [name]: enabled } })
      await load()
    } catch (e) { setMsg((e as Error).message) }
  }

  return (
    <Card className="pad stack">
      <h3>Advisory alerts</h3>
      <p className="muted small">
        The Signal Engine watches your scoped assets and notifies you ahead of ideal buy/sell windows.
        Execution is removed — you act on your platform; PICC watches and tells you.
      </p>
      {!status ? (
        <Spinner label="Loading notification settings…" />
      ) : (
        <>
          <div className="grid grid-2">
            <Field label="Min consensus confidence %">
              <Input type="number" min={30} max={95} value={draft?.minConfidence ?? status.prefs.minConfidence}
                onChange={(e) => setDraft((d) => ({ ...(d ?? { leadMinutes: status.prefs.leadMinutes }), minConfidence: Number(e.target.value) }))} />
            </Field>
            <Field label="Lead time (minutes)">
              <Input type="number" min={0} max={60} value={draft?.leadMinutes ?? status.prefs.leadMinutes}
                onChange={(e) => setDraft((d) => ({ ...(d ?? { minConfidence: status.prefs.minConfidence }), leadMinutes: Number(e.target.value) }))} />
            </Field>
          </div>
          <div className="stack">
            {(status.channels ?? []).map((c) => (
              <div key={c.name} className="row-between">
                <span className="field-label">
                  {c.name}{c.configured ? "" : " (not configured — set env keys)"}
                </span>
                <ToggleRow label="" checked={c.userEnabled} onChange={() => void toggleChannel(c.name, !c.userEnabled)} />
              </div>
            ))}
          </div>
          {(() => {
            const webpush = (status.channels ?? []).find((c) => c.name === "webpush")
            const swSupported = isPushSupported()
            const isEnabled = status.subscriptions > 0
            // T8 — honest unconfigured state: no VAPID → "push unavailable"
            // (the shared hook also emits 503-verified "unavailable"), never a
            // fabricated send.
            return (
              <div className="stack" style={{ borderTop: "1px solid var(--border, rgba(128,128,128,.2))", paddingTop: 8 }}>
                <div className="row-between" style={{ alignItems: "center" }}>
                  <span className="field-label">Web Push (this browser)</span>
                  {webpush?.configured ? (
                    <Badge tone={isEnabled ? "success" : "muted"}>{isEnabled ? `enabled · ${status.subscriptions} server-side` : "off"}</Badge>
                  ) : (
                    <Badge tone="muted">push unavailable</Badge>
                  )}
                </div>
                {!webpush?.configured ? (
                  wp.message ? <p className="muted small">{wp.message}</p>
                    : <p className="muted small">Web push is not configured on this server (no VAPID keys) — nothing will be sent.</p>
                ) : !swSupported ? (
                  <p className="muted small">This browser cannot receive Web Push (no Service Worker / PushManager).</p>
                ) : (
                  <>
                    {!isEnabled ? (
                      <Button variant="primary" disabled={wp.busy} onClick={() => void wp.enable().then(() => void load())}>
                        {wp.busy ? "Enabling…" : "Enable push notifications"}
                      </Button>
                    ) : (
                      <Button variant="secondary" disabled={wp.busy} onClick={() => void wp.disable().then(() => void load())}>
                        {wp.busy ? "Disabling…" : "Disable push"}
                      </Button>
                    )}
                    {!isEnabled && Notification?.permission === "denied" && (
                      <p className="danger-text small">Push is blocked by the browser — unblock notifications for this site, then re-enable.</p>
                    )}
                    {wp.message ? <p className="muted small">{wp.message}</p> : null}
                  </>
                )}
              </div>
            )
          })()}
          <div className="row gap">
            <Button variant="primary" onClick={save}>Save preferences</Button>
            <Button variant="secondary" onClick={testSend}>Send test</Button>
          </div>
          {msg ? <p className="muted small">{msg}</p> : null}
        </>
      )}
    </Card>
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
export function StatusCards({
  paper,
  riskPct,
  demo,
  liveAccount
}: {
  paper: PaperOverview | null
  riskPct: number
  demo: BrokerDemoStatus | null
  liveAccount: import("@/lib/liveTrading").LiveAccount | null
}) {
  const stat = (label: string, value: string, sub?: string) => (
    <Card className="pad">
      <div className="stat-label muted">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="muted small">{sub}</div> : null}
    </Card>
  )
  return (
    <div className="grid grid-4">
      {stat("Paper cash available", fmtMoney(paper?.cash))}
      {stat("Open notional", fmtMoney(paper?.committed), paper?.openCount ? `${paper.openCount} open` : undefined)}
      {stat(
        "Realized PnL",
        fmtMoney(paper?.realizedPnl),
        paper && paper.realizedPnl >= 0 ? "in profit" : "in drawdown"
      )}
      {stat(
        "Win rate",
        paper && paper.winRate != null ? `${paper.winRate}%` : "—",
        paper && paper.winRate != null && paper.winRate < 50 ? "below coin flip" : "at/above coin flip"
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
          {fmtMoney(demo?.todayPnl, demo?.currency)}
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
        <div className="stat-label muted">Broker account</div>
        {liveAccount ? (
          <div className="stat-value" style={{ fontSize: "0.95rem" }}>
            demo {fmtMoney(liveAccount.demoWallet?.balance, liveAccount.demoWallet?.currency ?? liveAccount.currency)} · real {fmtMoney(liveAccount.realWallet?.balance, liveAccount.realWallet?.currency ?? liveAccount.currency)}
          </div>
        ) : (
          <div className="stat-value">{demo?.connected ? fmtMoney(demo.balance, demo?.currency) : "—"}</div>
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
export function PredictionCard({ recordSignal }: { recordSignal: () => void }) {
  const [symbol, setSymbol] = useState("EURUSD")
  const [days, setDays] = useState(3)
  const [result, setResult] = useState<PredictionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  // Predictions feed the signal ledger (which demands resolution). Opt-out so
  // a quick look doesn't silently create bookkeeping entries.
  const [autoSignal, setAutoSignal] = useState(true)

  const runPredict = async (sym: string, horizon: number, viaLive: boolean) => {
    setBusy(true)
    setErr("")
    setResult(null)
    try {
      const r = viaLive
        ? await analyzeAsset(sym, { timeframe: 60, count: 120, days: horizon })
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
        <span className="muted small">Quick assets (live feed):</span>
        {QUICK_ASSETS.map((a) => (
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
      {result.band ? (
        <div className="grid grid-4">
          <div>
            <div className="stat-label muted">90% move band (±)</div>
            <div className="stat-value">{(result.band.horizonLogMoveP90 * 100).toFixed(1)}%</div>
          </div>
          <div>
            <div className="stat-label muted">80% move band (±)</div>
            <div className="stat-value">{(result.band.horizonLogMoveP80 * 100).toFixed(1)}%</div>
          </div>
          <div>
            <div className="stat-label muted">90% price window</div>
            <div className="stat-value">
              {fmtPrice(result.band.lowerPrice90)} – {fmtPrice(result.band.upperPrice90)}
            </div>
          </div>
          <div>
            <div className="stat-label muted">Band samples</div>
            <div className="stat-value">{result.band.sampleSize}</div>
          </div>
        </div>
      ) : null}
      {result.engine ? <p className="muted small">engine: {result.engine}</p> : null}
      <div className="grid grid-4 muted small">
        <div>momentum {result.models?.momentum?.toFixed(4)}</div>
        <div>mean-rev {result.models?.meanRevert?.toFixed(4)}</div>
        <div>trend {result.models?.trend?.toFixed(4)}</div>
        <div>MC {result.models?.monteCarlo?.toFixed(4)}</div>
      </div>
      <p className="muted small">{result.note}</p>
      {result.account?.balance != null ? (
        <p className="muted small">
          Broker {result.account.demo ? "demo" : "live"} balance: {fmtMoney(result.account.balance, result.account.currency)}
        </p>
      ) : null}
      {result.advisory ? <p className="muted small">{result.advisory}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// Pro Analysis — layered confluence report
// ---------------------------------------------------------------------
export function ProAnalysisCard() {
  const [symbol, setSymbol] = useState("EURUSD")
  const [days, setDays] = useState(3)
  const [result, setResult] = useState<ProAnalysisResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const run = async (viaLive: boolean, assetId?: string) => {
    setBusy(true)
    setErr("")
    setResult(null)
    try {
      const r = viaLive
        ? await proAnalyze({ assetId: assetId ?? symbol, timeframe: 60, count: 240, days })
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
        <span className="muted small">Quick assets (live feed):</span>
        {QUICK_ASSETS.map((a) => (
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

      {phase ? <p className="muted small">{phase.label} — {phase.strategy?.[phase.phase] ?? ""}</p> : null}
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
              <div className="row gap">
                {/* B-FUS: weight:0 groups (regime/MTF layers) are documentary —
                    they read evidence but never move the verdict or the score. */}
                {gr.weight === 0 ? (
                  <span className="muted small">
                    {gr.observed === false ? "documentary · no directional evidence" : "documentary · evidence only"}
                  </span>
                ) : null}
                <Badge tone={gr.score > 0 ? "success" : gr.score < 0 ? "danger" : "muted"}>
                  {gr.score > 0 ? "+" : ""}{gr.score.toFixed(2)}
                </Badge>
              </div>
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
export function PaperTradingCard({
  positions = [],
  closed = [],
  refresh
}: {
  positions: PaperPosition[]
  closed: ClosedTrade[]
  refresh: () => void
}) {
  const [symbol, setSymbol] = useState("EURUSD")
  const [side, setSide] = useState<"up" | "down">("up")
  // No price pre-fill: the default "1.0000" wrote unobserved entries into the
  // ledger (3 of the 7 zero-PnL paper trades opened at the sentinel 1.0).
  // The operator types the price they actually observe, or the open is blocked.
  const [entry, setEntry] = useState("")
  const [amount, setAmount] = useState("100")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const entryNum = Number(entry)
  const openValid = Number.isFinite(entryNum) && entryNum > 0 && Number.isFinite(Number(amount)) && Number(amount) > 0

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
          <Input placeholder="observed price" value={entry} onChange={(e) => setEntry(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <Button disabled={!openValid} onClick={open}>Open paper position</Button>
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
              {/* Zero PnL (breakeven close) is NOT a success — render it neutral,
                  not green, so a flat close never reads as a win. */}
              <Badge tone={c.pnl > 0 ? "success" : c.pnl < 0 ? "danger" : "muted"}>
                {c.pnl > 0 ? "+" : ""}{c.pnl.toFixed(2)}
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
export function TradePlannerCard() {
  const [balance, setBalance] = useState("10000")
  const [riskPct, setRiskPct] = useState("2")
  const [entry, setEntry] = useState("1.1000")
  const [stop, setStop] = useState("1.0900")
  const [target, setTarget] = useState("1.1300")
  const [side, setSide] = useState<"up" | "down">("up")
  const [winRate, setWinRate] = useState("55")

  const b = Number(balance) || 0
  const e = Number(entry) || 0
  const s = Number(stop) || 0
  const t = Number(target) || 0
  const rp = Number(riskPct) || 0
  const wr = Number(winRate) || 0

  const valid = b > 0 && e > 0 && s > 0 && t > 0 && e !== s && t !== e
  const stopOk = side === "up" ? s < e : s > e
  const targetOk = side === "up" ? t > e : t < e
  const ok = valid && stopOk && targetOk

  const size = ok ? computePositionSize(b, rp, e, s) : null
  const rr = ok ? computeRiskReward(e, s, t) : null
  const kelly = ok && rr ? computeHalfKelly(wr, rr.rR) : null
  const rewardUsd = size && rr ? rr.rewardPerUnit * size.positionUnits : null
  const targetPct = rr ? (rr.rewardPerUnit / e) * 100 : null

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
        <Field label="Win rate % (for Kelly)">
          <Input type="number" min={1} max={99} value={winRate} onChange={(e) => setWinRate(e.target.value)} />
        </Field>
      </div>
      {!ok ? (
        <p className="muted small">
          {!valid ? "Enter positive balance, entry, stop and target." : !stopOk ? "Stop must be below entry for long / above entry for short." : "Take profit must be above entry for long / below entry for short."}
        </p>
      ) : (
        <>
          <div className="grid grid-4 muted small">
            <div>risk per trade: <strong className="danger-text">{fmtMoney(size ? size.riskUsd : null)}</strong></div>
            <div>position size: <strong>{size ? size.positionUnits.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"} units</strong></div>
            <div>notional: <strong>{fmtMoney(size ? size.notional : null)}</strong></div>
            <div>reward at target: <strong className="success-text">{fmtMoney(rewardUsd)}</strong></div>
            <div>reward:risk: <strong>{rr ? `${rr.rR.toFixed(2)}R` : "—"}</strong></div>
            <div>to stop: <strong>{size ? `-${size.stopPct.toFixed(2)}%` : "—"}</strong></div>
            <div>to target: <strong>{targetPct != null ? `+${targetPct.toFixed(2)}%` : "—"}</strong></div>
            <div>viability: <strong>{rr ? (rr.rR >= 1 ? "acceptable (≥1R)" : "poor (<1R)") : "—"}</strong></div>
          </div>
          <p className="muted small">
            {kelly != null
              ? `Kelly guidance: ${(kelly * 100).toFixed(1)}% of balance (half-Kelly)`
              : "Kelly guidance unavailable — enter a win rate between 1 and 99."}
            {kelly != null ? " Kelly assumes your win rate is accurate — it is not a prediction of future results." : ""}
          </p>
        </>
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
  // Deliberately NO pre-fill of the entry price. A close input seeded with the
  // entry makes a click-through Close record a fake breakeven (pnl 0) instead
  // of the price actually observed — the operator must type the exit they saw.
  const [exit, setExit] = useState("")
  const exitNum = Number(exit)
  const valid = Number.isFinite(exitNum) && exitNum > 0
  return (
    <div className="row-between">
      <div className="muted small">
        {position.symbol} {position.side.toUpperCase()} · {fmtMoney(position.amount)} @ {position.entry}
      </div>
      <div className="row gap">
        <Input className="input-sm" placeholder="exit price" value={exit} onChange={(e) => setExit(e.target.value)} />
        <Button variant="secondary" disabled={!valid} onClick={() => onClose(position.id, exit)}>
          Close
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Watchlist + multi-asset scanner (covers /trading/watchlist + /scan)
// ---------------------------------------------------------------------
export function WatchlistScannerCard() {
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
              <span className="muted small">{fmtMoney(q.last, q.currency)}</span>
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
export function NewsCard() {
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
      if (r.degraded) {
        setMsg({
          ok: false,
          text:
            r.degraded.reason === "news_api_unconfigured"
              ? "live news is not configured — configure SERPER_API_KEY to enable live news"
              : "live news unavailable — configure SERPER_API_KEY to enable live news"
        })
      } else if (r.items.length === 0) {
        setMsg({ ok: false, text: "No news found for that query." })
      }
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
      {news && Array.isArray(news.items) && news.items.length > 0 ? (
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
export function PaperAnalyticsCard() {
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
                      className={
                        p.pnl > 0 ? "bar-fill" : p.pnl < 0 ? "bar-fill bar-danger" : "bar-fill bar-flat"
                      }
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
export function SignalsCard({ signals, refresh }: { signals: TradingSignal[]; refresh: () => void }) {
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

  // Only genuinely pending signals get a resolve input. Signals the server
  // flushed as "unresolved" (stale or entryless) are shown as such and CANNOT
  // be resolved — offering an input for them would promise a resolution that
  // the engine will refuse (honesty: no entry price, no fabricated outcome).
  const pending = signals.filter((s) => s.status === "pending")

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
      {signals.slice(0, 8).map((s) => {
        const status = s.status === "pending" ? "pending" : s.status === "unresolved" ? "unresolved" : "resolved"
        return (
          <div key={s.id} className="row-between">
            <span className="muted small">
              {String(s.symbol ?? "")} {String(s.direction ?? "").toUpperCase()}
              <Badge tone={status === "resolved" ? "success" : status === "unresolved" ? "warn" : "muted"}>
                {status}
              </Badge>
            </span>
            <Badge tone={Number(s.confidence) >= 60 ? "success" : "muted"}>
              conf {Number(s.confidence ?? 0)}%
            </Badge>
          </div>
        )
      })}
      {accuracy && Array.isArray(accuracy.byDirection) && accuracy.byDirection.length > 0 ? (
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
