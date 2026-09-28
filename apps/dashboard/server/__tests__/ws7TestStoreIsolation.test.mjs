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
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ISOLATION_PATH_VARIABLES,
  ISOLATION_PATH_VARIABLE_KINDS,
  NON_STORE_PICC_PATH_VARIABLES,
  assertNotRealStore,
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
const ENV_READ = /process\.env\.(PICC_[A-Z0-9_]+)/g

function discoverServerPathVariables(files, reader = read) {
  const found = new Map()
  for (const file of files) {
    reader(file)
      .split("\n")
      .forEach((line, index) => {
        for (const match of line.matchAll(ENV_READ)) {
          const name = match[1]
          if (!PATH_SHAPED_NAME.test(name) && !PATH_CALL.test(line)) continue
          if (!found.has(name)) found.set(name, [])
          found.get(name).push(`${file}:${index + 1}`)
        }
      })
  }
  return found
}

const DISCOVERED = discoverServerPathVariables(serverFiles)

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
// CLAIM 1 - the contract covers every store the server writes through
// ===========================================================================
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
    const discovered = discoverServerPathVariables(Object.keys(PLANTED), reader)
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
    const discovered = discoverServerPathVariables(["x.mjs"], () => source)
    expect(discovered.has("PICC_PLANTED_TWO_DATA_DIR")).toBe(true)
  })

  it("has teeth: a store named something other than *_DATA_DIR is still caught", () => {
    // The line rule exists for this. A store whose variable is called
    // PICC_SOMETHING_LOCATION is invisible to a name-only detector.
    const source = 'const ROOT = process.env.PICC_SOMETHING_LOCATION || join(base, "store")\n'
    const discovered = discoverServerPathVariables(["x.mjs"], () => source)
    expect(discovered.has("PICC_SOMETHING_LOCATION")).toBe(true)
  })

  it("has teeth: a scalar flag on a path-free line is not mistaken for a store", () => {
    // The other half of the line rule. If this fired, the author of the next
    // feature flag would be pushed to add a nonsense non-store entry.
    const source = 'const enabled = process.env.PICC_RESOURCE_GOVERNOR === "on"\n'
    const discovered = discoverServerPathVariables(["x.mjs"], () => source)
    expect(discovered.size).toBe(0)
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
})

// ===========================================================================
// CLAIM 4 - the stores that CANNOT be redirected, recorded rather than omitted
// ===========================================================================
//
// Why this block exists at all: the vitest setup points every variable in
// ISOLATION_PATH_VARIABLES at a temp root, and the three claims above catch a
// misspelling, a new variable, and a hardcoded real-store path. None of them can
// catch a store the server resolves with NO variable to override - there is
// nothing to point anywhere else. Rather than let that read as full coverage, the
// gap is pinned here with the file that has it and the reason, and a staleness
// test means an entry cannot quietly outlive the defect it describes.
const PINNED_UNREDIRECTABLE_STORES = [
  {
    file: "apps/dashboard/server/services/vault.mjs",
    store: "picc-vault.key",
    reason:
      "vault.mjs:31 resolves DEFAULT_DIR to a hardcoded new URL('../data') and honours " +
      "PICC_VAULT_KEY for the KEY MATERIAL only - there is no variable for the directory, so " +
      "encryptText(text) with no dir argument writes picc-vault.key into the real server/data. " +
      "That is why a real 64-byte server/data/picc-vault.key exists. Closing this needs a " +
      "production change (a PICC_VAULT_DATA_DIR), which is out of scope for a test-isolation " +
      "slice, so it is recorded here instead of being papered over."
  }
]

describe("WS-7 slice A - store-isolation guard: the unredirectable stores are recorded", () => {
  it("records each one against a file that still exists and still hardcodes the store", () => {
    for (const entry of PINNED_UNREDIRECTABLE_STORES) {
      expect(
        serverFiles.includes(entry.file),
        `${entry.file} no longer exists - the unredirectable store it described is either gone or ` +
          "moved, so this entry is stale and must be re-examined"
      ).toBe(true)
      const source = read(entry.file)
      expect(
        source.includes(entry.store),
        `${entry.file} no longer mentions ${entry.store}; if it gained a directory variable, ` +
          "add that variable to the contract and DELETE this entry"
      ).toBe(true)
      expect(
        source.includes('new URL("../data"'),
        `${entry.file} no longer resolves its default to ../data; if it now honours a variable, ` +
          "add it to the contract and delete this entry"
      ).toBe(true)
    }
  })

  it("gives every entry a written reason", () => {
    for (const entry of PINNED_UNREDIRECTABLE_STORES) {
      expect(typeof entry.reason, "a pinned gap must carry a written reason").toBe("string")
      expect(entry.reason.trim().length, "a bare marker is not a gap record").toBeGreaterThan(80)
    }
  })

  it("does not pretend the set is empty when it is not, and does not let it sprawl", () => {
    // Two assertions that pull in opposite directions on purpose. The first
    // stops the block being deleted as "no findings"; the second stops it being
    // used as a dumping ground. One recorded gap is the honest number today.
    expect(
      PINNED_UNREDIRECTABLE_STORES.length,
      "a store with no isolation variable is a real gap; deleting this list must mean it was fixed, " +
        "not that it stopped being looked for"
    ).toBeGreaterThan(0)
    expect(
      PINNED_UNREDIRECTABLE_STORES.length,
      "if most stores are unredirectable the contract is decorative"
    ).toBeLessThan(ISOLATION_PATH_VARIABLES.length)
  })
})
