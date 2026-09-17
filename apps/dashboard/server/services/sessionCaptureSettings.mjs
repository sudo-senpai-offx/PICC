// S6 / T6.2 — PICC-side session-capture kill-switch (owner decision 2026-09-15):
// the dashboard SETTINGS toggle is THE authoritative gate — there is no
// browser-side toggle, so this file is the only switch. Persisted in
// server/data/session-capture-settings.json (gitignored). DEFAULT-ON: absent
// setting = capture allowed (honesty contract — absent is never treated as off).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_FILE = fileURLToPath(new URL("../data/session-capture-settings.json", import.meta.url))

let FILE = process.env.PICC_SESSION_CAPTURE_SETTINGS_FILE || DEFAULT_FILE

// No in-memory cache: the file is ~30 bytes and this is a privacy-critical
// kill switch — every read reflects the on-disk truth (an mtime/Date.now()
// cache could serve a stale `enabled` across two writes in one mtime tick).

function load() {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"))
    return { enabled: raw.enabled === false ? false : true }
  } catch {
    // No file yet (or unreadable) → default-ON. Absent ≠ disabled.
    return null
  }
}

/** Override the settings file path (used by tests). */
export function _setSessionCaptureFile(path) {
  FILE = path
}

/** Kept as a no-op seam for tests that reset state between cases. */
export function _resetSessionCaptureCache() {}

/**
 * Effective PICC-side session-capture state. True = capture allowed;
 * false = PICC killed it.
 * Default true — an unset setting is NEVER treated as off.
 */
export function sessionCaptureEnabled() {
  const cur = load()
  return cur ? cur.enabled : true
}

/**
 * Persist the PICC-side kill-switch. Only a real boolean is accepted — anything
 * else is a programming error (never silently coerced into an "off").
 */
export function saveSessionCaptureSetting(enabled) {
  if (typeof enabled !== "boolean") {
    throw new TypeError("session-capture setting must be a boolean")
  }
  const next = { enabled }
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(next, null, 2), "utf8")
  return JSON.parse(JSON.stringify(next))
}

/**
 * Masked view for the Settings UI. `configured` distinguishes "explicitly set
 * by the user" from "never touched, default-ON" — honesty, never implied off.
 */
export function sessionCaptureSettingsView() {
  const cur = load()
  return { enabled: cur ? cur.enabled : true, configured: Boolean(cur) }
}