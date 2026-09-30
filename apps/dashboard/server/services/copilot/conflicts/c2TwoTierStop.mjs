// WS-7 T12 — conflict resolution C2: WICK-VS-CLOSE vs THE ATR HARD STOP.
//
// §4.4:700 — "**C2 — Wick-vs-Close vs ATR hard stop.** Two-tier. The **soft**
// stop at 1.5× ATR alerts and *waits for candle close*. The **hard** stop fires
// only on a **close** beyond 1.5× ATR, or a close below the 50 EMA."
//
// AC-028 (:989-995) is the binding criterion; R9.2 (:431) — "C2 … is two-tier
// exactly as specified".
//
// The whole rule in one sentence: **THE WICK CANNOT STOP A TRADE.** Everything
// else here is bookkeeping about which observation was made.
//
// ---------------------------------------------------------------------------
// WHY THE 1.5x IS IMPORTED, NOT DECLARED
// ---------------------------------------------------------------------------
//
// `riskLayer.mjs` owns §4.4:695's "ATR(14) stop at 1.5x" and
// `vetoes/wickVsClose.mjs` owns the same multiplier for the ENTRY veto. C2
// imports the former and a test asserts the two agree, because a stop on an open
// position and a veto on a new entry that disagreed about "beyond 1.5× ATR"
// would produce the incoherent pair "veto fired, so you never got in" alongside
// "the stop was elsewhere". That is Risk 6 of plan v1 §2.
//
// ---------------------------------------------------------------------------
// WHY THE 50-EMA CLAUSE IS TESTED IN ISOLATION
// ---------------------------------------------------------------------------
//
// §4.4:700 gives the hard stop two independent clauses joined by "or". In most
// markets one dominates: where price is far above the 50 EMA, the 1.5× ATR stop
// sits above the EMA and any close that breaches the EMA has already breached
// the stop. The clause is only separately observable where the 50 EMA is
// INSIDE 1.5× ATR of the anchor — a market running close to its own EMA. The
// `closeBelowEma50` fixture is built for exactly that shape (see
// `conflictFixtures.mjs`), and a test asserts the clause fires with
// `closeBeyondAtr` absent. Without that case AC-028's "or a close below the 50
// EMA" would be a clause no test ever exercised.
//
// This is a property of the RULE, not of the fixture, and it is worth stating
// plainly: on a strongly trending long the 50-EMA clause can never be the one
// that fires first. That is what the spec says to do.
//
// ---------------------------------------------------------------------------
// NO TIER, NO WEIGHT, NO SCORE
// ---------------------------------------------------------------------------
//
// C2 changes no expert weight and no score. It governs whether an OPEN position
// is exited; a score governs whether one is ENTERED. Keeping them separate is
// what makes the C1-vs-C2 precedence a real decision between two rules rather
// than two rules editing one number — and `c2Adjustments` returns `[]` so that
// separation is asserted, not merely intended.
//
// PURE. No clock, no randomness, no network, no filesystem, no model. The only
// time input is `state.computedAt`, supplied by the caller (AC-021:937).

import { lastValue } from "../marketState.mjs"
import { ATR_STOP_MULTIPLE } from "../riskLayer.mjs"

/**
 * C2 as a named, versioned rule. Frozen.
 */
export const C2_RULE = Object.freeze({
  id: "C2",
  ruleId: "copilot.conflict.c2TwoTierStop",
  ruleVersion: "copilot-conflict-c2TwoTierStop/1.0.0",
  specRef: "§4.4:700 (R9.2, AC-028)",
  /** §4.4:700 / §4.4:695 — the ATR(14) stop at 1.5x. Imported, not restated. */
  atrMultiple: ATR_STOP_MULTIPLE,
  atrPeriod: 14,
  emaPeriod: 50,
  /** The two independent clauses that fire the HARD tier. §4.4:700's "or". */
  hardTriggers: Object.freeze(["closeBeyondAtr", "closeBelowEma50"]),
  /** The two tiers' names, as AC-028 states them. */
  softTier: "softAlert",
  hardTier: "hardStop"
})

/**
 * The four verdicts a caller can receive. `unavailable` is not a fifth tier of
 * the stop — it is the honest report that the stop could not be evaluated, and
 * it is deliberately distinct from `none` so "no stop was reached" and "I could
 * not tell" can never be rendered the same way.
 */
export const TWO_TIER_VERDICTS = Object.freeze(["hardStop", "softAlert", "none", "unavailable"])

/** The geometry C2 decided on, for a caller that renders it. */
function stopShape(verdict, inputs) {
  if (inputs.atr === null) return null
  return Object.freeze({
    multiple: C2_RULE.atrMultiple,
    period: C2_RULE.atrPeriod,
    distance: inputs.stopDistance,
    level: inputs.stopLevel,
    emaLevel: inputs.ema50,
    emaPeriod: C2_RULE.emaPeriod,
    softAlertFired: verdict === "softAlert",
    hardStopFired: verdict === "hardStop"
  })
}

/**
 * Evaluate the two-tier stop for one candle.
 *
 * @param {object} args
 * @param {object} args.state A frozen state from `deriveMarketState`.
 * @param {"long"|"short"} args.direction Which side is exposed. Required: a
 *   stop with no side is not a stop.
 * @param {number} [args.entryPrice] The fill the stop is anchored to. Omit and
 *   the prior bar's close is used — the same reference
 *   `vetoes/wickVsClose.mjs:66,72-73` takes, so the entry veto and the position
 *   stop cannot disagree about where "beyond 1.5× ATR" is.
 * @param {boolean} [args.enabled] `false` disables C2 outright.
 * @returns {Readonly<object>} The stop reading. Always a named verdict; never
 *   `undefined`, never a thrown-and-swallowed failure.
 */
export function evaluateC2({ state, direction, entryPrice = null, enabled = true } = {}) {
  const evaluatedAt = state?.computedAt ?? null
  const base = Object.freeze({
    rule: C2_RULE.id,
    ruleId: C2_RULE.ruleId,
    ruleVersion: C2_RULE.ruleVersion,
    specRef: C2_RULE.specRef,
    enabled: enabled === true,
    evaluatedAt
  })

  if (enabled !== true) {
    return unavailable(base, "C2 is disabled for this evaluation", direction, null, evaluatedAt, "disabled")
  }
  if (state === null || typeof state !== "object" || !Array.isArray(state.candles)) {
    throw new TypeError("copilot: evaluateC2 requires a derived state with candles")
  }
  if (direction !== "long" && direction !== "short") {
    // Not an exception, and not a default. A caller who has not established
    // which side is exposed has not got a stop, and defaulting to "long" would
    // silently stop the wrong position.
    return unavailable(
      base,
      `C2 needs facts.direction to know which side is exposed; received ${String(direction)}`,
      direction,
      null,
      evaluatedAt
    )
  }

  const isLong = direction === "long"
  const atr = finiteOrNull(lastValue(state.series?.atr14))
  if (atr === null || atr <= 0) {
    return unavailable(
      base,
      `ATR(${C2_RULE.atrPeriod}) has not warmed up on ${state.candles.length} candles, so no stop distance can be computed`,
      direction,
      null,
      evaluatedAt
    )
  }
  const ema50 = finiteOrNull(lastValue(state.series?.ema50))
  if (ema50 === null) {
    return unavailable(
      base,
      `the ${C2_RULE.emaPeriod} EMA has not warmed up on ${state.candles.length} candles, so the 50-EMA hard clause cannot be evaluated`,
      direction,
      atr,
      evaluatedAt
    )
  }
  if (state.last === null) {
    return unavailable(base, "there is no working-timeframe last bar to read a close from", direction, atr, evaluatedAt)
  }

  const anchor = resolveAnchor(state, entryPrice)
  if (anchor === null) {
    return unavailable(
      base,
      "no entry price was supplied and there is no prior bar to take a reference close from",
      direction,
      atr,
      evaluatedAt
    )
  }

  const stopDistance = atr * C2_RULE.atrMultiple
  const stopLevel = isLong ? anchor.price - stopDistance : anchor.price + stopDistance
  const close = Number(state.last.close)
  const high = Number(state.last.high)
  const low = Number(state.last.low)

  const wickBeyondStop = isLong ? low <= stopLevel : high >= stopLevel
  const closeBeyondStop = isLong ? close <= stopLevel : close >= stopLevel
  const closeBeyondEma50 = isLong ? close < ema50 : close > ema50

  const triggers = []
  if (closeBeyondStop) triggers.push("closeBeyondAtr")
  if (closeBeyondEma50) triggers.push("closeBelowEma50")

  const inputs = Object.freeze({
    direction,
    atr,
    stopDistance,
    stopLevel,
    ema50,
    entryPrice: anchor.price,
    entryPriceSource: anchor.source,
    barHigh: high,
    barLow: low,
    barClose: close,
    wickBeyondStop,
    closeBeyondStop,
    closeBeyondEma50,
    wickDistanceAtr: isLong ? (anchor.price - low) / atr : (high - anchor.price) / atr,
    closeDistanceAtr: isLong ? (anchor.price - close) / atr : (close - anchor.price) / atr
  })

  // THE RULE. §4.4:700 — the hard stop fires ONLY on a close. The wick enters
  // exactly one branch: the soft alert, which waits for the close.
  const verdict = triggers.length > 0 ? "hardStop" : wickBeyondStop ? "softAlert" : "none"

  return Object.freeze({
    ...base,
    status: "evaluated",
    available: true,
    verdict,
    hardStop: verdict === "hardStop",
    softAlert: verdict === "softAlert",
    // "Waits for candle close" made explicit: on the soft tier the decision is
    // deliberately deferred, and a caller that renders this must show that.
    waitsForCandleClose: verdict === "softAlert",
    action: verdict === "hardStop" ? "exit" : verdict === "softAlert" ? "alert" : "hold",
    triggers: Object.freeze(triggers),
    inputs,
    stop: stopShape(verdict, inputs),
    unavailableReason: null
  })
}

/**
 * The confluence adjustments C2 contributes.
 *
 * ALWAYS `[]`, and that is the point rather than an omission. C2 governs the
 * exit of an open position; a score governs the entry of a new one. A stop that
 * edited the score would be a fourth place a tier boundary could be moved,
 * which is exactly the drift Risk 6 exists to prevent. The array exists so the
 * separation is ASSERTED — a test reads it — instead of being a comment.
 */
export function c2Adjustments(_resolution) {
  return Object.freeze([])
}

function resolveAnchor(state, entryPrice) {
  if (entryPrice !== null && entryPrice !== undefined) {
    if (typeof entryPrice !== "number" || !Number.isFinite(entryPrice)) {
      throw new TypeError(`copilot: C2 entryPrice must be a finite number; received ${String(entryPrice)}`)
    }
    return { price: entryPrice, source: "callerSupplied" }
  }
  const prior = state.candles[state.candles.length - 2]
  if (prior === undefined) return null
  const price = Number(prior.close)
  if (!Number.isFinite(price)) return null
  return { price, source: "priorBarClose" }
}

function unavailable(base, reason, direction, atr, evaluatedAt, status = "unavailable") {
  const inputs = Object.freeze({
    direction: direction ?? null,
    atr: atr ?? null,
    stopDistance: null,
    stopLevel: null,
    ema50: null,
    entryPrice: null,
    entryPriceSource: null,
    barHigh: null,
    barLow: null,
    barClose: null,
    wickBeyondStop: null,
    closeBeyondStop: null,
    closeBeyondEma50: null,
    wickDistanceAtr: null,
    closeDistanceAtr: null
  })
  return Object.freeze({
    ...base,
    status,
    available: false,
    verdict: "unavailable",
    hardStop: false,
    softAlert: false,
    waitsForCandleClose: false,
    action: "unavailable",
    triggers: Object.freeze([]),
    inputs,
    stop: null,
    unavailableReason: reason,
    evaluatedAt
  })
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
