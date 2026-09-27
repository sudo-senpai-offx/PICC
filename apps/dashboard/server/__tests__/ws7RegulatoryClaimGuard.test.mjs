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
// THE VOCABULARY IS COMPOSITIONAL, NOT FIVE LITERAL STRINGS. The first version
// of this guard banned exactly the five strings the brief supplied, and that is
// a defect rather than an implementation detail: a guard that only knows five
// spellings cannot catch a sixth spelling of the same claim, so it neither
// discharges the deletion nor discharges the discovered-scope requirement - a
// claim could be reintroduced in a new file AND a new wording at once. The real
// runbook proved it: four licensing assertions survived because they said
// "SC investor-alert", "SC approval", "Labuan FSA licence" and "RMO-DAX".
//
// A CLAIM IS COMPOSED, NOT SPELLED. Every rule below is a REGEX, matched in one
// of two normalisations, and each carries a `why` so the vocabulary explains
// itself instead of being a bag of strings:
//
//   mode "squeezed" - all whitespace removed and lower-cased. This is what
//     survives a claim wrapped across a line break or split at a hyphen; the
//     original per-line scan structurally could not see "SC-\\nregistered".
//   mode "spaced"   - runs of whitespace collapsed to one space, so word
//     boundaries survive and a STANDALONE designation token ("SC approval",
//     "RMO-DAX", "Securities Commission") is visible as a word. Squeezing
//     cannot do this: it would glue "dual sc + labuan fsa" into "dualsc+" and
//     destroy the token boundary that makes the proximity rules work.
//
// Three things are DELIBERATELY NOT BANNED, because banning them would flag
// honest text and a guard that fails on honest text gets weakened by whoever
// next touches it. Each is pinned by a test below so the boundary cannot drift:
//
//   - "DAX" as a financial-licensing designation is banned; "DAX" as the German
//     DAX-40 equity index is NOT. assetCatalog.mjs, tradingCatalog.mjs,
//     u4faConfig.mjs and list-watch-assets.mjs use it for the index. The DAX
//     rules therefore require a licensing word nearby, and the index files are
//     asserted clean.
//   - "unregulated" on its own is NOT banned. In this codebase it appears only
//     as PICC's own conservative SAFETY posture - the ExpertOption truth-table
//     row that forbids live money on an unregulated venue. D26 targets claims
//     that endorse a venue's status; removing the word that justifies a safety
//     restriction would weaken the restriction. The jurisdictional-status rule
//     still catches "unregulated locally" / "not regulated" / "unlicensed
//     locally", which are the endorsement-shaped phrasings.
//   - "KYC" on its own is NOT banned, and the KYC rule is DIRECTIONAL. It fires
//     on an assertion that a third party does NOT require KYC, not on the mere
//     presence of the word. captureProfiles.mjs says "KYC mandatory" - that is
//     PICC refusing such a venue, the opposite of a claim - and the runbook's
//     "system-side KYC queue" and "KYC/AML" describe observed provider
//     behaviour. All stay.
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

const squeezed = (s) => s.replace(/\s+/g, "").toLowerCase()
const spaced = (s) => s.replace(/\s+/g, " ").toLowerCase()

// Shared vocabularies for the compositional rules.
const LICENCE_WORD =
  "licensed|licences|licenses|licensing|registered|registration|approved|approval|authorised|authorized|chartered|accredited|regulated"
const REGULATOR_TOKEN = "sc|fsa|rmo|sec|msb|bnm"
const near = (n) => `[a-z0-9,.+'"\\s-]{0,${n}}`

const CLAIM_VOCABULARY = [
  {
    id: "explicit-sc-registration",
    mode: "squeezed",
    re: /sc(registered|licensed|regulated|approved|authorised|authorized|recognised|recognized|accredited)/,
    why: "the SC form with any status adjective, not just registered/licensed. 'SC-regulated' survived the first pass precisely because the vocabulary only knew two adjectives"
  },
  {
    id: "named-regulator",
    mode: "squeezed",
    re: /securitiescommission|labuanfsa|fsalicen[cs]ed?|scinvestoralert|investoralert/,
    why: "a regulator, or a regulator-grade alert class, named alongside a status claim"
  },
  {
    id: "rmo-designation",
    mode: "squeezed",
    re: /rmo(?=[a-z0-9]{0,24}(dax|registered|licen|approv|regulat))/,
    why: "the RMO recognised-market-operator designation, scoped by a licensing word so it cannot match 'thermostat' (bare rmo hits 71 files)"
  },
  {
    id: "dax-designation",
    mode: "squeezed",
    re: /dax(?=[a-z0-9]{0,30}(registered|licen|approv|regulat|securit))/,
    why: "DAX as a licensing designation, scoped by a licensing word so the DAX-40 equity index is not flagged"
  },
  {
    id: "entity-licensing-claim",
    mode: "squeezed",
    re: new RegExp(
      `(licensed|licences|licenses|licensing)(?=[a-z0-9,.+'"-]{0,40}` +
        `(exchange|provider|bank|platform|venue|broker|custodian|fintech|onramp|securit|regulat|commission|fsa|digitalasset|assetwork|marketoperator|dealer|issuer))`
    ),
    why: "a licensing word applied to a financial entity. 'registered broker' and 'approved venue' are deliberately NOT here: those are PICC's own in-process broker registry and its capture-approval ceremony, not a regulator"
  },
  {
    id: "registration-entity-claim",
    mode: "squeezed",
    re: new RegExp(
      `(registered|registration)(?=[a-z0-9,.+'"-]{0,30}` +
        `(exchange|digitalasset|assetwork|securit|bank|paymentprovider|custodian|issuer|dealer|marketoperator|fintech|insur|trust))`
    ),
    why: "'registered' next to a FINANCIAL entity. The entity list deliberately omits broker/venue/connector/adapter/registry, because 'registered broker' and 'registered trading venue' are PICC's own in-process registry and its capture-approval ceremony, not a regulator"
  },
  {
    id: "kyc-exemption-claim",
    mode: "squeezed",
    re: /nokyc|withoutkyc|kycclear|kyc(?=[a-z0-9]{0,12}(notrequired|notneeded|optional|free|bypass|exempt|unnecessary))/,
    why: "asserting a third party's KYC status - that it does not require KYC, or that it is 'KYC-clear'. Directional on purpose, so PICC's own 'KYC mandatory' capture gate and the runbook's observed 'KYC queue' are not flagged. The filler-tolerant lookahead exists because 'KYC is not required' and 'KYC not required' are the same claim with different glue"
  },
  {
    id: "jurisdiction-status-claim",
    mode: "squeezed",
    re: /unregulatedlocally|unregulatedin|notregulated|unlicensedlocally|licensingstatus|regulatorystatusverified/,
    why: "a jurisdictional regulatory-status claim, in either direction: 'unregulated locally' asserts one, 'regulatory status verified' asserts the opposite"
  },
  {
    id: "regulator-proximity-claim",
    mode: "spaced",
    re: new RegExp(
      `\\b(?:${REGULATOR_TOKEN})\\b${near(40)}(?:${LICENCE_WORD})\\b` +
        `|(?:${LICENCE_WORD})\\b${near(40)}\\b(?:${REGULATOR_TOKEN})\\b`,
      "g"
    ),
    why: "a standalone regulator/designation token sitting next to any licensing word, in EITHER order. This is the rule that catches a phrasing nobody enumerated, in either word order"
  },
  {
    id: "named-regulator-spaced",
    mode: "spaced",
    re: /\bsecurities commission\b|\blabuan fsa\b/,
    why: "the regulator written out in full rather than abbreviated, so 'Securities Commission Malaysia' and 'Labuan FSA' are caught whichever form an author reaches for"
  },
  {
    id: "standalone-dax-licensing",
    mode: "spaced",
    re: new RegExp(`\\bdax\\b${near(40)}(?:${LICENCE_WORD})\\b|(?:${LICENCE_WORD})\\b${near(40)}\\bdax\\b`, "g"),
    why: "DAX as a standalone word near a licensing word. Scoped, so asset aliases ('dax' in ger40) and 'dax40' are not flagged"
  }
]

// ---------------------------------------------------------------------------
// DISCOVERED FILE SET
// ---------------------------------------------------------------------------
function git(...args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64e6 })
}

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
const isBuildOutput = (f) => BUILD_OUTPUT_PREFIXES.some((p) => f.startsWith(p) || f.includes("/" + p))
const trackedUnderBuildOutput = TRACKED.filter(isBuildOutput)

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|bz2|xz|7z|rar|mp3|mp4|wav|mov|webm|woff2?|ttf|otf|eot|exe|dll|so|dylib|wasm|bin|dat|db|sqlite3?|onnx|pt|pth|joblib|parquet|pkl|npy|npz)$/i
const MAX_BYTES = 1_000_000

const SCANNABLE = TRACKED.filter((f) => {
  if (isBuildOutput(f)) return false
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

// This file names the vocabulary it bans, so it cannot scan itself.
const SELF_EXCLUSION = {
  file: SELF,
  reason: "This guard names the claim vocabulary in order to ban it; a guard cannot forbid a string it must contain."
}

const isDocExcluded = (f) => DOC_EXCLUSIONS.some((d) => f.startsWith(d.prefix))

// ---------------------------------------------------------------------------
// ALLOWLIST - claims that are NOT third-party assertions
// ---------------------------------------------------------------------------
// A blanket ban would be the wrong guard: it would fail on these, and the right
// response to that failure would be to delete honest text. Each entry permits
// exactly one vocabulary rule's matches in exactly one file at an exact
// occurrence count, so a NEW claim in an allowlisted file is still caught, and a
// stale entry (the text it permitted is gone) is itself a failure. `reason` is
// mandatory and non-empty.
const ALLOWLIST = [
  {
    file: "apps/dashboard/server/services/btcpay.mjs",
    rule: "kyc-exemption-claim",
    occurrences: 1,
    reason:
      "Header comment describing PICC's OWN self-hosted BTCPay Server deployment, not a third party's status. R5.4 forbids asserting a third party's status without in-tree evidence; here the evidence IS in-tree - the repo bundles the deployment at infra/btcpayserver/btcpayserver-docker and runs it. Deleting this would be over-correction."
  },
  {
    file: "apps/dashboard/src/lib/api.ts",
    rule: "kyc-exemption-claim",
    occurrences: 1,
    reason:
      "Section-header comment for the same PICC-owned self-hosted BTCPay integration. Same in-tree evidence (infra/btcpayserver/). A comment, not a user-facing claim."
  },
  {
    file: "apps/dashboard/.env.example",
    rule: "kyc-exemption-claim",
    occurrences: 1,
    reason:
      "Operator-facing config comment describing the self-hosted BTCPay instance the operator points at. Same in-tree evidence. Found by machine scan rather than by the original hand list, but identical in class."
  },
  {
    file: "PICC.md",
    rule: "kyc-exemption-claim",
    occurrences: 2,
    reason:
      "PICC's own record rather than a third-party claim. (1) The payment-methods section describing the self-hosted BTCPay node - same in-tree evidence. (2) The D26 decision-table row that NAMES the deleted claims to record that they were deleted; that is the project documenting this very deletion, the same status as the spec exclusion."
  },
  {
    file: "PICC.md",
    rule: "dax-designation",
    occurrences: 1,
    reason:
      "The D26 decision-table row again: it writes 'SC/DAX licensing' to name the class of claim it deleted. The same row already allowlisted under kyc-exemption-claim; a rule set is a claim, so several rules can fire on one line."
  },
  {
    file: "PICC.md",
    rule: "standalone-dax-licensing",
    occurrences: 1,
    reason:
      "The same D26 decision-table row, caught by the word-boundary variant of the DAX rule rather than the squeezed one. Same justification."
  },
  {
    file: "docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md",
    rule: "kyc-exemption-claim",
    occurrences: 2,
    reason:
      "Both hits are dated, user-attributed entries in the runbook's status log - 'transak KYC-cleared (2026-09-06, user report)' and 'hata KYC-cleared + first funded balance (2026-09-11, user report)'. Those record an action PICC itself performed, with a date and a source, so they are operational history rather than an unevidenced assertion about a provider's onboarding terms. The claim-shaped use of the same words WAS deleted this round ('SC-regulated, eWallet-proven, KYC-clear' as a list of adjectives justifying a route recommendation). Bounded to exactly 2, so a third occurrence in this file is caught."
  },
  {
    file: "apps/dashboard/src/terminal/components/__tests__/StatusBoundary.test.tsx",
    rule: "entity-licensing-claim",
    occurrences: 1,
    reason:
      "The fixture uses \"settlementAuthority: 'licensed-custodian'\" against \"counterpartyAuthority: 'independent-cs'\". That is PICC's OWN terminal trust-boundary vocabulary - the distinction between an independent counterparty and a licensed custodian is one PICC defines about its own architecture - not an assertion about any third party's regulatory status. Banning the word here would flag PICC describing its own safety boundary."
  }
]

// ---------------------------------------------------------------------------
// THE SCAN
// ---------------------------------------------------------------------------
const VOCAB_BY_ID = new Map(CLAIM_VOCABULARY.map((v) => [v.id, v]))

function countMatches(file, ruleId) {
  const rule = VOCAB_BY_ID.get(ruleId)
  if (!rule) throw new Error(`unknown vocabulary rule ${ruleId}`)
  const text = readFileSync(join(REPO_ROOT, file), "utf8")
  const hay = rule.mode === "spaced" ? spaced(text) : squeezed(text)
  const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g")
  let n = 0
  while (re.exec(hay) !== null) n++
  return n
}

const findings = []
for (const file of SCANNABLE) {
  if (isDocExcluded(file) || file === SELF) continue
  for (const rule of CLAIM_VOCABULARY) {
    const occurrences = countMatches(file, rule.id)
    if (occurrences === 0) continue
    const permitted = ALLOWLIST.find((a) => a.file === file && a.rule === rule.id)
    if (permitted && permitted.occurrences === occurrences) continue
    findings.push(
      `${file}: ${occurrences} x [${rule.id}]${permitted ? ` (allowlist declares ${permitted.occurrences})` : ""} - ${rule.why}`
    )
  }
}

// Files that use DAX / KYC / "unregulated" in senses that are NOT licensing
// claims. Pinned so the scoping decisions in the vocabulary comments cannot be
// "simplified" away into a guard that fails on honest text.
const INDEX_SENSE_FILES = [
  "apps/dashboard/server/services/assetCatalog.mjs",
  "apps/dashboard/server/services/tradingCatalog.mjs",
  "apps/dashboard/server/services/u4faConfig.mjs",
  "scripts/list-watch-assets.mjs"
]

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

// The D26 claim classes deleted by T5a and its fix round. Asserted individually
// so a class cannot be silently emptied while the directory stays non-empty.
const D26_RULE_IDS = [
  "VENDOR_REGULATORY_STATUS",
  "VENUE_KYC_TERMS",
  "STAKING_JURISDICTION_STATUS",
  "RUNBOOK_LICENSING_ASSERTION",
  "RUNBOOK_DESIGNATION_CLAIM"
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

describe("AC-049 - the vocabulary matches the claim CLASS, not five literal strings", () => {
  it("is compositional: every rule is a regex carrying a written rationale", () => {
    expect(CLAIM_VOCABULARY.length, "the vocabulary must cover more than the original five strings").toBeGreaterThanOrEqual(10)
    for (const rule of CLAIM_VOCABULARY) {
      expect(rule.re instanceof RegExp, `${rule.id} must be a regex so it can compose, not a literal`).toBe(true)
      expect(typeof rule.why, `${rule.id} must document why it exists`).toBe("string")
      expect(rule.why.trim().length, `${rule.id} needs a substantive reason`).toBeGreaterThan(40)
      expect(["squeezed", "spaced"], `${rule.id} must declare its normalisation`).toContain(rule.mode)
    }
    const ids = CLAIM_VOCABULARY.map((r) => r.id)
    expect(new Set(ids).size, "vocabulary rule ids must be unique").toBe(ids.length)
  })

  it("matches the regulator tokens the ruling named, in either word order", () => {
    const probe = (text) => {
      const hay = { squeezed: squeezed(text), spaced: spaced(text) }
      return CLAIM_VOCABULARY.filter((r) => new RegExp(r.re.source, r.re.flags).test(hay[r.mode])).map((r) => r.id)
    }
    // Phrasings nobody enumerated, in files that did not exist when the brief
    // was written. Each must be caught by the class, not by a literal string.
    for (const text of [
      "Luno is a registered digital asset exchange in Malaysia.",
      "Hata holds a licence from the Labuan FSA.",
      "The platform is an approved SC-recognised venue.",
      "This provider is RMO approved since 2019.",
      "Hata is a DAX registered with the SC.",
      "MX Global is regulated by the SC.",
      "Hata is SC-regulated and the lead rail.",
      "KYC is not required to use this venue."
    ]) {
      expect(probe(text), `class-level catch must fire on: ${text}`).not.toEqual([])
    }
  })

  it("does not fire on an honest disclaimer of the very thing it hunts", () => {
    // A guard for unverifiable claims must not punish the verified form. Saying
    // PICC has NOT checked something is the honest sentence; flagging it would
    // push authors toward deleting the disclaimer.
    const probe = (text) => {
      const hay = { squeezed: squeezed(text), spaced: spaced(text) }
      return CLAIM_VOCABULARY.filter((r) => new RegExp(r.re.source, r.re.flags).test(hay[r.mode])).map((r) => r.id)
    }
    for (const text of [
      "PICC has not verified the DAX status of this venue.",
      "Regulatory status is unverified for every venue listed here."
    ]) {
      expect(probe(text), `an explicit disclaimer must not be flagged: ${text}`).toEqual([])
    }
  })

  it("does not fire on the same words used in a non-licensing sense", () => {
    const probe = (text) => {
      const hay = { squeezed: squeezed(text), spaced: spaced(text) }
      return CLAIM_VOCABULARY.filter((r) => new RegExp(r.re.source, r.re.flags).test(hay[r.mode])).map((r) => r.id)
    }
    for (const text of [
      "feeds are read through the MIT-licensed ccxt library",
      "adopt permissively-licensed code freely",
      "upload once, earn licensing fees",
      "no connector registered for this platform",
      "KYC mandatory for this capture path",
      "the payment provider has a system-side KYC queue"
    ]) {
      expect(probe(text), `must not fire on legitimate text: ${text}`).toEqual([])
    }
  })

  it("leaves the DAX equity index and PICC's own broker registry alone", () => {
    // Pinned explicitly: if someone later simplifies the DAX rules to a bare
    // "dax", or reintroduces "registered" into the entity rule, these fail
    // loudly instead of quietly making the guard useless.
    for (const f of INDEX_SENSE_FILES) {
      for (const rule of CLAIM_VOCABULARY) {
        expect(countMatches(f, rule.id), `${f} must stay clean of [${rule.id}] (DAX-40 index sense)`).toBe(0)
      }
    }
  })
})

describe("AC-049 - no unverifiable third-party regulatory/KYC claim survives", () => {
  it("finds no claim outside the reasoned allowlist", () => {
    expect(
      findings,
      "D26 deletes these claims; a survivor means an unevidenced third-party assertion is user-facing again. Delete the claim, or - if it is genuinely about PICC's own in-tree deployment or architecture - add a reasoned ALLOWLIST entry above."
    ).toEqual([])
  })

  it("keeps every allowlist entry live, exactly counted, and justified", () => {
    for (const entry of ALLOWLIST) {
      expect(existsSync(join(REPO_ROOT, entry.file)), `allowlisted file ${entry.file} must still exist`).toBe(true)
      expect(VOCAB_BY_ID.has(entry.rule), `allowlist entry ${entry.file} names unknown rule ${entry.rule}`).toBe(true)
      expect(
        typeof entry.reason === "string" && entry.reason.trim().length > 60,
        `allowlist entry ${entry.file} / [${entry.rule}] must carry a written reason, not a bare marker`
      ).toBe(true)
      expect(
        countMatches(entry.file, entry.rule),
        `allowlist entry ${entry.file} / [${entry.rule}] is stale: the text it permitted has changed count. Remove the entry or restate it.`
      ).toBe(entry.occurrences)
    }
  })

  it("still allows the BTCPay self-hosted comments rather than blanket-banning them", () => {
    // The precise-allowlist property: these survive because they are in-tree
    // verifiable claims about PICC's own deployment, not because the guard is
    // blind to them. Widening the vocabulary must not have widened the ban.
    const btcpay = ALLOWLIST.filter((a) => a.file.includes("btcpay") || a.file.endsWith("api.ts") || a.file.endsWith(".env.example"))
    expect(btcpay.length, "BTCPay self-hosted comments must be explicitly allowlisted").toBeGreaterThanOrEqual(3)
    for (const entry of btcpay) {
      expect(entry.rule, "each BTCPay allowance must be keyed to the KYC-exemption rule").toBe("kyc-exemption-claim")
      expect(entry.reason, "each BTCPay allowance must justify why it is not a third-party claim").toMatch(/self-hosted|in-tree/i)
      expect(countMatches(entry.file, entry.rule), `${entry.file} must still contain the allowlisted text`).toBeGreaterThan(0)
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

  it("keeps a record for each of the five D26 claim classes", () => {
    const corpus = entryFiles.map((n) => readFileSync(join(ENTRIES_DIR, n), "utf8")).join("\n")
    const missing = D26_RULE_IDS.filter((id) => !corpus.includes(`rule: ${id}`))
    expect(missing, "each D26 claim class must keep its supersession record").toEqual([])
  })
})
