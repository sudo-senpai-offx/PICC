// Pre-mortem catalog — the curated failure modes this program actually hit.
//
// WHY THIS FILE EXISTS. The pre-mortem planner (design spec
// `docs/superpowers/specs/2026-10-11-pre-mortem-planner-design.md`) has two jobs:
// verify the coverage claims this catalog makes, and name the failure modes that
// have none. Both jobs read THIS array. So the array is the thing that has to be
// trustworthy, and this suite is where that trust is either earned or refuted.
//
// THE FAILURE MODE THAT MOTIVATES EVERY ASSERTION BELOW IS GUARD-1: a guard that
// cannot fail. It is not hypothetical — a hand-rolled comment lexer was pasted
// into a registered consumer and the whole suite stayed green, because the guard
// that was supposed to prevent exactly that only matched one identifier name. A
// suite about verifying other guards, whose own assertions pass on an empty array,
// would be GUARD-1 all over again. Every `for` loop here therefore runs over a
// catalog that a SEPARATE test pins as non-empty.
//
// PURE BY CONSTRUCTION. No store, no network, no `process.env`, no clock, no
// import of any other service — the catalog is a code constant and stays one.
import { execFileSync } from "node:child_process"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { FAILURE_MODES, KINDS, SEVERITIES, catalogEntries } from "../services/premortem/catalog.mjs"

describe("the catalog's two vocabularies are frozen, and mean what they say", () => {
  // ASSERTED BY VALUE, not merely exported. An exported constant nobody checks is
  // a comment. The design spec (section 3) defines `kind` and `severity` as the two
  // axes a mode is filed under, and section 2 owner decision 4 is what forbids
  // collapsing them — so both lists are pinned here, in order, as the two sets they
  // are rather than as "some strings".
  it("publishes exactly the two vocabularies the design approved", () => {
    expect(SEVERITIES, "severity is a three-level scale, most severe first").toEqual([
      "high",
      "medium",
      "low"
    ])
    expect(KINDS, "kind separates money-at-risk from correctness-at-risk, and only those two").toEqual([
      "capital",
      "shipping"
    ])
    expect(Object.isFrozen(SEVERITIES), "a mutable severity vocabulary lets a caller widen the scale").toBe(true)
    expect(Object.isFrozen(KINDS), "a mutable kind vocabulary lets a caller blur the two axes").toBe(true)
  })

  // THE ANTI-VACUITY TEST, AND IT COMES FIRST ON PURPOSE. Every remaining test in
  // this file walks `FAILURE_MODES` with a `for` loop, and a `for` loop over an
  // EMPTY array passes — so a catalog that shipped empty would go green on every
  // disposition, vocabulary and immutability assertion below while verifying
  // nothing whatsoever. That is GUARD-1's exact shape one level up: a suite that
  // cannot fail. So the count is pinned against the design spec's own inventory
  // (section 6: six shipping-risk modes, five capital-risk), which makes an
  // emptied catalog and a silently dropped mode both loud failures here rather
  // than invisible ones further down.
  it("carries every mode the design names, and not one fewer", () => {
    const byKind = (kind) => FAILURE_MODES.filter((m) => m.kind === kind)

    expect(FAILURE_MODES.length, "the catalog is empty, so every loop below proves nothing").toBe(11)
    expect(
      byKind("shipping").length,
      "spec section 6 names six shipping-risk modes"
    ).toBe(6)
    expect(
      byKind("capital").length,
      "spec section 6 names five capital-risk modes"
    ).toBe(5)
  })

  // ...AND THE IDS ARE UNIQUE, because an id is how every downstream verdict will
  // address a mode. Two entries sharing an id would let a planner report one of
  // them twice and the other never, and the duplicate would be invisible in any
  // readout that only shows ids.
  it("has unique ids", () => {
    const ids = FAILURE_MODES.map((m) => m.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })
})

describe("every mode carries EXACTLY ONE disposition", () => {
  // THIS IS THE INVARIANT THE WHOLE FEATURE EXISTS TO ENFORCE, and it is a strict
  // XOR rather than the brief's weaker "at least one". Both halves matter and they
  // fail differently:
  //
  //   NEITHER — the silent one. A mode with no claim and no disposition is
  //   indistinguishable, to every downstream reader, from a mode that is covered.
  //   That is the defect owner decision 5 names: "there is no third option, so
  //   silence can never read as coverage."
  //
  //   BOTH — the comfortable one, and the one a later editor introduces by
  //   accident. An entry that carries a claim AND an `acceptedUnclaimed` record
  //   has two dispositions that can disagree, and whichever one the planner reads
  //   first wins silently. Two is not more honest than one here; it is less
  //   decidable.
  const hasClaim = (m) => typeof m.claim === "string" && m.claim.length > 0
  const hasDisposition = (m) => m.acceptedUnclaimed != null

  it("gives each mode a claim or an accepted-unclaimed record, never both and never neither", () => {
    for (const m of FAILURE_MODES) {
      expect(
        hasClaim(m) !== hasDisposition(m),
        `${m.id} carries ${hasClaim(m) && hasDisposition(m) ? "BOTH a claim and an acceptedUnclaimed" : hasClaim(m) ? "only a claim, which is not a disposition record" : "neither a claim nor an acceptedUnclaimed, so it reads as covered"} — exactly one is required`
      ).toBe(true)
    }
  })

  // ...AND A `claim` IS A PATH, NOT A BOOLEAN-ISH STRING. A blank or missing claim
  // has to read as "no claim" rather than as a claim on a file named `""`, so the
  // string is required to be non-empty and the absent case is required to be
  // exactly `null` — not `undefined`, and not `""`. A planner resolving `""`
  // against the repository would find nothing and, per the spec, report that as
  // `guard-missing`; making it `null` at the source keeps the distinction between
  // "deliberately unclaimed" and "claim field left blank by accident".
  it("makes an absent claim exactly null, never undefined and never an empty string", () => {
    for (const m of FAILURE_MODES) {
      expect(m.claim === null || hasClaim(m), `${m.id}: claim must be a non-empty string or exactly null`).toBe(
        true
      )
    }
  })
})

describe("kind and severity are read through the frozen vocabularies, never free text", () => {
  // A vocabulary the entries do not have to use is a comment. `kind` in particular
  // is load-bearing beyond sorting: `kind` is what tells the planner whether it is
  // looking at money at risk or correctness at risk, and owner decision 4 is the
  // rule that the two are never blurred. An entry filed under a fourth spelling
  // would fall out of both the capital checks and the shipping checks and be
  // reported by neither.
  it("files every mode under a published kind and a published severity", () => {
    for (const m of FAILURE_MODES) {
      expect(KINDS, `${m.id} is filed under kind "${m.kind}", which is not a published kind`).toContain(m.kind)
      expect(
        SEVERITIES,
        `${m.id} is filed at severity "${m.severity}", which is not on the published scale`
      ).toContain(m.severity)
    }
  })

  // ...AND `mutation` IS A BOOLEAN, not a truthy value. It is the flag the owner
  // sets to say "structural verification is not enough for this one" (design spec
  // section 2, decision 3), and the spec is explicit that membership is DECLARED
  // and never inferred at runtime. A string "yes" would read as true in any
  // `if (mode.mutation)` a later task writes, so the discipline has to start as a
  // type rather than as a convention someone remembers.
  it("types mutation as a boolean on every mode", () => {
    for (const m of FAILURE_MODES) {
      expect(typeof m.mutation, `${m.id}: mutation must be a boolean, not ${JSON.stringify(m.mutation)}`).toBe(
        "boolean"
      )
    }
  })

  // THE CONTROL. Without it, "every mode is on the scale" is indistinguishable
  // from "the scale contains everything". Each of these is a value a plausible
  // edit introduces, and each must be REJECTED by the same predicate that just
  // accepted every real entry above.
  it("CONTROL: the vocabularies reject the near-misses a plausible edit would introduce", () => {
    for (const rejected of ["deployment", "SHIPPING", "Shipping", "", "capital "]) {
      expect(KINDS, `"${rejected}" must not be a kind`).not.toContain(rejected)
    }
    for (const rejected of ["critical", "HIGH", "High", "", "med", 0, 3]) {
      expect(SEVERITIES, `${JSON.stringify(rejected)} must not be a severity`).not.toContain(rejected)
    }
    // ...and the same discrimination on the real data, one entry at a time, so a
    // future entry cannot pass by inheriting the correctness of its neighbours.
    for (const m of FAILURE_MODES) {
      expect(SEVERITIES.filter((s) => s === m.severity), `${m.id} has no published severity`).toHaveLength(1)
    }
  })
})

describe("an accepted-unclaimed disposition names WHO checks, WHEN, and WHAT", () => {
  // A disposition with no owner is a shrug: nobody has agreed to look, so the mode
  // is unowned rather than accepted, which is the silent case owner decision 5
  // rules out wearing a different hat. A disposition with no date never goes
  // stale visibly, because "we agreed to check this" and "we agreed to check this
  // in March" are indistinguishable until someone looks for the second one.
  it("gives every accepted-unclaimed record an owner and an ISO date", () => {
    for (const m of FAILURE_MODES) {
      if (m.acceptedUnclaimed == null) continue
      expect(
        m.acceptedUnclaimed.owner,
        `${m.id}: an accepted-unclaimed mode needs a named owner, not a shrug`
      ).toBeTruthy()
      expect(
        m.acceptedUnclaimed.date,
        `${m.id}: an accepted-unclaimed mode needs a date in YYYY-MM-DD form`
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  // ...AND IT NAMES THE SPECIFIC CHECK, which is the difference between a
  // disposition and a deferral. The design spec (section 3, "The honest limit")
  // is explicit that the planner's job on `unverified-manual` is to "name the
  // specific thing a human must check, and refuse to claim coverage it did not
  // verify." A disposition whose check reads "review this periodically" has named
  // nothing, and a mode carrying one reads as though someone knows what to do.
  //
  // The bar is deliberately mechanical — several words — rather than a judgement
  // about quality. Judging whether a check is specific enough is a reviewer's
  // call and would rot; counting words is a floor that a lazy entry fails and a
  // real instruction clears.
  it("names a specific manual check, not a deferral", () => {
    for (const m of FAILURE_MODES) {
      if (m.acceptedUnclaimed == null) continue
      expect(
        m.acceptedUnclaimed.check,
        `${m.id}: the disposition must name the check a human performs`
      ).toMatch(/\S/)
      expect(
        m.acceptedUnclaimed.check.trim().split(/\s+/).length,
        `${m.id}: a check of ${m.acceptedUnclaimed.check.trim().split(/\s+/).length} words names no action — say what to read, compare or confirm`
      ).toBeGreaterThan(10)
    }
  })

  // ...AND THE RECORD IS FROZEN. An `acceptedUnclaimed` object is the one part of
  // an entry a future editor might want to edit in place — a renamed owner, a
  // bumped date. If the nested object were mutable while the entry is frozen,
  // `Object.freeze` on the entry would not stop it: a frozen object holding a
  // mutable child is a half-frozen tree, and this is the one child that decides
  // whether a capital mode counts as dispositioned.
  it("freezes every accepted-unclaimed record", () => {
    const dispositioned = FAILURE_MODES.filter((m) => m.acceptedUnclaimed != null)
    expect(dispositioned.length, "no mode carries a disposition, so nothing is proven here").toBeGreaterThan(0)
    for (const m of dispositioned) {
      expect(Object.isFrozen(m.acceptedUnclaimed), `${m.id}: the disposition record must be frozen`).toBe(true)
    }
  })
})

// THE HONEST LIMIT, PINNED AS AN INVARIANT RATHER THAN LEFT TO REVIEW.
//
// `unverified-manual` is the verdict this feature exists to protect: a capital-risk
// mode whose guard is a human judgement, not a file. Design spec section 3 says it
// "must never be upgraded", and section 4 rule 6 says that no unverified upgrade
// happens "because a related test file passes", and that this is "asserted by test,
// not by review". This block is that assertion, at the layer where the claim is
// made — because if a capital entry could carry a `claim`, the upgrade would happen
// in the catalog, long before any planner existed to refuse it.
describe("a capital mode is never covered by a file, however related the file is", () => {
  it("gives every capital mode a null claim and a disposition instead", () => {
    const capital = FAILURE_MODES.filter((m) => m.kind === "capital")
    expect(capital.length, "no capital mode is catalogued, so this proves nothing").toBe(5)
    for (const m of capital) {
      expect(m.claim, `${m.id} is capital-risk and must not carry a guard claim`).toBeNull()
      expect(
        m.acceptedUnclaimed,
        `${m.id} is capital-risk: money at risk cannot be verified by a passing test, so it needs the manual check instead`
      ).not.toBeNull()
      expect(m.mutation, `${m.id} has no guard file, so there is nothing to mutate`).toBe(false)
    }
  })

  // ...AND THE MIRROR IS *NOT* "every shipping mode carries a claim", which is
  // exactly the rule this block used to assert and which the catalog legitimately
  // violates. SHIP-4 — five regressions mistaken for pre-existing failures — is
  // shipping-risk with NO guard file, because a mis-attribution is an act of
  // reading a diff rather than a property of the tree, and no assertion about the
  // tree can distinguish "broken before us" from "broken by us". Forcing that mode
  // to carry a claim would mean either filing it as `capital`, which it is not, or
  // inventing a guard that does not exist. Both would be worse than the rule.
  //
  // So the true invariant is the weaker and more useful one: shipping risk takes
  // BOTH shapes — a claimed guard, and an explicit manual check — so a reader
  // cannot conclude that a shipping mode is file-guarded by default, or that a
  // missing claim means the mode was forgotten. `capital` is where "always
  // unclaimed" is a RULE; on `shipping` it is one mode among several.
  it("gives shipping risk both shapes, so neither reads as the default", () => {
    const shipping = FAILURE_MODES.filter((m) => m.kind === "shipping")
    expect(shipping.length, "no shipping mode is catalogued, so this proves nothing").toBe(6)

    const claimed = shipping.filter((m) => m.claim != null)
    const dispositioned = shipping.filter((m) => m.acceptedUnclaimed != null)
    expect(claimed.length, "no shipping mode names a guard file").toBeGreaterThan(0)
    expect(dispositioned.length, "no shipping mode carries a manual check").toBeGreaterThan(0)
    expect(
      claimed.length + dispositioned.length,
      "the two shapes must account for every shipping mode — the XOR above already enforces this"
    ).toBe(shipping.length)
  })
})

// THE CLAIM MUST RESOLVE, OR THE CATALOG IS LYING.
//
// A `claim` is a repository-relative path to a TRACKED test file, and the design
// spec (section 3) is explicit that "it must resolve to a file git tracks;
// anything else is `guard-missing` or `stale-catalog-entry`, never assumed."
//
// This block is the catalog auditing ITSELF, which spec section 4 rule 3 puts ahead
// of evaluating anybody else's claim: "a pre-mortem that has silently drifted is
// worse than no pre-mortem." A `claim` pointing at a file that was renamed, moved
// or never existed is the single most self-refuting defect this feature could
// ship — it would have the planner report `guard-missing` on a mode the catalog
// says is covered, and it would do so while looking confident.
//
// TRACKED, NOT MERELY PRESENT. `existsSync` is not the test. An untracked file on
// someone's working tree is exactly the condition that made a guard run green
// while measuring nothing — the trap `ws7TestStoreIsolation` is built around — so
// "the file is on disk" is not evidence a claim resolves. `git ls-files` is.
describe("every claim resolves to a file the repository TRACKS", () => {
  // ONE `git ls-files`, NOT ONE PER CLAIM, and the reason is worth stating because
  // the per-claim version was written first and had to be taken back out.
  //
  // `git ls-files --error-unmatch <path>` is the crisper API — it exits non-zero on
  // a miss — but it costs a synchronous process spawn per claim, and this suite
  // runs inside a vitest worker alongside 437 other files. Five claims plus two
  // control probes is seven blocking spawns, and `sync=true` means each one stalls
  // its worker rather than yielding to the event loop. That is a lot of contention
  // to spend on a test of a constant, and it was observed to be enough to tip an
  // unrelated timing-sensitive frontend suite (`ministryRooms.test.tsx`, which
  // polls with `waitFor`) over its timeout in the full-suite run.
  //
  // Enumerating the index ONCE and testing membership proves exactly the same
  // property — the claim path is in git's index — for one spawn instead of seven.
  // The control below is what keeps that from being a weaker test, and it is
  // aimed at the vacuity mechanism directly rather than at git's exit code.
  const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

  /** The paths git actually tracks under the test tree, as a Set. */
  const trackedTestPaths = () =>
    new Set(
      execFileSync("git", ["ls-files", "apps/dashboard/server/__tests__"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
      })
        .split(/\r?\n/)
        .filter(Boolean)
    )

  it("resolves each claim against git's index, not the filesystem", () => {
    const claimed = FAILURE_MODES.filter((m) => m.claim != null)
    expect(claimed.length, "no mode names a guard, so this resolves nothing").toBeGreaterThan(0)

    const tracked = trackedTestPaths()
    expect(tracked.size, "git enumerated nothing, so every membership check below would pass").toBeGreaterThan(100)

    for (const m of claimed) {
      // A claim is repo-relative and names a test file. The shape is pinned because
      // a bare filename or an absolute path would resolve on the author's machine
      // and nowhere else — the same class of defect as an untracked file.
      expect(
        m.claim.startsWith("apps/dashboard/server/__tests__/"),
        `${m.id}: a claim must be repo-relative and name a test file, got "${m.claim}"`
      ).toBe(true)
      expect(
        tracked.has(m.claim),
        `${m.id} claims "${m.claim}", which git does not track — the catalog would report ` +
          "guard-missing on a mode it says is covered"
      ).toBe(true)
      // Tracked is necessary but not sufficient: a file can be in the index and
      // still be missing from a working tree, and a claim that cannot be run is
      // not a claim.
      expect(
        existsSync(join(REPO_ROOT, m.claim)),
        `${m.id} is tracked by git but absent from disk, so the claim cannot be run`
      ).toBe(true)
    }
  })

  // THE CONTROL, and it is aimed at the exact vacuity this catalog must not
  // reproduce. The failure mode is not "git errors on a bad path" — it is "a file
  // that is sitting right there, in the tracked directory, is invisible to the
  // check because git never indexed it". That is how `ws7TestStoreIsolation`
  // passed vacuously on an untracked test file, and it is the same shape as the
  // GUARD-1 omission. So the control plants a real file in the real directory and
  // asserts the enumeration does NOT see it: present on disk, absent from the
  // index. If the enumeration ever started returning untracked paths, this fails.
  it("CONTROL: a file that exists on disk but is untracked is NOT in git's index", () => {
    const UNTRACKED = "apps/dashboard/server/__tests__/preMortemCatalog.probe.tmp.mjs"
    const absolute = join(REPO_ROOT, UNTRACKED)

    writeFileSync(absolute, "// planted by the control; must never be indexed\n", "utf8")
    try {
      expect(existsSync(absolute), "the probe file must exist on disk, or this control proves nothing").toBe(true)
      const tracked = trackedTestPaths()
      expect(
        tracked.has(UNTRACKED),
        "an UNTRACKED file came back from git ls-files, so membership would prove nothing"
      ).toBe(false)
      expect(
        existsSync(join(REPO_ROOT, UNTRACKED)),
        "sanity: the probe is still on disk for the assertion above to mean anything"
      ).toBe(true)
    } finally {
      rmSync(absolute, { force: true })
    }

    // ...and the other direction: a path that was never created, such as a guard
    // renamed out from under the catalog, is absent too.
    expect(
      trackedTestPaths().has("apps/dashboard/server/__tests__/noSuchGuard.test.mjs"),
      "a non-existent path resolved as tracked"
    ).toBe(false)
  })
})

// A FROZEN ARRAY IS NOT A CONSTANT IF ITS CONTENTS ARE MUTABLE.
//
// `Object.freeze` on the array stops `push` and stops index assignment. It does
// nothing to the objects inside it, and this catalog's whole value is that those
// objects cannot be rewritten either: `claim` is the field the planner resolves
// against git, and `acceptedUnclaimed` is the field that decides whether a
// capital mode counts as dispositioned at all. An importer who could write
// `FAILURE_MODES[0].claim = "some/other/test.mjs"` would launder one mode's
// coverage claim for every downstream reader at once, while the id — the thing a
// verdict is addressed by — stayed exactly the same.
describe("the catalog is immutable all the way down", () => {
  it("freezes the array, every entry, and every disposition record", () => {
    expect(Object.isFrozen(FAILURE_MODES), "the exported array must be frozen").toBe(true)
    for (const m of FAILURE_MODES) {
      expect(Object.isFrozen(m), `${m.id}: an entry must be frozen, not just the array holding it`).toBe(true)
    }
  })

  // ...AND THE ACTUAL MUTATION IS REFUSED, not merely declared. A test that only
  // asks `Object.isFrozen` is testing the same boolean twice; the assignment below
  // is the operation a caller would actually attempt, and in a module running in
  // strict mode (every ES module is) a silent failure would be a lie rather than
  // a guard. So the write is attempted and the old value is read back.
  it("refuses a mutation of an entry, and leaves the value intact", () => {
    const first = FAILURE_MODES[0]
    const before = first.summary
    expect(() => {
      "use strict"
      first.summary = "rewritten"
      first.severity = "low"
    }, "writing to a frozen entry must throw in a module context").toThrow()
    expect(first.summary, "the entry must be unchanged after the refused write").toBe(before)
  })

  // `catalogEntries()` exists so a caller cannot push onto the shared array, and
  // the assertion that matters is IDENTITY plus IMMUTABILITY together: returning a
  // fresh copy each call would be safe but would defeat `===` comparisons and make
  // the export and the function disagree about what "the catalog" is. Returning the
  // shared frozen array is the design, and it is what makes `FAILURE_MODES` and
  // `catalogEntries()` impossible to hold inconsistent.
  it("hands back the very same frozen array, every time", () => {
    const entries = catalogEntries()
    // Captured BEFORE the refused push. Comparing `FAILURE_MODES.length` with
    // itself afterwards would be a tautology — and a tautology here is precisely
    // how "the push was refused" gets asserted by a test that would also pass if
    // the push had succeeded.
    const before = entries.length

    expect(entries, "catalogEntries() must return the shared array, not a copy").toBe(FAILURE_MODES)
    expect(Object.isFrozen(entries), "the returned array must be frozen").toBe(true)
    expect(catalogEntries()).toBe(catalogEntries())
    expect(() => {
      "use strict"
      entries.push({ id: "INJECTED" })
    }, "a caller must not be able to push onto the shared catalog").toThrow()
    expect(entries.length, "the catalog must be unchanged after the refused push").toBe(before)
    expect(
      entries.some((m) => m?.id === "INJECTED"),
      "an injected mode must not be present"
    ).toBe(false)
  })
})
