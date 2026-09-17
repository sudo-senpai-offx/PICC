import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  proAnalyzeCandles,
  buildConfluence,
  summarizeProAnalysis,
  proAnalyzeSymbol,
  proAnalyzeExpertOption
} from "../services/proanalysis.mjs"
import { chatText, llmConfigured } from "../services/llm.mjs"
import { getHistory } from "../services/yahoo.mjs"
import { getCredentials } from "../services/trading.mjs"
import { connectSession } from "../services/expertoption.mjs"

vi.mock("../services/llm.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    llmConfigured: vi.fn(() => false),
    chatText: vi.fn(async () => "Mocked LLM narrative.")
  }
})

// B-FUS-2 fixture sources: the entry points must never hit the real network.
vi.mock("../services/yahoo.mjs", () => ({ getHistory: vi.fn() }))
vi.mock("../services/trading.mjs", () => ({
  getCredentials: vi.fn(async () => ({ expertoptionToken: "tok-demo", expertoptionDemo: true, expertoptionWsUrl: "ws://127.0.0.1:1" }))
}))
vi.mock("../services/expertoption.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, connectSession: vi.fn() }
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

describe("buildConfluence fusion layers (B-FUS-1)", () => {
  // Minimal but complete confluence input: every dashboard read the builder
  // touches is present; analytics are null-ish so legacy items abstain honestly;
  // the range phase exercises the isRange branches.
  function confluenceInput(closes) {
    const dash = {
      linearRegression: { slopePct: null, r2: null },
      alligator: { bull: null, label: "" },
      macd: { line: null, zero: "", hist: null, cross: "" },
      psar: { trend: "" },
      aroon: { osc: 0, read: "" },
      adx: { plusDI: null, minusDI: null },
      rsi: { value: null, read: "" },
      stochRSI: { k: null, read: "" },
      stochastic: { cross: "" },
      awesome: { value: 0, read: "" },
      cci: { value20: null, read: "" },
      williamsR: null,
      cmo: null,
      roc: null,
      momentum: null,
      apo: null,
      bollinger: { percentB: null, bandwidth: null, lower: null, upper: null, mid: null },
      atr: { value: null },
      phase: { volatilityPercentile: null, persistenceLabel: "" }
    }
    return {
      dash,
      series: { closes, ema20: [], ema50: [], ema200: [], psarTrend: "", vwapNow: null },
      phase: { phase: "quiet_range", label: "Range", strategy: {} },
      last: closes.length - 1,
      close: closes[closes.length - 1]
    }
  }

  const closes = trendSeries(100, 0.002, 400)
  const base = buildConfluence(confluenceInput(closes))
  const regimeItems = [
    { name: "regime 3600s", weight: 1, bull: 0.8, read: "TRENDING · conf 0.81 · volatile", source: "regimeEngine" },
    { name: "regime 900s", weight: 1, bull: -0.4, read: "RANGING · conf 0.62", source: "regimeEngine" }
  ]
  const mtfItems = [
    { name: "mtf 3600s", weight: 0.8, bull: 1, read: "composite LONG · score5 4/5", source: "liveEO-buffers" }
  ]

  it("without a layers argument keeps the legacy three groups and score", () => {
    expect(base.groups.map((gr) => gr.id)).toEqual(["trend", "momentum", "volatility"])
    expect(base.groups).toHaveLength(3)
    expect(Number.isFinite(base.score)).toBe(true)
  })

  it("shows honest observed:false groups when layer input is absent", () => {
    const r = buildConfluence({ ...confluenceInput(closes), layers: { regime: [], mtf: null } })
    expect(r.groups.map((gr) => gr.id)).toEqual(["trend", "momentum", "volatility", "regimeLayer", "mtfLayer"])
    for (const gr of r.groups.slice(3)) {
      expect(gr).toMatchObject({ weight: 0, score: 0, evidence: [], observed: false })
    }
    // scoreGroup skips them — the blend sum is unchanged.
    expect(r.score).toBe(base.score)
    expect(r.direction).toBe(base.direction)
  })

  it("drops abstaining items into observed:false and never fakes a read", () => {
    const r = buildConfluence({
      ...confluenceInput(closes),
      layers: {
        regime: [{ name: "regime 3600s", weight: 1, bull: 0, read: "MIN_BARS abstention", source: "regimeEngine" }]
      }
    })
    const layer = r.groups.find((gr) => gr.id === "regimeLayer")
    expect(layer).toMatchObject({ score: 0, evidence: [], observed: false })
    expect(r.score).toBe(base.score)
  })

  it("surfaces observed layer evidence with its source labels, documentary only", () => {
    const r = buildConfluence({ ...confluenceInput(closes), layers: { regime: regimeItems, mtf: mtfItems } })
    const regime = r.groups.find((gr) => gr.id === "regimeLayer")
    const mtf = r.groups.find((gr) => gr.id === "mtfLayer")
    expect(regime.observed).toBe(true)
    expect(regime.score).toBeCloseTo(0.2) // (0.8 + (-0.4)) / 2
    expect(regime.evidence).toEqual(regimeItems)
    expect(regime.evidence.every((e) => e.source === "regimeEngine")).toBe(true)
    expect(mtf.observed).toBe(true)
    expect(mtf.score).toBeCloseTo(1)
    expect(mtf.evidence[0].source).toBe("liveEO-buffers")
    expect(mtf.evidence[0].read).toBe(mtfItems[0].read)
    // The layers never enter the blend: the classic score stays put.
    expect(r.score).toBe(base.score)
  })
})

describe("fusion-layer wiring (B-FUS-2)", () => {
  // Turn deterministic candles into the normalized shape yahoo.mjs getHistory
  // returns, so the entry point stays fixture-driven — never the real network.
  function historyFrom(candles, symbol = "TEST", name = "Test Asset") {
    return {
      closes: candles.map((c) => c.close),
      opens: candles.map((c) => c.open),
      highs: candles.map((c) => c.high),
      lows: candles.map((c) => c.low),
      volumes: candles.map((c) => c.volume),
      dates: candles.map((c) => c.time),
      symbol,
      name,
      currency: "USD",
      lastPrice: candles[candles.length - 1]?.close ?? null
    }
  }

  it("Yahoo path: wires regime + MTF layers from fetched history, one network call only", async () => {
    const candles = candlesFromSeries(trendSeries(100, 0.002, 400))
    vi.mocked(getHistory).mockResolvedValue(historyFrom(candles))

    const r = await proAnalyzeSymbol("TEST")

    expect(getHistory).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
    expect(r.platform).toBe("Yahoo")
    expect(r.confluence.groups.map((g) => g.id)).toEqual(["trend", "momentum", "volatility", "regimeLayer", "mtfLayer"])

    const regime = r.confluence.groups.find((g) => g.id === "regimeLayer")
    expect(regime.observed).toBe(true)
    expect(regime.evidence.map((e) => e.name)).toEqual(["regime 1d", "regime 5d"])
    for (const e of regime.evidence) {
      expect(e.source).toBe("regimeEngine")
      expect(e.bull).toBeGreaterThan(0)
      expect(e.bull).toBeLessThanOrEqual(1)
      expect(e.read).toContain("TRENDING")
    }

    const mtf = r.confluence.groups.find((g) => g.id === "mtfLayer")
    expect(mtf.observed).toBe(true)
    expect(mtf.evidence.map((e) => e.name)).toEqual(["mtf 1d", "mtf 5d"])
    expect(mtf.evidence.every((e) => e.source === "liveEO-buffers" && e.bull === 1)).toBe(true)
    expect(mtf.evidence[0].read).toContain("composite LONG")
    expect(mtf.evidence[0].read).toMatch(/score5 \d+\/5/)
    expect(mtf.evidence[0].read).toMatch(/quality \d+\/10/)

    // Layers never enter the blend: the entry point's score, verdict and the
    // three legacy groups are byte-identical to the no-layers path on the
    // same candles (spec REQ-R5 / R3).
    const baseline = proAnalyzeCandles({ candles, symbol: "TEST", timeframe: "1d" })
    expect(r.confluence.score).toBe(baseline.confluence.score)
    expect(r.confluence.verdict).toBe(baseline.confluence.verdict)
    expect(r.confluence.groups.slice(0, 3).map((g) => [g.id, g.score])).toEqual(
      baseline.confluence.groups.map((g) => [g.id, g.score])
    )

    // Documentary layers surface in the narrative too. (reasoning lines are
    // not guaranteed to be plain strings — phase.strategy may be an object.)
    expect(JSON.stringify(r.confluence.reasoning)).toContain("Regime layer")
  })

  it("ExpertOption path: wires layers over liveEO buffers, one candles() call", async () => {
    // 300 x 60s bars so the 5m sibling (60 bars) clears the 50-bar regression
    // period and can contribute a directional read; floor for bars is 40.
    const candles = candlesFromSeries(trendSeries(100, 0.002, 300))
    const session = {
      assets: vi.fn(async () => ({ assets: [{ id: "TEST", name: "Test Asset" }] })),
      candles: vi.fn(async () => ({ closes: candles.map((c) => c.close), ohlc: candles, count: candles.length })),
      balance: vi.fn(async () => ({ balance: 1000, currency: "USD", demo: true })),
      close: vi.fn()
    }
    vi.mocked(connectSession).mockResolvedValue(session)

    const r = await proAnalyzeExpertOption({ assetId: "TEST", timeframe: 60, count: 300 })

    expect(connectSession).toHaveBeenCalledTimes(1)
    expect(connectSession).toHaveBeenCalledWith(expect.objectContaining({ token: "tok-demo", isDemo: true }))
    expect(session.candles).toHaveBeenCalledTimes(1)
    expect(session.candles).toHaveBeenCalledWith("TEST", 60, 300)
    expect(session.close).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
    expect(r.platform).toBe("ExpertOption")
    expect(r.confluence.groups.map((g) => g.id)).toEqual(["trend", "momentum", "volatility", "regimeLayer", "mtfLayer"])

    const regime = r.confluence.groups.find((g) => g.id === "regimeLayer")
    expect(regime.observed).toBe(true)
    expect(regime.evidence.map((e) => e.name)).toEqual(["regime 1m", "regime 5m"])

    const mtf = r.confluence.groups.find((g) => g.id === "mtfLayer")
    expect(mtf.observed).toBe(true)
    expect(mtf.evidence.map((e) => e.name)).toEqual(["mtf 1m", "mtf 5m"])
    expect(mtf.evidence.every((e) => e.source === "liveEO-buffers")).toBe(true)
  })

  it("thin histories keep only the base plane — the sub-minimum aggregate is not smuggled in", async () => {
    // 45 daily bars: a valid report (>= 40), but the 5d sibling aggregates to
    // 9 bars < MIN_BARS(30), so the MTF layer must read the 1d plane only.
    // The regime layer stays honest too: with a single plane whose only lean
    // vote is ADX, the engine's consensus is UNCERTAIN (< TREND_MAJORITY=2),
    // so it reports observed:false rather than a fabricated TRENDING.
    const candles = candlesFromSeries(trendSeries(100, 0.002, 45))
    vi.mocked(getHistory).mockResolvedValue(historyFrom(candles))

    const r = await proAnalyzeSymbol("TEST")

    expect(r.ok).toBe(true)
    expect(getHistory).toHaveBeenCalledTimes(1)
    const regime = r.confluence.groups.find((g) => g.id === "regimeLayer")
    const mtf = r.confluence.groups.find((g) => g.id === "mtfLayer")
    expect(regime).toMatchObject({ observed: false, score: 0, evidence: [] })
    expect(mtf.evidence.map((e) => e.name)).toEqual(["mtf 1d"])
  })

  it("unknown intervals render observed:false layers instead of guessing a timeframe", async () => {
    const candles = candlesFromSeries(trendSeries(100, 0.002, 400))
    vi.mocked(getHistory).mockResolvedValue(historyFrom(candles))

    const r = await proAnalyzeSymbol("TEST", { interval: "odd" })

    expect(r.ok).toBe(true)
    expect(r.confluence.groups.map((g) => g.id)).toEqual(["trend", "momentum", "volatility", "regimeLayer", "mtfLayer"])
    for (const gr of r.confluence.groups.slice(3)) {
      expect(gr).toMatchObject({ weight: 0, score: 0, evidence: [], observed: false })
    }
  })

  it("a ranging market exposes no directional regime evidence — never a fabricated lean", async () => {
    const candles = candlesFromSeries(randomishSeries(100, 400))
    vi.mocked(getHistory).mockResolvedValue(historyFrom(candles))

    const r = await proAnalyzeSymbol("TEST")

    expect(r.ok).toBe(true)
    const regime = r.confluence.groups.find((g) => g.id === "regimeLayer")
    expect(regime.observed).toBe(false)
    expect(regime.evidence).toEqual([])
    expect(regime.score).toBe(0)
    // The legacy read still computes over the same candles.
    expect(r.confluence.groups.slice(0, 3).every((g) => Number.isFinite(g.score))).toBe(true)
  })
})
