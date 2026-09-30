// WS-7 T11 — the frozen market-state fixtures every engine test reads.
//
// A fixture, not a stub: the values are deterministic functions of nothing, so
// two runs produce the same candles and the determinism test is testing the
// ENGINE rather than its inputs. `sentimentInput` is deliberately absent on the
// default fixture — T11 ships the sentiment seam without a model (spec §4.1:533)
// — so the default path IS the honest-degradation path AC-030 describes.

import { SESSIONS } from "../../../tradingSessions.mjs"

/** UTC epoch ms for a fixed instant, so nothing in a test reads a clock. */
export function atUtc(year, month, day, hour = 0, minute = 0) {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0)
}

/**
 * A deterministic pseudo-random walk. Seeded by an LCG so the series is
 * byte-identical on every machine and every run — `Math.random()` would make
 * the determinism test unable to distinguish a stable engine from a lucky one.
 */
function seededSeries(seed, count, start, step, drift = 0) {
  let x = seed >>> 0
  const out = []
  let price = start
  for (let i = 0; i < count; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    const unit = x / 0x100000000 // [0, 1)
    price = price + step * (unit - 0.5) * 2 + drift
    out.push(price)
  }
  return out
}

function toCandles(closes, { volume = 1000, startTime = 0, stepMs = 60_000 } = {}) {
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1]
    return {
      open: prev,
      high: Math.max(prev, close) * 1.001,
      low: Math.min(prev, close) * 0.999,
      close,
      volume,
      time: startTime + i * stepMs
    }
  })
}

/** 12:00 UTC on a fixed date — inside the London-NY overlap, never the dead zone. */
export const COMPUTED_AT = atUtc(2026, 3, 10, 12, 0)

/** 21:00 UTC — inside the frozen dead zone (20:00–00:00). */
export const DEAD_ZONE_AT = atUtc(2026, 3, 10, 21, 0)

/**
 * The default working-timeframe fixture: 600 candles of a gently rising walk.
 * Long enough for the 50 EMA (needs 51) and for ADX(14).
 */
export function workingCandles() {
  return toCandles(seededSeries(20260310, 600, 100, 0.35, 0.05))
}

/** 500 daily closes — enough for the 400 EMA to warm up. */
export function dailyCloses() {
  return seededSeries(400200, 500, 100, 0.6, 0.08)
}

/**
 * A RANGING working-timeframe fixture: no drift, tiny steps.
 *
 * The default fixture trends hard enough that ADX clears the hypertrend overlay
 * (`regime.mjs` HYPERTREND_THRESHOLDS.adxAtOrAbove = 30), so on a trending
 * market the session regime is legitimately overridden. To assert the session
 * mapping itself, the series must not be a hypertrend — hence this one.
 */
export function rangingCandles() {
  return toCandles(seededSeries(777, 600, 100, 0.02, 0))
}

/**
 * 300 4H candles carrying a genuine OSCILLATION, with real pivots.
 *
 * Two fixture bugs had to be fixed to make this expert reachable at all, and
 * both are recorded here because the second one is silent:
 *
 *   1. A monotonically rising series produces NO swing points. `swingPoints`
 *      (`indicators.mjs:698-717`) needs a bar strictly higher than BOTH
 *      neighbours. A series that only climbs has none, which left the Structural
 *      expert permanently unavailable — honest, but untestable.
 *   2. Deriving `high` as `max(prevClose, close) * k` TIES at every turning
 *      point: at a local close-maximum, bar i and bar i+1 both take
 *      `close[i] * k`. The strict `>` pivot test then fails on a tie. The wick
 *      therefore runs on a FASTER oscillation than the close, so the highs peak
 *      independently of the closes and the inequality is strict.
 *
 * Deterministic: `Math.sin`/`Math.cos` of an integer index. No clock, no
 * `Math.random` — the determinism test depends on these being reproducible.
 */
export function h4Candles() {
  const n = 300
  const centre = (i) => 100 + 6 * Math.sin(i / 7) + 0.02 * i
  const candles = []
  for (let i = 0; i < n; i++) {
    candles.push({
      open: centre(i - 1),
      high: centre(i) + 0.35 * (1 + Math.cos(i / 2.5)),
      low: centre(i) - 0.35 * (1 + Math.cos(i / 2.3)),
      close: centre(i),
      volume: 1000,
      time: i * 14_400_000
    })
  }
  return candles
}

/**
 * A ranging market state: enough history for every indicator to warm up, and no
 * trend strong enough to trip the hypertrend overlay. This is the fixture the
 * session→regime mapping is asserted against.
 */
export function rangingMarketState(overrides = {}) {
  return {
    candles: rangingCandles(),
    dailyCloses: seededSeries(400200, 500, 100, 0.6, 0),
    h4Candles: h4Candles(),
    computedAt: COMPUTED_AT,
    ...overrides
  }
}

/** The canonical full-history state: every deterministic input present. */
export function fullMarketState(overrides = {}) {
  return {
    candles: workingCandles(),
    dailyCloses: dailyCloses(),
    h4Candles: h4Candles(),
    computedAt: COMPUTED_AT,
    ...overrides
  }
}

/**
 * The AC-030 fixture: the Sentiment expert forced unavailable.
 *
 * T11 produces this by DEFAULT, because T11 has no model. This factory makes it
 * explicit so the degradation test reads as a deliberate state rather than an
 * accident, and so a future T13 cannot quietly remove the case.
 */
export function sentimentUnavailableState(overrides = {}) {
  const state = fullMarketState(overrides)
  // Explicitly `null` rather than merely absent, so the intent survives a
  // caller who spreads a default that later grows a value.
  return { ...state, sentimentInput: null }
}

/** The same state WITH a model-shaped sentiment input, for the available path. */
export function sentimentSuppliedState(score, source = "test/stub") {
  return fullMarketState({ sentimentInput: { score, source } })
}

/**
 * A state with insufficient daily history, so Macro Bias is unavailable.
 * 150 daily closes warms the 200 EMA? No — 150 < 200, so BOTH are null and the
 * expert reports unavailable with a reason naming the shortfall.
 */
export function shortDailyHistoryState(overrides = {}) {
  return { ...fullMarketState(), dailyCloses: seededSeries(99, 150, 100, 0.5, 0.02), ...overrides }
}

/** The session window the fixtures land in, asserted so a drift is visible. */
export const FIXTURE_SESSION = Object.freeze({
  id: "london",
  open: SESSIONS.london.open,
  close: SESSIONS.london.close
})
