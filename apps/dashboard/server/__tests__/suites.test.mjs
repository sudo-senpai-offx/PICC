import { describe, expect, test } from "vitest"
import { SUITES, suiteForSite } from "../services/suites.mjs"

describe("site suites", () => {
  test("every registered category resolves to its own suite", () => {
    for (const [category, suite] of Object.entries(SUITES)) {
      expect(suiteForSite({ category })).toBe(suite)
      expect(suite.id).toBe(category)
    }
  })

  test("trading is the only overlay/hud suite today", () => {
    expect(SUITES.trading.overlay).toBe(true)
    expect(SUITES.trading.hud).toBe(true)
    for (const [category, suite] of Object.entries(SUITES)) {
      if (category === "trading") continue
      expect(suite.overlay).toBe(false)
      expect(suite.hud).toBe(false)
    }
  })

  test("unknown / empty categories fall back to the generic site suite", () => {
    expect(suiteForSite({ category: "cryptocurrency" }).id).toBe("other")
    expect(suiteForSite(null).id).toBe("other")
    expect(suiteForSite({}).id).toBe("other")
  })

  test("the trading suite is wired to the ExpertOption trading category", () => {
    expect(suiteForSite({ category: "trading", id: "expertoption" })).toBe(SUITES.trading)
    expect(SUITES.bandwidth.features).toContain("automator")
  })
})
