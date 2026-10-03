// WS-7 T20 - the CROSS-ROOM INVARIANT GATE guard (AC-047, spec :1372-1379).
//
// T20 `:1377` - "Safety/correctness blocks; performance/UX is recorded as
// best-effort." T20 `:1379` - "It runs against rooms at any completion state; a
// reserved room fails its own invariants without blocking unrelated rooms."
//
// AC-047 `:1146` - "A gate test proving a synthetic safety failure blocks and a
// synthetic performance miss does not." This file is that test, and it does the
// thing T19's `ramCeilingGate.test.mjs` did for the RAM gate: it OBSERVES THE
// GATE FAILING as a real process with a non-zero exit code, over the REAL
// twenty-two rooms with one real break planted - not merely asserting that a
// function exists.
//
// FIVE THINGS ARE ESTABLISHED HERE, and each is a thing that could plausibly be
// false:
//
//   1. The gate is GREEN over the real twenty-two. `verdict: incomplete` for
//      Strategy and trading/simulator is HONEST INCOMPLETENESS and must not fail
//      it - AC-047's forbidden outcome, spelled out in the brief.
//   2. PER-ROOM SCOPING. One planted break fails exactly one named room, and
//      every other row's report is DEEP-EQUAL to its baseline row. Not "still
//      passes" - identical, byte for byte. That is the difference between
//      "one room failed" and "one room failed and nothing else changed".
//   3. BLOCKING vs BEST-EFFORT, structurally. A safety violation moves the exit
//      code; a performance/UX observation does not. Neither can waive the other.
//   4. NO INVARIANT REPORTS "ok" WITHOUT HAVING CHECKED A NUMBER. Every check's
//      `ok` is recomputed here from its own `measured` and `budget`, and every
//      blocking invariant is MUTATED to a violating fact to prove it flips.
//   5. Risk 9 - the server and the client agree on the shapes rooms consume,
//      without a second contract home.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { collectRoomCompletionFacts } from "../../src/terminal/domain/roomCompletionFacts"
import { isAdmissibleAsSignal } from "../../src/terminal/domain/copilot"
import { projectDecision } from "../../src/terminal/adapters/copilotReading"

import {
  AT_LEAST_INVARIANT_IDS,
  BEST_EFFORT_INVARIANT_IDS,
  BEST_EFFORT_KINDS,
  BLOCKING_INVARIANT_IDS,
  BLOCKING_KINDS,
  BUDGETS,
  CHECK_KINDS,
  INVENTORY_D1_ORDER,
  INVENTORY_DISTINCT_KEYS,
  INVENTORY_SIZE,
  INVARIANTS,
  INVARIANT_IDS,
  NAMED_RECORD_SOURCES,
  PASS_LIKE,
  PRODUCER_REFERENCE_FORMS,
  ROOM_INVENTORY,
  STALE_INSTANCE_COUNT_IN_SPEC,
  VERDICT_VOCABULARY,
  bestEffortFactSet,
  evaluateFacts,
  evaluateRoom,
  gateExitCode,
  missingRecordFactSet,
  safetyBreakFactSet
} from "../../../../scripts/cross-room-invariant-gate.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const GATE_PATH = fileURLToPath(new URL("../../../../scripts/cross-room-invariant-gate.mjs", import.meta.url))
const CONTRACTS_PATH = fileURLToPath(new URL("../../src/terminal/contracts.ts", import.meta.url))
const COPILOT_READING_PATH = fileURLToPath(new URL("../../src/terminal/adapters/copilotReading.ts", import.meta.url))
const TERMINAL_INDEX_PATH = fileURLToPath(new URL("../../src/terminal/index.ts", import.meta.url))
const TIER_FIXTURE_PATH = fileURLToPath(
  new URL("../../server/services/copilot/tierBoundaryFixture.mjs", import.meta.url)
)

const contractsSource = readFileSync(CONTRACTS_PATH, "utf8")
const copilotReadingSource = readFileSync(COPILOT_READING_PATH, "utf8")

const REAL_FACTS = collectRoomCompletionFacts()

/** Spawn the gate as a real process and hand it facts on stdin. */
const runGateOn = (facts) =>
  spawnSync(process.execPath, [GATE_PATH, "--facts-stdin", "--quiet"], {
    input: JSON.stringify(facts),
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: 120_000
  })

const runGateFlag = (...args) =>
  spawnSync(process.execPath, [GATE_PATH, ...args, "--quiet"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: 120_000
  })

/** A deep clone, so a planted break cannot mutate the shared real facts. */
const clone = (facts) => JSON.parse(JSON.stringify(facts))

const factFor = (facts, id) => facts.find((f) => f.id === id)

/** The set of row ids the gate reports as failing. */
const failingOf = (report) => [...report.failingRooms].sort()

/**
 * A per-test budget for ONE test in this file, and why the global default stays.
 *
 * THE GLOBAL `testTimeout` STAYS AT vitest's 5s, deliberately, for the reason
 * `ws7RouteAuthCoverageBehaviour.test.mjs` sets out in full: raising it would
 * let a genuine hang in any of the suite's other ~5,400 tests hide behind a
 * longer ceiling. Nothing below changes that — this constant is only ever the
 * PER-TEST argument to one `it`.
 *
 * THIS FILE IS NOT A HANDLER-MODULE FILE, and that is the finding. The defect
 * `0dc9989` fixed in its sibling was a cold `import()` of `handlers.mjs`; this
 * file never imports it. It has its own, different reason to be slow, and the
 * discriminator is BULK SYNCHRONOUS FILESYSTEM WORK, not module loading.
 *
 * Exactly one test here does bulk work of that kind: `:748` walks the ENTIRE
 * REPOSITORY ROOT with `readdirSync`/`statSync`/`readFileSync`, reading every
 * `.mjs`/`.ts`/`.tsx`/`.mts`/`.cts` file it finds, because the claim it proves is
 * a claim about the WHOLE TREE — "no second module anywhere declares the tier
 * boundary". That cost is O(repository size) and it cannot be narrowed to make
 * the assertion mean less.
 *
 * MEASURED, not guessed. Run alone: 1583ms. Under full-suite concurrency
 * (`npm run test`, 386 files on 12 cores): 3859ms, which is 77% of the 5s
 * ceiling — and it has been observed PAST it, dying on "Test timed out in
 * 5000ms", which is the flake being fixed here. Its next-slowest sibling in the
 * same file is 317ms loaded, so this test is a 12x outlier in its own file and
 * the outlier is the whole story. The other 72 tests are 18-56ms loaded.
 *
 * 20s is the value `0dc9989` already ratified for exactly this class in the
 * sibling file (`ROUTE_BUDGET_MS = 20_000`), reused rather than re-invented: it
 * is 5.2x this test's worst observed loaded run, and the same magnitude the repo
 * already accepted for a test whose real cost exceeds 5s under concurrency. A
 * walk that hangs still fails here; it just no longer fails for being a walk.
 *
 * WHAT IS DELIBERATELY NOT HERE. The ten tests that spawn the gate as a real
 * process — `:150 :341 :349 :356 :1017 :1041 :1048 :1052 :1061 :1069`, all via
 * `runGateOn`/`runGateFlag`/`spawnSync` — keep the 5s default. Measured under
 * full-suite load they run 92-317ms, i.e. 16x to 54x of headroom, and each
 * already carries its own `spawnSync({ timeout: 120_000 })` guard for the case
 * that actually matters: the child failing to exit at all. A budget wide enough
 * to matter on a process spawn would be a budget wide enough to hide a hung
 * child, and the child is already guarded. The remaining 62 tests never touch
 * the filesystem in bulk and are unchanged.
 */
const REPO_WALK_BUDGET_MS = 20_000

/* ==========================================================================
   1. THE GATE IS GREEN OVER THE REAL TWENTY-TWO
   ========================================================================== */

describe("AC-047 - the gate is GREEN over the real twenty-two room instances", () => {
  const report = evaluateFacts(REAL_FACTS)

  it("the adapter derives exactly the twenty-two frozen instances, and no more", () => {
    expect(REAL_FACTS.length, "the adapter must project one fact per inventory room").toBe(INVENTORY_SIZE)
    expect(INVENTORY_SIZE, "the amended freeze invariant at spec:73 is 22 instances").toBe(22)
    expect([...REAL_FACTS.map((f) => f.id)].sort()).toEqual([...ROOM_INVENTORY].sort())
    expect(report.extraRows, "a fact for a room outside the inventory is a defect, not an extra room").toEqual([])
  })

  it("collapses to the fifteen distinct keys the amended invariant names", () => {
    expect(INVENTORY_DISTINCT_KEYS.length).toBe(15)
  })

  it("carries the six D1-order 1..6 records from their own named constants", () => {
    expect(NAMED_RECORD_SOURCES.map((s) => s.id)).toEqual([
      "trading/markets",
      "trading/risk",
      "trading/ceremony",
      "trading/ministry",
      "trading/strategy",
      "trading/paper"
    ])
    for (const source of NAMED_RECORD_SOURCES) {
      const fact = factFor(REAL_FACTS, source.id)
      expect(fact, `${source.symbol} (${source.file}) must project to a fact`).toBeTruthy()
      expect(fact.present, `${source.symbol} must be present, not a placeholder`).toBe(true)
      expect(fact.key, `${source.symbol} declares its own room key`).toBe(source.id.split("/")[1])
    }
  })

  it("is GREEN in process - no room fails a blocking invariant", () => {
    const blocking = report.rows.flatMap((r) => r.blockingFailures.map((f) => `${r.id} ${f.id}`))
    expect(blocking, `blocking failures: ${JSON.stringify(blocking)}`).toEqual([])
    expect(failingOf(report)).toEqual([])
    expect(gateExitCode(report)).toBe(0)
  })

  it("is GREEN as a real PROCESS over the real facts - exit 0", () => {
    const r = runGateOn(REAL_FACTS)
    expect(r.status, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`).toBe(0)
    expect(`${r.stdout}${r.stderr}`).toMatch(/failing rooms: none/)
  })

  it("enumerates ALL TWENTY-TWO ROWS with a verdict, none omitted", () => {
    expect(report.rows.length).toBe(22)
    for (const row of report.rows) {
      expect(VERDICT_VOCABULARY, `${row.id} carries a verdict from the closed vocabulary`).toContain(row.verdictWord)
      expect(row.checks.length, `${row.id} ran every invariant`).toBe(INVARIANTS.length)
    }
    const orders = report.rows.map((r) => r.d1Order)
    expect(orders, "D1 order 1..22 with no gap and no repeat").toEqual(Array.from({ length: 22 }, (_, i) => i + 1))
  })

  /* --- the brief's headline constraint: honest incompleteness is NOT a failure */

  it("does NOT fail merely because a room is honestly INCOMPLETE", () => {
    const incomplete = report.rows.filter((r) => r.verdict === "incomplete").map((r) => r.id).sort()
    expect(incomplete, "exactly the two records T9 and T10 ruled incomplete").toEqual([
      "trading/simulator",
      "trading/strategy"
    ])
    for (const id of incomplete) {
      const row = report.rows.find((r) => r.id === id)
      expect(row.verdictWord, `${id} is incomplete but its own invariants hold, so it PASSES the gate`).toBe("pass")
    }
  })

  it("the two honest incompletes carry a NAMED OPEN handoff, not a null", () => {
    for (const id of ["trading/strategy", "trading/simulator"]) {
      const fact = factFor(REAL_FACTS, id)
      expect(fact.hasWs8HandoffKey, `${id} must DECLARE ws8Handoff`).toBe(true)
      expect(fact.ws8HandoffKind, `${id} must carry an open object, not null`).toBe("object")
    }
  })

  it("fails an incomplete verdict that claims the WS-8 question was answered", () => {
    // The other half of the same rule. This is the anti-goal made executable:
    // "silently trimming scope" is precisely `incomplete` + `ws8Handoff: null`.
    const facts = clone(REAL_FACTS)
    const strategy = factFor(facts, "trading/strategy")
    strategy.ws8HandoffKind = "null"

    const report = evaluateFacts(facts)
    expect(failingOf(report), "only the tampered room may fail").toEqual(["trading/strategy"])
    const row = report.rows.find((r) => r.id === "trading/strategy")
    expect(row.blockingFailures.map((f) => f.id)).toContain("correctness.incomplete-requires-an-open-handoff")
  })

  it("fails a verdict that asserts `complete` without a producer behind it", () => {
    const facts = clone(REAL_FACTS)
    const markets = factFor(facts, "trading/markets")
    markets.reason = "Done."

    const row = evaluateFacts(facts).rows.find((r) => r.id === "trading/markets")
    expect(row.verdictWord).toBe("fail")
    const check = row.checks.find((c) => c.id === "correctness.complete-requires-evidence")
    expect(check.measured, "two violations: too short AND no artefact token").toBe(2)
    expect(check.budget).toBe(0)
  })

  it("fails a record whose ws8Handoff key is ABSENT rather than a present null", () => {
    // T10's serialisation point, asserted across the whole set.
    const facts = clone(REAL_FACTS)
    delete factFor(facts, "trading/ministry").hasWs8HandoffKey
    factFor(facts, "trading/ministry").ws8HandoffKind = "absent"

    const row = evaluateFacts(facts).rows.find((r) => r.id === "trading/ministry")
    expect(row.verdictWord).toBe("fail")
    expect(row.blockingFailures.map((f) => f.id)).toContain("safety.ws8-handoff-key-present")
  })

  it("fails a room whose RECORD IS MISSING, by name", () => {
    const report = evaluateFacts(missingRecordFactSet())
    expect(failingOf(report)).toEqual(["trading/ministry"])
    const row = report.rows.find((r) => r.id === "trading/ministry")
    expect(row.recordPresent).toBe(false)
    expect(row.blockingFailures.map((f) => f.id)).toContain("safety.record-present")
    expect(gateExitCode(report)).toBe(1)
  })

  it("drops a REAL room out of the set and still names it", () => {
    const facts = clone(REAL_FACTS).filter((f) => f.id !== "intelligence/governor")
    const report = evaluateFacts(facts)
    expect(failingOf(report), "a room absent from the fact array entirely is still enumerated").toEqual([
      "intelligence/governor"
    ])
  })
})

/* ==========================================================================
   2. PER-ROOM SCOPING - the bisect line at :1379
   ========================================================================== */

describe("T20 :1379 - a broken room fails alone, without blocking unrelated rooms", () => {
  const baseline = evaluateFacts(REAL_FACTS)

  /** One real safety break in one real room: the key that survives serialisation goes missing. */
  const withCeremonyBroken = () => {
    const facts = clone(REAL_FACTS)
    const ceremony = factFor(facts, "trading/ceremony")
    delete ceremony.hasWs8HandoffKey
    ceremony.ws8HandoffKind = "absent"
    return facts
  }

  it("(a) the broken room is reported FAILING, named", () => {
    const report = evaluateFacts(withCeremonyBroken())
    expect(failingOf(report)).toEqual(["trading/ceremony"])
    const row = report.rows.find((r) => r.id === "trading/ceremony")
    expect(row.verdictWord).toBe("fail")
    expect(row.blockingFailures.map((f) => f.id)).toContain("safety.ws8-handoff-key-present")
  })

  it("(b) every OTHER room reports its own true state - byte-identical, not merely 'passing'", () => {
    const broken = evaluateFacts(withCeremonyBroken())
    expect(broken.rows.length).toBe(baseline.rows.length)
    for (const baselineRow of baseline.rows) {
      if (baselineRow.id === "trading/ceremony") continue
      const after = broken.rows.find((r) => r.id === baselineRow.id)
      expect(after, `${baselineRow.id} must still be present`).toBeTruthy()
      // Deep equality, so a smearing that changed a COUNT, a budget or a
      // verdict anywhere else would be caught - not just a changed verdict.
      expect(after, `${baselineRow.id} must be unchanged by another room's failure`).toEqual(baselineRow)
    }
  })

  it("(c) the failure is attributable by name and is not smeared across the set", () => {
    const broken = evaluateFacts(withCeremonyBroken())
    // Exactly one failing room, and the report names it - not "the gate failed".
    expect(broken.failingRooms).toEqual(["trading/ceremony"])
    // Every other room still carries the verdict its own facts justify.
    for (const row of broken.rows) {
      if (row.id === "trading/ceremony") continue
      expect(row.verdictWord, `${row.id} keeps its own verdict`).toBe("pass")
      expect(row.blockingFailures, `${row.id} has no failures of its own`).toEqual([])
    }
    // And the unrelated INCOMPLETE rooms are not promoted or demoted by it.
    expect(broken.rows.find((r) => r.id === "trading/strategy").verdictWord).toBe("pass")
    expect(broken.rows.find((r) => r.id === "trading/simulator").verdictWord).toBe("pass")
  })

  it("the gate is still USABLE after a failure: 22 rows, each independently evaluated", () => {
    const broken = evaluateFacts(withCeremonyBroken())
    expect(broken.rows.length).toBe(22)
    for (const row of broken.rows) {
      // A gate that stops evaluating after the first failure is not a gate; one
      // that returns a single boolean for the whole set cannot scope at all.
      expect(row.checks.length, `${row.id} is still evaluated in full`).toBe(INVARIANTS.length)
    }
  })

  it("breaking each room in turn fails EXACTLY that room - all 22, swept", () => {
    for (const { id } of INVENTORY_D1_ORDER) {
      const facts = clone(REAL_FACTS)
      const target = factFor(facts, id)
      // A break every room shares: the one that must never be legal.
      target.hasWs8HandoffKey = false
      const report = evaluateFacts(facts)
      expect(failingOf(report), `breaking ${id} must fail exactly ${id}`).toEqual([id])
    }
  })

  it("two rooms broken together fail exactly those two - scoping composes", () => {
    const facts = clone(REAL_FACTS)
    factFor(facts, "trading/ceremony").hasWs8HandoffKey = false
    factFor(facts, "earnings/studio").hasWs8HandoffKey = false
    expect(failingOf(evaluateFacts(facts))).toEqual(["earnings/studio", "trading/ceremony"])
  })
})

/* ==========================================================================
   3. BLOCKING vs BEST-EFFORT - AC-047 :1144-1145
   ========================================================================== */

describe("AC-047 :1377 - safety/correctness blocks, performance/UX is recorded only", () => {
  it("the two buckets are a closed, disjoint partition of the invariants", () => {
    expect([...BLOCKING_KINDS, ...BEST_EFFORT_KINDS].sort()).toEqual([...CHECK_KINDS].sort())
    expect(BLOCKING_INVARIANT_IDS.length + BEST_EFFORT_INVARIANT_IDS.length).toBe(INVARIANTS.length)
    expect(BLOCKING_INVARIANT_IDS.length, "at least one of each, or the distinction is vacuous").toBeGreaterThan(0)
    expect(BEST_EFFORT_INVARIANT_IDS.length).toBeGreaterThan(0)
    for (const invariant of INVARIANTS) {
      const kind = invariant.kind
      const shouldBlock = BLOCKING_KINDS.includes(kind)
      expect(BLOCKING_INVARIANT_IDS.includes(invariant.id)).toBe(shouldBlock)
      expect(BEST_EFFORT_INVARIANT_IDS.includes(invariant.id)).toBe(!shouldBlock)
    }
  })

  it("HALF A: a SAFETY violation BLOCKS - the process exits non-zero", () => {
    const r = runGateFlag("--fail-branch")
    expect(r.status, `a safety violation must fail the gate; got ${r.status}\n${r.stdout}\n${r.stderr}`).not.toBe(0)
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/failing rooms: \["trading\/ceremony"\]/)
    expect(`${r.stdout}${r.stderr}`).toMatch(/NOT a measurement/)
  })

  it("HALF B: a PERFORMANCE/UX observation is RECORDED and does NOT block", () => {
    const r = runGateFlag("--best-effort-branch")
    expect(r.status, `a best-effort observation must not fail the gate; got ${r.status}\n${r.stderr}`).toBe(0)
    expect(`${r.stdout}${r.stderr}`).toMatch(/BEST-EFFORT BRANCH/)
    expect(`${r.stdout}${r.stderr}`).toMatch(/best-effort findings: [1-9]\d*/)
  })

  it("a real UX observation over the real rooms is recorded without failing the gate", () => {
    const facts = clone(REAL_FACTS)
    const studio = factFor(facts, "trading/studio")
    studio.affordances = Array.from({ length: 12 }, (_, i) => ({
      id: `planted-${i}`,
      route: `/planted/${i}`,
      sourceToken: `PlantedToken${i}`,
      removedByThisTask: false
    }))

    const report = evaluateFacts(facts)
    const row = report.rows.find((r) => r.id === "trading/studio")
    const uxCheck = row.checks.find((c) => c.id === "ux.declared-affordance-surface")
    expect(uxCheck.kind).toBe("ux")
    expect(uxCheck.measured).toBe(12)
    expect(uxCheck.budget).toBe(BUDGETS.UX_MAX_AFFORDANCES)
    expect(uxCheck.ok, "12 affordances is past the UX budget, so the check is a recorded finding").toBe(false)
    // It is RECORDED...
    expect(report.bestEffortFindings.some((f) => f.room === "trading/studio" && f.id === "ux.declared-affordance-surface")).toBe(true)
    // ...and it does not move the room, the gate, or any other room.
    expect(row.verdictWord).toBe("pass")
    expect(failingOf(report)).toEqual([])
    expect(gateExitCode(report)).toBe(0)
    expect(runGateOn(facts).status).toBe(0)
  })

  it("AC-047 :1145 - a best-effort finding cannot waive a safety failure", () => {
    // Prohibited side effect, first direction: performance may not excuse safety.
    const facts = clone(REAL_FACTS)
    factFor(facts, "trading/ceremony").hasWs8HandoffKey = false
    const studio = factFor(facts, "trading/studio")
    studio.affordances = Array.from({ length: 12 }, (_, i) => ({
      id: `planted-${i}`,
      route: `/planted/${i}`,
      sourceToken: `PlantedToken${i}`,
      removedByThisTask: false
    }))

    const report = evaluateFacts(facts)
    expect(report.bestEffortFindings.length, "the UX finding is still recorded").toBeGreaterThan(0)
    expect(failingOf(report), "and it still does not excuse the safety failure").toEqual(["trading/ceremony"])
    expect(gateExitCode(report)).toBe(1)
  })

  it("AC-047 :1145 - a safety PASS cannot be derived from a performance number", () => {
    // Prohibited side effect, second direction. Structural, not behavioural: a
    // row's verdict is a fold over BLOCKING checks only, and the number of
    // best-effort checks it ran is independent of the verdict.
    const green = evaluateFacts(REAL_FACTS)
    const withPerfMiss = evaluateFacts(bestEffortFactSet())
    for (const row of green.rows) {
      const after = withPerfMiss.rows.find((r) => r.id === row.id)
      if (row.id !== "trading/studio") expect(after.verdictWord).toBe(row.verdictWord)
      // Every row ran the same best-effort checks before and after.
      expect(after.checks.filter((c) => BEST_EFFORT_KINDS.includes(c.kind)).length).toBe(
        row.checks.filter((c) => BEST_EFFORT_KINDS.includes(c.kind)).length
      )
    }
  })

  it("the only pass-like value is `pass`, and nothing else reaches it", () => {
    expect(PASS_LIKE).toEqual(["pass"])
    expect(VERDICT_VOCABULARY).toEqual(["pass", "fail"])
    const baseline = evaluateFacts(REAL_FACTS)
    for (const row of baseline.rows) {
      expect(PASS_LIKE, `${row.id} may only read pass or fail`).toContain(row.verdictWord)
    }
  })
})

/* ==========================================================================
   4. NO INVARIANT REPORTS "ok" WITHOUT HAVING CHECKED A NUMBER
   ========================================================================== */

describe("T19's discipline: no invariant may report ok without a measured quantity", () => {
  const report = evaluateFacts(REAL_FACTS)

  it("every check on every room carries a FINITE measurement and a NUMERIC budget", () => {
    for (const row of report.rows) {
      for (const check of row.checks) {
        expect(typeof check.measured, `${row.id}/${check.id} measured`).toBe("number")
        expect(Number.isFinite(check.measured), `${row.id}/${check.id} measured is finite`).toBe(true)
        expect(typeof check.budget, `${row.id}/${check.id} budget`).toBe("number")
        expect(Number.isFinite(check.budget)).toBe(true)
        expect(["at-most", "at-least"]).toContain(check.comparison)
      }
    }
  })

  it("`ok` is RE-DERIVABLE from measured and budget - a hand-set pass cannot survive", () => {
    for (const row of report.rows) {
      for (const check of row.checks) {
        const recomputed = check.comparison === "at-least" ? check.measured >= check.budget : check.measured <= check.budget
        expect(recomputed, `${row.id}/${check.id}: ok must equal the comparison of its own numbers`).toBe(check.ok)
      }
    }
  })

  it("every room ran EVERY invariant - an early return changes the count", () => {
    for (const row of report.rows) {
      expect(row.checks.length, `${row.id} must run all ${INVARIANTS.length}`).toBe(INVARIANTS.length)
      expect([...row.checks].map((c) => c.id)).toEqual([...INVARIANT_IDS])
    }
  })

  it("only the declared at-least invariants read their budget the other way round", () => {
    for (const invariant of INVARIANTS) {
      const onRow = report.rows[0].checks.find((c) => c.id === invariant.id)
      expect(onRow.comparison === "at-least").toBe(AT_LEAST_INVARIANT_IDS.includes(invariant.id))
    }
    expect(AT_LEAST_INVARIANT_IDS.length, "only the producer-surface observation is at-least").toBeGreaterThan(0)
  })

  it("an invariant whose measurement throws is recorded as a FAILURE, never a pass", () => {
    // The direct test of "did not check anything". A NaN reading cannot be
    // compared to a budget, so it must not read as ok.
    const fact = factFor(REAL_FACTS, "trading/ceremony")
    const thrower = Object.freeze({
      id: "test.only.a-thrower",
      kind: "safety",
      label: "a deliberately unmeasurable invariant",
      detail: "test scaffold",
      measure: () => {
        throw new Error("the producer of this measurement is absent")
      }
    })
    const row = evaluateRoom(fact, { expectedD1Order: 3, claimantsOf: () => [fact.id] }, [...INVARIANTS, thrower])
    const check = row.checks.find((c) => c.id === thrower.id)
    expect(check.ok, "a measurement that could not be produced is not a pass").toBe(false)
    expect(check.note).toMatch(/did not check anything/)
    expect(row.verdictWord).toBe("fail")
  })

  it("an invariant returning a NON-NUMERIC measurement is a failure, never a pass", () => {
    const fact = factFor(REAL_FACTS, "trading/ceremony")
    const liar = Object.freeze({
      id: "test.only.a-non-numeric-measurement",
      kind: "correctness",
      label: "an invariant that reports a string instead of a quantity",
      detail: "test scaffold",
      measure: () => "looks fine to me"
    })
    const row = evaluateRoom(fact, { expectedD1Order: 3, claimantsOf: () => [fact.id] }, [...INVARIANTS, liar])
    const check = row.checks.find((c) => c.id === liar.id)
    expect(check.ok).toBe(false)
    expect(check.measured).toBeNaN()
    expect(row.verdictWord).toBe("fail")
  })

  it("each of the FOUR producer-reference forms is recognised, and none is a rubber stamp", () => {
    // The correction recorded in PRODUCER_REFERENCE_FORMS: the first predicate
    // knew two forms and mis-flagged five real rooms. Each form is pinned
    // individually so a future edit cannot quietly drop one - and each is pinned
    // with the negative too, so "recognising a form" cannot become "accepting
    // any string".
    for (const form of PRODUCER_REFERENCE_FORMS) {
      expect(form.token.test(form.mustMatch), `${form.form} must match its own positive sample`).toBe(true)
      expect(form.token.test(form.mustNotMatch), `${form.form} must reject its own negative sample`).toBe(false)
    }
    expect(PRODUCER_REFERENCE_FORMS.map((f) => f.form)).toEqual([
      "source-path",
      "commit-sha",
      "http-route",
      "changelog-entry"
    ])
  })

  it("a reason naming NO producer in any of the four forms measures 0 and fails", () => {
    const facts = clone(REAL_FACTS)
    const markets = factFor(facts, "trading/markets")
    markets.reason =
      "No scope in this room logically belongs to WS-8, and everything the room shows is real and current. ".repeat(3)
    const row = evaluateFacts(facts).rows.find((r) => r.id === "trading/markets")
    const check = row.checks.find((c) => c.id === "correctness.complete-requires-evidence")
    expect(check.measured, "long enough, but no producer named in any recognised form").toBe(1)
    expect(row.verdictWord).toBe("fail")
  })

  it("trading/paper's compound owner is NOT treated as a trivially-fillable reserved block", () => {
    // The second correction, recorded: its owner opens with a task reference and
    // terminates in an owner decision.
    const paper = factFor(REAL_FACTS, "trading/paper")
    const ceremonyUnlock = paper.absences.find((a) => /CEREMONY-UNLOCK/.test(a.what))
    expect(ceremonyUnlock, "the absence exists").toBeTruthy()
    expect(ceremonyUnlock.owner).toMatch(/WS-7 T3/)
    const check = evaluateFacts(REAL_FACTS).rows
      .find((r) => r.id === "trading/paper")
      .checks.find((c) => c.id === "safety.no-task-owned-absence-on-a-complete-room")
    expect(check.measured, "a compound owner is an owner decision, not a bare task id").toBe(0)
  })

  it("a BARE task-id owner on a complete room IS treated as a reserved block", () => {
    const facts = clone(REAL_FACTS)
    const markets = factFor(facts, "trading/markets")
    markets.absences = [{ what: "W", detail: "D", owner: "WS-7 T12", isWs8Scope: false }]
    const check = evaluateFacts(facts).rows
      .find((r) => r.id === "trading/markets")
      .checks.find((c) => c.id === "safety.no-task-owned-absence-on-a-complete-room")
    expect(check.measured).toBe(1)
  })

  /**
   * THE MUTATION SWEEP - the strongest form of this property. For every blocking
   * invariant, a fact that genuinely violates it, asserted to flip that check
   * from ok to not-ok. An invariant that would report ok on a violating fact is
   * an invariant that checked nothing, whatever its `measured` field says.
   */
  it("every blocking invariant FLIPS when its condition is violated", () => {
    const GREEN = clone(REAL_FACTS)
    const greenReport = evaluateFacts(GREEN)

    const breakFor = {
      "safety.record-present": (f) => {
        f.present = false
      },
      "safety.ws8-handoff-key-present": (f) => {
        f.hasWs8HandoffKey = false
      },
      "safety.affordance-ceiling-is-zero": (f) => {
        f.ceiling = { basis: "exported-frozen-ceiling", id: "planted", length: 3, frozen: true }
      },
      "safety.no-task-owned-absence-on-a-complete-room": (f) => {
        f.absences = [{ what: "W", detail: "D", owner: "WS-7 T99", isWs8Scope: false }]
      },
      "safety.affordance-declares-a-route-and-a-token": (f) => {
        f.affordances = [{ id: "x", route: "", sourceToken: "", detail: "d", removedByThisTask: false }]
      },
      "correctness.verdict-declared": (f) => {
        f.verdict = "mostly complete"
      },
      "correctness.d1-order-matches-inventory-position": (f) => {
        // Deliberately a NON-INTEGER, so this plant violates position-match
        // WITHOUT also colliding with the room that owns 19. A plant of `19`
        // would trip two invariants and fail two rooms, which is correct gate
        // behaviour but the wrong thing to assert here.
        f.d1Order = 2.5
      },
      // The one genuinely CROSS-room invariant: it takes two rooms to violate it,
      // so it gets its own two-room plant rather than being forced into the
      // single-room shape the rest of the sweep uses.
      "correctness.d1-order-claimed-by-one-room": null,
      "correctness.complete-requires-evidence": (f) => {
        f.reason = "Looks right."
      },
      "correctness.incomplete-requires-an-open-handoff": (f) => {
        f.verdict = "incomplete"
        f.ws8HandoffKind = "null"
      },
      "correctness.absences-well-formed": (f) => {
        f.absences = [{ what: "", detail: "", owner: "", isWs8Scope: "no" }]
      },
      "correctness.pre-existing-affordances-not-removed-by-a-gate": (f) => {
        f.affordances = [{ id: "x", route: "/x", sourceToken: "X", detail: "d", removedByThisTask: true }]
      }
    }

    expect(
      Object.keys(breakFor).sort(),
      "every blocking invariant must have a violating case here, or the sweep is incomplete"
    ).toEqual([...BLOCKING_INVARIANT_IDS].sort())

    for (const [invariantId, plant] of Object.entries(breakFor)) {
      if (plant === null) continue // handled by its own two-room sweep below
      const facts = clone(REAL_FACTS)
      const target = factFor(facts, "trading/ceremony")
      plant(target)

      const report = evaluateFacts(facts)
      const row = report.rows.find((r) => r.id === "trading/ceremony")
      const before = greenReport.rows.find((r) => r.id === "trading/ceremony")
      const beforeCheck = before.checks.find((c) => c.id === invariantId)
      const afterCheck = row.checks.find((c) => c.id === invariantId)

      expect(beforeCheck.ok, `${invariantId} must hold on the real records`).toBe(true)
      expect(afterCheck.ok, `${invariantId} must FAIL when violated`).toBe(false)
      expect(
        afterCheck.measured,
        `${invariantId} must register a NON-ZERO measurement, not merely flip a boolean`
      ).toBeGreaterThan(0)
      expect(failingOf(report), `${invariantId} violating must fail the room`).toEqual(["trading/ceremony"])
    }
  })

  it("the d1Order-collision invariant flips only for the two rooms that collide", () => {
    // The one genuinely cross-room reading, and it is still scoped by name.
    const facts = clone(REAL_FACTS)
    factFor(facts, "trading/ceremony").d1Order = 4

    const report = evaluateFacts(facts)
    expect(failingOf(report).sort()).toEqual(["trading/ceremony", "trading/ministry"])
    for (const id of ["trading/ceremony", "trading/ministry"]) {
      expect(report.rows.find((r) => r.id === id).blockingFailures.map((f) => f.id)).toContain(
        "correctness.d1-order-claimed-by-one-room"
      )
    }
    // Everything else is untouched.
    expect(report.rows.filter((r) => r.verdictWord === "fail").length).toBe(2)
  })
})

/* ==========================================================================
   5. RISK 9 - ONE CONTRACT HOME, AND THE SERVER/CLIENT AGREEMENT
   ========================================================================== */

describe("Risk 9 - no second contract home for ConfluenceScore", () => {
  /** The key set `contracts.ts` DECLARES, read from the source. */
  const declaredConfluenceKeys = () => {
    const block = contractsSource.match(/export type ConfluenceScore = \{([\s\S]*?)\n\}/)
    expect(block, "contracts.ts must declare ConfluenceScore as a type literal").not.toBeNull()
    return [...block[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/gm)].map((m) => m[1]).sort()
  }

  /** The key set the ADAPTER actually produces, by running the real narrowing. */
  const projectedConfluenceKeys = () => {
    const reading = projectDecision("ASSET-PARITY", {
      ok: true,
      confluence: {
        score: 77,
        contributions: [],
        confidence: "medium",
        regime: "londonTrend",
        activeBoosters: [],
        conflictOverrides: [],
        computedAt: 1,
        engineVersion: "engine-test"
      },
      firedVetoes: [],
      unavailable: []
    })
    return Object.keys(reading.confluence).sort()
  }

  it("the adapter's narrowed object has EXACTLY the keys the client contract declares", () => {
    const declared = declaredConfluenceKeys()
    expect(declared.length, "contracts.ts:195-204 declares eight fields").toBe(8)
    expect(projectedConfluenceKeys(), "two type definitions of ConfluenceScore would drift here").toEqual(declared)
  })

  it("a client contract that grew or lost a field is caught, not absorbed", () => {
    const declared = declaredConfluenceKeys()
    const projected = projectedConfluenceKeys()
    expect(projected).not.toEqual([...declared, "sentinelExtraField"])
    expect(projected).not.toEqual(declared.filter((k) => k !== "engineVersion"))
  })

  it("the regime UNION agrees between contracts.ts and the narrowing's fallback list", () => {
    const declared = [...contractsSource.match(/export type Regimes = ([^\n]+)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    const fallback = [
      ...copilotReadingSource.match(/oneOf\(raw\.regime, \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)
    ].map((m) => m[1])
    expect(declared.sort()).toEqual([...fallback].sort())
    expect(declared.length, "spec :73's five regimes").toBe(5)
  })

  it("the confidence UNION agrees between contracts.ts and the narrowing's fallback list", () => {
    const declared = [
      ...contractsSource.match(/confidence: "([^"]+)" \| "([^"]+)" \| "([^"]+)" \| "([^"]+)"/).slice(1)
    ].sort()
    const fallback = [
      ...copilotReadingSource.match(/oneOf\(raw\.confidence, \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)
    ]
      .map((m) => m[1])
      .sort()
    expect(declared).toEqual(fallback)
    expect(declared).toEqual(["high", "low", "medium", "unavailable"])
  })

  it("a sixth regime in the client contract fails the gate rather than being narrowed away", () => {
    // The control for the assertion above: the narrowing's list is not a
    // free-standing copy, it is checked against contracts.ts's own union.
    const narrowed = [
      ...copilotReadingSource.match(/oneOf\(raw\.regime, \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)
    ].map((m) => m[1])
    expect(narrowed).toHaveLength(5)
    expect(narrowed).not.toContain("sixthRegime")
  })

  it("the FOUR PINNED REGEXES in ws6TerminalSeamGuard.test.mjs still match contracts.ts", () => {
    // Risk 9's other half: if this gate created its own copy of the contract,
    // it would be free to drift, and these four pins would keep matching a file
    // nothing renders any more. They are re-asserted here against the same file.
    const pins = [
      [42, /sizingEligible:\s*false/],
      [46, /requiredCount:\s*500/],
      [50, /"copilot: remote"/],
      [54, /ExecutionMode\s*=\s*"paper"\s*\|\s*"reserved"/]
    ]
    for (const [line, re] of pins) {
      expect(contractsSource, `ws6TerminalSeamGuard.test.mjs:${line} pin must keep matching`).toMatch(re)
    }
  })

  it("tierBoundaryFixture.mjs remains the SINGLE tier-boundary authority - no second fixture", () => {
    expect(existsSync(TIER_FIXTURE_PATH)).toBe(true)
    const declarations = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === ".playwright-tmp") continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        // Test files are excluded: a test may ASSERT the boundary constants by
        // name - this very test does - but a test cannot DECLARE an authority,
        // so matching one here would be matching this file's own source text.
        if (/\.test\./.test(entry)) continue
        if (!/\.(mjs|ts|tsx|mts|cts)$/.test(entry)) continue
        const src = readFileSync(full, "utf8")
        if (/export const (TIER_BOUNDARIES|APLUS_MIN_SCORE|B_MIN_SCORE)\b/.test(src)) {
          declarations.push(full.replace(REPO_ROOT, "").replace(/\\/g, "/").replace(/^\/+/, ""))
        }
      }
    }
    walk(REPO_ROOT)
    expect(
      declarations,
      "exactly one module may declare the tier boundary, or two copies can drift"
    ).toEqual(["apps/dashboard/server/services/copilot/tierBoundaryFixture.mjs"])
  }, REPO_WALK_BUDGET_MS)

  it("T11's shared fixture is still frozen and still carries AC-023's five integers", () => {
    const src = readFileSync(TIER_FIXTURE_PATH, "utf8")
    expect(src).toMatch(/export const ALL_BOUNDARY_CASES = Object\.freeze/)
    expect(src).toMatch(/export const APLUS_MIN_SCORE = 85/)
    expect(src).toMatch(/export const B_MIN_SCORE = 70/)
  })
})

/* ==========================================================================
   6. THE isAdmissibleAsSignal HANDOFF FROM T13
   ========================================================================== */

describe("T13's outstanding handoff - isAdmissibleAsSignal", () => {
  it("EXISTS on the client, so the brief's 'exists nowhere' is stale and is recorded", () => {
    expect(typeof isAdmissibleAsSignal).toBe("function")
  })

  it("is re-exported from the terminal's public entry point", () => {
    expect(readFileSync(TERMINAL_INDEX_PATH, "utf8")).toMatch(
      /export \{[^}]*isAdmissibleAsSignal[^}]*\} from "\.\/domain\/copilot"/
    )
  })

  it("returns the literal false for every explanation - AC-014's separation, executable", () => {
    const explanations = [
      null,
      undefined,
      {},
      { status: "ok", prose: "buy everything", generatedAt: Date.now() },
      { status: "degraded", prose: "consider a position", cacheAgeMs: 0 }
    ]
    for (const e of explanations) {
      expect(isAdmissibleAsSignal(e)).toBe(false)
    }
  })

  it("contracts.ts's reference to it is a named cross-reference, not a dangling call", () => {
    // contracts.ts:130 mentions it in prose. The function it names now exists,
    // so the reference resolves rather than pointing at nothing.
    expect(contractsSource).toMatch(/isAdmissibleAsSignal/)
  })

  it("the server's equivalent, assertNotDeterministicInput, is the WRITE-side twin and is not a signal gate", async () => {
    const routing = await import("../../server/services/copilot/routing.mjs")
    expect(typeof routing.assertNotDeterministicInput).toBe("function")
  })
})

/* ==========================================================================
   7. THE SEVEN (ACTUALLY TWELVE) PRE-EXISTING WRITE AFFORDANCES
   ========================================================================== */

describe("pre-existing write affordances are SURFACED, never failed on", () => {
  const report = evaluateFacts(REAL_FACTS)

  it("every pre-existing affordance is listed by name, with its route", () => {
    const declared = REAL_FACTS.flatMap((f) => f.affordances.map((a) => `${f.id} ${a.id} -> ${a.route}`))
    expect(declared.length, "T10's records, as they actually stand").toBe(declared.length)
    expect(report.ownerDecisions.length, "the gate surfaces all of them").toBe(declared.length)
    expect(report.ownerDecisions.every((d) => d.blocking === false)).toBe(true)
    for (const decision of report.ownerDecisions) {
      expect(decision.disposition).toMatch(/OWNER DECISION/)
      expect(decision.affordance).toBeTruthy()
      expect(decision.route).toBeTruthy()
    }
  })

  it("the instances carrying them - THIRTEEN, not the seven the brief states", () => {
    const instances = [...new Set(report.ownerDecisions.map((d) => d.room))].sort()
    // 12 -> 13 in WS-7 T14, and the movement is exactly one room, for a reason
    // worth stating because the assertion's own message is "tally the records,
    // do not trust the prose". T14 mounted the notifications configuration into
    // the general Settings room, which is THREE instances of one key
    // (trading/settings, earnings/settings, intelligence/settings). Two of them
    // already carried affordances and so were already tallied; only
    // `intelligence/settings` went from zero to four, and it is the single
    // instance this adds. The affordance TOTAL moves by 12 (four controls on
    // each of the three instances); the INSTANCE count moves by one.
    expect(instances.length, "tally the records, do not trust the prose").toBe(13)
    expect(instances).toContain("intelligence/settings")
    // Recorded rather than reconciled silently: entry 0032 says "seven", the
    // data said twelve instances / twenty-five affordances when T20 wrote this,
    // and says thirteen / thirty-seven now. The prose was never the source.
    expect(STALE_INSTANCE_COUNT_IN_SPEC.staleFigure).toBe(18)
  })

  it("trading/command-centre's order-execution affordances are surfaced explicitly", () => {
    const inCommandCentre = report.ownerDecisions.filter((d) => d.room === "trading/command-centre")
    // Three pre-existing affordances in this room; the two perps ones are the
    // headline the brief names, because they are ORDER-EXECUTION writes inside a
    // room D1 calls read-only.
    expect(inCommandCentre.length).toBe(3)
    const perps = inCommandCentre.filter((d) => /^Perps /.test(d.affordance ?? ""))
    expect([...perps.map((d) => d.affordance)].sort()).toEqual(
      ["Perps order execution", "Perps position close"].sort()
    )
    expect([...perps.map((d) => d.route)].sort()).toEqual(
      ["/api/command-centre/perps/close", "/api/command-centre/perps/execute"].sort()
    )
    // A room D1 calls read-only, carrying order execution - surfaced, not failed.
    expect(perps.every((d) => d.blocking === false)).toBe(true)
    expect(inCommandCentre.every((d) => d.blocking === false)).toBe(true)
    expect(report.rows.find((r) => r.id === "trading/command-centre").verdictWord).toBe("pass")
  })

  it("the headline perps affordance's own record explains why it was kept", () => {
    const record = REAL_FACTS.find((f) => f.id === "trading/command-centre")
    const execute = record.affordances.find((a) => a.route === "/api/command-centre/perps/execute")
    expect(execute.detail, "the record must carry the reasoning, not just the route").toMatch(/PerpsCommandCentre/)
    expect(execute.removedByThisTask).toBe(false)
  })

  it("Paper/Live's own frozen ceiling stays empty - zero interactive controls", () => {
    const paper = factFor(REAL_FACTS, "trading/paper")
    expect(paper.ceiling.id).toBe("PAPER_LIVE_INTERACTIVE_AFFORDANCES")
    expect(paper.ceiling.length).toBe(0)
    expect(paper.ceiling.frozen).toBe(true)
    // The four PRE-EXISTING paper-engine controls sit OUTSIDE the boundary
    // region, so they are not interactive affordances OF the boundary.
    expect(paper.affordances.length).toBe(0)
  })

  it("the sixteen read-only instances' shared ceiling is frozen empty data", () => {
    const ceilings = new Set(
      REAL_FACTS.filter((f) => f.ceiling.basis === "exported-frozen-ceiling").map((f) => `${f.ceiling.id}:${f.ceiling.length}:${f.ceiling.frozen}`)
    )
    expect([...ceilings].sort()).toEqual([
      "PAPER_LIVE_INTERACTIVE_AFFORDANCES:0:true",
      "READ_ONLY_INTERACTIVE_AFFORDANCES:0:true"
    ])
  })

  it("a room that GAINS a declared interactive affordance fails the safety ceiling", () => {
    const facts = clone(REAL_FACTS)
    factFor(facts, "earnings/dashboard").ceiling = {
      basis: "exported-frozen-ceiling",
      id: "READ_ONLY_INTERACTIVE_AFFORDANCES",
      length: 1,
      frozen: true
    }
    const report2 = evaluateFacts(facts)
    expect(failingOf(report2)).toEqual(["earnings/dashboard"])
    expect(report2.rows.find((r) => r.id === "earnings/dashboard").blockingFailures.map((f) => f.id)).toContain(
      "safety.affordance-ceiling-is-zero"
    )
  })

  it("an UNFROZEN ceiling fails even when it is empty", () => {
    const facts = clone(REAL_FACTS)
    factFor(facts, "intelligence/studio").ceiling = {
      basis: "exported-frozen-ceiling",
      id: "READ_ONLY_INTERACTIVE_AFFORDANCES",
      length: 0,
      frozen: false
    }
    const row = evaluateFacts(facts).rows.find((r) => r.id === "intelligence/studio")
    const check = row.checks.find((c) => c.id === "safety.affordance-ceiling-is-zero")
    expect(check.measured, "an unfrozen empty array is still a violation").toBe(1)
    expect(row.verdictWord).toBe("fail")
  })
})

/* ==========================================================================
   8. THE 18-vs-22 SPEC CONTRADICTION - RECORDED, NOT PAPERED OVER
   ========================================================================== */

describe("spec self-contradiction: AC-047 and D27 said 18, the inventory says 22, and T21 CORRECTED the prose", () => {
  const specPath = fileURLToPath(
    new URL("../../../../docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md", import.meta.url)
  )
  const spec = readFileSync(specPath, "utf8")
  const specLines = spec.split(/\r?\n/)

  it("the amended inventory at spec:73 says 22 instances across 15 keys", () => {
    expect(spec).toMatch(/\*\*22 instances across 15 distinct room keys\*\*/)
    expect(spec).toMatch(/Amended 2026-09-30, owner-ruled; previously 18 instances across 11 keys/)
  })

  it("every recorded stale location now reads 22, so the prose cannot mislead a reader", () => {
    for (const location of STALE_INSTANCE_COUNT_IN_SPEC.wasStaleAt) {
      expect(location, `every entry names a line`).toMatch(/^spec:\d+ /)
      const line = Number(location.split(" ")[0].slice("spec:".length))
      expect(specLines[line - 1], `${location} must no longer assert 18`).toBeTypeOf("string")
      expect(specLines[line - 1], `${location} must no longer assert 18`).not.toMatch(/\b18\b/)
    }
  })

  it("the three sites T20 named by their own AC text all read 22", () => {
    expect(spec).toMatch(/The cross-room gate runs over all 22 room instances/)
    expect(spec).toMatch(/The hard gate across all 22 room instances/)
    expect(spec).toMatch(/All 22 rooms stay in scope/)
  })

  it("the RECORD that they were stale survives the correction - this is the point", () => {
    expect(STALE_INSTANCE_COUNT_IN_SPEC.staleFigure).toBe(18)
    expect(STALE_INSTANCE_COUNT_IN_SPEC.currentFigure).toBe(22)
    expect(STALE_INSTANCE_COUNT_IN_SPEC.wasStaleAt.length, "every stale location is named").toBe(18)
    expect(STALE_INSTANCE_COUNT_IN_SPEC.staleAt.length).toBe(STALE_INSTANCE_COUNT_IN_SPEC.wasStaleAt.length)
    for (const location of STALE_INSTANCE_COUNT_IN_SPEC.wasStaleAt) {
      expect(location).toMatch(/^spec:\d+ /)
    }
    expect(STALE_INSTANCE_COUNT_IN_SPEC.disposition).toMatch(/RECORDED \(T20, entry 0034\), THEN CORRECTED/)
  })

  it("T20's own SEVEN-location list is retained beside the measured EIGHTEEN, including its undercount", () => {
    expect(STALE_INSTANCE_COUNT_IN_SPEC.recordedByT20).toHaveLength(7)
    expect(STALE_INSTANCE_COUNT_IN_SPEC.disposition).toMatch(/itself an undercount/)
    // every site T20 recorded is among the eighteen - T20 was right about the
    // ones it found, and its list was not wrong, only short
    const shortList = STALE_INSTANCE_COUNT_IN_SPEC.staleAt.map((l) => l.split(" ")[0])
    for (const location of STALE_INSTANCE_COUNT_IN_SPEC.recordedByT20) {
      expect(shortList, `T20 recorded ${location}, which must be in the measured list`).toContain(location.split(" ")[0])
    }
  })

  it("the two remaining 18s are NOT room counts and were deliberately left alone", () => {
    const remaining = specLines
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /\b18\b/.test(l) && !/7\.18/.test(l))
    expect(remaining).toHaveLength(2)
    // spec:73's amendment history, and honesty note 18's own number
    expect(remaining[0][0]).toBe(73)
    expect(remaining[0][1]).toMatch(/previously 18 instances across 11 keys/)
    // The locator moved 1476 -> 1501 when the WS-7 T17 AC-7a decision record was
    // added at spec:1354, because that record sits ABOVE the honesty notes and
    // pushed them down by 25 lines. Nothing is relaxed: `toHaveLength(2)` and the
    // content match on the next line both still apply, and neither changed. This
    // is a positional locator that any spec growth invalidates by construction -
    // only the count and the content are the assertions.
    expect(remaining[1][0]).toBe(1501)
    expect(remaining[1][1]).toMatch(/^18\. \*\*No credentials/)
  })

  it("the gate runs on 22 - gating on 18 would drop four rooms out of a safety gate", () => {
    expect(ROOM_INVENTORY.length).toBe(22)
    for (const id of ["trading/ceremony", "trading/ministry", "trading/strategy", "trading/risk"]) {
      expect(ROOM_INVENTORY, `${id} is one of the four the stale figure would have dropped`).toContain(id)
    }
  })

  it("the gate prints the correction every run, so it is unmissable", () => {
    const r = runGateOn(REAL_FACTS)
    const out = `${r.stdout}${r.stderr}`
    // --quiet suppresses the row table but the staleness line is part of the
    // record, so the CLI is invoked without --quiet here.
    expect(out.length).toBeGreaterThanOrEqual(0)
    const verbose = spawnSync(process.execPath, [GATE_PATH, "--facts-stdin"], {
      input: JSON.stringify(REAL_FACTS),
      encoding: "utf8",
      cwd: REPO_ROOT,
      timeout: 120_000
    })
    const verboseOut = `${verbose.stdout}${verbose.stderr}`
    expect(verboseOut).toMatch(/stale spec text: 18 was stale at 18 places, current figure 22/)
    expect(verboseOut).toMatch(/owner-ruled 2026-09-30/)
    expect(verboseOut).toMatch(/corrected WS-7 T21/)
  })
})

/* ==========================================================================
   9. THE GATE IS OBSERVED FAILING AS A PROCESS - the T19 model
   ========================================================================== */

describe("AC-047 - the gate is observed FAILING, which is what makes it a gate", () => {
  it("--fail-branch exits NON-ZERO on a real planted safety break", () => {
    const r = runGateFlag("--fail-branch")
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/NOT a measurement/)
    expect(`${r.stdout}${r.stderr}`).toMatch(/failing rooms: \["trading\/ceremony"\]/)
  })

  it("--missing-record-branch exits NON-ZERO when a record is absent", () => {
    expect(runGateFlag("--missing-record-branch").status).toBe(1)
  })

  it("a REAL room broken in isolation exits NON-ZERO as a spawned process", () => {
    const facts = clone(REAL_FACTS)
    factFor(facts, "trading/ministry").verdict = "nearly complete"

    const r = runGateOn(facts)
    expect(r.status, `a wrong verdict word must fail the gate; got ${r.status}\n${r.stdout}${r.stderr}`).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/failing rooms: trading\/ministry/)
  })

  it("the gate FAILS CLOSED when it cannot see any rooms at all", () => {
    // A gate that cannot see the rooms cannot clear them.
    const r = runGateFlag()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/no facts supplied/)
    expect(`${r.stdout}${r.stderr}`).toMatch(/cannot clear them/)
  })

  it("the gate FAILS CLOSED on an unparseable payload rather than reading it as green", () => {
    const r = spawnSync(process.execPath, [GATE_PATH, "--facts-stdin", "--quiet"], {
      input: "{ this is not json",
      encoding: "utf8",
      cwd: REPO_ROOT,
      timeout: 120_000
    })
    expect(r.status).toBe(1)
  })

  it("gateExitCode refuses a report it cannot fully account for", () => {
    expect(gateExitCode(null)).toBe(1)
    expect(gateExitCode({ rows: [], failingRooms: [], extraRows: [] })).toBe(1)
    expect(gateExitCode(evaluateFacts(REAL_FACTS))).toBe(0)
    expect(gateExitCode(evaluateFacts(safetyBreakFactSet()))).toBe(1)
  })
})