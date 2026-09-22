// v3.2 Plan 3 — v32Engine: per-asset composition of the v3.2 lane
// (regime → execution score → cost line → copilot gate → decision row,
// REQ-P3-6/8/10/12; blueprint §5/§6; ADR-0004).
//
// Pure composition boundary. Imports are read-only from frozen surfaces
// (constitution, v32Context, v32Execution, v32Copilot, u4faConfig, fourFactor);
// it never edits legacy modules. The chop-latch continuity map mirrors
// u4faRegimeStates (adaptiveConfluence.mjs:661) but is owned here so the
// engine is self-contained.

import { assembleRegime } from "./v32Context.mjs"
import { costAdjustedEv, EV_RR_MIN } from "./constitution.mjs"
import { vwapPillar, emaPair, volumeDelta, cumulativeVolumeDelta, relativeVolume, executionScore } from "./v32Execution.mjs"
import { copilotGate } from "./v32Copilot.mjs"
import { resolveAssetConfig, deepMergeConfig, U4FA_DEFAULTS } from "./u4faConfig.mjs"
import { evaluatePillarGate } from "./v32PillarGate.mjs"

// ---------------------------------------------------------------------
// Chop-latch continuity map (mirrors u4faRegimeStates)
// ---------------------------------------------------------------------
const v32RegimeStates = new Map()
export function resetV32RegimeStates() {
  v32RegimeStates.clear()
}

// ---------------------------------------------------------------------
// Assistants
// ---------------------------------------------------------------------

const VENUE_BY_CLASS = Object.freeze({ crypto: "crypto", forex: "forex", gold: "eo", indices: "eo", commodities: "eo" })

function venueFor(classKey) {
  return VENUE_BY_CLASS[String(classKey)] ?? "eo"
}

function ranges(candles) {
  const highs = []
  const lows = []
  const closes = []
  for (const c of Array.isArray(candles) ? candles : []) {
    highs.push(Number(c?.high))
    lows.push(Number(c?.low))
    closes.push(Number(c?.close))
  }
  return { highs, lows, closes }
}

// ---------------------------------------------------------------------
// REQ-P3-12 — per-asset context batch (mirrors buildU4faStrategy inputs,
// adaptiveConfluence.mjs:672-696)
// ---------------------------------------------------------------------
/**
 * Assemble one asset's `assembleRegime` inputs the way `buildU4faStrategy`
 * does (60s candles; 3600 plane when present; D1 honestly null — "Yahoo EOD
 * not in the live cycle", :684; calendar/spread/losses from the runtime
 * context). Returns the assembled regime + the identity/venue the decision
 * needs. Resolves the calibration class for pipSize, expiry, session window
 * and currencies (REQ-CAL refuses unclassified assets honestly).
 */
export function v32ContextForAsset(asset, ctx = {}, v32Config = {}, { planes = {}, sourceByTf = {}, byTf = {} } = {}) {
  const id = String(asset?.id ?? "")
  // Mirror the live load path: a partial runtime config is deep-merged over
  // U4FA_DEFAULTS so class calibration rows always resolve (u4faConfig.mjs:142).
  const config = deepMergeConfig(U4FA_DEFAULTS, ctx.config ?? {})
  const resolved = resolveAssetConfig(id, config)
  if (resolved.accessibility !== "trade") {
    return { ok: false, id, assetId: resolved.assetId ?? id, venue: venueFor(resolved.class), reason: resolved.reason ?? `asset ${id} not tradeable (REQ-CAL)` }
  }
  const candles300 = Array.isArray(asset?.periods?.[300]) ? asset.periods[300] : []
  const hourly3600 = Array.isArray(asset?.periods?.[3600]) ? asset.periods[3600] : null
  const { highs, lows, closes } = ranges(candles300)
  const state = v32RegimeStates.get(id) ?? { chop: false, streak: 0 }
  const regime = assembleRegime({
    highs,
    lows,
    closes,
    state,
    planes,
    sourceByTf,
    byTf,
    structure: { hourlyCandles: hourly3600, dailyCandles: null, price: closes[closes.length - 1] ?? null, pipSize: resolved.pipSize },
    session: resolved.session ?? {},
    f1: {},
    spread: ctx.spread ?? null,
    maxSpreadPips: resolved.maxSpreadPips,
    losses: ctx.losses ?? [],
    correlations: config.correlations ?? {},
    news: ctx.news ?? {},
    events: ctx.calendarEvents ?? [],
    currencies: resolved.currencies ?? [],
    vol: {},
    nowMs: ctx.now ?? Date.now()
  })
  return {
    ok: true,
    id,
    venue: venueFor(resolved.class),
    class: resolved.class,
    assetId: resolved.assetId ?? id,
    expiry: resolved.expiry,
    session: resolved.session,
    pipSize: resolved.pipSize,
    maxSpreadPips: resolved.maxSpreadPips,
    currencies: resolved.currencies ?? [],
    candles: candles300,
    hourlyCandles: hourly3600,
    regime,
    sources: {
      calendarSource: ctx.calendarSource ?? "fallback-schedule",
      candleSource: ctx.candleSource ?? "unknown",
      spreadSource: ctx.spread?.source ?? "unmeasurable (no bid/ask source)"
    }
  }
}

/**
 * REQ-P3-10 — re-derive the v3.2 engine's realized cost-adjusted expectancy
 * over caller-supplied correctly-answered rows (the identical formula
 * `constitution.expectancyOf` uses — private at constitution.mjs:219 — see
 * spec §2.4 Design decision 4). Payout 82 fallback per REQ-CON-4/flipGate.
 * A consistency test asserts equality with `flipGate`'s internal numbers.
 */
export function rederiveExpectancy(rows = [], engine = "v3.2", payout = 82) {
  const rowsOf = (Array.isArray(rows) ? rows : []).filter((r) => r?.engine === engine)
  if (!rowsOf.length) return null
  let stake = 0
  let ev = 0
  for (const r of rowsOf) {
    const total = Number(r.total) || 0
    const hits = Number(r.hits) || 0
    const misses = Number(r.misses) || 0
    stake += total
    ev += hits * (payout / 100) - misses // per $1: wins pay b/100, losses lose the stake
  }
  return stake > 0 ? ev / stake : null
}

/**
 * REQ-P3-10 — the strict REQ-CON-5 confidence. Sample size = the v3.2
 * decided-row count; cost-adjusted expectancy = the re-derived value. Empty
 * ledger → honest `available:false` (no standalone number is ever claimed);
 * when present it is EXACTLY { sampleSize, costAdjustedExpectancy }.
 */
function confidenceFor(rows) {
  const sampleSize = (Array.isArray(rows) ? rows : []).filter((r) => r?.engine === "v3.2").reduce((a, r) => a + (Number(r.total) || 0), 0)
  const expectancy = rederiveExpectancy(rows, "v3.2")
  if (sampleSize <= 0 || expectancy == null) {
    return { available: false, sampleSize: 0, costAdjustedExpectancy: null, reason: "no v3.2 decided rows yet" }
  }
  return { available: true, sampleSize, costAdjustedExpectancy: expectancy }
}

// REQ-P3-13 (WS-2 decision 9): 5-of-7 pillar descriptors from already-computed reads; unmeasurable reads honest-fail.
function leanOf(key, p) {
  switch (key) {
    case "vwap": return p?.side === "above" ? "up" : p?.side === "below" ? "down" : null
    case "ema": return p?.aligned === "long" ? "up" : p?.aligned === "short" ? "down" : null
    case "volumeDelta": return Number(p?.delta) > 0 ? "up" : Number(p?.delta) < 0 ? "down" : null
    case "cvd": return Number(p?.last) > 0 ? "up" : Number(p?.last) < 0 ? "down" : null
    default: return null
  }
}

function describeOf(key, p, fallback) {
  switch (key) {
    case "vwap": {
      if (p?.available !== true) return fallback
      return p.distancePct != null ? `price ${p.side} cumulative VWAP (${(Number(p.distancePct) * 100).toFixed(2)}%)` : `price ${p.side} cumulative VWAP`
    }
    case "ema": {
      if (p?.available !== true) return fallback
      return `EMA 9/21 ${p.aligned}`
    }
    case "volumeDelta": {
      if (p?.available !== true) return fallback
      return `volume delta ${p.delta} (${p.buy} buy / ${p.sell} sell)`
    }
    case "cvd": {
      if (p?.available !== true) return fallback
      return `CVD ${p.last}`
    }
    default: return fallback
  }
}

function gateDescriptor(key, p, direction) {
  if (p?.available !== true) {
    return { available: false, agrees: false, reason: typeof p?.reason === "string" && p.reason ? p.reason : `${key} unmeasured` }
  }
  const lean = leanOf(key, p)
  return { available: true, agrees: direction != null && lean === direction, reason: describeOf(key, p, `${key} measured`) }
}

function htfBiasDescriptor(bias, direction) {
  if (bias?.available !== true) {
    return { available: false, agrees: false, reason: bias?.reason ?? "no HTF bias register (no TF inputs)" }
  }
  let pos = 0
  let neg = 0
  for (const tf of Object.values(bias.register ?? {})) {
    for (const v of Object.values(tf ?? {})) {
      if (v?.observed && v.value != null && v.value !== 0) (v.value > 0 ? pos++ : neg++)
    }
  }
  if (pos + neg === 0) return { available: true, agrees: false, reason: "HTF bias register has no directional votes" }
  if (pos === neg) return { available: true, agrees: false, reason: `HTF bias conflicted (${pos} pos / ${neg} neg)` }
  const lean = pos > neg ? "up" : "down"
  return { available: true, agrees: direction != null && direction === lean, reason: `HTF bias ${pos} pos / ${neg} neg (${lean})` }
}

function adxDescriptor(adx, direction) {
  if (adx?.available !== true) {
    return { available: false, agrees: false, reason: adx?.reason ?? "no ADX regime register" }
  }
  if (adx.chop === true) {
    return { available: true, agrees: false, reason: `adx ${adx.adx} tier ${adx.tier} — chop regime, no trend to align` }
  }
  const lean = adx.trend === "up" || adx.trend === "down" ? adx.trend : null
  return { available: true, agrees: direction != null && lean === direction, reason: `adx ${adx.adx} tier ${adx.tier} trend ${adx.trend}` }
}

// ---------------------------------------------------------------------
// REQ-P3-6 — the cost line (constitution.costAdjustedEv().line + verdict)
// ---------------------------------------------------------------------
function costLineFor({ winProb, payout = 82, spreadPips = 1.5, slippagePips = 0, evRRMin = EV_RR_MIN }) {
  const p = Number(winProb)
  const pay = Number(payout)
  if (!Number.isFinite(p) || p <= 0 || p >= 1 || !(Number.isFinite(pay) && pay > 0)) {
    return null // honest: no win probability / payout → the entry's economics are unprovable
  }
  const result = costAdjustedEv({ winProb: p, payoutPct: pay, spreadPips, slippagePips, evRRMin })
  if (result.line == null) return null
  return { ...result.line, evRR: result.evRR, evRRPass: result.evRRPass }
}

// ---------------------------------------------------------------------
// REQ-P3-8/12 — the per-asset decision row
// ---------------------------------------------------------------------
/**
 * Compose one v3.2 decision row: regime → execution score → cost line →
 * copilot gate → row tagged `engine:"v3.2"`. `data` carries the boundary
 * inputs the live cycle supplies at the edge (winProb/payout from the
 * evaluateAsset seam, `rows` from correctlyAnsweredByEngine(),
 * `risk` from the day-state + runtime store) so this module stays
 * deterministic and ledger-free. The verdict:
 *   TRADE   — score directional + cost line passing + every wire clear
 *   NEUTRAL — any wire tripped (copilot veto downgrades TRADE, REQ-P3-8)
 *   OBSERVE — direction or cost line not provable
 */
export function v32DecisionForAsset({ ctx, v32Config = {}, now = Date.now(), data = {} } = {}) {
  if (ctx == null || ctx.ok !== true) {
    return { engine: "v3.2", assetId: ctx?.id ?? "?", verdict: "OBSERVE", reason: ctx?.reason ?? "no v3.2 context" }
  }
  const venue = ctx.venue
  const closes = ctx.candles.map((c) => Number(c?.close))
  const pillars = {
    vwap: vwapPillar({ candles: ctx.candles, anchor: "cumulative" }),
    ema: emaPair({ closes }),
    volumeDelta: volumeDelta({ trades: data.trades ?? null }),
    cvd: cumulativeVolumeDelta({ trades: data.trades ?? null }),
    relativeVolume: relativeVolume({ candles: ctx.candles })
  }
  const score = executionScore({ pillars, venue })
  const costLine = costLineFor({
    winProb: data.winProb,
    payout: data.payout,
    spreadPips: Number.isFinite(Number(data.spreadPips)) ? data.spreadPips : ctx.maxSpreadPips ?? 1.5,
    slippagePips: Number(data.slippagePips) || 0,
    evRRMin: Number(data.evRRMin) || EV_RR_MIN
  })
  const copilot = copilotGate({
    regime: ctx.regime,
    execution: { score, costLine },
    constitution: { evRRMin: Number(data.evRRMin) || EV_RR_MIN },
    risk: data.risk ?? {},
    config: v32Config
  })
  const confidence = confidenceFor(data.rows)

  const scoreOk = score.available === true && (score.direction === "up" || score.direction === "down")
  const costOk = costLine != null && costLine.evRRPass === true
  const copilotOk = copilot.ok === true
  const direction = scoreOk ? score.direction : null

  const gatePillars = {
    htfbias: htfBiasDescriptor(ctx.regime?.registers?.bias, direction),
    vwap: gateDescriptor("vwap", pillars.vwap, direction),
    ema921: gateDescriptor("ema", pillars.ema, direction),
    volumedelta: gateDescriptor("volumeDelta", pillars.volumeDelta, direction),
    cvd: gateDescriptor("cvd", pillars.cvd, direction),
    adxregime: adxDescriptor(ctx.regime?.registers?.adx, direction)
  }
  const pillarGate = evaluatePillarGate({ pillars: gatePillars, v32Config })

  let verdict
  if (!scoreOk || !costOk) verdict = "OBSERVE"
  else if (!copilotOk) verdict = "NEUTRAL"
  else if (!pillarGate.ok) verdict = "OBSERVE"
  else verdict = "TRADE"

  const reasons = []
  if (!scoreOk) {
    reasons.push(score.reason ?? `score not directional (${score?.direction ?? "none"})`)
  }
  if (!costOk) {
    reasons.push(costLine == null ? "cost line unobtainable (REQ-P3-6)" : `cost line below ${costLine.evRRMin}:1 EV margin`)
  }
  if (!copilotOk) {
    reasons.push(`copilot wires blocked: ${copilot.blockedBy.join(", ")}`)
    for (const w of copilot.wires) {
      if (w.tripped && !reasons.some((r) => r.includes(`wire ${w.id}`))) reasons.push(`wire ${w.id}: ${w.reason}`)
    }
  }
  if (!pillarGate.ok) {
    reasons.push(`5-of-7 pillar gate blocked: ${pillarGate.agreed}/${pillarGate.needed} agreeing`)
    for (const r of pillarGate.rows) {
      if (!(r.agrees === true)) reasons.push(`pillar ${r.id}: ${r.reason}`)
    }
  }

  // Chop-latch continuity: persist the post-latch ADX state (2-bar re-arm) so
  // the NEXT context assembles from the carried latch, mirroring decideAssets.
  if (ctx.regime?.registers?.adx?.available === true && ctx.regime.registers.adx.nextState) {
    v32RegimeStates.set(ctx.id, ctx.regime.registers.adx.nextState)
  }

  return {
    engine: "v3.2",
    assetId: ctx.assetId,
    asset: ctx.id,
    direction,
    expiry: ctx.expiry,
    ts: now,
    score,
    costLine,
    confidence,
    regime: ctx.regime,
    copilot,
    verdict,
    gates: { score: scoreOk, costLine: costOk, copilot: copilotOk, pillars5of7: pillarGate },
    reasons,
    honesty: {
      sampleSource: data.rows ? "correctlyAnsweredByEngine (caller-supplied)" : "none supplied",
      spreadSource: ctx.sources.spreadSource,
      calendarSource: ctx.sources.calendarSource,
      candleSource: ctx.sources.candleSource,
      tradesFeed: Array.isArray(data.trades) && data.trades.length ? "trades" : "absent"
    }
  }
}