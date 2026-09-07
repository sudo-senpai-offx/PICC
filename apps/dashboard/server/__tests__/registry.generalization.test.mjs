import { describe, expect, it } from "vitest"
import {
  registerConnector,
  getConnector,
  hasConnector,
  getConnectorByOrigin,
  normalizeExtensionPayload,
  snapshotForExtension,
  DEFAULT_CADENCE
} from "../services/connectors.mjs"

// The declarative registry surface (Q5): a connector can be described by
// config (origins/cadence/extractors/scan) rather than per-site code, legacy
// url/selectors keep working, and anything the extension sees exposes key NAMES
// only — never values.

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

describe("normalizeExtensionPayload (declarative scan → Earnings)", () => {
  registerConnector({
    slug: "tz-audit",
    label: "Audit (test)",
    origins: ["audit.test"],
    transports: ["browser"],
    scan: {
      mode: "wsFrames",
      wsUrlRe: "audit\\.test",
      mapFrame: { balance: ["balance", "credits"], today: ["today", "earning"], lifetime: ["total"] }
    }
  })

  it("yields status ok with parsed numerics for a configured frame", () => {
    const r = normalizeExtensionPayload(getConnector("tz-audit"), {
      origin: "https://audit.test",
      slug: "tz-audit",
      frames: [
        { balance: "12.50", today: "3.10", total: "99.99" },
        { balance: "9.5" }
      ]
    })
    expect(r.status).toBe("ok")
    expect(r.balance).toBe(12.5)
    expect(r.today).toBe(3.1)
    expect(r.lifetime).toBe(99.99)
  })

  it("reports unconfigured (never zero-filled) when no usable frame is present", () => {
    const r = normalizeExtensionPayload(getConnector("tz-audit"), {
      origin: "https://audit.test",
      slug: "tz-audit",
      frames: [{ some_other: "1" }]
    })
    expect(r.status).toBe("unconfigured")
    expect(r.balance).toBeNull()
    expect(r.today).toBeNull()
  })
})

describe("snapshotForExtension (what the extension may see)", () => {
  it("exposes origins/cadence/scan/tuned but never extractor values", () => {
    const snap = snapshotForExtension()
    expect(Array.isArray(snap.registry)).toBe(true)
    const eo = snap.registry.find((c) => c.slug === "expertoption")
    expect(eo).toBeTruthy()
    // scan carries key NAMES only — no secrets, no values.
    const audit = snap.registry.find((c) => c.slug === "tz-audit")
    expect(audit.scan.mode).toBe("wsFrames")
    expect(audit.scan.keys).toEqual([])
    // The extension must never receive DOM extractors or token-bearing fields.
    expect(audit.extractors).toBeUndefined()
    expect(eo.url).toBeUndefined()
    expect(audit.selectors).toBeUndefined()
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

  registerConnector({
    slug: "tz-scan",
    label: "Scan (test)",
    origins: ["scan.test"],
    transports: ["browser"],
    scan: {
      mode: "wsFrames",
      keys: ["credits", "total"],
      wsUrlRe: "scan\\.test",
      mapFrame: { balance: ["credits"], lifetime: ["total"] }
    }
  })

  it("per-site cadence overrides the DEFAULT_CADENCE tier values", () => {
    expect(getConnector("tz-cadence").cadence.realtimeMs).toBe(20000)
    expect(getConnector("tz-cadence").cadence.longMs).toBe(600000)
    const eo = getConnector("expertoption")
    expect(eo.cadence.realtimeMs).toBe(DEFAULT_CADENCE.realtimeMs)
  })

  it("a wsFrames scan carries key names only and stays honest for no-match frames", () => {
    const ok = normalizeExtensionPayload(getConnector("tz-scan"), {
      origin: "https://scan.test",
      slug: "tz-scan",
      frames: [{ credits: "25.00", total: "180.50" }]
    })
    expect(ok.status).toBe("ok")
    expect(ok.balance).toBe(25)
    expect(ok.lifetime).toBe(180.5)

    const un = normalizeExtensionPayload(getConnector("tz-scan"), {
      origin: "https://scan.test",
      slug: "tz-scan",
      frames: [{ something_unrelated: "1" }]
    })
    expect(un.status).toBe("unconfigured")
    expect(un.balance).toBeNull()
    expect(un.lifetime).toBeNull()
  })

  it("the extension snapshot exposes origins + scan key names, never values", () => {
    const snap = snapshotForExtension()
    const s = snap.registry.find((c) => c.slug === "tz-scan")
    expect(s).toBeTruthy()
    expect(s.origins).toEqual(["scan.test"])
    expect(s.scan.keys).toEqual(expect.arrayContaining(["credits", "total"]))
    expect(s.scan.mapFrame).toBeTruthy()
    expect(s.url).toBeUndefined()
    expect(s.extractors).toBeUndefined()
    expect(s.selectors).toBeUndefined()
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
