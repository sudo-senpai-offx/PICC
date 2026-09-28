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
   * True when a `/` at i opens a regex literal rather than being division.
   * Conservative: after anything that can END a value, a `/` is division.
   */
  const regexAllowed = () => {
    for (let k = i - 1; k >= 0; k -= 1) {
      const c = out[k]
      if (c === " " || c === "\t" || c === "\r") continue
      return !(c && /[\w$)\]}.]/.test(c))
    }
    return true
  }
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
      continue
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
 * One axis alone is escapable and both together are not: a bare marker check is
 * defeated by pasting, a bare anchor check by relocating, and a window check by
 * both. See the two "pasted"/"far above" tests, which plant those attacks.
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
    const derived = (CODE.match(/\bbootstrapAnswer\s*\(/g) ?? []).length
    expect(derived, "exactly the three eWallet derivations: owner stamp, actor, selfApprove").toBe(4)
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

  it("every /api/connectors route is gated", () => {
    // /api/connectors (the AGGREGATE) had no gate at all while its sibling
    // /api/connectors/:slug/history was gated and discloses the same class of
    // data — live balances. It needs no store fault to be exploited, so it is
    // strictly easier to reach than anything in the fail-open class. Discovered
    // by scanning for the route literal, not listed.
    const codeLines = CODE.split("\n")
    const blocks = []
    for (let i = 0; i < codeLines.length; i += 1) {
      if (!codeLines[i].includes("/api/connectors")) continue
      blocks.push({ line: i + 1, text: codeLines[i].trim() })
    }
    expect(blocks.length, "the connectors family must still be discovered by the scan").toBeGreaterThan(0)
    const ungated = blocks.filter(
      (b) => !codeLines.slice(b.line - 1, b.line + 12).some((l) => l.includes(`${GATE_CALL}(`))
    )
    expect(
      ungated.map((b) => `handlers.mjs:${b.line}  ${b.text}`),
      "every /api/connectors route must pass through requireSessionOrFirstRun(). The aggregate " +
        "lists every connector (label, live url, selectors, tuning) plus getLatestSnapshots() " +
        "— live balances — and its own /:slug/history sibling is gated, so it is the outlier."
    ).toEqual([])
  })

  it("no string literal in the file contains something shaped like a call site", () => {
    // stripComments preserves string CONTENTS (only the lexing is string-aware),
    // which is what lets the connectors predicate above see the route literal.
    // That is only sound while no string can manufacture a finding.
    const offenders = [...SRC.matchAll(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g)]
      .map((m) => m[0])
      .filter((s) => new RegExp(`\\b${LENIENT}\\s*\\(`).test(s))
    expect(offenders, "a string containing a call-site shape would be scanned as code").toEqual([])
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
