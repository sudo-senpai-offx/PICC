/**
 * WS-7 T9 — the Paper/Live room's view of the execution boundary.
 *
 * ===========================================================================
 * THE HEADLINE: THIS ROOM HAS NO STATE IN WHICH IT SAYS LIVE IS AVAILABLE.
 * ===========================================================================
 *
 * `PaperLiveVerdict` below has exactly two members and neither of them is
 * "permitted", "armed", or "live available":
 *
 *   - `no-live-affordance` — every input was obtained, and the observed facts do
 *     not add up to live execution being available. This is the honest answer for
 *     the whole of this tree, and it is not a hardcoded `false`: it is DERIVED
 *     from four independent producers, and `PaperLiveRoom.test.tsx` proves the
 *     derivation with fixtures where a single conjunct IS satisfied.
 *   - `unknown` — at least one input could not be obtained, was malformed, or
 *     disagreed with another. The room then says so and names what is missing.
 *
 * The absence of a permissive third state is the design. A readout type with a
 * `"live"` member, rendered next to a rung labelled `live`, is a rendering
 * defect waiting for the day every conjunct happens to line up — and on the
 * highest-risk room in WS-7 that is exactly the failure this task was told to
 * prevent. So the type cannot express it, and a test enumerates the members to
 * prove it still cannot.
 *
 * ===========================================================================
 * FAIL CLOSED, IN BOTH DIRECTIONS (and the second is the subtle one)
 * ===========================================================================
 *
 * The obvious failure is rendering permission on an error. The subtler one is
 * rendering a *confident denial* on an error: if the permit store is unreadable,
 * saying "not permitted" is an ASSERTION ABOUT THE WORLD that nothing observed.
 * The honesty contract in `PICC.md:63-64` is `absent -> null` and "unconfigured
 * != zero-filled", so a missing input yields `unknown`, never `no-live-affordance`.
 *
 * So: `unknown` is not a softer `no-live-affordance`. It says the question could
 * not be asked. Both are non-permissive, and they are distinguishable.
 *
 * ===========================================================================
 * THE CONJUNCTION, AND WHY IT IS NOT T11's TIER
 * ===========================================================================
 *
 * AC-026 requires that `automationPermitted: true` must NOT substitute for a
 * ceremony unlock — the two are required INDEPENDENTLY. This module renders the
 * observed facts for each conjunct and never computes an execution tier or an
 * action, because what a permit means for an action is T11's
 * `tiers.mjs:56-101`; a second copy of that boundary is the drift that plan
 * §3.5 Risk 6 names. `conjuncts` is a list of NAMED OBSERVATIONS, not a decision:
 * no consumer of this module can turn a `true` in it into an order.
 *
 * ===========================================================================
 * FOUR PRODUCERS, NONE OF THEM REBUILT
 * ===========================================================================
 *
 *   ladder + permit  -> `GET /api/trading/paper-live/permits` (added by T9; this
 *                       is T16 entry 0024 handoff #4, the store finally given a
 *                       broker record)
 *   current rung      -> `GET /api/trading/brokers`, whose `activeExecutor` is the
 *                       real producer (`brokers.mjs:95`)
 *   consent rails     -> `GET /api/command-centre/overview`, whose per-site gates
 *                       carry the producer's own consent and opt-in notes
 *   ceremony rails    -> `GET /api/command-centre/ceremony`, the pre-existing
 *                       WS-3 route T8's Ceremony room also consumes
 *
 * FOUR INDEPENDENT SOURCES IS A FEATURE HERE, NOT A SMELL. One bundled response
 * would put the ceremony store behind a second route, which is the defect T8
 * refused to create; and it would make one failing request blank the whole room,
 * losing the ability to say WHICH rail is unobserved. The cost is that this
 * projection must compose four readouts — so the composition lives in ONE tested
 * pure function here rather than in the page that fetches them.
 *
 * PURE. No clock, no transport. Every value is copied from a response, and
 * `observedAt` is carried rather than read from `Date.now()`, so a rendered room
 * is reproducible.
 */

/** Who owns an absent observation. D10 reserves this literal for anything unassigned. */
export const PAPER_LIVE_OWNER = "WS-7+"

/**
 * The two verdicts. Deliberately not extensible into a permissive one; see the
 * module header. A test enumerates these members against the type's own
 * declared values, so adding a third is a deliberate act with a failing test.
 */
export type PaperLiveVerdict = "no-live-affordance" | "unknown"

/** Every verdict the type can hold, as data, so a test can enumerate it. */
export const PAPER_LIVE_VERDICTS: readonly PaperLiveVerdict[] = Object.freeze([
  "no-live-affordance",
  "unknown"
] as const)

/** One named OBSERVATION feeding the verdict. Never an order, never a tier. */
export type PaperLiveConjunct = {
  /** The requirement this observation speaks to. */
  requirement: "D5" | "D6" | "AC-026" | "D19"
  /**
   * Whether the requirement is satisfied, or `null` when it was not observed.
   *
   * STRICTLY BOOLEAN OR NULL. An earlier draft put the D6 rung STRING here, which
   * made the surface label a rung of `live` as `observed-false` next to the value
   * `live` — a self-contradicting row produced by a field holding the wrong type.
   * The rung is displayed through `value` instead, so the boolean can stay a
   * boolean and the row cannot contradict itself.
   */
  observed: boolean | null
  /** The underlying fact as text, when there is one worth showing. Never a decision. */
  value: string | null
  /** The human sentence the surface renders for it. */
  label: string
}

export type PaperLiveBrokerRow = {
  brokerId: string
  /** T16's PROVENANCE-GATED read. This is the only value the surface renders. */
  automationPermitted: boolean
  /** The record's own boolean, shown BESIDE the gated read so the gate is visible. */
  recordedFlag: boolean
  provenanceResolves: boolean
  permitChangedAt: number | null
  permitChangedByAuthorityId: string | null
  ceremonyUnlocked: boolean
  changeCount: number
  verdictReason: string
}

export type PaperLiveRail = {
  /** `consent` rails come from the command-centre gate set; `ceremony` from the WS-3 store. */
  source: "consent" | "ceremony"
  /** The producer's own identifier: a gate id or a venue class. */
  id: string
  status: string
  /** The PRODUCER'S OWN note string, copied verbatim. Never summarised. */
  note: string | null
}

export type PaperLiveView = {
  verdict: PaperLiveVerdict
  verdictLabel: string
  verdictReason: string
  /** Named inputs that could not be obtained. Empty exactly when the verdict is derived. */
  missing: readonly string[]
  /** D6's ladder, or `null` when the permit readout did not supply it. */
  ladder: { rungs: readonly string[]; rule: string } | null
  currentRung: string | null
  currentRungReason: string
  brokers: readonly PaperLiveBrokerRow[]
  conjuncts: readonly PaperLiveConjunct[]
  consentRails: readonly PaperLiveRail[]
  ceremonyRails: readonly PaperLiveRail[]
  permitResidual: string | null
  absences: readonly { what: string; detail: string }[]
  /** True only when all four readouts were obtained and every field is projected. */
  complete: boolean
}

/* The four wire shapes. Deliberately permissive in what they ACCEPT and strict
 * in what they TRUST: every field is re-checked, because a readout is data from
 * a route and a room that trusts its shape renders whatever the route sent. */

type PermitResponse = {
  ok?: boolean
  version?: string | null
  ladder?: { rungs?: unknown; rule?: unknown } | null
  brokers?: unknown
  residual?: unknown
  absences?: unknown
}

type BrokerRegistryResponse = {
  ok?: boolean
  activeExecutor?: unknown
}

type OverviewResponse = {
  ok?: boolean
  sites?: unknown
}

type CeremonyResponse = {
  ok?: boolean
  classes?: unknown
}

export type PaperLiveReadouts = {
  /** `null` for a failed/absent fetch. NEVER a locally-built placeholder. */
  permit: PermitResponse | null | undefined
  brokers: BrokerRegistryResponse | null | undefined
  overview: OverviewResponse | null | undefined
  ceremony: CeremonyResponse | null | undefined
}

export function buildPaperLiveView(readouts: PaperLiveReadouts): PaperLiveView {
  const permit = readouts?.permit ?? null
  const brokerRegistry = readouts?.brokers ?? null
  const overview = readouts?.overview ?? null
  const ceremony = readouts?.ceremony ?? null

  const missing: string[] = []

  // ---- the ladder -------------------------------------------------------
  // A ladder whose rungs are absent is not a ladder, and defaulting it to
  // ["paper","demo","live"] here would be this module inventing D6's vocabulary
  // — the same defect as restating a threshold. So an unusable ladder is absent.
  const rawRungs = permit !== null && isObject(permit.ladder) ? permit.ladder.rungs : null
  const rungs =
    Array.isArray(rawRungs) && rawRungs.length > 0 && rawRungs.every((r) => typeof r === "string" && r.length > 0)
      ? Object.freeze(rawRungs.map((r) => r as string))
      : null
  const rule = permit !== null && isObject(permit.ladder) && typeof permit.ladder.rule === "string" ? permit.ladder.rule : null
  if (rungs === null) missing.push("the D6 ladder (from the permit readout)")
  if (rule === null) missing.push("the D6 ladder rule (from the permit readout)")

  // ---- the current rung, from ITS OWN producer ---------------------------
  const activeExecutor =
    brokerRegistry !== null && typeof brokerRegistry.activeExecutor === "string" ? brokerRegistry.activeExecutor : null
  if (activeExecutor === null) {
    missing.push("the current ladder rung (from the broker registry's activeExecutor)")
  }

  // ---- the two disagreeing is NOT silently reconciled -------------------
  // A rung outside the ladder means two producers disagree. Picking either one
  // would pick a winner in a disagreement about which rung execution is on, and
  // the losing rung is the unsafe one to guess. So this is `unknown`.
  const rungAgreesWithLadder = activeExecutor !== null && rungs !== null ? rungs.includes(activeExecutor) : false
  if (activeExecutor !== null && rungs !== null && !rungAgreesWithLadder) {
    missing.push(
      `a rung the ladder does not contain (the broker registry reports ${JSON.stringify(activeExecutor)}, the ladder is ${JSON.stringify(
        rungs.join(", ")
      )})`
    )
  }

  // ---- the brokers, each row required ----------------------------------
  const brokerRows = projectBrokers(permit)
  if (brokerRows.length === 0) {
    missing.push("the per-broker automationPermitted state (from the permit readout)")
  }

  // ---- the rails --------------------------------------------------------
  const consentRails = projectConsentRails(overview)
  if (consentRails.length === 0) {
    missing.push("the consent rails (from the command-centre gate set)")
  }
  const ceremonyRails = projectCeremonyRails(ceremony)
  if (ceremonyRails.length === 0) {
    missing.push("the ceremony rails (from the WS-3 ceremony store)")
  }

  const complete = missing.length === 0

  // ---- the conjuncts, as OBSERVATIONS -----------------------------------
  // Every one of these is `null` when its input is absent, so a missing input
  // cannot masquerade as a satisfied or an unmet requirement.
  const anyPermitted = brokerRows.some((row) => row.automationPermitted === true)
  const allPermitted = brokerRows.length > 0 && brokerRows.every((row) => row.automationPermitted === true)
  const anyRecordedTrueUnbacked = brokerRows.some((row) => row.recordedFlag === true && row.automationPermitted !== true)
  const anyCeremonyUnlocked = brokerRows.some((row) => row.ceremonyUnlocked === true)
  const anyEnablementRecord = ceremonyRails.some((rail) => rail.status === "enablement-recorded")

const conjuncts: PaperLiveConjunct[] = [
    {
      requirement: "D5",
      observed: brokerRows.length === 0 ? null : allPermitted,
      value: null,
      label:
        "D5: auto-execute is permitted only on brokers whose record carries a provenance-resolving approval. Observed across every broker record this readout holds."
    },
    {
      requirement: "D5",
      observed: brokerRows.length === 0 ? null : anyPermitted,
      value: null,
      label: "D5: at least one broker's provenance-gated read is true."
    },
    {
      requirement: "AC-026",
      observed: brokerRows.length === 0 ? null : anyCeremonyUnlocked,
      value: null,
      label: "AC-026: a ceremony unlock is required INDEPENDENTLY of the permit. A true permit does not substitute for one."
    },
    {
      requirement: "AC-026",
      observed: ceremonyRails.length === 0 ? null : anyEnablementRecord,
      value: null,
      label: "AC-026: the ceremony store holds a real enablement record for a venue class."
    },
    {
      // BOOLEAN, with the rung carried in `value`. The requirement is "is the
      // current rung the live one", which is a yes/no question; the rung itself is
      // the evidence, not the answer.
      requirement: "D6",
      observed: activeExecutor === null ? null : activeExecutor === "live",
      value: activeExecutor,
      label:
        "D6: the current rung, from the broker registry's own activeExecutor. This is an input the Copilot cannot mutate."
    },
    {
      requirement: "D19",
      observed: permit === null ? null : true,
      value: null,
      label:
        "D19 (outcome B): the ceremony unlock has never been granted in this tree, so 'gated' is not 'live' and the amended claim must not imply a venue is trading today."
    }
  ]

  // ---- the verdict ------------------------------------------------------
  // TWO branches only, and neither is permissive.
  const verdict: PaperLiveVerdict = complete ? "no-live-affordance" : "unknown"
  const verdictReason = complete
    ? describeNoAffordance({ allPermitted, anyPermitted, anyCeremonyUnlocked, anyEnablementRecord, activeExecutor, anyRecordedTrueUnbacked })
    : `The execution boundary could not be determined, so nothing is claimed about it. Not obtained: ${missing.join(
        "; "
      )}. An unobserved input is NOT a satisfied requirement, and this verdict is deliberately not the same as the derived one below.`

  return Object.freeze({
    verdict,
    verdictLabel: verdict === "unknown" ? "UNKNOWN - not determined" : "No live-trading affordance",
    verdictReason,
    missing: Object.freeze(missing),
    ladder: rungs !== null && rule !== null ? Object.freeze({ rungs, rule }) : null,
    currentRung: rungAgreesWithLadder ? activeExecutor : null,
    currentRungReason:
      activeExecutor === null
        ? "No current rung was observed. The broker registry's activeExecutor is its own producer of that fact, and it was not obtained, so none is invented here."
        : rungAgreesWithLadder
          ? `Read from the broker registry's activeExecutor, and it is a rung the ladder contains. The registry's own comment records that this is unconditionally "paper" because D2/AC-005 removed the only other executor.`
          : `The broker registry reports ${activeExecutor} and the ladder is ${rungs?.join(", ") ?? "absent"}. These disagree, so no current rung is displayed.`
    ,
    brokers: Object.freeze(brokerRows),
    conjuncts: Object.freeze(conjuncts),
    consentRails: Object.freeze(consentRails),
    ceremonyRails: Object.freeze(ceremonyRails),
    permitResidual: permit !== null && typeof permit.residual === "string" ? permit.residual : null,
    absences: projectAbsences(permit),
    complete
  })
}

/**
 * The derived reason, naming WHICH conjunct is unmet.
 *
 * Written as a per-conjunct enumeration rather than a summary because "not live"
 * and "live, and here is every gate you still have to pass" are different
 * sentences, and only one of them is true. The order is the order the requirements
 * chain: D5 first, then AC-026, then the rung.
 */
function describeNoAffordance({ allPermitted, anyPermitted, anyCeremonyUnlocked, anyEnablementRecord, activeExecutor, anyRecordedTrueUnbacked }: {
  allPermitted: boolean
  anyPermitted: boolean
  anyCeremonyUnlocked: boolean
  anyEnablementRecord: boolean
  activeExecutor: string | null
  anyRecordedTrueUnbacked: boolean
}): string {
  const unmet: string[] = []
  if (!anyPermitted) {
    unmet.push("no broker's provenance-gated automationPermitted read is true (D5)")
  } else if (!allPermitted) {
    unmet.push("the permit is granted on some brokers but not all, and the room renders per broker rather than a room-wide permission")
  }
  if (!anyCeremonyUnlocked) {
    unmet.push("no broker record carries a ceremony unlock (AC-026)")
  }
  if (!anyEnablementRecord) {
    unmet.push("the ceremony store holds no enablement record for any venue class (AC-026)")
  }
  if (activeExecutor !== null && activeExecutor !== "live") {
    // NO QUOTES around the rung. React escapes a double quote in TEXT content to
    // `&quot;`, so a quoted enum here would reach the DOM mangled and the reason
    // would read as broken prose to whoever is auditing it. The rung is a closed
    // three-value vocabulary from D6, so it needs no quoting to be unambiguous.
    unmet.push(`the current rung is ${activeExecutor}, not live (D6)`)
  }

  const head =
    unmet.length === 0
      ? "Every observed conjunct is satisfied. This room still exposes no live affordance: it is a readout, and it has no write path."
      : `No live-trading affordance, because ${unmet.join("; ")}.`

  // T16's residual, restated where a reader is most likely to miss it.
  const residual = anyRecordedTrueUnbacked
    ? ` AT LEAST ONE RECORD'S OWN FLAG READS TRUE WHILE ITS PROVENANCE-GATED READ DOES NOT — that is the provenance gate refusing a bare-boolean record, and it is displayed rather than hidden.`
    : ""
  return `${head}${residual}`
}

/**
 * Per-broker rows, copied from the permit readout.
 *
 * A row that is missing a required field is DROPPED rather than defaulted, so a
 * malformed row cannot contribute a `false` to a count and make an absence read
 * as a verified denial.
 */
function projectBrokers(permit: PermitResponse | null): PaperLiveBrokerRow[] {
  if (permit === null || !Array.isArray(permit.brokers)) return []
  const rows: PaperLiveBrokerRow[] = []
  for (const raw of permit.brokers) {
    if (!isObject(raw) || typeof raw.brokerId !== "string" || raw.brokerId.length === 0) continue
    rows.push({
      brokerId: raw.brokerId,
      // `automationPermitted === true` and nothing else: a truthy string, a 1,
      // or "yes" from a route must never read as permission.
      automationPermitted: raw.automationPermitted === true,
      recordedFlag: raw.recordedFlag === true,
      provenanceResolves: raw.provenanceResolves === true,
      permitChangedAt: typeof raw.permitChangedAt === "number" && Number.isFinite(raw.permitChangedAt) ? raw.permitChangedAt : null,
      permitChangedByAuthorityId: typeof raw.permitChangedByAuthorityId === "string" ? raw.permitChangedByAuthorityId : null,
      ceremonyUnlocked: raw.ceremonyUnlocked === true,
      changeCount: typeof raw.changeCount === "number" && Number.isFinite(raw.changeCount) ? raw.changeCount : 0,
      verdictReason: typeof raw.verdictReason === "string" ? raw.verdictReason : "This readout supplied no reason for this broker, so nothing is claimed about it."
    })
  }
  return rows
}

/**
 * The consent rails, from the command-centre gate set.
 *
 * The `note` is the PRODUCER'S OWN string, copied verbatim. This room does not
 * summarise a gate set into "3 of 8 passed": `commandCentreOverview.mjs:177` is
 * where the repo already explains, in its own words, that an automation opt-in
 * is a decision and not an approval, and a paraphrase would be a second and
 * possibly weaker copy of that sentence.
 *
 * ONLY the gates this room's acceptance names are taken: the per-site opt-in
 * gate (D5's automation opt-in), the consent-bearing leg, and the envelope
 * ceiling. The rest of the gate set belongs to the Command Centre room.
 */
function projectConsentRails(overview: OverviewResponse | null): PaperLiveRail[] {
  if (overview === null || !Array.isArray(overview.sites)) return []
  const rails: PaperLiveRail[] = []
  for (const site of overview.sites) {
    if (!isObject(site)) continue
    const siteId = typeof site.site === "string" ? site.site : "unknown-site"
    if (isObject(site.executionLeg) && typeof site.executionLeg.consent === "string") {
      rails.push({
        source: "consent",
        id: `${siteId}/execution-leg-consent`,
        status: typeof site.executionLeg.leg === "string" ? site.executionLeg.leg : "observed",
        note: site.executionLeg.consent
      })
    }
    if (!Array.isArray(site.gates)) continue
    for (const gate of site.gates) {
      if (!isObject(gate) || typeof gate.gate !== "string") continue
      if (!CONSENT_GATE_NAMES.has(gate.gate)) continue
      rails.push({
        source: "consent",
        id: `${siteId}/${gate.gate}`,
        status: typeof gate.status === "string" ? gate.status : "unknown",
        note: typeof gate.note === "string" ? gate.note : null
      })
    }
  }
  return rails
}

/**
 * The gates this room reports, named rather than matched loosely.
 *
 * `per-site-opt-in` is D5's automation opt-in; `envelope-within-ceiling` is the
 * hard cap; `toS-survival` is the venue's own automation permission. A prefix
 * match would sweep in gates whose meaning is the Command Centre room's, and a
 * missing one here would silently drop a rail the acceptance names.
 */
const CONSENT_GATE_NAMES: ReadonlySet<string> = new Set(["per-site-opt-in", "envelope-within-ceiling", "toS-survival"])

/**
 * The ceremony rails, from the WS-3 store.
 *
 * The status vocabulary is deliberately NOT `unlocked` / `not-unlocked`, because
 * the room does not get to decide that: it reports whether an `enablement` RECORD
 * exists, which is the only thing the producer can attest to. R1.4 requires the
 * unlock requirement be asserted rather than assumed, and a store whose gates all
 * pass while holding no enablement record is exactly the case that must not read
 * as unlocked — which is why the enablement record is the whole test.
 */
function projectCeremonyRails(ceremony: CeremonyResponse | null): PaperLiveRail[] {
  if (ceremony === null || !Array.isArray(ceremony.classes)) return []
  const rails: PaperLiveRail[] = []
  for (const row of ceremony.classes) {
    if (!isObject(row) || typeof row.venueClass !== "string") continue
    // Narrowed to the enablement record's own type ONCE, so the `at`/`by` reads
    // below are checked against a shape rather than against `{}` — an earlier
    // draft re-tested `row.enablement` inline and TypeScript widened the repeated
    // `isObject` calls to `{}`.
    //
    // AND THE ROW IS STILL PUSHED WHEN THERE IS NO RECORD. The first attempt at
    // this narrowing wrote `if (!isObject(rawEnablement)) continue`, which DROPPED
    // every venue class whose enablement is absent — i.e. it dropped exactly the
    // absence case, and the room rendered an empty rail list instead of
    // `no-enablement-record`. The full suite caught it; running the file alone had
    // not. An absence that vanishes is indistinguishable from an absence that was
    // never looked for, which is the failure this whole branch is about.
    const rawEnablement = row.enablement
    const enablement = isObject(rawEnablement)
      ? (rawEnablement as { unlocked?: unknown; at?: unknown; by?: unknown })
      : null
    const hasEnablement = enablement !== null && enablement.unlocked === true
    const at = enablement !== null && typeof enablement.at === "string" ? enablement.at : null
    const by = enablement !== null && typeof enablement.by === "string" ? enablement.by : null
    rails.push({
      source: "ceremony",
      id: row.venueClass,
      status: hasEnablement ? "enablement-recorded" : "no-enablement-record",
      note: hasEnablement
        ? `An enablement record exists${at !== null ? `, at ${at}` : ""}${by !== null ? `, by ${by}` : ""}.`
        : "No enablement record. The producer's own unlock seam refuses outside a test run, so on the real rail no such record can come into existence. This is an absence, not a pending approval."
    })
  }
  return rails
}

/** The permit readout's own absences, copied rather than restated. */
function projectAbsences(permit: PermitResponse | null): { what: string; detail: string }[] {
  if (permit === null || !Array.isArray(permit.absences)) return []
  const out: { what: string; detail: string }[] = []
  for (const row of permit.absences) {
    if (!isObject(row) || typeof row.what !== "string") continue
    out.push({ what: row.what, detail: typeof row.detail === "string" ? row.detail : "" })
  }
  return out
}

/* =========================================================================
   THE AFFORDANCE AUDIT
   ========================================================================= */

/**
 * EVERY interactive control this room's own surface can render: NONE.
 *
 * This is an exported, frozen, EMPTY list rather than a comment, because a
 * comment cannot fail a test. `PaperLiveRoom.test.tsx` asserts it is empty AND
 * independently enumerates the rendered markup for every interactive element,
 * so neither the list nor the markup can drift without a red test.
 *
 * WHY THE CEILING IS ZERO, which is D19's outcome rather than T9's choice:
 *
 *  - D19 resolved as outcome (B): the product documentation was AMENDED to
 *    describe the gated rails that actually exist, and the guard's coverage was
 *    made machine-discovered. Its recorded residual is explicit — "the ceremony
 *    unlock has never been granted, so 'gated' is not 'live'". An amended claim
 *    about rails that exist is not an authorisation to offer a control that
 *    advances execution to them.
 *  - D6 states crossing a rung is "a human act with its own ceremony", and this
 *    room exposes no ceremony-action route at all (`ceremonyState.mjs:189-191`
 *    refuses `unlockVenueClass` outside a test run). A toggle here could not
 *    succeed even if it were rendered.
 *  - D5 makes the permit's write path authority-gated in BOTH directions and
 *    refusal is the fail-open direction; a room that offered a toggle would put
 *    an operator in the position of pressing a button whose failure mode leaves
 *    the flag where it was.
 *
 * So the ceiling is zero, and the enumeration below is the evidence.
 */
export const PAPER_LIVE_INTERACTIVE_AFFORDANCES: readonly { id: string; whyPermitted: string }[] = Object.freeze([])

/**
 * Why the ceiling is zero, in words a reader of the room can be shown.
 *
 * Displayed on the surface, and asserted by a test against the absence of any
 * permissive phrasing — a room can mislead with wording as easily as with a
 * control, and "enable live" in a disabled-looking label still reads as available.
 */
export const NO_LIVE_AFFORDANCE_REASON =
  "This room exposes no live-trading control, and the ceiling is zero rather than incidental. " +
  "D19 resolved as outcome (B): the product documentation was amended to describe the gated rails that actually exist, " +
  "and its recorded residual is that the ceremony unlock has never been granted — so 'gated' is not 'live' and the amended " +
  "claim does not authorise a control that advances execution to those rails. D6 makes crossing a rung a human act with " +
  "its own ceremony, and no ceremony-action route exists: the producer's own unlock seam refuses outside a test run with " +
  "ceremony:deny:ceremony-action-unreachable, so a toggle here could not succeed even if one were rendered. D5 additionally " +
  "gates the permit write path on a recorded approving authority in BOTH directions, and that refusal is the fail-open " +
  "direction — an operator pressing a button whose failure leaves the flag where it was would be invited to act on a control " +
  "whose error mode is not obvious. Advancing the ladder is a human act with its own ceremony, and that ceremony is not this room."

/* ------------------------------------------------------------------------ */

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}