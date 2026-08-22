import { describe, expect, it } from "vitest"
import { computeAdaptiveStops } from "../services/trading.mjs"
import { predictDirection, backtestModels } from "../services/prediction.mjs"
import { detectRegime } from "../services/regimeDetection.mjs"
import { confluenceRead, winProbEstimate, pricePathRR, evGate, mttdEstimate } from "../services/adaptiveConfluence.mjs"
import { computeKelly, kellySnapshot } from "../services/kellyCriterion.mjs"
import { optimizeExpiry } from "../services/expiryOptimizer.mjs"
import { analyzeOrderFlow } from "../services/orderFlow.mjs"

function series(start, dailyReturn, n) {
  const out = []
  let v = start
  for (let i = 0; i < n; i++) { out.push(v); v = v * (1 + dailyReturn) }
  return out
}

function syntheticCandles(startPrice, drift, n) {
  const candles = []
  let price = startPrice
  const seed = 42
  let rng = seed
  const rand = () => { rng = (rng * 16807 + 0) % 2147483647; return rng / 2147483647 }
  for (let i = 0; i < n; i++) {
    const open = price
    const change = price * drift * (0.5 + rand() * 1.0)
    const high = Math.max(open, open + Math.abs(change)) + price * 0.001
    const low = Math.min(open, open + change) - price * 0.001
    const close = open + change
    candles.push({ time: i * 60, open, high, low, close })
    price = close
  }
  return candles
}

// ── Adaptive Stops ───────────────────────────────────────────────
describe("Adaptive Stops", () => {
  it("computes SL/TP from candles", () => {
    const candles = syntheticCandles(100, 0.002, 100)
    const last = candles[candles.length - 1].close
    const result = computeAdaptiveStops(candles, "up")
    expect(result.takeProfit).toBeGreaterThan(last)
    expect(result.stopLoss).toBeLessThan(last)
    expect(result.atr).toBeGreaterThan(0)
    expect(["trending", "ranging", "volatile", "volatile_trend", "unknown"]).toContain(result.regime)
  })

  it("TP > entry for up, TP < entry for down", () => {
    const candles = syntheticCandles(100, 0.002, 100)
    const last = candles[candles.length - 1].close
    const up = computeAdaptiveStops(candles, "up")
    const down = computeAdaptiveStops(candles, "down")
    expect(up.takeProfit).toBeGreaterThan(last)
    expect(up.stopLoss).toBeLessThan(last)
    expect(down.takeProfit).toBeLessThan(last)
    expect(down.stopLoss).toBeGreaterThan(last)
  })

  it("returns nulls for insufficient data", () => {
    const result = computeAdaptiveStops([], "up")
    expect(result.takeProfit).toBeNull()
    expect(result.stopLoss).toBeNull()
  })
})

// ── Walk-Forward Backtest ────────────────────────────────────────
describe("Walk-Forward Backtest", () => {
  it("backtestModels produces hit rates", () => {
    const closes = series(100, 0.001, 300)
    const bt = backtestModels(closes, 3, 10)
    expect(bt.sampleSize).toBeGreaterThan(0)
    expect(typeof bt.hitRates.momentum).toBe("number")
    expect(typeof bt.hitRates.trend).toBe("number")
    expect(bt.windows.length).toBeGreaterThan(0)
  })

  it("handles short series gracefully", () => {
    const closes = series(100, 0.001, 20)
    const bt = backtestModels(closes, 3, 10)
    expect(bt.sampleSize).toBe(0)
    expect(typeof bt.hitRates).toBe("object")
  })
})

// ── Regime Detection ─────────────────────────────────────────────
describe("Regime Detection", () => {
  it("detects regime from candles", () => {
    const candles = syntheticCandles(100, 0.005, 100)
    const regime = detectRegime(candles)
    expect(["trending", "ranging", "volatile", "breakout"]).toContain(regime.regime)
    expect(regime.confidence).toBeGreaterThan(0)
    expect(Array.isArray(regime.factors)).toBe(true)
  })

  it("returns unknown for insufficient data", () => {
    const regime = detectRegime([])
    expect(regime.regime).toBe("unknown")
  })
})

// ── Confluence Engine ────────────────────────────────────────────
describe("Confluence Read", () => {
  it("computes confluence from candles", () => {
    const candles = syntheticCandles(100, 0.003, 100)
    const read = confluenceRead(candles, null)
    expect(read.ok).toBe(true)
    expect(typeof read.score).toBe("number")
    expect([-1, 0, 1]).toContain(read.direction)
    expect(typeof read.phase).toBe("string")
    expect(read.bars).toBe(100)
  })

  it("rejects insufficient bars", () => {
    const candles = syntheticCandles(100, 0.001, 10)
    const read = confluenceRead(candles, null)
    expect(read.ok).toBe(false)
  })
})

describe("Win Probability", () => {
  it("estimates win probability", () => {
    const closes = series(100, 0.001, 100)
    const wp = winProbEstimate({ closes, direction: 1, expiry: 60 })
    expect(wp.winProb).toBeGreaterThanOrEqual(0.5)
    expect(wp.winProb).toBeLessThanOrEqual(0.95)
    expect(typeof wp.sampleSize).toBe("number")
  })
})

describe("Price-Path R:R", () => {
  it("computes R:R ratio", () => {
    const candles = syntheticCandles(100, 0.002, 100)
    const rr = pricePathRR({ candles, direction: 1, expiry: 60 })
    expect(typeof rr.favorable).toBe("number")
    expect(typeof rr.adverse).toBe("number")
  })
})

describe("EV Gate", () => {
  it("validates positive EV for high win rate + high payout", () => {
    const gate = evGate({ winProb: 0.6, payoutPct: 85 })
    expect(gate.ev).toBeGreaterThan(0)
    expect(gate.payoutBeats).toBe(true)
  })

  it("rejects negative EV", () => {
    const gate = evGate({ winProb: 0.4, payoutPct: 80 })
    expect(gate.ev).toBeLessThan(0)
  })
})

describe("MTTD Estimate", () => {
  it("estimates mean time to directional target", () => {
    const candles = syntheticCandles(100, 0.003, 100)
    const mttd = mttdEstimate({ candles, direction: 1 })
    expect(typeof mttd.mttdSec).toBe("number")
    expect(mttd.mttdSec).toBeGreaterThan(0)
    expect(mttd.hits).toBeGreaterThan(0)
  })
})

// ── Kelly Criterion ──────────────────────────────────────────────
describe("Kelly Criterion", () => {
  it("computes Kelly fraction", () => {
    const kelly = computeKelly(0.6, 1.8)
    expect(kelly.suggested).toBeGreaterThan(0)
    expect(kelly.fullKelly).toBeGreaterThan(0)
    expect(typeof kelly.mode).toBe("string")
  })

  it("returns snapshot without error", () => {
    const snap = kellySnapshot()
    expect(snap.kelly).toBeDefined()
    expect(typeof snap.kelly.suggested).toBe("number")
    expect(typeof snap.kelly.fullKelly).toBe("number")
  })
})

// ── Expiry Optimizer ─────────────────────────────────────────────
describe("Expiry Optimizer", () => {
  it("recommends expiry from candles", () => {
    const candles = syntheticCandles(100, 0.002, 100)
    const result = optimizeExpiry(candles, "trending")
    expect(typeof result.recommended).toBe("object")
    expect(result.recommended.seconds).toBeGreaterThan(0)
    expect(typeof result.recommended.label).toBe("string")
    expect(Array.isArray(result.all)).toBe(true)
  })
})

// ── Order Flow ───────────────────────────────────────────────────
describe("Order Flow", () => {
  it("analyzes order flow from candles", () => {
    const candles = syntheticCandles(100, 0.002, 100)
    const result = analyzeOrderFlow(candles, 20)
    expect(typeof result.cumulative).toBe("number")
    expect(typeof result.imbalance).toBe("string")
    expect(Array.isArray(result.delta)).toBe(true)
    expect(Array.isArray(result.signals)).toBe(true)
  })
})

// ── Prediction Engine Integration ────────────────────────────────
describe("Prediction + Adaptive Stops Integration", () => {
  it("full pipeline: predict -> adaptive stops -> regime", () => {
    const closes = series(100, 0.0015, 300)
    const pred = predictDirection(closes, 3)
    expect(pred.ok).toBe(true)

    const candles = closes.map((c, i) => ({
      time: i * 86400,
      open: c * 0.999,
      high: c * 1.003,
      low: c * 0.997,
      close: c
    }))
    const stops = computeAdaptiveStops(candles, pred.direction === "up" ? "up" : "down")
    expect(stops.atr).toBeGreaterThan(0)

    const regime = detectRegime(candles)
    expect(regime.regime).not.toBe("unknown")
  })
})
