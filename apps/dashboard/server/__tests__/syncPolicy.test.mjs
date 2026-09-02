import { describe, expect, it } from "vitest"
import { cadenceFor, cadenceLabel, SYNC } from "../../extensions/picc-overlay/syncPolicy.js"

/**
 * Per-stream sync cadence policy — the pure heart of the extension sync
 * redesign. A stream's cadence is a function of ITS OWN tab's activity, never
 * of which tab is the browser's globally-active one.
 */

const now = 1_000_000_000_000

describe("cadenceFor — per-stream tab-activity sync policy", () => {
  it("realtime while the tab is active", () => {
    expect(cadenceFor({ active: true, lastFocusedAt: now }, now)).toBe(SYNC.REALTIME_MS)
    expect(cadenceFor({ active: true, lastFocusedAt: now - 10 * 60_000 }, now)).toBe(SYNC.REALTIME_MS)
  })

  it("stays realtime through the activity window after the tab loses focus (tab-switch resilience)", () => {
    // The tab was focused 30s ago and the user switched away — the stream must
    // NOT drop cadence just because another tab is now globally active.
    const halfWindow = Math.floor(SYNC.ACTIVITY_WINDOW_MS / 2)
    expect(cadenceFor({ active: false, lastFocusedAt: now - halfWindow }, now)).toBe(SYNC.REALTIME_MS)
  })

  it("drops to intermittent once the activity window lapses", () => {
    const after = SYNC.ACTIVITY_WINDOW_MS + 1
    const beforeProlonged = Math.max(after, SYNC.PROLONGED_MS - 1)
    expect(cadenceFor({ active: false, lastFocusedAt: now - after }, now)).toBe(SYNC.INTERMITTENT_MS)
    expect(cadenceFor({ active: false, lastFocusedAt: now - beforeProlonged }, now)).toBe(SYNC.INTERMITTENT_MS)
  })

  it("drops to long-period on prolonged inactivity", () => {
    const prolonged = SYNC.PROLONGED_MS + 5 * 60_000
    expect(cadenceFor({ active: false, lastFocusedAt: now - prolonged }, now)).toBe(SYNC.LONG_MS)
  })

  it("unknown focus history (default) is treated as long-inactive, never realtime", () => {
    expect(cadenceFor({}, now)).toBe(SYNC.LONG_MS)
    expect(cadenceFor({ active: false, lastFocusedAt: 0 }, now)).toBe(SYNC.LONG_MS)
  })

  it("labels match the tiers", () => {
    expect(cadenceLabel(SYNC.REALTIME_MS)).toBe("realtime")
    expect(cadenceLabel(SYNC.INTERMITTENT_MS)).toBe("intermittent")
    expect(cadenceLabel(SYNC.LONG_MS)).toBe("long")
  })

  it("tier ordering is monotonic: realtime < intermittent < long", () => {
    expect(SYNC.REALTIME_MS).toBeLessThan(SYNC.INTERMITTENT_MS)
    expect(SYNC.INTERMITTENT_MS).toBeLessThan(SYNC.LONG_MS)
    expect(SYNC.TICK_MS).toBeGreaterThanOrEqual(SYNC.REALTIME_MS)
  })
})