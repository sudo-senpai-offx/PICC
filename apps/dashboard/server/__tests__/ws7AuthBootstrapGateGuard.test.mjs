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
    reason:
      "chart-source preference key selection. Picks whose saved pin to read; both branches " +
      "collapse to the same \"default\" key, the whole block is inside a try/catch with a plain " +
      "\"auto\" fan-in fallback, and it sits behind no authorisation decision of its own. Routing " +
      "it through the strict helper would only throw into a catch that already swallows it, while " +
      "making the block look like a security boundary."
  },
  {
    marker: "NOT A GATE. hasUsers() here is the first-run SIGNUP HINT",
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
 * Line numbers are preserved so a code offset still points at the right row,
 * and a blanked `//` still begins with `//` so a line stays a comment.
 */
function stripComments(src) {
  const out = src.split("")
  let inBlock = false
  for (let i = 0; i < src.length; i += 1) {
    const two = src.slice(i, i + 2)
    const ch = src[i]
    if (inBlock) {
      if (two === "*/") {
        out[i] = " "
        out[i + 1] = " "
        i += 1
        inBlock = false
      } else if (ch !== "\n") {
        out[i] = " "
      }
      continue
    }
    if (two === "/*") {
      out[i] = " "
      out[i + 1] = " "
      i += 1
      inBlock = true
      continue
    }
    if (two === "//") {
      // Blank to end of line, keeping the newlines themselves.
      for (let j = i; j < src.length && src[j] !== "\n"; j += 1) out[j] = " "
      i = src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i)
      continue
    }
  }
  return out.join("")
}

const SRC = readFileSync(HANDLERS, "utf8")
const CODE = stripComments(SRC)

/**
 * Every `hasUsers(` CALL SITE, discovered by scanning CODE.
 *
 * The 12-line window is taken from the ORIGINAL source, not the stripped view,
 * because the "this is not a gate" justification is a comment and the scan must
 * be able to see it.
 */
function scanCallSites(code, original = code) {
  const codeLines = code.split("\n")
  const originalLines = original.split("\n")
  const sites = []
  for (let i = 0; i < codeLines.length; i += 1) {
    const line = codeLines[i]
    if (!new RegExp(`\\b${LENIENT}\\s*\\(`).test(line)) continue
    const from = Math.max(0, i - 12)
    sites.push({
      line: i + 1,
      text: line.trim(),
      window: originalLines.slice(from, i + 2).join("\n")
    })
  }
  return sites
}

const SITES = scanCallSites(CODE, SRC)

/** A site is a gate when it uses the strict helper or is behind the gate call. */
function isGate(site) {
  return site.window.includes(`${STRICT_HELPER}(`) || site.window.includes(`${GATE_CALL}(`)
}

/**
 * The verdict. A `hasUsers()` call site is ACCEPTED only if it carries a
 * reasoned NOT-A-GATE marker.
 *
 * Deliberately NOT "…unless a gate call appears somewhere nearby". An earlier
 * draft of this file used a 12-line window and classified any site below a
 * `requireSessionOrFirstRun(` as fine — and that was a real false negative,
 * caught by planting a 15th gate-shaped site three lines under a legitimate
 * gate call, which the window rule passed. A heuristic that can be satisfied by
 * proximity is not a guard. The window survives only to make the FAILURE
 * MESSAGE better, never to make the verdict.
 */
function isAccepted(site) {
  return ALLOWLIST.some((a) => site.window.includes(a.marker))
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

  it("has exactly one place that can grant the bootstrap bypass", () => {
    // The choke point must exist and must be the ONLY grantor, or the class
    // regrows the moment somebody writes their own copy of the decision.
    const definitions = (CODE.match(new RegExp(`async function ${GATE_CALL}\\s*\\(`, "g")) ?? []).length
    expect(definitions, "the shared gate must be defined exactly once").toBe(1)
    const grants = (CODE.match(new RegExp(`\\b${STRICT_HELPER}\\s*\\(`, "g")) ?? []).length
    // One call inside the gate itself, plus THREE on the eWallet money routes
    // (the order owner stamp, the submit actor stamp, and selfApprove), which
    // are deliberately derived from the same strict helper rather than from a
    // second, looser source. A fourth means a new bypass grantor appeared.
    expect(grants, "every strict answer must go through firstRunBootstrapAllowed()").toBe(4)
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

describe("WS-7 AUTH-FAILOPEN — the guard's own teeth and the allowlist's honesty", () => {
  it("gives every allowlist entry a written reason and a live marker", () => {
    // NOT an "empty allowlist is the intended state" assertion: this list is
    // deliberately non-empty, because two `hasUsers()` calls are genuinely not
    // gates and the honest thing is to say which and why. What is pinned is
    // that an entry is a written justification rather than a bare marker, and
    // that its marker still EXISTS in the source — a stale entry, whose call
    // site moved or was deleted, fails rather than silently excusing a
    // different one.
    for (const entry of ALLOWLIST) {
      expect(typeof entry.reason, "an allowlist entry must carry a written reason").toBe("string")
      expect(entry.reason.trim().length, "a bare marker is not an allowance").toBeGreaterThan(40)
      expect(
        SRC.includes(entry.marker),
        `allowlist entry is stale: its marker is no longer in handlers.mjs — ${entry.marker}`
      ).toBe(true)
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
