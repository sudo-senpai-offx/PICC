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

/** The `apps/dashboard` directory, located the way THIS module was loaded. */
export function dashboardRoot() {
  const here = import.meta.url
  if (here.startsWith("file:")) {
    return resolve(fileURLToPath(new URL(".", here)), "..")
  }
  // jsdom (and any other non-file module environment): the vitest root is the
  // process cwd, and it is verified rather than trusted - a wrong cwd would
  // otherwise make every check below vacuously pass.
  const cwd = resolve(process.cwd())
  if (!existsSync(join(cwd, "server", "data")) || !existsSync(join(cwd, "package.json"))) {
    throw new Error(
      `cannot locate the apps/dashboard root from a non-file module environment (cwd ${cwd}). ` +
        "testSupport/storeIsolation.mjs must be imported from a module URL or run with apps/dashboard as the cwd."
    )
  }
  return cwd
}

/** The real, gitignored, untracked per-service store directory. */
export function realServerDataDir() {
  return join(dashboardRoot(), "server", "data")
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

/** True when `name` has the shape a store-isolation variable must have. */
export function looksLikeIsolationPathName(name) {
  return /_(DIR|FILE|PATH)$/.test(name)
}

export function isStrictlyInside(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
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
 * is outside every run root and is perfectly safe. The rule that must never
 * bend is the one below: a test target may never BE the developer's live store.
 */
export function assertNotRealStore(name, configuredPath) {
  const realDir = realServerDataDir()
  const target = resolve(configuredPath)
  if (isStrictlyInside(realDir, target) || target === resolve(realDir)) {
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

/**
 * Mint a fresh scratch directory, point `name` at it, and hand back the path.
 * The returned directory is NOT cleaned up by the harness - a test that made a
 * store durable across a module restart still needs it to survive for the length
 * of the test - so the caller keeps the `rmSync` it already had.
 */
export function useIsolatedStoreDir(name, { prefix } = {}) {
  const kind = assertRedirectableStoreVariable(name)
  const label = (prefix || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/-+$/, "")
  const dir = mkdtempSync(join(tmpdir(), `picc-store-${label}-`))
  const canonical = realpathSync.native(dir)
  assertNotRealStore(name, canonical)
  if (kind === "directory") {
    process.env[name] = canonical
  } else {
    // A file variable: hand back a path in a fresh directory and parent it.
    process.env[name] = join(canonical, isolationFileName(name) || "isolated.json")
  }
  return process.env[name]
}

export default ISOLATION_PATH_VARIABLES
