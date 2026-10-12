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

  // TRAP 3: an entry marked `mutation: true` whose claim is absent. The entry
  // claims a mutation it does not describe. The runner must not be called at
  // all here - `called` is the assertion that matters, because handing a runner
  // a null or invented path is how a "did not run" becomes a green row upstream
  // of this module.
  it("an entry marked for mutation that names no guard is not-run, and runs nothing", async () => {
    let called = false
    const r = await mutationCheck({
      entry: { ...entry, claim: null },
      runGuard: async () => {
        called = true
        return { failed: true }
      }
    })
    expect(called).toBe(false)
    expect(r.verdict).toBe("not-run")
    expect(r.evidence.reason).toBe("entry-claims-no-guard-path")
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
    // `MUTATE_CODE` for the first three, so this file may NAME the separator in
    // its own prose without failing on its own documentation - and the code
    // check is the one that matters, because a comment carrying the literal
    // invites the next reader to copy it. The last line scans the RAW source,
    // comments included, which is the stricter half: it forbids the literal in
    // `mutate.mjs`'s prose too. That is deliberate, and it is why this file
    // refers to the separator as "the separator" rather than writing it out.
    expect(MUTATE_CODE).not.toContain("::")
    expect(MUTATE_CODE).not.toMatch(/\.split\(/)
    expect(MUTATE_CODE).not.toMatch(/indexOf\(/)
    expect(MUTATE_SOURCE).not.toContain('" :: "')
  })

  it("bites: the separator check fails on a reimplemented split", () => {
    const reimplements = 'const [file, title] = entry.claim.split(" :: ")'
    expect(reimplements).toMatch(/\.split\(/)
    expect(reimplements).toContain("::")
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

  it("reads the runner result through a single helper call", () => {
    const body = checkBody(MUTATE_SOURCE)
    // Scoped and non-empty, so this cannot pass by matching nothing - the same
    // vacuity the empty-slice failure in Task 3's own ordering check records.
    expect(body.length).toBeGreaterThan(0)
    expect((body.match(/observedFailure\(/g) ?? []).length).toBe(1)
  })

  it("bites: the derivation check fails on a body that re-reads the result", () => {
    const rederived = `export async function mutationCheck({ entry }) {
  const bites = observedFailure(result) === true
  const passed = observedFailure(result) === false
}`
    expect((rederived.match(/observedFailure\(/g) ?? []).length).toBe(2)
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
    expect(FAILURE_MODES).toHaveLength(11)
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