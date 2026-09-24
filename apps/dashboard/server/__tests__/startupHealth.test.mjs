import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DAY_MS = 86_400_000
const NOW = Date.parse("2026-09-24T12:00:00.000Z")
const TOKEN = "eo-placeholder-token-abc"
const TRADING_FILE = "trading-credentials.json"
const VENUE_FILE = "venue-credentials.json"
const CCXT_NO_PAIR =
  "ccxt ordering seam: no HYPERLIQUID credentials configured — set either PICC_CCXT_APIKEY_HYPERLIQUID + PICC_CCXT_SECRET_HYPERLIQUID (CEX-style) or PICC_CCXT_WALLETADDRESS_HYPERLIQUID + PICC_CCXT_PRIVATEKEY_HYPERLIQUID (Hyperliquid-style) — the execution leg is inoperable without them"
const PERPS_OFF =
  "perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)"

let dir
let health
let audit
let handleApi

function clearEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PICC_CCXT_") || key === "PICC_CRED_EXPIRY_DAYS_EXPERTOPTION") delete process.env[key]
  }
}

function seedStores(trading = {}, venue = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, TRADING_FILE), JSON.stringify(trading), "utf8")
  writeFileSync(join(dir, VENUE_FILE), JSON.stringify(venue), "utf8")
}

async function loadHealth() {
  vi.resetModules()
  audit = await import("../services/commandCentre/auditTrail.mjs")
  audit._resetAuditTrail()
  health = await import("../services/commandCentre/startupHealth.mjs")
}

async function checks(trading = {}, venue = {}, env = {}, now = NOW) {
  seedStores(trading, venue)
  Object.assign(process.env, env)
  await loadHealth()
  return health.buildStartupHealthChecks({ now })
}

function findDeny(result, deny) {
  return result.find((check) => check.deny === deny)
}

function makeReq(method, url, headers = {}) {
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    on(evt, cb) {
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "picc-startup-health-"))
  process.env.PICC_TRADING_DATA_DIR = dir
  process.env.PICC_AUTOMATOR_DATA_DIR = dir
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  process.env.PICC_AUTH_DATA_DIR = dir
  process.env.PICC_VAULT_KEY = "startup-health-fixture-key"
  clearEnv()
})

afterEach(() => {
  clearEnv()
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_AUTOMATOR_DATA_DIR
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  delete process.env.PICC_AUTH_DATA_DIR
  delete process.env.PICC_VAULT_KEY
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

describe("startup health checks", () => {
  it("reports a corrupt credential vault as an error deny", async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, TRADING_FILE), "not-json", "utf8")
    writeFileSync(join(dir, VENUE_FILE), JSON.stringify({}), "utf8")
    Object.assign(process.env, { PICC_CRED_EXPIRY_DAYS_EXPERTOPTION: "30" })
    await loadHealth()
    const result = await health.buildStartupHealthChecks({ now: NOW })
    const check = result.find((entry) => entry.deny === `suite:deny:credential-store-unreadable (${TRADING_FILE})`)
    expect(check?.severity).toBe("error")
  })

  it("reports the exact expired ExpertOption age deny", async () => {
    const result = await checks(
      { expertoptionToken: TOKEN, expertoptionTokenCapturedAt: new Date(NOW - 41 * DAY_MS).toISOString() },
      {},
      { PICC_CRED_EXPIRY_DAYS_EXPERTOPTION: "30" }
    )
    expect(findDeny(result, "suite:deny:credential-expired (expertoption, age 41 days exceeds 30)")).toMatchObject({
      severity: "error"
    })
  })

  it("warns when an ExpertOption token has no capturedAt record", async () => {
    const result = await checks({ expertoptionToken: TOKEN }, {}, { PICC_CRED_EXPIRY_DAYS_EXPERTOPTION: "30" })
    expect(
      findDeny(result, "suite:deny:credential-capture-date-missing (expertoption, rotation record absent — re-capture to record it)")
    ).toMatchObject({ severity: "warning" })
  })

  it("reports a half-set wallet pair with the missing env variable", async () => {
    const result = await checks(
      {},
      {},
      { PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0xplaceholder-wallet" }
    )
    expect(
      findDeny(result, "suite:deny:credential-pair-incomplete (HYPERLIQUID: PICC_CCXT_PRIVATEKEY_HYPERLIQUID)")
    ).toMatchObject({ severity: "warning" })
  })

  it("reuses the existing no-credentials refusal when no CCXT pair is present", async () => {
    const result = await checks({}, {}, {})
    expect(findDeny(result, CCXT_NO_PAIR)).toMatchObject({ severity: "warning" })
  })

  it("reuses the exact perps rail refusal when sandbox and mainnet are off", async () => {
    const result = await checks({}, {}, {})
    expect(findDeny(result, PERPS_OFF)).toMatchObject({ severity: "warning" })
  })

  it("skips expiry validation when the TTL env var is absent without changing ok", async () => {
    const result = await checks({ expertoptionToken: TOKEN, expertoptionTokenCapturedAt: new Date(NOW).toISOString() }, {}, {})
    const expiry = result.find((entry) => entry.id === "expertoption-expiry")
    expect(expiry?.deny).toBeNull()
    expect(expiry?.detail).toMatch(/skipped/i)
    expect(result.some((entry) => entry.severity === "error")).toBe(false)
    const readout = await health.runStartupHealth({ now: NOW })
    expect(readout.ok).toBe(true)
  })

  it("masks token values and never echoes the raw token", async () => {
    const result = await checks({ expertoptionToken: TOKEN, expertoptionTokenCapturedAt: new Date(NOW).toISOString() }, {}, {})
    const serialized = JSON.stringify(result)
    expect(serialized).toContain("****")
    expect(serialized).not.toContain(TOKEN)
  })

  it("sets ok false only when an error-severity check exists", async () => {
    const errorResult = await checks(
      { expertoptionToken: TOKEN, expertoptionTokenCapturedAt: new Date(NOW - 41 * DAY_MS).toISOString() },
      {},
      { PICC_CRED_EXPIRY_DAYS_EXPERTOPTION: "30" }
    )
    const errorReadout = await health.runStartupHealth({ now: NOW })
    expect(errorResult.some((entry) => entry.severity === "error")).toBe(true)
    expect(errorReadout.ok).toBe(false)
    expect(Object.keys(errorReadout).sort()).toEqual(["at", "checks", "generatedAt", "ok"])
    const warningOnly = await checks({}, {}, { PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0xplaceholder-wallet" })
    const warningReadout = await health.runStartupHealth({ now: NOW })
    expect(warningOnly.some((entry) => entry.severity === "error")).toBe(false)
    expect(warningReadout.ok).toBe(true)
  })
})

describe("startup health audit and route", () => {
  beforeEach(async () => {
    seedStores({ expertoptionToken: TOKEN, expertoptionTokenCapturedAt: new Date(NOW).toISOString() }, {})
    Object.assign(process.env, { PICC_CRED_EXPIRY_DAYS_EXPERTOPTION: "30" })
    await loadHealth()
  })

  it("appends exactly one audit row per boot and keeps the chain green", async () => {
    await health.runStartupHealth({ now: NOW })
    await health.runStartupHealth({ now: NOW + 1 })
    const entries = audit.readAudit().filter((entry) => entry.kind === "audit:startup-health")
    expect(entries).toHaveLength(1)
    expect(entries[0].data.ok).toBe(true)
    expect(audit.verifyAudit()).toEqual({ ok: true, brokenAt: null, reason: null })
  })

  it("returns 401 for an unauthenticated remote GET and the cached shape for a local GET", async () => {
    await health.runStartupHealth({ now: NOW })
    const auth = await import("../services/auth.mjs")
    await auth.createAccount({ email: "startup-health@example.com", password: "correct-horse-battery", name: "Startup" })
    handleApi = (await import("../handlers.mjs")).handleApi
    const remote = makeReq("GET", "/api/command-centre/startup-health")
    remote.socket = { remoteAddress: "203.0.113.9" }
    const remoteRes = makeRes()
    await handleApi(remote, remoteRes, "/api/command-centre/startup-health")
    expect(remoteRes.status).toBe(401)
    const localRes = makeRes()
    await handleApi(makeReq("GET", "/api/command-centre/startup-health"), localRes, "/api/command-centre/startup-health")
    expect(localRes.status).toBe(200)
    expect(localRes.body.ok).toBe(true)
    expect(Array.isArray(localRes.body.checks)).toBe(true)
    expect(typeof localRes.body.generatedAt).toBe("string")
    expect(JSON.stringify(localRes.body)).not.toContain(TOKEN)
  }, 15_000)
})
