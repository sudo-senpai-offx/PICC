import { describe, expect, it } from "vitest"
import { dayKeyOf, daysElapsedForClass, tradingDaysElapsed } from "../services/commandCentre/tradingCalendar.mjs"

describe("tradingCalendar — WS-3 F3 pure trading-day primitive", () => {
  it("counts distinct day keys once — same-day duplicates dedupe", () => {
    expect(tradingDaysElapsed(["2026-09-23", "2026-09-23", "2026-09-23", "2026-09-24"])).toBe(2)
  })

  it("crypto-class default counts every UTC day — no exclusions applied", () => {
    const days = ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]
    expect(tradingDaysElapsed(days)).toBe(5)
    expect(daysElapsedForClass(days, {}, "ccxt-crypto")).toBe(5)
  })

  it("exclusion map skips weekend/holiday days for a class", () => {
    // 2026-09-23 (Wed) .. 2026-09-29 (Tue); Sat 26 + Sun 27 excluded for the fx class.
    const days = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]
    const calendars = { fx: { exclusions: { "2026-09-26": true, "2026-09-27": true } } }
    expect(tradingDaysElapsed(days)).toBe(7)
    expect(daysElapsedForClass(days, calendars, "fx")).toBe(5)
  })

  it("zero-credit day never counted — absent keys and empties add nothing", () => {
    expect(tradingDaysElapsed(["2026-09-23"])).toBe(1)
    expect(tradingDaysElapsed([])).toBe(0)
    expect(tradingDaysElapsed(["2026-09-23", null, undefined, ""])).toBe(1)
  })

  it("dayKeyOf mirrors the canonical UTC boundary — 23:59:59.999Z vs 00:00:00.000Z", () => {
    expect(dayKeyOf(Date.parse("2026-09-23T23:59:59.999Z"))).toBe("2026-09-23")
    expect(dayKeyOf(Date.parse("2026-09-24T00:00:00.000Z"))).toBe("2026-09-24")
  })

  it("per-class exclusion application is independent per class", () => {
    const days = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]
    const calendars = { expertoption: { exclusions: { "2026-09-26": true } } }
    expect(daysElapsedForClass(days, calendars, "expertoption")).toBe(3)
    expect(daysElapsedForClass(days, calendars, "ccxt-crypto")).toBe(4)
    expect(daysElapsedForClass(days, {}, "missing-class")).toBe(4)
  })
})