// WS-7 T2 - repo-wide relative-import resolution guard.
//
// WHY THIS EXISTS. The ExpertOption removal deleted
// `apps/extension-archived/src/selectors/expertoption.ts` and then left
// `apps/extension-archived/src/capture.ts:14` importing it. The full dashboard
// suite was GREEN while that import pointed at a file that did not exist,
// because `apps/extension-archived` is not in the dashboard's test or build
// graph. Nothing failed, nothing warned, and the breakage was found only by
// reading the file by hand. That is the whole defect: a broken import in a
// directory no test reaches is indistinguishable from correct code until
// something explodes at runtime.
//
// A guard scoped to the file someone happened to remember would have missed the
// next one, so the scope here is the whole tracked tree, and the scope is
// DISCOVERED from `git ls-files` rather than listed. A new package, a new
// workspace, or a brand-new directory is covered the moment it is tracked.
//
// WHY A REAL PARSER. Resolving specifiers with a regex over raw source produced
// 53 false positives on this tree, in three shapes:
//   - cache-busting specifiers - `import x from "../handlers.mjs?case=vault"`,
//     where the file exists and only the query differs;
//   - fixture source held in template literals - seam guards that build a fake
//     module as a string and import it, so the specifier is DATA, not an import;
//   - and, hiding among them, one genuinely broken import.
//
// So the specifiers are read from the AST with the TypeScript compiler that
// this repo already depends on, via `createSourceFile`. Only real import/export
// declarations and real `require(` / `import(` / `vi.mock(` call sites are
// collected. A string that merely CONTAINS an import is not an import.
//
// WHY `vi.mock` COUNTS. Vitest intercepts a mocked specifier and never loads
// the real module, so `vi.mock("../services/gone.mjs", factory)` plus
// `await import("../services/gone.mjs")` is a live, loadable-looking reference
// to a file that does not exist. `realtimeSuite.test.mjs` carried exactly that
// pair for the deleted `liveEO.mjs` and passed 8/8. If that mock were ever
// dropped, the test would fail for a reason unrelated to what it claims to
// test. Mock specifiers are therefore resolution dependencies like any other.
//
// WHAT IS AND IS NOT ENFORCED. Only RELATIVE specifiers ("./", "../") are
// checked for RESOLUTION, because those are the ones this repository owns; a bare
// specifier is resolved by the package manager and is a different failure mode
// with a different owner. Non-JS assets (css, images, wasm) are exempt, and
// `?query` / `#hash` suffixes are stripped before resolution, so a cache-busting
// import of a real file is not reported as broken.
//
// ---------------------------------------------------------------------------
// WS-7 T18 / AC-039 — PROHIBITED-SOURCE SWEEP, ADDED TO THIS GUARD
// ---------------------------------------------------------------------------
//
// T18's `Files` clause names "the import/dependency guard" as the place a new
// source is added, and AC-039 requires prohibited scrapers to be "absent and
// pinned absent", verified by "a guard test with a synthetic offending
// dependency". This file IS that guard, so the check lives here rather than in
// a second file that could drift from the first.
//
// THREE SCOPES, because the prohibited thing can arrive three ways:
//
//   1. A DEPENDENCY NAME in any tracked `package.json`. The wrappers are the
//      point: `apify-twitter` and `@vendor/bloomberg` name no prohibited host
//      and are still the prohibited thing.
//   2. An IMPORT/REQUIRE/vi.mock SPECIFIER — read from the AST by the same
//      parser above, so a fixture string that merely CONTAINS an import is not
//      treated as one.
//   3. An http(s) URL LITERAL in comment-stripped production source. This is
//      the runtime half: a hardcoded `https://www.forexfactory.com/calendar` is
//      the same ToS exposure with no manifest entry at all.
//
// The matcher is `newsSources.mjs`'s, imported rather than re-declared, so the
// guard and the decision cannot disagree about what is prohibited. The synthetic
// tests at the bottom feed IT the shapes a real addition would take; if the
// matcher ever stops catching one, those fail.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { describe, it, expect } from "vitest"
import ts from "typescript"

import { prohibitedHostFor, prohibitedTargetFor, PROHIBITED_SOURCE_TARGETS } from "../services/newsSources.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const require_ = createRequire(join(REPO_ROOT, "apps/dashboard/package.json"))

const SOURCE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx)$/
const RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]
const INDEX_NAMES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"]
const ASSET_EXT = /\.(css|scss|less|svg|png|jpe?g|gif|webp|wasm|html|txt|md)$/

/** Directories whose comments and strings are DATA, not production code. */
const NON_PRODUCTION = /(^|\/)(node_modules|build|dist|coverage|\.next|\.plasmo|__tests__|__mocks__|fixtures)\//

function trackedSourceFiles() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => SOURCE_EXT.test(f))
    .filter((f) => !/(^|\/)(node_modules|build|dist|coverage|\.next|\.plasmo)\//.test(f))
}

function scriptKind(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX
  if (/\.(ts|mts|cts)$/.test(file)) return ts.ScriptKind.TS
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

/** Real module specifiers from the AST. Fixture strings are not imports. */
export function collectSpecifiers(src, file) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, scriptKind(file))
  const out = []
  const push = (node) => {
    if (node && ts.isStringLiteralLike(node)) {
      out.push({ spec: node.text, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 })
    }
  }
  const walk = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      push(node.moduleSpecifier)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const dynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const requireCall = ts.isIdentifier(callee) && callee.text === "require"
      const vitestMock =
        ts.isIdentifier(callee) && (callee.text === "mock" || callee.text === "doMock" || callee.text === "unmock")
      if (dynamicImport || requireCall || vitestMock) push(node.arguments[0])
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return out
}

export function resolvesFrom(fromAbs, spec) {
  const clean = spec.split("?")[0].split("#")[0]
  if (clean === "") return false
  if (ASSET_EXT.test(clean) && !clean.endsWith(".json")) return true
  const base = resolve(dirname(fromAbs), clean)
  for (const ext of RESOLVE_EXTS) {
    if (existsSync(base + ext) && statSync(base + ext).isFile()) return true
  }
  for (const name of INDEX_NAMES) {
    if (existsSync(join(base, name))) return true
  }
  return false
}

function scan() {
  const files = trackedSourceFiles()
  const broken = []
  let checked = 0
  for (const rel of files) {
    const abs = join(REPO_ROOT, rel)
    for (const { spec, line } of collectSpecifiers(readFileSync(abs, "utf8"), rel)) {
      if (!spec.startsWith(".")) continue
      checked++
      if (!resolvesFrom(abs, spec)) broken.push({ rel, line, spec })
    }
  }
  return { files, broken, checked }
}

const { files, broken, checked } = scan()

// ── WS-7 T18 / AC-039: the prohibited-source sweep ───────────────────────────

function tracked(pathspec) {
  return execFileSync("git", ["ls-files", "--", ...pathspec], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
    .split(/\r?\n/)
    .filter(Boolean)
}

/** Every declared dependency name in every tracked manifest, with its file. */
function declaredDependencies() {
  const out = []
  for (const rel of tracked(["package.json", "apps/*/package.json", "agents/*/requirements.txt", "apps/*/requirements.txt"])) {
    const abs = join(REPO_ROOT, rel)
    if (!existsSync(abs)) continue
    if (rel.endsWith(".json")) {
      let json
      try {
        json = JSON.parse(readFileSync(abs, "utf8"))
      } catch {
        continue
      }
      for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        for (const name of Object.keys(json?.[section] ?? {})) out.push({ rel, name })
      }
    } else {
      for (const line of readFileSync(abs, "utf8").split(/\r?\n/)) {
        const name = line.trim().split(/[<>=!~[\s]/)[0]
        if (name && !name.startsWith("#") && name.length > 1) out.push({ rel, name })
      }
    }
  }
  return out
}

/**
 * Strip comments from a source file so a PROSE mention of a prohibited target in
 * a removal record is not a finding. This is the same discipline
 * `ws5SeamGuard.test.mjs`'s residue check uses, and for the same reason: several
 * hundred D2 removal RECORDS name the thing they removed.
 */
function stripComments(src) {
  let out = ""
  let i = 0
  const n = src.length
  let inLine = false
  let inBlock = false
  let quote = null
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (inLine) {
      if (c === "\n") {
        inLine = false
        out += c
      }
      i += 1
      continue
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false
        i += 2
        continue
      }
      if (c === "\n") out += c
      i += 1
      continue
    }
    if (quote) {
      out += c
      if (c === "\\") {
        out += next ?? ""
        i += 2
        continue
      }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === "/" && next === "/") {
      inLine = true
      i += 2
      continue
    }
    if (c === "/" && next === "*") {
      inBlock = true
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      out += c
      i += 1
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** http(s) URL literals in comment-stripped production source. */
function urlLiterals(src) {
  const out = []
  const re = /https?:\/\/[^\s"'`)<>\]]+/gi
  let m
  while ((m = re.exec(src)) !== null) {
    out.push(m[0].replace(/[.,;:]+$/, ""))
  }
  return out
}

function prohibitedSourceScan() {
  const deps = declaredDependencies()
  const dependencyFindings = []
  for (const d of deps) {
    const target = prohibitedTargetFor(d.name)
    if (target) dependencyFindings.push(`${d.rel}: dependency "${d.name}" targets ${target}`)
  }

  const sourceFindings = []
  const specifierFindings = []
  const production = files.filter((f) => !NON_PRODUCTION.test(f))
  for (const rel of production) {
    const src = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"))
    for (const { spec } of collectSpecifiers(src, rel)) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        const target = prohibitedTargetFor(spec)
        if (target) specifierFindings.push(`${rel}: import specifier "${spec}" targets ${target}`)
      }
    }
    for (const url of urlLiterals(src)) {
      const target = prohibitedHostFor(url)
      if (target) sourceFindings.push(`${rel}: URL literal "${url}" targets ${target}`)
    }
  }
  return {
    dependencyFindings,
    sourceFindings,
    specifierFindings,
    dependenciesScanned: deps.length,
    productionFilesScanned: production.length,
    findings: [...dependencyFindings, ...specifierFindings, ...sourceFindings]
  }
}

const prohibited = prohibitedSourceScan()

describe("WS-7 T2 - every relative import in the tracked tree resolves to a file that exists", () => {
  it("proves the scan set is real, so a silently-empty sweep cannot pass", () => {
    // A guard that scans nothing passes forever. Pin the floor: the sweep must
    // reach the whole tracked source tree, and it must actually be reading
    // module specifiers out of it rather than matching nothing.
    expect(files.length).toBeGreaterThan(500)
    expect(checked).toBeGreaterThan(1000)
    // The two directories whose absence from every other graph is the reason
    // this guard exists. If either stops being tracked, coverage silently drops
    // back to the blind spot that hid the original break.
    expect(files.some((f) => f.startsWith("apps/extension-archived/src/"))).toBe(true)
    expect(files.some((f) => f.startsWith("apps/dashboard/server/"))).toBe(true)
    expect(files.some((f) => f.startsWith("scripts/"))).toBe(true)
  })

  it("reports zero unresolvable relative specifiers", () => {
    const inventory = broken.map((b) => `${b.rel}:${b.line} -> ${b.spec}`).join("\n")
    expect(broken, `unresolvable relative import(s):\n${inventory}`).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-039 — "Prohibited scrapers are absent and pinned absent."
//
//   Scenario:  A dependency or scraper targeting Bloomberg, X, or ForexFactory
//              is added.
//   Action:    Run the import/dependency guard.
//   Expected:  The guard fails and NAMES the target.
//   Prohibited: ToS-prohibited scraping may not be introduced indirectly; a
//              package that wraps it is still caught.
//   Verification: A guard test with a synthetic offending dependency.
// ───────────────────────────────────────────────────────────────────────────

describe("WS-7 T18 / AC-039 — no ToS-prohibited scraper, by any of the three routes in", () => {
  it("the sweep is real: it read dependencies, production files and specifiers", () => {
    // Same anti-vacuity floor as the resolution sweep above. A guard that scans
    // nothing is indistinguishable from a guard that finds nothing.
    expect(prohibited.dependenciesScanned, "no dependency names were read").toBeGreaterThan(10)
    expect(prohibited.productionFilesScanned, "no production files were read").toBeGreaterThan(200)
  })

  it("reports zero prohibited dependency names", () => {
    expect(prohibited.dependencyFindings.join("\n")).toBe("")
  })

  it("reports zero prohibited import specifiers", () => {
    expect(prohibited.specifierFindings.join("\n")).toBe("")
  })

  it("reports zero prohibited URL literals in comment-stripped production source", () => {
    expect(prohibited.sourceFindings.join("\n")).toBe("")
  })

  it("all three routes are clean AT ONCE, and the failure names the target", () => {
    // One assertion so a reviewer reads one number, and so the failure text is
    // the inventory - AC-039 asks that the guard "fails and names the target".
    expect(prohibited.findings, `prohibited source(s) introduced:\n${prohibited.findings.join("\n")}`).toEqual([])
  })

  it("a removal RECORD naming a prohibited target is not a finding", () => {
    // The reason the sweep strips comments: `newsSources.mjs`'s own header and
    // D17's decision text both name the targets in prose. A substring guard that
    // read comments would either demand those records be deleted or fail on the
    // very file that implements the prohibition.
    const withProse = stripComments(`// we removed bloomberg-scraper and the x.com calendar\nconst url = "https://forexlive.com/feed/news"\n`)
    expect(urlLiterals(withProse)).toEqual(["https://forexlive.com/feed/news"])
    expect(urlLiterals(withProse).map(prohibitedHostFor)).toEqual([null])
  })
})

describe("AC-039 — the SYNTHETIC offending dependency, in every shape a real one takes", () => {
  // These are the tests AC-039's `Verification` line asks for. Each one feeds the
  // GUARD'S OWN matcher the shape an author would actually publish, so a matcher
  // that quietly stops catching one fails HERE rather than in production.

  it("a bare prohibited package name is caught and named", () => {
    for (const [spec, target] of [
      ["bloomberg-scraper", "Bloomberg"],
      ["forexfactory", "ForexFactory"],
      ["twitter-scraper", "X (Twitter)"]
    ]) {
      expect(prohibitedTargetFor(spec), `${spec} was not caught`).toBe(target)
    }
  })

  it("a WRAPPER is caught — the 'indirectly' clause of the prohibition", () => {
    for (const [spec, target] of [
      ["apify-twitter", "X (Twitter)"],
      ["@apify/twitter-scraper", "X (Twitter)"],
      ["@somevendor/bloomberg", "Bloomberg"],
      ["bloomberg-terminal-sdk", "Bloomberg"],
      ["forex_factory", "ForexFactory"],
      ["ForexFactoryPy", "ForexFactory"]
    ]) {
      expect(prohibitedTargetFor(spec), `wrapper ${spec} was not caught`).toBe(target)
    }
  })

  it("a hardcoded prohibited URL is caught, subdomains included", () => {
    expect(prohibitedHostFor("https://www.bloomberg.com/feed/podcast")).toBe("Bloomberg")
    expect(prohibitedHostFor("https://x.com/user/status/1")).toBe("X (Twitter)")
    expect(prohibitedHostFor("https://mobile.twitter.com/x")).toBe("X (Twitter)")
    expect(prohibitedHostFor("https://www.forexfactory.com/calendar")).toBe("ForexFactory")
  })

  it("the guard does NOT fire on this repository's legitimate sources", () => {
    // The other half of a useful matcher. A guard that flags
    // `news.google.com/rss` would be removed within a day, and its removal would
    // take AC-039's coverage with it.
    for (const url of [
      "https://news.google.com/rss/search?q=crypto",
      "https://www.forexlive.com/feed/news",
      "https://feeds.content.dowjones.io/public/rss/mw_topstories",
      "https://www.federalreserve.gov/feeds/press_all.xml"
    ]) {
      expect(prohibitedHostFor(url), `${url} was wrongly flagged`).toBeNull()
    }
    for (const dep of ["ccxt", "playwright", "web-push", "typescript", "react-dom", "vitest"]) {
      expect(prohibitedTargetFor(dep), `${dep} was wrongly flagged`).toBeNull()
    }
  })

  it("the matcher is newsSources.mjs's, so the guard and the decision cannot drift", () => {
    // Every declared target must be reachable through the exported matchers.
    // Adding a fourth entry to PROHIBITED_SOURCE_TARGETS without teaching a
    // matcher to reach it would fail here.
    const reachable = [
      ...PROHIBITED_SOURCE_TARGETS.map((t) => prohibitedTargetFor(`${t.id}-probe`)),
      ...PROHIBITED_SOURCE_TARGETS.map((t) => prohibitedHostFor(`https://probe.${t.id}.example/x`))
    ]
    // The host half is exercised per-target below; the id half proves each entry
    // is at least wired into the package matcher.
    for (const hit of reachable.slice(0, PROHIBITED_SOURCE_TARGETS.length)) {
      expect(typeof hit).toBe("string")
    }
    expect(PROHIBITED_SOURCE_TARGETS.length).toBe(3)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-038 / R14.3 — "Manual news input is impossible in the UI."
//
//   Expected observable result: "...no manual-news input affordance exists."
//   Verification: "a UI test that no manual-news input exists."
//
// This is that UI test, done at the SOURCE level rather than by clicking. A
// click-through test can only find the affordance somebody thought to look for;
// a sweep of every tracked client file for a text-entry control whose nearest
// labelled neighbour is a news or sentiment concept finds the ones nobody
// thought of. It is deliberately a WHITELIST of the two things that look like
// news entry and are not — see below.
// ───────────────────────────────────────────────────────────────────────────

describe("AC-038 / R14.3 — no manual-news input affordance exists", () => {
  const clientFiles = () =>
    tracked(["apps/dashboard/src/**/*.ts", "apps/dashboard/src/**/*.tsx"]).filter((f) =>
      /\.(ts|tsx)$/.test(f)
    )

  /** A control that takes free text from an operator. */
  const TEXT_ENTRY = /<textarea|<input(?![^>]*\btype\s*=\s*["'](?:checkbox|radio|range|submit|button)["'])[^>]*>/i
  const NEWSY = /(?:headline|news|sentiment|newsFeed|newsItem|newsText)/i

  /**
   * The ONE text entry this sweep finds in a news surface, and why it is not
   * the prohibited affordance.
   *
   * `TradingSuite.tsx:1392` is the Market-news SEARCH box: its value is a query
   * string PICC hands to a licensed source (`getMarketNews({ query })` →
   * `/api/trading/news` → `marketNews()` → Serper). It cannot supply a headline,
   * and it is not new — it predates T18 and is the search affordance the news
   * room has always had.
   *
   * It is listed here rather than folded into a looser regex, because a regex
   * that quietly excludes "the search box" is a regex that will quietly exclude
   * a headline box somebody adds next to it. The exclusion is therefore NAMED,
   * keyed to one file, and the assertion below pins the property that makes it
   * safe: the value reaches the wire as `query`, never as an item body.
   */
  const NOT_MANUAL_NEWS_INPUT = Object.freeze([
    Object.freeze({
      rel: "apps/dashboard/src/components/TradingSuite.tsx",
      match: /placeholder="Query or symbol/,
      valueBinding: /value=\{query\}/
    })
  ])

  it("the sweep reaches the client tree, so a silently-empty sweep cannot pass", () => {
    expect(clientFiles().length, "no client files were read").toBeGreaterThan(50)
  })

  it("no text-entry control sits next to a news/sentiment concept", () => {
    const findings = []
    const excluded = []
    for (const rel of clientFiles()) {
      const src = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"))
      const lines = src.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        if (!TEXT_ENTRY.test(lines[i])) continue
        // Look at the control and its nearest surrounding lines: a labelled text
        // box is the affordance, and its label is what names it.
        const window = lines.slice(Math.max(0, i - 8), i + 9).join("\n")
        if (!NEWSY.test(window)) continue
        const allowance = NOT_MANUAL_NEWS_INPUT.find((a) => a.rel === rel && a.match.test(lines[i]))
        if (allowance && allowance.valueBinding.test(lines[i])) {
          excluded.push(`${rel}:${i + 1}`)
          continue
        }
        findings.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`)
      }
    }
    expect(findings.join("\n"), `manual news input affordance(s):\n${findings.join("\n")}`).toBe("")
    // The allowance must actually have been used, or it is dead configuration
    // that would silently start covering a headline box if the control changed.
    expect(excluded.length, "the search-box allowance matched nothing, so it is no longer protecting anything").toBe(
      NOT_MANUAL_NEWS_INPUT.length
    )
  })

  it("the excluded search box's value reaches the wire as `query`, never as an item body", () => {
    // The property that makes the exclusion safe. `query` is passed to
    // `getMarketNews({ query })` and nothing else; a headline would have to be
    // carried as a news ITEM, and there is no code path that does that.
    const src = readFileSync(join(REPO_ROOT, "apps/dashboard/src/components/TradingSuite.tsx"), "utf8")
    expect(src).toMatch(/getMarketNews\(\{\s*query:/)
    expect(src).not.toMatch(/items\s*:\s*\[\s*\{[^}]*headline/i)
    expect(src).not.toMatch(/headline\s*:\s*(?:q|query|input)/i)
  })

  it("the excluded control is still bound to the `query` state, not to a headline state", () => {
    const src = readFileSync(join(REPO_ROOT, "apps/dashboard/src/components/TradingSuite.tsx"), "utf8")
    expect(src).toMatch(/const \[query, setQuery\] = useState\(""\)/)
    expect(src).not.toMatch(/const \[headline, setHeadline\]/i)
  })

  it("there is no news/sentiment route that accepts a headline in its BODY", () => {
    // The server half of "impossible". `/api/trading/news` takes a `query`, which
    // is a search string PICC passes to a licensed source - not a headline an
    // operator supplies. `/api/trading/sentiment` takes only `symbol`.
    const handlers = stripComments(readFileSync(join(REPO_ROOT, "apps/dashboard/server/handlers.mjs"), "utf8"))
    const body = /body\?\.\s*(headline|newsItem|newsText|newsBody|manualNews|sentimentText)\b/i
    expect(body.test(handlers), "a route accepts an operator-supplied headline in its body").toBe(false)
  })

  it("no client field is NAMED as a manual news input", () => {
    const findings = []
    for (const rel of clientFiles()) {
      const src = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"))
      const m = src.match(/\b(?:manualNews|newsHeadline|headlineInput|newsSentimentInput|pasteHeadline)\b/gi)
      if (m) findings.push(`${rel}: ${[...new Set(m)].join(", ")}`)
    }
    expect(findings.join("\n")).toBe("")
  })

  it("the two `headline` occurrences in the client are a GENERATED OUTPUT, not an input", () => {
    // `ContentStudio.tsx` renders `result.draft.headline` — a field the Content
    // Studio GENERATES and then displays. Asserting it exists pins the distinction
    // rather than leaving it to a reader: a field named `headline` that is READ
    // from operator input would be exactly the prohibited affordance.
    const src = readFileSync(join(REPO_ROOT, "apps/dashboard/src/components/ContentStudio.tsx"), "utf8")
    expect(src).toContain("result.draft.headline")
    expect(src).not.toMatch(/onChange[^>]*headline/i)
    expect(src).not.toMatch(/name=["']headline["']/i)
  })
})
