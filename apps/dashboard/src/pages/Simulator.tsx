import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { FinancialTwin } from "@/components/FinancialTwin"
import { ListingOptimizer } from "@/components/ListingOptimizer"
import { ContentStudio } from "@/components/ContentStudio"
import { MarketsSuite, AutopilotSuite } from "@/components/TradingSuite"
import { isFeatureOn } from "@/lib/settings"

const TABS = [
  { id: "twin", label: "📊 Financial Twin", feature: "simulator" as const },
  { id: "markets", label: "📈 Markets & Prediction", feature: "trading" as const },
  { id: "autopilot", label: "🤖 Autopilot", feature: "trading" as const },
  { id: "listing", label: "🛒 Listing Optimizer", feature: "overlay" as const },
  { id: "content", label: "🎬 Content Studio", feature: "content" as const }
]

type TabId = (typeof TABS)[number]["id"]

export function Simulator() {
  const [searchParams] = useSearchParams()
  const initialTab = (searchParams.get("tab") as TabId | null) ?? "twin"
  const [tab, setTab] = useState<TabId>(visibleTab(initialTab))
  const visibleTabs = TABS.filter((t) => isFeatureOn(t.feature))

  function visibleTab(t: TabId): TabId {
    return TABS.find((x) => x.id === t && isFeatureOn(x.feature)) ? t : "twin"
  }

  return (
    <div className="stack stack-lg">
      <header>
        <h1>Simulator</h1>
        <p className="muted">
          Sandbox tools that simulate outcomes and generate suggestions. Nothing executes — you
          always click the final button. Markets &amp; Prediction, paper trading, and the
          ExpertOption demo bridge all live here now.
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

      {!isFeatureOn("trading") ? (
        <p className="muted small" style={{ marginTop: 0 }}>
          The autopilot tab is hidden because the Trading Suite feature is off — enable it in
          Settings → Features, or open the dedicated Trading Suite page from the sidebar.
        </p>
      ) : null}

      {tab === "twin" ? <FinancialTwin /> : null}
      {tab === "markets" ? <MarketsSuite /> : null}
      {tab === "autopilot" ? <AutopilotSuite /> : null}
      {tab === "listing" ? <ListingOptimizer /> : null}
      {tab === "content" ? <ContentStudio /> : null}
    </div>
  )
}
