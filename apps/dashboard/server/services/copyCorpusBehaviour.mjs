// §5.2 state-conditioned behaviour statistics — pure compute.
// Conditions on STATE, never on identity (§4.2). No per-participant output.
export function behaviourGivenState(externalRows = [], { ownerRows = [] } = {}) {
  const bias = {
    nAccountsObserved: new Set(externalRows.map((r) => `${r.venue}:${r.accountRef}`)).size,
    nDormant: externalRows.filter((r) => r.outcomeKind === "dormant").length,
    nLiquidated: externalRows.filter((r) => r.outcomeKind === "liquidated").length,
    windowStart: null, windowEnd: null,
    reason: externalRows.length === 0 ? "no-external-samples" : null,
  }
  if (externalRows.length === 0) return { rules: [], bias }
  const ownerStates = new Set(ownerRows.map((r) => r.stateBefore))
  const byState = new Map()
  for (const r of externalRows) {
    const k = r.stateBefore ?? "unknown"
    if (!byState.has(k)) byState.set(k, [])
    byState.get(k).push(r)
  }
  const rules = [...byState.entries()].map(([state, rs]) => {
    const n = rs.length
    const nInc = rs.filter((r) => r.sizeResponse === "increase").length
    const nCut = rs.filter((r) => ["cut", "halved"].includes(r.sizeResponse)).length
    return { state, n, pIncrease: n ? nInc / n : null, pCut: n ? nCut / n : null, ownerComparable: ownerStates.has(state) }
  })
  return { rules, bias }
}
