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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
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

// A `subsystem` THAT NAMES A DIRECTORY IS A CLAIM THE PLANNER CAN CHECK.
//
// The spec defines `stale-catalog-entry` as covering "a subsystem that no longer
// exists" (section 3). Against free text like `"test-guards"` or `"review-process"`
// that verdict is unimplementable: there is nothing to resolve, so the check either
// never fires or fires on a guess. Making `subsystem` a repo-relative directory
// that must exist on disk is what turns that spec sentence into code.
//
// The assertion is DIRECTORY-ness (`statSync(...).isDirectory()`), not mere
// existence, because the whole point is that a planner can look inside it — a
// subsystem that resolved to a file would satisfy a weaker test and still be
// useless.
describe("every subsystem names a directory that exists", () => {
  it("resolves each subsystem to a real repo-relative directory", () => {
    const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

    for (const m of FAILURE_MODES) {
      // The server TREE ROOT is a legitimate value — SHIP-4 is a process failure
      // whose blast radius is the whole server tree — so the prefix is inclusive of
      // the root itself rather than requiring a trailing separator. The next
      // assertion is what actually proves the value is real.
      expect(
        m.subsystem === "apps/dashboard/server" || m.subsystem.startsWith("apps/dashboard/server/"),
        `${m.id}: subsystem must be repo-relative and inside the server tree, got "${m.subsystem}"`
      ).toBe(true)

      const absolute = join(REPO_ROOT, m.subsystem)
      expect(existsSync(absolute), `${m.id}: subsystem "${m.subsystem}" does not exist on disk`).toBe(true)
      expect(
        statSync(absolute).isDirectory(),
        `${m.id}: subsystem "${m.subsystem}" exists but is not a directory, so nothing can be looked up inside it`
      ).toBe(true)
    }
  })

  // ...AND IT IS INSIDE THE REPOSITORY, which `existsSync` alone does not prove. A
  // path like `C:/Windows/System32` exists on every machine and means nothing to a
  // planner diffing against this repo, so the containment check is explicit rather
  // than inferred from the string starting with `apps/`.
  it("keeps every subsystem inside this repository", () => {
    const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
    const prefix = REPO_ROOT.endsWith(sep) ? REPO_ROOT : `${REPO_ROOT}${sep}`

    for (const m of FAILURE_MODES) {
      const absolute = resolve(join(REPO_ROOT, m.subsystem))
      expect(
        absolute.startsWith(prefix),
        `${m.id}: subsystem "${m.subsystem}" resolves to ${absolute}, which is outside the repository`
      ).toBe(true)
    }
  })
})

// THE EIGHTH VERDICT: `partially-covered`.
//
// A claim on its own means one thing — "this file guards this mode" — and the
// verdict table turns it into `verified`. That is true of SHIP-5 and SHIP-6 and
// FALSE of SHIP-1, whose own rationale says the drift class it documents is open
// and live today. A `claim` string cannot carry that, so the entry would be
// rendered as a green `verified` row while the thing it describes is unfixed. The
// prose is honest; the data shape was not able to transmit it.
//
// `gap` is the missing half of the shape: a string naming what the claim does NOT
// cover. An entry with BOTH a claim and a gap is partially covered — not verified,
// and not unclaimed. This block pins that distinction so it cannot be lost.
describe("a claim with a gap is PARTIALLY covered, not verified", () => {
  const isPartiallyCovered = (m) => m.claim != null && m.gap != null

  it("splits every claimed mode into fully covered or partially covered, by the gap", () => {
    const claimed = FAILURE_MODES.filter((m) => m.claim != null)
    expect(claimed.length, "no mode names a guard, so this splits nothing").toBeGreaterThan(0)

    const partial = claimed.filter(isPartiallyCovered)
    const full = claimed.filter((m) => !isPartiallyCovered(m))
    expect(
      partial.length,
      "no claimed mode names a gap, so partially-covered could never fire and this distinction is untested"
    ).toBeGreaterThan(0)
    expect(
      full.length,
      "no claimed mode is fully covered, so `gap` could be set on everything and nothing would notice"
    ).toBeGreaterThan(0)
    expect(partial.length + full.length, "every claimed mode lands in exactly one bucket").toBe(claimed.length)
  })

  // ...AND A GAP IS NOT DECORATIVE. A gap of `null` on a claimed entry is a claim
  // of completeness, so a gap that says nothing would silently promote a
  // partially-covered mode back to `verified` — which is the precise failure this
  // field exists to prevent.
  it("requires a gap to name something", () => {
    const partial = FAILURE_MODES.filter(isPartiallyCovered)
    expect(partial.length, "nothing is partially covered, so this proves nothing").toBeGreaterThan(0)
    for (const m of partial) {
      expect(typeof m.gap, `${m.id}: gap must be a string when it is present`).toBe("string")
      expect(m.gap.trim(), `${m.id}: gap is blank, which reads as "no gap"`).not.toBe("")
      expect(
        m.gap.trim().split(/\s+/).length,
        `${m.id}: a gap of ${m.gap.trim().split(/\s+/).length} words names no gap — say what is uncovered`
      ).toBeGreaterThan(10)
    }
  })

  // ...AND A MODE WITH NO CLAIM CANNOT BE "PARTIALLY" COVERED. Partial is a claim
  // about half a guard; without a guard there is nothing to be half of. This is
  // what keeps `gap` from becoming a second, quieter way to write `unclaimed` and
  // thereby smuggle the capital modes toward a coverage verdict.
  it("gives gap only to modes that also carry a claim", () => {
    for (const m of FAILURE_MODES) {
      if (m.gap == null) continue
      expect(
        m.claim,
        `${m.id} names a gap but no claim, so it is unclaimed rather than partially covered`
      ).not.toBeNull()
    }
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
/**
 * Does `source` DECLARE a test with exactly this name?
 *
 * This is the predicate the production suffix check below actually calls, hoisted
 * to module scope so the CONTROL at the end of this file can exercise the very same
 * function rather than a copy of it. A control that tests a copy proves the copy
 * works, not the thing that runs.
 *
 * Substring containment is not enough, and the difference is the whole point of
 * this tightening. A guard file is mostly prose, and it quotes its own `it` names
 * in the comments that explain what it guards. So `source.includes(name)` returns
 * true for a suffix pointing at a test that was RENAMED, as long as the old name
 * survives in a comment somewhere in the file. That is a dangling pointer that reads
 * as precise, and it is precisely the false confidence this catalog exists to catch.
 *
 * So the matcher requires a real DECLARATION: `it(`, `test(` or `describe(` followed
 * by the name in a quoted string. Comment prose cannot match it, because a comment
 * cannot contain a call.
 */
const declaresTest = (source, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b(?:it|test|describe)\\(\\s*["'\`](?:\\s*)${escaped}(?:\\s*)["'\`]`).test(source)
}

describe("every claim resolves to a file the repository TRACKS", () => {
  const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

  /**
   * ONE `git ls-files` FOR THE WHOLE FILE, memoised.
   *
   * It was one-per-call before, and the fix round caught that: the report claimed
   * "one enumeration" while the file made three (the definition plus three call
   * sites). Three is survivable; the reason to memoise rather than merely reduce is
   * that `execFileSync` BLOCKS its worker, this suite runs alongside 437 other
   * files, and an earlier seven-spawn version was observed to be enough contention
   * to tip the unrelated timing-sensitive `ministryRooms.test.tsx` over its
   * `waitFor` timeout. Enumerating the index once, lazily, and never again makes
   * the cost a constant one spawn rather than a multiple that grows with the
   * catalog.
   */
  let TRACKED = null
  const trackedTestPaths = () => {
    if (TRACKED === null) {
      TRACKED = new Set(
        execFileSync("git", ["ls-files", "apps/dashboard/server/__tests__"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024
        })
          .split(/\r?\n/)
          .filter(Boolean)
      )
    }
    return TRACKED
  }

  /**
   * Split a claim into its path and its optional `it` name.
   *
   * The spec (section 3) allows a claim to be "optionally suffixed with a
   * `describe`/`it` name". Two catalog entries — SHIP-1 and SHIP-2 — are DIFFERENT
   * failure modes that happen to point at ONE guard file, and without the suffix
   * a downstream planner cannot tell them apart by anything but prose. So the
   * suffix is load-bearing rather than decorative, and it has to be parseable by
   * the same code that resolves the path.
   *
   * `" :: "` is the separator because it cannot occur in a repository-relative
   * path and does not occur in any `it` name in this suite, so the split is
   * unambiguous in both halves.
   */
  const CLAIM_SEPARATOR = " :: "
  const splitClaim = (claim) => {
    const at = claim.indexOf(CLAIM_SEPARATOR)
    return at === -1
      ? { path: claim, name: null }
      : { path: claim.slice(0, at), name: claim.slice(at + CLAIM_SEPARATOR.length) }
  }

  /**
   * (The `declaresTest` predicate lives at module scope, above this describe, so
   * the CONTROL below exercises the same function the production loop calls.)
   */
  it("resolves each claim against git's index, not the filesystem", () => {
    const claimed = FAILURE_MODES.filter((m) => m.claim != null)
    expect(claimed.length, "no mode names a guard, so this resolves nothing").toBeGreaterThan(0)

    const tracked = trackedTestPaths()
    expect(tracked.size, "git enumerated nothing, so every membership check below would pass").toBeGreaterThan(100)

    for (const m of claimed) {
      const { path: claimPath, name } = splitClaim(m.claim)

      // A claim is repo-relative and names a test file. The shape is pinned because
      // a bare filename or an absolute path would resolve on the author's machine
      // and nowhere else — the same class of defect as an untracked file.
      expect(
        claimPath.startsWith("apps/dashboard/server/__tests__/"),
        `${m.id}: a claim must be repo-relative and name a test file, got "${claimPath}"`
      ).toBe(true)
      expect(
        tracked.has(claimPath),
        `${m.id} claims "${claimPath}", which git does not track — the catalog would report ` +
          "guard-missing on a mode it says is covered"
      ).toBe(true)
      // Tracked is necessary but not sufficient: a file can be in the index and
      // still be missing from a working tree, and a claim that cannot be run is
      // not a claim.
      expect(
        existsSync(join(REPO_ROOT, claimPath)),
        `${m.id} is tracked by git but absent from disk, so the claim cannot be run`
      ).toBe(true)

      // ...AND THE SUFFIX, WHEN PRESENT, MUST NAME SOMETHING THAT EXISTS. A claim
      // suffix is a pointer at one assertion inside a large file; a suffix that
      // points at a renamed `it` is a dangling pointer that resolves to nothing
      // while still looking precise. The assertion is that the name appears in the
      // claimed file, which also catches a suffix accidentally borrowed from a
      // different file.
      if (name === null) continue
      const source = readFileSync(join(REPO_ROOT, claimPath), "utf8")
      expect(
        declaresTest(source, name),
        `${m.id} claims the test "${name}", which is not DECLARED by it() or describe() in ${claimPath} — ` +
          "the suffix is a dangling pointer (a name quoted in a comment does not count)"
      ).toBe(true)
    }
  })

  // THE CONTROL for the matcher above, and it is the reason the matcher exists.
  // `includes` is fooled by prose; `declaresTest` is not. Both halves are asserted
  // on the REAL shared-lexer file, so the demonstration is about this repository's
  // actual guards rather than a synthetic string that might be more forgiving.
  it("CONTROL: a name quoted in a comment does NOT satisfy the suffix check", () => {
    const SOURCE = readFileSync(
      join(REPO_ROOT, "apps/dashboard/server/__tests__/sharedCommentLexer.test.mjs"),
      "utf8"
    )

    // A name that really IS declared. This must be accepted, or the matcher is
    // simply broken and the rejection below proves nothing.
    const REAL = "each consumer resolves `stripComments` from the SAME absolute module"
    expect(declaresTest(SOURCE, REAL), "a genuinely declared test must satisfy the matcher").toBe(true)

    // The same name with one word changed, so it appears NOWHERE — and then a
    // variant that DOES appear in a comment, to show why `includes` was unsafe.
    const RENAMED = "each consumer resolves stripComments from the SAME absolute module"
    expect(SOURCE.includes(RENAMED), "sanity: this control needs a name absent from the file").toBe(false)
    expect(declaresTest(SOURCE, RENAMED), "a name no file declares must NOT satisfy the matcher").toBe(false)

    // THE DEMONSTRATION: a phrase from the file's own prose that is NOT a test
    // declaration. If `includes` accepted this, the looser check would have been
    // satisfiable by a comment.
    const PROSE = "the four local lexers are gone"
    expect(
      SOURCE.includes(PROSE),
      "sanity: this control needs a phrase that really is in the file"
    ).toBe(true)
    expect(
      declaresTest(SOURCE, PROSE),
      "the production suffix check accepted a phrase that exists only in prose"
    ).toBe(false)
  })

  // AT LEAST ONE CLAIM MUST CARRY A SUFFIX, or the parsing above is untested
  // scaffolding: a catalog where every claim is a bare path would pass it, and the
  // `describe`/`it` capability the spec grants would go unused and unexercised.
  it("uses the `it` suffix wherever two modes share one guard file", () => {
    const suffixed = FAILURE_MODES.filter((m) => m.claim != null && splitClaim(m.claim).name !== null)
    expect(
      suffixed.length,
      "no claim carries an `it` suffix, so the parsing path is never exercised"
    ).toBeGreaterThan(0)

    // IF TWO MODES NAME THE SAME FILE, BOTH MUST NAME A TEST INSIDE IT — and the two
    // names must differ. This is stricter than "no two claim strings are
    // identical": a bare path and a suffixed path are different strings while
    // still being indistinguishable to anyone reading the catalog. A planner asked
    // "which assertion covers SHIP-5?" has to be able to answer without opening
    // every guard and guessing.
    const claimed = FAILURE_MODES.filter((m) => m.claim != null)
    const byFile = new Map()
    for (const m of claimed) {
      const { path: p, name } = splitClaim(m.claim)
      if (!byFile.has(p)) byFile.set(p, [])
      byFile.get(p).push({ id: m.id, name })
    }

    const shared = [...byFile.entries()].filter(([, modes]) => modes.length > 1)
    expect(
      shared.length,
      "no two modes share a guard file, so the suffix distinction is untested on this catalog"
    ).toBeGreaterThan(0)

    for (const [file, modes] of shared) {
      for (const m of modes) {
        expect(
          m.name,
          `${m.id} shares ${file} with ${modes.map((x) => x.id).join(", ")} but names no ` +
            "`it`, so the two modes are indistinguishable downstream"
        ).not.toBeNull()
      }
      const names = modes.map((m) => m.name)
      expect(new Set(names).size, `${file}: two modes name the same test`).toBe(names.length)
    }
  })

  // THE CONTROL, aimed at the vacuity this catalog must not reproduce: "the file
  // is on disk" is not evidence, because an untracked file is invisible to every
  // guard that enumerates by `git ls-files`. That is how `ws7TestStoreIsolation`
  // passed vacuously on an untracked test file.
  //
  // THE FIXTURE LIVES OUTSIDE THE REPOSITORY, in the OS temp dir. The earlier
  // version planted a real `.mjs` inside `server/__tests__/`, cleaned up in a
  // `finally` — which is correct but not sufficient: a hard crash, an editor
  // race, or a `git add -A` between the write and the cleanup leaves an untracked
  // file sitting in the one directory this repository's guards scan hardest. A
  // control must not be able to damage the thing it is measuring.
  //
  // The control keeps its teeth because the planted file is genuinely untracked and
  // genuinely on disk, and because it is paired with a positive case: git agrees a
  // REAL claim is tracked. A set that returned everything would fail the second.
  it("CONTROL: on disk is not the same as tracked", () => {
    const OUTSIDE = mkdtempSync(join(tmpdir(), "picc-catalog-control-"))
    const planted = join(OUTSIDE, "untracked.test.mjs")
    writeFileSync(planted, "// planted by the control; never indexed\n", "utf8")
    try {
      expect(existsSync(planted), "the control fixture must exist on disk, or this proves nothing").toBe(true)
      expect(
        trackedTestPaths().has(planted),
        "a file that exists but was never committed came back as tracked, so membership would prove nothing"
      ).toBe(false)

      // ...and a path that was never created at all, such as a guard renamed out
      // from under the catalog.
      expect(
        trackedTestPaths().has("apps/dashboard/server/__tests__/noSuchGuard.test.mjs"),
        "a non-existent path resolved as tracked"
      ).toBe(false)

      // ...and the positive case, so "absent" above cannot be satisfied by a set
      // that is simply empty. This is the half that ties the Set to git's index
      // rather than to a directory walk.
      const realClaim = FAILURE_MODES.find((m) => m.claim != null)
      expect(trackedTestPaths().has(splitClaim(realClaim.claim).path)).toBe(true)
    } finally {
      rmSync(OUTSIDE, { recursive: true, force: true })
    }
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
  // THE MUTATION REFUSAL IS NOT THE SAME CLAIM AS "NOTHING ELSE IS ON THE ENTRY".
  // Every other test in this file reads named fields, so all of them would stay
  // green if somebody ADDED a field. That is not hypothetical: this catalog
  // originally carried nine keys, and the fix round that added `gap` for the
  // partially-covered verdict made ten. A field that appears without anyone
  // deciding it appears is exactly how a later task ends up stamping a verdict
  // onto an entry — `verdict: "verified"` on a mode whose drift is still live —
  // with every assertion here still passing.
  //
  // So the SHAPE is pinned, not just the contents. Nine keys, then ten, then
  // never a surprise: growing the entry shape is a deliberate act that has to
  // break this test.
  it("gives every entry exactly the documented keys, and no others", () => {
    const EXPECTED = [
      "acceptedUnclaimed",
      "claim",
      "gap",
      "id",
      "kind",
      "mutation",
      "rationale",
      "severity",
      "subsystem",
      "summary"
    ]

    for (const m of FAILURE_MODES) {
      expect(
        Object.keys(m).sort(),
        `${m.id} does not have exactly the documented shape — add or remove a key here, deliberately`
      ).toEqual(EXPECTED)
    }
  })

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
