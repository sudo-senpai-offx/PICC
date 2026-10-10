// Bookmarklet click-to-capture leg (Wave 3+ backlog, capture-hooks gap).
//
// A `javascript:` snippet the operator saves MANUALLY in their own browser
// (never auto-installed — delivered as a documented snippet + generator
// endpoint, GET /api/trading/bookmarklet-capture) POSTs the current page's
// explicitly-readable DOM snapshot (candles/balances the operator can already
// see) to the requireAuth-guarded ingest route. The route validates through
// the SAME capture-profile validation as the existing hooks: unknown venues
// → honest errors, non-hook venues → the verbatim not-enabled reasons from
// captureProfiles.mjs (compared verbatim in bookmarkletCapture.test.mjs, so
// a reason edit there fails here until both are updated together).
//
// Honesty-first security:
//   • Explicit per-click consent only — the snippet runs when the operator
//     clicks it; there is no background scraping, no timer, no listener.
//     The snippet reads ONLY location/title/visible text (innerText) and
//     never touches document.cookie, storage, inputs, or passwords.
//   • Payload size cap (BOOKMARKLET_MAX_BYTES) — oversize is refused before
//     any store write.
//   • No credential capture — sanitizeBookmarkletSnapshot strips input /
//     password / cookie / token values (proven by the hostile-DOM fixture).
//
// Downstream: happy-path observations are stored via the EXISTING
// account-metrics profile path (putAccountMetrics, sourceLeg "bookmarklet") —
// the same store headless-status and the command-centre overview already
// consume. No new store, no new dependency.

import { getCaptureProfile, sessionPolicyForUser } from "./captureProfiles.mjs"
import { putAccountMetrics } from "./accountMetrics.mjs"

/** Max accepted ingest JSON size. Over-cap → 413 before any store write. */
export const BOOKMARKLET_MAX_BYTES = 128_000

/** Object keys that must never survive ingestion (credential-shaped). */
const SENSITIVE_KEY_RE =
  /passw|passwd|pwd|secret|token|ssid|session|cookie|set-cookie|authori|credential|api[-_ ]?key|private[-_ ]?key/i

/** Cap for any single string value (prevents one giant field). */
const MAX_STRING_CHARS = 16_000

function nowIso() {
  return new Date().toISOString()
}

function truncateString(s) {
  return s.length > MAX_STRING_CHARS ? `${s.slice(0, MAX_STRING_CHARS)}…[truncated]` : s
}

/**
 * Strip credential-shaped values from an operator-posted DOM snapshot.
 * Drops object keys matching SENSITIVE_KEY_RE, drops `inputs` arrays and
 * `value` keys wholesale (form data is never an observation — a `value`
 * beside a `name` is a filled field, and a bare `value` is unlabelled, so
 * keeping either risks keeping a credential), removes <input> elements
 * from html strings, and redacts cookie/token-style assignments in text.
 * Never mutates the input. @returns {{ snapshot, stripped }}.
 */
export function sanitizeBookmarkletSnapshot(snapshot) {
  let stripped = 0
  const cleanValue = (value) => {
    if (typeof value === "string") {
      let out = value
      const inputs = out.match(/<input\b[^>]*>/gi)
      if (inputs) {
        stripped += inputs.length
        out = out.replace(/<input\b[^>]*>/gi, "[input-removed]")
      }
      out = out.replace(
        /((?:cookie|ssid|session|token|password|passwd|secret|authorization)\s*[:=]\s*)([^\s;,}]+)/gi,
        (_m, prefix) => {
          stripped += 1
          return `${prefix}[redacted]`
        }
      )
      return truncateString(out)
    }
    if (Array.isArray(value)) return value.map(cleanValue)
    if (value && typeof value === "object") {
      const out = {}
      for (const [k, v] of Object.entries(value)) {
        if (k === "inputs" || k === "value" || SENSITIVE_KEY_RE.test(k)) {
          stripped += 1
          continue
        }
        out[k] = cleanValue(v)
      }
      return out
    }
    return value
  }
  const snapshotOut = cleanValue(snapshot ?? {})
  return {
    snapshot: snapshotOut && typeof snapshotOut === "object" ? snapshotOut : {},
    stripped
  }
}

/**
 * Validate the raw POST body. @returns {ok:true, venueId, url, snapshot} or
 * {ok:false, error}. Size is checked here AND at the route (413) — the route
 * check runs before validation so an oversize body never reaches the store.
 */
export function validateBookmarkletPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid payload: expected a JSON object" }
  }
  if (JSON.stringify(body).length > BOOKMARKLET_MAX_BYTES) {
    return { ok: false, error: "payload-too-large: over 128KB cap" }
  }
  const venueId = String(body.venueId ?? "").trim().toLowerCase()
  if (!venueId) return { ok: false, error: "venueId required" }
  const url = String(body.url ?? "").trim()
  if (!/^https?:\/\/.+/i.test(url)) return { ok: false, error: "url required (http(s) URL of the captured page)" }
  const snapshot = body.snapshot
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: false, error: "snapshot required (visible DOM snapshot object)" }
  }
  return { ok: true, venueId, url, snapshot }
}

/**
 * Ingest one operator-clicked snapshot.
 *
 * Profile validation mirrors captureVenue's early returns VERBATIM (same
 * strings, same order): unknown venue → error/unknown-venue; catalog-only →
 * not-enabled; capture-only without a hook → not-enabled; no hook → not-enabled.
 * A persisted "rejected" sync decision is honored silently (same reason as the
 * studio leg); any other decision proceeds — the operator's click IS the
 * first-login approval, so no pending-approval proposal is ever raised here.
 *
 * Happy path stores via putAccountMetrics (sourceLeg "bookmarklet") and the
 * report carries NO snapshot values (only counts), so tokens can never leak
 * through a report or log.
 */
export async function ingestBookmarkletCapture({ venueId, url, snapshot, userId } = {}) {
  const venue = String(venueId || "").toLowerCase()
  const at = nowIso()
  const profile = getCaptureProfile(venue)
  if (!profile) return { state: "error", venue, at, reason: "unknown venue" }
  if (profile.status === "catalog-only") {
    return { state: "not-enabled", venue, at, reason: "venue catalog-only — no capture profile enabled (research pending, spec T10)" }
  }
  if (profile.status === "capture-only" && !profile.capture?.via) {
    return { state: "not-enabled", venue, at, reason: "capture hook not built yet (research pending, spec T10)" }
  }
  if (!profile.capture?.via) {
    return { state: "not-enabled", venue, at, reason: "no capture hook for this venue" }
  }

  const uid = String(userId ?? "default")
  const persisted = sessionPolicyForUser(uid)[venue] ?? sessionPolicyForUser("default")[venue]
  if (persisted?.decision === "rejected") {
    return {
      state: "rejected",
      venue,
      at,
      reason: `sync for ${venue} is turned off in Settings (channel catalog → sync mode)`,
      policy: "rejected"
    }
  }

  const body = { venueId: venue, url, snapshot }
  if (JSON.stringify(body).length > BOOKMARKLET_MAX_BYTES) {
    return { state: "error", venue, at, reason: "payload-too-large: over 128KB cap" }
  }
  const { snapshot: clean, stripped } = sanitizeBookmarkletSnapshot(snapshot)
  const record = {
    venueId: venue,
    sourceLeg: "bookmarklet",
    observedAt: at,
    url: String(url ?? ""),
    snapshot: clean,
    stripped
  }
  await putAccountMetrics(uid, record)
  return {
    state: "ok",
    venue,
    at,
    saved: true,
    source: "bookmarklet",
    sourceLeg: "bookmarklet",
    loginApproved: true, // the operator's click is the approval — no gate proposal
    stripped
  }
}

/** Manual-install usage docs served alongside the snippet (never auto-install). */
export const BOOKMARKLET_USAGE = [
  "MANUAL INSTALL (operator action, never automatic):",
  "1. Copy the `snippet` string below.",
  "2. In your browser bookmark manager, create a new bookmark.",
  "3. Paste the snippet as the bookmark URL (it starts with `javascript:`).",
  "4. On the venue page (logged in, balances visible), CLICK the bookmark.",
  "5. The snippet POSTs ONLY the visible text snapshot (title + innerText) to",
  "   /api/trading/bookmarklet-capture with your dashboard session cookies.",
  "Per-click consent: nothing runs until you click; no timers, no listeners,",
  "no background scraping. The snippet never reads cookies, storage, inputs,",
  "or passwords — and the server strips credential-shaped values on ingest."
].join("\n")

/**
 * The documented snippet. Reads ONLY location/title/visible text and POSTs it
 * on click. Must stay free of cookie/storage/input/password access — asserted
 * in bookmarkletCapture.test.mjs.
 */
export function bookmarkletSnippet(endpoint = "/api/trading/bookmarklet-capture") {
  const js = [
    "(function(){",
    "var venueId=prompt('PICC venue?','iqoption');",
    "if(!venueId){return;}",
    "var text=(document.body?document.body.innerText:'').slice(0,8000);",
    "fetch(" + JSON.stringify(endpoint) + ",{",
    "method:'POST',credentials:'include',",
    "headers:{'Content-Type':'application/json'},",
    "body:JSON.stringify({venueId:venueId,url:location.href,",
    "snapshot:{title:document.title,text:text}})",
    "}).then(function(r){return r.json().then(function(j){",
    "alert('PICC bookmarklet: '+(j.report?j.report.state:(j.ok?'ok':'error')));",
    "}).catch(function(){alert('PICC bookmarklet: bad response');});})",
    ".catch(function(){alert('PICC bookmarklet: post failed (log in first?)');});",
    "})()"
  ].join("")
  return `javascript:${js}`
}
