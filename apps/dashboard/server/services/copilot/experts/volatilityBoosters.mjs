// WS-7 T11 — expert 5 of 6: VOLATILITY & BOOSTERS. Weight 20% (spec §4.4:686).
//
// §4.4:686 — "Volatility & Boosters | 20% | Booster1 20/50 cross, Booster2 BBW
//             expanding, Booster3 divergence (range-only), Booster4 MTF
//             confluence | +10, +10, +10, +15"
//
// FOUR BOOSTERS, each with exactly the delta the spec names. The band is
// therefore [0, +45] — one-sided, because every booster is an additive
// confirmation and the spec attaches no negative value to any of them. An
// expansion in volatility does not "bearishly boost"; it is absent.
//
// ON "UNICORN". §4.2:547 names this file "4 boosters + unicorn" and §4.4:693
// says "Four boosters + Unicorn hypertrend logic". The spec states NO delta for
// "Unicorn" anywhere, and the §4.4 band tops out at the four boosters' +45. So
// Unicorn is modelled as a NAMED BOOLEAN — a hypertrend confirmation that is
// reported in `legs.unicorn` and surfaces in `activeBoosters` — and NOT as a
// fifth delta. Inventing a fifth value would widen a band the spec closed, and
// would let this expert exceed the 100-point score ceiling on its own. T12 owns
// the hypertrend conflict resolution (C3) and is the right place for any
// Unicorn scoring question to be settled.
//
// Booster3 is "range-only" per §4.4:686, so it requires price to be inside its
// Bollinger envelope — a divergence in a trending market is a different signal
// and this expert does not claim it.

import { bandToScore } from "../confluence.mjs"
import { lastValue, valueAt } from "../marketState.mjs"

export const EXPERT_ID = "volatilityBoosters"
export const WEIGHT_PCT = 20

/** Sum of §4.4:686's four booster deltas. One-sided by construction. */
export const BAND = Object.freeze({ min: 0, max: 45 })

export const BOOSTER_DELTAS = Object.freeze({
  booster1EmaCross: 10,
  booster2BbwExpanding: 10,
  booster3DivergenceRangeOnly: 10,
  booster4MtfConfluence: 15
})

/** The four booster ids, in §4.4:686's order. AC-021 forbids an unordered view. */
export const BOOSTER_IDS = Object.freeze([
  "booster1EmaCross",
  "booster2BbwExpanding",
  "booster3DivergenceRangeOnly",
  "booster4MtfConfluence"
])

/**
 * PUBLIC ID -> LEG KEY. The two vocabularies differ, and the difference was a
 * live defect.
 *
 * `BOOSTER_IDS` and `BOOSTER_DELTAS` are keyed by the spec's descriptive names
 * (`booster1EmaCross`); the `legs` object this module returns is keyed by short
 * ordinal names (`booster1`). `activeBoostersOf` used to index `legs` with
 * `BOOSTER_IDS`, so `result.legs["booster1EmaCross"]` was always `undefined`,
 * every `?.fired === true` was false, and **`activeBoosters` was always
 * `[]`** — `ConfluenceScore.activeBoosters` (spec §4.3:618) could never name a
 * booster, and the only entry it could ever emit was `unicorn`.
 *
 * T12's C1 is specified in terms of "Booster1 AND Booster2 both fire"
 * (§4.4:699) and reads `activeBoosters`, so AC-027 was unimplementable until
 * this was fixed. Found while building C1; see the T12 changelog entry.
 *
 * Declared as DATA, and pinned by a test in both directions, so a future rename
 * on either side fails a test rather than silently emptying the array again.
 */
export const BOOSTER_LEG_KEYS = Object.freeze({
  booster1EmaCross: "booster1",
  booster2BbwExpanding: "booster2",
  booster3DivergenceRangeOnly: "booster3",
  booster4MtfConfluence: "booster4"
})

export function evaluate(state, { regime = null } = {}) {
  const ema20 = lastValue(state.series.ema20)
  const ema50 = lastValue(state.series.ema50)
  const ema20Prev = valueAt(state.series.ema20, 1)
  const ema50Prev = valueAt(state.series.ema50, 1)
  const bbwNow = lastValue(state.series.bbw)
  const bbwPrev = valueAt(state.series.bbw, 1)
  const price = state.last?.close ?? null
  const upper = lastValue(state.series.bbUpper)
  const lower = lastValue(state.series.bbLower)

  if (ema20 === null || ema50 === null || ema20Prev === null || ema50Prev === null) {
    return unavailable(
      `the 20 and 50 EMAs have not both warmed up on the working timeframe: have ${state.candles.length} candles`
    )
  }
  if (bbwNow === null || bbwPrev === null) {
    return unavailable(`Bollinger bandwidth has not warmed up: have ${state.candles.length} candles`)
  }

  // --- Booster 1: the 20/50 EMA cross -----------------------------------------
  const spreadNow = ema20 - ema50
  const spreadPrev = ema20Prev - ema50Prev
  const crossedUp = spreadPrev <= 0 && spreadNow > 0
  const crossedDown = spreadPrev >= 0 && spreadNow < 0
  const booster1 = crossedUp

  // --- Booster 2: BBW expanding ------------------------------------------------
  // Strictly greater, not `>=`: a flat bandwidth is not an expansion, and
  // scoring it would make a dead market look like a waking one.
  const booster2 = bbwNow > bbwPrev

  // --- Booster 3: divergence, range-only --------------------------------------
  const latest = state.divergences[0] ?? null
  const inRange = price !== null && upper !== null && lower !== null && price <= upper && price >= lower
  const booster3 = latest !== null && latest.kind === "bullish" && inRange

  // --- Booster 4: multi-timeframe confluence ----------------------------------
  // The daily close and the working close agreeing about which side of their
  // own trend they are. This is the only leg that reads a higher timeframe,
  // and it is why the state carries `dailyCloses` at all.
  const dailyClose = state.series.dailyClose ? lastValue(state.series.dailyClose) : null
  const dailyEma200 = state.series.dailyEma200 ? lastValue(state.series.dailyEma200) : null
  const dailyAligned =
    dailyClose !== null && dailyEma200 !== null ? (dailyClose >= dailyEma200) === (price >= ema20) : false
  const booster4 = dailyAligned && spreadNow > 0

  const deltas = {
    booster1EmaCross: booster1 ? BOOSTER_DELTAS.booster1EmaCross : 0,
    booster2BbwExpanding: booster2 ? BOOSTER_DELTAS.booster2BbwExpanding : 0,
    booster3DivergenceRangeOnly: booster3 ? BOOSTER_DELTAS.booster3DivergenceRangeOnly : 0,
    booster4MtfConfluence: booster4 ? BOOSTER_DELTAS.booster4MtfConfluence : 0
  }
  const rawDelta = BOOSTER_IDS.reduce((total, id) => total + deltas[id], 0)

  // Unicorn: the named hypertrend confirmation. A BOOLEAN, deliberately.
  // See the header for why it carries no delta.
  const unicorn = regime === "hypertrend"

  return {
    rawDelta,
    available: true,
    unavailableReason: null,
    subScore: bandToScore(rawDelta, BAND),
    legs: {
      booster1: { delta: deltas.booster1EmaCross, fired: booster1, crossedUp, crossedDown, spread: spreadNow },
      booster2: { delta: deltas.booster2BbwExpanding, fired: booster2, bbw: bbwNow, bbwPrev },
      booster3: {
        delta: deltas.booster3DivergenceRangeOnly,
        fired: booster3,
        inRange,
        kind: latest?.kind ?? null
      },
      booster4: {
        delta: deltas.booster4MtfConfluence,
        fired: booster4,
        dailyAligned,
        dailyEma200Available: dailyAligned
      },
      unicorn: { fired: unicorn, delta: 0, note: "named boolean; spec §4.4:686 states no delta for Unicorn" }
    }
  }
}

/** Which boosters fired, in §4.4:686's order — the `activeBoosters` array. */
export function activeBoostersOf(result) {
  if (result === null || result.available !== true || result.legs === null) return []
  const fired = BOOSTER_IDS.filter((id) => result.legs[BOOSTER_LEG_KEYS[id]]?.fired === true)
  if (result.legs.unicorn?.fired === true) fired.push("unicorn")
  return fired
}

function unavailable(reason) {
  return { rawDelta: null, available: false, unavailableReason: reason, subScore: null, legs: null }
}
