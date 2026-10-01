// WS-7 T15 - AC-034 (`:1037-1043`): permanent records are append-only in
// practice. This module is the ONLY code in the repository that may write a
// permanent record, and it is deliberately built so that it CANNOT do anything
// else.
//
//   AC-034:1038  "An operator attempts to edit or delete a veto record."
//   AC-034:1040  "The operation is rejected; the record is immutable."
//   AC-034:1041  PROHIBITED: "No admin or migration path may mutate a permanent
//                            class."
//   D8:164       "Append-only means no update or delete path exists for those
//                three classes."
//
// WHY THIS IS A FILE WITH A RESTRICTED IMPORT LIST RATHER THAN A RUNTIME CHECK.
//
// The requirement is the ABSENCE of a path, not a guard that currently blocks one.
// A `store.delete(id)` that throws is one refactor away from a `store.delete(id)`
// that succeeds - and that refactor is exactly what a future migration or admin
// endpoint would be. So the boundary is drawn in the filesystem capability this
// module holds, not in the branches it happens to take:
//
//   THE ONLY fs BINDINGS THIS FILE MAY IMPORT ARE
//   appendFileSync, mkdirSync, readFileSync, existsSync.
//
// There is no `writeFileSync`, no `unlinkSync`, no `renameSync`, no `rmSync`, no
// `truncateSync`, no `copyFileSync`, no `statSync`, no `open(..., "w")` and no
// `createWriteStream`. `__tests__/permanentAppendOnlySurface.test.mjs` asserts that
// list by EXACT EQUALITY against this file's own import statement, so adding any of
// them is a red test rather than a silent capability. A second test asserts that
// no other tracked file in the repository names this ledger's filename, which
// closes AC-034:1041's "no admin or migration path" - there is no second door.
//
// The four are also the minimum. `mkdirSync` creates the store directory on first
// append; `existsSync` distinguishes "absent" from "empty" so an absent ledger
// reads as no records rather than as an error; `readFileSync` is the only reader;
// `appendFileSync` is the only writer, and it cannot seek, truncate or overwrite.
//
// WHAT THIS DOES NOT CLAIM. It does not defend against someone with a filesystem
// editor, an OS-level ACL, or root. It defends against a CODE PATH, which is what
// D8:164 and AC-034 are about: the repository must contain no function that can
// change or delete a permanent record. A hash chain or a write-verify step would be
// DETECTION AFTER THE FACT - a weaker claim than the one asked for - and adding one
// would be gold-plating a control that is supposed to be structural.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The one file that holds every permanent record: veto decisions, score
 * breakdowns, execution receipts, daily aggregates, and retention cutovers.
 *
 * TWO permanent classes share ONE file on purpose. Three classes over three files
 * would mean three places to protect; one file means the purge's rewrite has
 * exactly one target, and that target is unambiguously the non-permanent one. The
 * class is still carried on every record, because the class is what a reader
 * filters on - the file layout is an implementation detail and must not be
 * load-bearing for correctness.
 */
export const PERMANENT_LEDGER_FILENAME = "copilot-retention-permanent.jsonl"

/** The absolute path of the permanent ledger inside a store directory. */
export function permanentLedgerPath(dir) {
  if (typeof dir !== "string" || dir.length === 0) {
    throw new TypeError(`copilot retention: permanentLedgerPath requires a directory string; received ${String(dir)}`)
  }
  return join(dir, PERMANENT_LEDGER_FILENAME)
}

/**
 * Append one line. The ONLY mutating function in the repository for this class.
 *
 * The record is serialised as one JSON object on one line. A literal newline inside
 * a record would split it into two unparseable lines and the segment would fail
 * closed on the next read, so `JSON.stringify`'s escaping is what keeps one record
 * to one line - and `readPermanent` below assumes exactly that.
 *
 * @param {string} dir
 * @param {object} record
 * @returns {object} the record, frozen
 */
export function appendPermanent(dir, record) {
  const path = permanentLedgerPath(dir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8" })
  return Object.freeze(record)
}

/**
 * Read every permanent record back, in append order.
 *
 * FAILS CLOSED on an unparseable line rather than skipping it. A truncated or
 * corrupted line is a fact about the ledger, not a line to drop: skipping it would
 * mean an append-only ledger silently holding fewer records than it holds lines,
 * which is exactly the audit gap D8 exists to close.
 *
 * @param {string} dir
 * @returns {ReadonlyArray<object>}
 */
export function readPermanent(dir) {
  const path = permanentLedgerPath(dir)
  if (!existsSync(path)) return Object.freeze([])
  const text = readFileSync(path, "utf8")
  if (text.trim().length === 0) return Object.freeze([])
  const records = []
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new Error(
        `copilot retention: permanent ledger ${path} has an unparseable line and cannot be read. An ` +
          "append-only ledger that skipped unreadable lines would quietly under-report its own contents. " +
          `Cause: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `copilot retention: permanent ledger ${path} holds a non-object record; append-only means every ` +
          "line is exactly one record."
      )
    }
    // Frozen on the way OUT as well as on the way in. A caller that receives a
    // mutable veto record can edit it in place, and the edit would not be visible
    // on disk - so a reader would believe a change it never persisted. Freezing
    // here makes "immutable" true of the returned object and not only of the file.
    records.push(Object.freeze(parsed))
  }
  return Object.freeze(records)
}

/** The ledger's size in bytes, or 0 when absent. Used by the dry-run proof. */
export function permanentLedgerSize(dir) {
  const path = permanentLedgerPath(dir)
  if (!existsSync(path)) return 0
  // readFileSync rather than statSync: this module's fs capability list has no
  // statSync, and the number is only ever used to prove nothing was written.
  return readFileSync(path).byteLength
}