// Slice 9b: technical backtester — pure walk-forward with structural honesty
// (no look-ahead, configs-tried, untouched OOS, transaction costs, backtest-only
// labels). Expectations are hand-derivable from the fixture construction, NOT
// from running the engine: every decision in a pure ramp wins before costs,
// flat data fabricates no directional call, and a cost bigger than the per-bar
// move turns the same 100% gross win-rate into a 0% net win-rate.
import { describe, it, expect } from "vitest"

import {
  BACKTEST_LABEL,
  DISCLAIMER,
  directionOfState,
  aggregateCandlesOpen,
  closedPlanePrefixes,
  decisionIndices,
  evaluateSurface,
  runTechnicalBacktest
} from "../services/technicalBacktest.mjs"

// ---------------------------------------------------------------------------
// Fixtures (open-time convention: time = candle OPEN, closeTime = time + tf)
// ---------------------------------------------------------------------------
function candle(i, open, close, tf = 60) {
  return {
    time: i * tf,
    open,
    high: Math.max(open, close) * 1.001,
    low: Math.min(open, close) * 0.999,
    close,
    volume: 1000
  }
}

/** Monotonic geometric ramp; direction is the sign of `driftPerBar`. */
function rampSeries(n, driftPerBar, base = 100) {
  const out = []
  let price = base
  for (let i = 0; i < n; i += 1) {
    const open = price
    price = open * (1 + driftPerBar)
    out.push(candle(i, open, price))
  }
  return out
}

/** Flat series — no move anywhere. */
function flatSeries(n, base = 100, tf = 60) {
  const out = []
  for (let i = 0; i < n; i += 1) out.push(candle(i, base, base, tf))
  return out
}

/** 60/300/900-second planes aligned to the same open timestamps. */
function buildSeries(entry, { factor = 5 } = {}) {
  return {
    60: entry,
    300: aggregateCandlesOpen(entry, factor),
    900: aggregateCandlesOpen(entry, factor * 3)
  }
}

const UP = buildSeries(rampSeries(300, 0.0004))
const DOWN = buildSeries(rampSeries(300, -0.0004))
const COSTY = buildSeries(rampSeries(300, 0.0002)) // 5-bar move ~0.10% < cost 0.20%
const FLAT = buildSeries(flatSeries(260))

const BASE_OPTS = { series: UP, decisionTf: "60", horizonBars: 5, cost: 0, reserve: 0.2, maxDecisions: 24 }

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
describe("directionOfState", () => {
  it("maps LONG*/SHORT* states to the announced direction", () => {
    expect(directionOfState("LONG BIAS")).toBe("up")
    expect(directionOfState("LONG ONLY")).toBe("up")
    expect(directionOfState("LONG WATCH")).toBe("up")
    expect(directionOfState("SHORT BIAS")).toBe("down")
    expect(directionOfState("SHORT ONLY")).toBe("down")
  })

  it("returns null for non-directional states (WAIT abstains, never guesses)", () => {
    expect(directionOfState("WAIT")).toBeNull()
    expect(directionOfState("NO TRADE")).toBeNull()
    expect(directionOfState("")).toBeNull()
    expect(directionOfState(null)).toBeNull()
  })
})

describe("aggregateCandlesOpen", () => {
  it("derives higher-tf candles in OPEN-time convention with merged OHLCV", () => {
    const base = [
      { time: 0, open: 10, high: 11, low: 9, close: 10.5, volume: 3 },
      { time: 60, open: 10.5, high: 12, low: 10, close: 11, volume: 7 },
      { time: 120, open: 11, high: 11.5, low: 10.5, close: 11.2, volume: 2 },
      { time: 180, open: 11.2, high: 11.3, low: 10, close: 10.9, volume: 5 }
    ]
    const out = aggregateCandlesOpen(base, 2)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ time: 0, open: 10, high: 12, low: 9, close: 11, volume: 10 })
    expect(out[1]).toMatchObject({ time: 120, open: 11, high: 11.5, low: 10, close: 10.9, volume: 7 })
    // trailing partial group (fewer than `factor` bars) is dropped, not padded
    expect(aggregateCandlesOpen(base, 5)).toHaveLength(0)
  })
})

describe("closedPlanePrefixes", () => {
  it("never lets an in-progress higher-tf candle into the decision (B4 barrier)", () => {
    const { planes } = closedPlanePrefixes({ series: UP, decisionTf: 60, d: 9, entry: UP[60] })
    const asOf = 9 * 60 + 60
    for (const tf of Object.keys(planes)) {
      for (const c of planes[tf]) {
        expect(Number(c.time) + Number(tf)).toBeLessThanOrEqual(asOf)
      }
    }
    // entry plane is closed through bar 9; the 300s plane closes at <= 600s
    // (opens 0 and 300); the 900s candle [0,900) is still IN PROGRESS at
    // asOf=600 and must not leak into the decision (B4 hairline)
    expect(planes[60]).toHaveLength(10)
    expect(planes[300].length).toBe(2)
    expect(planes[900].length).toBe(0)
  })
})

describe("decisionIndices", () => {
  it("caps, and keeps first+last eligible inside the surface", () => {
    const { is, oos } = decisionIndices({ n: 300, minBars: 30, horizon: 5, isEnd: 240, maxDecisions: 20 })
    expect(is[0]).toBe(30)
    expect(is[is.length - 1]).toBe(240 - 1 - 5)
    expect(is.length).toBeLessThanOrEqual(20)
    expect(oos[0]).toBe(240)
    expect(oos[oos.length - 1]).toBe(300 - 1 - 5)
    // strictly ascending, no look-ahead within a surface
    for (let i = 1; i < is.length; i += 1) expect(is[i]).toBeGreaterThan(is[i - 1])
  })
})

// ---------------------------------------------------------------------------
// Walk-forward surface
// ---------------------------------------------------------------------------
describe("evaluateSurface", () => {
  it("up ramp: every decided LONG call wins (pure trend, cost 0)", () => {
    const { is, oos } = decisionIndices({ n: 300, minBars: 30, horizon: 5, isEnd: 240, maxDecisions: 24 })
    const isSurface = evaluateSurface({ series: UP, decisionTf: "60", indices: is, horizon: 5, cost: 0, windowSize: 100, minBars: 30 })
    const oosSurface = evaluateSurface({ series: UP, decisionTf: "60", indices: oos, horizon: 5, cost: 0, windowSize: 100, minBars: 30 })
    expect(isSurface.decided).toBeGreaterThan(0)
    expect(isSurface.hitRateNet).toBe(1)
    expect(isSurface.hitRateGross).toBe(1)
    expect(oosSurface.decided).toBeGreaterThan(0)
    expect(oosSurface.hitRateNet).toBe(1)
    // no SHORT call was ever manufactured on an up-only history
    for (const [state, b] of Object.entries(isSurface.byState)) {
      if (b.tried > 0) expect(state).toMatch(/^LONG/)
    }
    // moving window stays at 100% into the final sample
    const states = Object.keys(isSurface.window)
    expect(states.length).toBeGreaterThan(0)
    for (const samples of Object.values(isSurface.window)) {
      expect(samples[samples.length - 1].hitRate).toBe(1)
      for (const s of samples) expect(s.at).toBeGreaterThanOrEqual(30)
    }
  })

  it("down ramp mirrors: every decided SHORT call wins", () => {
    const { is } = decisionIndices({ n: 300, minBars: 30, horizon: 5, isEnd: 240, maxDecisions: 24 })
    const s = evaluateSurface({ series: DOWN, decisionTf: "60", indices: is, horizon: 5, cost: 0, windowSize: 100, minBars: 30 })
    expect(s.decided).toBeGreaterThan(0)
    expect(s.hitRateNet).toBe(1)
    for (const [state, b] of Object.entries(s.byState)) {
      if (b.tried > 0) expect(state).toMatch(/^SHORT/)
    }
  })
})

// ---------------------------------------------------------------------------
// runTechnicalBacktest — the honest report
// ---------------------------------------------------------------------------
describe("runTechnicalBacktest", () => {
  it("reports backtest-only labels on every node", () => {
    const r = runTechnicalBacktest(BASE_OPTS)
    expect(r.label).toBe(BACKTEST_LABEL)
    expect(r.disclaimer).toBe(DISCLAIMER)
    expect(r.best.is.label).toBe(BACKTEST_LABEL)
    expect(r.oos.label).toBe(BACKTEST_LABEL)
    for (const t of r.trials) expect(t.label).toBe(BACKTEST_LABEL)
  })

  it("splits a genuinely untouched out-of-sample tail before tuning", () => {
    const r = runTechnicalBacktest(BASE_OPTS)
    // in-sample truth never reaches into the reserve
    expect(Math.max(...r.indices.is)).toBeLessThanOrEqual(r.meta.isEnd - 1 - r.meta.horizonBars)
    // out-of-sample decisions all sit inside the reserved tail
    expect(Math.min(...r.indices.oos)).toBeGreaterThanOrEqual(r.meta.isEnd)
    expect(Math.max(...r.indices.oos) + r.meta.horizonBars).toBeLessThanOrEqual(r.meta.budget - 1)
  })

  it("modeled transaction costs haircut the win rate (B7)", () => {
    // same engine, same up-trend data: gross wins in every 5-bar window, but
    // each window moves ~0.10% < the 0.20% round-trip cost -> net 0.00
    const cheap = runTechnicalBacktest({ ...BASE_OPTS, series: COSTY, cost: 0 })
    const expensive = runTechnicalBacktest({ ...BASE_OPTS, series: COSTY, cost: 0.002 })
    expect(cheap.best.is.hitRateGross).toBe(1)
    expect(cheap.best.is.hitRateNet).toBe(1)
    expect(expensive.best.is.hitRateGross).toBe(1)
    expect(expensive.best.is.hitRateNet).toBe(0)
    // the haircut is visible in every trial, not just the best
    for (const t of expensive.trials) expect(t.hitRateNet).toBeLessThanOrEqual(t.hitRateGross)
  })

  it("fabricates no directional call on flat history", () => {
    const r = runTechnicalBacktest({ ...BASE_OPTS, series: FLAT })
    expect(r.best).toBeNull() // no config reached minTrades decided trades
    expect(r.oos).toBeNull()
    expect(r.configsTried).toBe(1)
    for (const t of r.trials) {
      expect(t.decided).toBe(0)
      expect(t.hitRateNet).toBeNull()
      expect(t.pushes).toBe(0)
    }
  })

  it("reports every configuration tried and tunes on net hit-rate", () => {
    const configs = [{}, { dims: { structure: false } }, { dropOpen: true }]
    const r = runTechnicalBacktest({ ...BASE_OPTS, configs })
    expect(r.configsTried).toBe(3)
    expect(r.trials).toHaveLength(3)
    // all three configs win 100% on the pure ramp, so the stable sort keeps
    // the first config as best (identical net hit-rate)
    expect(r.best.config).toEqual({})
    // is window comes from the best config's surface
    expect(r.best.is.decided).toBeGreaterThan(0)
  })

  it("exposes the moving-window trajectory under the decision surface names", () => {
    const r = runTechnicalBacktest(BASE_OPTS)
    for (const [state, samples] of Object.entries(r.best.is.window)) {
      expect(state).toMatch(/^LONG/)
      expect(samples.length).toBeGreaterThan(0)
      for (const s of samples) {
        expect(s.hitRate).toBeGreaterThanOrEqual(0)
        expect(s.hitRate).toBeLessThanOrEqual(1)
        expect(s.n).toBeGreaterThan(0)
      }
    }
  })

  it("fails loudly on missing decision timeframe or too-short series", () => {
    expect(() => runTechnicalBacktest({ series: {}, decisionTf: "60" })).toThrow(/decision timeframe/)
    expect(() => runTechnicalBacktest({ series: { 60: rampSeries(10, 0.001) }, decisionTf: "60" })).toThrow(/too short/)
  })
})