import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../config.mjs", () => ({
  llmConfigured: () => false,
  env: { serperApiKey: "test-key" }
}))

const rising = Array.from({ length: 60 }, (_, i) => 100 + i)
const falling = Array.from({ length: 60 }, (_, i) => 100 - i)

vi.mock("../services/yahoo.mjs", () => ({
  getHistory: vi.fn(async (symbol) => {
    const s = String(symbol).toUpperCase()
    if (s === "AAPL") return { symbol: "AAPL", name: "Apple", currency: "USD", lastPrice: 200, closes: rising }
    if (s === "MSFT") return { symbol: "MSFT", name: "Microsoft", currency: "USD", lastPrice: 40, closes: falling }
    throw new Error(`no data for ${s}`)
  })
}))

vi.mock("../services/llm.mjs", () => ({
  chatText: vi.fn(async () => "LLM mock advice")
}))

vi.mock("../services/serper.mjs", () => ({
  news: vi.fn(async (query, num) => [
    { title: "BTC at $100k", link: "https://example.com/1", snippet: "Crypto rallies", source: "Example", date: "today" }
  ])
}))

let tmp
let mod

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-trading-features-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  mod = await import("../services/trading.mjs")
})

beforeEach(async () => {
  await mod._resetTradingData()
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("paper take-profit / stop-loss", () => {
  it("stores TP/SL levels on the position and validates them", async () => {
    const pos = await mod.openPaperTrade({
      symbol: "EURUSD",
      side: "up",
      entry: 100,
      amount: 100,
      takeProfit: 110,
      stopLoss: 95
    })
    expect(pos.takeProfit).toBe(110)
    expect(pos.stopLoss).toBe(95)

    await expect(
      mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 100, amount: 100, stopLoss: 110 })
    ).rejects.toThrow(/stop-loss/)
    await expect(
      mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 100, amount: 100, takeProfit: 90 })
    ).rejects.toThrow(/take-profit/)
    await expect(
      mod.openPaperTrade({ symbol: "EURUSD", side: "down", entry: 100, amount: 100, stopLoss: 90 })
    ).rejects.toThrow(/stop-loss/)
  })

  it("checkPaperExit closes at the TP level with reason tp", async () => {
    const pos = await mod.openPaperTrade({
      symbol: "EURUSD",
      side: "up",
      entry: 100,
      amount: 100,
      takeProfit: 110,
      stopLoss: 95
    })
    const hit = await mod.checkPaperExit({ id: pos.id, price: 112 })
    expect(hit).not.toBeNull()
    expect(hit.reason).toBe("tp")
    expect(hit.exit).toBe(110)
    expect(hit.pnl).toBeCloseTo(10, 2)
    const again = await mod.checkPaperExit({ id: pos.id, price: 112 })
    expect(again).toBeNull()
  })

  it("paperAnalytics auto-closes a position whose SL was hit at the quote", async () => {
    const pos = await mod.openPaperTrade({
      symbol: "AAPL",
      side: "up",
      entry: 300,
      amount: 100,
      stopLoss: 250
    })
    // Mock quotes AAPL at 200 → the 250 SL is tripped.
    const report = await mod.paperAnalytics()
    expect(report.autoClosed).toHaveLength(1)
    expect(report.autoClosed[0].reason).toBe("sl")
    expect(report.autoClosed[0].exit).toBe(250)
    expect(report.overview.closedCount).toBe(1)
    expect(report.overview.openCount).toBe(0)
  })

  it("paperAnalytics marks open positions to market and reports equity", async () => {
    const pos = await mod.openPaperTrade({ symbol: "AAPL", side: "up", entry: 100, amount: 200 })
    const report = await mod.paperAnalytics()
    expect(report.open).toHaveLength(1)
    // Entry 100, quote 200 → +100% on $200 = +$200 unrealized.
    expect(report.open[0].unrealized).toBeCloseTo(200, 2)
    expect(report.overview.unrealizedPnl).toBeCloseTo(200, 2)
    expect(report.overview.equity).toBeCloseTo(10200, 2)
    expect(report.metrics.trades).toBe(0)
    expect(report.overview.closedCount).toBe(0)
  })

  it("paperAnalytics builds metrics from closed history", async () => {
    const a = await mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 100, amount: 100 })
    await mod.closePaperTrade({ id: a.id, exit: 110 })
    const report = await mod.paperAnalytics()
    expect(report.overview.realizedPnl).toBeCloseTo(10, 2)
    expect(report.metrics.winRate).toBe(100)
    expect(report.metrics.profitFactor).toBe(null)
    expect(report.metrics.equity).toHaveLength(2)
  })
})

describe("signal feedback loop", () => {
  it("resolves a signal to win/loss/draw against the outcome price", async () => {
    const up = await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 70, entry: 100 })
    const down = await mod.recordSignal({ symbol: "EURUSD", direction: "down", confidence: 70, entry: 100 })
    const draw = await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 70, entry: 100 })

    const win = await mod.resolveSignal({ id: up.id, resultPrice: 105 })
    const loss = await mod.resolveSignal({ id: down.id, resultPrice: 105 })
    const deadHeat = await mod.resolveSignal({ id: draw.id, resultPrice: 100 })

    expect(win.resolution).toBe("win")
    expect(win.outcomePct).toBeCloseTo(5, 2)
    expect(loss.resolution).toBe("loss")
    expect(deadHeat.resolution).toBe("draw")

    await expect(mod.resolveSignal({ id: up.id, resultPrice: 110 })).rejects.toThrow(/not found/)
  })

  it("signalAccuracy breaks down win rate by direction, symbol and horizon", async () => {
    const up1 = await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 60, horizonDays: 3, entry: 100 })
    const up2 = await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 60, horizonDays: 3, entry: 100 })
    const down = await mod.recordSignal({ symbol: "BTCUSD", direction: "down", confidence: 60, horizonDays: 1, entry: 100 })
    await mod.resolveSignal({ id: up1.id, resultPrice: 110 }) // win
    await mod.resolveSignal({ id: up2.id, resultPrice: 90 }) // loss
    await mod.resolveSignal({ id: down.id, resultPrice: 90 }) // win (down move)

    const acc = await mod.signalAccuracy()
    expect(acc.total).toBe(3)
    expect(acc.wins).toBe(2)
    expect(acc.winRate).toBe(67)
    const up = acc.byDirection.find((b) => b.key === "up")
    expect(up.winRate).toBe(50)
    const eur = acc.bySymbol.find((b) => b.key === "EURUSD")
    expect(eur.winRate).toBe(50)
    const h3 = acc.byHorizon.find((b) => b.key === "3")
    expect(h3.winRate).toBe(50)
  })
})

describe("watchlist + scanner", () => {
  it("adds, lists and removes symbols", async () => {
    await mod.addToWatchlist("aapl")
    await mod.addToWatchlist("MSFT")
    expect(await mod.getWatchlist()).toEqual(["AAPL", "MSFT"])
    await mod.addToWatchlist("aapl") // dedupe
    expect(await mod.getWatchlist()).toHaveLength(2)
    await mod.removeFromWatchlist("AAPL")
    expect(await mod.getWatchlist()).toEqual(["MSFT"])
  })

  it("fetches quotes for watchlist symbols, marking failures per symbol", async () => {
    await mod.addToWatchlist("AAPL")
    await mod.addToWatchlist("NOPE")
    const q = await mod.watchlistQuotes()
    const aapl = q.symbols.find((s) => s.symbol === "AAPL")
    expect(aapl.last).toBe(200)
    const nope = q.symbols.find((s) => s.symbol === "NOPE")
    expect(nope.last).toBe(null)
    expect(nope.error).toMatch(/no data/)
  })

  it("scans the watchlist and ranks signals by confidence", async () => {
    await mod.addToWatchlist("AAPL")
    await mod.addToWatchlist("MSFT")
    const scan = await mod.scanSymbols()
    expect(scan.scanned).toBe(2)
    expect(scan.errors).toHaveLength(0)
    const up = scan.signals.find((s) => s.symbol === "AAPL")
    const down = scan.signals.find((s) => s.symbol === "MSFT")
    expect(up.direction).toBe("up")
    expect(down.direction).toBe("down")
    expect(up.confidence).toBeGreaterThanOrEqual(50)
    // Sorted by confidence, highest first.
    const confidences = scan.signals.map((s) => s.confidence)
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences)
  })

  it("rejects scanning an empty set", async () => {
    await expect(mod.scanSymbols()).rejects.toThrow(/watchlist/)
  })
})

describe("market news", () => {
  it("returns Serper news items for a symbol", async () => {
    const r = await mod.marketNews({ symbol: "BTC" })
    expect(r.ok).toBe(true)
    expect(r.query).toBe("BTC finance")
    expect(r.source).toBe("serper")
    expect(r.items[0].title).toBe("BTC at $100k")
  })

  it("falls back to a default query when none is supplied", async () => {
    const r = await mod.marketNews({ query: "" })
    expect(r.query).toBe("financial markets today")
  })
})
