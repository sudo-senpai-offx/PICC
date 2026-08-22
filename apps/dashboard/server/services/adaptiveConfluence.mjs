// PICC Adaptive Confluence — realtime decision engine for binary-option expiry
// selection, built on top of the live ExpertOption buffers (liveEO.mjs).
//
// For every watched asset it computes a confluence read (trend / momentum /
// volatility / tick-activity volume), then runs a COMPOSITE honesty gate before
// ever suggesting a trade:
//
//   1. price-path R:R   — median favorable excursion / median adverse excursion
//                         within the expiry must be >= 2:1 (empirical MFFE/MAE);
//   2. EV-weighted R:R  — (winProb x payout) / ((1 - winProb) x 1) >= 2:1
//                         (the "confluence-strength implied R:R");
//   3. literal payout   — the assumed/observed payout must beat the break-even
//                         payout for the estimated win probability with margin;
//   4. win probability  — empirical continuation hit rate, damped toward 0.5;
//   5. score/phase      — minimum confluence strength, and whipsaw regimes can
//                         only produce OBSERVE, never TRADE.
//
// Decision support only. Nothing here trades. TRADE verdicts are logged to the
// paper signals ledger (rate-limited) so accuracy can be tracked honestly, and
// the same decisions stream over /api/trading/realtime and the on-demand
// /api/trading/decisions endpoint.

import { computeIndicatorDashboard, detectMarketPhase } from "./indicators.mjs"
import { liveEOData, subscribeLiveEO } from "./liveEO.mjs"
import { recordSignal } from "./trading.mjs"
import { recordDecision } from "./accuracyLedger.mjs"
import { getSentiment } from "./sentimentEngine.mjs"
import { quickMtfCheck } from "./multiTimeframe.mjs"

export const CANDIDATE_EXPIRIES = [60, 120, 300, 900] // seconds (15s excluded: 60s bar resolution can't estimate it honestly)
export const ASSUMED_PAYOUT = { 60: 82, 120: 85, 300: 88, 900: 90 } // % per expiry, conservative
export const ANALYSIS_PERIOD = 60
export const MIN_BARS = 40
export const PRICE_RR_MIN = 2
export const EV_RR_MIN = 2
export const PAYOUT_MARGIN = 1.15
export const MIN_WIN_PROB = 0.52
export const MIN_SCORE = 0.15
export const MAX_LOOKAHEAD_BARS = 15
export const DECISION_INTERVAL_MS = 15_000
export const LEDGER_LOG_COOLDOWN_MS = 10 * 60 * 1000

const EPS = 1e-12
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const sign = (v) => (Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1)
const round = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)
const median = (arr) => {
  const a = [...arr].filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

// ---------------------------------------------------------------------
// Candle helpers
// ---------------------------------------------------------------------

function cleanCandles(ohlc) {
  if (!Array.isArray(ohlc)) return []
  return ohlc
    .map((c) => {
      const close = Number(c.close ?? c.c)
      const open = Number(c.open ?? c.o) || close
      const high = Number(c.high ?? c.h) || Math.max(open, close)
      const low = Number(c.low ?? c.l) || Math.min(open, close)
      const time = Number(c.time ?? c.t) || 0
      return Number.isFinite(close) && close > 0 ? { time, open, high, low, close } : null
    })
    .filter(Boolean)
}

function arraysOf(candles) {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const opens = candles.map((c) => c.open)
  const times = candles.map((c) => c.time)
  return { closes, highs, lows, opens, times }
}

// ---------------------------------------------------------------------
// Confluence read (trend / momentum / volatility / tick-activity volume)
// ---------------------------------------------------------------------

export function confluenceRead(candles, volume) {
  const clean = cleanCandles(candles)
  if (clean.length < MIN_BARS) {
    return { ok: false, error: `need at least ${MIN_BARS} candles`, bars: clean.length }
  }
  const firstClose = clean[0].close
  if (clean.every((c) => c.close === firstClose)) {
    // No price movement at all — zero information, never a trade.
    return {
      ok: true,
      bars: clean.length,
      score: 0,
      direction: 0,
      phase: "flat",
      phaseLabel: "Flat — no price movement",
      quadrant: "flat",
      phaseTrend: "flat",
      adx: null,
      atr: 0,
      atrPct: 0,
      groups: { trend: 0, momentum: 0, volatility: 0, volume: 0 },
      volume: { proxy: "tick-activity", ratePerMin: null, delta: null, upRatio: null, bars: 0 },
      persistence: 0,
      last: firstClose
    }
  }
  const dash = computeIndicatorDashboard(clean)
  const phase = detectMarketPhase(dash)
  const last = clean.length - 1
  const close = clean[last].close
  const ema20 = dash.ema.ema20
  const ema50 = dash.ema.ema50
  const scale = Math.max(Math.abs(close) * 0.004, EPS)

  const trendItems = [
    dash.alligator.bull ?? 0,
    close != null && ema20 != null ? (close > ema20 ? 1 : close < ema20 ? -1 : 0) : 0,
    ema20 != null && ema50 != null ? (ema20 > ema50 ? 1 : ema20 < ema50 ? -1 : 0) : 0,
    dash.macd.line != null ? sign(dash.macd.line) : 0,
    dash.psar.trend === "bullish" ? 1 : dash.psar.trend === "bearish" ? -1 : 0,
    dash.linearRegression.slopePct != null ? clamp(dash.linearRegression.slopePct / 0.15, -1, 1) : 0
  ]
  const trendScore = clamp(trendItems.reduce((a, b) => a + b, 0) / trendItems.length, -1, 1)

  const rsiVal = dash.rsi.value
  let rsiBull = rsiVal != null ? (rsiVal - 50) / 50 : 0
  if ((phase.phase === "quiet_range" || phase.phase === "volatile_range") && rsiVal != null) {
    rsiBull = rsiVal > 70 ? -1 : rsiVal < 30 ? 1 : rsiBull
  }
  const momItems = [
    rsiBull,
    dash.stochastic.cross === "bullish" ? 1 : dash.stochastic.cross === "bearish" ? -1 : 0,
    dash.macd.hist != null ? sign(dash.macd.hist) : 0,
    dash.awesome.value > 0 ? 1 : dash.awesome.value < 0 ? -1 : 0,
    dash.cmo != null ? sign(dash.cmo) * Math.min(1, Math.abs(dash.cmo) / 50) : 0,
    dash.momentum != null ? sign(dash.momentum) * Math.min(1, Math.abs(dash.momentum) / scale) : 0
  ]
  const momScore = clamp(momItems.reduce((a, b) => a + b, 0) / momItems.length, -1, 1)

  const autocorr = Number.isFinite(dash.autocorrelation) ? dash.autocorrelation : 0
  const slopeDir = dash.linearRegression.slopePct != null
    ? dash.linearRegression.slopePct > 0 ? 1 : dash.linearRegression.slopePct < 0 ? -1 : 0
    : 0
  const volScore = clamp(
    (phase.phase === "trend" || phase.phase === "volatile_trend" ? slopeDir : 0) * 0.5 +
      clamp(autocorr / 0.1, -1, 1) * 0.5,
    -1,
    1
  )

  // Tick-activity volume proxy: participation + direction split.
  let volGroupScore = 0
  const volumeOut = {
    proxy: "tick-activity",
    ratePerMin: null,
    delta: null,
    upRatio: null,
    bars: 0
  }
  if (volume && Array.isArray(volume.profile) && volume.profile.length) {
    const recent = volume.profile.slice(-12)
    const up = recent.reduce((a, b) => a + (b.up ?? 0), 0)
    const down = recent.reduce((a, b) => a + (b.down ?? 0), 0)
    const total = up + down
    const spanSec = recent.length ? Math.max(1, recent[recent.length - 1].t - recent[0].t) : 0
    volumeOut.ratePerMin = spanSec > 0 ? Math.round((total / spanSec) * 60) : null
    volumeOut.delta = up - down
    volumeOut.upRatio = total > 0 ? up / total : null
    volumeOut.bars = recent.length
    // Directional tick pressure agrees with the momentum read.
    const pressure = total > 0 ? (up - down) / total : 0
    const momSign = sign(momScore)
    volGroupScore = momSign !== 0 && pressure !== 0 ? clamp(pressure, -1, 1) * (Math.sign(pressure) === momSign ? 0.5 : -0.25) : 0
  }

  const groups = {
    trend: round(trendScore),
    momentum: round(momScore),
    volatility: round(volScore),
    volume: round(volGroupScore)
  }
  // Trend carries most weight in a trend regime; momentum in a range.
  const regime = phase.phase
  const wTrend = regime === "trend" || regime === "volatile_trend" ? 0.5 : 0.35
  const wMom = regime === "quiet_range" || regime === "volatile_range" ? 0.4 : 0.3
  const score = round(clamp(trendScore * wTrend + momScore * wMom + volScore * 0.15 + volGroupScore * 0.1, -1, 1))

  return {
    ok: true,
    bars: clean.length,
    score,
    direction: sign(score),
    phase: phase.phase,
    phaseLabel: phase.label,
    quadrant: phase.quadrant,
    phaseTrend: phase.trend,
    adx: phase.trendStrength,
    atr: dash.atr.value,
    atrPct: dash.atr.value != null && close ? (dash.atr.value / close) * 100 : null,
    groups,
    volume: volumeOut,
    persistence: autocorr,
    last: close
  }
}

// ---------------------------------------------------------------------
// Win probability — empirical continuation hit rate, damped toward 0.5
// ---------------------------------------------------------------------

export function winProbEstimate({ closes, times = null, period = ANALYSIS_PERIOD, direction, expiry, minWinProb = MIN_WIN_PROB, maxSample = 24 } = {}) {
  if (!Array.isArray(closes) || closes.length < 12 || direction === 0) {
    return { winProb: minWinProb, empirical: null, sampleSize: 0, k: 0 }
  }
  const k = Math.max(1, Math.round(Number(expiry) / Number(period) || 1))
  const last = closes.length - 1
  const need = Math.min(maxSample, Math.max(6, last - k))
  const up = direction > 0
  let wins = 0
  let n = 0
  const startIdx = Math.max(0, last - k - need)
  for (let i = startIdx; i <= last - k; i++) {
    const delta = closes[i + k] - closes[i]
    if (Math.abs(delta) <= EPS) continue
    n += 1
    if (up ? delta > 0 : delta < 0) wins += 1
  }
  if (n < 6) return { winProb: minWinProb, empirical: null, sampleSize: n, k }
  const empirical = wins / n
  // Damp the empirical rate toward 0.5 the smaller the sample (honest — a
  // handful of bars is near noise). The clamp floor is the symmetric
  // counterpart of the no-sample floor (1 - minWinProb) so genuinely losing
  // markets can score below 0.52 instead of being artificially inflated toward
  // a TRADE.
  const damp = Math.min(1, n / 20)
  const winProb = clamp(0.5 + (empirical - 0.5) * damp, 1 - minWinProb, 0.95)
  return { winProb, empirical: round(empirical, 4), sampleSize: n, k }
}

// ---------------------------------------------------------------------
// Multi-timeframe confirmation
// ---------------------------------------------------------------------

/**
 * Check if higher timeframes agree with the primary (60s) direction.
 * Uses the liveEO asset's periods map: [60, 300, 900] (1m, 5m, 15m).
 * Returns a confidence boost/penalty and a list of agreeing TFs.
 */
export function mtfConfirm({ asset, primaryDirection, primaryPeriod = 60 } = {}) {
  if (!asset || primaryDirection === 0) return { agree: 0, total: 0, boost: 0, tfDetails: [] }
  const periods = asset.periods || {}
  const tfSeconds = [300, 900] // check 5m and 15m against the 1m primary
  const details = []
  let agree = 0
  let checked = 0
  for (const tf of tfSeconds) {
    const candles = periods[tf]
    if (!Array.isArray(candles) || candles.length < 12) continue
    checked += 1
    const closes = candles.map((c) => Number(c.close ?? c.c)).filter((v) => Number.isFinite(v) && v > 0)
    if (closes.length < 12) continue
    // Simple EMA-12 direction on higher TF
    let sum = 0
    let weight = 0
    const alpha = 2 / (12 + 1)
    let ema = closes[0]
    for (let i = 1; i < closes.length; i++) {
      ema = alpha * closes[i] + (1 - alpha) * ema
    }
    const emaShort = (() => { let e = closes[0]; for (let i = 1; i < closes.length; i++) { e = 2 / (5 + 1) * closes[i] + (1 - 2 / (5 + 1)) * e } return e })()
    const tfDir = Math.abs(emaShort - ema) < 1e-12 ? 0 : emaShort > ema ? 1 : -1
    const matches = tfDir === primaryDirection
    if (matches) agree += 1
    details.push({ tf, dir: tfDir, matches })
  }
  // Boost: +0.05 per agreeing higher TF, -0.03 per disagreeing
  const boost = checked > 0 ? (agree * 0.05 - (checked - agree) * 0.03) : 0
  return { agree, total: checked, boost: round(boost, 4), tfDetails: details }
}

// ---------------------------------------------------------------------
// Sentiment scoring (news + social)
// ---------------------------------------------------------------------

/**
 * Fetch current sentiment for an asset symbol and return a confluence weight.
 * Positive = bullish alignment, negative = bearish, 0 = neutral/no data.
 */
async function sentimentScore(symbol, { timeoutMs = 4000 } = {}) {
  if (!symbol) return { score: 0, source: "none", detail: null }
  let timer = null
  try {
    timer = setTimeout(() => {}, timeoutMs)
    const result = await Promise.race([
      getSentiment(String(symbol).toUpperCase()),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) })
    ])
    if (!result) return { score: 0, source: "timeout", detail: null }
    const compositeScore = result.composite?.score ?? 0
    return { score: clamp(compositeScore, -1, 1), source: result.composite?.label || "fusion", detail: result }
  } catch {
    return { score: 0, source: "error", detail: null }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------
// MTTD — mean time to a directional target move (guides expiry choice)
// ---------------------------------------------------------------------

export function mttdEstimate({ candles, direction, atrMult = 0.25, maxLookahead = MAX_LOOKAHEAD_BARS, minHits = 2 } = {}) {
  const clean = cleanCandles(candles)
  if (clean.length < 30 || direction === 0) return { mttdSec: null, hits: 0, target: null }
  const { closes, times } = arraysOf(clean)
  const dash = computeIndicatorDashboard(clean)
  const atrNow = dash.atr.value
  if (!Number.isFinite(atrNow) || atrNow <= 0) return { mttdSec: null, hits: 0, target: null }
  const target = atrNow * atrMult
  const last = closes.length - 1
  const timesSec = times.every((t) => t > 0) ? times : null
  const hitTimes = []
  const starts = Math.min(20, Math.max(6, last - maxLookahead))
  for (let i = 0; i <= last - maxLookahead; i++) {
    const base = closes[i]
    let hit = null
    for (let j = i + 1; j <= Math.min(last, i + maxLookahead); j++) {
      const moved = direction > 0 ? closes[j] - base : base - closes[j]
      if (moved >= target) {
        hit = j
        break
      }
    }
    if (hit != null) {
      const sec = timesSec ? Math.max(1, timesSec[hit] - timesSec[i]) : (hit - i) * ANALYSIS_PERIOD
      hitTimes.push(sec)
    }
  }
  if (hitTimes.length < minHits) return { mttdSec: null, hits: hitTimes.length, target: round(target, 6) }
  return { mttdSec: Math.round(median(hitTimes)), hits: hitTimes.length, target: round(target, 6) }
}

// ---------------------------------------------------------------------
// Price-path R:R — median favorable vs adverse excursion within the expiry
// ---------------------------------------------------------------------

export function pricePathRR({ candles, direction, expiry, period = ANALYSIS_PERIOD } = {}) {
  const clean = cleanCandles(candles)
  if (clean.length < 20 || direction === 0) return { favorable: null, adverse: null, rr: null }
  const { closes, times } = arraysOf(clean)
  const k = Math.max(1, Math.round(Number(expiry) / Number(period) || 1))
  const last = closes.length - 1
  const favorites = []
  const adverses = []
  const up = direction > 0
  for (let i = 0; i <= last - k; i++) {
    const base = closes[i]
    let fav = 0
    let adv = 0
    for (let j = i + 1; j <= i + k; j++) {
      const d = closes[j] - base
      if (up) {
        fav = Math.max(fav, d)
        adv = Math.min(adv, d)
      } else {
        fav = Math.max(fav, -d)
        adv = Math.min(adv, -d)
      }
    }
    favorites.push(fav)
    adverses.push(Math.abs(adv))
  }
  const f = median(favorites)
  const a = median(adverses)
  if (f == null || a == null || a <= EPS) return { favorable: round(f), adverse: round(a), rr: a <= EPS && f > 0 ? 10 : null }
  return { favorable: round(f), adverse: round(a), rr: round(f / a, 2) }
}

// ---------------------------------------------------------------------
// EV gate — payout-aware expected value per $1 stake
// ---------------------------------------------------------------------

export function evGate({ winProb, payoutPct, margin = PAYOUT_MARGIN, evRRMin = EV_RR_MIN }) {
  const p = Number(winProb)
  const pay = Number(payoutPct)
  if (!Number.isFinite(p) || !Number.isFinite(pay) || p <= 0 || p >= 1 || pay <= 0) {
    return { ev: null, evPerWin: null, breakevenPayout: null, payoutBeats: false, evRR: null, evRRPass: false }
  }
  const ev = p * (pay / 100) - (1 - p) // EV per $1 staked
  const breakevenPayout = (100 * (1 - p)) / p // payout % that makes EV = 0
  const evRR = (p * (pay / 100)) / ((1 - p) * 1) // win-weighted reward per risk unit
  return {
    ev: round(ev, 4),
    evPerWin: round((p * (pay / 100)) / (1 - p), 4),
    breakevenPayout: round(breakevenPayout, 2),
    payoutBeats: pay >= breakevenPayout * margin,
    evRR: round(evRR, 2),
    evRRPass: evRR >= evRRMin
  }
}

// ---------------------------------------------------------------------
// Single-asset evaluation across candidate expiries
// ---------------------------------------------------------------------

export function evaluateAsset({ id, name, candles, volume, observedPayout = null, now = Date.now(), period = ANALYSIS_PERIOD, asset = null, sentimentOverride = null } = {}) {
  const read = confluenceRead(candles, volume)
  if (!read.ok || read.direction === 0) {
    return {
      assetId: id,
      asset: name ?? id,
      verdict: "NEUTRAL",
      direction: "flat",
      score: read.ok ? read.score : null,
      confidence: null,
      phase: read.ok ? read.phase : null,
      phaseLabel: read.ok ? read.phaseLabel : null,
      expiry: null,
      winProb: null,
      ev: null,
      payout: null,
      payoutSource: null,
      bars: read.bars,
      reasons: read.ok ? ["no directional confluence — stand aside"] : [read.error],
      ts: now
    }
  }
  const { closes, times } = arraysOf(cleanCandles(candles))
  const direction = read.direction

  // Multi-timeframe confirmation using full indicator dashboard (not just EMA)
  const mtf = quickMtfCheck(asset, direction)

  // Sentiment score (pre-fetched or passed in)
  const sent = sentimentOverride ?? { score: 0, source: "none" }
  // Regime-adaptive sentiment weighting:
  //   Trending:  sentiment CONFIRMS the trend — amplify bullish/bearish alignment
  //   Ranging:   sentiment is CONTRARIAN at extremes — flip when very strong
  //   Volatile:  sentiment is noise — minimize impact
  //   Breakout:  sentiment confirms the breakout direction
  const sentimentAligned = sent.score * direction > 0
  const absScore = Math.abs(sent.score)
  let sentimentBoost = 0
  const regime = read.phase
  if (absScore > 0.1) {
    if (regime === "trend" || regime === "volatile_trend") {
      // Trending: confirm sentiment with the trend — stronger boost for aligned
      sentimentBoost = sentimentAligned
        ? 0.08 * absScore   // confirming: +8% of sentiment magnitude
        : -0.04 * absScore  // opposing: mild penalty
    } else if (regime === "quiet_range" || regime === "volatile_range") {
      // Ranging: contrarian at extremes (>0.6), confirming at moderate levels
      if (absScore > 0.6) {
        sentimentBoost = sentimentAligned
          ? -0.03 * absScore  // extreme + aligned = crowded trade, penalty
          : 0.05 * absScore   // extreme + opposing = contrarian opportunity, bonus
      } else {
        sentimentBoost = sentimentAligned
          ? 0.04 * absScore   // moderate + aligned = mild confirmation
          : -0.02 * absScore  // moderate + opposing = mild noise
      }
    } else {
      // Breakout or unknown: default confirming behavior
      sentimentBoost = sentimentAligned
        ? 0.05 * absScore
        : -0.06 * absScore
    }
  }

  const expiryRuns = CANDIDATE_EXPIRIES.map((expiry) => {
    const wp = winProbEstimate({ closes, times, period, direction, expiry })
    const pay = observedPayout?.[`${id}:${expiry}`] ?? ASSUMED_PAYOUT[expiry]
    const gate = evGate({ winProb: wp.winProb, payoutPct: pay })
    const rr = pricePathRR({ candles, direction, expiry, period })
    const mttd = mttdEstimate({ candles, direction })

    const gates = {
      score: Math.abs(read.score) >= MIN_SCORE,
      winProb: wp.winProb >= MIN_WIN_PROB,
      priceRR: rr.rr != null && rr.rr >= PRICE_RR_MIN,
      evRR: gate.evRRPass,
      payout: gate.payoutBeats
    }
    const passCount = Object.values(gates).filter(Boolean).length
    let verdict
    // MTF veto: if higher TFs strongly disagree (0 agree out of 2 checked), block TRADE
    const mtfBlock = mtf.total >= 2 && mtf.agree === 0
    if (passCount === 5 && read.phase !== "volatile_range" && !mtfBlock) verdict = "TRADE"
    else if (passCount >= 3 && Math.abs(read.score) >= MIN_SCORE * 0.5) verdict = "OBSERVE"
    else verdict = "NEUTRAL"

    // Confidence is honest, regime-adjusted, MTF-adjusted, and sentiment-adjusted.
    let confidence = 55 + Math.abs(read.score) * 30 + (wp.winProb - 0.5) * 80
    if (read.phase === "volatile_range") confidence -= 8
    if (wp.sampleSize < 12) confidence -= 5
    confidence += mtf.boost * 100 // MTF agreement/disagreement adjustment
    confidence += sentimentBoost * 100 // sentiment alignment adjustment
    confidence = clamp(Math.round(confidence), 45, 92)

    return {
      expiry,
      direction: direction > 0 ? "up" : "down",
      verdict,
      winProb: round(wp.winProb, 4),
      empirical: wp.empirical,
      sampled: wp.sampleSize,
      payout: pay,
      payoutSource: observedPayout?.[`${id}:${expiry}`] ? "observed" : "assumed",
      ev: gate.ev,
      breakevenPayout: gate.breakevenPayout,
      evRR: gate.evRR,
      priceRR: rr.rr,
      favorable: rr.favorable,
      adverse: rr.adverse,
      mttdSec: mttd.mttdSec,
      gates,
      confidence,
      mtf: { agree: mtf.agree, total: mtf.total, details: mtf.tfDetails },
      sentiment: { score: round(sent.score, 4), source: sent.source, aligned: sentimentAligned }
    }
  })

  const rank = { TRADE: 0, OBSERVE: 1, NEUTRAL: 2 }
  const byValue = (a, b) => {
    if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict]
    if (a.verdict === "TRADE") return b.ev - a.ev
    return Math.abs(b.winProb - 0.5) - Math.abs(a.winProb - 0.5)
  }
  const best = [...expiryRuns].sort(byValue)[0]

  const reasons = []
  if (read.phaseLabel) reasons.push(read.phaseLabel)
  if (best.verdict === "TRADE") {
    reasons.push(
      `est. win prob ${(best.winProb * 100).toFixed(0)}% (empirical ${best.empirical != null ? (best.empirical * 100).toFixed(0) + "%" : "n/a"}, n=${best.sampled})`,
      `price-path R:R ${best.priceRR ?? "n/a"} (fav ${best.favorable ?? "n/a"} / adv ${best.adverse ?? "n/a"})`,
      `payout ${best.payout}% (${best.payoutSource}) vs break-even ${best.breakevenPayout}% — EV ${best.ev != null ? (best.ev * 100).toFixed(1) + "%/stake" : "n/a"}`,
      `MTTD to 0.25×ATR ≈ ${best.mttdSec != null ? best.mttdSec + "s" : "n/a"}`
    )
  } else if (best.verdict === "OBSERVE") {
    const missing = Object.entries(best.gates).filter(([, v]) => !v).map(([k]) => k)
    reasons.push(`gates not all met (${missing.join(", ")}) — ${best.expiry}s at ${best.winProb != null ? (best.winProb * 100).toFixed(0) + "%" : "?"} win prob, payout ${best.payout}%`)
  } else {
    reasons.push("no candidate expiry clears enough gates")
  }
  reasons.push("decision support only — no order is placed")

  return {
    assetId: id,
    asset: name ?? id,
    verdict: best.verdict,
    direction: best.direction,
    score: read.score,
    confidence: best.confidence,
    phase: read.phase,
    phaseLabel: read.phaseLabel,
    quadrant: read.quadrant,
    adx: read.adx,
    atrPct: read.atrPct,
    expiry: best.expiry,
    winProb: best.winProb,
    empirical: best.empirical,
    sampled: best.sampled,
    ev: best.ev,
    payout: best.payout,
    payoutSource: best.payoutSource,
    evRR: best.evRR,
    priceRR: best.priceRR,
    favorable: best.favorable,
    adverse: best.adverse,
    mttdSec: best.mttdSec,
    gates: best.gates,
    groups: read.groups,
    volume: read.volume,
    bars: read.bars,
    reasons,
    ts: now
  }
}

// ---------------------------------------------------------------------
// Watch-set decisions
// ---------------------------------------------------------------------

export async function decideAssets({ data, observedPayout = null, now = Date.now() } = {}) {
  const assets = Array.isArray(data?.assets) ? data.assets : []
  const sentimentMap = await Promise.all(
    assets.map(async (a) => {
      try {
        return { id: a.id, ...(await sentimentScore(a.name || a.id)) }
      } catch {
        return { id: a.id, score: 0, source: "error" }
      }
    })
  ).then((list) => {
    const map = {}
    for (const s of list) map[s.id] = s
    return map
  }).catch(() => ({}))

  const out = assets
    .map((a) => {
      const candles = a?.periods?.[ANALYSIS_PERIOD] ?? []
      if (!Array.isArray(candles) || candles.length < MIN_BARS) return null
      return evaluateAsset({ id: a.id, name: a.name, candles, volume: a.ticks, observedPayout, now, asset: a, sentimentOverride: sentimentMap[a.id] || null })
    })
    .filter(Boolean)
  const rank = { TRADE: 0, OBSERVE: 1, NEUTRAL: 2 }
  out.sort((x, y) => rank[x.verdict] - rank[y.verdict] || (y.verdict === "TRADE" ? (y.ev ?? 0) - (x.ev ?? 0) : 0))
  return out
}

// ---------------------------------------------------------------------
// Runtime: periodic evaluation + SSE events + ledger logging
// ---------------------------------------------------------------------

let liveOff = null
let timer = null
let cached = null
let cachedAt = 0
let inflight = null
const decisionSubs = new Set()
const logCooldowns = new Map()

function emitDecisions() {
  if (!cached) return
  const msg = { type: "decision", ts: cached.ts, ...cached }
  for (const cb of decisionSubs) {
    try {
      cb(msg)
    } catch {
      /* subscriber errors never break the stream */
    }
  }
}

function observedMapFromDeals(deals) {
  const map = {}
  for (const d of deals) {
    const key = `${d.assetId ?? d.asset}:${d.duration ?? d.expiry}`
    const pay = Number(d.payout)
    if (Number.isFinite(pay) && pay > 0) map[key] = Math.round(pay)
  }
  return map
}

async function loadObservedPayouts() {
  try {
    const { demoDeals } = await import("./autopilot.mjs")
    const res = await demoDeals(50)
    const deals = Array.isArray(res) ? res : res?.deals ?? []
    return observedMapFromDeals(deals)
  } catch {
    return {}
  }
}

/**
 * Observed-payout inspector — the actual demo-deal payouts the engine will use
 * instead of the assumed schedule, keyed `${assetId}:${expiry}`.
 */
export async function observedPayouts({ limit = 200 } = {}) {
  try {
    const { demoDeals } = await import("./autopilot.mjs")
    const res = await demoDeals(500)
    const deals = Array.isArray(res) ? res : res?.deals ?? []
    const map = observedMapFromDeals(deals)
    const entries = Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }))
      .slice(0, Math.max(1, Number(limit) || 200))
    return {
      ok: true,
      source: "demo-deals",
      total: Object.keys(map).length,
      sampled: deals.length,
      entries
    }
  } catch (err) {
    return { ok: false, error: String(err), source: "demo-deals", total: 0, sampled: 0, entries: [] }
  }
}

async function logTradeVerdicts(decisions) {
  const now = Date.now()
  for (const d of decisions) {
    if (d.verdict !== "TRADE" || d.expiry == null) continue
    const key = `${d.assetId}:${d.expiry}`
    const last = logCooldowns.get(key) ?? 0
    if (now - last < LEDGER_LOG_COOLDOWN_MS) continue
    logCooldowns.set(key, now)
    if (logCooldowns.size > 400) logCooldowns.clear()
    try {
      await recordSignal({
        symbol: d.asset,
        direction: d.direction,
        confidence: d.confidence,
        strength: d.score,
        source: "adaptive-confluence",
        note:
          `${d.phase ?? "?"} · expiry ${d.expiry}s · winProb ${d.winProb != null ? Math.round(d.winProb * 100) : "?"}% ` +
          `(n=${d.sampled}) · EV ${d.ev != null ? Math.round(d.ev * 100) + "%/stake" : "?"} · payout ${d.payout}% (${d.payoutSource}) · ` +
          `priceRR ${d.priceRR ?? "?"} · gates ${JSON.stringify(d.gates)}`
      })
    } catch {
      /* ledger write must never break the engine */
    }
    try {
      recordDecision(d)
    } catch {
      /* accuracy ledger write must never break the engine */
    }
  }
}

async function computeNow() {
  const data = liveEOData()
  const observedPayout = await loadObservedPayouts()
  const decisions = await decideAssets({ data, observedPayout, now: Date.now() })
  cached = {
    ts: Date.now(),
    status: data.status,
    mode: data.mode,
    account: data.account,
    viewed: data.viewed,
    decisions
  }
  cachedAt = cached.ts
  emitDecisions()
  // Fire-and-forget: verdict logging does serial file I/O under the ledger
  // lock; awaiting it here made every cold computeNow take ~20s and blocked
  // /decisions, /intel and the first `suite` event. The ledger write must never
  // gate the engine's response (and it already fails closed internally).
  void logTradeVerdicts(decisions).catch(() => {})
  return cached
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    computeNow().catch(() => {})
    schedule()
  }, DECISION_INTERVAL_MS)
}

function startEngine() {
  if (liveOff) return
  liveOff = subscribeLiveEO(() => {}) // keep the live layer warm
  void computeNow().catch(() => {})
  schedule()
}

/** Boot-time entry point — keeps the decision engine running unconditionally. */
export function startDecisionEngine() {
  startEngine()
}

export function stopDecisionEngine() {
  clearTimeout(timer)
  timer = null
  if (liveOff) {
    try {
      liveOff()
    } catch {
      /* ignore */
    }
    liveOff = null
  }
  decisionSubs.clear()
  cached = null
  cachedAt = 0
}

export function subscribeDecisions(cb) {
  decisionSubs.add(cb)
  if (!liveOff) startEngine()
  if (cached) {
    try {
      cb({ type: "decision", ts: cached.ts, ...cached })
    } catch {
      /* ignore */
    }
  }
  return () => {
    decisionSubs.delete(cb)
    if (decisionSubs.size === 0) stopDecisionEngine()
  }
}

export async function getDecisions() {
  if (cached && Date.now() - cachedAt < 8000) return cached
  // Dedupe concurrent callers: every REST/SSE/suite/intel request used to start
  // its own cold computeNow() (up to ~20s each, hitting the same files) — now
  // they all share one in-flight computation.
  if (inflight) return inflight
  inflight = (async () => {
    try {
      return await computeNow()
    } finally {
      inflight = null
    }
  })()
  return inflight
}
