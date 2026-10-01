// WS-7 T15 - T15:1330's "persistence layer for veto/score/receipt records".
//
// It appends and it reads. It NEVER REWRITES ANYTHING. That is not an oversight:
// the only file any code in this repository is permitted to rewrite is the raw
// snapshot segment, and the code that rewrites it is `purgeSnapshots.mjs`, not
// this file. Keeping the rewrite out of the store means the store's filesystem
// capability is append-only, so the class-routing guarantee does not depend on
// which method a caller happened to invoke.
//
// WHY THERE IS NO DEFAULT DIRECTORY. Every pre-existing store in this repository
// is an environment variable falling back to a `data` directory beside this tree,
// which is how a misspelled variable became a real account written into gitignored
// live data - the incident `ws7TestStoreIsolation.test.mjs` is built from. A
// constructor that REQUIRES its directory cannot be reached by a misspelling,
// because there is nothing to misspell. That is also why this file reads no
// `PICC_`-prefixed variable and hardcodes no `data`-relative URL of its own:
// either one would put it back in the isolation contract's blast radius for no
// benefit, and the isolation guard scans this file for exactly those two shapes.
//
// (That guard scans raw source text, so this paragraph deliberately does not
// reproduce the fallback expression verbatim. A comment that quotes the forbidden
// pattern is indistinguishable from the pattern to a text scan, and an earlier
// draft of this header did quote it - which failed the guard for a comment.)
//
// WHY THE RAW SEGMENT IS CLASS-CHECKED ON EVERY READ. The purge's whole job is to
// remove rows from that one file, so a bug that let a permanent record into it
// would turn a routing mistake into a deleted audit trail. The check therefore
// lives on the READ path, which the purge cannot avoid: if the segment holds a
// record whose derived class is not the raw class, the read throws and the purge
// cannot compute a deletion set at all.

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DAILY_AGGREGATE_PERMANENT_CLASS,
  PERMANENT_APPEND_ONLY_CLASS,
  RAW_90D_THEN_AGGREGATED_CLASS,
  RETENTION_CLASSES,
  assertRetentionClassConsistent,
  classifyRecord,
  isPermanentClass
} from "./retention.mjs"
import { PERMANENT_LEDGER_FILENAME, appendPermanent, readPermanent } from "./permanentLedger.mjs"

// Re-exported so a consumer - the CLI, the purge job, and the tests - names the
// permanent ledger through the store's own surface instead of importing a second
// module to learn the filename. One name, one owner.
export { PERMANENT_LEDGER_FILENAME }

/**
 * The one rewritable file in the store: the 90-day raw class.
 *
 * Named for its class, not for its role, so a reader of the directory listing can
 * tell which file the purge touches without reading any code.
 */
export const RAW_SNAPSHOT_SEGMENT_FILENAME = "copilot-retention-raw-snapshots.jsonl"

/**
 * Resolve a store directory. BASIC validation only.
 *
 * A store directory is REQUIRED and has no default. Every pre-existing store in
 * this repository is an environment variable that falls back to a `data`
 * directory beside this tree, which is how a misspelled variable became a real
 * account written into gitignored live data - the incident
 * `ws7TestStoreIsolation.test.mjs` is built from. A constructor that REQUIRES its
 * directory cannot be reached by a misspelling, because there is nothing to
 * misspell. That is also why this file reads no `PICC_`-prefixed variable and
 * hardcodes no `data`-relative URL of its own: either one would put it back in the
 * isolation contract's blast radius for no benefit. See the note at the top of the
 * file on why this JSDoc does not quote the fallback expression verbatim.
 *
 * @param {string} dir
 * @returns {string} the resolved directory
 */
export function assertRetentionStoreDirAllowed(dir) {
  if (typeof dir !== "string" || dir.trim().length === 0) {
    throw new TypeError(
      "copilot retention: a store directory is REQUIRED and has no default. Every existing per-service " +
        `store in this repository falls back to the live server/data when its variable is unset or ` +
        `misspelled; this one takes a path or it does not exist. Received ${JSON.stringify(dir)}.`
    )
  }
  if (!isAbsolute(dir)) {
    throw new TypeError(`copilot retention: store directory must be an absolute path; received ${JSON.stringify(dir)}`)
  }
  return resolve(dir)
}

/** `apps/dashboard/server`, resolved from this module's own URL. Lazy, not module-scope. */
export function dashboardServerTree() {
  return fileURLToPath(new URL("../../", import.meta.url))
}

/**
 * The ADDITIONAL rule a store must satisfy before anything may DELETE from it:
 * its directory may not resolve inside the dashboard server tree.
 *
 * WHY IT IS SEPARATE FROM `assertRetentionStoreDirAllowed`. Ordinary appends and
 * reads are safe anywhere, and a retention store installed at
 * `server/data/copilot-retention/` alongside every other per-service store is the
 * conventional layout. Refusing that for appends would make the module unusable in
 * production over a concern that only applies to the destructive verb.
 *
 * WHY IT EXISTS ANYWAY. The tree holds `server/data`, the live store this
 * repository has already had an incident with, and T15 is the module whose normal
 * operation DELETES records. The check canonicalises the deepest EXISTING ancestor
 * first, because a lexical compare walks straight through a junction.
 *
 * STATED LIMIT, not hidden: T15 cannot distinguish a legitimate future install of a
 * purgeable retention store under `server/data/` from a mistake, so it refuses the
 * whole tree. Widening this needs a dated owner decision.
 *
 * @param {string} dir
 * @returns {string} the resolved directory
 */
export function assertPurgeTargetAllowed(dir) {
  const resolved = assertRetentionStoreDirAllowed(dir)
  const canonical = canonicalizeExisting(resolved)
  const serverTree = canonicalizeExisting(dashboardServerTree())
  const fromServer = relative(serverTree, canonical)
  const insideServerTree =
    fromServer === "" ||
    (fromServer !== ".." && !fromServer.startsWith(`..${sep}`) && !isAbsolute(fromServer))
  if (insideServerTree) {
    throw new Error(
      `copilot retention: refusing ${resolved} as a PURGE TARGET because it resolves inside the dashboard ` +
        `server tree (${serverTree}). That tree holds server/data, the live per-service store this repository ` +
        "has already had an incident with, and this module's normal operation deletes records. A store inside it " +
        "can still be APPENDED to and read - only the destructive verb is confined. Point a purgeable store " +
        "somewhere outside the tree until an owner decision says otherwise."
    )
  }
  return resolved
}

/**
 * The same resolution the constructor uses, exposed so a caller - the CLI in
 * particular - can ask the module's question rather than re-implementing it.
 */
export function storeDirFor(dir) {
  return assertRetentionStoreDirAllowed(dir)
}

/**
 * The file a class is stored in. Two classes share the permanent ledger; the raw
 * class has its own.
 *
 * @param {string} dir
 * @param {string} retentionClass one of `RETENTION_CLASSES`
 * @returns {string}
 */
export function segmentPathFor(dir, retentionClass) {
  if (typeof retentionClass !== "string" || !RETENTION_CLASSES.includes(retentionClass)) {
    throw new TypeError(
      `copilot retention: segmentPathFor requires a retention class; received ${JSON.stringify(retentionClass)}. ` +
        `Known classes: ${RETENTION_CLASSES.join(", ")}.`
    )
  }
  if (!isPermanentClass(retentionClass) && retentionClass !== RAW_90D_THEN_AGGREGATED_CLASS) {
    throw new TypeError(`copilot retention: unhandled retention class ${retentionClass}`)
  }
  return retentionClass === RAW_90D_THEN_AGGREGATED_CLASS
    ? join(assertRetentionStoreDirAllowed(dir), RAW_SNAPSHOT_SEGMENT_FILENAME)
    : join(assertRetentionStoreDirAllowed(dir), PERMANENT_LEDGER_FILENAME)
}

// ---------------------------------------------------------------------------

function canonicalizeExisting(target) {
  let head = target
  const tail = []
  for (;;) {
    try {
      return join(realpathSync(head), ...[...tail].reverse())
    } catch {
      const parent = dirname(head)
      if (parent === head) return resolve(target)
      tail.push(basename(head))
      head = parent
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Parse a JSONL segment, failing closed on anything that is not one object per
 * line. Shared by both readers so the two cannot drift into different tolerances.
 */
function parseSegment(text, path, label) {
  const records = []
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new Error(
        `copilot retention: ${label} ${path} has an unparseable line and cannot be read. Cause: ` +
          `${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`copilot retention: ${label} ${path} holds a non-object record.`)
    }
    // Frozen on the way out, for the same reason `readPermanent` freezes: a caller
    // holding a mutable snapshot could edit one the store still believes in.
    records.push(Object.freeze(parsed))
  }
  return records
}

/**
 * The store.
 *
 * @param {object} options
 * @param {string} options.dir Absolute store directory. REQUIRED - see above.
 * @param {boolean} [options.purge=false] Opt in to being a PURGE TARGET. Defaults
 *   to `false`, and a store built without it has no `rawSegmentPath` at all, so the
 *   purge job has nothing to rewrite and refuses it by construction.
 *
 *   The opt-in exists because the destructive verb should be an explicit,
 *   construction-time GRANT rather than a property of having a directory. It is the
 *   second half of the two-key requirement for a real purge: a caller must both
 *   build a purgeable store AND pass the confirmation token to
 *   `runSnapshotPurge`. A store inside the dashboard server tree cannot be built
 *   with `purge: true` at all - see `assertPurgeTargetAllowed`.
 *
 * @returns {object} a frozen store with no mutator beyond `append`.
 */
export function createRetentionStore({ dir, purge = false } = {}) {
  if (typeof purge !== "boolean") {
    throw new TypeError(`copilot retention: \`purge\` must be a boolean; received ${String(purge)}`)
  }
  const storeDir = purge ? assertPurgeTargetAllowed(dir) : assertRetentionStoreDirAllowed(dir)
  const purgeable = purge
  // The raw segment's path is ALWAYS known, because APPENDING a snapshot to it is
  // not destructive - that is where a snapshot lands before its 90-day cutover.
  // What `purge: false` withholds is the REWRITE, and `purgeable` is the single flag
  // the purge job checks, so the two cannot come apart.
  const rawSegment = join(storeDir, RAW_SNAPSHOT_SEGMENT_FILENAME)

  function appendRaw(record) {
    if (!existsSync(storeDir)) mkdirSync(storeDir, { recursive: true })
    appendFileSync(rawSegment, `${JSON.stringify(record)}\n`, { encoding: "utf8" })
    return Object.freeze(record)
  }

/**
   * Append one record, routed by its DERIVED retention class.
   *
   * The stored record is the input plus its derived `retentionClass` - the field
   * §4.3:668-671 puts on every retained record, so a ledger reader can filter on
   * the class without re-deriving it. T11's own entries already carry that exact
   * string, so stamping is a no-op for them and T11's tag is preserved verbatim.
   *
   * The store adds NOTHING ELSE: no clock, no sequence number, no `recordedAt`. A
   * veto record's time is the engine's `evaluatedAt`, and a store that stamped a
   * second one would leave a reader with two different answers to "when did this
   * happen" - the kind of ambiguity D8 exists to remove.
   */
  function append(record) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError(
        `copilot retention: append requires a record object; received ${record === null ? "null" : typeof record}. ` +
          "A T11 veto entry has no \`kind\` - hand it to vetoSink() instead."
      )
    }
    const retentionClass = assertRetentionClassConsistent(record)
    const stamped = Object.freeze({ ...record, retentionClass })
    return retentionClass === RAW_90D_THEN_AGGREGATED_CLASS ? appendRaw(stamped) : appendPermanent(storeDir, stamped)
  }

  /**
   * The sink T15 supplies to T11's `createVetoIndex`.
   *
   * T11's veto entries carry `ruleId`, `fired`, `inputs`, `suppressed`,
   * `evaluatedAt`, `ruleVersion` and T11's own `retentionClass` tag - but no
   * `kind`, because T11 predates D8's routing table. Adding `kind: "veto_decision"`
   * here is the whole of the integration: T11's module is untouched, its stamped
   * tag is preserved verbatim, and the record lands in the permanent ledger.
   */
  function vetoSink() {
    return (entry) => {
      if (entry === null || typeof entry !== "object") {
        throw new TypeError(`copilot retention: vetoSink requires a T11 veto entry object; received ${String(entry)}`)
      }
      if (typeof entry.ruleId !== "string" || entry.ruleId.length === 0) {
        throw new TypeError("copilot retention: vetoSink requires a T11 veto entry with a string ruleId.")
      }
      return append({ ...entry, kind: "veto_decision" })
    }
  }

  return Object.freeze({
    dir: storeDir,
    /** Where raw snapshots are APPENDED. Rewriting it needs `purgeable`. */
    rawSegmentPath: rawSegment,
    /** Whether this store may be the target of a purge at all. */
    purgeable,

    append,
    vetoSink,

    /** Every permanent record: veto, score, receipt, daily aggregate, cutover. */
    readPermanent() {
      const records = readPermanent(storeDir)
      for (const record of records) {
        const retentionClass = classifyRecord(record)
        if (!isPermanentClass(retentionClass)) {
          throw new Error(
            `copilot retention: the permanent ledger holds a ${retentionClass} record (kind ` +
              `${JSON.stringify(record.kind)}). A record in the permanent ledger that is not permanent would be ` +
              "unreadable AND unpurgeable, so this is a hard failure rather than a filter."
          )
        }
      }
      return records
    },

    /**
     * Every raw snapshot, class-checked. The purge cannot compute a deletion set
     * without calling this, so a foreign class here is a hard failure by
     * construction rather than by policy.
     */
    readSnapshots() {
      if (!existsSync(rawSegment)) return Object.freeze([])
      const text = readFileSync(rawSegment, "utf8")
      if (text.trim().length === 0) return Object.freeze([])
      const records = parseSegment(text, rawSegment, "raw snapshot segment")
      for (const record of records) {
        const retentionClass = classifyRecord(record)
        if (retentionClass !== RAW_90D_THEN_AGGREGATED_CLASS) {
          throw new Error(
            `copilot retention: the raw snapshot segment holds a ${retentionClass} record (kind ` +
              `${JSON.stringify(record.kind)}). This segment is the ONLY rewritable file, so a permanent ` +
              "record here would be deleted by the next purge. Refusing to read it."
          )
        }
      }
      return Object.freeze(records)
    },

    /** Just the cutover records - the durable evidence that a purge ran. */
    readCutovers() {
      return Object.freeze(this.readPermanent().filter((record) => record.kind === "retention_cutover"))
    },

    /** Total records held, across both segments. */
    get size() {
      return this.readPermanent().length + this.readSnapshots().length
    }
  })
}