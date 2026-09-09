import { useEffect, useState } from "react"
import { Badge, Card, Spinner } from "@/components/ui"
import { getPaperAnalytics } from "@/lib/trading"
import type { PaperAnalyticsResult } from "@/lib/trading"
import { computeRiskMetrics, MIN_OBSERVATIONS } from "@/lib/riskMetrics"
import type { RiskMetrics } from "@/lib/riskMetrics"

// Risk ratios are per-trade (annualizationFactor=1). They are NOT annualized.
const HONESTY_LINE =
  "Risk metrics from your paper history — per-trade estimates, not predictions."

const INSUFFICIENT_MSG = `Need at least ${MIN_OBSERVATIONS} closed trades with an equity curve to compute risk metrics.`

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + "%"
}

function fmtRatio(n: number): string {
  return n.toFixed(2)
}

function DrawdownBars({ drawdown }: { drawdown: Array<{ t: string | null; equity: number; peak: number; drawdown: number }> }) {
  if (!drawdown || drawdown.length === 0) return null
  return (
    <div className="stack" style={{ gap: 4 }}>
      {drawdown.map((d, i) => (
        <div key={i} className="row gap" style={{ alignItems: "center" }}>
          <div className="muted small" style={{ width: 70, flex: "0 0 70px" }}>{i === 0 ? "start" : d.t ?? ""}</div>
          <div style={{ flex: 1, background: "var(--border)", height: 10, borderRadius: 3 }}>
            <div
              style={{ width: `${Math.max(0, Math.min(100, d.drawdown))}%`, background: "var(--danger)", height: 10, borderRadius: 3 }}
            />
          </div>
          <div className="muted small" style={{ width: 60, textAlign: "right" }}>{d.drawdown.toFixed(1)}%</div>
        </div>
      ))}
    </div>
  )
}

export function RiskMetricsCard() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "empty" } | { status: "ready"; analytics: PaperAnalyticsResult; metrics: RiskMetrics }>({ status: "loading" })

  useEffect(() => {
    let alive = true
    getPaperAnalytics()
      .then((analytics) => {
        if (!alive) return
        const equity = analytics.metrics?.equity
        const returns: number[] = []
        if (Array.isArray(equity)) {
          for (let i = 1; i < equity.length; i++) {
            const prev = equity[i - 1]?.equity
            const cur = equity[i]?.equity
            if (
              typeof prev !== "number" || !isFinite(prev) || prev <= 0 ||
              typeof cur !== "number" || !isFinite(cur)
            ) continue
            returns.push((cur - prev) / prev)
          }
        }
        if (returns.length === 0) {
          setState({ status: "empty" })
          return
        }
        const metrics = computeRiskMetrics(returns)
        if (metrics === null) {
          setState({ status: "empty" })
          return
        }
        setState({ status: "ready", analytics, metrics })
      })
      .catch((e) => {
        if (!alive) return
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "failed to load paper analytics"
        })
      })
    return () => { alive = false }
  }, [])

  return (
    <Card className="pad stack">
      <div className="row-between">
        <h3>Risk Metrics</h3>
        {state.status === "ready" ? <Badge tone="accent">{state.metrics.n} trades</Badge> : null}
      </div>
      <p className="muted small">{HONESTY_LINE}</p>

      {state.status === "loading" ? (
        <Spinner label="Computing risk metrics…" />
      ) : null}

      {state.status === "error" ? (
        <p className="danger-text">Risk metrics unavailable: {state.message}</p>
      ) : null}

      {state.status === "empty" ? (
        <p className="muted small">{INSUFFICIENT_MSG}</p>
      ) : null}

      {state.status === "ready" ? (
        <div className="stack">
          <DrawdownBars drawdown={state.analytics.metrics.drawdown} />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                  <th className="muted">Method</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>VaR (95%, historical)</td>
                  <td>{fmtPct(state.metrics.historicalVaR)}</td>
                  <td className="muted">historical</td>
                </tr>
                <tr>
                  <td>CVaR (95%, historical)</td>
                  <td>{fmtPct(state.metrics.historicalCVaR)}</td>
                  <td className="muted">historical</td>
                </tr>
                <tr>
                  <td>VaR (95%, parametric)</td>
                  <td>{fmtPct(state.metrics.parametricVaR)}</td>
                  <td className="muted">normal</td>
                </tr>
                <tr>
                  <td>CVaR (95%, parametric)</td>
                  <td>{fmtPct(state.metrics.parametricCVaR)}</td>
                  <td className="muted">normal</td>
                </tr>
                <tr>
                  <td>VaR (95%, Monte Carlo)</td>
                  <td>{fmtPct(state.metrics.monteCarloVaR)}</td>
                  <td className="muted">10,000 sims — stochastic, seedless</td>
                </tr>
                <tr>
                  <td>Sharpe (per trade)</td>
                  <td>{fmtRatio(state.metrics.sharpe)}</td>
                  <td className="muted">per trade</td>
                </tr>
                <tr>
                  <td>Sortino (per trade)</td>
                  <td>{fmtRatio(state.metrics.sortino)}</td>
                  <td className="muted">per trade</td>
                </tr>
                <tr>
                  <td>Calmar (per trade)</td>
                  <td>{fmtRatio(state.metrics.calmar)}</td>
                  <td className="muted">per trade</td>
                </tr>
                <tr>
                  <td>Max drawdown</td>
                  <td>{state.metrics.maxDrawdownPct.toFixed(2)}%</td>
                  <td className="muted">from equity curve</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">
            VaR and CVaR are shown as positive loss percentages of equity. Returns are computed
            between consecutive closed paper trades (per trade, not annualized). Monte Carlo
            re-simulates on every load and is not seeded, so its value varies slightly between
            runs.
          </p>
        </div>
      ) : null}
    </Card>
  )
}
