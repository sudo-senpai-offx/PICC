import { describe, expect, it } from "vitest"
import { renderCsv } from "../services/tax/csv.mjs"

const lot = (over) => ({
  id: "d1",
  date: "2026-02-10T00:00:00Z",
  asset: "BTC",
  side: "sell",
  qty: 0.5,
  price: 60000,
  ccy: "USD",
  feeUsd: 5,
  proceedsUsd: 29995,
  basisUsd: 25000,
  gainUsd: 4995,
  method: "FIFO",
  provenance: "journal-close",
  selfTransfer: false,
  flags: [],
  ...over,
})

const GEN = "2026-10-08T00:00:00.000Z"

describe("tax csv", () => {
  it("banner rows carry the report-only disclaimer, method, and generated-at", () => {
    const out = renderCsv({ lots: [lot()], unmatched: [], method: "FIFO", generatedAt: GEN })
    const lines = out.split("\n")
    expect(lines[0]).toBe("# PICC tax lots — report only, not tax advice. Verify with your accountant.")
    expect(lines[1]).toBe("# method: FIFO")
    expect(lines[2]).toBe(`# generated: ${GEN}`)
  })

  it("header is the fixed column order", () => {
    const out = renderCsv({ lots: [lot()], unmatched: [], method: "FIFO", generatedAt: GEN })
    expect(out.split("\n")[3]).toBe(
      "date,asset,side,qty,price,ccy,feeUsd,proceedsUsd,basisUsd,gainUsd,method,provenance,selfTransfer,flags",
    )
  })

  it("null gain/basis/fee render empty; flags pipe-joined", () => {
    const out = renderCsv({
      lots: [lot({ feeUsd: null, basisUsd: null, gainUsd: null, flags: ["basis-unobserved", "fee-unobserved"] })],
      unmatched: [],
      method: "FIFO",
      generatedAt: GEN,
    })
    const row = out.split("\n")[4]
    expect(row).toBe(
      "2026-02-10T00:00:00Z,BTC,sell,0.5,60000,USD,,29995,,,FIFO,journal-close,false,basis-unobserved|fee-unobserved",
    )
  })

  it("values with commas, quotes, or newlines are CSV-escaped", () => {
    const out = renderCsv({
      lots: [lot({ provenance: 'weird, "quoted"\nname' })],
      unmatched: [],
      method: "FIFO",
      generatedAt: GEN,
    })
    const row = out.split("\n").slice(4).join("\n")
    expect(row).toContain('"weird, ""quoted""\nname"')
  })

  it("unmatched entries already listed inline are not duplicated; extras append after a separator comment", () => {
    const inline = lot({ id: "d1", basisUsd: null, gainUsd: null, flags: ["basis-unobserved"] })
    const dup = renderCsv({ lots: [inline], unmatched: [inline], method: "FIFO", generatedAt: GEN })
    expect(dup.split("\n").filter((l) => l.startsWith("2026-02-10"))).toHaveLength(1)
    expect(dup).not.toContain("# unmatched")

    const extra = lot({ id: "d9", basisUsd: null, gainUsd: null, flags: ["basis-unobserved"] })
    const appended = renderCsv({ lots: [inline], unmatched: [extra], method: "FIFO", generatedAt: GEN })
    const lines = appended.split("\n")
    expect(lines).toContain("# unmatched (basis-unobserved, gain unstated)")
    expect(lines.indexOf("# unmatched (basis-unobserved, gain unstated)")).toBeGreaterThan(
      lines.findIndex((l) => l.startsWith("2026-02-10")),
    )
    expect(appended.split("\n").filter((l) => l.startsWith("2026-02-10"))).toHaveLength(2)
  })
})
