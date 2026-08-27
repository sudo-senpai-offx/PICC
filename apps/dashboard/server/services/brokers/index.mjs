// Broker registry — the single entry point for all live data in PICC.
//
// Every data source (ExpertOption, CCXT, Yahoo, Paper) implements the
// LiveBroker interface and registers here. The marketDataBus and all
// service modules read from this registry — they never import broker
// modules directly.
//
// LiveBroker contract (JSDoc — no TypeScript in .mjs):
// @typedef {Object} LiveBroker
// @property {string} slug - unique identifier
// @property {string} label - human-readable name
// @property {number} weight - priority (higher = preferred)
// @property {() => boolean} isAlive - is this broker connected/alive?
// @property {() => Object} stats - latency + health stats (including lastSeen, status, upstream)
// @property {() => Object} dataSnapshot - full data snapshot (assets, account, viewed, watching, ts)
// @property {(flag: boolean) => void} setStaleness - set the stale warning flag
// @property {(assetId: string, opts?: {timeframe?: number, count?: number}) => Array} getCandles - buffered candles for an asset
// @property {(assetId: string, cb: Function) => Function} subscribe - live candle updates (returns unsubscribe)
// @property {() => number[]} availableTimeframes - supported timeframe options
// @property {() => Object|null|Promise<Object|null>} getAccountState - balance + positions (null if unauthenticated)
// @property {(assetClass: string) => number[]|null} getExpiryDurations - available expiry per asset class

const brokers = new Map()

/**
 * Register a broker adapter. Called once at startup by each adapter module.
 * Weight defaults to 50 if not provided.
 */
export function registerBroker(adapter) {
  if (!adapter?.slug) throw new Error("broker adapter must have a slug")
  if (brokers.has(adapter.slug)) throw new Error(`broker '${adapter.slug}' already registered`)
  brokers.set(adapter.slug, {
    weight: 50,
    isAlive: () => false,
    stats: () => ({ status: "disconnected", error: null, lastSeen: 0, stale: false, upstream: {} }),
    dataSnapshot: () => ({ assets: [], account: null, viewed: null, watching: [], ts: 0 }),
    setStaleness: () => {},
    getCandles: () => [],
    subscribe: () => () => {},
    availableTimeframes: () => [60, 300, 900, 3600],
    getAccountState: () => null,
    getExpiryDurations: () => null,
    ...adapter
  })
}

/** Look up a broker by slug. Returns null if not found. */
export function getBroker(slug) {
  return brokers.get(slug) ?? null
}

/** All registered brokers. */
export function listBrokers() {
  return [...brokers.values()]
}

/** Brokers sorted by weight DESC (highest priority first). */
export function getActiveBrokers() {
  return listBrokers().sort((a, b) => b.weight - a.weight)
}

/** Remove a broker by slug. Silently no-ops if not found. */
export function unregisterBroker(slug) {
  brokers.delete(slug)
}

/** Quick check: is any broker alive? */
export function anyBrokerAlive() {
  return listBrokers().some((b) => b.isAlive())
}

// ── Convenience functions ───────────────────────────────────────────────────
// These delegate to the highest-weight active broker. Services call these
// instead of importing broker modules directly.

/** Full data snapshot from the highest-weight alive broker (assets, account, etc.). */
export function getBrokerData() {
  const broker = getActiveBrokers().find((b) => b.isAlive())
  if (!broker) {
    // Fall through to any registered broker even if not alive — they may
    // still have cached data from a previous connection.
    const any = getActiveBrokers()[0]
    return any ? any.dataSnapshot() : { assets: [], account: null, viewed: null, watching: [], ts: 0 }
  }
  return broker.dataSnapshot()
}

/** Connection stats from the highest-weight alive broker. */
export function getBrokerStats() {
  const broker = getActiveBrokers().find((b) => b.isAlive())
  if (!broker) {
    const any = getActiveBrokers()[0]
    return any ? any.stats() : { status: "disconnected", error: null, lastSeen: 0, stale: false }
  }
  return broker.stats()
}

/** Set the staleness flag on the highest-weight alive broker. */
export function setBrokerStale(flag) {
  for (const b of getActiveBrokers()) {
    if (b.isAlive()) { b.setStaleness(flag); return }
  }
  // If no broker is alive, set on the first registered one
  const any = getActiveBrokers()[0]
  if (any) any.setStaleness(flag)
}

/** Subscribe to live updates from the highest-weight alive broker. Returns unsubscribe fn. */
export function subscribeBroker(cb) {
  const broker = getActiveBrokers().find((b) => b.isAlive())
  if (!broker) {
    const any = getActiveBrokers()[0]
    return any ? any.subscribe(null, cb) : () => {}
  }
  return broker.subscribe(null, cb)
}
