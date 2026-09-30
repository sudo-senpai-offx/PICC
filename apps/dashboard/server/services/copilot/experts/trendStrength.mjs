// WS-7 T11 — expert 3 of 6: TREND & STRENGTH. Weight 20% (spec §4.4:684).
//
// §4.4:684 — "Trend & Strength | 20% | 50 EMA slope, ADX > 25 rising/falling
//             | +10/+5/0, +10 / −10"
//
// TWO LEGS:
//
//   50 EMA slope   +10 / +5 / 0   — three states, and the third is ZERO, not
//                                   a negative. Read literally from the spec:
//                                   a rising slope is the strong case (+10), a
//                                   flat slope the middling case (+5), and a
//                                   FALLING slope scores 0 from this leg. The
//                                   bearish reading of a falling EMA arrives
//                                   from the ADX leg instead. Stating that here
//                                   is deliberate: it is the one place in this
//                                   expert where the alternative reading — a
//                                   falling slope at −10 — would be an
//                                   invented value the band does not contain.
//
//   ADX > 25       +10 / −10      — above 25 and RISING is +10; above 25 and
//                                   FALLING is −10; at or below 25 is 0,
//                                   because the spec's own gate is "ADX > 25".
//                                   The threshold is `ADX_TREND_THRESHOLD`
//                                   below, named rather than inlined.
//
// Band: min = 0 + (−10) = −10, max = +10 + +10 = +20.

import { bandToScore } from "../confluence.mjs"
import { lastValue, valueAt } from "../marketState.mjs"

export const EXPERT_ID = "trendStrength"
export const WEIGHT_PCT = 20

export const BAND = Object.freeze({ min: -10, max: 20 })

/** §4.4:684's literal gate: "ADX > 25 rising/falling". */
export const ADX_TREND_THRESHOLD = 25

/**
 * The slope leg's three states, in §4.4:684's order. `flat` is bounded by a
 * relative threshold because "flat" is a comparison between two numbers and
 * needs a tolerance to mean anything.
 */
export const SLOPE_FLAT_BAND_PCT = 0.05

export function evaluate(state, _context = {}) {
  const ema50 = state.series.ema50
  const ema50Now = lastValue(ema50)
  const ema50Prev = valueAt(ema50, 1)
  const price = state.last?.close ?? null

  if (ema50Now === null || ema50Prev === null) {
    return unavailable(
      `the 50 EMA has not warmed up: need at least ${PERIODS_FOR_SLOPE} working candles with closes, have ${state.candles.length}`
    )
  }
  if (price === null) {
    return unavailable("no working-timeframe last close is available to measure the EMA slope against")
  }

  const adxNow = lastValue(state.series.adx)
  const adxPrev = valueAt(state.series.adx, 1)
  if (adxNow === null || adxPrev === null) {
    return unavailable(
      `ADX(14) has not warmed up: need ${ADX_TREND_THRESHOLD}-trendable history plus one prior bar, have ${state.candles.length} candles`
    )
  }

  // --- Leg 1: 50 EMA slope, three states --------------------------------------
  const slopePct = ((ema50Now - ema50Prev) / ema50Prev) * 100
  const slopeDelta = slopePct > SLOPE_FLAT_BAND_PCT ? 10 : slopePct < -SLOPE_FLAT_BAND_PCT ? 0 : 5
  const slopeState = slopeDelta === 10 ? "rising" : slopeDelta === 5 ? "flat" : "falling"

  // --- Leg 2: ADX above 25, rising or falling ---------------------------------
  const aboveThreshold = adxNow > ADX_TREND_THRESHOLD
  const adxRising = adxNow > adxPrev
  const adxDelta = !aboveThreshold ? 0 : adxRising ? 10 : -10
  const adxState = !aboveThreshold ? "below-threshold" : adxRising ? "above-25-rising" : "above-25-falling"

  const rawDelta = slopeDelta + adxDelta

  return {
    rawDelta,
    available: true,
    unavailableReason: null,
    subScore: bandToScore(rawDelta, BAND),
    legs: {
      slope: { delta: slopeDelta, state: slopeState, slopePct, ema50: ema50Now, ema50Prev },
      adx: { delta: adxDelta, state: adxState, adx: adxNow, adxPrev, threshold: ADX_TREND_THRESHOLD }
    }
  }
}

const PERIODS_FOR_SLOPE = 51

function unavailable(reason) {
  return { rawDelta: null, available: false, unavailableReason: reason, subScore: null, legs: null }
}
