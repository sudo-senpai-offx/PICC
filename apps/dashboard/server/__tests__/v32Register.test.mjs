import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method, url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    raw,
    on(evt, cb) { if (evt === "data" && raw != null) cb(raw); if (evt === "end") cb() }
  }
}
function makeRes() {
  return {
    status: null, body: null,
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}
async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

const ROW = (assetId) => ({
  engine: "v3.2",
  assetId,
  direction: "up",
  expiry: "60",
  ts: 123,
  score: { available: true, score: 0.7, direction: "up" },
  costLine: { ev: 1.2, evRR: 2.1, evRRPass: true },
  confidence: 66,
  verdict: "TRADE",
  gates: { score: true, costLine: true, copilot: true },
  reasons: [],
  copilot: { ok: true, wires: [], blockedBy: [] }
})

describe("v3.2 engine register", () => {
  let dir, reg
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-v32reg-"))
    process.env.PICC_V32_CONFIG_DATA_DIR = dir
    vi.resetModules()
    reg = await import("../services/v32Register.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_V32_CONFIG_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("reports shadow mode with an explicit reason when disabled", async () => {
    const out = await reg.v32Register({ decisions: [{ strategies: { v32: { enabled: true, result: ROW("EURUSD") } } }], config: { enabled: false } })
    expect(out.ok).toBe(true)
    expect(out.enabled).toBe(false)
    expect(out.mode).toBe("shadow")
    expect(out.assets).toEqual([])
    expect(out.soak.breakeven).toBeNull()
    expect(out.soak.reason).toContain("powered toggle")
  })

  it("collects v3.2 result rows from enabled decisions only", async () => {
    const out = await reg.v32Register({
      decisions: [
        { strategies: { v32: { enabled: true, result: ROW("EURUSD") } } },
        { strategies: { v32: { enabled: false } } },
        { strategies: { geo: { enabled: true } } }
      ],
      config: { enabled: true },
      at: 99
    })
    expect(out.enabled).toBe(true)
    expect(out.mode).toBe("powered")
    expect(out.assetCount).toBe(1)
    expect(out.assets[0].assetId).toBe("EURUSD")
    expect(out.at).toBe(99)
  })

  it("never fabricates fields: assets mirror the wire rows exactly", async () => {
    const row = ROW("BTCUSD")
    const out = await reg.v32Register({ decisions: [{ strategies: { v32: { enabled: true, result: row } } }], config: { enabled: true } })
    expect(out.assets[0]).toEqual(row)
  })

  it("reports flipGate + resolved count when rows are supplied", async () => {
    const rows = [
      { engine: "v3.2", assetId: "EURUSD", expiry: "60", hits: 3, misses: 1 },
      { engine: "legacy", assetId: "EURUSD", expiry: "60", hits: 5, misses: 5 }
    ]
    const out = await reg.v32Register({ decisions: [], rows, config: { enabled: true } })
    expect(out.soak.resolved).toBe(2)
    expect(out.flipGate).toBeDefined()
    expect(typeof out.flipGate.candidateTrades).toBe("number")
  })
})

describe("engine/v32 endpoint is additive", () => {
  let dir, handleApi
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-v32reg-api-"))
    process.env.PICC_V32_CONFIG_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
  })
  afterEach(() => {
    delete process.env.PICC_V32_CONFIG_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("GET engine/v32 returns shadow mode honestly in an empty config dir", async () => {
    const res = await call(handleApi, "GET", "/api/trading/engine/v32")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.enabled).toBe(false)
    expect(res.body.mode).toBe("shadow")
    expect(res.body.assets).toEqual([])
    expect(typeof res.body.soak.reason).toBe("string")
    // Additive-only: the legacy decisions bytes stay ring-fenced; the new route
    // only adds a key, never rewrites an existing payload.
    expect(res.body).not.toHaveProperty("decisions")
  })

  it("a powered config still returns the same response shape", async () => {
    const res = await call(handleApi, "GET", "/api/trading/engine/v32")
    expect(res.body).toHaveProperty("flipGate")
    expect(res.body).toHaveProperty("assetCount")
    expect(res.body).toHaveProperty("soak")
    expect(res.body).toHaveProperty("at")
  })
})