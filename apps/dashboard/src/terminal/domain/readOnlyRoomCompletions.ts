import { READ_ONLY_OWNER } from "./readOnlyRooms"
import type { ReadOnlyRoomKey, ReadOnlySuiteId } from "./readOnlyRooms"

/**
 * WS-7 T10 — the SIXTEEN AC-020 completion records, as ONE frozen array.
 *
 * ===========================================================================
 * WHY ONE ARRAY AND NOT SIXTEEN `export const X_COMPLETION`
 * ===========================================================================
 *
 * T7/T8/T9 each had two rooms, so each exported its own `*_COMPLETION`. Sixteen
 * hand-named constants is sixteen things a later task must remember to look at,
 * and D27's obligation is that EVERY room's completion record carries an explicit
 * verdict — T21's guard (`:1386`) has to be able to enumerate them. So they are
 * rows of one table, keyed by the instance they describe, and
 * `readOnlyCompletion("suite/key")` is how a consumer reaches one. A verdict that
 * nothing can find is a verdict nothing can assert against.
 *
 * ===========================================================================
 * THE RESIDUAL ORDER — A RECORDED JUDGEMENT, NOT AN INVENTED ORDER
 * ===========================================================================
 *
 * D1 `:97` ends "remaining read-only rooms" and T10 `:1283` says "in the owner's
 * residual order". The owner has never supplied a residual order. Silently
 * imposing one would be the anti-goal, so the basis is stated below, here, and in
 * the changelog entry — and it is asserted by a test, so it cannot be quietly
 * changed into something else later.
 *
 * THE BASIS CHOSEN IS SUITE ORDER, THEN THE ROUTER'S DECLARATION ORDER WITHIN
 * EACH SUITE. Two reasons, and the second is the honest one:
 *
 *  1. It is fully DERIVABLE. WS-6 §0.3's freeze invariant (a) enumerates the
 *     suites as trading, earnings, intelligence, and `MinistryRoom.tsx` declares
 *     each suite's keys in a fixed order. So the order is read off the repository
 *     and the frozen inventory, not chosen by taste.
 *  2. THE ALTERNATIVE WAS CONSIDERED AND DOES NOT ORDER ANYTHING HERE. The brief
 *     offers "available-work order — which producers already exist". T10 ran that
 *     audit FIRST, before writing anything, and its result is that ALL NINE KEYS
 *     ALREADY HAVE A PRODUCER WITH A ROUTE THAT ALREADY EXISTED. Available-work
 *     order would therefore place all sixteen instances in a single undifferentiated
 *     group and order none of them. That is a finding, not a tie-break, and it is
 *     recorded as one: T10 added ZERO routes, for the reason T8 and T9 each found
 *     independently — a second route over a store that already has one gives that
 *     store two answers taken at two moments.
 */

/** The basis, as data, so a test can assert it rather than trusting prose. */
export const READ_ONLY_RESIDUAL_ORDER_BASIS = "suite-order-then-router-declaration-order"

export const READ_ONLY_RESIDUAL_ORDER_JUDGEMENT =
  "The owner has not supplied a residual order for T10's sixteen read-only room instances, so one is chosen here and " +
  "recorded rather than imposed silently. The basis is suite order — trading, earnings, intelligence, the order WS-6 " +
  "§0.3's freeze invariant (a) itself enumerates — and then the router's own declaration order within each suite, as " +
  "MinistryRoom.tsx declares each suite's room keys. That order is therefore read off the frozen inventory and the " +
  "router rather than chosen by taste, which is the property that makes it defensible. The alternative basis offered, " +
  "available-work order (which producers already exist), was tested first and it does not order anything: T10's " +
  "producer audit found that all nine distinct keys ALREADY have a producer behind a route that ALREADY existed, so " +
  "available-work order would put all sixteen instances in one undifferentiated group and order none of them. That " +
  "audit result is itself the significant finding of this task — T10 added zero routes — and it is recorded as a finding " +
  "rather than used as a tie-break. The order numbers continue D1's sequence without a gap: rooms 1-6 were markets, " +
  "risk, ceremony, ministry, strategy and paper (T7, T8, T9), so T10's sixteen take 7 through 22, which also makes the " +
  "twenty-two figure in the amended freeze invariant checkable from code."

/* ==========================================================================
   THE RECORD TYPE
   ========================================================================== */

export type ReadOnlyWriteAffordance = {
  /** What the control is, in the words of the room that carries it. */
  id: string
  /**
   * The route it writes to, or the literal `local-storage-only` for a preference
   * that never touches the API. Never omitted: an affordance with no route named
   * is indistinguishable from an affordance nobody checked.
   */
  route: string
  /** A token that must appear in that instance's own page composition. */
  sourceToken: string
  detail: string
  /** Always false in this task. T10 does not remove shipped product behaviour. */
  removedByThisTask: false
}

export type ReadOnlyRoomCompletion = {
  /** Same value as `key`; asserted so the two cannot drift. */
  room: ReadOnlyRoomKey
  key: ReadOnlyRoomKey
  suite: ReadOnlySuiteId
  /** D1's sequence position, 7..22. */
  d1Order: number
  /** AC-020's verdict. Never upgraded to make the task look finished. */
  verdict: "complete" | "incomplete"
  /** D27. Present always; `null` only where the room is genuinely complete. */
  ws8Handoff: {
    what: string
    detail: string
    owner: string
    decidedByThisTask: boolean
  } | null
  absences: readonly { what: string; detail: string; owner: string; isWs8Scope: boolean | null }[]
  /** Findings about write affordances that PRE-DATE WS-7 in the page composition. */
  preExistingWriteAffordances: readonly ReadOnlyWriteAffordance[]
  reason: string
}

type Absence = ReadOnlyRoomCompletion["absences"][number]
type Affordance = ReadOnlyWriteAffordance

const absence = (what: string, detail: string, owner: string, isWs8Scope: boolean | null = false): Absence =>
  Object.freeze({ what, detail, owner, isWs8Scope })

const affordance = (
  id: string,
  route: string,
  sourceToken: string,
  detail: string
): Affordance => Object.freeze({ id, route, sourceToken, detail, removedByThisTask: false })

/* ==========================================================================
   THE SIXTEEN
   ========================================================================== */

/**
 * The shared statement that a producer is reached but thin, recorded per instance
 * where it applies rather than once globally — because D27 requires the boundary
 * to be visible per room, and a generic note in a preamble is not visible per room.
 */
const PRODUCER_SET_THIN =
  "The producer set for this instance is THIN: it reports service state and configuration, not the suite's analytical " +
  "subject matter. That is reported rather than dressed up. It is not a reserved placeholder and not an absence of a " +
  "producer — the producer answers and its answers are rendered — but a reader should not mistake 'the dashboard " +
  "loads' for 'the dashboard shows this suite's analysis'."

const LOCAL_ONLY_AFFORDANCE_NOTE =
  "This affordance writes to the browser's localStorage and never touches the API, which is recorded explicitly " +
  "because an audit that listed only /api routes would have hidden it."

export const READ_ONLY_ROOM_COMPLETIONS: readonly ReadOnlyRoomCompletion[] = Object.freeze([
  /* ---------------------------------------------------------- trading 7..13 */

  Object.freeze({
    room: "dashboard",
    key: "dashboard",
    suite: "trading",
    d1Order: 7,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE LEGACY PAGE DEFAULTS A MISSING RISK FIGURE TO 2%",
        "pages/ministry/DashboardRoom.tsx:40 renders riskPct={status?.riskPerTradePct ?? 2}. An absent producer is " +
          "there rendered as a plausible 2% risk figure, which is the zero-fill this task exists to refuse. The " +
          "read-only room reports the absence instead. The legacy default is REPORTED rather than changed, because it " +
          "is pre-existing product rendering and T10's scope is the read-only surface.",
        READ_ONLY_OWNER
      ),
      absence(
        "NO INTELLIGENCE-STYLE ANALYTICAL PRODUCER FOR THIS DASHBOARD",
        "The dashboard reads GET /api/trading/status and reports the paper overview, the risk figure and the demo " +
          "account presence. It does not restate the Copilot decision surface, which T7's Markets/COP-22 room already " +
          "renders through T11's engine — a second copy of that surface would be the duplication D27 names.",
        "not applicable — a deliberate refusal, not unfinished work"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Trade planner — place a paper order",
        "/api/trading/paper/trade",
        "TradePlannerCard",
        "TradePlannerCard renders in the 'act' band and posts to the paper trading route. Paper-only, and it " +
          "pre-dates WS-7."
      ),
      affordance(
        "Signal notification preferences",
        "/api/trading/notifications",
        "SignalNotificationsCard",
        "SignalNotificationsCard writes notification preferences. It pre-dates WS-7 and T10 does not remove it."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. The producer — GET /api/trading/status (handlers.mjs:1425) — " +
      "already existed and is reused unmodified; T10 adds no route. The room renders real observations with honest " +
      "provenance, shows a named absence for the risk figure when the producer does not answer rather than defaulting " +
      "it, and exposes no interactive control: the affordance ceiling is exported empty data and the rendered markup " +
      "is enumerated for every interactive element. TWO FINDINGS ARE NAMED IN absences. The room is called a read-only " +
      "room because that is what WS-7 BUILDS for it, not because the shipped page is inert: it carries two pre-existing " +
      "write affordances, TradePlannerCard posting to /api/trading/paper/trade and SignalNotificationsCard posting to " +
      "/api/trading/notifications. Both pre-date WS-7, both are named with their routes, and NEITHER IS REMOVED — " +
      "removing shipped product functionality is a product decision, and D27 prohibits a task taking one silently. " +
      "Neither is WS-8 scope: both are existing WS-6-era behaviour."
  } as const),

  Object.freeze({
    room: "autopilot",
    key: "autopilot",
    suite: "trading",
    d1Order: 8,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE AUTOPILOT'S START AND STOP ROUTES ALREADY REFUSE",
        "POST /api/trading/autopilot/start and /stop both answer HTTP 410 with the body 'order execution removed — " +
          "PICC is advisory-first' (handlers.mjs:3068-3076). This is the load-bearing fact behind the room's zero " +
          "affordance ceiling: a start/stop control here would be a button that cannot succeed. Recorded so a later " +
          "reader does not read the absent control as forgotten work.",
        "not applicable — order execution is removed by design"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Autopilot configuration save",
        "/api/trading/autopilot",
        "AutopilotSuite",
        "AutopilotSuite posts the autopilot config. Pre-dates WS-7."
      ),
      affordance(
        "Walk-forward run",
        "/api/trading/walk-forward",
        "WalkForwardCard",
        "WalkForwardCard posts a walk-forward request, which runs compute. Pre-dates WS-7."
      ),
      affordance(
        "Model matrix run",
        "/api/trading/models",
        "ModelMatrixPanel",
        "ModelMatrixPanel posts a model-matrix request. Pre-dates WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. Both producers already existed and are reused unmodified: " +
      "GET /api/trading/autopilot for the configuration and GET /api/trading/autopilot/decisions for the decision log " +
      "(handlers.mjs:3045, :3078). T10 adds no route. The decision log's absence is reported separately from a genuine " +
      "zero-decision log, which is the distinction AutopilotRoom.tsx:161 already renders honestly in its own words. The " +
      "room exposes no interactive control, and the strongest reason is recorded as an absence rather than asserted in " +
      "prose: the autopilot's own start and stop routes already answer 410, so the ceiling is a fact about the tree " +
      "rather than a stylistic choice. THE ROOM IS NOT INERT: it carries three pre-existing write affordances — the " +
      "autopilot config save, a walk-forward run and a model-matrix run — all pre-dating WS-7, all named with their " +
      "routes, and none removed by this task."
  } as const),

  Object.freeze({
    room: "command-centre",
    key: "command-centre",
    suite: "trading",
    d1Order: 9,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE PERPS EXECUTION PANEL IS AN ORDER-EXECUTION SURFACE INSIDE A ROOM CALLED READ-ONLY",
        "CommandCentreRoom.tsx:36 renders PerpsCommandCentre, which posts to /command-centre/perps/execute and " +
          "/command-centre/perps/close (PerpsCommandCentre.tsx:208, :254). Those are order-execution writes, and they " +
          "are the single most significant finding of this affordance audit. They are NOT removed here: they are " +
          "pre-existing, they are gated by the command-centre gate set, and removing an execution surface is a product " +
          "decision this task has no basis for. They are named so the reader of a 'read-only room' verdict learns " +
          "that the label describes WS-7's contribution and not the shipped page.",
        "owner decision — whether an execution surface belongs in a read-only room is not derivable from the repository"
      ),
      absence(
        "ONE OF THIS ROOM'S TWO PRODUCERS IS SERVED WITHOUT AN AUTH GATE",
        "GET /api/trading/signals is served at handlers.mjs:2977-2980 with neither requireAuth nor " +
          "requireSessionOrFirstRun, so any caller may read the recent signal list unauthenticated. That is a " +
          "PRE-EXISTING gap: T10 did not introduce it, and T10 did not close it either, because adding a gate to a " +
          "route this task did not write — and which other tests and callers may depend on — is a change outside " +
          "T10's scope and a decision about the product's access model rather than about a read-only room. It is " +
          "named here because this instance consumes that route, and a verdict that called the room read-only " +
          "without mentioning that one of its inputs is open to any caller would be the misleading kind. It is " +
          "also named in the T10 test suite's KNOWN_UNGATED_ROUTES list, so a future reuse that lands on a NEW " +
          "ungated route fails a test rather than passing unnoticed.",
        "owner decision — whether these four ungated read routes should be gated is not derivable from this repository"
      ),
      absence(
        "UnlockCeremony IS NOT A WRITE AFFORDANCE DESPITE ITS NAME",
        "Recorded because the opposite would have been the more natural mistake. UnlockCeremony " +
          "(CommandCentreRoom.tsx:34) calls getCeremonyOverview(), which GETs /api/command-centre/ceremony " +
          "(lib/api.ts:1577) and renders the producer's ceremony:deny:* reasons verbatim. It presents NO control. The " +
          "ceremony unlock seam refuses outside a test run (ceremonyState.mjs:189-191), which is what T9 recorded, so " +
          "the panel is read-only by construction rather than by omission.",
        "not applicable — a verified non-absence, recorded so it is not mistaken for one"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Perps order execution",
        "/api/command-centre/perps/execute",
        "PerpsCommandCentre",
        "PerpsCommandCentre posts an executed perps order after a confirm modal. This is an order-execution write " +
          "inside a room D1 calls read-only, and it is the audit's headline finding."
      ),
      affordance(
        "Perps position close",
        "/api/command-centre/perps/close",
        "PerpsCommandCentre",
        "PerpsCommandCentre posts a position close. Same finding, second route."
      ),
      affordance(
        "Follow a leader idea",
        "/api/command-centre/leader-ideas/follow",
        "LeaderIdeasPanel",
        "LeaderIdeasPanel follows a leader idea, which subscribes this account to someone else's signal. Pre-dates WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. Both producers already existed and are reused unmodified: " +
      "GET /api/command-centre/overview (handlers.mjs:1779), the same producer T9's Paper/Live room reads for its " +
      "consent rails, and GET /api/trading/signals (:2977). T10 adds no route, and deliberately did not add one even " +
      "though the overview route carries gates this room does not use. The room exposes no interactive control of its " +
      "own. THE HEADLINE FINDING IS RECORDED AS AN ABSENCE, NOT BURIED IN PROSE: this instance's legacy page renders " +
      "PerpsCommandCentre, which posts to /command-centre/perps/execute and /command-centre/perps/close. D1's order " +
      "calls this a read-only room; the shipped page carries an order-execution surface. Both statements are true and " +
      "they are about different things — the label describes the read-only surface WS-7 built, and the page predates " +
      "it — so the conflict is reported rather than resolved by this task, because removing an execution surface is a " +
      "product decision. A second finding is recorded as a verified NON-absence: UnlockCeremony presents no control and " +
      "must not be counted as a write affordance, which is recorded because over-counting would have been the easier " +
      "mistake. Three pre-existing write affordances are named with their routes; none is removed."
  } as const),

  Object.freeze({
    room: "dispatch",
    key: "dispatch",
    suite: "trading",
    d1Order: 10,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE SUITE HEADER'S UNREAD BADGE HIDES ITSELF WHEN THE PRODUCER IS ABSENT",
        "DispatchBell.tsx:8 reads snapshot?.dispatch?.unread ?? null and renders nothing when that is null, so an " +
          "unreachable producer is indistinguishable from an inbox with nothing unread. The read-only room names the " +
          "absence instead of relying on a badge that disappears.",
        "not applicable — a reporting improvement, not unfinished work"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Mark a dispatch entry read",
        "/api/trading/dispatch/read",
        "markDispatchRead",
        "DispatchRoom.tsx:54 posts a mark-read for an entry the operator opened. This is a deliberate acknowledgement " +
          "write, not a state change with consequences, and it pre-dates WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. The producer — GET /api/trading/dispatch (handlers.mjs:1584) — " +
      "already existed, is already requireAuth-gated as its first statement, and is reused unmodified; T10 adds no " +
      "route. The entry count and the unread count are reported only when the producer answered, and a producer that " +
      "ran and found nothing is distinguished from one that could not be reached — which is the distinction " +
      "CommandCentreRoom-style initialisation to [] cannot make. The room exposes no interactive control. It carries " +
      "one pre-existing write affordance, the mark-read acknowledgement POSTed by DispatchRoom.tsx:54, named with its " +
      "route and not removed; an acknowledgement is the operator saying they read something, which is a write in the " +
      "narrow sense and nothing more."
  } as const),

  Object.freeze({
    room: "simulator",
    key: "simulator",
    suite: "trading",
    d1Order: 11,
    // INCOMPLETE, and the reasoning follows STRATEGY_COMPLETION's precedent exactly.
    verdict: "incomplete",
    ws8Handoff: Object.freeze({
      what: "WHETHER A READ-ONLY FINANCIAL-TWIN PRODUCER IS WS-7 SCOPE OR WS-8 SCOPE",
      detail:
        "Named as an open boundary rather than decided, because this spec does not determine it. T10's acceptance line " +
        "(:1287) says only 'AC-020 passes per instance' and names no Simulator content — unlike Markets, Risk, " +
        "Ceremony, Ministry, Strategy and Paper/Live, whose acceptance lines each name what they must display. The " +
        "trading Simulator's principal subject, the Financial Twin, has NO read-only producer: its only endpoint, " +
        "POST /api/twin/run (handlers.mjs:1335), runs a simulation and returns it to that caller, so there is no run " +
        "store and no GET twin route. Building one would mean either creating a store and a route for a subject this " +
        "spec never describes, or pointing the room at something else entirely. Two readings are consistent with the " +
        "spec: (a) a read-only twin producer is WS-7 scope a later task builds, or (b) it is WS-8 scope and the room " +
        "stays as it is. WS-7 cannot choose between them without inventing scope, which D27 prohibits, so the choice is " +
        "the owner's. Note this is NOT the same defect as Strategy's: Strategy's producer is entirely undetermined, " +
        "whereas here the producer is precisely identified and precisely absent.",
      owner: "owner decision",
      decidedByThisTask: false
    }),
    absences: Object.freeze([
      absence(
        "NO READ-ONLY PRODUCER FOR THE FINANCIAL TWIN",
        "POST /api/twin/run is write-only: there is no GET twin route and no run store, so a twin result cannot be " +
          "read back. A read-only room cannot display a run it cannot fetch. This section therefore reports the " +
          "absence PERMANENTLY rather than rendering an empty twin panel that would read as 'not run yet' — which is " +
          "the distinction that makes this room INCOMPLETE rather than merely thin.",
        READ_ONLY_OWNER
      ),
      absence(
        "THE ROOM'S OTHER TWO PANELS ARE PRODUCED, BUT ONLY BY WRITING",
        "ListingOptimizer and ContentStudio both work — they post to /api/listing/competitors and " +
          "/api/content/generate — but their results are returned to the caller rather than stored, so this read-only " +
          "room has nothing to read for them either. The trading Simulator's substantive content is therefore entirely " +
          "write-only today.",
        READ_ONLY_OWNER
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Run a Financial Twin simulation",
        "/api/twin/run",
        "FinancialTwin",
        "FinancialTwin posts a simulation and renders the returned result. This is the room's principal subject and " +
          "it is write-only — which is why this instance is incomplete rather than complete."
      ),
      affordance(
        "Fetch competitor intelligence",
        "/api/listing/competitors",
        "ListingOptimizer",
        "ListingOptimizer posts for competitor intel. Write-only result, pre-dating WS-7."
      ),
      affordance(
        "Generate content",
        "/api/content/generate",
        "ContentStudio",
        "ContentStudio posts a content-generation request. Write-only result, pre-dating WS-7."
      )
    ]),
    reason:
      "The trading Simulator is NOT complete and is not recorded as complete. AC-020:929 prohibits declaring a room " +
      "COMPLETE while it has a reserved placeholder that could be trivially filled later, and this instance's " +
      "principal subject is a panel with no readable content at all: the Financial Twin is write-only, so the " +
      "read-only surface can render nothing but a permanent named absence. Fifteen of the sixteen instances clear " +
      "AC-020; this one does not, and the difference is not a trim. It is that every other instance has a producer that " +
      "ANSWERS, however thin, while this one's has nothing to answer. This follows the precedent T9 set for the Strategy " +
      "room and does not repeat its error: T9's first draft said there was no strategy code at all and a test proved " +
      "that false — five named strategies exist. So the claim here is the narrower, verifiable one: the twin producer " +
      "is not missing, it is precisely identified (POST /api/twin/run, handlers.mjs:1335), precisely READ-ONLY-ABSENT, " +
      "and a test asserts the absence is permanent rather than inferred. ws8Handoff is a NAMED OPEN BOUNDARY rather " +
      "than null, because whether to build a read-only twin producer is WS-7 or WS-8 scope is not derivable from this " +
      "spec and choosing would mean inventing scope. The room carries three pre-existing write affordances, all named " +
      "with their routes; the twin run is the one that decides this verdict."
  } as const),

  Object.freeze({
    room: "studio",
    key: "studio",
    suite: "trading",
    d1Order: 12,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE STUDIO STATUS PRODUCER ANSWERS WHETHER OR NOT A SESSION IS OPEN",
        "GET /api/browser/status reports runtime availability and whether a session is running (handlers.mjs:5497-5502). " +
          "It cannot report WHAT the session is doing — the studio's own state is held in the browser process, not in a " +
          "readable store. The room reports what the producer reports and does not infer the rest.",
        "not applicable — a producer-scope limit, reported not hidden"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Open the studio window",
        "/api/browser/open",
        "StudioPage",
        "StudioPage opens a headed, fully intercepted browser window. This is the studio's principal action and it " +
          "pre-dates WS-7. REQ-E.3 makes this surface shared across all three suites, so the same affordance is recorded " +
          "on each of the three studio instances rather than described once."
      ),
      affordance(
        "Close the studio",
        "/api/browser/close",
        "StudioPage",
        "StudioPage closes the studio window. Pre-dates WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. The producer — GET /api/browser/status (handlers.mjs:5497), " +
      "already existing and already requireAuth-gated — is reused unmodified and T10 adds no route. This is also the " +
      "clearest instance of the 'nine surfaces, not sixteen' claim in the opposite direction from dashboard/settings: " +
      "MinistryRoom.tsx:14-16 already points all three suites at ONE shared StudioRoomComponent, so `studio` was " +
      "already one surface instantiated three times before T10 arrived, and T10 gave it one verdict-bearing read-only " +
      "body rather than three. The room exposes no interactive control. It carries two pre-existing write affordances — " +
      "open and close the studio window — named with their routes and not removed; opening a browser window is the " +
      "studio's product purpose, and 'read-only' here describes the read-only surface WS-7 added alongside it."
  } as const),

  Object.freeze({
    room: "settings",
    key: "settings",
    suite: "trading",
    d1Order: 13,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE MINISTRY PREFERENCE TOGGLES NEVER REACH THE SERVER",
        "SettingsRoom.tsx:67 and :71 persist the autopilot mode and confidence threshold through " +
          "saveMinistrySettings, which writes localStorage. A reader could reasonably believe the threshold is a " +
          "server-side gate; it is a per-machine preference. Recorded so the read-only room's silence about " +
          "persistence is not read as a claim that it is persisted centrally.",
        "not applicable — a pre-existing design fact, reported"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Autopilot mode toggle",
        "local-storage-only",
        "saveMinistrySettings",
        `A checkbox that flips the ministry's autopilot mode and persists it. ${LOCAL_ONLY_AFFORDANCE_NOTE}`
      ),
      affordance(
        "Confidence threshold slider",
        "local-storage-only",
        "saveMinistrySettings",
        `A range input that writes the confidence threshold on every change. ${LOCAL_ONLY_AFFORDANCE_NOTE}`
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. Both producers already existed: GET /api/settings/llm " +
      "(handlers.mjs:2769) for the provider configuration and GET /api/integrations (:5476) for the data-source list. " +
      "Neither is reused in a way that adds a route, and T10 adds none. The room reports an integration count only " +
      "when the producer answered — it does NOT report zero integrations when unreachable, because that would read " +
      "as a product with no data sources, which is a different and false claim. The read-only room exposes no " +
      "interactive control, and it is worth being precise about what that does and does not say, because THIS instance " +
      "is the one that most needs the distinction: it carries two pre-existing write affordances, an autopilot-mode " +
      "checkbox and a confidence-threshold slider, and BOTH WRITE ONLY TO localStorage. They are named with the " +
      "explicit route value 'local-storage-only' rather than being omitted, because an affordance audit that listed " +
      "only /api routes would have reported this room as inert and been wrong."
  } as const),

  /* --------------------------------------------------------- earnings 14..17 */

  Object.freeze({
    room: "dashboard",
    key: "dashboard",
    suite: "earnings",
    d1Order: 14,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE PRODUCER FOR THIS DASHBOARD IS SERVICE HEALTH, NOT INCOME",
        PRODUCER_SET_THIN +
          " Specifically: GET /api/health reports the PICC version, the configured payment providers and the agents " +
          "service. The income figures themselves live in the streams tabs, which read browser-local state through " +
          "@/lib/streams rather than a server route, so this read-only room reports no income figure at all rather " +
          "than reporting a zero balance.",
        READ_ONLY_OWNER
      )
    ]),
    preExistingWriteAffordances: Object.freeze([]),
    reason:
      "No scope in this room logically belongs to WS-8. The producer — GET /api/health (handlers.mjs:1320) — already " +
      "existed and is reused unmodified; T10 adds no route. The room exposes no interactive control, and this instance " +
      "genuinely has no pre-existing write affordance in its page composition: the dashboard body is a tab strip over " +
      "read-only tabs, so the affordance list is EMPTY and that is asserted against the page source rather than " +
      "asserted in prose. The named absence is about THINNESS rather than absence of a producer — this dashboard " +
      "reports service health, not income — and it is recorded because a reader shown a loading dashboard should not " +
      "conclude the earnings suite has been analysed. The agents fact distinguishes three states (not configured, " +
      "configured but unreachable, reachable) rather than collapsing the first two into a count of zero."
  } as const),

  Object.freeze({
    room: "simulator",
    key: "simulator",
    suite: "earnings",
    d1Order: 15,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THIS INSTANCE HAS NO INCOME FIGURE TO SHOW ON AN EMPTY TREE",
        "getStreams() reads browser-local state (EarningsRooms.tsx:396). On a machine with no streams configured the " +
          "room renders its own honest empty copy, and this read-only room reports 0 streams from the server " +
          "producer — a REAL zero the producer stated, which is why it is distinguishable here from the unreachable " +
          "case where nothing is reported at all.",
        "not applicable — a real zero, deliberately distinguishable from an absent producer"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Launch a stream in a browser window",
        "/api/browser/open",
        "openBrowser",
        "LaunchBar opens a headed browser window to the stream's own dashboard. Pre-dates WS-7."
      ),
      affordance(
        "Open a tab in the studio",
        "/api/browser/tab",
        "browserTab",
        "LaunchBar opens a new studio tab at the stream URL. Pre-dates WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. The producer — GET /api/streams/snapshot " +
      "(handlers.mjs:4971) — already existed and is reused unmodified; T10 adds no route. The two instances of " +
      "`simulator` are the clearest demonstration that one surface can serve two different subjects without forking: " +
      "trading/simulator declares a twin section and earnings/simulator declares a streams section, and both are " +
      "rendered by the same surface with no suite branch in it. This instance is COMPLETE where trading/simulator is " +
      "INCOMPLETE, and the difference is precisely stated: this one's producer answers, trading's has nothing to " +
      "answer. The room reports a genuine 0 streams when the producer ran and found none, which is a fact the producer " +
      "stated, and reports nothing when the producer could not be reached. Those two states are distinguished in the " +
      "markup and the difference is asserted by a test rather than asserted here. Two pre-existing write affordances " +
      "are named with their routes and not removed."
  } as const),

  Object.freeze({
    room: "studio",
    key: "studio",
    suite: "earnings",
    d1Order: 16,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "SHARED SURFACE, SHARED LIMITATION",
        "This instance renders the SAME StudioPage as the other two suites (MinistryRoom.tsx:14-16, REQ-E.3), so every " +
          "producer-scope limitation recorded on trading/studio applies here identically. Recorded again rather than " +
          "cross-referenced, because D27 requires each room's record to stand on its own.",
        "not applicable — a producer-scope limit, reported not hidden"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Open the studio window",
        "/api/browser/open",
        "StudioPage",
        "The shared StudioPage opens a headed browser window. Same affordance, same route, recorded per instance " +
          "because the completion records are per instance."
      ),
      affordance(
        "Close the studio",
        "/api/browser/close",
        "StudioPage",
        "The shared StudioPage closes the studio window. Pre-dates WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. Same producer as the other two studio instances — " +
      "GET /api/browser/status — reused unmodified, no route added. This record exists separately from its two " +
      "siblings because D27 requires sixteen records for sixteen instances, and a room that shares its siblings' " +
      "verdict verbatim would be a room whose verdict could not be read. What makes it worth a separate record is " +
      "that it demonstrates the shared-surface claim from the other side: the studio key is instantiated three times, " +
      "REQs E.3 already route all three to one component, and T10 added one read-only body and three records rather " +
      "than three bodies. Two pre-existing write affordances, named with their routes, not removed."
  } as const),

  Object.freeze({
    room: "settings",
    key: "settings",
    suite: "earnings",
    d1Order: 17,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "PAYMENT-CHANNEL STATE IS READ FROM THE HEALTH PRODUCER, NOT FROM THE CHANNELS THEMSELVES",
        "ChannelsTab reads getHealth() and reports each provider as configured or not (EarningsRooms.tsx:112, :180). " +
          "That is the health producer's boolean, not a probe of the channel, so 'Configured' means the environment " +
          "carries the credential — not that a payment was successfully made through it. Reported so the read-only " +
          "room's provider count is not over-read.",
        "not applicable — a producer-scope limit, reported not hidden"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Create a BTCPay invoice",
        "/api/btcpay/invoice",
        "createBtcpayInvoice",
        "ChannelsTab posts a BTCPay invoice request for an amount, currency and description. It creates a real, " +
          "chargeable artefact, so it is a write with external consequence and it pre-dates WS-7."
      ),
      affordance(
        "Create a TNG eWallet order",
        "/api/billing/ewallet/order",
        "createEwalletOrder",
        "ChannelsTab posts an eWallet order for the same three fields. Also externally consequential, also " +
          "pre-dating WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. The producer — GET /api/health — already existed and is reused " +
      "unmodified; T10 adds no route. The read-only room reports the configured-channel count only when the producer " +
      "answered, and reports nothing when it did not, which matters commercially here more than anywhere else in this " +
      "task: a buyer must never be told a payment channel is unavailable when the answer was never obtained. THE ROOM " +
      "CARRIES TWO PRE-EXISTING WRITE AFFORDANCES THAT ARE THE MOST CONSEQUENTIAL IN THE AUDIT: creating a BTCPay " +
      "invoice (POST /api/btcpay/invoice) and creating a TNG eWallet order (POST /api/billing/ewallet/order). Both " +
      "produce artefacts a third party can act on — an invoice a buyer can pay, an order a buyer can transfer " +
      "against. They are named with their routes and NOT removed, because removing a payment channel is a product " +
      "decision this task has no basis for, but they are reported prominently because a verdict calling this instance " +
      "a read-only room would otherwise mislead a reader about what pressing its buttons does."
  } as const),

  /* ----------------------------------------------------- intelligence 18..22 */

  Object.freeze({
    room: "dashboard",
    key: "dashboard",
    suite: "intelligence",
    d1Order: 18,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THIS INSTANCE WAS AN HonestScaffold UNTIL T10, AND ITS PRODUCER IS STILL SERVICE HEALTH",
        "IntelligenceRooms.tsx:11 returned <HonestScaffold suiteId='intelligence' room='Dashboard'>, which renders the " +
          "words 'under development' and no data at all. AC-020:929 treats a reserved placeholder as failing the " +
          "criterion, so the scaffold was REPLACED by this read-only room rather than left in place. What replaced it " +
          "reports service health, not intelligence analysis, and that limit is named rather than glossed: the room is " +
          "complete against the criterion, and it is thin.",
        READ_ONLY_OWNER
      ),
      absence(
        PRODUCER_SET_THIN,
        PRODUCER_SET_THIN,
        "not applicable — a deliberate refusal, not unfinished work"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([]),
    reason:
      "No scope in this room logically belongs to WS-8, and the reason this instance needed work at all is recorded " +
      "first: it was an HonestScaffold — the literal words 'under development', no data, a reserved placeholder in all " +
      "but name — and AC-020:929 makes a reserved placeholder a failing criterion. It is now a real room reading " +
      "GET /api/health, which already existed, with no route added. The verdict is 'complete' and NOT 'incomplete', " +
      "and the distinction from trading/simulator's incomplete verdict is the whole point of this record: here the " +
      "producer ANSWERS, and a room that reports what a real producer said is not a placeholder even when what it " +
      "reports is service health rather than the suite's subject matter. That thinness is named in absences rather than " +
      "hidden, because a reader who sees a dashboard render should not conclude the intelligence suite has been " +
      "analysed. The room exposes no interactive control and this instance has NO pre-existing write affordance: it " +
      "previously had no content at all, so the affordance list is empty, which the test checks against the page source."
  } as const),

  Object.freeze({
    room: "governor",
    key: "governor",
    suite: "intelligence",
    d1Order: 19,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "BOTH OF THIS ROOM'S PRODUCERS REFUSE ON A DEFAULT INSTALLATION",
        "GET /api/agents/settings answers HTTP 503 when PICC_AGENTS_URL is unset (handlers.mjs:5061-5062), and " +
          "/api/health sends agents: null in the same condition (:1321-1330). On a fresh checkout — which is most " +
          "checkouts — this room therefore renders two named absences and no figures. That is the honest state, and " +
          "it is the distinction this room exists to make: the crew was NEVER INSTALLED, which is different from " +
          "being installed and broken, and both are different from having zero models.",
        READ_ONLY_OWNER
      )
    ]),
    preExistingWriteAffordances: Object.freeze([]),
    reason:
      "No scope in this room logically belongs to WS-8. Both producers already existed — GET /api/agents/settings " +
      "(handlers.mjs:5060) and GET /api/health (:1320) — and both are reused unmodified; T10 adds no route. This " +
      "instance was an HonestScaffold before T10 and is now a real room, so the reserved placeholder AC-020:929 " +
      "prohibits is gone. The verdict is 'complete' with the awkward fact named: on a default installation BOTH " +
      "producers refuse, so the room renders absences and no figures, and that is the correct output rather than a " +
      "shortfall. The distinction it maintains is three-way — not configured, configured but unreachable, reachable — " +
      "and a test renders the first two and asserts the markup differs, because collapsing them would tell an operator " +
      "their configured crew is broken when it was never installed. The room exposes no interactive control and has no " +
      "pre-existing write affordance: it previously had no content, so an empty list is a statement about the absence " +
      "of affordances rather than a gap in the audit."
  } as const),

  Object.freeze({
    room: "guidance",
    key: "guidance",
    suite: "intelligence",
    d1Order: 20,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE CREW CANNOT BE ASKED ON A DEFAULT INSTALLATION",
        "POST /api/agents/run answers HTTP 503 with 'agents service not configured (set PICC_AGENTS_URL)' when that " +
          "variable is unset (handlers.mjs:5030). The room's own copy already says this in the prose at " +
          "IntelligenceRooms.tsx:101, and the read-only room reports the same fact as structure rather than as a " +
          "sentence, so the state survives a reader who never reads the paragraph.",
        READ_ONLY_OWNER
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Run the research crew",
        "/api/agents/run",
        "runAgentCrew",
        "IntelligenceRooms.tsx:56 posts a research-crew run and renders the returned report. It costs money — the " +
          "route proxies to a service needing OPENAI_API_KEY — and it spends a rate-limit budget of 30 calls per 60 " +
          "seconds (handlers.mjs:5032). This is the most expensive affordance in the audit and it pre-dates WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. The producer — GET /api/health — already existed and is reused " +
      "unmodified; T10 adds no route. The read-only room renders three distinguishable crew states and collapses none " +
      "of them into zero: not configured, configured but unreachable, and reachable, with the markup for the first " +
      "two asserted to differ by a test. The room exposes no interactive control. It carries ONE pre-existing write " +
      "affordance, the research-crew run, and it is named with its route and its cost because it is the most " +
      "consequential affordance in this audit: it spends money and a rate-limit budget, and a verdict describing this " +
      "instance as a read-only room without that fact would be the misleading kind."
  } as const),

  Object.freeze({
    room: "studio",
    key: "studio",
    suite: "intelligence",
    d1Order: 21,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "SHARED SURFACE, SHARED LIMITATION",
        "This instance renders the SAME StudioPage as the other two suites, so the producer-scope limit recorded on " +
          "trading/studio applies identically. Recorded again rather than cross-referenced, because D27 requires each " +
          "record to stand alone.",
        "not applicable — a producer-scope limit, reported not hidden"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([
      affordance(
        "Open the studio window",
        "/api/browser/open",
        "StudioPage",
        "The shared StudioPage opens a headed browser window. Same affordance and route as the other two studio " +
          "instances; recorded per instance because the records are per instance."
      ),
      affordance(
        "Close the studio",
        "/api/browser/close",
        "StudioPage",
        "The shared StudioPage closes the studio window. Pre-dates WS-7."
      )
    ]),
    reason:
      "No scope in this room logically belongs to WS-8. Third and last of the studio instances, same producer, reused " +
      "unmodified, no route added. This record exists for the same reason its siblings' do — sixteen instances, " +
      "sixteen records, D27 — and it is the third piece of evidence that `studio` was already one surface instantiated " +
      "three times before T10 arrived: MinistryRoom.tsx:14-16 has pointed all three suites at one StudioRoomComponent " +
      "since the 2026-09-16 removal decision, and T10 added one read-only body plus three records rather than three " +
      "bodies. Two pre-existing write affordances, named with their routes, not removed."
  } as const),

  Object.freeze({
    room: "settings",
    key: "settings",
    suite: "intelligence",
    d1Order: 22,
    verdict: "complete",
    ws8Handoff: null,
    absences: Object.freeze([
      absence(
        "THE ONLY PRODUCER REFUSES ON A DEFAULT INSTALLATION",
        "GET /api/agents/settings answers HTTP 503 when PICC_AGENTS_URL is unset (handlers.mjs:5061-5062). The room " +
          "renders that refusal and the producer's own error text, and it does NOT render an empty settings object — " +
          "which would read as a configured agents service with nothing configured in it. A test asserts the 503 " +
          "payload yields unobserved facts rather than an empty count.",
        READ_ONLY_OWNER
      ),
      absence(
        "AN EMPTY SETTINGS OBJECT AND AN UNREADABLE ONE ARE THE FAILURE THIS REFUSES",
        "The refusal path returns a JSON body carrying only `error`. Rendering that body's absent fields as a " +
          "settings report would produce a room that looks configured and empty. The projection treats an object " +
          "carrying a producer error as a REFUSAL rather than a result, which is why `readoutObtained` is false for " +
          "it and every fact is unobserved.",
        "not applicable — the mechanism, recorded so it is not mistaken for a bug"
      )
    ]),
    preExistingWriteAffordances: Object.freeze([]),
    reason:
      "No scope in this room logically belongs to WS-8. The producer — GET /api/agents/settings (handlers.mjs:5060), " +
      "which supports GET and POST but whose POST T10 does not touch — already existed and is reused unmodified; T10 " +
      "adds no route and adds no write path. This instance was an HonestScaffold before T10 and is now a real room, so " +
      "the reserved placeholder AC-020:929 prohibits is gone. Its one producer refuses on a default installation and " +
      "the room reports that refusal with the producer's own words; treating a refusal body as a settings report is " +
      "named as the specific failure this projection refuses, and a test asserts the refusal yields unobserved facts " +
      "rather than an empty count. The verdict is 'complete' because the producer is DETERMINED and ANSWERS — with a " +
      "refusal, which is a real answer — not because the room is rich; that difference from trading/simulator is the " +
      "line this task draws between thin and absent. The room exposes no interactive control, and this instance has no " +
      "pre-existing write affordance because it previously had no content at all."
  } as const)
] as const)

/**
 * Look one instance's record up by `suite/key`. Used by the tests and available to
 * T21's D27 check, which has to enumerate all sixteen rather than know sixteen
 * constant names.
 */
export function readOnlyCompletion(id: string): ReadOnlyRoomCompletion | undefined {
  return READ_ONLY_ROOM_COMPLETIONS.find((c) => `${c.suite}/${c.key}` === id)
}