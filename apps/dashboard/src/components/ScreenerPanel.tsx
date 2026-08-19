import { useState, useCallback, useEffect } from "react"
import { Card, Button } from "@/components/ui"
import { screenerRun, type WatchlistItem } from "@/lib/trading"

const SORT_OPTIONS = [
  { value: "change24h", label: "24h Change" },
  { value: "changeWeek", label: "Week Change" },
  { value: "changeMonth", label: "Month Change" },
  { value: "volume", label: "Volume" },
  { value: "last", label: "Price" },
  { value: "symbol", label: "Symbol" },
]

export function ScreenerPanel() {
  const [results, setResults] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState("change24h")
  const [limit, setLimit] = useState(20)
  const [total, setTotal] = useState(0)
  const [universe, setUniverse] = useState(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await screenerRun({ sort, limit })
      setResults(res.results)
      setTotal(res.total)
      setUniverse(res.universe)
    } catch { /* ignore */ }
    setLoading(false)
  }, [sort, limit])

  useEffect(() => { refresh() }, [])

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Market Screener</div>
        <div className="row gap" style={{ alignItems: "center" }}>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{ padding: "2px 6px", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, color: "var(--text)" }}
          >
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{ padding: "2px 6px", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, color: "var(--text)" }}
          >
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={30}>Top 30</option>
          </select>
          <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "2px 10px" }}>
            {loading ? "..." : "Scan"}
          </Button>
        </div>
      </div>

      <div style={{ maxHeight: 240, overflowY: "auto" }}>
        <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "2px 4px" }}>#</th>
              <th style={{ textAlign: "left", padding: "2px 4px" }}>Symbol</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>Last</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>24h%</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>Week%</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>Month%</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>30d Range</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "2px 4px", color: "var(--text-muted)" }}>{i + 1}</td>
                <td style={{ padding: "2px 4px", fontWeight: 600 }}>{r.symbol}</td>
                <td style={{ textAlign: "right", padding: "2px 4px" }}>{r.last?.toFixed(4)}</td>
                <td style={{ textAlign: "right", padding: "2px 4px", color: r.change24h >= 0 ? "#4ade80" : "#ff6b6b", fontWeight: 600 }}>
                  {r.change24h >= 0 ? "+" : ""}{r.change24h?.toFixed(2)}%
                </td>
                <td style={{ textAlign: "right", padding: "2px 4px", color: r.changeWeek >= 0 ? "#4ade80" : "#ff6b6b" }}>
                  {r.changeWeek >= 0 ? "+" : ""}{r.changeWeek?.toFixed(2)}%
                </td>
                <td style={{ textAlign: "right", padding: "2px 4px", color: r.changeMonth >= 0 ? "#4ade80" : "#ff6b6b" }}>
                  {r.changeMonth >= 0 ? "+" : ""}{r.changeMonth?.toFixed(2)}%
                </td>
                <td style={{ textAlign: "right", padding: "2px 4px", color: "var(--text-muted)", fontSize: 9 }}>
                  {r.low30d?.toFixed(4)} — {r.high30d?.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4, textAlign: "right" }}>
        {total} results from {universe} assets scanned
      </div>
    </Card>
  )
}
