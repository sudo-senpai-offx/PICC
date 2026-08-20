/**
 * Order flow / delta analysis from OHLCV candle data.
 * Estimates buy/sell pressure from candle structure.
 */
export function analyzeOrderFlow(candles, lookback = 20) {
  if (!candles || candles.length < lookback) return { delta: [], cumulative: 0, imbalance: "neutral", signals: [] }
  const recent = candles.slice(-lookback)
  const deltas = recent.map((c) => {
    const range = c.high - c.low
    if (range === 0) return { delta: 0, buyPct: 50, sellPct: 50 }
    const bodyRatio = Math.abs(c.close - c.open) / range
    const buyPct = c.close >= c.open ? 50 + bodyRatio * 30 : 50 - bodyRatio * 30
    const volume = c.volume || 0
    const delta = ((buyPct - 50) / 50) * volume
    return { time: c.time, delta: Math.round(delta), buyPct: Math.round(buyPct), sellPct: Math.round(100 - buyPct), volume }
  })
  const cumulative = deltas.reduce((s, d) => s + d.delta, 0)
  const avgDelta = cumulative / deltas.length
  let imbalance = "neutral"
  if (avgDelta > 100) imbalance = "buy-heavy"
  else if (avgDelta < -100) imbalance = "sell-heavy"
  const signals = []
  const last3 = deltas.slice(-3)
  if (last3.every((d) => d.delta > 0)) signals.push({ type: "bullish-absorption", desc: "3 consecutive positive delta candles" })
  if (last3.every((d) => d.delta < 0)) signals.push({ type: "bearish-absorption", desc: "3 consecutive negative delta candles" })
  const lastPrice = recent[recent.length - 1]
  if (lastPrice && lastPrice.close > lastPrice.open && deltas[deltas.length - 1]?.delta < 0) signals.push({ type: "divergence", desc: "Price up but delta negative — hidden selling" })
  if (lastPrice && lastPrice.close < lastPrice.open && deltas[deltas.length - 1]?.delta > 0) signals.push({ type: "divergence", desc: "Price down but delta positive — hidden buying" })
  return { delta: deltas, cumulative: Math.round(cumulative), imbalance, avgDelta: Math.round(avgDelta), signals, lookback }
}
