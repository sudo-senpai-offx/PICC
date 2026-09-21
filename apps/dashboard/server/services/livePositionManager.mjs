// WS-1 F3 — live perps position manager. Restart-persistent open-position
// lifecycle, HONEST realized P&L (labels, never a made-up number — ADR-0005),
// Hyperliquid one-way netting (R3.6), and the peak-anchored wallet state that
// WS-3's (future) drawdown breaker consumes — WS-1 only computes and persists
// that state; `halted` stays null forever (R3.4, enforcement is WS-3).
//
// This module holds NO ccxt instance. It consumes the injected venue adapter's
// observer surface only: observeEquity / positionView (hyperliquidPerps.mjs,
// verified shapes at :387-509). verifyFill / observeFunding belong to the T6
// rail, which BUILDS the fill and fundingObservations arrays this module
// consumes.
//
// Store shapes (overwrite, object stores — same discipline as ccxt-equity.json,
// ccxtOrdering.mjs:307-326):
//   ccxt-perps-positions.json  { version: 1, positions: [ { id, symbol, side,
//                                size, entryPrice, leverage, marginUsd,
//                                marginMode, openedAt, openOrderId, source } ] }
//   ccxt-perps-risk.json       { version: 1, equityUsd, equityAt, runningPeakUsd,
//                                peakAt, drawdownFromPeakPct, dayKey,
//                                dayStartEquityUsd, dayLossPct, halted: null }
//
// Honesty doctrine:
//   • `source` labels provenance: "persisted" (tracked from a verified fill,
//     not yet confirmed against the venue), "reconciled" (confirmed present in
//     the venue on reconcile), "venue-observed" (discovered via the venue, not
//     via our fills) — reconciliation outcomes are labeled, never merged
//     silently (ADR-0005 / R3.1).
//   • A position that vanishes from the venue without a verified close is
//     recorded `closed-unobserved` with `pnl: null` + a reason naming the
//     position — closing P&L is only claimed from a verified fill (R3.3, mirrors
//     ccxt-verify:unobserved, ccxtExecution.mjs:287-300).
//   • fees: `fill.fee` when the venue reported it → "observed" (net); else
//     "unobserved" and P&L stated gross with the label (never a made-up fee).
//   • funding: included ONLY from observations actually captured during the
//     hold (rate × notional each). A hold that crossed a funding boundary
//     without an observation reports `fundingAccrual: "unobserved-portion"` +
//     reason, and P&L is stated WITHOUT a funding adjustment (R3.2).
//   • `dayKeyOf` is IMPORTED from ./u4faRisk.mjs (:29-31) — the SAME UTC
//     boundary as the spot leg; never re-implemented.
//
// Decisions documented in the T4 report:
//   • reduction-to-zero CLOSES the position and returns the recordClose-shaped
//     result; a partial reduction returns the updated OPEN position (polymorphic
//     — discriminate by the presence of `realizedPnlUsd`).
//   • Unknown positionId → refuse loudly (throw), never a silent no-op.
//   • reconcileWithVenue matches persisted ↔ venue by (symbol, side) — the
//     venue view carries no order ids. A match is RELABELED "reconciled", never
//     silently overwritten with venue size/entry. A venue view that is
//     `{ ok:false, reason }` is an unobservable venue → reconcile does NOTHING
//     (a position is only "vanished" when an observable venue omits it).
//   • openPositions() is a pure persisted read (it has no adapter); the
//     reconcile-on-first-boot (plan §3.4) rides observePerpsWallet, which holds
//     the adapter.
//
// Fix round 1 (review — see the T4 report "Fix round 1" section):
//   • A FAILED boot reconcile is NOT latched: `reconciledOnBoot` is only set
//     once the venue returned an array and reconcileWithVenue reported
//     `ok:true`. A throwing read / `{ok:false}` venue leaves the latch open and
//     the failure is SURFACED (never swallowed) as a `reconcile` field on the
//     observePerpsWallet return, so a transient boot failure can never
//     permanently disarm reconcile for the rest of the process.
//   • Store-corruption guard: an unparseable or version-≠1 store on disk marks
//     that store UNHEALTHY at boot. Mutations (trackOpen / recordReduction /
//     recordClose) refuse loudly and reconcile / observePerpsWallet surface
//     `{ ok:false, reason: "…-store-unreadable" | "…-store-version-mismatch" }`;
//     the on-disk file is PRESERVED (never overwritten with an empty store)
//     until an operator repairs it — persisted P&L baselines and open positions
//     are never silently reset (non-negotiable #4). Store health is inspectable
//     via the `storeHealth()` export.
//   • Funding boundary count: a gap of EXACTLY one interval is missed only for
//     the open→first-observation and last-observation→close segments (a boundary
//     that aligns with an in-hold observation IS captured by that bookend). An
//     INTERIOR gap (between two in-hold observations) counts as missed only when
//     strictly greater than the interval — hourly-spaced in-hold observations
//     always report fundingAccrual:"observed".
//   • Reduction P&L is booked at EACH reduction: partial reductions accumulate
//     `realizedAccruedUsd` (per-fill, direction-signed, additive on the live
//     record while it stays open, ADR-0005), and the final close (reduction-to-
//     zero OR recordClose) computes its leg on top — the round-trip total always
//     equals the sum of the verified fills. Reduction legs are booked GROSS (the
//     reduction fill has no fee parameter); the final close still carries its own
//     fee label from the verified fill.
//   • Netting across records (#5 choice — OPTION B, "drain across records"):
//     R3.6's open-position cap counts the POST-FILL NET position, so when a
//     venue row netted several of our same-(symbol, side) records, a single
//     verified reduction fill must be able to drain THEM. recordReduction now
//     drains the whole (symbol, side) group in OPEN ORDER (earliest openedAt
//     first) rather than throwing when the single named record is smaller than
//     the fill; `/exceeds/` is thrown only when the fill exceeds the NETTED group
//     total. Option B was picked over collapsing the records on reconcile
//     because per-record ids/entries/source labels are provenance we must never
//     invent away (ADR-0005 — reconcile only relabels), and the netted-count
//     consistency is delivered at the reduction/close seam exactly where the
//     venue-style net size is consumed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { dayKeyOf } from "./u4faRisk.mjs"

const DATA_DIR =
  process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("./data", import.meta.url))
const POSITIONS_FILE = join(DATA_DIR, "ccxt-perps-positions.json")
const RISK_FILE = join(DATA_DIR, "ccxt-perps-risk.json")

const canTouchDisk = () => process.env.VITEST !== "true" || Boolean(process.env.PICC_COMMAND_CENTRE_DATA_DIR)

// Hyperliquid funding settles hourly (R4.2 gate 15 note). A hold gap longer than
// this between observed funding timestamps means a boundary went uncaptured.
const FUNDING_INTERVAL_MS = 60 * 60 * 1000

const round2 = (x) => Math.round(Number(x) * 100) / 100

// ── in-memory stores (boot-from-disk; write-through on every mutation) ──────

// Boot health: `{ ok: true }` unless the on-disk store was unparseable or a
// future version — then `{ ok:false, reason }`. While unhealthy, mutations
// refuse loudly and no write ever overwrites the file (non-negotiable #4: an
// unreadable store must not silently boot as empty / reset baselines).
let positionsStoreHealth = { ok: true }
let riskStoreHealth = { ok: true }

/** Inspect the boot health of both persisted stores — the honest alternative to
 *  a silent empty boot when a store on disk is corrupt or a future version. */
export function storeHealth() {
  return { positions: { ...positionsStoreHealth }, risk: { ...riskStoreHealth } }
}

let positionsStore = bootPositions()
let riskStore = bootRisk()
let reconciledOnBoot = false

function bootPositions() {
  if (!canTouchDisk() || !existsSync(POSITIONS_FILE)) return []
  let data
  try {
    data = JSON.parse(readFileSync(POSITIONS_FILE, "utf8"))
  } catch {
    positionsStoreHealth = { ok: false, reason: "positions-store-unreadable" }
    return []
  }
  if (!data || typeof data !== "object" || data.version !== 1 || !Array.isArray(data.positions)) {
    const versionMismatch = data && typeof data === "object" && data.version !== 1
    positionsStoreHealth = {
      ok: false,
      reason: versionMismatch ? "positions-store-version-mismatch" : "positions-store-unreadable"
    }
    return []
  }
  return data.positions
}

function bootRisk() {
  if (!canTouchDisk() || !existsSync(RISK_FILE)) return null
  let data
  try {
    data = JSON.parse(readFileSync(RISK_FILE, "utf8"))
  } catch {
    riskStoreHealth = { ok: false, reason: "risk-store-unreadable" }
    return null
  }
  if (!data || typeof data !== "object" || data.version !== 1) {
    const versionMismatch = data && typeof data === "object" && data.version !== 1
    riskStoreHealth = { ok: false, reason: versionMismatch ? "risk-store-version-mismatch" : "risk-store-unreadable" }
    return null
  }
  const { version, ...record } = data
  return record
}

function persistPositions() {
  if (!canTouchDisk() || positionsStoreHealth.ok !== true) return
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(POSITIONS_FILE, JSON.stringify({ version: 1, positions: positionsStore }, null, 2), "utf8")
}

function persistRisk() {
  if (!canTouchDisk() || riskStoreHealth.ok !== true) return
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(RISK_FILE, JSON.stringify({ version: 1, ...riskStore }, null, 2), "utf8")
}

// ── P&L core (shared by recordClose and reduction-to-zero) ─────────────────

/** Count funding interval boundaries crossed between two timestamps with the
 *  observed bookends taken as captured. A gap >= one interval counts a missed
 *  boundary ONLY for the open→first-observation and last-observation→close
 *  segments; an INTERIOR gap (between two in-hold observations) counts as missed
 *  only when strictly greater than the interval — a boundary aligned with the
 *  later in-hold observation IS captured by that bookend, so hourly-spaced
 *  in-hold observations always report "observed". */
function missingFundingBoundaries(openMs, closeMs, inHold) {
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || closeMs <= openMs) return 0
  const bookends = [openMs, ...inHold.map((o) => Date.parse(o.at)), closeMs]
  let boundaries = 0
  for (let i = 1; i < bookends.length; i++) {
    const gap = bookends[i] - bookends[i - 1]
    const interior = i > 1 && i < bookends.length - 1
    if (interior ? gap > FUNDING_INTERVAL_MS : gap >= FUNDING_INTERVAL_MS) {
      boundaries += Math.floor((gap + 1e-3) / FUNDING_INTERVAL_MS)
    }
  }
  return boundaries
}

/** The honest close record — direction-signed realized P&L, fee label, funding
 *  label. Requires a verified fill average (never invents an exit price).
 *  `position.realizedAccruedUsd` (accumulated from prior partial reductions,
 *  Fix round 1) is added so the round-trip total always equals the verified-fill
 *  sum. */
function closeRecordFor(position, fill, fundingObservations, { now = Date.now() } = {}) {
  const exit = Number(fill?.average ?? NaN)
  if (!Number.isFinite(exit) || exit <= 0) {
    throw new Error(
      `live position manager: close of position "${position.id}" requires a verified fill average price — P&L never claimed from an unobserved exit`
    )
  }
  const size = Number(position.size)
  const entry = Number(position.entryPrice)
  const notional = size * entry
  const accrued = Number(position.realizedAccruedUsd ?? 0)
  let realized = (position.side === "long" ? (exit - entry) * size : (entry - exit) * size) + accrued

  let fees = "unobserved"
  const feeRaw = fill?.fee
  if (feeRaw != null && Number.isFinite(Number(feeRaw))) {
    fees = "observed"
    realized -= Number(feeRaw)
  }

  const closedAt = fill?.at ? new Date(fill.at).toISOString() : new Date(now).toISOString()
  const openMs = Date.parse(position.openedAt)
  const closeMs = Date.parse(closedAt)

  const inHold = (fundingObservations ?? [])
    .map((o) => ({ rate: Number(o?.rate), at: o?.at }))
    .filter((o) => Number.isFinite(o.rate) && o.at && Number.isFinite(Date.parse(o.at)))
    .filter((o) => Date.parse(o.at) >= openMs && Date.parse(o.at) <= closeMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  let fundingAccrual = "observed"
  let accruedFunding = 0
  const boundaries = missingFundingBoundaries(openMs, closeMs, inHold)
  if (boundaries > 0) {
    fundingAccrual = "unobserved-portion"
  } else {
    for (const o of inHold) accruedFunding += o.rate * notional
    realized += accruedFunding
  }

  const parts = []
  if (accrued !== 0) {
    parts.push(`prior reduction legs accrued ${round2(accrued)} (booked per verified fill)`)
  }
  if (fundingAccrual === "unobserved-portion") {
    parts.push(
      `funding: ${boundaries} funding interval${boundaries > 1 ? "s" : ""} crossed without an observation — no funding adjustment (unobserved-portion)`
    )
  } else if (accruedFunding !== 0) {
    parts.push(`funding accrual +${round2(accruedFunding)} included (funding observed)`)
  }
  if (fees === "observed") parts.push(`net of venue fee ${Number(feeRaw)} (fees observed)`)
  else parts.push("no venue fee in fill — P&L gross (fees unobserved)")

  return {
    positionId: position.id,
    realizedPnlUsd: round2(realized),
    fees,
    fundingAccrual,
    reason: parts.join("; ") + "."
  }
}

// ── public surface (T6 calls these exact names) ────────────────────────────

/**
 * Register a new open position from a verified open fill. Write-through.
 * Duplicate venue order ids are refused loudly — never silently overwritten.
 */
export function trackOpen({ position, now = Date.now() } = {}) {
  if (positionsStoreHealth.ok !== true) {
    throw new Error(`live position manager: ${positionsStoreHealth.reason} — refusing to mutate the open-position store`)
  }
  if (!position || typeof position !== "object") {
    throw new Error("live position manager: trackOpen requires a position object")
  }
  const { id, symbol, side, size, entryPrice, leverage, marginUsd, marginMode, openedAt, openOrderId } = position
  if (!id || typeof id !== "string") {
    throw new Error("live position manager: trackOpen requires an id (venue order id)")
  }
  if (!symbol || typeof symbol !== "string") {
    throw new Error("live position manager: trackOpen requires a symbol")
  }
  if (side !== "long" && side !== "short") {
    throw new Error(`live position manager: side must be long|short (got "${String(side ?? "")}")`)
  }
  const sizeN = Number(size)
  if (!Number.isFinite(sizeN) || sizeN <= 0) {
    throw new Error("live position manager: size must be a positive number")
  }
  const entryN = Number(entryPrice)
  if (!Number.isFinite(entryN) || entryN <= 0) {
    throw new Error("live position manager: entryPrice must be a positive number")
  }
  if (positionsStore.some((p) => p.id === id)) {
    throw new Error(`live position manager: duplicate position id "${id}" — this venue order id is already tracked`)
  }
  const record = {
    id,
    symbol,
    side,
    size: sizeN,
    entryPrice: entryN,
    leverage: Number.isFinite(Number(leverage)) ? Number(leverage) : null,
    marginUsd: Number.isFinite(Number(marginUsd)) ? Number(marginUsd) : null,
    marginMode: marginMode ?? "isolated",
    openedAt: openedAt ?? new Date(now).toISOString(),
    openOrderId: openOrderId ?? null,
    source: "persisted"
  }
  positionsStore.push(record)
  persistPositions()
  return { ...record }
}

/**
 * R3.6 one-way netting — an opposite-side fill REDUCES the open position in
 * place (original entry/side kept), never opens a second one. A reduction that
 * reaches zero CLOSES the position and returns the recordClose-shaped result;
 * otherwise the UPDATED open position is returned.
 *
 * Netting across records (Fix round 1, option B): a verified reduction fill
 * drains the whole same-(symbol, side) group in OPEN ORDER — earliest openedAt
 * first — rather than throwing when the single named record is smaller than the
 * fill. This is how a single venue fill nets a (symbol, side) that the venue
 * aggregated from several of our records (R3.6 — the cap counts the POST-FILL
 * NET position). Partial drains book realized P&L at EVERY reduction into the
 * record's `realizedAccruedUsd`; `/exceeds/` is thrown only when the fill
 * exceeds the NETTED group total (or the position is already flat).
 */
export function recordReduction({ positionId, filledSize, avgPrice, now = Date.now() } = {}) {
  if (positionsStoreHealth.ok !== true) {
    throw new Error(`live position manager: ${positionsStoreHealth.reason} — refusing to mutate the open-position store`)
  }
  const primary = positionsStore.find((p) => p.id === positionId)
  if (!primary) {
    throw new Error(`live position manager: no open position with id "${positionId}" — nothing to reduce`)
  }
  const filled = Number(filledSize)
  if (!Number.isFinite(filled) || filled <= 0) {
    throw new Error("live position manager: filledSize must be a positive number")
  }
  const price = Number(avgPrice)
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("live position manager: avgPrice must be a positive number")
  }

  const group = positionsStore
    .filter((p) => p.symbol === primary.symbol && p.side === primary.side)
    .sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt) || (a.id < b.id ? -1 : 1))
  const groupTotal = round2(group.reduce((sum, p) => sum + Number(p.size), 0))
  if (filled > groupTotal + 1e-9) {
    throw new Error(
      `live position manager: reduction ${filled} exceeds the netted (${primary.symbol} ${primary.side}) open size ${groupTotal} — refuses an over-close`
    )
  }

  const atIso = new Date(now).toISOString()
  let primaryOutcome = { ...primary }
  let toDrain = filled
  for (const p of group) {
    if (toDrain < 1e-9) break
    const sizeN = Number(p.size)
    const drainHere = Math.min(sizeN, toDrain)
    const remainingNow = round2(sizeN - drainHere)

    if (remainingNow < 1e-9) {
      // this record is fully drained → honest close (final leg on top of any
      // prior accrued; closeRecordFor adds both, so the round-trip total equals
      // the verified-fill sum)
      const record = closeRecordFor({ ...p, size: sizeN, realizedAccruedUsd: p.realizedAccruedUsd }, { average: price, at: atIso }, [], { now })
      positionsStore = positionsStore.filter((r) => r.id !== p.id)
      if (p.id === positionId) primaryOutcome = record
    } else {
      const accruedLeg = p.side === "long" ? (price - Number(p.entryPrice)) * drainHere : (Number(p.entryPrice) - price) * drainHere
      p.realizedAccruedUsd = round2(Number(p.realizedAccruedUsd ?? 0) + accruedLeg)
      p.size = remainingNow
      p.lastReductionAvgPrice = price
      p.lastReductionAt = atIso
      if (p.id === positionId) primaryOutcome = { ...p }
    }
    toDrain = round2(toDrain - drainHere)
  }
  persistPositions()
  return primaryOutcome
}

/**
 * Full verified close (T6's close rail: `executePerpsClose` → verified CRED
 * fill → recordClose). Returns
 *   { positionId, realizedPnlUsd, fees: "observed"|"unobserved",
 *     fundingAccrual: "observed"|"unobserved-portion", reason }.
 * The position is removed from the open store, write-through.
 */
export function recordClose({ positionId, fill, fundingObservations, now = Date.now() } = {}) {
  if (positionsStoreHealth.ok !== true) {
    throw new Error(`live position manager: ${positionsStoreHealth.reason} — refusing to mutate the open-position store`)
  }
  const pos = positionsStore.find((p) => p.id === positionId)
  if (!pos) {
    throw new Error(`live position manager: no open position with id "${positionId}" — nothing to close`)
  }
  const record = closeRecordFor(pos, fill, fundingObservations, { now })
  positionsStore = positionsStore.filter((p) => p.id !== positionId)
  persistPositions()
  return record
}

/**
 * Persisted open-position view with `source` labels. Pure read — the venue
 * reconcile (plan §3.4 boot step) runs from observePerpsWallet, which holds the
 * adapter.
 */
export function openPositions() {
  return positionsStore.map((p) => ({ ...p }))
}

/**
 * Reconcile the persisted store against whatever `adapter.positionView()`
 * returned: either an Array (venue observed; empty array = no positions) or
 * `{ ok:false, reason }` (venue unobservable).
 *   • persisted ∧ venue           → relabeled "reconciled"
 *   • venue-only                  → added as "venue-observed"
 *   • persisted ∧ venue unobservable → untouched (stays "persisted")
 *   • persisted ∧ observable-venue omits it ⇒ CLOSED as "closed-unobserved"
 *                                    with pnl: null + a reason naming the
 *                                    position (R3.3 — never a guessed P&L).
 */
export function reconcileWithVenue(positionView, { now = Date.now() } = {}) {
  if (positionsStoreHealth.ok !== true) {
    return { ok: false, reason: positionsStoreHealth.reason, reconciled: [], venueObserved: [], closedUnobserved: [] }
  }
  if (positionView && typeof positionView === "object" && !Array.isArray(positionView) && positionView.ok === false) {
    return {
      ok: false,
      reason: positionView.reason ?? "positions-unobservable",
      reconciled: [],
      venueObserved: [],
      closedUnobserved: []
    }
  }
  // ONLY an Array means "the venue answered" (empty = no positions, observed).
  // Any other shape — null, an {ok:false} object handled above, a throw, a
  // malformed record — is an unobservable read and MUST NOT close anything.
  if (!Array.isArray(positionView)) {
    return {
      ok: false,
      reason: "positions-unobservable",
      reconciled: [],
      venueObserved: [],
      closedUnobserved: []
    }
  }
  const venueRows = positionView
  const keyOf = (symbol, side) => `${symbol}::${side}`
  const venueByKey = new Map()
  for (const row of venueRows) {
    const side = row?.side === "short" ? "short" : "long"
    if (!row?.symbol) continue
    venueByKey.set(keyOf(row.symbol, side), row)
  }

  const nowIso = new Date(now).toISOString()
  const reconciled = []
  const closedUnobserved = []
  const stillOpen = []
  for (const p of positionsStore) {
    if (venueByKey.has(keyOf(p.symbol, p.side))) {
      p.source = "reconciled"
      reconciled.push(p.id)
      stillOpen.push(p)
    } else {
      closedUnobserved.push({
        positionId: p.id,
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        openedAt: p.openedAt,
        closedAt: nowIso,
        source: "closed-unobserved",
        pnl: null,
        reason: `position "${p.id}" (${p.symbol} ${p.side}) vanished from the venue without a verified close — closing P&L NOT claimed (no verified fill)`
      })
    }
  }
  positionsStore = stillOpen

  const venueObserved = []
  const knownKeys = new Set(stillOpen.map((p) => keyOf(p.symbol, p.side)))
  for (const row of venueRows) {
    if (!row?.symbol || knownKeys.has(keyOf(row.symbol, row.side === "short" ? "short" : "long"))) continue
    const sizeN = Number(row.size)
    const entryN = Number(row.entryPrice)
    if (!Number.isFinite(sizeN) || sizeN <= 0 || !Number.isFinite(entryN) || entryN <= 0) continue // unadoptable row
    const side = row.side === "short" ? "short" : "long"
    const rec = {
      id: `venue:${row.symbol}:${side}`,
      symbol: row.symbol,
      side,
      size: sizeN,
      entryPrice: entryN,
      leverage: Number.isFinite(Number(row.leverage)) ? Number(row.leverage) : null,
      marginUsd: Number.isFinite(Number(row.marginUsd)) ? Number(row.marginUsd) : null,
      marginMode: row.marginMode ?? "isolated",
      openedAt: row.at ?? nowIso,
      openOrderId: null,
      source: "venue-observed"
    }
    positionsStore.push(rec)
    venueObserved.push(rec.id)
  }

  persistPositions()
  return { ok: true, reconciled, venueObserved, closedUnobserved, at: nowIso }
}

/**
 * Reconcile-on-first-boot (plan §3.4), NOT latched on failure (Fix round 1): the
 * latch is only armed once an array-shaped venue view produced `ok:true`. A
 * throwing read, an `{ok:false}` venue, or an unhealthy (corrupt/version-≠1)
 * positions store leaves the latch OPEN so the next successful observation
 * retries — a transient boot failure can never permanently disarm reconcile.
 * The failure is surfaced (never swallowed) as `reconcile: { ok:false, reason }`
 * on the returning observation.
 */
async function bootReconcile(adapter, { now }) {
  if (positionsStoreHealth.ok !== true) {
    return { ok: false, reason: positionsStoreHealth.reason, reconciled: [], venueObserved: [], closedUnobserved: [] }
  }
  if (!adapter || typeof adapter.positionView !== "function") return null
  try {
    const result = reconcileWithVenue(await adapter.positionView(), { now })
    if (result && result.ok === true) {
      reconciledOnBoot = true
      return result
    }
    return result ?? { ok: false, reason: "positions-unobservable", reconciled: [], venueObserved: [], closedUnobserved: [] }
  } catch (e) {
    return { ok: false, reason: e?.message || "positions-unobservable", reconciled: [], venueObserved: [], closedUnobserved: [] }
  }
}

/**
 * Equity snapshot + UTC day-baseline maintenance + one-way peak ratchet,
 * persisted to ccxt-perps-risk.json (the WS-3-consumed state; halted stays
 * null). On the FIRST call after a (re)start it also reconciles the persisted
 * positions against the venue's positionView (plan §3.4) — a FAILED boot
 * reconcile is NOT latched and is surfaced as `reconcile` on the return. A
 * corrupt risk store refuses loudly (`{ ok:false, reason }`) and is never
 * overwritten with a fresh baseline. A venue/equity read failure is reported
 * `{ ok:false, reason }` — nothing is fabricated, nothing is written.
 */
export async function observePerpsWallet(adapter, { now = Date.now() } = {}) {
  if (riskStoreHealth.ok !== true) {
    return { ok: false, reason: riskStoreHealth.reason }
  }

  const reconcileResult = !reconciledOnBoot ? await bootReconcile(adapter, { now }) : null

  if (!adapter || typeof adapter.observeEquity !== "function") {
    return { ok: false, reason: "adapter has no observeEquity — perps wallet unobservable" }
  }
  const obs = await adapter.observeEquity()
  if (!obs || obs.ok !== true) {
    return { ok: false, reason: obs?.reason ?? "equity-unobservable" }
  }
  const equityUsd = Number(obs.equityUsd)
  if (!Number.isFinite(equityUsd) || equityUsd <= 0) {
    return { ok: false, reason: `equity-unobservable: invalid equity payload` }
  }
  const atIso = obs.at ? new Date(obs.at).toISOString() : new Date(now).toISOString()

  const dayKey = dayKeyOf(now)
  const prev = riskStore
  const dayRolled = !prev?.dayKey || prev.dayKey !== dayKey
  const dayStartEquityUsd = dayRolled ? equityUsd : Number(prev.dayStartEquityUsd) || equityUsd

  let runningPeakUsd
  let peakAt
  if (prev && Number.isFinite(Number(prev.runningPeakUsd))) {
    if (equityUsd > Number(prev.runningPeakUsd)) {
      runningPeakUsd = equityUsd
      peakAt = atIso
    } else {
      runningPeakUsd = Number(prev.runningPeakUsd)
      peakAt = prev.peakAt ?? atIso
    }
  } else {
    runningPeakUsd = equityUsd
    peakAt = atIso
  }

  const drawdownFromPeakPct = runningPeakUsd > 0 ? round2(((runningPeakUsd - equityUsd) / runningPeakUsd) * 100) : null
  const dayLossPct = dayStartEquityUsd > 0 ? round2(Math.max(0, ((dayStartEquityUsd - equityUsd) / dayStartEquityUsd) * 100)) : null

  riskStore = {
    equityUsd,
    equityAt: atIso,
    runningPeakUsd,
    peakAt,
    drawdownFromPeakPct,
    dayKey,
    dayStartEquityUsd,
    dayLossPct,
    halted: null
  }
  persistRisk()

  const result = { ok: true, ...riskStore }
  if (reconcileResult) result.reconcile = reconcileResult
  return result
}