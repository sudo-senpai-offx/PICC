import { describe, expect, it } from "vitest"
import { aggregatePanelModel, capabilitiesPanelModel, metricsPanelModel, spreadPanelModel } from "../integrationPanels"
import type { AccountMetricsResult, AggregateResult, SpreadResult, SystemCapabilitiesResult } from "../trading"

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

// ---------------------------------------------------------------------
// T6 — account metrics + capabilities models
// ---------------------------------------------------------------------

const METRICS_EMPTY: AccountMetricsResult = { ok: true, userId: "u1", venues: {} }

const METRICS_FULL: AccountMetricsResult = {
  ok: true,
  userId: "u1",
  venues: {
    expertoption: {
      demoWallet: { balance: 0, currency: "USD" }, // genuine observed 0 — must stay 0
      realWallet: { balance: null, currency: "USD" },
      active: "demo",
      currency: "USD",
      balance: 0,
      demo: true,
      email: null,
      name: null,
      openPositions: null,
      exposurePct: null,
      venueId: "expertoption",
      sourceLeg: "ws",
      observedAt: "2026-08-31T10:00:00.000Z",
      stale: true
    },
    binance: {
      demoWallet: { balance: null, currency: "USD" },
      realWallet: { balance: null, currency: "USD" },
      active: null,
      currency: "USD",
      balance: 4250.5,
      demo: null,
      email: "a@b.c",
      name: null,
      openPositions: null,
      exposurePct: null,
      venueId: "binance",
      sourceLeg: "ws",
      observedAt: "2026-08-31T10:05:00.000Z",
      stale: false
    }
  }
}

describe("metricsPanelModel (T6)", () => {
  it("reports honest empty state when no venue has ever been observed", () => {
    const d = metricsPanelModel(METRICS_EMPTY)
    expect(d.observedVenueCount).toBe(0)
    expect(d.venues).toEqual([])
  })

  it("keeps a genuine observed 0 as 0 and an absent balance as null", () => {
    const d = metricsPanelModel(METRICS_FULL)
    const eo = d.venues.find((v) => v.venueId === "expertoption")!
    expect(eo.balance).toBe(0) // a real zero is not nulled out
    const binance = d.venues.find((v) => v.venueId === "binance")!
    expect(binance.balance).toBe(4250.5)
    expect(binance.stale).toBe(false)
    expect(eo.stale).toBe(true)
    expect(eo.active).toBe("demo")
  })
})

const CAPS: SystemCapabilitiesResult = {
  ok: true,
  arch: "x64",
  platform: "win32",
  node: "v22.0.0",
  browserFound: true,
  extensionSensor: { seen: false, lastSeen: null },
  notifierChannels: { inApp: true, webpush: true },
  signalEngine: true,
  uptime: 4321
}

describe("capabilitiesPanelModel (T6)", () => {
  it("reports the extension sensor absent honestly — never a claimed session", () => {
    const d = capabilitiesPanelModel(CAPS)!
    expect(d.sensorSeen).toBe(false)
    expect(d.sensorLastSeen).toBeNull()
  })

  it("passes notifier channel configuration through (unconfigured stays false)", () => {
    const d = capabilitiesPanelModel(CAPS)!
    expect(d.notifierChannels).toEqual({ inApp: true, webpush: true })
  })

  it("returns null when the probe did not succeed", () => {
    expect(capabilitiesPanelModel({ ok: false } as SystemCapabilitiesResult)).toBeNull()
  })
})