// WS-7 slice B fix round 2 — the link check in `assertMintedIsolationRoot` must be
// able to FIRE.
//
// ── THE DEFECT THIS PINS ────────────────────────────────────────────────────
// Round 1 shipped:
//
//     if (lstatSync(canonical).isSymbolicLink()) throw ...
//
// `canonical` is the output of `canonicalizePath()`, which RESOLVES THROUGH LINKS.
// So `lstatSync(canonical)` describes whatever the root finally points at, and for a
// junction that is a real directory: `isSymbolicLink()` is structurally always false
// and the check could never fire. Proven on this box — with the root a junction,
// `lstat(root).isSymbolicLink()` is `true` while `lstat(canonical).isSymbolicLink()`
// is `false`. The error message claimed "the root itself is a link" while the code
// tested the resolved path.
//
// It is NOT a safety hole: the containment check (`isStrictlyInside`) fires first and
// did fire in the review's test. It is the same class of problem this whole guard
// restructure exists to eliminate — a comment advertising a protection the code does
// not provide.
//
// ── WHY NO LINK IS CREATED HERE ──────────────────────────────────────────────
// A previous review agent created a symlink pointing at `node_modules`, then removed
// the worktree with `rmdir /s /q`, which followed the link and destroyed the
// repository's `node_modules` plus 5 gitignored JSON files and 604 Chromium files in
// real `server/data/`. So this file makes no link of any kind. Instead the guard's
// `lstat` is injected, and the test hands it a stub that reports the UNRESOLVED root
// as a link and its CANONICAL form as not-a-link — precisely the state the real code
// would be in with a junction at the root. That proves the guard asks the right
// question, and it goes red against the old `lstatSync(canonical)` form, which
// ignores the injection entirely and so never sees the link.
//
// The one real filesystem object this test creates is an EMPTY directory, removed with
// `rmdirSync` (no recursion, no link, and `rmdirSync` refuses a non-empty directory).
import { mkdirSync, rmdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { dashboardRoot } from "../storeIsolation.mjs"
import { assertMintedIsolationRoot } from "../isoHarnessEnv.mjs"

const PLAYWRIGHT_TMP_ROOT = resolve(dashboardRoot(), ".playwright-tmp")

/** A 20-hex leaf, the exact shape `mintTmpRoot()` produces. */
function mintLikeLeaf() {
  return Array.from({ length: 20 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")
}

const created = []

afterEach(() => {
  // `rmdirSync` on an empty directory. Not a recursive delete: it throws rather than
  // remove anything if the directory is not empty, so it cannot follow a link.
  while (created.length > 0) {
    const dir = created.pop()
    try {
      rmdirSync(dir)
    } catch {
      /* already gone, or not empty — nothing to do, and never a recursive removal */
    }
  }
})

describe("assertMintedIsolationRoot", () => {
  it("refuses a root that IS a link, and asks lstat about the unresolved path", () => {
    const leaf = mintLikeLeaf()
    const root = join(PLAYWRIGHT_TMP_ROOT, leaf)
    mkdirSync(root, { recursive: true })
    created.push(root)

    const asked = []
    const lstat = (target) => {
      asked.push(target)
      // The unresolved root is a link; its dereferenced form is a plain directory.
      return { isSymbolicLink: () => target === root, isDirectory: () => true }
    }

    expect(() => assertMintedIsolationRoot(root, { lstat })).toThrow(/the root itself is a link/)
    // The guard must have put the question to `root`, not to the canonical path. This
    // is the assertion that fails against `lstatSync(canonical)`.
    expect(asked).toContain(root)
    expect(asked).not.toContain(resolve(root) === root ? "__canonical_equals_root__" : resolve(root))
  })

  it("accepts the same root when it is not a link, so the check is not vacuously throwing", () => {
    const leaf = mintLikeLeaf()
    const root = join(PLAYWRIGHT_TMP_ROOT, leaf)
    mkdirSync(root, { recursive: true })
    created.push(root)

    const lstat = () => ({ isSymbolicLink: () => false, isDirectory: () => true })
    expect(() => assertMintedIsolationRoot(root, { lstat })).not.toThrow()
  })

  it("still refuses a leaf that is not a 20-hex mint name, before touching the disk", () => {
    const root = join(PLAYWRIGHT_TMP_ROOT, "not-a-mint-name")
    const lstat = () => {
      throw new Error("lstat must not be reached: the shape check runs first")
    }
    expect(() => assertMintedIsolationRoot(root, { lstat })).toThrow(/20-hex-character name/)
  })

  it("still refuses a root that is not directly under .playwright-tmp", () => {
    const lstat = () => ({ isSymbolicLink: () => false, isDirectory: () => true })
    const elsewhere = join(PLAYWRIGHT_TMP_ROOT, "..", mintLikeLeaf())
    expect(() => assertMintedIsolationRoot(elsewhere, { lstat })).toThrow(/not directly under/)
  })
})
