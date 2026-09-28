// WS-6 T10 INSTRUMENTATION (round 4, revised by WS-7 slice B) — the terminal-performance
// flake is UNROOTED.
//
// Rounds 1, 2 and 3 each proposed a mechanism; round 2's was disproven and rounds 1
// and 3 are mis-specified on the observable (on the inconclusive path the app
// RENDERS with the retained session, so `[data-room='markets']` is satisfied in
// about a second and a 30s selector timeout does not match it — confirmed by
// reading the room-mount guard at src/App.tsx:29, which tests the SESSION and not
// `session.user`). No fifth mechanism is proposed here. These tests pin the
// observation points that let ONE failing run NAME a mechanism:
//
//   1. /api/auth/me writes one `src: "auth-me"` line per answer, carrying the branch
//      that produced it plus the e2e run id.
//   2. Store faults are counted PER SIDE — refused persists and unreadable-or-wrong-
//      shaped stores are two separate counters, both keyed on the file name — and
//      /api/auth/status surfaces both, so one failing run can say WHICH mechanism
//      fired instead of merely eliminating one.
//   3. The client logs a sign-out line carrying the reason, the inconclusive pass
//      number, and the elapsed time of the CURRENT chain of attempts. That number
//      is asserted BEHAVIOURALLY in src/hooks/__tests__/useAuth.signOutTrace.test.tsx;
//      the source-regex assertion round 4 shipped for it could not detect the defect
//      it claimed to guard and is gone.
//
// ── WHAT SLICE B CHANGED, AND WHY IT WAS NOT OPTIONAL ───────────────────────
// Every one of round 4's three observation points was non-functional in the
// environment it exists for, and each was green in CI while being so:
//
//   - the /me trace was gated on PICC_ERROR_LOG, which the e2e harness pins to "0";
//   - the write counter could not distinguish a read fault (which returns before
//     writeJSON is called) from a healthy store;
//   - the client's elapsed time was measured from mount and never rebased, so the
//     discriminator it was supposed to drive was unsound.
//
// The reachability half is pinned by server/__tests__/authMeTraceHarnessReach.test.mjs,
// which builds the env the e2e harness builds and proves a line is written.
//
// The properties asserted alongside them are deliberate: instrumentation that leaks
// a token, writes to a log nobody enabled, or pollutes the real store is worse than
// no instrumentation. The last of those is not hypothetical — an earlier draft of
// THIS file misspelled PICC_AUTH_DATA_DIR, and the suite went green while silently
// appending a test account to the developer's real server/data/users.json. The
// "writes only into the temp store" test below exists because of that.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const HANDLERS = "../handlers.mjs"
const AUTH = "../services/auth.mjs"
const CRED = { email: "user@picc.test", password: "correct horse battery staple" }

let dir
let logFile
let handleApi
let auth
// PER TEST, not per fixture. Faulting rename for the whole file would make
// createAccount() return a store fault, so there would be no user to confirm and no
// session to inspect, and the instrumentation could not be observed at all.
let RENAME_FAILS = false

function makeReq(method, url, { headers = {}, body } = {}) {
  const listeners = {}
  const raw = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8")
  return {
    method,
    url,
    headers: { host: "example.test", "content-type": "application/json", ...headers },
    raw,
    on(evt, cb) {
      ;(listeners[evt] ??= []).push(cb)
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
    destroy() {}
  }
}

function makeRes() {
  const chunks = []
  return {
    status: null,
    headers: null,
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    statusCode: null,
    text: "",
    body: null,
    setHeader(k, v) {
      this.headers ??= {}
      this.headers[k] = v
    },
    getHeader(k) {
      return this.headers?.[k]
    },
    removeHeader() {},
    writeHead(code) {
      this.status = code
      this.statusCode = code
    },
    write(chunk) {
      chunks.push(chunk)
      return true
    },
    end(chunk) {
      if (chunk != null) chunks.push(chunk)
      this.text = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(String(c))))).toString("utf8")
      try {
        this.body = this.text ? JSON.parse(this.text) : null
      } catch {
        this.body = null
      }
      this.writableEnded = true
    },
    on() {
      return this
    },
    once() {
      return this
    },
    removeAllListeners() {},
    emit() {}
  }
}

async function call(method, url, opts) {
  const req = makeReq(method, url, opts)
  const res = makeRes()
  await handleApi(req, res, url)
  return res
}

/** Only the auth-me lines, so a noisy shared log does not fail a count. */
function authMeLines() {
  if (!logFile || !existsSync(logFile)) return []
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter((l) => l && l.src === "auth-me")
}

/** The sum of a counter object, which is how "non-zero" is expressed here. */
function total(counter) {
  return Object.values(counter ?? {}).reduce((a, b) => a + b, 0)
}

beforeEach(async () => {
  // WS-7 slice A: both redirected through the shared contract. This is the file
  // that RECORDS the round-4 misspelling of PICC_AUTH_DATA_DIR (see the
  // regression test at the bottom); the helper makes that typo unwritable here
  // as well, because it refuses any name the contract does not know.
  dir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR", { prefix: "picc-ws7-t10" })
  logFile = useIsolatedStoreDir("PICC_ERROR_LOG_FILE", { prefix: "picc-ws7-t10-log" })
  process.env.PICC_E2E_RUN_ID = "run-t10-fixture"
  delete process.env.PICC_ERROR_LOG
  RENAME_FAILS = false

  vi.resetModules()
  vi.doMock("node:fs/promises", async () => {
    const real = await vi.importActual("node:fs/promises")
    return {
      ...real,
      // The atomic tmp+rename the store depends on. Faulting it models a disk that
      // accepts a write and then refuses to persist it, which is the failure mode
      // the counter exists to expose and the one no existing assertion could see.
      rename: vi.fn((from, to) =>
        RENAME_FAILS
          ? Promise.reject(Object.assign(new Error("EACCES simulated"), { code: "EACCES" }))
          : real.rename(from, to)
      )
    }
  })
  handleApi = (await import(HANDLERS)).handleApi
  auth = await import(AUTH)
})

afterEach(() => {
  vi.doUnmock("node:fs/promises")
  vi.resetModules()
  delete process.env.PICC_ERROR_LOG
  delete process.env.PICC_E2E_RUN_ID
  // WS-7 slice A: the two store variables are owned by the shared vitest
  // isolation setup. An earlier version of this comment said the setup
  // "restores them before the next test", which was not true as written: the
  // setup RE-POINTS a deleted variable at the harness value, it does not
  // restore the value this test had chosen. The corrected statement is that
  // this teardown leaves the variables untouched, and the setup re-establishes
  // them from its own contract on the next `beforeEach` - so a leftover value
  // here cannot leak into the next test either way.
  rmSync(dir, { recursive: true, force: true })
  rmSync(dirname(logFile), { recursive: true, force: true })
})

describe("WS-6 T10 instrumentation — /api/auth/me records its answer", () => {
  // REPLACED (WS-7 slice B). This used to read "is completely silent when
  // PICC_ERROR_LOG is not 1", which asserted round 4's gate — and round 4's gate
  // is the defect: the e2e harness pins PICC_ERROR_LOG to "0", so that contract
  // guaranteed the trace could never fire in a real e2e run. Keeping the test
  // would have kept the defect asserted. The two tests below assert the contract
  // that replaced it, and server/__tests__/authMeTraceHarnessReach.test.mjs
  // proves reachability from the env the harness actually builds.
  //
  // One nuance worth stating: these tests still assert silence when
  // errorLogEnabled() is false, because the MASTER log must stay silent. What
  // changed is that the /me trace is no longer a subordinate of that switch.
  it("never writes a line the MASTER log owns into the log file when PICC_ERROR_LOG is not 1", async () => {
    const res = await call("GET", "/api/auth/me", { headers: { authorization: "Bearer nope" } })
    expect(res.status).toBe(401)

    // The /me trace shares this file with the master log (it is the same
    // PICC_ERROR_LOG_FILE every harness already redirects), so "the master log is
    // off" is NOT "the file is empty". It is: every line in the file is the /me
    // trace, and nothing the master log would have written on its own — no
    // `type: "session"` launch header, no console.error mirror — is there.
    const raw = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
    const written = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l))
    expect(written.length).toBeGreaterThan(0)
    expect(
      written.filter((entry) => entry.src !== "auth-me"),
      `the master log is off, so no line it owns may be written: ${JSON.stringify(written.filter((e) => e.src !== "auth-me"))}`
    ).toEqual([])
  })

  it("records the rejected branch, and the master log can stay off while it does", async () => {
    // PICC_ERROR_LOG is left DELETED here on purpose. The /me trace must not need
    // the master switch — that was round 4's structural mistake.
    const res = await call("GET", "/api/auth/me", { headers: { authorization: "Bearer nope" } })
    expect(res.status).toBe(401)

    const lines = authMeLines()
    expect(lines, "the /me trace must fire with the master error log OFF").toHaveLength(1)
    expect(lines[0].branch).toBe("rejected")
    expect(lines[0].run).toBe("run-t10-fixture")
    // hadToken is a diagnostic; the token itself must never reach a log file.
    expect(lines[0]).not.toHaveProperty("token")
    expect(lines[0]).not.toHaveProperty("authorization")
  })

  it("records the confirmed branch, and never the user payload, on a 200", async () => {
    const created = await auth.createAccount(CRED)
    expect(created.user).toBeTruthy()
    authMeLines()
    writeFileSync(logFile, "") // discard the signup-time noise

    const res = await call("GET", "/api/auth/me", { headers: { authorization: `Bearer ${created.token}` } })
    expect(res.status).toBe(200)

    const lines = authMeLines()
    expect(lines).toHaveLength(1)
    expect(lines[0].branch).toBe("confirmed")
    // It records THAT the user was confirmed, not who they are or their address.
    expect(lines[0]).not.toHaveProperty("email")
    expect(lines[0]).not.toHaveProperty("user")
  })

  it("records the store-fault branch with 503, so a fault is never mistaken for a rejection", async () => {
    // The session has to be REAL for this to reach the users store at all: with a
    // token that is not in sessions.json the answer is a plain 401 and the users
    // file is never opened. So sign up first, then corrupt only users.json.
    const created = await auth.createAccount(CRED)
    expect(created.token).toBeTruthy()
    writeFileSync(logFile, "")

    // A users store that cannot be parsed is an INCONCLUSIVE answer. Telling it
    // apart from a rejection afterwards is the entire point of this line.
    writeFileSync(join(dir, "users.json"), "{ this is not json")

    const res = await call("GET", "/api/auth/me", { headers: { authorization: `Bearer ${created.token}` } })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe("auth store unavailable")

    const lines = authMeLines()
    expect(lines).toHaveLength(1)
    expect(lines[0].branch).toBe("store-fault")
  })
})

describe("WS-6 T10 instrumentation — write failures are counted and surfaced", () => {
  it("writes only into the temp store, never the real server/data store", async () => {
    // Regression guard for a mistake actually made while writing THIS suite: the
    // env var was spelled PICC_AUTH_STORE_DIR instead of the PICC_AUTH_DATA_DIR that
    // auth.mjs reads, so createAccount() appended a test account to the developer's
    // real server/data/users.json. Nothing failed — the suite passed while polluting
    // live data. This makes that failure mode impossible to reintroduce silently.
    const created = await auth.createAccount(CRED)
    expect(created.user).toBeTruthy()
    expect(readFileSync(join(dir, "users.json"), "utf8")).toContain("user@picc.test")

    const realStore = fileURLToPath(new URL("../data/users.json", import.meta.url))
    const real = existsSync(realStore) ? readFileSync(realStore, "utf8") : ""
    expect(real).not.toContain("user@picc.test")
  })

  it("counts a refused persist and reports it through /api/auth/status", async () => {
    // A healthy store first, so the account exists...
    const created = await auth.createAccount(CRED)
    expect(created.user).toBeTruthy()
    expect(auth.storeWriteFailures()).toEqual({})

    // ...then the disk starts refusing, so the next session write cannot land.
    RENAME_FAILS = true
    const login = await auth.loginAccount(CRED)
    // The typed code, not the prose: the human message differs per store, the code
    // is what the HTTP layer branches on.
    expect(login.code).toBe("auth_store_unavailable")
    expect(login.token).toBeUndefined()

    const counter = auth.storeWriteFailures()
    expect(Object.values(counter).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)

    const res = await call("GET", "/api/auth/status")
    expect(res.status).toBe(200)
    expect(res.body.storeWriteFailures).toBeTruthy()
    expect(Object.values(res.body.storeWriteFailures).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  it("reports no write failures on a healthy store, so a non-zero count means something", async () => {
    // Without a refused persist this must be zero; otherwise the counter above is
    // noise that would read as a problem in every run.
    RENAME_FAILS = false
    await auth.createAccount(CRED)
    const res = await call("GET", "/api/auth/status")
    expect(res.status).toBe(200)
    expect(res.body.storeWriteFailures).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// WS-7 slice B — READ faults counted separately from WRITE faults.
//
// WHY THE SPLIT. Round 4 shipped ONE counter, and the review found the reason it
// could not settle anything: a read or shape fault returns from
// `readSessionsStrict`/`readUsersStrict` BEFORE `writeJSON` is ever called, so
// the counter reads 0 — and a read/shape fault is precisely the mode this
// machine's own sessions.json was in. "0 eliminates the write-fault mechanism"
// is true. "0 means the store was healthy" is not, and the report's phrasing
// implied the latter. The discriminator a single failing run needs is:
//
//     write > 0                  -> the write-fault mechanism
//     read  > 0 and write === 0  -> the read/shape-fault mechanism
//     both === 0                 -> the store was healthy; look elsewhere
//
// A single counter cannot express the middle line, so there is now no way to
// read it that implies it.
// ---------------------------------------------------------------------------
describe("WS-7 slice B — read faults and write faults are counted apart", () => {
  it("counts a WRITE fault and leaves the read counter empty", async () => {
    await auth.createAccount(CRED)
    expect(auth.storeReadFaults(), "a healthy store has read nothing wrong").toEqual({})

    RENAME_FAILS = true
    const login = await auth.loginAccount(CRED)
    expect(login.code).toBe("auth_store_unavailable")

    const res = await call("GET", "/api/auth/status")
    expect(res.status).toBe(200)
    expect(
      total(res.body.storeWriteFailures),
      "the disk refused to persist, so the write counter must be non-zero"
    ).toBeGreaterThan(0)
    expect(
      res.body.storeReadFaults,
      "every read in this test succeeded; a non-zero read count here would mean the two counters " +
        "are not actually independent, and the discriminator above would collapse into round 4's"
    ).toEqual({})
  })

  it("counts a READ/SHAPE fault and leaves the write counter empty — the case round 4 read as 0 = healthy", async () => {
    // The exact confusion this split exists to prevent: a store that cannot be
    // PARSED never reaches writeJSON, so under round 4's single counter a
    // corrupt store and a healthy store were indistinguishable.
    const created = await auth.createAccount(CRED)
    expect(created.token).toBeTruthy()
    expect(auth.storeWriteFailures()).toEqual({})

    // Readable, valid JSON, wrong shape: `{"users": null}`. Not a write fault.
    // The fault has to be provoked through a path that READS STRICTLY — a
    // `/api/auth/status` alone would not, because that route is a signup hint
    // and reads through the lenient listUsers() by design. The recorded symptom
    // is a /me, so that is what this uses.
    writeFileSync(join(dir, "users.json"), JSON.stringify({ users: null }), "utf8")

    const me = await call("GET", "/api/auth/me", { headers: { authorization: `Bearer ${created.token}` } })
    expect(me.status, "a wrong-shaped store is inconclusive, never a 401 about the token").toBe(503)

    const res = await call("GET", "/api/auth/status")
    expect(res.status).toBe(200)
    expect(total(res.body.storeReadFaults), "a wrong-shaped store is a read fault").toBeGreaterThan(0)
    expect(
      res.body.storeWriteFailures,
      "nothing was written, so the write counter must be empty — this is the line that was silently " +
        "reported as 'healthy' before"
    ).toEqual({})
    expect(
      Object.keys(res.body.storeReadFaults),
      "the fault was in users.json, so that is the file that must be named"
    ).toContain("users.json")
  })

  it("is silent on a healthy store, so BOTH zeros mean the store was fine", async () => {
    // The control that gives "both zero" its meaning. Without it, a broken
    // counter that never increments would read as the healthiest possible run.
    RENAME_FAILS = false
    const created = await auth.createAccount(CRED)
    expect(created.token).toBeTruthy()
    // A real /me, so the session store is read on the happy path too.
    const me = await call("GET", "/api/auth/me", { headers: { authorization: `Bearer ${created.token}` } })
    expect(me.status).toBe(200)

    const res = await call("GET", "/api/auth/status")
    expect(res.status).toBe(200)
    expect(res.body.storeWriteFailures).toEqual({})
    expect(res.body.storeReadFaults).toEqual({})
  })

  it("keys both counters on the FILE NAME, so the HTTP body cannot disclose a filesystem path", async () => {
    // `handlers.mjs` returns this object from an UNAUTHENTICATED route. Keyed on
    // the absolute path it carried the developer's home directory, the OS user
    // name and the data layout to any anonymous caller. It is empty on a healthy
    // store, so the practical severity was low — but it is a NEW field on a
    // PUBLIC endpoint, and the fix is one call to `basename`.
    const created = await auth.createAccount(CRED)
    expect(created.token).toBeTruthy()
    RENAME_FAILS = true
    await auth.loginAccount(CRED).catch(() => null)

    const res = await call("GET", "/api/auth/status")
    const body = JSON.stringify(res.body)
    expect(Object.keys(res.body.storeWriteFailures).length, "the write counter must be non-empty to be worth inspecting").toBeGreaterThan(0)
    expect(
      body,
      `the counter is served unauthenticated and must not carry a filesystem path: ${body}`
    ).not.toMatch(/[A-Za-z]:\\/)
    expect(body).not.toContain(dir)
    for (const key of Object.keys(res.body.storeWriteFailures)) {
      expect(key, "a counter key must be a bare file name").toBe(key.split(/[\\/]/).pop())
    }
    for (const key of Object.keys(res.body.storeReadFaults)) {
      expect(key, "a counter key must be a bare file name").toBe(key.split(/[\\/]/).pop())
    }
  })
})

describe("WS-6 T10 instrumentation — the client says WHY it signed out", () => {
  // The sign-out line is the only thing that separates the candidate mechanisms,
  // and it separates them by elapsed time. These tests pin that the line exists
  // and carries the fields — but NOT that the elapsed number is correct.
  //
  // THEY USED TO. The round-4 version asserted
  //   /elapsedMs:[\s\S]{0,80}performance\.now\(\) - startedAt/
  // which is a claim about the SOURCE TEXT, not about behaviour, and it stayed
  // green against code whose `startedAt` was a mount-time `useRef` that nothing
  // ever reset. A source regex cannot detect the defect it claims to guard: the
  // expression is present, and the expression is not the problem — the value it
  // is subtracted from is. The elapsed claim is now asserted BEHAVIOURALLY, in
  // src/hooks/__tests__/useAuth.signOutTrace.test.tsx, by driving the hook
  // through a real inconclusive chain, a recovery, and a 401, and checking that
  // the number is measured from the recovery rather than from mount.
  it("calls the trace on both sign-out branches, and carries no token", async () => {
    const src = readFileSync(new URL("../../src/hooks/useAuth.ts", import.meta.url), "utf8")

    expect(src).toContain('traceSignOut("rejected"')
    expect(src).toContain('traceSignOut("inconclusive-exhausted"')

    // The pass number is the retry driver, so it belongs on the line.
    expect(src).toContain("inconclusivePass: inconclusive")

    // console.debug is the cheapest thing that still reaches a run's devtools, and
    // it is silent unless devtools are open.
    expect(src).toContain('console.debug("[auth] sign-out"')

    // No token and no session payload may reach this diagnostic.
    const trace = src.slice(src.indexOf("function traceSignOut"), src.indexOf("export function useAuth"))
    expect(trace).not.toMatch(/token/)
    expect(trace).not.toMatch(/setStoredSession/)
  })
})
