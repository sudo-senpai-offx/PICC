// Regression guard for the WS-6 T10 terminal-performance flake.
//
// A `page.waitForSelector("[data-room='markets']")` timeout there was traced
// (from Playwright's own failure snapshot, which showed the LOGIN page) to a
// VALID session being destroyed by one inconclusive answer from /api/auth/me.
//
// This file guards the SERVER half of that: readJSON() folds every read/parse
// error into an empty fallback, so a transient store fault used to be reported
// as "no such session" — a false 401, which the client acts on by deleting the
// session. resolveAuthUser() keeps "no such session" and "could not read the
// store" apart, so the handler can answer 503 for the second and a true 401
// only for the first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// WS-7 slice A: see authSessionWriter.test.mjs for why this goes through the
// shared contract instead of assigning `process.env` by hand.
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const DATA_DIR = useIsolatedStoreDir("PICC_AUTH_DATA_DIR", { prefix: "picc-auth-store" })

// Read control has to live in hoisted state because vi.mock factories are
// hoisted above the module's own imports.
const h = vi.hoisted(() => ({ readFileImpl: null }))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, readFile: (...args) => h.readFileImpl(...args) }
})

const { resolveAuthUser, isAuthStoreUnavailable } = await import("../services/auth.mjs")

const USER_ROW = {
  id: "u1",
  email: "e@example.test",
  name: "E",
  salt: "s",
  passwordHash: "h",
  createdAt: "2026-01-01T00:00:00.000Z"
}

const FUTURE = Date.now() + 60 * 60 * 1000
const PAST = Date.now() - 60 * 60 * 1000

/** Serve the fixtures by filename, optionally faulting one of the two reads. */
function serveStores({ sessions, users } = {}, fault) {
  h.readFileImpl = async (file) => {
    if (fault && String(file).endsWith(fault)) {
      const err = new Error(`simulated ${fault} on ${file}`)
      err.code = fault
      throw err
    }
    if (String(file).endsWith("sessions.json")) return JSON.stringify(sessions ?? { sessions: {} })
    if (String(file).endsWith("users.json")) return JSON.stringify(users ?? { users: [] })
    const err = new Error(`unexpected read: ${file}`)
    err.code = "ENOENT"
    throw err
  }
}

afterEach(() => {
  h.readFileImpl = null
})

describe("resolveAuthUser — a store fault is not 'not authenticated'", () => {
  it("returns the public user for a valid token", async () => {
    serveStores({
      sessions: { sessions: { tok: { userId: "u1", createdAt: 1, expiresAt: FUTURE } } },
      users: { users: [USER_ROW] }
    })
    const user = await resolveAuthUser("Bearer tok")
    expect(user).toEqual({
      id: "u1",
      email: "e@example.test",
      name: "E",
      createdAt: "2026-01-01T00:00:00.000Z"
    })
    // The password material must never travel back out.
    expect(JSON.stringify(user)).not.toContain("passwordHash")
    expect(JSON.stringify(user)).not.toContain("salt")
  })

  it("throws AuthStoreUnavailable when the sessions file cannot be read", async () => {
    serveStores({}, "sessions.json")
    // A transient Windows rename/lock fault, which is the shape that actually bit.
    const err = await resolveAuthUser("Bearer tok").catch((e) => e)
    expect(isAuthStoreUnavailable(err)).toBe(true)
  })

  it("throws AuthStoreUnavailable when the users file cannot be read", async () => {
    serveStores(
      { sessions: { sessions: { tok: { userId: "u1", createdAt: 1, expiresAt: FUTURE } } } },
      "users.json"
    )
    const err = await resolveAuthUser("Bearer tok").catch((e) => e)
    expect(isAuthStoreUnavailable(err)).toBe(true)
  })

  it("throws AuthStoreUnavailable when a store file is unparseable", async () => {
    h.readFileImpl = async (file) => {
      if (String(file).endsWith("sessions.json")) return "{ this is not json"
      return JSON.stringify({ users: [USER_ROW] })
    }
    const err = await resolveAuthUser("Bearer tok").catch((e) => e)
    expect(isAuthStoreUnavailable(err)).toBe(true)
  })

  it("treats an ABSENT store as a genuine 401, not a fault", async () => {
    h.readFileImpl = async () => {
      const err = new Error("no such file")
      err.code = "ENOENT"
      throw err
    }
    // A fresh install has no store yet; that is "signed out", not "unavailable".
    await expect(resolveAuthUser("Bearer tok")).resolves.toBeNull()
  })

  it("returns null for an unknown token", async () => {
    serveStores({ sessions: { sessions: {} }, users: { users: [USER_ROW] } })
    await expect(resolveAuthUser("Bearer nope")).resolves.toBeNull()
  })

  it("returns null for an expired session", async () => {
    serveStores({
      sessions: { sessions: { tok: { userId: "u1", createdAt: 1, expiresAt: PAST } } },
      users: { users: [USER_ROW] }
    })
    await expect(resolveAuthUser("Bearer tok")).resolves.toBeNull()
  })

  it("returns null for a missing or malformed header", async () => {
    serveStores({ sessions: { sessions: { tok: { userId: "u1", expiresAt: FUTURE } } } })
    await expect(resolveAuthUser(undefined)).resolves.toBeNull()
    await expect(resolveAuthUser("tok")).resolves.toBeNull()
    await expect(resolveAuthUser("Bearer ")).resolves.toBeNull()
  })
})
