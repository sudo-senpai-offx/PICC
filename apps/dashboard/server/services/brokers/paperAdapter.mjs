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
    //
    // Wave 0 Task 3 — an unobservable ledger cash balance is null with a
    // named reason, never a 0 that would read as "zero balance". The
    // reconciliation path (openPaperTrade's cash checks in trading.mjs)
    // reads paperOverview() directly and fails closed on unusable amounts;
    // no production reader of this adapter's getAccountState exists at all (verified
    // 2026-10-07: only paperOverviewApi.test.mjs reads it), so a null here
    // propagates as unobservable, never as zero.
    const finiteOrNull = (v) => {
      if (v == null) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    try {
      return import("../trading.mjs").then((t) => t.paperOverview()).then((ov) => {
        const balance = finiteOrNull(ov?.cash)
        return {
          // Normalized to the same shape every other adapter returns (see
          // brokers/expertoption.mjs) — the ledger's own field is `cash`, not
          // `balance`; without this mapping any venue-agnostic reader of
          // state.balance silently got undefined for the paper venue only.
          balance,
          demo: true,
          real: false,
          currency: "USD",
          reason: balance == null
            ? "balance-unobservable: the paper ledger reports no cash; no 0 substituted"
            : null
        }
      }).catch(() => null)
    } catch {
      return null
    }
  },

  getExpiryDurations(assetClass) {
    // Paper simulates directional trades, not binary options.
    return null
  }
})
