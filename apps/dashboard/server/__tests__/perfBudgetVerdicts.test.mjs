// WS-7 T19 — the B1-B12 budget-verdict guard.
//
// AC-044 (:1117-1123) requires a "manifest schema test rejecting a missing
// verdict" and says the WS-6 breaches (B1, B3) "must still appear". AC-045
// (:1125-1131) requires "a manifest test rejects a `pass` on B2 while no ARM
// sample is recorded, and rejects any removal or downgrade of B1's `BREACH`".
//
// The design rule is the one this repo already established for B5/B6 in
// `perfArtifact.test.mjs:9-18`: DO NOT ASSERT `verdict === "pass"` AND DO NOT
// PIN A TIMING. Timings differ per machine and per load, so a pinned number
// rots and a pass/fail assertion on a timing becomes a flaky test. What is
// asserted instead is the property that cannot rot:
//
//   THE RECORDED VERDICT MUST BE RE-DERIVABLE FROM THE ROW'S OWN NUMBERS.
//
// A fabricated pass — a `pass` whose own samples are over budget, or a `pass`
// with no samples, or a `pass` with no budget to have passed against — fails
// here by construction, because `verdictForRow` never reads the recorded verdict
// and has no code path that returns `pass` without comparing a measured
// percentile to a numeric budget.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  PASS_LIKE,
  VERDICTS,
  VERDICT_VOCABULARY,
  fabricationFindings,
  nearestRank,
  verdictForRow
} from "../../../../scripts/perf-budget-verdicts.mjs"

const MANIFEST_PATH = fileURLToPath(
  new URL("../../perf/budget-verdicts.json", import.meta.url)
)
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
const rows = manifest.rows
const byId = Object.fromEntries(rows.map((r) => [r.id, r]))

/** The rows §4.6:720-733 enumerates. AC-044 says "Enumerate B1-B12". */
const EXPECTED_IDS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12"]

describe("AC-044 — every budget row exists and carries a verdict", () => {
  it("enumerates exactly B1 through B12, with no row added or dropped", () => {
    expect(rows.map((r) => r.id).sort()).toEqual([...EXPECTED_IDS].sort())
  })

  it("gives every row a verdict — never blank, never null", () => {
    for (const r of rows) {
      expect(typeof r.verdict, r.id).toBe("string")
      expect(r.verdict.length, r.id).toBeGreaterThan(0)
    }
  })

  it("uses only the extended vocabulary", () => {
    for (const r of rows) {
      expect(VERDICT_VOCABULARY, r.id).toContain(r.verdict)
    }
  })

  it("gives every row a stated reason, so no verdict is a bare token", () => {
    for (const r of rows) {
      expect(typeof r.reason, r.id).toBe("string")
      expect(r.reason.length, r.id).toBeGreaterThan(20)
    }
  })

  it("keeps the WS-6 breaches visible — AC-044 names B1 and B3 explicitly", () => {
    expect(byId.B1.verdict).toBe("BREACH")
    expect(byId.B3.verdict).toBe("BREACH")
  })

  it("records that neither B1 nor B3 was fixed by this task", () => {
    // A breach that quietly became `pass` would be the exact failure AC-044's
    // prohibited side effect names: "a breach may not be dropped from the
    // manifest". These rows were not softened, and the manifest says so.
    expect(byId.B1.fixedThisTask).toBe(false)
    expect(byId.B3.fixedThisTask).toBe(false)
  })
})

describe("the extended vocabulary is genuinely extended, and only `pass` satisfies", () => {
  it("carries all seven tokens", () => {
    expect(VERDICT_VOCABULARY.length).toBe(7)
    for (const token of [
      "pass",
      "BREACH",
      "UNMEASURED",
      "RATIFIED_UNMEASURED",
      "WITHDRAWN_UNMEASURED",
      "UNVERIFIED",
      "PARTIAL_VERIFICATION"
    ]) {
      expect(VERDICT_VOCABULARY, token).toContain(token)
    }
  })

  it("makes exactly one token satisfying, so a non-pass cannot read as one", () => {
    expect(PASS_LIKE).toEqual(["pass"])
  })

  it("distinguishes the four states the task requires to be distinguishable from `pass`", () => {
    for (const token of ["RATIFIED_UNMEASURED", "UNVERIFIED", "UNMEASURED", "BREACH"]) {
      expect(VERDICTS[token].satisfiesBudget, token).toBe(false)
      expect(VERDICTS[token].description.length, token).toBeGreaterThan(20)
    }
  })

  it("separates ratified-but-unmeasured from withdrawn-and-unmeasured", () => {
    // These are the two states the spec's own text blurs: :739 describes B2 as
    // ratified-but-unmeasured, :723 records it withdrawn. They must not collapse.
    expect(VERDICTS.RATIFIED_UNMEASURED.description).not.toBe(VERDICTS.WITHDRAWN_UNMEASURED.description)
  })
})

describe("THE RE-DERIVATION PROPERTY — a fabricated pass fails", () => {
  it("every recorded verdict is what its own numbers derive", () => {
    expect(fabricationFindings(rows)).toEqual([])
  })

  it("re-derives each measured row's verdict independently of the manifest's helper", () => {
    for (const r of rows) {
      if (!Array.isArray(r.rawSamplesMs) || r.rawSamplesMs.length === 0) continue
      if (typeof r.budgetMs !== "number") continue
      const recomputed = nearestRank(r.rawSamplesMs, r.percentile ?? 95)
      const derived = recomputed <= r.budgetMs ? "pass" : "BREACH"
      expect(derived, r.id).toBe(r.verdict)
    }
  })

  it("rejects a fabricated pass: over-budget samples labelled `pass`", () => {
    const forged = { id: "FORGED", budgetMs: 250, rawSamplesMs: [400, 900, 1200], verdict: "pass" }
    expect(verdictForRow(forged)).toBe("BREACH")
    expect(verdictForRow(forged)).not.toBe("pass")
    expect(fabricationFindings([forged]).length).toBeGreaterThan(0)
  })

  it("rejects a fabricated pass: `pass` with no samples at all", () => {
    const forged = { id: "FORGED", budgetMs: 250, rawSamplesMs: [], verdict: "pass" }
    expect(verdictForRow(forged)).toBe("UNMEASURED")
    expect(fabricationFindings([forged]).length).toBeGreaterThan(0)
  })

  it("rejects a fabricated pass: `pass` with no budget to have passed against", () => {
    const forged = { id: "FORGED", budgetMs: null, rawSamplesMs: [1, 2, 3], verdict: "pass" }
    expect(verdictForRow(forged)).toBe("UNMEASURED")
    expect(fabricationFindings([forged]).length).toBeGreaterThan(0)
  })

  it("cannot derive `pass` for a withdrawn row even when samples exist", () => {
    // B2's shape, fed samples. A withdrawn budget has nothing to compare against,
    // so supplying raw samples must NOT be a way to manufacture a pass.
    const forged = {
      id: "FORGED",
      budgetMs: null,
      budgetStatus: "WITHDRAWN",
      rawSamplesMs: [1, 2, 3],
      verdict: "pass"
    }
    expect(verdictForRow(forged)).toBe("WITHDRAWN_UNMEASURED")
    expect(verdictForRow(forged)).not.toBe("pass")
  })

  it("agrees with the harness percentile on these samples, or the sample set is suspect", () => {
    // `nearestRank` here is a DIFFERENT implementation from the e2e harness's
    // `sorted[floor(p*n)]`. Both are computed here; if they disagreed wildly on
    // a 12-sample set the samples themselves would be the thing to question.
    const s = [...byId.B1.rawSamplesMs].sort((a, b) => a - b)
    const harness = s[Math.min(s.length - 1, Math.floor(0.95 * s.length))]
    const nearest = nearestRank(s, 95)
    expect(nearest).toBe(harness)
    expect(byId.B1.observedP95Ms).toBe(nearest)
  })
})

describe("AC-045 — the ARM tier is honest, and the withdrawn figure is not back", () => {
  it("B2 is not `pass` while no ARM sample exists", () => {
    expect(byId.B2.verdict).not.toBe("pass")
    expect(byId.B2.verdict).toBe("WITHDRAWN_UNMEASURED")
  })

  it("B2 carries no numeric budget, so there is nothing to have passed against", () => {
    expect(byId.B2.budgetMs).toBeNull()
    expect(byId.B2.budgetStatus).toBe("WITHDRAWN")
  })

  it("B2 is not marked ratified — the supersession withdrew the ratification", () => {
    expect(byId.B2.ratified).toBe(false)
  })

  it("the ~1800 ms figure appears NOWHERE in the manifest as a live budget", () => {
    // AC-045's stale text (:1128) and T19's stale acceptance line (:1368) both
    // still say "ratified at ~1800 ms". The supersession withdrew it. If any row
    // carried 1800 as its budget, an implementer had re-introduced it.
    for (const r of rows) {
      if (typeof r.budgetMs === "number") {
        expect(r.budgetMs, `${r.id} must not carry the withdrawn 1800 ms figure`).not.toBe(1800)
      }
    }
  })

  it("250 ms is labelled the x86-only tier on B1, per AC-045", () => {
    expect(byId.B1.budgetMs).toBe(250)
    expect(byId.B1.tier).toMatch(/x86-only/i)
  })

  it("B1 is a BREACH of that x86 tier and is not rescued by the ARM re-baseline", () => {
    expect(byId.B1.verdict).toBe("BREACH")
    expect(byId.B1.observedP95Ms).toBeGreaterThan(byId.B1.budgetMs)
  })

  it("B1 refuses to publish a ratified figure, because only one run reached 6x", () => {
    expect(byId.B1.ratifiedFigureMs).toBeNull()
    expect(byId.B1.sampleAdequacy).toBe("INSUFFICIENT_SINGLE_RUN")
  })

  it("records the spec contradiction explicitly rather than resolving it silently", () => {
    expect(manifest.specDivergence).toBeTruthy()
    expect(manifest.specDivergence.supersession).toMatch(/WITHDREW/i)
    expect(manifest.specDivergence.governingText).toMatch(/:723/)
    // All three stale locations are named, so a reader can see which texts were
    // overridden rather than guessing.
    const stale = manifest.specDivergence.staleCopies.join(" ")
    expect(stale).toMatch(/AC-045/)
    expect(stale).toMatch(/:1368/)
    expect(stale).toMatch(/:1495/)
  })
})

describe("B10 — the 2 GB gate graduated from UNMEASURED to a measured peak", () => {
  it("is measured, with the figure recorded", () => {
    expect(byId.B10.verdict).toBe("pass")
    expect(typeof byId.B10.observedPeakMb).toBe("number")
  })

  it("sits under the frozen 2048 MB ceiling", () => {
    expect(byId.B10.budgetMs).toBe(2048)
    expect(byId.B10.observedPeakMb).toBeLessThanOrEqual(byId.B10.budgetMs)
  })

  it("reports more than one observed run, so the peak is not a single sample", () => {
    expect(Array.isArray(byId.B10.runsObservedMb)).toBe(true)
    expect(byId.B10.runsObservedMb.length).toBeGreaterThanOrEqual(2)
    // The reported peak is the maximum observed, not a convenient one.
    expect(byId.B10.observedPeakMb).toBe(Math.max(...byId.B10.runsObservedMb))
  })

  it("states the ceiling is frozen, per T19's bisect line", () => {
    expect(byId.B10.reason).toMatch(/frozen|NOT raised|not raised/i)
  })
})

describe("the ARM rows are honest about what was and was not verified", () => {
  it("B9 is UNVERIFIED and does not carry a fabricated ARM figure", () => {
    expect(byId.B9.verdict).toBe("UNVERIFIED")
    // No measured-on-this-host ARM values.
    expect(byId.B9.measuredOnThisHost ?? null).toBeNull()
  })

  it("B9 states that no ARM64 device was available, rather than implying one was", () => {
    expect(byId.B9.reason).toMatch(/No ARM64 device/i)
  })

  it("B12 is PARTIAL_VERIFICATION — corroborated and contradicted halves kept apart", () => {
    expect(byId.B12.verdict).toBe("PARTIAL_VERIFICATION")
    expect(byId.B12.crossChecks.checksumIdentityCorroborated).toBe(true)
    expect(byId.B12.crossChecks.x86BenchReproduced).toBe(false)
  })

  it("B12 records the owner's relayed figures verbatim rather than replacing them", () => {
    const arm = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../perf/arm-probe.json", import.meta.url)), "utf8")
    )
    expect(arm.ownerRelayed.benchMs.arm).toBe(3012.39)
    expect(arm.ownerRelayed.benchMs.x86).toBe(419.48)
    expect(arm.ownerRelayed.benchChecksum).toBe("2095.419")
  })

  it("B12's recorded cross-checks are the ones this host actually produced", () => {
    const arm = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../perf/arm-probe.json", import.meta.url)), "utf8")
    )
    expect(byId.B12.crossChecks.thisHostBenchMs).toBe(arm.rows.B12.crossChecks.thisHostBenchMs)
    expect(byId.B12.crossChecks.impliedRatioIfArmFigureHeld).toBe(
      arm.rows.B12.crossChecks.impliedRatioIfArmFigureHeld
    )
    // And the recorded ratio really is not the 7.18x the derivation assumed.
    expect(arm.rows.B12.crossChecks.impliedRatioIfArmFigureHeld).not.toBe(7.18)
  })

  it("the checked-in probe artifact declares it is not an ARM device run", () => {
    const arm = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../perf/arm-probe.json", import.meta.url)), "utf8")
    )
    expect(arm.host.isArm64).toBe(false)
    expect(arm.provenance).toMatch(/NOT an ARM device run/i)
  })
})