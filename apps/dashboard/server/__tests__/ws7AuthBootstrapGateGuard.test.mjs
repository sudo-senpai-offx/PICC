// WS-7 AUTH-FAILOPEN CI guard — the first-user bootstrap bypass must not regrow
// as a `hasUsers()` call in gate shape anywhere in handlers.mjs.
//
// WHY THIS IS A RUNNING TEST AND NOT A COMMENT. The /api/auth/me fix and the
// requireAuth fix were each correct, and the defect class was still live in
// fourteen more routes, each carrying its own copy of
//
//     if (!(await verifyUser(auth)) && (await hasUsers())) return 401
//
// which is fail-OPEN because hasUsers() answers false for both "no accounts
// exist" and "users.json is unreadable". A reviewer read that deferral as
// "procedurally defensible, substantively wrong". Per-site fixes do not survive
// the fifteenth site; only an enforced invariant does.
//
// THE SITES ARE DISCOVERED BY SCANNING, NEVER LISTED. Nothing here hardcodes a
// line number or a path. Every `hasUsers` occurrence in the file is found, and
// each one must EITHER
//
//   (a) appear in a GATE — inside a requireSessionOrFirstRun(...) call, or be
//       the strict firstRunBootstrapAllowed() answer itself — or
//   (b) carry a NOT A GATE comment in the same statement region saying why it
//       makes no authorisation decision.
//
// A guard that only knew the fourteen repaired line numbers would pass the
// moment somebody wrote a fifteenth, which is the whole failure being guarded
// against. The scan-set is proved real below rather than assumed.
//
// THE ALLOWLIST USES THE ALLOWLIST-WITH-REASON PATTERN OF THE D26/ENCODING
// GUARDS. A bare marker is not an allowance: every entry carries a written
// reason, and a stale entry — one whose call site has moved or been removed —
// is itself a failure. That way the next person who hits a genuine false
// positive has to write down WHY, instead of hardcoding an `if` into the
// detector, which is how a guard quietly stops being a guard.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url))
const HANDLERS_REL = "apps/dashboard/server/handlers.mjs"
const HANDLERS = fileURLToPath(new URL("../handlers.mjs", import.meta.url))

// The strict helper every gate must reach, and the lenient reader it replaces.
const STRICT_HELPER = "firstRunBootstrapAllowed"
const GATE_CALL = "requireSessionOrFirstRun"
const LENIENT = "hasUsers"

/**
 * A call site on a non-gate, with the reason it is not an authorisation
 * decision. Both repaired sites are here so the list cannot rot: if either is
 * ever deleted, `reasons stay honest` fails, because the entry's marker text
 * disappears from the source.
 */
const ALLOWLIST = [
  {
    marker: "NOT A GATE. This is preference-key SELECTION",
    anchor: "const hasAccts = await hasUsers()",
    reason:
      "chart-source preference key selection. Picks whose saved pin to read; both branches " +
      "collapse to the same \"default\" key, the whole block is inside a try/catch with a plain " +
      "\"auto\" fan-in fallback, and it sits behind no authorisation decision of its own. Routing " +
      "it through the strict helper would only throw into a catch that already swallows it, while " +
      "making the block look like a security boundary."
  },
  {
    marker: "NOT A GATE. hasUsers() here is the first-run SIGNUP HINT",
    anchor: "hasUsers: await hasUsers()",
    reason:
      "/api/auth/status first-run signup hint. Discloses no account data and authorises nothing; it " +
      "only tells the login page whether to offer the signup form. A degraded read here shows a " +
      "recoverable extra signup prompt, whereas the opposite error would hide signup from a genuinely " +
      "fresh install, so the lenient answer is the right one for a hint."
  }
]

/**
 * The same source with every comment's CONTENT blanked out, line for line.
 *
 * Needed because this file's own subject appears in prose. handlers.mjs
 * documents the defect it just fixed — including the literal expression
 * `!(await verifyUser(auth)) && (await hasUsers())` — and a scan that read
 * comment text would report the documentation as an unfixed call site forever.
 * Line numbers are preserved so a code offset still points at the right row.
 *
 * STRING-AWARE, and that is load-bearing rather than decoration. A stripper that
 * only knows `//` and `/*` blanks from the `//` onward INCLUDING text inside a
 * string literal. handlers.mjs already has 13 lines containing a quoted `//`,
 * three of which put a URL default on the same line as route logic (the Stripe
 * success/cancel defaults and the 5173 origin default). That is not a contrived
 * spelling. A one-line gate naming a home URL
 *
 *     const home = "http://localhost:5173"; if (!(await verifyUser(auth)) && (await hasUsers())) return 401
 *
 * was blanked from the `//` onward, so the scan found ZERO `hasUsers(` sites and
 * every predicate in this file passed VACUOUSLY. A guard a real code style can
 * switch off is not a guard.
 *
 * String CONTENTS are deliberately PRESERVED (only the lexing is string-aware),
 * because the connectors-route predicate below needs to see the `"/api/connectors"`
 * literal in the code view. That is only safe if no string literal in the file
 * contains something that looks like a call site — asserted by a test below, so
 * the decision cannot rot into a phantom finding.
 *
 * The regex branch is defensive hardening, NOT a fix for a demonstrated failure:
 * a regex literal cannot contain a bare `//`, because each slash is either the
 * delimiter or escaped. It exists so the new lexer does not mistake `/^\/api\//`
 * for the start of a comment and blank the rest of the file.
 */
function stripComments(src) {
  const out = src.split("")
  let i = 0
  /**
   * The kind of the last SIGNIFICANT thing consumed: "value" if it could end a
   * value, "op" otherwise, null before anything has been consumed.
   *
   * Tracked explicitly instead of by looking BACKWARDS through `out`. The
   * backward scan was unsound in a way that silently disabled the entire file.
   * A `/` immediately after a CLOSED STRING is division, but the previous
   * character is a quote, and a quote is not in the old `[\w$)\]}.]`
   * value-ender set — so the lexer read the division as the start of a regex
   * literal and then blanked forward to the next `/` ON THE LINE. Given a real
   * one-line gate
   *
   *     const v = "b" / (a); if (!(await verifyUser(auth)) && (await hasUsers())) return 401
   *
   * that blanked away `verifyUser()` and `hasUsers()`, leaving the scan with
   * ZERO call sites — and a guard that finds zero sites passes vacuously. The
   * predicate was not wrong; it was switched off, silently, by a legitimate
   * coding style. Tracking the kind of the consumed token makes this the actual
   * JS rule: after a complete value, `/` is division.
   */
  let prev = null
  const regexAllowed = () => prev !== "value"
  const blank = (from, to) => {
    for (let k = from; k < to && k < src.length; k += 1) if (src[k] !== "\n") out[k] = " "
  }
  while (i < src.length) {
    const ch = src[i]
    const two = src.slice(i, i + 2)
    if (ch === "/" && two === "/*") {
      const end = src.indexOf("*/", i + 2)
      const stop = end === -1 ? src.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    if (ch === "/" && two === "//") {
      const nl = src.indexOf("\n", i)
      const stop = nl === -1 ? src.length : nl
      blank(i, stop)
      i = stop
      continue
    }
    if (ch === "/" && regexAllowed()) {
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < src.length) {
        const c = src[j]
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
      // An unterminated `/` was division after all: leave the line intact
      // rather than blanking the remainder of the file on a bad guess.
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
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2
          continue
        }
        if (src[j] === ch) break
        if (ch !== "`" && src[j] === "\n") break
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

const SRC = readFileSync(HANDLERS, "utf8")
const CODE = stripComments(SRC)

/**
 * Every `hasUsers(` CALL SITE, discovered by scanning CODE.
 *
 * Two views are captured per site:
 *   `text`  — the call site's own line, trimmed, from CODE.
 *   `above` — the CONTIGUOUS run of comment/blank lines IMMEDIATELY above it,
 *              from the ORIGINAL source, because the "this is not a gate"
 *              justification is a comment and the scan must be able to see it.
 *
 * `above` is deliberately a contiguous block and NOT a window. An earlier
 * version of this file matched the marker anywhere in a 12-line window, which is
 * a proximity rule: copy an allowlist entry's marker onto a real gate and the
 * gate is excused. Two tests below plant exactly that and require a rejection.
 *
 * The 12-line `window` is STILL COMPUTED and STILL EXISTS, and saying otherwise
 * would be its own kind of unevidenced claim. What changed is that it no longer
 * reaches the verdict: isAccepted() reads `above` and `text` only. The window now
 * backs isGate(), which is MESSAGE-ONLY, and it is used to build better failure
 * text and to assert that a justification comment is in reach. So the precise
 * statement is "the window was removed from the VERDICT", not "the window was
 * removed" — a rule that is sound for labelling and unsound for deciding is
 * exactly why the two are kept apart.
 */
function scanCallSites(code, original = code) {
  const codeLines = code.split("\n")
  const originalLines = original.split("\n")
  const isCommentish = (text) => {
    const t = text.trim()
    return t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
  }
  const sites = []
  for (let i = 0; i < codeLines.length; i += 1) {
    const line = codeLines[i]
    if (!new RegExp(`\\b${LENIENT}\\s*\\(`).test(line)) continue
    const from = Math.max(0, i - 12)
    let top = i
    while (top - 1 >= 0 && isCommentish(originalLines[top - 1])) top -= 1
    sites.push({
      line: i + 1,
      text: line.trim(),
      above: originalLines.slice(top, i).join("\n"),
      window: originalLines.slice(from, i + 2).join("\n")
    })
  }
  return sites
}

const SITES = scanCallSites(CODE, SRC)

/**
 * The specifiers of the `./services/auth.mjs` import clause, as WRITTEN.
 *
 * A count over `resolveHasUsers(` call sites cannot see which binding that name
 * resolves to. `import { hasUsers as resolveHasUsers }` leaves the count
 * perfectly satisfied — still exactly one `resolveHasUsers(` call — while every
 * gate silently reads the LENIENT reader, and `!lenient()` is precisely the
 * fail-open inversion this guard exists to prevent. The import CLAUSE has to be
 * pinned, not just the count of call sites.
 */
function authImportSpecifiers(src) {
  const clause = src.match(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*services\/auth\.mjs["']/)
  if (!clause) return null
  return clause[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

const AUTH_SPECIFIERS = authImportSpecifiers(CODE)

/**
 * Every string literal's CONTENTS, in source order, by a LINEAR scan.
 *
 * Comments are skipped so a quote inside one is not mistaken for a string. A
 * regex literal is NOT skipped, so a quote inside a character class can
 * manufacture a phantom literal; that errs toward a false FAILURE here, which is
 * the safe direction for a check whose whole job is to notice.
 *
 * Replaces /(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, which had two defects. `[^\\\n]`
 * cannot cross a newline, so a multi-line template literal was never inspected
 * at all — and a template literal is the natural place to paste a long readable
 * call-site shape. And the nested alternation-with-star is the classic
 * backtracking shape, so a long non-matching run was needlessly slow.
 */
function stringLiteralContents(src) {
  const found = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const two = src.slice(i, i + 2)
    if (ch === "/" && two === "/*") {
      const end = src.indexOf("*/", i + 2)
      i = end === -1 ? src.length : end + 2
      continue
    }
    if (ch === "/" && two === "//") {
      const nl = src.indexOf("\n", i)
      i = nl === -1 ? src.length : nl
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch
      let j = i + 1
      let body = ""
      while (j < src.length) {
        if (src[j] === "\\") {
          body += src[j] + (src[j + 1] ?? "")
          j += 2
          continue
        }
        if (src[j] === quote) break
        // A plain quoted string cannot span lines. If one appears to, stop at the
        // newline rather than running to EOF and inventing a huge literal.
        if (quote !== "`" && src[j] === "\n") break
        body += src[j]
        j += 1
      }
      found.push(body)
      i = j + 1
      continue
    }
    i += 1
  }
  return found
}

/**
 * Does an accepted site FEED a refusal one hop down the block?
 *
 * The marker+anchor verdict judges a line. It cannot see what that line's RESULT
 * is used for afterwards, and this is the escape that proves it. Planted:
 *
 *     // <an allowlist entry's marker>
 *     const hasAccts = await hasUsers()
 *     if (!hasAccts) return writeJson(res, 401, { error: "authentication required" })
 *
 * Every part of that passes the existing checks — the marker sits on the site's
 * own contiguous comment block, and `hasUsers()` is the site's exact anchor — and
 * the route is still a bootstrap bypass that a store fault satisfies, because
 * `!hasUsers()` cannot tell a genuine empty store from an unreadable one.
 *
 * Only the assignable shape is covered, which is the common one. The aliasing
 * escapes are NOT, and are listed under KNOWN LIMITATIONS.
 */
function siteFeedsRefusal(codeLines, index) {
  const assigned = codeLines[index].match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?\bhasUsers\s*\(/
  )
  if (!assigned) return null
  const name = assigned[1]
  const nameRe = new RegExp(`\\b${name}\\b`)
  for (let k = index + 1; k < codeLines.length; k += 1) {
    if (!nameRe.test(codeLines[k])) continue
    if (/\b40[13]\b/.test(codeLines[k])) return `handlers.mjs:${k + 1}  ${codeLines[k].trim()}`
  }
  return null
}

/**
 * KNOWN LIMITATIONS — escapes this guard does NOT close.
 *
 * Listed rather than asserted away, because a guard that claims more than it
 * enforces is worse than one that admits its edge: the false claim is what let a
 * fail-open route through in the first place. Each is a deliberate, accepted gap
 * with the reason it is not closed here.
 *
 * 1. A REFERENCE TO hasUsers() TAKEN WITHOUT A CALL IS INVISIBLE. Every scan in
 *    this file counts or anchors on the call `hasUsers(`, so these are all
 *    invisible to all of them:
 *
 *        const h = hasUsers;  await h()
 *        const { hasUsers: h } = svc;  await h()
 *        hasUsers?.()
 *        hasUsers.call(null)
 *
 *    Closing this needs real scope analysis — tracking every binding a function
 *    object reaches — which is a parser, not a grep. It is NOT attempted here,
 *    because a half-measure that looks like coverage is the failure mode this
 *    file exists to prevent.
 *
 *    THE REAL BOUND, stated precisely because an earlier version of this comment
 *    claimed more: the count pins and the import-clause pins catch a new call
 *    site only when it is spelled with one of the PINNED NAMES. They do NOT catch
 *    it when the reference is renamed. A round-3 review injected
 *
 *        const { hasUsers: rhu } = await import("./services/auth.mjs")
 *        if (!u && !(await rhu())) return 401
 *
 *    into the real handlers.mjs and ran every assertion in this file: all 34 were
 *    GREEN. The call is spelled `rhu(`, so the `hasUsers(` count does not move,
 *    and the static clause is untouched, so the clause pin does not fire. What
 *    catches it now is the DYNAMIC import pin above, which is why that pin exists
 *    and why it is not optional. A reference that is renamed AND re-bound in a
 *    way the dynamic pin does not enumerate remains a hole; the structural
 *    mitigation is the one grantor pin, not these counts.
 *
 * 2. siteFeedsRefusal only sees a directly-assigned result used by name on a
 *    line that also mentions 401/403. Passing the result through another
 *    variable, or building the refusal with a status computed elsewhere, is not
 *    detected.
 *
 * 3. The connectors route-coverage predicate is scoped to the connectors FAMILY
 *    (>= 5 routes, each gated in its own block) plus a hand-listed seed of one
 *    more (/api/trading/brokers). It was NOT sound within that scope until
 *    round 3, and an earlier version of this comment called it sound: a
 *    SINGLE-LINE route (`if (path === "…" ) return respond(registry)`) has no
 *    closing brace at its own indent, so the region walk ran on and absorbed the
 *    NEXT route's gate, reporting an ungated route as gated. It failed UNSAFE and
 *    is now covered by fixture. The remaining limits are real and narrower: the
 *    block walk is indentation-based, so a route whose body is written at an
 *    unexpected indent is not followed into; and a 4xx writeJson is carved out of
 *    "answers the request", so a route that leaked data inside a 4xx body before
 *    its gate would pass.
 *
 *    A THIRD limit, and the one most likely to bite a future edit:
 *    findConnectorsRouteSites recognises exactly three dispatch spellings — a
 *    `path === "…"` comparison, `path.startsWith("…")`, and `path.match(/…/)`.
 *    A route dispatched by a `switch`, a lookup table, a route map, or any
 *    equivalent is INVISIBLE to it, and silently so: no site is discovered, so no
 *    assertion is made about it at all. Both `switch` and lookup-table shapes were
 *    confirmed to be discovered as zero sites. There is no live instance of either
 *    in the connectors family today, so this is a bound to name rather than a
 *    hole — but a route added that way would arrive UNGATED and UNCHECKED, and the
 *    seed-list count pin would not notice, because that reports a route as stale
 *    only when it disappears entirely. Closing it means enumerating the dispatch
 *    structure properly, which is the follow-up in the task report. It is not
 *    attempted here for the same reason the region walk is not: a partial
 *    approximation would report coverage that does not exist.
 *
 * 4. A blanket requireSessionOrFirstRun() over every /api route in handleApi is
 *    NOT attempted, because many routes are legitimately public -
 *    /api/auth/signup, /api/auth/login, /api/auth/status, health, static-ish
 *    reads — and distinguishing them needs an owner decision about which routes
 *    are public. A round-3 review enumerated 35 routes that answer 200 with a
 *    body to an anonymous caller on a populated store; they are recorded with a
 *    sensitivity note each in the task report. Tracked as a follow-up.
 */

/**
 * Does this site look like a gate? MESSAGE-ONLY.
 *
 * It is deliberately not part of the verdict — it exists to label a failure
 * "← this is an AUTH GATE" rather than "← no justification comment in reach".
 * Keeping it out of `isAccepted` is the whole point: a previous round of this
 * file was reviewed for exactly that mistake. Do not reintroduce proximity into
 * the verdict by calling this from isAccepted().
 */
function isGate(site) {
  return site.window.includes(`${STRICT_HELPER}(`) || site.window.includes(`${GATE_CALL}(`)
}

/**
 * THE VERDICT. A `hasUsers()` call site is ACCEPTED only when an allowlist entry
 * matches it on BOTH axes:
 *
 *   1. `marker`  — present in the site's own contiguous comment block, so the
 *                  justification is attached to THIS statement rather than to
 *                  something twelve lines away.
 *   2. `anchor`  — that entry's exact call expression is the site's line, so a
 *                  marker cannot be lifted off a legitimate non-gate and pasted
 *                  onto a gate that reads the same function differently.
 *
 * One axis alone is escapable: a bare marker check is defeated by pasting, a bare
 * anchor check by relocating, and a window check by both. See the two
 * "pasted"/"far above" tests, which plant those attacks. Note the precision: the
 * 12-line window still EXISTS and still backs isGate() for labelling; it is
 * excluded from THIS verdict, not deleted.
 *
 * What this verdict is NOT: it is a statement about the LINE, and only about the
 * line. It says this exact call is the exact expression an allowlist entry
 * documented, in its own comment block. It does NOT say the line's RESULT cannot
 * be used to build a refusal further down the block. A previous version of this
 * comment claimed "both together are not escapable", which was false — the
 * planted attack in the "hop-downstream" test below satisfies both axes and is
 * still a bootstrap bypass. `siteFeedsRefusal` closes that hop; the escapes that
 * remain are listed under KNOWN LIMITATIONS rather than asserted away here.
 */
function isAccepted(site) {
  return ALLOWLIST.some((a) => site.above.includes(a.marker) && site.text.includes(a.anchor))
}

describe("WS-7 AUTH-FAILOPEN — no gate in handlers.mjs reads the lenient hasUsers()", () => {
  it("the scan set is real, not an artefact of the scan", () => {
    // A guard that silently finds nothing is the exact failure this file
    // exists to prevent, so the scan is proved against a known ground truth.
    expect(SITES.length, "handlers.mjs must still contain hasUsers() call sites to police").toBeGreaterThan(0)
    // The two repaired non-gate sites, found by content rather than position.
    expect(SITES.some((s) => s.window.includes("preference-key SELECTION"))).toBe(true)
    expect(SITES.some((s) => s.window.includes("first-run SIGNUP HINT"))).toBe(true)
    // And the file really is the tracked one, not a stray copy.
    const tracked = execFileSync("git", ["ls-files", HANDLERS_REL], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
    expect(tracked, "the scanned file must be the tracked source, not a worktree copy").toBe(HANDLERS_REL)
    expect(
      execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
        .split("\n")
        .some((f) => f.startsWith(".freebuff/worktrees/")),
      ".freebuff/worktrees/ is another branch's working state and must never be scanned"
    ).toBe(false)
  })

  it("every hasUsers() call site is a reasoned non-gate — no gate may read the lenient reader", () => {
    const codeLines = CODE.split("\n")
    const unexplained = SITES.filter((s) => !isAccepted(s)).map((s) => {
      const looksLikeAGate = isGate(s) || /verifyUser|verifyToken|authentication required|\b40[13]\b/.test(s.window)
      return (
        `handlers.mjs:${s.line}  ${s.text}` +
        (looksLikeAGate ? "   ← this is an AUTH GATE" : "   ← no justification comment in reach")
      )
    })
    expect(
      unexplained,
      "A `hasUsers()` call outside the reasoned allowlist is either a gate or an undocumented " +
        "one. If it is a gate: `!hasUsers()` admits an unauthenticated caller whenever the user " +
        "store is unreadable, because hasUsers() cannot tell a genuine empty store from a fault — " +
        "route it through requireSessionOrFirstRun() (or ask for the strict " +
        "firstRunBootstrapAllowed() answer by name). If it genuinely makes no authorisation " +
        "decision, say so in a NOT A GATE comment and add a reasoned ALLOWLIST entry above."
    ).toEqual([])

    // The hop. marker+anchor judge a LINE; this judges what the line is FOR.
    const feeders = SITES.map((s) => ({ s, feed: siteFeedsRefusal(codeLines, s.line - 1) }))
      .filter((r) => r.feed && isAccepted(r.s))
      .map((r) => `handlers.mjs:${r.s.line}  ${r.s.text}\n      feeds → ${r.feed}`)
    expect(
      feeders,
      "an accepted call site whose RESULT builds a 401/403 further down the block is a bootstrap " +
        "bypass wearing an allowlist entry's marker. `!hasUsers()` cannot tell a genuine empty " +
        "store from an unreadable one, so the whole point of the allowlist is lost. Route it " +
        "through requireSessionOrFirstRun() instead of computing the decision at the call site."
    ).toEqual([])
  })

  it("a hop-downstream refusal is rejected even with a pasted marker and a matching anchor", () => {
    // The attack that made the "both axes are unescapable" claim false. Every
    // line satisfies marker AND anchor: the marker is on the site's own comment
    // block, and `hasUsers()` is the site's exact anchor. It is still a bypass.
    const planted = [
      `// ${ALLOWLIST[0].marker}`,
      "    const hasAccts = await hasUsers()",
      '    if (!hasAccts) return writeJson(res, 401, { error: "authentication required" })'
    ].join("\n")
    const found = scanCallSites(planted)
    expect(found, "the planted site must be discovered").toHaveLength(1)
    expect(isAccepted(found[0]), "marker + anchor are both satisfied — this is the whole point").toBe(true)
    const feed = siteFeedsRefusal(planted.split("\n"), found[0].line - 1)
    expect(
      feed,
      "the hop check is the only thing that rejects this; marker+anchor cannot"
    ).not.toBeNull()
  })

  it("no line pairs the lenient hasUsers() with a 401 refusal — the fail-open idiom itself", () => {
    // The precise, false-positive-free form of the rule, on CODE so a comment
    // mentioning the idiom cannot trip it. Fourteen routes shipped the literal
    // fail-open idiom `!(await hasUsers()) → 401`; if that shape reappears on a
    // single line, it is a bypass by construction and no window heuristic is
    // needed to say so.
    const idiom = new RegExp(`\\b${LENIENT}\\s*\\(`)
    const offenders = CODE.split("\n")
      .map((text, i) => ({ line: i + 1, text: text.trim() }))
      .filter((r) => idiom.test(r.text) && /\b40[13]\b/.test(r.text))
      .map((r) => `handlers.mjs:${r.line}  ${r.text}`)
    expect(
      offenders,
      "a 401 guarded by the lenient hasUsers() is a bootstrap bypass a store fault can satisfy — " +
        "use requireSessionOrFirstRun()"
    ).toEqual([])
  })

/**
 * Every `await import(...)` BINDING of `./services/auth.mjs`, as written.
 *
 * The static-clause pin above is not sufficient on its own. handlers.mjs:3096
 * already contains a second binding path —
 *
 *     const { verifyUser, hasUsers } = await import("./services/auth.mjs")
 *
 * — and a fail-open gate written as
 *
 *     const { hasUsers: rhu } = await import("./services/auth.mjs")
 *     if (!u && !(await rhu())) return 401
 *
 * satisfies every static pin: the static clause is untouched, and the aliased
 * call is spelled `rhu(`, so the `resolveHasUsers(` and `hasUsers(` call-site
 * counts do not move. That is not a hypothetical spelling either; it is one edit
 * away from a line the file already contains.
 */
function dynamicAuthImports(src) {
  const found = []
  const re = /\{([^}]*)\}\s*=\s*(?:await\s+)?import\s*\(\s*["'][^"']*services\/auth\.mjs["']\s*\)/g
  for (const m of src.matchAll(re)) {
    found.push({
      specifiers: m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    })
  }
  return found
}

const DYNAMIC_AUTH_IMPORTS = dynamicAuthImports(CODE)

  it("no DYNAMIC import of the auth module binds a name by alias", () => {
    // The escape that survives the static clause pin, demonstrated rather than
    // described: an aliased `await import` leaves the static clause clean and the
    // call-site counts unmoved, so every other assertion in this file stays green
    // on a fail-open gate.
    expect(
      DYNAMIC_AUTH_IMPORTS,
      "the dynamic auth.mjs import binding path must be discoverable, or this pin reasons " +
        "about nothing. handlers.mjs:3096 has one; if it is gone, delete this test deliberately."
    ).not.toHaveLength(0)
    expect(
      DYNAMIC_AUTH_IMPORTS.flatMap((d) => d.specifiers).filter((s) => /\bas\b/.test(s) || /:/m.test(s)),
      "a destructured alias in a dynamic auth.mjs import is invisible to the static clause pin and " +
        "to the call-site counts, because the call is then spelled with the ALIAS. " +
        "`hasUsers: rhu` makes every gate read the lenient reader while this file reports green."
    ).toEqual([])
  })

  it("the dynamic auth.mjs import binds exactly the two names it is allowed to", () => {
    // A count, so adding a dynamic auth binding is a deliberate act. A new one is
    // a new place that can read the auth store, and it needs a reason here.
    expect(
      DYNAMIC_AUTH_IMPORTS,
      "dynamic imports of the auth module in handlers.mjs. Expected exactly 1 (handlers.mjs:3096, " +
        "the chart-source preference key selection). A second is a new unbound reader of the auth " +
        "store and must be justified here."
    ).toHaveLength(1)
    expect(
      DYNAMIC_AUTH_IMPORTS[0].specifiers.sort(),
      "the one dynamic auth.mjs import binds the lenient hasUsers() and verifyUser() for the " +
        "documented non-gate preference selection. Anything else is an unreviewed binding."
    ).toEqual(["hasUsers", "verifyUser"])
  })

  it("demonstrates the blind spot the dynamic pin closes", () => {
    // Stated as a test so the dynamic pin is not removed as "the static clause pin
    // already covers it". It does not: every other assertion in this file is green
    // on this source.
    const planted = [
      'import { hasUsers, resolveHasUsers, firstRunBootstrapAllowed } from "./services/auth.mjs"',
      "",
      "async function handleApi(req, res) {",
      '  const { hasUsers: rhu } = await import("./services/auth.mjs")',
      "  if (!u && !(await rhu())) return writeJson(res, 401, { error: 'authentication required' })",
      "}"
    ].join("\n")

    // The static clause is untouched by the attack, so the clause pin is GREEN.
    expect(
      authImportSpecifiers(planted).filter((s) => /\bas\b/.test(s)),
      "the static clause really is clean — that is why the attack passes it"
    ).toEqual([])

    // And the call site is spelled with the alias, so the hasUsers( count does not
    // move either.
    expect(
      (planted.match(/\bhasUsers\s*\(/g) ?? []).length,
      "the aliased call does not add a hasUsers( site, so the count pin is also GREEN"
    ).toBe(0)

    // Only the dynamic pin sees it.
    expect(
      dynamicAuthImports(planted).flatMap((d) => d.specifiers).filter((s) => /:/m.test(s)),
      "the dynamic pin is the ONLY thing standing between this alias and a fail-open gate"
    ).toHaveLength(1)
  })

  it("the auth.mjs import clause binds every reader under its own name", () => {
    // No `as` anywhere in the clause. Aliasing is legal JS and invisible to a
    // call-site count, so it is banned here: the names in this clause are the
    // ones the count pins reason about, and a binding that does not match its
    // name invalidates every one of those pins at once.
    expect(
      AUTH_SPECIFIERS,
      "the auth.mjs import clause must be findable, or this guard reasons about nothing"
    ).not.toBeNull()
    expect(
      AUTH_SPECIFIERS.filter((s) => /\bas\b/.test(s)),
      "an aliased import in the auth.mjs clause is invisible to the resolveHasUsers()/hasUsers() " +
        "count pins. `hasUsers as resolveHasUsers` keeps the count at exactly 1 while every gate " +
        "reads the LENIENT reader — the fail-open inversion this file exists to prevent. " +
        "Import the reader you mean, under the name you mean."
    ).toEqual([])
  })

  it("the two user-store readers are both bound, so neither can be swapped out", () => {
    expect(
      AUTH_SPECIFIERS,
      "hasUsers (lenient, one documented non-gate caller) and resolveHasUsers (strict, the gate's " +
        "reader) must both stay imported: dropping the strict one would push a gate back onto the " +
        "lenient reader, and dropping the lenient one would remove the first-run hint."
    ).toEqual(expect.arrayContaining([LENIENT, "resolveHasUsers"]))
  })

  it("demonstrates the blind spot the clause pin closes", () => {
    // Stated as a test so the clause pin above is not later removed as
    // redundant. This planted attack satisfies the call-site count EXACTLY while
    // routing every gate through the lenient reader.
    const planted = [
      'import { hasUsers as resolveHasUsers, firstRunBootstrapAllowed } from "./services/auth.mjs"',
      "let anyUserExists",
      "try { anyUserExists = await resolveHasUsers() } catch { anyUserExists = true }"
    ].join("\n")
    const count = (planted.match(/\bresolveHasUsers\s*\(/g) ?? []).length
    expect(
      count,
        "the count pin is SATISFIED by this attack — which is the whole reason the import clause " +
        "is pinned as well. If this ever becomes 0, the count pin is doing something different " +
        "than assumed and this demonstration needs revisiting."
    ).toBe(1)
    expect(
      authImportSpecifiers(planted).filter((s) => /\bas\b/.test(s)),
      "the clause pin is the only thing standing between that alias and a fail-open gate"
    ).toHaveLength(1)
  })

  it("has exactly one place that can grant the bootstrap bypass", () => {
    // The choke point must exist and must be the ONLY grantor, or the class
    // regrows the moment somebody writes their own copy of the decision.
    const definitions = (CODE.match(new RegExp(`async function ${GATE_CALL}\\s*\\(`, "g")) ?? []).length
    expect(definitions, "the shared gate must be defined exactly once").toBe(1)
    const grants = (CODE.match(new RegExp(`\\b${STRICT_HELPER}\\s*\\(`, "g")) ?? []).length
    // EXACTLY ONE, inside the gate itself. The eWallet routes need the bootstrap
    // answer twice more (the order owner stamp and selfApprove) and used to call
    // firstRunBootstrapAllowed() again for each — a second and third store read,
    // where a mid-request fault escaped as a 500 rather than the documented 503.
    // They now reuse the gate's own verified answer via bootstrapAnswer(req), so
    // the store is read once per request and cannot be disagree. A second
    // occurrence means a new reader of the decision, and with it the fault-to-
    // status mapping the gate owns.
    expect(grants, "the strict answer must be read in exactly one place: the gate").toBe(1)
  })

  it("routes that derive the bypass read the GATE's answer, not the store", () => {
    // The three eWallet derivations are the only places allowed to act on the
    // bootstrap answer, and they must all go through bootstrapAnswer() so they
    // cannot re-introduce a store read (and with it an uncaught fault).
    //
    // The count is asserted as DEFINITION + 3 CALL SITES rather than a bare 4.
    // A previous version asserted 4 while its message said "three", and the
    // mismatch is why: the two numbers counted different things and the message
    // only described one of them. Splitting the assertion means every number in
    // these messages is checkable against the thing it names.
    const definitions = (CODE.match(/(?:async\s+)?function\s+bootstrapAnswer\s*\(/g) ?? []).length
    expect(definitions, "bootstrapAnswer() must be defined exactly once: the gate's own answer").toBe(1)
    const derived = (CODE.match(/\bbootstrapAnswer\s*\(/g) ?? []).length - definitions
    expect(
      derived,
        "exactly the three eWallet derivations — the order owner stamp, the actor stamp, and " +
        "selfApprove — each reading the gate's answer. A fourth derivation is a new place that " +
        "acts on the bootstrap decision, and it is a new fault-to-status mapping the gate no " +
        "longer owns."
    ).toBe(3)
  })

  it("the verifyUser() surface is enumerated, not assumed", () => {
    // A count pin, deliberately, and NOT a claim that the surface is correct.
    //
    // KNOWN GAP, still open: verifyUser() returns null when the SESSIONS store
    // faults, so the 35 sites below that are not the gate fail CLOSED but with
    // the wrong status — a 401 where the shared gate answers 503. No access is
    // granted, which is why this is a gap and not a hole, but 401 is the
    // session-destroying status client-side (fetchMe maps it to `rejected`,
    // shouldClearStoredSession deletes the session), so it is the same harm
    // class as the WS-6 T10 flake on a different store.
    //
    // Pinning the count is what this round does about it: the surface becomes a
    // number someone has to look at and change deliberately, instead of 36 call
    // sites nobody has enumerated. Migrating a site is `verifyTokenStrict()` +
    // `strictOrRefuse()`, exactly as the gate does it; that is a separate change
    // with its own review, tracked as a follow-up. Do NOT let this count be
    // relaxed — a decrease means sites were migrated (good, update it with the
    // reason), and an increase means a new answer-401-on-fault site was added
    // (ask why it cannot use the gate).
    // Counted on CODE, not SRC, so the three comment mentions of `verifyUser(`
    // in this file's neighbourhood do not inflate the number. A comment is not a
    // call site, and a pin that counted them would be measuring prose.
    const sites = (CODE.match(/\bverifyUser\s*\(/g) ?? []).length
    expect(
      sites,
      "verifyUser() call sites in handlers.mjs, counted on CODE. Expected 36 as of WS-7 round 2. " +
        "A decrease means a site was migrated to verifyTokenStrict() + strictOrRefuse() — " +
        "good, update the number in the same change. An increase is a new route that answers " +
        "401 when the sessions store faults: ask why it does not use requireSessionOrFirstRun()."
    ).toBe(36)
    const strict = (CODE.match(/\bverifyTokenStrict\s*\(/g) ?? []).length
    expect(
      strict,
      "verifyTokenStrict() separates a store fault from a bad token, and is the only call site " +
        "in the shared gate. Expected 1 as of WS-7 round 2 (the other two textual matches in " +
        "handlers.mjs are the import specifier, which has no parens, and a comment). " +
        "If this changes, a route outside the gate started separating the two — which is the " +
        "migration step for the gap above, so change it in the same commit as the count above."
    ).toBe(1)
  })

  it("resolveHasUsers() is not available as a second spelling of the decision", () => {
    // The class regrows through whichever spelling is left unpoliced. A 15th
    // gate written as `try { empty = !(await resolveHasUsers()) } catch { empty = true }`
    // reads NOTHING lenient and satisfies every predicate above, so the strict
    // reader's own name has to be counted: exactly one occurrence, and that one
    // is inside the gate. A gate must be spelled firstRunBootstrapAllowed().
    const uses = (CODE.match(/\bresolveHasUsers\s*\(/g) ?? []).length
    expect(
      uses,
      "resolveHasUsers() answers 'is the store populated', NOT 'may an unauthenticated caller " +
        "through'. A gate that reads it directly (or inverts it) re-opens the whole fail-open " +
        "class, because a future edit could make a fault read as empty. Ask for the gate's own " +
        "question with firstRunBootstrapAllowed(), or call requireSessionOrFirstRun()."
    ).toBe(1)
  })

/**
 * The CONNECTORS family's route-dispatch sites, found from the dispatch
 * structure itself.
 *
 * The previous predicate was `codeLines[i].includes("/api/connectors")`. That is
 * not a route enumeration, it is a substring search, and it found 2 of the
 * family's 5 routes: the three `path.match(/.../)` routes are invisible to it,
 * because stripComments blanks regex bodies on purpose so their contents are not
 * scanned as code. An ungated sibling in that blind spot passed silently.
 *
 * A line counts as a route site when BOTH hold:
 *   - the ORIGINAL line matches a connectors route-dispatch shape, AND
 *   — that same line still carries code in CODE — i.e. stripComments did not
 *     blank it away, i.e. it is not a comment.
 *
 * The second condition is what keeps a route mentioned in prose from being
 * counted as a route.
 */
function findConnectorsRouteSites(src, code, family = /\\?\/api\\?\/connectors/) {
  const srcLines = src.split("\n")
  const codeLines = code.split("\n")
  // The dispatch shapes a route can be spelled with.
  const dispatch = [/path\s*===\s*["']/, /path\.startsWith\(\s*["']/, /path\.match\(/]
  const sites = []
  for (let i = 0; i < srcLines.length; i += 1) {
    const line = srcLines[i]
    if (!family.test(line)) continue
    if (!dispatch.some((re) => re.test(line))) continue
    if (!codeLines[i] || !codeLines[i].trim()) continue
    sites.push({ line: i + 1, text: line.trim(), index: i })
  }
  return sites
}

/** Escape a literal path for use inside a RegExp, rather than hand-escaping it. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The handler block that belongs to a route site, by indentation.
 *
 * This is the "route's own block" the gate has to live in. A proximity WINDOW is
 * not that: copy a sibling route's gate line onto the line after an ungated
 * block and a 12-line window still calls it gated. Ending the region at the
 * block's own closing brace is what makes a gate in the NEXT route incapable of
 * vouching for this one.
 *
 * Handles both dispatch spellings in this file: `if (path === ...)` owns the
 * block that follows it, and a `const mMatch = path.match(...)` matcher owns the
 * `if (mMatch ...)` block immediately after it.
 */
function routeHandlerRegion(lines, index) {
  const line = lines[index]
  const trimmed = line.trim()

  // A SINGLE-LINE route ends on its own line, so its region is that line and
  // nothing else. Without this the walk ran on into the next route, found its
    // gate, and reported an ungated route as gated — failing UNSAFE.
  //
  // The `ends with {` test is what distinguishes a block opener from a one-liner.
  // A `const mMatch = path.match(...)` matcher line also does not end with `{`,
  // but it is not an `if` and the `if (mMatch ...)` block below it IS its
  // handler, so those still walk.
  if (/^if\s*\(/.test(trimmed) && !/\{$/.test(trimmed)) return [line]

  const baseIndent = (line.match(/^\s*/) ?? [""])[0].length
  const region = [line]
  for (let k = index + 1; k < lines.length; k += 1) {
    const next = lines[k]
    if (next.trim() === "") {
      region.push(next)
      continue
    }
    const indent = (next.match(/^\s*/) ?? [""])[0].length
    const nextTrimmed = next.trim()
    // The block's own closing brace ends the region.
    if (indent === baseIndent && /^\}/.test(nextTrimmed)) break
    // Inside the block.
    if (indent > baseIndent) {
      region.push(next)
      continue
    }
    // The `if (mMatch && ...)` that follows a matcher line is the same dispatch.
    if (indent === baseIndent && /^if\s*\(/.test(nextTrimmed)) {
      region.push(next)
      continue
    }
    break
  }
  return region
}

/**
 * The part of the line that is STATEMENT rather than an `if (...)` head.
 *
 * A single-line route is `if (cond) return x`, so a `^\s*return` test never fires
 * on it — the return is mid-line, behind the condition. The condition is stripped
 * first, paren-balanced (a naive `[^)]*` stops inside `if (!(await foo(x)))` and
 * then mis-reports the remainder), and the shift is returned so offsets still
 * refer to the ORIGINAL line.
 */
function statementBody(line) {
  const lead = (line.match(/^\s*/) ?? [""])[0].length
  if (!/^if\s*\(/.test(line.slice(lead))) return { text: line, shift: 0 }
  let i = lead + 2
  let depth = 0
  for (; i < line.length; i += 1) {
    if (line[i] === "(") depth += 1
    else if (line[i] === ")") {
      depth -= 1
      if (depth === 0) {
        i += 1
        break
      }
    }
  }
  return { text: line.slice(i), shift: i }
}

/**
 * The offset of the first thing on this line that ANSWERS the request, or -1.
 *
 * A 4xx writeJson is deliberately NOT counted. This codebase uses those as cheap
 * preconditions before the authenticated work — `if (!getConnector(slug)) return
 * writeJson(res, 404, ...)` runs before the gate on the /:slug/history route -
 * and they carry no route data: a 404 body is an error message, not a balance.
 * Requiring the gate to precede them would mean either moving the precondition
 * behind the auth check, which is a real cost, or accepting a false positive on
 * every one of them. The carve-out is narrow on purpose: only a 4xx is exempt.
 *
 * `before` restricts the search to offsets earlier than a given point, which is
 * how the gate's OWN trailing `return true` is excluded while an answer sitting
 * in front of the gate on the same line is still caught.
 */
function firstAnswerOffset(line, before = Number.POSITIVE_INFINITY) {
  const { text, shift } = statementBody(line)
  // A 4xx writeJson is the precondition carve-out, whether it stands alone or is
  // what a `return` returns. Matching on the STATEMENT rather than on the
  // writeJson token alone matters because `return` and `writeJson(` are separate
  // tokens at separate offsets once the `if (...)` head has been stripped, so
  // excluding the writeJson offset would leave the return counted.
  const fourxxArgs = /^\s*res\s*,\s*4\d\d/
  const offsets = []

  const ret = /^\s*return\s/.exec(text)
  if (ret) {
    const rest = text.slice(ret.index + ret[0].length)
    const write = /writeJson\s*\(/.exec(rest)
    if (!write || !fourxxArgs.test(rest.slice(write.index + write[0].length))) {
      offsets.push(ret.index + shift)
    }
  }

  const write = /\bwriteJson\s*\(/.exec(text)
  if (write) {
    const rest = text.slice(write.index + write[0].length)
    if (!fourxxArgs.test(rest)) offsets.push(write.index + shift)
  }

  const res = /\bres\.(end|write|send)\b/.exec(text)
  if (res) offsets.push(res.index + shift)

  const kept = offsets.filter((idx) => idx < before)
  return kept.length ? Math.min(...kept) : -1
}

const answersRequest = (line) => firstAnswerOffset(line) !== -1

/**
 * Is this route site gated by the shared gate, IN ITS OWN BLOCK, BEFORE it
 * answers the request?
 *
 * The ordering half matters as much as the presence half. A gate that appears
 * after the route has already returned is dead code, and a dead gate is exactly
 * what a presence-only check mistakes for safety.
 */
function connectorsSiteIsGated(lines, index) {
  const region = routeHandlerRegion(lines, index)
  let gateAt = -1
  for (let i = 0; i < region.length; i += 1) {
    if (region[i].includes(`${GATE_CALL}(`)) {
      gateAt = i
      break
    }
  }
  if (gateAt === -1) return { ok: false, why: "no gate in this route's own block" }

  for (let i = 0; i < region.length; i += 1) {
    if (i < gateAt) {
      if (answersRequest(region[i])) return { ok: false, why: "the gate appears AFTER the route already answers" }
      continue
    }
    if (i > gateAt) continue
    // The gate's own line: only what sits BEFORE the gate call counts, so the
    // gate's trailing `return true` is not mistaken for an answer, while a
    // response placed in front of the gate on the same line still is.
    const gateOffset = region[i].indexOf(`${GATE_CALL}(`)
    if (gateOffset !== -1 && firstAnswerOffset(region[i], gateOffset) !== -1) {
      return { ok: false, why: "the gate appears AFTER the route already answers" }
    }
  }
  return { ok: true }
}

  it("every /api/connectors route is gated", () => {
    // /api/connectors (the AGGREGATE) had no gate at all while its sibling
    // /api/connectors/:slug/history was gated and discloses the same class of
    // data — live balances. It needs no store fault to be exploited, so it is
    // strictly easier to reach than anything in the fail-open class. Discovered
    // by walking the dispatch structure, not listed by hand.
    const sites = findConnectorsRouteSites(SRC, CODE)
    expect(
      sites.length,
      "the connectors family must still be discovered by the scan; a count of 0 or 1 means the " +
        "scan has gone blind again and this test is asserting nothing"
    ).toBeGreaterThanOrEqual(5)
    const lines = SRC.split("\n")
    const ungated = sites
      .map((s) => ({ s, verdict: connectorsSiteIsGated(lines, s.index) }))
      .filter((r) => !r.verdict.ok)
      .map((r) => `handlers.mjs:${r.s.line}  ${r.s.text}  — ${r.verdict.why}`)
    expect(
      ungated,
      "every /api/connectors route must pass through requireSessionOrFirstRun() inside its OWN " +
        "block and BEFORE it answers the request. The aggregate lists every connector (label, " +
        "live url, selectors, tuning) plus getLatestSnapshots() — live balances — and its own " +
        "/:slug/history sibling is gated, so it is the outlier."
    ).toEqual([])
  })

  it("rejects a SINGLE-LINE if route with no gate, whose sibling gate follows it", () => {
    // The shape no planted fixture covered: every other one is brace-delimited.
    // A single-line `if (...) return respond(registry)` has no closing brace at the
    // route's own indent, so the region walk ran on past it and absorbed the NEXT
    // route's gate — reporting an ungated route as gated. It failed UNSAFE.
    const planted = [
      '  if (path === "/api/connectors" && req.method === "GET") return respond(registry)',
      "",
      '  if (path === "/api/connectors/autodetect" && req.method === "POST") {',
      `    if (!(await ${GATE_CALL}(req, res))) return true`,
      "    return respondAuto()",
      "  }"
    ].join("\n")
    const lines = planted.split("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    expect(sites.length, "both routes must be discovered").toBe(2)
    const ungated = sites
      .map((s) => connectorsSiteIsGated(lines, s.index))
      .filter((v) => !v.ok)
    expect(
      ungated.map((v) => v.why),
      "a single-line route has no block to walk into, so the walk must stop at the end of the " +
        "line rather than absorbing the next route's gate"
    ).toHaveLength(1)
  })

  it("rejects a single-line if route whose OWN line carries the gate after the response", () => {
    // Ordering, on the single-line shape: a gate textually present on the same
    // line but positioned after the response is still dead code.
    const planted = [
      `  if (path === "/api/connectors" && req.method === "GET") return respond(registry), (${GATE_CALL}(req, res))`
    ].join("\n")
    const lines = planted.split("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    const verdict = connectorsSiteIsGated(lines, sites[0].index)
    expect(verdict.ok, "a gate that cannot run before the response is not a gate").toBe(false)
  })

  it("accepts a single-line if route that carries its own gate first", () => {
    const planted = [
      `  if (path === "/api/connectors" && req.method === "GET") { if (!(await ${GATE_CALL}(req, res))) return true; return respond(registry) }`
    ].join("\n")
    const lines = planted.split("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    expect(connectorsSiteIsGated(lines, sites[0].index).ok, "the mirror, so the rule is not just reject-everything").toBe(true)
  })

  // ── Seed list of individually-named routes that must be gated ──────────────
  //
  // This is NOT a completeness claim, and it must not be read as one. A round-3
  // review enumerated 35 further routes that answer 200 with a body to an
  // anonymous caller on a populated store, among them /api/trading/paper/positions
  // (real open positions), /api/trading/journal (P&L / win rate) and
  // /api/trading/export. Gating them is NOT this file's decision to make: it
  // needs an owner ruling on which routes are intentionally public, and several
  // may legitimately be. The list is recorded with a sensitivity note each in the
  // task report so that decision can be made from evidence.
  //
  // What this list DOES is stop a route that has already been judged sensitive
    // from silently losing its gate — which is how /api/trading/brokers came to be
  // ungated in the first place: it was never an explicit decision, only an
  // omission, and no predicate covered it.
  const GATED_SEED_ROUTES = [
    {
      path: "/api/trading/brokers",
      gate: "requireSessionOrFirstRun",
      why:
        "the broker adapter registry: per adapter it names whether the exchange is configured, " +
        "whether it is connected, the rail mode (sessionLive / demoOnly) and every capability it " +
        "exposes, plus the active executor. It had no gate of any kind."
    },
    {
      path: "/api/trading/journal",
      gate: "requireAuth",
      why:
        "the user's full trade journal plus P&L and win-rate statistics. Ungated: an anonymous " +
        "GET read it."
    },
    {
      path: "/api/trading/journal/close",
      gate: "requireAuth",
      why: "mutation of a trade-journal entry by id. Ungated."
    },
    {
      path: "/api/trading/journal/delete",
      gate: "requireAuth",
      why:
        "DESTRUCTIVE delete of a trade-journal entry by id, unauthenticated. The most serious of " +
        "the four: anyone who can reach the port could erase the trading record."
    }
  ]

  it("every seed-listed route is still gated", () => {
    const codeLines = CODE.split("\n")
    const srcLines = SRC.split("\n")
    const report = []
    for (const entry of GATED_SEED_ROUTES) {
      // Anchored on the CLOSING QUOTE, not end-of-line: the literal is followed
      // by `" && req.method === "GET"`, so a `$` anchor finds nothing.
      const sites = findConnectorsRouteSites(SRC, CODE, new RegExp(`${escapeRe(entry.path)}["']`))
      if (sites.length === 0) {
        report.push(`handlers.mjs — ${entry.path} is no longer routed; remove it from GATED_SEED_ROUTES`)
        continue
      }
      for (const s of sites) {
        const region = routeHandlerRegion(srcLines, s.index)
        // EITHER established gate counts. The question this list asks is "is this
        // route gated", not "is it gated by the one function": requireAuth is the
        // dominant idiom for user-owned data (97 sites) and the journal routes use
        // it deliberately, while requireSessionOrFirstRun is the bootstrap-aware
        // gate. Demanding one specific function would have forced a worse gate on
        // the journal routes to satisfy a check.
        const gated = region.some((l) => l.includes(`${GATE_CALL}(`) || l.includes("requireAuth("))
        if (!gated) {
          report.push(`handlers.mjs:${s.line}  ${s.text}  — no gate in this route's own block`)
        }
      }
    }
    expect(
      report,
      "a route in the seed list lost its gate, or the route was renamed and the list is now " +
        "stale. Stale entries must be removed deliberately, not left to rot."
    ).toEqual([])
  })

  it("the module-shape figures quoted about handlers.mjs are asserted, not remembered", () => {
    // These three numbers appear in prose (this file's own comments, the test
    // budget comment in authBootstrapGateFailsClosed, and the task report) and a
    // number written only in prose rots silently: handlers.mjs gained 17 lines and
    // the budget comment still said 5,548. So the numbers are pinned here, on the
    // SAME comment-stripped view every other predicate in this file uses, which is
    // also what makes them comparable to a raw grep (a raw count is higher, because
    // it includes matches inside comments and strings).
    const statics = (CODE.match(/(^|\n)\s*import\s/g) ?? []).length
    const dynamics = (CODE.match(/\bimport\s*\(/g) ?? []).length
    const lines = SRC.split("\n").length

    expect(statics, "static import statements in handlers.mjs").toBe(72)
    expect(dynamics, "dynamic import() calls in handlers.mjs, comment-stripped").toBe(80)
    // 5,938 -> 5,952 in WS-7 slice C, which added a requireAuth() gate plus its
    // reasoning to /api/trading/alerts/delete and /api/trading/watchlists/delete —
    // the two unauthenticated destructive deletes. The pin is still EXACT, which is
    // the point of it: it is not loosened to accommodate the change, it is moved to
    // the new true value so the next drift is still caught. Recorded here rather
    // than in a task report because the pin's own stated purpose is that a number
    // written only in prose rots silently — this is the prose.
    //
    // 5,952 -> 5,973 in WS-7 slice C FIX ROUND 1, the same protocol: +21 lines, and
    // every one of them is accounted for rather than absorbed. Eleven are the
    // unconditional requireAuth() gate and its reasoning on /api/trading/notifications,
    // which had a gate covering only 2 of its 6 actions. Ten are the `await` and
    // its reasoning on constructWebhookEvent() in /api/stripe/webhook, where a
    // missing `await` left the surrounding try/catch inert. Nothing else in
    // handlers.mjs moved — which the two import figures above confirm rather than
    // assert on trust: 73 static and 84 comment-stripped dynamic imports are
    // UNCHANGED by this round, so the growth is gates and comments, not structure.
    // (The raw dynamic count is 85 because a new comment contains the word
    // "import"; that is exactly why the figure is measured on the comment-stripped
    // view, and it is a small demonstration that the view is doing its job.)
    //
    // 5,973 -> 6,115 in the rate-limiter slice, the same protocol: +142 lines, and
    // the growth is accounted for rather than absorbed. Roughly 118 are the
    // client-identity resolution in handlers.mjs — `peerAddress()`, the
    // `isPlausibleAddress` shape tests, the `PICC_TRUSTED_PROXY_IPS` allowlist
    // with its fail-closed parsing, and `clientIp()`'s documented right-to-left
    // walk — plus its reasoning, which is the majority of it. The remaining ~24
    // are the four per-client limiter keys and the comments recording WHY a bare
    // key was a server-wide budget.
    //
    // The two import figures above are UNCHANGED by that round, which is the
    // check that matters here: 73 static and 84 comment-stripped dynamic imports
    // are the same numbers, so none of those 142 lines is a new module binding.
    // That is the whole point of pinning all three — a canary that moved because
    // structure changed is a different signal from one that moved because
    // comments and guards grew, and the import pair is what tells them apart.
    //
    // 6,115 -> 6,198 in the trusted-proxy follow-up, the same protocol: +83 lines.
    // Essentially all of it is `isPlausibleAddress` — the IPv4 helper, the IPv6
    // grammar, and the reasoning for why the old regex shape was wrong. The
    // import pair being UNCHANGED is load-bearing for that number rather than
    // incidental: the obvious fix for the IPv6 bug was `import { isIP } from
    // "node:net"`, which would have moved the static count to 74 and quietly
    // turned a "this round changed the module graph" signal into a "this round
    // grew" one. The predicate is hand-written instead and its agreement with
    // net.isIP is asserted over a corpus in rateLimitClientIdentity.test.mjs, so
    // the correctness is bought with a test and the canary keeps its meaning.
    //
    // WS-7 T2 (D2, ExpertOption removal), the same protocol: 6,198 -> 6,088,
    // -110 lines, and every one is accounted for rather than absorbed. Roughly
    // -95 are the removed ExpertOption route bodies (the two analysis routes,
    // /api/trading/demo, /api/trading/feed-mode, /api/browser/capture-session,
    // the realtime EO subscription and its stats/snapshot frames, the EO health
    // block, the EO mid leg in /api/trading/spread, and the liveEO buffer reads
    // in the indicators/levels/model-matrix paths), each replaced by a short
    // D2 note naming what was removed and why. The rest is the `liveEO.mjs` and
    // `expertoption.mjs` import lines plus the EO credential masking and the
    // `analyzeExpertOptionAsset` / `proAnalyzeExpertOption` / `demoStatus` /
    // `captureExpertOptionSession` named imports.
    //
    // The import pair MOVES here, unlike every previous round, and that is the
    // honest signal: 73 -> 72 static (the `liveEO.mjs` module graph edge is
    // gone) and 84 -> 80 dynamic (eight `liveEO.mjs` dynamic imports removed,
    // four non-EO fan-in/broker imports added in their place, net -4). This is
    // the "structure changed" signal the canary is designed to distinguish from
    // "grew", and it is why the figure is moved to the new true value rather
    // than loosened.
    expect(lines, "lines in handlers.mjs").toBe(6088)
  })

  it("the seed list is not empty, so the test above cannot pass vacuously", () => {
    expect(
      GATED_SEED_ROUTES.length,
      "an empty seed list makes the test above assert nothing — the same vacuous pass this " +
        "file has been bitten by twice"
    ).toBeGreaterThan(0)
  })

  it("the connectors scan sees the path.match routes, not just path ===", () => {
    // The enumeration half of the fix, stated separately so a regression to a
    // substring scan is caught even if the five routes happen to be gated.
    const sites = findConnectorsRouteSites(SRC, CODE)
    const matchRoutes = sites.filter((s) => s.text.includes("path.match"))
    expect(
      matchRoutes.length,
      "a substring scan finds only the two path === routes; the three path.match routes are the " +
        "blind spot in which an ungated sibling would pass silently"
    ).toBeGreaterThanOrEqual(3)
  })

  it("rejects an ungated route whose SIBLING carries the gate just after it", () => {
    // The 12-line proximity window, planted exactly as it was exploited: the
    // aggregate has no gate, returns a response, and the very next route's gate
    // used to vouch for it.
    const planted = [
      '  if (path === "/api/connectors" && req.method === "GET") {',
      "    return respond(registry)",
      "  }",
      '  if (path === "/api/connectors/autodetect" && req.method === "POST") {',
      `    if (!(await ${GATE_CALL}(req, res))) return true`,
      "    return respondAuto()",
      "  }"
    ].join("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    const lines = planted.split("\n")
    const ungated = sites
      .map((s) => connectorsSiteIsGated(lines, s.index))
      .filter((v) => !v.ok)
    expect(
      ungated.map((v) => v.why),
      "a gate in the NEXT route must not vouch for this one; that is what the region bound buys"
    ).toHaveLength(1)
  })

  it("rejects a gate that appears after the route has already answered", () => {
    // The other half of the proximity hole: presence without ordering is dead code.
    const planted = [
      '  if (path === "/api/connectors" && req.method === "GET") {',
      "    return respond(registry)",
      `    if (!(await ${GATE_CALL}(req, res))) return true`,
      "  }"
    ].join("\n")
    const lines = planted.split("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    const verdict = connectorsSiteIsGated(lines, sites[0].index)
    expect(
      verdict.ok,
      "a gate that runs after the response is unreachable, and a presence-only check would call it safe"
    ).toBe(false)
    expect(verdict.why).toMatch(/AFTER/)
  })

  it("rejects an ungated path.match route", () => {
    // The invisible-to-substrings case, on its own: nothing here contains a
    // literal the old `includes("/api/connectors")` scan could have matched.
    const planted = [
      "  const historyMatch = path.match(/^\\/api\\/connectors\\/([a-z0-9_-]+)\\/history$/)",
      "  if (historyMatch && req.method === \"GET\") {",
      "    return respondHistory(historyMatch[1])",
      "  }"
    ].join("\n")
    const lines = planted.split("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    expect(sites, "the path.match route must be discovered at all").toHaveLength(1)
    expect(
      connectorsSiteIsGated(lines, sites[0].index).ok,
      "an ungated /:slug/history route is a live-balance disclosure with no store fault needed"
    ).toBe(false)
  })

  it("accepts a 4xx precondition that runs before the gate", () => {
    // Pins the carve-out above so it cannot widen silently. A 404 that leaks no
    // route data may precede the gate; this is the real /:slug/history shape.
    const planted = [
      "  const historyMatch = path.match(/^\\/api\\/connectors\\/([a-z0-9_-]+)\\/history$/)",
      '  if (historyMatch && req.method === "GET") {',
      '    if (!getConnector(slug)) return writeJson(res, 404, { ok: false, error: "unknown connector" })',
      `    if (!(await ${GATE_CALL}(req, res))) return true`,
      "    writeJson(res, 200, { ok: true, history: await getConnectorHistory(slug) })",
      "    return",
      "  }"
    ].join("\n")
    const lines = planted.split("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    expect(
      connectorsSiteIsGated(lines, sites[0].index).ok,
      "a precondition 404 that carries no data must not be treated as the gate being too late"
    ).toBe(true)
  })

  it("still rejects a 2xx disclosure that precedes the gate", () => {
    // The mirror of the carve-out: dropping the 4xx exemption must not extend to
    // a real disclosure. This is the attack the ordering half exists for.
    const planted = [
      '  if (path === "/api/connectors" && req.method === "GET") {',
      "    writeJson(res, 200, { ok: true, connectors: registry })",
      `    if (!(await ${GATE_CALL}(req, res))) return true`,
      "  }"
    ].join("\n")
    const lines = planted.split("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    const verdict = connectorsSiteIsGated(lines, sites[0].index)
    expect(verdict.ok, "a 200 that runs before the gate is exactly the disclosure being protected").toBe(false)
    expect(verdict.why).toMatch(/AFTER/)
  })

  it("accepts a properly gated path.match route", () => {
    // The mirror, so the rejection above is not just a rule that rejects everything.
    const planted = [
      "  const historyMatch = path.match(/^\\/api\\/connectors\\/([a-z0-9_-]+)\\/history$/)",
      "  if (historyMatch && req.method === \"GET\") {",
      `    if (!(await ${GATE_CALL}(req, res))) return true`,
      "    return respondHistory(historyMatch[1])",
      "  }"
    ].join("\n")
    const lines = planted.split("\n")
    const sites = findConnectorsRouteSites(planted, planted)
    expect(connectorsSiteIsGated(lines, sites[0].index).ok).toBe(true)
  })

  it("no string literal in the file contains something shaped like a call site", () => {
    // stripComments preserves string CONTENTS (only the lexing is string-aware),
    // which is what lets the connectors predicate above see the route literal.
    // That is only sound while no string can manufacture a finding.
    //
    // Every name the predicates in this file reason about is checked, not just
    // hasUsers: a string containing `requireSessionOrFirstRun(` would manufacture a
    // gate, and one containing `bootstrapAnswer(` would manufacture a derivation.
    const shapes = [LENIENT, STRICT_HELPER, GATE_CALL, "resolveHasUsers", "bootstrapAnswer", "verifyUser"]
    const offenders = stringLiteralContents(SRC)
      .filter((body) => shapes.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(body)))
      .map((body) => (body.length > 80 ? `${body.slice(0, 77)}...` : body))
    expect(
      offenders,
      "a string containing a call-site shape would be scanned as code, manufacturing a finding. " +
        "This is checked for every name this file's predicates match on, not only hasUsers()."
    ).toEqual([])
  })

  it("the string-literal scan reaches ACROSS newlines", () => {
    // The defect this pins: the previous extractor was
    // /(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g. `[^\\\n]` cannot match a newline, so a
    // multi-line template literal was never inspected at all — and a template
    // literal is exactly where a long, readable call-site shape would be pasted.
    const planted = ["const doc = `", "  example: hasUsers()", "`"].join("\n")
    expect(
      stringLiteralContents(planted).some((b) => /\bhasUsers\s*\(/.test(b)),
      "a call-site shape inside a multi-line template must be visible to this check"
    ).toBe(true)
  })

  it("the string-literal scan terminates quickly on a long non-matching body", () => {
    // The same extractor had a nested alternation-with-star
    // (`(?:\\.|(?!\\1)[^\\\\\\n])*`), the classic backtracking shape. This is a
    // bound, not a benchmark: it fails if the scan becomes superlinear enough to
    // matter on a file of this size, and it is a real assertion because the old
    // pattern is exactly what regressed.
    const long = `"${"a".repeat(200_000)}`
    const started = process.hrtime.bigint()
    stringLiteralContents(long)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    expect(ms, `scanning a 200kB literal took ${ms.toFixed(1)}ms`).toBeLessThan(1_000)
  })

  it("the lexer reads division after a string as division, not as a regex", () => {
    // Pins a lexer bug that silently disabled this whole file rather than
    // reporting a wrong answer. A `/` after a CLOSED STRING is division. The
    // old backward scan saw the closing quote, did not recognise a quote as
    // ending a value, and consumed forward to the next `/` ON THE LINE — which
    // blanked the gate it was supposed to find and left the scan with zero call
    // sites. Every predicate here passed VACUOUSLY on that fixture, and a
    // vacuous pass is indistinguishable from a working guard at the call site.
    const fixture = [
      "async function gate() {",
      '  const v = "b" / (a); if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "x" }) / 2',
      "}"
    ].join("\n")
    const view = stripComments(fixture)
    for (const name of [LENIENT, "verifyUser"]) {
      expect(
        new RegExp(`\\b${name}\\s*\\(`).test(view),
        `the lexer blanked ${name}() behind a string division, so the scan would find nothing to check`
      ).toBe(true)
    }
  })

  it("the lexer still treats a regex literal as a literal", () => {
    // The mirror of the case above: the fix must not have broken genuine regex
    // detection, which is what stops `/^\/api\//` from blanking the whole file.
    const fixture = 'const m = path.match(/^\\/api\\/connectors\\/(.+)$/); if (m) return 1'
    const view = stripComments(fixture)
    expect(view, "a regex literal's body must be blanked, not scanned as code").not.toContain("api/connectors")
    expect(view, "the code around the regex literal must survive").toContain("path.match")
  })

  it("the only lenient hasUsers() reader in handlers.mjs is the first-run hint", () => {
    // Two reasoned non-gates remain (preference-key selection and the signup
    // hint). Every gate now asks for the strict answer by name, so the count is
    // pinned: one more lenient call means somebody re-opened the fail-open.
    const len = (CODE.match(new RegExp(`\\b${LENIENT}\\s*\\(`, "g")) ?? []).length
    expect(len, `handlers.mjs must contain exactly the ${ALLOWLIST.length} reasoned hasUsers() calls`).toBe(
      ALLOWLIST.length
    )
  })
})

describe("WS-7 AUTH-FAILOPEN — the stripper is string-aware, or the guard is switchable", () => {
  // THE CRITICAL FALSE NEGATIVE. handlers.mjs already has 13 lines containing a
  // quoted `//`, three of which put a URL default on the same line as route
  // logic (the Stripe success/cancel defaults and the 5173 origin default). A
  // stripper that only knows `//` and `/*` blanks from the `//` onward, which
  // erases any gate written on that line — and every predicate then passes
  // VACUOUSLY, on a scan set that found nothing.
  const URL_PREFIXED_GATE =
    'const home = "http://localhost:5173"; if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "authentication required" })'

  it("does not blank code after a // that lives inside a string literal", () => {
    const code = stripComments(URL_PREFIXED_GATE)
    expect(
      (code.match(/\bhasUsers\s*\(/g) ?? []).length,
      "the gate must survive a URL default on the same line"
    ).toBe(1)
    expect(code).toContain("401")
  })

  it("still blanks a real line comment on a line that also has a string", () => {
    const code = stripComments('const a = "http://x" // hasUsers() 401\nconst b = 1')
    expect(code).not.toContain("hasUsers")
    expect(code).toContain("const b = 1")
  })

  it("does not treat a regex literal containing // as a comment", () => {
    // NOT evidence of a past failure: a regex literal cannot contain a bare
    // `//`, because each slash is either a delimiter or escaped. This guards
    // the lexer's regex branch from mis-reading `/^\/api\//` as a comment and
    // blanking the rest of the file.
    const code = stripComments('const m = path.match(/^\\/api\\/x$/) // gone\nconst gate = hasUsers() && 401')
    expect(code).toContain("hasUsers")
    expect(code).not.toContain("gone")
  })

  it("a NOT-A-GATE marker pasted onto a gate does not excuse it", () => {
    // The escape that survives a bare marker check: copy an allowlist entry's
    // marker onto a real gate and the 12-line window finds it there. Binding
    // the marker to the CONTIGUOUS comment block immediately above the site, and
    // to that site's exact call expression, closes it.
    const planted = [
      `// ${ALLOWLIST[0].marker}`,
      '  if (path === "/api/zz" && req.method === "POST") {',
      '    if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "x" })',
      "  }"
    ].join("\n")
    const found = scanCallSites(planted)
    expect(found).toHaveLength(1)
    expect(isAccepted(found[0]), "a pasted marker must not excuse a gate").toBe(false)
  })

  it("a marker far above a gate — not in its own comment block — does not excuse it", () => {
    const planted = [
      `// ${ALLOWLIST[0].marker}`,
      "    const unrelated = 1",
      '  if (path === "/api/zz" && req.method === "POST") {',
      '    if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "x" })',
      "  }"
    ].join("\n")
    const found = scanCallSites(planted)
    expect(found).toHaveLength(1)
    expect(isAccepted(found[0]), "a marker on some other statement is not this site's marker").toBe(false)
  })

  it("catches the URL-prefixed gate with EVERY predicate, not just the window", () => {
    // The teeth fixture the first round of this guard lacked: its planted gate
    // had no URL, so the "four predicates caught it" evidence never covered the
    // spelling the codebase actually uses.
    const found = scanCallSites(stripComments(URL_PREFIXED_GATE))
    expect(found, "a URL-prefixed gate must be discovered at all").toHaveLength(1)
    expect(isAccepted(found[0]), "a URL-prefixed gate must be REJECTED, not excused").toBe(false)
    const idiom = new RegExp(`\\b${LENIENT}\\s*\\(`)
    const offenders = stripComments(URL_PREFIXED_GATE)
      .split("\n")
      .map((text, i) => ({ line: i + 1, text: text.trim() }))
      .filter((r) => idiom.test(r.text) && /\b40[13]\b/.test(r.text))
    expect(offenders, "the same-line fail-open idiom predicate must also see it").toHaveLength(1)
  })
})

describe("WS-7 AUTH-FAILOPEN — the guard's own teeth and the allowlist's honesty", () => {
  it("gives every allowlist entry a written reason and a live marker", () => {
    // NOT an "empty allowlist is the intended state" assertion: this list is
    // deliberately non-empty, because two `hasUsers()` calls are genuinely not
    // gates and the honest thing is to say which and why. What is pinned is
    // that an entry is a written justification rather than a bare marker, and
    // that its marker AND its anchor still EXIST in the source — a stale entry,
    // whose call site moved or was deleted, fails rather than silently excusing
    // a different one. The anchor is the half that stops a marker being lifted.
    for (const entry of ALLOWLIST) {
      expect(typeof entry.reason, "an allowlist entry must carry a written reason").toBe("string")
      expect(entry.reason.trim().length, "a bare marker is not an allowance").toBeGreaterThan(40)
      expect(
        SRC.includes(entry.marker),
        `allowlist entry is stale: its marker is no longer in handlers.mjs — ${entry.marker}`
      ).toBe(true)
      const anchorUses = SRC.split(entry.anchor).length - 1
      expect(
        anchorUses,
        `allowlist anchor must name exactly one live call expression in handlers.mjs: ${entry.anchor}`
      ).toBe(1)
    }
  })

  it("binds each allowlist entry to exactly the call site it excuses", () => {
    // The binding, asserted from the other side: every accepted site must have
    // its marker in its OWN comment block, and no allowlist entry may excuse
    // more than one site. Otherwise the entries are floating permission slips.
    const accepted = SITES.filter(isAccepted)
    expect(accepted.length, "each allowlist entry excuses exactly one site").toBe(ALLOWLIST.length)
    for (const site of accepted) {
      const owners = ALLOWLIST.filter((a) => site.above.includes(a.marker) && site.text.includes(a.anchor))
      expect(owners.length, `handlers.mjs:${site.line} must be claimed by exactly one entry`).toBe(1)
      for (const a of owners) {
        const otherClaims = accepted.filter(
          (s) => s !== site && s.above.includes(a.marker) && s.text.includes(a.anchor)
        )
        expect(otherClaims.length, "an entry may not excuse two sites").toBe(0)
      }
    }
  })

  it("rejects a gate-shaped hasUsers() call the way the rule describes", () => {
    // The guard's teeth, proven without touching handlers.mjs: run the SAME
    // classifier over a synthetic source that contains exactly the defect the
    // fourteen routes carried. A guard that cannot be shown to fail is not
    // known to work, and this is what "the 15th site" will look like.
    const planted = [
      '  if (path === "/api/example" && req.method === "POST") {',
      "    if (!(await verifyUser(auth)) && (await hasUsers())) {",
      '      return writeJson(res, 401, { error: "authentication required" })',
      "    }",
      "    return",
      "  }"
    ].join("\n")
    const found = scanCallSites(planted)
    expect(found).toHaveLength(1)
    expect(isAccepted(found[0]), "the planted gate must be REJECTED, not excused").toBe(false)
    expect(ALLOWLIST.some((a) => found[0].window.includes(a.marker))).toBe(false)

    // The single-line fail-open idiom is a second, sharper predicate. It is
    // exercised by the one-line spelling, which is how the defect is most often
    // re-introduced by a quick edit.
    const oneLine = '    if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "no" })'
    const idiom = new RegExp(`\\b${LENIENT}\\s*\\(`)
    const offenders = oneLine
      .split("\n")
      .map((text, i) => ({ line: i + 1, text: text.trim() }))
      .filter((r) => idiom.test(r.text) && /\b40[13]\b/.test(r.text))
    expect(offenders, "the planted one-line fail-open idiom must be caught").toHaveLength(1)

    // A gate call some lines above must NOT excuse a new site: that proximity
    // false negative is why the verdict ignores the window entirely.
    const belowALegalGate = [
      "    if (!(await requireSessionOrFirstRun(req, res))) return true",
      "    if (path === '/api/zz' && req.method === 'POST') {",
      "      if (!(await verifyUser(auth)) && (await hasUsers())) {",
      "        return writeJson(res, 401, { error: 'authentication required' })",
      "      }",
      "    }"
    ].join("\n")
    const below = scanCallSites(belowALegalGate)
    expect(below).toHaveLength(1)
    expect(
      isAccepted(below[0]),
      "a lenient call under a legitimate gate call is still an undocumented site"
    ).toBe(false)

    // And the real file must contain no such site — the same predicate, green.
    expect(SITES.filter((s) => !isAccepted(s)).map((s) => s.line)).toEqual([])
  })
})
