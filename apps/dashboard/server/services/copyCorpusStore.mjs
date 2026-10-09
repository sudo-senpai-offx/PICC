// Copytrading research corpus store — EXTERNAL samples only (§6).
// Structurally separate file from all owner stores; origin is set at write,
// never inferred at read. Read-only after ingest (no update path by design).
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.PICC_COPYCORPUS_DATA_DIR || join(__dirname, "..", "data")
const FILE = join(DATA_DIR, "copyCorpus.json")

let rows = []
function load() {
  try {
    if (existsSync(FILE)) {
      const p = JSON.parse(readFileSync(FILE, "utf-8"))
      rows = Array.isArray(p) ? p.filter((r) => r?.origin === "external") : []
    }
  } catch { rows = [] }
}
function save() {
  try {
    withFileLockSync(FILE, persistCorpusBody)
  } catch { /* best-effort */ }
}

// ── Per-file async write mutex — mirrors localstore.mjs withLock ──────────
// Shared promise chain per file: each writer awaits the previous holder;
// release in finally. Sync writers enter via withFileLockSync (same Map and
// discipline, synchronous fast path — identical timing and sync completion);
// genuinely async overlap chains behind the holder via withFileLock.
const fileWriteLocks = new Map()
async function withFileLock(key, fn) {
  while (fileWriteLocks.get(key)) await fileWriteLocks.get(key)
  let release
  const p = new Promise((r) => { release = r })
  fileWriteLocks.set(key, p)
  try {
    return await fn()
  } finally {
    fileWriteLocks.delete(key)
    release()
  }
}
function withFileLockSync(key, fn) {
  const held = fileWriteLocks.get(key)
  // Contended (only reachable via async overlap): chain behind the holder;
  // the tail surfaces failure exactly as a direct call would.
  if (held) return withFileLock(key, fn)
  let release
  const p = new Promise((r) => { release = r })
  fileWriteLocks.set(key, p)
  try {
    return fn()
  } finally {
    fileWriteLocks.delete(key)
    release()
  }
}

// Crash-safe persist (tmp-file + atomic rename), mirroring notifier.mjs
// (tmp+rename) with localstore.mjs ENOENT retry. The pid-unique tmp keeps
// concurrent processes from sharing a staging file. Best-effort swallow
// preserved: failures never propagate.
function persistCorpusBody() {
  const text = JSON.stringify(rows, null, 2)
  const tmp = `${FILE}.${process.pid}.tmp`
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(tmp, text)
    renameSync(tmp, FILE)
  } catch (err) {
    if (err && err.code === "ENOENT") {
      // Data dir created after import time (tests / fresh machine): ensure
      // it exists and retry once instead of silently dropping the write.
      try {
        mkdirSync(dirname(FILE), { recursive: true })
        writeFileSync(tmp, text)
        renameSync(tmp, FILE)
      } catch { /* best-effort: fall through to tmp cleanup */ }
    }
    /* best-effort swallow (existing semantics) */
  } finally {
    // Staging cleanup: noop once renamed (force ignores missing), removes a
    // truncated tmp after a crash so no stale staging file ever lingers.
    try { rmSync(tmp, { force: true }) } catch { /* already renamed */ }
  }
}
load()

const BANNED_SELECTORS = new Set(["top-pnl", "leaderboard", "best-trader", "rank"])
export function appendExternalSample(s = {}) {
  if (s?.selectBy && BANNED_SELECTORS.has(String(s.selectBy))) {
    return { ok: false, reason: "identity-selected cohorts are prohibited (§2/§4.2)" }
  }
  if (!s?.venue || !s?.accountRef) {
    return { ok: false, reason: "venue and accountRef are required" }
  }
  const record = {
    id: `ccx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    origin: "external",
    venue: String(s.venue),
    accountRef: String(s.accountRef),
    regime: s.regime != null ? String(s.regime) : null,
    stateBefore: s.stateBefore ?? null,
    sizeResponse: s.sizeResponse ?? null,
    outcomeKind: s.outcomeKind ?? null,
    windowStart: s.windowStart ?? null,
    windowEnd: s.windowEnd ?? null,
    ingestedAt: new Date().toISOString(),
  }
  rows.push(record)
  save()
  return { ok: true, record }
}

export function listExternal({ regime, limit = 100, offset = 0 } = {}) {
  let out = rows.filter((r) => r.origin === "external")
  if (regime) out = out.filter((r) => r.regime === String(regime))
  out = [...out].reverse()
  return out.slice(offset, offset + limit)
}

export function corpusCounts() {
  const accounts = new Set(rows.map((r) => `${r.venue}:${r.accountRef}`))
  return {
    nAccountsObserved: accounts.size,
    nDormant: rows.filter((r) => r.outcomeKind === "dormant").length,
    nLiquidated: rows.filter((r) => r.outcomeKind === "liquidated").length,
    windowStart: rows.reduce((a, r) => (a == null || (r.windowStart && r.windowStart < a) ? r.windowStart : a), null),
    windowEnd: rows.reduce((a, r) => (a == null || (r.windowEnd && r.windowEnd > a) ? r.windowEnd : a), null),
  }
}

export function _resetCopyCorpusForTest() { rows = [] }

// Regime-bounded minimal retention pruner (§8 decision-3, §7).
// Keeps newest-first per regime up to its target; drops oldest beyond target.
// Deletes whole records only — no update/mutate path (read-only after ingest, §6).
export function pruneToRegimeTargets(targets = {}) {
  const before = rows.length
  const byRegime = new Map()
  for (const r of rows) {
    const k = r.regime ?? "unlabelled"
    if (!byRegime.has(k)) byRegime.set(k, [])
    byRegime.get(k).push(r)
  }
  const kept = []
  for (const [regime, rs] of byRegime) {
    const max = targets[regime] ?? targets["*"] ?? rs.length
    kept.push(...rs.slice(-Math.max(0, max)))
  }
  const dropped = before - kept.length
  rows = kept
  save()
  return { ok: true, kept: kept.length, dropped, reason: null }
}
