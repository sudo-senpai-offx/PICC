import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("regime-bounded retention", () => {
  let dir
  let store
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-corpus-ret-"))
    process.env.PICC_COPYCORPUS_DATA_DIR = dir
    vi.resetModules()
    store = await import("../services/copyCorpusStore.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_COPYCORPUS_DATA_DIR
    store._resetCopyCorpusForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("keeps newest per regime up to target", () => {
    for (let i = 0; i < 5; i++) store.appendExternalSample({ venue: "h", accountRef: `a${i}`, regime: "trend" })
    const r = store.pruneToRegimeTargets({ trend: 3 })
    expect(r.kept).toBe(3)
    expect(r.dropped).toBe(2)
    // newest-first: survivors are the last-appended records
    const remaining = store.listExternal({ regime: "trend", limit: 10 })
    expect(remaining.map((x) => x.accountRef)).toEqual(["a4", "a3", "a2"])
  })

  it("leaves untargeted regimes intact (no indefinite accumulation by omission)", () => {
    for (let i = 0; i < 2; i++) store.appendExternalSample({ venue: "h", accountRef: `c${i}`, regime: "chop" })
    const r = store.pruneToRegimeTargets({ trend: 3 })
    expect(r.ok).toBe(true)
    expect(store.listExternal({ regime: "chop", limit: 10 })).toHaveLength(2)
  })

  it("pruner deletes whole records only — no update path exists", () => {
    expect(typeof store.pruneToRegimeTargets).toBe("function")
    expect(store.updateExternalSample).toBeUndefined()
  })
})
