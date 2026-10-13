// Pre-mortem planner - the verifier (W3-05, Task 3).
//
// HERMETIC BY INJECTION. Every fixture below is an object literal: a mode, an
// inventory, a subsystem list. Nothing here reads the repository tree, so "this
// guard does not exist" is expressible as an empty `guards` array with no
// filesystem in play - which is strictly stronger for the property being proved
// than a temp dir would be.
//
// A DEVIATION FROM THE BRIEF'S SNIPPET, RECORDED RATHER THAN DROPPED. The brief
// (written before commit a606a90) pins `guard-unregistered` into the verdict
// vocabulary. That verdict was WITHDRAWN - the derived inventory has no registry
// for it to check, and reinstating one would recreate the exact defect this
// feature exists to catch - and `partially-covered` was added in its place. The
// design spec's verdict table and this file's controller both carry the
// post-withdrawal set. This test pins the spec's seven, and the brief's
// one-line array is the thing that is stale.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { stripComments } from "../scripts/guard-primitives.mjs"
import { FAILURE_MODES } from "../services/premortem/catalog.mjs"
import { VERDICTS, auditCatalog, verifyAll, verifyMode } from "../services/premortem/verify.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const VERIFY_SOURCE = readFileSync(
  join(REPO_ROOT, "apps/dashboard/server/services/premortem/verify.mjs"),
  "utf8"
)
// Comments are blanked before EVERY scan of the module's source. This file names
// every one of the things it is forbidden to use — `process.env`, the clock, the
// filesystem — in its own prose, and a raw-text scan would fail on the guard
// that documents the guard. The shared lexer is used rather than a second one
// for exactly the reason catalog entry SHIP-1 exists.
const VERIFY_CODE = stripComments(VERIFY_SOURCE)

/** A shipping mode with a whole-file claim, overriding only what a test names. */
const shipping = (over = {}) => ({
  id: "SHIP-X",
  kind: "shipping",
  severity: "high",
  subsystem: "apps/dashboard/server",
  summary: "s",
  claim: "apps/dashboard/server/__tests__/g.test.mjs",
  gap: null,
  acceptedUnclaimed: null,
  mutation: false,
  rationale: "r",
  ...over
})

/** An inventory holding exactly one guard, built from an injected fixture. */
const withGuard = (over = {}) => ({
  guards: [
    {
      file: "apps/dashboard/server/__tests__/g.test.mjs",
      describes: [],
      unresolvedTitles: 0,
      asserts: 3,
      ...over
    }
  ],
  unreadable: []
})

describe("verify", () => {
  it("pins every verdict in the vocabulary", () => {
    expect([...VERDICTS].sort()).toEqual([
      "guard-cannot-fail",
      "guard-missing",
      "partially-covered",
      "stale-catalog-entry",
      "unclaimed",
      "unverified-manual",
      "verified"
    ])
  })

  it("a claim naming a file the inventory does not hold is guard-missing", () => {
    const r = verifyMode({ mode: shipping(), inventory: { guards: [], unreadable: [] } })
    expect(r.verdict).toBe("guard-missing")
  })

  it("a capital-risk mode is unverified-manual even when a matching guard is present", () => {
    const mode = shipping({
      id: "CAP-1",
      kind: "capital",
      claim: "apps/dashboard/server/__tests__/g.test.mjs",
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "read the exit path" }
    })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("unverified-manual")
    expect(r.manualCheck).toBe("read the exit path")
  })

  it("a mode with no claim and no disposition is stale, never unclaimed", () => {
    const mode = shipping({ claim: null, acceptedUnclaimed: null })
    expect(verifyMode({ mode, inventory: { guards: [], unreadable: [] } }).verdict).toBe("stale-catalog-entry")
  })

  it("the audit reports a malformed mode even when its subsystem is perfectly well known", () => {
    // Spec rule 3 names three catalog defects and this is the third. Until the
    // ruling, `auditCatalog` inspected `subsystem` only, so a malformed mode
    // whose subsystem happened to still exist produced an EMPTY findings array
    // while its own verdict said `stale-catalog-entry` — the audit channel was
    // silent about the defect rule 3 requires it to surface.
    //
    // The subsystem here is deliberately a real one. That is the whole point:
    // the finding must come from the mode's MALFORMEDNESS, not from a
    // subscription failure that would otherwise produce one anyway.
    const mode = shipping({ id: "SHIP-7", claim: null, acceptedUnclaimed: null })
    const findings = auditCatalog({ modes: [mode], knownSubsystems: ["apps/dashboard/server"] })
    expect(findings.map((f) => f.id)).toEqual(["SHIP-7"])
    expect(findings[0].verdict).toBe("stale-catalog-entry")
    expect(findings[0].evidence.reason).toBe("mode-has-no-disposition")
  })

  it("the audit reports a malformed CAPITAL mode, whose verdict is also stale", () => {
    // The case the reviewer's failure scenario describes: `CAP-6` with a known
    // subsystem, no claim and no disposition. Both channels must report it. If
    // either went quiet the defect would be invisible to any consumer that
    // reads one channel rather than both.
    const mode = shipping({ id: "CAP-6", kind: "capital", claim: null, acceptedUnclaimed: null })
    const out = verifyAll({
      modes: [mode],
      inventory: withGuard(),
      knownSubsystems: ["apps/dashboard/server"]
    })
    expect(out.results[0].verdict).toBe("stale-catalog-entry")
    expect(out.catalogFindings.map((f) => f.id)).toEqual(["CAP-6"])
    expect(out.catalogFindings[0].evidence.reason).toBe("mode-has-no-disposition")
  })

  it("an entry carrying two catalog defects appears twice, once per defect", () => {
    // A `findings` array that reported only the FIRST defect would leave a
    // known defect unreported, which is the same under-claiming rule 3 exists
    // to prevent — just with a different symptom. These two are different fixes
    // for whoever is repairing the catalog: re-path the subsystem versus add a
    // disposition. Collapsing them would hide the second.
    const mode = shipping({ id: "SHIP-8", subsystem: "apps/dashboard/server/gone", claim: null, acceptedUnclaimed: null })
    const findings = auditCatalog({ modes: [mode], knownSubsystems: ["apps/dashboard/server"] })
    expect(findings.map((f) => f.evidence.reason).sort()).toEqual([
      "mode-has-no-disposition",
      "subsystem-not-found"
    ])
  })

  it("reports a vanished subsystem as a catalog finding without touching the claim", () => {
    const mode = shipping({
      subsystem: "apps/dashboard/server/gone",
      claim: null,
      acceptedUnclaimed: { owner: "o", date: "d", check: "c" }
    })
    const findings = auditCatalog({ modes: [mode], knownSubsystems: ["apps/dashboard/server"] })
    expect(findings.map((f) => f.id)).toEqual(["SHIP-X"])
    expect(findings[0].verdict).toBe("stale-catalog-entry")
  })

  it("runs the self-audit before any claim and returns counts for every verdict", () => {
    // THE FIXTURE CHANGED, AND THE REASON IS THE OVERRIDE, NOT COSMETICS. This
    // test's two modes used to be: SHIP-A with `subsystem: "vanished"` and a
    // claim naming a guard the inventory does not hold, and SHIP-B clean. It then
    // asserted `guard-missing: 1` and `verified: 1`.
    //
    // SHIP-A's vanished subsystem is a catalog FINDING, so the override counts
    // that entry once under `stale-catalog-entry` and `guard-missing` became 0 —
    // which is the override working, but it silently cost this test its
    // `guard-missing` coverage. So the vanished subsystem moved to a THIRD mode
    // and SHIP-A kept the claim that makes it `guard-missing`. Both properties are
    // now asserted here rather than one being traded for the other.
    const out = verifyAll({
      modes: [
        shipping({ id: "SHIP-A", claim: "apps/dashboard/server/__tests__/gone.test.mjs", subsystem: "apps/dashboard/server" }),
        shipping({ id: "SHIP-B" }),
        shipping({ id: "SHIP-C", subsystem: "apps/dashboard/server/vanished" })
      ],
      inventory: withGuard(),
      knownSubsystems: ["apps/dashboard/server"]
    })
    expect(out.catalogFindings.map((f) => f.id)).toEqual(["SHIP-C"])
    expect(Object.keys(out.counts).sort()).toEqual([...VERDICTS].sort())
    expect(out.counts["guard-missing"]).toBe(1)
    expect(out.counts.verified).toBe(1)
    // And the entry the audit names is counted under the pessimistic verdict, once.
    expect(out.counts["stale-catalog-entry"]).toBe(1)
    expect(Object.values(out.counts).reduce((a, b) => a + b, 0)).toBe(3)
  })

  it("a claim outside the inventory's declared scope is stale, never guard-missing", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/ws6-domain.test.ts" })
    const r = verifyMode({ mode, inventory: { guards: [], unreadable: [] } })
    expect(r.verdict).toBe("stale-catalog-entry")
  })

  it("reports the scope reason in evidence, not only in the verdict", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/ws6-domain.test.ts" })
    const r = verifyMode({ mode, inventory: { guards: [], unreadable: [] } })
    expect(r.evidence.reason).toBe("claim-outside-inventory-scope")
    expect(r.evidence.claimPath).toBe("apps/dashboard/server/__tests__/ws6-domain.test.ts")
  })

  it("a resolving claim with no gap is verified", () => {
    expect(verifyMode({ mode: shipping(), inventory: withGuard() }).verdict).toBe("verified")
  })

  it("a claim that resolves but declares a gap is partially-covered, never verified", () => {
    const mode = shipping({ gap: "the producer half is uncovered" })
    expect(verifyMode({ mode, inventory: withGuard() }).verdict).toBe("partially-covered")
  })

  it("a guard that resolved but asserts nothing is guard-cannot-fail", () => {
    const inv = withGuard({ asserts: 0 })
    expect(verifyMode({ mode: shipping(), inventory: inv }).verdict).toBe("guard-cannot-fail")
  })

  it("a claim with no suffix pointing at a resolving guard is verified", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/g.test.mjs" })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("verified")
    expect(r.evidence.claimTitle).toBeNull()
  })

  it("a suffixed claim whose title the guard declares is verified", () => {
    const mode = shipping({
      claim: "apps/dashboard/server/__tests__/g.test.mjs :: reconciles the two piles"
    })
    const inv = withGuard({ describes: ["reconciles the two piles"] })
    const r = verifyMode({ mode, inventory: inv })
    expect(r.verdict).toBe("verified")
    expect(r.evidence.claimTitle).toBe("reconciles the two piles")
  })

  it("a suffixed claim resolves a partial title, because the title may contain the separator", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/g.test.mjs :: one :: two" })
    const inv = withGuard({ describes: ["one :: two"] })
    expect(verifyMode({ mode, inventory: inv }).verdict).toBe("verified")
  })

  it("a gap never yields verified, even when the whole file is claimed", () => {
    const mode = shipping({ gap: "half the failure mode is uncovered" })
    const inv = withGuard({ describes: ["irrelevant"] })
    expect(verifyMode({ mode, inventory: inv }).verdict).toBe("partially-covered")
  })

  it("a suffixed claim whose title is absent, with nothing unread, is guard-missing", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/g.test.mjs :: a title that is gone" })
    const inv = withGuard({ describes: ["some other title"], unresolvedTitles: 0 })
    const r = verifyMode({ mode, inventory: inv })
    expect(r.verdict).toBe("guard-missing")
    expect(r.evidence.reason).toBe("claim-title-not-declared")
  })

  it("a title that cannot be disproven is unestablished, never reported absent", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/g.test.mjs :: a title that is gone" })
    const inv = withGuard({ describes: ["some other title"], unresolvedTitles: 3 })
    const r = verifyMode({ mode, inventory: inv })
    expect(r.verdict).toBe("stale-catalog-entry")
    expect(r.evidence.unresolvedTitles).toBe(3)
  })

  it("no inventory content whatsoever can upgrade a capital mode", () => {
    // THE STRONG FORM OF RULING 1, BEYOND the controller's own test. That one
    // passes a MATCHING guard, which shows the verdict is not upgraded BY
    // evidence; this one shows it is decided before the inventory is consulted
    // AT ALL. The nine shapes below are the nine the loop actually runs, and the
    // count is asserted so this comment cannot drift away from the array again:
    // a guard matching by path with a thousand assertions, a two-guard
    // inventory, an unreadable-list one, an empty one, an object carrying
    // neither field, one whose fields are the wrong types, a null one, an
    // undefined one, and one holding a guard whose own fields are malformed.
    const mode = shipping({
      id: "CAP-1",
      kind: "capital",
      claim: null,
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "name the human who does" }
    })
    const hostileInventories = [
      withGuard({ asserts: 1000, describes: ["x"], unresolvedTitles: 0 }),
      {
        guards: [
          { file: "a.test.mjs", describes: ["x"], unresolvedTitles: 0, asserts: 1 },
          { file: "b.test.mjs", describes: ["y"], unresolvedTitles: 0, asserts: 1 }
        ],
        unreadable: []
      },
      { guards: [], unreadable: ["a.test.mjs", "b.test.mjs"] },
      { guards: [], unreadable: [] },
      {},
      { guards: "not an array", unreadable: null },
      null,
      undefined,
      { guards: [{ file: "a.test.mjs", asserts: "many", describes: null, unresolvedTitles: 0 }], unreadable: [] }
    ]
    expect(hostileInventories).toHaveLength(9)
    for (const inventory of hostileInventories) {
      const r = verifyMode({ mode, inventory })
      expect(r.verdict).toBe("unverified-manual")
      expect(r.manualCheck).toBe("name the human who does")
    }
  })

  it("a capital mode reporting verified or partially-covered is unreachable", () => {
    // Not a duplicate of the test above: that one pins the verdict for nine
    // inventory shapes. This one pins it against the OTHER verdicts a capital
    // mode could conceivably report, so a future edit cannot make a capital
    // mode silently downgrade into something a renderer would render as coverage.
    //
    // The sweep is a full 2x2x2 cross-product and EVERY cell now contributes:
    // the earlier version iterated over both kinds but recorded only capital, so
    // four of its sixteen iterations decided nothing while the comment read as
    // if the sweep were exhaustive. Recording both kinds is also what makes this
    // a boundary rather than a restatement — the shipping column pins that the
    // same inputs reach four DIFFERENT verdicts, so `capital` collapsing into one
    // of them would show up here as a diff.
    const verdictsByKind = { capital: new Set(), shipping: new Set() }
    for (const claim of [null, "apps/dashboard/server/__tests__/g.test.mjs"]) {
      for (const gap of [null, "half uncovered"]) {
        for (const kind of ["capital", "shipping"]) {
          const r = verifyMode({
            mode: shipping({ kind, claim, gap, acceptedUnclaimed: { owner: "o", date: "d", check: "c" } }),
            inventory: withGuard()
          })
          verdictsByKind[kind].add(r.verdict)
        }
      }
    }
    expect([...verdictsByKind.capital]).toEqual(["unverified-manual"])
    expect([...verdictsByKind.shipping].sort()).toEqual([
      "partially-covered",
      "unclaimed",
      "verified"
    ])
  })

  it("a capital mode carrying neither claim nor disposition is stale, not unverified-manual", () => {
    // THE RULING THAT OVERTURNED AN EARLIER JUDGEMENT CALL, RECORDED RATHER
    // THAN SILENTLY REVERSED. This assertion previously pinned
    // `unverified-manual` here, on the reasoning that the capital gate runs
    // first by design. Spec rule 5 now settles the case the other way and rule 6
    // is what makes that decision rather than a contradiction: the capital
    // gate's unconditionality is scoped to INVENTORY CONTENT, so it protects a
    // mode that is already known well-formed and does not rescue one the catalog
    // itself left malformed. A mode carrying neither a claim nor a disposition
    // is a catalog defect for EVERY kind, and saying `unverified-manual` about it
    // would have reported a well-formed capital entry instead — the flattering
    // direction, which is the one this module is not permitted to guess in.
    const mode = shipping({ id: "CAP-0", kind: "capital", claim: null, acceptedUnclaimed: null })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("stale-catalog-entry")
    expect(r.evidence.reason).toBe("no-claim-and-no-disposition")
  })

  it("the capital gate still holds for a WELL-FORMED capital mode with no claim", () => {
    // The companion to the test above, and the one that keeps the ruling from
    // over-reaching. A capital mode that carries a disposition and simply no
    // claim is exactly the shape rule 6 protects: nothing about it is
    // malformed, and `unverified-manual` with the disposition's own check text
    // is the honest verdict. If a future edit widened the malformed branch to
    // fire on "no claim" ALONE, this test fails while the one above still
    // passes — which is what makes the pair a real boundary rather than one
    // assertion restated twice.
    const mode = shipping({
      id: "CAP-4",
      kind: "capital",
      claim: null,
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "name the human who does" }
    })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("unverified-manual")
    expect(r.manualCheck).toBe("name the human who does")
  })

  it("a capital verdict is decided without the inventory being read at all", () => {
    // The strongest available statement of ruling 1, and stronger than any
    // assertion on a verdict string: this inventory THROWS on every property
    // access. If `verifyMode` touched `inventory` even once before returning for
    // a capital mode, this test would throw rather than return a verdict. A
    // passing test is therefore positive evidence that no inventory content can
    // influence the verdict — not merely that the right string came back.
    const hostile = {
      get guards() {
        throw new Error("inventory was consulted")
      },
      get unreadable() {
        throw new Error("inventory was consulted")
      }
    }
    const mode = shipping({
      id: "CAP-1",
      kind: "capital",
      claim: "apps/dashboard/server/__tests__/g.test.mjs",
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "prove the halt by hand" }
    })
    const r = verifyMode({ mode, inventory: hostile })
    expect(r.verdict).toBe("unverified-manual")
    expect(r.manualCheck).toBe("prove the halt by hand")
  })

  it("a shipping mode with a disposition and no claim is unclaimed, not unverified-manual", () => {
    const mode = shipping({
      claim: null,
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "bisect to the commit" }
    })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("unclaimed")
    expect(r.manualCheck).toBe("bisect to the commit")
  })

  it("reads a missing inventory as no evidence, never as a green row", () => {
    // `inventory.mjs` reads a missing reader as NO EVIDENCE rather than
    // fabricating content, and the same asymmetry holds here: with no inventory
    // at all, a claim cannot be shown to resolve, so it does not resolve. The
    // failure direction is the pessimistic one — `guard-missing`, never
    // `verified` — which is the only safe direction for an input this module
    // does not control.
    const mode = shipping()
    for (const inventory of [undefined, null, {}, { guards: [] }, { unreadable: [] }]) {
      expect(verifyMode({ mode, inventory }).verdict).toBe("guard-missing")
    }
  })

  it("a guard the inventory tracked but could not read resolves no claim", () => {
    // `unreadable` is neither absence nor an assertion count of zero, and both
    // of the verdicts that could otherwise absorb it would be fabrications.
    const mode = shipping()
    const inv = { guards: [], unreadable: ["apps/dashboard/server/__tests__/g.test.mjs"] }
    const r = verifyMode({ mode, inventory: inv })
    expect(r.verdict).toBe("stale-catalog-entry")
    expect(r.evidence.reason).toBe("claim-guard-unreadable")
  })

  it("a malformed guard resolves no claim rather than throwing", () => {
    // THE INVARIANT AT verify.mjs's inventory-normalisation comment, TESTED ON
    // THE PATH THAT USED TO BREAK IT. "A thrown error is a worse outcome than a
    // pessimistic verdict, since it takes the whole readout down instead of
    // reporting one entry honestly" was true of the `inventory` object and was
    // not true of the guard RECORDS inside it: a guard carrying `describes: null`
    // reached `guard.describes.includes(title)` and raised a TypeError.
    //
    // The earlier nine-shape hostile test includes this exact guard shape, but
    // only for a capital mode, which returns before reaching the title check —
    // so it implied coverage it did not provide. A shipping mode with a
    // SUFFIXED claim is what actually gets there, which is why both halves
    // matter: without a suffix the claim resolves on the file alone and never
    // reads `describes`.
    const claim = "apps/dashboard/server/__tests__/g.test.mjs :: a title"
    const malformedGuards = [
      { file: "apps/dashboard/server/__tests__/g.test.mjs", asserts: 3, describes: null, unresolvedTitles: 0 },
      { file: "apps/dashboard/server/__tests__/g.test.mjs", asserts: 3, unresolvedTitles: 0 },
      { file: "apps/dashboard/server/__tests__/g.test.mjs", asserts: 3, describes: "not an array", unresolvedTitles: 0 },
      { file: "apps/dashboard/server/__tests__/g.test.mjs", asserts: 3, describes: [], unresolvedTitles: null }
    ]
    for (const guard of malformedGuards) {
      const r = verifyMode({ mode: shipping({ claim }), inventory: { guards: [guard], unreadable: [] } })
      expect(VERDICTS).toContain(r.verdict)
    }
  })

  it("a guard whose title list is unreadable is stale, never an absent title", () => {
    // The pessimistic direction the throw used to replace with an exception.
    // An unreadable title list is exactly the same evidence gap as
    // `unresolvedTitles > 0` — the extractor did not give us a complete list —
    // so it reports the same way rather than asserting a title is missing.
    const claim = "apps/dashboard/server/__tests__/g.test.mjs :: a title"
    for (const describes of [null, undefined, "not an array"]) {
      const guard = { file: "apps/dashboard/server/__tests__/g.test.mjs", asserts: 3, describes, unresolvedTitles: 0 }
      const r = verifyMode({ mode: shipping({ claim }), inventory: { guards: [guard], unreadable: [] } })
      expect(r.verdict).toBe("stale-catalog-entry")
    }
  })

  it("an unreadable assertion count is never reported as coverage, in either direction", () => {
    // THE FAILURE MODE THIS MODULE EXISTS TO PREVENT, IN ITS FLATTERING FORM.
    // `asserts: 0` is a positive statement from the extractor that the file
    // asserts nothing; a MISSING count is the extractor having said nothing.
    // Collapse the two and a guard that was never measured renders as a verified
    // row — which is the one outcome this feature is capable of producing, and the
    // one it must never produce. It is also the failure a suite cannot see: the
    // fabrication happens while every test stays green.
    //
    // THE SHAPE IS THE WHOLE LESSON, and it is the same one the malformed-guard
    // test above records. A SHIPPING mode with a SUFFIXED claim is what actually
    // reaches the branch at `verify.mjs`'s `asserts === null` guard. The suite's
    // only fixture carrying a non-finite `asserts` sat in the capital-gate test,
    // whose mode returns `unverified-manual` before the branch is ever consulted —
    // so it implied coverage it never provided. A fixture inside a test that
    // short-circuits before the branch is not a test of that branch.
    //
    // `describes` DELIBERATELY CONTAINS the claimed title, and that is what gives
    // the guard below something to resolve against. With the guard present and
    // its title declared, the ONLY thing standing between this input and a green
    // row is the branch under test — so deleting the branch lands on `verified`
    // rather than on some neighbouring verdict that would make the mutation look
    // like it had been caught by accident.
    const claim = "apps/dashboard/server/__tests__/g.test.mjs :: counts every assertion"
    const readable = {
      file: "apps/dashboard/server/__tests__/g.test.mjs",
      describes: ["counts every assertion"],
      unresolvedTitles: 0
    }
    // All four shapes the guard has to survive: the field absent, explicitly
    // null, a non-finite number, and a string. `Number.isFinite` rejects every
    // one of them, which is why four separate fixtures rather than one.
    const unreadableCounts = [
      ["absent", { ...readable }],
      ["null", { ...readable, asserts: null }],
      ["NaN", { ...readable, asserts: NaN }],
      ["a string", { ...readable, asserts: "many" }]
    ]
    expect(unreadableCounts).toHaveLength(4)
    for (const [label, guard] of unreadableCounts) {
      const r = verifyMode({ mode: shipping({ claim }), inventory: { guards: [guard], unreadable: [] } })
      // NOT `verified` — the flattering direction, the row a renderer paints
      // green. Asserted first because it is the direction that costs the reader.
      expect(r.verdict, label).not.toBe("verified")
      // NOT `guard-cannot-fail` EITHER, and the reason it is called out
      // separately is the point: that verdict means `asserts === 0`, a count that
      // was ESTABLISHED by the extractor. This count was never obtained at all,
      // which is a different claim, and it lands on the pessimistic side of the
      // line rather than borrowing the neighbour's reason string.
      expect(r.verdict, label).not.toBe("guard-cannot-fail")
      expect(r.verdict, label).toBe("stale-catalog-entry")
      // The reason is pinned as well as the verdict, so a future edit cannot
      // answer `stale-catalog-entry` here for an unrelated reason and keep this
      // test green — `claim-title-unreadable` reaches the same verdict one branch
      // further down.
      expect(r.evidence.reason, label).toBe("guard-assertion-count-unreadable")
    }
  })

  it("reads only null and undefined as an absent disposition, never falsiness", () => {
    // `hasNoDisposition`'s own doc comment claims the test is
    // `null`-and-`undefined`-tolerant RATHER THAN truthiness-based, so that an
    // empty string or an empty object, "which ARE claims of a sort", are not
    // swept into the malformed branch by accident. Nothing held that claim:
    // rewriting the predicate as truthiness left every test in this file passing.
    // Both halves are pinned here because they discriminate DIFFERENTLY, and a
    // test that pinned only one would keep passing after the other was broken.
    //
    // An empty-string CLAIM is a disposition of sorts, so the mode is not
    // malformed and falls through to the splitter, which refuses it as a path.
    // Under truthiness it would have been reported malformed instead — the same
    // verdict, a different reason, which is what this half pins.
    const emptyClaim = verifyMode({ mode: shipping({ claim: "" }), inventory: withGuard() })
    expect(emptyClaim.verdict).toBe("stale-catalog-entry")
    expect(emptyClaim.evidence.reason).toBe("claim-is-not-a-path")

    // An empty-string DISPOSITION is the stronger half, because here the two
    // implementations disagree on the VERDICT rather than only on the reason:
    // truthiness calls this mode malformed and reports `stale-catalog-entry`,
    // while `null`-tolerance lets it through to the accepted-unclaimed branch and
    // reports `unclaimed`.
    const emptyDisposition = verifyMode({
      mode: shipping({ claim: null, acceptedUnclaimed: "" }),
      inventory: withGuard()
    })
    expect(emptyDisposition.verdict).toBe("unclaimed")
  })
})

// `resolved()` originally read `guard.asserts` while `verifyMode` compared the
// NORMALISED `asserts` — two derivations of one value, which is SHIP-1's shape in
// miniature and exactly what this planner is meant to catch. It cannot produce a
// difference TODAY, because the `asserts === null` branch returns before either
// `resolved()` call site, so no behavioural assertion anywhere in this file can
// distinguish the two. The normalisation is therefore threaded through as an
// argument and what is pinned below is the single derivation itself, read off the
// module's comments-blanked source — the same technique as the audit-ordering
// check below, for the same reason: when nothing observable distinguishes two
// implementations, only the source can.
describe("verify.mjs derives the assertion count once", () => {
  // `stripComments` preserves newlines exactly, so the closing brace of the
  // function is the first `}` at column zero after the declaration.
  const resolvedBody = (source) => {
    const code = stripComments(source)
    const start = code.indexOf("function resolved(")
    if (start === -1) return ""
    return code.slice(start, code.indexOf("\n}", start))
  }

  it("carries the normalised count into the resolved outcome instead of re-reading the record", () => {
    const body = resolvedBody(VERIFY_SOURCE)
    // Scoped and non-empty, so this cannot pass by matching nothing — the same
    // failure the count-guard check guards against.
    expect(body.length).toBeGreaterThan(0)
    expect(body).not.toMatch(/\bguard\s*\.\s*asserts\b/)
  })

  it("bites: the derivation check fails on a body that re-reads the raw record", () => {
    const reverted = `function resolved(mode, guard, title) {
  return outcome({ evidence: { asserts: guard.asserts } })
}`
    expect(resolvedBody(reverted)).toMatch(/\bguard\s*\.\s*asserts\b/)
  })
})

// The purity guard. `verify.mjs` must be reachable from a route as a pure
// function of injected data, so anything that reaches outside the module — a
// store, a network call, the filesystem, a clock, an environment variable — is a
// defect here even if the behaviour is correct on the day it is written. The
// check reads the module's own SOURCE rather than its behaviour, because a
// behavioural probe cannot tell "did not read the filesystem" from "read it and
// found nothing to change the answer".
describe("verify.mjs is a pure module", () => {
  const FORBIDDEN = [
    { pattern: /\bfrom\s+["']node:/, why: "no node builtin import" },
    { pattern: /\brequire\s*\(/, why: "no require" },
    { pattern: /\bprocess\s*\./, why: "no process access" },
    { pattern: /\bDate\s*\.\s*now\b|\bnew\s+Date\b/, why: "no clock read" },
    { pattern: /\bfetch\s*\(/, why: "no network" },
    { pattern: /\bfetchMocks?\b/, why: "no fetch mock" }
  ]

  for (const { pattern, why } of FORBIDDEN) {
    it(`declares no violation: ${why}`, () => {
      expect(VERIFY_CODE).not.toMatch(pattern)
    })
  }

  it("bites: the purity guard fails on a planted violation", () => {
    // A guard that has never been shown to fire is not a guard. The two samples
    // below are the shapes most likely to be added by a well-meaning future edit
    // — a clock read to decide staleness, and an env read to point the verifier
    // at a data directory — and the detectors are run over them directly so the
    // test proves the DETECTOR works rather than only that the module is clean.
    const plantedProcessEnv = 'export function verifyMode(){ const dir = process.env.PICC_DATA_DIR; return dir }'
    const plantedClock = 'export function verifyMode(){ const now = new Date(); return now.getTime() }'
    expect(plantedProcessEnv).toMatch(FORBIDDEN.find((f) => f.why === "no process access").pattern)
    expect(plantedClock).toMatch(FORBIDDEN.find((f) => f.why === "no clock read").pattern)
  })

  it("imports the claim splitter rather than reimplementing the separator split", () => {
    // SHIP-5 in miniature: two evidence piles drifting apart because each
    // re-implemented one predicate. A second `" :: "` split in this file would be
    // exactly that defect, and the fix is to assert its absence rather than to
    // trust that no future edit adds one. The check runs on the module's
    // comments-BLANKED source (via the one shared lexer, itself the subject of
    // catalog entry SHIP-1), because this file legitimately NAMES the separator
    // in prose and a raw-text scan would flag its own documentation.
    expect(VERIFY_SOURCE).toMatch(/from\s+["']\.\/inventory\.mjs["']/)
    const code = stripComments(VERIFY_SOURCE)
    expect(code).not.toContain("::")
    expect(code).not.toMatch(/\.split\(/)
    expect(code).not.toMatch(/indexOf\(/)
  })
})

describe("the self-audit is reported separately from the verdicts", () => {
  // THE ORDERING RULE, MECHANICALLY CHECKED. Spec rule 3 puts the self-audit at
  // the top of the readout, "before any claim is evaluated". That ordering is
  // invisible to every behavioural probe in this file: `auditCatalog` is pure,
  // so swapping it after `modes.map(...)` returns byte-identical results and
  // leaves the whole suite green. The only thing that can tell the two apart is
  // the module's own source text, so that is what is checked — and, per the
  // "a guard that has never been shown to fire is not a guard" principle the
  // purity guard below already states, the detector is run against a planted
  // violation so a passing assertion proves the DETECTOR works.
  const auditRunsFirst = (source) => {
    const body = stripComments(source).slice(stripComments(source).indexOf("export function verifyAll"))
    return body.indexOf("auditCatalog(") < body.indexOf(".map(")
  }

  it("runs the self-audit before evaluating any claim", () => {
    expect(auditRunsFirst(VERIFY_SOURCE)).toBe(true)
  })

  it("bites: the ordering check fails when the audit is moved after the claims", () => {
    const swapped = `export function verifyAll({ modes }) {
      const results = modes.map((m) => m)
      const catalogFindings = auditCatalog({ modes })
      return { catalogFindings, results }
    }`
    expect(auditRunsFirst(swapped)).toBe(false)
  })

  it("bites: the count guard rejects a verdict outside the vocabulary", () => {
    // Rule 1 — "every outcome is one of the seven above, or nothing is emitted"
    // — is a claim about this module's OWN output, so a fabricated verdict is an
    // internal invariant breach rather than bad input from outside. `counts` is
    // seeded from `VERDICTS` exactly so that a renderer iterating it can trust
    // every key is in the vocabulary; an unguarded `counts[result.verdict] += 1`
    // would quietly append an eighth key and break that contract, which is why
    // the increment is guarded rather than merely documented.
    //
    // LIMITATION, STATED RATHER THAN HIDDEN. This pins the GUARD'S PRESENCE, not
    // its runtime behaviour: `verifyAll` derives every verdict from `verifyMode`
    // itself, and the export surface is pinned by the task brief, so there is no
    // injection point through which an out-of-vocabulary verdict could be fed to
    // the counter. Widening the public API purely to make this assertion
    // behavioural was judged a worse trade than a source check plus this note.
    const code = stripComments(VERIFY_SOURCE)
    // Scoped to `verifyAll`'s body: `Object.freeze({` also appears in `outcome`,
    // which returns long before the counter, so an unscoped slice would compare
    // a start index AFTER its end index and yield an empty string — which fails
    // the assertion for the wrong reason and would have kept passing after a
    // correct implementation was written.
    const body = code.slice(code.indexOf("export function verifyAll"))
    const countingLoop = body.slice(body.indexOf("const counts"), body.indexOf("return Object.freeze("))
    expect(countingLoop.length).toBeGreaterThan(0)
    expect(countingLoop).toMatch(/VERDICTS\.includes\(/)
  })

  it("bites: the count guard is absent from an unguarded implementation", () => {
    const unguarded = `const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]))
      for (const result of results) counts[result.verdict] += 1
      return Object.freeze({})`
    const loop = unguarded.slice(unguarded.indexOf("const counts"), unguarded.indexOf("return Object.freeze("))
    expect(loop).not.toMatch(/VERDICTS\.includes\(/)
  })

  it("surfaces a vanished subsystem even when that mode's claim would verify", () => {
    // Ruling 3 made concrete: the audit does not SUPPRESS claim evaluation, it
    // reports alongside it and in its own array. A mode whose subsystem has
    // vanished but whose guard resolves is still a catalog defect AND still a
    // resolving claim, and a reader needs both facts rather than whichever the
    // implementation happened to keep.
    const mode = shipping({ id: "SHIP-Z", subsystem: "apps/dashboard/server/vanished" })
    const out = verifyAll({ modes: [mode], inventory: withGuard(), knownSubsystems: ["apps/dashboard/server"] })
    expect(out.catalogFindings.map((f) => f.id)).toEqual(["SHIP-Z"])
    expect(out.results[0].verdict).toBe("verified")
  })

  it("COUNTS the audit channel, so `counts` cannot report zero defects the audit found", () => {
    // ── THE FALSE ZERO THIS PINS, AND WHY COUNTING THE FINDINGS IS NOT THE FIX ──
    //
    // The mode above is the shape: a subsystem that no longer exists, and a claim
    // that still resolves. `catalogFindings` reports the vanished subsystem and
    // `results` reports `verified`, and `counts` was built by counting `results`
    // ALONE — so it answered `stale-catalog-entry: 0`. A renderer reading only
    // `counts` would tell a reader the catalog holds zero stale entries while the
    // audit had just found one.
    //
    // Adding the findings to the tally does NOT fix that, and the reason is worth
    // stating because it is the tempting repair: such a mode would then count as
    // BOTH `verified: 1` AND `stale-catalog-entry: 1`, so the false zero is
    // replaced by a false GREEN in the same object, and the per-entry invariant
    // "counts every entry exactly once" is gone.
    //
    // So the audit OVERRIDES the counted verdict for the entry it names. The
    // per-ROW verdict is untouched — `results` still says `verified`, and the
    // coexistence pinned by the test above is unchanged — because each channel's
    // row records what that channel decided. Only the aggregate stops under-
    // reporting, and it does so by counting the entry once, under the pessimistic
    // verdict any channel asked for.
    const mode = shipping({ id: "SHIP-Z", subsystem: "apps/dashboard/server/vanished" })
    const out = verifyAll({ modes: [mode], inventory: withGuard(), knownSubsystems: ["apps/dashboard/server"] })
    expect(out.counts["stale-catalog-entry"]).toBe(1)
    // AND it is counted ONCE — not once per channel. Two rows for one entry would
    // break the sum pinned by "counts every entry exactly once".
    expect(Object.values(out.counts).reduce((a, b) => a + b, 0)).toBe(1)
    // AND the coexistence is intact: the verdict row still reports what the
    // claim channel decided, which is what makes the aggregate a SUMMARY rather
    // than a rewrite of the rows.
    expect(out.results[0].verdict).toBe("verified")
    expect(out.catalogFindings.map((f) => f.id)).toEqual(["SHIP-Z"])
  })

  it("a malformed entry the audit also names is counted stale once, not twice", () => {
    // TWO findings, ONE entry. `auditCatalog` reports one finding per defect, so
    // an entry carrying both a vanished subsystem and no disposition contributes
    // two rows to `catalogFindings` and must still contribute exactly one to
    // `counts` — otherwise the count would read as two defective entries where
    // there is one. This one was GREEN before the fix: it is a guard against the
    // tempting wrong repair above rather than a catcher of the right one, and it
    // is recorded as such rather than counted as evidence.
    const mode = shipping({ id: "SHIP-W", subsystem: "apps/dashboard/server/vanished", claim: null, acceptedUnclaimed: null })
    const out = verifyAll({ modes: [mode], inventory: withGuard(), knownSubsystems: ["apps/dashboard/server"] })
    expect(out.catalogFindings.length).toBe(2)
    expect(out.counts["stale-catalog-entry"]).toBe(1)
    expect(Object.values(out.counts).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it("an entry the audit says nothing about is counted from its verdict alone", () => {
    // The override is NARROW on purpose. If it were not narrow — if an audit
    // finding anywhere in the readout moved every count — a single stale entry
    // would make the readout report zero verified modes, which is the same defect
    // in the opposite direction: over-claiming instead of under-claiming.
    const out = verifyAll({
      modes: [shipping({ id: "SHIP-OK" }), shipping({ id: "SHIP-BAD", subsystem: "apps/dashboard/server/vanished" })],
      inventory: withGuard(),
      knownSubsystems: ["apps/dashboard/server"]
    })
    expect(out.counts.verified).toBe(1)
    expect(out.counts["stale-catalog-entry"]).toBe(1)
    expect(Object.values(out.counts).reduce((a, b) => a + b, 0)).toBe(2)
  })

  it("reports nothing from the audit when every subsystem is known", () => {
    const out = verifyAll({
      modes: [shipping()],
      inventory: withGuard(),
      knownSubsystems: ["apps/dashboard/server"]
    })
    expect(out.catalogFindings).toEqual([])
  })

  it("carries a zero count for every verdict nothing was reported under", () => {
    // A renderer iterating `counts` must be able to print "0 capital modes
    // verified" without inferring it from a missing key — a missing key reads
    // as "not measured", which is a different claim from "measured, none".
    const out = verifyAll({
      modes: [shipping()],
      inventory: withGuard(),
      knownSubsystems: ["apps/dashboard/server"]
    })
    for (const verdict of VERDICTS) {
      expect(out.counts).toHaveProperty(verdict)
      if (verdict !== "verified") expect(out.counts[verdict]).toBe(0)
    }
    expect(out.counts.verified).toBe(1)
  })
})

describe("verify.mjs against the real catalog", () => {
  // `catalog.mjs` is a code constant with no I/O, so importing it is not
  // pointing a test at the repository tree — the INVENTORY below is injected
  // and deliberately empty, so this proves the planner covers the real
  // catalog's shapes without reading a single file. It is the check that would
  // catch a new entry whose shape the verifier silently mishandles.
  it("places every one of the real entries on a verdict, and never green by default", () => {
    const out = verifyAll({
      modes: FAILURE_MODES,
      inventory: { guards: [], unreadable: [] },
      knownSubsystems: [...new Set(FAILURE_MODES.map((m) => m.subsystem))]
    })
    expect(out.results).toHaveLength(FAILURE_MODES.length)
    for (const r of out.results) expect(VERDICTS).toContain(r.verdict)

    const byId = Object.fromEntries(out.results.map((r) => [r.id, r]))
    expect(byId["CAP-1"].verdict).toBe("unverified-manual")
    expect(byId["CAP-3"].manualCheck).toContain("Prove the halt by hand")
    expect(byId["SHIP-4"].verdict).toBe("unclaimed")
    // SHIP-1/2/3 all carry a gap, so with no guard found they must NOT be
    // `verified`, and no capital entry may be anything but unverified-manual.
    expect(byId["SHIP-1"].verdict).toBe("guard-missing")
    expect(byId["SHIP-2"].verdict).toBe("guard-missing")
    for (const m of FAILURE_MODES.filter((x) => x.kind === "capital")) {
      expect(byId[m.id].verdict).toBe("unverified-manual")
    }
  })

  it("counts every entry exactly once", () => {
    const out = verifyAll({
      modes: FAILURE_MODES,
      inventory: { guards: [], unreadable: [] },
      knownSubsystems: [...new Set(FAILURE_MODES.map((m) => m.subsystem))]
    })
    const total = Object.values(out.counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(FAILURE_MODES.length)
  })
})