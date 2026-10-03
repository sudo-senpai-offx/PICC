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
//
// D2/AC-005: the row these assertions used as their subject was `expertoption`,
// removed with the venue. They now read `aave`, a surviving row declared with a
// legacy `url` and no explicit `origins`/`scan`/`cadence`, so each assertion
// still exercises the defaulting surface it was written for.

describe("registerConnector generalized config surface", () => {
  it("maps a legacy url to a single-origin list (host without leading www.)", () => {
    const aave = getConnector("aave")
    expect(aave.url).toContain("aave.com")
    expect(aave.origins).toContain("app.aave.com")
  })

  it("keeps legacy transports/transport intact for back-compat", () => {
    // `expertoption` was the only row declaring `transports: ["ws", ...]`, so no
    // surviving row exercises the non-first transport. The back-compat contract
    // itself is still asserted: `transport` is derived as `transports[0]`.
    const aave = getConnector("aave")
    expect(aave.transports).toContain("browser")
    expect(aave.transport).toBe("browser")
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
    const aave = getConnector("aave")
    expect(aave.scan).toMatchObject({ mode: null })
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
    const aave = getConnector("aave")
    expect(aave.cadence.realtimeMs).toBe(DEFAULT_CADENCE.realtimeMs)
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
    // Pre-existing vacuity, corrected here: `binance` is a browserStudio SITE,
    // not a connector, so this used to compare `undefined` with `undefined` and
    // could never fail. It now names a row that exists, so the routing claim is
    // actually asserted.
    expect(getConnector("binance")).toBeUndefined()
    expect(getConnectorByOrigin("https://www.binance.com/en/trade")).toBeUndefined()
    expect(getConnectorByOrigin("https://app.aave.com/")).toBe(getConnector("aave"))
    expect(getConnectorByOrigin("https://opensea.io/collections")).toBe(getConnector("opensea"))
  })

  it("removed venue: no expertoption row survives in the registry", () => {
    // D2/AC-005: asserted, not assumed — the row's absence is the invariant.
    expect(getConnector("expertoption")).toBeUndefined()
    expect(hasConnector("expertoption")).toBe(false)
    expect(getConnectorByOrigin("https://app.expertoption.finance/dashboard")).toBeUndefined()
  })
})
