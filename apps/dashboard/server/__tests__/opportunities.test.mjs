import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AGENT_CATALOG,
  BOUNTY_BOARDS,
  CATEGORIES,
  OPPORTUNITY_CATALOG,
  listWorkflows,
  monitorBountyBoards,
  opportunityCatalog,
  workflowsDir
} from "../services/opportunities.mjs"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const CATEGORY_IDS = CATEGORIES.map((c) => c.id)

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

describe("opportunity catalog (research A–G)", () => {
  it("defines the seven blueprint categories", () => {
    expect(CATEGORIES).toHaveLength(7)
    expect(CATEGORY_IDS).toEqual(["A", "B", "C", "D", "E", "F", "G"])
    for (const c of CATEGORIES) {
      expect(c.label).toBeTruthy()
      expect(c.blurb).toBeTruthy()
    }
  })

  it("every opportunity is well-formed and references a real category", () => {
    expect(OPPORTUNITY_CATALOG.length).toBeGreaterThan(0)
    const ids = new Set()
    for (const o of OPPORTUNITY_CATALOG) {
      expect(o.id).toBeTruthy()
      expect(ids.has(o.id), `duplicate id ${o.id}`).toBe(false)
      ids.add(o.id)
      expect(CATEGORY_IDS, `${o.id} references ${o.category}`).toContain(o.category)
      for (const f of ["title", "description", "whatItAutomates", "integrations", "effort", "expectedValue", "status"]) {
        expect(o[f], `${o.id}.${f}`).toBeTruthy()
      }
      expect(["low", "medium", "high"]).toContain(o.effort)
      expect(["ready", "track", "needs_research"]).toContain(o.status)
    }
  })

  it("every agent crew is well-formed", () => {
    expect(AGENT_CATALOG.length).toBeGreaterThan(0)
    for (const a of AGENT_CATALOG) {
      expect(a.id).toBeTruthy()
      expect(a.name).toBeTruthy()
      expect(Array.isArray(a.agents) && a.agents.length > 0).toBe(true)
    }
  })
})

describe("listWorkflows", () => {
  let dir

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "picc-wf-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("reads real templates and falls back to the embedded catalog when the dir is missing", async () => {
    const original = workflowsDir()
    try {
      await mkdir(join(dir, "sub"), { recursive: true })
      await writeFile(
        join(dir, "picc-bounty-monitor.json"),
        JSON.stringify({
          name: "Bounty monitor",
          nodes: [
            { type: "n8n-nodes-base.scheduleTrigger" },
            { type: "n8n-nodes-base.httpRequest" }
          ]
        })
      )
      vi.stubEnv("PICC_N8N_WORKFLOWS_DIR", join(dir, "sub"))
      const withDir = await listWorkflows()
      expect(withDir.dirFound).toBe(true)
      expect(withDir.workflows.some((w) => w.file === "picc-bounty-monitor.json")).toBe(true)

      vi.stubEnv("PICC_N8N_WORKFLOWS_DIR", join(dir, "missing"))
      const withoutDir = await listWorkflows()
      expect(withoutDir.dirFound).toBe(false)
      expect(withoutDir.workflows.length).toBeGreaterThan(0)
      expect(withoutDir.workflows.some((w) => w.embedded)).toBe(true)
      expect(withoutDir.ok).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      void original
    }
  })
})

describe("monitorBountyBoards", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reports boards reachable / unreachable honestly, never throws", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 1, title: "SEO audit", reward: "USDC" }]))
      .mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { name: "TypeError" }))
    vi.stubGlobal("fetch", fetchMock)

    const { ok, boards } = await monitorBountyBoards()
    expect(ok).toBe(true)
    expect(boards).toHaveLength(BOUNTY_BOARDS.length)

    const aigen = boards.find((b) => b.id === "aigen")
    expect(aigen.reachable).toBe(true)
    expect(aigen.entries).toHaveLength(1)
    expect(aigen.entries[0].title).toBe("SEO audit")

    const three = boards.find((b) => b.id === "agora-three")
    expect(three.reachable).toBe(false)
    expect(three.error).toBeTruthy()
  })

  it("wraps catalog + agents for the dashboard endpoint", async () => {
    const env = await opportunityCatalog()
    expect(env.ok).toBe(true)
    expect(env.categories).toEqual(CATEGORIES)
    expect(env.opportunities).toEqual(OPPORTUNITY_CATALOG)
    expect(env.agents).toEqual(AGENT_CATALOG)
    expect(env.updatedAt).toBeTruthy()
  })
})
