// Browser-side error capture for the PICC dashboard (web app).
//
// When the .env master switch PICC_ERROR_LOG=1 is set, this module tracks
// EVERY possible error visible to the web app and mirrors it both to the
// browser console (unchanged behavior) and to the server, which persists it
// into the root-level picc-errors.log:
//   - window "error" events (uncaught exceptions, resource load failures)
//   - window "unhandledrejection" events
//   - console.error / console.warn calls
// The flag is injected at build time via vite `define` (__PICC_ERROR_LOG__).

declare const __PICC_ERROR_LOG__: boolean

interface ErrorEntry {
  level: "error" | "warn"
  message: string
  stack?: string
  url?: string
  ts: number
}

const MAX_BUFFER = 50
const FLUSH_DELAY_MS = 2000

let installed = false
let buffer: ErrorEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let transportBroken = false

function clamp(value: unknown, max: number): string {
  const s = value == null ? "" : typeof value === "string" ? value : String(value)
  return s.length > max ? s.slice(0, max) + `…[+${s.length - max} chars]` : s
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ""}`
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg)
    } catch {
      return String(arg)
    }
  }
  return String(arg)
}

function queue(level: ErrorEntry["level"], parts: unknown[], stack?: string) {
  if (transportBroken || !installed) return
  const message = clamp(parts.map(formatArg).join(" "), 4000)
  if (!message) return
  buffer.push({
    level,
    message,
    ...(stack ? { stack: clamp(stack, 8000) } : {}),
    url: window.location.href,
    ts: Date.now()
  })
  if (buffer.length >= MAX_BUFFER) void flush()
  else if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS)
}

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (buffer.length === 0) return
  const entries = buffer.splice(0, buffer.length)
  const payload = JSON.stringify({
    source: "web",
    context: "dashboard",
    userAgent: navigator.userAgent.slice(0, 300),
    entries
  })
  try {
    const res = await fetch("/api/client-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    })
    // Server says the feature is disabled (or rejected): stop shipping logs.
    if (res.status === 403 || res.status === 404) transportBroken = true
  } catch {
    // Server unreachable — drop silently; retrying from a dead page adds noise.
    transportBroken = false
  }
}

function extractStack(error: unknown): string | undefined {
  return error instanceof Error && error.stack ? error.stack : undefined
}

/**
 * Install the global capture hooks. Idempotent. No-ops entirely when
 * PICC_ERROR_LOG !== "1" at build time.
 */
export function installErrorLog(): void {
  if (installed) return
  try {
    if (typeof __PICC_ERROR_LOG__ === "undefined" || !__PICC_ERROR_LOG__) return
  } catch {
    return // define not present (e.g. plain node/test context) — stay off
  }
  installed = true

  window.addEventListener("error", (event) => {
    // Resource failures carry a target element instead of an Error object.
    const target = event.target as HTMLElement | null
    if (target && target !== (event.currentTarget as HTMLElement | null) && !(event.error instanceof Error)) {
      const tag = target.tagName?.toLowerCase() ?? "resource"
      queue("error", [`failed to load resource <${tag}>: ${clamp(target.getAttribute("src") ?? target.getAttribute("href") ?? "", 300)}`])
      return
    }
    queue("error", [event.message ?? "unknown error"], extractStack(event.error))
  })

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as Error | string | null
    queue(
      "error",
      [`unhandled promise rejection: ${reason instanceof Error ? reason.message : clamp(reason ?? "", 500)}`],
      extractStack(reason)
    )
  })

  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      const first = args.find((a) => a instanceof Error)
      queue(level, args, extractStack(first))
    }
  }

  window.addEventListener("pagehide", () => {
    void flush()
  })
}
