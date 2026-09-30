// WS-7 T11 — veto 1 of 6: TOP-DOWN HIERARCHY.
// §4.4:691 — "(1) Top-Down Hierarchy"
//
// Fires when the higher timeframe's bias OPPOSES the direction being proposed.
// The two inputs are `facts.direction` ("long" | "short") and
// `facts.higherTimeframeBias` ("bullish" | "bearish"), supplied by the caller.
//
// A long into a bearish higher timeframe, or a short into a bullish one, is the
// condition. Agreeing is not a veto, and "no bias stated" is not agreement —
// it is an absence, and an absent bias fails closed through `unevaluatedOutcome`
// rather than silently passing (see `outcome.mjs` for the full reasoning).

import { buildOutcome, clearOutcome, finiteOrNull, unevaluatedOutcome } from "./outcome.mjs"

export const RULE_ID = "topDownHierarchy"
export const RULE_VERSION = "copilot-veto-topDownHierarchy/1.0.0"
export const SUPPRESSED = "entry"

const OPPOSES = Object.freeze({ long: "bearish", short: "bullish" })

export function evaluate(state) {
  const { direction, higherTimeframeBias } = state.facts
  const evaluatedAt = state.computedAt

  if (direction !== "long" && direction !== "short") {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["facts.direction (expected \"long\" or \"short\")"],
      present: { higherTimeframeBias: String(higherTimeframeBias ?? "absent") }
    })
  }
  if (higherTimeframeBias !== "bullish" && higherTimeframeBias !== "bearish") {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["facts.higherTimeframeBias (expected \"bullish\" or \"bearish\")"],
      present: { direction }
    })
  }

  const expectedOpposite = OPPOSES[direction]
  const fired = higherTimeframeBias === expectedOpposite
  const atr = finiteOrNull(state.facts.atr)

  return fired
    ? buildOutcome({
        ruleId: RULE_ID,
        fired: true,
        inputs: { direction, higherTimeframeBias, opposes: expectedOpposite, atrObserved: atr !== null },
        suppressed: SUPPRESSED,
        evaluatedAt,
        ruleVersion: RULE_VERSION
      })
    : clearOutcome({
        ruleId: RULE_ID,
        inputs: { direction, higherTimeframeBias, agrees: true },
        suppressed: SUPPRESSED,
        evaluatedAt,
        ruleVersion: RULE_VERSION
      })
}
