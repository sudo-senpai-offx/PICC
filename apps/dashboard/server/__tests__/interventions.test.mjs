import { describe, expect, it, vi, beforeEach, afterAll } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "picc-interventions-"))
process.env.PICC_DATA_DIR = dir

vi.mock("../services/browserStudio.mjs", () => ({
  studioBroadcast: vi.fn(),
  studioIsOpen: () => true,
  studioPageFor: () => fakePage,
  studioTypeText: vi.fn(async () => {})
}))

vi.mock("../services/browserBridge.mjs", () => ({
  readPage: vi.fn(async () => ({ balance: "$1,234", today: "$12.34" }))
}))

const loc = {
  waitFor: vi.fn(async () => {}),
  click: vi.fn(async () => {}),
  innerText: vi.fn(async () => "Submit order")
}
const fakePage = {
  locator: vi.fn(() => ({ first: () => loc })),
  keyboard: { press: vi.fn(async () => {}), type: vi.fn(async () => {}) },
  goto: vi.fn(async () => {}),
  waitForTimeout: vi.fn(async () => {})
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function settle() {
  for (let i = 0; i < 50; i++) {
    await sleep(5)
    const s = m.listInterventions()
    if (!s.running || ["done", "error", "aborted", "interrupted"].includes(s.running.status)) return s
  }
  return m.listInterventions()
}

let m
beforeEach(async () => {
  vi.clearAllMocks()
  m = await import("../services/interventions.mjs?case=" + Math.random())
})

afterAll(() => {
  delete process.env.PICC_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe("interventions — workflows", () => {
  it("lists the built-in workflow catalog", async () => {
    const wf = m.listWorkflows()
    expect(wf.length).toBeGreaterThanOrEqual(2)
    expect(wf.some((w) => w.id === "read-portfolio")).toBe(true)
    expect(wf.some((w) => w.id === "guided-submit")).toBe(true)
  })

  it("saves and reloads a user workflow", async () => {
    const saved = m.saveWorkflow({ name: "My flow", approval: "auto", steps: [{ type: "notify", message: "hi" }] })
    expect(saved.id).toBeTruthy()
    const found = m.listWorkflows().find((w) => w.id === saved.id)
    expect(found).toMatchObject({ name: "My flow", approval: "auto", builtin: false })
  })

  it("rejects workflows without steps", () => {
    expect(() => m.saveWorkflow({ name: "x" })).toThrow(/at least one step/)
  })
})

describe("interventions — review queue (human in the loop)", () => {
  it("pauses before a mutating step and runs the step after approval", async () => {
    m.saveWorkflow({ id: "wf-approve", name: "Approve flow", approval: "manual", steps: [{ type: "click", selector: "button", label: "Submit" }] })
    await m.runWorkflow({ workflowId: "wf-approve", tabId: 1 })

    const waiting = m.listInterventions()
    expect(waiting.running.status).toBe("waiting")
    expect(waiting.running.pendingId).toBeTruthy()
    expect(waiting.proposals).toHaveLength(1)
    expect(waiting.proposals[0].action).toBe("click")
    expect(waiting.proposals[0].status).toBe("pending")

    await m.respondIntervention({ id: waiting.proposals[0].id, decision: "approve" })
    const done = await settle()
    expect(done.running.status).toBe("done")
    expect(loc.click).toHaveBeenCalledTimes(1)
    expect(done.proposals[0].status).toBe("approved")
  })

  it("executes immediately on 'execute'", async () => {
    m.saveWorkflow({ id: "wf-exec", name: "Exec flow", approval: "manual", steps: [{ type: "submit", selector: "form" }] })
    await m.runWorkflow({ workflowId: "wf-exec", tabId: 1 })
    const s = m.listInterventions()
    await m.respondIntervention({ id: s.proposals[0].id, decision: "execute" })
    const done = await settle()
    expect(done.running.status).toBe("done")
    expect(done.proposals[0].status).toBe("executed")
  })

  it("aborts on 'reject'", async () => {
    m.saveWorkflow({ id: "wf-reject", name: "Reject flow", approval: "manual", steps: [{ type: "click", selector: "button" }] })
    await m.runWorkflow({ workflowId: "wf-reject", tabId: 1 })
    const s = m.listInterventions()
    await m.respondIntervention({ id: s.proposals[0].id, decision: "reject" })
    const after = m.listInterventions()
    expect(after.running.status).toBe("aborted")
    expect(after.proposals[0].status).toBe("rejected")
    expect(loc.click).not.toHaveBeenCalled()
  })

  it("interrupts on 'interrupt'", async () => {
    m.saveWorkflow({ id: "wf-int", name: "Interrupt flow", approval: "manual", steps: [{ type: "click", selector: "button" }] })
    await m.runWorkflow({ workflowId: "wf-int", tabId: 1 })
    const s = m.listInterventions()
    await m.respondIntervention({ id: s.proposals[0].id, decision: "interrupt" })
    const after = m.listInterventions()
    expect(after.running.status).toBe("interrupted")
    expect(after.proposals[0].status).toBe("interrupted")
  })

  it("rejects responding to an unknown or already-decided proposal", async () => {
    await expect(m.respondIntervention({ id: "nope", decision: "approve" })).rejects.toThrow(/no pending intervention/)
  })
})

describe("interventions — execution engine", () => {
  it("auto-approval runs mutating steps without pausing", async () => {
    m.saveWorkflow({ id: "wf-auto", name: "Auto flow", approval: "auto", steps: [{ type: "fill", selector: "input", value: "hello" }, { type: "notify", message: "done" }] })
    await m.runWorkflow({ workflowId: "wf-auto", tabId: 1 })
    const done = await settle()
    expect(done.running.status).toBe("done")
    expect(done.proposals).toHaveLength(0)
    expect(done.running.log.some((l) => l.includes("filled"))).toBe(true)
  })

  it("read-only workflows never create proposals", async () => {
    await m.runWorkflow({ workflowId: "read-portfolio", tabId: 1 })
    const done = await settle()
    expect(done.running.status).toBe("done")
    expect(done.proposals).toHaveLength(0)
    expect(done.running.metrics["dashboard.balance"]).toBe("$1,234")
  })

  it("errors land in the run state when a step fails", async () => {
    loc.click.mockRejectedValueOnce(new Error("selector not found"))
    m.saveWorkflow({ id: "wf-err", name: "Err flow", approval: "auto", steps: [{ type: "click", selector: "button" }] })
    await m.runWorkflow({ workflowId: "wf-err", tabId: 1 })
    const done = await settle()
    expect(done.running.status).toBe("error")
    expect(done.running.error).toMatch(/selector not found/)
  })

  it("stopWorkflow interrupts a pending run", async () => {
    m.saveWorkflow({ id: "wf-stop", name: "Stop flow", approval: "manual", steps: [{ type: "click", selector: "button" }] })
    await m.runWorkflow({ workflowId: "wf-stop", tabId: 1 })
    const after = m.stopWorkflow()
    expect(after.running.status).toBe("interrupted")
    expect(after.proposals[0].status).toBe("interrupted")
  })
})
