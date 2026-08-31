// Yahoo Finance broker adapter — wraps existing yahoo.mjs behind LiveBroker interface.
// Yahoo is the always-available fallback: historical candles with no auth.
// Wired for intraday + daily (T1): the v8 chart API serves 1m/5m/15m/30m/1h
// intervals as well as 1d/1wk/1mo, so a 5m request now returns REAL 5m history
// (up to Yahoo's range contract) instead of being rounded up to daily bars.
// Every returned candle is tagged with the resolution it ACTUALLY represents.

import { registerBroker } from "./index.mjs"

let _yahoo = null
async function getYahoo() {
  if (!_yahoo) _yahoo = await import("../yahoo.mjs")
  return _yahoo
}

// Yahoo chart API interval/range per served timeframe.
// Range caps honor Yahoo's own contract so a 429 or empty series is the API's
// honest answer, never a padded series: 1m caps ~5-7d, 5m/15m/30m ~60d,
// 1h ~730d (2y), daily ~untouched. 14400 (4h) is DELIBERATELY absent — the
// chart API has no 4h interval, so a 4h request resolves up to daily via the
// resolver contract (in-range round-up) instead of fabricating a 4h bar.
const INTERVAL_BY_TF = {
  60: "1m",
  300: "5m",
  900: "15m",
  1800: "30m",
  3600: "60m",
  86400: "1d",
  604800: "1wk",
  2592000: "1mo"
}
const RANGE_BY_TF = {
  60: "5d",
  300: "1mo",
  900: "1mo",
  1800: "1mo",
  3600: "2y",
  86400: "3y",
  604800: "10y",
  2592000: "max"
}

registerBroker({
  slug: "yahoo",
  label: "Yahoo Finance",
  weight: 10, // Lowest priority — daily EOD only, no live data

  isAlive() {
    return true // Yahoo is always "alive" (no auth, no connection state)
  },

  stats() {
    return { status: "idle", error: null, lastSeen: 0, stale: false, upstream: {} }
  },

  async getCandles(assetId, opts = {}) {
    // Served timeframe arrives pre-resolved by the bus (1D/1W/1M only —
    // the resolver declines finer requests via null on the default curve).
    const tf = opts.timeframe ?? 86400
    const interval = INTERVAL_BY_TF[tf]
    if (!interval) return [] // unsupported resolution — resolver prevents this
    const count = opts.count ?? 200
    const { getHistory } = await getYahoo()
    const h = await getHistory(assetId, RANGE_BY_TF[tf] ?? "5y", interval)
    const rows = []
    const dates = h.dates ?? []
    for (let i = 0; i < dates.length; i++) {
      const o = h.opens?.[i]
      const hi = h.highs?.[i]
      const lo = h.lows?.[i]
      const c = h.closes?.[i]
      if (o == null || hi == null || lo == null || c == null) continue // partial bars are dropped, not faked
      if (![o, hi, lo, c].every((v) => Number.isFinite(v))) continue
      // yahoo.dates are milliseconds → lightweight-charts wants seconds.
      rows.push({ time: Math.floor(dates[i] / 1000), open: o, high: hi, low: lo, close: c, timeframe: tf })
    }
    return rows.slice(-count)
  },

  subscribe() {
    return () => {} // Yahoo doesn't push — it's a REST API
  },

  availableTimeframes() {
    return [60, 300, 900, 1800, 3600, 86400, 604800, 2592000] // 1m, 5m, 15m, 30m, 1h, 1D, 1W, 1M
  },

  getAccountState() {
    return null // Yahoo has no account
  },

  getExpiryDurations() {
    return null // No expiry — this is a data source, not a broker
  }
})