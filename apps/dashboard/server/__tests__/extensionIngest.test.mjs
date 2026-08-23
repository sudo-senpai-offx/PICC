import { describe, expect, it, beforeEach } from "vitest"
import { ingestAppFrame, liveEOData, liveEOStats, stopLiveEO } from "../services/liveEO.mjs"
import { collectSourceStatuses } from "../services/dataSources.mjs"

/**
 * The extension bridge feeds already-parsed broker frames (captured in the
 * user's own browser by inject.js) into the same buffers the studio bridge
 * uses. These tests verify the upstream leg end-to-end at the service level.
 */

function candleFrame(assetId, tf, t, v) {
  return { action: "candles", message: { assetId, candles: [{ t, tf, v }] } }
}

describe("ingestAppFrame (extension upstream bridge)", () => {
  beforeEach(async () => {
    await stopLiveEO()
  })

  it("rejects malformed frames", () => {
    expect(ingestAppFrame(null)).toBe(false)
    expect(ingestAppFrame("candles")).toBe(false)
    expect(ingestAppFrame({})).toBe(false)
    expect(ingestAppFrame({ action: 42 })).toBe(false)
    expect(ingestAppFrame({ noAction: true })).toBe(false)
  })

  it("accepts a tick frame and records price + viewed asset", async () => {
    const ok = ingestAppFrame(candleFrame("142", 0, Math.floor(Date.now() / 1000), [1.2345]))
    expect(ok).toBe(true)
    const data = liveEOData()
    // Asset stub is tracked even without a headless session
    expect(data.watching.some((w) => w.id === "142")).toBe(true)
    expect(data.viewed).toBe("142")
    const stats = liveEOStats()
    expect(stats.upstream.framesSeen).toBeGreaterThan(0)
    expect(stats.upstream.accepted).toBeGreaterThan(0)
    expect(stats.upstream.lastAt).toBeGreaterThan(0)
  })

  it("folds a 5s bar into aggregated timeframes without a session", async () => {
    const now = Math.floor(Date.now() / 1000)
    ingestAppFrame(candleFrame("777", 5, now - (now % 60), [1.1, 1.2, 1.05, 1.15]))
    const data = liveEOData()
    const asset = data.assets.find((a) => a.id === "777")
    expect(asset).toBeTruthy()
    // The raw 5s bar cascades into the exposed watch periods (60/300/900/3600)
    expect(asset.periods[60].length).toBeGreaterThanOrEqual(1)
    expect(asset.periods[60].at(-1).close).toBeCloseTo(1.15, 8)
    expect(asset.periods[3600].length).toBeGreaterThanOrEqual(1)
  })

  it("marks status connected while extension frames are fresh", async () => {
    ingestAppFrame(candleFrame("142", 0, Math.floor(Date.now() / 1000), [2.0]))
    const stats = liveEOStats()
    // No session exists — liveness comes solely from the extension feed
    expect(stats.status).toBe("connected")
  })

  it("feeds dataSources: candles classified live with extension provenance", async () => {
    ingestAppFrame(candleFrame("142", 0, Math.floor(Date.now() / 1000), [3.21]))
    const statuses = collectSourceStatuses()
    expect(statuses.candles.status).toBe("live")
    expect(statuses.candles.feed).toBe("extension")
    // Derived sources inherit candle health
    expect(statuses.orderflow.status).toBe("live")
    expect(statuses.regime.status).toBe("live")
    expect(statuses.expiry.status).toBe("live")
  })

  it("drops non-finite or non-positive tick prices instead of recording them as real ticks", async () => {
    // A DOM-scraped price is not guaranteed numeric: locale decimal commas,
    // a loading-state placeholder ("--"), or a selector that briefly missed
    // its target can all produce NaN. Regression for a bug where such a tick
    // was accepted, stored as lastPrice, and silently broke up/down
    // classification for every subsequent legitimate tick too.
    ingestAppFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [Number("--")]))
    ingestAppFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [-1]))
    ingestAppFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [0]))
    let data = liveEOData()
    let asset = data.assets.find((a) => a.id === "555")
    expect(asset?.ticks?.count ?? 0).toBe(0)

    // A legitimate tick right after must not have its up/down classification
    // poisoned by the rejected bad ticks.
    ingestAppFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [1.5]))
    ingestAppFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [1.6]))
    data = liveEOData()
    asset = data.assets.find((a) => a.id === "555")
    expect(asset.ticks.count).toBe(2)
    expect(asset.ticks.up).toBe(1)
  })

  it("drops OHLC bars containing any non-finite or non-positive value", async () => {
    const now = Math.floor(Date.now() / 1000)
    ingestAppFrame(candleFrame("666", 5, now - (now % 60), [1.1, Number("--"), 1.05, 1.15]))
    const data = liveEOData()
    const asset = data.assets.find((a) => a.id === "666")
    // Asset stub is still tracked (frame was structurally valid), but no bar
    // was written from the corrupt OHLC row.
    expect(asset?.periods?.[60]?.length ?? 0).toBe(0)
  })

  it("ignores non-candle actions other than profile/error", async () => {
    const before = liveEOStats().upstream.framesSeen
    ingestAppFrame({ action: "unknown-action", message: {} })
    expect(liveEOStats().upstream.framesSeen).toBe(before + 1) // seen but harmless
    const data = liveEOData()
    expect(data.viewed).not.toBe(undefined) // state unchanged / no crash
  })
})
