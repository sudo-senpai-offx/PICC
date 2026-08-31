// T7 — U4FA decision markers for the candlestick chart. The overlay must draw
// ONLY from real `type:"u4fa"` SSE events for the chart asset, must drop
// anything without named producers (honesty gate), and must never fabricate a
// marker for a strategy-off asset (which emits no events at all).

import { describe, expect, it } from "vitest"
import type { UTCTimestamp } from "lightweight-charts"
import type { LiveEvent } from "@/lib/liveTrading"
import type { CandleDatum } from "@/components/CandlestickChart"
import { u4faMarkersFor } from "@/lib/u4faOverlay"

// 300s bars starting 2026-08-31 00:00:00 UTC
const T0 = 1785542400
const candles: CandleDatum[] = Array.from({ length: 20 }, (_, i) => ({
  time: (T0 + i * 300) as UTCTimestamp,
  open: 1.08,
  high: 1.09,
  low: 1.07,
  close: 1.085
}))

const mkU4fa = (over: Partial<Record<string, unknown>> = {}): LiveEvent => ({
  type: "u4fa",
  ts: T0 * 1000 + 10,
  assetId: "EURUSD",
  style: "2",
  direction: "up",
  verdict: "TRADE",
  expiry: 900,
  factors: null,
  regime: null,
  timing: null,
  indicators: null,
  risk: { riskPct: 0.5, dailyLossLimitPct: 5, maxDailyTrades: 10 },
  compliance: { requiresHumanApproval: true, proposalId: null },
  honesty: { spreadSource: null, structureSource: "fixture", calendarSource: "fixture", candleSource: "fixture" },
  ...over
})

describe("u4faMarkersFor", () => {
  it("maps an up/TRADE event to an above-bar green arrow reusing the bar's time", () => {
    const [m] = u4faMarkersFor([mkU4fa()], "EURUSD", candles)
    expect(m).toBeDefined()
    expect(m.position).toBe("aboveBar")
    expect(m.shape).toBe("arrowUp")
    expect(m.color).toBe("#4ade80")
    expect(m.text).toBe("TRADE")
    expect(m.time).toBe(T0) // snapped to the owning bar's own time value
  })

  it("maps a down/OBSERVE event to a below-bar amber arrow", () => {
    const [m] = u4faMarkersFor(
      [mkU4fa({ direction: "down", verdict: "OBSERVE", ts: (T0 + 5 * 300) * 1000 + 42 })],
      "EURUSD",
      candles
    )
    expect(m).toBeDefined()
    expect(m.position).toBe("belowBar")
    expect(m.shape).toBe("arrowDown")
    expect(m.color).toBe("#f59e0b")
    expect(m.text).toBe("OBSERVE")
    expect(m.time).toBe(T0 + 5 * 300)
  })

  it("drops events for a different asset (shared stream carries all opted-in assets)", () => {
    expect(u4faMarkersFor([mkU4fa()], "GBPUSD", candles)).toEqual([])
  })

  it("drops events without named producers (honesty gate)", () => {
    expect(u4faMarkersFor([mkU4fa({ honesty: null })], "EURUSD", candles)).toEqual([])
  })

  it("snaps a mid-bar timestamp to the owning bar's time", () => {
    const [m] = u4faMarkersFor([mkU4fa({ ts: (T0 + 2 * 300) * 1000 + 137 })], "EURUSD", candles)
    expect(m.time).toBe(T0 + 2 * 300)
  })

  it("drops an event whose timestamp has no nearby bar (never mis-places)", () => {
    // 10 minutes before the first candle, far beyond the 300s tolerance.
    expect(u4faMarkersFor([mkU4fa({ ts: (T0 - 600) * 1000 })], "EURUSD", candles)).toEqual([])
  })

  it("keeps only the newest event per bar", () => {
    const old = mkU4fa({ ts: (T0 + 300) * 1000 + 1, verdict: "OBSERVE" })
    const fresh = mkU4fa({ ts: (T0 + 300) * 1000 + 500, verdict: "TRADE" })
    const [m] = u4faMarkersFor([fresh, old], "EURUSD", candles)
    expect(m.text).toBe("TRADE") // newest wins the same bar
    expect(u4faMarkersFor([old, fresh], "EURUSD", candles)).toHaveLength(1)
  })

  it("renders nothing for a strategy-off asset (no u4fa events emitted at all)", () => {
    expect(u4faMarkersFor([], "EURUSD", candles)).toEqual([])
  })

  it("returns [] when there are no candles to hang markers on", () => {
    expect(u4faMarkersFor([mkU4fa()], "EURUSD", [])).toEqual([])
  })

  it("sorts markers ascending by bar time", () => {
    const later = mkU4fa({ ts: (T0 + 5 * 300) * 1000, verdict: "TRADE" })
    const earlier = mkU4fa({ ts: (T0 + 1 * 300) * 1000, verdict: "OBSERVE" })
    expect(u4faMarkersFor([later, earlier], "EURUSD", candles).map((m) => m.time))
      .toEqual([T0 + 1 * 300, T0 + 5 * 300])
  })
})