// WS-7 T11 — expert 2 of 6: STRUCTURAL. Weight 20% (spec §4.4:683).
//
// §4.4:683 — "Structural | 20% | 4H S/R, VWAP, Fibonacci | +10 / −10, +5 / −5, +5"
//
// THREE LEGS, and the band's two sides are NOT symmetric:
//
//   S/R proximity  ±10   — support beneath is bullish, resistance overhead bearish
//   VWAP           ±5    — above the session VWAP is bullish, below bearish
//   Fibonacci      +5    — ONE-SIDED. The spec gives this leg a positive value
//                          and no negative one, so it is a bonus for holding
//                          above the 0.618 retracement and nothing at all
//                          otherwise. It is NOT ±5 and inventing a bearish side
//                          would widen the band the spec declared.
//
// Band: min = −10 + −5 = −15, max = +10 + +5 + +5 = +20.
//
// The asymmetry is intentional and it matters downstream: because the band's
// midpoint is not 0, a structural reading of exactly 0 maps to a sub-score
// below 50. That is honest — "no structural edge" is genuinely weaker than
// "structural support underneath".

import { bandToScore } from "../confluence.mjs"
import { lastValue } from "../marketState.mjs"

export const EXPERT_ID = "structural"
export const WEIGHT_PCT = 20

/** Derived from §4.4:683's three legs. See the header for why min ≠ −max. */
export const BAND = Object.freeze({ min: -15, max: 20 })

const SR_DELTA = 10
const VWAP_DELTA = 5
const FIB_DELTA = 5

/** The retracement level the Fibonacci leg measures against (§4.4:683). */
export const FIB_TRIGGER_RATIO = 0.618

export function evaluate(state, _context = {}) {
  if (!state.h4Candles || state.h4Candles.length === 0) {
    return unavailable("no 4H candles were supplied, so 4H support/resistance cannot be evaluated")
  }
  const price = state.last?.close ?? null
  if (price === null) {
    return unavailable("no working-timeframe last close is available to locate against 4H structure")
  }

  const sr = state.series.h4Sr
  const h4Vwap = lastValue(state.series.h4Vwap)
  const fib = state.series.h4Fib

  if (!Array.isArray(sr) || sr.length === 0) {
    return unavailable("4H swing points have not confirmed yet, so no support/resistance level exists")
  }
  if (h4Vwap === null) {
    return unavailable("the 4H VWAP cannot be observed from the supplied 4H candles")
  }

  // --- Leg 1: 4H S/R proximity -------------------------------------------------
  // The nearest confirmed level decides. A level exactly at the price is 0:
  // price resting on a level is not evidence of a direction.
  let nearest = null
  for (const level of sr) {
    const d = Math.abs(level.level - price)
    if (nearest === null || d < nearest.distance) {
      nearest = { distance: d, level: level.level, kind: level.kind }
    }
  }
  const srDelta = nearest.distance === 0 ? 0 : price > nearest.level ? SR_DELTA : -SR_DELTA

  // --- Leg 2: 4H VWAP ---------------------------------------------------------
  const vwapDelta = price === h4Vwap ? 0 : price > h4Vwap ? VWAP_DELTA : -VWAP_DELTA

  // --- Leg 3: Fibonacci, +5 only ----------------------------------------------
  let fibDelta = 0
  let fibTrigger = null
  if (fib && fib.trend === "uptrend" && Number.isFinite(fib.swingLow) && Number.isFinite(fib.swingHigh)) {
    // Retracement measured off the swing: below `swingLow` is a 100%
    // retracement, `swingHigh` is 0%. Price holding above 61.8% of the way
    // back up is the bullish case the +5 leg is for.
    const range = fib.swingHigh - fib.swingLow
    if (range > 0) {
      fibTrigger = fib.swingLow + range * FIB_TRIGGER_RATIO
      fibDelta = price >= fibTrigger ? FIB_DELTA : 0
    }
  }

  const rawDelta = srDelta + vwapDelta + fibDelta

  return {
    rawDelta,
    available: true,
    unavailableReason: null,
    subScore: bandToScore(rawDelta, BAND),
    legs: {
      sr: { delta: srDelta, level: nearest.level, kind: nearest.kind, distance: nearest.distance },
      vwap: { delta: vwapDelta, level: h4Vwap },
      fib: { delta: fibDelta, trigger: fibTrigger, trend: fib?.trend ?? null }
    }
  }
}

function unavailable(reason) {
  return { rawDelta: null, available: false, unavailableReason: reason, subScore: null, legs: null }
}
