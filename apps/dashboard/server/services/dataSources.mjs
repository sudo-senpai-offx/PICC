import { getBrokerStats } from "./brokers/index.mjs"
import { sentimentLastUpdate } from "./sentimentEngine.mjs"
import { kellySnapshot } from "./kellyCriterion.mjs"

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
      // Provenance: which live leg's frames were CONSUMED most recently.
      // The studio bridge is the only browser leg today (clean break) — the
      // feed is attributed to it only when its frames were actually consumed.
      const studioConsumed = Number(stats?.legs?.studio?.lastConsumedAt) || 0
      candleFeed = studioConsumed && studioConsumed >= lastSeen - 1500 ? "studio" : null
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
