import { useEffect, useRef, useState } from "react"
import { StatusCards, TradePlannerCard, NewsCard, SignalNotificationsCard } from "@/components/TradingSuite"
import { LiveDecisionsPanel } from "@/components/LiveDecisionsPanel"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { getTradingStatus } from "@/lib/trading"
import type { PaperOverview } from "@/lib/trading"

export function DashboardRoom() {
  const [status, setStatus] = useState<{ paper: PaperOverview; riskPerTradePct: number } | null>(null)
  const lastLoadAt = useRef(0)
  const { snapshot } = useRealtimeSuite()

  useEffect(() => {
    let alive = true
    getTradingStatus().then((s) => {
      if (alive) setStatus(s)
      lastLoadAt.current = Date.now()
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!snapshot || snapshot.ts < lastLoadAt.current) return
    if (snapshot.trading) setStatus(snapshot.trading)
  }, [snapshot])

  return (
    <div className="stack">
      <header data-room="dashboard">
        <h2>Dashboard</h2>
        <p className="muted small">Command overview — live decisions, position risk, planning and the latest intelligence.</p>
      </header>
      <StatusCards
        paper={status?.paper ?? null}
        riskPct={status?.riskPerTradePct ?? 2}
        demo={snapshot?.demo ?? null}
        liveAccount={snapshot?.live?.account ?? null}
      />
      <LiveDecisionsPanel />
      <TradePlannerCard />
      <NewsCard />
      <SignalNotificationsCard />
    </div>
  )
}
