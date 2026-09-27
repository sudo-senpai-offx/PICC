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
// of three normalisations, and each carries a `why` so the vocabulary explains
// itself instead of being a bag of strings:
//
//   mode "squeezed" - all whitespace AND hyphens removed, lower-cased. This is
//     what survives a claim wrapped across a line break or split at a hyphen;
//     the original per-line scan structurally could not see "SC-\nregistered".
//     Hyphens go too so that "virtual-asset" collapses onto "virtualasset" and
//     the entity list needs no hyphenated twin of every entry.
//   mode "clause"   - the text split into SENTENCE segments, and each segment
//     scanned separately. A proximity window may then cross spaces WITHIN a
//     sentence but can never cross a sentence, which is what a
//     whitespace-inclusive window over collapsed newlines used to do. A newline
//     is NOT a sentence: soft-wrapped lines are re-joined before the split (see
//     rejoinSoftWraps), because treating every line break as a sentence end is
//     itself an evasion hole - the same one the original per-line scan had.
//   mode "spaced"   - whitespace runs collapsed to one space, so word
//     boundaries survive and a STANDALONE token ("SC approval", "RMO-DAX",
//     "Securities Commission") is visible as a word. Squeezing cannot do this:
//     it would glue "dual sc + labuan fsa" into "dualsc+" and destroy the token
//     boundary that makes the proximity rules work.
//
// THE TRIGGERS ARE DERIVED, NEVER HAND-LISTED. Every rule that fires on a
// licensing term takes that term from the single LICENCE_WORD array. An earlier
// version hand-listed a four-word subset in one rule while LICENCE_WORD carried
// thirteen, and paraphrases built on `accredited`, `recognised` or `regulated`
// walked past a green guard. Where PICC has its own unrelated use of a word -
// "registered broker" is an in-process registry, "approved venue" is a capture
// ceremony - the exclusion is made in the ENTITY list or documented as a probe,
// never by quietly dropping words from the trigger.
//
// Five things are DELIBERATELY NOT BANNED, because banning them would flag
// honest text and a guard that fails on honest text gets weakened by whoever
// next touches it. Each is pinned by a test below so the boundary cannot drift:
//
//   - "DAX" as a financial-licensing designation is banned; "DAX" as the German
//     DAX-40 equity index is NOT. assetCatalog.mjs, tradingCatalog.mjs,
//     u4faConfig.mjs and list-watch-assets.mjs use it for the index. The DAX
//     rules therefore require an ADJACENT licensing word - a distance window let
//     "the DAX methodology section for the licensed-venue policy" match - and
//     the index files are asserted clean.
//   - "unregulated" on its own is NOT banned. In this codebase it appears only
//     as PICC's own conservative SAFETY posture - the ExpertOption truth-table
//     row that forbids live money on an unregulated venue. D26 targets claims
//     that endorse a venue's status; removing the word that justifies a safety
//     restriction would weaken the restriction. The jurisdictional-status rule
//     still catches "unregulated locally", "not regulated", "unlicensed locally"
//     and "regulatory status verified".
//   - "KYC" on its own is NOT banned, and the KYC rule is DIRECTIONAL. It fires
//     on an assertion about a third party's KYC status, not on the mere presence
//     of the word. captureProfiles.mjs says "KYC mandatory" - that is PICC
//     refusing such a venue, the opposite of a claim - and the runbook's
//     "system-side KYC queue" and "KYC/AML" describe observed provider
//     behaviour.
//   - An honest disclaimer must not be flagged. "PICC has not verified the DAX
//     status of this venue" is the sentence the project wants; flagging it would
//     push authors toward deleting the disclaimer.
//   - fca/mas/asic are NOT regulator tokens here. Adding them made an honest
//     sentence ("The desk is regulated by the FCA") fire, and a claim that names
//     a financial entity is caught by the entity rule whatever the regulator.
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

// "squeezed" removes whitespace AND hyphens. Whitespace removal is what
// survives a claim wrapped across a line break; hyphen removal means
// "virtual-asset" collapses onto "virtualasset" so the entity list needs no
// hyphenated twin of every entry - an author writing "digital-asset" must not
// evade "digitalasset".
const squeezed = (s) => s.replace(/[\s-]+/g, "").toLowerCase()
const spaced = (s) => s.replace(/\s+/g, " ").toLowerCase()
// A newline inside a sentence is a SOFT WRAP - a source-formatting artefact -
// not the end of a thought. `clauses()` exists so a rule can treat one sentence
// as one haystack, and treating every newline as a sentence end is a line-wrap
// EVASION HOLE: "MX Global is a registered\ndigital asset exchange." is one
// claim, and a rule that only ever sees one line cannot match a licence word and
// an entity noun that sit on different lines. That is the same defect class the
// runbook round found, reintroduced inside the guard written to prevent it.
//
// The discriminator is what the PREVIOUS line ends with. Prose and comments wrap
// on a bare word; structured data - object literals, config maps, CSV, log
// lines - ends each record on a delimiter or a bracket. Joining THOSE would
// manufacture claims out of adjacent KEYS: "licensed: false," followed by
// 'platform: "binance"' reads as "licensed ... platform" and fires. A guard that
// flags honest config is a guard the next person weakens, so a line ending on a
// delimiter stays a boundary. A line ending in a HYPHEN is re-joined with no
// space, so "digital-\nasset" and "SC-\nregistered" come back whole - the case
// the file header above cites as the reason squeezed mode exists at all.
const OPENS_BLOCK = /^\s*(?:[-*+#>|\u2022]|\d+[.)])\s/
const rejoinSoftWraps = (s) => {
  const out = []
  for (const line of s.split("\n")) {
    const prev = out[out.length - 1]
    const wrapped =
      prev !== undefined &&
      prev.trim() !== "" &&
      line.trim() !== "" &&
      !OPENS_BLOCK.test(line) &&
      /[A-Za-z0-9-]$/.test(prev.trimEnd())
    if (!wrapped) {
      out.push(line)
      continue
    }
    const hyphenated = /-$/.test(prev.trimEnd())
    out[out.length - 1] = prev.trimEnd() + (hyphenated ? "" : " ") + line.trim()
  }
  return out.join("\n")
}
// "clause" is a sentence/bullet segment, SOFT WRAPS RE-JOINED. The proximity
// window may cross spaces WITHIN a clause but can never cross a clause
// boundary. That boundary is the fix for the defect where a whitespace-inclusive
// `near(40)` over collapsed newlines spanned sentence breaks and flagged
// ordinary prose - and rejoinSoftWraps is what keeps the boundary a SENTENCE
// boundary rather than a LINE boundary, which would have been a second evasion
// hole in the same guard.
const clauses = (s) =>
  rejoinSoftWraps(s)
    .split(/(?<=[.;!?])\s+|\n+|\s*[|\u2022]\s*/)
    .map((c) => c.replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean)

// THE TRIGGER VOCABULARY, DEFINED ONCE.
//
// `entity-licensing-claim` DERIVES its trigger from LICENCE_WORD instead of
// hand-listing a subset. Hand-listing is precisely what produced the last
// defect: the rule's trigger had drifted to four words while LICENCE_WORD
// carried thirteen, so paraphrases built on `accredited`, `recognised` or
// `regulated` walked straight past a green guard. One array, one consumer, and
// adding a word to LICENCE_WORD now widens every rule that consumes it.
//
// The array is spelled as SPELLINGS, not as lemmas: a trigger reads prose, so
// `licence` and `licenses` are both needed and neither subsumes the other. The
// bare SINGULARS are here because "The exchange holds a licence from the SC." is
// a claim - it is the same claim as "licensed" with a different part of speech -
// and a guard whose thesis is class coverage cannot miss it. It is safe against
// the in-word class: `\\blicence\\b` cannot match inside `unlicensed` (the `n`
// before it is a word character, so the leading boundary fails) nor inside
// `licences` (separately listed, and the trailing `s` fails the end boundary).
const LICENCE_WORD = [
  "licensed",
  "licence",
  "licences",
  "license",
  "licenses",
  "licensing",
  "registered",
  "registration",
  "approved",
  "approval",
  "authorised",
  "authorized",
  "chartered",
  "accredited",
  "regulated",
  "recognised",
  "recognized",
  "supervised"
]
const LICENCE_WORD_RE = LICENCE_WORD.join("|")

// Stems, for the two designation rules ONLY. In squeezed text a designation sits
// ADJACENT to its adjective ("daxregistered", "scregistereddax"), so those rules
// scope with a SEPARATOR gap rather than a distance window. A distance window
// is what let "the DAX methodology section for the licensed-venue policy" match
// across three ordinary words.
const LICENCE_STEM_RE =
  "licen|regist|approv|authoris|authoriz|charter|accredit|regulat|recognis|recogniz|supervis"

// Regulator / designation tokens as STANDALONE WORDS.
//
// `sc` is DELIBERATELY ABSENT. As a bare token it cannot be told apart from the
// US state abbreviation - and \bsc\b makes that a live false positive, because
// "Columbia, SC, the entity is registered in Delaware" is ordinary US-company
// prose, and Funding Societies is a US entity this repo's own runbook routes to.
// The two forms that actually matter are covered elsewhere, each by the rule
// that can distinguish them:
//   - the PREFIX forms ("SC-registered", "SC-regulated", "SC approval") are
//     `explicit-sc-registration`, where "SC" is glued to its adjective and no
//     other word can produce that shape;
//   - the ARTICLE form ("regulated by the SC") is `sc-regulator-reference`,
//     which requires the definite article, which a state abbreviation in a
//     comma-delimited list never has.
// fca/mas/asic are also absent: adding them was my own extension, it was not in
// the ruled vocabulary, and it made an honest sentence fire.
const REGULATOR_TOKEN = "fsa|rmo|sec|msb|bnm"

// Financial-entity nouns, declared as WORD PARTS so ONE declaration produces one
// regex whose multi-word entries tolerate a space, a hyphen or NOTHING between
// the parts - "money services", "money-services" and "moneyservices" all match
// the same entry, so an author writing "digital-asset" cannot evade
// "digital asset". Deriving the parts is what makes that possible; a second
// hand-written hyphenated list would be the same drift defect in a new place.
//
// It yields ONE pattern, consumed only by `entity-licensing-claim` in clause
// mode. It deliberately does NOT also yield a de-spaced pattern: squeezing
// destroys word boundaries, and the in-word false positives that causes
// ("registered" inside "preregistered", "authorized" inside "unauthorized") are
// worse than any coverage a squeezed form would add. Line-wrap coverage is
// obtained by rejoining soft-wrapped LINES instead - see rejoinSoftWraps.
//
// Deliberately ABSENT: broker, venue, connector, adapter, registry - "registered
// broker", "registered trading venue" and "approved venue" are PICC's own
// in-process broker registry and its capture-approval ceremony, not a regulator.
// Keeping them out of the ENTITY list rather than out of the TRIGGER list is what
// lets the trigger stay derived without reintroducing those false positives.
//
// `stem: true` marks a deliberate prefix: "securit" must also match
// "securities", so those entries are not end-anchored with a word boundary.
const FINANCIAL_ENTITY_PARTS = [
  { p: ["exchange"] },
  { p: ["digital", "asset"] },
  { p: ["asset", "work"] },
  { p: ["virtual", "asset"] },
  { p: ["securit"], stem: true },
  { p: ["bank"] },
  { p: ["payment", "provider"] },
  { p: ["money", "services"] },
  { p: ["financial"] },
  { p: ["custodian"] },
  { p: ["issuer"] },
  { p: ["dealer"] },
  { p: ["market", "operator"] },
  { p: ["fintech"] },
  { p: ["insur"], stem: true },
  { p: ["trust"] },
  { p: ["credit", "union"] },
  { p: ["provider"] },
  { p: ["on", "ramp"] },
  { p: ["capital", "markets"] },
  { p: ["brokerage"] },
  { p: ["firm"] },
  { p: ["platform"] }
]
const joinParts = (parts, sep) => parts.join(sep)
const FINANCIAL_ENTITY_RE = FINANCIAL_ENTITY_PARTS.map((e) =>
  e.stem ? joinParts(e.p, "[\\s-]?") : `\\b${joinParts(e.p, "[\\s-]?")}\\b`
).join("|")

// Distance window. Used ONLY in clause mode, where crossing a sentence is
// impossible by construction. Narrow on purpose: every character of slack is a
// chance to span unrelated prose.
const near = (n) => `[a-z0-9,.+'"\\s-]{0,${n}}`
// Separator gap, for the designation rules. Zero distance.
const gap = (n) => `[/,;]{0,${n}}`

const CLAIM_VOCABULARY = [
  {
    id: "explicit-sc-registration",
    mode: "squeezed",
    re: new RegExp(`sc${gap(1)}(?:${LICENCE_STEM_RE})`),
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
    re: new RegExp(`rmo(?=${gap(1)}(?:dax|${LICENCE_STEM_RE}))`),
    why: "the RMO recognised-market-operator designation, scoped by an ADJACENT licensing word. A distance window here matched 'triggerregistration' in a broker-loader comment; a separator gap does not"
  },
  {
    id: "dax-designation",
    mode: "squeezed",
    re: new RegExp(`dax(?=${gap(1)}(?:${LICENCE_STEM_RE}|securit))|(?:${LICENCE_STEM_RE})${gap(1)}dax`),
    why: "DAX as a licensing designation, in either order, scoped by an ADJACENT licensing word. That scoping is what separates it from the DAX-40 equity index, and adjacency is what stops it matching across ordinary prose"
  },
  {
    id: "entity-licensing-claim",
    mode: "clause",
    re: new RegExp(`\\b(?:${LICENCE_WORD_RE})\\b(?=[a-z0-9,.+'"\\s-]{0,30}(?:${FINANCIAL_ENTITY_RE}))`),
    why: "ANY licensing word next to ANY financial entity, both word-BOUNDARY anchored. It runs in clause mode, not squeezed mode, and that is the whole point: squeezing destroys word boundaries, so a bare trigger there matches 'registered' inside 'preregistered' and inside 'unregistered', and 'authorized' inside 'unauthorized' - the last being high-frequency in an auth-heavy codebase. A preceding-character anchor cannot fix this either, because in de-spaced text almost every licence word IS preceded by a lowercase letter, so (?<![a-z]) silences all 20 paraphrases; and a bare \\b silences a licence word glued to a preceding word. Real boundaries fix the class rather than three prefixes, and clause mode - with soft wraps RE-JOINED, so a newline is not a boundary - keeps line-wrap coverage without ever needing a squeezed twin, which would have reintroduced the in-word matches. The trigger is DERIVED from LICENCE_WORD, never hand-listed; PICC's own 'registered broker' / 'approved venue' are handled by leaving broker/venue/connector/adapter/registry out of the ENTITY list, not by narrowing the trigger"
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
    mode: "clause",
    re: new RegExp(
      `\\b(?:${REGULATOR_TOKEN})\\b${near(20)}(?:${LICENCE_WORD_RE})\\b` +
        `|(?:${LICENCE_WORD_RE})\\b${near(20)}\\b(?:${REGULATOR_TOKEN})\\b`
    ),
    why: "a standalone regulator token next to any licensing word, in EITHER order, within one clause. Clause mode is what stops the window spanning a sentence break; the 20-char budget is what stops it spanning ordinary prose inside a sentence"
  },
  {
    id: "sc-regulator-reference",
    mode: "clause",
    re: new RegExp(
      `\\bthe sc\\b${near(20)}(?:${LICENCE_WORD_RE})\\b` +
        `|(?:${LICENCE_WORD_RE})\\b${near(20)}\\bthe sc\\b`
    ),
    why: "'the SC' - the Securities Commission as a NAMED regulator, in either order against a licensing word. This exists because bare `sc` had to leave REGULATOR_TOKEN to stop \\bsc\\b reading as the US state abbreviation, and the definite article is what distinguishes the two: a state abbreviation in a comma-delimited list ('Columbia, SC,') is never preceded by 'the'. PREFIX forms ('SC-registered') stay with explicit-sc-registration, where the glue to the adjective is the signal"
  },
  {
    id: "named-regulator-spaced",
    mode: "spaced",
    re: /\bsecurities commission\b|\blabuan fsa\b/,
    why: "the regulator written out in full rather than abbreviated, so 'Securities Commission Malaysia' and 'Labuan FSA' are caught whichever form an author reaches for"
  },
  {
    id: "standalone-dax-licensing",
    mode: "clause",
    re: new RegExp(`\\bdax\\b${near(20)}(?:${LICENCE_WORD_RE})\\b|(?:${LICENCE_WORD_RE})\\b${near(20)}\\bdax\\b`),
    why: "DAX as a standalone word near a licensing word within one clause. Scoped twice over: the licensing word must be nearby, and the window may not cross a sentence - which is precisely what used to fire on 'Dax runs the desk. The desk is regulated by the FCA.'"
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
  },
  {
    file: "apps/extension-archived/src/content.tsx",
    rule: "entity-licensing-claim",
    occurrences: 1,
    reason:
      "The string is 'No connector registered for this platform.' - a runtime UI message in the ARCHIVED extension reporting whether PICC's own browser connector is present for a site. It is PICC's in-process connector registry, not a regulator, and it ships to no user of the current dashboard. It fires only because 'platform' had to stay in the entity list to catch 'a licensed P2P lending platform'. Bounded to exactly 1, so any second claim in this file is caught."
  }
]

// ---------------------------------------------------------------------------
// THE SCAN
// ---------------------------------------------------------------------------
const VOCAB_BY_ID = new Map(CLAIM_VOCABULARY.map((v) => [v.id, v]))

// Each scanned file is read ONCE. The per-(file, rule) loop below would otherwise
// re-read the same file for every rule - 815 files x 11 rules is ~9,000 reads and
// tens of megabytes of pointless I/O on a test that runs on every commit. The
// three normalisations are cached per file too, since each rule needs a
// different one.
const TEXT_CACHE = new Map()
const HAYSTACK_CACHE = new Map()

function textFor(file) {
  let t = TEXT_CACHE.get(file)
  if (t === undefined) {
    t = readFileSync(join(REPO_ROOT, file), "utf8")
    TEXT_CACHE.set(file, t)
  }
  return t
}

function haystacksFor(file, mode) {
  const key = `${mode} ${file}`
  let h = HAYSTACK_CACHE.get(key)
  if (h === undefined) {
    const text = textFor(file)
    if (mode === "squeezed") h = [squeezed(text)]
    else if (mode === "spaced") h = [spaced(text)]
    else if (mode === "clause") h = clauses(text)
    else throw new Error(`unknown vocabulary mode ${mode}`)
    HAYSTACK_CACHE.set(key, h)
  }
  return h
}

function countMatches(file, ruleId) {
  const rule = VOCAB_BY_ID.get(ruleId)
  if (!rule) throw new Error(`unknown vocabulary rule ${ruleId}`)
  const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g")
  // Counts EVERY match, in every haystack. `clause` mode yields one haystack per
  // sentence/line/bullet, so a file with three licensing sentences contributes
  // three - a clause rule counts sentences and a whole-file rule counts raw
  // occurrences. Allowlist counts are stated in these terms, so getting this
  // wrong would silently invalidate every one of them.
  let n = 0
  for (const hay of haystacksFor(file, rule.mode)) {
    const local = new RegExp(re.source, re.flags)
    let m
    while ((m = local.exec(hay)) !== null) {
      n++
      if (!m[0].length) local.lastIndex++
    }
  }
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

// The corrections made by T5a and its fix rounds. Asserted individually so a
// record cannot be silently emptied while the directory stays non-empty, and so
// 0001's superseded note table stays anchored by 0006.
const D26_RULE_IDS = [
  "VENDOR_REGULATORY_STATUS",
  "VENUE_KYC_TERMS",
  "STAKING_JURISDICTION_STATUS",
  "RUNBOOK_LICENSING_ASSERTION",
  "RUNBOOK_DESIGNATION_CLAIM",
  "VENUE_STATUS_DISCLAIMER_CONSISTENCY"
]

// Which vocabulary rules fire on a bare string. Used by the probe tests below so
// a phrasing can be asserted without inventing a file for it.
function probe(text) {
  return CLAIM_VOCABULARY.filter((rule) =>
    haystacksForText(text, rule.mode).some((hay) => new RegExp(rule.re.source, rule.re.flags).test(hay))
  ).map((rule) => rule.id)
}

function haystacksForText(text, mode) {
  if (mode === "squeezed") return [squeezed(text)]
  if (mode === "spaced") return [spaced(text)]
  if (mode === "clause") return clauses(text)
  throw new Error(`unknown vocabulary mode ${mode}`)
}

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
      expect(["squeezed", "spaced", "clause"], `${rule.id} must declare its normalisation`).toContain(rule.mode)
    }
    const ids = CLAIM_VOCABULARY.map((r) => r.id)
    expect(new Set(ids).size, "vocabulary rule ids must be unique").toBe(ids.length)
  })

  it("derives its trigger from LICENCE_WORD rather than hand-listing a subset", () => {
    // The previous defect, pinned structurally so it cannot recur. The rule's
    // trigger had drifted to four words while LICENCE_WORD carried thirteen, so
    // every paraphrase built on an unlisted word walked past a green guard.
    const entityRule = CLAIM_VOCABULARY.find((r) => r.id === "entity-licensing-claim")
    for (const word of LICENCE_WORD) {
      expect(
        probe(`${word} digital asset exchange`),
        `entity-licensing-claim must fire on the LICENCE_WORD member "${word}"`
      ).toContain("entity-licensing-claim")
    }
    // And the reverse direction of the guard on drift: a word that is NOT a
    // licensing term must not be treated as one.
    expect(
      probe("thermometer digital asset exchange"),
      "a non-licensing word must not trigger the entity rule"
    ).not.toContain("entity-licensing-claim")
    // The rule must consume the shared array, not a copy of it.
    expect(
      entityRule.why,
      "the entity rule must document that its trigger is derived"
    ).toMatch(/DERIVED from LICENCE_WORD/i)
  })

  it("catches paraphrases of the class the old five-string vocabulary could not see", () => {
    // 20 natural paraphrases. The first block is the set the reviewer measured
    // as escaping the pre-fix guard.
    for (const text of [
      "Luno is a recognised digital asset exchange.",
      "Hata is an accredited exchange.",
      "Luno is a regulated digital currency exchange.",
      "Funding Societies is a registered financial institution.",
      "Luno is a licensed money services business.",
      "Luno is a registered digital asset exchange in Malaysia.",
      "Hata holds a licence from the Labuan FSA.",
      "The platform is an approved SC-recognised venue.",
      "This provider is RMO approved since 2019.",
      "Hata is a DAX registered with the SC.",
      "MX Global is regulated by the SC.",
      "Hata is SC-regulated and the lead rail.",
      "KYC is not required to use this venue.",
      "Hata is a licensed digital currency exchange.",
      "Luno is a recognised market operator.",
      "Luno is a supervised virtual-asset service provider.",
      "Luno is a chartered capital markets firm.",
      "Funding Societies is a licensed P2P lending platform.",
      "Hata is a regulated trust company.",
      "Luno is an authorised electronic money issuer."
    ]) {
      expect(probe(text), `class-level catch must fire on: ${text}`).not.toEqual([])
    }
  })

  it("does not fire on an honest disclaimer of the very thing it hunts", () => {
    // A guard for unverifiable claims must not punish the verified form. Saying
    // PICC has NOT checked something is the honest sentence; flagging it would
    // push authors toward deleting the disclaimer.
    for (const text of [
      "PICC has not verified the DAX status of this venue.",
      "Regulatory status is unverified for every venue listed here."
    ]) {
      expect(probe(text), `an explicit disclaimer must not be flagged: ${text}`).toEqual([])
    }
  })

  it("does not fire on the same words used in a non-licensing sense", () => {
    for (const text of [
      "feeds are read through the MIT-licensed ccxt library",
      "adopt permissively-licensed code freely",
      "upload once, earn licensing fees",
      "KYC mandatory for this capture path",
      "the payment provider has a system-side KYC queue"
    ]) {
      expect(probe(text), `must not fire on legitimate text: ${text}`).toEqual([])
    }
  })

  it("does not let the proximity window cross a SENTENCE boundary", () => {
    // The reviewer's three cases. Each pairs a DAX/regulator token in one
    // sentence with a licensing word in ANOTHER, which is the shape a
    // whitespace-inclusive window over collapsed newlines used to match.
    for (const text of [
      "Dax runs the desk. The desk is regulated by the FCA.",
      "see the DAX methodology section for the licensed-venue policy",
      "Based in Columbia, SC, the team ships every weekday."
    ]) {
      expect(probe(text), `a window crossing a sentence boundary must not fire on: ${text}`).toEqual([])
    }
    // Same shape across a LINE break - but note WHAT makes it a boundary here.
    // Soft-wrapped lines are now rejoined, so a newline is not a boundary in
    // general; this one is a boundary because the first line ends a SENTENCE.
    // "Dax" is on one line, a licensing word on the next, no pairing in either.
    expect(
      probe("Dax runs the desk.\nWe renewed the licence."),
      "a window crossing a line boundary must not fire"
    ).toEqual([])
    // But squeezed mode must still catch a claim WRAPPED across lines - that is
    // the entire reason squeezed mode removes newlines and hyphens at all. If
    // this stopped firing, the fix would have gutted the rule instead of scoping
    // it.
    expect(
      probe("This provider is SC-\nregulated."),
      "a claim wrapped across a line break must still fire"
    ).not.toEqual([])
    // And the same words in ONE sentence must still fire, for the same reason.
    expect(
      probe("MX Global is a registered exchange."),
      "a genuine in-sentence claim must still fire"
    ).not.toEqual([])
  })

  it("catches a claim wrapped across a line break, and still silences in-word matches", () => {
    // These two halves are in ONE test on purpose. The obvious fix for a
    // line-wrap miss is a squeezed-mode twin of the entity rule, and squeezing
    // is exactly what produces the in-word matches below. Split into two tests,
    // a future change could win one by sacrificing the other; together, neither
    // property can be given up.
    //
    // The first two are regressions: both FIRED under the pre-line-wrap-fix
    // guard, in squeezed mode, and walked past once the rule moved to clause
    // mode without soft-wrapped lines being rejoined.
    for (const text of [
      "MX Global is a registered\ndigital asset exchange.",
      "MX Global is a registered digital\nasset exchange.",
      "MX Global is an accredited\nmoney services business.",
      "Hata is a licensed\nvirtual-asset service provider.",
      "Luno is a regulated\ntrust company.",
      "Funding Societies is a registered\nfinancial institution.",
      // A three-line wrap, and a hyphenation break, and the exact case the file
      // header cites as the reason squeezed mode exists.
      "MX Global is a\nregistered\ndigital asset exchange.",
      "Hata is a licensed digital-\nasset exchange.",
      "MX Global is SC-\nregistered as an exchange."
    ]) {
      expect(probe(text), `a line-wrapped claim must still fire on: ${JSON.stringify(text)}`).not.toEqual([])
    }
    // And the property that must not be traded away to get the above.
    for (const text of [
      "Read the preregistered provider list before connecting.",
      "The UI shows an unregistered platform state.",
      "Respond 401 unauthorized to the payment provider.",
      "The report shows a disapproval rate by provider.",
      "The domain requires deregistration before the provider cutover.",
      // Added with the singular `licence`: the boundary must survive the new
      // word, so a negated "unlicensed" is still silent even with a nearby
      // entity noun.
      "The desk is unlicensed and the counterparty is a financial\nprovider."
    ]) {
      expect(probe(text), `a licence word inside a longer word must not fire on: ${JSON.stringify(text)}`).toEqual([])
    }
  })

  it("does not join a line that ends a record to unrelated adjacent data", () => {
    // The cost of closing the line-wrap hole, pinned. Soft wraps are rejoined
    // ONLY when the previous line ends on a bare word; structured data ends each
    // record on a delimiter, and joining those would read two adjacent KEYS as a
    // claim. Without this, the rejoining is a licence to fire on honest config.
    for (const text of [
      '  licensed: false,\n  platform: "binance",',
      "  approved: true,\n  platform: binance",
      "  licensed: false,\n  firm: acme",
      "  registered: true,\n  trust: acme",
      // A bullet marker is a block start, so a wrapped line can never absorb the
      // NEXT list item. Without this, the rejoining could merge two benign bullets
      // into one claim.
      "- platform fees apply\n- licensed: false"
    ]) {
      expect(probe(text), `a record boundary must stay a boundary on: ${JSON.stringify(text)}`).toEqual([])
    }
  })

  it("does not match a licence word INSIDE a longer word", () => {
    // The derived trigger has no anchor, and squeezing destroys word boundaries,
    // so 'registered' was matching inside 'preregistered' and inside
    // 'unregistered', and 'authorized' inside 'unauthorized'. 'unauthorized' is
    // the sharp one: it is high-frequency in an auth-heavy codebase and
    // 'provider' is an entity noun, so any future auth code near one would fail
    // this guard. `unauthorized` occurs in 4 tracked files today.
    for (const text of [
      "Read the preregistered provider list before connecting.",
      "The UI shows an unregistered platform state.",
      "Respond 401 unauthorized to the payment provider.",
      "The report shows a disapproval rate by provider.",
      "The domain requires deregistration before the provider cutover."
    ]) {
      expect(probe(text), `a licence word inside a longer word must not fire on: ${text}`).toEqual([])
    }
  })

  it("does not read the US state abbreviation as the Securities Commission", () => {
    // The earlier probe for this could not fail: it contained no licensing word
    // and was already silent under the old guard, so it tested nothing about the
    // window. This one carries a licensing word, and it DID fire under both the
    // old and the fix-1 guard. Funding Societies is a US entity this repo's own
    // runbook routes to, so ordinary US-company prose is the common case.
    for (const text of [
      "Based in Columbia, SC, the entity is registered in Delaware.",
      "Based in Columbia, SC, the team ships every weekday."
    ]) {
      expect(probe(text), `the state abbreviation must not fire on: ${text}`).toEqual([])
    }
    // And the fix must not have been "stop matching SC". Both the named and the
    // glued forms must still fire.
    for (const text of [
      "MX Global is regulated by the SC.",
      "Hata is a DAX registered with the SC.",
      "This provider is SC-regulated.",
      "The platform is an approved SC-recognised venue."
    ]) {
      expect(probe(text), `a real SC reference must still fire on: ${text}`).not.toEqual([])
    }
  })

  it("still fires on a licence word adjacent to real word boundaries", () => {
    // The anti-regression half of the boundary fix: anchoring must not silence
    // genuine claims, including one glued to a preceding word by a hyphen.
    for (const text of [
      "MX Global is a registered exchange.",
      "We re-registered the venue and it is now an approved exchange.",
      "Luno is an authorised electronic money issuer.",
      // The singular noun, added to LICENCE_WORD this round. "holds a licence
      // from the SC" is the same claim as "licensed" with a different part of
      // speech, and it is the shape an author reaches for when writing about a
      // licence rather than a venue. Both spellings, because neither subsumes
      // the other. These exercise sc-regulator-reference, the rule the gap was
      // found in; the entity rule consumes the same singulars.
      "The exchange holds a licence from the SC.",
      "The venue holds a license from the SC.",
      "MX Global holds a licence as a digital asset exchange."
    ]) {
      expect(probe(text), `a real claim must still fire on: ${text}`).not.toEqual([])
    }
  })

  it("does not let a sentence boundary become the new line-wrap hole", () => {
    // rejoinSoftWraps must not have replaced one evasion with another. A SENTENCE
    // end is still a boundary - the round-1 fix - while a soft wrap no longer is.
    for (const text of [
      "The operator is registered. Financial markets are discussed here.",
      "The desk was registered. Platform fees apply."
    ]) {
      expect(probe(text), `a sentence boundary must stay a boundary on: ${text}`).toEqual([])
    }
  })

  it("handles PICC's own in-process registry by allowlist, not by silence", () => {
    // "no connector registered for this platform" DOES fire on the sentence,
    // because 'platform' has to stay in the entity list to catch "a licensed P2P
    // lending platform". It is handled by a reasoned allowlist entry on the one
    // live file rather than by weakening the rule, and that is the intended
    // workflow: a false positive gets a written reason, not a blind exemption.
    expect(probe("no connector registered for this platform")).toContain("entity-licensing-claim")
    const entry = ALLOWLIST.find((a) => a.file === "apps/extension-archived/src/content.tsx")
    expect(entry, "the archived-extension UI string must be allowlisted with a reason").toBeDefined()
    expect(entry.reason.trim().length).toBeGreaterThan(60)
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
  it("sweeps the whole corpus and accounts for every single hit", () => {
    // The complete inventory, not just the verdict. This is the full-corpus
    // sweep: every (file, rule, count) that the widened vocabulary produces must
    // be matched by a reasoned allowlist entry, and the inventory itself is
    // printed into the failure message so a reviewer can check each line rather
    // than trusting a boolean. Asserting the inventory is NON-EMPTY stops this
    // from passing vacuously if the scan silently stops matching anything.
    const inventory = []
    for (const file of SCANNABLE) {
      if (isDocExcluded(file) || file === SELF) continue
      for (const rule of CLAIM_VOCABULARY) {
        const occurrences = countMatches(file, rule.id)
        if (occurrences === 0) continue
        const permitted = ALLOWLIST.find((a) => a.file === file && a.rule === rule.id)
        inventory.push(
          `${permitted && permitted.occurrences === occurrences ? "allowlisted" : "VIOLATION"}` +
            `  ${file}  ${occurrences}x  [${rule.id}]`
        )
      }
    }
    const violations = inventory.filter((line) => line.startsWith("VIOLATION"))
    expect(
      violations,
      `full-corpus sweep of ${SCANNABLE.length} tracked files found unaccounted hits:\n${inventory.join("\n")}`
    ).toEqual([])
    expect(
      inventory.length,
      "the sweep inventory must not be empty - an empty inventory means the scan stopped matching anything"
    ).toBeGreaterThan(0)
    // And the scan must not be trivially blind: the whole allowlist should be
    // reachable, so a vocabulary change that stops matching an allowlisted file
    // surfaces as a stale-entry failure rather than as a quietly smaller sweep.
    expect(inventory.filter((l) => l.startsWith("allowlisted")).length).toBeGreaterThanOrEqual(ALLOWLIST.length)
  })

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

  it("keeps a record for each of the six D26 corrections", () => {
    const corpus = entryFiles.map((n) => readFileSync(join(ENTRIES_DIR, n), "utf8")).join("\n")
    const missing = D26_RULE_IDS.filter((id) => !corpus.includes(`rule: ${id}`))
    expect(missing, "each D26 claim class must keep its supersession record").toEqual([])
  })

  // A RECORD THAT RENDERS HALF ITSELF IS NOT A RECORD. This block exists because
  // it should not have to. Record 0009's `README.md feature 5` row was, for one
  // commit, glued onto the preceding row with `||`, so the table's header declared
  // three columns and GFM truncated the merged row to three cells - which meant the
  // cell recording the retraction of a shipped-artifact claim was present in the
  // source and ABSENT from the rendered document. Every other D20 check passed on
  // that file, because all seven schema fields were intact: the damage was to
  // something none of them looked at. A guard that validates a record's FIELDS
  // while its TABLE silently drops a row reads as coverage and verifies less than
  // it appears to, which is the same defect class this project treats as a finding
  // - so the shape is asserted, not assumed.
  //
  // THE RULE, precisely: within one table, the header row, the `|---|` separator
  // and every data row must agree on the count of UNESCAPED pipes. `\|` is literal
  // cell content, not a delimiter, so it must NOT be counted. Several records
  // quote a table row out of PICC.md or README.md verbatim and those quotes carry
  // escaped pipes; counting raw characters is what makes a correct row look wrong
  // and, worse, makes the "fix" for that a de-quoting of the evidence.
  //
  // NO EXEMPTION IS NEEDED, and that is a survey result rather than an assumption:
  // every table in all nine records is currently uniform, the widest being 0001's
  // three-column and 0006's two-column. So a varying count means a malformed table,
  // not a legal one. If a future record genuinely needs ragged rows it must fix
  // the table or add a reasoned exemption HERE, with a reason - the same rule this
  // file already applies to the D26 ALLOWLIST and for the same reason: a guard
  // that fails on honest text gets weakened by whoever next touches it.
  const unescapedPipes = (line) => {
    let n = 0
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "|" && line[i - 1] !== "\\") n++
    }
    return n
  }
  const TABLE_ROW = /^\s*\|/
  const TABLE_SEP = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/

  function tableShapeProblems(name, text) {
    const problems = []
    const lines = text.split("\n")
    let inFence = false
    for (let i = 0; i < lines.length; i++) {
      // A pipe table inside a fenced code block is sample text, not a table.
      if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue }
      if (inFence) continue
      // A table is a header row IMMEDIATELY followed by a separator. Requiring the
      // separator is what stops a stray pipe-leading line from being read as a
      // one-row table and failing for the wrong reason - a false positive in a
      // truth guard is worse than no guard, because the cheapest response to one is
      // to delete the sentence that provoked it.
      if (!TABLE_ROW.test(lines[i])) continue
      if (!TABLE_SEP.test(lines[i + 1] ?? "")) continue
      const expected = unescapedPipes(lines[i])
      const sepCount = unescapedPipes(lines[i + 1])
      if (sepCount !== expected) {
        problems.push(
          `${name}:${i + 2} separator has ${sepCount} unescaped pipes, header on line ${i + 1} has ${expected}`
        )
      }
      for (let j = i + 2; j < lines.length && TABLE_ROW.test(lines[j]); j++) {
        const got = unescapedPipes(lines[j])
        if (got !== expected) {
          problems.push(
            `${name}:${j + 1} has ${got} unescaped pipes, header on line ${i + 1} has ${expected}`
          )
        }
      }
    }
    return problems
  }

  it("counts unescaped pipes only, and sees a glued row", () => {
    // The counter is pinned before it is trusted, because its failure mode is
    // silent in the dangerous direction. If it started counting `\|` as a
    // delimiter, every record that quotes a table row out of PICC.md would fail,
    // and the cheapest way to make that green is to delete the quoted evidence -
    // which is precisely backwards. Each expectation below is hand-counted.
    expect(unescapedPipes("| a | b |"), "two columns -> three unescaped pipes").toBe(3)
    expect(unescapedPipes("| a \\| b |"), "an escaped pipe is one cell's content, not a delimiter").toBe(2)
    expect(unescapedPipes("| a | b |"), "identical to the first line; a control").toBe(3)
    // Two three-column rows glued with `||`: 8 unescaped pipes where a single
    // three-column row has 4. This is exactly the 0009 defect.
    expect(unescapedPipes("| a | b | c || d | e | f |"), "two rows glued, eight unescaped pipes").toBe(8)
    expect(unescapedPipes("| a | b | c |"), "one three-column row for contrast: 4").toBe(4)
  })

  it("keeps every record's GFM tables the shape their header declares", () => {
    const problems = []
    for (const name of entryFiles) {
      problems.push(...tableShapeProblems(name, readFileSync(join(ENTRIES_DIR, name), "utf8")))
    }
    expect(
      problems,
      "a row whose unescaped-pipe count differs from its table's header is TRUNCATED by GFM: the extra cells are dropped from the rendered document, so the record silently stops saying what it says in the source. Split the row onto its own line."
    ).toEqual([])

    // The scan must not be vacuous. A rename, an empty directory or a regex that
    // stopped matching would all make the assertion above pass while checking
    // nothing, which is the failure this file's first describe block exists to
    // rule out. So the tables are proved to be REACHED, not merely absent.
    //
    // 9 of the 15 records currently contain a table (0001, 0005-0011, 0015; the
    // other six - 0002, 0003, 0004, 0012, 0013, 0014 - are prose). The floor is
    // 8 rather than the exact 9 so that ADDING a table to a record cannot fail
    // this, while removing tables from two or more records does.
    const withTables = entryFiles.filter((n) =>
      /^\s*\|/m.test(readFileSync(join(ENTRIES_DIR, n), "utf8"))
    )
    expect(
      withTables.length,
      "the table scan must reach the records that actually contain tables"
    ).toBeGreaterThanOrEqual(8)
    let rowsChecked = 0
    for (const name of entryFiles) {
      rowsChecked += (readFileSync(join(ENTRIES_DIR, name), "utf8").match(/^\s*\|/gm) ?? []).length
    }
    // 97 pipe-leading rows today. A floor of 60 catches a regex that stopped
    // matching without breaking when a record gains a table.
    expect(rowsChecked, "the scan must be counting real rows, not zero of them").toBeGreaterThan(60)
  })
})
