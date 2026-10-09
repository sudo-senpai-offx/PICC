import { beforeEach, describe, expect, it, vi } from "vitest"

// Costs modeled leg — constitution `costAdjustedEv` wrapper + adaptive medians.
// Provenance honesty: calibrated outputs are labeled
// "modeled-with-calibrated-inputs", NEVER "measured". Hermetic: dynamic import
// + `vi.resetModules()`, no env, no disk, no network.
describe("costs modeled leg", () => {
  let mod
  beforeEach(async () => {
    vi.resetModules()
    mod = await import("../services/costs/modeled.mjs")
  })

  it("exposes the calibration threshold as a named constant", () => {
    expect(mod.CALIBRATION_MIN_FILLS).toBe(30)
  })

  it("defaults produce modeled spread+slippage records", () => {
    const { records, skipped } = mod.modelFillCost({
      venue: "hyperliquid",
      notionalUsd: 1000
    })
    expect(skipped).toEqual([])
    expect(records).toHaveLength(2)
    for (const r of records) {
      expect(r.provenance).toBe("modeled")
    }
    const spread = records.find((r) => r.kind === "spread")
    const slip = records.find((r) => r.kind === "slippage")
    expect(spread.amountUsd).toBeCloseTo(1000 * 1.5 * 0.01, 8)
    expect(slip.amountUsd).toBe(0)
    expect(spread.inputs).toMatchObject({ spreadPips: 1.5, slippagePips: 0 })
  })

  it("30 measured fills flip inputs to venue medians with the calibrated label", () => {
    const fills = Array.from({ length: 30 }, (_, i) => ({
      venue: "hyperliquid",
      spreadPips: 2 + (i % 2),
      slippagePips: 0.5
    }))
    const cal = mod.calibratedInputs("hyperliquid", fills)
    expect(cal).toMatchObject({
      spreadPips: 2.5,
      slippagePips: 0.5,
      provenance: "modeled-with-calibrated-inputs"
    })
  })

  it("29 fills keep the 1.5/0 defaults without the calibrated label", () => {
    const fills = Array.from({ length: 29 }, () => ({
      venue: "hyperliquid",
      spreadPips: 9,
      slippagePips: 9
    }))
    const cal = mod.calibratedInputs("hyperliquid", fills)
    expect(cal).toMatchObject({
      spreadPips: 1.5,
      slippagePips: 0,
      provenance: "modeled"
    })
  })

  it("other venues do not calibrate this venue", () => {
    const fills = Array.from({ length: 30 }, () => ({
      venue: "other",
      spreadPips: 9,
      slippagePips: 9
    }))
    const cal = mod.calibratedInputs("hyperliquid", fills)
    expect(cal).toMatchObject({
      spreadPips: 1.5,
      slippagePips: 0,
      provenance: "modeled"
    })
  })

  it("never emits the measured label across defaults, calibration, and modeling", () => {
    const fills30 = Array.from({ length: 30 }, () => ({
      venue: "hyperliquid",
      spreadPips: 2,
      slippagePips: 1
    }))
    const cal = mod.calibratedInputs("hyperliquid", fills30)
    const a = mod.modelFillCost({ venue: "hyperliquid", notionalUsd: 100 })
    const b = mod.modelFillCost({
      venue: "hyperliquid",
      notionalUsd: 100,
      spreadPips: cal.spreadPips,
      slippagePips: cal.slippagePips,
      provenance: cal.provenance
    })
    const c = mod.modelFillCost({
      venue: "hyperliquid",
      notionalUsd: 100,
      provenance: "measured"
    })
    const labels = [
      cal.provenance,
      ...a.records.map((r) => r.provenance),
      ...b.records.map((r) => r.provenance),
      ...c.records.map((r) => r.provenance)
    ]
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).not.toContain("measured")
  })

  it("skips non-finite notionals with a reason, never zeros", () => {
    const { records, skipped } = mod.modelFillCost({
      venue: "hyperliquid",
      notionalUsd: NaN
    })
    expect(records).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(typeof skipped[0].reason).toBe("string")
  })

  it("skips negative spreads with a reason instead of netting invisibly", () => {
    const { records, skipped } = mod.modelFillCost({
      venue: "hyperliquid",
      notionalUsd: 100,
      spreadPips: -1
    })
    expect(records).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(typeof skipped[0].reason).toBe("string")
  })
})
