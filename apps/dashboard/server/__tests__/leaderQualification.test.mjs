// WS-4 T2 — F3 qualification (WS-4 R4.1/R4.2/AC-2). Pure qualifier over
// analytics.metricsFrom; verdict qualified iff trades ≥ 300 AND maxDrawdown < 15
// AND expectancy > 0 on net-of-costs rows; each shortfall is a verbatim-stable
// named deny, first-deny wins (order: trades, mdd, expectancy). Boundary and
// zero-row cases first.
import { describe, expect, test } from "vitest"

import { metricsFrom } from "../services/analytics.mjs"
import { qualifyLeader } from "../services/copytrade/leaderQualification.mjs"

// Build `[count, pnl]` segments into a net-of-costs row list (oldest first).
const raws = (segments) => {
  const rows = []
  for (const [count, pnl] of segments) {
    for (let i = 0; i < count; i += 1) rows.push({ pnlAfterCosts: pnl, closedAt: "2026-09-01T00:00:00.000Z" })
  }
  return rows
}

// Manual peak-anchored MDD pct over pnl rows — same formula family as
// riskState.drawdownFromPeakPct = (runningPeak - equity) / runningPeak * 100.
const manualMaxDrawdownPct = (rows, starting = 0) => {
  let equity = starting
  let peak = -Infinity
  let max = 0
  for (const r of rows) {
    equity += Number(r.pnlAfterCosts)
    peak = Math.max(peak, equity)
    if (peak > 0) max = Math.max(max, ((peak - equity) / peak) * 100)
  }
  return Math.round(max * 100) / 100
}

describe("leader qualification (F3)", () => {
  test("zero rows → denied leader:deny:trades-short (have 0, require 300)", () => {
    expect(qualifyLeader([])).toEqual({ verdict: "denied", deny: "leader:deny:trades-short (have 0, require 300)" })
  })

  test("299 rows → denied leader:deny:trades-short (have 299, require 300)", () => {
    expect(qualifyLeader(raws([[299, 1]]))).toEqual({ verdict: "denied", deny: "leader:deny:trades-short (have 299, require 300)" })
  })

  test("boundary MDD exactly 15% with ≥300 trades and positive expectancy → leader:deny:mdd-over (have 15%, require <15)", () => {
    // 300 trades: 250× +400 to a 100000 peak, 50× -300 to an 85000 trough → 15.00%.
    const r = qualifyLeader(raws([[250, 400], [50, -300]]))
    expect(r.verdict).toBe("denied")
    expect(r.deny).toBe("leader:deny:mdd-over (have 15%, require <15)")
  })

  test("boundary expectancy exactly 0 with ≥300 trades and no drawdown → leader:deny:expectancy-nonpositive (have 0)", () => {
    expect(qualifyLeader(raws([[300, 0]]))).toEqual({ verdict: "denied", deny: "leader:deny:expectancy-nonpositive (have 0)" })
  })

  test("negative expectancy (net-losing trade list) → leader:deny:expectancy-nonpositive (have -1)", () => {
    expect(qualifyLeader(raws([[300, -1]]))).toEqual({ verdict: "denied", deny: "leader:deny:expectancy-nonpositive (have -1)" })
  })

  test("MDD mid-range breach (>15%) denies with mdd-over first even when trades are long", () => {
    const r = qualifyLeader(raws([[200, 500], [100, -250]]))
    expect(r.verdict).toBe("denied")
    expect(r.deny).toBe("leader:deny:mdd-over (have 25%, require <15)")
  })

  test("qualified: 300+ trades, mdd just under 15%, positive expectancy → { verdict: qualified, deny: null }", () => {
    const r = qualifyLeader(raws([[250, 400], [50, -299.8]]))
    expect(r).toEqual({ verdict: "qualified", deny: null })
  })

  test("cross-check fixture: analytics maxDrawdown equals a manual peak-anchored recompute (drawdownFromPeakPct semantics)", () => {
    const peakRows = [
      { pnlAfterCosts: 100 },
      { pnlAfterCosts: -50 },
      { pnlAfterCosts: 200 },
      { pnlAfterCosts: -150 },
      { pnlAfterCosts: 50 }
    ]
    const m = metricsFrom(peakRows.map((r) => ({ pnl: Number(r.pnlAfterCosts) })))
    // equity: 0 → 100 → 50 → 250 → 100 → 150; running peak 250; max dd 60% at 100.
    expect(m.maxDrawdown).toBe(60)
    expect(m.maxDrawdown).toBe(manualMaxDrawdownPct(peakRows))
    // The qualifier itself reuses metricsFrom — the same peaked fixture denies on trades first (2 trades).
    expect(qualifyLeader(peakRows).deny).toBe("leader:deny:trades-short (have 5, require 300)")
  })

  test("non-array input is treated as an empty feed → trades-short have 0", () => {
    expect(qualifyLeader(null)).toEqual({ verdict: "denied", deny: "leader:deny:trades-short (have 0, require 300)" })
    expect(qualifyLeader({ rows: [{ pnlAfterCosts: 1 }] }).deny).toBeTruthy()
  })

  test("rows with pnlAfterCosts null coerce to 0 pnl (qualified trust contract, importer guards costs)", () => {
    const rows = Array.from({ length: 300 }, () => ({ pnlAfterCosts: null, closedAt: "2026-09-01T00:00:00.000Z" }))
    expect(qualifyLeader(rows)).toEqual({ verdict: "denied", deny: "leader:deny:expectancy-nonpositive (have 0)" })
  })

  test("a small net-negative expectancy still denies (have -0.02), never rounding to a pass", () => {
    // 250× -1 then 50× +4.9 → net -5 over 300 rows, mdd 0 (peak anchored at the 0 start) → expectancy deny.
    expect(qualifyLeader(raws([[250, -1], [50, 4.9]]))).toEqual({
      verdict: "denied",
      deny: "leader:deny:expectancy-nonpositive (have -0.02)"
    })
  })
})