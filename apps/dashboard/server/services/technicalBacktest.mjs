// Technical backtest harness (spec 9b) - pure, no I/O.
//
// Walks a multi-timeframe candle series, fires the convergence engine at each
// CLOSED decision bar, and buckets forward hit-rates per engine state over a
// moving window. The honesty obligations from the research note (B7: Bailey,
// Borwein, Lopez de Prado & Zhu 2014; Harvey & Liu 2015) are structural, not
// decorative:
//
//   1. NO LOOK-AHEAD - a decision at entry-bar `d` sees only candles closed
//      at or before it. Higher-timeframe planes contribute only their last
//      fully closed candle (the repaint-safe information barrier; the B4 note
//      measured that an off-by-one HTF merge inflated ROC-AUC ~0.20). Truth
//      spans STRICTLY after the decision bar, mirroring prediction.mjs:208-213.
//   2. CONFIGS TRIED - every parameter configuration runs on the in-sample
//      slice and the full list plus the count are reported beside the best.
//   3. UNTOUCHED OUT-OF-SAMPLE SLICE - the last `reserve` fraction is split
//      off before ANY tuning; the best IS config is evaluated there only
//      after selection (expanding-window warmup, never used for tuning).
//   4. TRANSACTION COSTS - a round-trip cost fraction is modeled; gross and
//      net hit-rates are reported side by side so the cost haircut is visible
//      in the same output.
//   5. BACKTEST-ONLY LABEL - every report node declares itself backtest-only;
//      nothing here is a live expectation.
import { MIN_BARS, converge } from "./mtfConvergence.mjs"

const EPS = 1e-9

export const BACKTEST_LABEL = "backtest-only"

export const DISCLAIMER =
  "Backtest-only: simulation on historical candles, not a live expectation. " +
  "Configurations tried, an untouched out-of-sample slice, and transaction " +
  "costs are all reported because high in-sample win rates are the expected " +
  "artifact of parameter mining (Bailey/Borwein/Lopez de Prado/Zhu 2014; " +
  "Harvey & Liu 2015)."

/** Direction an engine state announces, or null when it carries none. */
export function directionOfState(state) {
  if (typeof state !== "string") return null
  const s = state.trim().toUpperCase()
  if (s.startsWith("LONG")) return "up"
  if (s.startsWith("SHORT")) return "down"
  return null
}

/**
 * Derive a higher-timeframe candle series from a base series in OPEN-time
 * convention (time = group start), so closeTime = time + tf seconds holds
 * uniformly for every plane. The backtest's alignment relies on that.
 */
export function aggregateCandlesOpen(base, factor) {
  const out = []
  for (let i = 0; i + factor <= base.length; i += factor) {
    const group = base.slice(i, i + factor)
    let high = -Infinity
    let low = Infinity
    let volume = 0
    for (const c of group) {
      if (Number(c.high) > high) high = Number(c.high)
      if (Number(c.low) < low) low = Number(c.low)
      volume += Number(c.volume ?? 0)
    }
    out.push({
      time: Number(group[0].time),
      open: Number(group[0].open),
      high,
      low,
      close: Number(group[group.length - 1].close),
      volume
    })
  }
  return out
}

/**
 * The closed prefixes the engine may see at decision bar `d` of the entry
 * series: each plane gets every candle whose closeTime <= asOf(d), where
 * asOf(d) = entry[d].time + decisionTf (the entry bar is fully closed).
 * Higher timeframes never contribute an in-progress candle.
 */
export function closedPlanePrefixes({ series, decisionTf, d, entry }) {
  const asOf = Number(entry[d].time) + decisionTf
  const planes = {}
  const sourceByTf = {}
  const staleByTf = {}
  for (const tf of Object.keys(series)) {
    const candles = series[tf]
    if (!Array.isArray(candles) || candles.length === 0) continue
    const closed = []
    for (const c of candles) {
      if (Number(c.time) + Number(tf) <= asOf) closed.push(c)
      else break // ascending series: first unclosed candle ends the run
    }
    planes[tf] = closed
    sourceByTf[tf] = "backtest"
    staleByTf[tf] = false // closed candles only: nothing can repaint
  }
  return { planes, sourceByTf, staleByTf }
}

/**
 * Decision-bar indices for a surface. In-sample covers [minBars,
 * isEnd - 1 - horizon] so an in-sample truth never reads the reserved slice;
 * out-of-sample covers [isEnd, n - 1 - horizon] with truth strictly inside
 * the reserve. Both are capped to maxDecisions by a uniform stride (first and
 * last eligible kept).
 */
export function decisionIndices({ n, minBars, horizon, isEnd, maxDecisions }) {
  const cap = (start, endInclusive) => {
    const all = []
    for (let d = start; d <= endInclusive; d += 1) all.push(d)
    if (all.length <= maxDecisions) return all
    const step = Math.ceil(all.length / maxDecisions)
    const sampled = []
    for (let i = 0; i < all.length; i += step) sampled.push(all[i])
    if (sampled[sampled.length - 1] !== all[all.length - 1]) sampled.push(all[all.length - 1])
    return sampled
  }
  return {
    is: cap(minBars, isEnd - 1 - horizon),
    oos: cap(isEnd, n - 1 - horizon)
  }
}

/**
 * Fire the engine at every index in `indices` (closed prefixes only), then
 * bucket outcomes per state. A "gross" win is a directional move that wins
 * before costs; a "net" win wins after the round-trip cost fraction.
 * Outcomes with no measurable move (|gross| < EPS) are pushes, excluded from
 * both denominators. Pure and deterministic.
 */
export function evaluateSurface({ series, decisionTf, indices, horizon, cost, windowSize, minBars, config = {} }) {
  const entry = series[decisionTf]
  const closes = entry.map((c) => Number(c.close))
  const byState = {}
  const seqByState = {}
  const abstains = {}
  const pushes = []

  for (const d of indices) {
    const { planes, sourceByTf, staleByTf } = closedPlanePrefixes({ series, decisionTf, d, entry })
    const res = converge({ planes, sourceByTf, staleByTf, minBars, ...config })
    const dir = directionOfState(res.state)
    if (!dir) {
      abstains[res.state] = (abstains[res.state] ?? 0) + 1
      byState[res.state] ??= { hits: 0, winsGross: 0, tried: 0 }
      continue
    }
    const gross = (closes[d + horizon] - closes[d]) / closes[d]
    if (Math.abs(gross) < EPS) {
      pushes.push(d)
      continue
    }
    const signed = dir === "up" ? gross : -gross
    const net = signed - cost
    byState[res.state] ??= { hits: 0, winsGross: 0, tried: 0 }
    byState[res.state].tried += 1
    if (net > 0) byState[res.state].hits += 1
    if (signed > 0) byState[res.state].winsGross += 1
    seqByState[res.state] ??= []
    seqByState[res.state].push({ d, win: net > 0 ? 1 : 0 })
  }

  // Moving-window hit-rate trajectory per directional state, sampled to at
  // most 12 points over the state's decided sequence (what the collector UI
  // would plot as the "does this state still pay?" drift curve).
  const window = {}
  for (const state of Object.keys(seqByState)) {
    const seq = seqByState[state]
    const W = Math.min(windowSize, seq.length)
    const samples = []
    const out = []
    for (let i = W - 1; i < seq.length; i += 1) {
      let wins = 0
      for (let j = i - W + 1; j <= i; j += 1) wins += seq[j].win
      out.push({ at: seq[i].d, hitRate: wins / W, n: W })
    }
    const stride = Math.max(1, Math.ceil((out.length - 1) / 11))
    for (let i = 0; i < out.length; i += stride) samples.push(out[i])
    if (out.length > 0 && samples[samples.length - 1] !== out[out.length - 1]) samples.push(out[out.length - 1])
    window[state] = samples
  }

  let tried = 0
  let hits = 0
  let winsGross = 0
  for (const state of Object.keys(byState)) {
    if (byState[state].tried > 0) {
      const s = byState[state]
      byState[state].hitRateGross = s.winsGross / s.tried
      byState[state].hitRateNet = s.hits / s.tried
      tried += s.tried
      hits += s.hits
      winsGross += s.winsGross
    } else {
      byState[state].hitRateGross = null
      byState[state].hitRateNet = null
    }
  }

  return {
    label: BACKTEST_LABEL,
    decided: tried,
    hitRateGross: tried > 0 ? winsGross / tried : null,
    hitRateNet: tried > 0 ? hits / tried : null,
    pushes: pushes.length,
    abstains,
    byState,
    window
  }
}

/**
 * Full walk-forward surface. Splits the series at the reserve line FIRST,
 * tunes (best net hit-rate among configs with enough trades) on the in-sample
 * slice only, then evaluates the winning config on the untouched out-of-sample
 * slice. Every output node is labeled backtest-only.
 */
export function runTechnicalBacktest({
  series,
  decisionTf,
  horizonBars = 12,
  cost = 0.002,
  reserve = 0.2,
  windowSize = 100,
  maxDecisions = 240,
  minBars = MIN_BARS,
  configs = [{}],
  minTrades = 10
} = {}) {
  const entry = series?.[decisionTf]
  if (!Array.isArray(entry) || entry.length === 0) {
    throw new Error(`technicalBacktest: series must include the decision timeframe (${decisionTf}) with candles`)
  }
  const n = entry.length
  if (n < minBars + horizonBars + 2) {
    throw new Error(`technicalBacktest: series too short (${n} bars) for minBars=${minBars} horizon=${horizonBars}`)
  }
  const isEnd = Math.floor(n * (1 - reserve))
  const { is, oos } = decisionIndices({ n, minBars, horizon: horizonBars, isEnd, maxDecisions })

  const trialSummary = (s) => ({
    decided: s.decided,
    hitRateGross: s.hitRateGross,
    hitRateNet: s.hitRateNet,
    pushes: s.pushes
  })

  const trialSurfaces = configs.map((config) =>
    evaluateSurface({ series, decisionTf, indices: is, horizon: horizonBars, cost, windowSize, minBars, config })
  )
  const trials = trialSurfaces.map((surface, index) => ({
    config: configs[index],
    index,
    label: BACKTEST_LABEL,
    ...trialSummary(surface)
  }))

  const bestTrial = trials
    .filter((t) => t.decided >= minTrades)
    .sort((a, b) => (b.hitRateNet ?? -1) - (a.hitRateNet ?? -1))[0] ?? null

  const best = bestTrial
    ? (() => {
        // Reuse the already-evaluated trial surface for the best config; never
        // re-run the engine on the same indices twice.
        const s = trialSurfaces[bestTrial.index]
        return { config: bestTrial.config, is: { label: BACKTEST_LABEL, ...trialSummary(s), byState: s.byState, window: s.window, abstains: s.abstains } }
      })()
    : null

  const oosReport = best
    ? (() => {
        const s = evaluateSurface({ series, decisionTf, indices: oos, horizon: horizonBars, cost, windowSize, minBars, config: best.config })
        return { label: BACKTEST_LABEL, ...trialSummary(s), byState: s.byState, window: s.window, abstains: s.abstains }
      })()
    : null

  return {
    label: BACKTEST_LABEL,
    disclaimer: DISCLAIMER,
    configsTried: configs.length,
    selectionMetric: "netHitRate (cost-adjusted)",
    minTrades,
    meta: {
      decisionTf,
      horizonBars,
      cost,
      reserve,
      windowSize,
      maxDecisions,
      minBars,
      isEnd,
      budget: n
    },
    indices: { is, oos },
    trials,
    best,
    oos: oosReport
  }
}