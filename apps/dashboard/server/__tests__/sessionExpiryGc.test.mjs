// Guards the session lookup+expiry consolidation (and the deliberate tightening
// of the missing-expiresAt case).
//
// Two regressions are pinned here:
//
//  1. GC. `/api/auth/me` is where a client that never touches another route
//     discovers its session is dead. If that path stops pruning, sessions.json —
//     which is re-read in full on every auth check — grows an expired entry per
//     dead session forever, for exactly the client least likely to visit a route
//     that would otherwise collect it.
//  2. Missing expiry. The old check was `Date.now() > s.expiresAt`. With
//     expiresAt absent that is `undefined > n` → false, so a session row with no
//     expiry was treated as valid FOREVER. That is now resolved against the
//     session (fail closed) and asserted explicitly, so the tightening is a
//     recorded decision rather than an accident.
//
// The assertions read sessions.json back off disk: that is the observable
// effect of pruning, not an internal call count.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TOKEN = "a".repeat(64)
const ME = "/api/auth/me"

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
function sessionsOnDisk() {
  return JSON.parse(readFileSync(join(dir, "sessions.json"), "utf8")).sessions ?? {}
}

async function callMe(authorization) {
  const { handleApi } = await import("../handlers.mjs?session-gc-test")
  const res = makeRes()
  await handleApi(makeReq("GET", ME, { authorization }), res, ME)
  return res
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "picc-session-gc-"))
  vi.stubEnv("PICC_AUTH_DATA_DIR", dir)
  vi.resetModules()
  writeUsers({ users: [USER_ROW] })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

describe("/api/auth/me garbage-collects and fails closed on expiry", () => {
  it("PRUNES an expired session from sessions.json", async () => {
    writeSessions({ sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: Date.now() - 1000 } } })
    expect(Object.keys(sessionsOnDisk())).toContain(TOKEN)

    const res = await callMe(`Bearer ${TOKEN}`)

    // Rejected…
    expect(res.status).toBe(401)
    // …and actually gone from the store, not merely ignored.
    expect(Object.keys(sessionsOnDisk())).not.toContain(TOKEN)
  })

  it("leaves a LIVE session in place", async () => {
    writeSessions({ sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } } })

    const res = await callMe(`Bearer ${TOKEN}`)

    expect(res.status).toBe(200)
    expect(Object.keys(sessionsOnDisk())).toContain(TOKEN)
  })

  // The deliberate tightening: no expiresAt used to mean "immortal".
  it("treats a session row with NO expiresAt as dead, and prunes it", async () => {
    writeSessions({ sessions: { [TOKEN]: { userId: "u1", createdAt: 1 } } })

    const res = await callMe(`Bearer ${TOKEN}`)

    expect(res.status).toBe(401)
    expect(Object.keys(sessionsOnDisk())).not.toContain(TOKEN)
  })

  it("treats a non-numeric expiresAt as dead", async () => {
    writeSessions({ sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: "never" } } })

    const res = await callMe(`Bearer ${TOKEN}`)
    expect(res.status).toBe(401)
  })

  it("prunes only the presented dead session, leaving other live ones", async () => {
    const other = "b".repeat(64)
    writeSessions({
      sessions: {
        [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: Date.now() - 1000 },
        [other]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 }
      }
    })

    await callMe(`Bearer ${TOKEN}`)

    const onDisk = sessionsOnDisk()
    expect(onDisk[TOKEN]).toBeUndefined()
    expect(onDisk[other]).toBeDefined()
  })
})
