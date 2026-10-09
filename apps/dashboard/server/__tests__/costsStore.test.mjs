import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("costs store", () => {
  let dir, mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-costs-"))
    process.env.PICC_COSTS_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/costs/store.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_COSTS_DATA_DIR
    mod._resetCostsForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("rejects non-finite amounts with a named reason", () => {
    const r = mod.recordFillCost({ venue: "paper", route: "close", kind: "fee", amountUsd: NaN, ccy: "USD", provenance: "modeled" })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("rollups are date-keyed idempotent", () => {
    mod.rollupDay({ date: "2026-10-08T00:00:00+08:00", venue: "paper", totals: { fee: 1 } })
    mod.rollupDay({ date: "2026-10-08T12:00:00+08:00", venue: "paper", totals: { fee: 2 } })
    expect(mod.listRollups({ venue: "paper" }).filter((r) => r.tzDate === "2026-10-08").length).toBe(1)
  })

  it("prunes fills older than 90 days on write", () => {
    mod.recordFillCost({ venue: "paper", route: "close", kind: "fee", amountUsd: 0.01, ccy: "USD", provenance: "modeled", observedAt: new Date(Date.now() - 100 * 864e5).toISOString() })
    mod.recordFillCost({ venue: "paper", route: "close", kind: "fee", amountUsd: 0.01, ccy: "USD", provenance: "modeled" })
    expect(mod.listFillCosts({}).every((f) => Date.now() - Date.parse(f.observedAt) < 90 * 864e5)).toBe(true)
  })
})
