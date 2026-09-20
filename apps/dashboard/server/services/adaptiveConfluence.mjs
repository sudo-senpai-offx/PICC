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
import { getBrokerData, subscribeBroker } from "./brokers/index.mjs"
import { mergeCCXTAssets } from "./liveCCXT.mjs"
import { recordSignal } from "./trading.mjs"
import { recordDecision, correctlyAnsweredByEngine } from "./accuracyLedger.mjs"
import { flipGate } from "./constitution.mjs"
import { getSentiment } from "./sentimentEngine.mjs"
import { quickMtfCheck } from "./multiTimeframe.mjs"
import { evaluateU4FA, MIN_5M_BARS } from "./fourFactor.mjs"
import { U4FA_DEFAULTS, resolveAssetConfig } from "./u4faConfig.mjs"
import { v32ContextForAsset, v32DecisionForAsset } from "./v32Engine.mjs"

export const CANDIDATE_EXPIRIES = [60, 120, 300, 900] // seconds (15s excluded: 60s bar resolution can't estimate it honestly)
/**
 * With the U4FA strategy ON the 30-min expiry (indices/crypto per REQ-CAL)
 * enters the candidate space. It is NOT in `CANDIDATE_EXPIRIES` so that the
 * U4FA-off path — the T9 byte-identical regression lock — is untouched in
 * constant AND behavior. 1800 is pay-out-ho-nest: `ASSUMED_PAYOUT` deliberately
 * has no 1800 entry (spec R5) — it only trades on `observedPayout` demo deals;
 * absent those, `payoutSource:"unavailable"` and `payoutBeats:false` keep it
 * from ever clearing the composite gate.
 */
export const U4FA_CANDIDATE_EXPIRIES = [60, 120, 300, 900, 1800]
export const U4FA_DEFAULT_WEIGHT = 0.4 // spec M4 confidence-merge weight
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

export function evaluateAsset({ id, name, candles, volume, observedPayout = null, now = Date.now(), period = ANALYSIS_PERIOD, asset = null, sentimentOverride = null, strategies = null, constitution = null } = {}) {
  // ── U4FA strategy dimension (spec M4) ──────────────────────────────────
  // Default OFF per asset: without an enabled strategy the decision object
  // below is byte-identical to the pre-M4 shape (T9 regression lock). When
  // enabled, evaluateU4FA runs FIRST — its result also rides the early-return
  // path so the veto/attach logic is uniform.
  const u4faEnabled = strategies?.u4fa?.enabled === true
  const u4faStrat = u4faEnabled ? strategies.u4fa : null
  let u4faResult = null
  if (u4faStrat) {
    u4faResult = evaluateU4FA({
      assetId: id,
      candles5m: u4faStrat.candles ?? [],
      hourlyCandles: u4faStrat.hourlyCandles ?? null,
      dailyCandles: u4faStrat.dailyCandles ?? null,
      calendarEvents: u4faStrat.calendarEvents ?? [],
      calendarSource: u4faStrat.calendarSource ?? "fallback-schedule",
      spread: u4faStrat.spread ?? null,
      losses: u4faStrat.losses ?? [],
      config: u4faStrat.config ?? U4FA_DEFAULTS,
      regimeState: u4faStrat.regimeState ?? { chop: false, streak: 0 },
      nowMs: now ?? Date.now(),
      candleSource: u4faStrat.candleSource ?? "unknown"
    })
  }
  const strategiesOut = {
    u4fa: {
      enabled: u4faEnabled,
      ...(u4faStrat ? { weight: u4faStrat.weight ?? U4FA_DEFAULT_WEIGHT, result: u4faResult } : {})
    }
  }
  // U4FA veto (default on, spec M4): F1–F3 NO_TRADE (my engine's NEUTRAL token)
  // blocks any confluence TRADE — the composite gates stay on top (G3), this is
  // an additional hard abort, never a bypass.
  const veto = u4faStrat
    ? (u4faStrat.veto ?? U4FA_DEFAULTS.u4faVeto ?? true) !== false && u4faResult?.verdict === "NEUTRAL"
    : false

  // ── v3.2 lane (REQ-P3-1, toggle ON only) ─────────────────────────────
  // Carried on `strategies.v32` (built by decideAssets when enabled). OFF →
  // `v32Enabled` false → `withV32` returns the strategies object untouched,
  // so the decision shape is byte-identical to the pre-v32 era. When ON, the
  // v3.2 row is composed from the SAME `best` confluence economics (winProb /
  // payout / direction) the legacy row used — one lane, no invented feed.
  const v32Enabled = strategies?.v32?.enabled === true
  const v32Row = (bestEntry) =>
    v32Enabled
      ? v32DecisionForAsset({
          ctx: strategies.v32.context,
          v32Config: strategies.v32.config ?? {},
          now: now ?? Date.now(),
          data: {
            winProb: bestEntry?.winProb ?? null,
            payout: bestEntry?.payout ?? null,
            spreadPips: 1.5,
            slippagePips: 0,
            rows: strategies.v32.rows ?? [],
            risk: strategies.v32.risk ?? {}
          }
        })
      : null
  const withV32 = (out, entry) => (v32Enabled ? { ...out, v32: { enabled: true, result: v32Row(entry) } } : out)

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
      ts: now,
      strategies: withV32(strategiesOut, null)
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

  const expiryRuns = (u4faStrat ? U4FA_CANDIDATE_EXPIRIES : CANDIDATE_EXPIRIES).map((expiry) => {
    const wp = winProbEstimate({ closes, times, period, direction, expiry })
    // Payout honesty (spec R5): 1800 has NO ASSUMED_PAYOUT entry — an unobserved
    // 30-min candidate reports `payout:null` + `payoutSource:"unavailable"` and
    // can never clear `payoutBeats` (hence never TRADE) until real demo-deal
    // payouts exist. Everything else keeps the exact old label semantics.
    const obsKey = `${id}:${expiry}`
    const obsPay = observedPayout?.[obsKey]
    const pay = obsPay ?? ASSUMED_PAYOUT[expiry]
    const payKnown = Number.isFinite(Number(pay)) && Number(pay) > 0
    const gate = evGate({ winProb: wp.winProb, payoutPct: payKnown ? pay : null })
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
    if (passCount === 5 && read.phase !== "volatile_range" && !mtfBlock && !veto) verdict = "TRADE"
    else if (passCount >= 3 && Math.abs(read.score) >= MIN_SCORE * 0.5) verdict = "OBSERVE"
    else verdict = "NEUTRAL"

    // Confidence is honest, regime-adjusted, MTF-adjusted, and sentiment-adjusted.
    let confidence = 55 + Math.abs(read.score) * 30 + (wp.winProb - 0.5) * 80
    if (read.phase === "volatile_range") confidence -= 8
    if (wp.sampleSize < 12) confidence -= 5
    confidence += mtf.boost * 100 // MTF agreement/disagreement adjustment
    confidence += sentimentBoost * 100 // sentiment alignment adjustment
    // U4FA merged confidence (spec M4): confluence confidence + weight * signed
    // signal strength. TRADE = strength 1, OBSERVE = 0.5, NEUTRAL = −0.5·weight;
    // same +1/-1 direction-agreement shape as the MTF boost; same [45,92] clamp.
    const u4faSignal = u4faStrat
      ? u4faResult?.verdict === "TRADE" || u4faResult?.verdict === "OBSERVE"
        ? (u4faResult.direction ?? "flat") === (direction > 0 ? "up" : "down")
          ? (u4faResult.verdict === "TRADE" ? 1 : 0.5)
          : -(u4faResult.verdict === "TRADE" ? 1 : 0.5)
        : -0.5
      : 0
    if (u4faStrat) {
      const weight = u4faStrat.weight ?? U4FA_DEFAULT_WEIGHT
      confidence += u4faSignal * weight * 100
    }
    confidence = clamp(Math.round(confidence), 45, 92)

    return {
      expiry,
      direction: direction > 0 ? "up" : "down",
      verdict,
      winProb: round(wp.winProb, 4),
      empirical: wp.empirical,
      sampled: wp.sampleSize,
      payout: payKnown ? pay : null,
      payoutSource: obsPay != null ? "observed" : payKnown ? "assumed" : "unavailable",
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
      sentiment: { score: round(sent.score, 4), source: sent.source, aligned: sentimentAligned },
      ...(u4faStrat ? { u4fa: { signalStrength: round(u4faSignal, 3) } } : {})
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
  // v3.2 Constitution veto (REQ-CON-1..5): when invoked, a failing real-money
  // floor downgrades TRADE → NEUTRAL and the block reasons are surfaced on the
  // composite gates. NULL/undefined means "not yet wired" — legacy behavior is
  // byte-identical (the 2341-test floor pins this).
  const constitutionGate = constitution && constitution.ok === true
  const constitutionBlocked = constitution != null && constitution.ok !== true
  const finalVerdict = typeof constitutionBlocked === "boolean" && constitutionBlocked && best.verdict === "TRADE" ? "NEUTRAL" : best.verdict
  if (constitutionBlocked) {
    for (const r of Array.isArray(constitution.reasons) ? constitution.reasons : []) reasons.push(`Constitution: ${r}`)
    if (constitutionBlocked && best.verdict === "TRADE") reasons.push("Constitution floors unmet — real-money execution locked (paper/demo open)")
  }
  if (best.verdict === "TRADE") {
    reasons.push(
      `est. win prob ${(best.winProb * 100).toFixed(0)}% (empirical ${best.empirical != null ? (best.empirical * 100).toFixed(0) + "%" : "n/a"}, n=${best.sampled})`,
      `price-path R:R ${best.priceRR ?? "n/a"} (fav ${best.favorable ?? "n/a"} / adv ${best.adverse ?? "n/a"})`,
      `payout ${best.payout}% (${best.payoutSource}) vs break-even ${best.breakevenPayout}% — EV ${best.ev != null ? (best.ev * 100).toFixed(1) + "%/stake" : "n/a"}`,
      `MTTD to 0.25×ATR ≈ ${best.mttdSec != null ? best.mttdSec + "s" : "n/a"}`
    )
  } else if (best.verdict === "OBSERVE") {
    const missing = Object.entries(best.gates).filter(([, v]) => !v).map(([k]) => k)
    reasons.push(`gates not all met (${missing.join(", ")}) — ${best.expiry}s at ${best.winProb != null ? (best.winProb * 100).toFixed(0) + "%" : "?"} win prob, payout ${best.payout ?? "n/a"}%`)
  } else {
    reasons.push("no candidate expiry clears enough gates")
  }
  if (u4faStrat) {
    reasons.push(
      `U4FA strategy: verdict ${u4faResult?.verdict ?? "n/a"} (signal ${best.u4fa?.signalStrength ?? "n/a"}, expiry ${u4faResult?.expiry ?? "n/a"}s, chop ${u4faResult?.regime?.chop ?? "n/a"})` +
      (veto ? " — U4FA VETO: F1–F3 NO_TRADE blocks confluence TRADE" : "")
    )
  }
  reasons.push("decision support only — no order is placed")

  return {
    assetId: id,
    asset: name ?? id,
    verdict: finalVerdict,
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
    // Keep the legacy shallow reference when Constitution is absent so the
    // byte-identical floor really is byte-identical (no new object identity).
    gates: constitution != null ? { ...best.gates, constitution: constitutionGate } : best.gates,
    groups: read.groups,
    volume: read.volume,
    bars: read.bars,
    reasons,
    ts: now,
    strategies: {
      u4fa: {
        enabled: u4faEnabled,
        ...(u4faStrat
          ? {
              weight: u4faStrat.weight ?? U4FA_DEFAULT_WEIGHT,
              vetoApplied: veto,
              veto: veto ? "U4FA F1–F3 NO_TRADE blocked confluence TRADE" : null,
              signalStrength: best.u4fa?.signalStrength ?? null,
              result: u4faResult
            }
          : {})
      },
      ...(v32Enabled ? { v32: { enabled: true, result: v32Row(best) } } : {})
    }
  }
}

// ---------------------------------------------------------------------
// Watch-set decisions
// ---------------------------------------------------------------------

/**
 * Per-asset U4FA regime latch (chop/streak) carried across decision cycles —
 * the pure engine is stateless; continuity lives here (spec T9). Populated by
 * `decideAssets` from each decision's result. `resetU4faRegimeStates()` exists
 * for tests only (it is NOT part of a live reset path).
 */
const u4faRegimeStates = new Map()
export function resetU4faRegimeStates() {
  u4faRegimeStates.clear()
}

/**
 * Build the per-asset U4FA strategy row for `decideAssets` from the runtime
 * context. Honest-by-default: no spread feed (T6) and no Yahoo D1 EOD in the
 * live cycle (T8) mean F1 spread and the D1 leg surface as unavailable/null —
 * truthful abort states, never fabricated numbers (G2).
 */
function buildU4faStrategy(a, ctx, now) {
  const id = String(a.id ?? "")
  const resolved = resolveAssetConfig(id, ctx.config ?? U4FA_DEFAULTS)
  const enabled = resolved.accessibility === "trade" && resolved.strategy?.enabled === true
  if (!enabled) return { u4fa: { enabled: false } }
  const candles300 = a?.periods?.[300]
  const candles3600 = a?.periods?.[3600]
  return {
    u4fa: {
      enabled: true,
      candles: Array.isArray(candles300) ? candles300 : [],
      hourlyCandles: Array.isArray(candles3600) ? candles3600 : null,
      dailyCandles: null, // Yahoo EOD not in the live cycle — D1 leg honestly unavailable
      calendarEvents: ctx.calendarEvents ?? [],
      calendarSource: ctx.calendarSource ?? "fallback-schedule",
      spread: ctx.spread ?? null,
      losses: ctx.losses ?? [],
      config: ctx.config ?? U4FA_DEFAULTS,
      regimeState: u4faRegimeStates.get(id) ?? { chop: false, streak: 0 },
      weight: resolved.strategy?.weight ?? U4FA_DEFAULT_WEIGHT,
      candleSource: ctx.candleSource ?? "unknown",
      now
    }
  }
}

/**
 * v3.2 lane (REQ-P3-1 / REQ-STG-1/2, ADR-0004). Returns `null` unless the
 * runtime context carries `v32Config.enabled === true` — OFF means this code
 * path is never reached and the decision object carries no `v32` field at all
 * (the byte-identical floor pins that: same contract as the `constitution`
 * param, adaptiveConfluence.mjs:574). ON: assembles the per-asset v3.2
 * context (regime registers + venue + resolved class) exactly once per tick;
 * the decision row itself is built later in `evaluateAsset` from the same
 * `best` confluence economics that drive the legacy row.
 */
function buildV32Strategy(a, ctx, now) {
  const vcfg = ctx?.v32Config
  if (!vcfg || vcfg.enabled !== true) return null
  try {
    const context = v32ContextForAsset(a, ctx, vcfg)
    return {
      enabled: true,
      context,
      config: vcfg,
      rows: Array.isArray(ctx?.v32Rows) ? ctx.v32Rows : [],
      risk: ctx?.risk ?? {}
    }
  } catch {
    // Fail-closed, per-asset: one asset's lane blowing up must never take down
    // the decision batch (mirrors u4faRuntimeContext's null-on-failure). The
    // decision builder turns a null context into an honest OBSERVE row.
    return { enabled: true, context: null, config: vcfg, rows: [], risk: {} }
  }
}

export async function decideAssets({ data, observedPayout = null, now = Date.now(), u4faContext = null } = {}) {
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
      const strategies = u4faContext ? buildU4faStrategy(a, u4faContext, now) : null
      const v32lane = strategies ? buildV32Strategy(a, u4faContext, now) : null
      if (v32lane) strategies.v32 = v32lane
      const d = evaluateAsset({ id: a.id, name: a.name, candles, volume: a.ticks, observedPayout, now, asset: a, sentimentOverride: sentimentMap[a.id] || null, strategies })
      // Regime latch continuity: persist whatever the pure engine reported
      // (refused/insufficient carry the prior latch through untouched).
      if (d?.strategies?.u4fa?.enabled && d?.strategies?.u4fa?.result?.regimeState) {
        u4faRegimeStates.set(a.id, d.strategies.u4fa.result.regimeState)
      }
      return d
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
let bootStarted = false
const decisionSubs = new Set()
const u4faSubs = new Set()
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

export async function logTradeVerdicts(decisions) {
  const now = Date.now()
  for (const d of decisions) {
    // v3.2 lane (REQ-P3-1, toggle ON only): log its own TRADE rows with
    // `engine:"v3.2"` BEFORE the legacy guard so a v3.2 TRADE is recorded even
    // when the legacy verdict is not TRADE. OFF → `strategies.v32` absent →
    // this block never runs → the legacy loop below is byte-identical.
    const v32row = d?.strategies?.v32?.enabled === true ? d.strategies.v32.result : null
    if (v32row && v32row.verdict === "TRADE" && v32row.expiry != null) {
      const key = `v32:${v32row.assetId ?? d.assetId}:${v32row.expiry}`
      const last = logCooldowns.get(key) ?? 0
      if (now - last < LEDGER_LOG_COOLDOWN_MS) {
        /* cooldown */
      } else {
        logCooldowns.set(key, now)
        if (logCooldowns.size > 400) logCooldowns.clear()
        try {
          await recordDecision({ ...v32row, winProb: d.winProb ?? null })
        } catch {
          /* accuracy ledger write must never break the engine */
        }
      }
    }
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

/**
 * U4FA runtime context for the live cycle: config + calendar + resolved losses.
 * Returns null under VITEST so tests never touch real config/calendar/ledger
 * storage, and null on any failure (engine runs U4FA-off, honesty preserved).
 * T10 wire-up note: `losses` currently stays [] — the correlation-loss feed
 * lands with the risk layer (same ledger read, spec T10), not here.
 */
async function u4faRuntimeContext() {
  if (process.env.VITEST) return null
  try {
    const [{ loadU4faConfig }, { getEconomicCalendar }, { ledgerHistory, correctlyAnsweredByEngine }] = await Promise.all([
      import("./u4faConfig.mjs"),
      import("./economicCalendar.mjs"),
      import("./accuracyLedger.mjs")
    ])
    const { config } = await loadU4faConfig({})
    // v3.2 toggle (REQ-P3-1) — loaded ISOLATED from the u4fa config: a missing
    // or corrupt v32-config file must NEVER degrade the legacy u4fa context.
    // Absent from the repo = defaults = `enabled:false`.
    let v32Config = { enabled: false }
    try {
      const mod = await import("./v32Config.mjs")
      v32Config = (await mod.loadV32Config({})).config ?? { enabled: false }
    } catch {
      v32Config = { enabled: false }
    }
    // Flip-gate data (REQ-P3-11): v3.2 engine rows from the shared ledger so
    // `v32Status()` / the confidence register can read them live.
    let v32Rows = []
    try {
      v32Rows = correctlyAnsweredByEngine()
    } catch {
      v32Rows = []
    }
    let events = []
    try {
      const cal = await getEconomicCalendar()
      events = Array.isArray(cal) ? cal : cal?.events ?? []
    } catch {
      events = [] // calendar outage → engine runs with fallback-schedule honesty (F2 latch uses candles only)
    }
    let losses = []
    try {
      const ledger = ledgerHistory(200) ?? {}
      losses = (ledger.entries ?? []).filter((e) => e?.result === "miss").slice(-50).map((e) => ({
        asset: e.assetId,
        ts: e.resolvedAt ? Date.parse(e.resolvedAt) : e.entryTs
      }))
    } catch {
      losses = []
    }
    return {
      config,
      calendarEvents: events,
      calendarSource: events.length ? "feed" : "fallback-schedule",
      spread: null, // T6: no bid/ask feed in PICC → F1 spread honestly unmeasurable (abort, never fabricate)
      losses,
      candleSource: "liveEO",
      v32Config,
      v32Rows,
      risk: {} // no balance/closed-trades feed in the live cycle → wire 1 fails closed honestly
    }
  } catch {
    return null
  }
}

async function computeNow() {
  // Phase 9: fold the read-only CCXT exchange candles (liveCCXT.mjs, fed by the
  // scheduler's ccxt-market-data job) into the same decision batch so exchange
  // pairs are scored by the identical pipeline as broker assets — and so the
  // engine still produces decisions when either source is unconfigured.
  let data
  try {
    data = mergeCCXTAssets(getBrokerData())
  } catch {
    data = getBrokerData()
  }
  if (!Array.isArray(data?.assets) || data.assets.length === 0) {
    cached = {
      ts: Date.now(),
      status: data.status,
      mode: data.mode,
      account: data.account,
      viewed: data.viewed,
      decisions: []
    }
    cachedAt = cached.ts
    emitDecisions()
    return cached
  }
  const observedPayout = await loadObservedPayouts()
  const u4faContext = await u4faRuntimeContext()
  const decisions = await decideAssets({ data, observedPayout, now: Date.now(), u4faContext })
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
  // T12/M8 — one `type:"u4fa"` event per U4FA-enabled decision, on the same
  // tick/cadence as the decision event (no new timer, no ledger IO — the
  // DECISION_INTERVAL_MS / LEDGER_LOG_COOLDOWN_MS rhythm is untouched). The
  // payload is lifted off the live evaluateU4FA result (grounding-in-code:
  // honesty keys report exactly what the producer observed this run).
  // `compliance.proposalId` mirrors the trade gate as observed NOW — a proposal
  // this same tick's async proposeU4faTrades has not finished writing yet
  // reports null, honestly (it shows up in the next tick's event).
  let proposalMap = {}
  try {
    const { pendingTradeProposals } = await import("./interventions.mjs")
    proposalMap = pendingTradeProposals() ?? {}
  } catch {
    proposalMap = {}
  }
  emitU4faEvents(decisions, { ts: cached.ts, proposalMap })
  // Fire-and-forget: verdict logging does serial file I/O under the ledger
  // lock; awaiting it here made every cold computeNow take ~20s and blocked
  // /decisions, /intel and the first `suite` event. The ledger write must never
  // gate the engine's response (and it already fails closed internally).
  void logTradeVerdicts(decisions).catch(() => {})
  // T11 — the U4FA Augmentation gate: a U4FA-enabled TRADE verdict that cleared
  // every composite honesty gate becomes a source:"trade" proposal the human
  // approves/rejects (approve → openPaperTrade, paper-only). Fire-and-forget
  // like the ledger write — a proposal must never break the engine tick.
  void proposeU4faTrades(decisions, data).catch(() => {})
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

/**
 * T11 — bridge a winning U4FA verdict into the Augmentation gate. Runs on the
 * decision tick for whatever batch produced the verdicts: for a U4FA-enabled
 * asset whose report is the batch best with verdict TRADE and the composite
 * `gates.payout`/`gates.ev` met, it reaches `interventions.proposeTrade(order)`
 * with the order shaped from the decision (entry = the same live 60s close the
 * accuracy ledger samples at decision time). The proposal is idempotent per
 * asset while one is pending; any proposal risk-gate (barrier/cap/cooldown)
 * returns quietly — the engine never forces a proposal. Fails closed on any
 * runtime error.
 */
async function proposeU4faTrades(decisions, data) {
  const d = Array.isArray(decisions) && decisions.find((x) => x?.strategies?.u4fa?.enabled && x?.verdict === "TRADE")
  if (!d) return
  const gates = d?.gates
  if (!gates || gates.payout !== true) {
    return // a would-be U4FA trade that didn't clear the composite payout gate (spec R5) is never proposed
  }
  const asset = (Array.isArray(data?.assets) ? data.assets : []).find((a) => a.id === d.assetId)
  const close = Number(asset?.periods?.[60]?.[asset.periods[60].length - 1]?.close)
  const entry = Number.isFinite(close) && close > 0 ? close : Number(d.entry) || Number(asset?.lastPrice)
  if (!Number.isFinite(entry) || entry <= 0) return // no observable entry price -> no proposal
  const order = {
    symbol: d.asset,
    direction: d.direction,
    entry,
    expiry: d.expiry,
    signalId: null,
    summary: `U4FA ${d.direction} ${d.asset} ${d.expiry}s · conf ${d.confidence} · phase ${d.phase ?? "?"}`
  }
  const { proposeTrade } = await import("./interventions.mjs")
  await proposeTrade(order)
}

function startEngine() {
  if (liveOff) return
  liveOff = subscribeBroker(() => {}) // keep the live layer warm
  void computeNow().catch(() => {})
  schedule()
}

/** Boot-time entry point — keeps the decision engine running unconditionally. */
export function startDecisionEngine() {
  bootStarted = true
  startEngine()
}

export function stopDecisionEngine() {
  bootStarted = false
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
  u4faSubs.clear()
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
    if (decisionSubs.size === 0 && u4faSubs.size === 0 && !bootStarted) stopDecisionEngine()
  }
}

/**
 * T12/M8 — lift one decision's U4FA run into the `type:"u4fa"` SSE payload.
 * Every deep block (factors/regime/timing/indicators/risk/honesty) passes
 * through verbatim from the real producer (evaluateU4FA's result) — nothing is
 * default-filled, so an unmeasurable spread stays `"unmeasurable"` and absent
 * sources stay null. `compliance.proposalId` is the pending trade proposal for
 * that symbol as observed at emit time (null = nothing is pending for it).
 * Returns null for decisions without an enabled U4FA result (they emit nothing).
 * Exported for the M8 contract pins (u4faPayload.test.mjs).
 */
export function u4faEventFromDecision(d, { proposalMap = {}, ts = Date.now() } = {}) {
  const strat = d?.strategies?.u4fa
  if (!strat?.enabled || !strat?.result) return null
  const r = strat.result
  const symbolKeys = [d?.asset, d?.assetId, r.assetId]
    .filter((x) => x != null && x !== "")
    .map((x) => String(x).toUpperCase())
  let proposalId = null
  for (const k of symbolKeys) {
    if (proposalMap[k] != null) {
      proposalId = proposalMap[k]
      break
    }
  }
  return {
    type: "u4fa",
    ts: d?.ts ?? ts,
    assetId: r.assetId ?? d?.assetId ?? null,
    style: r.style ?? null,
    direction: r.direction ?? "flat",
    verdict: r.verdict ?? "NEUTRAL",
    expiry: r.expiry ?? null,
    factors: r.factors ?? null,
    regime: r.regime ?? null,
    timing: r.timing ?? null,
    indicators: r.indicators ?? null,
    risk: r.risk ?? null,
    compliance: {
      requiresHumanApproval: r.compliance?.requiresHumanApproval ?? true,
      proposalId
    },
    honesty: r.honesty ?? null
  }
}

/** T12/M8 — push one `type:"u4fa"` event per U4FA-enabled decision to subscribers. */
export function emitU4faEvents(decisions = [], { ts = Date.now(), proposalMap = {} } = {}) {
  for (const d of decisions) {
    const msg = u4faEventFromDecision(d, { proposalMap, ts })
    if (!msg) continue
    for (const cb of u4faSubs) {
      try {
        cb(msg)
      } catch {
        /* subscriber errors never break the stream */
      }
    }
  }
}

/**
 * T12/M8 — subscribe to `type:"u4fa"` events (same realtime stream infra as
 * subscribeDecisions). No replay of past events on connect: the SSE handler's
 * initial `decisions` snapshot already carries `strategies.u4fa` per decision
 * (T9), so a fresh connection sees the current state without a stale copy.
 */
export function subscribeU4faEvents(cb) {
  u4faSubs.add(cb)
  if (!liveOff) startEngine()
  return () => {
    u4faSubs.delete(cb)
    if (u4faSubs.size === 0 && decisionSubs.size === 0 && !bootStarted) stopDecisionEngine()
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
