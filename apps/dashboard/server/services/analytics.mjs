// PICC trading analytics — pure, dependency-free statistics over closed-trade
// records so the paper ledger and the demo-deal history can be compared on the
// same terms. Every function is a pure transform of `{ pnl, symbol, closedAt }`
// shaped rows; nothing here does I/O, which keeps it trivially unit-testable.

const DAY_MS = 86400000

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

/**
 * Build the equity curve from a starting balance and a chronological list of
 * closed trades. Trades are ordered oldest -> newest (caller responsibility).
 * @param {Array<{pnl:number}>} closed
 * @param {number} starting
 * @returns {Array<{t:string, pnl:number, equity:number}>}
 */
export function equitySeries(closed, starting = 0) {
  let equity = num(starting)
  const out = [{ t: null, pnl: 0, equity: Math.round(equity * 100) / 100 }]
  for (const c of closed) {
    equity += num(c.pnl)
    out.push({
      t: c.closedAt ?? null,
      pnl: Math.round(num(c.pnl) * 100) / 100,
      equity: Math.round(equity * 100) / 100
    })
  }
  return out
}

/**
 * Drawdown series over an equity curve (already oldest -> newest). Returns the
 * drawdown below the running peak for each point, as a positive percentage.
 */
export function drawdownSeries(equityPoints) {
  const points = Array.isArray(equityPoints) ? equityPoints : []
  let peak = -Infinity
  return points.map((p) => {
    peak = Math.max(peak, num(p.equity))
    const dd = peak > 0 ? ((peak - num(p.equity)) / peak) * 100 : 0
    return {
      t: p.t,
      equity: p.equity,
      peak,
      drawdown: Math.round(dd * 100) / 100,
      drawdownDollars: Math.round((peak - num(p.equity)) * 100) / 100
    }
  })
}

/** Longest winning and losing streak by count, plus the current streak. */
export function streaks(closed) {
  let maxWin = 0
  let maxLoss = 0
  let curWin = 0
  let curLoss = 0
  for (const c of closed) {
    if (num(c.pnl) > 0) {
      curWin += 1
      curLoss = 0
      maxWin = Math.max(maxWin, curWin)
    } else if (num(c.pnl) < 0) {
      curLoss += 1
      curWin = 0
      maxLoss = Math.max(maxLoss, curLoss)
    }
  }
  return { maxWin, maxLoss, currentWin: curWin, currentLoss: curLoss }
}

/**
 * Risk + performance metrics over a closed-trade list.
 * @param {Array<{pnl:number, symbol?:string, closedAt?:string}>} closed  oldest -> newest
 * @param {number} starting
 */
export function metricsFrom(closed, starting = 0) {
  const rows = Array.isArray(closed) ? closed : []
  const pnls = rows.map((c) => num(c.pnl))
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const grossProfit = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
  const net = pnls.reduce((a, b) => a + b, 0)
  const count = pnls.length

  const equity = equitySeries(rows, starting)
  const ddSeries = drawdownSeries(equity)
  const maxDrawdown = ddSeries.length ? Math.max(...ddSeries.map((d) => d.drawdown)) : 0
  const maxDrawdownDollars = ddSeries.length ? Math.max(...ddSeries.map((d) => d.drawdownDollars)) : 0

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const std = (xs) => {
    if (xs.length < 2) return 0
    const m = mean(xs)
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1))
  }

  // Trade-level Sharpe, annualized by trade frequency over the observed span.
  let annualizedSharpe = null
  let perTradeSharpe = null
  if (count > 1 && std(pnls) > 0) {
    perTradeSharpe = Math.round((mean(pnls) / std(pnls)) * 100) / 100
    const ts = rows.map((c) => new Date(c.closedAt ?? 0).getTime()).filter((t) => t > 0)
    const years = ts.length > 1 ? Math.max(1 / 365, (Math.max(...ts) - Math.min(...ts)) / (DAY_MS * 365)) : 1
    annualizedSharpe = Math.round(perTradeSharpe * Math.sqrt(count / years) * 100) / 100
  }

  const monthly = {}
  for (const c of rows) {
    const key = String(c.closedAt ?? "").slice(0, 7)
    if (!key) continue
    if (!monthly[key]) monthly[key] = { month: key, trades: 0, pnl: 0, wins: 0 }
    monthly[key].trades += 1
    monthly[key].pnl = Math.round((monthly[key].pnl + num(c.pnl)) * 100) / 100
    if (num(c.pnl) > 0) monthly[key].wins += 1
  }
  const monthlyList = Object.values(monthly)
    .map((m) => ({ ...m, winRate: m.trades ? Math.round((m.wins / m.trades) * 100) : null }))
    .sort((a, b) => (a.month < b.month ? -1 : 1))

  const perSymbol = {}
  for (const c of rows) {
    const sym = String(c.symbol || "UNKNOWN").toUpperCase()
    if (!perSymbol[sym]) perSymbol[sym] = { symbol: sym, trades: 0, pnl: 0, wins: 0 }
    perSymbol[sym].trades += 1
    perSymbol[sym].pnl = Math.round((perSymbol[sym].pnl + num(c.pnl)) * 100) / 100
    if (num(c.pnl) > 0) perSymbol[sym].wins += 1
  }
  const perSymbolList = Object.values(perSymbol)
    .map((s) => ({ ...s, winRate: s.trades ? Math.round((s.wins / s.trades) * 100) : null }))
    .sort((a, b) => b.pnl - a.pnl)

  return {
    trades: count,
    starting: Math.round(num(starting) * 100) / 100,
    netProfit: Math.round(net * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : (grossProfit > 0 ? null : 0),
    winRate: count ? Math.round((wins.length / count) * 100) : null,
    avgWin: wins.length ? Math.round((mean(wins)) * 100) / 100 : null,
    avgLoss: losses.length ? Math.round(mean(losses) * 100) / 100 : null,
    expectancy: count ? Math.round(mean(pnls) * 100) / 100 : null,
    totalReturnPct: num(starting) > 0 ? Math.round((net / num(starting)) * 10000) / 100 : null,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownDollars: Math.round(maxDrawdownDollars * 100) / 100,
    best: count ? Math.max(...pnls) : null,
    worst: count ? Math.min(...pnls) : null,
    avgHoldMs: rows.length ? Math.round(rows.reduce((a, c) => a + num(c.holdingMs), 0) / rows.length) : null,
    perTradeSharpe,
    annualizedSharpe,
    ...streaks(rows),
    monthly: monthlyList,
    perSymbol: perSymbolList,
    equity: equity,
    drawdown: ddSeries
  }
}
