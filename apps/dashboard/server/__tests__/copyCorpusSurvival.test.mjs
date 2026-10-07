import { describe, expect, it } from "vitest"
import { survivalByCohort } from "../services/copyCorpusSurvival.mjs"

describe("survivalByCohort", () => {
  it("cohorts by account age bucket with dormancy + liquidation counts", () => {
    const out = survivalByCohort([
      { accountRef: "a", venue: "h", cohort: "0-30d", outcomeKind: "active" },
      { accountRef: "b", venue: "h", cohort: "0-30d", outcomeKind: "liquidated" },
      { accountRef: "c", venue: "h", cohort: "0-30d", outcomeKind: "dormant" },
    ])
    expect(out.cohorts[0].nLiquidated).toBe(1)
    expect(out.cohorts[0].nDormant).toBe(1)
    expect(out.bias.nAccountsObserved).toBe(3)
  })
  it("empty input is a named absence", () => {
    const out = survivalByCohort([])
    expect(out.cohorts).toEqual([])
    expect(typeof out.bias.reason).toBe("string")
  })
})
