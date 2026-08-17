// PICC Market Intel — realtime meta-analysis over every watched ExpertOption
// asset. It is the "best market to trade" layer on top of the adaptive
// confluence engine: for each asset it scores six expert strategies, combines
// them into an intel score, ranks the whole watch set, and (only when a market
// genuinely clears the bar) emits a precise manual-entry recommendation
// (direction + expiry + confidence) for trading by hand through the content
// window.
//
// The six strategies (the four the user operates with, plus two honest
// additions from the platform's own record):
//
//   1. MTF Top-Down  — trend alignment across 60s / 5m / 15m / 1h.
//   2. Market Phase  — trending / ranging / explosive-choppy regime quality.
//   3. Volume / Order Flow — tick-activity participation + directional
//      pressure (buy/sell tick split).
//   4. Asymmetric R:R — price-path R:R (MFFE/MAE) and EV-weighted R:R from the
//      confluence engine's composite honesty gate.
//   5. Realized Edge — the signal-accuracy ledger's win rate for that market,
//      damped toward 50% the smaller the sample.
//   6. Volatility / Duration fit — ATR% regime mapped to the expiry horizon the
//      engine's EV model recommends (short on hot assets, longer on quiet ones).
//
// Pure decision support. Nothing here trades. `getMarketIntel()` is the cached
// orchestrator wired into /api/trading/intel and the realtime suite snapshot.

import { computeIndicatorDashboard } from "./indicators.mjs"
import { getDecisions } from "./adaptiveConfluence.mjs"
import { signalAccuracy } from "./trading.mjs"
import { liveEOData } from "./liveEO.mjs"

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

export const MTF_TIMEFRAMES = [60, 300, 900, 3600] // seconds
export const MTF_WEIGHT = { 60: 1, 300: 1.25, 900: 1.5, 3600: 2 } // higher TF = more authority
export const MIN_TF_BARS = 24
export const MIN_INTEL_TRADE = 60 // intel score (0-100) required to recommend an entry
export const CONFIDENCE_CAP = 92

const EPS = 1e-12
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
const sign = (v) => (Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1)

// Regime quality — how tradable the detected phase is for a directional
// binary option. Whipsaw regimes are negative on purpose.
const PHASE_QUALITY = {
  trend: 0.8,
  volatile_trend: 0.45,
  compression: 0.3,
  quiet_range: 0.25,
  transition: 0,
  volatile_range: -0.7,
  flat: 0
}
const PHASE_HINT = {
  trend: "clean trend — trade with the trend (pullbacks / continuation)",
  volatile_trend: "trending but choppy — reduce size, wide stops",
  compression: "squeeze — breakout pending, avoid fading the range",
  quiet_range: "quiet range — mean-reversion regime, fade the edges",
  volatile_range: "choppy whipsaw — stand aside or trade tiny size",
  transition: "no dominant regime — be selective",
  flat: "no price movement — zero information"
}

// ---------------------------------------------------------------------
// Strategy 1 — MTF top-down: directional read per timeframe
// ---------------------------------------------------------------------

/** Lightweight trend read from an indicator dashboard (tolerant of fewer bars). */
export function tfDirection(dash) {
  const items = []
  const close = dash.last
  const ema20 = dash.ema?.ema20
  const ema50 = dash.ema?.ema50
  if (close != null && ema20 != null) items.push(sign(close - ema20))
  if (ema20 != null && ema50 != null) items.push(sign(ema20 - ema50))
  if (dash.alligator?.bull != null) items.push(dash.alligator.bull ? 1 : -1)
  if (dash.macd?.line != null) items.push(sign(dash.macd.line))
  if (dash.linearRegression?.slopePct != null) items.push(sign(dash.linearRegression.slopePct))
  if (!items.length) return { dir: 0, strength: 0 }
  const mean = items.reduce((a, b) => a + b, 0) / items.length
  return { dir: sign(mean), strength: Math.abs(mean) }
}

export function strategyMtf(periods) {
  const parts = []
  let weightSum = 0
  for (const tf of MTF_TIMEFRAMES) {
    const ohlc = periods?.[tf]
    if (!Array.isArray(ohlc) || ohlc.length < MIN_TF_BARS) continue
    let dash
    try {
      dash = computeIndicatorDashboard(ohlc)
    } catch {
      continue
    }
    const { dir, strength } = tfDirection(dash)
    if (dir === 0 || strength < 0.2) continue
    const w = MTF_WEIGHT[tf] ?? 1
    parts.push({ tf, dir, w, strength })
    weightSum += w
  }
  if (!parts.length) {
    return { score: 0, signal: "flat", reason: "insufficient multi-timeframe data", details: [] }
  }
  const weighted = parts.reduce((a, p) => a + p.dir * p.w, 0) / weightSum
  const up = parts.filter((p) => p.dir > 0).length
  const down = parts.filter((p) => p.dir < 0).length
  const aligned = Math.max(up, down)
  const damp = Math.min(1, parts.length / 2.5) // few TFs → less evidence
  const score = weighted * damp
  const detail = parts
    .slice()
    .sort((a, b) => a.tf - b.tf)
    .map((p) => `${p.tf}${p.dir > 0 ? "↑" : "↓"}`)
    .join(" ")
  return {
    score: round2(clamp(score, -1, 1)),
    signal: score > 0.15 ? "up" : score < -0.15 ? "down" : "flat",
    reason: `MTF ${detail} — ${aligned}/${parts.length} timeframes agree`,
    details: parts.map((p) => ({ tf: p.tf, dir: p.dir }))
  }
}

// ---------------------------------------------------------------------
// Strategy 2 — Market phase quality
// ---------------------------------------------------------------------

export function strategyPhase(phase) {
  const p = phase ?? "transition"
  const q = PHASE_QUALITY[p] ?? 0
  return {
    score: round2(q),
    signal: "flat", // the regime filters quality; direction comes from MTF/R:R/volume
    reason: `${PHASE_HINT[p] ?? "unknown regime"}${p === "volatile_range" ? " — engine refuses TRADE here" : ""}`
  }
}

// ---------------------------------------------------------------------
// Strategy 3 — Volume / order flow (tick-activity proxy)
// ---------------------------------------------------------------------

export function strategyVolume(vol, direction) {
  if (!vol || !Array.isArray(vol.profile) || !vol.profile.length) {
    return { score: 0, signal: "flat", reason: "no tick activity yet", details: {} }
  }
  const recent = vol.profile.slice(-12)
  const up = recent.reduce((a, b) => a + (b.up ?? 0), 0)
  const down = recent.reduce((a, b) => a + (b.down ?? 0), 0)
  const total = up + down
  if (total <= 0) return { score: 0, signal: "flat", reason: "no tick flow", details: { total } }
  const spanSec = Math.max(1, recent[recent.length - 1].t - recent[0].t)
  const ratePerMin = Math.round((total / spanSec) * 60)
  const pressure = (up - down) / total
  const participation = clamp(ratePerMin / 300, 0, 1)
  const dir = direction === "up" ? 1 : direction === "down" ? -1 : 0
  // Strong pressure that CONTRADICTS the signal reads as a real warning, so the
  // score goes negative (the directional read is wrong) rather than positive.
  const score =
    dir !== 0 && pressure !== 0
      ? Math.sign(pressure) === dir
        ? participation * 0.6 + Math.abs(pressure) * 0.4
        : -(participation * 0.4 + Math.abs(pressure) * 0.6)
      : participation * 0.6
  const pct = Math.round((up / total) * 100)
  const relation = dir !== 0 && Math.sign(pressure) === dir ? "aligned with signal" : dir !== 0 ? "conflicts with signal" : "no directional signal to compare"
  return {
    score: round2(clamp(score, -1, 1)),
    signal: pressure > 0.1 ? "up" : pressure < -0.1 ? "down" : "flat",
    reason: `tick flow ${ratePerMin}/min, ${pct}% up-ticks — ${pressure > 0 ? "buy" : "sell"} pressure (${relation})`,
    details: { ratePerMin, upRatio: round2(up / total), pressure: round2(pressure) }
  }
}

// ---------------------------------------------------------------------
// Strategy 4 — Asymmetric R:R (from the confluence honesty gates)
// ---------------------------------------------------------------------

export function strategyRR(d) {
  if (!d || d.direction === "flat" || d.direction == null) {
    return { score: 0, signal: "flat", reason: "no R:R available (no directional read)" }
  }
  const price = d.priceRR != null ? clamp((d.priceRR - 2) / 2, -1, 1) : 0
  const ev = d.evRR != null ? clamp((d.evRR - 2) / 2, -1, 1) : 0
  const score = (price + ev) / 2
  const pass = d.gates?.priceRR && d.gates?.evRR ? " (both ≥ 2:1 ✓)" : d.gates?.priceRR || d.gates?.evRR ? " (only one ≥ 2:1)" : " (below 2:1)"
  return {
    score: round2(score),
    signal: d.direction,
    reason: `price-path R:R ${d.priceRR ?? "n/a"} · EV-weighted R:R ${d.evRR ?? "n/a"}${pass}`
  }
}

// ---------------------------------------------------------------------
// Strategy 5 — Realized edge (accuracy ledger, damped)
// ---------------------------------------------------------------------

export function strategyEdge(acc) {
  if (!acc || !acc.total || acc.total < 5) {
    return { score: 0, signal: "flat", reason: `realized edge n/a (${acc?.total ?? 0} resolved signals)` }
  }
  const raw = clamp((acc.winRate - 50) / 25, -1, 1)
  const damp = Math.min(1, acc.total / 20)
  return {
    score: round2(raw * damp),
    signal: "flat",
    reason: `realized win rate ${acc.winRate}% over ${acc.total} signals`
  }
}

// ---------------------------------------------------------------------
// Strategy 6 — Volatility / trade-duration fit
// ---------------------------------------------------------------------

export function durationGuidance(d) {
  if (!d) return null
  const atrPct = d.atrPct
  let label = "unknown"
  let window = null
  if (atrPct != null) {
    if (atrPct < 0.05) {
      label = "low"
      window = "300–900s (needs time to pay)"
    } else if (atrPct < 0.15) {
      label = "medium"
      window = "60–120s"
    } else {
      label = "elevated"
      window = "≤60s (fast, tight)"
    }
  }
  const suggestedSec = d.expiry ?? (atrPct == null ? null : atrPct >= 0.15 ? 60 : atrPct >= 0.05 ? 120 : 300)
  return {
    atrPct,
    label,
    suggestedSec,
    window,
    mttdSec: d.mttdSec ?? null,
    reason: d.mttdSec != null
      ? `${label} volatility (ATR ${atrPct != null ? atrPct.toFixed(3) + "%" : "n/a"}) · mean time to target ≈ ${d.mttdSec}s → prefer ${suggestedSec ?? "?"}s`
      : `${label} volatility (ATR ${atrPct != null ? atrPct.toFixed(3) + "%" : "n/a"}) → prefer ${suggestedSec ?? "?"}s`
  }
}

// ---------------------------------------------------------------------
// Per-asset intel row
// ---------------------------------------------------------------------

export function marketIntelAsset({ asset, decision, accuracy }) {
  const id = asset?.id ?? ""
  const name = asset?.name ?? id
  const periods = asset?.periods ?? {}

  const mtf = strategyMtf(periods)
  const phase = strategyPhase(decision?.phase)
  // Tick-activity buckets live on the raw asset (`asset.ticks.profile`); the
  // decision only carries the summary (ratePerMin/delta/upRatio).
  const vol = asset?.ticks?.profile?.length
    ? asset.ticks
    : decision?.volume?.profile?.length
      ? decision.volume
      : null
  const volume = strategyVolume(vol, decision?.direction)
  const rr = strategyRR(decision)
  const edge = strategyEdge(accuracy)
  const duration = durationGuidance(decision)

  const dir = decision?.direction && decision.direction !== "flat" ? decision.direction : mtf.signal !== "flat" ? mtf.signal : volume.signal !== "flat" ? volume.signal : null
  const action = dir === "up" ? "call" : dir === "down" ? "put" : null
  const sgn = dir === "up" ? 1 : dir === "down" ? -1 : 0

  let score = 0
  if (sgn !== 0) {
    if (mtf.signal === dir) score += mtf.score * 0.3
    else if (mtf.signal !== "flat") score -= Math.abs(mtf.score) * 0.2
    if (rr.signal === dir) score += rr.score * 0.3
    else if (rr.signal !== "flat") score -= Math.abs(rr.score) * 0.3
    if (volume.signal === dir) score += Math.abs(volume.score) * 0.2
    else if (volume.signal !== "flat") score -= Math.abs(volume.score) * 0.2
    score += Math.abs(phase.score) * 0.15
    if (phase.score < 0) score += phase.score * 0.2 // whipsaw penalty
    score += edge.score * 0.12
    if (decision?.confidence != null) score += ((decision.confidence - 50) / 50) * 0.15
  } else {
    // No consensus direction — regime quality + realized edge only.
    score = phase.score * 0.3 + edge.score * 0.1
  }
  const intelScore = clamp(Math.round(50 + score * 40), 0, 100)

  const tradable = action != null && decision?.verdict === "TRADE" && intelScore >= MIN_INTEL_TRADE && decision.phase !== "volatile_range"
  let confidence = decision?.confidence ?? null
  if (tradable && confidence != null) confidence = Math.min(confidence, intelScore, CONFIDENCE_CAP)
  else if (confidence != null) confidence = Math.min(confidence, CONFIDENCE_CAP)

  const reasons = []
  if (decision?.reasons?.length) reasons.push(...decision.reasons.slice(0, 4))
  else if (mtf.reason) reasons.push(mtf.reason)
  if (volume.reason && vol) reasons.push(volume.reason)
  if (duration?.reason) reasons.push(duration.reason)
  if (edge.reason && vol) reasons.push(edge.reason)

  return {
    assetId: id,
    asset: name,
    action,
    intelScore,
    confidence,
    verdict: decision?.verdict ?? null,
    direction: decision?.direction ?? null,
    expirySec: decision?.expiry ?? duration?.suggestedSec ?? null,
    winProb: decision?.winProb ?? null,
    ev: decision?.ev ?? null,
    phase: decision?.phase ?? null,
    phaseLabel: decision?.phaseLabel ?? null,
    atrPct: decision?.atrPct ?? null,
    tradable,
    strategies: { mtf, phase, volume, rr, edge, duration },
    reasons,
    ts: Date.now()
  }
}

// ---------------------------------------------------------------------
// Ranked meta-analysis
// ---------------------------------------------------------------------

export function computeMarketIntel({ data, decisions = [], accuracy = [], now = Date.now() } = {}) {
  const bySymbol = {}
  for (const a of accuracy || []) {
    if (a?.key) bySymbol[String(a.key)] = a
  }
  const rows = (data?.assets ?? [])
    .map((asset) =>
      marketIntelAsset({
        asset,
        decision: decisions?.find((d) => d.assetId === asset.id) ?? null,
        accuracy: bySymbol[asset.name] ?? bySymbol[asset.id] ?? null
      })
    )
    .sort((a, b) => b.intelScore - a.intelScore)

  const best = rows[0] ?? null
  const recommendation = best?.tradable
    ? {
        market: best.asset,
        action: best.action,
        expirySec: best.expirySec,
        confidence: best.confidence,
        intelScore: best.intelScore,
        phase: best.phase,
        phaseLabel: best.phaseLabel,
        volatility: best.strategies?.duration?.label ?? null,
        durationSec: best.expirySec,
        reasons: best.reasons
      }
    : null

  const honesty = recommendation
    ? "Decision support only — confirm the entry on the platform before trading; size to a per-trade risk cap."
    : best
      ? `No market clears the confluence bar right now — best watch is ${best.asset} (${best.verdict ?? "insufficient data"}). Stand aside until conditions sharpen.`
      : "No market data yet — open a trading page in the content window to begin realtime analysis."

  return {
    ts: now,
    status: data?.status ?? "idle",
    mode: data?.mode ?? null,
    account: data?.account ?? null,
    viewed: data?.viewed ?? null,
    best,
    ranked: rows,
    recommendation,
    honesty
  }
}

// ---------------------------------------------------------------------
// Cached orchestrator
// ---------------------------------------------------------------------

const CACHE_TTL_MS = 8000
let cached = null
let cachedAt = 0

/**
 * Realtime meta-analysis over the whole watch set. Reuses the adaptive
 * confluence engine's cached per-market decisions and the signal-accuracy
 * ledger, so it is cheap enough for the every-5s realtime suite snapshot.
 */
export async function getMarketIntel() {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached
  try {
    const [dec, acc, data] = await Promise.allSettled([getDecisions(), signalAccuracy(), liveEOData()])
    const out = computeMarketIntel({
      data: dec.status === "fulfilled" ? { status: dec.value?.status, mode: dec.value?.mode, account: dec.value?.account, viewed: dec.value?.viewed, assets: data.status === "fulfilled" ? data.value?.assets ?? [] : [] } : { assets: data.status === "fulfilled" ? data.value?.assets ?? [] : [] },
      decisions: dec.status === "fulfilled" ? dec.value?.decisions ?? [] : [],
      accuracy: acc.status === "fulfilled" ? acc.value?.bySymbol ?? [] : [],
      now: Date.now()
    })
    cached = { ok: true, ...out }
    cachedAt = cached.ts
    return cached
  } catch (err) {
    return { ok: false, error: String(err), ts: Date.now(), best: null, ranked: [], recommendation: null, honesty: null }
  }
}
