// WS-6 T10 INSTRUMENTATION (round 4) — the terminal-performance flake is UNROOTED.
//
// Rounds 1, 2 and 3 each proposed a mechanism; round 2's was disproven and rounds 1
// and 3 are mis-specified on the observable (on the inconclusive path the app
// RENDERS with the retained session, so `[data-room='markets']` is satisfied in
// about a second and a 30s selector timeout does not match it). No fourth mechanism
// is proposed here. These tests pin the three observation points that let ONE
// failing run NAME a mechanism:
//
//   1. /api/auth/me writes one `src: "auth-me"` line per answer, carrying the branch
//      that produced it plus the e2e run id.
//   2. Every writeJSON() failure is counted per file, and /api/auth/status surfaces
//      that count, so a run in which the disk refused to persist is distinguishable
//      from a healthy one after the fact.
//   3. The client logs a sign-out line carrying the reason, the inconclusive pass
//      number, and the elapsed time of the whole chain — which is the one number
//      that separates a 401 at ~0.4s from six inconclusive answers at ~23s.
//
// The properties asserted alongside them are deliberate: instrumentation that leaks
// a token, writes to a log nobody enabled, or pollutes the real store is worse than
// no instrumentation. The last of those is not hypothetical — an earlier draft of
// THIS file misspelled PICC_AUTH_DATA_DIR, and the suite went green while silently
// appending a test account to the developer's real server/data/users.json. The
// "writes only into the temp store" test below exists because of that.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "picc-ws7-t10-"))
  logFile = join(dir, "picc-errors.log")
  process.env.PICC_AUTH_DATA_DIR = dir
  process.env.PICC_ERROR_LOG_FILE = logFile
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
  delete process.env.PICC_ERROR_LOG_FILE
  delete process.env.PICC_E2E_RUN_ID
  delete process.env.PICC_AUTH_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe("WS-6 T10 instrumentation — /api/auth/me records its answer", () => {
  it("is completely silent when PICC_ERROR_LOG is not 1", async () => {
    const res = await call("GET", "/api/auth/me", { headers: { authorization: "Bearer nope" } })
    expect(res.status).toBe(401)
    expect(authMeLines()).toEqual([])
    expect(existsSync(logFile)).toBe(false)
  })

  it("records the rejected branch with the run id when a 401 is answered", async () => {
    process.env.PICC_ERROR_LOG = "1"
    const res = await call("GET", "/api/auth/me", { headers: { authorization: "Bearer nope" } })
    expect(res.status).toBe(401)

    const lines = authMeLines()
    expect(lines).toHaveLength(1)
    expect(lines[0].branch).toBe("rejected")
    expect(lines[0].run).toBe("run-t10-fixture")
    // hadToken is a diagnostic; the token itself must never reach a log file.
    expect(lines[0]).not.toHaveProperty("token")
    expect(lines[0]).not.toHaveProperty("authorization")
  })

  it("records the confirmed branch, and never the user payload, on a 200", async () => {
    process.env.PICC_ERROR_LOG = "1"
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
    process.env.PICC_ERROR_LOG = "1"
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

describe("WS-6 T10 instrumentation — the client says WHY it signed out", () => {
  // The sign-out line is the only thing that separates the two candidate
  // mechanisms, and it separates them by elapsed time: ~0.4s means a 401 destroyed
  // a held session; ~23000ms means six inconclusive answers in a row. These tests
  // pin that the line exists and carries those fields. They deliberately do NOT
  // assert which mechanism occurred, because that is exactly what is unknown.
  it("logs both sign-out branches with the pass number and elapsed time, and no token", async () => {
    const src = readFileSync(new URL("../../src/hooks/useAuth.ts", import.meta.url), "utf8")

    expect(src).toContain('traceSignOut("rejected"')
    expect(src).toContain('traceSignOut("inconclusive-exhausted"')

    // Elapsed is measured from the start of the chain, not the last leg, because
    // the backoff schedule is what the number has to be read against.
    expect(src).toMatch(/elapsedMs:[\s\S]{0,80}performance\.now\(\) - startedAt/)

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
