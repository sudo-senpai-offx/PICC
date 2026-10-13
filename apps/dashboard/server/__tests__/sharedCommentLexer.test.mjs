// THE ONE-LEXER PROOF, and the fixtures that show it still bites.
//
// WHY THIS FILE EXISTS. Four guards each used to carry their own hand-rolled
// comment lexer:
//
//   apps/dashboard/server/__tests__/importResolutionGuard.test.mjs
//   apps/dashboard/server/__tests__/ws7AuthBootstrapGateGuard.test.mjs
//   apps/dashboard/server/__tests__/ws7RouteAuthCoverageGuard.test.mjs
//   scripts/ws7-seam-probe.mjs
//
// Two of those independently shipped a VACUOUS-PASS bug: each blanked a
// legitimate one-line gate from the `//` of a `https://` string default onward,
// leaving the scan with ZERO call sites, so every predicate in the file passed
// while measuring nothing. A third (the probe's first cut) deleted real code. The
// fix is one lexer in `server/scripts/guard-primitives.mjs`; this file is what
// stops it becoming four again.
//
// A FIXED GUARD IS NOT A FIXED GUARD UNLESS IT HAS BEEN SEEN TO FAIL. That is why
// the fixtures below are chosen to be the shapes that actually broke the old
// lexers, and why the count-neutrality claim is measured rather than asserted.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  stripComments,
  isNonProductionPath,
  NON_PRODUCTION_SEGMENTS
} from "../scripts/guard-primitives.mjs"
import { productionFiles, stripComments as probeStripComments } from "../../../../scripts/ws7-seam-probe.mjs"
import { stripComments as guardStripComments } from "../../../../scripts/ws7-seam-guard.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const SHARED = join(REPO_ROOT, "apps/dashboard/server/scripts/guard-primitives.mjs")

const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8")

/**
 * THE HISTORY OF A LIST THAT NO LONGER EXISTS, kept because every paragraph below
 * names a consumer that still exists and whose correctness rides on this lexer.
 * Only the obligation to REMEMBER them is gone; the derived scan computes the
 * same set from the tracked tree instead.
 *
 * `VITEST_CONSUMERS` was a hand-maintained array of exactly that set, and its
 * failure mode was catalog entry SHIP-2 verbatim — "a hand-maintained guard
 * inventory that omits a consumer, so the omitted consumer is invisible to the
 * guard that is supposed to police it." It was missed four times in this
 * repository, and the fourth was still live when the pre-mortem planner shipped
 * its first readout. The weakness was never carelessness: it was that coverage
 * was bounded by a human's memory, and no amount of care fixes that.
 *
 * The consumers themselves cannot be imported without re-running their suites,
 * which is why they are scanned as source rather than exercised directly.
 *
 * REGISTERING A NEW CONSUMER WAS PART OF ADOPTING THE SHARED LEXER, not an
 * of the proof below: the negative half ("no consumer RETAINS a declaration")
 * and the resolution half ("resolves to the SAME absolute module"). That is
 * exactly the drift this file exists to close — a hand-rolled lexer pasted into
 * an unregistered consumer would pass silently, which is how the original four
 * came to disagree in the first place.
 *
 * `graduationWindows.test.mjs` is here because it imports `stripComments` for
 * its advisory-boundary source scan (W3-04, Task 1). It was initially adopted
 * without registration, and a mutation probe proved the silence was real: a
 * local sixth lexer pasted into it left this file green.
 *
 * `graduationWeighting.test.mjs` is here for the same reason and was registered
 * in the same commit it adopted the lexer (W3-04, Task 2). Its scan is narrower —
 * one module, banned token list plus a "reads exactly one environment variable"
 * assertion — but a narrower unregistered scan is still an invisible one.
 *
 * `graduationGates.test.mjs` is here for the same reason (W3-04, Task 3), registered
 * in the same commit that adopted the lexer. It carries a third distinct scan: the
 * advisory-boundary check over the gates module, whose ban list deliberately
 * EXCLUDES `ceremony` and `credential` — those two tokens are how the layer names
 * its unmet preconditions, so the scan bans importing or calling them rather than
 * naming them. A guard cannot enforce a rule the module is obliged to break.
 *
 * `services/premortem/inventory.mjs` is here for the sharpest reason of the seven
 * (W3-05, Task 2), and the irony is worth stating plainly rather than leaving for
 * a reader to notice. Catalog entry SHIP-2 IS "a hand-maintained guard inventory
 * that omits a consumer, so the omitted consumer is invisible to the guard that is
 * supposed to police it." This module derives the guard inventory the pre-mortem
 * planner verifies claims against. If IT were allowed to sit outside this array
 * unregistered, then a hand-rolled lexer pasted into it would pass this file green,
 * and the planner's own first concrete output would certify a guard that is itself
 * incomplete — in the precise way the planner exists to detect. It carries a fourth
 * distinct scan: it reads every tracked guard file through this lexer to count its
 * assertions and declared titles, so its correctness depends on the lexer the same
 * way the other five depend on it.
 *
 * `__tests__/preMortemMutate.test.mjs` is here because this repo has now hit the
 * omission THREE times, and this was the third (W3-05, Task 4). Task 2 registered
 * `inventory.mjs`; `graduationWindows.test.mjs` was adopted unregistered and a
 * probe proved the silence was real; and this file shipped in the same commit that
 * registered `preMortemMutate.test.mjs`, one commit too late — its registration
 * mutation was run and the whole file stayed green with a second lexer pasted in.
 * That is the mechanism these two assertions police, demonstrated rather than
 * asserted. Its scan is the widest any consumer has: seven purity predicates and
 * four separator predicates over `mutate.mjs`, plus a body-slice call-count check.
 *
 * `__tests__/preMortemApi.test.mjs` is here because it is the FOURTH occurrence
 * of the same omission in this repository (W3-05, Task 5). This file's own
 * membership settles the criterion that was in dispute: no entry's stated reason
 * is "it is a guard" — index 7 is `services/premortem/inventory.mjs`, a SOURCE
 * module rather than a guard, registered precisely because it reads every
 * tracked guard file through this lexer and so DEPENDS on it. The array
 * registers anything whose correctness rides on this lexer, whether or not it
 * guards anything. `preMortemApi.test.mjs` reads `handlers.mjs` through the
 * lexer to locate the pre-mortem route and to confirm `requireAuthStrict` is
 * its first statement — and if the lexer were wrong, both scans would measure
 * the wrong span of a security-critical route while this file stayed green.
 *
 * `graduationApi.test.mjs` was the FOURTH omission and is why this array is
 * gone. It reaches the primitive through `await import(...)`, which the old
 * resolution half could not match, so it read as ZERO references and could not
 * have been registered even if someone had remembered to try. Its consumer took
 * the shape the scanner recognised — that was the right call WHILE THE LIST
 * EXISTED, and it is precisely why the list could not be made safe.
 */

/**
 * THE CONSUMER SET, DERIVED.
 *
 * With no registry left to be a member of, both spellings are simply what a
 * reference looks like. `from "…"` is a static import; `import("…")` is the
 * dynamic one. The old objection — that admitting a second spelling class into
 * the one guard in this repository with three vacuous-pass incidents is risky —
 * was sound then and is not now, because the risk it protected against was a
 * hand-maintained list, and that is exactly what no longer exists.
 */
const EXCLUDED_PREFIXES = [".freebuff/worktrees/"]

// `git ls-files` rather than a filesystem walk, matching `ws7TestStoreIsolation`:
// it omits the untracked, gitignored `server/data/` and any nested worktree of
// another branch. The prefix exclusion is kept AND asserted further down, so a
// future rewrite as a naive walk fails loudly instead of quietly reading another
// branch's working state.
const lsFiles = (patterns) =>
  execFileSync("git", ["ls-files", ...patterns], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !EXCLUDED_PREFIXES.some((p) => f.startsWith(p)))

const SHARED_REL = "apps/dashboard/server/scripts/guard-primitives.mjs"

// A reference to the primitive, EITHER spelling. `matchAll` rather than `.test`
// on a /g regex, which is stateful across calls and would make this set depend
// on evaluation order — the kind of bug that passes until the day it does not.
const REFERENCE = /(?:from\s+|import\(\s*)"([^"]*guard-primitives\.mjs)"/g
const referencesIn = (code) => [...code.matchAll(REFERENCE)].map((m) => m[1])

// A file that RETAINS its own lexer. Definitions ONLY, and the exclusion is the
// whole subtlety: `const { stripComments } = await import(…)` is how every
// legitimate consumer binds the name, so matching a bare binding would report
// all of them as offenders — the exact inverse of what this file is for.
const DECLARATION =
  /(?:function\s+stripComments|(?:const|let|var)\s+stripComments\s*=|static\s+stripComments\s*[=(])/

// Scanned through `stripComments` itself, so prose that merely NAMES the
// primitive — this file's own header included — is not mistaken for code that
// references it. The circularity is real and is why the scan carries a planted
// bite test below rather than being trusted on its own reasoning.
const codeOf = (rel) => stripComments(read(rel))

const TRACKED_SOURCE = lsFiles(["*.mjs", "*.js", "*.mts", "*.cts", "*.ts", "*.tsx"])

/**
 * KNOWN DUPLICATE LEXERS — a list of VIOLATIONS, not of members, and it must shrink.
 *
 * Deriving the consumer set surfaced four files that declare their own
 * `stripComments`, all carrying the same naive form: two chained `replace`
 * calls, one blanking a C-style block comment and one blanking a `//` to end of
 * line via a `[^:]` guard. (The literal is deliberately not reproduced here —
 * its closing sequence would terminate this block comment.)
 *
 * That is precisely the form this file's header blames for the original
 * vacuous-pass incidents — the one that blanked a legitimate one-line gate from
 * the `//` of a `https://` string default onward. The shared primitive is a
 * character-level lexer BECAUSE the naive form is wrong, so these four guards are
 * scanning with the known-inferior instrument. They currently pass, which is not
 * evidence: a zero-call-site vacuous scan also passes.
 *
 * The previous hand-maintained `VITEST_CONSUMERS` list never saw them, because
 * they were never registered — they were written AFTER the list was considered
 * settled. So the claim "the four local lexers are gone" was false while sitting
 * in a green test.
 *
 * THIS LIST IS DELIBERATELY OPPOSITE IN KIND TO THE LIST IT REPLACES. The old one
 * had to grow every time somebody adopted the lexer. This one can only shrink,
 * and it is pinned from both sides: an unlisted declarer fails the scan, and a
 * listed entry that has STOPPED declaring fails too, so migrating a file without
 * removing it here turns the suite red rather than letting the entry rot. Owner:
 * W3-07.
 */
const KNOWN_DUPLICATE_LEXERS = Object.freeze([
  "apps/dashboard/server/__tests__/orderFlowHonestySeamGuard.test.mjs",
  "apps/dashboard/server/__tests__/ws4LeaderSourcingSeamGuard.test.mjs",
  "apps/dashboard/server/__tests__/ws5SeamGuard.test.mjs",
  "apps/dashboard/server/__tests__/ws6SafetySeamGuard.test.mjs"
])

// Every tracked source file must exist on disk to be read. Asserted below rather
// than assumed: a silently-skipped file is an unread file, and an unread file is
// indistinguishable from a clean one.
const MISSING_FROM_DISK = TRACKED_SOURCE.filter((rel) => !existsSync(join(REPO_ROOT, rel)))

// THIS FILE IS EXCLUDED FROM BOTH DERIVED SETS, and the exclusion is asserted
// rather than assumed. It carries the declaration and reference patterns as
// PLANTED STRING FIXTURES — `const stripComments = (src) => src` and friends — so
// a scan over it finds its own bite-test samples and reports it as a duplicate
// lexer and a four-times consumer. That is the scan working correctly on text
// that is not code.
//
// Excluding it is only honest if the exclusion is NARROW and PROVABLE, so the
// test below asserts that this file really is in the unfiltered declarer set.
// If a future edit removes the fixtures, that assertion fails and the exclusion
// has to be revisited rather than silently keeping a hole open.
const THE_GUARD = "apps/dashboard/server/__tests__/sharedCommentLexer.test.mjs"
const isTheGuard = (rel) => rel === THE_GUARD

const ALL_DECLARERS = TRACKED_SOURCE.filter((rel) => DECLARATION.test(codeOf(rel)))
const DECLARERS = ALL_DECLARERS.filter((rel) => !isTheGuard(rel))
const CONSUMERS = TRACKED_SOURCE.filter(
  (rel) => !isTheGuard(rel) && referencesIn(codeOf(rel)).length > 0
)

// COUNT DERIVED, NOT WRITTEN. A literal "four" here went stale the moment Task 2
// registered a fifth consumer, and a consumer-count claim in a title is exactly
// the kind of comment nobody re-reads before adding the next entry. It now
// reports what the scan actually found rather than what a list held.
describe(`the shared comment lexer — ONE implementation, ${CONSUMERS.length} consumers derived from the tracked tree`, () => {
  it("the two plain-script consumers expose the very same function object", () => {
    // Real `Object.is` identity, not a source-text resemblance. A copy would fail
    // here even if it were character-for-character identical today, which is the
    // whole point: identical twins drift, and this assertion is what stops the
    // second copy from being created.
    expect(probeStripComments).toBe(stripComments)
    expect(guardStripComments).toBe(stripComments)
    expect(typeof stripComments).toBe("function")
  })

  it("no UNLISTED tracked file retains a declaration — and the known list cannot rot", () => {
    // The negative half, and the one that fails if someone pastes the lexer back.
    //
    // SCOPE CHANGED DELIBERATELY. This used to iterate a hand-maintained list, so
    // its coverage was bounded by whoever remembered to add an entry — and the
    // omission happened four times. It now ranges over EVERY tracked source file,
    // so a hand-rolled lexer in a file nobody registered is still found. That is
    // the entire point of the change: the guard no longer depends on the memory of
    // the person editing it.
    //
    // It also no longer appends the two plain-script consumers by hand.
    // `scripts/ws7-seam-probe.mjs` and `ws7-seam-guard.mjs` are tracked source
    // files that reference the primitive, so the derived set already contains them.
    //
    // Pinned from BOTH sides on purpose. An unlisted declarer fails the first
    // assertion. A listed entry that has stopped declaring fails the second, so a
    // migration cannot leave a stale exception behind — the list is forced to
    // shrink rather than being allowed to become the next inventory that rots.
    const unlisted = DECLARERS.filter((rel) => !KNOWN_DUPLICATE_LEXERS.includes(rel))
    expect(
      unlisted,
      `tracked files declaring their own stripComments with no recorded reason: ${unlisted.join(", ")}`
    ).toEqual([SHARED_REL])

    expect(
      DECLARERS.filter((rel) => KNOWN_DUPLICATE_LEXERS.includes(rel)),
      "these are listed as KNOWN duplicates but no longer declare one — remove them from the list"
    ).toEqual([...KNOWN_DUPLICATE_LEXERS])
  })

  it("the derived scan really read the tree, so the single declarer means something", () => {
    // NON-VACUITY. Deriving a set replaces curated input with a scan, and a scan
    // that reads nothing returns an empty answer indistinguishable from a clean
    // one. That is the exact failure mode this repository has already paid for
    // twice — `MUTATE_CODE` in W3-05, and three vacuous-pass incidents recorded in
    // this file's own header — so it is pinned rather than assumed.
    expect(TRACKED_SOURCE.length, "git ls-files returned almost nothing").toBeGreaterThan(100)
    expect(
      MISSING_FROM_DISK,
      `tracked source files absent from disk, so unread: ${MISSING_FROM_DISK.join(", ")}`
    ).toEqual([])
    expect(CONSUMERS.length, "no consumer was derived, so nothing is being proved").toBeGreaterThan(5)

    // THE EXCLUSION IS PROVABLE. This file is skipped by both derived sets
    // because it carries the patterns as planted fixtures. That is only an honest
    // skip if the skip is actually being used — so assert it really does match,
    // which also means a future edit that deletes the fixtures turns THIS
    // assertion red instead of quietly leaving an unexplained hole.
    expect(
      ALL_DECLARERS,
      "this file is excluded from the declarer scan, but no longer matches it — revisit the exclusion"
    ).toContain(THE_GUARD)

    // The file that motivated dropping the list. If derivation ever stops finding
    // it, the change has silently reverted to "consumers I remembered".
    expect(CONSUMERS).toContain("apps/dashboard/server/__tests__/graduationApi.test.mjs")
    expect(CONSUMERS).toContain("apps/dashboard/server/services/premortem/inventory.mjs")
  })

  it("the declaration scan BITES a planted lexer and spares a legitimate binding", () => {
    // The scan is run through `stripComments` and reaches a `/g`-free literal, so
    // both failure shapes are worth planting rather than reasoning about: a real
    // declaration must be caught, and the destructuring binding every consumer
    // uses must NOT be. Catching the second one would report all consumers as
    // offenders and make the guard useless.
    for (const planted of [
      "function stripComments(src) { return src }",
      "const stripComments = (src) => src",
      "let stripComments = function (src) { return src }",
      "export function stripComments(src) { return src }",
      "class L { static stripComments(src) { return src } }"
    ]) {
      expect(DECLARATION.test(planted), `missed a planted declaration: ${planted}`).toBe(true)
    }
    for (const legitimate of [
      `const { stripComments } = await import("../scripts/guard-primitives.mjs")`,
      `import { stripComments } from "../scripts/guard-primitives.mjs"`,
      `const result = stripComments(source)`,
      `export { stripComments } from "../scripts/guard-primitives.mjs"`
    ]) {
      expect(DECLARATION.test(legitimate), `flagged a legitimate binding: ${legitimate}`).toBe(false)
    }
  })

  it("each consumer resolves `stripComments` from the SAME absolute module", () => {
    // Identity by RESOLUTION rather than by name. Two files can both reference
    // `stripComments` and still get different functions if they reach different
    // files — a duplicated module, a symlink, a second checkout. The specifier is
    // resolved against the consumer's own directory and compared to the shared
    // module's absolute path.
    //
    // BOTH SPELLINGS ARE IN SCOPE, which the previous version of this test could
    // not manage: it matched only a static `from` specifier, so `graduationApi`'s
    // `await import(…)` read as zero references and the file was excluded rather
    // than failing.
    for (const rel of CONSUMERS) {
      const specifiers = referencesIn(codeOf(rel))
      expect(specifiers.length, `${rel} must reference guard-primitives.mjs exactly once`).toBe(1)
      const dir = rel.slice(0, rel.lastIndexOf("/"))
      const resolved = join(REPO_ROOT, dir, specifiers[0])
      expect(resolved.replace(/\\/g, "/"), `${rel} resolves somewhere else`).toBe(
        SHARED.replace(/\\/g, "/")
      )
    }
  })

  it("the shared module is reachable from BOTH trees by plain relative ESM", () => {
    // The mechanism, asserted. `server/scripts/absence-scope.mjs` established it:
    // a vitest file reaches `../scripts/<mod>.mjs`, a plain script reaches
    // `../apps/dashboard/server/scripts/<mod>.mjs`. No alias, no build step, no
    // workspace coupling — which is what lets both trees share one function
    // instead of one function each.
    const fromTest = join(REPO_ROOT, "apps/dashboard/server/__tests__", "../scripts/guard-primitives.mjs")
    const fromScript = join(REPO_ROOT, "scripts", "../apps/dashboard/server/scripts/guard-primitives.mjs")
    expect(fromTest.replace(/\\/g, "/")).toBe(SHARED.replace(/\\/g, "/"))
    expect(fromScript.replace(/\\/g, "/")).toBe(SHARED.replace(/\\/g, "/"))
  })
})

describe("the shared lexer does not strip INSIDE a string literal", () => {
  // The first vacuous-pass shape. `handlers.mjs` really does put a URL default on
  // the same line as route logic (the Stripe success/cancel defaults and the 5173
  // origin default), so this is not a contrived spelling.

  it("keeps a `//` inside a double-quoted string, and the code after it on that line", () => {
    const fixture = 'const home = "http://localhost:5173"; const keep = 1'
    const view = stripComments(fixture)
    expect(view).toContain('"http://localhost:5173"')
    expect(view, "code after the string on the same line was blanked").toContain("const keep = 1")
  })

  it("keeps a `//` inside a single-quoted string and a template literal", () => {
    for (const fixture of [
      "const a = 'https://example.invalid/x'; const keep = 1",
      "const a = `https://example.invalid/${id}`; const keep = 1"
    ]) {
      const view = stripComments(fixture)
      expect(view, `string content was eaten: ${fixture}`).toContain("https://example.invalid")
      expect(view).toContain("const keep = 1")
    }
  })

  it("still strips a REAL trailing comment that follows a string", () => {
    // The complement. Being string-aware must not mean being comment-blind: a
    // genuine `//` after a string IS a comment and its content must not read as
    // code, or a removal record naming a gate would satisfy the scan.
    //
    // NOTE WHAT IS AND IS NOT ASSERTED HERE. The COMMENT is blanked. The string
    // CONTENT on that same line is deliberately PRESERVED — that is the contract
    // the dispatch predicates depend on, and `ws7RouteAuthCoverageGuard` pins this
    // exact fixture as `.not.toContain("// gone")`, not as a missing `requireAuth(`.
    // The consequence — a gate name inside a string literal is still visible to a
    // naive substring scan — is handled where it belongs, by not letting a string
    // literal count as a call site, and is asserted there.
    const view = stripComments('  const gate = "requireAuth(" // gone\n  const keep = 1')
    expect(view, "a real trailing comment must be blanked").not.toContain("// gone")
    expect(view).toContain("const keep = 1")
  })

  it("THE REGRESSION: a gate on a URL-default line is still visible to the scan", () => {
    // Stated as the historical failure, because a fixture that only proves the
    // happy path is how the original bug survived. The old `//`-only stripper
    // produced ZERO call sites here and every predicate in the file passed.
    const view = stripComments(
      '  const home = "http://localhost:5173"; if (!(await verifyUser(auth)) && (await hasUsers())) return 401'
    )
    expect(view, "hasUsers( was blanked — the scan would pass vacuously").toContain("hasUsers(")
    expect(view).toContain("verifyUser(")
  })

  it("does not read division-after-a-closed-string as a regex literal", () => {
    // The second vacuous-pass shape, reached by a different road. A `/` after a
    // CLOSED STRING is division, but the previous character is a quote, which is
    // not a value-ender — so a backward-looking lexer reads the division as a
    // regex, blanks forward to the next `/` on the line, and takes the gate with
    // it. Tracking the last significant token is what makes this correct.
    const view = stripComments('  const v = "b" / (a); if (!(await requireAuth(req, res))) return true')
    expect(view, "requireAuth( was blanked by a misread division").toContain("requireAuth(")
  })

  it("a regex literal is blanked as DATA, and does not swallow the rest of the line", () => {
    // A regex body is not code. Blanking it is deliberate — it is what makes the
    // three `path.match(/^\/api\/…/)` routes enumerable instead of accidentally
    // matching on their own pattern text. But the code AFTER it must survive, or
    // the blanking has become the same vacuous pass wearing a different hat.
    const view = stripComments('  const m = path.match(/^\\/api\\/connectors\\/[^/]+$/); const gate = 401')
    expect(view, "the regex body must not be readable as code").not.toContain("api/connectors")
    expect(view, "code after the regex literal was swallowed").toContain("const gate = 401")
  })

  it("a `/` sequence inside a regex cannot open a comment", () => {
    // `/^\\/api\\//` ends in a backslash-slash-slash. A stripper with no regex
    // branch reads that trailing `//` as a line comment and deletes the rest of
    // the line — which is how the probe's own first regex-pair lexer lost 24 of
    // the 62 real `owner: "decision"` rows.
    const view = stripComments("  const re = /^\\/api\\//; const keep = 1")
    expect(view, "code after the regex was blanked as a comment").toContain("const keep = 1")
  })

  it("preserves length and line count EXACTLY, so file:line findings stay aligned", () => {
    const src = [
      "/* a",
      "   multi-line",
      "   block */",
      'const u = "http://x.invalid" // trailing',
      "const m = /re[/]gex/",
      "// whole line",
      "const end = 1"
    ].join("\n")
    const view = stripComments(src)
    expect(view.length, "length changed, so a column offset would point at the wrong token").toBe(src.length)
    expect(view.split("\n")).toHaveLength(src.split("\n").length)
    expect(view).toContain("const end = 1")
  })

  it("a block comment that never closes blanks to EOF rather than deleting code", () => {
    // The probe's original defect was a stripper that DELETED real code. Blanking
    // to end-of-file is the conservative failure; deleting is not available.
    const view = stripComments("const keep = 1\n/* unterminated\nconst after = 2")
    expect(view).toContain("const keep = 1")
    expect(view.split("\n")).toHaveLength(3)
  })
})

describe("the shared NON_PRODUCTION vocabulary — one home, and count-neutral", () => {
  it("the two former declarations are gone; the vocabulary has one owner", () => {
    expect(read("apps/dashboard/server/__tests__/importResolutionGuard.test.mjs")).not.toMatch(
      /const\s+NON_PRODUCTION\s*=\s*\//
    )
    // The probe builds its Set from the shared array rather than a literal list.
    const probe = read("scripts/ws7-seam-probe.mjs")
    expect(probe).toContain("new Set(NON_PRODUCTION_SEGMENTS)")
    expect(probe).not.toMatch(/new Set\(\["__tests__"/)
  })

  it("is FROZEN, so a consumer cannot mutate the shared rule for everyone", () => {
    expect(Object.isFrozen(NON_PRODUCTION_SEGMENTS)).toBe(true)
    expect(NON_PRODUCTION_SEGMENTS.length).toBeGreaterThan(0)
  })

  it("the merge is COUNT-NEUTRAL — proved by corpus equality, not by argument", () => {
    // The direct form of the claim, and the one that matters: run `productionFiles`
    // with the probe's OLD literal vocabulary and with the SHARED vocabulary over
    // the same tracked tree, and require the two corpora to be identical, element
    // for element and in order. If the merge had widened or narrowed the probe's
    // reach by even one file, this fails.
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
      .split(/\r?\n/)
      .filter(Boolean)

    const OLD_PROBE_SEGMENTS = new Set(["__tests__", "fixtures", "node_modules", "dist", "build", ".playwright-tmp"])
    const withOldVocabulary = tracked.filter((f) => {
      if ([...OLD_PROBE_SEGMENTS].some((s) => f.includes(`/${s}/`) || f.endsWith(`/${s}`))) return false
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f)) return false
      if (["scripts/ws7-seam-probe.mjs", "scripts/ws7-seam-guard.mjs"].includes(f)) return false
      return /^(apps\/dashboard\/server\/.+\.mjs|apps\/dashboard\/src\/.+\.[cm]?[jt]sx?|scripts\/.+\.mjs|agents\/.+\.py)$/.test(f)
    })

    expect(productionFiles(tracked)).toEqual(withOldVocabulary)
    expect(productionFiles(tracked).length).toBeGreaterThan(100)
  })

  it("no tracked path sits under a segment that is NEW to either consumer", () => {
    // Which segments are actually at risk from the merge. `__tests__`, `fixtures`,
    // `node_modules`, `dist` and `build` were in BOTH old declarations, so they
    // cannot change any scan; only the five below were new to one side or the
    // other. Getting this list wrong is how a "count-neutral" merge quietly stops
    // being neutral, so it is written out rather than derived from the union.
    const DIFFERENTIAL = ["coverage", ".next", ".plasmo", "__mocks__", ".playwright-tmp"]
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
      .split(/\r?\n/)
      .filter(Boolean)
    const affected = tracked.filter((f) => isNonProductionPath(f) && DIFFERENTIAL.some((s) => f.includes(`/${s}/`)))
    expect(
      affected,
      `tracked paths now sit under a newly-shared skip segment, so a scan would lose files: ${affected.join(", ")}`
    ).toEqual([])
  })

  it("the union is the union of what the two declarations used to hold — nothing dropped", () => {
    // Stated positively: the shared list is a superset of BOTH former lists, so the
    // merge could not have silently narrowed either guard's exclusions.
    const OLD_PROBE = ["__tests__", "fixtures", "node_modules", "dist", "build", ".playwright-tmp"]
    const OLD_TEST_SIDE = [
      "node_modules",
      "build",
      "dist",
      "coverage",
      ".next",
      ".plasmo",
      "__tests__",
      "__mocks__",
      "fixtures"
    ]
    for (const segment of [...OLD_PROBE, ...OLD_TEST_SIDE]) {
      expect(NON_PRODUCTION_SEGMENTS, `${segment} was dropped in the merge`).toContain(segment)
    }
    // The `__tests__` segment is genuinely populated, so the count-neutrality claim
    // above is not passing merely because the predicate matches nothing at all.
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
      .split(/\r?\n/)
      .filter(Boolean)
    expect(tracked.filter((f) => isNonProductionPath(f)).length).toBeGreaterThan(300)
  })

  it("`productionFiles()` still applies ITS OWN extra conditions on top", () => {
    // Shared vocabulary, unshared scope. The probe additionally drops tests and
    // the two detector files and restricts itself to four trees; if that
    // collapsed into the shared predicate the probe would start scanning files it
    // has never scanned.
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
      .split(/\r?\n/)
      .filter(Boolean)
    const prod = productionFiles(tracked)
    expect(prod.length).toBeGreaterThan(100)
    expect(prod.some((f) => f.startsWith("scripts/"))).toBe(true)
    expect(prod.some((f) => f.includes("__tests__"))).toBe(false)
    expect(prod.some((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))).toBe(false)
    expect(prod).not.toContain("scripts/ws7-seam-probe.mjs")
    expect(prod).not.toContain("scripts/ws7-seam-guard.mjs")
    // Not a widening: the probe's corpus is bounded by the same tree filter as
    // before, so the shared vocabulary cannot have grown it.
    expect(prod.every((f) => /^(apps\/dashboard\/server\/|apps\/dashboard\/src\/|scripts\/|agents\/)/.test(f))).toBe(true)
  })
})
