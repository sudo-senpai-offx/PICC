// Command Centre — L0 Safety Sidecar (PICC_SPEC: Command Centre Web §L0).
//
// The box the web runs inside. Pre-action gate in FIXED order (the order is
// part of the contract — a later gate can never override an earlier one):
//
//   1. kill switch          — global, unconditional
//   2. cross-site day halt  — a breaker trip on ANY site halts entries
//                             everywhere until the next UTC day
//   3. human takeover (5B)  — deny-all until explicit rearm; re-entry =
//                             a full gate pass
//   4. per-site opt-in      — required for every live action
//   5. hard breakers        — daily-loss / regime / site cap, named
//   6. fresh data (5E)      — stale mandatory feeds block execution
//   7. ToS-survival (5C)    — forbidden venue / gray venue live action
//   8. envelope within ceiling (5D) — single exposure & concurrency & the
//                             cross-site daily-loss ceiling, all from the
//                             site's own envelope (null field = n/a stream)
//   9. rationale renderable (5F) — no action without a stated "why"
//  10. idempotent (5G)      — a duplicate idempotency key is rejected; the
//                             always-on audit trail is the durable key store,
//                             so 5G survives restarts
//
// Every decision (allow AND deny) is appended to the audit trail when an
// `audit` function is injected — there is no configuration that silences it
// (5A execution-power separation).
//
// The sidecar's invariants are outside metalearning/self-improvement reach.

import { dayKeyOf } from "../u4faRisk.mjs"

/** The gate order, declared once and enforced by tests. */
export const GATE_ORDER = Object.freeze([
  "kill-switch",
  "cross-site-day-halt",
  "human-takeover",
  "per-site-opt-in",
  "hard-breakers",
  "fresh-data",
  "toS-survival",
  "envelope-within-ceiling",
  "rationale-renderable",
  "idempotent"
])

/** Minimal rationale length (5F): a stated why must carry actual content. */
export const MIN_RATIONALE_LENGTH = 12

let globalHalt = null // { dayKey, site, breaker }
let takeover = null // { at }
const idempotencyKeys = new Set()

/** Test seam only. */
export function _resetSidecarState() {
  globalHalt = null
  takeover = null
  idempotencyKeys.clear()
}

export function crossSiteHaltState() {
  return globalHalt ? { ...globalHalt } : null
}

export function takeoverState() {
  return takeover ? { ...takeover } : null
}

/**
 * Record a breaker trip — halts all sites for the current UTC day
 * (the riskDayState pattern, generalized cross-site).
 */
export function noteBreakerTrip(site, breaker, { now = Date.now() } = {}) {
  globalHalt = { dayKey: dayKeyOf(now), site, breaker, at: now }
  return { ...globalHalt }
}

/** 5B: immediate human takeover — deny-all until clear/rearm. */
export function humanTakeover({ now = Date.now() } = {}) {
  takeover = { at: now }
  return { ...takeover }
}

export function clearTakeover() {
  takeover = null
}

function staleNames(staleFeeds) {
  return (Array.isArray(staleFeeds) ? staleFeeds : [])
    .filter(
      (f) =>
        f && typeof f.ageSec === "number" && typeof f.maxAgeSec === "number" && f.ageSec > f.maxAgeSec
    )
    .map((f) => f.name)
}

/**
 * Evaluate one action proposal against the sidecar gate. Pure-ish: reads
 * module state (day halt, takeover, idempotency keys) and the injected inputs.
 *
 * proposal = { action, live (bool), exposureUsd, rationale, idempotencyKey }
 * state    = { killSwitch, optIn, breakers:{}, staleFeeds, concurrentUnits,
 *              dayLossPct (cumulative today, cross-site) }
 * template = the site's policy-graph template (envelope + permission)
 * audit    = appendAudit-compatible fn; every decision is audited when present
 */
export function evaluateGate({ template, proposal, state = {}, audit = null }) {
  const site = template?.site ?? "unknown"
  const block = (blockedBy, reason) => {
    if (audit) {
      audit({ site, kind: "safety-gate:deny", data: { action: proposal?.action ?? null, blockedBy, reason } })
    }
    return { allow: false, blockedBy, reason }
  }
  const allow = (reason) => {
    if (audit) {
      audit({ site, kind: "safety-gate:allow", data: { action: proposal?.action ?? null, idempotencyKey: proposal?.idempotencyKey ?? null } })
    }
    return { allow: true, blockedBy: null, reason }
  }

  if (!template) return block("template", "no policy-graph template for this site — cannot gate")
  if (!proposal || typeof proposal !== "object") return block("proposal", "no proposal to gate")

  const action = proposal.action ?? "unknown"
  const isLive = proposal.live !== false

  // ── 1. kill switch ────────────────────────────────────────────────────────
  if (state.killSwitch === true) return block("kill-switch", `global kill switch is ON — ${action} denied`)

  // ── 2. cross-site day halt ────────────────────────────────────────────────
  if (globalHalt && globalHalt.dayKey === dayKeyOf(state.now ?? Date.now())) {
    return block(
      "cross-site-day-halt",
      `breaker "${globalHalt.breaker}" tripped on ${globalHalt.site} — all sites halted until next UTC day`
    )
  }

  // ── 3. human takeover (5B) ───────────────────────────────────────────────
  if (takeover) {
    return block("human-takeover", `human takeover active since ${takeover.at} — re-entry requires a full gate pass (5B)`)
  }

  // ── 4. per-site opt-in ────────────────────────────────────────────────────
  if (isLive && state.optIn !== true) return block("per-site-opt-in", `live ${action} requires per-site opt-in`)

  // ── 5. hard breakers ──────────────────────────────────────────────────────
  const breakers = state.breakers ?? {}
  if (breakers.dailyLossHalted === true) return block("hard-breakers", "daily-loss breaker tripped")
  if (breakers.regimeHalted === true) return block("hard-breakers", "regime-shift breaker tripped")
  if (breakers.siteCapped === true) return block("hard-breakers", "per-site risk cap reached")

  // ── 6. fresh data (5E) ────────────────────────────────────────────────────
  const stale = staleNames(state.staleFeeds)
  if (stale.length > 0) return block("fresh-data", `stale feed(s): ${stale.join(", ")} (5E)`)

  // ── 7. ToS-survival (5C) ──────────────────────────────────────────────────
  const permission = template.automationPermission
  if (permission === "forbidden") {
    // Demo surface on a demoOnly template is the recorded exception (ExpertOption
    // truth-table row); anything else on a forbidden venue is denied outright.
    if (!isLive && template.demoOnly === true) {
      /* demo execution on the demo-only surface — allowed past this gate */
    } else {
      return block("toS-survival", `venue forbids automation (5C) — ${action} denied`)
    }
  }
  if (permission === "gray" && isLive) {
    return block("toS-survival", `gray venue: proposals only, never live execution (5C)`)
  }
  if (!isLive && template.demoOnly !== true) {
    return block("toS-survival", `demo surface not permitted on this site (template.demoOnly is false)`)
  }

  // ── 8. envelope within ceiling (5D) ───────────────────────────────────────
  const env = template.envelope ?? {}
  if (isLive || proposal.exposureUsd != null) {
    const exposure = proposal.exposureUsd ?? 0
    if (env.maxExposureUsd != null && exposure > env.maxExposureUsd) {
      return block("envelope-within-ceiling", `exposure $${exposure} > ceiling $${env.maxExposureUsd} (5D)`)
    }
  }
  if (env.maxConcurrent != null && (state.concurrentUnits ?? 0) >= env.maxConcurrent) {
    return block("envelope-within-ceiling", `concurrent units ${state.concurrentUnits ?? 0} >= ceiling ${env.maxConcurrent} (5D)`)
  }
  if (env.maxDailyLossPct != null && (state.dayLossPct ?? 0) > env.maxDailyLossPct) {
    return block("envelope-within-ceiling", `today's loss ${state.dayLossPct ?? 0}% > ceiling ${env.maxDailyLossPct}% (5D)`)
  }

  // ── 9. rationale renderable (5F) ──────────────────────────────────────────
  const rationale = typeof proposal.rationale === "string" ? proposal.rationale.trim() : ""
  if (rationale.length < MIN_RATIONALE_LENGTH) {
    return block("rationale-renderable", `no renderable rationale — cannot act on an inexplicable decision (5F)`)
  }

  // ── 10. idempotent (5G) ───────────────────────────────────────────────────
  const key = proposal.idempotencyKey
  if (typeof key !== "string" || key.length < 8) {
    return block("idempotent", `idempotencyKey required (>= 8 chars) — repeat/raced actions must be provably unique (5G)`)
  }
  if (auditSeen(key)) {
    return block("idempotent", `duplicate idempotency key ${key} — double-fire prevented (5G)`)
  }
  idempotencyKeys.add(key)

  return allow(`gate passed for ${action} on ${site}`)
}

/**
 * 5G key store = in-memory set + the always-on audit trail (durable across
 * restarts). Production wiring calls wireAuditReader(() => readAudit()); until
 * then the in-memory set is the guard. A reader that throws is treated as
 * "cannot prove uniqueness" → conservatively DENY (fail-safe, never double-fire).
 */
let auditReader = null
export function wireAuditReader(readFn) {
  auditReader = typeof readFn === "function" ? readFn : null
}

function auditSeen(key) {
  if (idempotencyKeys.has(key)) return true
  if (!auditReader) return false
  try {
    return auditReader().some((e) => e.data?.idempotencyKey === key)
  } catch {
    return true // cannot prove uniqueness → deny (fail-safe)
  }
}