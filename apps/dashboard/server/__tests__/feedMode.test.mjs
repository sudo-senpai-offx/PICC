import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getFeedMode,
  ingestAppFrame,
  ingestStudioFrame,
  liveEOData,
  liveSnapshot,
  liveEOStats,
  setFeedMode,
  stopLiveEO
} from "../services/liveEO.mjs"

/**
 * T4 — hybrid feed-mode gate. `feedMode` is a PREFERENCE with fallback, never a
 * blackout switch: the preferred leg is consumed while it is alive; when it
 * dies, the other leg takes over so a live feed is never dropped.
 *
 * "Alive" = frames keep ARRIVING (seen/lastAt). "Consumed" = the gate let the
 * frame into the candle buffers (accepted/lastConsumedAt). Dropped frames
 * still count as seen — that is the liveness signal the fallback relies on.
 */

function candleFrame(assetId, tf, t, v) {
  return { action: "candles", message: { assetId, candles: [{ t, tf, v }] } }
}

function lastClose(data, assetId) {
  return data.assets.find((a) => a.id === assetId).periods[60].at(-1).close
}

describe("feed-mode preference gate (T4)", () => {
  beforeEach(async () => {
    await stopLiveEO()
    setFeedMode("auto")
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("defaults to auto and coerces invalid input", () => {
    expect(getFeedMode()).toBe("auto")
    expect(setFeedMode("extension")).toBe("extension")
    expect(setFeedMode("studio")).toBe("studio")
    expect(setFeedMode("garbage")).toBe("auto")
    expect(getFeedMode()).toBe("auto")
  })

  it("studio preference drops extension frames while the studio leg is alive", () => {
    vi.useFakeTimers()
    setFeedMode("studio")
    expect(ingestStudioFrame(candleFrame("1", 5, 100, [1, 2, 3, 4]))).toBe(true)
    // The extension frame arrives while studio is alive → seen, but dropped.
    expect(ingestAppFrame(candleFrame("1", 5, 110, [4, 5, 6, 7]))).toBe(false)
    const data = liveEOData()
    expect(lastClose(data, "1")).toBe(4) // newest consumed bar is the STUDIO bar
    // Arrival is still recorded — that is the leg-liveness signal.
    expect(liveEOStats().legs.extension.lastAt).toBeGreaterThan(0)
    expect(liveEOStats().legs.extension.accepted).toBe(0)
  })

  it("studio preference falls back to the extension leg when studio dies", () => {
    vi.useFakeTimers()
    setFeedMode("studio")
    expect(ingestStudioFrame(candleFrame("2", 5, 100, [1, 2, 3, 4]))).toBe(true)
    vi.advanceTimersByTime(61_000) // no studio frames for > 60s → dead
    expect(ingestAppFrame(candleFrame("2", 5, 110, [4, 5, 6, 7]))).toBe(true)
    expect(lastClose(liveEOData(), "2")).toBe(7)
  })

  it("extension preference drops studio frames, falling back after the leg dies", () => {
    vi.useFakeTimers()
    setFeedMode("extension")
    expect(ingestAppFrame(candleFrame("3", 5, 100, [1, 2, 3, 4]))).toBe(true)
    expect(ingestStudioFrame(candleFrame("3", 5, 110, [4, 5, 6, 7]))).toBe(false)
    expect(lastClose(liveEOData(), "3")).toBe(4)
    expect(liveEOStats().legs.studio.accepted).toBe(0)
    vi.advanceTimersByTime(61_000) // extension leg dies
    expect(ingestStudioFrame(candleFrame("3", 5, 120, [7, 8, 9, 10]))).toBe(true)
    expect(lastClose(liveEOData(), "3")).toBe(10)
  })

  it("auto serves whichever leg is newest (shared buffers, newest frame wins)", () => {
    vi.useFakeTimers()
    setFeedMode("auto")
    expect(ingestStudioFrame(candleFrame("4", 5, 100, [1, 2, 3, 4]))).toBe(true)
    expect(ingestAppFrame(candleFrame("4", 5, 101, [4, 5, 6, 7]))).toBe(true)
    expect(lastClose(liveEOData(), "4")).toBe(7) // extension frame arrived most recently
    expect(ingestStudioFrame(candleFrame("4", 5, 102, [7, 8, 9, 11]))).toBe(true)
    expect(lastClose(liveEOData(), "4")).toBe(11) // studio frame is now newest
  })

  it("never blanks a live feed: every mode serves when ANY single leg is live", async () => {
    vi.useFakeTimers()
    // Scenario A — only the extension leg is live. Every mode must serve its
    // frames: "studio" is the interesting case (preferred leg dead → fallback).
    for (const mode of ["auto", "studio"]) {
      setFeedMode(mode)
      expect(ingestAppFrame(candleFrame("5", 5, 100, [1, 2, 3, 4]))).toBe(true)
      expect(lastClose(liveEOData(), "5")).toBe(4)
    }
    // stopLiveEO resets per-leg aliveness — otherwise the extension leg from
    // scenario A would still look alive and scenario B would legitimately drop.
    await stopLiveEO()
    // Scenario B — only the studio leg is live. "extension" is the interesting
    // case (preferred leg dead → fallback).
    for (const mode of ["auto", "extension"]) {
      setFeedMode(mode)
      expect(ingestStudioFrame(candleFrame("6", 5, 101, [4, 5, 6, 8]))).toBe(true)
      expect(lastClose(liveEOData(), "6")).toBe(8)
    }
  })

  it("surfaces the preference and leg liveness in stats and snapshot", () => {
    vi.useFakeTimers()
    expect(setFeedMode("studio")).toBe("studio")
    expect(liveEOStats().feedMode).toBe("studio")
    expect(liveSnapshot().feedMode).toBe("studio")
    expect(liveSnapshot().legs.studio).toBe(false) // no frames yet
    ingestStudioFrame(candleFrame("7", 5, 100, [1, 2, 3, 4]))
    expect(liveSnapshot().legs.studio).toBe(true)
    expect(liveSnapshot().legs.extension).toBe(false)
  })
})