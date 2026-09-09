import { useState } from "react"
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui"
import type { WalkForwardResult } from "@/lib/trading"
import { runWalkForward } from "@/lib/trading"

// NOTE: the walk-forward endpoint returns percentages ALREADY (hitRate,
// totalReturnPct, maxDrawdownPct) — do NOT multiply by 100 here.
function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—"
  return n + "%"
}

function MiniEquityCurve({ equity, drawdown }: { equity: Array<{ i: number; v: number }>; drawdown: Array<{ i: number; v: number }> }) {
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

function GateBlock({ label, gate }: { label: string; gate: WalkForwardResult["gateHyperopt"] }) {
  return (
    <div className="card pad">
      <div className="row-between">
        <strong className="small">{label}</strong>
        {gate ? (
          gate.ok ? <Badge tone="success">ok</Badge> : <Badge tone="danger">failed</Badge>
        ) : (
          <Badge tone="muted">not run</Badge>
        )}
      </div>
      {gate ? (
        gate.ok ? (
          gate.protocol ? <p className="muted small">{gate.protocol}</p> : <p className="muted small">engine reported success.</p>
        ) : (
          <p className="danger-text small">{gate.error ?? "gate engine failed"}</p>
        )
      ) : (
        <p className="muted small">no gate engine result was returned.</p>
      )}
    </div>
  )
}

export function WalkForwardCard() {
  const [symbol, setSymbol] = useState("")
  const [result, setResult] = useState<WalkForwardResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const r = await runWalkForward({ symbol: symbol.trim().toUpperCase() })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : "walk-forward backtest failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="pad stack">
      <div className="row-between">
        <h3>Walk-Forward Hyperopt</h3>
        {result ? <Badge tone="success">{result.windowsCompleted} windows</Badge> : null}
      </div>
      <p className="muted small">
        Anchored walk-forward: each fold validates only after the search trained on preceding folds.
        Historical simulation — not financial advice, no orders are placed.
      </p>
      <div className="row gap" style={{ alignItems: "flex-end" }}>
        <Field label="Symbol">
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="e.g. EURUSD"
            style={{ width: 140 }}
          />
        </Field>
        <Button disabled={busy || !symbol.trim()} onClick={run}>
          {busy ? "Running…" : "Run walk-forward"}
        </Button>
      </div>
      {error ? <p className="danger-text">{error}</p> : null}
      {busy ? <Spinner label="Running walk-forward backtest…" /> : null}
      {!busy && !result && !error ? <p className="muted small">Run a walk-forward backtest to see results.</p> : null}
      {result ? (
        <div className="stack">
          <p className="muted small">
            {result.symbol} · horizon {result.horizonDays}d · train {result.trainWindow} · test {result.testWindow} · step {result.stepSize}
            {result.gateWalkForward?.ok === true ? ` · ${result.gateWalkForward.windowsEvaluated} hyperopt folds evaluated` : ""}
            {result.name ? ` · ${result.name}` : ""}
          </p>
          <div className="grid grid-4">
            <Card className="pad">
              <div className="stat-label muted">Walk-Forward Hit Rate</div>
              <div className="stat-value" style={{ color: (result.walkForwardHitRate ?? 0) > 50 ? "#4ade80" : "#ff6b6b" }}>
                {fmtPct(result.walkForwardHitRate)}
              </div>
              <div className="muted small">{result.windowsCompleted} windows completed</div>
            </Card>
            <Card className="pad">
              <div className="stat-label muted">Total Return</div>
              <div className="stat-value" style={{ color: result.totalReturnPct >= 0 ? "#4ade80" : "#ff6b6b" }}>
                {result.totalReturnPct >= 0 ? "+" : ""}{result.totalReturnPct.toFixed(2)}%
              </div>
            </Card>
            <Card className="pad">
              <div className="stat-label muted">Max Drawdown</div>
              <div className="stat-value danger-text">{result.maxDrawdownPct.toFixed(2)}%</div>
            </Card>
            <Card className="pad">
              <div className="stat-label muted">Gate Search</div>
              <div className="stat-value small">
                {result.gateHyperopt?.ok && result.gateWalkForward?.ok ? "ok" : result.gateHyperopt?.ok === false || result.gateWalkForward?.ok === false ? "failed" : "no result"}
              </div>
            </Card>
          </div>
          <MiniEquityCurve equity={result.equity} drawdown={result.drawdown} />
          {result.windowDetails.length > 0 ? (
            <div>
              <h4 className="small">Walk-Forward Windows</h4>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>#</th><th>Train start</th><th>Test start</th><th>Hit Rate</th><th>Outcome</th><th>Return</th></tr>
                  </thead>
                  <tbody>
                    {result.windowDetails.map((w) => (
                      <tr key={w.idx}>
                        <td>{w.idx}</td>
                        <td>{w.trainStart}</td>
                        <td>{w.testStart}</td>
                        <td>{fmtPct(w.hitRate)}</td>
                        <td>
                          <Badge tone={w.hit ? "success" : "danger"}>{w.hit ? "hit" : "miss"}</Badge>
                        </td>
                        <td style={{ color: w.returnPct >= 0 ? "#4ade80" : "#ff6b6b" }}>
                          {w.returnPct >= 0 ? "+" : ""}{w.returnPct.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <div className="grid grid-2">
            <GateBlock label="Gate hyperopt" gate={result.gateHyperopt} />
            <GateBlock label="Gate walk-forward" gate={result.gateWalkForward} />
          </div>
        </div>
      ) : null}
    </Card>
  )
}