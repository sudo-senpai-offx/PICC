// WS-7 T14 - the notification DELIVERY STATE MACHINE. Pure, no I/O, no env.
//
// D11 (spec :187, :191) requires both transports AND says "Delivery failures are
// explicit, not silent". The notifier this replaces reported four states whose
// spelling hid the very distinction D11 asks for: `skipped` was returned both
// for "this transport is not configured" AND for "every send attempt threw".
// A reader could not tell "we have nothing to send to" from "we tried and it
// broke", and the second is a failure that was being filed as a non-event.
//
// The fix is not a better name. It is a contract that makes the wrong thing
// unrepresentable:
//
//   * A transport reports ACKNOWLEDGEMENT COUNTS. Never a `success: true`.
//   * The state is DERIVED from those counts by `classifyDelivery`, which
//     accepts no boolean a transport could set. A transport that claims it
//     delivered while acknowledging zero recipients computes to `failed`, so a
//     test that mocks a transport to report success without delivering cannot
//     make the room claim the message arrived.
//
// The four states are DISTINGUISHABLE, and each answers a different question:
//
//   off         - the operator turned this transport off. Nothing was expected.
//   unavailable - nothing was sent because there was nothing to send WITH:
//                no key, or no subscriber. A NAMED absence with a reason.
//   failed      - something WAS attempted and NOT acknowledged. A real failure.
//   delivered   - at least one recipient acknowledged. The only state that may
//                license a "delivered" claim.
//
// `unavailable` and `failed` are the pair D11's AC-037 turns on: "an alert
// fires and one transport is unreachable ... the reachable transport delivers;
// the failure is explicit." Collapsing either into the other breaks the test.
//
// ABSENCE-VS-ZERO, T10's discipline, applied to a count rather than a number:
// `acknowledged: 0` is a measured zero (we tried, none arrived) and is NOT the
// same claim as `attempted: 0` (we never tried). Both are honest; they are
// different, and `summariseDeliveries` never collapses them.

/** The closed state vocabulary. Nothing outside this set may appear in a record. */
export const DELIVERY_STATES = Object.freeze({
  /** Operator disabled the transport. */
  OFF: "off",
  /** Not configured, or configured with no recipient. Nothing was attempted. */
  UNAVAILABLE: "unavailable",
  /** Attempted at least once; at least one recipient acknowledged. */
  DELIVERED: "delivered",
  /** Attempted at least once; NOTHING acknowledged. */
  FAILED: "failed"
})

/** The order the Settings room renders transports in - present first. */
export const DELIVERY_STATE_ORDER = Object.freeze([
  DELIVERY_STATES.DELIVERED,
  DELIVERY_STATES.FAILED,
  DELIVERY_STATES.UNAVAILABLE,
  DELIVERY_STATES.OFF
])

/**
 * An outcome is a frozen, fully-populated record. `reason` is `null` only for
 * `delivered` and `off`, the two states that need no explanation; the other two
 * are meaningless without one, which is enforced by `classifyDelivery` rather
 * than by convention.
 *
 * @typedef {{state: string, reason: string|null, attempted: number, acknowledged: number}} DeliveryOutcome
 */

const OUTCOME_STATES = new Set(Object.values(DELIVERY_STATES))

/** A non-negative integer, or `null` for "not measured". Never a coerced NaN. */
function countOf(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

function outcome(state, { reason = null, attempted = 0, acknowledged = 0 } = {}) {
  if (!OUTCOME_STATES.has(state)) {
    throw new Error(`unknown delivery state: ${String(state)}`)
  }
  return Object.freeze({ state, reason, attempted, acknowledged })
}

/** Operator disabled the transport. Nothing was attempted, and that is correct. */
export function offOutcome() {
  return outcome(DELIVERY_STATES.OFF)
}

/**
 * Named absence: nothing was attempted because the transport could not be.
 * `reason` MUST be a non-empty string - "unavailable" without a reason is the
 * unreadable state D11 forbids, so the constructor refuses to build one.
 */
export function unavailableOutcome(reason) {
  const text = typeof reason === "string" ? reason.trim() : ""
  if (!text) throw new Error("an unavailable delivery must name WHY it is unavailable")
  return outcome(DELIVERY_STATES.UNAVAILABLE, { reason: text })
}

/**
 * Attempted and not acknowledged. `acknowledged` is measured, not asserted, and
 * `attempted` is carried so "tried three, none arrived" is distinguishable
 * from "tried one, none arrived".
 */
export function failedOutcome({ reason, attempted = 0, acknowledged = 0 }) {
  const text = typeof reason === "string" ? reason.trim() : ""
  return outcome(DELIVERY_STATES.FAILED, {
    reason: text || "send-failed-without-a-reported-error",
    attempted: countOf(attempted) ?? 0,
    acknowledged: countOf(acknowledged) ?? 0
  })
}

/** At least one recipient acknowledged. The ONLY state that licenses a claim. */
export function deliveredOutcome({ attempted = 0, acknowledged = 0 } = {}) {
  return outcome(DELIVERY_STATES.DELIVERED, {
    attempted: countOf(attempted) ?? 0,
    acknowledged: countOf(acknowledged) ?? 0
  })
}

/**
 * THE anti-fabrication seam. Derives the state from measured counts.
 *
 * Note what is absent: there is no `success` / `ok` / `delivered` parameter. A
 * transport physically cannot assert that it delivered; it can only report how
 * many sends were attempted and how many were acknowledged, and this function
 * decides the rest. That is the whole mechanism behind "a test that mocks a
 * transport to report success without delivering anything must not be able to
 * make the room claim the message arrived".
 *
 * `reason` is only consulted for the two states that need it, and an empty
 * reason is replaced by a named default rather than being rendered as blank.
 *
 * @param {object} input
 * @param {boolean} input.configured  is the transport configured at all
 * @param {boolean} [input.userEnabled] did the operator leave it on
 * @param {number} [input.attempted]  sends attempted
 * @param {number} [input.acknowledged] sends the recipient service accepted
 * @param {string}  [input.reason]    why unavailable / why it failed
 * @returns {DeliveryOutcome}
 */
export function classifyDelivery({
  configured,
  userEnabled = true,
  attempted = 0,
  acknowledged = 0,
  reason = null
} = {}) {
  if (userEnabled === false) return offOutcome()
  if (configured !== true) return unavailableOutcome(reason || "transport-not-configured")

  const tried = countOf(attempted) ?? 0
  const acked = countOf(acknowledged) ?? 0

  // Configured, enabled, and NOTHING was attempted. The transport is live but
  // has no recipient - a named absence, NOT a failure and NOT a delivery.
  if (tried === 0) return unavailableOutcome(reason || "no-recipients")

  if (acked > 0) return deliveredOutcome({ attempted: tried, acknowledged: acked })
  return failedOutcome({ reason, attempted: tried, acknowledged: 0 })
}

/** True only for the one state that may license "the message arrived". */
export function isDelivered(o) {
  return o?.state === DELIVERY_STATES.DELIVERED && o.acknowledged > 0
}

/**
 * Reduce a whole dispatch record to the four buckets the room renders, plus the
 * ONE boolean that may be used to claim success.
 *
 * `readoutObtained` is kept SEPARATE from the buckets, per T10: a summary over
 * zero transports is "the dispatcher ran and there was nothing to report", which
 * is a different claim from "the dispatcher's readout could not be obtained".
 * A consumer that renders both as the same blank has invented a fact.
 *
 * @param {Record<string, DeliveryOutcome>} results
 * @param {{readoutObtained?: boolean}} [meta]
 */
export function summariseDeliveries(results, { readoutObtained = true } = {}) {
  const entries = Object.entries(results ?? {}).filter(([, v]) => v && OUTCOME_STATES.has(v.state))
  const of = (state) => entries.filter(([, v]) => v.state === state).map(([name]) => name).sort()

  const delivered = entries.filter(([, v]) => isDelivered(v)).map(([name, v]) => ({ transport: name, acknowledged: v.acknowledged }))
  const unavailable = entries
    .filter(([, v]) => v.state === DELIVERY_STATES.UNAVAILABLE)
    .map(([name, v]) => ({ transport: name, reason: v.reason }))
  const failed = entries
    .filter(([, v]) => v.state === DELIVERY_STATES.FAILED)
    .map(([name, v]) => ({ transport: name, reason: v.reason, attempted: v.attempted }))
  const off = of(DELIVERY_STATES.OFF)

  return Object.freeze({
    readoutObtained: readoutObtained === true,
    delivered: Object.freeze(delivered),
    unavailable: Object.freeze(unavailable),
    failed: Object.freeze(failed),
    off: Object.freeze(off),
    // THE claim. Derived from acknowledgements, so it cannot be asserted by a
    // transport that delivered nothing.
    deliveredAny: delivered.length > 0
  })
}

/**
 * The one sentence a room is allowed to show.
 *
 * TWO PROPERTIES, and the second is the one that was wrong first:
 *
 *   1. Every branch names a fact. There is no path that renders a bare "sent",
 *      and none that renders "0" for a reason it did not measure.
 *   2. A PARTIAL dispatch still reports the transports that did NOT get it.
 *      AC-037 (spec :1064) asks for both halves in one breath - "the reachable
 *      transport delivers; the failure is explicit" - and an early return on the
 *      success branch satisfies only the first. The in-app bell almost always
 *      succeeds, so a broken push or a refused Telegram would have been
 *      reported to the operator as a clean delivery, which is the silent
 *      failure D11 forbids. So the non-delivery facts are appended to EVERY
 *      branch, including the successful one.
 */
export function describeSummary(summary) {
  if (!summary || summary.readoutObtained !== true) {
    return "Notification readout unavailable - PICC could not reach the dispatcher."
  }

  // The not-delivered facts, built once and appended whatever the head says.
  const missed = []
  for (const f of summary.failed) missed.push(`${f.transport}: ${f.reason}`)
  for (const u of summary.unavailable) missed.push(`${u.transport}: ${u.reason}`)
  for (const o of summary.off) missed.push(`${o}: turned off by the operator`)

  let head
  if (summary.deliveredAny) {
    const names = summary.delivered.map((d) => d.transport).join(", ")
    head = summary.delivered.length === 1
      ? `Delivered on ${names} (${summary.delivered[0].acknowledged} acknowledged).`
      : `Delivered on ${summary.delivered.length} transports: ${names}.`
  } else if (summary.failed.length > 0) {
    head = "Not delivered."
  } else if (summary.unavailable.length > 0) {
    head = "Not delivered - no transport was configured or had a recipient."
  } else if (summary.off.length > 0) {
    head = "Not delivered - every notification transport is turned off."
  } else {
    head = "Not delivered - the dispatcher reported no transports."
  }

  return missed.length === 0 ? head : `${head} Not delivered on: ${missed.join("; ")}.`
}
