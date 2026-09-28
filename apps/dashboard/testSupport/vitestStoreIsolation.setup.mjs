// WS-7 slice A - the vitest half of the test-store isolation contract.
//
// WHAT THIS DOES, IN ONE PARAGRAPH. Before the test module is imported, every
// per-service `*_DATA_DIR` / `*_FILE` variable the server honours is pointed at a
// fresh temp root owned by THIS test file, so a store that falls back to
// `server/data` has nowhere left to fall back to. The correct variable is
// therefore already correct before a single line of the test runs, which is
// what turns the AUTH-FAILOPEN round-4 misspelling from "silently wrote a real
// account" into "had nothing left to break".
//
// WHY `setupFiles` AND NOT `beforeEach`. Several server modules capture their
// data dir in a module-scope `const` - `auth.mjs:10`,
// `alertEngine.mjs:10`, `dispatch.mjs:10`, `tradeJournal.mjs:8`,
// `watchlist.mjs:10` all do - so a variable assigned in a `beforeEach` is
// already too late for the module under test, and for the one repo-wide file
// that imports `handlers.mjs` statically it is too late for the import itself.
// Vitest runs `setupFiles` before the test file's module graph is evaluated, so
// this is the only hook that can win that race. That is also why
// `handlers.test.mjs` needs no edit and no conversion to a dynamic import.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not set `PICC_VAULT_KEY`: the key
// is derived from a `PICC_VAULT_KEY` env value OR a `picc-vault.key` FILE, and
// which of the two is in play is itself asserted by `vault.test.mjs`, so
// forcing one here would decide a question that test exists to ask. It does not
// set `PICC_ENV_LOADED`, which controls whether `server/config.mjs` loads the
// repository `.env` - that is a credential question, not a store question, and
// changing it here would silently alter what the whole suite can see. Both are
// reported rather than quietly decided.
import { afterAll, beforeEach } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  ISOLATION_DIRECTORY_VARIABLES,
  ISOLATION_FILE_VARIABLES,
  ISOLATION_PATH_VARIABLES,
  ISOLATION_PATH_VARIABLE_KINDS,
  NON_STORE_PICC_PATH_VARIABLES,
  assertContainedPath,
  assertNotRealStore,
  isStrictlyInside,
  looksLikeIsolationPathName,
  redirectedStoreDirs
} from "./storeIsolation.mjs"

const RUN_ROOT = realpathSync.native(mkdtempSync(join(tmpdir(), "picc-vitest-store-")))

const PREVIOUS = new Map()
function setVar(name, value) {
  if (!PREVIOUS.has(name)) PREVIOUS.set(name, process.env[name])
  process.env[name] = value
}

// The value the harness owns for each variable, kept so an `afterEach` that
// deletes one can be repaired rather than merely complained about. See the
// note on `beforeEach` below for why repair beats failure there.
const OWNED = new Map()

for (const [name, directory] of ISOLATION_DIRECTORY_VARIABLES) {
  const dir = join(RUN_ROOT, directory)
  mkdirRecursive(dir)
  const canonical = realpathSync.native(dir)
  OWNED.set(name, canonical)
  setVar(name, canonical)
}
const SETTINGS_DIR = join(RUN_ROOT, "settings")
mkdirRecursive(SETTINGS_DIR)
for (const [name, filename] of ISOLATION_FILE_VARIABLES) {
  const target = join(SETTINGS_DIR, filename)
  OWNED.set(name, target)
  setVar(name, target)
}

// The error logger writes `picc-errors.log` at the REPOSITORY ROOT by default
// and truncates it on every launch. `PICC_ERROR_LOG_FILE` above already points
// the target inside the run root, so the flag below is belt-and-braces: with it
// off, no test can reach the log at all unless it deliberately turns it on, and
// a test that turns it on still writes inside the run root.
setVar("PICC_ERROR_LOG", "0")

function mkdirRecursive(dir) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw new Error(`could not create the isolation directory ${dir}: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// WHY THERE IS NO WHOLE-TREE FINGERPRINT HERE. The obvious backstop - hash
// server/data before the test file loads, hash it again after, and fail on any
// difference - was built, measured, and REMOVED, because on this machine it
// cannot tell a test's write from the developer's own running app.
//
// The measurement, taken twice with 70 seconds between the samples and no test
// running:
//
//   pack_registry.json   6143811 bytes  13:03:04  ->  6148545 bytes  13:04:22
//   account-metrics.json        567 bytes  12:59:49  ->       567 bytes  13:04:26
//   (sentiment.json also advanced at 13:02:48)
//
// A live PICC process is writing that tree continuously. So a whole-tree
// fingerprint is a flake generator here: it would fire on the developer's app,
// which a guard that cries wolf gets deleted to fix - and it would simultaneously
// be ATTRIBUTIONLESS, so it could not name the test that did the damage. Both
// halves are unacceptable, and the honest answer is to check the things that are
// attributable to this test process, which is what the rest of this file does:
//   - every isolation variable is checked against the real store before each
//     test, so a redirect aimed at live state fails BEFORE any write;
//   - every isolation variable is checked again at teardown, catching a late
//     redirect;
//   - a path-shaped PICC_ variable that appeared during the run and is not on the
//     contract is reported by name, which is the misspelling case;
//   - and the static CI guard bans a hardcoded real-store path in any test file.
//
// WHAT THAT LEAVES UNCOVERED, STATED PLAINLY. A store with NO isolation variable
// cannot be caught by any of the above, and one exists: `vault.mjs:31` resolves
// its key file to a hardcoded `new URL("../data")` and honours PICC_VAULT_KEY for
// the KEY MATERIAL only, never for the directory. That is why a real
// `server/data/picc-vault.key` exists at all. It is pinned, with its reason, in
// ws7TestStoreIsolation.test.mjs so the gap is machine-tracked rather than
// quietly absent.
// ---------------------------------------------------------------------------

const BASELINE_KEYS = new Set(Object.keys(process.env))

// ---------------------------------------------------------------------------
// A FRESH ROOT PER TEST, NOT PER FILE.
//
// The prompt-level invariant is "each test gets a fresh temp root", and the
// per-test granularity is also what makes the whole thing safe to adopt. Many
// server modules carry a disk guard of the form
// `!isVitestMode() || Boolean(process.env.PICC_<SERVICE>_DATA_DIR)`
// (accountMetrics.mjs:40, ceremonyState.mjs:12, riskState.mjs:19,
// livePositionManager.mjs:105, ccxtOrdering.mjs:70 and others). Until this setup
// existed those guards returned FALSE under vitest, so those stores were refused
// the disk entirely - and the refusal, not any deliberate fixture, was what
// gave those suites a clean slate between tests. Pointing the variable at a
// real directory flips the guard to TRUE, so the disk starts being written, and
// without a reset the writes accumulate across the file: ceremonyState went from
// "expected 3, got 4" and leaderIdeasState from "expected 4, got 8" purely from
// state left by the previous test in the same file.
//
// So the run root is emptied before each test, and the directories are recreated
// immediately. Tests that build their OWN `mkdtemp` directory and assign the
// variable to it - 83 files do - are unaffected, because their data was never in
// this root to begin with.
//
// WHY AN UNSET VARIABLE IS REPAIRED RATHER THAN REJECTED. More than eighty test
// files hand-roll a redirect and then `delete process.env.<NAME>` in
// `afterEach`. Failing on the unset state would make every one of those files
// red for doing ordinary cleanup, and a guard that fires on honest teardown is a
// guard the next author deletes. The defect this slice closes is not "a variable
// is unset" - it is "a variable is set to a name no module reads", or "a
// variable aims at the live store". The first is caught statically by
// ws7TestStoreIsolation before the suite runs, and again at teardown below; the
// second is rejected on the line below. An unset variable is a leak, not an
// attack, and the safe response to a leak is to put the redirect back.
//
// THE RUNTIME CHECKS HERE CANNOT, ALONE, CLOSE THE RESTORE IDIOM, AND ROUND 1 OF
// REVIEW SHOWED WHY. The sequence below defeats every check in this file:
//
//     beforeEach(test1)  -> variable at the harness value            OK
//     test body          -> process.env.PICC_AUTH_DATA_DIR = <real store>
//                           write lands in the real store            SUCCEEDED
//     afterEach          -> delete process.env.PICC_AUTH_DATA_DIR    (85+ files do)
//     beforeEach(test2)  -> repaired to the harness value            OK
//     afterAll check 2   -> variable at the harness value            "no problem"
//
// Every check reported clean while a file landed in real server/data. Five stores
// re-read `process.env` per call (connectors.mjs:272, ewallet.mjs:39,
// v32Config.mjs:65, chartPrefs.mjs:25, riskGates.mjs:44), so a mid-test
// reassignment genuinely MOVES the store. The fix is therefore AT THE SOURCE and
// STATIC - ws7TestStoreIsolation Claim 3 now fires on a store-variable
// assignment whose value is not scratch-derived - and the checks below are
// defence in depth, not the primary defence. They are kept because they cost
// nothing and they catch the shapes a static scan cannot see, such as a redirect
// built at runtime from a function argument.
// ---------------------------------------------------------------------------
const REPAIRED = []

function emptyDirectory(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    mkdirRecursive(dir)
    return
  }
  for (const entry of entries) {
    rmSync(join(dir, entry.name), { recursive: true, force: true, maxRetries: 5, retryDelay: 25 })
  }
}

/** True when a configured value still points at something that exists. */
function targetExists(configured) {
  try {
    return existsSync(configured)
  } catch {
    return false
  }
}

beforeEach(() => {
  for (const name of ISOLATION_PATH_VARIABLES) {
    const configured = process.env[name]
    if (typeof configured !== "string" || configured.length === 0) {
      REPAIRED.push(name)
      process.env[name] = OWNED.get(name)
      continue
    }
    // A file that `rmSync`d its scratch directory in `afterEach` leaves the
    // variable pointing at a path that no longer exists. Nothing broke, but the
    // next module to read it would silently recreate the tree, so re-mint rather
    // than leave a dangling value behind.
    if (!targetExists(configured)) {
      REPAIRED.push(name)
      process.env[name] = OWNED.get(name)
      continue
    }
    assertNotRealStore(name, configured)
  }

  // THE HARNESS'S OWN SHARED RULE, finally called. Until round 1 of review this
  // function was imported here, re-exported below, and never invoked - so vitest
  // enforced a weaker policy than the Playwright harness it claims to share. It
  // applies to the values the harness itself owns, which is where "inside the run
  // root" is a guarantee rather than an assumption: a test that redirected the
  // variable at its own mkdtemp keeps that directory, and is covered instead by
  // the real-store check above.
  for (const name of ISOLATION_PATH_VARIABLES) {
    if (process.env[name] !== OWNED.get(name)) continue
    assertContainedPath(
      RUN_ROOT,
      name,
      process.env[name],
      ISOLATION_PATH_VARIABLE_KINDS.get(name),
      "vitest isolation"
    )
  }

  // UNCONDITIONALLY, not only while the variable still holds the harness value.
  // The previous version skipped the reset as soon as a migrated file had
  // redirected the variable through useIsolatedStoreDir(), because that
  // comparison went false and the per-test reset silently switched itself off
  // for the rest of the file. The harness directory is emptied either way.
  emptyDirectory(SETTINGS_DIR)
  for (const [name] of ISOLATION_DIRECTORY_VARIABLES) emptyDirectory(OWNED.get(name))

  // And the scratch directories the helper minted, when they still exist. A
  // helper-minted directory belongs to the test that asked for it, so it is
  // emptied between tests rather than left accumulating.
  for (const dir of redirectedStoreDirs()) {
    if (dir === RUN_ROOT || ISOLATION_DIRECTORY_VARIABLES.some(([n]) => OWNED.get(n) === dir)) continue
    emptyDirectory(dir)
  }
})

afterAll(() => {
  const problems = []

  // 1. A path-shaped PICC_ variable that appeared during this test file and is
  //    not on the contract is either a typo or a new store. `PICC_AUTH_DAT_DIR`
  //    is the round-4 defect in this exact shape. Because the setup already set
  //    every real variable, catching it here costs a red test, not a red store.
  const unknown = Object.keys(process.env)
    .filter((name) => name.startsWith("PICC_") && !BASELINE_KEYS.has(name))
    .filter(looksLikeIsolationPathName)
    .filter(
      (name) =>
        !ISOLATION_PATH_VARIABLES.includes(name) &&
        !Object.prototype.hasOwnProperty.call(NON_STORE_PICC_PATH_VARIABLES, name)
    )
  if (unknown.length > 0) {
    problems.push(
      `unknown PICC_* path variable(s) set during this test file: ${unknown.join(", ")}. ` +
        "A store variable that no server module reads redirects nothing, so the store it meant to " +
        "isolate kept writing to the real server/data. If this is genuinely new, add it to " +
        "testSupport/storeIsolation.mjs - the CI guard fails on the server side too."
    )
  }

  // 2. A store variable that ENDED the run aimed at the live store, or aimed at
  //    something that is not scratch at all. The beforeEach check covers the
  //    common shape; this catches a redirect that lands late - in the last test
  //    of a file, or from a callback the hook ordering does not cover.
  //
  //    "EQUALS THE VALUE THE HARNESS SET" is deliberately NOT asserted, and the
  //    reason is worth stating rather than looking like an omission: 85 files
  //    legitimately leave the variable pointing at their OWN scratch directory,
  //    and demanding the harness value would fail every one of them. The property
  //    that must hold is "inside the run root, inside the OS temp dir, or absent"
  //    - which is what a real-store value and a repo-root value both fail.
  const scratch = [RUN_ROOT, realpathSync.native(tmpdir())]
  for (const name of ISOLATION_PATH_VARIABLES) {
    const configured = process.env[name]
    if (typeof configured !== "string" || configured.length === 0) continue
    try {
      assertNotRealStore(name, configured)
      if (!scratch.some((root) => isStrictlyInside(root, configured) || configured === root)) {
        problems.push(
          `${name} ended the run at ${configured}, which is neither inside the run root ` +
            `(${RUN_ROOT}) nor inside the OS temp dir. A store target outside scratch is a store ` +
            "the harness cannot vouch for."
        )
      }
    } catch (error) {
      problems.push(error.message)
    }
  }

  if (problems.length > 0) {
    throw new Error(`WS-7 test-store isolation violated in ${resolve(RUN_ROOT)}:\n- ${problems.join("\n- ")}`)
  }
  if (REPAIRED.length > 0) {
    // Deliberately NOT a failure. Reported here so a leaked `delete` is
    // discoverable in the run output without turning eighty honest cleanups
    // red; the repair above is what keeps the invariant intact.
    console.warn(
      `[picc-test-isolation] restored ${[...new Set(REPAIRED)].join(", ")} after a test deleted them`
    )
  }

  for (const [name, previous] of PREVIOUS) {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
  rmSync(RUN_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

// Re-exported so a test file can assert the invariant from the inside, and so
// the containment rule is reachable without importing two modules.
export { RUN_ROOT as ISOLATION_RUN_ROOT, assertContainedPath, assertNotRealStore, ISOLATION_PATH_VARIABLES }
