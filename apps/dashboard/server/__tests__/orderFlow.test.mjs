import { describe, expect, test } from "vitest"
import { analyzeOrderFlow } from "../services/orderFlow.mjs"

// Deterministic single bar: open 9.5 → close 10.5 over range [9,11].
// These bars are the *input that must be refused*, not a delta source.
const BULL = { time: 1700000000, open: 9.5, high: 11, low: 9, close: 10.5, volume: 1000 }
const BEAR = { time: 1700000060, open: 11.5, high: 12, low: 10, close: 10.5, volume: 1000 }

function bars(n, bar) {
  return Array.from({ length: n }, (_, i) => ({ ...bar, time: bar.time + i * 60 }))
}

function trade(side, amount, extra = {}) {
  return { timeMs: extra.timeMs ?? 1700000000, price: extra.price ?? 10, side, amount }
}

describe("orderFlow — bar-only honesty (WS-6 D14 / AC-008)", () => {
  // These tests replaced assertions that the candle-derived approximation was
  // correct. Bars contain no aggressor-side information, so no order-flow field
  // may be derived from them.
  test("bar-only input is reported unavailable, never approximated", () => {
    const r = analyzeOrderFlow({ bars: bars(20, BULL) })
    expect(r.available).toBe(false)
    expect(r.delta).toEqual([])
    expect(r.cumulative).toBeNull()
    expect(r.avgDelta).toBeNull()
    expect(r.imbalance).toBe("unavailable")
    expect(r.signals).toEqual([])
  })

  test("no fabricated buyPct/sellPct field is ever emitted", () => {
    // The removed implementation published buyPct/sellPct inferred from body
    // ratio. Their total absence is the regression guard.
    for (const barsIn of [bars(20, BULL), bars(20, BEAR), [BULL, BEAR]]) {
      const r = analyzeOrderFlow({ bars: barsIn })
      expect(r).not.toHaveProperty("buyPct")
      expect(r).not.toHaveProperty("sellPct")
      expect(r.delta).toEqual([])
    }
  })

  test("no absorption or divergence signal is fabricated from bars", () => {
    // A uniform bull run previously produced `bullish-absorption`; the
    // previously-documented "unreachable" divergence branch is now reachable
    // ONLY from a real feed, so bars must yield no signals at all.
    const r = analyzeOrderFlow({ bars: bars(20, BULL) })
    expect(r.signals).toEqual([])
    expect(r.imbalance).not.toBe("buy-heavy")
    expect(r.imbalance).not.toBe("sell-heavy")
  })

  test("unavailable reason names the missing feed and the data fidelity", () => {
    const r = analyzeOrderFlow({ bars: bars(20, BULL) })
    expect(r.dataFidelity).toBe("ohlcv-bar-only")
    expect(r.reason).toMatch(/no signed-trades feed/i)
    expect(r.reason).toMatch(/OHLCV bars contain no aggressor-side information/i)
  })

  test("absent, empty, and non-array inputs all fail closed as unavailable", () => {
    for (const r of [
      analyzeOrderFlow(),
      analyzeOrderFlow({}),
      analyzeOrderFlow({ trades: [] }),
      analyzeOrderFlow({ trades: null, bars: null }),
      analyzeOrderFlow({ trades: "not-an-array" })
    ]) {
      expect(r.available).toBe(false)
      expect(r.cumulative).toBeNull()
      expect(r.imbalance).toBe("unavailable")
    }
    expect(analyzeOrderFlow({}).dataFidelity).toBe("no-feed")
  })
})

describe("orderFlow — genuine signed-trades computation", () => {
  test("computes per-trade delta from the feed, not from price direction", () => {
    const trades = [trade("buy", 150), trade("sell", 50), trade("take", 999)]
    const r = analyzeOrderFlow({ trades })
    expect(r.available).toBe(true)
    expect(r.dataFidelity).toBe("signed-trades")
    expect(r.delta.map((d) => d.delta)).toEqual([150, -50, 0])
    expect(r.cumulative).toBe(100)
  })

  test("a take fill consumes resting size without shifting delta", () => {
    const r = analyzeOrderFlow({ trades: [trade("take", 5000)] })
    expect(r.delta[0].delta).toBe(0)
    expect(r.cumulative).toBe(0)
    expect(r.imbalance).toBe("neutral")
  })

  test("three consecutive buy prints yield buy-heavy + bullish absorption", () => {
    const r = analyzeOrderFlow({ trades: [trade("buy", 200), trade("buy", 200), trade("buy", 200)] })
    expect(r.avgDelta).toBe(200)
    expect(r.cumulative).toBe(600)
    expect(r.imbalance).toBe("buy-heavy")
    expect(r.signals.some((s) => s.type === "bullish-absorption")).toBe(true)
  })

  test("divergence is genuinely reachable from a real feed", () => {
    // Regression test for the removed implementation's documented dead branch:
    // delta sign used to be derived from the same bar body, making "price up
    // but delta negative" impossible. With feed-derived delta it is computable.
    const trades = [trade("buy", 100), trade("sell", 200, { timeMs: 1700000060 })]
    const upBar = { ...BULL }
    const r = analyzeOrderFlow({ trades, bars: [upBar] })
    expect(r.available).toBe(true)
    const div = r.signals.find((s) => s.type === "divergence")
    expect(div).toBeDefined()
    expect(div.desc).toMatch(/hidden selling/i)
  })

  test("down bar with positive feed delta reports hidden buying", () => {
    const trades = [trade("sell", 100), trade("buy", 200, { timeMs: 1700000060 })]
    const r = analyzeOrderFlow({ trades, bars: [{ ...BULL, open: 10.5, close: 9.5 }] })
    const div = r.signals.find((s) => s.type === "divergence")
    expect(div).toBeDefined()
    expect(div.desc).toMatch(/hidden buying/i)
  })
})
