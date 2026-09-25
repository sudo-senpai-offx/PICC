// WS-6 T4 — deterministic session routing (RED, AC-010, D10).
//
// D10 is normative: London/NY overlap -> trend following; Tokyo + mid-session
// lull (ADX < 20) -> mean reversion; NY afternoon -> intermediary; Dead Zone
// 20:00-00:00 GMT -> NO TRADING. AC-010 adds that an unlisted combination must
// return `reserved`, and that no animation, remote explanation, or convenience
// override may change the route.
//
// SESSION BOUNDS: the spec states the Dead Zone and the qualitative sessions
// but not numeric hour boundaries for the others. The bounds below are this
// implementation's explicit reading in UTC and are documented in the module
// header so the owner can correct them; the PRECEDENCE is the locked part.
import { describe, expect, it } from "vitest"
import { routeSession, SESSION_BOUNDS_UTC } from "../sessionRouting"

const at = (hour: number, minute = 0) => Date.UTC(2026, 0, 5, hour, minute)

describe("session routing — Dead Zone is a hard stop (D10)", () => {
  it("returns no_trade for 20:00-00:00 GMT", () => {
    for (const hour of [20, 21, 22, 23]) {
      const r = routeSession(at(hour))
      expect(r.route, `${hour}:00 GMT must be no_trade`).toBe("no_trade")
    }
  })

  it("treats 00:00 as the dead-zone boundary, not Tokyo", () => {
    // Midnight is the exclusive end of the Dead Zone. If it were Tokyo, a
    // boundary bug would silently permit trading at the exact stop.
    expect(routeSession(at(0)).route).toBe("no_trade")
  })

  it("wins over NY afternoon, which otherwise covers 20:00-21:00", () => {
    // Precedence: the Dead Zone is an absolute no-trading override.
    const r = routeSession(at(20, 30))
    expect(r.route).toBe("no_trade")
    expect(r.matchedRule).toMatch(/dead zone/i)
  })

  it("always evaluates in UTC", () => {
    expect(routeSession(at(13)).timezone).toBe("UTC")
  })
})

describe("session routing — named sessions (D10)", () => {
  it("routes the London/NY overlap to trend following", () => {
    // 13:00-16:00 UTC
    for (const hour of [13, 14, 15]) {
      const r = routeSession(at(hour))
      expect(r.route, `${hour}:00 UTC is the London/NY overlap`).toBe("trend_following")
      expect(r.matchedRule).toMatch(/overlap/i)
    }
  })

  it("routes NY afternoon to intermediary", () => {
    // 16:00-20:00 UTC, clipped by the Dead Zone
    for (const hour of [16, 17, 18, 19]) {
      const r = routeSession(at(hour))
      expect(r.route, `${hour}:00 UTC is NY afternoon`).toBe("intermediary")
      expect(r.matchedRule).toMatch(/afternoon/i)
    }
  })

  it("routes a Tokyo mid-session lull (ADX < 20) to mean reversion", () => {
    // 00:30-08:30 UTC is inside Tokyo and outside the Dead Zone.
    const r = routeSession(at(2), { adx: 19.9 })
    expect(r.route).toBe("mean_reversion")
    expect(r.matchedRule).toMatch(/lull|adx/i)
  })

  it("does NOT route a trending Tokyo session to mean reversion", () => {
    // ADX >= 20 is not a mean-reversion condition.
    const r = routeSession(at(2), { adx: 20 })
    expect(r.route).not.toBe("mean_reversion")
  })

  it("requires an observed ADX before it will call a Tokyo lull", () => {
    // An unobserved ADX is not evidence of a lull.
    const r = routeSession(at(2))
    expect(r.route).not.toBe("mean_reversion")
  })
})

describe("session routing — unlisted combinations are reserved (AC-010)", () => {
  it("returns reserved for London-only hours outside the overlap", () => {
    // 09:00-13:00 UTC is London-only; D10 does not assign it a route.
    const r = routeSession(at(10))
    expect(r.route).toBe("reserved")
    expect(r.matchedRule).toMatch(/unlisted/i)
  })

  it("returns reserved for a Tokyo session with a strong trend", () => {
    const r = routeSession(at(4), { adx: 35 })
    expect(r.route).toBe("reserved")
  })
})

describe("session routing — determinism and override resistance (AC-010)", () => {
  it("is deterministic for the same input", () => {
    const a = routeSession(at(14), { adx: 15 })
    const b = routeSession(at(14), { adx: 15 })
    expect(a.route).toBe(b.route)
    expect(a.matchedRule).toBe(b.matchedRule)
  })

  it("ignores an ADX inside the overlap — the overlap rule is unconditional", () => {
    for (const adx of [0, 20, 50]) {
      expect(routeSession(at(14), { adx }).route).toBe("trend_following")
    }
  })

  it("ignores ADX inside the Dead Zone", () => {
    expect(routeSession(at(22), { adx: 5 }).route).toBe("no_trade")
  })

  it("exposes its bounds so the owner can audit the interpretation", () => {
    expect(SESSION_BOUNDS_UTC.deadZone).toMatchObject({ startHour: 20, endHour: 24, inclusiveEnd: true })
    expect(SESSION_BOUNDS_UTC.overlap).toEqual({ startHour: 13, endHour: 16 })
  })
})
