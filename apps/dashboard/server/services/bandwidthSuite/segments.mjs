// M1 — Bandwidth Suite: IP-segment registry + one-provider-per-segment validator
// (PICC_BANDWIDTH_SUITE_design_v1 §3 M1, Phase A).
//
// Honest contract: a segment carries at most ONE sharing provider. A second
// provider hitting an occupied segment is REFUSED with a typed
// SegmentOccupiedError — the ban pattern is never warned-and-allowed.
// Unconfigured = provider null / status idle / connectionState unknown; we do
// not fabricate values.
//
// Persistence mirrors the repo conventions: one JSON file under
// PICC_BANDWIDTH_DATA_DIR (the same env-override idiom as
// PICC_COMMAND_CENTRE_DATA_DIR), memory-backed under vitest unless the override
// grants disk; atomic tmp+rename with localstore's bounded Windows rename-retry
// (EPERM/EACCES while a concurrent reader holds the file) and a direct-write
// fallback so a snapshot is never silently dropped.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const SEGMENT_KINDS = ["mobile", "broadband", "vps"]
export const CONNECTION_STATES = ["unknown", "establishing", "stable", "unstable", "down"]

const DATA_DIR =
  process.env.PICC_BANDWIDTH_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const STORE_FILE = join(DATA_DIR, "bandwidth-segments.json")

const canTouchDisk = () =>
  process.env.VITEST !== "true" || Boolean(process.env.PICC_BANDWIDTH_DATA_DIR)

/** Typed failure: registering a segment id that already exists. */
export class SegmentExistsError extends Error {
  constructor(message) {
    super(message)
    this.name = "SegmentExistsError"
  }
}

/** Typed failure: assigning a second provider to an occupied segment (the ban-pattern gate). */
export class SegmentOccupiedError extends Error {
  constructor(message) {
    super(message)
    this.name = "SegmentOccupiedError"
  }
}

/** [{ segmentId, kind, provider, status, connectionState }] */
let segments = []

function boot() {
  if (!canTouchDisk() || !existsSync(STORE_FILE)) return
  let parsed
  try {
    parsed = JSON.parse(readFileSync(STORE_FILE, "utf8"))
  } catch {
    // Unreadable store -> boot EMPTY. Segments are user-declared facts, not
    // safety switches: an unreadable store must not invent segments (honesty),
    // and there is no fail-open hazard to guard against.
    segments = []
    console.warn(`[picc-bandwidth] unreadable segment store ${STORE_FILE}; booted empty`)
    return
  }
  segments = Array.isArray(parsed) ? parsed : []
}
boot()

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** localstore's bounded Windows rename-retry, sync variant (see localstore.mjs:195). */
function renameWithRetry(tmp, file, snapshot, attempts = 25, delayMs = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      renameSync(tmp, file)
      return
    } catch (err) {
      if (err && (err.code === "EPERM" || err.code === "EACCES")) {
        sleepSync(delayMs)
        continue
      }
      throw err // not a lock — surface it
    }
  }
  console.warn(`[picc-bandwidth] rename lock never cleared for ${file}; writing directly`)
  writeFileSync(file, snapshot, "utf8")
}

function persist() {
  if (!canTouchDisk()) return
  const payload = JSON.stringify(segments, null, 2)
  const tmp = `${STORE_FILE}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, payload, "utf8")
    try {
      renameWithRetry(tmp, STORE_FILE, payload)
    } catch (err) {
      if (err && err.code === "ENOENT") {
        mkdirSync(dirname(STORE_FILE), { recursive: true })
        renameWithRetry(tmp, STORE_FILE, payload)
      } else {
        throw err
      }
    }
  } catch (err) {
    console.warn(`[picc-bandwidth] write failed ${STORE_FILE}:`, err.message)
    try {
      unlinkSync(tmp)
    } catch {
      /* already gone */
    }
  }
}

function findSegment(segmentId) {
  return segments.find((s) => s.segmentId === segmentId) ?? null
}

/** Snapshot of every registered segment (copies, never live references). */
export function listSegments() {
  return segments.map((s) => ({ ...s }))
}

/** One segment by id, or null when it does not exist. */
export function getSegment(segmentId) {
  const segment = findSegment(segmentId)
  return segment ? { ...segment } : null
}

/**
 * Declare an IP segment. Refuses duplicates (SegmentExistsError) and anything
 * outside { mobile, broadband, vps }. New segments start UNCONFIGURED:
 * provider null, status "idle", connectionState "unknown".
 */
export function registerSegment({ segmentId, kind } = {}) {
  const id = typeof segmentId === "string" ? segmentId.trim() : ""
  if (!id) throw new Error("segmentId required (non-empty string)")
  if (!SEGMENT_KINDS.includes(kind)) {
    throw new Error(`invalid segment kind "${kind}" — must be one of ${SEGMENT_KINDS.join(", ")}`)
  }
  if (findSegment(id)) {
    throw new SegmentExistsError(`segment "${id}" is already registered`)
  }
  const segment = { segmentId: id, kind, provider: null, status: "idle", connectionState: "unknown" }
  segments.push(segment)
  persist()
  return { ...segment }
}

/**
 * Assign the ONE sharing provider a segment may carry. A different provider
 * hitting an occupied segment throws SegmentOccupiedError (refused, never
 * warned-and-allowed). Re-assigning the same provider is idempotent.
 */
export function assignProvider(segmentId, provider) {
  const segment = findSegment(segmentId)
  if (!segment) throw new Error(`unknown segment "${segmentId}"`)
  const pid = typeof provider === "string" ? provider.trim() : ""
  if (!pid) throw new Error("provider required (non-empty string)")
  if (segment.provider !== null && segment.provider !== pid) {
    throw new SegmentOccupiedError(
      `segment "${segmentId}" already carries provider "${segment.provider}" — one provider per segment`
    )
  }
  segment.provider = pid
  segment.status = "active"
  persist()
  return { ...segment }
}

/**
 * Record an OBSERVED connection state (unknown | establishing | stable |
 * unstable | down. Gibberish throws — the state machine must not invent states.
 * M4's kill-switch will be the consumer of these transitions.
 */
export function setConnectionState(segmentId, connectionState) {
  const segment = findSegment(segmentId)
  if (!segment) throw new Error(`unknown segment "${segmentId}"`)
  if (!CONNECTION_STATES.includes(connectionState)) {
    throw new Error(
      `invalid connectionState "${connectionState}" — must be one of ${CONNECTION_STATES.join(", ")}`
    )
  }
  segment.connectionState = connectionState
  persist()
  return { ...segment }
}