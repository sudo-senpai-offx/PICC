import { useCallback, useEffect, useState } from "react"
import { Card, Badge, Button, Skeleton } from "@/components/ui"
import { getPortfolioAggregate, type AggregateResult } from "@/lib/trading"
import { aggregatePanelModel, paperIncome, realPnl, type AggregateDisplay } from "@/lib/integrationPanels"

/**
 * Cross-venue portfolio aggregate + pre-trade risk check (spec T5).
 * Honesty: no open positions renders as that observed state (never a fake
 * zero entry); the risk-check button is gated on a real paper status existing.
 */
export function PortfolioAggregatePanel({ paperAvailable }: { paperAvailable: boolean }) {
  const [model, setModel] = useState<AggregateDisplay | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposed, setProposed] = useState({ symbol: "EURUSD", amount: 100 })

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res: AggregateResult = await getPortfolioAggregate()
      if (res.ok) setModel(aggregatePanelModel(res))
    } catch (e) {
      setError(e instanceof Error ? e.message : "aggregate failed")
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const runRiskCheck = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const res: AggregateResult = await getPortfolioAggregate({
        symbol: proposed.symbol.toUpperCase(),
        amount: Number(proposed.amount) || 0
      })
      if (res.ok) setModel(aggregatePanelModel(res))
    } catch (e) {
      setError(e instanceof Error ? e.message : "risk check failed")
    }
    setChecking(false)
  }, [proposed])

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Portfolio Aggregate</div>
        <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
          {loading ? "..." : "Refresh"}
        </Button>
      </div>

      {error ? (
        <div style={{ fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      ) : !model ? (
        <div aria-busy="true" className="skeleton-row">
          <Skeleton width="70%" />
          <Skeleton width="40%" />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Open positions</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{model.totals.openPositions}</div>
            </div>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Instruments</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{model.totals.instruments}</div>
            </div>
            {model.venues.map((v) => (
              <div key={v.venue} style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{v.venue} exposure</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{v.totalSize === 0 ? "—" : `$${v.totalSize}`}</div>
              </div>
            ))}
            {model.todayPnl.paper && (
              <div style={{ padding: "4px 8px", borderRadius: 4, textAlign: "center", background: "var(--bg)", border: `1px solid ${model.todayPnl.paper.pnl > 0 ? "#4ade80" : model.todayPnl.paper.pnl < 0 ? "#ff6b6b" : "var(--border)"}` }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{paperIncome}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: model.todayPnl.paper.pnl > 0 ? "#4ade80" : model.todayPnl.paper.pnl < 0 ? "#ff6b6b" : "var(--text-muted)" }}>
                  {model.todayPnl.paper.pnl > 0 ? "+" : ""}${model.todayPnl.paper.pnl} <span style={{ fontSize: 9, color: "var(--text-muted)" }}>({model.todayPnl.paper.trades} trades)</span>
                </div>
              </div>
            )}
            {model.todayPnl.expertoption && (
              <div style={{ padding: "4px 8px", borderRadius: 4, textAlign: "center", background: "var(--bg)", border: `1px solid ${model.todayPnl.expertoption.pnl > 0 ? "#4ade80" : model.todayPnl.expertoption.pnl < 0 ? "#ff6b6b" : "var(--border)"}` }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{realPnl}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: model.todayPnl.expertoption.pnl > 0 ? "#4ade80" : model.todayPnl.expertoption.pnl < 0 ? "#ff6b6b" : "var(--text-muted)" }}>
                  {model.todayPnl.expertoption.pnl > 0 ? "+" : ""}${model.todayPnl.expertoption.pnl} <span style={{ fontSize: 9, color: "var(--text-muted)" }}>({model.todayPnl.expertoption.trades} trades)</span>
                </div>
              </div>
            )}
          </div>

          {model.totals.openPositions === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 8 }}>
              No open positions observed across venues
            </div>
          )}

          <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Pre-trade risk check</div>
            {paperAvailable ? (
              <>
                <div className="row gap" style={{ alignItems: "center", marginBottom: 6 }}>
                  <input
                    value={proposed.symbol}
                    onChange={(e) => setProposed((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))}
                    placeholder="Symbol"
                    style={{ width: 90, padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                  />
                  <input
                    type="number"
                    value={proposed.amount}
                    onChange={(e) => setProposed((p) => ({ ...p, amount: Number(e.target.value) || 0 }))}
                    placeholder="Amount"
                    style={{ width: 90, padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
                  />
                  <Button variant="primary" onClick={runRiskCheck} disabled={checking} style={{ fontSize: 10, padding: "3px 10px" }}>
                    {checking ? "..." : "Check"}
                  </Button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                Risk check needs an active paper account — enable paper trading first.
              </div>
            )}

            {model.riskCheck && (
              <div style={{ marginTop: 6 }}>
                <Badge tone={model.riskCheck.allowed ? "success" : "danger"}>
                  {model.riskCheck.allowed ? "allowed" : "refused"}
                </Badge>
                {model.riskCheck.proposedSymbol && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 6 }}>
                    {model.riskCheck.proposedSymbol} +{model.riskCheck.afterNotional === null ? "?" : model.riskCheck.afterNotional} notional
                  </span>
                )}
                {model.riskCheck.warnings.length > 0 && (
                  <ul style={{ fontSize: 10, margin: "4px 0 0", paddingLeft: 14, color: "#ffb86c" }}>
                    {model.riskCheck.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                {model.riskCheck.allowed && model.riskCheck.warnings.length === 0 && (
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                    No concentration or notional warnings for this proposed size.
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  )
}