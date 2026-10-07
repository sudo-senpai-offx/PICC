// Public-history ingest — Hyperliquid on-chain history only (§3.1–§3.2).
// Keyless. No credentials read, no private broker data accepted.
import { appendExternalSample } from "./copyCorpusStore.mjs"

let lastIngestAt = null
let lastResult = null

const PRIVATE_VENUES = new Set(["private-broker-export", "social-copy-export"])
// Mirrors the store's identity-selector refusal (§2/§4.2): the adapter accepts
// no selection criteria by design, so a fill carrying a banned selector is
// skipped (and counted), never ingested.
const BANNED_SELECTORS = new Set(["top-pnl", "leaderboard", "best-trader", "rank"])
export function ingestPublicFills({ venue = "hyperliquid", fills = [], windowStart = null, windowEnd = null } = {}) {
  if (PRIVATE_VENUES.has(String(venue))) {
    return { ok: false, ingested: 0, skipped: Array.isArray(fills) ? fills.length : 0, reason: "private venue histories are prohibited (§3.2)" }
  }
  if (!Array.isArray(fills) || fills.length === 0) {
    return { ok: false, ingested: 0, skipped: 0, reason: "no public fills in window" }
  }
  let ingested = 0, skipped = 0
  for (const f of fills) {
    if (!f?.account) { skipped++; continue }
    if (f?.selectBy && BANNED_SELECTORS.has(String(f.selectBy))) { skipped++; continue }
    const r = appendExternalSample({
      venue, accountRef: String(f.account),
      regime: null,
      stateBefore: f.stateBefore ?? null,
      sizeResponse: f.sizeResponse ?? null,
      outcomeKind: f.liquidated ? "liquidated" : (f.dormant ? "dormant" : "active"),
      windowStart, windowEnd,
    })
    if (r.ok) ingested++; else skipped++
  }
  if (ingested === 0) {
    return { ok: false, ingested: 0, skipped, reason: "all-fills-skipped: no usable account refs" }
  }
  lastIngestAt = new Date().toISOString()
  lastResult = { ingested, skipped }
  return { ok: true, ingested, skipped, reason: null }
}

export function ingestStatus() {
  if (!lastIngestAt) return { lastIngestAt: null, lastResult: null, reason: "never-ingested" }
  return { lastIngestAt, lastResult, reason: null }
}
export function _resetIngestForTest() { lastIngestAt = null; lastResult = null }
