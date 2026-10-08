import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("wealth store", () => {
  let dir, mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-wealth-"))
    process.env.PICC_WEALTH_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/wealth/store.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_WEALTH_DATA_DIR
    mod._resetWealthForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("rejects a manual leg without as-of", () => {
    const r = mod.upsertLeg({ id: "tng", kind: "manual", ccy: "MYR", amount: 18 })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("snapshots are date-keyed idempotent", () => {
    mod.addSnapshot({ at: "2026-10-08T00:00:00+08:00", totalUsd: 100, incomplete: true, legStatus: [] })
    mod.addSnapshot({ at: "2026-10-08T12:00:00+08:00", totalUsd: 120, incomplete: true, legStatus: [] })
    expect(mod.listSnapshots({}).filter((s) => s.tzDate === "2026-10-08").length).toBe(1)
  })

  it("lists snapshots newest-first with a default limit", () => {
    mod.addSnapshot({ at: "2026-10-06T12:00:00+08:00", totalUsd: 10, incomplete: true, legStatus: [] })
    mod.addSnapshot({ at: "2026-10-07T12:00:00+08:00", totalUsd: 20, incomplete: true, legStatus: [] })
    const all = mod.listSnapshots({})
    expect(all[0].tzDate).toBe("2026-10-07")
    expect(all.length).toBeLessThanOrEqual(100)
  })
})
