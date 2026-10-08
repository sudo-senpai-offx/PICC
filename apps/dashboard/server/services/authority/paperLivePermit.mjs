// WS-7 T9 — the Paper/Live room's permit readout. D5 / D6 / D19 / AC-020 /
// AC-024 / AC-026, and T16 entry 0024 handoff #4.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS: HANDOFF #4, DISCHARGED
// ---------------------------------------------------------------------------
//
// T16 (`f1567ef`) shipped `brokerAutomationPermit.mjs` and recorded, as BS-3
// handoff #4, that the store "has no caller": nothing supplied a broker permit,
// because "wiring the store to a broker record and to the Paper/Live room is
// BS-3 (T9's room displays `automationPermitted` state, `:1278`)".
//
// T8 then shipped the Ministry room and, in `governance.mjs:191`, built its
// readout's permit store with `brokers: []` — correctly, and with the absence
// named at `:249`. So the store still had no broker record at T9's start. This
// file is the wiring: it seeds the store with the broker records that really
// exist in this tree and reads them back.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A NEW ROUTE AND NOT A REUSE OF THE MINISTRY READOUT
// ---------------------------------------------------------------------------
//
// `GET /api/trading/ministry` (`handlers.mjs:3175`, T8) ALREADY reads the permit
// store and reports `permits.brokers` / `changeCount` / `grants`. So the
// obvious cheaper move is to have this room read that block. Three reasons that
// would be wrong:
//
//   1. IT CANNOT ANSWER THE QUESTION. That readout's store holds ZERO brokers by
//      construction, and `ministryGovernanceRoute.test.mjs:244-252` PINS that
//      (`brokers` `[]`, `changeCount` 0, `grants` `[]`, reason matching
//      `/no broker record is wired/i`). Reading it tells the Paper/Live room that
//      nothing is known — which is true of the MINISTRY readout's store and
//      false of a store seeded with real brokers.
//
//   2. IT WOULD COUPLE THE ROOMS AT THE SEAM. T8's own bisect line (spec :1271)
//      and this task's (spec :1280) both require the rooms to degrade
//      independently. A client that fetched the Ministry readout to render
//      Paper/Live would make a Ministry outage blank Paper/Live's permit state.
//
//   3. TWO ROUTES OVER ONE STORE ANSWER ONE QUESTION AT TWO MOMENTS. That is the
//      defect T8 refused to create for the ceremony store (`1fd792b`: "a second
//      ceremony route over one store would give that store two answers taken at
//      two moments"). The same rule applies here.
//
// So this is ONE new route over ONE store, seeded with the real broker records,
// answering the broker-permission question — and it does NOT re-serve the
// ceremony store or the command-centre gate set, both of which already have
// gated routes this room consumes directly (`/api/command-centre/ceremony` at
// `handlers.mjs:1868`, `/api/command-centre/overview` at `:1779`).
//
// The two readouts are not contradictory, and the difference is deliberate: the
// Ministry readout reports the state of ITS OWN empty store, and this one reports
// a store seeded with the brokers in `services/brokers.mjs` (flat
// `listBrokerStatuses()` status reporter, not the `brokers/index.mjs` registry). `governance.mjs`'s
// absence reason is untouched, so its pinned assertion keeps passing.
//
// ---------------------------------------------------------------------------
// THE READ IS T16'S PROVENANCE-GATED ONE, NEVER A BARE BOOLEAN
// ---------------------------------------------------------------------------
//
// `isAutomationPermitted` (`brokerAutomationPermit.mjs:268-274`) requires a true
// flag AND a resolvable approving authority. This readout reports that value as
// `automationPermitted` — and it reports the record's OWN `automationPermitted`
// beside it as `recordedFlag`, so the provenance gate is VISIBLE rather than
// implicit. The room renders `automationPermitted`, never `recordedFlag`.
//
// T16 entry 0024 records the residual honestly: refusing an unattributed
// DECLINE is fail-open, so a decline refused by a colliding authority LEAVES
// THE FLAG TRUE. The provenance gate mitigates that; it does not eliminate it.
// `PERMIT_RESIDUAL` carries T16's own words into the payload so the room can
// state the residual instead of hiding it behind a clean boolean.
//
// ---------------------------------------------------------------------------
// NO CLOCK, NO FILE, NO NETWORK, NO TIER LOGIC
// ---------------------------------------------------------------------------
//
// `at` is a caller-supplied argument to the permit store and this module owns no
// clock: with no broker ever granted, there is no change event and so no time to
// invent. `ok: true` means THE READOUT EXECUTED — never that automation was
// permitted, never that a gate passed.
//
// This file emits FACTS ONLY. It does not compute an execution tier, an action,
// or whether auto-execute is "available": what a permit means for an action is
// T11's `tiers.mjs:56-101`, and a second copy of that boundary is the drift
// plan §3.5 Risk 6 names. D6's ladder is emitted as its fixed three-rung
// VOCABULARY plus its one-directional rule, copied from the decision, because a
// room that cannot name the ladder cannot display it.

import { createBrokerAutomationPermitStore } from "./brokerAutomationPermit.mjs"

/** Stamped on the payload so a reader can tell which readout produced it. */
export const PAPER_LIVE_PERMIT_VERSION = "paper-live-permit/1.0.0"

/**
 * D6's ladder, as a fixed vocabulary. §4.3:630 types `ExecutionTier.rung` as
 * `"paper" | "demo" | "live"`; D6 (`:139-146`) states the ladder is strict and
 * one-directional and that "Crossing a rung is a human act with its own
 * ceremony". Emitted as DATA because the room must display the ladder, and
 * displayed rather than inferred.
 *
 * The order is the ladder's order — lowest rung first — because "one-directional"
 * is a claim about direction and a reader cannot check a claim about direction
 * against an unordered set.
 */
export const D6_LADDER_RUNGS = Object.freeze(["paper", "demo", "live"])

/**
 * D6's rule, quoted from the decision rather than paraphrased. Carried in the
 * payload so the room states the owner's rule in the owner's words, and so a
 * future edit that changes the ladder shape has to change this string too.
 */
export const D6_LADDER_RULE =
  "The paper -> demo -> live ladder is strict and one-directional. Crossing a rung is a human act with its own ceremony. " +
  "No tier, score or booster auto-advances the ladder, and this room offers no control that could attempt to."

/**
 * The broker records this readout holds.
 *
 * These are the three slugs `services/brokers.mjs` pushes into its registry
 * (`ccxt` at `:52`, `yahoo` at `:67`, `paper` at `:80`). The list is duplicated
 * here rather than imported because `listBrokerStatuses()` is ASYNC and probes real
 * credentials (`getCredentials()` at `:34`) and a live connector
 * (`connectedExchangeIds()` at `:49`) — reaching it from a governance readout
 * would make a credential fault blank the permit state.
 *
 * A DUPLICATION THAT CANNOT ROT QUIETLY: `paperLivePermitRoute.test.mjs` calls
 * `listBrokerStatuses()` under isolated stores, DISCOVERS the slugs it actually
 * produces, and asserts this list equals that set. So a fourth broker added to
 * `brokers.mjs` fails the test rather than going unpermitted and unreported.
 */
export const PAPER_LIVE_BROKER_IDS = Object.freeze(["ccxt", "paper", "yahoo"])

/**
 * T16's recorded residual, carried verbatim in substance so the room can state
 * it. Entry 0024 §"The cost, stated rather than hidden": refusing an
 * unattributed decline leaves the flag as it was, possibly `true`.
 */
export const PERMIT_RESIDUAL =
  "A refused DECLINE leaves the recorded flag at its previous value. T16 refuses an unattributed or colliding " +
  "decline in BOTH directions, which is fail-open by construction: after such a refusal the record's own flag may " +
  "still read true. The provenance-gated read is the mitigation and it is not a cure. This room renders the " +
  "provenance-gated read and shows the recorded flag beside it, so the gap is visible rather than hidden."

/**
 * The readout.
 *
 * Pure with respect to its inputs and with respect to time. Never throws for
 * missing data — a governance surface that refuses to render is not a governance
 * surface.
 *
 * @returns {{
 *   ok: true,
 *   version: string,
 *   ladder: {rungs: readonly string[], rule: string},
 *   brokers: ReadonlyArray<{
 *     brokerId: string,
 *     automationPermitted: boolean,
 *     recordedFlag: boolean,
 *     provenanceResolves: boolean,
 *     permitChangedAt: number | null,
 *     permitChangedByAuthorityId: string | null,
 *     ceremonyUnlocked: boolean,
 *     changeCount: number,
 *     verdictReason: string
 *   }>,
 *   changeCount: number,
 *   residual: string,
 *   absences: readonly {what: string, detail: string}[]
 * }}
 */
export function paperLivePermit() {
  // There is NO production authority set in this tree (T16 entry 0024 handoff
  // #3; T8's `governance.mjs:26-39` records the same finding for the Ministry
  // room). It is therefore empty HERE TOO, and that is load-bearing rather than
  // incidental: with no registered authority, `setAutomationPermitted` refuses
  // with `PERMIT_NO_AUTHORITY_CODE` on EVERY call, so no permit can be granted
  // and no broker can read as permitted. The empty set is the reason the
  // `automationPermitted` column below is `false` for all three brokers, and
  // `verdictReason` on each row says so in words.
  const authorities = []

  // The build registry is an INJECTED input with no producer (T16 handoff #3).
  // Empty is the true state and is reported as an absence below.
  const buildRecords = []

  const store = createBrokerAutomationPermitStore({
    authorities,
    buildRecords,
    // `createBrokerRecord` refuses `automationPermitted` / `permitChangedAt` /
    // `permitChangedByAuthorityId` as inputs (`brokerAutomationPermit.mjs:95-104`),
    // so a broker can never be seeded already-permitted. Each record therefore
    // arrives at the D5 default: `automationPermitted: false`, both provenance
    // fields `null`, `ceremonyUnlocked: false`.
    brokers: PAPER_LIVE_BROKER_IDS.map((id) => ({ id }))
  })

  const allChanges = store.allChanges()

  const brokers = PAPER_LIVE_BROKER_IDS.map((brokerId) => {
    const record = store.read(brokerId)
    // `read` returns `null` for a broker this store does not hold. It cannot
    // here — every id in `PAPER_LIVE_BROKER_IDS` was seeded — but the branch is
    // written rather than assumed, because an absent broker record and an
    // unpermitted broker record must not look alike to a reader, and a readout
    // that indexed `.automationPermitted` off `null` would throw.
    if (record === null) {
      return Object.freeze({
        brokerId,
        automationPermitted: false,
        recordedFlag: false,
        provenanceResolves: false,
        permitChangedAt: null,
        permitChangedByAuthorityId: null,
        ceremonyUnlocked: false,
        changeCount: 0,
        verdictReason:
          "This readout holds no broker record under this id, so nothing can be said about its automation permission. An absent record and an unpermitted record are different facts."
      })
    }

    // T16's PROVENANCE-GATED read. This is the value the room renders.
    const permitted = store.isAutomationPermitted(brokerId)
    const resolves = record.permitChangedByAuthorityId !== null

    return Object.freeze({
      brokerId,
      automationPermitted: permitted,
      // The record's own boolean, emitted BESIDE the gated read so the gate is
      // visible. Never rendered as the permission.
      recordedFlag: record.automationPermitted,
      provenanceResolves: resolves,
      permitChangedAt: record.permitChangedAt,
      permitChangedByAuthorityId: record.permitChangedByAuthorityId,
      ceremonyUnlocked: record.ceremonyUnlocked,
      changeCount: store.changes(brokerId).length,
      verdictReason: verdictReasonFor({ permitted, resolves, record })
    })
  })

  return Object.freeze({
    ok: true,
    version: PAPER_LIVE_PERMIT_VERSION,
    ladder: Object.freeze({ rungs: D6_LADDER_RUNGS, rule: D6_LADDER_RULE }),
    brokers: Object.freeze(brokers),
    changeCount: allChanges.length,
    residual: PERMIT_RESIDUAL,
    absences: Object.freeze(ABSENCES)
  })
}

/**
 * The per-broker reason, in words, naming WHICH conjunct is unmet.
 *
 * A bare `false` is not an audit surface: a reader who sees three `false` values
 * cannot tell a broker nobody has looked at from a broker that was looked at and
 * found unpermitted. The conjuncts are enumerated in the order the room must
 * satisfy them, and the first unmet one is the one named.
 */
function verdictReasonFor({ permitted, resolves, record }) {
  if (permitted === true) {
    // Reachable only with a registered approver, so this branch is dead in this
    // tree. It is written anyway: a readout that cannot express the permitted
    // case would misreport the day an authority is named, which is the day the
    // room's accuracy matters most.
    return `The provenance-gated read is TRUE: the flag is set AND the approving authority ${JSON.stringify(record.permitChangedByAuthorityId)} resolves in the registered authority set. Auto-execute is permitted on this broker only WITHIN the current rung and only behind a ceremony unlock — neither of which this readout evaluates.`
  }
  if (record.automationPermitted === true) {
    return (
      "The record's own flag reads TRUE but the provenance-gated read does not, because no approving authority resolves for it. " +
      "T16's provenance gate is what the room renders, so this broker reads as NOT permitted. A bare-boolean record is exactly what the gate exists to refuse."
    )
  }
  if (resolves === false) {
    return `Not permitted, and never granted: the flag is at D5's false default and no approving authority has ever signed for this broker. Setting it true requires a ministry-authority sign-off, and no authority is registered in this tree — so setAutomationPermitted refuses with authority:deny:automation-permit-no-approving-authority on every call.`
  }
  return "Not permitted. The flag was changed and the change's approving authority no longer resolves, so the provenance-gated read refuses it."
}

/**
 * The absences, named rather than defaulted.
 *
 * Each is a real fact about this tree, verified by reading the producers rather
 * than assumed. `ceremonyUnlocked` is the one that would be easiest to miss: it
 * is part of §4.3's `BrokerRecord` and `createBrokerRecord` ACCEPTS it as an
 * input (`brokerAutomationPermit.mjs:85`, `:110`), so it looks wired — but
 * nothing in `apps/dashboard` ever passes it as anything but `false`, so it is
 * permanently `false` and there is no producer for it.
 */
const ABSENCES = Object.freeze([
  Object.freeze({
    what: "NO PRODUCTION AUTHORITY SET",
    detail:
      "There is no production authority registry in this tree. Every referent of createAuthority/defineAuthorities/ " +
      "createBrokerAutomationPermitStore outside T16's own tests and fixtures is T16's model itself. With no " +
      "registered authority, setAutomationPermitted refuses on every call, so no automation permit can be granted. " +
      "This is the direct cause of every false in the brokers column, and it is an owner decision rather than " +
      "later-workstream scope: naming real authorities is not derivable from the repository."
  }),
  Object.freeze({
    what: "NO CEREMONY-UNLOCK PRODUCER",
    detail:
      "BrokerRecord.ceremonyUnlocked (spec §4.3:639) is accepted as an input by createBrokerRecord " +
      "(brokerAutomationPermit.mjs:85, :110) and defaults to false, but nothing under apps/dashboard passes it as " +
      "true. So it is permanently false and cannot currently be the subject of a real ceremony unlock. The room " +
      "reports it rather than omitting it, because AC-026 requires ceremony to be asserted independently of the " +
      "permit and an omitted field could be read as an unmet check that was never run."
  }),
  Object.freeze({
    what: "NO BUILD REGISTRY",
    detail:
      "The build registry is an injected input with no producer (T16 entry 0024 handoff #3): nothing emits " +
      "construct/deploy/promote records because no room is attributed to a named authority. It is empty here, so " +
      "the separation check the permit write path performs has no build evidence to compare against. Empty is " +
      "reported rather than presented as a verified separation."
  })
])