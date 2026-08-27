// CCXT broker adapter — wraps existing ccxtConnector.mjs + liveCCXT.mjs behind LiveBroker.
// CCXT provides REST-based candle data from multiple exchanges. Read-only by contract.

import { registerBroker } from "./index.mjs"

let _liveCCXT = null
async function getLiveCCXT() {
  if (!_liveCCXT) _liveCCXT = await import("../liveCCXT.mjs")
  return _liveCCXT
}

let _ccxtConn = null
async function getCcxtConn() {
  if (!_ccxtConn) _ccxtConn = await import("../ccxtConnector.mjs")
  return _ccxtConn
}

registerBroker({
  slug: "ccxt",
  label: "CCXT exchanges",
  weight: 40, // Lower than EO — REST polling, not push

  isAlive() {
    if (!_ccxtConn) return false
    try {
      const ids = _ccxtConn.connectedExchangeIds()
      return ids.length > 0
    } catch { return false }
  },

  stats() {
    if (!_ccxtConn) return { medianMs: 0, p95Ms: 0, lastMs: 0 }
    try {
      const ids = _ccxtConn.connectedExchangeIds()
      return {
        medianMs: 0, // CCXT doesn't track median latency
        p95Ms: 0,
        lastMs: ids.length > 0 ? 0 : 0 // Connected = alive, but no per-request timing
      }
    } catch { return { medianMs: 0, p95Ms: 0, lastMs: 0 } }
  },

  getCandles(assetId, opts = {}) {
    // CCXT candles come from liveCCXT's cached buffers, populated by REST polling.
    // For now, return empty — the liveCCXT module manages its own cache.
    // Full integration requires liveCCXT to expose a getCandles() function.
    return []
  },

  subscribe(assetId, cb) {
    // CCXT doesn't push — it polls. Subscription is a no-op for now.
    // The liveCCXT module handles polling internally.
    return () => {}
  },

  availableTimeframes() {
    return [60, 300, 900, 1800, 3600, 14400] // 1m through 4h
  },

  getAccountState() {
    // CCXT is read-only — no account state exposed.
    return null
  },

  getExpiryDurations() {
    // CCXT spot = no expiry. Futures have expiry but we don't trade them.
    return null
  }
})
