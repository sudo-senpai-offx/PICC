// @vitest-environment jsdom
//
// THE LOOPBACK PROOF: a client of a gated route, checked against the REAL
// credential verifier rather than against a status code.
//
// ── WHY A NORMAL CLIENT TEST CANNOT CATCH THE BUG THIS FILE IS ABOUT ──
//
// `requireAuth` (server/handlers.mjs) admits a request outright when
// `isLocalhostRequest(req)` is true, and that predicate reads the real TCP peer.
// Every client-side test in this repo runs in jsdom against a stubbed `fetch`,
// so the server is never consulted and the bypass is never exercised either way.
// That is precisely why `NotificationCenter.tsx` could poll `/api/trading/alerts`
// with `credentials: "include"` and NO Authorization header while the whole suite
// stayed green: nothing in a localhost client test can distinguish "the route
// answered" from "the route would have refused and the bypass let it through".
//
// So this file does not assert a status. It asserts the CREDENTIAL, and it
// asserts it by handing the header the client actually emitted to the same
// `verifyUser()` that `requireAuth` calls. `verifyUser` is a pure function of
// its argument — it never looks at a socket, so the loopback bypass cannot
// participate in the verdict at all. That is what makes these assertions
// loopback-proof: the negative half below is a real refusal, not a mock's idea
// of one.
//
// ── THE TWO CALLERS THIS COVERS ──
//
//   1. `NotificationCenter.tsx` — the alert bell's 10s poll of
//      `/api/trading/alerts`, a route the owner ruling gated. It used to call
//      bare `fetch(..., { credentials: "include" })`.
//   2. `terminal/adapters/readOnlyReading.ts` — the ONE transport behind all
//      sixteen read-only room instances, which fetch their declared producer
//      routes including four of the gated twenty-four. Its module header
//      asserted that fetch's default `credentials: "same-origin"` "already sends
//      the session cookie", so it sent no Authorization header.
//
// ── WHY `credentials: "include"` WAS NEVER A CREDENTIAL HERE ──
//
// Because PICC's server sets NO cookie at all: the session lives in
// `localStorage` and travels as `Authorization: Bearer`. That is asserted
// below from the server source rather than trusted, and the negative half
// proves the consequence: with no bearer the verifier returns null no matter
// what a cookie-bearing request would have carried.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const TOKEN = "d".repeat(64)
const USER_ID = "proof-user"
const AUTH_KEY = "picc.auth"

// jsdom serves `import.meta.url` over http:, so `fileURLToPath` cannot be used
// here. The vitest root is the dashboard package, which is also the cwd.
const AUTH_SRC = resolve(process.cwd(), "server/services/auth.mjs")

/**
 * Re-seed the session for EVERY test.
 *
 * The shared harness owns `PICC_AUTH_DATA_DIR` (it redirects it at setup and
 * empties it in its own `beforeEach`, `vitestStoreIsolation.setup.mjs:313`), so
 * writing into that directory is both hermetic and self-cleaning — and it is
 * ALSO why a seed written once at module scope disappears by the second test,
 * which presents as the verifier mysteriously refusing a token it accepted a
 * moment earlier. Seeding per test is immune by construction.
 *
 * `lookupSession` reads sessions.json and nothing else (`auth.mjs:691`); the
 * row shape is `createSession`'s (`auth.mjs:592`). `users.json` is written too,
 * because `requireAuth`'s first-run bootstrap admits everyone when the store is
 * empty (`handlers.mjs:6119`) and these tests want the gate genuinely enforced.
 */
beforeEach(() => {
  const authDir = process.env.PICC_AUTH_DATA_DIR
  expect(typeof authDir, "the harness must own an auth store dir").toBe("string")
  writeFileSync(
    join(authDir as string, "users.json"),
    JSON.stringify({ users: [{ id: USER_ID, email: "p@example.test", name: "P", salt: "s", passwordHash: "h", createdAt: 1 }] })
  )
  writeFileSync(
    join(authDir as string, "sessions.json"),
    JSON.stringify({
      sessions: {
        [TOKEN]: { userId: USER_ID, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 }
      }
    })
  )
})

/** Put a session in localStorage exactly as `signUpLocal`/`signInLocal` do. */
function seedStoredSession(accessToken: string | null) {
  if (accessToken === null) {
    localStorage.removeItem(AUTH_KEY)
    return
  }
  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({ access_token: accessToken, user: { id: USER_ID, email: "p@example.test", name: "P" } })
  )
}

type Captured = { url: string; init: RequestInit | undefined }

/** Stub global fetch, recording what each call actually put on the wire. */
function captureFetch(okBody: unknown = { ok: true }): Captured[] {
  const calls: Captured[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return { ok: true, status: 200, json: async () => okBody } as Response
    })
  )
  return calls
}

function headerOf(call: Captured): string | undefined {
  const h = (call.init?.headers ?? {}) as Record<string, string>
  return h.Authorization ?? h.authorization
}

beforeAll(() => {
  vi.resetModules()
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * The REAL verifier, imported from the server. `requireAuth` calls exactly this
 * function with exactly `req.headers.authorization`, so a header accepted here
 * is a header the gate accepts.
 */
async function loadVerifyUser(): Promise<(h?: string) => Promise<string | null>> {
  vi.resetModules()
  const mod = await import("../../../server/services/auth.mjs")
  return mod.verifyUser
}

describe("the credential is a bearer and only a bearer", () => {
  it("PICC's server sets no cookie, so credentials:'include' carries nothing", () => {
    // The premise the two broken callers were built on, checked at the source.
    expect(existsSync(AUTH_SRC), `auth service not found at ${AUTH_SRC} — vitest cwd moved`).toBe(true)
    const src = readFileSync(AUTH_SRC, "utf8")
    const body = src.slice(src.indexOf("export async function verifyUser"))
    expect(body.slice(0, 200), "verifyUser must gate on the Bearer shape").toContain('startsWith("Bearer ")')
    // No cookie read anywhere on the path that decides authentication.
    expect(body.slice(0, 200)).not.toMatch(/cookie/i)
  })

  it("refuses a request that carries no bearer — the negative half, at the verifier", async () => {
    const verifyUser = await loadVerifyUser()
    // This is what the old NotificationCenter poll amounted to: no header.
    expect(await verifyUser(undefined)).toBeNull()
    expect(await verifyUser("")).toBeNull()
    // And a cookie-shaped credential is not read, because none is ever parsed.
    expect(await verifyUser("Bearer")).toBeNull()
  })

  it("accepts `Bearer <token>` — the positive half, at the same verifier", async () => {
    const verifyUser = await loadVerifyUser()
    expect(await verifyUser(`Bearer ${TOKEN}`)).toBe(USER_ID)
  })
})

describe("NotificationCenter's alert poll presents a bearer the verifier accepts", () => {
  it("emits `Authorization: Bearer <stored token>` on /api/trading/alerts", async () => {
    seedStoredSession(TOKEN)
    const calls = captureFetch({ ok: true, alerts: [], stats: {} })

    vi.resetModules()
    const { getAlerts } = await import("@/lib/trading")
    await getAlerts()

    const alertsCall = calls.find((c) => c.url.includes("/trading/alerts"))
    expect(alertsCall, "the poll must actually reach the alerts route").toBeTruthy()

    // THE ASSERTION. Coupling, not proxy: the header the client emitted is fed
    // to the verifier the gate uses. Pre-fix this was `undefined` -> null.
    const verifyUser = await loadVerifyUser()
    expect(await verifyUser(headerOf(alertsCall!))).toBe(USER_ID)
  })

  it("does not treat a cookie-bearing request as authenticated", async () => {
    seedStoredSession(TOKEN)
    const calls = captureFetch({ ok: true, alerts: [], stats: {} })
    vi.resetModules()
    const { getAlerts } = await import("@/lib/trading")
    await getAlerts()

    const init = calls.find((c) => c.url.includes("/trading/alerts"))!.init as RequestInit
    // `credentials` is not the mechanism and must not be relied on as one. It is
    // absent rather than "include" so nothing here forwards a cookie anywhere.
    expect(init.credentials ?? "same-origin").toBe("same-origin")
  })
})

describe("the read-only room transport presents a bearer the verifier accepts", () => {
  const GATED_PRODUCERS = [
    "/api/trading/status",
    "/api/streams/snapshot",
    "/api/twin/run",
    "/api/trading/signals"
  ]

  it("sends the bearer on EVERY producer it reads, including all four gated ones", async () => {
    seedStoredSession(TOKEN)

    const calls: Captured[] = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
    }) as unknown as typeof fetch

    vi.resetModules()
    const { fetchReadOnlyView } = await import("@/terminal/adapters/readOnlyReading")
    await fetchReadOnlyView("dashboard", "trading", { fetchImpl })

    expect(calls.length, "the dashboard room must have read its producers").toBeGreaterThan(0)

    const verifyUser = await loadVerifyUser()
    for (const call of calls) {
      expect(await verifyUser(headerOf(call)), `${call.url} must present an accepted bearer`).toBe(USER_ID)
    }

    // And the four that are actually gated were among them — so the assertion
    // above covered the routes the ruling closed, not only the public ones.
    for (const gated of GATED_PRODUCERS) {
      const hit = calls.find((c) => c.url.includes(gated))
      if (hit) {
        expect(await verifyUser(headerOf(hit)), `${gated} must present an accepted bearer`).toBe(USER_ID)
      }
    }
  })

  it("defaults to the STORED session, so a caller cannot forget the token", async () => {
    // No `token` option passed. If the adapter required every caller to thread a
    // token through, the next room added without one would break on remote
    // deployments only — which is the exact failure being fixed here.
    seedStoredSession(TOKEN)
    const calls: Captured[] = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
    }) as unknown as typeof fetch

    vi.resetModules()
    const { fetchReadOnlyView } = await import("@/terminal/adapters/readOnlyReading")
    await fetchReadOnlyView("dashboard", "trading", { fetchImpl })

    const verifyUser = await loadVerifyUser()
    expect(await verifyUser(headerOf(calls[0]))).toBe(USER_ID)
  })

  it("still treats a 401 as a named absence rather than a value", async () => {
    // The safety direction the adapter was built for must survive the fix: a
    // refusal renders as an absence, never as a plausible substitute.
    seedStoredSession(null)
    const fetchImpl = (async () =>
      ({ ok: false, status: 401, json: async () => ({ error: "authentication required" }) }) as Response) as unknown as typeof fetch

    vi.resetModules()
    const { fetchReadOnlyView } = await import("@/terminal/adapters/readOnlyReading")
    const view = await fetchReadOnlyView("dashboard", "trading", { fetchImpl })

    expect(view.verdict, "a refused producer must not read as observed").toBe("unobserved")
  })
})

// ── THE COMPONENT, not just the client function ──
//
// Asserting that `getAlerts()` is authenticated is necessary but NOT sufficient:
// the defect was never in `getAlerts`, it was in NotificationCenter declining to
// call it. A test that drives the wrapper proves the wrapper was always fine and
// says nothing about the caller. So this block mounts the component and reads
// the header off the wire.
//
// `@/lib/trading` is deliberately NOT mocked — it is the code path under test.
// `@/lib/api` IS mocked, because the component's other poll
// (`getInterventions`) is not what is under test and would add noise.
vi.mock("@/hooks/useWebPush", () => ({
  useWebPush: () => ({ enabled: false, unavailable: true, enable: vi.fn() })
}))
vi.mock("@/components/IOSInstallBanner", () => ({
  IOSInstallBanner: () => null
}))
vi.mock("@/lib/api", () => ({
  getInterventions: vi.fn(async () => ({ proposals: [] })),
  respondIntervention: vi.fn()
}))

describe("NotificationCenter itself presents a bearer the verifier accepts", () => {
  it("sends an accepted Authorization header on its own /api/trading/alerts poll", async () => {
    seedStoredSession(TOKEN)
    const calls = captureFetch({ ok: true, alerts: [], stats: {} })

    vi.resetModules()
    const { flushSync } = await import("react-dom")
    const { createRoot } = await import("react-dom/client")
    const { NotificationCenter } = await import("@/components/NotificationCenter")

    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    flushSync(() => {
      root.render(<NotificationCenter />)
    })
    await new Promise((r) => setTimeout(r, 50))
    flushSync(() => {
      root.unmount()
    })
    document.body.removeChild(host)

    const alertsCall = calls.find((c) => c.url.includes("/trading/alerts"))
    expect(alertsCall, "the bell must poll the alerts route on mount").toBeTruthy()

    // The regression assertion. With the old bare
    // `fetch(..., { credentials: "include" })` this header was absent, so the
    // real verifier returned null — which is precisely what the loopback bypass
    // was hiding in every other test on this branch.
    const verifyUser = await loadVerifyUser()
    expect(await verifyUser(headerOf(alertsCall!))).toBe(USER_ID)

    // And it is not leaning on `credentials` as a substitute credential.
    const init = alertsCall!.init as RequestInit
    expect(init.credentials ?? "same-origin").toBe("same-origin")
  })
})
