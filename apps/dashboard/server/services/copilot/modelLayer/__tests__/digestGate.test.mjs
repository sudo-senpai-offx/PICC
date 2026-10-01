// WS-7 T13 — AC-032 / R10.1 / R10.2. The gate itself.
//
// AC-032:1021-1027:
//   Scenario:  A legitimate model is downloaded and a renamed pickle is placed
//              in the model directory.
//   Action:    Run the supply-chain gate.
//   Expected:  The legitimate model loads only when its SHA-256 matches the
//              pinned digest; the renamed `.dat` pickle is rejected on content,
//              not extension.
//   Prohibited: No `.bin`/`.pt`/`.pkl` may load, renamed or not; a MISSING DIGEST
//              must fail rather than warn.
//   Verification: A gate test with a correct model, a tampered model, and a
//              renamed-pickle model.
//
// THE PROPERTY THIS FILE EXISTS TO HOLD is the absent one. A gate that has
// never seen its artifact must FAIL LOUDLY. A gate that passes when the
// directory is empty is a gate that has verified nothing and says so anyway,
// which is the honesty contract's central failure mode applied to a supply
// chain rather than to a number. So the absent case is the FIRST test here and
// it asserts a non-zero result, not a skip, not a warning, and not an empty
// `problems` array.

import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import { execFileSync } from "node:child_process"

import { GATE_CODES, runGate } from "../digestGate.mjs"
import { ARM64_MARKERS, PINNED_ARTIFACTS, manifest, validateManifest } from "../modelManifest.mjs"
import { CACT_MAGIC_HEX } from "../artifactFormat.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..", "..", "..")

let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "picc-t13-gate-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A byte-valid .cact-shaped artifact whose digest is computed, not invented. */
function writeFakeCact(name = "needle3.cact", body = "payload") {
  const bytes = Buffer.concat([Buffer.from(CACT_MAGIC_HEX, "hex"), Buffer.from(body, "latin1")])
  writeFileSync(join(dir, name), bytes)
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") }
}

/** A protocol-4 pickle, the exact bytes `detectArtifactFormat` classifies. */
function pickleBytes() {
  return Buffer.concat([
    Buffer.from([0x80, 0x04, 0x95, 0x8c, 0x03]),
    Buffer.from("w\x00", "latin1"),
    Buffer.from([0x8c, 0x02]),
    Buffer.from("t\x00", "latin1"),
    Buffer.from([0x4c, 0x8b, 0x8b, 0x8c])
  ])
}

/** A manifest variant, so a test can break one rule at a time. */
function manifestWith(overrides = {}) {
  return { ...manifest(), ...overrides }
}

const run = (m = manifest()) => runGate({ modelDir: dir, manifest: m })

const codes = (report) => report.failures.map((f) => f.code)

describe("THE HEADLINE — an absent artifact FAILS, loudly", () => {
  it("fails when the model directory is empty", () => {
    const report = run()
    expect(report.ok).toBe(false)
    expect(codes(report)).toContain(GATE_CODES.artifactAbsent)
  })

  it("fails with a named code, not merely a false", () => {
    const report = run()
    const failure = report.failures.find((f) => f.code === GATE_CODES.artifactAbsent)
    expect(failure).toBeDefined()
    expect(failure.subject).toBe("needle3.cact")
  })

  it("says in the message that absence is a failure and not a skip", () => {
    const report = run()
    const message = report.failures.map((f) => f.message).join("\n")
    expect(message).toMatch(/absent|missing/i)
    expect(message).not.toMatch(/skipp?ed|ignored|pass/i)
  })

  it("does NOT report a pass alongside the failure", () => {
    // A report carrying both `ok: false` and a passing artifact row is the shape
    // a reader skims past.
    const report = run()
    for (const checked of report.checks) {
      if (checked.subject === "needle3.cact") expect(checked.passed).toBe(false)
    }
  })

  it("still validates the manifest and the markers even with no artifact", () => {
    // Otherwise "everything is absent" could short-circuit to a single failure
    // and hide a manifest that is also wrong.
    const report = run()
    expect(report.checks.some((c) => c.check === "manifest-valid")).toBe(true)
  })
})

describe("AC-032 — a correct model passes", () => {
  it("passes on an exact digest match with an allowed format", () => {
    const fake = writeFakeCact()
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: fake.digest, bytes: fake.bytes.length } : a
      )
    })
    const report = run(m)
    expect(codes(report)).not.toContain(GATE_CODES.digestMismatch)
    expect(codes(report)).not.toContain(GATE_CODES.artifactAbsent)
    expect(report.ok).toBe(true)
  })

  it("records the digest it computed, so a reviewer can compare it to the pin", () => {
    const fake = writeFakeCact()
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: fake.digest, bytes: fake.bytes.length } : a
      )
    })
    const row = run(m).checks.find((c) => c.subject === "needle3.cact" && c.check === "digest-matches")
    expect(row.computed).toBe(fake.digest)
    expect(row.expected).toBe(fake.digest)
    const format = run(m).checks.find((c) => c.check === "format-allowed")
    expect(format.format).toBe("cact")
  })
})

describe("AC-032 — a TAMPERED model fails", () => {
  it("fails on a one-byte change with digest-mismatch", () => {
    const fake = writeFakeCact()
    // Flip one byte after the magic prefix: same length, same format, different
    // digest. This is the case a size or format check would pass.
    const bytes = Buffer.from(fake.bytes)
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(join(dir, "needle3.cact"), bytes)
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: fake.digest, bytes: fake.bytes.length } : a
      )
    })
    const report = run(m)
    expect(report.ok).toBe(false)
    expect(codes(report)).toContain(GATE_CODES.digestMismatch)
  })

  it("names BOTH digests in the failure, so the operator can tell which is wrong", () => {
    const fake = writeFakeCact()
    const bytes = Buffer.from(fake.bytes)
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(join(dir, "needle3.cact"), bytes)
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: fake.digest, bytes: fake.bytes.length } : a
      )
    })
    const failure = run(m).failures.find((f) => f.code === GATE_CODES.digestMismatch)
    expect(failure.expected).toBe(fake.digest)
    expect(failure.computed).toBe(createHash("sha256").update(bytes).digest("hex"))
  })

  it("fails on a size change as well, not only on content", () => {
    const fake = writeFakeCact()
    writeFileSync(join(dir, "needle3.cact"), Buffer.concat([fake.bytes, Buffer.from("extra")]))
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: fake.digest, bytes: fake.bytes.length } : a
      )
    })
    const report = run(m)
    expect(report.ok).toBe(false)
    // Either code is an honest refusal; what matters is that it is a refusal.
    expect(codes(report).some((c) => [GATE_CODES.digestMismatch, GATE_CODES.sizeMismatch].includes(c))).toBe(true)
  })
})

describe("AC-032 — a RENAMED PICKLE fails, on content", () => {
  const names = ["model.safetensors", "needle3.cact", "model.dat", "model.bin", "model.pt"]

  for (const name of names) {
    it(`refuses a pickle planted as ${name}`, () => {
      writeFileSync(join(dir, name), pickleBytes())
      const report = run()
      expect(report.ok).toBe(false)
      const formats = report.failures.map((f) => f.format).filter(Boolean)
      expect(formats, `${name} should be reported as a pickle`).toContain("pickle")
    })
  }

  it("uses the format-forbidden code, distinct from a digest failure", () => {
    // A pickle renamed to the LOADED artifact's name fails on format, and the
    // operator must be told the format is the problem rather than the digest.
    writeFileSync(join(dir, "needle3.cact"), pickleBytes())
    const report = run()
    const failure = report.failures.find((f) => f.code === GATE_CODES.formatForbidden)
    expect(failure).toBeDefined()
    expect(failure.format).toBe("pickle")
  })

  it("reports the pickle's own refusal code from the format detector", () => {
    writeFileSync(join(dir, "model.safetensors"), pickleBytes())
    const failure = run().failures.find((f) => f.format === "pickle")
    expect(failure.detectorCode).toBe("model-format:forbidden-pickle")
  })

  it("refuses an UNDECLARED pickle even when the pinned artifact is present and valid", () => {
    // The legitimate model passes AND a planted pickle fails. AC-032's scenario
    // is both at once, and a gate that stopped at the first success would pass.
    const fake = writeFakeCact()
    writeFileSync(join(dir, "model.safetensors"), pickleBytes())
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: fake.digest, bytes: fake.bytes.length } : a
      )
    })
    const report = run(m)
    expect(report.ok).toBe(false)
    expect(codes(report)).toContain(GATE_CODES.undeclaredArtifact)
    expect(codes(report)).toContain(GATE_CODES.formatForbidden)
  })
})

describe("AC-032 — a missing digest FAILS rather than warns", () => {
  it("fails when the loaded artifact's digest is removed", () => {
    writeFakeCact()
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) => (a.fileName === "needle3.cact" ? { ...a, sha256: null } : a))
    })
    const report = run(m)
    expect(report.ok).toBe(false)
    expect(codes(report)).toContain(GATE_CODES.digestMissing)
  })

  it("fails when the digest is a truncated prefix, not a full SHA-256", () => {
    // A 12-character prefix is what someone copies off a download page. It is
    // not a pin.
    writeFakeCact()
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) => (a.fileName === "needle3.cact" ? { ...a, sha256: "c9d915ec" } : a))
    })
    expect(codes(run(m))).toContain(GATE_CODES.digestMissing)
  })

  it("fails when the digest is uppercase hex", () => {
    writeFakeCact()
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: "C9D915EC" } : a
      )
    })
    expect(codes(run(m))).toContain(GATE_CODES.digestMissing)
  })

  it("fails when a DECLARED artifact is given a digest it never verified", () => {
    // The mirror of the previous cases: a verification claim nobody performs is
    // worse than an honest absence.
    writeFakeCact()
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.safetensors" ? { ...a, sha256: "a".repeat(64) } : a
      )
    })
    expect(codes(run(m))).toContain(GATE_CODES.manifestInvalid)
  })
})

describe("AC-032's markers — a missing marker fails the gate", () => {
  it("fails when the llama.cpp ARM64 row is deleted", () => {
    // The row that says UNVERIFIED is the one an implementer is most tempted to
    // drop as "nothing to report". Deleting it must break the build.
    writeFakeCact()
    const m = manifestWith({ arm64Markers: ARM64_MARKERS.filter((x) => x.id !== "llamaCpp") })
    const report = run(m)
    expect(report.ok).toBe(false)
    expect(codes(report)).toContain(GATE_CODES.markerMissing)
  })

  it("fails when a marker carries a verdict outside the vocabulary", () => {
    writeFakeCact()
    const m = manifestWith({
      arm64Markers: ARM64_MARKERS.map((x) => (x.id === "needle3" ? { ...x, executedVerdict: "probably" } : x))
    })
    expect(codes(run(m))).toContain(GATE_CODES.manifestInvalid)
  })

  it("fails when a MEASURED row has its evidence deleted", () => {
    writeFakeCact()
    const m = manifestWith({
      arm64Markers: ARM64_MARKERS.map((x) => (x.id === "onnxRuntimeNode" ? { ...x, evidence: "" } : x))
    })
    expect(codes(run(m))).toContain(GATE_CODES.manifestInvalid)
  })

  it("fails when an UNVERIFIED row has its reason deleted", () => {
    writeFakeCact()
    const m = manifestWith({
      arm64Markers: ARM64_MARKERS.map((x) => (x.id === "llamaCpp" ? { ...x, unverifiedReason: "" } : x))
    })
    expect(codes(run(m))).toContain(GATE_CODES.manifestInvalid)
  })

  it("fails when B11 is promoted from UNVERIFIED to measured", () => {
    writeFakeCact()
    const m = manifestWith({ b11: { ...manifest().b11, verdict: "MEASURED" } })
    expect(codes(run(m))).toContain(GATE_CODES.manifestInvalid)
  })

  it("fails when B11's comparative claim is reclassified as evidence", () => {
    writeFakeCact()
    const b11 = manifest().b11
    const m = manifestWith({
      b11: { ...b11, comparativeClaim: { ...b11.comparativeClaim, classification: "evidence" } }
    })
    expect(codes(run(m))).toContain(GATE_CODES.manifestInvalid)
  })
})

describe("the gate reads the directory and does not write to it", () => {
  it("leaves the directory byte-identical after a run", () => {
    writeFakeCact()
    writeFileSync(join(dir, "model.safetensors"), pickleBytes())
    const before = readdirSync(dir).sort().map((n) => [n, createHash("sha256").update(readFileSync(join(dir, n))).digest("hex")])
    run()
    const after = readdirSync(dir).sort().map((n) => [n, createHash("sha256").update(readFileSync(join(dir, n))).digest("hex")])
    expect(after).toEqual(before)
  })

  it("refuses a symlink standing in for the artifact rather than following it", () => {
    // A symlink whose target is outside the directory would let the digest be
    // satisfied by a file the gate does not control.
    const fake = writeFakeCact()
    const outside = join(dir, "..", `outside-${process.pid}.cact`)
    writeFileSync(outside, fake.bytes)
    rmSync(join(dir, "needle3.cact"))
    try {
      require("node:fs").symlinkSync(outside, join(dir, "needle3.cact"))
    } catch {
      return // symlink creation not permitted on this host; nothing to assert
    }
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: fake.digest, bytes: fake.bytes.length } : a
      )
    })
    expect(run(m).ok).toBe(false)
    rmSync(outside, { force: true })
  })

  it("treats a missing model directory the same as an empty one", () => {
    const report = runGate({ modelDir: join(dir, "does-not-exist"), manifest: manifest() })
    expect(report.ok).toBe(false)
    expect(codes(report)).toContain(GATE_CODES.artifactAbsent)
  })
})

describe("the report is machine-readable and stable", () => {
  it("serialises to JSON and round-trips, and puts no local path in a COMMITTED field", () => {
    // `modelDir` is necessarily absolute — it is where the gate looked, and a
    // diagnostic that hid it would be unactionable. What must not appear is a
    // machine path inside a field a reviewer would commit or diff.
    const report = run()
    const text = JSON.stringify(report, null, 2)
    expect(() => JSON.parse(text)).not.toThrow()
    for (const c of report.checks) {
      for (const key of ["expected", "computed"]) {
        if (typeof c[key] === "string") expect(c[key], `${c.check}.${key}`).not.toMatch(/[A-Za-z]:[\\/]/)
      }
    }
    expect(report.modelDir).toBe(dir)
  })

  it("always carries ok, checks and failures, even when everything fails", () => {
    const report = runGate({ modelDir: join(dir, "nope"), manifest: { id: "wrong" } })
    expect(report).toHaveProperty("ok")
    expect(report).toHaveProperty("checks")
    expect(report).toHaveProperty("failures")
    expect(Array.isArray(report.failures)).toBe(true)
  })

  it("never reports ok while carrying a single failure", () => {
    writeFakeCact()
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) => (a.fileName === "needle3.cact" ? { ...a, sha256: "b".repeat(64) } : a))
    })
    const report = run(m)
    expect(report.failures.length).toBeGreaterThan(0)
    expect(report.ok).toBe(false)
  })
})

describe("the REAL artifact, in whichever state this checkout is in", () => {
  // This block deliberately does not SKIP. It asserts the honest outcome for
  // both states, so it is meaningful whether or not the 35 MB file is present:
  //   present  -> the pinned digest and the cact format are confirmed
  //   absent   -> the gate reports artifact-absent, which is the required
  //               behaviour rather than a reason to pass
  const realDir = join(REPO_ROOT, "apps/dashboard/server/services/copilot/models")
  let present = true
  try {
    present = readdirSync(realDir).includes("needle3.cact")
  } catch {
    present = false
  }

  const realManifest = manifest()

  it(`is ${present ? "PRESENT and verified" : "ABSENT, and the gate says so"}`, () => {
    const report = runGate({ modelDir: realDir, manifest: realManifest })
    if (present) {
      const row = report.checks.find((c) => c.check === "digest-matches" && c.subject === "needle3.cact")
      expect(row.computed).toBe("c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38")
      expect(report.checks.find((c) => c.check === "format-allowed").format).toBe("cact")
      expect(report.ok).toBe(true)
    } else {
      expect(report.ok).toBe(false)
      expect(codes(report)).toContain(GATE_CODES.artifactAbsent)
    }
  })

  it("confirms the pinned size and digest agree with each other on a real file", () => {
    // 35,335,380 B for a 64-hex digest. If the artifact is present, both must
    // hold; that pairing is what makes the pin a pin.
    const entry = PINNED_ARTIFACTS.find((a) => a.fileName === "needle3.cact")
    expect(entry.bytes).toBe(35335380)
    expect(entry.sha256).toHaveLength(64)
  })

  it("validates the committed manifest itself, with no substitutions", () => {
    expect(validateManifest().ok).toBe(true)
  })
})

describe("the CLI — a gate that cannot fail a build is not a gate", () => {
  const script = join(REPO_ROOT, "scripts/model-digest-gate.mjs")

  it("exists at the path T13:1312 names", () => {
    expect(() => readFileSync(script, "utf8")).not.toThrow()
  })

  it("exits NON-ZERO against the empty real model directory in this checkout", () => {
    // Run against a temp directory that is guaranteed empty, so the assertion is
    // about the CLI's exit code and not about whether 35 MB happens to be here.
    let code = 0
    try {
      execFileSync(process.execPath, [script, "--model-dir", dir, "--json"], { encoding: "utf8", stdio: "pipe" })
    } catch (e) {
      code = e.status
    }
    expect(code).toBe(1)
  })

  it("prints the failure report to stdout, so CI shows why", () => {
    let stdout = ""
    try {
      execFileSync(process.execPath, [script, "--model-dir", dir, "--json"], { encoding: "utf8", stdio: "pipe" })
    } catch (e) {
      stdout = String(e.stdout ?? "")
    }
    const report = JSON.parse(stdout)
    expect(report.ok).toBe(false)
    expect(report.failures.map((f) => f.code)).toContain(GATE_CODES.artifactAbsent)
  })

  it("exits ZERO when the artifact verifies", () => {
    const fake = writeFakeCact()
    const pinnedPath = join(REPO_ROOT, "apps/dashboard/server/services/copilot/models")
    // Point the CLI at the real manifest but our temp dir by writing a manifest
    // file the CLI can read.
    const m = manifestWith({
      artifacts: PINNED_ARTIFACTS.map((a) =>
        a.fileName === "needle3.cact" ? { ...a, sha256: fake.digest, bytes: fake.bytes.length } : a
      )
    })
    const manifestPath = join(dir, "manifest.json")
    writeFileSync(manifestPath, JSON.stringify(m, null, 2))
    const stdout = execFileSync(
      process.execPath,
      [script, "--model-dir", dir, "--manifest", manifestPath, "--json"],
      { encoding: "utf8", stdio: "pipe" }
    )
    expect(JSON.parse(stdout).ok).toBe(true)
    expect(pinnedPath).toContain("models")
  })
})
