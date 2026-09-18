// T4 — provenance completion, remaining half (PICC_MULTISOURCE_ENGINE).
//
// The headless leg joins the per-leg stream accounting (studio was the sole
// leg after the D1 clean break): history landing from the headless session
// marks arrival+consumption on the headless leg, feedProvenance resolves the
// most-recently-CONSUMED leg (last write wins), liveEOStats/liveSnapshot list
// both legs, collectSourceStatuses attributes the candles feed from explicit
// leg accounting (no studio-only inline heuristic), and the extension leg is
// asserted absent everywhere it used to surface.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ingestHeadlessHistory,
  ingestStudioFrame,
  fetchAssetCandles,
  liveEOStats,
  liveSnapshot,
  feedProvenance,
  mostRecentLeg,
  setFeedMode,
  getFeedMode,
  stopLiveEO
} from "../services/liveEO.mjs"
import { collectSourceStatuses } from "../services/dataSources.mjs"
import { registerBroker, unregisterBroker } from "../services/brokers/index.mjs"

const t0 = 1_700_000_000_000

function candleFrame(assetId, t, v) {
  return { action: "candles", message: { assetId, candles: [{ t, tf: 5, v }] } }
}

function historyRows(n = 5, base = 100, stepSec = 60) {
  return Array.from({ length: n }, (_, i) => ({
    time: Math.floor(t0 / 1000) + i * stepSec,
    open: base + i,
    high: base + i + 1,
    low: base + i - 1,
    close: base + i + 0.5
  }))
}

describe("T4 headless leg accounting", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    await stopLiveEO()
    setFeedMode("auto")
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("headless-only seeding marks the headless leg and reports feed 'headless'", async () => {
    expect(getFeedMode()).toBe("auto")
    expect(ingestHeadlessHistory({ assetId: "1", period: 60, ohlc: [] })).toBe(false) // empty = no landing
    expect(feedProvenance()).toBe(null)

    expect(ingestHeadlessHistory({ assetId: "1", period: 60, ohlc: historyRows() })).toBe(true)
    expect(feedProvenance()).toBe("headless")
    expect(mostRecentLeg()).toMatchObject({ leg: "headless", lastConsumedAt: t0 })

    const stats = liveEOStats()
    expect(stats.legs.headless.accepted).toBeGreaterThan(0)
    expect(stats.legs.headless.framesSeen).toBeGreaterThan(0)
    expect(stats.legs.headless.lastAt).toBe(t0)
    expect(stats.legs.headless.lastConsumedAt).toBe(t0)
    expect(liveSnapshot().legs.headless).toBe(true)
    // The ingest is real: the seeded bars landed in the buffers (servable
    // WITHOUT a session), not just leg marks.
    const served = await fetchAssetCandles("1", 60)
    expect(served.source).toBe("buffer")
    expect(served.ohlc.length).toBeGreaterThan(0)
  })

  it("last write wins: studio frames stay the feed while they arrive, headless after", () => {
    ingestStudioFrame(candleFrame("1", Math.floor(t0 / 1000), [1, 2, 3, 4]))
    expect(feedProvenance()).toBe("studio")

    vi.setSystemTime(t0 + 2000)
    ingestHeadlessHistory({ assetId: "1", period: 60, ohlc: historyRows() })
    expect(feedProvenance()).toBe("headless")

    vi.setSystemTime(t0 + 3000)
    ingestStudioFrame(candleFrame("1", Math.floor((t0 + 3000) / 1000), [4, 5, 6, 7]))
    expect(feedProvenance()).toBe("studio") // still arriving → still the feed
  })

  it("the extension leg is gone — leg enum, provenance, and feed modes never name it", () => {
    expect(Object.keys(liveEOStats().legs).sort()).toEqual(["headless", "studio"])
    expect(feedProvenance()).not.toBe("extension")
    expect(setFeedMode("extension")).toBe("auto") // stale on-disk pref coerces (D1)
    expect(getFeedMode()).not.toBe("extension")
    expect(["auto", "studio"]).toContain(getFeedMode())
  })
})

describe("T4 collectSourceStatuses leg accounting", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    await stopLiveEO()
    setFeedMode("auto")
    registerBroker({
      slug: "t4-eo-probe",
      label: "T4 EO probe",
      weight: 5,
      isAlive: () => true,
      stats: () => liveEOStats(),
      getCandles: () => []
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    unregisterBroker("t4-eo-probe")
  })

  it("attributes the candles feed to the most recently consumed leg", () => {
    expect(collectSourceStatuses().candles.feed).toBeUndefined() // nothing consumed yet

    vi.setSystemTime(t0 + 1000)
    ingestStudioFrame(candleFrame("1", Math.floor((t0 + 1000) / 1000), [1, 2, 3, 4]))
    vi.setSystemTime(t0 + 1500)
    expect(collectSourceStatuses().candles.feed).toBe("studio")

    vi.setSystemTime(t0 + 2500)
    ingestHeadlessHistory({ assetId: "1", period: 60, ohlc: historyRows() })
    vi.setSystemTime(t0 + 2600)
    expect(collectSourceStatuses().candles.feed).toBe("headless")
  })
})