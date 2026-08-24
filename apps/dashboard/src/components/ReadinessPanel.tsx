import { useCallback, useEffect, useState } from "react"
import { Badge, Card } from "@/components/ui"
import { getTradingReadiness } from "@/lib/trading"
import type { TradingReadiness } from "@/lib/trading"

const REFRESH_MS = 60_000

/**
 * Phase 11 — go-live readiness report. Honest aggregation of the evidence
 * you need before ever considering demo → real: sample size, realized vs
 * breakeven, calibration adequacy, feed uptime, data-source health.
 * Decision support ONLY — PICC has no live-trading path to unlock.
 */
export function ReadinessPanel() {
  const [report, setReport] = useState<TradingReadiness | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setReport(await getTradingReadiness())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "readiness unavailable")
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  if (error && !report) return null
  if (!report) return null

  const f = report.facts
  return (
    <Card className="pad">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong>Demo → Real Readiness</strong>
        <Badge tone={report.readyForRealConsideration ? "success" : "danger"}>
          {report.readyForRealConsideration ? "EVIDENCE THRESHOLDS MET" : `BLOCKED (${report.blockers.length})`}
        </Badge>
      </div>

      <div className="muted small" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6, marginBottom: 8 }}>
        <div><span className="stat-label">Resolved decisions </span><strong>{f.decisionsResolved ?? "—"}</strong>{f.decisionsResolved != null ? <span className="muted"> / 200 min</span> : null}</div>
        <div><span className="stat-label">Hit rate </span><strong>{f.hitRate != null ? `${Math.round(f.hitRate * 100)}%` : "—"}</strong>{f.breakevenWinRatePct != null ? <span className="muted"> vs {f.breakevenWinRatePct}% breakeven</span> : null}</div>
        <div><span className="stat-label">Calibration </span><strong>{f.calibration?.adequacy ?? "—"}</strong></div>
        <div><span className="stat-label">24h live uptime </span><strong>{f.uptime24h?.livePct != null ? `${f.uptime24h.livePct}%` : "—"}</strong></div>
        <div><span className="stat-label">Payout used </span><strong>{f.payoutPct ?? "—"}%</strong></div>
      </div>

      {report.blockers.length > 0 && (
        <div className="small" style={{ marginBottom: 6 }}>
          {report.blockers.map((b, i) => (
            <div key={i} style={{ color: "var(--danger)" }}>✗ {b}</div>
          ))}
        </div>
      )}
      {report.warnings.map((w, i) => (
        <div key={i} className="muted small">⚠ {w}</div>
      ))}
      {report.readyForRealConsideration && (
        <div className="small" style={{ color: "var(--success)", marginTop: 4 }}>
          Thresholds met — treat as permission to keep studying demo results, not as a profit guarantee.
        </div>
      )}
    </Card>
  )
}
