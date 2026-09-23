// WS-4 F3 — pure qualifier over analytics.metricsFrom; verifies 300 trades / <15% MDD / +ve expectancy after costs.

import { metricsFrom } from "../analytics.mjs"

export const LEADER_MIN_TRADES = 300
export const LEADER_MAX_MDD_PCT = 15

const round2 = (x) => Math.round(Number(x) * 100) / 100

export function qualifyLeader(rows) {
  const closed = (Array.isArray(rows) ? rows : []).map((r) => ({
    pnl: Number(r.pnlAfterCosts),
    closedAt: r.closedAt
  }))
  const m = metricsFrom(closed)

  const trades = m.trades
  if (trades < LEADER_MIN_TRADES) {
    return { verdict: "denied", deny: `leader:deny:trades-short (have ${trades}, require ${LEADER_MIN_TRADES})` }
  }

  const mdd = round2(m.maxDrawdown)
  if (mdd >= LEADER_MAX_MDD_PCT) {
    return { verdict: "denied", deny: `leader:deny:mdd-over (have ${mdd}%, require <${LEADER_MAX_MDD_PCT})` }
  }

  const expectancy = round2(m.expectancy)
  if (!(expectancy > 0)) {
    return { verdict: "denied", deny: `leader:deny:expectancy-nonpositive (have ${expectancy})` }
  }

  return { verdict: "qualified", deny: null }
}