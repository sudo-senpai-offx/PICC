import { useEffect, useState } from "react"
import { Badge, Button, Card } from "@/components/ui"
import { getModelMatrix, type ModelMatrixResult } from "@/lib/trading"

/**
 * Model Matrix — live multiplexing consensus view.
 * Polls /api/trading/models every 10s for the given asset and renders each
 * model's vote with confidence bars + adaptive weights and the fused verdict.
 */
export function ModelMatrixPanel({ assetId }: { assetId: string }) {
  const [matrix, setMatrix] = useState<ModelMatrixResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await getModelMatrix(assetId)
        if (alive) setMatrix(r)
      } catch {
        if (alive) setMatrix(null)
      }
      if (alive) setLoading(false)
    }
    void load()
    const timer = setInterval(load, 10_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [assetId])

  const c = matrix?.consensus
  const dirColor = c?.direction === "up" ? "#4ade80" : c?.direction === "down" ? "#ff6b6b" : "#f59e0b"
  const dirArrow = c?.direction === "up" ? "▲" : c?.direction === "down" ? "▼" : "◆"

  const refreshNow = () => {
    setLoading(true)
    getModelMatrix(assetId)
      .then((r) => setMatrix(r))
      .catch(() => setMatrix(null))
      .finally(() => setLoading(false))
  }

  return (
    <Card className="pad stack">
      <div className="row-between">
        <h3 style={{ margin: 0 }}>Model Matrix</h3>
        <div className="row gap" style={{ alignItems: "center" }}>
          <span className="muted small">{assetId}</span>
          <Button variant="ghost" className="btn-sm" onClick={refreshNow}>
            refresh
          </Button>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Seven independent models multiplexed per tick — trend, momentum, RSI reversion,
        breakout, MACD, Monte-Carlo drift and candle pressure. Weights adapt online from
        settled outcomes; confidence shrinks when the battery disagrees.
      </p>

      {!matrix || !matrix.ok ? (
        <p className="muted small">{loading ? "Running model battery…" : matrix?.reason ?? "Model matrix unavailable."}</p>
      ) : (
        <>
          <div className="grid grid-3">
            <Card className="pad" style={{ border: `1px solid ${dirColor}` }}>
              <div className="stat-label muted">Consensus</div>
              <div className="stat-value" style={{ color: dirColor }}>
                {dirArrow} {String(c!.direction).toUpperCase()}
              </div>
            </Card>
            <Card className="pad">
              <div className="stat-label muted">Confidence</div>
              <div className="stat-value">{c!.confidence}%</div>
            </Card>
            <Card className="pad">
              <div className="stat-label muted">Agreement</div>
              <div className="stat-value">{c!.agree}/{c!.total}</div>
            </Card>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Model</th><th>Vote</th><th style={{ width: "40%" }}>Confidence</th><th>Weight</th><th>Note</th></tr>
              </thead>
              <tbody>
                {(matrix.votes ?? []).map((v) => {
                  const vc = v.direction === "up" ? "#4ade80" : v.direction === "down" ? "#ff6b6b" : "var(--text-muted)"
                  const arrow = v.direction === "up" ? "▲" : v.direction === "down" ? "▼" : "◆"
                  return (
                    <tr key={v.short}>
                      <td>{v.name}</td>
                      <td><Badge tone={v.direction === "up" ? "success" : v.direction === "down" ? "danger" : "muted"}>{arrow} {v.direction}</Badge></td>
                      <td>
                        <div className="row" style={{ gap: 6, alignItems: "center" }}>
                          <div style={{ flex: 1, background: "var(--bg)", borderRadius: 2, height: 5, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(100, Math.round(v.confidence))}%`, background: vc }} />
                          </div>
                          <span className="muted small">{Math.round(v.confidence)}%</span>
                        </div>
                      </td>
                      <td className="muted small">×{v.weight.toFixed(2)}</td>
                      <td className="muted small">{v.note}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {Object.keys(matrix.weights ?? {}).length > 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              learned weights:{" "}
              {Object.entries(matrix.weights!).map(([k, w]) => `${k} ${w.accuracy}% (n=${w.samples})`).join(" · ")}
            </p>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              weights are neutral until settled trades feed the online learner — run the autopilot or paper trades to calibrate.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
