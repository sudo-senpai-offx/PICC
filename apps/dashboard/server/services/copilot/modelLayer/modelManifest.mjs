// WS-7 T13 — the model artifact manifest: the pinned digest, and the markers
// AC-032 requires. Both are DATA, so a missing marker fails a build instead of
// being a sentence in a comment.
//
// D15:220-227 — "Every downloaded model MUST be SHA-256 verified against a
// pinned expected digest and loaded via safetensors or `.cact` only. [...]
// A model without a pinned digest cannot be loaded, and the gate fails the
// build."
//
// T13:1314 — "ARM64 availability for ONNX Runtime / llama.cpp is measured or
// explicitly `UNVERIFIED`. Vendor benchmark claims are recorded as
// `UNVERIFIED` (B11)."
//
// WHY THE MARKERS ARE STRUCTURED AS PUBLISHED-AND-EXECUTED. The spec asks for
// "ARM64 availability". That phrase covers two facts a single verdict cannot
// honestly hold at once:
//
//   PUBLISHED — does an arm64 build of this component exist and is it
//               obtainable? Answerable from a registry or a file listing, and
//               ANSWERABLE FROM AN x86 HOST.
//   EXECUTED  — does it load and run on the owner's ARM device? Not answerable
//               without the device, which this task did not have.
//
// Collapsing them to one word would force a choice between a false `MEASURED`
// and an uninformative `UNVERIFIED`. Split, both are reportable: the ONNX row
// is `MEASURED` for publication with the exact tarball entry that proves it and
// `UNVERIFIED` for execution with the reason; the llama.cpp row is `UNVERIFIED`
// for both, with a reason specific enough to be actionable. See
// `__tests__/modelManifest.test.mjs` for what makes each row fail if edited.
//
// PROVENANCE OF EVERY MEASURED NUMBER BELOW. Measured in this environment on
// 2026-10-01; the command is in each row's `evidence`. Nothing here is relayed
// from a vendor or from the owner.
//
// PURE DATA + PURE FUNCTIONS. No clock, no filesystem, no network. The one
// function that touches disk is the gate script, and it reads these values.

/** The schema identifier. A manifest that does not say which shape it is cannot be validated. */
export const MANIFEST_ID = "picc-copilot-model-manifest/1"
export const MANIFEST_VERSION = "1.0.0"

/** Repo-relative. Never absolute: a manifest with a machine-specific path cannot be reviewed. */
export const ARTIFACT_DIR = "apps/dashboard/server/services/copilot/models"

/**
 * What a manifest entry is FOR, which is not the same as what it is.
 *
 * `loaded`   — T13 loads this at runtime. It MUST carry a digest; the gate
 *              fails when one is absent (AC-032's "a missing digest must fail
 *              rather than warn").
 * `declared` — a real published artifact T13 does not load. It may carry no
 *              digest, and it must then carry a reason. A digest on a
 *              `declared` entry would be a verification claim nobody performs.
 */
export const ARTIFACT_ROLES = Object.freeze({ loaded: "loaded", declared: "declared" })

/**
 * The ARM64 verdict vocabulary. Closed, so a typo cannot read as a verdict.
 *
 * `MEASURED`   — measured in THIS environment, with the command recorded.
 * `UNVERIFIED` — not measured, with the reason recorded. This is a legitimate
 *                resting state and honesty note 6 (:1464) requires it to be
 *                reachable; what it is NOT is a state that may be omitted.
 */
export const ARM64_VERDICTS = Object.freeze(["MEASURED", "UNVERIFIED"])

/**
 * The markers the gate refuses to pass without.
 *
 * T13:1314 names ONNX Runtime and llama.cpp. The model itself is included
 * because "the model runs on the device" is the question the other two are
 * proxies for, and because Needle 3's own platform list is a directly
 * observable fact that would otherwise go unrecorded.
 */
export const REQUIRED_MARKERS = Object.freeze(["onnxRuntimeNode", "llamaCpp", "needle3"])

/**
 * The artifacts.
 *
 * `needle3.cact` — the LOADED artifact. Measured from the published file:
 *   bytes  35,335,380
 *   sha256 c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38
 *   magic  84 2a e1 05 (see artifactFormat.CACT_MAGIC_HEX)
 *
 * `needle3.safetensors` — a real, published sibling (242,047,978 bytes,
 * safetensors header of 8,248 JSON bytes beginning `{"__metadata__"`). It is
 * NOT loaded: the `.cact` is Cactus's own packed on-device container and is the
 * artifact T13 pins, while the raw checkpoint is a quarter of a gigabyte that
 * T13 never opens. Fetching 242 MB to compute a digest nothing would verify
 * would be a claim dressed as a control, so the row says so instead.
 */
export const PINNED_ARTIFACTS = Object.freeze([
  Object.freeze({
    fileName: "needle3.cact",
    role: ARTIFACT_ROLES.loaded,
    format: "cact",
    bytes: 35335380,
    sha256: "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38",
    license: "apache-2.0",
    serves: Object.freeze(["copilot.experts.sentiment", "copilot.explain"]),
    source: Object.freeze({
      repository: "https://huggingface.co/Cactus-Compute/needle3",
      path: "needle3.cact",
      url: "https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact",
      gated: false,
      measuredAt: "2026-10-01"
    })
  }),
  Object.freeze({
    fileName: "needle3.safetensors",
    role: ARTIFACT_ROLES.declared,
    format: "safetensors",
    bytes: 242047978,
    sha256: null,
    license: "apache-2.0",
    notLoadedReason:
      "published sibling of the loaded .cact; T13 pins and loads the .cact only. 242 MB fetched to compute a digest nothing verifies would be an unverifiable claim, so the row records its absence of a digest instead of inventing one.",
    source: Object.freeze({
      repository: "https://huggingface.co/Cactus-Compute/needle3",
      path: "checkpoints/needle3.safetensors",
      url: "https://huggingface.co/Cactus-Compute/needle3/resolve/main/checkpoints/needle3.safetensors",
      gated: false,
      measuredAt: "2026-10-01"
    })
  })
])

/**
 * The ARM64 markers. See the header for why each row splits publication from
 * execution.
 */
export const ARM64_MARKERS = Object.freeze([
  Object.freeze({
    id: "onnxRuntimeNode",
    component: "onnxruntime-node@1.30.0",
    question: "Is an arm64 build of ONNX Runtime obtainable for the Copilot's model runtime?",
    publishedVerdict: "MEASURED",
    published: true,
    evidence:
      "Listed the published npm tarball's entries: package/bin/napi-v6/linux/arm64/libonnxruntime.so.1 (25,135,496 B) and package/bin/napi-v6/linux/arm64/onnxruntime_binding.node (394,648 B) are both present, as are win32/arm64/onnxruntime.dll and darwin/arm64/libonnxruntime.1.30.0.dylib. The package's own `os` field is only [\"win32\",\"darwin\",\"linux\"], so the tarball is the only place the arm64 fact is answerable.",
    evidenceCommand: "npm pack onnxruntime-node@1.30.0, then walk the 512-byte tar headers",
    executedVerdict: "UNVERIFIED",
    unverifiedReason:
      "No arm64 device was available to this task. Publication is not execution: nothing here has loaded on aarch64, and the arm64 shared object has not been linked, dlopen'd, or timed."
  }),
  Object.freeze({
    id: "llamaCpp",
    component: "llama.cpp (no first-party npm package) / node-llama-cpp@3.22.1",
    question: "Is an arm64 build of llama.cpp obtainable for the Copilot's model runtime?",
    publishedVerdict: "UNVERIFIED",
    published: null,
    evidence: "",
    evidenceCommand: "",
    executedVerdict: "UNVERIFIED",
    unverifiedReason:
      "llama.cpp publishes no first-party npm package (`llama.cpp` and `llamacpp` are both absent from the registry). The third-party binding node-llama-cpp@3.22.1 ships ZERO prebuilt native binaries in its npm tarball: its 11 arm64/aarch64-named entries are CMake cross-compile configs (linux.host-arm64.target-*.cmake) plus `bins/_linux-arm64.moved.txt`, a marker saying the prebuilt binaries were moved out of the npm package. The arm64 binaries are therefore distributed somewhere this task did not reach (GitHub release assets), so the npm channel cannot answer the question and the row is UNVERIFIED rather than MEASURED-with-a-guess."
  }),
  Object.freeze({
    id: "needle3",
    component: "Cactus-Compute/needle3 (Apache-2.0)",
    question: "Does the pinned model itself publish an arm64 build?",
    publishedVerdict: "MEASURED",
    published: true,
    evidence:
      "The published repository file listing includes linux-arm64/needle (1,168,392 B) and linux-arm64/libneedle.a (1,540,974 B), alongside linux-x86_64, linux-armv7, linux-mipsel, linux-riscv64, macos-arm64, android-arm64/armv7/riscv64, ios-arm64, ios-sim-arm64, tvos-arm64 and wasm.",
    evidenceCommand: "GET https://huggingface.co/api/models/Cactus-Compute/needle3?blobs=true",
    executedVerdict: "UNVERIFIED",
    unverifiedReason:
      "No arm64 device was available, and the host is x86-64. Separately and importantly: the listing contains NO windows-* directory at all, so there is no Windows native runtime for Needle 3 in the channel this repository's dev host would use. That is a measured absence and it is the reason T13's runtime loader is a seam with an injected backend rather than a direct native call."
  })
])

/**
 * B11 — spec :732, verbatim, with its own marker intact.
 *
 * "| B11 | Needle 3 in-process footprint | informational | **MEASURED
 * (vendor-reported, `UNVERIFIED`)** — 8-29 MB, 29-121M params, CQ2 2-bit,
 * android-arm64, peak_ram_mb 28.5 | Owner briefing; not independently verified |"
 *
 * The spec's own word is "MEASURED (vendor-reported, UNVERIFIED)". T13 does not
 * flatten that to either "MEASURED" or "unmeasured": the figures ARE reported
 * and they ARE unverified, and the row keeps both facts because dropping either
 * one misleads in opposite directions. Honesty note 6 (:1464) is explicit that
 * the comparative claim is "a marketing claim, not evidence".
 */
export const B11 = Object.freeze({
  id: "B11",
  verdict: "UNVERIFIED",
  provenance: "vendor-reported",
  independentlyVerified: false,
  specRow: "docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:732",
  figures: Object.freeze({
    footprintMb: "8-29 MB",
    parameters: "29-121M",
    quantization: "CQ2 2-bit",
    targetPlatform: "android-arm64",
    peakRamMb: 28.5
  }),
  comparativeClaim: Object.freeze({
    text: "beats DeepSeek V4 Flash",
    status: "UNVERIFIED",
    classification: "marketing",
    note: "honesty note 6 (spec :1464): the comparative claim is not verified and is recorded as a marketing claim, not evidence."
  }),
  note: "T13 measured the artifact's real size (35,335,380 B) and digest, which is a different measurement from B11's vendor-reported in-process footprint. Neither number supersedes the other and neither is presented as a verification of B11."
})

// ---------------------------------------------------------------------------
// Pure accessors. Each is a function so a caller cannot mutate the frozen data,
// and so a missing id is a named `null` rather than an `undefined` a caller
// might read as "present but empty".
// ---------------------------------------------------------------------------

/** The entries T13 actually loads. */
export function loadedArtifacts() {
  return PINNED_ARTIFACTS.filter((a) => a.role === ARTIFACT_ROLES.loaded)
}

/** The pinned digest for a file name, or `null`. Never a partial or a prefix. */
export function sha256PinFor(fileName) {
  const entry = PINNED_ARTIFACTS.find((a) => a.fileName === fileName)
  return entry === undefined ? null : entry.sha256
}

/** A required marker by id, or `null`. */
export function markerById(id) {
  return ARM64_MARKERS.find((m) => m.id === id) ?? null
}

/**
 * The whole manifest as one plain object — what the gate serialises, what a
 * reviewer reads, and what `JSON.stringify` in the tests inspects.
 */
export function manifest() {
  return Object.freeze({
    id: MANIFEST_ID,
    version: MANIFEST_VERSION,
    artifactDir: ARTIFACT_DIR,
    allowedFormats: Object.freeze(["safetensors", "cact"]),
    artifacts: PINNED_ARTIFACTS,
    arm64Markers: ARM64_MARKERS,
    requiredMarkers: REQUIRED_MARKERS,
    arm64Verdicts: ARM64_VERDICTS,
    b11: B11
  })
}

/**
 * Validate a manifest against its own rules, returning the problems rather
 * than throwing. The gate turns a non-empty `problems` into a build failure, so
 * this must be total: a manifest that cannot be read is itself a finding.
 *
 * @param {object} [m] Defaults to the committed manifest. A caller may pass an
 *   edited one, and the same rules apply to it — that is how a test proves a
 *   single broken rule fails, and how a reviewer checks an edit before landing it.
 * @returns {{ok: boolean, problems: string[], b11: object, artifactDir: string}}
 */
export function validateManifest(m = manifest()) {
  const problems = []

  const markers = Array.isArray(m.arm64Markers) ? m.arm64Markers : []
  const b11 = m.b11 ?? null

  for (const id of REQUIRED_MARKERS) {
    const marker = markers.find((x) => x?.id === id) ?? null
    if (marker === null) {
      problems.push(`required ARM64 marker "${id}" is absent from the manifest`)
      continue
    }
    for (const key of ["publishedVerdict", "executedVerdict"]) {
      const verdict = marker[key]
      if (!ARM64_VERDICTS.includes(verdict)) {
        problems.push(
          `ARM64 marker "${id}".${key} is ${JSON.stringify(verdict)}, which is not in the closed vocabulary [${ARM64_VERDICTS.join(", ")}]`
        )
        continue
      }
      if (verdict === "MEASURED" && !(typeof marker.evidence === "string" && marker.evidence.length > 0)) {
        problems.push(`ARM64 marker "${id}".${key} is MEASURED but carries no evidence`)
      }
      if (
        verdict === "UNVERIFIED" &&
        !(typeof marker.unverifiedReason === "string" && marker.unverifiedReason.length > 0)
      ) {
        problems.push(`ARM64 marker "${id}".${key} is UNVERIFIED but carries no reason`)
      }
    }
  }

  const artifacts = Array.isArray(m.artifacts) ? m.artifacts : []
  const seen = new Set()
  for (const artifact of artifacts) {
    const name = artifact?.fileName ?? "(unnamed)"
    if (seen.has(name)) {
      problems.push(`artifact "${name}" is declared twice`)
    }
    seen.add(name)

    if (artifact?.role === ARTIFACT_ROLES.loaded) {
      if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
        problems.push(
          `LOADED artifact "${name}" has no valid 64-hex sha256 pin — D15 (spec :227) says a model without a pinned digest cannot be loaded and the gate fails the build`
        )
      }
    } else if (artifact?.role === ARTIFACT_ROLES.declared) {
      if (artifact.sha256 !== null) {
        problems.push(
          `DECLARED artifact "${name}" carries a digest, which would be a verification claim nothing performs`
        )
      }
      if (!(typeof artifact.notLoadedReason === "string" && artifact.notLoadedReason.length > 0)) {
        problems.push(`DECLARED artifact "${name}" carries neither a digest nor a reason for having none`)
      }
    } else {
      problems.push(`artifact "${name}" has an unrecognised role ${JSON.stringify(artifact?.role)}`)
    }
  }

  if (b11 === null) {
    problems.push("B11 is absent from the manifest; spec :732 and honesty note 6 (:1464) require it recorded as UNVERIFIED")
  } else {
    if (b11.verdict !== "UNVERIFIED") {
      problems.push(
        `B11's verdict is ${JSON.stringify(b11.verdict)}; spec :732 and honesty note 6 (:1464) require UNVERIFIED`
      )
    }
    if (b11.comparativeClaim?.classification !== "marketing") {
      problems.push(
        `B11's comparative claim is classified ${JSON.stringify(b11.comparativeClaim?.classification)}; honesty note 6 (:1464) requires "marketing"`
      )
    }
  }

  return { ok: problems.length === 0, problems, b11, artifactDir: m.artifactDir ?? ARTIFACT_DIR }
}
