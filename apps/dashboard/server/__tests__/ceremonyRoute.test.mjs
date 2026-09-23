// WS-3 T3 — GET /api/command-centre/ceremony. The route must satisfy the T7
// client contract exactly: per-venue-class { gates, spendableResolved,
// scaleResolved, enablement, binaryOptions, platformVerification, lastCreditAt,
// ledgerRunning }, top-level { ok, at, classes }. Honesty contract: an UNHEALTHY
// store still returns 200 with every gate naming ceremony:deny:store-unhealthy
// (never a hard 500, never a silent pass); the overview route is untouched.
// Hermetic: handlers + the fixture store are imported FRESH per test with
// PICC_COMMAND_CENTRE_DATA_DIR at a temp dir, seeded through the STORE's own
// seams (setAssetClasses + creditResolved) — never a real ceremony write.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

// 300 decided real+classed rows for ccxt-crypto: 150 legacy (75/75) + 150 v3.2
// (75/75), alternating hit/miss at winProb 0.6, spread over 35 distinct UTC days
// -> gate1 (300) passes, gate2 (both engines ≥100, equal expectancy) passes,
// gate3 (trailing-50 ratio 0.833 ∈ [0.7,1.3]) passes, gate4 (35 days) passes.
function seedRows() {
  const day0 = Date.UTC(2026, 8, 1, 12, 0, 0)
  const rows = []
  for (let i = 0; i < 300; i++) {
    const legacy = i < 150
    rows.push({
      id: i + 1,
      assetId: "142",
      asset: "EUR / USD",
      provenance: "real",
      result: i % 2 === 0 ? "hit" : "miss",
      engine: legacy ? "legacy" : "v3.2",
      expirySec: legacy ? 60 : 120,
      winProb: 0.6,
      entryTs: day0 + (i % 35) * 86400000
    })
  }
  return rows
}

describe("Command Centre ceremony route (WS-3 T3)", () => {
  let dir
  let handleApi
  let store

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ceremony-route-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    process.env.PICC_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    store = await import("../services/commandCentre/ceremonyState.mjs")
  })

  afterEach(() => {
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_ACCOUNT_METRICS_DATA_DIR
    delete process.env.PICC_CAPTURE_CONFIG_DATA_DIR
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  async function seed() {
    store.setAssetClasses({ "142": "ccxt-crypto" })
    const credited = store.creditResolved(seedRows())
    expect(credited.ok).toBe(true)
    expect(credited.denied).toEqual([])
  }

  it("auth required: a remote caller without a session gets 401", async () => {
    const auth = await import("../services/auth.mjs")
    await auth.createAccount({ email: "ceremony@example.com", password: "correct-horse-battery", name: "Ceremony" })
    const remote = makeReq("GET", "/api/command-centre/ceremony")
    remote.socket = { remoteAddress: "203.0.113.9" } // NOT localhost
    const res = makeRes()
    await handleApi(remote, res, "/api/command-centre/ceremony")
    expect(res.status).toBe(401)
  })

  it("returns the T7 contract per class: gates + spendable + scale marker + enablement + platformVerification + ledgerRunning", async () => {
    await seed()
    const res = await call(handleApi, "GET", "/api/command-centre/ceremony")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.at).toBe("string")
    expect(res.body.classes.map((c) => c.venueClass)).toEqual(["ccxt-crypto", "hyperliquid-perps", "expertoption"])

    const ccxt = res.body.classes.find((c) => c.venueClass === "ccxt-crypto")
    expect(ccxt.spendableResolved).toBe(300)
    expect(ccxt.scaleResolved).toBe(300) // numeric — the T7 client compares ≥ 500
    expect(typeof ccxt.ledgerRunning).toBe("boolean")
    expect(ccxt.enablement).toBeNull()
    expect(ccxt.platformVerification).toBeNull()
    expect(ccxt.lastCreditAt).toEqual(expect.any(String))
    expect(ccxt.gates.map((g) => g.id)).toEqual([
      "gate1-constitution-300",
      "gate2-flip-gate-100",
      "gate3-streak-50-ratio",
      "gate4-trading-days-30"
    ])
    for (const g of ccxt.gates) {
      expect(typeof g.pass).toBe("boolean")
      expect(typeof g.reason).toBe("string")
    }
    expect(ccxt.gates.every((g) => g.pass === true)).toBe(true)

    const untouched = res.body.classes.find((c) => c.venueClass === "hyperliquid-perps")
    expect(untouched.spendableResolved).toBe(0)
    expect(untouched.scaleResolved).toBe(0)
    expect(untouched.lastCreditAt).toBeNull()
    expect(untouched.gates).toHaveLength(1)
    expect(untouched.gates[0].pass).toBe(false)
    expect(untouched.gates[0].reason).toBe("ceremony:deny:gate1-short (have 0, require 300)")
  })

  it("binaryOptions is true for the fixture binary class and its platform gate / record render honestly", async () => {
    await seed()
    const res = await call(handleApi, "GET", "/api/command-centre/ceremony")
    const expert = res.body.classes.find((c) => c.venueClass === "expertoption")
    const ccxt = res.body.classes.find((c) => c.venueClass === "ccxt-crypto")
    expect(expert.binaryOptions).toBe(true)
    expect(ccxt.binaryOptions).toBe(false)
    // nothing verified in the fixture → record is null, client shows platform unverified
    expect(expert.platformVerification).toBeNull()
    expect(expert.enablement).toBeNull()
    // gate-1 shortfall stops before the platform gate is evaluated — one honest deny
    expect(expert.gates).toHaveLength(1)
    expect(expert.gates[0].reason).toBe("ceremony:deny:gate1-short (have 0, require 300)")
  })

  it("ledgerRunning false is surfaced (ceremony:deny:ledger-stale signal) and true once the resolve loop starts", async () => {
    await seed()
    let res = await call(handleApi, "GET", "/api/command-centre/ceremony")
    for (const c of res.body.classes) expect(c.ledgerRunning).toBe(false)

    const ledger = await import("../services/accuracyLedger.mjs")
    ledger.startLedger()
    res = await call(handleApi, "GET", "/api/command-centre/ceremony")
    for (const c of res.body.classes) expect(c.ledgerRunning).toBe(true)
  })

  it("overview route payload stays byte-identical across the ceremony readout", async () => {
    await seed()
    const before = await call(handleApi, "GET", "/api/command-centre/overview")
    const ceremony = await call(handleApi, "GET", "/api/command-centre/ceremony")
    expect(ceremony.status).toBe(200)
    const after = await call(handleApi, "GET", "/api/command-centre/overview")
    expect(after.status).toBe(200)
    // normalize wall-clock timestamps; the rest must be unchanged
    const stripTs = (obj) =>
      JSON.parse(JSON.stringify(obj).replace(/"(19|20)\d{2}-\d{2}-\d{2}T[^"]*"/g, '"<ts>"'))
    expect(stripTs(after.body)).toEqual(stripTs(before.body))
    expect(after.body.sites.map((s) => s.site)).toEqual(["trading:ccxt", "expertoption", "trading:perps"])
    expect(after.body.killSwitch).toEqual({ global: false, sites: {} })
  })

  it("UNHEALTHY store still returns 200 with per-class honest denies — never a hard 500", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), "{\n  \"version\": 1,\n  \"classes\":")
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    const res = await call(handleApi, "GET", "/api/command-centre/ceremony")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true) // the readout executed — the denies are in the gates
    expect(res.body.classes.map((c) => c.venueClass)).toEqual(["ccxt-crypto", "hyperliquid-perps", "expertoption"])
    for (const c of res.body.classes) {
      expect(c.spendableResolved).toBeNull()
      expect(c.scaleResolved).toBeNull()
      expect(c.enablement).toBeNull()
      expect(c.platformVerification).toBeNull()
      expect(c.binaryOptions).toBe(false)
      expect(c.gates).toHaveLength(4)
      for (const g of c.gates) {
        expect(g.pass).toBe(false)
        expect(g.reason).toBe("ceremony:deny:store-unhealthy")
      }
    }
  })
})