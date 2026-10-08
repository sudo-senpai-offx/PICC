// PICC scheduler job: wealth-refresh (W3-01 Task 9 — tiered leg refresh +
// daily snapshot in one job).
//
// Spec decisions 9/16/20 (binding):
// - Snapshots DAILY, date-keyed idempotent (same tz date overwrites, never
//   duplicates), 2-year rolling prune (older than 730 days dropped by policy).
// - Transfer deduction is snapshot-window adjustment: legs whose destination
//   matches a transfer dated inside the snapshot window (the current tz day,
//   midnight → now) are excluded once as in-flight duplicates; the log itself
//   is untouched and stays visible as evidence.
// - The snapshot date key uses the operator-configurable timezone
//   (PICC_SNAPSHOT_TZ, default Asia/Singapore — the same tz the store uses).
// - Manual legs are refreshed as ENTERED, never fetched: the job re-reads only
//   the keyed legs (ccxt-spot, hyperliquid, BTCPay) and persists them; stored
//   manual legs pass through the ENTERED-coercing reader untouched.
//
// PAPER IS STRICTLY READ-ONLY HERE, the same adapter as the overview route:
// paperOverview() is two readJSON calls plus pure math. paperAnalytics() is
// DELIBERATELY never called — its default path auto-closes TP/SL hits, and
// that write belongs to the paper-mark job. A reviewer grepping this file for
// close/mark calls must find none.
import { createLogger } from "../../logger.mjs"
import { readCcxtSpotLeg, readHyperliquidLeg, readBtcpayLeg, yahooQuote, ccxtQuote } from "../wealth/legsKeyed.mjs"
import { readManualLegs, readBillingLegs, readLocalstoreLegs, readPaperSummary } from "../wealth/legsLocal.mjs"
import { overview, snapshotAdjust } from "../wealth/aggregate.mjs"
import { listTransfers, upsertLeg, addSnapshot, pruneSnapshots } from "../wealth/store.mjs"
import { paperOverview } from "../trading.mjs"

const log = createLogger("picc-scheduler")

export const name = "wealth-refresh"
export const intervalMs = 24 * 60 * 60 * 1000
export const staggerMs = 180_000

function tzOffsetMs(tz, ms) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
  const parts = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  )
  return asUTC - ms
}

// Midnight of the tz date containing nowMs, as a UTC instant: the opening
// edge of the snapshot window (decision 16).
export function tzDayStartMs(nowMs, tz) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(nowMs))
  const [y, m, d] = day.split("-").map(Number)
  const guess = Date.UTC(y, m - 1, d)
  return guess - tzOffsetMs(tz, guess)
}

export async function run({ now = Date.now() } = {}) {
  const at = new Date(now).toISOString()
  const tz = process.env.PICC_SNAPSHOT_TZ || "Asia/Singapore"
  // Tiered refresh: keyed legs re-read live and persisted; manual legs are
  // never fetched (they read ENTERED via the reader whatever the store says).
  const keyed = [await readCcxtSpotLeg(), await readHyperliquidLeg(), await readBtcpayLeg()]
  for (const leg of keyed) {
    // The BTCPay reader reports unconfirmedBalance on the side; the store
    // shape carries settled legs only, so it is stripped before persisting.
    const { unconfirmed: _unconfirmed, ...storable } = leg
    void _unconfirmed
    upsertLeg(storable)
  }
  const [manual, billing, localstore] = await Promise.all([
    readManualLegs(),
    readBillingLegs(),
    readLocalstoreLegs()
  ])
  const legs = [...keyed, ...manual, ...billing, ...localstore]
  const paper = await readPaperSummary({ paperAnalytics: async () => ({ overview: await paperOverview() }) })
  const transfers = listTransfers()
  const windowStart = new Date(tzDayStartMs(now, tz)).toISOString()
  const { legs: adjusted, excluded } = snapshotAdjust({ legs, transfers, windowStart, windowEnd: at })
  const result = await overview({ legs: adjusted, transfers, paper, readers: { yahooQuote, ccxtQuote } })
  const snapshot = addSnapshot({
    at,
    totalUsd: result.totalUsd,
    incomplete: result.incomplete,
    legStatus: adjusted.map((l) => ({ id: l.id, status: l.status }))
  })
  const pruned = pruneSnapshots({ now })
  log.info("wealth refresh pass", {
    totalUsd: result.totalUsd,
    incomplete: result.incomplete,
    legs: adjusted.length,
    excluded: excluded.length,
    tzDate: snapshot.tzDate,
    pruned: pruned.pruned
  })
  return { snapshot, pruned, excluded: excluded.length }
}
