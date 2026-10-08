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
    const out = await brokers.listBrokerStatuses()
    expect(out.ok).toBe(true)
    const slugs = out.brokers.map((b) => b.slug)
    expect(slugs).toContain("ccxt")
    expect(slugs).toContain("paper")
    // D2/AC-005: the ExpertOption adapter is removed, so its slug must be GONE
    // from the registry — absent, not present-but-disabled.
    expect(slugs).not.toContain("expertoption")

    const paper = out.brokers.find((b) => b.slug === "paper")
    expect(paper.configured).toBe(true)
    expect(paper.connected).toBe(true)

    const ccxt = out.brokers.find((b) => b.slug === "ccxt")
    expect(ccxt.configured).toBe(false)
    expect(Array.isArray(ccxt.pairs)).toBe(true)

    // Executor is paper: the EO token no longer selects an executor (D2).
    expect(out.activeExecutor).toBe("paper")
    expect(out.summary.total).toBe(out.brokers.length)
  })

  it("keeps paper as the executor even when an EO token is stored (D2: the token no longer selects anything)", async () => {
    const trading = await import("../services/trading.mjs")
    await trading.saveCredentials({ expertoptionToken: "tok-123" })
    const out = await brokers.listBrokerStatuses()
    expect(out.brokers.find((b) => b.slug === "expertoption")).toBeUndefined()
    expect(out.activeExecutor).toBe("paper")
    expect(out.summary.configured).toBeGreaterThanOrEqual(1)
  })

  it("every broker row declares its capabilities honestly", async () => {
    const out = await brokers.listBrokerStatuses()
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
    const out = await brokers.listBrokerStatuses()
    const bySlug = new Map(out.brokers.map((b) => [b.slug, b]))
    for (const b of out.brokers) {
      expect(Array.isArray(b.timeframes)).toBe(true)
      expect(b.timeframes.length).toBeGreaterThan(0)
    }
    // D2/AC-005: no ExpertOption row, so no EO timeframes curve is asserted.
    expect(bySlug.get("expertoption")).toBeUndefined()
    expect(bySlug.get("ccxt").timeframes).toEqual([60, 300, 900, 1800, 3600, 14400])
    expect(bySlug.get("paper").timeframes).toEqual([60, 300, 900, 3600])
    // Yahoo joined the registry in T7 to enable 1D/1W/1M in the chart.
    expect(bySlug.get("yahoo").timeframes).toEqual([86400, 604800, 2592000])
  })

  it("flat status reporter and registry listBrokers are distinct contracts that must never re-merge", async () => {
    // The flat `listBrokerStatuses()` (async status object) and the registry
    // `listBrokers()` (sync adapter array) once shared one name with
    // incompatible contracts. This pins the split: the flat module must NOT
    // export `listBrokers`, and the two shapes must stay incompatible.
    expect(typeof brokers.listBrokerStatuses).toBe("function")
    expect(brokers.listBrokers).toBeUndefined()
    const flat = await brokers.listBrokerStatuses()
    expect(flat.ok).toBe(true)
    expect(Array.isArray(flat.brokers)).toBe(true)
    expect(flat.summary).toMatchObject({ total: flat.brokers.length })
    const registry = await import("../services/brokers/index.mjs")
    expect(typeof registry.listBrokers).toBe("function")
    const adapters = registry.listBrokers()
    expect(Array.isArray(adapters)).toBe(true)
    expect("summary" in Object(adapters)).toBe(false)
  })
})
