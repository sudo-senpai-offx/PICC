// Public-history ingest — Hyperliquid on-chain history only (§3.1–§3.2).
// Keyless. No credentials read, no private broker data accepted.
import { appendExternalSample, pruneToRegimeTargets } from "./copyCorpusStore.mjs"

let lastIngestAt = null
let lastResult = null
let lastCadenceReason = null

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
  if (lastCadenceReason) return { lastIngestAt, lastResult, reason: lastCadenceReason }
  if (!lastIngestAt) return { lastIngestAt: null, lastResult: null, reason: "never-ingested" }
  return { lastIngestAt, lastResult, reason: null }
}
export function _resetIngestForTest() { lastIngestAt = null; lastResult = null; lastCadenceReason = null }

// ── Wave 1.2 — cadence ingest sustaining regime coverage (§7/§8 decision-2) ─
// Hyperliquid `POST https://api.hyperliquid.xyz/info` surface (researched
// 2026-10-08, keyless, no auth): market-level reads need no address (`meta`,
// `metaAndAssetCtxs`, `allMids`, `l2Book`, `recentTrades`, `candleSnapshot`,
// `fundingHistory`); account-attributed reads (`userFills`, `userFillsByTime`,
// `clearinghouseState`, `openOrders`) REQUIRE a known 0x address. No endpoint
// enumerates accounts, and PnL/leaderboard selection is prohibited (§2/§4.2) —
// so state-neutral discovery has no observable mechanism. The honest
// implementation ingests what IS observable and reports the named absence
// `discovery-unavailable` for the rest. Never fabricate accounts/fills/regimes.
export const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info"
// Thousands of samples per regime, never unbounded growth (§7).
export const CORPUS_REGIME_TARGETS = { "*": 3000 }
const MAX_SNAPSHOT_COINS = 5
const MAX_TRADES_PER_COIN = 50
const MAX_USER_FILLS = 500

// Pure mapper: Hyperliquid `userFills` records → ingestPublicFills fills.
// No network, no selection: closedPnl magnitude is carried as data, never
// turned into a selectBy/rank criterion.
export function mapHyperliquidUserFills(rawFills, { account, windowStart = null, windowEnd = null } = {}) {
  if (!Array.isArray(rawFills) || !account) return []
  const out = []
  for (const raw of rawFills) {
    if (!raw || typeof raw !== "object") continue
    const acct = raw.account ?? account
    if (!acct) continue
    out.push({
      account: String(acct),
      liquidated: /liquidat/i.test(String(raw.dir ?? "")),
      dormant: raw.dormant === true,
      stateBefore: raw.stateBefore ?? (raw.coin ? { coin: String(raw.coin), side: raw.side ?? null } : null),
      sizeResponse: raw.sizeResponse ?? (raw.sz != null ? { sz: String(raw.sz), px: raw.px != null ? String(raw.px) : null } : null),
      regime: raw.regime ?? null,
      windowStart: raw.windowStart ?? windowStart,
      windowEnd: raw.windowEnd ?? windowEnd,
    })
  }
  return out
}

// State-neutral account discovery. There is no keyless endpoint that lists
// accounts; `userFills` needs an address and leaderboard/PnL ranking is
// banned (§2/§4.2). Named absence, never a fabricated list.
export function discoverCorpusAccounts() {
  return {
    ok: false,
    accounts: [],
    reason: "discovery-unavailable",
    detail: "no keyless state-neutral account enumeration on the public /info surface (userFills requires an address; PnL/leaderboard selection prohibited §2/§4.2)",
  }
}

async function postInfo(fetchFn, body) {
  const res = await fetchFn(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res || res.ok === false) {
    throw new Error(`info-http-${res?.status ?? "no-response"}`)
  }
  return res.json()
}

// Keyless market snapshot: `recentTrades` per coin is fully public and needs
// no address. Trades carry no account ref, so they are NEVER mapped to fills —
// they prove venue reachability without fabricating attribution. Sequential
// per-coin fetches (bounded) respect venue rate limits.
export async function fetchPublicMarketSnapshot({ fetchFn = globalThis.fetch, coins = ["BTC", "ETH"], perCoinLimit = MAX_TRADES_PER_COIN } = {}) {
  const list = Array.isArray(coins) ? coins.filter(Boolean).slice(0, MAX_SNAPSHOT_COINS) : []
  if (list.length === 0) return { ok: false, trades: [], reason: "no-coins-requested" }
  const trades = []
  let succeeded = 0
  let lastError = null
  for (const coin of list) {
    try {
      const raw = await postInfo(fetchFn, { type: "recentTrades", coin: String(coin) })
      if (Array.isArray(raw)) {
        succeeded++
        for (const t of raw.slice(0, Math.max(0, perCoinLimit))) {
          if (t && typeof t === "object") trades.push({ coin: String(coin), ...t })
        }
      }
    } catch (err) {
      lastError = err?.message ?? String(err)
    }
  }
  if (succeeded === 0) {
    return { ok: false, trades: [], reason: `market-snapshot-unavailable: ${lastError ?? "no-coin-succeeded"}` }
  }
  if (trades.length === 0) {
    return { ok: true, trades, coinsObserved: succeeded, reason: "no-public-trades-in-window" }
  }
  return { ok: true, trades, coinsObserved: succeeded, reason: null }
}

// Account-attributed fills for one EXPLICIT address (caller-supplied, never
// discovered via ranking). Bounded; keyless; errors are named, never thrown.
export async function fetchHyperliquidUserFills({ user, fetchFn = globalThis.fetch, limit = MAX_USER_FILLS } = {}) {
  if (!user || typeof user !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
    return { ok: false, fills: [], reason: "user-address-required" }
  }
  try {
    const raw = await postInfo(fetchFn, { type: "userFills", user })
    if (!Array.isArray(raw)) return { ok: false, fills: [], reason: "user-fills-unexpected-shape" }
    return { ok: true, fills: raw.slice(0, Math.max(0, limit)), reason: null }
  } catch (err) {
    return { ok: false, fills: [], reason: `user-fills-fetch-failed: ${err?.message ?? String(err)}` }
  }
}

// Cadence orchestrator: snapshot → discovery → (no fabrication) → prune.
// Every step is named-absence-tolerant; this function never throws.
export async function runCorpusRefreshCadence({ fetchFn = globalThis.fetch, targets = CORPUS_REGIME_TARGETS, windowStart = null, windowEnd = null } = {}) {
  void windowStart
  void windowEnd
  let snapshot
  try {
    snapshot = await fetchPublicMarketSnapshot({ fetchFn })
  } catch (err) {
    snapshot = { ok: false, trades: [], reason: `market-snapshot-unavailable: ${err?.message ?? String(err)}` }
  }
  const discovery = discoverCorpusAccounts()
  // No state-neutral accounts are observable → nothing to ingest. This is the
  // honest path: report the named absence, ingest zero, still prune so the
  // corpus converges on regime targets instead of growing without bound.
  let pruned
  try {
    pruned = pruneToRegimeTargets(targets)
  } catch (err) {
    pruned = { ok: false, kept: 0, dropped: 0, reason: `prune-failed: ${err?.message ?? String(err)}` }
  }
  const reason = snapshot.ok ? discovery.reason : snapshot.reason
  lastCadenceReason = reason
  return {
    ok: false,
    ingested: 0,
    skipped: 0,
    pruned,
    marketSnapshot: snapshot.ok
      ? { ok: snapshot.ok, coinsObserved: snapshot.coinsObserved ?? null, nTrades: snapshot.trades.length }
      : { ok: false, reason: snapshot.reason },
    reason,
  }
}

// Scheduler seam (keeps scheduler.mjs thin): OFF gate stays log-only and
// never touches the network; ON runs the cadence.
export async function corpusRefreshPass({ fetchFn = globalThis.fetch } = {}) {
  if (process.env.PICC_COPYCORPUS_REFRESH !== "on") {
    return { gated: true, status: ingestStatus() }
  }
  const outcome = await runCorpusRefreshCadence({ fetchFn })
  return { gated: false, ...outcome }
}
