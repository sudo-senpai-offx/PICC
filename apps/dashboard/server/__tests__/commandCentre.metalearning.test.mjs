import { beforeEach, describe, expect, test } from "vitest"
import {
  _resetMetalearning,
  applyOutcome,
  edgeTrust,
  revertLastOutcome,
  setTrust
} from "../services/commandCentre/metalearning.mjs"

beforeEach(() => {
  _resetMetalearning()
})

describe("Command Centre — Metalearning: outcome-gated edge trust", () => {
  test("uncalibrated edges are exactly neutral (trust 1.0)", () => {
    expect(edgeTrust("e-news")).toBe(1.0)
  })

  test("an outcome WITHOUT settled is rejected and mutates nothing (outcome-gated floor)", () => {
    const before = edgeTrust("e-risk")
    const r = applyOutcome({ edgeId: "e-risk", outcome: "hit", settled: false })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("settled")
    expect(edgeTrust("e-risk")).toBe(before)
  })

  test("hit raises, miss lowers, push is neutral — each by its bounded factor", () => {
    expect(applyOutcome({ edgeId: "e-a", outcome: "hit", settled: true }).after).toBeCloseTo(1.05, 4)
    expect(edgeTrust("e-a")).toBeCloseTo(1.05, 4)

    const miss = applyOutcome({ edgeId: "e-b", outcome: "miss", settled: true })
    expect(miss.after).toBeCloseTo(0.95, 4)

    const push = applyOutcome({ edgeId: "e-c", outcome: "push", settled: true })
    expect(push.after).toBe(1.0)
  })

  test("clamps: repeated hits stop at 3.0, repeated misses stop at 0.2", () => {
    for (let i = 0; i < 100; i++) {
      applyOutcome({ edgeId: "e-hot", outcome: "hit", settled: true }) // 1.05^100 ≈ 131 → 3.0
    }
    expect(edgeTrust("e-hot")).toBe(3.0)

    for (let i = 0; i < 100; i++) {
      applyOutcome({ edgeId: "e-cold", outcome: "miss", settled: true }) // 0.95^100 ≈ 0.006 → 0.2
    }
    expect(edgeTrust("e-cold")).toBe(0.2)
  })

  test("outcomes compound: the after of one outcome is the before of the next", () => {
    const first = applyOutcome({ edgeId: "e-x", outcome: "hit", settled: true })
    const second = applyOutcome({ edgeId: "e-x", outcome: "hit", settled: true })
    expect(second.before).toBe(first.after)
    expect(second.after).toBeCloseTo(1.05 * 1.05, 4)
  })

  test("every applied outcome returns the audit event with before/after (5A-style record)", () => {
    const r = applyOutcome({ edgeId: "e-y", outcome: "miss", settled: true })
    expect(r.ok).toBe(true)
    expect(r.before).toBeCloseTo(1.0, 4)
    expect(r.after).toBeCloseTo(0.95, 4)
  })

  test("revertLastOutcome restores the exact prior trust; reverting nothing is a clean no-op", () => {
    applyOutcome({ edgeId: "e-z", outcome: "hit", settled: true })
    expect(edgeTrust("e-z")).toBeCloseTo(1.05, 4)
    const rev = revertLastOutcome()
    expect(rev.ok).toBe(true)
    expect(rev.reverted.after).toBeCloseTo(1.05, 4)
    expect(edgeTrust("e-z")).toBe(1.0)

    const noop = revertLastOutcome()
    expect(noop.ok).toBe(false)
  })

  test("setTrust is discovery-time tuning only — clamped, audited, never reverting outcome work", () => {
    expect(setTrust("e-t", 2.0).after).toBe(2.0)
    expect(edgeTrust("e-t")).toBe(2.0)
    // out of bounds rejected entirely (no silent clamp-and-apply)
    const bad = setTrust("e-t", 99)
    expect(bad.ok).toBe(false)
    expect(edgeTrust("e-t")).toBe(2.0) // unchanged
    // reverting an OUTCOME does not erase a manual tune
    applyOutcome({ edgeId: "e-t", outcome: "miss", settled: true })
    revertLastOutcome()
    expect(edgeTrust("e-t")).toBe(2.0)
  })
})

describe("Command Centre — Metalearning: floor-proof surface (the whitelist)", () => {
  test("the module exposes ONLY trust calibration — no envelope, breaker, or audit knob", async () => {
    const api = Object.keys(await import("../services/commandCentre/metalearning.mjs")).sort()
    expect(api).toEqual(["_resetMetalearning", "applyOutcome", "edgeTrust", "revertLastOutcome", "setTrust"].sort())
  })
})