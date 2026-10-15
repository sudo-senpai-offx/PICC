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

  // ─────────────────────────────────────────────────────────────────────
  // REWRITTEN. The old assertion here was `state === "measured-zero"` — which
  // is the DEFECT the brief names, not the fix. `realizedVolatility` rounds
  // `annual` to 4dp, so this series' real, non-zero volatility publishes as 0,
  // and calling that "a real measurement of no movement" is a false statement
  // about a measurement, in the one field this task exists to keep honest.
  //
  // The two causes of a published 0 are different FACTS and now say so:
  //   - a genuinely FLAT window (every log return exactly 0)  -> `measured-zero`
  //   - a MOVING window whose figure falls below 0.00005      -> `measured-rounded-zero`
  //
  // The exclusion from the allocation is unchanged and still defensible: there
  // is no PUBLISHED volatility to invert. What changed is that the caller is no
  // longer told a thinly-traded instrument that ticks once per 200 days is
  // riskless.
  // ─────────────────────────────────────────────────────────────────────
  it("a real-but-tiny volatility that publishes as 0 is named as a PRECISION limit, not as no movement", () => {
    // ±1e-7 alternating: daily vol ~1e-7, annual ~1.6e-6, which
    // `realizedVolatility` rounds to 0.0000 at 4dp. The measurement is real; the
    // ROUNDING is what produces the falsy value, and it must not become 20%.
    const tiny = Array.from({ length: 70 }, (_, i) => 100 + (i % 2 ? 1e-7 : -1e-7))
    const r = riskParityAllocation({ A: tiny, B: moving() }, { window: 60, method: "inverse-vol" })
    expect(r.vols.A).not.toBe(0.2)
    expect(r.volStatus.A.state).toBe("measured-rounded-zero")
    // NOT the riskless claim. The reason has to say which side of the rounding
    // it is on, or the state name is doing all the work and the prose lies.
    expect(r.volStatus.A.reason).toMatch(/rounds to 0 at the published 4dp precision/i)
    expect(r.volStatus.A.reason).not.toMatch(/exactly 0/)
    // Still no weight — a published 0 has no volatility to invert — and the
    // exclusion is still visible rather than silent.
    expect(r.weights.A).toBeUndefined()
  })

  // REACHABILITY. "A longer history makes it MORE reachable" is the claim that
  // made this a real finding rather than a curiosity: one spike among N-1 zeros
  // gives a standard deviation proportional to 1/sqrt(N), so the annualised
  // figure falls under the 4dp floor as the window grows. Measured at window 60:
  //
  //   bars 70   one-bar tick 1e-3  -> rv.annual 0  -> measured-zero, weight undefined
  //   bars 200  one-bar tick 1e-3  -> rv.annual 0  -> measured-zero, weight undefined
  //   bars 1000 one-bar tick 1e-3  -> rv.annual 0  -> measured-zero, weight undefined
  //
  // A thinly-traded instrument that prints one tick per 200 days is the real
  // shape behind it, and every one of these is a series that MOVES.
  it("one tick in an otherwise flat window is a PRECISION limit at every window length", () => {
    const oneTick = (n, tick) => Array.from({ length: n }, (_, i) => 100 + (i === n - 1 ? tick : 0))
    for (const n of [70, 200, 1000]) {
      const partner = moving(n, 3)
      const r = riskParityAllocation({ A: oneTick(n, 1e-3), B: partner }, { window: 60 })
      expect(r.vols.A, `bars ${n}`).toBe(0)
      expect(r.volStatus.A.state, `bars ${n}`).toBe("measured-rounded-zero")
      expect(r.volStatus.A.reason, `bars ${n}`).toMatch(/below 0\.00005/)
      // The partner is unaffected: a precision limit on one symbol must not
      // become a refusal of the portfolio.
      expect(r.ok, `bars ${n}`).toBe(true)
      expect(r.weights.B, `bars ${n}`).toBeGreaterThan(0)
    }
  })

  // The CONTROL for the split: a genuinely flat series is still a real
  // measurement of no movement, and must keep saying exactly that.
  it("a genuinely FLAT window still reports a measured exactly-0, not a precision limit", () => {
    const r = riskParityAllocation({ A: flat(), B: moving() }, { window: 60 })
    expect(r.volStatus.A.state).toBe("measured-zero")
    expect(r.volStatus.A.reason).toMatch(/exactly 0/i)
    expect(r.volStatus.A.reason).not.toMatch(/rounds to 0/i)
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
    // The DISCRIMINATING substring, not `/volatil/i` — which the all-zero
    // message also satisfies. `toMatch(/volatil/i)` was satisfied by BOTH
    // refusals, so collapsing the ternary to one constant passed the whole file.
    expect(r.error).toMatch(/no symbol has a measurable volatility/i)
    expect(r.error).not.toMatch(/every symbol/i)
    expect(r.weights).toEqual({})
    // No 0.2 anywhere on a refusal.
    expect(JSON.stringify(r)).not.toContain('"0.2"')
  })

  it("refuses when every symbol is flat — the all-measured-zero case", () => {
    // Distinct from the unmeasurable case and worth its own assertion: here
    // every volatility WAS measured, and every one of them was zero. There is no
    // risk to allocate against, and saying so is the honest answer. Told
    // "no symbol has a measurable volatility" instead, a caller whose entire
    // portfolio really was measured — all of it, at 0 — is told a falsehood
    // about its own measurements.
    const r = riskParityAllocation({ A: flat(), B: flat(), C: flat() }, { window: 60 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/every symbol/i)
    expect(r.error).not.toMatch(/no symbol has a measurable volatility/i)
    expect(r.weights).toEqual({})
    // And the measurements are still reported, because they were real.
    expect(r.vols).toEqual({ A: 0, B: 0, C: 0 })
    expect(r.volStatus.A.state).toBe("measured-zero")
  })

  // The two refusals name DIFFERENT facts about the measurements behind them, and
  // that difference survives a mixed portfolio too. Asserted as a pair because
  // the failure mode is precisely "they are the same string".
  it("the all-zero and the unmeasurable refusals are never the same sentence", () => {
    const flatErr = riskParityAllocation({ A: flat(), B: flat() }, { window: 60 }).error
    const blindErr = riskParityAllocation({ A: unmeasurable(), B: unmeasurable(65, 20) }, { window: 60 }).error
    expect(flatErr).not.toBe(blindErr)
    // One measured-but-unpublishable symbol and one that measured nothing: the
    // portfolio did not fail for one reason, and "every symbol" would be a lie
    // about the symbol that could not be measured at all.
    const mixed = riskParityAllocation({ A: flat(), B: unmeasurable(65, 20) }, { window: 60 })
    expect(mixed.ok).toBe(false)
    expect(mixed.error).toMatch(/no symbol has a measurable volatility/i)
    expect(mixed.error).not.toMatch(/every symbol/i)
  })

  // ─────────────────────────────────────────────────────────────────────
  // THE ERC DIAGONAL'S INVENTED 0.0001 VARIANCE — A SEVENTH INSTANCE.
  //
  // `covMatrix[i][i] = vols[s] ? … : 0.0001` invents a 63%-annualised daily
  // variance for any symbol with no positive published vol, and because the
  // refusal above means such a symbol is always PUBLISHED-ZERO rather than
  // unmeasured, the constant is reachable through exactly one route. Measured
  // before this fix, one 1e-3 tick in a 200-bar otherwise-flat series returned
  //
  //     weights: { A: 0.4911, B: 0.213, C: 0.2959 }      <- the LOWEST published
  //                                                              risk, the LARGEST
  //                                                              allocation
  //
  // i.e. `inverseVolWeights`' honest drop, inverted, on the sibling branch.
  // `inverseVolWeights` DROPS a symbol it cannot weight; ERC was inventing one.
  // ─────────────────────────────────────────────────────────────────────
  it("the ERC covariance build DROPS a symbol it cannot weight rather than inventing a variance for it", () => {
    const oneTick = (n, tick) => Array.from({ length: n }, (_, i) => 100 + (i === n - 1 ? tick : 0))
    const r = riskParityAllocation({ A: oneTick(200, 1e-3), B: moving(200, 2), C: moving(200, 5) }, {
      window: 60,
      method: "erc"
    })
    expect(r.ok).toBe(true)
    // A publishes as 0, so it is excluded from the matrix rather than given a
    // fabricated 0.0001 diagonal that made it the largest holding.
    expect(r.vols.A).toBe(0)
    expect(r.volStatus.A.state).toBe("measured-rounded-zero")
    expect(r.weights.A).toBeUndefined()
    expect(r.riskContributions.map((rc) => rc.symbol)).not.toContain("A")
    // The two genuinely measured symbols are allocated over, and their weights
    // are a complete renormalised distribution.
    expect(Object.keys(r.weights).sort()).toEqual(["B", "C"])
    expect(r.weights.B + r.weights.C).toBeCloseTo(1, 3)
    // And the exclusion is VISIBLE: symbolCount counts everything asked for, so
    // it disagrees with the two weights actually returned — which is exactly the
    // mismatch the panel already renders rather than swallowing.
    expect(r.symbolCount).toBe(3)
    // The dropped symbol's measurement is still reported.
    expect(r.vols).toHaveProperty("A")
    expect(r.volStatus).toHaveProperty("A")
  })

  // The CONTROL: with every symbol genuinely measured, ERC allocates over all of
  // them and invents nothing. Without this the drop above could be satisfied by
  // a matrix that is always too small.
  it("ERC still allocates over EVERY symbol when all of them are genuinely measured", () => {
    for (const method of ["erc"]) {
      const r = riskParityAllocation(
        { A: moving(200, 2), B: moving(200, 5), C: moving(200, 0.7) },
        { window: 60, method }
      )
      expect(r.ok).toBe(true)
      expect(Object.keys(r.weights).sort()).toEqual(["A", "B", "C"])
      expect(r.symbolCount).toBe(3)
      expect(r.riskContributions).toHaveLength(3)
      const sum = Object.values(r.weights).reduce((s, x) => s + x, 0)
      expect(sum).toBeCloseTo(1, 3)
    }
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
