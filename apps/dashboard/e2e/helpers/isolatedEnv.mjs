import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, readdirSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const helperDir = dirname(fileURLToPath(import.meta.url))
const dashboardDir = resolve(helperDir, "../..")
const isolationBaseDir = join(dashboardDir, ".playwright-tmp")

const directoryVariables = Object.freeze([
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

const fileVariables = Object.freeze([
  ["PICC_SESSION_CAPTURE_SETTINGS_FILE", "session-capture-settings.json"],
  ["PICC_LLM_SETTINGS_FILE", "llm-settings.json"]
])

const pathVariableKinds = new Map([
  ...directoryVariables.map(([name]) => [name, "directory"]),
  ...fileVariables.map(([name]) => [name, "file"])
])

export const ISOLATION_PATH_VARIABLES = Object.freeze([
  ...directoryVariables.map(([name]) => name),
  ...fileVariables.map(([name]) => name)
])

export const REQUIRED_ISOLATION_VARIABLES = Object.freeze([
  ...ISOLATION_PATH_VARIABLES,
  "PICC_VAULT_KEY",
  "PICC_ERROR_LOG",
  "PICC_ENV_LOADED"
])

function mintTmpRoot() {
  const seed = `${process.pid}:${Date.now()}:${randomBytes(24).toString("hex")}`
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 20)
  const tmpRoot = join(isolationBaseDir, hash)
  mkdirSync(tmpRoot, { recursive: true, mode: 0o700 })
  return realpathSync.native(tmpRoot)
}

function isStrictlyInside(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}

function assertContainedPath(tmpRoot, name, configuredPath, kind) {
  const absolutePath = resolve(configuredPath)
  if (!isStrictlyInside(tmpRoot, absolutePath)) {
    throw new Error(`${name} resolves outside the Playwright isolation root: ${configuredPath}`)
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
  if (!isStrictlyInside(tmpRoot, canonicalPath)) {
    throw new Error(`${name} resolves outside the canonical Playwright isolation root: ${configuredPath}`)
  }
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
