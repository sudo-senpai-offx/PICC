import { describe, expect, it } from "vitest"
import { parseCcxtPairsJson } from "@/lib/trading"

describe("parseCcxtPairsJson", () => {
  it("parses a well-formed pairs array", () => {
    const r = parseCcxtPairsJson(
      JSON.stringify([
        { exchange: "binance", symbol: "BTCUSDT", timeframe: "5m" },
        { exchange: "Coinbase", symbol: "ETH/USD", timeframe: "1m", limit: 300 }
      ])
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pairs).toEqual([
      { exchange: "binance", symbol: "BTCUSDT", timeframe: "5m" },
      { exchange: "coinbase", symbol: "ETH/USD", timeframe: "1m", limit: 300 }
    ])
  })

  it("lowercases exchange and trims whitespace like the server sanitizer", () => {
    const r = parseCcxtPairsJson(`[ { "exchange": "  BINANCE  ", "symbol": " SOLUSDT " } ]`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pairs).toEqual([{ exchange: "binance", symbol: "SOLUSDT" }])
  })

  it("accepts an empty string as an empty list (no pairs configured)", () => {
    const r = parseCcxtPairsJson("")
    expect(r).toEqual({ ok: true, pairs: [] })
  })

  it("rejects non-JSON input with a helpful error", () => {
    const r = parseCcxtPairsJson("this is not json")
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("Not valid JSON")
  })

  it("rejects a non-array payload", () => {
    const r = parseCcxtPairsJson(`{ "exchange": "binance" }`)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("must be a JSON array")
  })

  it("rejects an entry missing exchange or symbol", () => {
    const r = parseCcxtPairsJson(`[ { "exchange": "binance" }, { "symbol": "BTCUSDT" } ]`)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("non-blank exchange and symbol")
  })

  it("caps at 12 pairs to match the server slice", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ exchange: "binance", symbol: `SYM${i}` }))
    const r = parseCcxtPairsJson(JSON.stringify(many))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pairs).toHaveLength(12)
  })

  it("clamps limit into 1..1000", () => {
    const r = parseCcxtPairsJson(`[ { "exchange": "binance", "symbol": "BTCUSDT", "limit": 5000 } ]`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pairs[0].limit).toBe(1000)
  })
})