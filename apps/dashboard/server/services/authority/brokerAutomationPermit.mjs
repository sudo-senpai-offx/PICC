// WS-7 T16 — the `automationPermitted` change-event wiring. D5 / AC-024 /
// AC-035's persistence-path half.
//
// D5:130-137 — the flag defaults FALSE, auto-execute is permitted only on a
// broker whose record carries `automationPermitted === true`, setting it requires
// ministry-authority sign-off, and "the flag is a first-class field on the
// broker record with an audit event on every change".
// T16:1341 — "Every `automationPermitted` change records the approving authority."
// §4.3:634-640 — the `BrokerRecord` shape, including `permitChangedAt` and
// `permitChangedByAuthorityId`.
//
// ONE WRITE PATH, AND IT IS AUTHORITY-GATED IN BOTH DIRECTIONS.
//
//   permit  ─┐
//            ├─► setAutomationPermitted ─► [1] registered approver?
//   decline ─┘                            [2] approving authority built the room?
//                                          [3] append the change event
//                                          [4] write the record
//
// [1] and [2] refuse; nothing is written and no event is appended. [2] is the
// separation-of-duties check from `separationOfDuties.mjs`, called from HERE
// rather than only from a governance surface's render — which is what AC-035:1049
// ("the rule may not be a convention or a UI-only warning") demands in practice.
// AC-035's rule is enforced by refusing a write, not by drawing a red row.
//
// WHY A DECLINE IS GATED TOO. The literal reading of D5 — only the `true`
// direction needs sign-off — would make a decline a bare boolean assignment, and
// §4.3:638 types `permitChangedByAuthorityId` as a SINGLE field rather than a log.
// An unattributed decline therefore has to write `null` into it, destroying the
// record of who granted permission. Gating both directions is what keeps that
// field non-null after every successful change, which is exactly what plan v1
// §3.5:293-295 asks to be asserted. The full argument is in
// `__tests__/brokerAutomationPermit.test.mjs`'s header; the cost — a refused
// decline leaves the flag as it was — is bounded by the provenance-gated read
// below and is asserted there.
//
// THE READ IS PROVENANCE-GATED. `isAutomationPermitted` requires a true flag AND
// a resolvable approving authority, so a record patched with a bare boolean does
// not read as permission. That is AC-024:961's "an absent flag must not mean
// permitted" applied to provenance as well as to value, and it is the mitigation
// that makes the both-directions refusal safe.
//
// NO CLOCK. `at` is a required caller-supplied argument, so this module has no
// time source at all: the same call with the same inputs produces byte-identical
// events. The durable sink is injected (`changeSink`), and the in-memory log is
// the default — where records live is T15's (`retention.mjs`, spec :1330), and
// nothing here opens a file or writes to `server/data/`.
//
// NO TIER LOGIC. What a permit MEANS for an action is T11's `tiers.mjs:56-101`.
// This store contributes one boolean to it and nothing else.

import { authorityById } from "./authorityModel.mjs"
import { UNKNOWN_AUTHORITY_CODE, assertNoBuildApproveCollisionFor } from "./separationOfDuties.mjs"

/** The change event's name. Stable, because it is an audit-surface selector. */
export const PERMIT_CHANGE_EVENT = "automation-permitted-changed"

/** Stable code for a change refused for want of an approving authority. */
export const PERMIT_NO_AUTHORITY_CODE = "authority:deny:automation-permit-no-approving-authority"

/** Stable code for a change aimed at a broker the store does not hold. */
export const UNKNOWN_BROKER_CODE = "authority:deny:unknown-broker"

/** Stable code for a malformed call. */
export const INVALID_PERMIT_CHANGE_CODE = "authority:error:invalid-permit-change"

/**
 * D8:157-165 assigns `permanent_append_only` to veto decisions, score breakdowns
 * and execution receipts. A permit-change event is none of those three, so this
 * assignment is T16's judgement and it is the conservative one: deleting the
 * event removes the only evidence that auto-execute was ever authorised. T15 owns
 * `retention.mjs` and may re-route it; no purge path exists here either way,
 * which is the property that actually protects the record.
 */
export const PERMIT_CHANGE_RETENTION_CLASS = "permanent_append_only"

/**
 * Build a `BrokerRecord` at its D5 defaults. AC-024:962 requires the default
 * asserted "at the record type and at persistence" — this is the record type.
 *
 * The three provenance/permission fields are all defaulted and all three are
 * REFUSED as inputs. Accepting an incoming `automationPermitted` would let a
 * caller seed a permitted broker and make the default decorative.
 *
 * @param {{id: string, ceremonyUnlocked?: boolean}} input
 */
export function createBrokerRecord(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw permitError(INVALID_PERMIT_CHANGE_CODE, `authority: a broker record needs an object; received ${typeof input}`)
  }
  const { id } = input
  if (typeof id !== "string" || id.trim().length === 0) {
    throw permitError(INVALID_PERMIT_CHANGE_CODE, `authority: a broker record needs a non-empty id; received ${String(id)}`)
  }
  for (const field of ["automationPermitted", "permitChangedAt", "permitChangedByAuthorityId"]) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw permitError(
        INVALID_PERMIT_CHANGE_CODE,
        `authority: \`${field}\` may not be supplied when creating a broker record. D5 makes it default to ` +
          `false/null and reachable only through setAutomationPermitted, so a record built with it already set ` +
          `would be a permit nobody approved.`
      )
    }
  }
  return Object.freeze({
    id,
    automationPermitted: false,
    permitChangedAt: null,
    permitChangedByAuthorityId: null,
    ceremonyUnlocked: input.ceremonyUnlocked === true
  })
}

/**
 * The permit store: the broker records, plus an append-only log of every change.
 *
 * @param {object} options
 * @param {ReadonlyArray<object>} options.authorities The registered authorities.
 * @param {ReadonlyArray<object>} [options.buildRecords] The build registry the
 *   separation check reads.
 * @param {ReadonlyArray<{id: string}>} [options.brokers] Broker seeds. Only `id`
 *   (and optionally `ceremonyUnlocked`) is honoured; see `createBrokerRecord`.
 * @param {(event: object) => void} [options.changeSink] Durable sink, called once
 *   per appended event. A sink that throws propagates: losing an audit record
 *   silently is worse than failing the change.
 */
export function createBrokerAutomationPermitStore({ authorities = [], buildRecords = [], brokers = [], changeSink = null } = {}) {
  if (!Array.isArray(authorities)) {
    throw permitError(INVALID_PERMIT_CHANGE_CODE, `authority: an array of authorities is required; received ${typeof authorities}`)
  }
  if (!Array.isArray(buildRecords)) {
    throw permitError(INVALID_PERMIT_CHANGE_CODE, `authority: an array of build records is required; received ${typeof buildRecords}`)
  }
  if (!Array.isArray(brokers)) {
    throw permitError(INVALID_PERMIT_CHANGE_CODE, `authority: an array of brokers is required; received ${typeof brokers}`)
  }
  if (changeSink !== null && typeof changeSink !== "function") {
    throw permitError(INVALID_PERMIT_CHANGE_CODE, `authority: changeSink must be a function or null; received ${typeof changeSink}`)
  }

  // Length-less arrays: entries are appended and replaced, never spliced away.
  // The broker map holds records whose fields CHANGE; the event log only grows.
  const records = new Map()
  const events = []

  for (const broker of brokers) {
    records.set(broker.id, createBrokerRecord(broker))
  }

  function setAutomationPermitted({ brokerId, permitted, authorityId, roomKey, at } = {}) {
    // ---- shape -----------------------------------------------------------
    if (!records.has(brokerId)) {
      throw permitError(
        UNKNOWN_BROKER_CODE,
        `authority: unknown broker ${JSON.stringify(brokerId)}. A permit cannot be granted against a broker record ` +
          `that does not exist — that would make the flag a claim about nothing.`
      )
    }
    if (typeof permitted !== "boolean") {
      throw permitError(
        INVALID_PERMIT_CHANGE_CODE,
        `authority: \`permitted\` must be an explicit boolean; received ${String(permitted)}. ` +
          `A truthy value here would let "yes", 1 or "false" grant automation.`
      )
    }
    if (typeof at !== "number" || !Number.isFinite(at)) {
      throw permitError(
        INVALID_PERMIT_CHANGE_CODE,
        `authority: \`at\` must be a caller-supplied finite timestamp; received ${String(at)}. ` +
          `This module owns no clock, so the event's time is the caller's assertion — a permit record whose ` +
          `time nobody can account for is not an audit record.`
      )
    }
    if (typeof roomKey !== "string" || roomKey.trim().length === 0) {
      throw permitError(
        INVALID_PERMIT_CHANGE_CODE,
        `authority: \`roomKey\` is required — a permit is held under a named scope of authority, and the ` +
          `separation check is keyed on that room.`
      )
    }

    // ---- [1] a registered approving authority -----------------------------
    // Absent, blank and unregistered all refuse. An unknown approver has signed
    // nothing, so it cannot be recorded as having signed something.
    const hasAuthorityId = typeof authorityId === "string" && authorityId.trim().length > 0
    if (!hasAuthorityId) {
      throw permitError(
        PERMIT_NO_AUTHORITY_CODE,
        `authority: refusing to ${permitted ? "GRANT" : "DECLINE"} automation on broker ${JSON.stringify(brokerId)} ` +
          `without a recorded approving authority. D5 requires ministry-authority sign-off and T16 requires every ` +
          `change to record it — in BOTH directions, because §4.3:638 types permitChangedByAuthorityId as a ` +
          `single field, so an unattributed decline would erase the record of who granted it.`
      )
    }
    const authority = authorityById(authorities, authorityId)
    if (authority === null) {
      throw permitError(
        UNKNOWN_AUTHORITY_CODE,
        `authority: approving authority ${JSON.stringify(authorityId)} is not registered. An authority that does ` +
          `not exist cannot have signed anything.`
      )
    }

    // ---- [2] separation of duties, ON THE WRITE PATH ----------------------
    // Refused with the detector's own code and message, so the pair is named.
    assertNoBuildApproveCollisionFor({ authorities, buildRecords, authorityId, roomKey })

    // ---- [3] the change event, appended before the write ------------------
    const previous = records.get(brokerId)
    const event = Object.freeze({
      sequence: events.length + 1,
      event: PERMIT_CHANGE_EVENT,
      field: "automationPermitted",
      brokerId,
      from: previous.automationPermitted,
      to: permitted,
      // The approving authority, resolved to its record so the event carries who
      // it was AND the scope it acted under — D12's `scope[]`, verbatim.
      approvedByAuthorityId: authority.id,
      approvedByAuthorityTitle: authority.title,
      scope: authority.scope,
      roomKey,
      // What was checked before this event was allowed to exist.
      separationChecked: true,
      at,
      retentionClass: PERMIT_CHANGE_RETENTION_CLASS
    })

    // ---- [4] write the record ---------------------------------------------
    const next = Object.freeze({
      ...previous,
      automationPermitted: permitted,
      permitChangedAt: at,
      permitChangedByAuthorityId: authority.id
    })
    records.set(brokerId, next)
    events.push(event)
    if (changeSink !== null) changeSink(event)

    return Object.freeze({ changed: permitted !== previous.automationPermitted, event, record: next })
  }

  return Object.freeze({
    setAutomationPermitted,

    /**
     * The current record, or `null` for a broker this store does not hold.
     * Never a fabricated default: an unknown broker and an unpermitted broker
     * must not look alike to a caller.
     */
    read(brokerId) {
      const record = records.get(brokerId)
      return record === undefined ? null : record
    },

    /**
     * Is auto-execute permitted for this broker RIGHT NOW?
     *
     * Provenance-gated: a true flag whose approving authority does not resolve
     * reads `false`. That is the fail-closed half of the both-directions refusal
     * — a record patched with a bare boolean cannot read as permission.
     *
     * @param {string} brokerId
     * @param {{authorities?: ReadonlyArray<object>}} [override] Read the
     *   approver against a different authority set. T16 needs this to assert that
     *   a grant whose approver has been removed stops reading as permitted.
     */
    isAutomationPermitted(brokerId, { authorities: authSet = null } = {}) {
      const record = records.get(brokerId)
      if (record === undefined) return false
      if (record.automationPermitted !== true) return false
      if (record.permitChangedByAuthorityId === null) return false
      return authorityById(authSet ?? authorities, record.permitChangedByAuthorityId) !== null
    },

    /** Every change event for a broker, in order. The ONLY mutator is the setter. */
    changes(brokerId) {
      return Object.freeze(events.filter((event) => event.brokerId === brokerId))
    },

    /** Every change event, in order — for an audit surface that reads them all. */
    allChanges() {
      return Object.freeze([...events])
    },

    /** The broker ids this store holds. */
    brokers() {
      return Object.freeze([...records.keys()])
    },

    get size() {
      return records.size
    }
  })
}

function permitError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}