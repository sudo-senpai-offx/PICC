// PICC headless-session capture engine — coverage matrix + capture runner.
//
// Spec: docs/specs/PICC_HEADLESS_CAPTURE_ENGINE.md (Mechanism A/C + T2/T3/T4).

import { readFileSync } from "node:fs"
import { rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
//
// ── What this file is ─────────────────────────────────────────────────────────
//   • CAPTURE_PROFILES is a DATA TABLE, not engine code. "Promote iqoption to
//     full" is a row flip (T11 landed the storageScan hook the row points at),
//     never an engine change — captureVenue and the scheduler read
//     status/capture/via through the accessors on every call.
//   • captureVenue(venueId) is the headless login runner seam. It wires the
//     built capture hooks: ExpertOption — the reference implementation
//     (browserStudio.captureExpertOptionSession, browserStudio.mjs:3579-3655),
//     and IQ Option via the generic fixture-driven storage-scan hook
//     (browserStudio.captureViaStorageScan, browserStudio.mjs:3657+). For EO
//     the browser is already the integrated studio browser: the runner reads
//     the ACTIVE EO tab, it does not re-drive open→fill→submit. Other rows
//     report honestly instead of fabricating a login.
//
// ── Coverage matrix (v2, spec Mechanism C) ───────────────────────────────────
//   full          = login + token capture + metrics ... expertoption (reference,
//                   liveEO) / iqoption (storageScan). v2: iqoption slots in
//                   with the generic hook; a metrics extractor still needs
//                   building (extractVia:[] — absent balance stays null).
//   capture-only  = declared capability; capture hook NOT built yet. Until the
//                   row names capture.storageScan keys (live fixture required),
//                   the runner reports { state:"not-enabled" } — never a
//                   claimed session.
//   catalog-only  = SITE_INDEX presence only (tradingVenues() row exists);
//                   the runner reports { state:"not-enabled" }.
//
// ── Honesty contract ─────────────────────────────────────────────────────────
//   A venue the engine cannot capture is REPORTED, never faked:
//   { state:"needs-credentials" } and { state:"not-enabled" } are the only
//   truthful outcomes until a capture hook exists. Token values never appear
//   in a returned report and are never logged. Guest (logged-out) sessions are
//   reported as such and never saved over a good token.
//
// ── Test seams ───────────────────────────────────────────────────────────────
//   browserStudio/trading/liveEO are imported DYNAMICALLY inside captureVenue,
//   so tests can drive the real reference implementation with the fake-page
//   harness (browserBridge mocked, PICC_BROWSER_DATA_DIR + PICC_TRADING_DATA_DIR
//   pointed at a tmp dir) or vi.mock a single seam. No module-load side effects.

// ---------------------------------------------------------------------
// The matrix — ten venues, kinds mirror PLATFORM_KINDS (browserStudio.mjs:541).
// demoReal stays demo-first everywhere (spec REQ-E): real wallet values may be
// OBSERVED, never selected for trading.
// ---------------------------------------------------------------------
export const CAPTURE_PROFILES = [
  {
    id: "expertoption",
    name: "ExpertOption",
    kind: "binary",
    status: "full",
    demoReal: "demo-first",
    capture: {
      via: "liveEO",
      ref: "browserStudio.captureExpertOptionSession (browserStudio.mjs:3579-3655)",
      hostRe: "expertoption\\.(com|finance)",
      loginPage: "https://app.expertoption.com/",
      note: "Reference implementation, shipped and tested. Reads the venue's OWN EO studio tab (host-matched, never the active tab) session token (cookie/localStorage/sessionStorage scan + 32-hex rank), saves non-guest tokens via trading.saveCredentials, reports guest honestly. No vault username/password needed — the logged-in tab is the credential."
    },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    // T5: which heads consume this venue's metrics. ["ws"] = liveEO's
    // accumulated WS profile frames (accountMetrics.mjs parses them strictly —
    // absent balance stays null, never a fabricated 0). Other venues have no
    // extractor built, so the collector honestly skips them.
    metrics: { extractVia: ["ws"] }
  },
  {
    id: "iqoption",
    name: "IQ Option",
    kind: "binary",
    status: "full",
    demoReal: "demo-first",
    capture: {
      via: "storageScan",
      ref: "browserStudio.captureViaStorageScan (browserStudio.mjs:3657+)",
      // T11 generic storage-scan hook: reads ONLY these exact keys on the
      // venue's tab — nothing invented. `verified:false` = research-log
      // candidate (ssid cookie from reverse-engineered libs, NON-PRIMARY
      // source, docs/headless-capture-venue-research.md); the runtime
      // self-validates: ok only when the cookie truly exists at capture time.
      storageScan: [{ type: "cookie", key: "ssid", verified: false }],
      hostRe: "iqoption\\.com",
      loginPage: "https://iqoption.com/en/login",
      note: "T11: promoted to full via the generic storageScan hook (fixture-driven, exact keys only). Token saved under trading.venueTokens in its OWN file (separate from creds — see trading.mjs) with NO live leg yet: reconnectTriggered stays false. Same T9 first-login gate as EO. HttpOnly keys cannot be read by document.cookie — CDP cookie API needed if ssid proves HttpOnly."
    },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "binance",
    name: "Binance",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "T10 research done (docs/headless-capture-venue-research.md): login/auth VERIFIED (accounts.binance.com/en/login; 2FA/passkeys). API-key balance API documented (metrics-ready). T11 storageScan mechanism READY (captureViaStorageScan) but ZERO documented browser session keys — wire capture.storageScan only after a live fixture names a real key. ToS bans bots/VPN circumvention." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "kucoin",
    name: "KuCoin",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "T10 research done (docs/headless-capture-venue-research.md): login/auth VERIFIED (kucoin.com/login; QR/passkey/2FA). API-key balance API documented (metrics-ready). T11 storageScan mechanism READY (captureViaStorageScan) but ZERO documented browser session keys — wire capture.storageScan only after a live fixture names a real key. Restricted-location list documented." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "okx",
    name: "OKX",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "T10 research done (docs/headless-capture-venue-research.md): login/auth VERIFIED (okx.com/account/login; reCAPTCHA, mandatory 2FA, passkeys). API-key balance API documented (metrics-ready). T11 storageScan mechanism READY (captureViaStorageScan) but ZERO documented browser session keys — wire capture.storageScan only after a live fixture names a real key. US users barred from global product." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "bybit",
    name: "Bybit",
    kind: "derivatives",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "T10 research done (docs/headless-capture-venue-research.md): login/auth VERIFIED (bybit.com/en/login; Google/Apple social; 2FA). API-key balance API documented (metrics-ready); browser session storage UNKNOWN — live fixture gates promotion. KYC mandatory." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "etoro",
    name: "eToro",
    kind: "cfd",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "T10 research done (docs/headless-capture-venue-research.md): login/auth VERIFIED (etoro.com/login; social sign-in + 2FA via official help; 'Keep me logged in 30 days' = persistent session, key undocumented). x-api-key/x-user-key metrics API documented; browser session storage UNKNOWN — live fixture gates promotion. KYC required for API." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "plus500",
    name: "Plus500",
    kind: "cfd",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "T10 research done (docs/headless-capture-venue-research.md): login URL verified (app.plus500.com, JS-only shell — no static form); email/pass + 2FA documented. MOST documentation-silent venue: no retail API, no documented session key, no login signal. Session/metrics require live fixture + client reverse-engineering." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "olymptrade",
    name: "Olymp Trade",
    kind: "binary",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "T10 research done (docs/headless-capture-venue-research.md): login/auth VERIFIED (olymptrade.com/login; 2FA via Google Auth/FB Messenger; demo account; reCAPTCHA). No documented session keys/metrics — storage requires live fixture; no promotion." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "deriv",
    name: "Deriv",
    kind: "binary",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "T10 research done (docs/headless-capture-venue-research.md): MOST VERIFIED venue — OAuth2+PKCE login + documented metrics API (balance WS, wallet REST); OAuth helper keys pkce_code_verifier/oauth_state documented in sessionStorage; definitive session-token key UNKNOWN — live fixture gates promotion. Officially sanctioned automation, API usage limits." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  }
]

const byId = new Map(CAPTURE_PROFILES.map((p) => [p.id, p]))

/** Copy of every profile row (callers mutating the copy can't corrupt the table). */
export function listCaptureProfiles() {
  return CAPTURE_PROFILES.map((p) => structuredClone(p))
}

/** The live profile row for a venue, or null for unknown ids. */
export function getCaptureProfile(venueId) {
  return byId.get(String(venueId || "").toLowerCase()) ?? null
}

/** Venues the refresh job considers "enabled": a capture hook exists (v2: EO + iqoption). */
export function enabledCaptureVenues() {
  return CAPTURE_PROFILES.filter((p) => p.capture?.via)
    .map((p) => p.id)
    .sort()
}

// ---------------------------------------------------------------------
// Session-refresh policy (T4). Pre-T7 this is process-local state with the
// spec's default cadence from the profile rows; T7 replaces the override with
// the per-user prefs file. The job consults this seam, so cadence changes
// never touch scheduler.mjs.
// ---------------------------------------------------------------------
const policyOverrides = new Map() // venueId -> { enabled?: bool, refreshCadenceMs?: number, metricsCadenceMs?: number }
const lastAutoRun = new Map() // venueId -> ts
const lastReports = new Map() // venueId -> report (latest per-venue capture report)
const lastTokenChange = new Map() // venueId -> iso timestamp of the LAST observed token change

// T9 / REQ-E — first-login approval gate. Process-local on purpose: a fresh
// server process asks the human again (the interventions queue is right there).
const firstLoginApproved = new Set() // venueIds the human has approved this process
const loginRejectedAt = new Map() // venueId -> ts of the gate's last rejection
const REJECT_COOLDOWN_MS = 30 * 60 * 1000 // after a rejection: report rejected, re-ask later

const CADENCE_MIN_MS = 60_000
const CADENCE_MAX_MS = 24 * 60 * 60 * 1000

/** Clamp a requested cadence to a sane range; non-numeric → profile default. */
export function clampCadence(ms, fallbackMs) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return Math.max(CADENCE_MIN_MS, Number(fallbackMs) || CADENCE_MIN_MS)
  return Math.min(CADENCE_MAX_MS, Math.max(CADENCE_MIN_MS, n))
}

/**
 * Override per-venue refresh behaviour. Shape:
 * { [venueId]: { enabled?: boolean, refreshCadenceMs?: number, metricsCadenceMs?: number } }.
 * The metrics collector (accountMetrics.mjs) consults this for its cadence
 * gate; T7's per-user prefs file is applied through here at boot + on POST.
 */
export function setHeadlessSessionPolicy(policy = {}) {
  for (const [venueId, cfg] of Object.entries(policy ?? {})) {
    if (!byId.has(venueId)) continue
    const entry = {}
    if (typeof cfg?.enabled === "boolean") entry.enabled = cfg.enabled
    if (cfg?.refreshCadenceMs !== undefined) entry.refreshCadenceMs = clampCadence(cfg.refreshCadenceMs, byId.get(venueId).cadence.tokenMs)
    if (cfg?.metricsCadenceMs !== undefined) entry.metricsCadenceMs = clampCadence(cfg.metricsCadenceMs, byId.get(venueId).cadence.metricsMs)
    if (Object.keys(entry).length) policyOverrides.set(venueId, entry)
    else policyOverrides.delete(venueId)
  }
}

/** Effective refresh cadence for the session job (override > profile default). */
export function refreshCadenceMs(venueId) {
  const profile = byId.get(venueId)
  if (!profile) return null
  const ov = policyOverrides.get(venueId)
  return ov?.refreshCadenceMs ?? profile.cadence.tokenMs
}

/** Effective metrics cadence for the collector (override > profile default). */
export function metricsCadenceMs(venueId) {
  const profile = byId.get(venueId)
  if (!profile) return null
  const ov = policyOverrides.get(venueId)
  return ov?.metricsCadenceMs ?? profile.cadence.metricsMs
}

/** Enabled per policy — default true for every profile with a capture hook. */
export function isVenueEnabled(venueId) {
  const profile = byId.get(venueId)
  if (!profile) return false
  if (!profile.capture?.via) return false
  return policyOverrides.get(venueId)?.enabled ?? true
}

/**
 * T7 — per-user capture config (persisted prefs). The runtime policy seam
 * above is process-global, so v1 stores per-user rows in the file but applies
 * one user's config to the live policy: the "default" user's block at boot,
 * then whichever user POSTs last while the server is running (single-real-user
 * dashboard — documented in the spec). Multi-user keys are preserved on disk.
 */
const CAPTURE_CONFIG_FILE = join(
  process.env.PICC_CAPTURE_CONFIG_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url)),
  "capture-config.json"
)
const canTouchCaptureConfigDisk = () => !isVitestMode() || Boolean(process.env.PICC_CAPTURE_CONFIG_DATA_DIR)

/** Latest user config blocks as loaded off disk at startup (or written live). */
let captureConfigCache = {}

function isVitestMode() {
  return process.env.VITEST === "true"
}

/** The persisted config for one user: { [venueId]: { enabled, refreshCadenceMs, metricsCadenceMs } }. */
export function captureConfigForUser(userId) {
  const uid = String(userId ?? "default")
  return structuredClone(captureConfigCache[uid] ?? {})
}

/**
 * Apply one user's saved config to the live policy seam. The user's persisted
 * block REPLACES the runtime venue policy wholesale — a row the user deleted
 * must stop overriding (e.g. disable → remove row → back to profile default).
 */
function applyUserConfigToPolicy(userId) {
  policyOverrides.clear()
  const cfg = captureConfigForUser(userId)
  const policy = {}
  for (const [venueId, row] of Object.entries(cfg)) {
    if (!row || typeof row !== "object") continue
    const entry = {}
    if (typeof row.enabled === "boolean") entry.enabled = row.enabled
    if (row.refreshCadenceMs !== undefined) entry.refreshCadenceMs = clampCadence(row.refreshCadenceMs, byId.get(venueId)?.cadence.tokenMs ?? CADENCE_MIN_MS)
    if (row.metricsCadenceMs !== undefined) entry.metricsCadenceMs = clampCadence(row.metricsCadenceMs, byId.get(venueId)?.cadence.metricsMs ?? CADENCE_MIN_MS)
    policy[venueId] = entry
  }
  setHeadlessSessionPolicy(policy)
}

/**
 * Replace one user's persisted config and apply it live.
 * @param {string} userId
 * @param {{ [venueId]: { enabled?, refreshCadenceMs?, metricsCadenceMs? } }} rows
 * @returns the sanitized config now persisted for that user.
 */
export async function saveCaptureConfigForUser(userId, rows = {}) {
  const uid = String(userId ?? "default")
  const next = {}
  for (const [venueId, row] of Object.entries(rows ?? {})) {
    if (typeof row !== "object" || row === null) continue
    if (!byId.has(String(venueId || "").toLowerCase())) continue
    const id = String(venueId).toLowerCase()
    const entry = {}
    if (typeof row.enabled === "boolean") entry.enabled = row.enabled
    if (row.refreshCadenceMs !== undefined) entry.refreshCadenceMs = clampCadence(row.refreshCadenceMs, byId.get(id).cadence.tokenMs)
    if (row.metricsCadenceMs !== undefined) entry.metricsCadenceMs = clampCadence(row.metricsCadenceMs, byId.get(id).cadence.metricsMs)
    if (Object.keys(entry).length === 0) continue // nothing but noise — drop the row
    next[id] = entry
  }
  captureConfigCache = { ...captureConfigCache, [uid]: next }
  if (canTouchCaptureConfigDisk()) {
    const tmp = `${CAPTURE_CONFIG_FILE}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(captureConfigCache, null, 2))
    await rename(tmp, CAPTURE_CONFIG_FILE)
  }
  applyUserConfigToPolicy(uid)
  return structuredClone(next)
}

/**
 * Boot-time load of persisted per-user capture config. Guarded by the same
 * env/VITEST rule as feed-mode prefs (liveEO.mjs:76-116): under vitest the file
 * is only read when a test pointed PICC_CAPTURE_CONFIG_DATA_DIR at its own tmp
 * dir — a test run can never mutate the real server's schedule. The "default"
 * user's block (or the only block present) is applied to the live policy right
 * away so the scheduler honors persisted prefs across restarts.
 */
loadCaptureConfigAtBoot()

function loadCaptureConfigAtBoot() {
  if (!canTouchCaptureConfigDisk()) return
  try {
    const parsed = JSON.parse(readFileSync(CAPTURE_CONFIG_FILE, "utf8"))
    if (parsed && typeof parsed === "object") captureConfigCache = parsed
  } catch {
    captureConfigCache = {} // absent or unreadable → pristine profile defaults
  }
  const uid = captureConfigCache["default"] ? "default" : Object.keys(captureConfigCache)[0]
  if (uid) applyUserConfigToPolicy(uid)
}

/** Per-venue refresh state for status surfacing (T8 status endpoint + popup). */
export function headlessSessionStatus() {
  const rows = {}
  for (const p of CAPTURE_PROFILES) {
    const last = lastReports.get(p.id)
    // stale is honest: a venue that CAN capture but never HAS is the stalest
    // possible state; a not-enabled venue is not stale, it's just not enabled;
    // and a run that is faithfully WAITING on the human (pending-approval /
    // rejected) is not stale either — the engine is doing exactly what it
    // should, no capture is due.
    const gateHeld = last && (last.state === "pending-approval" || last.state === "rejected")
    const stale = last
      ? gateHeld
        ? false
        : Date.now() - Date.parse(last.at) > refreshCadenceMs(p.id) * 3
      : Boolean(p.capture?.via)
    rows[p.id] = {
      venueId: p.id,
      name: p.name,
      status: last?.state ?? (p.capture?.via ? "idle" : "not-enabled"),
      reason: last?.state === "error" || last?.state === "not-enabled" ? (last?.reason ?? null) : null,
      lastCaptureAt: last?.at ?? null,
      lastStateAt: last?.at ?? null,
      tokenChangedAt: lastTokenChange.get(p.id) ?? null,
      enabled: isVenueEnabled(p.id),
      refreshCadenceMs: refreshCadenceMs(p.id),
      stale,
      // T13: WHERE the last observation came from — "extension" (the PICC
      // extension on the venue tab in the human's own browser) / "studio" (the
      // studio-browser leg) / null (never captured). Honest provenance: the
      // popup says "via extension" / "via studio browser", never a guessed leg.
      sourceLeg: last?.sourceLeg ?? null
    }
  }
  return rows
}

// ---------------------------------------------------------------------
// T3 — the runner.
// ---------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString()
}

/**
 * T9 / REQ-E — the first-login approval gate, as one helper so the studio leg
 * (captureVenue) and the T13 extension leg (captureSessionFromExtension) can
 * never diverge. Returns { approved: true } when the human has approved this
 * venue's first capture this process, or a full report object to return as-is
 * when the gate is holding (pending-approval / rejected — including the
 * rejection cooldown, which suppresses re-asking for REJECT_COOLDOWN_MS).
 * Expiry of nothing: the approved set is process-local, so a fresh server
 * process asks the human again (the interventions queue is right there).
 */
async function firstLoginGate(profile, at) {
  const venue = profile.id
  if (firstLoginApproved.has(venue)) return { approved: true }
  const { proposeCaptureLogin, captureLoginApproval } = await import("./interventions.mjs")
  const rejectedAt = loginRejectedAt.get(venue) ?? null
  const cooldownActive = rejectedAt !== null && Date.now() - rejectedAt < REJECT_COOLDOWN_MS
  const gate = captureLoginApproval(venue)
  if (gate?.status === "approved") {
    firstLoginApproved.add(venue)
    loginRejectedAt.delete(venue)
    return { approved: true }
  }
  if (cooldownActive) {
    return { state: "rejected", venue, at, reason: `first login for ${venue} was not approved (rejected)` }
  }
  if (gate === null || (gate.status !== "rejected" && gate.status !== "interrupted")) {
    const proposed = proposeCaptureLogin({ venueId: venue, venueName: profile.name })
    return { state: "pending-approval", venue, at, proposalId: proposed.id }
  }
  // Gate decided NO. First run after the decision starts the cooldown and
  // reports it; once the cooldown passes, propose() re-arms the gate and the
  // engine asks again.
  if (rejectedAt === null) loginRejectedAt.set(venue, Date.now())
  if (Date.now() - loginRejectedAt.get(venue) < REJECT_COOLDOWN_MS) {
    return { state: "rejected", venue, at, reason: `first login for ${venue} was not approved (${gate.status})` }
  }
  loginRejectedAt.delete(venue)
  const proposed = proposeCaptureLogin({ venueId: venue, venueName: profile.name })
  return { state: "pending-approval", venue, at, proposalId: proposed.id }
}

/**
 * Shared tail of every successful capture: compare the token that was just
 * saved against what was there before, revive the live leg on a genuine change
 * (T4 flap guard: unchanged → NO restart), and build the report. Used by the
 * studio leg (captureVenue) AND the extension leg (captureSessionFromExtension)
 * so both can never diverge on save/compare/revive semantics. The returned
 * report NEVER carries a token value, regardless of branch.
 */
async function finalizeCapturedToken({ venue, profile, at, before, after, source, sourceLeg, account }) {
  const nextToken = after ?? ""
  const tokenChanged = Boolean(nextToken) && nextToken !== (before ?? "")
  if (tokenChanged) lastTokenChange.set(venue, at) // T8: status surface exposes WHEN (never the value)
  let reconnectTriggered = false
  if (profile.capture.via === "liveEO" && tokenChanged) {
    try {
      const { restartLiveEO } = await import("./liveEO.mjs")
      reconnectTriggered = await restartLiveEO({ force: true })
    } catch (err) {
      return { state: "error", venue, at, reason: `token saved but session revive failed: ${String(err?.message ?? err)}` }
    }
  }
  const report = {
    state: "ok",
    venue,
    at,
    saved: true,
    source: source ?? null,
    sourceLeg: sourceLeg ?? null,
    tokenChanged,
    reconnectTriggered,
    loginApproved: true, // T9: the human approved this venue's first login
    account: account ?? null
  }
  if (profile.capture.via !== "liveEO") report.liveLeg = false // honest: storage-scan venues have no live bridge yet
  return report
}

/**
 * T13 — the EXTENSION leg of venue session capture. The PICC content script
 * runs on every venue tab the human browses (studio browser optional). It
 * reads the venue's configured storage keys + the storage-tier account profile
 * on that tab and relays the observation here over the authenticated localhost
 * channel. This applies the IDENTICAL rules the studio leg runs: profile
 * status → hostRe validation → guest decision → T9 gate → save through the
 * venue's own path → compare/revive via finalizeCapturedToken. sourceLeg
 * "extension" marks the status row so the surface says WHERE it came from.
 *
 * The token value is a transient observation: it is never logged, never echoed
 * (the report has no token), and never written to any extension storage by the
 * content script — the server creds store is the only resting place.
 *
 * @returns {{ state: "ok"|"guest"|"not-enabled"|"pending-approval"|"rejected"|"error", venue, at, ... }}
 */
export async function captureSessionFromExtension({ venueId, token = null, source = null, url = null, account = null }) {
  const report = await captureSessionFromExtensionCore({ venueId, token, source, url, account })
  // The extension leg must surface through the SAME status bookkeeping as the
  // scheduler (headlessSessionRefresh): every observation lands in lastReports
  // (status rows read it), and a REAL capture/guest observation resets the
  // cadence gate so the next scheduler pass does not re-hammer the venue.
  lastReports.set(report.venue, report)
  if (report.state === "ok" || report.state === "guest") lastAutoRun.set(report.venue, Date.now())
  return report
}

/** The rule body — separated so the recording wrapper above is the only writer of session state. */
async function captureSessionFromExtensionCore({ venueId, token = null, source = null, url = null, account = null }) {
  const venue = String(venueId || "").toLowerCase()
  const profile = byId.get(venue)
  const at = nowIso()
  if (!profile) return { state: "error", venue, at, reason: "unknown venue" }
  if (!profile.capture?.via) {
    return { state: "not-enabled", venue, at, reason: "no capture hook for this venue" }
  }

  // Host validation: the scanner only runs on hosts matching the venue row —
  // this is the server-side re-check so a token can never land for a venue the
  // extension was not actually on.
  if (url) {
    const hostRe = profile.capture?.hostRe ? new RegExp(profile.capture.hostRe, "i") : null
    if (hostRe && !hostRe.test(String(url))) {
      return { state: "error", venue, at, reason: "venue URL does not match the venue row" }
    }
  }

  // Guest sessions are observed, reported, and NEVER saved — same contract as
  // the studio hooks (a guest token must not overwrite an active-account one).
  // The content script derives guest/active from the SAME storage-tier probe
  // the studio hook uses (browserStudio.mjs domLoginSignals storage tier:
  // a profile-shaped value under user|account|... keys ⇒ active, else guest).
  const guest = account && typeof account === "object" && account.guest === true && account.active !== true
  if (guest) {
    return { state: "guest", venue, at, account: sanitizeExtensionAccount(account) }
  }

  let tokenValue = String(token ?? "").slice(0, 4096)
  if (!tokenValue) {
    return { state: "error", venue, at, reason: "no session token observed on the venue tab" }
  }
  // EO tokens may carry a binary prefix before the 32-hex session id — the
  // studio hook extracts the trailing hex run in-page; the extension leg
  // normalizes HERE (server-side, one place) with the exact same patterns.
  if (profile.capture.via === "liveEO") {
    const hex32 = /^[0-9a-f]{32}$/
    const legacy = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}::[A-Za-z0-9+/=_\-]+$/
    const tailHex = /([0-9a-f]{32})$/
    if (!hex32.test(tokenValue) && !legacy.test(tokenValue)) {
      const m = tokenValue.match(tailHex)
      if (m) tokenValue = m[1]
    }
  }

  const gate = await firstLoginGate(profile, at)
  if (gate.state) return gate

  // Save through the venue's OWN path — identical to the studio leg, so the
  // extension can never diverge from where/semantically the token lands.
  let before
  if (profile.capture.via === "liveEO") {
    const { getCredentials, saveCredentials } = await import("./trading.mjs")
    before = (await getCredentials())?.expertoptionToken ?? null
    await saveCredentials({ expertoptionToken: tokenValue })
  } else if (profile.capture.via === "storageScan") {
    const { getVenueToken, saveVenueToken } = await import("./trading.mjs")
    before = await getVenueToken(venue)
    await saveVenueToken(venue, tokenValue)
  } else {
    return { state: "not-enabled", venue, at, reason: `capture via "${profile.capture.via}" not implemented` }
  }

  return finalizeCapturedToken({ venue, profile, at, before, after: tokenValue, source, sourceLeg: "extension", account: sanitizeExtensionAccount(account) })
}

/** Bound the extension-supplied account probe before it rides a report. */
function sanitizeExtensionAccount(account) {
  if (!account || typeof account !== "object") return null
  const guest = account.guest === true && account.active !== true
  // "unknown" = neither proven (the extension cannot read the DOM-tier guest
  // signal — login button/avatar — by construction; unproven is saved, exactly
  // like the studio hook's catch default, browserStudio.mjs:3662-3664).
  const type = guest ? "guest" : account.active === true ? "active" : "unknown"
  return {
    type,
    guest,
    email: typeof account.email === "string" ? account.email.slice(0, 256) : null,
    name: typeof account.name === "string" ? account.name.slice(0, 256) : null,
    wallet: typeof account.wallet === "string" ? account.wallet.slice(0, 32) : null,
    balance: typeof account.balance === "string" ? account.balance.slice(0, 64) : null
  }
}

/**
 * T13 — the exact scan config the extension's content script needs on a venue
 * tab. Key semantics stay server-side ONLY (the studio hooks remain the one
 * place they are defined); this view hands the extension the keys to READ and
 * the host pattern to match. The EO entry mirrors the reference hook's
 * preferred reads (cookie `token` > `tokenDemo` > web-storage mirrors) plus
 * the storage-tier profile-key regex — and is pinned equal to the extension's
 * built-in fallback by extensionIntegrity.test.mjs (built-in = server config).
 * Venues without configured scan keys (binance/kucoin/okx/…) are absent:
 * there is nothing honest to read on their tabs yet.
 */
const EXT_PROFILE_KEYS_RE = "user|account|profile|auth|session|current|me$|identity"

export function extensionCaptureConfigs() {
  return CAPTURE_PROFILES.filter((p) => p.capture?.via && p.capture?.hostRe)
    .map((p) => {
      const cfg = {
        venueId: p.id,
        name: p.name,
        status: p.status,
        enabled: isVenueEnabled(p.id),
        hostRe: p.capture.hostRe,
        loginPage: p.capture.loginPage ?? null,
        profileKeys: EXT_PROFILE_KEYS_RE,
        // The scan MODE the content script must mirror per venue: "liveEO" →
        // the shape-based scan of captureExpertOptionSession; "storageScan" →
        // the exact configured keys of captureViaStorageScan.
        via: p.capture.via
      }
      if (p.capture.via === "liveEO" && p.id === "expertoption") {
        cfg.keys = [
          { type: "cookie", key: "token", verified: true },
          { type: "cookie", key: "tokenDemo", verified: true },
          { type: "localStorage", key: "token", verified: true },
          { type: "sessionStorage", key: "token", verified: true }
        ]
      } else if (Array.isArray(p.capture.storageScan)) {
        cfg.keys = p.capture.storageScan
      }
      return cfg
    })
    .filter((c) => Array.isArray(c.keys) && c.keys.length > 0)
}

/**
 * Headless token capture for one venue.
 *
 * Gate order (token-capture venues — EO liveEO + storageScan):
 *   profile status → [vault gate, ONLY when capture.requiresVaultCreds —
 *   no current row form-fills] → T9 first-login approval (human decides in
 *   the dashboard; browser never touched before that) → host-matched tab
 *   (the venue's OWN open tab, never the active tab; no tab → honest
 *   { state:"no-tab" }, retried next pass) → hook.
 *
 * Hook outcomes mapped by the runner:
 *   - guest (logged-out session)  → { state:"guest" }, token not saved
 *   - saved token                → compare before/after creds; when the
 *     token string CHANGED call restartLiveEO({force:true}) (soft reconnect
 *     preserves buffers — T4 flap guard, mirroring handlers.mjs:1292-1302);
 *     unchanged → NO restart.
 *   - storageScan venues have NO live leg: reconnectTriggered stays false
 *     and the report says liveLeg:false instead of pretending a restart.
 *
 * @returns {{ state: "ok"|"guest"|"needs-credentials"|"not-enabled"|"no-tab"|"error",
 *             venue: string, at: string, ... }} — token value NEVER present,
 *   regardless of branch.
 */
export async function captureVenue(venueId, { page: explicitPage = null } = {}) {
  const venue = String(venueId || "").toLowerCase()
  const profile = byId.get(venue)
  const at = nowIso()
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

  // Vault gate — ONLY for venues whose capture hook form-fills a login
  // (profile.capture.requiresVaultCreds; no current row works that way). The
  // EO (liveEO) and storageScan hooks OBSERVE a session the human already
  // opened in the PICC browser: their real gates are the T9 approval below
  // plus host-matched tab presence, and the hooks themselves refuse guests and
  // token-less pages. The blanket vault gate historically stopped EO cold
  // ("login needed · stale" forever after a manual relog) because no
  // username/password vault entry exists for a venue nobody form-fills.
  if (profile.capture?.requiresVaultCreds) {
    const { getSiteCredentials } = await import("./browserStudio.mjs")
    const creds = await getSiteCredentials(venue)
    if (!creds || !creds.username || !creds.password) {
      return { state: "needs-credentials", venue, at }
    }
  }

  // T9 / REQ-E — first-login approval gate. The FIRST capture of a venue is a
  // human-approval proposal in the interventions queue (source "capture",
  // resolved through the existing respondIntervention endpoint). Until the
  // human approves, the browser is never touched: the runner reports
  // { state: "pending-approval" } (or { state: "rejected" } right after a
  // rejection, with a cooldown before the gate re-asks — the queue is not
  // spammed every refresh pass). Expiry of nothing → the approved state is
  // process-local: a restart re-proposes once. Demo-first + "real wallet
  // observed, never selected" are structural (demoReal:"demo-first" rows and
  // no order/wallet-selection code anywhere in the engine).
  // T9 / REQ-E — first-login approval gate (shared with the T13 extension leg,
  // captureSessionFromExtension: ONE approval per venue per process, both legs
  // respect it). Until the human approves, the incoming observation is reported
  // pending-approval and NOTHING is saved or revived.
  const gate = await firstLoginGate(profile, at)
  if (gate.state) return gate

  // Target the venue's OWN tab by host — never the active tab (the human may
  // be looking at anything; the venue tab sits logged-in in the background).
  // An explicit page (tests / direct callers) is trusted as-is: the hook
  // validates its host. No matching tab → honest no-tab; the next scheduler
  // pass re-tries instead of grabbing an unrelated page.
  const targetPage = await resolveCapturePage(profile, explicitPage)
  if (!targetPage) {
    return {
      state: "no-tab",
      venue,
      at,
      reason: `no ${profile.name} tab in the PICC browser — open ${profile.capture?.loginPage ?? "the venue"} and log in first`
    }
  }

  if (profile.capture.via === "liveEO") {
    const { getCredentials: readTradingCredentials } = await import("./trading.mjs")
    const before = await readTradingCredentials()
    const { captureExpertOptionSession } = await import("./browserStudio.mjs")
    let captured
    try {
      captured = await captureExpertOptionSession(targetPage)
    } catch (err) {
      return { state: "error", venue, at, reason: String(err?.message ?? err) }
    }
    if (captured?.guest) {
      // Logged-out session: the reference implementation already refuses to
      // save it. Report honestly; the existing good token (if any) stays.
      return { state: "guest", venue, at, account: captured.account ?? null }
    }
    const after = await readTradingCredentials()
    return finalizeCapturedToken({
      venue,
      profile,
      at,
      before: before?.expertoptionToken ?? null,
      after: after?.expertoptionToken ?? null,
      source: captured?.source ?? null,
      sourceLeg: "studio",
      account: captured?.account ?? null
    })
  }

  if (profile.capture.via === "storageScan") {
    // T11 — generic fixture-driven capture: browserStudio.captureViaStorageScan
    // reads ONLY the exact keys the row lists in capture.storageScan; a tab
    // without them errors honestly (nothing invented). Tokens land in the
    // dedicated venueTokens store (trading.saveVenueToken) — never in an API
    // response. There is NO live leg for storage-scan venues yet (no WS
    // extractor / bridge built): reconnectTriggered stays false and the report
    // says so explicitly instead of pretending a restart happened.
    const { getVenueToken } = await import("./trading.mjs")
    const before = await getVenueToken(venue)
    const { captureViaStorageScan } = await import("./browserStudio.mjs")
    let captured
    try {
      captured = await captureViaStorageScan(targetPage, { ...profile.capture, venueId: venue, name: profile.name })
    } catch (err) {
      return { state: "error", venue, at, reason: String(err?.message ?? err) }
    }
    if (captured?.guest) {
      // Logged-out session: the hook already refused to save it. Report
      // honestly; the existing good token (if any) stays.
      return { state: "guest", venue, at, account: captured.account ?? null }
    }
    const after = await getVenueToken(venue)
    return finalizeCapturedToken({
      venue,
      profile,
      at,
      before: before ?? null,
      after: after ?? null,
      source: captured?.source ?? null,
      sourceLeg: "studio",
      account: captured?.account ?? null
    })
  }

  return { state: "not-enabled", venue, at, reason: `capture via "${profile.capture.via}" not implemented` }
}

/**
 * Pick the page a capture hook should read. An explicit live page (tests /
 * direct callers) wins and is trusted as-is — the hook validates its host.
 * Otherwise the venue's host pattern (capture.hostRe, e.g. EO
 * "expertoption\\.(com|finance)", IQ "iqoption\\.com") is matched against
 * every tracked live studio tab: the user's open, logged-in venue tab,
 * regardless of which tab is focused. Null → no matching tab exists.
 */
async function resolveCapturePage(profile, page) {
  if (page && typeof page.isClosed === "function" && !page.isClosed()) return page
  const hostRe = profile.capture?.hostRe ? new RegExp(profile.capture.hostRe, "i") : null
  if (!hostRe) return null // no host knowledge → caller must hand us a page
  const { studioLivePages } = await import("./browserStudio.mjs")
  const candidates = await studioLivePages()
  for (const p of candidates ?? []) {
    if (!p || (typeof p.isClosed === "function" && p.isClosed())) continue
    try {
      if (hostRe.test(String(p.url?.() ?? ""))) return p
    } catch {
      /* unreadable url — skip this tab */
    }
  }
  return null
}

/**
 * T4 — one refresh pass over the enabled venues, respecting each venue's
 * cadence. Called by the `headless-session-refresh` scheduler job; returns the
 * per-venue reports for this pass and records them for status surfacing.
 */
export async function headlessSessionRefresh() {
  const reports = []
  const now = Date.now()
  for (const profile of CAPTURE_PROFILES) {
    if (!isVenueEnabled(profile.id)) continue
    const cadenceMs = refreshCadenceMs(profile.id)
    if (now - (lastAutoRun.get(profile.id) ?? 0) < cadenceMs) continue
    const report = await captureVenue(profile.id)
    lastReports.set(profile.id, report)
    reports.push(report)
    // Only a REAL capture (or an observed guest session) counts as "fresh" —
    // an error / needs-credentials / not-enabled run never captured anything,
    // so the next scheduler pass retries instead of waiting a full cadence.
    if (report.state === "ok" || report.state === "guest") {
      lastAutoRun.set(profile.id, now)
    }
  }
  return reports
}

/**
 * Test seam — clears refresh memory so a fresh describe starts at "never run".
 * Not used by the runtime; exported for the engine's unit tests only.
 */
export async function _resetHeadlessSessionState() {
  lastAutoRun.clear()
  lastReports.clear()
  lastTokenChange.clear()
  policyOverrides.clear()
  firstLoginApproved.clear()
  loginRejectedAt.clear()
  try {
    const { _resetCaptureGate } = await import("./interventions.mjs")
    _resetCaptureGate()
  } catch {
    /* interventions unavailable — gate state is test-local anyway */
  }
}

/**
 * Test seam — approve a venue's first login by driving the REAL interventions
 * gate (propose → respondIntervention "approve"), the same path the dashboard
 * uses. Not used by the runtime; exported for the engine's unit tests only
 * (same rule as _resetHeadlessSessionState).
 */
export async function _approveFirstLogin(venueId = "expertoption") {
  const venue = String(venueId || "expertoption").toLowerCase()
  if (firstLoginApproved.has(venue)) return
  const { proposeCaptureLogin, respondIntervention } = await import("./interventions.mjs")
  const gate = proposeCaptureLogin({ venueId: venue, venueName: byId.get(venue)?.name ?? venue })
  await respondIntervention({ id: gate.id, decision: "approve" })
  firstLoginApproved.add(venue)
  loginRejectedAt.delete(venue)
}