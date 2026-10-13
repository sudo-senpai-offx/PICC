// W3-05 Task 5 — GET /api/premortem/overview: the advisory readout route.
//
// THE ROUTE IS A READOUT AND NOTHING ELSE. It reads the catalog, reads the guard
// inventory, evaluates claims, and runs the mutation tier. It flips no permit,
// writes no store, and grants no ceremony path. `graduationApi.test.mjs` is the
// pattern: hermetic through the shared store-isolation helper, a fresh
// `handlers` import per test, and no `process.env` assignment by hand.
//
// WHY THIS FILE EXISTS ALONGER THAN "THE ROUTE ANSWERS 401". Spec section 5
// makes the route the task that owns the REAL `runGuard`: `mutate.mjs` is
// forbidden from running anything, so until a caller supplies a runner that
// breaks an implementation and runs the real guard, the mutation tier can only
// ever return its two pessimisms. The tests below are what discharge that, and
// they are deliberately behavioural: they read the ROUTE'S OWN payload, so a
// fixture inside a test could not satisfy them without anything ever executing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const OVERVIEW = "/api/premortem/overview"

/**
 * The route really checks out a worktree and runs two vitest suites in it, so
 * one call costs seconds rather than milliseconds. The default 5s timeout would
 * fail every assertion below for a reason that has nothing to do with what they
 * assert, and a timeout that reads as a behavioural failure is worse than no
 * timeout at all.
 */
const ROUTE_TIMEOUT = 300_000

/** A bearer token whose value is irrelevant to the assertions below. */
const TOKEN = "d".repeat(64)

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    // DELIBERATELY NO `socket` (graduationApi precedent): requireAuth admits a
    // loopback peer outright, so omitting it presents a non-loopback caller.
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
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

async function call(api, method, path, body, headers) {
  const res = makeRes()
  await api(makeReq(method, path, body, headers), res, path)
  return res
}

describe("pre-mortem API (W3-05 Task 5) — overview route", () => {
  let authDir

  beforeEach(() => {
    authDir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    rmSync(authDir, { recursive: true, force: true })
  })

  /** An AUTHENTICATED, non-loopback caller: a user AND a session carrying the token. */
  async function authed() {
    writeFileSync(
      join(authDir, "users.json"),
      JSON.stringify({ users: [{ id: "u1", email: "pre@example.test", password: "x", salt: "y" }] })
    )
    writeFileSync(
      join(authDir, "sessions.json"),
      JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } } })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?premortem-api-authed")
    return { api: handleApi, headers: { authorization: `Bearer ${TOKEN}` } }
  }

  async function overview() {
    const { api, headers } = await authed()
    return call(api, "GET", OVERVIEW, undefined, headers)
  }

  it("GET overview refuses an anonymous caller with 401", async () => {
    const { handleApi } = await import("../handlers.mjs?premortem-api-anon")
    const res = await call(handleApi, "GET", OVERVIEW)
    expect(res.status).toBe(401)
  })

  it(
    "reports catalogFindings before results, and both channels are present",
    async () => {
      const res = await overview()
      expect(res.status).toBe(200)
      const keys = Object.keys(res.body)
      // BOTH CHANNELS, not one. `auditCatalog` deliberately takes no inventory,
      // so it structurally CANNOT see a claim that resolves to nothing; the
      // `stale-catalog-entry` VERDICT in `results` reports those. A renderer that
      // reads only `catalogFindings` misses them, so the payload carries both.
      expect(keys).toEqual(expect.arrayContaining(["catalogFindings", "results", "mutation"]))
      expect(keys.indexOf("catalogFindings")).toBeLessThan(keys.indexOf("results"))
      expect(Array.isArray(res.body.catalogFindings)).toBe(true)
      expect(Array.isArray(res.body.results)).toBe(true)
      expect(Array.isArray(res.body.mutation)).toBe(true)
    },
    ROUTE_TIMEOUT
  )

  it(
    "never emits a verdict outside the vocabulary, on either channel",
    async () => {
      const { VERDICTS } = await import("../services/premortem/verify.mjs")
      const res = await overview()
      for (const r of res.body.results) expect(VERDICTS).toContain(r.verdict)
      // The audit channel reports exactly one verdict of its own.
      for (const f of res.body.catalogFindings) expect(f.verdict).toBe("stale-catalog-entry")
    },
    ROUTE_TIMEOUT
  )

  it(
    "an unrun mutation is reported not-run, and no bites row is unbacked",
    async () => {
      const res = await overview()
      const notRun = res.body.mutation.filter((m) => m.verdict === "not-run")
      // "not-run" IS the encoding of "did not run" - there is no separate ran flag to drift.
      expect(notRun.length).toBeGreaterThan(0)

      // A `bites` row is legitimate, so it must not be forbidden; it must be BACKED.
      // The invariant that survives is: no bites row is unbacked.
      const bites = res.body.mutation.filter((m) => m.verdict === "bites")
      expect(
        bites.every(
          (m) =>
            m.evidence?.failed === true &&
            typeof m.evidence?.claimPath === "string" &&
            m.evidence.claimPath.length > 0
        )
      ).toBe(true)
    },
    ROUTE_TIMEOUT
  )

  it(
    "the real runner is wired: a mutation entry reports a MEASURED verdict, not a default",
    async () => {
      // THE SPEC SECTION 5 OBLIGATION, and the reason this route task exists.
      // Without a real `runGuard` every `mutation: true` entry honestly reports
      // `not-run` and the tier can only ever return its two pessimisms. This
      // asserts the route really RAN the guards rather than that it merely
      // called `mutationCheck`.
      const res = await overview()
      const measured = res.body.mutation.filter((m) => m.verdict === "bites" || m.verdict === "does-not-bite")
      expect(
        measured.length,
        "no mutation entry was measured, so the route supplied no working runGuard"
      ).toBeGreaterThan(0)

      // Every measured row names the guard it ran and the reason it reached that
      // verdict — an unrun row can never carry either of these two reasons.
      for (const m of measured) {
        expect(m.evidence.reason).toBe(
          m.verdict === "bites" ? "guard-failed-on-broken-implementation" : "guard-passed-on-broken-implementation"
        )
        expect(m.evidence.claimPath).toMatch(/\.test\.mjs$/)
      }
    },
    ROUTE_TIMEOUT
  )

  it(
    "demonstrates BOTH directions: the tier catches a guard that cannot see its defect",
    async () => {
      // Spec section 5 asks for one entry reporting `bites` AND one reporting
      // `does-not-bite`. The `does-not-bite` row is the damning one — it means the
      // guard ran against a genuinely broken implementation and stayed green, which
      // is the only evidence a guard is not a guard. A tier that could only ever
      // emit `bites` would be reporting its runner, not the guard.
      const res = await overview()
      const bites = res.body.mutation.filter((m) => m.verdict === "bites")
      const damning = res.body.mutation.filter((m) => m.verdict === "does-not-bite")
      expect(bites.length, "no entry reported bites").toBeGreaterThan(0)
      expect(damning.length, "no entry reported does-not-bite").toBeGreaterThan(0)
      // AND the damning verdict is not free: it is a real guard file, run for real.
      for (const m of damning) expect(m.evidence.claimPath).toMatch(/\.test\.mjs$/)
      // The two directions are DISTINCT GUARDS, not one guard reported two ways.
      const bitingPaths = new Set(bites.map((m) => m.evidence.claimPath))
      for (const m of damning) expect(bitingPaths.has(m.evidence.claimPath)).toBe(false)
    },
    ROUTE_TIMEOUT
  )

  it(
    "cannot mark or close anything: the payload carries no write surface",
    async () => {
      const res = await overview()
      expect(res.body.advisory).toBe(true)
      // A readout that names a permit, an unlock or a credential is not a readout.
      for (const banned of ["permit", "unlock", "credential", "secret", "token"]) {
        expect(banned in res.body, `the payload must not carry a "${banned}" field`).toBe(false)
      }
    },
    ROUTE_TIMEOUT
  )

  it("requireAuthStrict is the FIRST statement in the route block", async () => {
    const { readFile } = await import("node:fs/promises")
    const src = await readFile(new URL("../handlers.mjs", import.meta.url), "utf8")
    const start = src.indexOf('path === "/api/premortem/overview"')
    expect(start, "the premortem route must exist").toBeGreaterThan(-1)
    const block = src.slice(start)
    const body = block.slice(block.indexOf("{") + 1)
    expect(body.trimStart().startsWith("if (!(await requireAuthStrict(req, res))) return")).toBe(true)
  })

  it("keeps the route's own source honest: no static import of any premortem module", async () => {
    // `ws7AuthBootstrapGateGuard` pins the static-import count of handlers.mjs, so
    // a static import here would MOVE that pin rather than fail it. Asserted on
    // the comment-stripped view via the ONE shared lexer, so a `premortem/`
    // written inside a comment cannot pass this.
    const { readFile } = await import("node:fs/promises")
    const { stripComments } = await import("../scripts/guard-primitives.mjs")
    const code = stripComments(await readFile(new URL("../handlers.mjs", import.meta.url), "utf8"))
    const head = code.slice(0, code.indexOf("export async function handleApi"))
    expect(head).not.toContain("premortem/")
  })
})