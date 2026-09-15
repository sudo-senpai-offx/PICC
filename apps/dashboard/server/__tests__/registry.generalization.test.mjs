import { describe, expect, it } from "vitest"
import {
  registerConnector,
  getConnector,
  hasConnector,
  getConnectorByOrigin,
  DEFAULT_CADENCE
} from "../services/connectors.mjs"

// The declarative registry surface (Q5): a connector can be described by
// config (origins/cadence/extractors/scan) rather than per-site code, and
// legacy url/selectors keep working.

describe("registerConnector generalized config surface", () => {
  it("maps a legacy url to a single-origin list (host without leading www.)", () => {
    const eo = getConnector("expertoption")
    expect(eo.url).toContain("expertoption.finance")
    expect(eo.origins).toContain("app.expertoption.finance")
  })

  it("keeps legacy transports/transport intact for back-compat", () => {
    const eo = getConnector("expertoption")
    expect(eo.transports).toContain("ws")
    expect(eo.transport).toBe("ws")
  })

  it("normalizes an explicit origins array verbatim", () => {
    registerConnector({
      slug: "tz-grass",
      label: "Grass (test)",
      origins: ["app.getgrass.io", "getgrass.io"],
      transports: ["browser"]
    })
    const conn = getConnector("tz-grass")
    expect(conn.origins).toEqual(["app.getgrass.io", "getgrass.io"])
  })

  it("defaults scan to an honest unconfigured shape when not provided", () => {
    const eo = getConnector("expertoption")
    expect(eo.scan).toMatchObject({ mode: null })
  })
})

describe("config-driven connectors generalize across venues (Q5)", () => {
  registerConnector({
    slug: "tz-cadence",
    label: "Cadence (test)",
    origins: ["bench.test"],
    transports: ["browser"],
    cadence: { realtimeMs: 20000, longMs: 600000 }
  })

  it("per-site cadence overrides the DEFAULT_CADENCE tier values", () => {
    expect(getConnector("tz-cadence").cadence.realtimeMs).toBe(20000)
    expect(getConnector("tz-cadence").cadence.longMs).toBe(600000)
    const eo = getConnector("expertoption")
    expect(eo.cadence.realtimeMs).toBe(DEFAULT_CADENCE.realtimeMs)
  })

  it("removed bandwidth suite: no bandwidth site survives in the registry", () => {
    for (const slug of ["honeygain", "earnapp", "pawns", "repocket", "traffmonetizer", "gradient", "grass"]) {
      expect(getConnector(slug), `${slug} removed`).toBeUndefined()
      expect(hasConnector(slug)).toBe(false)
    }
    expect(getConnectorByOrigin("https://dashboard.honeygain.com/dashboard")).toBeUndefined()
    expect(getConnectorByOrigin("https://app.pawns.app")).toBeUndefined()
  })

  it("surviving trading + studio venues keep origin routing", () => {
    const eo = getConnector("expertoption")
    expect(getConnectorByOrigin("https://app.expertoption.finance/dashboard")).toBe(eo)
    expect(getConnectorByOrigin("https://www.binance.com/en/trade")).toBe(getConnector("binance"))
  })
})
