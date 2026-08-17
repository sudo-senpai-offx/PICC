// Server-side Monte Carlo projection engine (mirrors the client fallback
// in src/lib/monteCarlo.ts but accepts real drift/vol from market data).
// Supports optional monthly contributions (DCA), inflation-adjusted
// projections, and path-level drawdown / win-rate statistics.

export function runMonteCarlo({
  capital,
  horizonYears,
  simulations,
  drift,
  vol,
  monthlyContribution = 0,
  inflationRate = 0,
  inflationAdjustContributions = false
}) {
  const steps = horizonYears * 12
  const muPerMonth = drift / 12
  const sigmaPerMonth = vol / Math.sqrt(12)
  const inflPerMonth = inflationRate / 12

  const contributionAt = (s) => {
    if (!monthlyContribution || monthlyContribution <= 0) return 0
    return inflationAdjustContributions ? monthlyContribution * Math.pow(1 + inflPerMonth, s) : monthlyContribution
  }

  let totalContributions = capital
  for (let s = 0; s < steps; s++) totalContributions += contributionAt(s)

  const ends = []
  const maxDrawdowns = []
  for (let p = 0; p < simulations; p++) {
    let value = capital
    let contributed = capital
    let peakIndex = 1
    let maxDD = 0
    for (let s = 0; s < steps; s++) {
      const add = contributionAt(s)
      if (add > 0) {
        value += add
        contributed += add
      }
      value *= Math.exp(muPerMonth - (sigmaPerMonth * sigmaPerMonth) / 2 + sigmaPerMonth * gaussian())
      const idx = contributed > 0 ? value / contributed : 1
      if (idx > peakIndex) peakIndex = idx
      const dd = (peakIndex - idx) / peakIndex
      if (dd > maxDD) maxDD = dd
    }
    ends.push(value)
    maxDrawdowns.push(maxDD)
  }

  ends.sort((a, b) => a - b)
  maxDrawdowns.sort((a, b) => a - b)

  const percentile = (arr, q) => {
    const idx = Math.min(arr.length - 1, Math.floor(q * arr.length))
    return arr[idx]
  }

  const p10 = percentile(ends, 0.1)
  const medianEnd = percentile(ends, 0.5)
  const p90 = percentile(ends, 0.9)
  const p5 = percentile(ends, 0.05)

  const nominalToReal = 1 / Math.pow(1 + inflationRate, horizonYears)
  const medianEndReal = medianEnd * nominalToReal
  const p10Real = p10 * nominalToReal
  const p90Real = p90 * nominalToReal

  const winRate =
    totalContributions > 0 ? ends.reduce((a, v) => a + (v >= totalContributions ? 1 : 0), 0) / simulations : 0
  const annualizedReturn = totalContributions > 0 ? Math.pow(medianEnd / totalContributions, 1 / horizonYears) - 1 : 0
  const annualizedRealReturn =
    totalContributions > 0 ? Math.pow(Math.max(medianEndReal, 1) / totalContributions, 1 / horizonYears) - 1 : 0

  return {
    medianEnd: Math.round(medianEnd),
    p10: Math.round(p10),
    p90: Math.round(p90),
    p5: Math.round(p5),
    medianEndReal: Math.round(medianEndReal),
    p10Real: Math.round(p10Real),
    p90Real: Math.round(p90Real),
    winRate: Math.round(winRate * 1000) / 1000,
    maxDrawdownP50: Math.round(percentile(maxDrawdowns, 0.5) * 1000) / 1000,
    maxDrawdownP95: Math.round(percentile(maxDrawdowns, 0.95) * 1000) / 1000,
    totalContributions: Math.round(totalContributions),
    medianProfit: Math.round(medianEnd - totalContributions),
    annualizedReturn: Math.round(annualizedReturn * 10000) / 10000,
    annualizedRealReturn: Math.round(annualizedRealReturn * 10000) / 10000,
    horizonYears,
    simulatedPaths: simulations
  }
}

function gaussian() {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
