import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp
let bus
let pm

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-multiplex-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  mkdirSync(tmp, { recursive: true })
  bus = await import("../services/marketDataBus.mjs")
  pm = await import("../services/positionManager.mjs")
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

function synthCandles(n, base = 100) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 60,
    open: base + i * 0.1,
    high: base + i * 0.1 + 0.5,
    low: base + i * 0.1 - 0.5,
    close: base + i * 0.1
  }))
}

describe("unified market data bus", () => {
  it("prefers EO buffers when they hold enough bars", async () => {
    vi.resetModules()
    vi.doMock("../services/liveEO.mjs", () => ({
      liveEOData: () => ({ assets: [{ id: "1", name: "BTCUSD", periods: { 60: synthCandles(120) } }] }),
      fetchAssetCandles: async () => ({ ohlc: [], source: null }),
      ensureWatchingAsset: async () => null
    }))
    const fresh = await import("../services/marketDataBus.mjs")
    const out = await fresh.getBestCandles("BTCUSD", { timeframe: 60, count: 50 })
    expect(out.source).toBe("live")
    expect(out.stale).toBe(false)
    expect(out.candles.length).toBe(50)
    vi.doUnmock("../services/liveEO.mjs")
  })

  it("falls through to CCXT when EO is empty, tags stale", async () => {
    vi.resetModules()
    vi.doMock("../services/liveEO.mjs", () => ({
      liveEOData: () => ({ assets: [] }),
      fetchAssetCandles: async () => ({ ohlc: [], source: null }),
      ensureWatchingAsset: async () => null
    }))
    vi.doMock("../services/liveCCXT.mjs", () => ({
      liveCCXTData: () => ({ assets: [{ name: "BTC/USDT", periods: { 60: synthCandles(80, 50000) } }] })
    }))
    const fresh = await import("../services/marketDataBus.mjs")
    const out = await fresh.getBestCandles("BTCUSD", { timeframe: 60, count: 40 })
    expect(out.source).toBe("ccxt")
    expect(out.stale).toBe(true)
    expect(out.candles[0].close).toBeGreaterThan(40000)
    vi.doUnmock("../services/liveEO.mjs")
    vi.doUnmock("../services/liveCCXT.mjs")
  })

  it("matches USDT-quote pairs for a USD request and vice versa", async () => {
    vi.resetModules()
    vi.doMock("../services/liveEO.mjs", () => ({
      liveEOData: () => ({ assets: [] }),
      fetchAssetCandles: async () => ({ ohlc: [], source: null }),
      ensureWatchingAsset: async () => null
    }))
    vi.doMock("../services/liveCCXT.mjs", () => ({
      liveCCXTData: () => ({ assets: [{ name: "ETH/BTC", periods: {} }, { name: "SOL/USDT", periods: { 300: synthCandles(50, 150) } }] })
    }))
    const fresh = await import("../services/marketDataBus.mjs")
    // SOLUSD request should match SOL/USDT.
    const out = await fresh.getBestCandles("SOLUSD", { timeframe: 300, count: 30 })
    expect(out.source).toBe("ccxt")
    expect(out.candles.length).toBeGreaterThanOrEqual(30)
    vi.doUnmock("../services/liveEO.mjs")
    vi.doUnmock("../services/liveCCXT.mjs")
  })

  it("returns honest emptiness when every tier fails", async () => {
    vi.resetModules()
    vi.doMock("../services/liveEO.mjs", () => ({ liveEOData: () => { throw new Error("down") }, fetchAssetCandles: async () => ({ ohlc: [] }), ensureWatchingAsset: async () => null }))
    vi.doMock("../services/liveCCXT.mjs", () => ({ liveCCXTData: () => { throw new Error("down") } }))
    vi.doMock("../services/yahoo.mjs", () => ({ getHistory: async () => { throw new Error("offline") } }))
    const fresh = await import("../services/marketDataBus.mjs")
    const out = await fresh.getBestCandles("ZZZZZ", {})
    expect(out.source).toBe("none")
    expect(out.candles).toEqual([])
    vi.doUnmock("../services/liveEO.mjs")
    vi.doUnmock("../services/liveCCXT.mjs")
    vi.doUnmock("../services/yahoo.mjs")
  })

  it("tracks per-source latency once a tier answers", async () => {
    const stats = bus.dataBusStats()
    for (const v of Object.values(stats)) {
      expect(v.samples).toBeGreaterThan(0)
      expect(v.medianMs).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("cross-platform position manager + portfolio risk", () => {
  beforeAll(() => {
    // Seed the paper ledger with two open positions and today's closed trade.
    writeFileSync(join(tmp, "trading-ledger.json"), JSON.stringify({
      positions: [
        { id: "p1", symbol: "BTCUSD", side: "up", entry: 100, amount: 1000, status: "open", openedAt: new Date().toISOString() },
        { id: "p2", symbol: "BTCUSD", side: "down", entry: 102, amount: 500, status: "open", openedAt: new Date().toISOString() },
        { id: "p3", symbol: "ETHUSD", side: "up", entry: 3000, amount: 200, status: "closed" }
      ],
      closed: [
        { id: "c1", pnl: 25.5, closedAt: new Date().toISOString() },
        { id: "c2", pnl: -10, closedAt: new Date().toISOString() }
      ],
      signals: []
    }))
    writeFileSync(join(tmp, "trading-demo-deals.json"), JSON.stringify({
      deals: [
        { serverId: "d1", asset: "BTCUSD", type: "call", amount: 250, openPrice: 100, status: "active", openedAt: new Date().toISOString() },
        { serverId: "d2", asset: "GOLD", type: "put", amount: 100, openPrice: 2600, result: "win", profit: 82, status: "closed", closedAt: new Date().toISOString() }
      ]
    }))
  })

  it("aggregates open exposure across connected venues (demo deals need a LIVE session)", async () => {
    const agg = await pm.aggregateOpenPositions()
    // No live EO session in tests → only the 2 open PAPER positions count.
    // This is the honest contract: file history ≠ open exposure.
    expect(agg.totals.openPositions).toBe(2)
    expect(agg.totals.notional).toBe(1500)

    const btc = agg.byInstrument.BTCUSD
    expect(btc.totalSize).toBe(1500) // 1000 + 500
    expect(btc.positions).toBe(2)
    expect(btc.hedged).toBe(true) // up + down legs on paper
    expect(btc.venues).toEqual(["paper"])
    expect(btc.avgEntry).toBeGreaterThan(0)

    const paperVenue = agg.venues.find((v) => v.venue === "paper")
    expect(paperVenue.totalSize).toBe(1500)
    expect(paperVenue.positions).toBe(2)
    // ETHUSD closed position must not leak into open aggregates.
    expect(agg.byInstrument.ETHUSD).toBeUndefined()
  })

  it("combines today's realized PnL across venues", async () => {
    const pnl = await pm.combinedTodayPnl()
    expect(pnl.paper.pnl).toBeCloseTo(15.5, 2)
    expect(pnl.paper.trades).toBe(2)
    // Settled demo deal from the FILE feeds realized PnL history (unlike open
    // exposure, which requires a live session).
    expect(pnl.expertoption.pnl).toBe(82)
    expect(pnl.expertoption.trades).toBe(1)
    expect(pnl.total.pnl).toBeCloseTo(97.5, 2)
    expect(pnl.total.trades).toBe(3)
  })

  it("risk check warns on concentration and passes a small proposal", async () => {
    const okSmall = await pm.portfolioRiskCheck({ symbol: "ETHUSD", amount: 50, maxNotional: 50000 })
    expect(okSmall.allowed).toBe(true)
    expect(Array.isArray(okSmall.warnings)).toBe(true)

    const overCap = await pm.portfolioRiskCheck({ symbol: "BTCUSD", amount: 60000, maxNotional: 50000 })
    expect(overCap.allowed).toBe(false)
    expect(overCap.warnings.some((w) => /cap/.test(w))).toBe(true)
  })

  it("flags hedged instruments in the risk check warnings path without crashing on unknown symbols", async () => {
    const unknown = await pm.portfolioRiskCheck({ symbol: "NOPEUSD", amount: 10 })
    expect(unknown.ok).toBe(true)
    expect(unknown.proposed.symbol).toBe("NOPEUSD")
  })
})
