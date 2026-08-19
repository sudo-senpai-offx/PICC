import { useState, useCallback, useEffect, useRef } from "react"

interface Notification {
  id: string
  alertId: string
  symbol: string
  condition: string
  value: number
  price: number
  message: string
  ts: number
  read: boolean
}

const CONDITION_LABELS: Record<string, string> = {
  price_above: "crossed above",
  price_below: "crossed below",
  price_crossing_up: "crossed up through",
  price_crossing_down: "crossed down through",
  pct_change_up: "changed up",
  pct_change_down: "changed down"
}

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [lastCheck, setLastCheck] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const unread = notifications.filter((n) => !n.read).length

  const checkAlerts = useCallback(async () => {
    try {
      const res = await fetch(`/api/trading/alerts`, { credentials: "include" })
      const data = await res.json()
      if (!data.ok) return
      const alerts = data.alerts ?? []
      const triggered = alerts.filter((a: any) => a.status === "triggered" && a.triggeredAt && a.triggeredAt > lastCheck)
      if (triggered.length > 0) {
        const newNotifs: Notification[] = triggered.map((a: any) => ({
          id: `notif_${a.id}_${a.triggeredAt}`,
          alertId: a.id,
          symbol: a.symbol,
          condition: a.condition,
          value: a.value,
          price: a.lastPrice ?? 0,
          message: a.message || `${a.symbol} alert triggered`,
          ts: a.triggeredAt,
          read: false
        }))
        setNotifications((prev) => {
          const existing = new Set(prev.map((n) => n.id))
          const unique = newNotifs.filter((n) => !existing.has(n.id))
          return [...unique, ...prev].slice(0, 100)
        })
        for (const n of newNotifs) {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("PICC Alert", {
              body: `${n.symbol} ${CONDITION_LABELS[n.condition] || n.condition} ${n.value} (now ${n.price.toFixed(4)})`,
              icon: "/favicon.ico",
              tag: n.id
            })
          }
        }
      }
      setLastCheck(Date.now())
    } catch { /* ignore */ }
  }, [lastCheck])

  useEffect(() => {
    checkAlerts()
    const interval = setInterval(checkAlerts, 10000)
    return () => clearInterval(interval)
  }, [checkAlerts])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
  }

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const clearAll = () => {
    setNotifications([])
  }

  const requestPermission = async () => {
    if ("Notification" in window) {
      await Notification.requestPermission()
    }
  }

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts
    if (diff < 60000) return "just now"
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "relative", background: "none", border: "none", cursor: "pointer",
          padding: "4px 6px", borderRadius: 4, color: "var(--text-muted)", fontSize: 16
        }}
        title="Notifications"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 6a4 4 0 018 0c0 3 1.5 5 1.5 5H2.5S4 9 4 6z" />
          <path d="M6 11v1a2 2 0 004 0v-1" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: "absolute", top: 0, right: 0, background: "#ff6b6b", color: "#fff",
            fontSize: 8, fontWeight: 700, borderRadius: "50%", width: 14, height: 14,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            {unread > 99 ? "99" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, width: 320, maxHeight: 400,
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 9999, overflow: "hidden"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Notifications</div>
            <div style={{ display: "flex", gap: 4 }}>
              {unread > 0 && (
                <button onClick={markAllRead} style={{ fontSize: 9, border: "none", background: "none", cursor: "pointer", color: "var(--accent)" }}>Mark all read</button>
              )}
              <button onClick={clearAll} style={{ fontSize: 9, border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)" }}>Clear</button>
            </div>
          </div>

          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 11 }}>
                No notifications
                <div style={{ marginTop: 8 }}>
                  <button onClick={requestPermission} style={{ fontSize: 10, padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>
                    Enable browser notifications
                  </button>
                </div>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  style={{
                    padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer",
                    background: n.read ? "transparent" : "#6c63ff11",
                    borderLeft: n.read ? "3px solid transparent" : "3px solid var(--accent)"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{n.symbol}</span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{formatTime(n.ts)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {CONDITION_LABELS[n.condition] || n.condition} <strong>{n.value}</strong>
                    {" "}(now {n.price.toFixed(4)})
                  </div>
                  {n.message && <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{n.message}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
