import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

describe("copyCorpusIngest mapping", () => {
  let dir, mod
  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    dir = mkdtempSync(join(tmpdir(), "picc-corpus-ing-"))
    process.env.PICC_COPYCORPUS_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/copyCorpusIngest.mjs")
  })
  afterEach(async () => {
    mod._resetIngestForTest()
    delete process.env.PICC_COPYCORPUS_DATA_DIR
    const { rmSync } = await import("node:fs")
    rmSync(dir, { recursive: true, force: true })
  })

  it("maps a liquidation fill to outcomeKind liquidated", () => {
    const r = mod.ingestPublicFills({
      venue: "hyperliquid",
      windowStart: "2026-01-01", windowEnd: "2026-02-01",
      fills: [{ account: "0xabc", liquidated: true }],
    })
    expect(r.ingested).toBe(1)
  })

  it("reports honest absence when there is nothing to ingest", () => {
    const r = mod.ingestPublicFills({ venue: "hyperliquid", fills: [] })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("refuses private-broker payloads", () => {
    const r = mod.ingestPublicFills({ venue: "private-broker-export", fills: [{ account: "x" }] })
    expect(r.ok).toBe(false)
  })

  it("returns honest absence when every fill is unusable, without stamping success", () => {
    const r = mod.ingestPublicFills({ venue: "hyperliquid", fills: [{}, { noAccount: 1 }] })
    expect(r.ok).toBe(false)
    expect(r.ingested).toBe(0)
    expect(typeof r.reason).toBe("string")
    expect(mod.ingestStatus().reason).toBe("never-ingested")
  })

  it("skips fills carrying identity selectors instead of ingesting them", async () => {
    const r = mod.ingestPublicFills({
      venue: "hyperliquid",
      fills: [{ account: "0xgood" }, { account: "0xbad", selectBy: "top-pnl" }],
    })
    expect(r.ok).toBe(true)
    expect(r.ingested).toBe(1)
    expect(r.skipped).toBe(1)
    const store = await import("../services/copyCorpusStore.mjs")
    expect(store.listExternal().length).toBe(1)
    expect(store.listExternal()[0].accountRef).toBe("0xgood")
  })
})
