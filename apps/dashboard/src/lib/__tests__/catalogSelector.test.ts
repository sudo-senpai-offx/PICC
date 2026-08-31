import { describe, expect, it } from "vitest"
import { assetOptionGroups, type CatalogCategory } from "../trading"

// T4 acceptance (client half): watched assets are pinned on top, catalog
// groups render category-named, old hardcoded option list is gone (grep in
// TradingSuite.tsx), EURUSD remains reachable as the default.

const CATALOG: CatalogCategory[] = [
  {
    id: "crypto",
    name: "Crypto",
    symbols: [
      { id: "BTCUSD", name: "Bitcoin (BTC/USD)", yahooSymbol: "BTC-USD" },
      { id: "ETHUSD", name: "Ethereum (ETH/USD)", yahooSymbol: "ETH-USD" }
    ]
  },
  {
    id: "metals",
    name: "Metals",
    symbols: [{ id: "GOLD", name: "Gold (XAU)", yahooSymbol: "GC=F" }]
  }
]

describe("assetOptionGroups (T4 selector)", () => {
  it("pins watched assets on top when present", () => {
    const groups = assetOptionGroups(CATALOG, ["XAUUSD", "BTCUSDT"])
    expect(groups[0].label).toBe("Watched")
    expect(groups[0].options.map((o) => o.value)).toEqual(["XAUUSD", "BTCUSDT"])
    expect(groups[1].label).toBe("Crypto")
  })

  it("omits the Watched group when nothing is watched", () => {
    const groups = assetOptionGroups(CATALOG, [])
    expect(groups[0].label).toBe("Crypto")
  })

  it("maps each category to a named group of id/label options", () => {
    const groups = assetOptionGroups(CATALOG, [])
    const crypto = groups[0]
    expect(crypto.label).toBe("Crypto")
    expect(crypto.options).toContainEqual({ value: "BTCUSD", label: "Bitcoin (BTC/USD)" })
  })

  it("keeps every catalog id reachable — EURUSD-style defaults stay selectable", () => {
    const groups = assetOptionGroups(CATALOG, [])
    const all = groups.flatMap((g) => g.options.map((o) => o.value))
    expect(all).toEqual(expect.arrayContaining(["BTCUSD", "GOLD"]))
  })
})