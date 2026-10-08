// PICC scheduler job: ccxt-equity-refresh (extracted Wave 2.1 — body moved
// verbatim from services/scheduler.mjs; intervals, gates and wording
// unchanged).
//
// Slice 6 — keep the overview's trading:ccxt feed fresh. The 5E gate needs a
// FRESH equity observation to authorize; without this job the wallet was only
// observed at propose/execute time, so minutes after the last rail action the
// overview's ccxt-equity row aged past the 5 min cap and reported a forced
// HOLD — not because the wallet was unobservable, but because nobody had
// asked. Polling every 4 min (stagger 65s, < the 5 min staleness cap)
// restores the honest state: HOLD only when a venue is genuinely unreachable.
// Read-only (fetchBalance + tickers); a failing exchange is logged per the
// honest per-exchange report and left for the next pass.
import { refreshAllCcxtEquity } from "../ccxtOrdering.mjs"
import { createLogger } from "../../logger.mjs"

const log = createLogger("picc-scheduler")

export const name = "ccxt-equity-refresh"
export const intervalMs = 4 * 60 * 1000
export const staggerMs = 65_000

export async function run() {
  const report = await refreshAllCcxtEquity()
  if (report.keyedExchanges.length === 0) return
  log.info("ccxt equity refresh pass", {
    exchanges: report.keyedExchanges,
    ok: report.okCount,
    total: report.observed.length,
    skipped: report.skipped.length
  })
}
