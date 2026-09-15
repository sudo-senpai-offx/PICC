// S0/T0.3 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: GET /api/packs/registry is the
// pack strip's data source — Pack 1 with 4 steps, honest empty state, and a
// rate-limited read surface.
//
// Honesty contract under test:
//   - fresh registry: every step idle, lastObservedAt null, empty evidence
//     (the strip renders "not-observed", never zeros);
//   - observations/acks land evidence rows with ts — the endpoint never
//     fabricates a status;
//   - credentials stay off the wire (no token values in the JSON);
//   - the route is rate limited (30/60s) like sibling extension routes.
// Hermetic: PICC_DATA_DIR → tmp dir, handlers imported fresh (same idiom as
// resourceGovernorApi.test.mjs). No network, no credentials.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

async function call(handleApi, method, path, { remote = false, body } = {}) {
  const req = makeReq(method, path, body)
  if (remote) req.socket = { remoteAddress: "203.0.113.5" }
  const res = makeRes()
  await handleApi(req, res, path)
  return res
}

describe("GET /api/packs/registry (S0/T0.3)", () => {
  let dir
  let handleApi
  let reg

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-packs-api-"))
    process.env.PICC_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    reg = await import("../services/packRegistry.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("returns Pack 1 with 4 idle steps, honest empty state, no credentials", async () => {
    const res = await call(handleApi, "GET", "/api/packs/registry")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const pack = res.body.registry.packs[0]
    expect(pack.id).toBe("pack1-local-trading-core")
    expect(pack.steps).toHaveLength(4)
    for (const s of pack.steps) {
      expect(s.status).toBe("idle")
      expect(s.lastObservedAt).toBeNull()
      expect(s.evidence).toEqual([])
      expect(s.envelope.tier).toBeTruthy()
    }
    const flat = JSON.stringify(res.body)
    // presence flags only: no credential VALUES cross the wire (a token named
    // inside a human-readable `needs` sentence stays; a "token": "<value>" key
    // or a live/test secret shape never appears)
    expect(flat).not.toMatch(/sk_(test|live)_\w+|pk_(test|live)_\w+|cus_\w+|"token"\s*:\s*"[^"]+/)
  })

  it("observations flow to the endpoint with evidence rows (ts + observed)", async () => {
    await reg.observeStep("pack1-local-trading-core", "p1-2-ccxt-data-poll", {
      status: "running",
      detail: "polls ok",
      observed: { ok: 12, fail: 0 }
    })
    const res = await call(handleApi, "GET", "/api/packs/registry")
    const step = res.body.registry.packs[0].steps.find((s) => s.id === "p1-2-ccxt-data-poll")
    expect(step.status).toBe("running")
    expect(step.evidence).toHaveLength(1)
    expect(step.evidence[0].status).toBe("running")
    expect(step.evidence[0].observed.ok).toBe(12)
    expect(step.evidence[0].ts).toBeTruthy()
  })

  it("an L-class stop surfaces as stopped-at-human until the human acks (then re-arms)", async () => {
    await reg.observeStep("pack1-local-trading-core", "p1-1-eo-session-capture", {
      status: "stopped-at-human",
      detail: "token expired"
    })
    let res = await call(handleApi, "GET", "/api/packs/registry")
    let step = res.body.registry.packs[0].steps.find((s) => s.id === "p1-1-eo-session-capture")
    expect(step.status).toBe("stopped-at-human")
    expect(step.detail).toBe("token expired")

    await reg.ackStep("pack1-local-trading-core", "p1-1-eo-session-capture", { by: "human" })
    res = await call(handleApi, "GET", "/api/packs/registry")
    step = res.body.registry.packs[0].steps.find((s) => s.id === "p1-1-eo-session-capture")
    expect(step.status).toBe("idle")
    expect(step.acknowledgedBy).toBe("human")
    expect(step.evidence.at(-1).status).toBe("acknowledged")
    expect(step.evidence.at(-1).doneBy).toBe("human") // T6.2: human handoff evidence row
  })

  it("projects the workflow pathway onto a stopped step's read row (T6.2: strip exposes structured steps + ack)", async () => {
    const pathway = {
      need: "re-login",
      prompt: "Manual login required — PICC never auto-fills, auto-detects, or automates broker logins.",
      steps: ["Open the ExpertOption app tab", "Log in AGAIN to the DEMO account manually"]
    }
    await reg.observeStep("pack1-local-trading-core", "p1-1-eo-session-capture", {
      status: "stopped-at-human",
      detail: "needs: re-login",
      observed: { degradedKind: "expired", tokenConfigured: true, pathway }
    })
    const res = await call(handleApi, "GET", "/api/packs/registry")
    const step = res.body.registry.packs[0].steps.find((s) => s.id === "p1-1-eo-session-capture")
    expect(step.status).toBe("stopped-at-human")
    expect(step.pathway).toEqual(pathway)
    // non-stopped steps carry no pathway
    const ccxt = res.body.registry.packs[0].steps.find((s) => s.id === "p1-2-ccxt-data-poll")
    expect(ccxt.pathway).toBeNull()
  })

  it("skipped-unconfigured carries the exact reason (no fake failure/success)", async () => {
    await reg.observeStep("pack1-local-trading-core", "p1-3-news-digest", {
      status: "skipped-unconfigured",
      detail: "no-news-source-configured"
    })
    const res = await call(handleApi, "GET", "/api/packs/registry")
    const step = res.body.registry.packs[0].steps.find((s) => s.id === "p1-3-news-digest")
    expect(step.status).toBe("skipped-unconfigured")
    expect(step.detail).toBe("no-news-source-configured")
  })

  it("T6.2 kill-switch relay: heartbeat stores boolean-only captureEnabled; false relays to honest skip-unconfigured", async () => {
    // absent/string → honest null (never assumed false)
    let res = await call(handleApi, "POST", "/api/extension/heartbeat", { body: { extensionVersion: "1.0.0" } })
    expect(res.status).toBe(200)
    expect(globalThis.__picc_ext_heartbeat.captureEnabled).toBeNull()
    await call(handleApi, "POST", "/api/extension/heartbeat", { body: { captureEnabled: "false" } })
    expect(globalThis.__picc_ext_heartbeat.captureEnabled).toBeNull()
    // boolean true relayed
    await call(handleApi, "POST", "/api/extension/heartbeat", { body: { captureEnabled: true } })
    expect(globalThis.__picc_ext_heartbeat.captureEnabled).toBe(true)
    // boolean false relayed → scheduler seam reads it → observeEoCapture skips (observer owns the SKIP_REASON string)
    await call(handleApi, "POST", "/api/extension/heartbeat", { body: { captureEnabled: false } })
    expect(globalThis.__picc_ext_heartbeat.captureEnabled).toBe(false)
    const seamValue = globalThis.__picc_ext_heartbeat?.captureEnabled ?? null
    const { observeEoCapture } = await import("../services/packObservers.mjs")
    const obs = observeEoCapture({ captureEnabled: seamValue })
    expect(obs.status).toBe("skipped-unconfigured")
    expect(obs.detail).toBe("extension-capture-disabled")
    expect(obs.observed).toEqual({
      captureEnabled: false,
      source: "extension kill-switch",
      sessionCaptureEnabled: null
    })
    delete globalThis.__picc_ext_heartbeat
  })

  it("is rate limited (429) beyond 30 reads per 60s", async () => {
    let last
    for (let i = 0; i < 31; i++) {
      last = await call(handleApi, "GET", "/api/packs/registry")
    }
    expect(last.status).toBe(429)
    expect(last.body.error).toBe("rate limited")
  })
})

// S5/T5.1–T5.2 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: the pack strip's
// interactive surface. POST /api/packs/ack is the ONLY exit from
// stopped-at-human over HTTP (human handoff; the server marks doneBy:"human"
// and re-arms the step to idle — never auto-run). GET /api/packs/registry
// carries the §8.5 caps (server env truth, read-only — a browser client must
// never guess them).
describe("POST /api/packs/ack + caps (S5/T5.1–T5.2)", () => {
  let dir
  let handleApi
  let reg

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-packs-ack-"))
    process.env.PICC_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    reg = await import("../services/packRegistry.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("GET registry surfaces the §8.5 caps with conservative defaults (server env truth)", async () => {
    const res = await call(handleApi, "GET", "/api/packs/registry")
    expect(res.status).toBe(200)
    expect(res.body.caps).toMatchObject({ maxRamMb: 4096, maxCpuPct: 50, maxStorageMb: 2048 })
  })

  it("caps honor PICC_RESOURCE_* env overrides (read-only, never guessed)", async () => {
    process.env.PICC_RESOURCE_MAX_RAM_MB = "2048"
    process.env.PICC_RESOURCE_MAX_CPU_PCT = "80"
    process.env.PICC_RESOURCE_MAX_STORAGE_MB = "1024"
    vi.resetModules()
    const h2 = (await import("../handlers.mjs")).handleApi
    const res = await call(h2, "GET", "/api/packs/registry")
    expect(res.body.caps).toMatchObject({ maxRamMb: 2048, maxCpuPct: 80, maxStorageMb: 1024 })
    delete process.env.PICC_RESOURCE_MAX_RAM_MB
    delete process.env.PICC_RESOURCE_MAX_CPU_PCT
    delete process.env.PICC_RESOURCE_MAX_STORAGE_MB
  })

  it("POST ack is auth-gated: a remote caller without a session gets 401", async () => {
    const { createAccount } = await import("../services/auth.mjs")
    await createAccount({ email: "ack@example.com", password: "correct-horse-battery", name: "Ack" })
    const res = await call(handleApi, "POST", "/api/packs/ack", {
      remote: true,
      body: { packId: "pack1-local-trading-core", stepId: "p1-1-eo-session-capture" }
    })
    expect(res.status).toBe(401)
  })

  it("POST ack re-arms a stopped-at-human step to idle with doneBy human (the ONLY legal exit)", async () => {
    await reg.observeStep("pack1-local-trading-core", "p1-1-eo-session-capture", {
      status: "stopped-at-human",
      detail: "token expired"
    })
    const res = await call(handleApi, "POST", "/api/packs/ack", {
      body: { packId: "pack1-local-trading-core", stepId: "p1-1-eo-session-capture" }
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.step.status).toBe("idle")
    expect(res.body.step.acknowledgedBy).toBe("human")
    expect(res.body.step.evidence.at(-1).status).toBe("acknowledged")

    const after = await call(handleApi, "GET", "/api/packs/registry")
    const step = after.body.registry.packs[0].steps.find((s) => s.id === "p1-1-eo-session-capture")
    expect(step.status).toBe("idle")
  })

  it("POST ack rejects (400) a step that is NOT stopped-at-human — no fabricated re-arm", async () => {
    await reg.observeStep("pack1-local-trading-core", "p1-2-ccxt-data-poll", {
      status: "running",
      detail: "polls ok"
    })
    const res = await call(handleApi, "POST", "/api/packs/ack", {
      body: { packId: "pack1-local-trading-core", stepId: "p1-2-ccxt-data-poll" }
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("ack only valid on stopped-at-human")
  })

  it("POST ack rejects (400) an unknown step or pack — honest unknown, never a fake idle", async () => {
    const res = await call(handleApi, "POST", "/api/packs/ack", {
      body: { packId: "pack1-local-trading-core", stepId: "nope" }
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("unknown step")
  })

  it("POST ack is rate limited (429) like sibling mutating routes", async () => {
    await reg.observeStep("pack1-local-trading-core", "p1-1-eo-session-capture", {
      status: "stopped-at-human",
      detail: "token expired"
    })
    let last
    for (let i = 0; i < 11; i++) {
      last = await call(handleApi, "POST", "/api/packs/ack", {
        body: { packId: "pack1-local-trading-core", stepId: "p1-1-eo-session-capture" }
      })
    }
    expect(last.status).toBe(429)
    expect(last.body.error).toBe("rate limited")
  })
})