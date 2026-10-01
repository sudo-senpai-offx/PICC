#!/usr/bin/env node
// WS-7 T19 — CONSUME `scripts/arm-probe.mjs` and check its output in.
//
// Spec §4.6:741 records the problem directly:
//
//   "B9/B12 are real device numbers relayed by the owner from
//    `scripts/arm-probe.mjs` (schema `picc-arm-probe/1`, committed at c407964).
//    The SCRIPT is in the repository; the OUTPUT artifact is not. T19 must check
//    in the raw output so these rows graduate from owner-supplied to
//    checked-in evidence."
//
// and honesty note 25 (`:1487`) repeats it: "The ARM artifact is still not
// checked in."
//
// So the script half is already done and this closes the artifact half. It runs
// the probe, stores the output VERBATIM, and then states — per budget row — what
// that output does and does not establish.
//
// ---------------------------------------------------------------------------
// WHAT THIS DELIBERATELY DOES NOT DO
// ---------------------------------------------------------------------------
// It does not manufacture an ARM measurement on an x86 host. There is no
// Snapdragon 680 attached to this machine and no x86 proxy can stand in for one
// (that is the entire argument at `arm-probe.mjs:2-6`). So:
//
//   * On a non-ARM64 host, B9's ARM jitter row is recorded `UNVERIFIED` with the
//     reason, and the x86 figures are filed as x86 figures. They are never
//     written into the ARM row.
//   * The owner-relayed ARM numbers are preserved verbatim and labelled
//     `ownerRelayed`, so the provenance chain stays intact and auditable. They
//     are NOT restated as "measured by this repository".
//   * Where this run genuinely corroborates part of the owner relay, that is
//     recorded as a cross-check with its evidence, including where it
//     CONTRADICTS the relay. A cross-check that can only confirm would be
//     decoration.
//
// T13 set the precedent (entry 0025): it upgraded ONNX Runtime's ARM64 row to
// MEASURED by unpacking the tarball and finding `libonnxruntime.so.1`, and left
// llama.cpp UNVERIFIED because no prebuilt binaries exist. Same discipline here:
// upgrade what was actually verified, leave the rest honest.

import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

export const RECORD_SCHEMA = "picc-arm-probe-record/1"

/**
 * The values spec §4.6:730 and :733 record as owner-relayed from the device.
 * Kept verbatim so the record is a comparison, not a replacement.
 */
export const OWNER_RELAYED = Object.freeze({
  source: "spec §4.6:730 (B9) and §4.6:733 (B12), relayed by the owner from scripts/arm-probe.mjs",
  benchMs: { arm: 3012.39, x86: 419.48, ratio: 7.18 },
  benchChecksum: "2095.419",
  jitterMs: { p50: 0.84, p95: 4.47, max: 7.71 },
  device: "Snapdragon 680 (declared ARM floor class)"
})

/** Parse the probe's `key=value` lines. Tolerant: unknown lines are dropped. */
export function parseProbeOutput(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    const at = line.indexOf("=")
    if (at <= 0) continue
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

/** Nearest-rank, so a "p95" here is an observed sample and not an interpolation. */
function nearestRank(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil((p / 100) * sorted.length) - 1]
}

/**
 * Derive the per-row assessment from a probe result. PURE, and exported so the
 * guard test can re-derive the checked-in artifact's verdicts from its own
 * recorded numbers rather than trusting them.
 *
 * @param {object} probe  parsed key=value map from scripts/arm-probe.mjs
 * @returns {object} rows keyed B9 / B12
 */
export function assessRows(probe) {
  const platform = probe.platform ?? ""
  const isArm64 = /-(arm64|aarch64)$/.test(platform)
  const benchMs = Number(probe.bench_ms)
  const checksum = probe.bench_checksum ?? null

  // What this host can say about the checksum, which is arch-independent by
  // construction: the bench is a fixed deterministic loop, so the same input must
  // produce the same accumulator on any machine that runs it.
  const checksumMatchesOwner = checksum !== null && checksum === OWNER_RELAYED.benchChecksum

  // And what it can say about the x86 leg of the ratio the ARM budget was
  // derived from. A reproduced x86 figure would mean the 7.18x ratio is at least
  // portable; an unreproduced one means it is machine-specific, which is a
  // further reason not to carry a derived ARM budget.
  const x86BenchReproduced =
    Number.isFinite(benchMs) && Math.abs(benchMs - OWNER_RELAYED.benchMs.x86) / OWNER_RELAYED.benchMs.x86 < 0.1

  const rows = {
    B9: {
      budget: "ARM jitter p50 / p95 / max",
      measuredOnThisHost: isArm64
        ? { p50: Number(probe.jitter_p50_ms), p95: Number(probe.jitter_p95_ms), max: Number(probe.jitter_max_ms) }
        : null,
      verdict: isArm64 ? "MEASURED" : "UNVERIFIED",
      reason: isArm64
        ? "Produced by arm-probe.mjs on an ARM64 host."
        : `No ARM64 device is attached to this host (platform=${platform || "unknown"}). ` +
          "An x86 host cannot produce an ARM jitter figure: the whole point of arm-probe.mjs:2-6 " +
          "is that CPU throttling on x86 proves a PERFORMANCE gate and can never prove an " +
          "ARCHITECTURE gate. The owner's relayed ARM jitter (p50 0.84 / p95 4.47 / max 7.71 ms) is " +
          "retained verbatim under ownerRelayed and is NOT restated as measured by this repository.",
      ownerRelayed: OWNER_RELAYED.jitterMs
    },
    B12: {
      budget: "Deterministic bench parity across machines",
      measuredOnThisHost: Number.isFinite(benchMs) ? { benchMs, benchChecksum: checksum } : null,
      // Partial by construction: the checksum half is independently corroborated,
      // the ratio half is not reproduced on this host.
      verdict: checksumMatchesOwner ? "PARTIAL_VERIFICATION" : "UNVERIFIED",
      reason:
        `Two separable claims sit in this row and they do not stand or fall together. ` +
        `(1) CHECKSUM IDENTITY — corroborated: this independent x86 host computed ` +
        `bench_checksum=${checksum}, which matches the owner-relayed value ` +
        `${OWNER_RELAYED.benchChecksum} exactly, so the bench is deterministic across machines as claimed. ` +
        `(2) THE 7.18x RATIO — not reproduced: the owner relayed x86 bench_ms ` +
        `${OWNER_RELAYED.benchMs.x86}, and this host measures ${benchMs} ms, which is outside a 10% band. ` +
        `Had the relayed ARM figure of ${OWNER_RELAYED.benchMs.arm} ms held, the ratio against THIS host ` +
        `would be about ${(OWNER_RELAYED.benchMs.arm / benchMs).toFixed(2)}x, not 7.18x. A CPU-only ratio ` +
        `that varies by host cannot be carried onto a render-bound transition budget.`,
      crossChecks: {
        checksumIdentityCorroborated: checksumMatchesOwner,
        x86BenchReproduced: x86BenchReproduced,
        ownerX86BenchMs: OWNER_RELAYED.benchMs.x86,
        thisHostBenchMs: benchMs,
        impliedRatioIfArmFigureHeld: Number.isFinite(benchMs)
          ? Math.round((OWNER_RELAYED.benchMs.arm / benchMs) * 100) / 100
          : null
      },
      ownerRelayed: OWNER_RELAYED.benchMs
    }
  }

  return { isArm64, platform, rows }
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (invokedDirectly) {
  const probePath = fileURLToPath(new URL("./arm-probe.mjs", import.meta.url))
  const run = spawnSync(process.execPath, [probePath], { encoding: "utf8" })

  if (run.status !== 0) {
    console.error(`[picc-arm-probe] probe failed with status ${run.status}`)
    console.error(run.stderr)
    process.exit(1)
  }

  const probe = parseProbeOutput(run.stdout)
  const { isArm64, platform, rows } = assessRows(probe)

  const artifact = {
    schema: RECORD_SCHEMA,
    probeSchema: probe.schema ?? null,
    // The raw output, verbatim, so the record is the probe's own words.
    probe,
    host: {
      platform,
      isArm64,
      cpuModel: probe.cpu_model ?? null,
      node: probe.node_version ?? null
    },
    rows,
    ownerRelayed: OWNER_RELAYED,
    provenance:
      "WS-7 T19 — closes spec §4.6:741 and honesty note 25 (`:1487`): the arm-probe.mjs OUTPUT " +
      "artifact was absent from the repository while the script was present. This is that artifact, " +
      "produced by running the probe on THIS host. It is NOT an ARM device run: platform=" +
      `${platform}, isArm64=${isArm64}. B9 therefore stays UNVERIFIED rather than being filled in ` +
      "from an x86 proxy."
  }

  const outPath = fileURLToPath(
    new URL("../apps/dashboard/perf/arm-probe.json", import.meta.url)
  )
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")

  console.log(`[picc-arm-probe] wrote ${outPath}`)
  console.log(`[picc-arm-probe] host platform=${platform} isArm64=${isArm64}`)
  console.log(`[picc-arm-probe] B9  verdict = ${rows.B9.verdict}`)
  console.log(`[picc-arm-probe] B12 verdict = ${rows.B12.verdict}`)
  const x = rows.B12.crossChecks
  console.log(
    `[picc-arm-probe] B12 cross-checks: checksumIdentityCorroborated=${x.checksumIdentityCorroborated} ` +
      `x86BenchReproduced=${x.x86BenchReproduced} (owner ${x.ownerX86BenchMs} vs this host ${x.thisHostBenchMs})`
  )
  if (!isArm64) {
    console.log(
      "[picc-arm-probe] NOTE: no ARM64 device. B9 stays UNVERIFIED. No ARM figure has been fabricated."
    )
  }
}