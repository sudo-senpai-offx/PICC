import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir = null
const today = new Date().toISOString().slice(0, 10)

async function boot(fixtures = {}) {
  dir = await mkdtemp(join(tmpdir(), "picc-posmgr-"))
  process.env.PICC_TRADING_DATA_DIR = dir
  if (fixtures.ledger) {
    await writeFile(join(dir, "trading-ledger.json"), JSON.stringify(fixtures.ledger), "utf8")
  }
  if (fixtures.deals) {
    await writeFile(join(dir, "trading-demo-deals.json"), JSON.stringify(fixtures.deals), "utf8")
  }
  vi.resetModules()
  return import("../services/positionManager.mjs")
}

afterEach(async () => {
  delete process.env.PICC_TRADING_DATA_DIR
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe("positionManager (slice 5d coverage)", () => {
  test("aggregateOpenPositions folds open paper positions with honest totals", async () => {
    const pm = await boot({
      ledger: {
        positions: [
          { id: "p1", symbol: "BTCUSD", side: "up", entry: 100, amount: 2, status: "open", openedAt: today },
          { id: "p2", symbol: "BTCUSD", side: "down", entry: 90, amount: 3, status: "open", openedAt: today },
          { id: "p3", symbol: "ETHUSD", side: "up", entry: 50, amount: 1, status: "closed", openedAt: today }
        ]
      }
    })
    const agg = await pm.aggregateOpenPositions()
    expect(agg.ok).toBe(true)
    expect(agg.positions).toHaveLength(2) // closed p3 excluded
    expect(agg.totals).toEqual({ openPositions: 2, notional: 5, instruments: 1 })
    const btc = agg.byInstrument.BTCUSD
    expect(btc.totalSize).toBe(5)
    expect(btc.avgEntry).toBe(94) // (100*2 + 90*3) / 5
    expect(btc.hedged).toBe(true)
    expect(agg.venues).toEqual([{ venue: "paper", totalSize: 5, positions: 2 }])
  })

  test("combinedTodayPnl keeps today's closed paper trades and settled deals in SEPARATE buckets (B-PAP-2)", async () => {
    const pm = await boot({
      ledger: { closed: [{ pnl: 5, closedAt: `${today}T10:00:00Z` }, { pnl: -2, closedAt: "2020-01-01T00:00:00Z" }] },
      deals: { deals: [{ profit: 7, closedAt: `${today}T11:00:00Z` }, { profit: -3, closedAt: "2020-01-01T00:00:00Z" }] }
    })
    const pnl = await pm.combinedTodayPnl()
    expect(pnl.paper).toEqual({ pnl: 5, trades: 1 })
    expect(pnl.expertoption).toEqual({ pnl: 7, trades: 1 })
    // The merged `total` slice is removed: paper and venue-demo money are
    // never summed on any shared surface.
    expect(pnl).not.toHaveProperty("total")
  })

  test("portfolioRiskCheck refuses over-cap proposals", async () => {
    const pm = await boot({
      ledger: { positions: [{ id: "p1", symbol: "BTCUSD", side: "up", entry: 100, amount: 40000, status: "open" }] }
    })
    const over = await pm.portfolioRiskCheck({ symbol: "BTCUSD", amount: 20000, maxNotional: 50000 })
    expect(over.allowed).toBe(false)
    expect(over.warnings.some((w) => w.includes("exceed the 50000 cap"))).toBe(true)
    expect(over.after.totalNotional).toBe(60000)
  })

  test("portfolioRiskCheck flags instruments carrying offsetting up/down legs", async () => {
    const pm = await boot({
      ledger: {
        positions: [
          { id: "p1", symbol: "BTCUSD", side: "up", entry: 100, amount: 2, status: "open" },
          { id: "p2", symbol: "BTCUSD", side: "down", entry: 90, amount: 3, status: "open" }
        ]
      }
    })
    const check = await pm.portfolioRiskCheck({ symbol: "BTCUSD", amount: 1 })
    expect(check.warnings.some((w) => w.includes("offsetting up/down legs"))).toBe(true)
    expect(check.exposureByInstrument.BTCUSD).toBe(5)
  })

  test("empty stores report zero rather than fabricated state", async () => {
    const pm = await boot()
    const agg = await pm.aggregateOpenPositions()
    expect(agg.totals).toEqual({ openPositions: 0, notional: 0, instruments: 0 })
    const pnl = await pm.combinedTodayPnl()
    expect(pnl.paper).toEqual({ pnl: 0, trades: 0 })
    expect(pnl.expertoption).toEqual({ pnl: 0, trades: 0 })
    expect(pnl).not.toHaveProperty("total")
    const check = await pm.portfolioRiskCheck({ symbol: "BTCUSD", amount: 10 })
    expect(check.allowed).toBe(true)
    expect(check.warnings).toEqual([])
  })
})
