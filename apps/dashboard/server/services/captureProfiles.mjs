// PICC headless-session capture engine — coverage matrix + capture runner.
//
// Spec: docs/specs/PICC_HEADLESS_CAPTURE_ENGINE.md (Mechanism A/C + T2/T3/T4).
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
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 }
  },
  {
    id: "iqoption",
    name: "IQ Option",
    kind: "binary",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "Login/storage UNVERIFIED — T10 research gates enablement." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 }
  },
  {
    id: "binance",
    name: "Binance",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "Spot token capture only (metrics P3). Selectors/storage UNVERIFIED — T10 first." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 15 * 60 * 1000 }
  },
  {
    id: "kucoin",
    name: "KuCoin",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "Spot token capture only (metrics P3). Selectors/storage UNVERIFIED — T10 first." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 15 * 60 * 1000 }
  },
  {
    id: "okx",
    name: "OKX",
    kind: "spot",
    status: "capture-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "Spot token capture only (metrics P3). Selectors/storage UNVERIFIED — T10 first." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 15 * 60 * 1000 }
  },
  {
    id: "bybit",
    name: "Bybit",
    kind: "derivatives",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "No verified selectors/storage this session — catalog presence only." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 15 * 60 * 1000 }
  },
  {
    id: "etoro",
    name: "eToro",
    kind: "cfd",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "CFD/social UX unverified; may reuse studioLogin's Google path (browserStudio.mjs:3486-3530) once researched." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 15 * 60 * 1000 }
  },
  {
    id: "plus500",
    name: "Plus500",
    kind: "cfd",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "No verified selectors/storage this session — catalog presence only." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 15 * 60 * 1000 }
  },
  {
    id: "olymptrade",
    name: "Olymp Trade",
    kind: "binary",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "No verified selectors/storage this session — catalog presence only." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 }
  },
  {
    id: "deriv",
    name: "Deriv",
    kind: "binary",
    status: "catalog-only",
    demoReal: "demo-first",
    capture: { via: null, ref: null, note: "No verified selectors/storage this session — catalog presence only." },
    cadence: { tokenMs: 30 * 60 * 1000, metricsMs: 5 * 60 * 1000 }
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
const policyOverrides = new Map() // venueId -> { enabled?: bool, refreshCadenceMs?: number }
const lastAutoRun = new Map() // venueId -> ts
const lastReports = new Map() // venueId -> report (latest per-venue capture report)

const CADENCE_MIN_MS = 60_000
const CADENCE_MAX_MS = 24 * 60 * 60 * 1000

/** Clamp a requested cadence to a sane range; non-numeric → profile default. */
export function clampCadence(ms, fallbackMs) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return Math.max(CADENCE_MIN_MS, Number(fallbackMs) || CADENCE_MIN_MS)
  return Math.min(CADENCE_MAX_MS, Math.max(CADENCE_MIN_MS, n))
}

/**
 * Override per-venue refresh behaviour (T7 will feed per-user prefs through
 * here). Shape: { [venueId]: { enabled?: boolean, refreshCadenceMs?: number } }.
 */
export function setHeadlessSessionPolicy(policy = {}) {
  for (const [venueId, cfg] of Object.entries(policy ?? {})) {
    if (!byId.has(venueId)) continue
    const entry = {}
    if (typeof cfg?.enabled === "boolean") entry.enabled = cfg.enabled
    if (cfg?.refreshCadenceMs !== undefined) entry.refreshCadenceMs = clampCadence(cfg.refreshCadenceMs, byId.get(venueId).cadence.tokenMs)
    if (Object.keys(entry).length) policyOverrides.set(venueId, entry)
    else policyOverrides.delete(venueId)
  }
}

/** The effective refresh cadence for a venue (override > profile default). */
export function refreshCadenceMs(venueId) {
  const profile = byId.get(venueId)
  if (!profile) return null
  const ov = policyOverrides.get(venueId)
  return ov?.refreshCadenceMs ?? profile.cadence.tokenMs
}

/** Enabled per policy — default true for every profile with a capture hook. */
export function isVenueEnabled(venueId) {
  const profile = byId.get(venueId)
  if (!profile) return false
  if (!profile.capture?.via) return false
  return policyOverrides.get(venueId)?.enabled ?? true
}

/** Per-venue refresh state for status surfacing (T8 foundation). */
export function headlessSessionStatus() {
  const rows = {}
  for (const p of CAPTURE_PROFILES) {
    const last = lastReports.get(p.id)
    rows[p.id] = {
      venueId: p.id,
      status: last?.state ?? (p.capture?.via ? "idle" : "not-enabled"),
      reason: last?.state === "error" || last?.state === "not-enabled" ? (last?.reason ?? null) : null,
      lastCaptureAt: last?.at ?? null,
      lastStateAt: last?.at ?? null,
      enabled: isVenueEnabled(p.id),
      refreshCadenceMs: refreshCadenceMs(p.id),
      stale: last ? Date.now() - Date.parse(last.at) > refreshCadenceMs(p.id) * 3 : false
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
export function _resetHeadlessSessionState() {
  lastAutoRun.clear()
  lastReports.clear()
  policyOverrides.clear()
}