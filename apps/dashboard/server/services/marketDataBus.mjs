// PICC Unified Market Data Bus — the fan-in for every candle source.
//
// One call, best available candles: broker-priority fan-in with per-source
// latency tracking and honest staleness tags. Brokers register via the
// broker registry — this module never imports broker modules directly.
//
// Source priority is determined by:
//   1. Broker weight (user-configurable, higher = preferred)
//   2. Liveness (alive brokers ranked above dead ones)
//   3. Data freshness (how many candles are buffered)
//
// Every result is tagged with its source so the UI can label honesty
// (live vs delayed) and the model matrix can weight accordingly.

import { canonicalAssetId } from "./assetCatalog.mjs"

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
// broker.ensureWatch(assetId) in Phase I.
async function eoWatchAndFetch(assetId, tf, n) {
  try {
    const { ensureWatchingAsset, fetchAssetCandles } = await import("./liveEO.mjs")
    await ensureWatchingAsset(assetId).catch(() => null)
    const result = await timed("eo-fetch", () =>
      fetchAssetCandles(assetId, tf, n).catch(() => ({ ohlc: [], source: null })))
    return result.ohlc ?? []
  } catch { return [] }
}

/**
 * Fetch the best available candles for an asset.
 * @returns {candles[], source, stale, timeframe} — never throws for
 *          data-absence (returns empty + source:"none"); network errors from
 *          a broker fall through to the next.
 */
export async function getBestCandles(assetId, { timeframe = 60, count = 200, ensureWatch = null } = {}) {
  const tf = Math.min(Math.max(Number(timeframe) || 60, 5), 2592000) // up to 1M
  const n = Math.min(Math.max(Number(count) || 200, 20), 2000)
  const id = String(assetId ?? "").trim().toUpperCase() || "EURUSD"

  const { getActiveBrokers } = await registry()
  const brokers = getActiveBrokers()
  let thinData = null // best thin result so far (last-resort fallback)

  for (const broker of brokers) {
    try {
      const candles = await timed(broker.slug, async () => broker.getCandles(id, { timeframe: tf, count: n }))
      if (!Array.isArray(candles) || !candles.length) continue

      const sliced = candles.slice(-n)
      if (sliced.length >= 30) {
        return { candles: sliced, source: broker.slug, stale: false, timeframe: tf }
      }
      // Thin data — keep as fallback but try next broker for better data
      if (!thinData || sliced.length > thinData.candles.length) {
        thinData = { candles: sliced, source: broker.slug, stale: true, timeframe: tf }
      }
    } catch { /* broker unavailable — fall through */ }
  }

  // ── EO watch-and-fetch bridge (Phase H transitional) ─────────────────────
  // If ensureWatch is provided and no broker had good data, try EO's
  // on-demand fetch. This preserves existing behavior during the transition.
  if (typeof ensureWatch === "function" && !thinData) {
    try {
      const eoCandles = await eoWatchAndFetch(id, tf, n)
      if (eoCandles.length >= 30) {
        return { candles: eoCandles, source: "live", stale: false, timeframe: tf }
      }
      if (eoCandles.length) thinData = { candles: eoCandles, source: "live", stale: true, timeframe: tf }
    } catch { /* EO fetch failed */ }
  }

  // Last resort: thin data from any broker, else honest emptiness.
  if (thinData) return thinData
  return { candles: [], source: "none", stale: true, timeframe: tf }
}
