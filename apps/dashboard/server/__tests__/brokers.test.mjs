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
})
