// W3-05 Task 5 — the mutation RUNNER's decision logic.
//
// WHY THESE TESTS EXIST RATHER THAN A SANDBOX TEST. `preMortemApi.test.mjs`
// proves the runner really runs guards, and it pays for that with a worktree
// checkout and two vitest runs per call. What it cannot cheaply prove is the
// branch that decides whether a measurement EXISTS — and that is the branch with
// the worst failure direction in the whole feature.
//
// THE FAILURE DIRECTION, STATED FIRST. A runner handed a mutation whose anchor
// has moved does not break anything, then runs an UNBROKEN guard, sees green,
// and reports `does-not-bite`. That is a FALSE DAMNING finding: it accuses a
// guard of blindness that was never shown a broken implementation. It is the one
// outcome this feature must never manufacture, so the refusal is pinned here
// behaviourally rather than described in a comment.
//
// NO SANDBOX IS CREATED BY THIS FILE. Every case is decided from a stub `dir`,
// so the suite stays hermetic and fast; the real execution is covered by
// `preMortemApi.test.mjs`.

import { describe, expect, it } from "vitest"
import {
  MUTATIONS,
  applyLineMutation,
  createGuardRunner,
  mutationFor,
  readMeasurement
} from "../services/premortem/runner.mjs"

const GUARD_A = "apps/dashboard/server/__tests__/graduationGates.test.mjs"
const GUARD_B = "apps/dashboard/server/__tests__/sharedCommentLexer.test.mjs"

describe("the pre-mortem mutation runner (W3-05 Task 5)", () => {
  it("every registered mutation names a guard-shaped file and a real target", () => {
    // A table that drifts is catalog entry SHIP-2 in miniature, and the mutation
    // anchors below are checked against the REAL files in a later test rather
    // than against this array, so a renamed target cannot pass by being renamed
    // here too.
    expect(MUTATIONS.length).toBeGreaterThan(0)
    for (const m of MUTATIONS) {
      expect(m.guard).toMatch(/__tests__\/.+\.test\.mjs$/)
      expect(m.target).toMatch(/\.(mjs|cjs|js|ts|tsx)$/)
      expect(m.target).not.toContain("__tests__")
      expect(typeof m.needle).toBe("string")
      expect(m.needle.length).toBeGreaterThan(0)
    }
    // ONE MUTATION PER GUARD FILE, or two entries would race over one file.
    expect(new Set(MUTATIONS.map((m) => m.guard)).size).toBe(MUTATIONS.length)
  })

  it("every registered anchor still matches exactly one line of the REAL file", async () => {
    // THE TABLE CANNOT DRIFT INTO VACUITY. If an implementation is refactored
    // past its anchor, `applyLineMutation` starts refusing, every `mutation: true`
    // entry silently falls back to `not-run`, and the tier goes quiet — a
    // failure that reads as "nothing to report" rather than as a broken runner.
    // This asserts against the working tree, so it goes RED when the anchor
    // moves, which is the only moment anyone can act on it.
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const { join } = await import("node:path")
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))
    for (const m of MUTATIONS) {
      const text = await readFile(join(repoRoot, m.target), "utf8")
      const out = applyLineMutation(text, m.needle, m.replacement)
      expect(out.ok, `${m.target} anchor "${m.needle}" no longer matches exactly one line (${out.matches ?? 0})`).toBe(true)
    }
  })

  it("mutationFor matches the WHOLE path, so a same-named file elsewhere cannot claim it", () => {
    expect(mutationFor(GUARD_A)).not.toBeNull()
    // A partial match would let `some/other/graduationGates.test.mjs` inherit a
    // mutation written for a different file.
    expect(mutationFor("some/other/graduationGates.test.mjs")).toBeNull()
    expect(mutationFor("graduationGates.test.mjs")).toBeNull()
    expect(mutationFor("")).toBeNull()
    expect(mutationFor(null)).toBeNull()
  })

  it("REFUSES a mutation whose anchor has moved, rather than reporting the green it then sees", async () => {
    // THE FALSE-DAMMING GUARD, asserted end to end through `createGuardRunner`.
    // An unregistered guard must yield NO measurement. Were it to yield
    // `{failed: false}`, `mutate.mjs` would report `does-not-bite` — a damning
    // finding manufactured out of a runner that never broke anything.
    const runGuard = createGuardRunner({ sandbox: { dir: "unused" } })
    await expect(runGuard("apps/dashboard/server/__tests__/notRegistered.test.mjs")).resolves.toBeUndefined()
  })

  it("applyLineMutation replaces the line and preserves the line count and indentation", () => {
    const text = ["export const a = 1", "  qualifying += 1", "export const b = 2"].join("\n")
    const out = applyLineMutation(text, "qualifying += 1", "qualifying += 0")
    expect(out.ok).toBe(true)
    expect(out.text.split("\n")).toHaveLength(3)
    expect(out.text).toContain("  qualifying += 0")
    expect(out.text).not.toContain("qualifying += 1")
    // The neighbours are untouched — a mutation that reformatted the file would
    // make every diff-based reading of the sandbox misleading.
    expect(out.text.startsWith("export const a = 1")).toBe(true)
    expect(out.text.endsWith("export const b = 2")).toBe(true)
  })

  it("applyLineMutation refuses an AMBIGUOUS anchor, which would mutate the wrong site", () => {
    const text = ["  x += 1", "  x += 1", "  y += 1"].join("\n")
    const out = applyLineMutation(text, "x += 1", "x += 0")
    expect(out.ok).toBe(false)
    expect(out.reason).toBe("mutation-anchor-not-unique")
    expect(out.matches).toBe(2)
  })

  it("applyLineMutation refuses an absent anchor and names the reason", () => {
    const out = applyLineMutation(["  a = 1"].join("\n"), "notInThisFile", "x")
    expect(out.ok).toBe(false)
    expect(out.reason).toBe("mutation-anchor-not-found")
    expect(out.matches).toBe(0)
  })

  it("an array replacement adds lines and keeps them all indented like the original", () => {
    const text = ["const list = [", '  "a"', "]"].join("\n")
    const out = applyLineMutation(text, '"a"', ['"a",', '"b"'])
    expect(out.ok).toBe(true)
    expect(out.text.split("\n")).toHaveLength(4)
    expect(out.text).toContain('  "a",')
    expect(out.text).toContain('  "b"')
  })

  it("a guard that collected ZERO tests is NOT a guard that passed", () => {
    // THE BRANCH THAT WAS UNPINNED. This decision was inlined until a mutation
    // check deleted the zero-test guard and left this whole file green. It is
    // extracted and tested here because reaching it through a sandbox needs a
    // guard that asserts nothing — which is exactly the defect, and exactly what
    // cannot be arranged in the catalog.
    expect(readMeasurement({ numTotalTests: 0, numFailedTests: 0 })).toBeUndefined()
    expect(readMeasurement({ numTotalTests: 0, numFailedTests: 3 })).toBeUndefined()
  })

  it("a real report yields a real measurement in both directions", () => {
    // The two shapes vitest actually writes, measured: 39 tests / 20 failed on
    // the graduation guard under the `qualifying += 0` mutation, and 39 / 0 with
    // no mutation applied.
    expect(readMeasurement({ numTotalTests: 39, numFailedTests: 20 })).toEqual({ failed: true })
    expect(readMeasurement({ numTotalTests: 39, numFailedTests: 0 })).toEqual({ failed: false })
  })

  it("a report whose counts are not integers measures nothing", () => {
    // `"0"` and `0.5` are not counts. Reading them as one would upgrade a guard's
    // standing on a value vitest never wrote.
    expect(readMeasurement({ numTotalTests: "39", numFailedTests: 0 })).toBeUndefined()
    expect(readMeasurement({ numTotalTests: 39, numFailedTests: null })).toBeUndefined()
    expect(readMeasurement({ numTotalTests: 0.5, numFailedTests: 0 })).toBeUndefined()
    expect(readMeasurement(null)).toBeUndefined()
    expect(readMeasurement("39 tests, 20 failed")).toBeUndefined()
  })

  it("the two registered mutations bite DIFFERENT guards, so the tier's two directions are not one guard", () => {
    // Spec section 5 asks for one `bites` and one `does-not-bite`. If both
    // directions ever came from the same guard file, the tier would be reporting
    // one measurement twice rather than two independent findings.
    expect(mutationFor(GUARD_A)).not.toBeNull()
    expect(mutationFor(GUARD_B)).not.toBeNull()
    expect(mutationFor(GUARD_A).target).not.toBe(mutationFor(GUARD_B).target)
  })
})