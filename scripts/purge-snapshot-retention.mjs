#!/usr/bin/env node
// WS-7 T15 - the snapshot purge CLI. T15:1330's "purge job", and T15:1334's
// bisect line made usable from a shell.
//
//   T15:1334  "The purge job can be dry-run against a fixture without touching
//              production data."
//
// WHAT A BARE INVOCATION DOES, EXACTLY:
//
//   node scripts/purge-snapshot-retention.mjs
//     -> usage, exit 1, nothing opened, nothing written.
//
// NOT a dry-run against "no store", and NOT a dry-run against a guessed path. There
// is no default `--store-dir`, because a default is the mechanism behind the
// incident `ws7TestStoreIsolation.test.mjs` was built from: every pre-existing store
// in this repository falls back to the live `server/data` when its variable is unset
// or misspelled, and both cases are indistinguishable. This CLI has no such
// fallback, so an invocation without `--store-dir` cannot touch a store it was not
// told about.
//
// THE TWO KEYS, and why a bare `--execute` is still not enough:
//
//   1. `--execute`   the verb. Without it the run is a dry-run, which is also the
//                    default when the flag is absent entirely.
//   2. `--confirm <PURGE_CONFIRMATION_TOKEN>`  the token, compared for exact
//                    equality inside `runSnapshotPurge`. A flag an operator can type
//                    by habit is not a second key, so the token is 37 characters of
//                    shouting that nobody types without reading.
//
// A third guard lives in the store constructor and is not reachable from here at
// all: a store inside `apps/dashboard/server/` cannot be built as a purge target,
// so `--execute` against one is refused by `assertPurgeTargetAllowed` before this
// script has read a record.
//
// THE CLOCK. `--now` is accepted so a run is reproducible; without it this is the
// one place a clock is read, and the resolved value is printed in the output and
// recorded on every cutover record as `recordedAt`.

import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

import {
  PURGE_CONFIRMATION_TOKEN,
  planSnapshotPurge,
  runSnapshotPurge
} from "../apps/dashboard/server/services/copilot/purgeSnapshots.mjs"
import { createRetentionStore } from "../apps/dashboard/server/services/copilot/retentionStore.mjs"
import { SNAPSHOT_RETENTION_DAYS, TRANSFORM_VERSION } from "../apps/dashboard/server/services/copilot/retention.mjs"

const SELF = fileURLToPath(import.meta.url)

const USAGE = `WS-7 T15 - raw market snapshot retention purge (D8)

USAGE
  node scripts/purge-snapshot-retention.mjs --store-dir <absolute path> --run-id <id> [options]

REQUIRED
  --store-dir <path>   The retention store directory. There is NO default and no
                       fallback to server/data: an invocation without this opens
                       nothing.
  --run-id <id>        Identifies the run, and travels on every cutover record.

OPTIONS
  --now <epoch ms>     Cutoff reference. Omit to use the current clock; the
                       resolved value is printed and recorded on each cutover.
  --execute            Actually purge. WITHOUT this the run is a DRY-RUN, which is
                       also what a bare invocation with the two required flags does.
  --confirm <token>    Required with --execute. Must equal, exactly:
                         ${PURGE_CONFIRMATION_TOKEN}
  --json               Emit the plan as JSON instead of prose.
  --help               This text.

WHAT A REAL RUN DOES, IN ORDER
  1. Appends one permanent daily aggregate per expired (UTC day, instrument).
  2. Appends one permanent retention_cutover record per window: count, class,
     window, removed digest, aggregate id and digest.
  3. Rewrites the raw snapshot segment without the expired rows. This is the only
     rewrite, it happens LAST, and it targets the raw class only.

WHAT A REAL RUN CANNOT DO
  * Touch a permanent record. Veto decisions, score breakdowns, execution
    receipts, daily aggregates and cutover records live in one append-only file
    whose only writer holds an append-only filesystem capability; there is no
    update or delete path to call.
  * Run against apps/dashboard/server/. A purgeable store is refused there.
  * Reconstruct the data it removed. The aggregate carries no sample identity, so
    two different expired days with disjoint snapshot ids produce a byte-identical
    aggregate and the deleted raw rows are unrecoverable from it.
`

/** Minimal `--flag value` parser. Rejects unknown flags rather than ignoring them. */
export function parseArgs(argv) {
  const FLAGS = new Set(["--store-dir", "--run-id", "--now", "--confirm"])
  const SWITCHES = new Set(["--execute", "--json", "--help"])
  const out = { storeDir: null, runId: null, now: null, confirm: null, execute: false, json: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (SWITCHES.has(arg)) {
      if (arg === "--execute") out.execute = true
      else if (arg === "--json") out.json = true
      else out.help = true
      continue
    }
    if (!FLAGS.has(arg)) {
      throw new Error(`unknown argument ${JSON.stringify(arg)}. Known flags: ${[...FLAGS, ...SWITCHES].sort().join(", ")}`)
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`)
    }
    i += 1
    if (arg === "--store-dir") out.storeDir = value
    else if (arg === "--run-id") out.runId = value
    else if (arg === "--now") {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) throw new Error(`--now must be an epoch millisecond number; received ${JSON.stringify(value)}`)
      out.now = parsed
    } else out.confirm = value
  }
  return out
}

/** Prose report for a dry-run or a real run. Says plainly which one it was. */
export function formatReport({ dryRun, wrote, plan, purgeResult }) {
  const lines = []
  lines.push(dryRun ? "WS-7 T15 snapshot purge - DRY RUN (nothing was written)" : "WS-7 T15 snapshot purge - EXECUTED")
  lines.push(`  store dir            ${plan.storeDir}`)
  lines.push(`  run id               ${plan.runId}`)
  lines.push(`  now                  ${plan.now}`)
  lines.push(`  retention window     ${plan.retentionDays} days (${TRANSFORM_VERSION})`)
  lines.push(`  permanent records    ${plan.permanentCount} verified untouched`)
  lines.push(`  raw snapshots        ${plan.expiredCount + plan.retainedCount} total`)
  lines.push(`  would remove         ${plan.expiredCount}`)
  lines.push(`  would retain         ${plan.retainedCount}`)
  if (plan.expiredCount === 0) {
    lines.push("  nothing is due for the 90-day transform")
  } else {
    lines.push("")
    lines.push("  expired windows:")
    for (const window of plan.buckets) {
      lines.push(`    ${window.bucket}  ${window.symbol}  ${window.count} snapshot(s)`)
    }
    lines.push("")
    lines.push("  cutover records a real run would append (permanent, append-only):")
    for (const cutover of plan.cutovers) {
      lines.push(`    ${cutover.cutoverId}  ${cutover.bucket} ${cutover.symbol}  removed=${cutover.removedCount}`)
      lines.push(`      window            ${new Date(cutover.windowStart).toISOString()} .. ${new Date(cutover.windowEnd).toISOString()}`)
      lines.push(`      removedDigest     ${cutover.removedDigest}`)
      lines.push(`      aggregate         ${cutover.aggregateId} (${cutover.aggregateDigest})`)
      lines.push(`      retentionClass    ${cutover.retentionClass}`)
    }
    lines.push("")
    lines.push("  snapshots a real run would REMOVE, permanently:")
    for (const id of plan.expiredSnapshotIds) lines.push(`    ${id}`)
  }
  if (!dryRun) {
    lines.push("")
    lines.push(`  wrote                ${wrote}`)
    if (purgeResult) {
      lines.push(`  removed              ${purgeResult.removed} across ${purgeResult.buckets} window(s)`)
      lines.push(`  retained             ${purgeResult.retained}`)
      lines.push(`  aggregates appended  ${purgeResult.aggregates}`)
      lines.push(`  cutovers appended    ${purgeResult.cutovers}`)
    }
  } else {
    lines.push("")
    lines.push(`  To execute: re-run with --execute --confirm ${PURGE_CONFIRMATION_TOKEN}`)
  }
  return lines.join("\n")
}

export function main(argv, { now = () => Date.now(), stdout = console.log, stderr = console.error } = {}) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    stderr(`purge-snapshot-retention: ${error instanceof Error ? error.message : String(error)}`)
    stderr(USAGE)
    return 2
  }

  if (args.help || argv.length === 0) {
    stdout(USAGE)
    return argv.length === 0 ? 1 : 0
  }

  const missing = []
  if (args.storeDir === null) missing.push("--store-dir")
  if (args.runId === null) missing.push("--run-id")
  if (missing.length > 0) {
    stderr(`purge-snapshot-retention: missing required flag(s): ${missing.join(", ")}.`)
    stderr("There is no default store directory, so nothing was opened and nothing was written.")
    stderr(USAGE)
    return 1
  }

  try {
    // The store is built BEFORE the verb is considered, so the tree refusal applies
    // to a dry-run too - a dry-run of a store this module will never purge is a plan
    // about a hypothetical.
    const store = createRetentionStore({ dir: resolve(args.storeDir), purge: true })
    const now = args.now === null ? now() : args.now
    const result = args.execute
      ? runSnapshotPurge({ store, now, runId: args.runId, dryRun: false, confirmation: args.confirm })
      : runSnapshotPurge({ store, now, runId: args.runId })

    const plan = { ...result.plan, storeDir: store.dir }
    if (args.json) {
      stdout(JSON.stringify({ dryRun: result.dryRun, wrote: result.wrote, plan, purgeResult: result.purgeResult }, null, 2))
    } else {
      stdout(formatReport({ ...result, plan }))
    }
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr(`purge-snapshot-retention: ${message}`)
    return 1
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(SELF)
if (isEntryPoint) {
  process.exitCode = main(process.argv.slice(2))
}