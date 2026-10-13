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
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { stripComments } from "../scripts/guard-primitives.mjs"
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

  it("resolves the REPOSITORY root, not a directory inside it", () => {
    // ── THE BUG THIS FILE WAS MISSING ──────────────────────────────────────
    //
    // The route read the tree through `new URL("../../", import.meta.url)`.
    // `import.meta.url` is `…/PICC/apps/dashboard/server/handlers.mjs`, so the
    // BASE is `…/PICC/apps/dashboard/server/` and TWO levels up is `…/PICC/apps/`
    // — not the repository. Measured on this tree, with the exact arguments the
    // route builds:
    //
    //   git ls-files at apps/    ->   923 files
    //   git ls-files at PICC/    ->  1150 files   (227 invisible)
    //
    // and the payload that produced, with nothing invented:
    //
    //   catalogFindings: 12 findings, every one `subsystem-not-found`
    //   counts: guard-missing 5, verified 0, partially-covered 0
    //
    // where the correct root gives catalogFindings `[]` and verified 2,
    // partially-covered 3, guard-missing 0. Every one of those twelve findings
    // named a subsystem that exists, and all five `guard-missing` verdicts named
    // guards that exist — the spec defines `guard-missing` as "the claim names a
    // guard that does not exist". So the readout fabricated its own verdict
    // about whether the guard inventory could be trusted.
    //
    // ASSERTED AS A PROPERTY, NOT AS A LITERAL. The route's specifier is read
    // out of its own source and resolved exactly as the route resolves it; the
    // result must be a git top level. Spelling `"../../../"` here would be
    // SHIP-2 in miniature — a hand-written list that silently stops matching —
    // so this compares against what git itself reports, and moving the file
    // would not break it.
    const handlersUrl = pathToFileURL(fileURLToPath(new URL("../handlers.mjs", import.meta.url)))
    const code = stripComments(readFileSync(handlersUrl, "utf8"))
    const route = code.slice(code.indexOf('path === "/api/premortem/overview"'))
    const found = route.match(/fileURLToPath\(new URL\("([^"]+)", import\.meta\.url\)\)/)
    expect(found, "the premortem route must resolve a root through its own import.meta.url").not.toBeNull()
    const resolved = fileURLToPath(new URL(found[1], handlersUrl))

    expect(
      existsSync(join(resolved, ".git")),
      `the route resolves ${resolved}, which is not a git top level, so it reads a subtree as the repository`
    ).toBe(true)
    const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: resolved,
      encoding: "utf8"
    }).trim()
    // `fileURLToPath` of a directory URL keeps a trailing separator and git's
    // `--show-toplevel` does not, so both sides are normalised before comparing.
    const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "")
    expect(norm(resolved)).toBe(norm(toplevel))
  })

  it(
    "reads the WHOLE tree: the audit is empty and the covered verdicts are the ones reported",
    async () => {
      // ── WHY EACH LINE IS HERE, AND WHICH ONE WOULD HAVE CAUGHT IT ─────────
      //
      // Every assertion the SHIPPED tests made was satisfiable by the broken
      // payload, which is why nine green tests shipped a readout that reported
      // twelve false catalog defects and five false `guard-missing` verdicts.
      // The assertions below are new; of the five, four go red under the broken
      // payload. The fifth — a non-empty `results` — cannot, and is labelled as
      // a vacuity guard rather than a catch, because under the wrong root the
      // route still evaluated all twelve claims; only the VERDICTS were wrong.
      // Concretely, of the old tests:
      //
      //   - the old vocabulary test looped `for (const r of res.body.results)`
      //     with no non-emptiness guard, so an EMPTY array satisfied it;
      //   - the old audit test asserted every `catalogFindings` entry IS
      //     `stale-catalog-entry`, which twelve false `subsystem-not-found`
      //     findings satisfy perfectly — the assertion ratified the defect;
      //   - the old shape test checked presence, array-ness and ORDER, and
      //     nothing about content.
      //
      // 1. `results` NON-EMPTY. A readout that evaluated no claim at all is not
      //    a readout, and an empty array makes every other loop in this file
      //    vacuous without failing anything.
      const res = await overview()
      expect(res.status).toBe(200)
      expect(res.body.results.length, "the route evaluated no catalog claim").toBeGreaterThan(0)

      // 2. `catalogFindings` EMPTY, and the emptiness is the finding. The shipped
      //    catalog is unsound-free: every `subsystem` it names is a directory a
      //    tracked file really lives in, and every entry carries a disposition.
      //    So an empty self-audit is the EXPECTED state against the real tree.
      //    A non-empty one here means the root resolution has gone wrong again —
      //    every finding that channel can emit is a claim about the repository
      //    having moved underneath it, and none of them is true.
      expect(res.body.catalogFindings).toEqual([])

      // 3. NO `subsystem-not-found`, named separately rather than left to the
      //    emptiness above, because it is the single reason that produced all
      //    twelve false findings and a reader debugging this needs it by name.
      const stale = res.body.catalogFindings.filter(
        (f) => f.evidence?.reason === "subsystem-not-found"
      )
      expect(
        stale.map((f) => `${f.id}:${f.evidence.subsystem}`),
        "the route could not find subsystems that exist, so its repoRoot is not the repository"
      ).toEqual([])

      // 4. THE COVERED VERDICTS ARE PRESENT. These are the two verdicts only a
      //    correctly-resolved root can produce, because a root one level too
      //    high hides the guard files and turns them into `guard-missing`. So
      //    their ABSENCE is the detector: no need to assert `guard-missing` is 0,
      //    which would only go red if a claim is genuinely lost.
      expect(
        res.body.results.some((r) => r.verdict === "verified"),
        "no claim reached `verified`, which is what a root that cannot see the guard files produces"
      ).toBe(true)
      expect(
        res.body.results.some((r) => r.verdict === "partially-covered"),
        "no claim reached `partially-covered`, which is what a root that cannot see the guard files produces"
      ).toBe(true)
    },
    ROUTE_TIMEOUT
  )

  it(
    "never emits a verdict outside the vocabulary, on either channel",
    async () => {
      const { VERDICTS } = await import("../services/premortem/verify.mjs")
      const res = await overview()
      // NON-VACUITY IS PINNED ELSEWHERE, AND SAYING SO IS THE POINT. The loop
      // below is over `results`, whose non-emptiness the "reads the WHOLE tree"
      // test asserts outright — so it cannot silently pass over an empty array
      // any more. The `catalogFindings` loop is a DIFFERENT case: against a
      // correct root that array is empty, so this loop executes zero times and
      // is vacuous HERE BY CONSTRUCTION. It is kept because the property still
      // has to hold the day the catalog does go stale, and its non-vacuous pin
      // is `preMortemVerify.test.mjs` ("the audit reports a malformed mode even
      // when its subsystem is perfectly well known"), which drives `auditCatalog`
      // with a deliberately-defective mode and asserts the verdict directly.
      // Nothing about the audit channel is asserted only here.
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
    "the payload's shape is closed, and it names no permit, unlock or credential",
    async () => {
      // THE NAME SAYS WHAT THE ASSERTION DOES, which the previous one did not.
      // It was called "the payload carries no write surface" while asserting
      // that five KEY NAMES were absent — and a route that wrote to a store
      // without exposing a key called `permit` would have passed it. So:
      //
      // WHAT IS ASSERTED, and is now a closed contract rather than five
      // absences: the payload's key set is EXACTLY the documented six. A write
      // surface has to appear as a key to reach a caller at all, so a closed key
      // set is what makes "there is nowhere for one to hide" true rather than
      // merely unenumerated. Adding a field to this payload now requires a
      // decision here, which is the point.
      //
      // WHAT IS NOT ASSERTED, stated plainly so no reader infers it: this does
      // NOT establish that the route performs no state mutation. It constrains
      // the SHAPE of what comes back. Establishing the stronger claim needs a
      // scan of the route's own body for write primitives, which needs a
      // hand-rolled brace counter to bound the block — and a counter that
      // truncates silently would make the scan vacuous, which is the defect
      // class this whole feature exists to catch. The weaker, honest claim is
      // the one made.
      const res = await overview()
      expect(res.body.advisory).toBe(true)
      expect(Object.keys(res.body).sort()).toEqual(
        ["advisory", "catalogFindings", "counts", "mutation", "ok", "results"].sort()
      )
      // A readout that names a permit, an unlock or a credential is not a
      // readout. Kept alongside the closed set: it names the intent the set
      // cannot express, and it would catch a banned key even if the set above
      // were widened without thought.
      for (const banned of ["permit", "unlock", "credential", "secret", "token"]) {
        expect(banned in res.body, `the payload must not carry a "${banned}" field`).toBe(false)
      }
    },
    ROUTE_TIMEOUT
  )

  it("requireAuthStrict is the FIRST statement in the route block", () => {
    // ANCHORED ON THE COMMENT-STRIPPED VIEW. It used to run `indexOf` on the raw
    // source, so the moment `path === "/api/premortem/overview"` appeared in an
    // EARLIER COMMENT — and this file's own header banner above the route quotes
    // it — the test would have anchored on the comment and measured whatever
    // followed it. This file already imports the one shared lexer for its other
    // source scan; applying it here too is what makes the anchor the route.
    const src = stripComments(readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8"))
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
    // The lexer arrives by a STATIC import, at the top of this file, and that is
    // a requirement rather than a style preference: this file is registered in
    // `sharedCommentLexer.test.mjs`'s `VITEST_CONSUMERS`, and that guard's
    // resolution half matches a static `from` specifier and requires exactly one
    // match. A consumer reached through `await import(...)` reads as ZERO
    // references to it, so registering this file while spelling the import
    // dynamically would fail the very guard it was registered to satisfy.
    //
    // AND THE SPECIFIER IS DELIBERATELY NOT REPEATED IN THIS COMMENT. That
    // guard's regex runs over raw source without stripping comments, so
    // paraphrasing the pattern here — quoting it, even as prose — adds a second
    // match and the registration fails on its own explanation. That is the same
    // comment-blindness this repo's lexers were written to defeat, caught by
    // writing it the fourth time.
    const code = stripComments(readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8"))
    const head = code.slice(0, code.indexOf("export async function handleApi"))
    expect(head).not.toContain("premortem/")
  })

  it(
    "concurrent IDENTICAL requests are BOUNDED to one measurement (final fix round)",
    async () => {
      // ── THE AVAILABILITY DEFECT, PINNED END TO END ─────────────────────────
      //
      // The runner already memoised per guard file WITHIN one sandbox, so the
      // tier did no redundant work per request. Nothing bounded ACROSS callers,
      // and that was the expensive half: one measurement is a full repository
      // checkout plus a vitest run per claimed guard, measured at 1,150 tracked
      // files and 13.6 MB per sandbox and 10.7 s per single request.
      //
      // Before the fix, three simultaneous authenticated callers each built their
      // own worktree. After it, they share one in-flight memo entry keyed by guard
      // file + repo HEAD — so the wave registers at most ONE extra worktree.
      //
      // WHY THE WORKTREE COUNT AND NOT A DURATION. A wall-clock assertion would
      // pass on a fast host and fail on a slow one for a reason that has nothing
      // to do with what is asserted; the registered-worktree count is the thing
      // that is actually being bounded, and it is machine-independent. The
      // sampler polls `git worktree list` while the wave runs and the assertion is
      // that it never rose by more than one above the pre-wave count.
      const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))
      const countWorktrees = () =>
        execFileSync("git", ["worktree", "list"], { cwd: repoRoot, encoding: "utf8" })
          .split(/\r?\n/)
          .filter(Boolean).length

      const before = countWorktrees()
      let peak = before
      const sampler = setInterval(() => {
        try {
          peak = Math.max(peak, countWorktrees())
        } catch {
          /* a failed poll must not fail the test; the final read still applies */
        }
      }, 300)
      try {
        const [a, b, c] = await Promise.all([overview(), overview(), overview()])
        for (const res of [a, b, c]) expect(res.status).toBe(200)
        // ALL THREE ANSWERED. A bound that served one caller and left the others
        // hanging would be a denial of service wearing a fix's name.
        expect(a.body.results.length).toBeGreaterThan(0)
        // AND they agree: sharing a measurement must not mean the callers disagree
        // about it.
        expect(JSON.stringify(b.body.mutation)).toBe(JSON.stringify(a.body.mutation))
        expect(JSON.stringify(c.body.counts)).toBe(JSON.stringify(a.body.counts))
      } finally {
        clearInterval(sampler)
      }
      expect(
        peak,
        `three concurrent callers registered ${peak - before} worktrees; the route builds one per caller`
      ).toBeLessThanOrEqual(before + 1)
      // AND NOTHING WAS LEAKED. A shared sandbox that outlives its wave is the
      // failure the containment envelope exists to prevent.
      expect(countWorktrees()).toBe(before)
    },
    ROUTE_TIMEOUT
  )
})