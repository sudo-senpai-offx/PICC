import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

// Seed REAL encrypted vault envelopes via writeSecretJson, not plaintext JSON. Plaintext fixtures
// would still pass if the module regressed to `readFile` + `JSON.parse`, so they never actually
// prove D5's "credential stores decrypt" requirement.
async function seedStores(trading = {}, venue = {}) {
  mkdirSync(dir, { recursive: true })
  const { writeSecretJson } = await import("../services/vault.mjs")
  await writeSecretJson(join(dir, TRADING_FILE), trading)
  await writeSecretJson(join(dir, VENUE_FILE), venue)
}

// Write raw bytes, bypassing the vault — used to model a corrupt / tampered store file.
function seedRawStore(name, contents) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), contents, "utf8")
}

async function loadHealth() {
  vi.resetModules()
  audit = await import("../services/commandCentre/auditTrail.mjs")
  audit._resetAuditTrail()
  health = await import("../services/commandCentre/startupHealth.mjs")
}

async function checks(trading = {}, venue = {}, env = {}, now = NOW) {
  await seedStores(trading, venue)
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
  it("reports a tampered credential vault as an error deny", async () => {
    // Write a REAL encrypted envelope, then corrupt its ciphertext in place. This can only be
    // detected by actually attempting decryption, so it fails if the module ever regresses to
    // `readFile` + `JSON.parse` (which would happily parse the outer `{pva1}` wrapper).
    await seedStores({ expertoptionToken: TOKEN }, {})
    const path = join(dir, TRADING_FILE)
    const envelope = JSON.parse(readFileSync(path, "utf8"))
    expect(typeof envelope.pva1).toBe("string")
    const parts = envelope.pva1.split(":")
    expect(parts[0]).toBe("v2")
    expect(parts).toHaveLength(5)
    parts[parts.length - 1] = Buffer.from("tampered-ciphertext-bytes").toString("base64")
    writeFileSync(path, JSON.stringify({ pva1: parts.join(":") }), "utf8")

    Object.assign(process.env, { PICC_CRED_EXPIRY_DAYS_EXPERTOPTION: "30" })
    await loadHealth()
    const result = await health.buildStartupHealthChecks({ now: NOW })
    const check = result.find((entry) => entry.deny === `suite:deny:credential-store-unreadable (${TRADING_FILE})`)
    expect(check?.severity).toBe("error")
  })

  // D2/AC-005: the four ExpertOption token-TTL tests below (expired-age deny,
  // one-hour-past-TTL regression, exact-boundary, missing-capturedAt) are
  // REMOVED with `expertoptionCheck`. That check existed only to age-check an
  // `expertoptionToken` that is no longer written or read, so there is no code
  // left for them to exercise. The credential-store readability check that
  // shared the same store — including the tampered-envelope test above — is
  // untouched and still proves the vault decrypts at startup.

  it("D2/AC-005: no ExpertOption expiry check remains in the startup health report", async () => {
    const result = await checks({}, {}, {})
    expect(result.find((entry) => entry.id === "expertoption-expiry")).toBeUndefined()
    // The check id, the env var, and the deny vocabulary are all gone — a
    // re-added check would be a new deny surface for a venue that is not here.
    expect(JSON.stringify(result)).not.toMatch(/expertoption/i)
  })

  it("D2/AC-005: the removed TTL env var no longer influences startup health", async () => {
    // `PICC_CRED_EXPIRY_DAYS_EXPERTOPTION` was the only consumer's input. With
    // the check gone the variable must be inert, and must not resurrect a deny.
    const without = await checks({}, {}, {})
    const with_ = await checks({}, {}, { PICC_CRED_EXPIRY_DAYS_EXPERTOPTION: "30" })
    expect(with_).toEqual(without)
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

  it("D2/AC-005: the removed expiry skip/mask branches are gone, and ok is unaffected", async () => {
    // The "TTL absent → skipped, still ok" and "mask the token" tests both
    // described `expertoptionCheck`. With that check removed there is no
    // `****`-masked expiry detail to assert, and the ok verdict must now be
    // derived from the checks that actually remain.
    const result = await checks({}, {}, {})
    expect(result.some((entry) => entry.severity === "error")).toBe(false)
    const readout = await health.runStartupHealth({ now: NOW })
    expect(readout.ok).toBe(true)
  })

  it("masks token values and never echoes the raw token", async () => {
    // The mask guarantee is preserved for the surface that still prints a
    // credential: a CCXT half-set pair names the venue but never the secret.
    const result = await checks({ apiKey: TOKEN }, {}, { PICC_CCXT_APIKEY_BINANCE: TOKEN })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(TOKEN)
  })

  it("sets ok false only when an error-severity check exists", async () => {
    // D2/AC-005: the error source is now the credential-store readability
    // check, not the removed EO expiry check. A tampered vault envelope is
    // proven unreadable, so the readout must go ok:false and report false
    // honestly; a warning-only store must stay ok:true.
    // `checks()` re-seeds the store, so the tampering is applied AFTER seeding
    // and before loading the module — the same ordering the test above uses.
    await seedStores({}, {})
    const path = join(dir, TRADING_FILE)
    const envelope = JSON.parse(readFileSync(path, "utf8"))
    const parts = envelope.pva1.split(":")
    parts[parts.length - 1] = Buffer.from("tampered-ciphertext-bytes").toString("base64")
    writeFileSync(path, JSON.stringify({ pva1: parts.join(":") }), "utf8")
    await loadHealth()
    Object.assign(process.env, { PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0xplaceholder-wallet" })

    const errorResult = await health.buildStartupHealthChecks({ now: NOW })
    const errorReadout = await health.runStartupHealth({ now: NOW })
    expect(errorResult.some((entry) => entry.severity === "error")).toBe(true)
    expect(errorReadout.ok).toBe(false)
    expect(Object.keys(errorReadout).sort()).toEqual(["at", "checks", "generatedAt", "ok"])

    // A readable store with a half-set CCXT pair is warning-only → ok stays true.
    await seedStores({}, {})
    await loadHealth()
    const warningOnly = await health.buildStartupHealthChecks({ now: NOW })
    const warningReadout = await health.runStartupHealth({ now: NOW })
    expect(warningOnly.some((entry) => entry.severity === "error")).toBe(false)
    expect(warningReadout.ok).toBe(true)
  })
})

describe("startup health audit and route", () => {
  beforeEach(async () => {
    await seedStores({ expertoptionToken: TOKEN, expertoptionTokenCapturedAt: new Date(NOW).toISOString() }, {})
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

  it("returns 401 for an unauthenticated GET even from loopback, and 200 with a session", async () => {
    await health.runStartupHealth({ now: NOW })
    const auth = await import("../services/auth.mjs")
    const account = await auth.createAccount({ email: "startup-health@example.com", password: "correct-horse-battery", name: "Startup" })
    handleApi = (await import("../handlers.mjs")).handleApi

    // Unauthenticated remote → 401.
    const remote = makeReq("GET", "/api/command-centre/startup-health")
    remote.socket = { remoteAddress: "203.0.113.9" }
    const remoteRes = makeRes()
    await handleApi(remote, remoteRes, "/api/command-centre/startup-health")
    expect(remoteRes.status).toBe(401)

    // Unauthenticated LOOPBACK → also 401. The readout names configured exchanges, token age and
    // rail mode, so it must not inherit the app-wide localhost bypass: behind a reverse proxy the
    // proxy itself is loopback, which would otherwise expose that metadata to a remote caller.
    const localRes = makeRes()
    await handleApi(makeReq("GET", "/api/command-centre/startup-health"), localRes, "/api/command-centre/startup-health")
    expect(localRes.status).toBe(401)

    // Authenticated → 200 with the cached boot result.
    const authed = makeReq("GET", "/api/command-centre/startup-health")
    authed.headers = { authorization: `Bearer ${account.token}` }
    const authedRes = makeRes()
    await handleApi(authed, authedRes, "/api/command-centre/startup-health")
    expect(authedRes.status).toBe(200)
    expect(authedRes.body.ok).toBe(true)
    expect(Array.isArray(authedRes.body.checks)).toBe(true)
    expect(typeof authedRes.body.generatedAt).toBe("string")
    expect(JSON.stringify(authedRes.body)).not.toContain(TOKEN)
  }, 15_000)
})
