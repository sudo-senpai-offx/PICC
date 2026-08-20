// PICC local data store — JSON-backed tables that replace the optional
// Supabase persistence layer. Every collection the app previously wrote to
// Supabase now lives in server/data/<table>.json, fully self-hosted.
import { randomBytes } from "node:crypto"
import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DATA_DIR =
  process.env.PICC_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const TABLES = new Set([
  "agent_logs",
  "human_confirmations",
  "overlay_settings",
  "content_drafts",
  "simulations",
  "listing_analyses",
  "billing",
  // v2 schema (infra/supabase/v2.sql) — income-classification model
  "financial_accounts",
  "transactions",
  "income_streams",
  "nft_holdings",
  "nft_royalty_earnings",
  "depin_nodes",
  "agent_configs",
  "agent_earnings",
  "agent_bounties",
  "predictions",
  "human_review_logs"
])

try {
  mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* already exists */
}

// ── Write lock per table — prevents concurrent JSON writes from clobbering data
const locks = new Map()
async function withLock(table, fn) {
  while (locks.get(table)) await locks.get(table)
  let release
  const p = new Promise((r) => { release = r })
  locks.set(table, p)
  try {
    return await fn()
  } finally {
    locks.delete(table)
    release()
  }
}

export function isTable(table) {
  return TABLES.has(table)
}

function fileFor(table) {
  return join(DATA_DIR, `${table}.json`)
}

async function readRows(table) {
  try {
    const raw = await readFile(fileFor(table), "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeRows(table, rows) {
  const file = fileFor(table)
  try {
    await writeFile(file, JSON.stringify(rows, null, 2), "utf8")
    return true
  } catch (err) {
    // ENOENT happens when the data dir was created after import time (tests,
    // or a fresh machine where the parent was never made). Ensure it exists
    // and retry once instead of silently dropping the write.
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(rows, null, 2), "utf8")
        return true
      } catch (retryErr) {
        console.warn(`[picc-localstore] write failed ${table}:`, retryErr.message)
        return false
      }
    }
    console.warn(`[picc-localstore] write failed ${table}:`, err.message)
    return false
  }
}

export async function listRows(table) {
  return readRows(table)
}

export async function appendRow(table, row, userId) {
  return withLock(table, async () => {
    const rows = await readRows(table)
    const entry = {
      id: row?.id ?? randomBytes(8).toString("hex"),
      created_at: new Date().toISOString(),
      user_id: userId ?? null,
      ...row
    }
    rows.push(entry)
    await writeRows(table, rows)
    return entry
  })
}

/** Replace a row with the same id (or insert it) — used for single-row-per-user settings. */
export async function upsertRow(table, row, userId) {
  return withLock(table, async () => {
    const rows = await readRows(table)
    const id = row?.id ?? randomBytes(8).toString("hex")
    const entry = { ...row, id, user_id: userId ?? null }
    const idx = rows.findIndex((r) => r.id === id)
    if (idx >= 0) rows[idx] = entry
    else rows.push(entry)
    await writeRows(table, rows)
    return entry
  })
}

export async function removeRow(table, id) {
  return withLock(table, async () => {
    const rows = await readRows(table)
    const next = rows.filter((r) => r.id !== id)
    if (next.length !== rows.length) await writeRows(table, next)
    return { removed: next.length !== rows.length }
  })
}

/**
 * Simple synchronous-style local JSON store for services that need an
 * in-memory cache with periodic persistence. Reads once on first access,
 * writes on explicit .write(). The file lives at DATA_DIR/<name>.json.
 */
const storeCache = new Map()
export function localStore(name, defaults = {}) {
  if (storeCache.has(name)) return storeCache.get(name)
  const store = { data: JSON.parse(JSON.stringify(defaults)), _dirty: false }
  // Fire-and-forget initial load (file may not exist yet — that's fine)
  const file = join(DATA_DIR, `${name}.json`)
  readFile(file, "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        store.data = { ...defaults, ...parsed }
      }
    })
    .catch(() => { /* file doesn't exist yet or is corrupt — use defaults */ })
  store.write = () => {
    try {
      writeFile(file, JSON.stringify(store.data, null, 2), "utf8").catch((err) => {
        console.warn(`[picc-localstore] localStore write failed ${name}:`, err.message)
      })
    } catch (err) {
      console.warn(`[picc-localstore] localStore write failed ${name}:`, err.message)
    }
  }
  storeCache.set(name, store)
  return store
}
