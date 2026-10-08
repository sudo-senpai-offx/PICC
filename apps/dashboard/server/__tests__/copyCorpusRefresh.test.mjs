import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

// Wave 1.2 — cadence ingest sustaining regime coverage.
// TDD RED: these imports fail until copyCorpusIngest.mjs grows the
// fetch+map surface (pure mapper stays network-free).
describe("copyCorpus cadence ingest (wave 1.2)", () => {
  let dir, mod, store

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    dir = mkdtempSync(join(tmpdir(), "picc-corpus-wave12-"))
    process.env.PICC_COPYCORPUS_DATA_DIR = dir
    delete process.env.PICC_COPYCORPUS_REFRESH
    vi.resetModules()
    mod = await import("../services/copyCorpusIngest.mjs")
    store = await import("../services/copyCorpusStore.mjs")
  })

  afterEach(async () => {
    try { mod._resetIngestForTest() } catch {}
    try { store._resetCopyCorpusForTest() } catch {}
    delete process.env.PICC_COPYCORPUS_DATA_DIR
    delete process.env.PICC_COPYCORPUS_REFRESH
    const { rmSync } = await import("node:fs")
    rmSync(dir, { recursive: true, force: true })
  })

  it("maps Hyperliquid userFills fixtures without network (liquidation first-class)", () => {
    const fills = mod.mapHyperliquidUserFills(
      [
        { coin: "BTC", px: "67000", sz: "0.1", side: "A", time: 1719790000000, dir: "Close Long", closedPnl: "12.5", hash: "0x1" },
        { coin: "ETH", px: "3500", sz: "1.2", side: "B", time: 1719790001000, dir: "Liquidated Isolated Long", closedPnl: "-400.0", hash: "0x2" },
      ],
      { account: "0xabc", windowStart: "2026-01-01", windowEnd: "2026-02-01" }
    )
    expect(fills).toHaveLength(2)
    expect(fills[0].account).toBe("0xabc")
    expect(fills[0].liquidated).toBe(false)
    expect(fills[1].liquidated).toBe(true)
    // Closed-PnL magnitude must never become a selection criterion.
    expect(fills[0].selectBy ?? null).toBeNull()
    expect(fills[1].selectBy ?? null).toBeNull()
  })

  it("mapper returns an empty array for empty/invalid input (no throw)", () => {
    expect(mod.mapHyperliquidUserFills([], { account: "0xabc" })).toEqual([])
    expect(mod.mapHyperliquidUserFills(null, { account: "0xabc" })).toEqual([])
    expect(mod.mapHyperliquidUserFills([{ coin: "BTC" }], {})).toEqual([])
  })

  it("account discovery is an honest named absence (no PnL/leaderboard selection)", () => {
    const d = mod.discoverCorpusAccounts()
    expect(d.ok).toBe(false)
    expect(d.reason).toBe("discovery-unavailable")
  })

  it("market snapshot fetch success uses keyless public surface only", async () => {
    const fetchFn = vi.fn(async (url, opts) => ({
      ok: true,
      json: async () => [{ coin: "BTC", px: "67000", sz: "0.01", side: "A", time: 1719790000000, hash: "0xh" }],
    }))
    const r = await mod.fetchPublicMarketSnapshot({ fetchFn, coins: ["BTC"] })
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.trades)).toBe(true)
    const [calledUrl, calledOpts] = fetchFn.mock.calls[0]
    expect(calledUrl).toBe("https://api.hyperliquid.xyz/info")
    expect(JSON.parse(calledOpts.body).type).toBe("recentTrades")
  })

  it("market snapshot fetch failure yields a named reason (no throw)", async () => {
    const r = await mod.fetchPublicMarketSnapshot({ fetchFn: async () => { throw new Error("boom") }, coins: ["BTC"] })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("user-fills fetch failure yields a named reason (no throw)", async () => {
    const r = await mod.fetchHyperliquidUserFills({ user: "0xabc", fetchFn: async () => { throw new Error("down") } })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("cadence run ingests nothing observable-free but prunes and names the absence", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => [] }))
    const r = await mod.runCorpusRefreshCadence({ fetchFn, targets: { "*": 3 } })
    expect(r.ingested).toBe(0)
    expect(r.reason).toBe("discovery-unavailable")
    expect(r.pruned).toBeDefined()
    // Failure/absence is visible via ingestStatus, never a silent zero.
    expect(typeof mod.ingestStatus().reason).toBe("string")
  })

  it("cadence run survives a venue outage with a named reason (no throw)", async () => {
    const r = await mod.runCorpusRefreshCadence({ fetchFn: async () => { throw new Error("venue-down") }, targets: { "*": 3 } })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
    expect(typeof mod.ingestStatus().reason).toBe("string")
  })

  it("OFF gate stays log-only and never touches the network", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("must-not-be-called") })
    const r = await mod.corpusRefreshPass({ fetchFn })
    expect(r.gated).toBe(true)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(r.status.reason).toBe("never-ingested")
  })

  it("ON gate runs the cadence with mocked fetch", async () => {
    process.env.PICC_COPYCORPUS_REFRESH = "on"
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => [] }))
    const r = await mod.corpusRefreshPass({ fetchFn })
    expect(r.gated ?? false).toBe(false)
    expect(typeof r.reason).toBe("string")
  })
})
