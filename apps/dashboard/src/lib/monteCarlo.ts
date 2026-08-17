import type { FinancialTwinParams, Projection, RiskTolerance } from "./types"

/** Deterministic-ish default drift/vol per asset class and risk tolerance (annualized). */
export function assumptionsFor(params: FinancialTwinParams): {
  drift: number
  vol: number
  allocation: Record<string, number>
} {
  const base: Record<RiskTolerance, { drift: number; vol: number }> = {
    conservative: { drift: 0.055, vol: 0.09 },
    moderate: { drift: 0.075, vol: 0.14 },
    aggressive: { drift: 0.095, vol: 0.19 }
  }

  const assetClassMult: Record<string, { drift: number; vol: number }> = {
    bonds: { drift: -0.015, vol: -0.06 },
    stock: { drift: 0, vol: 0 },
    index: { drift: 0, vol: 0 },
    reit: { drift: 0.005, vol: 0.02 },
    crypto: { drift: 0.03, vol: 0.15 }
  }
  const m = assetClassMult[params.assetClass] ?? { drift: 0, vol: 0 }

  const allocation: Record<string, number> = {
    equities: 0,
    bonds: 0,
    cash: 0
  }
  if (params.riskTolerance === "conservative") {
    allocation.equities = 0.4
    allocation.bonds = 0.45
    allocation.cash = 0.15
  } else if (params.riskTolerance === "moderate") {
    allocation.equities = 0.6
    allocation.bonds = 0.3
    allocation.cash = 0.1
  } else {
    allocation.equities = 0.8
    allocation.bonds = 0.15
    allocation.cash = 0.05
  }

  return {
    drift: base[params.riskTolerance].drift + m.drift,
    vol: Math.max(0.04, base[params.riskTolerance].vol + m.vol),
    allocation
  }
}

function gaussian(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Mirrors server/monteCarlo.mjs so the offline fallback stays identical.
export function runMonteCarlo(params: FinancialTwinParams): Projection {
  const { drift, vol, allocation } = assumptionsFor(params)
  const { capital, horizonYears, simulations } = params
  const monthlyContribution = params.monthlyContribution ?? 0
  const inflationRate = params.inflationRate ?? 0.025
  const inflationAdjustContributions = params.inflationAdjustContributions ?? false

  const steps = horizonYears * 12
  const muPerMonth = drift / 12
  const sigmaPerMonth = vol / Math.sqrt(12)
  const inflPerMonth = inflationRate / 12

  const contributionAt = (s: number): number => {
    if (!monthlyContribution || monthlyContribution <= 0) return 0
    return inflationAdjustContributions ? monthlyContribution * Math.pow(1 + inflPerMonth, s) : monthlyContribution
  }

  let totalContributions = capital
  for (let s = 0; s < steps; s++) totalContributions += contributionAt(s)

  const ends: number[] = []
  const maxDrawdowns: number[] = []
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

  const percentile = (arr: number[], q: number): number => {
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
    allocation,
    horizonYears,
    simulatedPaths: simulations
  }
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(n)
}

export function formatPercent(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`
}
