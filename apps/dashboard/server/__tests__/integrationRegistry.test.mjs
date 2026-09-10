import { describe, expect, it } from "vitest"
import { getAllIntegrations, getMinistryIntegrations } from "../services/integrationRegistry.mjs"

const MINISTRIES = ["trading", "earnings", "intelligence"]

describe("integration registry", () => {
  it("returns exactly 3 trading entries", () => {
    const trading = getMinistryIntegrations("trading")
    expect(trading).toHaveLength(3)
    expect(trading.map((e) => e.id)).toEqual(["twelve-data", "binance-public", "gdelt"])
  })

  it("returns exactly 3 earnings entries", () => {
    const earnings = getMinistryIntegrations("earnings")
    expect(earnings).toHaveLength(3)
    expect(earnings.map((e) => e.id)).toEqual(["sec-edgar-xbrl", "gotcashback", "affiliateroll"])
  })

  it("returns exactly 3 intelligence entries", () => {
    const intelligence = getMinistryIntegrations("intelligence")
    expect(intelligence).toHaveLength(3)
    expect(intelligence.map((e) => e.id)).toEqual(["tavily", "openalex", "arxiv"])
  })

  it("returns [] for an unknown ministry", () => {
    expect(getMinistryIntegrations("unknown-ministry")).toEqual([])
    expect(getMinistryIntegrations("")).toEqual([])
  })

  it("returns all 9 entries across the three ministries", () => {
    const all = getAllIntegrations()
    expect(all).toHaveLength(9)
    for (const ministry of MINISTRIES) {
      expect(all.filter((e) => e.ministry === ministry)).toHaveLength(3)
    }
  })

  it("gives every entry the full honest boundary shape", () => {
    for (const e of getAllIntegrations()) {
      expect(typeof e.id).toBe("string")
      expect(e.id.length).toBeGreaterThan(0)
      expect(MINISTRIES).toContain(e.ministry)
      expect(typeof e.name).toBe("string")
      expect(e.name.length).toBeGreaterThan(0)
      expect(typeof e.url).toBe("string")
      expect(e.url.startsWith("https://")).toBe(true)
      expect(typeof e.purpose).toBe("string")
      expect(e.purpose.length).toBeGreaterThan(0)
      expect(typeof e.boundary).toBe("object")
      expect(typeof e.boundary.freeTier).toBe("string")
      expect(e.boundary.freeTier.length).toBeGreaterThan(0)
      expect(typeof e.boundary.rateLimit).toBe("string")
      expect(e.boundary.rateLimit.length).toBeGreaterThan(0)
      expect(typeof e.boundary.keyRequired).toBe("boolean")
      expect(typeof e.state).toBe("string")
    }
  })

  it("never defaults state to 'connected'", () => {
    for (const e of getAllIntegrations()) {
      expect(e.state).toBe("unconfigured")
    }
  })

  it("keeps every entry id unique across the full set", () => {
    const ids = getAllIntegrations().map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("only returns entries whose ministry matches the query", () => {
    for (const ministry of MINISTRIES) {
      const entries = getMinistryIntegrations(ministry)
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every((e) => e.ministry === ministry)).toBe(true)
    }
  })
})