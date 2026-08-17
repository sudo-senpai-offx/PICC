// PICC Realtime Trading Suite — a single aggregated snapshot of every trading
// metric the suite shows (paper status, positions, history, signals, accuracy,
// accuracy ledger, and the ExpertOption demo/autopilot status), served over the
// existing /api/trading/realtime SSE stream as periodic `suite` events so the
// whole suite stays in sync without per-card polling.
//
// Each section is cached independently (paper ~4s, demo ~12s) so the snapshot
// is cheap even with many connected clients, and a failing section never kills
// the rest of the suite.
import { paperPositions, paperHistory, recentSignals, signalAccuracy, tradingStatus } from "./trading.mjs"
import { ledgerStats, ledgerEngineStats, ledgerHistory } from "./accuracyLedger.mjs"
import { demoStatus, demoDeals, demoAnalytics } from "./autopilot.mjs"
import { liveEOStats } from "./liveEO.mjs"
import { getMarketIntel } from "./marketIntel.mjs"

const SECTIONS = {
  trading: { ttl: 4000, load: () => tradingStatus() },
  positions: { ttl: 4000, load: () => paperPositions() },
  closed: { ttl: 4000, load: () => paperHistory(15) },
  signals: { ttl: 6000, load: () => recentSignals(20) },
  accuracy: { ttl: 30000, load: () => signalAccuracy() },
  intel: { ttl: 8000, load: () => getMarketIntel() },
  ledger: {
    ttl: 6000,
    load: async () => {
      // Fault-isolate the ledger trio: one failing member degrades to null
      // instead of taking the whole ledger section down with it.
      const [stats, engine, entries] = await Promise.allSettled([ledgerStats(), ledgerEngineStats(), ledgerHistory(20)])
      return {
        stats: stats.status === "fulfilled" ? stats.value : null,
        engine: engine.status === "fulfilled" ? engine.value : null,
        entries: entries.status === "fulfilled" ? entries.value : []
      }
    }
  },
  demo: { ttl: 12000, load: () => demoStatus() },
  deals: { ttl: 12000, load: () => demoDeals(30) },
  analytics: { ttl: 12000, load: () => demoAnalytics() }
}

const cache = Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, { at: 0, data: null }]))

function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`section timed out after ${ms}ms`)), ms)
      if (t && typeof t.unref === "function") t.unref()
    })
  ])
}

async function cached(key) {
  const c = cache[key]
  const now = Date.now()
  if (c.data && now - c.at < SECTIONS[key].ttl) return c.data
  try {
    // Per-section timeout: a slow/cold section (e.g. market intel re-running
    // the decision engine) degrades to stale data instead of hanging the whole
    // aggregated snapshot (which previously silently dropped the entire `suite`
    // event — the #1 cause of every card showing "—" at once).
    const data = await withTimeout(SECTIONS[key].load(), SECTIONS[key].ttl)
    c.data = data
    c.at = now
    return data
  } catch {
    return c.data // stale is better than nothing; a fully-failing section → null
  }
}

/** Test hook — clear the section caches. */
export function _clearRealtimeSuiteCache() {
  for (const c of Object.values(cache)) {
    c.at = 0
    c.data = null
  }
}

/**
 * Invalidate every cached section so the next snapshot re-reads from source.
 * Called by the mutation endpoints (paper/demo trades, autopilot, signals) so
 * a change shows up in the realtime suite on the very next tick instead of
 * waiting out a section TTL.
 */
export function bustRealtimeSuite() {
  _clearRealtimeSuiteCache()
}

/**
 * One aggregated snapshot of the whole trading suite. Sections that fail stay
 * `null`; `ts` is the snapshot time. Cache-only reads make this cheap enough to
 * emit every few seconds per connected client.
 */
export async function tradingSuiteSnapshot() {
  const settled = await Promise.all(
    Object.keys(SECTIONS).map(async (k) => [k, await cached(k).catch(() => null)])
  )
  return { ts: Date.now(), live: liveEOStats(), ...Object.fromEntries(settled) }
}
