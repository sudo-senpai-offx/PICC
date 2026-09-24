import { useEffect, useRef, useState, type ElementType } from "react"
import {
  getAutopilotConfig,
  getBrokerDemoStatus,
  getBrokers,
  getDemoAnalytics,
  getTradingCredentials,
  getTradingVenues,
  saveAutopilotConfig,
  saveTradingCredentials
} from "@/lib/trading"
import type {
  AutopilotAssetTarget,
  AutopilotConfig,
  BrokerDemoStatus,
  BrokersResult,
  DemoAnalyticsResult,
  TradingCredentials,
  TradingVenuesResult
} from "@/lib/trading"
import { normalizeAutopilotAssets, parseCcxtPairsJson } from "@/lib/trading"
import { withActionLock } from "@/lib/dangerousActionLock"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { Badge, Button, Card, Field, Input, Select, Spinner, Textarea } from "@/components/ui"

// WS-5 R1.2: the only collaborator injected as a prop is SignalNotificationsCard, because it is
// defined inside TradingSuite.tsx and importing it here would create a hard cycle. Every other
// dependency has its own module and is imported directly, so this component stays self-contained.
import { IOSInstallBanner } from "@/components/IOSInstallBanner"
import { ReadinessPanel } from "@/components/ReadinessPanel"
import { SignalWindowChip } from "@/components/SignalWindowChip"
import { TradingChart } from "@/components/TradingChart"
import { Link } from "react-router-dom"

type AutopilotSuiteProps = {
  SignalNotificationsCard: ElementType
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "\u20AC", GBP: "\u00A3", JPY: "\u00A5", CNY: "\u00A5", KRW: "\u20A9", INR: "\u20B9", BRL: "R$", RUB: "\u20BD", AUD: "A$", CAD: "C$", CHF: "CHF ", NGN: "\u20A6", PHP: "\u20B1", THB: "\u0E3F", VND: "\u20AB", MYR: "RM", IDR: "Rp" }
function fmtMoney(n: number | null | undefined, currency?: string | null): string {
  if (n == null) return "\u2014"
  const sym = CURRENCY_SYMBOLS[(currency || "USD").toUpperCase()] || (currency || "$") + " "
  return sym + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

export function AutopilotSuite({ SignalNotificationsCard }: AutopilotSuiteProps) {
  const [cfg, setCfg] = useState<AutopilotConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [demo, setDemo] = useState<BrokerDemoStatus | null>(null)
  const [analytics, setAnalytics] = useState<DemoAnalyticsResult | null>(null)
  const [creds, setCreds] = useState<{ token: string; demo: boolean; riskPct: number; ccxtJson: string }>({
    token: "",
    demo: true,
    riskPct: 2,
    ccxtJson: ""
  })
  const [credsMsg, setCredsMsg] = useState<string | null>(null)
  const [brokers, setBrokers] = useState<BrokersResult | null>(null)
  const [venues, setVenues] = useState<TradingVenuesResult | null>(null)
  const [scopeAsset, setScopeAsset] = useState<string>("")
  const lastLoadAt = useRef(0)
  const { snapshot } = useRealtimeSuite()

  const load = async () => {
    try {
      const [c, d, a, cr, br] = await Promise.allSettled([
        getAutopilotConfig(),
        getBrokerDemoStatus(),
        getDemoAnalytics().catch(() => null),
        getTradingCredentials(),
        getBrokers().catch(() => null)
      ])
      lastLoadAt.current = Date.now()
      if (c.status === "fulfilled" && c.value.ok) {
        setCfg(c.value.config)
        if (!scopeAsset) setScopeAsset(c.value.config.assetId)
      }
      if (d.status === "fulfilled") setDemo(d.value)
      if (a.status === "fulfilled" && a.value) setAnalytics(a.value)
      if (br.status === "fulfilled" && br.value?.ok) setBrokers(br.value)
      if (cr.status === "fulfilled") {
        // Token comes back masked ("••••••") — only show whether one exists.
        const raw = cr.value as unknown as Record<string, unknown>
        const masked = typeof raw.expertoptionToken === "string" ? raw.expertoptionToken : ""
        setCreds((prev) => ({
          ...prev,
          demo: raw.expertoptionDemo !== false,
          riskPct: Number(raw.riskPerTradePct) || 2,
          token: masked && !masked.includes("•") ? masked : "",
          ccxtJson:
            Array.isArray(raw.ccxtExchanges) && raw.ccxtExchanges.length
              ? JSON.stringify(raw.ccxtExchanges, null, 2)
              : prev.ccxtJson
        }))
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  useEffect(() => { void load() }, [])

  // Redirect targets depend on the scoped asset — refresh when it changes.
  useEffect(() => {
    if (!scopeAsset) return
    void getTradingVenues(scopeAsset).then((v) => { if (v?.ok) setVenues(v) }).catch(() => null)
  }, [scopeAsset])

  // Settings stay in sync with the overlay dockables: re-pull the shared
  // server config when the tab regains focus (overlay may have changed it).
  useEffect(() => {
    const onFocus = () => { void load() }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  useEffect(() => {
    if (!snapshot || snapshot.ts < lastLoadAt.current) return
    if (snapshot.demo) setDemo(snapshot.demo)
    if (snapshot.analytics) setAnalytics(snapshot.analytics)
  }, [snapshot])

  // Keep in sync when autopilot config changes elsewhere (overlay dockables).
  useEffect(() => {
    if (!demo?.autopilot || !cfg) return
    const serverCfg = demo.autopilot
    if (serverCfg.enabled !== cfg.enabled || serverCfg.stopReason !== cfg.stopReason) {
      setCfg((c) => (c ? { ...c, enabled: serverCfg.enabled, stopReason: serverCfg.stopReason } : c))
    }
  }, [demo?.autopilot?.enabled, demo?.autopilot?.stopReason])

  const saveCfg = async () => {
    if (!cfg) return
    setBusy(true)
    try {
      const assets = normalizeAutopilotAssets(cfg.assets)
      const primary = assets.find((a) => a.enabled)?.assetId ?? cfg.assetId
      const r = await withActionLock("autopilot-config", () =>
        saveAutopilotConfig({ ...cfg, assets, assetId: primary } as Partial<AutopilotConfig>)
      )
      if (r.ok) { setCfg(r.config); setScopeAsset(primary); setMsg({ ok: true, text: "Autopilot settings saved." }) }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const updateCfg = (patch: Partial<AutopilotConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c))

  // ── Asset scope management ────────────────────────────────────────────
  const assets = normalizeAutopilotAssets(cfg?.assets)
  const enabledAssets = assets.filter((a) => a.enabled)

  const updateAsset = (assetId: string, patch: Partial<AutopilotAssetTarget>) =>
    updateCfg({
      assets: normalizeAutopilotAssets(cfg?.assets).map((a) => (a.assetId === assetId ? { ...a, ...patch } : a))
    })

  const addAsset = () => {
    if (!cfg) return
    const existing = new Set(normalizeAutopilotAssets(cfg.assets).map((a) => a.assetId))
    const candidates = ["EURUSD", "GBPUSD", "BTCUSD", "ETHUSD", "GOLD", "AUDUSD"]
    const nextId = candidates.find((c) => !existing.has(c)) ?? `ASSET${existing.size + 1}`
    updateCfg({
      assets: [
        ...normalizeAutopilotAssets(cfg.assets),
        { assetId: nextId, enabled: true, duration: null, amount: null, minConfidence: null }
      ]
    })
  }

  const removeAsset = (assetId: string) =>
    updateCfg({ assets: normalizeAutopilotAssets(cfg?.assets).filter((a) => a.assetId !== assetId) })

  const saveCredentials = async () => {
    setBusy(true)
    setCredsMsg(null)
    try {
      const parsed = parseCcxtPairsJson(creds.ccxtJson)
      if (!parsed.ok) {
        setCredsMsg(parsed.error)
        setBusy(false)
        return
      }
      const patch: Partial<TradingCredentials> = {
        expertoptionDemo: creds.demo,
        riskPerTradePct: Math.min(20, Math.max(1, Number(creds.riskPct) || 2)),
        ccxtExchanges: parsed.pairs
      }
      // Only send the token when the user typed a NEW one (masked reads stay untouched).
      if (creds.token.trim()) patch.expertoptionToken = creds.token.trim()
      await saveTradingCredentials(patch)
      setCreds((p) => ({ ...p, token: "" }))
      setCredsMsg("Credentials saved.")
      await load()
    } catch (e) {
      setCredsMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const scopeOptions = [...new Set([...enabledAssets.map((a) => a.assetId), cfg?.assetId ?? ""])].filter(Boolean)
  const chartAssetId = scopeAsset || scopeOptions[0]

  return (
    <div className="stack">
      <p className="muted">
        Automated demo-trading engine. The engine scans EVERY asset enabled below each tick and applies your
        risk rules per asset. Configure individual assets here or from the overlay Autopilot dockable — both
        write to the same shared configuration. You always stay in control.
      </p>

      <ReadinessPanel />

      {/* T2 / REQ-2 — iOS install-first guidance, next to the advisory surface. */}
      <IOSInstallBanner />

      {/* T7 / REQ-8 — live window countdown for the in-scope asset. Renders
          nothing until the engine reports it alerted; counts down to the
          window close computed from the SAME prefs feed the dispatch used. */}
      <SignalWindowChip assetId={chartAssetId} />

      <SignalNotificationsCard />

      {/* ─── Live Chart (follows the selected scope asset) ─── */}
      {chartAssetId ? (
        <Card className="pad stack">
          <div className="row-between" style={{ alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Engine chart</h3>
            {scopeOptions.length > 1 ? (
              <Select value={chartAssetId} onChange={(e) => setScopeAsset(e.target.value)}>
                {scopeOptions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </Select>
            ) : (
              <span className="muted small">{chartAssetId}</span>
            )}
          </div>
          <TradingChart assetId={chartAssetId} height={340} />
        </Card>
      ) : null}

      {/* ─── Quick Stats ─── */}
      <div className="grid grid-4">
        <Card className="pad">
          <div className="stat-label muted">Today PnL</div>
          <div className="stat-value">{fmtMoney(demo?.todayPnl, demo?.currency)}</div>
          <div className="muted small">{demo?.todayTrades ?? 0} trades today</div>
        </Card>
        <Card className="pad">
          <div className="stat-label muted">Win Rate</div>
          <div className="stat-value">{analytics?.overview.winRate != null ? `${analytics.overview.winRate}%` : "—"}</div>
          <div className="muted small">{analytics?.overview.wins ?? 0}W · {analytics?.overview.losses ?? 0}L</div>
        </Card>
        <Card className="pad">
          <div className="stat-label muted">Balance</div>
          <div className="stat-value">{fmtMoney(demo?.balance, demo?.currency)}</div>
          <div className="muted small">{demo?.currency ?? "USD"} · {demo?.demo ? "demo" : "live"}</div>
        </Card>
        <Card className="pad">
          <div className="stat-label muted">Max Drawdown</div>
          <div className="stat-value">{analytics?.metrics.maxDrawdown != null ? `${analytics.metrics.maxDrawdown}%` : "—"}</div>
          <div className="muted small">avg hold {analytics?.overview.avgDurationSec != null ? `${analytics.overview.avgDurationSec}s` : "—"}</div>
        </Card>
      </div>

      {/* ─── Trading venues (broker adapter registry) ─── */}
      {brokers?.ok ? (
        <Card className="pad stack">
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Trading venues</h3>
            <Badge tone="muted">executor: {brokers.activeExecutor}</Badge>
          </div>
          <div className="stack">
            {brokers.brokers.map((b) => (
              <div key={b.slug} className="card pad" style={{ opacity: b.configured ? 1 : 0.55 }}>
                <div className="row-between" style={{ alignItems: "center" }}>
                  <strong className="small">{b.label}</strong>
                  <span className="row gap" style={{ alignItems: "center" }}>
                    <Badge tone={b.connected ? "success" : b.configured ? "warn" : "muted"}>
                      {b.connected ? "connected" : b.configured ? "configured" : "not set up"}
                    </Badge>
                    {b.demoOnly ? <Badge tone="muted">demo-only</Badge> : null}
                  </span>
                </div>
                <div className="row gap muted small" style={{ flexWrap: "wrap", marginTop: 4 }}>
                  {b.capabilities.map((cap) => <span key={cap} className="badge badge-muted">{cap}</span>)}
                </div>
                {b.pairs && b.pairs.length ? (
                  <p className="muted small" style={{ margin: "4px 0 0" }}>
                    pairs: {b.pairs.map((p) => `${p.exchange}:${p.symbol}`).join(", ")}
                  </p>
                ) : null}
                {b.notes ? <p className="muted small" style={{ margin: "4px 0 0" }}>{b.notes}</p> : null}
                {(() => {
                  const lat = brokers.latency?.[b.slug]
                  if (!lat || lat.samples === 0) return null
                  return (
                    <p className="muted small" style={{ margin: "4px 0 0" }} title={`${lat.samples} recent fetches (ring window)`}>
                      candle latency: median <strong>{lat.medianMs ?? "—"}ms</strong> · p95 <strong>{lat.p95Ms ?? "—"}ms</strong>
                    </p>
                  )
                })()}
              </div>
            ))}
          </div>
          {venues?.venues.length ? (
            <div className="stack" style={{ borderTop: "1px solid var(--border, rgba(128,128,128,.2))", paddingTop: 8 }}>
              <span className="field-label small">Trade on the venue</span>
              <p className="muted small" style={{ margin: 0 }}>
                PICC never places orders — these buttons open the venue in a new tab so you act there.
              </p>
              <div className="row gap" style={{ flexWrap: "wrap" }}>
                {venues.venues.map((v) => (
                  <a
                    key={v.id}
                    href={v.tradeUrl ?? v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="badge badge-muted"
                    style={{ textDecoration: "none", padding: "4px 10px" }}
                    title={
                      v.linkMode === "asset"
                        ? `Open ${v.name} on ${scopeAsset}`
                        : `Open ${v.name} (${v.platformKind ?? "trading"}) — pick ${scopeAsset || "your asset"} there`
                    }
                  >
                    {v.name} ↗
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid">
        {/* ─── Asset Scope (per-asset control) ─── */}
        <Card className="pad stack">
          <h3>Asset Scope</h3>
          <p className="muted small">
            The engine evaluates every ENABLED asset on every tick. Empty fields inherit the global defaults;
            filled values override them for that asset only.
          </p>
          {((demo?.autopilot?.scopeHealth?.problems?.length ?? 0) > 0) ? (
            <div
              className="card pad"
              style={{ border: "1px solid var(--danger)", color: "var(--danger)" }}
              data-testid="scope-health-warning"
            >
              <strong>Unresolvable assets in scope</strong>
              <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {(demo?.autopilot?.scopeHealth?.rows ?? [])
                  .filter((r) => !r.resolvable)
                  .map((r) => (
                    <li key={r.assetId}>
                      <code>{r.assetId}</code> — {r.problem}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {cfg ? (
            <div className="stack">
              {(assets.length ? assets : [{ assetId: cfg.assetId, enabled: true, duration: null, amount: null, minConfidence: null }]).map((a) => (
                <div key={a.assetId} className="card pad" style={{ opacity: a.enabled ? 1 : 0.55 }}>
                  <div className="row-between" style={{ marginBottom: 4 }}>
                    <ToggleRow label="" checked={a.enabled} onChange={() => updateAsset(a.assetId, { enabled: !a.enabled })} />
                    <Button variant="ghost" className="btn-sm" disabled={busy} onClick={() => removeAsset(a.assetId)} title="Remove from scope">
                      ✕
                    </Button>
                  </div>
                  <div className="grid grid-2">
                    <Field label="Asset">
                      <Input
                        value={a.assetId}
                        onChange={(e) => updateAsset(a.assetId, { assetId: e.target.value.toUpperCase() })}
                      />
                    </Field>
                    <Field label={`Duration (s) · global ${cfg.duration}`}>
                      <Input
                        type="number"
                        placeholder={`${cfg.duration}`}
                        value={a.duration ?? ""}
                        onChange={(e) => updateAsset(a.assetId, { duration: e.target.value ? Number(e.target.value) : null })}
                      />
                    </Field>
                    <Field label="Amount (blank = auto)">
                      <Input
                        type="number"
                        min={1}
                        placeholder={cfg.amount != null ? String(cfg.amount) : "auto"}
                        value={a.amount ?? ""}
                        onChange={(e) => updateAsset(a.assetId, { amount: e.target.value ? Number(e.target.value) : null })}
                      />
                    </Field>
                    <Field label={`Min confidence % · global ${cfg.minConfidence}`}>
                      <Input
                        type="number"
                        min={30}
                        max={95}
                        placeholder={`${cfg.minConfidence}`}
                        value={a.minConfidence ?? ""}
                        onChange={(e) => updateAsset(a.assetId, { minConfidence: e.target.value ? Number(e.target.value) : null })}
                      />
                    </Field>
                  </div>
                </div>
              ))}
              <Button variant="ghost" disabled={assets.length >= 20} onClick={addAsset}>
                + Add asset to scope
              </Button>
            </div>
          ) : (
            <Spinner label="Loading scope…" />
          )}
        </Card>

        {/* ─── Risk Controls ─── */}
        <Card className="pad stack">
          <h3>Risk Controls</h3>
          <p className="muted small">Global limits the autopilot must respect across ALL scoped assets.</p>
          {cfg ? (
            <div className="stack">
              <div className="grid grid-2">
                <Field label="Primary asset (legacy display)">
                  <Input value={cfg.assetId} onChange={(e) => updateCfg({ assetId: e.target.value.toUpperCase() })} />
                </Field>
                <Field label="Default duration (s)">
                  <Input type="number" value={cfg.duration} onChange={(e) => updateCfg({ duration: Number(e.target.value) || 60 })} />
                </Field>
                <Field label="Default amount per trade">
                  <Input type="number" min={1} placeholder="auto" value={cfg.amount ?? ""} onChange={(e) => updateCfg({ amount: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <Field label="Default min confidence %">
                  <Input type="number" min={1} max={100} value={cfg.minConfidence} onChange={(e) => updateCfg({ minConfidence: Number(e.target.value) })} />
                </Field>
              </div>

              <h4 className="small" style={{ marginTop: 8 }}>Position Management</h4>
              <div className="grid grid-2">
                <Field label="Cooldown between trades (ms)">
                  <Input type="number" min={0} value={cfg.cooldownMs} onChange={(e) => updateCfg({ cooldownMs: Number(e.target.value) })} />
                </Field>
                <Field label="Max concurrent positions (all assets)">
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
                <Field label="Signal timeframe (s)">
                  <Input type="number" value={cfg.timeframe} onChange={(e) => updateCfg({ timeframe: Number(e.target.value) || 60 })} />
                </Field>
                <div />
              </div>
              <ToggleRow label="AI gate (confirm with assistant)" checked={cfg.aiGate} onChange={() => updateCfg({ aiGate: !cfg.aiGate })} />
              <ToggleRow label="Pro-analysis gate (full indicator read)" checked={cfg.proGate} onChange={() => updateCfg({ proGate: !cfg.proGate })} />
              <ToggleRow
                label="Model-matrix consensus gate (multiplexed models must agree)"
                checked={cfg.consensusGate ?? false}
                onChange={() => updateCfg({ consensusGate: !(cfg.consensusGate ?? false) })}
              />
              {(cfg.consensusGate ?? false) ? (
                <Field label={`Min models agreeing (of 7) · now ${Math.min(7, Math.max(1, Number(cfg.minConsensusAgree) || 4))}`}>
                  <input
                    type="range"
                    min={1}
                    max={7}
                    value={Math.min(7, Math.max(1, Number(cfg.minConsensusAgree) || 4))}
                    onChange={(e) => updateCfg({ minConsensusAgree: Number(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                </Field>
              ) : null}

              <Button variant="primary" disabled={busy} onClick={saveCfg}>
                {busy ? "Saving…" : "Save Autopilot Settings"}
              </Button>
            </div>
          ) : (
            <Spinner label="Loading config…" />
          )}
        </Card>
      </div>

      {/* ─── Broker credentials (required to run) ─── */}
      <Card className="pad stack">
        <h3>Broker Connection</h3>
        <p className="muted small">
          The engine refuses to run without a DEMO broker token here. Token is stored server-side and never
          echoed back in full.
        </p>
        <div className="grid grid-3">
          <Field label="Session token (paste to replace)">
            <Input
              type="password"
              placeholder={demo?.configured ? "token saved ✓" : "paste session token"}
              value={creds.token}
              onChange={(e) => setCreds((p) => ({ ...p, token: e.target.value }))}
            />
          </Field>
          <Field label="Risk cap per trade %">
            <Input
              type="number"
              min={1}
              max={20}
              value={creds.riskPct}
              onChange={(e) => setCreds((p) => ({ ...p, riskPct: Number(e.target.value) }))}
            />
          </Field>
          <div className="stack" style={{ justifyContent: "flex-end" }}>
            <ToggleRow label="Demo account (required)" checked={creds.demo} onChange={() => setCreds((p) => ({ ...p, demo: !p.demo }))} />
            <Button variant="secondary" disabled={busy} onClick={saveCredentials}>Save credentials</Button>
          </div>
        </div>
        <div className="stack">
          <p className="muted small">
            CCXT market-data pairs (public, no key) — the spread route and order rail use these for cross-venue
            OHLCV/ticker reads. Format: JSON array of {"{"} exchange, symbol, timeframe? {"}"}. Up to 12 pairs;
            validated locally before saving.
          </p>
          <Textarea
            rows={4}
            spellCheck={false}
            style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            value={creds.ccxtJson}
            placeholder={"[\n  { \"exchange\": \"binance\", \"symbol\": \"BTCUSDT\", \"timeframe\": \"5m\" }\n]"}
            onChange={(e) => setCreds((p) => ({ ...p, ccxtJson: e.target.value }))}
          />
        </div>
        {!demo?.configured ? (
          <p className="muted small">No token configured yet — autopilot ticks will report “no token configured” until saved.</p>
        ) : null}
        {credsMsg ? <p className="muted small">{credsMsg}</p> : null}
      </Card>

      {/* ─── Open Deals + Settlements ─── */}
      <div className="grid">
        <Card className="pad stack">
          <h3>Open Deals ({demo?.openDeals?.length ?? 0})</h3>
          {demo?.openDeals?.length ? (
            demo.openDeals.map((d) => (
              <div key={d.serverId || d.requestId} className="row-between">
                <span className="muted small">
                  {d.asset} {d.type.toUpperCase()} {fmtMoney(d.amount, demo?.currency)} · {d.status}
                </span>
                <span className="muted small">{d.expiresAt ? `exp ${new Date(d.expiresAt).toLocaleTimeString()}` : ""}</span>
              </div>
            ))
          ) : (
            <p className="muted small">No open deals. Start the autopilot to begin.</p>
          )}
        </Card>
      </div>
      <p className="muted small">
        Settled outcomes and decision accuracy live in the paper-room Ledger.{" "}
        <Link to="/suites/trading/paper">see Ledger</Link>
      </p>

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
              <strong>{fmtMoney(analytics.overview.netProfit, demo?.currency)}</strong>
            </div>
            <div>
              <div className="stat-label muted">Win Rate</div>
              <strong>{analytics.overview.winRate != null ? `${analytics.overview.winRate}%` : "—"}</strong>
            </div>
            <div>
              <div className="stat-label muted">Balance</div>
              <strong>{fmtMoney(analytics.overview.balance, demo?.currency)}</strong>
            </div>
            <div>
              <div className="stat-label muted">Starting</div>
              <strong>{fmtMoney(analytics.overview.starting, demo?.currency)}</strong>
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
                      title={`${p.t ?? "start"} · ${fmtMoney(p.equity, demo?.currency)}`}
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
        </Card>
      ) : null}

      {msg ? <p className={msg.ok ? "muted" : "danger-text"}>{msg.text}</p> : null}
    </div>
  )
}
