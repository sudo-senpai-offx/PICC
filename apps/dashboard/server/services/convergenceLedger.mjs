// Convergence outcome ledger (spec 9a) — the accuracy-ledger pattern applied
// to the MTF convergence engine.
//
// The convergence engine's only actionable output is its directional STATE
// (LONG/SHORT WATCH | ONLY | BIAS). Each time a directional state appears at a
// decision point — per asset, on STATE CHANGE, so a state that merely persists
// across section ticks is not re-recorded as a new decision — this ledger keeps
// a pending entry carrying the state, its preset ladder, the 5-scale score,
// quality/confidence and the entry price sampled at decision time. A flush pass
// then resolves each entry against the price observed at/after its resolution
// horizon (default 30 minutes after the read):
//
//   LONG*  -> exit > entry = hit   (price moved the announced way)
//   SHORT* -> exit < entry = hit
//   ~unchanged (PUSH_TOL) = push; the other way = miss; no exit data = kept
//   pending up to a cap, then UNRESOLVED — never guessed.
//
// `resolveResult` and `exitPriceFor` are imported verbatim from
// `accuracyLedger.mjs`, so both ledgers measure wins identically and the 9a
// buckets stay comparable to the decision-engine's phase-15 stats. Hit-rate
// only counts decided (hit + miss) entries. The EV term assumes even-money
// unless a venue payout fraction was recorded at decision time.
import { getBrokerData } from "./brokers/index.mjs"
import { exitPriceFor, resolveResult } from "./accuracyLedger.mjs"

export const CONV_LEDGER_CAP = 1000
export const CONV_HORIZON_MS = 30 * 60 * 1000 // resolve 30m after the read
export const CONV_MAX_PENDING_MS = 12 * 60 * 60 * 1000 // 12h cap before unresolved

let entries = [] // oldest first; newest appended at the end
let seq = 0
let timer = null
let started = false

/** Direction a convergence state announces, or null when it carries none. */
export function directionOfState(state) {
  if (typeof state !== "string") return null
  const s = state.trim().toUpperCase()
  if (s.startsWith("LONG")) return "up"
  if (s.startsWith("SHORT")) return "down"
  return null
}

/**
 * Record one convergence decision (state emitted at decision time).
 * Rejected (returns null) when the state has no direction to follow — WAIT /
 * NO TRADE are not price calls — or when the exact same state × preset is
 * already pending for the asset (a persisted state is not a new decision).
 * Best-effort entry-price sample from the live 60s buffer, mirroring the
 * accuracy ledger; a missing sample means the entry can only resolve as
 * unresolved, never guessed.
 */
export function recordConvergence(d, now = Date.now()) {
  if (!d || d.state == null) return null
  const state = String(d.state).trim().toUpperCase()
  const direction = d.direction ?? directionOfState(state)
  const assetId = d.assetId ?? d.asset
  if (!direction || !assetId) return null
  const asset = d.asset ?? d.assetId
  const preset = d.preset != null ? String(d.preset) : "?"
  const lastOpen = [...entries].reverse().find((e) => e.assetId === assetId && e.status === "pending")
  if (lastOpen && lastOpen.state === state && lastOpen.preset === preset) return null

  const entry = {
    id: ++seq,
    assetId: String(assetId),
    asset: String(asset ?? assetId),
    state,
    direction,
    preset,
    score5: d.score5 ?? null,
    quality: d.quality ?? null,
    confidence: d.confidence ?? null,
    // Payout as a percent (e.g. 85 for 85%). null -> even-money assumption.
    payoutPct: d.payoutPct != null ? Number(d.payoutPct) : null,
    ts: now,
    resolveAt: now + Number(d.horizonMs ?? CONV_HORIZON_MS),
    status: "pending",
    result: null,
    entryPrice: null,
    exitPrice: null,
    resolvedAt: null
  }
  try {
    const data = getBrokerData()
    const bt = (data?.assets ?? []).find((a) => a.id === entry.assetId || a.name === entry.asset)
    const candles = bt?.periods?.[60] ?? []
    if (candles.length) entry.entryPrice = Number(candles[candles.length - 1].close ?? null)
  } catch {
    /* no live layer available — the entry resolves as unresolved, honestly */
  }
  entries.push(entry)
  if (entries.length > CONV_LEDGER_CAP) entries = entries.slice(entries.length - CONV_LEDGER_CAP)
  return entry
}

/**
 * Resolve matured pending entries. Pure against injected `resolve`; the
 * default reuse of accuracyLedger.exitPriceFor resolves against the price
 * observed at/after the entry's resolveAt (same covering-candle rule).
 */
export function flushConvergence({ now = Date.now(), resolve = null } = {}) {
  const resolved = []
  const staleAt = now - CONV_MAX_PENDING_MS
  for (const e of entries) {
    if (e.status !== "pending") continue
    if (e.ts < staleAt) {
      e.status = "unresolved" // expired without resolvable data — never guessed
      e.resolvedAt = now
      continue
    }
    if (e.resolveAt > now) continue
    const price = resolve ? resolve(e) : exitPriceFor(e.assetId, e.asset, e.resolveAt)
    if (price == null) continue // no data yet — stay pending until the cap
    const r = resolveResult(e.direction, e.entryPrice, price)
    e.status = r.outcome === "unresolved" ? "unresolved" : "resolved"
    e.result = r.outcome
    e.exitPrice = price
    e.resolvedAt = now
    if (r.outcome !== "unresolved") resolved.push(e)
  }
  return resolved
}

export function convergenceLedgerHistory(limit = 200) {
  return entries.slice(-limit).reverse()
}

/** EV per 1 unit staked on the state: hit pays the venue payout (even-money
 * when none was recorded), miss loses the stake, push is a round-trip. */
const evTerm = (e) => (e.result === "hit" ? (e.payoutPct != null ? e.payoutPct / 100 : 1) : e.result === "miss" ? -1 : 0)

function tally(b, e) {
  b.n++
  if (e.result === "hit") b.hits++
  else if (e.result === "miss") b.misses++
  else b.pushes++
}

function finalize(b) {
  b.hitRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : null
  b.realizedEv = b.n ? b.realizedEv / b.n : null
  return b
}

/** Bucketed report: totals + win-rate / realized EV by state, by preset,
 * and by state × preset (R12). Only decided entries are bucketed. */
export function convergenceLedgerStats() {
  const decided = entries.filter((e) => e.status === "resolved" && e.result !== "unresolved")
  const hits = decided.filter((e) => e.result === "hit").length
  const misses = decided.filter((e) => e.result === "miss").length
  const pushes = decided.filter((e) => e.result === "push").length
  const resolved = decided.length
  const byState = {}
  const byPreset = {}
  const byStatePreset = {}
  for (const e of decided) {
    const s = byState[e.state] ?? (byState[e.state] = { n: 0, hits: 0, misses: 0, pushes: 0, realizedEv: 0 })
    tally(s, e)
    s.realizedEv += evTerm(e)
    const p = byPreset[e.preset] ?? (byPreset[e.preset] = { n: 0, hits: 0, misses: 0, pushes: 0, realizedEv: 0 })
    tally(p, e)
    p.realizedEv += evTerm(e)
    const key = `${e.state} × ${e.preset}`
    const sp = byStatePreset[key] ?? (byStatePreset[key] = { n: 0, hits: 0, misses: 0, pushes: 0, realizedEv: 0 })
    tally(sp, e)
    sp.realizedEv += evTerm(e)
  }
  for (const k of Object.keys(byState)) finalize(byState[k])
  for (const k of Object.keys(byPreset)) finalize(byPreset[k])
  for (const k of Object.keys(byStatePreset)) finalize(byStatePreset[k])
  return {
    total: entries.length,
    pending: entries.filter((e) => e.status === "pending").length,
    unresolved: entries.filter((e) => e.status === "unresolved").length,
    resolved,
    decided: resolved,
    hits,
    misses,
    pushes,
    hitRate: hits + misses > 0 ? hits / (hits + misses) : null,
    realizedEv: resolved ? decided.reduce((a, e) => a + evTerm(e), 0) / resolved : null,
    byState,
    byPreset,
    byStatePreset
  }
}

function loop() {
  try {
    flushConvergence()
  } catch {
    /* the resolve loop must never crash the server */
  }
}

export function startConvergenceLedger(intervalMs = 30000) {
  if (started) return
  started = true
  clearInterval(timer)
  timer = setInterval(loop, intervalMs)
  timer.unref?.()
}

export function stopConvergenceLedger() {
  started = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function convergenceLedgerEngineStats() {
  return { running: started, entries: entries.length }
}

/** Clear all entries (tests / admin). */
export function resetConvergenceLedger() {
  entries = []
  seq = 0
}