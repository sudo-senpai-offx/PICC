// Pre-mortem planner — the verifier (W3-05, Task 3).
//
// WHAT THIS IS. The diff between what the catalog CLAIMS and what the derived
// inventory actually holds. `catalog.mjs` says which tracked test file (and
// optionally which `describe`/`it` title inside it) covers each failure mode;
// `inventory.mjs` says which guard files exist, what titles they declare and how
// many assertions they contain. This module is the only thing that compares the
// two, and every output it produces is one of exactly seven verdicts.
//
// THE SEVEN VERDICTS, AND WHY THERE IS NO EIGHTH. Spec section 4, rule 1: "Never
// a fabricated verdict. Every outcome is one of the seven above, or nothing is
// emitted. No default, no 'probably fine'." A module whose premise is that this
// repository shipped a guard that looked like coverage and was not cannot be the
// module that invents an eighth thing to say when it is unsure. When this code
// cannot place an entry in one of the seven, the entry is reported in the
// direction that under-claims — `stale-catalog-entry` — and never in the
// direction that flatters the system.
//
// WHAT `stale-catalog-entry` ACTUALLY DOES, NAMED HERE BECAUSE A COMMENT THAT
// NAMES A DESTINATION STARTS CLAIMING A MECHANISM. It is a verdict string. It
// appears in `verifyAll`'s `results`, one row per catalog entry. It is not
// sorted, filtered, queued or routed anywhere: nothing in this file feeds a
// stale verdict into `auditCatalog`, and `auditCatalog` never reads `results`.
// A mode whose malformedness the audit ALSO detects therefore shows up in both
// arrays. That is deliberate and is argued at `auditCatalog`, not an oversight
// waiting to be deduplicated.
//
// THE ORDER OF THE TREE IS THE POLICY. Each branch below is written so that the
// more fundamental question is asked first, because the more fundamental
// question's answer can make the later ones irrelevant.
//
// THE FIRST BRANCH IS NOT THE CAPITAL GATE, AND THE REORDERING IS THE POINT. A
// mode carrying neither a `claim` nor an `acceptedUnclaimed` disposition is
// `stale-catalog-entry` for EVERY kind, capital included — spec rule 5, which
// settled a case this module previously decided the other way. The capital
// gate's unconditionality (rule 6) is scoped to INVENTORY CONTENT: it
// guarantees that no file the inventory holds can move a well-formed capital
// entry, and it has nothing to say about an entry the catalog itself left
// malformed, which is a defect about the catalog rather than about the code.
//
// WHAT THE REORDERING COSTS THE CAPITAL GATE: NOTHING. Both of the first two
// branches read only fields of `mode` and neither dereferences `inventory`, so
// the gate's real property — that no inventory content whatsoever can influence
// a capital verdict — survives intact, and the test proving it uses an inventory
// whose every getter throws. The malformed branch sits above the gate because it
// needs no inventory to decide, so asking it first spends nothing the gate was
// relying on.
//
// PURE, AND ONE IMPORT STATEMENT. No store, no network, no `process.env`, no
// clock, no `fs`, no `child_process`. The file declares a single `import` — one
// statement carrying three specifiers — and all three come from `inventory.mjs`:
// `splitClaim`, `isGuardPath` and `GUARD_FILE_SUFFIX`. They are imported rather
// than reimplemented because the `" :: "` split is a CONTRACT with the catalog's
// claim strings and the declared suffix is the contract for what the inventory
// counts as a guard file; a second implementation of either here is a second
// thing that can drift from the first, which is catalog entry SHIP-5's failure
// mode in miniature and the precise defect this whole feature exists to detect.

import { splitClaim, isGuardPath, GUARD_FILE_SUFFIX } from "./inventory.mjs"

/**
 * The verdict vocabulary, frozen.
 *
 * `guard-unregistered` is DELIBERATELY absent, and its absence is load-bearing
 * rather than an oversight. It was designed to catch GUARD-1 — a guard that
 * exists but is absent from a hand-maintained consumer list — but the derived
 * inventory has no such list to be absent FROM, so the verdict has no data
 * source. Reintroducing one to feed the verdict would recreate the exact defect
 * the verdict was invented to catch. The failure mode is not lost: SHIP-1 and
 * SHIP-2 both claim `sharedCommentLexer.test.mjs`, both carry a `gap`, and both
 * therefore report `partially-covered`, which says what `guard-unregistered`
 * reached for using evidence the planner actually has.
 *
 * @type {ReadonlyArray<string>}
 */
export const VERDICTS = Object.freeze([
  "verified",
  "partially-covered",
  "guard-missing",
  "guard-cannot-fail",
  "unclaimed",
  "unverified-manual",
  "stale-catalog-entry"
])

/**
 * One result, built by a helper so every branch carries the same four keys.
 *
 * `id` is the catalog entry's own id, so a caller can line results up against
 * `FAILURE_MODES` without re-deriving which entry produced which verdict.
 * `evidence` is where the REASON lives — the verdict alone is too coarse to
 * distinguish "this file does not exist" from "this file is not something the
 * inventory examines", and those two are different findings for whoever has to
 * act on them. `manualCheck` carries the disposition's own check text, and is
 * non-null only where a human still has work to do.
 */
function outcome({ mode, verdict, evidence, manualCheck = null }) {
  return Object.freeze({
    id: mode.id,
    verdict,
    evidence: Object.freeze(evidence),
    manualCheck: manualCheck ?? null
  })
}

/**
 * The one rule that must not be rearrangements' casualty.
 *
 * RULING 1, AND IT IS DECIDED BEFORE ANY INVENTORY LOOKUP. A capital-risk mode
 * reports `unverified-manual` on its `kind` alone. Nothing the inventory
 * contains — not a matching file, not a file with a thousand assertions, not an
 * empty inventory, not an inventory that has not been gathered — can move it,
 * because the inventory is not read on this branch at all.
 *
 * WHAT IS AND IS NOT GUARANTEED HERE, since the branch is no longer the first
 * one and a reader deserves to know what moved. The guarantee is exactly the one
 * rule 6 states and it is untouched by the reordering: no INVENTORY content can
 * reach this verdict. What is NOT guaranteed is that `kind === "capital"` is
 * consulted before every other question — a malformed mode now returns before
 * reaching here, deliberately, because it is a catalog defect rather than a
 * capital entry awaiting judgement. See the file header.
 *
 * WHY THIS ORDER AND NOT A LATER CHECK. A venue outage mid-position has no
 * guard FILE; there is nothing in the repository that encodes "the venue is
 * reachable", so there is nothing for a test to assert and nothing for this
 * module to verify. A planner that matched such an entry against a loosely
 * related test file would manufacture false confidence in the one place the
 * stakes are highest — worse than no planner at all, because it would convert an
 * unmade decision into a made one. The verdict names the specific check the
 * disposition carries and stops.
 *
 * @param {object} mode a catalog entry
 * @returns {object} an `unverified-manual` outcome
 */
function unverifiedManual(mode) {
  return outcome({
    mode,
    verdict: "unverified-manual",
    evidence: { reason: "capital-risk-is-manual", kind: mode.kind },
    manualCheck: mode.acceptedUnclaimed?.check ?? null
  })
}

/**
 * Whether a mode is MALFORMED: it carries neither a `claim` nor an
 * `acceptedUnclaimed` disposition, so it has said nothing at all.
 *
 * ONE IMPLEMENTATION, USED BY BOTH `verifyMode` AND `auditCatalog`. These two
 * functions are required to agree — rule 3 puts the malformedness in the
 * self-audit and rule 5 puts it in the verdict — and two copies of this
 * predicate would be two things free to drift, which is the whole defect this
 * module exists to detect, in miniature and pointed straight at itself.
 *
 * The test is `null`-and-`undefined`-tolerant rather than truthiness-based so
 * that an empty string or an empty object, which ARE claims of a sort, are not
 * swept into this branch by accident.
 *
 * @param {object} mode a catalog entry
 * @returns {boolean}
 */
function hasNoDisposition(mode) {
  const noClaim = mode.claim === null || mode.claim === undefined
  const noDisposition = mode.acceptedUnclaimed === null || mode.acceptedUnclaimed === undefined
  return noClaim && noDisposition
}

/**
 * @param {object} mode a catalog entry
 * @param {object} inventory `{guards, unreadable}` as `inventory.mjs` produces
 * @returns {object} one frozen outcome
 */
export function verifyMode({ mode, inventory }) {
  // RULING 4, RULE 5: silence is not coverage, for EVERY KIND. A mode with no
  // claim and no disposition is `stale-catalog-entry`, never `unclaimed` — this
  // branch, and `hasNoDisposition` shared with `auditCatalog` so rule 3's
  // independent report cannot disagree with it. Ruling 3 then gives `unclaimed`
  // to whatever DOES carry a disposition, which makes `unclaimed` mean "we know
  // it is uncovered" instead of "we know nothing about it".
  //
  // Asked BEFORE `kind`, which is the reversal of this module's previous
  // ordering and the substance of the fix this round made. See the file header.
  if (hasNoDisposition(mode)) {
    return outcome({
      mode,
      verdict: "stale-catalog-entry",
      evidence: { reason: "no-claim-and-no-disposition", kind: mode.kind }
    })
  }

  // RULING 1, decided before any inventory lookup: the mode is now known
  // WELL-FORMED, so `kind` alone decides it and the inventory is still not
  // dereferenced for anything. See `unverifiedManual` above for why, and the
  // header for why being asked second costs this gate nothing.
  if (mode.kind === "capital") return unverifiedManual(mode)

  if (mode.claim === null || mode.claim === undefined) {
    return outcome({
      mode,
      verdict: "unclaimed",
      evidence: { reason: "accepted-unclaimed-disposition", kind: mode.kind },
      manualCheck: mode.acceptedUnclaimed.check
    })
  }


  // The separator is split by the ONE implementation of it, imported from
  // `inventory.mjs` rather than re-derived here.
  const { file, title } = splitClaim(mode.claim)

  if (file === null) {
    return outcome({
      mode,
      verdict: "stale-catalog-entry",
      evidence: { reason: "claim-is-not-a-path", claim: mode.claim }
    })
  }

  // A claim path outside the inventory's declared scope is NOT `guard-missing`.
  // The inventory examines `.test.mjs` (see `GUARD_FILE_SUFFIX`), and this
  // repository has tracked tests under other extensions that the runner does
  // collect — so reporting "no guard" for one would be a confident false miss
  // in the direction that costs the reader a file they should have opened. The
  // scope is DERIVED from `isGuardPath` rather than hardcoded here, so the
  // distinction stays true if the declared suffix ever changes.
  if (!isGuardPath(file)) {
    return outcome({
      mode,
      verdict: "stale-catalog-entry",
      evidence: {
        reason: "claim-outside-inventory-scope",
        claimPath: file,
        inventoryScope: GUARD_FILE_SUFFIX
      }
    })
  }

  // An entry the inventory tracked but could not READ is not a missing guard and
  // is not a guard asserting nothing; it is a claim that does not resolve, and
  // it is reported as one. Calling it `guard-missing` would assert the file does
  // not exist when the inventory is positively saying it does, and calling it
  // `guard-cannot-fail` would assert a known assertion count of zero when the
  // count was never obtained. Both would be fabrications, in opposite
  // directions.
  // A MISSING OR MALFORMED INVENTORY IS NO EVIDENCE, mirroring `inventory.mjs`'s
  // own treatment of a missing reader. Normalised to empty here rather than
  // guarded at each use, because an un-normalised field is how a `TypeError`
  // would reach a route — and a thrown error is a worse outcome than a
  // pessimistic verdict, since it takes the whole readout down instead of
  // reporting one entry honestly. It can only ever push a claim toward
  // `guard-missing`; it cannot produce a green row, because there is nothing in
  // an absent inventory for a claim to match.
  const guards = Array.isArray(inventory?.guards) ? inventory.guards : []
  const unreadable = Array.isArray(inventory?.unreadable) ? inventory.unreadable : []

  if (unreadable.includes(file)) {
    return outcome({
      mode,
      verdict: "stale-catalog-entry",
      evidence: { reason: "claim-guard-unreadable", claimPath: file }
    })
  }

  const guard = guards.find((g) => g?.file === file)

  // RULING 2: a guard the inventory cannot locate is `guard-missing`, never
  // assumed. There is no partial-credit branch here and no fuzzy path match —
  // a claim naming a file the derived inventory does not hold has not been
  // shown to point at anything.
  if (guard === undefined) {
    return outcome({
      mode,
      verdict: "guard-missing",
      evidence: { reason: "claim-guard-not-in-inventory", claimPath: file }
    })
  }

  // THE GUARD RECORDS ARE UNTRUSTED INPUT TOO, NOT JUST THE INVENTORY OBJECT.
  // `Array.isArray(inventory?.guards)` says nothing about the shape of the
  // records inside it, and a record whose `describes` was null or absent
  // reached `guard.describes.includes(title)` and raised a TypeError — taking
  // the whole readout down over one malformed entry, which is the exact failure
  // the normalisation above exists to prevent and which was simply not extended
  // far enough. Normalised here, once, rather than guarded at each use.
  //
  // THE THREE FIELDS ARE NOT INTERCHANGEABLE WHEN THEY ARE MISSING, and that is
  // the whole reason this block does more than coerce:
  //
  // - `asserts: 0` is a positive statement from the extractor that the file
  //   asserts nothing. A MISSING count is the extractor having said nothing, and
  //   the two must not collapse: doing so would report `guard-cannot-fail`,
  //   which asserts a count of zero that was never established.
  // - `describes: []` says the file declares no titles. A missing `describes`
  //   says nothing of the kind, and treating it as `[]` would fabricate the
  //   ABSENCE of the claimed title — the one direction this module may not
  //   guess in.
  //
  // So each is normalised to either a usable value or `null`, and `null` takes
  // the `stale-catalog-entry` branch that means "the catalog's claim does not
  // resolve against what we could read".
  const asserts = Number.isFinite(guard.asserts) ? guard.asserts : null
  const describes = Array.isArray(guard.describes) ? guard.describes : null
  const unresolvedTitles = Number.isFinite(guard.unresolvedTitles) ? guard.unresolvedTitles : null

  // RULING 7: `guard-cannot-fail` is EXACTLY this — the guard resolved and
  // asserts nothing. It is checked before any title matching because a file
  // with no `expect(` cannot fail whatever titles it happens to declare, so a
  // title match would not make it any less vacuous. A guard WITH assertions is
  // never this verdict, however narrow its coverage is; a narrow guard with
  // assertions is `partially-covered`, which is the next branch.
  //
  // The unreadable count is separated from the zero count so that "we could not
  // measure this" is never reported as "this measures nothing".
  if (asserts === null) {
    return outcome({
      mode,
      verdict: "stale-catalog-entry",
      evidence: { reason: "guard-assertion-count-unreadable", claimPath: file, guardFile: guard.file }
    })
  }

  if (asserts === 0) {
    return outcome({
      mode,
      verdict: "guard-cannot-fail",
      evidence: {
        reason: "guard-asserts-nothing",
        claimPath: file,
        guardFile: guard.file,
        asserts
      }
    })
  }

  // A claim with NO suffix claims the whole file, which is a legitimate claim
  // shape and resolves against the file alone. Neither `describes` nor
  // `unresolvedTitles` applies: they are about titles the extractor could not
  // read, which matters only when a claim asks about a specific one. `asserts`
  // HAS been established above, so this can still be `verified`.
  if (title === null) {
    return resolved(mode, guard, null, asserts)
  }

  // THE TITLE LIST ITSELF WAS UNREADABLE, so the question "does this guard
  // declare that title" was never answerable — let alone answerable "no". This
  // is the same evidence gap as the `unresolvedTitles > 0` branch below and
  // reports the same way, under its own reason string because it is a different
  // defect: there the list is INCOMPLETE, here there is no usable list.
  if (describes === null || unresolvedTitles === null) {
    return outcome({
      mode,
      verdict: "stale-catalog-entry",
      evidence: { reason: "claim-title-list-unreadable", claimPath: file, claimTitle: title }
    })
  }

  const titleFound = describes.includes(title)

  if (titleFound) {
    return resolved(mode, guard, title, asserts)
  }


  // JUDGEMENT CALL, RECORDED RATHER THAN DECIDED SILENTLY: a suffixed claim
  // whose guard EXISTS and whose suffix is NOT among the guard's titles.
  //
  // The answer depends on whether the absence is PROVABLE, and `unresolvedTitles`
  // is exactly that question. `inventory.mjs` counts titles it could not read —
  // modifier chains like `it.each(…)`, whose titles follow the chain rather than
  // the call — so a guard carrying unresolved titles has an incomplete title
  // list, and "this title is not in the list" is NOT the same claim as "this
  // title does not exist in the file".
  //
  // - `unresolvedTitles === 0`: the extractor read every title it could reach and
  //   this one is not among them, so the claim names a test that is not there.
  //   That is a genuine `guard-missing` — the claim is the thing that is
  //   missing, and the guard itself is present and does assert.
  //
  // - `unresolvedTitles > 0`: the title may be inside the unread remainder. The
  //   honest verdict treats it as UNESTABLISHED rather than as absent, and the
  //   only one of the seven that does that is `stale-catalog-entry` — the
  //   catalog's claim does not resolve against the titles we could read.
  //   Reporting `guard-missing` here would be a fabricated ABSENCE, which is
  //   the one direction this module is not permitted to guess in. The verdict
  //   stands on its own in `results`; it is not handed to `auditCatalog`.
  if (unresolvedTitles > 0) {
    return outcome({
      mode,
      verdict: "stale-catalog-entry",
      evidence: {
        reason: "claim-title-unresolved-absent-not-provable",
        claimPath: file,
        claimTitle: title,
        unresolvedTitles
      }
    })
  }

  return outcome({
    mode,
    verdict: "guard-missing",
    evidence: {
      reason: "claim-title-not-declared",
      claimPath: file,
      claimTitle: title,
      declaredTitles: describes.length
    }
  })
}

/**
 * The claim resolved: the file exists, carries assertions, and any suffix was
 * found. What is left to decide is COMPLETENESS.
 *
 * RULING 2 of the spec's honesty list, and the one SHIP-1 was catalogued for: an
 * entry carrying BOTH a claim and a non-null `gap` reports `partially-covered`
 * and never `verified`. A guard that exists is not a failure mode that is
 * closed — SHIP-1's guard is real, passes, and still misses a second lexer
 * declared under a different name. Letting a gap ride along as a footnote is
 * how a half-guarded mode renders as a green row, which is the false confidence
 * the whole planner exists to prevent.
 *
 * The gap text travels in the evidence so a renderer can show the reader WHAT is
 * uncovered rather than only that something is.
 *
 * `asserts` IS PASSED IN RATHER THAN READ OFF `guard`, and that is the whole reason
 * for the fourth parameter. `verifyMode` normalises the count once — to a finite
 * number or to `null` — and every decision about it is made against that single
 * value. This function previously re-derived the same quantity by reading
 * `guard.asserts`, which is SHIP-1's shape in miniature: two derivations of one
 * value, free to drift, agreeing only for as long as nobody changes one of them.
 * They cannot disagree TODAY, because every call site here is downstream of the
 * `asserts === null` branch, but "cannot disagree yet" is how the second pile gets
 * built in the first place. Taking the normalised value closes the gap rather than
 * documenting it.
 *
 * @param {number} asserts the count `verifyMode` already established as finite
 */
function resolved(mode, guard, title, asserts) {
  return outcome({
    mode,
    verdict: mode.gap === null || mode.gap === undefined ? "verified" : "partially-covered",
    evidence: {
      reason: title === null ? "claim-file-resolves" : "claim-title-resolves",
      claimPath: guard.file,
      claimTitle: title,
      asserts,
      gap: mode.gap ?? null
    }
  })
}

/**
 * One audit finding, built by a helper so both defect checks below emit the same
 * four keys in the same order and a change to the finding shape cannot be made
 * in one branch and forgotten in the other.
 */
function finding({ id, reason, ...evidence }) {
  return Object.freeze({
    id,
    verdict: "stale-catalog-entry",
    evidence: Object.freeze({ reason, ...evidence }),
    manualCheck: null
  })
}

/**
 * The self-audit. Catalog unsoundness is reported here, and `verifyAll` runs it
 * BEFORE it evaluates a single claim.
 *
 * RULING 3, and the reason is stated rather than assumed: a pre-mortem that has
 * silently drifted is worse than no pre-mortem, because the reader is looking at
 * a stale map and trusting it. So this runs first and its output is returned
 * SEPARATELY from `results` — a caller that renders them interleaved has thrown
 * away the ordering the rule exists to establish.
 *
 * TWO CHECKS, BOTH READABLE FROM THE CATALOG'S OWN FIELDS ALONE. Neither needs
 * the inventory, which is what lets this function run before any claim is
 * evaluated:
 *
 * - `subsystem` is a repo-relative directory path that must exist (catalog.mjs),
 *   so a path absent from `knownSubsystems` is a subsystem that no longer
 *   exists — spec section 3's worked example of `stale-catalog-entry`.
 * - `hasNoDisposition` is shared verbatim with `verifyMode`, so the verdict
 *   channel and this channel cannot disagree about which entries are malformed.
 *
 * ONE FINDING PER DEFECT, NOT ONE PER ENTRY — an entry carrying two defects
 * appears TWICE. Two reasons, and the first is enough: the two are different
 * repairs for whoever is fixing the catalog (re-path the subsystem versus add a
 * disposition), so collapsing them would leave a known defect unreported, which
 * is this module's whole failure mode with a different symptom. The second is
 * that a single `else if` would make the third defect of rule 3 detectable ONLY
 * when the second is absent — conditional coverage wearing the costume of
 * coverage.
 *
 * WHY A MALFORMED MODE APPEARS IN BOTH `catalogFindings` AND `results`. That is
 * a double report and it is kept deliberately. Rule 3 requires the audit to
 * surface this defect and rule 5 requires the verdict to be `stale-catalog-entry`,
 * and both are binding: deduplicating would mean breaking one of them. The two
 * channels are not redundant either — the audit's evidence says
 * `mode-has-no-disposition`, a fact about the entry's shape, while the verdict's
 * evidence says `no-claim-and-no-disposition` and is a placement in the seven.
 * A consumer reading only `results` still gets the pessimistic verdict; a
 * consumer reading only `catalogFindings` still learns the catalog is unsound.
 * It is also the precedent already set by a vanished subsystem, which
 * `verifyMode` evaluates independently and which the existing suite pins as
 * coexisting rather than as exclusive.
 *
 * @param {object} input
 * @param {ReadonlyArray<object>} input.modes catalog entries
 * @param {ReadonlyArray<string>} input.knownSubsystems repo-relative directories
 * @returns {ReadonlyArray<object>} one finding per catalog defect
 */
export function auditCatalog({ modes, knownSubsystems }) {
  const known = new Set(knownSubsystems)
  const findings = []
  for (const mode of modes) {
    if (!known.has(mode.subsystem)) {
      findings.push(finding({ id: mode.id, reason: "subsystem-not-found", subsystem: mode.subsystem }))
    }
    if (hasNoDisposition(mode)) {
      findings.push(finding({ id: mode.id, reason: "mode-has-no-disposition", kind: mode.kind }))
    }
  }
  return Object.freeze(findings)
}

/**
 * The whole readout: self-audit first, then one verdict per mode, then counts.
 *
 * THE COUNT OBJECT HAS EVERY KEY IN THE VOCABULARY, INCLUDING THE ZEROS. A
 * renderer that iterates `Object.entries(counts)` should be able to say "0
 * capital modes verified" without having to know that absence of the key means
 * the same thing — a missing key reads as "not measured", which is a different
 * claim from "measured, and there were none".
 *
 * AND IT COUNTS THE AUDIT CHANNEL, because not doing so produced a false zero.
 * A mode whose `subsystem` has vanished but whose claim still resolves is
 * reported by the audit in `catalogFindings` and by the claim channel in
 * `results` as `verified`; counting `results` alone gave
 * `stale-catalog-entry: 0`, so a renderer reading only `counts` told a reader the
 * catalog held zero stale entries while the audit had just found one.
 *
 * THE OVERRIDE, AND WHY IT IS AN OVERRIDE RATHER THAN AN ADDITION. Tallying the
 * findings on top would replace that false zero with a false GREEN in the same
 * object — such a mode would count as `verified: 1` AND `stale-catalog-entry: 1`
 * — and would break the per-entry invariant that the totals sum to the number of
 * modes. So an entry the audit names is counted ONCE, under
 * `stale-catalog-entry`: the pessimistic verdict any channel asked for. The
 * per-ROW verdict is not rewritten — `results` still records what the claim
 * channel decided, because each row records what that channel decided — so the
 * coexistence between the two channels is unchanged and `counts` is a summary of
 * them rather than a rewrite.
 *
 * THE OVERRIDE IS NARROW, and the narrowing is load-bearing. It applies per
 * entry, by id, and only for entries the audit actually names: a finding
 * anywhere in the readout must not be allowed to move an unrelated entry's count,
 * or one stale mode would make the readout report zero verified modes — the same
 * defect in the opposite direction.
 *
 * @param {object} input
 * @param {ReadonlyArray<object>} input.modes
 * @param {{guards: ReadonlyArray<object>, unreadable: ReadonlyArray<string>}} input.inventory
 * @param {ReadonlyArray<string>} input.knownSubsystems
 * @returns {{catalogFindings: ReadonlyArray<object>, results: ReadonlyArray<object>, counts: object}}
 */
export function verifyAll({ modes, inventory, knownSubsystems }) {
  // FIRST, and before `results` is built — ruling 3. The audit is pure and the
  // two calls do not otherwise interact, so nothing about the ORDER is visible
  // from the outside; it is pinned by a source-order assertion in the test
  // rather than by any behavioural observation, because there is none to make.
  const catalogFindings = auditCatalog({ modes, knownSubsystems })
  const results = modes.map((mode) => verifyMode({ mode, inventory }))
  const audited = new Set(catalogFindings.map((finding) => finding.id))
  const counts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0]))
  for (const result of results) {
    // RULE 1, ENFORCED RATHER THAN ASSUMED. `counts` is seeded from `VERDICTS`
    // precisely so that a renderer iterating it can trust every key is in the
    // vocabulary; an unguarded `counts[result.verdict] += 1` would silently
    // append an eighth key to an object documented as carrying none, and the
    // existing suite only catches that when a fabricated verdict actually
    // occurs.
    //
    // WHY THIS ONE THROWS WHERE THE MALFORMED-INPUT PATHS DO NOT, because the
    // module also holds a "a thrown error is a worse outcome than a pessimistic
    // verdict" invariant and the two rules look like they disagree. They do not:
    // that invariant is about input this module does not control, where the
    // pessimistic verdict is the best available answer. An out-of-vocabulary
    // verdict is not input at all — `verifyMode` is this module's own function
    // and it is required by construction to emit one of the seven, so reaching
    // this line means the module has broken its own contract. There is no
    // pessimistic verdict for "this module is broken"; there is only a wrong
    // count, which is not pessimistic at all. Failing loudly is the honest
    // option, and `String()` is used because a Symbol verdict would make a
    // template literal throw on its way to being reported.
    //
    // THE GUARD CHECKS `result.verdict`, THE ROW'S OWN VALUE, so the override
    // below cannot smuggle an eighth key past it — the string it substitutes is a
    // literal that is in the vocabulary, and it is only ever used for a row the
    // audit named.
    if (!VERDICTS.includes(result.verdict)) {
      throw new Error(`verifyMode emitted a verdict outside the vocabulary: ${String(result.verdict)}`)
    }
    // THE OVERRIDE. One entry, one count, under the pessimistic verdict when the
    // audit named this entry. See the header for why this is not an addition.
    counts[audited.has(result.id) ? "stale-catalog-entry" : result.verdict] += 1
  }

  return Object.freeze({
    catalogFindings,
    results: Object.freeze(results),
    counts: Object.freeze(counts)
  })
}