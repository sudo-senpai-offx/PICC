// Copytrading research corpus store — EXTERNAL samples only (§6).
// Structurally separate file from all owner stores; origin is set at write,
// never inferred at read. Read-only after ingest (no update path by design).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
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
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(rows, null, 2))
  } catch { /* best-effort */ }
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
