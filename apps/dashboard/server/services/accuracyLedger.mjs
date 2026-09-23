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
import { getBrokerData } from "./brokers/index.mjs"

export const LEDGER_CAP = 1000
export const RESOLVE_INTERVAL_MS = 5000
export const RESOLVE_GRACE_MS = 2000
export const MAX_PENDING_MS = 10 * 60 * 1000
export const PUSH_TOL = 0.0002

let entries = [] // oldest first; newest appended at the end
let seq = 0
let timer = null
let started = false
let resolveConsumer = () => {} // ceremony R3.1: per-resolved-row consumer, default no-op

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
    engine: d.engine ?? "legacy", // REQ-STG-1/2: which engine produced the decision (ADR-0004)
    venueClass: d.venueClass ?? null,
    provenance: d.provenance ?? "real", // "sim" must opt in — real is the spendable default (ceremony R2.1)
    status: "pending",
    result: null,
    entryPrice: null,
    exitPrice: null,
    resolvedAt: null
  }
  // Sample the entry price from the live 60s buffer if available (best-effort).
  // Anchored to the decision's own timestamp so a late re-log can never
  // capture a post-signal close (audit §5.6 look-ahead guard).
  const data = getBrokerData()
  const asset = (data?.assets ?? []).find((a) => a.id === d.assetId || a.name === d.asset)
  const candles = asset?.periods?.[60] ?? []
  const sampled = sampleEntryPrice(candles, { at: d.ts ?? now, price: d.price })
  entry.entryPrice = sampled.price
  entry.entryCandleTime = sampled.candleTime
  entries.push(entry)
  if (entries.length > LEDGER_CAP) entries = entries.slice(entries.length - LEDGER_CAP)
  return entry
}

/**
 * Sample the entry price for a decision WITHOUT look-ahead (audit §5.6).
 *
 * The authoritative price is an explicit signal-time fill (`price`) when the
 * caller has one. Otherwise the newest candle whose bar opened at-or-before the
 * decision's own timestamp is used — a decision re-logged late (queued loop,
 * clock skew) must never pick up a close that printed AFTER the signal fired.
 *
 * @param {Array} candles OHLC rows with numeric `.time` (unix SECONDS) + `.close`
 * @param {{at?: number, price?: number|null}} opts `at` = decision ts (ms)
 * @returns {{price: number|null, candleTime: number|null}}
 */
export function sampleEntryPrice(candles, { at = Date.now(), price = null } = {}) {
  const preferred = Number(price)
  if (Number.isFinite(preferred) && preferred > 0) return { price: preferred, candleTime: null }
  const atSec = Math.floor(Number(at) / 1000)
  if (!Number.isFinite(atSec) || atSec <= 0) return { price: null, candleTime: null }
  const eligible = (Array.isArray(candles) ? candles : []).filter(
    (c) => c && Number.isFinite(Number(c.close)) && Number(c.close) > 0 && Number(c.time) <= atSec
  )
  if (!eligible.length) return { price: null, candleTime: null }
  const last = eligible[eligible.length - 1]
  return { price: Number(last.close), candleTime: Number(last.time) }
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
  const data = getBrokerData()
  const asset = (data?.assets ?? []).find((a) => a.id === assetId || a.name === assetName)
  const candles = asset?.periods?.[60] ?? []
  if (!candles.length) return null
  // Candle times are unix SECONDS while `at` (expiresAt) is epoch MS — compare
  // like with like. The old ms-vs-seconds comparison always matched the first
  // (newest) candle, so "price at expiry" was actually "current price".
  const atSec = Math.floor(Number(at) / 1000)
  const covering = [...candles].reverse().find((c) => Number(c.time) <= atSec)
  return Number((covering ?? candles[candles.length - 1]).close)
}

/** Register the resolve consumer — invoked once per decided (hit/miss/push) row after each flush batch. */
export function registerResolveConsumer(fn) {
  resolveConsumer = fn
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
  for (const e of resolved) {
    try {
      resolveConsumer({ entry: e, verdict: e.result })
    } catch {
      /* a resolve-consumer failure must never break the ledger flush */
    }
  }
  return resolved
}

export function ledgerHistory(limit = 200) {
  return entries.slice(-limit).reverse()
}

/**
 * REQ-STG-1/2 (ADR-0004) — correctly-answered (hit/miss) resolution counts per
 * engine per expiry, over the shared ledger. Pushes are EXCLUDED: a push is not
 * a correct answer, so it never dilutes the flip-gate ratio. Pending/unresolved
 * rows never count. This is the aggregate clock's per-engine table.
 */
export function correctlyAnsweredByEngine() {
  const map = new Map() // `${engine}|${expirySec}` -> { engine, expiry, hits, misses, total }
  for (const e of entries) {
    if (e.status !== "resolved") continue
    if (e.result !== "hit" && e.result !== "miss") continue
    const engine = e.engine ?? "legacy"
    const expiry = String(e.expirySec ?? "?")
    const key = `${engine}|${expiry}`
    let row = map.get(key)
    if (!row) {
      row = { engine, expiry, hits: 0, misses: 0, total: 0 }
      map.set(key, row)
    }
    row.total++
    if (e.result === "hit") row.hits++
    else row.misses++
  }
  return [...map.values()]
}

/** EV per 1 unit staked: hit pays b (fraction), miss loses the stake. */
const realizedEvTerm = (e) => (e.result === "hit" ? (Number(e.payout) || 0) / 100 : e.result === "push" ? 0 : -1)

export function ledgerStats() {
  const resolved = entries.filter((e) => e.status === "resolved" && e.result !== "unresolved")
  const hits = resolved.filter((e) => e.result === "hit").length
  const misses = resolved.filter((e) => e.result === "miss").length
  const pushes = resolved.filter((e) => e.result === "push").length
  const decided = hits + misses + pushes
  const hitRate = hits + misses > 0 ? hits / (hits + misses) : null
  // Both sides are now fractions of stake: realized = p·b − (1−p), predicted
  // comes from evGate in the same units. The old mix compared percent against
  // fraction, making the engine's honesty metric meaningless (~×100 off).
  const realizedEv = decided
    ? resolved.reduce((a, e) => a + realizedEvTerm(e), 0) / decided
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
    b.realizedEv += realizedEvTerm(e)
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
 * Phase 15 — per-asset performance breakdown. Groups resolved ledger entries
 * by asset so you can see whether the engine is genuinely better on some
 * instruments rather than trusting one blended number.
 */
export function perAssetStats() {
  const resolved = entries.filter((e) => e.status === "resolved" && e.result !== "unresolved")
  const map = new Map()
  for (const e of resolved) {
    const key = String(e.asset || e.assetId || "UNKNOWN").toUpperCase()
    let b = map.get(key)
    if (!b) {
      b = { asset: key, n: 0, hits: 0, misses: 0, pushes: 0, predWin: 0, realEv: 0 }
      map.set(key, b)
    }
    b.n++
    if (e.result === "hit") b.hits++
    else if (e.result === "miss") b.misses++
    else b.pushes++
    b.predWin += e.winProb ?? 0
    b.realEv += realizedEvTerm(e)
  }
  const rows = [...map.values()].map((b) => ({
    asset: b.asset,
    n: b.n,
    hits: b.hits,
    misses: b.misses,
    pushes: b.pushes,
    hitRate: b.hits + b.misses > 0 ? Math.round((b.hits / (b.hits + b.misses)) * 10000) / 10000 : null,
    predictedWin: b.n ? Math.round((b.predWin / b.n) * 10000) / 10000 : null,
    realizedEv: b.n ? Math.round((b.realEv / b.n) * 10000) / 10000 : null
  }))
  rows.sort((a, b2) => b2.n - a.n)
  return { ok: true, assets: rows }
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
    en.realEv += realizedEvTerm(e)
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
      // Percent payout -> fraction of stake, matching engine EV units.
      de.realEv += d.result === "win" ? pay / 100 : d.result === "loss" ? -1 : 0
    } else {
      const amt = Number(d.amount)
      const profit = Number(d.profit)
      if (Number.isFinite(amt) && Number.isFinite(profit) && amt > 0) de.realEv += profit / amt
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
    if (Number.isFinite(pay)) return a + (d.result === "win" ? pay / 100 : d.result === "loss" ? -1 : 0)
    const amt = Number(d.amount)
    const profit = Number(d.profit)
    return a + (Number.isFinite(amt) && Number.isFinite(profit) && amt > 0 ? profit / amt : 0)
  }, 0)

  const enginePredEv = resolved.length ? resolved.reduce((a, e) => a + (e.ev ?? 0), 0) / resolved.length : null
  const engineRealEv = resolved.length ? resolved.reduce((a, e) => a + realizedEvTerm(e), 0) / resolved.length : null

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
