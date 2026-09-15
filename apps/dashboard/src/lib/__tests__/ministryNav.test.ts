// @vitest-environment jsdom
// Per-suite last-room preference: opening a ministry resumes the room you
// last closed. Storage key: picc.ministry.<suiteId>.lastRoom (isolated from
// the .settings key so the two per-ministry stores never collide).
import { describe, expect, it, beforeEach } from "vitest"
import { getLastRoom, rememberRoom } from "@/lib/ministryNav"

describe("ministry last-room preference", () => {
  beforeEach(() => localStorage.clear())

  const valid = ["dashboard", "markets", "paper", "autopilot", "command-centre", "simulator", "settings"]

  it("returns null when nothing was stored (fresh suite)", () => {
    expect(getLastRoom("trading", valid)).toBeNull()
  })

  it("returns the stored room for the same suite", () => {
    rememberRoom("trading", "markets")
    expect(getLastRoom("trading", valid)).toBe("markets")
  })

  it("is per-suite: trading and earnings are independent", () => {
    rememberRoom("trading", "markets")
    rememberRoom("earnings", "settings")
    expect(getLastRoom("trading", valid)).toBe("markets")
    expect(getLastRoom("earnings", ["dashboard", "simulator", "settings"])).toBe("settings")
  })

  it("rejects a stored room that is no longer valid (honest fallback)", () => {
    localStorage.setItem("picc.ministry.trading.lastRoom", "removed-room")
    expect(getLastRoom("trading", valid)).toBeNull()
  })

  it("ignores missing suite id or room", () => {
    expect(() => rememberRoom(undefined, "markets")).not.toThrow()
    expect(() => rememberRoom("trading", undefined)).not.toThrow()
    expect(getLastRoom(undefined, valid)).toBeNull()
  })
})