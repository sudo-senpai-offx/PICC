// Phase 9 — CCXT connector tests. The ccxt library is mocked wholesale; every
// piece of PICC logic (normalization, guards, caching, shared-state isolation,
// indicator feed) runs for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mock state — referenced from inside the vi.mock("ccxt") factory,
// which vitest lifts above all imports.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  // Dependency-free spy recorder (vi isn't available inside hoisted blocks).
  const recorder = () => {
    const fn = (...args) => {
      fn.calls.push(args)
      return { ok: true }
    }
    fn.calls = []
    return fn
  }
  // Order/account-mutating surface that exists on real exchanges and MUST be
  // neutralized by the read-only guard.
  const BLOCKED_METHODS = [
    "createOrder",
    "createOrders",
    "editOrder",
    "cancelOrder",
    "cancelAllOrders",
    "setLeverage",
    "setMarginMode",
    "transfer",
    "withdraw",
    "closePosition"
  ]
  class RateLimitError extends Error {
    constructor(message) {
      super(message)
      this.name = "DDoSProtection"
    }
  }
  const created = [] // every instantiated mock exchange, in order
  const makeCtor = (id) =>
    function MockExchange(opts = {}) {
      this.id = id
      this.enableRateLimit = false
      this.timeout = 0
      this.options = {}
      this.__spies = {}
      for (const m of BLOCKED_METHODS) {
        const spy = recorder()
        this.__spies[m] = spy
        this[m] = spy
      }
      Object.assign(this, opts)
      created.push(this)
    }
  return { recorder, RateLimitError, created, makeCtor, BLOCKED_METHODS }
})

vi.mock("ccxt", () => ({
  default: {
    binance: h.makeCtor("binance"),
    kraken: h.makeCtor("kraken"),
    DDoSProtection: h.RateLimitError,
    version: "mock"
  }
}))

const {
  connect,
  disconnect,
  disconnectAll,
  connectedExchangeIds,
  normalizeCandle,
  normalizeCandles,
  toCcxtSymbol,
  isRateLimitError,
  fetchCandles,
  fetchTicker
} = await import("../services/ccxtConnector.mjs")
const {
  timeframeSeconds,
  recordCandles,
  recordTicker,
  liveCCXTData,
  mergeCCXTAssets,
  indicatorSnapshot,
  volumeProxy,
  resetCCXTData
} = await import("../services/liveCCXT.mjs")

/** Raw CCXT OHLCV rows: [ms, o, h, l, c, v]. */
function rawRows(count = 60, startMs = 1_700_000_000_000, stepMs = 60_000, base = 100) {
  return Array.from({ length: count }, (_, i) => [
    startMs + i * stepMs,
    base + i,
    base + i + 2,
    base + i - 1,
    base + i + 1,
    10 + i
  ])
}

let stdoutSpy = null

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
})

afterEach(async () => {
  await disconnectAll()
  resetCCXTData()
  vi.restoreAllMocks()
})

describe("ccxtConnector.connect", () => {
  it("creates a CCXT exchange instance with polite rate limiting enabled", async () => {
    const ex = await connect({ exchange: "binance", apiKey: "key-1", secret: "sec-1" })
    expect(ex.id).toBe("binance")
    expect(ex.enableRateLimit).toBe(true)
    expect(ex.apiKey).toBe("key-1")
    expect(ex.secret).toBe("sec-1")
    expect(h.created.some((c) => c.id === "binance")).toBe(true)
  })

  it("rejects unknown exchanges and missing ids", async () => {
    await expect(connect({ exchange: "not-a-real-exchange" })).rejects.toThrow(/unknown ccxt exchange/)
    await expect(connect({})).rejects.toThrow(/requires an exchange id/)
  })

  it("reuses one cached instance per exchange id (no duplicate connections)", async () => {
    const a = await connect({ exchange: "kraken" })
    const b = await connect({ exchange: "kraken" })
    expect(a).toBe(b)
    expect(h.created.filter((c) => c.id === "kraken")).toHaveLength(1)
  })
})

describe("fetchCandles normalization", () => {
  it("normalizes OHLCV rows into {time(sec),open,high,low,close,volume}", async () => {
    const ex = await connect({ exchange: "binance" })
    ex.fetchOHLCV = vi.fn(async () => rawRows(5))
    const candles = await fetchCandles(ex, "BTC/USDT", "1m", 5)
    expect(candles).toHaveLength(5)
    expect(candles[0]).toEqual({
      time: 1_700_000_000, // ms -> unix seconds
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 10
    })
    expect(candles.every((c) => Number.isInteger(c.time))).toBe(true)
  })

  it("passes symbol/timeframe/capped limit through to fetchOHLCV", async () => {
    const ex = await connect({ exchange: "binance" })
    ex.fetchOHLCV = vi.fn(async () => [])
    await fetchCandles(ex, "BTC/USDT", "5m", 5000)
    expect(ex.fetchOHLCV).toHaveBeenCalledWith("BTC/USDT", "5m", undefined, 1000)
  })

  it("drops malformed rows and coerces partial ones around a valid close", async () => {
    const candles = normalizeCandles([
      [1_700_000_000_000, 10, 12, 9, 11, 3], // valid
      ["garbage"], // too short -> dropped
      "nope", // not an array -> dropped
      [1_700_000_060_000, 11, 13, 10, Number.NaN, 4], // NaN close -> dropped
      [1_700_000_120_000, 12, 14, 11, -7, 1], // non-positive close -> dropped
      [1_700_000_180_000, "junk", "junk", "junk", 15, "x"], // junk o/h/l coerced to close, volume -> 0
      [1_700_000_090_000, 11, 12, 10, 12, 5], // out of order -> re-sorted
      null // null row -> dropped
    ])
    expect(candles.map((c) => c.time)).toEqual([1_700_000_000, 1_700_000_090, 1_700_000_180])
    expect(candles[2]).toMatchObject({ open: 15, high: 15, low: 15, close: 15, volume: 0 })
  })

  it("returns [] for non-array payloads instead of crashing", async () => {
    const ex = await connect({ exchange: "binance" })
    for (const bad of [undefined, null, {}, "error", 42]) {
      ex.fetchOHLCV = vi.fn(async () => bad)
      await expect(fetchCandles(ex, "BTC/USDT")).resolves.toEqual([])
    }
  })

  it("returns [] when the exchange object is unusable", async () => {
    await expect(fetchCandles(null, "BTC/USDT")).resolves.toEqual([])
    await expect(fetchCandles({}, "BTC/USDT")).resolves.toEqual([])
    const ex = await connect({ exchange: "binance" })
    await expect(fetchCandles(ex, "")).resolves.toEqual([])
  })

  it("normalizes a single candle defensively (normalizeCandle)", () => {
    expect(normalizeCandle([1_700_000_000_999, 1, 2, 0.5, 1.5, 9])).toMatchObject({
      time: 1_700_000_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 9
    })
    expect(normalizeCandle([])).toBeNull()
    expect(normalizeCandle([1_700_000_000_000, 1, 2])).toBeNull()
    expect(normalizeCandle([1_700_000_000_000, 1, 2, 0.5, "abc", 1])).toBeNull()
    expect(normalizeCandles("nope")).toEqual([])
  })
})

describe("fetchTicker", () => {
  it("returns the current price preferring last/close over bid/ask", async () => {
    const ex = await connect({ exchange: "kraken" })
    ex.fetchTicker = vi.fn(async () => ({
      symbol: "XBT/USD",
      last: 64_123.45,
      bid: 64_120,
      ask: 64_126,
      percentage: 1.24,
      timestamp: 1_700_000_000_000
    }))
    const t = await fetchTicker(ex, "XBT/USD")
    expect(t).toMatchObject({
      symbol: "XBT/USD",
      price: 64_123.45,
      bid: 64_120,
      ask: 64_126,
      percentage: 1.24,
      ts: 1_700_000_000_000
    })
  })

  it("falls back through bid/ask when last/close are missing", async () => {
    const ex = await connect({ exchange: "kraken" })
    ex.fetchTicker = vi.fn(async () => ({ bid: 99, ask: 101 }))
    const t = await fetchTicker(ex, "XBT/USD")
    expect(t.price).toBe(99)
  })

  it("returns null on unusable tickers and transport errors", async () => {
    const ex = await connect({ exchange: "kraken" })
    ex.fetchTicker = vi.fn(async () => ({ last: "not-a-number" }))
    expect(await fetchTicker(ex, "XBT/USD")).toBeNull()
    ex.fetchTicker = vi.fn(async () => null)
    expect(await fetchTicker(ex, "XBT/USD")).toBeNull()
    ex.fetchTicker = vi.fn(async () => {
      throw new Error("socket hang up")
    })
    expect(await fetchTicker(ex, "XBT/USD")).toBeNull()
    expect(await fetchTicker(null, "XBT/USD")).toBeNull()
  })
})

describe("graceful failure + rate limits", () => {
  it("catches rate limit errors, logs, and resolves [] instead of throwing", async () => {
    const ex = await connect({ exchange: "binance" })
    ex.fetchOHLCV = vi.fn(async () => {
      throw new h.RateLimitError("429 Too Many Requests")
    })
    await expect(fetchCandles(ex, "BTC/USDT", "1m")).resolves.toEqual([])
    const logged = stdoutSpy.mock.calls.map((c) => String(c[0])).join("")
    expect(logged).toMatch(/picc-ccxt/)
    expect(logged).toMatch(/rate limited/i)
  })

  it("identifies rate-limit errors by ccxt class, error name, and message", () => {
    expect(isRateLimitError(new h.RateLimitError("slow down"))).toBe(true) // instanceof mocked class
    expect(isRateLimitError(Object.assign(new Error("back off"), { name: "RateLimitExceeded" }))).toBe(true)
    expect(isRateLimitError(new Error("please send fewer requests (429)"))).toBe(true)
    expect(isRateLimitError(new Error("bad symbol"))).toBe(false)
    expect(isRateLimitError(null)).toBe(false)
  })

  it("catches generic transport failures and logs them without throwing", async () => {
    const ex = await connect({ exchange: "binance" })
    ex.fetchOHLCV = vi.fn(async () => {
      throw new Error("ENOTFOUND api.binance.com")
    })
    await expect(fetchCandles(ex, "BTC/USDT")).resolves.toEqual([])
    const logged = stdoutSpy.mock.calls.map((c) => String(c[0])).join("")
    expect(logged).toMatch(/fetchOHLCV failed/i)
  })
})

describe("read-only guard", () => {
  it("replaces order-placement methods with throwing stubs", async () => {
    const ex = await connect({ exchange: "binance" })
    for (const method of h.BLOCKED_METHODS) {
      expect(typeof ex[method]).toBe("function")
      expect(() => ex[method]({ symbol: "BTC/USDT", side: "buy" })).toThrow(/PICC is read-only/)
    }
  })

  it("never invokes the underlying order methods (guards run first)", async () => {
    const ex = await connect({ exchange: "binance" })
    try {
      ex.createOrder({ symbol: "BTC/USDT", side: "buy" })
    } catch {
      /* expected */
    }
    expect(() => ex.cancelOrder("123")).toThrow(/PICC is read-only/)
    try {
      ex.withdraw({ amount: 1 })
    } catch {
      /* expected */
    }
    for (const method of h.BLOCKED_METHODS) {
      expect(ex.__spies[method].calls).toHaveLength(0)
    }
  })

  it("data fetching only touches market-data methods", async () => {
    const ex = await connect({ exchange: "binance" })
    ex.fetchOHLCV = vi.fn(async () => rawRows(3))
    ex.fetchTicker = vi.fn(async () => ({ last: 100 }))
    await fetchCandles(ex, "BTC/USDT")
    await fetchTicker(ex, "BTC/USDT")
    for (const method of h.BLOCKED_METHODS) {
      expect(ex.__spies[method].calls).toHaveLength(0)
    }
  })
})

describe("multi-exchange isolation", () => {
  it("runs two exchanges simultaneously with zero shared state", async () => {
    const binance = await connect({ exchange: "binance" })
    const kraken = await connect({ exchange: "kraken" })
    expect(binance).not.toBe(kraken)
    binance.fetchOHLCV = vi.fn(async () => rawRows(3, 1_700_000_000_000, 60_000, 100))
    kraken.fetchOHLCV = vi.fn(async () => rawRows(3, 1_700_000_000_000, 60_000, 200))

    const b = await fetchCandles(binance, "BTC/USDT")
    const k = await fetchCandles(kraken, "XBT/USD")
    expect(b[0].close).toBe(101)
    expect(k[0].close).toBe(201)

    // Shared-state layer keys by exchange id too.
    recordCandles({ exchange: binance, symbol: "BTC/USDT", timeframe: "1m", candles: b })
    recordCandles({ exchange: kraken, symbol: "BTC/USDT", timeframe: "1m", candles: k })
    const data = liveCCXTData()
    expect(data.assets).toHaveLength(2)
    const ids = data.assets.map((a) => a.id).sort()
    expect(ids).toEqual(["binance:BTC/USDT", "kraken:BTC/USDT"])
    const binanceAsset = data.assets.find((a) => a.exchange === "binance")
    const krakenAsset = data.assets.find((a) => a.exchange === "kraken")
    expect(binanceAsset.periods[60][0].close).toBe(101)
    expect(krakenAsset.periods[60][0].close).toBe(201)
  })

  it("disconnecting one exchange leaves the others intact", async () => {
    const binance = await connect({ exchange: "binance" })
    const kraken = await connect({ exchange: "kraken" })
    kraken.close = vi.fn(async () => {})
    await disconnect(binance)
    expect(connectedExchangeIds()).toEqual(["kraken"])
    kraken.fetchOHLCV = vi.fn(async () => rawRows(2))
    await expect(fetchCandles(kraken, "XBT/USD")).resolves.toHaveLength(2)
    await disconnect(kraken)
    expect(kraken.close).toHaveBeenCalledTimes(1)
    expect(connectedExchangeIds()).toEqual([])
  })
})

describe("liveCCXT shared state + indicator feed", () => {
  it("parses timeframes and rejects unusable records", () => {
    expect(timeframeSeconds("1m")).toBe(60)
    expect(timeframeSeconds("5m")).toBe(300)
    expect(timeframeSeconds("15m")).toBe(900)
    expect(timeframeSeconds("1h")).toBe(3600)
    expect(timeframeSeconds("1d")).toBe(86_400)
    expect(timeframeSeconds(300)).toBe(300)
    expect(timeframeSeconds("banana")).toBeNull()
    expect(recordCandles({ exchange: "", symbol: "BTC/USDT", timeframe: "1m", candles: [] })).toBeNull()
    expect(recordCandles({ exchange: "binance", symbol: "BTC/USDT", timeframe: "?", candles: rawRows(3) })).toBeNull()
  })

  it("stores candles, dedupes overlapping polls, and computes indicators", () => {
    const first = normalizeCandles(rawRows(80))
    let res = recordCandles({ exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", candles: first })
    expect(res.ohlc).toBe(80)

    // Overlapping poll: bars 60-79 overlap (identical values), 30 fresh bars arrive.
    const second = normalizeCandles(rawRows(50, 1_700_000_000_000 + 60 * 60_000))
    res = recordCandles({ exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", candles: second })
    expect(res.ohlc).toBe(110) // 130 rows -> 110 unique bar times

    const data = liveCCXTData()
    expect(data.status).toBe("connected")
    expect(data.mode).toBe("live")
    expect(data.source).toBe("ccxt")
    const asset = data.assets.find((a) => a.id === "binance:BTC/USDT")
    expect(asset.periods[60]).toHaveLength(110)
    const ind = asset.indicators[60]
    expect(ind.ready).toBe(true)
    expect(ind.rsi).toBeGreaterThan(0)
    expect(ind.rsi).toBeLessThanOrEqual(100)
    expect(ind.trend).toBe("up") // steadily rising synthetic series
    expect(ind.macd.hist).toBeGreaterThan(0)
    expect(ind.atr).toBeGreaterThan(0)
    expect(asset.lastPrice).toBe(150) // last close of the merged series
    // EO-shaped ticks proxy so confluenceRead's volume group works unchanged.
    expect(asset.ticks.proxy).toBe("bar-direction")
    expect(asset.ticks.count).toBe(48) // volumeProxy keeps the freshest 48 bars
    expect(typeof asset.ticks.delta).toBe("number")

    // Ticker refreshes the pair's last price without recomputing indicators.
    recordTicker({ exchange: "binance", symbol: "BTC/USDT", ticker: { price: 555.5, symbol: "BTC/USDT" } })
    const after = liveCCXTData().assets.find((a) => a.id === "binance:BTC/USDT")
    expect(after.lastPrice).toBe(555.5)
    expect(after.indicators[60].price).toBe(150)
  })

  it("indicatorSnapshot degrades gracefully on thin/invalid input", () => {
    expect(indicatorSnapshot([]).ready).toBe(false)
    expect(indicatorSnapshot(null).bars).toBe(0)
    const snap = indicatorSnapshot(normalizeCandles(rawRows(60)))
    expect(snap.ready).toBe(true)
    expect(snap.ema.ema20).not.toBeNull()
    expect(snap.trend).toBe("up")
  })

  it("volumeProxy mirrors the liveEO tick-state shape", () => {
    const proxy = volumeProxy([
      { time: 60, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 120, open: 2, high: 2.5, low: 1, close: 1.25 },
      { time: 180, open: 1.25, high: 2, low: 1, close: 1.75 }
    ])
    expect(proxy.proxy).toBe("bar-direction")
    expect(proxy.up).toBe(2)
    expect(proxy.down).toBe(1)
    expect(proxy.delta).toBe(1)
    expect(proxy.profile).toHaveLength(3)
  })

  it("mergeCCXTAssets folds CCXT assets into an EO snapshot without mutating it", async () => {
    const ex = await connect({ exchange: "binance" })
    ex.fetchOHLCV = vi.fn(async () => rawRows(45))
    recordCandles({ exchange: ex, symbol: "ETH/USDT", timeframe: "1m", candles: normalizeCandles(rawRows(45)) })

    const eoShape = { status: "idle", mode: "demo", assets: [{ id: "142", name: "EUR/USD", periods: {} }] }
    const merged = mergeCCXTAssets(eoShape)
    expect(merged.assets).toHaveLength(2)
    expect(merged.assets[0].id).toBe("142")
    expect(merged.assets[1].id).toBe("binance:ETH/USDT")
    expect(Array.isArray(merged.assets[1].periods[60])).toBe(true)
    expect(merged.assets[1].periods[60]).toHaveLength(45)
    // Input untouched — the EO layer owns its own buffers.
    expect(eoShape.assets).toHaveLength(1)
    expect(eoShape.status).toBe("idle")
    // Empty CCXT state is a no-op passthrough.
    resetCCXTData()
    expect(mergeCCXTAssets(eoShape)).toBe(eoShape)
  })

  it("toCcxtSymbol normalizes platform-specific forms to unified symbols", () => {
    expect(toCcxtSymbol("btc-usdt")).toBe("BTC/USDT")
    expect(toCcxtSymbol("BTCUSDT")).toBe("BTC/USDT")
    expect(toCcxtSymbol("btc/usd")).toBe("BTC/USD")
    expect(toCcxtSymbol("eth-usdc")).toBe("ETH/USDC")
    expect(toCcxtSymbol("XBTUSD")).toBe("XBT/USD")
    expect(toCcxtSymbol("SOLBTC")).toBe("SOL/BTC")
    expect(toCcxtSymbol("")).toBeNull()
    expect(toCcxtSymbol(null)).toBeNull()
  })
})
