// PICC extension boundary guard (slice 7e, L1).
//
// The extension is the DATA-COLLECTION layer. It must never import or
// reference the server's decision/analysis modules — analysis, model fusion
// and interpretation run on the dashboard, and the extension only POSTs
// observations. This guard fails the extension build when a forbidden
// reference sneaks in.
//
// Forbidden: modelMatrix / prediction / accuracyLedger (and any ../server
// import at all). Allowed: pure capture/selector modules and fetch calls.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const EXTENSION_SRC = fileURLToPath(new URL("../src", import.meta.url))

const FORBIDDEN_IMPORTS = [
  /(^|["'`/])\.\.\/?.*\/(modelMatrix|prediction|accuracyLedger)\.(mjs|ts|js)/,
  /from ["'`].*\/server\//,
  /import\(["'`].*\/server\//
]

const FORBIDDEN_CALLS = [
  /\bcomputeModelMatrix\s*\(/,
  /\bgetModelWeights\s*\(/,
  /\brecordModelOutcomes\s*\(/,
  /\baccuracyLedger\b/,
  /\bpredictDirection\s*\(/
]

/** Scan every file under apps/extension/src for boundary violations. */
export function scanExtensionSources(dir = EXTENSION_SRC) {
  const violations = []
  const files = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(full)
    }
  }
  walk(dir)
  for (const file of files.sort()) {
    const src = readFileSync(file, "utf8")
    for (const re of FORBIDDEN_IMPORTS) {
      if (re.test(src)) violations.push(`import: ${file} matches ${re}`)
    }
    for (const re of FORBIDDEN_CALLS) {
      if (re.test(src)) violations.push(`call: ${file} matches ${re}`)
    }
  }
  return { ok: violations.length === 0, violations }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`
if (isMain) {
  const { ok, violations } = scanExtensionSources()
  if (!ok) {
    console.error("[picc-boundary] extension must not reference decision/analysis modules:")
    for (const v of violations) console.error(`  ✗ ${v}`)
    process.exit(1)
  }
  console.log("[picc-boundary] extension source is clean (data-collection only)")
}