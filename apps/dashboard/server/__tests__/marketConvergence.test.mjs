import { beforeAll, describe, expect, it, vi } from "vitest"

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

let m
beforeAll(async () => {
  m = await import("../services/marketConvergence.mjs")
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