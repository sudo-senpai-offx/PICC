// WS-7 T11 — the deterministic market-state normaliser.
//
// Every expert needs overlapping indicator series over the same candles. If
// each expert recomputed them, the engine would do the same work six times and
// the B5 budget (spec :726, confluence ≤ 100 ms p95) would be spent on
// redundancy. So the series are derived ONCE, here, by a pure function, and
// the six experts read them.
//
// This module is the boundary between "candles someone fetched" and "state the
// engine reasons over". It is where the honesty contract is enforced at the
// edge:
//
//   MALFORMED input throws. A candle with a non-finite close is a caller bug,
//   and it must be loud. Silently coercing it to 0 would put a fabricated
//   price into a support/resistance calculation, which is precisely the class
//   of defect this repository treats as a P1.
//
//   INSUFFICIENT history yields null, not zero. A 400 EMA over 60 daily closes
//   is `null` — an absence the expert reports as unavailable with a reason —
//   and never `0`. `indicators.mjs`'s `ema()` already fills its warm-up with
//   nulls (`indicators.mjs:56-58`), and this module passes that through
//   untouched rather than back-filling.
//
// PURE. No clock, no randomness, no network, no model, no filesystem. The only
// time input is `computedAt`, supplied by the caller (AC-021:937).

import {
  adx,
  atr,
  bollinger,
  candleArrays,
  ema,
  fibonacciLevels,
  findDivergences,
  stochRSI,
  supportResistance,
  vwap
} from "../indicators.mjs"

/** Series periods, as declared constants so a test can pin them. */
export const PERIODS = Object.freeze({
  emaFast: 20,
  emaMid: 50,
  emaDaily200: 200,
  emaDaily400: 400,
  adx: 14,
  atr: 14,
  bollinger: 20,
  bollingerMult: 2,
  stochRsi: 14,
  stochRsiSmoothK: 3,
  stochRsiSmoothD: 3
})

/** How many bars of working-timeframe history the derived state insists on. */
export const MIN_WORKING_CANDLES = 60

/** How many DAILY closes the 200/400 EMA legs insist on (the 400 governs). */
export const MIN_DAILY_CLOSES = 400

/**
 * Validate and normalise a candle array.
 *
 * @throws {TypeError} on a non-array, a non-object candle, or a non-finite
 *   OHLC value. Loud on purpose — see the header.
 */
function requireCandles(candles, label) {
  if (!Array.isArray(candles)) {
    throw new TypeError(`copilot: ${label} must be an array of candles; received ${typeof candles}`)
  }
  for (const [i, c] of candles.entries()) {
    if (c === null || typeof c !== "object") {
      throw new TypeError(`copilot: ${label}[${i}] must be an object; received ${String(c)}`)
    }
    for (const field of ["open", "high", "low", "close"]) {
      const v = Number(c[field])
      if (!Number.isFinite(v)) {
        throw new TypeError(
          `copilot: ${label}[${i}].${field} must be a finite number; received ${String(c[field])}`
        )
      }
    }
  }
  return candles
}

function requireFiniteSeries(values, label) {
  if (!Array.isArray(values)) {
    throw new TypeError(`copilot: ${label} must be an array of numbers; received ${typeof values}`)
  }
  for (const [i, v] of values.entries()) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new TypeError(`copilot: ${label}[${i}] must be a finite number; received ${String(v)}`)
    }
  }
  return values
}

/** The last non-null entry of a series, or null when the series never warmed up. */
export function lastValue(series) {
  if (!Array.isArray(series)) return null
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i]
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return null
}

/** The entry `back` bars before the end, or null when it is not available. */
export function valueAt(series, back = 0) {
  if (!Array.isArray(series)) return null
  const idx = series.length - 1 - back
  if (idx < 0) return null
  const v = series[idx]
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/**
 * Derive the frozen market state the engine reasons over.
 *
 * @param {object} raw
 * @param {Array} raw.candles Working-timeframe OHLC candles, oldest first.
 * @param {Array} [raw.dailyCloses] Daily closes, oldest first. Drives Macro Bias.
 * @param {Array} [raw.h4Candles] 4H OHLC candles. Drives Structural.
 * @param {number} raw.computedAt The ONLY time input on the decision path.
 * @param {object} [raw.sentimentInput] The 5% Sentiment expert's input. T13
 *   supplies this; T11 never produces it. Absent ⇒ the expert is unavailable.
 * @returns {object} A frozen, fully-derived state.
 */
export function deriveMarketState(raw) {
  if (raw === null || typeof raw !== "object") {
    throw new TypeError(`copilot: deriveMarketState requires a state object; received ${String(raw)}`)
  }
  const { computedAt } = raw
  if (typeof computedAt !== "number" || !Number.isFinite(computedAt)) {
    throw new TypeError(
      `copilot: computedAt must be a supplied finite epoch-ms number — the engine reads no clock of its own (AC-021); received ${String(computedAt)}`
    )
  }

  const candles = requireCandles(raw.candles, "candles")
  const dailyCloses = raw.dailyCloses ? requireFiniteSeries(raw.dailyCloses, "dailyCloses") : null
  const h4Candles = raw.h4Candles ? requireCandles(raw.h4Candles, "h4Candles") : null

  const working = candleArrays(candles)
  const daily = dailyCloses ? candleArrays(dailyCloses.map((c) => ({ open: c, high: c, low: c, close: c }))) : null
  const h4 = h4Candles ? candleArrays(h4Candles) : null

  // Working-timeframe series.
  const ema20 = ema(working.closes, PERIODS.emaFast)
  const ema50 = ema(working.closes, PERIODS.emaMid)
  const adxSeries = adx(working.highs, working.lows, working.closes, PERIODS.adx)
  const atrSeries = atr(working.highs, working.lows, working.closes, PERIODS.atr)
  const bb = bollinger(working.closes, { period: PERIODS.bollinger, mult: PERIODS.bollingerMult })
  const stoch = stochRSI(working.closes, {
    period: PERIODS.stochRsi,
    smoothK: PERIODS.stochRsiSmoothK,
    smoothD: PERIODS.stochRsiSmoothD
  })
  const vwapSeries = vwap(working.highs, working.lows, working.closes, working.volumes)

  // Daily series for Macro Bias (spec §4.4:682 — "Daily 400 EMA, Daily 200 EMA").
  const dailyEma200 = daily ? ema(daily.closes, PERIODS.emaDaily200) : null
  const dailyEma400 = daily ? ema(daily.closes, PERIODS.emaDaily400) : null

  // 4H series for Structural (spec §4.4:683 — "4H S/R, VWAP, Fibonacci").
  const h4Sr = h4 ? supportResistance(h4Candles) : null
  const h4Fib = h4 ? fibonacciLevels(h4.highs, h4.lows, h4.closes) : null
  const h4Vwap = h4 ? vwap(h4.highs, h4.lows, h4.closes, h4.volumes) : null

  // Divergences are needed by Momentum (spec §4.4:685) and by Booster3
  // (spec §4.4:686, "range-only"). StochRSI %K is the oscillator for both.
  const divergences = findDivergences(working.closes, stoch.k)

  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null

  return Object.freeze({
    computedAt,
    candles,
    h4Candles,
    dailyCloses,
    working,
    last: lastCandle
      ? Object.freeze({
          open: Number(lastCandle.open),
          high: Number(lastCandle.high),
          low: Number(lastCandle.low),
          close: Number(lastCandle.close),
          volume: Number.isFinite(Number(lastCandle.volume)) ? Number(lastCandle.volume) : 0,
          time: Number.isFinite(Number(lastCandle.time)) ? Number(lastCandle.time) : null
        })
      : null,
    series: Object.freeze({
      ema20,
      ema50,
      adx: adxSeries.adx,
      plusDI: adxSeries.plusDI,
      minusDI: adxSeries.minusDI,
      atr14: atrSeries,
      bbw: bb.bandwidth,
      bbUpper: bb.upper,
      bbLower: bb.lower,
      stochK: stoch.k,
      stochD: stoch.d,
      vwap: vwapSeries,
      dailyEma200,
      dailyEma400,
      dailyClose: daily ? daily.closes : null,
      h4Vwap,
      h4Sr,
      h4Fib
    }),
    divergences: Object.freeze(divergences.map((d) => Object.freeze({ ...d }))),
    sentimentInput: raw.sentimentInput ?? null,
    // `null` MEANS "the caller supplied none", and `[]` MEANS "the caller
    // supplied none and the source is live and found none". Those are opposite
    // facts and collapsing them is a fabrication: a news veto fed `[]` for a
    // caller that never asked for news would report "no Red Folder events in
    // the window", which is a claim about a source nobody supplied. Both vetoes
    // depend on this distinction (see vetoes/newsLockout.mjs and
    // vetoes/correlationTrap.mjs).
    newsEvents: optionalArray(raw.newsEvents, "newsEvents"),
    proposals: optionalArray(raw.proposals, "proposals"),
    facts: Object.freeze({ ...(raw.facts ?? {}) })
  })
}

/**
 * `undefined` → `null` (never supplied). An array → a frozen copy. Anything
 * else is a caller bug and throws, per the header's malformed-input rule.
 */
function optionalArray(value, label) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) {
    throw new TypeError(`copilot: ${label} must be an array when supplied; received ${typeof value}`)
  }
  return Object.freeze([...value])
}
