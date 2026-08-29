import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp
let brokers

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-brokers-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  const trading = await import("../services/trading.mjs")
  await trading._resetTradingData()
  brokers = await import("../services/brokers.mjs")
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("broker adapter registry (plug-and-play venue status)", () => {
  it("lists every venue with honest live status", async () => {
    const out = await brokers.listBrokers()
    expect(out.ok).toBe(true)
    const slugs = out.brokers.map((b) => b.slug)
    expect(slugs).toContain("expertoption")
    expect(slugs).toContain("ccxt")
    expect(slugs).toContain("paper")

    const paper = out.brokers.find((b) => b.slug === "paper")
    expect(paper.configured).toBe(true)
    expect(paper.connected).toBe(true)

    const eo = out.brokers.find((b) => b.slug === "expertoption")
    // No token in a fresh temp dir → honestly unconfigured.
    expect(eo.configured).toBe(false)

    const ccxt = out.brokers.find((b) => b.slug === "ccxt")
    expect(ccxt.configured).toBe(false)
    expect(Array.isArray(ccxt.pairs)).toBe(true)

    // Executor defaults to paper when no broker token exists.
    expect(out.activeExecutor).toBe("paper")
    expect(out.summary.total).toBe(out.brokers.length)
  })

  it("flips executor to expertoption once a token is configured", async () => {
    const trading = await import("../services/trading.mjs")
    await trading.saveCredentials({ expertoptionToken: "tok-123" })
    const out = await brokers.listBrokers()
    expect(out.brokers.find((b) => b.slug === "expertoption").configured).toBe(true)
    expect(out.activeExecutor).toBe("expertoption")
    expect(out.summary.configured).toBeGreaterThanOrEqual(2)
  })

  it("every broker row declares its capabilities honestly", async () => {
    const out = await brokers.listBrokers()
    for (const b of out.brokers) {
      expect(b.capabilities.length).toBeGreaterThan(0)
      if (!b.demoOnly) {
        // Venues that can trade real money must not claim demo-trading as their path.
        expect(b.slug).not.toBe("paper")
      }
      expect(typeof b.notes).toBe("string")
    }
    // CCXT is read-only today — it must NOT claim order capabilities.
    const ccxt = out.brokers.find((b) => b.slug === "ccxt")
    expect(ccxt.capabilities).not.toContain("spot-orders")
    expect(ccxt.capabilities).toEqual(["market-data"])
  })

  it("declares a non-empty timeframes curve per row, matching its adapter", async () => {
    const out = await brokers.listBrokers()
    const bySlug = new Map(out.brokers.map((b) => [b.slug, b]))
    for (const b of out.brokers) {
      expect(Array.isArray(b.timeframes)).toBe(true)
      expect(b.timeframes.length).toBeGreaterThan(0)
    }
    // EO push builds 1m..1h only — the exact set the chart must render as
    // enabled when EO is the configured source (T6 acceptance).
    expect(bySlug.get("expertoption").timeframes).toEqual([60, 300, 900, 3600])
    expect(bySlug.get("ccxt").timeframes).toEqual([60, 300, 900, 1800, 3600, 14400])
    expect(bySlug.get("paper").timeframes).toEqual([60, 300, 900, 3600])
    // Yahoo joined the registry in T7 to enable 1D/1W/1M in the chart.
    expect(bySlug.get("yahoo").timeframes).toEqual([86400, 604800, 2592000])
  })
})
