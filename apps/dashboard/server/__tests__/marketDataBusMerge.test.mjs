// T3 — deep chart history merge in the market data bus.
//
// When the primary source under-fills the requested window (< count bars), the
// bus prepends OLDER same-resolution bars from another serving broker and tags
// them backfilled:true. Response keys stay additive (historyDepth / backfilled
// / historySpanMs / historySource), so existing consumers are unaffected.
// Rules pinned here:
//   - a primary that already fills count is returned as-is (no extra fetch);
//   - the merge NEVER crosses served resolutions (coarse broker is declined);
//   - duplicate timestamps keep the primary's (fresher) bar;
//   - per-bar backfilled:true on appended bars only;
//   - honest emptiness still carries the additive zero tags.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp
let bus
let registerBroker
let unregisterBroker

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-bus-merge-"))
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
  try { registerBroker(adapter) } catch { /* already registered */ }
}

afterEach(() => {
  for (const slug of testBrokerSlugs) unregisterBroker(slug)
  testBrokerSlugs.length = 0
})

/** Times in SECONDS (matching every broker in PICC). */
function barsAt(times, base = 100) {
  return times.map((t) => ({ time: t, open: base, high: base + 1, low: base - 1, close: base + 0.5 }))
}

function seq(from, count, step = 60) {
  return Array.from({ length: count }, (_, i) => from + i * step)
}

describe("T3 market data bus deep-history merge", () => {
  it("prepends older same-resolution bars when the primary under-fills the window", async () => {
    // Bar TIMES, not bar sizes: fixtures use step-1 seconds so overlap math is
    // exact. Live leg spans timestamps 500..549; history spans 0..179 plus an
    // identical 500..549 overlap that must be dropped (primary wins).
    registerTestBroker({
      slug: "t3-live",
      label: "T3 Live",
      weight: 100,
      availableTimeframes: () => [300],
      getCandles: (id, opts) => (opts?.timeframe ?? 300) === 300 ? barsAt(seq(500, 50, 1)) : []
    })
    registerTestBroker({
      slug: "t3-history",
      label: "T3 History",
      weight: 50,
      availableTimeframes: () => [300],
      getCandles: (id, opts) => (opts?.timeframe ?? 300) === 300 ? barsAt([...seq(0, 180, 1), ...seq(500, 50, 1)]) : []
    })

    const out = await bus.getBestCandles("T3USD", { timeframe: 300, count: 100 })

    // Primary source retained; served resolution honest.
    expect(out.source).toBe("t3-live")
    expect(out.stale).toBe(false)
    expect(out.timeframe).toBe(300)
    expect(out.resolved).toBe(false)

    // 100 bars: 50 backfilled + 50 live (merge cap honors count).
    expect(out.candles).toHaveLength(100)
    expect(out.historyDepth).toBe(100)
    expect(out.backfilled).toBe(50)
    expect(out.historySource).toBe("t3-history")
    expect(out.historySpanMs).toBe((549 - 130) * 1000)

    // Concatenation is ascending with the live leg newest and un-tagged.
    const times = out.candles.map((c) => c.time)
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
    expect(times[0]).toBe(130)
    expect(times.at(-1)).toBe(549)
    for (const c of out.candles.slice(0, 50)) expect(c.backfilled).toBe(true)
    for (const c of out.candles.slice(50)) expect(c.backfilled).toBeUndefined()
  })

  it("returns a full primary as-is — the history broker is never touched", async () => {
    let historyCalls = 0
    registerTestBroker({
      slug: "t3-full",
      label: "T3 Full",
      weight: 100,
      availableTimeframes: () => [300],
      getCandles: () => barsAt(seq(0, 120))
    })
    registerTestBroker({
      slug: "t3-history-idle",
      label: "T3 History Idle",
      weight: 50,
      availableTimeframes: () => [300],
      getCandles: () => { historyCalls++; return barsAt(seq(0, 200)) }
    })

    const out = await bus.getBestCandles("T3USD", { timeframe: 300, count: 50 })

    expect(out.source).toBe("t3-full")
    expect(out.candles).toHaveLength(50)
    expect(out.backfilled).toBe(0)
    expect(out.historySource).toBeNull()
    expect(historyCalls).toBe(0) // no extra Yahoo-style fetch for a full window
  })

  it("never crosses served resolutions — a coarse-so-only broker is declined", async () => {
    let coarseCalls = 0
    registerTestBroker({
      slug: "t3-thin",
      label: "T3 Thin",
      weight: 100,
      availableTimeframes: () => [300],
      getCandles: () => barsAt(seq(0, 40)) // < count → merge pass runs
    })
    registerTestBroker({
      slug: "t3-coarse",
      label: "T3 Coarse",
      weight: 50,
      availableTimeframes: () => [86400], // 300 request resolves UP to 86400 ≠ 300
      getCandles: () => { coarseCalls++; return barsAt(seq(0, 500)) }
    })

    const out = await bus.getBestCandles("T3USD", { timeframe: 300, count: 50 })

    expect(out.source).toBe("t3-thin")
    expect(out.backfilled).toBe(0)
    expect(out.historySource).toBeNull()
    expect(out.candles).toHaveLength(40)
    expect(coarseCalls).toBe(0) // declined at the resolution guard, never fetched
  })

  it("keeps the primary's bar on identical timestamps (dedup, freshest wins)", async () => {
    registerTestBroker({
      slug: "t3-dedup-live",
      label: "T3 Dedup Live",
      weight: 100,
      availableTimeframes: () => [300],
      getCandles: () => barsAt(seq(100, 60, 1), 200) // live bars are the freshest set
    })
    registerTestBroker({
      slug: "t3-dedup-history",
      label: "T3 Dedup History",
      weight: 50,
      availableTimeframes: () => [300],
      getCandles: () => barsAt(seq(0, 200, 1), 100) // 0..199 — overlaps the live leg
    })

    const out = await bus.getBestCandles("T3USD", { timeframe: 300, count: 100 })

    expect(out.candles).toHaveLength(100)
    expect(out.backfilled).toBe(40) // only 0..99 could ever append; 100..159 stay live
    // The live span (timestamps 100..159) must be the live bars, not history's.
    for (const c of out.candles.slice(40)) {
      expect(c.backfilled).toBeUndefined()
      expect(c.open).toBe(200) // live fixture's opening price wins the bucket
    }
    for (const c of out.candles.slice(0, 40)) {
      expect(c.backfilled).toBe(true)
      expect(c.open).toBe(100)
    }
  })

  it("honest emptiness still carries additive zero tags", async () => {
    registerTestBroker({
      slug: "t3-empty",
      label: "T3 Empty",
      weight: 100,
      getCandles: () => []
    })

    const out = await bus.getBestCandles("NOPEUSD", { timeframe: 300, count: 50 })

    expect(out.source).toBe("none")
    expect(out.candles).toEqual([])
    expect(out.historyDepth).toBe(0)
    expect(out.backfilled).toBe(0)
    expect(out.historySpanMs).toBe(0)
    expect(out.historySource).toBeNull()
  })
})