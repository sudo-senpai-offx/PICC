// WS-7 T15 - D8:157-164, R11:440-443, AC-033 (`:1029-1035`).
//
// THE SPEC TEXT, VERBATIM, BECAUSE THE TASK IS THE CLASSIFICATION.
//
//   D8:160  "Veto decisions, score breakdowns, and execution receipts are
//            permanent append-only. Raw market snapshots are retained 90 days
//            and then replaced by aggregates. Daily aggregates are permanent."
//   D8:164  "Append-only means no update or delete path exists for those three
//            classes. The 90-day job is a one-way transform with a recorded
//            cutover."
//   AC-033:1032  "The first three are untouched and have no update/delete path;
//                 the snapshot is replaced by its aggregate in a recorded one-way
//                 transform; the daily aggregate is untouched."
//   AC-033:1033  PROHIBITED: "No purge may touch a permanent class, and the
//                 transform may not be reversible by re-deriving deleted raw
//                 data."
//
// This file tests the PURE seam: `retention.mjs` classifies and transforms, and
// touches no filesystem. The persistence layer (`retentionStore.mjs`) and the
// purge job (`purgeSnapshots.mjs`) are separate files, because the claim AC-034
// makes - that a permanent class has no mutating PATH - is a claim about module
// structure and is therefore tested there, against module structure.
//
// WHY THE CLASS IS DERIVED RATHER THAN PASSED. A `retentionClass` parameter would
// make the routing the thing under test into the thing under audit: any caller
// could route a veto record into the 90-day window by passing the other class,
// and the tests would still pass. So the only input is the record's `kind`, and
// `classifyRecord` is total over a closed set of kinds. An unrecognised kind
// throws rather than defaulting - the honesty contract at spec `:79` forbids a
// fabricated classification, and "default to permanent" would be a fabricated
// classification just as much as "default to 90 days".

import { describe, expect, it } from "vitest"

import {
  AGGREGATE_FIELDS,
  DAILY_AGGREGATE_PERMANENT_CLASS,
  PERMANENT_APPEND_ONLY_CLASS,
  RAW_90D_THEN_AGGREGATED_CLASS,
  RECORD_KINDS,
  RECORD_KIND_CLASSES,
  RETAINED_SNAPSHOT_FIELDS,
  SNAPSHOT_RETENTION_DAYS,
  SNAPSHOT_RETENTION_MS,
  TRANSFORM_VERSION,
  classifyRecord,
  isPermanentClass,
  isRetentionExpired,
  retentionClassFor,
  snapshotBucket,
  snapshotCutoff,
  transformExpiredSnapshots
} from "../retention.mjs"
import { VETO_RETENTION_CLASS } from "../vetoIndex.mjs"

const DAY_MS = 24 * 60 * 60 * 1000
// Far enough past the fixtures' 2026-06-03 bucket that the whole day is well
// beyond 90 days (June 3 -> October 15 is 104 days), so a fixture's expiry is not
// a near-boundary coincidence a reader has to compute.
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)

// A snapshot whose payload fields the transform does NOT retain. `id`,
// `observedAt`, `symbol`, `open`, `high`, `low`, `close` and `volume` are the
// retained set; everything below is the loss D8 specifies.
const EXTRA_SNAPSHOT_FIELDS = {
  payload: "{\"orderFlow\":{\"netFlow\":-4211},\"rawTicks\":18422}",
  source: "kraken-ws",
  latencyMs: 37,
  tickDirection: -1,
  spread: 0.0041
}

function snapshot(overrides = {}) {
  return {
    kind: "market_snapshot",
    retentionClass: RAW_90D_THEN_AGGREGATED_CLASS,
    id: "snap-0001",
    observedAt: Date.UTC(2026, 5, 3, 0, 0, 0),
    symbol: "BTCUSD",
    open: 100,
    high: 103,
    low: 100,
    close: 103,
    volume: 10,
    ...EXTRA_SNAPSHOT_FIELDS,
    ...overrides
  }
}

/** One day of intraday snapshots, expired relative to `NOW`. */
function dayOfSnapshots(bucketDay, entries) {
  const base = Date.UTC(...bucketDay)
  return entries.map((entry, index) =>
    snapshot({
      id: `snap-${bucketDay[0]}${bucketDay[1]}${bucketDay[2]}-${index}`,
      observedAt: base + index * 60 * 60 * 1000,
      ...entry
    })
  )
}

describe("AC-033 - the three retention classes are the spec's three, in the spec's spelling", () => {
  it("names exactly the union at §4.3:668-671 and nothing else", () => {
    expect(DAILY_AGGREGATE_PERMANENT_CLASS).toBe("daily_aggregate_permanent")
    expect(PERMANENT_APPEND_ONLY_CLASS).toBe("permanent_append_only")
    expect(RAW_90D_THEN_AGGREGATED_CLASS).toBe("raw_90d_then_aggregated")
    expect(Object.values(RECORD_KIND_CLASSES)).toContain(PERMANENT_APPEND_ONLY_CLASS)
    // The closed set is the claim. A fourth class would be an invented value,
    // which :674 forbids ("The shapes are contracts, not permission to invent
    // values").
    expect(new Set(Object.values(RECORD_KIND_CLASSES)).size).toBe(3)
  })

  it("routes D8:160's three permanent kinds and its two snapshot kinds", () => {
    expect(retentionClassFor("veto_decision")).toBe(PERMANENT_APPEND_ONLY_CLASS)
    expect(retentionClassFor("score_breakdown")).toBe(PERMANENT_APPEND_ONLY_CLASS)
    expect(retentionClassFor("execution_receipt")).toBe(PERMANENT_APPEND_ONLY_CLASS)
    expect(retentionClassFor("market_snapshot")).toBe(RAW_90D_THEN_AGGREGATED_CLASS)
    expect(retentionClassFor("daily_aggregate")).toBe(DAILY_AGGREGATE_PERMANENT_CLASS)
  })

  // THE T11 INTEGRATION, ASSERTED RATHER THAN ASSUMED. T11
  // `vetoIndex.mjs:66,133` stamps every record with the literal
  // `permanent_append_only`. T15's routing derives that same literal from the
  // record's kind. If the two ever drift, a real veto record would be routed by
  // one module's constant and classified by another module's table, and nothing
  // would notice until a purge ran.
  it("agrees with T11's own veto-record constant, so the two modules share one string", () => {
    expect(retentionClassFor("veto_decision")).toBe(VETO_RETENTION_CLASS)
    expect(VETO_RETENTION_CLASS).toBe(PERMANENT_APPEND_ONLY_CLASS)
  })

  it("gives the cutover record D8's permanent class, so a purge cannot erase its own evidence", () => {
    // D8:164 requires "a recorded cutover". A cutover is not a fifth class; it is
    // a permanent record, which is the only class that cannot be purged - so the
    // evidence of a purge is the one thing the next purge cannot remove.
    expect(retentionClassFor("retention_cutover")).toBe(PERMANENT_APPEND_ONLY_CLASS)
    expect(isPermanentClass(retentionClassFor("retention_cutover"))).toBe(true)
  })

  it("refuses an unrecognised kind instead of guessing a class", () => {
    for (const kind of ["unknown", "", null, undefined, 7, {}, "market_snapshot "]) {
      expect(() => retentionClassFor(kind), `kind ${JSON.stringify(kind)}`).toThrow(/retention/i)
    }
    expect(RECORD_KINDS).toContain("retention_cutover")
    expect(RECORD_KINDS).toContain("market_snapshot")
    expect(RECORD_KINDS).toContain("daily_aggregate")
  })

  it("classifies a record from its kind alone, so a mislabelled class is caught", () => {
    // A record that CLAIMS to be permanent while its kind says raw is the exact
    // shape of a routing bug that would let the purge eat an audit record. The
    // class is recomputed, never trusted.
    const mislabelled = snapshot({ retentionClass: PERMANENT_APPEND_ONLY_CLASS })
    expect(classifyRecord(mislabelled)).toBe(RAW_90D_THEN_AGGREGATED_CLASS)
    expect(classifyRecord(mislabelled)).not.toBe(mislabelled.retentionClass)
  })
})

describe("AC-033 - the 90-day window is derived, and only the raw class can expire", () => {
  it("holds a snapshot for 90 days and expires it after", () => {
    expect(SNAPSHOT_RETENTION_DAYS).toBe(90)
    expect(SNAPSHOT_RETENTION_MS).toBe(90 * DAY_MS)
    expect(snapshotCutoff(NOW)).toBe(NOW - 90 * DAY_MS)
  })

  it("buckets by UTC day", () => {
    expect(snapshotBucket(Date.UTC(2026, 5, 3, 0, 0, 0))).toBe("2026-06-03")
    expect(snapshotBucket(Date.UTC(2026, 5, 3, 23, 59, 59))).toBe("2026-06-03")
    expect(snapshotBucket(Date.UTC(2026, 5, 4, 0, 0, 0))).toBe("2026-06-04")
  })

  it("expires a raw snapshot at the boundary and not one day earlier", () => {
    const atCutoff = snapshot({ observedAt: NOW - 90 * DAY_MS })
    const oneDayYounger = snapshot({ observedAt: NOW - 90 * DAY_MS + 1 })
    expect(isRetentionExpired(atCutoff, NOW)).toBe(true)
    expect(isRetentionExpired(oneDayYounger, NOW)).toBe(false)
  })

  it("can NEVER expire a permanent record, whatever its age", () => {
    // Not "does not expire today" - the function is not capable of returning
    // true for these classes. A record written in 1970 is still not expirable,
    // which is the property that makes a routing bug non-destructive.
    const ancient = new Date(0).getTime()
    for (const kind of ["veto_decision", "score_breakdown", "execution_receipt", "retention_cutover"]) {
      expect(isRetentionExpired({ kind, observedAt: ancient }, NOW), kind).toBe(false)
      expect(isRetentionExpired({ kind, recordedAt: ancient }, NOW), kind).toBe(false)
    }
    const ancientAggregate = { kind: "daily_aggregate", recordedAt: ancient, observedAt: ancient }
    expect(isRetentionExpired(ancientAggregate, NOW)).toBe(false)
  })

  it("refuses an unclassifiable record rather than expiring it or keeping it", () => {
    expect(() => isRetentionExpired({ kind: "mystery", observedAt: 0 }, NOW)).toThrow(/retention/i)
  })
})

describe("AC-033 - the 90-day transform is ONE WAY, and the loss is exact", () => {
  const dayA = dayOfSnapshots([2026, 5, 3], [
    { open: 100, high: 100, low: 100, close: 100, volume: 10 },
    { open: 101, high: 101, low: 101, close: 101, volume: 5 },
    { open: 102, high: 102, low: 102, close: 102, volume: 15 },
    { open: 103, high: 103, low: 103, close: 103, volume: 10 }
  ])
  // SAME aggregate, DIFFERENT raw data: disjoint snapshot ids, different
  // per-sample prices, different dropped payloads. This is the pair that proves
  // the map is not injective, and a non-injective map cannot be inverted on its
  // image - which is AC-033:1033's "may not be reversible by re-deriving deleted
  // raw data" stated as arithmetic rather than as a promise.
  //
  // Volume is 10 + 8 + 12 + 10 = 40, identical to dayA's, and every middle price
  // is strictly inside (100, 103) so neither `high` nor `low` moves. Only the
  // intraday path differs.
  const dayB = dayOfSnapshots([2026, 5, 3], [
    { id: "zz-0001", open: 100, high: 100, low: 100, close: 100, volume: 10, payload: "ALPHA" },
    { id: "zz-0002", open: 100.5, high: 101.5, low: 100.5, close: 101.5, volume: 8, payload: "BETA" },
    { id: "zz-0003", open: 101.5, high: 101.5, low: 100.5, close: 101.5, volume: 12, payload: "GAMMA" },
    { id: "zz-0004", open: 103, high: 103, low: 103, close: 103, volume: 10, payload: "DELTA" }
  ])

  it("replaces an expired day with exactly one permanent daily aggregate", () => {
    const { aggregates, removed } = transformExpiredSnapshots(dayA, { now: NOW })
    expect(aggregates).toHaveLength(1)
    expect(aggregates[0]).toMatchObject({
      kind: "daily_aggregate",
      retentionClass: DAILY_AGGREGATE_PERMANENT_CLASS,
      bucket: "2026-06-03",
      symbol: "BTCUSD",
      open: 100,
      high: 103,
      low: 100,
      close: 103,
      volume: 40,
      sampleCount: 4,
      transformVersion: TRANSFORM_VERSION
    })
    expect(removed).toEqual([{ bucket: "2026-06-03", symbol: "BTCUSD", count: 4, snapshotIds: dayA.map((s) => s.id) }])
  })

  it("is DETERMINISTIC: the same expired day transforms to a byte-identical aggregate", () => {
    const first = transformExpiredSnapshots(dayA, { now: NOW })
    const second = transformExpiredSnapshots([...dayA].reverse(), { now: NOW })
    expect(JSON.stringify(first.aggregates)).toBe(JSON.stringify(second.aggregates))
  })

  // THE IRREVERSIBILITY PROOF, in the form that cannot be argued with.
  it("maps two DISJOINT raw sets to one byte-identical aggregate - so it is not invertible", () => {
    expect(JSON.stringify(dayA)).not.toBe(JSON.stringify(dayB))
    expect(dayA.map((s) => s.id)).not.toEqual(dayB.map((s) => s.id))

    const a = transformExpiredSnapshots(dayA, { now: NOW }).aggregates[0]
    const b = transformExpiredSnapshots(dayB, { now: NOW }).aggregates[0]
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))

    // And nothing in the aggregate distinguishes them: no snapshot id, no
    // payload, no per-sample value. If either were present the two aggregates
    // would differ, so their equality is the proof that the preimage is
    // unrecoverable from the image.
    const serialised = JSON.stringify(a)
    for (const id of [...dayA, ...dayB].map((s) => s.id)) {
      expect(serialised, `the aggregate must not carry snapshot id ${id}`).not.toContain(id)
    }
    expect(serialised).not.toContain("payload")
    expect(serialised).not.toContain("ALPHA")
    expect(serialised).not.toContain("BETALPHA")
  })

  it("loses EXACTLY the non-retained fields, and the retained set is enumerated", () => {
    const { aggregates } = transformExpiredSnapshots(dayA, { now: NOW })
    const aggregate = aggregates[0]

    // The retained snapshot fields are named, so the loss is a list rather than
    // an absence. Anything a producer puts on a snapshot beyond this set is
    // dropped at the cutover.
    expect(RETAINED_SNAPSHOT_FIELDS).toEqual([
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
    for (const field of Object.keys(EXTRA_SNAPSHOT_FIELDS)) {
      expect(RETAINED_SNAPSHOT_FIELDS, `${field} must not be retained`).not.toContain(field)
      expect(JSON.stringify(aggregate), `${field} must be dropped`).not.toContain(`"${field}"`)
    }

    // The aggregate's own key set is exact, so a future field added by accident
    // (a timestamp, a sample id, a source) fails this test rather than quietly
    // making the transform reversible.
    expect(Object.keys(aggregate).sort()).toEqual([...AGGREGATE_FIELDS].sort())
    for (const key of Object.keys(aggregate)) {
      expect(AGGREGATE_FIELDS).toContain(key)
    }
  })

  it("loses the intraday PATH: two different intraday paths collapse to one aggregate", () => {
    // Same open, high, low, close, volume, sample count and bucket; different
    // per-sample values at the same timestamps. The aggregate cannot say which
    // path the market took, which is exactly the information D8 trades the raw
    // snapshot for: "replaced by aggregates" means the path is what is given up.
    //
    // This is a DIFFERENT claim from the disjoint-id collision above. That one
    // shows the aggregate carries no identity; this one shows it carries no
    // sequence. Neither alone would prove non-invertibility, and the test that
    // would collapse them is the one that would be wrong.
    const pathP = dayOfSnapshots([2026, 5, 3], [
      { open: 100, high: 100, low: 100, close: 100, volume: 10 },
      { open: 101, high: 101, low: 101, close: 101, volume: 5 },
      { open: 102, high: 102, low: 102, close: 102, volume: 15 },
      { open: 103, high: 103, low: 103, close: 103, volume: 10 }
    ])
    const pathQ = dayOfSnapshots([2026, 5, 3], [
      { open: 100, high: 100, low: 100, close: 100, volume: 10 },
      { open: 100.5, high: 101.5, low: 100.5, close: 101.5, volume: 8 },
      { open: 101.5, high: 101.5, low: 100.5, close: 101.5, volume: 12 },
      { open: 103, high: 103, low: 103, close: 103, volume: 10 }
    ])
    // Same ids, same timestamps - so the ONLY difference is the path.
    expect(pathP.map((s) => s.id)).toEqual(pathQ.map((s) => s.id))
    expect(pathP.map((s) => s.observedAt)).toEqual(pathQ.map((s) => s.observedAt))
    expect(JSON.stringify(pathP)).not.toBe(JSON.stringify(pathQ))

    const a = transformExpiredSnapshots(pathP, { now: NOW }).aggregates[0]
    const b = transformExpiredSnapshots(pathQ, { now: NOW }).aggregates[0]
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.sampleCount).toBe(4)
    expect(a.volume).toBe(40)
  })

  it("REFUSES its own output, so the transform can never be applied twice", () => {
    // "Applying it twice" does not silently do nothing and does not silently
    // corrupt the aggregate - it is not a permitted input at all. The aggregate
    // is `daily_aggregate_permanent`, which is D8's third class and is not a
    // 90-day raw record.
    const { aggregates } = transformExpiredSnapshots(dayA, { now: NOW })
    expect(() => transformExpiredSnapshots(aggregates, { now: NOW })).toThrow(/retention/i)
  })

  it("REFUSES a permanent record in the input set", () => {
    // The prohibited side effect at AC-033:1033 is "no purge may touch a
    // permanent class". The check is in the transform, not only in the purge's
    // selector, so the protection does not depend on the caller having filtered
    // correctly first.
    const polluted = [...dayA, { kind: "veto_decision", retentionClass: PERMANENT_APPEND_ONLY_CLASS, ruleId: "wickVsClose" }]
    expect(() => transformExpiredSnapshots(polluted, { now: NOW })).toThrow(/retention/i)
  })

  it("REFUSES a snapshot that is not yet 90 days old", () => {
    const young = [snapshot({ observedAt: NOW - 10 * DAY_MS })]
    expect(() => transformExpiredSnapshots(young, { now: NOW })).toThrow(/90|expir/i)
  })

  it("REFUSES a snapshot that lies about its own class", () => {
    const lying = [snapshot({ retentionClass: PERMANENT_APPEND_ONLY_CLASS, observedAt: Date.UTC(2026, 5, 3) })]
    expect(() => transformExpiredSnapshots(lying, { now: NOW })).toThrow(/retention/i)
  })

  it("produces one aggregate per (bucket, symbol) and nothing else", () => {
    const mixed = [
      ...dayOfSnapshots([2026, 5, 3], [{ open: 1, high: 1, low: 1, close: 1, volume: 1 }]),
      ...dayOfSnapshots([2026, 5, 4], [{ open: 2, high: 2, low: 2, close: 2, volume: 2 }]),
      ...dayOfSnapshots([2026, 5, 3], [{ symbol: "ETHUSD", open: 9, high: 9, low: 9, close: 9, volume: 9 }])
    ]
    const { aggregates, removed } = transformExpiredSnapshots(mixed, { now: NOW })
    expect(aggregates.map((a) => `${a.bucket}/${a.symbol}`).sort()).toEqual([
      "2026-06-03/BTCUSD",
      "2026-06-03/ETHUSD",
      "2026-06-04/BTCUSD"
    ])
    expect(removed).toHaveLength(3)
    expect(removed.reduce((n, r) => n + r.count, 0)).toBe(3)
    // The ETH snapshot keeps its own symbol rather than being folded into the
    // BTC day: a daily aggregate of the wrong instrument would be a silent lie.
    expect(aggregates.find((a) => a.symbol === "ETHUSD").volume).toBe(9)
  })

  it("rejects a non-finite or missing price rather than aggregating NaN", () => {
    for (const bad of [{ close: NaN }, { volume: Infinity }, { high: undefined }, { low: "103" }]) {
      const broken = [snapshot({ observedAt: Date.UTC(2026, 5, 3) }), snapshot({ observedAt: Date.UTC(2026, 5, 3, 1), ...bad })]
      expect(() => transformExpiredSnapshots(broken, { now: NOW }), JSON.stringify(bad)).toThrow(/finite|numeric|retention/i)
    }
  })

  it("reads no clock and no filesystem, so the transform is a pure function", async () => {
    const { readFileSync } = await import("node:fs")
    const source = readFileSync(new URL("../retention.mjs", import.meta.url), "utf8")

    // CLOCK READS, not `Date` in general. `new Date(someNumber).toISOString()` is
    // a pure function of its argument and `snapshotBucket` uses exactly that - the
    // value is checked against three UTC boundaries above rather than being
    // banned by name, because a guard that bans a token instead of a behaviour
    // is a guard that gets deleted. What is banned here is every construction that
    // consults the ambient clock, the ambient entropy source, or the filesystem.
    for (const forbidden of [
      "Date.now",
      "new Date()",
      "new Date(  ",
      "performance.now",
      "process.hrtime",
      "Math.random",
      "crypto.random",
      "node:fs",
      "node:os",
      "readFileSync",
      "writeFileSync",
      "appendFileSync",
      "fetch("
    ]) {
      expect(source, `retention.mjs must not contain ${forbidden}`).not.toContain(forbidden)
    }
  })
})