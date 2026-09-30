import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resetRegimeLatches } from "../services/regimeEngine.mjs"

// marketConvergence — the realtime-suite loader that turns live buffers (and M1
// aggregation) into a ConvergenceResult. These tests pin the honest-absence
// path: with no live plane every timeframe must yield NO TRADE with "—" values
// (R10), never fabricated reads.
//
// D2/AC-005: the `vi.mock("../services/liveEO.mjs", …)` and the buffer fixtures
// are removed with liveEO.mjs. `convergenceSection` now holds `data = null`
// unconditionally (there is no live buffer to read), so `source` is "none" and
// every plane is inactive/stale/absent. The tests that asserted a POPULATED
// read from an injected liveEO buffer are removed with the injection point they
// used; the R10 honest-absence guarantee they also asserted is retained below and
// is now the only reachable outcome.

const M1 = (n) =>
  Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 60,
    open: 100 + i * 0.01,
    high: 100 + i * 0.02,
    low: 99.99 + i * 0.01,
    close: 100 + i * 0.01,
    volume: 10
  }))

const viewedData = (m1Count = 1000) => ({
  status: "connected",
  mode: "live",
  account: { balance: 1000 },
  viewed: "EURUSD",
  watching: [{ id: "EURUSD", name: "EURUSD", type: "forex" }],
  assets: [
    {
      id: "EURUSD",
      name: "EURUSD",
      type: "forex",
      periods: { 60: M1(m1Count), 300: M1(200), 900: M1(100), 3600: M1(60), 1800: [], 14400: [] }
    }
  ],
  ts: 1
})

// B-REG-3 fixtures: distinct per-TF candle patterns (probe-verified leans).
// Constant half-range up-drift ramp -> choppiness+adx trend lean, atr neutral.
const ramp = (n) => {
  const rows = []
  let close = 100
  for (let i = 0; i < n; i++) {
    const open = close
    close = 100 + (i + 1) * 0.01
    rows.push({ time: 1700000000 + i * 60, open, high: close + 0.01, low: close - 0.01, close, volume: 1000 })
  }
  return rows
}
const chop = (n) =>
  Array.from({ length: n }, (_, i) => {
    const close = i % 2 === 0 ? 100.01 : 99.99
    return { time: 1700000000 + i * 60, open: i % 2 === 0 ? 99.99 : 100.01, high: close + 0.02, low: close - 0.02, close, volume: 1000 }
  }) // alternating -> choppiness chop + adx no-trend (range lean x2)
const flat = (n) =>
  Array.from({ length: n }, (_, i) => ({ time: 1700000000 + i * 60, open: 100, high: 100.02, low: 99.98, close: 100, volume: 1000 }))
  // constant -> choppiness chop only (range lean x1), adx abstains

const dataFor = (periods) => ({
  status: "connected",
  mode: "live",
  account: { balance: 1000 },
  viewed: "EURUSD",
  watching: [{ id: "EURUSD", name: "EURUSD", type: "forex" }],
  assets: [{ id: "EURUSD", name: "EURUSD", type: "forex", periods }],
  ts: 1
})

// Thin M1 (5 bars): the M1 plane and the aggregate planes abstain, so the
// consensus is exactly: 3600 ramp (trend x3 via bias weight) vs 300 chop
// (range x2) + 900 flat (range x1) -> trend 3 vs range 3 = UNCERTAIN.
const uncertainData = () =>
  dataFor({ 60: ramp(5), 300: chop(60), 900: flat(60), 3600: ramp(60), 1800: [], 14400: [] })

// Every in-buffer plane ramps (7 lean weight) -> TRENDING, confidence 100.
const allTrendData = () =>
  dataFor({ 60: ramp(60), 300: ramp(60), 900: ramp(60), 3600: ramp(60), 1800: [], 14400: [] })

let m
beforeAll(async () => {
  m = await import("../services/marketConvergence.mjs")
})

// The regime latch and the per-asset mode map live at module scope; any
// test that drives convergenceSection leaves state behind. Reset for every
// test so each one starts with a fresh latch and default "soft" mode.
afterEach(() => {
  m.resetRegimeModes()
  resetRegimeLatches()
})

describe("convergenceSection", () => {
  // D2/AC-005: the two buffer-fed tests are removed with the buffer. The first
  // asserted a POPULATED read sourced from "liveEO-buffers"; the second
  // asserted viewed-asset SELECTION, which only existed to choose which live
  // buffer to read. With `data = null` there is no asset to select and no plane
  // to populate, so neither has a reachable assertion left.

  it("reports NO TRADE with --- values when no buffers exist (R10)", async () => {
    const r = await m.convergenceSection({ now: 1 })
    expect(r.assetId).toBeNull()
    expect(r.ok).toBe(true) // the ladder was requested...
    expect(r.state).toBe("NO TRADE")
    expect(r.why).toContain("no data")
    expect(r.score5).toBeNull()
    expect(r.quality).toBeNull()
    expect(r.confidence).toBeNull()
    expect(r.planes.every((p) => p.score === null)).toBe(true)
    expect(r.planes.every((p) => p.active === false)).toBe(true)
    expect(r.planes.every((p) => p.stale === true)).toBe(true)
    expect(r.planes.every((p) => p.source === "none")).toBe(true)
  })

  it("reports source 'none' and echoes the requested clock, not a live plane", async () => {
    // D2/AC-005: `source` moved from "liveEO-buffers" to "none" with the buffer.
    // This pins the NEW TRUE value: no buffer can serve, so the section says so
    // rather than naming a source it can no longer read.
    const r = await m.convergenceSection({ now: 1234 })
    expect(r.source).toBe("none")
    expect(r.ts).toBe(1234)
    expect(r.assetId).toBeNull()
  })

  it("exposes the exact ladder constants the panel renders against", () => {
    expect(m.CONVERGENCE_TIMEFRAMES).toEqual([60, 300, 900, 3600, 1800, 14400])
    expect(m.CONVERGENCE_DERIVE_TFS).toEqual([1800, 14400])
  })
})

describe("convergenceSection regime wiring (B-REG-3)", () => {
  // D2/AC-005: the three buffer-fed regime tests are removed with the buffer.
  // Each injected an `uncertainData()` / `allTrendData()` liveEO payload to drive
  // the regime ladder from real candles. With `data = null` the regime read is
  // always "unknown" and the ladder has nothing to modulate, so the mode-off /
  // soft-latch / all-trend branches are unreachable from production. They are
  // NOT rewritten to pass trivially: an assertion that always holds teaches
  // nothing. The honest-unknown case is asserted below and that is now the only
  // reachable regime outcome.

  it("absent live plane yields source:none + an honest unknown regime block, no crash", async () => {
    const r = await m.convergenceSection({ now: 50 })
    expect(r.regime.regime).toBe("unknown")
    expect(r.regime.confidence).toBe(0)
    expect(r.regime.applied).toBe(false)
    expect(r.regime.mode).toBe("soft")
    expect(r.state).toBe("NO TRADE")
    expect(r.score5).toBeNull()
  })
})