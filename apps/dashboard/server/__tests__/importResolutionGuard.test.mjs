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
// checked, because those are the ones this repository owns; a bare specifier is
// resolved by the package manager and is a different failure mode with a
// different owner. Non-JS assets (css, images, wasm) are exempt, and `?query`
// / `#hash` suffixes are stripped before resolution, so a cache-busting import
// of a real file is not reported as broken.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { describe, it, expect } from "vitest"
import ts from "typescript"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const require_ = createRequire(join(REPO_ROOT, "apps/dashboard/package.json"))

const SOURCE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx)$/
const RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]
const INDEX_NAMES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"]
const ASSET_EXT = /\.(css|scss|less|svg|png|jpe?g|gif|webp|wasm|html|txt|md)$/

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
