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
    return { weights: {}, riskContributions: [], portfolioVol: 0 }
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

  if (symbols.length === 1) {
    return { ok: true, weights: { [symbols[0]]: 1 }, method: "single-asset", portfolioVol: 0 }
  }

  // Compute volatilities
  const vols = {}
  for (const s of symbols) {
    const prices = priceHistories[s]
    const rv = realizedVolatility(prices, { period: Math.min(window, prices.length - 1) })
    vols[s] = rv.annual || 0.20
  }

  if (method === "inverse-vol") {
    const { weights } = inverseVolWeights(vols)
    return {
      ok: true,
      weights,
      vols,
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
    symbolCount: symbols.length
  }
}
