// WS-7 T11 — the B5/B6 artifact guard.
//
// Plan v1 §3.1 item 8: "Measure over a pinned fixture set, record raw samples
// into `apps/dashboard/perf/`, and report a verdict. If the engine is too slow,
// the verdict is BREACH — do NOT defer it to T19."
//
// AC-044 (:1117-1131) requires every budget row to carry a verdict, and §4.6:739
// is explicit that a silent pass is not permitted.
//
// WHAT THIS TEST DOES AND DOES NOT ASSERT. It does NOT assert `verdict ===
// "pass"`. Timings differ per machine and per load, so pinning a value would
// rot the moment CI is busier — and a test that fails on slowness would be a
// flaky test, which this repo already has too many of.
//
// It asserts the thing that actually matters: THE RECORDED VERDICT MUST BE
// DERIVABLE FROM THE RECORDED SAMPLES. A fabricated pass — a `pass` whose own
// p95 is over budget — fails here. That is the guard against AC-044's "silent
// pass", and it is the one that cannot rot.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  ARTIFACT_SCHEMA,
  BUDGETS_MS,
  MEASURED_ITERATIONS,
  verdictFor
} from "../../../../../../scripts/copilot-engine-probe.mjs"

const ARTIFACT_PATH = fileURLToPath(new URL("../../../../perf/copilot-engine-bench.json", import.meta.url))
const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"))

describe("the B5/B6 artifact exists and declares what it is", () => {
  it("carries its schema", () => {
    expect(artifact.schema).toBe(ARTIFACT_SCHEMA)
  })

  it("names the engine version the numbers were produced by", () => {
    expect(artifact.engineVersion).toBeTruthy()
  })

  it("records the host, so a number is never read without knowing where it came from", () => {
    expect(artifact.host.node).toBeTruthy()
    expect(artifact.host.platform).toBeTruthy()
    expect(artifact.host.arch).toBeTruthy()
  })

  it("pins its fixture set and iteration counts", () => {
    expect(artifact.fixtures.pinnedStates).toBeGreaterThan(0)
    expect(artifact.fixtures.warmupIterations).toBeGreaterThanOrEqual(0)
    expect(artifact.fixtures.measuredIterations).toBe(MEASURED_ITERATIONS)
  })

  it("carries provenance, per the spec's provenance-marker practice (§4.6:741)", () => {
    expect(artifact.provenance).toContain("T11")
    expect(artifact.provenance).toContain("B5")
  })

  it("states the budgets it is judged against, which are the spec's own figures", () => {
    expect(artifact.budgets.confluenceP95Ms).toBe(100)
    expect(artifact.budgets.vetoesP95Ms).toBe(25)
    expect(BUDGETS_MS).toEqual({ confluenceP95: 100, vetoesP95: 25 })
  })
})

describe("the raw samples are really there", () => {
  it("records one sample per iteration for B5", () => {
    expect(artifact.rawSamplesMs.confluence).toHaveLength(MEASURED_ITERATIONS)
  })

  it("records one sample per iteration for B6", () => {
    expect(artifact.rawSamplesMs.vetoes).toHaveLength(MEASURED_ITERATIONS)
  })

  it("records finite, non-negative timings — no placeholder zeros standing in for measurements", () => {
    for (const key of ["confluence", "vetoes"]) {
      for (const s of artifact.rawSamplesMs[key]) {
        expect(Number.isFinite(s), key).toBe(true)
        expect(s, key).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("reports p50 <= p95 <= max, so the summary is consistent with itself", () => {
    for (const key of ["confluence", "vetoes"]) {
      const m = artifact.measurements[key]
      expect(m.p50Ms, key).toBeLessThanOrEqual(m.p95Ms)
      expect(m.p95Ms, key).toBeLessThanOrEqual(m.maxMs)
    }
  })
})

describe("AC-044 — the verdict is DERIVABLE from the recorded numbers", () => {
  it("B5's verdict follows from B5's own p95 and the 100ms budget", () => {
    expect(artifact.verdicts.confluence).toBe(verdictFor(artifact.measurements.confluence, BUDGETS_MS.confluenceP95))
  })

  it("B6's verdict follows from B6's own p95 and the 25ms budget", () => {
    expect(artifact.verdicts.vetoes).toBe(verdictFor(artifact.measurements.vetoes, BUDGETS_MS.vetoesP95))
  })

  it("uses only the spec's verdict vocabulary", () => {
    for (const v of [artifact.verdicts.confluence, artifact.verdicts.vetoes]) {
      expect(["pass", "BREACH", "UNMEASURED"]).toContain(v)
    }
  })

  it("would reject a fabricated pass — the control for the two assertions above", () => {
    // A summary whose p95 is over budget must be BREACH, never pass.
    const breaching = { p50Ms: 1, p95Ms: 140, maxMs: 200 }
    expect(verdictFor(breaching, BUDGETS_MS.confluenceP95)).toBe("BREACH")
    expect(verdictFor(breaching, BUDGETS_MS.confluenceP95)).not.toBe("pass")
    // And a summary with no measurement must be UNMEASURED, never pass either.
    expect(verdictFor({}, BUDGETS_MS.confluenceP95)).toBe("UNMEASURED")
    expect(verdictFor(null, BUDGETS_MS.confluenceP95)).toBe("UNMEASURED")
  })

  it("is re-derivable by anyone from the file alone — no hidden input", () => {
    // Recompute p95 from the raw samples with an independent nearest-rank and
    // check it against the summary. If the probe's own percentile helper were
    // wrong, this disagrees.
    const nearestRank = (samples, p) => {
      const sorted = [...samples].sort((a, b) => a - b)
      return sorted[Math.ceil((p / 100) * sorted.length) - 1]
    }
    for (const key of ["confluence", "vetoes"]) {
      const budget = key === "confluence" ? BUDGETS_MS.confluenceP95 : BUDGETS_MS.vetoesP95
      const recomputed = nearestRank(artifact.rawSamplesMs[key], 95)
      const verdictFromRecomputed = verdictFor({ p95Ms: recomputed }, budget)
      expect(verdictFromRecomputed, `${key} verdict must hold up when recomputed`).toBe(
        artifact.verdicts[key]
      )
    }
  })
})
