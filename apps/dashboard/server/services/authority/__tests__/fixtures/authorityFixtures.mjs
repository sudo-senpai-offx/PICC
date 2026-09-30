// WS-7 T16 — authority fixtures. Every fixture is self-checked at load, so a
// later edit that breaks the shape these tests rely on fails loudly instead of
// quietly making a detector assertion vacuous.
//
// The shape the fixtures encode is the D12 collision:
//
//   collision  <=>  some room R is in authority A's `canApprove`
//                  AND authority A appears among R's builders
//
// which AC-035:1046 states as "an authority whose `canApprove` includes a room
// also appears as that room's builder". Note what is NOT in it: nothing about
// `scope`, nothing about how many authorities exist, nothing about a particular
// room name.

export const BUILD_ACTIONS = Object.freeze(["construct", "deploy", "promote"])

/**
 * The four authorities. The approval sets are chosen so that each authority's
 * approved rooms and its built rooms can be made to overlap, or not, by editing
 * the build registries alone — the records themselves are identical in both.
 */
export const BUILD_LEAD = Object.freeze({
  id: "auth:build-lead",
  title: "Trading build lead",
  scope: ["trading", "execution-surface"],
  canApprove: ["risk", "ceremony"]
})

export const REVIEW_LEAD = Object.freeze({
  id: "auth:review-lead",
  title: "Trading review lead",
  scope: ["trading", "release-governance"],
  canApprove: ["markets", "dispatch"]
})

export const TRADING_OPS = Object.freeze({
  id: "auth:trading-ops",
  title: "Trading operations",
  scope: ["trading"],
  canApprove: ["dispatch"]
})

/** Approves nothing. A legitimate record, not a malformed one. */
export const AUDIT_ONLY = Object.freeze({
  id: "auth:audit-only",
  title: "Internal audit",
  scope: ["assurance"],
  canApprove: []
})

export const AUTHORITIES = Object.freeze([BUILD_LEAD, REVIEW_LEAD, TRADING_OPS, AUDIT_ONLY])

/** One build record. `action` is the verb, per D12's build/approve vocabulary. */
export const build = (authorityId, roomKey, action = "construct") =>
  Object.freeze({ authorityId, roomKey, action })

/**
 * THE COLLIDING REGISTRY — exactly ONE collision.
 *
 * `auth:build-lead` approves `risk` (BUILD_LEAD.canApprove) and built `risk`
 * (the first record). Every other record is deliberately non-colliding, so a
 * test can assert a collision count of exactly one and a named pair rather than
 * "some collisions".
 *
 *   build-lead    builds risk      → COLLIDES (it approves risk)
 *   build-lead    builds markets   → clean    (it does not approve markets)
 *   review-lead   builds ceremony  → clean    (it approves markets, dispatch)
 *   trading-ops   builds simulator → clean    (it approves only dispatch)
 */
export const COLLIDING_BUILDS = Object.freeze([
  build(BUILD_LEAD.id, "risk", "construct"),
  build(BUILD_LEAD.id, "markets", "construct"),
  build(REVIEW_LEAD.id, "ceremony", "deploy"),
  build(TRADING_OPS.id, "simulator", "deploy")
])

/**
 * THE COMPLIANT REGISTRY — the same authorities, the same four build records,
 * the same four distinct rooms, and no overlap.
 *
 * Nothing was removed and no count was changed to achieve this; only the room
 * each verb was applied to moved. A detector that passed this by looking at
 * counts, at names, or at a hard-coded room would fail `COLLIDING_BUILDS`.
 *
 *   build-lead    builds markets   → clean (approves risk, ceremony)
 *   build-lead    builds simulator → clean
 *   review-lead   builds ceremony  → clean (approves markets, dispatch)
 *   trading-ops   builds risk      → clean (approves dispatch)
 */
export const COMPLIANT_BUILDS = Object.freeze([
  build(BUILD_LEAD.id, "markets", "construct"),
  build(BUILD_LEAD.id, "simulator", "deploy"),
  build(REVIEW_LEAD.id, "ceremony", "construct"),
  build(TRADING_OPS.id, "risk", "promote")
])

/** A build record for an authority nobody registered — referential integrity. */
export const UNREGISTERED_BUILDS = Object.freeze([build("auth:ghost", "risk", "construct")])

/**
 * A room NO authority in this fixture set has built, under EITHER registry.
 *
 * Used where a test needs an attribution assertion that is not also a separation
 * assertion. Both registries build `risk`, `markets`, `ceremony` and `simulator`
 * between them, so `dispatch` is the only room left — and it is a room two
 * authorities APPROVE, which is what makes it useful: a grant held under
 * `dispatch` is a grant whose separation check is guaranteed to pass, so if one
 * of those tests fails it is the attribution rule under test and not the
 * separation rule leaking into it.
 */
export const NEUTRAL_ROOM = "dispatch"

const buildersOfEitherRegistry = () => [
  ...new Set([...COLLIDING_BUILDS, ...COMPLIANT_BUILDS].map((r) => r.roomKey))
]

/**
 * Assert the fixtures still encode the geometry the tests claim.
 *
 * Returns `true` or throws with the reason, mirroring T12's
 * `assertFixtureGeometry`. Called at the top of the detector test file so a
 * fixture edit cannot quietly defuse an assertion.
 */
export function assertFixtureGeometry() {
  const approves = (authority, room) => authority.canApprove.includes(room)
  const builds = (records, authorityId, roomKey) =>
    records.some((r) => r.authorityId === authorityId && r.roomKey === roomKey)
  const collisionPairs = (records) =>
    AUTHORITIES.flatMap((a) =>
      a.canApprove.filter((room) => builds(records, a.id, room)).map((room) => `${a.id}/${room}`)
    )

  const problems = []
  const colliding = collisionPairs(COLLIDING_BUILDS)
  const compliant = collisionPairs(COMPLIANT_BUILDS)

  if (colliding.length !== 1 || colliding[0] !== `${BUILD_LEAD.id}/risk`) {
    problems.push(`COLLIDING_BUILDS must contain exactly one collision, ${BUILD_LEAD.id}/risk; found [${colliding.join(", ")}]`)
  }
  if (compliant.length !== 0) {
    problems.push(`COMPLIANT_BUILDS must contain no collisions; found [${compliant.join(", ")}]`)
  }
  if (approves(BUILD_LEAD, "risk") !== true || builds(COLLIDING_BUILDS, BUILD_LEAD.id, "risk") !== true) {
    problems.push("the AC-035 pair (auth:build-lead approving AND building `risk`) must be present in COLLIDING_BUILDS")
  }
  if (approves(BUILD_LEAD, "markets") || !builds(COLLIDING_BUILDS, BUILD_LEAD.id, "markets")) {
    problems.push(
      "the near-miss control needs auth:build-lead to BUILD `markets` — a room it does not approve — inside COLLIDING_BUILDS, " +
        "so the registry proves the detector is keyed on the (authority, room) pair and not on the authority alone"
    )
  }
  if (builds(COMPLIANT_BUILDS, BUILD_LEAD.id, "risk")) {
    problems.push("COMPLIANT_BUILDS must not contain auth:build-lead building a room it approves")
  }
  if (!approves(BUILD_LEAD, "risk")) {
    problems.push("COMPLIANT_BUILDS must keep auth:build-lead approving `risk`, so the near-miss control is meaningful")
  }
  if (COLLIDING_BUILDS.length !== COMPLIANT_BUILDS.length) {
    problems.push("the two registries must be the same size, so a count cannot explain the differing verdict")
  }
  const collidingRooms = new Set(COLLIDING_BUILDS.map((r) => r.roomKey))
  const compliantRooms = new Set(COMPLIANT_BUILDS.map((r) => r.roomKey))
  if (collidingRooms.size !== compliantRooms.size) {
    problems.push("the two registries must cover the same number of distinct rooms")
  }
  for (const record of [...COLLIDING_BUILDS, ...COMPLIANT_BUILDS]) {
    if (!BUILD_ACTIONS.includes(record.action)) {
      problems.push(`fixture build record uses an unknown action ${JSON.stringify(record.action)}`)
    }
  }
  if (buildersOfEitherRegistry().includes(NEUTRAL_ROOM)) {
    problems.push(
      `NEUTRAL_ROOM ${JSON.stringify(NEUTRAL_ROOM)} is built by at least one registry, so it is not a neutral room ` +
        `and any attribution assertion using it is really a separation assertion`
    )
  }

  if (problems.length > 0) {
    throw new Error(`authorityFixtures: geometry broken —\n  - ${problems.join("\n  - ")}`)
  }
  return true
}
