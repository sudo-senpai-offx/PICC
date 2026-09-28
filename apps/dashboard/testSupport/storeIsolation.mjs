// WS-7 slice A - THE test-store isolation contract, in one place.
//
// WHY THIS FILE IS SEPARATE FROM BOTH HARNESSES. There are two harnesses that
// boot this server against a redirected data directory: Playwright, through
// `e2e/helpers/isolatedEnv.mjs`, and vitest, through
// `testSupport/vitestStoreIsolation.setup.mjs`. Each of them used to carry its
// own list of per-service `*_DATA_DIR` / `*_FILE` variables, and that is how
// WS-7 AUTH-FAILOPEN round 4 happened: a test set `PICC_AUTH_DATA_DIR`, spelled
// it right, and the OTHER per-service stores were still pointing at
// `server/data`. A list that exists twice is a list that drifts, so the list
// lives here and both harnesses import it. A second copy is how the class
// regrows.
//
// WHY THE LIST IS ENUMERATED FROM THE CODE, NOT FROM MEMORY. Every entry below
// corresponds to a `process.env.PICC_*` read in `apps/dashboard/server/**` that
// resolves a path a module will WRITE to (or a directory it will read a
// credential from). `ws7TestStoreIsolation.test.mjs` re-derives that set by
// scanning the server sources and fails if a `*_DATA_DIR` / `*_FILE` read
// appears that is not listed here - so a new per-service store cannot be added
// without adding it here. That is the anti-regrowth property, and it is the
// only reason this list is trustworthy rather than decorative.
//
// THE MISTAKE THIS EXISTS TO MAKE IMPOSSIBLE. `auth.mjs:10` is
// `process.env.PICC_AUTH_DATA_DIR || <default>`, so a MISSPELLED variable is
// indistinguishable from an UNSET one: both fall through to the default, which
// is the real `server/data`. A misspelling therefore cannot fail on its own -
// it silently writes. The three layers that make it loud live elsewhere and are
// named here so the contract is one idea rather than three:
//
//   1. PREVENTION  - the vitest setup file points every variable below at a
//                    per-file temp root BEFORE the test module is imported, so
//                    the correct variable is already correct and a typo has
//                    nothing left to break.
//   2. LOUDNESS     - the CI guard refuses any test that assigns a `PICC_*`
//                    path-shaped name which is not on the list below or on
//                    NON_STORE_PICC_PATH_VARIABLES. `PICC_AUTH_DAT_DIR` is a
//                    red build, not a silent write.
//   3. BACKSTOP     - the setup file fingerprints the real `server/data` before
//                    and after every test file, so ANY escape route - including
//                    one nobody thought of - turns the run red.
//
// NOT A PRODUCTION MODULE. It imports nothing and is loaded by both harnesses,
// so it must stay dependency-free plain ESM.
//
// THE TWO BLIND SPOTS, WRITTEN DOWN HERE RATHER THAN LEFT IN A REVIEW COMMENT.
//
// 1. NON-`PICC_` NAMES. Every rule above is keyed on the `PICC_` prefix, so a
//    store variable named anything else - `AUTH_DAT_DIR`, `TRADING_STORE` - is
//    invisible to the coverage claim, to the misspelling check, and to the
//    real-store-redirect scan. `ws7TestStoreIsolation.test.mjs` asserts that no
//    such variable exists today, so the boundary is checked rather than assumed.
//    It is a boundary, not a live defect.
//
// 2. `PICC_ENV_LOADED`, AND THEREFORE THE REPOSITORY `.env`. The Playwright
//    harness sets `PICC_ENV_LOADED=1`, which stops `server/config.mjs:11-21` from
//    calling `process.loadEnvFile()` and pulling `apps/dashboard/.env` - real
//    provider keys, a Hyperliquid private key, and a VAPID private key - into the
//    server process. The vitest harness does NOT set it, because doing so was
//    measured and breaks an existing test:
//
//        PICC_ENV_LOADED=1 npx vitest run server/__tests__/authBootstrapGateFailsClosed.test.mjs
//        -> 1 failed | 60 passed (61)
//        -> authBootstrapGateFailsClosed.test.mjs:480
//           AssertionError: expected 503 to be 401
//
//    Root cause of that failure, found by reading the keys (not the values) in
//    `.env`: it supplies `BTCPAY_API_KEY`, `BTCPAY_STORE_ID` and `BTCPAY_URL`, and
//    the `/api/btcpay/invoice` route's status depends on whether they are present.
//    So that test's expectation is `.env`-CONTINGENT, and correcting it means
//    editing the auth bootstrap gate - explicitly out of bounds for this slice.
//    The exposure is therefore real, pre-existing, and carried deliberately:
//    14 non-test modules import `config.mjs`, so the load happens in the vitest
//    worker today. Setting the flag is a two-line change here plus a decision
//    about that one test, and it should be taken as its own piece of work.

// The real per-service store directory. Every store below falls back to this
// path (via `new URL("../data", import.meta.url)` or `join(__dirname, "..",
// "data")`) when its variable is unset. A test that resolves any isolation
// variable into here is writing into the developer's live data, which is the
// entire incident this contract exists to prevent.
//
// WHY THIS IS A FUNCTION AND NOT A CONSTANT. `import.meta.url` is only a file
// URL under the `node` environment. Under jsdom - which is what every client
// component test in this repository runs - the module URL is an http:// URL and
// `fileURLToPath` throws `The URL must be of scheme file` at import time, which
// took down all 60-odd component suites on the first attempt. Resolving lazily
// also means the vitest setup file does not have to agree with the CI guard
// about where the repo is.
import { fileURLToPath } from "node:url"
import { join, resolve, sep, isAbsolute, relative, basename, dirname } from "node:path"
import { mkdirSync, mkdtempSync, realpathSync, statSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"

// WHY THE CWD FALLBACK VALIDATES `package.json` AND NOT `server/data`. This
// check is the exact line that took CI down in review round 1, and the reason is
// worth keeping in the code. `apps/dashboard/server/data/` is gitignored
// (`.gitignore:38`) with ZERO tracked files, and `.github/workflows/ci.yml` runs
// checkout -> `npm ci` -> `npm test` with nothing in the pipeline that creates
// it. So on a pipeline runner the directory does not exist, `existsSync` returns
// false, and every one of the 57 jsdom suites died in `beforeEach` - while the
// same code passed on a developer box, where the directory is full of live data.
//
// THE SHAPE OF THE FIX. `package.json` is the marker that identifies an
// `apps/dashboard` root, and it is TRACKED, so it is present in a fresh clone. The
// data directory is a runtime artefact of having run the app, not a property of
// the repository, so requiring it confuses "this is not the dashboard root" with
// "the developer has never run the app". The real store is still named and still
// compared against - `realServerDataDir()` still resolves to
// `<root>/server/data` whether or not it exists, and a containment check against a
// path that does not exist is not a vacuous pass, it is a comparison of strings.
//
// The function is a pure, injectable core so that a test can prove BOTH branches
// on a synthetic tree. A check that can only be exercised on a machine that
// happens to have the right directory is how this defect shipped.
export function resolveDashboardRoot({ moduleUrl, cwd, exists = existsSync } = {}) {
  const here = moduleUrl ?? import.meta.url
  if (typeof here === "string" && here.startsWith("file:")) {
    return resolve(fileURLToPath(new URL(".", here)), "..")
  }
  // jsdom (and any other non-file module environment): the vitest root is the
  // process cwd, and it is verified rather than trusted - a wrong cwd would
  // otherwise make every check below vacuously pass.
  const candidate = resolve(cwd ?? process.cwd())
  if (!exists(join(candidate, "package.json"))) {
    throw new Error(
      `cannot locate the apps/dashboard root from a non-file module environment (cwd ${candidate}). ` +
        "testSupport/storeIsolation.mjs must be imported from a module URL or run with apps/dashboard " +
        "as the cwd. Only package.json is required: server/data is gitignored, untracked and absent " +
        "from a fresh CI checkout, so requiring it broke the pipeline while passing locally."
    )
  }
  return candidate
}

/** The `apps/dashboard` directory, located the way THIS module was loaded. */
export function dashboardRoot() {
  return resolveDashboardRoot({})
}

/**
 * The real, gitignored, untracked per-service store directory.
 *
 * `root` is injectable so a test can aim the containment rule at a temporary
 * stand-in and exercise a junction with the real store nowhere near it - the
 * junction tests in `ws7TestStoreIsolation.test.mjs` do exactly that. Note this
 * returns a PATH whether or not the directory exists; that is the point. A
 * containment check against a path that is not there yet is a string comparison,
 * not a vacuous pass, and several stores legitimately point at a not-yet-created
 * directory.
 */
export function realServerDataDir({ root } = {}) {
  return join(root ?? dashboardRoot(), "server", "data")
}

// ---------------------------------------------------------------------------
// Directory variables. The pair is [env name, directory name under the run's
// temp root]. ORDER IS LOAD-BEARING FOR THE PLAYWRIGHT HARNESS: `e2e` builds
// its env map in this order and the e2e suite asserts on the generated map, so
// append, never reorder.
// ---------------------------------------------------------------------------
export const ISOLATION_DIRECTORY_VARIABLES = Object.freeze([
  ["PICC_TRADING_DATA_DIR", "trading"],
  ["PICC_AUTOMATOR_DATA_DIR", "automator"],
  ["PICC_COMMAND_CENTRE_DATA_DIR", "command-centre"],
  ["PICC_AUTH_DATA_DIR", "auth"],
  ["PICC_BROWSER_DATA_DIR", "browser"],
  ["PICC_ACCOUNT_METRICS_DATA_DIR", "account-metrics"],
  ["PICC_ALERTS_DATA_DIR", "alerts"],
  ["PICC_CONNECTOR_DATA_DIR", "connector"],
  ["PICC_CAPTURE_CONFIG_DATA_DIR", "capture-config"],
  ["PICC_DISPATCH_DATA_DIR", "dispatch"],
  ["PICC_EWALLET_DATA_DIR", "ewallet"],
  ["PICC_JOURNAL_DATA_DIR", "journal"],
  ["PICC_NOTIFICATION_DATA_DIR", "notification"],
  ["PICC_PROFILE_DATA_DIR", "profile"],
  ["PICC_WATCHLIST_DATA_DIR", "watchlist"],
  ["PICC_DATA_DIR", "data"]
])

// ---------------------------------------------------------------------------
// File variables: [env name, filename under <root>/settings].
//
// `PICC_ERROR_LOG_FILE` IS NEW HERE AND WAS MISSING FROM BOTH HARNESSES BEFORE
// THIS SLICE. `errorLog.mjs:31` reads it and defaults to
// `<repo>/picc-errors.log`; `initErrorLog()` TRUNCATES that file and every
// `writeErrorEntry()` appends to it. The Playwright harness was safe only by
// luck - it sets `PICC_ERROR_LOG=0`, which disables the logger before the path
// is ever consulted - so a directory-redirection-only reading of "the e2e
// helper covers every store" was false. Any harness that enables the logger
// without redirecting the FILE writes at the repository root. It is listed.
// ---------------------------------------------------------------------------
export const ISOLATION_FILE_VARIABLES = Object.freeze([
  ["PICC_SESSION_CAPTURE_SETTINGS_FILE", "session-capture-settings.json"],
  ["PICC_LLM_SETTINGS_FILE", "llm-settings.json"],
  ["PICC_ERROR_LOG_FILE", "picc-errors.log"]
])

export const ISOLATION_PATH_VARIABLES = Object.freeze([
  ...ISOLATION_DIRECTORY_VARIABLES.map(([name]) => name),
  ...ISOLATION_FILE_VARIABLES.map(([name]) => name)
])

export const ISOLATION_PATH_VARIABLE_KINDS = new Map([
  ...ISOLATION_DIRECTORY_VARIABLES.map(([name]) => [name, "directory"]),
  ...ISOLATION_FILE_VARIABLES.map(([name]) => [name, "file"])
])

// ---------------------------------------------------------------------------
// Path-shaped `PICC_*` variables the server honours that are NOT stores, so
// redirecting them would be wrong rather than merely unnecessary. Each entry
// is a stated reason, not a marker, and `ws7TestStoreIsolation.test.mjs` fails
// on a bare reason and on a stale one.
//
// This list is what keeps the "a new `*_DATA_DIR` read must be listed" rule
// honest without forcing read-only overrides into the isolation set.
// ---------------------------------------------------------------------------
export const NON_STORE_PICC_PATH_VARIABLES = Object.freeze({
  PICC_DIST_DIR:
    "server/index.mjs:20 names the static-asset root the HTTP server SERVES FROM. It is " +
    "read-only for the server, and pointing it at a temp dir would serve an empty document " +
    "root, so it must not be swept into the store-isolation set.",
  PICC_N8N_WORKFLOWS_DIR:
    "services/opportunities.mjs:107 reads the n8n workflow TEMPLATES the app lists. The " +
    "default is the tracked `infra/n8n/workflows` checkout content and the only consumer is " +
    "listWorkflows(), which readdirs and JSON.parses it. Redirecting it into an empty temp " +
    "root would make the workflows panel permanently empty, so it is read-only fixture input, " +
    "not a store.",
  PICC_BROWSER_PATH:
    "services/browserBridge.mjs:100-107 reads the CHROMIUM BINARY to launch, supplied by the " +
    "environment rather than derived from a data directory. It is an executable path, and a test " +
    "that redirected it would be choosing a browser, not isolating a store."
})

/** Every `PICC_*` name this contract accounts for: stores, non-stores, and flags. */
export function knownPiccPathVariable(name) {
  return (
    ISOLATION_PATH_VARIABLES.includes(name) ||
    Object.prototype.hasOwnProperty.call(NON_STORE_PICC_PATH_VARIABLES, name)
  )
}

// ---------------------------------------------------------------------------
// THE ONE BLIND SPOT, TURNED INTO A CHECKED LIST.
//
// Every rule in this module and in the CI guard is keyed on the `PICC_` prefix.
// A store variable named anything else - `AUTH_DAT_DIR`, `TRADING_STORE` - would
// be invisible to the coverage claim, to the misspelling check, and to the
// real-store-redirect scan. Nothing in the server does that today, and rather than
// leave that as a comment the guard asserts the list below is complete against a
// scan, so the boundary is checked rather than assumed. Add a `PICC_` variable for
// a new store; the guard will tell you if a non-`PICC_` one appears.
// ---------------------------------------------------------------------------
export const NON_PICC_PATH_ENVIRONMENT_VARIABLES = Object.freeze({
  GEMINI_SERVICE_ACCOUNT_FILE:
    "config.mjs:33 reads a Vertex AI service-account JSON path, dotted spelling. It is a cloud " +
    "credential descriptor, read-only from this application's point of view, and a different class " +
    "from a per-service store: nothing in the server writes to it, so redirecting it would isolate " +
    "nothing. It is listed so that a future non-PICC_ STORE cannot slip past the prefix-keyed rules.",
  // Recorded because it is the one case where the SHAPE PREDICATE ALONE IS NOT
  // ENOUGH: `ProgramFiles(x86)` is a directory, but it does not end in _DIR or
  // _FILE, so the unanchored `_ (DIR|FILE|PATH)` test does not match it. The
  // boundary check below therefore also admits every non-PICC_ name that appears
  // in the bracket spelling, whether or not it is path-shaped.
  "ProgramFiles(x86)":
    "browserBridge.mjs:78 reads process.env[\"ProgramFiles(x86)\"] in bracket spelling to locate a " +
    "32-bit Windows install directory. Read-only, owned by the OS, and on the module already " +
    "recorded in UNREDIRECTABLE_REASONS. Listed because the shape predicate misses it: a Windows " +
    "system directory is a path without a _DIR suffix."
})

/**
 * True when `name` has the shape a store-isolation variable must have.
 *
 * UNANCHORED, and that is the point. The first version anchored on `$`, which
 * caught the round-4 shape (`PICC_AUTH_DAT_DIR`) but let `PICC_DATA_DIRR` through
 * in silence - verified, and reported in review round 1. A trailing-typo is the
 * same defect as a middle-typo; there is no reason to catch one and not the other.
 * The cost of being broader is that a few more names reach the reasoned
 * NON_STORE map, which is a visible reviewable act rather than a silent failure.
 */
export function looksLikeIsolationPathName(name) {
  return /_(DIR|FILE|PATH)/.test(name)
}

export function isStrictlyInside(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}

/**
 * Canonicalise a path that may not exist yet, by resolving its deepest EXISTING
 * ancestor and re-appending the remainder.
 *
 * WHY THIS EXISTS. `assertNotRealStore` used `resolve()`, which is lexical: on
 * Windows `resolve` does not follow a junction, so a value of
 * `<tmp>/auth` where `<tmp>/auth` is a junction to the real store passes a purely
 * lexical check while the module underneath writes straight into the live data.
 * The review demonstrated exactly that junction. `realpathSync.native` closes it,
 * but it throws on a path that does not exist - and a test that `rmSync`d its
 * scratch directory in `afterEach` legitimately leaves `process.env` pointing at a
 * path that is gone. So: canonicalise what exists, keep the rest verbatim.
 */
export function canonicalizePath(target) {
  let head = resolve(target)
  const tail = []
  for (;;) {
    try {
      // Copied rather than reversed in place: `tail.reverse()` would mutate the
      // accumulator this loop is building, which is a footgun for the next edit.
      return join(realpathSync.native(head), ...[...tail].reverse())
    } catch {
      const parent = dirname(head)
      if (parent === head) return resolve(target)
      tail.push(basename(head))
      head = parent
    }
  }
}

// The containment rule, lifted verbatim out of the Playwright helper so both
// harnesses enforce ONE policy. `rootLabel` is injected so the Playwright error
// strings stay byte-for-byte what they were before this refactor - the policy
// moved, the messages did not change.
export function assertContainedPath(root, name, configuredPath, kind, rootLabel = "test isolation") {
  const absolutePath = resolve(configuredPath)
  if (!isStrictlyInside(root, absolutePath)) {
    throw new Error(`${name} resolves outside the ${rootLabel} root: ${configuredPath}`)
  }

  if (kind === "directory") {
    mkdirSync(absolutePath, { recursive: true, mode: 0o700 })
  } else {
    mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 })
  }

  const canonicalParent = realpathSync.native(kind === "directory" ? absolutePath : dirname(absolutePath))
  if (!statSync(canonicalParent).isDirectory()) {
    throw new Error(`${name} does not resolve to a directory-backed path: ${configuredPath}`)
  }

  const canonicalPath = kind === "directory" ? canonicalParent : join(canonicalParent, basename(absolutePath))
  if (!isStrictlyInside(root, canonicalPath)) {
    throw new Error(`${name} resolves outside the canonical ${rootLabel} root: ${configuredPath}`)
  }
}

/**
 * Throw when `configuredPath` is the real store rather than a scratch copy.
 *
 * Containment inside one run root is the stronger rule, but it is not the rule
 * that matters for a test which builds its own `mkdtemp` directory - such a path
 * is outside every run root and is perfectly safe. The rule that must never bend
 * is the one below: a test target may never BE the developer's live store.
 *
 * BOTH SIDES ARE CANONICALISED. A lexical `resolve` on the target walks straight
 * through a junction, so `<tmp>/auth -> <repo>/apps/dashboard/server/data` passed
 * the previous version while the module underneath wrote into the live store. The
 * real directory is canonicalised for the same reason: on macOS `/var` is a symlink
 * to `/private/var`, and a lexical comparison against a non-canonical configured
 * path would miss it. `realDir` is injectable so a test can exercise a junction
 * against a temporary stand-in without the real store being involved at all.
 */
export function assertNotRealStore(name, configuredPath, { realDir = realServerDataDir() } = {}) {
  const canonicalReal = canonicalizePath(realDir)
  const target = canonicalizePath(configuredPath)
  if (target === canonicalReal || isStrictlyInside(canonicalReal, target)) {
    throw new Error(
      `${name} resolves into the real server data store (${realDir}): ${configuredPath}. ` +
        "A test that points a store at the live data directory writes real accounts, real tokens " +
        "and real credentials into gitignored state that git cannot restore."
    )
  }
}

/** Directory name a variable gets under a run root - `null` for file variables. */
export function isolationDirectoryName(name) {
  const found = ISOLATION_DIRECTORY_VARIABLES.find(([n]) => n === name)
  return found ? found[1] : null
}

/** Filename a variable gets under a run root - `null` for directory variables. */
export function isolationFileName(name) {
  const found = ISOLATION_FILE_VARIABLES.find(([n]) => n === name)
  return found ? found[1] : null
}

// ---------------------------------------------------------------------------
// The one function a migrating test file should call instead of hand-rolling
// `process.env.PICC_X_DATA_DIR = mkdtempSync(...)`.
//
// It exists so that migration is MECHANICAL and so the guard has something
// specific to check: a test that redirects a store through this function
// contains no `process.env.PICC_... =` literal at all, which is exactly what
// `ws7TestStoreIsolation` looks for. It also refuses a name that is not on the
// contract, so the round-4 shape - a typo that redirects nothing - cannot be
// written through the helper either.
// ---------------------------------------------------------------------------

/** Throws unless `name` is a store variable this contract knows how to redirect. */
export function assertRedirectableStoreVariable(name) {
  const kind = ISOLATION_PATH_VARIABLE_KINDS.get(name)
  if (!kind) {
    throw new Error(
      `${name} is not a known PICC store variable, so redirecting it changes nothing and the ` +
        "store it was meant to isolate keeps writing to the real server/data. Known variables: " +
        `${ISOLATION_PATH_VARIABLES.join(", ")}.`
    )
  }
  return kind
}

// ---------------------------------------------------------------------------
// REDIRECT BOOKKEEPING, so "the harness owns this variable" is a fact rather
// than a comparison against one remembered string.
//
// The first version of `useIsolatedStoreDir` assigned `process.env` and returned,
// with no record that it had done so. Three things then went wrong, all found in
// review round 1:
//
//   1. The vitest setup's per-test reset only emptied a variable's harness-owned
//      directory while `process.env[name] === OWNED.get(name)`. Once a migrated
//      file had redirected the variable through this helper, that equality was
//      false for the rest of the file, so the harness directory was NEVER EMPTIED
//      AGAIN for that variable - the per-test reset silently switched itself off.
//   2. `handlers.test.mjs` and `v32Register.test.mjs` `rmSync` their scratch
//      directory in `afterEach` and leave `process.env` pointing at a path that no
//      longer exists. Nothing noticed, because nothing re-checked existence.
//   3. `vi.unstubAllEnvs()` in a teardown no longer restores anything for a
//      variable the helper assigned directly rather than through `vi.stubEnv`.
//
// Recording each redirect makes all three visible: the setup empties BOTH the
// harness directory and any helper-minted directory that still exists, and
// re-mints when the current value has gone missing.
// ---------------------------------------------------------------------------

/** variable name -> the scratch directory this helper minted for it, in order. */
const REDIRECTS = new Map()

/** Scratch directories minted by the helper, so the setup can reset them too. */
export function redirectedStoreDirs() {
  return [...REDIRECTS.values()]
}

/**
 * Mint a fresh scratch directory, point `name` at it, and hand back the path.
 *
 * THE CONTRACT, precisely, because a comment once asserted the opposite:
 *   - the directory is NOT cleaned up at teardown. A test that made a store
 *     durable across a module restart still needs it for the length of the test,
 *     so the caller keeps the `rmSync` it already had.
 *   - the variable is NOT restored to its previous value at teardown, and it is
 *     NOT restored merely because it was `delete`d. What the harness guarantees is
 *     narrower and is what the next `beforeEach` actually does: the variable is
 *     re-pointed at a live, empty harness-owned directory before every test.
 *   - the assignment is recorded, so the harness resets the minted directory too
 *     and can tell a deleted path from a live one.
 */
export function useIsolatedStoreDir(name, { prefix } = {}) {
  const kind = assertRedirectableStoreVariable(name)
  const label = (prefix || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/-+$/, "")
  const dir = mkdtempSync(join(tmpdir(), `picc-store-${label}-`))
  const canonical = realpathSync.native(dir)
  assertNotRealStore(name, canonical)
  const target = kind === "directory" ? canonical : join(canonical, isolationFileName(name) || "isolated.json")
  process.env[name] = target
  REDIRECTS.set(name, canonical)
  return target
}

export default ISOLATION_PATH_VARIABLES
