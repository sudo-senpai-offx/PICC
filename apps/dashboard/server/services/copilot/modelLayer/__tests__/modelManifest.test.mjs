// WS-7 T13 — AC-032's markers as DATA, and a test that makes an absent marker
// FAIL rather than pass quietly.
//
// T13:1314 — "ARM64 availability for ONNX Runtime / llama.cpp is measured or
// explicitly `UNVERIFIED`. Vendor benchmark claims are recorded as
// `UNVERIFIED` (B11)."
//
// That sentence is a trap if it is implemented as prose. Prose cannot fail a
// build, so "the ARM row says UNVERIFIED somewhere" is indistinguishable from
// "nobody ever looked". Everything here is therefore a required, named record
// with a verdict drawn from a CLOSED vocabulary, and `scripts/model-digest-gate.mjs`
// refuses to pass when one is missing. Delete the llama.cpp row and the gate
// fails; that is the property this file exists to hold.
//
// The `MEASURED` rows below were measured in THIS environment on 2026-10-01,
// and each carries the command that produced it. The distinction the rows keep
// is the one that actually matters and that "UNVERIFIED" alone would hide:
// whether an ARM64 build is PUBLISHED is a different fact from whether it RUNS
// on the owner's device, and only the first was measurable from an x86 host.

import { describe, expect, it } from "vitest"

import {
  ARM64_VERDICTS,
  ARTIFACT_ROLES,
  MANIFEST_ID,
  PINNED_ARTIFACTS,
  REQUIRED_MARKERS,
  loadedArtifacts,
  markerById,
  sha256PinFor,
  validateManifest
} from "../modelManifest.mjs"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))

describe("the digest manifest is a real, loadable record", () => {
  it("carries a schema id and a version", () => {
    expect(MANIFEST_ID).toBe("picc-copilot-model-manifest/1")
  })

  it("declares exactly one LOADED artifact, and it is the .cact", () => {
    const loaded = loadedArtifacts()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].fileName).toBe("needle3.cact")
  })

  it("pins a 64-character lowercase hex SHA-256 for every LOADED artifact", () => {
    for (const a of loadedArtifacts()) {
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it("pins the digest this environment measured for the real published artifact", () => {
    // Measured 2026-10-01 from
    // https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact
    // 35,335,380 bytes. If this constant ever changes, the artifact changed, and
    // D15 says that is a reviewable event rather than a silent update.
    expect(sha256PinFor("needle3.cact")).toBe(
      "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38"
    )
  })

  it("records the byte count the pin was measured over", () => {
    expect(loadedArtifacts()[0].bytes).toBe(35335380)
  })

  it("names a source URL and a license for the loaded artifact", () => {
    const a = loadedArtifacts()[0]
    expect(a.source.url).toMatch(/^https:\/\//)
    expect(a.license).toBe("apache-2.0")
  })

  it("declares the safetensors sibling WITHOUT a digest and says why", () => {
    // The 242 MB safetensors checkpoint is a real, published sibling. T13 does
    // not load it, so pinning a digest it never verifies would be a claim
    // nobody checks. It is recorded as declared-and-not-fetched with the reason.
    const declared = PINNED_ARTIFACTS.find((a) => a.fileName === "needle3.safetensors")
    expect(declared).toBeDefined()
    expect(declared.role).toBe(ARTIFACT_ROLES.declared)
    expect(declared.sha256).toBeNull()
    expect(declared.notLoadedReason).toBeTypeOf("string")
    expect(declared.notLoadedReason.length).toBeGreaterThan(0)
  })

  it("never gives a DECLARED artifact a digest — a digest implies it is verified", () => {
    for (const a of PINNED_ARTIFACTS) {
      if (a.role === ARTIFACT_ROLES.declared) expect(a.sha256).toBeNull()
    }
  })

  it("passes its own validator", () => {
    const result = validateManifest()
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })
})

describe("AC-032 — the ARM64 markers exist, and are named so a missing one is loud", () => {
  it("requires BOTH runtimes the spec names, plus the model itself", () => {
    expect([...REQUIRED_MARKERS]).toEqual(["onnxRuntimeNode", "llamaCpp", "needle3"])
  })

  it("has a record for every required marker", () => {
    for (const id of REQUIRED_MARKERS) {
      expect(markerById(id), `missing ARM64 marker: ${id}`).toBeDefined()
    }
  })

  it("draws every verdict from the closed vocabulary", () => {
    // The vocabulary exists so "measured" cannot be a typo of "measurde" that
    // still reads as a verdict to a human skimming the file.
    expect([...ARM64_VERDICTS]).toEqual(["MEASURED", "UNVERIFIED"])
    for (const id of REQUIRED_MARKERS) {
      const m = markerById(id)
      expect(ARM64_VERDICTS, `${id}.publishedVerdict`).toContain(m.publishedVerdict)
      expect(ARM64_VERDICTS, `${id}.executedVerdict`).toContain(m.executedVerdict)
    }
  })

  it("separates PUBLISHED from EXECUTED for every row", () => {
    for (const id of REQUIRED_MARKERS) {
      const m = markerById(id)
      expect(m).toHaveProperty("publishedVerdict")
      expect(m).toHaveProperty("executedVerdict")
    }
  })

  it("requires evidence on every MEASURED verdict and refuses a bare one", () => {
    for (const id of REQUIRED_MARKERS) {
      const m = markerById(id)
      for (const key of ["publishedVerdict", "executedVerdict"]) {
        if (m[key] === "MEASURED") {
          expect(m.evidence, `${id}.${key} is MEASURED with no evidence`).toBeTypeOf("string")
          expect(m.evidence.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it("requires a REASON on every UNVERIFIED verdict", () => {
    // "UNVERIFIED" with no reason is indistinguishable from "nobody looked",
    // which is the exact state honesty note 6 (:1464) exists to prevent.
    for (const id of REQUIRED_MARKERS) {
      const m = markerById(id)
      for (const key of ["publishedVerdict", "executedVerdict"]) {
        if (m[key] === "UNVERIFIED") {
          expect(m.unverifiedReason, `${id}.${key} is UNVERIFIED with no reason`).toBeTypeOf("string")
          expect(m.unverifiedReason.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it("records llama.cpp as UNVERIFIED — it genuinely is, and is not rounded up", () => {
    // Measured 2026-10-01: llama.cpp publishes no first-party npm package at
    // all, and the third-party binding `node-llama-cpp@3.22.1` ships ZERO
    // prebuilt native binaries in its npm tarball — its arm64-named entries are
    // CMake cross-compile configs and a `bins/_linux-arm64.moved.txt` marker
    // saying the binaries moved out. The npm channel does not carry a
    // linux-arm64 build, and this task did not fetch GitHub release assets.
    const m = markerById("llamaCpp")
    expect(m.publishedVerdict).toBe("UNVERIFIED")
    expect(m.unverifiedReason).toMatch(/npm/i)
  })

  it("records ONNX Runtime ARM64 as MEASURED with the tarball entry that proves it", () => {
    // Measured 2026-10-01 from the onnxruntime-node@1.30.0 npm tarball, whose
    // contents include `package/bin/napi-v6/linux/arm64/libonnxruntime.so.1`
    // (25,135,496 B) and `.../linux/arm64/onnxruntime_binding.node` (394,648 B).
    // The package's `os` field is only ["win32","darwin","linux"], so the tarball
    // is the only place the arm64 fact is answerable.
    const m = markerById("onnxRuntimeNode")
    expect(m.publishedVerdict).toBe("MEASURED")
    expect(m.evidence).toMatch(/libonnxruntime\.so\.1/)
  })

  it("records execution as UNVERIFIED everywhere — no ARM64 device was involved", () => {
    for (const id of REQUIRED_MARKERS) {
      expect(markerById(id).executedVerdict, `${id} execution was not measured`).toBe("UNVERIFIED")
    }
  })
})

describe("B11 — vendor claims are UNVERIFIED, and the comparative claim is a claim", () => {
  it("records B11's figures with the spec's own UNVERIFIED marker", () => {
    // spec :732 verbatim: "MEASURED (vendor-reported, `UNVERIFIED`) — 8-29 MB,
    // 29-121M params, CQ2 2-bit, android-arm64, peak_ram_mb 28.5".
    const b11 = validateManifest().b11
    expect(b11.verdict).toBe("UNVERIFIED")
    expect(b11.provenance).toBe("vendor-reported")
    expect(b11.figures).toEqual({
      footprintMb: "8-29 MB",
      parameters: "29-121M",
      quantization: "CQ2 2-bit",
      targetPlatform: "android-arm64",
      peakRamMb: 28.5
    })
  })

  it("records the comparative claim as marketing, not evidence", () => {
    // honesty note 6 (:1464): the "beats DeepSeek V4 Flash" claim "is **not
    // verified** and is recorded as a marketing claim, not evidence."
    const b11 = validateManifest().b11
    expect(b11.comparativeClaim.status).toBe("UNVERIFIED")
    expect(b11.comparativeClaim.classification).toBe("marketing")
    expect(b11.comparativeClaim.text).toBeTypeOf("string")
  })

  it("names what independently verified B11, which is nothing", () => {
    expect(validateManifest().b11.independentlyVerified).toBe(false)
  })
})

describe("the manifest is plain data a room or an auditor can read without executing it", () => {
  it("serialises to JSON with no function values and no absolute local paths", () => {
    const text = JSON.stringify(validateManifest(), null, 2)
    expect(text).not.toMatch(/[A-Za-z]:\\\\/)
    expect(text).not.toMatch(/[A-Za-z]:\//)
    expect(() => JSON.parse(text)).not.toThrow()
  })

  it("declares the directory it expects artifacts in, as a repo-relative path", () => {
    const d = validateManifest().artifactDir
    expect(d).toBe("apps/dashboard/server/services/copilot/models")
    expect(d.startsWith("/")).toBe(false)
  })

  it("points the artifactDir at a real .gitignore, so the bytes are never tracked", () => {
    const root = join(HERE, "..", "..", "..", "..", "..", "..", "..")
    const gitignore = readFileSync(join(root, "apps/dashboard/server/services/copilot/models/.gitignore"), "utf8")
    expect(gitignore).toMatch(/needle3\.cact/)
  })
})
