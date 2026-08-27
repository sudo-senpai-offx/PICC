// ExpertOption broker adapter — wraps existing liveEO.mjs behind the LiveBroker interface.
// EO is structurally the deepest integration: WebSocket candles, tick profiles,
// dual wallet, binary options expiry. This adapter preserves all of that while
// presenting the same interface as every other broker.

import { registerBroker } from "./index.mjs"

let _liveEO = null
async function getLiveEO() {
  if (!_liveEO) _liveEO = await import("../liveEO.mjs")
  return _liveEO
}

registerBroker({
  slug: "expertoption",
  label: "ExpertOption",
  weight: 60, // EO has the richest live data (push candles + tick profiles)

  isAlive() {
    // Synchronous check — EO stats are cached in module scope.
    // We peek at the cached status rather than importing liveEO every call.
    return _liveEO ? _liveEO.liveEOStats().status === "connected" : false
  },

  stats() {
    if (!_liveEO) return { medianMs: 0, p95Ms: 0, lastMs: 0 }
    const s = _liveEO.liveEOStats()
    return {
      medianMs: s.upstream?.lastAt ? Date.now() - s.upstream.lastAt : 0,
      p95Ms: 0, // EO doesn't report percentiles — only last-frame latency
      lastMs: s.upstream?.lastAt ? Date.now() - s.upstream.lastAt : 0
    }
  },

  getCandles(assetId, opts = {}) {
    if (!_liveEO) return []
    const data = _liveEO.liveEOData()
    const asset = data.assets.find((a) => a.id === assetId || a.name === assetId)
    if (!asset) return []
    const tf = opts.timeframe ?? 60
    const count = opts.count ?? 200
    const ohlc = asset.periods[tf] ?? asset.periods[60] ?? []
    return ohlc.slice(-count)
  },

  subscribe(assetId, cb) {
    if (!_liveEO) return () => {}
    return _liveEO.subscribeLiveEO((data) => {
      const asset = data.assets?.find((a) => a.id === assetId || a.name === assetId)
      if (asset) cb(asset)
    })
  },

  availableTimeframes() {
    return [60, 300, 900, 3600] // EO push provides 1m, 5m, 15m, 1h
  },

  getAccountState() {
    if (!_liveEO) return null
    const data = _liveEO.liveEOData()
    if (!data.account) return null
    return {
      balance: data.account.balance ?? 0,
      demo: data.account.demo ?? null,
      real: data.account.real ?? null,
      currency: data.account.currency ?? "USD"
    }
  },

  getExpiryDurations(assetClass) {
    // EO binary options have fixed expiry windows per asset class
    const expiryMap = {
      forex: [60, 300, 900, 1800, 3600],
      crypto: [60, 300, 900],
      metals: [60, 300, 900, 1800],
      energies: [300, 900, 1800],
      indices: [300, 900, 1800, 3600]
    }
    return expiryMap[assetClass] ?? [300, 900, 3600]
  }
})
