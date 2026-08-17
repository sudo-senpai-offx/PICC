import { describe, expect, it, beforeEach, vi } from "vitest"
import { getCryptoMarket, _clearCryptoCache } from "../services/crypto.mjs"

function jsonRes(payload) {
  return { ok: true, json: async () => payload }
}

describe("crypto market service", () => {
  beforeEach(() => {
    _clearCryptoCache()
  })

  it("maps CoinGecko responses into watchlist + movers + trending", async () => {
    const fetchMock = vi.fn(async (url) => {
      const u = String(url)
      if (u.includes("/simple/price")) {
        return jsonRes({
          bitcoin: { usd: 60000, usd_market_cap: 1.2e12, usd_24h_change: 2.5 },
          ethereum: { usd: 3000, usd_market_cap: 3.5e11, usd_24h_change: -1.2 }
        })
      }
      if (u.includes("/coins/markets")) {
        return jsonRes([
          { id: "btc", symbol: "btc", name: "Bitcoin", current_price: 60000, market_cap: 1.2e12, price_change_percentage_24h: 2.5 },
          { id: "eth", symbol: "eth", name: "Ethereum", current_price: 3000, market_cap: 3.5e11, price_change_percentage_24h: -1.2 }
        ])
      }
      return jsonRes({
        coins: [{ item: { id: "sol", name: "Solana", symbol: "sol", thumb: "x", market_cap_rank: 5 } }]
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = await getCryptoMarket()
    expect(m.watchlist.length).toBe(10)
    const btc = m.watchlist.find((c) => c.id === "bitcoin")
    expect(btc?.price).toBe(60000)
    expect(btc?.change24h).toBeCloseTo(0.025, 5)
    expect(m.movers.gainers[0].symbol).toBe("BTC")
    expect(m.movers.losers[0].symbol).toBe("ETH")
    expect(m.trending[0].name).toBe("Solana")
    vi.unstubAllGlobals()
  })

  it("still returns an empty-but-shape-safe result when CoinGecko fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const m = await getCryptoMarket()
    expect(m.watchlist).toHaveLength(10)
    expect(m.watchlist.every((c) => c.price === null)).toBe(true)
    expect(m.movers.gainers).toEqual([])
    expect(m.movers.losers).toEqual([])
    expect(m.trending).toEqual([])
    vi.unstubAllGlobals()
  })
})
