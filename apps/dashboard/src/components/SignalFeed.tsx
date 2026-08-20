import { useEffect, useState } from "react"
import { Badge, Card, Spinner } from "@/components/ui"
import { getTradingSignals, getSignalAccuracy } from "@/lib/trading"
import type { TradingSignal, SignalAccuracy } from "@/lib/trading"

const REFRESH_MS = 15_000

function fmtTime(iso: string | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  } catch {
    return "—"
  }
}

function fmtPct(n: number | null | undefined, d = 0): string {
  if (n == null) return "—"
  return `${n.toFixed(d)}%`
}

function SignalRow({ s }: { s: TradingSignal }) {
  const dir = s.direction === "up" ? "▲" : s.direction === "down" ? "▼" : "→"
  const tone = s.direction === "up" ? "success" : s.direction === "down" ? "danger" : "muted"
  return (
    <div className="signal-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Badge tone={tone}>{dir}</Badge>
        <strong className="small">{s.symbol ?? "—"}</strong>
        <span className="muted small">{fmtTime(s.createdAt)}</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {s.confidence != null && <Badge tone={s.confidence >= 60 ? "success" : s.confidence >= 50 ? "warn" : "muted"}>{fmtPct(s.confidence)}</Badge>}
        {typeof s.source === "string" && s.source && <span className="muted small">{s.source}</span>}
      </div>
    </div>
  )
}

function AccuracyBar({ stats }: { stats: SignalAccuracy | null }) {
  if (!stats) return null
  return (
    <Card className="pad" style={{ marginBottom: 12 }}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <strong className="small">Signal Accuracy</strong>
        <Badge tone={stats.winRate != null && stats.winRate >= 55 ? "success" : "warn"}>
          {stats.winRate != null ? `${stats.winRate}%` : "—"} win rate
        </Badge>
      </div>
      <div className="muted small">
        {stats.total} resolved · {stats.wins} wins · {stats.losses} losses · {stats.draws} draws
      </div>
      {stats.byDirection && stats.byDirection.length > 0 && (
        <div className="row gap" style={{ marginTop: 6 }}>
          {stats.byDirection.map((b) => (
            <Badge key={b.key} tone={b.winRate != null && b.winRate >= 55 ? "success" : "muted"}>
              {b.key}: {b.winRate != null ? `${b.winRate}%` : "—"} ({b.total})
            </Badge>
          ))}
        </div>
      )}
    </Card>
  )
}

export function SignalFeed({ maxItems = 25 }: { maxItems?: number }) {
  const [signals, setSignals] = useState<TradingSignal[]>([])
  const [accuracy, setAccuracy] = useState<SignalAccuracy | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [sigRes, accRes] = await Promise.allSettled([getTradingSignals(), getSignalAccuracy()])
        if (!active) return
        if (sigRes.status === "fulfilled") setSignals((sigRes.value?.signals ?? []).slice(0, maxItems))
        if (accRes.status === "fulfilled") setAccuracy(accRes.value)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { active = false; clearInterval(timer) }
  }, [maxItems])

  if (loading) return <Spinner label="Loading signals…" />

  return (
    <div>
      <AccuracyBar stats={accuracy} />
      <Card className="pad">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <strong>Recent Signals</strong>
          <Badge tone="muted">{signals.length}</Badge>
        </div>
        {signals.length === 0 ? (
          <div className="muted small" style={{ padding: 12, textAlign: "center" }}>No signals recorded yet. Signals appear when the confluence engine evaluates assets.</div>
        ) : (
          signals.map((s) => <SignalRow key={s.id} s={s} />)
        )}
      </Card>
    </div>
  )
}
