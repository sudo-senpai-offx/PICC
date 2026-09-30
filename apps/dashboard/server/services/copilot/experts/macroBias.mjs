// WS-7 T11 — expert 1 of 6: MACRO BIAS. Weight 20% (spec §4.4:682).
//
// §4.4:682 — "Macro Bias | 20% | Daily 400 EMA, Daily 200 EMA | +10 / −10 each"
//
// TWO LEGS, each worth ±10, so the declared band is [−20, +20]. "each" is
// load-bearing: it means the two EMAs score independently and a daily close
// above both is +20, not +10. The band is the whole delta space of this expert
// and `confluence.bandToScore` maps it onto 0-100.
//
// UNCOMPUTABLE IS NOT NEUTRAL. §4.1:533 requires that an absent expert report
// unavailable with a reason and never default to neutral. This expert returns
// `available: false` with the reason naming how much daily history it needed and
// how much it got. It does not return `rawDelta: 0`, because 0 on a band of
// [−20, +20] maps to a sub-score of 50 — a mid-range neutral that would be a
// fabricated opinion dressed as a measurement.

import { bandToScore } from "../confluence.mjs"
import { lastValue, valueAt } from "../marketState.mjs"

export const EXPERT_ID = "macroBias"
export const WEIGHT_PCT = 20

/** §4.4:682, "+10 / −10 each" — two legs at ±10, so ±20 overall. */
export const BAND = Object.freeze({ min: -20, max: 20 })

const PER_LEG = 10

/**
 * Score the daily close against the 400 and 200 daily EMAs.
 *
 * @param {object} state A frozen state from `deriveMarketState`.
 * @returns {{rawDelta: number|null, available: boolean, unavailableReason: string|null,
 *            subScore: number|null, legs: object}}
 */
export function evaluate(state, _context = {}) {
  const dailyClose = state.series.dailyClose ? lastValue(state.series.dailyClose) : null
  const ema400 = state.series.dailyEma400 ? lastValue(state.series.dailyEma400) : null
  const ema200 = state.series.dailyEma200 ? lastValue(state.series.dailyEma200) : null

  if (dailyClose === null) {
    return unavailable("no daily closes were supplied, so neither the 400 nor the 200 daily EMA can be evaluated")
  }
  if (ema400 === null || ema200 === null) {
    const have = state.dailyCloses ? state.dailyCloses.length : 0
    return unavailable(
      `daily EMAs have not warmed up: need 400 daily closes for the 400 EMA (and 200 for the 200 EMA), have ${have}`
    )
  }

  // `>=` vs `>` on an exact tie: a close exactly on an EMA is neither above nor
  // below it, and scoring a tie as a bullish leg would invent an edge that the
  // market did not express. So a tie is 0 for that leg.
  const leg400 = dailyClose > ema400 ? PER_LEG : dailyClose < ema400 ? -PER_LEG : 0
  const leg200 = dailyClose > ema200 ? PER_LEG : dailyClose < ema200 ? -PER_LEG : 0
  const rawDelta = leg400 + leg200

  return {
    rawDelta,
    available: true,
    unavailableReason: null,
    subScore: bandToScore(rawDelta, BAND),
    legs: {
      dailyClose,
      ema400,
      ema200,
      leg400,
      leg200,
      /** Which way each leg read, so a room can say WHY the expert scored. */
      bias400: leg400 > 0 ? "above" : leg400 < 0 ? "below" : "at",
      bias200: leg200 > 0 ? "above" : leg200 < 0 ? "below" : "at"
    }
  }
}

/**
 * Previous bar's daily close, for a caller that wants the slope of the bias.
 * Exported for the cross-expert checks; not used in this expert's own delta.
 */
export function previousDailyClose(state) {
  return state.series.dailyClose ? valueAt(state.series.dailyClose, 1) : null
}

function unavailable(reason) {
  return { rawDelta: null, available: false, unavailableReason: reason, subScore: null, legs: null }
}
