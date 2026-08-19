import { useState } from "react"
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui"
import type { BacktestResult } from "@/lib/trading"
import { runBacktest } from "@/lib/trading"

function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—"
  return (n * 100).toFixed(1) + "%"
}

function MiniEquityCurve({ equity, drawdown }: { equity: BacktestResult["equity"]; drawdown: BacktestResult["drawdown"] }) {
  if (equity.length < 2) return null
  const W = 640
  const H = 80
  const lo = Math.min(...equity.map((p) => p.v))
  const hi = Math.max(...equity.map((p) => p.v), 100)
  const pad = Math.max((hi - lo) * 0.1, 1)
  const span = Math.max(hi - lo + pad * 2, 0.01)
  const base = lo - pad
  const n = equity.length
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => H - ((v - base) / span) * (H - 8) - 4
  const eqPts = equity.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")
  const eqFill = `0,${H} ` + eqPts + ` ${W},${H}`

  const ddHi = Math.max(...drawdown.map((d) => d.v), 1)
  const yDd = (v: number) => (v / ddHi) * (H - 8)
  const ddPts = drawdown.map((d) => `${x(d.i).toFixed(1)},${yDd(d.v).toFixed(1)}`).join(" ")
  const ddFill = `0,0 ` + ddPts + ` ${W},0`

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ flex: 2 }}>
        <div className="muted small" style={{ marginBottom: 2 }}>Equity curve</div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }} preserveAspectRatio="none">
          <polygon points={eqFill} fill="rgba(74,222,128,0.08)" />
          <polyline points={eqPts} fill="none" stroke="#4ade80" strokeWidth="1.5" />
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <div className="muted small" style={{ marginBottom: 2 }}>Drawdown</div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }} preserveAspectRatio="none">
          <polygon points={ddFill} fill="rgba(255,107,107,0.12)" />
          <polyline points={ddPts} fill="none" stroke="#ff6b6b" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  )
}

export function BacktestPanel() {
  const [symbol, setSymbol] = useState("AAPL")
  const [days, setDays] = useState(3)
  const [windows, setWindows] = useState(15)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await runBacktest(symbol.trim().toUpperCase(), days, windows)
      if (r.ok) setResult(r)
      else setError(r.error ?? "Backtest failed")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="pad stack">
      <div className="row-between">
        <h3>Strategy Backtester</h3>
        {result ? <Badge tone={result.hitRate > 0.5 ? "success" : "danger"}>{(result.hitRate * 100).toFixed(1)}% hit rate</Badge> : null}
      </div>
      <p className="muted small">
        Walk-forward backtest across {windows} rolling windows, each predicting {days}-day direction using 4-model ensemble
        (momentum, mean-reversion, trend, Monte Carlo). Results are out-of-sample — no peeking.
      </p>
      <div className="row gap" style={{ alignItems: "flex-end" }}>
        <Field label="Symbol">
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} style={{ width: 120 }} />
        </Field>
        <Field label="Horizon (days)">
          <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value) || 3)} style={{ width: 80 }} />
        </Field>
        <Field label="Windows">
          <Input type="number" min={3} max={30} value={windows} onChange={(e) => setWindows(Number(e.target.value) || 15)} style={{ width: 80 }} />
        </Field>
        <Button disabled={busy || !symbol.trim()} onClick={run}>
          {busy ? "Running…" : "Backtest"}
        </Button>
      </div>
      {error ? <p className="danger-text">{error}</p> : null}
      {busy && !result ? <Spinner label="Running backtest…" /> : null}
      {result ? (
        <div className="stack">
          <div className="grid grid-4">
            <Card className="pad">
              <div className="stat-label muted">Hit Rate</div>
              <div className="stat-value" style={{ color: result.hitRate > 0.5 ? "#4ade80" : "#ff6b6b" }}>{fmtPct(result.hitRate)}</div>
              <div className="muted small">{result.sampleSize} windows</div>
            </Card>
            <Card className="pad">
              <div className="stat-label muted">Return</div>
              <div className="stat-value" style={{ color: result.returnPct >= 0 ? "#4ade80" : "#ff6b6b" }}>
                {result.returnPct >= 0 ? "+" : ""}{result.returnPct.toFixed(2)}%
              </div>
            </Card>
            <Card className="pad">
              <div className="stat-label muted">Max Drawdown</div>
              <div className="stat-value danger-text">{result.maxDrawdown.toFixed(1)}%</div>
            </Card>
            <Card className="pad">
              <div className="stat-label muted">Model Agreement</div>
              <div className="stat-value">{fmtPct(result.agreement)}</div>
              <div className="muted small">{result.trades.length} models</div>
            </Card>
          </div>
          <MiniEquityCurve equity={result.equity} drawdown={result.drawdown} />
          {result.trades.length > 0 ? (
            <div>
              <h4 className="small">Per-Model Performance</h4>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Model</th><th>Hit Rate</th><th>Windows</th><th>Signal</th></tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t) => (
                      <tr key={t.model}>
                        <td><strong>{t.model}</strong></td>
                        <td style={{ color: (t.hitRate ?? 0) > 0.5 ? "#4ade80" : "#ff6b6b" }}>{fmtPct(t.hitRate)}</td>
                        <td>{t.n}</td>
                        <td>
                          <Badge tone={(t.hitRate ?? 0) > 0.6 ? "success" : (t.hitRate ?? 0) < 0.4 ? "danger" : "muted"}>
                            {(t.hitRate ?? 0) > 0.6 ? "reliable" : (t.hitRate ?? 0) < 0.4 ? "unreliable" : "neutral"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <p className="muted small">
            {result.symbol} · {result.days}-day horizon · {result.windows} rolling windows · walk-forward
            {result.name ? ` · ${result.name}` : ""}
          </p>
        </div>
      ) : null}
    </Card>
  )
}
