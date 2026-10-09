import { describe, expect, it } from "vitest"
import { matchLots } from "../services/tax/lots.mjs"

const acq = (over) => ({ asset: "BTC", qty: 1, price: 50000, ccy: "USD", at: "2026-01-10T00:00:00Z", source: "journal-entry", id: "a1", ...over })
const dis = (over) => ({ asset: "BTC", qty: 0.5, price: 60000, ccy: "USD", at: "2026-02-10T00:00:00Z", source: "journal-close", id: "d1", ...over })

describe("fifo lots", () => {
  it("matches oldest acquisition first with adjusted basis", () => {
    const out = matchLots({
      acquisitions: [acq({ id: "a1", at: "2026-01-01T00:00:00Z" }), acq({ id: "a2", price: 55000, at: "2026-01-20T00:00:00Z" })],
      disposals: [dis({})],
      costs: [{ closeId: "d1", feeUsd: 5, kind: "fee" }],
      selfTransfers: [],
    })
    expect(out.lots).toHaveLength(1)
    expect(out.lots[0].basisUsd).toBeCloseTo(0.5 * 50000, 8)
    expect(out.lots[0].proceedsUsd).toBeCloseTo(0.5 * 60000 - 5, 8)
    expect(out.lots[0].method).toBe("FIFO")
  })

  it("unmatched sells list with basis-unobserved and null gain", () => {
    const out = matchLots({ acquisitions: [], disposals: [dis({})], costs: [], selfTransfers: [] })
    expect(out.lots[0].basisUsd).toBe(null)
    expect(out.lots[0].gainUsd).toBe(null)
    expect(out.lots[0].flags).toContain("basis-unobserved")
  })

  it("self-transfers flag but still list", () => {
    const out = matchLots({
      acquisitions: [acq({})], disposals: [dis({})], costs: [],
      selfTransfers: [{ asset: "BTC", qty: 0.5, at: "2026-02-10T00:00:00Z" }],
    })
    expect(out.lots[0].selfTransfer).toBe(true)
  })

  it("swap halves pair by tag; unpaired halves flag without inference", () => {
    const out = matchLots({
      acquisitions: [acq({ asset: "ETH", id: "s-buy", swapTag: "swap-1" })],
      disposals: [dis({ swapTag: "swap-1" }), dis({ id: "d-lone", swapTag: "swap-orphan" })],
      costs: [], selfTransfers: [],
    })
    expect(out.lots.find((l) => l.id === "d-lone").flags).toContain("swap-half-unpaired")
  })
})
