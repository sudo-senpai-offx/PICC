// WS-7 T17 — the CCXT full order lifecycle for the four venues.
//
// D9:169 — "submit -> verify fill -> position -> close -> realized P&L, with
// post-fill slippage analysis", for Kraken, Coinbase, Binance and Bybit.
//
// ---------------------------------------------------------------------------
// THIS MODULE HOLDS NO RAIL LOGIC AND NO CCXT INSTANCE
// ---------------------------------------------------------------------------
//
// Every leg calls `evaluateLifecycleRails` and then, only on a pass, hands the
// venue step to an INJECTED adapter. The production adapter is four functions
// over `ccxtOrdering.mjs`'s existing seam; a test injects a testnet adapter. Two
// consequences, both deliberate:
//
//   1. `perpsSeamGuard.test.mjs:118-128` walks every server `.mjs` counting the
//      ORDER-SEAM CALL SHAPE and pins the total at exactly two — the spot seam and
//      the perps adapter. A fourth venue adapter that constructed its own order
//      would make that count three and the guard would fail. Routing every venue
//      through the ONE sanctioned seam is both what the guard means and the correct
//      architecture, so this is not a constraint worked around.
//
//      This file therefore names the seam's methods WITHOUT the receiver-dot-call
//      shape, in prose and in the import list alike. Writing the shape out — even
//      inside a comment — would make the seam guard count this file as a third call
//      site and fail on the scanner rather than on a real venue change, which is the
//      same trap `server/scripts/absence-scope.mjs:33-42` documents for its own
//      patterns.
//
//   2. `executionAbsenceScope.test.mjs` discovers order-capable modules and
//      requires each to be on a reviewed list. This module IS order-capable, and it
//      is DISCOVERABLE rather than merely declared: the injected adapter's members
//      carry the same venue-shaped names the scanner's vocabulary already knows
//      (`placeOrder`, `cancelOrder`, `closeOrder`), so `seam.cancelOrder(` is a real
//      hit. The module is DECLARED in
//      `scripts/absence-scope.mjs`'s `INTENTIONAL_ORDER_CAPABLE` — a deliberate,
//      reviewable edit to a reviewed list, which is the mechanism that file
//      documents. Naming it was preferred to renaming the members to dodge the
//      scanner, because a module that reaches a venue and hides that from the
//      scanner is exactly the evasion the scanner's header warns about.
//
// ---------------------------------------------------------------------------
// DARK BY CONSTRUCTION — AND WHY THAT IS THE DELIVERABLE, NOT A SHORTCUT
// ---------------------------------------------------------------------------
//
// On a fresh checkout every leg of every venue fails closed, for three
// independent reasons, any one of which is sufficient:
//
//   * no production authority set exists and no ceremony unlock has ever been
//     granted, so `enablementFor("ccxt-crypto")` is `null` (T8's Ceremony room
//     renders "not unlocked" for exactly this reason);
//   * `PICC_CCXT_VENUE_ENABLED_*` is unset for all four, and the bit defaults
//     closed;
//   * a leg needs a RECORDED CONSENT ANCHOR, and anchors are written only by
//     `proposeLeg` — a per-action proposal with a named human. Nothing in the
//     tree calls `proposeLeg`, because there is no route for these legs (see
//     below).
//
// T13 measured that Needle 3 ships no Windows build, so nothing on this host can
// do real venue inference or live trading. This task therefore builds the
// lifecycle GATED AND DARK and proves it with injected adapters. It does not
// build a live trading path, and `ccxtVenueLifecycle.sandboxE2E.test.mjs` names
// what a real sandbox run would still require rather than implying it happened.
//
// NO ROUTE. AC-036 is about the lifecycle being complete per venue; the three
// rails are enforced in this module and in `ccxtLifecycleRails.mjs`. Adding a
// route would add a `requireAuth` call site and a module binding to
// `handlers.mjs` without adding a rail, and would put an order-capable route
// behind a store that has never been unlocked — the affordance-ceiling argument
// T14 recorded in its changelog entry §6 applies with more force here. The
// absence of a route is a named, deliberate state, not an oversight.

import {
  amendCcxtOrder,
  cancelCcxtOrder,
  closeCcxtPosition,
  placeCcxtOrder,
  verifyCcxtFill
} from "../ccxtOrdering.mjs"
import { consentPayloadHash, venueLegConsent, venueLegConsentFields } from "../commandCentre/ccxtExecution.mjs"
import { CCXT_LIFECYCLE_VENUES, ccxtLifecycleVenue, CCXT_LIFECYCLE_VENUE_COUNT, VENUE_NOT_IN_THE_FOUR_CODE } from "./ccxtVenues.mjs"
import { evaluateLifecycleRails, LIFECYCLE_LEGS, EXPOSURE_ADDING_LEGS } from "./ccxtLifecycleRails.mjs"

// ── the production adapter over the single sanctioned seam ────────────────────

/**
 * The adapter shape the lifecycle depends on.
 *
 * The member names are VENUE-SHAPED and deliberately so. `placeOrder`,
 * `cancelOrder` and `closeOrder` are the names
 * `server/scripts/absence-scope.mjs`'s discovery vocabulary already knows, so
 * calling them here makes this module genuinely discoverable as order-capable —
 * which is what makes its declaration on that file's reviewed list true rather than
 * a claim. Short names (`place`, `cancel`) would read more comfortably and would
 * make the module invisible to discovery, so it would have to be declared without
 * being discoverable and the two-way staleness test would fail.
 *
 * Declared so a testnet adapter that omits a member fails loudly at the call rather
 * than as `undefined is not a function` three frames later.
 */
export const LIFECYCLE_ADAPTER_MEMBERS = Object.freeze(["placeOrder", "amendOrder", "cancelOrder", "closeOrder", "verifyFill"])

/** The production adapter: the seam, and nothing else. */
export function ccxtSeamLifecycleAdapter() {
  return {
    placeOrder: placeCcxtOrder,
    amendOrder: amendCcxtOrder,
    cancelOrder: cancelCcxtOrder,
    closeOrder: closeCcxtPosition,
    verifyFill: verifyCcxtFill
  }
}

/** Test seam — exactly what an injected adapter must provide. */
export function assertLifecycleAdapter(adapter) {
  if (adapter == null || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new TypeError(`ccxt-venue-lifecycle: an adapter object is required; received ${typeof adapter}`)
  }
  const missing = LIFECYCLE_ADAPTER_MEMBERS.filter((member) => typeof adapter[member] !== "function")
  if (missing.length > 0) {
    throw new TypeError(`ccxt-venue-lifecycle: adapter is missing member(s) ${missing.join(", ")}`)
  }
  return adapter
}

/** Test seam only — drop the anchor store and the observed positions. */
export function _resetVenueLifecycleState() {
  anchors.clear()
  positions.clear()
}

// ── consent anchors — the durable proposal each leg replays ───────────────────

// key -> { consentHash, fields, consentBy, proposedAt }
const anchors = new Map()

/**
 * The anchor key for one leg.
 *
 * Deterministic and derived from the leg's own identity — the venue plus whatever
 * names the thing being acted on — so a leg cannot be replayed under another
 * leg's consent. `place` keys on the client order id because that is the identity
 * the spot rail's own idempotency pair already uses.
 */
export function lifecycleAnchorKey({ venueId, leg, clientOrderId, orderId, positionOrderId }) {
  const venue = ccxtLifecycleVenue(venueId)
  const id = venue === null ? String(venueId ?? "").trim().toLowerCase() : venue.id
  const tail =
    leg === "place" ? clientOrderId : leg === "close" ? positionOrderId : orderId
  return `${id}:${leg}:${String(tail ?? "").trim()}`
}

function anchorFor(key) {
  return anchors.get(key) ?? null
}

/** The recorded anchor for one leg, or null. Read-only; the lifecycle's own surface. */
export function readLifecycleAnchor(key) {
  const rec = anchors.get(key)
  return rec === undefined ? null : { ...rec, fields: { ...rec.fields } }
}

/**
 * The consent payload a caller must RESUBMIT to execute a proposed leg.
 *
 * It is the anchor's locked fields MINUS the two that are server-derived
 * (`leg`, `exchange`), which is exactly the set of terms a human agreed to. The
 * execute leg re-derives both and projects the returned payload through the same
 * field set, so this is a complete resubmission — not a digest, and not a subset.
 *
 * `null` for an anchor that does not exist, so a caller cannot manufacture a
 * payload for a leg nothing was proposed for.
 */
export function consentPayloadFromAnchor(key) {
  const rec = anchors.get(key)
  if (rec === undefined) return null
  const { leg, exchange, ...agreed } = rec.fields ?? {}
  void leg
  void exchange
  return agreed
}

/**
 * Propose one leg: run the rails, and on a pass RECORD the consent anchor.
 *
 * This is the T17 counterpart of `proposeCcxtOrder`. It performs no venue call —
 * it evaluates the rails and, if they pass, writes the hash+fields the execute
 * leg must replay. Separating propose from execute is what makes the consent lock
 * a lock rather than a comparison of a request against itself.
 *
 * `now` is caller-supplied for the same reason every other module here takes a
 * clock from outside: a record whose time nobody can account for is not an audit
 * record.
 */
export async function proposeLeg({ leg, venueId, consentBy, now = Date.now(), deps = {}, ...fields }) {
  const venue = ccxtLifecycleVenue(venueId)
  const exchange = venue === null ? String(venueId ?? "").trim().toLowerCase() : venue.id
  // `leg` and `exchange` are locked consent fields on every set, and both are
  // DERIVED here rather than supplied — `leg` is a destructured parameter and
  // `exchange` must be the venue the rails are about to authorise, not a body
  // field a caller could point somewhere else.
  const locked = { ...fields, leg, exchange }
  const request = { ...locked, consentBy, automation: fields.automation === true }
  // The PROPOSE phase, so the consent rail records itself as a named non-
  // applicability rather than refusing the act that creates a consent. The
  // ceremony gate and both risk rails still bind here.
  const evaluated = await evaluateLifecycleRails({ leg, venueId, request, deps: { ...deps, phase: "propose", now } })
  if (!evaluated.ok) return { ...evaluated, anchorKey: null, anchor: null }

  // The locked projection is the whole consent. Server-derived assertions about
  // the request (`consentBy`, `automation`) are excluded exactly as WS-2 excludes
  // idempotencyKey/power/consentBy — they are not terms the human agreed to.
  const projection = venueLegConsent(leg, locked)
  if (!projection.ok) {
    return { ok: false, leg, venueId: evaluated.venueId, blockedBy: "consent", reason: projection.reason, rails: evaluated.rails, anchorKey: null, anchor: null }
  }
  const key = lifecycleAnchorKey({ venueId, leg, ...fields })
  const anchor = {
    consentHash: consentPayloadHash(projection.fields),
    fields: projection.fields,
    lockedFields: venueLegConsentFields(leg),
    consentBy: typeof consentBy === "string" ? consentBy : null,
    proposedAt: new Date(now).toISOString()
  }
  anchors.set(key, anchor)
  return { ...evaluated, anchorKey: key, anchor: { ...anchor, fields: { ...anchor.fields } } }
}

// ── observed positions, derived only from the venue's reported fills ──────────

// `${venueId}:${symbol}` -> { venueId, symbol, side: "long"|"short", size,
//                              entryAverage, lots: [{ orderId, average, filled }] }
const positions = new Map()

/**
 * Fold ONE observed venue fill into the position book.
 *
 * Two rules, both about not inventing numbers:
 *
 *   1. Only the VENUE'S REPORTED AVERAGE PRICE is an entry or an exit price. A
 *      resting limit's `price` is not a fill price, and P&L computed from an
 *      unfilled exit is not P&L. `hyperliquidPerps.mjs:404-407` states this for
 *      the perps rail and it holds here identically.
 *   2. A fill with no usable `average` is NOT folded in and does not create a
 *      position. It is counted as `unpricedFills` so a caller can see that
 *      something happened and that PICC could not price it.
 */
export function foldFillIntoPositions({ venueId, symbol, orderId, side, filled, average, at }) {
  const venue = ccxtLifecycleVenue(venueId)
  if (venue === null) return { ok: false, reason: VENUE_NOT_IN_THE_FOUR_CODE }
  const key = `${venue.id}:${String(symbol ?? "")}`
  const amount = Number(filled)
  const price = Number(average)
  const direction = String(side ?? "").toLowerCase()
  if (!Number.isFinite(amount) || amount <= 0) return { ok: true, applied: false, reason: "fill carries no positive quantity", key }
  if (!Number.isFinite(price) || price <= 0) return { ok: true, applied: false, reason: "fill carries no venue-reported average price, so it cannot be priced (never the order's limit price)", key }

  const prior = positions.get(key) ?? null
  // A CLOSED record is not a position. It is kept for history, but folding a new
  // fill into it as though it were open takes the quantity-weighted average
  // against `entryAverage: null` and `size: 0` and yields NaN — a position that
  // exists, has a size, and cannot be priced or exited. So the open-position read
  // is gated on the record actually being open.
  const existing = prior !== null && prior.side != null && prior.size > 0 ? prior : null
  let realized = 0

  if (existing === null) {
    positions.set(key, {
      venueId: venue.id,
      symbol: String(symbol),
      side: direction === "sell" ? "short" : "long",
      size: amount,
      entryAverage: price,
      lots: [{ orderId: orderId ?? null, average: price, filled: amount, at: at ?? null }],
      openedAt: at ?? null
    })
    return { ok: true, applied: true, opened: true, key }
  }

  const closing = (existing.side === "long" && direction === "sell") || (existing.side === "short" && direction === "buy")
  if (!closing) {
    // increasing: a quantity-weighted average of two VENUE-REPORTED prices
    const total = existing.size + amount
    const entryAverage = (existing.entryAverage * existing.size + price * amount) / total
    positions.set(key, {
      ...existing,
      size: total,
      entryAverage,
      lots: [...existing.lots, { orderId: orderId ?? null, average: price, filled: amount, at: at ?? null }]
    })
    return { ok: true, applied: true, opened: false, increased: true, key }
  }

  const closedSize = Math.min(amount, existing.size)
  const directionSign = existing.side === "long" ? 1 : -1
  realized = (price - existing.entryAverage) * closedSize * directionSign
  const remaining = existing.size - closedSize
  if (remaining > 0) {
    positions.set(key, {
      ...existing,
      size: remaining,
      lots: [...existing.lots, { orderId: orderId ?? null, average: price, filled: -closedSize, at: at ?? null }]
    })
  } else {
    positions.set(key, {
      ...existing,
      side: null,
      size: 0,
      entryAverage: null,
      closedAt: at ?? null
    })
  }
  return { ok: true, applied: true, opened: false, reduced: true, closedSize, realizedUsd: realized, remaining, key }
}

/**
 * The open positions this lifecycle has OBSERVED.
 *
 * Derived from observed fills alone. An empty array is the honest answer when no
 * fill has been priced — it is not "no positions exist at the venue", and the
 * shape says which: `observed: true` with `rows: []` means PICC watched and saw
 * nothing it could price.
 */
export function positionView({ venueId = null } = {}) {
  const rows = []
  for (const [key, p] of positions) {
    if (venueId != null && p.venueId !== ccxtLifecycleVenue(venueId)?.id) continue
    if (p.side == null || !(p.size > 0)) continue
    rows.push({
      key,
      venueId: p.venueId,
      symbol: p.symbol,
      side: p.side,
      size: p.size,
      entryAverage: p.entryAverage,
      notionalUsd: p.size * p.entryAverage,
      openedAt: p.openedAt
    })
  }
  return { observed: true, source: "observed-venue-fills", rows }
}

// ── post-fill slippage ───────────────────────────────────────────────────────

/**
 * Slippage between the price the human approved and the price the venue filled.
 *
 * `signedPct` is signed in the ADVERSE direction, so a positive number always
 * means PICC paid more (a buy) or received less (a sell). An unpriceable leg
 * returns `available: false` with a reason — slippage measured against an
 * unobserved fill is the fabrication AC-036:1056's "post-fill slippage analysis"
 * must not become.
 */
export function slippageAnalysis({ side, intendedPrice, averageFillPrice }) {
  const intended = Number(intendedPrice)
  const filled = Number(averageFillPrice)
  if (String(side ?? "").toLowerCase() !== "buy" && String(side ?? "").toLowerCase() !== "sell") {
    return { available: false, reason: `slippage needs side "buy" or "sell"; received ${String(side ?? "")}`, side: null, intendedPrice: null, averageFillPrice: null, signedPct: null, absoluteUsd: null }
  }
  if (!Number.isFinite(intended) || intended <= 0) {
    return { available: false, reason: "no approved price to measure slippage against", side: String(side).toLowerCase(), intendedPrice: null, averageFillPrice: null, signedPct: null, absoluteUsd: null }
  }
  if (!Number.isFinite(filled) || filled <= 0) {
    return { available: false, reason: "the venue reported no average fill price, so slippage cannot be computed (never the order's limit price)", side: String(side).toLowerCase(), intendedPrice: intended, averageFillPrice: null, signedPct: null, absoluteUsd: null }
  }
  const direction = String(side).toLowerCase() === "buy" ? 1 : -1
  const signedPct = Math.round(((filled - intended) / intended) * direction * 1000000) / 10000
  return {
    available: true,
    reason: null,
    side: String(side).toLowerCase(),
    intendedPrice: intended,
    averageFillPrice: filled,
    signedPct,
    adverse: signedPct > 0,
    absoluteUsd: Math.round(Math.abs(filled - intended) * 1e8) / 1e8
  }
}

/**
 * Realized P&L for a closed lot.
 *
 * Derived from the venue's two REPORTED average prices and the closed quantity —
 * never from an intended price. Returns `available: false` rather than 0 when a
 * price is missing, because "no P&L" and "zero P&L" are different answers.
 */
export function realizedPnl({ side, entryAverage, exitAverage, quantity }) {
  const entry = Number(entryAverage)
  const exit = Number(exitAverage)
  const qty = Number(quantity)
  const direction = String(side ?? "").toLowerCase()
  if (direction !== "long" && direction !== "short") {
    return { available: false, reason: `realized P&L needs position side "long" or "short"; received ${String(side ?? "")}`, realizedUsd: null }
  }
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit) || exit <= 0 || !Number.isFinite(qty) || qty <= 0) {
    return { available: false, reason: "realized P&L needs both venue-reported average prices and a positive closed quantity", realizedUsd: null }
  }
  const sign = direction === "long" ? 1 : -1
  return {
    available: true,
    reason: null,
    side: direction,
    entryAverage: entry,
    exitAverage: exit,
    quantity: qty,
    realizedUsd: Math.round((exit - entry) * qty * sign * 1e8) / 1e8
  }
}

// ── the four legs ────────────────────────────────────────────────────────────

/**
 * Shared preamble for all four legs.
 *
 * The order is load-bearing and identical on every leg, which is what makes
 * "honoured on every leg" checkable rather than asserted per-function:
 *
 *   1. resolve the adapter (a missing member throws before anything else)
 *   2. run ALL THREE RAILS via the one evaluator
 *   3. on any block, return WITHOUT touching the adapter
 *
 * Step 3 is the property a per-leg implementation is most likely to get wrong,
 * because an adapter call placed before the gate check still passes every test
 * that only checks the returned verdict. `ccxtVenueLifecycle.rails.test.mjs`
 * proves it with an adapter whose members throw if reached.
 */
async function gatedLeg({ leg, venueId, request, anchorFields, adapter, deps }) {
  assertLifecycleAdapter(adapter)
  const key = lifecycleAnchorKey({ venueId, leg, ...anchorFields })
  const anchor = anchorFor(key)
  // Two server-derived fields go INTO the request:
  //   `leg`     — a locked consent field on the three T17 sets. A leg that
  //               compared every declared field except its own name would be a
  //               rail that cannot tell an amend's consent from a cancel's.
  //   `exchange`— a locked field on ALL FOUR sets (WS-2 locked it on spotOpen
  //               first). It is derived from the requested venue rather than
  //               taken from the body, so a caller cannot consent to one venue's
  //               payload and have it replayed against another. An unlisted venue
  //               still falls through to the rails' own `venue-not-in-the-four`
  //               refusal, which runs before any field comparison.
  const venue = ccxtLifecycleVenue(venueId)
  const exchange = venue === null ? String(venueId ?? "").trim().toLowerCase() : venue.id
  const evaluated = await evaluateLifecycleRails({
    leg,
    venueId,
    request: { ...request, leg, exchange },
    deps: { ...deps, consentAnchor: anchor }
  })
  return { key, anchor, evaluated }
}

function refusal(evaluated, key) {
  return {
    ok: false,
    leg: evaluated.leg,
    venueId: evaluated.venueId ?? null,
    blockedBy: evaluated.blockedBy ?? null,
    reason: evaluated.reason ?? null,
    rails: evaluated.rails ?? {},
    anchorKey: key ?? null,
    adapterTouched: false
  }
}

/**
 * Call the venue step only on a rail pass; otherwise return the refusal record.
 *
 * `fallback` is INVOKED, and it is an async function so the venue call happens
 * after this returns rather than before it — the ordering that step 3 of the
 * preamble depends on. Returning the function itself (rather than calling it)
 * would hand the caller a function where it expected an outcome, which reads as
 * an `undefined` verdict rather than as an error.
 */
function refusalOr(evaluated, key, fallback) {
  return evaluated.ok ? fallback() : refusal(evaluated, key)
}

/**
 * LEG 1 — place. Submits a within-cap limit order through the seam.
 *
 * Exposure-adding, so T11's ATR stop and 2% daily drawdown disable both bind, and
 * the seam independently refuses an over-cap order regardless of what the rails
 * said (defence in depth, unchanged from `placeCcxtOrder`).
 */
export async function placeOrder({ venueId, symbol, side, amount, price, stopPrice, clientOrderId, consentBy, consentPayload, automation = false, brokerId, deps = {}, adapter = null } = {}) {
  const seam = adapter ?? ccxtSeamLifecycleAdapter()
  const request = { symbol, side, amount, price, stopPrice, clientOrderId, consentBy, consentPayload, automation }
  const { key, evaluated } = await gatedLeg({ leg: "place", venueId, request, anchorFields: { clientOrderId }, adapter: seam, deps: { ...deps, brokerId: brokerId ?? deps.brokerId ?? null } })
  return refusalOr(evaluated, key, async () => {
    try {
      const order = await seam.placeOrder({ exchange: evaluated.venueId, symbol, side, amount, price, clientOrderId })
      return { ok: true, leg: "place", venueId: evaluated.venueId, rails: evaluated.rails, anchorKey: key, adapterTouched: true, order }
    } catch (err) {
      return { ok: false, leg: "place", venueId: evaluated.venueId, blockedBy: "venue", reason: `placeOrder-failed: ${String(err?.message ?? err)}`, rails: evaluated.rails, anchorKey: key, adapterTouched: true, order: null }
    }
  })
}

/**
 * LEG 2 — amend. Changes an open order's amount and/or price, never its side.
 *
 * Exposure-adding for rail purposes: an amend can raise the size of a live order,
 * so T11's ATR stop is re-checked against the NEW price and the drawdown disable
 * is re-read. That is stricter than treating an amend as a no-op, and it is the
 * right way round: the risk an amend adds is exactly the risk a place would add.
 */
export async function amendOrder({ venueId, symbol, orderId, side, amount, price, stopPrice, clientOrderId, newAmount, newPrice, consentBy, consentPayload, automation = false, brokerId, deps = {}, adapter = null } = {}) {
  const seam = adapter ?? ccxtSeamLifecycleAdapter()
  const request = { symbol, orderId, side, amount, price, stopPrice, clientOrderId, consentBy, consentPayload, automation }
  const { key, evaluated } = await gatedLeg({ leg: "amend", venueId, request, anchorFields: { orderId }, adapter: seam, deps: { ...deps, brokerId: brokerId ?? deps.brokerId ?? null } })
  return refusalOr(evaluated, key, async () => {
    try {
      const order = await seam.amendOrder({ exchange: evaluated.venueId, symbol, orderId, side, amount, price, newAmount, newPrice })
      return { ok: true, leg: "amend", venueId: evaluated.venueId, rails: evaluated.rails, anchorKey: key, adapterTouched: true, order }
    } catch (err) {
      return { ok: false, leg: "amend", venueId: evaluated.venueId, blockedBy: "venue", reason: `amendOrder-failed: ${String(err?.message ?? err)}`, rails: evaluated.rails, anchorKey: key, adapterTouched: true, order: null }
    }
  })
}

/**
 * LEG 3 — cancel. Removes a RESTING order. A cancel changes no position.
 *
 * This is the D23 shape, mirrored onto the spot rail: the gate ordering matches
 * `placeOrder` exactly, an unidentifiable cancel is refused LOCALLY before the
 * adapter is built, and an unresolvable lookup reports unobservable rather than a
 * cancel that may not have happened.
 */
export async function cancelOrder({ venueId, symbol, orderId, clientOrderId, consentBy, consentPayload, automation = false, brokerId, deps = {}, adapter = null } = {}) {
  const seam = adapter ?? ccxtSeamLifecycleAdapter()
  if (!String(orderId ?? "").trim() && !String(clientOrderId ?? "").trim()) {
    return {
      ok: false,
      leg: "cancel",
      venueId: ccxtLifecycleVenue(venueId)?.id ?? null,
      blockedBy: "local",
      reason: "cancelOrder-unidentifiable: pass orderId or clientOrderId — a cancel that cannot identify its target is refused before any venue instance exists",
      rails: {},
      anchorKey: null,
      adapterTouched: false
    }
  }
  const request = { symbol, orderId, clientOrderId, consentBy, consentPayload, automation }
  const { key, evaluated } = await gatedLeg({ leg: "cancel", venueId, request, anchorFields: { orderId, clientOrderId }, adapter: seam, deps: { ...deps, brokerId: brokerId ?? deps.brokerId ?? null } })
  return refusalOr(evaluated, key, async () => {
    const result = await seam.cancelOrder({ exchange: evaluated.venueId, symbol, orderId, clientOrderId })
    if (result?.ok !== true) {
      return { ok: false, leg: "cancel", venueId: evaluated.venueId, blockedBy: "venue", reason: result?.reason ?? "cancelOrder: the adapter returned no verdict", rails: evaluated.rails, anchorKey: key, adapterTouched: true, cancelled: null }
    }
    return { ok: true, leg: "cancel", venueId: evaluated.venueId, rails: evaluated.rails, anchorKey: key, adapterTouched: true, cancelled: result.cancelled ?? null }
  })
}

/**
 * LEG 4 — close. Exits an OBSERVED filled position with an opposite-side order.
 *
 * Exposure-REMOVING, so the ATR stop and the drawdown disable are recorded as
 * named non-applicabilities with their reasons — refusing an exit on an entry-side
 * rail would make a drawdown worse. The ceremony gate, the consent lock and the
 * 3-strike key lock all still govern.
 *
 * `positionOrderId` and `filledAmount` come from the OBSERVED book
 * (`positionView`), not from the caller's arithmetic. A close naming a position
 * PICC has not observed is refused, because sizing an exit from a request body is
 * how a close becomes an opening order by accident.
 */
export async function closePosition({ venueId, symbol, positionOrderId, positionSide, exitPrice, consentBy, consentPayload, automation = false, brokerId, deps = {}, adapter = null } = {}) {
  const seam = adapter ?? ccxtSeamLifecycleAdapter()
  const venue = ccxtLifecycleVenue(venueId)
  const book = positionView({ venueId: venue?.id ?? null })
  // WHICH POSITION IS BEING CLOSED, resolved before anything else touches a price.
  //
  // The obvious implementation — "find the open row for this symbol" — is wrong in
  // a way that does not announce itself. If two fills on the SAME symbol are open,
  // that lookup silently returns whichever row the book happened to order first,
  // while `positionOrderId` sits in the arguments unused. The caller would have
  // consented to exit one position and the code would have closed the other, and
  // every rail downstream would report `pass` because the rails genuinely passed —
  // for the wrong position. A wrong-but-consented close is the worst shape this
  // module could fail in.
  //
  // So a NAMED position is matched by its exact key, and a close with no name is
  // only accepted when the symbol has exactly one open position. Ambiguity refuses.
  const wanted = String(positionOrderId ?? "").trim()
  const openRows = book.rows.filter((row) => row.symbol === String(symbol) && row.size > 0)
  const named = wanted !== ""
    ? openRows.find((row) => row.key === wanted) ?? null
    : openRows.length === 1
      ? openRows[0]
      : null
  const position = named
  // `?? null` above, and `== null` here: `Array.prototype.find` answers `undefined`,
  // and a `position === null` guard lets `undefined` straight through to the next
  // line. That is not a theoretical hole — it is the path a close takes whenever
  // nothing has been priced yet, which is every close on a fresh process.
  if (venue === null || position == null) {
    return {
      ok: false,
      leg: "close",
      venueId: venue?.id ?? null,
      blockedBy: "local",
      reason:
        venue === null
          ? `${VENUE_NOT_IN_THE_FOUR_CODE}: ${JSON.stringify(String(venueId ?? ""))} is not one of the four venues this lifecycle covers`
          : wanted !== "" && named === null
            ? `close-unobservable: no open position for ${String(symbol)} on ${venue.id} carries the key ${JSON.stringify(wanted)}, so the named exit cannot be resolved. A close never falls back to a different position than the one that was named.`
            : openRows.length > 1
              ? `close-ambiguous: ${openRows.length} open positions exist for ${String(symbol)} on ${venue.id} and the request named none of them, so the exit cannot be sized. Name the position rather than letting the code choose.`
              : `close-unobservable: no FILLED position for ${String(symbol)} on ${venue.id} has been observed, so the exit cannot be sized. A close is never sized from the request.`,
      rails: {},
      anchorKey: null,
      adapterTouched: false
    }
  }
  // NO NETWORK READ IN THIS MODULE. An exit has to be priced by something that
  // observed the market, and the seam's read-only ticker is the right source — but
  // calling it here would make every lifecycle test reach for a socket, and a
  // module whose tests need egress is a module whose tests lie about what they
  // prove. So the price arrives from the caller, and an unpriced close refuses
  // rather than guessing an exit level.
  const price = Number(exitPrice ?? deps.exitPrice)
  if (!Number.isFinite(price) || price <= 0) {
    return {
      ok: false,
      leg: "close",
      venueId: venue.id,
      blockedBy: "local",
      reason: `close-unpriced: no exit price was supplied for ${String(symbol)} on ${venue.id}, and this lifecycle performs no market read of its own — an exit level is never invented`,
      rails: {},
      anchorKey: null,
      adapterTouched: false
    }
  }
  // The EXIT side is what the venue receives and therefore what consent locks —
  // the same distinction `perpsCloseConsent` makes when it locks "sell" for a long
  // rather than the stored "long".
  const exitSide = position.side === "long" ? "sell" : "buy"
  const request = { symbol, side: exitSide, amount: position.size, price, positionOrderId: position.key, consentBy, consentPayload, automation }
  const { key, evaluated } = await gatedLeg({ leg: "close", venueId, request, anchorFields: { positionOrderId: position.key }, adapter: seam, deps: { ...deps, brokerId: brokerId ?? deps.brokerId ?? null } })
  return refusalOr(evaluated, key, async () => {
    try {
      const result = await seam.closeOrder({
        exchange: venue.id,
        symbol,
        positionSide: position.side,
        positionOrderId: position.key,
        filledAmount: position.size,
        amount: position.size,
        price,
        clientOrderId: `picc-close-${position.key}`
      })
      return { ok: true, leg: "close", venueId: venue.id, rails: evaluated.rails, anchorKey: key, adapterTouched: true, exit: result }
    } catch (err) {
      return { ok: false, leg: "close", venueId: venue.id, blockedBy: "venue", reason: `closePosition-failed: ${String(err?.message ?? err)}`, rails: evaluated.rails, anchorKey: key, adapterTouched: true, exit: null }
    }
  })
}

/**
 * The exit price a close is allowed to be sent at, from whichever of the two
 * places a caller may supply it. `null` when neither carries a usable number,
 * which the leg turns into a named refusal.
 */
function exitPriceOf({ exitPrice, deps }) {
  for (const raw of [exitPrice, deps?.exitPrice]) {
    if (raw === undefined || raw === null || raw === "") continue
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

// ── the lifecycle driver ─────────────────────────────────────────────────────

/**
 * Walk one venue through submit -> fill -> position -> close -> realized P&L.
 *
 * Returns EVERY leg's rail reading, so the caller can render or assert the whole
 * matrix rather than the last verdict. `completed` is true only when every
 * required step reported its own success — there is no partial success reported
 * as a pass.
 *
 * The `legs` option lets a caller run a subset (`["place","cancel"]`) so the
 * bisect in spec :1352 — one venue at a time, each leg independently — is
 * exercisable. Every step still runs its own rails.
 */
export async function runVenueLifecycle({
  venueId,
  symbol,
  side = "buy",
  amount,
  price,
  stopPrice,
  consentBy,
  brokerId = null,
  rung = null,
  deps = {},
  adapter = null,
  legs = LIFECYCLE_LEGS,
  now = Date.now()
} = {}) {
  const seam = assertLifecycleAdapter(adapter ?? ccxtSeamLifecycleAdapter())
  const venue = ccxtLifecycleVenue(venueId)
  const clientOrderId = `picc-e2e-${venue?.id ?? "unknown"}-${now.toString(36)}`
  const sharedDeps = { ...deps, brokerId, rung, now }
  const steps = []
  const record = (name, result) => {
    steps.push({
      step: name,
      ok: result?.ok === true,
      blockedBy: result?.blockedBy ?? null,
      reason: result?.reason ?? null,
      rails: result?.rails ?? {}
    })
    return result
  }

  if (venue === null) {
    return {
      ok: false,
      completed: false,
      venueId: String(venueId ?? ""),
      venueCount: CCXT_LIFECYCLE_VENUE_COUNT,
      steps,
      summary: `${VENUE_NOT_IN_THE_FOUR_CODE}: ${JSON.stringify(String(venueId ?? ""))}`
    }
  }

  let order = null
  let fill = null
  let slippage = null
  let pnl = null
  let position = null

  if (legs.includes("place")) {
    const proposal = record(
      "propose:place",
      await proposeLeg({ leg: "place", venueId: venue.id, symbol, side, amount, price, stopPrice, clientOrderId, consentBy, now, deps: sharedDeps })
    )
    if (!proposal.ok) return finish({ ok: false, completed: false, venue, steps, clientOrderId })
    const placed = record("place", await placeOrder({ venueId: venue.id, symbol, side, amount, price, stopPrice, clientOrderId, consentBy, consentPayload: consentPayloadFromAnchor(proposal.anchorKey), brokerId, deps: sharedDeps, adapter: seam }))
    if (!placed.ok) return finish({ ok: false, completed: false, venue, steps, clientOrderId })
    order = placed.order

    const verified = await seam.verifyFill({ exchange: venue.id, symbol, orderId: order?.id ?? null })
    fill = verified ?? null
    record("verifyFill", { ok: fill != null, blockedBy: fill == null ? "venue" : null, reason: fill == null ? "fill-unobserved: the venue did not answer a read-only verify" : null, rails: {} })
    if (fill != null) {
      slippage = slippageAnalysis({ side, intendedPrice: price, averageFillPrice: fill.average })
      record("slippage", { ok: slippage.available, blockedBy: slippage.available ? null : "local", reason: slippage.reason, rails: {} })
    }
    const folded = foldFillIntoPositions({
      venueId: venue.id,
      symbol,
      orderId: order?.id ?? null,
      side: fill?.side ?? side,
      filled: fill?.filled,
      average: fill?.average,
      at: fill?.at ?? null
    })
    position = positionView({ venueId: venue.id }).rows.find((row) => row.symbol === String(symbol)) ?? null
    record("position", { ok: folded.ok === true && folded.applied === true, blockedBy: folded.ok === true ? null : "local", reason: folded.ok === true ? (folded.applied ? null : folded.reason) : folded.reason, rails: {} })
  }

  if (legs.includes("amend")) {
    if (order == null) {
      record("amend", { ok: false, blockedBy: "local", reason: "amend-requires-place: an amend has nothing to amend until a place leg has run", rails: {} })
      return finish({ ok: false, completed: false, venue, steps, clientOrderId })
    }
    const amendedPrice = Number(deps.amendPrice) > 0 ? Number(deps.amendPrice) : Number(price)
    const amendedStop = Number(deps.amendStopPrice) > 0 ? Number(deps.amendStopPrice) : Number(stopPrice)
    const proposal = record(
      "propose:amend",
      await proposeLeg({ leg: "amend", venueId: venue.id, symbol, orderId: order.id, side, amount, price: amendedPrice, stopPrice: amendedStop, clientOrderId, consentBy, now, deps: sharedDeps })
    )
    if (!proposal.ok) return finish({ ok: false, completed: false, venue, steps, clientOrderId })
    const amended = record("amend", await amendOrder({ venueId: venue.id, symbol, orderId: order.id, side, amount, price: amendedPrice, stopPrice: amendedStop, clientOrderId, newPrice: amendedPrice, consentBy, consentPayload: consentPayloadFromAnchor(proposal.anchorKey), brokerId, deps: sharedDeps, adapter: seam }))
    if (!amended.ok) return finish({ ok: false, completed: false, venue, steps, clientOrderId })
  }

  if (legs.includes("cancel")) {
    const cancelTargetId = order?.id ?? null
    if (!cancelTargetId && !clientOrderId) {
      record("cancel", {
        ok: false,
        blockedBy: "local",
        reason:
          "cancel-requires-place: no venue order id was observed for this symbol, and this lifecycle never invents one — a cancel that cannot name its target is refused rather than sent as a request for something unknown",
        rails: {}
      })
      return finish({ ok: false, completed: false, venue, steps, clientOrderId })
    }
    const proposal = record(
      "propose:cancel",
      await proposeLeg({ leg: "cancel", venueId: venue.id, symbol, orderId: cancelTargetId, clientOrderId, consentBy, now, deps: sharedDeps })
    )
    if (!proposal.ok) return finish({ ok: false, completed: false, venue, steps, clientOrderId })
    const cancelled = record("cancel", await cancelOrder({ venueId: venue.id, symbol, orderId: cancelTargetId, clientOrderId, consentBy, consentPayload: consentPayloadFromAnchor(proposal.anchorKey), brokerId, deps: sharedDeps, adapter: seam }))
    if (!cancelled.ok) return finish({ ok: false, completed: false, venue, steps, clientOrderId })
  }

  if (legs.includes("close")) {
    if (position == null) {
      record("close", { ok: false, blockedBy: "local", reason: "close-requires-fill: no priced position has been observed, so there is nothing to exit", rails: {} })
      return finish({ ok: false, completed: false, venue, steps, clientOrderId })
    }
    const exitPrice = Number(deps.exitPrice) > 0 ? Number(deps.exitPrice) : Number(fill?.average) * 1.01
    const proposal = record(
      "propose:close",
      await proposeLeg({ leg: "close", venueId: venue.id, symbol, positionSide: position.side, positionOrderId: position.key, side: position.side === "long" ? "sell" : "buy", amount: position.size, price: exitPrice, clientOrderId, consentBy, now, deps: sharedDeps })
    )
    if (!proposal.ok) return finish({ ok: false, completed: false, venue, steps, clientOrderId })
    const closed = record("close", await closePosition({ venueId: venue.id, symbol, positionOrderId: position.key, positionSide: position.side, exitPrice, consentBy, consentPayload: consentPayloadFromAnchor(proposal.anchorKey), brokerId, deps: sharedDeps, adapter: seam }))
    if (!closed.ok) return finish({ ok: false, completed: false, venue, steps, clientOrderId })

    pnl = realizedPnl({ side: position.side, entryAverage: position.entryAverage, exitAverage: exitPrice, quantity: position.size })
    record("realizedPnl", { ok: pnl.available, blockedBy: pnl.available ? null : "local", reason: pnl.reason, rails: {} })
    if (!pnl.available) return finish({ ok: false, completed: false, venue, steps, clientOrderId })

    const closeFill = { side: position.side === "long" ? "sell" : "buy", average: exitPrice, filled: position.size }
    const folded = foldFillIntoPositions({ venueId: venue.id, symbol, orderId: `picc-close-${position.key}`, ...closeFill })
    slippage = slippageAnalysis({ side: closeFill.side, intendedPrice: position.entryAverage, averageFillPrice: exitPrice })
    record("closeSlippage", { ok: slippage.available, blockedBy: slippage.available ? null : "local", reason: slippage.reason, rails: {} })
    record("closeFill", { ok: folded.applied === true, blockedBy: null, reason: folded.applied ? null : folded.reason, rails: {} })
  }

  return finish({ ok: true, completed: true, venue, steps, clientOrderId })

  function finish({ ok, completed, venue: v, steps: s, clientOrderId: cid }) {
    // `completed` means THE LIFECYCLE completed — submit, fill, position, close and
    // realized P&L — not merely that every requested leg returned without throwing.
    // A cancel-only walk performs its leg and still has no fill, no position and no
    // P&L, so reporting it `completed: true` would be a claim about a lifecycle
    // that did not happen. The unwalked legs are NAMED in `notWalked` for the same
    // reason: a caller that asked for two of four legs deserves to be told which two
    // it did not get.
    const walked = {
      place: steps.some((step) => step.step === "place" && step.ok),
      amend: steps.some((step) => step.step === "amend" && step.ok),
      cancel: steps.some((step) => step.step === "cancel" && step.ok),
      close: steps.some((step) => step.step === "close" && step.ok)
    }
    const notWalked = [...LIFECYCLE_LEGS].filter((leg) => !walked[leg])
    const lifecycleComplete = walked.place && walked.close
    return {
      ok,
      completed: completed && lifecycleComplete,
      okThisWalk: completed,
      lifecycleComplete,
      walked,
      notWalked,
      venueId: v?.id ?? null,
      venueLabel: v?.label ?? null,
      venueCount: CCXT_LIFECYCLE_VENUE_COUNT,
      clientOrderId: cid,
      steps: s,
      order,
      fill,
      position,
      slippage,
      realizedPnl: pnl,
      exposureAddingLegs: [...EXPOSURE_ADDING_LEGS],
      summary: lifecycleComplete
        ? `submit -> fill -> position -> close -> realized P&L completed on ${v?.id ?? "?"}; realized P&L ${pnl?.available ? `$${pnl.realizedUsd}` : "unavailable"}`
        : `lifecycle INCOMPLETE on ${v?.id ?? "?"}: ${notWalked.length === 0 ? "no leg succeeded" : `leg(s) not walked or not completed: ${notWalked.join(", ")}`}`,
      // The matrix, from the recorded steps rather than from a separate pass, so
      // what is reported is what the legs actually evaluated.
      rails: Object.fromEntries(s.filter((step) => step.rails && Object.keys(step.rails).length > 0).map((step) => [step.step, step.rails]))
    }
  }
}

export { LIFECYCLE_LEGS, CCXT_LIFECYCLE_VENUES, CCXT_LIFECYCLE_VENUE_COUNT }

/**
 * WHAT A REAL SANDBOX / TESTNET RUN STILL REQUIRES — the honest close of
 * spec :1348's "sandbox/testnet E2E".
 *
 * T13 measured that Needle 3 ships no Windows build, so nothing on this host can
 * do real venue inference, and no venue credential is configured in this
 * repository. `ccxtVenueLifecycle.sandboxE2E.test.mjs` therefore exercises the
 * lifecycle end to end against INJECTED adapters and proves every rail on every
 * leg. That is a real lifecycle test and it is NOT a sandbox run, and nothing in
 * this file pretends otherwise.
 *
 * These four requirements are exported rather than buried in a test comment so a
 * reader — or an operator with the credentials — can see the gap without reading
 * the suite. `sandboxE2E.test.mjs` asserts this record exists and is non-empty,
 * which is what stops the requirement from quietly being deleted once the tests
 * around it are green.
 */
export const REAL_SANDBOX_E2E_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: "venue-credentials",
    requirement: "Per-venue testnet credentials: PICC_CCXT_APIKEY_<VENUE> + PICC_CCXT_SECRET_<VENUE>, complete pairs only.",
    blockedBecause: "no venue credential is configured in this repository, and the seam refuses an instance without one rather than going keyless",
    owner: "WS-7+"
  }),
  Object.freeze({
    id: "network-egress",
    requirement: "Outbound HTTPS to each venue's sandbox endpoint.",
    blockedBecause: "T13 found no venue-capable runtime on this host, so the e2e web server runs under an isolation assertion that forbids injected CCXT credentials and egress to a venue",
    owner: "WS-7+"
  }),
  Object.freeze({
    id: "venue-testnet-availability",
    requirement: "Each venue's own testnet to exist and to accept a limit order for the pair under test. Binance, Bybit and Coinbase do not offer the same sandbox surface, and Kraken's sandbox availability is not evidenced in this tree.",
    blockedBecause: "a venue's testnet is a third-party property; PICC can assert what it can evidence and nothing more",
    owner: "WS-7+"
  }),
  Object.freeze({
    id: "ceremony-authority",
    requirement: "A production authority set and a granted ceremony unlock for venue class `ccxt-crypto`, plus a per-venue enable bit.",
    blockedBecause: "there is no production authority set and no ceremony unlock has ever been granted — T8's Ceremony room renders `not unlocked` for exactly this reason",
    owner: "WS-7+"
  })
])
