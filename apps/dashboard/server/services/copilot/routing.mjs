// WS-7 T13 — the D16 cloud-routing predicate. PURE. The only file T13 lands
// inside `services/copilot/` that the deterministic path must never import, and
// the test suite proves it does not (see `__tests__/modelIsolation.test.mjs`).
//
// §4.2:563 — "routing.mjs  # D16 cloud-routing predicate (pure)".
//
// D16:232 — "Only (a) A+ setups and (b) veto-boundary decisions route to a cloud
// provider (Groq/OpenRouter). Every other Copilot operation is local."
// D16:236 — "Cloud calls are enumerated, budgeted, redacted, and marked
// `provenance: \"copilot: remote\"`. The routing predicate is a pure function
// with tests. AC-040."
//
// WHAT THIS MODULE IS NOT. It does not build a cloud client, hold a key, choose
// between Groq and OpenRouter, or make a request. It answers one question —
// MAY this operation leave the device? — as a pure function of a descriptor, so
// the answer can be tabulated, reviewed, and tested exhaustively before any
// network code exists. D16's boundary is the thing being built here; D16's
// transport is somebody else's, and building it first would mean the boundary
// was whatever the client happened to allow.
//
// FAIL CLOSED, EXPLICITLY. The default branch is `local`, and there is no code
// path from an unrecognised descriptor to `cloud`. D16:234 gives the reason:
// "'Send it to the cloud' without a boundary turns a local decision system into
// a remote one whose behavior changes when a provider changes." A predicate
// that defaulted the other way would make every future malformed call a remote
// decision.
//
// `REMOTE_PROVENANCE` is the literal `contracts.ts:99` declares and the WS-6 seam
// guard regex-pins. It is re-asserted equal to that literal in the test, because
// a "cleaned up" string would silently unpin a guard three files away.

/** The literal `contracts.ts:99` types and `ws6TerminalSeamGuard` pins. */
export const REMOTE_PROVENANCE = "copilot: remote"

/**
 * The local literal. DELIBERATELY NOT the remote one.
 *
 * `contracts.ts:99` types `CopilotProvenance` as a single-member union — the
 * remote case. If a locally-computed explanation carried `"copilot: remote"`,
 * a reader could not tell a local rendering from a provider's, which is the
 * confusion AC-014 treats as a prohibited side effect. A second literal is the
 * only way to keep the two distinguishable in an audit.
 */
export const LOCAL_PROVENANCE = "copilot: local"

/**
 * Every Copilot operation the predicate can be asked about.
 *
 * The vocabulary is closed and a test enumerates every cell of
 * (operation × tier), so a new operation is a deliberate edit rather than
 * something that arrives as an `undefined` and routes somewhere by accident.
 * `explanation` is the one operation T13's own `explain.mjs` produces; it is
 * local because a local explanation needs no provider, and routing it to cloud
 * would be the failure D16 exists to prevent.
 */
export const OPERATIONS = Object.freeze([
  "setup",
  "veto-boundary",
  "explanation",
  "confluence",
  "regime",
  "tier",
  "risk",
  "unavailable-reason"
])

/**
 * The two operations D16:232 names. Kept as data so the "count the cloud cells"
 * test can detect a widening.
 *
 * `veto-boundary` routes to cloud for EVERY tier, deliberately. A veto-boundary
 * decision is a decision about the veto boundary itself, so it is exactly the
 * case that arises when the score did NOT clear A+; requiring A+ as well would
 * make the clause unreachable in the situation it was written for.
 */
export const CLOUD_OPERATIONS = Object.freeze(["setup", "veto-boundary"])

/** The only tier D16's clause (a) accepts, matched exactly. */
const APLUS_TIER = "A+"

/** The slots a cloud-derived value may never become. Named, not free text. */
const DETERMINISTIC_SLOTS = Object.freeze(["score", "veto", "execution"])

/** Named errors, so a caller branches on a code rather than on a message. */
export const ROUTING_CODES = Object.freeze({
  remoteNotDeterministic: "routing:remote-not-deterministic-input",
  unknownSlot: "routing:unknown-slot"
})

/**
 * May this operation leave the device?
 *
 * PURE. No clock, no randomness, no I/O, no network; the test asserts the
 * absence of each against this file's own source, because a routing verdict
 * that could not be reproduced from the descriptor that produced it would not
 * be a boundary.
 *
 * @param {object} descriptor `{ operation, tier }`. Anything else is refused.
 * @returns {{route: "local"|"cloud", provenance: string, deterministic: boolean,
 *            recognised: boolean, reason: string,
 *            neverDeterministicInputFor: readonly string[]}}
 */
export function routeFor(descriptor) {
  const operation = readString(descriptor, "operation")
  const tier = readString(descriptor, "tier")

  if (operation === null) {
    return localVerdict(
      false,
      `no recognisable \`operation\` in the descriptor (${describe(descriptor)}) — D16:232 permits cloud only for an A+ setup or a veto-boundary decision, and this is neither, so it runs local`
    )
  }

  if (!OPERATIONS.includes(operation)) {
    return localVerdict(
      false,
      `operation "${operation}" is not in the routing vocabulary [${OPERATIONS.join(", ")}] — D16:232 permits cloud only for an A+ setup or a veto-boundary decision, so an unrecognised operation runs local`
    )
  }

  // (b) veto-boundary decisions route to cloud, at any tier. See the note on
  // CLOUD_OPERATIONS for why requiring A+ here would make the clause unreachable.
  if (operation === "veto-boundary") {
    return cloudVerdict(`D16:232(b) — a veto-boundary decision routes to cloud (tier: ${tier ?? "none"})`)
  }

  // (a) A+ setups only. The tier comparison is EXACT: `"A+"`, `" A+ "`, `"a+"`
  // and `85` are all local, because a fuzzy match is how a B setup becomes a
  // cloud call. The malformed cases are named in the test matrix.
  if (operation === "setup" && tier === APLUS_TIER) {
    return cloudVerdict("D16:232(a) — an A+ setup routes to cloud")
  }

  if (operation === "setup") {
    return localVerdict(
      true,
      `D16:232 — only an A+ setup routes to cloud; this setup's tier is ${JSON.stringify(tier)}, so it runs local`
    )
  }

  return localVerdict(
    true,
    `D16:232 — "${operation}" is not one of the two cloud operations (A+ setup, veto-boundary), so it runs local`
  )
}

/** The boolean form, for a call site that only needs the answer. */
export function isCloudRoutable(descriptor) {
  return routeFor(descriptor).route === "cloud"
}

/**
 * Refuse a value that came from a cloud provider when it is offered as a
 * deterministic input.
 *
 * D16:232 — "A cloud response is never a deterministic input — it is an
 * explanation, with provenance marking, and it can never change a score, a veto,
 * or an execution." AC-040:1089 states the same as a prohibited side effect.
 *
 * The check keys on `provenance`, NOT on `route`, so a caller who rebuilds the
 * object and drops `route` is still caught. `route` being absent is treated as
 * cloud, which is the fail-closed direction: an object that does not say where
 * it came from is not allowed to be a score.
 *
 * @param {object} value The value being offered.
 * @param {"score"|"veto"|"execution"} slot Which deterministic input it is offered as.
 * @throws {Error} `.code = ROUTING_CODES.remoteNotDeterministic`, or
 *   `.code = ROUTING_CODES.unknownSlot` for a slot outside the three.
 */
export function assertNotDeterministicInput(value, slot) {
  if (!DETERMINISTIC_SLOTS.includes(slot)) {
    const err = new Error(
      `routing: "${slot}" is not a slot D16 governs. The three deterministic inputs a cloud response may never become are ${DETERMINISTIC_SLOTS.join(", ")}.`
    )
    err.code = ROUTING_CODES.unknownSlot
    throw err
  }

  const provenance = value === null || typeof value !== "object" ? null : value.provenance ?? null
  const route = value === null || typeof value !== "object" ? null : value.route ?? null

  // Absent provenance is treated as NOT-local. An object that does not declare
  // where it came from has not earned the right to be a score.
  if (provenance !== LOCAL_PROVENANCE && (provenance === REMOTE_PROVENANCE || route !== "local" || provenance === null)) {
    const err = new Error(
      `routing: refusing a ${provenance === null ? "provenance-less" : `"${provenance}"`} value as a deterministic ${slot}. ` +
        `D16:232 — a cloud response is an explanation and may never change a score, a veto, or an execution. ` +
        `Mark it ${REMOTE_PROVENANCE} and render it as prose, or supply a local value whose provenance is ${LOCAL_PROVENANCE}.`
    )
    err.code = ROUTING_CODES.remoteNotDeterministic
    throw err
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function cloudVerdict(reason) {
  return Object.freeze({
    route: "cloud",
    provenance: REMOTE_PROVENANCE,
    deterministic: false,
    recognised: true,
    reason,
    neverDeterministicInputFor: DETERMINISTIC_SLOTS
  })
}

function localVerdict(recognised, reason) {
  return Object.freeze({
    route: "local",
    provenance: LOCAL_PROVENANCE,
    deterministic: true,
    recognised,
    reason,
    neverDeterministicInputFor: Object.freeze([])
  })
}

/**
 * Read a field that must be a non-empty string. Returns null for anything else,
 * including a string with surrounding whitespace — `" A+ "` is a different
 * string from `"A+"` and is treated as unrecognised rather than trimmed.
 */
function readString(descriptor, field) {
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor)) return null
  const value = descriptor[field]
  if (typeof value !== "string" || value.length === 0) return null
  return value
}

function describe(descriptor) {
  if (descriptor === null) return "null"
  if (descriptor === undefined) return "undefined"
  if (Array.isArray(descriptor)) return "an array"
  if (typeof descriptor !== "object") return typeof descriptor
  return `an object with keys [${Object.keys(descriptor).join(", ")}]`
}
