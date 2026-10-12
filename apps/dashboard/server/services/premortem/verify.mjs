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
// direction that under-claims — `stale-catalog-entry`, which routes the entry to
// the self-audit — and never in the direction that flatters the system.
//
// THE ORDER OF THE TREE IS THE POLICY. Each branch below is written so that the
// more fundamental question is asked first, because the more fundamental
// question's answer can make the later ones irrelevant. `kind === "capital"` is
// asked FIRST, before the claim is even split and before the inventory is
// consulted at all; that ordering is ruling 1 below and it is not
// interchangeable with any other arrangement.
//
// PURE, AND ONLY TWO IMPORTS. No store, no network, no `process.env`, no clock,
// no `fs`, no `child_process`. Both imports come from `inventory.mjs`, and
// `CLAIM_SEPARATOR`/`splitClaim` are imported rather than reimplemented because
// the `" :: "` split is a CONTRACT with the catalog's claim strings; a second
// implementation of it in this file is a second thing that can drift from the
// first, which is catalog entry SHIP-5's failure mode in miniature and the
// precise defect this whole feature exists to detect.
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
 * @param {object} mode a catalog entry
 * @param {object} inventory `{guards, unreadable}` as `inventory.mjs` produces
 * @returns {object} one frozen outcome
 */
export function verifyMode({ mode, inventory }) {
  // RULING 1, first statement, before the claim is split and before `inventory`
  // is dereferenced for anything. See `unverifiedManual` above for why.
  if (mode.kind === "capital") return unverifiedManual(mode)

  // RULING 4: silence is not coverage. A mode with no claim and no disposition
  // has said nothing at all, which is a defect in the catalog rather than a
  // statement about the code — so it is `stale-catalog-entry` and never
  // `unclaimed`. Ruling 3 then gives `unclaimed` to whatever DOES carry a
  // disposition, which makes `unclaimed` mean "we know it is uncovered" instead
  // of "we know nothing about it".
  if (mode.claim === null || mode.claim === undefined) {
    if (mode.acceptedUnclaimed === null || mode.acceptedUnclaimed === undefined) {
      return outcome({
        mode,
        verdict: "stale-catalog-entry",
        evidence: { reason: "no-claim-and-no-disposition" }
      })
    }
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

  // RULING 7: `guard-cannot-fail` is EXACTLY this — the guard resolved and
  // asserts nothing. It is checked before any title matching because a file
  // with no `expect(` cannot fail whatever titles it happens to declare, so a
  // title match would not make it any less vacuous. A guard WITH assertions is
  // never this verdict, however narrow its coverage is; a narrow guard with
  // assertions is `partially-covered`, which is the next branch.
  if (guard.asserts === 0) {
    return outcome({
      mode,
      verdict: "guard-cannot-fail",
      evidence: {
        reason: "guard-asserts-nothing",
        claimPath: file,
        guardFile: guard.file,
        asserts: guard.asserts
      }
    })
  }

  // A claim with NO suffix claims the whole file, which is a legitimate claim
  // shape and resolves against the file alone. `unresolvedTitles` does not
  // apply: it counts titles the extractor could not read, which matters only
  // when a claim asks about a specific one.
  if (title === null) {
    return resolved(mode, guard, null)
  }

  const titleFound = guard.describes.includes(title)

  if (titleFound) {
    return resolved(mode, guard, title)
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
  //   catalog's claim does not resolve, which is what routes it to the
  //   self-audit. Reporting `guard-missing` here would be a fabricated ABSENCE,
  //   which is the one direction this module is not permitted to guess in.
  if (guard.unresolvedTitles > 0) {
    return outcome({
      mode,
      verdict: "stale-catalog-entry",
      evidence: {
        reason: "claim-title-unresolved-absent-not-provable",
        claimPath: file,
        claimTitle: title,
        unresolvedTitles: guard.unresolvedTitles
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
      declaredTitles: guard.describes.length
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
 */
function resolved(mode, guard, title) {
  return outcome({
    mode,
    verdict: mode.gap === null || mode.gap === undefined ? "verified" : "partially-covered",
    evidence: {
      reason: title === null ? "claim-file-resolves" : "claim-title-resolves",
      claimPath: guard.file,
      claimTitle: title,
      asserts: guard.asserts,
      gap: mode.gap ?? null
    }
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
 * The subsystem check is the one thing checkable from the catalog's own fields
 * alone: `subsystem` is a repo-relative directory path that must exist
 * (catalog.mjs), so a path absent from `knownSubsystems` is a subsystem that no
 * longer exists — spec section 3's worked example of `stale-catalog-entry`. The
 * claim-side defects (no disposition, claim outside scope, claim that does not
 * resolve) are found by `verifyMode` and surface as that entry's own verdict.
 *
 * @param {object} input
 * @param {ReadonlyArray<object>} input.modes catalog entries
 * @param {ReadonlyArray<string>} input.knownSubsystems repo-relative directories
 * @returns {ReadonlyArray<object>} one finding per unsound entry
 */
export function auditCatalog({ modes, knownSubsystems }) {
  const known = new Set(knownSubsystems)
  const findings = []
  for (const mode of modes) {
    if (!known.has(mode.subsystem)) {
      findings.push(
        Object.freeze({
          id: mode.id,
          verdict: "stale-catalog-entry",
          evidence: Object.freeze({ reason: "subsystem-not-found", subsystem: mode.subsystem }),
          manualCheck: null
        })
      )
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
 * @param {object} input
 * @param {ReadonlyArray<object>} input.modes
 * @param {{guards: ReadonlyArray<object>, unreadable: ReadonlyArray<string>}} input.inventory
 * @param {ReadonlyArray<string>} input.knownSubsystems
 * @returns {{catalogFindings: ReadonlyArray<object>, results: ReadonlyArray<object>, counts: object}}
 */
export function verifyAll({ modes, inventory, knownSubsystems }) {
  // FIRST, and before `results` is built — ruling 3.
  const catalogFindings = auditCatalog({ modes, knownSubsystems })
  const results = modes.map((mode) => verifyMode({ mode, inventory }))
  const counts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0]))
  for (const result of results) counts[result.verdict] += 1
  return Object.freeze({
    catalogFindings,
    results: Object.freeze(results),
    counts: Object.freeze(counts)
  })
}