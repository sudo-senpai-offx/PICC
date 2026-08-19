import { useEffect, useState, useCallback } from "react"
import { Card, Badge } from "@/components/ui"
import { getEconomicCalendar, type CalendarEvent, type CalendarResult } from "@/lib/trading"

function ImpactBadge({ impact }: { impact: string }) {
  const tone = impact === "high" ? "danger" : impact === "medium" ? "warn" : "muted"
  return <Badge tone={tone}>{impact}</Badge>
}

export function CalendarPanel() {
  const [data, setData] = useState<CalendarResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(7)
  const [currency, setCurrency] = useState<string>("")

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getEconomicCalendar(days, currency || undefined)
      setData(res)
    } catch { /* ignore */ }
    setLoading(false)
  }, [days, currency])

  useEffect(() => { refresh() }, [refresh])

  const events = data?.events ?? []
  const summary = data?.summary

  const groupByDate = (evts: CalendarEvent[]) => {
    const groups: Record<string, CalendarEvent[]> = {}
    for (const e of evts) {
      const key = e.date || "unknown"
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    }
    return groups
  }

  const grouped = groupByDate(events)

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Economic Calendar</div>
        <div className="row gap" style={{ alignItems: "center" }}>
          {summary && (
            <div className="row gap" style={{ fontSize: 9, color: "var(--text-muted)" }}>
              <span style={{ color: "#ff6b6b" }}>{summary.high} high</span>
              <span style={{ color: "#f59e0b" }}>{summary.medium} med</span>
              <span>{summary.low} low</span>
            </div>
          )}
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            style={{ padding: "2px 6px", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, color: "var(--text)" }}
          >
            <option value="">All</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="JPY">JPY</option>
            <option value="AUD">AUD</option>
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ padding: "2px 6px", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, color: "var(--text)" }}
          >
            <option value={3}>3D</option>
            <option value={7}>7D</option>
            <option value={14}>14D</option>
            <option value={30}>30D</option>
          </select>
        </div>
      </div>

      {loading && !events.length ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>Loading events...</div>
      ) : events.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>No upcoming events</div>
      ) : (
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          {Object.entries(grouped).map(([date, evts]) => (
            <div key={date} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", marginBottom: 2, borderBottom: "1px solid var(--border)", paddingBottom: 2 }}>
                {new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </div>
              {evts.map((e, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", fontSize: 11 }}>
                  <div className="row gap" style={{ alignItems: "center", flex: 1 }}>
                    <span style={{ width: 36, color: "var(--text-muted)", fontSize: 10 }}>{e.time}</span>
                    <span style={{ width: 32, fontWeight: 700, fontSize: 10 }}>{e.currency}</span>
                    <span style={{ flex: 1 }}>{e.event}</span>
                  </div>
                  <div className="row gap" style={{ alignItems: "center" }}>
                    <ImpactBadge impact={e.impact} />
                    {e.forecast && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>F: {e.forecast}</span>}
                    {e.previous && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>P: {e.previous}</span>}
                    {e.actual && <span style={{ fontSize: 9, fontWeight: 700 }}>A: {e.actual}</span>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
