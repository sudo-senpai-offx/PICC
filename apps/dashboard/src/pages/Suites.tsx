import { useCallback, useEffect, useState } from "react"
import { SUITE_META } from "@/lib/suites"
import type { SuiteMeta } from "@/lib/suites"
import { Card } from "@/components/ui"
import { MarketsSuite, AutopilotSuite } from "@/components/TradingSuite"
import { AutomatorPanel } from "@/components/AutomatorPanel"
import { ConnectorsPanel } from "@/components/ConnectorsPanel"
import { OverlaySettingsPanel } from "@/components/OverlaySettingsPanel"

const SUITE_CATEGORIES = Object.values(SUITE_META) as SuiteMeta[]

const SUITE_FEATURE_BADGES: Record<string, string[]> = {
  trading: ["Markets", "Decisions", "Autopilot", "Ledger", "Payouts", "Overlay HUD"],
  bandwidth: ["Automator", "Connectors", "Earnings"],
  depin: ["Node Health", "Earnings"],
  nft: ["Floor Price", "Volume", "Royalties"],
  defi: ["Yield Vault", "Staking"],
  crypto: ["Exchange", "Staking", "Portfolio"],
  p2p: ["Loan Tracking", "Earnings"],
  agent: ["Agent Economy", "Bounties"],
  other: ["Site Intelligence"]
}

const SUITE_DETAIL_COMPONENTS: Record<string, { label: string; Component: React.FC }[]> = {
  trading: [
    { label: "Markets & Prediction", Component: MarketsSuite },
    { label: "Autopilot", Component: AutopilotSuite }
  ],
  bandwidth: [
    { label: "Automator", Component: AutomatorPanel },
    { label: "Connectors", Component: ConnectorsPanel }
  ]
}

function SuiteDetail({ suiteId }: { suiteId: string }) {
  const meta = SUITE_META[suiteId]
  if (!meta) return null

  const detailTabs = SUITE_DETAIL_COMPONENTS[suiteId]
  const [tab, setTab] = useState(0)
  const ActivePanel = detailTabs?.[tab]?.Component

  return (
    <Card style={{ marginTop: 12 }}>
      <div className="row gap" style={{ alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 24 }}>{meta.icon}</span>
        <div>
          <h3 style={{ margin: 0 }}>{meta.label}</h3>
          <p className="muted small" style={{ margin: 0 }}>{meta.blurb}</p>
        </div>
      </div>

      {detailTabs && detailTabs.length > 0 ? (
        <>
          <div className="tabs">
            {detailTabs.map((t, i) => (
              <button key={i} type="button" className={tab === i ? "tab active" : "tab"} onClick={() => setTab(i)}>
                {t.label}
              </button>
            ))}
          </div>
          {ActivePanel ? <ActivePanel /> : null}
        </>
      ) : (
        <p className="muted small">
          This suite category does not have PICC-managed panels yet. Connectors and
          automator integrations can be added under Income → Connectors.
        </p>
      )}
    </Card>
  )
}

/**
 * Dashboard overlay: shows all overlay dockables in default preset mode.
 * The overlay settings panel here edits the DEFAULT preset for the suite type.
 * Per-site customization is available as a separate section below.
 */
function DashboardOverlay({ suiteId, onClose }: { suiteId: string; onClose: () => void }) {
  const meta = SUITE_META[suiteId]
  const [presetTab, setPresetTab] = useState<"default" | "per-site">("default")
  const [perSiteId, setPerSiteId] = useState("")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  if (!meta) return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "rgba(10, 10, 30, 0.6)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: "rgba(20, 20, 48, 0.95)",
          border: "1px solid rgba(108, 99, 255, 0.5)",
          borderRadius: 16,
          padding: "20px 24px",
          maxWidth: 600,
          width: "100%",
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 16px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(108,99,255,0.15)",
          color: "#eef0ff",
          fontFamily: "13px/1.5 system-ui, sans-serif"
        }}
      >
        <div className="row gap" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div className="row gap" style={{ alignItems: "center" }}>
            <span style={{ fontSize: 24 }}>{meta.icon}</span>
            <div>
              <h3 style={{ margin: 0, color: "#eef0ff" }}>PICC Overlay — {meta.label}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                Default preset for all {meta.label.toLowerCase()} sites. Per-site overrides available below.
              </p>
            </div>
          </div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={onClose}
            title="Close overlay preview"
            style={{ color: "#eef0ff", fontSize: 18, lineHeight: 1, padding: "4px 8px" }}
          >
            ✕
          </button>
        </div>

        {/* Dockable preview cards */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {getDockablePreviewCards(suiteId).map((d) => (
            <div
              key={d.id}
              style={{
                flex: "1 1 140px",
                background: "rgba(26, 26, 46, 0.8)",
                border: "1px solid rgba(108, 99, 255, 0.3)",
                borderRadius: 8,
                padding: "10px 12px",
                minWidth: 140,
              }}
            >
              <div style={{ fontSize: 16, marginBottom: 4 }}>{d.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{d.title}</div>
              <div style={{ fontSize: 10, color: "#9aa0c0" }}>
                {d.defaultSize.width}×{d.defaultSize.height} · {d.defaultPosition}
              </div>
            </div>
          ))}
        </div>

        {/* Settings mode tabs */}
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`tab ${presetTab === "default" ? "active" : ""}`}
            onClick={() => setPresetTab("default")}
          >
            ⚙ Default Preset
          </button>
          <button
            type="button"
            className={`tab ${presetTab === "per-site" ? "active" : ""}`}
            onClick={() => setPresetTab("per-site")}
          >
            🌐 Per-Site Override
          </button>
        </div>

        {presetTab === "default" ? (
          <div>
            <p className="muted small" style={{ margin: "0 0 8px" }}>
              These settings apply as the default to every {meta.label.toLowerCase()} site.
              Individual sites can override these via the Per-Site tab.
            </p>
            <OverlaySettingsPanel site={`__suite_default__${suiteId}`} mode="suite-default" suiteId={suiteId} />
          </div>
        ) : (
          <div>
            <p className="muted small" style={{ margin: "0 0 8px" }}>
              Override the default preset for a specific site. Enter the site id (e.g. "binance", "speedtest").
            </p>
            <div className="row gap" style={{ marginBottom: 12, alignItems: "center" }}>
              <input
                type="text"
                className="input"
                placeholder="Site id (e.g. binance)"
                value={perSiteId}
                onChange={(e) => setPerSiteId(e.target.value.toLowerCase().trim())}
                style={{ flex: 1 }}
              />
            </div>
            {perSiteId ? (
              <OverlaySettingsPanel site={perSiteId} mode="per-site" suiteId={suiteId} />
            ) : (
              <p className="muted small">Enter a site id above to customize its overlay.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function getDockablePreviewCards(suiteId: string) {
  const presets: Record<string, { id: string; title: string; icon: string; defaultPosition: string; defaultSize: { width: number; height: number }; defaultCollapsed: boolean }[]> = {
    trading: [
      { id: "price-ticker", title: "Price Ticker", icon: "📈", defaultPosition: "top-right", defaultSize: { width: 280, height: 200 }, defaultCollapsed: false },
      { id: "portfolio", title: "Portfolio", icon: "📊", defaultPosition: "top-left", defaultSize: { width: 300, height: 180 }, defaultCollapsed: true },
      { id: "ai-signals", title: "AI Signals", icon: "🧠", defaultPosition: "right", defaultSize: { width: 260, height: 260 }, defaultCollapsed: true },
      { id: "risk-mgr", title: "Risk Manager", icon: "⚠️", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 140 }, defaultCollapsed: true },
      { id: "autopilot", title: "Autopilot", icon: "🤖", defaultPosition: "bottom-left", defaultSize: { width: 260, height: 180 }, defaultCollapsed: false },
    ],
    bandwidth: [
      { id: "speed", title: "Speed Monitor", icon: "📡", defaultPosition: "top-right", defaultSize: { width: 280, height: 200 }, defaultCollapsed: false },
      { id: "connectors", title: "Connectors", icon: "🔌", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
    ],
    affiliate: [
      { id: "tracker", title: "Affiliate Tracker", icon: "💰", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "optimizer", title: "Link Optimizer", icon: "🔗", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
    ],
    content: [
      { id: "analytics", title: "Content Analytics", icon: "📊", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "scheduler", title: "Post Scheduler", icon: "📅", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
    ],
    dividend: [
      { id: "portfolio", title: "Dividend Portfolio", icon: "💎", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "calendar", title: "Ex-Date Calendar", icon: "📅", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
    ],
    defi: [
      { id: "yield", title: "Yield Tracker", icon: "🌱", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "gas", title: "Gas Tracker", icon: "⛽", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 160 }, defaultCollapsed: true },
    ],
  }
  return presets[suiteId] || [{ id: "general", title: "PICC Panel", icon: "🧠", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 160 }, defaultCollapsed: false }]
}

export function Suites() {
  const [activeSuite, setActiveSuite] = useState<string | null>(null)
  const [overlaySuite, setOverlaySuite] = useState<string | null>(null)

  const toggleSuite = useCallback((id: string) => {
    setActiveSuite((prev) => (prev === id ? null : id))
  }, [])

  const toggleSuiteOverlay = useCallback((suiteId: string) => {
    setOverlaySuite((prev) => (prev === suiteId ? null : suiteId))
  }, [])

  return (
    <div className="stack stack-lg">
      <header>
        <div className="row gap" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1>Suites</h1>
            <p className="muted">
              Every income-source category has a PICC suite: the intelligence, automations, overlays
              and settings that make it work. Manage all suites from here — configure, launch, and
              monitor each one.
            </p>
          </div>
          <div className="row gap" style={{ alignItems: "center" }}>
            {overlaySuite ? (
              <span className="badge badge-success">Overlay: {SUITE_META[overlaySuite]?.label ?? overlaySuite}</span>
            ) : (
              <span className="badge badge-muted">No overlay active</span>
            )}
            <span className="muted small" style={{ whiteSpace: "nowrap" }}>
              <kbd style={{ fontSize: 10 }}>Ctrl</kbd>+<kbd style={{ fontSize: 10 }}>Alt</kbd>+<kbd style={{ fontSize: 10 }}>Shift</kbd>+<kbd style={{ fontSize: 10 }}>O</kbd>
            </span>
          </div>
        </div>
      </header>

      <div className="grid-3">
        {SUITE_CATEGORIES.map((suite) => {
          const badges = SUITE_FEATURE_BADGES[suite.id] ?? []
          const isActive = activeSuite === suite.id
          const hasPanel = !!SUITE_DETAIL_COMPONENTS[suite.id]
          const isOverlayActive = overlaySuite === suite.id

          return (
            <div
              key={suite.id}
              role="button"
              tabIndex={0}
              style={{ cursor: "pointer" }}
              onClick={() => toggleSuite(suite.id)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") toggleSuite(suite.id) }}
            >
              <Card
                style={{
                  border: isActive ? "1px solid var(--accent, #6c63ff)" : undefined,
                  transition: "border-color 0.15s"
                }}
              >
              <div className="row gap" style={{ alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 28 }}>{suite.icon}</span>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0 }}>{suite.label}</h3>
                  <p className="muted small" style={{ margin: 0 }}>{suite.blurb}</p>
                </div>
              </div>
              <div className="row gap" style={{ flexWrap: "wrap", marginTop: 8 }}>
                {badges.map((b) => (
                  <span key={b} className="badge badge-muted">{b}</span>
                ))}
                {hasPanel ? (
                  <span className="badge badge-success">Manageable</span>
                ) : (
                  <span className="badge badge-muted">Site-only</span>
                )}
              </div>
              <div className="row gap" style={{ marginTop: 10, alignItems: "center", justifyContent: "space-between" }}>
                <p className="muted small" style={{ margin: 0 }}>
                  {isActive ? "Click to collapse" : "Click to manage"}
                </p>
                <button
                  className={`btn btn-sm ${isOverlayActive ? "btn-secondary" : "btn-primary"}`}
                  onClick={(e) => { e.stopPropagation(); toggleSuiteOverlay(suite.id) }}
                  title={isOverlayActive ? "Hide overlay" : "Show overlay for this suite"}
                >
                  {isOverlayActive ? "✕ Hide Overlay" : "🎯 Show Overlay"}
                </button>
              </div>
            </Card>
            </div>
          )
        })}
      </div>

      {activeSuite ? <SuiteDetail suiteId={activeSuite} /> : null}
      {overlaySuite ? <DashboardOverlay suiteId={overlaySuite} onClose={() => setOverlaySuite(null)} /> : null}
    </div>
  )
}
