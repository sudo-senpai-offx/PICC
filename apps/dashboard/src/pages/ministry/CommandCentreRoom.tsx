import { useState, useEffect } from "react"
import { SignalsCard } from "@/components/TradingSuite"
import { CommandCentrePanel } from "@/components/CommandCentrePanel"
import { UnlockCeremony } from "@/components/UnlockCeremony"
import { LeaderIdeasPanel } from "@/components/LeaderIdeasPanel"
import { PerpsCommandCentre } from "@/components/PerpsCommandCentre"
import { PatternPanel } from "@/components/PatternPanel"
import { AdvancedIndicatorsPanel } from "@/components/AdvancedIndicatorsPanel"
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
    </div>
  )
}
