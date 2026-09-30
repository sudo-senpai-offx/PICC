// WS-7 T16 — the authority record. D12 / R12.1.
//
// D12:193-200 and R12.1:446 fix the shape: `{ id, title, scope[], canApprove[] }`.
// §4.3:642-648 repeats it and annotates `canApprove` as room keys.
//
// This module owns the shape and NOTHING else. It has no clock, no filesystem,
// no randomness and no network, because AC-035's rule has to be checkable from a
// fixture at any time and produce the same answer every time.
//
// WHY THE RECORD CARRIES NO `builtRooms`. §4.3:647 says an authority "must not
// appear in both its built rooms and canApprove", and the natural reading is to
// add a `builtRooms` field. Two reasons not to:
//
//   1. D12:196 says "records of EXACTLY that shape", so a fifth field is a
//      divergence from the contract the client side will eventually mirror.
//   2. A self-declared `builtRooms` list is a self-report. The build side of a
//      separation-of-duties control has to come from the build side of the
//      system, or the control is satisfied by whoever wrote the list. The build
//      registry therefore lives outside the authority record and is owned by
//      `separationOfDuties.mjs`.
//
// WHY `scope` IS CARRIED AND NOT INTERPRETED. §4.3 annotates `canApprove` and
// says nothing about `scope`; D12's collision is stated in terms of builds. So
// `scope` is validated and carried as the authority's declared remit, and no
// rule in this repository reads it as a build set. Doing so would replace
// AC-035's build/approve comparison (`:1046`) with a field comparison and would
// invent a constraint the spec never states.

/**
 * The four fields, in the spec's order. A record is this and nothing else.
 */
export const AUTHORITY_FIELDS = Object.freeze(["id", "title", "scope", "canApprove"])

/**
 * D10:175-182 — the literal reservation for anything unassigned.
 *
 * It is a DISPLAY value, never an authority id. `authorityById(authorities,
 * "WS-7+")` is asserted to be `null` in the tests: a synthesised record bearing
 * this string would satisfy a separation check and a permit approval with a
 * name no human holds, which is the fabrication D10 exists to prevent.
 */
export const UNASSIGNED_RESERVATION = "WS-7+"

/**
 * Build one validated, frozen authority record.
 *
 * @param {{id: string, title: string, scope: string[], canApprove: string[]}} input
 * @returns {Readonly<{id: string, title: string, scope: readonly string[],
 *   canApprove: readonly string[]}>}
 */
export function createAuthority(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`authority: createAuthority requires an object; received ${describe(input)}`)
  }

  const unknown = Object.keys(input).filter((key) => !AUTHORITY_FIELDS.includes(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `authority: an authority record is exactly {${AUTHORITY_FIELDS.join(", ")}}; ` +
        `unexpected field(s) ${unknown.join(", ")}. D12:196 fixes the shape, and a ` +
        `built-room list here would be a self-report the separation check could not trust.`
    )
  }

  for (const field of AUTHORITY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      throw new TypeError(`authority: an authority record requires \`${field}\`; received ${describe(input)}`)
    }
  }

  const id = requireNonEmptyString(input.id, "id")
  const title = requireNonEmptyString(input.title, "title")
  const scope = requireUniqueStringArray(input.scope, "scope")
  const canApprove = requireUniqueStringArray(input.canApprove, "canApprove")

  return Object.freeze({ id, title, scope: Object.freeze([...scope]), canApprove: Object.freeze([...canApprove]) })
}

/**
 * Build a frozen authority set, rejecting duplicate ids.
 *
 * @param {ReadonlyArray<object>} inputs
 * @returns {ReadonlyArray<object>}
 */
export function defineAuthorities(inputs) {
  if (!Array.isArray(inputs)) {
    throw new TypeError(`authority: defineAuthorities requires an array; received ${describe(inputs)}`)
  }
  const authorities = inputs.map((input) => createAuthority(input))
  const seen = new Set()
  for (const authority of authorities) {
    if (seen.has(authority.id)) {
      throw new TypeError(
        `authority: duplicate authority id ${JSON.stringify(authority.id)}. A collision report and a ` +
          `permit record both name the approving authority by id, so the id has to resolve to one record.`
      )
    }
    seen.add(authority.id)
  }
  return Object.freeze(authorities)
}

/**
 * Look one authority up. `null` when there is no such record — never a
 * synthesised stand-in.
 *
 * @param {ReadonlyArray<object>} authorities
 * @param {string} id
 * @returns {object | null}
 */
export function authorityById(authorities, id) {
  if (!Array.isArray(authorities) || typeof id !== "string") {
    return null
  }
  for (const authority of authorities) {
    if (authority !== null && authority !== undefined && authority.id === id) return authority
  }
  return null
}

/**
 * May this authority approve this room?
 *
 * An absent authority is `false`. There is no path here by which "no record"
 * becomes "permitted" — the same rule as AC-024:961's absent-flag, applied to
 * authority rather than to automation.
 *
 * @param {object | null | undefined} authority
 * @param {string} roomKey
 */
export function canApprove(authority, roomKey) {
  if (authority === null || authority === undefined || typeof authority !== "object") return false
  if (!Array.isArray(authority.canApprove)) return false
  return authority.canApprove.includes(roomKey)
}

/**
 * Every authority that may approve this room, in set order.
 *
 * An unapprovable room yields `[]`, which is an answer. A governance surface
 * that renders "unknown" for a room nobody may approve is a surface that will
 * eventually be read as "pending approval".
 *
 * @param {ReadonlyArray<object>} authorities
 * @param {string} roomKey
 * @returns {string[]}
 */
export function approversForRoom(authorities, roomKey) {
  if (!Array.isArray(authorities)) return []
  return authorities.filter((authority) => canApprove(authority, roomKey)).map((authority) => authority.id)
}

/** The literal D10 reservation, for a governance surface to display. */
export function unassignedAuthorityLabel() {
  return UNASSIGNED_RESERVATION
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`authority: \`${field}\` must be a non-empty string; received ${describe(value)}`)
  }
  return value
}

function requireUniqueStringArray(value, field) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `authority: \`${field}\` must be an array of strings; received ${describe(value)}. ` +
        `An absent list is not an empty list — write [] and say so.`
    )
  }
  const out = []
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new TypeError(`authority: every \`${field}\` entry must be a non-empty string; received ${describe(entry)}`)
    }
    if (out.includes(entry)) {
      throw new TypeError(`authority: duplicate \`${field}\` entry ${JSON.stringify(entry)}`)
    }
    out.push(entry)
  }
  return out
}

function describe(value) {
  if (value === null) return "null"
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === "object") return "an object"
  return `${typeof value} ${JSON.stringify(value) ?? String(value)}`
}
