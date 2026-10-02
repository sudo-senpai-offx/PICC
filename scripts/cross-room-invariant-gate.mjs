// WS-7 T20 - the CROSS-ROOM INVARIANT GATE (AC-047 / spec :1372-1379).
//
// ============================================================================
// WHAT THIS IS, AND WHY IT IS A SEPARATE PROCESS-SAFE MODULE
// ============================================================================
//
// T20 `:1377` - "Safety/correctness blocks; performance/UX is recorded as
// best-effort." T20 `:1379` - "It runs against rooms at any completion state; a
// reserved room fails its own invariants without blocking unrelated rooms."
//
// Those two lines are the whole task, and neither is satisfiable by an
// assertion bolted onto an existing suite. So the decision function lives here,
// in plain `.mjs`, for the same reason T19's `ram-ceiling-gate.mjs` is `.mjs`:
// this gate must be RUNNABLE AS A PROCESS whose exit code a CI runner can read.
//
// THE FACTS TRAVEL AS RAW FIELDS, NEVER AS VERDICTS. The 22 completion records
// live in six TypeScript/TSX modules that a plain `node` process cannot load -
// verified, not assumed: node v24.18 refuses a `.tsx` import with
// ERR_UNKNOWN_FILE_EXTENSION, and five of the six record homes are `.tsx`. So
// `roomCompletionFacts.ts` (vitest-side, imports the records) projects them to
// plain objects and the test pipes them in on stdin.
//
// The transport therefore CANNOT smuggle a verdict: the payload this gate reads
// carries only the records' own fields (room, d1Order, verdict, ws8Handoff's
// shape, absences, reason, affordances, ceiling) and every conclusion below is
// computed HERE from a numeric measurement. An adversary who controlled the
// stdin payload still cannot make a broken room read as passing, because the
// payload has nowhere to put a verdict - only facts, which get measured.
//
// NO SECOND CONTRACT HOME. The single authority for "which rooms exist" is
// `ROOM_INVENTORY` below, transcribed from the amended freeze invariant at spec
// :73 (22 instances / 15 keys, owner-ruled 2026-09-30). `roomCompletionFacts.ts`
// IMPORTS this list rather than restating it, and the tier boundary stays pinned
// to T11's `tierBoundaryFixture.mjs` - this gate creates no fixture of its own.
//
// ============================================================================
// THE SPEC CONTRADICTION THIS GATE GATES ON 22, NOT 18
// ============================================================================
//
// AC-047 `:1142` says "The cross-room gate runs over all 18 room instances",
// D27 `:365`/`:368` and R7.5 `:421` say "All 18 rooms stay in scope", AC-020
// `:929` says the same, and the T20 task block `:1373` says "The hard gate
// across all 18 room instances". The inventory at `:73` was AMENDED to 22
// instances / 15 keys, owner-ruled 2026-09-30.
//
// This is the same class of stale text T19 found for B2. It is RECORDED here
// (see `STALE_INSTANCE_COUNT_IN_SPEC`, and changelog entry 0034) and the gate
// gates on 22, because the amendment is the later owner ruling and gating on 18
// would silently drop four rooms - Ceremony, Ministry, Strategy and Risk - from
// a safety gate. Silently "fixing" the text would be the same defect in the
// other direction: it would make a contradiction disappear without a record.

export const STALE_INSTANCE_COUNT_IN_SPEC = Object.freeze({
  staleFigure: 18,
  currentFigure: 22,
  amendedAt: "spec:73, owner-ruled 2026-09-30",
  staleAt: [
    "spec:1142 AC-047 scenario 'all 18 room instances'",
    "spec:365 D27 heading 'All 18 rooms stay in scope'",
    "spec:366 D27 context 'D1 commits all 18 room instances'",
    "spec:368 D27 decision 'All 18 rooms remain in WS-7 scope'",
    "spec:421 R7.5 'All 18 rooms stay in scope'",
    "spec:929 AC-020 prohibited side effect 'All 18 rooms stay in WS-7 scope'",
    "spec:1373 T20 scope 'The hard gate across all 18 room instances'"
  ],
  disposition:
    "RECORDED, NOT SILENTLY CORRECTED. The gate enumerates 22. Gating on 18 would drop Ceremony, Ministry, " +
    "Strategy and Risk - four instances - out of a safety gate, and the amendment at :73 is the later owner ruling. " +
    "The prose is left as the owner wrote it so the contradiction stays visible to whoever reconciles the text; " +
    "this constant is where the disagreement is recorded."
})

/* ==========================================================================
   THE FROZEN INVENTORY - the ONE place "which rooms exist" is written down.
   Suite order then router declaration order, per :73. 22 instances, 15 keys.
   ========================================================================== */

export const ROOM_INVENTORY = Object.freeze([
  // D1 order 1-6, from T7/T8/T9. Each has its own named completion constant.
  "trading/markets",
  "trading/risk",
  "trading/ceremony",
  "trading/ministry",
  "trading/strategy",
  "trading/paper",
  // D1 order 7-22, from T10's single frozen table.
  "trading/dashboard",
  "trading/autopilot",
  "trading/command-centre",
  "trading/dispatch",
  "trading/simulator",
  "trading/studio",
  "trading/settings",
  "earnings/dashboard",
  "earnings/simulator",
  "earnings/studio",
  "earnings/settings",
  "intelligence/dashboard",
  "intelligence/governor",
  "intelligence/guidance",
  "intelligence/studio",
  "intelligence/settings"
].map(Object.freeze))

/** The room KEY of each instance, in inventory order - D1's order position 1..22. */
export const INVENTORY_D1_ORDER = Object.freeze(
  ROOM_INVENTORY.map((id, i) => Object.freeze({ id, suite: id.split("/")[0], key: id.split("/")[1], d1Order: i + 1 }))
)

export const INVENTORY_SIZE = ROOM_INVENTORY.length

/** The distinct keys the twenty-two instances collapse to, as data rather than prose. */
export const INVENTORY_DISTINCT_KEYS = Object.freeze([
  ...new Set(ROOM_INVENTORY.map((id) => id.split("/")[1]))
].sort())

/* ==========================================================================
   KINDS - the blocking/best-effort split is STRUCTURAL, not a convention.
   ========================================================================== */

/**
 * AC-047's two buckets, as a closed vocabulary.
 *
 * The distinction is made structural in three places, so it cannot erode by
 * someone adding a check and forgetting a convention:
 *   1. `evaluateRoom` tags every check with a `kind` from this list.
 *   2. `gateExitCode` counts ONLY `BLOCKING_KINDS`. A best-effort finding
 *      cannot change the exit code even if it is `fail`.
 *   3. `evaluateRoom` never computes a row verdict from a best-effort check at
 *      all - it does not read `check.ok` for those.
 */
export const CHECK_KINDS = Object.freeze(["safety", "correctness", "performance", "ux"])

/** Exactly the kinds AC-047 `:1377` makes blocking. */
export const BLOCKING_KINDS = Object.freeze(["safety", "correctness"])

/** Exactly the kinds AC-047 `:1377` records without blocking. */
export const BEST_EFFORT_KINDS = Object.freeze(["performance", "ux"])

/**
 * AC-047 `:1145` prohibited side effect: "A performance result may not be used
 * to waive a safety invariant, or vice versa."
 *
 * `rowVerdict` is therefore a fold over BLOCKING checks only, and
 * `bestEffortFindings` is a separate projection. Neither reads the other. This
 * constant exists so the property is ASSERTED by a test rather than merely
 * described here.
 */
export const VERDICT_VOCABULARY = Object.freeze(["pass", "fail"])

/** The only value in `VERDICT_VOCABULARY` that a green row may carry. */
export const PASS_LIKE = Object.freeze(["pass"])

/* ==========================================================================
   FROZEN BUDGETS - every invariant compares a MEASURED NUMBER to one of these.
   ========================================================================== */

export const BUDGETS = Object.freeze({
  /** Any non-zero reading is a violation, for the 0/1 invariant readings. */
  ZERO: 0,
  /**
   * `reason` is the field that survives serialisation, so it is where a room's
   * evidence has to be. 200 is not arbitrary: CeremonyRoom.test.tsx:456 and
   * MinistryRoom.test.tsx:421 already pin `> 200` on their own rooms.
   */
  MIN_REASON_CHARS: 200,
  /** A room's interactive-affordance CEILING is zero. readOnlyRooms.ts:230, paperLive.ts:556. */
  MAX_DECLARED_INTERACTIVE_AFFORDANCES: 0,
  /** BEST-EFFORT. UX surface area: pre-existing write affordances carried by a room. */
  UX_MAX_AFFORDANCES: 8,
  /** BEST-EFFORT. Reader load: absences one room's record has to name. */
  UX_MAX_ABSENCES: 6,
  /**
   * BEST-EFFORT, in route-ish units. How many DISTINCT producer routes a
   * record names. T10 recorded `PRODUCER_SET_THIN` because some rooms report
   * service state rather than their suite's subject matter; this budget makes
   * that thinness a recorded number instead of prose.
   */
  PERF_MIN_DISTINCT_PRODUCERS: 1
})

/* ==========================================================================
   THE INVARIANTS
   ========================================================================== */

/**
 * WHY EVERY ENTRY HAS A `measure` THAT RETURNS A NUMBER.
 *
 * T19's established discipline, which this gate inherits: `PASS_LIKE` is
 * exactly `["pass"]` and `verdictForRow` has NO path that returns `pass`
 * without comparing a measured quantity to a numeric budget. The same property
 * is wanted here, so the shape enforces it:
 *
 *   - `measure(fact, ctx)` returns a NUMBER. Not a boolean, not a string, not
 *     null. A check whose measurement cannot be produced throws, and
 *     `evaluateRoom` records that as a violation rather than as a pass.
 *   - `budget` is a NUMBER. `ok` is `measured <= budget`, computed in one place.
 *   - Every row's `checks.length` MUST equal `INVARIANTS.length`. A check that
 *     returned early - skipping a measurement - changes that count, so "ran all
 *     of them" is checkable rather than promised.
 */

/**
 * WHAT COUNTS AS NAMING A PRODUCER.
 *
 * The brief's rule is that a verdict must not assert `complete` "without a
 * producer". The first cut of this predicate recognised only two forms - a source
 * path and a commit SHA - and the gate immediately reported FIVE of the real
 * twenty-two as failing it. Those five were not defective records; the predicate
 * was under-specified. Producers in this tree are named four concrete ways, and
 * all four are honoured:
 *
 *   1. a source path        `services/copilot/confluence.mjs`
 *   2. a commit SHA         `a4fac35`
 *   3. an HTTP route        `GET /api/health`, `POST /api/btcpay/invoice`
 *   4. a changelog entry    `T16 entry 0024 handoff #4`, `0024`
 *
 * `trading/paper`, `earnings/studio`, `earnings/settings`, `intelligence/
 * dashboard` and `intelligence/guidance` all name their producers by route, and
 * `trading/paper` additionally by changelog entry. A reason of "Done." still
 * measures 0 and still fails: the mutation sweep below proves each of the four
 * forms flips the check on its own, so this is four narrow tests and not one
 * broad "contains a word" test.
 */
export const PRODUCER_REFERENCE_FORMS = Object.freeze([
  Object.freeze({
    form: "source-path",
    token: /(?:[\w./-]+\.(?:mjs|mts|cts|ts|tsx|js|json|md)\b)/,
    mustMatch: "read by adapters/copilotReading.ts",
    mustNotMatch: "read by a producer the reader can find"
  }),
  Object.freeze({
    form: "commit-sha",
    token: /\b[0-9a-f]{7,40}\b/,
    mustMatch: "the engine landed at a4fac35",
    mustNotMatch: "the engine landed at an unreferenced commit"
  }),
  Object.freeze({
    form: "http-route",
    token: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9/_-]+/,
    mustMatch: "the producer GET /api/health already existed",
    mustNotMatch: "the producer get /api/health already existed"
  }),
  Object.freeze({
    form: "changelog-entry",
    token: /\b0\d{3}\b/,
    mustMatch: "T16 entry 0024 handoff #4",
    mustNotMatch: "T16 handoff #4"
  })
].map(Object.freeze))

const producerReferenceCount = (reason) =>
  PRODUCER_REFERENCE_FORMS.reduce((n, form) => (form.token.test(reason) ? n + 1 : n), 0)

/**
 * A RESERVED BLOCK, narrowly.
 *
 * AC-020:929 prohibits declaring a room COMPLETE "with a reserved block a later
 * task was expected to fill". So the shape to catch is an absence whose owner is
 * NOTHING BUT task references - `WS-7 T12` - which names a bucket and nothing
 * that can actually be done.
 *
 * The first cut of this predicate was `/^WS-7 T\d/`, which is a prefix match, and
 * the gate reported `trading/paper` for it. That room's owner is
 * "WS-7 T3 / WS-3 ceremony action - a deliberate ceremony action is a product
 * decision": it opens with a task reference and then terminates in an OWNER
 * DECISION, which is the opposite of trivially fillable. Anchoring the whole
 * match keeps that room honest and still catches the bare form; the mutation
 * sweep plants a bare `WS-7 T99` and requires it to fail.
 */
const BARE_TASK_OWNER = /^(?:WS-\d+\s+T\d+)(?:\s*\/\s*WS-\d+\s+T\d+)*$/
const PLACEHOLDER_OWNER = /^(?:tbd|to be determined|later|a later (?:ws-\d+ )?task|pending)\.?$/i

/** A record the adapter could not find at all. Every reading degrades safely. */
const ABSENT = Object.freeze({
  present: false,
  verdict: null,
  hasWs8HandoffKey: false,
  ws8HandoffKind: "absent",
  d1Order: null,
  absences: Object.freeze([]),
  reason: "",
  affordances: Object.freeze([]),
  ceiling: null
})

const num = (n) => (typeof n === "number" && Number.isFinite(n) ? n : NaN)

const nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0

/**
 * The invariant table. Order is the order findings are reported in, so it is
 * fixed and declared, not derived from object key order.
 */
export const INVARIANTS = Object.freeze([
  /* --------------------------------------------------------- safety ---- */

  Object.freeze({
    id: "safety.record-present",
    kind: "safety",
    label: "the room has a completion record at all",
    detail:
      "A room with no record is the shape D27's whole obligation exists to prevent: scope that vanishes rather than " +
      "being stated. It is measured on the inventory, not on the records array, so a room that is absent from the " +
      "records entirely is still named.",
    measure: (fact) => (fact.present === true ? 0 : 1)
  }),

  Object.freeze({
    id: "safety.ws8-handoff-key-present",
    kind: "safety",
    label: "ws8Handoff is a PRESENT key, whether its value is null or an object",
    detail:
      "T10's serialisation point (:1375-1379 of the record header, and CeremonyRoom.tsx:117-122): JSON.stringify drops " +
      "comments, so a verdict that names its boundary only in JSDoc serialises to a bare \"complete\". A record whose " +
      "`ws8Handoff` key is ABSENT reads identically to one that asked the question and answered `null`. Only " +
      "presence is checked here; the value's shape is `correctness.incomplete-requires-open-handoff`'s job.",
    measure: (fact) => (fact.hasWs8HandoffKey === true ? 0 : 1)
  }),

  Object.freeze({
    id: "safety.affordance-ceiling-is-zero",
    kind: "safety",
    label: "the room's declared interactive-affordance ceiling is zero and frozen",
    detail:
      "\"READ-ONLY ROOMS NEVER ACQUIRE A WRITE AFFORDANCE\" is enforced by EXPORTED FROZEN EMPTY DATA " +
      "(readOnlyRooms.ts:230 READ_ONLY_INTERACTIVE_AFFORDANCES, paperLive.ts:556 " +
      "PAPER_LIVE_INTERACTIVE_AFFORDANCES) precisely because \"a comment saying no affordances here cannot fail a " +
      "test\". This compares each room's own ceiling length to the zero budget, and separately requires the ceiling " +
      "to be frozen, so a consumer cannot push into a live array.",
    measure: (fact) => {
      if (fact.ceiling == null) return 1
      const length = num(fact.ceiling.length)
      const frozen = fact.ceiling.frozen === true ? 0 : 1
      if (!Number.isFinite(length)) return 1
      // Both readings are in the same unit ("violations"), so summing is honest:
      // a non-empty ceiling and an unfrozen one are both violations.
      return (length > BUDGETS.MAX_DECLARED_INTERACTIVE_AFFORDANCES ? 1 : 0) + frozen
    }
  }),

  Object.freeze({
    id: "safety.no-task-owned-absence-on-a-complete-room",
    kind: "safety",
    label: "no absence on a complete room is owned by NOTHING BUT a task reference",
    detail:
      "AC-020:929 prohibits declaring a room COMPLETE \"with a reserved block a later task was expected to fill\". The " +
      "trivially-fillable shape is an absence whose owner is a bare task id - `WS-7 T12` - or a placeholder word, " +
      "because that names a bucket and nothing that can be acted on. A compound owner that terminates in a real " +
      "owner is NOT this defect: trading/paper's `NO CEREMONY-UNLOCK PRODUCER` absence is owned by \"WS-7 T3 / WS-3 " +
      "ceremony action - a deliberate ceremony action is a product decision\", which is an owner decision rather than a " +
      "later task, so the whole-owner anchor leaves it honest. StrategyRoom.test.tsx:181 asserts the same rule for " +
      "Strategy. A room that is honestly INCOMPLETE is untouched by this rule, which is what :1379 asks for.",
    measure: (fact) => {
      if (fact.verdict !== "complete") return 0
      return (fact.absences ?? []).filter((a) => {
        const owner = nonEmptyString(a?.owner) ? a.owner.trim() : ""
        if (owner.length === 0) return false
        return BARE_TASK_OWNER.test(owner) || PLACEHOLDER_OWNER.test(owner)
      }).length
    }
  }),

  Object.freeze({
    id: "safety.affordance-declares-a-route-and-a-token",
    kind: "safety",
    label: "every declared write affordance names the route it writes and the token that renders it",
    detail:
      "ReadOnlyWriteAffordance's own field docs (readOnlyRoomCompletions.ts:73-79) require both, because \"an " +
      "affordance with no route named is indistinguishable from an affordance nobody checked\". Measured as a count " +
      "of malformed entries against the zero budget.",
    measure: (fact) =>
      (fact.affordances ?? []).filter((a) => !nonEmptyString(a?.route) || !nonEmptyString(a?.sourceToken)).length
  }),

  /* ------------------------------------------------- correctness ---- */

  Object.freeze({
    id: "correctness.verdict-declared",
    kind: "correctness",
    label: "verdict is present and is one of the two words it may be",
    detail:
      "D27 `:368` requires every room's record to state explicitly whether the room is genuinely complete or has " +
      "WS-8-boundary scope. The vocabulary is closed - `complete` | `incomplete` - so a third word, an empty string or " +
      "a missing field is a violation rather than a new verdict.",
    measure: (fact) => (fact.verdict === "complete" || fact.verdict === "incomplete" ? 0 : 1)
  }),

  Object.freeze({
    id: "correctness.d1-order-matches-inventory-position",
    kind: "correctness",
    label: "the record's own d1Order equals its position in the frozen inventory",
    detail:
      "The amended inventory at :73 enumerates the instances in D1's order, and T10's basis is suite order then " +
      "router declaration order (READ_ONLY_RESIDUAL_ORDER_BASIS). A record whose own `d1Order` disagrees with its " +
      "inventory position means the two lists have drifted, and one of them is wrong.",
    measure: (fact, ctx) => {
      if (fact.d1Order == null) return 1
      const declared = num(fact.d1Order)
      if (!Number.isFinite(declared)) return 1
      return Math.abs(declared - ctx.expectedD1Order)
    }
  }),

  Object.freeze({
    id: "correctness.d1-order-claimed-by-one-room",
    kind: "correctness",
    label: "no two rooms claim the same D1 order position",
    detail:
      "The one genuinely CROSS-room invariant in this gate, and it is still scoped: the reading is attributed to the " +
      "specific rooms that collide, computed from the fact set rather than from any global tally. If two rooms claim " +
      "position 9, both rows fail and no third room is affected.",
    measure: (fact, ctx) => (ctx.claimantsOf(fact.d1Order).length > 1 ? 1 : 0)
  }),

  Object.freeze({
    id: "correctness.complete-requires-evidence",
    kind: "correctness",
    label: "a complete verdict carries a reason long enough to name a real producer",
    detail:
      "The brief's third failure - \"a verdict asserts complete without a producer\". Made measurable two ways: the " +
      "`reason` must reach the frozen character budget, and it must name at least one producer reference in one of " +
      "the four concrete forms `PRODUCER_REFERENCE_FORMS` lists (source path, commit SHA, HTTP route, changelog " +
      "entry). The measured quantity is the NUMBER OF FORMS matched, so a reason naming one route and nothing else " +
      "measures 1 and a reason naming nothing measures 0. Incomplete rooms are exempt, which is what keeps an honest " +
      "`incomplete` legal.",
    measure: (fact) => {
      if (fact.verdict !== "complete") return 0
      const reason = nonEmptyString(fact.reason) ? fact.reason : ""
      const tooShort = reason.length < BUDGETS.MIN_REASON_CHARS ? 1 : 0
      const noProducer = producerReferenceCount(reason) > 0 ? 0 : 1
      return tooShort + noProducer
    }
  }),

  Object.freeze({
    id: "correctness.incomplete-requires-an-open-handoff",
    kind: "correctness",
    label: "an incomplete verdict carries a NAMED OPEN boundary rather than a null",
    detail:
      "The two halves of the brief's \"honestly incomplete is not a gate failure\", in one rule. `incomplete` is " +
      "PERMITTED and never blocks by itself - this check does not fire for an incomplete room. What it forbids is " +
      "`verdict: incomplete` WITH `ws8Handoff: null`, because writing `null` there claims the WS-8 question was asked " +
      "and answered when it was not. STRATEGY_COMPLETION (reservedRooms.tsx:163-165) states exactly this reasoning, " +
      "and trading/simulator (readOnlyRoomCompletions.ts:362) follows its precedent.",
    measure: (fact) => {
      if (fact.verdict !== "incomplete") return 0
      return fact.ws8HandoffKind === "object" ? 0 : 1
    }
  }),

  Object.freeze({
    id: "correctness.absences-well-formed",
    kind: "correctness",
    label: "every named absence carries what, detail, owner, and a tri-state isWs8Scope",
    detail:
      "The absence shape adopted at T8 and extended at T9/T10 (readOnlyRoomCompletions.ts:100, CeremonyRoom.tsx:123). " +
      "`isWs8Scope` is `boolean | null` on purpose: null means \"asked and not determined\", which is the same " +
      "distinction the ws8Handoff rule makes, so it is not allowed to collapse to false.",
    measure: (fact) =>
      (fact.absences ?? []).filter(
        (a) =>
          a == null ||
          !nonEmptyString(a.what) ||
          !nonEmptyString(a.detail) ||
          !nonEmptyString(a.owner) ||
          !((typeof a.isWs8Scope === "boolean") || a.isWs8Scope === null)
      ).length
  }),

  Object.freeze({
    id: "correctness.pre-existing-affordances-not-removed-by-a-gate",
    kind: "correctness",
    label: "every pre-existing affordance still declares removedByThisTask: false",
    detail:
      "T10's frozen policy (readOnlyRoomCompletions.ts:80-81): these are findings about affordances that PRE-DATE " +
      "WS-7, and T10 \"does not remove shipped product behaviour\". `removedByThisTask` is typed `false`, not " +
      "optional, so a truthy value is a room quietly claiming a removal its own policy forbids. The " +
      "`trading/command-centre` perps affordances are an OWNER DECISION that was deliberately NOT removed - see " +
      "`ownerDecisions` in the report, which surfaces them without failing.",
    measure: (fact) => (fact.affordances ?? []).filter((a) => a?.removedByThisTask !== false).length
  }),

  /* ---------------------------------------------------- performance ---- */

  Object.freeze({
    id: "perf.distinct-producer-routes",
    kind: "performance",
    label: "BEST-EFFORT - how many distinct producer routes the room's record names",
    detail:
      "An OBSERVATION, not a frame-time measurement, and labelled as one: this gate runs over completion records and " +
      "has no render telemetry, so claiming a millisecond here would be a fabricated number. What it can honestly " +
      "measure is the producer surface a room declares - T10 recorded `PRODUCER_SET_THIN` in prose for exactly this " +
      "reason. Recorded and reported; AC-047 forbids it blocking.",
    measure: (fact) => {
      const routes = new Set(
        (fact.affordances ?? [])
          .map((a) => (nonEmptyString(a?.route) ? a.route.trim() : ""))
          .filter((r) => r.length > 0)
      )
      return routes.size
    },
    /** `atLeast` reads the budget the other way round: fewer producers is worse. */
    comparison: "at-least"
  }),

  Object.freeze({
    id: "ux.declared-affordance-surface",
    kind: "ux",
    label: "BEST-EFFORT - how many pre-existing write affordances the room's surface carries",
    detail:
      "A UX surface-area observation on the room, in affordances, against a generous non-blocking budget. It exists " +
      "so \"this room is a control-dense surface\" is a NUMBER in the report rather than something a reader infers " +
      "from a table, and it can never block.",
    measure: (fact) => (fact.affordances ?? []).length
  }),

  Object.freeze({
    id: "ux.named-absence-load",
    kind: "ux",
    label: "BEST-EFFORT - how many absences one room's record asks a reader to hold",
    detail:
      "A reader-load observation, in absences. D27 makes naming absences mandatory, so a high count is not a defect " +
      "and this check never blocks; it exists so growth past the budget is VISIBLE rather than silent.",
    measure: (fact) => (fact.absences ?? []).length
  })
].map(Object.freeze))

/** Invariants by id, for tests and for the CLI's self-report. */
export const INVARIANT_IDS = Object.freeze(INVARIANTS.map((i) => i.id))

export const BLOCKING_INVARIANT_IDS = Object.freeze(
  INVARIANTS.filter((i) => BLOCKING_KINDS.includes(i.kind)).map((i) => i.id)
)

export const BEST_EFFORT_INVARIANT_IDS = Object.freeze(
  INVARIANTS.filter((i) => BEST_EFFORT_KINDS.includes(i.kind)).map((i) => i.id)
)

/** `perf.distinct-producer-routes` is the only at-least budget. */
export const AT_LEAST_INVARIANT_IDS = Object.freeze(
  INVARIANTS.filter((i) => i.comparison === "at-least").map((i) => i.id)
)

/* ==========================================================================
   THE ROOM RECORDS THIS GATE EXPECTS - named so a missing one is attributable.
   ========================================================================== */

/**
 * The six D1-order 1..6 records, and where each lives. Named here rather than
 * guessed so that a record which stops being exported is a NAMED failure. The
 * adapter asserts each path's export exists; this gate consumes the facts.
 */
export const NAMED_RECORD_SOURCES = Object.freeze([
  Object.freeze({ id: "trading/markets", symbol: "MARKETS_COMPLETION", file: "src/terminal/routes/MarketsRoom.tsx" }),
  Object.freeze({ id: "trading/risk", symbol: "RISK_COMPLETION", file: "src/terminal/routes/RiskRoom.tsx" }),
  Object.freeze({ id: "trading/ceremony", symbol: "CEREMONY_COMPLETION", file: "src/terminal/routes/CeremonyRoom.tsx" }),
  Object.freeze({ id: "trading/ministry", symbol: "MINISTRY_COMPLETION", file: "src/terminal/routes/MinistryRoom.tsx" }),
  Object.freeze({ id: "trading/strategy", symbol: "STRATEGY_COMPLETION", file: "src/pages/ministry/reservedRooms.tsx" }),
  Object.freeze({ id: "trading/paper", symbol: "PAPER_LIVE_COMPLETION", file: "src/terminal/routes/PaperLiveRoom.tsx" })
].map(Object.freeze))

/* ==========================================================================
   EVALUATION - per room, then the set. Never the other way round.
   ========================================================================== */

/**
 * The declared affordance count. `length` is the adapter's contract field;
 * `items` is accepted only so the gate's own synthetic builder can pass a real
 * frozen array. Anything else yields NaN, and the ceiling invariant reports NaN
 * as a VIOLATION rather than as an empty ceiling - a measurement that could not
 * be produced is not a pass.
 */
const ceilingLength = (c) =>
  typeof c?.length === "number" ? c.length : Array.isArray(c?.items) ? c.items.length : Number.NaN

/**
 * Evaluate ONE room. This function is the gate's only decision site and it
 * takes a single room's facts. It has no access to any other room's data except
 * the two explicitly-passed cross-room measures (`claimantsOf`, `expectedD1Order`),
 * which is what makes "one room's failure cannot smear" a structural property
 * rather than a hope.
 */
export function evaluateRoom(fact, ctx, invariants = INVARIANTS) {
  const checks = []
  for (const invariant of invariants) {
    const isAtLeast = invariant.comparison === "at-least"
    let measured
    try {
      measured = invariant.measure(fact, ctx)
    } catch (err) {
      // A measurement that cannot be produced is NOT a pass. Recording it as a
      // violation is the honest reading: the invariant did not check anything.
      checks.push(
        Object.freeze({
          id: invariant.id,
          kind: invariant.kind,
          label: invariant.label,
          measured: NaN,
          budget: isAtLeast ? BUDGETS.PERF_MIN_DISTINCT_PRODUCERS : BUDGETS.ZERO,
          comparison: isAtLeast ? "at-least" : "at-most",
          ok: false,
          note: `the measurement threw, so this invariant did not check anything: ${err?.message ?? err}`
        })
      )
      continue
    }

    if (typeof measured !== "number" || !Number.isFinite(measured)) {
      checks.push(
        Object.freeze({
          id: invariant.id,
          kind: invariant.kind,
          label: invariant.label,
          measured: NaN,
          budget: isAtLeast ? BUDGETS.PERF_MIN_DISTINCT_PRODUCERS : BUDGETS.ZERO,
          comparison: isAtLeast ? "at-least" : "at-most",
          ok: false,
          note: "the invariant returned a non-numeric measurement, which cannot be compared to a budget"
        })
      )
      continue
    }

    // The ONLY place ok is computed, for every invariant in the gate.
    const ok = isAtLeast ? measured >= budgetOf(invariant) : measured <= budgetOf(invariant)

    checks.push(
      Object.freeze({
        id: invariant.id,
        kind: invariant.kind,
        label: invariant.label,
        measured,
        budget: budgetOf(invariant),
        comparison: isAtLeast ? "at-least" : "at-most",
        ok
      })
    )
  }

  const blocking = checks.filter((c) => BLOCKING_KINDS.includes(c.kind))
  const bestEffort = checks.filter((c) => BEST_EFFORT_KINDS.includes(c.kind))

  /**
   * A row only reads `pass` if it ran the FULL blocking set. A row evaluated
   * with extra test invariants is expected to fail that count, which is why the
   * `passed` flag is computed against the real table's size rather than against
   * whatever was passed in - and why `evaluateFacts`, which never passes extras,
   * is the only path that can produce a gateable row.
   */
  const ranFullBlockingSet = blocking.length === BLOCKING_INVARIANT_IDS.length

  return Object.freeze({
    id: fact.id,
    suite: fact.suite,
    key: fact.key,
    d1Order: fact.d1Order ?? null,
    recordPresent: fact.present === true,
    verdict: fact.verdict ?? null,
    /**
     * A fold over BLOCKING checks only. Note what is absent: this expression
     * never reads a best-effort check, so no performance or UX finding can
     * move it. That is AC-047:1145's first prohibited direction, enforced by
     * the shape of the code rather than by a reviewer's attention.
     */
    verdictWord: blocking.every((c) => c.ok) && ranFullBlockingSet ? "pass" : "fail",
    checks,
    /**
     * A SEPARATE projection over the best-effort checks. Reported whatever the
     * row's verdict is, and never consulted by `verdictWord`.
     */
    bestEffortFindings: Object.freeze(
      bestEffort.filter((c) => !c.ok).map((c) => Object.freeze({ id: c.id, kind: c.kind, measured: c.measured, budget: c.budget, comparison: c.comparison }))
    ),
    blockingFailures: Object.freeze(
      blocking.filter((c) => !c.ok).map((c) => Object.freeze({ id: c.id, kind: c.kind, label: c.label, measured: c.measured, budget: c.budget }))
    )
  })
}

function budgetOf(invariant) {
  switch (invariant.id) {
    case "correctness.d1-order-matches-inventory-position":
      return 0
    case "perf.distinct-producer-routes":
      return BUDGETS.PERF_MIN_DISTINCT_PRODUCERS
    case "ux.declared-affordance-surface":
      return BUDGETS.UX_MAX_AFFORDANCES
    case "ux.named-absence-load":
      return BUDGETS.UX_MAX_ABSENCES
    case "safety.record-present":
    case "safety.ws8-handoff-key-present":
    case "correctness.verdict-declared":
    case "correctness.d1-order-claimed-by-one-room":
    case "correctness.complete-requires-evidence":
    case "correctness.incomplete-requires-an-open-handoff":
    case "correctness.absences-well-formed":
    case "correctness.pre-existing-affordances-not-removed-by-a-gate":
      return BUDGETS.ZERO
    default:
      return BUDGETS.ZERO
  }
}

/**
 * Evaluate the whole set. The room loop is independent per room; the only shared
 * derivation is the d1Order claimant index, which is itself reported per room.
 */
export function evaluateFacts(rawFacts) {
  const facts = Array.isArray(rawFacts) ? rawFacts.map(freezeFact) : []

  const claimantsByOrder = new Map()
  for (const f of facts) {
    if (f.d1Order == null) continue
    const key = String(f.d1Order)
    if (!claimantsByOrder.has(key)) claimantsByOrder.set(key, [])
    claimantsByOrder.get(key).push(f.id)
  }

  const expected = new Map(INVENTORY_D1_ORDER.map((e) => [e.id, e.d1Order]))

  const rows = facts.map((fact) => {
    const ctx = {
      expectedD1Order: expected.has(fact.id) ? expected.get(fact.id) : Number.NaN,
      claimantsOf: (d1Order) => (d1Order == null ? [] : (claimantsByOrder.get(String(d1Order)) ?? []))
    }
    return evaluateRoom(fact, ctx)
  })

  const inventoryRows = ROOM_INVENTORY.map((id) => {
    const row = rows.find((r) => r.id === id)
    // A room absent from the fact array entirely is still enumerated and still
    // reported failing, by name. This is what makes "a missing record" a
    // per-room finding instead of a crash or a silent skip.
    if (row) return row
    return evaluateRoom(
      Object.freeze({ ...ABSENT, id, suite: id.split("/")[0], key: id.split("/")[1] }),
      { expectedD1Order: expected.get(id), claimantsOf: () => [] }
    )
  })

  const extraRows = rows.filter((r) => !ROOM_INVENTORY.includes(r.id))

  const failingRooms = inventoryRows.filter((r) => r.verdictWord !== "pass").map((r) => r.id)

  return Object.freeze({
    schema: "picc-cross-room-invariant/1",
    inventorySize: INVENTORY_SIZE,
    distinctKeys: INVENTORY_DISTINCT_KEYS,
    rows: Object.freeze(inventoryRows),
    extraRows: Object.freeze(extraRows),
    /**
     * The owner decisions the brief calls out: pre-existing write affordances
     * are SURFACED, not failed on. `trading/command-centre` is the headline -
     * PerpsCommandCentre POSTs order execution and position close inside a room
     * D1 calls read-only, and that was deliberately kept.
     */
    ownerDecisions: Object.freeze(
      inventoryRows.flatMap((row) => {
        const fact = facts.find((f) => f.id === row.id)
        if (!fact) return []
        return (fact.affordances ?? []).map((a) =>
          Object.freeze({
            room: row.id,
            affordance: a.id ?? null,
            route: a.route ?? null,
            sourceToken: a.sourceToken ?? null,
            blocking: false,
            disposition: "OWNER DECISION - a pre-existing write affordance, deliberately not removed by T10 or T20"
          })
        )
      })
    ),
    bestEffortFindings: Object.freeze(
      inventoryRows.flatMap((row) => row.bestEffortFindings.map((f) => Object.freeze({ room: row.id, ...f })))
    ),
    failingRooms: Object.freeze(failingRooms),
    staleSpecText: STALE_INSTANCE_COUNT_IN_SPEC
  })
}

function freezeFact(f) {
  const src = f == null ? {} : f
  return Object.freeze({
    id: typeof src.id === "string" ? src.id : "",
    suite: typeof src.suite === "string" ? src.suite : typeof src.id === "string" ? src.id.split("/")[0] : "",
    key: typeof src.key === "string" ? src.key : typeof src.id === "string" ? src.id.split("/")[1] : "",
    present: src.present === true,
    verdict: src.verdict ?? null,
    hasWs8HandoffKey: src.hasWs8HandoffKey === true,
    ws8HandoffKind: typeof src.ws8HandoffKind === "string" ? src.ws8HandoffKind : "absent",
    d1Order: src.d1Order ?? null,
    absences: Object.freeze(Array.isArray(src.absences) ? src.absences.map((a) => Object.freeze({ ...a })) : []),
    reason: typeof src.reason === "string" ? src.reason : "",
    affordances: Object.freeze(Array.isArray(src.affordances) ? src.affordances.map((a) => Object.freeze({ ...a })) : []),
    ceiling:
      src.ceiling == null
        ? null
        : Object.freeze({
            id: typeof src.ceiling.id === "string" ? src.ceiling.id : "unnamed",
            length: ceilingLength(src.ceiling),
            frozen: src.ceiling.frozen === true
          })
  })
}

/**
 * The exit-code contract. AC-047's gate is HARD for safety, so this is the whole
 * of it: a non-zero code when any blocking invariant failed on any room, and
 * also when the gate could not see all twenty-two rooms, because a gate that
 * cannot see the rooms cannot clear them.
 *
 * `bestEffortFindings` and `ownerDecisions` are NOT read here. That is
 * AC-047:1145's second prohibited direction, enforced by omission.
 */
export function gateExitCode(report) {
  if (report == null) return 1
  const rows = Array.isArray(report.rows) ? report.rows : []
  if (rows.length !== INVENTORY_SIZE) return 1
  if (!Array.isArray(report.failingRooms) || report.failingRooms.length > 0) return 1
  if ((report.extraRows ?? []).length > 0) return 1
  // Fail closed on an incomplete evaluation: a row that did not run every
  // blocking check has not been verified, and "not verified" is not "pass".
  for (const row of rows) {
    const ranBlocking = row.checks.filter((c) => BLOCKING_KINDS.includes(c.kind)).length
    if (ranBlocking !== BLOCKING_INVARIANT_IDS.length) return 1
    if (!VERDICT_VOCABULARY.includes(row.verdictWord)) return 1
  }
  return 0
}

/* ==========================================================================
   SELF-TEST INPUT BUILDER
   ========================================================================== */

/**
 * A minimal fact set over the real inventory, used ONLY by this file's own
 * self-test branches. It is not a fixture of record and it is not an authority:
 * the real adapter builds the real facts from the real records, and the test
 * spawns the gate on THOSE. This exists so `--fail-branch` can exercise the
 * failing path through the same `evaluateFacts` -> `gateExitCode` code a real
 * run uses, without a second copy of any contract.
 */
function syntheticFact(id, overrides = {}) {
  const [suite, key] = id.split("/")
  return {
    id,
    suite,
    key,
    present: true,
    verdict: "complete",
    hasWs8HandoffKey: true,
    ws8HandoffKind: "null",
    d1Order: INVENTORY_D1_ORDER.find((e) => e.id === id).d1Order,
    absences: [],
    reason:
      "Synthetic self-test input for scripts/cross-room-invariant-gate.mjs. Carries a path reference " +
      "(scripts/cross-room-invariant-gate.mjs) so the evidence invariant is satisfied, and is NOT a record of any room.",
    affordances: [],
    ceiling: { id: "synthetic", items: [], frozen: true },
    ...overrides
  }
}

export function syntheticFactSet() {
  return INVENTORY_D1_ORDER.map((e) => syntheticFact(e.id))
}

/** A real break in a real room: Ceremony loses its serialisation-visible key. */
export function safetyBreakFactSet() {
  return syntheticFactSet().map((f) =>
    f.id === "trading/ceremony" ? { ...f, hasWs8HandoffKey: false, verdict: "complete", ws8HandoffKind: "absent" } : f
  )
}

/** A missing RECORD, so the "absent from the set entirely" path is exercised. */
export function missingRecordFactSet() {
  return syntheticFactSet().filter((f) => f.id !== "trading/ministry")
}

/** A best-effort observation only: many affordances on one room, nothing unsafe. */
export function bestEffortFactSet() {
  return syntheticFactSet().map((f) =>
    f.id === "trading/studio"
      ? {
          ...f,
          affordances: Array.from({ length: 12 }, (_, i) => ({
            id: `synthetic-affordance-${i}`,
            route: `/synthetic/route/${i}`,
            sourceToken: `SyntheticToken${i}`,
            removedByThisTask: false
          }))
        }
      : f
  )
}

/* ==========================================================================
   THE PROCESS ENTRY POINT
   ========================================================================== */

const GATE_NAME = "[picc-cross-room-gate]"

const readStdin = () =>
  new Promise((resolve, reject) => {
    let buf = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (d) => {
      buf += d
    })
    process.stdin.on("end", () => resolve(buf))
    process.stdin.on("error", reject)
  })

function printReport(report, { quiet = false } = {}) {
  if (quiet) return
  console.log(`${GATE_NAME} cross-room invariant gate`)
  console.log(`${GATE_NAME} inventory ${report.inventorySize} instances / ${report.distinctKeys.length} distinct keys`)
  for (const row of report.rows) {
    const mark = row.verdictWord === "pass" ? "pass" : "FAIL"
    const best = row.bestEffortFindings.length > 0 ? `  (best-effort: ${row.bestEffortFindings.map((f) => f.id).join(", ")})` : ""
    console.log(`${GATE_NAME}   ${mark}  ${String(row.d1Order).padStart(2)}  ${row.id.padEnd(26)} verdict=${row.verdict ?? "MISSING"}${best}`)
    for (const failure of row.blockingFailures) {
      console.log(`${GATE_NAME}          blocking: ${failure.kind}/${failure.id} measured=${failure.measured} budget=${failure.budget}`)
    }
  }
  if (report.ownerDecisions.length > 0) {
    console.log(`${GATE_NAME} owner decisions surfaced, NOT blocking: ${report.ownerDecisions.length}`)
    for (const d of report.ownerDecisions) {
      console.log(`${GATE_NAME}   ${d.room.padEnd(26)} ${String(d.affordance).padEnd(34)} -> ${d.route}`)
    }
  }
  if (report.bestEffortFindings.length > 0) {
    console.log(`${GATE_NAME} best-effort findings recorded, NOT blocking: ${report.bestEffortFindings.length}`)
    for (const f of report.bestEffortFindings) {
      console.log(`${GATE_NAME}   ${f.room.padEnd(26)} ${f.kind}/${f.id} measured=${f.measured} budget=${f.budget}`)
    }
  }
  console.log(
    `${GATE_NAME} stale spec text: ${STALE_INSTANCE_COUNT_IN_SPEC.staleFigure} recorded at ` +
      `${STALE_INSTANCE_COUNT_IN_SPEC.staleAt.length} places, current figure ${STALE_INSTANCE_COUNT_IN_SPEC.currentFigure} (${STALE_INSTANCE_COUNT_IN_SPEC.amendedAt})`
  )
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = argv.filter((a) => a !== "--quiet")
  const quiet = argv.includes("--quiet")

  if (args.includes("--inventory")) {
    console.log(ROOM_INVENTORY.join("\n"))
    return 0
  }

  if (args.includes("--fail-branch")) {
    // T19's `runFailingBranch`, for T20's gate: a REAL break in a REAL room,
    // evaluated through the same code path a real run uses, exiting non-zero.
    const report = evaluateFacts(safetyBreakFactSet())
    printReport(report, { quiet })
    const code = gateExitCode(report)
    console.error(`${GATE_NAME} FAIL BRANCH - NOT a measurement of any room, a planted safety break.`)
    console.error(`${GATE_NAME} failing rooms: ${JSON.stringify(report.failingRooms)}`)
    console.error(`${GATE_NAME} exit ${code}`)
    if (!report.failingRooms.includes("trading/ceremony")) {
      console.error(`${GATE_NAME} FAIL: the planted break did not name trading/ceremony - this gate is not a gate`)
      return 2
    }
    return code
  }

  if (args.includes("--best-effort-branch")) {
    const report = evaluateFacts(bestEffortFactSet())
    printReport(report, { quiet })
    const code = gateExitCode(report)
    console.log(`${GATE_NAME} BEST-EFFORT BRANCH - a UX observation only, and it must NOT block.`)
    console.log(`${GATE_NAME} best-effort findings: ${report.bestEffortFindings.length}`)
    console.log(`${GATE_NAME} exit ${code}`)
    return code === 0 ? 0 : 3
  }

  if (args.includes("--missing-record-branch")) {
    const report = evaluateFacts(missingRecordFactSet())
    printReport(report, { quiet })
    const code = gateExitCode(report)
    console.error(`${GATE_NAME} MISSING-RECORD BRANCH - a planted absent record, exiting ${code}.`)
    return code === 0 ? 4 : code
  }

  const fileIndex = args.indexOf("--facts-file")
  const stdinIndex = args.indexOf("--facts-stdin")
  let payload = null
  let origin = null

  if (fileIndex !== -1) {
    const { readFileSync } = await import("node:fs")
    const path = args[fileIndex + 1]
    if (!path) {
      console.error(`${GATE_NAME} FAIL: --facts-file needs a path. No facts were read, so no room was cleared.`)
      return 1
    }
    payload = readFileSync(path, "utf8")
    origin = `file ${path}`
  } else if (stdinIndex !== -1) {
    payload = await readStdin()
    origin = "stdin"
  } else {
    console.error(`${GATE_NAME} FAIL: no facts supplied. Pass --facts-stdin or --facts-file <path>.`)
    console.error(`${GATE_NAME} A gate that cannot see the rooms cannot clear them, so this exits 1 rather than 0.`)
    return 1
  }

  let facts
  try {
    facts = JSON.parse(payload)
  } catch (err) {
    console.error(`${GATE_NAME} FAIL: could not parse the facts payload from ${origin}: ${err?.message ?? err}`)
    return 1
  }

  const report = evaluateFacts(facts)
  printReport(report, { quiet })
  const code = gateExitCode(report)
  console.log(`${GATE_NAME} exit ${code} (failing rooms: ${report.failingRooms.length ? report.failingRooms.join(", ") : "none"})`)
  return code
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href

if (invokedDirectly) {
  runCli()
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {
      console.error(`${GATE_NAME} FAIL: ${err?.stack ?? err}`)
      process.exit(1)
    })
}