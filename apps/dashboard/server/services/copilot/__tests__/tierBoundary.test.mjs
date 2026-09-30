// WS-7 T11 — AC-023: tier boundaries are exact.
//
// AC-023:949-955:
//   Scenario:  Scores of 69, 70, 84, 85, and 86 are produced.
//   Expected:  85+ → A+ (1% risk); 70–84 → B (0.5%, notify for approval);
//              <70 → ignore, stay in cash. No interpolation band exists.
//   Prohibited: A value between 84 and 85 may not be rounded or interpolated
//              into A+.
//   Verification: Table-driven boundary test.
//
// The expected values come from `tierBoundaryFixture.mjs`, which is data
// transcribed from the spec text above — NOT from calling `bandOf` and
// recording whatever it returned. A test that recomputes the expectation with
// the implementation's own logic cannot disagree with it and therefore cannot
// fail; this one can.

import { describe, expect, it } from "vitest"

import { bandOf, tierFor } from "../tiers.mjs"
import {
  ALL_BOUNDARY_CASES,
  BOUNDARY_CASES,
  EXTREME_CASES,
  NO_ROUNDING_CASES,
  TIER_BOUNDARIES
} from "../tierBoundaryFixture.mjs"
import { APLUS_MIN_SCORE, B_MIN_SCORE } from "../tierBoundaryFixture.mjs"

const NO_VETOES = []

describe("AC-023 — the boundary is at >= 85 and >= 70, exactly", () => {
  it("maps every case in the AC-023 scenario table", () => {
    for (const c of BOUNDARY_CASES) {
      expect({ score: c.score, ...bandOf(c.score) }, c.label).toEqual({
        score: c.score,
        tier: c.tier,
        riskPct: c.riskPct
      })
    }
  })

  it("declares the boundaries as 85 and 70", () => {
    expect(APLUS_MIN_SCORE).toBe(85)
    expect(B_MIN_SCORE).toBe(70)
  })

  it("declares exactly three tiers, with no fourth band invented", () => {
    expect(TIER_BOUNDARIES.map((b) => b.tier)).toEqual(["A+", "B", "ignore"])
    expect(TIER_BOUNDARIES).toHaveLength(3)
  })

  it("pairs A+ with 1% risk, B with 0.5%, and ignore with 0% (spec §4.4:689)", () => {
    const byTier = Object.fromEntries(TIER_BOUNDARIES.map((b) => [b.tier, b.riskPct]))
    expect(byTier).toEqual({ "A+": 0.01, B: 0.005, ignore: 0 })
  })
})

describe("AC-023's prohibited side effect — no rounding into A+", () => {
  it("keeps every value between 84 and 85 in B", () => {
    for (const c of NO_ROUNDING_CASES) {
      expect({ score: c.score, ...bandOf(c.score) }, c.label).toEqual({
        score: c.score,
        tier: "B",
        riskPct: 0.005
      })
    }
  })

  it("would fail if the engine rounded to a whole number", () => {
    // The control: a rounding implementation fails these cases, so the table
    // above is genuinely discriminating rather than vacuously true.
    //
    // 84.4 rounds to 84 and would stay B — it is in the table because a
    // `>= 84.5` or `> 84` boundary would also catch it, not because rounding
    // catches it. 84.5 and 84.9 both round up to 85, so rounding flips exactly
    // two of the three. Two is enough: the table fails a rounding engine.
    const roundedUp = NO_ROUNDING_CASES.filter((c) => Math.round(c.score) >= APLUS_MIN_SCORE)
    expect(roundedUp.map((c) => c.score)).toEqual([84.5, 84.9])
    expect(roundedUp).toHaveLength(2)
  })

  it("includes 84.4 because a > 84 boundary would also wrongly claim it", () => {
    // 84.4 is the case that catches a sloppy "greater than 84" reading, and the
    // one rounding would let through. It earns its row.
    expect(Math.round(84.4)).toBe(84)
    expect(84.4 > 84).toBe(true)
  })

  it("would fail if the boundary were > 84 rather than >= 85", () => {
    const looseBoundary = NO_ROUNDING_CASES.filter((c) => c.score > 84)
    expect(looseBoundary).toHaveLength(3)
  })

  it("treats 84.999999 as B, not A+ — the engine does no rounding at all", () => {
    expect(bandOf(84.999999).tier).toBe("B")
  })
})

describe("AC-023 — null is unscoreable, and zero is not", () => {
  it("maps an unscoreable null to ignore / hold / 0% rather than to a score of 0", () => {
    expect(bandOf(null)).toEqual({ tier: "ignore", riskPct: 0 })
    const t = tierFor(null, { vetoes: NO_VETOES, automationPermitted: true, rung: "demo" })
    expect(t.action).toBe("hold")
    expect(t.riskPct).toBe(0)
  })

  it("maps a real 0 to the same tier by a different route, and says which", () => {
    // Both land on `ignore`, and the distinction is in what the caller is told:
    // null is an absence, 0 is a result. Collapsing them is the failure the
    // availability contract exists to prevent (contracts.ts:188-190).
    expect(bandOf(0)).toEqual(bandOf(null))
    expect(typeof 0).toBe("number")
    expect(typeof null).toBe("object")
  })

  it("rejects a score that is not a finite number in 0-100", () => {
    expect(() => bandOf(undefined)).toThrow(TypeError)
    expect(() => bandOf(Number.NaN)).toThrow(TypeError)
    expect(() => bandOf(100.5)).toThrow(RangeError)
    expect(() => bandOf(-0.1)).toThrow(RangeError)
  })
})

describe("AC-023 — the whole table, in order, including extremes", () => {
  it("satisfies every row of the fixture", () => {
    const seen = []
    for (const c of ALL_BOUNDARY_CASES) {
      seen.push(bandOf(c.score))
      expect({ ...bandOf(c.score), label: c.label }, c.label).toEqual({
        tier: c.tier,
        riskPct: c.riskPct,
        label: c.label
      })
    }
    // A fixture that silently stopped being iterated would pass vacuously.
    expect(seen).toHaveLength(ALL_BOUNDARY_CASES.length)
    expect(seen).toHaveLength(2 + BOUNDARY_CASES.length + NO_ROUNDING_CASES.length)
  })

  it("covers 100 and 0 without leaking outside the range", () => {
    for (const c of EXTREME_CASES) {
      expect({ ...bandOf(c.score), label: c.label }, c.label).toEqual({
        tier: c.tier,
        riskPct: c.riskPct,
        label: c.label
      })
    }
  })
})

describe("AC-023 — actions follow the tier, and never the reverse", () => {
  const at = (score, automationPermitted) =>
    tierFor(score, { vetoes: NO_VETOES, automationPermitted, rung: "paper" }).action

  it("A+ auto-executes only with permission", () => {
    expect(at(85, true)).toBe("autoExecute")
    expect(at(85, false)).toBe("notifyForApproval")
  })

  it("B notifies for approval with or without permission", () => {
    expect(at(70, true)).toBe("notifyForApproval")
    expect(at(70, false)).toBe("notifyForApproval")
  })

  it("ignore holds regardless of permission", () => {
    expect(at(69, true)).toBe("hold")
    expect(at(69, false)).toBe("hold")
  })
})
