/**
 * THE ONE COMMENT LEXER, AND THE ONE NON-PRODUCTION VOCABULARY.
 *
 * Both of these used to be re-declared independently at four sites:
 *
 *   apps/dashboard/server/__tests__/importResolutionGuard.test.mjs
 *   apps/dashboard/server/__tests__/ws7AuthBootstrapGateGuard.test.mjs
 *   apps/dashboard/server/__tests__/ws7RouteAuthCoverageGuard.test.mjs
 *   scripts/ws7-seam-probe.mjs
 *
 * Four homes for one rule is three chances to drift, and the drift was not
 * hypothetical: `ws7AuthBootstrapGateGuard.test.mjs` and
 * `ws7RouteAuthCoverageGuard.test.mjs` each shipped a lexer that blanked a
 * legitimate one-line gate from the `//` of a `https://` string default onward,
 * leaving the scan with ZERO call sites and every predicate in the file passing
 * VACUOUSLY. A guard that a real coding style can switch off is not a guard, so
 * the two grew the lexer below and then one of them was copy-pasted into the
 * other - prose included - which is duplication with the defect already merged.
 *
 * WHY IT LIVES HERE AND NOT IN THE TESTS. This module is consumed from BOTH
 * trees, and the mechanism is the one `server/scripts/absence-scope.mjs` already
 * established: a vitest file under `server/__tests__/` reaches it as
 * `../scripts/guard-primitives.mjs`, and a plain script under `scripts/` reaches
 * it as `../apps/dashboard/server/scripts/guard-primitives.mjs`. Both are plain
 * relative ESM specifiers, so there is no build step, no path alias and no
 * workspace coupling between the two trees.
 *
 * IT IS ONE FUNCTION, NOT FOUR COPIES. `sharedCommentLexer.test.mjs` imports
 * this module and each of the four consumers and asserts the five bindings are
 * `Object.is`-identical. A copy would fail that assertion, which is the point:
 * the whole defect class here is a second implementation that agrees with the
 * first until it does not.
 *
 * NOT A RE-EXPORT OF A COPY. `scripts/ws7-seam-guard.mjs` and
 * `scripts/ws7-seam-probe.mjs` both take `stripComments` from HERE, by import.
 * Neither declares one.
 */

/**
 * The directories whose comments and strings are DATA, not production code.
 *
 * ONE list, because the two declarations this replaced disagreed with each
 * other. The test-side list carried `coverage`, `.next`, `.plasmo` and
 * `__mocks__`; the probe-side list carried `.playwright-tmp`. A directory added
 * to one was silently absent from the other, which is the same
 * rule-in-two-homes defect as the lexer above, one level down.
 *
 * The union is COUNT-NEUTRAL on this tree, and that is asserted rather than
 * assumed: `git ls-files` returns zero paths under any of these segments, so
 * widening either consumer's vocabulary cannot move a single scanned file. The
 * assertion lives in `sharedCommentLexer.test.mjs`.
 *
 * Each consumer keeps its OWN additional conditions. `productionFiles()` also
 * excludes `*.test.*`/`*.spec.*`, excludes the two detector files, and restricts
 * itself to four trees; `importResolutionGuard.test.mjs` scans every tracked
 * source file it can see. Only the directory vocabulary is shared, because only
 * the directory vocabulary was duplicated.
 */
export const NON_PRODUCTION_SEGMENTS = Object.freeze([
  "__tests__",
  "__mocks__",
  "fixtures",
  "node_modules",
  "coverage",
  "dist",
  "build",
  ".next",
  ".plasmo",
  ".playwright-tmp"
])

/** True when any path SEGMENT of `rel` is in {@link NON_PRODUCTION_SEGMENTS}. */
export function isNonProductionPath(rel) {
  return NON_PRODUCTION_SEGMENTS.some((segment) =>
    new RegExp(`(?:^|/)${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`).test(rel)
  )
}

/**
 * Strip comments from JS/TS source, preserving everything a source-level guard
 * needs to line its findings up with the file on disk.
 *
 * STRING-AWARE, AND THAT IS LOAD-BEARING RATHER THAN DECORATION. A stripper that
 * only knows `//` and `/*` blanks from the `//` onward INCLUDING text inside a
 * string literal. `handlers.mjs` has real lines that put a URL default beside
 * route logic - the Stripe success/cancel defaults and the 5173 origin default -
 * so this is not a contrived spelling. The one-line gate
 *
 *     const home = "http://localhost:5173"; if (!(await verifyUser(auth)) && (await hasUsers())) return 401
 *
 * was blanked from the `//` onward by such a stripper, so the scan found ZERO
 * `hasUsers(` sites and every predicate in the file passed VACUOUSLY.
 *
 * STRING CONTENTS ARE DELIBERATELY PRESERVED - only the LEXING is string-aware -
 * because the dispatch predicates need to see the `"/api/health"` and
 * `"/api/connectors"` literals in the code view. That is only safe because no
 * string literal in these files contains something that reads as a call site,
 * which is asserted by the guards rather than assumed.
 *
 * REGEX LITERALS ARE BLANKED, and that is also deliberate: a regex body is not
 * code, so its contents must not be scanned as code. The connectors-route
 * enumeration depends on this - the three `path.match(/^\/api\/connectors/...)`
 * routes are invisible to a scan that reads the regex body, which is exactly
 * the blind spot an ungated sibling passed through.
 *
 * DIVISION IS NOT A REGEX, and getting that wrong is the same vacuous pass by
 * another road. A `/` immediately after a CLOSED STRING is division, but the
 * previous character is a quote, and a quote is not in the `[\w$)\]}.]`
 * value-ender set - so a lexer that decides by looking BACKWARDS through its
 * output reads that division as the start of a regex literal and blanks forward
 * to the next `/` ON THE LINE, taking a real gate with it. Tracking the kind of
 * the last significant token consumed makes this the actual JS rule instead: after
 * a complete value, `/` is division. Given
 *
 *     const v = "b" / (a); if (!(await requireAuth(req, res))) return true
 *
 * a backward scan blanked away `requireAuth()` and left the scan with zero call
 * sites. The predicate was not wrong; it was switched off, silently, by a
 * legitimate coding style.
 *
 * LENGTH AND LINE NUMBERS ARE PRESERVED EXACTLY: a comment is blanked to spaces,
 * never deleted, and `\n` is never blanked. Every consumer in this repository
 * reports findings as `file:line`, and a stripper that shifted offsets would make
 * every one of those reports point at the wrong line while still looking green.
 *
 * @param {string} src Raw source text.
 * @returns {string} The same text with comment spans blanked to spaces.
 */
export function stripComments(src) {
  const s = String(src)
  const out = s.split("")
  let i = 0
  /**
   * The kind of the last SIGNIFICANT thing consumed: "value" if it could end a
   * value, "op" otherwise, null before anything has been consumed.
   */
  let prev = null
  const regexAllowed = () => prev !== "value"
  const blank = (from, to) => {
    for (let k = from; k < to && k < s.length; k += 1) if (s[k] !== "\n") out[k] = " "
  }
  while (i < s.length) {
    const ch = s[i]
    const two = s.slice(i, i + 2)
    if (ch === "/" && two === "/*") {
      const end = s.indexOf("*/", i + 2)
      const stop = end === -1 ? s.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    if (ch === "/" && two === "//") {
      const nl = s.indexOf("\n", i)
      const stop = nl === -1 ? s.length : nl
      blank(i, stop)
      i = stop
      continue
    }
    if (ch === "/" && regexAllowed()) {
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < s.length) {
        const c = s[j]
        if (c === "\\") {
          j += 2
          continue
        }
        if (c === "\n") break
        if (c === "[") inClass = true
        else if (c === "]") inClass = false
        else if (c === "/" && !inClass) {
          j += 1
          closed = true
          break
        }
        j += 1
      }
      // An unterminated `/` was division after all: leave the line intact rather
      // than blanking the remainder of the file on a bad guess.
      if (closed) {
        blank(i, j)
        i = j
        prev = "value"
        continue
      }
      i += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // Scanned past WITHOUT being blanked, so a `//` inside is not a comment.
      let j = i + 1
      while (j < s.length) {
        if (s[j] === "\\") {
          j += 2
          continue
        }
        if (s[j] === ch) break
        if (ch !== "`" && s[j] === "\n") break
        j += 1
      }
      i = j + 1
      // A string literal is a complete value, so the next `/` is division. This
      // is the case the old backward scan got wrong.
      prev = "value"
      continue
    }
    // A value-ender means the next `/` is division; anything else leaves an
    // operator position, where a regex literal may legitimately open.
    if (ch !== " " && ch !== "\t" && ch !== "\r" && ch !== "\n") {
      prev = /[\w$)\]}]/.test(ch) ? "value" : "op"
    }
    i += 1
  }
  return out.join("")
}
