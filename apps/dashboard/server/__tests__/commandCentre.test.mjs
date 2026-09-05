import { describe, expect, test } from "vitest"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { AGENT_REGISTRY, plannedAgents, readyAgents } from "../services/commandCentre/agentRoster.mjs"
import {
  POLICY_GRAPH_CATALOG,
  policyGraphSites,
  templateForSite
} from "../services/commandCentre/policyGraphCatalog.mjs"
import { validateCatalog, validatePolicyGraph } from "../services/commandCentre/policyGraphValidator.mjs"

const SERVICES_DIR = fileURLToPath(new URL("../services/", import.meta.url))

/** A valid base template (shipped trading template) for mutation in tests. */
function baseTemplate() {
  return structuredClone(templateForSite("trading:ccxt"))
}

describe("Command Centre — shipped catalog (L2)", () => {
  test("every shipped template validates clean — the catalog never ships broken", () => {
    const { ok, results } = validateCatalog()
    expect(ok).toBe(true)
    for (const r of results) {
      expect(r.errors).toEqual([])
    }
  })

  test("shipped sites are the three truth-table rows", () => {
    expect(policyGraphSites()).toEqual([
      "trading:ccxt",
      "bandwidth:browser",
      "expertoption"
    ])
  })

  test("ExpertOption truth-table row: forbidden permission + demo mode only", () => {
    const t = templateForSite("expertoption")
    expect(t.automationPermission).toBe("forbidden")
    expect(t.demoOnly).toBe(true)
    expect(t.envelope.mode).toBe("demo")
  })

  test("bandwidth envelope honestly declares no capital-exposure numbers", () => {
    const t = templateForSite("bandwidth:browser")
    expect(t.envelope.maxExposureUsd).toBeNull()
    expect(t.envelope.maxDailyLossPct).toBeNull()
  })
})

describe("Command Centre — agent roster (L3, P-SPECIFICITY / P-GROUNDING)", () => {
  test("every ready agent has exactly one task and wired modules that exist", () => {
    const ready = readyAgents()
    expect(Object.keys(ready).length).toBeGreaterThan(0)
    for (const [id, agent] of Object.entries(ready)) {
      expect(typeof agent.task).toBe("string")
      expect(agent.task.trim().length).toBeGreaterThan(0)
      expect(agent.modules.length).toBeGreaterThan(0)
      for (const mod of agent.modules) {
        expect(existsSync(SERVICES_DIR + mod), `${id} → ${mod} must exist`).toBe(true)
      }
    }
  })

  test("planned agents are surfaced as planned, never silently ready", () => {
    const planned = plannedAgents()
    expect(Object.keys(planned).length).toBeGreaterThan(0)
    for (const agent of Object.values(planned)) {
      expect(agent.status).toBe("planned")
      if (agent.modules.length > 0) {
        for (const mod of agent.modules) {
          expect(existsSync(SERVICES_DIR + mod), `planned ${mod} must exist if declared`).toBe(true)
        }
      }
    }
    // trading roster includes the declared-but-not-built whale/on-chain seam
    expect(AGENT_REGISTRY.whale_onchain.status).toBe("planned")
  })

  test("registry ids are unique keys with one task each", () => {
    const ids = Object.keys(AGENT_REGISTRY)
    expect(new Set(ids).size).toBe(ids.length)
    for (const agent of Object.values(AGENT_REGISTRY)) {
      expect(typeof agent.task).toBe("string")
    }
  })
})

describe("Command Centre — validator: P-PURPOSE", () => {
  test("edge without a purpose is rejected", () => {
    const t = baseTemplate()
    t.edges[0] = { from: "technical", to: "consensus", topology: "N:1" }
    const { ok, errors } = validatePolicyGraph(t)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.code === "P-PURPOSE")).toBe(true)
  })

  test("empty and placeholder purposes are rejected", () => {
    for (const purpose of ["", "   ", "tbd", "n/a", "x", "?"]) {
      const t = baseTemplate()
      t.edges[0].purpose = purpose
      const { errors } = validatePolicyGraph(t)
      expect(errors.some((e) => e.code === "P-PURPOSE" && e.message.includes("real purpose"))).toBe(true)
    }
  })

  test("edges referencing agents outside the roster are rejected", () => {
    const t = baseTemplate()
    t.edges[0] = { from: "ghost_agent", to: "consensus", topology: "N:1", purpose: "a structural reason to exist" }
    const { ok, errors } = validatePolicyGraph(t)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.code === "P-PURPOSE" && e.message.includes('from "ghost_agent"'))).toBe(true)
  })

  test("unknown topology is rejected", () => {
    const t = baseTemplate()
    t.edges[0].topology = "2:2"
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "P-PURPOSE" && e.message.includes("topology"))).toBe(true)
  })

  test("duplicate directed edges are rejected", () => {
    const t = baseTemplate()
    t.edges.push({ ...t.edges[0] })
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "P-PURPOSE" && e.message.includes("duplicate directed edge"))).toBe(true)
  })
})

describe("Command Centre — validator: P-SPECIFICITY", () => {
  test("duplicate agent id in roster is rejected", () => {
    const t = baseTemplate()
    t.roster = [...t.roster, "consensus"]
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "P-SPECIFICITY" && e.message.includes("duplicate agent id"))).toBe(true)
  })

  test("duplicate task across a roster is rejected (agents must not overlap)", () => {
    const t = baseTemplate()
    // no overlap in the real registry → clean (edges pruned: reduced roster)
    const clean = validatePolicyGraph({ ...t, roster: ["consensus", "risk_manager"], edges: [] })
    expect(clean.ok).toBe(true)
    // force an overlap by giving two roster agents the same task string
    const customRegistry = {
      ...AGENT_REGISTRY,
      consensus: { ...AGENT_REGISTRY.consensus, task: "same task" },
      risk_manager: { ...AGENT_REGISTRY.risk_manager, task: "same task" }
    }
    const r = validatePolicyGraph({ ...t, roster: ["consensus", "risk_manager"] }, { registry: customRegistry })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === "P-SPECIFICITY" && e.message.includes("duplicate task"))).toBe(true)
  })

  test("unregistered roster agent is rejected", () => {
    const t = baseTemplate()
    t.roster = [...t.roster, "does_not_exist"]
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "P-SPECIFICITY" && e.message.includes("unregistered"))).toBe(true)
  })
})

describe("Command Centre — validator: P-BOUNDED-LOOPS", () => {
  test("explicit nonsense maxRounds is rejected (loop can never be unbounded)", () => {
    for (const maxRounds of [0, -1, 1.5, "many", Number.POSITIVE_INFINITY]) {
      const t = baseTemplate()
      t.loops[0].maxRounds = maxRounds
      const { errors } = validatePolicyGraph(t)
      expect(errors.some((e) => e.code === "P-BOUNDED-LOOPS" && e.message.includes("maxRounds"))).toBe(true)
    }
  })

  test("explicit out-of-range convergenceDelta is rejected", () => {
    for (const delta of [0, -0.1, 1.5, NaN]) {
      const t = baseTemplate()
      t.loops[0].convergenceDelta = delta
      const { errors } = validatePolicyGraph(t)
      expect(errors.some((e) => e.code === "P-BOUNDED-LOOPS" && e.message.includes("convergenceDelta"))).toBe(true)
    }
  })

  test("missing loop bounds fall back to DEFAULT_LOOP — still bounded, still valid", () => {
    const t = baseTemplate()
    t.loops[0] = { node: "consensus" }
    const { ok, errors } = validatePolicyGraph(t)
    expect(ok).toBe(true)
    expect(errors).toEqual([])
  })

  test("loop node outside the roster is rejected", () => {
    const t = baseTemplate()
    t.loops[0].node = "ghost_agent"
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "P-BOUNDED-LOOPS" && e.message.includes("not in the roster"))).toBe(true)
  })
})

describe("Command Centre — validator: 5C ToS-survival truth table", () => {
  test("forbidden site can never declare autopilot", () => {
    const t = baseTemplate()
    t.automationPermission = "forbidden"
    t.envelope.mode = "autopilot"
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "5C" && e.message.includes("forbidden venue can never autopilot"))).toBe(true)
  })

  test("gray site can never declare autopilot", () => {
    const t = baseTemplate()
    t.automationPermission = "gray"
    t.envelope.mode = "autopilot"
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "5C" && e.message.includes("gray never autopilots"))).toBe(true)
  })

  test("demo-only template must declare demo mode", () => {
    const t = baseTemplate()
    t.demoOnly = true
    t.envelope.mode = "autopilot"
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "5C" && e.message.includes("demoOnly"))).toBe(true)
  })

  test("invalid automationPermission value is rejected", () => {
    const t = baseTemplate()
    t.automationPermission = "sure_why_not"
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "5C" && e.message.includes("automationPermission"))).toBe(true)
  })
})

describe("Command Centre — validator: 5D envelope sanity", () => {
  test("zero/negative/absent-positive envelope bounds are rejected", () => {
    const bad = [
      { field: "maxExposureUsd", value: 0 },
      { field: "maxExposureUsd", value: -5 },
      { field: "maxConcurrent", value: 0 },
      { field: "maxConcurrent", value: 2.5 },
      { field: "maxDailyLossPct", value: 0 },
      { field: "maxDailyLossPct", value: 101 },
      { field: "maxDailyLossPct", value: -1 }
    ]
    for (const { field, value } of bad) {
      const t = baseTemplate()
      t.envelope[field] = value
      const { errors } = validatePolicyGraph(t)
      expect(errors.some((e) => e.code === "5D" && e.message.includes(field))).toBe(true)
    }
  })

  test("explicit null = not applicable — valid where the stream has no capital", () => {
    const t = templateForSite("bandwidth:browser")
    expect(t.envelope.maxExposureUsd).toBeNull()
    const { ok } = validatePolicyGraph(t)
    expect(ok).toBe(true)
  })

  test("unknown envelope mode is rejected", () => {
    const t = baseTemplate()
    t.envelope.mode = "autopilot-live-baby"
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "5D" && e.message.includes("envelope.mode"))).toBe(true)
  })
})

describe("Command Centre — validator: shape + protocols", () => {
  test("missing site/stream/venue are structural rejections", () => {
    for (const field of ["site", "stream", "venue"]) {
      const t = baseTemplate()
      delete t[field]
      const { errors } = validatePolicyGraph(t)
      expect(errors.some((e) => e.code === "SHAPE" && e.message.includes(field))).toBe(true)
    }
  })

  test("unknown protocol id is rejected", () => {
    const t = baseTemplate()
    t.protocols = [...t.protocols, "P-UNBOUNDED-CHAOS"]
    const { errors } = validatePolicyGraph(t)
    expect(errors.some((e) => e.code === "SHAPE" && e.message.includes("unknown protocol"))).toBe(true)
  })

  test("a clean template passes with zero errors", () => {
    const { ok, errors } = validatePolicyGraph(baseTemplate())
    expect(ok).toBe(true)
    expect(errors).toEqual([])
  })

  test("validator aggregates ALL violations in one pass — no fail-fast", () => {
    const t = baseTemplate()
    t.automationPermission = "forbidden"
    t.envelope.mode = "autopilot"
    t.loops[0].maxRounds = 0
    t.edges[0].purpose = "tbd"
    t.edges.push({ from: "ghost", to: "consensus", topology: "1:1", purpose: "a real purpose string" })
    t.roster.push("consensus")
    t.protocols = []
    const { ok, errors } = validatePolicyGraph(t)
    expect(ok).toBe(false)
    const codes = new Set(errors.map((e) => e.code))
    expect(codes.has("P-PURPOSE")).toBe(true)
    expect(codes.has("P-SPECIFICITY")).toBe(true)
    expect(codes.has("P-BOUNDED-LOOPS")).toBe(true)
    expect(codes.has("5C")).toBe(true)
    expect(codes.has("SHAPE")).toBe(true)
    expect(errors.length).toBeGreaterThan(5)
  })
})

/** Guard: the shipped catalog itself must stay in sync with the spec registry. */
describe("Command Centre — catalog ↔ spec registry sync", () => {
  test("policyGraphSites() equals the catalog entries (no drift between exports)", () => {
    expect(policyGraphSites()).toEqual(POLICY_GRAPH_CATALOG.map((t) => t.site))
  })
})