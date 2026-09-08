import { useState, useEffect } from "react"
import { SignalsCard } from "@/components/TradingSuite"
import { CommandCentrePanel } from "@/components/CommandCentrePanel"
import { PatternPanel } from "@/components/PatternPanel"
import { AdvancedIndicatorsPanel } from "@/components/AdvancedIndicatorsPanel"
import { getTradingSignals } from "@/lib/trading"
import type { TradingSignal } from "@/lib/trading"

export function CommandCentreRoom() {
  const [signals, setSignals] = useState<TradingSignal[]>([])
  const [reloadKey, setReloadKey] = useState(0)

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
      <header data-room="command-centre">
        <h2>Command Centre</h2>
        <p className="muted small">Execution command — signals, chart patterns and advanced indicators.</p>
      </header>
      <CommandCentrePanel />
      <PatternPanel />
      <AdvancedIndicatorsPanel assetId="EURUSD" timeframe="daily" />
      <SignalsCard signals={signals} refresh={refresh} />
    </div>
  )
}
