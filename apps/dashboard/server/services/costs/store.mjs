// Costs store — per-fill cost records + daily per-venue rollups.
//
// Design W3-02 decision 6: fills kept 90 days rolling, daily rollups 2 years.
// Honesty contract (design §4): every number carries measured | modeled |
// modeled-with-calibrated-inputs provenance; absent data is an absent row
// with a reason, never a zero. Pruning runs on write, so a reader never
// observes a record older than the retention window.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.PICC_COSTS_DATA_DIR || join(__dirname, "..", "..", "data")
const COSTS_FILE = join(DATA_DIR, "costs.json")

const PROVENANCE = new Set(["measured", "modeled", "modeled-with-calibrated-inputs"])

const DAY_MS = 86_400_000
export const FILL_RETENTION_MS = 90 * DAY_MS
export const ROLLUP_RETENTION_MS = 730 * DAY_MS

function snapshotTz() {
  return process.env.PICC_SNAPSHOT_TZ || "Asia/Singapore"
}

function tzDateFor(at) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: snapshotTz() }).format(new Date(at))
}

let fills = []
let rollups = []

function load() {
  try {
    if (!existsSync(COSTS_FILE)) return
    const doc = JSON.parse(readFileSync(COSTS_FILE, "utf-8"))
    if (Array.isArray(doc.fills)) fills = doc.fills
    if (Array.isArray(doc.rollups)) rollups = doc.rollups
  } catch { /* best-effort: keep empty in-memory state */ }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(COSTS_FILE, JSON.stringify({ fills, rollups }, null, 2))
  } catch { /* ignore */ }
}

function prune({ now = Date.now() } = {}) {
  const fillCutoff = Number(now) - FILL_RETENTION_MS
  const rollupCutoff = Number(now) - ROLLUP_RETENTION_MS
  fills = fills.filter((f) => Date.parse(f.observedAt) >= fillCutoff)
  rollups = rollups.filter((r) => new Date(r.at).getTime() >= rollupCutoff)
}

load()

export function recordFillCost({ venue, route, kind, amountUsd, ccy, fxSource = null, fxAt = null, provenance, observedAt = null } = {}) {
  if (!Number.isFinite(Number(amountUsd))) {
    return { ok: false, reason: "fill-amount-not-finite" }
  }
  if (!PROVENANCE.has(provenance)) {
    return { ok: false, reason: `invalid-provenance:${provenance}` }
  }
  const record = {
    id: `cost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    venue,
    route,
    kind,
    amountUsd: Number(amountUsd),
    ccy,
    fxSource,
    fxAt,
    provenance,
    observedAt: observedAt ? new Date(observedAt).toISOString() : new Date().toISOString()
  }
  fills.push(record)
  prune()
  save()
  return { ok: true, record: { ...record } }
}

export function listFillCosts({ venue, since, limit = 500 } = {}) {
  let result = [...fills]
  if (venue !== undefined) result = result.filter((f) => f.venue === venue)
  if (since !== undefined && since !== null && since !== "") {
    result = result.filter((f) => Date.parse(f.observedAt) >= Date.parse(since))
  }
  result.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
  return result.slice(0, limit).map((f) => ({ ...f }))
}

export function rollupDay({ date, venue, totals } = {}) {
  const rollup = {
    at: new Date(date).toISOString(),
    venue,
    totals: totals && typeof totals === "object" ? { ...totals } : {},
    tzDate: tzDateFor(date)
  }
  const idx = rollups.findIndex((r) => r.tzDate === rollup.tzDate && r.venue === venue)
  if (idx === -1) rollups.push(rollup)
  else rollups[idx] = rollup
  prune()
  save()
  return { ...rollup }
}

export function listRollups({ venue, limit = 730 } = {}) {
  let result = [...rollups]
  if (venue !== undefined) result = result.filter((r) => r.venue === venue)
  result.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  return result.slice(0, limit).map((r) => ({ ...r, totals: { ...r.totals } }))
}

export function _resetCostsForTest() {
  fills = []
  rollups = []
  save()
}
