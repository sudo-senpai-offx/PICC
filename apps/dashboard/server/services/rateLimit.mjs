// PICC polite rate limiter + single-flight cache.
//
// Every outbound poll the dashboard makes (provider collectors, market-data
// APIs, the yield monitor) funnels through here so the whole app shares one
// courtesy budget: no hammering a provider, and no duplicated concurrent
// fetches for the same resource. This is a courteous-client limit, not
// evasion tooling.
//
//   throttle(key, minMs)  -> { allowed, remainingMs }  per-key cooldown
//   cached(key, ttlMs, fn) -> shared promise (single-flight TTL cache)
//   setGlobalBudget(max)  -> cap on outbound calls per minute (default 60)

const cooldowns = new Map() // key -> { lastAt, minMs }
const cache = new Map() // key -> { at, ttlMs, promise }
let recentCalls = [] // timestamps for the per-minute budget
let budgetPerMinute = 60

export function setGlobalBudget(maxPerMinute) {
  budgetPerMinute = Math.max(1, Number(maxPerMinute) || 60)
}

export function throttle(key, minMs) {
  const now = Date.now()
  const prev = cooldowns.get(key)
  if (prev && now - prev.lastAt < minMs) {
    return { allowed: false, remainingMs: Math.ceil(minMs - (now - prev.lastAt)) }
  }
  if (!hasBudget()) {
    return { allowed: false, remainingMs: 1000 }
  }
  cooldowns.set(key, { lastAt: now, minMs: Math.max(0, Number(minMs) || 0) })
  return { allowed: true, remainingMs: 0 }
}

function hasBudget() {
  const now = Date.now()
  recentCalls = recentCalls.filter((t) => now - t < 60_000)
  if (recentCalls.length >= budgetPerMinute) return false
  recentCalls.push(now)
  return true
}

export function resetRateLimits() {
  cooldowns.clear()
  cache.clear()
  recentCalls = []
}

export function rateLimitStatus() {
  const now = Date.now()
  recentCalls = recentCalls.filter((t) => now - t < 60_000)
  return {
    budgetPerMinute,
    usedThisMinute: recentCalls.length,
    keys: [...cooldowns.entries()].map(([key, v]) => ({
      key,
      cooldownMs: v.minMs,
      ageMs: Math.round(now - v.lastAt)
    })),
    cacheSize: cache.size
  }
}

/**
 * Single-flight TTL cache. Concurrent callers share one loader invocation;
 * a rejected loader evicts the entry so a later call retries. Returns a
 * Promise — callers can `await` it or pass it through.
 */
export function cached(key, ttlMs, loader) {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < hit.ttlMs) return hit.promise
  const promise = Promise.resolve()
    .then(loader)
    .catch((err) => {
      cache.delete(key)
      throw err
    })
  cache.set(key, { at: now, ttlMs: Math.max(1000, Number(ttlMs) || 60_000), promise })
  return promise
}
