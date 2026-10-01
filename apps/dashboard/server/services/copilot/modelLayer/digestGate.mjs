// WS-7 T13 — the supply-chain gate's core, as a pure function over (directory,
// manifest). `scripts/model-digest-gate.mjs` is the CLI around it; the tests
// call this directly so a failure is a returned report rather than an exit code.
//
// WHAT THIS CHECKS, in the order D15 implies:
//
//   1. the manifest is well-formed  (a digest missing is a FAILURE, not a warning —
//      D15:227, AC-032:1025)
//   2. the required AC-032 markers are present  (T13:1314)
//   3. the artifact is PRESENT  (D15:227 — a model that is not there has not been
//      verified, and saying otherwise is the honesty contract's core failure)
//   4. its size and SHA-256 match the pin
//   5. its CONTENT is safetensors or .cact  (D15:223 — renamed or not)
//   6. nothing else is in the directory  (a planted pickle is caught even when
//      the legitimate model passes, which is AC-032's actual scenario)
//
// NOT IN SCOPE, deliberately: downloading. The gate verifies what is present.
// `scripts/model-digest-gate.mjs --fetch` is the separate step that obtains it,
// and it verifies the download against the same pin before accepting it — so a
// fetch cannot become a bypass.

import { createHash } from "node:crypto"
import { readFileSync, readdirSync, lstatSync } from "node:fs"
import { join } from "node:path"

import { detectArtifactFormat } from "./artifactFormat.mjs"
import {
  ARM64_VERDICTS,
  ARTIFACT_ROLES,
  REQUIRED_MARKERS,
  manifest as buildManifest,
  validateManifest
} from "./modelManifest.mjs"

/**
 * Named failure codes. A caller branches on these, never on a message, so a
 * reworded message cannot silently change what CI treats as blocking.
 */
export const GATE_CODES = Object.freeze({
  manifestInvalid: "gate:manifest-invalid",
  manifestMissing: "gate:manifest-missing",
  artifactAbsent: "gate:artifact-absent",
  digestMissing: "gate:digest-missing",
  digestMismatch: "gate:digest-mismatch",
  sizeMismatch: "gate:size-mismatch",
  formatForbidden: "gate:format-forbidden",
  undeclaredArtifact: "gate:undeclared-artifact",
  markerMissing: "gate:marker-missing",
  artifactNotRegularFile: "gate:artifact-not-regular-file"
})

/**
 * Run every check and return a report. Never throws for a failed check — a gate
 * that throws on the first problem cannot report the rest, and a supply-chain
 * gate that reports one problem at a time gets them fixed one at a time.
 *
 * @param {object} params
 * @param {string} params.modelDir Absolute path to the artifact directory.
 * @param {object} [params.manifest] A manifest object. Defaults to the committed one.
 * @param {string} [params.manifestPath] Absolute path the manifest was read
 *   from, when it was read from a file. A manifest kept inside the artifact
 *   directory is not an artifact, and without this an operator following the
 *   `--manifest` instructions would have their own manifest reported as a
 *   substituted model.
 * @returns {{ok: boolean, modelDir: string, checks: object[], failures: object[], summary: object}}
 */
export function runGate({ modelDir, manifest = buildManifest(), manifestPath = null } = {}) {
  const checks = []
  const failures = []

  const record = (check, subject, passed, detail = {}) => {
    const row = { check, subject, passed, ...detail }
    checks.push(row)
    if (!passed) failures.push({ code: detail.code ?? `${check}:failed`, subject, message: detail.message ?? `${check} failed for ${subject}`, ...detail })
    return row
  }

  // --- 1. the manifest itself ------------------------------------------------
  const validation = validateManifestAgainst(manifest)
  record("manifest-valid", manifest?.id ?? "(unreadable)", validation.ok, {
    code: GATE_CODES.manifestInvalid,
    problems: validation.problems,
    message:
      validation.problems.length === 0
        ? "the manifest is well-formed"
        : `the manifest is not well-formed:\n  - ${validation.problems.join("\n  - ")}`
  })

  // --- 2. the AC-032 markers, named so an absent one is a build failure ------
  for (const id of REQUIRED_MARKERS) {
    const marker = (manifest?.arm64Markers ?? []).find((m) => m.id === id) ?? null
    record("marker-present", id, marker !== null, {
      code: GATE_CODES.markerMissing,
      message:
        marker === null
          ? `the required AC-032 marker "${id}" is absent from the manifest. T13:1314 requires ARM64 availability for ONNX Runtime and llama.cpp to be MEASURED or explicitly UNVERIFIED, and honesty note 6 (:1464) requires vendor claims to be UNVERIFIED. A missing row is not a passing row.`
          : `${id}: published=${marker.publishedVerdict}, executed=${marker.executedVerdict}`
    })
  }

  const artifacts = manifest?.artifacts ?? []
  const declaredNames = new Set(artifacts.map((a) => a.fileName))

  // --- 3-5. each LOADED artifact --------------------------------------------
  for (const artifact of artifacts.filter((a) => a.role === ARTIFACT_ROLES.loaded)) {
    const path = join(modelDir, artifact.fileName)

    // 3. presence. Checked BEFORE the digest so an absent file is reported as
    // absent rather than as a digest mismatch against nothing.
    if (!isRegularFile(path)) {
      record("artifact-present", artifact.fileName, false, {
        code: GATE_CODES.artifactAbsent,
        message:
          `"${artifact.fileName}" is absent from ${modelDir}. D15 (spec :227) says a model without a verified pinned digest cannot be loaded and the gate fails the build. An absent artifact has verified nothing, so this is a FAILURE and not a skip: obtain it with \`node scripts/model-digest-gate.mjs --fetch\`.`
      })
      continue
    }
    record("artifact-present", artifact.fileName, true, { message: `"${artifact.fileName}" is present` })

    const bytes = readFileSync(path)

    // 4. the digest pin. A missing pin is checked first and separately, because
    // "no pin" and "wrong pin" are different operator mistakes.
    if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      record("digest-pinned", artifact.fileName, false, {
        code: GATE_CODES.digestMissing,
        expected: artifact.sha256 ?? null,
        message: `"${artifact.fileName}" has no valid 64-character lowercase-hex SHA-256 pin (found ${JSON.stringify(artifact.sha256 ?? null)}). D15:227 — a model without a pinned digest cannot be loaded, and a missing digest must fail rather than warn (AC-032:1025).`
      })
    } else {
      record("digest-pinned", artifact.fileName, true, { expected: artifact.sha256 })
    }

    const computed = createHash("sha256").update(bytes).digest("hex")
    const digestMatches = computed === artifact.sha256
    record("digest-matches", artifact.fileName, digestMatches, {
      code: GATE_CODES.digestMismatch,
      expected: artifact.sha256 ?? null,
      computed,
      message: digestMatches
        ? `sha256 matches the pin (${computed})`
        : `sha256 MISMATCH for "${artifact.fileName}".\n  pinned:   ${artifact.sha256 ?? "(none)"}\n  computed: ${computed}\n  The bytes on disk are not the bytes that were pinned. D15:223 requires every downloaded model to be SHA-256 verified before it is loaded.`
    })

    if (typeof artifact.bytes === "number" && bytes.length !== artifact.bytes) {
      record("size-matches", artifact.fileName, false, {
        code: GATE_CODES.sizeMismatch,
        expected: artifact.bytes,
        computed: bytes.length,
        message: `"${artifact.fileName}" is ${bytes.length} bytes; the manifest records ${artifact.bytes}. A truncated download is the usual cause.`
      })
    } else {
      record("size-matches", artifact.fileName, true, { computed: bytes.length })
    }

    // 5. the format, from the CONTENT. This is the renamed-pickle control and
    // it runs even when the digest matched, because a manifest can be edited to
    // pin a pickle's own digest — and a pinned pickle is still a pickle.
    const detected = detectArtifactFormat(bytes)
    record("format-allowed", artifact.fileName, detected.allowed, {
      code: GATE_CODES.formatForbidden,
      format: detected.format,
      detectorCode: detected.code ?? null,
      message: detected.allowed
        ? `content is ${detected.format}`
        : `"${artifact.fileName}" is NOT a loadable format. ${detected.reason}. D15:223 permits safetensors and .cact only and forbids the pickle family (.bin/.pt/.pkl) — and D15:227 requires that refusal to survive renaming, so this is decided on the file's bytes and never on its name.`
    })
  }

  // --- 6. nothing else in the directory -------------------------------------
  for (const name of listDir(modelDir)) {
    if (name === ".gitignore" || name === "README.md") continue
    if (declaredNames.has(name)) continue
    if (manifestPath !== null && join(modelDir, name) === manifestPath) continue

    const path = join(modelDir, name)
    let detected = { format: "unknown", allowed: false, reason: "the file could not be read" }
    try {
      detected = detectArtifactFormat(readFileSync(path))
    } catch {
      // Unreadable: still an undeclared artifact, and the reason says so.
    }
    record("artifact-declared", name, false, {
      code: GATE_CODES.undeclaredArtifact,
      format: detected.format,
      detectorCode: detected.code ?? null,
      message: `"${name}" is in the model directory but is not declared in the manifest. Every file in the artifact directory must be a pinned, verified model; an undeclared file is how a substituted artifact arrives. Content reads as ${detected.format}${detected.reason === null ? "" : ` — ${detected.reason}`}.`
    })

    // An undeclared file whose CONTENT is a forbidden format is two problems,
    // and the format one is the urgent one: D15:225 calls pickle deserialisation
    // "a remote-code-execution surface by design". Reporting it only as
    // "undeclared" would understate it, so it is recorded as both.
    if (!detected.allowed) {
      record("format-allowed", name, false, {
        code: GATE_CODES.formatForbidden,
        format: detected.format,
        detectorCode: detected.code ?? null,
        message: `"${name}" is not a loadable format. ${detected.reason}. D15:223 permits safetensors and .cact only and forbids the pickle family (.bin/.pt/.pkl) — and D15:227 requires that refusal to survive renaming, so this is decided on the file's bytes and never on its name.`
      })
    }
  }

  return {
    ok: failures.length === 0,
    modelDir,
    manifestId: manifest?.id ?? null,
    checks,
    failures,
    summary: {
      checkCount: checks.length,
      failureCount: failures.length,
      codes: [...new Set(failures.map((f) => f.code))].sort()
    }
  }
}

/**
 * Validate a caller-supplied manifest rather than only the committed one, so a
 * test (and a reviewer with an edited file) gets the same rules applied.
 */
function validateManifestAgainst(m) {
  if (m === null || typeof m !== "object") {
    return { ok: false, problems: ["the manifest is missing or is not an object"] }
  }
  if (m.id === undefined) {
    return { ok: false, problems: ["the manifest has no `id`"] }
  }
  return validateManifest(m)
}

function isRegularFile(path) {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

function listDir(dir) {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}
