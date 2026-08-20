import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Card, Spinner } from "@/components/ui"
import { getPaperPositions, getPaperHistory, closePaperTrade, getPaperAnalytics } from "@/lib/trading"
import type { PaperPosition, ClosedTrade, PaperAnalyticsResult } from "@/lib/trading"

const REFRESH_MS = 10_000

function fmtPct(n: number | null | undefined, d = 0): string {
  if (n == null) return "—"
  return `${n.toFixed(d)}%`
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—"
  return `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch {
    return "—"
  }
}

function OpenPositionRow({ p, onClose }: { p: PaperPosition; onClose: (id: string, exit: number) => void }) {
  const [closing, setClosing] = useState(false)
  const dir = p.side === "up" ? "▲" : "▼"
  const handleClose = async () => {
    // Simple prompt for exit price — in production would use a proper modal
    const priceStr = window.prompt(`Close ${p.symbol} ${p.side} position?\nEnter exit price:`)
    if (!priceStr) return
    const price = Number(priceStr)
    if (!Number.isFinite(price) || price <= 0) return
    setClosing(true)
    try {
      await onClose(p.id, price)
    } finally {
      setClosing(false)
    }
  }
  return (
    <tr>
      <td><strong>{p.symbol}</strong></td>
      <td><Badge tone={p.side === "up" ? "success" : "danger"}>{dir} {p.side}</Badge></td>
      <td>${p.entry.toFixed(4)}</td>
      <td>${p.amount.toFixed(2)}</td>
      <td>{fmtTime(p.openedAt)}</td>
      <td>
        {p.takeProfit != null && <span className="muted small">TP ${p.takeProfit.toFixed(4)}</span>}
        {p.stopLoss != null && <span className="muted small" style={{ marginLeft: 4 }}>SL ${p.stopLoss.toFixed(4)}</span>}
      </td>
      <td>
        <Button variant="danger" onClick={handleClose} disabled={closing} style={{ padding: "2px 8px", fontSize: 11 }}>
          {closing ? "…" : "Close"}
        </Button>
      </td>
    </tr>
  )
}

function ClosedTradeRow({ t }: { t: ClosedTrade }) {
  const dir = t.side === "up" ? "▲" : "▼"
  const tone = t.pnl > 0 ? "success" : t.pnl < 0 ? "danger" : "muted"
  return (
    <tr>
      <td><strong>{t.symbol}</strong></td>
      <td>{dir}</td>
      <td>${t.entry.toFixed(4)}</td>
      <td>{t.exit != null ? `$${t.exit.toFixed(4)}` : "—"}</td>
      <td><Badge tone={tone}>{fmtMoney(t.pnl)}</Badge></td>
      <td>{t.reason ?? "manual"}</td>
      <td className="muted small">{fmtTime(t.closedAt)}</td>
    </tr>
  )
}

function StatsCards({ stats }: { stats: PaperAnalyticsResult | null }) {
  if (!stats) return null
  const overview = stats.overview
  const winRate = stats.metrics?.winRate
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
      <Card className="pad">
        <div className="stat-label muted">Cash</div>
        <div className="stat-value">${overview.cash.toLocaleString()}</div>
      </Card>
      <Card className="pad">
        <div className="stat-label muted">Realized P&L</div>
        <div className="stat-value" style={{ color: overview.realizedPnl >= 0 ? "var(--success)" : "var(--danger)" }}>
          {fmtMoney(overview.realizedPnl)}
        </div>
      </Card>
      <Card className="pad">
        <div className="stat-label muted">Win Rate</div>
        <div className="stat-value">{fmtPct(winRate)}</div>
      </Card>
      <Card className="pad">
        <div className="stat-label muted">Open / Closed</div>
        <div className="stat-value">{overview.openCount} / {overview.closedCount}</div>
      </Card>
    </div>
  )
}

export function PaperLedger() {
  const [positions, setPositions] = useState<PaperPosition[]>([])
  const [history, setHistory] = useState<ClosedTrade[]>([])
  const [analytics, setAnalytics] = useState<PaperAnalyticsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"open" | "history">("open")

  const refresh = useCallback(async () => {
    try {
      const [posRes, histRes, anaRes] = await Promise.allSettled([
        getPaperPositions(),
        getPaperHistory(50),
        getPaperAnalytics()
      ])
      if (posRes.status === "fulfilled") setPositions(posRes.value.positions ?? [])
      if (histRes.status === "fulfilled") setHistory(histRes.value.closed ?? [])
      if (anaRes.status === "fulfilled") setAnalytics(anaRes.value)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const handleClose = async (id: string, exit: number) => {
    try {
      await closePaperTrade({ id, exit })
      await refresh()
    } catch {
      /* best effort */
    }
  }

  if (loading) return <Spinner label="Loading ledger…" />

  return (
    <div>
      <StatsCards stats={analytics} />

      <Card className="pad">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div className="row gap">
            <button
              onClick={() => setTab("open")}
              style={{
                background: "none", border: "none", cursor: "pointer", fontWeight: tab === "open" ? 700 : 400,
                color: tab === "open" ? "var(--text)" : "var(--text-muted)", fontSize: 13, padding: "4px 8px"
              }}
            >
              Open Positions ({positions.length})
            </button>
            <button
              onClick={() => setTab("history")}
              style={{
                background: "none", border: "none", cursor: "pointer", fontWeight: tab === "history" ? 700 : 400,
                color: tab === "history" ? "var(--text)" : "var(--text-muted)", fontSize: 13, padding: "4px 8px"
              }}
            >
              History ({history.length})
            </button>
          </div>
          <Button variant="ghost" onClick={() => refresh()} style={{ padding: "2px 8px", fontSize: 11 }}>Refresh</Button>
        </div>

        {tab === "open" && (
          positions.length === 0 ? (
            <div className="muted small" style={{ padding: 16, textAlign: "center" }}>No open positions.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr className="muted small" style={{ textAlign: "left" }}>
                    <th>Symbol</th><th>Side</th><th>Entry</th><th>Amount</th><th>Opened</th><th>Levels</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <OpenPositionRow key={p.id} p={p} onClose={handleClose} />
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === "history" && (
          history.length === 0 ? (
            <div className="muted small" style={{ padding: 16, textAlign: "center" }}>No closed trades yet.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr className="muted small" style={{ textAlign: "left" }}>
                    <th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Reason</th><th>Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((t) => (
                    <ClosedTradeRow key={t.id} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>
    </div>
  )
}
