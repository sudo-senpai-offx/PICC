// §5.1 cohort survival curves — pure compute, no I/O.
export function survivalByCohort(rows = []) {
  const bias = {
    nAccountsObserved: new Set(rows.map((r) => `${r.venue}:${r.accountRef}`)).size,
    nDormant: rows.filter((r) => r.outcomeKind === "dormant").length,
    nLiquidated: rows.filter((r) => r.outcomeKind === "liquidated").length,
    windowStart: null, windowEnd: null,
    reason: rows.length === 0 ? "no-external-samples" : null,
  }
  if (rows.length === 0) return { cohorts: [], bias }
  const byCohort = new Map()
  for (const r of rows) {
    const k = r.cohort ?? "unknown"
    if (!byCohort.has(k)) byCohort.set(k, [])
    byCohort.get(k).push(r)
  }
  const cohorts = [...byCohort.entries()].map(([cohort, rs]) => ({
    cohort,
    nAccounts: new Set(rs.map((r) => `${r.venue}:${r.accountRef}`)).size,
    nDormant: rs.filter((r) => r.outcomeKind === "dormant").length,
    nLiquidated: rs.filter((r) => r.outcomeKind === "liquidated").length,
    windowStart: null, windowEnd: null,
  }))
  return { cohorts, bias }
}
