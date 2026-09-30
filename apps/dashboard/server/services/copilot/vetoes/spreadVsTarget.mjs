// WS-7 T11 — veto 4 of 6: SPREAD-VS-TARGET.
// §4.4:691 — "(4) Spread-vs-Target"
//
// Fires when the market's current spread is wider than the target the trade is
// being taken for — paying more to enter than the setup is worth.
//
// Inputs are two facts the caller supplies: `facts.spreadPct` and
// `facts.targetPct`, both percentages on the same basis. The rule is a plain
// comparison and adds no tolerance of its own: `>` means the spread strictly
// exceeds the target, and an equal spread is acceptable, because a target is a
// ceiling the trade is willing to pay and paying exactly it is still within it.

import { buildOutcome, clearOutcome, finiteOrNull, unevaluatedOutcome } from "./outcome.mjs"

export const RULE_ID = "spreadVsTarget"
export const RULE_VERSION = "copilot-veto-spreadVsTarget/1.0.0"
export const SUPPRESSED = "entry"

export function evaluate(state) {
  const evaluatedAt = state.computedAt
  const spread = finiteOrNull(state.facts.spreadPct)
  const target = finiteOrNull(state.facts.targetPct)

  const missing = []
  if (spread === null) missing.push("facts.spreadPct")
  if (target === null) missing.push("facts.targetPct")
  if (missing.length > 0) {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing,
      present: { spreadPct: spread === null ? "absent" : spread, targetPct: target === null ? "absent" : target }
    })
  }

  if (target <= 0) {
    // A non-positive target is not a small target, it is an impossible one, and
    // every spread would exceed it. Reporting "the spread is too wide" would be
    // technically true and completely useless, so the reason says what is
    // actually wrong with the input.
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["a positive facts.targetPct"],
      present: { spreadPct: spread, targetPct: target }
    })
  }

  const fired = spread > target
  const inputs = { spreadPct: spread, targetPct: target, excessPct: spread - target, comparison: "spread > target" }

  return fired
    ? buildOutcome({ ruleId: RULE_ID, fired: true, inputs, suppressed: SUPPRESSED, evaluatedAt, ruleVersion: RULE_VERSION })
    : clearOutcome({ ruleId: RULE_ID, inputs, suppressed: SUPPRESSED, evaluatedAt, ruleVersion: RULE_VERSION })
}
