// PICC Multi-Timeframe Confluence Engine
//
// Combines signals from multiple timeframes (1m, 5m, 15m, 1h) into a single
// weighted trade decision. Uses the full indicator dashboard on each timeframe
// and aggregates directional consensus with volatility-adjusted scoring.
//
// The engine works with two data sources:
//   1. LiveEO periods map (real-time, for binary options with 60s/300s/900s candles)
//   2. Yahoo historical data (for daily/weekly timeframe analysis)
//
// Returns a confluence score, direction, and detailed per-TF breakdown.

import { computeIndicatorDashboard } from "./indicators.mjs"

const EPS = 1e-12

// ---------------------------------------------------------------------
// Timeframe hierarchy
// ---------------------------------------------------------------------

export const TIMEFRAME_SECONDS = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800
}

// Default hierarchy for different trading styles
export const TRADING_STYLES = {
  scalping: { entry: "1m", confirms: ["5m", "15m"], trend: "1h", weight: { entry: 0.30, "5m": 0.30, "15m": 0.25, "1h": 0.15 } },
  dayTrading: { entry: "5m", confirms: ["15m", "1h"], trend: "4h", weight: { entry: 0.25, "15m": 0.30, "1h": 0.25, "4h": 0.20 } },
  swing: { entry: "1h", confirms: ["4h", "1d"], trend: "1w", weight: { entry: 0.20, "4h": 0.30, "1d": 0.30, "1w": 0.20 } }
}

// ---------------------------------------------------------------------
// Adaptive timeframe selection based on volatility
// ---------------------------------------------------------------------

/**
 * Select the optimal trading style based on current market volatility.
 * High volatility → shorter timeframes (scalping), low → longer (swing).
 */
export function selectStyle(atrValue, lastPrice) {
  if (!atrValue || !lastPrice || lastPrice <= 0) return "dayTrading"
  const atrPct = (atrValue / lastPrice) * 100
  if (atrPct > 2.0) return "scalping"
  if (atrPct > 0.5) return "dayTrading"
  return "swing"
}

// ---------------------------------------------------------------------
// Per-timeframe signal extraction
// ---------------------------------------------------------------------

/**
 * Extract a directional signal and strength from an indicator dashboard.
 * Returns { direction: 1|-1|0, strength: 0-1, factors: [...] }
 */
function extractSignal(dashboard) {
  if (!dashboard || dashboard.bars < 20) return { direction: 0, strength: 0, factors: [] }

  const factors = []
  let bullScore = 0
  let bearScore = 0
  let totalWeight = 0

  const addFactor = (name, dir, weight, detail) => {
    if (dir === 0) return
    totalWeight += weight
    if (dir > 0) bullScore += weight
    else bearScore += weight
    factors.push({ name, dir, weight, detail })
  }

  // EMA alignment (weight: 3)
  const ema = dashboard.ema
  if (ema?.read === "bullish alignment") addFactor("ema", 1, 3, ema.read)
  else if (ema?.read === "bearish alignment") addFactor("ema", -1, 3, ema.read)

  // RSI (weight: 2)
  const rsi = dashboard.rsi
  if (rsi?.read === "bullish") addFactor("rsi", 1, 2, `${rsi.value}`)
  else if (rsi?.read === "bearish") addFactor("rsi", -1, 2, `${rsi.value}`)
  else if (rsi?.read === "oversold") addFactor("rsi", 1, 2.5, `oversold ${rsi.value}`)
  else if (rsi?.read === "overbought") addFactor("rsi", -1, 2.5, `overbought ${rsi.value}`)

  // MACD (weight: 2.5)
  const macd = dashboard.macd
  if (macd?.cross === "bullish") addFactor("macd", 1, 2.5, "bullish cross")
  else if (macd?.cross === "bearish") addFactor("macd", -1, 2.5, "bearish cross")
  else if (macd?.hist != null) addFactor("macd", macd.hist > 0 ? 1 : -1, 1, `hist ${macd.hist.toFixed(4)}`)

  // ADX trend strength (weight: 2)
  const adx = dashboard.adx
  if (adx?.adx != null && adx.adx > 25) {
    const dir = adx.plusDI > adx.minusDI ? 1 : -1
    addFactor("adx", dir, 2, `ADX ${adx.adx} trending`)
  }

  // Bollinger Band position (weight: 1.5)
  const bb = dashboard.bollinger
  if (bb?.percentB != null) {
    if (bb.percentB < 0.2) addFactor("bb", 1, 1.5, `%B ${bb.percentB.toFixed(2)} near lower`)
    else if (bb.percentB > 0.8) addFactor("bb", -1, 1.5, `%B ${bb.percentB.toFixed(2)} near upper`)
  }

  // Ichimoku (weight: 2)
  const ich = dashboard.ichimoku
  if (ich?.trend === "bullish") addFactor("ichimoku", 1, 2, ich.trend)
  else if (ich?.trend === "bearish") addFactor("ichimoku", -1, 2, ich.trend)

  // Parabolic SAR (weight: 1.5)
  const psar = dashboard.psar
  if (psar?.trend === "bullish") addFactor("psar", 1, 1.5, psar.trend)
  else if (psar?.trend === "bearish") addFactor("psar", -1, 1.5, psar.trend)

  // Stochastic (weight: 1.5)
  const stoch = dashboard.stochastic
  if (stoch?.cross === "bullish") addFactor("stoch", 1, 1.5, "bullish cross")
  else if (stoch?.cross === "bearish") addFactor("stoch", -1, 1.5, "bearish cross")
  else if (stoch?.read === "oversold") addFactor("stoch", 1, 1, "oversold")
  else if (stoch?.read === "overbought") addFactor("stoch", -1, 1, "overbought")

  // CCI (weight: 1)
  const cci = dashboard.cci
  if (cci?.read === "bullish") addFactor("cci", 1, 1, `CCI ${cci.value20}`)
  else if (cci?.read === "bearish") addFactor("cci", -1, 1, `CCI ${cci.value20}`)
  else if (cci?.read === "oversold") addFactor("cci", 1, 1.5, `CCI oversold ${cci.value20}`)
  else if (cci?.read === "overbought") addFactor("cci", -1, 1.5, `CCI overbought ${cci.value20}`)

  // Awesome Oscillator (weight: 1)
  const ao = dashboard.awesome
  if (ao?.read === "bullish") addFactor("ao", 1, 1, `AO ${ao.value}`)
  else if (ao?.read === "bearish") addFactor("ao", -1, 1, `AO ${ao.value}`)

  // Heikin Ashi (weight: 1.5)
  const ha = dashboard.heikinAshi
  if (ha) {
    const haDir = ha.close > ha.open ? 1 : ha.close < ha.open ? -1 : 0
    if (haDir !== 0) addFactor("ha", haDir, 1.5, haDir > 0 ? "bullish candle" : "bearish candle")
  }

  // Linear regression slope (weight: 1.5)
  const lr = dashboard.linearRegression
  if (lr?.slope != null && lr.r2 != null && lr.r2 > 0.3) {
    addFactor("lr", lr.slope > 0 ? 1 : -1, 1.5 * Math.min(1, lr.r2), `slope ${lr.slopePct}% R² ${lr.r2}`)
  }

  // Compute net direction and strength
  const net = bullScore - bearScore
  const maxScore = Math.max(bullScore, bearScore)
  const direction = Math.abs(net) < EPS ? 0 : net > 0 ? 1 : -1
  const strength = totalWeight > 0 ? Math.min(1, maxScore / totalWeight) : 0

  return { direction, strength, factors, bullScore, bearScore, totalWeight }
}

// ---------------------------------------------------------------------
// Main multi-timeframe confluence function
// ---------------------------------------------------------------------

/**
 * Compute multi-timeframe confluence from candle data.
 *
 * @param {Object} opts
 * @param {Array} opts.candles - Primary timeframe candles (OHLCV)
 * @param {Object} opts.periods - LiveEO periods map { 60: [...], 300: [...], 900: [...] }
 * @param {string} opts.style - Trading style: "scalping" | "dayTrading" | "swing"
 * @param {Object} opts.customWeights - Override weights per TF { "1m": 0.3, "5m": 0.3, ... }
 * @returns {Object} Confluence result
 */
export function multiTimeframeConfluence(opts = {}) {
  const { candles, periods = {}, style = "dayTrading", customWeights } = opts
  const config = TRADING_STYLES[style] || TRADING_STYLES.dayTrading
  const weights = customWeights || config.weight

  // Build TF list: entry + confirms + trend
  const tfList = [config.entry, ...config.confirms, config.trend]
  const tfSignals = {}

  for (const tf of tfList) {
    const tfSeconds = TIMEFRAME_SECONDS[tf]
    let tfCandles = null

    // Try periods map first (LiveEO real-time data)
    if (periods[tfSeconds] && Array.isArray(periods[tfSeconds]) && periods[tfSeconds].length >= 20) {
      tfCandles = periods[tfSeconds]
    }
    // For the entry TF, use the primary candles array
    else if (tf === config.entry && Array.isArray(candles) && candles.length >= 20) {
      tfCandles = candles
    }

    if (tfCandles && tfCandles.length >= 20) {
      try {
        const dashboard = computeIndicatorDashboard(tfCandles)
        tfSignals[tf] = extractSignal(dashboard)
        tfSignals[tf].bars = tfCandles.length
        tfSignals[tf].lastPrice = dashboard.last
      } catch {
        tfSignals[tf] = { direction: 0, strength: 0, factors: [], bars: 0, error: true }
      }
    } else {
      tfSignals[tf] = { direction: 0, strength: 0, factors: [], bars: 0, insufficient: true }
    }
  }

  // ------------------------------------------------------------------
  // Aggregate across timeframes
  // ------------------------------------------------------------------
  const entrySig = tfSignals[config.entry] || { direction: 0, strength: 0 }
  const primaryDir = entrySig.direction

  // Agreement: how many TFs agree with the primary direction
  let agreeCount = 0
  let totalChecked = 0
  let disagreeCount = 0
  for (const tf of tfList) {
    const sig = tfSignals[tf]
    if (sig.bars < 20 || sig.error) continue
    totalChecked += 1
    if (sig.direction === primaryDir && primaryDir !== 0) agreeCount += 1
    else if (sig.direction !== 0 && sig.direction !== primaryDir) disagreeCount += 1
  }

  // Weighted confluence score
  let weightedScore = 0
  let totalWeight = 0
  for (const tf of tfList) {
    const sig = tfSignals[tf]
    if (sig.bars < 20 || sig.error) continue
    const w = weights[tf] || 0.25
    totalWeight += w
    weightedScore += sig.direction * sig.strength * w
  }
  const normalizedScore = totalWeight > 0 ? weightedScore / totalWeight : 0

  // Final direction from weighted score
  const finalDirection = Math.abs(normalizedScore) < 0.05 ? "flat" : normalizedScore > 0 ? "up" : "down"

  // Confidence: based on agreement + individual strengths
  const agreementRatio = totalChecked > 0 ? agreeCount / totalChecked : 0
  const avgStrength = totalChecked > 0
    ? Object.values(tfSignals).filter(s => s.bars >= 20 && !s.error).reduce((sum, s) => sum + s.strength, 0) / totalChecked
    : 0
  const confidence = Math.round((agreementRatio * 0.6 + avgStrength * 0.4) * 100)

  // Veto: if no TFs agree or all disagree, block the trade
  const veto = agreeCount === 0 || disagreeCount >= totalChecked

  // Regime hint from ADX across TFs
  let regimeHint = "unknown"
  for (const tf of tfList) {
    const sig = tfSignals[tf]
    if (sig.bars < 20) continue
    // If the trend TF shows strong ADX, use that regime
    if (tf === config.trend) {
      const factors = sig.factors || []
      const adxFactor = factors.find(f => f.name === "adx")
      if (adxFactor) regimeHint = adxFactor.detail.includes("trending") ? "trending" : "ranging"
    }
  }

  return {
    ok: true,
    style,
    direction: finalDirection,
    confidence,
    agreementRatio: Math.round(agreementRatio * 100),
    agreeCount,
    disagreeCount,
    totalChecked,
    veto,
    weightedScore: Math.round(normalizedScore * 1000) / 1000,
    avgStrength: Math.round(avgStrength * 100),
    regimeHint,
    timeframes: Object.fromEntries(
      Object.entries(tfSignals).map(([tf, sig]) => [
        tf,
        {
          direction: sig.direction === 1 ? "up" : sig.direction === -1 ? "down" : "flat",
          strength: Math.round(sig.strength * 100),
          bars: sig.bars,
          weight: weights[tf] || 0,
          topFactors: (sig.factors || []).slice(0, 3)
        }
      ])
    )
  }
}

/**
 * Quick MTF check using only LiveEO periods (for the decision engine).
 * Returns a simple { agree, total, boost } shape.
 */
export function quickMtfCheck(asset, primaryDirection) {
  if (!asset || primaryDirection === 0) return { agree: 0, total: 0, boost: 0, tfDetails: [] }
  const periods = asset.periods || {}
  const tfSeconds = [300, 900]
  const details = []
  let agree = 0
  let checked = 0

  for (const tf of tfSeconds) {
    const candles = periods[tf]
    if (!Array.isArray(candles) || candles.length < 20) continue
    checked += 1
    try {
      const dashboard = computeIndicatorDashboard(candles)
      const sig = extractSignal(dashboard)
      const matches = sig.direction === primaryDirection
      if (matches) agree += 1
      details.push({ tf, dir: sig.direction, strength: sig.strength, matches })
    } catch {
      details.push({ tf, dir: 0, strength: 0, matches: false, error: true })
    }
  }

  const boost = checked > 0 ? (agree * 0.06 - (checked - agree) * 0.04) : 0
  return { agree, total: checked, boost: Math.round(boost * 1000) / 1000, tfDetails: details }
}
