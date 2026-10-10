// Bookmarklet click-to-capture leg (Wave 3+ backlog, capture-hooks gap).
//
// A `javascript:` snippet the operator saves MANUALLY (never auto-installed)
// POSTs the current page's explicitly-readable DOM snapshot (candles/balances
// the operator can already see) to a requireAuth-guarded ingest route. The
// route validates through the SAME capture-profile validation as the existing
// hooks (unknown venues → honest not-enabled with the verbatim reasons) and
// stores happy-path observations via the existing account-metrics profile path
// (the store headless-status + command-centre overview already consume).
//
// Honesty-first security: per-click consent only (no background scraping),
// payload size caps, no credential capture (input/password/cookie values are
// stripped — proven below with a hostile DOM fixture).
//
// Hermetic: stores redirected through the SHARED `useIsolatedStoreDir` helper
// (never by assigning `process.env`); remote callers omit `socket` so
// requireAuth enforces rather than taking its loopback bypass; a seeded user
// keeps requireAuth out of its first-run bootstrap branch.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"
import {
  BOOKMARKLET_MAX_BYTES,
  bookmarkletSnippet,
  ingestBookmarkletCapture,
  sanitizeBookmarkletSnapshot,
  validateBookmarkletPayload
} from "../services/bookmarkletCapture.mjs"

const TOKEN = "c".repeat(64)
const USER_ROW = { id: "u1", email: "bookmarklet@example.test", name: "BM", salt: "s", passwordHash: "h", createdAt: 1 }

let dirs = []

function redirectStores() {
  dirs = [
    useIsolatedStoreDir("PICC_AUTH_DATA_DIR", { prefix: "bm-auth" }),
    useIsolatedStoreDir("PICC_ACCOUNT_METRICS_DATA_DIR", { prefix: "bm-metrics" }),
    useIsolatedStoreDir("PICC_TRADING_DATA_DIR", { prefix: "bm-trading" }),
    useIsolatedStoreDir("PICC_CAPTURE_CONFIG_DATA_DIR", { prefix: "bm-capture" })
  ]
  return { authDir: dirs[0] }
}

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value), "utf8")
}

function seedUser(authDir) {
  writeJson(authDir, "sessions.json", { sessions: {} })
  writeJson(authDir, "users.json", { users: [USER_ROW] })
}

function seedSession(authDir) {
  seedUser(authDir)
  writeJson(authDir, "sessions.json", {
    sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } }
  })
}

function makeReq(method, url, body, headers = {}) {
  const raw = body === null || body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url,
    // NO `socket` — this is what makes the caller remote (non-loopback).
    headers: { host: "picc.example.test", "content-type": "application/json", ...headers },
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
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}

const HANDLERS_QUERY = "?bookmarklet-capture"
async function loadHandlers() {
  vi.resetModules()
  const { handleApi } = await import("../handlers.mjs" + HANDLERS_QUERY)
  return handleApi
}

async function call(api, method, path, body, headers) {
  const res = makeRes()
  await api(makeReq(method, path, body, headers), res, path)
  return res
}

const HOSTILE_SNAPSHOT = {
  title: "IQ Option — live",
  text: "Balance 1,234.56 demo",
  balances: { demo: "1234.56", currency: "USD" },
  html: '<div>Balance 1,234.56</div><input type="text" name="amount" value="500"><input type="password" name="pwd" value="hunter2">',
  cookies: "ssid=STOLEN-SSID-VALUE; sessionid=STOLEN-SESSION; theme=dark",
  inputs: [{ name: "email", value: "op@example.test" }, { name: "password", value: "hunter2" }],
  password: "hunter2",
  token: "STOLEN-TOKEN",
  nested: { deep: { sessionToken: "STOLEN-DEEP", note: "keep me" } }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe("bookmarklet sanitizer — hostile DOM fixture", () => {
  beforeEach(() => { redirectStores() })

  it("strips passwords, cookies, inputs and tokens; keeps visible balances", () => {
    const { snapshot, stripped } = sanitizeBookmarkletSnapshot(HOSTILE_SNAPSHOT)
    expect(stripped).toBeGreaterThan(0)
    const blob = JSON.stringify(snapshot)
    for (const secret of ["hunter2", "STOLEN-SSID-VALUE", "STOLEN-SESSION", "STOLEN-TOKEN", "STOLEN-DEEP", "op@example.test"]) {
      expect(blob, `must not contain ${secret}`).not.toContain(secret)
    }
    // No <input> element survives with a value.
    expect(blob).not.toMatch(/<input/i)
    // The operator-visible observation survives.
    expect(blob).toContain("1,234.56")
    expect(snapshot.balances?.currency).toBe("USD")
  })

  it("never mutates the caller's object", () => {
    const before = JSON.stringify(HOSTILE_SNAPSHOT)
    sanitizeBookmarkletSnapshot(HOSTILE_SNAPSHOT)
    expect(JSON.stringify(HOSTILE_SNAPSHOT)).toBe(before)
  })
})

describe("bookmarklet profile validation — verbatim honest reasons", () => {
  beforeEach(() => { redirectStores() })

  it("unknown venue → error/unknown-venue, same as captureVenue", async () => {
    const { captureVenue } = await import("../services/captureProfiles.mjs")
    const hook = await captureVenue("metaapi")
    const r = await ingestBookmarkletCapture({
      venueId: "metaapi", url: "https://metaapi.example.test/", snapshot: { text: "x" }, userId: "u1"
    })
    expect(r.state).toBe("error")
    expect(r.reason).toBe(hook.reason)
    expect(r.reason).toMatch(/unknown venue/)
  })

  it("catalog-only + capture-only venues → verbatim not-enabled reasons", async () => {
    const { captureVenue } = await import("../services/captureProfiles.mjs")
    for (const id of ["bybit", "etoro", "plus500", "olymptrade", "deriv", "binance", "kucoin", "okx"]) {
      const hook = await captureVenue(id)
      expect(hook.state).toBe("not-enabled")
      const r = await ingestBookmarkletCapture({
        venueId: id, url: `https://${id}.example.test/`, snapshot: { text: "x" }, userId: "u1"
      })
      expect(r.state).toBe("not-enabled")
      expect(r.reason, `${id} reason must be verbatim`).toBe(hook.reason)
    }
  })
})

describe("bookmarklet happy path — stored via the existing profile path", () => {
  // Fresh module graph per test: the service and the store reader must share
  // ONE accountMetrics instance, and METRICS_FILE must resolve to this test's
  // redirected dir (computed at module load, i.e. AFTER redirectStores()).
  let svc
  beforeEach(async () => {
    redirectStores()
    vi.resetModules()
    svc = await import("../services/bookmarkletCapture.mjs?bm-happy")
  })

  it("iqoption snapshot lands in account-metrics with sourceLeg bookmarklet", async () => {
    const { accountMetricsForUser } = await import("../services/accountMetrics.mjs")
    const r = await svc.ingestBookmarkletCapture({
      venueId: "iqoption",
      url: "https://iqoption.com/en/trade",
      snapshot: { title: "IQ", text: "Balance 1,234.56 demo", balances: { demo: "1234.56", currency: "USD" } },
      userId: "u1"
    })
    expect(r.state).toBe("ok")
    expect(r.saved).toBe(true)
    expect(r.sourceLeg).toBe("bookmarklet")
    expect(JSON.stringify(r)).not.toContain("1234.56")
    const stored = accountMetricsForUser("u1").iqoption
    expect(stored).toBeTruthy()
    expect(stored.sourceLeg).toBe("bookmarklet")
    expect(stored.observedAt).toBe(r.at)
    expect(JSON.stringify(stored)).toContain("1,234.56")
  })

  it("hostile happy-path stores nothing sensitive", async () => {
    const { accountMetricsForUser } = await import("../services/accountMetrics.mjs")
    const r = await svc.ingestBookmarkletCapture({
      venueId: "iqoption", url: "https://iqoption.com/en/trade", snapshot: HOSTILE_SNAPSHOT, userId: "u-h2"
    })
    expect(r.state).toBe("ok")
    const blob = JSON.stringify(accountMetricsForUser("u-h2").iqoption ?? {})
    for (const secret of ["hunter2", "STOLEN-SSID-VALUE", "STOLEN-SESSION", "STOLEN-TOKEN", "STOLEN-DEEP"]) {
      expect(blob).not.toContain(secret)
    }
  })
})

describe("bookmarklet payload limits", () => {
  // Same fresh-graph rule as the happy-path suite: the refusal must be proven
  // against the SAME store instance the ingest would have written to.
  let svc
  beforeEach(async () => {
    redirectStores()
    vi.resetModules()
    svc = await import("../services/bookmarkletCapture.mjs?bm-limits")
  })

  it("oversize payloads are refused before any store write", async () => {
    const { accountMetricsForUser } = await import("../services/accountMetrics.mjs")
    const big = { venueId: "iqoption", url: "https://iqoption.com/", snapshot: { text: "x".repeat(BOOKMARKLET_MAX_BYTES + 1) } }
    expect(JSON.stringify(big).length).toBeGreaterThan(BOOKMARKLET_MAX_BYTES)
    const v = svc.validateBookmarkletPayload(big)
    expect(v.ok).toBe(false)
    expect(v.error).toMatch(/too-large/)
    const r = await svc.ingestBookmarkletCapture({ ...big, userId: "u-big" })
    expect(r.state).toBe("error")
    expect(accountMetricsForUser("u-big").iqoption).toBeUndefined()
  })

  it("missing venue/url/snapshot are 400-class validation failures", () => {
    expect(svc.validateBookmarkletPayload({}).ok).toBe(false)
    expect(svc.validateBookmarkletPayload({ venueId: "iqoption", url: "https://iqoption.com/" }).ok).toBe(false)
    expect(svc.validateBookmarkletPayload({ venueId: "", url: "https://iqoption.com/", snapshot: {} }).ok).toBe(false)
    expect(svc.validateBookmarkletPayload({ venueId: "iqoption", url: "not-a-url", snapshot: {} }).ok).toBe(false)
  })
})

describe("bookmarklet snippet — explicit per-click consent only", () => {
  beforeEach(() => { redirectStores() })

  it("reads only visible text; never cookies, storage, or inputs", () => {
    const snippet = bookmarkletSnippet()
    expect(snippet.startsWith("javascript:")).toBe(true)
    expect(snippet).toContain("innerText")
    expect(snippet).toContain("fetch")
    for (const banned of ["document.cookie", "localStorage", "sessionStorage", "querySelector", "getElementById", "password", "setInterval", "addEventListener"]) {
      expect(snippet, `snippet must not contain ${banned}`).not.toContain(banned)
    }
  })
})

describe("bookmarklet route — auth + honesty at the HTTP boundary", () => {
  let authDir

  beforeEach(() => {
    const r = redirectStores()
    authDir = r.authDir
    seedUser(authDir)
  })

  it("POST without a session → 401 and nothing stored", async () => {
    const api = await loadHandlers()
    const res = await call(api, "POST", "/api/trading/bookmarklet-capture", {
      venueId: "iqoption", url: "https://iqoption.com/", snapshot: { text: "Balance 1" }
    })
    expect(res.status).toBe(401)
    expect(res.body?.ok).not.toBe(true)
    const { accountMetricsForUser } = await import("../services/accountMetrics.mjs")
    expect(accountMetricsForUser("u1").iqoption).toBeUndefined()
  }, 20_000)

  it("POST with a session → 200 ok for the enabled venue", async () => {
    seedSession(authDir)
    const api = await loadHandlers()
    const res = await call(api, "POST", "/api/trading/bookmarklet-capture", {
      venueId: "iqoption", url: "https://iqoption.com/en/trade", snapshot: { text: "Balance 1,234.56 demo" }
    }, { authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(200)
    expect(res.body?.report?.state).toBe("ok")
    expect(res.body?.report?.sourceLeg).toBe("bookmarklet")
  }, 20_000)

  it("POST unknown venue with a session → honest 400, verbatim reason", async () => {
    seedSession(authDir)
    const api = await loadHandlers()
    const res = await call(api, "POST", "/api/trading/bookmarklet-capture", {
      venueId: "metaapi", url: "https://metaapi.example.test/", snapshot: { text: "x" }
    }, { authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(400)
    expect(res.body?.report?.reason).toMatch(/unknown venue/)
  }, 20_000)

  it("POST oversize with a session → 413", async () => {
    seedSession(authDir)
    const api = await loadHandlers()
    const res = await call(api, "POST", "/api/trading/bookmarklet-capture", {
      venueId: "iqoption", url: "https://iqoption.com/", snapshot: { text: "x".repeat(BOOKMARKLET_MAX_BYTES + 1) }
    }, { authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(413)
  }, 20_000)

  it("GET snippet without a session → 401", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/trading/bookmarklet-capture", null)
    expect(res.status).toBe(401)
  }, 20_000)

  it("GET snippet with a session → 200 with manual-install docs", async () => {
    seedSession(authDir)
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/trading/bookmarklet-capture", null, { authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(200)
    expect(typeof res.body?.snippet).toBe("string")
    expect(res.body.snippet.startsWith("javascript:")).toBe(true)
    expect(typeof res.body?.usage).toBe("string")
    expect(res.body.usage).toMatch(/manual/i)
  }, 20_000)
})
