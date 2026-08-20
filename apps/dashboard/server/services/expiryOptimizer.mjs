/**
 * Binary options expiry optimizer.
 * Analyzes volatility regime + asset historical return distribution to recommend optimal expiry.
 */

const EXPIRY_OPTIONS = [
  { label: "5s", seconds: 5 },
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "2m", seconds: 120 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "4h", seconds: 14400 },
]

export function optimizeExpiry(candles, regime = "ranging", signalStrength = 0.5) {
  if (!candles || candles.length < 20) return { recommended: EXPIRY_OPTIONS[3], all: EXPIRY_OPTIONS.map((e) => ({ ...e, score: 50 })) }
  const returns = []
  for (let i = 1; i < candles.length; i++) {
    returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close)
  }
  const volatility = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length)
  const avgMove = returns.reduce((s, r) => s + Math.abs(r), 0) / returns.length
  const scored = EXPIRY_OPTIONS.map((exp) => {
    let score = 50
    const expectedMove = avgMove * Math.sqrt(exp.seconds / 60)
    if (regime === "trending") {
      score = exp.seconds >= 300 ? 80 : exp.seconds >= 60 ? 65 : 40
      if (signalStrength > 0.7) score += 10
    } else if (regime === "volatile") {
      score = exp.seconds <= 120 ? 75 : exp.seconds <= 300 ? 60 : 35
    } else if (regime === "breakout") {
      score = exp.seconds >= 60 && exp.seconds <= 600 ? 80 : 40
    } else {
      score = exp.seconds >= 30 && exp.seconds <= 300 ? 70 : 45
    }
    if (volatility > 0.001 && exp.seconds < 60) score -= 15
    if (signalStrength > 0.8) score += 5
    return { ...exp, score: Math.max(0, Math.min(100, Math.round(score))), expectedMove: Math.round(expectedMove * 10000) / 100 }
  })
  scored.sort((a, b) => b.score - a.score)
  return { recommended: scored[0], all: scored, volatility: Math.round(volatility * 10000) / 100, avgMove: Math.round(avgMove * 10000) / 100 }
}
