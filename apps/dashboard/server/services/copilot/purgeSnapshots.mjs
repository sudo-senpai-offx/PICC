// WS-7 T15 - the snapshot purge job. T15:1330, AC-033 (`:1029-1035`),
// AC-034 (`:1037-1043`), and the bisect line at T15:1334.
//
//   T15:1334  "The purge job can be dry-run against a fixture without touching
//              production data."
//   D8:164    "The 90-day job is a one-way transform with a recorded cutover."
//
// THREE PROPERTIES THIS FILE EXISTS TO HOLD, AND EACH ONE HAS A TEST THAT FAILS
// WITHOUT IT:
//
//   1. DRY-RUN IS THE DEFAULT. `dryRun` defaults to `true`, so a caller that
//      forgets the argument gets the safe behaviour. This is inverted from the
//      usual "opt in to safety" shape on purpose: the failure mode of the default
//      is deleting records, and a module whose normal operation deletes records
//      should be impossible to point at a store without naming the verb.
//   2. A REAL RUN NEEDS AN EXPLICIT TOKEN. `dryRun: false` alone is refused; the
//      caller must also pass `confirmation === PURGE_CONFIRMATION_TOKEN`, a string
//      that appears nowhere except here and in the tests that prove the refusal
//      works. There is no boolean, no environment variable and no config file
//      that can turn a dry-run into a real one.
//   3. A REAL RUN IS ALL-OR-NOTHING IN THE SAFE ORDER. The aggregate is appended,
//      then the cutover record is appended, and only then is the raw segment
//      rewritten. A crash before the rewrite leaves the raw data intact AND the
//      evidence of the attempt on record - the recoverable direction. The reverse
//      order would leave a purge that deleted data and recorded nothing.
//
// THE WRITE ORDERING IS TESTED, NOT ASSERTED. `__tests__/purgeSnapshots.test.mjs`
// makes the cutover append fail - by putting a directory where the ledger file
// belongs - and then checks that the raw snapshots are STILL ON DISK. That is a
// demonstration of the ordering, where a returned "steps" array would only be a
// claim about it.

import { renameSync, writeFileSync } from "node:fs"

import {
  PERMANENT_APPEND_ONLY_CLASS,
  RAW_90D_THEN_AGGREGATED_CLASS,
  SNAPSHOT_RETENTION_DAYS,
  TRANSFORM_VERSION,
  classifyRecord,
  isRetentionExpired,
  shortDigest,
  snapshotBucket,
  transformExpiredSnapshots
} from "./retention.mjs"

/**
 * The string a caller must pass, in addition to `dryRun: false`, to make the purge
 * actually delete anything.
 *
 * Spelled out in full and compared for exact equality - no prefix, no
 * case-insensitivity, no trimming. A confirmation that accepts several spellings
 * is a confirmation some future caller will match by accident, and this is the one
 * place in the repository where matching by accident destroys data.
 */
export const PURGE_CONFIRMATION_TOKEN = "PERMANENTLY_DELETE_EXPIRED_SNAPSHOTS"

/** The cutover record's declared transform, restated so a reader can check it. */
export const CUTOVER_TRANSFORM = "one_way_irreversible"

/**
 * Work out what a purge WOULD do. Reads only; writes nothing, ever, on any branch.
 *
 * Separated from `runSnapshotPurge` so "what would happen" and "what happened"
 * cannot drift: the real run's deletion set is this function's output, not a
 * second computation.
 *
 * @param {object} options
 * @param {object} options.store A store from `createRetentionStore`.
 * @param {number} options.now The cutoff reference. Caller-supplied; this module
 *   reads no clock, so a plan is reproducible.
 * @returns {{now: number, retentionDays: number, transformVersion: string,
 *   cutoff: number, expiredSnapshotIds: ReadonlyArray<string>,
 *   retainedSnapshotIds: ReadonlyArray<string>, expiredCount: number,
 *   retainedCount: number, buckets: ReadonlyArray<object>,
 *   aggregates: ReadonlyArray<object>, cutovers: ReadonlyArray<object>}}
 */
export function planSnapshotPurge({ store, now, runId }) {
  if (store === null || typeof store !== "object" || typeof store.readSnapshots !== "function") {
    throw new TypeError("copilot retention: planSnapshotPurge requires a retention store with readSnapshots().")
  }
  // The destructive verb has TWO keys, and this is the first. A store that was not
  // built with `purge: true` has `rawSegmentPath === null`, so there is nothing for
  // a rewrite to target and the run is refused before a single record is read.
  if (store.purgeable !== true || typeof store.rawSegmentPath !== "string") {
    throw new Error(
      "copilot retention: this store is not a PURGE TARGET. Rebuild it as " +
        "createRetentionStore({ dir, purge: true }) to grant the destructive verb. A store that was never " +
        "granted it has no rewritable path, so nothing could have been deleted either way."
    )
  }
  if (typeof now !== "number" || !Number.isFinite(now)) {
    throw new TypeError(`copilot retention: planSnapshotPurge requires a finite \`now\`; received ${String(now)}`)
  }
  if (typeof runId !== "string" || runId.length === 0) {
    throw new TypeError("copilot retention: planSnapshotPurge requires a non-empty `runId` so cutover records are attributable.")
  }

  // BOTH SEGMENTS ARE VERIFIED BEFORE ANY ARITHMETIC HAPPENS.
  //
  // `readSnapshots` class-checks the raw segment, so the selection below cannot be
  // handed a permanent record even by mistake. `readPermanent` is read for the
  // same reason in the other direction: a raw-class row stranded in the permanent
  // ledger is a row the next purge can never sweep, and a purge that ignored it
  // would report a clean plan while D8's 90-day window was quietly being violated.
  // A run that cannot vouch for the whole store refuses rather than proceeding
  // over the part it happened to read.
  const permanent = store.readPermanent()
  const snapshots = store.readSnapshots()
  const expired = snapshots.filter((record) => isRetentionExpired(record, now))
  const expiredIds = new Set(expired.map((record) => record.id))
  const retained = snapshots.filter((record) => !expiredIds.has(record.id))

  const { aggregates, removed } = transformExpiredSnapshots(expired, { now })

  const cutovers = removed.map((window) => {
    const members = expired
      .filter((record) => record.symbol === window.symbol && snapshotBucket(record.observedAt) === window.bucket)
      .slice()
      .sort((a, b) => a.observedAt - b.observedAt || (a.id < b.id ? -1 : 1))
    const first = members[0]
    const last = members[members.length - 1]
    const aggregate = aggregates.find((a) => a.bucket === window.bucket && a.symbol === window.symbol)

    return Object.freeze({
      kind: "retention_cutover",
      retentionClass: PERMANENT_APPEND_ONLY_CLASS,
      cutoverId: cutoverIdFor(runId, window.bucket, window.symbol),
      transform: CUTOVER_TRANSFORM,
      transformVersion: TRANSFORM_VERSION,
      runId,
      // The window, in the two forms a reader needs: the calendar bucket and the
      // exact instants the removed records occupied.
      bucket: window.bucket,
      symbol: window.symbol,
      windowStart: first.observedAt,
      windowEnd: last.observedAt,
      // The count, and an identifier for the set that left.
      removedCount: window.count,
      removedDigest: digestOf(window.snapshotIds.slice().sort()),
      firstSnapshotId: first.id,
      lastSnapshotId: last.id,
      // What the removed rows became.
      aggregateId: aggregate.aggregateId,
      aggregateDigest: digestOf([JSON.stringify(aggregate)]),
      retentionDays: SNAPSHOT_RETENTION_DAYS,
      recordedAt: now
    })
  })

  return Object.freeze({
    now,
    runId,
    retentionDays: SNAPSHOT_RETENTION_DAYS,
    transformVersion: TRANSFORM_VERSION,
    // How many permanent records were verified untouched. Reported so a reader of
    // the plan can see the purge was scoped to the raw class and nothing else.
    permanentCount: permanent.length,
    expiredSnapshotIds: Object.freeze([...expiredIds]),
    retainedSnapshotIds: Object.freeze(retained.map((record) => record.id)),
    expiredCount: expired.length,
    retainedCount: retained.length,
    buckets: Object.freeze(removed.map((w) => ({ bucket: w.bucket, symbol: w.symbol, count: w.count }))),
    aggregates: Object.freeze(aggregates),
    cutovers: Object.freeze(cutovers)
  })
}

/**
 * Run the 90-day purge. DRY-RUN UNLESS TOLD OTHERWISE.
 *
 * @param {object} options
 * @param {object} options.store
 * @param {number} options.now
 * @param {string} options.runId
 * @param {boolean} [options.dryRun=true] Defaults to `true`.
 * @param {string} [options.confirmation] Required, and required to be EXACT, when
 *   `dryRun` is `false`.
 * @returns {{dryRun: boolean, wrote: boolean, plan: object, purgeResult: object|null}}
 */
export function runSnapshotPurge({ store, now, runId, dryRun = true, confirmation = undefined }) {
  const plan = planSnapshotPurge({ store, now, runId })

  if (dryRun !== false) {
    // Reported honestly: a dry-run that claimed to have purged would be the exact
    // "silent pass" anti-goal, and `wrote` is the field a caller must not have to
    // infer.
    return Object.freeze({ dryRun: true, wrote: false, plan, purgeResult: null })
  }

  if (confirmation !== PURGE_CONFIRMATION_TOKEN) {
    throw new Error(
      "copilot retention: a real snapshot purge requires the exact confirmation token. This store's normal " +
        "operation DELETES records, so the destructive verb has to be named deliberately rather than reached by " +
        `a forgotten argument. Pass confirmation: "${PURGE_CONFIRMATION_TOKEN}" to execute, or leave dryRun at ` +
        "its default to see what a real run WOULD remove. No dry-run output was produced and nothing was written."
    )
  }

  if (plan.expiredCount === 0) {
    // Nothing to do is still a completed run, and it is reported as such rather
    // than as an error. An empty purge that throws would make a nightly job look
    // broken on every day the store is young.
    return Object.freeze({ dryRun: false, wrote: false, plan, purgeResult: Object.freeze({ removed: 0, buckets: 0 }) })
  }

  // STEP 1 - the replacement. Appended to the permanent ledger first, so the
  // aggregate exists before any raw row is dropped.
  for (const aggregate of plan.aggregates) store.append(aggregate)

  // STEP 2 - the evidence. Appended before the rewrite, so a failure after this
  // point leaves a purge that is recorded and reversible-in-effect (the raw rows
  // are still there) rather than a deletion nobody can account for.
  for (const cutover of plan.cutovers) store.append(cutover)

  // STEP 3 - the one-way part. The raw segment is rewritten without the expired
  // rows. `writeFileSync` to a sibling and `renameSync` over the target, so a
  // failure part-way leaves the ORIGINAL file intact rather than a half-written
  // one. This is the ONLY rewrite in the retention store, and it targets
  // RAW_90D_THEN_AGGREGATED_CLASS only - the path comes from the store, so a
  // purge cannot be pointed at the permanent ledger by a caller.
  const expiredIdSet = new Set(plan.expiredSnapshotIds)
  const surviving = store.readSnapshots().filter((record) => !expiredIdSet.has(record.id))
  for (const record of surviving) {
    if (classifyRecord(record) !== RAW_90D_THEN_AGGREGATED_CLASS) {
      throw new Error(
        `copilot retention: refusing to rewrite the raw segment: a surviving record (kind ` +
          `${JSON.stringify(record.kind)}) is not ${RAW_90D_THEN_AGGREGATED_CLASS}.`
      )
    }
  }
  const target = store.rawSegmentPath
  const staging = `${target}.cutover-${plan.runId}.tmp`
  writeFileSync(staging, surviving.map((record) => `${JSON.stringify(record)}\n`).join(""), { encoding: "utf8" })
  renameSync(staging, target)

  return Object.freeze({
    dryRun: false,
    wrote: true,
    plan,
    purgeResult: Object.freeze({
      removed: plan.expiredCount,
      buckets: plan.buckets.length,
      retained: plan.retainedCount,
      aggregates: plan.aggregates.length,
      cutovers: plan.cutovers.length
    })
  })
}

function cutoverIdFor(runId, bucket, symbol) {
  return `cut-${shortDigest(`${CUTOVER_TRANSFORM}|${TRANSFORM_VERSION}|${runId}|${bucket}|${symbol}`)}`
}

/**
 * A deterministic digest over a set of identifiers.
 *
 * This is the cutover's "identifier": it lets two runs over the same removed set
 * be compared without the ledger keeping the removed ids themselves, and it is
 * what makes the record useful after the rows it describes are gone.
 *
 * Callers pass an ALREADY-SORTED list - `removedDigest` does, deliberately, so the
 * digest names the SET that was removed rather than the order the segment happened
 * to hold it in.
 *
 * Not exported: it is the cutover's internal encoding, and the contract the reader
 * cares about is `removedDigest` on the record. Exporting it would be a second way
 * to say "this is how we name things", which is one more thing to keep in step.
 */
function digestOf(parts) {
  return `d-${shortDigest(parts.join(" "))}`
}