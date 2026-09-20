// v3.2 Plan 3 — v32Execution module: the Execution 5-point pillars + per-venue
// score composition (REQ-P3-2/3/4/5, blueprint §4, B-IND-0 §10.1/10.2/10.4).
//
// Pure module. Wraps indicators.vwap / indicators.ema read-only (never edits
// them). Honesty pins (G2): every pillar carries `available` + `source` +
// reasons; a missing trades feed is reported, never synthesized. The score is
// a directional ENTRY ARGUMENT — it deliberately carries NO `confidence` field
// (REQ-CON-5 bans standalone scores/probabilities on decision rows; this
// module never emits one).
//
// Venue degradation (S3 / blueprint §4): crypto = full 5-point where the feed
// exists (VWAP + EMA 9/21 + Δ/CVD + rel-vol); forex/EO = VWAP + EMA 9/21 only,
// the volume legs listed as honestly unavailable (no maker-flow feed).

import { vwap, ema } from "./indicators.mjs"

const VWAP_MIN_BARS = 15
const DEFAULT_SESSION_OPEN_INDEX = 0

function round4(x) {
  return Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x
}

function candlesToArrays(candles) {
  const highs = []
  const lows = []
  const closes = []
  const volumes = []
  for (const c of Array.isArray(candles) ? candles : []) {
    highs.push(Number(c?.high))
    lows.push(Number(c?.low))
    closes.push(Number(c?.close))
    volumes.push(Number(c?.volume) > 0 ? Number(c?.volume) : 0)
  }
  return { highs, lows, closes, volumes }
}

// ---------------------------------------------------------------------
// REQ-P3-2 — VWAP dual-anchor pillar
// ---------------------------------------------------------------------
/**
 * Anchored-cumulative VWAP (wraps indicators.vwap, cumulative across the whole
 * series, B-IND-0 §10.1) OR session-reset VWAP recomputed from the
 * session-open bar only (net-new secondary anchor). Honest below min bars.
 */
export function vwapPillar({ candles = [], anchor = "cumulative", sessionOpenIndex = DEFAULT_SESSION_OPEN_INDEX } = {}) {
  const list = Array.isArray(candles) ? candles : []
  const { highs, lows, closes, volumes } = candlesToArrays(list)
  if (closes.length < VWAP_MIN_BARS || !closes.every((c) => Number.isFinite(c))) {
    return { available: false, anchor, vwap: null, price: null, side: "n/a", distancePct: null, reason: `< ${VWAP_MIN_BARS} bars — VWAP unavailable` }
  }
  if (anchor !== "cumulative" && anchor !== "session") {
    return { available: false, anchor, vwap: null, price: null, side: "n/a", distancePct: null, reason: `unknown anchor "${anchor}" (cumulative|session)` }
  }

  let h = highs
  let l = lows
  let c = closes
  let v = volumes
  if (anchor === "session") {
    const from = Number.isInteger(sessionOpenIndex) ? sessionOpenIndex : DEFAULT_SESSION_OPEN_INDEX
    if (from < 0 || from >= list.length) {
      return { available: false, anchor, vwap: null, price: null, side: "n/a", distancePct: null, reason: `sessionOpenIndex ${from} out of range (0..${list.length - 1})` }
    }
    h = h.slice(from)
    l = l.slice(from)
    c = c.slice(from)
    v = v.slice(from)
  }

  // The wrapped indicator's `volumes` param treats 0/undefined as 1 — but for
  // the honest session-reset recompute we must NOT silently substitute volume
  // the array lacked. vwap() does `v[i] > 0 ? v[i] : 1`; a session-reset pass
  // over devolumed candles would still compute (with vol=1). This module
  // hands through whatever the caller supplied (0 → 1 inside the indicator),
  // same cumulative contract; the honest-availability contract covers bar
  // COUNT, not volume presence, for the VWAP pillar (volume presence is the
  // relative-volume pillar's honesty gate).
  const series = vwap(h, l, c, v)
  const lastIndex = series.length - 1
  const vwapVal = series[lastIndex]
  if (!Number.isFinite(vwapVal)) {
    return { available: false, anchor, vwap: null, price: null, side: "n/a", distancePct: null, reason: "VWAP did not resolve on the supplied series" }
  }
  const price = Number(c[lastIndex])
  const side = price >= vwapVal ? "above" : "below"
  const distancePct = vwapVal > 0 ? (price - vwapVal) / vwapVal : null
  return {
    available: true,
    anchor,
    vwap: round4(vwapVal),
    price,
    side,
    distancePct: distancePct != null ? round4(distancePct) : null,
    source: anchor === "cumulative" ? "indicators.vwap (REQ-P3-2)" : "session-reset recompute (REQ-P3-2)"
  }
}

// ---------------------------------------------------------------------
// REQ-P3-3 — EMA 9/21 alignment + separation pillar
// ---------------------------------------------------------------------
/**
 * Fast-pair EMA alignment over indicators.ema (blueprint §4 pillars 2–3).
 * aligned: "long" (9>21), "short" (9<21), "flat" (equal), or "crossing" when
 * the pair straddles within a resolution huddle. Honest when the pair never
 * resolved.
 */
export function emaPair({ closes = [] } = {}) {
  const list = Array.isArray(closes) ? closes.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : []
  if (list.length < 21) {
    return { available: false, ema9: null, ema21: null, aligned: "flat", spread: null, spreadPct: null, reason: `insufficient bars (${list.length}) for EMA 9/21` }
  }
  const e9 = ema(list, 9)
  const e21 = ema(list, 21)
  const last = list.length - 1
  const v9 = e9[last]
  const v21 = e21[last]
  if (!Number.isFinite(v9) || !Number.isFinite(v21)) {
    return { available: false, ema9: null, ema21: null, aligned: "flat", spread: null, spreadPct: null, reason: "EMA pair did not resolve" }
  }
  const spread = v9 - v21
  const eps = 1e-9
  let aligned
  if (Math.abs(spread) <= eps) aligned = "flat"
  else aligned = spread > 0 ? "long" : "short"
  return {
    available: true,
    ema9: round4(v9),
    ema21: round4(v21),
    aligned,
    spread: round4(spread),
    spreadPct: v9 > 0 ? round4(spread / v9) : null,
    source: "indicators.ema 9/21 (REQ-P3-3)"
  }
}

// ---------------------------------------------------------------------
// REQ-P3-4 — Δ/CVD + relative-volume pillars (B-IND-0 §8)
// ---------------------------------------------------------------------
/**
 * Volume delta over a caller-supplied signed-trades series (maker flow).
 * trades = [{ timeMs, price, side: "buy"|"sell"|"take", amount }]. A missing
 * feed is honest-null ("no trades feed") — never synthesized. Trades absent
 * entirely ({}): available false, reason "no trades feed".
 */
export function volumeDelta({ trades = null } = {}) {
  const list = Array.isArray(trades) ? trades : null
  if (list == null) {
    return { available: false, delta: null, buy: 0, sell: 0, takeFill: 0, trades: 0, reason: "no trades feed" }
  }
  let buys = 0, sells = 0, takes = 0
  for (const t of list) {
    const amt = Number(t?.amount) || 0
    if (t?.side === "buy") buys += amt
    else if (t?.side === "sell") sells += amt
    else if (t?.side === "take") takes += amt
  }
  return {
    available: true,
    delta: round4(buys - sells),
    buy: round4(buys),
    sell: round4(sells),
    takeFill: round4(takes),
    trades: list.length,
    source: "signed-trades maker flow (REQ-P3-4)"
  }
}

/**
 * Cumulative volume delta over the same signed-trades series. `series` is the
 * running delta after each trade; `last` = final. Same honest-null contract.
 */
export function cumulativeVolumeDelta({ trades = null } = {}) {
  const list = Array.isArray(trades) ? trades : null
  if (list == null) {
    return { available: false, series: [], last: null, trades: 0, reason: "no trades feed" }
  }
  const series = []
  let run = 0
  for (const t of list) {
    const amt = Number(t?.amount) || 0
    if (t?.side === "buy") run += amt
    else if (t?.side === "sell") run -= amt
    // "take" fills consume resting size without moving the delta
    series.push(round4(run))
  }
  return {
    available: true,
    series,
    last: series.length ? series[series.length - 1] : 0,
    trades: list.length,
    source: "signed-trades maker flow (REQ-P3-4)"
  }
}

/**
 * Relative volume: last bar's volume vs the trailing simple average over the
 * previous `window` bars (crypto-only by construction — forex/EO have no
 * volume field). Honest when candles carry no volume or too few bars.
 */
export function relativeVolume({ candles = [], window = 20 } = {}) {
  const list = Array.isArray(candles) ? candles : []
  if (list.length < window + 1) {
    return { available: false, last: null, avg: null, ratio: null, reason: `insufficient bars (${list.length} < ${window + 1})` }
  }
  const vols = list.map((c) => Number(c?.volume))
  if (vols.slice(-window).some((v) => !Number.isFinite(v) || v <= 0)) {
    return { available: false, last: null, avg: null, ratio: null, reason: "candles carry no volume data — rel-vol unavailable" }
  }
  const lastVol = vols[vols.length - 1]
  const prev = vols.slice(-(window + 1), -1)
  const avg = prev.reduce((s, v) => s + v, 0) / prev.length
  return {
    available: true,
    last: round4(lastVol),
    avg: round4(avg),
    ratio: avg > 0 ? round4(lastVol / avg) : null,
    source: "ccxt OHLCV bar volume (REQ-P3-4)"
  }
}

// ---------------------------------------------------------------------
// REQ-P3-5 — per-venue score composition
// ---------------------------------------------------------------------
const VENUE_PILLARS = Object.freeze({
  crypto: [
    { key: "vwap", label: "VWAP (cumulative)" },
    { key: "ema", label: "EMA 9/21" },
    { key: "volumeDelta", label: "volume delta" },
    { key: "cvd", label: "cumulative volume delta" },
    { key: "relativeVolume", label: "relative volume" }
  ],
  forex: [
    { key: "vwap", label: "VWAP (cumulative)" },
    { key: "ema", label: "EMA 9/21" }
  ],
  eo: [
    { key: "vwap", label: "VWAP (cumulative)" },
    { key: "ema", label: "EMA 9/21" }
  ]
})

// Forex/EO have no maker-flow feed at all (B-IND-0 §8): their volume legs are
// ALWAYS listed as honestly unavailable rather than silently dropped.
const VENUE_EXCLUDED = Object.freeze({
  crypto: [],
  forex: [
    { key: "volumeDelta", label: "volume delta" },
    { key: "cvd", label: "cumulative volume delta" },
    { key: "relativeVolume", label: "relative volume" }
  ],
  eo: [
    { key: "volumeDelta", label: "volume delta" },
    { key: "cvd", label: "cumulative volume delta" },
    { key: "relativeVolume", label: "relative volume" }
  ]
})

/**
 * Compose the directional entry score. crypto = full 5-point where the feed
 * exists; forex/EO = VWAP + EMA only, volume legs honestly unavailable.
 * Each measured pillar contributes a directional sign (up/down/neutral)
 * derived from its NATIVE fields — the module never invents a direction the
 * underlying indicator did not express. `score` = agreement fraction of the
 * majority direction over measured pillars (0..1); `direction` = the majority
 * read. The emitted object NEVER carries a `confidence` field (REQ-CON-5/
 * REQ-P3-5: the score is an entry ARGUMENT, not a probability).
 */
function pillarDirection(key, p) {
  switch (key) {
    case "vwap": return p.side === "above" ? "up" : p.side === "below" ? "down" : "neutral"
    case "ema": return p.aligned === "long" ? "up" : p.aligned === "short" ? "down" : "neutral"
    case "volumeDelta": return Number(p.delta) > 0 ? "up" : Number(p.delta) < 0 ? "down" : "neutral"
    case "cvd": return Number(p.last) > 0 ? "up" : Number(p.last) < 0 ? "down" : "neutral"
    case "relativeVolume": return Number(p.ratio) > 1 ? "up" : Number(p.ratio) < 1 ? "down" : "neutral"
    default: return "neutral"
  }
}

export function executionScore({ pillars = {}, venue = "crypto" } = {}) {
  const list = VENUE_PILLARS[venue] ?? VENUE_PILLARS.crypto
  const excluded = VENUE_EXCLUDED[venue] ?? []
  const present = []
  const degraded = []
  let upPillars = 0
  let downPillars = 0
  for (const { key, label } of list) {
    const p = pillars[key]
    if (p == null || p.available !== true) {
      degraded.push({
        pillar: key,
        reason: p?.reason ?? `${label} not measured${venue === "forex" || venue === "eo" ? ` (${venue} venue)` : ""}`
      })
      continue
    }
    const direction = pillarDirection(key, p)
    present.push({ pillar: key, ...p, direction })
    if (direction === "up") upPillars++
    else if (direction === "down") downPillars++
  }
  for (const { key, label } of excluded) {
    degraded.push({ pillar: key, reason: `${label} not measured on ${venue} venue — no maker-flow feed` })
  }
  if (present.length === 0) {
    return { available: false, score: null, direction: "neutral", pillars: present, degraded, reason: "no usable pillars" }
  }
  const majority = upPillars > downPillars ? "up" : downPillars > upPillars ? "down" : "neutral"
  const agree = majority === "up" ? upPillars : majority === "down" ? downPillars : Math.max(upPillars, downPillars)
  return {
    available: true,
    score: round4(agree / present.length),
    direction: majority,
    pillars: present,
    degraded,
    source: `execution score over ${present.length} pillar(s) (REQ-P3-5)`
  }
}