import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Wealth transfers Phase 1 (manual log validation) + Phase 2 (suggest-and-confirm).
// Hermetic: PICC_WEALTH_DATA_DIR redirected before either wealth module loads.
// Module under test: ../services/wealth/transfers.mjs
// - Phase 1: validateTransfer({ fromLeg, toLeg, ccy, amount, at, note }) rejects
//   (missing at, zero amount, same-leg, unknown leg) with named reasons; a valid
//   transfer validates ok WITHOUT writing (writes go through store.addTransfer,
//   which returns { ok, transfer } wrappers — confirmation is Task 9's POST
//   route, not this module).
// - Phase 2: suggestTransfers({ legs, windowMs }) burst-matches opposite flows
//   (same ccy, amounts within 1%, timestamps within windowMs default 24h) into
//   { confidence: "candidate", status: "unconfirmed" } candidates and NEVER
//   auto-confirms (store transfer count unchanged after suggest).

describe("wealth transfers phase 1: validateTransfer", () => {
  let dir, transfers, store

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-wealth-"))
    process.env.PICC_WEALTH_DATA_DIR = dir
    vi.resetModules()
    transfers = await import("../services/wealth/transfers.mjs")
    store = await import("../services/wealth/store.mjs")
  })

  afterEach(() => {
    delete process.env.PICC_WEALTH_DATA_DIR
    store._resetWealthForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  const good = () => ({
    fromLeg: "hyperliquid",
    toLeg: "ccxt-spot",
    ccy: "USD",
    amount: 100,
    at: "2026-10-08T10:00:00+08:00",
    note: "rebalance"
  })

  it("rejects a missing at with a named reason", async () => {
    const r = await transfers.validateTransfer({ ...good(), at: undefined })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("transfer-at-required")
  })

  it("rejects a zero amount with a named reason", async () => {
    const r = await transfers.validateTransfer({ ...good(), amount: 0 })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
    expect(r.reason).toMatch(/transfer-amount-invalid/)
  })

  it("rejects a same-leg transfer with a named reason", async () => {
    const r = await transfers.validateTransfer({ ...good(), toLeg: "hyperliquid" })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("transfer-same-leg")
  })

  it("rejects an unknown leg with a named reason", async () => {
    const r = await transfers.validateTransfer({ ...good(), toLeg: "ghost-venue" })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/transfer-unknown-leg/)
  })

  it("a valid transfer validates ok without writing to the store", async () => {
    const before = store.listTransfers().length
    const r = await transfers.validateTransfer(good())
    expect(r.ok).toBe(true)
    expect(store.listTransfers().length).toBe(before)
  })

  it("confirmation writes go through store.addTransfer returning { ok, transfer }", async () => {
    const v = await transfers.validateTransfer(good())
    expect(v.ok).toBe(true)
    const w = store.addTransfer(good())
    expect(w.ok).toBe(true)
    expect(w.transfer).toMatchObject({ fromLeg: "hyperliquid", toLeg: "ccxt-spot" })
    expect(typeof w.transfer.id).toBe("string")
  })
})

describe("wealth transfers phase 2: suggestTransfers", () => {
  let dir, transfers, store

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-wealth-"))
    process.env.PICC_WEALTH_DATA_DIR = dir
    vi.resetModules()
    transfers = await import("../services/wealth/transfers.mjs")
    store = await import("../services/wealth/store.mjs")
  })

  afterEach(() => {
    delete process.env.PICC_WEALTH_DATA_DIR
    store._resetWealthForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("finds an obvious burst-matched pair and ignores non-matching flows", () => {
    const legs = [
      { id: "venue-a", ccy: "USD", amount: 100, observedAt: "2026-10-08T10:00:00+08:00" },
      { id: "venue-b", ccy: "USD", amount: 100.5, observedAt: "2026-10-08T10:30:00+08:00" },
      { id: "venue-c", ccy: "USD", amount: 500, observedAt: "2026-10-08T10:15:00+08:00" },
      { id: "venue-d", ccy: "MYR", amount: 100, observedAt: "2026-10-08T10:20:00+08:00" }
    ]
    const out = transfers.suggestTransfers({ legs })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      fromLeg: "venue-a",
      toLeg: "venue-b",
      ccy: "USD",
      confidence: "candidate",
      status: "unconfirmed"
    })
    expect(Math.abs(out[0].amount - 100) / 100).toBeLessThanOrEqual(0.01)
  })

  it("matches opposite out/in flows across legs", () => {
    const legs = [
      {
        id: "venue-a",
        ccy: "USD",
        flows: [{ direction: "out", ccy: "USD", amount: 250, at: "2026-10-08T09:00:00+08:00" }]
      },
      {
        id: "venue-b",
        ccy: "USD",
        flows: [{ direction: "in", ccy: "USD", amount: 251, at: "2026-10-08T09:20:00+08:00" }]
      }
    ]
    const out = transfers.suggestTransfers({ legs })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      fromLeg: "venue-a",
      toLeg: "venue-b",
      confidence: "candidate",
      status: "unconfirmed"
    })
  })

  it("ignores pairs outside the window (default 24h)", () => {
    const legs = [
      { id: "venue-a", ccy: "USD", amount: 100, observedAt: "2026-10-06T10:00:00+08:00" },
      { id: "venue-b", ccy: "USD", amount: 100.2, observedAt: "2026-10-08T10:00:00+08:00" }
    ]
    expect(transfers.suggestTransfers({ legs })).toHaveLength(0)
    expect(
      transfers.suggestTransfers({ legs, windowMs: 3 * 86_400_000 })
    ).toHaveLength(1)
  })

  it("never auto-writes: store transfer count unchanged after suggest", () => {
    const legs = [
      { id: "venue-a", ccy: "USD", amount: 100, observedAt: "2026-10-08T10:00:00+08:00" },
      { id: "venue-b", ccy: "USD", amount: 100.5, observedAt: "2026-10-08T10:30:00+08:00" }
    ]
    const before = store.listTransfers().length
    const out = transfers.suggestTransfers({ legs })
    expect(out.length).toBeGreaterThan(0)
    for (const c of out) {
      expect(c.status).toBe("unconfirmed")
      expect(c).not.toHaveProperty("id")
    }
    expect(store.listTransfers().length).toBe(before)
  })
})
