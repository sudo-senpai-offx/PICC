// PICC Unified Market Data Bus — the fan-in for every candle source.
//
// One call, best available candles: quality-ordered fan-in with per-source
// latency tracking and honest staleness tags. Brokers register via the
// broker registry — this module never imports broker modules directly.
//
// Fan-in quality order (T2 — PICC_MULTISOURCE_ENGINE):
//   1. Liveness — alive brokers rank above dead ones (dead ones stay
//      try-able for buffered data, but sink below every live source)
//   2. Exact resolution — a broker serving the REQUESTED timeframe beats
//      one that would serve a relabel (never a silent resolution change)
//   3. Freshness — newer stats().lastSeen wins
//   4. Broker weight (user-configurable, higher = preferred)
//   5. Latency — median fetch time breaks the final tie (faster wins)
//
// Staleness (T6 — Mechanism D): every response tags `stale` honestly as
// `!isAlive() || Boolean(stats().stale)` on every return path — a dead
// broker's buffered data (or a live broker with its stale flag set, e.g.
// "connected but no ticks >60s") is tagged stale, never "live".
//
// Every result is tagged with its source so the UI can label honesty
// (live vs delayed) and the model matrix can weight accordingly. Responses
// also name the option set and mode: sourceMode ("auto"|"forced"|"fallback")
// and per-candidate sources[] with rank + reasons, so the chart can explain
// who won and why.

import { canonicalAssetId } from "./assetCatalog.mjs"
import { resolveTimeframeFor } from "./brokers/index.mjs"

// ── Broker registry (loaded once, lazy) ────────────────────────────────────
let _registry = null
async function registry() {
  if (!_registry) _registry = await import("./brokers/index.mjs")
  return _registry
}

/**
 * Load all broker adapters. Call once at server startup to trigger
 * registration of EO, CCXT, Yahoo, Paper adapters.
 */
export async function loadBrokers() {
  await import("./brokers/loader.mjs")
}

// ── Latency tracking ───────────────────────────────────────────────────────
const LATENCY_RING_CAP = 32
const latencyRing = new Map() // source → [ms]

function recordLatency(source, ms) {
  if (!Number.isFinite(ms)) return
  const ring = latencyRing.get(source) ?? []
  ring.push(Math.round(ms))
  if (ring.length > LATENCY_RING_CAP) ring.shift()
  latencyRing.set(source, ring)
}

/** Median latency per source over the recent window (ms). */
export function dataBusStats() {
  const out = {}
  for (const [source, ring] of latencyRing) {
    const sorted = [...ring].sort((a, b) => a - b)
    out[source] = {
      samples: sorted.length,
      medianMs: sorted[Math.floor(sorted.length / 2)] ?? null,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      lastMs: sorted[sorted.length - 1] ?? null
    }
  }
  return out
}

async function timed(source, fn) {
  const t0 = Date.now()
  try {
    const value = await fn()
    recordLatency(source, Date.now() - t0)
    return value
  } catch (err) {
    recordLatency(source, Date.now() - t0)
    throw err
  }
}

// ── Fallback: direct EO import for ensureWatchingAsset (Phase H bridge) ────
// During the transition, getBestCandles still supports ensureWatch for the
// EO-specific watch-and-fetch pattern. This will be replaced by a generic
// broker.ensureWatch(assetId) in Phase I. The bridge honors EO's own
// capability curve: a 5s request fetches real 1m bars tagged 60, and an
// above-1h request is skipped entirely (declined — never relabeled).
const EO_BRIDGE_TIMEFRAMES = [60, 300, 900, 3600]
async function eoWatchAndFetch(assetId, tf, n) {
  const servedTf = resolveTimeframeFor(tf, EO_BRIDGE_TIMEFRAMES)
  if (servedTf === null) return { ohlc: [], servedTf: null, alive: false, staleFlag: false }
  try {
    const { ensureWatchingAsset, fetchAssetCandles, liveEOStats } = await import("./liveEO.mjs")
    await ensureWatchingAsset(assetId).catch(() => null)
    const result = await timed("eo-fetch", () =>
      fetchAssetCandles(assetId, servedTf, n).catch(() => ({ ohlc: [], source: null })))
    // T6 — the bridge tags staleness from liveEO's own liveness + stale flag
    // (stopLiveEO/transport give-up preserve buffers — data stays visible but
    // is never labeled "EO live").
    let st = null
    try { st = liveEOStats() } catch { st = null }
    return { ohlc: result.ohlc ?? [], servedTf, alive: st?.status === "connected", staleFlag: Boolean(st?.stale) }
  } catch { return { ohlc: [], servedTf: null, alive: false, staleFlag: false } }
}

/**
 * T3 — deep history merge. After the primary source wins (≥30 bars at its
 * served resolution), look for ANOTHER broker serving the SAME resolution with
 * OLDER bars and prepend them (dedup by timestamp; on a tie the primary's bar
 * wins — it is the live-fresher source). Response keys stay additive:
 *   historyDepth  — total bars returned
 *   backfilled    — how many of those came from the history source
 *   historySpanMs — wall-clock span of the returned series (ms)
 *   historySource — slug of the broker that supplied the older bars (null when
 *                   no merge happened)
 * and each appended bar carries backfilled:true (primary bars don't).
 * The merge NEVER crosses served resolutions: a history broker whose resolved
 * timeframe differs is skipped — no fake resolution is ever mixed in. And it
 * only runs when the primary could not fill the requested `n`: a request the
 * primary already satisfies is returned as-is (no extra fetch; Yahoo's rate
 * budget is respected).
 */
async function withHistoryBackfill({ brokers, id, primary, servedTf, n, primarySlug }) {
  const base = {
    candles: primary,
    historyDepth: primary.length,
    backfilled: 0,
    historySpanMs: spanMs(primary),
    historySource: null
  }
  if (primary.length >= n) return base
  const firstPrimaryTime = primary[0]?.time
  if (firstPrimaryTime == null) return base
  const primaryTimes = new Set(primary.map((c) => c.time))
  let older = []
  let historySource = null
  for (const broker of brokers) {
    if (broker.slug === primarySlug) continue
    let served = null
    try { served = broker.resolveTimeframe(servedTf) } catch { continue }
    if (served !== servedTf) continue
    try {
      const candles = await timed(broker.slug, async () => broker.getCandles(id, { timeframe: servedTf, count: n }))
      if (!Array.isArray(candles) || !candles.length) continue
      for (const c of candles) {
        if (c == null || c.time == null) continue
        if (c.time >= firstPrimaryTime) continue       // only OLDER bars append
        if (primaryTimes.has(c.time)) continue          // same bucket → keep primary's
        older.push({ ...c, backfilled: true })
      }
      if (older.length && !historySource) historySource = broker.slug
    } catch { /* history source unavailable — primary alone stands */ }
  }
  if (!older.length) return base
  older.sort((a, b) => a.time - b.time)
  const merged = older.concat(primary).slice(-n)
  const backfilled = merged.reduce((acc, c) => acc + (c.backfilled === true ? 1 : 0), 0)
  return {
    candles: merged,
    historyDepth: merged.length,
    backfilled,
    historySpanMs: spanMs(merged),
    historySource
  }
}

/** Wall-clock span of a candle series in ms (0 for <2 bars). */
function spanMs(candles) {
  if (!Array.isArray(candles) || candles.length < 2) return 0
  const a = candles[0]?.time
  const b = candles[candles.length - 1]?.time
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) * 1000 : 0
}

// ── Quality ordering (T2) ────────────────────────────────────────────────────
// Phase 1 of the fan-in: resolution-capable candidates only. A broker that
// DECLINES the request (resolveTimeframe null — e.g. a 4h request on a 1h-capped
// source) is dropped entirely; paper is an execution source with no candle data.
// Phase 2 sorts the survivors by liveness > exact resolution > freshness
// (lastSeen) > weight > latency. Dead sinks, relabels sink, stale sinks,
// low-weight sinks, slow sinks.
function buildCandidates(brokers, tf) {
  const out = []
  for (const broker of brokers) {
    if (broker.slug === "paper") continue
    let servedTf
    try { servedTf = broker.resolveTimeframe(tf) } catch { continue }
    if (servedTf === null || servedTf === undefined) continue
    let alive = false
    try { alive = broker.isAlive ? broker.isAlive() === true : false } catch { alive = false }
    let statsOut = null
    try { statsOut = broker.stats?.() ?? null } catch { statsOut = null }
    const lastSeen = Number(statsOut?.lastSeen) || 0
    const sourceStale = Boolean(statsOut?.stale) // advisory flag (e.g. "connected but no ticks")
    const medianMs = dataBusStats()[broker.slug]?.medianMs ?? null
    out.push({ broker, servedTf, exact: servedTf === tf, alive, lastSeen, sourceStale, medianMs, weight: Number(broker.weight) || 0 })
  }
  out.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1
    if (a.exact !== b.exact) return a.exact ? -1 : 1
    if (a.lastSeen !== b.lastSeen) return b.lastSeen - a.lastSeen
    if (a.weight !== b.weight) return b.weight - a.weight
    return (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity)
  })
  return out
}

/** Human reason string for a candidate's rank (the chart's "why" line). */
function reasonFor(cand, tf) {
  const parts = []
  parts.push(cand.alive ? "alive" : "disconnected — buffered data only")
  parts.push(cand.exact ? `${fmtTf(cand.servedTf)} exact` : `serves ${fmtTf(cand.servedTf)} for ${fmtTf(tf)} request`)
  if (cand.lastSeen > 0) parts.push(`fresh ${cand.lastSeen}s ago`)
  if (cand.medianMs != null) parts.push(`${cand.medianMs} ms`)
  return parts.join(" · ")
}

/** Compact timeframe label: 300 → "5m", 86400 → "1d". */
function fmtTf(sec) {
  if (sec >= 86400 && sec % 86400 === 0) return `${sec / 86400}d`
  if (sec >= 3600 && sec % 3600 === 0) return `${sec / 3600}h`
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60}m`
  return `${sec}s`
}

/**
 * Honest staleness (T6 — Mechanism D): a response from this candidate is
 * stale whenever the broker is not alive or its own stale flag is set
 * ("connected but no ticks >60s"). A dead broker's buffered data is served
 * but never labeled live.
 */
function isStale(cand) {
  return !cand?.alive || Boolean(cand?.sourceStale)
}

/**
 * Fetch the best available candles for an asset.
 *
 * Quality-ordered fan-in: resolution-capable brokers (those whose
 * resolveTimeframe does not DECLINE the request) are ranked by liveness >
 * exact resolution > freshness (lastSeen) > weight > latency and fetched in
 * that order. The first ≥30-bar result wins; thinner data is kept as a last
 * resort; then the EO watch-and-fetch bridge (transitional); then honest
 * emptiness (source:"none").
 *
 * `source` (optional) FORCES a broker slug ("expertoption", "ccxt", "yahoo",
 * ...): that source is tried FIRST and wins when it serves ≥30 bars
 * (sourceMode:"forced"); when it serves nothing the engine falls through the
 * quality order — never a blackout — and the response says
 * sourceMode:"fallback". `preferredSource` (T3 preference) is the same
 * mechanism and takes precedence when both are set. "auto"/omitted/unknown
 * slug runs the plain quality fan-in (sourceMode:"auto").
 *
 * Every response carries two additive keys:
 *   sourceMode — "auto" | "forced" | "fallback" (who the winner is and why)
 *   sources[]  — the candidates in the order they were tried, each
 *                { slug, label, rank, alive, exact, servedTf, lastSeen,
 *                  medianMs, reason, winner? }
 *                `winner:true` marks the source that served this response
 *                (absent when nothing served).
 *
 * @returns {candles[], source, sourceMode, sources[], stale, timeframe,
 *           resolved} — never throws for data-absence (returns empty +
 *          source:"none"); network errors from a broker fall through to the
 *          next. `timeframe` is the SERVED resolution (post
 *          broker.resolveTimeframe), `resolved` is true when it differs from
 *          the request — the honest tag the UI must display. T3-additive keys
 *          when a same-resolution history source backfills: `historyDepth`,
 *          `backfilled`, `historySpanMs`, `historySource` (+ per-bar
 *          `backfilled:true` on appended older bars).
 */
export async function getBestCandles(assetId, { timeframe = 60, count = 200, ensureWatch = null, source = "auto", preferredSource = null } = {}) {
  const tf = Math.min(Math.max(Number(timeframe) || 60, 5), 2592000) // up to 1M
  const n = Math.min(Math.max(Number(count) || 200, 20), 2000)
  const id = String(assetId ?? "").trim().toUpperCase() || "EURUSD"

  const { getActiveBrokers, getBroker } = await registry()
  const brokers = getActiveBrokers()
  const candidates = buildCandidates(brokers, tf)

  // ── Forced source (T2): tried first, falls through on emptiness ───────────
  // A forced slug that serves nothing must not black out the chart — the
  // engine falls through the quality order and says so (sourceMode:"fallback").
  // An unknown slug forces nothing: the plain auto fan-in runs (with a warn).
  let forcedSlug = null
  let tried = false
  const pin = preferredSource && typeof preferredSource === "string" && preferredSource !== "auto"
    ? preferredSource
    : typeof source === "string" && source !== "" && source !== "auto"
      ? source
      : null
  if (pin) {
    if (getBroker(pin)) {
      forcedSlug = pin
      tried = true
      const idx = candidates.findIndex((c) => c.broker.slug === pin)
      if (idx >= 0) {
        const [forced] = candidates.splice(idx, 1)
        candidates.unshift(forced)
      }
      // Registered but declined this resolution → no candidate entry; the
      // remaining quality order is tried (never a blackout).
    } else if (/^[a-z0-9-]+$/.test(pin)) {
      console.warn(`[picc] candles: unknown source '${pin}' — falling back to auto (best)`)
    }
  }

  const sources = candidates.map((c, i) => ({
    slug: c.broker.slug,
    label: typeof c.broker.label === "string" && c.broker.label ? c.broker.label : c.broker.slug,
    rank: i + 1,
    alive: c.alive,
    exact: c.exact,
    servedTf: c.servedTf,
    lastSeen: c.lastSeen,
    medianMs: c.medianMs,
    reason: reasonFor(c, tf)
  }))
  const mode = (winnerSlug) => (tried ? (winnerSlug === forcedSlug ? "forced" : "fallback") : "auto")
  const markWinner = (slug) => sources.map((s) => (s.slug === slug ? { ...s, winner: true } : s))

  let thinData = null // best thin result so far (last-resort fallback)

  for (const cand of candidates) {
    try {
      const candles = await timed(cand.broker.slug, async () => cand.broker.getCandles(id, { timeframe: cand.servedTf, count: n }))
      if (!Array.isArray(candles) || !candles.length) continue

      const sliced = candles.slice(-n)
      if (sliced.length >= 30) {
        // T3 — prepend same-resolution older bars from another broker when the
        // primary under-fills the requested window (deep chart history).
        const withHistory = await withHistoryBackfill({ brokers, id, primary: sliced, servedTf: cand.servedTf, n, primarySlug: cand.broker.slug })
        return { ...withHistory, source: cand.broker.slug, sourceMode: mode(cand.broker.slug), sources: markWinner(cand.broker.slug), stale: isStale(cand), timeframe: cand.servedTf, resolved: cand.servedTf !== tf }
      }
      // Thin data — keep as fallback but try next broker for better data
      if (!thinData || sliced.length > thinData.candles.length) {
        thinData = { candles: sliced, source: cand.broker.slug, sourceMode: mode(cand.broker.slug), sources: markWinner(cand.broker.slug), stale: isStale(cand), timeframe: cand.servedTf, resolved: cand.servedTf !== tf, historyDepth: sliced.length, backfilled: 0, historySpanMs: spanMs(sliced), historySource: null }
      }
    } catch { /* broker unavailable — fall through */ }
  }

  // ── EO watch-and-fetch bridge (Phase H transitional) ─────────────────────
  // If ensureWatch is provided and no broker had good data, try EO's
  // on-demand fetch. This preserves existing behavior during the transition.
  if (typeof ensureWatch === "function" && !thinData) {
    try {
      const { ohlc: eoCandles, servedTf, alive: eoAlive, staleFlag: eoStaleFlag } = await eoWatchAndFetch(id, tf, n)
      if (servedTf !== null && eoCandles.length >= 30) {
        const withHistory = await withHistoryBackfill({ brokers, id, primary: eoCandles.slice(-n), servedTf, n, primarySlug: "live" })
        return { ...withHistory, source: "live", sourceMode: mode("live"), sources: markWinner("live"), stale: !eoAlive || eoStaleFlag, timeframe: servedTf, resolved: servedTf !== tf }
      }
      if (servedTf !== null && eoCandles.length) thinData = { candles: eoCandles, source: "live", sourceMode: mode("live"), sources: markWinner("live"), stale: !eoAlive || eoStaleFlag, timeframe: servedTf, resolved: servedTf !== tf, historyDepth: eoCandles.length, backfilled: 0, historySpanMs: spanMs(eoCandles), historySource: null }
    } catch { /* EO fetch failed — last resort stands or honest emptiness */ }
  }

  // Last resort: thin data from any broker, else honest emptiness.
  if (thinData) return thinData
  return { candles: [], source: "none", sourceMode: mode(null), sources: markWinner(null), stale: true, timeframe: tf, resolved: false, historyDepth: 0, backfilled: 0, historySpanMs: 0, historySource: null }
}

/**
 * List the market-data sources that COULD serve a requested resolution for a
 * given asset — the honest option set for the chart's source dropdown.
 *
 * `serves` is a CAPABILITY claim (does this broker's resolution curve cover
 * the request?), computed cheaply via the broker's own resolveTimeframe — it
 * says nothing about whether the source currently has data or is connected.
 * Ordering follows the fan-in priority (weight DESC), so "Auto" always points
 * at the first entry (the ideal/best source).
 *
 * @returns {Array<{slug: string, label: string, weight: number, serves: boolean}>}
 */
export async function listAvailableSources(assetId, { timeframe = 60 } = {}) {
  const tf = Math.min(Math.max(Number(timeframe) || 60, 5), 2592000)
  const { getActiveBrokers } = await registry()
  return getActiveBrokers()
    .filter((b) => b.slug !== "paper")          // paper serves no candle data
    .map((b) => {
      let served = null
      try { served = b.resolveTimeframe(tf) } catch { /* capability unknown */ }
      return {
        slug: b.slug,
        label: typeof b.label === "string" && b.label ? b.label : b.slug,
        weight: Number(b.weight) || 0,
        serves: served !== null && served !== undefined
      }
    })
}

// ── Cross-source verification (aggregate trust) ─────────────────────────────
// "Same data across multiple sources is trusted." getBestCandles returns the
// single best source (winner-priority fan-in). This WRAPPER additionally
// samples every other broker that serves the SAME resolution and tags each
// primary bar verified:true only when at least one independent sibling puts
// the same bucket at a close within tolerance — i.e. ≥2 independent sources
// agree. Single-source bars stay visible but are explicitly unverified, so no
// single-source bias is ever presented as aggregate truth. Verification NEVER
// changes OHLC or appends bars — it only adds honest provenance tags.
//
// Additive response keys (existing keys/order untouched):
//   verifySources  — number of INDEPENDENT sibling brokers that served the same
//                    resolution (primary counts as one, so ≥1 sibling ⇒ ≥2
//                    independent sources on the bucket)
//   verifiedCount  — how many returned bars are tagged verified:true
//   verifiedRatio  — verifiedCount / returned bars (0..1)
//   per-bar: verified:boolean, sources:[slugs]
//
// Honesty: a failing/declining sibling is dropped (primary stands), never
// fabricated. When the user PINNED a single source, verification is skipped
// (they asked for one lens — never relabel it as cross-source agreement).
const CLOSE_AGREEMENT_TOLERANCE = 0.005 // ±0.5% relative on close
const MAX_VERIFY_SIBLINGS = 2           // bound secondary fetches (Yahoo rate budget)

async function fetchSiblingBars(broker, id, servedTf, count) {
  try {
    const served = broker.resolveTimeframe(servedTf)
    if (served === null || served === undefined || served !== servedTf) return null
    const candles = await timed(broker.slug, async () => broker.getCandles(id, { timeframe: servedTf, count }))
    if (!Array.isArray(candles) || !candles.length) return null
    return candles
  } catch { return null }
}

export async function getCrossSourceCandles(assetId, { timeframe = 60, count = 200, ensureWatch = null, source = "auto", preferredSource = null } = {}) {
  const base = await getBestCandles(assetId, { timeframe, count, ensureWatch, source, preferredSource })
  const zero = { verifySources: 0, verifiedCount: 0, verifiedRatio: 0 }
  if (!base?.candles?.length) return { ...base, ...zero }
  // Pinned single-source lens — verification is intentionally skipped.
  const pinned = preferredSource && typeof preferredSource === "string" && preferredSource !== "auto"
    ? preferredSource
    : typeof source === "string" && source !== "" && source !== "auto"
      ? source
      : null
  if (pinned) return { ...base, ...zero }

  const servedTf = base.timeframe
  const primarySlug = base.source
  // Exact server-time buckets (the same convention withHistoryBackfill uses).
  const byBucket = new Map()
  for (const c of base.candles) {
    if (c == null || c.time == null) continue
    byBucket.set(c.time, [])
  }

  let verifySources = 0
  const { getActiveBrokers } = await registry()
  const siblings = getActiveBrokers().filter((b) => b.slug !== primarySlug)
  for (const broker of siblings.slice(0, MAX_VERIFY_SIBLINGS)) {
    const bars = await fetchSiblingBars(broker, assetId, servedTf, count)
    if (!bars) continue
    verifySources++
    for (const b of bars) {
      if (b == null || b.time == null || !Number.isFinite(b.close)) continue
      const arr = byBucket.get(b.time)
      if (arr) arr.push({ slug: broker.slug, close: b.close })
    }
  }

  let verifiedCount = 0
  const candles = base.candles.map((c) => {
    if (!Number.isFinite(c.close)) return { ...c, verified: false, sources: [primarySlug] }
    const siblings = byBucket.get(c.time) ?? []
    const agreeing = siblings.filter((s) => Math.abs(s.close - c.close) <= CLOSE_AGREEMENT_TOLERANCE * Math.max(Math.abs(c.close), 1e-9))
    const verified = agreeing.length >= 1 // primary + ≥1 sibling = ≥2 sources
    if (verified) verifiedCount++
    return { ...c, verified, sources: [primarySlug, ...agreeing.map((s) => s.slug)] }
  })
  const verifiedRatio = candles.length > 0 ? Math.round((verifiedCount / candles.length) * 1000) / 1000 : 0
  return { ...base, candles, verifySources, verifiedCount, verifiedRatio }
}
