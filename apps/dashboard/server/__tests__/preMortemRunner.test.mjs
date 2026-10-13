// W3-05 Task 5 — the mutation RUNNER's decision logic.
//
// WHY THESE TESTS EXIST RATHER THAN A SANDBOX TEST. `preMortemApi.test.mjs`
// proves the runner really runs guards, and it pays for that with a worktree
// checkout and two vitest runs per call. What it cannot cheaply prove is the
// branch that decides whether a measurement EXISTS — and that is the branch with
// the worst failure direction in the whole feature.
//
// THE FAILURE DIRECTION, STATED FIRST. A runner handed a mutation whose anchor
// has moved does not break anything, then runs an UNBROKEN guard, sees green,
// and reports `does-not-bite`. That is a FALSE DAMNING finding: it accuses a
// guard of blindness that was never shown a broken implementation. It is the one
// outcome this feature must never manufacture, so the refusal is pinned here
// behaviourally rather than described in a comment.
//
// NO SANDBOX IS CREATED BY THIS FILE. Every case is decided from a stub `dir`,
// so the suite stays hermetic and fast; the real execution is covered by
// `preMortemApi.test.mjs`.

import { describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MUTATIONS,
  REPO_ROOT,
  applyLineMutation,
  createGuardRunner,
  createInFlightMemo,
  createSandbox,
  isInsideRepoRoot,
  measurementKey,
  mutationFor,
  readMeasurement,
  repoHead,
  withSandbox
} from "../services/premortem/runner.mjs"

const GUARD_A = "apps/dashboard/server/__tests__/graduationGates.test.mjs"
const GUARD_B = "apps/dashboard/server/__tests__/sharedCommentLexer.test.mjs"

/** A sandbox stand-in: counts its own construction, and disposes for real. */
function fakeSandboxFactory(built) {
  return async () => {
    built.count += 1
    return {
      dir: "unused-by-this-fixture",
      async dispose() {
        built.disposed += 1
      }
    }
  }
}

/** Long enough that three `Promise.all` callers really do overlap. */
const HOLD_MS = 30
const hold = () => new Promise((r) => setTimeout(r, HOLD_MS))

/**
 * The two real checkouts below need more than vitest's 5 s default, and finding
 * that out cost a whole-suite run.
 *
 * Each `createSandbox` checks out 1,150 tracked files and each `dispose` removes
 * the worktree and prunes, so this test does four real git operations. Measured at
 * 3,032 ms in isolation — close enough to the 5 s default that a whole-suite run
 * under parallel load timed it out, and it failed as a TIMEOUT rather than as an
 * assertion, which is the flakiest possible shape. 120 s is the same figure
 * `preMortemApi.test.mjs` uses for a route call that does one of these.
 */
const SANDBOX_TIMEOUT = 120_000

describe("the pre-mortem mutation runner (W3-05 Task 5)", () => {
  it("REFUSES to build a sandbox inside the repository", async () => {
    // ── THE PROPERTY NO TEST PINNED, LEARNED THE HARD WAY ──────────────────
    //
    // `createSandbox` derives its directory from `mkdtempSync(join(tmpdir(), …))`,
    // and its own comment calls OUTSIDE the repository "load-bearing rather than
    // tidiness". Nothing asserted it. `tmpdir()` honours `TEMP`, so on Windows —
    // where `TEMP` is consulted FIRST, ahead of `TMPDIR` (measured: setting
    // `TEMP` and then `TMPDIR` still returns the `TEMP` value) — anyone whose
    // `TEMP` points into the repo, or anyone "tidying up" `tmpdir()` to a
    // repo-local directory, silently moves every removal path in this feature
    // onto a blast radius shared with the working tree.
    //
    // All three variables are stubbed, so the test does not depend on which one
    // this platform consults first.
    //
    // WHY IT MATTERS ENOUGH TO REFUSE RATHER THAN WARN. The junction footgun
    // documented in `unlinkQuietly` follows an ABANDONED directory: a sandbox
    // left inside the repo, holding a link to the repository's own
    // `node_modules`, is exactly the object a human sweeping build leftovers
    // with `Remove-Item -Recurse` would destroy the install through.
    //
    // The refusal happens BEFORE `git worktree add`, so a rejected call
    // registers no worktree and leaves nothing behind — which this test also
    // asserts, rather than trusting it.
    const inside = join(REPO_ROOT, "apps", "dashboard", "testSupport", ".tmp-in-repo")
    mkdirSync(inside, { recursive: true })
    let created = null
    try {
      for (const key of ["TEMP", "TMP", "TMPDIR"]) vi.stubEnv(key, inside)
      const attempt = createSandbox()
      // Captured before the assertion so the RED path — where the call SUCCEEDS —
      // can still tear the worktree it just made down instead of leaking it.
      attempt.then((s) => {
        created = s
      }, () => {})
      await expect(attempt, `createSandbox accepted ${inside} as a sandbox location`).rejects.toThrow(
        /sandbox-inside-repository/
      )
      expect(created, "a rejected call must not hand back a sandbox").toBeNull()
      // NOTHING LEFT BEHIND: no worktree directory, so the refusal is not merely
      // an error after the fact.
      expect(readdirSync(inside), "the refused call left a directory in the repository").toEqual([])
    } finally {
      if (created) await created.dispose()
      vi.unstubAllEnvs()
      rmSync(inside, { recursive: true, force: true })
    }
  })

  it("the temp area it builds sandboxes in is outside the repository", () => {
    // THE OTHER HALF, and it is the half that goes red on a CHANGED ENVIRONMENT
    // rather than on a changed runner. The refusal test above proves the runner
    // reacts; this proves the premise still holds today. `tmpdir()` is read at
    // the moment of the call, so a machine or CI image whose `TEMP` points into
    // the checkout turns this red — which is the only moment anyone can act.
    expect(isInsideRepoRoot(tmpdir())).toBe(false)
    expect(
      isInsideRepoRoot(REPO_ROOT),
      "the repository must contain itself, or the check above is meaningless"
    ).toBe(true)
  })

  it("the containment predicate is right in BOTH directions", () => {
    // WHY THIS IS A PURE-FUNCTION TEST AND NOT A SANDBOX TEST. Dropping the
    // `..`-escape clause from `isInsideRepoRoot` makes it fail CLOSED — every
    // sandbox location reads as inside the repository, so `createSandbox` throws
    // for every caller and the mutation tier goes quiet. Measured: that deletion
    // left all 14 tests in this file GREEN. The API suite does catch it, but only
    // as a 502 ninety seconds later and for a reason that does not name the
    // cause, so the branch was effectively unpinned. `readMeasurement` was
    // extracted and exported for the same reason; this is the same move.
    expect(isInsideRepoRoot(REPO_ROOT), "the repository contains itself").toBe(true)
    expect(isInsideRepoRoot(join(REPO_ROOT, "apps", "dashboard")), "a child is inside").toBe(true)
    expect(isInsideRepoRoot(tmpdir()), "the temp area is outside").toBe(false)
    // THE PREFIX SIBLING, which is the whole reason this is not a `startsWith`.
    // `…/PICC-archive` shares a string prefix with `…/PICC` and is outside it.
    // A path-prefix implementation would refuse a legitimate temp location, and
    // again the only symptom would be a silent, total refusal.
    //
    // `REPO_ROOT` arrives from `fileURLToPath` with a TRAILING SEPARATOR, so the
    // `-archive` suffix is appended after stripping it — otherwise the fixture
    // is `…/PICC/-archive`, which is genuinely inside the repository and would be
    // testing nothing.
    const sibling = `${REPO_ROOT.replace(/[\\/]+$/, "")}-archive`
    expect(isInsideRepoRoot(sibling), "a sibling sharing a string prefix is NOT inside the repository").toBe(
      false
    )
  })

  it("every registered mutation names a guard-shaped file and a real target", () => {
    // A table that drifts is catalog entry SHIP-2 in miniature, and the mutation
    // anchors below are checked against the REAL files in a later test rather
    // than against this array, so a renamed target cannot pass by being renamed
    // here too.
    expect(MUTATIONS.length).toBeGreaterThan(0)
    for (const m of MUTATIONS) {
      expect(m.guard).toMatch(/__tests__\/.+\.test\.mjs$/)
      expect(m.target).toMatch(/\.(mjs|cjs|js|ts|tsx)$/)
      expect(m.target).not.toContain("__tests__")
      expect(typeof m.needle).toBe("string")
      expect(m.needle.length).toBeGreaterThan(0)
    }
    // ONE MUTATION PER GUARD FILE, or two entries would race over one file.
    expect(new Set(MUTATIONS.map((m) => m.guard)).size).toBe(MUTATIONS.length)
  })

  it("every registered anchor still matches exactly one line of the REAL file", async () => {
    // THE TABLE CANNOT DRIFT INTO VACUITY. If an implementation is refactored
    // past its anchor, `applyLineMutation` starts refusing, every `mutation: true`
    // entry silently falls back to `not-run`, and the tier goes quiet — a
    // failure that reads as "nothing to report" rather than as a broken runner.
    // This asserts against the working tree, so it goes RED when the anchor
    // moves, which is the only moment anyone can act on it.
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const { join } = await import("node:path")
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))
    for (const m of MUTATIONS) {
      const text = await readFile(join(repoRoot, m.target), "utf8")
      const out = applyLineMutation(text, m.needle, m.replacement)
      expect(out.ok, `${m.target} anchor "${m.needle}" no longer matches exactly one line (${out.matches ?? 0})`).toBe(true)
    }
  })

  it("mutationFor matches the WHOLE path, so a same-named file elsewhere cannot claim it", () => {
    expect(mutationFor(GUARD_A)).not.toBeNull()
    // A partial match would let `some/other/graduationGates.test.mjs` inherit a
    // mutation written for a different file.
    expect(mutationFor("some/other/graduationGates.test.mjs")).toBeNull()
    expect(mutationFor("graduationGates.test.mjs")).toBeNull()
    expect(mutationFor("")).toBeNull()
    expect(mutationFor(null)).toBeNull()
  })

  it("REFUSES a mutation whose anchor has moved, rather than reporting the green it then sees", async () => {
    // THE FALSE-DAMMING GUARD, asserted end to end through `createGuardRunner`.
    // An unregistered guard must yield NO measurement. Were it to yield
    // `{failed: false}`, `mutate.mjs` would report `does-not-bite` — a damning
    // finding manufactured out of a runner that never broke anything.
    const runGuard = createGuardRunner({ sandbox: { dir: "unused" } })
    await expect(runGuard("apps/dashboard/server/__tests__/notRegistered.test.mjs")).resolves.toBeUndefined()
  })

  it("applyLineMutation replaces the line and preserves the line count and indentation", () => {
    const text = ["export const a = 1", "  qualifying += 1", "export const b = 2"].join("\n")
    const out = applyLineMutation(text, "qualifying += 1", "qualifying += 0")
    expect(out.ok).toBe(true)
    expect(out.text.split("\n")).toHaveLength(3)
    expect(out.text).toContain("  qualifying += 0")
    expect(out.text).not.toContain("qualifying += 1")
    // The neighbours are untouched — a mutation that reformatted the file would
    // make every diff-based reading of the sandbox misleading.
    expect(out.text.startsWith("export const a = 1")).toBe(true)
    expect(out.text.endsWith("export const b = 2")).toBe(true)
  })

  it("applyLineMutation refuses an AMBIGUOUS anchor, which would mutate the wrong site", () => {
    const text = ["  x += 1", "  x += 1", "  y += 1"].join("\n")
    const out = applyLineMutation(text, "x += 1", "x += 0")
    expect(out.ok).toBe(false)
    expect(out.reason).toBe("mutation-anchor-not-unique")
    expect(out.matches).toBe(2)
  })

  it("applyLineMutation refuses an absent anchor and names the reason", () => {
    const out = applyLineMutation(["  a = 1"].join("\n"), "notInThisFile", "x")
    expect(out.ok).toBe(false)
    expect(out.reason).toBe("mutation-anchor-not-found")
    expect(out.matches).toBe(0)
  })

  it("an array replacement adds lines and keeps them all indented like the original", () => {
    const text = ["const list = [", '  "a"', "]"].join("\n")
    const out = applyLineMutation(text, '"a"', ['"a",', '"b"'])
    expect(out.ok).toBe(true)
    expect(out.text.split("\n")).toHaveLength(4)
    expect(out.text).toContain('  "a",')
    expect(out.text).toContain('  "b"')
  })

  it("a guard that collected ZERO tests is NOT a guard that passed", () => {
    // THE BRANCH THAT WAS UNPINNED. This decision was inlined until a mutation
    // check deleted the zero-test guard and left this whole file green. It is
    // extracted and tested here because reaching it through a sandbox needs a
    // guard that asserts nothing — which is exactly the defect, and exactly what
    // cannot be arranged in the catalog.
    expect(readMeasurement({ numTotalTests: 0, numFailedTests: 0 })).toBeUndefined()
    expect(readMeasurement({ numTotalTests: 0, numFailedTests: 3 })).toBeUndefined()
  })

  it("a real report yields a real measurement in both directions", () => {
    // The two shapes vitest actually writes, measured: 39 tests / 20 failed on
    // the graduation guard under the `qualifying += 0` mutation, and 39 / 0 with
    // no mutation applied.
    expect(readMeasurement({ numTotalTests: 39, numFailedTests: 20 })).toEqual({ failed: true })
    expect(readMeasurement({ numTotalTests: 39, numFailedTests: 0 })).toEqual({ failed: false })
  })

  it("a report whose counts are not integers measures nothing", () => {
    // `"0"` and `0.5` are not counts. Reading them as one would upgrade a guard's
    // standing on a value vitest never wrote.
    expect(readMeasurement({ numTotalTests: "39", numFailedTests: 0 })).toBeUndefined()
    expect(readMeasurement({ numTotalTests: 39, numFailedTests: null })).toBeUndefined()
    expect(readMeasurement({ numTotalTests: 0.5, numFailedTests: 0 })).toBeUndefined()
    expect(readMeasurement(null)).toBeUndefined()
    expect(readMeasurement("39 tests, 20 failed")).toBeUndefined()
  })

  it("the two registered mutations bite DIFFERENT guards, so the tier's two directions are not one guard", () => {
    // Spec section 5 asks for one `bites` and one `does-not-bite`. If both
    // directions ever came from the same guard file, the tier would be reporting
    // one measurement twice rather than two independent findings.
    expect(mutationFor(GUARD_A)).not.toBeNull()
    expect(mutationFor(GUARD_B)).not.toBeNull()
    expect(mutationFor(GUARD_A).target).not.toBe(mutationFor(GUARD_B).target)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE CONCURRENCY BOUND (final fix round, IMPORTANT 1).
//
// WHAT WAS MEASURED BEFORE THE FIX, through the assembled route, authenticated
// non-loopback caller, 12-core host:
//
//   1 request            : 10,738 ms
//   3 concurrent         : 10,824 ms wall
//   6 concurrent         : 13,943 ms wall
//   peak registered worktrees during the 6-request wave : 8 (2 pre-existing + 6)
//   per-sandbox cost, measured : 1,150 tracked files, 13.6 MB
//
// So on THIS host the wall-clock blow-up is mild - 1.30x for six times the work -
// and the reviewer who measured 586 s at concurrency 3 could not be reproduced
// here. What reproduces exactly, and is what this bound is actually for, is the
// WORK: every concurrent identical request performed its own full checkout and
// its own two vitest runs. Six of them is six 13.6 MB checkouts and twelve vitest
// processes for one answer, and that is independent of how many cores the host
// has. The bound below removes the redundancy rather than hoping contention stays
// mild.
// ─────────────────────────────────────────────────────────────────────────────
describe("the pre-mortem runner's in-flight bound (final fix round)", () => {
  it("concurrent IDENTICAL requests do the work ONCE", async () => {
    // ── THE PROPERTY THE FIX EXISTS TO ESTABLISH ────────────────────────────
    //
    // One authenticated caller — one double-click, one refresh, one browser
    // prefetch — reached this route six times at once and got six full repository
    // checkouts and twelve vitest suites for one answer. The fix is a single
    // in-flight memo keyed by guard file + repo HEAD, so identical concurrent
    // callers share one measurement.
    //
    // `createSandbox` is injected so the count is the thing under test rather
    // than a timing coincidence. This is the same injection seam
    // `guardInventory({ listTrackedFiles, readFile })` already uses, and it is the
    // only reason this test can assert the count instead of inferring it.
    const built = { count: 0, disposed: 0 }
    const create = fakeSandboxFactory(built)
    const results = await Promise.all([
      withSandbox({ run: async () => hold().then(() => "measured"), keys: [GUARD_A, GUARD_B], createSandbox: create }),
      withSandbox({ run: async () => hold().then(() => "measured"), keys: [GUARD_A, GUARD_B], createSandbox: create }),
      withSandbox({ run: async () => hold().then(() => "measured"), keys: [GUARD_A, GUARD_B], createSandbox: create })
    ])
    expect(built.count, "each concurrent caller built its own sandbox").toBe(1)
    // AND every caller still got the answer. A bound that answered one caller
    // and left the others hanging would be a denial of service, not a fix.
    expect(results).toEqual(["measured", "measured", "measured"])
    // AND the one sandbox that was built was torn down. A shared sandbox that
    // outlives its run is the leak the containment envelope exists to prevent.
    expect(built.disposed).toBe(1)
  })

  it("DISTINCT guard files are not shared, so the bound cannot answer a question it was not asked", async () => {
    // The key carries the guard files as well as the HEAD. Two callers measuring
    // different guard files are different measurements, and collapsing them would
    // hand one caller a verdict about a guard it never ran — the false-damming
    // direction this whole module refuses.
    const a = { count: 0, disposed: 0 }
    const b = { count: 0, disposed: 0 }
    await Promise.all([
      withSandbox({ run: async () => hold().then(() => "A"), keys: [GUARD_A], createSandbox: fakeSandboxFactory(a) }),
      withSandbox({ run: async () => hold().then(() => "B"), keys: [GUARD_B], createSandbox: fakeSandboxFactory(b) })
    ])
    expect(a.count).toBe(1)
    expect(b.count).toBe(1)
  })

  it("a settled key is NOT retained: this is an in-flight bound, not a cache", async () => {
    // THE OTHER HALF, and the one that would turn a bound into a lie. A memo
    // that kept its entry would answer every later request from a measurement
    // taken minutes ago, and the route's answer would stop being "measured on
    // this tree" while looking exactly the same. The entry is deleted when the
    // run settles, so a subsequent caller measures again.
    const built = { count: 0, disposed: 0 }
    const create = fakeSandboxFactory(built)
    await withSandbox({ run: async () => "first", keys: [GUARD_A], createSandbox: create })
    await withSandbox({ run: async () => "second", keys: [GUARD_A], createSandbox: create })
    expect(built.count, "a settled measurement was replayed rather than re-measured").toBe(2)
  })

  it("the memo reports WHO started the work, so a caller can tell a join from an owner", async () => {
    const memo = createInFlightMemo()
    const first = memo.run("k", async () => hold().then(() => 1))
    const second = memo.run("k", async () => hold().then(() => 2))
    expect(await first).toEqual({ shared: false, value: 1 })
    expect(await second).toEqual({ shared: true, value: 1 })
  })

  it("the memo shares nothing across DIFFERENT keys", async () => {
    const memo = createInFlightMemo()
    const [a, b] = await Promise.all([memo.run("k1", async () => hold().then(() => 1)), memo.run("k2", async () => 2)])
    expect(a).toEqual({ shared: false, value: 1 })
    expect(b).toEqual({ shared: false, value: 2 })
  })

  it("the key carries BOTH the repo HEAD and the guard files, and is order-independent", () => {
    const head = "a".repeat(40)
    expect(measurementKey({ head, keys: [GUARD_A, GUARD_B] })).toBe(measurementKey({ head, keys: [GUARD_B, GUARD_A] }))
    // The guard-file component must MOVE the key, or two different measurements
    // would share one result.
    expect(measurementKey({ head, keys: [GUARD_A] })).not.toBe(measurementKey({ head, keys: [GUARD_A, GUARD_B] }))
    // And so must the HEAD: a measurement is only valid for the tree it ran
    // against, so a stale HEAD must not be reused. This is the reason the key is
    // keyed on HEAD at all.
    expect(measurementKey({ head, keys: [GUARD_A] })).not.toBe(
      measurementKey({ head: "b".repeat(40), keys: [GUARD_A] })
    )
  })

  it("the key REFUSES a key it cannot build honestly", () => {
    // Loud, not defaulted. A caller that omits `head` or `keys` and is handed a
    // shared key anyway would share measurements across different trees — the
    // stale-measurement failure the HEAD component exists to prevent, arrived at
    // through a missing argument rather than a stale one.
    const head = "a".repeat(40)
    expect(() => measurementKey({ keys: [GUARD_A] })).toThrow(/measurement-key/)
    expect(() => measurementKey({ head: "", keys: [GUARD_A] })).toThrow(/measurement-key/)
    expect(() => measurementKey({ head, keys: [] })).toThrow(/measurement-key/)
    expect(() => measurementKey({ head, keys: [null] })).toThrow(/measurement-key/)
  })

  it("the key really is the repository's HEAD, read from git rather than assumed", async () => {
    // Pinned against git rather than against a literal, so it stays true across
    // commits instead of going stale the day this file stops being edited.
    const expected = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
    expect(await repoHead()).toBe(expected)
  })

  it("concurrent sandbox CREATION is serialised, and nothing leaks (bites: source-checked)", async () => {
    // ── A SOURCE CHECK, ITS LIMIT STATED, AND WHY THE FIRST ATTEMPT WAS WRONG ──
    //
    // `createSandbox` takes a process-wide lock so a dispose's repository-wide
    // `git worktree prune` can never collect a concurrently-created sibling's
    // registration before `git worktree add` has made it visible. Deleting that
    // lock left all 24 tests in this file GREEN.
    //
    // MY FIRST PIN FOR IT WAS WRONG AND IT IS RECORDED HERE. It sampled the
    // registered-worktree count across two concurrent `createSandbox()` calls and
    // asserted it never rose by two. It went red against the lock IN PLACE -
    // `expected 4 to be less than or equal to 3` - and it was the assertion that
    // was wrong, not the lock: serialising the calls bounds how many sandbox
    // OPERATIONS run at once, not how many sandboxes may be ALIVE, and two callers
    // each holding their own live sandbox is correct by design. Chasing that would
    // have meant weakening the lock to satisfy a bad test.
    //
    // WHAT IS PINNED HERE, precisely: `createSandbox` routes through the mutex,
    // and disposal takes the same lock. That is a check on the source, not on
    // behaviour, and the limit is the same one stated for the HEAD read below -
    // this proves the delegation exists, not that the interleaving it prevents
    // would otherwise occur. A BEHAVIOURAL pin needs an instrumented `git`, or an
    // injectable `execFile`, and widening this module's surface for one is a worse
    // trade than recording the gap. Named as the first thing W3-06 should pin.
    const src = readFileSync(new URL("../services/premortem/runner.mjs", import.meta.url), "utf8")
    const create = src.slice(src.indexOf("export function createSandbox()"), src.indexOf("function sandboxMutex"))
    expect(create, "createSandbox must exist").toContain("sandboxMutex(buildSandbox)")
    expect(src, "disposal must take the same lock as creation").toContain("sandboxMutex(dispose)")

    // AND THE PART THAT IS BEHAVIOURAL: two concurrent creations both succeed,
    // land on distinct directories, and leave nothing registered behind.
    const made = []
    let built = []
    try {
      const building = Promise.all([createSandbox(), createSandbox()])
      // Captured as they resolve so the RED path can still tear both down rather
      // than leaking a worktree — the failure this whole file guards against.
      building.then((pair) => made.push(...pair), () => {})
      built = await building
      const [a, b] = built
      expect(a.dir).not.toBe(b.dir)
      expect(isInsideRepoRoot(a.dir), "a sandbox must live outside the repository").toBe(false)
    } finally {
      for (const sandbox of made) await sandbox.dispose()
    }
    // SCOPED TO THE TWO THIS TEST BUILT, and the earlier version of this check was
    // wrong because it was not. It scanned every `git worktree list` line for
    // `premortem-sandbox-`, which couples the assertion to sandboxes some other
    // process leaked — a hard kill on a previous run, say — and fails a test that
    // cleaned up after itself. Asserting on THIS test's own two directories cannot
    // be failed by anything it does not own.
    const listed = execFileSync("git", ["worktree", "list"], { cwd: REPO_ROOT, encoding: "utf8" })
    for (const sandbox of built) {
      expect(listed.includes(sandbox.dir), `a create/dispose pair left ${sandbox.dir} registered`).toBe(false)
    }
  }, SANDBOX_TIMEOUT)

  it("bites: the HEAD READ is shared, so concurrent callers reach the memo together", async () => {
    // ── A SOURCE CHECK, AND ITS LIMIT IS STATED RATHER THAN GLOSSED ──────────
    //
    // This branch has no cheap behavioural pin and the report says so. Three
    // concurrent `repoHead()` calls that were NOT shared would all answer the
    // same HEAD, so an equality assertion cannot tell sharing from three separate
    // git spawns. The only thing that told them apart was the whole suite: the
    // sharing test above passed in isolation and failed under load, because the
    // memo entry is created only after the key is built, and a slow `git
    // rev-parse` let a later caller arrive after the first had already settled and
    // deleted its entry.
    //
    // So the property is pinned against the source rather than against behaviour,
    // with the limit recorded: this proves `repoHead` DELEGATES to a memo, which
    // is what makes the arrival times close enough for the behavioural pin to
    // hold. It does not itself prove the sharing happens. Deleting the delegation
    // is what must turn something red, and this is it.
    //
    // The behavioural half is the sharing test above, and its real check is the
    // whole-suite run — which is exactly how the defect was found, and is why this
    // is written as a source check rather than dressed up as one.
    const src = readFileSync(new URL("../services/premortem/runner.mjs", import.meta.url), "utf8")
    const start = src.indexOf("export async function repoHead()")
    expect(start, "repoHead must exist").toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf("\n}", start))
    expect(body).toMatch(/headReads\.run\(/)
  })
})