import { describe, expect, it } from "vitest"
import { overview, snapshotAdjust } from "../services/wealth/aggregate.mjs"

// Wealth aggregator (Task 5): pure functions, no store/IO.
// - overview sums only converted legs; incomplete:true unless every
//   in-scope leg is LIVE; paper passes through untouched.
// - snapshotAdjust excludes in-flight duplicates for transfers dated
//   inside the window; transfers outside the window are ignored.

const nowIso = () => new Date().toISOString()

// Fresh doubles: freshest-wins never matters here (single fresh quote each).
const readers = (rates) => ({
  yahooQuote: async (ccy) =>
    rates[ccy] == null ? null : { rate: rates[ccy], quotedAt: nowIso() },
  ccxtQuote: async () => null
})

const R = { MYR: 0.2 }

describe("wealth aggregator overview", () => {
  it("sums converted legs, flags incomplete, keeps the absent reason", async () => {
    const legs = [
      { id: "cash-usd", kind: "manual", ccy: "USD", amount: 100, status: "LIVE", observedAt: nowIso(), fxSource: "declared-parity", fxAt: null },
      { id: "tng-manual", kind: "manual", ccy: "MYR", amount: 100, status: "LIVE", observedAt: nowIso() },
      { id: "btcpay", kind: "billing", ccy: "BTC", amount: 0.5, status: "ABSENT", observedAt: null, reason: "btcpay-unconfigured" }
    ]
    const paper = { equity: 10, cash: 5, committed: 2, open: 1, closed: 3 }
    const out = await overview({ legs, transfers: [], paper, readers: readers(R) })
    expect(out.totalUsd).toBeCloseTo(120)
    expect(out.incomplete).toBe(true)
    expect(out.legs.find((l) => l.id === "btcpay").reason).toBe("btcpay-unconfigured")
    expect(out.legs.find((l) => l.id === "btcpay").usd).toBe(null)
  })

  it("all-LIVE legs report incomplete:false", async () => {
    const legs = [
      { id: "cash-usd", kind: "manual", ccy: "USD", amount: 100, status: "LIVE", observedAt: nowIso(), fxSource: "declared-parity", fxAt: null }
    ]
    const out = await overview({ legs, transfers: [], paper: null, readers: readers(R) })
    expect(out.incomplete).toBe(false)
    expect(out.totalUsd).toBe(100)
  })

  it("same-ccy settled legs from different providers sum normally", async () => {
    const legs = [
      { id: "billing-tng", kind: "billing", ccy: "MYR", amount: 50, status: "LIVE", observedAt: nowIso() },
      { id: "billing-other", kind: "billing", ccy: "MYR", amount: 50, status: "LIVE", observedAt: nowIso() }
    ]
    const out = await overview({ legs, transfers: [], paper: null, readers: readers(R) })
    expect(out.totalUsd).toBeCloseTo(20)
    expect(out.legs.length).toBe(2)
  })

  it("USD legs with declared-parity pass through unrelabeled", async () => {
    const legs = [
      { id: "cash-usd", kind: "manual", ccy: "USD", amount: 42, status: "LIVE", observedAt: nowIso(), fxSource: "declared-parity", fxAt: null }
    ]
    const out = await overview({ legs, transfers: [], paper: null, readers: readers(R) })
    const leg = out.legs.find((l) => l.id === "cash-usd")
    expect(leg.usd).toBe(42)
    expect(leg.fxSource).toBe("declared-parity")
  })

  it("passes the paper block through untouched", async () => {
    const paper = { equity: 7, cash: 1, committed: 0, open: 2, closed: 9 }
    const out = await overview({ legs: [], transfers: [], paper, readers: readers(R) })
    expect(out.paper).toEqual(paper)
    expect(out.paper).not.toHaveProperty("usd")
    expect(out.paper).not.toHaveProperty("totalUsd")
  })
})

describe("wealth snapshotAdjust", () => {
  const legs = [
    { id: "venue-a", kind: "keyed", ccy: "USD", amount: 100, status: "LIVE", observedAt: nowIso(), fxSource: "declared-parity", fxAt: null },
    { id: "venue-b", kind: "keyed", ccy: "USD", amount: 100, status: "LIVE", observedAt: nowIso(), fxSource: "declared-parity", fxAt: null }
  ]

  it("transfer inside the window excludes the destination leg once", () => {
    const out = snapshotAdjust({
      legs,
      transfers: [{ id: "t1", fromLeg: "venue-a", toLeg: "venue-b", ccy: "USD", amount: 100, at: "2026-10-08T10:00:00+08:00" }],
      windowStart: "2026-10-08T00:00:00+08:00",
      windowEnd: "2026-10-08T23:59:59+08:00"
    })
    expect(out.legs.map((l) => l.id)).toEqual(["venue-a"])
    expect(out.excluded).toHaveLength(1)
  })

  it("transfer outside the window causes no exclusion", () => {
    const out = snapshotAdjust({
      legs,
      transfers: [{ id: "t2", fromLeg: "venue-a", toLeg: "venue-b", ccy: "USD", amount: 100, at: "2026-10-01T10:00:00+08:00" }],
      windowStart: "2026-10-08T00:00:00+08:00",
      windowEnd: "2026-10-08T23:59:59+08:00"
    })
    expect(out.legs.map((l) => l.id).sort()).toEqual(["venue-a", "venue-b"])
    expect(out.excluded).toHaveLength(0)
  })
})
