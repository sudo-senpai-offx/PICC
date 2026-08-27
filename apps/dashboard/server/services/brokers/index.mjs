// Broker registry — the single entry point for all live data in PICC.
//
// Every data source (ExpertOption, CCXT, Yahoo, Paper) implements the
// LiveBroker interface and registers here. The marketDataBus reads from
// this registry — it never imports broker modules directly.
//
// LiveBroker contract (JSDoc — no TypeScript in .mjs):
// @typedef {Object} LiveBroker
// @property {string} slug - unique identifier
// @property {string} label - human-readable name
// @property {number} weight - priority (higher = preferred)
// @property {() => boolean} isAlive - is this broker connected/alive?
// @property {() => Object} stats - latency + health stats
// @property {(assetId: string, opts?: {timeframe?: number, count?: number}) => Array} getCandles - buffered candles for an asset
// @property {(assetId: string, cb: Function) => void} subscribe - live candle updates
// @property {() => number[]} availableTimeframes - supported timeframe options
// @property {() => Object|null} getAccountState - balance + positions (null if unauthenticated)
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
    stats: () => ({ medianMs: 0, p95Ms: 0, lastMs: 0 }),
    getCandles: () => [],
    subscribe: () => {},
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
