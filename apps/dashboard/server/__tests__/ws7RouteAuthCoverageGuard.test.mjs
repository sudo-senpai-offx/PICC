// WS-7 slice C — the WHOLE-TABLE route-auth invariant.
//
// WHY THIS FILE IS THE ANSWER TO THE FINDING, IN THE OWNER'S OWN FRAMING. The
// owner was shown ~40 /api/* routes answering anonymously, including two
// unauthenticated destructive deletes, and chose: "Gate everything,
// declared-public allowlist." This file is that choice made into a
// machine-enforced invariant rather than a one-time sweep.
//
// THE STRUCTURAL DEFECT THIS REPLACES. `ws7AuthBootstrapGateGuard` already holds
// 114 gate call sites in the repo, and its route predicate is scoped to the
// connectors FAMILY plus a hand-listed seed of one more route
// (`/api/trading/brokers`). Its own KNOWN LIMITATIONS section says the
// predicate recognises exactly three dispatch spellings — `path === "…"`,
// `path.startsWith("…")`, `path.match(/…/)` — and that a `switch` or a
// lookup-table dispatch "is INVISIBLE to it, and silently so: no site is
// discovered, so no assertion is made about it at all." That is the exact hole
// the executed probes fell through, and it is not a connectors-shaped hole: it
// is a hole in the PREDICATE. The connectors siblings were invisible for the
// same reason these ~40 were.
//
// SO THE DISCOVERY IS STRUCTURAL, AND IT COVERS FOUR FORMS. `path ===`,
// `path.startsWith`, `path.match` + its owning `if`, and the lookup-table
// object-literal entry (`"/api/browser/status": async (req, res, parsed) => {`).
// The fourth form is not hypothetical: `BROWSER_ROUTES` is 33 real routes at
// handlers.mjs:5211-5612, and under the three-spelling predicate not one of
// them would be checked. A `switch (path)` is DETECTED AND REFUSED rather than
// ignored, so a future author who introduces one gets a red build instead of
// silent coverage.
//
// WHY THE ALLOWLIST IS SELF-POLICING. A bare list of route names is a comment.
// Four ways it rots are each a failure here: an entry with no reason, an entry
// whose reason is a placeholder, the same route allowlisted twice, and an entry
// whose route the guard can no longer find in the dispatch (stale — the route
// was renamed and the entry is now excusing a different one, or nothing at all).
//
// WHY A MARKER IS BOUND TO ITS ROUTE, NOT FOUND NEAR ONE. The earlier rounds of
// the sibling guard learned this the expensive way: a 12-line proximity window
// and unbound markers let a real gate pass as "not a gate". This file does not
// use a proximity window anywhere, and an allowlist entry's `marker` IS its
// route's own dispatch line, matched verbatim against the discovered site. A
// marker lifted off one route cannot excuse another, because the other route's
// dispatch line is a different string. Where an entry's justification genuinely
// lives in the source as a comment, `sourceComment` may be supplied and the
// guard then REQUIRES that comment inside that route's own handler block —
// again, region-bound, never window-bound.
//
// AND, MORE FUNDAMENTALLY: this guard NEVER READS A COMMENT TO REACH A VERDICT.
// `isGated` consults the route's own code and nothing else. A comment saying
// "public by design" cannot excuse a gate, cannot excuse a missing gate, and
// cannot be pasted anywhere to change an outcome. That closes the class
// structurally rather than by a cleverer proximity rule.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { stripComments } from "../scripts/guard-primitives.mjs"

const HANDLERS = fileURLToPath(new URL("../handlers.mjs", import.meta.url))
const SRC = readFileSync(HANDLERS, "utf8")
const LINES = SRC.split("\n")

/** The shared gates. A site is gated by appearing in its OWN block, before it answers. */
const GATES = ["requireAuth(", "requireSessionOrFirstRun(", "requireAuthStrict("]

// ---------------------------------------------------------------------------
// COMMENTS BLANKED — the fix for C1, ported from ws7AuthBootstrapGateGuard
// ---------------------------------------------------------------------------
//
// WHY THIS FILE NEEDS IT, and why its own header used to be false. The header
// above claims "this guard NEVER READS A COMMENT TO REACH A VERDICT". That was
// asserted, not true. `isGated` scanned `site.region`, whose lines came from
// `LINES` — the RAW source — and asked whether any line CONTAINS a gate name. A
// comment is a line. So the claim and the code disagreed, and the disagreement
// had teeth: handlers.mjs:4364 (`GET /api/auth/status`) carries a nine-line
// comment whose prose contains the literal `requireSessionOrFirstRun(`. The
// guard reported that route — which has no gate at all — as GATED, and the
// inventory told the owner it was closed. Delete the real `requireAuth` from
// this slice's own alerts/delete route, leave the comment, and the build stays
// green.
//
// The sibling guard hit the same wall from the other side: handlers.mjs
// documents the defect it just fixed, so a scan that read comment text reported
// the documentation as an unfixed call site forever.
//
// `stripComments` is IMPORTED from `../scripts/guard-primitives.mjs` and was
// previously "ported here nearly verbatim" from that sibling — duplicated JSDoc
// included. Two copies is one too many: each had already shipped the vacuous-pass
// bug this file's header describes, where a simpler `//`-only stripper blanks a
// line carrying a URL in a string, leaves the gate on that line invisible, and
// makes every predicate in the file pass VACUOUSLY. There is now one lexer,
// shared by four guards, and it is STRING-AWARE (string CONTENTS preserved,
// because the dispatch predicates need the `"/api/health"` literal in the code
// view), REGEX-AWARE (regex bodies blanked, which is what makes the three
// `path.match(/^\/api\/…/)` routes enumerable at all), and LENGTH-PRESERVING.
// See the module for why division-after-a-closed-string must not be read as a
// regex, which is the same vacuous pass reached by a different road.
//
// Re-exported so `sharedCommentLexer.test.mjs` can assert this site's binding is
// `Object.is`-identical to the other three consumers'.
export { stripComments }

// ---------------------------------------------------------------------------
// DISCOVERY — four dispatch forms, all structural
// ---------------------------------------------------------------------------

// Form A/B. `if (path === "/api/…" …)` and `if (path.startsWith("/api/…") …)`.
// The OPERAND `path` is required, deliberately: `isApiRequest` uses
// `url.startsWith("/api/")` at handlers.mjs:995 and the OAuth callback builds
// `http://localhost:…/api/profile/github/callback` at :4566, and neither is a
// route dispatch.
const IF_DISPATCH = /path\s*===\s*["'`](\/api\/[^"'`]*)["'`]|path\.startsWith\(\s*["'`](\/api\/[^"'`]*)["'`]/
// Form C. The matcher line, whose handler is the `if (<name> …)` block after it.
const MATCHER_DISPATCH = /^const\s+(\w+)\s*=\s*path\.match\(/
// Form D. A lookup-table entry. `BROWSER_ROUTES` is the live instance: 33 routes,
// every one gated, and every one invisible to the three-spelling predicate.
const TABLE_DISPATCH = /^\s*"(?<route>\/api\/[^"]*)"\s*:\s*(?<handler>async\s*\(|function\b|\()/
// The UNSUPPORTED form. Present only so a new one is a red build.
const SWITCH_DISPATCH = /switch\s*\(\s*(?:path|parsed\.pathname)\s*\)/

/**
 * Every /api route the dispatcher recognises, with the block that handles it.
 *
 * `line` is the line the DISPATCH is written on, because that is what an
 * allowlist marker quotes. `region` is the route's own handler block, found by
 * indentation and terminated by the block's own closing brace — a gate in the
 * NEXT route cannot vouch for this one.
 */
function routeHandlerRegion(lines, index) {
  const line = lines[index]
  const trimmed = line.trim()
  // A SINGLE-LINE route ends on its own line, so its region is that line. Without
  // this the walk runs on into the next route, finds its gate, and reports an
  // ungated route as gated — the exact failure the sibling guard was bitten by.
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
    const nt = next.trim()
    if (indent === baseIndent && /^\}/.test(nt)) break
    if (indent > baseIndent) {
      region.push(next)
      continue
    }
    // The `if (<matcherName> …)` that follows a matcher line is the same dispatch.
    if (indent === baseIndent && /^if\s*\(/.test(nt)) {
      region.push(next)
      continue
    }
    break
  }
  return region
}

const isCommentish = (text) => {
  const t = text.trim()
  return t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
}

/**
 * The CONTIGUOUS run of comment/blank lines immediately above `index`.
 *
 * This is the route's OWN comment block and nothing else: the walk stops at the
 * first line of real code, so a comment belonging to the PREVIOUS route cannot
 * be reached. That is the difference from the 12-line window the earlier rounds
 * of the sibling guard used, where a marker pasted anywhere nearby excused a real
 * gate. A window is a neighbourhood; this is an attachment.
 *
 * Declared BEFORE discoverRouteSites, which calls it at module-evaluation time, so
 * it cannot sit below as a `const` arrow: that is a temporal-dead-zone
 * ReferenceError on the first site, not on some later one.
 */
function ownCommentBlock(lines, index) {
  let top = index
  while (top - 1 >= 0 && isCommentish(lines[top - 1])) top -= 1
  return lines.slice(top, index).join("\n")
}

/**
 * Every /api route the dispatcher recognises, with the block that handles it.
 *
 * `lines` is the RAW source, and that is deliberate: an allowlist `marker` is the
 * route's dispatch line VERBATIM as a human wrote it, including any trailing
 * comment, and `ownComment` has to be the real comment because the
 * `sourceComment` rule exists to let a justification live in the source. Both
 * come from the raw view.
 *
 * `region` is the OTHER view: the same block with every comment's content
 * blanked, and that is the only view `isGated` ever reads. Fix round 1 made
 * that split load-bearing — scanning the raw region meant a comment naming a
 * gate was a gate (C1). Discovery itself also runs against the blanked view, so a
 * dispatch written inside a comment is never mistaken for a real route.
 *
 * `rawRegion` is kept because `regionCarries` has to see comments to enforce the
 * `sourceComment` rule; it is never used to reach a gate verdict.
 *
 * One input, two views, computed here. Taking a second array as a parameter
 * would let a caller pass a raw view and silently restore the defect, which is
 * how the pre-fix version of this function came to scan comments in the first
 * place.
 */
function discoverRouteSites(lines) {
  const code = stripComments(lines.join("\n")).split("\n")
  const sites = []
  for (let i = 0; i < code.length; i += 1) {
    const line = code[i]
    const text = line.trim()
    if (text === "" || text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) continue

    // Form D. The table entry owns its own arrow-function body, so its region is
    // the block that follows it.
    const table = text.match(TABLE_DISPATCH)
    if (table) {
      sites.push({
        route: table.groups.route,
        line: i + 1,
        index: i,
        form: "table",
        marker: lines[i].trim(),
        ownComment: ownCommentBlock(lines, i),
        region: routeHandlerRegion(code, i),
        rawRegion: routeHandlerRegion(lines, i)
      })
      continue
    }

    // Form C. The matcher owns the `if (<name> …)` block that follows it.
    const matcher = text.match(MATCHER_DISPATCH)
    if (matcher) {
      const re = /path\.match\(\s*\/([^\n]*?)\/([a-z]*)/.exec(line)
      const pattern = re ? re[1] : "?"
      let j = i + 1
      while (j < code.length && !new RegExp(`^\\s*if\\s*\\(\\s*${matcher[1]}\\b`).test(code[j])) j += 1
      if (j < code.length) {
        sites.push({
          route: `match:/${pattern}/`,
          line: i + 1,
          index: j,
          form: "path.match",
          marker: lines[i].trim(),
          ownComment: ownCommentBlock(lines, i),
          region: routeHandlerRegion(code, j),
          rawRegion: routeHandlerRegion(lines, j)
        })
      }
      continue
    }

    // Form A/B. The dispatch must be the line's own code, not trailing prose, so
    // the match is required to sit BEFORE any `//`.
    const offset = line.search(IF_DISPATCH)
    if (offset === -1) continue
    const commentAt = line.indexOf("//")
    if (commentAt !== -1 && commentAt < offset) continue
    if (!/^if\s*\(/.test(text)) continue
    const m = IF_DISPATCH.exec(text)
    sites.push({
      route: m[1] ?? m[2],
      line: i + 1,
      index: i,
      form: text.includes("path.startsWith") ? "path.startsWith" : "path ===",
      marker: lines[i].trim(),
      ownComment: ownCommentBlock(lines, i),
      region: routeHandlerRegion(code, i),
      rawRegion: routeHandlerRegion(lines, i)
    })
  }
  return sites
}

const SITES = discoverRouteSites(LINES)

/** `switch (path)` is a dispatch form this guard does not model. It must be loud. */
const SWITCH_SITES = LINES.map((l, i) => ({ l, i }))
  .filter((r) => SWITCH_DISPATCH.test(r.l))
  .map((r) => `handlers.mjs:${r.i + 1}  ${r.l.trim()}`)

// ---------------------------------------------------------------------------
// "ANSWERS THE REQUEST" — and the two pre-gate responses that do not count
// ---------------------------------------------------------------------------

/** The part of the line that is STATEMENT rather than an `if (…)` head. */
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
 * Does this writeJson body carry DATA, or is it a static precondition?
 *
 * A response that discloses nothing cannot be the disclosure this guard protects
 * against, and this codebase uses cheap preconditions liberally. Two forms are
 * exempt:
 *   (a) any 4xx — by convention here a 4xx body is an error message, and the
 *       rate-limit and origin guards are all 4xx.
 *   (b) any status, when the body object is a STATIC literal: after string
 *       literals and `key:` labels are removed, no identifier survives. This form
 *       exists because two real sites (handlers.mjs:4755, :4786) answer
 *       `503 { error: "agents service not configured (set PICC_AGENTS_URL)" }`
 *       before their gate, and a 4xx-only rule calls those "gate too late".
 *
 * A body carrying `err.message`, a store read, or a template expression is NOT
 * static and is not exempt.
 */
function staticBody(rest) {
  const open = rest.indexOf("{")
  if (open === -1) return /^\s*res\s*,\s*4\d\d/.test(rest)
  let depth = 0
  let close = -1
  for (let i = open; i < rest.length; i += 1) {
    if (rest[i] === "{") depth += 1
    else if (rest[i] === "}") {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) return false
  const obj = rest.slice(open, close + 1)
  if (/\$\{|\bawait\b|\bnew\b|`/.test(obj)) return false
  let rest2 = obj.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, '""')
  rest2 = rest2.replace(/[A-Za-z_$][\w$]*\s*:/g, "_:")
  rest2 = rest2.replace(/\b(?:true|false|null)\b/g, "_")
  return !/[A-Za-z_$]/.test(rest2.replace(/_/g, ""))
}

/**
 * The offset of the first thing on this line that ANSWERS, or -1.
 *
 * `return true` / `return false` are this codebase's "handled" sentinels, not
 * responses. Counting them put six genuinely-gated routes on the ungated list —
 * `/api/trading/realtime`, `/api/packs/ack`, `/api/webfetch/limits/reset`, both
 * `/api/agents/*` routes and `/api/browser/stream` all write a 403/429 first
 * and then `return true`, and every one of them gates correctly. The sentinel
 * is excluded here, and only here; a `return <call>` still counts, which errs
 * toward a false failure.
 */
function firstAnswerOffset(line, before = Number.POSITIVE_INFINITY) {
  const { text, shift } = statementBody(line)
  const fourxxArgs = /^\s*res\s*,\s*4\d\d/
  const offsets = []
  const ret = /^\s*return\s/.exec(text)
  if (ret) {
    const rest = text.slice(ret.index + ret[0].length)
    if (/^\s*(?:true|false)\s*;?\s*$/.test(rest)) {
      // a control-flow sentinel, not a response
    } else {
      const write = /writeJson\s*\(/.exec(rest)
      const inner = write ? rest.slice(write.index + write[0].length) : rest
      if (!write || (!fourxxArgs.test(inner) && !staticBody(inner))) offsets.push(ret.index + shift)
    }
  }
  const write = /\bwriteJson\s*\(/.exec(text)
  if (write) {
    const inner = text.slice(write.index + write[0].length)
    if (!fourxxArgs.test(inner) && !staticBody(inner)) offsets.push(write.index + shift)
  }
  const res = /\bres\.(?:end|write|send|writeHead)\b/.exec(text)
  if (res) offsets.push(res.index + shift)
  const kept = offsets.filter((idx) => idx < before)
  return kept.length ? Math.min(...kept) : -1
}

const answersRequest = (line) => firstAnswerOffset(line) !== -1

/**
 * THE INLINE GATE IDIOM, in its two spellings.
 *
 *     const userId = await verifyUser(auth)
 *     if (!userId) return writeJson(res, 401, { error: "authentication required" })
 *
 * and
 *
 *     if (!(await verifyUser(auth))) {
 *       return writeJson(res, 401, { error: "authentication required" })
 *     }
 *
 * Seven routes gate the first way (`/api/income/overview`, `/api/data/*`,
 * `/api/stripe/checkout`, `/api/stripe/portal`, `/api/btcpay/invoice`,
 * `/api/btcpay/check`, `/api/collectors/cashpilot`) and one the second. A guard
 * that only knew the three shared-gate names would report all eight as ungated,
 * and the fix an author would reach for — bolt a `requireAuth` onto each — would
 * throw away the per-user `userId` the first six need. So both are recognised.
 *
 * The refusal may sit on the `if` line or on the line after it, because the second
 * spelling opens a block. The gate is the `if` line either way, so the refusal is
 * never counted as a pre-gate disclosure.
 *
 * ITS KNOWN WEAKNESS, which is not this file's to fix and is stated rather than
 * claimed away: `verifyUser()` answers null when the SESSIONS store faults, so
 * these eight fail CLOSED with the wrong status (401 where the shared gate
 * answers 503). No access is granted, which is why it is a gap and not a hole.
 */
const INLINE_ASSIGNED = /await\s+verifyUser\s*\(/
const INLINE_DIRECT = /if\s*\(\s*!\s*\(\s*await\s+verifyUser\s*\(|if\s*\(\s*!\s*await\s+verifyUser\s*\(/
const REFUSAL = /writeJson\s*\(\s*res\s*,\s*40[13]/

function inlineGateOffset(region) {
  const verifyAt = region.findIndex((l) => INLINE_ASSIGNED.test(l))
  if (verifyAt === -1) return -1
  for (let i = verifyAt; i < region.length; i += 1) {
    const l = region[i]
    const refuses =
      (/if\s*\(\s*!\s*(?:userId|uid)\s*\)/.test(l) && REFUSAL.test(l)) || INLINE_DIRECT.test(l)
    if (!refuses) continue
    // The refusal may be the `if` line itself or the first line of the block it
    // opens. Anything further away is a different statement, not this gate.
    const tail = i + 1 < region.length ? region[i + 1] : ""
    if (REFUSAL.test(l) || REFUSAL.test(tail)) return i
  }
  return -1
}

/**
 * IS THE GATE ON AN UNCONDITIONAL PATH? The fix for C2.
 *
 * The pre-fix `isGated` asked "is there a gate-bearing line before the first
 * line that answers". That is a question about TEXT and the thing that matters
 * is about CONTROL FLOW, and on handlers.mjs:3687 the two came apart: the gate
 * text `if (!(await requireAuth(req, res))) return true` sits at the top of a
 * block guarded by
 *
 *     if (req.method === "POST" && ["webhook-settings","webhook-test"].includes(action))
 *
 * so a GET — and `read`, `read-all`, `clear` and inject — never passes it, and
 * `clear` DELETES stored notifications for an anonymous caller. The comment
 * above it states an intent the code does not implement.
 *
 * THE DISCRIMINATOR, and it is the cheap one: a block that has already CLOSED
 * before the gate cannot enclose it. `/api/trading/realtime`, `/api/packs/ack`
 * and `/api/webfetch/limits/reset` each sit behind an `if` that writes a 4xx and
 * returns, so their gates are at the region's top level and stay unconditional.
 * A predicate that counted "any enclosing `if` anywhere above" would exonerate
 * their real gates and put three genuinely-gated routes on the offender list —
 * the mirror image of the defect. Only blocks that are still OPEN at the gate's
 * position count, and only if they are ones that may not execute.
 *
 * WHY NESTING AND NOT "the gate must be the region's first statement", which is
 * the other cheap rule and is wrong: `const { svc } = await import(...)` before
 * a gate is ordinary and does not make the gate conditional. Dozens of real
 * routes are written that way, and that rule would have put every one of them on
 * the offender list — a false positive is how a guard gets switched off.
 *
 * `try` / `finally` / a bare block do not introduce conditionality: their bodies
 * are reached whenever the statement is reached. `if` / `else` / `for` / `while`
 * / `do` / `switch` / `catch` do, because their bodies are reached only on some
 * requests.
 */
const CONDITIONAL_OPENERS = /^(?:if|else|for|while|do|switch|catch)\b/
// A CLOSING BRACE CAN LEAD THE LINE, and then the opener keyword is not at the
// start. `} else {`, `} else if (x) {` and `} catch (err) {` are ordinary control
// flow — which is exactly why this went unnoticed for a round. The stack was
// already correct (braceRoles returns ["close","open"] for such a line, so the `}`
// popped and the `{` pushed); the `conditional` flag was computed from the LINE
// TEXT, which does not begin with `else` or `catch`, so it pushed `false` and a
// gate inside was reported UNCONDITIONAL — the unsafe direction, a false pass.
// A second anchored pattern would have been the fix; this one is a second
// pattern because a `}`-led line is a distinct shape, not a variant of the first.
const CONDITIONAL_CLOSER_OPENERS = /^\}\s*(?:else|catch)\b/
const NEUTRAL_OPENERS = /^(?:try|finally)\b/
// The neutral neighbour of the rule above, and the reason the fix cannot be
// written as "a `}` at the start of the line means conditional": a `finally`
// block ALWAYS runs when reached, so a gate after one is still unconditional.
// Asserted by the `} finally {` control test.
const NEUTRAL_CLOSER_OPENERS = /^\}\s*finally\b/
// The words after which a `{` is a BLOCK rather than an object literal. `const`
// is deliberately absent: `const { notify, getNotifications } = await import(…)`
// opens a destructuring pattern, and reading it as a block made every
// import-then-gate route look conditional.
const BLOCK_WORD_BEFORE = /(?:^|[^\w$])(?:if|else|for|while|do|switch|catch|try|finally)\s*$/

/**
 * Classify each brace on a line: a block opener, a block closer, or neither.
 *
 * NEEDED, and not decoration. The first cut of the C2 fix counted every `{` as
 * a block opener, and the control test that exists to stop a false positive
 * caught it immediately: `if (!env.thing) return writeJson(res, 503, { error:
 * "thing not configured" })` opens an OBJECT literal mid-line, so the counter
 * popped the region root, then re-pushed the payload's `{` as a conditional
 * opener, and the genuinely-unconditional gate after it was reported nested in a
 * conditional. Distinguishing a block from an object literal is a parser question;
 * the cheap discriminator is the preceding token, and it is exact for every shape
 * in this file.
 */
function braceRoles(line) {
  const roles = []
  let quote = null
  let prevChar = ""
  let prevWord = ""
  for (let k = 0; k < line.length; k += 1) {
    const c = line[k]
    if (quote) {
      if (c === "\\") k += 1
      else if (c === quote) {
        quote = null
        prevChar = c
        prevWord = ""
      }
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      prevChar = c
      prevWord = ""
      continue
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\n") continue
    if (c === "{") {
      const isBlock =
        prevChar === "" ||
        prevChar === ")" ||
        prevChar === ";" ||
        prevChar === "{" ||
        prevChar === "}" ||
        prevChar === ">" ||
        BLOCK_WORD_BEFORE.test(prevWord)
      roles.push(isBlock ? "open" : "object")
      prevChar = "{"
      prevWord = ""
      continue
    }
    if (c === "}") {
      roles.push("close")
      prevChar = "}"
      prevWord = ""
      continue
    }
    if (/[\w$]/.test(c)) {
      prevWord += c
      prevChar = c
      continue
    }
    if (c === "=" && line[k + 1] === ">") {
      prevWord = ""
      prevChar = ">"
      k += 1
      continue
    }
    prevWord = ""
    prevChar = c
  }
  return roles
}

/**
 * The reason `region[gateAt]` is only reached on SOME requests, or null when it
 * is reached on every request that entered the region.
 */
function conditionalReason(region, gateAt, gateOffsetOnLine = null) {
  const stack = []
  for (let i = 0; i < region.length; i += 1) {
    const line = region[i]
    const text = line.trim()
    if (text === "") continue
    const roles = braceRoles(line)
    // A `}` closes a block opened earlier, so it can never enclose the gate.
    for (const role of roles) if (role === "close") stack.pop()

    if (i === gateAt) {
      // The gate's own line: an opener in the statement body BEFORE the gate puts
      // the gate inside it, exactly as a block would. The region's own dispatch
      // `if` is excluded because statementBody() has already consumed it.
      if (gateOffsetOnLine !== null) {
        const { text, shift } = statementBody(line)
        const before = text.slice(0, Math.max(0, gateOffsetOnLine - shift))
        // THE GATE'S OWN `if` IS NOT A CONTAINER. All three shared-gate idioms
        // in this file are spelled `if (!(await <gate>(`, so the text immediately
        // before the gate ALWAYS ends in `if (!(await ` — and a naive scan for
        // `if (` reports every one of those 123 gates as nested, which is the
        // false positive round 2 flagged: `const h = 1; if (!(await requireAuth(…))`
        // came back as "the gate is inside a conditional opened on the dispatch
        // line". Stripping that exact tail removes the false positive without
        // blinding the check, because a real container is a DIFFERENT opener that
        // appears EARLIER on the line.
        const withoutOwnHead = before.replace(/\s*if\s*\(\s*!\s*\(\s*await\s*$/, "")
        // Only the statement the gate is actually in matters, so a FINISHED
        // statement ahead of it is ignored. The boundary is `;` or `}` — and
        // deliberately NOT `{`, because a `{` is where a container's BODY
        // begins: cutting at it would throw away the very opener under test.
        const boundary = Math.max(withoutOwnHead.lastIndexOf(";"), withoutOwnHead.lastIndexOf("}"))
        const statement = boundary === -1 ? withoutOwnHead : withoutOwnHead.slice(boundary + 1)
        // A conditional whose `(` is still open on this line, e.g. `if (limit > 0) { …`.
        if (/\b(?:if|for|while|switch|catch)\s*\([^)]*$/.test(statement)) {
          return "the gate is inside a conditional opened on the dispatch line"
        }
        // Or a `{` still open, whose opener text names a conditional. This is the
        // `const limit = 5; if (limit > 0) { if (!(await GATE(…)) … }` shape, and
        // it is why the boundary above stops at `;` and `}`.
        let depth = 0
        let unclosedAt = -1
        for (let z = 0; z < statement.length; z += 1) {
          if (statement[z] === "{") {
            depth += 1
            unclosedAt = z
          } else if (statement[z] === "}") {
            depth -= 1
            if (depth === 0) unclosedAt = -1
          }
        }
        if (unclosedAt !== -1 && /\b(?:if|else|for|while|do|switch|catch)\b/.test(statement.slice(0, unclosedAt))) {
          return "the gate is inside a conditional opened on the dispatch line"
        }
      }
      return stack.some(Boolean)
        ? "the gate is nested inside a conditional block, so it does not run for every request to this route"
        : null
    }

    // The region's first line is the dispatch itself. Its block is the ROOT and
    // always executes — otherwise every route would be "conditional" in itself.
    const isRoot = i === 0
    const enclosing = stack.some(Boolean)
    const neutral = NEUTRAL_OPENERS.test(text) || NEUTRAL_CLOSER_OPENERS.test(text)
    const conditionalOpen = CONDITIONAL_OPENERS.test(text) || CONDITIONAL_CLOSER_OPENERS.test(text)
    const conditional = isRoot ? false : neutral ? enclosing : enclosing || conditionalOpen
    for (const role of roles) if (role === "open" || role === "object") stack.push(conditional && role === "open")
  }
  return null
}

/**
 * Every gate name that appears inside STRING CONTENT, as `handlers.mjs:<line>  <gate>`.
 *
 * The backstop for the second half of C1. `stripComments` blanks comment content
 * but deliberately PRESERVES string contents, because the dispatch predicates need
 * to see route literals in the code view. That is only safe while no string holds
 * something that looks like a gate call:
 *
 *     const note = "remember to call requireAuth() here"
 *
 * is a comment in all but spelling, and `isGated` would read it as the route's
 * gate. So this scans the CODE view and reports any gate name inside a literal.
 *
 * STATEFUL ACROSS LINES, and that is the whole point — see the fix in the teeth
 * block. The first version iterated LINES and reset `quote` per line, so a
 * backtick that opened on one line and closed on a later one was never entered
 * as a string at all, and a gate name inside such a template was MISSED while
 * `isGated` still returned `true` for it. A single-line string was caught; only
 * the multi-line template escaped, and it escaped into a false PASS.
 */
function stringGateNames(src) {
  const offenders = []
  // ONE pass over the whole CODE view, with the literal state CARRIED ACROSS
  // LINES. The first version iterated lines and reset `quote` per line, which is
  // what let a multi-line template literal through: the backtick that opened on
  // one line was never matched to its closer, so nothing in between was ever
  // recognised as string content, and a gate name inside it was MISSED while
  // `isGated` still returned true for the same text.
  //
  // The newline rule mirrors the one `stripComments` itself applies: a `'` or `"`
  // cannot span lines in JavaScript, so a newline closes them, but a backtick CAN
  // and does — a template literal with `${…}` interpolation is ordinary. Getting
  // this backwards in either direction is a bug: closing a template at the
  // newline would flag the rest of the file, and carrying a `'` across the newline
  // would blind the scan to the next line's real literals.
  const code = stripComments(src)
  let quote = null
  let buf = ""
  let line = 1
  const flush = (at) => {
    for (const g of GATES) if (buf.includes(g)) offenders.push(`handlers.mjs:${at}  ${g}`)
    buf = ""
  }
  for (let k = 0; k < code.length; k += 1) {
    const c = code[k]
    if (quote) {
      if (c === "\\") {
        buf += code[k + 1] ?? ""
        k += 1
        continue
      }
      if (c === quote) {
        flush(line)
        quote = null
        continue
      }
      if (c === "\n") {
        if (quote === "`") {
          // A template literal CONTINUES onto the next line.
          line += 1
          buf += "\n"
          continue
        }
        // An unterminated `'` or `"` cannot span lines: end it here rather than
        // swallowing the rest of the file.
        flush(line)
        quote = null
        line += 1
        continue
      }
      buf += c
      continue
    }
    if (c === "\n") {
      line += 1
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      buf = ""
    }
  }
  // A file ending inside a template still has to be reported, or an unterminated
  // backtick would be a way to hide the corpus.
  if (quote) flush(line)
  return offenders
}

/**
 * THE VERDICT. A site is GATED when a gate sits in its OWN block, BEFORE the
 * route answers, and on a path every request to the route takes. All three
 * halves matter: a gate after the response is dead code, a presence-only check
 * calls dead code safety, and a gate that only some requests reach (C2) is not a
 * gate for the route at all.
 */
function isGated(site) {
  const region = site.region
  let gateAt = -1
  let inline = false
  for (let i = 0; i < region.length; i += 1) {
    if (GATES.some((g) => region[i].includes(g))) {
      gateAt = i
      break
    }
  }
  if (gateAt === -1) {
    const at = inlineGateOffset(region)
    if (at !== -1) {
      gateAt = at
      inline = true
    }
  }
  if (gateAt === -1) return { ok: false, why: "no gate in this route's own block" }

  for (let i = 0; i < gateAt; i += 1) {
    if (answersRequest(region[i])) return { ok: false, why: "the route answers BEFORE its gate" }
  }
  // On the gate's own line, only what sits IN FRONT of the gate call counts, so
  // the gate's trailing `return true` is not mistaken for an answer.
  const line = region[gateAt]
  let gateOffset = null
  if (!inline) {
    const offsets = GATES.map((g) => line.indexOf(g)).filter((o) => o !== -1)
    gateOffset = offsets.length ? Math.min(...offsets) : -1
    if (gateOffset !== -1 && firstAnswerOffset(line, gateOffset) !== -1) {
      return { ok: false, why: "the route answers BEFORE its gate" }
    }
  }
  // THE C2 CHECK. For an inline gate the `if` IS the gate, so only a block still
  // open above it can make it conditional.
  const conditional = conditionalReason(region, gateAt, gateOffset === null ? null : gateOffset)
  if (conditional) return { ok: false, why: conditional }
  return { ok: true, how: inline ? "inline verifyUser idiom" : "shared gate" }
}

// ---------------------------------------------------------------------------
// THE DECLARED-PUBLIC ALLOWLIST
// ---------------------------------------------------------------------------
//
// `marker`  the route's OWN dispatch line, verbatim. Bound by exact match to a
//            discovered site, so it cannot be lifted onto another route.
// `reason`  a written justification, not a marker. The guard fails on a short
//            one and on a placeholder one.
// `sourceComment` OPTIONAL, and where present REQUIRED to be inside this route's
//            own handler block. Used only where the justification genuinely
//            lives in the source already; never searched by proximity.
// `owner`   "declared" = public by a decision that HAS been made. Three ways a
//            row earns it, and all three are decisions rather than defaults:
//            (a) the source itself states the public intent (a `sourceComment`
//            entry, or a route comment that says so);
//            (b) the route is STRUCTURALLY public — you cannot require a
//            session to log in, to learn whether a session exists, or to receive
//            a server-to-server webhook;
//            (c) THE OWNER RULED IT PUBLIC. That is where all 38 of T20R's
//            deferred rows now sit, and their reasons say so in as many words.
//            "decision" = NOT YET RULED ON BY THE OWNER, and the population the
//            owner is being asked to decide. IT IS CURRENTLY EMPTY, and the
//            assertion that it stays empty is in this file. It is not a
//            permanent deletion of the vocabulary: it is the honest label for a
//            row that has no ruling behind it, and a future row that genuinely
//            has none must be able to use it — which is exactly why the count is
//            asserted at 0 rather than the field being removed.
// ---------------------------------------------------------------------------
const PLACEHOLDER_REASONS = [
  "todo",
  "tbd",
  "fixme",
  "n/a",
  "na",
  "public",
  "ok",
  "fine",
  "safe",
  "same as above",
  "see above",
  "no reason",
  "because",
  "later",
  "xxx",
  "wip"
]

/** @type {{marker: string, reason: string, owner: "declared" | "decision", sourceComment?: string}[]} */
const DECLARED_PUBLIC = [
  // ==========================================================================
  // WS-7 T20R — THE OWNER'S 2026-09-30 RULING ON THESE ENTRIES, IN ONE PLACE
  // ==========================================================================
  //
  // The T20R ruling had three parts, and they are worth restating here because
  // the `owner` field alone cannot express the difference between "public because
  // I decided so" and "public because I have not looked yet":
  //
  //   1. GATE every genuinely-mutating single-method route among the then-pending
  //      decision entries, and DELETE those allowlist entries. Gated: 21.
  //      The `no route is BOTH gated and allowlisted` assertion below is what
  //      makes the deletion non-optional — a gate with a surviving entry would be
  //      red.
  //
  //   2. KEEP a short must-be-public list as explicit `declared` entries, each
  //      with a real reason, with no `owner: "decision"` left among them. Ruled
  //      public: /api/metrics, /api/packs/registry and the /api/notifications
  //      wrapper (already declared before T20R: /api/health,
  //      /api/notifications/vapid-public-key, /api/auth/me, /api/auth/status,
  //      /api/auth/signup, /api/auth/login, /api/auth/signout,
  //      /api/settings/session-capture, /api/system/capabilities).
  //
  //   3. DEFER the remaining reads. They stayed owner:"decision", untouched and
  //      honestly labelled: 62 of them.
  //
  // ── AND THEN THE OWNER RULED ON THOSE 62 AS WELL. THIS BLOCK IS THE RECORD ──
  //
  // T20R's part 3 was a deferral, and a deferral that nobody ever returns to is
  // not a deferral, it is an abandoned queue. So the owner has now ruled on every
  // one of the 62, and the consequences are recorded here rather than inferred:
  //
  //   * 24 GATED and their allowlist entries DELETED — not reworded. A gated
  //     route with a surviving entry is the exact rot this file exists to catch,
  //     and the "no route is BOTH gated and allowlisted" assertion is what holds
  //     the line. Each one also carries a negative 401 assertion at the HTTP
  //     boundary in `routeAuthRuling24Gates.test.mjs`, because a static scan is
  //     satisfied by a gate that never runs.
  //   * 36 RULED PUBLIC, reclassified to `declared`, each with its reason
  //     corrected to describe what the code actually does.
  //   * 2 RULED PUBLIC and reclassified to `declared` as STANDING RECORDS:
  //     /api/stripe/webhook and /api/profile/github/callback. Both are
  //     authenticated by something other than a session, so neither can carry
  //     requireAuth, and the owner has confirmed that is the intended design
  //     rather than a pending question. Their entries say so in as many words.
  //
  // `owner: "decision"` IS NOW 0, and that is asserted in this file so the
  // deferred set cannot silently regrow: a new allowlist row that arrives without
  // an owner ruling fails the build instead of joining a queue nobody reads.
  //
  // A NOTE ON WHAT "GATE" MEANS HERE, because it is a rule and not a preference:
  // `requireAuth(req, res)` as the FIRST statement of the branch, ahead of any
  // precondition. A gate placed after a `validateOr400` or after a `503 not
  // configured` response is dead code, and `isGated` rejects exactly that
  // ("the route answers BEFORE its gate"). T9 established the runtime half of
  // the rule — a static scan can be satisfied by a gate that never runs — so
  // every route gated here also carries a negative 401 assertion.
  //
  // TWO MUTATING ROUTES THE RULE REACHED AND T20R DID NOT FOLLOW, both now
  // reclassified as standing records and neither left `decision`: /api/stripe/webhook
  // (authenticated by HMAC signature; a session gate would reject every real
  // delivery) and /api/profile/github/callback (a browser redirect that cannot
  // carry an Authorization header). Following the rule mechanically on either one
  // would have been a functional regression.

  // ── Health / liveness / status ───────────────────────────────────────────
  {
    marker: 'if (path === "/api/health" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Liveness surface. Discloses app version, which provider integrations are compiled in, a serper " +
      "verdict and the agents-service health probe. No user data, no store read. A health check that " +
      "required a session could not report health for an unauthenticated instance. DECISION ITEM: the " +
      "provider/serper verdicts are environment reconnaissance; the owner may want them behind a gate " +
      "on non-loopback. RECOMMENDATION: leave public.",
    owner: "declared"
  },
  {
    // RULED PUBLIC BY THE OWNER, and the reason is corrected rather than inherited.
    //
    // IT USED TO SAY the snapshot was "Machine-level. DECISION ITEM: the calibration
    // and autopilot sections describe how this instance is configured... it carries no
    // per-user rows." Both halves of that were wrong in the way this branch exists to
    // catch. WHAT THE CODE ACTUALLY DOES, and it is checkable at the HTTP boundary:
    // the handler fetches 200 candles from a live broker on EVERY request
    // (`fetchCandles`, handlers.mjs) and times the result, so an anonymous caller
    // can drive an unbounded sequence of live-broker round trips. That is an
    // outbound-spend surface, not a local status read, and "machine-level" does not
    // describe it.
    //
    // RULED PUBLIC ANYWAY, on the stated ground that the rate limit is the control
    // for it — the same ground the 21 market-data proxies rest on. The gate would not
    // have been wrong; it was ruled not to be the answer here.
    marker: 'if (path === "/api/trading/health" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Live trading-health probe, and it is NOT compute-only: the handler fetches 200 " +
      "candles from a live broker per request and reports the timing alongside the " +
      "freshness, autopilot and calibration sections, so an anonymous caller can drive " +
      "repeated live-broker round trips. That outbound spend is the real exposure " +
      "here, and it is machine-level in the sense that matters: no per-user row and no " +
      "caller-keyed store is read. RULED PUBLIC BY THE OWNER on the ground that the " +
      "rate limit is the control for an outbound-fetch surface, the same ground the " +
      "market-data proxies rest on. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/scheduler/status" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Scheduler registry: which jobs are registered, last run, next run. Machine-level: it reads no " +
      "per-user store and returns no per-user row. It does disclose job names, which reveals which features " +
      "this deployment has enabled. RULED PUBLIC BY THE OWNER as one of the static machine-state reads. " +
      "STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/signals/status" && req.method === "GET") {',
    reason:
      "Advisory signal-window countdown state, which the in-app chip polls. Shared engine state: no " +
      "per-user store is read and no per-user row is returned. RULED PUBLIC BY THE OWNER as one of the " +
      "static machine-state reads. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/btcpay/status" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "BTCPay node health probe. Reports whether the node is configured and reachable; it carries no " +
      "invoice, amount or per-user row. What it does disclose is node reachability, which is environment " +
      "reconnaissance about this deployment. RULED PUBLIC BY THE OWNER as one of the static machine-state " +
      "reads. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    // T20R: RULED PUBLIC by the owner, and the reason is the scrape contract
    // rather than an assumption. Verified while ruling: `getAll` finds NO consumer
    // of /api/metrics anywhere in apps/dashboard — no component, no client lib,
    // no test. It exists for an external Prometheus-style scraper, which by
    // convention holds no session and cannot send an Authorization header, so a
    // session gate here would make the endpoint unscrapeable rather than safer.
    // Network-level access control (bind address / reverse-proxy ACL) is the
    // control, and that is a deployment decision rather than a route decision.
    marker: 'if (path === "/api/metrics" && req.method === "GET") {',
    reason:
      "Prometheus scrape endpoint: request counters, duration histograms and route labels. No user data, " +
      "no store read of per-user rows — the labels are route names, not callers. RULED PUBLIC by the owner: " +
      "a metrics scraper holds no session and cannot present a bearer token, so gating it would break " +
      "monitoring rather than protect anything. Verified during T20R that no in-repo client consumes it. " +
      "RECOMMENDATION: keep public and enforce access at the network layer.",
    owner: "declared"
  },

  // ── Market data / analytics (no user data) ───────────────────────────────
  {
    marker: 'if (path === "/api/finance/quote" && req.method === "POST") {',
    reason:
      "Public equity/ETF quotes for caller-supplied tickers, bounded to 20 by the handler. Pure " +
      "third-party market data keyed by the caller's own request body; no store read and no per-user " +
      "row crosses. RULED PUBLIC BY THE OWNER as one of the outbound market-data proxies, whose real " +
      "control is the rate limit rather than a session. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/finance/forecast" && req.method === "POST") {',
    reason:
      "Price-history forecast for a caller-supplied ticker, derived entirely from public market data. " +
      "No store read and no per-user row crosses. RULED PUBLIC BY THE OWNER as one of the outbound " +
      "market-data proxies, whose real control is the rate limit rather than a session. STANDING " +
      "RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/crypto/market" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Public crypto market snapshot from a third-party aggregator: prices, market caps and 24h moves for " +
      "the caller's coin list. It reads no store and returns no per-user row; every value comes from an " +
      "upstream public API keyed by the caller's own request. RULED PUBLIC BY THE OWNER as one of the " +
      "outbound market-data proxies, whose real control is the rate limit rather than a session — gating it " +
      "would add nothing an upstream public API does not already give away. Its siblings /api/crypto/price " +
      "and /api/yields are on the same footing. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/crypto/price" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Public crypto price for a caller-supplied coin id: price, market cap and 24h move, straight from " +
      "an upstream public aggregator. It reads no store and returns no per-user row, and the coin id comes " +
      "from the caller's own request body. RULED PUBLIC BY THE OWNER as one of the outbound market-data " +
      "proxies, whose real control is the rate limit rather than a session; its sibling /api/crypto/market " +
      "is on exactly the same footing. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/yields" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Public treasury and DEX yield snapshot for the caller's instruments. Every value is upstream " +
      "public data keyed by the caller's own request; there is no store read and no per-user row. RULED " +
      "PUBLIC BY THE OWNER as one of the outbound market-data proxies, whose real control is the rate " +
      "limit rather than a session, on the same footing as /api/crypto/market and /api/crypto/price. " +
      "STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/predict" && req.method === "POST") {',
    reason:
      "Model prediction for a caller-supplied symbol and horizon. Reads market data keyed by the " +
      "caller's own request body and no store at all, so no per-user or operator row crosses. " +
      "RULED PUBLIC BY THE OWNER as one of the outbound market-data proxies, whose real control is " +
      "the rate limit rather than a session — the same ground as its /api/trading/pro/analyze " +
      "sibling below. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    // D2/AC-005: the `/api/trading/analyze` allowlist entry is REMOVED with the
    // route. Its only implementation was `analyzeExpertOptionAsset`, deleted with
    // the ExpertOption venue, so the dispatch line no longer exists and the
    // entry would read as coverage while excusing nothing — which is exactly the
    // rot this guard exists to prevent. It is deleted, not re-pointed: the
    // surviving venue-agnostic analyses are `/api/trading/pro/analyze` and
    // `/api/trading/predict`, both still allowlisted below.
    marker: 'if (path === "/api/trading/pro/analyze" && req.method === "POST") {',
    reason:
      "Pro-tier asset analysis over a caller-supplied symbol. Reads market data keyed by the caller's " +
      "own request body and no store at all. RULED PUBLIC BY THE OWNER as one of the outbound " +
      "market-data proxies, whose real control is the rate limit rather than a session. STANDING " +
      "RECORD, not an open question.",
    owner: "declared"
  },
  {
    // D2/AC-005: the `/api/trading/pro/expertoption` allowlist entry is REMOVED
    // with the route. Its only implementation was `proAnalyzeExpertOption`,
    // deleted with the venue.
    //
    // AND THE `/api/trading/pro/narrative` ENTRY THAT USED TO SIT HERE IS DELETED.
    // It summarised a caller-supplied pro-analysis report through a paid model, so an
    // anonymous caller could drive LLM spend on it; it is now GATED. A gated route
    // with a surviving allowlist row reads as coverage while excusing nothing, which is
    // the rot this file exists to prevent, so the row is removed rather than reworded.
    //
    // D2/AC-005: the `/api/trading/feed-mode` allowlist entry is REMOVED with
    // the route. It read and wrote the feed-mode preference and reported live-LEG
    // health; every leg it described belonged to the deleted ExpertOption
    // transport (liveEO.mjs owned getFeedMode/setFeedMode and the leg stats).
    // The DECISION ITEM this entry recorded — "gate the POST, it MUTATES shared
    // state an anonymous caller can flip" — is MOOT: the route no longer exists,
    // so there is nothing left to gate. Recorded here rather than silently
    // dropped, because losing the decision silently would be the rot this file
    // exists to prevent.
    marker: 'if (path === "/api/trading/news" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "News digest for a caller-supplied symbol or topic. Third-party content keyed by the caller's " +
      "own request; no store read and no per-user row crosses. RULED PUBLIC BY THE OWNER as one of " +
      "the outbound market-data proxies, whose real control is the rate limit rather than a session. " +
      "STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    // CORRECTED, because its old reason claimed "no store read and no user data crosses" and
    // the store claim is false: when the caller supplies NO symbols this route falls back
    // to `getWatchlist()`, which reads the operator's saved watchlist. So it is not
    // purely caller-keyed, which is what the old wording implied.
    //
    // NOT GATED, because the owner's ruling named 24 routes and this is not one of them.
    // FLAGGED FOR A FOLLOW-UP RULING alongside /api/trading/watchlists and
    // /api/trading/candles, which have the same shape of per-user exposure.
    marker: 'if (path === "/api/trading/scan" && req.method === "POST") {',
    reason:
      "Opportunity scan over caller-supplied symbols, with live market data as its only priced input. " +
      "IT IS NOT PURELY CALLER-KEYED: when the caller supplies no symbols this route falls back to " +
      "getWatchlist(), which reads the operator's own saved watchlist - so the old \"no store read\" was " +
      "wrong. STILL PUBLIC because the owner's ruling named 24 routes and this is not one of them; " +
      "NEEDS A FOLLOW-UP RULING, and the symbol count should be bounded as the screener sibling already " +
      "is. Left ungated deliberately, and recorded rather than corrected away.",
    owner: "declared"
  },
  {
    // CORRECTED, and it is one of the ten reasons this round found FACTUALLY WRONG.
    //
    // IT SAID: "OHLCV candles for a caller-supplied asset and timeframe... Reads the
    // liveEO buffer and Yahoo, not a user store." The second clause is false: this POST
    // also reads `chart-prefs.json`, which is keyed BY userId, so the stored chart
    // preferences are part of the answer alongside the caller's own symbol and timeframe.
    //
    // WHAT IT IS NOW, and checkable: the candles themselves still come from the liveEO
    // buffer and Yahoo, keyed by the caller's request, but the response's preference
    // fields are read from a per-user store. So this is NOT purely caller-keyed.
    //
    // NOT GATED, and the reason is recorded rather than implied: the owner's ruling named
    // 24 routes and this is not one of them. FLAGGED FOR A FOLLOW-UP RULING, because a
    // per-user store read served anonymously is the same class as the reads this round
    // gated. Left ungated deliberately.
    marker: 'if (path === "/api/trading/candles" && req.method === "POST") {',
    reason:
      "OHLCV candles for a caller-supplied asset and timeframe, with honest source/timeframe tagging. " +
      "THE CANDLES come from the liveEO buffer and Yahoo and are keyed by the caller's own request, but " +
      "this route ALSO READS chart-prefs.json, which is keyed BY userId - so the old \"not a user store\" " +
      "was wrong and the stored chart preferences are part of the answer. That makes it a per-user read " +
      "served anonymously. STILL PUBLIC because the owner's ruling named 24 routes and this is not one " +
      "of them; NEEDS A FOLLOW-UP RULING. Left ungated deliberately, and recorded rather than corrected " +
      "away.",
    owner: "declared"
  },
  {
    // CORRECTED, and it is one of the ten reasons this round found FACTUALLY WRONG.
    //
    // IT SAID: "Third-party macro data, no store read, no user data." Both halves were
    // literally true and the sentence was still wrong, because it was SILENT about the
    // thing that actually matters here: this route performs an OUTBOUND fetch of
    // CALENDAR_URL on every request. Its siblings /api/trading/news and
    // /api/opportunities/bounties disclose exactly that, and this entry did not — so a
    // reader comparing the three would conclude the calendar was a local read.
    //
    // The store half stays true and is now stated as narrowly as it actually is.
    marker: 'if (path === "/api/trading/calendar" && req.method === "GET") {',
    reason:
      "Economic calendar with a per-event impact summary, served from an OUTBOUND fetch of CALENDAR_URL " +
      "on every request - the same outbound-fetch surface its /api/trading/news and " +
      "/api/opportunities/bounties siblings disclose, which this entry used to be silent about. It reads " +
      "no store at all, so there is no per-user row either, but the real exposure is the ungoverned " +
      "upstream call rather than anything it discloses. RULED PUBLIC BY THE OWNER on the ground that the " +
      "rate limit is the control for an outbound market-data fetch, and it is reference data the dashboard " +
      "cannot render without. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/stress-test" && req.method === "POST") {',
    reason:
      "Hypothetical stress test over caller-supplied symbols and weights. It computes entirely from " +
      "market data and reads no position store, so it does NOT touch the operator's own portfolio - " +
      "which is the distinction that matters here, because its /api/trading/portfolio/aggregate sibling " +
      "does read the operator's ledger and was GATED and deleted in this round. RULED PUBLIC BY THE " +
      "OWNER as one of the outbound market-data proxies, whose real control is the rate limit rather than " +
      "a session. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/screener" && req.method === "POST") {',
    reason:
      "Screener run over caller-supplied filters, bounded to 50 rows by the handler itself. It reads market " +
      "data only and crosses no per-user row. RULED PUBLIC BY THE OWNER as one of the outbound market-data " +
      "proxies, whose real control is the rate limit rather than a session — and the 50-row bound the " +
      "handler applies is the other half of that control. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/patterns" && req.method === "POST") {',
    reason:
      "Chart-pattern detection for a caller-supplied symbol, over historical candles. It reads market data " +
      "only and crosses no per-user row. RULED PUBLIC BY THE OWNER as one of the outbound market-data " +
      "proxies, whose real control is the rate limit rather than a session, on the same footing as its " +
      "/api/trading/indicators sibling. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/backtest" && req.method === "POST") {',
    reason:
      "Strategy backtester: walk-forward hit rates, equity curve and drawdown over historical candles. " +
      "It reads market data rather than user state, and crosses no per-user row. What it IS is an unbounded " +
      "compute surface, and the general rate limit is its only control. RULED PUBLIC BY THE OWNER as one " +
      "of the outbound market-data proxies on that basis; bounding the window remains worth doing. " +
      "STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/levels" && req.method === "POST") {',
    reason:
      "Ideal buy/sell levels for a caller-supplied asset and timeframe. It reads market data only, crosses " +
      "no per-user row, and performs no store read. RULED PUBLIC BY THE OWNER as one of the outbound " +
      "market-data proxies, whose real control is the rate limit rather than a session. STANDING RECORD, " +
      "not an open question.",
    owner: "declared"
  },
  {
    // CORRECTED, and it is one of the ten reasons this round found FACTUALLY WRONG.
    //
    // IT SAID: "Reads live quotes and feed config, not user state." The quotes half is
    // right; the "not user state" half is not, and it was not a subtle miss: the route
    // OPENS venue-credentials.json, and its response enumerates the configured exchanges,
    // so an anonymous caller learns which venues this deployment has credentials for.
    // Credential material never crosses, but venue CONFIGURATION does, and that is
    // operator state read from a store.
    marker: 'if (path === "/api/trading/spread" && req.method === "POST") {',
    reason:
      "Cross-venue price spread with a fee-adjusted edge, for a caller-supplied asset. The quotes come " +
      "from live market data keyed by the caller's own request, but this route ALSO OPENS " +
      "venue-credentials.json and the response ENUMERATES THE CONFIGURED EXCHANGES - so the old \"not " +
      "user state\" was wrong: it discloses which venues this deployment holds credentials for. No " +
      "credential material crosses, so this is configuration disclosure rather than a secret leak. RULED " +
      "PUBLIC BY THE OWNER as one of the outbound market-data proxies, whose real control is the rate " +
      "limit rather than a session. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/models" && req.method === "POST") {',
    reason:
      "Model matrix over a caller-supplied asset and timeframe, multiplexing multi-model consensus over " +
      "historical candles. It reads market data only and crosses no per-user row. RULED PUBLIC BY THE " +
      "OWNER as one of the outbound market-data proxies, whose real control is the rate limit rather than " +
      "a session. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    // GATED, AND ITS ALLOWLIST ENTRY DELETED WITH IT. riskOfRuin falls back to the
    // AGGREGATE accuracy ledger (`signalAccuracy()`) for its defaults, which is the
    // operator's own recorded win rate — so this was never the caller-keyed arithmetic
    // its old reason claimed. It is GATED, not reworded.
    marker: 'if (path === "/api/trading/sessions" && req.method === "GET") {',
    reason:
      "Current and scheduled trading sessions. Pure calendar data: which market windows are open and when " +
      "the next ones start. It reads no store and crosses no per-user row. RULED PUBLIC BY THE OWNER as " +
      "one of the static machine-state reads — the dashboard cannot render session state without it. " +
      "STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/sessions/asset" && req.method === "POST") {',
    reason:
      "Session lookup for a caller-supplied symbol: which windows that instrument trades in. Pure " +
      "calendar data keyed by the caller's own request; no store read and no per-user row. RULED PUBLIC " +
      "BY THE OWNER as one of the static machine-state reads, on the same footing as its " +
      "/api/trading/sessions sibling. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/venues" && req.method === "GET") {',
    reason:
      "Venue list and deep-link metadata for an asset. Static reference data describing each venue and " +
      "where to reach it; it performs no execution and reads no store. The source comment above the site " +
      "says 'public redirect metadata (no execution, R5)', and the code honours that: no order path is " +
      "reachable from here. RULED PUBLIC BY THE OWNER as one of the static machine-state reads. STANDING " +
      "RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/trading/catalog" && req.method === "GET") {',
    reason:
      "Grouped asset catalog for the symbol selector: every symbol the instance will resolve, server-side " +
      "filtered to the resolvable ones. Static reference data with no store read and no per-user row. RULED " +
      "PUBLIC BY THE OWNER as one of the static machine-state reads — the Live Chart cannot populate " +
      "without it. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    // CORRECTED, because the reason this entry gave was FACTUALLY FALSE and a
    // security allowlist that justifies itself with a claim the code no longer
    // honours is what D26 and the documentation-truth work exist to prevent.
    //
    // IT SAID: "a static seed with honest boundary metadata, every entry
    // 'unconfigured' until a probe says otherwise. The source comment says so."
    // That stopped being true when WS-7 T18 appended `newsSourceRows(env)` —
    // derived from `process.env` at call time — to this route. A pre-push review
    // probe then read, anonymously: newsapi `state=degraded`,
    // `configuredEvidence="NEWSAPI_API_KEY=set + PICC_NEWS_NEWSAPI=on"`. No secret
    // VALUE ever crosses (`configEvidence` is built from the env var NAMES), so it
    // was environment reconnaissance, not a leak — but it is still this route's
    // answer, and the entry must describe the route that exists.
    //
    // WHAT IT IS NOW, and it is checkable: this route serves the PROJECTION from
    // `getUnauthenticatedIntegrations()`, which carries no field derived from the
    // environment. `state` and `configEvidence` — and the observed clause of
    // `unconfiguredReason` — are served only by `/api/integrations/configuration`,
    // which is gated. `integrationRoutesDisclosure.test.mjs` asserts the absence
    // at the HTTP boundary, so "checkable" is not a claim.
    // THAT CORRECTION WAS ITSELF INCOMPLETE, and this round found it. The rewritten reason
    // said the projection carries "unconfiguredReason present and null". That is true of
    // only 5 of the 13 rows: the 8 STATIC rows are built by a different code path and
    // carry SIX keys each, with no `unconfiguredReason` at all. So the sentence described
    // the derived rows and silently misdescribed the static ones.
    //
    // THE SHAPE AS IT ACTUALLY IS, and it is checkable: 5 rows are derived and carry
    // `unconfiguredReason` (null); 8 rows are static and carry six reference keys instead.
    // `integrationRoutesDisclosure.test.mjs` asserts at the HTTP boundary that neither shape
    // leaks an env-derived field, so the claim below is verified rather than asserted.
    marker: 'if (path === "/api/integrations" && req.method === "GET") {',
    reason:
      "Per-ministry integration catalog, serving the PROJECTION from getUnauthenticatedIntegrations(). " +
      "The 13 rows are NOT uniform and this entry previously described only half of them: 5 are DERIVED " +
      "and carry id, ministry, name, url, purpose, boundary, retrievalMode, licensedBasis and " +
      "unconfiguredReason (null); the other 8 are STATIC and carry six reference keys each with no " +
      "unconfiguredReason field at all. Neither shape carries any field derived from process.env and " +
      "neither makes a claim about this machine's configuration: `state`, `configEvidence` and the " +
      "observed clause of `unconfiguredReason` are served only by the GATED " +
      "/api/integrations/configuration, and integrationRoutesDisclosure.test.mjs asserts that absence at " +
      "the HTTP boundary. So an anonymous caller cannot read which credentials this deployment holds, in " +
      "either direction. What the catalog does disclose is a map of what this deployment COULD reach. " +
      "RULED PUBLIC BY THE OWNER as one of the static reference reads, on that basis. STANDING RECORD, " +
      "not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path.startsWith("/api/integrations/") && req.method === "GET") {',
    reason:
      "One ministry's integration entries, from the same PROJECTION as the sibling above, with the same " +
      "two row shapes: 5 derived rows carrying unconfiguredReason (null) and 8 static rows carrying six " +
      "reference keys. getUnauthenticatedMinistryIntegrations() strips the env-derived `state`, " +
      "`configEvidence` and `unconfiguredReason` the same way, so this branch discloses no more than the " +
      "flat route does. The ministry name comes from the caller's own path, and an unknown ministry yields " +
      "an honest empty list rather than a 404. NOTE: this startsWith branch sits BELOW the gated " +
      "/api/integrations/configuration on purpose - a gated path placed after it would be answered by this " +
      "projection before its gate ran. RULED PUBLIC BY THE OWNER as one of the static reference reads. " +
      "STANDING RECORD, not an open question.",
    owner: "declared"
  },

  // ── Opportunities / listings / content / agents ──────────────────────────
  {
    marker: 'if (path === "/api/opportunities" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Opportunity catalog. Read-only: no store read and no per-user row. RULED PUBLIC BY THE OWNER as one " +
      "of the static reference reads — it is data the Opportunities view cannot render without. STANDING " +
      "RECORD, not an open question.",
    owner: "declared"
  },
  {
    // VERIFIED ACCURATE IN THIS ROUND, and left substantively alone. Ten of its
    // siblings' reasons were found factually wrong while closing the deferred set, so
    // this one was re-checked rather than assumed: a `data/workflows/operator-secret.json`
    // was planted and this route read nothing from it. It serves the workflow
    // DEFINITIONS only - the named steps - and does not resolve or return the stored
    // per-workflow payloads, which is what the "no store read" claim rests on. The
    // owner ruling is that it stays public.
    marker: 'if (path === "/api/opportunities/workflows" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Opportunity workflow definitions: the named steps an opportunity moves through. Read-only, no " +
      "store read, no per-user row. RE-VERIFIED IN THIS ROUND rather than inherited: a planted " +
      "data/workflows/operator-secret.json leaked nothing, because this route serves the definitions and " +
      "never resolves the stored per-workflow payloads. RULED PUBLIC BY THE OWNER as one of the static " +
      "reference reads. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/opportunities/bounties" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Bounty-board monitor: reads public bounty boards and reports what is open. Read-only, with no store " +
      "read and no per-user row. It IS an outbound-fetch surface an anonymous caller can drive on a " +
      "schedule. RULED PUBLIC BY THE OWNER as one of the outbound market-data proxies, whose real control " +
      "is the rate limit rather than a session. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  // GATED: all three /api/listing/* entries below are DELETED rather than reworded, because an
  // anonymous caller could drive paid inference on each of them.
  {
    marker: 'if (path === "/api/listing/competitors" && req.method === "POST") {',
    reason:
      "Competitor lookup for caller-supplied keywords or an ASIN, returning public marketplace listings. " +
      "It reads no store and crosses no per-user row. It IS an outbound-fetch surface whose only control " +
      "is the general rate limit. RULED PUBLIC BY THE OWNER as one of the outbound market-data proxies — " +
      "note this is the one /api/listing/* route NOT gated: its three siblings were gated for LLM spend, " +
      "and this one spends none. STANDING RECORD, not an open question.",
    owner: "declared"
  },
// GATED, AND ITS ALLOWLIST ENTRY DELETED WITH IT: content generation spends LLM budget, and its live
  // non-browser consumer (infra/n8n/workflows/picc-content-pipeline.json, which POSTed with no
  // Authorization header) was updated in the SAME change to send a bearer token, so gating this
  // route did not break that workflow.
  // ── NOTIFICATIONS ───────────────────────────────────────────────────────
  {
    // T20R. The `/api/notifications` wrapper stays DECLARED, and its
    // justification is now narrow and specific rather than "the sweep left it
    // open": it is public for exactly TWO sub-routes, and neither is a write.
    // The five mutating sub-routes inside it — prefs, subscribe-push,
    // unsubscribe-push, snooze and test — are each gated at the head of their own
    // branch by T20R, and each of their allowlist entries was DELETED rather than
    // reworded.
    //
    // The wrapper cannot carry a single gate of its own, and that is a property of
    // the code rather than a choice: the vapid branch sits ABOVE where a gate
    // would go and always returns (both its 503 and its 200 `return`), so a gate
    // placed after it would be dead code for the key and a gate placed before it
    // would gate the key the browser needs before it can authenticate. The split
    // per branch is what lets the read stay public and every write stay closed.
    //
// CORRECTED TWICE, in the same spirit as the /api/integrations entry below.
    //
    // FIRST CORRECTION: the previous wording said "public for exactly ONE sub-route",
    // which was already loose (`/api/notifications/status` was public too, and had its
    // own entry below) and became looser still when `push-endpoints` joined the gated
    // set. It was corrected to two, named.
    //
    // SECOND CORRECTION, and this one is caused by THIS ROUND: /api/notifications/status
    // is now GATED - it served the last 20 alert records with their titles and bodies,
    // which is operator content rather than machine state - so the wrapper is public
    // for exactly ONE sub-route again. A wrapper reason that lists a sub-route which
    // now 401s is precisely the "allowlist that justifies itself with a claim the code
    // does not honour" failure this branch exists to prevent, so it is corrected here
    // in the same change that gated the sub-route.
    marker: 'if (path.startsWith("/api/notifications")) {',
    reason:
      "Wrapper for the notifications family, public for exactly ONE sub-route and no write: the web-push " +
      "VAPID public key, which the browser must fetch BEFORE it can subscribe and therefore before any auth " +
      "header exists. Every other sub-route is gated at the head of its own branch - the five writes (prefs, " +
      "subscribe-push, unsubscribe-push, snooze, test), plus push-endpoints, which returns each subscribed " +
      "device's push endpoint URL, plus /api/notifications/status, which serves channel state AND the last 20 " +
      "alert records with their titles and bodies. The private key is never served and no per-user row is read " +
      "on the public path. RECOMMENDATION: keep the wrapper declared-public and every other sub-route gated; " +
      "do not add a gate here, which would gate the key.",
    owner: "declared"
  },
// GATED, AND ITS ALLOWLIST ENTRY DELETED WITH IT.
    //
    // IT USED TO SAY "Notifier channel status: which channels are configured and reachable...
    // Machine-level, no user data." The second clause was FALSE: the route also serves
    // `recent` - the last 20 alert records, each carrying a title and a body - which is
    // operator content, not machine state. The pre-push review had already removed the
    // per-device push-endpoint list from this branch and moved it to the GATED
    // /api/notifications/push-endpoints; the alert records were missed.
    //
    // It is now GATED as the FIRST statement of its own branch, for the same structural
    // reason as the five writes beside it: the wrapper cannot carry a gate ahead of the
    // VAPID branch, so each sub-route is gated individually. The deletion is recorded
    // here rather than left silent, because a stale row reads as coverage while excusing
    // nothing.
  {
    marker: 'if (path === "/api/notifications/vapid-public-key" && req.method === "GET") {',
    reason:
      "The web-push VAPID PUBLIC key. The source comment states the reason: the browser needs it " +
      "BEFORE it can subscribe, so no auth header exists on first load. The private key is never " +
      "served. This is the clearest 'public by protocol necessity' case in the file.",
    sourceComment: "Public by design: the browser needs the VAPID key *before* it can",
    owner: "declared"
  },
  {
    // THE OWNER'S RULING DIVERGED FROM THIS ENTRY'S OWN RECOMMENDATION, and that is recorded
    // rather than quietly reversed. The old reason recommended GATING this read "for
    // consistency with its own sibling", on the grounds that the omission looked like an
    // oversight. The owner instead ruled it PUBLIC, and this round separately GATED its
    // sibling /api/settings/llm/resource. So the pairing this entry asked for did not
    // happen; the two now differ, deliberately, and this entry is the record of why.
    marker: 'if (path === "/api/settings/llm" && req.method === "GET") {',
    reason:
      "Masked LLM provider view: which providers are configured, which model and base URL each uses, and " +
      "booleans for key and service-account presence. No key material crosses - llmSettingsView masks by " +
      "construction. This entry previously recommended GATING the read for consistency with its POST " +
      "sibling, which is gated. THE OWNER RULED IT PUBLIC ANYWAY, and in the same round GATED the " +
      "/api/settings/llm/resource read that mirrors it, so the two now differ deliberately rather than by " +
      "oversight: what is disclosed here is provider NAMES, models, base URLs and presence booleans, and " +
      "that is configuration reconnaissance rather than a secret or a per-user row. RULED PUBLIC BY THE " +
      "OWNER. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/settings/session-capture" && req.method === "GET") {',
    reason:
      "Session-capture kill-switch READ: {enabled, configured} only, default-ON when untouched. The " +
      "source comment above says the GET 'stays public like sibling settings GET views (no secret " +
      "material)' and that the POST is the gated one. That is a stated decision, so this is the " +
      "declaring case. RECOMMENDATION: keep public, as the source says.",
    sourceComment: "GET stays public like sibling settings GET views (no secret material",
    owner: "declared"
  },
  {
    // AND THE `/api/settings/llm/resource` ENTRY THAT USED TO SIT ABOVE THIS ONE IS
    // DELETED, not reworded: the owner gated it, so its row goes rather than lingering
    // as coverage. It served the resource-governor's budgets, aggregate stats and the 50
    // most recent ledger rows - timing and token counts for work this instance did. It
    // moved together with the /api/settings/llm read it mirrored, which is also now
    // gated; that pairing was this entry's own recorded recommendation.
    // T20R: RULED PUBLIC by the owner, on the stated grounds that MarketsRoom
    // fetches it on mount (`MARKETS_PANELS` entry 1, e2e/terminal-perf.spec.ts:180).
    //
    // AND THE STATED GROUND IS RECORDED AS WEAKER THAN CLAIMED, because the
    // instruction was to verify the claim rather than inherit it. Verified while
    // ruling: the only renderer is PackRegistryStrip (components/PackRegistryStrip.tsx),
    // mounted from pages/ministry/MarketsRoom.tsx:85, and MarketsRoom sits BEHIND
    // App.tsx's RequireAuth (App.tsx:52). lib/packRegistry.ts sends
    // `Authorization: Bearer <token>` on this call. So there is no pre-auth
    // consumer, and the route would in fact survive a gate.
    //
    // IT IS LEFT PUBLIC ANYWAY, and the reason is that this entry records an OWNER
    // RULING, not a conclusion of mine. Gating it would contradict an explicit
    // carve-out in the T20R scope, so the finding is surfaced here for the owner
    // to act on in a later pass rather than acted on unilaterally.
    marker: 'if (path === "/api/packs/registry" && req.method === "GET") {',
    reason:
      "Pack registry: per-step status, envelope and evidence, with credential PRESENCE flags only (never " +
      "values) plus the §8.5 server-env resource caps. The source comment states the masking and the " +
      "read-only intent, and packRegistryApi.test.mjs asserts no credential value crosses the wire. RULED " +
      "PUBLIC by the owner because the Markets room fetches it on mount. T20R VERIFICATION, recorded rather " +
      "than inherited: that room is behind RequireAuth, so no pre-auth consumer exists and the route would " +
      "tolerate a gate — this entry is kept public because the owner ruled it so, and the discrepancy is " +
      "flagged here for a later pass. RECOMMENDATION: keep public under this ruling; revisit with /api/health " +
      "and /api/metrics in a dedicated read-surface pass.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/webfetch/limits" && req.method === "GET") {',
    reason:
      "Global webfetch fair-use surface: current per-host sliding windows plus observed stats. Read-only " +
      "and rate limited, and the source comment says so. What it does disclose is the operator's CONFIGURED " +
      "per-host budget, which is environment reconnaissance rather than a per-user row. RULED PUBLIC BY " +
      "THE OWNER as one of the static machine-state reads, on the stated ground that the limits themselves " +
      "are the rate limiting. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/system/capabilities" && req.method === "POST") {',
    reason:
      "Machine-level capability probe: what this instance can reach and which channels are live. The " +
      "source comment above it states the decision in as many words: 'No auth required — " +
      "intentionally public on localhost.' This is the route the sibling /api/trading/brokers comment " +
      "points at as the contrast case, and it must be left alone.",
    sourceComment: "No auth required — intentionally public on localhost.",
    owner: "declared"
  },
  // GATED, AND THE ENTRY DELETED WITH IT — this GET is now gated on the same
  // requireAuth as the POST sibling above it, which is a stronger control than the
  // loopback check the POST carries.
  // ── PAPER / DEMO / AUTOPILOT (user-shaped state, ungated) ────────────────
  // EVERY ENTRY IN THIS SECTION IS DELETED rather than reworded. The owner gated the
  // whole user-shaped trading family — paper positions, overview, history, analytics,
  // the signal and accuracy ledgers, the export, the demo analytics and deals, and both
  // alert reads — so each allowlist row is removed with its gate. A gated route with a
  // surviving row reads as coverage while excusing nothing.
  //
  // ONE OF THEM IS WORTH NAMING, because it is the finding that motivated the ruling:
  // /api/trading/paper/analytics did not only read the operator's paper account, it
  // CLOSED an open position and wrote the trade into trading-ledger.json, at a price
  // derived from a live quote, on a plain anonymous GET. It survived the previous pass
  // because it was classified as a read. The gate is on the ROUTE; the TP/SL auto-close
  // at live marks is convergence the engine should still perform for an authenticated
  // caller, and it has NOT been removed — `routeAuthRuling24Gates.test.mjs` pins both
  // halves: an anonymous GET leaves the ledger byte-identical, and an authenticated GET
  // still auto-closes.
  // GATED, AND ITS ALLOWLIST ENTRY DELETED WITH IT: free-text trading assistance spends LLM budget on
  // the same reasoning as /api/content/generate above.
  // D2/AC-005: the `/api/trading/demo` allowlist entry is DELETED entirely
  // (not re-pointed, not stubbed). It served `expertOptionDemoStatus()` — an
  // ExpertOption demo-account status read. Its recorded DECISION ITEM ("gate it
  // with the demo family") is MOOT: the venue, and the route, are gone. A stale
  // entry reads as coverage while excusing nothing, which is the exact rot this
  // self-policing block exists to catch.
  //
  // T20R: the `/api/trading/demo/place` entry that sat here is DELETED, not
  // reworded — the route now carries requireAuth as its first statement. The
  // recorded recommendation ("leave public, or delete the route") was NOT
  // followed, and the reason for overruleing it is written at the gate in
  // handlers.mjs: the route is a static 410 today, so gating it is prophylactic
  // rather than a hole closed, and it removes the last unauthenticated POST in
  // a family whose siblings were gated for exactly this reason.
  //
  // D2/AC-005: the `/api/trading/demo` allowlist entry is DELETED entirely
  // (not re-pointed, not stubbed). It served `expertOptionDemoStatus()` — an
  // ExpertOption demo-account status read. Its recorded DECISION ITEM ("gate the
  // GET once the session carries user state") is MOOT: the venue, and the route,
  // are gone. A stale entry reads as coverage while excusing nothing, which is
  // the exact rot this self-policing block exists to catch.
  //
  // ITS SIBLINGS `/api/trading/demo/analytics` and `/api/trading/demo/deals`, which sat
  // beside it, are NOW GATED and their entries DELETED. That sentence used to say they
  // were "UNCHANGED and still allowlisted... with the same ungated DECISION ITEM they
  // always carried", which stopped being true the moment the owner ruled; it is corrected
  // here in the same change rather than left to rot.
  //
  // T20R: the `/api/trading/autopilot/start` and `/api/trading/autopilot/stop`
  // entries that sat here are DELETED, not reworded — both routes now carry
  // requireAuth as their first statement. As with /api/trading/demo/place above,
  // the recorded recommendation ("leave public, or delete the route") was NOT
  // followed: both are static 410 stubs today, so the gate is prophylactic rather
  // than a hole closed, and the full reasoning is written at the gate in
  // handlers.mjs rather than only here.
  // GATED, AND ITS ALLOWLIST ENTRY DELETED WITH IT: it is the whole trading record —
  // the autopilot decision log plus resolved ledger history plus a per-asset breakdown —
  // in one response, and it was the single largest read an anonymous caller had.
  //
  // ── WATCHLISTS / ALERTS (the deletes are gated; the two reads are not) ───
  //
  // FLAGGED FOR A FOLLOW-UP RULING, and deliberately NOT gated in this round:
  //   * /api/trading/watchlists (GET) returns a `userId` on every entry, so it is
  //     substantively one of the per-user reads this ruling gated, and I believe it
  //     should be gated with them. It was not, because the ruling named 24 routes and
  //     this is not one of them. It is recorded here rather than silently corrected.
  //   * /api/trading/candles (POST) reads the per-user chart-prefs.json (see its entry).
  //   * /api/trading/scan (POST) falls back to getWatchlist() when the caller passes no
  //     symbols, so it is not purely caller-keyed.
  {
    marker: 'if (path === "/api/trading/watchlist" && req.method === "GET") {',
    reason:
      "The default watchlist with live quotes attached. Reads the operator's own saved symbol list from " +
      "the watchlist store, and the sibling named-watchlist read is the reconnaissance step for the " +
      "destructive delete this slice already gated. RULED PUBLIC BY THE OWNER as a static machine-state " +
      "read, on the stated ground that the rate limit rather than a session is the control for a " +
      "watchlist the operator configured themselves. STANDING RECORD, not an open question.",
    owner: "declared"
  },
  // CORRECTED, because its old reason was FACTUALLY WRONG in the way this branch exists to
    // prevent: it said "each entry carries its id" and stopped there. Every entry ALSO
    // carries `userId`, so this is not a neutral id list — it is a per-user read served
    // to an anonymous caller, which is the same class as the /api/trading/alerts rows
    // this round GATED and deleted.
    //
    // NOT GATED ANYWAY, and the reason is stated plainly rather than left for a reader
    // to infer: the ruling named 24 routes and this is not one of them. I think it should
    // be gated with the rest of the per-user reads, and it is FLAGGED FOR A FOLLOW-UP
    // RULING at the head of this section rather than quietly fixed here. Gating a route
    // the owner did not name would be the same unilateral move in the opposite
    // direction; the honest move is to make the exposure legible and let the owner rule.
  {
    marker: 'if (path === "/api/trading/watchlists" && req.method === "GET") {',
    reason:
      "Every named watchlist with attached prices. EACH ENTRY CARRIES BOTH ITS ID AND ITS userId - the " +
      "old wording mentioned only the id, and that was wrong: userId is what makes this a per-user read " +
      "rather than a neutral id list, and it is served to an anonymous caller. The ids are also exactly " +
      "what the sibling delete takes, so this remains the reconnaissance step for a destructive call. " +
      "STILL PUBLIC, because the owner's ruling named 24 routes and this is not among them; " +
      "NEEDS A FOLLOW-UP RULING, because on the merits it belongs with the per-user reads this round " +
      "gated. Left ungated deliberately, and recorded rather than papered over.",
    owner: "declared"
  },
  // GATED, AND BOTH ENTRIES DELETED WITH THE GATES: the alert registry rows carry a userId,
  // and the fired-alert history is the read half of the same store whose create and delete
  // halves this branch already gated. See the WATCHLISTS/ALERTS section header above.
  //
  // ── AUTH (structurally public) ──────────────────────────────────────────
  {
    marker: 'if (path === "/api/auth/status" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Login-page bootstrap hint, and the answer has to be available BEFORE a session exists — that is the whole " +
      "point of it. Discloses exactly three things: `hasUsers` (a boolean), the literal authMode \"local\", and two " +
      "process-scoped fault counters keyed by BASENAME (`users.json`, `sessions.json`) via auth.mjs's recordStoreFault, " +
      "which takes basename(file) precisely because the raw argument is a joined absolute path and this body is served " +
      "over HTTP. No account data, no user rows, no absolute path, no home directory, no OS user name — the path " +
      "disclosure that used to live here was already removed at handlers.mjs:4360 and this entry is the reason it " +
      "stayed removed. DECISION ITEM: the counters tell an anonymous caller that a store is failing, which is a small " +
      "operational-fingerprint disclosure. It is accepted because the failure it reports is not exploitable from " +
      "outside (the counters are informational; the auth decision is made by verifyUser/hasUsers, not by them) and " +
      "because a login page that cannot see its own store is broken exactly when it is needed most. " +
      "RECOMMENDATION: leave public; if the owner wants the counters gone, they can move to the `store-fault` log line " +
      "the comment above the route already points at.",
    owner: "declared",
    sourceComment: "NOT A GATE."
  },
  {
    marker: 'if (path === "/api/auth/signup" && req.method === "POST") {',
    reason:
      "Account creation. Structurally public: requiring a session to create the first account is " +
      "impossible. Rate limited per IP and distinguished from a store fault by status (503 vs 400). " +
      "RECOMMENDATION: keep public — this is what the bootstrap exists for.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/auth/login" && req.method === "POST") {',
    reason:
      "Credential exchange. Structurally public for the same reason as signup, and the 401-vs-503 " +
      "distinction is deliberate so a store fault is not reported as bad credentials. " +
      "RECOMMENDATION: keep public.",
    owner: "declared"
  },
  {
    marker: 'if (path === "/api/auth/signout" && req.method === "POST") {',
    reason:
      "Revokes the caller's own token. A session is not required to end one, and requiring one would " +
      "make a stolen token un-revocable by its holder. It reports 503 rather than a fake success when " +
      "the store cannot be written. RECOMMENDATION: keep public.",
    owner: "declared"
  },
  {
    // T20R INVESTIGATED THIS ENTRY SPECIFICALLY, because the scope named
    // /api/auth/me as the one to test before touching. It was NOT gated, and the
    // answer is that gating it would be a regression worse than the vulnerability.
    //
    // WHY IT MUST STAY PUBLIC. It is the route the client calls to learn WHETHER a
    // session exists, so its answer is required to construct a session. It is
    // gated by the TOKEN BEING PRESENT, which is what it resolves — a second
    // "do you have a session?" requirement on the route that answers that question
    // is circular. On a fresh install with an empty user store it must answer
    // "no session, and there are no accounts yet" so the UI can offer signup;
    // requireAuth's own first-run branch admits everyone when `resolveHasUsers()`
    // is false, but the moment one account exists that branch closes and a
    // requireAuth gate here would return 401 to the very client trying to log in.
    //
    // It was ALREADY `declared`, so it was never one of the open owner decisions
    // this task discharges. T20R left the ruling alone and pinned the fresh-install
    // behaviour in t20rRouteAuthGates.test.mjs instead of asserting it here.
    marker: 'if (path === "/api/auth/me" && (req.method === "GET" || req.method === "POST")) {',
    reason:
      "Resolves the caller's own token to a user, and answers 401 or 503 otherwise. It is gated by " +
      "the token being presented — a session requirement is what it IS. The user store fault path is " +
      "503, not 401, so the client does not delete a still-valid session. T20R investigated whether this " +
      "route could be gated and concluded it MUST NOT be: it is the bootstrap answer itself, so it has " +
      "to answer before a session exists, and gating it would lock out first-run signup. RECOMMENDATION: " +
      "keep public, permanently.",
    owner: "declared"
  },
  {
    // T20R CONSIDERED THIS FOR GATING AND DELIBERATELY DID NOT GATE IT. It is a
    // single-method POST that mutates (it applies a paid subscription event), so
    // the T20R rule "gate every genuinely-mutating single-method route" pointed at
    // it — and following that rule would have broken payments. Recorded in full
    // rather than quietly deferred, because the reason is the point.
    //
    // WHY A SESSION GATE CANNOT GO HERE. Stripe delivers webhooks server-to-server
    // and cannot present a bearer token; this app's own client authenticates with
    // `Authorization: Bearer` (src/lib/auth.ts), and a webhook is not that client.
    // requireAuth would reject every legitimate delivery, so subscription state
    // would silently stop updating.
    //
    // WHY IT IS STILL SAFE, i.e. why this is not a hole. The route is
    // authenticated by HMAC signature, and that check fails CLOSED and runs before
    // any store write: constructWebhookEvent (services/stripe.mjs:39-43) throws
    // when STRIPE_WEBHOOK_SECRET is unset, and otherwise calls Stripe's
    // `webhooks.constructEvent`, which throws on a bad or missing signature. The
    // `await` that makes this true is itself a slice-C fix recorded at
    // handlers.mjs:5130. Only a correctly-signed event reaches handleStripeWebhook.
    // So the route has an identity check — it is simply not a session check.
    // STANDING RECORD, NOT AN OPEN QUESTION. This entry used to end "STILL AN OPEN OWNER
    // DECISION: the residual is that a correctly-signed event from anyone holding the
    // webhook secret applies subscription state". The owner has now ruled on that
    // residual and accepted it, so this is no longer a pending decision: it is the
    // recorded, accepted shape of the route. The technical facts below are unchanged and
    // still checkable.
    marker: 'if (path === "/api/stripe/webhook" && req.method === "POST") {',
    reason:
      "Stripe webhook, authenticated by SIGNATURE rather than by session, and deliberately left ungated: " +
      "Stripe delivers server-to-server and cannot present a bearer token, so requireAuth here would reject " +
      "every real delivery. The signature check is unconditional and precedes any store write - " +
      "constructWebhookEvent (services/stripe.mjs:39) throws when STRIPE_WEBHOOK_SECRET is unset and " +
      "otherwise delegates to Stripe's constructEvent, which throws on a bad signature; the `await` that " +
      "makes the surrounding try/catch real is recorded at handlers.mjs:5130. So the route HAS an identity " +
      "check and it fails closed - it is simply not a SESSION check. The residual the owner has now " +
      "ACCEPTED as inherent to webhooks: a correctly-signed event from anyone holding the webhook secret " +
      "applies subscription state, and no session requirement can change that. RULED PUBLIC BY THE OWNER " +
      "AS A STANDING RECORD, NOT AN OPEN QUESTION - do NOT bolt on requireAuth.",
    owner: "declared"
  },
  {
    // T20R CONSIDERED THIS FOR GATING AND DID NOT GATE IT. Same shape as the
    // Stripe webhook: a single-method route that mutates (it links a GitHub
    // account to a user), which the T20R rule pointed at.
    //
    // WHY A SESSION GATE CANNOT GO HERE. This is a top-level browser REDIRECT from
    // github.com. A redirect carries no Authorization header — the token lives in
    // localStorage and is attached by fetch() — so requireAuth would see an
    // anonymous caller and 401 the OAuth callback, breaking account linking
    // outright.
    //
    // WHY IT IS STILL SAFE. The `state` parameter is the CSRF binding: GitHub
    // echoes back the opaque value minted by beginGithubOauth, and
    // completeGithubOauth is what checks it. That is the identity proof here, and
    // it is the same proof the OAuth spec intends for a callback.
    // STANDING RECORD, NOT AN OPEN QUESTION. This entry used to end "STILL AN OPEN OWNER
    // DECISION: whether completeGithubOauth validates `state` strictly, and whether the
    // failure page can leak a code or a username, is the owner's call to confirm" — and it
    // made public access CONTINGENT on that confirmation. The owner has now ruled, so the
    // contingency is discharged: this is the recorded, accepted shape of the route rather
    // than a question waiting on someone.
    marker: 'if (path === "/api/profile/github/callback" && req.method === "GET") {',
    reason:
      "GitHub OAuth redirect target. Deliberately left ungated: this is a TOP-LEVEL BROWSER REDIRECT from " +
      "github.com, and a redirect cannot carry an Authorization header - this app's token lives in " +
      "localStorage and is attached by fetch - so a requireAuth gate would 401 the callback and break " +
      "account linking outright. It is authenticated by the OAuth `state` parameter instead: GitHub echoes " +
      "back the opaque value minted by beginGithubOauth and completeGithubOauth is what validates it, " +
      "which is the CSRF binding the OAuth spec intends for a callback. The owner's confirmation this entry " +
      "used to make contingent has been given, so the route is public BY DESIGN rather than pending. RULED " +
      "PUBLIC BY THE OWNER AS A STANDING RECORD, NOT AN OPEN QUESTION — do NOT bolt on requireAuth.",
    owner: "declared"
  }
]

/** Marker -> entry, and the duplicate report. */
function indexAllowlist(entries) {
  const byMarker = new Map()
  const duplicates = []
  for (const entry of entries) {
    if (byMarker.has(entry.marker)) duplicates.push(entry.marker)
    else byMarker.set(entry.marker, entry)
  }
  return { byMarker, duplicates }
}

const { byMarker: ALLOWLIST_BY_MARKER, duplicates: ALLOWLIST_DUPLICATES } = indexAllowlist(DECLARED_PUBLIC)

/**
 * Is this site's own contiguous comment block (and body) carrying the given text?
 *
 * `rawRegion`, NOT `region`. A `sourceComment` is by definition a COMMENT, and
 * `region` is the comment-blanked view that `isGated` reads, so consulting
 * `region` here would make every `sourceComment` rule unsatisfiable. This is the
 * one place in the file that reads comment text, and it does so only to CHECK
 * that a written justification exists at the route — never to reach a gate
 * verdict. Fix round 1 introduced the split; this is where the two views are
 * each used for what they are for.
 */
function regionCarries(site, needle) {
  const body = site.rawRegion ?? site.region
  return body.some((l) => l.includes(needle)) || site.ownComment.includes(needle)
}

describe("WS-7 slice C — every /api route is gated or declared public with a reason", () => {
  it("the deferred set is EMPTY, and stays empty — `owner: \"decision\"` is 0", () => {
    // WHY THIS IS ASSERTED AT ALL. `owner: "decision"` meant "the owner has not looked
    // at this yet". The owner has now looked at all 62: 24 were gated and their rows
    // DELETED, and 38 were ruled public and reclassified. A deferral that nobody ever
    // returns to is not a deferral, it is an abandoned queue — so the queue being empty
    // is a property worth holding, and this is what holds it.
    //
    // THE COUNT IS MEASURED, NOT RESTATED, and it is measured the way the seam probe
    // measures it: over the comment-stripped allowlist, matching the 4-space ROW
    // TERMINATOR rather than the token anywhere. Counting the token anywhere also counts
    // the prose in this file's own comments, which is exactly how a recorded backlog
    // number goes stale while looking green.
    const deferred = DECLARED_PUBLIC.filter((e) => e.owner === "decision")
    expect(
      deferred.map((e) => e.marker),
      "a new allowlist row with no owner ruling behind it does not belong in the list: either gate " +
        "the route (and delete its row) or record a ruling that makes it public. A row added here with " +
        "no decision is how the 62 regrow that this ruling just closed."
    ).toEqual([])

    // And the total is pinned, so a row cannot be ADDED either. The allowance is not a
    // blanket: the 38 rows this ruling reclassified all carry an owner ruling in prose
    // ("RULED PUBLIC BY THE OWNER" or "STANDING RECORD"), which is what separates a
    // deliberate new public route from a copy-paste. The three borderline routes left
    // public by this ruling record it in their own words ("STILL PUBLIC because the
    // owner's ruling named 24 routes"), so both phrasings count.
    expect(
      DECLARED_PUBLIC.length,
      "the allowlist is 74 entries less the 24 this ruling gated = 50. A different number means a row " +
        "was added or removed without the count moving here, which is how an allowance grows quietly."
    ).toBe(50)
    const ruled = DECLARED_PUBLIC.filter(
      (e) => /RULED PUBLIC BY THE OWNER|STANDING RECORD|the owner's ruling named/.test(e.reason)
    )
    expect(
      ruled.length,
      "the rows this ruling reclassified must SAY SO in prose. Flipping `owner` from \"decision\" to " +
        "\"declared\" edits one word, so a row can claim a decision nobody made while its reason still " +
        "reads as a pending recommendation. 38 rows carry an explicit owner ruling."
    ).toBeGreaterThanOrEqual(38)
  })

  it("discovers the real dispatch surface, and none of the four forms is blind", () => {
    // A guard that silently finds nothing is the exact failure this file exists
    // to prevent, so the scan is proved against known ground truth rather than
    // asserted with a bare count.
    expect(SITES.length, "the dispatch scan must still find the /api surface").toBeGreaterThan(150)
    const byForm = (f) => SITES.filter((s) => s.form === f).length
    expect(byForm("path ==="), "the path === form must be discovered").toBeGreaterThan(100)
    expect(byForm("path.match"), "the path.match form must be discovered").toBeGreaterThanOrEqual(5)
    expect(byForm("path.startsWith"), "the path.startsWith form must be discovered").toBeGreaterThanOrEqual(2)
    // THE ONE THE SIBLING GUARD NAMED AS INVISIBLE. BROWSER_ROUTES is 33 real
    // routes; under a three-spelling predicate every one of them is unchecked.
    expect(
      byForm("table"),
      "the lookup-table form must be discovered — BROWSER_ROUTES is 33 gated routes that the sibling " +
        "guard's predicate cannot see at all"
    ).toBeGreaterThanOrEqual(30)
  })

  it("refuses a switch(path) dispatch rather than ignoring it", () => {
    // The bound, enforced. A `switch (path)` today would be discovered by NOTHING
    // in this file, and the correct behaviour is a red build naming the line, not
    // silence. If a future author adds one, this fails and the guard is extended
    // deliberately rather than the coverage quietly becoming false.
    expect(
      SWITCH_SITES,
      "a switch(path) route dispatch is not modelled by this guard. Extend findRouteSites() to read it " +
        "before merging, or the switch's routes arrive ungated AND unchecked"
    ).toEqual([])
  })

  it("refuses a table entry spelled in a handler shape the guard does not model", () => {
    // The anti-drift half of the table claim. BROWSER_ROUTES entries are all
    // `async (`. A table written `"/api/x": (req, res) => {…}` or with a
    // non-`async` function must still be discovered — so the pattern accepts
    // them, and this test fails if that is ever narrowed back to one shape while
    // a differently-shaped entry exists in the source.
    const unmodelled = LINES.map((l, i) => ({ l, i }))
      .filter((r) => /^\s*"\/api\/[^"]*"\s*:/.test(r.l.trim()))
      .filter((r) => !TABLE_DISPATCH.test(r.l.trim()))
      .map((r) => `handlers.mjs:${r.i + 1}  ${r.l.trim()}`)
    expect(
      unmodelled,
      "a /api key in a route-table object whose handler shape TABLE_DISPATCH does not match would be " +
        "discovered as no site at all, so no assertion would be made about it. Widen TABLE_DISPATCH."
    ).toEqual([])
  })

  // ── THE INVARIANT ────────────────────────────────────────────────────────
  it("every discovered route is gated in its own block, or declared public with a reason", () => {
    const offenders = SITES.map((s) => ({ s, verdict: isGated(s) }))
      .filter((r) => !r.verdict.ok && !ALLOWLIST_BY_MARKER.has(r.s.marker))
      .map((r) => `handlers.mjs:${r.s.line}  ${r.s.marker}  — ${r.verdict.why}`)
    expect(
      offenders,
      "EVERY /api route must pass through a gate inside its OWN block and BEFORE it answers, or appear " +
        "in DECLARED_PUBLIC above with a written reason. There is no third state: a route that is " +
        "neither gated nor declared is an omission, and an omission is how ~40 routes answered " +
        "anonymously in the first place. If this route should be public, add it to DECLARED_PUBLIC with " +
        "what it discloses and a recommendation; if it should not be, add the gate."
    ).toEqual([])
  })

  it("no route is BOTH gated and allowlisted — the allowlist cannot rot into a fiction", () => {
    // The anti-staleness direction. Once a route is gated, its allowlist entry is
    // a lie: it claims a decision that no longer describes the code, and it would
    // keep excusing the route if the gate were later removed. Requiring the
    // deletion means the two can never disagree.
    const both = SITES.filter((s) => isGated(s).ok && ALLOWLIST_BY_MARKER.has(s.marker)).map(
      (s) => `handlers.mjs:${s.line}  ${s.marker}`
    )
    expect(
      both,
      "these routes are gated in their own block AND still declared public. Delete the DECLARED_PUBLIC " +
        "entry: a gate is the honest state, and leaving the entry means it would go on excusing the " +
        "route if the gate were ever lost."
    ).toEqual([])
  })
})

describe("WS-7 slice C — the allowlist is self-policing", () => {
  it("has no duplicate marker", () => {
    expect(
      ALLOWLIST_DUPLICATES,
      "the same route is allowlisted twice. Two entries for one route means two justifications and no " +
        "way to tell which one is the decision."
    ).toEqual([])
  })

  it("gives every entry a written reason, not a placeholder", () => {
    for (const entry of DECLARED_PUBLIC) {
      expect(typeof entry.reason, "an allowlist entry must carry a written reason").toBe("string")
      expect(
        entry.reason.trim().length,
        `a bare marker is not an allowance: ${entry.marker}`
      ).toBeGreaterThan(120)
      const bare = entry.reason.trim().toLowerCase()
      for (const phrase of PLACEHOLDER_REASONS) {
        expect(
          bare,
          `"${phrase}" is a placeholder, not a reason: ${entry.marker}`
        ).not.toBe(phrase)
      }
      expect(
        ["declared", "decision"],
        `every entry must be classified as "declared" (the source says so) or "decision" (an open ` +
          `question for the owner): ${entry.marker}`
      ).toContain(entry.owner)
    }
  })

  it("has no stale entry — every marker resolves to a live route", () => {
    // The rot direction. A renamed or deleted route leaves its entry behind, and
    // a stale entry is worse than none: it looks like coverage in this file while
    // excusing nothing.
    const stale = DECLARED_PUBLIC.filter((e) => !SITES.some((s) => s.marker === e.marker)).map((e) => e.marker)
    expect(
      stale,
      "these allowlist entries name a dispatch line the guard cannot find. The route was renamed, " +
        "re-spelled or removed — update the marker to the route's CURRENT dispatch line, or delete " +
        "the entry. A stale entry is worse than a missing one: it reads as coverage and excuses nothing."
    ).toEqual([])
  })

  it("binds every entry to its OWN route, so a marker cannot be lifted", () => {
    // THE ANTI-PASTING TEST, and the property the earlier rounds of the sibling
    // guard lacked. There, an allowlist entry's MARKER was a comment string found
    // in a 12-line WINDOW, so copying that comment onto a real gate excused it.
    // Here the marker is the route's own dispatch line and the match is EXACT and
    // per-site, so:
    //   - a marker that exists in the file but not at this route is rejected, and
    //   - two routes that share a path but differ by method have different markers,
    //     which is why the entries are keyed by dispatch line and not by path.
    const lifted = DECLARED_PUBLIC.filter((e) => {
      const inSource = SRC.includes(e.marker)
      const onItsOwnRoute = SITES.some((s) => s.marker === e.marker)
      // In the source but not as ANY discovered dispatch is the unbound case.
      return inSource && !onItsOwnRoute
    }).map((e) => e.marker)
    expect(lifted, "an allowlist marker that appears in the source but is not a discovered dispatch line").toEqual([])

    // And the property, stated as a fixture: a marker copied onto a different
    // route does not transfer, because the match is the whole dispatch line.
    const other = SITES.find((s) => s.marker !== DECLARED_PUBLIC[0].marker)
    expect(
      ALLOWLIST_BY_MARKER.has(other.marker),
      "a marker is bound to its own dispatch line, so it cannot excuse a different route"
    ).toBe(false)
  })

  it("requires every sourceComment to sit inside that route's OWN block", () => {
    // Region-bound, never window-bound. A sourceComment is the ONE place a source
    // comment reaches this file's verdict, and it is worth being precise about
    // that: it is an ADDITIONAL requirement, never an exemption. The comment
    // must be inside the route's own handler block; if it has drifted elsewhere,
    // or been deleted, the entry fails.
    const unbound = DECLARED_PUBLIC.filter((e) => e.sourceComment && !SITES.some((s) => s.marker === e.marker && regionCarries(s, e.sourceComment)))
      .map((e) => e.marker)
    expect(
      unbound,
      "these entries cite a sourceComment that is no longer inside their own route's block. Move the " +
        "justification onto the route, or drop the sourceComment field — a comment in a 12-line window " +
        "is the escape the earlier rounds were bitten by, and this is the region-bound replacement."
    ).toEqual([])
    expect(
      DECLARED_PUBLIC.filter((e) => e.sourceComment).length,
      "at least one entry must cite a source-side justification, or the region-bound sourceComment rule " +
        "is never exercised"
    ).toBeGreaterThan(0)
  })
})

describe("WS-7 slice C — the guard's own teeth", () => {
  const GATE_LINE = "if (!(await requireAuth(req, res))) return true"

  it("catches an ungated route planted in a real dispatch shape", () => {
    // The 15th route, planted. This is the exact shape the executed probes found:
    // a `path ===` dispatch, a `path.match` dispatch, and a lookup-table entry,
    // none of them gated. The invariant must report every one.
    const planted = [
      'if (path === "/api/planted/plain" && req.method === "POST") {',
      "  writeJson(res, 200, { ok: true })",
      "  return",
      "}",
      "const m = path.match(/^\\/api\\/planted\\/([a-z]+)$/)",
      "if (m) {",
      "  writeJson(res, 200, { ok: true, id: m[1] })",
      "  return",
      "}",
      '"/api/planted/table": async (req, res, parsed) => {',
      "  writeJson(res, 200, { ok: true })",
      "  return true",
      "}"
    ].join("\n")
    const sites = discoverRouteSites(planted.split("\n"))
    expect(
      sites.map((s) => s.form).sort(),
      "all three planted dispatch forms must be discovered, or this test proves nothing"
    ).toEqual(["path ===", "path.match", "table"])
    const caught = sites.filter((s) => !isGated(s).ok && !ALLOWLIST_BY_MARKER.has(s.marker))
    expect(
      caught.length,
      "every planted ungated route must be reported by the invariant"
    ).toBe(3)
  })

  it("accepts the same three shapes once each carries its own gate", () => {
    // The mirror, so the rejection above is not just a rule that rejects
    // everything — including the table form, which the sibling guard cannot see
    // even when it IS gated.
    const planted = [
      'if (path === "/api/planted/plain" && req.method === "POST") {',
      `  ${GATE_LINE}`,
      "  writeJson(res, 200, { ok: true })",
      "  return",
      "}",
      '"/api/planted/table": async (req, res, parsed) => {',
      `  ${GATE_LINE}`,
      "  writeJson(res, 200, { ok: true })",
      "  return true",
      "}"
    ].join("\n")
    const sites = discoverRouteSites(planted.split("\n"))
    expect(sites.map((s) => isGated(s).ok)).toEqual([true, true])
  })

  it("still rejects a gate that runs AFTER the route has answered", () => {
    // Ordering, not presence. A dead gate is what a presence-only check calls
    // safety.
    const planted = [
      'if (path === "/api/planted/late" && req.method === "POST") {',
      "  writeJson(res, 200, { ok: true, secret: await readStore() })",
      `  ${GATE_LINE}`,
      "  return",
      "}"
    ].join("\n")
    const sites = discoverRouteSites(planted.split("\n"))
    expect(isGated(sites[0]).ok, "a gate that cannot run before the response is not a gate").toBe(false)
    expect(isGated(sites[0]).why).toMatch(/BEFORE/)
  })

  it("does not mistake a static pre-gate response for a disclosure", () => {
    // The carve-out, pinned in both directions so it cannot widen or vanish. A
    // 429 rate limit and a static 503 "not configured" precede real gates at
    // handlers.mjs:2739, :2763, :2776, :4755, :4786 and :5558.
    const rateLimited = [
      'if (path === "/api/planted/rl" && req.method === "POST") {',
      "  if (rateLimited(k, 10, 60_000)) {",
      '    writeJson(res, 429, { error: "rate limited" })',
      "    return true",
      "  }",
      `  ${GATE_LINE}`,
      '  writeJson(res, 200, { ok: true })',
      "  return",
      "}"
    ].join("\n")
    const notConfigured = [
      'if (path === "/api/planted/nc" && req.method === "POST") {',
      '  if (!env.thing) return writeJson(res, 503, { error: "thing not configured" })',
      `  ${GATE_LINE}`,
      '  writeJson(res, 200, { ok: true })',
      "  return",
      "}"
    ].join("\n")
    expect(isGated(discoverRouteSites(rateLimited.split("\n"))[0]).ok, "a 429 is not a disclosure").toBe(true)
    expect(isGated(discoverRouteSites(notConfigured.split("\n"))[0]).ok, "a static 503 is not a disclosure").toBe(
      true
    )
    // And a DYNAMIC body before the gate is still a disclosure.
    const dynamic = [
      'if (path === "/api/planted/dyn" && req.method === "POST") {',
      "  try {",
      '    writeJson(res, 200, { positions: await paperPositions() })',
      "  } catch (err) {",
      '    writeJson(res, 500, { ok: false, error: err.message })',
      "  }",
      "  return",
      "}"
    ].join("\n")
    expect(isGated(discoverRouteSites(dynamic.split("\n"))[0]).ok).toBe(false)
  })

  it("does not mistake a `return true` sentinel for a response", () => {
    // The false positive that put six genuinely-gated routes on the ungated list
    // when this rule was first written: /api/trading/realtime, /api/packs/ack,
    // /api/webfetch/limits/reset, /api/agents/run, /api/agents/settings and
    // /api/browser/stream all write a 4xx and then `return true` before their
    // gate. Pinned so the sentinel cannot be dropped by accident and re-open
    // six false failures, and cannot be widened to excuse a real response.
    const planted = [
      'if (path === "/api/planted/sentinel" && req.method === "GET") {',
      "  if (badOrigin) {",
      '    writeJson(res, 403, { error: "origin not allowed" })',
      "    return true",
      "  }",
      `  ${GATE_LINE}`,
      "  writeJson(res, 200, { ok: true })",
      "  return true",
      "}"
    ].join("\n")
    expect(isGated(discoverRouteSites(planted.split("\n"))[0]).ok, "a sentinel is control flow, not a response").toBe(
      true
    )
  })

  it("a table keyed from a VARIABLE is invisible, and the backstop makes that loud", () => {
    // LIMITATION I1, ADDED IN FIX ROUND 1, and it is the SECOND silent blind spot
    // rather than the first. Limitation 5 below named only the name-bound
    // literal door; this is a different one and it was undisclosed, which is
    // worse than a bound nobody knows about.
    //
    // TABLE_DISPATCH is `^\s*"(?<route>\/api[^"]*)"\s*:\s*…` — the key must be a
    // quoted literal at the start of the trimmed line. So
    //
    //     const H = { ["/api/x"]: async (req, res) => {…} }   // computed key
    //     const H = { KEY:     async (req, res) => {…} }      // name-bound key
    //
    // are discovered as no site at all, so no assertion is made about either and
    // the route arrives unchecked. The second is the same class as the
    // name-bound literal already bounded, and is caught by that backstop; the
    // first is genuinely new: a `/api/…` string that never appears at the start
    // of a line.
    const computed = ['const H = { ["/api/planted/computed-key"]: async (req, res) => {', "  return true", "} }"].join(
      "\n"
    )
    const named = [
      'const KEY = "/api/planted/named-key"',
      "const H = {",
      "  KEY: async (req, res) => {",
      "    return true",
      "  }",
      "}"
    ].join("\n")
    expect(
      discoverRouteSites(computed.split("\n")),
      "THIS IS BOUND I1, SHOWN: a route table whose key is a computed property is discovered by no form in " +
        "discoverRouteSites, so it arrives unchecked. The backstop below is what keeps it loud."
    ).toEqual([])
    expect(discoverRouteSites(named.split("\n")), "and a name-bound table key is the same blindness").toEqual([])
  })

  it("no route table key is computed or name-bound, so bound I1 stays loud", () => {
    // THE BACKSTOP for I1, and it is the same shape as the name-bound-literal
    // backstop so the two bounds fail the same loud way. Resolving a table key to
    // its literal is scope analysis — a parser, not a scan — so the achievable
    // thing is to make the corpus of such keys provably empty.
    //
    // It also covers the case the first backstop cannot see: a `/api/…` literal
    // that appears in the file but is never a dispatch operand at all, because it
    // is an object key reached through a variable. Asserting that every `/api/…`
    // string in handlers.mjs is either a discovered dispatch marker or an
    // allowlist marker is the strong form, and it is what would catch a table
    // route written this way even if the spelling drifted.
    const offenders = []
    for (const site of SITES) {
      if (site.form !== "table") continue
      if (!/^\s*"\/api\/[^"]*"\s*:/.test(site.rawRegion?.[0] ?? site.region[0] ?? "")) {
        offenders.push(`handlers.mjs:${site.line}  a table site whose key is not a leading string literal`)
      }
    }
    expect(
      offenders,
      "a discovered table site whose key is not a leading \"/api/…\" literal means TABLE_DISPATCH matched something " +
        "this file cannot reason about. Widen the key handling deliberately rather than trusting the match."
    ).toEqual([])

    // The strong form: every `/api/…` string in the code view is accounted for by
    // a discovered dispatch marker or an allowlist entry. A literal in neither is
    // a route nobody is asserting anything about.
    const accounted = new Set()
    for (const site of SITES) accounted.add(site.route)
    const unaccounted = []
    const code = stripComments(SRC)
    code.split("\n").forEach((raw, i) => {
      for (const m of raw.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)) {
        if (!accounted.has(m[1]) && !/[=,]|:/.test(raw.slice(0, m.index).trimEnd().slice(-1))) {
          // A `/api/…` string with no dispatch operator in front of it on the line.
          if (!/\b(?:===|startsWith|match|includes|join|path)\b/.test(raw)) unaccounted.push(`handlers.mjs:${i + 1}  ${m[1]}`)
        }
      }
    })
    expect(
      unaccounted,
      "a /api/… string literal that is neither a discovered dispatch route nor part of a route expression is a path " +
        "this guard cannot see. It is most likely a route table keyed from a variable (bound I1) or a route assembled " +
        "at runtime — either way the route behind it is unchecked."
    ).toEqual([])
  })

  it("a gate name inside a MULTI-LINE template literal is found, not missed", () => {
    // IMPORTANT 1, PLANTED. The backstop scanned LINE BY LINE and reset `quote`
    // per line, so a backtick opening on one line and closing on a later one was
    // never entered as a string. The review planted exactly this and it PASSED:
    // the scan reported [] while `isGated` returned true for the same text, which
    // is a false pass — the backstop was blind to precisely the case where the
    // scan's premise (string contents are visible) stops being checkable.
    //
    // The planted fixture asserts BOTH halves, because either alone can pass for
    // the wrong reason: the scanner must FIND the gate name, and `isGated` must
    // then treat the text as a string and NOT as a gate.
    const planted = [
      'if (path === "/api/planted/tmpl" && req.method === "GET") {',
      "  const banner = `",
      "    heads up: this route is protected by",
      "    requireAuth() and friends",
      "  `",
      "  writeJson(res, 200, { ok: true, items: await listItems() })",
      "  return true",
      "}"
    ].join("\n")
    const found = stringGateNames(planted)
    expect(
      found,
      "THIS IS THE PLANT, SHOWN: a gate name inside a template literal that SPANS LINES was invisible to the " +
        "backstop, so the corpus check reported [] and isGated still read the string as a gate. The scan must " +
        "carry its template state across the newline."
    ).toHaveLength(1)
    expect(found[0], "and it must name the gate that leaked").toContain("requireAuth(")
    // And the reason the backstop exists at all: the same text IS read as a gate
    // by the verdict, which is the false pass the corpus check must prevent.
    const site = discoverRouteSites(planted.split("\n"))[0]
    expect(site, "the planted route must still be discovered").toBeDefined()
    expect(
      isGated(site).ok,
      "while the string is NOT blanked, isGated reads the template as a real gate — which is exactly why a " +
        "multi-line gate name must be caught by the corpus check"
    ).toBe(true)
  })

  it("a single-line string gate name is still found, and both string forms are scanned", () => {
    // The control for the plant above, and it must keep working: a fix that made
    // the scanner stateful must not have broken the case it already handled.
    for (const [label, planted] of [
      ["double-quoted", ['const n = "call requireAuth() first"', "const m = 1"].join("\n")],
      ["single-quoted", ["const n = 'call requireSessionOrFirstRun() first'", "const m = 1"].join("\n")],
      ["multi-line template", ["const n = `call", "requireAuthStrict() now`", "const m = 1"].join("\n")]
    ]) {
      expect(stringGateNames(planted), `${label} string must be scanned`).toHaveLength(1)
    }
    // A quote inside a string must not end it early, or the scan would report
    // half a literal and miss the rest.
    const tricky = ['const n = "he said \\" requireAuth() \\" loudly"', "const m = 1"].join("\n")
    expect(stringGateNames(tricky), "an escaped quote must not terminate the literal early").toHaveLength(1)
    // And a gate name that is REAL CODE is not a string leak and must not be
    // reported, or the corpus check would demand the impossible.
    const real = ["if (!(await requireAuth(req, res))) return true", "const m = 1"].join("\n")
    expect(stringGateNames(real), "a real gate call is code, not a string, and must not be reported").toEqual([])
  })

  it("a conditional block opened on a CLOSING-BRACE line is conditional", () => {
    // IMPORTANT 2, PLANTED TWICE. `CONDITIONAL_OPENERS` was anchored with `^`, so
    // a line whose text is `} else {` or `} catch (err) {` never matched it. The
    // stack was still correct — `braceRoles` returns ["close","open"] for such a
    // line, so the `}` popped and the `{` pushed — but the `conditional` flag was
    // computed from the LINE TEXT, which does not start with `else` or `catch`,
    // so it pushed `false`. Both shapes therefore reported a gate as
    // UNCONDITIONAL: the unsafe direction, a false pass.
    //
    // The seeds for both plants are ordinary control flow, which is why this went
    // unnoticed: `else` and `catch` almost always follow a closing brace.
    const elseShape = [
      'if (path === "/api/planted/else" && req.method === "GET") {',
      "  if (badOrigin) {",
      '    writeJson(res, 403, { error: "origin not allowed" })',
      "    return true",
      "  } else {",
      "    if (!(await requireAuth(req, res))) return true",
      "    writeJson(res, 200, { ok: true, items: await listItems() })",
      "    return true",
      "  }",
      "  return false",
      "}"
    ].join("\n")
    const catchShape = [
      'if (path === "/api/planted/catch" && req.method === "GET") {',
      "  try {",
      "    loadRegistry()",
      "  } catch (err) {",
      "    if (!(await requireAuth(req, res))) return true",
      "    writeJson(res, 200, { ok: true, items: await listItems() })",
      "    return true",
      "  }",
      "  return false",
      "}"
    ].join("\n")
    for (const [label, planted] of [
      ["} else {", elseShape],
      ["} catch (err) {", catchShape]
    ]) {
      const site = discoverRouteSites(planted.split("\n"))[0]
      expect(site, `${label}: the planted route must be discovered`).toBeDefined()
      const verdict = isGated(site)
      expect(
        verdict.ok,
        `${label}: a gate in that block runs only on some requests, so it must NOT gate the route. ` +
          `Got ok=true. A closing brace leads the line, so the opener keyword is not at the start.`
      ).toBe(false)
      expect(verdict.why, `${label}: and the reason must name the conditionality`).toMatch(/conditional/i)
    }
  })

  it("a neutral block opened on a closing-brace line is NOT conditional", () => {
    // THE CONTROL for IMPORTANT 2, and it is the false-positive risk the fix
    // carries. `} finally {` and `} catch` are the neighbours of `} else {`: if
    // the fix is written as "a `}` at the start of the line means conditional",
    // then a `finally` block — which ALWAYS runs when reached — would be reported
    // conditional, and a real gate inside one would be wrongly exonerated. The
    // reviewer measured the corpus of `} else {` and `} catch (err) {` as 0; this
    // is the case that keeps the fix from being lazy.
    const finallyShape = [
      'if (path === "/api/planted/finally" && req.method === "GET") {',
      "  try {",
      "    loadRegistry()",
      "  } finally {",
      "    closeRegistry()",
      "  }",
      "  if (!(await requireAuth(req, res))) return true",
      "  writeJson(res, 200, { ok: true, items: await listItems() })",
      "  return true",
      "}"
    ].join("\n")
    const site = discoverRouteSites(finallyShape.split("\n"))[0]
    expect(site, "the planted route must be discovered").toBeDefined()
    expect(
      isGated(site).ok,
      "a finally block always runs when reached, and the gate is after it, so it must still count as a gate"
    ).toBe(true)
  })

  it("a statement ahead of the gate on the same line is not a conditional", () => {
    // THE MINOR FROM ROUND 2. `const h = 1; if (!(await requireAuth(req, res))) return true`
    // was reported as "the gate is inside a conditional opened on the dispatch
    // line" — a false POSITIVE, in the safe direction, with a corpus of 0. The
    // cause is the same `if (` as the gate's OWN head: the head text before the
    // gate is `const h = 1; if (!(await `, which contains `if (`.
    //
    // The discriminator is that the gate's own spelling in all three of this
    // file's idioms is `if (!(await <gate>(`, so that trailing `if (` belongs to
    // the GATE and not to a container. Stripping it, and scanning only the text
    // after the last statement boundary, keeps a genuine container detectable —
    // asserted by the second half of this test.
    const sameLine = [
      'if (path === "/api/planted/sameline" && req.method === "GET") {',
      "  const h = 1; if (!(await requireAuth(req, res))) return true",
      "  writeJson(res, 200, { ok: true, items: await listItems() })",
      "  return true",
      "}"
    ].join("\n")
    const site = discoverRouteSites(sameLine.split("\n"))[0]
    expect(site, "the planted route must be discovered").toBeDefined()
    const verdict = isGated(site)
    expect(
      verdict.ok,
      "a plain statement before the gate does not make the gate conditional: " + JSON.stringify(verdict)
    ).toBe(true)
    // And a REAL container on the same line must still be caught, or the fix is
    // just "stop looking".
    const realContainer = [
      'if (path === "/api/planted/sameline2" && req.method === "GET") {',
      "  const limit = 5; if (limit > 0) { if (!(await requireAuth(req, res))) return true }",
      "  writeJson(res, 200, { ok: true, items: await listItems() })",
      "  return true",
      "}"
    ].join("\n")
    expect(
      isGated(discoverRouteSites(realContainer.split("\n"))[0]).ok,
      "a gate inside a same-line `if (limit > 0) { … }` is conditional and must be refused"
    ).toBe(false)
  })

  it("the nesting discriminator is load-bearing: the over-strict mutant is far worse", () => {
    // ROUND 2's MEASUREMENT, MADE MACHINE-CHECKED. The fix for IMPORTANT 2 could
    // have been "any enclosing block counts as conditional", which is simpler and
    // looks safer. It is not safe: it exonerates every real gate that sits behind
    // a `try`, a 4xx carve-out, or a destructuring line, and the review measured
    // that mutant at 108 offenders across the 222 sites. Only 7 are genuine.
    //
    // So the discriminator — a block that has CLOSED before the gate cannot
    // enclose it — is load-bearing, and this test is what would catch its loss.
    // The number is asserted as a FLOOR, not an exact figure, so ordinary churn
    // does not make it brittle; what must never happen is the mutant's count
    // collapsing toward zero, which is what "any enclosing block counts" gives.
    const overStrict = SITES.filter((s) => {
      // The naive mutant: every line before the gate that opens ANY block is
      // treated as a conditional container, with no notion of it having closed.
      let enclosing = false
      for (let i = 0; i < s.region.length; i += 1) {
        const roles = braceRoles(s.region[i])
        for (const role of roles) if (role === "close") enclosing = false
        if (CONDITIONAL_OPENERS.test(s.region[i].trim())) enclosing = true
        if (GATES.some((g) => s.region[i].includes(g))) break
      }
      return enclosing
    }).length
    expect(
      overStrict,
      "the over-strict mutant is the wrong predicate: it condemns real gates that sit behind a closed `try`, a " +
        "4xx carve-out, or a destructuring line. If this number has collapsed toward the ~7 genuine offenders, " +
        "the nesting discriminator has been lost and the guard is reporting routes as gated that are not."
    ).toBeGreaterThan(90)
    // And the real predicate, for contrast, must leave only the routes that are
    // genuinely conditional. Zero here, because the two live ones are now gated
    // or allowlisted.
    //
    // IT REPORTS THE OFFENDING MARKERS, not a bare count, because a count says only
    // THAT something regressed while a marker says WHICH route — and this assertion has
    // just caught a real regression, which a bare 1 could not have been traced from.
    const genuinelyConditional = SITES.filter((s) => {
      const verdict = isGated(s)
      return !verdict.ok && /conditional/i.test(verdict.why ?? "")
    }).map((s) => `handlers.mjs:${s.line}  ${s.marker}`)
    expect(
      genuinelyConditional,
      "after fixing IMPORTANT 1 and 2, no route in handlers.mjs has a gate nested in a conditional — the two " +
        "that did (/api/trading/notifications, /api/agents/run's neighbours) are resolved. A non-zero count " +
        "means a new conditional gate landed and was not dealt with."
    ).toEqual([])
  })

  it("no string literal in handlers.mjs contains a gate call, so preserving strings is safe", () => {
    // THE OTHER HALF OF C1, and the reason it needed two assertions rather than
    // one. `stripComments` blanks comment CONTENT but deliberately PRESERVES
    // string CONTENTS, because the dispatch predicates need to see the
    // `"/api/health"` literal in the code view. Preserving strings is only safe
    // while no string literal contains something that looks like a gate call —
    // otherwise C1 comes straight back through the string door:
    //
    //     const note = "remember to call requireAuth() here"
    //
    // is a comment in all but spelling, and the scan would read it as this
    // route's gate. The sibling guard carries the same assertion for the same
    // reason. The corpus is 0 today — verified, not assumed — so the rule costs
    // nothing, and if it ever becomes non-zero the guard says why it is unsafe
    // instead of quietly reading the string as a gate.
    expect(
      stringGateNames(SRC),
      "a string literal containing a gate call would be read as a gate, because stripComments preserves string " +
        "contents so the dispatch predicates can see route literals. Either reword the string or extend the lexer — " +
        "do not leave a comment-in-a-string able to satisfy a gate"
    ).toEqual([])
  })

  it("stripComments blanks a comment that names a gate, and preserves the code beside it", () => {
    // THE PORT IS PROVEN TO DO BOTH THINGS, not merely to exist. If it stopped
    // blanking, C1 returns; if it over-blanked — blanking a line that also
    // carries real code, which is how the sibling guard's predicates once
    // started passing vacuously — the gate on that line would vanish and routes
    // would be reported ungated. Both directions are asserted here on fixtures,
    // and the second fixture is the real one-line shape that caused it.
    const commented = [
      'if (path === "/api/planted/x" && req.method === "GET") {',
      "  // requireAuth() is NOT called here.",
      "  return true",
      "}"
    ].join("\n")
    const view = stripComments(commented)
    expect(view, "the comment's gate name must be gone from the code view").not.toContain("requireAuth(")
    expect(
      stripComments('  const gate = "requireAuth(" // gone\n  const keep = 1'),
      "a real line comment is blanked even when the line also carries code"
    ).not.toContain("// gone")
    // A URL in a string on the same line as a gate must not blank the gate: this
    // is the exact shape that made the sibling guard's hasUsers() scan find ZERO
    // sites and pass every predicate vacuously.
    const urlOnGateLine = [
      '  const home = "http://localhost:5173"; if (!(await requireAuth(req, res))) return true',
      "  const v = \"b\" / (a); if (!(await requireAuth(req, res))) return true"
    ].join("\n")
    for (const line of stripComments(urlOnGateLine).split("\n")) {
      expect(
        line,
        "a quoted // must not blank the gate on the same line — a guard a coding style can switch off is not a guard"
      ).toContain("requireAuth(")
    }
    // And the whole point: the line numbers survive, so a code offset still
    // points at the right row.
    expect(stripComments("a\n// c\nb").split("\n").length, "line count must be preserved").toBe(3)
  })

  it("a comment pasted onto an ungated route does not excuse it", () => {
    // THE COMMENT-BYPASS ATTACK, on the surface where it previously worked. The
    // source comment that justifies a declared-public route is copied verbatim
    // onto a DIFFERENT, ungated route — exactly what defeated a window-based
    // marker check in the earlier rounds. It must change nothing here, because
    // this guard never reads a comment to reach a verdict.
    //
    // RE-POINTED IN FIX ROUND 1. This fixture used a comment with NO gate name in
    // it, so it passed for the wrong reason: `isGated` scans the region's lines
    // for a gate substring and this comment contained none, so the assertion held
    // without the comment ever being load-bearing. It proved nothing about the
    // class it was named for. The comment below now contains a gate name — the
    // exact string an author writes when documenting "auth happens elsewhere" —
    // so the test goes RED against the pre-fix predicate and is only green
    // because comments are blanked before the scan. See stripComments().
    const planted = [
      'if (path === "/api/planted/pasted" && req.method === "POST") {',
      "  // Auth is handled by requireAuth() upstream in the router.",
      "  // No session check happens in this block.",
      "  writeJson(res, 200, { ok: true, watchlists: await listWatchlists() })",
      "  return",
      "}"
    ].join("\n")
    const site = discoverRouteSites(planted.split("\n"))[0]
    expect(site, "the pasted route must still be discovered").toBeDefined()
    expect(isGated(site).ok, "a pasted comment naming requireAuth() must NOT read as a gate").toBe(false)
    expect(ALLOWLIST_BY_MARKER.has(site.marker), "and the pasted route is not in the allowlist").toBe(false)
  })

  it("a comment that merely NAMES a gate cannot make a route gated — the live defect", () => {
    // THE C1 DEFECT, IN THE SHAPE THE REAL SOURCE USES. handlers.mjs:4364
    // (`GET /api/auth/status`) carries a nine-line comment explaining that the
    // `hasUsers()` inside it is a first-run SIGNUP HINT and authorises nothing,
    // and that prose contains the literal `requireSessionOrFirstRun(`. Because
    // `isGated` scanned the region's raw lines, that comment was read as the
    // route's gate: the guard reported a route with NO gate as GATED, and the
    // inventory marked it closed so the owner was never asked about it. It also
    // made this slice's own two gates fragile — deleting the real `requireAuth`
    // and keeping the comment would have left the build green.
    //
    // The line-pinned form below is the real one, verbatim in structure, and it
    // must read as UNGATED. `why` is asserted too, so the test cannot pass by
    // being rejected for an unrelated reason.
    const planted = [
      'if (path === "/api/auth/status" && (req.method === "GET" || req.method === "POST")) {',
      "  // NOT A GATE. hasUsers() here is the first-run SIGNUP HINT. It authorises",
      "  // nothing — the bootstrap it hints at is enforced by",
      "  // requireSessionOrFirstRun() / requireAuth on the routes that matter.",
      "  writeJson(res, 200, { ok: true, hasUsers: await hasUsers(), authMode: 'local' })",
      "  return",
      "}"
    ].join("\n")
    const site = discoverRouteSites(planted.split("\n"))[0]
    expect(site, "the route must still be discovered").toBeDefined()
    const verdict = isGated(site)
    expect(verdict.ok, "a comment naming requireSessionOrFirstRun() must not make an ungated route gated").toBe(false)
    expect(verdict.why, "and it must be rejected for having no gate, not for some unrelated reason").toMatch(
      /no gate/
    )
  })

  it("a gate inside a conditional that covers only some actions is not a gate for the route", () => {
    // THE C2 DEFECT, IN THE SHAPE THE REAL SOURCE USES. handlers.mjs:3687
    // (`/api/trading/notifications`) gates only
    // `if (req.method === "POST" && ["webhook-settings","webhook-test"].includes(action))`,
    // then answers GET, `read`, `read-all`, `clear` (which DELETES stored
    // notifications) and inject for an anonymous caller. `isGated` found the
    // gate text, saw no answer in front of it, and called the whole route gated.
    //
    // The predicate being fixed is "is the gate on an UNCONDITIONAL path from the
    // top of the region", not "does the text appear before the answer". This
    // fixture is the minimal shape of the defect: the gate is real, it is before
    // the disclosure, and the route is still not gated, because a GET reaches the
    // writeJson without ever passing the gate.
    const planted = [
      'if (path === "/api/planted/conditional" && (req.method === "GET" || req.method === "POST")) {',
      '  if (req.method === "POST" && body.action === "dangerous") {',
      "    if (!(await requireAuth(req, res))) return true",
      "    writeJson(res, 200, { ok: true })",
      "    return true",
      "  }",
      "  writeJson(res, 200, { ok: true, notifications: await getNotifications() })",
      "  return true",
      "}"
    ].join("\n")
    const site = discoverRouteSites(planted.split("\n"))[0]
    expect(site, "the route must still be discovered").toBeDefined()
    const verdict = isGated(site)
    expect(verdict.ok, "a gate reachable by only one action cannot gate the whole route").toBe(false)
    expect(verdict.why, "and the reason must name the conditionality").toMatch(/conditional|unconditional/i)
  })

  it("a gate that is unconditional but preceded by work is still a gate", () => {
    // THE CONTROL for the C2 fix, and the reason the predicate is nesting-based
    // rather than "the gate must be the region's first statement". A dynamic
    // import or a parsed parameter before the gate is ordinary and does NOT make
    // the gate conditional. If this test fails, the fix over-corrected into a
    // false positive that would have put every import-then-gate route on the
    // offender list.
    const planted = [
      'if (path === "/api/planted/unconditional" && req.method === "GET") {',
      '  const { getNotifications } = await import("./services/notificationCenter.mjs")',
      "  if (!(await requireAuth(req, res))) return true",
      "  writeJson(res, 200, { ok: true, notifications: getNotifications() })",
      "  return true",
      "}"
    ].join("\n")
    expect(isGated(discoverRouteSites(planted.split("\n"))[0]).ok).toBe(true)
  })

  it("the three 4xx carve-outs keep their gates after the conditional fix", () => {
    // THE FALSE-POSITIVE GUARD FOR C2. /api/trading/realtime, /api/packs/ack
    // and /api/webfetch/limits/reset all sit behind an `if` that writes a 4xx and
    // returns. A predicate that counted "any enclosing `if`" as conditional
    // would wrongly exonerate their real gates and put three genuinely-gated
    // routes on the ungated list — the mirror image of the defect. The
    // discriminator is that a block which has CLOSED before the gate cannot
    // enclose it, so these three stay gated. Pinned by name against the real
    // source so the fix cannot quietly reopen them.
    for (const route of ["/api/trading/realtime", "/api/packs/ack", "/api/webfetch/limits/reset"]) {
      const site = SITES.find((s) => s.route === route)
      expect(site, `${route} must still be discovered — if it vanished, the carve-out is untested`).toBeDefined()
      expect(isGated(site).ok, `${route} writes a 4xx and returns, so its gate is unconditional and must stand`).toBe(
        true
      )
    }
  })

  it("demonstrates the blind spot a name-bound route literal creates", () => {
    // PLANTED IN THE REAL SOURCE AND DEMONSTRATED, NOT DESCRIBED. This exact
    // three-line shape was added to handlers.mjs and the whole guard run: 17 of
    // 17 tests stayed GREEN and the route appeared nowhere in the output. A
    // dispatch that compares `path` against a NAME rather than a literal is
    // discovered by no form in findRouteSites, so no site is found and no
    // assertion is made about it — the same failure mode the sibling guard
    // recorded for `switch` and a route map, and the reason this file does not
    // simply claim the dispatch surface is covered.
    //
    // It is asserted here so the blindness is a machine-checked fact about this
    // file rather than a sentence in a comment, and so the backstop below can be
    // pointed at a demonstrated gap rather than a hypothetical one.
    const planted = [
      '  const PLANTED_COMPUTED_ROUTE = "/api/teeth/computed"',
      '  if (path === PLANTED_COMPUTED_ROUTE && req.method === "GET") {',
      "    if (!(await requireAuth(req, res))) return true",
      "    writeJson(res, 200, { ok: true, watchlists: await listWatchlists() })",
      "    return true",
      "  }"
    ].join("\n")
    expect(
      discoverRouteSites(planted.split("\n")),
      "THIS IS THE BOUND, SHOWN: a name-bound route literal is invisible to every dispatch form, so a " +
        "route written this way arrives unchecked. The backstop test below is what keeps it loud."
    ).toEqual([])
  })

  it("no route literal is bound to a NAME, so the blind spot above stays loud", () => {
    // THE BACKSTOP for the bound just demonstrated. Resolving a name to its
    // literal needs scope analysis, which is a parser rather than a scan, and a
    // half-measure that looked like coverage is the failure mode this file exists
    // to prevent — the same reasoning the sibling guard gave for not chasing its
    // own limitation #1.
    //
    // What IS available is turning the silence into a red build. `path === X`
    // where X is a name is the only way a route literal gets out of this file's
    // reach, so the rule is: no `const NAME = "/api/…"` in handlers.mjs. The
    // corpus is 0 today — verified, not assumed — so the rule costs nothing and
    // catches the door rather than the room.
    const offenders = LINES.map((text, i) => ({ text: text.trim(), line: i + 1 }))
      .filter((r) => !r.text.startsWith("//") && /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*["'`]\/api\//.test(r.text))
      .map((r) => `handlers.mjs:${r.line}  ${r.text}`)
    expect(
      offenders,
      "a route literal is bound to a name, so a dispatch comparing `path` against that name is " +
        "invisible to every form in findRouteSites() and the route would arrive UNCHECKED — demonstrated " +
        "green in this file's own 'blind spot' test above. Either dispatch the literal directly, or " +
        "extend findRouteSites() to resolve the binding before merging."
    ).toEqual([])
  })

  it("the two destructive deletes are the sites this slice gated", () => {
    // The finding, pinned at the structural level. Both were confirmed by
    // execution to answer 200 to an anonymous caller and to mutate by id; both
    // are now gated, and neither may appear in the allowlist.
    for (const marker of [
      'if (path === "/api/trading/alerts/delete" && req.method === "POST") {',
      'if (path === "/api/trading/watchlists/delete" && req.method === "POST") {'
    ]) {
      const site = SITES.find((s) => s.marker === marker)
      expect(site, `${marker} must still be routed`).toBeDefined()
      expect(isGated(site).ok, `${marker} must be gated`).toBe(true)
      expect(ALLOWLIST_BY_MARKER.has(marker), `${marker} must NOT be declared public`).toBe(false)
    }
  })
})

/**
 * KNOWN LIMITATIONS — what this guard does NOT close. Stated rather than
 * claimed away, because a guard that claims more than it enforces is worse than
 * one that admits its edge: the false claim is what let ~40 routes through.
 *
 * 1. THE REGION WALK IS INDENTATION-BASED. A route whose body is written at an
 *    unexpected indent is not followed into, and a single-line `if (...) return x`
 *    has no block to walk. Both shapes are covered by fixtures for the
 *    single-line case; an unusual indent is not detected, it is simply not
 *    followed. This is inherited from the sibling guard, which was bitten by the
 *    single-line case and failed UNSAFE; the fix there was the same one used here.
 *
 * 2. THE GATE VOCABULARY IS THREE NAMES PLUS ONE IDIOM. A gate written as
 *    `ensureAuthenticated()`, or hoisted into a helper that calls one of the three
 *    but is not itself one of the three, is not seen as a gate and the route is
 *    reported ungated. That errs toward a FALSE FAILURE, which is the safe
 *    direction, and adding a fourth name is a one-line change. The reverse — a
 *    function that merely MENTIONS one of the three names in its own block — is
 *    not possible from this position.
 *
 * 3. THE INLINE IDIOM IS RECOGNISED BY SHAPE, NOT BY SEMANTICS.
 *    `await verifyUser(auth)` followed by `if (!userId) … writeJson(res, 401)`
 *    anywhere in the block counts as a gate even if the two are unrelated
 *    statements. A route that calls verifyUser for a logging line and refuses
 *    for some other reason would be accepted. Seven routes use the idiom
 *    genuinely today.
 *
 * 4. THE INLINE IDIOM FAILS CLOSED WITH THE WRONG STATUS. verifyUser() answers
 *    null when the SESSIONS store faults, so those seven routes answer 401
 *    where the shared gate answers 503 — 401 being the session-destroying
 *    status client-side. No access is granted, which is why this is a gap and
 *    not a hole. Migrating a site is `verifyTokenStrict()` + `strictOrRefuse()`,
 *    exactly as the shared gate does it, and the sibling guard pins the
 *    verifyUser call-site count for that migration.
 *
 * 5. DISCOVERY IS LINE-BASED AND SEES FOUR SPELLINGS. A dispatch assembled across
 *    lines by a template literal, a computed property key, or a regex built at
 *    runtime is not discovered, and therefore is not asserted about.
 *
 *    THE ONE THAT WAS DEMONSTRATED AGAINST THIS FILE, not hypothesised. A
 *    three-line dispatch planted in the REAL handlers.mjs —
 *
 *        const PLANTED_COMPUTED_ROUTE = "/api/teeth/computed"
 *        if (path === PLANTED_COMPUTED_ROUTE && req.method === "GET") {
 *          if (!(await requireAuth(req, res))) return true
 *
 *    — left this file 17/17 GREEN with the route appearing nowhere in the output.
 *    The plant was then removed. It is asserted, not narrated: the test
 *    "demonstrates the blind spot a name-bound route literal creates" runs that
 *    shape and requires `discoverRouteSites` to return `[]`, so the blindness is
 *    a machine-checked fact about this file.
 *
 *    Closing it needs scope analysis — resolving every binding a dispatch
 *    expression reaches — which is a parser, not a scan, and the same reasoning
 *    the sibling guard gave for not closing its limitation #1. What IS available
 *    is making the silence loud instead, and that is done: the `no route literal
 *    is bound to a NAME` test fails on any `const NAME = "/api/…"` in the file.
 *    The corpus is 0 today, verified, so the rule costs nothing. The remaining
 *    residual is a route literal that never appears as a `/api/…` string at all —
 *    assembled at runtime from parts — which no static rule here can see.
 *    `switch (path)` is the other such door, and unlike the computed one it is
 *    refused outright rather than merely bounded.
 *
 * 5b. BOUND I1, ADDED IN FIX ROUND 1: A ROUTE TABLE KEYED FROM A VARIABLE IS A
 *     SECOND, DISTINCT SILENT BLIND SPOT. The paragraph above named ONE door —
 *     the name-bound literal — and this file claimed the bounds were stated.
 *     They were not, and an undisclosed bound is worse than one nobody knows
 *     about, because it reads as covered.
 *
 *     TABLE_DISPATCH requires the key to be a quoted literal at the START of the
 *     trimmed line:
 *
 *         { "/api/x": async (req, res) => {…} }   discovered — the live shape
 *         { ["/api/x"]: async (req, res) => {…} } NOT discovered — computed key
 *         { KEY:     async (req, res) => {…} }   NOT discovered — name-bound
 *
 *     The second is genuinely new and the third is the limitation above wearing
 *     different clothes: a `/api/…` string that exists in the file but is never a
 *     dispatch OPERAND, so no site is created and no assertion is made about the
 *     route behind it. The corpus is 0 today, asserted, by the two backstops in
 *     the teeth block:
 *
 *       - every discovered TABLE site must have a leading string-literal key, so
 *         the pattern cannot quietly start matching something unmodelled; and
 *       - the STRONG form: every `/api/…` string literal in the code view must
 *         belong to a discovered route or be part of a route expression. A
 *         literal in neither is a path this guard cannot see, and the failure
 *         message says so.
 *
 *     No such table exists today, so the bound costs nothing — and it is
 *     disclosed rather than implied, which is the standard this file holds
 *     itself to: a guard that claims more than it enforces is worse than one
 *     that admits its edge.
 *
 * 5c. BOUND I2, ADDED IN FIX ROUND 2: A CONDITIONAL BLOCK WHOSE OPENING BRACE
 *     SITS ON THE DISPATCH'S OWN LINE IS NOT ATTRIBUTED TO ITS KEYWORD.
 *
 *     `conditionalReason` decides a line's blocks from the line's own TEXT, and a
 *     gate sitting on the same line as its container's `{` is reached before that
 *     brace is pushed. The one-line shape
 *
 *         if (cond) { if (!(await requireAuth(req, res))) return true … }
 *
 *     would therefore be read as an unconditional gate. The multi-line form of the
 *     same code is handled correctly — the opener gets its own line, is
 *     classified, and is on the stack when the gate is reached — and the same-line
 *     case is covered when the opener's `(` is still unclosed at the gate. The
 *     corpus is 0, asserted by the same-line tests, and the direction is a FALSE
 *     PASS, which is the direction that matters: it is stated here rather than
 *     left to be discovered.
 *
 *     It was NOT this file's round-2 finding. Round 2's finding was the opposite
 *     polarity — a gate on its own line preceded by a finished statement was
 *     wrongly reported conditional, a false NEGATIVE in effect — and that is
 *     fixed. This is the residue of that fix, and it is named because the fix
 *     moved the boundary from `{;}` to `;` and the movement is what created it.
 *
 * 6. A MARKER IS THE ROUTE'S OWN DISPATCH LINE, WHICH IS A WEAKER ANCHOR THAN A
 *    WRITTEN DECLARATION COMMENT. What the guard guarantees is that an exemption
 *    is bound to ONE exact dispatch site, cannot drift to another route, and
 *    cannot be duplicated. What it does NOT guarantee is that the exemption was
 *    argued at the call site — the argument lives in this file. An entry whose
 *    justification the owner wants visible next to the route should carry a
 *    `sourceComment`, and the guard then requires that comment inside the
 *    route's own block. Three entries do.
 *
* 7. THE ALLOWLIST IS A RECORD OF THE OWNER'S PENDING DECISION, NOT OF A
 *    DECISION. Seventy-four routes are listed with what each discloses and a
 *    recommendation, and 62 of them are still marked owner:"decision". The
 *    invariant they satisfy is "every route is either gated or DECLARED", not
 *    "every route is correctly classified". The second claim is the owner's to
 *    make and is not something a test can make for them.
 *
 *    COUNTS AS OF WS-7 T20R, recorded because this paragraph used to state a
 *    number ("Ninety-nine") that had already gone stale and would have gone
 *    staler again silently. The live numbers are 220 sites = 146 gated + 74
 *    allowlisted + 0 offenders, and the allowlist is 12 declared + 62 decision.
 *    T20R discharged 24 of the 86 open decisions: 21 were gated and their
 *    entries DELETED (the `no route is BOTH gated and allowlisted` assertion
 *    enforces that deletion rather than trusting it), and 3 were ruled public and
 *    reclassified owner:"declared" — /api/metrics, /api/packs/registry, and the
 *    /api/notifications wrapper. The remaining 62 are DEFERRED reads, still
 *    owner:"decision", still honestly labelled, and deliberately not gated and
 *    not allowlisted by this task.
 *
 *    NOTE ON `allowlistDecisionItems`: it exists only in the inventory EMITTER
 *    below, never as an assertion. There is no "decision items must be 0" check
 *    in this file, and T20R did not add one — the deferred 62 would fail it, and
 *    deleting or relaxing a check to make a count match is exactly the failure
 *    mode this file exists to prevent. The emitter prints the number so a reader
 *    can see the backlog shrinking rather than be told it is zero.
 *
 * 8. A GATE ON A `GET || POST` BRANCH GATES BOTH METHODS. Several markers admit
 *    two methods on one dispatch line, and a single requireAuth there closes the
 *    read as well as the write. T20R did not split those branches, because every
 *    one of them is a read on both methods or a read that no public client
 *    depends on — `/api/trading/status`, `/api/opportunities*`,
 *    `/api/notifications/status` and their siblings are all machine- or
 *    reference-data reads with no pre-auth consumer. The ONE place a split was
 *    actually required is the `/api/notifications` family wrapper, and it is
 *    split per sub-route rather than per method: the wrapper keeps its
 *    declared-public entry for `vapid-public-key`, and each of the five mutating
 *    sub-routes inside it carries its own requireAuth as the first statement of
 *    its own branch. That is the shape to copy if a future `GET || POST` branch
 *    turns out to have a genuinely public GET.
 */

// ---------------------------------------------------------------------------
// INVENTORY EMITTER
//
// The report's route table must not be a hand-typed second opinion. This block
// runs the SAME discoverRouteSites/isGated/DECLARED_PUBLIC the tests above assert
// on, so the table in
// .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/
//   task-route-auth-inventory-report.md
// cannot disagree with the guard by construction.
//
// It is inert unless WS7_WRITE_ROUTE_INVENTORY names an output file, so it adds
// no I/O to a normal `npm test`. Regenerate with:
//   WS7_WRITE_ROUTE_INVENTORY=<abs path> npx vitest run ws7RouteAuthCoverageGuard
// ---------------------------------------------------------------------------
if (process.env.WS7_WRITE_ROUTE_INVENTORY) {
  const { writeFileSync: writeInventoryFile } = await import("node:fs")

  /** The first non-precondition answer in a region, described for a human. */
  function describeDisclosure(site) {
    const found = []
    for (const raw of site.region) {
      const { text } = statementBody(raw)
      if (!/writeJson\s*\(|\bres\.(?:write|end|writeHead)\b/.test(text)) continue
      const w = /writeJson\s*\(/.exec(text)
      if (!w) continue
      const inner = text.slice(w.index + w[0].length)
      // 4xx refusals and static bodies carry nothing worth calling disclosure.
      if (/^\s*res\s*,\s*4\d\d/.test(inner) && !staticBody(inner)) continue
      const payload = inner.replace(/^\s*res\s*,\s*\d+\s*,\s*/, "").replace(/\)\s*$/, "").trim()
      if (/^(?:\(\)|\{\}|"\{\}"|\{\s*\})$/.test(payload)) continue
      found.push((payload || "(helper call)").replace(/\s+/g, " "))
      if (found.length >= 2) break
    }
    return found.length ? found.join(" ; ") : "(answers via a helper)"
  }

  const inventoryRows = SITES.map((site) => {
    const verdict = isGated(site)
    const entry = ALLOWLIST_BY_MARKER.get(site.marker)
    const method = site.region
      .map((l) => /req\.method\s*===\s*["'`]([A-Z]+)["'`]/.exec(l)?.[1])
      .find(Boolean)
    return {
      route: site.route,
      method: method ?? null,
      line: site.line,
      form: site.form,
      marker: site.marker,
      gated: verdict.ok === true,
      how: verdict.ok === true ? verdict.how : null,
      why: verdict.ok === true ? null : verdict.why,
      allowlisted: Boolean(entry),
      owner: entry?.owner ?? null,
      reason: entry?.reason ?? null,
      sourceComment: entry?.sourceComment ?? null,
      discloses: describeDisclosure(site)
    }
  })

  const tally = {
    sites: SITES.length,
    gated: inventoryRows.filter((r) => r.gated).length,
    allowlisted: inventoryRows.filter((r) => !r.gated && r.allowlisted).length,
    offenders: inventoryRows.filter((r) => !r.gated && !r.allowlisted).length,
    byForm: Object.fromEntries(
      ["path ===", "path.startsWith", "path.match", "table"].map((f) => [
        f,
        inventoryRows.filter((r) => r.form === f).length
      ])
    ),
    allowlistEntries: DECLARED_PUBLIC.length,
    allowlistDeclared: DECLARED_PUBLIC.filter((e) => e.owner === "declared").length,
    allowlistDecisionItems: DECLARED_PUBLIC.filter((e) => e.owner === "decision").length,
    allowlistWithSourceComment: DECLARED_PUBLIC.filter((e) => e.sourceComment).length,
    handlersSha: (await import("node:crypto"))
      .createHash("sha256")
      .update(SRC)
      .digest("hex")
      .slice(0, 16),
    switchSites: SWITCH_SITES.length
  }

  writeInventoryFile(process.env.WS7_WRITE_ROUTE_INVENTORY, JSON.stringify({ tally, rows: inventoryRows }, null, 2))
  // Readable enough to eyeball in a terminal when regenerating by hand.
  console.log(
    `WS7 route inventory: ${tally.sites} sites = ${tally.gated} gated + ${tally.allowlisted} allowlisted ` +
      `(${tally.offenders} offenders); allowlist ${tally.allowlistEntries} entries ` +
      `(${tally.allowlistDeclared} declared / ${tally.allowlistDecisionItems} decision items)`
  )
}
