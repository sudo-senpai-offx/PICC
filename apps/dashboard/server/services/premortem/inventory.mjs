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

/** The suffix a tracked path must carry to be a candidate guard. */
export const GUARD_FILE_SUFFIX = ".test.mjs"

/**
 * The path segment a candidate guard must sit under.
 *
 * `.mjs` ONLY, deliberately. This module is Node 22 ESM, it is reached from a
 * server service, and every claim in the catalog is an `.mjs` file; the frontend
 * `.tsx` suites are not guards of this service and are out of scope by
 * construction. The `__tests__` segment is the second half of the same structural
 * rule and costs nothing today: measured over the tracked tree, EVERY `.test.mjs`
 * file already sits under one, so this condition excludes no real guard while
 * still refusing a test-shaped file parked somewhere else.
 *
 * NEITHER CONDITION IS A LIST OF NAMES. "Ends in `.test.mjs`, under `__tests__`"
 * is a shape; "is `ws7RouteAuthCoverageGuard.test.mjs`" is the defect.
 */
export const GUARD_TEST_SEGMENT = "__tests__"

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
 * not a path this inventory examines", which for every path `git ls-files` can
 * actually produce is the same answer.
 *
 * @param {unknown} path a repository-relative path as `git ls-files` emits it,
 *   with `/` separators
 * @returns {boolean}
 */
export function isGuardPath(path) {
  if (typeof path !== "string" || path === "") return false
  return path.endsWith(GUARD_FILE_SUFFIX) && path.split("/").includes(GUARD_TEST_SEGMENT)
}

/**
 * Could this path escape the repository root?
 *
 * Controller ruling 5: a path the tracked list yields from outside the repository
 * root is `unreadable`, never a guard. `git ls-files` cannot produce one, so this
 * is defence against a mis-wired caller rather than against git — and the failure
 * it prevents is the worst one available: a caller that resolved paths against the
 * wrong root would have this module read a file outside the repository and report
 * whatever assertions it found as coverage of something else entirely.
 *
 * Windows drives and UNC paths are caught by the leading-separator test; `..` is
 * caught by segment, so a path that climbs out and comes back is still refused
 * rather than normalised into something that looks safe.
 */
function escapesRepository(path) {
  if (path.includes("\0")) return true
  if (path.startsWith("/") || path.startsWith("\\")) return true
  if (/^[A-Za-z]:/.test(path)) return true
  return path.split("/").includes("..")
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
 * `describes` is the field a later resolver matches a claim's suffix against, so
 * it must carry what the file DECLARES, not what it would evaluate to. A template
 * literal with an interpolation is therefore reported with the `${...}` text
 * intact: resolving it would mean running the file, and a title that only exists
 * after evaluation is not a title anyone can grep for. Measured, 19 call sites
 * across 12 of the 327 tracked guards declare one, so this is a shape a reader
 * meets rather than a theoretical one.
 *
 * COMMENTS ARE BLANKED FIRST, through the one shared lexer, because a guard's
 * header routinely quotes its own `it` titles back to the reader. Counting those
 * would let a guard appear to declare a test it removed.
 *
 * THE BOUND, MEASURED RATHER THAN IMPLIED. This captures the direct `name(`
 * spelling. Over the tracked tree the only modifiers present are `it.each` and
 * `test.each` (19 call sites between them) plus `describe.skip` (1), and those 20
 * sites declare no entry here, because the title follows a modifier chain this
 * does not walk. One call site in the whole tree sits inside a string literal and
 * so contributes a single phantom title; `stripComments` preserves string
 * CONTENT by design (the dispatch predicates depend on it), so it cannot blank
 * that, and closing the gap here would mean a second string lexer in a second
 * home — the exact duplication `guard-primitives.mjs` exists to prevent.
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
 * The entry is FROZEN so a consumer cannot rewrite a guard's assertion count in
 * place and leave every other reader of the inventory seeing the original.
 */
function inspectGuard(file, text) {
  const view = stripComments(typeof text === "string" ? text : String(text ?? ""))
  return Object.freeze({
    file,
    describes: Object.freeze(declaredTitles(view)),
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
 * without being read; a path that IS guard-shaped but escapes the repository is
 * refused without being read and lands in `unreadable`; only what survives both is
 * handed to `readFile`. Running containment first would report unrelated
 * repository paths as unreadable guards and bury the real ones.
 *
 * ZERO ASSERTIONS IS REPORTED, NOT OMITTED (controller ruling 6). A guard-shaped
 * file with no `expect(` is real information — it asserts nothing — and dropping it
 * would fabricate an absence in the opposite direction from the one this module
 * exists to prevent.
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
 *   read as NO EVIDENCE, so the inventory is empty rather than fabricated.
 * @param {(path: string) => Promise<string>} [input.readFile] the ONLY way this
 *   module reads content. Every rejection is caught and recorded as `unreadable`;
 *   this module never propagates a read failure as a guard.
 * @returns {Promise<{guards: ReadonlyArray<{file: string, describes: ReadonlyArray<string>, asserts: number}>, unreadable: ReadonlyArray<string>}>}
 */
export async function guardInventory({ listTrackedFiles, readFile } = {}) {
  const listed = typeof listTrackedFiles === "function" ? await listTrackedFiles() : []
  const tracked = Array.isArray(listed) ? listed : []
  const candidates = [...new Set(tracked.filter(isGuardPath))].sort()

  const guards = []
  const unreadable = []
  for (const file of candidates) {
    if (escapesRepository(file)) {
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
    guards.push(inspectGuard(file, text))
  }

  return { guards: Object.freeze(guards), unreadable: Object.freeze(unreadable) }
}