import { beforeAll, describe, expect, it, vi } from "vitest"

// Realtime suite aggregation — one cached snapshot for every trading metric the
// suite shows, served over /api/trading/realtime. These tests pin the shape,
// the per-section caching, the mutation bust, and failure isolation.
vi.mock("../services/trading.mjs", () => ({
  tradingStatus: vi.fn(async () => ({ ok: true, mode: "paper", paper: { cash: 1234 } })),
  paperPositions: vi.fn(async () => [{ id: "p1" }]),
  paperHistory: vi.fn(async () => [{ id: "c1" }]),
  recentSignals: vi.fn(async () => [{ id: "s1" }]),
  signalAccuracy: vi.fn(async () => ({ hitRate: 60 }))
}))
vi.mock("../services/accuracyLedger.mjs", () => ({
  ledgerStats: vi.fn(async () => ({ wins: 3 })),
  ledgerEngineStats: vi.fn(async () => ({ version: 2 })),
  ledgerHistory: vi.fn(async () => [{ id: "e1" }])
}))
vi.mock("../services/autopilot.mjs", () => ({
  demoStatus: vi.fn(async () => ({ ok: true, demo: true, connected: true })),
  demoDeals: vi.fn(async () => ({ ok: true, deals: [{ id: "d1" }] })),
  demoAnalytics: vi.fn(async () => ({ overview: { deals: 1 } }))
}))
vi.mock("../services/liveEO.mjs", () => ({
  liveEOStats: vi.fn(() => ({ status: "idle" })),
  liveEOData: vi.fn(async () => ({ status: "idle", mode: null, account: null, viewed: null, assets: [] }))
}))

const trading = await import("../services/trading.mjs")
const ledger = await import("../services/accuracyLedger.mjs")
const autopilot = await import("../services/autopilot.mjs")
const liveEO = await import("../services/liveEO.mjs")

let m
beforeAll(async () => {
  m = await import("../services/realtimeSuite.mjs")
})

describe("tradingSuiteSnapshot", () => {
  it("aggregates every section into one snapshot", async () => {
    const snap = await m.tradingSuiteSnapshot()
    expect(typeof snap.ts).toBe("number")
    expect(snap.live).toEqual({ status: "idle" })
    expect(snap.trading.ok).toBe(true)
    expect(snap.positions).toHaveLength(1)
    expect(snap.closed).toHaveLength(1)
    expect(snap.signals).toHaveLength(1)
    expect(snap.accuracy.hitRate).toBe(60)
    expect(snap.ledger.stats.wins).toBe(3)
    expect(snap.ledger.engine.version).toBe(2)
    expect(snap.ledger.entries).toHaveLength(1)
    expect(snap.demo.connected).toBe(true)
    expect(snap.deals.deals).toHaveLength(1)
    expect(snap.analytics.overview.deals).toBe(1)
    expect(snap.intel).toMatchObject({ ok: true, best: null, ranked: [] })
  })

  it("serves cached sections without re-loading within the TTL", async () => {
    vi.mocked(trading.tradingStatus).mockClear()
    vi.mocked(autopilot.demoStatus).mockClear()
    await m.tradingSuiteSnapshot()
    await m.tradingSuiteSnapshot()
    expect(trading.tradingStatus).not.toHaveBeenCalled()
    expect(autopilot.demoStatus).not.toHaveBeenCalled()
  })

  it("bustRealtimeSuite forces a full re-read on the next snapshot", async () => {
    m.bustRealtimeSuite()
    await m.tradingSuiteSnapshot()
    expect(trading.tradingStatus).toHaveBeenCalled()
    expect(autopilot.demoStatus).toHaveBeenCalled()
  })

  it("isolates a failing section instead of killing the snapshot", async () => {
    m.bustRealtimeSuite()
    vi.mocked(autopilot.demoAnalytics).mockRejectedValueOnce(new Error("provider down"))
    const snap = await m.tradingSuiteSnapshot()
    expect(snap.analytics).toBeNull()
    expect(snap.demo).toBeTruthy()
    expect(snap.trading.ok).toBe(true)
    m.bustRealtimeSuite()
  })

  it("keeps the ledger sections that still succeed when one member fails", async () => {
    m.bustRealtimeSuite()
    vi.mocked(ledger.ledgerStats).mockRejectedValueOnce(new Error("ledger stats down"))
    const snap = await m.tradingSuiteSnapshot()
    expect(snap.ledger.stats).toBeNull()
    expect(snap.ledger.engine).toMatchObject({ version: 2 })
    expect(snap.ledger.entries).toHaveLength(1)
    m.bustRealtimeSuite()
  })

  it("picks up the liveEO stats after a restart", async () => {
    vi.mocked(liveEO.liveEOStats).mockReturnValueOnce({ status: "connected" })
    m.bustRealtimeSuite()
    const snap = await m.tradingSuiteSnapshot()
    expect(snap.live).toEqual({ status: "connected" })
  })
})
