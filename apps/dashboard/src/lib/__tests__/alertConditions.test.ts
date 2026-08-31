import { describe, expect, it } from "vitest"
import { conditionLabel, describeAlertConditions } from "../alertConditions"

describe("conditionLabel (T9)", () => {
  it("labels the legacy price conditions", () => {
    expect(conditionLabel({ condition: "price_above", value: 1.09, band: null })).toBe("price > 1.09")
    expect(conditionLabel({ condition: "price_below", value: 1.12, band: null })).toBe("price < 1.12")
  })

  it("labels crossing and pct-change conditions", () => {
    expect(conditionLabel({ condition: "price_crossing_up", value: 1.1, band: null })).toBe("crosses above 1.1")
    expect(conditionLabel({ condition: "price_crossing_down", value: 1.1, band: null })).toBe("crosses below 1.1")
    expect(conditionLabel({ condition: "pct_change_up", value: 2, band: null })).toBe("+2% move")
    expect(conditionLabel({ condition: "pct_change_down", value: 3, band: null })).toBe("-3% move")
  })

  it("labels convergence with and without a band", () => {
    expect(conditionLabel({ condition: "convergence_above", value: 4, band: null })).toBe("convergence \u2265 4")
    expect(conditionLabel({ condition: "convergence_above", value: 5, band: ["LONG BIAS"] })).toBe(
      "state LONG BIAS / convergence \u2265 5"
    )
  })
})

describe("describeAlertConditions (T9)", () => {
  it("returns null for legacy single-condition alerts", () => {
    expect(describeAlertConditions({ condition: "price_above", value: 1.09, conditions: null, logic: null })).toBeNull()
  })

  it("joins composed conditions with AND when logic is AND (or unset)", () => {
    const out = describeAlertConditions({
      condition: "price_above",
      value: 1.09,
      conditions: [
        { condition: "price_above", value: 1.09, band: null },
        { condition: "price_below", value: 1.2, band: null }
      ],
      logic: "AND"
    })
    expect(out).toBe("price > 1.09 AND price < 1.2")
  })

  it("joins composed conditions with OR", () => {
    const out = describeAlertConditions({
      condition: "price_above",
      value: 1.09,
      conditions: [
        { condition: "price_above", value: 1.09, band: null },
        { condition: "convergence_above", value: 4, band: ["LONG BIAS"] }
      ],
      logic: "OR"
    })
    expect(out).toBe("price > 1.09 OR state LONG BIAS / convergence \u2265 4")
  })

  it("empty conditions array returns null (no half-rendered rule)", () => {
    expect(describeAlertConditions({ condition: "price_above", value: 1.09, conditions: [], logic: "AND" })).toBeNull()
  })
})