import { beforeEach, describe, expect, it } from "vitest"
import { registerConnector, getConnector, hasConnector, listConnectors } from "../services/connectors.mjs"
import { translateSymbol } from "../services/trading.mjs"
import { normalizeYahooSymbol } from "../services/yahoo.mjs"
import { canonicalAssetId } from "../services/assetCatalog.mjs"

beforeEach(() => {
  // Registry is global across the worker — prune test slugs between tests.
  for (const c of listConnectors()) {
    if (["test-a", "test-b"].includes(c.slug)) {
      // No public unregister; re-registering overwrites harmlessly in tests.
    }
  }
})

describe("connector registry", () => {
  it("registers and resolves connectors by slug", () => {
    registerConnector({ slug: "test-a", label: "Test A", category: "test", transports: ["api"], url: "" })
    expect(hasConnector("test-a")).toBe(true)
    expect(getConnector("test-a").label).toBe("Test A")
    expect(listConnectors().some((c) => c.slug === "test-a")).toBe(true)
  })

  it("reports unknown connectors honestly", () => {
    expect(hasConnector("definitely-not-real")).toBe(false)
    expect(getConnector("definitely-not-real")).toBeFalsy()
  })
})

describe("symbol normalization across platforms", () => {
  it("canonicalizes EO display names via the shared asset catalog", () => {
    expect(canonicalAssetId("EUR/USD (OTC)")).toBe("EURUSD")
    expect(canonicalAssetId("Gold (OTC)")).toBe("GOLD")
    expect(canonicalAssetId("Silver (OTC)")).toBe("SILVER")
    expect(canonicalAssetId("Bitcoin")).toBe("BTCUSD")
    expect(canonicalAssetId("US30")).toBe("US30")
  })

  it("translates symbols per destination platform", () => {
    expect(translateSymbol("BTCUSD", "binance")).toBe("BTCUSDT")
    expect(translateSymbol("Bitcoin", "coinbase")).toBe("BTC-USD")
    expect(translateSymbol("", "binance")).toBeNull()
    expect(translateSymbol(undefined, "coinbase")).toBeNull()
  })

  it("keeps Yahoo symbol mapping coherent across the chain", () => {
    const eoTicker = translateSymbol("Bitcoin", "expertoption")
    expect(normalizeYahooSymbol(eoTicker)).toBe("BTC-USD")
    expect(normalizeYahooSymbol("GOLD")).toBe("GC=F")
    expect(normalizeYahooSymbol("US30")).toBe("^DJI")
    expect(normalizeYahooSymbol("EURUSD")).toBe("EURUSD=X")
  })
})
