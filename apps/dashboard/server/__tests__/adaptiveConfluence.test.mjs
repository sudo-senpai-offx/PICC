import { describe, expect, test } from "vitest"
import {
  CANDIDATE_EXPIRIES,
  confluenceRead,
  winProbEstimate,
  mttdEstimate,
  pricePathRR,
  evGate,
  evaluateAsset,
  decideAssets,
  observedPayouts,
  ASSUMED_PAYOUT
} from "../services/adaptiveConfluence.mjs"

function trendCandles(n = 60, step = 0.2, base = 100) {
  const out = []
  for (let i = 0; i < n; i++) {
    const close = base + step * i
    const open = close - step
    out.push({ time: i * 60, open, high: close + 0.05, low: close - 0.05, close })
  }
  return out
}

function wavyCandles(n = 80) {
  const out = []
  for (let i = 0; i < n; i++) {
    const close = 100 + Math.sin(i * 0.7) * 0.5 + i * 0.002
    const open = close - Math.sin(i * 0.7) * 0.1
    out.push({ time: i * 60, open, high: close + 0.1, low: close - 0.1, close })
  }
  return out
}

function flatCandles(n = 60, price = 100) {
  return Array.from({ length: n }, (_, i) => ({ time: i * 60, open: price, high: price, low: price, close: price }))
}

describe("confluenceRead", () => {
  test("reads a clean uptrend as up with a phase and groups", () => {
    const r = confluenceRead(trendCandles(), {})
    expect(r.ok).toBe(true)
    expect(r.bars).toBeGreaterThanOrEqual(40)
    expect(r.direction).toBe(1)
    expect(r.score).toBeGreaterThan(0)
    expect(typeof r.phase).toBe("string")
    expect(r.groups).toHaveProperty("trend")
    expect(r.groups).toHaveProperty("momentum")
    expect(r.groups).toHaveProperty("volatility")
    expect(r.groups).toHaveProperty("volume")
    expect(r.atr).toBeGreaterThan(0)
  })

  test("rejects when there are too few bars", () => {
    const r = confluenceRead(trendCandles(10), {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/at least/)
  })

  test("flat price produces a flat direction", () => {
    const r = confluenceRead(flatCandles(), {})
    expect(r.ok).toBe(true)
    expect(r.direction).toBe(0)
    expect(r.score).toBe(0)
  })

  test("tick volume proxy surfaces participation and pressure", () => {
    const profile = []
    for (let i = 0; i < 24; i++) profile.push({ t: i * 5, up: 6, down: 1 })
    const r = confluenceRead(trendCandles(), { profile })
    expect(r.volume.proxy).toBe("tick-activity")
    expect(r.volume.ratePerMin).toBeGreaterThan(0)
    expect(r.volume.upRatio).toBeGreaterThan(0.5)
  })
})

describe("winProbEstimate", () => {
  test("clean uptrend gives high damped win probability for expiry=60", () => {
    const closes = trendCandles().map((c) => c.close)
    const r = winProbEstimate({ closes, period: 60, direction: 1, expiry: 60 })
    expect(r.sampleSize).toBeGreaterThanOrEqual(6)
    expect(r.winProb).toBeGreaterThan(0.6)
    expect(r.k).toBe(1)
  })

  test("too few samples falls back to the floor, never fabricated confidence", () => {
    const closes = trendCandles(6).map((c) => c.close)
    const r = winProbEstimate({ closes, period: 60, direction: 1, expiry: 60 })
    expect(r.winProb).toBe(0.52)
    expect(r.empirical).toBeNull()
  })

  test("flat direction has no edge", () => {
    const closes = wavyCandles().map((c) => c.close)
    const r = winProbEstimate({ closes, period: 60, direction: 0, expiry: 60 })
    expect(r.winProb).toBe(0.52)
  })

  test("a losing market is scored honestly below the no-sample floor", () => {
    // Strictly falling closes: an "up" call never wins. The no-sample floor of
    // 0.52 used to clamp this back up, fabricating confidence in a dead trade.
    const closes = Array.from({ length: 60 }, (_, i) => 100 - i)
    const r = winProbEstimate({ closes, period: 60, direction: 1, expiry: 60 })
    expect(r.sampleSize).toBeGreaterThanOrEqual(6)
    expect(r.winProb).toBe(1 - 0.52)
    expect(r.winProb).toBeLessThan(0.52)
  })
})

describe("mttdEstimate", () => {
  test("a clean trend reaches the target quickly with enough hits", () => {
    const r = mttdEstimate({ candles: trendCandles(), direction: 1 })
    expect(r.hits).toBeGreaterThanOrEqual(2)
    expect(r.mttdSec).toBeGreaterThan(0)
    expect(r.target).toBeGreaterThan(0)
  })

  test("flat market produces no directional hits", () => {
    const r = mttdEstimate({ candles: flatCandles(), direction: 1 })
    expect(r.hits).toBeLessThan(2)
    expect(r.mttdSec).toBeNull()
  })
})

describe("pricePathRR", () => {
  test("uptrend favours the long side decisively", () => {
    const r = pricePathRR({ candles: trendCandles(), direction: 1, expiry: 60 })
    expect(r.favorable).toBeGreaterThan(0)
    expect(r.rr).toBeGreaterThanOrEqual(2)
  })

  test("whipsaw price path sits near 1:1", () => {
    const r = pricePathRR({ candles: wavyCandles(), direction: 1, expiry: 60 })
    expect(r.rr).not.toBeNull()
    expect(r.rr).toBeLessThan(2)
  })
})

describe("evGate", () => {
  test("winProb 0.6 at 90% payout has positive EV but fails the 2:1 EV-R:R", () => {
    const g = evGate({ winProb: 0.6, payoutPct: 90 })
    expect(g.ev).toBeGreaterThan(0) // 0.14
    expect(g.breakevenPayout).toBeCloseTo(66.67, 0)
    expect(g.payoutBeats).toBe(true)
    expect(g.evRR).toBeLessThan(2)
    expect(g.evRRPass).toBe(false)
  })

  test("winProb 0.7 at 90% payout clears the 2:1 EV-R:R and payout margin", () => {
    const g = evGate({ winProb: 0.7, payoutPct: 90 })
    expect(g.ev).toBeCloseTo(0.33, 2)
    expect(g.evRR).toBeGreaterThanOrEqual(2)
    expect(g.evRRPass).toBe(true)
    expect(g.payoutBeats).toBe(true)
  })

  test("payout below the margin threshold fails the payout gate", () => {
    const g = evGate({ winProb: 0.7, payoutPct: 45 })
    expect(g.payoutBeats).toBe(false)
    expect(g.evRRPass).toBe(false)
  })

  test("invalid inputs never produce a tradeable value", () => {
    expect(evGate({ winProb: 0.5, payoutPct: 0 }).ev).toBeNull()
    expect(evGate({ winProb: 1.2, payoutPct: 90 }).ev).toBeNull()
    expect(evGate({ winProb: 0, payoutPct: 90 }).ev).toBeNull()
  })
})

describe("evaluateAsset", () => {
  test("strong uptrend passes the composite gate and picks the best expiry", () => {
    const d = evaluateAsset({ id: "142", name: "EUR / USD", candles: trendCandles(), volume: {} })
    expect(d.verdict).toBe("TRADE")
    expect(d.direction).toBe("up")
    expect(CANDIDATE_EXPIRIES).toContain(d.expiry)
    expect(d.gates.score).toBe(true)
    expect(d.gates.winProb).toBe(true)
    expect(d.gates.priceRR).toBe(true)
    expect(d.gates.evRR).toBe(true)
    expect(d.gates.payout).toBe(true)
    expect(d.ev).toBeGreaterThan(0)
    expect(d.payoutSource).toBe("assumed")
    expect(d.reasons.some((r) => /decision support/.test(r))).toBe(true)
  })

  test("observed payout overrides the assumed schedule and is labelled", () => {
    const observed = { "142:120": 120 }
    const d = evaluateAsset({ id: "142", name: "EUR / USD", candles: trendCandles(), volume: {}, observedPayout: observed })
    expect(d.expiry).toBe(120)
    expect(d.payout).toBe(120)
    expect(d.payoutSource).toBe("observed")
  })

  test("whipsaw price action is never TRADE", () => {
    const d = evaluateAsset({ id: "3", name: "Whipsaw", candles: wavyCandles(), volume: {} })
    expect(["NEUTRAL", "OBSERVE"]).toContain(d.verdict)
  })

  test("flat price yields a flat NEUTRAL decision", () => {
    const d = evaluateAsset({ id: "1", name: "Flat", candles: flatCandles(), volume: {} })
    expect(d.verdict).toBe("NEUTRAL")
    expect(d.direction).toBe("flat")
  })

  test("assumed payout schedule covers every candidate expiry", () => {
    for (const expiry of CANDIDATE_EXPIRIES) {
      expect(ASSUMED_PAYOUT[expiry]).toBeGreaterThan(50)
    }
  })
})

describe("decideAssets", () => {
  test("empty data produces an empty decision set", async () => {
    expect(await decideAssets({ data: {} })).toEqual([])
    expect(await decideAssets({ data: { assets: [] } })).toEqual([])
  })

  test("under-filled buffers are skipped, not guessed on", async () => {
    const data = { assets: [{ id: "1", name: "Thin", periods: { 60: trendCandles(10) }, ticks: {} }] }
    expect(await decideAssets({ data })).toEqual([])
  })

  test("decides each adequately-seeded asset", async () => {
    const data = {
      assets: [
        { id: "142", name: "EUR / USD", periods: { 60: trendCandles() }, ticks: {} },
        { id: "9", name: "GOLD", periods: { 60: wavyCandles() }, ticks: {} }
      ]
    }
    const out = await decideAssets({ data })
    expect(out.length).toBe(2)
    expect(out.find((d) => d.assetId === "142").verdict).toBe("TRADE")
    expect(out.find((d) => d.assetId === "9").verdict).not.toBe("TRADE")
  })
})

describe("observedPayouts", () => {
  test("loads the demo-deal payout map without throwing (env-dependent size)", async () => {
    const r = await observedPayouts({ limit: 5 })
    expect(r.ok).toBe(true)
    expect(r.source).toBe("demo-deals")
    expect(typeof r.total).toBe("number")
    expect(typeof r.sampled).toBe("number")
    expect(Array.isArray(r.entries)).toBe(true)
    for (const [k, p] of r.entries) {
      expect(typeof k).toBe("string")
      expect(typeof p).toBe("number")
      expect(p).toBeGreaterThan(0)
    }
  })
})
