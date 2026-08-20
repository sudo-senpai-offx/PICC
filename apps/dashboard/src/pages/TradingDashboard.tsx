import { Card } from "@/components/ui"
import { SignalFeed } from "@/components/SignalFeed"
import { AutopilotControls } from "@/components/AutopilotControls"
import { PaperLedger } from "@/components/PaperLedger"
import { TradingHud } from "@/components/TradingHud"

/**
 * Trading Dashboard — a dedicated page combining the three core trading
 * views into a single overview: live signal feed, autopilot controls,
 * and the paper trade ledger. Designed as a focused alternative to the
 * full TradingSuite for users who want a clean operational view.
 */
export function TradingDashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Trading Dashboard</h2>
        <span className="muted small">Decision support only — no real trades</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Left column: Autopilot + Signal Feed */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card className="pad">
            <strong style={{ marginBottom: 4, display: "block" }}>Autopilot Control</strong>
            <AutopilotControls />
          </Card>
          <Card className="pad">
            <strong style={{ marginBottom: 4, display: "block" }}>Signal Feed</strong>
            <SignalFeed maxItems={20} />
          </Card>
        </div>

        {/* Right column: Paper Ledger */}
        <div>
          <Card className="pad">
            <strong style={{ marginBottom: 4, display: "block" }}>Paper Ledger</strong>
            <PaperLedger />
          </Card>
        </div>
      </div>

      {/* Floating trading HUD from the overlay system */}
      <TradingHud />
    </div>
  )
}
