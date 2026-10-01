import { useEffect, useState } from "react"
import { PaperTradingCard } from "@/components/TradingSuite"
import { LedgerPanel } from "@/components/LedgerPanel"
import { TradeJournalPanel } from "@/components/TradeJournalPanel"
import { RiskMetricsCard } from "@/components/RiskMetricsCard"
import { getPaperPositions, getPaperHistory } from "@/lib/trading"
import type { PaperPosition, ClosedTrade } from "@/lib/trading"
import { PaperLiveRoom } from "@/terminal/routes/PaperLiveRoom"
import type { PaperLiveReadouts } from "@/terminal/routes/PaperLiveRoom"
import {
  fetchPaperLivePermit,
  fetchBrokerRegistry,
  fetchCommandCentreOverview,
  fetchCeremonyReadout
} from "@/terminal/adapters/governanceReading"

/**
 * The `paper` room key, D1's room instance 6: Paper/Live.
 *
 * WS-7 T9 ADDED THE EXECUTION BOUNDARY AND LEFT EVERY PRE-EXISTING CONTROL
 * ALONE. Nothing below the `data-paper-region="ledger"` boundary was added,
 * removed, renamed or re-wired by this task, and that is stated rather than left
 * implicit, because it is the fact an affordance audit has to be honest about:
 * this room DOES have interactive controls, and every one of them is a paper-engine
 * control that predates T9.
 *
 * WHY THE LEDGER STAYS. Deleting it would be scope trimming in the direction AC-020
 * prohibits: D19's outcome (B) names paper trading as "the everyday path", and
 * `brokers.mjs:79-89` registers it as the simulation executor. Replacing the room
 * with a boundary readout would remove working, retained functionality to make the
 * affordance audit simpler, which is a tidiness motive wearing a safety costume.
 *
 * WHY THE TWO REGIONS ARE SEPARATED IN THE MARKUP. `PaperLiveRoom.test.tsx`
 * enumerates every interactive element in this room's rendered output and asserts
 * that each one lies inside `data-paper-region="ledger"` and NONE lies inside
 * `data-paper-region="boundary"`. The boundary region contributes zero by
 * construction, so the enumeration has a fixed expectation for the half of the room
 * T9 owns and an audited list for the half it did not.
 *
 * FOUR INDEPENDENT FETCHES, NOT ONE. Each returns `null` on failure, and the
 * projection turns any missing one into `unknown` — never into a derived denial.
 * `Promise.allSettled` so one refused request cannot cancel the other three and
 * turn a partial answer into no answer at all.
 */
export function PaperRoom() {
  const [positions, setPositions] = useState<PaperPosition[]>([])
  const [closed, setClosed] = useState<ClosedTrade[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  // The boundary readouts. `null` means "not obtained" and is NEVER a locally
  // built placeholder — a placeholder here would be a fabricated reading, and the
  // room's whole fail-closed property rests on absence staying absent.
  const [readouts, setReadouts] = useState<PaperLiveReadouts>({
    permit: null,
    brokers: null,
    overview: null,
    ceremony: null
  })

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    void Promise.allSettled([
      fetchPaperLivePermit({ signal: controller.signal }),
      fetchBrokerRegistry({ signal: controller.signal }),
      fetchCommandCentreOverview({ signal: controller.signal }),
      fetchCeremonyReadout({ signal: controller.signal })
    ]).then((results) => {
      if (!alive) return
      setReadouts({
        permit: fulfilled(results[0]),
        brokers: fulfilled(results[1]),
        overview: fulfilled(results[2]),
        ceremony: fulfilled(results[3])
      })
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [])

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
        <h2>Paper / Live</h2>
        <p className="muted small">
          The execution boundary — D6&rsquo;s ladder, the current rung, D5&rsquo;s automationPermitted state and the
          ceremony/consent rails — above the paper-trading ledger, which is unchanged.
        </p>
      </header>

      {/* T9's region: the boundary readout. Zero interactive elements. */}
      <div data-paper-region="boundary">
        <PaperLiveRoom readouts={readouts} />
      </div>

      {/* Pre-existing. Every interactive control in this room is inside here. */}
      <div data-paper-region="ledger">
        <PaperTradingCard positions={positions} closed={closed} refresh={refresh} />
        <LedgerPanel />
        <TradeJournalPanel />
        <RiskMetricsCard />
      </div>
    </div>
  )
}

/**
 * A settled read's value, or `null` for a rejection.
 *
 * Typed narrowly on purpose: `Promise.allSettled` results are a union, and
 * widening them to `any` here would put an `any` four steps from the room's
 * permission column.
 */
function fulfilled<T>(result: PromiseSettledResult<{ readout: T | null; error: string | null }>): T | null {
  return result.status === "fulfilled" ? result.value.readout : null
}