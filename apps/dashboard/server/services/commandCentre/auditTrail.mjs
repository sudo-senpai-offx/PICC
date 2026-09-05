// Command Centre — append-only, hash-chained audit trail (PICC_SPEC 5A).
//
// The audit exists to make accountability provable: every mode decision, gate
// result and execution gets an entry that CANNOT be silently rewritten. Each
// entry carries the sha-256 of (its own fields + the previous entry's hash), so
// mutating any entry breaks every downstream hash — verifyAudit() walks the
// chain and reports exactly where.
//
// Always on. There is no toggle (5A execution-power separation): nothing about
// the risk configuration can mute the recorded "why".
//
// The spec says this "hooks the Tier-A verifiable ledger" — that ledger is still
// a blueprint in this repo (PICC.md §13), so this small chain is built directly
// instead of faking a hook. When blueprint A lands, the trail can fold into it.
//
// Persistence: JSONL under PICC_COMMAND_CENTRE_DATA_DIR, following the repo's
// per-service data-dir convention. Under vitest without that env var no disk is
// touched (surface stays append + verify, memory-backed).

import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const DATA_DIR =
  process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const TRAIL_FILE = join(DATA_DIR, "command-centre-audit.jsonl")

const canTouchDisk = () => process.env.VITEST !== "true" || Boolean(process.env.PICC_COMMAND_CENTRE_DATA_DIR)

/** Recursively sort object keys so serialization is order-independent. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]))
  }
  return value
}

/**
 * Deterministic serialization: recursively sorted keys, no whitespace.
 * NOTE: never pass a replacer ARRAY here — that drops every nested `data` key,
 * which would silently exclude the payload from the hash (tamper-blind chain).
 */
function canonical(entry) {
  const { hash, ...rest } = entry
  return JSON.stringify(sortKeys(rest))
}

function hashOf(entry) {
  return createHash("sha256").update(canonical(entry)).digest("hex")
}

/** In-memory chain head; boot-read from disk when permitted. */
let chain = []
let seq = 0

function boot() {
  if (!canTouchDisk() || !existsSync(TRAIL_FILE)) return
  for (const line of readFileSync(TRAIL_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue
    const entry = JSON.parse(line)
    chain.push(entry)
    seq = entry.seq
  }
}
boot()

/**
 * Append one audit event. `event` = { site, kind, data } — seq/at/prev/hash are
 * derived (append-only: callers supply no sequence and no hash).
 */
export function appendAudit(event) {
  const entry = {
    seq: seq + 1,
    at: Date.now(),
    site: event?.site ?? null,
    kind: event?.kind ?? "unknown",
    data: event?.data ?? null,
    prev: chain.length > 0 ? chain[chain.length - 1].hash : null
  }
  entry.hash = hashOf(entry)
  seq = entry.seq

  if (canTouchDisk()) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    appendFileSync(TRAIL_FILE, JSON.stringify(entry) + "\n", "utf8")
  }
  chain.push(entry)
  return entry
}

/** Read the whole trail, oldest first. */
export function readAudit() {
  return chain.map((e) => ({ ...e }))
}

/** True when the hash chain is unbroken end-to-end. */
export function verifyAudit() {
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]
    const expectedPrev = i === 0 ? null : chain[i - 1].hash
    if (entry.prev !== expectedPrev) return { ok: false, brokenAt: entry.seq, reason: "prev-hash mismatch" }
    if (hashOf(entry) !== entry.hash) return { ok: false, brokenAt: entry.seq, reason: "entry hash mismatch" }
  }
  return { ok: true, brokenAt: null, reason: null }
}

/** Test seam only — wipe in-memory chain (and the disk file when permitted). */
export function _resetAuditTrail() {
  chain = []
  seq = 0
  if (canTouchDisk()) rmSync(TRAIL_FILE, { force: true })
}