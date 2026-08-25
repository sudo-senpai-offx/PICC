import { describe, expect, it } from "vitest"
import { computeEntryLevels } from "../services/entryLevels.mjs"
import { computeKelly, kellySnapshot } from "../services/kellyCriterion.mjs"

/** Deterministic rising-then-pulling-back series with realistic OHLC shape. */
function synthCandles(n = 120) {
  const rows = []
  let price = 100
  for (let i = 0; i < n; i++) {
    const drift = i < n * 0.7 ? 0.15 : -0.1
    price += drift
    rows.push({
      time: 1700000000 + i * 60,
      open: price - 0.05,
      high: price + 0.4,
      low: price - 0.4,
      close: price
    })
  }
  return rows
}

describe("entry levels (ideal buy/sell price points)", () => {
  it("returns a coherent level set for a healthy candle series", () => {
    const candles = synthCandles()
    const out = computeEntryLevels(candles, { timeframe: 60 })
    expect(out.ok).toBe(true)
    const spot = out.spot
    expect(spot).toBeCloseTo(candles[candles.length - 1].close, 4)
    expect(out.atr).toBeGreaterThan(0)
    // Every level is near the money and correctly classified.
    for (const l of out.levels) {
      expect(Math.abs(l.distancePct)).toBeLessThanOrEqual(5)
      expect(["support", "resistance"]).toContain(l.kind)
      expect(l.strength).toBeGreaterThanOrEqual(1)
      expect(l.strength).toBeLessThanOrEqual(5)
      if (l.kind === "support") expect(l.price).toBeLessThan(spot)
      else expect(l.price).toBeGreaterThan(spot)
    }
    // Buy zone sits below spot, sell zone above (when both exist).
    if (out.buyZone) expect(out.buyZone.high).toBeLessThanOrEqual(out.buyZone.anchor + out.atr / 4 + 1e-9)
    if (out.sellZone) expect(out.sellZone.low).toBeGreaterThanOrEqual(out.sellZone.anchor - out.atr / 4 - 1e-9)
  })

  it("refuses to invent levels from thin data", () => {
    expect(computeEntryLevels([], {}).ok).toBe(false)
    const few = synthCandles(10)
    expect(computeEntryLevels(few, {}).ok).toBe(false)
    const reason = computeEntryLevels(few, {}).reason
    expect(reason).toMatch(/not enough candles/)
  })

  it("filters corrupt rows (null/zero/inverted OHLC) instead of crashing", () => {
    const candles = synthCandles(60)
    candles.push({ time: 1700000000 + 999, open: null, high: null, low: null, close: null })
    candles.push({ time: 1700000000 + 1000, open: 0, high: 0, low: 0, close: 0 })
    const out = computeEntryLevels(candles, {})
    expect(out.ok).toBe(true)
  })

  it("never throws on garbage input", () => {
    expect(() => computeEntryLevels(null, {})).not.toThrow()
    expect(() => computeEntryLevels("junk", {})).not.toThrow()
    expect(() => computeEntryLevels([{ open: "x" }], {})).not.toThrow()
    expect(computeEntryLevels(null, {}).ok).toBe(false)
  })
})

describe("kelly criterion unit handling", () => {
  it("accepts winRate/payout as fraction OR percent identically", () => {
    const asFraction = computeKelly(0.68, 0.82, "half")
    const asPercent = computeKelly(68, 82, "half")
    expect(asPercent.fullKelly).toBe(asFraction.fullKelly)
    expect(asPercent.suggested).toBe(asFraction.suggested)
    expect(asFraction.suggested).toBeGreaterThanOrEqual(0)
  })

  it("still returns the zero object for impossible values", () => {
    expect(computeKelly(101, 0.8).suggested).toBe(0)
    expect(computeKelly(0.5, -1).fullKelly).toBe(0)
  })

  it("snapshot stats stay in percent while kelly math uses fractions internally", () => {
    const snap = kellySnapshot()
    expect(snap.stats.winRate).toBeLessThanOrEqual(100)
    expect(snap.stats.avgPayout).toBeLessThanOrEqual(2)
  })
})
