import { useState, useCallback } from "react"
import { Card } from "@/components/ui"
import { SignalFeed } from "@/components/SignalFeed"
import { AutopilotControls } from "@/components/AutopilotControls"
import { PaperLedger } from "@/components/PaperLedger"
import { TradingHud } from "@/components/TradingHud"
import { ConfluencePanel } from "@/components/ConfluencePanel"
import { TradeOrderForm } from "@/components/TradeOrderForm"

/**
 * Trading Dashboard — a dedicated page combining the three core trading
 * views into a single overview: live signal feed, autopilot controls,
 * and the paper trade ledger. Designed as a focused alternative to the
 * full TradingSuite for users who want a clean operational view.
 */
export function TradingDashboard() {
  const [orderPrefill, setOrderPrefill] = useState<{ symbol?: string; side?: "up" | "down" }>({})
  const [orderKey, setOrderKey] = useState(0)

  const handleCopyTrade = useCallback((params: { symbol: string; side: "up" | "down" }) => {
    setOrderPrefill(params)
    setOrderKey((k) => k + 1)
  }, [])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Trading Dashboard</h2>
        <span className="muted small">Decision support only — no real trades</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {/* Left column: Autopilot + Signal Feed */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card className="pad">
            <strong style={{ marginBottom: 4, display: "block" }}>Autopilot Control</strong>
            <AutopilotControls />
          </Card>
          <Card className="pad">
            <div className="row-between" style={{ marginBottom: 4 }}>
              <strong>Signal Feed</strong>
              <span className="muted small">Click Copy to fill the order form</span>
            </div>
            <SignalFeed maxItems={20} onCopyTrade={handleCopyTrade} />
          </Card>
        </div>

        {/* Center column: Confluence + Order Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ConfluencePanel maxItems={6} />
          <TradeOrderForm key={orderKey} prefill={orderPrefill} />
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
