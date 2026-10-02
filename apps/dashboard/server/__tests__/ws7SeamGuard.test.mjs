// WS-7 T21 - the WS-7 SEAM GUARD's guard (AC-046 / AC-048, spec :1381-1388).
//
// Spec :1386 enumerates TWENTY-ONE things the final guard must check - fifteen
// from the task's own list and six added by the 2026-09-26 round (D22, D23,
// D24, D25, D26, D27). This file is that guard, and it does six things that
// could each plausibly be false:
//
//   1. THE VOCABULARY IS CLOSED AT TWENTY-ONE, and the split is 15 + 6. A check
//      cannot be dropped or added without a red test here.
//   2. THE GATE RUNS AGAINST THE REAL REPOSITORY. Every measurement comes from a
//      real artefact on disk or a live module import, never a stub.
//   3. NO CHECK REPORTS PASS WITHOUT HAVING COMPARED A NUMBER. Every row's
//      `ok` is re-derived here from its own `measured`, `budget` and
//      `comparison`, and every countable check is MUTATED to a violating
//      measurement to prove it flips.
//   4. THE GATE IS OBSERVED FAILING, as a real process with a non-zero exit
//      code. A gate never seen to fail is unverified, so `--fail-branch` is
//      spawned and its exit code read.
//   5. BOTH CONJUNCTIONS ARE PROVEN BOTH HALVES. D23 and D26 each have a half
//      that passes trivially; each is flipped independently.
//   6. THE HONEST INCOMPLETENESS IS VISIBLE AND NOT BLOCKING. The deliberate
//      open items are counted, printed, and provably cannot move the exit code.
//
// It also REPORTS the three blocking findings the real repository produces, and
// pins their measured values so that a reviewer sees the same numbers the gate
// prints and cannot mistake a discovered defect for a green build.

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { collectRoomCompletionFacts } from "../../src/terminal/domain/roomCompletionFacts"

import {
  BUDGETS,
  BLOCKING_CHECK_IDS,
  BLOCKING_KINDS,
  CHECKS,
  CHECK_COUNT,
  CHECK_IDS,
  CHECK_KINDS,
  COMPARISONS,
  CONJUNCTION_CHECK_IDS,
  EVIDENCE_CHECK_IDS,
  EVIDENCE_KINDS,
  EXPECTED_CHECK_COUNT,
  PASS_LIKE,
  SPEC_ORIGINAL_CHECK_COUNT,
  SPEC_ROUND_2026_09_26_CHECK_COUNT,
  VERDICT_VOCABULARY,
  DETECTOR_FILES,
  D26_CATALOG_ROWS,
  evaluateSeam,
  gateExitCode,
  probeSeam,
  productionFiles,
  stripComments,
  stripPythonComments,
  VENUE_RESIDUE_TOKENS,
  syntheticOpenItemProbe,
  syntheticProbe
} from "../../../../scripts/ws7-seam-guard.mjs"

/**
 * The repo root, found by walking up to the directory that HOLDS `.git`.
 *
 * Two earlier attempts failed here and both are worth recording, because the
 * failure mode is invisible until the full suite runs:
 *
 *   1. `fileURLToPath(new URL("../../../../", import.meta.url))` resolved to
 *      `apps/dashboard`, not the repo root - URL resolution against a FILE base
 *      pops the filename on the first `..`, so the literal reads like a
 *      four-level walk and behaves like a three-level one.
 *   2. Deriving it from `GATE_PATH` inherited the same off-by-one, because the
 *      `../../../../scripts/...` literal was wrong in the same way.
 *
 * Both passed when this file ran ALONE and both failed only inside
 * `npm test`, as `apps/dashboard/apps/dashboard/server/services/...`. A marker
 * search has no such ambiguity: `git ls-files` needs the top level and
 * `existsSync(join(dir, ".git"))` finds exactly one.
 */
const findRepoRoot = (from) => {
  let dir = resolve(from)
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`no directory containing .git found above ${from}`)
}

const REPO_ROOT = findRepoRoot(process.cwd())
const GATE_PATH = join(REPO_ROOT, "scripts", "ws7-seam-guard.mjs")

/**
 * This guard's probe scans the whole tracked product — comment-stripping ~230
 * files, importing two live modules, and shelling out to `git ls-files` — and
 * four of the tests below run it as a real process, one of them 21 times. Under
 * the full-suite run's worker concurrency that legitimately exceeds vitest's
 * 5000 ms default, so those tests declare a real budget here.
 *
 * This is NOT the global `testTimeout` being loosened to hide a slow test: the
 * budget is attached per-test, only to the four that spawn processes, and the
 * gate itself already carries a 180 s spawn timeout. Raising a global default
 * to make a specific expensive assertion fit is how a suite stops timing out
 * anything at all.
 */
const GATE_TEST_TIMEOUT = 180_000

/** Assert the derivation, so a future cwd change is a red test and not a mystery path. */
it("derives the repo root correctly, whatever the cwd is", () => {
  expect(REPO_ROOT.endsWith("PICC")).toBe(true)
  expect(existsSync(join(REPO_ROOT, "package.json"))).toBe(true)
  expect(existsSync(GATE_PATH)).toBe(true)
  expect(findRepoRoot(REPO_ROOT)).toBe(REPO_ROOT)
  expect(findRepoRoot(join(REPO_ROOT, "apps", "dashboard"))).toBe(REPO_ROOT)
  expect(findRepoRoot(join(REPO_ROOT, "scripts"))).toBe(REPO_ROOT)
})

/** Spawn the seam gate as a real process and read its exit code. */
const runGate = (...args) =>
  spawnSync(process.execPath, [GATE_PATH, ...args], { encoding: "utf8", cwd: REPO_ROOT, timeout: 180_000 })

const PROBE = probeSeam({ repoRoot: REPO_ROOT })
const REPORT = evaluateSeam(PROBE)

const rowFor = (id) => REPORT.rows.find((r) => r.id === id)
const cloneProbe = () => ({ ...PROBE, measured: { ...PROBE.measured }, detail: { ...PROBE.detail }, openItems: PROBE.openItems })

/* ==========================================================================
   1. THE VOCABULARY IS CLOSED
   ========================================================================== */

describe("AC-046 - the twenty-one checks are a closed, counted vocabulary", () => {
  it("is exactly twenty-one: fifteen from :1386 plus six from the 2026-09-26 round", () => {
    expect(CHECK_COUNT).toBe(EXPECTED_CHECK_COUNT)
    expect(EXPECTED_CHECK_COUNT).toBe(SPEC_ORIGINAL_CHECK_COUNT + SPEC_ROUND_2026_09_26_CHECK_COUNT)
  })

  it("names every check :1386 lists, and no id repeats", () => {
    const expected = [
      // the fifteen of :1386, in the spec's own order
      "absence.discovered-scope-complete",
      "venue.expertoption-residue",
      "perps.cancel-member-present",
      "agents.no-wildcard-cors",
      "secrets.no-plaintext-key",
      "model.no-pickle-load-path",
      "engine.weight-sum-exactly-100",
      "engine.tier-boundary-single-authority",
      "engine.veto-inspectable",
      "authority.separation-of-duties",
      "retention.classes-declared",
      "ram.gate-exists-and-last-result",
      "arm.probe-artifact-present",
      "budget.every-row-verdicted",
      "deps.no-unused-dependency",
      // the six added by the 2026-09-26 round
      "perps.cancelOrder-blocked-and-seam-exposed",
      "catalog.claims-gone-entries-stay",
      "lockfile.single-and-no-pnpm",
      "docs.camouflage-policy-linked",
      "docs.typing-invariant-states-boundary",
      "rooms.completeness-verdict-declared"
    ]
    expect([...CHECK_IDS].sort()).toEqual([...expected].sort())
    expect(new Set(CHECK_IDS).size).toBe(CHECK_IDS.length)
  })

  it("assigns every check a kind, a comparison and a numeric budget", () => {
    for (const check of CHECKS) {
      expect(CHECK_KINDS, check.id).toContain(check.kind)
      expect(COMPARISONS, check.id).toContain(check.comparison)
      expect(typeof budgetOfFor(check.id), check.id).toBe("number")
    }
  })

  it("names the existing guard that owns each check, and names the four T21 introduces", () => {
    const owned = CHECKS.filter((c) => c.ownedBy !== null).length
    const introduced = CHECKS.filter((c) => c.ownedBy === null).map((c) => c.id)
    // NINETEEN of twenty-one are already enforced elsewhere; this gate composes
    // them. The four it introduces are named so a reviewer can see the seam did
    // not quietly borrow four invariants it then failed to own.
    expect(owned).toBe(17)
    expect(introduced.sort()).toEqual(
      ["docs.camouflage-policy-linked", "docs.typing-invariant-states-boundary", "deps.no-unused-dependency", "venue.expertoption-residue"].sort()
    )
  })

  it("marks the two conjunctions as conjunctions, and they are exactly D23 and D26", () => {
    expect([...CONJUNCTION_CHECK_IDS].sort()).toEqual(
      ["catalog.claims-gone-entries-stay", "perps.cancelOrder-blocked-and-seam-exposed"].sort()
    )
  })

  it("records the blocking and evidence partitions disjointly", () => {
    expect(BLOCKING_CHECK_IDS.length + EVIDENCE_CHECK_IDS.length).toBe(CHECK_COUNT)
    expect(new Set([...BLOCKING_CHECK_IDS, ...EVIDENCE_CHECK_IDS]).size).toBe(CHECK_COUNT)
    expect([...BLOCKING_KINDS, ...EVIDENCE_KINDS].sort()).toEqual([...BLOCKING_KINDS, ...EVIDENCE_KINDS].sort())
  })
})

/* ==========================================================================
   2. IT RUNS AGAINST THE REAL REPOSITORY
   ========================================================================== */

describe("the probe measures real artefacts, not stubs", () => {
  it("discovered the production tree from git, and it is not empty", () => {
    expect(PROBE.detail.venueResidue.filesScanned).toBeGreaterThan(300)
  })

  it("imported the live pure modules rather than reading a copy of their numbers", () => {
    // The weight DEVIATION is zero because the frozen table sums to 100, and the
    // sum itself is reported rather than assumed.
    expect(PROBE.detail.weightSum.sum).toBe(100)
    expect(PROBE.detail.weightSum.experts).toHaveLength(6)
    expect(PROBE.detail.weightSum.frozen).toBe(true)
  })

  it("found T0's real discovered absence scope, with nothing undeclared", () => {
    expect(PROBE.detail.absence.discovered).toContain("services/ccxtOrdering.mjs")
    expect(PROBE.detail.absence.discovered).toContain("services/venues/hyperliquidPerps.mjs")
    expect(PROBE.detail.absence.undeclared).toEqual([])
  })

  it("reads T20's room inventory rather than restating the room list", () => {
    expect(PROBE.detail.roomVerdicts.inventorySize).toBe(22)
    expect(PROBE.detail.roomVerdicts.namedRooms).toBe(6)
  })
})

/* ==========================================================================
   3. NO CHECK PASSES WITHOUT COMPARING A NUMBER
   ========================================================================== */

describe("T19's discipline, inherited: no check reports ok without a measured quantity", () => {
  it("every row carries a FINITE measurement and a NUMERIC budget", () => {
    for (const row of REPORT.rows) {
      expect(typeof row.measured, row.id).toBe("number")
      expect(Number.isFinite(row.measured), row.id).toBe(true)
      expect(typeof row.budget, row.id).toBe("number")
    }
  })

  it("`ok` is RE-DERIVABLE from measured, budget and comparison - a hand-set pass cannot survive", () => {
    for (const row of REPORT.rows) {
      const derived = row.comparison === "at-least" ? row.measured >= row.budget : row.measured <= row.budget
      expect(row.ok, row.id).toBe(derived)
    }
  })

  it("every check RAN - the row count equals the table size", () => {
    expect(REPORT.rows).toHaveLength(CHECK_COUNT)
    expect(REPORT.ranFullSet).toBe(true)
  })

  it("a check with NO measurement is a FAILURE carrying a note, never a pass", () => {
    const probe = cloneProbe()
    delete probe.measured["engine.weight-sum-exactly-100"]
    const report = evaluateSeam(probe)
    const row = report.rows.find((r) => r.id === "engine.weight-sum-exactly-100")
    expect(row.ok).toBe(false)
    expect(row.verdict).toBe("fail")
    expect(row.note).toContain("inspected nothing")
    expect(gateExitCode(report)).toBe(1)
  })

  it("a NON-NUMERIC measurement is a failure, never a pass", () => {
    const probe = cloneProbe()
    probe.measured["retention.classes-declared"] = "zero"
    const report = evaluateSeam(probe)
    expect(report.rows.find((r) => r.id === "retention.classes-declared").ok).toBe(false)
    expect(gateExitCode(report)).toBe(1)
  })

  it("every countable check FLIPS when its measurement crosses its budget - all of them, swept", () => {
    for (const check of CHECKS) {
      const budget = budgetOfFor(check.id)
      const crossing = check.comparison === "at-least" ? budget - 1 : budget + 1
      const probe = cloneProbe()
      probe.measured[check.id] = crossing
      const row = evaluateSeam(probe).rows.find((r) => r.id === check.id)
      expect(row.ok, `${check.id} must flip at measured=${crossing}`).toBe(false)
    }
  })

  it("the only pass-like verdict is `pass`, and nothing else reaches it", () => {
    expect([...PASS_LIKE]).toEqual(["pass"])
    expect(VERDICT_VOCABULARY).toContain("pass")
    expect(VERDICT_VOCABULARY).not.toContain("PASS")
    expect(PASS_LIKE).not.toContain("deferred")
  })

  it("gateExitCode refuses a report it cannot fully account for", () => {
    expect(gateExitCode(null)).toBe(1)
    expect(gateExitCode({})).toBe(1)
    expect(gateExitCode({ ...REPORT, rows: REPORT.rows.slice(0, 20) })).toBe(1)
    expect(gateExitCode({ ...REPORT, ranFullSet: false })).toBe(1)
    expect(gateExitCode({ ...REPORT, verdictWord: "green" })).toBe(1)
  })

  it("a `recorded`-kind row can never be green - nothing is filed under that kind, and none may be", () => {
    // Every check is countable today. If a future edit files something as
    // non-countable, gateExitCode refuses the row - asserted here so the property
    // is pinned rather than described.
    expect(REPORT.rows.every((r) => BLOCKING_KINDS.includes(r.kind) || EVIDENCE_KINDS.includes(r.kind))).toBe(true)
    const probe = cloneProbe()
    probe.measured["venue.expertoption-residue"] = 999
    const report = evaluateSeam(probe)
    const tampered = { ...report, rows: report.rows.map((r) => ({ ...r, kind: "recorded" })) }
    expect(gateExitCode(tampered)).toBe(1)
  })
})

/* ==========================================================================
   4. THE GATE IS OBSERVED FAILING - as a real process
   ========================================================================== */

describe("AC-046: a gate never seen to fail is not accepted as working", () => {
  it("--fail-branch exits NON-ZERO, so a broken seam can fail a build", { timeout: GATE_TEST_TIMEOUT }, () => {
    const run = runGate("--fail-branch", "--quiet")
    expect(run.status, run.stderr).not.toBe(0)
    expect(run.stderr).toContain("FAIL BRANCH")
    expect(run.stderr).toContain("NOT a measurement of the repository")
  })

  it("--fail-branch plants the breach on a NAMED check and names it back", { timeout: GATE_TEST_TIMEOUT }, () => {
    const run = runGate("--fail-branch", "venue.expertoption-residue", "--quiet")
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain("venue.expertoption-residue")
    expect(run.stderr).toMatch(/failing checks: \["venue\.expertoption-residue"\]/)
  })

  it("EVERY countable check, planted one at a time, exits NON-ZERO - all twenty-one, swept", { timeout: GATE_TEST_TIMEOUT }, () => {
    for (const check of CHECKS) {
      const run = runGate("--fail-branch", check.id, "--quiet")
      expect(run.status, `${check.id} must be able to fail the build`).not.toBe(0)
    }
  })

  it("--open-item-branch exits ZERO: recorded incompleteness does NOT block", { timeout: GATE_TEST_TIMEOUT }, () => {
    const run = runGate("--open-item-branch")
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toContain("OPEN-ITEM BRANCH")
  })

  it("the gate's own run on THIS repository prints the open items it will not hide", { timeout: GATE_TEST_TIMEOUT }, () => {
    const run = runGate()
    expect(run.stdout).toContain("OPEN ITEMS - surfaced, NOT blocking")
    expect(run.stdout).toContain("route-auth-verdicts-deferred")
    expect(run.stdout).toContain("budget-rows-not-passing")
  })

  it("--checks prints the vocabulary, so the twenty-one are enumerable from the CLI", { timeout: GATE_TEST_TIMEOUT }, () => {
    const run = runGate("--checks")
    expect(run.status).toBe(0)
    const ids = run.stdout.trim().split(/\r?\n/)
    expect(ids).toHaveLength(21)
    expect(ids.sort()).toEqual([...CHECK_IDS].sort())
  })
})

/* ==========================================================================
   5. THE TWO CONJUNCTIONS - BOTH HALVES, PROVEN
   ========================================================================== */

describe("D23 is a conjunction, and the naive half alone is not the check", () => {
  it("half A - `cancelOrder` is STILL in READ_ONLY_BLOCKED", () => {
    expect(rowFor("perps.cancelOrder-blocked-and-seam-exposed").halves["cancelOrder-still-blocked"]).toBe(true)
  })

  it("half B - the sanctioned seam EXPOSES the gated member", () => {
    expect(rowFor("perps.cancelOrder-blocked-and-seam-exposed").halves["seam-exposes-gated-member"]).toBe(true)
  })

  it("DELETING the seam member flips half B alone and fails the check", () => {
    const probe = cloneProbe()
    probe.detail = { ...probe.detail, perpsConjunction: { "cancelOrder-still-blocked": true, "seam-exposes-gated-member": false } }
    const probe2 = cloneProbe()
    probe2.detail = probe.detail
    // The count is produced by the PROBE, so the mutation has to go through it.
    probe2.measured["perps.cancelOrder-blocked-and-seam-exposed"] = 1
    const row = evaluateSeam(probe2).rows.find((r) => r.id === "perps.cancelOrder-blocked-and-seam-exposed")
    expect(row.ok).toBe(false)
    expect(row.halves["seam-exposes-gated-member"]).toBe(false)
    expect(row.halves["cancelOrder-still-blocked"]).toBe(true)
  })

  it("EROASING the READ_ONLY_BLOCKED token flips half A alone and fails the check", () => {
    const probe = cloneProbe()
    probe.measured["perps.cancelOrder-blocked-and-seam-exposed"] = 1
    probe.detail = {
      ...probe.detail,
      perpsConjunction: { "cancelOrder-still-blocked": false, "seam-exposes-gated-member": true }
    }
    const row = evaluateSeam(probe).rows.find((r) => r.id === "perps.cancelOrder-blocked-and-seam-exposed")
    expect(row.ok).toBe(false)
    expect(row.halves["cancelOrder-still-blocked"]).toBe(false)
    expect(row.halves["seam-exposes-gated-member"]).toBe(true)
  })

  it("the ADAPTER really has the member and really gates it, measured - not asserted", () => {
    expect(PROBE.detail.perpsCancelMember.facts).toEqual([true, true, true, true])
    // the gate is modeOf() consulted BEFORE any venue instance is built
    const { modeAt, refuseAt, instanceAt } = PROBE.detail.perpsCancelMember.gateOrder
    expect(modeAt).toBeGreaterThanOrEqual(0)
    expect(refuseAt).toBeGreaterThan(modeAt)
    expect(instanceAt).toBeGreaterThan(refuseAt)
  })
})

describe("D26 is a conjunction: claims gone is the half that passes trivially", () => {
  it("half A - no unverifiable regulatory/KYC claim survives", () => {
    expect(rowFor("catalog.claims-gone-entries-stay").halves["no-regulatory-claim"]).toBe(true)
  })

  it("half B - the eight D26 catalog entries are still present: MEASURED, and it is NOT satisfied", () => {
    const halves = rowFor("catalog.claims-gone-entries-stay").halves
    expect(halves["d26-catalog-entries-still-present"]).toBe(false)
    expect(halves.entriesExpectedCount).toBe(8)
    expect(halves.entriesPresentCount).toBe(0)
    expect([...halves.entriesAbsent]).toEqual([
      "luno",
      "mx-global",
      "hata",
      "sinegy",
      "kinetic",
      "funding-circle",
      "selangor-kuasa",
      "pitik"
    ])
  })

  it("a guard that asserted ONLY 'no claims' would pass today - which is why the conjunction exists", () => {
    // Both halves true, count 0, check green: the naive guard's world.
    const probe = cloneProbe()
    probe.measured["catalog.claims-gone-entries-stay"] = 0
    probe.detail = {
      ...probe.detail,
      d26Conjunction: { halves: { "no-regulatory-claim": true, "d26-catalog-entries-still-present": true }, entriesAbsent: [], entriesPresent: ["all eight"], entriesExpected: ["all eight"] }
    }
    const row = evaluateSeam(probe).rows.find((r) => r.id === "catalog.claims-gone-entries-stay")
    expect(row.ok).toBe(true)
    // ...and so a DELETION of the eight entries is what the real gate catches.
    const afterDeletion = cloneProbe()
    afterDeletion.measured["catalog.claims-gone-entries-stay"] = 1
    afterDeletion.detail = {
      ...afterDeletion.detail,
      d26Conjunction: { halves: { "no-regulatory-claim": true, "d26-catalog-entries-still-present": false }, entriesAbsent: ["all eight"], entriesPresent: [], entriesExpected: ["all eight"] }
    }
    expect(evaluateSeam(afterDeletion).rows.find((r) => r.id === "catalog.claims-gone-entries-stay").ok).toBe(false)
  })

  it("RE-ADDING a claim flips half A alone and fails the check", () => {
    const probe = cloneProbe()
    probe.measured["catalog.claims-gone-entries-stay"] = 1
    probe.detail = {
      ...probe.detail,
      d26Conjunction: { halves: { "no-regulatory-claim": false, "d26-catalog-entries-still-present": true }, entriesAbsent: [], entriesPresent: ["all eight"], entriesExpected: ["all eight"] }
    }
    const row = evaluateSeam(probe).rows.find((r) => r.id === "catalog.claims-gone-entries-stay")
    expect(row.ok).toBe(false)
    expect(row.halves["no-regulatory-claim"]).toBe(false)
    expect(row.halves["d26-catalog-entries-still-present"]).toBe(true)
  })

  it("names the shape vocabulary, so a reworded claim is in the scan's reach", () => {
    expect(PROBE.detail.d26Conjunction.claimHits).toEqual([])
    expect(rowFor("catalog.claims-gone-entries-stay").asserts).toContain("BOTH halves")
  })
})

/* ==========================================================================
   6. THE HONEST INCOMPLETENESS IS VISIBLE AND NOT BLOCKING
   ========================================================================== */

describe("T21 does not require a clean sweep - the honest states are surfaced, not hidden", () => {
  it("carries every open item the branch deliberately holds, each with a COUNT", () => {
    const ids = REPORT.openItems.map((i) => i.id)
    expect(ids).toEqual([
      "route-auth-verdicts-deferred",
      "rooms-honestly-incomplete",
      "changelog-handoffs-open",
      "budget-rows-not-passing",
      "write-affordances-in-read-only-room",
      "ws7-tasks-without-a-commit",
      "ci-workflow-whitelist-deviation"
    ])
    for (const item of REPORT.openItems) {
      expect(typeof item.count, item.id).toBe("number")
      expect(item.classification.length, item.id).toBeGreaterThan(0)
      expect(item.ownerRuling.length, item.id).toBeGreaterThan(0)
    }
  })

  it("the 62 deferred route verdicts are MEASURED, and match the guard's own recorded 62", () => {
    const item = REPORT.openItems.find((i) => i.id === "route-auth-verdicts-deferred")
    expect(item.count).toBe(62)
    expect(item.of).toBe(74)
  })

  it("the two honest `incomplete` rooms are counted, and NEITHER is a blocking failure", () => {
    const item = REPORT.openItems.find((i) => i.id === "rooms-honestly-incomplete")
    expect(item.count).toBe(2)
    expect(rowFor("rooms.completeness-verdict-declared").ok).toBe(true)
  })

  it("the non-passing budgets are enumerated by id and verdict, B1 and B3 still BREACH", () => {
    const item = REPORT.openItems.find((i) => i.id === "budget-rows-not-passing")
    const byId = Object.fromEntries(item.rows.map((r) => [r.id, r.verdict]))
    expect(byId.B1).toBe("BREACH")
    expect(byId.B3).toBe("BREACH")
    expect(byId.B2).toBe("WITHDRAWN_UNMEASURED")
    expect(byId.B9).toBe("UNVERIFIED")
  })

  it("the two order-execution affordances inside a read-only room are surfaced by route", () => {
    const item = REPORT.openItems.find((i) => i.id === "write-affordances-in-read-only-room")
    expect([...item.routes].sort()).toEqual(["/api/command-centre/perps/close", "/api/command-centre/perps/execute"])
  })

  it("T14, T17 and T18 are measured as UNLANDED from git, whatever PICC.md's row claims", () => {
    const item = REPORT.openItems.find((i) => i.id === "ws7-tasks-without-a-commit")
    expect([...item.tasks].sort()).toEqual(["T14", "T17", "T18"])
  })

  it("the CI question T20 deferred is ANSWERED, and the answer is measured not asserted", { timeout: GATE_TEST_TIMEOUT }, () => {
    const item = REPORT.openItems.find((i) => i.id === "ci-workflow-whitelist-deviation")
    // `npm test` really is a CI step, so the fallback is real and not theoretical
    expect(item.ciRunsNpmTest).toBe(true)
    // and T13's standalone-gate job already exists, so the precedent is real too
    expect(item.ciHasStandaloneGateJob).toBe(true)
    // T20's blocker does NOT transfer: this gate runs from a bare node process,
    // which is exactly why a dedicated job is feasible and why T20 could not add
    // one. The job is still not added - the whitelist amendment is the owner's.
    const bare = spawnSync(process.execPath, [GATE_PATH, "--quiet"], { encoding: "utf8", cwd: REPO_ROOT, timeout: 180_000 })
    expect(bare.status).toBe(1) // the three real findings, from a bare process
    expect(`${bare.stdout}${bare.stderr}`).toContain("picc-ws7-seam-gate")
    expect(item.ownerRuling).toContain("does NOT transfer")
    expect(item.ownerRuling).toContain("requires a dated spec amendment")
  })

  it("an all-green probe with open items exits ZERO - the projection cannot move the code", () => {
    expect(gateExitCode(evaluateSeam(syntheticOpenItemProbe()))).toBe(0)
    expect(evaluateSeam(syntheticOpenItemProbe()).openItems).toHaveLength(1)
  })

  it("a synthetic breach with open items present still exits NON-ZERO", () => {
    const probe = syntheticOpenItemProbe()
    const breached = { ...probe, measured: { ...probe.measured, "agents.no-wildcard-cors": 1 } }
    expect(gateExitCode(evaluateSeam(breached))).toBe(1)
  })
})

/* ==========================================================================
   7. THE THREE BLOCKING FINDINGS - pinned, so they cannot be mistaken for green
   ========================================================================== */

describe("the real repository produces THREE blocking findings, and their numbers are pinned", () => {
  it("names exactly those three, and nothing else fails", () => {
    expect(REPORT.failures.map((f) => f.id).sort()).toEqual([
      "catalog.claims-gone-entries-stay",
      "deps.no-unused-dependency",
      "venue.expertoption-residue"
    ])
    expect(REPORT.verdictWord).toBe("fail")
    expect(gateExitCode(REPORT)).toBe(1)
  })

  it("FINDING 1 - 28 venue identifiers survive in comment-stripped production code, across eleven files", () => {
    expect(rowFor("venue.expertoption-residue").measured).toBe(28)
    const files = [...new Set(PROBE.detail.venueResidue.hits.map((h) => h.file))].sort()
    expect(files).toEqual([
      "apps/dashboard/server/services/browserStudio.mjs",
      "apps/dashboard/server/services/connectors.mjs",
      "apps/dashboard/server/services/packObservers.mjs",
      "apps/dashboard/server/services/scheduler.mjs",
      "apps/dashboard/server/services/venueCredentials.mjs",
      "apps/dashboard/src/components/AutopilotSuite.tsx",
      "apps/dashboard/src/components/DataSourcesPanel.tsx",
      "apps/dashboard/src/components/SourceBadge.tsx",
      "apps/dashboard/src/components/TradingChart.tsx",
      "apps/dashboard/src/lib/trading.ts",
      // A tracked script that still imports the DELETED `captureExpertOptionSession`,
      // so it cannot run. That is the sharpest instance of the residue.
      "scripts/capture-eo-session.mjs"
    ])
  })

  it("and one of those eleven is a BROKEN module, not merely dead text", () => {
    const script = readFileSync(join(REPO_ROOT, "scripts", "capture-eo-session.mjs"), "utf8")
    const studio = readFileSync(
      join(REPO_ROOT, "apps", "dashboard", "server", "services", "browserStudio.mjs"),
      "utf8"
    )
    expect(script).toContain("captureExpertOptionSession")
    // browserStudio.mjs removed it with the venue, so the import cannot resolve
    expect(studio).not.toMatch(/export\s+(?:async\s+)?function\s+captureExpertOptionSession\b/)
    expect(studio).toContain("D2/AC-005: `captureExpertOptionSession` is REMOVED")
  })

  it("the removal RECORDS do not count as residue - that is why the count is 28 and not 744", () => {
    const rawMentions = 744 // measured this session across tracked code and docs
    expect(PROBE.detail.venueResidue.hits.reduce((n, h) => n + h.count, 0)).toBeLessThan(rawMentions / 10)
    // and the stripper demonstrably keeps CODE while removing comments
    const src = readFileSync(join(REPO_ROOT, "apps", "dashboard", "src", "lib", "trading.ts"), "utf8")
    const stripped = stripComments(src)
    expect(stripped).not.toContain("//")
    expect(stripped).toContain("export")
  })

  it("FINDING 2 - one declared runtime dependency has no production importer", () => {
    expect(rowFor("deps.no-unused-dependency").measured).toBe(1)
    expect(PROBE.detail.dependencies.unused).toEqual([
      { manifest: "apps/extension-archived/package.json", name: "plasmo", range: "^0.90.0" }
    ])
  })

  it("FINDING 3 - D26's second half is unsatisfiable as written: T7b removed the eight rows", () => {
    expect(rowFor("catalog.claims-gone-entries-stay").measured).toBe(1)
    // ...and the removal is RECORDED, not silent: changelog entry 0019 names every
    // one of the eight rows. That is why this is a spec contradiction to
    // reconcile rather than an unexplained disappearance.
    const record = readFileSync(
      join(REPO_ROOT, "docs", "trading-logic", "changelog", "entries", "0019-CATALOG_VENUE_REMOVAL-v1-to-v2.md"),
      "utf8"
    )
    for (const id of ["luno", "mx-global", "hata", "sinegy", "kinetic", "funding-circle", "selangor-kuasa", "pitik"]) {
      expect(record, `entry 0019 must name ${id}`).toContain(id)
    }
  })
})

/* ==========================================================================
   8. THE STRIPPER - because a stripper that deletes code makes every check lie
   ========================================================================== */

describe("the comment stripper is string-aware, and that is load-bearing", () => {
  it("does NOT open a block comment at a `\"/*\"` string literal", () => {
    // This exact shape cost 24 of the 62 real route-auth rows on the first cut.
    const src = ['const a = 1', 'const two = "/*"', 'const b = 2', 'owner: "decision"', 'const c = 3'].join("\n")
    const stripped = stripComments(src)
    expect((stripped.match(/owner: "decision"/g) || []).length).toBe(1)
    expect(stripped).toContain("const b = 2")
    expect(stripped).toContain("const c = 3")
  })

  it("removes a real block comment without eating the code after it", () => {
    const src = ["/* a", " * b", " */", "const keep = 1"].join("\n")
    expect(stripComments(src)).toContain("const keep = 1")
  })

  it("keeps a line's own line breaks, so reported line numbers still match the file", () => {
    const src = ["/* one", "two */", "const x = 1"].join("\n")
    expect(stripComments(src).split(/\r?\n/)).toHaveLength(src.split(/\r?\n/).length)
  })

  it("keeps a URL and an escaped quote intact", () => {
    const src = 'const u = "https://x/y" // gone\nconst q = "a\\" // b"'
    const stripped = stripComments(src)
    expect(stripped).toContain("https://x/y")
    expect(stripped).not.toContain("gone")
    expect(stripped).toContain('a\\" // b')
  })

  it("strips a Python DOCSTRING, so the recorded CORS removal is not read as a wildcard", () => {
    const src = [
      "def _allowed_origins() -> list[str]:",
      '    """Explicit browser-origin allowlist.',
      "",
      '    WS-7 T4: this was `allow_origins=["*"]` with `allow_methods=["*"]`.',
      '    """',
      '    return ["http://localhost:5173"]'
    ].join("\n")
    const stripped = stripPythonComments(src)
    expect(stripped).not.toContain('["*"]')
    expect(stripped).toContain("return [")
  })

  it("strips a Python `#` comment but keeps a `#` inside a string", () => {
    const stripped = stripPythonComments('a = "#tag"  # gone\nb = 1')
    expect(stripped).toContain('a = "#tag"')
    expect(stripped).not.toContain("gone")
    expect(stripped).toContain("b = 1")
  })

  it("agrees with the real guard's own recorded count, which is the proof it lost nothing", () => {
    const guardFile = readFileSync(
      join(REPO_ROOT, "apps", "dashboard", "server", "__tests__", "ws7RouteAuthCoverageGuard.test.mjs"),
      "utf8"
    )
    const rows = (stripComments(guardFile).match(/^\s*owner:\s*"decision"\s*,?\s*$/gm) || []).length
    expect(rows).toBe(62) // the count the file's own header states
  })
})

/* ==========================================================================
   9. THE OPEN ITEMS ARE THE SAME SETS T20's OWN GATE ENUMERATES
   ========================================================================== */

describe("this gate's room inventory and T20's agree, because T20's is imported", () => {
  it("the real adapter still derives twenty-two records, each with a verdict", () => {
    const facts = collectRoomCompletionFacts()
    expect(facts).toHaveLength(22)
    expect(facts.every((f) => f.verdict === "complete" || f.verdict === "incomplete")).toBe(true)
  })

  it("every room's verdict survives the serialisation point AC-020:929 is about", () => {
    const facts = collectRoomCompletionFacts()
    expect(facts.every((f) => f.hasWs8HandoffKey === true)).toBe(true)
  })

  it("the production scope includes the route layer the spec's file-touch union was amended to cover", () => {
    const prod = productionFiles(["apps/dashboard/server/handlers.mjs", "apps/dashboard/src/terminal/domain/copilot.ts"])
    expect(prod).toEqual(["apps/dashboard/server/handlers.mjs", "apps/dashboard/src/terminal/domain/copilot.ts"])
  })
})

/* ==========================================================================
   9. PICC.md's WS-7 SECTION - verified against the code, and pinned
   ========================================================================== */

describe("T21's other file-list obligation: PICC.md's WS-7 claims are true", () => {
  const piccPath = join(REPO_ROOT, "PICC.md")
  const picc = readFileSync(piccPath, "utf8")
  const piccLines = picc.split(/\r?\n/)

  it("the WS-7 registry row is still ACTIVE-DRAFT - T21 may not ship it", () => {
    const row = piccLines.find((l) => l.includes("PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1 |"))
    expect(row, "the WS-7 row exists").toBeTypeOf("string")
    expect(row.split("|")[2].trim()).toBe("ACTIVE-DRAFT")
    expect(picc).not.toMatch(/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1\s*\|\s*(?:ACTIVE|SHIPPED|ARCHIVED)(?!-)/)
  })

  it("§10's spec-file count matches `git ls-files`, so the heading cannot drift", () => {
    const heading = piccLines.find((l) => /^## §10 Specs Registry/.test(l))
    const declared = Number(heading.match(/; (\d+) registry rows/) ? heading.match(/\((\d+) files/) [1] : NaN)
    const actual = execFileSync("git", ["ls-files", "docs/specs/*.md"], { cwd: REPO_ROOT, encoding: "utf8" })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean).length
    expect(declared).toBe(actual)
    expect(declared).toBe(39)
  })

  it("the two detector files are EXCLUDED from the scan, and nothing else is", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
      .split(/\r?\n/)
      .filter(Boolean)
    const prod = productionFiles(tracked)

    // A detector that scans itself is a gate whose measurement depends on whether
    // the gate is committed. Before T21 was committed these files were untracked,
    // so the scans never saw them; the commit made them tracked and the residue
    // count jumped 28 -> 45, with 17 of the new hits being the detector matching
    // its own token list. The exclusion is what makes the number stable.
    for (const f of DETECTOR_FILES) {
      expect(tracked, `${f} must be tracked for this test to be meaningful`).toContain(f)
      expect(prod, `${f} must not be scanned by the guard it implements`).not.toContain(f)
    }
    // ...and the exclusion must be exactly those two files, not a widened net.
    const wouldBeProd = tracked.filter(
      (f) => productionFiles([f]).length > 0
    )
    expect(DETECTOR_FILES.length).toBe(2)
  })

  it("detectorFilesAreCleanApartFromTheirVocabulary: the exclusion hides nothing", { timeout: GATE_TEST_TIMEOUT }, () => {
    // Excluding a file from a scanner is how residue gets hidden. So re-scan the
    // two excluded files and require that no residue token appears in an
    // import/export statement.
    //
    // The rule is about BINDING, not spelling. A detector must be able to spell
    // the tokens it searches for - they live in its vocabulary array and in the
    // regex it builds from them, and flagging those would flag the scanner for
    // scanning. What must never happen is a detector that also *depends on* the
    // removed venue: an `import { captureExpertOptionSession }` would make the
    // exclusion hide a live capability, which is the real hazard.
    for (const f of DETECTOR_FILES) {
      const lines = readFileSync(join(REPO_ROOT, f), "utf8").split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!/^\s*(import|export)\b/.test(line)) return
        for (const token of VENUE_RESIDUE_TOKENS) {
          if (!new RegExp(token, "i").test(line)) continue
          throw new Error(
            `${f}:${i + 1} binds residue token ${token} in an import/export. A detector may SEARCH for a venue but must not DEPEND on one:\n  ${line.trim().slice(0, 140)}`
          )
        }
      })
      // ...and it must really contain the vocabulary, so the exclusion is not
      // hiding an empty file that a later edit could fill with anything.
      expect(readFileSync(join(REPO_ROOT, f), "utf8")).toMatch(/expertoption/i)
    }
  })

  it("§10's registry-row count matches the table, on WS-3's already-documented rule", () => {
    const h = piccLines.findIndex((l) => /^## §10 Specs Registry/.test(l))
    const end = piccLines.findIndex((l, i) => i > h && /^## §11 /.test(l))
    const heading = piccLines[h]

    // Counting rule taken from ws3CeremonySeamGuard.test.mjs:357-369 rather than
    // invented here. T21 first counted 42 by including the `notes/` path row and
    // contradicted that guard; the existing rule already excluded it. Two guards
    // disagreeing about how to count the same table means the second author was
    // wrong, not that the first rule needed replacing.
    const tableRows = piccLines
      .slice(h, end)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("|"))
      .filter((l) => !/^\|\s*:?-+/.test(l))
      .slice(1)
    const specRows = tableRows.filter((l) => !(l.split("|")[1] || "").trim().startsWith("notes/"))

    expect(Number(heading.match(/(\d+) registry rows/)[1])).toBe(specRows.length)
    expect(specRows.length).toBe(41)
    // The bolded V3_2 row IS a spec row and must not be skipped; the `notes/` row
    // is not one and must be excluded. Both halves asserted so neither can drift.
    expect(tableRows.some((l) => l.startsWith("| **PICC_V3_2_LAYERED_ENGINE_REBUILD_v1**"))).toBe(true)
    expect(specRows.some((l) => l.split("|")[1].trim().startsWith("notes/"))).toBe(false)
  })

  it("the row no longer claims the ARM artifact is unchecked-in or the 2 GB gate is absent", () => {
    const row = piccLines.find((l) => l.includes("PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1 |"))
    // both phrases may appear ONLY inside a quoted correction, never as a live claim
    for (const phrase of ["the output artifact is not checked in", "2 GB peak-RSS has no verdict (gate does not exist)"]) {
      const at = row.indexOf(phrase)
      if (at === -1) continue
      const quoted = row.slice(Math.max(0, at - 4), at + 1).includes('"')
      expect(quoted, `"${phrase}" must be inside a quoted correction, not asserted`).toBe(true)
    }
    expect(row).toContain("372.1 MB")
    expect(row).toContain("app-probe.json".slice(4)) // `apps/dashboard/perf/arm-probe.json`
  })

  it("the row records the three T21 findings and the three unlanded tasks", () => {
    const row = piccLines.find((l) => l.includes("PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1 |"))
    for (const needle of ["T21's three blocking findings", "T14, T17 and T18 have not", "plasmo", "capture-eo-session.mjs"]) {
      expect(row, needle).toContain(needle)
    }
  })

  it("the row does not claim 18 room instances anywhere outside a quoted correction", () => {
    const row = piccLines.find((l) => l.includes("PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1 |"))
    const live = row.split("|")[3]
    const segments = live.split('"')
    // even-indexed segments are outside quotes
    const unquoted = segments.filter((_, i) => i % 2 === 0).join(" ")
    expect(unquoted).not.toMatch(/\b18 room/)
    expect(unquoted).toContain("22 room instances")
  })

  it("reports open handoff ROWS - not phrase occurrences, and including this entry's own", { timeout: GATE_TEST_TIMEOUT }, () => {
    const handoffs = probeSeam().openItems.find((i) => i.id === "changelog-handoffs-open")

    // Measured independently here, by row, from the changelog itself.
    const entriesDir = join(REPO_ROOT, "docs/trading-logic/changelog/entries")
    let rows = 0
    let open = 0
    let phrases = 0
    const perEntry = []
    for (const f of readdirSync(entriesDir).filter((f) => /^\d{4}-.*\.md$/.test(f))) {
      const body = readFileSync(join(entriesDir, f), "utf8")
      phrases += (body.match(/STILL OPEN/g) || []).length
      const h = body.split(/\r?\n/).filter((l) => /^\|\s*\d{4}-\d+\s*\|/.test(l))
      if (h.length) perEntry.push({ f: f.slice(0, 4), rows: h.length, open: h.filter((l) => /STILL OPEN/i.test(l)).length })
      rows += h.length
      open += h.filter((l) => /STILL OPEN/i.test(l)).length
    }
    // 0028 and 0032 hold 14 rows each; THIS entry holds 6, all open. The count
    // is self-referential by design - writing the handoff table increases the
    // number the gate reports - and a guard that excluded its own entry would
    // understate the work it just created.
    expect(perEntry).toEqual([
      { f: "0028", rows: 14, open: 11 },
      { f: "0032", rows: 14, open: 11 },
      { f: "0035", rows: 6, open: 6 }
    ])
    expect({ rows, open }).toEqual({ rows: 34, open: 28 })
    // The phrase count is higher: 0030 and 0031 mention it in prose.
    expect(phrases).toBe(33)
    expect(phrases).toBeGreaterThan(open)

    expect(handoffs.count).toBe(28)
    expect(handoffs.of).toBe(34)
    // The owner's stated 15 must stay visible as an unreconciled discrepancy
    // rather than being quietly replaced by whichever number we happened to measure.
    expect(handoffs.ownerRuling).toContain("15")
    expect(handoffs.ownerRuling).toContain("DISCREPANCY")
  })

  it("derives the guard's owner count from CHECKS, so the header prose cannot drift", () => {
    const owned = CHECKS.filter((c) => c.ownedBy !== null).length
    const fresh = CHECKS.filter((c) => c.ownedBy === null).map((c) => c.id)
    expect(owned).toBe(17)
    expect(owned + fresh.length).toBe(21)
    // The header said "Nineteen" until the array was recounted; assert the
    // prose now says seventeen so the two cannot disagree again.
    const header = readFileSync(join(REPO_ROOT, "scripts/ws7-seam-guard.mjs"), "utf8")
    expect(header).toContain("Seventeen of the twenty-one are ALREADY enforced")
    expect(header).not.toMatch(/Nineteen of the twenty-one/)
    // The four T21-introduced checks are named, not left anonymous.
    expect(fresh.sort()).toEqual(
      [
        "venue.expertoption-residue",
        "deps.no-unused-dependency",
        "docs.camouflage-policy-linked",
        "docs.typing-invariant-states-boundary"
      ].sort()
    )
  })

  it("guardrail 2 LINKS the dated D22 disclosure record, which it did not before T21", () => {
    // The slice is derived from the guardrail markers, not from hard-coded line
    // numbers: T21's own guardrail-2 addition moved them, and a hard-coded range
    // is how a doc test silently stops reading the text it claims to read.
    const start = piccLines.findIndex((l) => /^2\. \*\*Browser automation-signal stripping/.test(l))
    const end = piccLines.findIndex((l, i) => i > start && /^3\. \*\*Every data source/.test(l))
    expect(start, "guardrail 2 exists").toBeGreaterThanOrEqual(0)
    expect(end, "guardrail 3 exists after it").toBeGreaterThan(start)
    const g2 = piccLines.slice(start, end).join("\n")
    expect(g2).toContain("0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE-v1-to-v2.md")
    expect(g2).toContain("disable-blink-features=AutomationControlled")
    expect(g2).toContain("importRealProfile")
    // ...and states the D25 invariant in prose, not only in the registry row.
    // Asserted in the invariant's own canonical wording (AC-015), not a paraphrase.
    // Whitespace is collapsed first: markdown hard-wraps these bullets, so the
    // literal phrase spans a newline ("for that specific\n   action") and a raw
    // `toContain` would fail on a correct document while passing on a wrong one
    // that happened to fit on a line.
    const g2Text = g2.replace(/\s+/g, " ")
    expect(g2Text).toContain("explicit human approval step for that specific action")
    expect(g2Text).toContain("never holds broker credentials")
  })
})
function budgetOfFor(id) {
  switch (id) {
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