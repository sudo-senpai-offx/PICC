import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, readdirSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertContainedPath as assertContainedPathIn,
  ISOLATION_DIRECTORY_VARIABLES as directoryVariables,
  ISOLATION_FILE_VARIABLES as fileVariables,
  ISOLATION_PATH_VARIABLES,
  ISOLATION_PATH_VARIABLE_KINDS as pathVariableKinds
} from "../../testSupport/storeIsolation.mjs"

const helperDir = dirname(fileURLToPath(import.meta.url))
const dashboardDir = resolve(helperDir, "../..")
const isolationBaseDir = join(dashboardDir, ".playwright-tmp")

// The variable list, the kinds map and the containment rule now live in
// `testSupport/storeIsolation.mjs`, because the vitest harness enforces the same
// policy and a second copy is how the class regrows. The POLICY did not move:
// the error strings below are produced by the shared rule with this harness's
// own label, so they are byte-for-byte what they were before the extraction.

export { ISOLATION_PATH_VARIABLES }

export const REQUIRED_ISOLATION_VARIABLES = Object.freeze([
  ...ISOLATION_PATH_VARIABLES,
  "PICC_VAULT_KEY",
  "PICC_ERROR_LOG",
  "PICC_ENV_LOADED",
  // WS-7 slice B. The /api/auth/me branch trace (server/errorLog.mjs
  // `writeAuthMeTrace`) is armed by this variable and by nothing else, so a run
  // that never sets it is silent and a run that does is fully attributed. Before
  // it was a required variable it was absent from every e2e run, which is what
  // made round 4's trace unable to fire AND left `run: null` on the lines it did
  // manage to write somewhere.
  //
  // NOTE THE SHAPE. It is deliberately NOT path-shaped: it is an opaque run
  // label, not a location, and `testSupport/storeIsolation.mjs` would (correctly)
  // treat an unlisted `_DIR`/`_FILE`/`_PATH` name as a misspelled store. It is
  // still required, so a harness that forgot it is a hard throw rather than a
  // silently untraceable run.
  "PICC_E2E_RUN_ID"
])

function mintTmpRoot() {
  const seed = `${process.pid}:${Date.now()}:${randomBytes(24).toString("hex")}`
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 20)
  const tmpRoot = join(isolationBaseDir, hash)
  mkdirSync(tmpRoot, { recursive: true, mode: 0o700 })
  return realpathSync.native(tmpRoot)
}

function assertContainedPath(tmpRoot, name, configuredPath, kind) {
  assertContainedPathIn(tmpRoot, name, configuredPath, kind, "Playwright isolation")
}

function assertVaultFixtureFresh(tmpRoot) {
  const vaultKey = readdirSync(tmpRoot, { recursive: true, withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name === "picc-vault.key")
  if (vaultKey) {
    throw new Error("The Playwright vault fixture must remain fresh; found picc-vault.key in the isolation root")
  }
}

export function assertIsolatedEnv(env, tmpRoot) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error("The Playwright isolation env must be an object")
  }
  if (typeof tmpRoot !== "string" || tmpRoot.length === 0) {
    throw new Error("The Playwright isolation tmp root must be a non-empty path")
  }

  const envKeys = Object.keys(env)
  const missing = REQUIRED_ISOLATION_VARIABLES.filter((name) => !Object.prototype.hasOwnProperty.call(env, name))
  if (missing.length > 0) {
    throw new Error(`Playwright isolation env is missing required variables: ${missing.join(", ")}`)
  }
  if (envKeys.length !== REQUIRED_ISOLATION_VARIABLES.length) {
    throw new Error(`Playwright isolation env must contain exactly ${REQUIRED_ISOLATION_VARIABLES.length} variables`)
  }

  const unexpected = envKeys.filter((name) => !REQUIRED_ISOLATION_VARIABLES.includes(name))
  if (unexpected.length > 0) {
    throw new Error(`Playwright isolation env contains unexpected variables: ${unexpected.join(", ")}`)
  }
  if (env.PICC_ERROR_LOG !== "0") {
    throw new Error("PICC_ERROR_LOG must be exactly 0 for Playwright isolation")
  }
  if (env.PICC_ENV_LOADED !== "1") {
    throw new Error(
      "PICC_ENV_LOADED must be exactly 1 so server/config.mjs cannot load the repository .env " +
        "(which holds real provider + CCXT credentials) into the test server"
    )
  }
  // No credential-bearing venue variable may ever enter the harness map. The child also inherits
  // the parent environment, so assert the parent is clean too — a contaminated parent would defeat
  // the data-dir redirection even with .env loading blocked.
  const credentialVars = Object.keys(env).filter((name) => name.startsWith("PICC_CCXT_"))
  if (credentialVars.length > 0) {
    throw new Error(`Playwright isolation env must not set CCXT credential variables: ${credentialVars.join(", ")}`)
  }
  const inheritedCredentialVars = Object.keys(process.env).filter((name) => name.startsWith("PICC_CCXT_"))
  if (inheritedCredentialVars.length > 0) {
    throw new Error(
      "Refusing to run Playwright isolation: the parent process already exports CCXT credential " +
        `variables (${inheritedCredentialVars.join(", ")}), which the web server would inherit. ` +
        "Unset them before running the e2e suite."
    )
  }
  if (typeof env.PICC_VAULT_KEY !== "string" || !/^[0-9a-f]{64}$/.test(env.PICC_VAULT_KEY)) {
    throw new Error("PICC_VAULT_KEY must be a fresh 32-byte lowercase hex value")
  }
  // The run label has to be a safe, bounded, path-free token. It is used as a
  // directory-name component by e2e/sharedAuth.ts's shared-session cache and as
  // the `run` field on every /me trace line, so a value containing a separator
  // would be a filename-traversal surface and an unbounded one would be a log
  // bloat surface.
  if (
    typeof env.PICC_E2E_RUN_ID !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(env.PICC_E2E_RUN_ID)
  ) {
    throw new Error("PICC_E2E_RUN_ID must be 1-64 characters of [A-Za-z0-9._-]")
  }

  const canonicalRoot = realpathSync.native(resolve(tmpRoot))
  for (const name of ISOLATION_PATH_VARIABLES) {
    const configuredPath = env[name]
    if (typeof configuredPath !== "string" || configuredPath.length === 0) {
      throw new Error(`${name} must be a non-empty path`)
    }
    assertContainedPath(canonicalRoot, name, configuredPath, pathVariableKinds.get(name))
  }

  assertVaultFixtureFresh(canonicalRoot)
  return canonicalRoot
}

function buildIsolatedEnv(tmpRoot) {
  const env = Object.fromEntries(
    directoryVariables.map(([name, directory]) => {
      const dataDir = join(tmpRoot, directory)
      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      return [name, realpathSync.native(dataDir)]
    })
  )
  const settingsDir = join(tmpRoot, "settings")
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 })

  for (const [name, filename] of fileVariables) {
    env[name] = join(settingsDir, filename)
  }

  env.PICC_VAULT_KEY = randomBytes(32).toString("hex")
  env.PICC_ERROR_LOG = "0"
  // The run label. Taken from the isolation root this process just minted, which
  // is already unique per harness load, already inside the repo's own
  // gitignored `.playwright-tmp/`, and already `realpath`'d. That makes it stable
  // across every spec in one `playwright test` invocation — so the whole run's
  // /me lines share a `run` value — and different for the next invocation, so a
  // later run can never inherit an earlier run's label.
  env.PICC_E2E_RUN_ID = basename(ISOLATION_TMP_ROOT)
  // Block the repository `.env` from being loaded into the test server. `server/config.mjs:11-21`
  // calls `process.loadEnvFile()` unless PICC_ENV_LOADED is already set, and `apps/dashboard/.env`
  // holds real provider + CCXT credentials. Playwright MERGES the parent environment with
  // `webServer.env` rather than replacing it, so redirecting the data dirs alone does not make the
  // run credential-free — this flag is what actually does.
  env.PICC_ENV_LOADED = "1"
  return Object.freeze(env)
}

export const ISOLATION_TMP_ROOT = mintTmpRoot()
export const isolatedEnv = buildIsolatedEnv(ISOLATION_TMP_ROOT)
assertIsolatedEnv(isolatedEnv, ISOLATION_TMP_ROOT)
export default isolatedEnv
