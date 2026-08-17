// PICC Pro Analysis — layered decision-support engine.
//
// Fuses four independent views into a single honest report:
//   1. the statistical ensemble (prediction.mjs) — direction + calibrated odds,
//   2. a full indicator dashboard (indicators.mjs) — every classic oscillator,
//   3. higher-timeframe (weekly aggregate) bias and alignment,
//   4. a weighted confluence model scoring trend, momentum and volatility.
//
// Output is decision support only. Nothing here executes trades, and every
// report carries an explicit honesty note about what it can and cannot tell you.

import { getHistory } from "./yahoo.mjs"
import { predictDirection } from "./prediction.mjs"
import {
  candlesFromSeries,
  aggregateCandles,
  computeIndicatorDashboard,
  detectMarketPhase,
  findDivergences,
  swingPoints,
  rsi,
  stochRSI,
  stochastic,
  macd,
  awesomeOscillator,
  cci,
  williamsR,
  cmo,
  roc,
  momentum,
  apo,
  bollinger,
  vwap,
  parabolicSAR,
  adx,
  aroon,
  ema,
  atr,
  returnAutocorrelation
} from "./indicators.mjs"
import { connectSession, candlesFrom, assetsFrom } from "./expertoption.mjs"
import { getCredentials } from "./trading.mjs"
import { chatText, llmConfigured, provider as llmProvider } from "./llm.mjs"

const EPS = 1e-12

const round = (v, d = 2) => (Number.isFinite(v) ? Number((Math.round(v * 10 ** d) / 10 ** d).toFixed(d)) : null)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const sign = (v) => (Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1)
const lastIdx = (arr) => (Array.isArray(arr) ? arr.length - 1 : -1)
const g = (arr, i) => (Array.isArray(arr) && i >= 0 && Number.isFinite(arr[i]) ? arr[i] : null)

// ---------------------------------------------------------------------
// Evidence building
// ---------------------------------------------------------------------

/**
 * Accept candles as either an array of candle objects ({open,high,low,close,
 * volume,time}), a {closes,opens,highs,lows,volumes,times} series object, or an
 * array of [time, open, close, high, low] rows — normalize to candle objects.
 */
function normalizeCandles(input) {
  if (Array.isArray(input)) {
    const first = input[0]
    if (first && typeof first === "object" && !Array.isArray(first) && !Number.isFinite(first)) {
      return candlesFromSeries({
        closes: input.map((x) => x.close ?? x.c),
        opens: input.map((x) => x.open ?? x.o),
        highs: input.map((x) => x.high ?? x.h),
        lows: input.map((x) => x.low ?? x.l),
        volumes: input.map((x) => x.volume ?? x.v),
        times: input.map((x) => x.time ?? x.t ?? x.time_from)
      })
    }
    return candlesFromSeries({
      closes: input.map((x) => (Array.isArray(x) ? x[2] ?? x[1] : NaN)),
      opens: input.map((x) => (Array.isArray(x) ? x[1] : NaN)),
      highs: input.map((x) => (Array.isArray(x) ? x[3] : NaN)),
      lows: input.map((x) => (Array.isArray(x) ? x[4] : NaN)),
      times: input.map((x) => (Array.isArray(x) ? x[0] : NaN))
    })
  }
  if (input && typeof input === "object") return candlesFromSeries(input)
  return []
}

/**
 * Weighted mean of evidence "bull" values (each in [-1, 1]). Returns the
 * group score clamped to [-1, 1] plus the contributing items.
 */
function scoreGroup(items) {
  let num = 0, den = 0
  for (const it of items) {
    if (it.bull === 0) continue
    num += it.bull * it.weight
    den += it.weight
  }
  const score = den > 0 ? clamp(num / den, -1, 1) : 0
  return { score, items: items.filter((it) => it.bull !== 0) }
}

const label = (v) => (Number.isFinite(v) ? round(v, 4) : "n/a")

// ---------------------------------------------------------------------
// Confluence model
// ---------------------------------------------------------------------

function buildConfluence({ dash, series, phase, last, close }) {
  const lr = dash.linearRegression
  const ema20 = g(series.ema20), ema50 = g(series.ema50), ema200 = g(series.ema200)
  const psarTrend = g(series.psarTrend)
  const reg = phase?.phase ?? phase
  const isRange = reg === "quiet_range" || reg === "volatile_range"
  const isTrend = reg === "trend" || reg === "volatile_trend"

  const trendItems = [
    {
      name: "Alligator", weight: 1.5,
      bull: dash.alligator.bull ?? 0,
      read: dash.alligator.label
    },
    {
      name: "Close vs EMA20", weight: 1.0,
      bull: close != null && ema20 != null ? (close > ema20 ? 1 : -1) : 0,
      read: `${label(close)} vs ${label(ema20)}`
    },
    {
      name: "EMA20 vs EMA50", weight: 1.0,
      bull: ema20 != null && ema50 != null ? (ema20 > ema50 ? 1 : -1) : 0,
      read: `${label(ema20)} vs ${label(ema50)}`
    },
    {
      name: "Close vs EMA200", weight: 1.2,
      bull: close != null && ema200 != null ? (close > ema200 ? 1 : -1) : 0,
      read: `${label(close)} vs ${label(ema200)}`
    },
    {
      name: "MACD line", weight: 1.0,
      bull: dash.macd.line != null ? sign(dash.macd.line) : 0,
      read: `line ${label(dash.macd.line)} (${dash.macd.zero})`
    },
    {
      name: "Parabolic SAR", weight: 0.8,
      bull: dash.psar.trend === "bullish" ? 1 : dash.psar.trend === "bearish" ? -1 : 0,
      read: dash.psar.trend
    },
    {
      name: "Regression slope", weight: 1.2,
      bull: lr.slopePct != null ? clamp(lr.slopePct / 0.15, -1, 1) * (Math.abs(lr.r2) < 0.3 ? 0.5 : 1) : 0,
      read: `slope ${label(lr.slopePct)}%/bar, R² ${label(lr.r2)}`
    },
    {
      name: "Aroon", weight: 0.8,
      bull: dash.aroon.osc > 50 ? 1 : dash.aroon.osc < -50 ? -1 : 0,
      read: dash.aroon.read
    },
    {
      name: "DMI direction", weight: 0.8,
      bull: dash.adx.plusDI != null && dash.adx.minusDI != null ? (dash.adx.plusDI > dash.adx.minusDI ? 1 : -1) : 0,
      read: `+DI ${label(dash.adx.plusDI)} / -DI ${label(dash.adx.minusDI)}`
    },
    {
      name: "Price vs VWAP", weight: 0.7,
      bull: close != null && series.vwapNow != null ? (close > series.vwapNow ? 1 : -1) : 0,
      read: `${label(close)} vs ${label(series.vwapNow)}`
    }
  ]
  // DMI only speaks when a trend is present; weaken it in range phases.
  if (isRange && trendItems[8]) trendItems[8].weight *= 0.3

  const rsiNow = dash.rsi.value
  let rsiBull = rsiNow != null ? (rsiNow - 50) / 50 : 0
  if (isRange && rsiNow != null) rsiBull = rsiNow > 70 ? -1 : rsiNow < 30 ? 1 : (rsiNow - 50) / 50
  const sRsiNow = dash.stochRSI.k
  let sRsiBull = sRsiNow != null ? (sRsiNow - 50) / 50 : 0
  if (isRange && sRsiNow != null) sRsiBull = sRsiNow > 80 ? -1 : sRsiNow < 20 ? 1 : (sRsiNow - 50) / 50
  const cciNow = dash.cci.value20
  let cciBull = cciNow != null ? clamp(cciNow / 100, -1, 1) : 0
  if (isRange && cciNow != null) cciBull = cciNow > 100 ? -0.5 : cciNow < -100 ? 0.5 : cciNow / 100
  const wrNow = dash.williamsR
  let wrBull = wrNow != null ? clamp(-wrNow / 50, -1, 1) : 0
  if (isRange && wrNow != null) wrBull = wrNow > -20 ? -1 : wrNow < -80 ? 1 : clamp(-wrNow / 50, -0.5, 0.5)
  const cmoNow = dash.cmo
  const rocNow = dash.roc
  const momNow = dash.momentum
  const apoNow = dash.apo
  const scale = Math.max(Math.abs(close) * 0.004, EPS)

  const momentumItems = [
    { name: "RSI(14)", weight: 1.2, bull: rsiBull, read: dash.rsi.read },
    { name: "StochRSI", weight: 1.0, bull: sRsiBull, read: dash.stochRSI.read },
    {
      name: "Stochastic cross", weight: 0.9,
      bull: dash.stochastic.cross === "bullish" ? 1 : dash.stochastic.cross === "bearish" ? -1 : 0,
      read: dash.stochastic.cross
    },
    {
      name: "MACD histogram", weight: 1.0,
      bull: dash.macd.hist != null ? sign(dash.macd.hist) : 0,
      read: `${dash.macd.cross} (hist ${label(dash.macd.hist)})`
    },
    { name: "Awesome oscillator", weight: 0.8, bull: dash.awesome.value > 0 ? 1 : dash.awesome.value < 0 ? -1 : 0, read: dash.awesome.read },
    { name: "CCI(20)", weight: 0.9, bull: cciBull, read: dash.cci.read },
    { name: "Williams %R", weight: 0.8, bull: wrBull, read: label(wrNow) },
    { name: "CMO(14)", weight: 0.8, bull: cmoNow != null ? sign(cmoNow) * Math.min(1, Math.abs(cmoNow) / 50) : 0, read: label(cmoNow) },
    { name: "ROC(12)", weight: 0.7, bull: rocNow != null ? sign(rocNow) * Math.min(1, Math.abs(rocNow) / 3) : 0, read: `${label(rocNow)}%` },
    { name: "Momentum(10)", weight: 0.6, bull: momNow != null ? sign(momNow) * Math.min(1, Math.abs(momNow) / scale) : 0, read: label(momNow) },
    { name: "APO", weight: 0.6, bull: apoNow != null ? sign(apoNow) * Math.min(1, Math.abs(apoNow) / scale) : 0, read: label(apoNow) }
  ]

  const pctB = dash.bollinger.percentB
  let pctBBull = pctB != null ? (pctB - 0.5) * 2 : 0
  if (isRange && pctB != null) pctBBull = pctB < 0.2 ? 1 : pctB > 0.8 ? -1 : (pctB - 0.5) * 2
  if (isTrend && pctB != null) pctBBull = pctB > 0.8 ? 1 : pctB < 0.2 ? -1 : (pctB - 0.5) * 2
  const autocorr = returnAutocorrelation(series.closes)
  const volItems = [
    {
      name: "Bollinger %B", weight: 1.0,
      bull: pctBBull,
      read: `${label(pctB)} (bandwidth ${label(dash.bollinger.bandwidth)})`
    },
    {
      name: "Volatility cycle", weight: 0.7,
      bull: reg === "compression" ? 0 : reg === "trend" || reg === "volatile_trend" ? (lr.slopePct > 0 ? 1 : -1) : 0,
      read: `percentile ${dash.phase?.volatilityPercentile ?? dash.volatility ?? "n/a"}`
    },
    {
      name: "ATR percentile", weight: 0.7,
      bull: isRange ? (reg === "quiet_range" ? 0.3 : -0.3) : reg === "volatile_trend" ? -0.3 : 0,
      read: `atr ${label(dash.atr.value)}`
    },
    {
      name: "Persistence", weight: 0.8,
      bull: clamp(autocorr / 0.1, -1, 1),
      read: `${label(autocorr)} (${dash.phase?.persistenceLabel ?? "n/a"})`
    }
  ]

  const A = scoreGroup(trendItems)
  const B = scoreGroup(momentumItems)
  const C = scoreGroup(volItems)

  const score = clamp(A.score * 0.45 + B.score * 0.35 + C.score * 0.2, -1, 1)
  const groups = [
    { id: "trend", name: "Trend & Structure", weight: 0.45, score: A.score, evidence: A.items },
    { id: "momentum", name: "Momentum & Strength", weight: 0.35, score: B.score, evidence: B.items },
    { id: "volatility", name: "Volatility & Cycle", weight: 0.2, score: C.score, evidence: C.items }
  ]

  return { score, direction: sign(score), groups }
}

// ---------------------------------------------------------------------
// Setups
// ---------------------------------------------------------------------

function buildSetups({ close, atrNow, phase, direction, swing, score, divergences, dash }) {
  const stop = Math.max(atrNow, Math.abs(close) * 0.002)
  const setups = []
  const down = direction === -1

  if ((phase === "trend" || phase === "volatile_trend" || phase === "transition") && direction !== 0) {
    setups.push({
      id: "trend",
      name: "Trend continuation (ATR-scaled)",
      bias: down ? "down" : "up",
      entry: close,
      stop: round(down ? close + stop * 1.5 : close - stop * 1.5),
      target: round(down ? close - stop * 3 : close + stop * 3),
      rr: 2,
      trigger: `Entry at ${label(close)}; stop ${label(stop * 1.5)} away; target 2R. Phase: ${phase}.`,
      valid: true
    })
  }

  if (phase === "compression") {
    const swings = swing
    const hi = swings.highs[0]
    const lo = swings.lows[0]
    if (hi && lo) {
      const mid = (hi.price + lo.price) / 2
      const near = Math.min(Math.abs(close - hi.price), Math.abs(close - lo.price)) / stop
      const closerTop = Math.abs(close - hi.price) <= Math.abs(close - lo.price)
      setups.push({
        id: "breakout",
        name: "Range breakout",
        bias: closerTop ? "up" : "down",
        entry: round(closerTop ? hi.price : lo.price),
        stop: round(closerTop ? mid - stop * 0.5 : mid + stop * 0.5),
        target: round(closerTop ? hi.price + (hi.price - mid) : lo.price - (mid - lo.price)),
        rr: round((hi.price - lo.price) / (stop * 2), 1),
        trigger: `Compression phase; breakout above ${label(hi.price)} or below ${label(lo.price)}. Proximity ${label(near)}×ATR.`,
        valid: near < 8
      })
    }
  }

  if (phase === "quiet_range" || phase === "volatile_range") {
    const bb = dash.bollinger
    if (bb.lower != null && bb.upper != null) {
      setups.push({
        id: "meanrevert",
        name: "Mean reversion (band fade)",
        bias: "up",
        entry: round(bb.lower),
        stop: round(bb.lower - stop),
        target: round(bb.mid),
        rr: round((bb.mid - bb.lower) / stop, 1),
        trigger: `Range regime; fade toward the lower band ${label(bb.lower)} targeting the mid band ${label(bb.mid)}.`,
        valid: true
      })
      setups.push({
        id: "meanrevert-short",
        name: "Mean reversion (band fade, short)",
        bias: "down",
        entry: round(bb.upper),
        stop: round(bb.upper + stop),
        target: round(bb.mid),
        rr: round((bb.upper - bb.mid) / stop, 1),
        trigger: `Range regime; fade the upper band ${label(bb.upper)} targeting the mid band ${label(bb.mid)}.`,
        valid: true
      })
    }
  }

  const div = divergences.find((d) => d.bar >= dash.lastBarIndex - 30)
  if (div) {
    setups.push({
      id: "divergence",
      name: `${div.kind === "bullish" ? "Bullish" : "Bearish"} divergence fade`,
      bias: div.kind,
      entry: close,
      stop: round(div.kind === "bullish" ? close - stop * 1.5 : close + stop * 1.5),
      target: round(div.kind === "bullish" ? close + stop * 3 : close - stop * 3),
      rr: 2,
      trigger: `Confirmed ${div.type.replace("_", " ")} divergence on a momentum oscillator ${div.bar - dash.lastBarIndex} bars old.`,
      valid: true
    })
  }

  return setups.slice(0, 4)
}

// ---------------------------------------------------------------------
// Core orchestration over normalized candles
// ---------------------------------------------------------------------

export function proAnalyzeCandles({ candles, symbol = "?", name = "", currency = "", timeframe = "1d", horizonDays = 3, ensemble = null }) {
  const clean = normalizeCandles(candles)
  if (clean.length < 40) {
    return {
      ok: false,
      error: "need at least 40 clean candles for pro analysis",
      bars: clean.length
    }
  }

  const dash = computeIndicatorDashboard(clean)
  const phase = detectMarketPhase(dash)
  const last = lastIdx(clean)
  const close = clean[last]?.close

  // Recompute the series the dashboard only exposes as scalars, so the
  // confluence model can look at full-length arrays and recent crosses.
  const series = {
    closes: clean.map((c) => c.close),
    ema20: ema(clean.map((c) => c.close), 20),
    ema50: ema(clean.map((c) => c.close), 50),
    ema200: ema(clean.map((c) => c.close), 200),
    psarTrend: parabolicSAR(clean.map((c) => c.high), clean.map((c) => c.low)).trend,
    vwapNow: g(vwap(clean.map((c) => c.high), clean.map((c) => c.low), clean.map((c) => c.close), clean.map((c) => c.volume)))
  }
  dash.phase = phase

  const confluence = buildConfluence({ dash, series, phase, last, close })
  const direction = confluence.direction

  // Statistical ensemble
  const ens = ensemble && ensemble.ok ? ensemble : predictDirection(series.closes, horizonDays)
  const ensDirSign = ens.direction === "up" ? 1 : ens.direction === "down" ? -1 : 0
  const conflicting = ensDirSign !== 0 && direction !== 0 && ensDirSign !== direction

  // Higher-timeframe bias (weekly aggregate)
  const weekly = aggregateCandles(clean, 5)
  let htf = null
  if (weekly.length >= 70) {
    const wDash = computeIndicatorDashboard(weekly)
    const wPhase = detectMarketPhase(wDash)
    let htfBias = 0
    if (wDash.ema.read === "bullish alignment") htfBias = 1
    else if (wDash.ema.read === "bearish alignment") htfBias = -1
    if (wDash.alligator.bull !== 0 && Math.abs(wPhase.regressionR2) >= 0.3) htfBias = wDash.alligator.bull
    else if (Math.abs(wPhase.regressionR2) >= 0.6) htfBias = sign(wDash.linearRegression.slopePct)
    else if (wDash.adx.adx != null && wDash.adx.adx > 25) htfBias = wDash.adx.plusDI > wDash.adx.minusDI ? 1 : -1
    htf = {
      timeframe: "1W",
      bars: weekly.length,
      bias: htfBias,
      biasLabel: htfBias === 1 ? "bullish" : htfBias === -1 ? "bearish" : "mixed",
      phase: wPhase.phase,
      phaseLabel: wPhase.label,
      emaRead: wDash.ema.read,
      alligator: wDash.alligator.label,
      adx: round(wDash.adx.adx),
      r2: round(wPhase.regressionR2, 3),
      last: round(weekly[weekly.length - 1]?.close)
    }
  }

  const ltfBias = sign(confluence.groups.find((gr) => gr.id === "trend").score)
  const aligned = htf && htf.bias !== 0 && ltfBias !== 0 && htf.bias === ltfBias
  const misaligned = htf && htf.bias !== 0 && ltfBias !== 0 && htf.bias !== ltfBias

  // Divergences on four oscillators, most recent kept
  const oscs = [
    ["RSI(14)", rsi(series.closes, 14)],
    ["StochRSI", stochRSI(series.closes).k],
    ["MACD", macd(series.closes).line],
    ["Awesome", awesomeOscillator(clean.map((c) => c.high), clean.map((c) => c.low)).ao]
  ]
  const divergences = []
  for (const [oscName, osc] of oscs) {
    for (const d of findDivergences(series.closes, osc, { maxResults: 2 })) {
      divergences.push({ ...d, oscillator: oscName, ago: last - d.bar })
    }
  }
  divergences.sort((a, b) => a.ago - b.ago)
  const recentDiv = divergences.find((d) => d.ago <= 30)

  // Confidence: blend calibrated ensemble odds with confluence strength,
  // then adjust for regime, alignment, conflicts and divergences.
  const ensConf = Number.isFinite(ens.confidence) ? ens.confidence : 50
  let confidence = Math.round(0.55 * ensConf + 0.45 * (50 + Math.abs(confluence.score) * 40))
  let confidenceNotes = []
  if (conflicting) { confidence -= 8; confidenceNotes.push("statistical ensemble and technical confluence disagree") }
  if (phase.phase === "volatile_range") { confidence -= 8; confidenceNotes.push("high-volatility range regime degrades reliability") }
  if (aligned) { confidence += 5; confidenceNotes.push("weekly and daily bias align") }
  if (misaligned) { confidence -= 8; confidenceNotes.push("weekly and daily bias conflict") }
  if (recentDiv && recentDiv.kind === (confluence.score > 0 ? "bullish" : "bearish")) { confidence += 4; confidenceNotes.push("a recent divergence agrees with the call") }
  if (phase.phase === "compression") { confidence += 2 }
  confidence = clamp(Math.round(confidence), 45, 95)

  let verdict = "NEUTRAL"
  if (phase.phase === "volatile_range" && Math.abs(confluence.score) < 0.4) verdict = "NEUTRAL"
  else if (confluence.score > 0.2) verdict = "BUY"
  else if (confluence.score < -0.2) verdict = "SELL"

  const atrNow = dash.atr.value
  const atrPct = atrNow != null && close ? (atrNow / close) * 100 : null
  const swings = swingPoints(clean.map((c) => c.high), clean.map((c) => c.low), { lookback: 2 })
  const setups = buildSetups({ close, atrNow, phase: phase.phase, direction, swing: swings, score: confluence.score, divergences, dash })

  // Human-readable reasoning, capped in length for chat UIs
  const reasoning = []
  if (phase.label) reasoning.push(`Regime: ${phase.label}.`)
  if (phase.strategy) reasoning.push(phase.strategy)
  for (const gr of confluence.groups) {
    const top = gr.evidence.slice(0, 3).map((e) => `${e.name}: ${e.read}`).join("; ")
    if (top) reasoning.push(`${gr.name} (${label(gr.score)}): ${top}.`)
  }
  if (htf) reasoning.push(`Weekly bias is ${htf.biasLabel} (${htf.phaseLabel}); daily alignment is ${aligned ? "aligned" : misaligned ? "conflicting" : "neutral"}.`)
  if (recentDiv) reasoning.push(`${recentDiv.kind === "bullish" ? "Bullish" : "Bearish"} divergence on ${recentDiv.oscillator} formed ${recentDiv.ago} bars ago (${recentDiv.type.replace("_", " ")}).`)
  if (conflicting) reasoning.push("Caution: the statistical model leans the other way — size down or wait for agreement.")
  if (phase.phase === "volatile_range") reasoning.push("This is a whipsaw regime; both trend and reversal logic have negative edge here.")
  reasoning.push(
    `No trade was placed. Confidence ${confidence}% blends the backtested ensemble (${ens.hitRate ?? "n/a"}% hit rate) with technical confluence — a coin flip is 50%.`
  )

  const honesty =
    `This is an educational technical read, not financial advice. ` +
    `The ensemble's historical hit rate is ${ens.hitRate ?? "n/a"}%, and short-term binary options have negative expected value for most retail traders. ` +
    (confidence < 60 ? "Models disagree right now — treat this as a coin flip, not a signal. " : "") +
    `Indicators lag price and every signal can fail. Risk only what you can lose entirely.`

  return {
    ok: true,
    platform: "ProAnalysis",
    symbol,
    name,
    currency,
    timeframe,
    bars: clean.length,
    last: round(close),
    ensemble: { ...ens, confidence: ensConf },
    phase,
    htf,
    bias: {
      direction: direction === 1 ? "up" : direction === -1 ? "down" : "flat",
      ltf: ltfBias === 1 ? "up" : ltfBias === -1 ? "down" : "flat",
      htf: htf?.biasLabel ?? "n/a",
      aligned
    },
    confluence: {
      score: round(confluence.score, 3),
      direction: confluence.direction === 1 ? "up" : confluence.direction === -1 ? "down" : "flat",
      confidence,
      confidenceNotes,
      verdict,
      groups: confluence.groups.map((gr) => ({ ...gr, score: round(gr.score, 3), evidence: gr.evidence.map((e) => ({ ...e, value: round(e.value), weight: round(e.weight, 2) })) })),
      reasoning
    },
    indicators: {
      last: round(close),
      atr: { value: round(atrNow), pct: round(atrPct, 3) },
      rsi: dash.rsi,
      stochRSI: dash.stochRSI,
      stochastic: dash.stochastic,
      macd: dash.macd,
      adx: dash.adx,
      alligator: dash.alligator,
      psar: dash.psar,
      aroon: dash.aroon,
      cci: dash.cci,
      bollinger: { ...dash.bollinger, bandwidthSeries: undefined, bbUpperSeries: undefined, bbLowerSeries: undefined },
      ema: dash.ema,
      linearRegression: dash.linearRegression,
      williamsR: dash.williamsR,
      cmo: dash.cmo,
      roc: dash.roc,
      momentum: dash.momentum,
      apo: dash.apo,
      awesome: dash.awesome,
      vwap: dash.vwap,
      averagePrice: dash.averagePrice
    },
    divergences: divergences.map((d) => ({
      oscillator: d.oscillator, kind: d.kind, type: d.type, ago: d.ago,
      price: round(d.price), prevBarAgo: last - d.prevBar
    })),
    levels: dash.supportResistance,
    swings: {
      highs: swings.highs.slice(-3).map((s) => ({ price: round(s.price), ago: last - s.index })),
      lows: swings.lows.slice(-3).map((s) => ({ price: round(s.price), ago: last - s.index }))
    },
    setups: setups.filter((s) => s.valid),
    risk: {
      atr: round(atrNow),
      atrPct: round(atrPct, 3),
      suggestedStopPct: atrPct != null ? round(atrPct * 1.5, 3) : null,
      suggestedTargetPct: atrPct != null ? round(atrPct * 3, 3) : null
    },
    chartSeries: dash.chartSeries,
    advisory:
      "Read-only analysis. No order was placed. Backtest and paper-trade any signal before risking capital.",
    honesty
  }
}

// ---------------------------------------------------------------------
// LLM narrative — a human-readable read of a pro-analysis report
// ---------------------------------------------------------------------

function localNarrative(result) {
  const c = result.confluence
  const lines = []
  lines.push(`${result.symbol ?? "Asset"} reads ${c.verdict} (${c.direction}, score ${c.score.toFixed(2)}, confidence ${c.confidence}%).`)
  if (result.phase) lines.push(`Regime: ${result.phase.label}.`)
  if (result.htf) {
    lines.push(`Weekly bias ${result.htf.biasLabel}; ${result.bias?.aligned ? "aligned with the daily read" : "not aligned — be selective"}.`)
  }
  const best = [...c.groups].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0]
  if (best) lines.push(`Strongest signal: ${best.name} (${best.score.toFixed(2)}).`)
  const divs = (result.divergences ?? []).filter((d) => d.ago <= 30)
  if (divs.length) lines.push(`Recent ${divs[0].kind} divergence on ${divs[0].oscillator}.`)
  lines.push(
    c.confidence < 60
      ? "Odds are near coin-flip — wait for model agreement before acting."
      : "Decision support only, not financial advice."
  )
  return lines.join(" ")
}

/**
 * Ask the configured LLM to narrate a pro-analysis report in plain language.
 * Falls back to a rule-based summary when no provider is configured or every
 * provider fails.
 */
export async function summarizeProAnalysis(result) {
  if (!result || !result.ok || !result.confluence) {
    return { ok: false, error: "a valid pro-analysis report is required" }
  }
  if (!llmConfigured()) {
    return { ok: true, source: "local", summary: localNarrative(result) }
  }
  const ctx = {
    symbol: result.symbol,
    last: result.last,
    timeframe: result.timeframe,
    verdict: result.confluence.verdict,
    direction: result.confluence.direction,
    score: result.confluence.score,
    confidence: result.confluence.confidence,
    regime: result.phase?.phase,
    regimeLabel: result.phase?.label,
    htfBias: result.htf?.biasLabel,
    htfAligned: result.bias?.aligned,
    divergences: (result.divergences ?? []).slice(0, 3).map((d) => `${d.kind} ${d.oscillator} ${d.ago} bars ago`),
    setups: (result.setups ?? []).slice(0, 3).map((s) => s.name),
    groupScores: Object.fromEntries(result.confluence.groups.map((g) => [g.id, g.score])),
    ensemble: {
      direction: result.ensemble?.direction,
      confidence: result.ensemble?.confidence,
      hitRate: result.ensemble?.hitRate
    }
  }
  const system =
    "You are PICC's technical analyst. Write a short honest narrative (max 120 words, plain text, no markdown, no emoji) explaining " +
    "the confluence report in human terms. State the verdict, why the evidence points that way, the biggest counter-arguments, and " +
    "end with one line reminding this is decision support, not financial advice."
  try {
    const summary = await chatText(system, `Here is the Pro Analysis report:\n${JSON.stringify(ctx, null, 2)}`)
    return { ok: true, source: "llm", provider: llmProvider(), summary }
  } catch (err) {
    return { ok: true, source: "local", summary: localNarrative(result), error: err.message }
  }
}

// ---------------------------------------------------------------------
// Data-source entry points
// ---------------------------------------------------------------------

/** Pro analysis over Yahoo Finance history (free, no login). */
export async function proAnalyzeSymbol(symbol, { range = "2y", interval = "1d", horizonDays = 3 } = {}) {
  if (!symbol) throw new Error("symbol required")
  const history = await getHistory(String(symbol).trim(), range, interval)
  const candles = history.closes.map((close, i) => ({
    time: history.dates[i] ?? i,
    open: history.opens?.[i] ?? close,
    high: history.highs?.[i] ?? close,
    low: history.lows?.[i] ?? close,
    close,
    volume: history.volumes?.[i] ?? 0
  }))
  const result = proAnalyzeCandles({
    candles,
    symbol: history.symbol,
    name: history.name,
    currency: history.currency,
    timeframe: interval,
    horizonDays
  })
  if (!result.ok) return result
  return { ...result, platform: "Yahoo", lastPrice: history.lastPrice }
}

/** Pro analysis over live ExpertOption candles for a configured account. */
export async function proAnalyzeExpertOption({ assetId, timeframe = 60, count = 240, horizonDays = 3 }) {
  const creds = await getCredentials()
  if (!creds.expertoptionToken) {
    throw new Error("ExpertOption not configured — add your session token in the Trading Suite settings first")
  }
  const session = await connectSession({
    token: creds.expertoptionToken,
    isDemo: creds.expertoptionDemo,
    wsUrl: creds.expertoptionWsUrl
  })
  try {
    const [profile, candles, balance] = await Promise.allSettled([
      session.assets(),
      session.candles(assetId, timeframe, count),
      session.balance()
    ])
    const balanceData = balance.status === "fulfilled" ? balance.value : { balance: null, currency: null, demo: null }
    let asset = null
    if (profile.status === "fulfilled") {
      const found = assetsFrom(profile.value).find((a) => a.id === String(assetId))
      asset = found ?? null
    }
    if (candles.status !== "fulfilled") {
      throw new Error(`candle history failed: ${candles.reason?.message ?? "unknown"}`)
    }
    const raw = candlesFrom(candles.value)
    const result = proAnalyzeCandles({
      candles: raw.ohlc ?? [],
      symbol: asset?.name ?? String(assetId),
      name: asset?.name ?? String(assetId),
      currency: "USD",
      timeframe: `${timeframe}s`,
      horizonDays
    })
    if (!result.ok) return result
    return { ...result, platform: "ExpertOption", account: balanceData, timeframe: `${timeframe}s` }
  } finally {
    session.close()
  }
}
