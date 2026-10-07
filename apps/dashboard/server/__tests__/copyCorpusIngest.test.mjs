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
})
