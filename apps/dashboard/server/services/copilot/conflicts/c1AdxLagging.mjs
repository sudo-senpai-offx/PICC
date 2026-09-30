// WS-7 T12 — conflict resolution C1: ADX LAG vs SCORING.
//
// §4.4:699 — "**C1 — ADX lag vs scoring.** When Booster1 **and** Booster2 both
// fire, disable the ADX penalty and set `Trend_Score` to max for the next 5
// candles. Rationale: ADX lags; BBW and the 20/50 cross lead."
//
// AC-027 (:981-987) is the binding acceptance criterion; R9.1 (:430) is the
// requirement — "C1 … is implemented as a specified, testable rule with an
// expiry".
//
// ---------------------------------------------------------------------------
// WHAT "MAX" AND "5 CANDLES" ARE READ AS, AND WHY
// ---------------------------------------------------------------------------
//
// **max** is the Trend & Strength expert's OWN band maximum, read from
// `experts/trendStrength.mjs` `BAND.max` (= +20, §4.4:684's "+10/+5/0, +10/−10"
// summed). A literal 20 here would be a second copy of T11's band, and Risk 6 of
// plan v1 §2 is precisely "a tier boundary, veto, or expert weight that T11
// already defines". If the band moves, C1 follows it.
//
// **5 candles** is a five-candle window anchored ON the trigger candle
// (`WINDOW_ANCHOR = "triggerCandleInclusive"`). AC-027's verification is "a
// 7-candle fixture asserting override on candles 1–5 and expiry on 6" and its
// scenario is "Booster1 and Booster2 both fire on a candle" — so for candles
// 1–5 to be inside the window, the trigger must be candle 1 of the fixture.
// The alternative reading (trigger on a candle *before* the fixture) makes the
// same seven numbers true while leaving the trigger bar itself unmaxed, which
// is the bar on which the two leading indicators have just fired. The inclusive
// anchor is the conservative one and is named rather than assumed.
//
// ---------------------------------------------------------------------------
// THE EXPIRY IS DERIVED, NEVER STORED
// ---------------------------------------------------------------------------
//
// The anti-goal this module is built against is "an expiry that is documented
// but never enforced, or that defaults to active when expired". `c1WindowAt`
// therefore holds NO `active` field: it computes `active` from the two indices
// and `windowCandles` on every call. There is no flag that can be left set, no
// timer that can fail to fire, and no state in which a stale window reads as
// open. `createC1WindowTracker` records *when* a trigger happened and then
// delegates to the same pure function — the tracker owns bookkeeping, the
// decision owns arithmetic.
//
// PURE. No clock, no randomness, no network, no filesystem, no model. The only
// time input anywhere on this path is `state.computedAt`, supplied by the
// caller (AC-021:937).

import { BAND as TREND_BAND, evaluate as evaluateTrendStrength } from "../experts/trendStrength.mjs"
import { activeBoostersOf, evaluate as evaluateVolatilityBoosters } from "../experts/volatilityBoosters.mjs"

/**
 * C1 as a named, versioned rule. Frozen, so no caller can widen its own window
 * or rename its target expert at runtime.
 */
export const C1_RULE = Object.freeze({
  id: "C1",
  ruleId: "copilot.conflict.c1AdxLagging",
  ruleVersion: "copilot-conflict-c1AdxLagging/1.0.0",
  specRef: "§4.4:699 (R9.1, AC-027)",
  /** §4.4:699 — "When Booster1 **and** Booster2 both fire". */
  triggerBoosters: Object.freeze(["booster1EmaCross", "booster2BbwExpanding"]),
  /** §4.4:699 — "for the next 5 candles". */
  windowCandles: 5,
  /** How the five candles are counted. Named because it is a reading, not a fact. */
  windowAnchor: "triggerCandleInclusive",
  /** The expert whose score C1 maxes. `experts/trendStrength.mjs`. */
  targetExpert: "trendStrength",
  /** §4.4:684's band maximum — "set `Trend_Score` to max". */
  forcedRawDelta: TREND_BAND.max
})

/**
 * The anchor, as a name. A caller reading the module can see the interpretation
 * and disagree with it, which is the point of naming it.
 */
export const WINDOW_ANCHOR = C1_RULE.windowAnchor

/**
 * Where a window stands at one candle index.
 *
 * NO STORED `active`. The three states are mutually exclusive and all three are
 * reported, so "before", "inside", and "after" can never be collapsed into one
 * another by a truthy check:
 *
 *   notYetActive  candlesElapsed < 0                    (a candle before the trigger)
 *   active        0 <= candlesElapsed < windowCandles
 *   expired       candlesElapsed >= windowCandles
 *
 * @param {object} args
 * @param {number|null} args.triggerIndex The candle both boosters fired on, or
 *   `null` when no trigger is known. `null` NEVER opens a window.
 * @param {number} args.candleIndex The candle being evaluated.
 * @param {number} [args.windowCandles] Defaults to `C1_RULE.windowCandles`.
 * @returns {Readonly<object>} The window reading.
 */
export function c1WindowAt({ triggerIndex, candleIndex, windowCandles = C1_RULE.windowCandles } = {}) {
  assertIndex(candleIndex, "candleIndex")
  if (!Number.isInteger(windowCandles) || windowCandles <= 0) {
    throw new TypeError(`copilot: C1 windowCandles must be a positive integer; received ${String(windowCandles)}`)
  }
  // A window with no trigger is INACTIVE, not "unknown but optimistic". This is
  // the single most important line in the file: the engine that ships with C1
  // enabled and no tracker must produce no override, ever.
  if (triggerIndex === null || triggerIndex === undefined) {
    return Object.freeze({
      triggerIndex: null,
      candleIndex,
      windowCandles,
      candlesElapsed: null,
      candlesRemaining: 0,
      active: false,
      expired: false,
      notYetActive: false,
      noTrigger: true,
      reason: "no dual-booster trigger has been recorded, so there is no window to be inside"
    })
  }
  assertIndex(triggerIndex, "triggerIndex")

  const candlesElapsed = candleIndex - triggerIndex
  const notYetActive = candlesElapsed < 0
  const active = !notYetActive && candlesElapsed < windowCandles
  return Object.freeze({
    triggerIndex,
    candleIndex,
    windowCandles,
    candlesElapsed,
    candlesRemaining: active ? windowCandles - candlesElapsed : 0,
    active,
    expired: !notYetActive && !active,
    notYetActive,
    noTrigger: false,
    reason: active
      ? `C1 window open: ${candlesElapsed} of ${windowCandles} candles elapsed since the dual-booster trigger`
      : notYetActive
        ? `candle ${candleIndex} precedes the C1 trigger at ${triggerIndex}`
        : `C1 window expired after ${windowCandles} candles (trigger ${triggerIndex}, now ${candleIndex})`
  })
}

/**
 * What the two trigger boosters did on this candle.
 *
 * The observation is made by CALLING the Volatility & Boosters expert, not by
 * re-deriving its predicates. Re-deriving `ema20 − ema50` crossing zero and
 * `bbwNow > bbwPrev` here would be a second definition of "Booster1 fired", and
 * a second definition is how the engine and C1 would come to disagree about
 * whether the rule triggered — invisibly, because both would look right.
 *
 * @param {object} state A frozen state from `deriveMarketState`.
 * @param {object} [context] `{ regime }`, as the confluence passes it.
 * @returns {Readonly<object>} `{ activeBoosters, booster1Fired, booster2Fired,
 *   dualBoosterFired, boostersAvailable, unavailableReason }`
 */
export function observeDualBooster(state, context = {}) {
  if (state === null || typeof state !== "object") {
    throw new TypeError(`copilot: observeDualBooster requires a derived state; received ${String(state)}`)
  }
  const result = evaluateVolatilityBoosters(state, context)
  const activeBoosters = activeBoostersOf(result)
  const booster1Fired = activeBoosters.includes(C1_RULE.triggerBoosters[0])
  const booster2Fired = activeBoosters.includes(C1_RULE.triggerBoosters[1])
  return Object.freeze({
    activeBoosters: Object.freeze(activeBoosters),
    booster1Fired,
    booster2Fired,
    dualBoosterFired: booster1Fired && booster2Fired,
    boostersAvailable: result.available === true,
    unavailableReason: result.available === true ? null : result.unavailableReason,
    adxLegState: result.legs?.adx?.state ?? null
  })
}

/**
 * What the ADX leg read on this candle, and what the trend expert scored.
 *
 * The ADX penalty is the Trend & Strength expert's leg (§4.4:684, "ADX > 25
 * rising/falling"), so the state of that penalty lives on THAT expert — asking
 * the Volatility expert for it would return `undefined` and produce a rule that
 * believes it disabled nothing. `observeTrend` therefore calls the trend expert
 * directly, for the same anti-duplication reason as `observeDualBooster`.
 *
 * The observation is also what C1 records as the sub-score it REPLACED, so a
 * reader can see the before and the after rather than only the after.
 *
 * @param {object} state A frozen state from `deriveMarketState`.
 * @returns {Readonly<object>} `{ available, subScore, rawDelta, adxLegState,
 *   unavailableReason }`
 */
export function observeTrend(state) {
  if (state === null || typeof state !== "object") {
    throw new TypeError(`copilot: observeTrend requires a derived state; received ${String(state)}`)
  }
  const result = evaluateTrendStrength(state, {})
  return Object.freeze({
    available: result.available === true,
    subScore: result.available === true ? result.subScore : null,
    rawDelta: result.available === true ? result.rawDelta : null,
    adxLegState: result.legs?.adx?.state ?? null,
    unavailableReason: result.available === true ? null : result.unavailableReason
  })
}

/**
 * C1's decision for one candle.
 *
 * Returns a resolution record whether or not the rule applies. There is no
 * "null means no opinion" path: a caller always gets a named `status`, a
 * `reason`, and an `adjustments` array it can pass to the confluence.
 *
 * @param {object} args
 * @param {object} args.observation From `observeDualBooster`.
 * @param {object} args.trend From `observeTrend`.
 * @param {object} args.window From `c1WindowAt`.
 * @param {boolean} [args.enabled] `false` disables C1 outright.
 * @returns {Readonly<object>} The resolution.
 */
export function evaluateC1({ observation, trend = null, window, enabled = true } = {}) {
  const base = Object.freeze({
    rule: C1_RULE.id,
    ruleId: C1_RULE.ruleId,
    ruleVersion: C1_RULE.ruleVersion,
    specRef: C1_RULE.specRef,
    targetExpert: C1_RULE.targetExpert,
    supersededBy: null,
    window: window ?? null,
    adxPenaltyDisabled: false,
    inputs: Object.freeze({
      activeBoosters: observation?.activeBoosters ?? null,
      booster1Fired: observation?.booster1Fired ?? null,
      booster2Fired: observation?.booster2Fired ?? null,
      dualBoosterFired: observation?.dualBoosterFired ?? null,
      adxLegState: trend?.adxLegState ?? null,
      trendSubScore: trend?.subScore ?? null,
      trendAvailable: trend?.available ?? null,
      forcedRawDelta: C1_RULE.forcedRawDelta,
      windowCandles: C1_RULE.windowCandles,
      windowAnchor: WINDOW_ANCHOR
    })
  })

  if (enabled === false) {
    return withStatus(base, "disabled", "C1 is disabled for this evaluation", [])
  }
  if (observation === null || typeof observation !== "object") {
    throw new TypeError("copilot: evaluateC1 requires an `observation` from observeDualBooster")
  }
  if (observation.boostersAvailable === false) {
    // Fail CLOSED, per the repository's `v32Copilot.mjs:5` precedent: an
    // unobservable trigger condition is not a passing one. C1 maxes a score, so
    // "I could not check" must not read as "nothing to override".
    return withStatus(
      base,
      "unavailable",
      `C1 could not observe its trigger condition — ${observation.unavailableReason}`,
      []
    )
  }
  if (observation.dualBoosterFired !== true) {
    const which = [
      observation.booster1Fired === true ? C1_RULE.triggerBoosters[0] : null,
      observation.booster2Fired === true ? C1_RULE.triggerBoosters[1] : null
    ].filter(Boolean)
    return withStatus(
      base,
      "notTriggered",
      `C1 requires ${C1_RULE.triggerBoosters[0]} AND ${C1_RULE.triggerBoosters[1]}; ` +
        (which.length === 0
          ? "neither fired"
          : `only ${which.join(" and ")} fired, so the ADX penalty stands`),
      []
    )
  }
  if (window === null || window === undefined || window.active !== true) {
    const status = window?.notYetActive === true ? "notYetActive" : window?.noTrigger === true ? "noTrigger" : "expired"
    return withStatus(
      base,
      status,
      `both boosters fired but ${window?.reason ?? "no window was supplied"}, so the ADX penalty stands`,
      []
    )
  }

  // Both boosters fired AND the window is open. C1 applies.
  //
  // "Disable the ADX penalty" and "set Trend_Score to max" are one action here:
  // the whole trend score is forced, so the ADX leg cannot contribute anything
  // either way. `adxPenaltyWasActive` records whether there WAS a penalty to
  // disable, so the record never claims a repair it did not make.
  const adxPenaltyWasActive = isAdxPenaltyActive(trend)
  const adjustment = Object.freeze({
    expert: C1_RULE.targetExpert,
    rule: C1_RULE.id,
    ruleId: C1_RULE.ruleId,
    ruleVersion: C1_RULE.ruleVersion,
    rawDelta: C1_RULE.forcedRawDelta,
    reason:
      `${C1_RULE.id}: ${C1_RULE.triggerBoosters[0]} and ${C1_RULE.triggerBoosters[1]} both fired; ` +
      `ADX lags, so the ADX penalty is disabled and Trend_Score is set to its band maximum ` +
      `${C1_RULE.forcedRawDelta} for ${window.candlesRemaining} more candle(s) of the ${window.windowCandles}-candle window`
  })

  return Object.freeze({
    ...base,
    status: "applied",
    applied: true,
    adxPenaltyDisabled: true,
    adxPenaltyWasActive,
    reason: adjustment.reason,
    adjustments: Object.freeze([adjustment])
  })
}

/**
 * Caller-owned bookkeeping for WHERE a dual-booster trigger happened.
 *
 * This is deliberately NOT part of the decision. It holds no `active` flag and
 * performs no expiry arithmetic: `windowAt` delegates to the same pure
 * `c1WindowAt` the tests pin, so there is no second expiry implementation that
 * could disagree with the first. Its whole job is to remember an index.
 *
 * A tracker with nothing recorded opens nothing (`windowAt` → `noTrigger`).
 * That is what makes C1 ship dark: the engine is given a tracker or it is not,
 * and "not given" cannot be mistaken for "window open".
 */
export function createC1WindowTracker({ triggers = [] } = {}) {
  const recorded = []
  for (const index of triggers) {
    if (index !== null && index !== undefined) recorded.push(assertIndex(index, "trigger index"))
  }

  return Object.freeze({
    /**
     * Note whether this candle was a dual-booster trigger bar. Idempotent for
     * the same index, and a non-trigger records nothing.
     */
    observe({ candleIndex, observation } = {}) {
      assertIndex(candleIndex, "candleIndex")
      if (observation?.dualBoosterFired !== true) return null
      if (!recorded.includes(candleIndex)) recorded.push(candleIndex)
      return candleIndex
    },
    /** The pure window reading at `candleIndex`. Never optimistically open. */
    windowAt(candleIndex, windowCandles = C1_RULE.windowCandles) {
      return c1WindowAt({ triggerIndex: latestTrigger(), candleIndex, windowCandles })
    },
    /** The most recent trigger, or `null`. */
    get latestTriggerIndex() {
      return latestTrigger()
    },
    /** Every recorded trigger, ascending. Read-only. */
    triggerIndices() {
      return [...recorded].sort((a, b) => a - b)
    },
    hasTriggerAt(index) {
      return recorded.includes(index)
    }
  })

  function latestTrigger() {
    return recorded.length === 0 ? null : recorded[recorded.length - 1]
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * The ADX leg is a penalty when ADX cleared 25 and is FALLING — the only
 * negative the leg can produce (`experts/trendStrength.mjs:20-24`, §4.4:684's
 * "+10 / −10"). Below-threshold is 0, not a penalty, so claiming to have
 * disabled one there would be reporting a repair nobody needed.
 */
function isAdxPenaltyActive(trend) {
  return trend?.adxLegState === "above-25-falling"
}

function withStatus(base, status, reason, adjustments) {
  return Object.freeze({
    ...base,
    status,
    applied: false,
    reason,
    adjustments: Object.freeze(adjustments)
  })
}

function assertIndex(value, label) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`copilot: C1 ${label} must be an integer candle index; received ${String(value)}`)
  }
  return value
}
