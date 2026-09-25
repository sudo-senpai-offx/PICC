// WS-6 T1 — availability contract (RED).
//
// Encodes the locked honesty rule: an unobservable value is `unavailable` with
// a named reason, never a zero-filled or silently-defaulted number. See spec
// §4.3 `Availability`, §0.3, and the order-flow P0 precedent.
import { describe, expect, it } from "vitest"
import {
  unavailable,
  reserved,
  live,
  stale,
  isUsable,
  hasValue
} from "../../domain/availability"

describe("availability — construction", () => {
  it("unavailable requires a non-empty reason and an owning workstream", () => {
    const a = unavailable({ reason: "no signed-trades feed", owner: "WS-7", since: 1_700_000_000 })
    expect(a.status).toBe("unavailable")
    if (a.status !== "unavailable") throw new Error("unreachable")
    expect(a.reason).toBe("no signed-trades feed")
    expect(a.owner).toBe("WS-7")
    expect(a.since).toBe(1_700_000_000)
  })

  it("rejects an unavailable with a blank reason", () => {
    expect(() => unavailable({ reason: "   ", owner: "WS-7", since: 1 })).toThrow(/reason/i)
  })

  it("rejects an unavailable with a blank owner", () => {
    expect(() => unavailable({ reason: "no feed", owner: "", since: 1 })).toThrow(/owner/i)
  })

  it("reserved names the workstream that owns the future capability", () => {
    const a = reserved({ workstream: "WS-7", reason: "backtest engine not built" })
    expect(a.status).toBe("reserved")
    if (a.status !== "reserved") throw new Error("unreachable")
    expect(a.workstream).toBe("WS-7")
    expect(a.reason).toBe("backtest engine not built")
  })

  it("rejects a reserved with a blank workstream", () => {
    expect(() => reserved({ workstream: " ", reason: "nope" })).toThrow(/workstream/i)
  })

  it("live carries its source and observation time", () => {
    const a = live({ source: "hyperliquid-arb", observedAt: 1_700_000_000, freshnessMs: 250 })
    expect(a.status).toBe("live")
    if (a.status !== "live") throw new Error("unreachable")
    expect(a.source).toBe("hyperliquid-arb")
    expect(a.observedAt).toBe(1_700_000_000)
    expect(a.freshnessMs).toBe(250)
  })

  it("stale keeps the last observed value visible and states why", () => {
    const a = stale({ source: "yahoo-daily", observedAt: 1_600_000_000, reason: "feed is DAILY resolution" })
    expect(a.status).toBe("stale")
    if (a.status !== "stale") throw new Error("unreachable")
    expect(a.reason).toBe("feed is DAILY resolution")
  })
})

describe("availability — usability", () => {
  it("only live is usable for a decision", () => {
    expect(isUsable(live({ source: "s", observedAt: 1, freshnessMs: 1 }))).toBe(true)
    expect(isUsable(stale({ source: "s", observedAt: 1, reason: "r" }))).toBe(false)
    expect(isUsable(unavailable({ reason: "r", owner: "WS-7", since: 1 }))).toBe(false)
    expect(isUsable(reserved({ workstream: "WS-7", reason: "r" }))).toBe(false)
  })

  it("only live reports a value", () => {
    expect(hasValue(live({ source: "s", observedAt: 1, freshnessMs: 1 }))).toBe(true)
    expect(hasValue(stale({ source: "s", observedAt: 1, reason: "r" }))).toBe(false)
    expect(hasValue(unavailable({ reason: "r", owner: "WS-7", since: 1 }))).toBe(false)
    expect(hasValue(reserved({ workstream: "WS-7", reason: "r" }))).toBe(false)
  })
})

describe("availability — the zero-filling prohibition", () => {
  it("the unavailable variant exposes no numeric field that could be read as 0", () => {
    const a = unavailable({ reason: "no trades feed", owner: "WS-7", since: 1 })
    // A fabricated "0" delta is exactly what the order-flow P0 removed.
    for (const key of ["value", "delta", "cumulative", "avgDelta", "net", "count"]) {
      expect(a, `unavailable must not expose ${key}`).not.toHaveProperty(key)
    }
  })

  it("unavailable is not satisfiable by passing 0 as a reason-adjacent value", () => {
    // Guards the anti-pattern: reason coerced to a number.
    expect(() => unavailable({ reason: 0 as unknown as string, owner: "WS-7", since: 1 })).toThrow(/reason/i)
  })
})
