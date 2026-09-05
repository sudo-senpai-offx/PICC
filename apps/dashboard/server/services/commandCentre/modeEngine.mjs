// Command Centre — L5 Mode Engine (PICC_SPEC: Command Centre Web §L5).
//
// Per-site accountable verdict in FIXED order, every step additive and
// deterministic given its inputs:
//   1. kill switch + per-site opt-in            → BLOCKED / COPILOT-only
//   2. risk-manager gate (breakers + site cap)  → BLOCKED with breaker named
//   3. stale-data (5E)                          → forced HOLD with feeds named
//   4. ToS-survival (5C, automationPermission)  → forbidden=BLOCKED, gray=COPILOT
//   5. automation-workability (deterministic)   → below floor = COPILOT at most
//   6. deliberation evidence (edge-trust weighted) — slice 3; slice 2 emits
//      an honest "not-yet-available" (+ no mode change) rather than faking one
//   7. LLM/advisory input                       → DOWNGRADE-ONLY (5H): an advisory
//      can push a mode down, never up; an upgrade attempt is rejected + audited;
//      advisory outage leaves the deterministic verdict untouched.
//
// Pure function of inputs — no I/O, no timers. The verdict is the *cap* the
// engine assigns to the site; actual execution additionally passes the Safety
// Sidecar pre-action gate (slice 2, same phase).

import { templateForSite } from "./policyGraphCatalog.mjs"

export const MODES = Object.freeze(["BLOCKED", "HOLD", "COPILOT", "AUTOPILOT_DEMO", "AUTOPILOT"])

/** Higher rank = more execution power. Used for downgrade caps. */
export const MODE_RANK = Object.freeze(Object.fromEntries(MODES.map((m, i) => [m, i])))

/** The execution power each mode carries. */
export const EXECUTION_POWER = Object.freeze({
  BLOCKED: "none",
  HOLD: "none",
  COPILOT: "proposals",
  AUTOPILOT_DEMO: "liveDemo",
  AUTOPILOT: "live"
})

/** Deterministic automation-workability floor for autopilot (spec §L5 step 5). */
export const AUTOPILOT_WORKABILITY_FLOOR = 0.5

/** One-notch downgrade ladder used by 5H advisory downgrades. */
const DOWNGRADE_TO = Object.freeze({
  AUTOPILOT: "COPILOT",
  AUTOPILOT_DEMO: "COPILOT",
  COPILOT: "HOLD",
  HOLD: "BLOCKED",
  BLOCKED: "BLOCKED"
})

function cap(mode, ceiling) {
  return MODE_RANK[mode] <= MODE_RANK[ceiling] ? mode : ceiling
}

/**
 * Render the per-site verdict. `inputs` (all optional):
 *   killSwitch           bool — global kill switch
 *   optIn                bool — per-site opt-in (required for live autopilot)
 *   breakers             { dailyLossHalted, regimeHalted, siteCapped } booleans
 *   staleFeeds           [{ name, ageSec, maxAgeSec }] — 5E; only numerically
 *                        comparable entries can trip staleness (absent cap = no
 *                        assertion), every entry is surfaced regardless
 *   workability          number 0..1 — deterministic automation-workability score
 *   deliberation         null (slice 2) | evidence object (slice 3)
 *   advisory             { direction: "down"|"up", reason } | null (5H)
 *   advisoryUnavailable  bool — LLM outage; verdict must not change
 *   demoActive           bool — existing (paper/demo) autopilot running this site
 *   breadcrumbs          array — agent findings that mattered (slice 3 feeds)
 */
export function renderVerdict(siteOrTemplate, inputs = {}) {
  const template =
    typeof siteOrTemplate === "string" ? templateForSite(siteOrTemplate) : siteOrTemplate
  if (!template) return { ok: false, error: `unknown site template: ${String(siteOrTemplate)}` }

  const reasons = []
  const audit = []
  let mode = "AUTOPILOT" // optimistic start — every gate may only lower it

  // ── 1. kill switch + per-site opt-in ──────────────────────────────────────
  if (inputs.killSwitch === true) {
    mode = "BLOCKED"
    reasons.push("global kill switch is ON (mode engine step 1)")
    audit.push({ kind: "kill-switch", mode })
  }
  const liveOptIn = inputs.optIn === true
  if (mode !== "BLOCKED" && !liveOptIn && template.automationPermission === "sanctioned") {
    mode = cap(mode, "COPILOT")
    reasons.push("live autopilot requires per-site opt-in — never silent (user story 5)")
  }

  // ── 2. risk-manager gate (breakers + site cap) ────────────────────────────
  const breakers = inputs.breakers ?? {}
  if (breakers.dailyLossHalted === true) {
    mode = "BLOCKED"
    reasons.push("daily-loss breaker tripped (risk-manager gate)")
  }
  if (breakers.regimeHalted === true) {
    mode = "BLOCKED"
    reasons.push("regime-shift breaker tripped (risk-manager gate)")
  }
  if (breakers.siteCapped === true) {
    mode = "BLOCKED"
    reasons.push("per-site risk cap reached (risk-manager gate)")
  }

  // ── 3. stale-data forced downgrade (5E) ───────────────────────────────────
  const staleFeeds = Array.isArray(inputs.staleFeeds) ? inputs.staleFeeds : []
  const stale = staleFeeds.filter(
    (f) =>
      f && typeof f.ageSec === "number" && typeof f.maxAgeSec === "number" && f.ageSec > f.maxAgeSec
  )
  if (stale.length > 0) {
    mode = cap(mode, "HOLD")
    for (const f of stale) {
      reasons.push(`stale feed ${f.name}: age ${f.ageSec}s > cap ${f.maxAgeSec}s — forced HOLD (5E)`)
    }
  }

  // ── 4. ToS-survival (5C truth table, per-site) ────────────────────────────
  if (template.automationPermission === "forbidden") {
    mode = cap(mode, "BLOCKED")
    reasons.push("venue forbids automation — per-site truth table (5C)")
  } else if (template.automationPermission === "gray") {
    mode = cap(mode, "COPILOT")
    reasons.push("gray venue — proposals only, never autopilot (5C)")
  }

  // ── 5. automation-workability (deterministic) ─────────────────────────────
  const workability =
    typeof inputs.workability === "number" && Number.isFinite(inputs.workability)
      ? inputs.workability
      : 0
  if (workability < AUTOPILOT_WORKABILITY_FLOOR) {
    mode = cap(mode, "COPILOT")
    reasons.push(
      `automation workability ${workability} below floor ${AUTOPILOT_WORKABILITY_FLOOR} (deterministic)`
    )
  }

  // ── 6. deliberation evidence (slice 3) ────────────────────────────────────
  const deliberation = inputs.deliberation ?? null
  if (deliberation === null) {
    reasons.push("deliberation evidence not yet available (slice 3) — deterministic-only verdict")
  } else {
    // Slice 3 wires the convergence detector here; evidence may adjust the
    // verdict, but never above what the deterministic gates have allowed.
    reasons.push(`deliberation evidence considered (mode unchanged in slice 2)`)
  }

  // ── 7. LLM/advisory input — downgrade-only (5H) ───────────────────────────
  const advisory = inputs.advisory
  if (advisory && typeof advisory.direction === "string") {
    if (advisory.direction === "down") {
      const lowered = DOWNGRADE_TO[mode] ?? mode
      if (lowered !== mode) {
        audit.push({
          kind: "advisory-downgrade",
          from: mode,
          to: lowered,
          reason: advisory.reason ?? null
        })
        mode = lowered
        reasons.push(`advisory downgrade: ${advisory.reason ?? "LLM advisory (5H)"}`)
      }
    } else if (advisory.direction === "up") {
      audit.push({
        kind: "advisory-upgrade-REJECTED",
        proposedFrom: mode,
        reason: advisory.reason ?? null
      })
      reasons.push("advisory upgrade attempt rejected — downgrade-only (5H)")
    }
  } else if (inputs.advisoryUnavailable === true) {
    reasons.push("LLM/advisory unavailable — deterministic verdict unchanged (5H)")
  }

  // ── demo vs live layer ─────────────────────────────────────────────────────
  const demoAllowed = template.demoOnly === true
  const demoActive = inputs.demoActive === true
  if (demoActive && demoAllowed && mode !== "BLOCKED" && mode !== "HOLD") {
    mode = "AUTOPILOT_DEMO"
    reasons.push("demo autopilot active on this site (AUTOPILOT(demo), paper surface)")
  }

  return {
    ok: true,
    site: template.site,
    mode,
    executionPower: EXECUTION_POWER[mode],
    demoAllowed,
    reason: reasons,
    breadcrumbs: Array.isArray(inputs.breadcrumbs) ? inputs.breadcrumbs : [],
    deliberation: deliberation === null ? "not-yet-available" : deliberation,
    audit
  }
}