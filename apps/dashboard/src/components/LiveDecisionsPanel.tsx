import { useEffect, useState } from "react"
import { Badge, Card, Spinner } from "@/components/ui"
import type { LiveDecision, LiveDecisions } from "@/lib/liveTrading"
import { getTradingDecisions } from "@/lib/liveTrading"

const REFRESH_MS = 12_000

function fmtPct(n: number | null, d = 0): string {
  if (n == null) return "—"
  return `${(n * 100).toFixed(d)}%`
}

function Gate({ on }: { on: boolean }) {
  return <span className={on ? "muted" : "danger-text"} title={on ? "gate passed" : "gate failed"}>
    {on ? "✓" : "✗"}
  </span>
}

function DecisionRow({ d }: { d: LiveDecision }) {
  const tone: "success" | "warn" | "muted" =
    d.verdict === "TRADE" ? "success" : d.verdict === "OBSERVE" ? "warn" : "muted"
  const dir = d.direction === "flat" ? "→" : d.direction === "up" ? "▲" : "▼"
  return (
    <div className={`card pad ${d.verdict === "TRADE" ? "live-cell" : ""}`}>
      <div className="row-between">
        <strong className="small">{d.asset}</strong>
        <div className="row gap">
          <Badge tone={tone}>{d.verdict}</Badge>
          <Badge tone={d.direction === "up" ? "success" : d.direction === "down" ? "danger" : "muted"}>
            {dir} {d.direction}
          </Badge>
        </div>
      </div>
      <div className="row-between muted small">
        <span>{d.phaseLabel ?? "—"}</span>
        <span>
          score {d.score != null ? (d.score > 0 ? "+" : "") + d.score.toFixed(2) : "—"} · conf{" "}
          {d.confidence != null ? `${d.confidence}%` : "—"}
        </span>
      </div>
      <div className="grid grid-4 small" style={{ marginTop: 6, gap: 4 }}>
        <span className="muted">expiry <strong>{d.expiry ?? "—"}s</strong></span>
        <span className="muted">win prob <strong>{fmtPct(d.winProb, 0)}</strong></span>
        <span className="muted">EV/stake <strong>{d.ev != null ? (d.ev >= 0 ? "+" : "") + (d.ev * 100).toFixed(1) + "%" : "—"}</strong></span>
        <span className="muted">
          payout <strong>{d.payout ?? "—"}%</strong>{" "}
          <em className="muted">{d.payoutSource === "observed" ? "(observed)" : d.payoutSource === "assumed" ? "(assumed)" : ""}</em>
        </span>
        <span className="muted">price R:R <strong>{d.priceRR ?? "—"}</strong></span>
        <span className="muted">EV R:R <strong>{d.evRR ?? "—"}</strong></span>
        <span className="muted">MTTD <strong>{d.mttdSec != null ? `${d.mttdSec}s` : "—"}</strong></span>
        <span className="muted">
          ticks <strong>{d.volume?.ratePerMin ?? "—"}/min</strong>{" "}
          {d.volume?.upRatio != null ? `${Math.round(d.volume.upRatio * 100)}%↑` : ""}
        </span>
      </div>
      <div className="row gap small muted" style={{ marginTop: 4 }}>
        <span>score</span><Gate on={d.gates?.score} />
        <span>winProb</span><Gate on={d.gates?.winProb} />
        <span>priceRR</span><Gate on={d.gates?.priceRR} />
        <span>evRR</span><Gate on={d.gates?.evRR} />
        <span>payout</span><Gate on={d.gates?.payout} />
      </div>
      {d.reasons.length ? <p className="muted small" style={{ marginTop: 4 }}>{d.reasons.slice(0, 2).join(" · ")}</p> : null}
    </div>
  )
}

/**
 * Adaptive-confluence decision board: composite R:R (price-path, EV-weighted
 * and literal-payout) verdicts per watched asset, recomputed server-side every
 * ~15s. Display-only — nothing here places orders.
 */
export function LiveDecisionsPanel() {
  const [data, setData] = useState<LiveDecisions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [first, setFirst] = useState(true)

  useEffect(() => {
    let alive = true
    let cancelled = false
    const tick = async () => {
      try {
        const d = await getTradingDecisions()
        if (alive) {
          setData(d)
          setError(null)
        }
      } catch (err) {
        if (alive) setError((err as Error).message)
      } finally {
        if (alive && !cancelled) {
          setFirst(false)
          setTimeout(tick, REFRESH_MS)
        }
      }
    }
    void tick()
    return () => {
      alive = false
      cancelled = true
    }
  }, [])

  const decisions = data?.decisions ?? []
  const trades = decisions.filter((d) => d.verdict === "TRADE")
  const observes = decisions.filter((d) => d.verdict === "OBSERVE")
  const neutral = decisions.filter((d) => d.verdict === "NEUTRAL")
  const running = data?.status === "connected" || data?.status === "connecting"

  return (
    <Card className="pad stack">
      <div className="row-between">
        <div className="row">
          <strong>Adaptive Confluence</strong>
          <Badge tone={running ? "success" : "muted"}>{running ? "engine live" : "engine idle"}</Badge>
        </div>
        <div className="row muted small">
          {data ? (
            <span>
              updated {new Date(data.ts).toLocaleTimeString()} · {decisions.length} assets
            </span>
          ) : first ? (
            <span>loading…</span>
          ) : null}
        </div>
      </div>
      {error ? <p className="danger-text">{error}</p> : null}
      {first ? (
        <Spinner label="Waiting for the decision engine…" />
      ) : decisions.length === 0 ? (
        <p className="muted small">
          No decisions yet — the engine needs the live 1m buffers to fill (minimum 40 bars per asset) and the
          ExpertOption session connected.
        </p>
      ) : (
        <>
          {trades.length ? (
            <div className="stack">
              <h4 className="small">TRADE candidates — every gate passed</h4>
              {trades.map((d) => (
                <DecisionRow key={d.assetId} d={d} />
              ))}
            </div>
          ) : null}
          {observes.length ? (
            <div className="stack">
              <h4 className="small">Observe — gates not all met</h4>
              {observes.map((d) => (
                <DecisionRow key={d.assetId} d={d} />
              ))}
            </div>
          ) : null}
          {neutral.length ? (
            <details className="muted small">
              <summary>Neutral — stand aside ({neutral.length})</summary>
              <div className="stack">
                {neutral.map((d) => (
                  <DecisionRow key={d.assetId} d={d} />
                ))}
              </div>
            </details>
          ) : null}
          <p className="muted small">
            Honest gate: price-path R:R (median favorable/adverse excursion) ≥ 2:1, EV-weighted R:R ≥ 2:1, and the
            payout must beat break-even with margin. Decision support only — no orders are ever placed.
          </p>
        </>
      )}
    </Card>
  )
}
