import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("copyCorpusStore separation", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-corpus-"))
    process.env.PICC_COPYCORPUS_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/copyCorpusStore.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_COPYCORPUS_DATA_DIR
    mod._resetCopyCorpusForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("forces origin external even when caller passes owner", () => {
    const r = mod.appendExternalSample({ venue: "hyperliquid", accountRef: "a1", origin: "owner" })
    expect(r.ok).toBe(true)
    expect(r.record.origin).toBe("external")
  })

  it("rejects identity-selected samples with a named reason", () => {
    const r = mod.appendExternalSample({ venue: "hyperliquid", accountRef: "a1", selectBy: "top-pnl" })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("counts are real numbers for the bias header", () => {
    const c = mod.corpusCounts()
    expect(typeof c.nAccountsObserved).toBe("number")
    expect(typeof c.nDormant).toBe("number")
    expect(typeof c.nLiquidated).toBe("number")
  })
})
