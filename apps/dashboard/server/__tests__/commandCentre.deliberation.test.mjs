import { describe, expect, test } from "vitest"
import {
  DEFAULT_CONVERGENCE_DELTA,
  DEFAULT_MAX_ROUNDS,
  deliberate,
  strongestPath
} from "../services/commandCentre/deliberation.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"

const ccxt = () => templateForSite("trading:ccxt")
const expertoption = () => templateForSite("expertoption")

/** One finding per source arm, all conveying the same side — a balanced board. */
function uniformFindings(side, strength = 1, overrides = {}) {
  return {
    news_sentiment: { agentId: "news_sentiment", side, strength },
    technical: { agentId: "technical", side, strength },
    regime: { agentId: "regime", side, strength },
    volatility: { agentId: "volatility", side, strength },
    order_flow: { agentId: "order_flow", side, strength },
    whale_onchain: { agentId: "whale_onchain", side, strength },
    ...overrides
  }
}

describe("Command Centre — Deliberation: topology hops", () => {
  test("a hop-2 source's finding visibly lands one round after the hop-1 sources", () => {
    // bandwidth: uptime_node →(1:1) daily_quest →(1:1) payout, credential →(1:1) payout
    // BFS from payout: credential/daily_quest at hop 1, uptime_node at hop 2.
    const g = templateForSite("bandwidth:browser")
    const r = deliberate({
      graph: g,
      decisionNode: "payout",
      findings: [
        { agentId: "credential", side: 1, strength: 1 }, // hop 1
        { agentId: "daily_quest", side: 1, strength: 1 }, // hop 1
        { agentId: "uptime_node", side: -1, strength: 0.1 } // hop 2 — arrives late, opposes
      ],
      maxRounds: 4,
      convergenceDelta: 0.05
    })
    // r1: both hop-1 +1 → surface 1.0; r2: uptime's late −0.1 lands → weighted average
    // (1+1−0.1)/2.1 ≈ 0.905 (same-sign contributions cannot move a weighted average —
    // the surface only shifts when the late voice OPPOSES); r3: quiet → converged.
    // The timeline is the proof the hop-2 finding arrived at round 2, early-stopped at 3.
    expect(r.convergence).toBe("converged")
    expect(r.roundsUsed).toBe(3)
    expect(r.timeline.map((s) => Math.round(s * 1000) / 1000)).toEqual([1, 0.905, 0.905])
    expect(r.unlanded).toEqual([])
  })

  test("helpers are exported and deterministic", () => {
    expect(typeof strongestPath).toBe("function")
    const g = ccxt()
    // technical→consensus is a direct edge: 1 hop, path trust 1
    expect(strongestPath(g, "technical", "consensus", () => 1)).toBe(1)
    // the decision node itself has no PATH at all — the empty-path product is
    // exactly 1.0 (nothing to walk, trivially trusted); the ENGINE keeps such
    // self-evidence from ever landing via the h===0 unlanding rule.
    expect(strongestPath(g, "consensus", "consensus", () => 1)).toBe(1)
  })

  test("an all-ready hub reaches consensus via pure neutral findings — settled at 0 until a side lands", () => {
    const g = ccxt()
    const r = deliberate({
      graph: g,
      decisionNode: "consensus",
      findings: [
        { agentId: "technical", side: 0, strength: 1 },
        { agentId: "regime", side: 1, strength: 0.3 }
      ],
      maxRounds: 3,
      convergenceDelta: 0.1
    })
    // regime is a direct hop-1 arm too: both land in round 1, only regime is
    // directional → surface 1.0, then stable → converged in round 2.
    expect(r.convergence).toBe("converged")
    expect(r.surface).toBe(1.0)
  })
})

describe("Command Centre — Deliberation: edge-trust seam (P-METALEARNING feed)", () => {
  test("edgeTrust(edgeId) multiplies into path trust — a distrusted arm carries proportionally less", () => {
    const g = ccxt()
    const distrust = () => 0.2 // every arm heavily distrusted (metalearning outcome)
    const r = deliberate({
      graph: g,
      decisionNode: "consensus",
      findings: [
        { agentId: "technical", side: 1, strength: 1 },
        { agentId: "regime", side: 1, strength: 1 }
      ],
      maxRounds: 3,
      convergenceDelta: 0.05,
      edgeTrust: distrust
    })
    // equal sides, equal distrust → surface still +1 (direction preserved), but
    // each contribution is scaled by 0.2 — the surface magnitude of a trust-
    // starved board stays honest (weighted average, not absolute power).
    expect(r.surface).toBeCloseTo(1, 3)
    for (const c of r.contributions) expect(c.contribution).toBeCloseTo(0.2, 3)
  })

  test("edge.trust (catalog-declared) multiplies with the metalearning seam", () => {
    const g = {
      site: "test:graph",
      stream: "trading",
      venue: "test",
      automationPermission: "sanctioned",
      demoOnly: false,
      roster: ["alpha", "beta", "hub"],
      edges: [
        { id: "e1", from: "alpha", to: "hub", topology: "N:1", purpose: "evidence leg", trust: 0.5 },
        { id: "e2", from: "beta", to: "hub", topology: "N:1", purpose: "evidence leg", trust: 2 }
      ],
      loops: [{ node: "hub", maxRounds: 2, convergenceDelta: 0.05 }],
      envelope: { mode: "copilot" },
      protocols: ["P-GROUNDING"]
    }
    const r = deliberate({
      graph: g,
      decisionNode: "hub",
      findings: [
        { agentId: "alpha", side: 1, strength: 1 },
        { agentId: "beta", side: 1, strength: 1 }
      ],
      maxRounds: 2,
      convergenceDelta: 0.05,
      edgeTrust: (id) => (id === "e1" ? 0.5 : 1.0)
    })
    // alpha: 0.5 × 0.5 = 0.25 · beta: 2 × 1 = 2 → surface (0.25 + 2) / (0.25 + 2)… equal sides
    // → +1; the weighted average keeps direction but the contributions prove the scaling.
    expect(r.convergence).toBe("converged")
    const byAgent = Object.fromEntries(r.contributions.map((c) => [c.agentId, c.contribution]))
    expect(byAgent.alpha).toBeCloseTo(0.25, 3)
    expect(byAgent.beta).toBeCloseTo(2, 3)
    expect(r.surface).toBeCloseTo(1, 3)
  })

  test("strongest path wins on an N:N web — distrusted short path, trusted long path", () => {
    const g = {
      site: "test:nn",
      stream: "trading",
      venue: "test",
      automationPermission: "sanctioned",
      demoOnly: false,
      roster: ["alpha", "relay", "hub"],
      edges: [
        { id: "short", from: "alpha", to: "hub", topology: "N:N", purpose: "direct leg" },
        { id: "a-relay", from: "alpha", to: "relay", topology: "N:N", purpose: "long leg out" },
        { id: "relay-hub", from: "relay", to: "hub", topology: "N:N", purpose: "long leg in" }
      ],
      loops: [{ node: "hub", maxRounds: 2, convergenceDelta: 0.05 }],
      envelope: { mode: "copilot" },
      protocols: ["P-GROUNDING"]
    }
    // short path distrusted (0.1), long path trusted (0.9 × 0.9) → the strong
    // route wins for trust; hops still measure the SHORTEST distance (alpha lands
    // round 1 regardless of which path carries the trust).
    const r = deliberate({
      graph: g,
      decisionNode: "hub",
      findings: [{ agentId: "alpha", side: 1, strength: 1 }],
      maxRounds: 2,
      convergenceDelta: 0.05,
      edgeTrust: (id) => (id === "short" ? 0.1 : 0.9)
    })
    expect(r.contributions[0].trust).toBeCloseTo(0.81, 3) // 0.9 × 0.9 beats 0.1
    expect(r.roundsUsed).toBe(2) // alpha lands round 1, even through the long leg
  })
})

describe("Command Centre — Deliberation: solar-consensus convergence detector", () => {
  test("a board that all points one way converges quickly (surface stops moving)", () => {
    const g = ccxt()
    const findings = Object.values(uniformFindings(1))
    const r = deliberate({ graph: g, decisionNode: "consensus", findings, maxRounds: 5, convergenceDelta: 0.05 })
    expect(r.convergence).toBe("converged")
    expect(r.roundsUsed).toBeGreaterThan(1) // not instant — the delta needs a first movement to be measured
    expect(r.roundsUsed).toBeLessThanOrEqual(r.maxRounds)
    expect(r.surface).toBeCloseTo(1, 3) // all +1, balanced weights → +1
  })

  test("a board that is still swinging on the maxRounds cutoff reports non-converged (divergence cutoff)", () => {
    // bandwidth payout board: credential/daily_quest at hop 1, uptime_node at hop 2.
    // The late hop-2 arrival swings the surface again while the 2-round budget is
    // already spent → honest non-converged (P-BOUNDED-LOOPS divergence cutoff).
    const g = templateForSite("bandwidth:browser")
    const findings = [
      { agentId: "credential", side: 1, strength: 1 },
      { agentId: "daily_quest", side: -1, strength: 0.5 },
      { agentId: "uptime_node", side: 1, strength: 1 }
    ]
    const r = deliberate({ graph: g, decisionNode: "payout", findings, maxRounds: 2, convergenceDelta: 0.05 })
    expect(r.roundsUsed).toBe(2)
    expect(r.maxRounds).toBe(2)
    expect(r.convergence).toBe("non-converged")
    // r1: (1 − 0.5) / 1.5 = 0.333 · r2: (1 − 0.5 + 1) / 2.5 = 0.6 → still moving at the cut
    expect(r.timeline.map((s) => Math.round(s * 1000) / 1000)).toEqual([0.333, 0.6])
  })

  test("the loop config on the graph is used when no overrides are passed (never infinite)", () => {
    const g = ccxt()
    const r = deliberate({
      graph: g,
      decisionNode: "consensus",
      findings: Object.values(uniformFindings(1))
    })
    // ccxt consensus loop: maxRounds 3, convergenceDelta 0.05
    expect(r.maxRounds).toBe(DEFAULT_MAX_ROUNDS)
    expect(r.maxRounds).toBe(3)
    expect(r.convergenceDelta).toBe(DEFAULT_CONVERGENCE_DELTA)
  })

  test("graph loop overrides the DEFAULT_LOOP for that node", () => {
    const g = expertoption()
    const r = deliberate({
      graph: g,
      decisionNode: "model_matrix",
      findings: [{ agentId: "technical", side: 1, strength: 1 }]
    })
    expect(r.maxRounds).toBe(2) // expertoption model_matrix loop
  })

  test("neutral board converges when nothing moves (surface 0 < delta)", () => {
    const g = ccxt()
    // regulatory whitelist (regime→consensus) + technical all neutral-side
    const findings = [
      { agentId: "technical", side: 0, strength: 1 },
      { agentId: "regime", side: 0, strength: 1 }
    ]
    const r = deliberate({ graph: g, decisionNode: "consensus", findings, maxRounds: 3, convergenceDelta: 0.05 })
    expect(r.convergence).toBe("converged")
    expect(r.surface).toBe(0)
  })
})

describe("Command Centre — Deliberation: honesty surfaces", () => {
  test("findings from an agent with no edge into the decision node are reported unlanded, never dropped", () => {
    const g = ccxt()
    const r = deliberate({
      graph: g,
      decisionNode: "consensus",
      findings: [{ agentId: "not_an_agent", side: 1, strength: 1 }]
    })
    expect(r.unlanded.map((u) => u.agentId)).toEqual(["not_an_agent"])
    expect(r.unlanded[0].reason).toContain("no path")
    expect(r.surface).toBe(0) // the foreign finding never becomes fabricated evidence
  })

  test("P-GROUNDING: findings carry their source + cutoff through the board", () => {
    const g = ccxt()
    const r = deliberate({
      graph: g,
      decisionNode: "consensus",
      findings: [{ agentId: "technical", side: 1, strength: 1, source: "indicators", cutoff: "2026-09-05" }]
    })
    expect(r.contributions[0].source).toBe("indicators")
    expect(r.contributions[0].cutoff).toBe("2026-09-05")
  })

  test("breadcrumbs are the top-N non-neutral contributions, descending by |contribution|", () => {
    const g = ccxt()
    const findings = [
      { agentId: "technical", side: 1, strength: 1 },
      { agentId: "regime", side: -1, strength: 0.9 }
    ]
    const r = deliberate({ graph: g, decisionNode: "consensus", findings, maxRounds: 3, convergenceDelta: 0.05 })
    expect(r.breadcrumbs.length).toBeGreaterThan(0)
    const contribs = r.breadcrumbs.map((b) => Math.abs(b.contribution))
    expect([...contribs].sort((a, b) => b - a)).toEqual(contribs) // descending
  })
})