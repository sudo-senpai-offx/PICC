import { describe, expect, it } from "vitest"
import { cadenceFor, cadenceLabel, cadenceMsFor, SYNC } from "../../extensions/picc-overlay/syncPolicy.js"

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

describe("cadenceMsFor — per-site cadence override (Q5 generalized registry)", () => {
  const override = {
    realtimeMs: 10_000,
    intermittentMs: 60_000,
    longMs: 120_000,
    activityWindowMs: 45_000,
    prolongedMs: 300_000
  }

  it("matches cadenceFor's tier selection when no override is given", () => {
    // 5 min is strictly below PROLONGED_MS (10 min) → intermittent tier.
    const tab = { active: false, lastFocusedAt: now - 5 * 60_000 }
    expect(cadenceMsFor(tab, now)).toBe(SYNC.INTERMITTENT_MS)
    expect(cadenceFor(tab, now)).toBe(SYNC.INTERMITTENT_MS)
  })

  it("applies the override's realtime tier for an active tab", () => {
    expect(cadenceMsFor({ active: true, lastFocusedAt: now }, now, override)).toBe(10_000)
  })

  it("stays realtime through the OVERRIDE activity window after focus lapses", () => {
    // Override window is 45s; 30s after focus must still be realtime per the
    // override even though the default (60s) would keep it realtime regardless.
    expect(cadenceMsFor({ active: false, lastFocusedAt: now - 30_000 }, now, override)).toBe(10_000)
  })

  it("uses the override's intermittent tier once its activity window lapses", () => {
    expect(cadenceMsFor({ active: false, lastFocusedAt: now - 50_000 }, now, override)).toBe(60_000)
  })

  it("uses the override's long tier on prolonged inactivity", () => {
    expect(cadenceMsFor({ active: false, lastFocusedAt: now - 400_000 }, now, override)).toBe(120_000)
  })

  it("defaults unknown focus history to the override long tier", () => {
    expect(cadenceMsFor({}, now, override)).toBe(120_000)
  })

  it("falls back to SYNC defaults per-field when the override omits them", () => {
    const partial = { realtimeMs: 7_000 }
    const tab = { active: true, lastFocusedAt: now }
    // realtimeMs overridden, the rest use the SYNC defaults.
    expect(cadenceMsFor(tab, now, partial)).toBe(7_000)
    // 5 min is strictly below PROLONGED_MS → intermittent falls back to SYNC.
    expect(cadenceMsFor({ active: false, lastFocusedAt: now - 5 * 60_000 }, now, partial)).toBe(SYNC.INTERMITTENT_MS)
  })
})