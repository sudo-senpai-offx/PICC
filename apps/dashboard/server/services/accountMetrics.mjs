// PICC headless account-metrics layer (spec Phase 5, T5/T6/T7).
//
// ── Honesty contract ─────────────────────────────────────────────────────────
//   Every number here is an OBSERVED value or null. A field absent from the
//   broker's raw profile frame stays null in storage and null in the API — the
//   strict parser never falls back to 0 like expertoption.accountFrom does
//   (`num(...) ?? 0`), because a fabricated 0 is indistinguishable from a real
//   balance of zero. Genuine zeros ARE preserved.
//
// ── Where the data comes from ─────────────────────────────────────────────────
//   v1 extractVia:["ws"] (only `expertoption`): liveEO keeps the most recent
//   RAW profile frame per leg (liveEO.lastRawProfile, exposed via
//   liveEOAccountRaw()) — re-parsed here strictly. observedAt = the frame's
//   arrival time; sourceLeg = the leg that delivered it. The collector runs on
//   the venue's metrics cadence (spec T5) via the same scheduler job that
//   refreshes sessions (spec mechanism B/C).
//
// ── Store ────────────────────────────────────────────────────────────────────
//   account-metrics.json, keyed { [userId]: { [venueId]: record } }. Latest
//   record per (user, venue); the API derives `stale` from observedAt vs the
//   venue's current metrics cadence. The boot read follows the feed-mode rule
//   (liveEO.mjs:76-116): under vitest the file is only touched when a test set
//   PICC_ACCOUNT_METRICS_DATA_DIR, so a test run can never poison the real
//   server's store.

import { readFileSync } from "node:fs"
import { rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { getCaptureProfile, isVenueEnabled, listCaptureProfiles, metricsCadenceMs } from "./captureProfiles.mjs"

// ---------------------------------------------------------------------
// T5 — vocabulary + strict parser.
// ---------------------------------------------------------------------

const METRICS_FILE = join(
  process.env.PICC_ACCOUNT_METRICS_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url)),
  "account-metrics.json"
)
const canTouchMetricsDisk = () => !isVitestMode() || Boolean(process.env.PICC_ACCOUNT_METRICS_DATA_DIR)

function isVitestMode() {
  return process.env.VITEST === "true"
}

/** Strict numeric marker: absent → null, coercible → Number, genuine 0 → 0. */
function num(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/**
 * Unwrap a profile payload the same way liveEO does (obj.message?.profile ??
 * obj.message), accepting both the accountFrom-style `{ profile: {...} }` and
 * the raw WS app-object `{ action: "profile", message: {...} }`.
 */
function unwrapProfile(payload) {
  if (!payload || typeof payload !== "object") return null
  if (payload.action === "profile") payload = payload.message ?? payload
  if (payload?.profile && typeof payload.profile === "object") return payload.profile
  return payload
}

const PROFILE_FRAME_KEYS = [
  "balance", "amount", "total",
  "demo_balance", "demoBalance",
  "real_balance", "realBalance",
  "is_demo", "email", "name", "surname", "currency", "curr"
]

/** True only when the unwrapped object actually looks like a profile frame. */
function isProfileFrame(nested) {
  return Boolean(nested && typeof nested === "object" && PROFILE_FRAME_KEYS.some((k) => k in nested))
}

/**
 * Parse one RAW profile frame into the T5 account-metrics vocabulary, STRICT:
 * a field that was absent in the frame is null (never 0), a field that was 0
 * stays 0. Truth table (mirrors accountFrom's branches without its collapses):
 *
 *   is_demo=1        → demo context; demoWallet = demo_balance ?? single;
 *                      realWallet = real_balance (null when absent)
 *   is_demo=0        → real context;  realWallet = real_balance ?? single;
 *                      demoWallet = demo_balance (null when absent)
 *   no flag, demoAmt → demo view, demoWallet = demo_balance, realWallet = real_balance
 *   no flag, realAmt → real view
 *   neither (legacy single-balance) → active null, `balance` = the single
 *   amount, both wallets null — we do NOT guess which wallet it belongs to.
 *
 * @returns normalized record, or null when the payload is not a profile frame.
 */
export function parseAccountFrame(payload) {
  const nested = unwrapProfile(payload)
  if (!isProfileFrame(nested)) return null

  const currency = String(nested.currency ?? nested.curr ?? "USD").toUpperCase()
  const demo = num(nested.demo_balance ?? nested.demoBalance)
  const real = num(nested.real_balance ?? nested.realBalance)
  const single = num(nested.balance ?? nested.amount ?? nested.total)
  const isDemo = nested.is_demo === 1 || nested.is_demo === true
  const isReal = nested.is_demo === 0 || nested.is_demo === false

  let demoBalance = null
  let realBalance = null
  let active = null
  if (isDemo) {
    demoBalance = demo ?? single
    realBalance = real
    active = "demo"
  } else if (isReal) {
    demoBalance = demo
    realBalance = real ?? single
    active = "real"
  } else if (demo != null) {
    demoBalance = demo
    realBalance = real
    active = "demo"
  } else if (real != null) {
    demoBalance = demo
    realBalance = real
    active = "real"
  } else if (single != null) {
    // Legacy single-balance, wallet unknown — reported as `balance`, not
    // assigned to a wallet (that would fabricate a wallet balance).
    demoBalance = demo
    realBalance = real
    active = null
  }

  const name = [nested.name, nested.surname].filter(Boolean).join(" ")
  return {
    demoWallet: { balance: demoBalance, currency },
    realWallet: { balance: realBalance, currency },
    active,
    currency,
    balance: active === "demo" ? demoBalance : active === "real" ? realBalance : single,
    demo: active === "demo" ? true : active === "real" ? false : null,
    email: nested.email ? String(nested.email) : null,
    name: name ? String(name) : null,
    openPositions: null, // not yet observed — never a fabricated 0/[]
    exposurePct: null
  }
}

/**
 * T5 extractor. Frames may be either raw WS app-objects (tests) or
 * { at, leg, payload } entries (production, mapped from liveEOAccountRaw()).
 * Picks the MOST RECENT parseable frame; stamps venueId/sourceLeg/observedAt.
 * @returns record | null (unknown venue, no extractor, or no usable frame).
 */
export function extractAccountState({ venueId, frames = [], observedAt = new Date().toISOString() } = {}) {
  const profile = getCaptureProfile(venueId)
  if (!profile) return null
  if (!(profile.metrics?.extractVia ?? []).includes("ws")) return null

  const entries = []
  for (const f of frames ?? []) {
    if (!f || typeof f !== "object") continue
    if (f.payload !== undefined && (f.at !== undefined || f.leg !== undefined)) {
      entries.push({ at: Number(f.at) || 0, leg: String(f.leg ?? "ws"), payload: f.payload })
    } else {
      entries.push({ at: 0, leg: "ws", payload: f })
    }
  }
  if (!entries.length) return null
  entries.sort((a, b) => b.at - a.at)
  const rec = parseAccountFrame(entries[0].payload)
  if (!rec) return null
  return {
    ...rec,
    venueId,
    sourceLeg: entries[0].leg,
    observedAt: entries[0].at ? new Date(entries[0].at).toISOString() : observedAt
  }
}

/** Observed-at vs cadence: older than one metrics cadence ⇒ stale. */
export function staleFrom({ record, cadenceMs }) {
  if (!record?.observedAt) return false
  const at = Date.parse(record.observedAt)
  if (!Number.isFinite(at)) return false
  return Date.now() - at > cadenceMs
}

// ---------------------------------------------------------------------
// T6 — per-user store.
// ---------------------------------------------------------------------

let metricsCache = {} // { [userId]: { [venueId]: record } }

loadMetricsAtBoot()

function loadMetricsAtBoot() {
  if (!canTouchMetricsDisk()) return
  try {
    const parsed = JSON.parse(readFileSync(METRICS_FILE, "utf8"))
    if (parsed && typeof parsed === "object") metricsCache = parsed
  } catch {
    metricsCache = {}
  }
}

/** Latest record for one venue of one user, or null when never observed. */
export function getAccountMetrics(userId, venueId) {
  const uid = String(userId ?? "default")
  const rec = metricsCache[uid]?.[venueId]
  return rec ? structuredClone(rec) : null
}

/** All venue records for one user (absent venues simply aren't present). */
export function accountMetricsForUser(userId) {
  const uid = String(userId ?? "default")
  return structuredClone(metricsCache[uid] ?? {})
}

/** Persist the latest observation for (user, venue), replacing any prior. */
export async function putAccountMetrics(userId, record) {
  if (!record?.venueId) return false
  const uid = String(userId ?? "default")
  metricsCache = {
    ...metricsCache,
    [uid]: {
      ...(metricsCache[uid] ?? {}),
      [record.venueId]: record
    }
  }
  if (canTouchMetricsDisk()) {
    const tmp = `${METRICS_FILE}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(metricsCache, null, 2))
    await rename(tmp, METRICS_FILE)
  }
  return true
}

// ---------------------------------------------------------------------
// T5/T7 — the cadence collector. Same scheduler job as the session
// refresh; per-venue metrics cadence gate mirrors lastAutoRun.
// ---------------------------------------------------------------------

const lastMetricsRun = new Map() // venueId -> ts

/** Test seam — clears the metrics cadence memory (never used at runtime). */
export function _resetMetricsCollectorState() {
  lastMetricsRun.clear()
}

/** A venue collects metrics when it declares an extractor and is enabled. */
function metricsEnabledFor(profile) {
  const via = profile.metrics?.extractVia ?? []
  if (!via.length) return false
  // Venues WITH a capture hook respect the enabled policy (T7 prefs); rows
  // without a hook yet (future work) are gated purely by their extractor.
  return !profile.capture?.via || isVenueEnabled(profile.id)
}

/** Production read for the "ws" via: liveEO's most recent raw profile frames. */
async function framesFromLiveEO() {
  const { liveEOAccountRaw } = await import("./liveEO.mjs")
  const raws = liveEOAccountRaw() ?? {}
  return Object.entries(raws).map(([leg, e]) => ({ leg, at: e.at, payload: e.payload }))
}

/**
 * Capture the latest metrics observation for one venue and write it to the
 * per-user store. Returns the stored record, or null when nothing was
 * observed (unknown venue / no extractor / no profile frame yet).
 */
export async function collectAccountMetrics(userId, venueId) {
  const profile = getCaptureProfile(venueId)
  if (!profile || !metricsEnabledFor(profile)) return null
  const via = profile.metrics?.extractVia ?? []
  if (!via.includes("ws")) return null
  const frames = await framesFromLiveEO()
  const record = extractAccountState({ venueId, frames })
  if (!record) return null // honest: no observation yet, nothing stored
  await putAccountMetrics(userId, record)
  return structuredClone(record)
}

/**
 * T5 collector pass — for every venue with an extractor, collect when its
 * metrics cadence is due. A null observation does NOT refresh the cadence
 * gate (same rule as capture: a failed run retries, it never waited a cadence
 * doing nothing). Returns the records stored this pass.
 */
export async function accountMetricsRefresh(userId = "default") {
  const collected = []
  const profiles = listCaptureProfiles()
  const now = Date.now()
  for (const profile of profiles) {
    if (!metricsEnabledFor(profile)) continue
    const via = profile.metrics?.extractVia ?? []
    if (!via.includes("ws")) continue
    const cadenceMs = metricsCadenceMs(profile.id)
    if (now - (lastMetricsRun.get(profile.id) ?? 0) < cadenceMs) continue
    const record = await collectAccountMetrics(userId, profile.id)
    if (record) {
      lastMetricsRun.set(profile.id, now)
      collected.push(record)
    }
  }
  return collected
}