// Yahoo Finance broker adapter — wraps existing yahoo.mjs behind LiveBroker interface.
// Yahoo is the always-available fallback: daily EOD candles, no auth needed.

import { registerBroker } from "./index.mjs"

let _yahoo = null
async function getYahoo() {
  if (!_yahoo) _yahoo = await import("../yahoo.mjs")
  return _yahoo
}

registerBroker({
  slug: "yahoo",
  label: "Yahoo Finance",
  weight: 10, // Lowest priority — daily EOD only, no live data

  isAlive() {
    return true // Yahoo is always "alive" (no auth, no connection state)
  },

  stats() {
    return { medianMs: 0, p95Ms: 0, lastMs: 0 }
  },

  getCandles(assetId, opts = {}) {
    // Yahoo provides daily EOD candles. Not suitable for intraday.
    // The yahoo.mjs module handles fetching + caching.
    return [] // Placeholder — full integration requires async fetch
  },

  subscribe() {
    return () => {} // Yahoo doesn't push — it's a REST API
  },

  availableTimeframes() {
    return [86400, 604800, 2592000] // 1D, 1W, 1M
  },

  getAccountState() {
    return null // Yahoo has no account
  },

  getExpiryDurations() {
    return null // No expiry — this is a data source, not a broker
  }
})
