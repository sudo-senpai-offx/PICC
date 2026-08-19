// Candlestick pattern recognition — detects 15+ patterns from OHLC data.

function bodySize(c) { return Math.abs(c.close - c.open) }
function upperShadow(c) { return c.high - Math.max(c.open, c.close) }
function lowerShadow(c) { return Math.min(c.open, c.close) - c.low }
function totalRange(c) { return c.high - c.low }
function isBullish(c) { return c.close > c.open }
function isBearish(c) { return c.close < c.open }
function isDoji(c, tolerance = 0.05) { return bodySize(c) <= totalRange(c) * tolerance }
function midPoint(c) { return (c.open + c.close) / 2 }

// Body relative to total range
function bodyRatio(c) {
  const range = totalRange(c)
  return range === 0 ? 0 : bodySize(c) / range
}

export function detectPatterns(candles) {
  if (!candles || candles.length < 3) return []
  const detected = []

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const prev = i >= 1 ? candles[i - 1] : null
    const prev2 = i >= 2 ? candles[i - 2] : null
    const next = i < candles.length - 1 ? candles[i + 1] : null
    const patterns = []

    // ── Single-candle patterns ──────────────────────────────────────

    // Doji
    if (isDoji(c)) {
      patterns.push({ name: "Doji", direction: "neutral", strength: "medium", description: "Indecision — open and close are nearly equal" })
    }

    // Hammer / Hanging Man (long lower shadow, small body at top)
    if (bodyRatio(c) < 0.35 && lowerShadow(c) > bodySize(c) * 2 && upperShadow(c) < bodySize(c) * 0.5 && totalRange(c) > 0) {
      if (prev && isBearish(prev)) {
        patterns.push({ name: "Hammer", direction: "bullish", strength: "strong", description: "Bullish reversal — long lower wick after downtrend" })
      } else {
        patterns.push({ name: "Hanging Man", direction: "bearish", strength: "medium", description: "Potential reversal — long lower wick after uptrend" })
      }
    }

    // Inverted Hammer / Shooting Star (long upper shadow, small body at bottom)
    if (bodyRatio(c) < 0.35 && upperShadow(c) > bodySize(c) * 2 && lowerShadow(c) < bodySize(c) * 0.5 && totalRange(c) > 0) {
      if (prev && isBearish(prev)) {
        patterns.push({ name: "Inverted Hammer", direction: "bullish", strength: "medium", description: "Bullish reversal hint — long upper wick in downtrend" })
      } else if (prev && isBullish(prev)) {
        patterns.push({ name: "Shooting Star", direction: "bearish", strength: "strong", description: "Bearish reversal — rejection at highs after uptrend" })
      }
    }

    // Marubozu (full body candle, no shadows)
    if (bodyRatio(c) > 0.9 && totalRange(c) > 0) {
      patterns.push({
        name: isBullish(c) ? "Bullish Marubozu" : "Bearish Marubozu",
        direction: isBullish(c) ? "bullish" : "bearish",
        strength: "strong",
        description: isBullish(c) ? "Strong buying pressure — opened at low, closed at high" : "Strong selling pressure — opened at high, closed at low"
      })
    }

    // Spinning Top (small body, long shadows both sides)
    if (bodyRatio(c) < 0.25 && upperShadow(c) > bodySize(c) && lowerShadow(c) > bodySize(c) && totalRange(c) > 0) {
      patterns.push({ name: "Spinning Top", direction: "neutral", strength: "weak", description: "Market indecision — small body with shadows on both sides" })
    }

    // ── Two-candle patterns ─────────────────────────────────────────

    if (prev) {
      // Bullish Engulfing
      if (isBearish(prev) && isBullish(c) && c.open <= prev.close && c.close >= prev.open && bodySize(c) > bodySize(prev) * 1.2) {
        patterns.push({ name: "Bullish Engulfing", direction: "bullish", strength: "strong", description: "Bullish reversal — green candle fully engulfs prior red candle" })
      }

      // Bearish Engulfing
      if (isBullish(prev) && isBearish(c) && c.open >= prev.close && c.close <= prev.open && bodySize(c) > bodySize(prev) * 1.2) {
        patterns.push({ name: "Bearish Engulfing", direction: "bearish", strength: "strong", description: "Bearish reversal — red candle fully engulfs prior green candle" })
      }

      // Piercing Line / Dark Cloud Cover
      if (isBearish(prev) && isBullish(c) && c.open < prev.low && c.close > midPoint(prev) && c.close < prev.open) {
        patterns.push({ name: "Piercing Line", direction: "bullish", strength: "medium", description: "Bullish reversal — gap down then recovery past midpoint" })
      }
      if (isBullish(prev) && isBearish(c) && c.open > prev.high && c.close < midPoint(prev) && c.close > prev.open) {
        patterns.push({ name: "Dark Cloud Cover", direction: "bearish", strength: "medium", description: "Bearish reversal — gap up then sell-off past midpoint" })
      }

      // Tweezer Top / Bottom
      if (Math.abs(c.high - prev.high) < totalRange(c) * 0.02 && isBullish(prev) && isBearish(c)) {
        patterns.push({ name: "Tweezer Top", direction: "bearish", strength: "medium", description: "Bearish reversal — two candles with matching highs" })
      }
      if (Math.abs(c.low - prev.low) < totalRange(c) * 0.02 && isBearish(prev) && isBullish(c)) {
        patterns.push({ name: "Tweezer Bottom", direction: "bullish", strength: "medium", description: "Bullish reversal — two candles with matching lows" })
      }

      // Harami (small body inside prior large body)
      if (prev && bodySize(prev) > 0) {
        if (isBearish(prev) && isBullish(c) && c.open > prev.close && c.close < prev.open && bodySize(c) < bodySize(prev) * 0.6) {
          patterns.push({ name: "Bullish Harami", direction: "bullish", strength: "medium", description: "Potential reversal — small green inside large red candle" })
        }
        if (isBullish(prev) && isBearish(c) && c.open < prev.close && c.close > prev.open && bodySize(c) < bodySize(prev) * 0.6) {
          patterns.push({ name: "Bearish Harami", direction: "bearish", strength: "medium", description: "Potential reversal — small red inside large green candle" })
        }
      }
    }

    // ── Three-candle patterns ───────────────────────────────────────

    if (prev && prev2) {
      // Morning Star (bullish reversal)
      if (isBearish(prev2) && isDoji(prev) && isBullish(c) && c.close > midPoint(prev2)) {
        patterns.push({ name: "Morning Star", direction: "bullish", strength: "very_strong", description: "Strong bullish reversal — large red, doji, large green closing above midpoint" })
      }

      // Evening Star (bearish reversal)
      if (isBullish(prev2) && isDoji(prev) && isBearish(c) && c.close < midPoint(prev2)) {
        patterns.push({ name: "Evening Star", direction: "bearish", strength: "very_strong", description: "Strong bearish reversal — large green, doji, large red closing below midpoint" })
      }

      // Three White Soldiers
      if (isBullish(prev2) && isBullish(prev) && isBullish(c) &&
          prev.open > prev2.open && c.open > prev.open &&
          prev.close > prev2.close && c.close > prev.close) {
        patterns.push({ name: "Three White Soldiers", direction: "bullish", strength: "very_strong", description: "Strong bullish continuation — three consecutive rising green candles" })
      }

      // Three Black Crows
      if (isBearish(prev2) && isBearish(prev) && isBearish(c) &&
          prev.open < prev2.open && c.open < prev.open &&
          prev.close < prev2.close && c.close < prev.close) {
        patterns.push({ name: "Three Black Crows", direction: "bearish", strength: "very_strong", description: "Strong bearish continuation — three consecutive falling red candles" })
      }

      // Three Inside Up / Down
      if (isBearish(prev2) && isBullish(prev) && bodySize(prev) < bodySize(prev2) * 0.6 && isBullish(c) && c.close > prev2.open) {
        patterns.push({ name: "Three Inside Up", direction: "bullish", strength: "medium", description: "Bullish reversal — bearish candle, harami green, confirmation green" })
      }
      if (isBullish(prev2) && isBearish(prev) && bodySize(prev) < bodySize(prev2) * 0.6 && isBearish(c) && c.close < prev2.open) {
        patterns.push({ name: "Three Inside Down", direction: "bearish", strength: "medium", description: "Bearish reversal — bullish candle, harami red, confirmation red" })
      }
    }

    if (patterns.length > 0) {
      detected.push({
        index: i,
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        patterns
      })
    }
  }

  return detected
}

// Aggregate pattern stats for a candle set
export function patternSummary(candles) {
  const detected = detectPatterns(candles)
  const counts = {}
  const bullishCount = { total: 0 }
  const bearishCount = { total: 0 }

  for (const d of detected) {
    for (const p of d.patterns) {
      counts[p.name] = (counts[p.name] || 0) + 1
      if (p.direction === "bullish") bullishCount.total++
      if (p.direction === "bearish") bearishCount.total++
    }
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return {
    total: detected.length,
    uniquePatterns: sorted.length,
    bullishBias: bullishCount.total,
    bearishBias: bearishCount.total,
    bias: bullishCount.total > bearishCount.total ? "bullish" : bearishCount.total > bullishCount.total ? "bearish" : "neutral",
    topPatterns: sorted.slice(0, 10).map(([name, count]) => ({ name, count })),
    recent: detected.slice(-5)
  }
}
