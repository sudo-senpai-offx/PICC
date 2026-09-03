import { describe, expect, it } from "vitest"
import {
  registerConnector,
  getConnector,
  normalizeExtensionPayload,
  snapshotForExtension
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

