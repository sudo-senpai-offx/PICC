import { describe, expect, it } from "vitest"
import { equitySeries, drawdownSeries, streaks, metricsFrom } from "../services/analytics.mjs"

const closed = [
  { pnl: 10, symbol: "EURUSD", closedAt: "2026-01-05T10:00:00.000Z" },
  { pnl: -5, symbol: "EURUSD", closedAt: "2026-01-06T10:00:00.000Z" },
  { pnl: 10, symbol: "BTCUSD", closedAt: "2026-01-07T10:00:00.000Z" },
  { pnl: 10, symbol: "BTCUSD", closedAt: "2026-01-08T10:00:00.000Z" },
  { pnl: -20, symbol: "EURUSD", closedAt: "2026-01-09T10:00:00.000Z" },
  { pnl: 8, symbol: "EURUSD", closedAt: "2026-01-10T10:00:00.000Z" }
]

describe("equitySeries", () => {
  it("starts at the starting balance and compounds pnl chronologically", () => {
    const series = equitySeries(closed, 1000)
    expect(series).toHaveLength(closed.length + 1)
    expect(series[0].equity).toBe(1000)
    expect(series[1].equity).toBe(1010)
    expect(series[5].equity).toBe(1005)
    expect(series[6].equity).toBe(1013)
  })

  it("handles empty input", () => {
    expect(equitySeries([], 500)).toEqual([{ t: null, pnl: 0, equity: 500 }])
  })
})

describe("drawdownSeries", () => {
  it("tracks the decline from the running peak", () => {
    const dd = drawdownSeries(equitySeries(closed, 1000))
    // Equity: 1000, 1010, 1005, 1015, 1025, 1005, 1013.
    // Peak is 1025 (after the 4th trade); trough is 1005 (after the 5th).
    const trough = dd[5]
    expect(trough.peak).toBe(1025)
    expect(trough.drawdown).toBeCloseTo((20 / 1025) * 100, 1)
    expect(trough.drawdownDollars).toBe(20)
  })
})

describe("streaks", () => {
  it("finds the longest and current win/loss streaks", () => {
    const s = streaks(closed)
    expect(s.maxWin).toBe(2) // trades 3+4
    expect(s.maxLoss).toBe(1) // single losses
    expect(s.currentWin).toBe(1) // last trade won
    expect(s.currentLoss).toBe(0)
  })
})

describe("metricsFrom", () => {
  const m = metricsFrom(closed, 1000)

  it("computes headline figures", () => {
    expect(m.trades).toBe(6)
    expect(m.netProfit).toBe(13)
    expect(m.grossProfit).toBe(38)
    expect(m.grossLoss).toBe(25)
    expect(m.profitFactor).toBeCloseTo(38 / 25, 2)
    expect(m.winRate).toBe(67)
    expect(m.totalReturnPct).toBeCloseTo(1.3, 1)
    expect(m.best).toBe(10)
    expect(m.worst).toBe(-20)
  })

  it("computes expectancy and average win/loss", () => {
    expect(m.expectancy).toBeCloseTo(13 / 6, 2)
    expect(m.avgWin).toBeCloseTo(38 / 4, 2)
    expect(m.avgLoss).toBeCloseTo(-12.5, 2)
  })

  it("computes drawdown in percent and dollars", () => {
    expect(m.maxDrawdown).toBeCloseTo((20 / 1025) * 100, 1)
    expect(m.maxDrawdownDollars).toBe(20)
  })

  it("groups monthly and per-symbol performance", () => {
    expect(m.monthly).toHaveLength(1)
    expect(m.monthly[0].pnl).toBe(13)
    expect(m.monthly[0].winRate).toBe(67)
    expect(m.perSymbol).toHaveLength(2)
    const eur = m.perSymbol.find((s) => s.symbol === "EURUSD")
    expect(eur.trades).toBe(4)
    expect(eur.pnl).toBe(-7) // 10 − 5 − 20 + 8
  })

  it("reports no-trade metrics without throwing", () => {
    const empty = metricsFrom([], 500)
    expect(empty.trades).toBe(0)
    expect(empty.winRate).toBe(null)
    expect(empty.profitFactor).toBe(0)
    expect(empty.maxDrawdown).toBe(0)
  })

  it("reports a null profit factor for all-winning books", () => {
    const allWin = metricsFrom([{ pnl: 5, closedAt: "2026-01-05T00:00:00.000Z" }], 100)
    expect(allWin.grossLoss).toBe(0)
    expect(allWin.profitFactor).toBe(null)
    expect(allWin.totalReturnPct).toBe(5)
  })

  it("exposes sharpe when there is variance", () => {
    expect(m.perTradeSharpe).toBeTypeOf("number")
    expect(m.annualizedSharpe).toBeTypeOf("number")
  })
})
