import { useState } from "react"
import { Select } from "@/components/ui"
import { PackRegistryStrip } from "@/components/PackRegistryStrip"
import { WatchlistPanel } from "@/components/WatchlistPanel"
import { SpreadPanel } from "@/components/SpreadPanel"
import { MarketIntelPanel } from "@/components/MarketIntelPanel"
import { CalendarPanel } from "@/components/CalendarPanel"
import { SessionPanel } from "@/components/SessionPanel"
import { ScreenerPanel } from "@/components/ScreenerPanel"

export function MarketsRoom() {
  const [chartAsset, setChartAsset] = useState("EURUSD")
  return (
    <div className="stack">
      <header data-room="markets">
        <h2>Markets</h2>
        <p className="muted small">Live market watch — quotes, spreads, calendar and session coverage.</p>
      </header>
      <PackRegistryStrip />
      <div className="row gap" style={{ alignItems: "center" }}>
        <span className="muted small">Cross-venue asset</span>
        <Select value={chartAsset} onChange={(e) => setChartAsset(e.target.value)}>
          <option value="EURUSD">EURUSD</option>
          <option value="GBPUSD">GBPUSD</option>
          <option value="BTCUSD">BTCUSD</option>
          <option value="ETHUSD">ETHUSD</option>
          <option value="GOLD">GOLD</option>
          <option value="AUDUSD">AUDUSD</option>
        </Select>
      </div>
      <SpreadPanel assetId={chartAsset} />
      <WatchlistPanel />
      <MarketIntelPanel />
      <CalendarPanel />
      <SessionPanel />
      <ScreenerPanel />
    </div>
  )
}
