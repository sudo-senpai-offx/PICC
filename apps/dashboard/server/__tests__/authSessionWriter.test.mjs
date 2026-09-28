// WS-7 AUTH-FAILOPEN round 3 — the session store's WRITER rules.
//
// readSessionsStrict() made every READER of sessions.json agree on what "broken"
// means. It did not make the WRITERS agree, and that left a live bug in the same
// class: createSession() and revokeToken() still read through the LENIENT
// readJSON(), then wrote the result back.
//
// Against the real module, with a real temp PICC_AUTH_DATA_DIR and no fs mock:
//
//   {"sessions":[]}       createAccount returns a token, the file is written back
//                         as {"sessions":[]}, and the issued session is SILENTLY
//                         LOST — login "succeeds" and nothing authenticates.
//   {"sessions":"x"}      TypeError: Cannot create property '<tok>' on string 'x'
//   {"sessions":5}        TypeError
//   {"sessions":true}     TypeError
//   unparseable / 0-byte  the store is silently REPLACED, so every other live
//                         session in it is destroyed by one login.
//
// The TypeError escape is the exact failure readUsersStrict() exists to prevent:
// a bare property access on a wrong-shaped value threw a TypeError that escaped
// isAuthStoreUnavailable's name check and surfaced as an unhandled 500. Same file,
// same class.
//
// The rule this file pins is therefore a WRITER rule, not a propagation rule: a
// corrupt store must never be silently overwritten, because overwriting it
// destroys every OTHER live session in it. Refusing to write is the only safe
// answer — refusing to issue a token only protects the new login.
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const DATA_DIR = mkdtempSync(join(tmpdir(), "picc-auth-writer-"))
vi.stubEnv("PICC_AUTH_DATA_DIR", DATA_DIR)

const SESSIONS = join(DATA_DIR, "sessions.json")
const USERS = join(DATA_DIR, "users.json")

const auth = await import("../services/auth.mjs")
const { createAccount, loginAccount, revokeToken, verifyToken, verifyTokenStrict, isAuthStoreUnavailable } = auth

const CRED = { email: "writer@example.test", password: "writer-password-9", name: "Writer" }
const OTHER_CRED = { email: "other@example.test", password: "other-password-9", name: "Other" }
const FUTURE = () => Date.now() + 60 * 60 * 1000

/** The literal text written to sessions.json, so unparseable shapes are expressible. */
const writeSessions = (literal) => writeFileSync(SESSIONS, literal, "utf8")
const sessionsRaw = () => readFileSync(SESSIONS, "utf8")
const sessionsJson = () => JSON.parse(sessionsRaw())

function writeUsers(users) {
  writeFileSync(USERS, JSON.stringify({ users }), "utf8")
}

const USER_ROW = {
  id: "u1",
  email: "preexisting@example.test",
  name: "Preexisting",
  salt: "s",
  passwordHash: "h",
  createdAt: "2026-01-01T00:00:00.000Z"
}

/** A live session for a pre-existing user, which a correct writer must not destroy. */
const liveSession = (token, userId = "u1") => ({
  [token]: { userId, createdAt: Date.now(), expiresAt: FUTURE() }
})

beforeEach(() => {
  for (const f of [SESSIONS, USERS]) rmSync(f, { force: true })
})

afterEach(() => {
  for (const f of [SESSIONS, USERS]) rmSync(f, { force: true })
})

/** Every wrong-shaped sessions store that must be refused by a writer. */
const CORRUPT_SHAPES = [
  ["an array", '{"sessions":[]}'],
  ["a string", '{"sessions":"x"}'],
  ["a number", '{"sessions":5}'],
  ["a boolean", '{"sessions":true}'],
  ["null", '{"sessions":null}'],
  ["an empty object", "{}"],
  ["a bare array", "[]"],
  ["a bare null", "null"],
  ["a bare number", "5"],
  ["a bare string", '"nope"'],
  ["unparseable", "{ this is not json"],
  ["empty (0 bytes)", ""]
]

describe("WS-7 round 3 — a wrong-shaped sessions store is never silently OVERWRITTEN", () => {
  it.each(CORRUPT_SHAPES)("createAccount refuses to write over a store that is %s", async (_label, literal) => {
    writeUsers([USER_ROW])
    writeSessions(literal)

    const res = await createAccount(CRED)

    expect(
      res?.token,
      "issuing a session against a corrupt store hands the caller a token that cannot work, " +
        "and writing the store back destroys every other live session in it"
    ).toBeUndefined()
    expect(
      sessionsRaw(),
      "the corrupt store must be left EXACTLY as found — a writer that normalises it is " +
        "destroying whatever live sessions it still holds"
    ).toBe(literal)
  })

  it.each(CORRUPT_SHAPES)("loginAccount refuses to write over a store that is %s", async (_label, literal) => {
    // The account is created FIRST, on a healthy store, so the credentials below
    // are a REAL salt/hash pair. Fixture rows like {passwordHash:"h"} are not, and
    // would be rejected by verifyPassword before createSession is ever reached -
    // which would make this test pass while the defect was still present.
    writeUsers([])
    const seeded = await createAccount(CRED)
    expect(seeded?.token).toBeTruthy()
    writeSessions(literal)

    const res = await loginAccount({ email: CRED.email, password: CRED.password }).catch((e) => e)

    expect(
      res?.name,
      `loginAccount must REFUSE, not throw a bare TypeError. Got: ${res?.name ?? "a result"} ${
        res?.message ?? JSON.stringify(res)
      }`
    ).not.toBe("TypeError")
    expect(
      typeof res?.error,
      "a refusal must be a described error, never a thrown TypeError escaping as a 500"
    ).toBe("string")
    expect(sessionsRaw(), "the corrupt store must be left exactly as found").toBe(literal)
  })

  it("no bare TypeError escapes createAccount for any wrong shape", async () => {
    for (const [label, literal] of CORRUPT_SHAPES) {
      writeUsers([USER_ROW])
      writeSessions(literal)
      const res = await createAccount({ ...CRED, email: `u-${label}@example.test` }).catch((e) => e)
      expect(
        res?.name,
        `createAccount threw a bare ${res?.name} for shape "${label}": ${res?.message}`
      ).not.toBe("TypeError")
    }
  })

  it("no bare TypeError escapes loginAccount for any wrong shape", async () => {
    for (const [label, literal] of CORRUPT_SHAPES) {
      // A fresh account per iteration: the users file persists across iterations
      // inside one test, and re-using the email would make createAccount answer
      // "already exists" and never reach createSession. The sessions file is
      // cleared too, because the PREVIOUS iteration left it corrupt - and the
      // seed is then correctly refused by the very rule this round adds.
      const cred = { ...CRED, email: `loop-${label.replace(/\W+/g, "-")}@example.test` }
      rmSync(SESSIONS, { force: true })
      rmSync(USERS, { force: true })
      const seeded = await createAccount(cred)
      expect(seeded?.token, `seed must succeed on a healthy store for shape "${label}"`).toBeTruthy()
      writeSessions(literal)
      const res = await loginAccount({ email: cred.email, password: cred.password }).catch((e) => e)
      expect(
        res?.name,
        `loginAccount threw a bare ${res?.name} for shape "${label}": ${res?.message}`
      ).not.toBe("TypeError")
    }
  })

  it("a live session recorded in a corrupt store is not destroyed by a refused signup", async () => {
    // The harm the writer rule exists to prevent. The store is wrong-shaped
    // (`sessions` is an array, so nothing can be read from it) but it is still the
    // ONLY record of the live sessions sitting in `liveSessions`. A lenient
    // writer reads `data.sessions ?? {}`, gets `[]`, and writes `{sessions: []}`
    // back — silently dropping the sibling key and every session in it. A correct
    // writer refuses and leaves the file byte-identical.
    const tok = "a".repeat(64)
    const literal = JSON.stringify({ sessions: [], liveSessions: liveSession(tok) })
    writeUsers([USER_ROW])
    writeSessions(literal)

    await createAccount(CRED)

    expect(sessionsRaw(), "the corrupt store must be left exactly as found").toBe(literal)
    const after = sessionsJson()
    expect(
      after.liveSessions?.[tok],
      "the live session recorded in the corrupt store was DESTROYED by a signup that should " +
        "have been refused — a writer that normalises a store it cannot read is how one corrupt " +
        "file becomes everyone's logged-out"
    ).toBeTruthy()
  })

  it("revokeToken refuses to write over a wrong-shaped store", async () => {
    const literal = '{"sessions":"x"}'
    writeSessions(literal)
    await revokeToken("whatever").catch(() => {})
    expect(sessionsRaw(), "revoking from a corrupt store must not normalise it into a store of its own").toBe(literal)
  })

  it("revokeToken leaves an unparseable store alone rather than replacing it", async () => {
    const literal = "{ this is not json"
    writeSessions(literal)
    await revokeToken("whatever").catch(() => {})
    expect(sessionsRaw(), "a corrupt store is evidence; overwriting it destroys whatever it held").toBe(literal)
  })
})

describe("WS-7 round 3 — a HEALTHY store still issues a session that authenticates", () => {
  it("signup issues a usable session and the file is well-formed", async () => {
    writeUsers([])
    const res = await createAccount(CRED)
    expect(res?.token, "first run must not break: an absent store is a genuine bootstrap").toBeTruthy()
    const stored = sessionsJson()
    expect(stored.sessions[res.token], "the issued token must actually be persisted").toBeTruthy()
    expect(stored.sessions[res.token].userId).toBe(res.user.id)
  })

  it("the issued session authenticates", async () => {
    writeUsers([])
    const res = await createAccount(CRED)
    await expect(verifyToken(res.token)).resolves.toBe(res.user.id)
    await expect(verifyTokenStrict(res.token)).resolves.toBe(res.user.id)
  })

  it("an EMPTY-but-well-formed sessions store still issues a session", async () => {
    writeUsers([])
    writeSessions('{"sessions":{}}')
    const res = await createAccount(CRED)
    expect(res?.token).toBeTruthy()
    await expect(verifyToken(res.token)).resolves.toBe(res.user.id)
  })

  it("login issues a usable session, and revoking it then stops authenticating", async () => {
    writeUsers([])
    const created = await createAccount(CRED)
    const login = await loginAccount({ email: CRED.email, password: CRED.password })
    expect(login?.token).toBeTruthy()
    // A second login for the same account is a second session, not a replacement.
    expect(Object.keys(sessionsJson().sessions).sort()).toEqual([created.token, login.token].sort())
    await expect(verifyToken(login.token)).resolves.toBe(created.user.id)

    await revokeToken(login.token)
    await expect(verifyToken(login.token)).resolves.toBeNull()
    // Revoking one session must not touch the other.
    await expect(verifyToken(created.token)).resolves.toBe(created.user.id)
  })

  it("a second signup preserves the first account's session", async () => {
    writeUsers([])
    const first = await createAccount(CRED)
    const second = await createAccount(OTHER_CRED)
    expect(Object.keys(sessionsJson().sessions).sort()).toEqual([first.token, second.token].sort())
    await expect(verifyToken(first.token)).resolves.toBe(first.user.id)
    await expect(verifyToken(second.token)).resolves.toBe(second.user.id)
  })
})
