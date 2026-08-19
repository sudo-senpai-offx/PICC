import { useState, useCallback, useEffect } from "react"
import { Card, Button } from "@/components/ui"
import { getPortfolioAnalytics, type PortfolioAnalytics } from "@/lib/trading"

const DEFAULT_SYMBOLS = ["EURUSD", "GOLD", "BTCUSD", "AAPL"]

const SEGMENT_COLORS = [
  "#6c63ff", "#4ade80", "#ff6b6b", "#f59e0b", "#06b6d4",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1"
]

function corrColor(value: number) {
  if (value >= 0.7) return "#ff4444"
  if (value >= 0.3) return "#ff8800"
  if (value >= 0) return "#ffcc00"
  if (value >= -0.3) return "#88cc00"
  if (value >= -0.7) return "#44bb00"
  return "#00aa44"
}

function DonutChart({ assets }: { assets: { symbol: string; weight: number }[] }) {
  const total = assets.reduce((s, a) => s + a.weight, 0) || 1
  const R = 42
  const CIRCUMFERENCE = 2 * Math.PI * R
  let cumOffset = 0

  return (
    <div style={{ position: "relative", width: 120, height: 120 }}>
      <svg viewBox="0 0 120 120" style={{ width: 120, height: 120, transform: "rotate(-90deg)" }}>
        {assets.map((a, i) => {
          const dash = (a.weight / total) * CIRCUMFERENCE
          const gap = CIRCUMFERENCE - dash
          const offset = -cumOffset
          cumOffset += dash
          return (
            <circle
              key={a.symbol}
              cx="60" cy="60" r={R}
              fill="none"
              stroke={SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
              strokeWidth="20"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dasharray 0.3s" }}
            />
          )
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>
        {assets.length}
      </div>
    </div>
  )
}

export function PortfolioPanel() {
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS.join(", "))
  const [data, setData] = useState<PortfolioAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(90)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const syms = symbols.split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      if (syms.length === 0) return
      const res = await getPortfolioAnalytics(syms, undefined, days)
      if (res.ok) setData(res)
    } catch { /* ignore */ }
    setLoading(false)
  }, [symbols, days])

  useEffect(() => { refresh() }, [])

  const m = data?.metrics
  const assets = data?.assets ?? []
  const corr = data?.corrMatrix ?? []

  const metricColor = (v: number, inverse = false) => {
    if (inverse) return v > 10 ? "#ff6b6b" : v > 5 ? "#f59e0b" : "#4ade80"
    return v > 1 ? "#4ade80" : v > 0 ? "#f59e0b" : "#ff6b6b"
  }

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Portfolio Analytics</div>
        <div className="row gap" style={{ alignItems: "center" }}>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ padding: "2px 6px", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, color: "var(--text)" }}
          >
            <option value={30}>30D</option>
            <option value={60}>60D</option>
            <option value={90}>90D</option>
            <option value={180}>180D</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <input
          value={symbols}
          onChange={(e) => setSymbols(e.target.value)}
          placeholder="Symbols (comma separated)"
          style={{ flex: 1, padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
        />
        <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
          {loading ? "Loading..." : "Analyze"}
        </Button>
      </div>

      {data && (
        <>
          {/* Diversification Score + Key Metrics */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Card style={{ flex: "0 0 130px", padding: 8, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Diversification</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: data.diversificationScore > 60 ? "#4ade80" : data.diversificationScore > 30 ? "#f59e0b" : "#ff6b6b" }}>
                {data.diversificationScore}
              </div>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>/100</div>
            </Card>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
              {[
                { label: "Sharpe", value: m?.sharpeRatio?.toFixed(2), color: metricColor(m?.sharpeRatio ?? 0) },
                { label: "Sortino", value: m?.sortinoRatio?.toFixed(2), color: metricColor(m?.sortinoRatio ?? 0) },
                { label: "Max DD", value: `${m?.maxDrawdown?.toFixed(1)}%`, color: metricColor(m?.maxDrawdown ?? 0, true) },
                { label: "VaR 95%", value: `${m?.valueAtRisk95?.toFixed(2)}%`, color: metricColor(m?.valueAtRisk95 ?? 0, true) },
                { label: "Vol", value: `${m?.stdDev?.toFixed(1)}%`, color: metricColor(m?.stdDev ?? 0, true) },
                { label: "Return", value: `${m?.totalReturn?.toFixed(1)}%`, color: metricColor(m?.totalReturn ?? 0) },
              ].map((item) => (
                <div key={item.label} style={{ padding: 4, borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{item.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Allocation Donut + Position Table */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <DonutChart assets={assets} />
            <div style={{ flex: 1, overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "2px 4px" }}>Asset</th>
                    <th style={{ textAlign: "right", padding: "2px 4px" }}>Wt%</th>
                    <th style={{ textAlign: "right", padding: "2px 4px" }}>Last</th>
                    <th style={{ textAlign: "right", padding: "2px 4px" }}>Chg%</th>
                    <th style={{ textAlign: "right", padding: "2px 4px" }}>Vol%</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a, i) => (
                    <tr key={a.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "2px 4px" }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: SEGMENT_COLORS[i % SEGMENT_COLORS.length], marginRight: 4 }} />
                        {a.symbol}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 4px" }}>{a.weight.toFixed(1)}</td>
                      <td style={{ textAlign: "right", padding: "2px 4px" }}>{a.lastPrice.toFixed(4)}</td>
                      <td style={{ textAlign: "right", padding: "2px 4px", color: a.change24h >= 0 ? "#4ade80" : "#ff6b6b" }}>
                        {a.change24h >= 0 ? "+" : ""}{a.change24h.toFixed(2)}%
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 4px", color: "var(--text-muted)" }}>{a.dailyReturnVol.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Correlation Matrix */}
          {corr.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Correlation Matrix</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "2px 4px" }}></th>
                      {assets.map((a) => (
                        <th key={a.symbol} style={{ padding: "2px 4px", textAlign: "center", color: "var(--text-muted)", fontWeight: 400 }}>{a.symbol}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a, i) => (
                      <tr key={a.symbol}>
                        <td style={{ padding: "2px 4px", color: "var(--text-muted)", fontWeight: 600 }}>{a.symbol}</td>
                        {assets.map((b, j) => (
                          <td
                            key={b.symbol}
                            style={{
                              padding: "2px 6px",
                              textAlign: "center",
                              background: i === j ? "var(--border)" : corrColor(corr[i][j]),
                              color: i === j ? "var(--text-muted)" : "#fff",
                              fontWeight: i === j ? 400 : 600,
                              borderRadius: 2
                            }}
                          >
                            {i === j ? "1.0" : corr[i][j]?.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4, textAlign: "right" }}>
            Avg corr: {data.avgCorrelation?.toFixed(3)} | {data.assetCount} assets | {data.days}D window
          </div>
        </>
      )}

      {!data && !loading && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
          Enter symbols above and click Analyze
        </div>
      )}
    </Card>
  )
}
