// T12 — contract locks for PICC_HEADLESS_CAPTURE_ENGINE.md (Phase 5).
//
// Each lock pins a contract that the acceptance criteria name explicitly:
// a DELIBERATE violation must fail the corresponding test, then revert to a
// byte-identical green tree.
//
//   1. capture-config persisted FILE schema — exact shape, venue id
//      lowercasing, unknown-venue dropping, cadence clamping, per-user key
//      preservation on disk.
//   2. VITEST disk-isolation suppression — under plain vitest (no
//      PICC_CAPTURE_CONFIG_DATA_DIR / PICC_ACCOUNT_METRICS_DATA_DIR) the
//      capture-config + account-metrics files are NEVER touched on disk:
//      the state lives in memory, the file is byte-identical before/after.
//   3. account-metrics record shape — the full emitted vocabulary, with
//      absent → null (never a fabricated 0) and a genuine observed 0 kept as 0.
//   4. headless-status venue-row shape — exact key set the suite surfaces
//      from, plus the endpoint's lastMetricsAt merge.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

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

// The service files live in server/services/ → their DEFAULT data dir is
// server/data (the dir the VITEST guards must protect during a test run).
const SERVICES_DIR = dirname(fileURLToPath(new URL("../services/captureProfiles.mjs", import.meta.url)))
const DEFAULT_DATA_DIR = join(SERVICES_DIR, "../data")
const DEFAULT_CAPTURE_CONFIG_FILE = join(DEFAULT_DATA_DIR, "capture-config.json")
const DEFAULT_METRICS_FILE = join(DEFAULT_DATA_DIR, "account-metrics.json")

describe("capture contracts (T12 locks 1-4)", () => {
  let dir
  let handleApi
  let accountMetrics
  let captureProfiles
  let auth

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-t12-locks-"))
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

  // ── Lock 1 — capture-config persisted FILE schema ─────────────────────────

  it("capture-config file schema: exact per-user { venue → row } shape, sanitized + clamped", async () => {
    await call(handleApi, "POST", "/api/trading/capture-config", {
      expertoption: { enabled: false, refreshCadenceMs: 10, metricsCadenceMs: 999_999_999_999 },
      IQOPTION: { enabled: true }, // uppercase id must be folded to the lowercased catalog id
      notavenue: { enabled: true } // unknown venue must vanish from the file too
    })
    const onDisk = JSON.parse(readFileSync(join(dir, "capture-config.json"), "utf8"))
    // Exact shape: keys appear ONLY when the caller supplied them; cadences are
    // clamped to the venue floor/cap; the row survives as {enabled:true} with
    // no invented cadence keys.
    expect(onDisk).toEqual({
      default: {
        expertoption: { enabled: false, refreshCadenceMs: 60_000, metricsCadenceMs: 86_400_000 },
        iqoption: { enabled: true }
      }
    })
  })

  it("capture-config file schema: per-user buckets are preserved on disk", async () => {
    const acct = await auth.createAccount({ email: "lock@example.com", password: "correct-horse-battery", name: "Lock" })
    expect(acct.error).toBeUndefined()
    const headers = { authorization: `Bearer ${acct.token}` }
    await call(handleApi, "POST", "/api/trading/capture-config", { bybit: { refreshCadenceMs: 120_000 } })
    const resDefault = await call(handleApi, "POST", "/api/trading/capture-config", { deriv: { enabled: true } }, headers)
    expect(resDefault.body.userId).toBe(acct.user.id)
    const onDisk = JSON.parse(readFileSync(join(dir, "capture-config.json"), "utf8"))
    expect(onDisk[acct.user.id]).toEqual({ deriv: { enabled: true } })
    expect(onDisk.default).toEqual({ bybit: { refreshCadenceMs: 120_000 } }) // untouched by the other user's write
  })

  // ── Lock 2 — VITEST disk-isolation suppression ────────────────────────────

  it("VITEST suppression: without the PICC_*_DATA_DIR vars, no capture-config or account-metrics file is ever written", async () => {
    delete process.env.PICC_CAPTURE_CONFIG_DATA_DIR
    delete process.env.PICC_ACCOUNT_METRICS_DATA_DIR
    const snap = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null)
    const captureBefore = snap(DEFAULT_CAPTURE_CONFIG_FILE)
    const metricsBefore = snap(DEFAULT_METRICS_FILE)
    try {
      vi.resetModules()
      const cp = await import("../services/captureProfiles.mjs")
      const am = await import("../services/accountMetrics.mjs")
      // The engines must STILL work fully in memory — the suppression only
      // blocks the file, never the state (otherwise the pin could pass
      // vacuously because nothing ran).
      const cfg = await cp.saveCaptureConfigForUser("t12lock", {
        expertoption: { refreshCadenceMs: 90_000 }
      })
      expect(cfg.expertoption.refreshCadenceMs).toBe(90_000)
      expect(cp.captureConfigForUser("t12lock").expertoption.refreshCadenceMs).toBe(90_000)
      await am.putAccountMetrics("t12lock", {
        venueId: "iqoption",
        balance: 10,
        observedAt: new Date().toISOString()
      })
      expect(am.getAccountMetrics("t12lock", "iqoption").balance).toBe(10)
      // Byte-identical on disk — a dropped `canTouch*` guard would write here.
      expect(snap(DEFAULT_CAPTURE_CONFIG_FILE)).toBe(captureBefore)
      expect(snap(DEFAULT_METRICS_FILE)).toBe(metricsBefore)
      // And no orphaned tmp files from a half-guarded write.
      for (const f of [DEFAULT_CAPTURE_CONFIG_FILE, DEFAULT_METRICS_FILE]) {
        expect(existsSync(`${f}.${process.pid}.tmp`)).toBe(false)
      }
    } finally {
      process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
      process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
      vi.resetModules()
    }
  })

  // ── Lock 3 — account-metrics record shape (no fabricated zeros) ───────────

  it("metrics record shape: absent → null, a genuine observed 0 stays 0, full vocabulary pinned", async () => {
    const observedAt = "2026-08-30T12:00:00.000Z"
    // is_demo=0 with a single `balance` → real context, single value assigned
    // to the real wallet; currency defaults to USD (the documented default,
    // not a fabricated number).
    const real = accountMetrics.extractAccountState({
      venueId: "expertoption",
      frames: [{ at: 0, leg: "ws", payload: { is_demo: 0, balance: 250.5, currency: "eur" } }],
      observedAt
    })
    expect(real).toEqual({
      demoWallet: { balance: null, currency: "EUR" },
      realWallet: { balance: 250.5, currency: "EUR" },
      active: "real",
      currency: "EUR",
      balance: 250.5,
      demo: false,
      email: null,
      name: null,
      openPositions: null, // never observed → null, never 0/[]
      exposurePct: null,
      venueId: "expertoption",
      sourceLeg: "ws",
      observedAt
    })
    // A GENUINE reported 0 is preserved as 0 (the strict parser's other half).
    const zero = accountMetrics.extractAccountState({
      venueId: "expertoption",
      frames: [{ at: 0, leg: "ws", payload: { is_demo: 1, demo_balance: 0 } }],
      observedAt
    })
    expect(zero.demoWallet.balance).toBe(0)
    expect(zero.balance).toBe(0)
    expect(zero.realWallet.balance).toBeNull() // absent — not coerced to 0
    // An absent balance in a demo frame → null (the "no fabricated zero" pin).
    const absent = accountMetrics.extractAccountState({
      venueId: "expertoption",
      frames: [{ at: 0, leg: "ws", payload: { is_demo: 1 } }],
      observedAt
    })
    expect(absent.balance).toBeNull()
    expect(absent.demoWallet.balance).toBeNull()
  })

  // ── Lock 4 — headless-status venue-row shape ──────────────────────────────

  it("headless-status row shape: exact key set the popup renders from", async () => {
    const rows = captureProfiles.headlessSessionStatus()
    expect(Object.keys(rows).sort()).toEqual([
      "binance", "bybit", "deriv", "etoro", "expertoption",
      "iqoption", "kucoin", "okx", "olymptrade", "plus500"
    ])
    const row = rows.expertoption
    expect(Object.keys(row).sort()).toEqual([
      "enabled", "lastCaptureAt", "lastStateAt", "name", "reason",
      "refreshCadenceMs", "sourceLeg", "stale", "status", "tokenChangedAt", "venueId"
    ])
    // T13 provenance: a venue that never captured reports sourceLeg null —
    // an honest "no leg has ever captured this", never a guessed one.
    expect(row.sourceLeg).toBeNull()
    // T11 reflect: iqoption is now a full capture venue.
    expect(rows.iqoption.status).toBe("idle")
    expect(rows.iqoption.stale).toBe(true) // CAN capture but never HAS
    expect(rows.iqoption.enabled).toBe(true)
  })

  it("headless-status endpoint row = the engine row + lastMetricsAt (popup's merge contract)", async () => {
    await accountMetrics.putAccountMetrics("default", {
      venueId: "iqoption",
      balance: 50,
      observedAt: "2026-08-30T12:00:00.000Z"
    })
    const res = await call(handleApi, "GET", "/api/trading/headless-status")
    expect(res.status).toBe(200)
    const iq = res.body.venues.iqoption
    expect(Object.keys(iq).sort()).toEqual([
      "enabled", "lastCaptureAt", "lastMetricsAt", "lastStateAt", "name", "reason",
      "refreshCadenceMs", "sourceLeg", "stale", "status", "tokenChangedAt", "venueId"
    ])
    expect(iq.lastMetricsAt).toBe("2026-08-30T12:00:00.000Z")
    expect(res.body.venues.expertoption.lastMetricsAt).toBeNull() // never observed → null
    expect(res.body.venues.expertoption.tokenChangedAt).toBeNull() // never captured → null, never a token
  })
})