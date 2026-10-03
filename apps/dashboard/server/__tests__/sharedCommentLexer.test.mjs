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
import { readFileSync } from "node:fs"
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

/** The three vitest consumers, which cannot be imported without re-running their suites. */
const VITEST_CONSUMERS = Object.freeze([
  "apps/dashboard/server/__tests__/importResolutionGuard.test.mjs",
  "apps/dashboard/server/__tests__/ws7AuthBootstrapGateGuard.test.mjs",
  "apps/dashboard/server/__tests__/ws7RouteAuthCoverageGuard.test.mjs"
])

describe("the shared comment lexer — ONE implementation, four consumers", () => {
  it("the two plain-script consumers expose the very same function object", () => {
    // Real `Object.is` identity, not a source-text resemblance. A copy would fail
    // here even if it were character-for-character identical today, which is the
    // whole point: identical twins drift, and this assertion is what stops the
    // second copy from being created.
    expect(probeStripComments).toBe(stripComments)
    expect(guardStripComments).toBe(stripComments)
    expect(typeof stripComments).toBe("function")
  })

  it("no consumer RETAINS a declaration — the four local lexers are gone", () => {
    // The negative half, and the one that actually fails if someone pastes the
    // lexer back. `ws7-seam-probe.mjs` is included even though the identity check
    // above already covers it: a declaration shadowing the import would satisfy
    // nothing here and everything in production.
    for (const rel of [...VITEST_CONSUMERS, "scripts/ws7-seam-probe.mjs"]) {
      const src = read(rel)
      expect(src, `${rel} still declares its own stripComments`).not.toMatch(
        /(?:function\s+stripComments|(?:const|let|var)\s+stripComments\s*=)/
      )
    }
  })

  it("each consumer resolves `stripComments` from the SAME absolute module", () => {
    // Identity by RESOLUTION rather than by name. Two files can both `import
    // { stripComments }` and still get different functions if they reach different
    // files — a duplicated module, a symlink, a second checkout. The specifier is
    // resolved against the consumer's own directory and compared to the shared
    // module's absolute path.
    for (const rel of [...VITEST_CONSUMERS, "scripts/ws7-seam-probe.mjs", "scripts/ws7-seam-guard.mjs"]) {
      const src = read(rel)
      const specifiers = [...src.matchAll(/from\s+"([^"]*guard-primitives\.mjs)"/g)].map((m) => m[1])
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
