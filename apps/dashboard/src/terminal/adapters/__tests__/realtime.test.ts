// WS-6 T3 — realtime adapter normalization (RED, AC-007).
//
// The adapter consumes the EXISTING shared bus (one SuiteStreamManager on
// globalThis, frozen by T0). It must not open a second socket, must not
// synthesize a value, must not convert null to 0, and must not mark a
// capability live that has not actually been observed.
import { describe, expect, it } from "vitest"
import { normalizeRealtime, extractSuiteData } from "../realtime"

const NOW = 1_700_000_000_000

describe("realtime normalization — availability is observed, not assumed", () => {
  it("is live only when connected AND a snapshot was actually observed", () => {
    const n = normalizeRealtime(
      { connected: true, error: null, snapshot: { ts: NOW, trading: { cash: 100 } } as never },
      { now: NOW, maxAgeMs: 5_000 }
    )
    expect(n.availability.status).toBe("live")
  })

  it("is unavailable when the stream reports an error", () => {
    const n = normalizeRealtime(
      { connected: false, error: "reconnect failed", snapshot: null },
      { now: NOW, maxAgeMs: 5_000 }
    )
    expect(n.availability.status).toBe("unavailable")
    if (n.availability.status !== "unavailable") throw new Error("unreachable")
    expect(n.availability.reason).toMatch(/reconnect failed/i)
  })

  it("is unavailable while connected but no snapshot has arrived yet", () => {
    const n = normalizeRealtime({ connected: true, error: null, snapshot: null }, { now: NOW, maxAgeMs: 5_000 })
    expect(n.availability.status).toBe("unavailable")
    if (n.availability.status !== "unavailable") throw new Error("unreachable")
    expect(n.availability.reason).toMatch(/awaiting/i)
  })

  it("is stale — not live, not failed — when the snapshot has aged out", () => {
    const n = normalizeRealtime(
      { connected: true, error: null, snapshot: { ts: NOW - 60_000 } as never },
      { now: NOW, maxAgeMs: 5_000 }
    )
    expect(n.availability.status).toBe("stale")
  })

  it("never reports live for a disconnected stream that still holds an old snapshot", () => {
    const n = normalizeRealtime(
      { connected: false, error: null, snapshot: { ts: NOW - 60_000 } as never },
      { now: NOW, maxAgeMs: 5_000 }
    )
    expect(n.availability.status).not.toBe("live")
  })
})

describe("realtime normalization — the null-to-zero prohibition (AC-007)", () => {
  it("leaves an absent trading section null rather than zero-filling it", () => {
    const n = normalizeRealtime({ connected: true, error: null, snapshot: { ts: NOW } as never }, { now: NOW, maxAgeMs: 5_000 })
    expect(n.data.trading).toBeNull()
    expect(n.data.positions).toBeNull()
  })

  it("returns null data for every section when no snapshot exists", () => {
    const n = normalizeRealtime({ connected: true, error: null, snapshot: null }, { now: NOW, maxAgeMs: 5_000 })
    for (const key of ["trading", "positions", "closed", "signals"]) {
      expect(n.data[key as keyof typeof n.data], `${key} must be null, not [] or 0`).toBeNull()
    }
  })

  it("preserves a genuinely observed zero rather than treating it as missing", () => {
    // The inverse error: a real 0 must survive, because unconfigured != zero.
    const n = normalizeRealtime(
      { connected: true, error: null, snapshot: { ts: NOW, trading: { cash: 0 } } as never },
      { now: NOW, maxAgeMs: 5_000 }
    )
    expect(n.data.trading).toEqual({ cash: 0 })
  })

  it("keeps an observed empty array as an empty array, not null", () => {
    const n = normalizeRealtime(
      { connected: true, error: null, snapshot: { ts: NOW, positions: [] } as never },
      { now: NOW, maxAgeMs: 5_000 }
    )
    expect(n.data.positions).toEqual([])
  })
})

describe("suite data extraction", () => {
  it("copies only the observed sections", () => {
    const data = extractSuiteData({ ts: NOW, positions: [{ id: "p1" }] } as never)
    expect(data.positions).toEqual([{ id: "p1" }])
    expect(data.trading).toBeNull()
  })

  it("is defensive about a malformed snapshot without throwing", () => {
    expect(() => extractSuiteData(undefined as never)).not.toThrow()
    expect(extractSuiteData(undefined as never).trading).toBeNull()
  })
})
