// v3.2 Layer 0 — Constitution (always-on). Spec:
// docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md §2 + §1 (a) cadence.
//
// Nothing executes real money until the Constitution gates pass (REQ-CON-2/3),
// and no confidence number exists without sample size + cost-adjusted
// expectancy (REQ-CON-5). This module is the aggregate global sample clock
// (REQ-CON-1): counts are DERIVED from the shared accuracy-ledger entries on
// demand — there is deliberately no second counter that could drift. Day-key
// truth is imported from u4faRisk (one UTC 00:00 GMT boundary, Decision B).
//
// Engine-awareness: entries carry `engine: "legacy"|"v3.2"` (wired in T11); the
// aggregation seam accepts an engine filter so per-engine expectancies can feed
// the flip gate without a parallel store.
import { dayKeyOf, utcDayStartMs } from "./u4faRisk.mjs"

// --- Locked floors (REQ-CON-2 / REQ-CON-3) ----------------------------------
export const REQ_CON_2_DEPLOYABLE_FLOOR = 300 // 300+ deployable samples before real money unlocks
export const REQ_CON_3_FORWARD_FLOOR = 500 // 500+ forward (walked-forward) samples to keep real-money edge claims

// --- REQ-CON-4 constants (seeds; thresholds re-derived via deriveEvRRFloor) --
export const PAYOUT_MARGIN = 1.15 // REQ-CON-4 margin check retained from adaptiveConfluence.mjs:50
export const EV_RR_MIN = 2 // REQ-CON-4 seed; re-derived floor via deriveEvRRFloor once the ledger is deep

// Honesty-label map: every exported constant reports which REQ it implements.
const CONSTITUTION_SOURCES = Object.freeze({
  REQ_CON_2_DEPLOYABLE_FLOOR: "REQ-CON-2 (300+ deployable samples)",
  REQ_CON_3_FORWARD_FLOOR: "REQ-CON-3 (500+ forward samples)",
  PAYOUT_MARGIN: "REQ-CON-4 margin check (adaptiveConfluence.mjs:50)",
  EV_RR_MIN: "REQ-CON-4 seed floor, re-derived from ledger once deep"
})

/** Honesty label for a Constitution constant — non-empty for every exported knob. */
export function constitutionSourceOf(name) {
  return CONSTITUTION_SOURCES[name] ?? "UNVERIFIED — no spec mapping"
}

// --- Aggregate sample clock --------------------------------------------------

const decided = (e) =>
  Boolean(e) && e.status === "resolved" && (e.result === "hit" || e.result === "miss" || e.result === "push")

/**
 * REQ-CON-1 aggregate sample clock — one UTC-day share per venue/asset meeting
 * the volume-reliability bar. Purely derived from ledger rows: two junctions
 * over the same `entries` agree (no drift). `engine` filters to one engine tag
 * (T11 seam); null means the cross-engine aggregate.
 */
export function aggregateDayState({ entries = [], now = Date.now(), engine = null } = {}) {
  const dayKey = dayKeyOf(now)
  const byExpiry = {}
  let total = 0
  for (const e of entries) {
    if (!decided(e)) continue
    if (engine != null && (e.engine ?? "legacy") !== engine) continue // untagged rows default to legacy (matches correctlyAnsweredByEngine)
    const ts = Number(e.entryTs)
    if (!Number.isFinite(ts) || ts <= 0) continue // unparseable timestamp → excluded, never assumed "today" (G2)
    if (dayKeyOf(ts) !== dayKey) continue
    const k = String(e.expirySec ?? "?")
    byExpiry[k] ??= { n: 0, hits: 0, misses: 0, pushes: 0, hitRate: null }
    const b = byExpiry[k]
    b.n++
    if (e.result === "hit") b.hits++
    else if (e.result === "miss") b.misses++
    else b.pushes++
    total++
  }
  for (const k of Object.keys(byExpiry)) {
    const b = byExpiry[k]
    b.hitRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : null
  }
  return {
    dayKey,
    utcStartMs: utcDayStartMs(dayKey),
    total,
    deployable: total,
    forward: total,
    byExpiry
  }
}

// --- REQ-CON-2/3 real-money gates -------------------------------------------

/**
 * Real-money floor (REQ-CON-2/3). Paper/demo always open — callers decide; this
 * only answers whether the aggregate clock has unlocked real-money execution.
 * AND-composed: every unmet floor contributes a stable, greppable reason. FAILS
 * CLOSED on non-finite counts: a NaN/undefined/string sample count is treated
 * as 0 (never bypasses — the gate can only open on honest numbers).
 */
export function gateConstitution({ deployable = 0, forward = 0 } = {}) {
  const dep = Number(deployable)
  const fwd = Number(forward)
  const safe = (v) => (Number.isFinite(v) ? v : 0)
  const depSafe = safe(dep)
  const fwdSafe = safe(fwd)
  const reasons = []
  if (depSafe < REQ_CON_2_DEPLOYABLE_FLOOR) {
    reasons.push(`require ${REQ_CON_2_DEPLOYABLE_FLOOR} deployable samples (have ${depSafe})`)
  }
  if (fwdSafe < REQ_CON_3_FORWARD_FLOOR) {
    reasons.push(`require ${REQ_CON_3_FORWARD_FLOOR} forward samples (have ${fwdSafe})`)
  }
  return { ok: reasons.length === 0, reasons, deployable: depSafe, forward: fwdSafe }
}

// --- REQ-CON-4 cost-adjusted EV gate ----------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)

/**
 * REQ-CON-4 / L9 cost-adjusted EV. The gross payout is reduced by the spread
 * model (1.5-pip default, in pips) + slippage (pips), both converted into
 * payout-percent units with `pipValuePct` (fraction of stake per pip). The
 * breakeven/margin check then runs on the COSTED payout — costs are never
 * netted invisibly. `line` is the explicit HUD cost line; rejecting reasons
 * cite the numbers. Contract mirrors adaptiveConfluence.evGate (line 360) so
 * the two gates can be compared 1:1 during the soak.
 */
export function costAdjustedEv({ winProb, payoutPct, spreadPips = 1.5, slippagePips = 0, pipValuePct = 0.01, marginPct = PAYOUT_MARGIN, evRRMin = EV_RR_MIN } = {}) {
  const p = Number(winProb)
  const pay = Number(payoutPct)
  const pip = Number(pipValuePct)
  if (!Number.isFinite(p) || !Number.isFinite(pay) || p <= 0 || p >= 1 || pay <= 0 || !Number.isFinite(pip) || pip <= 0) {
    return { ev: null, netPayoutPct: null, breakevenPayout: null, payoutBeats: false, evRR: null, evRRPass: false, costPct: null, line: null }
  }
  const costPips = Number(spreadPips) + Number(slippagePips)
  if (!Number.isFinite(costPips) || costPips < 0) {
    // Costs are NEVER silently zeroed: non-numeric or negative spread/slippage
    // fails the gate closed (L9 "costs are never netted invisibly").
    return { ev: null, netPayoutPct: null, breakevenPayout: null, payoutBeats: false, evRR: null, evRRPass: false, costPct: null, line: null }
  }
  const costPct = round(costPips * pip * 100, 4) // pips → % of stake → payout-percent units
  const netPayoutPct = round(pay - costPct, 4)
  // Cap the costed payout at a sane floor — costs must never yield negative EV math.
  const usable = Math.max(netPayoutPct, 0)
  const ev = round(p * (usable / 100) - (1 - p), 4)
  const breakevenPayout = round((100 * (1 - p)) / p, 2) // payout % where EV = 0
  const evRR = usable > 0 ? round((p * (usable / 100)) / ((1 - p) * 1), 4) : 0
  return {
    ev,
    netPayoutPct: round(netPayoutPct, 2),
    breakevenPayout,
    payoutBeats: netPayoutPct >= breakevenPayout * marginPct,
    evRR,
    evRRPass: evRR >= evRRMin,
    costPct,
    line: {
      payoutPct: pay,
      spreadPips: Number(spreadPips),
      slippagePips: Number(slippagePips),
      marginPct,
      netPayoutPct: round(netPayoutPct, 2),
      evRRMin
    }
  }
}

/**
 * REQ-CON-4 — the EV-RR threshold re-derived from the shared ledger's
 * correct-answer table instead of the hardcoded seed. Realized EV-RR =
 * hit-weighted payout per miss unit, aggregated across ALL expiry buckets as
 * (Σ hits·payout/100) / (Σ misses) — the aggregate ratio, never the sum of
 * per-bucket ratios. `derived:false` is returned (never silent) when the table
 * is too thin or ANY bucket has zero misses (unbounded EV-RR for that bucket
 * inflates the derived floor past honesty). `samples` always reports the full
 * table's decided count.
 */
export function deriveEvRRFloor({ byExpiry = {} } = {}, { minSamples = 50 } = {}) {
  let totalHits = 0
  let totalMisses = 0
  let payoutWeightedHits = 0
  for (const b of Object.values(byExpiry)) {
    if (!b || !b.n) continue
    const hits = Number(b.hits) || 0
    const misses = Number(b.misses) || 0
    totalHits += hits
    totalMisses += misses
    if (misses === 0) {
      // Any zero-miss bucket makes the aggregate EV-RR unbounded → honest fallback.
      return { derived: false, evRRFloor: EV_RR_MIN, samples: totalHits + totalMisses }
    }
    const pay = Number(b.payout) || 82 // REQ-CON-4: observed payout where available; else conservative 82
    payoutWeightedHits += hits * (Number(pay) / 100)
  }
  const n = totalHits + totalMisses
  if (n < minSamples) return { derived: false, evRRFloor: EV_RR_MIN, samples: n }
  return { derived: true, evRRFloor: round(totalMisses > 0 ? payoutWeightedHits / totalMisses : EV_RR_MIN, 2), samples: n }
}

// --- REQ-CON-5 confidence shape ----------------------------------------------

/**
 * REQ-CON-5 — confidence is ONLY { sampleSize, costAdjustedExpectancy }. Any
 * caller smuggling a standalone %/score/percentile field is a spec violation
 * and throws: no confidence number exists without sample + expectancy.
 */
export function confidenceShape({ sampleSize, costAdjustedExpectancy, ...extra } = {}) {
  const banned = Object.keys(extra)
  if (banned.length) {
    throw new Error(`REQ-CON-5: standalone "${banned.join(", ")}" banned from decision confidence (must be sampleSize + costAdjustedExpectancy only)`)
  }
  const n = Number(sampleSize)
  const e = Number(costAdjustedExpectancy)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) throw new Error("REQ-CON-5: sampleSize required (positive integer)")
  if (!Number.isFinite(e)) throw new Error("REQ-CON-5: costAdjustedExpectancy required (finite)")
  return { sampleSize: n, costAdjustedExpectancy: e }
}

// --- REQ-STG-3 flip gate -----------------------------------------------------

/**
 * Realized cost-adjusted expectancy of one engine from its correctly-answered
 * ledger rows: EV per $1 staked over the resolved distribution, with the
 * conservative 82 payout standing in for unobserved payouts. Push rows are
 * excluded upstream (`correctlyAnsweredByEngine` drops them), so this is a
 * hit/miss-only expectancy on decided trades.
 */
function expectancyOf(rows, engine, payout = 82) {
  const rowsOf = (Array.isArray(rows) ? rows : []).filter((r) => r?.engine === engine)
  if (!rowsOf.length) return null
  let stake = 0
  let ev = 0
  for (const r of rowsOf) {
    const total = Number(r.total) || 0
    const hits = Number(r.hits) || 0
    const misses = Number(r.misses) || 0
    stake += total
    ev += hits * (payout / 100) - misses // per $1: wins pay b/100, losses lose the stake
  }
  return stake > 0 ? ev / stake : null
}

/**
 * REQ-STG-3 — the parallel-soak flip gate. Flips (ok) only when BOTH engines
 * have ≥ minTrades paper decisions AND the candidate's realized cost-adjusted
 * expectancy ≥ the legacy path's in the same window. Equality counts as a flip
 * (new cost-adjusted expectancy ≥ old, per REQ-STG-3/ADR-0004); underperformance
 * or insufficient counting on EITHER side holds legacy. `reason` is stable and
 * greppable. The ~2–4-week soak elapse is an external time condition (checked by
 * the operator), not a numeric gate here.
 */
export function flipGate({ rows = [], legacy = "legacy", candidate = "v3.2", minTrades = 100, payout = 82 } = {}) {
  const legacyExpectancy = expectancyOf(rows, legacy, payout)
  const candidateExpectancy = expectancyOf(rows, candidate, payout)
  const countOf = (engine) => (Array.isArray(rows) ? rows : []).filter((r) => r?.engine === engine).reduce((a, r) => a + (Number(r.total) || 0), 0)
  const legacyTrades = countOf(legacy)
  const candidateTrades = countOf(candidate)
  if (candidateExpectancy == null || legacyExpectancy == null) {
    return { flip: false, reason: "no decided rows for one engine — soak not comparable", legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades }
  }
  if (candidateTrades < minTrades) {
    return { flip: false, reason: `candidate under ${minTrades} paper trades`, legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades }
  }
  if (legacyTrades < minTrades) {
    return { flip: false, reason: `legacy under ${minTrades} paper trades`, legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades }
  }
  if (candidateExpectancy < legacyExpectancy) {
    return { flip: false, reason: "candidate cost-adjusted expectancy below legacy", legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades }
  }
  return { flip: true, reason: `candidate expectancy ≥ legacy with ≥ ${minTrades} paper trades each`, legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades }
}