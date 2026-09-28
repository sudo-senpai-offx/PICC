// Handler-level regression guard for the WS-6 T10 terminal-performance flake.
//
// The unit guard in authStoreFault.test.mjs covers resolveAuthUser() in
// isolation. This one pins the wire contract the browser actually depends on:
// GET /api/auth/me must answer 503 — "could not tell" — when the auth store
// cannot be read, and reserve 401 for a token that really was rejected.
//
// Why the client cares: 401 is treated as authoritative enough to DELETE the
// stored session, which is what bounced the app to /login and made
// `page.waitForSelector("[data-room='markets']")` burn its full 30s in that spec.
// A store fault must never be laundered into a 401.
//
// The fault here is induced with an UNPARSEABLE sessions.json, which needs no
// fs mocking: the old readJSON() swallowed the parse error into an empty
// fallback and answered 401, so this test is red against the old behaviour.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TOKEN = "a".repeat(64)
const FUTURE = Date.now() + 60 * 60 * 1000
const PAST = Date.now() - 60 * 60 * 1000

const USER_ROW = {
  id: "u1",
  email: "e@example.test",
  name: "E",
  salt: "s",
  passwordHash: "h",
  createdAt: "2026-01-01T00:00:00.000Z"
}

function makeReq(method, url, headers = {}) {
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    raw: null,
    on(evt, cb) {
      // handleApi drains the body before routing, so 'end' must fire or it
      // never resolves.
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

let dir

function writeSessions(value) {
  writeFileSync(join(dir, "sessions.json"), value, "utf8")
}
function writeUsers(value) {
  writeFileSync(join(dir, "users.json"), value, "utf8")
}

async function callMe(authorization) {
  const { handleApi } = await import("../handlers.mjs?auth-me-status-test")
  const res = makeRes()
  const headers = authorization ? { authorization } : {}
  await handleApi(makeReq("GET", "/api/auth/me", headers), res, "/api/auth/me")
  return res
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "picc-auth-me-"))
  vi.stubEnv("PICC_AUTH_DATA_DIR", dir)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

describe("GET /api/auth/me status semantics", () => {
  it("returns 200 and the user for a valid token", async () => {
    writeSessions(JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: FUTURE } } }))
    writeUsers(JSON.stringify({ users: [USER_ROW] }))

    const res = await callMe(`Bearer ${TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.user).toEqual({
      id: "u1",
      email: "e@example.test",
      name: "E",
      createdAt: "2026-01-01T00:00:00.000Z"
    })
    expect(JSON.stringify(res.body)).not.toContain("passwordHash")
  })

  // The flake. Unreadable store must be inconclusive, never "signed out".
  it("answers 503, NOT 401, when the sessions store is unparseable", async () => {
    writeSessions("{ this is not json")
    writeUsers(JSON.stringify({ users: [USER_ROW] }))

    const res = await callMe(`Bearer ${TOKEN}`)
    expect(res.status).toBe(503)
    expect(res.status).not.toBe(401)
  })

  it("answers 503, NOT 401, when the users store is unparseable", async () => {
    writeSessions(JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: FUTURE } } }))
    writeUsers("}}} not json either")

    const res = await callMe(`Bearer ${TOKEN}`)
    expect(res.status).toBe(503)
  })

  it("answers 401 when the store is simply ABSENT (a fresh install is signed out)", async () => {
    const res = await callMe(`Bearer ${TOKEN}`)
    expect(res.status).toBe(401)
  })

  it("answers 401 for an unknown token", async () => {
    writeSessions(JSON.stringify({ sessions: {} }))
    writeUsers(JSON.stringify({ users: [USER_ROW] }))

    const res = await callMe(`Bearer ${"b".repeat(64)}`)
    expect(res.status).toBe(401)
  })

  it("answers 401 for an expired session", async () => {
    writeSessions(JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: PAST } } }))
    writeUsers(JSON.stringify({ users: [USER_ROW] }))

    const res = await callMe(`Bearer ${TOKEN}`)
    expect(res.status).toBe(401)
  })

  it("answers 401 when no Authorization header is sent", async () => {
    writeSessions(JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: FUTURE } } }))
    writeUsers(JSON.stringify({ users: [USER_ROW] }))

    const res = await callMe(undefined)
    expect(res.status).toBe(401)
  })
})
