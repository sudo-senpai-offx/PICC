import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tmp = mkdtempSync(join(tmpdir(), "picc-decision-engine-"))
process.env.PICC_TRADING_DATA_DIR = tmp
process.env.PICC_DATA_DIR = tmp

const mockFeed = { data: null }

vi.mock("../services/liveEO.mjs", () => ({
  liveEOData: () => mockFeed.data,
  subscribeLiveEO: () => () => {},
  startLiveEO: async () => {},
  stopLiveEO: async () => {},
  restartLiveEO: async () => false,
  softReconnectLiveEO: async () => {},
  liveSnapshot: () => ({ status: "idle" }),
  liveEOStats: () => ({ status: "idle" })
}))

let confluence
let autopilot
let kelly
let orderFlow
let mtf
let trading
let localstore

beforeAll(async () => {
  confluence = await import("../services/adaptiveConfluence.mjs")
  autopilot = await import("../services/autopilot.mjs")
  kelly = await import("../services/kellyCriterion.mjs")
  orderFlow = await import("../services/orderFlow.mjs")
  mtf = await import("../services/multiTimeframe.mjs")
  trading = await import("../services/trading.mjs")
  localstore = await import("../services/localstore.mjs")
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

function trendCandles(n = 60, step = 0.2, base = 100) {
  return Array.from({ length: n }, (_, i) => {
    const close = base + step * i
    return { time: i * 60, open: close - step, high: close + Math.abs(step) * 0.25, low: close - Math.abs(step) * 0.25, close }
  })
}

function flatCandles(n = 80, price = 100) {
  return Array.from({ length: n }, (_, i) => ({ time: i * 60, open: price, high: price, low: price, close: price }))
}

function wiggleTrend(n, driftPct, wigglePct, base = 100) {
  return Array.from({ length: n }, (_, i) => {
    const close = base * (1 + driftPct * i) * (1 + wigglePct * Math.sin(i * 0.7))
    const open = base * (1 + driftPct * Math.max(0, i - 1)) * (1 + wigglePct * Math.sin((i - 1) * 0.7))
    return { time: i * 60, open, high: Math.max(open, close) * 1.0005, low: Math.min(open, close) * 0.9995, close }
  })
}

function mirrorCandles(candles, anchor = 100) {
  return candles.map((c) => ({
    time: c.time,
    open: 2 * anchor - c.open,
    high: 2 * anchor - c.low,
    low: 2 * anchor - c.high,
    close: 2 * anchor - c.close
  }))
}

function feed(assets) {
  return { status: "connected", mode: "demo", account: null, viewed: null, watching: [], assets, ts: Date.now() }
}

function eoAsset(id, periods) {
  return { id, name: id, type: "currency", periods, ticks: { count: 0, up: 0, down: 0, delta: 0, ratePerMin: 0, profile: [], proxy: "tick-activity" } }
}

describe("decision engine guards (getDecisions)", () => {
  beforeEach(() => {
    mockFeed.data = null
    confluence.stopDecisionEngine()
  })

  it("recommends no trade when candle buffers are empty", async () => {
    mockFeed.data = feed([])
    const snap = await confluence.getDecisions()
    expect(Array.isArray(snap.decisions)).toBe(true)
    expect(snap.decisions).toHaveLength(0)
    expect(snap.decisions.some((d) => d.verdict === "TRADE")).toBe(false)
  })

  it("recommends no trade when candles are insufficient (< 20)", async () => {
    mockFeed.data = feed([eoAsset("142", { 60: trendCandles(12) })])
    const snap = await confluence.getDecisions()
    expect(snap.decisions).toHaveLength(0)
    expect(snap.decisions.some((d) => d.verdict === "TRADE")).toBe(false)
    const read = confluence.confluenceRead(trendCandles(12), {})
    expect(read.ok).toBe(false)
    expect(read.error).toMatch(/at least/)
    const d = confluence.evaluateAsset({ id: "142", name: "142", candles: trendCandles(12), volume: {} })
    expect(d.verdict).toBe("NEUTRAL")
    expect(d.reasons[0]).toMatch(/at least/)
  })

  it("recommends no trade when every candle is identical", async () => {
    mockFeed.data = feed([eoAsset("142", { 60: flatCandles(80) })])
    const snap = await confluence.getDecisions()
    expect(snap.decisions).toHaveLength(1)
    const d = snap.decisions[0]
    expect(d.verdict).toBe("NEUTRAL")
    expect(d.direction).toBe("flat")
    expect(d.reasons[0]).toMatch(/no directional confluence/)
    const read = confluence.confluenceRead(flatCandles(), {})
    expect(read.ok).toBe(true)
    expect(read.direction).toBe(0)
    expect(read.score).toBe(0)
    expect(read.phase).toBe("flat")
  })

  it("still emits a real TRADE verdict on genuine confluence (positive control)", async () => {
    const up = trendCandles()
    mockFeed.data = feed([eoAsset("142", { 60: up, 300: wiggleTrend(80, 0.004, 0.0015), 900: wiggleTrend(80, 0.004, 0.0015) })])
    const snap = await confluence.getDecisions()
    expect(snap.decisions).toHaveLength(1)
    expect(snap.decisions[0].verdict).toBe("TRADE")
    expect(snap.decisions[0].direction).toBe("up")
    expect(confluence.CANDIDATE_EXPIRIES).toContain(snap.decisions[0].expiry)
  })
})

describe("sentiment gate", () => {
  const base = { enabled: true, minConfidence: 55, cooldownMs: 60000 }
  const strong = { direction: "up", confidence: 85, reason: "momentum" }

  it("blocks a trade when opposing sentiment exceeds the alignment threshold", () => {
    const d = autopilot.decideAutopilot({
      config: { ...base, sentimentGate: true, minSentimentAlignment: 0.3 },
      pred: strong,
      sentiment: { score: -0.7, source: "news" },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/sentiment gate/)
  })

  it("blocks a down signal when strongly bullish sentiment opposes it", () => {
    const d = autopilot.decideAutopilot({
      config: { ...base, sentimentGate: true, minSentimentAlignment: 0.3 },
      pred: { direction: "down", confidence: 85, reason: "reversal" },
      sentiment: { score: 0.7, source: "news" },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/sentiment gate/)
  })

  it("lets weak sentiment below the threshold through", () => {
    const d = autopilot.decideAutopilot({
      config: { ...base, sentimentGate: true, minSentimentAlignment: 0.3 },
      pred: strong,
      sentiment: { score: -0.2, source: "news" },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(true)
    expect(d.direction).toBe("call")
  })

  it("lets aligned sentiment through", () => {
    const d = autopilot.decideAutopilot({
      config: { ...base, sentimentGate: true, minSentimentAlignment: 0.3 },
      pred: strong,
      sentiment: { score: 0.6, source: "news" },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(true)
  })

  it("feeds sentiment alignment into the engine confidence", () => {
    const candles = Array.from({ length: 60 }, (_, i) => {
      const close = 100 * (1 + 0.0005 * i) * (1 + 0.008 * Math.sin(i * 0.5))
      const open = 100 * (1 + 0.0005 * Math.max(0, i - 1)) * (1 + 0.008 * Math.sin((i - 1) * 0.5))
      return { time: i * 60, open, high: close * 1.0008, low: close * 0.9992, close }
    })
    const aligned = confluence.evaluateAsset({ id: "142", name: "142", candles, volume: {}, sentimentOverride: { score: 0.35, source: "test" } })
    const neutral = confluence.evaluateAsset({ id: "142", name: "142", candles, volume: {} })
    const opposing = confluence.evaluateAsset({ id: "142", name: "142", candles, volume: {}, sentimentOverride: { score: -0.35, source: "test" } })
    expect(neutral.direction).not.toBe("flat")
    expect(aligned.confidence).toBeGreaterThan(neutral.confidence)
    expect(neutral.confidence).toBeGreaterThan(opposing.confidence)
  })
})

describe("MTF gate", () => {
  const base = { enabled: true, minConfidence: 55, cooldownMs: 60000 }
  const strong = { direction: "up", confidence: 85, reason: "momentum" }

  it("blocks a trade when MTF agreement is below minMtfAgree", () => {
    const d = autopilot.decideAutopilot({
      config: { ...base, mtfGate: true, minMtfAgree: 1 },
      pred: strong,
      mtf: { agree: 0, total: 2, boost: -0.08 },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/MTF gate/)
  })

  it("passes when MTF agreement meets minMtfAgree", () => {
    const d = autopilot.decideAutopilot({
      config: { ...base, mtfGate: true, minMtfAgree: 1 },
      pred: strong,
      mtf: { agree: 1, total: 2, boost: 0.02 },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(true)
  })

  it("wires a real quickMtfCheck disagreement into the autopilot gate", () => {
    const mtfResult = mtf.quickMtfCheck({ periods: { 300: mirrorCandles(wiggleTrend(80, 0.004, 0.0015)), 900: mirrorCandles(wiggleTrend(80, 0.004, 0.0015)) } }, 1)
    expect(mtfResult.total).toBe(2)
    expect(mtfResult.agree).toBe(0)
    const d = autopilot.decideAutopilot({
      config: { ...base, mtfGate: true, minMtfAgree: 1 },
      pred: strong,
      mtf: mtfResult,
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/MTF gate/)
  })

  it("vetoes TRADE in the confluence engine when higher timeframes unanimously disagree", () => {
    const up = trendCandles()
    const down = mirrorCandles(wiggleTrend(80, 0.004, 0.0015))
    const disagreeing = { id: "142", name: "142", periods: { 300: down, 900: down } }
    const agreeing = { id: "142", name: "142", periods: { 300: wiggleTrend(80, 0.004, 0.0015), 900: wiggleTrend(80, 0.004, 0.0015) } }

    const q = mtf.quickMtfCheck(disagreeing, 1)
    expect(q.agree).toBe(0)
    expect(q.total).toBe(2)

    const blocked = confluence.evaluateAsset({ id: "142", name: "142", candles: up, volume: {}, asset: disagreeing })
    expect(blocked.gates).toEqual({ score: true, winProb: true, priceRR: true, evRR: true, payout: true })
    expect(blocked.verdict).not.toBe("TRADE")

    const agreed = confluence.evaluateAsset({ id: "142", name: "142", candles: up, volume: {}, asset: agreeing })
    expect(agreed.verdict).toBe("TRADE")
  })
})

describe("kelly sizing correctness", () => {
  beforeEach(async () => {
    await trading._resetTradingData()
  })

  function seedKellyHistory(trades) {
    const store = localstore.localStore("kelly", { history: [], settings: { mode: "half", baseFraction: 0.02, maxFraction: 0.1 } })
    store.data.history = trades
    store.write()
  }

  function tradesOf(wins, losses, payout) {
    return [
      ...Array.from({ length: wins }, () => ({ outcome: "win", payout })),
      ...Array.from({ length: losses }, () => ({ outcome: "loss", payout }))
    ]
  }

  it("derives the fraction from the actual ledger win rate, not a hardcoded default", () => {
    seedKellyHistory(tradesOf(7, 3, 0.85))
    const snap70 = kelly.kellySnapshot()
    expect(snap70.stats.totalTrades).toBe(10)
    expect(snap70.stats.winRate).toBe(70)
    expect(snap70.stats.avgPayout).toBe(0.85)
    const wr = snap70.stats.winRate / 100
    const p = snap70.stats.avgPayout
    const expectedFull = ((wr * p - (1 - wr)) / p) * 100
    expect(snap70.kelly.fullKelly).toBeCloseTo(expectedFull, 1)
    expect(snap70.kelly.suggested).toBeCloseTo(expectedFull / 2, 1)

    seedKellyHistory(tradesOf(9, 1, 0.85))
    const snap90 = kelly.kellySnapshot()
    expect(snap90.stats.winRate).toBe(90)
    expect(snap90.kelly.suggested).toBeGreaterThan(snap70.kelly.suggested)
    const wr90 = 0.9
    expect(snap90.kelly.suggested).toBeCloseTo((((wr90 * 0.85 - 0.1) / 0.85) * 100) / 2, 1)
  })

  it("returns a zero fraction when the ledger is all losses", async () => {
    seedKellyHistory(tradesOf(0, 10, 0.85))
    const snap = kelly.kellySnapshot()
    expect(snap.stats.winRate).toBe(0)
    expect(snap.kelly.fullKelly).toBe(0)
    expect(snap.kelly.suggested).toBe(0)

    const pos = await trading.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 100, takeProfit: 110, stopLoss: 90 })
    expect(pos.amount).toBe(200)
  })

  it("never extrapolates a perfect ledger into an oversized bet", () => {
    seedKellyHistory(tradesOf(12, 0, 0.9))
    const snap = kelly.kellySnapshot()
    expect(snap.stats.winRate).toBe(100)
    expect(snap.kelly.fullKelly).toBe(0)
    expect(snap.kelly.suggested).toBe(0)

    const tier = kelly.getAntiMartingaleTier(10, { baseFraction: 0.08, stepFraction: 0.02, maxFraction: 0.1 })
    expect(tier.fraction).toBe(10)
    expect(tier.fraction).toBeLessThan((0.08 + 5 * 0.02) * 100)
  })

  it("caps auto-sized trades at the risk cap even when kelly suggests far more", async () => {
    seedKellyHistory(tradesOf(9, 1, 1.8))
    const snap = kelly.kellySnapshot()
    expect(snap.kelly.suggested).toBeGreaterThan(2)
    await expect(
      trading.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 100, takeProfit: 110, stopLoss: 90 })
    ).rejects.toThrow(/risk cap/)
  })

  it("applies the half-kelly rule", () => {
    expect(kelly.getKellySettings().mode).toBe("half")
    const half = kelly.computeKelly(0.6, 1.8, "half")
    const full = kelly.computeKelly(0.6, 1.8, "full")
    const quarter = kelly.computeKelly(0.6, 1.8, "quarter")
    expect(half.suggested).toBeCloseTo(full.suggested / 2, 1)
    expect(Math.abs(half.suggested * 2 - full.suggested)).toBeLessThanOrEqual(0.02)
    expect(quarter.suggested).toBeLessThan(half.suggested)
    expect(half.suggested).toBeLessThan(full.suggested)
  })
})

describe("order flow delta validation", () => {
  it("derives delta sign from actual candle open/close data", () => {
    const up = { time: 1, open: 100, close: 110, high: 112, low: 98, volume: 1000 }
    const down = { time: 2, open: 110, close: 100, high: 112, low: 98, volume: 1000 }
    const res = orderFlow.analyzeOrderFlow([up, down], 2)
    expect(res.delta).toHaveLength(2)
    expect(res.delta[0].delta).toBeGreaterThan(0)
    expect(res.delta[0].buyPct).toBeGreaterThan(50)
    expect(res.delta[1].delta).toBeLessThan(0)
    expect(res.delta[1].buyPct).toBeLessThan(50)

    const smallBody = { time: 1, open: 100, close: 101, high: 102, low: 99, volume: 1000 }
    const bigBody = { time: 2, open: 100, close: 103, high: 104, low: 99, volume: 1000 }
    const bodies = orderFlow.analyzeOrderFlow([smallBody, bigBody], 2)
    expect(Math.abs(bodies.delta[1].delta)).toBeGreaterThan(Math.abs(bodies.delta[0].delta))
  })

  it("uses the open/close approximation for volumeless EO candles instead of fabricating delta", () => {
    const eoCandles = Array.from({ length: 25 }, (_, i) => ({ time: i * 60, open: 100, close: 101, high: 101.5, low: 99.5 }))
    const res = orderFlow.analyzeOrderFlow(eoCandles, 20)
    expect(res.delta).toHaveLength(20)
    for (const d of res.delta) {
      expect(d.volume).toBe(0)
      expect(d.delta).toBe(0)
      expect(d.buyPct).toBe(65)
      expect(d.sellPct).toBe(35)
    }
    expect(res.cumulative).toBe(0)
    expect(res.imbalance).toBe("neutral")
    expect(res.signals).toEqual([])
  })

  it("sums the whole lookback window, not just the last candle", () => {
    const bull = (i) => ({ time: i * 60, open: 100, close: 101, high: 101.5, low: 99.5, volume: 400 })
    const crash = { time: 0, open: 200, close: 100, high: 205, low: 95, volume: 10000 }
    const candles = [crash, ...Array.from({ length: 24 }, (_, i) => bull(i + 1))]

    const windowed = orderFlow.analyzeOrderFlow(candles, 20)
    expect(windowed.delta).toHaveLength(20)
    expect(windowed.delta.every((d) => d.delta === 120)).toBe(true)
    expect(windowed.cumulative).toBe(2400)
    expect(windowed.cumulative).not.toBe(120)
    expect(windowed.imbalance).toBe("buy-heavy")

    const full = orderFlow.analyzeOrderFlow(candles, 25)
    expect(full.delta).toHaveLength(25)
    expect(full.cumulative).toBe(-2575)
    expect(full.imbalance).toBe("sell-heavy")
  })
})

describe("multi-timeframe engine validation", () => {
  const UP = wiggleTrend(80, 0.004, 0.0015)
  const DOWN = mirrorCandles(wiggleTrend(80, 0.004, 0.0015))

  it("actually processes multiple timeframes, not just one", () => {
    const result = mtf.multiTimeframeConfluence({
      periods: { 60: UP, 300: UP, 900: UP, 3600: UP },
      style: "scalping"
    })
    expect(result.ok).toBe(true)
    expect(result.totalChecked).toBe(4)
    expect(Object.keys(result.timeframes)).toEqual(["1m", "5m", "15m", "1h"])
    for (const tf of Object.values(result.timeframes)) {
      expect(tf.bars).toBeGreaterThanOrEqual(20)
      expect(tf.strength).toBeGreaterThan(0)
    }
  })

  it("computes each timeframe signal independently", () => {
    const result = mtf.multiTimeframeConfluence({
      periods: { 60: UP, 300: DOWN, 900: DOWN, 3600: DOWN },
      style: "scalping"
    })
    expect(result.timeframes["1m"].direction).toBe("up")
    expect(result.timeframes["5m"].direction).toBe("down")
    expect(result.timeframes["15m"].direction).toBe("down")
    expect(result.timeframes["1h"].direction).toBe("down")
    expect(result.disagreeCount).toBeGreaterThanOrEqual(2)
    expect(result.agreeCount).toBeLessThan(result.totalChecked)
    expect(result.direction).toBe("down")
  })

  it("vetoes when the entry timeframe has no agreement basis", () => {
    const result = mtf.multiTimeframeConfluence({
      periods: { 300: UP, 900: UP },
      style: "scalping"
    })
    expect(result.totalChecked).toBe(2)
    expect(result.agreeCount).toBe(0)
    expect(result.veto).toBe(true)
  })

  it("final signal reflects agreement across timeframes", () => {
    const result = mtf.multiTimeframeConfluence({
      periods: { 60: UP, 300: UP, 900: UP, 3600: UP },
      style: "scalping"
    })
    expect(result.agreeCount).toBe(result.totalChecked)
    expect(result.agreementRatio).toBe(100)
    expect(result.veto).toBe(false)
    expect(result.direction).toBe("up")
    expect(result.weightedScore).toBeGreaterThan(0)
  })

  it("returns a hold signal when opposing timeframes balance out", () => {
    const probe = mtf.multiTimeframeConfluence({
      periods: { 300: UP, 900: DOWN },
      style: "dayTrading",
      customWeights: { "5m": 0.5, "15m": 0.5 }
    })
    expect(probe.disagreeCount).toBeGreaterThanOrEqual(1)
    const s5 = probe.timeframes["5m"].strength / 100
    const s15 = probe.timeframes["15m"].strength / 100
    const balanced = mtf.multiTimeframeConfluence({
      periods: { 300: UP, 900: DOWN },
      style: "dayTrading",
      customWeights: { "5m": s15, "15m": s5 }
    })
    expect(balanced.direction).toBe("flat")
    expect(balanced.weightedScore).toBeCloseTo(0, 2)

    const downFavored = mtf.multiTimeframeConfluence({
      periods: { 300: UP, 900: DOWN },
      style: "dayTrading",
      customWeights: { "5m": s15 * 0.2, "15m": s5 }
    })
    expect(downFavored.direction).toBe("down")
  })

  it("quickMtfCheck scores the 5m/15m pair independently of the entry timeframe", () => {
    const disagree = mtf.quickMtfCheck({ periods: { 300: DOWN, 900: DOWN } }, 1)
    expect(disagree.total).toBe(2)
    expect(disagree.agree).toBe(0)
    expect(disagree.boost).toBeLessThan(0)
    expect(disagree.tfDetails.map((d) => d.matches)).toEqual([false, false])
    expect(disagree.tfDetails.map((d) => d.dir)).toEqual([-1, -1])

    const agree = mtf.quickMtfCheck({ periods: { 300: UP, 900: UP } }, 1)
    expect(agree.total).toBe(2)
    expect(agree.agree).toBe(2)
    expect(agree.boost).toBeGreaterThan(0)
    expect(agree.tfDetails.map((d) => d.matches)).toEqual([true, true])
    expect(agree.tfDetails.map((d) => d.dir)).toEqual([1, 1])
  })
})
