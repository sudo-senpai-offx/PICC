import { describe, expect, it } from "vitest"
import { aggregateMinistries } from "../services/ministryAggregate.mjs"

describe("aggregateMinistries", () => {
  it("sums per-ministry and grand totals with a single currency", () => {
    const r = aggregateMinistries([
      { id: "trading", totals: [{ amount: 120, currency: "USD" }] },
      { id: "earnings", totals: [{ amount: 30, currency: "USD" }, { amount: 10, currency: "USD" }] }
    ])
    expect(r.perMinistry).toEqual({ trading: 120, earnings: 40 })
    expect(r.grandTotal).toBe(160)
    expect(r.currency).toBe("USD")
  })

  it("returns null currency (honest) on mixed or empty currencies", () => {
    const mixed = aggregateMinistries([
      { id: "trading", totals: [{ amount: 1, currency: "USD" }] },
      { id: "earnings", totals: [{ amount: 1, currency: "EUR" }] }
    ])
    expect(mixed.currency).toBeNull()

    const empty = aggregateMinistries([{ id: "trading", totals: [] }])
    expect(empty.grandTotal).toBe(0)
    expect(empty.currency).toBeNull()
  })

  it("omits ministries with no totals from perMinistry but keeps them absent (no fabricated 0 entries)", () => {
    const r = aggregateMinistries([
      { id: "trading", totals: [{ amount: 5, currency: "USD" }] },
      { id: "earnings", totals: [] }
    ])
    expect(r.perMinistry["earnings"]).toBeUndefined()
    expect(r.grandTotal).toBe(5)
  })
})