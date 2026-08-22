import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockData } = vi.hoisted(() => ({
  mockData: { cache: {}, history: [] }
}))

vi.mock("../services/serper.mjs", () => ({
  news: vi.fn().mockResolvedValue([])
}))

vi.mock("../services/localstore.mjs", () => ({
  localStore: () => ({
    data: mockData,
    write: vi.fn()
  })
}))

const { getSentiment } = await import("../services/sentimentEngine.mjs")
const { news: serperNews } = await import("../services/serper.mjs")

beforeEach(() => {
  vi.clearAllMocks()
  mockData.cache = {}
  mockData.history = []
  serperNews.mockResolvedValue([])
})

describe("getSentiment", () => {
  it("returns neutral composite for null symbol", async () => {
    const result = await getSentiment(null)
    expect(result.composite.score).toBe(0)
    expect(result.composite.label).toBe("Neutral")
  })

  it("returns neutral for undefined symbol", async () => {
    const result = await getSentiment(undefined)
    expect(result.composite.score).toBe(0)
  })

  it("returns neutral for numeric-only EO IDs", async () => {
    const result = await getSentiment("12345")
    expect(result.composite.score).toBe(0)
    expect(result.composite.label).toBe("Neutral")
    expect(serperNews).not.toHaveBeenCalled()
  })

  it("calls serper with normalized symbol for known pairs", async () => {
    serperNews.mockResolvedValue([
      { title: "EURUSD rallies on ECB hawkish stance", snippet: "Euro surges against dollar" },
      { title: "EURUSD drops on weak PMI", snippet: "Euro falls after data miss" }
    ])
    const result = await getSentiment("EUR/USD")
    expect(result.symbol).toBe("EURUSD")
    expect(serperNews).toHaveBeenCalledWith("EURUSD trading news", 10)
  })

  it("strips OTC suffix before normalization", async () => {
    serperNews.mockResolvedValue([])
    const result = await getSentiment("GBPUSD-OTC")
    expect(result.symbol).toBe("GBPUSD")
    expect(serperNews).toHaveBeenCalledWith("GBPUSD trading news", 10)
  })

  it("returns composite score between -1 and 1", async () => {
    serperNews.mockResolvedValue(
      Array.from({ length: 10 }, () => ({
        title: "Markets rally and surge",
        snippet: "strong gains across the board"
      }))
    )
    const result = await getSentiment("USDJPY")
    expect(result.composite.score).toBeGreaterThanOrEqual(-1)
    expect(result.composite.score).toBeLessThanOrEqual(1)
  })

  it("caches results within 5-minute window", async () => {
    serperNews.mockResolvedValue([{ title: "Markets rally", snippet: "strong gains" }])
    await getSentiment("USDCAD")
    await getSentiment("USDCAD")
    expect(serperNews).toHaveBeenCalledTimes(1)
  })

  it("uses strongly bullish news to produce positive composite", async () => {
    serperNews.mockResolvedValue(
      Array.from({ length: 10 }, () => ({
        title: "Markets rally and surge to record highs",
        snippet: "bull run continues with massive gains"
      }))
    )
    const result = await getSentiment("EURNZD")
    expect(result.composite.score).toBeGreaterThan(0)
    expect(result.composite.label).toMatch(/bullish/i)
  })

  it("uses strongly bearish news to produce negative composite", async () => {
    serperNews.mockResolvedValue(
      Array.from({ length: 10 }, () => ({
        title: "Markets crash drop to new lows",
        snippet: "bear slump decline deep losses"
      }))
    )
    const result = await getSentiment("AUDNZD")
    expect(result.composite.score).toBeLessThan(0)
    expect(result.composite.label).toMatch(/bearish/i)
  })

  it("returns neutral when news source errors", async () => {
    serperNews.mockRejectedValue(new Error("network"))
    const result = await getSentiment("AUDCAD")
    expect(result.composite.score).toBe(0)
    expect(result.news.sampleSize).toBe(0)
  })

  it("handles mixed news to produce near-neutral composite", async () => {
    serperNews.mockResolvedValue([
      { title: "Markets rally on strong data", snippet: "gains" },
      { title: "Stocks crash on fears", snippet: "decline" },
      { title: "Trading range bound", snippet: "unchanged" },
    ])
    const result = await getSentiment("AUDCHF")
    expect(Math.abs(result.composite.score)).toBeLessThan(0.5)
  })
})

describe("computeComposite (via getSentiment)", () => {
  it("labels score > 0.3 as Bullish", async () => {
    serperNews.mockResolvedValue(
      Array.from({ length: 10 }, () => ({
        title: "Markets surge rally soar jump",
        snippet: "bull gains high strong record beat"
      }))
    )
    const result = await getSentiment("CADJPY")
    if (result.composite.score > 0.3) {
      expect(result.composite.label).toBe("Bullish")
    }
  })

  it("labels score < -0.3 as Bearish", async () => {
    serperNews.mockResolvedValue(
      Array.from({ length: 10 }, () => ({
        title: "Markets crash drop fall slump weak",
        snippet: "bear decline loss miss low losses crash"
      }))
    )
    const result = await getSentiment("CHFJPY")
    if (result.composite.score < -0.3) {
      expect(result.composite.label).toBe("Bearish")
    }
  })

  it("marks extreme when absolute score > 0.5", async () => {
    serperNews.mockResolvedValue(
      Array.from({ length: 10 }, () => ({
        title: "Markets rally surge soar jump high",
        snippet: "bull rally gains strong beat record soar"
      }))
    )
    const result = await getSentiment("NZDJPY")
    if (Math.abs(result.composite.score) > 0.5) {
      expect(result.composite.extreme).toBe(true)
    }
  })
})
