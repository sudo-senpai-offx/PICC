// Root-level error log for PICC — captures EVERY possible error into a single
// file at the repo root (picc-errors.log). Gated by the PICC_ERROR_LOG env
// flag ("1" = enabled, anything else = disabled).
//
// The file is EMPTIED and rewritten on every launch/relaunch: initErrorLog()
// truncates it and writes a session header, so it always contains exactly one
// run. Entries are JSON-lines (one JSON object per line).
//
// Sources captured:
//   - server console.error / console.warn calls
//   - uncaughtException / unhandledRejection / process warnings
//   - structured log.error(...) calls (via logger.mjs)
//   - browser console + window errors from the web dashboard (via
//     POST /api/client-logs, handled in handlers.mjs) — the Browser Studio
//     window reports through the same route
import { appendFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Repo root = three levels up from this file (apps/dashboard/server/).
const DEFAULT_LOG_FILE = fileURLToPath(new URL("../../../picc-errors.log", import.meta.url))

let initialized = false
let hooksInstalled = false

/** True only when the .env master switch is exactly "1". */
export function errorLogEnabled() {
  return process.env.PICC_ERROR_LOG === "1"
}

function logFilePath() {
  return process.env.PICC_ERROR_LOG_FILE || DEFAULT_LOG_FILE
}

function clampStr(value, max) {
  if (value == null) return ""
  const s = typeof value === "string" ? value : String(value)
  return s.length > max ? s.slice(0, max) + `…[+${s.length - max} chars]` : s
}

/**
 * Append one entry as a JSON line. Never throws — logging must not be able to
 * crash the process it is watching. No-op when the feature flag is off.
 */
export function writeErrorEntry(entry) {
  if (!errorLogEnabled()) return false
  try {
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        ...entry
      }) + "\n"
    appendFileSync(logFilePath(), line, { encoding: "utf8" })
    return true
  } catch {
    // Disk full, permissions, path gone… swallow — a failing logger must
    // never take the app down with it.
    return false
  }
}

// ── WS-7 slice B: the /api/auth/me branch trace ────────────────────────────
// WHY THIS IS NOT writeErrorEntry(). Round 4 gated the /me trace on
// errorLogEnabled(), i.e. on PICC_ERROR_LOG === "1". The e2e harness sets
// PICC_ERROR_LOG = "0" and `e2e/command-centre-order-flow.spec.ts:34` pins
// "1" as a must-reject escape, so no compliant e2e run could ever produce an
// auth-me line. The instrumentation was green, reviewed, committed — and
// unreachable in the only environment that would ever need it.
//
// So the /me trace is ARMED BY A DIFFERENT SIGNAL, not by relaxing that pin:
//
//   - It is armed by PICC_E2E_RUN_ID, which `e2e/helpers/isolatedEnv.mjs` builds
//     into every e2e run. It is set nowhere else — not in dev, not in production —
//     so this is an ALWAYS-ON-in-e2e / DEFAULT-OFF-elsewhere switch, not a
//     diagnostic mode that had to be approved or gated.
//
//     It is NOT what scopes the shared-session cache. `e2e/sharedAuth.ts:40-41`
//     reads PICC_COMMAND_CENTRE_DATA_DIR first, and the Playwright harness always
//     sets that, so the PICC_E2E_RUN_ID branch below it is DEAD in the only harness
//     that sets the variable; it is reachable only from an ad-hoc run that exports
//     neither. The two are unrelated mechanisms that happen to share an env var.
//
//   - It writes to logFilePath() — the SAME PICC_ERROR_LOG_FILE every harness
//     already redirects, because that variable is on the isolation contract and
//     is therefore already guaranteed to be inside the run's own scratch. No new
//     path, no new variable, and no way for this to invent a write location.
//
// COST. One property read and a string-length check when unarmed (every /me on a
// dev box and in production); one ~200-byte synchronous append when armed. /me is
// a few calls per page load, not a hot loop, and a browser-side CPU throttle
// does not stretch a synchronous server-side write, so this cannot inflate the
// terminal-performance numbers the spec measures.
const authMeRunId = () => {
  const run = process.env.PICC_E2E_RUN_ID
  return typeof run === "string" && run.length > 0 ? run : null
}

// ── Path redaction, for the auth-me trace only ──────────────────────────────
// WHY THIS EXISTS. The store-fault branch forwards `err.message`, and
// `AuthStoreUnavailable` interpolates the store's ABSOLUTE path into that message
// (auth.mjs), so the line carried `C:\Users\<name>\...` — a home directory, an OS
// user name and the data layout. The `unhandled` branch forwards an arbitrary
// `err.message` through the same door, and so would any field added later.
//
// The fix is HERE rather than at the two call sites in handlers.mjs for three
// reasons: it is one place, so it cannot be forgotten by the next branch; it covers
// the branches that do not exist yet; and it does not require handlers.mjs to keep
// a line count stable, which a comment beside a call site would.
//
// NOT attacker-reachable — the destination is `PICC_ERROR_LOG_FILE`, already
// redirected inside the run's own scratch, and this writer is armed only by
// PICC_E2E_RUN_ID, which nothing but the e2e harness sets. It is a disclosure to
// fix, not a vulnerability, and the fix is cheap.
//
// THE DIAGNOSIS SURVIVES. `auth store parse failed (C:\...\users.json): …` becomes
// `auth store parse failed (users.json): …`: the file name is the whole value of the
// line, and only the directory goes.
// BOTH lookbehinds are load-bearing, and BOTH were real bugs found by the test that
// pins them. The first: without it, `http://host/x` matches the DRIVE branch at `p:/`
// and comes back mangled. The second: the predecessor set must exclude `/` as well as
// `:`, or the SECOND slash of `//` starts a "path" and eats `localhost`. Without the
// `:` and word characters, `and/or` is an absolute path too. A diagnostic that mangles
// its own text is its own disclosure bug.
const DRIVE_OR_UNC_PATH = /(?<![A-Za-z0-9_])(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`,;:()[\]{}]*/g
const POSIX_ABSOLUTE_PATH = /(?<![A-Za-z0-9_:/])(?:\/(?:[^\s"'`,;:()[\]{}\\]*[\\/])*[^\s"'`,;:()[\]{}\\/]+)/g

const lastPathSegment = (match) => match.split(/[\\/]/).filter(Boolean).pop() ?? match

/**
 * Reduce every absolute path in `text` to its final segment.
 *
 * Exported for the test that pins the "and/or" and URL non-mangling properties, which
 * are the ones a narrower-looking regex silently breaks.
 */
export function redactAbsolutePaths(text) {
  if (typeof text !== "string") return text
  return text.replace(DRIVE_OR_UNC_PATH, lastPathSegment).replace(POSIX_ABSOLUTE_PATH, lastPathSegment)
}

/**
 * Write ONE `src: "auth-me"` line naming the branch that answered /api/auth/me.
 *
 * Deliberately NOT gated on PICC_ERROR_LOG, and deliberately NOT written through
 * writeErrorEntry() — that function's contract is "off unless the master switch
 * says 1", and reusing it is precisely what made round 4's trace unreachable.
 *
 * Every string in the entry is path-redacted before it is written. Never throws.
 * Returns whether a line was written, so a caller can tell a silent run from a
 * broken sink without either of them being fatal.
 */
export function writeAuthMeTrace(entry) {
  try {
    const run = authMeRunId()
    if (run === null) return false
    const serialised = JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      src: "auth-me",
      run,
      ...entry
    })
    appendFileSync(logFilePath(), redactAbsolutePaths(serialised) + "\n", { encoding: "utf8" })
    return true
  } catch {
    return false
  }
}

function formatArgs(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`
      if (typeof a === "object") {
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      }
      return String(a)
    })
    .join(" ")
}

function installHooks() {
  if (hooksInstalled || !errorLogEnabled()) return
  hooksInstalled = true

  // Mirror console.error / console.warn into the file.
  for (const level of ["error", "warn"]) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      try {
        original(...args)
      } catch { /* keep original behavior even if it misbehaves */ }
      writeErrorEntry({
        source: "server",
        channel: `console.${level}`,
        message: clampStr(formatArgs(args), 4000)
      })
    }
  }

  // Crash-level events.
  process.on("uncaughtException", (err) => {
    writeErrorEntry({
      source: "server",
      channel: "uncaughtException",
      message: clampStr(err?.message ?? String(err), 2000),
      stack: clampStr(err?.stack ?? "", 8000)
    })
  })
  process.on("unhandledRejection", (reason) => {
    writeErrorEntry({
      source: "server",
      channel: "unhandledRejection",
      message: clampStr(reason instanceof Error ? reason.message : String(reason), 2000),
      stack: reason instanceof Error ? clampStr(reason.stack ?? "", 8000) : undefined
    })
  })
  process.on("warning", (warning) => {
    writeErrorEntry({
      source: "server",
      channel: "process.warning",
      message: clampStr(`${warning.name}: ${warning.message}`, 2000),
      stack: clampStr(warning.stack ?? "", 4000)
    })
  })
}

/**
 * Called once per process launch (prod server AND vite dev middleware).
 * Empties the root-level log file and starts a fresh session, then installs
 * the global error hooks. Safe to call multiple times; respects the flag.
 */
export function initErrorLog() {
  if (initialized) return
  initialized = true
  if (!errorLogEnabled()) return
  try {
    // Empty + rewrite per launch: truncate with a session header line.
    writeFileSync(
      logFilePath(),
      JSON.stringify({
        ts: new Date().toISOString(),
        type: "session",
        event: "launch",
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        cwd: process.cwd()
      }) + "\n",
      { encoding: "utf8" }
    )
  } catch {
    return // unwritable target — stay silent rather than break startup
  }
  installHooks()
}

/** Test-only: clear the once-per-process init guard so a test can relaunch. */
export function _resetErrorLogForTests() {
  initialized = false
}

/**
 * Ingest an error report arriving from a browser/studio client via
 * POST /api/client-logs. Sanitizes and clamps every field before it touches
 * disk. Returns the number of entries persisted.
 */
export function recordClientReport(report = {}) {
  if (!errorLogEnabled()) return 0
  const entries = Array.isArray(report.entries) ? report.entries : [report]
  const reportSource = clampStr(report.source ?? "client", 40)
  const reportContext = clampStr(report.context ?? "", 40)
  let written = 0
  for (const raw of entries.slice(0, 50)) {
    if (!raw || typeof raw !== "object") continue
    const level = ["error", "warn", "info"].includes(raw.level) ? raw.level : "error"
    const message = clampStr(raw.message ?? "", 4000)
    if (!message) continue
    written += writeErrorEntry({
      type: "client",
      source: clampStr(raw.source ?? reportSource, 40),
      context: clampStr(raw.context ?? reportContext, 40),
      level,
      message,
      url: clampStr(raw.url ?? "", 500),
      userAgent: clampStr(raw.userAgent ?? "", 300),
      stack: raw.stack ? clampStr(String(raw.stack), 8000) : undefined,
      clientTs: Number.isFinite(raw.ts) ? new Date(raw.ts).toISOString() : undefined
    })
      ? 1
      : 0
  }
  return written
}
