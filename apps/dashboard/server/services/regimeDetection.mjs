/**
 * Market regime detection using ADX + ATR consensus across timeframes.
 * Regimes: trending, ranging, volatile, breakout
 *
 * B-REG-4 (named, deliberate adapter update — spec PICC_TRADING_SUITE_REBUILD_v1.md):
 * the classification SURFACE now delegates to the regime engine. `detectRegime`
 * keeps the legacy output tree byte-identical for its legacy keys — that is the
 * compatibility contract for `autopilot.mjs:24`, `regimeDetection.test.mjs`
 * (untouched) and `liveTestingPrep.test.mjs` — and ATTACHES the regimeEngine
 * single-plane read additively as the `regimeEngine` block. Callers consuming
 * the legacy fields see exactly what they saw before; callers asking for the
 * new block get the regimeEngine consensus on the same candles.
 */
import { atr as computeAtr, adx as computeAdx, bollinger as computeBollingerBands } from "./indicators.mjs"
import { detectRegimeEnhanced, MIN_BARS, CONFIDENCE_ABSTAINED } from "./regimeEngine.mjs"

// Timeframe label -> seconds (the bias plane for the single-plane regime read).
const TF_LABELS = new Map([
  ["m1", 60], ["1m", 60], ["1min", 60],
  ["m5", 300], ["5m", 300], ["5min", 300],
  ["m15", 900], ["15m", 900],
  ["m30", 1800], ["30m", 1800],
  ["h1", 3600], ["1h", 3600], ["1hr", 3600],
  ["h4", 14400], ["4h", 14400],
  ["d1", 86400], ["1d", 86400], ["1day", 86400],
  ["w1", 604800], ["1w", 604800],
  ["mn", 2592000], ["1mo", 2592000], ["1month", 2592000]
])

/** Normalize a timeframe label to seconds, or null when unrecognized (no bias). */
export function tfSecondsOf(timeframe) {
  if (timeframe == null) return null
  const key = String(timeframe).toLowerCase().replace(/[^a-z0-9]/g, "")
  return TF_LABELS.get(key) ?? null
}

/**
 * ── THE SILENT LABEL→PLANE SUBSTITUTION ──
 *
 * The delegation used to be one expression:
 *
 *     const tf = tfSecondsOf(timeframe)
 *     const engine = detectRegimeEnhanced({ planes: { [tf ?? 60]: candles }, biasTf: tf })
 *
 * and the `?? 60` was two lies in one place. The engine's plane map is keyed by
 * SECONDS, so when `tfSecondsOf` returned null for an unrecognised label the
 * candles were filed on a 60-second plane that no caller had ever named — and
 * `latency.planes` then reported `[60]`, which reads as "I analysed a 1-minute
 * series" to anyone comparing the response against the request. Meanwhile
 * `biasTf` stayed null, so the engine's `Number(tf) === Number(biasTf)` became
 * `60 === Number(null)` -> `60 === 0` -> false, and the bias weight was dropped
 * without a word. The response was a read the engine would not have made.
 *
 * The UI now filters its labels to eight resolvable ones and cannot trip this.
 * That is a CLIENT gate guarding a SERVER defect, which is why the defect was
 * still worth fixing: every other caller still can, and a `??` that invents a
 * unit is an invitation rather than a decision.
 *
 * So the adapter now REFUSES, which is the only honest option available: the
 * engine's plane map is keyed by seconds, and with no seconds there is no honest
 * key to use. A refusal costs the caller the engine read, and buys it a response
 * that cannot be mistaken for one taken at a bar length nobody asked for. The
 * legacy ADX/ATR surface above is untouched, because it never depended on the
 * label — so a refused bias plane does not cost the caller the read it CAN make.
 *
 * ── AND A THIN SERIES MAY ALSO REFUSE ──
 *
 * A caller can be wrong about BOTH at once: `detectRegime(candles(29), "banana")`
 * refuses twice, for two independent reasons. This writer used to spread a
 * SECOND refusal over the first, so the shipped `reason` read
 * `"insufficient bars"` while the block's own comment insisted the label reason
 * "must not be conflated" with it — and a caller reading the engine block
 * concluded the label had been fine. `timeframeResolution` still carried the
 * label truth, so the payload as a whole was not wrong, but a block that says
 * one thing while its sibling says another is how the wrong reading gets made.
 *
 * So `reason` is JOINED and `factors` are APPENDED — but only for refusals that
 * ACTUALLY HAPPENED. `labelRefused` is a REQUIRED argument rather than a default
 * of `true`: the thin-series branch calls this writer for every caller,
 * including the ones whose label resolved perfectly well, and a defaulted flag
 * means a future refusal site that simply forgets it silently inherits a
 * LABEL refusal it did not have — naming "5m" unresolvable because the BARS
 * were short. Nothing about the current call sites needs the default; the
 * requirement is discipline, not shape, and the two sites below now each say
 * which refusal they are reporting. A resolvable label on a thin series
 * therefore reads exactly as it did before — a bars-only refusal.
 */
function refuseEngineRead(timeframe, { labelRefused, alsoRefused = null }) {
  const label = timeframe === undefined ? "(absent)" : JSON.stringify(timeframe)
  const labelReason = `unresolvable timeframe ${label}; the candles were NOT filed on a substitute plane, and no bias weight was applied`
  const labelFactor = `timeframe ${label} does not resolve to a bar length, so no bias plane could be selected`
  const reasons = []
  const factors = []
  if (labelRefused) {
    reasons.push(labelReason)
    factors.push(labelFactor)
  }
  if (alsoRefused) {
    reasons.push(alsoRefused.reason)
    factors.push(...alsoRefused.factors)
  }
  // A REFUSAL THAT NAMES NOTHING IS THE CONTRADICTION THIS WRITER EXISTS TO
  // AVOID. `reason: null` beside `regime: "unknown"` tells a caller the read was
  // declined for a reason that does not exist, and the reachable
  // `reasons.length ? … : null` guarded only against a case no call site makes.
  // `labelRefused` being required means the only way to get here is to pass
  // `labelRefused: false` with no `alsoRefused` — a refusal with nothing to say,
  // which is a caller bug and is reported as one rather than published.
  if (reasons.length === 0) {
    throw new Error(
      "refuseEngineRead called with no refusal to state: a decline that carries no reason is the contradiction it exists to prevent"
    )
  }
  return {
    regime: "unknown",
    confidence: 0,
    confidenceKind: CONFIDENCE_ABSTAINED,
    factors,
    perPlane: {},
    volatile: false,
    latency: { planes: [], minBars: 0 },
    source: "regimeEngine",
    reason: reasons.join("; ")
  }
}

export function detectRegime(candles, timeframe = "1H") {
  const tf = tfSecondsOf(timeframe)
  const resolution = {
    label: timeframe ?? null,
    seconds: tf,
    biasApplied: tf != null,
    reason:
      tf != null
        ? null
        : `timeframe ${timeframe === undefined ? "(absent)" : JSON.stringify(timeframe)} is not one of the known labels`
  }
  if (!candles || candles.length < 30) {
    // TWO INDEPENDENT REFUSALS, CARRIED TOGETHER. A thin series AND an
    // unresolvable label is one call that is wrong twice, and reporting only
    // whichever refusal happened to be written last tells the caller the other
    // one did not apply. `refuseEngineRead` joins them; see its doc comment.
    return {
      regime: "unknown",
      confidence: 0,
      factors: [],
      timeframeResolution: resolution,
      regimeEngine: refuseEngineRead(timeframe, {
        labelRefused: tf == null,
        alsoRefused: {
          reason: `insufficient bars (< MIN_BARS ${MIN_BARS})`,
          factors: [`insufficient bars (< MIN_BARS ${MIN_BARS})`]
        }
      })
    }
  }
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
  // B-REG-4: the regimeEngine single-plane read, additive. Same candles, same
  // timeframe; `biasTf` = the resolved seconds, and there is NO substitute plane
  // when the label does not resolve — see `refuseEngineRead`.
  const engine =
    tf == null
      ? refuseEngineRead(timeframe, { labelRefused: true })
      : detectRegimeEnhanced({ planes: { [tf]: candles }, biasTf: tf })
  return {
    regime,
    confidence: Math.round(confidence * 100),
    factors,
    suggestedStrategy,
    metrics: { adx: Math.round(currentAdx * 10) / 10, atrRatio: Math.round(atrRatio * 100) / 100, timeframe },
    timeframeResolution: resolution,
    regimeEngine: { ...engine, source: "regimeEngine" }
  }
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
