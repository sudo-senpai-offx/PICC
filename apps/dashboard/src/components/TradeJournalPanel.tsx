import { useState, useCallback, useEffect } from "react"
import { Card, Badge, Button } from "@/components/ui"
import { getJournal, addJournalEntry, closeJournalEntry, deleteJournalEntry, type TradeJournalEntry, type JournalStats } from "@/lib/trading"

export function TradeJournalPanel() {
  const [entries, setEntries] = useState<TradeJournalEntry[]>([])
  const [stats, setStats] = useState<JournalStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  // New trade form
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ symbol: "EURUSD", side: "long", entryPrice: "", quantity: "1", reason: "", confidence: "50", strategy: "", tags: "", timeframe: "", pattern: "" })

  const refresh = useCallback(async () => {
    try {
      const res = await getJournal({ limit: 50 })
      setEntries(res.entries)
      setStats(res.stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load journal")
    }
  }, [])

  useEffect(() => { refresh() }, [])

  const handleAdd = async () => {
    if (!form.entryPrice || !Number.isFinite(Number(form.entryPrice))) return
    setError(null)
    try {
      await addJournalEntry({
        symbol: form.symbol.toUpperCase(),
        side: form.side,
        entryPrice: Number(form.entryPrice),
        quantity: Number(form.quantity),
        reason: form.reason,
        confidence: Number(form.confidence),
        strategy: form.strategy,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        timeframe: form.timeframe,
        pattern: form.pattern
      })
      setShowForm(false)
      setForm({ symbol: "EURUSD", side: "long", entryPrice: "", quantity: "1", reason: "", confidence: "50", strategy: "", tags: "", timeframe: "", pattern: "" })
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log trade")
    }
  }

  const handleClose = async (id: string) => {
    const price = prompt("Exit price:")
    if (!price || !Number.isFinite(Number(price))) return
    setError(null)
    try {
      await closeJournalEntry(id, Number(price))
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to close trade")
    }
  }

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      await deleteJournalEntry(id)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete trade")
    }
  }

  const inputStyle = { padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", width: "100%" }
  const labelStyle = { fontSize: 9, color: "var(--text-muted)", marginBottom: 1 }

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Trade Journal</div>
        <div className="row gap" style={{ alignItems: "center" }}>
          {stats && (
            <div className="row gap" style={{ fontSize: 9, color: "var(--text-muted)" }}>
              <span>{stats.totalTrades} trades</span>
              <span style={{ color: stats.winRate >= 50 ? "#4ade80" : "#ff6b6b" }}>{stats.winRate}% win</span>
              <span style={{ color: stats.totalPnl >= 0 ? "#4ade80" : "#ff6b6b" }}>${stats.totalPnl.toFixed(0)}</span>
            </div>
          )}
          <Button variant="primary" onClick={() => setShowForm(!showForm)} style={{ fontSize: 10, padding: "3px 10px" }}>
            {showForm ? "Cancel" : "+ New Trade"}
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
          {[
            { label: "Win Rate", value: `${stats.winRate}%`, color: stats.winRate >= 50 ? "#4ade80" : "#ff6b6b" },
            { label: "Profit Factor", value: stats.profitFactor.toFixed(2), color: stats.profitFactor >= 1.5 ? "#4ade80" : stats.profitFactor >= 1 ? "#f59e0b" : "#ff6b6b" },
            { label: "Avg R", value: stats.avgRMultiple.toFixed(2), color: stats.avgRMultiple >= 0 ? "#4ade80" : "#ff6b6b" },
            { label: "Win Streak", value: String(stats.maxWinStreak), color: "#4ade80" },
            { label: "Loss Streak", value: String(stats.maxLossStreak), color: "#ff6b6b" },
          ].map((m) => (
            <div key={m.label} style={{ padding: "3px 6px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center", minWidth: 60 }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{m.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* New Trade Form */}
      {error && (
        <div style={{ fontSize: 10, color: "var(--danger)", marginBottom: 6 }}>{error}</div>
      )}
      {showForm && (
        <div style={{ padding: 8, marginBottom: 8, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <div><div style={labelStyle}>Symbol</div><input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} style={inputStyle} /></div>
            <div><div style={labelStyle}>Side</div><select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} style={inputStyle}><option value="long">Long</option><option value="short">Short</option></select></div>
            <div><div style={labelStyle}>Entry Price</div><input value={form.entryPrice} onChange={(e) => setForm({ ...form, entryPrice: e.target.value })} type="number" step="any" style={inputStyle} /></div>
            <div><div style={labelStyle}>Qty</div><input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} type="number" style={inputStyle} /></div>
            <div><div style={labelStyle}>Confidence</div><input value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })} type="number" min="0" max="100" style={inputStyle} /></div>
            <div><div style={labelStyle}>Strategy</div><input value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })} placeholder="e.g. scalping" style={inputStyle} /></div>
            <div style={{ gridColumn: "span 2" }}><div style={labelStyle}>Reason</div><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why entering this trade?" style={inputStyle} /></div>
            <div><div style={labelStyle}>Tags</div><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="tag1, tag2" style={inputStyle} /></div>
          </div>
          <div style={{ marginTop: 6, textAlign: "right" }}>
            <Button variant="primary" onClick={handleAdd} style={{ fontSize: 10, padding: "4px 12px" }}>Log Trade</Button>
          </div>
        </div>
      )}

      {/* Entries Table */}
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "2px 4px" }}>Date</th>
              <th style={{ textAlign: "left", padding: "2px 4px" }}>Symbol</th>
              <th style={{ textAlign: "center", padding: "2px 4px" }}>Side</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>Entry</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>Exit</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>P&L</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>R</th>
              <th style={{ textAlign: "center", padding: "2px 4px" }}>Status</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "2px 4px", color: "var(--text-muted)" }}>{new Date(e.entryTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                <td style={{ padding: "2px 4px", fontWeight: 600 }}>{e.symbol}</td>
                <td style={{ textAlign: "center", padding: "2px 4px" }}>
                  <Badge tone={e.side === "long" ? "success" : "danger"}>{e.side}</Badge>
                </td>
                <td style={{ textAlign: "right", padding: "2px 4px" }}>{e.entryPrice.toFixed(4)}</td>
                <td style={{ textAlign: "right", padding: "2px 4px" }}>{e.exitPrice?.toFixed(4) ?? "-"}</td>
                <td style={{ textAlign: "right", padding: "2px 4px", color: (e.pnl ?? 0) >= 0 ? "#4ade80" : "#ff6b6b", fontWeight: 600 }}>
                  {e.pnl != null ? `${e.pnl >= 0 ? "+" : ""}${e.pnl.toFixed(2)}` : "-"}
                </td>
                <td style={{ textAlign: "right", padding: "2px 4px", color: (e.rMultiple ?? 0) >= 0 ? "#4ade80" : "#ff6b6b" }}>
                  {e.rMultiple != null ? `${e.rMultiple >= 0 ? "+" : ""}${e.rMultiple.toFixed(1)}R` : "-"}
                </td>
                <td style={{ textAlign: "center", padding: "2px 4px" }}>
                  <Badge tone={e.status === "open" ? "warn" : "muted"}>{e.status}</Badge>
                </td>
                <td style={{ textAlign: "right", padding: "2px 4px" }}>
                  {e.status === "open" && (
                    <button onClick={() => handleClose(e.id)} style={{ fontSize: 9, border: "none", background: "none", cursor: "pointer", color: "#4ade80", marginRight: 4 }}>Close</button>
                  )}
                  <button onClick={() => handleDelete(e.id)} style={{ fontSize: 9, border: "none", background: "none", cursor: "pointer", color: "#ff6b6b" }}>X</button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 16, color: "var(--text-muted)" }}>No trades logged yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
