import { useState, useCallback, useEffect } from "react"
import { Card, Badge, Button } from "@/components/ui"
import { getPatterns, type PatternDetection, type PatternSummary } from "@/lib/trading"

const DIRECTION_COLORS: Record<string, string> = {
  bullish: "#4ade80",
  bearish: "#ff6b6b",
  neutral: "#9aa0c0"
}

export function PatternPanel() {
  const [symbol, setSymbol] = useState("EURUSD")
  const [data, setData] = useState<{ detected: PatternDetection[]; summary: PatternSummary } | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getPatterns(symbol)
      if (res.ok) setData({ detected: res.detected, summary: res.summary })
    } catch { /* ignore */ }
    setLoading(false)
  }, [symbol])

  useEffect(() => { refresh() }, [])

  const summary = data?.summary

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Pattern Recognition</div>
        <div className="row gap" style={{ alignItems: "center" }}>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Symbol"
            style={{ width: 80, padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
          />
          <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
            {loading ? "..." : "Scan"}
          </Button>
        </div>
      </div>

      {summary && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Total</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{summary.total}</div>
          </div>
          <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Types</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{summary.uniquePatterns}</div>
          </div>
          <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#4ade80" }}>Bullish</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#4ade80" }}>{summary.bullishBias}</div>
          </div>
          <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#ff6b6b" }}>Bearish</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#ff6b6b" }}>{summary.bearishBias}</div>
          </div>
          <div style={{ padding: "4px 8px", borderRadius: 4, background: summary.bias === "bullish" ? "#4ade8022" : summary.bias === "bearish" ? "#ff6b6b22" : "var(--bg)", border: `1px solid ${summary.bias === "bullish" ? "#4ade80" : summary.bias === "bearish" ? "#ff6b6b" : "var(--border)"}`, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Bias</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: DIRECTION_COLORS[summary.bias] }}>{summary.bias}</div>
          </div>
        </div>
      )}

      {summary && summary.topPatterns.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Most Frequent</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {summary.topPatterns.map((p) => (
              <div key={p.name} style={{ padding: "2px 6px", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3 }}>
                {p.name} <span style={{ color: "var(--text-muted)" }}>x{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.detected.length > 0 && (
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Recent Patterns</div>
          {[...data.detected].reverse().slice(0, 15).map((d, i) => (
            <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {new Date(d.time).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {" "}O:{d.open.toFixed(4)} H:{d.high.toFixed(4)} L:{d.low.toFixed(4)} C:{d.close.toFixed(4)}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                {d.patterns.map((p, j) => (
                  <Badge key={j} tone={p.direction === "bullish" ? "success" : p.direction === "bearish" ? "danger" : "muted"}>
                    {p.name}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.detected.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>No patterns detected in recent candles</div>
      )}
    </Card>
  )
}
