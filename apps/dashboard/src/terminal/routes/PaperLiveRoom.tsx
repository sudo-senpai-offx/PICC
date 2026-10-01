import { RoomFrame } from "../components/RoomFrame"
import { PaperLiveSurface } from "../components/PaperLiveSurface"
import { buildPaperLiveView, PAPER_LIVE_VERDICTS } from "../domain/paperLive"
import type { PaperLiveReadouts, PaperLiveVerdict, PaperLiveView } from "../domain/paperLive"

/**
 * WS-7 T9 — room instance 6 of 22 (D1's order): Paper/Live.
 *
 * THE HIGHEST-RISK ROOM IN WS-7, AND THE SCOPE IS STATED PRECISELY BECAUSE D27
 * FORBIDS TRIMMING IT QUIETLY.
 *
 * T9's acceptance line (:1278) is: "Paper/Live displays the ladder, the current
 * rung, `automationPermitted` state, and the ceremony/consent rails. It exposes
 * **no** live toggle beyond what the D19 outcome authorizes."
 *
 * Every one of those five clauses is a DISPLAY obligation, and T9's contribution
 * is the display plus the wiring that lets the display be real:
 *
 *   1. THE LADDER and 2. THE CURRENT RUNG come from their own real producers.
 *      The ladder's vocabulary is D6's three rungs, emitted by the permit readout
 *      as data (`paperLivePermit.mjs` `D6_LADDER_RUNGS`), and the current rung is
 *      the broker registry's own `activeExecutor` (`brokers.mjs:95`) — which its
 *      own comment records is unconditionally `"paper"` because D2/AC-005 removed
 *      the only other executor. No rung store exists anywhere in the tree: T11
 *      carries `rung` through untouched with no writing branch
 *      (`tiers.mjs:81-83`), which is D6 implemented rather than a gap.
 *
 *   3. `automationPermitted` STATE is T16's store, given a BROKER RECORD for the
 *      first time. That is entry 0024 handoff #4, discharged here: the readout
 *      seeds the store with the brokers `services/brokers.mjs` registers and reads
 *      them back through T16's PROVENANCE-GATED `isAutomationPermitted`, never a
 *      bare boolean.
 *
 *   4. THE CEREMONY/CONSENT RAILS are read from routes that ALREADY EXISTED and
 *      were already gated — `GET /api/command-centre/ceremony` (`handlers.mjs:1868`)
 *      and `GET /api/command-centre/overview` (`:1779`). No ceremony route and no
 *      overview route were added, because adding one over a store that already has
 *      a route is precisely what T8 refused to do (`1fd792b`: "a second ceremony
 *      route over one store would give that store two answers taken at two
 *      moments"). ONE new route was added, for the permit only.
 *
 *   5. NO LIVE TOGGLE. The ceiling is ZERO and the affordance enumeration is
 *      exported as empty data rather than asserted in a comment. The reasoning is
 *      `NO_LIVE_AFFORDANCE_REASON`'s, and its load-bearing input is D19's own
 *      recorded residual at `:266`: "the ceremony unlock has never been granted, so
 *      'gated' is not 'live'". An amended claim describing rails that exist is not
 *      an authorisation to offer a control that advances execution to them.
 *
 * WHAT THIS ROOM IS NOT: it does not enable anything. It renders state, and it
 * has no write path at all — the surface contains no interactive element, so
 * there is nothing here that could be mistaken for a route to execution even by a
 * reader who wanted one.
 *
 * PRESENTATIONAL ONLY. Four optional props, one per producer, so each source fails
 * independently and the projection can say WHICH rail is unobserved. It takes no
 * transport, reads no clock, and requests no credential.
 */

/** The wire shapes, taken from the projection so the two cannot drift. */
export type PaperLiveProps = {
  /** `null` when not obtained. NEVER a locally-built placeholder. */
  readouts: PaperLiveReadouts
}

/**
 * Re-exported so the page caller types its state without a deep import into the
 * domain module, and so the room's props type has ONE definition.
 */
export type { PaperLiveReadouts }

export function buildView(readouts: PaperLiveProps["readouts"]): PaperLiveView {
  return buildPaperLiveView(readouts ?? { permit: null, brokers: null, overview: null, ceremony: null })
}

export function PaperLiveRoom(props: PaperLiveProps) {
  const view = buildView(props.readouts)
  return (
    <RoomFrame
      roomKey="paper"
      title="Paper / Live"
      capabilityLabel="D6 ladder, D5 automationPermitted, ceremony and consent rails"
    >
      <PaperLiveSurface view={view} />
    </RoomFrame>
  )
}

/**
 * The room's D27 completeness verdict, carried in code so it cannot drift from
 * the report. See `CEREMONY_COMPLETION` for why the verdict lives here and not
 * only in prose: `JSON.stringify` serialises the DATA fields, so a verdict that
 * named its boundary only in a JSDoc would serialise to a bare "complete", which
 * is the unflagged trim AC-020 prohibits.
 */
export const PAPER_LIVE_COMPLETION = {
  room: "paper",
  d1Order: 6,
  /**
   * GENUINELY COMPLETE AGAINST T9's ACCEPTANCE LINE, WITH FOUR ABSENCES NAMED —
   * and every absence is a real runtime fact about this tree, not a trim.
   *
   * WHAT "COMPLETE" MEANS HERE, PRECISELY:
   *
   *  - COMPLETE means the five clauses of `:1278` are met. The ladder renders
   *    with its three rungs and D6's own rule text; the current rung renders from
   *    the broker registry's `activeExecutor` with its provenance; every broker's
   *    `automationPermitted` renders from T16's provenance-gated read with the raw
   *    record flag beside it; the ceremony and consent rails render with the
   *    PRODUCERS' OWN note strings; and the interactive-affordance enumeration is
   *    empty and the rendered markup contains no interactive element.
   *  - It does NOT mean live trading is enabled, and the room cannot enable it.
   *    No ceremony unlock exists, no automation permit can be granted (no authority
   *    is registered), the current rung is `paper` by construction, and the surface
   *    has no write path.
   *  - The fail-closed property is ASSERTED rather than promised:
   *    `PaperLiveRoom.test.tsx` proves that every absent, malformed, faulted or
   *    disagreeing input yields `unknown` — never `no-live-affordance`, and never
   *    anything permissive — and that the derived verdict itself still requires
   *    the D5 permit AND the AC-026 ceremony unlock AND the rung, so a fixture that
   *    satisfies the permit alone still reads as no-affordance.
   *
   * THE FOUR ABSENCES, AND NONE IS WS-8 SCOPE:
   *
   *  1. NO AUTHORITY SET (an owner decision). With none registered,
   *     `setAutomationPermitted` refuses on every call, so no permit can be
   *     granted. This is the direct cause of every `false` in the permit column.
   *  2. NO CEREMONY-UNLOCK PRODUCER (`BrokerRecord.ceremonyUnlocked`, §4.3:639).
   *     `createBrokerRecord` accepts it as an input, so it looks wired; nothing in
   *     the tree passes it as `true`. Reported rather than omitted, because an
   *     omitted field could be read as an unmet check that was never run.
   *  3. NO BUILD REGISTRY (T16 handoff #3, still open — T21's).
   *  4. NO LADDER STORE, and this is NOT an absence at all: D6 is implemented by
   *     NOT having one. T11 carries `rung` through with no writing branch
   *     (`tiers.mjs:81-83`), which is AC-025. Naming it prevents a later reader
   *     from reading the absent store as unfinished work.
   */
  verdict: "complete",
  ws8Handoff: null,
  /**
   * The absences are named HERE as well as in the prose above, deliberately, and
   * the fourth entry exists to record a NON-absence so the list is not read as a
   * shortfall list.
   */
  absences: Object.freeze([
    Object.freeze({
      what: "NO PRODUCTION AUTHORITY SET",
      detail:
        "No authority registry is wired, so setAutomationPermitted refuses on every call and no automation permit can be " +
        "granted. Every broker's provenance-gated read is false for this reason rather than by inspection of a decision. " +
        "Naming real authorities is an owner decision.",
      owner: "owner decision — naming real authorities is not derivable from the repository",
      isWs8Scope: false
    }),
    Object.freeze({
      what: "NO CEREMONY-UNLOCK PRODUCER",
      detail:
        "BrokerRecord.ceremonyUnlocked is accepted as an input by createBrokerRecord (brokerAutomationPermit.mjs:85, :110) " +
        "and defaults to false, but nothing under apps/dashboard ever passes it as true. It is permanently false and cannot " +
        "currently be the subject of a real ceremony unlock. Reported rather than omitted because AC-026 requires ceremony " +
        "to be asserted independently of the permit.",
      owner: "WS-7 T3 / WS-3 ceremony action — a deliberate ceremony action is a product decision",
      isWs8Scope: false
    }),
    Object.freeze({
      what: "NO BUILD REGISTRY",
      detail:
        "The build registry is an injected input with no producer (T16 entry 0024 handoff #3): nothing emits " +
        "construct/deploy/promote because no room is attributed to a named authority. Empty is reported rather than " +
        "presented as a verified separation. STILL OPEN — T21's seam guard is its consumer.",
      owner: "owner decision, consumed by T21 — who builds what is not derivable from the repository",
      isWs8Scope: false
    }),
    Object.freeze({
      what: "NO LADDER STORE — AND THIS IS CORRECT, NOT MISSING",
      detail:
        "There is deliberately no store that advances or records the paper -> demo -> live rung. D6 is implemented by its " +
        "absence: T11 carries rung through with no writing branch (tiers.mjs:81-83), and the ceremony store's unlock seam " +
        "refuses outside a test run (ceremonyState.mjs:189-191). Recorded so the absent store is not mistaken for " +
        "unfinished work. The room's current rung is the broker registry's activeExecutor, which is its own producer.",
      owner: "not applicable — this is D6 and AC-025 working as specified",
      isWs8Scope: false
    })
  ]),
  reason:
    `No scope in this room logically belongs to WS-8. Every producer this room displays was built by another task and is ` +
    `consumed unmodified: D6's ladder vocabulary and the D5 permit from the new permit readout over T16's own store ` +
    `(T16 entry 0024 handoff #4, the first broker record the store has ever held), the current rung from the pre-existing ` +
    `broker registry, the consent rails from the pre-existing command-centre gate set, and the ceremony rails from the ` +
    `pre-existing WS-3 ceremony route that T8's Ceremony room also reads. This room restates no gate, no threshold, no ` +
    `tier and no permit rule — T11 owns what a permit means for an action and T16 owns the permit itself. FOUR ABSENCES ` +
    `ARE NAMED IN THE absences FIELD AND NONE IS WS-8 SCOPE: no authority set, no ceremony-unlock producer, no build ` +
    `registry, and no ladder store — the last being a NON-absence recorded so the list is not misread. The room exposes no ` +
    `live toggle because D19's outcome authorises none: its recorded residual is that the ceremony unlock has never been ` +
    `granted, so gated is not live. A WS-8 handoff here would be false — nothing in this room's subject matter is a WS-8 ` +
    `concern — and recording none while these producers were missing would be the unflagged trim AC-020 prohibits.`,
  /** Exported so the verdict union can be enumerated in a test rather than assumed. */
  verdicts: PAPER_LIVE_VERDICTS,
  verdictVocabulary: Object.freeze({
    permitted: false,
    note:
      "This room has no verdict member meaning 'live is available', by design. PaperLiveVerdict is exactly " +
      "'no-live-affordance' | 'unknown' and a test enumerates the members, so adding a permissive one is a deliberate act " +
      "that turns the test red."
  })
} as const

/** Re-exported so a consumer can type against the verdict without a deep import. */
export type { PaperLiveVerdict }