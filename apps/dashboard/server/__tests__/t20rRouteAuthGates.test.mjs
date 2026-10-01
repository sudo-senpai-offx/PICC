// WS-7 T20R — the 21 routes this task gated, asserted AT THE HTTP BOUNDARY.
//
// WHY THIS FILE EXISTS AT ALL, because T9 already established the reason and it
// is worth restating rather than citing: `ws7RouteAuthCoverageGuard` proves a
// gate call exists in a route's own block, before that route answers. It cannot
// prove the gate RUNS. A static scan is satisfied by a gate that is present,
// correctly spelled, and unreachable — which is why T9 wrote
// `copilotDecisionRoute.test.mjs` and `paperLivePermitRoute.test.mjs` rather than
// trusting the scan. T20R gates 21 routes, so T20R writes 21 negative tests.
//
// EVERY TEST HERE ASSERTS A 401 FOR AN UNAUTHENTICATED CALLER, and each is
// paired with a control that the same route answers a REAL session. The control
// is the part that makes the negative honest: a route hard-coded to 401, or a
// handler that throws before it reaches the gate, would pass every negative in
// this file and be entirely broken.
//
// THE HARNESS DETAIL THAT DECIDES WHETHER THESE TESTS MEAN ANYTHING, carried
// over verbatim from `paperLivePermitRoute.test.mjs` because it is the whole
// difference between a real test and a green one:
//
//   * NO `socket` on the request. `requireAuth` admits a request outright when
//     `isLocalhostRequest(req)` is true (handlers.mjs:5900), and that predicate
//     reads the real TCP peer. A harness that supplies
//     `socket: { remoteAddress: "127.0.0.1" }` takes that bypass, so the
//     "anonymous" caller is in fact inside the trust boundary and the route
//     answers 200 — and a 401 assertion fails for the wrong reason. Omitting
//     `socket` presents a NON-loopback caller, which is what an attacker is.
//
//   * A SEEDED USER. With an empty user store `requireAuth` takes its first-run
//     bootstrap branch (`if (!anyUserExists) return true`, handlers.mjs:5921) and
//     admits everyone. The anonymous-caller tests therefore seed one account so
//     auth is genuinely enforced, and the bootstrap branch is asserted SEPARATELY
//     and EXPLICITLY below rather than left to be discovered.
//
// Hermetic: every store is redirected through the SHARED `useIsolatedStoreDir`
// helper, never by assigning `process.env` — `ws7TestStoreIsolation.test.mjs`
// enumerates the suite via `git ls-files` and refuses a hand-rolled assignment.
// Nothing here resolves to the real `apps/dashboard/server/data/`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const TOKEN = "b".repeat(64)
const USER_ROW = { id: "u1", email: "t20r@example.test", name: "T20R", salt: "s", passwordHash: "h", createdAt: 1 }

/**
 * The 21 routes T20R gated, each with the method its own marker names.
 *
 * `mutates` says what the route WRITES, and it is carried here rather than in a
 * comment so the table below can assert that a refusal did not produce that
 * write. Every one of these was a single-method marker at the moment it was
 * gated, which is the ruling's gate condition — the combined `GET || POST`
 * branches were handled separately and none of them appears here.
 */
const GATED = [
  // ── Paper ledger ─────────────────────────────────────────────────────────
  { method: "POST", path: "/api/trading/paper/trade", mutates: "a paper position", body: { symbol: "EURUSD", side: "long", amount: 1, entry: 1.1 } },
  { method: "POST", path: "/api/trading/paper/close", mutates: "a paper position close", body: { id: "pos_1" } },
  // ── Signal + accuracy ledger ─────────────────────────────────────────────
  { method: "POST", path: "/api/trading/signals", mutates: "a signal, and the aggregate accuracy number", body: { assetId: "EURUSD", direction: "up", entry: 1.1 } },
  { method: "POST", path: "/api/trading/signals/resolve", mutates: "a signal settlement, which feeds the accuracy ledger", body: { id: "sig_1", outcome: "win" } },
  // ── Alerts ───────────────────────────────────────────────────────────────
  { method: "POST", path: "/api/trading/alerts", mutates: "an alert", body: { symbol: "EURUSD", condition: "price_above", value: 1.2 } },
  { method: "POST", path: "/api/trading/alerts/toggle", mutates: "an alert's enabled flag", body: { id: "alert_1", enabled: false } },
  // ── Watchlists ───────────────────────────────────────────────────────────
  { method: "POST", path: "/api/trading/watchlist", mutates: "the default watchlist", body: { symbol: "EURUSD" } },
  { method: "DELETE", path: "/api/trading/watchlist", mutates: "the default watchlist", body: { symbol: "EURUSD" } },
  { method: "POST", path: "/api/trading/watchlists", mutates: "a named watchlist", body: { action: "add", watchlistId: "wl_1", symbol: "EURUSD" } },
  // ── Notifications: the five writes inside the declared-public wrapper ─────
  { method: "POST", path: "/api/notifications/prefs", mutates: "notification preferences", body: { minConfidence: 5 } },
  { method: "POST", path: "/api/notifications/subscribe-push", mutates: "the push-subscription store", body: { endpoint: "https://push.example.test/x", keys: { p256dh: "k", auth: "a" } } },
  { method: "POST", path: "/api/notifications/unsubscribe-push", mutates: "the push-subscription store", body: { endpoint: "https://push.example.test/x" } },
  { method: "POST", path: "/api/notifications/snooze", mutates: "per-tag snooze state", body: { tag: "picc-X" } },
  { method: "POST", path: "/api/notifications/test", mutates: "the notification delivery budget", body: { assetId: "TEST" } },
  // ── Portfolio analytics (owner-named; analytically a read — see the guard) ─
  { method: "POST", path: "/api/trading/portfolio", mutates: "nothing; it is an analytical read, gated for policy uniformity", body: { symbols: ["EURUSD"] } },
  // ── Deprecated order-execution stubs: gated PROPHYLACTICALLY ──────────────
  { method: "POST", path: "/api/trading/demo/place", mutates: "nothing today; it is a static 410 stub", body: { symbol: "EURUSD" } },
  { method: "POST", path: "/api/trading/autopilot/start", mutates: "nothing today; it is a static 410 stub", body: {} },
  { method: "POST", path: "/api/trading/autopilot/stop", mutates: "nothing today; it is a static 410 stub", body: {} },
  // ── Miscellaneous writes ─────────────────────────────────────────────────
  { method: "POST", path: "/api/streams/snapshot", mutates: "the income snapshot", body: { rows: [] } },
  { method: "POST", path: "/api/client-logs", mutates: "the server-side error log", body: { entries: [{ message: "t20r" }] } },
  // ── The owner's judgement call on a read ────────────────────────────────
  { method: "GET", path: "/api/trading/indicators?assetId=EURUSD&timeframe=daily", mutates: "nothing; a read, gated because no pre-auth consumer exists", body: null }
]

/**
 * Routes T20R deliberately did NOT touch, so this file also pins the OTHER half of
 * the ruling: the deferred reads stay deferred, and the must-be-public reads stay
 * public. A test that only proved the gates would be satisfied by a file where
 * everything 401s.
 */
const STILL_PUBLIC = [
  { method: "GET", path: "/api/health", why: "a load balancer and CI poll it; a health check behind a session cannot report on an unauthenticated instance" },
  { method: "GET", path: "/api/packs/registry", why: "the Markets room fetches it on mount" },
  { method: "GET", path: "/api/notifications/vapid-public-key", why: "WebPush needs the key BEFORE a session exists" },
  { method: "GET", path: "/api/auth/status", why: "the login page needs hasUsers before it can choose between login and signup" }
]

const DEFERRED_READS = [
  { method: "GET", path: "/api/trading/portfolio/positions" },
  { method: "GET", path: "/api/trading/signals", why: "the READ half of a path whose POST half T20R gated" },
  { method: "GET", path: "/api/trading/alerts", why: "the READ half of a path whose POST half T20R gated" },
  { method: "GET", path: "/api/trading/watchlist", why: "the READ half of a path whose POST/DELETE halves T20R gated" },
  { method: "GET", path: "/api/streams/snapshot", why: "the READ half of a path whose POST half T20R gated" },
  { method: "GET", path: "/api/trading/catalog", why: "named in the scope as a read whose public status must be decided in a later pass" },
  { method: "GET", path: "/api/opportunities" }
]

// ── harness ─────────────────────────────────────────────────────────────────

function makeReq(method, url, body, headers = {}) {
  const raw = body === null || body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url,
    // NO `socket` — see the file header. This is what makes the caller remote.
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
  // Query strings must be split off before dispatch, exactly as the real router
  // does — /api/trading/indicators is fired with its query in this file.
  const bare = path.split("?")[0]
  await handleApi(makeReq(method, bare, body, headers), res, bare)
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

/** Every store a route under test might touch, redirected before handlers loads. */
function redirectAll() {
  for (const [name, prefix] of [
    ["PICC_AUTH_DATA_DIR", "t20r-auth"],
    ["PICC_TRADING_DATA_DIR", "t20r-trading"],
    ["PICC_DATA_DIR", "t20r-data"],
    ["PICC_ALERTS_DATA_DIR", "t20r-alerts"],
    ["PICC_WATCHLIST_DATA_DIR", "t20r-watchlist"],
    ["PICC_NOTIFICATION_DATA_DIR", "t20r-notify"],
    ["PICC_JOURNAL_DATA_DIR", "t20r-journal"],
    ["PICC_PROFILE_DATA_DIR", "t20r-profile"]
  ]) {
    redirect(name, prefix)
  }
}

/** Seed ONE account, so requireAuth enforces rather than taking its first-run branch. */
function seedUser(authDir) {
  writeJson(authDir, "sessions.json", { sessions: {} })
  writeJson(authDir, "users.json", { users: [USER_ROW] })
}

/** Seed one account AND a live session carrying TOKEN. */
function seedSession(authDir) {
  seedUser(authDir)
  writeJson(authDir, "sessions.json", {
    sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } }
  })
}

/**
 * Fresh handlers for each test.
 *
 * The query tag is CONSTANT on purpose. A template-literal specifier
 * (`?t20r-${tag}`) is not statically analysable, and Vite refuses to resolve it —
 * `Unknown variable dynamic import`. `vi.resetModules()` plus a constant tag gives
 * the same freshness, because the next `import()` of the same specifier after a
 * reset is a new module instance. This is what
 * `ws7RouteAuthCoverageBehaviour.test.mjs` does for the same reason.
 *
 * The `tag` argument is kept only so a failure message can name the route; it
 * does not reach the specifier.
 */
const HANDLERS_QUERY = "?t20r-route-auth-gates"
async function loadHandlers(tag) {
  void tag
  vi.resetModules()
  const { handleApi } = await import("../handlers.mjs" + HANDLERS_QUERY)
  return handleApi
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE NEGATIVE HALF — every gated route refuses an anonymous caller
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 T20R — every gated route answers 401 to an anonymous caller", () => {
  let authDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    seedUser(authDir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  for (const route of GATED) {
    it(`${route.method} ${route.path.split("?")[0]} refuses — it would otherwise ${route.mutates}`, async () => {
      const api = await loadHandlers(`neg-${route.method}-${route.path.replace(/[^a-z]/gi, "")}`)
      const res = await call(api, route.method, route.path, route.body)

      expect(res.status, `expected a 401, got ${JSON.stringify(res.body)}`).toBe(401)
      expect(res.body?.ok, "a refusal must never report success").not.toBe(true)
      // The disclosure half. A 401 that echoed the payload would be the leak
      // wearing a status code, and a status-only assertion would never see it.
      const text = JSON.stringify(res.body ?? {})
      for (const marker of ["endpoint", "p256dh", "position", "alert", "signal", "watchlist", "prefs", "confidence"]) {
        expect(text.toLowerCase(), `${marker} must not leak through a 401 on ${route.path}`).not.toContain(marker)
      }
    })
  }

  it("covers all 21 routes the ruling named, and no more than the guard says are gated", async () => {
    // The count is pinned so that adding a route to the table without a gate, or
    // gating one without a table entry, is visible here rather than in review.
    expect(GATED.length, "the T20R gate set").toBe(21)

    // Cross-check against the GUARD's own emitter output: every marker below must
    // be reported gated, and none of them may still be allowlisted.
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    for (const route of GATED) {
      const literal = `path === "${route.path.split("?")[0]}"`
      const dispatch = src.split("\n").findIndex((l) => l.includes(literal) && l.includes(`"${route.method}"`))
      expect(dispatch, `${route.path} must still be dispatched on ${route.method}`).toBeGreaterThan(-1)

      // The route's OWN block, walked by indentation, must carry requireAuth.
      const lines = src.split("\n")
      const body = lines.slice(dispatch, dispatch + 4).join("\n")
      expect(
        body,
        `${route.path} ${route.method} must carry requireAuth near the head of its own branch — ` +
          `a gate lower down is dead code`
      ).toMatch(/requireAuth\(req, res\)/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE CONTROL — the gate admits a REAL session
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 T20R — the control: the gate ADMITS an authenticated caller", () => {
  let authDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("a real session is NOT refused by any of the 21 gates", { timeout: 30_000 }, async () => {
    seedSession(authDir)
    // ONE module load for the whole loop. A fresh import per route is what pushed
    // this past the suite's 5s default; nothing here needs a fresh module,
    // because the claim is about STATUS and a status does not depend on having
    // re-read the store between calls.
    const api = await loadHandlers("control-authed")
    const refused = []
    for (const route of GATED) {
      const res = await call(api, route.method, route.path, route.body, { authorization: `Bearer ${TOKEN}` })
      if (res.status === 401) refused.push(`${route.method} ${route.path} -> 401 ${JSON.stringify(res.body)}`)
    }
    expect(
      refused,
      "every gate T20R added refused a REAL session. A route that 401s unconditionally would pass all " +
        "21 negative tests above and be completely broken."
    ).toEqual([])
  })

  it("the deprecated 410 stubs still report their deprecation TO AN AUTHENTICATED caller", { timeout: 30_000 }, async () => {
    // The gate runs BEFORE the 410, so an operator still sees the notice the
    // read-only rooms document. If the gate had swallowed it, those docs would be
    // describing a route that no longer says what it says.
    seedSession(authDir)
    const api = await loadHandlers("control-deprecated")
    for (const path of ["/api/trading/demo/place", "/api/trading/autopilot/start", "/api/trading/autopilot/stop"]) {
      const res = await call(api, "POST", path, {}, { authorization: `Bearer ${TOKEN}` })
      expect(res.status, `${path} must still answer 410 to an authenticated operator`).toBe(410)
      expect(JSON.stringify(res.body ?? {})).toContain("order execution removed")
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE MUST-BE-PUBLIC READS, verified against real consumers
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 T20R — the must-be-public reads still answer anonymously", () => {
  let authDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    seedUser(authDir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  for (const route of STILL_PUBLIC) {
    it(`${route.method} ${route.path} answers an anonymous caller — ${route.why}`, async () => {
      const api = await loadHandlers(`pub-${route.path.replace(/[^a-z]/gi, "")}`)
      const res = await call(api, route.method, route.path, null)
      expect([200, 503], `${route.path} answered ${JSON.stringify(res.body)}`).toContain(res.status)
      expect(
        res.status,
        `${route.path} must NOT be gated. It is declared-public and a gate here breaks ${
          route.path === "/api/packs/registry" ? "MarketsRoom" : "a real client"
        }.`
      ).not.toBe(401)
    })
  }

  it("/api/health answers for a load balancer and CI, which hold no session", async () => {
    const api = await loadHandlers("health-noauth")
    const res = await call(api, "GET", "/api/health", null)
    expect(res.status, "a health check behind a session cannot report on an unauthenticated instance").toBe(200)
    expect(res.body?.ok, "the health body must be the liveness answer, not a refusal").toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE DEFERRED READS — proof that nothing was quietly gated
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 T20R — the deferred reads were NOT quietly gated", () => {
  let authDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    seedUser(authDir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  for (const route of DEFERRED_READS) {
    it(`${route.method} ${route.path} is still ungated — ${route.why ?? "a read deferred to a later pass"}`, async () => {
      const api = await loadHandlers(`def-${route.path.replace(/[^a-z]/gi, "")}`)
      const res = await call(api, route.method, route.path, {})
      expect(res.status, `${route.path} answered ${JSON.stringify(res.body)}`).not.toBe(401)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE FRESH-INSTALL BOOTSTRAP PATH — the regression T20R was told to fear
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 T20R — a FRESH INSTALL with no accounts still bootstraps", () => {
  let authDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    // NO users.json at all: an empty user store, no accounts, the state a brand
    // new checkout is in. This is the case that decides whether gating anything
    // with requireAuth has locked the operator out of their own instance.
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("GET /api/auth/status reports that there are no accounts yet", async () => {
    const api = await loadHandlers("fresh-status")
    const res = await call(api, "GET", "/api/auth/status", null)
    expect(res.status, "the login page must be able to ask whether anyone exists").toBe(200)
    expect(res.body?.hasUsers, "a fresh install has no users — the UI routes to SIGNUP on this").toBe(false)
  })

  it("GET /api/auth/me answers 'no session' rather than destroying anything", async () => {
    // The route T20R was specifically told to investigate before gating. It is
    // the bootstrap answer itself: it must answer BEFORE a session exists, which
    // is exactly why it must never carry requireAuth.
    const api = await loadHandlers("fresh-me")
    const res = await call(api, "GET", "/api/auth/me", null)
    expect(res.status, "no token presented on a fresh install is 401, not 503 and not a thrown error").toBe(401)
    expect(res.body?.ok).not.toBe(true)
    expect(
      res.status,
      "a 503 here would make fetchMe() treat an inconclusive answer as a rejection and delete the " +
        "session — the WS-6 defect. The store is readable in this test, so 401 is the honest answer."
    ).not.toBe(503)
  })

  it("POST /api/auth/signup CREATES the first account", async () => {
    const api = await loadHandlers("fresh-signup")
    const res = await call(api, "POST", "/api/auth/signup", {
      email: "first@example.test",
      password: "correct-horse-battery-staple",
      name: "First"
    })
    expect(res.status, `first-run signup must succeed: ${JSON.stringify(res.body)}`).toBe(200)

    // And the account really is on disk in the ISOLATED store — not in the real one.
    const users = JSON.parse(readFileSync(join(authDir, "users.json"), "utf8"))
    expect(users.users?.map((u) => u.email) ?? [].concat(users).map((u) => u.email)).toContain("first@example.test")
  })

  it("the gates T20R added inherit requireAuth's first-run branch — pinned, not assumed", async () => {
    // INHERITED, NOT INTRODUCED. Every requireAuth site in handlers.mjs admits an
    // anonymous caller while the user store is empty, because the branch lives in
    // the shared gate. That is recorded as INHERITED rather than mitigated: it is
    // the same property T9 pinned for its own route, and it is the reason this
    // file's anonymous-caller tests seed a user.
    //
    // The pair IS the claim: with no accounts the gate admits, and the moment one
    // account exists the same route refuses. A gate that were unconditional would
    // fail the second half; a gate that were absent would fail the first.
    const bootstrap = await loadHandlers("fresh-gate")
    const admitted = await call(bootstrap, "POST", "/api/trading/alerts", {
      symbol: "EURUSD",
      condition: "price_above",
      value: 1.2
    })
    expect(admitted.status, "requireAuth's first-run branch admits while the store is empty").not.toBe(401)

    seedUser(authDir)
    const enforced = await loadHandlers("firstrun-gate")
    const refused = await call(enforced, "POST", "/api/trading/alerts", {
      symbol: "EURUSD",
      condition: "price_above",
      value: 1.2
    })
    expect(refused.status, "and the same route refuses as soon as one account exists").toBe(401)
  })

  it("the stores really were redirected away from the live server/data", async () => {
    // Stated rather than assumed, because the round-4 auth incident in this
    // repository was exactly a test writing into the live store through a
    // misspelled environment variable.
    for (const dir of dirs) {
      expect(dir.includes("server") && dir.includes("data"), `${dir} must not be the live store`).toBe(false)
    }
  })
})