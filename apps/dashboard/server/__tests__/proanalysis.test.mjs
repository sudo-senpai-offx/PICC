import { beforeEach, describe, expect, it, vi } from "vitest"
import { proAnalyzeCandles, summarizeProAnalysis } from "../services/proanalysis.mjs"
import { chatText, llmConfigured } from "../services/llm.mjs"

vi.mock("../services/llm.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    llmConfigured: vi.fn(() => false),
    chatText: vi.fn(async () => "Mocked LLM narrative.")
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(llmConfigured).mockReturnValue(false)
})

// Deterministic synthetic OHLCV candles so tests never hit the network.
function candlesFromSeries(closes) {
  return closes.map((close, i) => ({
    time: i * 86400000,
    open: close * 0.999,
    high: close * 1.004,
    low: close * 0.996,
    close,
    volume: 100000 + (i % 7) * 10000
  }))
}

function trendSeries(start, dailyReturn, n) {
  const out = []
  let v = start
  for (let i = 0; i < n; i++) {
    out.push(v)
    v = v * (1 + dailyReturn)
  }
  return out
}

function randomishSeries(start, n, seed = 42) {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const out = []
  let v = start
  for (let i = 0; i < n; i++) {
    out.push(v)
    v = v * (1 + (rnd() - 0.5) * 0.01)
  }
  return out
}

describe("proAnalyzeCandles", () => {
  it("needs at least 40 candles", () => {
    const r = proAnalyzeCandles({ candles: candlesFromSeries(trendSeries(100, 0.001, 25)) })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/40/)
  })

  it("reads an uptrend as bullish", () => {
    const r = proAnalyzeCandles({
      candles: candlesFromSeries(trendSeries(100, 0.002, 400)),
      symbol: "TEST", name: "Test", currency: "USD", timeframe: "1d"
    })
    expect(r.ok).toBe(true)
    expect(r.confluence.direction).toBe("up")
    expect(r.confluence.score).toBeGreaterThan(0)
    expect(r.bias.direction).toBe("up")
    expect(["BUY", "NEUTRAL"]).toContain(r.confluence.verdict)
  })

  it("reads a downtrend as bearish", () => {
    const r = proAnalyzeCandles({ candles: candlesFromSeries(trendSeries(100, -0.002, 400)) })
    expect(r.ok).toBe(true)
    expect(r.confluence.direction).toBe("down")
    expect(r.confluence.score).toBeLessThan(0)
    expect(["SELL", "NEUTRAL"]).toContain(r.confluence.verdict)
  })

  it("returns the full report shape", () => {
    const r = proAnalyzeCandles({ candles: candlesFromSeries(randomishSeries(100, 400)) })
    expect(r.ok).toBe(true)
    expect(r.bars).toBe(400)
    expect(r.phase.phase).toBeTruthy()
    expect(r.phase.strategy).toBeTruthy()
    expect(r.ensemble.direction).toMatch(/^(up|down|flat)$/)
    expect(r.confluence.groups).toHaveLength(3)
    for (const gr of r.confluence.groups) {
      expect(gr.score).toBeGreaterThanOrEqual(-1)
      expect(gr.score).toBeLessThanOrEqual(1)
      expect(Array.isArray(gr.evidence)).toBe(true)
    }
    expect(Array.isArray(r.divergences)).toBe(true)
    expect(Array.isArray(r.levels)).toBe(true)
    expect(Array.isArray(r.setups)).toBe(true)
    expect(Array.isArray(r.chartSeries.closes)).toBe(true)
    expect(r.risk.atr).toBeGreaterThan(0)
    expect(r.honesty.length).toBeGreaterThan(20)
    expect(r.advisory.length).toBeGreaterThan(10)
  })

  it("builds a weekly higher-timeframe bias from enough bars", () => {
    const r = proAnalyzeCandles({ candles: candlesFromSeries(trendSeries(100, 0.0015, 400)) })
    expect(r.htf).toBeTruthy()
    expect(r.htf.timeframe).toBe("1W")
    expect(["bullish", "bearish", "mixed"]).toContain(r.htf.biasLabel)
  })

  it("keeps confidence honest (never 100%) and in range", () => {
    for (const [start, ret] of [[100, 0.002], [100, -0.002], [100, 0.0002]]) {
      const r = proAnalyzeCandles({ candles: candlesFromSeries(trendSeries(start, ret, 400)) })
      expect(r.ok).toBe(true)
      expect(r.confluence.confidence).toBeGreaterThanOrEqual(45)
      expect(r.confluence.confidence).toBeLessThanOrEqual(95)
      expect(r.ensemble.confidence).toBeLessThanOrEqual(95)
    }
  })

  it("is deterministic for identical input", () => {
    const candles = candlesFromSeries(randomishSeries(50, 300))
    expect(proAnalyzeCandles({ candles })).toEqual(proAnalyzeCandles({ candles }))
  })

  it("never claims a guarantee and always says read-only", () => {
    const r = proAnalyzeCandles({ candles: candlesFromSeries(trendSeries(100, 0.002, 400)) })
    expect(r.honesty).toMatch(/not financial advice/i)
    expect(r.advisory).toMatch(/read-only/i)
    expect(r.confluence.confidence).toBeLessThanOrEqual(95)
  })
})

describe("summarizeProAnalysis", () => {
  const report = proAnalyzeCandles({
    candles: candlesFromSeries(trendSeries(100, 0.002, 400)),
    symbol: "TEST",
    name: "Test",
    currency: "USD",
    timeframe: "1d"
  })

  it("falls back to a local narrative without a configured LLM", async () => {
    vi.mocked(llmConfigured).mockReturnValue(false)
    const out = await summarizeProAnalysis(report)
    expect(out.ok).toBe(true)
    expect(out.source).toBe("local")
    expect(out.summary.length).toBeGreaterThan(20)
    expect(out.summary).toMatch(/BUY|SELL|NEUTRAL/)
  })

  it("uses the LLM narrative when a provider is configured", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true)
    const out = await summarizeProAnalysis(report)
    expect(out.ok).toBe(true)
    expect(out.source).toBe("llm")
    expect(out.summary).toBe("Mocked LLM narrative.")
    expect(vi.mocked(chatText)).toHaveBeenCalledOnce()
  })

  it("rejects a malformed report", async () => {
    const out = await summarizeProAnalysis({ ok: false })
    expect(out.ok).toBe(false)
  })
})
