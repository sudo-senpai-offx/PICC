// Trade journal — logs every trade with entry/exit, reason, confidence, tags, notes.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, "..", "data")
const JOURNAL_FILE = join(DATA_DIR, "tradeJournal.json")

let entries = []

function load() {
  try {
    if (existsSync(JOURNAL_FILE)) entries = JSON.parse(readFileSync(JOURNAL_FILE, "utf-8"))
  } catch { entries = [] }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(JOURNAL_FILE, JSON.stringify(entries, null, 2))
  } catch { /* ignore */ }
}

load()

export function listEntries({ symbol, tag, limit = 50, offset = 0, startDate, endDate } = {}) {
  let result = [...entries]
  if (symbol) result = result.filter((e) => e.symbol === String(symbol).toUpperCase())
  if (tag) result = result.filter((e) => e.tags?.includes(tag))
  if (startDate) result = result.filter((e) => e.entryTime >= startDate)
  if (endDate) result = result.filter((e) => e.entryTime <= endDate)
  result.sort((a, b) => b.entryTime - a.entryTime)
  return { entries: result.slice(offset, offset + limit), total: result.length }
}

export function addEntry({
  symbol, side, entryPrice, exitPrice = null, quantity = 1,
  reason = "", confidence = 0, strategy = "", tags = [], notes = "",
  timeframe = "", pattern = "", entryTime = null, exitTime = null
}) {
  const id = `jrnl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const entry = {
    id,
    symbol: String(symbol).toUpperCase(),
    side: String(side).toLowerCase(), // "long" | "short"
    entryPrice: Number(entryPrice),
    exitPrice: exitPrice != null ? Number(exitPrice) : null,
    quantity: Number(quantity),
    reason: String(reason),
    confidence: Math.min(Math.max(Number(confidence), 0), 100),
    strategy: String(strategy),
    tags: Array.isArray(tags) ? tags.map((t) => String(t)) : [],
    notes: String(notes),
    timeframe: String(timeframe),
    pattern: String(pattern),
    entryTime: entryTime ? new Date(entryTime).getTime() : Date.now(),
    exitTime: exitTime ? new Date(exitTime).getTime() : null,
    pnl: null,
    pnlPct: null,
    rMultiple: null,
    status: "open", // open | closed
    createdAt: Date.now()
  }

  // Auto-calculate PnL if exit price provided
  if (entry.exitPrice != null) {
    entry.status = "closed"
    entry.exitTime = entry.exitTime || Date.now()
    if (entry.side === "long") {
      entry.pnl = (entry.exitPrice - entry.entryPrice) * entry.quantity
      entry.pnlPct = entry.entryPrice > 0 ? ((entry.exitPrice - entry.entryPrice) / entry.entryPrice) * 100 : 0
    } else {
      entry.pnl = (entry.entryPrice - entry.exitPrice) * entry.quantity
      entry.pnlPct = entry.entryPrice > 0 ? ((entry.entryPrice - entry.exitPrice) / entry.entryPrice) * 100 : 0
    }
    // R-multiple based on risk (1% of entry as 1R)
    const riskAmount = entry.entryPrice * 0.01 * entry.quantity
    entry.rMultiple = riskAmount > 0 ? entry.pnl / riskAmount : 0
  }

  entries.push(entry)
  save()
  return entry
}

export function closeEntry(id, { exitPrice, exitTime = null, notes = "" } = {}) {
  const entry = entries.find((e) => e.id === id)
  if (!entry) return null
  entry.exitPrice = Number(exitPrice)
  entry.exitTime = exitTime ? new Date(exitTime).getTime() : Date.now()
  entry.status = "closed"
  if (notes) entry.notes = notes
  if (entry.side === "long") {
    entry.pnl = (entry.exitPrice - entry.entryPrice) * entry.quantity
    entry.pnlPct = entry.entryPrice > 0 ? ((entry.exitPrice - entry.entryPrice) / entry.entryPrice) * 100 : 0
  } else {
    entry.pnl = (entry.entryPrice - entry.exitPrice) * entry.quantity
    entry.pnlPct = entry.entryPrice > 0 ? ((entry.entryPrice - entry.exitPrice) / entry.entryPrice) * 100 : 0
  }
  const riskAmount = entry.entryPrice * 0.01 * entry.quantity
  entry.rMultiple = riskAmount > 0 ? entry.pnl / riskAmount : 0
  save()
  return entry
}

export function updateEntry(id, updates) {
  const entry = entries.find((e) => e.id === id)
  if (!entry) return null
  const allowed = ["reason", "confidence", "strategy", "tags", "notes", "pattern", "timeframe"]
  for (const key of allowed) {
    if (updates[key] !== undefined) entry[key] = updates[key]
  }
  save()
  return entry
}

export function deleteEntry(id) {
  const idx = entries.findIndex((e) => e.id === id)
  if (idx === -1) return false
  entries.splice(idx, 1)
  save()
  return true
}

export function journalStats() {
  const closed = entries.filter((e) => e.status === "closed")
  const open = entries.filter((e) => e.status === "open")
  const wins = closed.filter((e) => (e.pnl ?? 0) > 0)
  const losses = closed.filter((e) => (e.pnl ?? 0) < 0)

  const totalPnl = closed.reduce((s, e) => s + (e.pnl ?? 0), 0)
  const avgWin = wins.length ? wins.reduce((s, e) => s + e.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((s, e) => s + e.pnl, 0) / losses.length : 0
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin * wins.length) / Math.abs(avgLoss * losses.length) : 0
  const avgRMultiple = closed.length ? closed.reduce((s, e) => s + (e.rMultiple ?? 0), 0) / closed.length : 0

  // Best/worst
  const best = closed.length ? [...closed].sort((a, b) => b.pnl - a.pnl)[0] : null
  const worst = closed.length ? [...closed].sort((a, b) => a.pnl - b.pnl)[0] : null

  // Streak
  let winStreak = 0, lossStreak = 0, maxWinStreak = 0, maxLossStreak = 0
  for (const e of closed) {
    if ((e.pnl ?? 0) > 0) { winStreak++; lossStreak = 0; maxWinStreak = Math.max(maxWinStreak, winStreak) }
    else { lossStreak++; winStreak = 0; maxLossStreak = Math.max(maxLossStreak, lossStreak) }
  }

  // By strategy
  const byStrategy = {}
  for (const e of closed) {
    const key = e.strategy || "unclassified"
    if (!byStrategy[key]) byStrategy[key] = { count: 0, pnl: 0, wins: 0 }
    byStrategy[key].count++
    byStrategy[key].pnl += e.pnl ?? 0
    if ((e.pnl ?? 0) > 0) byStrategy[key].wins++
  }
  for (const k of Object.keys(byStrategy)) {
    byStrategy[k].winRate = byStrategy[k].count > 0 ? Math.round((byStrategy[k].wins / byStrategy[k].count) * 10000) / 100 : 0
  }

  // By symbol
  const bySymbol = {}
  for (const e of closed) {
    const key = e.symbol
    if (!bySymbol[key]) bySymbol[key] = { count: 0, pnl: 0, wins: 0 }
    bySymbol[key].count++
    bySymbol[key].pnl += e.pnl ?? 0
    if ((e.pnl ?? 0) > 0) bySymbol[key].wins++
  }

  return {
    totalTrades: entries.length,
    openTrades: open.length,
    closedTrades: closed.length,
    winRate: closed.length > 0 ? Math.round((wins.length / closed.length) * 10000) / 100 : 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgRMultiple: Math.round(avgRMultiple * 100) / 100,
    maxWinStreak,
    maxLossStreak,
    bestTrade: best ? { symbol: best.symbol, pnl: best.pnl } : null,
    worstTrade: worst ? { symbol: worst.symbol, pnl: worst.pnl } : null,
    byStrategy,
    bySymbol
  }
}
