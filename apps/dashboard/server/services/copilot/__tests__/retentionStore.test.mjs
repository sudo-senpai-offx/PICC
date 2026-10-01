// WS-7 T15 - T15:1330's "persistence layer for veto/score/receipt records", and
// the AC-033 class-routing test at spec `:1030-1034`.
//
// AC-033 (`:1030-1032`):
//   Scenario:  "A veto record, a score breakdown, an execution receipt, a raw
//               snapshot, and a daily aggregate are written."
//   Expected:  "The first three are untouched and have no update/delete path;
//               the snapshot is replaced by its aggregate in a recorded one-way
//               transform; the daily aggregate is untouched."
//
// The "no update/delete path" half is a claim about MODULE STRUCTURE and is
// therefore tested in `permanentAppendOnlySurface.test.mjs`. This file tests the
// behaviour half: routing, durability across a re-open, and the T11 integration.
//
// THE FIXTURE STORE IS A mkdtemp DIRECTORY AND NEVER `server/data`. Every removal
// in this file goes through `removeScratch()`, which refuses any path that is not
// inside the OS temp directory - two agents in this repository's history have
// already destroyed real data through a recursive delete that followed a link it
// had not checked, so the helper makes the check mechanical rather than a habit.

import { describe, expect, it, afterEach } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DAILY_AGGREGATE_PERMANENT_CLASS,
  PERMANENT_APPEND_ONLY_CLASS,
  RAW_90D_THEN_AGGREGATED_CLASS,
  RECORD_KINDS,
  RETENTION_CLASSES
} from "../retention.mjs"
import {
  PERMANENT_LEDGER_FILENAME,
  RAW_SNAPSHOT_SEGMENT_FILENAME,
  assertPurgeTargetAllowed,
  assertRetentionStoreDirAllowed,
  createRetentionStore,
  dashboardServerTree,
  segmentPathFor,
  storeDirFor
} from "../retentionStore.mjs"
import { VETO_RETENTION_CLASS, createVetoIndex } from "../vetoIndex.mjs"
import { planSnapshotPurge } from "../purgeSnapshots.mjs"

// The repository root, for the test that proves a purgeable store is refused inside
// the live server tree. Derived, not hard-coded, and the derivation is asserted by
// the fact that the refusal fires at all - a wrong root would not contain the path.
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url))

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)
const DAY = Date.UTC(2026, 5, 3)

const scratchDirs = []

/**
 * Mint a scratch store directory under the OS temp directory.
 *
 * NO `realpathSync` ANYWHERE NEAR THE DELETE. The canonical path is computed ONCE,
 * here, and the removal later targets that exact string. Re-resolving at delete
 * time would follow any link that appeared in between, which is precisely the
 * failure mode - a recursive delete that traverses a link it has not checked -
 * that destroyed real, unrecoverable data twice in this repository's history.
 * `mkdtempSync` creates the directory itself, so nothing else can know its name.
 */
function newScratchDir() {
  const created = resolve(mkdtempSync(join(tmpdir(), "picc-t15-retention-")))
  const tempRoot = resolve(tmpdir())
  if (!created.startsWith(tempRoot + sep)) {
    throw new Error(`refusing to use ${created}: it is not inside the OS temp directory ${tempRoot}`)
  }
  scratchDirs.push(created)
  return created
}

/**
 * Remove one minted scratch directory.
 *
 * The membership check is against the set this TEST FILE minted, passed in rather
 * than read from a module-level array. An earlier version spliced that array
 * before checking membership, so the array was already empty and every removal
 * refused - which at least fails safe, but for the wrong reason and in a way that
 * looked like a provenance bug.
 */
function removeScratch(dir, minted) {
  const target = resolve(dir)
  if (!minted.includes(target)) {
    throw new Error(`refusing to remove ${target}: this test file did not mint it`)
  }
  rmSync(target, { recursive: true, force: true })
}

afterEach(() => {
  const minted = scratchDirs.splice(0)
  for (const dir of minted) removeScratch(dir, minted)
})

function vetoRecord(overrides = {}) {
  return {
    kind: "veto_decision",
    ruleId: "wickVsClose",
    fired: true,
    inputs: { wickPct: 0.9, closeBeyond: false },
    suppressed: "long entry",
    evaluatedAt: DAY,
    ruleVersion: "1.0.0",
    ...overrides
  }
}

function scoreRecord(overrides = {}) {
  return {
    kind: "score_breakdown",
    recordedAt: DAY,
    symbol: "BTCUSD",
    score: 61.777777777777786,
    contributions: [{ expert: "macroBias", weightedPoints: 4.2 }],
    ...overrides
  }
}

function receiptRecord(overrides = {}) {
  return {
    kind: "execution_receipt",
    recordedAt: DAY,
    symbol: "BTCUSD",
    action: "hold",
    tier: "A+",
    automationPermitted: true,
    ...overrides
  }
}

function snapshotRecord(overrides = {}) {
  return {
    kind: "market_snapshot",
    retentionClass: RAW_90D_THEN_AGGREGATED_CLASS,
    id: "snap-0001",
    observedAt: DAY,
    symbol: "BTCUSD",
    open: 100,
    high: 103,
    low: 100,
    close: 103,
    volume: 10,
    payload: "{\"ticks\":18422}",
    ...overrides
  }
}

function aggregateRecord(overrides = {}) {
  return {
    kind: "daily_aggregate",
    retentionClass: DAILY_AGGREGATE_PERMANENT_CLASS,
    aggregateId: "agg-deadbeefdeadbeef",
    transformVersion: "ws7.t15.d8.snapshot-to-daily-aggregate.v1",
    bucket: "2026-06-03",
    symbol: "BTCUSD",
    open: 100,
    high: 103,
    low: 100,
    close: 103,
    volume: 40,
    sampleCount: 4,
    ...overrides
  }
}

/** Every file under a directory, with its bytes, for a before/after comparison. */
function fingerprint(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .map((name) => {
      const path = join(dir, name)
      const stat = statSync(path)
      return {
        name,
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        content: stat.isFile() ? readFileSync(path, "utf8") : null
      }
    })
}

describe("T15 - the store directory is named explicitly, and never defaulted", () => {
  // THE CLASS OF BUG THIS REPO HAS ALREADY PAID FOR. Every existing per-service
  // store falls back to the live `server/data` when its environment variable is
  // unset OR MISSPELLED, and those two cases are indistinguishable because both
  // fall through to the default. A store with NO default cannot be reached by a
  // misspelling, because there is nothing to misspell: the caller must pass a path
  // or the constructor throws.
  //
  // The variable name is deliberately not written out. The repo-wide isolation
  // guard (`ws7TestStoreIsolation.test.mjs`) scans test files for any path-shaped
  // `PICC_` name they read, and an earlier draft of this comment spelled one out
  // inside prose - which the scan cannot distinguish from a read, and which failed
  // the guard for a comment. The name is not needed to make the point.
  it("refuses to construct without an explicit directory", () => {
    expect(() => createRetentionStore()).toThrow(/director/i)
    expect(() => createRetentionStore({})).toThrow(/director/i)
  })

  it("refuses a non-absolute, empty or non-string directory", () => {
    for (const dir of ["", "   ", "relative/dir", "copilot", 42, null, undefined, {}]) {
      expect(() => createRetentionStore({ dir }), JSON.stringify(dir)).toThrow(/director|absolute/i)
    }
  })

  it("writes ONLY its own two segment files, and nothing else", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    store.append(vetoRecord())
    store.append(snapshotRecord())
    store.append(aggregateRecord())
    expect(readdirSync(dir).sort()).toEqual([PERMANENT_LEDGER_FILENAME, RAW_SNAPSHOT_SEGMENT_FILENAME].sort())
  })

  it("names its segments by the class they hold, so a segment cannot be mislabelled", () => {
    const dir = newScratchDir()
    expect(PERMANENT_LEDGER_FILENAME).toMatch(/permanent/)
    expect(RAW_SNAPSHOT_SEGMENT_FILENAME).toMatch(/raw/)
    expect(PERMANENT_LEDGER_FILENAME).not.toBe(RAW_SNAPSHOT_SEGMENT_FILENAME)
    // Exactly two segments for three classes: the two permanent classes share one
    // file, so the single rewritten file is unambiguously the only mutable one.
    expect(segmentPathFor(dir, PERMANENT_APPEND_ONLY_CLASS)).toContain(PERMANENT_LEDGER_FILENAME)
    expect(segmentPathFor(dir, DAILY_AGGREGATE_PERMANENT_CLASS)).toContain(PERMANENT_LEDGER_FILENAME)
    expect(segmentPathFor(dir, RAW_90D_THEN_AGGREGATED_CLASS)).toContain(RAW_SNAPSHOT_SEGMENT_FILENAME)
    expect(() => segmentPathFor(dir, "not_a_class")).toThrow(/retention/i)
  })

  it("validates the store directory, and refuses a non-absolute or absent one", () => {
    const dir = newScratchDir()
    expect(assertRetentionStoreDirAllowed(dir)).toBe(resolve(dir))
    // The guard is exported so a caller - the CLI in particular - can ask the same
    // question this module asks, instead of re-implementing it.
    expect(() => assertRetentionStoreDirAllowed("nope")).toThrow(/absolute/i)
    expect(() => assertRetentionStoreDirAllowed("")).toThrow(/REQUIRED|director/i)
  })

  it("WITHHOLDS the destructive verb by default: appendable, readable, NOT purgeable", () => {
    // The store directory itself is unconstrained - a retention store installed at
    // `server/data/copilot-retention/` alongside every other per-service store is
    // the conventional layout, and appending a snapshot to the raw segment is not
    // destructive. What is withheld is the DELETE.
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    expect(store.purgeable).toBe(false)
    // It can be written to and read from, including the raw class.
    store.append(vetoRecord())
    store.append(snapshotRecord())
    expect(store.readPermanent()).toHaveLength(1)
    expect(store.readSnapshots()).toHaveLength(1)
    expect(existsSync(join(dir, PERMANENT_LEDGER_FILENAME))).toBe(true)
    expect(existsSync(join(dir, RAW_SNAPSHOT_SEGMENT_FILENAME))).toBe(true)
    // And the purge job refuses it - the first of the purge's TWO keys. The second
    // is the confirmation token, asserted in `purgeSnapshots.test.mjs`.
    expect(() => planSnapshotPurge({ store, now: Date.UTC(2026, 9, 15), runId: "t15" })).toThrow(/not a PURGE TARGET/i)
    // Nothing was removed by the refusal.
    expect(store.readSnapshots()).toHaveLength(1)
  })

  it("GRANTS the destructive verb only on request, and refuses it inside the server tree", () => {
    const dir = newScratchDir()
    const granted = createRetentionStore({ dir, purge: true })
    expect(granted.purgeable).toBe(true)
    expect(granted.rawSegmentPath.endsWith(RAW_SNAPSHOT_SEGMENT_FILENAME)).toBe(true)

    // The live tree is where every real store in this repository lives, and two
    // agents in its history have already destroyed data through it. A purgeable
    // store is refused there.
    expect(() => assertPurgeTargetAllowed(join(REPO_ROOT, "apps", "dashboard", "server", "data"))).toThrow(/server tree/i)
    expect(() => assertPurgeTargetAllowed(join(REPO_ROOT, "apps", "dashboard", "server"))).toThrow(/server tree/i)
    expect(() => createRetentionStore({ dir: join(REPO_ROOT, "apps", "dashboard", "server", "data"), purge: true })).toThrow(/server tree/i)
    // ...while an ORDINARY store there is fine, because appending deletes nothing.
    expect(() => createRetentionStore({ dir: join(REPO_ROOT, "apps", "dashboard", "server", "data") })).not.toThrow()
    // And a path that merely LOOKS like the tree is not the tree.
    expect(() => assertPurgeTargetAllowed(join(REPO_ROOT, "apps", "dashboard", "server-data"))).not.toThrow()
    expect(() => assertPurgeTargetAllowed(dir)).not.toThrow()
  })

  it("exposes storeDirFor as the same resolution the constructor used", () => {
    const dir = newScratchDir()
    expect(storeDirFor(dir)).toBe(resolve(dir))
  })

  it("names the dashboard server tree it refuses, so the refusal is self-explaining", () => {
    expect(dashboardServerTree().replace(/\\/g, "/")).toContain("apps/dashboard/server")
  })
})

describe("AC-033 - the five records of the scenario, written through the store", () => {
  it("routes each of D8:160's five record kinds to the class D8:160 names", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })

    store.append(vetoRecord())
    store.append(scoreRecord())
    store.append(receiptRecord())
    store.append(snapshotRecord())
    store.append(aggregateRecord())

    const permanent = store.readPermanent()
    const snapshots = store.readSnapshots()

    // The first three are in the permanent ledger and nowhere else. The daily
    // aggregate is permanent too (R11.3, :443), so it shares that append-only file
    // - which means the one rewritten file cannot possibly contain one.
    expect(permanent.map((r) => r.kind)).toEqual([
      "veto_decision",
      "score_breakdown",
      "execution_receipt",
      "daily_aggregate"
    ])
    // The raw snapshot is in the segment that IS rewritable, and only there.
    expect(snapshots.map((r) => r.kind)).toEqual(["market_snapshot"])
    expect(JSON.stringify(permanent.map((r) => r.id))).not.toContain("snap-0001")
  })

  it("classifies every stored record back to the same class on read", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    for (const record of [vetoRecord(), scoreRecord(), receiptRecord(), snapshotRecord(), aggregateRecord()]) {
      store.append(record)
    }
    const classes = [
      ...store.readPermanent().map((r) => r.retentionClass),
      ...store.readSnapshots().map((r) => r.retentionClass)
    ]
    expect(new Set(classes)).toEqual(new Set(RETENTION_CLASSES))
    for (const retentionClass of classes) expect(RETENTION_CLASSES).toContain(retentionClass)
  })

  it("survives a RE-OPEN, because a record that only lives in memory is not evidence", () => {
    const dir = newScratchDir()
    createRetentionStore({ dir }).append(vetoRecord({ ruleId: "topDownHierarchy", fired: false }))
    const reopened = createRetentionStore({ dir })
    expect(reopened.readPermanent()).toHaveLength(1)
    expect(reopened.readPermanent()[0]).toMatchObject({ kind: "veto_decision", ruleId: "topDownHierarchy", fired: false })
  })

  it("returns APPEND ORDER, and appending the same record twice yields two lines", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    store.append(vetoRecord({ ruleId: "sessionOpen" }))
    store.append(vetoRecord({ ruleId: "sessionOpen" }))
    const lines = readFileSync(join(dir, PERMANENT_LEDGER_FILENAME), "utf8").trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(new Set(lines)).toEqual(new Set(lines))
    expect(store.readPermanent().map((r) => r.ruleId)).toEqual(["sessionOpen", "sessionOpen"])
  })

  it("reads an absent store as empty rather than throwing", () => {
    const store = createRetentionStore({ dir: newScratchDir() })
    expect(store.readPermanent()).toEqual([])
    expect(store.readSnapshots()).toEqual([])
    expect(store.readCutovers()).toEqual([])
    expect(store.size).toBe(0)
  })

  it("refuses an unclassifiable record rather than storing it somewhere undecided", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    expect(() => store.append({ kind: "mystery", payload: 1 })).toThrow(/retention/i)
    expect(() => store.append(null)).toThrow(/record/i)
    expect(() => store.append("veto_decision")).toThrow(/record/i)
    expect(store.size).toBe(0)
    expect(readdirSync(dir)).toEqual([])
  })

  it("refuses a record whose declared class disagrees with its kind", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    // The dangerous direction: a veto record that calls itself a 90-day snapshot
    // would be the one record a mis-routed purge could remove.
    expect(() => store.append(vetoRecord({ retentionClass: RAW_90D_THEN_AGGREGATED_CLASS }))).toThrow(/retention/i)
    expect(() => store.append(snapshotRecord({ retentionClass: PERMANENT_APPEND_ONLY_CLASS }))).toThrow(/retention/i)
    expect(store.size).toBe(0)
    expect(readdirSync(dir)).toEqual([])
  })

  it("stores the record verbatim apart from stamping its derived class, and adds no clock", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    const input = vetoRecord()
    const written = store.append(input)

    // Every field the caller supplied survives unchanged...
    for (const [key, value] of Object.entries(input)) expect(written[key]).toEqual(value)
    // ...plus exactly one addition, the §4.3 class, and nothing else. In particular
    // no injected `recordedAt` and no `sequence`: the engine's `evaluatedAt` is the
    // record's time, and a store that stamped a second one would give a reader two
    // different answers to "when".
    expect(Object.keys(written).sort()).toEqual([...Object.keys(input), "retentionClass"].sort())
    expect(written.retentionClass).toBe(PERMANENT_APPEND_ONLY_CLASS)
    expect(Object.keys(written)).not.toContain("recordedAt")
    expect(Object.keys(written)).not.toContain("sequence")
    expect(JSON.parse(readFileSync(join(dir, PERMANENT_LEDGER_FILENAME), "utf8").trim())).toEqual(written)
  })

  it("hands back a frozen record, so a caller cannot mutate a stored veto in place", () => {
    const dir = newScratchDir()
    const stored = createRetentionStore({ dir }).append(vetoRecord())
    expect(Object.isFrozen(stored)).toBe(true)
    expect(() => {
      "use strict"
      stored.fired = false
    }).toThrow()
  })

  it("fails the append rather than losing a safety record silently", () => {
    // A veto record that cannot be written is a gap in the audit trail. A store
    // that swallowed the fault would turn a disk error into an ABSENT safety
    // record, which is the failure D8:162 exists to prevent ("deleting it
    // destroys the audit trail that justifies the rule").
    //
    // The fault is manufactured by putting a DIRECTORY where the ledger file
    // belongs: appending to a directory cannot succeed on any platform, so this is
    // a portable fault rather than a chmod trick that behaves differently on
    // Windows.
    const dir = newScratchDir()
    mkdirSync(join(dir, PERMANENT_LEDGER_FILENAME), { recursive: true })

    const store = createRetentionStore({ dir })
    expect(() => store.append(vetoRecord())).toThrow()
    // And nothing partial was written.
    expect(readdirSync(dir)).toEqual([PERMANENT_LEDGER_FILENAME])
    expect(statSync(join(dir, PERMANENT_LEDGER_FILENAME)).isDirectory()).toBe(true)
  })

  it("reports a failed append rather than returning a record it did not store", () => {
    const dir = newScratchDir()
    mkdirSync(join(dir, RAW_SNAPSHOT_SEGMENT_FILENAME), { recursive: true })
    const store = createRetentionStore({ dir })
    let returned = null
    try {
      returned = store.append(snapshotRecord())
    } catch {
      returned = null
    }
    expect(returned, "a refused append must not hand back a record as if it were stored").toBeNull()
  })
})

describe("T15 - T11's vetoIndex is wired in, not replaced", () => {
  it("accepts T11's own veto entries through the store's sink, keeping T11 byte-identical", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })

    // T11's store, built with T15's store as its sink. T11's module is untouched:
    // this only supplies the `sink` its `createVetoIndex` already accepted at
    // `vetoIndex.mjs:106`, which is the seam T11 left for T15.
    const index = createVetoIndex({ sink: store.vetoSink() })
    const entry = index.record({
      ruleId: "wickVsClose",
      fired: true,
      inputs: { wickPct: 0.9 },
      suppressed: "long entry",
      evaluatedAt: DAY,
      ruleVersion: "1.0.0"
    })

    // T11's in-memory read still works, and the durable copy agrees with it.
    expect(index.read()).toHaveLength(1)
    expect(index.latest("wickVsClose").fired).toBe(true)

    const persisted = store.readPermanent()
    expect(persisted).toHaveLength(1)
    // Every field T11 stamped survives, INCLUDING T11's own retention tag, and the
    // `kind` T15 adds is the only addition.
    expect(persisted[0]).toEqual({ ...entry, kind: "veto_decision" })
    expect(persisted[0].retentionClass).toBe(VETO_RETENTION_CLASS)
    expect(persisted[0].ruleVersion).toBe("1.0.0")
  })

  it("routes every one of T11's six rules to the permanent ledger", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    const index = createVetoIndex({ sink: store.vetoSink() })
    const RULES = ["topDownHierarchy", "correlationTrap", "wickVsClose", "spreadVsTarget", "newsLockout", "sessionOpen"]
    for (const ruleId of RULES) {
      index.record({ ruleId, fired: true, inputs: {}, suppressed: "x", evaluatedAt: DAY, ruleVersion: "1.0.0" })
    }
    const persisted = store.readPermanent()
    expect(persisted).toHaveLength(6)
    expect(persisted.map((r) => r.ruleId)).toEqual(RULES)
    for (const record of persisted) expect(record.retentionClass).toBe(PERMANENT_APPEND_ONLY_CLASS)
    // None of them landed in the rewritable segment.
    expect(store.readSnapshots()).toEqual([])
  })

  it("routes six FIRED and six un-fired vetoes without dropping either", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    const index = createVetoIndex({ sink: store.vetoSink() })
    const RULES = ["topDownHierarchy", "correlationTrap", "wickVsClose", "spreadVsTarget", "newsLockout", "sessionOpen"]
    RULES.forEach((ruleId, i) => {
      index.record({ ruleId, fired: i % 2 === 0, inputs: {}, suppressed: "x", evaluatedAt: DAY, ruleVersion: "1.0.0" })
    })
    expect(store.readPermanent().filter((r) => r.fired === true)).toHaveLength(3)
    expect(store.readPermanent().filter((r) => r.fired === false)).toHaveLength(3)
  })

  it("refuses a bare T11 entry passed to append() without the sink, and says why", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    const bare = { ruleId: "sessionOpen", fired: true, retentionClass: VETO_RETENTION_CLASS }
    expect(() => store.append(bare)).toThrow(/kind|vetoSink/i)
  })
})

describe("the raw segment is the only rewritable surface, and it is class-checked on every read", () => {
  it("fails closed when the raw segment contains a record that is not the raw class", () => {
    // The cross-class hazard: if a permanent record ever reached the raw segment -
    // through a routing bug, a hand-edited file, or a restored backup - then the
    // purge's rewrite would delete an audit trail. So the segment is class-checked
    // on READ, and the purge cannot even compute a deletion set over a file that
    // contains one.
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    store.append(snapshotRecord())

    // Plant a permanent record directly in the raw segment, bypassing append().
    const segment = join(dir, RAW_SNAPSHOT_SEGMENT_FILENAME)
    writeFileSync(segment, `${readFileSync(segment, "utf8")}${JSON.stringify(vetoRecord())}\n`)

    expect(() => store.readSnapshots()).toThrow(/permanent/i)
    // And the planted line is still on disk: the store refuses rather than repairs.
    expect(readFileSync(segment, "utf8")).toContain("veto_decision")
  })

  it("fails closed when the permanent ledger contains a raw-class record", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    store.append(vetoRecord())
    const ledger = join(dir, PERMANENT_LEDGER_FILENAME)
    writeFileSync(ledger, `${readFileSync(ledger, "utf8")}${JSON.stringify(snapshotRecord())}\n`)
    expect(() => store.readPermanent()).toThrow(/90|raw|snapshot/i)
  })

  it("fails closed on a MALFORMED line rather than skipping it", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    store.append(snapshotRecord())
    const segment = join(dir, RAW_SNAPSHOT_SEGMENT_FILENAME)
    writeFileSync(segment, `${readFileSync(segment, "utf8")}{not json\n`)
    expect(() => store.readSnapshots()).toThrow(/json|parse/i)
  })

  it("is byte-identical before and after a plain read", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir })
    store.append(vetoRecord())
    store.append(snapshotRecord())
    const before = fingerprint(dir)
    store.readPermanent()
    store.readSnapshots()
    expect(fingerprint(dir)).toEqual(before)
  })

  it("does not create the directory it was pointed at on construction", () => {
    const parent = newScratchDir()
    const child = join(parent, "retention")
    const store = createRetentionStore({ dir: child })
    expect(existsSync(child)).toBe(false)
    store.append(vetoRecord())
    expect(existsSync(child)).toBe(true)
  })
})

describe("the record kinds are exactly the six D8:160 and D8:164 require", () => {
  it("is closed, so a producer cannot invent a fourth permanent kind", () => {
    expect([...RECORD_KINDS].sort()).toEqual([
      "daily_aggregate",
      "execution_receipt",
      "market_snapshot",
      "retention_cutover",
      "score_breakdown",
      "veto_decision"
    ])
  })
})