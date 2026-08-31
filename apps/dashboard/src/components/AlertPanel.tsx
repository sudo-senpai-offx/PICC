import { useEffect, useState, useCallback } from "react"
import { Card, Badge, Button } from "@/components/ui"
import { getAlerts, createAlert, deleteAlert, toggleAlert, type Alert, type AlertStats } from "@/lib/trading"
import { describeAlertConditions } from "@/lib/alertConditions"

const CONDITIONS = [
  { value: "price_above", label: "Price Above" },
  { value: "price_below", label: "Price Below" },
  { value: "price_crossing_up", label: "Crossing Up" },
  { value: "price_crossing_down", label: "Crossing Down" },
  { value: "pct_change_up", label: "Change Up %" },
  { value: "pct_change_down", label: "Change Down %" },
  { value: "convergence_above", label: "Convergence ≥ (5-scale)" },
]

// Engine states a convergence_above alert can fire on (slice 8). Treated as
// an optional band: the alert fires when the score crosses the threshold OR
// the asset's convergence state lands on one of these.
const CONVERGENCE_STATES = ["LONG BIAS", "SHORT BIAS", "LONG ONLY", "SHORT ONLY", "LONG WATCH", "SHORT WATCH", "WATCH"]

const QUICK_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "GOLD", "BTCUSD", "AAPL", "TSLA", "ETHUSD"]

export function AlertPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [stats, setStats] = useState<AlertStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [symbol, setSymbol] = useState("EURUSD")
  const [condition, setCondition] = useState("price_above")
  const [value, setValue] = useState("")
  const [message, setMessage] = useState("")
  const [recurring, setRecurring] = useState(false)
  const [band, setBand] = useState<string[]>([])

  const refresh = useCallback(async () => {
    try {
      const res = await getAlerts()
      setAlerts(res.alerts)
      setStats(res.stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts")
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleCreate = async () => {
    if (!symbol || !value || !Number.isFinite(Number(value))) return
    setError(null)
    try {
      await createAlert({ symbol, condition, value: Number(value), message, recurring, band: band.length ? band : undefined })
      setValue("")
      setMessage("")
      setBand([])
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create alert")
    }
  }

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      await deleteAlert(id)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete alert")
    }
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    setError(null)
    try {
      await toggleAlert(id, enabled)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update alert")
    }
  }

  const statusColor = (s: string) => s === "armed" ? "success" : s === "triggered" ? "warn" : "muted"

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Alerts</div>
        <div className="row gap" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {stats && (
            <>
              <span>{stats.total} total</span>
              <span style={{ color: "#4ade80" }}>{stats.armed} armed</span>
              <span style={{ color: "#f59e0b" }}>{stats.triggered} fired</span>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {QUICK_SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              style={{
                padding: "1px 6px", fontSize: 9, border: "none", borderRadius: 3, cursor: "pointer",
                background: symbol === s ? "var(--accent)" : "var(--bg)",
                color: symbol === s ? "#fff" : "var(--text-muted)"
              }}
            >{s}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="Symbol"
          style={{ flex: "0 0 80px", padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
        />
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          style={{ flex: "0 0 120px", padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
        >
          {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          type="number"
          step="any"
          style={{ flex: "0 0 70px", padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
        />
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Message (optional)"
          style={{ flex: 1, minWidth: 80, padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
        />
        <label style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
          Repeat
        </label>
        <Button variant="primary" onClick={handleCreate} style={{ fontSize: 10, padding: "3px 10px" }}>Add</Button>
      </div>

      {condition === "convergence_above" && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>Fire when state is:</span>
          {CONVERGENCE_STATES.map((s) => (
            <label
              key={s}
              style={{
                fontSize: 9, display: "flex", alignItems: "center", gap: 2, cursor: "pointer",
                padding: "1px 5px", borderRadius: 3, border: "1px solid var(--border)",
                background: band.includes(s) ? "var(--accent)" : "var(--bg)",
                color: band.includes(s) ? "#fff" : "var(--text-muted)"
              }}
            >
              <input
                type="checkbox"
                style={{ display: "none" }}
                checked={band.includes(s)}
                onChange={() => setBand((b) => (b.includes(s) ? b.filter((x) => x !== s) : [...b, s]))}
              />
              {s.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 10, color: "var(--danger)", marginBottom: 6 }}>{error}</div>
      )}

      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {alerts.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>No alerts</div>
        ) : (
          alerts.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11 }}>
                <span style={{ fontWeight: 600 }}>{a.symbol}</span>{" "}
                {a.conditions?.length ? (
                  <span style={{ color: "var(--text-accent)" }}>
                    {describeAlertConditions(a)}
                    <Badge tone="accent">{a.logic}</Badge>
                  </span>
                ) : (
                  <>
                    <span style={{ color: "var(--text-muted)" }}>{a.condition.replace(/_/g, " ")}</span>{" "}
                    <span style={{ fontWeight: 600 }}>{a.value}</span>
                  </>
                )}
                {a.band && a.band.length > 0 && (
                  <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>
                    ▸ {a.band.join(", ")}
                  </span>
                )}
                {a.lastScore != null && (
                  <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>- last {a.lastScore}/5</span>
                )}
                {a.message && <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>- {a.message}</span>}
              </div>
              <div className="row gap" style={{ alignItems: "center" }}>
                <Badge tone={statusColor(a.status)}>{a.status}</Badge>
                <button
                  onClick={() => handleToggle(a.id, a.status !== "armed")}
                  style={{ fontSize: 9, border: "none", background: "none", cursor: "pointer", color: a.status === "armed" ? "#f59e0b" : "#4ade80" }}
                  title={a.status === "armed" ? "Disable" : "Enable"}
                >{a.status === "armed" ? "Pause" : "Resume"}</button>
                <button
                  onClick={() => handleDelete(a.id)}
                  style={{ fontSize: 9, border: "none", background: "none", cursor: "pointer", color: "#ff6b6b" }}
                  title="Delete"
                >X</button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}
