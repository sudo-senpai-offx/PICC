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
//   4. headless-status venue-row shape — exact key set the popup renders
//      from, plus the endpoint's lastMetricsAt merge.
//   5. popup pure-storage-reader lock — the REAL popup.js runs in a vm
//      sandbox; it may read ONLY the pinned chrome.storage keys, send ONLY
//      the pinned read-only message actions, and never reference any storage
//      area or key that could hold raw session material.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

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
      "refreshCadenceMs", "stale", "status", "tokenChangedAt", "venueId"
    ])
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
      "refreshCadenceMs", "stale", "status", "tokenChangedAt", "venueId"
    ])
    expect(iq.lastMetricsAt).toBe("2026-08-30T12:00:00.000Z")
    expect(res.body.venues.expertoption.lastMetricsAt).toBeNull() // never observed → null
    expect(res.body.venues.expertoption.tokenChangedAt).toBeNull() // never captured → null, never a token
  })
})

describe("popup is a pure storage reader (T12 lock 5)", () => {
  const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../extensions/picc-overlay")
  const SOURCE = readFileSync(join(EXT_DIR, "popup.js"), "utf8")

  function makeHarness() {
    const recorded = {
      localGet: [], // key-lists / keys passed to chrome.storage.local.get
      localSet: [],
      syncGet: [],
      syncSet: [],
      messages: [], // { action } objects passed to runtime.sendMessage
      tabCreates: [],
      storageAreas: [], // storage.* areas the popup actually touched
      clicks: {} // element id → listeners
    }
    const els = new Map()
    const stubEl = () => ({
      textContent: "",
      className: "",
      title: "",
      value: "",
      children: [],
      classList: { toggle() {}, add() {} },
      listeners: {},
      append(...kids) { this.children.push(...kids) },
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) },
      setAttribute() {}
    })
    const getEl = (id) => {
      if (!els.has(id)) els.set(id, stubEl())
      return els.get(id)
    }
    const document = {
      getElementById: (id) => getEl(id),
      createElement: () => stubEl()
    }
    const storageArea = (kind, list) => ({
      get: async (keys) => { list.push(keys); return {} },
      set: async (entry) => { list.push(entry) }
    })
    const chrome = {
      storage: new Proxy(
        {
          local: storageArea("local", recorded.localSet === undefined ? [] : []),
          sync: storageArea("sync", recorded.syncSet === undefined ? [] : [])
        },
        {
          get(target, prop) {
            if (typeof prop === "string") recorded.storageAreas.push(prop)
            return target[prop]
          }
        }
      ),
      runtime: {
        sendMessage: async (msg) => { recorded.messages.push(msg); throw new Error("no listener") }
      },
      tabs: { create: async (t) => { recorded.tabCreates.push(t) } }
    }
    // wire storage `.get` recording into the areas
    chrome.storage.local.get = async (keys) => { recorded.localGet.push(keys); return {} }
    chrome.storage.local.set = async (entry) => { recorded.localSet.push(entry) }
    chrome.storage.sync.get = async (keys) => { recorded.syncGet.push(keys); return { piccSettings: undefined } }
    chrome.storage.sync.set = async (entry) => { recorded.syncSet.push(entry) }

    const context = vm.createContext({
      document,
      chrome,
      setInterval: () => 0, // capture nothing: the popup's 3s refresh loop must not run in the sandbox
      clearInterval: () => {},
      Date: globalThis.Date,
      console: { log() {}, warn() {}, error() {} }
    })
    vm.runInContext(SOURCE, context)
    const fire = (id, type = "click") => {
      for (const fn of getEl(id).listeners[type] ?? []) fn()
    }
    return { recorded, els, fire }
  }

  async function settle() {
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  }

  it("reads EXACTLY the pinned chrome.storage keys — the headless-status mirror and nothing else", async () => {
    const h = makeHarness()
    await settle()
    // Load-time refresh reads the T8 status mirror — the ONLY local keys the
    // popup may read.
    expect(h.recorded.localGet).toEqual([
      ["piccSensorStatus", "piccRelayEnabled", "piccServerOnline", "piccServerPort", "piccHeadlessStatus"]
    ])
    h.fire("relay") // the relay toggle re-reads the one key it mutates, then re-renders
    await settle()
    // Every local read is EITHER the T8 status mirror OR the relay toggle key —
    // no third key list may ever appear.
    const MIRROR = ["piccSensorStatus", "piccRelayEnabled", "piccServerOnline", "piccServerPort", "piccHeadlessStatus"]
    const isMirror = (keys) => JSON.stringify(keys) === JSON.stringify(MIRROR)
    expect(h.recorded.localGet.length).toBeGreaterThanOrEqual(2)
    for (const keys of h.recorded.localGet) {
      expect(isMirror(keys) || (Array.isArray(keys) && keys.length === 1 && keys[0] === "piccRelayEnabled")).toBe(true)
    }
    expect(h.recorded.localGet.filter((keys) => keys.length === 1).length).toBe(1) // exactly one standalone toggle read
    // Sync is only the backend-url setting, in every interaction.
    h.fire("open")
    h.fire("save")
    await settle()
    expect(h.recorded.syncGet.length).toBeGreaterThanOrEqual(3)
    for (const keys of h.recorded.syncGet) expect(keys).toEqual(["piccSettings"])
    for (const entry of h.recorded.syncSet) expect(Object.keys(entry)).toEqual(["piccSettings"])
    // Writes are limited to the relay toggle + the settings save.
    expect(h.recorded.localSet.map((e) => Object.keys(e))).toEqual([["piccRelayEnabled"]])
  })

  it("sends ONLY the two read-only probes — never a mutation or trading action", async () => {
    const h = makeHarness()
    await settle()
    const actions = h.recorded.messages.map((m) => m.action)
    expect(actions).toEqual(["server-status", "sensor-queue-depth"])
    for (const m of h.recorded.messages) {
      expect(Object.keys(m).sort()).toEqual(["action"]) // nothing but the action tag
    }
  })

  it("never touches a storage area or key that could hold raw session material", async () => {
    const h = makeHarness()
    await settle()
    h.fire("relay")
    h.fire("open")
    h.fire("save")
    await settle()
    // Only the local + sync areas exist for the popup; a session area (or any
    // new area) is a contract violation.
    const areas = h.recorded.storageAreas.filter((a) => a !== "local" && a !== "sync")
    expect(areas).toEqual([])
    const allKeys = [
      ...h.recorded.localGet.flat(),
      ...h.recorded.syncGet.flat(),
      ...h.recorded.localSet.flatMap((e) => Object.keys(e)),
      ...h.recorded.syncSet.flatMap((e) => Object.keys(e))
    ]
    // No key may name a token/credential surface — the popup renders engine
    // state, it never holds raw session material.
    expect(allKeys.some((k) => /token|ssid|secret|password|session/i.test(k))).toBe(false)
  })
})