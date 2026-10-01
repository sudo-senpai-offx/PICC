// WS-7 T19 — the B10 2 GB ceiling gate guard.
//
// AC-043 (:1109-1115):
//   Scenario: A build exceeds 2 GB peak RSS; and separately, a compliant build runs.
//   Expected: The breaching build FAILS; the compliant build passes and records
//             its measured peak.
//   Prohibited side effect: "A gate that has never been observed failing is not
//             accepted as working; a warning is not a gate."
//   Verification: "Both branches exercised in CI, with the measured peak
//             recorded in the perf manifest."
//
// So this guard does the thing AC-043's verification asks for and the prompt
// insists on: it observes the gate FAILING, not merely existing. It runs
// `node scripts/ram-ceiling-gate.mjs --fail-branch` as a child process and
// asserts a non-zero exit. A gate that cannot fail this assertion is not a gate.
//
// IT DOES NOT PIN THE MEASURED PEAK. Peak RSS depends on the host, and a test
// that fails when CI is busier is a flaky test — which this repo already has too
// many of. What is pinned is the CEILING (2048, frozen) and the re-derivability
// of the recorded verdict from the artifact's own numbers.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  B10,
  RAM_CEILING_MB,
  summarise,
  verdictForPeak
} from "../../../../scripts/ram-ceiling-gate.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const GATE_PATH = fileURLToPath(new URL("../../../../scripts/ram-ceiling-gate.mjs", import.meta.url))
const ARTIFACT_PATH = fileURLToPath(
  new URL("../../perf/ram-ceiling-gate.json", import.meta.url)
)

const runGate = (...args) =>
  spawnSync(process.execPath, [GATE_PATH, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: 120_000
  })

describe("AC-043 — the gate is observed FAILING, which is what makes it a gate", () => {
  it("--fail-branch exits NON-ZERO, so a breach can fail a build", () => {
    const r = runGate("--fail-branch")
    expect(r.status, `expected a non-zero exit, got ${r.status}\n${r.stdout}\n${r.stderr}`).not.toBe(0)
    expect(r.status).toBe(1)
  })

  it("--fail-branch says out loud that it is a refusal, not a measurement", () => {
    const r = runGate("--fail-branch")
    expect(`${r.stdout}${r.stderr}`).toMatch(/Not a measurement/i)
    expect(`${r.stdout}${r.stderr}`).toMatch(/exiting 1/i)
  })

  it("--self-test exits ZERO and exercises BOTH branches of the decision function", () => {
    const r = runGate("--self-test")
    expect(r.status, r.stderr).toBe(0)
    const out = `${r.stdout}${r.stderr}`
    expect(out).toMatch(/compliant[\s\S]*got pass/)
    expect(out).toMatch(/breaching[\s\S]*got BREACH/)
    expect(out).toMatch(/BREACH branch was observed firing: true/)
  })

  it("would fail this guard if the failing branch stopped failing", () => {
    // The control for the assertion above: prove the decision function really
    // does separate the branches, so a passing --fail-branch is not vacuous.
    expect(verdictForPeak({ peakMb: 1024 })).toBe("pass")
    expect(verdictForPeak({ peakMb: RAM_CEILING_MB + 1 })).toBe("BREACH")
    expect(verdictForPeak({ peakMb: RAM_CEILING_MB + 1 })).not.toBe("pass")
  })
})

describe("the ceiling is frozen, per T19's bisect line (:1370)", () => {
  it("is 2048 MB", () => {
    expect(RAM_CEILING_MB).toBe(2048)
  })

  it("is exactly at the boundary a pass, one MB over a BREACH", () => {
    expect(verdictForPeak({ peakMb: RAM_CEILING_MB })).toBe("pass")
    expect(verdictForPeak({ peakMb: RAM_CEILING_MB + 1 })).toBe("BREACH")
  })

  it("treats a missing measurement as UNMEASURED, never as a pass", () => {
    expect(verdictForPeak({})).toBe("UNMEASURED")
    expect(verdictForPeak(null)).toBe("UNMEASURED")
    expect(verdictForPeak({ peakMb: null })).toBe("UNMEASURED")
    expect(verdictForPeak({ peakMb: Number.NaN })).toBe("UNMEASURED")
  })

  it("reads no ceiling from the environment or argv, so a build cannot soften it", () => {
    const src = readFileSync(GATE_PATH, "utf8")
    // A gate whose ceiling could be overridden by an env var or a flag is a
    // warning. Assert the declaration itself is the literal, rather than trying
    // to pattern-match every USE of the name (which legitimately appears as
    // `RAM_CEILING_MB + 1`, `${RAM_CEILING_MB}`, and so on).
    expect(src).toMatch(/export const RAM_CEILING_MB = 2048/)
    expect(src).not.toMatch(/process\.env\.[A-Za-z_]*(CEILING|LIMIT|MAX_RAM|RAM_)/)
  })
})

describe("B10 has graduated from UNMEASURED to a measured peak", () => {
  const artifact = existsSync(ARTIFACT_PATH) ? JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) : null

  it("the artifact exists and declares its schema", () => {
    expect(artifact).not.toBeNull()
    expect(artifact.schema).toBe("picc-ram-ceiling/1")
    expect(artifact.budget).toBe(B10)
  })

  it("records a measured peak in MB, not a placeholder", () => {
    expect(typeof artifact.measured.peakMb).toBe("number")
    expect(artifact.measured.peakMb).toBeGreaterThan(0)
    expect(artifact.measured.samples).toBeGreaterThan(0)
  })

  it("reports the ceiling it was judged against and that the ceiling is frozen", () => {
    expect(artifact.ceilingMb).toBe(RAM_CEILING_MB)
    expect(artifact.ceilingIsFrozen).toBe(true)
  })

  it("the recorded verdict is RE-DERIVABLE from the artifact's own raw samples", () => {
    // Same discipline as the B5/B6 guard: recompute the peak from the raw series
    // and re-derive the verdict. A hand-edited `pass` cannot survive this.
    const peak = summarise(artifact.rawSamplesMb).peakMb
    expect(peak).toBe(artifact.measured.peakMb)
    expect(verdictForPeak({ peakMb: peak })).toBe(artifact.verdict)
  })

  it("records WHICH processes the peak was made of, so the number is checkable", () => {
    expect(Array.isArray(artifact.peakProcesses)).toBe(true)
    expect(artifact.peakProcesses.length).toBeGreaterThan(0)
    for (const p of artifact.peakProcesses) {
      expect(p).toMatch(/^.+#\d+=[\d.]+$/)
    }
  })

  it("measured the whole stack, and says so — not one browser tab's JS heap", () => {
    expect(artifact.method).toMatch(/process tree/i)
    expect(artifact.method).toMatch(/NOT the browser tab heap/i)
  })

  it("proves the stack booted, so the peak is not an idle-process reading", () => {
    expect(artifact.measured.stackReady).toBe(true)
    expect(artifact.measured.readinessStatus).toBeTruthy()
  })

  it("is under the ceiling on this host, which is a real result and not a ceiling raise", () => {
    expect(artifact.measured.peakMb).toBeLessThanOrEqual(RAM_CEILING_MB)
  })
})

describe("summarise is the only place a peak is computed", () => {
  it("takes the maximum of the series, in MB, with no unit fudging", () => {
    // The unit bug this replaced divided BYTES by 1024 once and called it MB,
    // inflating a 257 MB stack to a fabricated 263 GB "breach". A series already
    // in MB must pass through untouched.
    expect(summarise([1, 2, 3])).toEqual({ peakMb: 3, samples: 3 })
    expect(summarise([255.5, 385.5, 372.1]).peakMb).toBe(385.5)
  })

  it("ignores non-numeric and non-positive samples rather than poisoning the peak", () => {
    // 10 and 20 are the only finite values > 0, so `samples` counts 2. Zero is
    // dropped deliberately: a 0 MB reading means "not sampled", and letting it
    // through would make an empty series look like a passing zero-byte peak.
    expect(summarise([10, Number.NaN, -5, 0, 20])).toEqual({ peakMb: 20, samples: 2 })
  })

  it("reports no peak for an empty series, never zero", () => {
    expect(summarise([])).toEqual({ peakMb: null, samples: 0 })
    expect(summarise([]).peakMb).toBeNull()
  })
})