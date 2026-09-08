/**
 * Aggregate per-ministry income/pnl into a cumulative view.
 * Honesty contract: a ministry with no totals contributes no entry (not a
 * fabricated 0). Mixed or empty currencies -> currency null (never a wrong 0).
 */
export function aggregateMinistries(ministries) {
  const perMinistry = {}
  let grandTotal = 0
  const currencies = new Set()
  for (const m of ministries) {
    let sum = 0
    for (const t of m.totals ?? []) {
      sum += t.amount
      currencies.add(t.currency)
    }
    if (m.totals && m.totals.length > 0) {
      perMinistry[m.id] = sum
      grandTotal += sum
    }
  }
  const currency = currencies.size === 1 ? [...currencies][0] : null
  return { perMinistry, grandTotal, currency }
}