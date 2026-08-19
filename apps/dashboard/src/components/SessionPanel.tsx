import { useState, useCallback, useEffect } from "react"
import { Card } from "@/components/ui"
import { getTradingSessions, type SessionInfo } from "@/lib/trading"

function SessionBar({ session, utcHour }: { session: SessionInfo["schedule"]["schedule"][0]; utcHour: number }) {
  const isOpen = session.isActive
  const progress = isOpen && session.hoursUntilClose != null
    ? ((session.close - session.hoursUntilClose) / (session.close - session.open)) * 100
    : 0

  // Visual bar: 24 hours, highlight open period
  const barStart = (session.open / 24) * 100
  const barWidth = ((session.close - session.open) / 24) * 100
  const nowPos = (utcHour / 24) * 100

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <div className="row gap" style={{ alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: isOpen ? session.color : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: isOpen ? session.color : "var(--text-muted)" }}>{session.name}</span>
        </div>
        <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
          {isOpen
            ? `${session.hoursUntilClose}h left`
            : `opens in ${session.hoursUntilOpen}h`
          }
        </div>
      </div>
      <div style={{ position: "relative", height: 6, background: "var(--bg)", borderRadius: 3, overflow: "hidden" }}>
        {/* Session active region */}
        <div style={{
          position: "absolute", left: `${barStart}%`, width: `${barWidth}%`,
          height: "100%", background: isOpen ? `${session.color}44` : "var(--border)", borderRadius: 3
        }} />
        {/* Progress if open */}
        {isOpen && (
          <div style={{
            position: "absolute", left: `${barStart}%`, width: `${Math.min(progress, 100)}%`,
            height: "100%", background: session.color, borderRadius: 3, transition: "width 0.3s"
          }} />
        )}
        {/* Current time marker */}
        <div style={{
          position: "absolute", left: `${nowPos}%`, top: -1, width: 2, height: 8,
          background: "#fff", borderRadius: 1, zIndex: 2
        }} />
      </div>
    </div>
  )
}

export function SessionPanel() {
  const [data, setData] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTradingSessions()
      if (res.ok) setData(res)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [])

  const current = data?.current
  const schedule = data?.schedule?.schedule ?? []
  const utcHour = data?.schedule?.utcHour ?? 0

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Trading Sessions</div>

      {current && (
        <>
          {/* Current Status */}
          <div style={{ padding: 8, borderRadius: 6, background: current.activeOverlaps.length > 0 ? "#ec489811" : current.activeSessions.length > 0 ? "#6c63ff11" : "var(--bg)", border: `1px solid ${current.activeOverlaps.length > 0 ? "#ec4898" : current.activeSessions.length > 0 ? "#6c63ff" : "var(--border)"}`, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>
              {current.activeOverlaps.length > 0
                ? current.activeOverlaps[0].name
                : current.activeSessions.length > 0
                  ? current.activeSessions.map((s) => s.name).join(" + ")
                  : "Off Hours"
              }
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{current.description}</div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>
              UTC {current.utcHour} | Volatility: {current.isHighVolatility ? "HIGH" : "normal"}
            </div>
          </div>

          {/* Session Timeline */}
          <div style={{ marginBottom: 8 }}>
            {schedule.map((s) => <SessionBar key={s.id} session={s} utcHour={utcHour} />)}
          </div>

          {/* Preferred Assets */}
          {current.preferredAssets.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Best Assets Now</div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {current.preferredAssets.map((a) => (
                  <span key={a} style={{ padding: "1px 6px", fontSize: 9, background: "var(--accent)", color: "#fff", borderRadius: 3 }}>{a}</span>
                ))}
              </div>
            </div>
          )}

          {/* Next Session */}
          {current.nextSession && (
            <div style={{ marginTop: 6, fontSize: 9, color: "var(--text-muted)" }}>
              Next: <span style={{ color: current.nextSession.color }}>{current.nextSession.name}</span> in {current.nextSession.hoursUntil}h
            </div>
          )}
        </>
      )}

      {loading && !data && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>Loading...</div>
      )}
    </Card>
  )
}
