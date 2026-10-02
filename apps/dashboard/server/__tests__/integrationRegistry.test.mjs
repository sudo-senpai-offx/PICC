// The per-ministry integration catalog, and — since WS-7 T18 — the D17
// news/sentiment rows DERIVED from `newsSources.mjs` rather than restated here.
//
// The counts in this file are asserted rather than computed, because a count
// assertion is what makes an addition visible in review. T18 moved the hand-
// written `gdelt` row out of this catalog and into the D17 registry, so the
// trading ministry gained five derived rows and lost the duplicate: 7 total
// (2 static + 5 derived), 13 across the three ministries.
import { describe, expect, it } from "vitest"
import { getAllIntegrations, getMinistryIntegrations } from "../services/integrationRegistry.mjs"
import { NEWS_SOURCES, RETRIEVAL_MODE_VALUES } from "../services/newsSources.mjs"

const MINISTRIES = ["trading", "earnings", "intelligence"]
const BARE = { PICC_NEWS_FEEDS: "", PICC_NEWS_GDELT: "", NEWSAPI_API_KEY: "", CRYPTOPANIC_AUTH_TOKEN: "", PICC_NEWS_BROWSER_SOURCES: "" }

describe("integration registry", () => {
  it("returns 7 trading entries: 2 static market-data + the 5 D17 news/sentiment rows", () => {
    const trading = getMinistryIntegrations("trading", BARE)
    expect(trading).toHaveLength(2 + NEWS_SOURCES.length)
    expect(trading.map((e) => e.id)).toEqual([
      "twelve-data",
      "binance-public",
      "rss-atom",
      "gdelt",
      "newsapi",
      "cryptopanic",
      "picc-own-browser"
    ])
  })

  it("returns exactly 3 earnings entries", () => {
    const earnings = getMinistryIntegrations("earnings", BARE)
    expect(earnings).toHaveLength(3)
    expect(earnings.map((e) => e.id)).toEqual(["sec-edgar-xbrl", "gotcashback", "affiliateroll"])
  })

  it("returns exactly 3 intelligence entries", () => {
    const intelligence = getMinistryIntegrations("intelligence", BARE)
    expect(intelligence).toHaveLength(3)
    expect(intelligence.map((e) => e.id)).toEqual(["tavily", "openalex", "arxiv"])
  })

  it("returns [] for an unknown ministry", () => {
    expect(getMinistryIntegrations("unknown-ministry", BARE)).toEqual([])
    expect(getMinistryIntegrations("", BARE)).toEqual([])
  })

  it("returns all 13 entries across the three ministries", () => {
    const all = getAllIntegrations(BARE)
    expect(all).toHaveLength(13)
    expect(all.filter((e) => e.ministry === "trading")).toHaveLength(7)
    for (const ministry of MINISTRIES) {
      expect(all.filter((e) => e.ministry === ministry).length).toBeGreaterThan(0)
    }
  })

  it("gives every entry the full honest boundary shape", () => {
    for (const e of getAllIntegrations(BARE)) {
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
    for (const e of getAllIntegrations(BARE)) {
      expect(e.state).toBe("unconfigured")
    }
  })

  it("keeps every entry id unique across the full set — no duplicated GDELT row", () => {
    // The specific regression T18's move could have caused: a hand-written
    // `gdelt` row left behind beside the derived one would render twice in the
    // Settings room and give one source two states.
    const ids = getAllIntegrations(BARE).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((i) => i === "gdelt")).toHaveLength(1)
  })

  it("only returns entries whose ministry matches the query", () => {
    for (const ministry of MINISTRIES) {
      const entries = getMinistryIntegrations(ministry, BARE)
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every((e) => e.ministry === ministry)).toBe(true)
    }
  })
})

// ── WS-7 T18: the D17 rows, and what the room is now able to show ─────────────

describe("integration registry — WS-7 T18's derived D17 rows", () => {
  const newsRows = () =>
    getMinistryIntegrations("trading", BARE).filter((e) => NEWS_SOURCES.some((s) => s.id === e.id))

  it("every D17 row names its RETRIEVAL MODE and its LICENSED BASIS", () => {
    const rows = newsRows()
    expect(rows).toHaveLength(NEWS_SOURCES.length)
    for (const r of rows) {
      expect(RETRIEVAL_MODE_VALUES, `${r.id} has an unknown retrieval mode`).toContain(r.retrievalMode)
      expect(typeof r.licensedBasis).toBe("string")
      expect(r.licensedBasis.length).toBeGreaterThan(0)
    }
  })

  it("every D17 row names its ABSENCE REASON when unconfigured", () => {
    for (const r of newsRows()) {
      expect(r.state).toBe("unconfigured")
      expect(r.configEvidence).toBeNull()
      expect(typeof r.unconfiguredReason).toBe("string")
      expect(r.unconfiguredReason).toMatch(/absence, not a neutral reading/)
    }
  })

  it("a configured source reads `degraded` and NEVER `connected` — nothing is probed", () => {
    // The Serper-badge discipline T5 established: a key in the environment says
    // nothing about whether the source answered, so the room must not render
    // "connected" for a source nobody has ever fetched.
    const rows = getMinistryIntegrations("trading", {
      PICC_NEWS_FEEDS: "https://feeds.test/news",
      PICC_NEWS_GDELT: "on",
      NEWSAPI_API_KEY: "k",
      PICC_NEWS_NEWSAPI: "on",
      CRYPTOPANIC_AUTH_TOKEN: "t",
      PICC_NEWS_CRYPTOPANIC: "on",
      PICC_NEWS_BROWSER_SOURCES: "https://page.test/news"
    })
    for (const r of rows) expect(r.state, `${r.id} claimed connected`).not.toBe("connected")
    const derived = rows.filter((r) => NEWS_SOURCES.some((s) => s.id === r.id))
    for (const r of derived) {
      expect(r.state).toBe("degraded")
      expect(r.configEvidence).toBeTruthy()
      expect(r.unconfiguredReason).toBeNull()
    }
  })

  it("the derived half is DERIVED — the registry adds no news row of its own", () => {
    // If somebody hand-adds a source here instead of in `newsSources.mjs`, the
    // Settings room and the engine would answer differently. This pins that the
    // news rows are exactly the registry's, no more.
    const ids = newsRows().map((r) => r.id)
    expect(new Set(ids)).toEqual(new Set(NEWS_SOURCES.map((s) => s.id)))
  })

  it("env is read at CALL time, so the room answers for the configuration in force", () => {
    const before = getMinistryIntegrations("trading", BARE).find((r) => r.id === "gdelt")
    const after = getMinistryIntegrations("trading", { ...BARE, PICC_NEWS_GDELT: "on" }).find((r) => r.id === "gdelt")
    expect(before.state).toBe("unconfigured")
    expect(after.state).toBe("degraded")
  })
})