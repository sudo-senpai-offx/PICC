import { beforeEach, describe, expect, it, vi } from "vitest"

// Costs measured recorder — pure mappers, no network, no store writes.
// Fee/funding honesty: unobserved data is a skipped entry with a reason,
// never a zero. Funding "unobserved-portion" follows the livePositionManager
// precedent: no funding record, reason carried on the fill result.
describe("costs measured recorder", () => {
  let mod
  beforeEach(async () => {
    vi.resetModules()
    mod = await import("../services/costs/measured.mjs")
  })

  // USDT parity double: declared-parity, no observation needed (fx.mjs rule).
  const parityFx = async (ccy, amount) => ({
    usd: Number(amount),
    fxSource: "declared-parity",
    fxAt: null
  })

  it("maps an explicit fee to one measured record in record-time USD", async () => {
    const { records, skipped } = await mod.measureFillCost(
      {
        venue: "hyperliquid",
        route: "close",
        fee: { cost: 0.01, currency: "USDT" },
        observedAt: "2026-10-08T00:00:00.000Z"
      },
      parityFx
    )
    expect(skipped).toEqual([])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      venue: "hyperliquid",
      route: "close",
      kind: "fee",
      amountUsd: 0.01,
      ccy: "USDT",
      fxSource: "declared-parity",
      provenance: "measured"
    })
  })

  it("skips a null-fee fill with a reason, never a zero", async () => {
    const { records, skipped } = await mod.measureFillCost(
      { venue: "hyperliquid", route: "close", fee: null },
      parityFx
    )
    expect(records).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ kind: "fee" })
    expect(typeof skipped[0].reason).toBe("string")
  })

  it("maps observed funding to a funding record", async () => {
    const { records, skipped } = await mod.measureFillCost(
      {
        venue: "hyperliquid",
        route: "close",
        fee: null,
        funding: { amount: 0.005, currency: "USDT" },
        fundingAccrual: "observed"
      },
      parityFx
    )
    const funding = records.filter((r) => r.kind === "funding")
    expect(funding).toHaveLength(1)
    expect(funding[0]).toMatchObject({
      venue: "hyperliquid",
      kind: "funding",
      amountUsd: 0.005,
      provenance: "measured"
    })
    expect(skipped.some((s) => s.kind === "funding")).toBe(false)
  })

  it("emits no funding record for unobserved-portion, carrying the reason", async () => {
    const { records, skipped } = await mod.measureFillCost(
      {
        venue: "hyperliquid",
        route: "close",
        fee: { cost: 0.01, currency: "USDT" },
        funding: { amount: 0.005, currency: "USDT" },
        fundingAccrual: "unobserved-portion"
      },
      parityFx
    )
    expect(records.some((r) => r.kind === "funding")).toBe(false)
    expect(records.filter((r) => r.kind === "fee")).toHaveLength(1)
    const fundingSkip = skipped.find((s) => s.kind === "funding")
    expect(fundingSkip).toBeDefined()
    expect(typeof fundingSkip.reason).toBe("string")
  })

  it("batch mapper reports skipped fills with reasons, never zeros", async () => {
    const { records, skipped } = await mod.measureFillCosts(
      [
        { venue: "hyperliquid", fee: { cost: 0.01, currency: "USDT" } },
        { venue: "hyperliquid", fee: null }
      ],
      parityFx
    )
    expect(records).toHaveLength(1)
    expect(records[0].amountUsd).toBe(0.01)
    expect(skipped).toHaveLength(1)
    expect(typeof skipped[0].reason).toBe("string")
  })

  it("carries an unobservable-fx reason instead of converting", async () => {
    const unobservableFx = async (ccy) => ({ usd: null, reason: `fx-unobservable:${ccy}` })
    const { records, skipped } = await mod.measureFillCost(
      { venue: "hyperliquid", fee: { cost: 1, currency: "EUR" } },
      unobservableFx
    )
    expect(records).toEqual([])
    expect(skipped[0]).toMatchObject({ kind: "fee", reason: "fx-unobservable:EUR" })
  })

  it("skips a currency-missing fee instead of assuming USD", async () => {
    const { records, skipped } = await mod.measureFillCost(
      { venue: "hyperliquid", route: "close", fee: { cost: 0.01 } },
      parityFx
    )
    expect(records).toEqual([])
    expect(skipped).toContainEqual({ kind: "fee", reason: "fee-currency-unobserved" })
  })

  it("skips currency-missing funding instead of assuming USD", async () => {
    const { records, skipped } = await mod.measureFillCost(
      {
        venue: "hyperliquid",
        route: "close",
        fee: null,
        funding: { amount: 0.005 },
        fundingAccrual: "observed"
      },
      parityFx
    )
    expect(records.some((r) => r.kind === "funding")).toBe(false)
    expect(skipped).toContainEqual({ kind: "funding", reason: "funding-currency-unobserved" })
  })

  it("names explicit observed accrual with an absent funding object", async () => {
    const { records, skipped } = await mod.measureFillCost(
      { venue: "hyperliquid", route: "close", fee: null, fundingAccrual: "observed" },
      parityFx
    )
    expect(records.some((r) => r.kind === "funding")).toBe(false)
    expect(skipped).toContainEqual({ kind: "funding", reason: "funding-observed-but-absent" })
  })
})
