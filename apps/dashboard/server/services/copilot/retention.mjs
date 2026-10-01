// WS-7 T15 - D8:157-164. The three retention classes, and the 90-day one-way
// transform. §4.2:564 names this file "D8 class routing + 90d one-way transform".
//
// THIS MODULE IS PURE. No clock, no filesystem, no randomness, no network - the
// last test in `__tests__/retention.test.mjs` asserts that by reading this
// file's own source. The reasons are D8's, not tidiness's:
//
//   * "the transform may not be reversible by re-deriving deleted raw data"
//     (AC-033:1033) is a claim about the FUNCTION. A function that reads a
//     clock has two inputs - the data and the moment - and "re-deriving" then
//     has a second, unreproducible axis to vary along. `now` is therefore an
//     explicit argument and never a read.
//   * "no purge may touch a permanent class" (AC-033:1033) is a claim about
//     WHICH RECORDS CAN BE ARGUMENTS. If the selection lived in the caller the
//     protection would be a property of every future caller rather than of this
//     module, so the class gate is here: `transformExpiredSnapshots` refuses any
//     input whose derived class is not the raw class.
//
// WHERE THE THREE CLASSES COME FROM. §4.3:668-671 declares the union and D8:160
// assigns the kinds. Nothing else may add a class: `:674` says "The shapes are
// contracts, not permission to invent values."

/** §4.3:668-671. The three classes, named exactly. */
export const PERMANENT_APPEND_ONLY_CLASS = "permanent_append_only"
export const RAW_90D_THEN_AGGREGATED_CLASS = "raw_90d_then_aggregated"
export const DAILY_AGGREGATE_PERMANENT_CLASS = "daily_aggregate_permanent"

/** The closed class set, for a guard to compare against rather than re-type. */
export const RETENTION_CLASSES = Object.freeze([
  PERMANENT_APPEND_ONLY_CLASS,
  RAW_90D_THEN_AGGREGATED_CLASS,
  DAILY_AGGREGATE_PERMANENT_CLASS
])

/**
 * Record kind -> class. THE ROUTING UNDER TEST.
 *
 * D8:160 names four kinds. Two more are named here because D8:164 requires a
 * "recorded cutover" and AC-033:1034 requires "a purge-run test asserting the
 * cutover record", and a cutover that is not itself permanent is a record the
 * next purge can remove - which would make the evidence of a purge the one
 * thing a later purge erases. `retention_cutover` is therefore a KIND, not a
 * fifth CLASS: it maps onto `permanent_append_only`, so the class union above is
 * still exactly three.
 *
 * This table is the ONLY place a record's class is decided. There is
 * deliberately no `classify(record, class)` overload and no default branch: an
 * unrecognised kind throws, because "default to permanent" and "default to 90
 * days" are both fabricated classifications and spec `:79` forbids inventing a
 * state the system cannot observe.
 */
export const RECORD_KIND_CLASSES = Object.freeze({
  // D8:160 - "Veto decisions, score breakdowns, and execution receipts are
  // permanent append-only."
  veto_decision: PERMANENT_APPEND_ONLY_CLASS,
  score_breakdown: PERMANENT_APPEND_ONLY_CLASS,
  execution_receipt: PERMANENT_APPEND_ONLY_CLASS,
  // D8:164 - "a one-way transform with a recorded cutover".
  retention_cutover: PERMANENT_APPEND_ONLY_CLASS,
  // D8:160 - "Raw market snapshots are retained 90 days and then replaced by
  // aggregates."
  market_snapshot: RAW_90D_THEN_AGGREGATED_CLASS,
  // D8:160 - "Daily aggregates are permanent." R11.3 (`:443`).
  daily_aggregate: DAILY_AGGREGATE_PERMANENT_CLASS
})

export const RECORD_KINDS = Object.freeze(Object.keys(RECORD_KIND_CLASSES))

/**
 * The class for a record kind. Throws on anything not in the table.
 *
 * @param {string} kind
 * @returns {string} one of `RETENTION_CLASSES`
 */
export function retentionClassFor(kind) {
  const found = typeof kind === "string" ? RECORD_KIND_CLASSES[kind] : undefined
  if (found === undefined) {
    throw new TypeError(
      `copilot retention: unknown record kind ${JSON.stringify(kind)}. Known kinds: ${RECORD_KINDS.join(", ")}. ` +
        "A record whose class cannot be derived is not classified - defaulting it to permanent or to 90 days " +
        "would both be a fabricated retention decision."
    )
  }
  return found
}

/**
 * The class of a record, derived from its `kind` and NEVER from a `retentionClass`
 * field it carries.
 *
 * A record that claims a class is not trusted: a snapshot tagged
 * `permanent_append_only` is still the raw class, and a veto record tagged
 * `raw_90d_then_aggregated` is still permanent. That asymmetry is the whole
 * reason the derived value is what the store routes on.
 *
 * @param {{kind: string}} record
 * @returns {string} one of `RETENTION_CLASSES`
 */
export function classifyRecord(record) {
  if (record === null || typeof record !== "object") {
    throw new TypeError(`copilot retention: classifyRecord requires a record object; received ${String(record)}`)
  }
  return retentionClassFor(record.kind)
}

/** True only for the two permanent classes. Never true for the raw class. */
export function isPermanentClass(retentionClass) {
  return (
    retentionClass === PERMANENT_APPEND_ONLY_CLASS || retentionClass === DAILY_AGGREGATE_PERMANENT_CLASS
  )
}

/**
 * Assert that a record's DECLARED class, if it has one, matches its derived class.
 *
 * `classifyRecord` deliberately ignores `record.retentionClass`, so a mislabelled
 * record would otherwise be silently coerced to the right class. Silent coercion
 * is the wrong answer here: a record whose declared class disagrees with its kind
 * is CORRUPT, and the corrupt records are exactly the ones where guessing is most
 * expensive - a snapshot that calls itself permanent, or a veto record that calls
 * itself raw. The derived class always wins for routing; this refuses the record
 * rather than letting it through under the corrected label, so the disagreement
 * is visible instead of repaired.
 *
 * Records with no `retentionClass` at all are fine - T11's own veto entries carry
 * one, but a freshly built record need not.
 *
 * @param {{kind: string, retentionClass?: string}} record
 * @returns {string} the derived class
 */
export function assertRetentionClassConsistent(record) {
  const derived = classifyRecord(record)
  if (record.retentionClass === undefined) return derived
  if (record.retentionClass !== derived) {
    throw new TypeError(
      `copilot retention: record of kind ${JSON.stringify(record.kind)} declares class ` +
        `${JSON.stringify(record.retentionClass)} but its kind derives ${derived}. The derived class is ` +
        "what routing uses; a record whose own label disagrees is refused rather than corrected, because a " +
        "silent correction would hide the corruption that produced it."
    )
  }
  return derived
}

// ---------------------------------------------------------------------------
// The 90-day window.
// ---------------------------------------------------------------------------

/** D8:160. Stated once, in days, so the millisecond figure is derived. */
export const SNAPSHOT_RETENTION_DAYS = 90

/** Derived from `SNAPSHOT_RETENTION_DAYS`, never written out as a literal. */
export const SNAPSHOT_RETENTION_MS = SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000

/**
 * The instant at or before which a raw snapshot is due for the transform.
 *
 * Inclusive at the boundary: a snapshot observed exactly `SNAPSHOT_RETENTION_DAYS`
 * ago HAS been retained for 90 days and goes. A store that used `<` instead would
 * keep every snapshot for 91 days and nobody would notice for a month.
 */
export function snapshotCutoff(now) {
  return requireFiniteNumber(now, "now") - SNAPSHOT_RETENTION_MS
}

/**
 * The UTC day a snapshot belongs to, as `YYYY-MM-DD`.
 *
 * UTC and not local: an aggregate is a permanent record, and a permanent record
 * whose bucket depended on the machine that computed it would not be reproducible.
 */
export function snapshotBucket(observedAt) {
  const ms = requireFiniteNumber(observedAt, "observedAt")
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The timestamp field a class is aged by. Permanent records do not have one -
 * they do not expire - so this exists to make that asymmetry legible rather than
 * to normalise it away.
 */
function instantOf(record, retentionClass) {
  if (retentionClass === RAW_90D_THEN_AGGREGATED_CLASS) return record.observedAt
  return undefined
}

/**
 * Is this record due for the 90-day transform?
 *
 * FALSE IS STRUCTURAL FOR THE PERMANENT CLASSES, not a policy branch. The
 * function cannot return `true` for them: the class check comes first and there
 * is no path from a permanent class to an expiry verdict. A veto record written
 * in 1970 is still not expirable, which is the property that turns a routing bug
 * from "an audit trail disappeared" into "the purge refused to run".
 *
 * @param {{kind: string, observedAt?: number}} record
 * @param {number} now
 * @returns {boolean}
 */
export function isRetentionExpired(record, now) {
  const retentionClass = classifyRecord(record)
  if (retentionClass !== RAW_90D_THEN_AGGREGATED_CLASS) return false
  const observedAt = instantOf(record, retentionClass)
  return requireFiniteNumber(observedAt, "observedAt") <= snapshotCutoff(now)
}

// ---------------------------------------------------------------------------
// The one-way transform.
// ---------------------------------------------------------------------------

/**
 * The transform's version. Travels on every aggregate AND on every cutover
 * record, so a reader can tell which transform produced an aggregate - and so a
 * future version of this function cannot silently rewrite what an old one meant.
 */
export const TRANSFORM_VERSION = "ws7.t15.d8.snapshot-to-daily-aggregate.v1"

/**
 * EXACTLY the snapshot fields the transform reads.
 *
 * This list is the loss, stated positively. Anything a producer puts on a
 * snapshot beyond these nine fields is dropped at the cutover, and the test
 * asserts that by seeding a snapshot with `payload`, `source`, `latencyMs`,
 * `tickDirection` and `spread` and requiring none of them in the aggregate.
 * `id` is read for the cutover's evidence and for the bucket ordering; it is
 * deliberately NOT carried onto the aggregate, which is what makes the transform
 * non-injective - see `transformExpiredSnapshots`.
 */
export const RETAINED_SNAPSHOT_FIELDS = Object.freeze([
  "id",
  "kind",
  "retentionClass",
  "observedAt",
  "symbol",
  "open",
  "high",
  "low",
  "close",
  "volume"
])

/**
 * EXACTLY the fields a daily aggregate has.
 *
 * There is no `computedAt`, so the aggregate is a pure function of its inputs and
 * two runs over the same expired day are byte-identical. There is no
 * `firstSampleId` / `lastSampleId`, and no per-sample list, because any of those
 * would make the aggregate a function of the sample IDs and would therefore make
 * the transform injective on identifier-bearing inputs - i.e. recoverable.
 */
export const AGGREGATE_FIELDS = Object.freeze([
  "kind",
  "retentionClass",
  "aggregateId",
  "transformVersion",
  "bucket",
  "symbol",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "sampleCount"
])

function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`copilot retention: ${label} must be a finite number; received ${String(value)}`)
  }
  return value
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`copilot retention: ${label} must be a non-empty string; received ${String(value)}`)
  }
  return value
}

/** Group key: one aggregate per (UTC day, instrument). */
function groupKeyOf(snapshot) {
  return `${snapshotBucket(snapshot.observedAt)} ${snapshot.symbol}`
}

function assertTransformable(snapshot, now) {
  // Class first, so a permanent record in the input set is refused by the class
  // rule rather than by an incidental shape check. A record that MISLABELS its
  // class is refused by the consistency rule before either.
  assertRetentionClassConsistent(snapshot)
  const retentionClass = classifyRecord(snapshot)
  if (retentionClass !== RAW_90D_THEN_AGGREGATED_CLASS) {
    throw new TypeError(
      `copilot retention: the 90-day transform only accepts ${RAW_90D_THEN_AGGREGATED_CLASS} records; ` +
        `received a ${retentionClass} record (kind ${JSON.stringify(snapshot.kind)}). A permanent class ` +
        "must never be reachable from the transform."
    )
  }
  requireNonEmptyString(snapshot.id, "snapshot.id")
  requireNonEmptyString(snapshot.symbol, "snapshot.symbol")
  requireFiniteNumber(snapshot.observedAt, "snapshot.observedAt")
  for (const field of ["open", "high", "low", "close", "volume"]) {
    requireFiniteNumber(snapshot[field], `snapshot.${field}`)
  }
  if (!isRetentionExpired(snapshot, now)) {
    throw new RangeError(
      `copilot retention: snapshot ${snapshot.id} has not been retained for ${SNAPSHOT_RETENTION_DAYS} days, ` +
        "so it is not part of a cutover. A transform that could reach a young snapshot would make the " +
        "90-day window advisory."
    )
  }
}

/**
 * The 90-day one-way transform: expired raw snapshots in, one permanent daily
 * aggregate per (UTC day, instrument) out.
 *
 * WHY IT CANNOT BE INVERTED. Three properties, each one tested:
 *
 *   1. THE AGGREGATE CARRIES NO SAMPLE IDENTITY. `aggregateId` is derived from
 *      (bucket, symbol, transformVersion) alone. Two expired days with
 *      DISJOINT snapshot id sets and different per-sample values therefore
 *      produce BYTE-IDENTICAL aggregates. A map with a non-singleton fibre
 *      admits no inverse on its image, so no function can recover the deleted raw
 *      data from the aggregate. This is AC-033:1033's prohibition as arithmetic
 *      rather than as a promise.
 *   2. THE AGGREGATE CARRIES NO CLOCK AND NO ORDER. Intra-bucket ordering is
 *      lost, and there is no `computedAt`, so re-running the transform cannot be
 *      distinguished from the first run.
 *   3. ITS OUTPUT IS NOT A VALID INPUT. An aggregate is
 *      `daily_aggregate_permanent`, which fails the class gate, so the transform
 *      cannot be applied to its own result. "Applying it twice" is not a
 *      degenerate operation - it is a refusal.
 *
 * @param {ReadonlyArray<object>} snapshots Expired raw snapshots, any order.
 * @param {{ now: number }} options `now` is the cutoff reference, supplied by
 *   the caller so this function reads no clock.
 * @returns {{ aggregates: ReadonlyArray<object>, removed: ReadonlyArray<{bucket: string, symbol: string, count: number, snapshotIds: ReadonlyArray<string>}> }}
 *   `removed` is the working set for the purge's segment rewrite. It carries
 *   snapshot IDs, never snapshot payloads, and none of it is written to the
 *   permanent ledger.
 */
export function transformExpiredSnapshots(snapshots, { now } = {}) {
  if (!Array.isArray(snapshots)) {
    throw new TypeError(`copilot retention: transformExpiredSnapshots requires an array; received ${typeof snapshots}`)
  }
  if (snapshots.length === 0) return Object.freeze({ aggregates: Object.freeze([]), removed: Object.freeze([]) })

  for (const snapshot of snapshots) {
    if (snapshot === null || typeof snapshot !== "object") {
      throw new TypeError(`copilot retention: snapshot must be an object; received ${String(snapshot)}`)
    }
    assertTransformable(snapshot, now)
  }

  // Sorted by (observedAt, id) so the open/close choice is deterministic
  // regardless of the caller's array order. Determinism is what lets two runs be
  // compared byte-for-byte at all.
  const ordered = [...snapshots].sort((a, b) => a.observedAt - b.observedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const groups = new Map()
  for (const snapshot of ordered) {
    const key = groupKeyOf(snapshot)
    const existing = groups.get(key)
    if (existing) existing.push(snapshot)
    else groups.set(key, [snapshot])
  }

  const aggregates = []
  const removed = []
  for (const key of [...groups.keys()].sort()) {
    const members = groups.get(key)
    const first = members[0]
    const last = members[members.length - 1]
    const bucket = snapshotBucket(first.observedAt)
    const symbol = first.symbol

    let high = first.high
    let low = first.low
    let volume = 0
    for (const snapshot of members) {
      if (snapshot.high > high) high = snapshot.high
      if (snapshot.low < low) low = snapshot.low
      volume += snapshot.volume
    }

    aggregates.push(
      Object.freeze({
        kind: "daily_aggregate",
        retentionClass: DAILY_AGGREGATE_PERMANENT_CLASS,
        aggregateId: aggregateIdFor(bucket, symbol, TRANSFORM_VERSION),
        transformVersion: TRANSFORM_VERSION,
        bucket,
        symbol,
        open: first.open,
        high,
        low,
        close: last.close,
        volume,
        sampleCount: members.length
      })
    )

    removed.push(
      Object.freeze({
        bucket,
        symbol,
        count: members.length,
        // Ids only. This list is used to rewrite the raw segment and is never
        // persisted onto the permanent ledger.
        snapshotIds: Object.freeze(members.map((s) => s.id))
      })
    )
  }

  return Object.freeze({ aggregates: Object.freeze(aggregates), removed: Object.freeze(removed) })
}

/**
 * A short, deterministic, dependency-free digest over a string.
 *
 * An IDENTIFIER, not a security boundary. Nothing in D8's guarantee is trusted
 * against tampering by a digest: the permanent classes are protected by the
 * ABSENCE of a mutating path, and the 90-day transform's irreversibility comes
 * from the aggregate carrying no sample identity. A digest here names a thing -
 * an aggregate, a cutover, a removed set - so two of them can be compared.
 */
export function shortDigest(seed) {
  if (typeof seed !== "string") {
    throw new TypeError(`copilot retention: shortDigest requires a string; received ${String(seed)}`)
  }
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`
}

/**
 * An aggregate's identity: derived from the bucket, the instrument and the
 * transform version, and from NOTHING ELSE.
 *
 * Not from the snapshot IDs, not from the values, not from a clock. That is what
 * makes two disjoint raw sets collide, and the collision is the irreversibility
 * proof - so this function's argument list is load-bearing and a future edit
 * adding a fourth argument would destroy the property AC-033:1033 asks for.
 */
export function aggregateIdFor(bucket, symbol, transformVersion) {
  return `agg-${shortDigest(`${transformVersion} ${bucket} ${symbol}`)}`
}