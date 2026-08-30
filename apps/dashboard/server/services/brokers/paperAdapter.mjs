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
    // Dynamic import avoids a load-time cycle: trading.mjs imports the broker
    // registry, and the registry must be ready before this adapter registers.
    try {
      return import("../trading.mjs").then((t) => t.paperOverview()).then((ov) => ({
        // Normalized to the same shape every other adapter returns (see
        // brokers/expertoption.mjs) — the ledger's own field is `cash`, not
        // `balance`; without this mapping any venue-agnostic reader of
        // state.balance silently got undefined for the paper venue only.
        balance: Number(ov?.cash) || 0,
        demo: true,
        real: false,
        currency: "USD"
      })).catch(() => null)
    } catch {
      return null
    }
  },

  getExpiryDurations(assetClass) {
    // Paper simulates directional trades, not binary options.
    return null
  }
})
