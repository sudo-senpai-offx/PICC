import { describe, expect, test } from "vitest"
import { analyzeOrderFlow } from "../services/orderFlow.mjs"

// Deterministic single bar: open 9.5 → close 10.5 over range [9,11].
// bodyRatio = |10.5-9.5| / 2 = 0.5 → buyPct = 50 + 0.5*30 = 65 →
// delta = ((65-50)/50) * 1000 = 300.
const BULL = { time: 1700000000, open: 9.5, high: 11, low: 9, close: 10.5, volume: 1000 }
// Mirror bearish bar: buyPct = 35 → delta = -300.
const BEAR = { time: 1700000060, open: 11.5, high: 12, low: 10, close: 10.5, volume: 1000 }

function bars(n, bar) {
  return Array.from({ length: n }, (_, i) => ({ ...bar, time: bar.time + i * 60 }))
}

describe("orderFlow (slice 5d coverage)", () => {
  test("short input returns an empty, safe result", () => {
    const r = analyzeOrderFlow([BULL, BULL], 20)
    expect(r.delta).toEqual([])
    expect(r.cumulative).toBe(0)
    expect(r.imbalance).toBe("neutral")
    expect(r.signals).toEqual([])
  })

  test("uniform bull run → buy-heavy + bullish absorption with exact per-bar math", () => {
    const r = analyzeOrderFlow(bars(20, BULL), 20)
    expect(r.delta).toHaveLength(20)
    expect(r.delta[0]).toMatchObject({ delta: 300, buyPct: 65, sellPct: 35, volume: 1000 })
    expect(r.cumulative).toBe(6000)
    expect(r.avgDelta).toBe(300)
    expect(r.imbalance).toBe("buy-heavy")
    expect(r.signals.some((s) => s.type === "bullish-absorption")).toBe(true)
  })

  test("uniform bear run → sell-heavy + bearish absorption", () => {
    const r = analyzeOrderFlow(bars(20, BEAR), 20)
    expect(r.delta[0]).toMatchObject({ delta: -300, buyPct: 35, sellPct: 65 })
    expect(r.cumulative).toBe(-6000)
    expect(r.imbalance).toBe("sell-heavy")
    expect(r.signals.some((s) => s.type === "bearish-absorption")).toBe(true)
  })

  test("balanced alternating flow stays neutral with no absorption signal", () => {
    const mixed = Array.from({ length: 20 }, (_, i) => ({ ...(i % 2 === 0 ? BULL : BEAR), time: BULL.time + i * 60 }))
    const r = analyzeOrderFlow(mixed, 20)
    expect(r.cumulative).toBe(0)
    expect(r.imbalance).toBe("neutral")
    // Tail is bull/bear/bull — no 3-run, no signal.
    expect(r.signals).toEqual([])
  })

  test("known limitation: divergence branches are structurally unreachable (documented)", () => {
    // delta's sign derives from the SAME bar's body direction (buyPct ≥ 50 iff
    // close ≥ open), so "price up but delta negative" can never fire. Kept here
    // as an explicit record rather than an untested claim — see AUDIT_REPORT §5.9.
    const r = analyzeOrderFlow(bars(20, BULL), 20)
    expect(r.signals.every((s) => s.type !== "divergence")).toBe(true)
  })
})
