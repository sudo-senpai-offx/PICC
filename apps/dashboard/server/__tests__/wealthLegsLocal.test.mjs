import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Wealth local legs (Task 4): hermetic — wealth store redirected, all other
// sources injected as fixtures (no network, no keys, no localstore IO).
// Module under test: ../services/wealth/legsLocal.mjs
// - readManualLegs → ENTERED + age-from-asOf in whole days, never LIVE/STALE;
//   tng-manual ABSENT-without-amount = not-entered (never zero).
// - readBillingLegs → settled balances only; flows excluded by construction
//   (no flow field exists on the output shape).
// - readLocalstoreLegs → rows overlapping a live keyed leg id are excluded
//   ABSENT with reason `duplicate-of:<legId>` (live keyed legs win).
// - readPaperSummary → exact { equity, cash, committed, open, closed }
//   passthrough (never converted, never summed).

const DAY_MS = 86_400_000
const NOW = new Date("2026-10-08T12:00:00+08:00").getTime()
const iso = (ms) => new Date(ms).toISOString()

describe("wealth local legs", () => {
  let dir, mod, store

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-wealth-"))
    process.env.PICC_WEALTH_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/wealth/legsLocal.mjs")
    store = await import("../services/wealth/store.mjs")
  })

  afterEach(() => {
    delete process.env.PICC_WEALTH_DATA_DIR
    store._resetWealthForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("manual leg with as-of reads ENTERED with age in whole days", async () => {
    const asOf = iso(NOW - 3 * DAY_MS - 3_600_000) // 3d + 1h ago → 3 whole days
    expect(store.upsertLeg({ id: "tng-manual", kind: "manual", ccy: "MYR", amount: 18, asOf }).ok).toBe(true)
    const legs = await mod.readManualLegs({ now: NOW })
    const tng = legs.find((l) => l.id === "tng-manual")
    expect(tng.status).toBe("ENTERED")
    expect(tng.ageDays).toBe(3)
    expect(tng.amount).toBe(18)
    expect(tng.asOf).toBe(asOf)
  })

  it("manual legs are never LIVE/STALE even when stored so", async () => {
    store.upsertLeg({
      id: "cash-jar", kind: "manual", ccy: "USD", amount: 5,
      asOf: iso(NOW - DAY_MS), status: "LIVE", observedAt: iso(NOW)
    })
    const legs = await mod.readManualLegs({ now: NOW })
    const jar = legs.find((l) => l.id === "cash-jar")
    expect(jar.status).toBe("ENTERED")
    expect(["LIVE", "STALE"]).not.toContain(jar.status)
  })

  it("tng-manual ABSENT-without-amount is not-entered, never zero", async () => {
    const legs = await mod.readManualLegs({ now: NOW })
    const tng = legs.find((l) => l.id === "tng-manual")
    expect(tng.status).toBe("ABSENT")
    expect(tng.amount).toBe(null)
    expect(tng.amount).not.toBe(0)
    expect(typeof tng.reason).toBe("string")
  })

  it("billing flows never appear; only settled balances emit legs", async () => {
    const legs = await mod.readBillingLegs({
      paymentOrders: [
        { id: "o1", provider: "ewallet_tng", status: "submitted", amount: 50, currency: "MYR" },
        { id: "o2", provider: "ewallet_tng", status: "awaiting_payment", amount: 20, currency: "MYR" },
        { id: "o3", provider: "ewallet_tng", status: "failed", amount: 30, currency: "MYR" },
        { id: "o4", provider: "ewallet_tng", status: "granted", amount: 100, currency: "MYR" },
        { id: "o5", provider: "ewallet_tng", status: "granted", amount: 0, currency: "MYR" }
      ]
    })
    expect(legs.length).toBe(2)
    for (const leg of legs) {
      expect(leg).not.toHaveProperty("flow")
      expect(leg.kind).toBe("billing")
    }
    expect(legs.map((l) => l.amount).sort((a, b) => a - b)).toEqual([0, 100])
  })

  it("localstore row overlapping a live keyed leg is excluded duplicate-of", async () => {
    const legs = await mod.readLocalstoreLegs({
      accounts: [
        { id: "a1", name: "ccxt-spot", type: "asset", balance: 5, currency: "USD" },
        { id: "a2", name: "savings", type: "asset", balance: 7, currency: "USD" }
      ],
      transactions: [
        { id: "t1", amount: 9999, description: "flow that must never be summed" }
      ],
      liveLegIds: ["ccxt-spot"]
    })
    const dup = legs.find((l) => String(l.id).includes("a1"))
    expect(dup.status).toBe("ABSENT")
    expect(dup.reason).toBe("duplicate-of:ccxt-spot")
    expect(dup.amount).toBe(null)
    const savings = legs.find((l) => String(l.id).includes("a2"))
    expect(savings.status).toBe("ENTERED")
    expect(savings.amount).toBe(7)
    expect(JSON.stringify(legs)).not.toContain("9999")
  })

  it("paper summary passes through exactly five fields, never summed", async () => {
    const summary = await mod.readPaperSummary({
      paperAnalytics: async () => ({
        ok: true,
        overview: {
          starting: 10000, cash: 9900, committed: 200, realizedPnl: 50,
          unrealizedPnl: -50, equity: 10000, openCount: 2, closedCount: 5, autoClosed: 0
        }
      })
    })
    expect(summary).toEqual({ equity: 10000, cash: 9900, committed: 200, open: 2, closed: 5 })
    expect(summary).not.toHaveProperty("usd")
    expect(summary).not.toHaveProperty("totalUsd")
  })

  it("paper summary degrades to all-null five fields when unobservable", async () => {
    const summary = await mod.readPaperSummary({
      paperAnalytics: async () => { throw new Error("paper store offline") }
    })
    expect(summary).toEqual({ equity: null, cash: null, committed: null, open: null, closed: null })
  })
})
