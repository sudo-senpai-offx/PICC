// PICC Correlation Service — standalone correlation matrix and diversification
// scoring. Uses Pearson correlation on log returns to measure pairwise asset
// co-movement for portfolio construction and risk monitoring.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ---------------------------------------------------------------------
// Log returns from price series
// ---------------------------------------------------------------------

function logReturns(prices) {
  const out = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      out.push(Math.log(prices[i] / prices[i - 1]))
    }
  }
  return out
}

function mean(arr) {
  const a = arr.filter((x) => Number.isFinite(x))
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
}

// ---------------------------------------------------------------------
// Pearson correlation
// ---------------------------------------------------------------------

export function pearsonCorrelation(x, y) {
  const minLen = Math.min(x.length, y.length)
  if (minLen < 3) return null
  const ax = x.slice(0, minLen).filter((v) => Number.isFinite(v))
  const ay = y.slice(0, minLen).filter((v) => Number.isFinite(v))
  const n = Math.min(ax.length, ay.length)
  if (n < 3) return null
  const mx = ax.reduce((s, v) => s + v, 0) / n
  const my = ay.reduce((s, v) => s + v, 0) / n
  let sumXY = 0, sumX2 = 0, sumY2 = 0
  for (let i = 0; i < n; i++) {
    const dx = ax[i] - mx
    const dy = ay[i] - my
    sumXY += dx * dy
    sumX2 += dx * dx
    sumY2 += dy * dy
  }
  const denom = Math.sqrt(sumX2 * sumY2)
  if (denom < 1e-15) return 0
  return Math.round((sumXY / denom) * 10000) / 10000
}

// ---------------------------------------------------------------------
// Correlation matrix
// ---------------------------------------------------------------------

export function correlationMatrix(priceHistories) {
  const symbols = Object.keys(priceHistories).filter(
    (s) => Array.isArray(priceHistories[s]) && priceHistories[s].length >= 10
  )
  if (symbols.length === 0) return { symbols: [], matrix: [], ok: false }
  const returnsMap = {}
  for (const s of symbols) {
    returnsMap[s] = logReturns(priceHistories[s])
  }
  const n = symbols.length
  const matrix = []
  for (let i = 0; i < n; i++) {
    const row = []
    for (let j = 0; j < n; j++) {
      if (i === j) {
        row.push(1)
      } else if (j < i) {
        row.push(matrix[j][i])
      } else {
        row.push(pearsonCorrelation(returnsMap[symbols[i]], returnsMap[symbols[j]]) ?? 0)
      }
    }
    matrix.push(row)
  }
  return { symbols, matrix, ok: true }
}

// ---------------------------------------------------------------------
// Pairwise correlation (flat list)
// ---------------------------------------------------------------------

export function pairwiseCorrelation(priceHistories) {
  const { symbols, matrix, ok } = correlationMatrix(priceHistories)
  if (!ok) return []
  const pairs = []
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      pairs.push({
        asset1: symbols[i],
        asset2: symbols[j],
        correlation: matrix[i][j]
      })
    }
  }
  return pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
}

// ---------------------------------------------------------------------
// Highly correlated pairs
// ---------------------------------------------------------------------

export function highlyCorrelated(priceHistories, threshold = 0.8) {
  return pairwiseCorrelation(priceHistories).filter(
    (p) => Math.abs(p.correlation) >= threshold
  )
}

// ---------------------------------------------------------------------
// Diversification score
// ---------------------------------------------------------------------

/**
 * Portfolio diversification score (0-1). Measures how well-correlated assets
 * cancel each other's risk. 1 = perfectly uncorrelated, 0 = perfectly correlated.
 *
 * @param {number[]} weights - Portfolio weights (should sum to ~1)
 * @param {number[][]} corrMatrix - N×N correlation matrix
 * @returns {number} Score 0-1
 */
export function diversificationScore(weights, corrMatrix) {
  const n = weights.length
  if (n === 0 || !Array.isArray(corrMatrix) || corrMatrix.length !== n) return 0
  const w = weights.filter((x) => Number.isFinite(x))
  if (w.length !== n) return 0
  const sumW = w.reduce((s, x) => s + x, 0)
  if (sumW <= 0) return 0
  const nw = w.map((x) => x / sumW)

  // Portfolio variance with correlations
  let portVar = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      portVar += nw[i] * nw[j] * (corrMatrix[i]?.[j] ?? (i === j ? 1 : 0))
    }
  }
  // Average pairwise correlation (excl diagonal)
  let sumCorr = 0, count = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sumCorr += corrMatrix[i]?.[j] ?? 0
      count++
    }
  }
  const avgCorr = count > 0 ? sumCorr / count : 0

  // Diversification ratio: lower avg correlation = higher score
  // Also penalize very concentrated portfolios
  const concentration = nw.reduce((s, x) => s + x * x, 0) // HHI
  const concScore = 1 - concentration // higher = more diversified
  const corrScore = 1 - clamp((avgCorr + 1) / 2, 0, 1) // invert: corr=1 → score=0

  return Math.round((concScore * 0.4 + corrScore * 0.6) * 10000) / 10000
}
