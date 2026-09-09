import { useState } from "react"
import { NavLink } from "react-router-dom"
import { FinancialTwin } from "@/components/FinancialTwin"
import { ListingOptimizer } from "@/components/ListingOptimizer"
import { ContentStudio } from "@/components/ContentStudio"
import { Card } from "@/components/ui"
import { isFeatureOn } from "@/lib/settings"

const TABS = [
  { id: "twin", label: "📊 Financial Twin", feature: "simulator" as const },
  { id: "listing", label: "🛒 Listing Optimizer", feature: "overlay" as const },
  { id: "content", label: "🎬 Content Studio", feature: "content" as const }
]

type TabId = (typeof TABS)[number]["id"]

export function SimulatorRoom() {
  const visibleTabs = TABS.filter((t) => isFeatureOn(t.feature))
  const [tab, setTab] = useState<TabId>(() => {
    if (isFeatureOn("simulator")) return "twin"
    return visibleTabs[0]?.id ?? "twin"
  })

  return (
    <div className="stack stack-lg">
      <header data-room="simulator">
        <h2>Simulator</h2>
        <p className="muted small">
          Sandbox tools that simulate outcomes and generate suggestions. Nothing executes — you
          always click the final button. Markets, paper trading, and the demo-broker Autopilot
          have their own rooms in this ministry.
        </p>
      </header>

      <div className="tabs">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "twin" && isFeatureOn("simulator") ? <FinancialTwin /> : null}
      {tab === "listing" && isFeatureOn("overlay") ? <ListingOptimizer /> : null}
      {tab === "content" && isFeatureOn("content") ? <ContentStudio /> : null}

      <div className="grid-2">
        <Card>
          <h3>Markets</h3>
          <p className="muted small">
            Live market watch, cross-venue spreads, and the economic calendar live in their own
            Markets room.
          </p>
          <NavLink to="../markets" className="btn btn-ghost btn-sm">
            Open Markets room →
          </NavLink>
        </Card>
        <Card>
          <h3>Autopilot</h3>
          <p className="muted small">
            The automated demo-trading engine lives in its own Autopilot room — configure scope and
            risk there.
          </p>
          <NavLink to="../autopilot" className="btn btn-ghost btn-sm">
            Open Autopilot room →
          </NavLink>
        </Card>
      </div>
    </div>
  )
}