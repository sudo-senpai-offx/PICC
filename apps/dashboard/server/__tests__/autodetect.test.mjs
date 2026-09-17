import { describe, expect, it } from "vitest"
import { fingerprint } from "../services/autodetect.mjs"

describe("autodetect.fingerprint (pure proposal builder)", () => {
  it("matches an existing connector's origin quickly", () => {
    const r = fingerprint({ url: "https://app.expertoption.finance/dashboard" })
    expect(r.matched).toBe(true)
    expect(r.slug).toBe("expertoption")
    expect(r.tuned).toBe(false)
  })

  it("proposes origins from a hostname (stripping www., registrable domain)", () => {
    const r = fingerprint({
      url: "https://www.somepassiveapp.io/dashboard",
      domNodes: ["$1,234.56 balances"]
    })
    expect(r.matched).toBeUndefined()
    expect(r.origins).toContain("somepassiveapp.io")
    expect(r.proposed.origins).toContain("somepassiveapp.io")
    expect(r.tuned).toBe(false)
    expect(r.confidence).toBeGreaterThan(0)
  })

  it("proposes a wsFrames+wsUrlRe scan when a page WS targets the same host (regex source)", () => {
    const r = fingerprint({
      url: "https://earner.site/app",
      wsUrls: ["wss://earner.site/gateway"]
    })
    expect(r.proposed.scan.mode).toBe("wsFrames")
    // wsUrlRe is a regex *source* the autodetect fingerprint compiles into a sniff regex.
    expect(new RegExp(r.proposed.scan.wsUrlRe).test("wss://earner.site/gateway")).toBe(true)
    expect(r.confidence).toBeGreaterThan(0)
  })

  it("records storageKey NAMES (not values) in the proposal", () => {
    const r = fingerprint({
      url: "https://earner.site/app",
      storageKeys: ["user.insights", "balance_raw", "session"]
    })
    expect(r.proposed.scan.keys).toEqual(["user.insights", "balance_raw", "session"])
    expect(r.proposed.scan.profileKeys).toBe(true)
    expect(r.proposed.extractors).toBeDefined()
  })

  it("treats a subdomain WS gateway as same-host", () => {
    const r = fingerprint({
      url: "https://app.payouts.net/",
      wsUrls: ["wss://api.payouts.net/live"]
    })
    expect(r.proposed.scan.mode).toBe("wsFrames")
    expect(new RegExp(r.proposed.scan.wsUrlRe).test("wss://api.payouts.net/live")).toBe(true)
  })

  it("keeps confidence honest when nothing interactable is exposed", () => {
    const r = fingerprint({ url: "https://bare.example/" })
    expect(r.confidence).toBe(0)
    expect(r.proposed.scan.mode).toBeNull()
  })

  it("is a proposal, never a trusted adaptor", () => {
    const r = fingerprint({ url: "https://fresh.example/", wsUrls: ["wss://fresh.example/x"] })
    expect(r.tuned).toBe(false)
    // no write path leaks out of the pure function
    expect(r.result).toBeUndefined()
  })
})
