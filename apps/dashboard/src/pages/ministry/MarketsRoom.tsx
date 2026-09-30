import { useState } from "react"
import { Select } from "@/components/ui"
import { PackRegistryStrip } from "@/components/PackRegistryStrip"
import { WatchlistPanel } from "@/components/WatchlistPanel"
import { SpreadPanel } from "@/components/SpreadPanel"
import { MarketIntelPanel } from "@/components/MarketIntelPanel"
import { CalendarPanel } from "@/components/CalendarPanel"
import { SessionPanel } from "@/components/SessionPanel"
import { ScreenerPanel } from "@/components/ScreenerPanel"
import { MarketsRoom as MarketsCopilotRoom } from "@/terminal/routes/MarketsRoom"

// WS-7 T7 (COP-22). The deterministic Copilot score surface is composed INTO
// the existing markets room rather than replacing it, and it is placed after
// the asset selector and before the six market panels.
//
// Three constraints shaped that placement, and each one is load-bearing:
//
//   - `data-room="markets"` stays the FIRST child of the room root. It is the
//     transition marker `e2e/terminal-perf.spec.ts:552,617` waits on, and the
//     reason the marker was chosen as the first unconditional child is
//     documented at `e2e/terminal-perf.spec.ts:106-117`. Moving it would change
//     what that measurement means.
//   - the six panels keep their order and their identities. COP-22 adds the
//     decision surface; it does not re-lay-out the market data, and
//     `e2e/terminal-perf.spec.ts:153-161` derives its per-panel instrumentation
//     from exactly those six components plus PackRegistryStrip.
//   - the surface is composed with NO reading, because the deterministic engine
//     that produces one is WS-7 T11 and has not been built. It therefore
//     renders the honest unavailable state naming its owner. It is NOT passed
//     a fabricated or placeholder score, and it is not passed the remote
//     copilot's prose, which AC-014 forbids from becoming a signal.
//
// It adds no fetch, so it adds no request to the transition window that the
// perf spec measures; it adds one synchronous component to the room's commit.
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
      <MarketsCopilotRoom confluence={null} />
      <SpreadPanel assetId={chartAsset} />
      <WatchlistPanel />
      <MarketIntelPanel />
      <CalendarPanel />
      <SessionPanel />
      <ScreenerPanel />
    </div>
  )
}
