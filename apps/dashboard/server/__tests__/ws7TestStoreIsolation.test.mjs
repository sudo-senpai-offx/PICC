// WS-7 slice A - the repo-wide test-store isolation guard.
//
// WHY THIS FILE EXISTS AS A RUNNING TEST, RATHER THAN A RULE IN THE FILE THAT
// MADE THE MISTAKE. A guard that lives only inside the test that misspelled
// PICC_AUTH_DATA_DIR is not a guard: it dies with that file and says nothing
// about the other 319. This file is the repo-wide enforcement, and it runs in
// the pipeline because the CI `test` job runs `npm test` over the whole vitest
// suite - this file is a vitest file in `server/__tests__/`, so there is no
// separate wiring to drift out of date.
//
// THE INCIDENT THIS IS BUILT FROM. `server/services/auth.mjs:10` is
// `process.env.PICC_AUTH_DATA_DIR || <default>`. A misspelling is therefore
// indistinguishable from an unset variable: both fall through to the real
// `server/data`. Round 4 of the auth task misspelled it, the suite passed, and a
// real account was written into the developer's live store - gitignored,
// untracked, therefore unrecoverable by git. The failure was invisible twice
// over: the assertion was on `createAccount`'s return value, which is truthy
// whichever directory the account landed in, and the redirection was a
// single-variable redirect in a repository where EVERY per-service store falls
// back to `server/data` independently. A reviewer demonstrated the second half
// by setting only PICC_AUTH_DATA_DIR and firing an anonymous
// POST /api/trading/watchlist, which put EURUSD into the real
// trading-watchlist.json.
//
// THE THREE CLAIMS, and what would falsify each:
//
//   1. COVERAGE - every `process.env.PICC_*` read in the server that resolves a
//      writable path is on the shared contract in
//      `testSupport/storeIsolation.mjs`. Falsified by adding a store.
//   2. NO AD-HOC REDIRECTS - no test file outside the inventoried legacy set
//      assigns a store variable itself. Falsified by adding a redirect.
//   3. NO WRITES TO THE REAL STORE - no tracked test file performs a mutating
//      filesystem call whose target is built from the real `server/data` path.
//      Falsified by adding such a line.
//
// Every claim is paired with a test that shows the detector firing on a
// SYNTHETIC sample. Nothing here writes to the real `server/data`, not even to
// prove the guard works: the round-4 failure mode was demonstrated by
// construction, and so is this one. The detectors are pure functions over text
// and the samples are strings.
import { describe, expect, it, afterAll, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  ISOLATION_PATH_VARIABLES,
  ISOLATION_PATH_VARIABLE_KINDS,
  NON_STORE_PICC_PATH_VARIABLES,
  NON_PICC_PATH_ENVIRONMENT_VARIABLES,
  assertContainedPath,
  assertNotRealStore,
  looksLikeIsolationPathName,
  realServerDataDir,
  resolveDashboardRoot,
  useIsolatedStoreDir
} from "../../testSupport/storeIsolation.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join("/")
const EXCLUDED_PREFIXES = [".freebuff/worktrees/"]

// FILE DISCOVERY. `git ls-files` rather than a filesystem walk, for two
// load-bearing reasons: it omits the untracked, gitignored `server/data/`, so
// this scan can neither read the developer's live store nor fail on it; and it
// omits the untracked nested worktree of another branch. The explicit prefix
// exclusion is kept and asserted anyway, so a future rewrite as a naive walk
// fails loudly rather than silently picking up another branch's working state.
function lsFiles(patterns) {
  return execFileSync("git", ["ls-files", ...patterns], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !EXCLUDED_PREFIXES.some((p) => f.startsWith(p)))
}

const allTracked = lsFiles([])
const serverFiles = lsFiles(["apps/dashboard/server"])
  .filter((f) => f.endsWith(".mjs") && !f.includes("server/__tests__/"))
const testFiles = lsFiles(["apps/dashboard"])
  .filter((f) => /\.(test|spec)\.(mjs|ts|tsx|js)$/.test(f))
  .filter((f) => !f.includes("/e2e/"))

const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8")

// DETECTOR 1 - which PICC_ variables does the server read as writable paths?
//
// A read is a CANDIDATE when either
//   (a) the name is PATH-SHAPED - it ends in `_DIR`, `_FILE` or `_PATH`. That is
//       the broad half, and it is deliberately broad: a variable the server
//       resolves to a location is exactly the kind that, left unaccounted for,
//       keeps writing somewhere nobody redirected. The cost of a false positive
//       is one reasoned NON_STORE entry, which is cheap; the cost of a false
//       negative is a store that no test can redirect, which is the incident.
//   (b) the read sits on a line that builds a path (`join(`, `resolve(`,
//       `fileURLToPath(`, `isAbsolute(`, `new URL(`), which catches a path
//       variable whose name says nothing useful.
//
// Both halves are needed. (a) alone misses a store called PICC_SOMETHING; (b)
// alone misses `const DATA_DIR =` / `process.env.PICC_X_DATA_DIR || ...` where
// the read sits on a line with no path call. Neither half is exhaustive about
// semantics - nothing mechanical is - which is why the candidate set is REQUIRED
// onto the contract rather than merely permitted from it. A store both halves
// miss is still caught at runtime by the fingerprint backstop in
// `testSupport/vitestStoreIsolation.setup.mjs`.
const PATH_CALL = /\b(join|resolve|fileURLToPath|isAbsolute)\(|\bnew URL\(/
const PATH_SHAPED_NAME = /_(DIR|FILE|PATH)$/
// THREE SPELLINGS, because round 1 of review found the scan only covered one of
// them. The repository already reads `process.env[name]` in six places
// (handlers.mjs:1867, ceremonyGates.mjs:18, perpsGates.mjs:73, riskGates.mjs:36,
// riskState.mjs:54, leaderGuard.mjs:8) - all numeric indices today, so there is no
// current miss, but a store introduced through that door would have been invisible
// to this scan AND to the staleness test, which is two ways of not looking.
const ENV_READ_DOTTED = /process\.env\.(PICC_[A-Z0-9_]+)/g
const ENV_READ_BRACKET_LITERAL = /process\.env\[\s*["'`](PICC_[A-Z0-9_]+)["'`]\s*\]/g
// A computed index cannot be resolved to a name by reading the text, so it is
// recorded as its own finding: a module that reads `process.env[...]` must still
// declare a literal path variable, or the name it actually resolves is a fact
// nobody can check statically.
const ENV_READ_COMPUTED = /process\.env\[\s*(?!["'`])/g

function discoverServerPathVariables(files, reader = read) {
  const found = new Map()
  const computed = new Set()
  for (const file of files) {
    reader(file)
      .split("\n")
      .forEach((line, index) => {
        if (ENV_READ_COMPUTED.test(line)) computed.add(`${file}:${index + 1}`)
        ENV_READ_COMPUTED.lastIndex = 0
        for (const pattern of [ENV_READ_DOTTED, ENV_READ_BRACKET_LITERAL]) {
          pattern.lastIndex = 0
          for (const match of line.matchAll(pattern)) {
            const name = match[1]
            if (!PATH_SHAPED_NAME.test(name) && !PATH_CALL.test(line)) continue
            if (!found.has(name)) found.set(name, [])
            found.get(name).push(`${file}:${index + 1}`)
          }
        }
      })
  }
  return { found, computed: [...computed].sort() }
}

const DISCOVERY = discoverServerPathVariables(serverFiles)
const DISCOVERED = DISCOVERY.found
const COMPUTED_ENV_READS = DISCOVERY.computed

// Per-file literal path-variable names, computed once and used by the
// computed-read check below.
const DISCOVERED_SCAN = (() => {
  const per = new Map()
  for (const file of serverFiles) {
    const names = new Set()
    read(file)
      .split("\n")
      .forEach((line) => {
        for (const pattern of [ENV_READ_DOTTED, ENV_READ_BRACKET_LITERAL]) {
          pattern.lastIndex = 0
          for (const match of line.matchAll(pattern)) {
            if (PATH_SHAPED_NAME.test(match[1])) names.add(match[1])
          }
        }
      })
    per.set(file, names)
  }
  return per
})()

// A COMPUTED `process.env[...]` index resolves to a name no static scan can read.
// Eight modules do that. Not one of them can resolve a STORE path, and the reason
// is the same shape everywhere: the value is immediately fed to `Number(raw)` or
// compared against a provider name, so a filesystem path could not survive the
// line. That is a claim worth recording rather than assuming, so it is recorded
// per module with the evidence, and two staleness checks fail if a module stops
// having a computed read, or if a NEW one appears without an entry.
//
// Round 1 of review asked for both spellings to be covered. Covering the second
// one costs these eight sentences, not a silent gap.
const COMPUTED_ENV_READ_MODULES = {
  "apps/dashboard/server/handlers.mjs":
    "handlers.mjs:1867 - envNum(name) reads process.env[name] then Number(raw) and keeps the value " +
    "only if Number.isFinite(n) && n > 0, so a filesystem path is discarded by the line itself. " +
    "Callers pass tuning scalars (timeouts, thresholds), never a store.",
  "apps/dashboard/server/services/commandCentre/ceremonyGates.mjs":
    "ceremonyGates.mjs:18 - envNumber(name) reads process.env[name] then Number(raw) and rejects " +
    "anything non-finite or non-positive, so only a numeric gate threshold survives. The gate " +
    "values are looked up in ENV_DEFAULTS, which is a numeric table.",
  "apps/dashboard/server/services/commandCentre/perpsGates.mjs":
    "perpsGates.mjs:73 - same envNumber shape as ceremonyGates: the read is fed to Number(raw) and " +
    "rejected unless finite and positive, so it can only ever be a numeric perps-gate scalar.",
  "apps/dashboard/server/services/commandCentre/riskGates.mjs":
    "riskGates.mjs:36 - same envNumber shape: Number(raw) with a finite-and-positive guard, so the " +
    "index cannot resolve a path.",
  "apps/dashboard/server/services/commandCentre/riskState.mjs":
    "riskState.mjs:54 - staleWindowMs() reads process.env[STALE_MS_ENV] then Number(raw) and " +
    "returns null unless the value is finite and positive. STALE_MS_ENV is a module const; the " +
    "store DATA_DIR on the same file is a separate literal PICC_ variable.",
  "apps/dashboard/server/services/copytrade/leaderGuard.mjs":
    "leaderGuard.mjs:8 - envNumber(name, fallback) reads process.env[name] then Number(raw), " +
    "falling back when the value is absent or empty. Numeric tuning scalars only.",
  "apps/dashboard/server/services/spreadFeedSeam.mjs":
    "spreadFeedSeam.mjs:48 - the index is not really computed: SPREAD_PROVIDER_ENV is an exported " +
    "module const whose literal value is PICC_SPREAD_FEED_PROVIDER (spreadFeedSeam.mjs:9). The " +
    "name is therefore knowable, and it selects a provider rather than a path.",
  "apps/dashboard/server/services/venues/hyperliquidPerps.mjs":
    "hyperliquidPerps.mjs:116 - envNumber(key) reads process.env[key] then Number(raw), and the " +
    "only keys it is ever called with are the five numeric entries in ENV_DEFAULTS " +
    "(hyperliquidPerps.mjs:75-81). A path is not a number, so it could not be honoured."
}

/** Computed-read sites whose file has no entry in the table above. */
function unaccountedComputedEnvReaders() {
  const unaccounted = []
  for (const site of COMPUTED_ENV_READS) {
    const file = site.split(":")[0]
    if (Object.prototype.hasOwnProperty.call(COMPUTED_ENV_READ_MODULES, file)) continue
    unaccounted.push(site)
  }
  return unaccounted
}

/** Entries whose file no longer has a computed read at all. */
function staleComputedEnvReadEntries() {
  const withComputed = new Set(COMPUTED_ENV_READS.map((site) => site.split(":")[0]))
  return Object.keys(COMPUTED_ENV_READ_MODULES).filter((file) => !withComputed.has(file))
}

// THE DELIBERATE DECISION ABOUT `server/__tests__/`, which round 1 of review
// flagged as an unexamined exclusion.
//
// They are NOT scanned as server modules - a test file legitimately ASSIGNS store
// variables, and folding that into the coverage claim would make the claim
// meaningless. They ARE scanned by a different rule: every path-shaped PICC_ name
// a test file READS must be on the contract or reasoned. That is what catches a
// store implemented in a test helper, and it is what would have caught
// `PICC_V32_CONFIG_DATA_DIR` in v32Register.test.mjs as a read rather than leaving
// it to be noticed by hand.
const testFileReads = (() => {
  const per = new Map()
  for (const file of testFiles) {
    if (file === SELF) continue
    const names = new Set()
    read(file)
      .split("\n")
      .forEach((line) => {
        for (const pattern of [ENV_READ_DOTTED, ENV_READ_BRACKET_LITERAL]) {
          pattern.lastIndex = 0
          for (const match of line.matchAll(pattern)) {
            if (PATH_SHAPED_NAME.test(match[1])) names.add(match[1])
          }
        }
      })
    if (names.size > 0) per.set(file, [...names].sort())
  }
  return per
})()

// DETECTOR 2 - which test files assign a store variable themselves?
//
// Three spellings count: `process.env.X = v`, `process.env["X"] = v`, and
// `vi.stubEnv("X", v)`. `delete process.env.X` is deliberately NOT counted: it is
// teardown, and treating honest cleanup as a redirect would make the migration
// path impossible to walk - 91 files delete the variable they set.
function discoverHandRolledRedirects(files, isolation, reader = read) {
  const out = new Map()
  for (const file of files) {
    const text = reader(file)
    const names = new Set()
    for (const m of text.matchAll(/process\.env\.(PICC_[A-Z0-9_]+)\s*=(?!=)/g)) {
      if (isolation.has(m[1])) names.add(m[1])
    }
    for (const m of text.matchAll(/process\.env\[\s*"(PICC_[A-Z0-9_]+)"\s*\]\s*=(?!=)/g)) {
      if (isolation.has(m[1])) names.add(m[1])
    }
    for (const m of text.matchAll(/vi\.stubEnv\(\s*"(PICC_[A-Z0-9_]+)"/g)) {
      if (isolation.has(m[1])) names.add(m[1])
    }
    if (names.size > 0) out.set(file, [...names].sort())
  }
  return out
}

const ISOLATION_SET = new Set(ISOLATION_PATH_VARIABLES)
const HAND_ROLLED = discoverHandRolledRedirects(
  testFiles.filter((f) => f !== SELF),
  ISOLATION_SET
)

// DETECTOR 3 - which tracked test files MUTATE the real store path?
//
// A reference to the real store is legal in a test when it is a READ:
// authTerminalPerfInstrumentation.test.mjs:258-260 reads the real users.json to
// prove the test account is not in it, and that assertion is worth keeping. What
// is never legal is a mutating call aimed at that path. So this is a shape check
// on the line rather than a ban on the string: a real-store reference plus a
// mutating filesystem call is a finding, and the same reference beside a
// reading call is not.
const REAL_STORE_REFERENCE =
  /"server"\s*,\s*"data"|server[/\\]data|"\.\.\/data"|\.\.\/data\//
const MUTATING_FS =
  /\b(writeFileSync|appendFileSync|rmSync|unlinkSync|mkdirSync|renameSync|copyFileSync|writeFile|appendFile|rm|rename|mkdir|cp)\s*\(/

function discoverRealStoreMutations(files, reader = read) {
  const out = []
  for (const file of files) {
    reader(file)
      .split("\n")
      .forEach((line, index) => {
        if (REAL_STORE_REFERENCE.test(line) && MUTATING_FS.test(line)) {
          out.push(`${file}:${index + 1} ${line.trim()}`)
        }
      })
  }
  return out
}

const REAL_STORE_MUTATIONS = discoverRealStoreMutations(
  testFiles.filter((f) => f !== SELF)
)

// DETECTOR 3b - THE ONE THAT CLOSES THE LANDED ATTACK.
//
// WHY IT EXISTS. Round 1 of review executed this against the real store and every
// runtime check reported clean while a file landed in server/data:
//
//     beforeEach(test1)  -> variable at the harness value        OK
//     test body          -> process.env.PICC_AUTH_DATA_DIR = <real store>
//                           writeFileSync(... "ATTACK-PROOF.json")  SUCCEEDED
//     afterEach          -> delete process.env.PICC_AUTH_DATA_DIR   (the 85-file idiom)
//     beforeEach(test2)  -> repaired to the harness value        OK
//     afterAll           -> variable at the harness value        "no problem reported"
//
// The runtime checks sample the variable BEFORE a test body and AFTER a file, and
// a delete-in-afterEach puts the value back exactly where the sampler expects to
// find it. No amount of end-state checking fixes that, because the damage is
// already on disk by then. Five stores re-read `process.env` per call
// (connectors.mjs:272, ewallet.mjs:39, v32Config.mjs:65, chartPrefs.mjs:25,
// riskGates.mjs:44), so a mid-test reassignment genuinely MOVES the store rather
// than being ignored by a module that captured it at import.
//
// So the rule is at the SOURCE and it is STATIC: a store-variable assignment
// whose value is the real store is a finding, in the same commit as the
// assignment, with no runtime flake surface. A one-line taint step covers the
// aliased form (`const live = realServerDataDir()` then `= live`).
//
// WHAT IT DOES NOT CLAIM, stated plainly. This catches the REAL STORE, not every
// conceivable wrong value, so the LEGACY_HAND_ROLLED_REDIRECTS inventory can
// still be widened to accommodate a redirect at some other unsuitable path - a
// benign one, since the runtime scratch check rejects anything outside the run
// root and the OS temp dir. What it cannot do any more is accommodate a redirect
// at the live store, because this rule is not an inventory and cannot be
// satisfied by editing one.
const LIVE_STORE_VALUE =
  /server[/\\]data|["'`]\.\.\/data["'`]|realServerDataDir|REAL_SERVER_DATA_DIR|serverDataDir|realStore/

function discoverRealStoreRedirects(files, isolation, reader = read) {
  const out = []
  for (const file of files) {
    const text = reader(file)
    // Pass 1: identifiers this file binds to the live store.
    const tainted = new Set()
    for (const line of text.split("\n")) {
      const decl = line.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/)
      if (decl && LIVE_STORE_VALUE.test(decl[2])) tainted.add(decl[1])
    }
    // Pass 2: a store-variable assignment fed by the live store, directly or by
    // an alias.
    //
    // THREE SPELLINGS, because a detector that covers one of them is a detector
    // with three holes. `process.env.X = v`, `process.env["X"] = v`, and
    // `vi.stubEnv("X", v)` are the same assignment written three ways, and a
    // reviewer's first guess is rarely the only spelling a future author uses.
    // The `(?!=)` guard keeps `==`, `===` and `=>` from reading as an assignment.
    text.split("\n").forEach((line, index) => {
      const target =
        line.match(/process\.env\.(PICC_[A-Z0-9_]+)\s*=(?!=)(.*)$/) ??
        line.match(/process\.env\[\s*["'`](PICC_[A-Z0-9_]+)["'`]\s*\]\s*=(?!=)(.*)$/) ??
        line.match(/vi\.stubEnv\(\s*["'`](PICC_[A-Z0-9_]+)["'`]\s*,\s*(.*?)\s*\)/)
      if (!target || !isolation.has(target[1])) return
      const value = target[2].trim()
      if (LIVE_STORE_VALUE.test(value) || tainted.has(value)) {
        out.push(`${file}:${index + 1} ${line.trim()}`)
      }
    })
  }
  return out
}

const REAL_STORE_REDIRECTS = discoverRealStoreRedirects(
  testFiles.filter((f) => f !== SELF),
  ISOLATION_SET
)

// DETECTOR 4 - stores that WRITE the real data directory with no variable to
// redirect, derived rather than listed.
//
// Round 1 shipped one member of this set (`vault.mjs`) and asserted only
// `> 0` and `< 19`, so a second member was compatible and only a REMOVAL was
// detectable. The set is now SCANNED: a module qualifies when it hardcodes a
// path into the data directory, performs a mutating filesystem call, and reads no
// `PICC_*_DIR` / `PICC_*_FILE` variable at all. `localstore.mjs` is the useful
// negative control - it hardcodes `new URL("../data")` and mutates, but it reads
// PICC_DATA_DIR, so it is correctly not in the set.
const HARDCODED_DATA_PATH =
  /new URL\(\s*"(?:\.\.\/)+data(?:\/|"|')|join\(\s*__dirname\s*,\s*"\.\."\s*,\s*"data"|["'`]\.\.\/data\//
const STORE_VARIABLE_READ =
  /process\.env\.(PICC_[A-Z0-9_]*(?:_DIR|_FILE))|process\.env\[\s*["'`](PICC_[A-Z0-9_]*(?:_DIR|_FILE))/g

function discoverUnredirectableStores(files, reader = read) {
  const out = []
  for (const file of files) {
    const text = reader(file)
    if (!HARDCODED_DATA_PATH.test(text)) continue
    if (!MUTATING_FS.test(text)) continue
    const reads = [...text.matchAll(STORE_VARIABLE_READ)].map((m) => m[1] || m[2])
    if (new Set(reads).size === 0) out.push(file)
  }
  return out.sort()
}

const UNREDIRECTABLE_STORES = discoverUnredirectableStores(serverFiles)

// The prose. The SET above is derived, so adding a third unredirectable store
// fails the guard whether or not anyone remembers to write a sentence about it -
// which is the property round 1 said the list could not have.
const UNREDIRECTABLE_REASONS = {
  "apps/dashboard/server/services/vault.mjs":
    "vault.mjs:31 resolves DEFAULT_DIR to a hardcoded new URL('../data') and honours PICC_VAULT_KEY " +
    "for the KEY MATERIAL only - there is no variable for the directory, so encryptText(text) with no " +
    "dir argument writes picc-vault.key into the real server/data. That is why a real 64-byte " +
    "server/data/picc-vault.key exists. Closing this needs a production PICC_VAULT_DATA_DIR, which is " +
    "out of scope for a test-isolation slice.",
  "apps/dashboard/server/services/browserBridge.mjs":
    "browserBridge.mjs:22 exports BROWSER_DATA_DIR as a hardcoded new URL('../data/browser-profiles') " +
    "with no variable of any kind, and writes through it at :296-304 (mkdirSync + cpSync on import) " +
    "and :344-358 (mkdirSync of the per-profile userDataDir). It reads only PICC_BROWSER_PATH, the " +
    "Chromium binary. So despite .env.example:94 documenting PICC_BROWSER_DATA_DIR as 'browser profile " +
    "persistence', the documented redirect does not reach this module: only browserStudio.mjs:28 reads " +
    "it. This is the vault.mjs class generalised, and it is where a test can still write real " +
    "browser-profile state."
}

// This file names the vocabulary it bans, so it cannot scan itself. Stated as
// data with a reason rather than a bare `!== SELF`, for the same reason
// ws7RegulatoryClaimGuard states its self-exclusion: a filter with no recorded
// reason is indistinguishable from a filter that was widened to pass.
const SELF_EXCLUSIONS = [
  {
    file: SELF,
    reason:
      "This guard names every PICC_ store variable and the mutating-filesystem vocabulary in order " +
      "to ban them, so a scan that included it would find its own detector source. Every other test " +
      "file in the repository is scanned."
  }
]

// THE LEGACY INVENTORY. Eighty-five test files still hand-roll a store redirect.
// They are listed here rather than waved through, because "waved through" is how
// a guard stops being a guard, and because the list is the migration checklist
// made mechanical: the two staleness tests below mean a file cannot silently
// JOIN this set, and a file cannot silently LEAVE it either - migrating a file
// makes its entry stale, which is the prompt to delete the line.
//
// An entry states the EXACT set of variables that file assigns. Exact rather
// than subset is deliberate: if an inventoried file gains one new hand-rolled
// redirect, an exact-match rule catches it and a subset rule would not.
//
// MIGRATED IN SLICE A, and therefore absent below: authStoreWriteFailure,
// authSessionWriter, authStoreFault, authBootstrapGateFailsClosed,
// authTerminalPerfInstrumentation, handlers (the static-import, CRLF file), plus
// v32Register, whose `PICC_V32_CONFIG_DATA_DIR` was a live misspelling - no
// server module reads it; v32Config.mjs:62-68 reads PICC_TRADING_DATA_DIR.
const LEGACY_HAND_ROLLED_REDIRECTS = {
  "apps/dashboard/server/__tests__/accountMetrics.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR"],
  "apps/dashboard/server/__tests__/accountMetricsApi.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR"],
  "apps/dashboard/server/__tests__/alertEngine.test.mjs": ["PICC_ALERTS_DATA_DIR"],
  "apps/dashboard/server/__tests__/alertHandlers.test.mjs": ["PICC_ALERTS_DATA_DIR"],
  "apps/dashboard/server/__tests__/auditRegressions.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/authMeStatus.test.mjs": ["PICC_AUTH_DATA_DIR"],
  "apps/dashboard/server/__tests__/autopilot.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/autopilotRoutes.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/brokers.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/browserInteraction.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_BROWSER_DATA_DIR"],
  "apps/dashboard/server/__tests__/browserLogin.bind.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_BROWSER_DATA_DIR", "PICC_PROFILE_DATA_DIR"],
  "apps/dashboard/server/__tests__/browserStudio.automation.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_BROWSER_DATA_DIR"],
  "apps/dashboard/server/__tests__/browserStudio.goto.test.mjs": ["PICC_BROWSER_DATA_DIR"],
  "apps/dashboard/server/__tests__/browserStudio.login.test.mjs": ["PICC_BROWSER_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/browserStudio.tabSync.test.mjs": ["PICC_BROWSER_DATA_DIR"],
  "apps/dashboard/server/__tests__/browserStudio.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_BROWSER_DATA_DIR"],
  "apps/dashboard/server/__tests__/browserStudio.touch.test.mjs": ["PICC_BROWSER_DATA_DIR"],
  "apps/dashboard/server/__tests__/captureContracts.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR"],
  "apps/dashboard/server/__tests__/captureVenue.test.mjs": ["PICC_BROWSER_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/ccxtAdapter.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/ccxtOrdering.defaultType.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/ccxtOrdering.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/ceremonyGates.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/ceremonyRoute.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR", "PICC_COMMAND_CENTRE_DATA_DIR", "PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/ceremonyState.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/ceremonyVenueUnlock.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/chartPrefs.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/commandCentre.ordersApi.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_AUTOMATOR_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR", "PICC_COMMAND_CENTRE_DATA_DIR", "PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/commandCentre.overviewApi.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR", "PICC_COMMAND_CENTRE_DATA_DIR", "PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/commandCentre.perpsApi.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_AUTOMATOR_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR", "PICC_COMMAND_CENTRE_DATA_DIR", "PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/connectors.test.mjs": ["PICC_CONNECTOR_DATA_DIR"],
  "apps/dashboard/server/__tests__/consentPayloadLock.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_AUTOMATOR_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR", "PICC_COMMAND_CENTRE_DATA_DIR", "PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/convergenceAlerts.test.mjs": ["PICC_ALERTS_DATA_DIR"],
  "apps/dashboard/server/__tests__/credentials.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_AUTOMATOR_DATA_DIR", "PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/csvFeedImport.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/decisionEngine.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/dispatch.test.mjs": ["PICC_DISPATCH_DATA_DIR"],
  "apps/dashboard/server/__tests__/dispatchApi.test.mjs": ["PICC_DISPATCH_DATA_DIR"],
  "apps/dashboard/server/__tests__/dispatchRealtime.test.mjs": ["PICC_DISPATCH_DATA_DIR"],
  "apps/dashboard/server/__tests__/errorLog.test.mjs": ["PICC_ERROR_LOG_FILE"],
  "apps/dashboard/server/__tests__/ewallet.test.mjs": ["PICC_EWALLET_DATA_DIR"],
  "apps/dashboard/server/__tests__/hyperliquidPerps.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/incomeOverview.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_AUTOMATOR_DATA_DIR", "PICC_CONNECTOR_DATA_DIR", "PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/interventions.suiteTrade.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/interventions.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/interventions.tradeGate.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/leaderIdeasRoute.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR", "PICC_COMMAND_CENTRE_DATA_DIR", "PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/leaderIdeasState.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/livePositionManager.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/llmGovernor.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/localstore.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/marketDataBusMerge.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/marketDataBusVerify.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/multiplex.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/newsDigest.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/newsRoutes.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/notificationCenter.test.mjs": ["PICC_NOTIFICATION_DATA_DIR"],
  "apps/dashboard/server/__tests__/notifier.test.mjs": ["PICC_NOTIFICATION_DATA_DIR"],
  "apps/dashboard/server/__tests__/notifierEmailRemoved.test.mjs": ["PICC_NOTIFICATION_DATA_DIR"],
  "apps/dashboard/server/__tests__/notifierStateMigration.test.mjs": ["PICC_NOTIFICATION_DATA_DIR"],
  "apps/dashboard/server/__tests__/packObservers.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/packRegistry.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/packRegistryApi.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/packRunner.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/paperOverviewApi.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/phases1216.test.mjs": ["PICC_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/positionManager.test.mjs": ["PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/profile.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_BROWSER_DATA_DIR", "PICC_PROFILE_DATA_DIR"],
  "apps/dashboard/server/__tests__/profileGoogleState.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_BROWSER_DATA_DIR", "PICC_PROFILE_DATA_DIR"],
  "apps/dashboard/server/__tests__/requireAuthFailsClosed.test.mjs": ["PICC_AUTH_DATA_DIR"],
  "apps/dashboard/server/__tests__/resourceGovernor.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/resourceGovernorApi.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/riskState.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/sessionCaptureSettingsApi.test.mjs": ["PICC_DATA_DIR", "PICC_SESSION_CAPTURE_SETTINGS_FILE"],
  "apps/dashboard/server/__tests__/sessionExpiryGc.test.mjs": ["PICC_AUTH_DATA_DIR"],
  "apps/dashboard/server/__tests__/startupHealth.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_AUTOMATOR_DATA_DIR", "PICC_COMMAND_CENTRE_DATA_DIR", "PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/stripePortal.test.mjs": ["PICC_AUTH_DATA_DIR", "PICC_DATA_DIR", "PICC_PROFILE_DATA_DIR"],
  "apps/dashboard/server/__tests__/tradeJournal.test.mjs": ["PICC_JOURNAL_DATA_DIR"],
  "apps/dashboard/server/__tests__/trading.features.test.mjs": ["PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/trading.test.mjs": ["PICC_TRADING_DATA_DIR"],
  "apps/dashboard/server/__tests__/tradingRealtime.test.mjs": ["PICC_AUTH_DATA_DIR"],
  "apps/dashboard/server/__tests__/watchlist.test.mjs": ["PICC_WATCHLIST_DATA_DIR"],
  "apps/dashboard/server/__tests__/webfetchApi.test.mjs": ["PICC_DATA_DIR"],
  "apps/dashboard/server/__tests__/ws3CeremonySeamGuard.test.mjs": ["PICC_COMMAND_CENTRE_DATA_DIR"],
  "apps/dashboard/server/__tests__/ws4LeaderSourcingSeamGuard.test.mjs": ["PICC_ACCOUNT_METRICS_DATA_DIR", "PICC_AUTH_DATA_DIR", "PICC_CAPTURE_CONFIG_DATA_DIR", "PICC_COMMAND_CENTRE_DATA_DIR", "PICC_DATA_DIR"]
}

// ===========================================================================
// CLAIM 0 - the harness resolves its own root on a FRESH CI CHECKOUT
// ===========================================================================
//
// Round 1 of review found a CI-breaking bug that local runs could not see, which
// is the specific failure mode the `scans TRACKED files only` test below exists to
// prevent - and then this file committed it anyway.
//
// `dashboardRoot()` required BOTH `<cwd>/package.json` AND `<cwd>/server/data`.
// `apps/dashboard/server/data/` is gitignored (`.gitignore:38`) with zero tracked
// files, and `ci.yml` runs checkout -> `npm ci` -> `npm test` with nothing that
// creates it. So on a runner the directory is absent, `existsSync` returned false,
// and all 57 jsdom suites died in `beforeEach` - while the same code passed on a
// developer box, where the directory is full of live data.
//
// The proofs below run against a SYNTHETIC tree so the assertion is about the
// branch, not about what happens to exist on the machine running the suite. A
// check that can only be exercised where the directory already exists is how this
// shipped.
describe("WS-7 slice A - store-isolation guard: the root resolves on a fresh checkout", () => {
  const FIXTURE = mkdtempSync(join(tmpdir(), "picc-root-fixture-"))
  afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }))

  it("has teeth: a CI-shaped tree WITHOUT server/data resolves (the case that broke CI)", () => {
    // package.json present, server/data ABSENT - exactly what a fresh clone is.
    const checkoutShaped = join(FIXTURE, "checkout-shaped")
    mkdirSync(join(checkoutShaped, "server"), { recursive: true })
    writeFileSync(join(checkoutShaped, "package.json"), '{ "name": "@picc/dashboard" }\n', "utf8")
    expect(
      existsSync(join(checkoutShaped, "server", "data")),
      "this fixture must NOT have a data directory, or the test proves nothing"
    ).toBe(false)
    expect(() => resolveDashboardRoot({ moduleUrl: "http://localhost:3000/x.js", cwd: checkoutShaped }))
      .not.toThrow()
    expect(
      resolveDashboardRoot({ moduleUrl: "http://localhost:3000/x.js", cwd: checkoutShaped })
    ).toBe(resolve(checkoutShaped))
  })

  it("resolves a developer-shaped tree WITH server/data, unchanged behaviour", () => {
    const developerShaped = join(FIXTURE, "developer-shaped")
    mkdirSync(join(developerShaped, "server", "data"), { recursive: true })
    writeFileSync(join(developerShaped, "package.json"), '{ "name": "@picc/dashboard" }\n', "utf8")
    expect(resolveDashboardRoot({ moduleUrl: "http://localhost:3000/x.js", cwd: developerShaped })).toBe(
      resolve(developerShaped)
    )
  })

  it("still FAILS on a tree with neither package.json nor server/data", () => {
    // The control. If the check were removed entirely this would pass silently,
    // and a wrong cwd would then make every containment check below vacuous.
    const notTheDashboard = join(FIXTURE, "not-the-dashboard")
    mkdirSync(notTheDashboard, { recursive: true })
    expect(() => resolveDashboardRoot({ moduleUrl: "http://localhost:3000/x.js", cwd: notTheDashboard })).toThrow(
      /cannot locate the apps\/dashboard root/
    )
  })

  it("prefers a real module URL over the cwd, and never consults the filesystem for it", () => {
    // The `file:` branch, which is what the node-environment suites take. Proved
    // with an `exists` spy that THROWS, so any filesystem consultation in this
    // branch would fail the test.
    //
    // The URL is built from a native path rather than written as a literal
    // `file:///repo/...`: on Windows `fileURLToPath` rejects a URL with no drive
    // letter, so a hand-written POSIX URL would have made this test pass on Linux
    // and throw on the machine it was written on.
    const explodes = () => {
      throw new Error("the file: branch must not consult the filesystem")
    }
    const syntheticRoot = join(tmpdir(), "picc-root-probe", "apps", "dashboard")
    const moduleUrl = pathToFileURL(join(syntheticRoot, "testSupport", "storeIsolation.mjs")).href
    expect(resolveDashboardRoot({ moduleUrl, exists: explodes })).toBe(syntheticRoot)
    expect(resolveDashboardRoot({ moduleUrl, exists: explodes, cwd: join(tmpdir(), "picc-elsewhere") })).toBe(
      syntheticRoot
    )
  })

  it("the real store still names a path, whether or not the directory exists", () => {
    // Dropping the existence requirement must not have turned the real store into
    // a vacuous comparison: it is still a concrete path, and containment against a
    // path that does not exist is a string comparison, not a pass.
    const checkoutShaped = join(FIXTURE, "checkout-shaped")
    expect(realServerDataDir({ root: checkoutShaped })).toBe(join(resolve(checkoutShaped), "server", "data"))
    expect(existsSync(realServerDataDir({ root: checkoutShaped }))).toBe(false)
    // And the rule still bites against that path.
    expect(() =>
      assertNotRealStore("PICC_AUTH_DATA_DIR", join(resolve(checkoutShaped), "server", "data", "users.json"), {
        realDir: realServerDataDir({ root: checkoutShaped })
      })
    ).toThrow(/real server data store/)
  })
})

// ===========================================================================
// JUNCTION RESOLUTION - a lexical `resolve` walks straight through one
// ===========================================================================
//
// Round 1 of review: `assertNotRealStore` compared `resolve()`d strings, so
// `<tmp>/auth` with `<tmp>/auth` a junction to the real store PASSED, and the
// module underneath would have written into the live data. Both sides are now
// canonicalised. The fixture is a TEMPORARY stand-in for the real store, so the
// real store is not involved in the test at all.
describe("WS-7 slice A - store-isolation guard: containment follows a junction", () => {
  // STAND_IN plays the part of the live store for this file, so the real store is
  // never involved. A JUNCTION is created that points straight at it, which is the
  // shape a lexical `resolve` walks through without noticing.
  const STAND_IN = mkdtempSync(join(tmpdir(), "picc-standin-store-"))
  const LINK_PARENT = mkdtempSync(join(tmpdir(), "picc-link-parent-"))
  const link = join(LINK_PARENT, "auth")
  let linked = false
  beforeAll(() => {
    try {
      symlinkSync(STAND_IN, link, "junction")
      linked = true
    } catch {
      // A filesystem without junction support. The test below fails loudly in
      // that case rather than passing vacuously, because a containment rule that
      // cannot be exercised is not a containment rule.
    }
  })
  afterAll(() => {
    rmSync(STAND_IN, { recursive: true, force: true })
    rmSync(LINK_PARENT, { recursive: true, force: true })
  })

  it("rejects a value that reaches the live store THROUGH a junction", () => {
    expect(linked, "this platform must support junction creation for the test to mean anything").toBe(true)
    expect(
      () => assertNotRealStore("PICC_AUTH_DATA_DIR", link, { realDir: STAND_IN }),
      "a junction pointing at the live store must be rejected, not resolved away"
    ).toThrow(/real server data store/)
  })

  it("rejects a value that reaches INTO the live store through a junction", () => {
    // The nested shape, which a one-level realpath would also miss.
    const nested = join(link, "users.json")
    expect(() => assertNotRealStore("PICC_AUTH_DATA_DIR", nested, { realDir: STAND_IN })).toThrow(
      /real server data store/
    )
  })

  it("a genuinely scratch path in the same parent directory is still fine", () => {
    const scratch = join(LINK_PARENT, "scratch")
    mkdirSync(scratch, { recursive: true })
    expect(() => assertNotRealStore("PICC_AUTH_DATA_DIR", scratch, { realDir: STAND_IN })).not.toThrow()
  })

  it("still tolerates a path that does not exist yet, which a realpath alone would reject", () => {
    // handlers.test.mjs and v32Register.test.mjs rmSync their scratch directory in
    // afterEach and leave process.env pointing at a path that is gone. canonicalize
    // resolves the deepest EXISTING ancestor for exactly this reason, so a dangling
    // value is still comparable rather than throwing.
    const gone = join(tmpdir(), "picc-never-existed-abcdef", "auth")
    expect(() => assertNotRealStore("PICC_AUTH_DATA_DIR", gone, { realDir: STAND_IN })).not.toThrow()
  })
})
describe("WS-7 slice A - store-isolation guard: the contract covers every store the server reads", () => {
  it("actually scans the server sources, so the coverage claim cannot be vacuous", () => {
    // A discovery rule that stopped reaching the server would leave every other
    // test in this file green on an empty set. The floor counts MODULES, not
    // findings, so a rule matching nothing at all could not clear it.
    expect(serverFiles.length, "the scan must reach the server sources").toBeGreaterThan(80)
    expect(serverFiles.every((f) => f.endsWith(".mjs"))).toBe(true)
  })

  it("excludes the gitignored nested worktree of another branch", () => {
    expect(
      allTracked.some((f) => f.startsWith(".freebuff/worktrees/")),
      ".freebuff/worktrees/ is another branch's working state and must never be scanned"
    ).toBe(false)
  })

  it("never reads the live store, because the scan set is tracked files only", () => {
    // `server/data` is gitignored, so `git ls-files` cannot name it. This is the
    // assertion that keeps the guard read-only with respect to real data: the
    // scan has no path by which to reach the developer's accounts and tokens.
    expect(serverFiles.some((f) => f.startsWith("apps/dashboard/server/data/"))).toBe(false)
  })

  it("finds a substantial, non-trivial set of store path variables", () => {
    // A floor, not an echo. A count of 0 or 1 would mean the detector is broken;
    // a count equal to the size of the contract would mean the contract is only
    // mirroring the detector, which is the shape of a tautology.
    expect(DISCOVERED.size, "the detector must find the real store variables").toBeGreaterThanOrEqual(15)
    expect(DISCOVERED.size, "and must not simply echo the contract it is checking")
      .toBeLessThan(ISOLATION_PATH_VARIABLES.length * 2)
  })

  it("covers EVERY discovered store path variable", () => {
    const uncovered = [...DISCOVERED.entries()]
      .filter(([name]) => !ISOLATION_PATH_VARIABLES.includes(name))
      .filter(([name]) => !Object.prototype.hasOwnProperty.call(NON_STORE_PICC_PATH_VARIABLES, name))
      .map(([name, sites]) => `${name} (read at ${sites[0]})`)
    expect(
      uncovered,
      "A PICC_ variable the server reads to resolve a writable path that is not on the shared " +
        "contract is a store no test can redirect, so a test that redirects its siblings still " +
        "writes into the real server/data. Either add it to testSupport/storeIsolation.mjs, or - if " +
        "it is read-only fixture input rather than a store - record it in NON_STORE_PICC_PATH_VARIABLES " +
        "with a reason. Either way the decision is now made explicitly instead of by omission."
    ).toEqual([])
  })

  it("gives every non-store entry a written reason and a live read", () => {
    for (const [name, reason] of Object.entries(NON_STORE_PICC_PATH_VARIABLES)) {
      expect(
        DISCOVERED.has(name),
        `NON_STORE entry ${name} is stale: no server module reads it as a path any more`
      ).toBe(true)
      expect(typeof reason, "a non-store entry must carry a written reason").toBe("string")
      expect(reason.trim().length, "a bare marker is not a reason").toBeGreaterThan(60)
    }
  })

  it("keeps the non-store set a small minority of the contract", () => {
    // If most discovered variables were excused, the coverage rule would be
    // hollow. Two is the honest number today, and the ratio is what detects a
    // future author excusing their way out of the contract.
    const nonStore = Object.keys(NON_STORE_PICC_PATH_VARIABLES).length
    expect(nonStore / (ISOLATION_PATH_VARIABLES.length + nonStore)).toBeLessThan(0.2)
  })

  it("covers PICC_ERROR_LOG_FILE, which neither harness listed before this slice", () => {
    // errorLog.mjs:31 reads this and defaults to <repo>/picc-errors.log, and
    // initErrorLog() TRUNCATES that file. The Playwright harness was safe only
    // because it sets PICC_ERROR_LOG=0, which disables the logger before the
    // path is ever consulted - so a directory-redirection-only reading of "the
    // e2e helper covers every store" was false, and this is the variable it
    // missed.
    expect(ISOLATION_PATH_VARIABLES).toContain("PICC_ERROR_LOG_FILE")
    expect(ISOLATION_PATH_VARIABLE_KINDS.get("PICC_ERROR_LOG_FILE")).toBe("file")
    expect(DISCOVERED.has("PICC_ERROR_LOG_FILE")).toBe(true)
  })

  it("covers every per-service store the reviewer showed can be redirected independently", () => {
    // The five the review named, pinned positively. A store list that lost a
    // member would still satisfy the coverage test above as long as the server
    // stopped reading it, so the members are pinned as things that MUST be there.
    for (const name of [
      "PICC_AUTH_DATA_DIR",
      "PICC_TRADING_DATA_DIR",
      "PICC_ALERTS_DATA_DIR",
      "PICC_WATCHLIST_DATA_DIR",
      "PICC_JOURNAL_DATA_DIR"
    ]) {
      expect(ISOLATION_PATH_VARIABLES, `${name} must stay on the contract`).toContain(name)
      expect(ISOLATION_PATH_VARIABLE_KINDS.get(name), `${name} must be a directory store`).toBe("directory")
    }
  })

  it("has teeth: a NEW server store read is reported as uncovered", () => {
    // The anti-regrowth demonstration, run against a SYNTHETIC source set. No
    // file is added to the repository and nothing is written anywhere: the
    // detector is a pure function over text, and this is the text.
    const PLANTED = {
      "apps/dashboard/server/services/plantedStore.mjs":
        'const DATA_DIR = process.env.PICC_PLANTED_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))\n'
    }
    const reader = (file) => PLANTED[file]
    const discovered = discoverServerPathVariables(Object.keys(PLANTED), reader).found
    expect([...discovered.keys()]).toEqual(["PICC_PLANTED_DATA_DIR"])
    const uncovered = [...discovered.keys()].filter(
      (name) =>
        !ISOLATION_PATH_VARIABLES.includes(name) &&
        !Object.prototype.hasOwnProperty.call(NON_STORE_PICC_PATH_VARIABLES, name)
    )
    expect(
      uncovered,
      "a store the contract does not know about must be reported, or a new per-service store can be " +
        "added with no test able to redirect it"
    ).toEqual(["PICC_PLANTED_DATA_DIR"])
  })

  it("has teeth: a new store read on a line that builds no path is still caught", () => {
    // The multi-line form the name rule exists for: `const DATA_DIR =` on one
    // line, the read on the next, with no path call anywhere near it.
    const source = 'const DATA_DIR =\n  process.env.PICC_PLANTED_TWO_DATA_DIR || "fallback"\n'
    const discovered = discoverServerPathVariables(["x.mjs"], () => source).found
    expect(discovered.has("PICC_PLANTED_TWO_DATA_DIR")).toBe(true)
  })

  it("has teeth: a store named something other than *_DATA_DIR is still caught", () => {
    // The line rule exists for this. A store whose variable is called
    // PICC_SOMETHING_LOCATION is invisible to a name-only detector.
    const source = 'const ROOT = process.env.PICC_SOMETHING_LOCATION || join(base, "store")\n'
    const discovered = discoverServerPathVariables(["x.mjs"], () => source).found
    expect(discovered.has("PICC_SOMETHING_LOCATION")).toBe(true)
  })

  it("has teeth: a scalar flag on a path-free line is not mistaken for a store", () => {
    // The other half of the line rule. If this fired, the author of the next
    // feature flag would be pushed to add a nonsense non-store entry.
    const source = 'const enabled = process.env.PICC_RESOURCE_GOVERNOR === "on"\n'
    const discovered = discoverServerPathVariables(["x.mjs"], () => source).found
    expect(discovered.size).toBe(0)
  })

  it("has teeth: a store read through BRACKET notation is caught", () => {
    // Round 1 of review: the scan only matched `process.env.NAME`, while the
    // repository already reads `process.env["NAME"]` elsewhere. A store
    // introduced through that door was invisible to this scan AND to the
    // staleness test - two ways of not looking.
    const dotted = discoverServerPathVariables(["x.mjs"], () => 'const D = process.env.PICC_A_DATA_DIR\n').found
    const bracketed = discoverServerPathVariables(["x.mjs"], () => 'const B = process.env["PICC_B_DATA_DIR"]\n').found
    expect(dotted.has("PICC_A_DATA_DIR")).toBe(true)
    expect(bracketed.has("PICC_B_DATA_DIR")).toBe(true)
  })

  it("has teeth: a COMPUTED env read is recorded, because its name is unknowable", () => {
    const discovery = discoverServerPathVariables(["x.mjs"], () => "const v = process.env[name]\n")
    expect(discovery.found.size, "a computed index resolves to a name no scan can read").toBe(0)
    expect(discovery.computed, "but the read itself must still be recorded").toEqual(["x.mjs:1"])
  })

  it("accounts for every computed `process.env[...]` read in the server", () => {
    // Six modules do this today, all for scalars or credential templates. Each
    // says why its index cannot resolve a store, and a seventh is a failure
    // rather than a silent widening of the blind spot.
    expect(
      unaccountedComputedEnvReaders(),
      "a module reads process.env[...computed] and has no entry in COMPUTED_ENV_READ_MODULES. Its " +
        "index resolves to a name nobody can check statically: say what it can be, or add a literal " +
        "PICC_ declaration for the store so the default is visible."
    ).toEqual([])
    expect(
      staleComputedEnvReadEntries(),
      "these modules no longer have a computed process.env read, so their explanation is stale. " +
        "Delete the entry, and if the store moved, add the new variable to the contract."
    ).toEqual([])
    for (const [file, reason] of Object.entries(COMPUTED_ENV_READ_MODULES)) {
      expect(serverFiles.includes(file), `${file} must be a tracked server module`).toBe(true)
      expect(reason.trim().length, `${file}: a bare marker is not an explanation`).toBeGreaterThan(60)
    }
  })

  it("covers every path-shaped PICC_ name a TEST FILE reads", () => {
    // The deliberate `__tests__` decision: test files are not scanned as server
    // modules, because a test file legitimately ASSIGNS store variables and
    // folding that into the coverage claim would hollow it. What is checked is
    // the READ side, which is what catches a store implemented in a test helper
    // and what would have caught PICC_V32_CONFIG_DATA_DIR in v32Register.test.mjs.
    const uncovered = [...testFileReads.values()]
      .flat()
      .filter((name) => !ISOLATION_PATH_VARIABLES.includes(name))
      .filter((name) => !Object.prototype.hasOwnProperty.call(NON_STORE_PICC_PATH_VARIABLES, name))
    expect(
      [...new Set(uncovered)],
      "a test file reads a path-shaped PICC_ name that is neither on the contract nor reasoned. A " +
        "name no module reads redirects nothing - that is the round-4 defect."
    ).toEqual([])
  })
})

// ===========================================================================
// CLAIM 2 - no test redirects a store outside the inventoried legacy set
// ===========================================================================
describe("WS-7 slice A - store-isolation guard: no new ad-hoc store redirects", () => {
  it("scans a substantial set of test files", () => {
    expect(testFiles.length, "the scan must reach the whole vitest suite").toBeGreaterThan(200)
  })

  it("scans TRACKED files only, and says so, because that is what CI checks out", () => {
    // A scan that walked the filesystem would also pick up editor backups and
    // scratch copies, and - on a developer machine mid-change - this guard's own
    // uncommitted edits. `git ls-files` is the same set CI sees, so a local green
    // and a pipeline green mean the same thing. The cost is that a genuinely new,
    // still-untracked test file is not scanned until it is added; the guard runs
    // in the pipeline, where everything is tracked, so that window closes there.
    expect(testFiles.every((f) => allTracked.includes(f))).toBe(true)
    expect(testFiles.every((f) => !f.startsWith(EXCLUDED_PREFIXES[0]))).toBe(true)
  })

  it("finds no hand-rolled redirect outside the inventoried legacy set", () => {
    const unlisted = [...HAND_ROLLED.keys()].filter((file) => !LEGACY_HAND_ROLLED_REDIRECTS[file])
    expect(
      unlisted.map((file) => `${file}: ${HAND_ROLLED.get(file).join(", ")}`),
      "Redirect a store through useIsolatedStoreDir() from testSupport/storeIsolation.mjs instead of " +
        "assigning process.env by hand. The helper mints the directory, asserts it is not the real " +
        "store, and REFUSES a variable name the contract does not know - so a typo through the helper " +
        "fails loudly instead of redirecting nothing."
    ).toEqual([])
  })

  it("has no stale inventory entry: a migrated file must be removed from the list", () => {
    // The anti-rot direction. Without this, migrating a file would leave its line
    // behind and the next migration would have no way to tell migrated files
    // from forgotten ones - which is how an inventory becomes a comment.
    const stale = Object.keys(LEGACY_HAND_ROLLED_REDIRECTS).filter((file) => !HAND_ROLLED.has(file))
    expect(
      stale,
      "these files no longer hand-roll a redirect, so their inventory entry is stale. Delete the " +
        "line - the migration is the proof it is no longer needed."
    ).toEqual([])
  })

  it("states the EXACT variable set for every inventoried file", () => {
    const drifted = Object.entries(LEGACY_HAND_ROLLED_REDIRECTS)
      .filter(([file, names]) => {
        const found = HAND_ROLLED.get(file)
        return !found || JSON.stringify(found) !== JSON.stringify([...names].sort())
      })
      .map(
        ([file, names]) =>
          `${file}: listed ${names.join(", ")} | found ${(HAND_ROLLED.get(file) || []).join(", ")}`
      )
    expect(
      drifted,
      "An exact-set rule, not a subset rule: if an inventoried file gains one new hand-rolled " +
        "redirect this fails, which a subset check would not catch."
    ).toEqual([])
  })

  it("cannot grow: the inventory and the discovered set are the same size", () => {
    expect(
      Object.keys(LEGACY_HAND_ROLLED_REDIRECTS).length,
      "the inventory must match the discovered set exactly - no additions without a decision"
    ).toBe(HAND_ROLLED.size)
  })

  it("has teeth: a fresh hand-rolled redirect is reported as unlisted", () => {
    const FILE = "apps/dashboard/server/__tests__/planted.test.mjs"
    const SOURCE = [
      'process.env.PICC_AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), "picc-"))',
      'vi.stubEnv("PICC_TRADING_DATA_DIR", dir)',
      'process.env["PICC_WATCHLIST_DATA_DIR"] = dir',
      "delete process.env.PICC_JOURNAL_DATA_DIR"
    ].join("\n")
    const found = discoverHandRolledRedirects([FILE], ISOLATION_SET, () => SOURCE)
    expect(found.get(FILE)).toEqual([
      "PICC_AUTH_DATA_DIR",
      "PICC_TRADING_DATA_DIR",
      "PICC_WATCHLIST_DATA_DIR"
    ])
    expect(
      [...found.keys()].filter((file) => !LEGACY_HAND_ROLLED_REDIRECTS[file]),
      "a new hand-rolled redirect must be reported"
    ).toEqual([FILE])
  })

  it("has teeth: teardown is not mistaken for a redirect", () => {
    // The rule that makes the migration path walkable. Eighty-plus files delete
    // the variable they set in afterEach; if that counted as a redirect, the
    // inventory could never shrink and the guard would be a dead end.
    const source = "delete process.env.PICC_AUTH_DATA_DIR\nif (x) process.env.PICC_AUTH_DATA_DIR = y\n"
    const found = discoverHandRolledRedirects(["x.test.mjs"], ISOLATION_SET, () => source)
    expect(found.get("x.test.mjs")).toEqual(["PICC_AUTH_DATA_DIR"])
  })

  it("has teeth: neither real misspelling this repository has used reads as an isolated store", () => {
    // Both spellings that have actually been written by mistake here:
    // PICC_AUTH_STORE_DIR - recorded in
    // authTerminalPerfInstrumentation.test.mjs:250 as the round-4 mistake - and
    // PICC_V32_CONFIG_DATA_DIR, which v32Register.test.mjs:48 was still setting
    // as of this slice while v32Config.mjs:62-68 reads PICC_TRADING_DATA_DIR.
    // Neither is on the contract, so neither reads as a redirect, and that is
    // the whole point: a name no module reads redirects nothing.
    for (const typo of ["PICC_AUTH_STORE_DIR", "PICC_V32_CONFIG_DATA_DIR"]) {
      const found = discoverHandRolledRedirects(["x.test.mjs"], ISOLATION_SET, () => `process.env.${typo} = dir\n`)
      expect(found.size, `${typo} redirects nothing, so it must not read as an isolated store`).toBe(0)
      expect(ISOLATION_PATH_VARIABLES, `${typo} must not be on the contract`).not.toContain(typo)
    }
  })

  it("has teeth: the shared helper refuses a misspelled variable outright", () => {
    // The migration path's own teeth. A typo written through the helper throws
    // at the point of the mistake, which is strictly earlier than the static
    // scan and impossible to miss, rather than falling through `|| default`.
    expect(() => useIsolatedStoreDir("PICC_AUTH_DAT_DIR", { prefix: "picc-typo" })).toThrow(/not a known PICC store variable/)
    expect(() => useIsolatedStoreDir("PICC_AUTH_STORE_DIR", { prefix: "picc-typo" })).toThrow(/not a known PICC store variable/)
    expect(() => useIsolatedStoreDir("PICC_V32_CONFIG_DATA_DIR", { prefix: "picc-typo" })).toThrow(
      /not a known PICC store variable/
    )
    // And a real name is accepted, with a realpath'd directory that is not the
    // live store. Nothing is left behind: the throw above happens before mkdtemp.
    const dir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR", { prefix: "picc-guard-selftest" })
    expect(typeof dir).toBe("string")
    expect(() => assertNotRealStore("PICC_AUTH_DATA_DIR", dir)).not.toThrow()
    rmSync(dir, { recursive: true, force: true })
  })

  it("has teeth: aiming a store at the real server/data is rejected", () => {
    // The exact shape a reviewer demonstrated: redirect PICC_AUTH_DATA_DIR, then
    // let another store fall through to its default. Asserted on a string, never
    // by performing the write.
    expect(() => assertNotRealStore("PICC_AUTH_DATA_DIR", join(REPO_ROOT, "apps/dashboard/server/data"))).toThrow(
      /real server data store/
    )
    expect(() =>
      assertNotRealStore("PICC_AUTH_DATA_DIR", join(REPO_ROOT, "apps/dashboard/server/data/users.json"))
    ).toThrow(/real server data store/)
    expect(() => assertNotRealStore("PICC_AUTH_DATA_DIR", join(tmpdir(), "picc-safe"))).not.toThrow()
  })

  it("catches a same-length typo too, not only the round-4 shape", () => {
    // Round 1 of review verified that `PICC_DATA_DIRR` was SILENT: the shape
    // predicate was anchored on `$`, so it caught `PICC_AUTH_DAT_DIR` (wrong in
    // the middle) and missed `PICC_DATA_DIRR` (one character too long). A
    // trailing typo is the same defect as a middle typo.
    expect(looksLikeIsolationPathName("PICC_AUTH_DAT_DIR"), "the round-4 shape").toBe(true)
    expect(looksLikeIsolationPathName("PICC_DATA_DIRR"), "a trailing typo is the same defect").toBe(true)
    expect(looksLikeIsolationPathName("PICC_ERROR_LOG_FILENAME")).toBe(true)
    expect(looksLikeIsolationPathName("PICC_VAULT_KEY"), "a scalar is not a path").toBe(false)
    expect(looksLikeIsolationPathName("PICC_SIGNAL_ENGINE")).toBe(false)
  })

  it("names the contract's one deliberate blind spot", () => {
    // Minor 3 of round 1: the blind spot belongs in the header, not only in a
    // review comment. Nothing in the server honours a non-`PICC_` store variable
    // today, and rather than leave that as a comment this test makes the boundary
    // a checked list - see NON_PICC_PATH_ENVIRONMENT_VARIABLES.
    const serverNames = new Set()
    const bracketNames = new Set()
    for (const file of serverFiles) {
      for (const line of read(file).split("\n")) {
        for (const m of line.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) serverNames.add(m[1])
        // The bracket spelling is the under-served one, so every non-PICC_ name in
        // it has to be recorded whether or not it looks like a path. That is what
        // catches `ProgramFiles(x86)`, a real directory that no shape test matches.
        for (const m of line.matchAll(/process\.env\[\s*["'`]([^"'`[\]]+)["'`]\s*\]/g)) {
          bracketNames.add(m[1])
        }
      }
    }
    const unrecorded = [
      ...[...serverNames].filter((name) => !name.startsWith("PICC_")).filter(looksLikeIsolationPathName),
      ...[...bracketNames].filter((name) => !name.startsWith("PICC_"))
    ].filter((name) => !(name in NON_PICC_PATH_ENVIRONMENT_VARIABLES))
    expect(
      [...new Set(unrecorded)].sort(),
      "the server reads a path-shaped env var that is neither PICC_-prefixed nor recorded in " +
        "NON_PICC_PATH_ENVIRONMENT_VARIABLES, so every prefix-keyed rule in this file is blind to it. " +
        "Add a PICC_ variable for that store, or record it with the reason it does not need one."
    ).toEqual([])
    expect(
      Object.keys(NON_PICC_PATH_ENVIRONMENT_VARIABLES).length,
      "the list is a boundary, not a dumping ground: two entries is the honest number today"
    ).toBe(2)
    for (const [name, reason] of Object.entries(NON_PICC_PATH_ENVIRONMENT_VARIABLES)) {
      expect(
        serverNames.has(name) || bracketNames.has(name),
        `${name} is recorded but no longer read by the server`
      ).toBe(true)
      expect(reason.trim().length, `${name}: a bare marker is not a boundary record`).toBeGreaterThan(80)
    }
  })

  it("enforces the shared containment rule, not just the real-store rule", () => {
    // Round 1: `assertContainedPath` was imported into the vitest setup,
    // re-exported from it, and NEVER CALLED - so the vitest harness enforced a
    // weaker policy than the Playwright harness it claims to share. It is now
    // invoked in the setup's `beforeEach` for every value the harness itself owns,
    // where "inside the run root" is a guarantee rather than an assumption.
    //
    // Asserted here on the function itself, because the call site is the setup
    // file and a test cannot observe another file's hooks: if the setup stopped
    // calling it, this test would still pass - which is why the reasoning above
    // is load-bearing and this is a shape check, not the enforcement.
    const ROOT = mkdtempSync(join(tmpdir(), "picc-contained-"))
    try {
      mkdirSync(join(ROOT, "auth"), { recursive: true })
      expect(() => assertContainedPath(ROOT, "PICC_AUTH_DATA_DIR", join(ROOT, "auth"), "directory")).not.toThrow()
      expect(() =>
        assertContainedPath(ROOT, "PICC_AUTH_DATA_DIR", join(ROOT, "..", "escape"), "directory", "vitest isolation")
      ).toThrow(/resolves outside the vitest isolation root/)
      // The root itself is not "inside" the root: a store pointed at the run root
      // would put every per-service file in one shared directory, which is exactly
      // the cross-store contamination the per-service list exists to prevent.
      expect(() => assertContainedPath(ROOT, "PICC_AUTH_DATA_DIR", ROOT, "directory", "vitest isolation")).toThrow(
        /resolves outside the vitest isolation root/
      )
    } finally {
      rmSync(ROOT, { recursive: true, force: true })
    }
  })

  it("excludes only this guard, and says why", () => {
    expect(SELF_EXCLUSIONS.map((e) => e.file)).toEqual([SELF])
    for (const exclusion of SELF_EXCLUSIONS) {
      expect(exclusion.reason.trim().length, "a bare marker is not an exclusion").toBeGreaterThan(60)
    }
  })
})

// ===========================================================================
// CLAIM 3 - no test writes to the real store
// ===========================================================================
describe("WS-7 slice A - store-isolation guard: no test mutates the real server/data", () => {
  it("finds no mutating filesystem call aimed at the real store", () => {
    expect(
      REAL_STORE_MUTATIONS,
      "apps/dashboard/server/data is gitignored and untracked: a write there cannot be undone by " +
        "git, restored from history, or reviewed in a diff. Point the store at a temp directory, or " +
        "use useIsolatedStoreDir() from testSupport/storeIsolation.mjs. A READ aimed at the real " +
        "store is fine and is not reported - authTerminalPerfInstrumentation.test.mjs legitimately " +
        "reads the real users.json to prove the test account is not in it, and that assertion is " +
        "worth keeping."
    ).toEqual([])
  })

  it("has teeth: a write aimed at the real store is reported", () => {
    const line = 'writeFileSync(join(process.cwd(), "server", "data", "users.json"), raw, "utf8")\n'
    const found = discoverRealStoreMutations(["x.test.mjs"], () => line)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("x.test.mjs:1")
  })

  it("has teeth: a READ aimed at the real store is not reported", () => {
    // The control that stops this check from becoming a blanket ban on a string.
    // Without it, the next author would delete the round-4 regression assertion
    // rather than the guard - which is the usual way a guard stops being one.
    const line = 'const real = existsSync(realStore) ? readFileSync(realStore, "utf8") : ""\n'
    const found = discoverRealStoreMutations(["x.test.mjs"], () => 'const realStore = new URL("../data/users.json", import.meta.url)\n' + line)
    expect(found).toEqual([])
  })

  it("has teeth: the async mutating calls are caught, not just the sync ones", () => {
    // An earlier draft of MUTATING_FS named only the `*Sync` forms, which would
    // have let `await writeFile(...)` aimed at the live store through. Both
    // families are asserted, because both exist in this repository.
    for (const call of ["await writeFile(p, raw)", "rmSync(p, { force: true })", "await rename(a, b)"]) {
      const line = `${call} // ${join("server", "data")}\n`
      expect(
        discoverRealStoreMutations(["x.test.mjs"], () => line),
        `${call} aimed at the real store must be reported`
      ).toHaveLength(1)
    }
  })

  it("reaches the files that assert the real store is untouched", () => {
    // Pinned positively: if discovery stopped covering the suites whose whole
    // point is "the real store was not written", this guard would report clean
    // on an empty scan - the exact "coverage read as coverage" failure.
    const GUARDED = [
      "apps/dashboard/server/__tests__/authTerminalPerfInstrumentation.test.mjs",
      "apps/dashboard/server/__tests__/leaderIdeasState.test.mjs"
    ]
    expect(GUARDED.filter((f) => !testFiles.includes(f)), "these files must stay in the scan set").toEqual([])
  })

  it("finds NO store-variable assignment aimed at the real store", () => {
    // This is the rule that closes the landed attack, and the one place the
    // LEGACY_HAND_ROLLED_REDIRECTS inventory cannot help: it is a scan, so a
    // wrong value cannot be accommodated by adding a line to a list.
    expect(
      REAL_STORE_REDIRECTS,
      "A test assigns a store variable to the REAL server/data directory. The runtime checks " +
        "cannot catch this on their own: the delete-in-afterEach idiom that 85 files use puts the " +
        "variable back exactly where the sampler expects it, so every end-state check reports clean " +
        "while the file is already on disk - which is how the round-1 attack landed. Point the store " +
        "at a scratch directory, or use useIsolatedStoreDir()."
    ).toEqual([])
  })

  it("has teeth: the EXACT teardown-idiom attack is reported", () => {
    // The reviewer's sequence, verbatim, proved by construction. NO write is
    // performed and no file is created: the detector is a pure function over the
    // text of a test file, and this is that text.
    const FILE = "apps/dashboard/server/__tests__/plantedAttack.test.mjs"
    const SOURCE = [
      'import { join } from "node:path"',
      'import { writeFileSync } from "node:fs"',
      'const REPO_ROOT = process.cwd()',
      "",
      'it("writes into the live store and then tidies up", () => {',
      '  process.env.PICC_AUTH_DATA_DIR = join(REPO_ROOT, "apps/dashboard/server/data")',
      '  writeFileSync(join(process.env.PICC_AUTH_DATA_DIR, "ATTACK-PROOF.json"), "{}", "utf8")',
      "  delete process.env.PICC_AUTH_DATA_DIR",
      "})"
    ].join("\n")
    const found = discoverRealStoreRedirects([FILE], ISOLATION_SET, () => SOURCE)
    expect(
      found.length,
      "the attack shape - assign the real store, write, then delete the variable in teardown - must " +
        "produce exactly one finding, at the assignment, before any test runs"
    ).toBe(1)
    // Asserted by location and by the variable it names, not by byte-matching the
    // source line: a 1-indexed "line 6" that points at the assignment is the claim
    // that matters, and it survives reindenting this fixture.
    const [finding] = found
    const parts = finding.match(/^(.*?):(\d+):?\s*(.*)$/)
    expect(parts, `finding must be "file:line text", got ${JSON.stringify(finding)}`).not.toBeNull()
    const [, file, lineText, text] = parts
    expect(file).toBe(FILE)
    expect(Number(lineText), "the finding must point at the ASSIGNMENT on source line 6, not the write on 7").toBe(
      6
    )
    expect(text).toMatch(/^process\.env\.PICC_AUTH_DATA_DIR\s*=/)
  })

  it("has teeth: the attack is caught in all THREE assignment spellings", () => {
    // The reviewer's sequence used the dotted form. These are the same write
    // spelled two other ways, and a guard that only knows the first spelling is a
    // guard with two holes in it.
    const FILE = "apps/dashboard/server/__tests__/plantedSpellings.test.mjs"
    const LIVE = 'join(REPO_ROOT, "apps/dashboard/server/data")'
    const cases = [
      ["dotted", `process.env.PICC_AUTH_DATA_DIR = ${LIVE}`],
      ["bracket double", `process.env["PICC_AUTH_DATA_DIR"] = ${LIVE}`],
      ["bracket single", `process.env['PICC_AUTH_DATA_DIR'] = ${LIVE}`],
      ["vi.stubEnv", `vi.stubEnv("PICC_AUTH_DATA_DIR", ${LIVE})`]
    ]
    for (const [label, line] of cases) {
      const found = discoverRealStoreRedirects([FILE], ISOLATION_SET, () => line)
      expect(found, `the ${label} spelling must be caught`).toHaveLength(1)
      expect(found[0]).toContain("PICC_AUTH_DATA_DIR")
    }
  })

  it("has teeth: an EQUALITY test is not mistaken for an assignment", () => {
    // The `(?!=)` guard. Without it, `if (process.env.PICC_AUTH_DATA_DIR === x)`
    // reads as an assignment and the guard cries wolf on ordinary code.
    for (const line of [
      'if (process.env.PICC_AUTH_DATA_DIR === "server/data") return',
      'const same = process.env.PICC_AUTH_DATA_DIR === other',
      "handler(() => process.env.PICC_AUTH_DATA_DIR)"
    ]) {
      expect(discoverRealStoreRedirects(["x.test.mjs"], ISOLATION_SET, () => line), line).toEqual([])
    }
  })

  it("has teeth: the attack is caught even when the path is aliased first", () => {    const FILE = "apps/dashboard/server/__tests__/plantedAlias.test.mjs"
    const SOURCE = [
      'import { realServerDataDir } from "../../testSupport/storeIsolation.mjs"',
      "const live = realServerDataDir()",
      'process.env.PICC_TRADING_DATA_DIR = live',
      "delete process.env.PICC_TRADING_DATA_DIR"
    ].join("\n")
    expect(discoverRealStoreRedirects([FILE], ISOLATION_SET, () => SOURCE)).toHaveLength(1)
  })

  it("has teeth: the OLD Claim-3 detector reports NOTHING for the attack, which is why it was needed", () => {
    // The control that explains the new rule's existence rather than asserting it
    // works. Run the previous detector on the same planted source: the assignment
    // line carries no mutating-filesystem call, so it is invisible. This is not a
    // contrivance - it is the measurement the reviewer took, reproduced here so the
    // next person does not "simplify" the new rule back into the old one.
    const SOURCE = [
      'process.env.PICC_AUTH_DATA_DIR = join(REPO_ROOT, "apps/dashboard/server/data")',
      'delete process.env.PICC_AUTH_DATA_DIR'
    ].join("\n")
    expect(
      discoverRealStoreMutations(["x.test.mjs"], () => SOURCE),
      "the mutating-fs detector genuinely cannot see this shape"
    ).toEqual([])
    expect(
      discoverRealStoreRedirects(["x.test.mjs"], ISOLATION_SET, () => SOURCE),
      "which is why a separate rule was added"
    ).toHaveLength(1)
  })

  it("has teeth: an honest scratch redirect is NOT reported", () => {
    // The false-positive control. Every one of the 85 inventoried files assigns
    // from a scratch directory; the whole corpus scans clean, and this is the
    // representative shape.
    const FILE = "apps/dashboard/server/__tests__/honest.test.mjs"
    const SOURCE = [
      'import { mkdtempSync } from "node:fs"',
      'import { tmpdir } from "node:os"',
      'const dir = mkdtempSync(join(tmpdir(), "picc-honest-"))',
      "process.env.PICC_AUTH_DATA_DIR = dir",
      "delete process.env.PICC_AUTH_DATA_DIR"
    ].join("\n")
    expect(discoverRealStoreRedirects([FILE], ISOLATION_SET, () => SOURCE)).toEqual([])
  })
})

// ===========================================================================
// CLAIM 4 - the stores that CANNOT be redirected, DERIVED rather than listed
// ===========================================================================
//
// The set comes from the scan above (`UNREDIRECTABLE_STORES`), not from a list, so
// a THIRD such store fails this guard whether or not anyone remembers to write a
// sentence about it. `assert(count > 0)` could not do that: it is compatible with
// one member or five, so round 1 of review was right that only a removal was
// detectable. What is written down here is the PROSE, and the staleness test
// below fails if a reason outlives the file it describes, or if a derived file has
// no reason at all.
describe("WS-7 slice A - store-isolation guard: the unredirectable stores are derived", () => {
  it("finds the two known stores, and finds them from the code rather than from a list", () => {
    expect(UNREDIRECTABLE_STORES).toContain("apps/dashboard/server/services/vault.mjs")
    expect(UNREDIRECTABLE_STORES).toContain("apps/dashboard/server/services/browserBridge.mjs")
    // The negative control that proves the scan is discriminating rather than
    // matching every hardcoded data path: localstore.mjs hardcodes
    // new URL("../data") and mutates freely, but it reads PICC_DATA_DIR, so it
    // must NOT be reported as unredirectable.
    expect(
      UNREDIRECTABLE_STORES,
      "a module that honours a store variable is redirectable and must not be reported"
    ).not.toContain("apps/dashboard/server/services/localstore.mjs")
  })

  it("keeps the derived set small, and a small set for a stated reason", () => {
    // A bound, not `> 0`. Every store in this repository is redirectable except
    // these two, and each of them needs a production change to fix, so a third is
    // a regression to investigate rather than a routine addition. The number is
    // named rather than derived so that a change to it is a visible decision.
    expect(UNREDIRECTABLE_STORES.length, "a third unredirectable store is a finding, not a chore").toBe(2)
    expect(UNREDIRECTABLE_STORES.length).toBeLessThan(ISOLATION_PATH_VARIABLES.length)
  })

  it("gives every derived store a written reason", () => {
    for (const file of UNREDIRECTABLE_STORES) {
      const reason = UNREDIRECTABLE_REASONS[file]
      expect(reason, `${file} is unredirectable and must be recorded with a reason`).toBeTypeOf("string")
      expect(reason.trim().length, `${file}: a bare marker is not a gap record`).toBeGreaterThan(80)
    }
  })

  it("has no stale reason: a reason must still describe a derived store", () => {
    // The anti-rot direction. If browserBridge gains a directory variable, or
    // vault is deleted, the reason must be removed - which is the prompt to
    // actually close the gap rather than leave a paragraph describing it.
    const stale = Object.keys(UNREDIRECTABLE_REASONS).filter((f) => !UNREDIRECTABLE_STORES.includes(f))
    expect(
      stale,
      "these files are no longer derived as unredirectable, so their reason is stale. Delete it, and " +
        "if the store gained a directory variable, add that variable to the contract instead."
    ).toEqual([])
  })

  it("has teeth: a THIRD unredirectable store is detected", () => {
    // Proven on a synthetic file. No file is added to the repository and nothing
    // is written anywhere.
    const PLANTED = {
      "apps/dashboard/server/services/plantedBridge.mjs": [
        'import { mkdirSync, writeFileSync } from "node:fs"',
        'import { fileURLToPath } from "node:url"',
        'import { join } from "node:path"',
        'const PLANTED_DIR = fileURLToPath(new URL("../data/planted", import.meta.url))',
        "export function save() {",
        "  mkdirSync(PLANTED_DIR, { recursive: true })",
        '  writeFileSync(join(PLANTED_DIR, "planted.json"), "{}", "utf8")',
        "}"
      ].join("\n")
    }
    const reader = (file) => PLANTED[file]
    expect(
      discoverUnredirectableStores(Object.keys(PLANTED), reader),
      "a store that hardcodes the data directory and honours no variable must be detected without " +
        "anyone adding it to a list"
    ).toEqual(["apps/dashboard/server/services/plantedBridge.mjs"])
  })

  it("has teeth: a module that DOES honour a variable is not reported as unredirectable", () => {
    const PLANTED = {
      "apps/dashboard/server/services/plantedWithVar.mjs": [
        'import { mkdirSync } from "node:fs"',
        'const DIR = process.env.PICC_PLANTED_DATA_DIR || "fallback"',
        "export function ensure() { mkdirSync(DIR, { recursive: true }) }"
      ].join("\n")
    }
    const reader = (file) => PLANTED[file]
    expect(discoverUnredirectableStores(Object.keys(PLANTED), reader)).toEqual([])
  })
})
