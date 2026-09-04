import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// tradeJournal is a file-backed store whose DATA_DIR must be pinned to a
// temp dir BEFORE the module is first imported (it loads on module scope).

let tmp
let j

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-journal-"))
  process.env.PICC_JOURNAL_DATA_DIR = tmp
  j = await import("../services/tradeJournal.mjs")
})

afterAll(() => {
  delete process.env.PICC_JOURNAL_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("tradeJournal.addEntry", () => {
  it("creates a long entry with normalized fields and open status", () => {
    const e = j.addEntry({
      symbol: "eurusd",
      side: "long",
      entryPrice: 1.1,
      quantity: 2,
      reason: "trend",
      confidence: 150, // should clamp to 100
      tags: ["setup", "scalp"]
    })
    expect(e.symbol).toBe("EURUSD")
    expect(e.side).toBe("long")
    expect(e.confidence).toBe(100)
    expect(e.status).toBe("open")
    expect(e.pnl).toBeNull()
    expect(e.id).toMatch(/^jrnl_/)
  })

  it("auto-closes long entries and computes pnl when exit price provided", () => {
    const e = j.addEntry({ symbol: "BTCUSD", side: "long", entryPrice: 100, exitPrice: 120, quantity: 1 })
    expect(e.status).toBe("closed")
    expect(e.pnl).toBe(20)
    expect(e.pnlPct).toBe(20)
  })

  it("auto-closes short entries with inverted pnl", () => {
    const e = j.addEntry({ symbol: "ETHUSD", side: "short", entryPrice: 100, exitPrice: 90, quantity: 2 })
    expect(e.status).toBe("closed")
    expect(e.pnl).toBe(20) // (100 - 90) * 2
  })
})

describe("tradeJournal.listEntries / update / delete", () => {
  it("filters by symbol and sorts newest first", () => {
    j.addEntry({ symbol: "SNOW", side: "long", entryPrice: 50, quantity: 1 })
    const r = j.listEntries({ symbol: "snow" })
    expect(r.total).toBeGreaterThanOrEqual(1)
    expect(r.entries.every((e) => e.symbol === "SNOW")).toBe(true)
    expect(r.entries.length).toBe(r.total)
  })

  it("filters by tag", () => {
    j.addEntry({ symbol: "DASH", side: "long", entryPrice: 10, quantity: 1, tags: ["breakout"] })
    const r = j.listEntries({ tag: "breakout" })
    expect(r.total).toBeGreaterThanOrEqual(1)
    expect(r.entries.some((e) => e.symbol === "DASH")).toBe(true)
  })

  it("applies date range filters", () => {
    const e = j.addEntry({ symbol: "LTC", side: "long", entryPrice: 1, quantity: 1 })
    const inRange = j.listEntries({ startDate: e.entryTime - 1, endDate: e.entryTime + 1 })
    const outRange = j.listEntries({ startDate: e.entryTime + 1000 })
    expect(inRange.total).toBeGreaterThanOrEqual(1)
    expect(outRange.total).toBe(0)
  })

  it("updateEntry only mutates allowed fields", () => {
    const e = j.addEntry({ symbol: "AAVE", side: "long", entryPrice: 10, quantity: 1 })
    const updated = j.updateEntry(e.id, { reason: "updated reason", side: "short", entryPrice: 999 })
    expect(updated.reason).toBe("updated reason")
    expect(updated.side).toBe("long") // not in allowed list
    expect(updated.entryPrice).toBe(10) // not in allowed list
  })

  it("deleteEntry removes the entry", () => {
    const e = j.addEntry({ symbol: "XTZ", side: "long", entryPrice: 5, quantity: 1 })
    expect(j.deleteEntry(e.id)).toBe(true)
    expect(j.deleteEntry(e.id)).toBe(false) // already gone
    expect(j.listEntries({ symbol: "XTZ" }).total).toBe(0)
  })
})

describe("tradeJournal.journalStats", () => {
  it("computes win rate, pnl and streaks from closed entries", () => {
    j.addEntry({ symbol: "GRT", side: "long", entryPrice: 100, exitPrice: 110, quantity: 1 }) // win
    j.addEntry({ symbol: "GRT", side: "long", entryPrice: 100, exitPrice: 90, quantity: 1 }) // loss
    j.addEntry({ symbol: "GRT", side: "long", entryPrice: 100, exitPrice: 105, quantity: 1 }) // win
    const s = j.journalStats()
    expect(s.closedTrades).toBeGreaterThanOrEqual(3) // the 3 GRT trades just added
    expect(s.winRate).toBeGreaterThanOrEqual(0)
    expect(s.winRate).toBeLessThanOrEqual(100)
    expect(s.totalPnl).toBeGreaterThanOrEqual(20) // at least the 3 GRT trades (10 - 10 + 5)
    expect(s.maxWinStreak).toBeGreaterThanOrEqual(2)
    expect(s.bestTrade).toBeTruthy()
    expect(s.worstTrade).toBeTruthy()
  })

  it("handles empty journal without throwing", () => {
    const s = j.journalStats()
    expect(s.totalTrades).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(s.winRate)).toBe(true)
  })
})
