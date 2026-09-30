// WS-7 T11 — veto 2 of 6: CORRELATION TRAP.
// §4.4:691 — "(2) Correlation Trap"
//
// Fires when two or more open proposals share a `correlationGroup` — the case
// where two positions look like diversification and are in fact the same bet.
// USDJPY and EURUSD in the same group is the canonical example.
//
// Inputs are `state.proposals`: an array of `{ symbol, correlationGroup }`. The
// rule reads only the GROUP, so it does not need a correlation matrix or a
// price feed — the group is a fact the caller owns.
//
// The group with the most members is reported as the reason, chosen by a
// deterministic tie-break (group name, ascending) so the record is reproducible
// under AC-021 rather than dependent on array order.

import { buildOutcome, clearOutcome, unevaluatedOutcome } from "./outcome.mjs"

export const RULE_ID = "correlationTrap"
export const RULE_VERSION = "copilot-veto-correlationTrap/1.0.0"
export const SUPPRESSED = "entry"

/** How many proposals sharing a group constitute the trap. */
export const TRAP_THRESHOLD = 2

export function evaluate(state) {
  const evaluatedAt = state.computedAt
  const proposals = state.proposals

  // `null` means no proposals list was supplied, so correlated exposure cannot
  // be ruled out. `[]` means the caller supplied a list that is genuinely empty
  // — there is no correlated exposure, and that is a real observation, not a
  // missing one. See the note on `deriveMarketState`'s `proposals`.
  if (!Array.isArray(proposals)) {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["proposals[] (no open-proposal list, so correlated exposure cannot be ruled out)"]
    })
  }

  if (proposals.length === 0) {
    return clearOutcome({
      ruleId: RULE_ID,
      inputs: { proposalCount: 0, distinctGroups: 0, largestGroup: "none", largestGroupSize: 0 },
      suppressed: SUPPRESSED,
      evaluatedAt,
      ruleVersion: RULE_VERSION
    })
  }

  const byGroup = new Map()
  for (const p of proposals) {
    const group = p?.correlationGroup
    if (typeof group !== "string" || group.length === 0) continue
    if (!byGroup.has(group)) byGroup.set(group, [])
    byGroup.get(group).push(String(p?.symbol ?? "unnamed"))
  }

  // Deterministic order: largest group first, then group name ascending. AC-021
  // forbids an observable order being incidental to map insertion.
  const ranked = [...byGroup.entries()]
    .map(([group, symbols]) => ({ group, count: symbols.length, symbols: symbols.slice().sort() }))
    .sort((a, b) => b.count - a.count || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0))

  const trap = ranked.find((g) => g.count >= TRAP_THRESHOLD)

  if (trap === undefined) {
    return clearOutcome({
      ruleId: RULE_ID,
      inputs: {
        proposalCount: proposals.length,
        distinctGroups: ranked.length,
        largestGroup: ranked[0]?.group ?? "none",
        largestGroupSize: ranked[0]?.count ?? 0
      },
      suppressed: SUPPRESSED,
      evaluatedAt,
      ruleVersion: RULE_VERSION
    })
  }

  return buildOutcome({
    ruleId: RULE_ID,
    fired: true,
    inputs: {
      correlationGroup: trap.group,
      count: trap.count,
      symbols: trap.symbols.join(","),
      threshold: TRAP_THRESHOLD,
      distinctGroups: ranked.length
    },
    suppressed: SUPPRESSED,
    evaluatedAt,
    ruleVersion: RULE_VERSION
  })
}
