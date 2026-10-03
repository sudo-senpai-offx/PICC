// WS-7 pre-push review — FINDING 2, asserted at the HTTP boundary, both halves.
//
// WHAT THE PROBE FOUND. Before WS-7 T18, `getAllIntegrations()` returned a static
// seed in which every row was `state: "unconfigured"` and NO CONFIGURATION FIELD
// EXISTED. T18 appended `newsSourceRows(env)` — derived from `process.env` at call
// time — to the ungated `/api/integrations` route. A probe with
// `NEWSAPI_API_KEY=<secret>`, `PICC_NEWS_NEWSAPI=on` and `PICC_NEWS_GDELT=on` then
// showed an anonymous non-loopback GET answering 200 with
//
//   newsapi: state=degraded configuredEvidence="NEWSAPI_API_KEY=set + PICC_NEWS_NEWSAPI=on"
//   gdelt:   state=degraded configuredEvidence="PICC_NEWS_GDELT=on"
//
// BOUNDED, AND THE BOUND IS ASSERTED HERE RATHER THAN ASSUMED: only env var NAMES
// and set/unset were emitted. `configEvidence` is built from the key list, never
// from what the keys hold, so no secret VALUE ever crossed. What crossed was the
// complement of the value: which credentials this deployment holds — pollable, and
// enough to tell a credential being added from one being removed.
//
// A SECOND, EASIER-TO-MISS LEAK IS ASSERTED TOO. `unconfiguredReason` also carries
// per-knob evidence, in its trailing "(observed: …)" clause and in the declared
// sentence that opens with "NEWSAPI_API_KEY is unset". Stripping only `state` and
// `configEvidence` would leave the SAME reconnaissance readable by any caller who
// simply has no key configured. So the negative below asserts the ABSENCE OF EVERY
// ENV VAR NAME in the response, which is the property that closes the whole class
// rather than the two fields the probe happened to print.
//
// THE HARNESS, carried from `t20rRouteAuthGates.test.mjs`: no `socket` on the
// request (so `isLocalhostRequest` is false and `requireAuth` is genuinely
// enforced) and one seeded account (so the first-run bootstrap branch is not
// taken). Every store is redirected through the SHARED `useIsolatedStoreDir`
// helper rather than by assigning `process.env`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const TOKEN = "d".repeat(64)
const USER_ROW = { id: "u1", email: "integrations@example.test", name: "IN", salt: "s", passwordHash: "h", createdAt: 1 }

/** Every env var name the D17 registry declares. Naming one in a public body is the leak. */
const ALL_KNOBS = [
  "NEWSAPI_API_KEY",
  "PICC_NEWS_NEWSAPI",
  "PICC_NEWS_GDELT",
  "CRYPTOPANIC_AUTH_TOKEN",
  "PICC_NEWS_CRYPTOPANIC",
  "PICC_NEWS_FEEDS",
  "PICC_NEWS_BROWSER_SOURCES"
]

const SECRET_VALUE = "newsapi-SUPER-SECRET-VALUE"
const CONFIGURED = {
  NEWSAPI_API_KEY: SECRET_VALUE,
  PICC_NEWS_NEWSAPI: "on",
  PICC_NEWS_GDELT: "on"
}

// ── harness ─────────────────────────────────────────────────────────────────

function makeReq(method, url, body, headers = {}) {
  const raw = body === null || body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url,
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
  // The THIRD argument is what the real router builds `new URL(...)` from, so the
  // query string has to survive it — `?ministry=` is how the gated sibling filters,
  // and a harness that dropped it would report "the ministry filter does not work"
  // when the route is fine.
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

let dirs = []

function redirect(name, prefix) {
  const dir = useIsolatedStoreDir(name, { prefix })
  dirs.push(dir)
  return dir
}

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value), "utf8")
}

function redirectAll() {
  for (const [name, prefix] of [
    ["PICC_AUTH_DATA_DIR", "intdisc-auth"],
    ["PICC_NOTIFICATION_DATA_DIR", "intdisc-notify"],
    ["PICC_TRADING_DATA_DIR", "intdisc-trading"],
    ["PICC_DATA_DIR", "intdisc-data"],
    ["PICC_ALERTS_DATA_DIR", "intdisc-alerts"],
    ["PICC_WATCHLIST_DATA_DIR", "intdisc-watchlist"],
    ["PICC_JOURNAL_DATA_DIR", "intdisc-journal"],
    ["PICC_PROFILE_DATA_DIR", "intdisc-profile"]
  ]) {
    redirect(name, prefix)
  }
}

function seedUser(authDir) {
  writeJson(authDir, "sessions.json", { sessions: {} })
  writeJson(authDir, "users.json", { users: [USER_ROW] })
}

function seedSession(authDir) {
  seedUser(authDir)
  writeJson(authDir, "sessions.json", {
    sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } }
  })
}

const HANDLERS_QUERY = "?ws7-integration-routes-disclosure"
async function loadHandlers() {
  vi.resetModules()
  const { handleApi } = await import("../handlers.mjs" + HANDLERS_QUERY)
  return handleApi
}

function rowsOf(body) {
  if (Array.isArray(body)) return body
  return Array.isArray(body?.entries) ? body.entries : []
}

/** The disclosure assertion, in one place: no env var NAME, and no secret VALUE. */
function expectNoConfigurationLeak(text, what) {
  for (const knob of ALL_KNOBS) {
    expect(text, `${knob} must not appear in an anonymous read via ${what}`).not.toContain(knob)
  }
  expect(text, `the credential VALUE must not appear via ${what}`).not.toContain(SECRET_VALUE)
  expect(text, `per-knob evidence must not appear via ${what}`).not.toContain("=set")
  expect(text, `per-knob evidence must not appear via ${what}`).not.toContain("(observed:")
  for (const field of ["configEvidence", "state"]) {
    expect(text, `${field} must not appear in an anonymous read via ${what}`).not.toContain(`"${field}"`)
  }
}

function configureEnv() {
  for (const [k, v] of Object.entries(CONFIGURED)) vi.stubEnv(k, v)
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE NEGATIVES — with credentials CONFIGURED (the probe's own shape)
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 finding 2 — the ungated integration catalog discloses no credential configuration", () => {
  let authDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    seedUser(authDir)
    configureEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("an anonymous GET /api/integrations carries no state, no evidence, and no env var name", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations")

    // Still PUBLIC — this is a field move, not a gate. Asserting 401 would pass
    // against a route broken in an unrelated way.
    expect(res.status, `expected the public 200, got ${JSON.stringify(res.body)}`).toBe(200)
    expectNoConfigurationLeak(JSON.stringify(res.body ?? {}), "GET /api/integrations")
  })

  it("an anonymous GET /api/integrations/trading carries none either", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations/trading")

    expect(res.status).toBe(200)
    expectNoConfigurationLeak(JSON.stringify(res.body ?? {}), "GET /api/integrations/trading")
  })

  it("the catalog is still COMPLETE — the rows an operator browses did not disappear with the fields", async () => {
    // The other half of a field move. If the projection had dropped rows rather
    // than fields, the route would be honest and useless.
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations")
    const rows = rowsOf(res.body)

    // 8 static seed rows + the 5 derived D17 rows.
    expect(rows).toHaveLength(13)
    for (const id of ["twelve-data", "binance-public", "rss-atom", "gdelt", "newsapi", "cryptopanic", "picc-own-browser"]) {
      expect(rows.map((r) => r.id), `${id} must survive the projection`).toContain(id)
    }
    // And the REFERENCE fields the room's D17 columns need are all still there.
    const newsapi = rows.find((r) => r.id === "newsapi")
    expect(newsapi.url).toBe("https://newsapi.org/")
    expect(newsapi.retrievalMode).toBe("licensed-api")
    expect(typeof newsapi.licensedBasis).toBe("string")
    expect(newsapi.boundary.keyRequired).toBe(true)
    expect(newsapi.purpose.length).toBeGreaterThan(0)
  })

  it("an anonymous GET /api/integrations/configuration is refused with 401", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations/configuration")

    expect(res.status, `expected 401, got ${JSON.stringify(res.body)}`).toBe(401)
    expect(res.body?.ok, "a refusal must never report success").not.toBe(true)
    expectNoConfigurationLeak(JSON.stringify(res.body ?? {}), "a 401 from /api/integrations/configuration")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE NEGATIVES — with NOTHING configured, which is where the OTHER leak is
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 finding 2 — the ungated catalog discloses nothing when nothing IS configured either", () => {
  let authDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    seedUser(authDir)
    // Explicitly UNSET every knob, so the "observed:" branch is the one exercised.
    for (const knob of ALL_KNOBS) vi.stubEnv(knob, "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("an anonymous read names no env var even though every source is absent", async () => {
    // The direction a `state`+`configEvidence` strip alone would miss: with no key
    // configured, `unconfiguredReason` reads "NEWSAPI_API_KEY is unset, so the
    // licensed NewsAPI leg cannot run. (observed: …)". That is the SAME
    // reconnaissance — it tells the reader the credential is absent.
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations")

    expect(res.status).toBe(200)
    expectNoConfigurationLeak(JSON.stringify(res.body ?? {}), "GET /api/integrations with nothing configured")
  })

  it("no row carries a verdict at all — not even a null one that pairs with the absence sentence", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations")
    for (const row of rowsOf(res.body)) {
      expect(Object.keys(row), `${row.id} must not carry state`).not.toContain("state")
      expect(Object.keys(row), `${row.id} must not carry configEvidence`).not.toContain("configEvidence")
      // `?? null` so an ABSENT key passes: the seed rows never had one, and the
      // property being missing is the honest state for a row with no verdict.
      expect(row.unconfiguredReason ?? null, `${row.id} must not carry an absence verdict`).toBeNull()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE CONTROLS — the gate admits a real session, and the room keeps its view
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 finding 2 — the controls: an authenticated caller still sees the configuration", () => {
  let authDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    seedSession(authDir)
    configureEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("the gated sibling returns state and configEvidence to a real session", async () => {
    // A route hard-coded to 401 would pass every negative above and be completely
    // broken. This is the control that makes them mean something.
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations/configuration", null, {
      authorization: `Bearer ${TOKEN}`
    })

    expect(res.status, `the gated sibling refused a REAL session: ${JSON.stringify(res.body)}`).toBe(200)
    const rows = rowsOf(res.body)
    expect(rows).toHaveLength(13)

    const newsapi = rows.find((r) => r.id === "newsapi")
    expect(newsapi.state, "the room's Configured badge needs this").toBe("degraded")
    expect(newsapi.configEvidence).toContain("NEWSAPI_API_KEY=set")
    expect(newsapi.configEvidence).toContain("PICC_NEWS_NEWSAPI=on")
    // And still never the VALUE — the bound the review confirmed, kept asserted.
    expect(JSON.stringify(res.body)).not.toContain(SECRET_VALUE)

    const gdelt = rows.find((r) => r.id === "gdelt")
    expect(gdelt.state).toBe("degraded")
    expect(gdelt.configEvidence).toContain("PICC_NEWS_GDELT=on")
  })

  it("the gated sibling honours ?ministry, so the room's per-ministry filter still works", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations/configuration?ministry=earnings", null, {
      authorization: `Bearer ${TOKEN}`
    })

    expect(res.status).toBe(200)
    const rows = rowsOf(res.body)
    expect(rows.map((r) => r.id)).toEqual(["sec-edgar-xbrl", "gotcashback", "affiliateroll"])
    expect(rows.every((r) => r.ministry === "earnings")).toBe(true)
  })

  it("an unknown ministry is still an honest empty list, not a 404", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/integrations/unknown-ministry")
    expect(res.status).toBe(200)
    expect(rowsOf(res.body)).toEqual([])
  })

  it("the gated route is ABOVE the ungated startsWith branch, so it is not swallowed by it", async () => {
    // The ordering hazard, pinned. `path.startsWith("/api/integrations/")` matches
    // `/api/integrations/configuration` too, so a gated route placed after it
    // would be answered by the projection before its gate ran — and every
    // negative above would pass while the gate was dead code.
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    const lines = src.split("\n")
    const gated = lines.findIndex((l) => l.includes('path === "/api/integrations/configuration"'))
    const catchAll = lines.findIndex((l) => l.includes('path.startsWith("/api/integrations/")'))
    expect(gated, "the gated sibling must exist").toBeGreaterThan(-1)
    expect(catchAll).toBeGreaterThan(-1)
    expect(gated, "the gated route must be dispatched BEFORE the ungated catch-all").toBeLessThan(catchAll)
  })

  it("both ungated branches call the PROJECTION, not the authenticated getter", async () => {
    // A static backstop, so the negative above cannot be satisfied by a projection
    // that is not the one wired up.
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    const flat = /if \(path === "\/api\/integrations" && req\.method === "GET"\) \{\s*\n\s*writeJson\(res, 200, getUnauthenticatedIntegrations\(\)\)/
    const byMinistry = /path\.startsWith\("\/api\/integrations\/"\)[^]*?getUnauthenticatedMinistryIntegrations\(ministry\)/
    expect(src, "the flat route must serve getUnauthenticatedIntegrations").toMatch(flat)
    expect(src, "the per-ministry route must serve getUnauthenticatedMinistryIntegrations").toMatch(byMinistry)
  })
})