// WS-7 T16 — the mechanical build/approve collision detector. AC-035 / R12.2 /
// D12. Pure: no clock, no network, no randomness, no filesystem, no imports.
//
// D12:196-200 — "Separation of duties is enforced mechanically: no authority may
// both build and approve the same room. … The separation rule is a test, not a
// convention. A build/approve collision is a hard failure with the offending
// pair named."
//
// AC-035:1045-1051 —
//   Scenario:  An authority whose `canApprove` includes a room also appears as
//              that room's builder.
//   Expected:  A hard failure naming the authority and the room.
//   Prohibited: The rule may not be a convention or a UI-only warning.
//
// WHY THIS FILE IMPORTS NOTHING. It is called from a write path and from a
// governance surface, and both need the same answer at different times. A
// detector that read a clock, a file or a random source would produce an AC-035
// verdict that could not be reproduced from the fixture that produced it, and
// `__tests__/separationOfDuties.test.mjs` asserts the absence of all of those
// against this source rather than trusting it. It also imports no sibling: the
// authority shape is duck-typed (`id` + `canApprove`) so the authority SET can be
// a fixture, a validated record, or a projection from persistence, without this
// module having to know which.
//
// THE CONDITION:
//
//   collision(A, R)  <=>  R ∈ A.canApprove  ∧  A ∈ builders(R)
//
// Nothing else. `scope` is not read (D12 states the collision in build terms and
// §4.3:642-648 annotates only `canApprove`). The build verb is not read as a
// filter — all three verbs are builds — only validated against a closed
// vocabulary, because an unrecognised verb that silently dropped a record would
// turn a typo into a passing control.

/**
 * The build verbs a build record may carry.
 *
 * D12 says "builds". A build reaches production by being constructed, deployed,
 * or promoted, and the last of those is the one an approval would most plausibly
 * be waved through on. Treating only the first as a build would leave the
 * control open on the verbs that actually ship.
 */
export const BUILD_ACTIONS = Object.freeze(["construct", "deploy", "promote"])

/** Stable code for a build/approve collision. */
export const COLLISION_CODE = "authority:collide:build-approve"

/** Stable code for a build record naming an authority that is not registered. */
export const UNKNOWN_AUTHORITY_CODE = "authority:error:unknown-authority"

/** Stable code for a malformed input to the detector. */
export const INVALID_INPUT_CODE = "authority:error:invalid-build-record"

/**
 * Every authority that appears in the build registry for a room, deduplicated
 * and in first-seen order.
 *
 * Order is a presentation choice made once, here, so that every consumer of the
 * registry — the collision report, the per-room projection, the error message —
 * reads the same sequence for the same input.
 *
 * @param {ReadonlyArray<{authorityId: string, roomKey: string}>} buildRecords
 * @param {string} roomKey
 * @returns {string[]}
 */
export function buildersOfRoom(buildRecords, roomKey) {
  if (!Array.isArray(buildRecords)) return []
  const out = []
  for (const record of buildRecords) {
    if (record === null || typeof record !== "object") continue
    if (record.roomKey !== roomKey) continue
    if (typeof record.authorityId !== "string" || record.authorityId.length === 0) continue
    if (!out.includes(record.authorityId)) out.push(record.authorityId)
  }
  return out
}

/**
 * The separation report for a whole registry.
 *
 * Pure, total, and order-independent: `buildRecords` is read as a set of facts,
 * so the same facts in any order produce byte-identical output. Collision order
 * is the authority set's order, never the registry's — ordering luck deciding
 * whether a control holds is exactly what T12 had to refute for C1-vs-C2.
 *
 * @param {{authorities: ReadonlyArray<object>, buildRecords: ReadonlyArray<object>}} input
 * @returns {{ok: boolean, collisions: ReadonlyArray<object>,
 *            unknownAuthorityIds: readonly string[], checkedAuthorities: number,
 *            checkedRooms: readonly string[], collisionCode: string}}
 */
export function detectBuildApproveCollisions({ authorities, buildRecords } = {}) {
  const auths = requireAuthorityArray(authorities)
  const records = requireBuildRecords(buildRecords)

  const unknownAuthorityIds = []
  for (const authorityId of buildersAcross(records)) {
    if (!hasAuthority(auths, authorityId) && !unknownAuthorityIds.includes(authorityId)) {
      unknownAuthorityIds.push(authorityId)
    }
  }

  const collisions = []
  for (const authority of auths) {
    if (!Array.isArray(authority.canApprove)) continue
    for (const roomKey of authority.canApprove) {
      const builds = buildsBy(records, authority.id, roomKey)
      if (builds.length === 0) continue
      collisions.push(
        Object.freeze({
          authorityId: authority.id,
          authorityTitle: typeof authority.title === "string" ? authority.title : null,
          roomKey,
          // Which side of the authority record produced the approval. Named so a
          // reader can see the condition was evaluated against `canApprove` and
          // not against `scope`.
          approvedVia: "canApprove",
          // Every build record that makes up the collision, so the report can be
          // checked rather than believed. Sorted by verb, NOT left in registry
          // order: the registry is a set of facts, and a position in it is not a
          // fact. A `recordIndex` here would make two runs over the same facts
          // disagree, which is the ordering luck T12 had to refute for C1-vs-C2.
          builds: Object.freeze(
            builds
              .map((record) => record.action)
              .slice()
              .sort()
              .map((action) => Object.freeze({ action }))
          ),
          buildCount: builds.length
        })
      )
    }
  }

  return Object.freeze({
    ok: collisions.length === 0,
    collisions: Object.freeze(collisions),
    unknownAuthorityIds: Object.freeze(unknownAuthorityIds),
    checkedAuthorities: auths.length,
    checkedRooms: Object.freeze([...new Set(roomsAcross(records))].sort()),
    collisionCode: COLLISION_CODE
  })
}

/**
 * The throwing form. AC-035:1049 forbids a convention and a UI-only warning, so
 * something has to refuse.
 *
 * @param {{authorities: ReadonlyArray<object>, buildRecords: ReadonlyArray<object>}} input
 * @throws {Error} `.code === COLLISION_CODE` naming every offending pair, or
 *   `.code === UNKNOWN_AUTHORITY_CODE` when a build names an unregistered
 *   authority. Unregistered builders are refused here rather than ignored: a
 *   build that matches no authority record can never collide, so ignoring it
 *   would let the registry pass on missing evidence.
 */
export function assertNoBuildApproveCollisions({ authorities, buildRecords } = {}) {
  const report = detectBuildApproveCollisions({ authorities, buildRecords })
  if (report.collisions.length > 0) {
    const pairs = report.collisions
      .map((c) => `  - authority ${JSON.stringify(c.authorityId)} may approve room ${JSON.stringify(c.roomKey)} and built it (${c.builds.map((b) => b.action).join(", ")})`)
      .join("\n")
    throw separationError(
      COLLISION_CODE,
      `authority: build/approve collision [${COLLISION_CODE}] — separation of duties (D12) forbids an authority that both builds and approves the same room.\n${pairs}`,
      { report }
    )
  }
  if (report.unknownAuthorityIds.length > 0) {
    throw separationError(
      UNKNOWN_AUTHORITY_CODE,
      `authority: build registry names authorities that are not registered: ${report.unknownAuthorityIds.join(", ")}. ` +
        `A build by an unregistered authority cannot collide with anything, so it must not be treated as clean.`,
      { report }
    )
  }
  return report
}

/**
 * The focused check for ONE (authority, room) pair.
 *
 * This is the form the permit write path uses, and the distinction matters: it
 * refuses a grant whose APPROVING authority built the room the grant is held
 * under. It deliberately does not refuse a grant because some unrelated
 * authority collides with some unrelated room — the aggregate form is
 * `assertNoBuildApproveCollisions`, and the governance surface and T21's seam
 * guard are its callers. Refusing every automation grant on any registry
 * collision anywhere would make one pre-existing collision freeze automation
 * permanently, which is a denial of service rather than a control.
 *
 * @param {{authorities: ReadonlyArray<object>, buildRecords: ReadonlyArray<object>,
 *          authorityId: string, roomKey: string}} input
 */
export function assertNoBuildApproveCollisionFor({ authorities, buildRecords, authorityId, roomKey } = {}) {
  const auths = requireAuthorityArray(authorities)
  const records = requireBuildRecords(buildRecords)

  if (typeof authorityId !== "string" || authorityId.length === 0) {
    throw separationError(INVALID_INPUT_CODE, `authority: an approving authorityId is required; received ${String(authorityId)}`)
  }
  if (typeof roomKey !== "string" || roomKey.length === 0) {
    throw separationError(INVALID_INPUT_CODE, `authority: a roomKey is required; received ${String(roomKey)}`)
  }

  const authority = auths.find((candidate) => candidate.id === authorityId)
  if (authority === undefined) {
    throw separationError(
      UNKNOWN_AUTHORITY_CODE,
      `authority: approving authority ${JSON.stringify(authorityId)} is not registered. ` +
        `An unknown approver is refused, not treated as an authority with an empty build history.`
    )
  }

  const builds = buildsBy(records, authorityId, roomKey)
  if (builds.length > 0) {
    throw separationError(
      COLLISION_CODE,
      `authority: build/approve collision [${COLLISION_CODE}] — approving authority ${JSON.stringify(authorityId)} ` +
        `built room ${JSON.stringify(roomKey)} and may approve it ` +
        `(${builds.map((b) => b.action).join(", ")}). An authority that builds a room and then approves ` +
        `it is not a control (D12).`,
      { authorityId, roomKey, builds: builds.map((b) => b.action) }
    )
  }
  return Object.freeze({ authorityId, roomKey, builds: Object.freeze([]) })
}

/**
 * The per-room projection a governance surface renders.
 *
 * `roomKey` is an opaque string. It is never looked up in a room table, so this
 * works for a room that has no route key yet — which is the Ministry room's
 * actual state until T7R-A's amendment adds one.
 *
 * @param {{authorities: ReadonlyArray<object>, buildRecords: ReadonlyArray<object>, roomKey: string}} input
 */
export function describeRoomSeparation({ authorities, buildRecords, roomKey } = {}) {
  const auths = requireAuthorityArray(authorities)
  const records = requireBuildRecords(buildRecords)
  if (typeof roomKey !== "string" || roomKey.length === 0) {
    throw separationError(INVALID_INPUT_CODE, `authority: a roomKey is required; received ${String(roomKey)}`)
  }

  const builders = buildersOfRoom(records, roomKey)
  const approvers = auths.filter((a) => Array.isArray(a.canApprove) && a.canApprove.includes(roomKey)).map((a) => a.id)
  const collisions = approvers
    .filter((authorityId) => builders.includes(authorityId))
    .map((authorityId) => {
      const authority = auths.find((a) => a.id === authorityId)
      return Object.freeze({
        authorityId,
        authorityTitle: typeof authority?.title === "string" ? authority.title : null,
        roomKey,
        approvedVia: "canApprove",
        builds: Object.freeze(
          buildsBy(records, authorityId, roomKey).map((record) => Object.freeze({ action: record.action }))
        )
      })
    })

  return Object.freeze({
    roomKey,
    builders: Object.freeze(builders),
    approvers: Object.freeze(approvers),
    collisions: Object.freeze(collisions),
    separated: collisions.length === 0
  })
}

// ---------------------------------------------------------------------------
// Internals. No I/O, no clock, no imports.
// ---------------------------------------------------------------------------

function separationError(code, message, extra) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, extra)
  return error
}

function requireAuthorityArray(authorities) {
  if (!Array.isArray(authorities)) {
    throw separationError(INVALID_INPUT_CODE, `authority: an array of authorities is required; received ${describe(authorities)}`)
  }
  return authorities
}

function requireBuildRecords(buildRecords) {
  if (!Array.isArray(buildRecords)) {
    throw separationError(INVALID_INPUT_CODE, `authority: an array of build records is required; received ${describe(buildRecords)}`)
  }
  for (const record of buildRecords) {
    if (record === null || typeof record !== "object") {
      throw separationError(INVALID_INPUT_CODE, `authority: a build record must be an object; received ${describe(record)}`)
    }
    if (typeof record.authorityId !== "string" || record.authorityId.length === 0) {
      throw separationError(INVALID_INPUT_CODE, `authority: a build record needs a non-empty authorityId; received ${describe(record.authorityId)}`)
    }
    if (typeof record.roomKey !== "string" || record.roomKey.length === 0) {
      throw separationError(INVALID_INPUT_CODE, `authority: a build record needs a non-empty roomKey; received ${describe(record.roomKey)}`)
    }
    if (!BUILD_ACTIONS.includes(record.action)) {
      // Rejected, not ignored. A verb this module does not recognise is either a
      // typo or a new verb someone believes is not a build; dropping it would
      // make the detector pass on evidence it never read.
      throw separationError(
        INVALID_INPUT_CODE,
        `authority: unknown build action ${JSON.stringify(record.action)}; expected one of ${BUILD_ACTIONS.join(", ")}. ` +
          `An unrecognised verb is refused rather than ignored — dropping it would turn a typo into a passing control.`
      )
    }
  }
  return buildRecords
}

function hasAuthority(auths, authorityId) {
  return auths.some((candidate) => candidate !== null && typeof candidate === "object" && candidate.id === authorityId)
}

function buildersAcross(records) {
  const out = []
  for (const record of records) {
    if (!out.includes(record.authorityId)) out.push(record.authorityId)
  }
  return out
}

function roomsAcross(records) {
  return records.map((record) => record.roomKey)
}

function buildsBy(records, authorityId, roomKey) {
  return records.filter((record) => record.authorityId === authorityId && record.roomKey === roomKey)
}

function describe(value) {
  if (value === null) return "null"
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === "object") return "an object"
  return `${typeof value} ${JSON.stringify(value) ?? String(value)}`
}
