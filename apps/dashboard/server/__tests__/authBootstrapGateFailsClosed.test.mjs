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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

// One fixed specifier: beforeEach resets the module registry, so every test gets
// a fresh handlers/config/auth graph that re-reads the stubbed env. (A
// template-literal specifier is not supported by vite's dynamic-import-vars.)
const HANDLERS = "../handlers.mjs?auth-bootstrap-gate-fails-closed"

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

describe("WS-7 AUTH-FAILOPEN — a user-store fault never satisfies the bootstrap bypass", () => {
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

describe("WS-7 AUTH-FAILOPEN — the fix cannot be satisfied by breaking first-run", () => {
  it("still admits a remote caller on a GENUINELY empty store (read route)", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [] })

    const res = await call("GET", "/api/trading/decisions")
    // Admitted: neither refusal status.
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(503)
  })

  it("still admits a remote caller when no user store exists at all", async () => {
    const res = await call("GET", "/api/trading/decisions")
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(503)
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
describe("WS-7 AUTH-FAILOPEN — a loopback bypass must be asked for, never defaulted", () => {
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
    const res = await call("GET", "/api/trading/decisions", LOOPBACK)
    // Pre-existing behaviour, deliberately preserved: these two routes already
    // had isLocalhostRequest() and removing it would be a functional change
    // outside this slice. The loopback caller gets in, so the bypass is real —
    // which is exactly why it must stay opt-in and named at the call site.
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(503)
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

describe("WS-7 AUTH-FAILOPEN — valid-JSON-but-wrong-shape is corruption, not a fresh install", () => {
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

    const res = await call("GET", "/api/trading/decisions")
    expect(res.status).not.toBe(503)
  })
})
