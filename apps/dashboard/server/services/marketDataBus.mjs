// PICC Unified Market Data Bus — the fan-in for every candle source.
//
// One call, best available candles: push-websocket buffers first, REST
// aggregates second, daily fallback last — with per-source latency tracking
// and honest staleness tags. This replaces the inline 3-tier chains that used
// to be copy-pasted across handler endpoints.
//
// Source priority:
//   1. "live"     — ExpertOption gateway buffers (push WS, minute bars)
//   2. "ccxt"     — multi-exchange REST aggregates (15s scheduler poll)
//   3. "yahoo"    — public EOD fallback (delayed, DAILY resolution)
//
// Every result is tagged with its source so the UI can label honesty
// (live vs delayed) and the model matrix can weight accordingly.

import { canonicalAssetId } from "./assetCatalog.mjs"

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

/** CCXT buffer match by canonical base symbol (BTCUSD ↔ BTC/USDT). */
function matchCcxtAsset(ccxtAssets, assetId) {
  const want = String(assetId).replace(/[^A-Z]/g, "").toUpperCase()
  return (Array.isArray(ccxtAssets) ? ccxtAssets : []).find((a) => {
    const sym = String(a.name ?? a.symbol ?? "").toUpperCase().replace("/", "")
    if (!sym) return false
    if (sym === want) return true
    // BTCUSD request matches BTCUSDT (stablecoin quote), and vice versa.
    const base = want.slice(0, 3)
    const alt = want.endsWith("USD") ? `${base}USDT` : want.replace(/USDT$/, "USD")
    return sym === alt
  })
}

/**
 * Fetch the best available candles for an asset.
 * @returns {candles[], source, stale, timeframe} — never throws for
 *          data-absence (returns empty + source:"none"); network errors from
 *          a tier fall through to the next tier.
 */
export async function getBestCandles(assetId, { timeframe = 60, count = 200, ensureWatch = null } = {}) {
  const tf = Math.min(Math.max(Number(timeframe) || 60, 5), 3600)
  const n = Math.min(Math.max(Number(count) || 200, 20), 500)
  const id = String(assetId ?? "").trim().toUpperCase() || "EURUSD"

  // ── Tier 1: ExpertOption push buffers (+ live fetch when watched) ────────
  try {
    const { liveEOData, fetchAssetCandles, ensureWatchingAsset } = await import("./liveEO.mjs")
    const data = await timed("eo-buffer", async () => liveEOData())
    const asset = data.assets.find((a) => String(a.id) === id ||
      canonicalAssetId(a.name) === canonicalAssetId(id))
    let candles = []
    if (asset && asset.periods[tf]?.length) {
      candles = asset.periods[tf].slice(-n)
    }
    if (!candles.length && typeof ensureWatch === "function") {
      await ensureWatchingAsset(id).catch(() => null)
      const result = await timed("eo-fetch", () =>
        fetchAssetCandles(id, tf, n).catch(() => ({ ohlc: [], source: null })))
      if (result.ohlc?.length) candles = result.ohlc
    }
    if (candles.length >= 30) {
      return { candles, source: "live", stale: false, timeframe: tf }
    }
    if (candles.length) {
      // Some data but too thin to trust — keep as last-resort below.
      var thinEo = candles
    }
  } catch { /* EO unavailable */ }

  // ── Tier 2: CCXT aggregates ──────────────────────────────────────────────
  try {
    const { liveCCXTData } = await import("./liveCCXT.mjs")
    const ccxtAssets = await timed("ccxt", async () => liveCCXTData()?.assets ?? [])
    const ccxtAsset = matchCcxtAsset(ccxtAssets, id)
    const series = ccxtAsset?.periods?.[tf]
    if (Array.isArray(series) && series.length >= 30) {
      return { candles: series.slice(-n), source: "ccxt", stale: true, timeframe: tf }
    }
  } catch { /* CCXT not populated */ }

  // ── Tier 3: Yahoo daily fallback ─────────────────────────────────────────
  try {
    const { getHistory } = await import("./yahoo.mjs")
    const history = await timed("yahoo", () => getHistory(id, "6mo"))
    const candles = history.dates.map((ts, i) => ({
      time: Math.floor(ts / 1000),
      open: Number(history.opens?.[i]) || 0,
      high: Number(history.highs?.[i]) || 0,
      low: Number(history.lows?.[i]) || 0,
      close: Number(history.closes?.[i]) || 0,
      timeframe: 86400
    })).filter((c) => c.close > 0 && c.time > 0).slice(-n)
    if (candles.length) {
      return { candles, source: "yahoo", stale: true, timeframe: 86400 }
    }
  } catch { /* Yahoo failed too */ }

  // Last resort: thin EO partials, else honest emptiness.
  if (thinEo?.length) {
    return { candles: thinEo, source: "live", stale: true, timeframe: tf }
  }
  return { candles: [], source: "none", stale: true, timeframe: tf }
}
