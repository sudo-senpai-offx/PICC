#!/usr/bin/env node
// WS-7 T13 — the D15 supply-chain gate. T13:1312 names this file; AC-032 is its
// acceptance criterion.
//
// D15:220-227 — "Every downloaded model MUST be SHA-256 verified against a
// pinned expected digest and loaded via safetensors or `.cact` only.
// Pickle-family formats (`.bin`, `.pt`, `.pkl`) are forbidden. This is enforced
// as a CI gate. [...] A model without a pinned digest cannot be loaded, and the
// gate fails the build."
//
// EXIT CODES. 0 = every check passed. 1 = at least one check failed. Nothing
// else: a gate that could exit non-zero for a reason unrelated to a check would
// be indistinguishable, in CI's red column, from a real finding. The failure
// report goes to STDOUT as JSON so a CI step can surface it verbatim, and a
// human-readable summary goes to STDERR.
//
// THE ABSENCE CASE. Run with an empty model directory, this exits 1. That is
// the intended behaviour and it is stated here because it is the property most
// likely to be "fixed" by someone who reads a red build as a nuisance: a gate
// that has never seen its artifact has verified nothing, and reporting success
// would be the honesty contract's central failure applied to a supply chain.
//
// USAGE
//   node scripts/model-digest-gate.mjs                  # verify what is present
//   node scripts/model-digest-gate.mjs --json           # machine-readable only
//   node scripts/model-digest-gate.mjs --fetch          # obtain first, then verify
//   node scripts/model-digest-gate.mjs --model-dir <p> --manifest <p>
//
// `--fetch` is deliberately a separate verb. Obtaining an artifact and verifying
// it are different acts, and a gate that fetched as a side effect of verifying
// would have no failure state for a missing file.

import { createHash } from "node:crypto"
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { runGate } from "../apps/dashboard/server/services/copilot/modelLayer/digestGate.mjs"
import { manifest as buildManifest } from "../apps/dashboard/server/services/copilot/modelLayer/modelManifest.mjs"
import { detectArtifactFormat } from "../apps/dashboard/server/services/copilot/modelLayer/artifactFormat.mjs"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const USAGE = `picc model-digest-gate — WS-7 T13 / D15

  --json              emit the report as JSON on stdout (default: JSON + a human summary on stderr)
  --fetch             download each LOADED artifact from its pinned source before verifying
  --model-dir <path>  the artifact directory (default: the manifest's artifactDir)
  --manifest <path>   a manifest JSON file (default: the committed manifest)
  --help              this text

Exit code 0 means every check passed. 1 means at least one failed; the report
says which. An ABSENT artifact is a failure, not a skip.`

function parseArgs(argv) {
  const options = { json: false, fetch: false, help: false, modelDir: null, manifestPath: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case "--json":
        options.json = true
        break
      case "--fetch":
        options.fetch = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      case "--model-dir":
        options.modelDir = argv[++i] ?? null
        break
      case "--manifest":
        options.manifestPath = argv[++i] ?? null
        break
      default:
        throw new Error(`unrecognised argument "${arg}".\n\n${USAGE}`)
    }
  }
  return options
}

function readManifest(manifestPath) {
  if (manifestPath === null) return { manifest: buildManifest(), path: null }
  const path = isAbsolute(manifestPath) ? manifestPath : resolve(process.cwd(), manifestPath)
  if (!existsSync(path)) {
    // A named manifest that is not there is a failure, not a fall back to the
    // committed one: silently verifying against a different manifest than the
    // caller asked for is the kind of quiet substitution this repo forbids.
    return { manifest: { id: "unreadable", artifacts: [], arm64Markers: [], b11: null, _missingManifestPath: path }, path }
  }
  return { manifest: JSON.parse(readFileSync(path, "utf8")), path }
}

/**
 * Obtain each LOADED artifact from its pinned source, then verify the DOWNLOAD
 * against the pin before it is allowed to stay on disk.
 *
 * The digest is checked inside this function, before `runGate` runs, and a
 * mismatch deletes the file. Without that ordering, a corrupt download would
 * sit in the artifact directory and the gate would be a one-line diagnostic
 * away from being re-run into a pass by someone who edited the pin.
 */
async function fetchArtifacts(modelDir, m) {
  const results = []
  for (const artifact of (m.artifacts ?? []).filter((a) => a.role === "loaded")) {
    const url = artifact.source?.url
    if (typeof url !== "string" || !url.startsWith("https://")) {
      results.push({ fileName: artifact.fileName, ok: false, reason: "the manifest declares no https source URL for this LOADED artifact" })
      continue
    }
    mkdirSync(modelDir, { recursive: true })
    const target = join(modelDir, artifact.fileName)
    try {
      const response = await fetch(url, { redirect: "follow" })
      if (!response.ok) {
        results.push({ fileName: artifact.fileName, ok: false, reason: `download returned HTTP ${response.status}` })
        continue
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target))

      const bytes = readFileSync(target)
      const digest = createHash("sha256").update(bytes).digest("hex")
      const detected = detectArtifactFormat(bytes)

      if (artifact.sha256 !== digest) {
        rmSync(target, { force: true })
        results.push({
          fileName: artifact.fileName,
          ok: false,
          reason: `download digest ${digest} does not match the pin ${artifact.sha256 ?? "(none)"}; the file has been deleted rather than left for a later run to accept`
        })
        continue
      }
      if (!detected.allowed) {
        rmSync(target, { force: true })
        results.push({
          fileName: artifact.fileName,
          ok: false,
          reason: `the download is not a loadable format: ${detected.reason}; the file has been deleted`
        })
        continue
      }
      results.push({ fileName: artifact.fileName, ok: true, bytes: bytes.length, sha256: digest, format: detected.format })
    } catch (error) {
      results.push({ fileName: artifact.fileName, ok: false, reason: `download failed: ${error?.message ?? String(error)}` })
    }
  }
  return results
}

function humanSummary(report, fetchResults) {
  const lines = []
  lines.push("")
  lines.push("WS-7 T13 model-digest-gate — D15 / AC-032")
  lines.push("=".repeat(60))
  if (fetchResults !== null) {
    lines.push("")
    lines.push("fetch:")
    for (const r of fetchResults) {
      lines.push(r.ok ? `  OK    ${r.fileName}  ${r.bytes} B  ${r.format}  sha256 ${r.sha256}` : `  FAIL  ${r.fileName}  ${r.reason}`)
    }
  }
  lines.push("")
  lines.push(`manifest: ${report.manifestId ?? "(unreadable)"}`)
  lines.push(`model dir: ${report.modelDir}`)
  lines.push("")
  for (const c of report.checks) {
    lines.push(`  ${c.passed ? "pass" : "FAIL"}  ${c.check.padEnd(18)} ${c.subject}`)
  }
  lines.push("")
  if (report.ok) {
    lines.push(`PASS — ${report.checks.length} checks.`)
  } else {
    lines.push(`FAIL — ${report.failures.length} of ${report.checks.length} checks failed.`)
    for (const f of report.failures) {
      lines.push("")
      lines.push(`  [${f.code}] ${f.subject}`)
      for (const line of String(f.message ?? "").split("\n")) lines.push(`      ${line}`)
      if (Array.isArray(f.problems) && f.problems.length > 0) {
        for (const p of f.problems) lines.push(`      - ${p}`)
      }
    }
  }
  lines.push("")
  return lines.join("\n")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  const { manifest: m, path: manifestPath } = readManifest(options.manifestPath)
  const modelDir = isAbsolute(options.modelDir ?? "")
    ? options.modelDir
    : resolve(REPO_ROOT, options.modelDir ?? m.artifactDir ?? "apps/dashboard/server/services/copilot/models")

  let fetchResults = null
  if (options.fetch) {
    fetchResults = await fetchArtifacts(modelDir, m)
  }

  const report = runGate({ modelDir, manifest: m, manifestPath })
  const payload = { ...report, fetch: fetchResults }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.stderr.write(`${humanSummary(report, fetchResults)}\n`)

  // A fetch that failed is itself a gate failure, so a corrupt download cannot
  // be reported as "the artifact is merely absent" and waved through.
  const fetchFailed = (fetchResults ?? []).some((r) => !r.ok)
  return report.ok && !fetchFailed ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    process.stderr.write(`model-digest-gate: ${error?.stack ?? String(error)}\n`)
    process.exitCode = 1
  })
