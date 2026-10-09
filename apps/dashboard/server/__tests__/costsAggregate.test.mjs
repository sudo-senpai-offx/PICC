import { beforeEach, describe, expect, it, vi } from "vitest"

// Costs aggregator — day + all-time scorecard over observed fills only.
// Honesty contract (spec decisions 5 + 10, plan Task 5): venue rows appear
// ONLY with observed fills/costs (no-fill venues absent, never zero); every
// number carries measured | modeled | modeled-with-calibrated-inputs
// provenance; attempt counts ride as separate waste lines, never merged into
// cost totals; empty input yields a null total + named reason (wealth T5
// precedent: no-convertible → null, never a confident zero). Hermetic: dynamic
// import + `vi.resetModules()`, pure inputs, no env, no disk, no network.
describe("costs aggregator", () => {
  let mod
  beforeEach(async () => {
    vi.resetModules()
    mod = await import("../services/costs/aggregate.mjs")
  })

  const measured = (over = {}) => ({
    venue: "hyperliquid",
    route: "fill",
    kind: "fee",
    amountUsd: 0.01,
    ccy: "USD",
    fxSource: "parity",
    fxAt: null,
    provenance: "measured",
    observedAt: "2026-10-08T10:00:00+08:00",
    ...over
  })

  it("venue with fills gets day + all-time totals with provenance on every number", () => {
    const out = mod.scorecard({
      fills: [
        measured({ kind: "fee", amountUsd: 0.01 }),
        measured({ kind: "funding", amountUsd: 0.02 })
      ],
      rollups: [],
      attempts: {},
      window: { day: "2026-10-08" }
    })
    expect(out.venues).toHaveLength(1)
    const row = out.venues[0]
    expect(row.venue).toBe("hyperliquid")
    expect(row.day.totalUsd).toBeCloseTo(0.03, 10)
    expect(row.day.provenance).toBe("measured")
    expect(row.allTime.totalUsd).toBeCloseTo(0.03, 10)
    expect(row.allTime.provenance).toBe("measured")
    for (const leg of [...row.day.byKind, ...row.allTime.byKind]) {
      expect(["measured", "modeled", "modeled-with-calibrated-inputs"]).toContain(leg.provenance)
      expect(Number.isFinite(leg.totalUsd)).toBe(true)
    }
    expect(out.incomplete).toBe(false)
  })

  it("venue without fills is absent from venues[], never a zero row", () => {
    const out = mod.scorecard({
      fills: [measured({ venue: "hyperliquid" })],
      rollups: [],
      attempts: {},
      window: { day: "2026-10-08" }
    })
    expect(out.venues.map((v) => v.venue)).toEqual(["hyperliquid"])
    expect(out.venues.some((v) => v.venue === "paper")).toBe(false)
  })

  it("empty input yields null total + named reason, never a confident zero", () => {
    const out = mod.scorecard({ fills: [], rollups: [], attempts: {}, window: { day: "2026-10-08" } })
    expect(out.venues).toEqual([])
    expect(out.totalUsd).toBeNull()
    expect(typeof out.reason).toBe("string")
    expect(out.incomplete).toBe(true)
  })

  it("venue with no in-day fills reads day as absence with reason, all-time intact", () => {
    const out = mod.scorecard({
      fills: [measured({ observedAt: "2026-10-01T10:00:00+08:00" })],
      rollups: [],
      attempts: {},
      window: { day: "2026-10-08" }
    })
    expect(out.venues).toHaveLength(1)
    const row = out.venues[0]
    expect(row.day.totalUsd).toBeNull()
    expect(typeof row.day.reason).toBe("string")
    expect(row.allTime.totalUsd).toBeCloseTo(0.01, 10)
  })

  it("attempt counts ride as separate waste lines, never merged into cost totals", () => {
    const out = mod.scorecard({
      fills: [measured({ amountUsd: 0.5 })],
      rollups: [],
      attempts: { hyperliquid: { refused: 2, failed: 1 } },
      window: { day: "2026-10-08" }
    })
    const row = out.venues[0]
    expect(row.waste).toMatchObject({ refused: 2, failed: 1 })
    expect(row.day.totalUsd).toBeCloseTo(0.5, 10)
    expect(row.allTime.totalUsd).toBeCloseTo(0.5, 10)
  })

  it("attempts alone never create a venue row", () => {
    const out = mod.scorecard({
      fills: [],
      rollups: [],
      attempts: { hyperliquid: { refused: 3, failed: 0 } },
      window: { day: "2026-10-08" }
    })
    expect(out.venues).toEqual([])
    expect(out.totalUsd).toBeNull()
    expect(out.incomplete).toBe(true)
  })

  it("mixed measured + modeled fills downgrade the total, never overclaim measured", () => {
    const out = mod.scorecard({
      fills: [
        measured({ kind: "fee", amountUsd: 0.01 }),
        measured({ kind: "spread", amountUsd: 0.05, provenance: "modeled" })
      ],
      rollups: [],
      attempts: {},
      window: { day: "2026-10-08" }
    })
    const row = out.venues[0]
    expect(row.day.totalUsd).toBeCloseTo(0.06, 10)
    expect(row.day.provenance).toBe("modeled")
    expect(row.day.byKind).toHaveLength(2)
  })

  it("unprovenanced and non-finite fills are skipped with reasons, never zeroed", () => {
    const out = mod.scorecard({
      fills: [
        measured({ amountUsd: 0.01 }),
        measured({ amountUsd: NaN }),
        { ...measured({ amountUsd: 0.02 }), provenance: "guessed" }
      ],
      rollups: [],
      attempts: {},
      window: { day: "2026-10-08" }
    })
    const row = out.venues[0]
    expect(row.day.totalUsd).toBeCloseTo(0.01, 10)
    expect(out.incomplete).toBe(true)
    expect(out.skipped.length).toBeGreaterThanOrEqual(2)
  })

  it("degenerate rollup with all non-finite amounts yields no confident zero", () => {
    const out = mod.scorecard({
      fills: [],
      rollups: [{ venue: "hyperliquid", tzDate: "2026-10-01", totals: { fee: NaN } }],
      attempts: {},
      window: { day: "2026-10-08" }
    })
    expect(out.totalUsd).toBeNull()
    expect(out.provenance).toBeNull()
    expect(out.incomplete).toBe(true)
    for (const row of out.venues) {
      expect(row.allTime.totalUsd).toBeNull()
    }
  })

  it("modeled zero-amount legs survive as modeled lines, not gaps", () => {
    const out = mod.scorecard({
      fills: [
        measured({ kind: "fee", amountUsd: 0.01 }),
        measured({ kind: "spread", amountUsd: 0, provenance: "modeled" })
      ],
      rollups: [],
      attempts: {},
      window: { day: "2026-10-08" }
    })
    const row = out.venues[0]
    expect(row.day.totalUsd).toBeCloseTo(0.01, 10)
    expect(row.day.provenance).toBe("modeled")
    const spread = row.day.byKind.find((l) => l.kind === "spread")
    expect(spread).toMatchObject({ totalUsd: 0, provenance: "modeled" })
    expect(out.incomplete).toBe(false)
  })
})
