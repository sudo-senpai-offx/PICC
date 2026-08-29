// T7 — Yahoo daily fallback wiring.
//
// yahooAdapter.getCandles must turn getHistory()'s normalized output into
// honest candle objects (times in SECONDS, per-candle timeframe tag matching
// the SERVED resolution) WITHOUT touching the network in CI — the fetch is
// stubbed at the global level, exactly where yahoo.mjs reads it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const DAY_MS = 86400000

/** Build a Yahoo chart.v8 fixture (raw API shape, timestamps in SECONDS). */
function chartFixture(n, { startSec = 1700000000, stepSec = DAY_MS / 1000, base = 100 } = {}) {
  const timestamps = []
  const opens = []
  const highs = []
  const lows = []
  const closes = []
  for (let i = 0; i < n; i++) {
    const o = base + i * 0.1
    const c = o + 0.5
    timestamps.push(startSec + i * stepSec)
    opens.push(o)
    highs.push(c + 1)
    lows.push(o - 1)
    closes.push(c)
  }
  return {
    chart: {
      result: [{
        meta: { symbol: "AAPL", shortName: "Apple", currency: "USD" },
        timestamp: timestamps,
        indicators: { quote: [{ open: opens, high: highs, low: lows, close: closes, volume: closes.map(() => 1000) }] }
      }]
    }
  }
}

describe("yahoo adapter getCandles (wired, no network)", () => {
  beforeEach(() => {
    // Any global fetch is the fixture — yahoo.mjs's getHistory is the only consumer.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => chartFixture(60) })))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    const { _clearCache } = await import("../services/yahoo.mjs")
    _clearCache()
  })

  async function loadAdapter() {
    await import("../services/brokers/yahooAdapter.mjs")
    const { getBroker } = await import("../services/brokers/index.mjs")
    const adapter = getBroker("yahoo")
    expect(adapter).not.toBeNull()
    return adapter
  }

  it("resolves 1D/1W/1M through the contract default; finer requests round UP to daily (honest fallback)", async () => {
    const adapter = await loadAdapter()
    expect(adapter.resolveTimeframe(86400)).toBe(86400)
    expect(adapter.resolveTimeframe(604800)).toBe(604800)
    expect(adapter.resolveTimeframe(2592000)).toBe(2592000)
    // An intraday request against Yahoo resolves up to DAILY bars — served
    // tagged 86400 with resolved:true so the UI warns instead of mislabeling.
    expect(adapter.resolveTimeframe(60)).toBe(86400)
    expect(adapter.resolveTimeframe(14400)).toBe(86400)
  })

  it("returns daily bars: seconds timestamps, per-candle timeframe 86400, count-sliced", async () => {
    const adapter = await loadAdapter()
    const candles = await adapter.getCandles("AAPL", { timeframe: 86400, count: 50 })
    expect(candles).toHaveLength(50)
    for (const c of candles) {
      expect(c.timeframe).toBe(86400)
      expect(Number.isInteger(c.time)).toBe(true)
      expect(Number.isFinite(c.open)).toBe(true)
      expect(c.open).toBeGreaterThan(0)
      expect(c.close).toBeGreaterThan(c.open)
    }
    // Times are ascending seconds, spaced one day apart (fixture cadence).
    const t = candles.map((c) => c.time)
    expect(t[1] - t[0]).toBe(DAY_MS / 1000)
  })

  it("asks Yahoo for the interval matching the SERVED timeframe (1wk request → 1wk bars)", async () => {
    const adapter = await loadAdapter()
    await adapter.getCandles("AAPL", { timeframe: 604800, count: 10 })
    const call = vi.mocked(fetch).mock.calls[0]
    const url = String(call[0])
    expect(url).toContain("interval=1wk")
    const candles = await adapter.getCandles("AAPL", { timeframe: 86400, count: 10 })
    expect(candles[0].timeframe).toBe(86400)
    // Cache would mask a second fetch — distinct key, so a fresh call is made.
    const second = vi.mocked(fetch).mock.calls[1]
    expect(String(second[0])).toContain("interval=1d")
  })

  it("drops partial bars (null OHLC) instead of faking gaps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const f = chartFixture(40)
      f.chart.result[0].indicators.quote[0].high[3] = null // second bar's high missing
      f.chart.result[0].indicators.quote[0].open[3] = null
      return { ok: true, status: 200, json: async () => f }
    }))
    const adapter = await loadAdapter()
    const candles = await adapter.getCandles("AAPL", { timeframe: 86400, count: 40 })
    expect(candles).toHaveLength(39) // 40 fixture bars minus the one partial
  })
})

describe("bus-level yahoo fallback (stock symbol → 86400 source:yahoo)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => chartFixture(120) })))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    const { _clearCache } = await import("../services/yahoo.mjs")
    _clearCache()
  })

  it("serves daily bars tagged 86400 with source yahoo for a stock request", async () => {
    await import("../services/brokers/yahooAdapter.mjs")
    const { getBestCandles } = await import("../services/marketDataBus.mjs")
    const out = await getBestCandles("AAPL", { timeframe: 86400, count: 50 })
    expect(out.source).toBe("yahoo")
    expect(out.timeframe).toBe(86400)
    expect(out.resolved).toBe(false)
    expect(out.candles.length).toBe(50)
    expect(out.candles[0].timeframe).toBe(86400)
  })
})