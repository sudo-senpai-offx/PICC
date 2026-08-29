// Phase 5 — API surface for T6 (GET /api/trading/account-metrics) and T7
// (GET/POST /api/trading/capture-config) of PICC_HEADLESS_CAPTURE_ENGINE.md.
//
// Hermetic: handlers is imported FRESH per test with PICC_AUTH_DATA_DIR +
// PICC_ACCOUNT_METRICS_DATA_DIR + PICC_CAPTURE_CONFIG_DATA_DIR pointed at a
// tmp dir, so boot reads + writes can never touch the real server data dir.
// Localhost requests (requireAuth's isLocalhostRequest) exercise the "default"
// bucket; one test logs in a REAL account to prove per-user keying works end
// to end through the session token.
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
    socket: { remoteAddress: "127.0.0.1" }, // clientIp() → isLocalhostRequest
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

describe("headless capture-config + account-metrics API (T6/T7)", () => {
  let dir
  let handleApi
  let accountMetrics
  let captureProfiles
  let auth

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-headless-api-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    accountMetrics = await import("../services/accountMetrics.mjs")
    captureProfiles = await import("../services/captureProfiles.mjs")
    auth = await import("../services/auth.mjs")
  })

  afterEach(() => {
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_ACCOUNT_METRICS_DATA_DIR
    delete process.env.PICC_CAPTURE_CONFIG_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  // ── T6 — account metrics read ──────────────────────────────────────────────

  it("GET account-metrics is empty until something was observed", async () => {
    const res = await call(handleApi, "GET", "/api/trading/account-metrics")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.userId).toBe("default")
    expect(res.body.venues).toEqual({})
  })

  it("GET account-metrics returns the observed record with staleness derived live", async () => {
    await accountMetrics.putAccountMetrics("default", {
      venueId: "expertoption",
      balance: 432.1,
      demoWallet: { balance: 432.1, currency: "USD" },
      realWallet: { balance: null, currency: "USD" },
      active: "demo",
      demo: true,
      sourceLeg: "studio",
      observedAt: new Date().toISOString(),
      openPositions: null,
      exposurePct: null
    })
    const res = await call(handleApi, "GET", "/api/trading/account-metrics")
    const rec = res.body.venues.expertoption
    expect(rec.balance).toBe(432.1)
    expect(rec.demoWallet.balance).toBe(432.1)
    expect(rec.realWallet.balance).toBeNull()
    expect(rec.sourceLeg).toBe("studio")
    expect(rec.stale).toBe(false)
  })

  it("a record older than one metrics cadence reports stale:true", async () => {
    await accountMetrics.putAccountMetrics("default", {
      venueId: "expertoption",
      balance: 1,
      observedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
    })
    const res = await call(handleApi, "GET", "/api/trading/account-metrics")
    expect(res.body.venues.expertoption.stale).toBe(true)
  })

  it("?venue filters and never reports a fabricated zero for an absent venue", async () => {
    await accountMetrics.putAccountMetrics("default", {
      venueId: "expertoption",
      balance: null, // observed frame where the broker reported no balance
      observedAt: new Date().toISOString()
    })
    const res = await call(handleApi, "GET", "/api/trading/account-metrics?venue=expertoption")
    expect(res.body.venues.expertoption.balance).toBeNull()
    const other = await call(handleApi, "GET", "/api/trading/account-metrics?venue=iqoption")
    expect(other.body.venues).toEqual({}) // never captured → honest absence
  })

  // ── T7 — capture-config ────────────────────────────────────────────────────

  it("POST capture-config sanitizes unknown venues and clamps cadences", async () => {
    const res = await call(handleApi, "POST", "/api/trading/capture-config", {
      expertoption: { enabled: false, refreshCadenceMs: 10, metricsCadenceMs: 999_999_999_999 },
      notavenue: { enabled: true }
    })
    expect(res.status).toBe(200)
    const cfg = res.body.config
    expect(cfg.expertoption.enabled).toBe(false)
    expect(cfg.expertoption.refreshCadenceMs).toBe(60_000) // floor
    expect(cfg.expertoption.metricsCadenceMs).toBe(24 * 60 * 60 * 1000) // cap
    expect(cfg.notavenue).toBeUndefined()
  })

  it("POST capture-config feeds the runtime policy seam live", async () => {
    expect(captureProfiles.refreshCadenceMs("expertoption")).toBe(30 * 60 * 1000) // profile default
    await call(handleApi, "POST", "/api/trading/capture-config", {
      expertoption: { refreshCadenceMs: 120_000, metricsCadenceMs: 60_000 }
    })
    expect(captureProfiles.refreshCadenceMs("expertoption")).toBe(120_000)
    expect(captureProfiles.metricsCadenceMs("expertoption")).toBe(60_000)
  })

  it("persisted config survives a module restart (boot read applies it)", async () => {
    await call(handleApi, "POST", "/api/trading/capture-config", {
      expertoption: { enabled: false, refreshCadenceMs: 120_000 }
    })
    vi.resetModules()
    const cp2 = await import("../services/captureProfiles.mjs")
    const row = cp2.headlessSessionStatus().expertoption
    expect(row.enabled).toBe(false)
    expect(cp2.refreshCadenceMs("expertoption")).toBe(120_000)
  })

  it("removing a venue row from the config re-enables profile defaults live", async () => {
    await call(handleApi, "POST", "/api/trading/capture-config", {
      expertoption: { enabled: false, metricsCadenceMs: 60_000 }
    })
    expect(captureProfiles.isVenueEnabled("expertoption")).toBe(false)
    await call(handleApi, "POST", "/api/trading/capture-config", {
      iqoption: { metricsCadenceMs: 90_000 } // expertoption row GONE from the config
    })
    expect(captureProfiles.isVenueEnabled("expertoption")).toBe(true)
    expect(captureProfiles.metricsCadenceMs("expertoption")).toBe(5 * 60 * 1000)
  })

  it("GET capture-config returns the current user's persisted rows", async () => {
    await call(handleApi, "POST", "/api/trading/capture-config", {
      expertoption: { metricsCadenceMs: 120_000 }
    })
    const res = await call(handleApi, "GET", "/api/trading/capture-config")
    expect(res.body.ok).toBe(true)
    expect(res.body.config.expertoption.metricsCadenceMs).toBe(120_000)
  })

  it("a real authenticated session keys its own config bucket", async () => {
    const acct = await auth.createAccount({ email: "alice@example.com", password: "correct-horse-battery", name: "Alice" })
    expect(acct.error).toBeUndefined()
    const headers = { authorization: `Bearer ${acct.token}` }
    await call(handleApi, "POST", "/api/trading/capture-config", { expertoption: { metricsCadenceMs: 150_000 } }, headers)
    const resA = await call(handleApi, "GET", "/api/trading/capture-config", undefined, headers)
    expect(resA.body.userId).toBe(acct.user.id)
    expect(resA.body.config.expertoption.metricsCadenceMs).toBe(150_000)
    const resDefault = await call(handleApi, "GET", "/api/trading/capture-config")
    expect(resDefault.body.userId).toBe("default")
    expect(resDefault.body.config).toEqual({})
  })

  // ── T8 — headless-status (Mechanism D: the extension worker's poll) ────────

  it("GET headless-status reports every venue honestly before any run — never a claimed session", async () => {
    const res = await call(handleApi, "GET", "/api/trading/headless-status")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(Object.keys(res.body.venues).sort()).toEqual([
      "binance", "bybit", "deriv", "etoro", "expertoption",
      "iqoption", "kucoin", "okx", "olymptrade", "plus500"
    ])
    const eo = res.body.venues.expertoption
    expect(eo.status).toBe("idle") // full capture venue, never run — idle, never "ok"
    expect(eo.stale).toBe(true) // never captured = stale, honestly
    expect(eo.lastCaptureAt).toBeNull()
    expect(eo.tokenChangedAt).toBeNull()
    expect(eo.lastMetricsAt).toBeNull()
    expect(eo.name).toBe("ExpertOption")
    expect(res.body.venues.bybit.status).toBe("not-enabled")
    expect(res.body.venues.bybit.stale).toBe(false)
    expect(res.body.venues.expertoption.refreshCadenceMs).toBe(30 * 60 * 1000)
  })

  it("GET headless-status merges the observed metrics timestamp per venue", async () => {
    await accountMetrics.putAccountMetrics("default", {
      venueId: "expertoption",
      balance: 100,
      observedAt: "2026-08-30T12:00:00.000Z"
    })
    const res = await call(handleApi, "GET", "/api/trading/headless-status")
    expect(res.body.venues.expertoption.lastMetricsAt).toBe("2026-08-30T12:00:00.000Z")
    expect(res.body.venues.iqoption.lastMetricsAt).toBeNull() // never observed — honest
  })

  it("headless-status is authenticated: remote caller without a session gets 401", async () => {
    await auth.createAccount({ email: "bob@example.com", password: "correct-horse-battery", name: "Bob" })
    const res = makeRes()
    const remote = makeReq("GET", "/api/trading/headless-status")
    remote.socket = { remoteAddress: "203.0.113.5" } // NOT localhost
    await handleApi(remote, res, "/api/trading/headless-status")
    expect(res.status).toBe(401)
  })
})