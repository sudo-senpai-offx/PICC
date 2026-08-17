import { describe, expect, it } from "vitest"
import { aggregateCandles } from "../services/indicators.mjs"
import { evaluateAsset } from "../services/adaptiveConfluence.mjs"
import {
  computeMarketIntel,
  strategyMtf,
  strategyPhase,
  strategyVolume,
  strategyRR,
  strategyEdge,
  durationGuidance,
  tfDirection,
  MIN_INTEL_TRADE
} from "../services/marketIntel.mjs"

// Deterministic LCG so the synthetic series are reproducible.
function makeRng(seed = 42) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function trendCandles({ start, drift, n = 180, vol = 0.0006, rng = makeRng() }) {
  const out = []
  let p = start
  for (let i = 0; i < n; i++) {
    const open = p
    const close = p + drift + (rng() - 0.5) * vol
    const high = Math.max(open, close) + rng() * vol * 0.5
    const low = Math.min(open, close) - rng() * vol * 0.5
    out.push({ time: i * 60 * 1000, open, high, low, close })
    p = close
  }
  return out
}

function tickProfile({ bias, rate = 60, rng = makeRng() }) {
  const profile = []
  for (let i = 0; i < 12; i++) {
    const total = Math.round((rate * 5) / 60)
    const upShare = 0.5 + bias
    const up = Math.round(total * upShare)
    profile.push({ t: i * 5, up, down: Math.max(0, total - up) })
  }
  const up = profile.reduce((a, b) => a + b.up, 0)
  const down = profile.reduce((a, b) => a + b.down, 0)
  return { count: up + down, up, down, delta: up - down, ratePerMin: rate, profile }
}

function assetData({ id, name, candles, ticks }) {
  return {
    id,
    name,
    type: "currency",
    periods: {
      60: candles,
      300: aggregateCandles(candles, 5),
      900: aggregateCandles(candles, 15),
      3600: aggregateCandles(candles, 60)
    },
    ticks
  }
}

const EURUSD = assetData({
  id: "EURUSD",
  name: "EURUSD",
  candles: trendCandles({ start: 1.08, drift: 0.00012 }),
  ticks: tickProfile({ bias: 0.18 })
})
const GBPUSD = assetData({
  id: "GBPUSD",
  name: "GBPUSD",
  candles: trendCandles({ start: 1.27, drift: -0.00012 }),
  ticks: tickProfile({ bias: -0.15 })
})
const USDJPY = assetData({
  id: "USDJPY",
  name: "USDJPY",
  candles: trendCandles({ start: 150, drift: 0, vol: 0.0003 }),
  ticks: tickProfile({ bias: 0 })
})
const NOTREND = assetData({
  id: "XXXYYY",
  name: "XXXYYY",
  candles: trendCandles({ start: 1, drift: 0, n: 20 }),
  ticks: tickProfile({ bias: 0, rate: 5 })
})

const accuracy = [
  { key: "EURUSD", total: 24, wins: 16, losses: 8, draws: 0, winRate: 67 },
  { key: "GBPUSD", total: 10, wins: 5, losses: 5, draws: 0, winRate: 50 },
  { key: "USDJPY", total: 18, wins: 9, losses: 9, draws: 0, winRate: 50 }
]

function decisionsFor(assets) {
  return assets.map((a) =>
    evaluateAsset({ id: a.id, name: a.name, candles: a.periods[60], volume: a.ticks })
  )
}

describe("marketIntel meta-analysis", () => {
  it("ranks the strongest market first and recommends a precise entry", () => {
    const out = computeMarketIntel({
      data: { status: "connected", mode: "demo", account: null, viewed: null, assets: [EURUSD, GBPUSD, USDJPY] },
      decisions: decisionsFor([EURUSD, GBPUSD, USDJPY]),
      accuracy
    })
    expect(out.ranked.length).toBe(3)
    expect(out.ranked[0].asset).toBe("EURUSD")
    expect(out.ranked[0].action).toBe("call")
    expect(out.ranked[0].intelScore).toBeGreaterThanOrEqual(MIN_INTEL_TRADE)
    expect(out.ranked[0].tradable).toBe(true)
    expect(out.ranked[1].asset).toBe("GBPUSD")
    expect(out.ranked[1].action).toBe("put")
    expect(out.best?.asset).toBe("EURUSD")
    expect(out.recommendation?.action).toBe("call")
    expect(out.recommendation?.market).toBe("EURUSD")
    expect(out.recommendation?.expirySec).toBeGreaterThan(0)
  })

  it("builds all six strategy reads for the best market", () => {
    const out = computeMarketIntel({
      data: { status: "connected", assets: [EURUSD, GBPUSD, USDJPY] },
      decisions: decisionsFor([EURUSD, GBPUSD, USDJPY]),
      accuracy
    })
    const s = out.best.strategies
    expect(s.mtf.signal).toBe("up")
    expect(s.mtf.reason).toMatch(/MTF/)
    expect(s.phase.score).toBeGreaterThan(0)
    expect(s.volume.reason).toMatch(/tick flow/)
    expect(s.rr.reason).toMatch(/R:R/)
    expect(s.edge.reason).toMatch(/realized win rate 67%/)
    expect(s.duration.suggestedSec).toBeGreaterThan(0)
    expect(s.duration.atrPct).toBeGreaterThan(0)
    expect(out.best.confidence).toBeLessThanOrEqual(92)
  })

  it("keeps confidence capped and honest", () => {
    const out = computeMarketIntel({
      data: { status: "connected", assets: [EURUSD] },
      decisions: decisionsFor([EURUSD]),
      accuracy
    })
    expect(out.best.confidence).toBeLessThanOrEqual(92)
    expect(out.recommendation).not.toBeNull()
  })

  it("marks under-sampled assets as non-tradable but still ranks them", () => {
    const out = computeMarketIntel({
      data: { status: "connected", assets: [EURUSD, NOTREND] },
      decisions: decisionsFor([EURUSD]),
      accuracy
    })
    const weak = out.ranked.find((r) => r.asset === "XXXYYY")
    expect(weak).toBeTruthy()
    expect(weak.verdict).toBeNull()
    expect(weak.tradable).toBe(false)
    expect(weak.action).toBeNull()
  })

  it("issues no recommendation and stands aside when nothing clears the bar", () => {
    const out = computeMarketIntel({
      data: { status: "connected", assets: [USDJPY] },
      decisions: decisionsFor([USDJPY]),
      accuracy
    })
    expect(out.best?.tradable ?? false).toBe(false)
    expect(out.recommendation).toBeNull()
    expect(out.honesty).toMatch(/stand aside|No market/i)
  })

  it("returns a stable empty-ish shape when there is no data", () => {
    const out = computeMarketIntel({ data: { status: "idle", assets: [] } })
    expect(out.ranked).toEqual([])
    expect(out.best).toBeNull()
    expect(out.recommendation).toBeNull()
    expect(out.honesty).toMatch(/open a trading page/)
  })
})

describe("expert strategy primitives", () => {
  it("tfDirection reads a bullish dashboard as up and a bearish one as down", () => {
    const bull = { last: 1.1, ema: { ema20: 1.09, ema50: 1.08 }, alligator: { bull: true }, macd: { line: 0.01 }, linearRegression: { slopePct: 0.1 } }
    const bear = { last: 1.1, ema: { ema20: 1.11, ema50: 1.12 }, alligator: { bull: false }, macd: { line: -0.01 }, linearRegression: { slopePct: -0.1 } }
    expect(tfDirection(bull).dir).toBe(1)
    expect(tfDirection(bear).dir).toBe(-1)
    expect(tfDirection({}).dir).toBe(0)
  })

  it("strategyMtf aligns 60s and 300s frames", () => {
    const up = assetData({ id: "A", name: "A", candles: trendCandles({ start: 1, drift: 0.0002, n: 180 }), ticks: tickProfile({ bias: 0.2 }) })
    const s = strategyMtf(up.periods)
    expect(s.signal).toBe("up")
    expect(s.details.length).toBeGreaterThanOrEqual(1)
  })

  it("strategyPhase rates trend high and volatile_range negative", () => {
    expect(strategyPhase("trend").score).toBe(0.8)
    expect(strategyPhase("volatile_range").score).toBe(-0.7)
    expect(strategyPhase("unknown").score).toBe(0)
  })

  it("strategyVolume aligns pressure with direction", () => {
    const up = strategyVolume(tickProfile({ bias: 0.3, rate: 300 }), "up")
    expect(up.score).toBeGreaterThan(0)
    expect(up.signal).toBe("up")
    const conflict = strategyVolume(tickProfile({ bias: 0.3, rate: 300 }), "down")
    expect(conflict.score).toBeLessThan(0)
    expect(strategyVolume({}, "up").score).toBe(0)
  })

  it("strategyRR scores the honesty gates", () => {
    expect(strategyRR({ direction: "up", priceRR: 4, evRR: 4, gates: { priceRR: true, evRR: true } }).score).toBeGreaterThan(0)
    expect(strategyRR({ direction: "up", priceRR: 1, evRR: 1, gates: { priceRR: false, evRR: false } }).score).toBeLessThan(0)
    expect(strategyRR({ direction: "flat" }).signal).toBe("flat")
  })

  it("strategyEdge damps small samples and neutralizes unknown markets", () => {
    expect(strategyEdge({ total: 10, wins: 6, losses: 4, winRate: 60 }).score).toBeCloseTo(0.2, 5)
    expect(strategyEdge({ total: 3, wins: 3, losses: 0, winRate: 100 }).score).toBe(0)
    expect(strategyEdge(null).score).toBe(0)
  })

  it("durationGuidance maps ATR% to a trade horizon", () => {
    expect(durationGuidance({ atrPct: 0.3, mttdSec: 30, expiry: 60 }).label).toBe("elevated")
    expect(durationGuidance({ atrPct: 0.3, mttdSec: 30 }).suggestedSec).toBe(60)
    expect(durationGuidance({ atrPct: 0.02 }).label).toBe("low")
    expect(durationGuidance({ atrPct: 0.02 }).suggestedSec).toBe(300)
    expect(durationGuidance(null)).toBeNull()
  })
})
