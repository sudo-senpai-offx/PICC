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
//     into every e2e run (and which `e2e/sharedAuth.ts:41` already uses as a run
//     scope). It is set nowhere else — not in dev, not in production — so this
//     is an ALWAYS-ON-in-e2e / DEFAULT-OFF-elsewhere switch, not a diagnostic
//     mode that had to be approved or gated.
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

/**
 * Write ONE `src: "auth-me"` line naming the branch that answered /api/auth/me.
 *
 * Deliberately NOT gated on PICC_ERROR_LOG, and deliberately NOT written through
 * writeErrorEntry() — that function's contract is "off unless the master switch
 * says 1", and reusing it is precisely what made round 4's trace unreachable.
 *
 * Never throws. Returns whether a line was written, so a caller can tell a
 * silent run from a broken sink without either of them being fatal.
 */
export function writeAuthMeTrace(entry) {
  try {
    const run = authMeRunId()
    if (run === null) return false
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        src: "auth-me",
        run,
        ...entry
      }) + "\n"
    appendFileSync(logFilePath(), line, { encoding: "utf8" })
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
