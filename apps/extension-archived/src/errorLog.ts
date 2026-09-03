// Extension-side error capture for PICC (background / content / popup).
//
// Tracks EVERY possible error visible to the extension — uncaught exceptions,
// unhandled promise rejections and console.error/console.warn calls — mirrors
// them to the browser console unchanged, buffers them in chrome.storage.local,
// and ships them to the dashboard's /api/client-logs endpoint, which persists
// them into the root-level picc-errors.log.
//
// The master switch lives in apps/dashboard/.env as PICC_ERROR_LOG ("1" =
// enabled). The server enforces it: reports sent while disabled are answered
// with { disabled: true } and the local buffer is discarded, so a single flag
// controls the whole feature across web app, server and extension.

const BUFFER_KEY = "picc.errorBuffer"
const SETTINGS_KEY = "piccSettings"
const MAX_BUFFER = 100
const FLUSH_INTERVAL_MS = 60_000

export type ErrorContext = "background" | "content" | "popup"

interface ErrorEntry {
  level: "error" | "warn"
  message: string
  stack?: string
  url?: string
  ts: number
}

let installed = false
let context: ErrorContext = "background"
let flushing = false

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

function extractStack(error: unknown): string | undefined {
  return error instanceof Error && error.stack ? error.stack : undefined
}

async function readBuffer(): Promise<ErrorEntry[]> {
  try {
    const { [BUFFER_KEY]: stored } = await chrome.storage.local.get(BUFFER_KEY)
    return Array.isArray(stored) ? (stored as ErrorEntry[]) : []
  } catch {
    return []
  }
}

async function writeBuffer(entries: ErrorEntry[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [BUFFER_KEY]: entries.slice(-MAX_BUFFER) })
  } catch {
    /* storage unavailable — drop */
  }
}

async function enqueue(level: ErrorEntry["level"], parts: unknown[], stack?: string): Promise<void> {
  const message = clamp(parts.map(formatArg).join(" "), 4000)
  if (!message) return
  const entry: ErrorEntry = {
    level,
    message,
    ...(stack ? { stack: clamp(stack, 8000) } : {}),
    url: typeof location !== "undefined" ? location.href.slice(0, 500) : undefined,
    ts: Date.now()
  }
  const buffer = await readBuffer()
  buffer.push(entry)
  await writeBuffer(buffer)
  if (buffer.length >= MAX_BUFFER) void flush()
}

async function backendUrl(): Promise<string> {
  try {
    const { [SETTINGS_KEY]: settings } = await chrome.storage.sync.get(SETTINGS_KEY)
    return ((settings?.backendUrl as string | undefined) ?? "http://localhost:5173").replace(/\/+$/, "")
  } catch {
    return "http://localhost:5173"
  }
}

/** Ship buffered errors to the dashboard server (which owns the log file). */
export async function flush(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const entries = await readBuffer()
    if (entries.length === 0) return
    const payload = JSON.stringify({
      source: "extension",
      context,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : "",
      entries
    })
    let res: Response
    try {
      res = await fetch(`${await backendUrl()}/api/client-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      })
    } catch {
      return // server offline — keep buffering, retry on next flush
    }
    // Delivered, disabled by .env flag, or definitively rejected: discard.
    // Only transient failures (network errors above) keep the buffer.
    await writeBuffer([])
    void res
  } finally {
    flushing = false
  }
}

/**
 * Install the capture hooks for this extension context. Idempotent per
 * module instance (importing background.ts already installs them), but the
 * context label tracks the last caller so reports are tagged correctly.
 * Errors still reach the browser console exactly as before; they are
 * additionally recorded and reported.
 */
export function installErrorLogging(ctx: ErrorContext): void {
  if (!installed) {
    installHooks()
    installed = true
    setTimeout(() => void flush(), 5_000)
    setInterval(() => void flush(), FLUSH_INTERVAL_MS)
  }
  context = ctx
}

function installHooks(): void {
  // Uncaught exceptions + unhandled rejections (both window scopes and the
  // service-worker global scope).
  const globalScope = typeof window !== "undefined" ? window : self
  globalScope.addEventListener("error", (event) => {
    const target = event.target as HTMLElement | null
    if (
      target &&
      target !== (event.currentTarget as EventTarget | null) &&
      !(event.error instanceof Error)
    ) {
      const tag = target.tagName?.toLowerCase() ?? "resource"
      void enqueue("error", [
        `failed to load resource <${tag}>: ${clamp(target.getAttribute("src") ?? target.getAttribute("href") ?? "", 300)}`
      ])
      return
    }
    void enqueue("error", [event.message ?? "unknown error"], extractStack(event.error))
  })
  globalScope.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason as Error | string | null
    void enqueue(
      "error",
      [`unhandled promise rejection: ${reason instanceof Error ? reason.message : clamp(reason ?? "", 500)}`],
      extractStack(reason)
    )
  })

  // Console capture — original behavior preserved, then queued for reporting.
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      const first = args.find((a) => a instanceof Error)
      void enqueue(level, args, extractStack(first))
    }
  }

  // Flush leftovers from previous sessions shortly after startup, then on an
  // interval (best-effort in MV3 service workers).
  setTimeout(() => void flush(), 5_000)
  setInterval(() => void flush(), FLUSH_INTERVAL_MS)
}
