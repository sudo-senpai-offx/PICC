import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getFeedMode,
  ingestStudioFrame,
  liveEOData,
  liveSnapshot,
  liveEOStats,
  setFeedMode,
  stopLiveEO
} from "../services/liveEO.mjs"

/**
 * T4 — feed-preference gate. With the studio bridge as the only browser leg,
 * "auto" and "studio" both serve studio frames; a stored "extension"
 * preference degrades to "auto" (the extension is gone — clean break, D1).
 * Kept as a gate so a future leg keeps the prefer-with-fallback semantics
 * (never a blackout).
 */

function candleFrame(assetId, tf, t, v) {
  return { action: "candles", message: { assetId, candles: [{ t, tf, v }] } }
}

function lastClose(data, assetId) {
  return data.assets.find((a) => a.id === assetId).periods[60].at(-1).close
}

describe("feed-mode preference gate (T4, studio-only)", () => {
  beforeEach(async () => {
    await stopLiveEO()
    setFeedMode("auto")
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("defaults to auto and coerces invalid input", () => {
    expect(getFeedMode()).toBe("auto")
    expect(setFeedMode("studio")).toBe("studio")
    // "extension" is no longer a valid feed mode — coerced to the safe default
    // so a stale on-disk preference can never wedge the feed.
    expect(setFeedMode("extension")).toBe("auto")
    expect(setFeedMode("garbage")).toBe("auto")
    expect(getFeedMode()).toBe("auto")
  })

  it("serves studio frames in auto and studio modes", () => {
    expect(setFeedMode("auto")).toBe("auto")
    expect(ingestStudioFrame(candleFrame("1", 5, 100, [1, 2, 3, 4]))).toBe(true)
    expect(lastClose(liveEOData(), "1")).toBe(4)
    setFeedMode("studio")
    expect(ingestStudioFrame(candleFrame("1", 5, 110, [4, 5, 6, 7]))).toBe(true)
    expect(lastClose(liveEOData(), "1")).toBe(7)
  })

  it("surfaces the preference and leg liveness in stats and snapshot", () => {
    vi.useFakeTimers()
    expect(setFeedMode("studio")).toBe("studio")
    expect(liveEOStats().feedMode).toBe("studio")
    expect(liveSnapshot().feedMode).toBe("studio")
    expect(liveSnapshot().legs.studio).toBe(false) // no frames yet
    ingestStudioFrame(candleFrame("7", 5, 100, [1, 2, 3, 4]))
    expect(liveSnapshot().legs.studio).toBe(true)
  })

  it("rejects malformed frames", () => {
    expect(ingestStudioFrame(null)).toBe(false)
    expect(ingestStudioFrame("candles")).toBe(false)
    expect(ingestStudioFrame({})).toBe(false)
    expect(ingestStudioFrame({ action: 42 })).toBe(false)
    expect(ingestStudioFrame({ noAction: true })).toBe(false)
  })

  it("accepts a tick frame and records price + viewed asset", async () => {
    const ok = ingestStudioFrame(candleFrame("142", 0, Math.floor(Date.now() / 1000), [1.2345]))
    expect(ok).toBe(true)
    const data = liveEOData()
    // Asset stub is tracked even without a headless session
    expect(data.watching.some((w) => w.id === "142")).toBe(true)
    expect(data.viewed).toBe("142")
    const stats = liveEOStats()
    expect(stats.legs.studio.framesSeen).toBeGreaterThan(0)
    expect(stats.legs.studio.accepted).toBeGreaterThan(0)
    expect(stats.legs.studio.lastAt).toBeGreaterThan(0)
  })

  it("folds a 5s bar into aggregated timeframes without a session", async () => {
    const now = Math.floor(Date.now() / 1000)
    ingestStudioFrame(candleFrame("777", 5, now - (now % 60), [1.1, 1.2, 1.05, 1.15]))
    const data = liveEOData()
    const asset = data.assets.find((a) => a.id === "777")
    expect(asset).toBeTruthy()
    // The raw 5s bar cascades into the exposed watch periods (60/300/900/3600)
    expect(asset.periods[60].length).toBeGreaterThanOrEqual(1)
    expect(asset.periods[60].at(-1).close).toBeCloseTo(1.15, 8)
    expect(asset.periods[3600].length).toBeGreaterThanOrEqual(1)
  })

  it("marks status connected while studio frames are fresh", async () => {
    ingestStudioFrame(candleFrame("142", 0, Math.floor(Date.now() / 1000), [2.0]))
    const stats = liveEOStats()
    // No session exists — liveness comes solely from the studio feed
    expect(stats.status).toBe("connected")
  })

  it("drops non-finite or non-positive tick prices instead of recording them as real ticks", async () => {
    // A DOM-scraped price is not guaranteed numeric: locale decimal commas,
    // a loading-state placeholder ("--"), or a selector that briefly missed
    // its target can all produce NaN. Regression for a bug where such a tick
    // was accepted, stored as lastPrice, and silently broke up/down
    // classification for every subsequent legitimate tick too.
    ingestStudioFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [Number("--")]))
    ingestStudioFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [-1]))
    ingestStudioFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [0]))
    let data = liveEOData()
    let asset = data.assets.find((a) => a.id === "555")
    expect(asset?.ticks?.count ?? 0).toBe(0)

    // A legitimate tick right after must not have its up/down classification
    // poisoned by the rejected bad ticks.
    ingestStudioFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [1.5]))
    ingestStudioFrame(candleFrame("555", 0, Math.floor(Date.now() / 1000), [1.6]))
    data = liveEOData()
    asset = data.assets.find((a) => a.id === "555")
    expect(asset.ticks.count).toBe(2)
    expect(asset.ticks.up).toBe(1)
  })

  it("drops OHLC bars containing any non-finite or non-positive value", async () => {
    const now = Math.floor(Date.now() / 1000)
    ingestStudioFrame(candleFrame("666", 5, now - (now % 60), [1.1, Number("--"), 1.05, 1.15]))
    const data = liveEOData()
    const asset = data.assets.find((a) => a.id === "666")
    // Asset stub is still tracked (frame was structurally valid), but no bar
    // was written from the corrupt OHLC row.
    expect(asset?.periods?.[60]?.length ?? 0).toBe(0)
  })

  it("ignores non-candle actions other than profile/error", async () => {
    const before = liveEOStats().legs.studio.framesSeen
    ingestStudioFrame({ action: "unknown-action", message: {} })
    expect(liveEOStats().legs.studio.framesSeen).toBe(before + 1) // seen but harmless
    const data = liveEOData()
    expect(data.viewed).not.toBe(undefined) // state unchanged / no crash
  })
})