// Tax-lot CSV renderer (report-only; not tax advice).
//
// Consumes Task 1 lot lines and renders the fixed-column export:
// banner comment rows (disclaimer + method + generated-at), one header
// row, one row per lot. Nulls render empty, flags pipe-join, and every
// value is CSV-escaped (quotes/commas/newlines).
//
// Unmatched handling (pinned by taxCsv.test.mjs): Task 1 already lists
// unmatched sells inline in `lots` with their flags, so entries of
// `unmatched` whose id is already listed are skipped, never duplicated.
// Unmatched entries NOT present in `lots` are appended after a
// `# unmatched (basis-unobserved, gain unstated)` separator comment.

const HEADER =
  "date,asset,side,qty,price,ccy,feeUsd,proceedsUsd,basisUsd,gainUsd,method,provenance,selfTransfer,flags"

const DISCLAIMER = "# PICC tax lots — report only, not tax advice. Verify with your accountant."
const UNMATCHED_SEPARATOR = "# unmatched (basis-unobserved, gain unstated)"

function escape(value) {
  const s = String(value)
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, `""`)}"` : s
}

function cell(value) {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) return escape(value.join("|"))
  return escape(value)
}

function row(lot) {
  return [
    lot.date,
    lot.asset,
    lot.side,
    lot.qty,
    lot.price,
    lot.ccy,
    lot.feeUsd,
    lot.proceedsUsd,
    lot.basisUsd,
    lot.gainUsd,
    lot.method,
    lot.provenance,
    lot.selfTransfer,
    lot.flags ?? [],
  ]
    .map(cell)
    .join(",")
}

export function renderCsv({ lots = [], unmatched = [], method = "FIFO", generatedAt } = {}) {
  const at = generatedAt ?? new Date().toISOString()
  const lines = [DISCLAIMER, `# method: ${method}`, `# generated: ${at}`, HEADER]
  for (const lot of lots) lines.push(row(lot))
  const listed = new Set(lots.map((l) => l?.id))
  const extras = (unmatched ?? []).filter((u) => {
    if (lots.includes(u)) return false
    if (u?.id != null && listed.has(u.id)) return false
    return true
  })
  if (extras.length > 0) {
    lines.push(UNMATCHED_SEPARATOR)
    for (const u of extras) lines.push(row(u))
  }
  return lines.join("\n")
}
