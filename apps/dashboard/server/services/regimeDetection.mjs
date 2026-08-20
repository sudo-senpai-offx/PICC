/**
 * Market regime detection using ADX + ATR consensus across timeframes.
 * Regimes: trending, ranging, volatile, breakout
 */
import { atr as computeAtr, adx as computeAdx, bollinger as computeBollingerBands } from "./indicators.mjs"

export function detectRegime(candles, timeframe = "1H") {
  if (!candles || candles.length < 30) return { regime: "unknown", confidence: 0, factors: [] }
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const adxResult = computeAdx(highs, lows, closes, 14)
  const adx = adxResult.adx
  const atr = computeAtr(highs, lows, closes, 14)
  const bb = computeBollingerBands(closes, { period: 20, mult: 2 })
  const currentAtr = atr[atr.length - 1] || 0
  const avgAtr = atr.length > 0 ? atr.reduce((s, v) => s + (v || 0), 0) / atr.filter((v) => v != null).length : 0
  const currentAdx = (adx[adx.length - 1]) || 0
  const currentPrice = closes[closes.length - 1]
  const upperBand = bb.upper[bb.upper.length - 1] || currentPrice
  const lowerBand = bb.lower[bb.lower.length - 1] || currentPrice
  const atrRatio = avgAtr > 0 ? currentAtr / avgAtr : 1
  const factors = []
  let regime = "ranging"
  let confidence = 0.5
  if (currentAdx > 25) { regime = "trending"; confidence = Math.min(0.95, 0.5 + (currentAdx - 25) / 50); factors.push(`ADX ${currentAdx.toFixed(1)} > 25`) }
  if (atrRatio > 1.5) { regime = "volatile"; confidence = Math.min(0.95, 0.5 + (atrRatio - 1) * 0.3); factors.push(`ATR ratio ${atrRatio.toFixed(2)}x`) }
  if (currentPrice > upperBand || currentPrice < lowerBand) { regime = "breakout"; confidence = 0.8; factors.push("Price outside Bollinger Bands") }
  if (currentAdx < 20 && atrRatio < 0.8) { regime = "ranging"; confidence = 0.7; factors.push(`ADX ${currentAdx.toFixed(1)} < 20, ATR low`) }
  const suggestedStrategy = { trending: "momentum", ranging: "mean-reversion", volatile: "volatility-breakout", breakout: "breakout-follow" }[regime] || "adaptive"
  return { regime, confidence: Math.round(confidence * 100), factors, suggestedStrategy, metrics: { adx: Math.round(currentAdx * 10) / 10, atrRatio: Math.round(atrRatio * 100) / 100, timeframe } }
}

export function regimeHistory(candles, windowSize = 50) {
  if (!candles || candles.length < windowSize + 14) return []
  const results = []
  for (let i = windowSize; i <= candles.length; i += 10) {
    const window = candles.slice(i - windowSize, i)
    results.push({ index: i, time: window[window.length - 1]?.time, ...detectRegime(window) })
  }
  return results
}
