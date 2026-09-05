// Command Centre — policy-graph validator (PICC_SPEC: Command Centre Web §L2).
//
// Pure, deterministic validation of catalog templates against the protocols:
//   P-PURPOSE         every edge declares a real purpose; no dangling/typed-
//                     less/purposeless relations (edges referencing agents
//                     outside the roster or unknown topologies carry no
//                     declared meaning → rejected)
//   P-SPECIFICITY     one task per agent; duplicate roster ids or duplicated
//                     task strings inside one template are rejected
//   P-BOUNDED-LOOPS   every loop is finite (missing maxRounds/convergenceDelta
//                     falls back to DEFAULT_LOOP; explicit nonsense bounds are
//                     rejected — a loop can never be unbounded)
//   5C                ToS-survival truth table: a site may never declare more
//                     execution than its automationPermission allows
//                     (forbidden ⇒ demo/blocked only; gray ⇒ copilot at most)
//   5D                envelope values present must be sane positive bounds
//                     (null = "not applicable to this stream", never 0/"∞")
//
// Collects ALL violations (no fail-fast) so a template can be fixed in one pass.

import { AGENT_REGISTRY } from "./agentRoster.mjs"
import {
  DEFAULT_LOOP,
  ENVELOPE_MODES,
  PERMISSIONS,
  POLICY_GRAPH_CATALOG,
  PROTOCOLS,
  TOPOLOGIES
} from "./policyGraphCatalog.mjs"

const PLACEHOLDER_PURPOSE = /^(tbd|todo|x|\?|n\/a|na|connect|link|edge)$/i

export function validatePolicyGraph(template, { registry = AGENT_REGISTRY } = {}) {
  const errors = []
  const site = template?.site ?? "(missing site)"

  // ── SHAPE: structural basics ────────────────────────────────────────────
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    return { ok: false, errors: [{ code: "SHAPE", site, message: "template is not an object" }] }
  }
  for (const field of ["site", "stream", "venue"]) {
    if (typeof template[field] !== "string" || !template[field].trim()) {
      errors.push({ code: "SHAPE", site, message: `${field} must be a non-empty string` })
    }
  }
  if (typeof template.demoOnly !== "boolean") {
    errors.push({ code: "SHAPE", site, message: "demoOnly must be a boolean" })
  }

  // ── 5C: ToS-survival truth table ────────────────────────────────────────
  if (!PERMISSIONS.includes(template.automationPermission)) {
    errors.push({
      code: "5C",
      site,
      message: `automationPermission must be one of ${PERMISSIONS.join(", ")} (got ${JSON.stringify(template.automationPermission)})`
    })
  }

  // ── roster (P-SPECIFICITY) ───────────────────────────────────────────────
  const roster = template.roster
  if (!Array.isArray(roster) || roster.length === 0) {
    errors.push({ code: "P-SPECIFICITY", site, message: "roster must be a non-empty array of agent ids" })
  } else {
    const seenIds = new Set()
    const seenTasks = new Set()
    for (const id of roster) {
      if (seenIds.has(id)) {
        errors.push({ code: "P-SPECIFICITY", site, message: `duplicate agent id in roster: ${id}` })
        continue
      }
      seenIds.add(id)
      const agent = registry[id]
      if (!agent) {
        errors.push({ code: "P-SPECIFICITY", site, message: `roster references unregistered agent: ${id}` })
        continue
      }
      const task = String(agent.task ?? "").trim()
      if (!task) {
        errors.push({ code: "P-SPECIFICITY", site, message: `agent ${id} has no task declared` })
      } else if (seenTasks.has(task)) {
        errors.push({
          code: "P-SPECIFICITY",
          site,
          message: `duplicate task across roster: "${task}" (agents must not overlap)`
        })
      }
      seenTasks.add(task)
    }
  }

  // ── edges (P-PURPOSE) ─────────────────────────────────────────────────────
  if (!Array.isArray(template.edges)) {
    errors.push({ code: "P-PURPOSE", site, message: "edges must be an array" })
  } else {
    const inRoster = new Set(roster || [])
    const seenEdges = new Set()
    for (const [i, e] of template.edges.entries()) {
      const label = `edge[${i}]`
      if (!e || typeof e !== "object") {
        errors.push({ code: "P-PURPOSE", site, message: `${label} is not an object` })
        continue
      }
      if (!inRoster.has(e.from)) {
        errors.push({ code: "P-PURPOSE", site, message: `${label} from "${e.from}" is not in the roster` })
      }
      if (!inRoster.has(e.to)) {
        errors.push({ code: "P-PURPOSE", site, message: `${label} to "${e.to}" is not in the roster` })
      }
      if (!TOPOLOGIES.includes(e.topology)) {
        errors.push({
          code: "P-PURPOSE",
          site,
          message: `${label} topology must be one of ${TOPOLOGIES.join(", ")} (got ${JSON.stringify(e.topology)})`
        })
      }
      const purpose = typeof e.purpose === "string" ? e.purpose.trim() : ""
      if (purpose.length < 4 || PLACEHOLDER_PURPOSE.test(purpose)) {
        errors.push({
          code: "P-PURPOSE",
          site,
          message: `${label} (${e.from}→${e.to}) needs a real purpose, got ${JSON.stringify(e.purpose)}`
        })
      }
      const key = `${e.from}->${e.to}`
      if (seenEdges.has(key)) {
        errors.push({ code: "P-PURPOSE", site, message: `duplicate directed edge ${key}` })
      }
      seenEdges.add(key)
    }
  }

  // ── loops (P-BOUNDED-LOOPS) ───────────────────────────────────────────────
  if (!Array.isArray(template.loops)) {
    errors.push({ code: "P-BOUNDED-LOOPS", site, message: "loops must be an array" })
  } else {
    const inRoster = new Set(roster || [])
    for (const [i, loop] of template.loops.entries()) {
      const label = `loop[${i}]`
      if (!loop || typeof loop !== "object") {
        errors.push({ code: "P-BOUNDED-LOOPS", site, message: `${label} is not an object` })
        continue
      }
      if (!inRoster.has(loop.node)) {
        errors.push({ code: "P-BOUNDED-LOOPS", site, message: `${label} node "${loop.node}" is not in the roster` })
      }
      if (loop.maxRounds !== undefined && !(Number.isInteger(loop.maxRounds) && loop.maxRounds >= 1)) {
        errors.push({
          code: "P-BOUNDED-LOOPS",
          site,
          message: `${label} maxRounds must be an integer ≥ 1 (default ${DEFAULT_LOOP.maxRounds}), got ${JSON.stringify(loop.maxRounds)}`
        })
      }
      if (loop.convergenceDelta !== undefined &&
          !(typeof loop.convergenceDelta === "number" && loop.convergenceDelta > 0 && loop.convergenceDelta <= 1)) {
        errors.push({
          code: "P-BOUNDED-LOOPS",
          site,
          message: `${label} convergenceDelta must be in (0, 1] (default ${DEFAULT_LOOP.convergenceDelta}), got ${JSON.stringify(loop.convergenceDelta)}`
        })
      }
    }
  }

  // ── envelope (5C / 5D) ─────────────────────────────────────────────────────
  const env = template.envelope
  if (!env || typeof env !== "object") {
    errors.push({ code: "5D", site, message: "envelope must be an object" })
  } else {
    const mode = env.mode
    if (!ENVELOPE_MODES.includes(mode)) {
      errors.push({
        code: "5D",
        site,
        message: `envelope.mode must be one of ${ENVELOPE_MODES.join(", ")} (got ${JSON.stringify(mode)})`
      })
    }
    if (template.demoOnly && mode !== "demo") {
      errors.push({ code: "5C", site, message: "demoOnly templates must declare envelope.mode = demo" })
    }
    if (template.automationPermission === "forbidden" && !["demo", "blocked"].includes(mode)) {
      errors.push({
        code: "5C",
        site,
        message: `forbidden site must declare mode demo|blocked, got ${JSON.stringify(mode)} — a forbidden venue can never autopilot`
      })
    }
    if (template.automationPermission === "gray" && !["copilot", "demo", "blocked"].includes(mode)) {
      errors.push({
        code: "5C",
        site,
        message: `gray site must declare mode copilot|demo|blocked, got ${JSON.stringify(mode)} — gray never autopilots`
      })
    }
    const numChecks = [
      ["maxExposureUsd", v => typeof v === "number" && Number.isFinite(v) && v > 0],
      ["maxConcurrent", v => Number.isInteger(v) && v >= 1],
      ["maxDailyLossPct", v => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100]
    ]
    for (const [field, ok] of numChecks) {
      const v = env[field]
      if (v !== null && v !== undefined && !ok(v)) {
        errors.push({
          code: "5D",
          site,
          message: `${field} must be a positive finite ${field === "maxDailyLossPct" ? "percent ≤ 100" : "bound"} or null (n/a), got ${JSON.stringify(v)}`
        })
      }
    }
  }

  // ── protocols ──────────────────────────────────────────────────────────────
  const protocols = template.protocols
  if (!Array.isArray(protocols) || protocols.length === 0) {
    errors.push({ code: "SHAPE", site, message: "protocols must be a non-empty array" })
  } else {
    for (const p of protocols) {
      if (!PROTOCOLS.includes(p)) {
        errors.push({ code: "SHAPE", site, message: `unknown protocol ${JSON.stringify(p)}` })
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/** Validate the whole shipped catalog — every shipped template must be clean. */
export function validateCatalog({ catalog = POLICY_GRAPH_CATALOG } = {}) {
  const results = catalog.map((t) => ({ site: t.site, ...validatePolicyGraph(t) }))
  return {
    ok: results.every((r) => r.ok),
    results
  }
}