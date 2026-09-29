// WS-7 slice B fix round 1 — import the e2e isolation harness WITHOUT leaking a
// `.playwright-tmp/<hash>/` tree on every unit-test run.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// `e2e/helpers/isolatedEnv.mjs` calls `mintTmpRoot()` (:171) and `buildIsolatedEnv()`
// (:172) at MODULE SCOPE, so merely importing it mkdirSyncs a fresh root and 17
// subdirectories. Two vitest files now import it — deliberately, because
// `server/__tests__/authMeTraceHarnessReach.test.mjs` and
// `server/__tests__/runbookIsolationContract.test.mjs` both have to assert against the
// harness's REAL contract rather than a hand-written copy of it — and vitest gives
// each test FILE its own module registry. So every `npx vitest run` minted two more
// roots, forever. Measured after ~6 runs: 15 roots / 255 subdirectories. It also
// breaks operator step 1, which identifies a run's directory by "newest root".
//
// A hand-written copy of the harness env is the obvious "fix" and it is the wrong
// one: a second description of the contract is a second thing to drift, and the copy
// would keep passing after the real harness stopped setting the variable the test
// depends on. So the import stays and the leak is fixed around it.
//
// ── WHY THE DELETE IS HAND-WRITTEN AND WHY THAT IS THE POINT ────────────────
// A blind `rmSync(root, { recursive: true, force: true })` is the exact operation
// that destroyed a repository's `node_modules` in an earlier review of this work: a
// symlink or junction was placed inside the tree, and the recursive delete followed
// it. `storeIsolation.mjs` owns the CONTAINMENT rule; it does not own a delete, and
// no helper there is link-aware. So this file does the two halves separately:
//
//   1. CONTAINMENT, by the existing helpers and a shape check — the target must be
//      literally `<apps/dashboard>/.playwright-tmp/<20 lowercase hex>`, must
//      canonicalise to something still strictly inside that parent, and must be a
//      real directory rather than a link. Anything else throws and NOTHING is removed.
//   2. DELETION, by a walk that NEVER follows a link: `readdirSync(withFileTypes)`
//      classifies each entry, and a symlink/junction is `unlink`ed as a link —
//      removing the link itself, not whatever it points at — so the tree can be
//      emptied without any recursion ever crossing out of it.
//
// `rmdirSync` on the (now empty) directory is the only other call. There is no
// `rm -rf`, no `rmdir /s`, and no `Remove-Item -Recurse` anywhere in this file, by
// construction rather than by convention.
import { afterAll, expect } from "vitest"
import { basename, join, resolve } from "node:path"
import { existsSync, lstatSync, readdirSync, rmdirSync, statSync, unlinkSync } from "node:fs"
import { canonicalizePath, dashboardRoot, isStrictlyInside } from "./storeIsolation.mjs"
import harnessEnv, { ISOLATION_TMP_ROOT, REQUIRED_ISOLATION_VARIABLES } from "../e2e/helpers/isolatedEnv.mjs"

export { harnessEnv, ISOLATION_TMP_ROOT, REQUIRED_ISOLATION_VARIABLES }

const PLAYWRIGHT_TMP_ROOT = resolve(dashboardRoot(), ".playwright-tmp")

/**
 * Prove `root` is the directory `mintTmpRoot()` minted, and nothing else.
 *
 * Throws rather than returning a fallback: a cleanup that gives up quietly is a
 * cleanup that silently stops running, which is the bug this file exists to remove.
 */
export function assertMintedIsolationRoot(root) {
  if (typeof root !== "string" || root.length === 0) {
    throw new Error("the harness isolation root must be a non-empty path")
  }
  const name = basename(root)
  if (!/^[0-9a-f]{20}$/.test(name)) {
    throw new Error(
      `refusing to remove ${root}: the leaf is not the 20-hex-character name mintTmpRoot() produces, ` +
        "so this is not a directory this process created"
    )
  }
  if (resolve(root) !== join(PLAYWRIGHT_TMP_ROOT, name)) {
    throw new Error(
      `refusing to remove ${root}: it is not directly under ${PLAYWRIGHT_TMP_ROOT}, so it is not a ` +
        "harness isolation root"
    )
  }
  const canonical = canonicalizePath(root)
  if (!isStrictlyInside(PLAYWRIGHT_TMP_ROOT, canonical)) {
    throw new Error(
      `refusing to remove ${canonical}: it does not canonicalise to something strictly inside ` +
        `${PLAYWRIGHT_TMP_ROOT}`
    )
  }
  if (lstatSync(canonical).isSymbolicLink()) {
    throw new Error(`refusing to remove ${canonical}: the root itself is a link, not a directory`)
  }
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`refusing to remove ${canonical}: it is not a directory`)
  }
  return canonical
}

/**
 * Remove a tree without ever following a link out of it.
 *
 * A symlink or junction is removed AS A LINK. On Windows Node reports a junction
 * as `isSymbolicLink()`, so a junction planted inside the tree is unlinked rather
 * than descended — which is the whole difference between this and `rm -rf`.
 */
export function removeTreeWithoutFollowingLinks(target) {
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = join(target, entry.name)
    if (entry.isSymbolicLink()) {
      unlinkSync(child)
      continue
    }
    if (entry.isDirectory()) {
      removeTreeWithoutFollowingLinks(child)
      continue
    }
    unlinkSync(child)
  }
  rmdirSync(target)
}

let removedRoot = null

// Runs on pass AND on failure, which is the point: the leak this fixes happened on
// failing runs too. The assertion is the proof that the cleanup actually ran —
// delete this hook's body and this line goes red.
afterAll(() => {
  const canonical = assertMintedIsolationRoot(ISOLATION_TMP_ROOT)
  removeTreeWithoutFollowingLinks(canonical)
  removedRoot = canonical
  expect(
    existsSync(canonical),
    `the isolation root this module load minted (${canonical}) still exists after the suite. Importing ` +
      "e2e/helpers/isolatedEnv.mjs mints a tree at module scope, so a missing cleanup leaks one root per " +
      "run and eventually breaks \"newest .playwright-tmp root == this run\"."
  ).toBe(false)
})

/** The root this module load minted and removed, or null before the suite ends. */
export function removedIsolationRoot() {
  return removedRoot
}
