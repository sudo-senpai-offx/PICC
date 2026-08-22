import { useEffect, useRef, useState } from "react"
import { Badge, Card, Spinner } from "@/components/ui"
import { getTradingDecisions, type LiveDecision } from "@/lib/liveTrading"

const REFRESH_MS = 20_000

function verdictBadge(v: string) {
  if (v === "TRADE") return <Badge tone="success">TRADE</Badge>
  if (v === "OBSERVE") return <Badge tone="warn">OBSERVE</Badge>
  return <Badge tone="muted">NEUTRAL</Badge>
}

function GaugeBar({ value, max = 1, color = "var(--accent)" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, (Math.abs(value) / max) * 100))
  return (
    <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden", flex: 1 }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.3s" }} />
    </div>
  )
}

function DecisionCard({ d }: { d: LiveDecision }) {
  const groups: Record<string, number> = d.groups ?? {}
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {verdictBadge(d.verdict)}
          <strong className="small">{d.asset}</strong>
          {d.direction && <Badge tone={d.direction === "up" ? "success" : d.direction === "down" ? "danger" : "muted"}>{d.direction}</Badge>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {d.expiry && <span className="muted small">{d.expiry}s</span>}
          {d.confidence != null && <Badge tone={d.confidence >= 65 ? "success" : d.confidence >= 55 ? "warn" : "muted"}>{d.confidence}%</Badge>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px", fontSize: 11, color: "var(--text-muted)" }}>
        <div>Score: {d.score?.toFixed(3)}</div>
        <div>Phase: {d.phase ?? "—"}</div>
        {d.winProb != null && <div>Win prob: {(d.winProb * 100).toFixed(1)}%</div>}
        {d.ev != null && <div>EV: {(d.ev * 100).toFixed(1)}%</div>}
        {d.payout != null && <div>Payout: {d.payout}%</div>}
        {d.mtf && <div>MTF: {d.mtf.agree}/{d.mtf.total} agree</div>}
        {d.sentiment && d.sentiment.score !== 0 && (
          <div>Sentiment: {d.sentiment.score > 0 ? "+" : ""}{d.sentiment.score.toFixed(2)} {d.sentiment.aligned ? "✓" : "✗"}</div>
        )}
      </div>
      {/* Confluence group bars */}
      <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
        {Object.entries(groups).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)" }}>
            <span style={{ width: 20, textAlign: "right" }}>{k.slice(0, 3)}</span>
            <GaugeBar value={v} color={v > 0 ? "var(--success)" : v < 0 ? "var(--danger)" : "var(--text-muted)"} />
          </div>
        ))}
      </div>
      {/* Gate checklist */}
      {d.gates && (
        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          {Object.entries(d.gates).map(([g, pass]) => (
            <Badge key={g} tone={pass ? "success" : "danger"}>{pass ? "✓" : "✗"} {g}</Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export function ConfluencePanel({ maxItems = 8 }: { maxItems?: number }) {
  const [decisions, setDecisions] = useState<LiveDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasDataRef = useRef(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const data = await getTradingDecisions()
        if (!active) return
        setDecisions((data.decisions ?? []).slice(0, maxItems))
        hasDataRef.current = true
        setError(null)
      } catch (e) {
        // Keep stale rows visible after the first successful load — a single
        // failed poll should not blank the panel. Only surface failures while
        // there is nothing to render.
        if (active && !hasDataRef.current) {
          setError(e instanceof Error ? e.message : "failed to load decisions")
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { active = false; clearInterval(timer) }
  }, [maxItems])

  if (loading) return <Spinner label="Loading confluence decisions…" />
  if (error) return <div className="muted small" style={{ padding: 12 }}>Failed to load decisions: {error}</div>

  return (
    <div>
      <Card className="pad">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <strong>Confluence Decisions</strong>
          <Badge tone="muted">{decisions.length} assets</Badge>
        </div>
        {decisions.length === 0 ? (
          <div className="muted small" style={{ padding: 12, textAlign: "center" }}>No decisions yet. Start ExpertOption to begin evaluation.</div>
        ) : (
          decisions.map((d) => <DecisionCard key={d.assetId} d={d} />)
        )}
      </Card>
    </div>
  )
}
