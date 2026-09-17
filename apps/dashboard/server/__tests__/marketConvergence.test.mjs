import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resetRegimeLatches } from "../services/regimeEngine.mjs"

// marketConvergence — the realtime-suite loader that turns live ExpertOption
// buffers (and M1 aggregation) into a ConvergenceResult. These tests pin the
// honest-absence paths: no connected session, empty buffers, or a throwing
// liveEOData must yield NO TRADE with "—" values (R10), never fabricated reads.
vi.mock("../services/liveEO.mjs", () => ({
  liveEOData: vi.fn()
}))

const liveEO = await import("../services/liveEO.mjs")

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
  it("uses in-buffer TFs directly and aggregates 30m/4h from M1 for the viewed asset", async () => {
    vi.mocked(liveEO.liveEOData).mockReturnValue(viewedData(1000))
    const r = await m.convergenceSection({ now: 1234 })
    expect(r.assetId).toBe("EURUSD")
    expect(r.ts).toBe(1234)
    expect(r.source).toBe("liveEO-buffers")
    // 1000 M1 bars -> ceil(1000/30)=34 x 30m bars -> ACTIVE plane from M1
    const m30 = r.planes.find((p) => p.tf === 1800)
    expect(m30.source).toBe("aggregate")
    expect(m30.active).toBe(true)
    expect(m30.score).not.toBeNull()
    // in-buffer timeframes carry their own labels
    expect(r.planes.find((p) => p.tf === 60).source).toBe("live")
    expect(r.planes.find((p) => p.tf === 300).source).toBe("live")
    // the viewed asset rides through
    expect(r.state).not.toBe("NO TRADE")
  })

  it("selects the first asset when nothing is viewed", async () => {
    const data = viewedData(1000)
    data.viewed = null
    vi.mocked(liveEO.liveEOData).mockReturnValue(data)
    const r = await m.convergenceSection()
    expect(r.assetId).toBe("EURUSD")
  })

  it("reports NO TRADE with --- values when no buffers exist (R10)", async () => {
    vi.mocked(liveEO.liveEOData).mockReturnValue({ status: "idle", mode: null, account: null, viewed: null, assets: [], ts: 0 })
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

  it("a throwing liveEOData degrades to the same honest absent read", async () => {
    vi.mocked(liveEO.liveEOData).mockImplementationOnce(() => { throw new Error("liveEO not started") })
    const r = await m.convergenceSection()
    expect(r.state).toBe("NO TRADE")
    expect(r.score5).toBeNull()
    expect(r.planes).toHaveLength(m.CONVERGENCE_TIMEFRAMES.length)
  })

  it("exposes the exact ladder constants the panel renders against", () => {
    expect(m.CONVERGENCE_TIMEFRAMES).toEqual([60, 300, 900, 3600, 1800, 14400])
    expect(m.CONVERGENCE_DERIVE_TFS).toEqual([1800, 14400])
  })
})

describe("convergenceSection regime wiring (B-REG-3)", () => {

  it("mode off leaves the engine payload unmodulated even for a UNCERTAIN regime", async () => {
    m.setRegimeMode("EURUSD", "off")
    vi.mocked(liveEO.liveEOData).mockReturnValue(uncertainData())
    const r = await m.convergenceSection({ now: 20 })
    // the conservative knob that WOULD fire in soft mode did not:
    expect(r.meta.conservative).toBe(false)
    expect(r.regime.applied).toBe(false)
    expect(r.regime.mode).toBe("off")
    expect(r.regime.labels).toBeNull()
    // the regime read itself is still honest and visible:
    expect(r.regime.regime).toBe("UNCERTAIN")
    expect(r.regime.unsettled).toBe(true)
  })

  it("latched UNCERTAIN applies conservative + regime suffix in the state block", async () => {
    vi.mocked(liveEO.liveEOData).mockReturnValue(uncertainData())
    const first = await m.convergenceSection({ now: 30 })
    expect(first.regime.regime).toBe("UNCERTAIN")
    expect(first.regime.unsettled).toBe(true) // first read: not yet latched
    expect(first.regime.mode).toBe("soft")
    expect(first.regime.applied).toBe(true)
    expect(first.meta.conservative).toBe(true)
    expect(first.regime.labels.suffix).toMatch(/^regime:uncertain/)
    const second = await m.convergenceSection({ now: 31 })
    expect(second.regime.unsettled).toBe(false) // committed after two agreeing reads
    expect(second.regime.confirmCount).toBe(2)
    expect(second.meta.conservative).toBe(true)
  })

  it("all-trend soft read applies the confidence-scaled ladder with a trending suffix", async () => {
    vi.mocked(liveEO.liveEOData).mockReturnValue(allTrendData())
    const r = await m.convergenceSection({ now: 40 })
    expect(r.regime.regime).toBe("TRENDING")
    expect(r.regime.confidence).toBe(100)
    expect(r.regime.applied).toBe(true)
    expect(r.regime.labels.suffix).toContain("trending")
    expect(r.meta.conservative).toBe(false)
  })

  it("absent liveEO yields source:none + an honest unknown regime block, no crash", async () => {
    vi.mocked(liveEO.liveEOData).mockReturnValue({ status: "idle", mode: null, account: null, viewed: null, assets: [], ts: 0 })
    const r = await m.convergenceSection({ now: 50 })
    expect(r.regime.regime).toBe("unknown")
    expect(r.regime.confidence).toBe(0)
    expect(r.regime.applied).toBe(false)
    expect(r.regime.mode).toBe("soft")
    expect(r.state).toBe("NO TRADE")
    expect(r.score5).toBeNull()
  })
})