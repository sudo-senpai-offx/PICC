// Command Centre — L4↔L5 Metalearning tuner (PICC_SPEC: P-METALEARNING).
//
// The Meta-Optimizer learns *how to learn*: settled outcomes calibrate per-edge
// trust, which the Deliberation engine's surface weighting consumes (strongest
// path × edgeTrust(edgeId)).
//
// Floor-proof by construction: this module's entire surface is
//   edgeTrust · applyOutcome · revertLastOutcome · setTrust
// plus the test reset. There is NO function here that accepts or returns an
// envelope bound, a breaker flag, an audit toggle or any sidecar invariant —
// the export whitelist is enforced by a test (PICC.md §11: "The sidecar's own
// invariants are outside metalearning/self-improvement reach").
//
// Outcome-gated: `applyOutcome` REFUSES any input without `settled: true` — an
// unresolved decision can never mutate weights (spec: "operates on discovery
// time never live-money time"). Every applied update returns an audit event
// { before, after, outcome } and is recorded for revert; `revertLastOutcome`
// restores the exact prior trust. Bounds [0.2, 3.0] keep any single outcome
// from ever dominating the board.

const MIN_TRUST = 0.2
const MAX_TRUST = 3.0
const HIT_FACTOR = 1.05
const MISS_FACTOR = 0.95
const ROUND = 10000 // 4 decimals — deterministic, no float noise

let registry = new Map() // edgeId -> current trust (absent = default 1.0)
let outcomeHistory = [] // [{ edgeId, outcome, before, after, at }] — revert stack
let tuneHistory = [] // manual discovery-time tunes (NOT reverted by revertLastOutcome)

function clampTrust(v) {
  return Math.round(Math.min(MAX_TRUST, Math.max(MIN_TRUST, v)) * ROUND) / ROUND
}

/** Current trust for an edge; uncalibrated edges default to 1.0 (neutral). */
export function edgeTrust(edgeId) {
  return registry.has(edgeId) ? registry.get(edgeId) : 1.0
}

/**
 * Apply ONE settled outcome to an edge's trust.
 *   { edgeId, outcome: "hit"|"miss"|"push", settled: true, at? }
 * Rejected (no state change) unless settled — outcome-gated, floor-proof.
 * Returns { ok, before, after } — the audit event fields.
 */
export function applyOutcome({ edgeId, outcome, settled, at } = {}) {
  if (typeof edgeId !== "string" || !edgeId) {
    return { ok: false, error: "edgeId required" }
  }
  if (settled !== true) {
    return { ok: false, error: "outcome not settled — unresolved decisions can never mutate weights" }
  }
  const factor =
    outcome === "hit" ? HIT_FACTOR : outcome === "miss" ? MISS_FACTOR : outcome === "push" ? 1 : null
  if (factor === null) {
    return { ok: false, error: `outcome must be hit|miss|push, got ${JSON.stringify(outcome)}` }
  }
  const before = edgeTrust(edgeId)
  const after = clampTrust(before * factor)
  registry.set(edgeId, after)
  outcomeHistory.push({ edgeId, outcome, before, after, at: at ?? Date.now() })
  return { ok: true, before, after }
}

/** Revert the most recent OUTCOME update to its exact prior trust. */
export function revertLastOutcome() {
  const last = outcomeHistory.pop()
  if (!last) return { ok: false, error: "no outcome update to revert" }
  if (last.before === last.after) return { ok: true, reverted: last } // no-op restore
  registry.set(last.edgeId, last.before)
  return { ok: true, reverted: last }
}

/**
 * Direct discovery-time tuning (spec: metalearning "operates on discovery time
 * never live-money time"). Clamped into [MIN_TRUST, MAX_TRUST]; audited in its
 * own history (NOT reverting with revertLastOutcome — only outcome-gated
 * updates are reverted).
 */
export function setTrust(edgeId, trust) {
  if (typeof edgeId !== "string" || !edgeId) {
    return { ok: false, error: "edgeId required" }
  }
  if (!(typeof trust === "number" && Number.isFinite(trust))) {
    return { ok: false, error: `trust must be a finite number, got ${JSON.stringify(trust)}` }
  }
  const before = edgeTrust(edgeId)
  const after = clampTrust(trust)
  if (trust < MIN_TRUST || trust > MAX_TRUST) {
    return {
      ok: false,
      error: `trust ${trust} outside [${MIN_TRUST}, ${MAX_TRUST}] — a single tune can never dominate`
    }
  }
  registry.set(edgeId, after)
  tuneHistory.push({ edgeId, before, after, at: Date.now() })
  return { ok: true, before, after }
}

/** Test seam only — wipe all calibrated state back to defaults. */
export function _resetMetalearning() {
  registry = new Map()
  outcomeHistory = []
  tuneHistory = []
}