// PICC feed anomaly detector — pure refusal-switch for bad market data.
//
// Detection module ONLY: no store, no IO, no caller wiring. Consumers that
// would call it (without being changed in this task):
//   - dataSources.mjs  classifySource(lastSeen)      → detectStale(lastAtMs, maxAgeMs)
//   - marketDataBus.mjs getBestCandles/getCrossSource → detectSpike / detectGaps / detectDivergence
//   - multiTimeframe.mjs quickMtfCheck (3×-timeframe stale gate, 20-bar floor)
// Candle shape follows the bus convention: { time (epoch SECONDS), close, … }.
// Times in ms are also accepted (magnitude-disambiguated) so venue feeds that
// already use Date.now() ms (dataSources lastSeen, bus stats().lastSeen) slot in.
//
// Honesty contract: every detector returns { ok:true } on pass,
// { ok:true, skipped } when there is too little data to judge (never a false
// alarm on thin buffers), or { ok:false, reason } naming the anomaly.
// NOTHING is ever filled or fabricated — gaps are reported, never invented.

// ── Named thresholds (rationale in each comment) ─────────────────────────────

// 6σ: conservative for FX/crypto noise. A 6σ close-to-close jump on an
// already-settled baseline is a bad tick / venue glitch, not volatility.
// Lower values (3–4σ) false-fire on news spikes during the stabilisation wave.
export const SPIKE_SIGMA = 6
// 20-bar floor: mirrors multiTimeframe's dashboard minimum (bars < 20) and the
// bus's thin-data line (≥30 wins, <30 last-resort). Below this the σ estimate
// itself is noise, so the detector abstains instead of alarming.
export const SPIKE_MIN_BARS = 20
// 1.5× expected interval: absorbs late writes / jitter (one slot arriving up
// to 50% late is transport, not loss) while flagging any truly skipped bucket.
export const GAP_FACTOR = 1.5
// ±0.5% close agreement: identical to marketDataBus CLOSE_AGREEMENT_TOLERANCE
// so a series the bus calls "verified" can never be called "diverged" here.
export const DIVERGENCE_TOLERANCE_PCT = 0.5
// 5 shared buckets: minimum overlap for a divergence verdict; fewer shared
// timestamps means the venues barely intersect (different sessions/windows),
// so abstain rather than compare noise.
export const DIVERGENCE_MIN_OVERLAP = 5

const EPS = 1e-12

function toMs(t) {
  const n = Number(t)
  if (!Number.isFinite(n)) return NaN
  return n > 1e12 ? n : n * 1000 // s vs ms disambiguation
}

function closes(candles) {
  if (!Array.isArray(candles)) return []
  return candles.map((c) => Number(c?.close))
}

/** Last-bar z-score vs the baseline of prior close-to-close returns. */
export function detectSpike(candles, { sigma = SPIKE_SIGMA, minBars = SPIKE_MIN_BARS } = {}) {
  if (!Array.isArray(candles) || candles.length < minBars) {
    return { ok: true, skipped: `insufficient-bars: need ${minBars}, got ${Array.isArray(candles) ? candles.length : 0}` }
  }
  const cs = closes(candles)
  if (cs.some((c) => !Number.isFinite(c))) {
    return { ok: false, reason: "spike: non-finite close in series (corrupt bar, refusing)" }
  }
  const rets = []
  for (let i = 1; i < cs.length; i++) {
    const base = Math.abs(cs[i - 1]) < EPS ? EPS : Math.abs(cs[i - 1])
    rets.push((cs[i] - cs[i - 1]) / base)
  }
  const baseline = rets.slice(0, -1)
  const last = rets[rets.length - 1]
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length
  const std = Math.sqrt(variance)
  if (!Number.isFinite(last)) return { ok: false, reason: "spike: non-finite last return (corrupt bar, refusing)" }
  if (std < EPS) {
    // Dead-flat baseline: any material last move is anomalous by definition.
    if (Math.abs(last) < EPS) return { ok: true }
    return { ok: false, reason: `spike: last move ${(last * 100).toFixed(2)}% on flat baseline exceeds ${sigma}σ (zero-variance series)` }
  }
  const z = (last - mean) / std
  if (Math.abs(z) > sigma) {
    return { ok: false, reason: `spike: last-bar z=${z.toFixed(1)} exceeds ${sigma}σ (move ${(last * 100).toFixed(2)}% vs baseline ${(mean * 100).toFixed(3)}% ± ${(std * 100).toFixed(3)}%)` }
  }
  return { ok: true }
}

/** Missing-interval detection. Reports holes; never synthesises replacement bars. */
export function detectGaps(candles, expectedIntervalMs, { factor = GAP_FACTOR } = {}) {
  const expected = Number(expectedIntervalMs)
  if (!Number.isFinite(expected) || expected <= 0) {
    return { ok: true, skipped: "gap: no expected interval supplied" }
  }
  if (!Array.isArray(candles) || candles.length < 2) {
    return { ok: true, skipped: `gap: need ≥2 bars, got ${Array.isArray(candles) ? candles.length : 0}` }
  }
  const times = candles.map((c) => toMs(c?.time)).filter(Number.isFinite).sort((a, b) => a - b)
  if (times.length < 2) return { ok: true, skipped: "gap: no parseable timestamps" }
  let missing = 0
  const ranges = []
  for (let i = 0; i < times.length - 1; i++) {
    const delta = times[i + 1] - times[i]
    if (!(delta > expected * factor)) continue
    const missed = Math.max(1, Math.round(delta / expected) - 1)
    missing += missed
    ranges.push({ fromMs: times[i], toMs: times[i + 1], missing: missed })
  }
  if (missing > 0) {
    return {
      ok: false,
      reason: `gap: ${missing} missing interval(s) across ${ranges.length} hole(s) (expected ${expected}ms)`,
      missing,
      holes: ranges.length,
      ranges,
    }
  }
  return { ok: true }
}

/** Feed-age gate. Mirrors dataSources FRESH/STALE bounds; caller owns maxAgeMs. */
export function detectStale(lastAtMs, maxAgeMs, nowMs = Date.now()) {
  const last = Number(lastAtMs)
  const maxAge = Number(maxAgeMs)
  const now = Number(nowMs)
  if (!Number.isFinite(last) || last <= 0) {
    return { ok: false, reason: "unconfigured: no feed write timestamp observed (refusing)" }
  }
  if (!Number.isFinite(maxAge) || maxAge <= 0 || !Number.isFinite(now)) {
    return { ok: true, skipped: "stale: no usable max-age/now bound supplied" }
  }
  const ageMs = Math.max(0, now - last)
  if (ageMs > maxAge) {
    return { ok: false, reason: `stale: feed age ${Math.round(ageMs)}ms exceeds max ${Math.round(maxAge)}ms`, ageMs, maxAgeMs: maxAge }
  }
  return { ok: true, ageMs }
}

/** Cross-venue close agreement on shared buckets (never rewrites OHLC). */
export function detectDivergence(a, b, tolerancePct = DIVERGENCE_TOLERANCE_PCT) {
  const tol = Number(tolerancePct)
  if (!Array.isArray(a) || !Array.isArray(b)) return { ok: true, skipped: "divergence: venue series missing" }
  const mapB = new Map()
  for (const c of b) {
    const t = toMs(c?.time)
    const close = Number(c?.close)
    if (Number.isFinite(t) && Number.isFinite(close)) mapB.set(t, close)
  }
  let overlap = 0
  let maxPct = 0
  let worstTime = null
  for (const c of a) {
    const t = toMs(c?.time)
    const ca = Number(c?.close)
    if (!Number.isFinite(t) || !Number.isFinite(ca)) continue
    if (!mapB.has(t)) continue
    const cb = mapB.get(t)
    overlap++
    const pct = (Math.abs(ca - cb) / Math.max(Math.abs(ca), EPS)) * 100
    if (pct > maxPct) {
      maxPct = pct
      worstTime = t
    }
  }
  if (overlap < DIVERGENCE_MIN_OVERLAP) {
    return { ok: true, skipped: `divergence: insufficient overlap (${overlap}/${DIVERGENCE_MIN_OVERLAP} shared buckets)` }
  }
  if (maxPct > tol) {
    return {
      ok: false,
      reason: `divergence: max close disagreement ${maxPct.toFixed(2)}% exceeds tolerance ${tol}% across ${overlap} shared bucket(s)`,
      maxPct: Math.round(maxPct * 100) / 100,
      tolerancePct: tol,
      overlap,
      worstTimeMs: worstTime,
    }
  }
  return { ok: true, overlap, maxPct: Math.round(maxPct * 100) / 100 }
}

/**
 * Composite refuse-switch: runs every applicable check, collects ALL named
 * reasons (no short-circuit — operators see the full damage list).
 * Shape: { ok, reasons[], checks: { spike, gap, stale, divergence } }.
 * Omitted inputs skip their check (thin buffers abstain, never false-alarm).
 */
export function assessFeedQuality({
  candles,
  expectedIntervalMs,
  lastAtMs,
  maxAgeMs,
  sibling,
  tolerancePct = DIVERGENCE_TOLERANCE_PCT,
  nowMs = Date.now(),
} = {}) {
  const reasons = []
  const checks = {}
  if (candles !== undefined) {
    checks.spike = detectSpike(candles)
    if (!checks.spike.ok) reasons.push(checks.spike.reason)
    if (expectedIntervalMs !== undefined) {
      checks.gap = detectGaps(candles, expectedIntervalMs)
      if (!checks.gap.ok) reasons.push(checks.gap.reason)
    }
  }
  if (lastAtMs !== undefined || maxAgeMs !== undefined) {
    checks.stale = detectStale(lastAtMs, maxAgeMs, nowMs)
    if (!checks.stale.ok) reasons.push(checks.stale.reason)
  }
  if (sibling !== undefined && candles !== undefined) {
    checks.divergence = detectDivergence(candles, sibling, tolerancePct)
    if (!checks.divergence.ok) reasons.push(checks.divergence.reason)
  }
  return { ok: reasons.length === 0, reasons, checks }
}
