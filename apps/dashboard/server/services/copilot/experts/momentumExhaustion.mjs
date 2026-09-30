// WS-7 T11 — expert 4 of 6: MOMENTUM & EXHAUSTION. Weight 15% (spec §4.4:685).
//
// §4.4:685 — "Momentum & Exhaustion | 15% | StochRSI cross, divergence
//             | +10, +5 / −10"
//
// TWO LEGS:
//
//   StochRSI cross  +10       — a bullish cross, and only from oversold. The
//                                "from oversold" half is what makes this an
//                                EXHAUSTION expert rather than a momentum one:
//                                a cross in the middle of the range is not an
//                                exhaustion signal, and scoring it +10 would
//                                read a continuation as a reversal.
//   divergence      +5 / −10  — bullish divergence +5, bearish −10.
//
// Band: min = 0 + (−10) = −10, max = +10 + +5 = +15.

import { bandToScore } from "../confluence.mjs"
import { lastValue, valueAt } from "../marketState.mjs"

export const EXPERT_ID = "momentumExhaustion"
export const WEIGHT_PCT = 15

export const BAND = Object.freeze({ min: -10, max: 15 })

const CROSS_DELTA = 10
const BULLISH_DIVERGENCE_DELTA = 5
const BEARISH_DIVERGENCE_DELTA = -10

/**
 * The cross leg's oversold gate. Below 20 the oscillator is at the bottom of
 * its range; a cross from there is the exhaustion the spec's expert name
 * describes.
 */
export const OVERSOLD_THRESHOLD = 20

export function evaluate(state, _context = {}) {
  const kNow = lastValue(state.series.stochK)
  const dNow = lastValue(state.series.stochD)
  const kPrev = valueAt(state.series.stochK, 1)
  const dPrev = valueAt(state.series.stochD, 1)

  if (kNow === null || dNow === null || kPrev === null || dPrev === null) {
    return unavailable(
      `StochRSI(14) has not warmed up on the working timeframe: have ${state.candles.length} candles`
    )
  }

  // --- Leg 1: bullish StochRSI cross from oversold ----------------------------
  const crossedUp = kPrev <= dPrev && kNow > dNow
  const fromOversold = kPrev <= OVERSOLD_THRESHOLD
  const crossDelta = crossedUp && fromOversold ? CROSS_DELTA : 0

  // --- Leg 2: divergence ------------------------------------------------------
  // Only the most recent confirmed divergence counts; a stale one four bars
  // back is not this candle's divergence.
  const latest = state.divergences[0] ?? null
  const divergenceDelta =
    latest === null ? 0 : latest.kind === "bullish" ? BULLISH_DIVERGENCE_DELTA : BEARISH_DIVERGENCE_DELTA

  const rawDelta = crossDelta + divergenceDelta

  return {
    rawDelta,
    available: true,
    unavailableReason: null,
    subScore: bandToScore(rawDelta, BAND),
    legs: {
      cross: {
        delta: crossDelta,
        crossedUp,
        fromOversold,
        k: kNow,
        d: dNow,
        kPrev,
        dPrev,
        threshold: OVERSOLD_THRESHOLD
      },
      divergence: { delta: divergenceDelta, kind: latest?.kind ?? null, type: latest?.type ?? null }
    }
  }
}

function unavailable(reason) {
  return { rawDelta: null, available: false, unavailableReason: reason, subScore: null, legs: null }
}
