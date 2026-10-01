import { useEffect, useRef, useState } from "react"
import { StatusCards, TradePlannerCard, NewsCard, SignalNotificationsCard } from "@/components/TradingSuite"
import { LiveDecisionsPanel } from "@/components/LiveDecisionsPanel"
import { SoakBay } from "@/components/SoakBay"
import { DispatchStrip } from "@/components/DispatchStrip"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { getTradingStatus } from "@/lib/trading"
import type { PaperOverview } from "@/lib/trading"
import { ReadOnlyRoom } from "@/terminal/routes/ReadOnlyRoom"
import { useReadOnlyView } from "./useReadOnlyView"

export function DashboardRoom() {
  const [status, setStatus] = useState<{ paper: PaperOverview; riskPerTradePct: number } | null>(null)
  const lastLoadAt = useRef(0)
  const { snapshot } = useRealtimeSuite()
  // WS-7 T10 (d1Order 7) — the read-only record for this instance.
  const { view: readOnlyView } = useReadOnlyView("dashboard", "trading")

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
      {/* WS-7 T10 — the read-only record, rendered first so a reader sees what
          was OBSERVED before the panels below. It reports the risk figure as an
          absence when the producer does not answer, which is the difference this
          task exists to make: the panel band below still defaults it to 2, and
          that default is recorded as a finding in this instance's completion
          record rather than silently inherited or silently changed. */}
      <ReadOnlyRoom view={readOnlyView} />

      <header data-room="dashboard">
        <h2>Command Deck</h2>
        <p className="muted small">The copilot loop, end to end: watch → decide → dispatch → act. Every band below is honest to its data — stale is never passed off as live.</p>
      </header>

      <section className="stack" data-band="watch" aria-label="Watch">
        <h4 className="small muted">1 · Watch</h4>
        <StatusCards
          paper={status?.paper ?? null}
          riskPct={status?.riskPerTradePct ?? 2}
          demo={snapshot?.demo ?? null}
          liveAccount={snapshot?.live?.account ?? null}
        />
      </section>

      <section className="stack" data-band="decide" aria-label="Decide">
        <h4 className="small muted">2 · Decide</h4>
        <SoakBay />
        <LiveDecisionsPanel />
        <NewsCard />
      </section>

      <section className="stack" data-band="dispatch" aria-label="Dispatch">
        <h4 className="small muted">3 · Dispatch</h4>
        <DispatchStrip />
      </section>

      <section className="stack" data-band="act" aria-label="Act">
        <h4 className="small muted">4 · Act</h4>
        <TradePlannerCard />
        <SignalNotificationsCard />
      </section>
    </div>
  )
}