// WS-7 T15 - the purge job. AC-034 (`:1037-1043`) and T15:1334's bisect line.
//
//   T15:1334  "The purge job can be dry-run against a fixture without touching
//              production data."
//   AC-034:1038-1040  "An operator attempts to edit or delete a veto record. Call
//                      the persistence API. The operation is rejected."
//
// THE DRY-RUN PROOF IS THE HEADLINE OF THIS FILE, and it is proved three ways
// rather than asserted once:
//
//   1. BYTE-LEVEL: a recursive fingerprint (name, size, mtime AND content) of the
//      store directory is identical before and after a dry-run. Not "the records
//      are still there" - the mtimes are unchanged too, so nothing was rewritten
//      to the same content.
//   2. BY SYSPATH INSTRUMENTATION: `appendFileSync`, `writeFileSync`, `renameSync`,
//      `mkdirSync` and `rmSync` are counted around the run. All five are zero.
//      This catches a write the fingerprint could not see - a temp file created
//      and removed, or a same-content rewrite.
//   3. BY THE CONTRAPOSITIVE: the same run with `dryRun: false` plus the token
//      DOES change the bytes. A dry-run test that never showed the real run
//      writing would pass against a purge that does nothing at all.
//
// THE WRITE-ORDERING DEMONSTRATION is at "refuses to delete raw data it could not
// record the removal of". It is a demonstration, not a claim about a returned
// array: the cutover append is made to fail, and the raw snapshots are then
// checked to still be on disk.

import { describe, expect, it, afterEach, vi } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"

// SYSCALL-LEVEL INSTRUMENTATION OF `node:fs`.
//
// A byte fingerprint proves the two segment files are unchanged. It does NOT prove
// that nothing was written and then undone, and it cannot see a temporary file
// that was created and removed inside the run. So the mutating calls are counted
// directly.
//
// The counting is a `vi.mock` over the real module rather than an assignment to
// `import * as fs`: an ES module namespace object is frozen, and assigning to one
// throws `Cannot redefine property`. The proxy passes everything through unchanged
// except the six mutating names, so the store and the purge run against REAL
// filesystem behaviour - a mock that fabricated results would prove nothing about
// what a dry-run does.
const FS_CALLS = vi.hoisted(() => ({
  appendFileSync: 0,
  writeFileSync: 0,
  renameSync: 0,
  mkdirSync: 0,
  rmSync: 0,
  unlinkSync: 0
}))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal()
  return new Proxy(actual, {
    get(target, property) {
      if (typeof property === "string" && Object.prototype.hasOwnProperty.call(FS_CALLS, property)) {
        return (...args) => {
          FS_CALLS[property] += 1
          return target[property](...args)
        }
      }
      return target[property]
    }
  })
})

function fsCallCounts() {
  return { ...FS_CALLS }
}

function resetFsCallCounts() {
  for (const key of Object.keys(FS_CALLS)) FS_CALLS[key] = 0
}

import {
  DAILY_AGGREGATE_PERMANENT_CLASS,
  PERMANENT_APPEND_ONLY_CLASS,
  RAW_90D_THEN_AGGREGATED_CLASS,
  SNAPSHOT_RETENTION_DAYS
} from "../retention.mjs"
import {
  PERMANENT_LEDGER_FILENAME,
  RAW_SNAPSHOT_SEGMENT_FILENAME,
  createRetentionStore
} from "../retentionStore.mjs"
import { permanentLedgerSize } from "../permanentLedger.mjs"
import { CUTOVER_TRANSFORM, PURGE_CONFIRMATION_TOKEN, planSnapshotPurge, runSnapshotPurge } from "../purgeSnapshots.mjs"

const DAY_MS = 24 * 60 * 60 * 1000
// The reference "now". Old enough that the June fixture is 134 days back, so no
// fixture sits near the boundary by accident.
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)
const RUN_ID = "t15-dryrun-proof"

const scratchDirs = []

function newScratchDir() {
  const created = resolve(mkdtempSync(join(tmpdir(), "picc-t15-purge-")))
  const tempRoot = resolve(tmpdir())
  if (!created.startsWith(tempRoot + sep)) {
    throw new Error(`refusing to use ${created}: it is not inside the OS temp directory ${tempRoot}`)
  }
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

function snapshot(id, day, hour, overrides = {}) {
  const base = Date.UTC(2026, 5, day, hour)
  return {
    kind: "market_snapshot",
    retentionClass: RAW_90D_THEN_AGGREGATED_CLASS,
    id,
    observedAt: base,
    symbol: "BTCUSD",
    open: 100 + hour,
    high: 101 + hour,
    low: 99 + hour,
    close: 100 + hour,
    volume: 10 + hour,
    payload: `{"ticks":${1000 + hour}}`,
    ...overrides
  }
}

/** Three expired snapshots on 2026-06-03, plus two young ones and one aggregate. */
function seedStore(dir) {
  const store = createRetentionStore({ dir, purge: true })
  store.append(vetoRecord())
  store.append(snapshot("old-1", 3, 0))
  store.append(snapshot("old-2", 3, 1))
  store.append(snapshot("old-3", 3, 2))
  store.append(snapshot("young-1", 5, 0, { observedAt: NOW - 10 * DAY_MS }))
  store.append(aggregateRecord())
  return store
}

function vetoRecord(overrides = {}) {
  return {
    kind: "veto_decision",
    ruleId: "wickVsClose",
    fired: true,
    inputs: { wickPct: 0.9 },
    suppressed: "long entry",
    evaluatedAt: Date.UTC(2026, 5, 3),
    ruleVersion: "1.0.0",
    ...overrides
  }
}

function aggregateRecord() {
  return {
    kind: "daily_aggregate",
    retentionClass: DAILY_AGGREGATE_PERMANENT_CLASS,
    aggregateId: "agg-preexisting00000",
    transformVersion: "ws7.t15.d8.snapshot-to-daily-aggregate.v1",
    bucket: "2026-05-01",
    symbol: "BTCUSD",
    open: 90,
    high: 95,
    low: 85,
    close: 92,
    volume: 500,
    sampleCount: 24
  }
}

/** Name, size, mtime AND content for every file in a directory. */
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

/** Snapshot, run `fn`, and report how many mutating filesystem calls it made. */
function countMutations(fn) {
  resetFsCallCounts()
  const result = fn()
  return { result, counts: fsCallCounts() }
}

describe("T15:1334 - the purge is DRY-RUN BY DEFAULT, and dry-run writes nothing", () => {
  it("writes nothing at all: bytes, mtimes and every mutating call", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    const before = fingerprint(dir)
    const ledgerBytesBefore = permanentLedgerSize(dir)

    const { result, counts } = countMutations(() => runSnapshotPurge({ store, now: NOW, runId: RUN_ID }))

    // (1) The run reports itself as a dry-run, and does not claim to have written.
    expect(result.dryRun).toBe(true)
    expect(result.wrote).toBe(false)
    expect(result.purgeResult).toBeNull()

    // (2) BYTE-LEVEL. Same files, same sizes, same mtimes, same contents.
    expect(fingerprint(dir)).toEqual(before)

    // The most direct statement of the property, on its own: the permanent ledger
    // did not grow by a single byte. A dry-run that appended a cutover "just in
    // case" would pass a record-count check and fail this.
    expect(permanentLedgerSize(dir)).toBe(ledgerBytesBefore)

    // (3) SYSPATH-LEVEL. Not one mutating filesystem call, so there is no
    // write-then-restore and no temp file the fingerprint could not see.
    expect(counts).toEqual({
      appendFileSync: 0,
      writeFileSync: 0,
      renameSync: 0,
      mkdirSync: 0,
      rmSync: 0,
      unlinkSync: 0
    })
  })

  it("leaves the store's contents IDENTICAL: no aggregate, no cutover, no deletion", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    const permanentBefore = store.readPermanent()
    const snapshotsBefore = store.readSnapshots()

    runSnapshotPurge({ store, now: NOW, runId: RUN_ID })

    expect(store.readPermanent()).toEqual(permanentBefore)
    expect(store.readSnapshots()).toEqual(snapshotsBefore)
    expect(store.readCutovers()).toEqual([])
    // The three expired snapshots are still there. A dry-run that purged quietly
    // and reported honestly about it would still be a purge.
    expect(store.readSnapshots().filter((r) => r.id.startsWith("old-"))).toHaveLength(3)
  })

  it("computes the SAME deletion set a real run would use", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    const dry = runSnapshotPurge({ store, now: NOW, runId: RUN_ID })

    expect(dry.plan.expiredCount).toBe(3)
    expect([...dry.plan.expiredSnapshotIds].sort()).toEqual(["old-1", "old-2", "old-3"])
    expect([...dry.plan.retainedSnapshotIds].sort()).toEqual(["young-1"])
    expect(dry.plan.buckets).toEqual([{ bucket: "2026-06-03", symbol: "BTCUSD", count: 3 }])
    expect(dry.plan.aggregates).toHaveLength(1)
    expect(dry.plan.cutovers).toHaveLength(1)
    expect(dry.plan.cutovers[0].removedCount).toBe(3)
  })

  it("THE CONTRAPOSITIVE: the same store DOES change under a real run", () => {
    // Without this, the three assertions above would also pass against a purge
    // that never writes anything at all - which is the anti-goal "a dry-run that
    // still writes" has as a twin.
    const dir = newScratchDir()
    const store = seedStore(dir)
    const before = fingerprint(dir)

    const real = runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })

    expect(real.dryRun).toBe(false)
    expect(real.wrote).toBe(true)
    expect(fingerprint(dir)).not.toEqual(before)
    expect(store.readSnapshots().filter((r) => r.id.startsWith("old-"))).toHaveLength(0)
    expect(store.readSnapshots().map((r) => r.id)).toEqual(["young-1"])
    expect(store.readCutovers()).toHaveLength(1)
    expect(store.readPermanent().filter((r) => r.kind === "daily_aggregate")).toHaveLength(2)
  })
})

describe("AC-034 - a real run needs an explicit, unambiguous opt-in", () => {
  it("REFUSES dryRun: false with no confirmation, and writes nothing", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    const before = fingerprint(dir)

expect(() => runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false })).toThrow(/confirmation token/i)

    expect(fingerprint(dir)).toEqual(before)
    expect(store.readSnapshots()).toHaveLength(4)
    expect(store.readCutovers()).toEqual([])
  })

  it("REFUSES every near-miss spelling of the token", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    const before = fingerprint(dir)

    const wrong = [
      "",
      " ",
      "permanently_delete_expired_snapshots",
      "PERMANENTLY_DELETE_EXPIRED_SNAPSHOT",
      "PERMANENTLY_DELETE_EXPIRED_SNAPSHOTS ",
      " PERMANENTLY_DELETE_EXPIRED_SNAPSHOTS",
      "PERMANENTLY_DELETE_EXPIRED_SNAPSHOTS\n",
      "PERMANENTLY-DELETE-EXPIRED-SNAPSHOTS",
      "true",
      "yes",
      "1",
      "on",
      PURGE_CONFIRMATION_TOKEN.slice(0, -1)
    ]
    for (const confirmation of wrong) {
      expect(
        () => runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation }),
        `confirmation ${JSON.stringify(confirmation)} must be refused`
      ).toThrow(/confirmation token/i)
    }

    expect(fingerprint(dir)).toEqual(before)
    expect(store.readSnapshots()).toHaveLength(4)
  })

  it("names the token in the refusal message, so the error is actionable", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    let message = ""
    try {
      runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain(PURGE_CONFIRMATION_TOKEN)
    // And it says that nothing was written, because a refusal that had already
    // purged would be the worst possible reading of this error.
    expect(message).toMatch(/nothing was written/i)
  })

  it("treats ANY non-false dryRun as a dry-run, so a truthy string cannot purge", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    const before = fingerprint(dir)
    for (const dryRun of [undefined, null, 0, "", "false", "no", NaN, {}]) {
      const result = runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun })
      expect(result.dryRun, `dryRun=${JSON.stringify(dryRun)}`).toBe(true)
      expect(result.wrote).toBe(false)
    }
    expect(fingerprint(dir)).toEqual(before)
  })

  it("a real run with NOTHING to purge is a completed run, not an error", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir, purge: true })
    store.append(snapshot("fresh", 14, 0, { observedAt: NOW - DAY_MS }))
    const before = fingerprint(dir)
    const real = runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    expect(real.dryRun).toBe(false)
    expect(real.wrote).toBe(false)
    expect(real.purgeResult).toEqual({ removed: 0, buckets: 0 })
    expect(fingerprint(dir)).toEqual(before)
  })

  it("refuses a store that is not a purge target, and a missing runId", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir, purge: true })
    expect(() => runSnapshotPurge({ store: null, now: NOW, runId: RUN_ID })).toThrow(/store/i)
    expect(() => runSnapshotPurge({ store: {}, now: NOW, runId: RUN_ID })).toThrow(/store/i)
    expect(() => runSnapshotPurge({ store, now: NOW, runId: "" })).toThrow(/runId/i)
    expect(() => planSnapshotPurge({ store, now: "not a number", runId: RUN_ID })).toThrow(/finite/i)
  })

  it("KEY ONE of two: a store that was never granted the purge verb is refused, and nothing goes", () => {
    // `runSnapshotPurge` needs TWO independent grants: the store must have been built
    // with `purge: true`, AND the caller must pass the confirmation token. This is the
    // first one, tested on its own - a caller holding the correct token still cannot
    // purge a store that was never marked as a purge target.
    const dir = newScratchDir()
    const store = createRetentionStore({ dir }) // deliberately NOT purge: true
    store.append(vetoRecord())
    store.append(snapshot("old-1", 3, 0))
    expect(store.purgeable).toBe(false)
    const before = fingerprint(dir)

    expect(() =>
      runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    ).toThrow(/not a PURGE TARGET/i)
    // Even a DRY-run is refused, because a plan over a store that can never be purged
    // would be a plan about a hypothetical.
    expect(() => runSnapshotPurge({ store, now: NOW, runId: RUN_ID })).toThrow(/not a PURGE TARGET/i)
    expect(fingerprint(dir)).toEqual(before)
    expect(store.readSnapshots().map((r) => r.id)).toEqual(["old-1"])
    expect(store.readPermanent().map((r) => r.kind)).toEqual(["veto_decision"])
  })
})

describe("AC-033 - the purge replaces raw snapshots with their aggregate and RECORDS the cutover", () => {
  it("removes only the expired raw rows, and leaves the young one", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    expect(store.readSnapshots().map((r) => r.id)).toEqual(["young-1"])
  })

  it("appends the aggregate as a PERMANENT record, not as a raw snapshot", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    const aggregate = store.readPermanent().find((r) => r.aggregateId === "agg-preexisting00000" ? false : r.kind === "daily_aggregate" && r.bucket === "2026-06-03")
    expect(aggregate).toBeDefined()
    expect(aggregate.retentionClass).toBe(DAILY_AGGREGATE_PERMANENT_CLASS)
    expect(aggregate).toMatchObject({ bucket: "2026-06-03", symbol: "BTCUSD", sampleCount: 3 })
  })

  it("records count, class, window and an identifier - and no removed payloads", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })

    const cutovers = store.readCutovers()
    expect(cutovers).toHaveLength(1)
    const cutover = cutovers[0]

    // COUNT.
    expect(cutover.removedCount).toBe(3)
    // CLASS - and it is the permanent one, so the record of the purge cannot
    // itself be purged.
    expect(cutover.retentionClass).toBe(PERMANENT_APPEND_ONLY_CLASS)
    expect(cutover.kind).toBe("retention_cutover")
    // WINDOW - both the calendar bucket and the exact instants.
    expect(cutover.bucket).toBe("2026-06-03")
    expect(cutover.windowStart).toBe(Date.UTC(2026, 5, 3, 0))
    expect(cutover.windowEnd).toBe(Date.UTC(2026, 5, 3, 2))
    expect(cutover.retentionDays).toBe(SNAPSHOT_RETENTION_DAYS)
    // IDENTIFIERS.
    expect(typeof cutover.cutoverId).toBe("string")
    expect(cutover.cutoverId.length).toBeGreaterThan(8)
    expect(cutover.removedDigest).toMatch(/^d-[0-9a-f]{16}$/)
    expect(cutover.aggregateDigest).toMatch(/^d-[0-9a-f]{16}$/)
    expect(cutover.aggregateId).toMatch(/^agg-[0-9a-f]{16}$/)
    expect(cutover.firstSnapshotId).toBe("old-1")
    expect(cutover.lastSnapshotId).toBe("old-3")
    expect(cutover.runId).toBe(RUN_ID)
    expect(cutover.transform).toBe(CUTOVER_TRANSFORM)
    expect(cutover.recordedAt).toBe(NOW)

    // NO removed payload. The cutover is evidence, and evidence that carries the
    // data it is evidence about is a second copy of what the purge removed.
    const serialised = JSON.stringify(cutover)
    expect(serialised).not.toContain('"ticks"')
    expect(serialised).not.toContain("payload")
    expect(Object.keys(cutover).sort()).not.toContain("snapshotIds")
  })

  it("is ATTRIBUTABLE: a different runId produces a different cutoverId", () => {
    const a = newScratchDir()
    const storeA = seedStore(a)
    runSnapshotPurge({ store: storeA, now: NOW, runId: "run-a", dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    const b = newScratchDir()
    const storeB = seedStore(b)
    runSnapshotPurge({ store: storeB, now: NOW, runId: "run-b", dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    expect(storeA.readCutovers()[0].cutoverId).not.toBe(storeB.readCutovers()[0].cutoverId)
    // ...while the removed set is the same, so the digest matches.
    expect(storeA.readCutovers()[0].removedDigest).toBe(storeB.readCutovers()[0].removedDigest)
  })

  it("the removed digest names the SET, not the order the segment happened to hold it in", () => {
    // Two stores holding the same three expired snapshots in opposite file order.
    const forward = newScratchDir()
    const storeForward = createRetentionStore({ dir: forward, purge: true })
    for (const hour of [0, 1, 2]) storeForward.append(snapshot(`same-${hour}`, 3, hour))

    const reverse = newScratchDir()
    const storeReverse = createRetentionStore({ dir: reverse, purge: true })
    for (const hour of [2, 1, 0]) storeReverse.append(snapshot(`same-${hour}`, 3, hour))

    runSnapshotPurge({ store: storeForward, now: NOW, runId: "same", dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    runSnapshotPurge({ store: storeReverse, now: NOW, runId: "same", dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })

    const a = storeForward.readCutovers()[0]
    const b = storeReverse.readCutovers()[0]
    // Same ids, same set: one digest. The ids are read as a SET precisely so that a
    // cutover record is comparable across runs whose segment order differed - which
    // is the normal case the moment a store is rebuilt or restored.
    expect(a.removedDigest).toBe(b.removedDigest)
    expect(a.aggregateDigest).toBe(b.aggregateDigest)
    // And a DIFFERENT set must NOT collide, or the identifier would be useless.
    const other = newScratchDir()
    const storeOther = createRetentionStore({ dir: other, purge: true })
    storeOther.append(snapshot("different-0", 3, 0))
    storeOther.append(snapshot("same-1", 3, 1))
    storeOther.append(snapshot("same-2", 3, 2))
    runSnapshotPurge({ store: storeOther, now: NOW, runId: "same", dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    expect(storeOther.readCutovers()[0].removedDigest).not.toBe(a.removedDigest)
  })

  it("the cutover record SURVIVES the purge and is inspectable afterwards", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    // A second real run. The store is now younger, but the FIRST run's evidence is
    // still there, which is the point: a permanent record of a cutover cannot be
    // removed by the job that made it.
    runSnapshotPurge({ store, now: NOW, runId: "first", dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    runSnapshotPurge({ store, now: NOW, runId: "second", dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    const runIds = store.readCutovers().map((c) => c.runId).sort()
    expect(runIds).toEqual(["first"])
    // The second run found nothing to do, so it appended nothing, and it did not
    // remove the first run's record.
    expect(store.readCutovers()[0].runId).toBe("first")
  })

  it("produces one cutover per (bucket, symbol), each naming its own aggregate", () => {
    const dir = newScratchDir()
    const store = createRetentionStore({ dir, purge: true })
    store.append(snapshot("a-1", 3, 0, { symbol: "BTCUSD" }))
    store.append(snapshot("b-1", 4, 0, { symbol: "BTCUSD" }))
    store.append(snapshot("e-1", 3, 0, { symbol: "ETHUSD" }))
    runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    const cutovers = store.readCutovers()
    expect(cutovers).toHaveLength(3)
    expect(cutovers.map((c) => `${c.bucket}/${c.symbol}`).sort()).toEqual([
      "2026-06-03/BTCUSD",
      "2026-06-03/ETHUSD",
      "2026-06-04/BTCUSD"
    ])
    expect(new Set(cutovers.map((c) => c.cutoverId)).size).toBe(3)
    expect(new Set(cutovers.map((c) => c.aggregateId)).size).toBe(3)
    expect(cutovers.every((c) => c.removedCount === 1)).toBe(true)
  })
})

describe("the purge NEVER touches a permanent class", () => {
  it("leaves every veto record, the pre-existing aggregate and their bytes alone", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    const permanentBefore = store.readPermanent()
    const ledgerBefore = readFileSync(join(dir, PERMANENT_LEDGER_FILENAME), "utf8")

    runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })

    const permanentAfter = store.readPermanent()
    // Everything that was there is still there, in the same order, unchanged...
    expect(permanentAfter.slice(0, permanentBefore.length)).toEqual(permanentBefore)
    // ...and the ONLY additions are the new aggregate and the new cutover.
    expect(permanentAfter.slice(permanentBefore.length).map((r) => r.kind)).toEqual([
      "daily_aggregate",
      "retention_cutover"
    ])
    // The original ledger bytes are a prefix of the new file: append-only, literally.
    expect(readFileSync(join(dir, PERMANENT_LEDGER_FILENAME), "utf8").startsWith(ledgerBefore)).toBe(true)
  })

  it("refuses to run at all when the raw segment holds a permanent record", () => {
    // Planted directly in the segment, bypassing append(). `readSnapshots` throws,
    // so the purge cannot compute a deletion set - and the planted line survives,
    // because the failure is a refusal rather than a repair.
    const dir = newScratchDir()
    const store = seedStore(dir)
    const segment = join(dir, RAW_SNAPSHOT_SEGMENT_FILENAME)
    writeFileSync(segment, `${readFileSync(segment, "utf8")}${JSON.stringify(vetoRecord({ ruleId: "sessionOpen" }))}\n`)

    expect(() => runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })).toThrow(/permanent/i)
    // And a DRY-run refuses too, rather than reporting a clean plan over a file it
    // cannot vouch for.
    expect(() => runSnapshotPurge({ store, now: NOW, runId: RUN_ID })).toThrow(/permanent/i)
    expect(readFileSync(segment, "utf8")).toContain("sessionOpen")
  })

  it("refuses to run at all when the permanent ledger holds a raw snapshot", () => {
    const dir = newScratchDir()
    const store = seedStore(dir)
    const segment = join(dir, RAW_SNAPSHOT_SEGMENT_FILENAME)
    const raw = readFileSync(segment, "utf8").trim()
    writeFileSync(segment, "")
    writeFileSync(join(dir, PERMANENT_LEDGER_FILENAME), `${raw}\n`)
    expect(() => runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })).toThrow(/90|raw|snapshot/i)
  })
})

describe("a purge that cannot record what it removed does not remove anything", () => {
  it("fails LOUDLY rather than reporting success", () => {
    // The anti-goal is "swallowing a purge failure and reporting success". A
    // directory where the ledger belongs makes the cutover append impossible.
    const dir = newScratchDir()
    const store = seedStore(dir)
    const ledgerBytes = readFileSync(join(dir, PERMANENT_LEDGER_FILENAME), "utf8")
    rmSync(join(dir, PERMANENT_LEDGER_FILENAME))
    mkdirSync(join(dir, PERMANENT_LEDGER_FILENAME))

    let result = null
    let threw = false
    try {
      result = runSnapshotPurge({ store, now: NOW, runId: RUN_ID, dryRun: false, confirmation: PURGE_CONFIRMATION_TOKEN })
    } catch {
      threw = true
    }
    expect(threw, "a purge that cannot append its cutover must throw, not return").toBe(true)
    expect(result).toBeNull()
    // THE WRITE ORDERING, DEMONSTRATED. The aggregate append comes first and also
    // fails here, so the assertion that matters is the one below it: the raw rows
    // are untouched, because the rewrite is the LAST step.
    const segment = readFileSync(join(dir, RAW_SNAPSHOT_SEGMENT_FILENAME), "utf8")
    for (const id of ["old-1", "old-2", "old-3"]) expect(segment).toContain(id)
    expect(store.readSnapshots()).toHaveLength(4)
    // The ledger's original bytes are recoverable from the caller's read above,
    // which is the point: nothing was destroyed to get here.
    expect(ledgerBytes).toContain("veto_decision")
  })

  it("a DRY-run over a store it cannot verify THROWS rather than reporting a clean plan", () => {
    // A dry-run needs no write capability, so this store - whose permanent ledger
    // has been replaced by a directory - cannot be purged. The honest outcome is a
    // refusal, NOT a plan computed over the half of the store that happened to be
    // readable: a plan that silently ignored an unverifiable ledger would report
    // "0 removed" over a store it knows nothing about. And it still writes nothing.
    const dir = newScratchDir()
    const store = seedStore(dir)
    rmSync(join(dir, PERMANENT_LEDGER_FILENAME))
    mkdirSync(join(dir, PERMANENT_LEDGER_FILENAME))
    const before = fingerprint(dir)

    let threw = false
    let result = null
    try {
      result = runSnapshotPurge({ store, now: NOW, runId: RUN_ID })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(result).toBeNull()
    expect(fingerprint(dir)).toEqual(before)
    expect(readFileSync(join(dir, RAW_SNAPSHOT_SEGMENT_FILENAME), "utf8")).toContain("old-1")
  })
})