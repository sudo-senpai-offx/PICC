// WS-7 T21 - the SEAM PROBE. Spec :1381-1388, acceptance AC-046 / AC-048.
//
// ============================================================================
// WHAT THIS FILE IS, AND WHY IT COMPUTES NO VERDICTS
// ============================================================================
//
// The WS-7 seam guard enumerates TWENTY-ONE checks (`:1386` + the six the
// 2026-09-26 round added). This file measures the quantity each check asserts
// and NOTHING ELSE. It returns:
//
//     { schema, repoRoot, measured: { <checkId>: NUMBER }, detail, openItems }
//
// There is no `ok`, no `pass`, no `fail`, no boolean verdict anywhere in the
// returned object. That is the same transport discipline T20 established for
// the cross-room gate and it is load-bearing here for a second reason: T20's
// facts had to travel over stdin because five of six record homes are `.tsx`.
// THIS probe needs no transport at all - every artefact it reads is plain
// `.mjs`, `.json`, `.md` or `.py`, and the two pure authority modules it imports
// (`absence-scope.mjs`, `tierBoundaryFixture.mjs`, `confluence.mjs`,
// `retention.mjs`) are side-effect-free modules this very gate depends on. So
// the probe and the decision function are one plain-`node` program, and there
// is exactly one place where `ok` is computed: `ws7-seam-guard.mjs`.
//
// WHY A PROBE AND NOT AN ASSERTION BOLTED ONTO A SUITE. Nineteen of the
// twenty-one items are ALREADY enforced by a named existing guard. Those guards
// are the authorities; re-implementing them here would create a second copy of
// each invariant, which is the exact failure mode this workstream exists to
// prevent (Risk 9 in the WS-6 lineage; the tier boundary is the worked example).
// So each check names the guard that OWNS it and measures the same artefact
// that guard reads, and the seam guard's job is composition plus the six
// 2026-09-26 obligations that nothing owns.
//
// ============================================================================
// THE THING THAT MUST NOT HAPPEN
// ============================================================================
//
// A guard that returns green because nothing was inspected. Two mechanisms
// prevent it, and both are in the gate rather than here:
//
//   1. Every measurement below is a NUMBER or it throws. A check whose
//      measurement cannot be produced is a FAILURE, not a skip, and
//      `evaluateSeam` records it as one.
//   2. `gateExitCode` refuses a report that did not evaluate all twenty-one
//      checks, so "fewer checks ran" can never read as "fewer things wrong".
//
// A second anti-pattern this file is written against: `false`. A boolean cannot
// be compared against a real threshold and carries no information about how
// much was seen. Every measure therefore returns a COUNT or a DEVIATION.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { findUndeclaredOrderCapability, INTENTIONAL_ORDER_CAPABLE } from "../apps/dashboard/server/scripts/absence-scope.mjs"
import { NAMED_RECORD_SOURCES, INVENTORY_SIZE } from "./cross-room-invariant-gate.mjs"
import { TIER_BOUNDARIES, APLUS_MIN_SCORE, B_MIN_SCORE, ALL_BOUNDARY_CASES } from "../apps/dashboard/server/services/copilot/tierBoundaryFixture.mjs"
import { EXPERT_WEIGHTS, EXPERT_WEIGHT_SUM } from "../apps/dashboard/server/services/copilot/confluence.mjs"
import {
  RETENTION_CLASSES,
  RECORD_KIND_CLASSES,
  RETAINED_SNAPSHOT_FIELDS,
  SNAPSHOT_RETENTION_DAYS
} from "../apps/dashboard/server/services/copilot/retention.mjs"
import {
  VETO_RULE_IDS,
  VETO_RETENTION_CLASS
} from "../apps/dashboard/server/services/copilot/vetoIndex.mjs"

export const PROBE_SCHEMA = "picc-ws7-seam-probe/1"

const REPO_ROOT_DEFAULT = fileURLToPath(new URL("../", import.meta.url))

/* ==========================================================================
   SHARED TEXT UTILITIES - one implementation, so "stripped" means one thing.
   ========================================================================== */

/**
 * Strip comments so a removal record cannot satisfy, or trip, a source scan.
 *
 * Every seam guard in this repository reads real sources and pins TOKEN
 * occurrences, so the token vocabulary and the stripping rule are shared here
 * rather than restated per check. `stripComments` is deliberately conservative:
 * it removes block comments and whole-line `//` comments plus a trailing `//`
 * that is not preceded by a `:` (so `https://` survives). It is the guard's own
 * function and the test re-derives its results from it rather than trusting an
 * assertion.
 */
/**
 * Strip comments so a removal record cannot satisfy, or trip, a source scan.
 *
 * Every seam guard in this repository reads real sources and pins TOKEN
 * occurrences, so the token vocabulary and the stripping rule are shared here
 * rather than restated per check.
 *
 * THIS IS A STRING-AWARE SINGLE PASS, and it has to be. The first cut was a
 * regex pair (a non-greedy block-comment match plus a `//` cut), and it lost 24
 * of the 62 real `owner: "decision"` rows in `ws7RouteAuthCoverageGuard.test.mjs`.
 * The reason is that file at :124 contains the literal source text
 * `two === "/*"`, so the regex opened a "comment" there and closed it at the
 * next block-comment terminator hundreds of lines later, deleting real code. A
 * comment stripper that deletes code is worse than no stripper at all: it makes
 * every source-level check in this file measure the wrong thing while looking
 * green.
 *
 * Quote state is therefore tracked (single quote, double quote and backtick,
 * with backslash escapes), and a block comment only opens outside a string.
 */
export function stripComments(src) {
  const s = String(src)
  let out = ""
  let i = 0
  let quote = null
  while (i < s.length) {
    const ch = s[i]
    const next = s[i + 1]
    if (quote) {
      out += ch
      if (ch === "\\") {
        out += s[i + 1] ?? ""
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === "/" && next === "/") {
      while (i < s.length && s[i] !== "\n") i += 1
      continue
    }
    if (ch === "/" && next === "*") {
      const close = s.indexOf("*/", i + 2)
      const end = close === -1 ? s.length : close + 2
      // A block comment still owes the file its line breaks, or line numbers in
      // any downstream report stop matching the file on disk.
      for (let k = i; k < end; k += 1) if (s[k] === "\n") out += "\n"
      i = end
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
      out += ch
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * The Python equivalent: quote- AND docstring-aware.
 *
 * `agents/picc_agents/server.py:106-120` is a docstring that reads
 *
 *     WS-7 T4: this was `allow_origins=["*"]` with `allow_methods=["*"]` and
 *     `allow_headers=["*"]`, which let ANY page the user visited call this API
 *
 * i.e. the removal record for the very wildcards the CORS check hunts, written
 * in a triple-quoted string rather than a `#` comment. Stripping only `#` would
 * report three violations for a function whose wildcards were removed in T4.
 * A docstring is documentation, so it is blanked exactly as a comment is - and
 * the disclosure survives, because this guard measures CONFIGURATION and the
 * disclosure is asserted separately by check 16.
 */
export function stripPythonComments(src) {
  return stripPythonDocstrings(stripHashComments(String(src)))
}

const stripHashComments = (src) =>
  src
    .split(/\r?\n/)
    .map((line) => {
      let quote = null
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]
        if (quote) {
          if (ch === "\\") i += 1
          else if (ch === quote) quote = null
          continue
        }
        if (ch === '"' || ch === "'") {
          quote = ch
          continue
        }
        if (ch === "#") return line.slice(0, i)
      }
      return line
    })
    .join("\n")

const stripPythonDocstrings = (src) => {
  const out = []
  let open = null
  for (const line of src.split(/\r?\n/)) {
    if (open) {
      out.push("")
      if (line.includes(open)) open = null
      continue
    }
    const triple = line.includes('"""') ? '"""' : line.includes("'''") ? "'''" : null
    if (!triple) {
      out.push(line)
      continue
    }
    if (line.indexOf(triple, line.indexOf(triple) + 3) !== -1) {
      // both delimiters on one line: the whole line is documentation
      out.push("")
      continue
    }
    out.push(line.slice(0, line.indexOf(triple)))
    open = triple
  }
  return out.join("\n")
}

/** Comment-stripped source for any tracked file, whichever language it is. */
export function codeOf(absPath, src) {
  const text = src === undefined ? readText(absPath) : src
  return absPath.endsWith(".py") ? stripPythonComments(text) : stripComments(text)
}

const readText = (abs) => readFileSync(abs, "utf8")

/** Comment-stripped source, language-aware. */
const code = (abs) => codeOf(abs)

const exists = (abs) => existsSync(abs)

/** Every tracked file, from git, so nothing is hand-listed. */
function gitFiles(repoRoot) {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
}

/* ==========================================================================
   PRODUCTION-SCOPE VOCABULARY
   ========================================================================== */

/**
 * The two files that ARE this gate.
 *
 * They must be excluded from every scan, because each one DECLARES the vocabulary
 * it searches for: the probe holds `VENUE_RESIDUE_TOKENS` and `D26_CATALOG_ROWS`
 * as data, and both files name the D26 claim shapes in their own failure detail.
 *
 * This was not hypothetical. Before T21 was committed these files were untracked,
 * so `git ls-files` did not return them and the scans never saw them. The commit
 * made them tracked, and the residue count jumped 28 -> 45 with 17 of the new hits
 * being the detector matching its own token list. A gate whose measurement depends
 * on whether the gate is committed is a gate that reports a different number to
 * every reviewer.
 *
 * Excluding a file from a scanner is also how residue gets hidden, so the
 * exclusion is not taken on trust: `detectorFilesAreCleanApartFromTheirVocabulary`
 * in the test re-scans these two files and fails if any token appears outside the
 * declaration that legitimately contains it.
 */
export const DETECTOR_FILES = Object.freeze(["scripts/ws7-seam-probe.mjs", "scripts/ws7-seam-guard.mjs"])

/**
 * What counts as PRODUCTION code for the residue and claim scans.
 *
 * Discovered, not hand-listed: every tracked file under the dashboard's server
 * tree or client tree, minus tests, fixtures and build output. A residue scan
 * that could not see a new file would be the AC-001 defect one level up.
 */
export function productionFiles(tracked) {
  const SKIP_SEGMENTS = new Set(["__tests__", "fixtures", "node_modules", "dist", "build", ".playwright-tmp"])
  return tracked.filter((f) => {
    if ([...SKIP_SEGMENTS].some((s) => f.includes(`/${s}/`) || f.endsWith(`/${s}`))) return false
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f)) return false
    if (DETECTOR_FILES.includes(f)) return false
    return /^(apps\/dashboard\/server\/.+\.mjs|apps\/dashboard\/src\/.+\.[cm]?[jt]sx?|scripts\/.+\.mjs|agents\/.+\.py)$/.test(f)
  })
}

/* ==========================================================================
   THE VENUE-RESIDUE VOCABULARY (D2 / check 2)
   ========================================================================== */

/**
 * Identifiers that only existed because of the removed venue.
 *
 * A RESIDUE hit is an occurrence in COMMENT-STRIPPED production code. The
 * removal records themselves - the several hundred `D2/AC-005: ... REMOVED`
 * comments across `handlers.mjs`, `captureProfiles.mjs`, `browserStudio.mjs`
 * and elsewhere - are the opposite of residue: they are why the removal is
 * auditable. A scan that counted them would demand the evidence be deleted, so
 * the vocabulary is applied to stripped code only, and that choice is asserted
 * by the guard rather than assumed.
 */
export const VENUE_RESIDUE_TOKENS = Object.freeze([
  // credential fields the venue owned
  "expertoptionToken",
  "expertoptionWsUrl",
  "expertoptionDemo",
  // venue functions the removal deleted
  "captureExpertOptionSession",
  "checkExpertOptionSessionLive",
  "analyzeExpertOptionAsset",
  "proAnalyzeExpertOption",
  "restartLiveEO",
  "subscribeLiveEO",
  "liveEOStats",
  "liveEOData",
  // the venue's own slug, as a code literal
  "expertoption"
])

/* ==========================================================================
   THE REGULATORY-CLAIM VOCABULARY (D26 / check 14)
   ========================================================================== */

/**
 * The claim CLASS, not five literals.
 *
 * `ws7RegulatoryClaimGuard.test.mjs` owns this vocabulary with a written
 * rationale per rule; T21 does not restate it, it names the guard and measures
 * the same class with the same three shapes so a claim cannot hide in a
 * paraphrase the narrower regex misses.
 */
export const REGULATORY_CLAIM_SHAPES = Object.freeze([
  Object.freeze({ shape: "licensing-status", token: /\b(?:SC|SEC|FCA|ESMA|MAS|Bank Negara)\s*-\s*(?:registered|licensed|approved)/i }),
  Object.freeze({ shape: "securities-commission", token: /\bSecurities Commission\b/i }),
  Object.freeze({ shape: "kyc-negation", token: /\bno KYC\b|\bno payment info\b/i }),
  Object.freeze({ shape: "dax-registration", token: /\bDAX\b[^\n]{0,60}\bregistered\b|\bregistered\b[^\n]{0,60}\bDAX\b/i })
])

/** The eight D26 rows. Claims were deleted from these; the entries were to STAY. */
export const D26_CATALOG_ROWS = Object.freeze([
  "luno",
  "mx-global",
  "hata",
  "sinegy",
  "kinetic",
  "funding-circle",
  "selangor-kuasa",
  "pitik"
])

/* ==========================================================================
   THE PROBE
   ========================================================================== */

/**
 * Measure everything the twenty-one checks assert.
 *
 * @param {{ repoRoot?: string }} options
 * @returns {Readonly<{schema: string, repoRoot: string, measured: Record<string, number>, detail: object, openItems: ReadonlyArray<object>}>}
 */
export function probeSeam({ repoRoot = REPO_ROOT_DEFAULT } = {}) {
  const root = resolve(repoRoot)
  const tracked = gitFiles(root)
  const measured = {}
  const detail = {}
  const p = (rel) => join(root, rel)
  const missing = (rel) => !exists(p(rel))

  /* ---------------------------------------------------------------- 1 --- */
  // ABSENCE-GUARD SCOPE COMPLETENESS. Owner: executionAbsenceScope.test.mjs.
  //
  // The measurement is `undeclared.length`: order-capable modules the scanner
  // found that no reviewed list accounts for. Zero is the only passing value
  // because the reviewed lists are the allow-list; adding a name to one is a
  // deliberate, reviewable edit, and this number cannot be reduced by editing
  // the guard itself.
  {
    const scope = findUndeclaredOrderCapability(p("apps/dashboard/server"))
    measured["absence.discovered-scope-complete"] = scope.undeclared.length
    detail.absence = {
      discovered: scope.discovered,
      declaredIntentional: [...INTENTIONAL_ORDER_CAPABLE].sort(),
      undeclared: scope.undeclared,
      // AC-002:783 names four paths that must be inside the guard's scope.
      // Measured, not asserted, and reported even though the answer is not the
      // one AC-002's prose expects - see the report's `specDivergences`.
      ac002NamedPaths: [
        "services/ccxtOrdering.mjs",
        "services/commandCentre/ccxtExecution.mjs",
        "services/commandCentre/perpsExecution.mjs",
        "services/venues/hyperliquidPerps.mjs"
      ],
      ac002PathsDiscovered: [
        "services/ccxtOrdering.mjs",
        "services/commandCentre/ccxtExecution.mjs",
        "services/commandCentre/perpsExecution.mjs",
        "services/venues/hyperliquidPerps.mjs"
      ].filter((rel) => scope.discovered.includes(rel))
    }
  }

  /* ---------------------------------------------------------------- 2 --- */
  // NO EXPERTOPTION RESIDUE. Owner: none before T21.
  {
    const prod = productionFiles(tracked)
    const hits = []
    for (const rel of prod) {
      const stripped = code(p(rel))
      for (const token of VENUE_RESIDUE_TOKENS) {
        const re = token === "expertoption" ? /"expertoption"|'expertoption'/g : new RegExp(`\\b${token}\\b`, "g")
        const n = (stripped.match(re) || []).length
        if (n > 0) hits.push({ file: rel, token, count: n })
      }
    }
    measured["venue.expertoption-residue"] = hits.reduce((n, h) => n + h.count, 0)
    detail.venueResidue = { filesScanned: prod.length, hits: hits.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)) }
  }

  /* ---------------------------------------------------------------- 3 --- */
  // THE CANCEL MEMBER'S PRESENCE. Owner: perpsCancelPath.test.mjs.
  //
  // Four facts, each worth exactly one violation, so "the member exists" is
  // four claims and not one:
  //   a. `hyperliquidPerps` exposes a `cancelOrder` member
  //   b. it is GATED the way `submitOrder` is (the ceremony/mode gate is
  //      reached before any venue instance is used)
  //   c. it refuses an unidentifiable cancel LOCALLY, before building an
  //      instance - the property that makes "may not have happened" honest
  //   d. it is not a re-export of the raw CCXT instance's own member
  {
    const rel = "apps/dashboard/server/services/venues/hyperliquidPerps.mjs"
    const src = missing(rel) ? "" : code(p(rel))
    const exportBlock = src.slice(src.lastIndexOf("export const hyperliquidPerps"))
    const fnStart = src.indexOf("async function cancelOrder(")
    const exportAt = src.indexOf("export const hyperliquidPerps")
    const fn = fnStart === -1 ? "" : src.slice(fnStart, exportAt === -1 ? undefined : exportAt)
    // The gate is NOT a word search for "ceremony". `cancelOrder` is gated the
    // way `submitOrder` is (:313-318) by MODE RESOLUTION - `modeOf()`, which is
    // what honours the ceremony unlock and the mainnet env at :133-135 - and it
    // must consult it and refuse BEFORE `swapInstance()` builds a venue
    // instance. That ordering is the property; the vocabulary is incidental.
    const modeAt = fn.indexOf("modeOf()")
    const refuseAt = fn.search(/!\s*mode\.ok/)
    const instanceAt = fn.indexOf("swapInstance()")
    const facts = [
      /async function cancelOrder\s*\(/.test(src) && /\bcancelOrder\b/.test(exportBlock),
      modeAt !== -1 && refuseAt !== -1 && modeAt < refuseAt && (instanceAt === -1 || refuseAt < instanceAt),
      /cancelOrder-unidentifiable/.test(fn),
      !/const\s+\w+\s*=\s*inst\s*;[\s\S]*cancelOrder/.test(fn.replace(/\.\s*cancelOrder\s*\(/g, "cancelOrder"))
    ]
    measured["perps.cancel-member-present"] = facts.filter((ok) => !ok).length
    detail.perpsCancelMember = { modulePresent: !missing(rel), facts, gateOrder: { modeAt, refuseAt, instanceAt } }
  }

  /* ---------------------------------------------------------------- 4 --- */
  // NO WILDCARD CORS. Owner: agentsCorsGuard.test.mjs:39-67.
  {
    const rel = "agents/picc_agents/server.py"
    const src = missing(rel) ? "" : code(p(rel))
    const facts = [
      !missing(rel),
      !/allow_origins\s*=\s*\[\s*["']\*["']\s*\]/.test(src),
      !/allow_methods\s*=\s*\[\s*["']\*["']\s*\]/.test(src),
      !/allow_headers\s*=\s*\[\s*["']\*["']\s*\]/.test(src),
      /allow_origins\s*=\s*_allowed_origins\s*\(/.test(src),
      !/access-control-allow-origin["']?\s*[:,]\s*["']\*["']/i.test(src)
    ]
    measured["agents.no-wildcard-cors"] = facts.filter((ok) => !ok).length
    detail.agentsCors = { modulePresent: !missing(rel), facts }
  }

  /* ---------------------------------------------------------------- 5 --- */
  // NO PLAINTEXT KEY. Owner: agentsCorsGuard.test.mjs:70-86 + ws6SafetySeamGuard.test.mjs:78-91.
  //
  // Two surfaces: a real key committed or ignored-but-real, and key material in
  // the terminal tree. `settings.json` is measured on DISK and on TRACKING
  // separately, because "untracked" and "keyless" are two different claims and
  // only the conjunction is safe.
  {
    const facts = []
    const trackedSettings = tracked.filter((f) => /(^|\/)settings\.json$/.test(f) && f.includes("picc_agents"))
    const onDisk = exists(p("agents/picc_agents/settings.json"))
    if (onDisk) {
      let parsed = null
      let parseFailed = false
      try {
        parsed = JSON.parse(readText(p("agents/picc_agents/settings.json")))
      } catch {
        parseFailed = true
      }
      facts.push(!parseFailed, !(parsed && typeof parsed.api_key === "string" && parsed.api_key.trim().length > 0))
    } else {
      facts.push(true, true) // absent: no key can be on disk
    }
    facts.push(trackedSettings.length === 0)
    // key material in the client terminal tree
    const terminalHits = productionFiles(tracked)
      .filter((f) => f.startsWith("apps/dashboard/src/terminal/"))
      .filter((f) => /0x[0-9a-fA-F]{40,}/.test(code(p(f))))
    facts.push(terminalHits.length === 0)
    measured["secrets.no-plaintext-key"] = facts.filter((ok) => !ok).length
    detail.plaintextKey = {
      settingsJsonOnDisk: onDisk,
      settingsJsonTracked: trackedSettings,
      terminalKeyMaterialHits: terminalHits
    }
  }

  /* ---------------------------------------------------------------- 6 --- */
  // NO PICKLE LOAD PATH. Owner: modelLayer/__tests__/digestGate.test.mjs + artifactFormat.test.mjs.
  {
    const rel = "apps/dashboard/server/services/copilot/modelLayer/artifactFormat.mjs"
    const src = missing(rel) ? "" : code(p(rel))
    const facts = [
      !missing(rel),
      // the ALLOW list is exactly the two D15-permitted containers
      /ALLOWED_FORMATS\s*=\s*Object\.freeze\(\[\s*"safetensors"\s*,\s*"cact"\s*\]\s*\)/.test(src),
      // the pickle family is named as FORBIDDEN member suffixes, so a renamed
      // pickle is refused on CONTENT rather than on its filename
      /PICKLE_MEMBER_SUFFIXES/.test(src) && /\.pkl/.test(src) && /\.pt2?/.test(src),
      // a refusal code distinct from a digest failure, so the operator can tell
      /FORBIDDEN_FORMAT_CODES[\s\S]*pickle\s*:\s*"[^"]*forbidden/.test(src),
      // and no model-layer module actually calls a deserialiser
      !tracked
        .filter((f) => f.startsWith("apps/dashboard/server/services/copilot/modelLayer/") && f.endsWith(".mjs") && !f.includes("__tests__"))
        .some((f) => /\b(?:pickle|cPickle|dill|joblib)\s*\.\s*(?:load|loads|Load)\s*\(/.test(code(p(f))))
    ]
    measured["model.no-pickle-load-path"] = facts.filter((ok) => !ok).length
    detail.pickle = { modulePresent: !missing(rel), facts }
  }

  /* ---------------------------------------------------------------- 7 --- */
  // THE WEIGHT SUM. Owner: expertWeights.test.mjs:32-43.
  //
  // The measured quantity is the DEVIATION from 100, not the sum: `sum >= 100`
  // would pass on 101, and a tolerant assertion is not an assertion. The sum
  // itself is carried in `detail` so the number a reader wants is present.
  {
    measured["engine.weight-sum-exactly-100"] = Math.abs(EXPERT_WEIGHT_SUM - 100)
    detail.weightSum = {
      sum: EXPERT_WEIGHT_SUM,
      experts: EXPERT_WEIGHTS.map((e) => ({ expert: e.expert, weightPct: e.weightPct })),
      frozen: Object.isFrozen(EXPERT_WEIGHTS)
    }
  }

  /* ---------------------------------------------------------------- 8 --- */
  // TIER BOUNDARIES. Owner: tierBoundaryParity.test.mjs + crossRoomInvariantGate.test.mjs's single-authority walk.
  {
    const declarationSites = tracked
      .filter((f) => /^(apps\/dashboard|scripts)\/.+\.[cm]?[jt]s$/.test(f))
      .filter((f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f))
      .filter((f) => /export const (?:TIER_BOUNDARIES|APLUS_MIN_SCORE|B_MIN_SCORE)\b/.test(code(p(f))))
      .map((f) => relative(root, p(f)).split(sep).join("/"))
      .sort()
    const facts = [
      declarationSites.length === 1,
      declarationSites[0] === "apps/dashboard/server/services/copilot/tierBoundaryFixture.mjs",
      APLUS_MIN_SCORE === 85,
      B_MIN_SCORE === 70,
      Object.isFrozen(TIER_BOUNDARIES),
      ALL_BOUNDARY_CASES.length >= 5
    ]
    measured["engine.tier-boundary-single-authority"] = facts.filter((ok) => !ok).length
    detail.tierBoundary = { declarationSites, aplusMin: APLUS_MIN_SCORE, bMin: B_MIN_SCORE, cases: ALL_BOUNDARY_CASES.length }
  }

  /* ---------------------------------------------------------------- 9 --- */
  // VETO INSPECTABILITY. Owner: vetoes.test.mjs:102-140, 257-292.
  //
  // AC-022 makes this a contract, not a feature: every outcome must carry the
  // inspectable fields, and the permanent store must expose no mutator. Both are
  // measured from the real modules.
  {
    const indexRel = "apps/dashboard/server/services/copilot/vetoIndex.mjs"
    const outcomeRel = "apps/dashboard/server/services/copilot/vetoes/outcome.mjs"
    const indexSrc = missing(indexRel) ? "" : code(p(indexRel))
    const outcomeSrc = missing(outcomeRel) ? "" : code(p(outcomeRel))
    // AC-022 makes the outcome shape a contract: a rule that can only be seen
    // through its boolean verdict is not inspectable, so every field is named.
    const INSPECTABLE_FIELDS = ["ruleId", "fired", "inputs", "suppressed", "evaluatedAt", "ruleVersion"]
    const missingFields = INSPECTABLE_FIELDS.filter((f) => !new RegExp(`\\b${f}\\b`).test(outcomeSrc))
    // the permanent store must expose NO mutator (vetoes.test.mjs:260)
    const MUTATORS = ["update", "delete", "remove", "clear", "set", "put", "write", "purge", "drop", "truncate"]
    const storeMutators = MUTATORS.filter((m) => new RegExp(`export\\s+(?:function|const)\\s+${m}\\b|\\n\\s{2}${m}\\s*\\(`).test(indexSrc))
    const facts = [
      !missing(indexRel),
      !missing(outcomeRel),
      missingFields.length === 0,
      /export const VETO_RULES = Object\.freeze\(/.test(indexSrc),
      /export const VETO_RULE_IDS = Object\.freeze\(/.test(indexSrc),
      VETO_RULE_IDS.length === 6,
      storeMutators.length === 0,
      /VETO_RETENTION_CLASS = "permanent_append_only"/.test(indexSrc)
    ]
    measured["engine.veto-inspectable"] = facts.filter((ok) => !ok).length
    detail.veto = {
      inspectableFieldsMissing: missingFields,
      ruleIds: [...VETO_RULE_IDS],
      storeMutators,
      retentionClass: VETO_RETENTION_CLASS,
      facts
    }
  }

  /* --------------------------------------------------------------- 10 --- */
  // SEPARATION OF DUTIES. Owner: separationOfDuties.test.mjs.
  {
    const rel = "apps/dashboard/server/services/authority/separationOfDuties.mjs"
    const src = missing(rel) ? "" : code(p(rel))
    const facts = [
      !missing(rel),
      /collision/i.test(src),
      /throw/.test(src),
      // purity: the detector reads nothing it was not handed
      !/\b(?:readFileSync|fetch\(|Date\.now|Math\.random|process\.env)\b/.test(src)
    ]
    measured["authority.separation-of-duties"] = facts.filter((ok) => !ok).length
    detail.separationOfDuties = { modulePresent: !missing(rel), facts }
  }

  /* --------------------------------------------------------------- 11 --- */
  // RETENTION CLASSES. Owner: retention.test.mjs:102-198.
  {
    const facts = [
      RETENTION_CLASSES.length === 3,
      Object.isFrozen(RETENTION_CLASSES),
      Object.isFrozen(RECORD_KIND_CLASSES),
      Object.keys(RECORD_KIND_CLASSES).length > 0,
      SNAPSHOT_RETENTION_DAYS === 90,
      RETAINED_SNAPSHOT_FIELDS.length > 0 && Object.isFrozen(RETAINED_SNAPSHOT_FIELDS)
    ]
    measured["retention.classes-declared"] = facts.filter((ok) => !ok).length
    detail.retention = {
      classes: [...RETENTION_CLASSES],
      kinds: Object.keys(RECORD_KIND_CLASSES),
      snapshotDays: SNAPSHOT_RETENTION_DAYS,
      facts
    }
  }

  /* --------------------------------------------------------------- 12 --- */
  // D27 - EVERY ROOM'S COMPLETION RECORD CARRIES AN EXPLICIT COMPLETENESS VERDICT.
  // Owner: crossRoomInvariantGate.test.mjs (`correctness.verdict-declared`).
  //
  // Measured here from the record SOURCE, because this file cannot import the
  // `.tsx` record homes (the ERR_UNKNOWN_FILE_EXTENSION problem T20 documented).
  // The measurement is the count of rooms whose source carries neither verdict
  // word. The gate ALSO re-runs T20's own real adapter in its test, so the two
  // are independent by construction.
  {
    // The record homes are NOT listed here. `NAMED_RECORD_SOURCES` and
    // `ROOM_INVENTORY` are imported from T20's gate, which is the single
    // authority for "which rooms exist" (spec :73). A second list would be the
    // exact drift the cross-room gate's design note warns against.
    const recordHomes = [
      ...NAMED_RECORD_SOURCES.map((s) => ({ rel: `apps/dashboard/${s.file}`, label: s.symbol, room: s.id })),
      { rel: "apps/dashboard/src/terminal/domain/readOnlyRoomCompletions.ts", label: "READ_ONLY_ROOM_COMPLETIONS", room: "(16 read-only instances)" }
    ]
    const noVerdict = recordHomes.filter((h) => missing(h.rel) || !/\bverdict\s*:\s*"(?:complete|incomplete)"/.test(code(p(h.rel))))
    measured["rooms.completeness-verdict-declared"] = noVerdict.length
    detail.roomVerdicts = {
      recordHomes: recordHomes.length,
      namedRooms: NAMED_RECORD_SOURCES.length,
      inventorySize: INVENTORY_SIZE,
      withoutVerdict: noVerdict.map((h) => `${h.rel} (${h.label})`)
    }
  }

  /* --------------------------------------------------------------- 13 --- */
  // D23 - A CONJUNCTION. Owner: perpsSeamGuard.test.mjs:107-116 (half A only).
  //
  //   half A: `"cancelOrder"` is STILL in `ccxtConnector.mjs`'s
  //           READ_ONLY_BLOCKED, so non-seam modules stay read-only
  //   half B: the sanctioned perps seam EXPOSES the gated member
  //
  // Half A alone is the naive check, and half A alone is what the existing guard
  // asserts. A guard that checked only half A would pass on a repository where
  // the cancel path had been deleted outright - which is the pre-T3 state this
  // decision exists to fix. Both halves are measured and both are reported, and
  // the mutation sweep proves each flips on its own.
  {
    const rel = "apps/dashboard/server/services/ccxtConnector.mjs"
    const src = missing(rel) ? "" : readText(p(rel))
    const start = src.indexOf("export const READ_ONLY_BLOCKED = [")
    const block = start === -1 ? "" : src.slice(start, src.indexOf("]", start))
    const perpsRel = "apps/dashboard/server/services/venues/hyperliquidPerps.mjs"
    const perpsSrc = missing(perpsRel) ? "" : code(p(perpsRel))
    const exportBlock = perpsSrc.slice(perpsSrc.lastIndexOf("export const hyperliquidPerps"))
    const halves = {
      "cancelOrder-still-blocked": /["']cancelOrder["']/.test(block),
      "seam-exposes-gated-member": /async function cancelOrder\s*\(/.test(perpsSrc) && /\bcancelOrder\b/.test(exportBlock)
    }
    measured["perps.cancelOrder-blocked-and-seam-exposed"] = Object.values(halves).filter((ok) => !ok).length
    detail.perpsConjunction = halves
  }

  /* --------------------------------------------------------------- 14 --- */
  // D26 - A CONJUNCTION. Owner: ws7RegulatoryClaimGuard.test.mjs (half A).
  //
  //   half A: no unverifiable regulatory/KYC CLAIM string survives
  //   half B: the eight D26 CATALOG ENTRIES are still present
  //
  // Half A is the half that passes trivially. D26 `:363` says the entries are
  // "**not** removed - only the unverifiable claims are", so a guard that
  // asserted only half A would be satisfied by deleting the eight rows outright,
  // which is the precise thing D26 forbids. Both halves are measured, both are
  // reported separately, and each is proven to flip on its own.
  {
    const prod = productionFiles(tracked)
    const claimHits = []
    for (const rel of prod) {
      if (rel.includes("__tests__") || rel.endsWith("ws7RegulatoryClaimGuard.test.mjs")) continue
      const stripped = code(p(rel))
      for (const shape of REGULATORY_CLAIM_SHAPES) {
        const n = (stripped.match(new RegExp(shape.token.source, "gi")) || []).length
        if (n > 0) claimHits.push({ file: rel, shape: shape.shape, count: n })
      }
    }
    const catalogRel = "apps/dashboard/src/lib/streamCatalog.ts"
    const catalog = missing(catalogRel) ? "" : code(p(catalogRel))
    const presentRows = D26_CATALOG_ROWS.filter((id) => new RegExp(`id:\\s*"${id}"`).test(catalog))
    const halves = {
      "no-regulatory-claim": claimHits.length === 0,
      "d26-catalog-entries-still-present": presentRows.length === D26_CATALOG_ROWS.length
    }
    measured["catalog.claims-gone-entries-stay"] = Object.values(halves).filter((ok) => !ok).length
    detail.d26Conjunction = {
      halves,
      claimHits,
      entriesExpected: D26_CATALOG_ROWS,
      entriesPresent: presentRows,
      entriesAbsent: D26_CATALOG_ROWS.filter((id) => !presentRows.includes(id))
    }
  }

  /* --------------------------------------------------------------- 15 --- */
  // D24 - ONE LOCKFILE, AND NO FIELD RE-IMPLYING PNPM. Owner: T6 + ws7LockfileOverrideGuard.test.mjs.
  {
    const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json", "bun.lockb", "bun.lock"]
    const found = tracked.filter((f) => LOCKFILES.some((name) => f.endsWith(`/${name}`) || f === name))
    const manifests = tracked.filter((f) => /(^|\/)package\.json$/.test(f))
    const pnpmFields = []
    for (const rel of manifests) {
      let json = null
      try {
        json = JSON.parse(readText(p(rel)))
      } catch {
        continue
      }
      for (const key of Object.keys(json)) {
        if (/pnpm/i.test(key)) pnpmFields.push(`${rel}:${key}`)
      }
      if (typeof json.packageManager === "string" && /pnpm/i.test(json.packageManager)) {
        pnpmFields.push(`${rel}:packageManager=${json.packageManager}`)
      }
    }
    const facts = [found.length === 1, found[0] === "package-lock.json", pnpmFields.length === 0]
    measured["lockfile.single-and-no-pnpm"] = facts.filter((ok) => !ok).length
    detail.lockfiles = { tracked: found, manifests: manifests.length, pnpmFields }
  }

  /* --------------------------------------------------------------- 16 --- */
  // D22 - THE DISCLOSED CAMOUFLAGE POLICY IS LINKED FROM THE PRODUCT DOCUMENT.
  // Owner: none before T21. AC-015's verification names the link explicitly.
  //
  // Three facts: the dated record exists; `PICC.md` LINKS it; and `PICC.md`'s
  // guardrail 2 states the policy with its code references. The link is a
  // separate fact from the disclosure because D22 `:321` requires the policy be
  // "discoverable by an operator reading the product's claims", and an inline
  // paraphrase with no pointer to the dated record is a disclosure without a
  // discoverable record.
  {
    const entryRel = "docs/trading-logic/changelog/entries/0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE-v1-to-v2.md"
    const picc = missing("PICC.md") ? "" : readText(p("PICC.md"))
    const piccLines = picc.split(/\r?\n/)
    // The guardrail-2 slice is DERIVED FROM ITS MARKERS, not from line numbers.
    // The first cut used a hard-coded `slice(48, 63)` and the check silently
    // started reading the wrong lines the moment T21 added the typing-invariant
    // paragraph to guardrail 2 - it reported the link missing on the very edit
    // that added it. A hard-coded window into a document that other tasks are
    // also editing is a check that measures the wrong thing while looking green.
    const g2Start = piccLines.findIndex((l) => /^2\. \*\*Browser automation-signal stripping/.test(l))
    const g2End = piccLines.findIndex((l, i) => i > g2Start && /^3\. \*\*Every data source/.test(l))
    const guardrail2 =
      g2Start === -1 || g2End === -1
        ? ""
        : piccLines
            .slice(g2Start, g2End)
            .join("\n")
            .replace(/^\s*\*\s?/gm, " ")
    const LINK = /0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE|BROWSER_SIGNAL_STRIPING_DISCLOSURE/
    const facts = [
      exists(p(entryRel)),
      LINK.test(picc),
      /stealth/i.test(guardrail2) && /disable-blink-features=AutomationControlled/.test(guardrail2),
      /importRealProfile|real logged-in browser profile/i.test(guardrail2),
      g2Start !== -1 && g2End > g2Start
    ]
    measured["docs.camouflage-policy-linked"] = facts.filter((ok) => !ok).length
    detail.camouflage = {
      recordPath: entryRel,
      recordPresent: exists(p(entryRel)),
      linkedFromPICCmd: LINK.test(picc),
      guardrail2Range: [g2Start + 1, g2End],
      facts
    }
  }

  /* --------------------------------------------------------------- 17 --- */
  // D25 - THE TYPING INVARIANT STATES PER-ACTION APPROVAL, AND NO BROKER
  // CREDENTIAL REACHES interventions.mjs. Owner: none before T21.
  //
  // Four facts, and the third is the subtle one. "No credential reaches
  // interventions.mjs" is NOT "getCredentials is never called there": `:551`
  // reads the credential object and takes exactly one non-secret scalar out of
  // it (`riskPerTradePct`). So the measurement is over CREDENTIAL-SHAPED
  // identifiers - a token, a key, a secret, a password, a broker auth field -
  // not over the presence of the accessor. A guard that banned the accessor
  // would be wrong about the code, and a guard that banned nothing would be
  // wrong about the boundary.
  {
    const rel = "apps/dashboard/server/services/interventions.mjs"
    const src = missing(rel) ? "" : code(p(rel))
    const picc = missing("PICC.md") ? "" : readText(p("PICC.md"))
    const CREDENTIAL_SHAPED =
      /\b(?:expertoptionToken|expertoptionWsUrl|apiKey|api_key|secretKey|secret_key|privateKey|private_key|password|passphrase|accessToken|access_token|bearer|ccxtSecret|ccxtKey|credentials\.[A-Za-z_$][\w$]*|creds\.[A-Za-z_$][\w$]*)\b/
    const credentialHits = [...src.matchAll(new RegExp(CREDENTIAL_SHAPED.source, "g"))].map((m) => m[0])
    // what the accessor result IS allowed to be used for
    const accessorUses = [...src.matchAll(/creds\?\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
    const allowedScalars = new Set(["riskPerTradePct"])
    const facts = [
      !missing(rel),
      /approved\.has\(running\.stepIndex\)/.test(src), // the per-action approval gate
      credentialHits.length === 0,
      accessorUses.every((f) => allowedScalars.has(f)),
      /per-action human approval|explicit human approval step|per-action approval/i.test(picc)
    ]
    measured["docs.typing-invariant-states-boundary"] = facts.filter((ok) => !ok).length
    detail.typing = {
      modulePresent: !missing(rel),
      credentialShapedHits: [...new Set(credentialHits)],
      accessorUses,
      invariantStatedInPICCmd: /per-action human approval|explicit human approval step|per-action approval/i.test(picc),
      facts
    }
  }

  /* --------------------------------------------------------------- 18 --- */
  // NO UNUSED DEPENDENCY. Owner: T21 itself - spec :218 "Each install is
  // justified in §4.8 and pinned by T21. An unused package at T21 is a
  // finding." and :764 "T21 fails on an unused package."
  //
  // Nothing else owns it, so this is measured here from scratch. A declared
  // runtime dependency is USED when at least one PRODUCTION source file
  // references it in an import/require/import() form after comments are
  // stripped. devDependencies are excluded deliberately: a devDependency with no
  // importer is normal for a workspace whose tooling runs through npm scripts,
  // and calling that "unused" would be a fabricated finding.
  {
    const manifests = tracked.filter((f) => /(^|\/)package\.json$/.test(f))
    const prod = productionFiles(tracked).filter((f) => !f.endsWith("package.json"))
    const bodies = prod.map((f) => ({ file: f, src: code(p(f)) }))
    const unused = []
    const declared = []
    for (const rel of manifests) {
      let json = null
      try {
        json = JSON.parse(readText(p(rel)))
      } catch {
        continue
      }
      for (const [name, range] of Object.entries(json.dependencies || {})) {
        declared.push({ manifest: rel, name, range })
        const used = bodies.some(
          (b) =>
            new RegExp(`(?:from\\s*|require\\(\\s*|import\\(\\s*)["']${escapeRe(name)}["']`).test(b.src) ||
            new RegExp(`["']${escapeRe(name)}["']\\s*:`).test(b.src)
        )
        if (!used) unused.push({ manifest: rel, name, range })
      }
    }
    measured["deps.no-unused-dependency"] = unused.length
    detail.dependencies = { declaredRuntime: declared.length, unused }
  }

  /* --------------------------------------------------------------- 19 --- */
  // THE RAM GATE'S EXISTENCE AND LAST RESULT. Owner: ramCeilingGate.test.mjs.
  //
  // Counted, at-least: how many of the facts T19's own artifact carries are
  // present. The gate does NOT ask whether B10 passed - B10's verdict is a
  // recorded outcome and a recorded outcome is never re-litigated here. It asks
  // whether the artifact and its last measured result are there at all, so a
  // deleted or emptied artifact fails instead of reading as "nothing to say".
  {
    const rel = "apps/dashboard/perf/ram-ceiling-gate.json"
    const facts = []
    let artifact = null
    if (!missing(rel)) {
      try {
        artifact = JSON.parse(readText(p(rel)))
      } catch {
        artifact = null
      }
    }
    facts.push(artifact !== null)
    if (artifact) {
      facts.push(artifact.schema === "picc-ram-ceiling/1")
      facts.push(artifact.ceilingMb === 2048)
      facts.push(artifact.ceilingIsFrozen === true)
      facts.push(typeof artifact.measured?.peakMb === "number" && Number.isFinite(artifact.measured.peakMb))
      facts.push(Array.isArray(artifact.rawSamplesMb) && artifact.rawSamplesMb.length > 1)
      facts.push(Array.isArray(artifact.peakProcesses) && artifact.peakProcesses.length > 0)
      facts.push(typeof artifact.verdict === "string" && artifact.verdict.length > 0)
      facts.push(artifact.budget === "B10")
    }
    measured["ram.gate-exists-and-last-result"] = facts.filter((ok) => ok).length
    detail.ramGate = {
      artifact: rel,
      present: artifact !== null,
      factsPresent: facts.filter((ok) => ok).length,
      factsExpected: facts.length,
      ceilingMb: artifact?.ceilingMb ?? null,
      peakMb: artifact?.measured?.peakMb ?? null,
      verdict: artifact?.verdict ?? null
    }
  }

  /* --------------------------------------------------------------- 20 --- */
  // THE ARM PROBE ARTIFACT. Owner: perfBudgetVerdicts.test.mjs:294.
  //
  // Counted, at-least, for the same reason as the RAM artifact: the artifact's
  // existence and self-description are asserted; B9's `UNVERIFIED` verdict is
  // NOT. A repository with no ARM64 device must be able to say so, and this
  // check is what makes "no ARM device was attached" a recorded fact rather
  // than an omission.
  {
    const rel = "apps/dashboard/perf/arm-probe.json"
    let artifact = null
    if (!missing(rel)) {
      try {
        artifact = JSON.parse(readText(p(rel)))
      } catch {
        artifact = null
      }
    }
    const facts = []
    facts.push(artifact !== null)
    if (artifact) {
      facts.push(artifact.schema === "picc-arm-probe-record/1")
      facts.push(artifact.probe?.schema === "picc-arm-probe/1")
      facts.push(typeof artifact.probe?.platform === "string")
      facts.push(artifact.host?.isArm64 === false || artifact.host?.isArm64 === true)
      facts.push(typeof artifact.rows?.B9?.verdict === "string")
      facts.push(typeof artifact.rows?.B9?.reason === "string" && artifact.rows.B9.reason.length > 0)
      facts.push(typeof artifact.rows?.B12?.verdict === "string")
    }
    measured["arm.probe-artifact-present"] = facts.filter((ok) => ok).length
    detail.armProbe = {
      artifact: rel,
      present: artifact !== null,
      factsPresent: facts.filter((ok) => ok).length,
      factsExpected: facts.length,
      hostIsArm64: artifact?.host?.isArm64 ?? null,
      b9Verdict: artifact?.rows?.B9?.verdict ?? null
    }
  }

  /* --------------------------------------------------------------- 21 --- */
  // EVERY BUDGET'S VERDICT. Owner: perfBudgetVerdicts.test.mjs:46-83.
  //
  // Counted, at-least 12: rows that carry a verdict drawn from the manifest's
  // OWN closed vocabulary AND a non-empty reason. The check deliberately does
  // not ask that any row be `pass`: B1 and B3 are BREACH, B2 is
  // WITHDRAWN_UNMEASURED, B9 is UNVERIFIED, and AC-044 names those breaches as
  // things to keep visible. A seam gate that demanded a clean sweep would make
  // the honest states unrepresentable, and a manifest with no row at all would
  // score zero here rather than "nothing to report".
  {
    const rel = "apps/dashboard/perf/budget-verdicts.json"
    let manifest = null
    if (!missing(rel)) {
      try {
        manifest = JSON.parse(readText(p(rel)))
      } catch {
        manifest = null
      }
    }
    const facts = []
    let verdicted = 0
    if (manifest) {
      const vocabulary = manifest.vocabulary?.tokens
      facts.push(manifest.schema === "picc-budget-verdicts/1")
      facts.push(Array.isArray(vocabulary) && vocabulary.length > 0)
      facts.push(manifest.vocabulary?.satisfyingTokens?.length === 1)
      facts.push(Array.isArray(manifest.rows) && manifest.rows.length === 12)
      const ids = (manifest.rows || []).map((r) => r.id)
      facts.push(Array.isArray(vocabulary) && vocabulary.length >= 7)
      for (const row of manifest.rows || []) {
        const ok = Array.isArray(vocabulary) && vocabulary.includes(row.verdict) && typeof row.reason === "string" && row.reason.trim().length > 0
        if (ok) verdicted += 1
      }
    }
    measured["budget.every-row-verdicted"] = verdicted
    detail.budgetVerdicts = {
      artifact: rel,
      present: manifest !== null,
      factsPresent: facts.filter((ok) => ok).length,
      factsExpected: facts.length,
      rowsVerdicted: verdicted,
      rowsExpected: 12,
      verdicts: (manifest?.rows || []).map((r) => ({ id: r.id, verdict: r.verdict }))
    }
  }

  /* ======================================================================
     THE OPEN-ITEMS PROJECTION - surfaced, never blocking, always COUNTED
     ======================================================================
     T21 does not require a clean sweep. The branch deliberately carries
     honest incompleteness, and the gate's job is to make each item VISIBLE and
     CORRECTLY CLASSIFIED rather than to make it disappear. So these are a
     separate projection, reported whatever the exit code is, exactly as T20's
     `ownerDecisions` and `bestEffortFindings` were - and they are counts, so
     an empty projection cannot be mistaken for a full one. */
  const openItems = buildOpenItems({ root, tracked, manifest: safeJson(p("apps/dashboard/perf/budget-verdicts.json")) })

  return Object.freeze({
    schema: PROBE_SCHEMA,
    repoRoot: root,
    measured: Object.freeze(measured),
    detail: Object.freeze(detail),
    openItems: Object.freeze(openItems)
  })
}

function safeJson(abs) {
  try {
    return JSON.parse(readText(abs))
  } catch {
    return null
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The open items, each with the count that proves it was actually looked for.
 *
 * Every entry's `count` is measured from a real artefact at probe time. An
 * entry whose count is 0 is reported as RESOLVED rather than omitted, so the
 * projection cannot shrink by deletion alone.
 */
function buildOpenItems({ root, tracked, manifest }) {
  const p = (rel) => join(root, rel)
  const items = []

  // 1. Route-auth verdicts still owned by "decision" (T20R's deliberate deferral).
  //
  // Measured from the COMMENT-STRIPPED allowlist, not from raw text: the file's
  // own header states "62 of them are still marked owner:\"decision\"" in prose,
  // and a raw count returns 66 because four of the occurrences are in that very
  // header. Counting prose as data is how a backlog number goes stale silently,
  // which is the reason the file records its counts in the first place.
  {
    const rel = "apps/dashboard/server/__tests__/ws7RouteAuthCoverageGuard.test.mjs"
    const stripped = exists(p(rel)) ? stripComments(readText(p(rel))) : ""
    // Count the ROW TERMINATOR, not every occurrence: a row ends with a line that
    // is nothing but `owner: "decision"`. Counting the token anywhere returns 66
    // against a real 62 because four occurrences live in the header prose that
    // states the number - which is how a recorded count goes stale silently.
    const decisions = (stripped.match(/^\s*owner:\s*"decision"\s*,?\s*$/gm) || []).length
    const declared = (stripped.match(/^\s*owner:\s*"declared"\s*,?\s*$/gm) || []).length
    items.push({
      id: "route-auth-verdicts-deferred",
      classification: "DELIBERATELY DEFERRED",
      count: decisions,
      of: decisions + declared,
      ownerRuling:
        "the owner's 2026-09-30 ruling deferred every read-shaped route; T20R gated 21 (their entries DELETED) and ruled 3 public (reclassified owner:\"declared\")",
      where: `${rel} - the allowlist's row terminators, comment-stripped`,
      note: "the file's header prose says 62; the comment-stripped row count above is the measurement and is the authority"
    })
  }

  // 2. The honest `incomplete` rooms. AC-020:929 forbids `complete` here.
  {
    const rel = "apps/dashboard/src/terminal/domain/readOnlyRoomCompletions.ts"
    const src = exists(p(rel)) ? stripComments(readText(p(rel))) : ""
    const incomplete = (src.match(/verdict\s*:\s*"incomplete"/g) || []).length
    const complete = (src.match(/verdict\s*:\s*"complete"/g) || []).length
    const strategyRel = "apps/dashboard/src/pages/ministry/reservedRooms.tsx"
    const strategySrc = exists(p(strategyRel)) ? stripComments(readText(p(strategyRel))) : ""
    const strategyIncomplete = /verdict\s*:\s*"incomplete"/.test(strategySrc) ? 1 : 0
    items.push({
      id: "rooms-honestly-incomplete",
      classification: "HONEST INCOMPLETENESS",
      count: incomplete + strategyIncomplete,
      of: incomplete + complete + strategyIncomplete,
      ownerRuling:
        "STRATEGY_COMPLETION is a reserved placeholder whose Financial Twin is not derivable; trading/simulator's twin is write-only. AC-020:929 forbids `complete` for either.",
      where: `${rel} + ${strategyRel}`
    })
  }

  // 3. Open handoffs carried forward in the changelog.
  {
    const entriesDir = p("docs/trading-logic/changelog/entries")
    const names = exists(entriesDir)
      ? readdirSync(entriesDir).filter((f) => /^\d{4}-.*\.md$/.test(f))
      : []
    // Count HANDOFF ROWS, not the phrase "STILL OPEN".
    //
    // The first cut counted `(body.match(/STILL OPEN/g) || []).length` and
    // reported 26. That number was wrong: entries 0030 and 0031 mention the
    // phrase in PROSE (4 occurrences), so the phrase count was never the
    // handoff count. A prose mention is not a handoff, and counting one makes
    // the open-item number drift every time someone edits a sentence. Handoffs
    // are the table rows whose id column is `NNNN-N`; a row is open when its
    // status cell says STILL OPEN.
    //
    // The count is deliberately SELF-REFERENTIAL: writing this entry's own
    // handoff table adds six open rows to the total it reports. That is
    // correct - a guard that excluded its own entry would understate the work
    // it just created - so the number moves and the test moves with it.
    let rows = 0
    let open = 0
    const perEntry = []
    for (const name of names) {
      const lines = readText(join(entriesDir, name)).split(/\r?\n/)
      const handoffs = lines.filter((l) => /^\|\s*\d{4}-\d+\s*\|/.test(l))
      if (handoffs.length === 0) continue
      const openRows = handoffs.filter((l) => /STILL OPEN/i.test(l))
      rows += handoffs.length
      open += openRows.length
      perEntry.push({ entry: name, rows: handoffs.length, open: openRows.length })
    }
    items.push({
      id: "changelog-handoffs-open",
      classification: "CARRIED FORWARD",
      count: open,
      of: rows,
      ownerRuling:
        "handoff tables live in entries 0028, 0032 and 0035 (34 rows total); 28 rows are STILL " +
        "OPEN, and 6 of those are this entry's own. DISCREPANCY, not silently resolved: the owner " +
        "stated 15 open handoffs, which reconciles to neither the measured 28 nor the 34 total, " +
        "and no reading of the tables yields 15. Either the owner's figure counts a narrower set " +
        "(e.g. only handoffs whose owner is a WS-7 task rather than a named downstream owner), " +
        "or rows have been closed since. The measured 28 is reported; the owner's 15 needs a " +
        "ruling on which rows are in scope before the count can be called reconciled.",
      where: "docs/trading-logic/changelog/entries/*.md (table rows with an `NNNN-N` id column)",
      detail: { perEntry, phraseOccurrencesWouldBe: 26 }
    })
  }

  // 4. Budget rows that are NOT `pass`, by id and verdict.
  {
    const rows = (manifest?.rows || []).filter((r) => r.verdict !== "pass")
    items.push({
      id: "budget-rows-not-passing",
      classification: "RECORDED NON-PASS",
      count: rows.length,
      of: (manifest?.rows || []).length,
      ownerRuling:
        "B1/B3 BREACH (B1 not rescued by the ARM re-baseline); B2 WITHDRAWN_UNMEASURED (D21 withdrew the ~1800 ms figure, so the supersession governs over AC-045); B9 UNVERIFIED (no ARM64 device, and no figure may be fabricated)",
      where: "apps/dashboard/perf/budget-verdicts.json",
      rows: rows.map((r) => ({ id: r.id, verdict: r.verdict }))
    })
  }

  // 5. The order-execution affordances inside a read-only room.
  {
    const rel = "apps/dashboard/src/terminal/domain/readOnlyRoomCompletions.ts"
    const src = exists(p(rel)) ? stripComments(readText(p(rel))) : ""
    // The affordance rows are multi-line object literals, so the route string is
    // scanned on its own rather than through a `route:` key that is never
    // adjacent to it.
    const routes = [...new Set([...src.matchAll(/["'](\/api\/command-centre\/perps\/[a-z-]+)["']/g)].map((m) => m[1]))]
    items.push({
      id: "write-affordances-in-read-only-room",
      classification: "OWNER DECISION - SURFACED, NOT REMOVED",
      count: routes.length,
      of: null,
      ownerRuling:
        "trading/command-centre is a room D1 calls read-only and it POSTs order execution and position close; this is an owner decision, surfaced not removed. T20's gate reports all twenty-five affordances across twelve instances in `ownerDecisions` with blocking:false.",
      where: `${rel} + scripts/cross-room-invariant-gate.mjs report.ownerDecisions`,
      routes
    })
  }

  // 6. The unlanded WS-7 tasks. Measured from git, not from prose.
  {
    let subjects = ""
    let gitRead = true
    try {
      subjects = execFileSync("git", ["log", "--format=%s", "--all"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024
      })
    } catch {
      gitRead = false
    }
    const all = ["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13", "T14", "T15", "T16", "T17", "T18", "T19", "T20"]
    // A task counts as landed when a commit subject names the WORKSTREAM and the
    // task token. Matching the token alone would credit WS-6's `T5-T8 + T12` and
    // WS-5's `T5 operability` to WS-7, and matching a fixed prefix would miss
    // T3/T4/T5, whose subjects read `fix(ws7): T3 ...`.
    const landed = (task) =>
      subjects
        .split(/\r?\n/)
        .filter((s) => /(?:WS-7|WS7|ws7)/i.test(s))
        .some((s) => new RegExp(`(?<![A-Za-z0-9])${task}(?![0-9])`).test(s))
    const open = gitRead ? all.filter((t) => !landed(t)) : all
    items.push({
      id: "ws7-tasks-without-a-commit",
      classification: gitRead ? "OPEN TASK" : "UNMEASURED - git history unreadable",
      count: open.length,
      of: all.length,
      ownerRuling:
        "measured from `git log --format=%s --all`: a task with no commit subject naming `WS-7 <task>` has NOT landed, whatever PICC.md's registry row claims",
      where: "git history",
      tasks: open
    })
  }

  // 7. The `.github/workflows/**` whitelist deviation - T20 asked T21 to settle it.
  {
    const workflows = tracked.filter((f) => f.startsWith(".github/workflows/"))
    const ci = exists(p(".github/workflows/ci.yml")) ? readText(p(".github/workflows/ci.yml")) : ""
    items.push({
      id: "ci-workflow-whitelist-deviation",
      classification: "OWNER DECISION - ANSWERED, AMENDMENT NOT TAKEN",
      count: workflows.length,
      of: null,
      ownerRuling:
        "the answer is `npm test` is sufficient AND a dedicated job is technically feasible. T20 declined a job because its gate needs a TSX facts producer and could not run standalone; " +
        "that blocker does NOT transfer - this gate is plain .mjs and runs from a bare `node scripts/ws7-seam-guard.mjs`, proven by the guard's own process sweep. " +
        "The job is still NOT added: .github/workflows/** is outside the file-touch union at spec:73(d), which requires a dated spec amendment, and T13 already holds that " +
        "deviation open in entry 0025. This is the consolidation T20 asked T21 for; what remains is one owner decision, not an open question.",
      where: "spec:73(d) + docs/trading-logic/changelog/entries/0025 + scripts/ws7-seam-guard.mjs",
      workflows,
      ciRunsNpmTest: /^\s*(?:-\s+)?run:\s*npm test\s*$/m.test(ci),
      ciHasStandaloneGateJob: /run:\s*node\s+scripts\/[\w-]*gate\.mjs/.test(ci)
    })
  }

  return items
}