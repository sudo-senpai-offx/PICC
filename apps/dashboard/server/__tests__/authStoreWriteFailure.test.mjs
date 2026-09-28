// WS-7 AUTH-FAILOPEN round 4 — the WRITE side of the store rules, and the two
// stores.
//
// Round 3 closed the READ side of the sessions store. Two things were left, and both
// are worse than the bug round 3 fixed:
//
// 1. users.json had NO writer rule at all. createAccount read through the LENIENT
//    listUsers() and wrote back, so a corrupt users.json was normalised — and a
//    corrupt users.json makes every authenticated route 503, so the owner cannot
//    reach the UI to diagnose it. The only reachable endpoint then destroys every
//    account, scrypt hashes included. That is strictly worse than the sessions case:
//    a lost session is re-obtainable by logging in; a lost password hash is not.
//
// 2. Even the sessions writer rule was read-only. writeJSON() returns FALSE on a
//    write failure (it logs and swallows), and both createSession and revokeToken
//    discarded that. So login answered 200 {ok:true, token} with a token that was
//    never persisted, and revokeToken answered "revoked" while the token stayed
//    live for 30 days. Two comments in auth.mjs asserted the opposite of what the
//    code did.
//
// The write failure is produced by making `rename` fail, which is the last step of
// the atomic tmp+rename persist. Everything else is real: real temp data dir, real
// reads, real validation, real scrypt hashing. Only the syscall that represents "the
// disk refused to persist" is replaced, because that is the condition under test and
// a Windows ACL is not portable.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ failRename: false, renameCalls: 0 }))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    rename: async (from, to) => {
      h.renameCalls += 1
      if (h.failRename) {
        const err = new Error("EPERM: simulated write denial")
        err.code = "EPERM"
        throw err
      }
      return actual.rename(from, to)
    }
  }
})

const DATA_DIR = mkdtempSync(join(tmpdir(), "picc-auth-writefail-"))
vi.stubEnv("PICC_AUTH_DATA_DIR", DATA_DIR)

const SESSIONS = join(DATA_DIR, "sessions.json")
const USERS = join(DATA_DIR, "users.json")

const auth = await import("../services/auth.mjs")
const { createAccount, loginAccount, revokeToken, verifyToken, isAuthStoreUnavailable } = auth
const { handleApi } = await import("../handlers.mjs?auth-store-write-failure")

const CRED = { email: "wf@example.test", password: "writefail-password-9", name: "WF" }
const FUTURE = () => Date.now() + 3_600_000

/** The minimal req/res doubles, matching the shape handleApi expects. */
function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}
function makeRes() {
  const chunks = []
  const res = {
    status: null,
    headers: {},
    writeHead(status, headers = {}) {
      res.status = status
      res.headers = headers
    },
    write(chunk) {
      chunks.push(chunk)
    },
    end(chunk) {
      if (chunk) chunks.push(chunk)
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
  return res
}
async function call(method, path, { body, headers } = {}) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

const seedUser = () => {
  writeFileSync(
    USERS,
    JSON.stringify({ users: [{ id: "u1", email: "owner@example.test", name: "Owner", salt: "s", passwordHash: "h", createdAt: "2026-01-01T00:00:00.000Z" }] }),
    "utf8"
  )
}
const seedSession = (token = "a".repeat(64)) => {
  writeFileSync(SESSIONS, JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: 1, expiresAt: FUTURE() } } }), "utf8")
}
const usersRaw = () => readFileSync(USERS, "utf8")
const sessionsRaw = () => readFileSync(SESSIONS, "utf8")

beforeEach(() => {
  h.failRename = false
  h.renameCalls = 0
  rmSync(SESSIONS, { force: true })
  rmSync(USERS, { force: true })
})
afterEach(() => {
  h.failRename = false
})

// ── 1. users.json has no writer rule at all ─────────────────────────────────

/** Every wrong-shaped users store, the mirror of the sessions table. */
const CORRUPT_USERS = [
  ["a string", '{"users":"x"}'],
  ["an object", '{"users":{"a":1}}'],
  ["a number", '{"users":5}'],
  ["a boolean", '{"users":true}'],
  ["null", '{"users":null}'],
  ["an empty object", "{}"],
  ["a top-level array", "[]"],
  ["a bare null", "null"],
  ["unparseable", "{ not json"],
  ["0 bytes", ""]
]

describe("round 4 — a corrupt users.json is never overwritten by a signup", () => {
  it.each(CORRUPT_USERS)("signup refuses to write over a users store that is %s", async (_label, literal) => {
    writeFileSync(USERS, literal, "utf8")
    seedSession()

    const res = await createAccount(CRED)

    expect(
      res?.token,
      "issuing a session against an unreadable users store normalises the store on write-back, and " +
        "a corrupt users.json is what makes every authenticated route 503 — so the owner cannot " +
        "reach the UI to diagnose it, and the only reachable endpoint destroys the accounts"
    ).toBeUndefined()
    expect(usersRaw(), "the corrupt users store must be left byte-identical").toBe(literal)
  })

  it("a refused signup leaves the accounts it could not read intact", async () => {
    // The same demonstration that worked for sessions: the corrupt file is still
    // the only record of what it holds.
    const token = "a".repeat(64)
    const literal = JSON.stringify({ users: "corrupt", accounts: { [token]: { email: "owner@x.com" } } })
    writeFileSync(USERS, literal, "utf8")
    seedSession()

    await createAccount(CRED)

    expect(usersRaw(), "the store must be left exactly as found").toBe(literal)
    expect(JSON.parse(usersRaw()).accounts?.[token], "the recorded account was DESTROYED by a signup that should have been refused").toBeTruthy()
  })

  it("signup on a HEALTHY store still creates the account", async () => {
    writeFileSync(USERS, JSON.stringify({ users: [] }), "utf8")
    const res = await createAccount(CRED)
    expect(res?.token, "first run must still work").toBeTruthy()
    expect(JSON.parse(usersRaw()).users.some((u) => u.email === CRED.email)).toBe(true)
  })
})

// ── 2. the write side of the sessions rule ──────────────────────────────────

describe("round 4 — a session is issued only if it was actually PERSISTED", () => {
  it("createSession issues nothing when the write fails", async () => {
    seedUser()
    seedSession()
    const before = sessionsRaw()
    h.failRename = true

    const res = await createAccount(CRED)

    expect(
      res?.token,
      "writeJSON reports failure with a boolean that was being discarded, so login answered " +
        "200 {ok:true} with a token that had never been persisted"
    ).toBeUndefined()
    expect(sessionsRaw(), "the sessions store must be unchanged when the write was denied").toBe(before)
  })

  it("the issued token, had one been issued, would not authenticate — so none is offered", async () => {
    seedUser()
    seedSession()
    h.failRename = true
    const res = await createAccount(CRED)
    if (res?.token) {
      await expect(verifyToken(res.token)).resolves.toBeNull()
    }
    expect(res?.token, "a token that cannot authenticate must never be returned").toBeUndefined()
  })

  it("revokeToken does NOT report success when the write is denied", async () => {
    seedUser()
    const token = "b".repeat(64)
    seedSession(token)
    const before = sessionsRaw()
    h.failRename = true

    const outcome = await revokeToken(token).catch((e) => e)

    expect(
      outcome,
      "revokeToken must not return true for a revocation that did not persist — the token would " +
        "stay live for its full 30-day TTL while the caller reports a clean logout"
    ).not.toBe(true)
    expect(
      isAuthStoreUnavailable(outcome),
      `a store fault must surface as AuthStoreUnavailable, got ${outcome?.name}: ${outcome?.message}`
    ).toBe(true)
    expect(sessionsRaw(), "the store must be unchanged when the write was denied").toBe(before)
  })

  it("revokeToken still returns true for a revocation that DID persist", async () => {
    seedUser()
    const token = "b".repeat(64)
    seedSession(token)
    const outcome = await revokeToken(token)
    expect(outcome, "the new contract needs a positive test, not only the refusal path").toBe(true)
    await expect(verifyToken(token)).resolves.toBeNull()
  })

  it("revokeToken returns false for a genuine no-op (unknown token) on a healthy store", async () => {
    seedUser()
    seedSession()
    await expect(revokeToken("never-existed")).resolves.toBe(false)
  })
})

// ── 3. the CALLER must not answer 200, and must not call a fault a credential error ──

describe("round 4 — the HTTP caller distinguishes a store fault from bad credentials", () => {
  it("signup on a corrupt users store is NOT 400: nothing was wrong with the request", async () => {
    writeFileSync(USERS, '{"users":null}', "utf8")
    seedSession()
    const res = await call("POST", "/api/auth/signup", { body: CRED })
    expect(
      res.status,
      `400 and 401 are both CLAIMS about the request or the credentials. A store fault is neither, ` +
        `and the client acts on the claim. Got ${res.status}: ${res.text}`
    ).toBe(503)
    expect(res.body?.error).toMatch(/store/i)
  })

  it("signup with a write denial is NOT 200", async () => {
    writeFileSync(USERS, JSON.stringify({ users: [] }), "utf8")
    h.failRename = true
    const res = await call("POST", "/api/auth/signup", { body: CRED })
    expect(res.status, `a token that was never persisted must not be handed out. Got ${res.status}`).not.toBe(200)
    expect(res.status).toBe(503)
  })

  it("login whose session write is denied is NOT 200", async () => {
    // A real account, so the failure can only be the write.
    writeFileSync(USERS, JSON.stringify({ users: [] }), "utf8")
    const seeded = await createAccount(CRED)
    expect(seeded?.token).toBeTruthy()
    h.failRename = true
    const res = await call("POST", "/api/auth/login", { body: { email: CRED.email, password: CRED.password } })
    expect(res.status, "a login that could not persist its session must not answer ok:true").not.toBe(200)
    expect(res.status).toBe(503)
  })

  it("logout whose revoke write is denied is NOT ok:true", async () => {
    const seeded = await createAccount(CRED)
    expect(seeded?.token).toBeTruthy()
    h.failRename = true
    const res = await call("POST", "/api/auth/signout", {
      headers: { authorization: `Bearer ${seeded.token}` }
    })
    expect(
      res.status,
      "the token is still live, so {ok:true} is a lie the client acts on by clearing local state"
    ).toBe(503)
  })

  it("logout that DID persist still answers ok:true", async () => {
    const seeded = await createAccount(CRED)
    const res = await call("POST", "/api/auth/signout", {
      headers: { authorization: `Bearer ${seeded.token}` }
    })
    expect(res.status).toBe(200)
    expect(res.body?.ok).toBe(true)
    await expect(verifyToken(seeded.token)).resolves.toBeNull()
  })

  it("a GENUINE bad-credentials login is STILL a true 401", async () => {
    // The control that stops the status-mapping fix becoming a blanket 503.
    writeFileSync(USERS, JSON.stringify({ users: [] }), "utf8")
    const seeded = await createAccount(CRED)
    expect(seeded?.token).toBeTruthy()
    const res = await call("POST", "/api/auth/login", { body: { email: CRED.email, password: "wrong-password-x" } })
    expect(res.status, "wrong credentials really are a 401 — a claim about the token, and a true one").toBe(401)
    expect(res.body?.error).toMatch(/incorrect password/i)
  })

  it("a GENUINE unknown-account login is STILL a true 401", async () => {
    writeFileSync(USERS, JSON.stringify({ users: [] }), "utf8")
    const res = await call("POST", "/api/auth/login", { body: { email: "nobody@example.test", password: "whatever-1234" } })
    expect(res.status).toBe(401)
  })

  it("a GENUINE invalid signup payload is STILL a 400", async () => {
    writeFileSync(USERS, JSON.stringify({ users: [] }), "utf8")
    const res = await call("POST", "/api/auth/signup", { body: { email: "not-an-email", password: "short" } })
    expect(res.status, "a malformed request is still the caller's fault and still a 400").toBe(400)
  })
})
