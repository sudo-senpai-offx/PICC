// Adaptive-confluence accuracy ledger — auto-resolving decision tracking.
//
// Every TRADE verdict from the decision engine is recorded with its predicted
// edge (winProb / EV / payout / gates) and the entry price sampled from the live
// EO buffers at decision time. A background loop then AUTO-RESOLVES each entry
// once its expiry has passed, comparing the exit price against the entry price
// for the predicted direction:
//
//   up   → exit > entry  = hit, exit < entry = miss, ~unchanged = push
//   down → exit < entry  = hit, exit > entry = miss, ~unchanged = push
//   flat → treated as a push when ~unchanged, else miss (no edge to follow)
//
// Entries that cannot be resolved (session went idle, no price) stay pending up
// to a cap, then are marked unresolved rather than guessed. The ledger also
// powers the decision-history panel and the gate backtest (predicted vs
// realized EV per expiry/win-probability bucket).
import { liveEOData } from "./liveEO.mjs"

export const LEDGER_CAP = 1000
export const RESOLVE_INTERVAL_MS = 5000
export const RESOLVE_GRACE_MS = 2000
export const MAX_PENDING_MS = 10 * 60 * 1000
export const PUSH_TOL = 0.0002

let entries = [] // oldest first; newest appended at the end
let seq = 0
let timer = null
let started = false

export function recordDecision(d) {
  if (!d || d.verdict !== "TRADE" || d.expiry == null) return null
  const now = Date.now()
  const entry = {
    id: ++seq,
    assetId: d.assetId,
    asset: d.asset,
    direction: d.direction,
    expirySec: d.expiry,
    expiresAt: now + Number(d.expiry) * 1000,
    entryTs: now,
    winProb: d.winProb ?? null,
    empirical: d.empirical ?? null,
    sampled: d.sampled ?? null,
    ev: d.ev ?? null,
    payout: d.payout ?? null,
    payoutSource: d.payoutSource ?? null,
    confidence: d.confidence ?? null,
    priceRR: d.priceRR ?? null,
    evRR: d.evRR ?? null,
    gates: d.gates ?? null,
    status: "pending",
    result: null,
    entryPrice: null,
    exitPrice: null,
    resolvedAt: null
  }
  // Sample the entry price from the live 60s buffer if available (best-effort).
  const data = liveEOData()
  const asset = (data?.assets ?? []).find((a) => a.id === d.assetId || a.name === d.asset)
  const candles = asset?.periods?.[60] ?? []
  if (candles.length) entry.entryPrice = Number(candles[candles.length - 1].close ?? null)
  entries.push(entry)
  if (entries.length > LEDGER_CAP) entries = entries.slice(entries.length - LEDGER_CAP)
  return entry
}

/**
 * Resolve a pending entry against the price that was observed at/after expiry.
 * Pure — unit-testable without the live layer.
 */
export function resolveResult(direction, entryPrice, exitPrice) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(exitPrice)) return { outcome: "unresolved" }
  const moved = Math.abs(exitPrice - entryPrice) / entryPrice
  if (moved < PUSH_TOL) return { outcome: "push", moved }
  const hit =
    (direction === "up" && exitPrice > entryPrice) ||
    (direction === "down" && exitPrice < entryPrice) ||
    (direction === "flat" && false)
  return { outcome: hit ? "hit" : "miss", moved }
}

/** Look up the best available exit price for an asset at/after expiry. */
export function exitPriceFor(assetId, assetName, at) {
  const data = liveEOData()
  const asset = (data?.assets ?? []).find((a) => a.id === assetId || a.name === assetName)
  const candles = asset?.periods?.[60] ?? []
  if (!candles.length) return null
  // Prefer the close of the candle that covers `at`; fall back to the latest.
  const covering = [...candles].reverse().find((c) => Number(c.time) <= at)
  return Number((covering ?? candles[candles.length - 1]).close)
}

/** Flush expired pending entries. Callable directly for tests with injected io. */
export function flushLedger({ now = Date.now(), resolve = null } = {}) {
  const resolved = []
  const flushAt = now - RESOLVE_GRACE_MS
  const staleAt = now - MAX_PENDING_MS
  for (const e of entries) {
    if (e.status !== "pending") continue
    if (e.entryTs < staleAt) {
      e.status = "unresolved"
      e.resolvedAt = now
      continue
    }
    if (e.expiresAt > flushAt) continue
    const price = resolve
      ? resolve(e)
      : exitPriceFor(e.assetId, e.asset, e.expiresAt)
    if (price == null) continue // no data yet — keep pending until the cap
    const r = resolveResult(e.direction, e.entryPrice, price)
    e.status = r.outcome === "unresolved" ? "unresolved" : "resolved"
    e.result = r.outcome
    e.exitPrice = price
    e.resolvedAt = now
    if (r.outcome !== "unresolved") resolved.push(e)
  }
  return resolved
}

export function ledgerHistory(limit = 200) {
  return entries.slice(-limit).reverse()
}

export function ledgerStats() {
  const resolved = entries.filter((e) => e.status === "resolved" && e.result !== "unresolved")
  const hits = resolved.filter((e) => e.result === "hit").length
  const misses = resolved.filter((e) => e.result === "miss").length
  const pushes = resolved.filter((e) => e.result === "push").length
  const decided = hits + misses + pushes
  const hitRate = hits + misses > 0 ? hits / (hits + misses) : null
  const realizedEv = decided
    ? resolved.reduce((a, e) => a + (e.result === "hit" ? e.payout ?? 0 : e.result === "push" ? 0 : -100), 0) / decided
    : null
  const predictedEv = resolved.length
    ? resolved.reduce((a, e) => a + (e.ev ?? 0), 0) / resolved.length
    : null
  const byExpiry = {}
  for (const e of resolved) {
    const k = String(e.expirySec ?? "?")
    byExpiry[k] ??= { n: 0, hits: 0, misses: 0, predictedWin: 0, predictedEv: 0, realizedEv: 0 }
    const b = byExpiry[k]
    b.n++
    if (e.result === "hit") b.hits++
    if (e.result === "miss") b.misses++
    b.predictedWin += e.winProb ?? 0
    b.predictedEv += e.ev ?? 0
    b.realizedEv += e.result === "hit" ? e.payout ?? 0 : e.result === "push" ? 0 : -100
  }
  for (const k of Object.keys(byExpiry)) {
    const b = byExpiry[k]
    b.hitRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : null
    b.predictedWin = b.n ? b.predictedWin / b.n : null
    b.predictedEv = b.n ? b.predictedEv / b.n : null
    b.realizedEv = b.n ? b.realizedEv / b.n : null
  }
  const buckets = {}
  for (const e of resolved) {
    const p = e.winProb ?? 0
    const key = p < 0.6 ? "<60%" : p < 0.7 ? "60–70%" : p < 0.8 ? "70–80%" : "80%+"
    buckets[key] ??= { n: 0, hits: 0, misses: 0, pushes: 0 }
    const b = buckets[key]
    b.n++
    if (e.result === "hit") b.hits++
    if (e.result === "miss") b.misses++
    if (e.result === "push") b.pushes++
  }
  for (const k of Object.keys(buckets)) {
    const b = buckets[k]
    b.hitRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : null
  }
  return {
    total: entries.length,
    pending: entries.filter((e) => e.status === "pending").length,
    unresolved: entries.filter((e) => e.status === "unresolved").length,
    resolved: resolved.length,
    decided,
    hits,
    misses,
    pushes,
    hitRate,
    predictedEv,
    realizedEv,
    edge: decided ? realizedEv - predictedEv : null,
    byExpiry,
    buckets
  }
}

/**
 * Gate backtest — engine predictions (resolved in this ledger) vs actual demo
 * deals, bucketed by expiry/duration. Shows whether the engine's predicted
 * win probability and EV actually materialized on real demo outcomes.
 */
export async function backtestGates() {
  const resolved = entries.filter((e) => e.status === "resolved" && e.result !== "unresolved")

  // Actual (demo) deal outcomes from the autopilot deal file.
  let deals = []
  try {
    const { demoDeals } = await import("./autopilot.mjs")
    const res = await demoDeals(500)
    deals = Array.isArray(res) ? res : res?.deals ?? []
  } catch {
    /* demo-deal file unavailable — the backtest just reports engine side */
  }

  const buckets = new Map() // key -> { key, engine:{...}, demo:{...} }

  for (const e of resolved) {
    const key = String(e.expirySec ?? "?")
    let b = buckets.get(key)
    if (!b) {
      b = {
        key,
        engine: { n: 0, hits: 0, misses: 0, pushes: 0, predWin: 0, predEv: 0, realEv: 0 },
        demo: { n: 0, wins: 0, losses: 0, draws: 0, payouts: 0, realEv: 0 }
      }
      buckets.set(key, b)
    }
    const en = b.engine
    en.n++
    if (e.result === "hit") en.hits++
    if (e.result === "miss") en.misses++
    if (e.result === "push") en.pushes++
    en.predWin += e.winProb ?? 0
    en.predEv += e.ev ?? 0
    en.realEv += e.result === "hit" ? e.payout ?? 0 : e.result === "push" ? 0 : -100
  }

  for (const d of deals) {
    if (d.status === "active" || !d.result) continue
    const dur = d.duration ?? d.expiry
    const key = dur != null ? String(dur) : "?"
    let b = buckets.get(key)
    if (!b) {
      b = {
        key,
        engine: { n: 0, hits: 0, misses: 0, pushes: 0, predWin: 0, predEv: 0, realEv: 0 },
        demo: { n: 0, wins: 0, losses: 0, draws: 0, payouts: 0, realEv: 0 }
      }
      buckets.set(key, b)
    }
    const de = b.demo
    de.n++
    if (d.result === "win") de.wins++
    if (d.result === "loss") de.losses++
    if (d.result === "draw") de.draws++
    const pay = Number(d.payout)
    if (Number.isFinite(pay) && pay > 0) de.payouts += pay
    if (Number.isFinite(pay)) {
      de.realEv += d.result === "win" ? pay : d.result === "loss" ? -100 : 0
    } else {
      const amt = Number(d.amount)
      const profit = Number(d.profit)
      if (Number.isFinite(amt) && Number.isFinite(profit) && amt > 0) de.realEv += (profit / amt) * 100
    }
  }

  const rows = []
  for (const b of buckets.values()) {
    const en = b.engine
    const de = b.demo
    rows.push({
      key: b.key,
      engine: {
        n: en.n,
        hits: en.hits,
        misses: en.misses,
        pushes: en.pushes,
        hitRate: en.hits + en.misses > 0 ? en.hits / (en.hits + en.misses) : null,
        predictedWin: en.n ? en.predWin / en.n : null,
        predictedEv: en.n ? en.predEv / en.n : null,
        realizedEv: en.n ? en.realEv / en.n : null
      },
      demo: {
        n: de.n,
        wins: de.wins,
        losses: de.losses,
        draws: de.draws,
        winRate: de.wins + de.losses > 0 ? de.wins / (de.wins + de.losses) : null,
        avgPayout: de.n ? de.payouts / de.n : null,
        realizedEv: de.n ? de.realEv / de.n : null
      }
    })
  }
  rows.sort((a, b) => Number(a.key) - Number(b.key))

  const demoAll = deals.filter((d) => d.status !== "active" && d.result)
  const demoWins = demoAll.filter((d) => d.result === "win").length
  const demoLosses = demoAll.filter((d) => d.result === "loss").length
  const demoRealizedEv = demoAll.reduce((a, d) => {
    const pay = Number(d.payout)
    if (Number.isFinite(pay)) return a + (d.result === "win" ? pay : d.result === "loss" ? -100 : 0)
    const amt = Number(d.amount)
    const profit = Number(d.profit)
    return a + (Number.isFinite(amt) && Number.isFinite(profit) && amt > 0 ? (profit / amt) * 100 : 0)
  }, 0)

  const enginePredEv = resolved.length ? resolved.reduce((a, e) => a + (e.ev ?? 0), 0) / resolved.length : null
  const engineRealEv = resolved.length
    ? resolved.reduce((a, e) => a + (e.result === "hit" ? e.payout ?? 0 : e.result === "push" ? 0 : -100), 0) / resolved.length
    : null

  return {
    ok: true,
    engine: {
      n: resolved.length,
      hits: resolved.filter((e) => e.result === "hit").length,
      misses: resolved.filter((e) => e.result === "miss").length,
      pushes: resolved.filter((e) => e.result === "push").length,
      hitRate:
        (() => {
          const h = resolved.filter((e) => e.result === "hit").length
          const m = resolved.filter((e) => e.result === "miss").length
          return h + m > 0 ? h / (h + m) : null
        })(),
      predictedEv: enginePredEv,
      realizedEv: engineRealEv
    },
    demo: {
      n: demoAll.length,
      wins: demoWins,
      losses: demoLosses,
      draws: demoAll.filter((d) => d.result === "draw").length,
      winRate: demoWins + demoLosses > 0 ? demoWins / (demoWins + demoLosses) : null,
      avgPayout: demoAll.length
        ? demoAll.reduce((a, d) => a + (Number.isFinite(Number(d.payout)) ? Number(d.payout) : 0), 0) / demoAll.length
        : null,
      realizedEv: demoAll.length ? demoRealizedEv / demoAll.length : null
    },
    rows
  }
}

function loop() {
  try {
    flushLedger()
  } catch {
    /* the resolve loop must never crash the server */
  }
}

export function startLedger() {
  if (started) return
  started = true
  clearInterval(timer)
  timer = setInterval(loop, RESOLVE_INTERVAL_MS)
  timer.unref?.()
}

export function ledgerEngineStats() {
  return { running: started, entries: entries.length }
}

/** Clear all entries (tests / admin). */
export function resetLedger() {
  entries = []
  seq = 0
}
