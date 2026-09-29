// WS-7 slice B — THE ANTI-ROT TEST for the WS-6 T10 /api/auth/me branch trace.
//
// WHY THIS FILE EXISTS, IN ONE SENTENCE. Round 4's instrumentation could not
// fire: `traceAuthMe` was gated on `PICC_ERROR_LOG === "1"`, the e2e harness sets
// `PICC_ERROR_LOG = "0"`, and a must-reject guard in `command-centre-order-flow.spec.ts`
// pins exactly that — so every test round 4 wrote stayed green while the thing it
// guarded was unreachable in the only environment that would ever need it.
//
// A guard that can only fail if you already know the answer is not a guard. This
// file is the opposite: it builds THE ENVIRONMENT THE E2E HARNESS BUILDS — by
// importing the harness itself, not by re-describing it — boots the real
// `handlers.mjs` under it, calls the real `/api/auth/me`, and asserts that an
// `src: "auth-me"` line was actually written. It is red today.
//
// The three ways this can go red, each of which is a real regression:
//   1. `PICC_E2E_RUN_ID` is dropped from `REQUIRED_ISOLATION_VARIABLES`, so the
//      harness stops supplying a run marker and the writer is unarmed.
//   2. the writer's gate is re-pointed at `errorLogEnabled()` again, so a
//      harness-shaped env (which pins `PICC_ERROR_LOG` to "0") goes silent.
//   3. `PICC_ERROR_LOG_FILE` stops being a required isolation variable, so the
//      destination is no longer guaranteed to be inside the run's own scratch.
//
// WHY IT IMPORTS `e2e/helpers/isolatedEnv.mjs` RATHER THAN LISTING THE VARIABLES.
// A hand-written copy of the harness env is a second description of it, and a
// second description is what drifts: the copy would keep passing after the real
// harness stopped setting the variable this test is supposed to depend on. That
// is the exact rot this file exists to prevent, so the copy is not made.
//
// THE ENV IS RESTORED IN afterEach. `testSupport/vitestStoreIsolation.setup.mjs`
// ends a test FILE by asserting that every `*_DATA_DIR`/`*_FILE` variable still
// points inside the vitest run root or the OS temp dir. The harness env points
// inside `apps/dashboard/.playwright-tmp/<hash>/`, which is neither, so leaving
// it applied would trip that teardown for a reason that has nothing to do with
// this test. Restoring is the honest fix, and it is why the teardown below is
// exhaustive over `REQUIRED_ISOLATION_VARIABLES` rather than over the handful of
// names this test happens to read.

import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"
// WS-7 slice B fix round 1: the harness is imported through the shared helper rather
// than directly, because importing it at all mints a `.playwright-tmp/<hash>/` tree at
// module scope and the helper is what removes it again. Same import, no leak.
import { harnessEnv as harness, REQUIRED_ISOLATION_VARIABLES } from "../../testSupport/isoHarnessEnv.mjs"

const RUN_MARKER = "PICC_E2E_RUN_ID"

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
    removeAllListeners() {
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
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    statusCode: null,
    body: null,
    setHeader() {},
    getHeader() {},
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
      const text = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(String(c))))).toString("utf8")
      try {
        this.body = text ? JSON.parse(text) : null
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

async function callMe(handleApi, headers) {
  const req = makeReq("GET", "/api/auth/me", { headers })
  const res = makeRes()
  await handleApi(req, res, "/api/auth/me")
  return res
}

/** The `src: "auth-me"` lines in the harness's own log file, in order. */
function harnessAuthMeLines(logFile) {
  if (!existsSync(logFile)) return []
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line)
        return parsed && parsed.src === "auth-me" ? [parsed] : []
      } catch {
        return []
      }
    })
}

let handleApi
let restore
let logFile

beforeEach(async () => {
  // The auth store has to exist and be empty, and it has to be a scratch
  // directory: this test calls the real /api/auth/me, which reads it. The
  // redirect goes through the shared contract so a misspelled name is refused
  // rather than silently falling back to the developer's real server/data.
  useIsolatedStoreDir("PICC_AUTH_DATA_DIR", { prefix: "picc-ws7-t10-trace" })
  logFile = useIsolatedStoreDir("PICC_ERROR_LOG_FILE", { prefix: "picc-ws7-t10-trace-log" })

  // ── APPLY THE HARNESS ENV, VERBATIM ────────────────────────────────────────
  // Snapshot first: the vitest setup owns the values this overwrites, and its
  // teardown checks them, so the test has to be a good citizen.
  const previous = new Map()
  for (const name of REQUIRED_ISOLATION_VARIABLES) {
    previous.set(name, Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined)
  }
  restore = () => {
    for (const name of REQUIRED_ISOLATION_VARIABLES) {
      const value = previous.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  for (const [name, value] of Object.entries(harness)) process.env[name] = value

  // The harness auth store is SHARED by every test in this file (one harness
  // env per module load), and one of these tests deliberately corrupts
  // users.json. Only the two named files are removed, by name and WITHOUT
  // recursion: the whole point of applying the harness env verbatim is to stop
  // inventing a store layout, and a recursive delete under a directory this
  // process did not create is exactly the operation that follows a link.
  for (const name of ["users.json", "sessions.json"]) {
    rmSync(join(harness.PICC_AUTH_DATA_DIR, name), { force: true })
  }
  // The harness's own error-log file is the trace destination, and it is inside
  // the harness run root, so nothing written below can reach the repository.
  rmSync(harness.PICC_ERROR_LOG_FILE, { force: true })

  vi.resetModules()
  handleApi = (await import("../handlers.mjs")).handleApi
})

afterEach(() => {
  restore?.()
  restore = undefined
  rmSync(harness.PICC_ERROR_LOG_FILE, { force: true })
  vi.doUnmock("node:fs/promises")
  vi.resetModules()
})

describe("WS-6 T10 anti-rot: the /me trace is REACHABLE from a harness-shaped env", () => {
  it("supplies a run marker, so a failing e2e run's lines can be isolated from a noisy log", () => {
    // The first thing round 4 got wrong: `run` was `null` in every compliant e2e
    // run because the marker was not a required isolation variable, so the
    // harness never set it and the trace could not be attributed to a run.
    expect(
      REQUIRED_ISOLATION_VARIABLES,
      `${RUN_MARKER} must be a REQUIRED isolation variable, or the e2e harness never sets it and ` +
        "every /me trace is written with run:null - unattributable in exactly the situation it exists for"
    ).toContain(RUN_MARKER)
    expect(
      typeof harness[RUN_MARKER],
      "the harness must build a non-empty run marker; the shared-session cache in e2e/sharedAuth.ts " +
        "also uses it as a run scope, so an empty value would collapse that cache too"
    ).toBe("string")
    expect(harness[RUN_MARKER].length).toBeGreaterThan(0)
  })

  it("keeps the master error log OFF — the trace must not have cost the must-reject pin", () => {
    // `e2e/command-centre-order-flow.spec.ts:34` pins `PICC_ERROR_LOG: "1"` as a
    // must-reject escape. If this test only passed because that pin had been
    // relaxed, the instrumentation would be buying reachability with a security
    // control. It must pass with the pin intact.
    expect(harness.PICC_ERROR_LOG).toBe("0")
    expect(REQUIRED_ISOLATION_VARIABLES).toContain("PICC_ERROR_LOG")
  })

  it("WRITES an auth-me line for a real /me answer under the harness env, with the master log off", async () => {
    const res = await callMe(handleApi, { authorization: "Bearer not-a-real-token" })
    expect(res.status, "the token is unknown, so the honest answer is 401").toBe(401)

    const lines = harnessAuthMeLines(harness.PICC_ERROR_LOG_FILE)
    expect(
      lines,
      "a /me answered under the EXACT env the e2e harness builds produced no auth-me line. This is " +
        "round 4's failure mode, reproduced: the instrumentation exists, the tests are green, and the " +
        "one environment that would ever need it cannot reach it."
    ).toHaveLength(1)
    expect(lines[0].branch).toBe("rejected")
    expect(lines[0].run).toBe(harness[RUN_MARKER])
  })

  it("records WHICH branch answered, so one failing run names the mechanism", async () => {
    // Three branches, one question: did /me destroy a session (401), keep it
    // (503 store fault), or confirm it (200)? Rounds 1-3 each guessed; this is
    // the line that settles it. The 503 half is exercised here because it is
    // the branch that is hardest to reach and the one the store-fault counter
    // must agree with.
    const auth = await import("../services/auth.mjs")
    const created = await auth.createAccount({ email: "trace@picc.test", password: "trace-password-9" })
    expect(created.token).toBeTruthy()

    // A users store that cannot be parsed is INCONCLUSIVE, not a rejection.
    const { writeFileSync } = await import("node:fs")
    writeFileSync(join(harness.PICC_AUTH_DATA_DIR, "users.json"), "{ not json", "utf8")
    rmSync(harness.PICC_ERROR_LOG_FILE, { force: true })

    const res = await callMe(handleApi, { authorization: `Bearer ${created.token}` })
    expect(res.status, "a store fault is not a claim about the token, so it must not be 401").toBe(503)

    const lines = harnessAuthMeLines(harness.PICC_ERROR_LOG_FILE)
    expect(lines).toHaveLength(1)
    expect(lines[0].branch).toBe("store-fault")
  })

  it("is INERT outside a harness-shaped env, so a dev box or a production boot writes nothing", async () => {
    // The anti-rot property must not be bought by making the trace universal.
    // With no run marker the writer is unarmed: there is no way for this to
    // become a new always-on log at the repository root.
    delete process.env[RUN_MARKER]
    rmSync(harness.PICC_ERROR_LOG_FILE, { force: true })

    const res = await callMe(handleApi, { authorization: "Bearer not-a-real-token" })
    expect(res.status).toBe(401)
    expect(existsSync(harness.PICC_ERROR_LOG_FILE)).toBe(false)
  })

  it("the store-fault branch carries NO filesystem path in its reason", async () => {
    // The one branch that WASN'T covered by a shape assertion. The other three carry
    // a boolean or a user id; this one carries `err.message`, and
    // `AuthStoreUnavailable` interpolates the store's absolute path into that message
    // (auth.mjs). So this is the one line where a Windows path, a user name and the
    // data layout reach a file.
    //
    // NOT attacker-reachable: the destination is `PICC_ERROR_LOG_FILE`, already
    // redirected inside the run's own scratch, and `writeAuthMeTrace` is armed only
    // by PICC_E2E_RUN_ID, which nothing but the e2e harness sets. It is still a
    // disclosure to fix, and the fix belongs at the WRITER rather than at this one
    // call site — `unhandled` forwards an arbitrary `err.message` through the same
    // door, and so would any future field.
    const auth = await import("../services/auth.mjs")
    const created = await auth.createAccount({ email: "reason@picc.test", password: "reason-password-9" })
    expect(created.token).toBeTruthy()
    const { writeFileSync } = await import("node:fs")
    writeFileSync(join(harness.PICC_AUTH_DATA_DIR, "users.json"), "{ not json", "utf8")
    rmSync(harness.PICC_ERROR_LOG_FILE, { force: true })

    const res = await callMe(handleApi, { authorization: `Bearer ${created.token}` })
    expect(res.status, "a store fault is inconclusive, not a 401").toBe(503)

    const lines = harnessAuthMeLines(harness.PICC_ERROR_LOG_FILE)
    expect(lines).toHaveLength(1)
    expect(lines[0].branch).toBe("store-fault")
    // The diagnosis must survive: the file name and the shape verdict are the whole
    // value of the line, so the redaction has to keep them.
    expect(lines[0].reason, "the reason must still name the file and the fault").toContain("users.json")
    expect(lines[0].reason, "the reason must still say it was a parse failure").toMatch(/parse failed/i)
    expect(
      lines[0].reason,
      `the reason must not carry a filesystem path: ${lines[0].reason}`
    ).not.toMatch(/[A-Za-z]:\\/)
    expect(
      JSON.stringify(lines),
      "no field on any branch may carry a filesystem path"
    ).not.toMatch(/[A-Za-z]:\\/)
  })

  it("leaks no credential: no token, no authorization header, no user payload", async () => {
    const auth = await import("../services/auth.mjs")
    const created = await auth.createAccount({ email: "leak@picc.test", password: "leak-password-9" })
    expect(created.token).toBeTruthy()
    rmSync(harness.PICC_ERROR_LOG_FILE, { force: true })

    const res = await callMe(handleApi, { authorization: `Bearer ${created.token}` })
    expect(res.status).toBe(200)

    expect(
      existsSync(harness.PICC_ERROR_LOG_FILE),
      "a confirmed /me under the harness env wrote no trace at all, so there is nothing to inspect"
    ).toBe(true)
    const raw = readFileSync(harness.PICC_ERROR_LOG_FILE, "utf8")
    expect(raw, "a bearer token in a diagnostic log is a credential leak").not.toContain(created.token)
    expect(raw, "the confirmed branch must record THAT a user was confirmed, not who").not.toContain("leak@picc.test")
    // The path the trace lands in is the harness's own scratch path. It must not
    // reach the real store, and it must not carry the account id into the log
    // alongside the branch name.
    const lines = harnessAuthMeLines(harness.PICC_ERROR_LOG_FILE)
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toHaveProperty("token")
    expect(lines[0]).not.toHaveProperty("authorization")
    expect(lines[0]).not.toHaveProperty("user")
    expect(lines[0]).not.toHaveProperty("email")
  })

  it("a store-fault line carries the store counters, because they are gone once the run ends", async () => {
    // The counters are process-scoped and memory-only. An operator told to GET
    // /api/auth/status after the run is reading a FRESH process's zeros, and would
    // conclude "the store was healthy" from a counter that was never set. Carrying
    // them on the line is what makes that conclusion obtainable at all.
    const auth = await import("../services/auth.mjs")
    const created = await auth.createAccount({ email: "counters@picc.test", password: "counters-password-9" })
    expect(created.token).toBeTruthy()
    const { writeFileSync } = await import("node:fs")
    writeFileSync(join(harness.PICC_AUTH_DATA_DIR, "users.json"), "{ not json", "utf8")
    rmSync(harness.PICC_ERROR_LOG_FILE, { force: true })

    const res = await callMe(handleApi, { authorization: `Bearer ${created.token}` })
    expect(res.status).toBe(503)

    const line = harnessAuthMeLines(harness.PICC_ERROR_LOG_FILE)[0]
    expect(line.storeWriteFailures, "the write counter must be on the line, even when empty").toEqual({})
    expect(
      Object.values(line.storeReadFaults ?? {}).reduce((a, b) => a + b, 0),
      "the read fault that just happened must be on the line — this is the whole discriminator"
    ).toBeGreaterThan(0)
  })

  it("the redactor strips an absolute path without mangling ordinary text", async () => {
    // The properties an earlier, broader draft of this scrubber broke. A diagnostic
    // that corrupts its own text is its own disclosure bug, so these are pinned
    // rather than assumed: a lookbehind on the POSIX branch is the only reason
    // `and/or` and `http://host/x` survive.
    const { redactAbsolutePaths } = await import("../errorLog.mjs")

    expect(redactAbsolutePaths("auth store parse failed (C:\\Users\\sharv\\app\\auth\\users.json): bad")).toBe(
      "auth store parse failed (users.json): bad"
    )
    expect(redactAbsolutePaths("read failed (\\\\host\\share\\sessions.json)")).toBe("read failed (sessions.json)")
    expect(redactAbsolutePaths("read failed (/var/folders/ab/picc-store/sessions.json)")).toBe("read failed (sessions.json)")
    // The non-mangling half.
    expect(redactAbsolutePaths("expected and/or got a string")).toBe("expected and/or got a string")
    expect(redactAbsolutePaths("see http://localhost:5173/api/auth/me")).toBe("see http://localhost:5173/api/auth/me")
    expect(redactAbsolutePaths("users.json and sessions.json")).toBe("users.json and sessions.json")
  })

  it("the redactor's KNOWN LOSSY cases are pinned, and none of them discloses anything", async () => {
    // FIX ROUND 2 MINOR. Three further inputs were checked and none was pinned, so
    // the scrubber's behaviour on them was undocumented. Two of the three mangle the
    // text. That is a real loss — a `?next=` target or a `../` prefix carries diagnostic
    // value — and it is pinned HERE so it is a known, reviewed property rather than
    // something a reader discovers by accident.
    //
    // WHAT I DELIBERATELY DID NOT DO. The obvious response is to loosen the regex so
    // these survive. That regex is the thing standing between an `err.message` and a
    // `C:\Users\<name>\...` in a log, and the two lookbehinds that keep `http://host/x`
    // intact exist precisely because loosening it previously broke that. Making the
    // scrubber lossless on query strings and relative paths is a real change with a
    // disclosure risk, so it is left for a separate decision with its own redactor
    // suite rather than smuggled into an instrumentation round.
    //
    // The safety property is what actually matters and it is asserted for every case:
    // whatever the scrubber does to the text, no absolute path survives it.
    const { redactAbsolutePaths } = await import("../errorLog.mjs")

    const KNOWN_LOSSY = [
      // A query-string target: the POSIX branch eats the path after the second slash.
      { input: "auth bounced to ?next=/suites/trading/markets", current: "auth bounced to ?next=markets" },
      // A bare-scheme URL with no host: the first slash is left, the rest is a "path".
      { input: "//host/api/auth/me refused", current: "me refused" },
      // A relative path: leading dots and the separator are absorbed.
      { input: "read failed (../store/users.json)", current: "read failed (..users.json)" }
    ]

    for (const { input, current } of KNOWN_LOSSY) {
      const out = redactAbsolutePaths(input)
      expect(out, `behaviour changed for a pinned lossy case: ${input}`).toBe(current)
      // The property that must hold whatever the mangling: nothing that names a real
      // filesystem location or a user directory comes out.
      expect(out, `a pinned lossy case must still not disclose an absolute path: ${out}`).not.toMatch(
        /[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|var|etc)/
      )
    }

    // The clean cases, pinned in the same place so the two groups read together.
    const CLEAN = [
      "connect ECONNREFUSED 127.0.0.1:5173",
      "port 5173 already in use",
      "data:application/json,{\"a\":1}",
      "malformed: ((((",
      "",
      "a/b and c/d are not absolute"
    ]
    for (const input of CLEAN) {
      expect(redactAbsolutePaths(input), `a clean case must be untouched: ${input}`).toBe(input)
    }
  })
})
