// WS-7 T21 - the WS-7 SEAM GUARD. Spec :1381-1388, acceptance AC-046 / AC-048.
//
// ============================================================================
// THE TWENTY-ONE CHECKS, AND WHY THEY ARE A CLOSED VOCABULARY
// ============================================================================
//
// Spec :1386 names fifteen things the guard checks and the 2026-09-26 round adds
// six. That is twenty-one. `CHECKS` below is that list as DATA, and
// `CHECK_COUNT` is asserted against `CHECKS.length` in the guard's own test, so
// a check cannot be dropped without a red test and cannot be added without one
// too. An enumerated-but-unasserted list is a list that erodes.
//
// Seventeen of the twenty-one are ALREADY enforced by a named existing guard.
// Each entry below records that guard in `ownedBy`, and this gate measures the
// same artefact the owner guard reads rather than re-implementing it. Two copies
// of a safety invariant drift, which is why the tier boundary has a fixture
// (`tierBoundaryFixture.mjs`) and not two literals. The six D-items from the
// 2026-09-26 round are the exceptions: four of them (D22, D25, D26's second
// half, D24) had no owner at all, and this task is where they get one.
//
// ============================================================================
// PROVENANCE: FACTS IN, VERDICTS OUT
// ============================================================================
//
// `ws7-seam-probe.mjs` returns a NUMBER per check and nothing else - no `ok`,
// no `pass`, no boolean verdict. `ok` is computed in ONE place below
// (`evaluateSeam`), from `measured` and `budget` and `comparison` alone. That is
// T19's discipline, inherited: `PASS_LIKE` is exactly `["pass"]`, and there is
// no code path that reaches `pass` without a numeric comparison having happened.
//
// WHY THE EXIT CODE IS NOT "IS THE BRANCH PERFECT". T21 does not require a
// clean sweep. The branch deliberately carries honest incompleteness - 62
// deferred route verdicts, two `incomplete` rooms, B1/B3 BREACH, B2
// WITHDRAWN_UNMEASURED, B9 UNVERIFIED, fifteen open handoffs, two
// order-execution affordances inside a room D1 calls read-only. Those are
// `recorded` or `open`: the gate asserts they are PRESENT and correctly
// CLASSIFIED, prints them with their counts, and never re-litigates them. What
// the exit code DOES move for is a `blocking` check - a safety or contract
// seam that is actually broken - and for any check that failed to run. A guard
// that returned green because nothing was inspected is the failure mode, and it
// is closed twice: every measurement must be finite, and `gateExitCode` refuses
// a report that did not evaluate all twenty-one.
//
// ============================================================================
// TWO CONJUNCTIONS, STATED PLAINLY
// ============================================================================
//
//   D23  `"cancelOrder"` is STILL in READ_ONLY_BLOCKED, AND the sanctioned
//        perps seam exposes the gated member.
//   D26  no unverifiable regulatory/KYC CLAIM string survives, AND the catalog
//        holds at or above the OWNER-APPROVED FLOOR, AND that pin still equals
//        the live count, AND no surviving claim outlives its row.
//
// Each is measured as ALL of its halves independently and the halves are
// reported separately, because each has a half that passes trivially on its own:
//
//   - D23's first half is the naive check. A guard that asserted only it would
//     pass on a repository where the cancel path had been deleted outright -
//     which is exactly the pre-T3 defect D23 exists to fix.
//   - D26's first half is the naive check. A guard that asserted only it would be
//     satisfied by deleting every catalog row, which is the precise thing D26
//     forbids. The remaining three halves are what survive that attack: a floor
//     catches silent deletion, a pin-equality catches a stale pin, and the
//     claim-needs-a-row half catches a claim outliving the row that justified it.
//
// D26's second half was an EQUALITY over eight named row ids until the owner's
// 2026-10-03 ruling. T7b (ab2148a, 2026-09-30) removed those rows, because that
// ruling WAS the answer to the question D26 had deferred, so the equality could
// not be satisfied by any state of the repository. It is now a floor, with its
// provenance recorded in `D26_OWNER_APPROVED_CATALOG_FLOOR`.

import {
  probeSeam,
  PROBE_SCHEMA,
  productionFiles,
  stripComments,
  stripPythonComments,
  codeOf,
  VENUE_RESIDUE_TOKENS,
  REGULATORY_CLAIM_SHAPES,
  D26_CATALOG_ROWS,
  T7B_REMOVED_CATALOG_ROWS,
  D26_OWNER_APPROVED_CATALOG_FLOOR,
  DETECTOR_FILES
} from "./ws7-seam-probe.mjs"

export {
  DETECTOR_FILES,
  PROBE_SCHEMA,
  probeSeam,
  productionFiles,
  stripComments,
  stripPythonComments,
  codeOf,
  VENUE_RESIDUE_TOKENS,
  REGULATORY_CLAIM_SHAPES,
  D26_CATALOG_ROWS,
  T7B_REMOVED_CATALOG_ROWS,
  D26_OWNER_APPROVED_CATALOG_FLOOR
}

/* ==========================================================================
   KINDS - and the structural split between BLOCKING and everything else
   ========================================================================== */

/**
 * `blocking` - a safety or contract seam is broken. Moves the exit code.
 * `evidence` - the ARTEFACT must exist and be honestly labelled. Moves the exit
 *   code when it is absent or unlabelled; a recorded NON-PASS verdict never
 *   does, because B1 is required by AC-044 to stay a visible BREACH.
 * `recorded` - an honest incompleteness the branch deliberately carries.
 *   Reported with its count whatever the verdict is; never consulted by the
 *   exit code.
 */
export const CHECK_KINDS = Object.freeze(["blocking", "evidence", "recorded"])

/** The kinds that can move the exit code. */
export const BLOCKING_KINDS = Object.freeze(["blocking"])

/** The kinds a recorded honest state belongs to. */
export const EVIDENCE_KINDS = Object.freeze(["evidence"])

/** The only value a green row may carry. Nothing else reaches it. */
export const PASS_LIKE = Object.freeze(["pass"])

/** The full verdict vocabulary. `deferred` is NOT pass-like and never green. */
export const VERDICT_VOCABULARY = Object.freeze(["pass", "fail", "deferred"])

/** Spec :1386 says fifteen checks; the 2026-09-26 round adds six. */
export const EXPECTED_CHECK_COUNT = 21
export const SPEC_ORIGINAL_CHECK_COUNT = 15
export const SPEC_ROUND_2026_09_26_CHECK_COUNT = 6

/* ==========================================================================
   BUDGETS - every check compares a measured number to one of these
   ========================================================================== */

/**
 * `ZERO` is the budget for every violation-count check: the measurement is the
 * NUMBER OF VIOLATIONS and the only passing value is none.
 *
 * The at-least budgets are the evidence budgets, and each is a real count
 * derived from a real artefact rather than a number chosen to make the build
 * green. `RAM_FACTS` / `ARM_FACTS` are how many self-describing facts the probe
 * looks for in each artifact, and `probeSeam` counts the ones it actually
 * found - so a truncated or emptied artifact scores below its budget and fails.
 */
export const BUDGETS = Object.freeze({
  ZERO: 0,
  RAM_FACTS: 9,
  ARM_FACTS: 8,
  BUDGET_ROWS: 12
})

/** Comparisons. `at-most` is the default; `at-least` is declared per check. */
export const COMPARISONS = Object.freeze(["at-most", "at-least"])

/* ==========================================================================
   THE TWENTY-ONE CHECKS
   ========================================================================== */

/**
 * `specRef`   - where in the spec the check comes from.
 * `ownedBy`   - the EXISTING guard that owns this invariant, or `null` when T21
 *               introduces the first guard for it. Seventeen are owned and four
 *               are not, and the four are named rather than quietly borrowed.
 *               (The header first said "Nineteen"; recounting `CHECKS` found
 *               seventeen, because D22 and D25 are T21's own inventions even
 *               though their decisions are dated 2026-09-26. The prose is now
 *               derived from the array by a test, so it cannot drift again.)
 * `asserts`   - what the check actually measures, in one sentence.
 */
export const CHECKS = Object.freeze([
  /* ------------------------------- the fifteen of spec :1386 ------------- */
  Object.freeze({
    id: "absence.discovered-scope-complete",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'absence-guard scope completeness' / AC-001, AC-002",
    ownedBy: "executionAbsenceScope.test.mjs + server/scripts/absence-scope.mjs",
    label: "the absence guard's scope is DISCOVERED, and no order-capable module is undeclared",
    asserts:
      "findUndeclaredOrderCapability() over apps/dashboard/server returns zero modules carrying a venue-shaped order call that no reviewed list accounts for.",
    composition: "COMPOSES - reads the discovered set through T0's own module rather than re-walking the tree."
  }),
  Object.freeze({
    id: "venue.expertoption-residue",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'no ExpertOption residue' / R2.1, D2",
    ownedBy: null,
    label: "no venue identifier survives in comment-stripped production code",
    asserts:
      "zero occurrences of an ExpertOption/liveEO credential field, venue function or slug literal, counted in comment-stripped production code only - so the several hundred D2 removal RECORDS neither trip it nor are deleted by it.",
    composition: "NEW - nothing owned this. T20's residue note was prose; this is the measurement."
  }),
  Object.freeze({
    id: "perps.cancel-member-present",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'the cancel member\\'s presence' / AC-009, D23",
    ownedBy: "perpsCancelPath.test.mjs",
    label: "hyperliquidPerps exposes a cancel member that is gated like submitOrder",
    asserts:
      "four facts: the member exists and is exported; it consults modeOf() and refuses on !mode.ok BEFORE swapInstance() builds a venue instance; an unidentifiable cancel is refused locally; it is not a re-export of the raw instance's own member.",
    composition: "COMPOSES - measures the same function T3's test drives."
  }),
  Object.freeze({
    id: "agents.no-wildcard-cors",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'no wildcard CORS' / AC-012, R4.1",
    ownedBy: "agentsCorsGuard.test.mjs",
    label: "the agents service configures no wildcard origin, method or header",
    asserts:
      "zero wildcards in any of the three CORSMiddleware settings, origins resolved through the allowlist function, and no hand-written Access-Control-Allow-Origin wildcard header. Measured on CONFIGURATION: server.py's docstring records the wildcards T4 removed and is stripped first.",
    composition: "COMPOSES - same file, same six facts."
  }),
  Object.freeze({
    id: "secrets.no-plaintext-key",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'no plaintext key' / AC-013, AC-014, R4.2, R4.3",
    ownedBy: "agentsCorsGuard.test.mjs:70-86 + ws6SafetySeamGuard.test.mjs:78-91",
    label: "no real key on disk, none tracked, and no key material in the terminal tree",
    asserts:
      "agents/picc_agents/settings.json is absent OR carries no non-empty api_key; it is untracked; and no 0x-prefixed key literal survives in the client terminal tree. Untracked and keyless are measured separately because only the conjunction is safe.",
    composition: "COMPOSES."
  }),
  Object.freeze({
    id: "model.no-pickle-load-path",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'no pickle load path' / AC-032, D15",
    ownedBy: "modelLayer/__tests__/digestGate.test.mjs:190-235 + artifactFormat.test.mjs",
    label: "the model layer refuses the pickle family on CONTENT and loads none of it",
    asserts:
      "the allow list is exactly [safetensors, cact]; the pickle family is named as FORBIDDEN member suffixes so a renamed torch checkpoint is caught; a refusal code distinct from a digest failure exists; and no model-layer module calls a deserialiser.",
    composition: "COMPOSES."
  }),
  Object.freeze({
    id: "engine.weight-sum-exactly-100",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'the weight sum' / AC-022",
    ownedBy: "copilot/__tests__/expertWeights.test.mjs:32-43",
    label: "the six expert weights sum to exactly 100",
    asserts:
      "the DEVIATION of the live EXPERT_WEIGHT_SUM from 100 is zero. The measurement is the deviation rather than the sum because `sum >= 100` passes on 101, and a tolerant assertion is not an assertion.",
    composition: "COMPOSES - reads the live frozen table, not a copy."
  }),
  Object.freeze({
    id: "engine.tier-boundary-single-authority",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'tier boundaries' / AC-023",
    ownedBy: "copilot/__tests__/tierBoundaryParity.test.mjs + crossRoomInvariantGate.test.mjs (the single-authority walk)",
    label: "the tier boundary has exactly ONE declaration site, and it is T11's fixture",
    asserts:
      "a tree walk finds exactly one non-test file declaring TIER_BOUNDARIES / APLUS_MIN_SCORE / B_MIN_SCORE, and it is tierBoundaryFixture.mjs; A+ is >= 85, B is >= 70, the table is frozen, and the fixture carries its five boundary cases.",
    composition: "COMPOSES - and reuses T20's walk so the two cannot disagree about which file is authoritative."
  }),
  Object.freeze({
    id: "engine.veto-inspectable",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'veto inspectability' / AC-022, D8",
    ownedBy: "copilot/__tests__/vetoes.test.mjs:102-140, 257-292",
    label: "every veto outcome carries its inspectable fields and the permanent store has no mutator",
    asserts:
      "outcome.mjs names all six inspectable fields (ruleId, fired, inputs, suppressed, evaluatedAt, ruleVersion); vetoIndex.mjs freezes the six rule ids and exposes no update/delete/remove/clear/set/put/write/purge/drop/truncate; and the store's retention class is the permanent one.",
    composition: "COMPOSES."
  }),
  Object.freeze({
    id: "authority.separation-of-duties",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'separation of duties' / AC-035",
    ownedBy: "authority/__tests__/separationOfDuties.test.mjs",
    label: "the build/approve collision detector exists, throws, and reads nothing it was not handed",
    asserts:
      "separationOfDuties.mjs exists, names the collision, throws rather than warns, and reaches for no clock, no randomness, no filesystem and no environment variable - so its answer is a pure function of the registry it was given.",
    composition: "COMPOSES."
  }),
  Object.freeze({
    id: "retention.classes-declared",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'retention classes' / AC-033, D8",
    ownedBy: "copilot/__tests__/retention.test.mjs:102-198",
    label: "D8's three retention classes are declared, frozen, and the 90-day window is 90",
    asserts:
      "exactly three classes, both the class list and the kind->class map frozen as data, the kind map non-empty, SNAPSHOT_RETENTION_DAYS === 90, and the retained snapshot field set non-empty and frozen.",
    composition: "COMPOSES - reads the live module."
  }),
  Object.freeze({
    id: "ram.gate-exists-and-last-result",
    kind: "evidence",
    comparison: "at-least",
    specRef: ":1386 'the RAM gate\\'s existence and last result' / AC-043, B10",
    ownedBy: "ramCeilingGate.test.mjs",
    label: "the 2 GB ceiling gate's artifact exists and carries its last measured result",
    asserts:
      "nine self-describing facts are present in apps/dashboard/perf/ram-ceiling-gate.json: the schema, the frozen 2048 MB ceiling, `ceilingIsFrozen`, a finite measured peak in MB, more than one raw sample, the peak's contributing processes, a non-empty verdict, and the B10 budget tag.",
    composition: "COMPOSES - and deliberately does NOT ask whether B10 passed."
  }),
  Object.freeze({
    id: "arm.probe-artifact-present",
    kind: "evidence",
    comparison: "at-least",
    specRef: ":1386 'the ARM probe artifact' / AC-044, B9, B12",
    ownedBy: "perfBudgetVerdicts.test.mjs:294",
    label: "the ARM probe's output is checked in and says whether it ran on an ARM device",
    asserts:
      "eight facts are present in apps/dashboard/perf/arm-probe.json: both schemas, the host platform, an explicit isArm64 boolean, and a verdict AND a reason on B9 and a verdict on B12.",
    composition: "COMPOSES - and deliberately does NOT require B9 to be verified."
  }),
  Object.freeze({
    id: "budget.every-row-verdicted",
    kind: "evidence",
    comparison: "at-least",
    specRef: ":1386 'every budget\\'s verdict' / AC-044",
    ownedBy: "perfBudgetVerdicts.test.mjs:46-83",
    label: "all twelve budget rows carry a verdict drawn from the manifest's own vocabulary, with a reason",
    asserts:
      "twelve rows, each with a verdict from the manifest's seven-token vocabulary and a non-empty reason. A manifest with no row scores 0 here rather than 'nothing to report', and no row is required to be `pass` - AC-044 names B1 and B3 as breaches to keep visible.",
    composition: "COMPOSES."
  }),
  Object.freeze({
    id: "deps.no-unused-dependency",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 'no unused dependency' / :218 'pinned by T21', :764 'T21 fails on an unused package', D14",
    ownedBy: null,
    label: "every declared runtime dependency is referenced by production code",
    asserts:
      "for each manifest's `dependencies`, zero packages with no import/require/import() reference in comment-stripped production source. devDependencies are excluded deliberately: a devDependency with no importer is normal for a workspace whose tooling runs through npm scripts, and calling that unused would be a fabricated finding.",
    composition: "NEW - spec :218 assigns this to T21 and nothing else claims it."
  }),

  /* ------------------- the six added by the 2026-09-26 round ------------- */
  Object.freeze({
    id: "perps.cancelOrder-blocked-and-seam-exposed",
    kind: "blocking",
    comparison: "at-most",
    conjunction: true,
    specRef: ":1386 D23 / AC-009, AC-010, AC-011",
    ownedBy: "perpsSeamGuard.test.mjs:107-116 (half A ONLY)",
    label: "D23 - `cancelOrder` is STILL blocked for non-seam modules AND the sanctioned seam exposes the gated member",
    asserts:
      "BOTH halves. Half A: ccxtConnector.mjs's READ_ONLY_BLOCKED still carries the `cancelOrder` token, so every non-seam module stays read-only. Half B: hyperliquidPerps exports a gated cancelOrder. Each half is measured and reported separately; the count is the number of halves that failed.",
    composition: "COMPOSES half A; NEW half B - the existing guard asserts only that the token is blocked, never that the seam exposes it."
  }),
  Object.freeze({
    id: "catalog.claims-gone-entries-stay",
    kind: "blocking",
    comparison: "at-most",
    conjunction: true,
    specRef: ":1386 D26 / AC-049, D20 (entries half amended by the 2026-10-03 owner ruling)",
    ownedBy: "ws7RegulatoryClaimGuard.test.mjs (half A ONLY)",
    label:
      "D26 - no unverifiable regulatory/KYC claim survives AND the catalog holds at or above the owner-approved floor AND no claim outlives its row",
    asserts:
      "BOTH halves, now four sub-halves. Half A: no licensing-status, securities-commission, KYC-negation or DAX-registration string survives in comment-stripped product code. Half B: the catalog row count is at or above D26_OWNER_APPROVED_CATALOG_FLOOR (44, the post-T7b count - 50 - 13 + 7, measured 2026-09-30). Half C: that pin still EQUALS the live count, so the pin cannot go stale unnoticed. Half D: a venue the owner removed is named in live product code only if its row exists again, so a surviving claim always has a factual row.",
    composition:
      "COMPOSES half A; halves B-D REPLACE an eight-row equality that T7b (ab2148a) made unsatisfiable. Half A is unchanged and remains owned by ws7RegulatoryClaimGuard.test.mjs."
  }),
  Object.freeze({
    id: "lockfile.single-and-no-pnpm",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 D24 / AC-018",
    ownedBy: "ws7LockfileOverrideGuard.test.mjs (overrides only) + T6 (the deletion)",
    label: "D24 - exactly one lockfile is tracked and no manifest field re-implies pnpm",
    asserts:
      "exactly one tracked lockfile, and it is the root package-lock.json; no manifest carries a pnpm-named key or a pnpm `packageManager` value. The override guard owns package.json's declared overrides; the one-lockfile claim was owned by nothing.",
    composition: "COMPOSES the declaration half; NEW the count half."
  }),
  Object.freeze({
    id: "docs.camouflage-policy-linked",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 D22 / AC-015",
    ownedBy: null,
    label: "D22 - the disclosed camouflage policy is LINKED from PICC.md, with its rationale and boundary",
    asserts:
      "the dated record 0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE exists; PICC.md links it; guardrail 2 names the `stealth` opt-out and the AutomationControlled flag it pushes; and guardrail 2 names the real-logged-in-profile import. The LINK is a separate fact from the disclosure because D22 :321 requires the policy be discoverable by an operator reading the product's claims.",
    composition: "NEW - AC-015 asked for a link and nothing checked for one."
  }),
  Object.freeze({
    id: "docs.typing-invariant-states-boundary",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 D25 / AC-015",
    ownedBy: null,
    label: "D25 - the typing invariant states per-action approval, and no broker credential reaches interventions.mjs",
    asserts:
      "FIVE facts, and the third is the subtle one. `no credential reaches interventions.mjs` is NOT `getCredentials is never called there`: interventions.mjs:551 reads the credential object and takes exactly one non-secret scalar out of it (riskPerTradePct). So the measurement is over CREDENTIAL-SHAPED identifiers - token, key, secret, password, passphrase, access token, bearer, any `creds.X` / `credentials.X` field - not over the presence of the accessor. A guard that banned the accessor would be wrong about the code; a guard that banned nothing would be wrong about the boundary.",
    composition: "NEW - AC-015's verification names both tests and neither existed."
  }),
  Object.freeze({
    id: "rooms.completeness-verdict-declared",
    kind: "blocking",
    comparison: "at-most",
    specRef: ":1386 D27 / AC-020, AC-041, R7.5",
    ownedBy: "crossRoomInvariantGate.test.mjs (`correctness.verdict-declared`, `correctness.incomplete-requires-an-open-handoff`)",
    label: "D27 - every room's completion record carries an explicit completeness verdict",
    asserts:
      "all SEVEN record homes declare `verdict: \"complete\" | \"incomplete\"`. The homes are T20's own NAMED_RECORD_SOURCES plus readOnlyRoomCompletions.ts - imported, not restated, so this gate cannot disagree with the cross-room gate about which records exist.",
    composition: "COMPOSES - and the guard's test ALSO re-runs T20's real adapter, so the two measurements are independent by construction."
  })
].map(Object.freeze))

export const CHECK_IDS = Object.freeze(CHECKS.map((c) => c.id))
export const CHECK_COUNT = CHECKS.length
export const BLOCKING_CHECK_IDS = Object.freeze(CHECKS.filter((c) => BLOCKING_KINDS.includes(c.kind)).map((c) => c.id))
export const EVIDENCE_CHECK_IDS = Object.freeze(CHECKS.filter((c) => EVIDENCE_KINDS.includes(c.kind)).map((c) => c.id))
export const CONJUNCTION_CHECK_IDS = Object.freeze(CHECKS.filter((c) => c.conjunction === true).map((c) => c.id))

function budgetOf(check) {
  switch (check.id) {
    case "ram.gate-exists-and-last-result":
      return BUDGETS.RAM_FACTS
    case "arm.probe-artifact-present":
      return BUDGETS.ARM_FACTS
    case "budget.every-row-verdicted":
      return BUDGETS.BUDGET_ROWS
    default:
      return BUDGETS.ZERO
  }
}

/* ==========================================================================
   EVALUATION
   ========================================================================== */

/**
 * Evaluate all twenty-one checks against a probe result.
 *
 * Fails closed three ways, so a check that did not inspect anything cannot read
 * as green:
 *   1. A measurement that is missing, non-numeric or non-finite is recorded as a
 *      FAILURE with a note, never skipped.
 *   2. `ranFullSet` is compared against `CHECKS.length`, so a short-circuited
 *      evaluation changes a count that `gateExitCode` reads.
 *   3. `verdictWord` is a fold over blocking AND evidence checks only, and never
 *      over an open item.
 *
 * @param {Readonly<{measured: Record<string, number>, detail: object, openItems: ReadonlyArray<object>}>} probe
 */
export function evaluateSeam(probe) {
  const measuredIn = probe?.measured ?? {}
  const detail = probe?.detail ?? {}

  const rows = CHECKS.map((check) => {
    const budget = budgetOf(check)
    const measured = measuredIn[check.id]
    const base = {
      id: check.id,
      kind: check.kind,
      label: check.label,
      specRef: check.specRef,
      ownedBy: check.ownedBy,
      asserts: check.asserts,
      composition: check.composition,
      conjunction: check.conjunction === true,
      measured,
      budget,
      comparison: check.comparison
    }

    if (typeof measured !== "number" || !Number.isFinite(measured)) {
      return Object.freeze({
        ...base,
        ok: false,
        verdict: "fail",
        note: "the probe produced no finite measurement for this check, so this check inspected nothing; that is a failure, not a pass"
      })
    }

    // THE ONLY PLACE `ok` IS COMPUTED, for all twenty-one checks.
    const ok = check.comparison === "at-least" ? measured >= budget : measured <= budget

    // A conjunction's halves are surfaced from `detail` so a reader can see
    // WHICH half failed rather than only that one did.
    const halves = conjunctionHalvesFor(check.id, detail)

    return Object.freeze({
      ...base,
      ok,
      verdict: ok ? "pass" : "fail",
      halves,
      note: null
    })
  })

  const ranFullSet = rows.length === CHECKS.length
  const countable = rows.filter((r) => BLOCKING_KINDS.includes(r.kind) || EVIDENCE_KINDS.includes(r.kind))
  const failures = countable.filter((r) => !r.ok)

  return Object.freeze({
    schema: "picc-ws7-seam-report/1",
    probeSchema: probe?.schema ?? null,
    checkCount: CHECK_COUNT,
    ranFullSet,
    rows: Object.freeze(rows),
    failures: Object.freeze(failures.map((r) => Object.freeze({ id: r.id, kind: r.kind, label: r.label, measured: r.measured, budget: r.budget, comparison: r.comparison, halves: r.halves }))),
    /**
     * The honest incompleteness, projected separately and reported whatever the
     * verdict is. Never read by `verdictWord` or `gateExitCode`.
     */
    openItems: Object.freeze(Array.isArray(probe?.openItems) ? probe.openItems.map((i) => Object.freeze({ ...i })) : []),
    /**
     * The overall word. A fold over `countable` only. There is no code path from
     * an open item to this expression.
     */
    verdictWord: countable.length === countableKindsCount() && failures.length === 0 && ranFullSet ? "pass" : "fail"
  })
}

const countableKindsCount = () =>
  CHECKS.filter((c) => BLOCKING_KINDS.includes(c.kind) || EVIDENCE_KINDS.includes(c.kind)).length

function conjunctionHalvesFor(id, detail) {
  if (id === "perps.cancelOrder-blocked-and-seam-exposed") return Object.freeze({ ...(detail.perpsConjunction ?? {}) })
  if (id === "catalog.claims-gone-entries-stay") {
    const d = detail.d26Conjunction ?? {}
    return Object.freeze({
      ...(d.halves ?? {}),
      liveRowCount: d.liveRowCount,
      floorCount: d.floor?.count,
      floorAsOf: d.floor?.asOf,
      floorRulingDate: d.floor?.rulingDate,
      floorArithmetic: d.floor?.arithmetic,
      removedSetStillWithoutARow: Object.freeze(d.removedSetStillWithoutARow ?? []),
      orphanClaims: Object.freeze(d.orphanClaims ?? []),
      widerSetResidual: Object.freeze(d.widerSetResidual ?? [])
    })
  }
  return null
}

/**
 * The exit-code contract.
 *
 * Non-zero when a countable check failed, when the report cannot be fully
 * accounted for, or when any check failed to run. `openItems` are NOT read here:
 * AC-046's floor is about the seam, and the branch's honest incompleteness is
 * the owner's to accept, not a build failure.
 */
export function gateExitCode(report) {
  if (report == null) return 1
  if (!Array.isArray(report.rows)) return 1
  if (report.rows.length !== CHECK_COUNT) return 1
  if (report.ranFullSet !== true) return 1
  if (!VERDICT_VOCABULARY.includes(report.verdictWord)) return 1
  for (const row of report.rows) {
    if (typeof row.measured !== "number" || !Number.isFinite(row.measured)) return 1
    if (!CHECK_KINDS.includes(row.kind)) return 1
    if (!COMPARISONS.includes(row.comparison)) return 1
    if (!PASS_LIKE.includes(row.verdict) && row.verdict !== "fail") return 1
    if (!BLOCKING_KINDS.includes(row.kind) && !EVIDENCE_KINDS.includes(row.kind) && row.ok) return 1
  }
  if ((report.failures ?? []).length > 0) return 1
  return 0
}

/* ==========================================================================
   SELF-TEST INPUT - the failing branches, through the same code path
   ========================================================================== */

/**
 * A synthetic probe with ONE countable check planted in violation, used only by
 * `--fail-branch`. It is not a fixture of record and it is not a measurement of
 * any room: it exists so a branch that has never been seen to fail is not
 * accepted as a gate (AC-043:1113-1114's prohibited side effect, verbatim).
 */
export function syntheticProbe({ breach } = {}) {
  const measured = Object.fromEntries(
    CHECKS.map((c) => [
      c.id,
      budgetOf(c) === BUDGETS.ZERO ? 0 : budgetOf(c)
    ])
  )
  measured[breach ?? "agents.no-wildcard-cors"] = 1
  return Object.freeze({ schema: PROBE_SCHEMA, repoRoot: "<synthetic>", measured: Object.freeze(measured), detail: Object.freeze({}), openItems: Object.freeze([]) })
}

/**
 * A synthetic probe whose open items are populated but every check passes, so
 * the "recorded incompleteness does not move the exit code" claim is testable
 * through the same code a real run uses.
 */
export function syntheticOpenItemProbe() {
  const measured = Object.fromEntries(CHECKS.map((c) => [c.id, budgetOf(c)]))
  return Object.freeze({
    schema: PROBE_SCHEMA,
    repoRoot: "<synthetic>",
    measured: Object.freeze(measured),
    detail: Object.freeze({}),
    openItems: Object.freeze([Object.freeze({ id: "synthetic", classification: "RECORDED", count: 3, of: 3 })])
  })
}

/* ==========================================================================
   THE PROCESS ENTRY POINT
   ========================================================================== */

const GATE_NAME = "[picc-ws7-seam-gate]"

export function printReport(report, { quiet = false } = {}) {
  if (quiet) return
  console.log(`${GATE_NAME} WS-7 seam guard - ${report.checkCount} checks (${SPEC_ORIGINAL_CHECK_COUNT} from :1386 + ${SPEC_ROUND_2026_09_26_CHECK_COUNT} from the 2026-09-26 round)`)
  for (const row of report.rows) {
    const mark = row.verdict === "pass" ? "pass" : "FAIL"
    console.log(
      `${GATE_NAME}   ${mark.padEnd(4)} ${row.kind.padEnd(8)} ${row.id.padEnd(46)} measured=${String(row.measured).padEnd(6)} ${row.comparison.padEnd(8)} budget=${row.budget}`
    )
    if (row.conjunction && row.halves) {
      for (const [half, ok] of Object.entries(row.halves)) {
        if (typeof ok !== "boolean") continue
        console.log(`${GATE_NAME}          half: ${ok ? "OK  " : "FAIL"} ${half}`)
      }
    }
    if (row.note) console.log(`${GATE_NAME}          note: ${row.note}`)
  }
  if (report.openItems.length > 0) {
    console.log(`${GATE_NAME} OPEN ITEMS - surfaced, NOT blocking (${report.openItems.length}):`)
    for (const item of report.openItems) {
      console.log(`${GATE_NAME}   ${item.count}${item.of ? `/${item.of}` : ""}  ${item.id}  [${item.classification}]`)
      if (item.tasks) console.log(`${GATE_NAME}        ${item.tasks.join(", ")}`)
      if (item.routes) console.log(`${GATE_NAME}        ${item.routes.join(", ")}`)
      if (item.rows) console.log(`${GATE_NAME}        ${item.rows.map((r) => `${r.id}=${r.verdict}`).join(", ")}`)
    }
  }
  console.log(`${GATE_NAME} verdict ${report.verdictWord}; ${report.failures.length} failing check(s)`)
}

export async function runCli(argv = process.argv.slice(2)) {
  const quiet = argv.includes("--quiet")
  const args = argv.filter((a) => a !== "--quiet")

  if (args.includes("--checks")) {
    console.log(CHECK_IDS.join("\n"))
    return 0
  }

  if (args.includes("--fail-branch")) {
    const breach = args[args.indexOf("--fail-branch") + 1]?.startsWith("--") === false ? args[args.indexOf("--fail-branch") + 1] : undefined
    const report = evaluateSeam(syntheticProbe({ breach: CHECK_IDS.includes(breach) ? breach : undefined }))
    printReport(report, { quiet })
    const code = gateExitCode(report)
    console.error(`${GATE_NAME} FAIL BRANCH - NOT a measurement of the repository, a planted breach.`)
    console.error(`${GATE_NAME} planted on: ${breach ?? "agents.no-wildcard-cors"}`)
    console.error(`${GATE_NAME} failing checks: ${JSON.stringify(report.failures.map((f) => f.id))}`)
    console.error(`${GATE_NAME} exit ${code}`)
    if (code === 0) {
      console.error(`${GATE_NAME} FAIL: the planted breach did not move the exit code - this gate is not a gate`)
      return 2
    }
    return code
  }

  if (args.includes("--open-item-branch")) {
    const report = evaluateSeam(syntheticOpenItemProbe())
    printReport(report, { quiet })
    const code = gateExitCode(report)
    console.log(`${GATE_NAME} OPEN-ITEM BRANCH - recorded incompleteness only, and it must NOT block.`)
    console.log(`${GATE_NAME} open items: ${report.openItems.length}; exit ${code}`)
    return code === 0 ? 0 : 3
  }

  const probe = probeSeam()
  const report = evaluateSeam(probe)
  printReport(report, { quiet })
  const code = gateExitCode(report)
  console.log(`${GATE_NAME} exit ${code}`)
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