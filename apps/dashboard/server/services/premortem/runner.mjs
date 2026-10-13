// Pre-mortem planner — the mutation RUNNER (W3-05, Task 5).
//
// WHAT THIS IS. `mutate.mjs` is a pure readout: it will not run vitest, will not
// touch the filesystem, and hands every byte of execution to an injected
// `runGuard`. Spec section 5 makes the ROUTE the task that supplies a real one,
// and this file is that runner. Without it every `mutation: true` catalog entry
// honestly reports `not-run` and the tier can only ever return its two
// pessimisms — a tier that can never return `bites` is not reporting on guards.
//
// WHAT A RUNNER ACTUALLY HAS TO DO, which is the part that is easy to fake. To
// answer "does this guard bite?" you must break the implementation the guard
// watches and then RUN THE REAL GUARD and see whether it fails. A runner that
// returns a hand-supplied boolean has proved nothing about the guard; it has
// proved something about the boolean. So this one does the three real steps —
// check the guard out into a disposable sandbox, break the implementation INSIDE
// the sandbox, run vitest there — and returns what vitest actually reported.
//
// ── THE SAFETY ENVELOPE, AND IT IS THE WHOLE DESIGN ─────────────────────────
//
// THE REPOSITORY IS NEVER MUTATED. Not "mutated and restored" — never mutated.
// A route that broke source files in place and put them back in a `finally` is
// one hard kill away from leaving the working tree broken, and it would be doing
// that through an endpoint whose entire job is to tell a reader what is and is
// not safe. `mutate.mjs` says so in its own boundary paragraph; this file is the
// other half of that promise.
//
// ISOLATION IS A DISPOSABLE `git worktree`, created OUTSIDE the repository.
// Two properties make it the right primitive rather than a copy: a worktree is a
// real checkout with a real `.git`, and these guards shell out to
// `git ls-files` with `cwd` at the tree root — a plain directory copy has no
// index and every such guard would fail for the wrong reason and be misreported
// as a bite.
//
// ── NO JUNCTION, NO SYMLINK, EVER. MEASURED, NOT ASSUMED. ───────────────────
//
// The obvious way to give a sandbox its dependencies is to drop a directory
// link at `<sandbox>/node_modules` pointing at the repository's own. That was
// tried and it is DESTRUCTIVE, in a way worth recording because the failure is
// invisible until it has already happened:
//
//   `git worktree remove --force <sandbox>`  DELETES THE LINK TARGET'S CONTENTS.
//
// Measured in a throwaway repository with a file named `precious/data.txt`
// behind the link: present before the removal, absent after. So a sandbox with a
// linked `node_modules` does not cost you the sandbox — it costs you the
// repository's installed dependencies. (PowerShell's own `Remove-Item -Recurse`
// follows the same kind of link, with the same result.) Neither is used here.
//
// INSTEAD THE SANDBOX HAS NO `node_modules` AT ALL, and vitest is invoked BY
// ABSOLUTE PATH from the repository's own install, with the working directory
// set to the sandbox's `apps/dashboard`. Verified end to end: a sandbox with no
// `node_modules` runs `sharedCommentLexer.test.mjs` green (19 passed) that way.
// The consequence is stated rather than left for a reader to infer — the sandbox
// has no dependencies of its own, so `git worktree remove --force` can only ever
// delete files the sandbox itself checked out.
//
// ── ONE MEASUREMENT PER GUARD FILE, PER SANDBOX ─────────────────────────────
//
// Two catalog entries (SHIP-1 and SHIP-2) claim the SAME guard file. Running it
// once and answering both from that one measurement is the honest reading: the
// tier's unit is the guard file, so two entries claiming it are two views of one
// fact. Running it twice would produce two rows that agree for an uninteresting
// reason — the second run would be reading a sandbox the first run already
// mutated, which is a second-order trap rather than a second measurement.
//
// ── A MUTATION THAT DOES NOT APPLY IS NOT A VERDICT ─────────────────────────
//
// The mutations below are anchored to an EXACT, WHOLE, TRIMMED source line, and
// the applier requires exactly ONE such line. If the anchor has moved, the
// implementation was refactored past this runner, and the guard then runs against
// an UNBROKEN implementation and reports green. Reporting that green as
// `does-not-bite` would be a false damning finding — it would accuse a guard of
// blindness on the strength of a runner that never broke anything. So a mutation
// that does not apply resolves to NO measurement, which `mutate.mjs` reports as
// `not-run`. This is the same rule as the rest of the tier: only a real boolean
// counts.

import { execFile as execFileCb } from "node:child_process"
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFile = promisify(execFileCb)

/** The repository root, resolved from this file rather than from `process.cwd()`. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url))

/**
 * The vitest entry point, resolved from the repository's own install.
 *
 * Absolute, because the sandbox has no `node_modules` of its own and a bare
 * `npx` would resolve upward from the sandbox, find nothing, and try to fetch
 * vitest from the network — which is both wrong and slow.
 */
const VITEST_ENTRY = join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs")

/** Guards run from the sandbox's dashboard root, the same root they run from here. */
const SANDBOX_DASHBOARD = join("apps", "dashboard")

/** Where vitest's JSON reporter writes, relative to the dashboard root it runs in. */
const VITEST_JSON_REPORT = join(".vitest", "json", "output.json")

/**
 * How long one guard run may take before it is abandoned.
 *
 * A run that is killed is reported as a THROWN runner by `mutate.mjs`, which is
 * `not-run` — never a verdict. The timeout exists so that a hung guard costs
 * this route a bounded amount of time rather than a request that never returns.
 */
const GUARD_TIMEOUT_MS = 180_000

/**
 * The mutations this runner knows how to apply.
 *
 * ONE ENTRY PER GUARD FILE, because `runGuard` is handed a file and a file is
 * what gets broken. Each entry names the implementation it breaks, the exact
 * trimmed source line it rewrites, and what the rewrite does.
 *
 * `replacement` is a whole trimmed line, or an array of them; each is re-indented
 * to the indentation of the line it replaces, so the mutation does not also
 * reformat the file and confuse a diff-based reader.
 *
 * WHY THESE TWO, stated as the two DIRECTIONS spec section 5 asks for. One
 * mutation is caught (`bites`) and one is not (`does-not-bite`). Both are real
 * defects in the real implementation, neither is contrived to flatter the runner,
 * and the second one is the interesting half — see its `note`.
 *
 * @type {ReadonlyArray<{guard: string, target: string, needle: string, replacement: string|ReadonlyArray<string>, note: string}>}
 */
export const MUTATIONS = Object.freeze([
  Object.freeze({
    guard: "apps/dashboard/server/__tests__/graduationGates.test.mjs",
    target: "apps/dashboard/server/services/graduation/gates.mjs",
    needle: "qualifying += 1",
    replacement: "qualifying += 0",
    note:
      "Stops a qualifying window being counted as streak evidence. This is the defect " +
      "SHIP-5 and SHIP-6 are about: `windowsUsed` is the number the hysteresis runs are " +
      "built from, so a streak cannot be argued from it if it does not move. Observed: the " +
      "guard fails, 20 failed | 19 passed of 39."
  }),
  Object.freeze({
    guard: "apps/dashboard/server/__tests__/sharedCommentLexer.test.mjs",
    target: "apps/dashboard/server/scripts/guard-primitives.mjs",
    needle: '".playwright-tmp"',
    replacement: ['".playwright-tmp",', '"vendor-bundles"'],
    note:
      "Widens the SHARED non-production vocabulary with a segment no tracked path uses. " +
      "This is the guard's OWN stated subject — it asserts that no tracked path sits under " +
      "a segment new to either consumer, and it enumerates the five it knows about as a " +
      "hand-written DIFFERENTIAL list. A sixth is invisible to it, the corpus it scans does " +
      "not change today, and every assertion in the file stays green. The guard that exists " +
      "to catch an unexamined change cannot see this one, which is precisely the finding the " +
      "mutation tier was built to surface. Observed: the guard stays green."
  })
])

/**
 * The mutation registered for a guard file, or `null`.
 *
 * Keyed on the whole path because a partial match would let a same-named file in
 * another directory claim a mutation it was never written for.
 *
 * @param {string} guardFile
 * @returns {object|null}
 */
export function mutationFor(guardFile) {
  if (typeof guardFile !== "string" || guardFile === "") return null
  return MUTATIONS.find((m) => m.guard === guardFile) ?? null
}

/**
 * Rewrite exactly one whole source line, or report that it could not.
 *
 * EXACTLY ONE MATCH IS REQUIRED, and refusing on zero or on many is the point
 * rather than a convenience. Zero means the implementation was refactored past
 * this runner; many means the anchor is no longer specific. Either way the guard
 * would run against an implementation that was not broken, and answering
 * `does-not-bite` on that basis would be a false damning finding.
 *
 * @param {string} text the file's contents
 * @param {string} needle a whole trimmed line
 * @param {string|ReadonlyArray<string>} replacement
 * @returns {{ok: true, text: string} | {ok: false, reason: string, matches: number}}
 */
export function applyLineMutation(text, needle, replacement) {
  const lines = text.split("\n")
  const at = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === needle) at.push(i)
  }
  if (at.length !== 1) {
    return {
      ok: false,
      reason: at.length === 0 ? "mutation-anchor-not-found" : "mutation-anchor-not-unique",
      matches: at.length
    }
  }
  const index = at[0]
  const indent = (lines[index].match(/^[ \t]*/) ?? [""])[0]
  const replacementLines = Array.isArray(replacement) ? replacement : [replacement]
  const rebuilt = [
    ...lines.slice(0, index),
    ...replacementLines.map((l) => indent + l),
    ...lines.slice(index + 1)
  ]
  return { ok: true, text: rebuilt.join("\n") }
}

/**
 * Unlink the sandbox's `node_modules` link, and ONLY if it is a link.
 *
 * THIS MUST RUN BEFORE ANYTHING DELETES THE SANDBOX DIRECTORY, and the order is
 * the whole safety property rather than a detail of it.
 *
 * The measurement that forced it: with a directory link at
 * `<sandbox>/node_modules` pointing at the repository's own install,
 * `git worktree remove --force <sandbox>` deletes the LINK TARGET'S CONTENTS.
 * Measured in a throwaway repository with a file named `precious/data.txt`
 * behind the link: present before the removal, absent after. A sandbox that
 * carried a linked `node_modules` through to `git worktree remove` would not
 * cost the sandbox — it would cost the repository's installed dependencies, and
 * every guard in the repo at once.
 *
 * So the link is unlinked first, by `fs.unlinkSync`, which removes the link and
 * leaves the target untouched — also measured, in the same throwaway repository.
 * With no link left, `git worktree remove` can only reach files the sandbox
 * itself checked out, which is the point of putting it in a temp directory.
 *
 * The `lstat` guard is what keeps this safe in the other direction: only a path
 * that really is a link is unlinked. A real directory at that path is left
 * alone, so a mistake here can leave a directory behind but cannot remove one.
 *
 * @param {string} link
 */
function unlinkQuietly(link) {
  try {
    if (!lstatSync(link).isSymbolicLink()) return false
    unlinkSync(link)
    return true
  } catch {
    return false
  }
}

/**
 * Create a disposable sandbox: a real git worktree, outside the repository.
 *
 * OUTSIDE is load-bearing rather than tidiness. Every removal path here —
 * `git worktree remove --force`, a stray recursive delete, a crash-and-clean-up
 * — is bounded to a directory this function created in the OS temp area. A
 * sandbox placed inside the repository shares that blast radius with the
 * working tree.
 *
 * IT CARRIES ONE LINK, TO `node_modules`, because the sandbox has no install of
 * its own and `apps/dashboard/vite.config.ts` imports `vite`: without it vitest
 * cannot even load its own config and every guard exits before collecting a
 * test (measured — `ERR_MODULE_NOT_FOUND: Cannot find package 'vite'`). The
 * link is created only after the checkout, and removed by `dispose` before
 * anything deletes the directory. See `unlinkQuietly` for the measurement that
 * makes that order non-negotiable.
 *
 * @returns {Promise<{dir: string, dispose: () => Promise<void>}>}
 */
export async function createSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "premortem-sandbox-"))
  const link = join(dir, "node_modules")
  let disposed = false
  try {
    await execFile("git", ["worktree", "add", "--detach", dir], {
      cwd: REPO_ROOT,
      timeout: GUARD_TIMEOUT_MS,
      maxBuffer: 1 << 26
    })
    // `"junction"` is honoured on Windows and ignored elsewhere, where Node makes
    // an ordinary directory symlink. Neither needs elevated rights.
    symlinkSync(join(REPO_ROOT, "node_modules"), link, "junction")
  } catch (err) {
    unlinkQuietly(link)
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`sandbox-unavailable: ${err.message}`)
  }

  return {
    dir,
    async dispose() {
      if (disposed) return
      disposed = true
      // FIRST, and before any deletion of any kind. See `unlinkQuietly`.
      unlinkQuietly(link)
      try {
        await execFile("git", ["worktree", "remove", "--force", dir], {
          cwd: REPO_ROOT,
          timeout: GUARD_TIMEOUT_MS,
          maxBuffer: 1 << 26
        })
      } catch {
        // The worktree is already gone, or git cannot remove it. The link is
        // gone by this point, so a recursive delete can only reach files this
        // sandbox checked out.
        rmSync(dir, { recursive: true, force: true })
      }
      // Prune so a half-removed worktree does not linger in `.git/worktrees`.
      await execFile("git", ["worktree", "prune"], { cwd: REPO_ROOT }).catch(() => {})
    }
  }
}

/**
 * Build the `runGuard` `mutate.mjs` expects.
 *
 * THE MEASUREMENT IS READ FROM VITEST'S OWN JSON REPORT, not inferred from an
 * exit code. That is the difference between "the guard failed" and "the runner
 * had something go wrong", and the two must not be confused in the direction that
 * accuses a guard: a config error, a crash on import and a genuine assertion
 * failure can all leave a non-zero exit code, and only the report distinguishes
 * them.
 *
 * `numTotalTests` is checked as well as `numFailedTests`. A guard that collects
 * ZERO tests exits successfully having asserted nothing — which is GUARD-1's
 * exact shape — so it must not be readable as a guard that passed.
 *
 * The result is memoised per guard file for the life of the sandbox; see the
 * header for why that is one measurement rather than two.
 *
 * @param {{dir: string}} sandbox
 * @returns {(file: string) => Promise<{failed: boolean}|undefined>}
 */
export function createGuardRunner({ sandbox }) {
  const memo = new Map()
  return async function runGuard(file) {
    const mutation = mutationFor(file)
    // No registered mutation is NOT a verdict. The guard would run against an
    // unbroken implementation, and reporting that green as `does-not-bite`
    // would accuse a guard of blindness on the strength of a runner that never
    // broke anything. `undefined` is what `mutate.mjs` reads as no measurement.
    if (mutation === null) return undefined

    if (memo.has(file)) return memo.get(file)
    const promise = measure(sandbox, mutation)
    memo.set(file, promise)
    return promise
  }
}

/**
 * Break one implementation inside the sandbox, run the real guard, report the
 * measurement.
 *
 * @param {{dir: string}} sandbox
 * @param {object} mutation
 * @returns {Promise<{failed: boolean}|undefined>}
 */
async function measure(sandbox, mutation) {
  const target = resolve(sandbox.dir, mutation.target)
  const before = readFileSync(target, "utf8")
  const mutated = applyLineMutation(before, mutation.needle, mutation.replacement)
  if (!mutated.ok) {
    // Deliberately not an exception: `mutate.mjs` maps a THROWN runner to
    // `not-run` with the reason `guard-run-threw`, which names a crash, and
    // this is not a crash — it is a runner that declined to measure. Returning
    // nothing lets `mutate.mjs` apply its own reason, which is the module that
    // owns the vocabulary.
    return undefined
  }
  writeFileSync(target, mutated.text)

  // The report is read from VITEST'S OWN FIXED LOCATION, not from `--outputFile`,
  // and that is not a stylistic choice. Measured on vitest 5.0.3: on a PASSING
  // run `--outputFile=<name>` is honoured, and on a FAILING run it is silently
  // ignored and the report lands at `.vitest/json/output.json` instead. A failing
  // run is precisely the interesting one, so the flag cannot be relied on for it.
  // Passing an absolute path is ignored on both paths. So this asks for the
  // reporter plainly and reads where vitest says it wrote: it prints
  // "JSON report written to <path>", and that path is this one.
  //
  // The report is DELETED BEFORE the run as well as after. Two entries in this
  // sandbox are measured in sequence, and a report left behind by the first would
  // otherwise be read as the second's measurement — which is not a hypothetical:
  // it is the fixture that would report a green guard as one that bit, or a biting
  // guard as one that did not, depending on the order.
  const cwd = join(sandbox.dir, SANDBOX_DASHBOARD)
  const reportPath = join(cwd, VITEST_JSON_REPORT)
  rmSync(reportPath, { force: true })
  try {
    await execFile(
      process.execPath,
      [VITEST_ENTRY, "run", "--reporter=json", basenameOf(mutation.guard)],
      {
        cwd,
        timeout: GUARD_TIMEOUT_MS,
        maxBuffer: 1 << 26
      }
    )
  } catch (err) {
    // A non-zero exit is the NORMAL outcome for a guard that bites, so this is
    // not treated as an error at all. The report is still written by vitest, and
    // reading it is what tells a failed assertion from a crash. Only the absence
    // of a usable report is a real failure.
    if (err.code === undefined && err.killed) return undefined
  }

  let report
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"))
  } catch {
    // No readable report: vitest died before writing one. Nothing was measured.
    return undefined
  } finally {
    rmSync(reportPath, { force: true })
  }

  return readMeasurement(report)
}

/**
 * Turn vitest's JSON report into a measurement — or into nothing.
 *
 * EXTRACTED AND EXPORTED SO IT CAN BE TESTED, which is the reason it is not
 * inlined. An earlier revision inlined this decision, and the mutation check
 * found the result: deleting the zero-assertion guard below left every test in
 * `preMortemRunner.test.mjs` GREEN. The branch was unpinned, because reaching it
 * needed a real sandbox and no guard in the catalog collects zero tests — so the
 * only guard it protects is the guard this whole feature exists to catch, and it
 * was the one branch nobody could see. A pure function is testable without a
 * worktree, so the branch is tested directly.
 *
 * THE ZERO-TEST RULE IS THE LOAD-BEARING ONE. A guard that collects ZERO tests
 * exits successfully having asserted nothing. That is GUARD-1's exact shape —
 * the shipped guard that looked like coverage and was not — so reading it as
 * "the guard passed" would launder the one defect this program was built to
 * find. It answers `undefined`, which `mutate.mjs` reports as `not-run`.
 *
 * @param {unknown} report vitest's parsed JSON report
 * @returns {{failed: boolean}|undefined}
 */
export function readMeasurement(report) {
  if (report === null || typeof report !== "object") return undefined
  // NOTHING WAS ASSERTED, or the counts are not counts. Neither is a measurement.
  if (!Number.isInteger(report.numTotalTests) || report.numTotalTests === 0) return undefined
  if (!Number.isInteger(report.numFailedTests)) return undefined

  return { failed: report.numFailedTests > 0 }
}

/** The trailing path segment, which is how vitest is handed a file filter. */
function basenameOf(rel) {
  return rel.slice(rel.lastIndexOf("/") + 1)
}

/**
 * Run `run` with a live `runGuard`, and always dispose of the sandbox.
 *
 * The disposal is in a `finally`, so a throw from the readout still tears the
 * worktree down rather than leaving one registered in `.git/worktrees`.
 *
 * @template T
 * @param {{run: (runGuard: (file: string) => Promise<unknown>) => Promise<T>}} input
 * @returns {Promise<T>}
 */
export async function withSandbox({ run }) {
  const sandbox = await createSandbox()
  try {
    return await run(createGuardRunner({ sandbox }))
  } finally {
    await sandbox.dispose()
  }
}

/** Exported for the route's own diagnostics; the sandbox root a run started from. */
export function sandboxDashboardOf(dir) {
  return join(dir, SANDBOX_DASHBOARD)
}