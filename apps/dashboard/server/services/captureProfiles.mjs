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
//     full" is a row flip (after the T10 research task lands selectors/storage
//     surfaces), never an engine change — captureVenue and the scheduler read
//     status/capture/via through the accessors on every call.
//   • captureVenue(venueId) is the headless login runner seam. v1 wires the
//     ONE built capture hook — ExpertOption, the reference implementation
//     (browserStudio.captureExpertOptionSession, browserStudio.mjs:3579-3655).
//     For EO the browser is already the integrated studio browser: the runner
//     reads the ACTIVE EO tab, it does not re-drive open→fill→submit (the
//     generic login loop is in scope for T10/T11, driven by researched
//     selectors). Non-EO rows report honestly instead of fabricating a login.
//
// ── Coverage matrix (v1, spec Mechanism C) ───────────────────────────────────
//   full          = login + token capture + metrics ... expertoption (reference)
//   capture-only  = declared capability; capture hook NOT built yet. Until the
//                   profile research task (T10) lands, the runner reports
//                   { state:"not-enabled" } — never a claimed session.
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
      note: "Reference implementation, shipped and tested. Reads the active EO studio tab's session token (cookie/localStorage/sessionStorage scan + 32-hex rank), saves non-guest tokens via trading.saveCredentials, reports guest honestly."
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
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "Login/storage UNVERIFIED — T10 research gates enablement." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "binance",
    name: "Binance",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "Spot token capture only (metrics P3). Selectors/storage UNVERIFIED — T10 first." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "kucoin",
    name: "KuCoin",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "Spot token capture only (metrics P3). Selectors/storage UNVERIFIED — T10 first." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "okx",
    name: "OKX",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "Spot token capture only (metrics P3). Selectors/storage UNVERIFIED — T10 first." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "bybit",
    name: "Bybit",
    kind: "derivatives",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "No verified selectors/storage this session — catalog presence only." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "etoro",
    name: "eToro",
    kind: "cfd",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "CFD/social UX unverified; may reuse studioLogin's Google path (browserStudio.mjs:3486-3530) once researched." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "plus500",
    name: "Plus500",
    kind: "cfd",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "No verified selectors/storage this session — catalog presence only." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "olymptrade",
    name: "Olymp Trade",
    kind: "binary",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "No verified selectors/storage this session — catalog presence only." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 },
    metrics: { extractVia: [] }
  },
  {
    id: "deriv",
    name: "Deriv",
    kind: "binary",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "No verified selectors/storage this session — catalog presence only." },
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

/** Venues the refresh job considers "enabled": a capture hook exists (v1: EO). */
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
      stale
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
 * Headless token capture for one venue.
 *
 * v1 flow for `expertoption` (the only row with a `capture.via`):
 *   vault gate (getSiteCredentials) → needs-credentials when missing, NO
 *   capture attempt and NO saveCredentials call (hard constraint, spec
 *   Mechanism A) → delegate to browserStudio.captureExpertOptionSession(page),
 *   the reference implementation, on the ACTIVE studio tab → map the outcome:
 *     - guest (logged-out session)  → { state:"guest" }, token not saved
 *     - saved token                → compare before/after creds; when the
 *       token string CHANGED call restartLiveEO({force:true}) (soft reconnect
 *       preserves buffers — T4 flap guard, mirroring handlers.mjs:1292-1302);
 *       unchanged → NO restart.
 *
 * @returns {{ state: "ok"|"guest"|"needs-credentials"|"not-enabled"|"error",
 *             venue: string, at: string, ... }} — token value NEVER present,
 *   regardless of branch.
 */
export async function captureVenue(venueId, { page } = {}) {
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

  // Vault gate — never fabricate login, never capture without saved creds.
  const { getSiteCredentials } = await import("./browserStudio.mjs")
  const creds = await getSiteCredentials(venue)
  if (!creds || !creds.username || !creds.password) {
    return { state: "needs-credentials", venue, at }
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
  if (!firstLoginApproved.has(venue)) {
    const { proposeCaptureLogin, captureLoginApproval } = await import("./interventions.mjs")
    const rejectedAt = loginRejectedAt.get(venue) ?? null
    const cooldownActive = rejectedAt !== null && Date.now() - rejectedAt < REJECT_COOLDOWN_MS
    const gate = captureLoginApproval(venue)
    if (gate?.status === "approved") {
      firstLoginApproved.add(venue)
      loginRejectedAt.delete(venue)
    } else if (cooldownActive) {
      return { state: "rejected", venue, at, reason: `first login for ${venue} was not approved (rejected)` }
    } else if (gate === null || (gate.status !== "rejected" && gate.status !== "interrupted")) {
      const proposed = proposeCaptureLogin({ venueId: venue, venueName: profile.name })
      return { state: "pending-approval", venue, at, proposalId: proposed.id }
    } else {
      // Gate decided NO. First run after the decision starts the cooldown and
      // reports it; once the cooldown passes, propose() re-arms the gate and
      // the engine asks again.
      if (rejectedAt === null) loginRejectedAt.set(venue, Date.now())
      if (Date.now() - loginRejectedAt.get(venue) < REJECT_COOLDOWN_MS) {
        return { state: "rejected", venue, at, reason: `first login for ${venue} was not approved (${gate.status})` }
      }
      loginRejectedAt.delete(venue)
      const proposed = proposeCaptureLogin({ venueId: venue, venueName: profile.name })
      return { state: "pending-approval", venue, at, proposalId: proposed.id }
    }
  }

  if (profile.capture.via === "liveEO") {
    const { getCredentials: readTradingCredentials } = await import("./trading.mjs")
    const before = await readTradingCredentials()
    const { captureExpertOptionSession } = await import("./browserStudio.mjs")
    let captured
    try {
      captured = await captureExpertOptionSession(page)
    } catch (err) {
      return { state: "error", venue, at, reason: String(err?.message ?? err) }
    }
    if (captured?.guest) {
      // Logged-out session: the reference implementation already refuses to
      // save it. Report honestly; the existing good token (if any) stays.
      return { state: "guest", venue, at, account: captured.account ?? null }
    }
    const after = await readTradingCredentials()
    const nextToken = after?.expertoptionToken ?? ""
    const tokenChanged = Boolean(nextToken) && nextToken !== (before?.expertoptionToken ?? "")
    if (tokenChanged) lastTokenChange.set(venue, at) // T8: status surface exposes WHEN (never the value)
    let reconnectTriggered = false
    if (tokenChanged) {
      try {
        const { restartLiveEO } = await import("./liveEO.mjs")
        reconnectTriggered = await restartLiveEO({ force: true })
      } catch (err) {
        return { state: "error", venue, at, reason: `token saved but session revive failed: ${String(err?.message ?? err)}` }
      }
    }
    return {
      state: "ok",
      venue,
      at,
      saved: true,
      source: captured?.source ?? null,
      tokenChanged,
      reconnectTriggered,
      loginApproved: true, // T9: the human approved this venue's first login
      account: captured?.account ?? null
    }
  }

  return { state: "not-enabled", venue, at, reason: `capture via "${profile.capture.via}" not implemented` }
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