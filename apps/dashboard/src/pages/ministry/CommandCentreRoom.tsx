import { useState, useEffect } from "react"
import { SignalsCard } from "@/components/TradingSuite"
import { CommandCentrePanel } from "@/components/CommandCentrePanel"
import { UnlockCeremony } from "@/components/UnlockCeremony"
import { LeaderIdeasPanel } from "@/components/LeaderIdeasPanel"
import { PerpsCommandCentre } from "@/components/PerpsCommandCentre"
import { PatternPanel } from "@/components/PatternPanel"
import { AdvancedIndicatorsPanel } from "@/components/AdvancedIndicatorsPanel"
import { PreMortemSection } from "@/pages/ministry/PreMortemSection"
import { MarketAnalysisSection } from "@/pages/ministry/MarketAnalysisSection"
import { CandleCalculatorSection } from "@/pages/ministry/CandleCalculatorSection"
import { getTradingSignals } from "@/lib/trading"
import type { TradingSignal } from "@/lib/trading"
import { ReadOnlyRoom } from "@/terminal/routes/ReadOnlyRoom"
import { useReadOnlyView } from "./useReadOnlyView"

export function CommandCentreRoom() {
  const [signals, setSignals] = useState<TradingSignal[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  // WS-7 T10 (d1Order 9) — the read-only record for this instance.
  const { view: readOnlyView } = useReadOnlyView("command-centre", "trading")

  useEffect(() => {
    let alive = true
    getTradingSignals().then((g) => {
      if (!alive) return
      if (Array.isArray(g?.signals)) setSignals(g.signals)
    }).catch(() => {})
    return () => { alive = false }
  }, [reloadKey])

  const refresh = () => setReloadKey((k) => k + 1)

  return (
    <div className="stack">
      {/* WS-7 T10 — the read-only record. Note this instance's completion record
          carries the audit's headline finding: PerpsCommandCentre below posts to
          /command-centre/perps/execute and /command-centre/perps/close, so this
          page is an order-execution surface despite D1 calling the room
          read-only. Reported, not removed — that is a product decision. */}
      <ReadOnlyRoom view={readOnlyView} />

      <header data-room="command-centre">
        <h2>Command Centre</h2>
        <p className="muted small">Execution command — signals, chart patterns and advanced indicators.</p>
      </header>
      <CommandCentrePanel />
      <UnlockCeremony />
      <LeaderIdeasPanel />
      <PerpsCommandCentre />
      <PatternPanel />
      <AdvancedIndicatorsPanel assetId="EURUSD" timeframe="daily" />
      <SignalsCard signals={signals} refresh={refresh} />

      {/* W3-05. Mounted near the bottom on purpose: the readout costs about eleven seconds per
          run and is opt-in, so it must not sit above the panels a user opens this
          room to actually read. Its one button is also the first in this room's own
          markup — the header comment above already records that the room is an
          order-execution surface despite D1 calling it read-only, so this adds no
          new interaction class to it. It is deliberately NOT in the paper room,
          whose affordance audit enumerates every interactive element and would
          (correctly) reject it. */}
      <PreMortemSection />

      {/* UI-2. After the pre-mortem readout and below every execution panel, for
          the same reason plus one of its own: these four readouts are opt-in and
          three of them make the SERVER fetch data — `volatility` runs
          `getHistory(symbol, "3mo")` per symbol and `risk-parity` runs it once
          per symbol in a list. Mounting them where a reader lands first would
          either bury the execution panels or fire four multi-second fetches
          nobody asked for.

          The inputs and buttons here are ordinary form controls, which is a new
          interaction class in this room's markup and is why the room's own header
          comment matters: D1 calls this room read-only and the code already posts
          real orders from `PerpsCommandCentre`. This section places no order and
          holds no permit; it asks four analysis routes for a readout. It is still
          forbidden from the paper room, whose `PaperLiveRoom.test.tsx` enumerates
          every interactive element against an allowlist and would correctly reject
          four inputs and four buttons. */}
      <MarketAnalysisSection />

      {/* UI-3. Last, for the same opt-in reason, and it is the ONLY section in
          this room whose inputs are the dashboard's own candle series: these three
          routes fetch nothing server-side (`handlers.mjs:5703`, `:5711`, `:5740`
          all read `body.candles`), so each panel reads `fetchCandles` on demand.
          That reuse is deliberate — a second candle source would mean two
          provenance stories for one market — and it is why the panels print the
          asset, the bars actually sent and the serving source beside every
          number: a computed level is meaningless without the series under it.

          Same interaction caveat as UI-2 and for the same reason: this adds nine
          inputs and three buttons to a room the header already records as
          order-executing, and it is still forbidden from the paper room, whose
          `PaperLiveRoom.test.tsx` enumerates every interactive element against an
          allowlist. It places no order and holds no permit. */}
      <CandleCalculatorSection />
    </div>
  )
}
