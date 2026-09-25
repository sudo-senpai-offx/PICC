// WS-6 T2 — legacy deep-link compatibility adapter (RED).
//
// AC-001 requires the new shell to load an existing `asset`/`panel`/`venue`
// link, select the requested room/focus, keep the URL intelligible, and NOT:
//   - discard unknown legacy keys
//   - silently reset to a default room
//   - issue a second realtime subscription
//
// The legacy contract is `TradingSuite.tsx:159-199` and is frozen by WS-6 T0.
// This adapter is a PURE classifier so it can be tested with no React, no DOM,
// and no socket. Side effects (chart focus, broker tab) stay in the component.
import { describe, expect, it } from "vitest"
import {
  parseDeepLink,
  resolveAssetSelection,
  shouldLandVenue
} from "../deepLink"

const qs = (s: string) => new URLSearchParams(s)

describe("deep link — gate (legacy TradingSuite.tsx:168)", () => {
  it("is not a deep link when asset, panel=chart, and venue are all absent", () => {
    const i = parseDeepLink(qs(""))
    expect(i.isDeepLink).toBe(false)
    expect(i.asset).toBeNull()
    expect(i.panel).toBeNull()
    expect(i.venue).toBeNull()
  })

  it("treats a bare unrelated panel as NOT a deep link, matching the legacy guard", () => {
    // Legacy: `if (!asset && panel !== "chart" && !venue) return`
    // panel=table is therefore inert.
    const i = parseDeepLink(qs("panel=table"))
    expect(i.isDeepLink).toBe(false)
  })

  it("is a deep link for asset alone, panel=chart alone, or venue alone", () => {
    expect(parseDeepLink(qs("asset=BTCUSDT")).isDeepLink).toBe(true)
    expect(parseDeepLink(qs("panel=chart")).isDeepLink).toBe(true)
    expect(parseDeepLink(qs("venue=hyperliquid")).isDeepLink).toBe(true)
  })
})

describe("deep link — parsing", () => {
  it("parses all three keys when present together", () => {
    const i = parseDeepLink(qs("asset=BTCUSDT&panel=chart&venue=hyperliquid"))
    expect(i).toMatchObject({ isDeepLink: true, asset: "BTCUSDT", panel: "chart", venue: "hyperliquid" })
  })

  it("focuses the chart only for the exact panel value 'chart'", () => {
    expect(parseDeepLink(qs("panel=chart")).wantsChartFocus).toBe(true)
    expect(parseDeepLink(qs("panel=Chart")).wantsChartFocus).toBe(false)
    expect(parseDeepLink(qs("panel=table")).wantsChartFocus).toBe(false)
  })

  it("preserves unknown legacy keys instead of discarding them", () => {
    // AC-001 prohibited side effect.
    const i = parseDeepLink(qs("asset=BTCUSDT&legacyFlag=1&source=notification"))
    expect(i.isDeepLink).toBe(true)
    expect(i.unknownKeys).toEqual(expect.arrayContaining(["legacyFlag", "source"]))
    // The recognized key still parses.
    expect(i.asset).toBe("BTCUSDT")
  })

  it("does not treat recognized keys as unknown", () => {
    const i = parseDeepLink(qs("asset=BTCUSDT&panel=chart&venue=hyperliquid"))
    expect(i.unknownKeys).toEqual([])
  })

  it("accepts a raw query string as well as URLSearchParams", () => {
    expect(parseDeepLink("asset=BTCUSDT&panel=chart").asset).toBe("BTCUSDT")
  })

  it("never throws on empty, malformed, or repeated input", () => {
    for (const input of ["", "?", "&&&", "=&=&", "asset=", "asset=%20%20"]) {
      expect(() => parseDeepLink(input)).not.toThrow()
    }
  })

  it("treats a blank asset value as absent rather than selecting ''", () => {
    const i = parseDeepLink(qs("asset=%20%20&venue=hyperliquid"))
    expect(i.asset).toBeNull()
    expect(i.isDeepLink).toBe(true)
  })
})

describe("deep link — venue landing dedupe (legacy TradingSuite.tsx:183-184)", () => {
  it("builds the dedupe key from venue and asset", () => {
    expect(parseDeepLink(qs("venue=hyperliquid&asset=BTCUSDT")).venueDedupeKey).toBe("hyperliquid|BTCUSDT")
  })

  it("builds the dedupe key with an empty asset segment when asset is absent", () => {
    expect(parseDeepLink(qs("venue=hyperliquid")).venueDedupeKey).toBe("hyperliquid|")
  })

  it("has no venue key when no venue is requested", () => {
    expect(parseDeepLink(qs("asset=BTCUSDT")).venueDedupeKey).toBeNull()
  })

  it("lands once per key, then refuses a repeat of the same key", () => {
    const key = "hyperliquid|BTCUSDT"
    expect(shouldLandVenue(key, null)).toBe(true)
    expect(shouldLandVenue(key, key)).toBe(false)
  })

  it("lands again for a different venue or a different asset", () => {
    expect(shouldLandVenue("hyperliquid|BTCUSDT", "hyperliquid|")).toBe(true)
    expect(shouldLandVenue("hyperliquid|", "hyperliquid|BTCUSDT")).toBe(true)
  })
})

describe("deep link — unknown asset degrades, never resets (legacy TradingSuite.tsx:173-177)", () => {
  it("selects a known asset", () => {
    const r = resolveAssetSelection("BTCUSDT", ["EURUSD", "BTCUSDT"], "EURUSD")
    expect(r).toMatchObject({ next: "BTCUSDT", changed: true, known: true })
  })

  it("leaves the selection UNCHANGED for an unknown asset", () => {
    // AC-001 prohibited side effect: no silent reset to a default room.
    const r = resolveAssetSelection("NOPE", ["EURUSD", "BTCUSDT"], "EURUSD")
    expect(r.next).toBe("EURUSD")
    expect(r.changed).toBe(false)
    expect(r.known).toBe(false)
    expect(r.reason).toMatch(/unknown/i)
  })

  it("reports changed=false when the requested asset is already selected", () => {
    const r = resolveAssetSelection("EURUSD", ["EURUSD"], "EURUSD")
    expect(r).toMatchObject({ next: "EURUSD", changed: false, known: true })
  })

  it("leaves the selection unchanged when no asset was requested", () => {
    const r = resolveAssetSelection(null, ["EURUSD"], "EURUSD")
    expect(r).toMatchObject({ next: "EURUSD", changed: false })
  })
})
