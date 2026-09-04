import { describe, expect, test } from "vitest"
import { getCurrentSession, getSessionSchedule, getSessionForAsset } from "../services/tradingSessions.mjs"

const utc = (hour, minute = 0) => new Date(Date.UTC(2026, 8, 4, hour, minute))

describe("trading sessions (slice 5d coverage)", () => {
  test("10:00 UTC → London only, NY next in 3h", () => {
    const s = getCurrentSession(utc(10))
    expect(s.activeSessions.map((x) => x.id)).toEqual(["london"])
    expect(s.activeOverlaps).toEqual([])
    expect(s.isHighVolatility).toBe(true)
    expect(s.nextSession.id).toBe("newyork")
    expect(s.nextSession.hoursUntil).toBe(3)
    expect(s.preferredAssets).toContain("EURUSD")
  })

  test("14:00 UTC → London + New York with the London-NY overlap", () => {
    const s = getCurrentSession(utc(14))
    expect(s.activeSessions.map((x) => x.id).sort()).toEqual(["london", "newyork"])
    expect(s.activeOverlaps).toHaveLength(1)
    expect(s.activeOverlaps[0].name).toBe("London-NY Overlap")
    expect(s.activeOverlaps[0].hoursRemaining).toBe(2)
    // description carries the overlap's DESCRIPTION field, not its name
    expect(s.description).toBe("Most liquid 3 hours of the trading day")
  })

  test("23:00 UTC → off-hours, Asian opens next", () => {
    const s = getCurrentSession(utc(23))
    expect(s.activeSessions).toEqual([])
    expect(s.isHighVolatility).toBe(false)
    expect(s.nextSession.id).toBe("asian")
    expect(s.nextSession.hoursUntil).toBe(1)
    expect(s.description).toContain("Off-hours")
  })

  test("fractional hours count toward the session window", () => {
    // 07:30 UTC — London open, half an hour in.
    const s = getCurrentSession(utc(7, 30))
    expect(s.activeSessions.map((x) => x.id)).toContain("london")
    expect(s.activeSessions.find((x) => x.id === "london").hoursRemaining).toBe(8.5)
  })

  test("getSessionSchedule returns the full static schedule", () => {
    const s = getSessionSchedule()
    expect(s.schedule).toHaveLength(3)
    expect(s.schedule.map((x) => x.id).sort()).toEqual(["asian", "london", "newyork"])
    expect(s.overlaps).toHaveLength(2)
    expect(typeof s.utcHour).toBe("number")
  })

  test("getSessionForAsset maps symbols to their preferred sessions", () => {
    const r = getSessionForAsset("eurusd")
    expect(r.symbol).toBe("EURUSD")
    expect(r.preferredSessions.map((x) => x.name)).toContain("London")
    expect(r.preferredSessions.map((x) => x.name)).toContain("New York")
    expect(["optimal", "suboptimal", "off_hours"]).toContain(r.recommendation)
  })
})
