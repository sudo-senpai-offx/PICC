// Portfolio analytics — correlation matrix, risk metrics, diversification scoring.

import { getHistory } from "./yahoo.mjs"

function dailyReturns(prices) {
  if (!prices || prices.length < 2) return []
  const out = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] && prices[i - 1] !== 0) {
      out.push((prices[i] - prices[i - 1]) / prices[i - 1])
    }
  }
  return out
}

function mean(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stdDev(arr) {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

function pearsonCorr(x, y) {
  const n = Math.min(x.length, y.length)
  if (n < 5) return 0
  const mx = mean(x.slice(0, n))
  const my = mean(y.slice(0, n))
  let num = 0, denX = 0, denY = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  const den = Math.sqrt(denX * denY)
  return den === 0 ? 0 : num / den
}

function sharpeRatio(returns, riskFreeRate = 0.04) {
  if (returns.length < 2) return 0
  const rfPerDay = riskFreeRate / 252
  const excessReturns = returns.map((r) => r - rfPerDay)
  const avgExcess = mean(excessReturns)
  const sd = stdDev(excessReturns)
  return sd === 0 ? 0 : (avgExcess / sd) * Math.sqrt(252)
}

function sortinoRatio(returns, riskFreeRate = 0.04) {
  if (returns.length < 2) return 0
  const rfPerDay = riskFreeRate / 252
  const excessReturns = returns.map((r) => r - rfPerDay)
  const avgExcess = mean(excessReturns)
  const downsideReturns = excessReturns.filter((r) => r < 0)
  if (downsideReturns.length === 0) return avgExcess > 0 ? 10 : 0
  const downsideDev = Math.sqrt(downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length)
  return downsideDev === 0 ? 0 : (avgExcess / downsideDev) * Math.sqrt(252)
}

function maxDrawdown(cumulativeReturns) {
  if (cumulativeReturns.length < 2) return 0
  let peak = cumulativeReturns[0]
  let maxDD = 0
  for (const val of cumulativeReturns) {
    if (val > peak) peak = val
    const dd = (peak - val) / peak
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

function valueAtRisk(returns, confidence = 0.95) {
  if (returns.length < 5) return 0
  const sorted = [...returns].sort((a, b) => a - b)
  const idx = Math.floor((1 - confidence) * sorted.length)
  return sorted[Math.max(0, idx)]
}

function cumulativeReturns(returns) {
  const cumulative = [1]
  for (const r of returns) {
    cumulative.push(cumulative[cumulative.length - 1] * (1 + r))
  }
  return cumulative
}

function portfolioReturns(weights, returnsArrays) {
  const n = Math.min(...returnsArrays.map((r) => r.length))
  if (n < 1) return []
  const result = []
  for (let i = 0; i < n; i++) {
    let dayReturn = 0
    for (let j = 0; j < weights.length; j++) {
      dayReturn += weights[j] * (returnsArrays[j][i] || 0)
    }
    result.push(dayReturn)
  }
  return result
}

export async function computePortfolioAnalytics({ symbols, weights: inputWeights, days = 90 }) {
  const assets = []
  for (const sym of symbols) {
    try {
      const hist = await getHistory(String(sym).toUpperCase(), days)
      if (hist && hist.closes && hist.closes.length >= 10) {
        const returns = dailyReturns(hist.closes)
        assets.push({
          symbol: String(sym).toUpperCase(),
          prices: hist.closes,
          returns,
          lastPrice: hist.closes[hist.closes.length - 1],
          change24h: hist.closes.length >= 2 ? (hist.closes[hist.closes.length - 1] - hist.closes[hist.closes.length - 2]) / hist.closes[hist.closes.length - 2] : 0
        })
      }
    } catch { /* skip */ }
  }

  if (assets.length === 0) return null

  const n = assets.length
  const weights = inputWeights && inputWeights.length === n
    ? inputWeights.map((w) => w / inputWeights.reduce((a, b) => a + b, 0))
    : Array(n).fill(1 / n)

  // Correlation matrix
  const corrMatrix = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    corrMatrix[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const r = pearsonCorr(assets[i].returns, assets[j].returns)
      corrMatrix[i][j] = Math.round(r * 1000) / 1000
      corrMatrix[j][i] = corrMatrix[i][j]
    }
  }

  // Portfolio returns
  const pReturns = portfolioReturns(weights, assets.map((a) => a.returns))
  const pCumReturns = cumulativeReturns(pReturns)

  // Risk metrics
  const totalReturn = pCumReturns.length >= 2 ? pCumReturns[pCumReturns.length - 1] / pCumReturns[0] - 1 : 0
  const annualizedReturn = totalReturn * (252 / Math.max(pReturns.length, 1))

  const metrics = {
    sharpeRatio: Math.round(sharpeRatio(pReturns) * 100) / 100,
    sortinoRatio: Math.round(sortinoRatio(pReturns) * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown(pCumReturns) * 10000) / 100,
    valueAtRisk95: Math.round(valueAtRisk(pReturns, 0.95) * 10000) / 100,
    stdDev: Math.round(stdDev(pReturns) * Math.sqrt(252) * 10000) / 100,
    totalReturn: Math.round(totalReturn * 10000) / 100,
    annualizedReturn: Math.round(annualizedReturn * 10000) / 100,
    beta: 0 // will be computed if SPY is in assets
  }

  // Average correlation (diversification indicator)
  let corrSum = 0, corrCount = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      corrSum += Math.abs(corrMatrix[i][j])
      corrCount++
    }
  }
  const avgCorrelation = corrCount > 0 ? corrSum / corrCount : 0

  // Diversification score (0-100)
  // Lower average correlation = more diversified
  // More assets = better diversification
  const corrScore = Math.round((1 - avgCorrelation) * 60) // 0-60 points from correlation
  const assetScore = Math.min(n * 5, 40) // 0-40 points from asset count (max 8 assets)
  const diversificationScore = Math.min(corrScore + assetScore, 100)

  // Weights breakdown
  const allocation = assets.map((a, i) => ({
    symbol: a.symbol,
    weight: Math.round(weights[i] * 10000) / 100,
    lastPrice: a.lastPrice,
    change24h: Math.round(a.change24h * 10000) / 100,
    dailyReturnVol: Math.round(stdDev(a.returns) * Math.sqrt(252) * 10000) / 100
  }))

  return {
    assets: allocation,
    weights,
    corrMatrix,
    metrics,
    diversificationScore,
    avgCorrelation: Math.round(avgCorrelation * 1000) / 1000,
    equityCurve: pCumReturns.slice(-60).map((v) => Math.round(v * 10000) / 10000),
    assetCount: n,
    days
  }
}
