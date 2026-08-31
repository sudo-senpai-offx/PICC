// Pure display models for the T5 integration panels (spread + aggregate).
// Extracted so honesty rules are unit-testable without a React DOM harness:
//   - an unmeasured spread renders "n/a", NEVER a fabricated 0 edge;
//   - an empty portfolio renders "no open positions", never a fake zero entry;
//   - the risk check mirrors the server's allowed/warnings verdict verbatim.

import type { AggregateResult, SpreadResult } from "./trading"

export type SpreadDisplay =
  | {
      state: "unmeasured"
      quoteCount: number
      note: string
      edgePct: null
      opportunity: false
    }
  | {
      state: "measured"
      quoteCount: number
      quotes: { venue: string; price: number }[]
      edgePct: number
      opportunity: boolean
      best: { buyVenue: string; sellVenue: string; buyPrice: number; sellPrice: number; grossPct: number }
      note: string
    }

export function spreadPanelModel(res: SpreadResult): SpreadDisplay {
  const quoteCount = res.venuesPolled.length
  if (quoteCount < 2 || !res.best) {
    return { state: "unmeasured", quoteCount, note: res.note, edgePct: null, opportunity: false }
  }
  return {
    state: "measured",
    quoteCount,
    quotes: res.venuesPolled.map((q) => ({ venue: q.venue, price: q.price })),
    edgePct: res.best.netPct,
    opportunity: res.best.opportunity,
    best: {
      buyVenue: res.best.buyVenue,
      sellVenue: res.best.sellVenue,
      buyPrice: res.best.buyPrice,
      sellPrice: res.best.sellPrice,
      grossPct: res.best.grossPct
    },
    note: res.note
  }
}

export interface AggregateDisplay {
  totals: { openPositions: number; notional: number; instruments: number }
  todayPnl: { pnl: number; trades: number } | null
  riskCheck: {
    allowed: boolean
    warnings: string[]
    proposedSymbol: string | null
    afterNotional: number | null
  } | null
}

export function aggregatePanelModel(res: AggregateResult): AggregateDisplay {
  return {
    totals: res.totals,
    // todayPnl.total is a real observed ledger aggregation — when nothing
    // traded today it is genuinely 0 trades / 0 pnl, which is honest.
    todayPnl: res.todayPnl?.total ?? null,
    riskCheck: res.riskCheck
      ? {
          allowed: res.riskCheck.allowed,
          warnings: res.riskCheck.warnings,
          proposedSymbol: res.riskCheck.proposed?.symbol ?? null,
          afterNotional: res.riskCheck.after?.totalNotional ?? null
        }
      : null
  }
}