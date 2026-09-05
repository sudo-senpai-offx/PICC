// Command Centre — L4 Deliberation engine (PICC_SPEC: Command Centre Web §L4).
//
// The blackboard. Given a validated catalog graph (a site template) and a
// decision node, agents' findings land on the board by TOPOLOGY: a finding
// reaches the decision point after `hops` rounds, where hops = shortest path
// length from its agent to the decision node over the typed edges (1:1, 1:N,
// N:N, N:1). Every round the engine re-measures the collective verdict
// SURFACE — the edge-trust-weighted directional average of every landed
// finding. Convergence detector (P-BOUNDED-LOOPS): when the surface moved less
// than `convergenceDelta` since the previous round → converged, early-stop.
// When `maxRounds` is exhausted while the surface is still swinging ≥ delta →
// honest `non-converged` (divergence cutoff) — surfaced as an output, never
// papered over; the Mode Engine (slice 3 wiring) treats it conservatively.
//
// Pure function of inputs: no I/O, no timers, no randomness. Everything is
// deterministic given the same graph + findings, so every case is a plain
// assertion in the test suite.
//
// `absent → null` (P-GROUNDING): a finding whose agent has NO path to the
// decision node never lands but is REPORTED in `unlanded` — it is never
// silently dropped and never fabricated as evidence.

import { DEFAULT_LOOP } from "./policyGraphCatalog.mjs"

export const DEFAULT_MAX_ROUNDS = DEFAULT_LOOP.maxRounds
export const DEFAULT_CONVERGENCE_DELTA = DEFAULT_LOOP.convergenceDelta

/** Bounded workability shift the Mode Engine may apply from evidence (slice 3). */
export const MAX_WORKABILITY_SHIFT = 0.1

/**
 * Shortest-path hops from every roster agent to the decision node, walking
 * edges REVERSED (a finding flows along edges toward the decision point, so
 * hop distance = graph distance from agent to the node).
 */
function hopsByAgent(graph, decisionNode) {
  const roster = new Set(graph.roster ?? [])
  const reverseAdj = {}
  for (const e of graph.edges ?? []) {
    if (e && typeof e.from === "string" && typeof e.to === "string") {
      ;(reverseAdj[e.to] ??= []).push(e.from)
    }
  }
  const hops = {}
  const seen = new Set([decisionNode])
  const queue = [[decisionNode, 0]]
  while (queue.length > 0) {
    const [node, d] = queue.shift()
    hops[node] = d
    for (const src of reverseAdj[node] ?? []) {
      if (!seen.has(src) && roster.has(src)) {
        seen.add(src)
        queue.push([src, d + 1])
      }
    }
  }
  return hops // roster agents absent from this map have no path (unlanded)
}

/**
 * Trust product along an agent's STRONGEST path to the decision node: the
 * maximum over all simple paths of Π(edge.trust × edgeTrust(edgeId)). The
 * strongest route wins (best-supported evidence); `edgeTrust` is the
 * outcome-gated metalearning seam, default identity. Exported for tests and
 * for tools that want to reason about a single path.
 */
export function strongestPath(graph, agentId, decisionNode, edgeTrust = () => 1) {
  const out = {}
  for (const e of graph.edges ?? []) {
    if (e && typeof e.from === "string" && typeof e.to === "string") {
      ;(out[e.from] ??= []).push(e)
    }
  }
  let best = 0
  const visited = new Set()
  function walk(node, productSoFar) {
    if (node === decisionNode) {
      if (productSoFar > best) best = productSoFar
      return
    }
    if (visited.has(node)) return // cycle-safe: simple paths only
    visited.add(node)
    for (const e of out[node] ?? []) {
      walk(e.to, productSoFar * (e.trust ?? 1) * edgeTrust(e.id))
    }
    visited.delete(node)
  }
  walk(agentId, 1)
  return best
}

/**
 * Trust product along an agent's STRONGEST path to the decision node: the
 * maximum over all simple paths of Π(edge.trust × edgeTrust(edgeId)). The
 * strongest route wins (best-supported evidence); `edgeTrust` is the
 * outcome-gated metalearning seam, default identity.
 */
function strongestPathTrust(graph, agentId, decisionNode, edgeTrust) {
  return strongestPath(graph, agentId, decisionNode, edgeTrust)
}

/** Weighted directional average over landed findings; neutral (side 0) excluded. */
function surfaceOf(landed) {
  let numerator = 0
  let denominator = 0
  for (const f of landed) {
    if (f.side === 0) continue
    const weight = f.weight * f.trust
    numerator += f.side * f.strength * weight
    denominator += f.strength * weight
  }
  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * Deliberate toward one decision node.
 *
 *   graph             validated site template ({site, roster, edges, loops…})
 *   decisionNode      agent id where findings converge (a loop node)
 *   findings          [{ agentId, side: 1|-1|0, strength: 0..1, source?, cutoff? }]
 *   maxRounds         loop override; falls back to the node's loop config, then
 *                     DEFAULT_LOOP (never infinite — P-BOUNDED-LOOPS)
 *   convergenceDelta  loop override; defaults like maxRounds
 *   edgeTrust         (edgeId) => number — metalearning seam, default 1
 *
 * Returns { ok, convergence, roundsUsed, maxRounds, convergenceDelta, surface,
 * timeline, contributions, breadcrumbs, unlanded }.
 */
export function deliberate({
  graph,
  decisionNode,
  findings = [],
  maxRounds,
  convergenceDelta,
  edgeTrust = () => 1
}) {
  const roster = new Set(graph?.roster ?? [])
  if (!graph || typeof graph !== "object" || !roster.has(decisionNode)) {
    return { ok: false, error: `decisionNode ${String(decisionNode)} is not a roster agent` }
  }
  if (!Array.isArray(findings)) {
    return { ok: false, error: "findings must be an array" }
  }

  const loopConfig =
    (graph.loops ?? []).find((l) => l && l.node === decisionNode) ?? DEFAULT_LOOP
  const rounds = Number.isInteger(maxRounds) && maxRounds >= 1 ? maxRounds : loopConfig.maxRounds
  const delta =
    typeof convergenceDelta === "number" && convergenceDelta > 0 && convergenceDelta <= 1
      ? convergenceDelta
      : loopConfig.convergenceDelta

  const hops = hopsByAgent(graph, decisionNode)

  // Bucket findings by landing round; those with no path are surfaced, not dropped.
  const byRound = {}
  const unlanded = []
  for (const f of findings) {
    if (!f || typeof f.agentId !== "string") {
      unlanded.push({ ...f, reason: "missing agentId" })
      continue
    }
    const h = hops[f.agentId]
    if (h === undefined || !roster.has(f.agentId)) {
      unlanded.push({ ...f, reason: `no path to decision node ${decisionNode}` })
      continue
    }
    if (h === 0) {
      unlanded.push({ ...f, reason: "agent is the decision node itself — no self-evidence" })
      continue
    }
    ;(byRound[h] ??= []).push(f)
  }

  const landed = [] // [{ agentId, side, strength, weight, trust, source, cutoff }]
  const timeline = []
  let convergence = "non-converged"
  let roundsUsed = rounds

  for (let r = 1; r <= rounds; r++) {
    for (const f of byRound[r] ?? []) {
      landed.push({
        agentId: f.agentId,
        side: f.side === 1 || f.side === -1 ? f.side : 0,
        strength: Number.isFinite(f.strength) ? Math.min(1, Math.max(0, f.strength)) : 0,
        weight: 1, // per-agent weight arrives via the edge-trust seam or edge.trust
        trust: strongestPathTrust(graph, f.agentId, decisionNode, edgeTrust),
        source: f.source ?? null,
        cutoff: f.cutoff ?? null
      })
    }
    const surface = surfaceOf(landed)
    const previous = timeline.length > 0 ? timeline[timeline.length - 1] : 0
    const movement = Math.abs(surface - previous)
    timeline.push(surface)
    if (movement < delta) {
      convergence = "converged"
      roundsUsed = r
      break
    }
  }

  const contributions = landed.map((f) => ({
    agentId: f.agentId,
    side: f.side,
    strength: f.strength,
    trust: f.trust,
    source: f.source,
    cutoff: f.cutoff,
    contribution: f.side === 0 ? 0 : f.side * f.strength * f.weight * f.trust
  }))

  return {
    ok: true,
    convergence,
    roundsUsed,
    maxRounds: rounds,
    convergenceDelta: delta,
    surface: timeline.length > 0 ? timeline[timeline.length - 1] : 0,
    timeline,
    contributions,
    breadcrumbs: contributions
      .filter((c) => c.contribution !== 0)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 3)
      .map((c) => ({ agentId: c.agentId, side: c.side, contribution: c.contribution })),
    unlanded
  }
}