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
 * The three states a per-asset volatility measurement can be in.
 *
 * Added because the allocator used to collapse all three into one number on the
 * wire. `measured-zero` in particular is a REAL measurement that must survive as
 * a real measurement — collapsing it into "no data" would be as dishonest as
 * the constant it replaced, just in the other direction.
 */
export const VOL_MEASURED = "measured"
export const VOL_MEASURED_ZERO = "measured-zero"
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
 *      path. The measurement exists; the rounding is what makes it falsy.
 *   3. `null` when the series yields fewer usable log returns than `period` —
 *      65 prices with 10 non-positive values gives `logReturns.length < 60`.
 *      Nothing was measured at all, and 20% was reported as though it had been.
 *
 * So the states are distinguished rather than collapsed:
 *   - `null`        -> `unmeasured`,  no volatility was computed. Reason named.
 *   - finite, `> 0` -> `measured`,    the only state that may be weighted by.
 *   - finite, `== 0`-> `measured-zero`, a real measurement of "no movement".
 *
 * A `measured-zero` asset gets no weight, because there is no volatility to
 * invert, and that exclusion is named in `volStatus` rather than being visible
 * only as a missing key.
 */
function measureVolatility(prices, window) {
  const rv = realizedVolatility(prices, { period: Math.min(window, prices.length - 1) })
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
    return {
      annual: 0,
      status: {
        state: VOL_MEASURED_ZERO,
        annual: 0,
        reason: "measured volatility is exactly 0 (or rounds to 0 at 4dp); a real measurement of no movement, so this asset cannot be inverse-vol weighted"
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
    const allZero = symbols.every((s) => volStatus[s].state === VOL_MEASURED_ZERO)
    return {
      ok: false,
      weights: {},
      vols,
      volStatus,
      error: allZero
        ? "every symbol's volatility was measured as exactly 0, so there is no risk to allocate against"
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

  // ERC method: build covariance matrix from returns
  const returnsMap = {}
  for (const s of symbols) {
    returnsMap[s] = logReturns(priceHistories[s].slice(-window))
  }

  const n = symbols.length
  const covMatrix = []
  for (let i = 0; i < n; i++) {
    const row = []
    for (let j = 0; j < n; j++) {
      if (i === j) {
        row.push(vols[symbols[i]] ? (vols[symbols[i]] / Math.sqrt(252)) ** 2 : 0.0001)
      } else {
        const ri = returnsMap[symbols[i]]
        const rj = returnsMap[symbols[j]]
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

  const result = equalRiskContribution(covMatrix, symbols)
  return {
    ok: true,
    ...result,
    vols,
    volStatus,
    symbolCount: symbols.length
  }
}
