import { describe, expect, it, test } from "vitest"
import {
  realizedVolatility,
  volatilityRegime,
  volatilityPositionSize,
  garmanKlassVolatility,
  yangZhangVolatility,
  parkinsonVolatility,
  garchEstimate,
  annualizedVolatility
} from "../services/volatility.mjs"

function closesSeries(n, step) {
  return Array.from({ length: n }, (_, i) => 100 + i * step)
}

function candle(open, high, low, close) {
  return { open, high, low, close }
}

describe("volatility math (slice 5d coverage)", () => {
  test("realizedVolatility is 0 on a perfectly steady series and > 0 on a choppy one", () => {
    // A genuinely FLAT series: every log return is exactly 0, so the measured
    // volatility is exactly 0. This is a real measurement of no movement, and it
    // is the only series shape that may publish `0`.
    const flat = Array.from({ length: 60 }, () => 100)
    const steady = realizedVolatility(flat, { period: 20, annualize: 252 })
    expect(steady.daily).toBe(0)
    expect(steady.annual).toBe(0)
    expect(steady.annualPct).toBe("0%")

    const choppy = []
    for (let i = 0; i < 60; i++) choppy.push(100 + (i % 2 === 0 ? i : -i * 0.5))
    const noisy = realizedVolatility(choppy, { period: 20, annualize: 252 })
    expect(noisy.annual).toBeGreaterThan(0)
    expect(noisy.sampleSize).toBeGreaterThanOrEqual(20)
  })

  // ───────────────────────────────────────────────────────────────────────────
  // REWRITTEN, NOT DELETED. This assertion used to read `toBe(0)` on a series
  // built as `100 * 1.001 ** i`, under a comment claiming "identical log returns
  // → zero variance".
  //
  // Both halves of that were wrong. The log returns are NOT identical: float
  // multiplication leaves 3 distinct values across the 59 transitions, and the
  // measured standard deviation is ~1.3e-16, not 0. The test passed only because
  // 4dp rounded 1.3e-16 to a flat zero — the same rounding that manufactured the
  // falsy `0` this task exists to remove. It was a third instance of the defect,
  // dressed as a control for it.
  //
  // What the series actually measures is now asserted, and the genuinely-flat
  // case above carries the "exactly 0" claim where it belongs.
  // ───────────────────────────────────────────────────────────────────────────
  test("a constant-percentage-growth series measures float noise, not exactly zero", () => {
    const geometric = Array.from({ length: 60 }, (_, i) => 100 * 1.001 ** i)
    const rv = realizedVolatility(geometric, { period: 20, annualize: 252 })

    // Its log returns are not identical, so this is not a measurement of 0.
    const logReturns = []
    for (let i = 1; i < geometric.length; i++) logReturns.push(Math.log(geometric[i] / geometric[i - 1]))
    expect(new Set(logReturns).size).toBeGreaterThan(1)

    // The measurement is therefore tiny and NONZERO, and it is published as
    // itself rather than as a zero it never was.
    expect(rv.daily).toBeGreaterThan(0)
    expect(rv.daily).toBeLessThan(1e-12)
    expect(rv.annual).toBeGreaterThan(0)
    expect(rv.annualPct).not.toBe("0%")
  })

  test("garman-klass / yang-zhang return positive annualized estimates on OHLC data", () => {
    const candles = []
    for (let i = 0; i < 40; i++) {
      const c = 100 + i * 0.3
      candles.push(candle(c - 0.4, c + 0.8, c - 0.8, c + 0.2))
    }
    const gk = garmanKlassVolatility(candles, { period: 20, annualize: 252 })
    const yz = yangZhangVolatility(candles, { period: 20, annualize: 252 })
    expect(gk.annual).toBeGreaterThan(0)
    expect(yz.annual).toBeGreaterThan(0)
  })

  test("annualizedVolatility picks the best estimator the data supports", () => {
    // Close-only → close-close method.
    const closes = closesSeries(60, 1)
    expect(annualizedVolatility(closes).method).toBe("close-close")
    // OHLC present → an OHLC estimator (yang-zhang is most efficient).
    const candles = []
    for (let i = 0; i < 60; i++) {
      const c = 100 + i * 0.3
      candles.push(candle(c - 0.4, c + 0.8, c - 0.8, c + 0.2))
    }
    const est = annualizedVolatility(candles)
    expect(["yang-zhang", "garman-klass", "parkinson", "close-close"]).toContain(est.method)
    expect(est.annual).toBeGreaterThan(0)
  })

  test("volatilityPositionSize scales inversely to volatility with exact math", () => {
    const size = volatilityPositionSize({ capital: 10000, riskPct: 0.02, currentVol: 0.3, targetVol: 0.2, entryPrice: 100 })
    expect(size.volScale).toBeCloseTo(0.6667, 4)
    expect(size.riskBudget).toBeCloseTo(133.33, 2)
    expect(size.units).toBe(1)
    expect(size.positionValue).toBeCloseTo(100, 2)
  })

  test("volatilityRegime flags a late ATR spike as high/elevated", () => {
    const candles = []
    for (let i = 0; i < 40; i++) {
      // First 30 bars calm, last 10 wide.
      const wide = i >= 30
      const c = 100 + i * 0.1
      const half = wide ? 3 : 0.05
      candles.push(candle(c - half, c + half, c - half, c))
    }
    const r = volatilityRegime(candles, { period: 14 })
    expect(r.percentile).toBeGreaterThanOrEqual(70)
    expect(["high", "elevated"]).toContain(r.regime)
    expect(r.atr).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PUBLICATION PRECISION — ROUNDING TO DECIMAL PLACES MANUFACTURED A FALSY 0.
//
// `Math.round(x * 10000) / 10000` keeps four figures AFTER the point, so every
// magnitude under 5e-5 becomes exactly `0` no matter how real it is. Annualised
// volatility is a DIMENSIONLESS quantity whose magnitude ranges over orders of
// magnitude (a thinly-traded instrument ticking once in 200 bars measures ~2e-5;
// an active one measures ~0.3), so a fixed number of decimal places is the wrong
// precision for it: the publisher was discarding the measurement, not rounding
// it, and `0` is the one number a risk consumer cannot tell from "riskless".
//
// The invariant every test below defends: A NONZERO MEASUREMENT NEVER PUBLISHES
// AS `0`. The ordinary range must come through UNCHANGED — this is meant to be
// free, not a redefinition of the numbers every consumer already reads.
// ─────────────────────────────────────────────────────────────────────────────

/** Alternating +r/-r log returns, so the sample's standard deviation is `r`. */
const alternatingCloses = (r, n = 60) => {
  const closes = [100]
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * (i % 2 ? Math.exp(r) : Math.exp(-r)))
  return closes
}

/** One tick among flat prices — the thinly-traded instrument's real shape. */
const oneTick = (n, tick) => Array.from({ length: n }, (_, i) => 100 + (i === n - 1 ? tick : 0))

/** A smooth but genuinely moving price series, the ordinary consumer's shape. */
const sineCloses = (n, seed) => Array.from({ length: n }, (_, i) => 100 + Math.sin(i * seed) * 2 + i * 0.03)

/** Real OHLC bars with a full range, for the estimators that need them. */
const ohlcCandles = (n, step, seed) =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + i * step
    return { open: c, high: c + 1.3 + Math.sin(i * seed), low: c - 1.1 - Math.cos(i * seed), close: c + 0.2 }
  })

/** A candle whose whole range is `w` wide, on a price that barely moves. */
const hairlineCandle = (x, w) => ({ open: x, high: x + w, low: x - w, close: x })

describe("publication precision: a nonzero measurement never publishes as 0", () => {
  it("realizedVolatility keeps a tiny but real volatility, at every magnitude", () => {
    for (const r of [1e-9, 1e-7, 1e-6, 3.15e-6, 1e-5, 4.99e-5, 5e-5, 1e-3]) {
      const rv = realizedVolatility(alternatingCloses(r), { period: 20, annualize: 252 })
      expect(rv.daily, `daily at r=${r}`).toBeGreaterThan(0)
      expect(rv.annual, `annual at r=${r}`).toBeGreaterThan(0)
      // The STRING is a publisher too: "0%" is the same lie with a unit on it.
      expect(rv.annualPct, `annualPct at r=${r}`).not.toBe("0%")
    }
  })

  it("one tick in 200 otherwise-flat bars is not published as 0", () => {
    // Measured through the real pipeline at window 60: annual ~= 2.05e-5, which
    // 4 decimal places rounded to exactly 0. The brief's headline shape.
    const rv = realizedVolatility(oneTick(200, 1e-3), { period: 60, annualize: 252 })
    expect(rv.annual).toBeGreaterThan(0)
    expect(rv.daily).toBeGreaterThan(0)
    expect(rv.annualPct).not.toBe("0%")
  })

  it("holds across the whole one-tick family, straddling the old 5e-5 floor", () => {
    // The floor was a cliff at 5e-5 with a whole band beneath it. Sweeping the
    // tick sweeps `annual` across that floor, so every rung must publish nonzero.
    for (const tick of [1e-7, 1e-5, 1e-3, 0.05, 0.2, 0.24, 0.25, 0.3]) {
      const rv = realizedVolatility(oneTick(200, tick), { period: 60, annualize: 252 })
      expect(rv.annual, `annual for tick ${tick}`).toBeGreaterThan(0)
      expect(rv.annualPct, `annualPct for tick ${tick}`).not.toBe("0%")
    }
  })

  it("every OHLC estimator obeys the same invariant as realizedVolatility", () => {
    // parkinson / garman-klass / yang-zhang published with the SAME 4dp formula,
    // so fixing only `realizedVolatility` left the defect reachable through the
    // estimator that `annualizedVolatility` actually prefers on OHLC data.
    const candles = Array.from({ length: 40 }, (_, i) => hairlineCandle(100 + i * 1e-9, 1e-7))
    for (const [name, fn] of [
      ["parkinson", parkinsonVolatility],
      ["garman-klass", garmanKlassVolatility],
      ["yang-zhang", yangZhangVolatility]
    ]) {
      const est = fn(candles, { period: 20, annualize: 252 })
      expect(est.daily, `${name} daily`).toBeGreaterThan(0)
      expect(est.annual, `${name} annual`).toBeGreaterThan(0)
      expect(est.annualPct, `${name} annualPct`).not.toBe("0%")
    }
  })

  it("the estimator chooser inherits the invariant on OHLC data", () => {
    const candles = Array.from({ length: 40 }, (_, i) => hairlineCandle(100 + i * 1e-9, 1e-7))
    const est = annualizedVolatility(candles, { period: 20 })
    expect(est.annual).toBeGreaterThan(0)
    expect(est.annualPct).not.toBe("0%")
  })

  it("GARCH's published volatilities obey the same invariant", () => {
    // `currentVol`, `longRunVol` and every forecast step carried the same 4dp
    // publisher, so a real-but-tiny fit served as a model with no volatility.
    const closes = Array.from({ length: 80 }, (_, i) => 100 * (i % 2 ? Math.exp(1e-9) : Math.exp(-1e-9)))
    const g = garchEstimate(closes, { period: 60, forecast: 2 })
    expect(g.ok).toBe(true)
    expect(g.currentVol).toBeGreaterThan(0)
    expect(g.currentVolPct).not.toBe("0%")
    expect(g.longRunVol).toBeGreaterThan(0)
    for (const f of g.forecasts) {
      expect(f.volatility, `forecast ${f.step} volatility`).toBeGreaterThan(0)
      expect(f.volatilityPct, `forecast ${f.step} volatilityPct`).not.toBe("0%")
    }
  })

  it("the ATR regime's dimensionless share of price obeys the same invariant", () => {
    // `atrPct` is scale-free and can be ~2e-7 on a high-priced, thinly-traded
    // name; 4dp published that as a flat `0` next to a real `atr` of 2e-5.
    const candles = Array.from({ length: 40 }, (_, i) => hairlineCandle(100 + i * 1e-9, 1e-5))
    const r = volatilityRegime(candles, { period: 14 })
    expect(r.atr).toBeGreaterThan(0)
    expect(r.atrPct).toBeGreaterThan(0)
    expect(r.atrPctPct).not.toBe("0%")
  })
})

describe("publication precision: the ordinary range is unchanged", () => {
  // GOLDEN VALUES, captured from the legacy publisher `Math.round(x*1e4)/1e4`
  // before it was replaced. Byte-for-byte comparison against what consumers
  // read today, which is the only honest way to show a precision change is free:
  // re-deriving them from the formula being replaced would prove nothing.
  //
  // These are real measured series, not round numbers. That distinction is the
  // whole point — a sweep built from `0.0001 + i*step` lands only on values with
  // at most four significant digits, where 4dp and 4-sig-fig agree trivially and
  // every candidate scheme looks free. Raw daily volatilities here run to seven
  // digits (0.01355887, 0.00423935, 0.12311740), so each one discriminates.
  const ordinary = [
    [0.0205, 0.3257, "32.57%", alternatingCloses(0.02), 20],
    [0.0513, 0.8143, "81.43%", alternatingCloses(0.05), 20],
    [0.0032, 0.0505, "5.05%", alternatingCloses(0.0031), 20],
    [0.0007, 0.0114, "1.14%", alternatingCloses(0.0007), 20],
    [0.1231, 1.9544, "195.44%", alternatingCloses(0.12), 20],
    [0.0136, 0.2152, "21.52%", sineCloses(70, 1), 60],
    [0.0042, 0.0673, "6.73%", sineCloses(120, 0.3), 60],
    [0.0236, 0.3742, "37.42%", sineCloses(90, 2), 30],
    [0.0163, 0.2589, "25.89%", sineCloses(200, 5), 100]
  ]

  it("publishes the very same daily figures the ordinary consumers already read", () => {
    for (const [daily, , , closes, period] of ordinary) {
      const rv = realizedVolatility(closes, { period, annualize: 252 })
      expect(rv.daily, `daily for period ${period}`).toBe(daily)
    }
  })

  it("publishes the very same annual figures, including above 100% annualized", () => {
    for (const [, annual, , closes, period] of ordinary) {
      const rv = realizedVolatility(closes, { period, annualize: 252 })
      expect(rv.annual, `annual for period ${period}`).toBe(annual)
    }
  })

  it("publishes the very same percentage strings", () => {
    for (const [, , pct, closes, period] of ordinary) {
      const rv = realizedVolatility(closes, { period, annualize: 252 })
      expect(rv.annualPct, `annualPct for period ${period}`).toBe(pct)
    }
  })

  it("publishes the very same figures from the OHLC estimators", () => {
    const candles = ohlcCandles(60, 0.3, 1)
    expect(parkinsonVolatility(candles, { period: 20, annualize: 252 }).daily).toBe(0.0135)
    expect(parkinsonVolatility(candles, { period: 20, annualize: 252 }).annualPct).toBe("21.42%")
    expect(garmanKlassVolatility(candles, { period: 20, annualize: 252 }).daily).toBe(0.0159)
    expect(garmanKlassVolatility(candles, { period: 20, annualize: 252 }).annualPct).toBe("25.16%")
    expect(yangZhangVolatility(candles, { period: 20, annualize: 252 }).daily).toBe(0.0158)
    expect(yangZhangVolatility(candles, { period: 20, annualize: 252 }).annualPct).toBe("25.12%")
  })

  it("keeps 4 significant figures exactly where 4 decimal places would destroy the figure", () => {
    // The band is not "rounded differently", it is rounded to a precision that
    // depends on magnitude: 4dp everywhere it survives, 4 significant figures
    // only in the band where 4dp would return the measurement's absence.
    const below = realizedVolatility(alternatingCloses(4e-5), { period: 20, annualize: 252 })
    expect(below.daily).toBeGreaterThan(0)
    expect(below.daily).toBeLessThan(0.0001) // still under the old floor
    expect(Number(below.daily.toPrecision(4))).toBe(below.daily)

    // Above the floor, the old precision still applies — the two schemes meet.
    const above = realizedVolatility(alternatingCloses(0.05), { period: 20, annualize: 252 })
    expect(above.daily).toBe(Math.round(above.daily * 10000) / 10000)
  })
})

describe("publication precision: null stays distinguishable from a measured zero", () => {
  it("keeps the three states apart in both directions", () => {
    // (1) NOT MEASURED — too few closes for the window. The keys `annualPct`
    // and `sampleSize` are ABSENT here, which is part of the distinction: the
    // measured branch always publishes them.
    const short = realizedVolatility(Array.from({ length: 20 }, (_, i) => 100 + i), { period: 20 })
    expect(short.annual).toBeNull()
    expect(short.daily).toBeNull()
    expect(short.annual).not.toBe(0)
    expect(short.annualPct).toBeUndefined()
    expect(short.sampleSize).toBeUndefined()

    // (2) MEASURED EXACTLY ZERO — a flat price series really does not move.
    const flatRv = realizedVolatility(Array.from({ length: 60 }, () => 100), { period: 20 })
    expect(flatRv.annual).toBe(0)
    expect(flatRv.daily).toBe(0)
    expect(flatRv.annual).not.toBeNull()
    expect(flatRv.annualPct).toBe("0%")
    expect(flatRv.sampleSize).toBe(59)

    // (3) The two are not the same value, in either direction of comparison.
    expect(flatRv.annual === short.annual).toBe(false)
  })

  it("a series that moved by 1e-5 does not publish the same number as one that never moved", () => {
    // The specific confusion this task exists to remove: before, both served `0`.
    const flatRv = realizedVolatility(Array.from({ length: 60 }, () => 100), { period: 20 })
    const movedRv = realizedVolatility(alternatingCloses(1e-5), { period: 20, annualize: 252 })
    expect(movedRv.annual).toBeGreaterThan(0)
    expect(movedRv.annual).not.toBe(flatRv.annual)
  })

  it("still refuses to measure rather than inventing a zero", () => {
    // The other half of the invariant: fixing precision must not have made the
    // function more willing to produce a number. Too few USABLE transitions
    // stays null even though the array is long enough.
    const mostlyNonPositive = Array.from({ length: 65 }, (_, i) => (i < 16 ? 0 : 100 + i * 0.05))
    const rv = realizedVolatility(mostlyNonPositive, { period: 60 })
    expect(rv.annual).toBeNull()
    expect(rv.daily).toBeNull()
  })

  // ─────────────────────────────────────────────────────────────────────
  // `volatilityPositionSize` PUBLISHES PERCENTAGES, AND HAD NO TEST FOR IT.
  //
  // `positionPct` (and its two siblings) went through `roundVolPct` in the
  // precision change and survived mutation with no coverage at all. The band is
  // reachable: `riskPct` of 1e-4 puts `positionValue / cap` at 2.5e-5, and 4dp
  // on that published `"0%"` — the identical defect `annualPct` had.
  // ─────────────────────────────────────────────────────────────────────
  it("volatilityPositionSize publishes a nonzero position as a nonzero percentage", () => {
    // capital 10000, riskPct 1e-4, volScale 0.4 (currentVol 0.50 / target 0.20)
    // => riskBudget 0.40, entryPrice 0.25 => units 1, positionValue 0.25.
    // positionValue/cap = 2.5e-5, which is inside the collapsed band: 4dp on it
    // returned `0`, so this field published `"0%"` before the rule was applied.
    const sized = volatilityPositionSize({
      capital: 10000,
      riskPct: 1e-4,
      currentVol: 0.5,
      targetVol: 0.20,
      entryPrice: 0.25
    })
    expect(sized.positionValue).toBe(0.25)
    expect(sized.positionPct).toBe("0.0025%")
    // The premise, asserted rather than assumed: the underlying fraction really
    // is one 4dp would erase, so the assertion above is a bite and not a
    // tautology.
    const fraction = sized.positionValue / 10000
    expect(fraction).toBeLessThan(5e-5)
    expect(Math.round(fraction * 10000) / 100).toBe(0)
  })

  it("volatilityPositionSize applies ONE percentage rule to all three percentage fields", () => {
    // M1: `positionPct` used `roundVolPct` while `currentVolPct` and
    // `targetVolPct` were left on raw `Math.round(v * 10000) / 100`, so one
    // object mixed two rules for the same job.
    //
    // WHAT THIS TEST CAN AND CANNOT SHOW, because getting that backwards is how
    // a passing suite ends up vouching for nothing:
    //
    //   CANNOT show the rules were unified. `vol` and `target` are both floored
    //   at 0.01, and `roundVolPct` only falls back below 5e-5, so on every
    //   reachable input the two rules agree. Reverting either field to raw 4dp
    //   is an EQUIVALENT MUTANT and survives; that is the floor, not a coverage
    //   hole. Asserting otherwise here would be a test that lies about what it
    //   holds down.
    //
    //   CAN show the equivalence still holds. That is the property worth
    //   pinning: if anyone lowers or removes the floor, raw-4dp and
    //   `roundVolPct` start to disagree (below 0.01 the former prints "0%" and
    //   the latter prints the real figure), and this test is what notices.
    const roundVolPct = (fraction) => {
      const pct = fraction * 100
      const fixed = Math.round(pct * 100) / 100
      if (fixed === 0 && fraction !== 0) return `${Number(pct.toPrecision(4))}%`
      return `${fixed}%`
    }
    const raw4dp = (v) => Math.round(v * 10000) / 100 + "%"

    // Sweep the reachable domain for both vol fields.
    for (let v = 0.01; v <= 3; v += 0.0001) {
      const floored = Math.max(0.01, v)
      expect(raw4dp(floored), `raw4dp vs roundVolPct at ${floored}`).toBe(roundVolPct(floored))
    }

    // And the object publishes all three through the one rule, with ordinary
    // figures unchanged by the unification.
    const s = volatilityPositionSize({
      capital: 10000,
      riskPct: 0.02,
      currentVol: 0.05,
      targetVol: 0.04,
      entryPrice: 100
    })
    for (const field of ["positionPct", "currentVolPct", "targetVolPct"]) {
      expect(typeof s[field], field).toBe("string")
      expect(s[field], field).toMatch(/%$/)
      expect(s[field], field).not.toBe("0%")
    }
    expect(s.currentVolPct).toBe(roundVolPct(0.05))
    expect(s.targetVolPct).toBe(roundVolPct(0.04))
    // 5% and 4% at 2dp are the same strings the raw formula produced, so the
    // unification is behaviour-preserving for every ordinary input.
    expect(s.currentVolPct).toBe("5%")
    expect(s.targetVolPct).toBe("4%")
  })
})
