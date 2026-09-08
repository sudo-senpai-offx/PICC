import { useEffect, useState } from "react"
import { PaperTradingCard } from "@/components/TradingSuite"
import { LedgerPanel } from "@/components/LedgerPanel"
import { TradeJournalPanel } from "@/components/TradeJournalPanel"
import { getPaperPositions, getPaperHistory } from "@/lib/trading"
import type { PaperPosition, ClosedTrade } from "@/lib/trading"

export function PaperRoom() {
  const [positions, setPositions] = useState<PaperPosition[]>([])
  const [closed, setClosed] = useState<ClosedTrade[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.allSettled([getPaperPositions(), getPaperHistory()]).then(([p, h]) => {
      if (!alive) return
      if (p.status === "fulfilled" && Array.isArray(p.value?.positions)) setPositions(p.value.positions)
      if (h.status === "fulfilled" && Array.isArray(h.value?.closed)) setClosed(h.value.closed)
    })
    return () => { alive = false }
  }, [reloadKey])

  const refresh = () => setReloadKey((k) => k + 1)

  return (
    <div className="stack">
      <header data-room="paper">
        <h2>Paper</h2>
        <p className="muted small">Paper trading ledger — simulated positions, analytics and the full trade journal.</p>
      </header>
      <PaperTradingCard positions={positions} closed={closed} refresh={refresh} />
      <LedgerPanel />
      <TradeJournalPanel />
    </div>
  )
}
