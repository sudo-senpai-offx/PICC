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

describe("tradeJournal.opening-balance (tax Task 2)", () => {
  it("stores opening-balance entries verbatim with the kind flag", () => {
    const e = j.addEntry({
      symbol: "BTC",
      quantity: 0.5,
      entryPrice: 50000,
      entryTime: "2026-01-01T00:00:00Z",
      kind: "opening-balance",
    })
    expect(e.kind).toBe("opening-balance")
    expect(e.symbol).toBe("BTC")
    expect(e.quantity).toBe(0.5)
    expect(e.entryPrice).toBe(50000)
    expect(e.entryTime).toBe(new Date("2026-01-01T00:00:00Z").getTime())
  })

  it("requires symbol/quantity/entryPrice/entryTime for opening-balance", () => {
    expect(() => j.addEntry({ symbol: "BTC", quantity: 1, entryPrice: 1, kind: "opening-balance" })).toThrow()
    expect(() => j.addEntry({ quantity: 1, entryPrice: 1, entryTime: "2026-01-01T00:00:00Z", kind: "opening-balance" })).toThrow()
  })

  it("leaves journalStats() identical with and without opening entries", () => {
    const before = j.journalStats()
    j.addEntry({ symbol: "OBSTAT", quantity: 3, entryPrice: 10, entryTime: "2026-01-01T00:00:00Z", kind: "opening-balance" })
    expect(j.journalStats()).toEqual(before)
  })

  it("listEntries filters opening entries by kind and hides them by default", () => {
    const e = j.addEntry({ symbol: "OBLIST", quantity: 1, entryPrice: 7, entryTime: "2026-01-02T00:00:00Z", kind: "opening-balance" })
    expect(j.listEntries({ kind: "opening-balance" }).entries.some((x) => x.id === e.id)).toBe(true)
    expect(j.listEntries({ symbol: "OBLIST" }).total).toBe(0)
  })
})
