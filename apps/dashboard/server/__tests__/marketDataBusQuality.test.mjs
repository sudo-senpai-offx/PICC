// T2 — Quality-ordered fan-in (PICC_MULTISOURCE_ENGINE).
//
// The bus ranks resolution-capable candidates by
//   liveness > exact resolution > freshness (stats().lastSeen) >
//   weight > latency (median fetch time)
// and fetches in that order (first ≥30-bar result wins; thin data is the
// last resort; honest emptiness). Every response names the winner and why:
//   sourceMode — "auto" | "forced" | "fallback"
//   sources[]  — per-candidate rank + reasons (the honest option set tried)
//
// Each quality-key test registers brokers in an order that WOULD let the old
// weight-only fan-in win with the "wrong" source — the flip is intentional
// and counted (spec R1): liveness, exactness, freshness, and latency must
// outrank weight.

import { afterEach, describe, expect, it } from "vitest"
import { getBestCandles } from "../services/marketDataBus.mjs"
import { registerBroker, unregisterBroker } from "../services/brokers/index.mjs"
import { stopLiveEO } from "../services/liveEO.mjs"

function synthCandles(n, base = 100, stepSec = 60) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * stepSec,
    open: base + i * 0.1,
    high: base + i * 0.1 + 0.5,
    low: base + i * 0.1 - 0.5,
    close: base + i * 0.1
  }))
}

const testBrokerSlugs = []
function registerTestBroker(adapter) {
  testBrokerSlugs.push(adapter.slug)
  try {
    registerBroker(adapter)
  } catch { /* already registered */ }
}

afterEach(async () => {
  for (const slug of testBrokerSlugs) unregisterBroker(slug)
  testBrokerSlugs.length = 0
  await stopLiveEO()
})

describe("T2 fan-in quality order", () => {
  it("an alive broker beats a higher-weight DEAD broker (liveness first)", async () => {
    registerTestBroker({
      slug: "q-dead-hi",
      label: "Q Dead Hi",
      weight: 100,
      isAlive: () => false,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    registerTestBroker({
      slug: "q-alive-lo",
      label: "Q Alive Lo",
      weight: 10,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80, 150) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50 })
    expect(out.source).toBe("q-alive-lo")
    expect(out.sources[0].slug).toBe("q-alive-lo")
    expect(out.sources[0].alive).toBe(true)
    // Dead sinks but stays try-able — the reason says it is a buffered fallback.
    expect(out.sources[1].slug).toBe("q-dead-hi")
    expect(out.sources[1].alive).toBe(false)
    expect(out.sources[1].reason).toContain("disconnected")
  })

  it("an exact-resolution broker beats a relabel broker at equal weight", async () => {
    // q-relabel is registered FIRST — the old weight-only fan-in would try it
    // first and it serves ≥30 bars, so this flip is the point of the test.
    registerTestBroker({
      slug: "q-relabel",
      label: "Q Relabel",
      weight: 50,
      isAlive: () => true,
      availableTimeframes: () => [60, 900, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 900 ? synthCandles(80, 200, 900) : [])
    })
    registerTestBroker({
      slug: "q-exact",
      label: "Q Exact",
      weight: 50,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 300 ? synthCandles(80) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 300, count: 50 })
    expect(out.source).toBe("q-exact")
    expect(out.timeframe).toBe(300)
    expect(out.resolved).toBe(false)
    expect(out.sources[0].exact).toBe(true)
    expect(out.sources[1].slug).toBe("q-relabel")
    expect(out.sources[1].exact).toBe(false)
    expect(out.sources[1].reason).toContain("serves 15m for 5m request")
  })

  it("fresher data (stats().lastSeen) beats older data at equal weight", async () => {
    // lastSeen is an epoch-ms write timestamp (Date.now() convention): a
    // 30-seconds-ago write beats a never-written (0) broker.
    const now = Date.now()
    registerTestBroker({
      slug: "q-stale",
      label: "Q Stale",
      weight: 50,
      isAlive: () => true,
      stats: () => ({ status: "connected", error: null, lastSeen: 0, stale: false, upstream: {} }),
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    registerTestBroker({
      slug: "q-fresh",
      label: "Q Fresh",
      weight: 50,
      isAlive: () => true,
      stats: () => ({ status: "connected", error: null, lastSeen: now - 30_000, stale: false, upstream: {} }),
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80, 150) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50 })
    expect(out.source).toBe("q-fresh")
    expect(out.sources[0].lastSeen).toBeGreaterThan(out.sources[1].lastSeen)
    expect(out.sources[0].reason).toBe("alive · 1m exact · fresh 30s ago")
    expect(out.sources[1].reason).toBe("alive · 1m exact")
  })

  it("lower median latency breaks the final tie (faster wins)", async () => {
    registerTestBroker({
      slug: "q-lat-slow",
      label: "Q Lat Slow",
      weight: 50,
      isAlive: () => true,
      getCandles: async (id, opts) => {
        await new Promise((r) => setTimeout(r, 30))
        return synthCandles(80)
      }
    })
    registerTestBroker({
      slug: "q-lat-fast",
      label: "Q Lat Fast",
      weight: 50,
      isAlive: () => true,
      getCandles: (id, opts) => synthCandles(80, 150)
    })
    // Prime each latency ring via a forced request (both tie on every earlier
    // quality key, so the final tie-break is median fetch time).
    await getBestCandles("EURUSD", { timeframe: 60, count: 50, source: "q-lat-slow" })
    await getBestCandles("EURUSD", { timeframe: 60, count: 50, source: "q-lat-fast" })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50 })
    expect(out.source).toBe("q-lat-fast")
    expect(out.sources[0].slug).toBe("q-lat-fast")
    expect(out.sources[0].medianMs).toBeLessThan(out.sources[1].medianMs)
  })
})

describe("T2 sourceMode + sources[] (additive honesty)", () => {
  it("sourceMode 'forced' when the forced source serves; 'fallback' when it serves nothing", async () => {
    registerTestBroker({
      slug: "t-forced",
      label: "T Forced",
      weight: 100,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    registerTestBroker({
      slug: "t-other",
      label: "T Other",
      weight: 50,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80, 150) : [])
    })
    const forced = await getBestCandles("EURUSD", { timeframe: 60, count: 50, source: "t-forced" })
    expect(forced.source).toBe("t-forced")
    expect(forced.sourceMode).toBe("forced")
    expect(forced.sources[0].slug).toBe("t-forced")
    expect(forced.sources[0].winner).toBe(true)
    expect(forced.sources[0].rank).toBe(1)
  })

  it("falls back with sourceMode 'fallback' when the forced source serves nothing", async () => {
    registerTestBroker({
      slug: "t-empty",
      label: "T Empty",
      weight: 100,
      isAlive: () => true,
      getCandles: () => []
    })
    registerTestBroker({
      slug: "t-backup",
      label: "T Backup",
      weight: 50,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50, source: "t-empty" })
    expect(out.source).toBe("t-backup")
    expect(out.sourceMode).toBe("fallback")
    // The forced source was tried first (rank 1) but did not win.
    expect(out.sources[0].slug).toBe("t-empty")
    expect(out.sources[0].winner).toBeUndefined()
    expect(out.sources.find((s) => s.slug === "t-backup").winner).toBe(true)
  })

  it("reports honest emptiness with sourceMode 'fallback' when a forced source serves nothing and nothing else does", async () => {
    registerTestBroker({
      slug: "t-empty",
      label: "T Empty",
      weight: 50,
      isAlive: () => true,
      getCandles: () => []
    })
    registerTestBroker({
      slug: "t-empty-60-only",
      label: "T Empty 60 only",
      weight: 100,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 300, count: 50, source: "t-empty" })
    expect(out.source).toBe("none")
    expect(out.candles).toEqual([])
    expect(out.sourceMode).toBe("fallback")
    expect(out.sources.every((s) => s.winner === undefined)).toBe(true)
  })

  it("honors preferredSource (T3 preference alias) over the auto default", async () => {
    registerTestBroker({
      slug: "q-pref",
      label: "Q Pref",
      weight: 10,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    registerTestBroker({
      slug: "q-top",
      label: "Q Top",
      weight: 100,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80, 150) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50, source: "auto", preferredSource: "q-pref" })
    expect(out.source).toBe("q-pref")
    expect(out.sourceMode).toBe("forced")
  })
})

describe("T6 honest staleness (Mechanism D)", () => {
  it("a DEAD broker's ≥30-bar buffered data is tagged stale, never 'live'", async () => {
    registerTestBroker({
      slug: "s-dead-only",
      label: "S Dead Only",
      weight: 100,
      isAlive: () => false,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    registerTestBroker({
      slug: "s-zombie-empty",
      label: "S Zombie Empty",
      weight: 10,
      isAlive: () => true,
      getCandles: () => []
    })
    // No alive source serves — the dead broker's buffer wins (sinks but stays
    // try-able), yet the response must say stale: dead data ≠ "EO live".
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50 })
    expect(out.source).toBe("s-dead-only")
    expect(out.candles.length).toBeGreaterThanOrEqual(30)
    expect(out.stale).toBe(true)
    // The alive-but-empty broker ranks first and is tried first; the dead
    // broker's buffer still wins the fetch — and the winner's reason says it.
    const winner = out.sources.find((s) => s.slug === "s-dead-only")
    expect(winner.winner).toBe(true)
    expect(winner.reason).toContain("disconnected")
  })

  it("an alive broker with its stale flag set (connected but no ticks) is tagged stale", async () => {
    registerTestBroker({
      slug: "s-ticks-stale",
      label: "S Ticks Stale",
      weight: 100,
      isAlive: () => true,
      stats: () => ({ status: "connected", error: null, lastSeen: 0, stale: true, upstream: {} }),
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50 })
    expect(out.source).toBe("s-ticks-stale")
    expect(out.stale).toBe(true)
  })

  it("an alive healthy ≥30-bar winner is tagged not-stale", async () => {
    registerTestBroker({
      slug: "s-healthy",
      label: "S Healthy",
      weight: 100,
      isAlive: () => true,
      stats: () => ({ status: "connected", error: null, lastSeen: 5, stale: false, upstream: {} }),
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50 })
    expect(out.source).toBe("s-healthy")
    expect(out.stale).toBe(false)
  })
})