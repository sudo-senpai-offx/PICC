// Command Centre slice 5 — POST /api/command-centre/execute happy path with a
// FIXTURE venue executor. The venue-touching step (interventions.runWorkflow)
// is mocked to a stub that reports a running workflow: CI never exercises the
// real browser. This proves the route wiring end-to-end — the HUMAN's approval
// (consentBy) reaches the claim, the venue executes exactly once, the audit
// trail records allow + executed, and the claims list flips ready → claimed.
//
// The honest no-browser failure (BROWSER_CLOSED), the 5E stale-presence deny,
// validation 400s and remote 401s are covered with the REAL module in
// commandCentre.overviewApi.test.mjs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/interventions.mjs", async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    runWorkflow: vi.fn(async ({ workflowId, tabId, approval } = {}) => ({
      ok: true,
      workflowId,
      tabId: tabId ?? null,
      approval,
      status: "running"
    }))
  }
})

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    }
  }
}

async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

describe("Command Centre slice 5 — execute route happy path (fixture venue executor)", () => {
  let dir
  let handleApi
  let audit
  let interventions

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-cc-exec-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    process.env.PICC_AUTOMATOR_DATA_DIR = dir
    process.env.PICC_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    audit = await import("../services/commandCentre/auditTrail.mjs")
    interventions = await import("../services/interventions.mjs")
    // the vi.mock factory's fn is cached across resetModules — reset its history
    interventions.runWorkflow.mockClear()
    const automator = await import("../services/automator.mjs")
    await automator.recordPresence("test-node")
  })

  afterEach(() => {
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_ACCOUNT_METRICS_DATA_DIR
    delete process.env.PICC_CAPTURE_CONFIG_DATA_DIR
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    delete process.env.PICC_AUTOMATOR_DATA_DIR
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("an approved claim executes EXACTLY ONCE through the venue, audits allow+executed, and flips to claimed", async () => {
    const store = await import("../services/localstore.mjs")
    const day = new Date().toISOString().slice(0, 10)
    await store.appendRow("agent_logs", {
      kind: "payout_ready",
      source: "scheduler",
      level: "info",
      platform: "Traffmonetizer",
      balance: 12.4,
      payoutThreshold: 10,
      note: "Balance 12.4 meets the 10 payout threshold"
    })

    const before = await call(handleApi, "GET", "/api/command-centre/claims")
    expect(before.body.claims[0].status).toBe("ready")

    const res = await call(handleApi, "POST", "/api/command-centre/execute", {
      platform: "Traffmonetizer",
      balance: 12.4,
      threshold: 10,
      ref: day,
      claimWorkflowId: "wf-payout-claim",
      tabId: 7
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // the acting human IS the fresh per-action consent, and it was recorded
    expect(res.body.consentBy).toBe("default")
    expect(res.body.gate.allow).toBe(true)
    expect(res.body.execution.status).toBe("executed")

    // the venue was reached exactly once, with the workflow engine seam inputs
    expect(interventions.runWorkflow).toHaveBeenCalledTimes(1)
    expect(interventions.runWorkflow).toHaveBeenCalledWith({
      workflowId: "wf-payout-claim",
      tabId: 7,
      approval: "manual"
    })

    // durable audit: allow + executed, same idempotency key, trail intact
    const trail = audit.readAudit()
    const allow = trail.find((e) => e.kind === "safety-gate:allow")
    expect(allow.data.idempotencyKey).toBe(`bandwidth:claim:Traffmonetizer:${day}`)
    const executed = trail.find((e) => e.kind === "execution:executed")
    expect(executed).toMatchObject({
      site: "bandwidth:browser",
      data: {
        action: "bandwidth:payout-claim",
        idempotencyKey: `bandwidth:claim:Traffmonetizer:${day}`,
        power: "proposals",
        consentBy: "default"
      }
    })
    expect(audit.verifyAudit().ok).toBe(true)

    // the claims list now reflects the durable trail: ready → claimed
    const after = await call(handleApi, "GET", "/api/command-centre/claims")
    expect(after.body.claims[0].status).toBe("claimed")
  })

  it("a REPLAYED claim is rejected at gate 10 (5G) — one executed claim per payout ref, even across restarts", async () => {
    const day = new Date().toISOString().slice(0, 10)
    const first = await call(handleApi, "POST", "/api/command-centre/execute", {
      platform: "Traffmonetizer",
      balance: 12.4,
      threshold: 10,
      ref: day,
      claimWorkflowId: "wf-payout-claim"
    })
    expect(first.body.ok).toBe(true)

    const replay = await call(handleApi, "POST", "/api/command-centre/execute", {
      platform: "Traffmonetizer",
      balance: 12.4,
      threshold: 10,
      ref: day,
      claimWorkflowId: "wf-payout-claim"
    })
    expect(replay.body.ok).toBe(false)
    expect(replay.body.gate.allow).toBe(false)
    expect(replay.body.gate.blockedBy).toBe("idempotent")
    expect(replay.body.execution).toBeNull()
    // the venue was only ever reached once
    expect(interventions.runWorkflow).toHaveBeenCalledTimes(1)
  })

  it("a different payout ref is a DIFFERENT claim — the 5G key is ref-based identity, not a counter", async () => {
    const first = await call(handleApi, "POST", "/api/command-centre/execute", {
      platform: "Traffmonetizer",
      balance: 12.4,
      threshold: 10,
      ref: "2026-09-01",
      claimWorkflowId: "wf-payout-claim"
    })
    expect(first.body.ok).toBe(true)
    const second = await call(handleApi, "POST", "/api/command-centre/execute", {
      platform: "Traffmonetizer",
      balance: 12.4,
      threshold: 10,
      ref: "2026-09-02",
      claimWorkflowId: "wf-payout-claim"
    })
    expect(second.body.ok).toBe(true)
    expect(interventions.runWorkflow).toHaveBeenCalledTimes(2)
  })
})