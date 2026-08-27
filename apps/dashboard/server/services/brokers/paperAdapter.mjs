// Paper broker adapter — wraps existing paper trading logic behind LiveBroker interface.
// Paper is always available: local simulation, no external connection needed.

import { registerBroker } from "./index.mjs"

registerBroker({
  slug: "paper",
  label: "Paper engine",
  weight: 30, // Mid priority — always available but simulated data

  isAlive() {
    return true // Paper is always "alive"
  },

  stats() {
    return { status: "idle", error: null, lastSeen: 0, stale: false, upstream: {} }
  },

  getCandles() {
    return [] // Paper doesn't provide market data — it simulates trades
  },

  subscribe() {
    return () => {}
  },

  availableTimeframes() {
    return [60, 300, 900, 3600] // Standard timeframes for paper simulation
  },

  getAccountState() {
    // Paper account state comes from the paper ledger, not a live connection.
    return null // TODO: read from paper ledger
  },

  getExpiryDurations(assetClass) {
    // Paper simulates directional trades, not binary options.
    return null
  }
})
