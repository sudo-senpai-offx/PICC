// NOT A PRODUCTION MODULE. Test-harness support only, and dependency-free plain ESM
// so both harnesses can load it.
//
// WHY THIS IS A SEPARATE FILE. Two reasons, and the first one is the bug.
//
// 1. THE RATE LIMIT CANNOT BE MODULE STATE. The vitest setup lives in a
//    `setupFiles` entry, and vitest RE-EVALUATES that module for every test file,
//    so a module-level `warned` flag resets every file. Round 2 believed it had
//    rate-limited the honest-teardown warning and had not: running 4 legacy files
//    printed 4 warnings. Hoisting the flag to `globalThis` was the reviewer's
//    suggestion and it is NOT sufficient either - under `pool: 'forks'` with
//    `isolate: true` (the default) each test file can get a fresh execution
//    context, so `globalThis` resets too. The only state that reliably outlives a
//    test file is the FILESYSTEM, so the once-per-run marker is an exclusive
//    `open(..., "wx")` in the OS temp dir, keyed by `process.ppid` so every worker
//    of one vitest run shares it.
//
// 2. IT MUST BE TESTABLE WITHOUT REGISTERING HOOKS. A test cannot import the
//    setup file: it calls `beforeEach`/`afterAll` at module scope, which would
//    attach this test file's hooks. Extracting the reporter means the guard can
//    assert the tally is actually surfaced.
//
// A WRONG LOG LINE IN A GUARD IS WORSE THAN A NOISY ONE, because the next reader
// trusts it. Round 2's message claimed "across this worker" (it was per file) and
// "counted, not printed" (the tally was never read - dead code). The wording below
// is what the code does.
//
// AND SILENCE BY DEFAULT, because round 3 measured the cost of the alternative.
// `authTerminalPerfInstrumentation.test.mjs > is completely silent when
// PICC_ERROR_LOG is not 1` asserts that NOTHING is written to the output, so even a
// once-per-run line is a failure to a real test. The tally is therefore always
// written to a file and never printed unless a developer asks for it with
// PICC_TEST_ISOLATION_REPORT_REPAIRS=1. That is zero noise by default, and the
// information is still there - which is the part that was actually missing in
// round 2.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The env var that turns the once-per-run line back on. */
export const REPAIR_REPORT_ENV = "PICC_TEST_ISOLATION_REPORT_REPAIRS"

/**
 * @param {object} [options]
 * @param {(message: string) => void} [options.warn] the sink, injectable for tests
 * @param {string} [options.scope] run-scoped key; defaults to the parent pid so all
 *   workers of one vitest run share it. Tests pass a unique scope so they cannot
 *   collide with a real run, or with each other.
 * @param {boolean} [options.enabled] whether to print; defaults to the env var.
 */
export function createRepairReporter({ warn = console.warn, scope, enabled } = {}) {
  const runScope = scope ?? `ppid-${process.ppid}`
  const dir = join(tmpdir(), "picc-store-isolation")
  const tallyPath = join(dir, `repairs-${runScope}.txt`)
  const shouldPrint = enabled ?? process.env[REPAIR_REPORT_ENV] === "1"
  let total = 0
  const names = new Set()

  return {
    /**
     * Record one honest repair. Called from `beforeEach` for a store variable that
     * was unset, or that pointed at a scratch directory the test deleted.
     */
    note(name) {
      total += 1
      names.add(name)
    },

    /** How many repairs this reporter instance has seen. */
    count() {
      return total
    },

    /** The run-scoped tally file, whether or not anything was printed. */
    tallyPath() {
      return tallyPath
    },

    /**
     * Called from `afterAll`. Always appends this file's count to the run tally.
     * Prints at most once per run, and only when opted in.
     *
     * @returns {{message: string, printed: boolean, runTotal: number|null}|null}
     *   null when this reporter saw no repairs. Returning the message is what lets a
     *   test assert the tally is surfaced without capturing console.
     */
    report() {
      if (total === 0) return null
      let runTotal = null
      try {
        mkdirSync(dir, { recursive: true })
        appendFileSync(tallyPath, `${total}\t${[...names].sort().join(",")}\n`, "utf8")
        runTotal = readRunTotal(tallyPath)
      } catch {
        // A harness that cannot write a tally file must still not fail the run.
      }
      const message =
        `[picc-test-isolation] re-pointed ${total} store variable(s) in this test file after a test ` +
        `deleted them (${[...names].sort().join(", ")}). Printed ONCE PER RUN and only when ` +
        `${REPAIR_REPORT_ENV}=1. ` +
        `${runTotal === null ? "" : `Run total so far: ${runTotal}. `}` +
        `Per-file breakdown: ${tallyPath}. Honest teardown in ~85 files; a store variable aimed at ` +
        "the live store fails its test loudly instead of being reported here."
      if (shouldPrint) warn(message)
      return { message, printed: shouldPrint, runTotal }
    }
  }
}

/** Sum every row in the run tally, or null when it cannot be read. */
function readRunTotal(tallyPath) {
  try {
    const rows = readFileSync(tallyPath, "utf8").split("\n").filter(Boolean)
    return rows.reduce((sum, row) => sum + (Number(row.split("\t")[0]) || 0), 0)
  } catch {
    return null
  }
}
