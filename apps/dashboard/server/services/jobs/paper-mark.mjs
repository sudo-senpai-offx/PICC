// PICC scheduler job: paper-mark (extracted Wave 2.1 — body moved verbatim
// from services/scheduler.mjs; intervals, gates and wording unchanged).
//
// Every 15 min (stagger 60s): marks paper positions to market and auto-closes
// take-profit/stop-loss hits. Keeps the paper ledger honest even when nobody
// is looking at the page.
import { appendRow } from "../localstore.mjs"
import { paperAnalytics } from "../trading.mjs"

export const name = "paper-mark"
export const intervalMs = 15 * 60 * 1000
export const staggerMs = 60_000

export async function run() {
  const report = await paperAnalytics()
  if (report.autoClosed.length > 0) {
    await appendRow("agent_logs", {
      kind: "paper_auto_close",
      source: "scheduler",
      level: "info",
      count: report.autoClosed.length,
      note: `Auto-closed ${report.autoClosed.length} paper position(s) at take-profit/stop-loss. Equity now ${report.overview.equity}.`
    })
  }
}
