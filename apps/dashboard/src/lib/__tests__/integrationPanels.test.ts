import { describe, expect, it } from "vitest"
import { aggregatePanelModel, spreadPanelModel } from "../integrationPanels"
import type { AggregateResult, SpreadResult } from "../trading"

// T5 acceptance: spread renders n/a (never 0) when <2 venues; measured edge
// carries the AFTER-fee number; aggregate surfaces todayPnl + riskCheck.

const MEASURED: SpreadResult = {
  ok: true,
  assetId: "BTCUSD",
  venuesPolled: [
    { venue: "expertoption", price: 63450 },
    { venue: "ccxt:binance", symbol: "BTC/USDT", price: 63430 }
  ],
  note: "net edge is AFTER ~0.1% taker fees per leg — sub-fee spreads are not opportunities",
  best: {
    buyVenue: "ccxt:binance",
    sellVenue: "expertoption",
    buyPrice: 63430,
    sellPrice: 63450,
    grossPct: 0.032,
    netPct: -0.168,
    opportunity: false
  }
}

const UNMEASURED: SpreadResult = {
  ok: true,
  assetId: "GOLD",
  venuesPolled: [{ venue: "expertoption", price: 2350 }],
  note: "need ≥2 live venues quoting this instrument for a meaningful spread",
  best: null
}

describe("spreadPanelModel (T5)", () => {
  it("renders unmeasured state with a null edge — never a fabricated 0", () => {
    const d = spreadPanelModel(UNMEASURED)
    expect(d.state).toBe("unmeasured")
    expect(d.edgePct).toBeNull()
    expect(d.quoteCount).toBe(1)
    expect(d.opportunity).toBe(false)
  })

  it("renders the measured after-fee edge and both legs", () => {
    const d = spreadPanelModel(MEASURED)
    expect(d.state).toBe("measured")
    if (d.state !== "measured") throw new Error("expected measured")
    expect(d.edgePct).toBe(-0.168)
    expect(d.opportunity).toBe(false)
    expect(d.best).toMatchObject({ buyVenue: "ccxt:binance", sellVenue: "expertoption", grossPct: 0.032 })
    expect(d.quotes).toHaveLength(2)
  })

  it("carries a negative after-fee edge honestly (fees eat the gross spread)", () => {
    const d = spreadPanelModel(MEASURED)
    expect(d.edgePct).toBeLessThan(0)
    expect(d.opportunity).toBe(false)
  })
})

const AGG: AggregateResult = {
  ok: true,
  generatedAt: "2026-08-31T00:00:00.000Z",
  positions: [
    { venue: "paper", id: "p1", symbol: "EURUSD", side: "up", entry: 1.08, amount: 100, openedAt: "2026-08-30T10:00:00Z" }
  ],
  byInstrument: {
    EURUSD: { symbol: "EURUSD", totalSize: 100, positions: 1, avgEntry: 1.08, venues: ["paper"], hedged: false }
  },
  venues: [{ venue: "paper", totalSize: 100, positions: 1 }],
  totals: { openPositions: 1, notional: 100, instruments: 1 },
  todayPnl: {
    paper: { pnl: 12.5, trades: 2 },
    expertoption: { pnl: -4.5, trades: 1 },
    total: { pnl: 8, trades: 3 }
  },
  riskCheck: {
    ok: true,
    allowed: true,
    warnings: [],
    proposed: { symbol: "EURUSD", amount: 200 },
    after: { totalNotional: 300 },
    todayPnl: { pnl: 8, trades: 3 },
    exposureByInstrument: { EURUSD: 100 }
  }
}

describe("aggregatePanelModel (T5)", () => {
  it("surfaces totals + observed today PnL", () => {
    const d = aggregatePanelModel(AGG)
    expect(d.totals).toEqual({ openPositions: 1, notional: 100, instruments: 1 })
    expect(d.todayPnl).toEqual({ pnl: 8, trades: 3 })
  })

  it("passes the risk check verdict verbatim", () => {
    const d = aggregatePanelModel(AGG)
    expect(d.riskCheck).toMatchObject({ allowed: true, warnings: [], proposedSymbol: "EURUSD", afterNotional: 300 })
  })

  it("reports no risk check when none was requested", () => {
    const d = aggregatePanelModel({ ...AGG, riskCheck: null })
    expect(d.riskCheck).toBeNull()
  })
})