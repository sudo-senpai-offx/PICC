// Cross-source verification ("aggregate trust") in the market data bus.
//
// getCrossSourceCandles wraps getBestCandles and tags the primary bars that at
// least one INDEPENDENT sibling broker confirms at the same bucket with an
// agreeing close (±0.5% relative). A bar is verified:true only when ≥2 sources
// agree — this is the "same data across multiple sources is trusted" model, and
// it keeps single-source bias out of the aggregate claim.
//
// Rules pinned here:
//   - agreement (verified) requires primary + ≥1 sibling within tolerance;
//   - disagreement does NOT fabricate or alter OHLC — bars stay unverified;
//   - empty primary → honest "none" passthrough with zero verify tags;
//   - a PINNED single-source request skips verification (one-lens, never
//     relabeled as cross-source agreement);
//   - per-bar tags are additive (verified:boolean, sources:[slugs]).
//   - response keys are additive (verifySources / verifiedCount / verifiedRatio)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp
let bus
let registerBroker
let unregisterBroker

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-bus-verify-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  mkdirSync(tmp, { recursive: true })
  const registry = await import("../services/brokers/index.mjs")
  registerBroker = registry.registerBroker
  unregisterBroker = registry.unregisterBroker
  bus = await import("../services/marketDataBus.mjs")
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

const testBrokerSlugs = []
function registerTestBroker(adapter) {
  testBrokerSlugs.push(adapter.slug)
  // T6 (Mechanism D): every fixture here models a HEALTHY provider. A broker
  // left live-less runs as dead (registry default), which would flip its whole
  // served series to stale — declaring liveness preserves the fixture's intent.
  try { registerBroker({ isAlive: () => true, ...adapter }) } catch { /* already registered */ }
}

afterEach(() => {
  for (const slug of testBrokerSlugs) unregisterBroker(slug)
  testBrokerSlugs.length = 0
})

/** Times are SECONDS; bars use exact server-time buckets (step-1 like the merge test). */
function barsAt(times, close = 100) {
  return times.map((t) => ({ time: t, open: close, high: close + 1, low: close - 1, close }))
}
function seq(from, count, step = 1) {
  return Array.from({ length: count }, (_, i) => from + i * step)
}

describe("cross-source verification (aggregate trust)", () => {
  it("tags bars verified when an independent sibling agrees within tolerance", async () => {
    registerTestBroker({
      slug: "v-primary",
      label: "V Primary",
      weight: 100,
      availableTimeframes: () => [300],
      getCandles: (id, opts) => (opts?.timeframe ?? 300) === 300 ? barsAt(seq(500, 50), 100) : []
    })
    registerTestBroker({
      slug: "v-sibling",
      label: "V Sibling",
      weight: 50,
      availableTimeframes: () => [300],
      getCandles: (id, opts) => (opts?.timeframe ?? 300) === 300 ? barsAt(seq(500, 50), 100.0005) : []
    })

    const out = await bus.getCrossSourceCandles("VUSD", { timeframe: 300, count: 50 })

    // Winner semantics unchanged.
    expect(out.source).toBe("v-primary")
    expect(out.timeframe).toBe(300)
    expect(out.stale).toBe(false)
    expect(out.candles).toHaveLength(50)
    // Aggregate trust: one independent sibling confirmed every bar.
    expect(out.verifySources).toBe(1)
    expect(out.verifiedCount).toBe(50)
    expect(out.verifiedRatio).toBe(1)
    for (const c of out.candles) {
      expect(c.verified).toBe(true)
      expect(c.sources).toEqual(["v-primary", "v-sibling"])
    }
  })

  it("keeps bars honest (unverified) when a sibling DISAGREES — no fabrication", async () => {
    registerTestBroker({
      slug: "v-primary-dis",
      label: "V Primary Dis",
      weight: 100,
      availableTimeframes: () => [300],
      getCandles: (id, opts) => (opts?.timeframe ?? 300) === 300 ? barsAt(seq(500, 50), 100) : []
    })
    registerTestBroker({
      slug: "v-sibling-dis",
      label: "V Sibling Dis",
      weight: 50,
      availableTimeframes: () => [300],
      getCandles: (id, opts) => (opts?.timeframe ?? 300) === 300 ? barsAt(seq(500, 50), 900) : []
    })

    const out = await bus.getCrossSourceCandles("VUSD", { timeframe: 300, count: 50 })

    expect(out.source).toBe("v-primary-dis")
    // The sibling still SERVED (so verifySources counts it) but its closes
    // (900) are far outside ±0.5% of the primary's (100) → nothing is trusted.
    expect(out.verifySources).toBe(1)
    expect(out.verifiedCount).toBe(0)
    expect(out.verifiedRatio).toBe(0)
    for (const c of out.candles) {
      expect(c.verified).toBe(false)
      // Primary OHLC is untouched — never rewritten to agree with the sibling.
      expect(c.open).toBe(100)
    }
  })

  it("passes honest emptiness through with zero verify tags", async () => {
    registerTestBroker({
      slug: "v-empty",
      label: "V Empty",
      weight: 100,
      getCandles: () => []
    })

    const out = await bus.getCrossSourceCandles("NOPEUSD", { timeframe: 300, count: 50 })

    expect(out.source).toBe("none")
    expect(out.candles).toEqual([])
    expect(out.verifySources).toBe(0)
    expect(out.verifiedCount).toBe(0)
    expect(out.verifiedRatio).toBe(0)
  })

  it("skips verification for a PINNED single-source lens (never relabeled)", async () => {
    registerTestBroker({
      slug: "v-pinned",
      label: "V Pinned",
      weight: 100,
      availableTimeframes: () => [300],
      getCandles: (id, opts) => (opts?.timeframe ?? 300) === 300 ? barsAt(seq(500, 40), 100) : []
    })
    registerTestBroker({
      slug: "v-pinned-sibling",
      label: "V Pinned Sibling",
      weight: 50,
      availableTimeframes: () => [300],
      getCandles: (id, opts) => (opts?.timeframe ?? 300) === 300 ? barsAt(seq(500, 40), 100) : []
    })

    const out = await bus.getCrossSourceCandles("VUSD", { timeframe: 300, count: 50, source: "v-pinned" })

    expect(out.source).toBe("v-pinned")
    expect(out.candles).toHaveLength(40)
    // Pinned = one intentional lens; verification is skipped, not faked.
    expect(out.verifySources).toBe(0)
    expect(out.verifiedCount).toBe(0)
    for (const c of out.candles) {
      expect(c.verified).toBeUndefined()
    }
  })
})
