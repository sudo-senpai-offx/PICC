// Lightweight forecast engine for PICC — log-linear trend fitted to Yahoo history
// with volatility-based confidence bands. Deliberately simple and honest: no claims
// of guaranteed results, just a statistically-grounded projection with wide bands.
export function forecastSeries(closes, days = 30) {
  const n = closes.length
  if (n < 10) return null
  const logs = closes.map((c) => Math.log(Math.max(Number(c) || 0, 1e-9)))

  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += logs[i]
    sxx += i * i
    sxy += i * logs[i]
  }
  const denom = n * sxx - sx * sx
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0
  const intercept = (sy - slope * sx) / n

  const resid = logs.map((y, i) => y - (intercept + slope * i))
  const sigma = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / Math.max(1, n - 2))
  const last = Number(closes[n - 1])

  const points = []
  const today = new Date()
  for (let h = 1; h <= days; h++) {
    const d = new Date(today)
    d.setDate(d.getDate() + h)
    const mu = intercept + slope * (n - 1 + h)
    const se = sigma * Math.sqrt(h)
    const price = Math.exp(mu)
    points.push({
      date: d.toISOString().slice(0, 10),
      price,
      lower68: Math.exp(mu - se),
      upper68: Math.exp(mu + se),
      lower95: Math.exp(mu - 1.96 * se),
      upper95: Math.exp(mu + 1.96 * se)
    })
  }

  return {
    last,
    dailyTrend: slope,
    annualized: slope * 365,
    volatility: sigma,
    points
  }
}
