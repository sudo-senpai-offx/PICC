import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import ts from "typescript"

const require_ = createRequire(fileURLToPath(import.meta.url))

const BASELINE = "d400c70"
const TEST_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(TEST_PATH), "../../../..")
const TRADING_SUITE = resolve(ROOT, "apps/dashboard/src/components/TradingSuite.tsx")
const AUTOPILOT_SUITE = resolve(ROOT, "apps/dashboard/src/components/AutopilotSuite.tsx")
const AUTOPILOT_ROOM = resolve(ROOT, "apps/dashboard/src/pages/ministry/AutopilotRoom.tsx")

const readSource = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
const normalize = (value) => value.replaceAll("\\", "/")
const relativeToRoot = (value) => normalize(relative(ROOT, value))

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })

const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")

const importSpecifiers = (code) => {
  const out = []
  const re = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|import\(\s*|export\s+[\s\S]*?\s+from\s+)["']([^"']+)["']/g
  let match
  while ((match = re.exec(code)) !== null) out.push(match[1])
  return out
}

const walkCodeFiles = (dir) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "coverage", ".playwright-tmp"].includes(entry.name)) continue
    const abs = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkCodeFiles(abs))
    else if (/\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(entry.name)) out.push(abs)
  }
  return out
}

const isExcludedTest = (rel) => rel.includes("/__tests__/") || /\.(?:test|spec)\.[^.]+$/.test(rel.split("/").pop() ?? "")

const codeFilesForScope = () =>
  walkCodeFiles(resolve(ROOT, "apps/dashboard"))
    .map((abs) => ({ abs, rel: relativeToRoot(abs), code: readFileSync(abs, "utf8") }))
    .filter(({ rel }) => isExcludedTest(rel) ? rel.startsWith("apps/dashboard/e2e/") : true)

const tokenHits = (files, pattern) =>
  files.flatMap(({ rel, code }) => (stripComments(code).match(pattern) ?? []).map((token) => ({ rel, token })))

const DENY_CORPUS = [
  {
    rel: "../services/commandCentre/perpsGates.mjs",
    text: "`invalid-environment: PICC_CCXT_LEVERAGE_MIN=${minEnv.value}; PICC_CCXT_LEVERAGE_MAX=${maxEnv.value} — min > max`"
  },
  {
    rel: "../services/commandCentre/perpsExecution.mjs",
    text: "`invalid-environment: PICC_CCXT_MARGIN_PER_POSITION_CAP_USD=${rawCap}`"
  },
  {
    rel: "../services/venues/hyperliquidPerps.mjs",
    text: "\"perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)\""
  },
  {
    rel: "../services/venues/hyperliquidPerps.mjs",
    text: "\"perps-rail-off: WS-1 is testnet-only — sandbox mode was not requested (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1); PICC_CCXT_PERPS_MAINNET_ENABLED alone is insufficient until the WS-3 ceremony\""
  },
  {
    rel: "../__tests__/ceremonyVenueUnlock.test.mjs",
    text: "\"perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)\""
  },
  {
    rel: "../services/ccxtOrdering.mjs",
    text: "`ccxt ordering seam: no ${envKey(id)} credentials configured — set either PICC_CCXT_APIKEY_${envKey(id)} + PICC_CCXT_SECRET_${envKey(id)} (CEX-style) or PICC_CCXT_WALLETADDRESS_${envKey(id)} + PICC_CCXT_PRIVATEKEY_${envKey(id)} (Hyperliquid-style) — the execution leg is inoperable without them`"
  }
]

const LEADER_CORPUS = [
  ["../handlers.mjs", "\"leader:deny:payload-too-large\""],
  ["../handlers.mjs", "\"leader:deny:empty-payload\""],
  ["../handlers.mjs", "\"leader:deny:unparsable-feed\""],
  ["../handlers.mjs", "\"leader:deny:unsupported-payload\""],
  ["../handlers.mjs", "\"leader:deny:platform-adversarial\""],
  ["../handlers.mjs", "\"leader:deny:store-unhealthy\""],
  ["../handlers.mjs", "\"leader:deny:missing-leader-id\""],
  ["../handlers.mjs", "\"leader:deny:invalid-trust-value\""],
  ["../handlers.mjs", "\"leader:deny:trust-evidence-required\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "storeUnhealthy: \"leader:deny:store-unhealthy\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "unknownLeader: \"leader:deny:unknown-leader\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "notQualified: \"leader:deny:not-qualified\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "missingId: \"leader:deny:import-missing-id\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "invalidTrustValue: \"leader:deny:invalid-trust-value\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "trustEvidenceRequired: \"leader:deny:trust-evidence-required\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:malformed-feed\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:empty-feed\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:costs-unaccounted\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:unknown-asset\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:malformed-row\""],
  ["../services/copytrade/leaderFeedContract.mjs", "\"leader:deny:hip-not-wired — endpoint contract unverified\""],
  ["../services/copytrade/leaderQualification.mjs", "`leader:deny:trades-short (have ${trades}, require ${LEADER_MIN_TRADES})`"],
  ["../services/copytrade/leaderQualification.mjs", "`leader:deny:mdd-over (have ${mdd}%, require <${LEADER_MAX_MDD_PCT})`"],
  ["../services/copytrade/leaderQualification.mjs", "`leader:deny:expectancy-nonpositive (have ${expectancy})`"],
  ["../services/copytrade/leaderGuard.mjs", "`leader:deny:invalid-environment (PICC_LEADER_AUTO_UNFOLLOW_DAYS=${env.raw})`"],
  ["../services/copytrade/leaderGuard.mjs", "\"leader:auto-unfollow:no-positions-21d\""],
  ["../services/copytrade/leaderGuard.mjs", "`leader:deny:invalid-environment (PICC_LEADER_7D_STOP_PCT=${env.raw})`"],
  ["../services/copytrade/leaderGuard.mjs", "\"leader:deny:equity-unavailable\""],
  ["../services/copytrade/leaderGuard.mjs", "\"leader:idea-suppressed:7d-stop\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "`leader:import:${id}`"],
  ["../services/commandCentre/leaderIdeasState.mjs", "`leader:follow:${id}`"],
  ["../services/commandCentre/leaderIdeasState.mjs", "`leader:trust:${id}`"]
]

const CEREMONY_CORPUS = [
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:not-decided\""],
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:sim-row\""],
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:untagged-provenance\""],
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:untagged-class\""],
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:ceremony-action-unreachable (no ceremony-action route is wired in production — the gate/route modules own the unlock check)\""],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:gate1-short (have ${have}, require ${env.value})`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:flip-unmet (${flip.reason})`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:streak-short (have ${window.length} rows, require ${needed})`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:streak-winprob-missing (window row ${seq} has null winProb)`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:streak-out-of-band (ratio ${shown}, band [${loEnv.value}, ${hiEnv.value}])`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:days-short (have ${days} trading days, require ${env.value})`"],
  ["../services/commandCentre/ceremonyGates.mjs", "\"ceremony:deny:platform-unverified\""],
  ["../services/commandCentre/ceremonyGates.mjs", "\"ceremony:deny:payout-below-floor\""],
  ["../services/commandCentre/ceremonyGates.mjs", "\"ceremony:deny:store-unhealthy\""],
  ["../services/commandCentre/ceremonyGates.mjs", "\"ceremony:deny:ledger-stale\""]
]

const EXPORT_SURFACE = [
  "MarketsSuite",
  "AutopilotSuite",
  "SignalNotificationsCard",
  "StatusCards",
  "PredictionCard",
  "ProAnalysisCard",
  "PaperTradingCard",
  "TradePlannerCard",
  "WatchlistScannerCard",
  "NewsCard",
  "PaperAnalyticsCard",
  "SignalsCard"
]

const VENUE_PATHS = new Set([
  "apps/dashboard/server/services/captureProfiles.mjs",
  "apps/dashboard/server/services/expertoption.mjs",
  "apps/dashboard/server/services/liveEO.mjs",
  "apps/dashboard/server/services/ccxtOrdering.mjs",
  "apps/dashboard/server/services/commandCentre/policyGraphCatalog.mjs",
  "apps/dashboard/server/services/venues/venueAdapterContract.mjs"
])

const isVenuePath = (path) => path.startsWith("apps/dashboard/server/services/venues/") || VENUE_PATHS.has(path)

// WS-7 T3 opened exactly one hole in the AC-7a venue freeze, and it is recorded
// here rather than removed, so the exception stays auditable and narrow.
//
// The freeze asserted by AC-7a is a WS-5 scope discipline. WS-7 decision D22
// ("Add the missing perps cancel member without weakening read-only guards")
// explicitly authorizes one additive change to a venue file, because the
// perps rail could open a position it could not exit.
//
// This allowance grants that ONE file and nothing else. It does not disable the
// freeze for the venue surface, and it does not relax any read-only guard: the
// "cancelOrder" entry in ccxtConnector's READ_ONLY_BLOCKED list is untouched
// and stays pinned by perpsSeamGuard, which is what keeps the non-seam blocklist
// from eroding. Any OTHER venue edit still fails AC-7a exactly as before.
//
// WS-7 T2 amends the SEMANTICS of the freeze, not merely its value.
//
// WHY. AC-7a freezes venue CAPABILITY. WS-7 T2 removes a venue outright, and a
// removal is the opposite of a capability addition: the surface loses a
// transport, a registry row, and a set of exports. Requiring the owner to
// enumerate a "permission to delete" would encode the wrong direction into the
// guard, and — worse — the obvious workaround is to pin every touched file
// into the authorisation set, which permanently grants WRITE access to the
// capture registry and quietly erodes the very freeze this workstream exists
// to preserve. The owner rejected that (option 2) and authorised amending the
// semantics instead (option 3).
//
// RULE 1 — DELETED PATHS ARE EXEMPT, BY EXISTENCE. A frozen path that no longer
// exists is not a freeze violation. Its presence in the authorisation set
// would grant permission to edit a file that is gone, so the two files T2
// deleted (`services/expertoption.mjs`, `services/liveEO.mjs`) are handled
// here rather than by widening the set. Existence is checked on disk, so
// re-creating either file immediately re-freezes it.
//
// RULE 2 — SURVIVING PATHS MUST NOT GAIN CAPABILITY. A surviving frozen path
// may be edited only if the change is SUBTRACTIVE: its capability surface must
// not grow. The surface is the union of three signals, each compared against
// the file's BASELINE content with comments stripped:
//   ids     — registry row identifiers (`id: "..."`): a new row is a new venue;
//   exports — exported bindings: a new export is a new callable capability;
//   imports — module specifiers: a new dependency is a new capability source.
// ALL THREE must not grow. ANY growth is a violation. There is no partial
// credit, no proportionality, and no "the growth looks harmless".
//
// WHAT RULE 2 NOW COVERS — read this before trusting it. It is a REMOVAL-ONLY
// check, not a semantic-equivalence proof, and it is deliberately narrow:
//   - It requires the live code to be the baseline code with TOKENS DELETED.
//     Adding a token, substituting one, or reordering is rejected. That closes
//     the body-edit hole the previous version documented and waved through:
//     rewriting the logic inside an already-exported function is no longer
//     classified as subtractive.
//   - It does NOT detect a renamed venue id that reuses an existing id string,
//     nor a venue reachable through a computed/aliased specifier.
//   - It DOES treat comment-only and reformat-only edits as subtractive, which
//     is correct: prose is not capability and layout is not capability.
//
// It fails CLOSED: an unreadable/absent baseline for a SURVIVING path, an
// unreadable live file, a grown capability signal, or a token that the baseline
// never contained is each treated as a violation rather than waved through.
// When in doubt this guard freezes, and a human unblocks it.
//
// RULE 1 IS HANDLED BY `isUnauthorizedVenueChange` BELOW, NOT BY THIS SET. The
// deleted venue files are absent from this set on purpose. Listing a file that
// does not exist would grant write permission to a path with nothing to write,
// and - worse - it would grant that permission FOREVER: if the file were ever
// re-created, the set lookup would still match and the re-created file would be
// authorised rather than re-frozen, which is the exact opposite of "re-creating
// it immediately re-freezes it". Existence, checked on disk at decision time,
// is the only thing that can express that. So each set below is an exact list of
// the files ONE named decision authorised, and nothing from any other decision.
const WS7_T3_AUTHORIZED_VENUE_PATHS = new Set([
  "apps/dashboard/server/services/venues/hyperliquidPerps.mjs"
])

// ---------------------------------------------------------------------------
// WS-7 T17 AMENDMENT - 2026-10-02 - the AC-7a exception set widens by FOUR.
// ---------------------------------------------------------------------------
//
// THE CONTRADICTION. The WS-5 freeze this file enforces forbids precisely what
// WS-7 T17 mandates. T17's Files clause (spec :1348) says
// `apps/dashboard/server/services/ccxtOrdering.mjs` is to be EXTENDED, do not
// replace - and `ccxtOrdering.mjs` is a member of VENUE_PATHS above, so the
// freeze treats any change to it as a venue-surface capability change unless it
// is subtractive. An extension is additive by construction, so T17 could not be
// implemented at all while this freeze stood.
//
// WHY THE LATER DECISION GOVERNS. T17 is a dated, explicit, task-level
// instruction from the owner; the AC-7a venue freeze predates it and is a
// WS-5 scope discipline, not a safety invariant about what an order lifecycle
// may contain. Where the two conflict, the later explicit instruction governs -
// but it governs only because it is WRITTEN DOWN. That is the whole reason for
// this block: an unwritten widening would be indistinguishable from the
// accidental erosion this guard exists to prevent, so the widening is dated,
// enumerated, and reasoned here instead of being smuggled into the predicate.
//
// SCOPE - FOUR NAMED FILES, NO WILDCARD, NO DIRECTORY. Nothing else in the venue
// surface is authorised. There is deliberately no prefix match, no glob, and no
// directory entry: authorisation is exact `Set.has` equality, so a venue file
// that no decision named is not authorised by anything, and a new file dropped
// into `services/venues/` is frozen the moment it appears. Two of T17's four
// Files-clause items are prose rather than paths, so the resolution is recorded
// rather than left implicit:
//
//   spec :1348 "ccxtOrdering.mjs (extend, do not replace)"
//     -> apps/dashboard/server/services/ccxtOrdering.mjs
//        Named literally. Also VENUE_PATHS' one non-venues/ member, so it is the
//        exact file the pre-amendment width pins forbade authorising.
//   spec :1346 Scope "the full lifecycle", :1348 "new per-venue adapter
//     configuration" (the four-venue registry D9:166-173 fixes at exactly four)
//     -> apps/dashboard/server/services/venues/ccxtVenues.mjs
//   spec :1348 "the ceremony/consent/risk integration points" - the three rails
//     :1350 requires honoured on EVERY leg
//     -> apps/dashboard/server/services/venues/ccxtLifecycleRails.mjs
//   spec :1346 Scope "the full lifecycle, four venues"
//     -> apps/dashboard/server/services/venues/ccxtVenueLifecycle.mjs
//
// The two `ccxtVenues` / `ccxtVenueLifecycle` mappings are the amendment's
// judgement, not the spec's words: the spec describes the work rather than
// naming the files, so a reviewer who disagrees with either mapping should read
// the reasoning above and say so. No path outside these four is authorised,
// which is what makes a wrong mapping correctable without widening anything.
//
// RESIDUAL COVERAGE - WHAT STILL GUARDS ccxtOrdering.mjs. This guard no longer
// capability-subtracts that file: it is no longer in `stillFrozen` below, and
// nothing here rejects an addition to it. That loss is real and is stated
// rather than papered over. What still covers it:
//   - `perpsSeamGuard.test.mjs:36,107-114` pins ccxtConnector's
//     READ_ONLY_BLOCKED tokens, and `ws7SeamGuard.test.mjs:371,392` pins that
//     `cancelOrder` is STILL in that blocklist. The read-only surface the
//     lifecycle must not cross is asserted in two places, not one.
//   - `executionAbsenceScope.test.mjs` discovers order-capable modules and
//     fails the build on an unreviewed one, so gaining an order capability is
//     still caught at a different seam.
//   - The two frozen venue paths T17 did NOT name keep every tooth below,
//     including the additive-plant and body-edit plants.
//   - FORTHCOMING, not yet existing: the T17 rails matrix
//     (`ccxtVenueLifecycle.rails.test.mjs`, a follow-on task's deliverable) is
//     what pins the ceremony gate, the consent payload lock, and the risk rails
//     on every leg. It is cited as forthcoming deliberately: counting it as
//     existing coverage today would be a false claim about this repo's state.
const WS7_T17_AUTHORIZED_VENUE_PATHS = new Set([
  "apps/dashboard/server/services/ccxtOrdering.mjs",
  "apps/dashboard/server/services/venues/ccxtVenues.mjs",
  "apps/dashboard/server/services/venues/ccxtVenueLifecycle.mjs",
  "apps/dashboard/server/services/venues/ccxtLifecycleRails.mjs"
])

// The UNION is what the predicate consults, and it is a union of two named
// decisions' sets rather than one hand-maintained list, so "which decision
// authorised this file" stays answerable by reading the two sets above.
const WS7_AUTHORIZED_VENUE_PATHS = new Set([...WS7_T3_AUTHORIZED_VENUE_PATHS, ...WS7_T17_AUTHORIZED_VENUE_PATHS])

// A venue path is authorised when it is explicitly listed by the WS-7 T3
// decision or the WS-7 T17 amendment, when it no longer exists (Rule 1), or
// when its change is subtractive (Rule 2). Anything else stays frozen.
const isUnauthorizedVenueChange = (path) => {
  if (!isVenuePath(path)) return false
  if (WS7_AUTHORIZED_VENUE_PATHS.has(path)) return false
  // Rule 1: a deleted frozen path is exempt by existence. `git show` still
  // returns its baseline content, which is exactly what the subtraction needs.
  if (!existsSync(resolve(ROOT, path))) return false
  // Rule 2: a surviving frozen path is allowed only if no capability signal grew.
  return !isSubtractiveVenueChange(path)
}

const BASELINE_VENUE_SURFACE = (() => {
  const cache = new Map()
  return (path) => {
    if (!cache.has(path)) {
      let text = null
      try {
        text = git("show", `${BASELINE}:${path}`)
      } catch {
        text = null
      }
      // null = no baseline. Recorded as such so the caller can fail closed.
      cache.set(path, text === null ? null : stripComments(text))
    }
    return cache.get(path)
  }
})()

const surfaceSignals = (code) => ({
  ids: new Set([...code.matchAll(/\bid:\s*["']([^"']+)["']/g)].map((m) => m[1])),
  exports: new Set(
    [...code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1])
  ),
  imports: new Set(
    [...code.matchAll(/(?:import\s+(?:[\s\S]*?\s+from\s+)?|import\(\s*|export\s+[\s\S]*?\s+from\s+)["']([^"']+)["']/g)].map(
      (m) => m[1]
    )
  )
})

const grewSignals = (before, after) => {
  const b = surfaceSignals(before)
  const a = surfaceSignals(after)
  return ["ids", "exports", "imports"].flatMap((key) => [...a[key]].filter((token) => !b[key].has(token)).map((t) => `${key}:${t}`))
}

// REMOVAL-ONLY CHECK — the load-bearing half of Rule 2.
//
// The three surface signals above are a good tripwire and a bad definition. They
// answer "did a new venue id, export, or import appear?", which is necessary but
// nowhere near sufficient: rewriting the body of an already-exported function
// leaves all three sets byte-identical, so a signal-only discriminator classes
// a smuggled capability as subtractive and waves it through. The previous
// version of this guard did exactly that and documented the hole in a comment,
// which is how a hole becomes permanent.
//
// So the discriminator is strengthened from "no new surface token" to "the live
// code is the baseline code with tokens DELETED and nothing else". That is
// checked as a subsequence relation over a token stream, which is a statement
// about structure rather than about size:
//
//   - delete a row / an import / a whole export  -> its tokens leave the stream,
//     the rest still matches in order            -> REMOVAL, allowed
//   - add an id, an export, an import             -> a token appears that the
//                                                  baseline never had -> rejected
//   - edit a function body                        -> a token is substituted,
//                                                  not deleted              -> rejected
//   - reorder statements                          -> order no longer matches -> rejected
//   - reformat only                               -> token stream is identical -> allowed
//   - comment-only edits                          -> comments are not tokens -> allowed
//
// This is deliberately NOT a line-count or diff-size heuristic. Those would
// flag a pure deletion that removes twenty lines and pass a one-line capability
// injection appended to the bottom of a file. A token subsequence has no such
// blind spot: it is a containment relation, so it cannot be satisfied by
// removing a lot or by adding a little.
//
// THE TOKENIZER, AND WHY IT IS BUILT THIS WAY. Three implementations were tried
// and the first two were wrong in ways that would have shipped a useless guard:
//
//  1. A hand-rolled scanner. This corpus contains regex literals with quotes
//     (/["']/), and a naive scanner reads the `"` as an opening string and
//     swallows the rest of the file as one token. Measured: an 827-line baseline
//     collapsed to 88 tokens.
//  2. `ts.createScanner` over raw text. A standalone scanner has no parser
//     context, so it cannot reliably tell a regex literal from a division; when
//     it guesses wrong it opens a template literal that never closes and again
//     swallows the file. Measured: the same 53-token drift, plus a genuine
//     deletion in `captureProfiles.mjs` being reported as an insertion.
//  3. `ts.createSourceFile` and a walk to the AST LEAVES. The parser IS
//     context-aware, so regex, division, and template literals are all classified
//     correctly, and the leaf nodes of the tree are exactly the token stream.
//     Comments are not in the tree at all, which gives the "prose is not
//     capability" rule for free.
//
// A wrong tokenizer here is the worst kind of defect, because it fails OPEN in
// the direction that matters: it makes an additive edit look like a reformat.
//
// LITERAL CONTENTS ARE NORMALISED TO A PLACEHOLDER, and this is a real
// limitation, stated rather than hidden. The TS parser hands back a string or
// template literal as one leaf whose text includes its contents, so rewording a
// documentation block that lives inside a template literal would otherwise read
// as a token substitution. Normalising the interior keeps the delimiters - so
// ADDING a literal is still an insertion and still rejected - while letting
// prose be reworded. The residual gap is deliberate: CHANGING the value of a
// string that already exists is invisible to this check. For venue identity that
// is covered independently, because `id:` values are compared literally by
// `surfaceSignals` above; what is not covered is a pre-existing string constant
// being repointed, which is called out in the T2 report as a known limitation of
// the discriminator rather than presented as a strength.
const LITERAL = /^(['"`])/
// JSDoc is attached to the tree and DOES appear in `getChildren()`, unlike `//`
// and block comments. Left in, rewording one JSDoc line reads as a token
// insertion and desynchronises the whole comparison. Prose is not capability,
// so JSDoc is skipped by kind name.
const isJSDocKind = (kind) => ts.SyntaxKind[kind]?.startsWith("JSDoc") === true
const codeTokens = (code) => {
  const normalized = code.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
  const sf = ts.createSourceFile("seam.js", normalized, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const tokens = []
  const walk = (node) => {
    if (isJSDocKind(node.kind)) return
    const kids = node.getChildren(sf)
    if (kids.length === 0) {
      const text = node.getText(sf)
      tokens.push(LITERAL.test(text) ? `${text[0]} literal ${text[text.length - 1]}` : text)
      return
    }
    for (const kid of kids) walk(kid)
  }
  walk(sf)
  return tokens
}

// A body edit, constructed generically so it can never silently no-op. It finds
// the first exported function and injects a call at the top of its body. A
// hand-picked needle (e.g. `return true`) is worthless as a guard fixture: on a
// file that does not contain it the "plant" equals the baseline and the
// assertion passes for the wrong reason, which is how a test stops testing.
const withBodyEdit = (code) => {
  const match = /export\s+(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\([^)]*\)\s*\{/.exec(code)
  if (match === null) throw new Error("body-edit plant needs an exported function to edit")
  const at = match.index + match[0].length
  return code.slice(0, at) + " acquireCapability(); " + code.slice(at)
}
const isRemovalOnly = (before, after) => {
  const b = codeTokens(before)
  const a = codeTokens(after)
  let k = 0
  for (const token of a) {
    // Advance through the baseline looking for this token. Running off the end
    // means the live code contains something the baseline never did.
    while (k < b.length && b[k] !== token) k++
    if (k >= b.length) return false
    k++
  }
  return true
}

// RAW baseline text, for the token comparison only.
//
// This is deliberately NOT the `stripComments` form above. `stripComments` cuts
// each line at the first `//`, and this corpus is full of URLs, so a line inside
// a multi-line template literal gets cut mid-literal and leaves the literal
// unterminated. Feeding that to a scanner makes the token stream depend on
// whether a `//` happened to fall inside a string on that line, which is how the
// comparison ended up rejecting two files whose real changes were pure
// deletions. The scanner already drops comments on its own, so the raw text is
// both the correct input and the simpler one.
const BASELINE_VENUE_RAW = (() => {
  const cache = new Map()
  return (path) => {
    if (!cache.has(path)) {
      let text = null
      try {
        text = git("show", `${BASELINE}:${path}`)
      } catch {
        text = null
      }
      cache.set(path, text)
    }
    return cache.get(path)
  }
})()

const isSubtractiveVenueChange = (path) => {
  const beforeStripped = BASELINE_VENUE_SURFACE(path)
  const beforeRaw = BASELINE_VENUE_RAW(path)
  if (beforeStripped === null || beforeRaw === null) return false // fail closed: no baseline => frozen
  let afterStripped
  let afterRaw
  try {
    afterRaw = readFileSync(resolve(ROOT, path), "utf8")
    afterStripped = stripComments(afterRaw)
  } catch {
    return false // fail closed: unreadable => frozen
  }
  // Signal check first: it names the offending token, which is what a reviewer
  // needs in the failure message.
  if (grewSignals(beforeStripped, afterStripped).length > 0) return false
  // Then the structural check, which is what actually fails closed. A surviving
  // frozen path is "subtractive" only if it is provably the baseline with
  // tokens removed. Anything else - a new token, a substitution, a reorder - is
  // treated as a violation, because uncertainty must resolve to frozen.
  return isRemovalOnly(beforeRaw, afterRaw)
}

const statusPaths = (text) =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((path) => path.includes(" -> ") ? path.split(" -> ").at(-1) : path)
    .map((path) => path.replace(/^"|"$/g, ""))

describe("WS-5 seam guard", () => {
  describe("AC-8a deny-corpus regression", () => {
    it("pins the pre-existing venue and environment deny vocabulary", () => {
      for (const { rel, text } of DENY_CORPUS) expect(readSource(rel), `${rel} must retain ${text}`).toContain(text)
    })

    it("pins the WS-4 leader deny and guard vocabulary", () => {
      for (const [rel, text] of LEADER_CORPUS) expect(readSource(rel), `${rel} must retain ${text}`).toContain(text)
    })

    it("pins the ceremony deny compounds", () => {
      for (const [rel, text] of CEREMONY_CORPUS) expect(readSource(rel), `${rel} must retain ${text}`).toContain(text)
    })
  })

  describe("AC-8b additive string scoping and flat stack", () => {
    it("allows suite denies only in the lock, startup-health, and e2e surfaces", () => {
      const files = codeFilesForScope()
      const hits = tokenHits(files, /suite:deny:[A-Za-z0-9-]+/g)
      const allowed = new Set([
        "apps/dashboard/server/services/commandCentre/startupHealth.mjs",
        "apps/dashboard/src/lib/dangerousActionLock.ts",
        "apps/dashboard/e2e/autopilot-surface.spec.ts",
        "apps/dashboard/e2e/command-centre-order-flow.spec.ts"
      ])
      expect(hits.filter(({ rel }) => !allowed.has(rel))).toEqual([])
      expect(hits.some(({ rel }) => rel === "apps/dashboard/server/services/commandCentre/startupHealth.mjs")).toBe(true)
      expect(hits.some(({ rel }) => rel === "apps/dashboard/src/lib/dangerousActionLock.ts")).toBe(true)
    })

    it("allows audit:startup-health only in the startup-health module", () => {
      const files = codeFilesForScope()
      const hits = tokenHits(files, /audit:startup-health/g)
      expect(new Set(hits.map(({ rel }) => rel))).toEqual(new Set(["apps/dashboard/server/services/commandCentre/startupHealth.mjs"]))
      expect(hits.length).toBeGreaterThan(0)
    })

    it("keeps the trading suite surface free of new route or router components", () => {
      const files = [TRADING_SUITE, AUTOPILOT_SUITE, AUTOPILOT_ROOM]
      for (const file of files) {
        expect(stripComments(readFileSync(file, "utf8")), `${file} must not add route primitives`).not.toMatch(/\b(?:Route|Routes|Router|useNavigate|useLocation)\b/)
      }
      const trading = readFileSync(TRADING_SUITE, "utf8")
      const start = trading.indexOf("export function MarketsSuite()")
      const end = trading.indexOf("export { AutopilotSuite }", start)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeGreaterThan(start)
      // Compare the set of cards actually MOUNTED across the trading surface against the pre-WS-5
      // baseline. The ratified claim "MarketsSuite mounts all 12 exports + AssistantCard" does not
      // survive source inspection: `WatchlistScannerCard` and `PaperAnalyticsCard` are exported but
      // were never mounted, at d400c70 or now — verified via `git show`. Asserting they are mounted
      // would therefore be unsatisfiable even at the baseline. What WS-5 must guarantee is that the
      // mounted set is UNCHANGED, which is what this pins.
      const mountedCards = (code) =>
        [...EXPORT_SURFACE, "AssistantCard"]
          .filter((name) => new RegExp(`<${name}\\b`).test(stripComments(code)))
          .sort()
      const before = mountedCards(git("show", `${BASELINE}:apps/dashboard/src/components/TradingSuite.tsx`))
      const after = mountedCards(
        [trading, readFileSync(AUTOPILOT_SUITE, "utf8")].join("\n")
      )
      expect(after).toEqual(before)
      expect(before.length).toBeGreaterThan(0)
    })

    it("keeps the documented export surface intact", () => {
      const trading = readFileSync(TRADING_SUITE, "utf8")
      for (const name of EXPORT_SURFACE) {
        const re = name === "AutopilotSuite"
          ? /export\s*\{\s*AutopilotSuite\s*\}\s*from\s*["']\.\/AutopilotSuite["']/
          : new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s*\{[^}]*\\b${name}\\b`)
        expect(trading, `${name} export must remain`).toMatch(re)
      }
    })
  })

  describe("AC-1b extraction seam", () => {
    it("has no AutopilotSuite import that resolves to TradingSuite", () => {
      const source = readFileSync(AUTOPILOT_SUITE, "utf8")
      const specs = importSpecifiers(source)
      const tradingText = readFileSync(TRADING_SUITE, "utf8")
      const resolvedTradingSuite = specs.some((specifier) => {
        if (specifier.includes("TradingSuite")) return true
        if (!specifier.startsWith(".")) return false
        const base = resolve(dirname(AUTOPILOT_SUITE), specifier)
        return [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`].some((candidate) => existsSync(candidate) && candidate === TRADING_SUITE)
      })
      expect(resolvedTradingSuite).toBe(false)
      expect(tradingText).toMatch(/export\s*\{\s*AutopilotSuite\s*\}\s*from\s*["']\.\/AutopilotSuite["']/)
    })

    it("passes SignalNotificationsCard as the single sanctioned injected collaborator", () => {
      const source = readFileSync(AUTOPILOT_SUITE, "utf8")
      const room = readFileSync(AUTOPILOT_ROOM, "utf8")
      expect(importSpecifiers(source).some((specifier) => specifier.includes("TradingSuite"))).toBe(false)
      expect(source).toContain("SignalNotificationsCard: ElementType")
      const callSites = room.match(/<AutopilotSuite\b[^>]*SignalNotificationsCard=\{SignalNotificationsCard\}/g) ?? []
      expect(callSites).toHaveLength(1)
    })
  })

  describe("R4.2 dangerous-action lock call sites", () => {
    it("wraps all three dangerous mutations, and no fewer", () => {
      // R4.2 names exactly three families. Pin the names so removing any one of them — or adding an
      // unguarded mutation — fails here rather than silently shipping.
      const commandCentre = readFileSync(resolve(ROOT, "apps/dashboard/src/components/CommandCentrePanel.tsx"), "utf8")
      const autopilot = readFileSync(AUTOPILOT_SUITE, "utf8")
      const lockModule = readFileSync(resolve(ROOT, "apps/dashboard/src/lib/dangerousActionLock.ts"), "utf8")

      // Both modules must actually route through the wrapper, not import it unused.
      expect(commandCentre).toMatch(/import\s*\{[^}]*withActionLock[^}]*\}\s*from\s*["'][^"']*dangerousActionLock["']/)
      expect(autopilot).toMatch(/import\s*\{[^}]*withActionLock[^}]*\}\s*from\s*["'][^"']*dangerousActionLock["']/)

      const names = [...commandCentre.matchAll(/withActionLock\(\s*"([^"]+)"/g), ...autopilot.matchAll(/withActionLock\(\s*"([^"]+)"/g)].map((m) => m[1])
      expect(names.slice().sort()).toEqual(["autopilot-config", "command-centre-execute", "kill-switch"])

      // Fail-closed contract lives in the module itself.
      expect(lockModule).toContain("suite:deny:lock-unavailable")
      expect(lockModule).toContain("suite:deny:lock-held")
      expect(lockModule).toContain("picc:action:")
      expect(lockModule).toMatch(/timeout:\s*8000|LOCK_TIMEOUT_MS\s*=\s*8000/)
    })
  })

  describe("AC-7a venue whitelist", () => {
    it("has no committed or working-tree edits to the venue surface", () => {
      const committed = git("diff", "--name-only", `${BASELINE}..HEAD`).split(/\r?\n/).filter(Boolean)
      const unstaged = git("diff", "--name-only").split(/\r?\n/).filter(Boolean)
      const status = statusPaths(git("status", "--porcelain=v1", "--untracked-files=all"))
      const unauthorized = [...new Set([...committed, ...unstaged, ...status].map(normalize))]
        .filter(isUnauthorizedVenueChange)
      // Still a hard freeze: any venue path that exists, is not explicitly
      // authorized, and GAINS capability fails here exactly as it did under
      // WS-5. WS-7 T2 narrowed what counts as authorized (deleted paths and
      // subtractive edits) without widening what is permitted.
      expect(unauthorized).toEqual([])
    })

    it("WS-7 T2 discriminator: a subtractive edit passes, an additive edit is still frozen", () => {
      // The amendment's whole risk is that it silently permits additions. This
      // plants both directions on the ONE surviving frozen path T2 touched and
      // pins the verdict, so a future edit that weakens the discriminator
      // (drops a signal, flips a comparison, widens a tolerance) fails HERE.
      const path = "apps/dashboard/server/services/captureProfiles.mjs"
      // Two forms, on purpose. The signal check compares COMMENT-STRIPPED text
      // so a doc comment cannot register as a venue id. The structural check
      // compares RAW text, because `stripComments` cuts each line at the first
      // `//` and this corpus is full of URLs, so it leaves template literals
      // unterminated and the token stream meaningless. Feeding the stripped
      // form to the structural check is a bug this test used to have.
      const baselineStripped = BASELINE_VENUE_SURFACE(path)
      const baselineRaw = BASELINE_VENUE_RAW(path)
      expect(baselineStripped, "the surviving frozen path must have a readable baseline").not.toBeNull()
      expect(baselineRaw, "the surviving frozen path must have a readable raw baseline").not.toBeNull()
      const liveRaw = readFileSync(resolve(ROOT, path), "utf8")
      const liveStripped = stripComments(liveRaw)

      // The real T2 change: a venue row removed, counts decremented. Must pass.
      expect(grewSignals(baselineStripped, liveStripped)).toEqual([])
      expect(isRemovalOnly(baselineRaw, liveRaw), "the real T2 removal must be removal-only").toBe(true)
      expect(isSubtractiveVenueChange(path)).toBe(true)

      // ADDITIVE plants against the same path — each MUST be caught.
      const plants = [
        // A new venue row: a new capability that did not exist before.
        baselineRaw.replace(/\bid:\s*["']iqoption["']/, 'id: "olymptrade2",\n    name: "Olymp Trade 2",\n    id: "iqoption",'),
        // A new export: a new callable capability.
        `${baselineRaw}\nexport function submitOlympiTrade() { return true }\n`,
        // A new import: a new capability source.
        baselineRaw.replace('from "node:fs"', 'from "node:fs"\nimport { extraCapability } from "./extraCapability.mjs"')
      ]
      for (const [i, planted] of plants.entries()) {
        expect(
          grewSignals(baselineStripped, stripComments(planted)),
          `additive plant #${i + 1} must grow a capability signal`
        ).not.toEqual([])
        expect(isRemovalOnly(baselineRaw, planted), `additive plant #${i + 1} must be rejected structurally`).toBe(false)
      }

      // THE BODY-EDIT PLANT — the hole this amendment closes. Rewriting the logic
      // inside an already-exported function introduces no new id, export, or
      // import, so the signal check alone reports nothing and a signal-only
      // discriminator would classify this smuggled capability as subtractive.
      // The removal-only check is what rejects it, and that is why the
      // discriminator is no longer signal-only.
      const bodyEdit = withBodyEdit(baselineRaw)
      expect(
        grewSignals(baselineStripped, stripComments(bodyEdit)),
        "a body edit adds no surface token - signal-only would wrongly allow this"
      ).toEqual([])
      expect(
        isRemovalOnly(baselineRaw, bodyEdit),
        "a body edit introduces a token the baseline never had, so it must be rejected"
      ).toBe(false)
      // The comparison point is the BASELINE, not HEAD. So restoring the row
      // T2 removed returns the surface to the WS-5 reference and is NOT growth
      // beyond it — the absence of the venue is separately pinned by
      // extensionAbsence.test.mjs and by the T2 deletion assertions below.
      const restored = liveStripped.replace(
        /export const CAPTURE_PROFILES = \[/,
        'export const CAPTURE_PROFILES = [\n  { id: "expertoption", name: "ExpertOption", kind: "binary", status: "full", capture: {} },'
      )
      expect(
        grewSignals(baselineStripped, restored),
        "re-adding a baseline id is not growth beyond the baseline surface"
      ).toEqual([])
      // But a row that did NOT exist at WS-5 baseline IS growth, even though the
      // file is the post-T2 one. This is the case that must stay frozen.
      const newRow = liveStripped.replace(
        /export const CAPTURE_PROFILES = \[/,
        'export const CAPTURE_PROFILES = [\n  { id: "brandnewvenue", name: "Brand New", kind: "binary", status: "full", capture: {} },'
      )
      expect(grewSignals(baselineStripped, newRow), "a venue absent from the baseline must be growth").toEqual([
        "ids:brandnewvenue"
      ])
    })

    it("WS-7 T2 exempts deleted frozen paths by existence, and only by existence", () => {
      // Rule 1 is not a licence to re-create. Both deleted paths are absent, so
      // neither is a violation; the moment either returns to disk, `existsSync`
      // flips and the freeze re-closes on it.
      for (const path of [
        "apps/dashboard/server/services/expertoption.mjs",
        "apps/dashboard/server/services/liveEO.mjs"
      ]) {
        expect(existsSync(resolve(ROOT, path)), `${path} must be deleted by WS-7 T2`).toBe(false)
        expect(isUnauthorizedVenueChange(path), `${path} is deleted, so it is not a violation`).toBe(false)
      }
      // A path that still exists and is NOT subtractive-ed stays frozen — i.e.
      // the exemption is narrow, and a re-created file with grown capability
      // would be caught by Rule 2.
      const revived = "apps/dashboard/server/services/expertoption.mjs"
      const baseline = BASELINE_VENUE_SURFACE(revived)
      expect(baseline, "the deleted path keeps its baseline for the re-creation check").not.toBeNull()
      expect(grewSignals(baseline, baseline)).toEqual([]) // identical => subtractive
    })

    it("the amendment does not weaken the other frozen venue paths", () => {
      // The frozen paths that NO amendment named must keep exactly the coverage
      // they had under WS-5. Two of them are byte-identical to baseline;
      // `policyGraphCatalog.mjs` was edited SUBTRACTIVELY (its ExpertOption
      // policy row and roster were removed), so "unchanged on disk" would be a
      // false claim for it. What must not change is COVERAGE: for each, an
      // additive edit is still rejected, and none is authorized.
      //
      // `ccxtOrdering.mjs` was in this list under T2 and is GONE under T17,
      // because the T17 amendment names it (spec :1348, extend-don't-replace).
      // Its removal is the one coverage loss this amendment causes, and it is
      // disclosed in the RESIDUAL COVERAGE block above rather than left as a
      // silent shrinkage in the list below.
      const stillFrozen = [
        "apps/dashboard/server/services/commandCentre/policyGraphCatalog.mjs",
        "apps/dashboard/server/services/venues/venueAdapterContract.mjs"
      ]
      for (const path of stillFrozen) {
        expect(existsSync(resolve(ROOT, path)), `${path} must still exist`).toBe(true)
        expect(WS7_AUTHORIZED_VENUE_PATHS.has(path), `${path} must not be authorized by the WS-7 T3 decision or the WS-7 T17 amendment`).toBe(false)
        // Whatever its diff, the change is removal-only, so the predicate agrees.
        expect(isSubtractiveVenueChange(path), `${path} must be subtractive`).toBe(true)
        // The real teeth, and the thing that must NOT have weakened: an ADDITIVE
        // plant on the same file is still rejected, by the signal check AND by
        // the removal-only check.
        const baselineStripped = BASELINE_VENUE_SURFACE(path)
        const baselineRaw = BASELINE_VENUE_RAW(path)
        const planted = `${baselineRaw}\nexport function smuggledCapability() { return true }\n`
        expect(grewSignals(baselineStripped, stripComments(planted)), `${path} must reject an added export`).toEqual([
          "exports:smuggledCapability"
        ])
        expect(isRemovalOnly(baselineRaw, planted), `${path} must reject an added export structurally`).toBe(false)
        // And the body-edit hole is closed here too: rewriting the logic inside
        // an existing export adds no surface token, so only the removal-only
        // check can catch it. This is the case the previous version waved
        // through, and it is the reason the discriminator is not signal-only.
        const bodyEdit = withBodyEdit(baselineRaw)
        expect(
          grewSignals(baselineStripped, stripComments(bodyEdit)),
          "a body edit grows no surface token - that is the point"
        ).toEqual([])
        expect(isRemovalOnly(baselineRaw, bodyEdit), `${path} must reject a body edit`).toBe(false)
      }
      // `ccxtOrdering.mjs` left the frozen list, so its authorising decision is
      // pinned explicitly here rather than inferred from its absence above: T17
      // names it and T3 does not. If a later amendment moves it back, one of
      // these two lines flips and the change is a deliberate edit.
      expect(
        WS7_T17_AUTHORIZED_VENUE_PATHS.has("apps/dashboard/server/services/ccxtOrdering.mjs"),
        "the WS-7 T17 amendment must name ccxtOrdering.mjs - spec :1348 extends it"
      ).toBe(true)
      expect(
        WS7_T3_AUTHORIZED_VENUE_PATHS.has("apps/dashboard/server/services/ccxtOrdering.mjs"),
        "ccxtOrdering.mjs is authorized by T17, never by T3"
      ).toBe(false)
      // And the venue/ directory can never be authorised wholesale, by ANY
      // decision. Under T3's one-entry set that invariant was expressible as a
      // single identity check ("the only venues/ entry is hyperliquidPerps");
      // the T17 amendment makes venues/ four named files, so the SAME invariant
      // is now asserted in its general form instead of by that one identity:
      // every authorised entry is a FILE PATH, never a directory, never a glob,
      // and a venue file no decision named is authorised by nothing. That is a
      // strictly stronger statement of "no directory smuggle" than the identity
      // check it replaces, and it is still an equality, not a truthy.
      const VENUES_PREFIX = "apps/dashboard/server/services/venues/"
      expect(
        [...WS7_AUTHORIZED_VENUE_PATHS].filter((p) => p.startsWith(VENUES_PREFIX)).sort()
      ).toEqual([
        "apps/dashboard/server/services/venues/ccxtLifecycleRails.mjs",
        "apps/dashboard/server/services/venues/ccxtVenueLifecycle.mjs",
        "apps/dashboard/server/services/venues/ccxtVenues.mjs",
        "apps/dashboard/server/services/venues/hyperliquidPerps.mjs"
      ])
      for (const p of WS7_AUTHORIZED_VENUE_PATHS) {
        expect(p.endsWith("/"), `${p} must not be a directory entry`).toBe(false)
        expect(/[*?]/.test(p), `${p} must not be a glob or wildcard`).toBe(false)
        expect(p.endsWith(".mjs"), `${p} must be a named file, not a bare prefix`).toBe(true)
      }
      expect(
        WS7_AUTHORIZED_VENUE_PATHS.has(VENUES_PREFIX),
        "the venues/ directory itself must never be authorized by any decision"
      ).toBe(false)
      expect(
        WS7_AUTHORIZED_VENUE_PATHS.has("apps/dashboard/server/services/venues/someVenueNoDecisionNamed.mjs"),
        "a venue file that no decision named must not be authorized"
      ).toBe(false)
    })

    it("grants no venue exception beyond the WS-7 T3 and WS-7 T17 decisions", () => {
      // Pins the width of the allowance so it cannot be widened silently. A new
      // exception requires a new spec decision AND a deliberate edit here.
      // WS-7 T2 granted NO entry: its two deleted venue paths are exempt by
      // existence (Rule 1), not by membership here, so a deleted file can never
      // be re-created into a permanent write allowance.
      //
      // There are now TWO named decisions, so there are TWO exact lists, asserted
      // separately, plus their union asserted as a third. Each is an equality
      // against a literal a reviewer can read at a glance - none of them is
      // loosened to a truthy check, because a truthy check here would permit any
      // width at all, which is the failure this assertion exists to prevent.
      expect([...WS7_T3_AUTHORIZED_VENUE_PATHS].sort()).toEqual([
        "apps/dashboard/server/services/venues/hyperliquidPerps.mjs"
      ])
      expect([...WS7_T17_AUTHORIZED_VENUE_PATHS].sort()).toEqual([
        "apps/dashboard/server/services/ccxtOrdering.mjs",
        "apps/dashboard/server/services/venues/ccxtLifecycleRails.mjs",
        "apps/dashboard/server/services/venues/ccxtVenueLifecycle.mjs",
        "apps/dashboard/server/services/venues/ccxtVenues.mjs"
      ])
      expect([...WS7_AUTHORIZED_VENUE_PATHS].sort()).toEqual([
        "apps/dashboard/server/services/ccxtOrdering.mjs",
        "apps/dashboard/server/services/venues/ccxtLifecycleRails.mjs",
        "apps/dashboard/server/services/venues/ccxtVenueLifecycle.mjs",
        "apps/dashboard/server/services/venues/ccxtVenues.mjs",
        "apps/dashboard/server/services/venues/hyperliquidPerps.mjs"
      ])
      // The T2-deleted paths must be absent from the set, so that re-creating
      // one re-freezes it instead of inheriting a write permission.
      for (const deleted of [
        "apps/dashboard/server/services/expertoption.mjs",
        "apps/dashboard/server/services/liveEO.mjs"
      ]) {
        expect(
          WS7_AUTHORIZED_VENUE_PATHS.has(deleted),
          `${deleted} must be exempt by existence, never by authorization by the WS-7 T3 decision or the WS-7 T17 amendment`
        ).toBe(false)
      }
      // The exception must never be used to smuggle the whole directory in.
      //
      // The original assertion - every authorized entry IS a venue path - is
      // kept, but it does NOT on its own support the comment above it:
      // `isVenuePath` is satisfied by the `services/venues/` PREFIX, so it
      // returns true for the directory itself and for any file inside it. Under
      // T3's one-entry set that gap was harmless, because the only authorised
      // entry happened to be one named file. Widening the set would have turned
      // it into a hole, so the directory-shaped forms are rejected explicitly
      // below. Nothing here is relaxed: the membership check is stricter than
      // before, and it runs over the union rather than one decision's set.
      for (const path of WS7_AUTHORIZED_VENUE_PATHS) {
        expect(isVenuePath(path), "an authorized exception must actually be a venue path").toBe(true)
        expect(path.endsWith("/"), `${path} must not be a directory entry`).toBe(false)
        expect(/[*?]/.test(path), `${path} must not be a glob or wildcard`).toBe(false)
        expect(path.endsWith(".mjs"), `${path} must be a named file, not a bare prefix`).toBe(true)
      }
    })

    it("the WS-7 T2 exception is subtractive only — the deleted venue is really gone", () => {
      // The second authorized entry exists so AC-7a permits DELETING the
      // ExpertOption service. It must not become a licence to edit any other
      // EO surface, and the file it names must not come back.
      const eoPath = "apps/dashboard/server/services/expertoption.mjs"
      expect(existsSync(resolve(ROOT, eoPath)), `${eoPath} must be deleted, not merely authorized`).toBe(false)
    })
  })

  describe("AC-2c package scope", () => {
    it("adds only the Playwright dev dependency and e2e script", () => {
      const before = JSON.parse(git("show", `${BASELINE}:apps/dashboard/package.json`))
      const after = JSON.parse(readFileSync(resolve(ROOT, "apps/dashboard/package.json"), "utf8"))
      const { "@playwright/test": playwright, ...devDependencies } = after.devDependencies
      const { "test:e2e": e2e, ...scripts } = after.scripts
      expect(playwright).toBe("^1.49.1")
      expect(e2e).toBe("playwright test")
      // DEPENDENCY SCOPE - the real teeth of this guard, unchanged in kind. Every
      // devDependency must still equal the WS-5 baseline, proving the e2e addition
      // never smuggled in another package. ONE key is sanctioned to differ, by a
      // dated amendment rather than by loosening the comparison:
      //   "vitest" - WS-7 dep amendment 2026-10-07, ^3.0.0 -> ^5.0.3, clearing two
      //              CRITICAL advisories (tinypool prototype-pollution -> RCE, and
      //              vitest path traversal via @vitest/mocker). Transitive deps are
      //              NOT hand-edited and no new package was added to the manifest.
      // The allowance is an explicit key list, exactly as `allowedScriptDeltas` is
      // below, so a NEW devDependency still fails here.
      const allowedDevDependencyDeltas = ["vitest"]
      for (const [depKey, depValue] of Object.entries(devDependencies)) {
        if (before.devDependencies[depKey] === depValue) continue
        expect(
          allowedDevDependencyDeltas.includes(depKey),
          `devDependency "${depKey}" changed without a recorded decision`
        ).toBe(true)
      }
      expect({ ...devDependencies, vitest: before.devDependencies.vitest }).toEqual(before.devDependencies)
      // SCRIPT SCOPE - exactly two keys are sanctioned to differ from the
      // baseline, each by a named decision:
      //   "test:e2e" - WS-5, adding the e2e command.
      //   "test"     - WS-7 tooling, dropping a needless `--maxWorkers=1` that
      //                serialized all 303 files. Measured 256-392s serial vs
      //                46-55s parallel on this machine, all runs green.
      // The allowance is an explicit key list, not a loosened comparison, so a
      // new script or a new dependency still fails here.
      expect(scripts).toEqual({ ...before.scripts, ...(scripts.test ? { test: scripts.test } : {}) })
      const allowedScriptDeltas = ["test", "test:e2e"]
      for (const key of Object.keys(scripts)) {
        expect(
          before.scripts[key] === scripts[key] || allowedScriptDeltas.includes(key),
          `script "${key}" changed without a recorded decision`
        ).toBe(true)
      }
      // Whole-manifest equality, with BOTH sides stripped of the sanctioned
      // keys. Stripping only one side would compare a manifest missing `test`
      // against a baseline that still has it, which is a false failure rather
      // than a real scope violation. `vitest` is normalised to the BASELINE value
      // on the after side for the same reason: it is a sanctioned delta, already
      // checked key-by-key above, not a difference this comparison should judge.
      const { "@playwright/test": _bp, ...beforeDevDependencies } = before.devDependencies
      const { "test:e2e": _be2e, test: _btest, ...beforeScripts } = before.scripts
      const { "@playwright/test": _ap, ...rawAfterDevDependencies } = after.devDependencies
      const afterDevDependencies = { ...rawAfterDevDependencies, vitest: beforeDevDependencies.vitest ?? rawAfterDevDependencies.vitest }
      const { "test:e2e": _ae2e, test: _atest, ...afterScripts } = after.scripts
      expect({ ...after, scripts: afterScripts, devDependencies: afterDevDependencies }).toEqual({
        ...before,
        scripts: beforeScripts,
        devDependencies: beforeDevDependencies
      })
    })
  })
})
