// Owner journal → corpus state-bucket mapper (§5.2/§8 decision-1).
// PURE: no I/O, no store imports, no LLM, deterministic. Translates owner
// trade-journal rows into the external `stateBefore` bucket vocabulary so
// `behaviourGivenState` ownerComparability is evaluable.
//
// Bucket table (derived STATE only — never identity, never outcome-selection):
//   drawdown-5pct  — drawdown-from-peak >= 5% before this row, where peak is
//                    the running max of cumulative closed-trade pnl floored at
//                    0, i.e. ddPct = (peak - cumBefore) / peak * 100. An
//                    explicit numeric `drawdownPctBefore` (or `drawdownPct`)
//                    field on the row, when present, is used directly.
//                    Overrides streak/win buckets (stress state dominates).
//   after-2-losses — 2+ consecutive prior closed losses (pnl < 0).
//   after-1-loss   — exactly 1 consecutive prior closed loss.
//   after-win      — last prior closed trade was a win (pnl > 0).
//   unknown        — unmappable: no mappable prior (first row, only open /
//                    breakeven / non-numeric priors, or the row itself carries
//                    no usable history). NEVER invented from `pattern` /
//                    `strategy` identity strings.
// Breakeven (pnl === 0) breaks loss streaks but is not a win.
// History = prior CLOSED rows in ascending entryTime order (ties keep input
// order); open rows (pnl null/NaN) neither contribute to history nor block it.
const DRAWDOWN_BAND_PCT = 5

const finite = (v) => typeof v === "number" && Number.isFinite(v)

function historyPnl(row) {
  if (!row || typeof row !== "object") return null
  if (row.status === "open") return null
  const pnl = typeof row.pnl === "number" ? row.pnl : Number(row.pnl)
  if (row.pnl == null || !finite(pnl)) return null
  return pnl
}

function explicitDrawdownPct(row) {
  for (const k of ["drawdownPctBefore", "drawdownPct"]) {
    const v = Number(row?.[k])
    if (row?.[k] != null && finite(v)) return v
  }
  return null
}

function timeOf(row, idx) {
  const t = Number(row?.entryTime)
  return finite(t) ? t : Number.MAX_SAFE_INTEGER - 1000 + idx
}

export function ownerRowsToStates(journalRows = []) {
  if (!Array.isArray(journalRows) || journalRows.length === 0) return []
  const ordered = journalRows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => timeOf(a.row, a.idx) - timeOf(b.row, b.idx) || a.idx - b.idx)
    .map((w) => w.row)

  let cum = 0
  let peak = 0
  let lossStreak = 0
  let lastClosedPnl = null
  const byRow = new Map()

  for (const row of ordered) {
    const ddExplicit = row && typeof row === "object" ? explicitDrawdownPct(row) : null
    const ddComputed = peak > 0 ? ((peak - cum) / peak) * 100 : 0
    const ddPct = ddExplicit ?? ddComputed
    let stateBefore = "unknown"
    if (ddPct >= DRAWDOWN_BAND_PCT) stateBefore = "drawdown-5pct"
    else if (lossStreak >= 2) stateBefore = "after-2-losses"
    else if (lossStreak === 1) stateBefore = "after-1-loss"
    else if (lastClosedPnl != null && lastClosedPnl > 0) stateBefore = "after-win"
    byRow.set(row, { stateBefore })

    const pnl = historyPnl(row)
    if (pnl != null) {
      cum += pnl
      if (cum > peak) peak = cum
      if (pnl < 0) lossStreak += 1
      else lossStreak = 0
      lastClosedPnl = pnl
    }
  }
  return journalRows.map((row) => byRow.get(row) ?? { stateBefore: "unknown" })
}
