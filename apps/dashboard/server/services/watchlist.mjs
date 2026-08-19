// Watchlist service — CRUD for watchlists + screener with multi-criteria filtering.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { getHistory } from "./yahoo.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, "..", "data")
const WATCHLISTS_FILE = join(DATA_DIR, "watchlists.json")

let watchlists = []
let pricesCache = new Map()

function load() {
  try {
    if (existsSync(WATCHLISTS_FILE)) {
      watchlists = JSON.parse(readFileSync(WATCHLISTS_FILE, "utf-8"))
    }
  } catch { watchlists = [] }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(WATCHLISTS_FILE, JSON.stringify(watchlists, null, 2))
  } catch { /* ignore */ }
}

load()

// ── Watchlist CRUD ────────────────────────────────────────────────────
export function listWatchlists() {
  return [...watchlists]
}

export function getWatchlist(id) {
  return watchlists.find((w) => w.id === id) ?? null
}

export function createWatchlist({ name, symbols = [] }) {
  const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const wl = { id, name: String(name || "New Watchlist"), symbols: symbols.map((s) => String(s).toUpperCase()), createdAt: Date.now(), updatedAt: Date.now() }
  watchlists.push(wl)
  save()
  return wl
}

export function updateWatchlist(id, { name, symbols }) {
  const wl = watchlists.find((w) => w.id === id)
  if (!wl) return null
  if (name !== undefined) wl.name = String(name)
  if (symbols !== undefined) wl.symbols = symbols.map((s) => String(s).toUpperCase())
  wl.updatedAt = Date.now()
  save()
  return wl
}

export function deleteWatchlist(id) {
  const idx = watchlists.findIndex((w) => w.id === id)
  if (idx === -1) return false
  watchlists.splice(idx, 1)
  save()
  return true
}

export function addToWatchlist(id, symbol) {
  const wl = watchlists.find((w) => w.id === id)
  if (!wl) return null
  const sym = String(symbol).toUpperCase()
  if (!wl.symbols.includes(sym)) wl.symbols.push(sym)
  wl.updatedAt = Date.now()
  save()
  return wl
}

export function removeFromWatchlist(id, symbol) {
  const wl = watchlists.find((w) => w.id === id)
  if (!wl) return null
  wl.symbols = wl.symbols.filter((s) => s !== String(symbol).toUpperCase())
  wl.updatedAt = Date.now()
  save()
  return wl
}

// ── Price fetch for watchlist symbols ─────────────────────────────────
export async function fetchWatchlistPrices(symbols) {
  const results = []
  for (const sym of symbols) {
    try {
      const hist = await getHistory(String(sym).toUpperCase(), 30)
      if (hist && hist.closes && hist.closes.length >= 2) {
        const last = hist.closes[hist.closes.length - 1]
        const prev = hist.closes[hist.closes.length - 2]
        const weekAgo = hist.closes[Math.max(0, hist.closes.length - 6)]
        const monthAgo = hist.closes[0]
        results.push({
          symbol: String(sym).toUpperCase(),
          last,
          change24h: Math.round(((last - prev) / prev) * 10000) / 100,
          changeWeek: Math.round(((last - weekAgo) / weekAgo) * 10000) / 100,
          changeMonth: Math.round(((last - monthAgo) / monthAgo) * 10000) / 100,
          high30d: Math.max(...hist.highs),
          low30d: Math.min(...hist.lows),
          volume: hist.volumes?.[hist.volumes.length - 1] ?? 0
        })
      }
    } catch { /* skip */ }
  }
  return results
}

// ── Screener ──────────────────────────────────────────────────────────
const UNIVERSE = [
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
  "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "EURAUD",
  "GOLD", "SILVER", "OIL", "NATGAS",
  "BTCUSD", "ETHUSD", "SOLUSD", "ADAUSD",
  "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "JNJ"
]

export async function screenerRun({ sort = "change24h", limit = 20, minChange, maxChange, symbols } = {}) {
  const universe = symbols && symbols.length ? symbols.map((s) => String(s).toUpperCase()) : UNIVERSE
  const all = await fetchWatchlistPrices(universe)

  let filtered = [...all]
  if (minChange != null) filtered = filtered.filter((a) => a.change24h >= minChange)
  if (maxChange != null) filtered = filtered.filter((a) => a.change24h <= maxChange)

  // Sort
  const validSorts = ["symbol", "last", "change24h", "changeWeek", "changeMonth", "volume"]
  const sortKey = validSorts.includes(sort) ? sort : "change24h"
  filtered.sort((a, b) => {
    if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol)
    return (b[sortKey] ?? 0) - (a[sortKey] ?? 0)
  })

  return { results: filtered.slice(0, limit), total: filtered.length, universe: universe.length }
}
