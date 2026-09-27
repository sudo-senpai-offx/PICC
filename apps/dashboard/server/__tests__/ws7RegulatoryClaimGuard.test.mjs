// WS-7 T5a - D20/D26 guard: unverifiable third-party regulatory/KYC claims stay deleted,
// and every supersession record stays schema-complete (AC-049).
//
// WHY THIS FILE EXISTS AS A RUNNING TEST, NOT A COMMENT. The existing
// ws6SafetySeamGuard.test.mjs asserts only that the changelog directory, the
// provenance file, and the README's field NAMES exist. It validates no
// individual record and scans no source file, so "every correction carries a
// supersession record" was, in practice, unenforced. This test closes both
// halves: it scans the product tree for a surviving claim, and it validates
// every record's fields.
//
// THE SCOPE IS DISCOVERED, NOT LISTED. Nothing here hardcodes the files or line
// numbers that used to carry the claims. The candidate set is derived from
// `git ls-files` and every text file in it is read, so a claim added to a brand
// new file, in a directory nobody thought of, fails this test. That is the
// AC-001 principle applied to AC-049: coverage that is read as coverage while
// verifying nothing is a defect, so the scan set is proved to be real below.
//
// MATCHING IS DELIBERATELY STRICTER THAN THE ORIGINAL SCAN. The claims were
// found by a per-line case-sensitive search, which is evadable: the runbook
// wrapped one across a line break ("SC-" / "registered") and it survived. This
// guard strips ALL whitespace and lowercases both haystack and needles, so a
// wrapped, double-spaced or differently-cased claim is still caught. Verified
// against the current tree: the stricter matcher finds exactly the same 20
// occurrences as the naive one, so the strictness costs no recall and adds no
// false positives.
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, sep } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join("/")
const CHANGELOG_DIR = join(REPO_ROOT, "docs/trading-logic/changelog")
const ENTRIES_DIR = join(CHANGELOG_DIR, "entries")

// The claim vocabulary D26 deletes. Listed, not derived, because the vocabulary
// IS the policy under test - but note the scan that USES it is derived.
const CLAIM_PHRASES = [
  "SC-registered",
  "SC-licensed",
  "SC registered",
  "SC licensed",
  "no KYC",
  "without KYC",
  "KYC-free",
  "unregulated locally"
]

// Binary payloads cannot carry a human-written claim; skipping them by extension
// keeps the walk cheap without excluding a file type a person could edit.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|bz2|xz|7z|rar|mp3|mp4|wav|mov|webm|woff2?|ttf|otf|eot|exe|dll|so|dylib|wasm|bin|dat|db|sqlite3?|onnx|pt|pth|joblib|parquet|pkl|npy|npz)$/i
const MAX_BYTES = 1_000_000

const git = (...args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64e6 })
const rel = (p) => p.split(sep).join("/")
const squeeze = (s) => s.replace(/\s+/g, "").toLowerCase()
const NEEDLES = CLAIM_PHRASES.map((p) => ({ phrase: p, needle: squeeze(p) }))

// ---------------------------------------------------------------------------
// DISCOVERED FILE SET
// ---------------------------------------------------------------------------
// `git ls-files` is the tracked product tree: it is what ships, and it is
// already how this repo's other guards (agentsCorsGuard, ws5SeamGuard) scope
// themselves. Using the tracked set rather than a raw filesystem walk also means
// untracked scratch cannot make this test flaky - notably `.freebuff/worktrees/`,
// a gitignored nested worktree holding a DIFFERENT branch's checkout of this
// same repo, whose own copies of these files still carry every claim.
const TRACKED = git("ls-files").split(/\r?\n/).filter(Boolean)

// Build output and dependencies are excluded. The first assertion below proves
// that exclusion is real rather than assumed.
const BUILD_OUTPUT_PREFIXES = ["dist/", "node_modules/", "test-results/", "playwright-report/"]
const trackedUnderBuildOutput = TRACKED.filter((f) => BUILD_OUTPUT_PREFIXES.some((p) => f.startsWith(p) || f.includes("/" + p)))

const SCANNABLE = TRACKED.filter((f) => {
  if (BUILD_OUTPUT_PREFIXES.some((p) => f.startsWith(p) || f.includes("/" + p))) return false
  if (BINARY_EXT.test(f)) return false
  try {
    return statSync(join(REPO_ROOT, f)).size <= MAX_BYTES
  } catch {
    return false
  }
})

// ---------------------------------------------------------------------------
// EXCLUSIONS - each with the reason it is not an over-correction
// ---------------------------------------------------------------------------
// These are the places where NAMING the claim is the deliverable, not a claim
// about a third party. They are excluded, and asserted below to be
// documentation-only, so the exclusion can never quietly hide shipped code.
const DOC_EXCLUSIONS = [
  {
    prefix: "docs/specs/",
    reason:
      "A spec has to name the claim it orders deleted; AC-049 would be unspecifiable otherwise. The spec asserts nothing about a third party - it records the decision to remove the assertion."
  },
  {
    prefix: "docs/trading-logic/changelog/entries/",
    reason:
      "A D20 supersession record must name the claim it supersedes; naming it is the record's entire purpose. The record documents a deletion rather than making a claim."
  }
]

// This file names the phrase vocabulary it bans, so it cannot scan itself.
const SELF_EXCLUSION = {
  file: SELF,
  reason: "This guard names the claim vocabulary in order to ban it; a guard cannot forbid a string it must contain."
}

const isDocExcluded = (f) => DOC_EXCLUSIONS.some((d) => f.startsWith(d.prefix))

// ---------------------------------------------------------------------------
// ALLOWLIST - claims that are NOT third-party assertions
// ---------------------------------------------------------------------------
// A blanket pattern ban would be the wrong guard: it would fail on these, and
// the right response to that failure would be to delete honest text. Each entry
// permits exactly one phrase in exactly one file at an exact occurrence count,
// so adding a NEW claim to an allowlisted file is still caught, and a stale
// entry (the text it permitted is gone) is itself a failure. `reason` is
// mandatory and non-empty.
const ALLOWLIST = [
  {
    file: "apps/dashboard/server/services/btcpay.mjs",
    phrase: "no KYC",
    occurrences: 1,
    reason:
      "Header comment describing PICC's OWN self-hosted BTCPay Server deployment, not a third party's status. R5.4 forbids asserting a third party's status without in-tree evidence; here the evidence IS in-tree - the repo bundles the deployment at infra/btcpayserver/btcpayserver-docker and runs it. Deleting this would be over-correction."
  },
  {
    file: "apps/dashboard/src/lib/api.ts",
    phrase: "no KYC",
    occurrences: 1,
    reason:
      "Section-header comment for the same PICC-owned self-hosted BTCPay integration. Same in-tree evidence (infra/btcpayserver/). A comment, not a user-facing claim."
  },
  {
    file: "apps/dashboard/.env.example",
    phrase: "no KYC",
    occurrences: 1,
    reason:
      "Operator-facing config comment describing the self-hosted BTCPay instance the operator points at. Same in-tree evidence. Found by machine scan rather than by the original hand list, but identical in class."
  },
  {
    file: "PICC.md",
    phrase: "no KYC",
    occurrences: 2,
    reason:
      "Two occurrences, both PICC's own record rather than a third-party claim. (1) The payment-methods section describing the self-hosted BTCPay node - same in-tree evidence. (2) The D26 decision-table row that NAMES the deleted claims to record that they were deleted; that is the project documenting this very deletion, the same status as the spec exclusion. Found by machine scan rather than by the original hand list, but identical in class."
  }
]

// ---------------------------------------------------------------------------
// THE SCAN
// ---------------------------------------------------------------------------
function countPhrase(file, phrase) {
  const hay = squeeze(readFileSync(join(REPO_ROOT, file), "utf8"))
  const needle = squeeze(phrase)
  let n = 0
  let idx = hay.indexOf(needle)
  while (idx !== -1) {
    n++
    idx = hay.indexOf(needle, idx + 1)
  }
  return n
}

const findings = []
for (const file of SCANNABLE) {
  if (isDocExcluded(file) || file === SELF) continue
  for (const { phrase } of NEEDLES) {
    const occurrences = countPhrase(file, phrase)
    if (occurrences === 0) continue
    const permitted = ALLOWLIST.find((a) => a.file === file && a.phrase === phrase)
    if (permitted && permitted.occurrences === occurrences) continue
    findings.push(`${file}: ${occurrences} x "${phrase}"${permitted ? ` (allowlist declares ${permitted.occurrences})` : ""}`)
  }
}

// ---------------------------------------------------------------------------
// D20 SUPERSESSION RECORD SCHEMA
// ---------------------------------------------------------------------------
const REQUIRED_FIELDS = ["rule", "version", "supersededBy", "date", "historicalTradesAffected", "reason", "source"]
const HISTORICAL_VALUES = ["none", "reinterpret", "invalidated"]

// Reads a `field: value` header, following a YAML folded/literal block (`>-`, `>`,
// `|`, `|-`) into its body so a lazy `reason: >-` with nothing under it fails
// instead of passing on the two characters ">-".
function fieldValue(text, field) {
  const m = new RegExp(`^${field}:[ \\t]*(.*)$`, "m").exec(text)
  if (!m) return null
  const inline = m[0].slice(field.length + 1).trim()
  if (inline && !/^[>|]/.test(inline)) return inline
  const body = []
  for (const line of text.slice(m.index + m[0].length).split("\n")) {
    if (line.trim() === "") {
      if (body.length) break
      continue
    }
    if (/^[A-Za-z][A-Za-z0-9]*:/.test(line)) break
    body.push(line.trim())
  }
  return body.join(" ").replace(/\s+/g, " ").trim()
}

const entryFiles = existsSync(ENTRIES_DIR)
  ? readdirSync(ENTRIES_DIR)
      .filter((n) => n.endsWith(".md"))
      .sort()
  : []

// The four D26 claim classes deleted by T5a. Asserted individually so the class
// cannot be emptied silently while the directory stays non-empty.
const D26_RULE_IDS = [
  "VENDOR_REGULATORY_STATUS",
  "VENUE_KYC_TERMS",
  "STAKING_JURISDICTION_STATUS",
  "RUNBOOK_LICENSING_ASSERTION"
]

describe("AC-049 - the claim scan is real, not decorative", () => {
  it("excludes no build output or dependency tree from the tracked product", () => {
    // If this ever fails, build output became tracked and BUILD_OUTPUT_PREFIXES
    // would be silently excluding shipped bytes.
    expect(trackedUnderBuildOutput, "no build output or dependency tree may be tracked").toEqual([])
  })

  it("scans a discovered set that reaches product code, not a hand-listed subset", () => {
    expect(SCANNABLE.length, "discovered scan set must be substantial").toBeGreaterThan(200)
    for (const prefix of ["apps/dashboard/src/", "apps/dashboard/server/", "docs/"]) {
      expect(SCANNABLE.some((f) => f.startsWith(prefix)), `scan set must include ${prefix}`).toBe(true)
    }
    // The files that used to carry the claims must be in the set, or this guard
    // would be green while blind to them.
    for (const f of [
      "apps/dashboard/src/lib/streamCatalog.ts",
      "apps/dashboard/src/components/StreamSetupWizard.tsx",
      "apps/dashboard/server/services/browserStudio.mjs",
      "docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md"
    ]) {
      expect(SCANNABLE, `${f} must be inside the discovered scan set`).toContain(f)
    }
  })

  it("excludes only documentation, so the exclusions cannot hide shipped code", () => {
    const docExcluded = SCANNABLE.filter(isDocExcluded)
    expect(docExcluded.length, "the doc exclusions must be load-bearing, not vestigial").toBeGreaterThan(0)
    const nonDocs = docExcluded.filter((f) => !f.endsWith(".md"))
    expect(nonDocs, "a doc exclusion must never cover a non-markdown file").toEqual([])
    for (const d of DOC_EXCLUSIONS) {
      expect(d.reason.trim().length, `exclusion ${d.prefix} must carry a written reason`).toBeGreaterThan(40)
    }
    expect(SELF_EXCLUSION.file).toBe("apps/dashboard/server/__tests__/ws7RegulatoryClaimGuard.test.mjs")
  })
})

describe("AC-049 - no unverifiable third-party regulatory/KYC claim survives", () => {
  it("finds no claim outside the reasoned allowlist", () => {
    expect(
      findings,
      "D26 deletes these claims; a survivor means an unevidenced third-party assertion is user-facing again. Delete the claim, or - if it is genuinely about PICC's own in-tree deployment - add a reasoned ALLOWLIST entry above."
    ).toEqual([])
  })

  it("keeps every allowlist entry live, exactly counted, and justified", () => {
    for (const entry of ALLOWLIST) {
      expect(existsSync(join(REPO_ROOT, entry.file)), `allowlisted file ${entry.file} must still exist`).toBe(true)
      expect(
        typeof entry.reason === "string" && entry.reason.trim().length > 60,
        `allowlist entry ${entry.file} / "${entry.phrase}" must carry a written reason, not a bare marker`
      ).toBe(true)
      expect(
        countPhrase(entry.file, entry.phrase),
        `allowlist entry ${entry.file} / "${entry.phrase}" is stale: the text it permitted has changed count. Remove the entry or restate it.`
      ).toBe(entry.occurrences)
    }
  })

  it("allows the BTCPay self-hosted comments rather than blanket-banning them", () => {
    // The precise-allowlist property: these two survive because they are
    // in-tree verifiable claims about PICC's own deployment, not because the
    // guard is blind to them.
    const btcpay = ALLOWLIST.filter((a) => a.file.includes("btcpay") || a.file.endsWith("api.ts"))
    expect(btcpay.length, "BTCPay self-hosted comments must be explicitly allowlisted").toBeGreaterThanOrEqual(2)
    for (const entry of btcpay) {
      expect(entry.reason, "each BTCPay allowance must justify why it is not a third-party claim").toMatch(/self-hosted|in-tree/i)
    }
  })
})

describe("D20 - every supersession record is schema-complete", () => {
  it("has at least one supersession record checked in", () => {
    expect(existsSync(ENTRIES_DIR), "docs/trading-logic/changelog/entries/ must exist").toBe(true)
    expect(entryFiles.length, "entries/ must not be empty - a missing record is an unenforced rule").toBeGreaterThan(0)
  })

  it("names every file NNNN-<rule>-vN-to-vM.md", () => {
    const bad = entryFiles.filter((n) => !/^\d{4}-[A-Za-z0-9_]+-v\d+-to-v\d+\.md$/.test(n))
    expect(bad, "entries/ filenames must follow the README layout").toEqual([])
  })

  it("gives every record all seven required fields with non-empty values", () => {
    const problems = []
    for (const name of entryFiles) {
      const text = readFileSync(join(ENTRIES_DIR, name), "utf8")
      for (const field of REQUIRED_FIELDS) {
        const value = fieldValue(text, field)
        if (value === null) problems.push(`${name}: missing field "${field}"`)
        else if (value.trim() === "") problems.push(`${name}: field "${field}" is empty`)
      }
    }
    expect(problems, "README: every entry MUST contain all required fields; never leave one empty").toEqual([])
  })

  it("records a decided, non-empty, allowlisted historicalTradesAffected on every record", () => {
    const problems = []
    for (const name of entryFiles) {
      const value = fieldValue(readFileSync(join(ENTRIES_DIR, name), "utf8"), "historicalTradesAffected")
      if (value === null || value.trim() === "") {
        problems.push(`${name}: historicalTradesAffected is empty - "we did not think about it" is an unmade decision`)
      } else if (!HISTORICAL_VALUES.includes(value.trim())) {
        problems.push(`${name}: historicalTradesAffected "${value}" is not one of ${HISTORICAL_VALUES.join(" | ")}`)
      }
    }
    expect(problems).toEqual([])
  })

  it("dates every record ISO-8601", () => {
    const problems = []
    for (const name of entryFiles) {
      const value = fieldValue(readFileSync(join(ENTRIES_DIR, name), "utf8"), "date")
      if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        problems.push(`${name}: date "${value}" is not an ISO-8601 date`)
      }
    }
    expect(problems).toEqual([])
  })

  it("keeps a record for each of the four D26 claim classes", () => {
    const corpus = entryFiles.map((n) => readFileSync(join(ENTRIES_DIR, n), "utf8")).join("\n")
    const missing = D26_RULE_IDS.filter((id) => !corpus.includes(`rule: ${id}`))
    expect(missing, "each D26 claim class must keep its supersession record").toEqual([])
  })
})
