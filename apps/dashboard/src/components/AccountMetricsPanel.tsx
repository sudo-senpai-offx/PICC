import { useCallback, useEffect, useState } from "react"
import { Card, Badge, Button, Skeleton } from "@/components/ui"
import { getAccountMetrics, type AccountMetricsResult } from "@/lib/trading"
import { metricsPanelModel, type MetricsDisplay } from "@/lib/integrationPanels"

/**
 * Observed account metrics per venue (spec T6).
 * Honesty: a venue with no observation renders as that state (never a
 * fabricated 0); a genuine observed 0 stays 0; `stale` badges pass through.
 */
export function AccountMetricsPanel() {
  const [model, setModel] = useState<MetricsDisplay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res: AccountMetricsResult = await getAccountMetrics()
      if (res.ok) setModel(metricsPanelModel(res))
    } catch (e) {
      setError(e instanceof Error ? e.message : "account metrics failed")
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Account Metrics</div>
        <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
          {loading ? "..." : "Refresh"}
        </Button>
      </div>

      {error ? (
        <div style={{ fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      ) : !model ? (
        <div aria-busy="true" className="skeleton-row">
          <Skeleton width="60%" />
          <Skeleton width="85%" />
          <Skeleton width="45%" />
        </div>
      ) : model.observedVenueCount === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>
          No capture observation yet — connect a venue session to record metrics
        </div>
      ) : (
        model.venues.map((v) => (
          <div key={v.venueId} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{v.venueId}</span>
              {v.active && (
                <span style={{ marginLeft: 6 }}>
                  <Badge tone={v.active === "demo" ? "muted" : "accent"}>{v.active}</Badge>
                </span>
              )}
              {v.stale && (
                <span style={{ marginLeft: 6 }}>
                  <Badge tone="warn">stale</Badge>
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {/* Honesty: null balance renders "—"; a genuine 0 renders 0.00 */}
              {v.balance === null ? "—" : `${v.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${v.currency}`}
            </div>
          </div>
        ))
      )}
    </Card>
  )
}