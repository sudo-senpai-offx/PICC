import { useCallback, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { SUITE_META } from "@/lib/suites"
import type { SuiteMeta } from "@/lib/suites"
import { Card } from "@/components/ui"
import { MarketsSuite } from "@/components/TradingSuite"
import { CommandCentrePanel } from "@/components/CommandCentrePanel"

const SUITE_CATEGORIES = Object.values(SUITE_META) as SuiteMeta[]

// Feature badges only promise what each suite actually ships. Suites without
// PICC-managed panels are honestly labeled "Site-only" instead of advertising
// features that do not exist yet. Autopilot is NOT listed here: it moved to
// its own Simulator-page tab (shared AutopilotSuite, mounted once).
const SUITE_FEATURE_BADGES: Record<string, string[]> = {
  trading: ["Markets", "Decisions", "Ledger", "Payouts", "Overlay HUD"]
}

// Command Centre: ONE shared component (trading-only) mounted directly so the
// tab identity is stable across renders.
const SUITE_DETAIL_COMPONENTS: Record<string, { label: string; Component: React.FC }[]> = {
  // The trading suite's expanded view hosts the market/prediction panel only.
  // Autopilot (demo-broker paper trading) lives as its own tab on the
  // Simulator page — the SAME shared AutopilotSuite component, mounted once.
  // Removed the duplicate "Autopilot" tab here 2026-09-02 to de-duplicate the
  // entry point (see Simulator.tsx).
  trading: [
    { label: "Markets & Prediction", Component: MarketsSuite },
    { label: "Command Centre", Component: CommandCentrePanel }
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
          income sources are managed under Income.
        </p>
      )}
    </Card>
  )
}

export function Suites() {
  const [searchParams] = useSearchParams()
  // T6 / REQ-9: a notification deep link (?asset=…&panel=chart[&venue=…]) lands
  // directly on the trading suite instead of the collapsed card list. The
  // MarketsSuite landing effect then applies asset/panel/venue.
  const [activeSuite, setActiveSuite] = useState<string | null>(() =>
    searchParams.has("asset") || searchParams.has("panel") || searchParams.has("venue") ? "trading" : null
  )

  const toggleSuite = useCallback((id: string) => {
    setActiveSuite((prev) => (prev === id ? null : id))
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
            <span className="muted small">One command centre · every income pillar</span>
          </div>
        </div>
      </header>

      <div className="grid-3">
        {SUITE_CATEGORIES.map((suite) => {
          const badges = SUITE_FEATURE_BADGES[suite.id] ?? []
          const isActive = activeSuite === suite.id
          const hasPanel = !!SUITE_DETAIL_COMPONENTS[suite.id]

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
              <div style={{ marginTop: 10 }}>
                <p className="muted small" style={{ margin: 0 }}>
                  {isActive ? "Click to collapse" : "Click to manage"}
                </p>
              </div>
            </Card>
          </div>
          )
        })}
      </div>

      {activeSuite ? <SuiteDetail suiteId={activeSuite} /> : null}
    </div>
  )
}
