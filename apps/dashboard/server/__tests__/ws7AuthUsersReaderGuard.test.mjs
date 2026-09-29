// WS-7 slice C — ONE reader per store, and every exception has to be declared.
//
// WHY THIS FILE IS A RUNNING TEST. The WS-7 auth work closed the same defect
// class three times over, each time at a layer one over the last: the sites,
// then the shared helper, then the sessions reader, then the writers, and now the
// users.json writer. Every fix was real and durable, and the class still kept
// reappearing, because the invariant was RE-DERIVED AT EVERY SITE instead of
// expressed once. A rule written down in a comment does not stop the fifteenth
// site; a rule a test counts does.
//
// THE INVARIANT, in one sentence: `users.json` is read by exactly one strict
// reader, and the ONLY other way to read it is a declared lenient read that must
// say out loud which non-gate caller asked for it.
//
// WHAT WAS DELETED. `listUsers()` was a second, lenient reader of the same file
// that existed only to serve two callers:
//
//   - `hasUsers()` — the first-run SIGNUP HINT on /api/auth/status, which
//     discloses nothing and authorises nothing. A degraded read there costs one
//     extra signup prompt and is the right answer for a hint.
//   - `getUserById()` — an exported lookup with NO CALLER ANYWHERE in the
//     repository, i.e. a store reader nothing uses, nothing gates, and nothing
//     documents. It is deleted rather than re-pointed at the strict reader,
//     because a strict reader throws where a lenient one returned null, and
//     converting an unused export would change an untested contract for no
//     benefit. `getUserById has no callers` below is the pin that keeps it gone.
//
// THE LENIENT READ IS A REQUIRED ARGUMENT, NOT A COMMENT. A comment saying "this
// is fine, it is a hint" sits eleven lines from every future edit and is never
// re-read. `readUsersLenient(purpose)` refuses a purpose that is not in the
// declared set, so a second lenient reader has to name itself, the name is
// countable, and adding one is a visible act rather than a silent copy.
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url))
const AUTH_REL = "apps/dashboard/server/services/auth.mjs"
const AUTH = fileURLToPath(new URL("../services/auth.mjs", import.meta.url))

const SRC = readFileSync(AUTH, "utf8")
const SRC_LINES = SRC.split("\n")

// MINTED BEFORE THE IMPORT, and that ordering is load-bearing rather than
// incidental. `auth.mjs:10` captures `process.env.PICC_AUTH_DATA_DIR` into a
// module-scope const, so a directory minted after the import is a directory the
// module never reads — the behavioural cases below would then be asserting
// against the harness's own store and a wrong-shaped file would read as a
// healthy empty one.
const HINT_DIR = useIsolatedStoreDir("PICC_AUTH_DATA_DIR", { prefix: "picc-auth-hint" })
const HINT_USERS = join(HINT_DIR, "users.json")

const { hasUsers, resolveHasUsers, createAccount, isAuthStoreUnavailable } = await import("../services/auth.mjs")

/**
 * The name of the function a given line sits inside, by indentation.
 *
 * Walks backwards to the nearest declaration at a SHALLOWER indent, which is the
 * enclosing scope for a line written in this file's style (no nested helpers
 * declared inside a function). Structural rather than a name list, so it stays
 * correct when a function is renamed.
 */
function enclosingFunction(index) {
  const indentOf = (line) => (line.match(/^\s*/) ?? [""])[0].length
  const here = indentOf(SRC_LINES[index])
  for (let k = index - 1; k >= 0; k -= 1) {
    const line = SRC_LINES[k]
    if (!/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.test(line)) continue
    if (indentOf(line) >= here) continue
    return line.match(/function\s+([A-Za-z_$][\w$]*)/)[1]
  }
  return null
}

/**
 * The file's code with every comment's CONTENT blanked, line for line.
 *
 * Line numbers are preserved, so a finding is still reported at the line it is
 * on. The reason this exists at all: auth.mjs documents the readers it deleted
 * BY NAME, so any scan that reads comment text reports its own subject as a live
 * call site forever — and then the only way to satisfy the check is to delete the
 * explanation of why the reader went.
 */
function codeOnly(text) {
  const out = []
  let inBlockComment = false
  for (const line of text.split("\n")) {
    if (inBlockComment) {
      const end = line.indexOf("*/")
      if (end === -1) {
        out.push("")
        continue
      }
      inBlockComment = false
      out.push(line.slice(0, end).replace(/\/\*[\s\S]*$/, ""))
      continue
    }
    if (line.includes("/*") && line.indexOf("*/") === -1) {
      inBlockComment = true
      out.push(line.slice(0, line.indexOf("/*")))
      continue
    }
    if (line.includes("/*")) {
      out.push(line.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, ""))
      continue
    }
    out.push(line.replace(/\/\/.*$/, ""))
  }
  return out
}

/**
 * Every occurrence of `pattern` IN CODE, with the line number and its enclosing
 * function.
 *
 * COMMENTS ARE EXCLUDED, and that is load-bearing rather than tidy. auth.mjs
 * documents the readers it just deleted by name, so a scan that read comment
 * text would report its own subject as a live call site forever and the
 * `getUserById is gone` assertion would be unsatisfiable — or, worse,
 * satisfiable only by deleting the explanation of why it went.
 *
 * STRING CONTENTS ARE NOT EXCLUDED. A string literal containing an identifier is
 * rare here and erring toward reporting it is the safe direction for a check
 * whose job is to notice.
 */
function occurrences(pattern) {
  const found = []
  const code = codeOnly(SRC)
  for (let i = 0; i < code.length; i += 1) {
    const re = new RegExp(pattern, "g")
    for (const _ of code[i].matchAll(re)) {
      found.push({ line: i + 1, text: code[i].trim(), fn: enclosingFunction(i) })
    }
  }
  return found
}

/** The names auth.mjs exports, in source order. */
function exportedNames() {
  return [...SRC.matchAll(/^export\s+(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*)/gm)].map(
    (m) => m[1]
  )
}

describe("WS-7 slice C — one reader per store, and every exception is declared", () => {
  it("the scan finds the real module, not a copy, and the file is the tracked one", () => {
    // A guard pointed at a stray or worktree copy reasons about nothing.
    expect(
      execFileSync("git", ["ls-files", AUTH_REL], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
      "auth.mjs must be the tracked source"
    ).toBe(AUTH_REL)
    expect(
      execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
        .split("\n")
        .some((f) => f.startsWith(".freebuff/worktrees/")),
      ".freebuff/worktrees/ is another branch's working state and must never be scanned"
    ).toBe(false)
    // Non-vacuity: the detectors below must be able to SEE a reader, or every
    // "there is only one" assertion passes on an empty result.
    expect(
      occurrences("\\breadUsersStrict\\s*\\(").length,
      "the strict reader must still be discoverable, or this file asserts nothing"
    ).toBeGreaterThan(0)
  })

  it("the lenient listUsers() reader is GONE", () => {
    const hits = occurrences("\\blistUsers\\b")
    expect(
      hits.map((h) => `auth.mjs:${h.line}  ${h.text}`),
      "listUsers() was a second, lenient reader of users.json whose only two callers were one " +
        "allowlisted hint and one caller-free export. A reader that is not the strict one must be " +
        "DECLARED (readUsersLenient) or absent; a private helper with a lenient read inside it is " +
        "how the class regrows unremarked."
    ).toEqual([])
  })

  it("the lenient readJSON() primitive is called from the declared lenient reader and nowhere else", () => {
    // The lenient primitive is readJSON(); the strict one is readJSONStrict(). A
    // caller of the former cannot tell a broken store from an empty one, so every
    // call site is a decision that has to be a declared one.
    //
    // SCOPED TO users.json, which is the store this file is about. `readJSON` is
    // also the fallback path for the two SESSION reads in the same module, and a
    // guard that forbids it outright would be a claim about a file this one does
    // not police. The claim is therefore exactly: the users store has one strict
    // reader and one declared lenient reader, and no third way in.
    const usersLenient = SRC_LINES.map((line, i) => ({ line: line.trim(), fn: enclosingFunction(i) }))
      .filter((r) => /readJSON\s*\(USERS_FILE/.test(r.line))
      .map((r) => r.fn ?? "<module scope>")
    // Asserted on the ENCLOSING FUNCTION, not on a line number: a line pin rots on
    // the next edit and says nothing about the invariant, while "the only lenient
    // reader of USERS_FILE is the declared one" is the claim itself.
    expect(
      usersLenient,
      "only readUsersLenient() may read USERS_FILE through the lenient readJSON(), and only for the " +
        "one declared purpose. Anywhere else, a corrupt or unreadable users.json is reported as an " +
        "empty store — a false answer about the server, and at a gate a fail-open one."
    ).toEqual(["readUsersLenient"])
  })

  it("the declared lenient reader REFUSES an undeclared purpose instead of reading anyway", () => {
    // The behavioural half of "explicit opt-in". A required argument that is only
    // documented is an argument a future caller will omit, so the check has to be
    // mechanical: an undeclared purpose throws, and the throw is a loud one.
    // Asserted structurally because readUsersLenient is module-private — the only
    // way in is the one declared purpose, which is what the call-site pin above
    // already proves.
    const guard = occurrences("LENIENT_USERS_READ_PURPOSES\\.has\\s*\\(")
    expect(
      guard.map((o) => o.fn ?? "<module scope>"),
      "the purpose check must live INSIDE the lenient reader, so a caller cannot satisfy it by " +
        "reading around the function"
    ).toEqual(["readUsersLenient"])
    expect(
      SRC,
      "an undeclared purpose must THROW. Falling back to a lenient read would make the declared set " +
        "decorative: the very callers it is meant to exclude would be the ones reading anyway."
    ).toMatch(/LENIENT_USERS_READ_PURPOSES\.has\([\s\S]{0,200}?throw new Error/)
  })

  it("the declared lenient reader takes a REQUIRED purpose, and has exactly one caller", () => {
    const declaration = occurrences("function\\s+readUsersLenient\\s*\\(")
    expect(
      declaration.length,
      "the lenient reader must exist by NAME, so a second one is visible. If the hint ever needs " +
        "no leniency at all, delete the reader and this entry deliberately."
    ).toBe(1)
    // The DECLARATION is excluded by shape, not by position: a call inside
    // readUsersLenient itself would be the same reader reaching itself, and
    // filtering on the name would quietly drop it.
    const calls = occurrences("readUsersLenient\\s*\\(").filter((o) => !/function\s+readUsersLenient\s*\(/.test(o.text))
    expect(
      calls.map((o) => o.fn ?? "<module scope>"),
      "exactly one caller may read users.json leniently. It is hasUsers(), the first-run signup " +
        "hint, and it must be the one the declared-purpose set names."
    ).toEqual(["hasUsers"])
  })

  it("the lenient read's purpose is DECLARED, not merely written in a comment", () => {
    // The point of the required argument: a new lenient reader has to name who
    // asked for it, and the name has to be one this test can count. A comment
    // says the same thing to whoever re-reads the file, which is nobody, eleven
    // edits later.
    const set = SRC.match(/LENIENT_USERS_READ_PURPOSES\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/)
    expect(set, "the declared-purpose set must exist and be a Set literal this test can read").not.toBeNull()
    const declared = [...set[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(
      declared.length,
      "exactly one lenient read of users.json is declared. A second is a new caller that cannot " +
        "tell a broken store from an empty one, and it needs its own reason here."
    ).toBe(1)
    expect(
      declared[0],
      "the declared reason is the first-run signup hint on the UNAUTHENTICATED /api/auth/status, " +
        "which discloses no account data and authorises nothing"
    ).toMatch(/first-run signup hint/i)
  })

  it("hasUsers() is the only exported reader that degrades instead of reporting a fault", () => {
    // The export surface is pinned as a SET, and sorted on both sides. Source
    // order is not a property anyone means anything by — moving a function
    // inside the file would otherwise fail a test whose subject is "who may read
    // the store leniently" — whereas the MEMBERSHIP is the claim: adding an export
    // is a new surface on the auth store, and a new surface needs a reason here
    // rather than arriving silently.
    expect(
      exportedNames().sort(),
      "auth.mjs's export surface is pinned: adding a store reader is a deliberate act"
    ).toEqual([
      "AuthStoreUnavailable",
      "createAccount",
      "firstRunBootstrapAllowed",
      "hasUsers",
      "isAuthStoreUnavailable",
      "loginAccount",
      "resolveAuthUser",
      "resolveHasUsers",
      "revokeToken",
      "storeReadFaults",
      "storeWriteFailures",
      "verifyToken",
      "verifyTokenStrict",
      "verifyUser"
    ])
  })

  it("getUserById is gone, and nothing anywhere in the server calls it", () => {
    // The reviewer flagged it as ungated AND undisclosed. Checking what it was
    // for: it is a lenient user lookup exported from auth.mjs with ZERO call
    // sites in the entire repository — no route, no service, no test. So it is
    // not a feature that was under-gated, it is an export nothing uses, and
    // deleting it removes a store reader rather than constraining one.
    expect(
      occurrences("\\bgetUserById\\b").map((o) => `auth.mjs:${o.line}  ${o.text}`),
      "getUserById() must not come back as a lenient user lookup. If a caller needs a public user " +
        "by id, resolve the session's user through resolveAuthUser(), which reads strictly."
    ).toEqual([])

    const serverFiles = execFileSync("git", ["ls-files", "apps/dashboard/server"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    })
      .split("\n")
      .filter((f) => f.endsWith(".mjs") && !f.includes("server/__tests__/"))
    // CODE ONLY, for the same reason as the scan above: auth.mjs's own
    // docstring names the export it deleted, and a raw-text scan here would
    // report that explanation as a caller.
    const callers = serverFiles
      .map((f) => [f, codeOnly(readFileSync(join(REPO_ROOT, f), "utf8")).join("\n")])
      .filter(([, code]) => /\bgetUserById\b/.test(code))
      .map(([f, code]) => `${f}: ${(code.match(/\bgetUserById\b/g) ?? []).length}`)
    expect(
      callers,
      "a caller of getUserById() in the server means the export came back. Route the caller " +
        "through resolveAuthUser() (strict) instead — an ungated, undisclosed reader of the user " +
        "store is the shape this slice removes."
    ).toEqual([])
  })
})

// The declared exception, exercised against the real module. These two are
// PRESERVATION tests rather than red-then-green ones: the leniency they assert
// is the documented, allowlisted behaviour that must survive the deletion of
// listUsers(). The "only exception" half is what the structural tests above pin.
describe("WS-7 slice C — the declared leniency behaves as declared", () => {
  const USERS = HINT_USERS

  const clear = () => rmSync(USERS, { force: true })
  beforeEach(clear)
  afterEach(clear)

  it("the hint degrades to 'no accounts' on an unreadable store instead of throwing", async () => {
    writeFileSync(USERS, "{ this is not json", "utf8")
    await expect(hasUsers()).resolves.toBe(false)
  })

  it("the hint degrades to 'no accounts' on a wrong-SHAPED store", async () => {
    writeFileSync(USERS, '{"users":null}', "utf8")
    await expect(hasUsers()).resolves.toBe(false)
  })

  it("the STRICT reader still reports that same store as a fault", async () => {
    // The contrast that makes the exception mean something: identical bytes, two
    // readers, opposite answers — and only the strict one may be used to make an
    // authorisation decision.
    writeFileSync(USERS, '{"users":null}', "utf8")
    const err = await resolveHasUsers().catch((e) => e)
    expect(
      isAuthStoreUnavailable(err),
      "resolveHasUsers() must keep raising AuthStoreUnavailable on a wrong-shaped store"
    ).toBe(true)
  })

  it("the hint reports the truth on a healthy store", async () => {
    await expect(hasUsers()).resolves.toBe(false)
    const created = await createAccount({ email: "hint@example.test", password: "hint-password-1", name: "H" })
    expect(created?.token).toBeTruthy()
    await expect(hasUsers()).resolves.toBe(true)
  })
})
