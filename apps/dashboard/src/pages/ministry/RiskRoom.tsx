import { useEffect, useState } from "react"
import { RiskRoom as TerminalRiskRoom } from "@/terminal/routes/RiskRoom"
import { fetchCopilotDecision, type CopilotAndRisk } from "@/terminal/adapters/copilotReading"

// WS-7 T7R-B — the page composition for the Risk room.
//
// WHY THIS FILE EXISTS AT ALL, AND WHY IT IS A SEPARATE MODULE.
//
// `MinistryRoom.tsx` lazy-maps the `risk` key straight at
// `@/terminal/routes/RiskRoom`, and `MinistryRoom` renders rooms with NO props
// (`<Room />`). That combination is why the room mounted but rendered three
// unavailable rows forever: the terminal room is presentational by design, so a
// caller has to exist to hand it observations, and there was none.
//
// This module is that caller, and it is deliberately the same shape as
// `MarketsRoom.tsx` — fetch the ONE decision, project it, pass props. Two
// differences are worth naming:
//
//   - IT REUSES THE SAME REQUEST. `POST /api/trading/copilot` returns the risk
//     observations alongside the confluence, because both come out of the same
//     candle series the engine already derived. A second endpoint for ATR alone
//     would re-fetch the same bars and give the two rooms two different views of
//     one market.
//
//   - IT DOES NOT COMPUTE. `projectRisk` (inside `fetchCopilotDecision`) copies
//     what the server produced. It never assembles a `strikes: 0`, never
//     evaluates the 2% daily rail from a session figure, and never substitutes a
//     neighbouring number — the three fabrications `domain/riskLayer.ts` refuses,
//     and this caller inherits that refusal by having nothing to fabricate with.
//
// Consequently the mounted room shows ONE live row (ATR, from `atrStop`) and TWO
// named absences (the daily drawdown figure and the per-key strike counter, which
// no read-only asset decision has). That is the correct picture, and it is the
// reason `RISK_COMPLETION.verdict` is `complete` while two of its three rows are
// still unavailable: the room's obligation was to surface all three WITH HONEST
// UNAVAILABILITY, and it does.
//
// WHY `assetId` IS A PROP RATHER THAN A SELECT. The room shows one asset's risk
// and the caller names it. Adding an asset picker here would be a scope change:
// T9's Paper/Live room owns asset selection for the decision path, and two places
// choosing assets is how two rooms end up disagreeing about which market they
// are describing.
export function RiskRoom({ assetId = "EURUSD" }: { assetId?: string }) {
  const [decision, setDecision] = useState<CopilotAndRisk | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    void fetchCopilotDecision(assetId, { signal: controller.signal }).then((next) => {
      if (alive) setDecision(next)
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [assetId])

  // Before the response lands, and if it never does, the three rows render as
  // their named absences. A pending request is not an ATR of zero.
  const risk = decision?.risk
  return <TerminalRiskRoom atr={risk?.atr ?? null} drawdown={risk?.drawdown ?? null} threeStrike={risk?.threeStrike ?? null} />
}
