// PICC headless account-metrics layer (spec Phase 5, T5/T6/T7).
//
// ── Honesty contract ─────────────────────────────────────────────────────────
//   Every number here is an OBSERVED value or null. A field absent from the
//   broker's raw profile frame stays null in storage and null in the API — the
//   the strict parser never falls back to 0, because a fabricated 0 is
//   indistinguishable from a real balance of zero. Genuine zeros ARE preserved.
//
// ── Where the data comes from ─────────────────────────────────────────────────
//   The `ws` via read raw profile frames per leg and re-parsed them strictly
//   here: observedAt = the frame's arrival time; sourceLeg = the leg that
//   delivered it. D2/AC-005 removed that producer (the ExpertOption websocket
//   transport), and `expertoption` was the only profile declaring
//   `extractVia:["ws"]` — so with the venue gone NO profile declares it and the
//   collector stores nothing. The store, the parser and the API surface are
//   retained unchanged: they are venue-agnostic and a future `ws` producer
//   (a new capture profile declaring the via) would repopulate them with no
//   change here. The collector runs on the venue's metrics cadence (spec T5)
//   via the same scheduler job that refreshes sessions (spec mechanism B/C).
//
// ── Store ────────────────────────────────────────────────────────────────────
//   account-metrics.json, keyed { [userId]: { [venueId]: record } }. Latest
//   record per (user, venue); the API derives `stale` from observedAt vs the
//   venue's current metrics cadence. The boot read follows the VITEST-suppressed
//   JSON-store rule: under vitest the file is only touched when a test sets
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
 * Unwrap a profile payload: `obj.message?.profile ?? obj.message`, accepting
 * both the accountFrom-style `{ profile: {...} }` and the raw WS app-object
 * `{ action: "profile", message: {...} }`.
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
 * { at, leg, payload } entries (the production shape).
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

/**
 * Production read for the "ws" via: the most recent raw profile frames.
 *
 * D2/AC-005: the ExpertOption websocket transport (liveEO.mjs) is removed, and
 * `expertoption` was the ONLY capture profile declaring `extractVia:["ws"]`
 * (every other profile declares `extractVia:[]`). So the "ws" via has no
 * remaining producer. This returns an empty frame set rather than importing a
 * deleted module: `extractAccountState` then yields null and the collector
 * stores nothing, which is the honest "no observation" outcome — never a
 * fabricated zero and never a thrown import.
 */
async function framesFromWs() {
  return []
}

// ---------------------------------------------------------------------
// Wealth Task 7 — CCXT spot collector addition (collector ONLY).
// The strict parser above, the per-user store shape and the API surface
// are byte-identical: this adds one more read-only observation source.
// Per (user, venue): keyed exchanges are observed via observeCcxtEquity
// (dynamic import, like wealth/legsKeyed.mjs — no ccxt load cost at
// import time, tests stay hermetic via deps injection); unkeyed venues
// store nothing (honest absence downstream).
// ---------------------------------------------------------------------

const CCXT_SPOT_SOURCE_LEG = "ccxt-spot"
const CCXT_SPOT_DEFAULT_CADENCE_MS = 5 * 60 * 1000

function normalizeExchangeId(id) {
  return String(id ?? "").trim().toLowerCase()
}

/** Keyed exchange ids: injected `deps.keyed` in tests, else the live seam. */
async function ccxtSpotKeyedIds(deps = {}) {
  if (Array.isArray(deps.keyed)) return deps.keyed.map(normalizeExchangeId).filter(Boolean)
  try {
    const { ccxtKeyedExchangeIds } = await import("./ccxtOrdering.mjs")
    return (ccxtKeyedExchangeIds() ?? []).map(normalizeExchangeId).filter(Boolean)
  } catch {
    return []
  }
}

/** Read-only spot equity observation: injected in tests, else the live seam. */
async function observeCcxtSpotEquity(exchangeId, deps = {}) {
  if (typeof deps.observeEquity === "function") return deps.observeEquity({ exchange: exchangeId })
  const { observeCcxtEquity } = await import("./ccxtOrdering.mjs")
  return observeCcxtEquity({ exchange: exchangeId })
}

/**
 * Capture the latest CCXT spot equity for one exchange and write it to the
 * per-user store. Returns the stored record, or null when nothing was
 * observed (unkeyed venue / unobservable balance) — nothing stored then.
 */
export async function collectCcxtSpotMetrics(userId, exchangeId, deps = {}) {
  const id = normalizeExchangeId(exchangeId)
  if (!id) return null
  const keyed = await ccxtSpotKeyedIds(deps)
  if (!keyed.includes(id)) return null // honest: unkeyed, nothing stored
  let r
  try {
    r = await observeCcxtSpotEquity(id, deps)
  } catch {
    return null
  }
  const equityUsd = Number(r?.equityUsd)
  if (!r?.ok || !Number.isFinite(equityUsd)) return null // honest: unobservable, nothing stored
  const record = {
    venueId: id,
    balance: equityUsd,
    equityUsd,
    currency: "USD",
    active: null,
    demo: null,
    demoWallet: { balance: null, currency: "USD" },
    realWallet: { balance: null, currency: "USD" },
    email: null,
    name: null,
    openPositions: null, // not observed here — never a fabricated 0/[]
    exposurePct: null,
    sourceLeg: CCXT_SPOT_SOURCE_LEG,
    observedAt: r.at ?? new Date().toISOString()
  }
  await putAccountMetrics(userId, record)
  return structuredClone(record)
}

/**
 * Capture the latest metrics observation for one venue and write it to the
 * per-user store. Returns the stored record, or null when nothing was
 * observed (unknown venue / no extractor / no profile frame yet /
 * unkeyed-unobservable CCXT spot).
 */
export async function collectAccountMetrics(userId, venueId) {
  const profile = getCaptureProfile(venueId)
  if (profile && metricsEnabledFor(profile)) {
    const via = profile.metrics?.extractVia ?? []
    if (via.includes("ws")) {
      const frames = await framesFromWs()
      const record = extractAccountState({ venueId, frames })
      if (!record) return null // honest: no observation yet, nothing stored
      await putAccountMetrics(userId, record)
      return structuredClone(record)
    }
  }
  // Wealth Task 7: CCXT spot fallback per (user, venue) — unkeyed venues
  // store nothing (collectCcxtSpotMetrics returns null without writing).
  return collectCcxtSpotMetrics(userId, venueId)
}

/**
 * T5 collector pass — for every venue with an extractor, collect when its
 * metrics cadence is due. A null observation does NOT refresh the cadence
 * gate (same rule as capture: a failed run retries, it never waited a cadence
 * doing nothing). Returns the records stored this pass.
 *
 * Wealth Task 7: a second sweep over the keyed CCXT exchanges follows the
 * (currently producer-less) ws sweep, under its own `ccxt-spot:<id>` gate
 * keys so the two cadences never share state.
 */
export async function accountMetricsRefresh(userId = "default", deps = {}) {
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
  const keyed = await ccxtSpotKeyedIds(deps)
  for (const id of keyed) {
    const gateKey = `ccxt-spot:${id}`
    const cadenceMs = metricsCadenceMs(id) ?? CCXT_SPOT_DEFAULT_CADENCE_MS
    if (now - (lastMetricsRun.get(gateKey) ?? 0) < cadenceMs) continue
    const record = await collectCcxtSpotMetrics(userId, id, { ...deps, keyed })
    if (record) {
      lastMetricsRun.set(gateKey, now)
      collected.push(record)
    }
  }
  return collected
}