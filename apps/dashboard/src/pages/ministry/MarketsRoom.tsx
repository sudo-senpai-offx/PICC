import { useEffect, useState } from "react"
import { Select } from "@/components/ui"
import { PackRegistryStrip } from "@/components/PackRegistryStrip"
import { WatchlistPanel } from "@/components/WatchlistPanel"
import { SpreadPanel } from "@/components/SpreadPanel"
import { MarketIntelPanel } from "@/components/MarketIntelPanel"
import { CalendarPanel } from "@/components/CalendarPanel"
import { SessionPanel } from "@/components/SessionPanel"
import { ScreenerPanel } from "@/components/ScreenerPanel"
import { MarketsRoom as MarketsCopilotRoom } from "@/terminal/routes/MarketsRoom"
import { fetchCopilotReading, type CopilotReading } from "@/terminal/adapters/copilotReading"

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
//   - the surface is composed with a REAL reading fetched from the server, so it
//     renders the engine's own score, per-expert contributions and fired vetoes.
//     It is NOT passed a fabricated or placeholder score, and it is not passed
//     the remote copilot's prose, which AC-014 forbids from becoming a signal.
//     Before the response arrives — and if it never does — it renders the honest
//     unavailable state naming the reason the adapter supplied.
//
// WHY THE PAGE FETCHES, AND WHAT IT DOES *NOT* FETCH.
//
// T7 wrote this composition with NO reading, because the engine that produces
// one had not been built. It has since (`a4fac35`), and T7R-B wired the room to
// it. The page's job is to ASK for the decision — never to compute one.
//
//   - IT ASKS FOR THE DECISION, NOT FOR CANDLES. `POST /api/trading/copilot`
//     fetches its own market state on the server, derives it, and evaluates it
//     (see `server/services/copilot/decision.mjs`). An earlier draft fetched
//     `/api/trading/candles` from here and ran the engine in the browser; that
//     was reverted because it duplicated the decision path in a second runtime,
//     left the server-side module still uncalled — the exact "no caller" gap T12
//     handoff #2 named — and put `computedAt`, which feeds the `sessionOpen`
//     veto, under the browser's control.
//   - ONE REQUEST. The engine needs a working-timeframe series, a 4H series and
//     400 daily closes. Those are three broker fetches INSIDE the one
//     authenticated call, so the room adds one request, not three.
//   - THAT REQUEST IS REGISTERED. `e2e/terminal-perf.spec.ts:153-161` attributes
//     the transition's requests to panels by endpoint prefix, and its own stated
//     practice is to list what the room actually fetches — `PackRegistryStrip` is
//     in that list precisely because it fetches on mount. `/api/trading/copilot`
//     is added there for the same reason. Omitting it would put the request in
//     the aggregate while attributing it to no panel, which is the attribution
//     defect the harness exists to prevent.
//
// Until the response arrives, and if it never does, the room renders its honest
// unavailable state with the reason the adapter supplied. A pending request is
// not a score of zero.
export function MarketsRoom() {
  const [chartAsset, setChartAsset] = useState("EURUSD")
  const [reading, setReading] = useState<CopilotReading | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    void fetchCopilotReading(chartAsset, { signal: controller.signal }).then((next) => {
      if (alive) setReading(next)
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [chartAsset])

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
      {reading === null ? null : (
        <MarketsCopilotRoom
          confluence={reading.confluence}
          vetoes={reading.vetoes}
          automationPermitted={reading.automationPermitted}
          rung={reading.rung}
        />
      )}
      <SpreadPanel assetId={chartAsset} />
      <WatchlistPanel />
      <MarketIntelPanel />
      <CalendarPanel />
      <SessionPanel />
      <ScreenerPanel />
    </div>
  )
}
