// @vitest-environment jsdom
// Regression guard for the WS-6 T10 terminal-performance flake.
//
// A `page.waitForSelector("[data-room='markets']")` timeout in that spec was
// traced (via Playwright's own failure snapshot, which showed the LOGIN page)
// to the app destroying a VALID session: one inconclusive answer from
// /api/auth/me was treated as proof the token was rejected, so the session was
// deleted and RequireAuth redirected to /login — after which the markets room
// marker could never render.
//
// The contract these tests pin down: "not authenticated" is a claim about the
// TOKEN, and only the server may make that claim. Everything else — a network
// error, a 5xx, a 429, a body that did not parse — is inconclusive and must
// leave the stored session alone.
//
// fetchMe() is pure with respect to localStorage: it REPORTS a SessionCheck and
// never mutates. The decision to destroy a session is the caller's, made via
// shouldClearStoredSession() — so these tests assert both halves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchMe, getStoredSession, setStoredSession, shouldClearStoredSession } from "../auth"

const KEY = "picc.auth"
const USER = { id: "u1", email: "e@example.test", name: "E", createdAt: "2026-01-01T00:00:00.000Z" }

function fakeResponse(status: number, body: unknown, jsonThrows = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonThrows) throw new SyntaxError("Unexpected token < in JSON")
      return body
    }
  } as unknown as Response
}

function seedSession() {
  window.localStorage.setItem(KEY, JSON.stringify({ access_token: "tok", user: USER }))
}

describe("fetchMe — reports which kind of answer it got", () => {
  beforeEach(() => {
    window.localStorage.clear()
    seedSession()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it("reports `confirmed` with the user on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, { ok: true, user: USER })))
    const result = await fetchMe()
    expect(result).toEqual({ kind: "confirmed", user: USER })
    expect(shouldClearStoredSession(result)).toBe(false)
  })

  it("reports `rejected` on an authoritative 401 and tells the caller to clear", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(401, { error: "not authenticated" })))
    const result = await fetchMe()
    expect(result).toEqual({ kind: "rejected" })
    expect(shouldClearStoredSession(result)).toBe(true)
  })

  it("reports `rejected` on 403", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(403, { error: "forbidden" })))
    expect(await fetchMe()).toEqual({ kind: "rejected" })
  })

  // The exact failure mode that produced the flake: the auth store was briefly
  // unreadable, the server said "could not tell", and the session was deleted.
  it("reports `inconclusive` and never asks to clear when the auth store is unavailable (503)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(503, { error: "auth store unavailable" })))
    const result = await fetchMe()
    expect(result).toEqual({ kind: "inconclusive" })
    expect(shouldClearStoredSession(result)).toBe(false)
    expect(getStoredSession()).not.toBeNull()
  })

  it("reports `inconclusive` on a 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(500, { error: "internal error" })))
    expect(await fetchMe()).toEqual({ kind: "inconclusive" })
  })

  it("reports `inconclusive` on a 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(429, { error: "rate limit exceeded" })))
    expect(await fetchMe()).toEqual({ kind: "inconclusive" })
  })

  it("reports `inconclusive` when the request never completes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      })
    )
    expect(await fetchMe()).toEqual({ kind: "inconclusive" })
  })

  it("reports `inconclusive` when a 200 body does not parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, null, true)))
    expect(await fetchMe()).toEqual({ kind: "inconclusive" })
  })

  it("reports `inconclusive` when a 200 body carries no user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, { ok: true })))
    expect(await fetchMe()).toEqual({ kind: "inconclusive" })
  })

  it("reports `rejected` when there is no token to check", async () => {
    window.localStorage.clear()
    const spy = vi.fn()
    vi.stubGlobal("fetch", spy)
    expect(await fetchMe()).toEqual({ kind: "rejected" })
    expect(spy).not.toHaveBeenCalled()
  })

  // fetchMe reports; it must not mutate. A single clearing site in the caller
  // is what keeps this from becoming a two-place policy.
  it("never mutates the stored session, whatever the answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(401, { error: "not authenticated" })))
    await fetchMe()
    expect(getStoredSession()).not.toBeNull()

    setStoredSession(null)
    expect(getStoredSession()).toBeNull()
  })

  it("only `rejected` ever clears the stored session", async () => {
    window.localStorage.clear()
    for (const kind of ["confirmed", "inconclusive", "rejected"] as const) {
      seedSession()
      const result = kind === "confirmed" ? { kind, user: USER } : { kind }
      if (shouldClearStoredSession(result)) setStoredSession(null)
      expect(getStoredSession() === null, `kind=${kind}`).toBe(kind === "rejected")
    }
  })
})
