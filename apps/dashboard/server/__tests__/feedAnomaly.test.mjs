// Wave3+03 — feed anomaly detector (TDD RED): per-detector fixtures.
// Pure, hermetic, no env. Detection module only — no caller wiring.
import { describe, expect, it } from "vitest"
import {
  DIVERGENCE_TOLERANCE_PCT,
  SPIKE_MIN_BARS,
  SPIKE_SIGMA,
  assessFeedQuality,
  detectDivergence,
  detectGaps,
  detectSpike,
  detectStale,
} from "../services/feedAnomaly.mjs"

const T0 = 1_700_000_000 // epoch seconds (matches marketDataBus candle convention)

function flatCandles(n, base = 100, stepSec = 60, t0 = T0) {
  return Array.from({ length: n }, (_, i) => ({
    time: t0 + i * stepSec,
    open: base,
    high: base + 0.05,
    low: base - 0.05,
    close: base,
  }))
}

describe("feedAnomaly thresholds are named + sane", () => {
  it("exposes documented constants", () => {
    expect(SPIKE_SIGMA).toBeGreaterThanOrEqual(5)
    expect(SPIKE_MIN_BARS).toBeGreaterThanOrEqual(10)
    expect(DIVERGENCE_TOLERANCE_PCT).toBeGreaterThan(0)
  })
})

describe("detectSpike", () => {
  it("passes a healthy flat baseline", () => {
    expect(detectSpike(flatCandles(40)).ok).toBe(true)
  })
  it("flags a >N-sigma injected spike with a named reason", () => {
    const candles = flatCandles(40)
    candles[candles.length - 1] = { ...candles[candles.length - 1], close: 130, high: 131 }
    const out = detectSpike(candles)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/spike/i)
  })
  it("skips (never false-alarms) on insufficient bars", () => {
    const out = detectSpike(flatCandles(5))
    expect(out.ok).toBe(true)
    expect(out.skipped).toBeTruthy()
  })
})

describe("detectGaps", () => {
  it("passes contiguous 60s candles", () => {
    expect(detectGaps(flatCandles(30, 100, 60), 60_000).ok).toBe(true)
  })
  it("flags missing intervals with a named reason (no fabricated fills)", () => {
    const candles = flatCandles(30, 100, 60)
    candles.splice(10, 3) // drop 3 bars → 4-minute hole
    const out = detectGaps(candles, 60_000)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/gap/i)
    expect(out.missing).toBeGreaterThanOrEqual(3)
    expect(out.filled).toBeUndefined() // honesty: report, never invent bars
  })
})

describe("detectStale", () => {
  it("passes a fresh write, refuses an aged one", () => {
    const now = 1_700_000_000_000
    expect(detectStale(now - 5_000, 30_000, now).ok).toBe(true)
    const stale = detectStale(now - 120_000, 30_000, now)
    expect(stale.ok).toBe(false)
    expect(stale.reason).toMatch(/stale/i)
  })
  it("refuses unconfigured (non-finite) timestamps", () => {
    expect(detectStale(null, 30_000, 1_700_000_000_000).ok).toBe(false)
    expect(detectStale(0, 30_000, 1_700_000_000_000).reason).toMatch(/unconfigured/i)
  })
})

describe("detectDivergence", () => {
  it("passes agreeing venues within tolerance", () => {
    const a = flatCandles(30, 100)
    const b = flatCandles(30, 100.1) // 0.1% apart < 0.5% default
    expect(detectDivergence(a, b).ok).toBe(true)
  })
  it("flags diverged venues with a named reason", () => {
    const a = flatCandles(30, 100)
    const b = flatCandles(30, 105) // 5% apart
    const out = detectDivergence(a, b)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/divergen/i)
  })
  it("skips on insufficient overlap", () => {
    const out = detectDivergence(flatCandles(2), flatCandles(2))
    expect(out.ok).toBe(true)
    expect(out.skipped).toBeTruthy()
  })
})

describe("assessFeedQuality (composite refuse-switch)", () => {
  it("passes a fully healthy feed", () => {
    const now = 1_700_000_00_0000
    const candles = flatCandles(40, 100, 60, Math.floor(now / 1000) - 40 * 60)
    const out = assessFeedQuality({
      candles,
      expectedIntervalMs: 60_000,
      lastAtMs: now - 5_000,
      maxAgeMs: 30_000,
      sibling: flatCandles(40, 100.1, 60, Math.floor(now / 1000) - 40 * 60),
      nowMs: now,
    })
    expect(out.ok).toBe(true)
    expect(out.reasons).toEqual([])
  })
  it("refuses a spiky+gappy+stale+diverged feed with every reason named", () => {
    const now = 1_700_000_00_0000
    const candles = flatCandles(40)
    candles.splice(5, 2)
    candles[candles.length - 1] = { ...candles[candles.length - 1], close: 150, high: 151 }
    const out = assessFeedQuality({
      candles,
      expectedIntervalMs: 60_000,
      lastAtMs: now - 999_000,
      maxAgeMs: 30_000,
      sibling: flatCandles(40, 120),
      nowMs: now,
    })
    expect(out.ok).toBe(false)
    expect(out.reasons.length).toBeGreaterThanOrEqual(3)
    for (const r of out.reasons) expect(r).toMatch(/^(spike|gap|stale|divergence|unconfigured)/i)
  })
})
