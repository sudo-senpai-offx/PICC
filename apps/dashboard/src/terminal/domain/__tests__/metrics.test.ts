// WS-6 T4 — separated metrics (RED, AC-009 / AC-011, D9 / D13).
//
// D9: a bucket needs 500+ RESOLVED samples before expectancy is meaningful.
// D13: `procedureDrillScore` is bounded, explicitly non-statistical, and may
// only marginally nudge copilot confidence. It may NEVER gate a trade or size a
// position. The two metrics are metrically DISJOINT — never summed, averaged,
// or displayed as one number.
import { describe, expect, it } from "vitest"
import { computeExpectancy, computeProcedureDrillScore, combineMetrics } from "../metrics"
import { makeSampleKey } from "../sampleKeys"

const key = makeSampleKey({
  setup: "london-trend",
  market: "BTCUSDT",
  timeframe: "15m",
  dataFidelity: "ohlcv-bar",
  regimeClass: "trend"
})

const otherKey = makeSampleKey({ ...key, dataFidelity: "l2-trades" })

function samples(n: number, netPnl: number, k = key) {
  return Array.from({ length: n }, (_, i) => ({
    key: k,
    resolvedAt: 1_700_000_000 + i,
    netPnl,
    costBasis: { fees: 1, slippage: 0.5, currency: "USDC" },
    procedureEvidenceId: `ev-${i}`
  }))
}

describe("expectancy — the 500-sample floor (AC-009, D9)", () => {
  it("is insufficient at 499 resolved samples and reports the exact counts", () => {
    const e = computeExpectancy(key, samples(499, 10))
    expect(e.status).toBe("insufficient")
    expect(e.resolvedCount).toBe(499)
    expect(e.requiredCount).toBe(500)
    expect(e.value).toBeNull()
  })

  it("is live at exactly 500 resolved samples", () => {
    const e = computeExpectancy(key, samples(500, 10))
    expect(e.status).toBe("live")
    expect(e.resolvedCount).toBe(500)
    expect(e.value).toBeCloseTo(10, 6)
  })

  it("reports a value that is net of the recorded cost basis", () => {
    // netPnl is already net; the metric must not silently re-add costs.
    const e = computeExpectancy(key, samples(500, 10))
    expect(e.costBasis).toMatch(/net/i)
  })

  it("reports insufficient rather than a value when a bucket is empty", () => {
    const e = computeExpectancy(key, [])
    expect(e.status).toBe("insufficient")
    expect(e.value).toBeNull()
  })
})

describe("expectancy — no cross-key aggregation (AC-009)", () => {
  it("counts ONLY samples matching the requested key", () => {
    const mixed = [...samples(300, 10), ...samples(300, -100, otherKey)]
    const e = computeExpectancy(key, mixed)
    expect(e.resolvedCount).toBe(300)
    expect(e.status).toBe("insufficient")
    // The large loss in the other key must not bleed into this one.
    expect(e.value).toBeNull()
  })

  it("cannot reach sufficiency by borrowing another key's samples", () => {
    const mixed = [...samples(499, 10), ...samples(500, -100, otherKey)]
    expect(computeExpectancy(key, mixed).status).toBe("insufficient")
  })

  it("returns insufficient for a key that has no samples at all", () => {
    const e = computeExpectancy(key, samples(500, 10, otherKey))
    expect(e.resolvedCount).toBe(0)
    expect(e.value).toBeNull()
  })
})

describe("procedure drill score — bounded and never sizing-eligible (AC-011, D13)", () => {
  it("is never sizing eligible, in any state", () => {
    const p = computeProcedureDrillScore({ runId: "r1", rubricVersion: "v1", score: 0.92 })
    expect(p.sizingEligible).toBe(false)
  })

  it("is unavailable — not zero — when no rubric evidence exists", () => {
    const p = computeProcedureDrillScore({ runId: "r1", rubricVersion: "v1", score: null })
    expect(p.status).toBe("unavailable")
    expect(p.value).toBeNull()
  })

  it("clamps an out-of-range rubric score into bounds rather than trusting it", () => {
    expect(computeProcedureDrillScore({ runId: "r", rubricVersion: "v1", score: 1.8 }).value).toBe(1)
    expect(computeProcedureDrillScore({ runId: "r", rubricVersion: "v1", score: -0.4 }).value).toBe(0)
  })

  it("never reports an expectancy-like per-trade figure", () => {
    const p = computeProcedureDrillScore({ runId: "r", rubricVersion: "v1", score: 0.5 })
    expect(p).not.toHaveProperty("netPnl")
    expect(p).not.toHaveProperty("perTrade")
  })
})

describe("metric separation (AC-011)", () => {
  it("refuses to combine the two metrics into one number", () => {
    const e = computeExpectancy(key, samples(500, 10))
    const p = computeProcedureDrillScore({ runId: "r", rubricVersion: "v1", score: 0.5 })
    // There is deliberately no API that averages them. The guard exists so a
    // future caller gets a failing test rather than a blended "score".
    expect(() => combineMetrics(e, p)).toThrow(/must not be combined|disjoint/i)
  })

  it("shows both metrics independently when expectancy is insufficient", () => {
    // AC-011's scenario: a known procedure score with insufficient expectancy.
    const e = computeExpectancy(key, samples(499, 10))
    const p = computeProcedureDrillScore({ runId: "r", rubricVersion: "v1", score: 0.75 })
    expect(p.status).toBe("live")
    expect(p.value).toBe(0.75)
    expect(e.status).toBe("insufficient")
    expect(e.value).toBeNull()
    // The procedure score must not have leaked into expectancy.
    expect(e.value).not.toBe(p.value)
  })
})
