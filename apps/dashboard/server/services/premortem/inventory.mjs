import { stripComments } from "../../scripts/guard-primitives.mjs"

// Pre-mortem planner — the derived guard inventory (W3-05, Task 2).
//
// WHAT THIS IS. The list of guard test files that ACTUALLY EXIST, derived by
// asking the repository rather than by remembering it. `verify.mjs` (Task 3) diffs
// the catalog's `claim` strings against what comes out of here, so the difference
// between a mode that is guarded and a mode whose guard was renamed last Tuesday
// is a fact rather than an opinion.
//
// WHY IT IS DERIVED RATHER THAN LISTED. Design spec section 3: "No hardcoded
// consumer list: a hand-maintained list is precisely the defect this planner
// exists to catch, so the planner must not reproduce it." SHIP-2 in the catalog is
// this exact defect — a guard's frozen consumer array omitted a file, so the
// omitted file was invisible to the guard meant to police it. An inventory that
// named its guards in source would inherit that failure with extra steps: adding a
// guard would require remembering to add it here, and forgetting is silent.
//
// THE VACUITY THIS EXISTS TO END. `ws7TestStoreIsolation` once passed GREEN on a
// test file git could not see, because it enumerated tracked files with
// `git ls-files` and the file had never been committed. A guard nobody can see is
// not a passing guard; it is a guard-shaped file. So EVERY path below is one the
// injected `listTrackedFiles` returned, and a file that is not in that list is
// never read, never counted and never reported — not even if its content would
// have looked exactly like a guard.
//
// ADVISORY ONLY, AND PURE. No store, no network, no `process.env`, no clock, no
// import of any other service. `git ls-files` is reached ONLY through the injected
// `listTrackedFiles` and file content ONLY through the injected `readFile`, so
// this module has no filesystem access of its own to leak. Its single import is
// `stripComments`, a pure string function in `server/scripts/guard-primitives.mjs`
// that imports nothing — and re-implementing a comment lexer here would be the
// very four-copies defect that module was created to end (see its own header).
//
// THREE HONEST STATES, AND NONE OF THEM IS A DEFAULT. `guards` is what exists and
// was read. `unreadable` is what exists and could not be read, or could not be
// read from inside the repository at all. What a caller cannot see is ABSENT,
// which is never reported as present.

/**
 * The separator between a claim's repository-relative path and its `describe`/`it`
 * title, per design spec section 3.
 *
 * EXPLICIT RATHER THAN A BARE SPACE, because a repository-relative path may itself
 * contain spaces. Splitting at the first occurrence keeps the suffix intact even
 * when the suffix contains the separator, and keeps a path that contains spaces
 * whole — which a split-on-first-space could not do.
 *
 * The trailing space is part of the contract, not leniency around it: a claim
 * ending in a bare `" ::"` with nothing after it does NOT split, because that is
 * not the separator.
 */
export const CLAIM_SEPARATOR = " :: "

/**
 * The suffix a tracked path must carry to be a candidate guard.
 *
 * THIS CONSTANT IS ALSO THE SCOPE DECLARATION, and a later resolver needs it as
 * one. A claim path ending in some other test extension is not merely "not found"
 * — it is outside what this inventory was built to examine, and a caller must be
 * able to say so rather than report a guard as missing. 115 tracked non-`.mjs`
 * tests exist in this repository (49 `.ts` + 66 `.tsx`), so the distinction is
 * not theoretical.
 *
 * `.mjs` only, deliberately. This module is Node 22 ESM, it is reached from a
 * server service, and every claim in the catalog is an `.mjs` file; the frontend
 * `.tsx` suites are not guards of this service.
 *
 * This is a SHAPE, not a list of names. "Ends in `.test.mjs`" is a rule anyone can
 * evaluate; "is `ws7RouteAuthCoverageGuard.test.mjs`" is the defect.
 */
export const GUARD_FILE_SUFFIX = ".test.mjs"

/**
 * A call site whose first argument is a string or template literal.
 *
 * The `(^|[^\w$.])` prefix is what makes this a CALL rather than a word: `it` in
 * `unit(`, `bit(` or a prose sentence ending in `...it"` cannot match, because the
 * preceding character must not continue an identifier. The opening bracket is
 * required too, or the identifier would match text that merely abuts a quote.
 */
const CALL_SITE = /(^|[^\w$.])(describe|it|test)(\s*\(\s*)(["'`])/g

/**
 * A MODIFIER-CHAINED call site — `it.each(…)`, `describe.skip(…)`, `test.only(…)`.
 *
 * Counted, never read. `CALL_SITE` cannot see these because the title follows the
 * chain, so without this count they would contribute nothing at all and a claim on
 * one of them would return `guard-missing` indistinguishable from a genuinely
 * uncovered title. That conflation — "covered by nothing" reading as "nobody
 * looked" — is the exact failure this feature exists to prevent, so the gap is
 * reported as a number instead of being swallowed.
 */
const MODIFIER_CHAIN = /(^|[^\w$.])(describe|it|test)(\s*\.\s*[A-Za-z_$][\w$]*\s*\()/g

/**
 * vitest's assertion entry point.
 *
 * `expect(` and not the matchers. `.toBe`, `.toEqual` and friends hang off one
 * `expect` each, so counting matchers would double-count every chained assertion,
 * and `.not` inverts rather than adds. A guard asserting nothing is reported with
 * `0` rather than omitted — see `guardInventory` for why that distinction matters.
 */
const ASSERTION_CALL = /\bexpect\s*\(/g

/**
 * Does this tracked path name a candidate guard?
 *
 * A SHAPE test, never a membership test. Callers must not read `false` as "this
 * file is not a guard in the sense of being unimportant" — it means "this path is
 * not a path this inventory examines".
 *
 * ONE CONDITION, AND THE `__tests__` SEGMENT IS DELIBERATELY GONE. It used to be
 * required as well, on the reasoning that an unexercised exclusion can silently
 * start excluding real guards. The same reasoning applies to it as to any other
 * exclusion.
 *
 * WHAT CHANGED IS THE AXIS OF STRICTNESS, NOT ITS AMOUNT. vitest's default include
 * is the `{test,spec}.?(c|m)[jt]s?(x)` glob at every depth — repo-relative path
 * `node_modules/vitest/dist/chunks/defaults.D2ip7f-X.js:5`, which spells it with a
 * leading two-star path prefix, reachable from the REPOSITORY ROOT (hoisted
 * install; from `apps/dashboard` there is no local `node_modules/vitest`). That
 * glob imposes NO `__tests__` requirement, which is the whole reason the segment
 * was dropped: requiring one would exclude a file vitest happily collects, and a
 * guard vitest runs but this inventory cannot see is a FALSE MISS — the expensive
 * direction to be wrong in.
 *
 * BUT THIS RULE IS A STRICT SUBSET OF THE RUNNER'S, AND SAYING "IT IS THE RUNNER'S
 * RULE" WOULD BE FALSE. Measured over the tracked tree, that glob collects 443
 * files and `isGuardPath` collects 328 of them. The 115-file gap is entirely
 * extension — 49 `.ts` and 66 `.tsx` — and it includes one SERVER-side test,
 * `apps/dashboard/server/__tests__/ws6-domain.test.ts`, which vitest runs and this
 * inventory cannot name. The strictness simply moved: off the `__tests__` axis,
 * where it was unexercised, onto the extension axis, where it is the declared
 * scope (see `GUARD_FILE_SUFFIX`) and is honestly measurable. A caller that needs
 * the gap stated rather than inferred should read `GUARD_FILE_SUFFIX` and call
 * `isGuardPath` on the claim path before rendering anything about it.
 *
 * @param {unknown} path a repository-relative path as `git ls-files` emits it,
 *   with `/` separators
 * @returns {boolean}
 */
export function isGuardPath(path) {
  if (typeof path !== "string" || path === "") return false
  return path.endsWith(GUARD_FILE_SUFFIX)
}

/**
 * Could this path escape the repository root, or fail to BE one?
 *
 * Controller ruling 5: a path the tracked list yields from outside the repository
 * root is `unreadable`, never a guard. `git ls-files` cannot produce one, so this
 * is defence against a mis-wired caller rather than against git — and the failure
 * it prevents is the worst one available: a caller that resolved paths against the
 * wrong root would have this module read a file outside the repository and report
 * whatever assertions it found as coverage of something else entirely.
 *
 * A BACKSLASH IS REJECTED WHEREVER IT APPEARS, not only in the leading position,
 * and that is the half that was missing. Splitting on `/` alone let
 * `apps/dashboard/server/__tests__/sub\..\..\..\outside.test.mjs` through on the
 * platform where the backslash is the native separator: the `/`-split found no
 * `..` segment, the path escaped, and this module READ it. Rejecting the character
 * outright closes the traversal and the fully-backslash-separated path in one
 * rule, and the latter matters on its own — before this, such a path landed in
 * NEITHER output array, and a path a reader cannot account for is the silence this
 * module exists to eliminate.
 */
function isRepoRelativePath(path) {
  if (path.includes("\0")) return false
  if (path.includes("\\")) return false
  if (path.startsWith("/")) return false
  if (/^[A-Za-z]:/.test(path)) return false
  return !path.split("/").includes("..")
}

/**
 * Split a catalog `claim` into its path and its optional test title.
 *
 * SPLITS AT THE FIRST OCCURRENCE, so a title that itself contains `" :: "` keeps
 * it: `"a/b.test.mjs :: one :: two"` yields the path `a/b.test.mjs` and the title
 * `one :: two`, not three pieces. The suffix is NEVER treated as part of the path,
 * and the path is never truncated at a space.
 *
 * A claim that does not contain the separator is a bare path with `title: null` —
 * a whole file claimed, which is a legitimate claim shape. A claim that is not a
 * non-empty string yields `{ file: null, title: null }`, so a caller that forgets
 * the claim cannot accidentally resolve `null` against the inventory.
 *
 * @param {unknown} claim
 * @returns {{file: string|null, title: string|null}}
 */
export function splitClaim(claim) {
  if (typeof claim !== "string" || claim === "") return { file: null, title: null }
  const at = claim.indexOf(CLAIM_SEPARATOR)
  if (at === -1) return { file: claim, title: null }
  return { file: claim.slice(0, at), title: claim.slice(at + CLAIM_SEPARATOR.length) }
}

/**
 * Every string-literal first argument of a `describe` / `it` / `test` call, in
* source order.
  *
  * THE FIELD NAME IS NARROWER THAN ITS CONTENTS, AND THE CONTENTS ARE THE POINT.
  * `describes` holds the title of every `describe`, `it` AND `test` call, in source
  * order — a superset of describe-block titles. The name was inherited from the
  * brief's interface and kept rather than renamed, because a claim's suffix is an
  * `it` title in every catalog entry that carries one, and a consumer matching a
  * suffix against the superset cannot be surprised by an extra `describe` title.
  * Renaming it to `titles` would say the same thing more honestly; it is a rename
  * no consumer exists to break yet, and it was not made here to keep this round to
  * the reviewed findings.
  *
  * `describes` is the field a later resolver matches a claim's suffix against, so
  * it must carry what the file DECLARES, not what it would evaluate to. A template
  * literal with an interpolation is therefore reported with the `${...}` text
  * intact: resolving it would mean running the file, and a title that only exists
  * after evaluation is not a title anyone can grep for. Measured, 19 call sites
 * across 12 of the tracked guards declare one, so this is a shape a reader meets
  * rather than a theoretical one.
  *
  * COMMENTS ARE BLANKED FIRST, through the one shared lexer, because a guard's
  * header routinely quotes its own `it` titles back to the reader. Counting those
  * would let a guard appear to declare a test it removed.
  *
* WHAT THIS DOES NOT CAPTURE IS COUNTED, NOT SWALLOWED. Modifier-chained titles
 * (`it.each(…)`) follow the chain rather than the call, so `declaredTitles` cannot
 * read them; `unresolvedTitles` counts them instead, because a claim landing on
 * one must be able to report "this extractor did not look" rather than "nothing
 * covers this".
 *
 * MEASURED over the 328 tracked guards this inventory sees: `it.each` 19,
 * `describe.each` 1, `test.each` 1 — 21 modifier-chained CALL sites, which is the
 * tree-wide `unresolvedTitles` sum. Two of those 21 are `it.each(…)` and
 * `describe.each(…)` written inside string literals in THIS TASK'S OWN test
 * fixtures, which is the residual limit below observed in the one file this change
 * controls. `describe.skip` appears in the corpus only as a VALUE
 * (`hyperliquidPerps.sandboxE2E.test.mjs:37`, `ready ? describe : describe.skip`),
 * never as a call, so it declares no title and is not counted — an earlier
 * revision of this comment claimed a `describe.skip` call site that does not exist.
 *
  * ONE RESIDUAL LIMIT, STATED RATHER THAN IMPLIED. One call site in the whole tree
  * sits inside a string literal and contributes a single phantom title;
  * `stripComments` preserves string CONTENT by design (the dispatch predicates
  * depend on it), so it cannot blank that, and closing the gap here would mean a
  * second string lexer in a second home — the exact duplication
  * `guard-primitives.mjs` exists to prevent.
  */
function declaredTitles(view) {
  const titles = []
  for (const match of view.matchAll(CALL_SITE)) {
    const quote = match[4]
    let at = match.index + match[0].length
    let title = ""
    while (at < view.length && view[at] !== quote) {
      if (view[at] === "\\") {
        title += view[at + 1]
        at += 2
        continue
      }
      title += view[at]
      at += 1
    }
    titles.push(title)
  }
  return titles
}

/**
 * One readable guard, read through the injected reader.
 *
 * `text` is a PRECONDITION, not a hint: `guardInventory` has already established
 * that the reader resolved it to a string, and a non-string arriving here would
 * otherwise be coerced into `""` — which is the exact defect fix round 1 removed,
 * because `""` is indistinguishable from "this file really does assert nothing".
 * Coercion is not defensive here; it is how a missing read became a present guard.
 *
 * The entry is FROZEN so a consumer cannot rewrite a guard's assertion count in
 * place and leave every other reader of the inventory seeing the original.
 */
function inspectGuard(file, text) {
  const view = stripComments(text)
  return Object.freeze({
    file,
    describes: Object.freeze(declaredTitles(view)),
    unresolvedTitles: (view.match(MODIFIER_CHAIN) ?? []).length,
    asserts: (view.match(ASSERTION_CALL) ?? []).length
  })
}

/**
 * Derive the real guard inventory from the repository's own tracked file list.
 *
 * ADVISORY. Nothing here verifies a guard CAN FAIL; it reports what a guard file
 * declares and how many assertions it contains, which is a different claim and is
 * never collapsed into one. The design spec keeps them apart — "structural
 * verification is not biting" (section 4, rule 4).
 *
 * ORDER IS LOAD-BEARING AND IS NOT INTERCHANGEABLE. Shape, then containment, then
 * read. A path that is not guard-shaped says nothing about guards and is dropped
 * without being read; a path that IS guard-shaped but is not a repository-relative
 * path is refused without being read and lands in `unreadable`; only what survives
 * both is handed to `readFile`. Running containment first would report unrelated
 * repository paths as unreadable guards and bury the real ones.
 *
 * A READ THAT PRODUCES NOTHING IS `unreadable`, NOT AN EMPTY GUARD (fix round 1,
 * C-1). A missing or non-function `readFile`, a rejection, and a resolution that
 * is not a string all take the same path, because they are the same fact: no
 * content was obtained for this path. The earlier code coerced a missing read to
 * `""`, which turned "nobody read this file" into "this guard asserts nothing" —
 * a fourth invented state in a module whose header promises three, and reachable
 * in production by a map-backed reader whose lookup simply misses, with no throw
 * for the rejection branch to catch. NO EVIDENCE IS NOT EVIDENCE OF NOTHING.
 *
 * ZERO ASSERTIONS IS REPORTED, NOT OMITTED (controller ruling 6) — but ONLY for a
 * file that was actually read. A guard-shaped file with no `expect(` is real
 * information; dropping it would fabricate an absence in the opposite direction
 * from the one this module exists to prevent.
 *
 * OUTPUT IS DETERMINISTIC AND DEDUPED. `git ls-files` never repeats a path, but a
 * mis-wired caller might, and a guard counted twice would double-count its
 * assertions. Both arrays are sorted by path, so two runs over the same tree
 * render identically.
 *
 * @param {object} input
 * @param {() => Promise<ReadonlyArray<string>>} [input.listTrackedFiles] the ONLY
 *   way this module learns what exists; repository-relative paths with `/`
 *   separators, as `git ls-files` emits them. A missing or non-function value is
 *   read as NO EVIDENCE, so the inventory is empty rather than fabricated — but a
 *   value that REJECTS is propagated, because there is no partial listing to
 *   salvage and reporting "nothing found" for a git error is a clean empty readout
 *   lying about why.
 * @param {(path: string) => Promise<string>} [input.readFile] the ONLY way this
 *   module reads content. A missing value, a rejection, and a non-string
 *   resolution are all recorded as `unreadable`; none is ever reported as a guard.
 * @returns {Promise<{guards: ReadonlyArray<{file: string, describes: ReadonlyArray<string>, unresolvedTitles: number, asserts: number}>, unreadable: ReadonlyArray<string>}>}
 */
export async function guardInventory({ listTrackedFiles, readFile } = {}) {
  const listed = typeof listTrackedFiles === "function" ? await listTrackedFiles() : []
  const tracked = Array.isArray(listed) ? listed : []
  const candidates = [...new Set(tracked.filter(isGuardPath))].sort()

  const guards = []
  const unreadable = []
  for (const file of candidates) {
    if (!isRepoRelativePath(file)) {
      unreadable.push(file)
      continue
    }
    let text
    try {
      text = typeof readFile === "function" ? await readFile(file) : undefined
    } catch {
      unreadable.push(file)
      continue
    }
    if (typeof text !== "string") {
      unreadable.push(file)
      continue
    }
    guards.push(inspectGuard(file, text))
  }

  return { guards: Object.freeze(guards), unreadable: Object.freeze(unreadable) }
}