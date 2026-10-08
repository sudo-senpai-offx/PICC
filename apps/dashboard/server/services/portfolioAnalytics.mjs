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
  if (!arr || arr.length === 0) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stdDev(arr) {
  if (!arr || arr.length < 2) return null
  const m = mean(arr)
  if (m === null) return null
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

function pearsonCorr(x, y) {
  if (!x || !y) return null
  const n = Math.min(x.length, y.length)
  if (n < 5) return null
  const mx = mean(x.slice(0, n))
  const my = mean(y.slice(0, n))
  if (mx === null || my === null) return null
  let num = 0, denX = 0, denY = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  const den = Math.sqrt(denX * denY)
  return den === 0 ? null : num / den
}

function sharpeRatio(returns, riskFreeRate = 0.04) {
  if (!returns || returns.length < 2) return null
  const rfPerDay = riskFreeRate / 252
  const excessReturns = returns.map((r) => r - rfPerDay)
  const avgExcess = mean(excessReturns)
  const sd = stdDev(excessReturns)
  if (avgExcess === null || sd === null) return null
  return sd === 0 ? null : (avgExcess / sd) * Math.sqrt(252)
}

function sortinoRatio(returns, riskFreeRate = 0.04) {
  if (!returns || returns.length < 2) return null
  const rfPerDay = riskFreeRate / 252
  const excessReturns = returns.map((r) => r - rfPerDay)
  const avgExcess = mean(excessReturns)
  if (avgExcess === null) return null
  const downsideReturns = excessReturns.filter((r) => r < 0)
  if (downsideReturns.length === 0) return null
  const downsideDev = Math.sqrt(downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length)
  return downsideDev === 0 ? null : (avgExcess / downsideDev) * Math.sqrt(252)
}

function maxDrawdown(cumulativeReturns) {
  if (!cumulativeReturns || cumulativeReturns.length < 2) return null
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
  if (!returns || returns.length < 5) return null
  const sorted = [...returns].sort((a, b) => a - b)
  const idx = Math.floor((1 - confidence) * sorted.length)
  return sorted[Math.max(0, idx)]
}

// Named exports for the pure stat helpers (additive; lets tests pin null-honesty
// without network). Formulas for sufficient data are byte-identical to before.
export { mean, stdDev, pearsonCorr, sharpeRatio, sortinoRatio, maxDrawdown, valueAtRisk }

// Null-propagating rounder: insufficient-data nulls stay null through formatting.
function roundOrNull(value, factor) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return Math.round(value * factor) / factor
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

  // Correlation matrix (null = abstain: too few points or zero variance)
  const corrMatrix = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    corrMatrix[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const r = pearsonCorr(assets[i].returns, assets[j].returns)
      const rounded = r === null ? null : Math.round(r * 1000) / 1000
      corrMatrix[i][j] = rounded
      corrMatrix[j][i] = rounded
    }
  }

  // Portfolio returns
  const pReturns = portfolioReturns(weights, assets.map((a) => a.returns))
  const pCumReturns = cumulativeReturns(pReturns)

  // Risk metrics (null = abstain on insufficient data, never 0)
  const rawSharpe = sharpeRatio(pReturns)
  const rawSortino = sortinoRatio(pReturns)
  const rawMaxDD = maxDrawdown(pCumReturns)
  const rawVaR = valueAtRisk(pReturns, 0.95)
  const rawSd = stdDev(pReturns)
  const totalReturn = pCumReturns.length >= 2 ? pCumReturns[pCumReturns.length - 1] / pCumReturns[0] - 1 : null
  const annualizedReturn = totalReturn === null ? null : totalReturn * (252 / Math.max(pReturns.length, 1))

  const metrics = {
    sharpeRatio: roundOrNull(rawSharpe, 100),
    sortinoRatio: roundOrNull(rawSortino, 100),
    maxDrawdown: roundOrNull(rawMaxDD === null ? null : rawMaxDD * 100, 100),
    valueAtRisk95: roundOrNull(rawVaR === null ? null : rawVaR * 100, 100),
    stdDev: roundOrNull(rawSd === null ? null : rawSd * Math.sqrt(252) * 100, 100),
    totalReturn: roundOrNull(totalReturn === null ? null : totalReturn * 100, 100),
    annualizedReturn: roundOrNull(annualizedReturn === null ? null : annualizedReturn * 100, 100),
    beta: null // not computed (no market leg observed) — abstain, never 0
  }

  // Average correlation (diversification indicator; null when no pair observable)
  let corrSum = 0, corrCount = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = corrMatrix[i][j]
      if (c === null || c === undefined) continue
      corrSum += Math.abs(c)
      corrCount++
    }
  }
  const avgCorrelation = corrCount > 0 ? corrSum / corrCount : null

  // Diversification score (0-100); null when correlation unobservable
  // Lower average correlation = more diversified
  // More assets = better diversification
  const diversificationScore = avgCorrelation === null
    ? null
    : Math.min(Math.round((1 - avgCorrelation) * 60) + Math.min(n * 5, 40), 100)

  // Weights breakdown
  const allocation = assets.map((a, i) => {
    const assetSd = stdDev(a.returns)
    return {
      symbol: a.symbol,
      weight: Math.round(weights[i] * 10000) / 100,
      lastPrice: a.lastPrice,
      change24h: Math.round(a.change24h * 10000) / 100,
      dailyReturnVol: roundOrNull(assetSd === null ? null : assetSd * Math.sqrt(252) * 100, 100)
    }
  })

  return {
    assets: allocation,
    weights,
    corrMatrix,
    metrics,
    diversificationScore,
    avgCorrelation: roundOrNull(avgCorrelation, 1000),
    equityCurve: pCumReturns.slice(-60).map((v) => Math.round(v * 10000) / 10000),
    assetCount: n,
    days
  }
}

// Stress test — simulate portfolio under shock scenarios
export function stressTest(weights, assets, scenarios = null) {
  const defaultScenarios = [
    { name: "USD Crashes -5%", shocks: { USD: -0.05, EUR: 0.03, GBP: 0.03, JPY: 0.04, GOLD: 0.08, BTCUSD: 0.10, ETHUSD: 0.12 } },
    { name: "Risk-Off Crash -10%", shocks: { AAPL: -0.10, MSFT: -0.10, GOOGL: -0.12, AMZN: -0.11, TSLA: -0.15, NVDA: -0.14, META: -0.10, BTCUSD: -0.20, ETHUSD: -0.22, GOLD: 0.05 } },
    { name: "Rate Hike -200bp", shocks: { AAPL: -0.05, MSFT: -0.04, TSLA: -0.08, NVDA: -0.06, BTCUSD: -0.10, GOLD: -0.03, EURUSD: -0.02, GBPUSD: -0.02 } },
    { name: "Inflation Spike", shocks: { GOLD: 0.12, OIL: 0.15, NATGAS: 0.20, AAPL: -0.03, TSLA: -0.05, EURUSD: -0.01 } },
    { name: "Flash Crash -3%", shocks: { AAPL: -0.03, MSFT: -0.03, GOOGL: -0.03, AMZN: -0.03, TSLA: -0.05, BTCUSD: -0.08, ETHUSD: -0.10, GOLD: 0.01, EURUSD: -0.005 } },
    { name: "Crypto Winter -30%", shocks: { BTCUSD: -0.30, ETHUSD: -0.35, SOLUSD: -0.40, ADAUSD: -0.35 } },
    { name: "Geopolitical Shock", shocks: { GOLD: 0.10, OIL: 0.20, NATGAS: 0.15, EURUSD: -0.03, GBPUSD: -0.04, AAPL: -0.04, TSLA: -0.06 } }
  ]

  const sc = scenarios || defaultScenarios
  const results = []

  for (const scenario of sc) {
    let portfolioImpact = 0
    const assetImpacts = []

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]
      const shock = scenario.shocks[asset.symbol] ?? 0
      const impact = weights[i] * shock
      portfolioImpact += impact
      assetImpacts.push({ symbol: asset.symbol, weight: Math.round(weights[i] * 10000) / 100, shock: Math.round(shock * 10000) / 100, impact: Math.round(impact * 10000) / 100 })
    }

    results.push({
      name: scenario.name,
      portfolioImpact: Math.round(portfolioImpact * 10000) / 100,
      assetImpacts
    })
  }

  // Sort by worst impact
  results.sort((a, b) => a.portfolioImpact - b.portfolioImpact)

  return {
    scenarios: results,
    worstCase: results[0],
    bestCase: results[results.length - 1],
    avgImpact: Math.round(results.reduce((s, r) => s + r.portfolioImpact, 0) / results.length * 100) / 100
  }
}
