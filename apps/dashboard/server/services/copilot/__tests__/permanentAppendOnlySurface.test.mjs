// WS-7 T15 - AC-034 (`:1037-1043`) at the STRUCTURAL level, which is the only
// level the requirement is written at.
//
//   AC-034:1038  "An operator attempts to edit or delete a veto record."
//   AC-034:1040  "The operation is rejected; the record is immutable."
//   AC-034:1041  PROHIBITED: "No admin or migration path may mutate a permanent
//                            class."
//   D8:164       "Append-only means no update or delete path exists for those
//                three classes."
//   Plan v1 §3.4:274-276  "'No admin or migration path may mutate a permanent
//                         class' means the ABSENCE of the path is asserted, so the
//                         test must fail if a mutating method is ever added."
//
// THE FIVE CLAIMS, and what would falsify each:
//
//   1. CAPABILITY. `permanentLedger.mjs` may import exactly four `node:fs`
//      bindings, none of which can seek, truncate, overwrite, rename or unlink.
//      Falsified by adding `writeFileSync`, `unlinkSync`, `renameSync`, `rmSync`,
//      `truncateSync`, `open(..., "w")` or `createWriteStream` to that import.
//   2. SURFACE. Neither that module, the store, nor the purge job EXPORTS a name
//      whose verb is a mutation, and the live store OBJECT carries no such member.
//      Falsified by adding a `delete` or `update` to any of them.
//   3. REACHABILITY. No other tracked module in the server tree can name the
//      permanent ledger, so there is no second door for an admin route or a
//      migration to come through - AC-034:1041's whole clause.
//      Falsified by any other file mentioning the filename.
//   4. SCOPE. The purge job's filesystem capability is `writeFileSync` +
//      `renameSync`, and its only target is `store.rawSegmentPath`. Falsified by
//      any write to a path the purge did not get from the store.
//   5. RUNTIME. Attempting every mutating method on the store throws or is
//      undefined, and the permanent file's bytes are byte-identical afterwards -
//      the "negative test per mutating method" AC-034:1042 names.
//
// WHY A HASH CHAIN IS NOT HERE, deliberately. A per-line digest chain would let a
// reader DETECT truncation after the fact. That is a weaker claim than the one
// asked for: AC-034 wants no path to exist, not a way to notice one. Adding it
// would be gold-plating a control that is supposed to be structural, and it would
// also add a `readFileSync`-of-the-whole-file cost to every read.

import { describe, expect, it, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import * as permanentLedger from "../permanentLedger.mjs"
import * as purgeSnapshots from "../purgeSnapshots.mjs"
import * as retention from "../retention.mjs"
import * as retentionStore from "../retentionStore.mjs"
import { PERMANENT_LEDGER_FILENAME, RAW_SNAPSHOT_SEGMENT_FILENAME, createRetentionStore } from "../retentionStore.mjs"

// `..` from `__tests__/x.test.mjs` resolves to the copilot directory; six more
// levels reach the repository root. Both derivations are asserted at the bottom of
// this file, because a guard pointed at a moved module checks nothing.
const COPILOT_DIR = fileURLToPath(new URL("../", import.meta.url))
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url))
const SELF = fileURLToPath(import.meta.url)

const PERMANENT_LEDGER_PATH = join(COPILOT_DIR, "permanentLedger.mjs")
const PURGE_PATH = join(COPILOT_DIR, "purgeSnapshots.mjs")
const STORE_PATH = join(COPILOT_DIR, "retentionStore.mjs")
const RETENTION_PATH = join(COPILOT_DIR, "retention.mjs")

const read = (path) => readFileSync(path, "utf8")

/**
 * The module's CODE, with comments removed.
 *
 * Load-bearing, and not tidiness. `permanentLedger.mjs`'s own header names every
 * filesystem function it does NOT use - `writeFileSync`, `unlinkSync`,
 * `renameSync`, `rmSync`, `truncateSync` - because a reader deserves to know what
 * the boundary is. A `not.toContain("writeFileSync")` check on raw source would
 * therefore fail on the documentation of the guarantee, which is precisely how a
 * guard like this gets deleted instead of fixed. The claim is about what the module
 * can DO, so the check reads what it can CALL.
 */
function codeOf(path) {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
}

/**
 * Mutation verbs, matched per WORD.
 *
 * THREE PLACEMENT RULES, each learned from a false positive:
 *
 *   NOT SUBSTRING. An earlier version used `startsWith`/`endsWith`, and
 *   `CUTOVER_TRANSFORM` matched the verb `rm` because it ends in "...form". A guard
 *   that cries wolf on its own constant gets deleted, so matching is per
 *   word-segment: split on `_`, `-`, and camelCase boundaries, then compare whole
 *   segments. That also stops `offset` matching `set`.
 *
 *   `purge` IS DELIBERATELY NOT IN THIS LIST. Two legitimate exports contain it -
 *   `planSnapshotPurge` and `runSnapshotPurge`, the job's two entry points - so a
 *   segment-level rule would flag the entire purge API. The purge family gets its
 *   own exact-list assertion instead, which catches `purgePermanent` by naming it
 *   in the expected set rather than by pattern-matching.
 *
 *   `append` IS NOT HERE. It is the ONE permitted mutator: D8:164 asks for
 *   append-only, and a guard that flagged the append would flag the requirement.
 */
const MUTATION_VERBS = Object.freeze([
  "amend",
  "clear",
  "compact",
  "del",
  "delete",
  "drop",
  "edit",
  "erase",
  "evict",
  "expire",
  "mutate",
  "overwrite",
  "patch",
  "prune",
  "remove",
  "replace",
  "reset",
  "retract",
  "revoke",
  "rewrite",
  "rm",
  "rmdir",
  "splice",
  "truncate",
  "unlink",
  "update",
  "upsert",
  "vacuum",
  "write"
])

const MUTATION_VERB_SET = new Set(MUTATION_VERBS)

/** Split `rewriteAll`, `rewrite_all` and `rewrite-all` into `["rewrite", "all"]`. */
function wordSegments(name) {
  return String(name)
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

function isMutationName(name) {
  if (typeof name !== "string" || name.length === 0) return false
  return wordSegments(name).some((word) => MUTATION_VERB_SET.has(word))
}

/** Export names containing `purge` in any word segment - the dedicated family. */
function purgeFamilyNames(namespace) {
  return exportNames(namespace).filter((name) => wordSegments(name).includes("purge"))
}

/** The names an ES module namespace exposes. */
function exportNames(namespace) {
  return Object.keys(namespace).filter((name) => name !== "default")
}

/** The names reachable on an object: own, plus the prototype chain. */
function memberNames(object) {
  const names = new Set()
  let current = object
  while (current !== null && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) names.add(name)
    current = Object.getPrototypeOf(current)
  }
  return [...names]
}

function lsFiles(patterns) {
  return execFileSync("git", ["ls-files", ...patterns], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean)
}

/** The bindings an `import { ... } from "node:fs"` statement brings in. */
function nodeFsImportsOf(source) {
  const statement = source.match(/import\s*\{([^}]*)\}\s*from\s*"node:fs"/)
  if (!statement) return []
  return statement[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
}

const scratchDirs = []
function newScratchDir() {
  const created = resolve(mkdtempSync(join(tmpdir(), "picc-t15-surface-")))
  scratchDirs.push(created)
  return created
}
function removeScratch(dir, minted) {
  const target = resolve(dir)
  if (!minted.includes(target)) throw new Error(`refusing to remove ${target}: this test file did not mint it`)
  rmSync(target, { recursive: true, force: true })
}
afterEach(() => {
  const minted = scratchDirs.splice(0)
  for (const dir of minted) removeScratch(dir, minted)
})

function seededStore() {
  const dir = newScratchDir()
  const store = createRetentionStore({ dir })
  store.append({
    kind: "veto_decision",
    ruleId: "wickVsClose",
    fired: true,
    inputs: { wickPct: 0.9 },
    suppressed: "long entry",
    evaluatedAt: 1_780_000_000_000,
    ruleVersion: "1.0.0"
  })
  return { dir, store }
}

describe("CLAIM 1 - the permanent path holds an append-only filesystem capability, and nothing more", () => {
  it("imports EXACTLY four node:fs bindings, all append-only or read-only", () => {
    const imported = nodeFsImportsOf(read(PERMANENT_LEDGER_PATH)).slice().sort()
    // Exact equality, not a subset test. A subset test would let
    // `writeFileSync` be added and still pass, which is the entire failure this
    // file exists to catch.
    expect(imported).toEqual(["appendFileSync", "existsSync", "mkdirSync", "readFileSync"])
  })

  it("names NO filesystem call that can seek, truncate, overwrite, rename or unlink", () => {
    const code = codeOf(PERMANENT_LEDGER_PATH)
    // Node's own list of mutating filesystem calls, so the check is not a hand-typed
    // subset that can drift as the API grows. `appendFileSync` is excluded because it
    // is the append itself and is asserted separately, exactly once.
    const MUTATING_FS = [
      "writeFileSync",
      "unlinkSync",
      "renameSync",
      "rmSync",
      "rmdirSync",
      "truncateSync",
      "ftruncateSync",
      "copyFileSync",
      "cpSync",
      "utimesSync",
      "chmodSync",
      "chownSync",
      "symlinkSync",
      "linkSync",
      "createWriteStream",
      "createReadStream",
      "opendirSync",
      "watch",
      "unwatch"
    ]
    for (const name of MUTATING_FS) {
      expect(code, `permanentLedger.mjs must not call ${name}`).not.toMatch(
        new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`)
      )
    }
    // `open` with a write mode is a whole-file overwrite, so it is banned as a bare
    // call. The negative lookbehind keeps it from matching `appendFileSync(`'s tail.
    expect(code, "permanentLedger.mjs must not call open()").not.toMatch(/(?<![A-Za-z0-9_$])open\s*\(/)
    // And the ONE writer it does hold is the append, used exactly once.
    expect(code.match(/appendFileSync\s*\(/g) ?? []).toHaveLength(1)
  })

  it("the store module is append-only too - it never rewrites anything at all", () => {
    expect(nodeFsImportsOf(read(STORE_PATH)).slice().sort()).toEqual([
      "appendFileSync",
      "existsSync",
      "mkdirSync",
      "readFileSync",
      "realpathSync"
    ])
    // `realpathSync` READS a path. It cannot move or create one.
    const code = codeOf(STORE_PATH)
    for (const name of ["writeFileSync", "unlinkSync", "renameSync", "rmSync", "truncateSync", "copyFileSync"]) {
      expect(code, `retentionStore.mjs must not call ${name}`).not.toMatch(
        new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`)
      )
    }
  })
})

describe("CLAIM 2 - no module exports a mutation, and the live store carries none", () => {
  it("no copilot retention module exports a mutation-named symbol", () => {
    for (const [label, namespace] of [
      ["retention.mjs", retention],
      ["permanentLedger.mjs", permanentLedger],
      ["retentionStore.mjs", retentionStore],
      ["purgeSnapshots.mjs", purgeSnapshots]
    ]) {
      const mutations = exportNames(namespace).filter(isMutationName)
      expect(mutations, `${label} must export no mutation-named symbol`).toEqual([])
    }
  })

  it("the ONLY purge-named exports are the token and the two job entry points", () => {
    // The dedicated family rule, because `purge` cannot be in the generic verb list:
    // two of these three are legitimate. The assertion is an EXACT LIST, so
    // `purgePermanent` or `purgePermanentRecords` would fail it - which is how the
    // purge family is guarded in the absence of a pattern.
    expect(purgeFamilyNames(purgeSnapshots).sort()).toEqual([
      "PURGE_CONFIRMATION_TOKEN",
      "planSnapshotPurge",
      "runSnapshotPurge"
    ])
    // And every purge-named export that is not a verb is the dry-run-default pair.
    const jobs = purgeFamilyNames(purgeSnapshots).filter((name) => name.endsWith("Purge"))
    expect(jobs).toEqual(["planSnapshotPurge", "runSnapshotPurge"])
  })

  it("the store OBJECT carries no mutation member, own or inherited", () => {
    const { store } = seededStore()
    const members = memberNames(store)
    const mutations = members.filter(isMutationName)
    expect(mutations, `the store exposes ${mutations.join(", ")}`).toEqual([])
    // Its only mutator is the append, and the three permanent-class readers.
    expect(members.filter((name) => typeof store[name] === "function").sort()).toEqual([
      "append",
      "readCutovers",
      "readPermanent",
      "readSnapshots",
      "vetoSink"
    ])
  })

  it("`append` is the only mutator, and it APPENDS - a second append leaves the first line intact", () => {
    const { dir, store } = seededStore()
    const ledger = join(dir, PERMANENT_LEDGER_FILENAME)
    const afterFirst = readFileSync(ledger, "utf8")
    store.append({ kind: "execution_receipt", recordedAt: 1_780_000_000_000, symbol: "BTCUSD", action: "hold" })
    const afterSecond = readFileSync(ledger, "utf8")
    expect(afterSecond.startsWith(afterFirst)).toBe(true)
    expect(afterSecond).toContain("execution_receipt")
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length)
  })

  it("the store exposes exactly ONE writable path, and it is the raw segment", () => {
    const { store } = seededStore()
    const writable = memberNames(store).filter((name) => typeof store[name] === "string")
    expect(writable).toEqual(["dir", "rawSegmentPath"])
    expect(store.rawSegmentPath.endsWith(RAW_SNAPSHOT_SEGMENT_FILENAME)).toBe(true)
    // The permanent ledger's path is NOT among them, so a caller handed the store
    // cannot name the permanent file from it.
    expect(store.rawSegmentPath).not.toContain(PERMANENT_LEDGER_FILENAME)
    expect(store.dir).not.toContain(PERMANENT_LEDGER_FILENAME)
    // And the store exposes no `permanentLedgerPath` either, which is why a purge
    // cannot be pointed at one by a caller that only has the store.
    expect(store.permanentLedgerPath).toBeUndefined()
  })
})

describe("CLAIM 3 - there is no second door: no other tracked module can name the permanent ledger", () => {
  it("only permanentLedger.mjs, retentionStore.mjs and this test mention the filename", () => {
    const offenders = lsFiles(["apps/dashboard/server", "scripts"])
      .filter((file) => file.endsWith(".mjs") && !file.includes("__tests__/"))
      .filter((file) => readFileSync(join(REPO_ROOT, file), "utf8").includes(PERMANENT_LEDGER_FILENAME))
      .filter((file) => !file.endsWith("permanentLedger.mjs") && !file.endsWith("retentionStore.mjs"))
    expect(
      offenders,
      "another module naming the permanent ledger is a second write path to a permanent class - which is " +
        "precisely AC-034:1041's prohibited side effect"
    ).toEqual([])
  })

  it("the purge job does not name it either, so a purge cannot be aimed at the ledger", () => {
    expect(read(PURGE_PATH)).not.toContain(PERMANENT_LEDGER_FILENAME)
    // Its one write target comes from the store, which only exposes the raw segment.
    const purgeCode = codeOf(PURGE_PATH)
    const writeTargets = purgeCode.match(/writeFileSync\s*\(\s*([A-Za-z_$][\w$]*)/g) ?? []
    expect(writeTargets).toEqual(["writeFileSync(staging"])
    expect(purgeCode).toContain("const target = store.rawSegmentPath")
  })

  it("the transform is unreachable from anything that writes", () => {
    // `retention.mjs` imports nothing at all, so the transform cannot be reached by
    // a module that also holds a write capability - and the purge cannot reach the
    // engine either.
    expect(nodeFsImportsOf(read(RETENTION_PATH))).toEqual([])
    const code = codeOf(RETENTION_PATH)
    expect(code, "retention.mjs must import nothing at all").not.toMatch(/from\s*["'][^"']+["']/)
    // Nor may it read a clock, or a transform with two inputs could not be reasoned
    // about as a function of one.
    for (const forbidden of ["Date.now", "new Date()", "Math.random", "performance.now"]) {
      expect(code, `retention.mjs must not contain ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe("CLAIM 4 - the purge job's whole filesystem capability is a rename and a write", () => {
  it("imports EXACTLY renameSync and writeFileSync from node:fs", () => {
    expect(nodeFsImportsOf(read(PURGE_PATH)).slice().sort()).toEqual(["renameSync", "writeFileSync"])
    // No `unlink`, no `rm`: the purge removes rows by REWRITING the segment, never
    // by deleting a file. So there is no code path that could delete the ledger.
    const code = codeOf(PURGE_PATH)
    for (const name of ["unlinkSync", "rmSync", "rmdirSync", "truncateSync", "appendFileSync"]) {
      expect(code, `purgeSnapshots.mjs must not call ${name}`).not.toMatch(
        new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`)
      )
    }
  })

  it("reads no clock, so a purge run is reproducible from its arguments", () => {
    const code = codeOf(PURGE_PATH)
    for (const forbidden of ["Date.now", "new Date()", "Math.random", "performance.now"]) {
      expect(code, `purgeSnapshots.mjs must not contain ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe("CLAIM 5 - a negative test per mutating method, with the bytes unchanged", () => {
  // AC-034:1042 - "Verification: A negative test per mutating method." Each verb is
  // ATTEMPTED, not merely absent from a list: a test that only inspected the
  // export surface would pass against a mutator that was reachable dynamically.
  const ATTEMPTS = Object.freeze([
    "delete",
    "remove",
    "update",
    "upsert",
    "replace",
    "patch",
    "truncate",
    "rewrite",
    "unlink",
    "drop",
    "erase",
    "clear",
    "reset",
    "purge",
    "compact",
    "vacuum",
    "prune",
    "evict",
    "expire",
    "overwrite",
    "amend",
    "retract",
    "revoke",
    "splice",
    "set"
  ])

  it("every mutating method is unreachable, and each attempt leaves the file byte-identical", () => {
    const { dir, store } = seededStore()
    const ledger = join(dir, PERMANENT_LEDGER_FILENAME)
    const before = readFileSync(ledger, "utf8")

    for (const method of ATTEMPTS) {
      expect(store[method], `store.${method} must not exist`).toBeUndefined()
      // Reaching it through a dynamic index must fail too, and must fail LOUDLY.
      expect(() => store[method]("veto_decision", { fired: false }), `store.${method}()`).toThrow(TypeError)
    }
    expect(readFileSync(ledger, "utf8")).toBe(before)
  })

  it("a store cannot be mutated through its own returned record or its array views", () => {
    const { dir, store } = seededStore()
    const ledger = join(dir, PERMANENT_LEDGER_FILENAME)
    const before = readFileSync(ledger, "utf8")

    const [record] = store.readPermanent()
    expect(Object.isFrozen(record)).toBe(true)
    expect(() => {
      "use strict"
      record.fired = false
    }).toThrow(TypeError)

    const all = store.readPermanent()
    expect(Object.isFrozen(all)).toBe(true)
    // A frozen array view: replacing or removing an entry throws rather than
    // leaving the caller with a list that disagrees with the file.
    expect(() => all.pop(), "an array view that is not frozen would be a way to replace an entry").toThrow(TypeError)
    expect(() => {
      "use strict"
      all[0] = { kind: "veto_decision", fired: false }
    }).toThrow(TypeError)
    expect(store.readPermanent()).toHaveLength(1)

    expect(readFileSync(ledger, "utf8")).toBe(before)
  })

  it("the permanent ledger module itself exposes no mutator, and its readers cannot write", () => {
    const writable = exportNames(permanentLedger).filter((name) => isMutationName(name))
    expect(writable).toEqual([])
    expect(exportNames(permanentLedger).slice().sort()).toEqual([
      "PERMANENT_LEDGER_FILENAME",
      "appendPermanent",
      "permanentLedgerPath",
      "permanentLedgerSize",
      "readPermanent"
    ])
  })
})

describe("the guards are not vacuous - the detectors fire on synthetic samples", () => {
  // A guard that cannot fail proves nothing. These two cases show the CAPABILITY
  // detector and the NAME detector both work, using samples that exist only in
  // this file.
  it("the fs-import detector sees a writeFileSync that was added to the ledger", () => {
    const tampered = `import { appendFileSync, writeFileSync } from "node:fs"\nexport const x = 1\n`
    expect(nodeFsImportsOf(tampered)).toContain("writeFileSync")
    expect(nodeFsImportsOf(tampered).slice().sort()).not.toEqual(["appendFileSync", "existsSync", "mkdirSync", "readFileSync"])
  })

  it("the mutation-name detector fires on the verbs it is meant to catch", () => {
    for (const name of ["delete", "update", "purgePermanent", "rewriteAll", "truncateLedger", "unlink", "removeVeto"]) {
      const detected = isMutationName(name)
      if (name === "purgePermanent") {
        // The one case the generic rule deliberately does NOT cover, because the
        // legitimate `runSnapshotPurge` would trip too. It is covered by the exact
        // purge-family list instead, and that is the honest statement of the gap.
        expect(detected, "purge-named exports are guarded by the exact-list rule, not by the verb list").toBe(false)
        expect(purgeFamilyNames({ purgePermanent: () => {} }).sort()).toEqual(["purgePermanent"])
        continue
      }
      expect(detected, `${name} must be detected as a mutation name`).toBe(true)
    }
    for (const name of [
      "append",
      "appendPermanent",
      "readPermanent",
      "planSnapshotPurge",
      "runSnapshotPurge",
      "aggregateIdFor",
      "size",
      "dir",
      "rawSegmentPath",
      // The false positive that forced word-segment matching: it ends in "form".
      "CUTOVER_TRANSFORM",
      // And one that would have matched a bare `endsWith("set")`.
      "offsetMs"
    ]) {
      expect(isMutationName(name), `${name} must NOT be flagged as a mutation name`).toBe(false)
    }
    // The word-splitting itself, since every one of the above rests on it.
    expect(wordSegments("rewriteAll")).toEqual(["rewrite", "all"])
    expect(wordSegments("CUTOVER_TRANSFORM")).toEqual(["cutover", "transform"])
    expect(wordSegments("purge-permanent")).toEqual(["purge", "permanent"])
  })

it("the file paths this file reads are the ones it thinks they are", () => {
    // A guard pointed at a moved or renamed module checks nothing. `REPO_ROOT` is
    // derived six levels up from `__tests__`, so this asserts the derivation rather
    // than trusting the arithmetic in a comment.
    expect(basename(COPILOT_DIR)).toBe("copilot")
    expect(basename(dirname(COPILOT_DIR))).toBe("services")
    expect(basename(dirname(dirname(dirname(dirname(COPILOT_DIR)))))).toBe("apps")
    expect(basename(REPO_ROOT)).toBe("PICC")
    expect(basename(dirname(SELF))).toBe("__tests__")
    for (const path of [PERMANENT_LEDGER_PATH, PURGE_PATH, STORE_PATH, RETENTION_PATH]) {
      expect(existsSync(path), `${path} must exist - a guard pointed at a missing file proves nothing`).toBe(true)
    }
    // And the repository root is one this repository actually is: the isolation
    // contract lives at `apps/dashboard/testSupport/storeIsolation.mjs`.
    expect(existsSync(join(REPO_ROOT, "apps", "dashboard", "testSupport", "storeIsolation.mjs"))).toBe(true)
  })
})