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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchMe, getStoredSession } from "../auth"

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

describe("fetchMe — only an authoritative rejection destroys the session", () => {
  beforeEach(() => {
    window.localStorage.clear()
    seedSession()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it("returns the user and keeps the session on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, { ok: true, user: USER })))
    await expect(fetchMe()).resolves.toEqual(USER)
    expect(getStoredSession()).not.toBeNull()
  })

  it("clears the session when the server authoritatively answers 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(401, { error: "not authenticated" })))
    await expect(fetchMe()).resolves.toBeNull()
    expect(getStoredSession()).toBeNull()
  })

  it("clears the session on 403", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(403, { error: "forbidden" })))
    await expect(fetchMe()).resolves.toBeNull()
    expect(getStoredSession()).toBeNull()
  })

  // The exact failure mode that produced the flake: the auth store was briefly
  // unreadable, the server said "could not tell", and the session was deleted.
  it("KEEPS the session when the auth store is unavailable (503)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(503, { error: "auth store unavailable" })))
    await expect(fetchMe()).resolves.toBeUndefined()
    expect(getStoredSession()).not.toBeNull()
  })

  it("KEEPS the session on a 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(500, { error: "internal error" })))
    await expect(fetchMe()).resolves.toBeUndefined()
    expect(getStoredSession()).not.toBeNull()
  })

  it("KEEPS the session on a 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(429, { error: "rate limit exceeded" })))
    await expect(fetchMe()).resolves.toBeUndefined()
    expect(getStoredSession()).not.toBeNull()
  })

  it("KEEPS the session when the request never completes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      })
    )
    await expect(fetchMe()).resolves.toBeUndefined()
    expect(getStoredSession()).not.toBeNull()
  })

  it("KEEPS the session when a 200 body does not parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, null, true)))
    await expect(fetchMe()).resolves.toBeUndefined()
    expect(getStoredSession()).not.toBeNull()
  })

  it("KEEPS the session when a 200 body carries no user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, { ok: true })))
    await expect(fetchMe()).resolves.toBeUndefined()
    expect(getStoredSession()).not.toBeNull()
  })

  it("returns null when there is no token to check", async () => {
    window.localStorage.clear()
    const spy = vi.fn()
    vi.stubGlobal("fetch", spy)
    await expect(fetchMe()).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
