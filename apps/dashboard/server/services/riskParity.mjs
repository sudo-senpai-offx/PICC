// PICC Risk Parity Service — multi-asset portfolio allocation that equalizes
// risk contribution across assets. Uses volatility scaling and correlation
// matrix to compute inverse-volatility or full risk-parity weights.

import { realizedVolatility } from "./volatility.mjs"

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function logReturns(prices) {
  const out = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      out.push(Math.log(prices[i] / prices[i - 1]))
    }
  }
  return out
}

// ---------------------------------------------------------------------
// Inverse-volatility weighting (simple risk parity)
// ---------------------------------------------------------------------

/**
 * Compute inverse-volatility weights. Each asset's weight is proportional
 * to 1/sigma, so risk contribution is approximately equal.
 *
 * @param {Object} assetVols - { symbol: annualizedVol }
 * @returns {{ weights: Object, method: string }}
 */
export function inverseVolWeights(assetVols) {
  const entries = Object.entries(assetVols).filter(([, v]) => Number.isFinite(v) && v > 0)
  if (!entries.length) return { weights: {}, method: "inverse-vol" }
  const invVols = entries.map(([sym, vol]) => ({ sym, inv: 1 / vol }))
  const totalInv = invVols.reduce((s, x) => s + x.inv, 0)
  const weights = {}
  for (const { sym, inv } of invVols) {
    weights[sym] = Math.round((inv / totalInv) * 10000) / 10000
  }
  return { weights, method: "inverse-vol" }
}

// ---------------------------------------------------------------------
// Full risk parity (Equal Risk Contribution / ERC)
// ---------------------------------------------------------------------

/**
 * Equal Risk Contribution portfolio. Iteratively adjusts weights so each
 * asset contributes the same total risk.
 *
 * @param {number[][]} covMatrix - NxN covariance matrix
 * @param {string[]} symbols - Asset labels
 * @param {number} iterations - Solver iterations
 * @returns {{ weights, riskContributions, portfolioVol }}
 */
export function equalRiskContribution(covMatrix, symbols, iterations = 500) {
  const n = symbols.length
  if (n === 0 || !Array.isArray(covMatrix) || covMatrix.length !== n) {
    // `portfolioVol: 0` here was a LITERAL for "I could not compute anything",
    // and it is the most dangerous direction for that field to lie in: a risk
    // number reading as "no risk". It is `null` now — an absence — and the
    // refusal is legible without a second guess because `ok` and `reason` say
    // so. A measured zero is still 0 further down: a degenerate covariance
    // matrix of the right shape can genuinely measure zero volatility, and that
    // 0 must keep printing as 0.
    const why =
      n === 0
        ? "no symbols were supplied, so there is no covariance matrix to solve"
        : !Array.isArray(covMatrix)
          ? "covMatrix is not an array, so no portfolio variance can be computed"
          : `covMatrix has ${covMatrix.length} row(s) for ${n} symbol(s); the shapes must match`
    return { weights: {}, riskContributions: [], portfolioVol: null, ok: false, reason: why }
  }

  let w = new Array(n).fill(1 / n)

  for (let iter = 0; iter < iterations; iter++) {
    let portVar = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        portVar += w[i] * w[j] * (covMatrix[i]?.[j] ?? 0)
      }
    }
    const portVol = Math.sqrt(Math.max(portVar, 1e-12))

    const marginalRisk = []
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let j = 0; j < n; j++) {
        sum += (covMatrix[i]?.[j] ?? 0) * w[j]
      }
      marginalRisk.push(sum / portVol)
    }

    const riskContrib = w.map((wi, i) => wi * marginalRisk[i])
    const totalRC = riskContrib.reduce((s, x) => s + x, 0) || 1
    const targetRC = totalRC / n

    const lr = 0.5 / (iter + 1)
    const newW = w.map((wi, i) => {
      const adjustment = targetRC / Math.max(riskContrib[i], 1e-12)
      return Math.max(1e-6, wi * (1 + lr * (adjustment - 1)))
    })
    const sumW = newW.reduce((s, x) => s + x, 0)
    w = newW.map((wi) => wi / sumW)
  }

  let portVar = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      portVar += w[i] * w[j] * (covMatrix[i]?.[j] ?? 0)
    }
  }
  const portVol = Math.sqrt(Math.max(portVar, 1e-12))

  const marginalRisk = []
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) {
      sum += (covMatrix[i]?.[j] ?? 0) * w[j]
    }
    marginalRisk.push(sum / portVol)
  }
  const riskContributions = w.map((wi, i) => Math.round(wi * marginalRisk[i] * 1e6) / 1e6)
  const totalRC = riskContributions.reduce((s, x) => s + x, 0) || 1

  const weights = {}
  const details = []
  for (let i = 0; i < n; i++) {
    weights[symbols[i]] = Math.round(w[i] * 10000) / 10000
    details.push({
      symbol: symbols[i],
      weight: Math.round(w[i] * 10000) / 10000,
      riskContribution: Math.round((riskContributions[i] / totalRC) * 10000) / 100 + "%"
    })
  }

  return {
    weights,
    riskContributions: details,
    portfolioVol: Math.round(portVol * 10000) / 10000,
    portfolioVolPct: Math.round(portVol * 10000) / 100 + "%",
    method: "equal-risk-contribution",
    iterations
  }
}

// ---------------------------------------------------------------------
// Full risk parity allocation from price series
// ---------------------------------------------------------------------

/**
 * The states a per-asset volatility measurement can be in.
 *
 * Added because the allocator used to collapse all of them into one number on
 * the wire. `measured-zero` in particular is a REAL measurement that must
 * survive as a real measurement — collapsing it into "no data" would be as
 * dishonest as the constant it replaced, just in the opposite direction.
 *
 * There are FOUR, because a published `0` has two genuinely different causes
 * and the earlier three-state version called both of them "no movement". That
 * claim is false for the rounding case, and it is not an exotic shape: one
 * spike among N-1 flat prices gives a standard deviation proportional to
 * 1/sqrt(N), so a LONGER history makes the 4dp floor easier to fall under, not
 * harder. Measured at window 60, a single one-bar tick of 1e-3 in an otherwise
 * flat series publishes `annual: 0` at 70, 200 and 1000 bars alike — the shape
 * behind it being a thinly-traded instrument that prints one tick per 200 days,
 * which is told it carries no movement when it plainly does.
 */
export const VOL_MEASURED = "measured"
export const VOL_MEASURED_ZERO = "measured-zero"
export const VOL_MEASURED_ROUNDED_ZERO = "measured-rounded-zero"
export const VOL_UNMEASURED = "unmeasured"

/**
 * Measure one asset's annualised volatility, and record what the measurement
 * actually was.
 *
 * ── WHY `rv.annual` IS NEVER COERCED ──
 *
 * The allocator used to say `vols[s] = rv.annual || 0.20`, and the `||` was not
 * defensive programming: `rv.annual` IS falsy in three reachable ways, and each
 * one substituted an INVENTED 20% straight into inverse-volatility weights,
 * which then produced numbers that read as measured allocations. Measured, not
 * assumed, in this order of severity:
 *
 *   1. `0` from a genuinely FLAT series. A flat price series has a volatility
 *      of exactly zero, and `0 || 0.20` is 0.20. This is the worst of the three
 *      because it is not a missing measurement that got filled in — it is a
 *      REAL measurement that got REPLACED, and the response then reported a risk
 *      level that had never been observed. Three flat symbols used to return
 *      `vols = {A: 0.2, B: 0.2, C: 0.2}` with equal weights: three riskless
 *      assets presented as carrying 20% each.
 *   2. `0` from ROUNDING. `realizedVolatility` rounds `annual` to 4dp, so a real
 *      but tiny volatility (daily ~1e-7) rounds to exactly 0 and takes the same
 *      path. The measurement exists and is NON-ZERO; the published precision is
 *      what destroys it, so this is a PRECISION limit and not "no movement".
 *   3. `null` when the series yields fewer usable log returns than `period` —
 *      65 prices with 10 non-positive values gives `logReturns.length < 60`.
 *      Nothing was measured at all, and 20% was reported as though it had been.
 *
 * So the states are distinguished rather than collapsed:
 *   - `null`                 -> `unmeasured`,          nothing was computed.
 *   - finite, `> 0`          -> `measured`,            the only weightable state.
 *   - finite, `== 0`, flat   -> `measured-zero`,        a real measurement of no movement.
 *   - finite, `== 0`, moving -> `measured-rounded-zero`, non-zero but below 0.00005.
 *
 * The last two both carry a PUBLISHED 0, so both are excluded from inverse-vol
 * weighting — there is no published volatility to invert, and that exclusion is
 * named in `volStatus` rather than visible only as a missing key. What they no
 * longer do is assert that the asset does not move.
 */
function measureVolatility(prices, window) {
  const period = Math.min(window, prices.length - 1)
  const rv = realizedVolatility(prices, { period })
  const annual = rv.annual
  if (annual == null) {
    return {
      annual: null,
      status: {
        state: VOL_UNMEASURED,
        annual: null,
        reason: "realizedVolatility returned no annual figure: too few usable positive-price transitions for the requested period"
      }
    }
  }
  if (!(annual > 0)) {
    // A published 0 has TWO causes, and only one of them is "no movement".
    // Discriminating them needs no new maths: `realizedVolatility` selects its
    // sample with the same `positive-price-transition` filter this module's own
    // `logReturns` applies, so re-running it here reproduces exactly the sample
    // that produced the 0. If every log return in that sample is exactly 0, the
    // series really did not move and the 0 is a real measurement. If any of them
    // is non-zero, the computed standard deviation was positive and the 4dp
    // publication destroyed it — the same rounding that `volatility.mjs:68`
    // applies repo-wide, inherited here rather than re-performed.
    const sample = logReturns(prices).slice(-period)
    const genuinelyFlat = sample.length > 0 && sample.every((r) => r === 0)
    if (genuinelyFlat) {
      return {
        annual: 0,
        status: {
          state: VOL_MEASURED_ZERO,
          annual: 0,
          reason:
            "measured volatility is exactly 0: every positive-price transition in the window is identical, so this is a real measurement of no movement and there is no volatility to invert"
        }
      }
    }
    return {
      annual: 0,
      status: {
        state: VOL_MEASURED_ROUNDED_ZERO,
        annual: 0,
        reason:
          "the annualized volatility rounds to 0 at the published 4dp precision: the price series does move inside the window, but the computed figure is below 0.00005, so it publishes as 0 without being a measurement of no movement"
      }
    }
  }
  return { annual, status: { state: VOL_MEASURED, annual, reason: null } }
}

/**
 * Compute risk-parity allocation for multiple assets.
 *
 * @param {Object} priceHistories - { symbol: number[] } closing prices
 * @param {Object} opts - { window, method: "inverse-vol"|"erc" }
 * @returns {Object} Allocation weights + diagnostics
 */
export function riskParityAllocation(priceHistories, { window = 60, method = "inverse-vol" } = {}) {
  const symbols = Object.keys(priceHistories).filter(
    (s) => Array.isArray(priceHistories[s]) && priceHistories[s].length >= window + 5
  )
  if (symbols.length === 0) {
    return { ok: false, error: "no symbols with sufficient data", weights: {} }
  }

  // Measure BEFORE branching on the symbol count, because the single-asset
  // branch used to return a portfolioVol of 0 without having measured anything,
  // and it can only report a real answer if it has measured first.
  const vols = {}
  const volStatus = {}
  for (const s of symbols) {
    const { annual, status } = measureVolatility(priceHistories[s], window)
    vols[s] = annual
    volStatus[s] = status
  }
  const measurable = symbols.filter((s) => volStatus[s].state === VOL_MEASURED)

  // ── THE REFUSAL THE CONSTANT WAS HIDING ──
  //
  // With the invented 20% removed, "no symbol has a usable volatility" would
  // fall through to `inverseVolWeights` and return `ok: true` with an EMPTY
  // weight map — a confident allocation over nothing, which is the same defect
  // with the sign flipped. Measured before this line existed, it returned
  // `ok: true, weights: {A: 0.5, B: 0.5}, vols: {A: 0.2, B: 0.2}` for two series
  // from which no volatility could be computed at all.
  if (measurable.length === 0) {
    // TWO REFUSALS, because the measurements behind them are two different
    // facts. "Every symbol published 0" and "no symbol published anything" are
    // not the same statement about the portfolio, and the earlier
    // `/volatil/i` assertion was satisfied by both — which is why collapsing
    // this ternary to one constant kept every test green.
    //
    // A `measured-rounded-zero` counts toward "published 0", not toward
    // "measured as no movement": the portfolio's published volatilities are all
    // zero, which is true, and saying so is the honest answer.
    const allPublishedZero = symbols.every(
      (s) => volStatus[s].state === VOL_MEASURED_ZERO || volStatus[s].state === VOL_MEASURED_ROUNDED_ZERO
    )
    return {
      ok: false,
      weights: {},
      vols,
      volStatus,
      error: allPublishedZero
        ? "every symbol's published annual volatility is 0 — measured as exactly 0, or a real non-zero figure rounded to 0 at the published 4dp precision — so there is no risk to allocate against"
        : "no symbol has a measurable volatility"
    }
  }

  if (symbols.length === 1) {
    // A single-asset portfolio has no allocation to compute, so there is no
    // covariance to build and nothing for a PORTFOLIO volatility to be a
    // measurement OF. The old `portfolioVol: 0` was therefore not a weak
    // measurement — it was not a measurement at all, in the one field where a
    // fabricated "no risk" is most dangerous. It is now `null`, with a reason,
    // and the asset's own measured volatility is preserved in `vols` so the
    // caller loses nothing by it.
    return {
      ok: true,
      weights: { [symbols[0]]: 1 },
      method: "single-asset",
      portfolioVol: null,
      portfolioVolPct: null,
      vols,
      volStatus,
      reason: "single-asset portfolio: no covariance is built, so no portfolio volatility is computed; the asset's own measured volatility is in vols"
    }
  }

  if (method === "inverse-vol") {
    const { weights } = inverseVolWeights(vols)
    return {
      ok: true,
      weights,
      vols,
      volStatus,
      method: "inverse-vol",
      symbolCount: symbols.length
    }
  }

  // ERC method: build covariance matrix from returns.
  //
  // ── A SEVENTH INSTANCE OF THE SAME CLASS, ONE LEVEL DOWN ──
  //
  // The diagonal used to be
  //
  //     row.push(vols[symbols[i]] ? (vols[symbols[i]] / Math.sqrt(252)) ** 2 : 0.0001)
  //
  // and `0.0001` is an INVENTED daily variance — 63% annualised, from nothing.
  // It is reachable through exactly one route, because the refusal above means
  // every symbol reaching here has either a positive published volatility or a
  // published ZERO: so the fallback fires only for a symbol whose volatility was
  // measured and publishes as 0. Measured at window 60, one 1e-3 tick in a
  // 200-bar otherwise-flat series alongside two ordinary symbols returns
  //
  //     weights: { A: 0.4911, B: 0.213, C: 0.2959 }     <- A is the LARGEST
  //
  // so the one asset whose published risk is lowest was handed the biggest
  // allocation, out of a constant, and the response read as a measurement.
  //
  // `inverseVolWeights` above already solved this exact problem by DROPPING a
  // symbol it cannot weight, rather than inventing one for it. The ERC branch
  // now does the same thing rather than the opposite: a symbol with no positive
  // PUBLISHED volatility is excluded from the matrix, and the drop is visible
  // through `symbolCount` (which still counts everything asked for) against the
  // weights actually returned — which is the mismatch the panel already renders.
  // No required-key or type change: `symbolCount` and `weights` keep their
  // shapes, and `vols`/`volStatus` still carry the excluded symbol.
  const erceSymbols = symbols.filter((s) => volStatus[s].state === VOL_MEASURED)
  const returnsMap = {}
  for (const s of erceSymbols) {
    returnsMap[s] = logReturns(priceHistories[s].slice(-window))
  }

  const n = erceSymbols.length
  const covMatrix = []
  for (let i = 0; i < n; i++) {
    const row = []
    for (let j = 0; j < n; j++) {
      if (i === j) {
        row.push((vols[erceSymbols[i]] / Math.sqrt(252)) ** 2)
      } else {
        const ri = returnsMap[erceSymbols[i]]
        const rj = returnsMap[erceSymbols[j]]
        const minLen = Math.min(ri.length, rj.length)
        if (minLen < 5) {
          row.push(0)
        } else {
          const mi = ri.slice(0, minLen).reduce((s, x) => s + x, 0) / minLen
          const mj = rj.slice(0, minLen).reduce((s, x) => s + x, 0) / minLen
          let cov = 0
          for (let k = 0; k < minLen; k++) {
            cov += (ri[k] - mi) * (rj[k] - mj)
          }
          row.push(cov / (minLen - 1))
        }
      }
    }
    covMatrix.push(row)
  }

  const result = equalRiskContribution(covMatrix, erceSymbols)
  return {
    ok: true,
    ...result,
    vols,
    volStatus,
    // Everything ASKED for, against a weights map that may be smaller: the gap
    // is what makes the exclusion visible rather than silent. See the mismatch
    // line the panel renders when the two disagree.
    symbolCount: symbols.length
  }
}
