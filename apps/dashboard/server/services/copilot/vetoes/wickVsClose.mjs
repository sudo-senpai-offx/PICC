// WS-7 T11 — veto 3 of 6: WICK-VS-CLOSE.
// §4.4:691 — "(3) Wick-vs-Close"
//
// Fires when the bar's EXTREME pierced the stop distance but the CLOSE did not —
// the case where the wick claims a level was lost and the close says it was not.
//
// AC-028:989-994 names the same geometry for C2's two-tier stop ("Price wicks
// beyond 1.5x ATR but closes inside" → soft stop alerts, no hard stop). The
// multiplier is the spec's own: §4.4:695 "ATR(14) stop at 1.5x".
//
// DIRECTION-SYMMETRIC. For a long the reference is the prior close and the
// relevant extreme is the LOW; for a short it is the HIGH. Reference is the
// PRIOR bar's close, not this bar's open, so the comparison is against the last
// price the market agreed on.
//
// T12 owns C2 and may refine the stop semantics. This module only decides
// whether the wick and the close disagree, which is the observation C2 consumes.

import { buildOutcome, clearOutcome, finiteOrNull, unevaluatedOutcome } from "./outcome.mjs"

export const RULE_ID = "wickVsClose"
export const RULE_VERSION = "copilot-veto-wickVsClose/1.0.0"
export const SUPPRESSED = "entry"

/** §4.4:695 — the ATR(14) stop at 1.5x. */
export const ATR_MULTIPLE = 1.5

export function evaluate(state) {
  const evaluatedAt = state.computedAt
  const { direction } = state.facts

  if (direction !== "long" && direction !== "short") {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["facts.direction (the wick side depends on which side is exposed)"]
    })
  }

  const atr = finiteOrNull(state.series?.atr14 ? lastFinite(state.series.atr14) : null)
  if (atr === null || atr <= 0) {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["ATR(14)"],
      present: { direction }
    })
  }

  const candles = state.candles
  if (!Array.isArray(candles) || candles.length < 2) {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["a prior bar to take the reference close from"]
    })
  }

  const last = candles[candles.length - 1]
  const priorClose = Number(candles[candles.length - 2].close)
  const close = Number(last.close)
  const high = Number(last.high)
  const low = Number(last.low)
  const stopDistance = atr * ATR_MULTIPLE

  const isLong = direction === "long"
  const reference = priorClose
  const extreme = isLong ? low : high
  const extremeDistance = isLong ? (reference - extreme) / atr : (extreme - reference) / atr
  const closeDistance = isLong ? (reference - close) / atr : (close - reference) / atr

  // The disagreement the rule is named for: the extreme went past the stop, the
  // close did not. `>` on the extreme and `<=` on the close keep the boundary
  // case (extreme exactly at 1.5x) with the wick, matching AC-028's "wicks
  // beyond" wording.
  const pierced = extremeDistance > ATR_MULTIPLE
  const closedBeyond = closeDistance > ATR_MULTIPLE
  const fired = pierced && !closedBeyond

  const inputs = {
    direction,
    atr,
    stopDistance,
    multiple: ATR_MULTIPLE,
    referenceClose: reference,
    barClose: close,
    barHigh: high,
    barLow: low,
    extremeDistanceAtr: extremeDistance,
    closeDistanceAtr: closeDistance,
    pierced,
    closedBeyond
  }

  return fired
    ? buildOutcome({ ruleId: RULE_ID, fired: true, inputs, suppressed: SUPPRESSED, evaluatedAt, ruleVersion: RULE_VERSION })
    : clearOutcome({ ruleId: RULE_ID, inputs, suppressed: SUPPRESSED, evaluatedAt, ruleVersion: RULE_VERSION })
}

function lastFinite(series) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (typeof series[i] === "number" && Number.isFinite(series[i])) return series[i]
  }
  return null
}
