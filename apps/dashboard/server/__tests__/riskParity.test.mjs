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
  /**
   * MOVES, and has exactly zero dispersion.
   *
   * Every bar multiplies by `1 + 1ulp`, and the repeated multiplication
   * quantises to a single ratio, so every log return is bit-identical and
   * non-zero: the standard deviation is exactly 0 while the price plainly rose.
   * This is the shape that reaches `measured-rounded-zero` now that
   * `volatility.mjs` no longer rounds a real figure down to a zero.
   */
  const constantStep = (n = 70) => Array.from({ length: n }, (_, i) => 100 * 1.0000000000000002 ** i)

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
  // REWRITTEN AGAIN, AND THIS TIME BY THE ROOT CAUSE.
  //
  // The previous version of this test was already a rewrite: it split "published
  // 0" into `measured-zero` and `measured-rounded-zero` and refused to call a
  // rounded zero a measurement of no movement. It named the cause exactly —
  // "`realizedVolatility` rounds `annual` to 4dp" — and that cause has now been
  // removed at the source.
  //
  // `volatility.mjs` publishes significant figures in the band where 4dp would
  // erase the figure, so this series measures 3.202e-8 and says so. The premise
  // it used to assert — "the measurement is real, the ROUNDING is what produces
  // the falsy value" — no longer holds, and a test that kept asserting it would
  // be pinning a defect that no longer exists.
  //
  // What it asserts now is the payoff: the instrument is measured, it is told
  // what it measures, and it is no longer described as riskless.
  // ─────────────────────────────────────────────────────────────────────
  it("a real-but-tiny volatility is now measured and published, not rounded away", () => {
    // ±1e-7 alternating: daily vol ~1e-7, annual ~3.2e-8. 4dp published this as
    // 0 and it took the rounded-zero path; it now carries its own value.
    const tiny = Array.from({ length: 70 }, (_, i) => 100 + (i % 2 ? 1e-7 : -1e-7))
    const r = riskParityAllocation({ A: tiny, B: moving() }, { window: 60, method: "inverse-vol" })
    expect(r.vols.A).not.toBe(0.2)
    // The real, non-zero measurement survives all the way to the consumer.
    expect(r.vols.A).toBeGreaterThan(0)
    expect(r.volStatus.A.state).toBe("measured")
    expect(r.volStatus.A.reason).toBeNull()
    // It is weightable: there is a published volatility to invert.
    expect(r.weights.A).toBeGreaterThan(0)
    // And it is NOT described as riskless, which was the whole defect.
    expect(["measured-zero", "measured-rounded-zero"]).not.toContain(r.volStatus.A.state)
  })

  // The same collapse, one step downstream. `weights` is the payload's only
  // statement of which symbols were allocated — the panel derives its
  // dropped-symbol count from the difference between what it asked for and what
  // appears there — so a real allocation published as `0` reports the symbol as
  // absent. Measured at window 120: one 1e-3 tick measures 1.449e-5 annualized
  // against a partner's 0.4215, a true weight of 3.438e-5, which 4dp served as
  // `0`. This path opened when `volatility.mjs` stopped erasing small
  // measurements, so the fix has to close it too.
  it("a genuinely allocated symbol is never published with a weight of 0", () => {
    const oneTick = (n, tick) => Array.from({ length: n }, (_, i) => 100 + (i === n - 1 ? tick : 0))
    for (const window of [30, 60, 120]) {
      const r = riskParityAllocation({ A: oneTick(300, 1e-3), B: moving(300, 3) }, { window })
      expect(r.ok, `window ${window}`).toBe(true)
      // Both symbols are weightable here, so both keys must carry a real weight.
      expect(r.weights.A, `window ${window}`).toBeGreaterThan(0)
      expect(r.weights.B, `window ${window}`).toBeGreaterThan(0)
      // And the pair still describes one whole portfolio.
      expect(r.weights.A + r.weights.B, `window ${window}`).toBeCloseTo(1, 3)
    }
  })

  // REACHABILITY, MEASURED HONESTLY. The old version of this test swept the
  // history length `n` over 70/200/1000 and claimed the annualised figure falls
  // as 1/sqrt(N). It does not, and never did: `period` is `Math.min(window,
  // length - 1)`, so at `window: 60` all three of those run the IDENTICAL
  // computation on the same last-60 sample and published the identical 0. Three
  // copies of one case, described as a sweep.
  //
  // What genuinely varies the figure is the WINDOW. This sweeps that instead, so
  // the claim the test is named for is the claim it actually demonstrates.
  it("one tick in an otherwise flat window is measured at every window length", () => {
    const oneTick = (n, tick) => Array.from({ length: n }, (_, i) => 100 + (i === n - 1 ? tick : 0))
    const seen = new Set()
    for (const window of [30, 60, 120]) {
      const r = riskParityAllocation({ A: oneTick(300, 1e-3), B: moving(300, 3) }, { window })
      // A tick among N-1 flat prices is a real, nonzero measurement at every
      // window length: it is no longer rounded to a zero nobody measured.
      expect(r.vols.A, `window ${window}`).toBeGreaterThan(0)
      expect(r.volStatus.A.state, `window ${window}`).toBe("measured")
      // The partner is unaffected: one symbol's measurement must not become a
      // refusal of the portfolio.
      expect(r.ok, `window ${window}`).toBe(true)
      expect(r.weights.B, `window ${window}`).toBeGreaterThan(0)
      seen.add(r.vols.A)
    }
    // The windows really are different computations, not one case repeated.
    expect(seen.size).toBe(3)
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

  // ─────────────────────────────────────────────────────────────────────
  // M12, REBORN — the THIRD all-published-zero shape, and the one the
  // four-state split itself created.
  //
  // `allPublishedZero` tests for `measured-zero` OR `measured-rounded-zero`,
  // and the source comment claims the rounded arm is handled. NO TEST DID. Every
  // `oneTick` use in this file pairs it with a measured partner, and the only
  // all-published-zero test uses `flat()` — so deleting `||
  // VOL_MEASURED_ROUNDED_ZERO` from `riskParity.mjs` flipped the refusal to
  // "no symbol has a measurable volatility" (false about three measurements that
  // all happened) and left the whole suite green. The mutant is dead below.
  //
  // The fixture had to change with the root-cause fix. `oneTick(200, 1e-3)` used
  // to publish `0`; it now measures ~2.05e-5 and lands in `measured`, so it no
  // longer reaches this refusal AT ALL. `constantStep` does: exactly-zero
  // dispersion over a series that demonstrably moved, which is what
  // `measured-rounded-zero` now means. The arm is still load-bearing and the
  // mutant below still has to die.
  //
  // The distinction matters BECAUSE the two refusals say opposite things about
  // the portfolio: here every symbol MOVED and was measured; told the portfolio
  // had nothing measurable, an operator concludes the data is absent rather
  // than that every figure measured exactly no dispersion.
  // ─────────────────────────────────────────────────────────────────────
  it("refuses when every symbol MOVES but every measurement publishes as 0", () => {
    const r = riskParityAllocation(
      { A: constantStep(200), B: constantStep(200), C: constantStep(200) },
      { window: 60 }
    )
    // All three were MEASURED — that is the premise; the test fails loudly if a
    // future change makes one of them unmeasurable, because then this refusal
    // would no longer be the shape it is pinning.
    expect(r.ok).toBe(false)
    for (const s of ["A", "B", "C"]) {
      expect(r.volStatus[s].state, s).toBe("measured-rounded-zero")
      expect(r.vols[s], s).toBe(0)
      // The zero-dispersion fact is named per symbol, not once in aggregate.
      expect(r.volStatus[s].reason, s).toMatch(/exactly 0 over a series that did move/i)
      expect(r.volStatus[s].reason, s).not.toMatch(/no movement/i)
    }
    expect(r.weights).toEqual({})
    // THE DISCRIMINATING ASSERTION, in both directions. Dropping the
    // `|| VOL_MEASURED_ROUNDED_ZERO` arm makes this fail: the error becomes the
    // unmeasurable message, which is a falsehood about all three measurements.
    expect(r.error).toMatch(/every symbol/i)
    expect(r.error).not.toMatch(/no symbol has a measurable volatility/i)
    // And the published-zero claim is the one that is true of these three: all
    // three published 0, so the message may say so.
    expect(r.error).toMatch(/published annual volatility is 0/i)
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
  // `covMatrix[i][i] = vols[s] ? … : 0.0001` invents a daily variance for any
  // symbol with no positive published vol. For the record, that constant
  // annualises to 15.87% (`sqrt(0.0001 * 252)`) and is 63% of the daily
  // variance of the 20% annualised constant it replaced — two different
  // quantities, and the old comment here conflated them into one wrong number.
  // Because the refusal above means such a symbol is always PUBLISHED-ZERO
  // rather than unmeasured, the constant is reachable through exactly one route.
  // Measured
  // before this fix, one 1e-3 tick in a 200-bar otherwise-flat series returned
  //
  //     weights: { A: 0.4911, B: 0.213, C: 0.2959 }      <- the LOWEST published
  //                                                              risk, the LARGEST
  //                                                              allocation
  //
  // i.e. `inverseVolWeights`' honest drop, inverted, on the sibling branch.
  // `inverseVolWeights` DROPS a symbol it cannot weight; ERC was inventing one.
  //
  // The fixture changed with the root-cause fix: `oneTick(200, 1e-3)` now
  // measures ~2.05e-5 and is weightable, so the drop this test pins comes from
  // `constantStep` — exactly zero dispersion over a series that did move.
  // ─────────────────────────────────────────────────────────────────────
  it("the ERC covariance build DROPS a symbol it cannot weight rather than inventing a variance for it", () => {
    const r = riskParityAllocation({ A: constantStep(200), B: moving(200, 2), C: moving(200, 5) }, {
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
  //
  // REWRITTEN, not deleted: this ran `for (const method of ["erc"])`, a
  // one-element loop that reads as a sweep of both methods and tests exactly
  // one. A future second entry would silently change what this pins, so it now
  // names the method it means. The inverse-vol control is the sweep at the end
  // of this file, which really does iterate both.
  it("ERC still allocates over EVERY symbol when all of them are genuinely measured", () => {
    const r = riskParityAllocation(
      { A: moving(200, 2), B: moving(200, 5), C: moving(200, 0.7) },
      { window: 60, method: "erc" }
    )
    expect(r.ok).toBe(true)
    expect(Object.keys(r.weights).sort()).toEqual(["A", "B", "C"])
    expect(r.symbolCount).toBe(3)
    expect(r.riskContributions).toHaveLength(3)
    const sum = Object.values(r.weights).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 3)
  })

  // ─────────────────────────────────────────────────────────────────────
  // THE 1x1 MATRIX. The n===1 ERC branch was reachable and untested.
  //
  // It is a genuinely distinct shape: the covariance build loops i,j over the
  // SURVIVING symbols, so excluding one symbol from a two-symbol portfolio
  // produces a 1x1 matrix rather than refusing — and a 1x1 covariance is the
  // degenerate case `equalRiskContribution` can still solve. The behaviour is
  // correct (verified), so this pins it rather than changing it.
  //
  // What this pins that a 2x2 test cannot: that the excluded symbol leaves the
  // MATRIX and not just the weights, that `symbolCount` still counts it, and
  // that a 1x1 portfolio volatility is the surviving asset's OWN measured risk
  // in daily units — the one place a fabricated constant would still fit.
  // ─────────────────────────────────────────────────────────────────────
  it("ERC on a two-symbol portfolio with one unweightable symbol solves the 1x1 matrix it is left with", () => {
    const r = riskParityAllocation({ A: constantStep(200), B: moving(200, 2) }, { window: 60, method: "erc" })
    expect(r.ok).toBe(true)
    // A is out of the matrix; B is all that is left, so B is the whole portfolio.
    expect(r.weights).toEqual({ B: 1 })
    expect(r.riskContributions).toEqual([{ symbol: "B", weight: 1, riskContribution: "100%" }])
    // The exclusion stays visible: two symbols were asked for, one was weighed.
    expect(r.symbolCount).toBe(2)
    // And A's measurement is still reported, named as the precision limit it is.
    expect(r.vols.A).toBe(0)
    expect(r.volStatus.A.state).toBe("measured-rounded-zero")
    // THE FABRICATION CHECK. With a single asset the portfolio's risk IS that
    // asset's daily volatility, so the number must track B's own measurement —
    // which a reinstated `0.0001` diagonal would not do.
    expect(r.portfolioVol).toBeGreaterThan(0)
    expect(r.portfolioVol).not.toBe(0.0001)
    // 3 DECIMAL PLACES, AND THE BINDING CONSTRAINT IS THE 4dp PUBLICATION THAT
    // IS PRESENT NOW — not a hypothetical future edit to ERC. `equalRiskContribution`
    // returns `Math.round(portVol * 10000) / 10000` (`riskParity.mjs:140`), so the
    // value under test is a quantised figure: the exact target is
    // `0.0227534612…` against a published `0.0228`, an absolute difference of
    // 4.654e-5. That sits 10.7x inside the 3dp tolerance and only 1.07x inside
    // the 4dp one, so a 4dp assertion would be testing the rounding rather than
    // the measurement, and would start failing the moment the quantum moved.
    // (An earlier note here attributed the limit to changes to ERC's publication
    // or its 1e-12 floor; those are not what binds it.)
    expect(r.portfolioVol).toBeCloseTo(r.vols.B / Math.sqrt(252), 3)
    // The weight list, not the matrix size, is what the caller reads; it carries
    // one key and that key is the symbol with a positive published volatility.
    expect(Object.keys(r.weights)).toEqual(["B"])
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
