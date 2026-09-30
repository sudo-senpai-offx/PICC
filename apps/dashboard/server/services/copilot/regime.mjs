// WS-7 T11 — the five-class regime classifier.
//
// §4.4:693 — "Regime classifier: Tokyo Range · London Trend · NY Volatility
//             Hypertrend · Dead Zone (no trading)."
// §4.3:617 and contracts.ts:186 type it as
// `"tokyoRange" | "londonTrend" | "nyVolatility" | "hypertrend" | "deadZone"`.
//
// NO THIRD COPY OF THE SESSION HOURS. The repo already has ONE canonical table
// of session times (`tradingSessions.mjs:4-32`, `SESSIONS`/`OVERLAPS`) and one
// D10 policy bound set derived from it (`tradingSessionPolicy.mjs:30-42`,
// `SESSION_BOUNDS_UTC`, which is already pinned equal to its client copy by
// `server/__tests__/ws6-domain.test.ts:57`). This module READS both and adds
// only the regime mapping, which is a different question: `routeSession` answers
// "which strategy style applies", the classifier answers "what kind of
// volatility regime is this".
//
// The mapping itself is the judgement call, and it is stated as data in
// `REGIME_RULES` so it is auditable and one edit to change. Every bound in it
// names the existing constant it came from.
//
// DEAD ZONE IS ABSOLUTE AND FIRST, and it includes the 00:00 instant — that is
// the frozen rule at `tradingSessionPolicy.mjs:54`, reproduced rather than
// re-derived, because a dead zone that moved by one hour is a live-money bug.
//
// §4.7:747 is why `deadZone` exists as a regime and not as a low score: it
// "renders as 'no trading' rather than as a low score". `confluence.mjs` reads
// that regime and returns `score: null` rather than 0.

import { SESSION_BOUNDS_UTC } from "../tradingSessionPolicy.mjs"
import { SESSIONS } from "../tradingSessions.mjs"
import { lastValue, valueAt } from "./marketState.mjs"

export const REGIME_RULE_VERSION = "copilot-regime/1.0.0"

/**
 * The session→regime mapping, evaluated in this order. First match wins.
 *
 * `deadZone` appears twice on purpose: once as the explicit 20:00–00:00 window
 * and once as the catch-all, because an hour that no rule claims is not a
 * reason to trade.
 */
export const REGIME_RULES = Object.freeze([
  Object.freeze({
    regime: "deadZone",
    source: "SESSION_BOUNDS_UTC.deadZone (frozen at tradingSessionPolicy.mjs:33)",
    bounds: Object.freeze({ startHour: SESSION_BOUNDS_UTC.deadZone.startHour, endHour: 24 }),
    includesMidnightInstant: true
  }),
  Object.freeze({
    regime: "nyVolatility",
    source: "SESSIONS.newyork.open .. SESSION_BOUNDS_UTC.deadZone.startHour",
    bounds: Object.freeze({ startHour: SESSIONS.newyork.open, endHour: SESSION_BOUNDS_UTC.deadZone.startHour })
  }),
  Object.freeze({
    regime: "tokyoRange",
    source: "SESSION_BOUNDS_UTC.tokyo (tradingSessionPolicy.mjs:40)",
    bounds: Object.freeze({ startHour: SESSION_BOUNDS_UTC.tokyo.startHour, endHour: SESSION_BOUNDS_UTC.tokyo.endHour })
  }),
  Object.freeze({
    regime: "londonTrend",
    source: "SESSIONS.london.open .. SESSION_BOUNDS_UTC.overlap.startHour",
    bounds: Object.freeze({ startHour: SESSIONS.london.open, endHour: SESSION_BOUNDS_UTC.overlap.startHour })
  })
])

/**
 * The hypertrend overlay's thresholds. §4.4:701 describes the regime as a
 * "high-velocity window" and §4.4:699 states that "ADX lags; BBW and the 20/50
 * cross lead" — so the overlay is built from the two LEADING signals plus a
 * strong-trend confirmation, not from ADX alone.
 */
export const HYPERTREND_THRESHOLDS = Object.freeze({
  /** Stronger than the 25 trend gate of §4.4:684, because hypertrend is the extreme. */
  adxAtOrAbove: 30,
  /** BBW must be strictly expanding on this bar. */
  requireExpandingBandwidth: true,
  /** The 20/50 cross must already be up, not currently crossing. */
  requireEma20AboveEma50: true
})

/** Decimal UTC hour, derived only from the supplied `computedAt`. */
function decimalUtcHour(timestampMs) {
  const d = new Date(timestampMs)
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`copilot: regime classification requires a valid UTC timestamp; received ${timestampMs}`)
  }
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

/**
 * Classify the market state into exactly one of the five spec regimes.
 *
 * PURE: reads `state.computedAt` and the derived series only. No clock of its
 * own, which is what AC-021:937 requires of the whole decision path.
 *
 * @param {object} state A frozen state from `deriveMarketState`.
 * @returns {{regime: string, ruleVersion: string, evaluatedAt: number,
 *            utcHour: number, matchedRule: string, source: string,
 *            hypertrend: {fired: boolean, legs: object|null}}}
 */
export function classifyRegime(state) {
  const evaluatedAt = state.computedAt
  const h = decimalUtcHour(evaluatedAt)

  // --- Rule 1: the absolute dead zone, includes the 00:00 instant -------------
  const inDeadZone = h >= SESSION_BOUNDS_UTC.deadZone.startHour || h === 0
  if (inDeadZone) {
    return {
      regime: "deadZone",
      ruleVersion: REGIME_RULE_VERSION,
      evaluatedAt,
      utcHour: h,
      matchedRule: `dead zone ${SESSION_BOUNDS_UTC.deadZone.startHour}:00-00:00 UTC — no trading`,
      source: REGIME_RULES[0].source,
      hypertrend: { fired: false, legs: null }
    }
  }

  // --- The hypertrend overlay, evaluated before the session regimes ----------
  const hypertrend = evaluateHypertrend(state)

  for (const rule of REGIME_RULES.slice(1)) {
    if (h >= rule.bounds.startHour && h < rule.bounds.endHour) {
      return {
        regime: hypertrend.fired ? "hypertrend" : rule.regime,
        ruleVersion: REGIME_RULE_VERSION,
        evaluatedAt,
        utcHour: h,
        matchedRule: hypertrend.fired
          ? `hypertrend overlay over ${rule.regime} — ${rule.bounds.startHour}:00-${rule.bounds.endHour}:00 UTC`
          : `${rule.regime} — ${rule.bounds.startHour}:00-${rule.bounds.endHour}:00 UTC`,
        source: rule.source,
        hypertrend
      }
    }
  }

  // --- Catch-all: an unclaimed hour is not a reason to trade ----------------
  return {
    regime: "deadZone",
    ruleVersion: REGIME_RULE_VERSION,
    evaluatedAt,
    utcHour: h,
    matchedRule: `unclaimed hour ${h.toFixed(2)} UTC — no trading`,
    source: "no rule in REGIME_RULES claims this hour",
    hypertrend: { fired: false, legs: null }
  }
}

/**
 * The hypertrend overlay, on its own so a test can assert its legs without
 * going through the session mapping.
 */
export function evaluateHypertrend(state) {
  const adx = lastValue(state.series.adx)
  const bbw = lastValue(state.series.bbw)
  const bbwPrev = valueAt(state.series.bbw, 1)
  const ema20 = lastValue(state.series.ema20)
  const ema50 = lastValue(state.series.ema50)

  if (adx === null || bbw === null || bbwPrev === null || ema20 === null || ema50 === null) {
    return {
      fired: false,
      legs: null,
      reason: `hypertrend overlay not evaluable — ADX/BBW/EMA20/EMA50 have not warmed up on ${state.candles.length} candles`
    }
  }

  const strongTrend = adx >= HYPERTREND_THRESHOLDS.adxAtOrAbove
  const expanding = bbw > bbwPrev
  const crossedUp = ema20 > ema50
  const fired =
    strongTrend && expanding && crossedUp

  return {
    fired,
    reason: fired
      ? `ADX ${adx.toFixed(2)} >= ${HYPERTREND_THRESHOLDS.adxAtOrAbove} with expanding bandwidth and 20 above 50`
      : `hypertrend overlay did not fire (ADX ${adx.toFixed(2)}, expanding=${expanding}, ema20AboveEma50=${crossedUp})`,
    legs: {
      adx,
      threshold: HYPERTREND_THRESHOLDS.adxAtOrAbove,
      strongTrend,
      bbw,
      bbwPrev,
      expanding,
      ema20,
      ema50,
      crossedUp
    }
  }
}
