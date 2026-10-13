import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { stripComments } from "../scripts/guard-primitives.mjs"
import { FAILURE_MODES } from "../services/premortem/catalog.mjs"
import { MUTATION_VERDICTS, mutationCheck } from "../services/premortem/mutate.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const MUTATE_SOURCE = readFileSync(
  join(REPO_ROOT, "apps/dashboard/server/services/premortem/mutate.mjs"),
  "utf8"
)
// Comments are blanked before EVERY scan of the module's source, because this
// file names every one of the things it is forbidden to use in its own prose -
// `process.env`, the clock, vitest itself - and a raw-text scan would fail on
// the guard that documents the guard. The shared lexer is used rather than a
// second one for exactly the reason catalog entry SHIP-1 exists.
const MUTATE_CODE = stripComments(MUTATE_SOURCE)

const entry = { id: "e1", claim: "server/__tests__/g.test.mjs", mutation: true }

describe("mutationCheck", () => {
  it("a guard that fails on a broken implementation bites", async () => {
    const r = await mutationCheck({ entry, runGuard: async () => ({ failed: true }) })
    expect(r.verdict).toBe("bites")
  })

  it("a guard that passes on a broken implementation does not bite", async () => {
    const r = await mutationCheck({ entry, runGuard: async () => ({ failed: false }) })
    expect(r.verdict).toBe("does-not-bite")
  })

  it("an entry not marked for mutation is not-run, never inferred", async () => {
    const r = await mutationCheck({ entry: { ...entry, mutation: false }, runGuard: async () => ({ failed: true }) })
    expect(r.verdict).toBe("not-run")
  })

  it("structural verification is never reported as biting", async () => {
    const r = await mutationCheck({ entry: { ...entry, mutation: false }, runGuard: async () => ({ failed: false }) })
    expect(r.verdict).not.toBe("bites")
  })

  // THE TRAP THE PLAN DOES NOT COVER, pinned from the CONSUMER SIDE.
  //
  // A `mutation: true` fixture, deliberately. A `mutation: false` fixture returns
  // at the flag gate before ever reaching the splitter, so it would report a
  // green test for a line it never executed - the short-circuit fixture problem
  // Task 3 found twice.
  //
  // The claim below carries a SPACE in its path and the separator inside its
  // title, so one assertion pins both halves of the splitter's contract: the
  // path is never truncated at a space, and a title containing the separator
  // survives whole.
  it("hands the runner the guard file, with the title never folded into the path", async () => {
    const seen = []
    const claim = "server/__tests__/a dir/g.test.mjs :: one :: two"
    const r = await mutationCheck({
      entry: { ...entry, claim },
      runGuard: async (file) => {
        seen.push(file)
        return { failed: true }
      }
    })
    expect(seen).toEqual(["server/__tests__/a dir/g.test.mjs"])
    expect(r.evidence.claimPath).toBe("server/__tests__/a dir/g.test.mjs")
    expect(r.evidence.claimTitle).toBe("one :: two")
  })

  // TRAP 1: a runner that crashes. Two failures are possible and both are bad -
  // reading a crash as `bites` upgrades a guard on the strength of a stack
  // trace, and letting the error escape takes the whole overview down instead of
  // reporting one entry honestly.
  it("a runner that throws is not-run, and the error does not escape", async () => {
    const r = await mutationCheck({
      entry,
      runGuard: async () => {
        throw new Error("the guard runner blew up")
      }
    })
    expect(r.verdict).toBe("not-run")
    expect(r.verdict).not.toBe("bites")
    // ALSO not `does-not-bite`: a crash is not a measurement, and the verdicts
    // are not interchangeable here the way they are for a genuine pass.
    expect(r.verdict).not.toBe("does-not-bite")
    expect(r.evidence.reason).toBe("guard-run-threw")
  })

  // TRAPS 2 AND 5, together: a malformed runner result, and a non-boolean
  // truthy `failed`.
  //
  // ORDER IS LOAD-BEARING AND IT IS THE TRUTHY SHAPES FIRST, because the
  // flattering direction is the expensive one: `{ failed: 1 }` reaching `bites`
  // is a green row for a runner that never measured anything. With the falsy
  // shapes first, a mutation that swaps the boolean check for a truthiness check
  // reports RED against the `does-not-bite` assertion on `{}` and the run stops
  // there - the suite would still go red, but the evidence would show the less
  // important failure. Every shape carries a LABEL for the same reason.
  it("a malformed runner result is not-run, in either flattering direction", async () => {
    const malformed = [
      ["the number 1", { failed: 1 }],
      ["a truthy string", { failed: "yes" }],
      ["the string 'true'", { failed: "true" }],
      ["an empty array failed", { failed: [] }],
      ["a boxed boolean", { failed: new Boolean(true) }],
      ["an empty object", {}],
      ["null failed", { failed: null }],
      ["undefined failed", { failed: undefined }],
      ["null", null],
      ["undefined", undefined],
      ["a bare true", true],
      ["a bare string", "failed"],
      ["an empty array", []]
    ]
    expect(malformed).toHaveLength(13)
    for (const [label, result] of malformed) {
      const r = await mutationCheck({ entry, runGuard: async () => result })
      expect(r.verdict, label).not.toBe("bites")
      expect(r.verdict, label).not.toBe("does-not-bite")
      expect(r.verdict, label).toBe("not-run")
      expect(r.evidence.reason, label).toBe("guard-result-not-a-boolean")
    }
  })

  // TRAP 3: an entry marked `mutation: true` whose claim resolves to no FILE.
  // The entry claims a mutation it does not describe. The runner must not be
  // called at all here - `called` is the assertion that matters, because handing
  // a runner a null or invented path is how a "did not run" becomes a green row
  // upstream of this module.
  //
  // THREE SHAPES, NOT ONE, and the second and third are the two a `=== null`
  // guard misses. `splitClaim(" :: titleonly")` returns
  // `{ file: "", title: "titleonly" }` - the separator is present, so there IS a
  // claim, but its PATH is the empty string. And `splitClaim("  ::  ")` returns
  // `{ file: " ", title: " " }` - the SAME shape one space of whitespace in,
  // which `!file` alone also waves through, because `" "` is truthy.
  //
  // Either shape hands `runGuard` a path that names no file, and a runner
  // answering `{failed:true}` then upgrades the row to `bites` on the strength of
  // a title with no file behind it. That is precisely the SHIP-1 direction this
  // module exists to prevent, reached through a malformed entry rather than a
  // missing one. The branch above it (`entry.mutation !== true`) and the one
  // below (`typeof runGuard !== "function"`) each cover a whole CLASS of shape
  // for the same reason; the path gate must too.
  //
  // WHITESPACE IS A MEMBER OF THE CLASS, NOT A FOURTH SPELLING TO NEGOTIATE.
  // `splitClaim` does not trim, and that is Task 2's contract to decide rather
  // than this tier's - so the defence in `mutate.mjs` is `!file?.trim()`, which
  // covers `null`, `""` and any string of nothing-but-whitespace at once. A tab
  // or a newline on its own behaves identically, because they all trim away;
  // measured over `" "`, `"  "`, `"\t"`, `"\n"` and `" \t\n "`, all five are
  // caught and none reaches the runner.
  //
  // THE BOUNDARY IS STATED HERE BECAUSE A TEST THAT ONLY SHOWS THE CASES IT
  // CATCHES IS NOT A SCOPE. What the gate does NOT catch is a claim the splitter
  // never recognised as carrying a separator at all - `" ::"`, `" \t:: \t"`,
  // `"::"` - which arrives as the WHOLE claim in `file`, trims to `"::"`, and
  // does reach the runner. That is `splitClaim`'s separator to recognise or not,
  // not this tier's to fix, and no row is added for it here because adding one
  // would pin behaviour this task does not own. Named instead of omitted.
  it("an entry marked for mutation that names no guard is not-run, and runs nothing", async () => {
    // FALSEST RUNNER POSSIBLE. `{failed:true}` is the most flattering answer
    // there is, so a row reaching it has nothing left to excuse the call.
    const claims = [
      ["an absent claim", null],
      ["a claim that is a bare separator", " :: titleonly"],
      ["a claim whose separator is padded with spaces", "  ::  "]
    ]
    expect(claims).toHaveLength(3)
    for (const [label, claim] of claims) {
      let called = false
      const r = await mutationCheck({
        entry: { ...entry, claim },
        runGuard: async () => {
          called = true
          return { failed: true }
        }
      })
      expect(called, `${label}: the runner was handed a path that names no file`).toBe(false)
      expect(r.verdict, label).toBe("not-run")
      expect(r.verdict, label).not.toBe("bites")
      expect(r.evidence.reason, label).toBe("entry-claims-no-guard-path")
    }
  })

  // TRAP 4. The REASON is what this test is really about: with no runner at all,
  // the call throws a TypeError inside the try and lands on `guard-run-threw`,
  // which tells a reader the runner was WIRED AND CRASHED. It was never wired.
  // Those are different repairs, so they carry different reasons.
  it("no runner supplied is not-run, and is not reported as a crashed run", async () => {
    const outcomes = [
      ["absent", await mutationCheck({ entry })],
      ["not a function", await mutationCheck({ entry, runGuard: "run it" })]
    ]
    expect(outcomes).toHaveLength(2)
    for (const [label, r] of outcomes) {
      expect(r.verdict, label).toBe("not-run")
      expect(r.verdict, label).not.toBe("bites")
      expect(r.evidence.reason, label).toBe("no-runner-supplied")
    }
  })

  // NOT IN THE BRIEF'S TRAP LIST, ADDED DELIBERATELY. `mutationCheck` is the
  // public entry point Task 5's route calls per catalog entry, and this module's
  // stated invariant is that a thrown error is worse than a pessimistic verdict.
  // An unguarded `entry.mutation` throws on a missing entry, so the invariant
  // would be true of the runner and false of the argument.
  it("a missing or non-object entry is not-run, and never throws", async () => {
    const shapes = [undefined, null, "SHIP-1", 42, []]
    expect(shapes).toHaveLength(5)
    for (const bad of shapes) {
      const r = await mutationCheck({ entry: bad, runGuard: async () => ({ failed: true }) })
      expect(r.verdict).not.toBe("bites")
      expect(r.evidence.reason).toBe("entry-is-not-an-object")
    }
    // Called with no argument object at all.
    expect((await mutationCheck()).verdict).toBe("not-run")
  })
})

// THREE VERDICTS, AND THE COUNT IS PINNED BECAUSE "THERE IS NO FOURTH" IS A
// CLAIM ABOUT A CLOSED SET. `bites` and `does-not-bite` are the two verdicts a
// reader acts on differently, and `not-run` is the one that asserts nothing - so
// a fourth verdict would be a fourth thing this module could say, which is the
// thing spec rule 1 forbids for the structural tier.
describe("the mutation verdict vocabulary", () => {
  it("carries exactly the three verdicts the brief names", () => {
    expect([...MUTATION_VERDICTS].sort()).toEqual(["bites", "does-not-bite", "not-run"])
  })

  it("reaches every one of the three, and emits nothing outside them", async () => {
    const reached = new Set()
    const cases = [
      { entry, runGuard: async () => ({ failed: true }) },
      { entry, runGuard: async () => ({ failed: false }) },
      { entry: { ...entry, mutation: false }, runGuard: async () => ({ failed: true }) },
      { entry, runGuard: async () => null },
      { entry },
      { entry: { ...entry, claim: null }, runGuard: async () => ({ failed: true }) },
      { entry: null, runGuard: async () => ({ failed: true }) }
    ]
    for (const c of cases) {
      const r = await mutationCheck(c)
      expect(MUTATION_VERDICTS, JSON.stringify(c.entry)).toContain(r.verdict)
      reached.add(r.verdict)
    }
    expect([...reached].sort()).toEqual([...MUTATION_VERDICTS].sort())
  })
})

// REPORTING SHAPE. Everything below pins a branch that already existed when the
// test was written, so these arrived GREEN - they are regression pins, not TDD
// cycles, and the report says so rather than dressing them up as RED.
describe("every outcome is a row a renderer can line up", () => {
  it("carries the entry's own id on every branch, never a null orphan", async () => {
    // A not-run row with a null id cannot be matched back to the catalog entry,
    // which is how a `not-run` disappears from an overview without anyone
    // deleting it. `mutation: false` is included deliberately - it is the branch
    // a renderer would most want to filter out silently.
    const branches = [
      { entry, runGuard: async () => ({ failed: true }) },
      { entry: { ...entry, mutation: false }, runGuard: async () => ({ failed: true }) },
      { entry, runGuard: async () => ({ failed: false }) },
      { entry, runGuard: async () => null },
      { entry, runGuard: async () => { throw new Error("crashed") } },
      { entry },
      { entry: { ...entry, claim: null }, runGuard: async () => ({ failed: true }) }
    ]
    expect(branches).toHaveLength(7)
    for (const c of branches) {
      const r = await mutationCheck(c)
      expect(r.id, JSON.stringify(c.entry)).toBe("e1")
    }
  })

  it("freezes the outcome and its evidence, so one consumer cannot rewrite another's row", async () => {
    const r = await mutationCheck({ entry, runGuard: async () => ({ failed: true }) })
    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r.evidence)).toBe(true)
  })

  it("reads only a real boolean as a marked entry, never a truthy one", async () => {
    // The same rule the runner result obeys, applied to the catalog flag.
    // "Membership is declared in the catalog and reviewed, never inferred at
    // runtime" (spec, owner decision 3) - a truthy `mutation: "true"` is not a
    // declaration, it is a typo that would silently buy mutation cost.
    for (const flag of ["true", 1, {}, [], "yes", null, undefined]) {
      const r = await mutationCheck({
        entry: { ...entry, mutation: flag },
        runGuard: async () => ({ failed: true })
      })
      expect(r.verdict, String(flag)).not.toBe("bites")
      expect(r.evidence.reason, String(flag)).toBe("entry-not-marked-for-mutation")
    }
  })

  it("distinguishes the two pessimisms by reason, not by verdict alone", async () => {
    // `does-not-bite` is a REAL, DAMNING finding: a guard that passed against a
    // broken implementation is a defect. `not-run` asserts nothing at all. They
    // are not interchangeable, so a reader who can only see the verdict is being
    // told less than a reader who can see the reason - which is the argument for
    // distinct reason strings at all.
    const damning = await mutationCheck({ entry, runGuard: async () => ({ failed: false }) })
    const silent = await mutationCheck({ entry, runGuard: async () => null })
    expect(damning.verdict).toBe("does-not-bite")
    expect(silent.verdict).toBe("not-run")
    expect(damning.evidence.reason).not.toBe(silent.evidence.reason)
  })

  it("names the two measured verdicts in their evidence, and names them differently", async () => {
    // A renderer paints these two rows differently, and the reason string is
    // the only thing that can guarantee they are painted differently even if a
    // caller renders `bites` and `does-not-bite` from a shared palette.
    const bites = await mutationCheck({ entry, runGuard: async () => ({ failed: true }) })
    const damning = await mutationCheck({ entry, runGuard: async () => ({ failed: false }) })
    expect(bites.evidence.reason).toBe("guard-failed-on-broken-implementation")
    expect(damning.evidence.reason).toBe("guard-passed-on-broken-implementation")
    expect(bites.evidence.failed).toBe(true)
    expect(damning.evidence.failed).toBe(false)
  })

  it("gives every not-run reason its own string, so no repair is hidden", async () => {
    // Collapsing these into one reason would leave a known defect unreported -
    // "the runner crashed" and "the catalog names no guard" are different
    // repairs for different owners, and the single most common way a diagnostic
    // disappears is by being merged into a neighbour.
    const reasons = new Set()
    const cases = [
      { entry: null, runGuard: async () => ({ failed: true }) },
      { entry: { ...entry, mutation: false }, runGuard: async () => ({ failed: true }) },
      { entry: { ...entry, claim: null }, runGuard: async () => ({ failed: true }) },
      { entry },
      { entry, runGuard: async () => { throw new Error("crashed") } },
      { entry, runGuard: async () => null }
    ]
    expect(cases).toHaveLength(6)
    for (const c of cases) {
      const r = await mutationCheck(c)
      expect(r.verdict).toBe("not-run")
      reasons.add(r.evidence.reason)
    }
    expect([...reasons].sort()).toEqual([
      "entry-claims-no-guard-path",
      "entry-is-not-an-object",
      "entry-not-marked-for-mutation",
      "guard-result-not-a-boolean",
      "guard-run-threw",
      "no-runner-supplied"
    ])
  })

  // M-2: THREE EVIDENCE FIELDS THAT WERE POPULATED BUT UNPINNED. Each of these
  // shipped in round 0 carrying information a renderer depends on, and deleting
  // any one of them left this file green. They are facts, not decoration: a
  // reader of a `not-run` row is told WHICH claim was not run and WHY.
  it("carries the resolved claim on every branch that resolved one", async () => {
    // `no-runner-supplied` and `guard-run-threw` sit AFTER the split, so they
    // know the file and the title. Round 0 wrote them via a `named` spread and
    // nothing checked the spread reached the output.
    const resolved = [
      ["no-runner-supplied", await mutationCheck({ entry })],
      ["guard-run-threw", await mutationCheck({ entry, runGuard: async () => { throw new Error("x") } })]
    ]
    expect(resolved).toHaveLength(2)
    for (const [reason, r] of resolved) {
      expect(r.evidence.reason, reason).toBe(reason)
      expect(r.evidence.claimPath, `${reason} lost the resolved path`).toBe("server/__tests__/g.test.mjs")
      expect(r.evidence.claimTitle, `${reason} must name the title too`).toBeNull()
    }
  })

  it("carries an explicit null for a measurement that never happened", async () => {
    // `failed: null` and not an absent key. The absence is the whole signal -
    // "nothing usable came back" is a DIFFERENT fact from "no field was
    // populated", and only the first of those is true here. A renderer testing
    // `"failed" in evidence` must be able to tell them apart.
    const r = await mutationCheck({ entry, runGuard: async () => null })
    expect(r.evidence.reason).toBe("guard-result-not-a-boolean")
    expect(Object.keys(r.evidence)).toContain("failed")
    expect(r.evidence.failed).toBeNull()
  })

  // M-3: ONE KEY SET ON EVERY BRANCH, so a consumer never reads `undefined`.
  //
  // Round 0 shipped five different evidence shapes across eight branches. That
  // is harmless in JSON and NOT harmless for Task 5, which serialises this object
  // over HTTP and whose renderer reads `evidence.claimPath` on a `not-run` row -
  // where an omitted key reads `undefined`, not `null`, and renders as the
  // string "undefined" or an empty cell inconsistently with every other row.
  // Absent-vs-null is a distinction that only matters to code, and the only
  // consumer of this module is code.
  it("gives every branch the same evidence keys, so a renderer reads one shape", async () => {
    const branches = [
      ["entry-is-not-an-object", { entry: null, runGuard: async () => ({ failed: true }) }],
      ["entry-not-marked-for-mutation", { entry: { ...entry, mutation: false }, runGuard: async () => ({ failed: true }) }],
      ["entry-claims-no-guard-path", { entry: { ...entry, claim: null }, runGuard: async () => ({ failed: true }) }],
      ["no-runner-supplied", { entry }],
      ["guard-run-threw", { entry, runGuard: async () => { throw new Error("x") } }],
      ["guard-result-not-a-boolean", { entry, runGuard: async () => null }],
      ["guard-failed-on-broken-implementation", { entry, runGuard: async () => ({ failed: true }) }],
      ["guard-passed-on-broken-implementation", { entry, runGuard: async () => ({ failed: false }) }]
    ]
    expect(branches).toHaveLength(8)
    const shapes = new Set()
    for (const [reason, args] of branches) {
      const r = await mutationCheck(args)
      expect(r.evidence.reason, reason).toBe(reason)
      shapes.add(Object.keys(r.evidence).sort().join(","))
      // `claimPath` and `claimTitle` are present on EVERY row, whatever the
      // verdict, so a renderer can bind them without a guard per verdict.
      expect(Object.keys(r.evidence), `${reason} is missing a claim key`).toContain("claimPath")
      expect(Object.keys(r.evidence), `${reason} is missing a claim key`).toContain("claimTitle")
      // And `failed` answers "was anything measured?" on every row too.
      expect(Object.keys(r.evidence), `${reason} is missing the measurement key`).toContain("failed")
    }
    // ONE shape, not two. An earlier draft of this assertion expected two and
    // the implementation beat it; the four early branches could have kept a
    // shorter key set and the renderer would still have had to special-case them.
    expect([...shapes], "evidence key set differs between branches").toHaveLength(1)
    expect([...shapes]).toEqual(["claimPath,claimTitle,failed,reason"])
  })
})

// THE BLANKED SOURCE IS NOT EMPTY. `MUTATE_CODE` feeds seven purity predicates
// and three separator predicates below, and every one of them is a NEGATIVE
// assertion - "this string does not contain X". A negative assertion against an
// empty string succeeds. So if `stripComments` ever regressed to returning `""`,
// the whole source-scan tier would go green while measuring nothing, and
// `MUTATE_SOURCE` - read raw, without the lexer - would be unaffected, so the
// import-set pin would not catch it either.
//
// This matters more than usual here rather than less: the dependency whose
// failure would cause it is `stripComments`, and `stripComments` is exactly the
// shared predicate whose consumer inventory has now been the subject of three
// separate registration defects in this repo. One line, and it converts a silent
// vacuity into a red suite.
describe("the comments-blanked source this file scans is not empty", () => {
  it("carries real code, so the negative source scans cannot pass vacuously", () => {
    expect(MUTATE_CODE.length).toBeGreaterThan(0)
    // And it is the SAME module the raw-source assertions read, not a fixture.
    expect(MUTATE_CODE.length).toBeLessThanOrEqual(MUTATE_SOURCE.length)
  })
})

// THE BOUNDARY THAT MAKES THIS MODULE A READOUT AND NOT A DANGEROUS ONE.
//
// `mutate.mjs` decides whether a guard is worth trusting by BREAKING something
// and watching. If it did the breaking itself it would be a test runner, a
// subprocess launcher and a filesystem writer, reachable from a GET route. The
// running is therefore delegated whole to an injected `runGuard`, and these
// source checks exist because no behavioural probe can tell "did not spawn a
// process" from "spawned one and got nothing".
//
// Each detector is additionally run against a PLANTED violation, because a guard
// that has never been shown to fire is not a guard - the same principle SHIP-1
// is catalogued for, applied to this file.
describe("mutate.mjs is a pure module", () => {
  const FORBIDDEN = [
    { pattern: /["']node:/, why: "no node builtin, static or dynamic" },
    { pattern: /\brequire\s*\(/, why: "no require" },
    { pattern: /\bprocess\s*\./, why: "no process access" },
    { pattern: /\bDate\s*\.\s*now\b|\bnew\s+Date\b/, why: "no clock read" },
    { pattern: /\bfetch\s*\(/, why: "no network" },
    { pattern: /\bvitest\b/, why: "never runs vitest itself" },
    { pattern: /\bchild_process\b|\bspawnSync\b|\bexecSync\b/, why: "no subprocess" }
  ]

  for (const { pattern, why } of FORBIDDEN) {
    it(`declares no violation: ${why}`, () => {
      expect(MUTATE_CODE).not.toMatch(pattern)
    })
  }

  it("bites: the purity detectors fire on planted violations", () => {
    const planted = [
      ['import { execSync } from "node:child_process"', "no node builtin, static or dynamic"],
      ['const dir = process.env.PICC_DATA_DIR', "no process access"],
      ["const now = new Date()", "no clock read"],
      ['const run = await import("node:child_process")', "no node builtin, static or dynamic"],
      ['await import("vitest")', "never runs vitest itself"],
      ['execSync("vitest run")', "no subprocess"]
    ]
    expect(planted).toHaveLength(6)
    for (const [sample, why] of planted) {
      const detector = FORBIDDEN.find((f) => f.why === why)
      expect(sample, why).toMatch(detector.pattern)
    }
  })
})

// THE SEPARATOR IS A CONTRACT, NOT A STRING. Three consumers now have to agree on
// how a catalog `claim` splits into a guard file and a title: `inventory.mjs`
// defines it, `verify.mjs` consumes it, and this file consumes it. A fourth copy
// of the split here would be SHIP-5 in miniature - two evidence piles drifting
// apart because each re-implemented one predicate - which is the precise defect
// this whole planner exists to catch.
describe("mutate.mjs reuses the shared splitter", () => {
  /** Every module specifier this file pulls in, static and dynamic alike. */
  const importSpecifiers = (source) => {
    const code = stripComments(source)
    return [
      ...[...code.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
    ]
  }

  // ONE TABLE, TWO READERS, and that is the whole point.
  //
  // Round 0 declared the real check's patterns and the bite test's patterns
  // SEPARATELY, so the bite test was certifying literals of its own: deleting
  // the real check left it green, because a bite test for a detector that no
  // longer exists says nothing about anything. Here the sample, the pattern and
  // the real scan are one declaration, and the length pin stops the table
  // quietly losing a row.
  const SEPARATOR_FORBIDDEN = [
    { pattern: /::/, why: "never spells the separator out", planted: 'const gap = " :: "' },
    { pattern: /\.split\(/, why: "never re-implements the split", planted: 'const [f, t] = c.split(" :: ")' },
    { pattern: /indexOf\(/, why: "never finds the separator by hand", planted: 'const at = c.indexOf(" :: ")' }
  ]

  /** THE SCAN. Both the real assertion and the bite test call THIS, not a copy. */
  const assertNoReimplementedSplit = (code) => {
    for (const { pattern, why } of SEPARATOR_FORBIDDEN) {
      expect(code, why).not.toMatch(pattern)
    }
  }

  it("declares exactly one import, and it is the shared splitter", () => {
    // Not "imports splitClaim" - the WHOLE SET. One assertion then covers every
    // way this module could reach outside itself: `fs`, `child_process`, a
    // store, the vitest runner, a second copy of a helper. Adding any import
    // becomes a deliberate, visible act on this line rather than a silent one
    // in an editor.
    expect(importSpecifiers(MUTATE_SOURCE)).toEqual(["./inventory.mjs"])
  })

  it("bites: the import-set check rejects a second import", () => {
    const widened = `import { splitClaim } from "./inventory.mjs"
import { readFile } from "node:fs/promises"
export const x = splitClaim(readFile)`
    expect(importSpecifiers(widened)).toEqual(["./inventory.mjs", "node:fs/promises"])
  })

  it("never spells the separator out, in code or in a comment", () => {
    // `MUTATE_CODE` for the table, so this file may NAME the separator in
    // its own prose without failing on its own documentation - and the code
    // check is the one that matters, because a comment carrying the literal
    // invites the next reader to copy it. The last line scans the RAW source,
    // comments included, which is the stricter half: it forbids the literal in
    // `mutate.mjs`'s prose too. That is deliberate, and it is why this file
    // refers to the separator as "the separator" rather than writing it out.
    assertNoReimplementedSplit(MUTATE_CODE)
    expect(MUTATE_SOURCE).not.toContain('" :: "')
  })

  it("bites: the separator scan fires on a reimplemented split", () => {
    // THE FIRST HALF IS THE ONE THAT MATTERS, and it is the half round 0 was
    // missing. The bite test calls the very function the real scan calls, so
    // deleting or neutering that scan turns THIS red rather than leaving it
    // green on a re-declared literal of its own.
    expect(() => assertNoReimplementedSplit('const [f, t] = c.split(" :: ")')).toThrow()
    // The second half keeps the diagnostic legible: each planted sample is
    // shown tripping the detector the real scan uses for it.
    expect(SEPARATOR_FORBIDDEN).toHaveLength(3)
    for (const { pattern, why, planted } of SEPARATOR_FORBIDDEN) {
      expect(planted, why).toMatch(pattern)
    }
  })

  it("calls the runner with the file and nothing else", async () => {
    // The module's own doc comment claims one argument and no runner protocol.
    // A second argument would be this file inventing a contract no caller agreed
    // to, so the claim is pinned rather than left as prose.
    const calls = []
    const claim = "server/__tests__/g.test.mjs :: a specific title"
    await mutationCheck({
      entry: { ...entry, claim },
      runGuard: async (...args) => {
        calls.push(args)
        return { failed: true }
      }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(["server/__tests__/g.test.mjs"])
  })
})

// ONE DERIVATION OF ONE VALUE. The runner's observation is read once into
// `failed` and every decision downstream is made against that single value. This
// cannot be distinguished by any behavioural test in this file - three calls to a
// pure helper agree with one call on every input - so what is pinned here is the
// derivation itself, read off the module's comments-blanked source. Task 3 found
// the same shape in `resolved()`: a normalised value re-derived from the raw
// record, free to drift from the normalisation it was supposed to inherit.
describe("mutate.mjs derives the runner's observation once", () => {
  const checkBody = (source) => {
    const code = stripComments(source)
    const start = code.indexOf("export async function mutationCheck")
    if (start === -1) return ""
    // `stripComments` preserves newlines, so the body runs to the end of the
    // declaration rather than to the next brace at column zero.
    return code.slice(start, code.indexOf("\n}\n", start))
  }

  /** THE SCAN. The real assertion below and the bite test call THIS. */
  const assertDerivedOnce = (source) => {
    const body = checkBody(source)
    // Scoped and non-empty, so this cannot pass by matching nothing - the same
    // vacuity the empty-slice failure in Task 3's own ordering check records.
    expect(body.length).toBeGreaterThan(0)
    expect((body.match(/observedFailure\(/g) ?? []).length).toBe(1)
  }

  it("reads the runner result through a single helper call", () => {
    assertDerivedOnce(MUTATE_SOURCE)
  })

  it("bites: the derivation scan fails on a body that re-reads the result", () => {
    // Coupled, not re-declared: deleting or neutering `assertDerivedOnce` turns
    // this red. Under round 0's shape it was certifying a regex literal of its
    // own and would have stayed green.
    expect(() =>
      assertDerivedOnce(`export async function mutationCheck({ entry }) {
  const bites = observedFailure(result) === true
  const passed = observedFailure(result) === false
}`)
    ).toThrow()
    // And the empty-body case, which is what a length guard is FOR: a scan that
    // finds nothing must fail, not quietly pass on a count of zero.
    expect(() => assertDerivedOnce("export async function mutationCheck() {}")).toThrow()
  })
})

// THE PRIMARY EXPORT'S CONTRACT IS ATTACHED TO THE PRIMARY EXPORT. A doc block
// sitting above the wrong declaration is documentation of the wrong thing:
// editors and doc tooling resolve it to whatever is next, so a reader hovering
// `mutationCheck` would have been shown `UNMEASURED`'s paragraph in place of the
// decision path, the argument contract and the return type. It happened once
// here, in the very commit that introduced `UNMEASURED`.
//
// TOLERANT OF BLANK LINES ON PURPOSE. A formatter inserting one is not a defect,
// and a suite that goes red for it teaches the suite to be ignored. What it
// refuses is another DOC BLOCK in between, which is the regression it exists to
// catch.
//
// This check arrived GREEN, because the fix it pins was already in place. Its RED
// is demonstrated by mutation R7 in the report, which re-parks the block and
// turns exactly this test red.
describe("the primary export's contract is attached to the primary export", () => {
  const CONTRACT = "@returns {Promise<{id: string|null, verdict: string, evidence: object}>}"

  /**
   * THE SCAN. The real check and the bite test below both call THIS.
   *
   * ANCHORED ON THE CONTRACT'S OWN TEXT, not on the nearest block closer - an
   * earlier draft searched backwards for the closest closer, which a parked doc
   * block satisfies perfectly well by supplying one of its own. The marker is
   * what says which block is the contract; everything after that block's closer
   * must be blank. (That draft passed a planted violation, which is how the
   * bite test below found it.)
   */
  const assertContractAttached = (source) => {
    const at = source.indexOf("export async function mutationCheck")
    const marked = source.indexOf(CONTRACT)
    expect(marked, "mutationCheck's @returns line is missing").toBeGreaterThan(-1)
    expect(marked, "the @returns line sits after the declaration").toBeLessThan(at)
    const blockEnd = source.indexOf("*/", marked)
    expect(source.slice(blockEnd + 2, at)).toMatch(/^\s*$/)
  }

  it("leaves no doc block between mutationCheck's @returns and its declaration", () => {
    assertContractAttached(MUTATE_SOURCE)
    // Raw source, not the blanked one: where a comment SITS is the whole subject
    // here, and `stripComments` would have removed the very thing being measured.
  })

  it("bites: a doc block parked between the contract and the declaration is caught", () => {
    // Coupled, not re-declared: neutering `assertContractAttached` turns this red
    // rather than leaving it green on a pattern of its own.
    const head = "  * " + CONTRACT + "\n  */\n"
    const decl = "export async function mutationCheck() {}"
    expect(() => assertContractAttached(head + "/** parked here */\n" + decl)).toThrow()
    expect(() => assertContractAttached(head + "const NOTE = 1\n" + decl)).toThrow()
    // And the cases that are NOT defects stay green, which is what makes the
    // check above safe to leave in the suite permanently.
    expect(() => assertContractAttached(head + decl)).not.toThrow()
    expect(() => assertContractAttached(head + "\n" + decl)).not.toThrow()
  })
})

// `catalog.mjs` is a code constant with no I/O, so importing it is not pointing
// a test at the repository tree — the RUNNER below is injected and returns the
// most flattering answer it possibly could. The point of this sweep is that
// "most flattering runner" plus "every real entry" still produces `bites` for
// exactly the entries the catalog marked, and for no others.
describe("mutate.mjs against the real catalog", () => {
  it("reaches bites for the marked entries only, with a maximally flattering runner", async () => {
    const marked = FAILURE_MODES.filter((e) => e.mutation === true).map((e) => e.id)
    const results = []
    for (const entry of FAILURE_MODES) {
      results.push(await mutationCheck({ entry, runGuard: async () => ({ failed: true }) }))
    }
    expect(results).toHaveLength(FAILURE_MODES.length)
    for (const r of results) expect(MUTATION_VERDICTS).toContain(r.verdict)
    expect(results.filter((r) => r.verdict === "bites").map((r) => r.id)).toEqual(marked)
    // Measured, and re-measured rather than asserted from prose: 11 entries, 4
    // marked, and every `mutation` value in the catalog is a boolean.
    // 11 -> 12 with SHIP-7, the tab-spelled claim separator (W3-05 Task 5). It is
    // `mutation: false`, so the marked set below is unchanged - which is the point
    // of recording it as an entry rather than marking it: an unreachable defect
    // must not put the tier in a position to accuse a guard.
    expect(FAILURE_MODES).toHaveLength(12)
    expect(marked).toEqual(["SHIP-1", "SHIP-2", "SHIP-5", "SHIP-6"])
    expect([...new Set(FAILURE_MODES.map((e) => typeof e.mutation))]).toEqual(["boolean"])
    // Backing the module header's claim that the split is load-bearing here
    // rather than theoretical: every entry currently marked for mutation carries
    // a SUFFIXED claim, so handing a runner the raw claim string would be wrong
    // for every entry this module is asked to run, not merely most of them.
    expect(FAILURE_MODES.filter((e) => e.mutation === true).every((e) => e.claim.includes(" :: "))).toBe(true)
  })

  it("never hands the runner a whole claim string, for any marked entry", async () => {
    const seen = []
    const marked = FAILURE_MODES.filter((e) => e.mutation === true)
    for (const entry of marked) {
      await mutationCheck({
        entry,
        runGuard: async (file) => {
          seen.push(file)
          return { failed: true }
        }
      })
    }
    expect(seen).toHaveLength(marked.length)
    // Deliberately NOT computed with `splitClaim`: that would make this test
    // agree with the implementation by construction and prove nothing. What it
    // pins is the property that is actually at risk — a runner being asked to
    // open a path that has a test title glued to the end of it.
    expect(seen).not.toContain(...marked.map((e) => e.claim))
    for (const file of seen) expect(file).toMatch(/\.test\.mjs$/)
  })
})