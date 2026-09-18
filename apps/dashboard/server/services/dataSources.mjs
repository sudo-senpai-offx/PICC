import { getBrokerStats } from "./brokers/index.mjs"
import { sentimentLastUpdate } from "./sentimentEngine.mjs"
import { kellySnapshot } from "./kellyCriterion.mjs"
import { mostRecentLeg } from "./liveEO.mjs"

export const REQUIRED_SOURCES = ["candles", "sentiment", "orderflow", "regime", "expiry", "kelly"]

const FRESH_S = 30
const STALE_S = 60
const VALID_STATUSES = ["live", "local", "stale", "unconfigured"]

export function isValidStatus(status) {
  return VALID_STATUSES.includes(status)
}

export function classifySource(lastUpdateMs, now = Date.now()) {
  const ts = Number(lastUpdateMs)
  if (!Number.isFinite(ts) || ts <= 0) return { status: "unconfigured", lastUpdate: null, age: null }
  const ageMs = Math.max(0, now - ts)
  const status = ageMs < FRESH_S * 1000 ? "live" : ageMs > STALE_S * 1000 ? "stale" : "local"
  return { status, lastUpdate: new Date(ts).toISOString(), age: Math.floor(ageMs / 1000) }
}

function unconfigured() {
  return { status: "unconfigured", lastUpdate: null, age: null }
}

export function collectSourceStatuses(now = Date.now()) {
  let candles = unconfigured()
  let candleFeed = null
  try {
    const stats = getBrokerStats()
    const lastSeen = Number(stats?.lastSeen) > 0 ? Number(stats.lastSeen) : null
    if (lastSeen != null) {
      candles = classifySource(lastSeen, now)
      // Provenance: which live leg's frames were CONSUMED most recently (T4 —
      // explicit leg accounting instead of the studio-only inline heuristic).
      // The feed is attributed to a leg only when its last consumption landed
      // within the 1500 ms fallback window of the buffers' lastSeen — a stale
      // prior consumption never labels a current feed.
      const recent = mostRecentLeg()
      candleFeed = recent && recent.lastConsumedAt >= lastSeen - 1500 ? recent.leg : null
    }
  } catch {}
  let sentiment = unconfigured()
  try {
    sentiment = classifySource(sentimentLastUpdate(), now)
  } catch {}
  let kelly = unconfigured()
  try {
    if (Number(kellySnapshot()?.stats?.totalTrades) > 0) kelly = { status: "local", lastUpdate: null, age: null }
  } catch {}
  const derivedFromCandles = () => (candles.status === "unconfigured" ? unconfigured() : { ...candles })
  return {
    candles: candleFeed ? { ...candles, feed: candleFeed } : candles,
    sentiment,
    orderflow: derivedFromCandles(),
    regime: derivedFromCandles(),
    expiry: derivedFromCandles(),
    kelly
  }
}
