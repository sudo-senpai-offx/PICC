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

/**
 * The bar count below which NO expiry can be scored.
 *
 * The scorer needs a return series with enough observations to mean anything by
 * it, and below this it had been answering anyway — see `optimizeExpiry`.
 */
export const EXPIRY_MIN_CANDLES = 20

/**
 * ── THE INVENTED TRADE INSTRUCTION ──
 *
 * Under 20 candles this used to return
 *
 *     { recommended: EXPIRY_OPTIONS[3], all: EXPIRY_OPTIONS.map((e) => ({ ...e, score: 50 })) }
 *
 * and that is not a measurement, it is an INSTRUCTION. `EXPIRY_OPTIONS[3]` is
 * this module's own `"1m"` table entry, handed back under the field name
 * `recommended` after the function had measured nothing at all — so a caller
 * that reads one field got "take a 1-minute expiry", derived from zero candles.
 * The `score: 50` on every option is the same defect in a second field: ten
 * equal numbers read as ten equally-good options, which is a measurement of
 * nothing, made by the one caller that could measure something.
 *
 * The UI had a gate (`expiryIsScored`) that refused to RENDER the constant as a
 * recommendation, so the defect had exactly one thing between it and a wrong
 * instruction, and that one thing was a client. A service that cannot measure
 * must not be able to hand out an instruction wearing a measurement's label, so
 * the refusal now lives HERE, where the ignorance is:
 *
 *  - `recommended` is `null`. There is no recommendation to read.
 *  - `all` carries `score: null` on every option — absent, never 50.
 *  - `recommendation.state` is the discriminator, `reason` names the count the
 *    caller actually supplied, and `volatility`/`avgMove` stay OMITTED so a
 *    measured zero stays distinguishable from a value nobody produced.
 *
 * Additive: `recommendation` is a NEW key on both branches, so the scored branch
 * gains a label rather than losing a field.
 */
export function optimizeExpiry(candles, regime = "ranging", signalStrength = 0.5) {
  const suppliedCandles = Array.isArray(candles) ? candles.length : 0
  if (suppliedCandles < EXPIRY_MIN_CANDLES) {
    return {
      recommended: null,
      recommendation: {
        state: "unavailable",
        reason: `insufficient candles (${suppliedCandles} < ${EXPIRY_MIN_CANDLES}); no expiry is scored and none is recommended`,
        requiredCandles: EXPIRY_MIN_CANDLES,
        suppliedCandles
      },
      all: EXPIRY_OPTIONS.map((e) => ({ ...e, score: null }))
    }
  }
  const returns = []
  for (let i = 1; i < candles.length; i++) {
    returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close)
  }
  const volatility = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length)
  const avgMove = returns.reduce((s, r) => s + Math.abs(r), 0) / returns.length
  // Infer the actual bar interval instead of assuming 60s: √time scaling of
  // the expected move is only correct when `seconds` and the bar length share
  // a unit (a 300s series under-scaled moves by √5 otherwise).
  let barSec = 60
  const gaps = []
  for (let i = 1; i < candles.length; i++) {
    const dt = Number(candles[i]?.time) - Number(candles[i - 1]?.time)
    if (Number.isFinite(dt) && dt > 0) {
      // Raw intervals above 4h are almost certainly MILLISECONDS (no binary
      // base timeframe is longer than that in seconds); normalize them.
      gaps.push(dt > 14400 ? dt / 1000 : dt)
    }
  }
  if (gaps.length >= 5) {
    gaps.sort((a, b) => a - b)
    barSec = Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)]))
  }
  const scored = EXPIRY_OPTIONS.map((exp) => {
    let score = 50
    const expectedMove = avgMove * Math.sqrt(exp.seconds / barSec)
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
  return {
    recommended: scored[0],
    recommendation: {
      state: "recommended",
      reason: null,
      requiredCandles: EXPIRY_MIN_CANDLES,
      suppliedCandles
    },
    all: scored,
    volatility: Math.round(volatility * 10000) / 100,
    avgMove: Math.round(avgMove * 10000) / 100
  }
}
