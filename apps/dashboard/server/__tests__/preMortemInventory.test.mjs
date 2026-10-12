// Pre-mortem planner — the derived guard inventory (W3-05, Task 2).
//
// HERMETIC BY INJECTION, AND THE INJECTION IS THE POINT RATHER THAN A TESTING
// CONVENIENCE. `guardInventory` learns what exists ONLY from the `listTrackedFiles`
// it is handed and reads content ONLY through the `readFile` it is handed, so
// every fixture below is a list of path STRINGS and a reader that answers from
// them. Nothing here touches the real repository tree and nothing here writes
// anything at all — which is why no fixture needs a temp dir: the module under
// test has no filesystem of its own that could be redirected.
//
// A DEVIATION FROM THE DESIGN SPEC, RECORDED RATHER THAN DROPPED. Spec section 5
// asks for "real temp-dir fixtures with tracked and untracked files". Injected
// fixtures are strictly stronger for the property being proved — the tracked list
// is a first-class input here, so "git cannot see this file" is expressible as
// `[]` with no git in the process at all — and they are what the binding
// controller ruling requires. The temp dir would have added a filesystem without
// adding a fact.
import { describe, expect, it } from "vitest"

import {
  CLAIM_SEPARATOR,
  guardInventory,
  isGuardPath,
  splitClaim
} from "../services/premortem/inventory.mjs"

/** A `listTrackedFiles` that reports exactly `list` and nothing else. */
const files = (list) => async () => list

/** A reader that records every path it is asked for, and answers `body`. */
const spyReader = (body, attempted = []) => async (path) => {
  attempted.push(path)
  return body
}

const TESTS = "apps/dashboard/server/__tests__"

describe("guardInventory", () => {
  it("derives guards from tracked files and reads each one", async () => {
    const out = await guardInventory({
      listTrackedFiles: files([
        "apps/dashboard/server/__tests__/ws7RouteAuthCoverageGuard.test.mjs",
        "apps/dashboard/server/__tests__/graduationApi.test.mjs"
      ]),
      readFile: async () => 'describe("a guard", () => { it("x", () => { expect(1).toBe(1) }) })'
    })
    expect(out.guards).toHaveLength(2)
    expect(out.guards[0].asserts).toBeGreaterThan(0)
  })

  it("never consults a hardcoded consumer list", async () => {
    const out = await guardInventory({
      listTrackedFiles: files([]),
      readFile: async () => ""
    })
    expect(out.guards).toEqual([])
  })

  it("a file git does not track is never reported as a guard", async () => {
    const out = await guardInventory({
      listTrackedFiles: files([]),
      readFile: async () => 'describe("g", () => { expect(1).toBe(1) })'
    })
    expect(out.guards).toHaveLength(0)
  })

  it("a file it cannot read is recorded, not guessed", async () => {
    const out = await guardInventory({
      listTrackedFiles: files(["apps/dashboard/server/__tests__/x.test.mjs"]),
      readFile: async () => {
        throw new Error("EACCES")
      }
    })
    expect(out.unreadable).toEqual(["apps/dashboard/server/__tests__/x.test.mjs"])
    expect(out.guards).toHaveLength(0)
  })

  it("never asks the reader for a path the tracked list did not yield", async () => {
    // THE STRONG FORM OF RULING 2, and the one the brief's third test cannot reach
    // on its own. A reader that answers guard-shaped content for ANY path will
    // make an untracked file look like a guard the moment this module goes looking
    // on its own — so this hands it exactly that reader, then checks not only the
    // result but WHICH PATHS IT WAS ASKED FOR. `attempted` is the evidence: a
    // non-empty array would mean this module performed file access the repository
    // never authorised, whatever the returned inventory happened to say.
    //
    // This is the vacuity `ws7TestStoreIsolation` actually shipped: a guard that
    // passed GREEN on a file git could not see, because enumerating tracked files
    // is only half the job — the other half is never reading anything else.
    const attempted = []
    const out = await guardInventory({
      listTrackedFiles: files([]),
      readFile: spyReader('describe("g", () => { expect(1).toBe(1) })', attempted)
    })
    expect(attempted).toEqual([])
    expect(out.guards).toEqual([])
    expect(out.unreadable).toEqual([])
  })

  it("asks for exactly the guard-shaped tracked paths, and nothing else", async () => {
    // The complement, so neither half can pass for the wrong reason: over a mixed
    // list the reader sees only the guard-shaped entries, and in sorted order,
    // which is also what makes two runs over one tree render identically.
    const attempted = []
    const out = await guardInventory({
      listTrackedFiles: files([
        "apps/dashboard/server/__tests__/b.test.mjs",
        "README.md",
        "apps/dashboard/server/services/graduation/gates.mjs",
        "apps/dashboard/server/__tests__/a.test.mjs",
        "apps/dashboard/server/__tests__/fixtures/payload.mjs"
      ]),
      readFile: spyReader("expect(1).toBe(1)", attempted)
    })
    expect(attempted).toEqual([`${TESTS}/a.test.mjs`, `${TESTS}/b.test.mjs`])
    expect(out.guards.map((g) => g.file)).toEqual(attempted)
  })

  it("reports a repeated path once, and reads it once", async () => {
    // `git ls-files` never repeats a path, so this is about a mis-wired caller
    // rather than about git — but a guard counted twice would double-count its
    // assertions, and an assertion count is a number a verdict reads.
    const attempted = []
    const out = await guardInventory({
      listTrackedFiles: files([`${TESTS}/dup.test.mjs`, `${TESTS}/dup.test.mjs`]),
      readFile: spyReader("expect(1).toBe(1)", attempted)
    })
    expect(attempted).toEqual([`${TESTS}/dup.test.mjs`])
    expect(out.guards).toHaveLength(1)
  })

  it("refuses a guard-shaped path that escapes the repository, and never reads it", async () => {
    // RULING 5. A path that climbs out of the repo root is `unreadable`, not a
    // guard — and the `attempted` check is the part that matters, because the
    // failure this prevents is not a wrong verdict but a wrong READ: a caller that
    // resolved paths against the wrong root would have this module open a file
    // outside the repository and report whatever assertions it found as coverage
    // of something else entirely.
    const attempted = []
    const out = await guardInventory({
      listTrackedFiles: files([
        `${TESTS}/../../outside.test.mjs`,
        "C:/elsewhere/__tests__/x.test.mjs"
      ]),
      readFile: spyReader('describe("g", () => { expect(1).toBe(1) })', attempted)
    })
    expect(attempted).toEqual([])
    expect(out.guards).toEqual([])
    expect(out.unreadable).toEqual([
      "C:/elsewhere/__tests__/x.test.mjs",
      `${TESTS}/../../outside.test.mjs`
    ])
  })

  it("reports a guard that asserts nothing, rather than dropping it", async () => {
    // RULING 6. A guard-shaped file with no `expect(` is real information — it is a
    // guard that asserts nothing — and reporting it as absent would fabricate a
    // gap in the opposite direction from the one this module exists to prevent.
    // The distinguishing assertion is `asserts: 0` on a PRESENT entry; a module
    // that filtered zero-assertion files out would fail the length check instead.
    const out = await guardInventory({
      listTrackedFiles: files([`${TESTS}/silent.test.mjs`]),
      readFile: async () => 'describe("nothing here", () => { it("passes", () => {}) })'
    })
    expect(out.guards).toHaveLength(1)
    expect(out.guards[0].asserts).toBe(0)
    expect(out.guards[0].describes).toEqual(["nothing here", "passes"])
    expect(out.guards[0].unresolvedTitles).toBe(0)
    expect(out.unreadable).toEqual([])
  })

  it("never turns a missing reader into a guard asserting nothing", async () => {
    // FIX ROUND 1 C-1. `String(text ?? "")` was converting NO CONTENT into EMPTY
    // CONTENT, so omitting `readFile` produced a full inventory of guards with
    // `asserts: 0` — a fourth invented state, against a module header promising
    // three honest ones. The shape of the bug is an asymmetry: a missing
    // `listTrackedFiles` correctly yields an EMPTY inventory because there is no
    // evidence anything exists, while a missing `readFile` yielded a FULL one
    // because missing evidence about CONTENT was being read as evidence that the
    // content is empty. The scenario that bites is a map-backed reader whose lookup
    // misses: no throw, so the rejection path never fires, and that one file
    // verifies GREEN on a file nobody read.
    const out = await guardInventory({
      listTrackedFiles: files([`${TESTS}/a.test.mjs`, `${TESTS}/b.test.mjs`])
    })
    expect(out.guards).toEqual([])
    expect(out.unreadable).toEqual([`${TESTS}/a.test.mjs`, `${TESTS}/b.test.mjs`])
  })

  it("treats a reader that resolves to something other than text as unreadable", async () => {
    // The same defect by the other road. A map-backed reader returning `undefined`
    // for a missing key resolves without throwing, so a `catch`-only guard sees a
    // success. One bad path among good ones is the worst case: it verifies
    // normally-looking GREEN while sitting in a file nobody opened.
    const out = await guardInventory({
      listTrackedFiles: files([`${TESTS}/a.test.mjs`, `${TESTS}/b.test.mjs`]),
      readFile: async (path) => (path.endsWith("a.test.mjs") ? 'describe("d", () => {})' : undefined)
    })
    expect(out.unreadable).toEqual([`${TESTS}/b.test.mjs`])
    expect(out.guards.map((g) => g.file)).toEqual([`${TESTS}/a.test.mjs`])
  })

  it("refuses a backslash traversal, and never reads it", async () => {
    // FIX ROUND 1 C-3. The containment check split on `/` only, so on the platform
    // where the backslash is the native separator this path walked out of the
    // repository root, passed the check, and was READ. `git ls-files` cannot
    // produce it; a caller resolving paths with `path.join` on Windows can.
    const escape = `${TESTS}/sub\\..\\..\\..\\outside.test.mjs`
    const attempted = []
    const out = await guardInventory({
      listTrackedFiles: files([escape]),
      readFile: spyReader('describe("g", () => { expect(1).toBe(1) })', attempted)
    })
    expect(attempted).toEqual([])
    expect(out.guards).toEqual([])
    expect(out.unreadable).toEqual([escape])
  })

  it("records a backslash-separated guard path as unreadable, never as silence", async () => {
    // FIX ROUND 1 C-3, second half. Such a path used to land in NEITHER array: it
    // failed the `/`-split guard-shape test, so it was dropped, and a dropped path
    // in a module whose whole purpose is to avoid silence is the worst available
    // outcome — a reader cannot distinguish "not a guard" from "nobody looked".
    const winStyle = "apps\\dashboard\\server\\__tests__\\x.test.mjs"
    const attempted = []
    const out = await guardInventory({
      listTrackedFiles: files([winStyle]),
      readFile: spyReader('describe("g", () => { expect(1).toBe(1) })', attempted)
    })
    expect(attempted).toEqual([])
    expect(out.guards).toEqual([])
    expect(out.unreadable).toEqual([winStyle])
  })

  it("counts titles it could not resolve instead of dropping them silently", async () => {
    // FIX ROUND 1 C-4. `unresolvedTitles` is the channel that keeps "covered by
    // nothing" distinguishable from "nobody looked". Before it existed, a claim on
    // one of these titles returned `guard-missing` and a reader had no way to tell
    // a genuinely uncovered title from a title this extractor never looked at —
    // the exact absence-as-coverage conflation this feature exists to prevent.
    const source = [
      'const SHAPES = ["a", "b"]',
      'describe.each(["x"])("suite %s", () => {})',
      'it.each(SHAPES)("refuses %s", (s) => { expect(1).toBe(1) })',
      'it("plain", () => { expect(1).toBe(1) })'
    ].join("\n")
    const out = await guardInventory({
      listTrackedFiles: files([`${TESTS}/each.test.mjs`]),
      readFile: async () => source
    })
    expect(out.guards[0].describes).toEqual(["plain"])
    expect(out.guards[0].unresolvedTitles).toBe(2)
    expect(out.guards[0].asserts).toBe(2)
  })

  it("propagates a rejecting tracked-file listing rather than inventing an empty inventory", async () => {
    // FIX ROUND 1 M-1. There is no partial evidence here to salvage: a listing that
    // failed is not a listing that found nothing, and reporting the second would be
    // a clean empty readout for a git error — the failure mode this whole feature
    // was built against.
    await expect(
      guardInventory({
        listTrackedFiles: async () => {
          throw new Error("git ls-files failed")
        },
        readFile: async () => ""
      })
    ).rejects.toThrow("git ls-files failed")
  })

  it("counts assertions and declared titles from CODE, not from the comments describing them", async () => {
    // The comments below quote the very call shapes being measured, which is what
    // a guard's own header routinely does. Counting those would let a file appear
    // to assert something it only narrates, and would let a REMOVED test survive
    // in a comment — which is precisely how a green suite stops meaning anything.
    const source = [
      '// it("a test that was deleted", () => { expect(1).toBe(1) })',
      '/* describe("also deleted", () => {}) */',
      'describe("real suite", () => {',
      '  it("real case", () => {',
      "    expect(1).toBe(1)",
      "    expect(2).toEqual(2)",
      "  })",
      "})"
    ].join("\n")
    const out = await guardInventory({
      listTrackedFiles: files([`${TESTS}/commented.test.mjs`]),
      readFile: async () => source
    })
    expect(out.guards[0].describes).toEqual(["real suite", "real case"])
    expect(out.guards[0].asserts).toBe(2)
  })

  it("does not mistake a `//` inside a string for the start of a comment", async () => {
    // The string-awareness is inherited from the one shared lexer rather than
    // re-derived here, and this is the case that made four copies of that lexer
    // necessary. It is ONE LINE on purpose: a `//`-only stripper blanks from the
    // slashes to end of line, so on separate lines it would lose nothing and this
    // fixture would pass for the wrong reason. On one line it takes the whole
    // guard with it — which is exactly how a guard once passed while measuring
    // zero call sites.
    const source = 'const home = "https://example.invalid"; describe("d", () => { it("c", () => { expect(1).toBe(1) }) })'
    const out = await guardInventory({
      listTrackedFiles: files([`${TESTS}/stringAware.test.mjs`]),
      readFile: async () => source
    })
    expect(out.guards[0].describes).toEqual(["d", "c"])
    expect(out.guards[0].asserts).toBe(1)
  })

  it("survives a `//`-only stripper on the fixture that broke four of them", async () => {
    // The control for the test above, in the form this repo has used before: the
    // OLD rule run against the SAME fixture, asserted to lose the assertion. A
    // fixture that only proves the happy path is how the original bug survived, so
    // the counter-rule is shown rather than described.
    const source = 'const home = "https://example.invalid"; describe("d", () => { it("c", () => { expect(1).toBe(1) }) })'
    const naivelyStripped = source.replace(/\/\/.*$/gm, " ")
    expect(source).toContain('"https://example.invalid"')
    expect(naivelyStripped).not.toContain("expect(")
    expect(naivelyStripped).not.toContain("describe(")
  })
})

describe("isGuardPath", () => {
  it("is a SHAPE test, matching the rule vitest itself collects by", () => {
    expect(isGuardPath(`${TESTS}/g.test.mjs`)).toBe(true)
    // NO `__tests__` SEGMENT IS REQUIRED, and this is the M-2 change rather than an
    // oversight. vitest's default include is the `{test,spec}.?(c|m)[jt]s?(x)` glob at
    // every depth (`node_modules/vitest/dist/defaults.D2ip7f-X.js:5` spells it with
    // a leading two-star path prefix), which collects any
    // `*.test.mjs` under the root. Requiring the segment here would make this
    // module STRICTER than the runner, and the cost of being stricter runs the
    // expensive way: a guard vitest collects would be reported missing. Both rules
    // select the same paths today, so nothing is lost and one unexercised
    // exclusion is gone — the same principle that forbade a `fixtures` exclusion
    // now applied to this one.
    expect(isGuardPath("apps/dashboard/server/g.test.mjs")).toBe(true)
    expect(isGuardPath(`${TESTS}/fixtures/g.test.mjs`)).toBe(true)
    expect(isGuardPath("scripts/g.test.mjs")).toBe(true)
    // Not guard-shaped: wrong extension, no test extension, and the two degenerate
    // inputs, which are not paths at all.
    expect(isGuardPath(`${TESTS}/g.test.ts`)).toBe(false)
    expect(isGuardPath("apps/dashboard/server/__tests__/g.mjs")).toBe(false)
    expect(isGuardPath("")).toBe(false)
    expect(isGuardPath(null)).toBe(false)
  })
})

describe("splitClaim", () => {
  it("splits at the FIRST separator and keeps the suffix out of the path", () => {
    expect(splitClaim(`${TESTS}/sharedCommentLexer.test.mjs${CLAIM_SEPARATOR}the lexer is one`)).toEqual({
      file: `${TESTS}/sharedCommentLexer.test.mjs`,
      title: "the lexer is one"
    })
  })

  it("keeps a suffix that itself contains the separator whole", () => {
    // Splitting on the LAST occurrence would yield the path
    // `a.test.mjs :: one`, which resolves to nothing, and would report a guard as
    // missing for a claim that is perfectly well formed.
    expect(splitClaim(`a.test.mjs${CLAIM_SEPARATOR}one${CLAIM_SEPARATOR}two`)).toEqual({
      file: "a.test.mjs",
      title: `one${CLAIM_SEPARATOR}two`
    })
  })

  it("leaves a path containing spaces intact, which a split-on-space could not", () => {
    expect(splitClaim("apps/a b/guard one.test.mjs :: a title with spaces")).toEqual({
      file: "apps/a b/guard one.test.mjs",
      title: "a title with spaces"
    })
  })

  it("treats a bare path as a whole-file claim with no title", () => {
    expect(splitClaim("apps/dashboard/server/__tests__/graduationWindows.test.mjs")).toEqual({
      file: "apps/dashboard/server/__tests__/graduationWindows.test.mjs",
      title: null
    })
  })

  it("yields no path for a missing or non-string claim, rather than resolving null", () => {
    // The failure this rules out is a caller passing `entry.claim` straight into
    // a lookup on an entry that has none, and finding a guard at the path `null`.
    expect(splitClaim(null)).toEqual({ file: null, title: null })
    expect(splitClaim("")).toEqual({ file: null, title: null })
    expect(splitClaim(undefined)).toEqual({ file: null, title: null })
  })

  it("does not split on a bare `" + "::` with no space after it", () => {
    // The trailing space is part of the contract, so this is a whole (and
    // non-guard-shaped) claim rather than a path with an empty title.
    expect(splitClaim("apps/dashboard/server/__tests__/g.test.mjs ::")).toEqual({
      file: "apps/dashboard/server/__tests__/g.test.mjs ::",
      title: null
    })
  })
})