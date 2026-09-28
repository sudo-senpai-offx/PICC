// Security regression guard: the FIRST-USER BOOTSTRAP BYPASS must fail CLOSED
// when the user store cannot be read.
//
// The defect class this file exists for:
//
//   `!hasUsers()` is PICC's first-user bootstrap bypass. With no accounts
//   configured at all, anyone may through so the first account can be created.
//   hasUsers() answers `false` for BOTH "no accounts exist" AND "users.json
//   could not be read", because it goes through the lenient readJSON() that
//   folds every read/parse error into an empty fallback. So an UNREADABLE or
//   CORRUPT store satisfied the bypass.
//
//   requireAuth() was closed for this in 4505445 using resolveHasUsers(). These
//   fourteen routes each carried their OWN copy of the bypass and were missed,
//   so a single unreadable users.json served all of them UNAUTHENTICATED — a
//   live trading feed, live screen frames, the agents proxy (real LLM spend),
//   eWallet order creation and confirmation (real money state), connector
//   earnings history, and an SSRF-adjacent drive-by browser against an
//   attacker-supplied URL.
//
// WHY THESE TESTS CANNOT PASS VACUOUSLY. Every test below drives the REAL route
// over the REAL request/response boundary with the user store genuinely
// unreadable, and then asserts BOTH that the route refused AND that the
// protected payload is ABSENT from the response — for the two money routes,
// that the persisted order on disk was not created, not confirmed, and carries
// no "local-owner" stamp. A test that only asserted "some status came back"
// would pass against the vulnerable code.
//
// The fake request carries no `socket`, so clientIp() falls back to "unknown"
// and the documented loopback bypass in isLocalhostRequest() does NOT fire:
// these requests genuinely reach the auth gate as a remote caller would.
//
// The browser-transport and agents-proxy dependencies are replaced with
// SENTINELS rather than left to reach a real Chrome or a real LLM. The
// assertion is that the sentinel is ABSENT — i.e. the route refused before it
// reached the dependency — not that a mock was called.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/connectors.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    collectSource: async () => ({
      provider: "expertoption",
      platform: "expertoption",
      source: "browser",
      status: "ok",
      balance: SENTINEL.collect,
      extra: { raw: { balance: SENTINEL.collect } }
    }),
    getHistory: async () => [{ at: SENTINEL.history }],
    openLiveSession: async () => ({
      latest: { provider: "expertoption", status: "ok", balance: SENTINEL.live },
      bridge: { close: async () => {} }
    }),
    subscribeLive: () => () => {},
    closeLiveSession: async () => {},
    liveSubscriberCount: () => 0
  }
})

vi.mock("../services/browserStudio.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    studioStatus: () => ({ open: true, viewport: { width: 800 }, marker: SENTINEL.studioStatus }),
    latestStudioFrame: () => ({ data: SENTINEL.studioFrame, ts: 1 }),
    subscribeStudio: () => () => {}
  }
})

// Hoisted because the vi.mock factories above are lifted above the imports.
const SENTINEL = vi.hoisted(() => ({
  collect: "COLLECT_PAYLOAD_SENTINEL",
  history: "HISTORY_PAYLOAD_SENTINEL",
  live: "LIVE_PAYLOAD_SENTINEL",
  studioStatus: "STUDIO_STATUS_SENTINEL",
  studioFrame: "STUDIO_FRAME_SENTINEL",
  agents: "AGENTS_PROXY_SENTINEL"
}))

// The seeded legacy order: ownerless (userId null), which is exactly the shape
// selfApprove admits. If a store fault can still reach it, the caller can weld
// a real payment order to "confirmed".
const SEEDED_ORDER = {
  id: "ord-seed-1",
  userId: null,
  ewallet: "tng",
  reference: "PICC-TEST0001",
  amount: 25,
  currency: "MYR",
  description: "seeded legacy ownerless order",
  status: "awaiting_payment",
  created_at: "2026-01-01T00:00:00.000Z"
}

const USER_ROW = {
  id: "u1",
  email: "e@example.test",
  name: "E",
  salt: "s",
  passwordHash: "h",
  createdAt: "2026-01-01T00:00:00.000Z"
}

let dir
let ewalletDir
const openSockets = []

function makeReq(method, url, { headers = {}, body, socket } = {}) {
  const listeners = {}
  const raw = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8")
  return {
    method,
    url,
    // No `socket` by default: clientIp() → "unknown", so isLocalhostRequest()
    // is false and every request is a REMOTE caller as far as the gate goes.
    ...(socket ? { socket } : {}),
    headers: { host: "example.test", "content-type": "application/json", ...headers },
    raw,
    on(evt, cb) {
      ;(listeners[evt] ??= []).push(cb)
      // readRawBody() (handlers.mjs) is awaited for EVERY request, so "end" must
      // always fire or the request hangs before it ever reaches a route.
      if (evt === "data" || evt === "end") {
        queueMicrotask(() => {
          for (const h of listeners.data ?? []) if (raw !== null) h(raw)
          for (const h of listeners.end ?? []) h()
        })
      }
      return this
    },
    once(evt, cb) {
      return this.on(evt, cb)
    },
    removeAllListeners(evt) {
      delete listeners[evt]
      return this
    },
    setHeader() {},
    destroy() {},
    // Test-only teardown hook: fires the "close" handlers a real socket would,
    // so a stream that DID open (the red run) releases its keepalive timer.
    __close() {
      for (const cb of listeners.close ?? []) cb()
    }
  }
}

function makeRes() {
  const listeners = {}
  const chunks = []
  return {
    status: null,
    headers: null,
    chunks,
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    statusCode: null,
    setHeader(k, v) {
      this.headers ??= {}
      this.headers[k] = v
    },
    getHeader(k) {
      return this.headers?.[k]
    },
    writeHead(status, headers) {
      this.status = status
      this.statusCode = status
      this.headers = { ...(this.headers ?? {}), ...(headers ?? {}) }
      this.headersSent = true
    },
    write(chunk) {
      chunks.push(String(chunk))
      return true
    },
    end(chunk) {
      if (chunk) chunks.push(String(chunk))
      this.writableEnded = true
    },
    on(evt, cb) {
      ;(listeners[evt] ??= []).push(cb)
      return this
    },
    once(evt, cb) {
      return this.on(evt, cb)
    },
    removeAllListeners() {
      return this
    },
    __close() {
      for (const cb of listeners.close ?? []) cb()
    },
    get text() {
      return chunks.join("")
    },
    get body() {
      const raw = chunks.join("")
      if (!raw) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
  }
}

function writeUsers(value) {
  writeFileSync(join(dir, "users.json"), typeof value === "string" ? value : JSON.stringify(value), "utf8")
}
function writeSessions(value) {
  writeFileSync(join(dir, "sessions.json"), typeof value === "string" ? value : JSON.stringify(value), "utf8")
}
function seedOrders(orders) {
  writeFileSync(join(ewalletDir, "ewallet-orders.json"), JSON.stringify(orders), "utf8")
}
function readOrders() {
  return JSON.parse(readFileSync(join(ewalletDir, "ewallet-orders.json"), "utf8"))
}

/** An unreadable store: valid sessions, but users.json cannot be parsed. */
function faultStore() {
  writeSessions({ sessions: {} })
  writeUsers("{ not json")
}

/**
 * The READ branch, not the parse branch: users.json exists but cannot be read.
 * A directory in its place is EISDIR on both Windows and POSIX, which is the
 * same class as the Windows locked/renamed file that motivated this whole fix.
 */
function unreadableStore() {
  writeSessions({ sessions: {} })
  rmSync(join(dir, "users.json"), { force: true })
  mkdirSync(join(dir, "users.json"))
}

/**
 * The inverse: a POPULATED user store whose SESSION store cannot be parsed.
 *
 * The user store must be POPULATED on purpose. With a genuinely EMPTY user
 * store the bootstrap bypass admits the caller before the session store is ever
 * consulted, which is correct first-run behaviour and would mask the fault
 * under test. Populating it isolates the session fault: no bootstrap, so the
 * only way through is a credential, and that is the path being examined.
 */
function faultSessionStore() {
  writeSessions("{ not json")
  writeUsers({ users: [USER_ROW] })
}

// One fixed specifier: beforeEach resets the module registry, so every test gets
// a fresh handlers/config/auth graph that re-reads the stubbed env. (A
// template-literal specifier is not supported by vite's dynamic-import-vars.)
const HANDLERS = "../handlers.mjs?auth-bootstrap-gate-fails-closed"

/**
 * Per-test budget, above vitest's 5s default.
 *
 * These are integration tests over the REAL module graph, not unit tests: each
 * one calls vi.resetModules() and re-imports handlers.mjs, a 5,548-line module
 * with 57 imports, plus every service it pulls in. Under a parallel worker pool
 * a single re-import occasionally ran past 5s, and one run failed on the
 * TIMEOUT with no assertion output - a flaky test that proves nothing about the
 * defect. The budget is raised rather than the work weakened: no assertion here
 * is relaxed, skipped or made cheaper, and the heavy re-import is kept because
 * dropping it would let store state leak between tests.
 *
 * The budget was 30s, which is not defensible as a number: it is roughly 10x the
 * slowest observed test. It is now 10s, about 3x the slowest observed test
 * (3.06s, the first-run admission cases, which do the most store I/O), so a real
 * regression still fails and ordinary contention has room to breathe.
 *
 * MEASURED, so this is not a guess: on this host a cold `import auth.mjs` is
 * ~1ms and a cold `import handlers.mjs` with its whole graph is ~428ms. The
 * re-import cost is handlers.mjs's dependency graph, NOT auth.mjs. Late-binding
 * auth.mjs's DATA_DIR would therefore recover ~1ms of ~428ms and could not be
 * the fix for anything; it was measured and deliberately not done. The actual
 * WS-6 T10 root cause was the sessions.json shape hole - a readable store of the
 * wrong shape made /api/auth/me answer 401 and destroyed a valid session with no
 * I/O error at all - and that is fixed in readSessionsStrict(), not here.
 */
const TIMEOUT = 10_000

async function call(method, url, opts = {}) {
  const { handleApi } = await import(HANDLERS)
  const req = makeReq(method, url, opts)
  const res = makeRes()
  openSockets.push(req, res)
  await handleApi(req, res, url)
  return res
}

/**
 * The two things a security test here must both establish: the route refused,
 * and the thing it protects is not in the response.
 */
function assertRefused(res, { sentinels = [] } = {}) {
  expect(res.status, "a store fault must be refused, not admitted").toBe(503)
  expect(res.body?.error).toBe("auth store unavailable")
  expect(res.headers?.["Content-Type"], "a refusal is JSON, never a protected stream").toBe("application/json")
  for (const s of sentinels) {
    expect(res.text, `protected payload ${s} must be absent from the response`).not.toContain(s)
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "picc-bootstrap-gate-"))
  ewalletDir = mkdtempSync(join(tmpdir(), "picc-bootstrap-wallet-"))
  vi.stubEnv("PICC_AUTH_DATA_DIR", dir)
  vi.stubEnv("PICC_EWALLET_DATA_DIR", ewalletDir)
  vi.stubEnv("PICC_AGENTS_URL", "http://agents.invalid")
  // Never let a test reach a real agents service: a sentinel answer, so the
  // assertion below can prove the proxy was NOT driven.
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    json: async () => ({ marker: SENTINEL.agents })
  }))
  seedOrders({ [SEEDED_ORDER.id]: { ...SEEDED_ORDER } })
  vi.resetModules()
})

afterEach(() => {
  // A stream that opened during the red run registered a 15s keepalive; fire its
  // close handlers so vitest is not left holding an open timer.
  for (const s of openSockets.splice(0)) s.__close()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
  rmSync(ewalletDir, { recursive: true, force: true })
})

describe("WS-7 AUTH-FAILOPEN — a user-store fault never satisfies the bootstrap bypass", { timeout: TIMEOUT }, () => {
  // ── The three live SSE feeds ────────────────────────────────────────────
  it("1235 /api/trading/realtime refuses instead of opening a live trading feed", async () => {
    faultStore()
    const res = await call("GET", "/api/trading/realtime")
    assertRefused(res, { sentinels: [SENTINEL.agents] })
    // The decisive assertion: the SSE envelope itself is the protected payload.
    expect(res.text).not.toContain("text/event-stream")
    expect(res.text).not.toContain("event:")
  })

  it("1333 /api/trading/decisions refuses instead of disclosing decisions", async () => {
    faultStore()
    const res = await call("GET", "/api/trading/decisions")
    assertRefused(res)
    expect(res.text).not.toContain("decisions")
  })

  it("5403 /api/browser/stream refuses instead of streaming live screen frames", async () => {
    faultStore()
    const res = await call("GET", "/api/browser/stream")
    assertRefused(res, { sentinels: [SENTINEL.studioStatus, SENTINEL.studioFrame] })
    expect(res.text).not.toContain("text/event-stream")
  })

  // ── The agents proxy (real LLM spend) ───────────────────────────────────
  it("4624 /api/agents/run refuses instead of driving the agents proxy", async () => {
    faultStore()
    const res = await call("POST", "/api/agents/run", { body: { crew: "research", inputs: { q: "x" } } })
    assertRefused(res, { sentinels: [SENTINEL.agents] })
  })

  it("4657 /api/agents/settings GET refuses instead of reading agent configuration", async () => {
    faultStore()
    const res = await call("GET", "/api/agents/settings")
    assertRefused(res, { sentinels: [SENTINEL.agents] })
  })

  it("4657 /api/agents/settings POST refuses instead of writing agent configuration", async () => {
    faultStore()
    const res = await call("POST", "/api/agents/settings", { body: { model: "x" } })
    assertRefused(res, { sentinels: [SENTINEL.agents] })
  })

  // ── eWallet order creation ──────────────────────────────────────────────
  // The persisted-order assertion comes FIRST in every money test below, so a
  // run against the vulnerable code fails on the money state itself rather
  // than on the status code. A status-only assertion would prove less: the
  // point is that no order was created / no order was confirmed.
  it("4738 /api/billing/ewallet/order refuses instead of creating a real order", async () => {
    faultStore()
    const { env } = await import("../config.mjs")
    env.ewalletTngNumber = "60112004264"
    const res = await call("POST", "/api/billing/ewallet/order", { body: { ewallet: "tng", amount: 25 } })
    // The real side effect, checked on disk: only the seeded order may exist.
    expect(Object.keys(readOrders())).toEqual([SEEDED_ORDER.id])
    assertRefused(res)
  })

  it("4742 attribution — a store fault cannot stamp \"local-owner\" on a new order", async () => {
    faultStore()
    const { env } = await import("../config.mjs")
    env.ewalletTngNumber = "60112004264"
    const res = await call("POST", "/api/billing/ewallet/order", { body: { ewallet: "tng", amount: 25 } })
    for (const order of Object.values(readOrders())) {
      expect(order.userId, "an order may not be attributed to local-owner on a store fault").not.toBe("local-owner")
    }
    assertRefused(res)
  })

  // ── eWallet confirmation (the money-state hole) ─────────────────────────
  it("4764 /api/billing/ewallet/submit refuses instead of confirming a payment order", async () => {
    faultStore()
    const res = await call("POST", "/api/billing/ewallet/submit", {
      body: { orderId: SEEDED_ORDER.id, confirmRef: "1234 567 8901" }
    })
    expect(readOrders()[SEEDED_ORDER.id].status).toBe("awaiting_payment")
    assertRefused(res)
  })

  it("4770 selfApprove — a store fault can never produce selfApprove === true", async () => {
    faultStore()
    const res = await call("POST", "/api/billing/ewallet/submit", {
      body: { orderId: SEEDED_ORDER.id, confirmRef: "1234 567 8901" }
    })
    // The persisted record is the only place selfApprove has an effect.
    const order = readOrders()[SEEDED_ORDER.id]
    expect(order.self_approved, "selfApprove must not be reachable on a store fault").not.toBe(true)
    expect(order.self_approved).toBeUndefined()
    assertRefused(res)
  })

  it("4765 attribution — a store fault can never weld an order to confirmed as local-owner", async () => {
    faultStore()
    const res = await call("POST", "/api/billing/ewallet/submit", {
      body: { orderId: SEEDED_ORDER.id, confirmRef: "1234 567 8901" }
    })
    const order = readOrders()[SEEDED_ORDER.id]
    expect(order.status).not.toBe("confirmed")
    expect(order.confirmed_by, "an order may not be confirmed_by local-owner on a store fault").not.toBe("local-owner")
    expect(order.confirmed_at).toBeUndefined()
    assertRefused(res)
  })

  // ── The BTCPay gate that was dead, not bypassed ────────────────────────
  it("4784 /api/btcpay/invoice has no bootstrap bypass at all — a faulted store must not add one", async () => {
    faultStore()
    const res = await call("POST", "/api/btcpay/invoice", { body: { amount: 10, tier: "pro" } })
    // This route never had a first-run bypass: it demands a real session
    // unconditionally. So the honest refusal is 401, not the 503 a bypass
    // would produce — and 401 is unreachable-as-bypass, not a dead 401.
    expect(res.status).toBe(401)
    expect(res.text).not.toContain("invoice")
  })

  // ── Connectors ──────────────────────────────────────────────────────────
  it("4857 /api/connectors/:slug/history refuses instead of disclosing earnings history", async () => {
    faultStore()
    const res = await call("GET", "/api/connectors/expertoption/history")
    assertRefused(res, { sentinels: [SENTINEL.history] })
    expect(res.text).not.toContain("history")
  })

  it("4870 /api/connectors/:slug/stream refuses instead of streaming live DOM frames", async () => {
    faultStore()
    const res = await call("GET", "/api/connectors/expertoption/stream")
    assertRefused(res, { sentinels: [SENTINEL.live] })
    expect(res.text).not.toContain("text/event-stream")
  })

  it("4927 /api/connectors/:slug/collect refuses instead of driving a browser at an attacker URL", async () => {
    faultStore()
    const res = await call("POST", "/api/connectors/expertoption/collect", {
      body: { url: "http://169.254.169.254/latest/meta-data/" }
    })
    assertRefused(res, { sentinels: [SENTINEL.collect] })
  })

  it("4960 /api/connectors/autodetect refuses instead of fingerprinting an attacker URL", async () => {
    faultStore()
    const res = await call("POST", "/api/connectors/autodetect", { body: { url: "http://example.test/" } })
    assertRefused(res)
    expect(res.body?.result).toBeUndefined()
  })
})

describe("WS-7 AUTH-FAILOPEN — the fix cannot be satisfied by breaking first-run", { timeout: TIMEOUT }, () => {
  // These assert ADMISSION (200 plus the real payload), not merely "not refused".
  // `not.toBe(401)/not.toBe(503)` is satisfied by 200, 204, 400, 404, 500 and 502,
  // so it proves only that the route is not over-refused. That is a real
  // property, but on a deterministic handler it is a weaker one than it looks,
  // so where the handler's success path is fixed the assertion is 200 AND the
  // protected payload is PRESENT. /api/connectors/:slug/history is used because
  // it answers 200 deterministically; /api/trading/decisions can answer 502 when
  // getDecisions() fails, so it cannot carry a 200 assertion.
  const FIRST_RUN_ROUTE = "/api/connectors/expertoption/history"

  it("still admits a remote caller on a GENUINELY empty store, with its payload", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [] })

    const res = await call("GET", FIRST_RUN_ROUTE)
    expect(res.status, "a genuine first run is ADMITTED, not refused").toBe(200)
    expect(res.text, "admitted means the payload is actually served").toContain(SENTINEL.history)
  })

  it("still admits a remote caller when no user store exists at all, with its payload", async () => {
    const res = await call("GET", FIRST_RUN_ROUTE)
    expect(res.status, "a fresh install with no store is ADMITTED").toBe(200)
    expect(res.text).toContain(SENTINEL.history)
  })

  it("still creates a first-run eWallet order on a genuinely empty store", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [] })
    const { env } = await import("../config.mjs")
    env.ewalletTngNumber = "60112004264"

    const res = await call("POST", "/api/billing/ewallet/order", { body: { ewallet: "tng", amount: 25 } })
    expect(res.status).toBe(200)
    // First-run still attributes to the implicit local owner — that is the
    // behaviour the bootstrap exists for, and it must survive the fix.
    const created = Object.values(readOrders()).find((o) => o.id !== SEEDED_ORDER.id)
    expect(created?.userId).toBe("local-owner")
  })

  it("still serves a real session on a healthy store", async () => {
    const token = "a".repeat(64)
    writeSessions({ sessions: { [token]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } } })
    writeUsers({ users: [USER_ROW] })

    const res = await call("GET", "/api/connectors/expertoption/history", {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(res.status).toBe(200)
    expect(res.text).toContain(SENTINEL.history)
  })

  it("still refuses an unauthenticated remote caller on a healthy, populated store", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [USER_ROW] })

    const res = await call("GET", "/api/connectors/expertoption/history")
    expect(res.status).toBe(401)
    expect(res.text).not.toContain(SENTINEL.history)
  })
})

// The mutation check found a real gap in the tests above: every request in them
// is from a NON-loopback peer, so flipping requireSessionOrFirstRun's
// `allowLocalhost` default from false to true — widening every gate at once —
// would have been invisible. These two tests close it from both directions.
describe("WS-7 AUTH-FAILOPEN — a loopback bypass must be asked for, never defaulted", { timeout: TIMEOUT }, () => {
  const LOOPBACK = { socket: { remoteAddress: "127.0.0.1" } }

  it("a LOOPBACK caller on a route with no bypass is still refused on a store fault", async () => {
    faultStore()
    const res = await call("POST", "/api/agents/run", { body: { crew: "research", inputs: {} }, ...LOOPBACK })
    // /api/agents/run never had a loopback bypass. If the shared gate ever
    // defaults one on, real LLM spend becomes drive-by from any local process.
    assertRefused(res, { sentinels: [SENTINEL.agents] })
  })

  it("5403 /api/browser/stream stays un-bypassed for loopback too", async () => {
    faultStore()
    const res = await call("GET", "/api/browser/stream", LOOPBACK)
    // The deliberate decision, pinned: unlike its two /api/trading/* siblings,
    // this route takes NO loopback bypass, because it serves live screen frames
    // and the client already sends a bearer token.
    assertRefused(res, { sentinels: [SENTINEL.studioStatus, SENTINEL.studioFrame] })
  })

  it("the two /api/trading/* routes that DO carry the bypass still admit a loopback caller", async () => {
    faultStore()
    const res = await call("GET", "/api/trading/realtime", LOOPBACK)
    // Pre-existing behaviour, deliberately preserved: these two routes already
    // had isLocalhostRequest() and removing it would be a functional change
    // outside this slice. The loopback peer is ADMITTED — 200 and the SSE
    // envelope — so the bypass is real, which is exactly why it must stay
    // opt-in and named at the call site. /api/trading/realtime is used because
    // its 200 is deterministic; /api/trading/decisions can answer 502.
    expect(res.status).toBe(200)
    // The SSE envelope lives in the Content-Type header and in the frames
    // themselves; the bypass is proven by the stream being OPEN, not refused.
    expect(res.headers?.["Content-Type"]).toBe("text/event-stream")
    expect(res.text).toContain("event:")
  })

  it("a LOOPBACK caller on a healthy, populated store still gets a real 401", async () => {
    // The bypass is a first-run affordance for a loopback peer, so on a
    // populated store the loopback peer is refused like anyone else. 401 (not
    // 503) is the honest answer here precisely because the store WAS readable
    // and the credentials really were absent — which is the distinction the
    // whole refusal strategy turns on.
    writeSessions({ sessions: {} })
    writeUsers({ users: [USER_ROW] })
    const res = await call("POST", "/api/agents/run", { body: { crew: "research", inputs: {} }, ...LOOPBACK })
    expect(res.status).toBe(401)
    expect(res.text).not.toContain(SENTINEL.agents)
  })
})

// The REVIEW ROUND found four holes the first round's tests could not see,
// because every one of them needs a different fault SHAPE than a parse error.
describe("WS-7 AUTH-FAILOPEN — every store-fault shape, not just a parse error", { timeout: TIMEOUT }, () => {
  it("refuses on the READ branch: users.json exists but cannot be read", async () => {
    // The Windows locked/renamed-file shape that motivated the whole fix. Only
    // the PARSE branch was covered before.
    unreadableStore()
    const res = await call("GET", "/api/connectors/expertoption/history")
    assertRefused(res, { sentinels: [SENTINEL.history] })
  })

  it("refuses when users.json parses to a bare null, rather than answering 500", async () => {
    // JSON.parse("null") === null, so `data.users` was a TypeError. It escaped
    // isAuthStoreUnavailable (a name check) and surfaced as an unhandled 500,
    // contradicting the documented contract.
    writeSessions({ sessions: {} })
    writeUsers("null")
    const res = await call("GET", "/api/connectors/expertoption/history")
    expect(res.status).toBe(503)
    expect(res.body?.error).toBe("auth store unavailable")
  })

  it("refuses a ?token= caller when the SESSION store is faulty, rather than claiming the token is bad", async () => {
    // verifyToken() maps a store fault to null BY CONTRACT, so the gate used to
    // answer 401 here — the exact false claim about the token that 503 was
    // chosen to avoid, on the one credential path that never reached the user
    // store at all.
    faultSessionStore()
    const res = await call("GET", "/api/trading/realtime?token=" + "a".repeat(64))
    expect(res.status).toBe(503)
    expect(res.text).not.toContain("text/event-stream")
  })

  it("refuses a header-credential caller when the SESSION store is faulty", async () => {
    faultSessionStore()
    const res = await call("GET", "/api/connectors/expertoption/history", {
      headers: { authorization: `Bearer ${"a".repeat(64)}` }
    })
    expect(res.status).toBe(503)
    expect(res.text).not.toContain(SENTINEL.history)
  })
})

// The aggregate connector route had NO gate at all — a live-balance disclosure
// needing no store fault, so strictly easier to reach than the fail-open class.
describe("WS-7 AUTH-FAILOPEN — /api/connectors discloses nothing without a session", { timeout: TIMEOUT }, () => {
  const AGG = "/api/connectors"

  it("REFUSES the aggregate connector route when the store is unreadable", async () => {
    faultStore()
    const res = await call("GET", AGG)
    assertRefused(res)
    // The protected payload: the registry (live url, selectors, tuning) and the
    // latest snapshots, which carry balance / today / lifetime / payoutThreshold.
    expect(res.text).not.toContain("connectors")
    expect(res.text).not.toContain("latest")
  })

  it("REFUSES the aggregate connector route when the store is unreadable (POST too)", async () => {
    faultStore()
    const res = await call("POST", AGG, { body: {} })
    assertRefused(res)
    expect(res.text).not.toContain("connectors")
  })

  it("still serves the aggregate on a GENUINELY empty first-run store", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [] })
    const res = await call("GET", AGG)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body?.connectors)).toBe(true)
  })

  it("still serves the aggregate to a real session", async () => {
    const token = "a".repeat(64)
    writeSessions({ sessions: { [token]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } } })
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", AGG, { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body?.connectors)).toBe(true)
  })

  it("still refuses an unauthenticated remote caller on a healthy, populated store", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", AGG)
    expect(res.status).toBe(401)
    expect(res.text).not.toContain("connectors")
  })
})

// resolveAuthUser() is the SECOND strict reader of the same file. It tolerated
// the shapes resolveHasUsers() calls CORRUPTION, so a corrupt store produced a
// false 401 from /api/auth/me — and fetchMe() maps 401 to "rejected", which makes
// shouldClearStoredSession DESTROY A VALID SESSION. That is the WS-6 T10 flake
// this whole line of work exists to remove, reintroduced for the new shapes.
describe("WS-7 AUTH-FAILOPEN — /api/auth/me must not destroy a session on a corrupt store", { timeout: TIMEOUT }, () => {
  const ME = "/api/auth/me"
  const validSession = () => {
    const token = "a".repeat(64)
    writeSessions({ sessions: { [token]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } } })
    return token
  }

  it("answers 503, not 401, for {\"users\":null} with a VALID session", async () => {
    const token = validSession()
    writeUsers({ users: null })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${token}` } })
    // 401 here is the session-destroying answer: fetchMe() calls it "rejected".
    expect(res.status, "a corrupt store must not be reported as a rejected token").toBe(503)
    expect(res.body?.user).toBeUndefined()
  })

  it("answers 503, not 401, for {} with a VALID session", async () => {
    const token = validSession()
    writeUsers({})
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(503)
  })

  it("answers 503, not 401, for a bare null with a VALID session", async () => {
    const token = validSession()
    writeUsers("null")
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(503)
    expect(res.body?.error).toBe("auth store unavailable")
  })

  it("still CONFIRMS a valid session on a healthy store", async () => {
    const token = validSession()
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    expect(res.body?.user?.id).toBe("u1")
  })

  it("still gives a true 401 for a genuinely unknown token on a healthy store", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${"b".repeat(64)}` } })
    expect(res.status, "a real miss is a real 401 — the fix must not make /me unrefusable").toBe(401)
  })
})

// sessions.json is the SECOND store with no shape rule, and it is the more
// dangerous of the two: a wrong-shaped sessions file makes lookupSession return
// null, /api/auth/me answers 401, and fetchMe() maps 401 to "rejected", which
// makes shouldClearStoredSession DESTROY A VALID SESSION. Unlike a read fault
// this needs NO I/O error at all - a well-formed JSON file of the wrong shape
// does it. That is the WS-6 T10 signature, and it is reachable via a
// truncated-yet-valid write under store contention.
describe("WS-7 AUTH-FAILOPEN — a wrong-shaped SESSIONS store is corruption, not a miss", { timeout: TIMEOUT }, () => {
  const ME = "/api/auth/me"
  const DECISIONS = "/api/trading/decisions"
  const validToken = "a".repeat(64)

  it("answers 503, not 401, for {\"sessions\":null} with a VALID session", async () => {
    writeSessions({ sessions: null })
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${validToken}` } })
    // 401 is the session-destroying answer here, exactly as in the users.json
    // case above. The client still holds this token and would be signed out.
    expect(res.status, "a corrupt SESSIONS store must not be reported as a rejected token").toBe(503)
    expect(res.body?.user).toBeUndefined()
  })

  it("answers 503, not 401, for {} with a VALID session", async () => {
    writeSessions({})
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${validToken}` } })
    expect(res.status).toBe(503)
  })

  it("answers 503, not 401, for a bare array with a VALID session", async () => {
    writeSessions([])
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${validToken}` } })
    expect(res.status).toBe(503)
  })

  it("answers 503, not 401, for a bare null with a VALID session", async () => {
    writeSessions("null")
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${validToken}` } })
    expect(res.status).toBe(503)
    expect(res.body?.error).toBe("auth store unavailable")
  })

  it("refuses a gated route when the SESSIONS store is wrong-shaped and users exist", async () => {
    // Populated users means the bootstrap bypass does NOT admit the caller, so
    // this isolates the session read: without a shape rule verifyTokenStrict
    // returns null and the caller is told the token is merely invalid (401).
    writeSessions({ sessions: null })
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", DECISIONS, { headers: { authorization: `Bearer ${validToken}` } })
    expect(res.status, "a corrupt session store is 503, not a false 401").toBe(503)
  })

  it("refuses a gated route on a ?token= credential when the SESSIONS store is wrong-shaped", async () => {
    writeSessions({ sessions: "x" })
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", `${DECISIONS}?token=${"b".repeat(64)}`)
    expect(res.status).toBe(503)
  })

  it("still gives a true 401 for a genuinely unknown token on a healthy sessions store", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${validToken}` } })
    // The shape rule must not make /me unrefusable: an empty-but-well-formed
    // sessions store is a real miss, and a real miss is a real 401.
    expect(res.status).toBe(401)
  })

  it("still CONFIRMS a valid session on a healthy sessions store", async () => {
    writeSessions({ sessions: { [validToken]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } } })
    writeUsers({ users: [USER_ROW] })
    const res = await call("GET", ME, { headers: { authorization: `Bearer ${validToken}` } })
    expect(res.status).toBe(200)
    expect(res.body?.user?.id).toBe("u1")
  })
})

describe("WS-7 AUTH-FAILOPEN — valid-JSON-but-wrong-shape is corruption, not a fresh install", { timeout: TIMEOUT }, () => {
  it("refuses when users.json parses to {\"users\":null}", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: null })

    const res = await call("GET", "/api/trading/decisions")
    // Treated as "empty" this granted the bootstrap bypass, so an unprivileged
    // caller reached a guarded route. A shape fault is not a first-run state.
    expect(res.status).toBe(503)
  })

  it("refuses when users.json parses to an empty object", async () => {
    writeSessions({ sessions: {} })
    writeUsers({})

    const res = await call("GET", "/api/trading/decisions")
    expect(res.status).toBe(503)
  })

  it("still admits first-run for the one shape that really is empty", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [] })

    const res = await call("GET", "/api/connectors/expertoption/history")
    expect(res.status, "the empty shape is the genuine first-run case, and is ADMITTED").toBe(200)
    expect(res.text).toContain(SENTINEL.history)
  })
})
