import { describe, expect, it } from "vitest"
import {
  inverseVolWeights,
  equalRiskContribution,
  riskParityAllocation
} from "../services/riskParity.mjs"

describe("riskParity.inverseVolWeights", () => {
  it("returns empty weights when no finite positive vols", () => {
    expect(inverseVolWeights({})).toEqual({ weights: {}, method: "inverse-vol" })
    expect(inverseVolWeights({ A: 0, B: NaN, C: -1 })).toEqual({ weights: {}, method: "inverse-vol" })
  })

  it("gives equal weights for equal vols", () => {
    const { weights } = inverseVolWeights({ A: 0.2, B: 0.2, C: 0.2 })
    expect(weights.A).toBeCloseTo(1 / 3, 2)
    expect(weights.B).toBeCloseTo(1 / 3, 2)
    expect(weights.C).toBeCloseTo(1 / 3, 2)
  })

  it("weights sum to 1 and higher vol gets lower weight", () => {
    const { weights } = inverseVolWeights({ Volatile: 0.1, Calm: 0.01 })
    const sum = Object.values(weights).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 3)
    expect(weights.Calm).toBeGreaterThan(weights.Volatile)
  })
})

describe("riskParity.equalRiskContribution", () => {
  it("distributes equally across independent (diagonal) assets", () => {
    const cov = [
      [0.04, 0, 0],
      [0, 0.04, 0],
      [0, 0, 0.04]
    ]
    const { weights, portfolioVol, riskContributions } = equalRiskContribution(cov, ["A", "B", "C"], 1000)
    expect(weights.A).toBeCloseTo(1 / 3, 2)
    expect(weights.B).toBeCloseTo(1 / 3, 2)
    expect(weights.C).toBeCloseTo(1 / 3, 2)
    expect(portfolioVol).toBeGreaterThan(0)
    expect(riskContributions).toHaveLength(3)
  })

  it("allocates less to a higher-variance asset so risk is equalized", () => {
    // Asset C dominates variance -> should get a smaller weight than A/B.
    const cov = [
      [0.01, 0, 0],
      [0, 0.01, 0],
      [0, 0, 0.15]
    ]
    const { weights } = equalRiskContribution(cov, ["A", "B", "C"], 2000)
    expect(weights.C).toBeLessThan(weights.A)
    expect(weights.C).toBeLessThan(weights.B)
  })

  it("guards against malformed input", () => {
    // REWRITTEN. `portfolioVol: 0` here was a LITERAL for "I could not compute
    // anything", which reads to any caller as "this portfolio carries no risk".
    // It is now `null` — an absence — plus `ok: false` and a reason naming the
    // malformation, so the refusal is legible without a second guess.
    const expected = {
      weights: {},
      riskContributions: [],
      portfolioVol: null,
      ok: false,
      reason: expect.stringMatching(/covMatrix|symbols/i)
    }
    expect(equalRiskContribution([], [])).toEqual(expected)
    expect(equalRiskContribution(null, [])).toEqual(expected)
  })

  // Swept across the whole malformed-input domain rather than the two shapes the
  // old assertion happened to use.
  it("refuses every malformed shape with a null portfolioVol, never a 0", () => {
    const MALFORMED = [
      ["no symbols", [], []],
      ["no covMatrix", null, ["A"]],
      ["covMatrix not an array", {}, ["A"]],
      ["length mismatch (too short)", [[0.04, 0]], ["A", "B"]],
      ["length mismatch (too long)", [[0.04]], ["A", "B"]],
      ["no symbols but a covMatrix", [[0.04, 0], [0, 0.04]], []]
    ]
    for (const [name, cov, syms] of MALFORMED) {
      const out = equalRiskContribution(cov, syms)
      expect(out.weights, name).toEqual({})
      expect(out.riskContributions, name).toEqual([])
      expect(out.portfolioVol, name).toBeNull()
      expect(out.portfolioVol).not.toBe(0)
      expect(out.ok, name).toBe(false)
      expect(typeof out.reason, name).toBe("string")
    }
  })
})

// ---------------------------------------------------------------------
// THE INVENTED 20% (`:162`), AND WHAT HAPPENS WHEN IT IS REMOVED.
//
// `vols[s] = rv.annual || 0.20` fed a CONSTANT straight into inverse-volatility
// weights, which then produced numbers that read as measured allocations. The
// investigation of whether `rv.annual` can actually be falsy found THREE
// reachable ways, all of them real shapes rather than theoretical:
//
//   1. `null`  — `realizedVolatility` returns null when the series yields fewer
//      usable log returns than `period`. 65 prices with 10 non-positive values
//      does it: `logReturns.length < 60`. Measured: annual = null.
//   2. `0`     — a genuinely FLAT series measures exactly zero, and `0 || 0.20`
//      is 0.20. This is the worst of the three: a real measurement is not
//      weakened, it is REPLACED, and the response reports a risk level that was
//      never observed.
//   3. `0` by rounding — `realizedVolatility` rounds `annual` to 4dp, so a real
//      but tiny vol (daily ~1e-7) rounds to exactly 0 and takes the same path.
//
// Before the fix, three flat series produced `vols = {A: 0.2, B: 0.2, C: 0.2}`
// and equal weights — three riskless assets reported as carrying 20% each.
// And two UNMEASURABLE series produced `ok: true` with 50/50 weights and
// `vols = {A: 0.2, B: 0.2}`, which is a confident allocation built entirely from
// a constant.
// ---------------------------------------------------------------------
describe("riskParity no longer invents a 20% volatility", () => {
  /** A FLAT series: measured volatility is exactly 0, and that 0 is real. */
  const flat = (n = 70) => Array.from({ length: n }, () => 100)
  /** A series with too few usable log returns for `realizedVolatility` to measure. */
  const unmeasurable = (n = 65, nonPositive = 16) =>
    Array.from({ length: n }, (_, i) => (i < nonPositive ? 0 : 100 + i * 0.05))
  /** A series with a real, measurable, non-zero volatility. */
  const moving = (n = 70, seed = 1) => Array.from({ length: n }, (_, i) => 100 + Math.sin(i * seed) * 2 + i * 0.03)

  it("a FLAT series reports its measured 0, never a substituted 0.20", () => {
    const r = riskParityAllocation({ A: flat(), B: moving() }, { window: 60, method: "inverse-vol" })
    expect(r.ok).toBe(true)
    // A is riskless: the honest number is 0, and 0 is a MEASUREMENT here.
    expect(r.vols.A).toBe(0)
    expect(r.vols.A).not.toBe(0.2)
    expect(r.volStatus.A.state).toBe("measured-zero")
    // A zero vol cannot be weighted, so it gets no weight — and it is not
    // silently replaced by one. B carries the whole allocation.
    expect(r.weights.A).toBeUndefined()
    expect(r.weights.B).toBeCloseTo(1, 3)
  })

  it("a real-but-tiny volatility is not rounded into the 0.20 path", () => {
    // ±1e-7 alternating: daily vol ~1e-7, annual ~1.6e-6, which `realizedVolatility`
    // rounds to 0.0000 at 4dp. The measurement is real; the ROUNDING is what
    // produces the falsy value, and it must not turn into 20%.
    const tiny = Array.from({ length: 70 }, (_, i) => 100 + (i % 2 ? 1e-7 : -1e-7))
    const r = riskParityAllocation({ A: tiny, B: moving() }, { window: 60, method: "inverse-vol" })
    expect(r.vols.A).not.toBe(0.2)
    expect(r.volStatus.A.state).toBe("measured-zero")
  })

  it("an UNMEASURABLE series is reported as unmeasured and given no invented vol", () => {
    const r = riskParityAllocation({ A: unmeasurable(), B: moving(), C: moving(70, 3) }, { window: 60 })
    expect(r.ok).toBe(true)
    expect(r.vols.A).toBeNull()
    expect(r.vols.A).not.toBe(0.2)
    expect(r.volStatus.A.state).toBe("unmeasured")
    expect(r.volStatus.A.reason).toMatch(/too few usable positive-price transitions/i)
    // No weight, because no volatility was measured to weight it by.
    expect(r.weights.A).toBeUndefined()
    // And the surviving weights still sum to 1, so the allocation is complete
    // over what it COULD measure rather than complete over a fabrication.
    const sum = Object.values(r.weights).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 3)
  })

  // THE REFUSAL. With the constant gone, "every symbol was unmeasurable" would
  // otherwise become `ok: true, weights: {}` — a confident empty allocation,
  // which is the defect wearing the opposite sign.
  it("refuses when NO symbol has a measurable volatility", () => {
    const r = riskParityAllocation({ A: unmeasurable(), B: unmeasurable(65, 20) }, { window: 60 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/volatil/i)
    expect(r.weights).toEqual({})
    // No 0.2 anywhere on a refusal.
    expect(JSON.stringify(r)).not.toContain('"0.2"')
  })

  it("refuses when every symbol is flat — the all-measured-zero case", () => {
    // Distinct from the unmeasurable case and worth its own assertion: here
    // every volatility WAS measured, and every one of them was zero. There is no
    // risk to allocate against, and saying so is the honest answer.
    const r = riskParityAllocation({ A: flat(), B: flat(), C: flat() }, { window: 60 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/volatil/i)
    expect(r.weights).toEqual({})
    // And the measurements are still reported, because they were real.
    expect(r.vols).toEqual({ A: 0, B: 0, C: 0 })
    expect(r.volStatus.A.state).toBe("measured-zero")
  })

  // THE MEASUREMENT DIRECTION — the control for all five refusals above, and the
  // guard against a fix that over-corrects. Adequate input must still produce a
  // real, weighted allocation across the whole measurable domain.
  it("STILL allocates from real measurements, over a sweep of the usable domain", () => {
    for (const n of [65, 70, 120, 250]) {
      for (const window of [20, 60, 120]) {
        for (const method of ["inverse-vol", "erc"]) {
          const histories = {
            A: moving(n, 1),
            B: moving(n, 2.5),
            C: moving(n, 0.4)
          }
          const r = riskParityAllocation(histories, { window, method })
          if (n < window + 5) {
            expect(r.ok, `${n}/${window}`).toBe(false)
            continue
          }
          expect(r.ok, `${n}/${window}/${method}`).toBe(true)
          // Every symbol contributed a REAL measurement...
          for (const s of ["A", "B", "C"]) {
            expect(r.volStatus[s].state, `${s} ${n}/${window}`).toBe("measured")
            expect(r.vols[s], s).toBeGreaterThan(0)
          }
          // ...and none of them is the invented constant.
          expect(Object.values(r.vols)).not.toContain(0.2)
          // The weights are complete and derived from those measurements.
          const sum = Object.values(r.weights).reduce((s, x) => s + x, 0)
          expect(sum, `${n}/${window}/${method}`).toBeCloseTo(1, 2)
          expect(Object.keys(r.weights).length, `${n}/${window}/${method}`).toBe(3)
          // And inverse-vol really is inverse: the calmest asset weighs most.
          if (method === "inverse-vol") {
            const calmest = Object.keys(r.vols).sort((x, y) => r.vols[x] - r.vols[y])[0]
            const wildest = Object.keys(r.vols).sort((x, y) => r.vols[y] - r.vols[x])[0]
            expect(r.weights[calmest], `${n}/${window}`).toBeGreaterThan(r.weights[wildest])
          }
        }
      }
    }
  })
})

describe("riskParity.riskParityAllocation", () => {
  it("returns error when no symbol has sufficient data", () => {
    const r = riskParityAllocation({ A: [1, 2, 3] }, { window: 60 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/data/)
  })

  it("returns single-asset allocation when only one symbol qualifies", () => {
    const long = Array.from({ length: 120 }, (_, i) => 100 + i)
    const r = riskParityAllocation({ A: long, B: [1, 2] }, { window: 60 })
    expect(r.ok).toBe(true)
    expect(r.weights.A).toBe(1)
    expect(r.method).toBe("single-asset")
  })

  // ─────────────────────────────────────────────────────────────────────
  // REWRITTEN. `portfolioVol: 0` ON THE SINGLE-ASSET BRANCH WAS A LITERAL.
  //
  // It sat above the covariance build, on a branch that computes NO covariance
  // because a one-asset portfolio needs no allocation — so the `0` was not a
  // measurement and not even a plausible one. A caller that does not know about
  // `method` reads it as "this position carries no risk", which is the most
  // dangerous possible direction for that field to lie in: a risk number that
  // says there is none.
  //
  // It is now `null` — an absence, not a zero — with a reason, and the asset's
  // OWN measured volatility is preserved in `vols` rather than discarded, so the
  // caller loses no information and the portfolio-level field stops asserting
  // something this branch never computed.
  // ─────────────────────────────────────────────────────────────────────
  it("the single-asset branch reports NO portfolio vol rather than a literal 0", () => {
    const long = Array.from({ length: 120 }, (_, i) => 100 + i)
    const r = riskParityAllocation({ A: long, B: [1, 2] }, { window: 60 })
    expect(r.portfolioVol).toBeNull()
    expect(r.portfolioVol).not.toBe(0)
    expect(r.portfolioVolPct).toBeNull()
    expect(r.reason).toMatch(/single.asset/i)
    // And the measurement the branch DID take is still there.
    expect(r.vols.A).toBeGreaterThan(0)
    expect(r.volStatus.A.state).toBe("measured")
    // The branch label the UI gates on is unchanged, so a client pinned to it
    // keeps working.
    expect(r.method).toBe("single-asset")
    expect(r.ok).toBe(true)
  })

  it("the single-asset refusal still fires when that one asset is unmeasurable", () => {
    // A single unmeasurable symbol must NOT be given the invented 20% either.
    const unmeasurable = Array.from({ length: 65 }, (_, i) => (i < 16 ? 0 : 100 + i * 0.05))
    const r = riskParityAllocation({ A: unmeasurable, B: [1, 2] }, { window: 60 })
    expect(r.ok).toBe(false)
    expect(r.vols.A).toBeNull()
    expect(r.weights).toEqual({})
    expect(JSON.stringify(r)).not.toContain('"0.2"')
  })

  it("computes inverse-vol weights summing to 1 across assets", () => {
    const histories = {}
    for (const base of [100, 80, 120]) {
      histories[`SYM${base}`] = Array.from({ length: 200 }, (_, i) =>
        base * (1 + 0.001 * Math.sin(i) + 0.0005 * i)
      )
    }
    const r = riskParityAllocation(histories, { window: 60, method: "inverse-vol" })
    expect(r.ok).toBe(true)
    const sum = Object.values(r.weights).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 2)
    expect(r.symbolCount).toBe(3)
  })

  it("computes equal-risk-contribution allocation from price series", () => {
    const histories = {}
    for (const base of [100, 80, 120]) {
      histories[`SYM${base}`] = Array.from({ length: 250 }, (_, i) =>
        base * (1 + 0.001 * Math.sin(i + base) + 0.0004 * i)
      )
    }
    const r = riskParityAllocation(histories, { window: 120, method: "erc" })
    expect(r.ok).toBe(true)
    const sum = Object.values(r.weights).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 2)
    expect(r.method).toBe("equal-risk-contribution")
    expect(r.portfolioVol).toBeGreaterThan(0)
  })
})
