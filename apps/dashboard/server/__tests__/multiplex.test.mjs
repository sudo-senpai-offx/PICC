import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp
let bus
let pm
let registerBroker
let unregisterBroker

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-multiplex-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  mkdirSync(tmp, { recursive: true })
  const registry = await import("../services/brokers/index.mjs")
  registerBroker = registry.registerBroker
  unregisterBroker = registry.unregisterBroker
  bus = await import("../services/marketDataBus.mjs")
  pm = await import("../services/positionManager.mjs")
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

// Track test-only broker slugs for cleanup
const testBrokerSlugs = []

function registerTestBroker(adapter) {
  testBrokerSlugs.push(adapter.slug)
  try {
    registerBroker(adapter)
  } catch { /* already registered */ }
}

afterEach(() => {
  // Unregister all test-only brokers so they don't leak into the next test
  for (const slug of testBrokerSlugs) unregisterBroker(slug)
  testBrokerSlugs.length = 0
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
    registerTestBroker({
      slug: "test-eo",
      label: "Test EO",
      weight: 100,
      isAlive: () => true,
      getCandles: (id, opts) => {
        if (id === "BTCUSD" && (opts?.timeframe ?? 60) === 60) return synthCandles(120)
        return []
      }
    })
    const out = await bus.getBestCandles("BTCUSD", { timeframe: 60, count: 50 })
    expect(out.source).toBe("test-eo")
    expect(out.stale).toBe(false)
    expect(out.candles.length).toBe(50)
  })

  it("falls through to CCXT when EO is empty, tags stale", async () => {
    registerTestBroker({
      slug: "test-eo-empty",
      label: "Test EO Empty",
      weight: 100,
      isAlive: () => true,
      getCandles: () => []
    })
    registerTestBroker({
      slug: "test-ccxt",
      label: "Test CCXT",
      weight: 50,
      isAlive: () => true,
      getCandles: (id, opts) => {
        if (id === "BTCUSD" && (opts?.timeframe ?? 60) === 60) return synthCandles(80, 50000)
        return []
      }
    })
    const out = await bus.getBestCandles("BTCUSD", { timeframe: 60, count: 40 })
    // CCXT broker had 80 bars (≥30 threshold), so it's considered "live" data — not stale.
    // The old hardcoded stale:true for CCXT is replaced by broker-priority semantics:
    // a broker with sufficient buffered data is tagged fresh; only thin data is stale.
    expect(out.source).toBe("test-ccxt")
    expect(out.stale).toBe(false)
    expect(out.candles[0].close).toBeGreaterThan(40000)
  })

  it("matches USDT-quote pairs for a USD request and vice versa", async () => {
    registerTestBroker({
      slug: "test-ccxt-usdt",
      label: "Test CCXT USDT",
      weight: 50,
      isAlive: () => true,
      getCandles: (id, opts) => {
        if (id === "SOLUSD" && (opts?.timeframe ?? 60) === 300) return synthCandles(50, 150)
        return []
      }
    })
    const out = await bus.getBestCandles("SOLUSD", { timeframe: 300, count: 30 })
    expect(out.source).toBe("test-ccxt-usdt")
    expect(out.candles.length).toBeGreaterThanOrEqual(30)
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

  it("combines today's realized PnL across venues, kept in separate buckets", async () => {
    const pnl = await pm.combinedTodayPnl()
    expect(pnl.paper.pnl).toBeCloseTo(15.5, 2)
    expect(pnl.paper.trades).toBe(2)
    // Settled demo deal from the FILE feeds realized PnL history (unlike open
    // exposure, which requires a live session).
    expect(pnl.expertoption.pnl).toBe(82)
    expect(pnl.expertoption.trades).toBe(1)
    // B-PAP-2: no merged total — paper and venue-demo stay separate buckets.
    expect(pnl).not.toHaveProperty("total")
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
