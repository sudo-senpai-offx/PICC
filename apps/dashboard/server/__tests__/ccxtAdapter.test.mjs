// T2 — CCXT real OHLCV history in the broker adapter.
//
// ccxtAdapter.getCandles previously returned [] unconditionally, so crypto
// charts had no exchange history unless the 400-bar scheduler buffers covered
// them. Now: on-demand fetch from connected exchanges (deep window, connector
// caps 1000 rows/call, rate-limit aware), buffer fallback when no exchange
// answers, and [] only when CCXT genuinely serves nothing (bus → Yahoo).
//
// The connector is mocked so no ccxt exchange is ever touched; liveCCXT stays
// real (pure in-memory) so buffer-fallback behavior is genuine.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Real module for toCcxtSymbol/normalize fidelity — only the network-touching
// functions are mocked away.
const realConnector = await import("../services/ccxtConnector.mjs")

const state = { connected: [], fetchResult: [], fetchBySymbol: {}, fetchArgs: [] }

vi.doMock("../services/ccxtConnector.mjs", () => ({
  ...realConnector,
  connectedExchangeIds: () => [...state.connected],
  toCcxtSymbol: (raw) => realConnector.toCcxtSymbol(raw),
  connect: async ({ exchange }) => ({ id: exchange, fetchOHLCV: async () => [] }),
  fetchCandles: async (exchange, symbol, interval, limit) => {
    state.fetchArgs.push({ exchange: exchange.id, symbol, interval, limit })
    if (Object.prototype.hasOwnProperty.call(state.fetchBySymbol, symbol)) return state.fetchBySymbol[symbol]
    return state.fetchResult
  }
}))

import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetCCXTData, recordCandles } from "../services/liveCCXT.mjs"
import { getBroker, registerBroker, unregisterBroker } from "../services/brokers/index.mjs"

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "picc-ccxt-adapter-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  mkdirSync(tmp, { recursive: true })
  state.connected = []
  state.fetchResult = []
  state.fetchBySymbol = {}
  state.fetchArgs = []
  resetCCXTData()
})

afterEach(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

async function loadAdapter() {
  await import("../services/brokers/ccxtAdapter.mjs")
  const adapter = getBroker("ccxt")
  expect(adapter).not.toBeNull()
  return adapter
}

/** Rows in raw CCXT shape (ms timestamps) — what a real exchange returns. */
function rawRows(n, { startMs = 1700000000000, stepMs = 300_000, base = 60000 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const o = base + i
    return [startMs + i * stepMs, o, o + 50, o - 50, o + 20, 1000 + i]
  })
}

describe("ccxt adapter getCandles (T2 — real OHLCV history)", () => {
  it("serves deep on-demand history from a connected exchange, tagged with the served tf", async () => {
    // binance lists BTC/USDT, not BTC/USD — the adapter must try both
    // spellings and serve whatever the exchange actually answers with.
    state.connected = ["binance"]
    state.fetchBySymbol = {
      "BTC/USD": [],
      "BTC/USDT": realConnector.normalizeCandles(rawRows(1200, { stepMs: 300_000 }))
    }
    const adapter = await loadAdapter()

    const candles = await adapter.getCandles("BTCUSD", { timeframe: 300, count: 500 })

    expect(candles).toHaveLength(500)
    for (const c of candles) {
      expect(c.timeframe).toBe(300)
      expect(Number.isInteger(c.time)).toBe(true)
      expect(Number.isFinite(c.open)).toBe(true)
      expect(c.open).toBeGreaterThan(0)
      expect(c.volume).toBeGreaterThan(0)
    }
    // Ascending seconds spaced 5m apart (fetched rows → normalized).
    const t = candles.map((c) => c.time)
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBe(300)
    // The connector was asked for the pair the exchange lists, the SERVED
    // interval and a bounded window (count ≤ connector's 1000 cap).
    const winning = state.fetchArgs.find((a) => a.symbol === "BTC/USDT")
    expect(winning).toMatchObject({ exchange: "binance", symbol: "BTC/USDT", interval: "5m", limit: 500 })
  })

  it("maps the served resolution to the matching CCXT interval (1h/4h/1m)", async () => {
    state.connected = ["kraken"]
    state.fetchResult = realConnector.normalizeCandles(rawRows(100))
    const adapter = await loadAdapter()

    await adapter.getCandles("BTCUSD", { timeframe: 14400, count: 50 })
    expect(state.fetchArgs.at(-1).interval).toBe("4h")
    await adapter.getCandles("ETHUSD", { timeframe: 3600, count: 50 })
    expect(state.fetchArgs.at(-1).symbol).toBe("ETH/USD")
    expect(state.fetchArgs.at(-1).interval).toBe("1h")
    await adapter.getCandles("BTCUSD", { timeframe: 60, count: 50 })
    expect(state.fetchArgs.at(-1).interval).toBe("1m")
  })

  it("falls back to scheduler-fed buffers when no exchange is connected", async () => {
    recordCandles({
      exchange: "binance",
      symbol: "BTC/USDT",
      timeframe: "5m",
      candles: realConnector.normalizeCandles(rawRows(400, { stepMs: 300_000 }))
    })
    const adapter = await loadAdapter()

    const candles = await adapter.getCandles("BTCUSD", { timeframe: 300, count: 100 })

    expect(candles).toHaveLength(100)
    for (const c of candles) expect(c.timeframe).toBe(300)
    const t = candles.map((c) => c.time)
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBe(300)
    expect(state.fetchArgs).toHaveLength(0) // nothing connected → no socket calls
  })

  it("buffer fallback wins when the connected exchange answer is thin or rate-limited", async () => {
    state.connected = ["binance"]
    state.fetchResult = [] // rate limit / failure → connector resolves []
    recordCandles({
      exchange: "binance",
      symbol: "BTC/USDT",
      timeframe: "5m",
      candles: realConnector.normalizeCandles(rawRows(300, { stepMs: 300_000 }))
    })
    const adapter = await loadAdapter()

    const candles = await adapter.getCandles("BTCUSD", { timeframe: 300, count: 100 })

    expect(candles).toHaveLength(100)
    for (const c of candles) expect(c.timeframe).toBe(300)
  })

  it("returns [] for assets CCXT cannot serve (stocks/metals — bus falls through to Yahoo)", async () => {
    const adapter = await loadAdapter()
    expect(await adapter.getCandles("AAPL", { timeframe: 300, count: 50 })).toEqual([])
    expect(await adapter.getCandles("GOLD", { timeframe: 300, count: 50 })).toEqual([])
  })

  it("returns honest [] when nothing is available at all", async () => {
    const adapter = await loadAdapter()
    const candles = await adapter.getCandles("BTCUSD", { timeframe: 300, count: 50 })
    expect(candles).toEqual([]) // never a fabricated series
  })
})