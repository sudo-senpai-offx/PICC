// Security regression guard: requireAuth must FAIL CLOSED when the user store
// cannot be read.
//
// requireAuth() carries a first-user bootstrap bypass — with no accounts at all
// it lets anyone through so the first one can be created. That bypass is
// written as `|| !(await hasUsers())`, and hasUsers() answers false for BOTH
// "no users exist" and "users.json could not be read". So an unreadable
// users.json satisfied the bypass and every requireAuth-guarded route was served
// UNAUTHENTICATED. The /api/auth/me hardening closed the same defect class on
// the read path; this is the same root cause with the worse failure direction.
//
// These tests assert the observable wire behaviour of a real guarded route
// (GET /api/trading/ledger), not requireAuth's internals, so a refactor cannot
// pass them vacuously.
//
// The fake request has no `socket`, so clientIp() falls back to "unknown" and
// the documented loopback bypass in isLocalhostRequest() does NOT fire — these
// requests genuinely reach the auth gate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const LEDGER = "/api/trading/ledger"

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
    // No `socket`, so clientIp() → "unknown" and isLocalhostRequest() is false.
    headers: { host: "example.test", "content-type": "application/json", ...headers },
    raw: null,
    on(evt, cb) {
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
  writeFileSync(join(dir, "sessions.json"), typeof value === "string" ? value : JSON.stringify(value), "utf8")
}
function writeUsers(value) {
  writeFileSync(join(dir, "users.json"), typeof value === "string" ? value : JSON.stringify(value), "utf8")
}

async function callLedger(authorization) {
  const { handleApi } = await import("../handlers.mjs?require-auth-fails-closed-test")
  const res = makeRes()
  const headers = authorization ? { authorization } : {}
  await handleApi(makeReq("GET", LEDGER, headers), res, LEDGER)
  return res
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "picc-require-auth-"))
  vi.stubEnv("PICC_AUTH_DATA_DIR", dir)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

describe("requireAuth fails closed on a user-store fault", () => {
  // THE FINDING. Before the fix this returned 200 with the ledger payload to a
  // caller who had never authenticated.
  it("REFUSES a guarded route when users.json is unreadable", async () => {
    // No session at all, so the gate must fall through to the bootstrap bypass…
    writeSessions({ sessions: {} })
    // …but the user store cannot be read, so that bypass is not satisfied.
    writeUsers("{ not json")

    const res = await callLedger(undefined)
    expect([401, 503]).toContain(res.status)
    // The decisive assertion: the route's payload must never be disclosed.
    expect(JSON.stringify(res.body ?? {})).not.toContain("entries")
    expect(res.body?.ok).not.toBe(true)
  })

  it("refuses with 503, not 401, so the browser does not treat it as a rejected token", async () => {
    writeSessions({ sessions: {} })
    writeUsers("{ not json")

    const res = await callLedger(undefined)
    expect(res.status).toBe(503)
    expect(res.body?.error).toBe("auth store unavailable")
  })

  it("REFUSES when users.json is unparseable even if a bearer token is presented", async () => {
    // A token that is not in the session store cannot authenticate, and the
    // degraded user store must not turn that into a pass either.
    writeSessions({ sessions: {} })
    writeUsers("}}} still not json")

    const res = await callLedger(`Bearer ${"a".repeat(64)}`)
    expect([401, 503]).toContain(res.status)
    expect(JSON.stringify(res.body ?? {})).not.toContain("entries")
  })

  // Guards the requirement NOT to break the legitimate first-run flow.
  it("still admits the first-user bootstrap when the store is genuinely empty", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [] }) // readable, genuinely empty

    const res = await callLedger(undefined)
    // Admitted, i.e. NOT refused — the bootstrap bypass still works.
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(503)
  })

  it("still admits a genuine first-user bootstrap when no store exists at all", async () => {
    // No users.json, no sessions.json: a fresh install.
    const res = await callLedger(undefined)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(503)
  })

  it("still serves a real session when the store is healthy", async () => {
    const token = "a".repeat(64)
    writeSessions({ sessions: { [token]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } } })
    writeUsers({ users: [USER_ROW] })

    const res = await callLedger(`Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body?.ok).toBe(true)
  })

  it("still refuses an unauthenticated caller when the store is healthy and users exist", async () => {
    writeSessions({ sessions: {} })
    writeUsers({ users: [USER_ROW] })

    const res = await callLedger(undefined)
    expect(res.status).toBe(401)
    expect(JSON.stringify(res.body ?? {})).not.toContain("entries")
  })
})
