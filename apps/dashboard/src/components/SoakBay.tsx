// v3.2 Soak Status bay (PICC_COPILOT_REDESIGN ch.4). Lives off the realtime
// suite snapshot's additive `v32` section. Honesty contract: stale = visibly
// stale; absent buffers / off lane = the vault note, never zeros, never
// interpolated digits.
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { fmtUptime } from "@/lib/v32"
import { Badge, Card } from "@/components/ui"

const STALE_MS = 12_000

export function SoakBay() {
  const { snapshot, connected } = useRealtimeSuite()
  const v32 = snapshot?.v32 ?? null
  const stale = !connected || (snapshot != null && Date.now() - snapshot.ts > STALE_MS)

  return (
    <Card className="pad stack">
      <div className="row-between">
        <div className="row">
          <strong>V3.2 Soak Status</strong>
          {v32 ? (
            <Badge tone={stale ? "warn" : v32.mode === "powered" ? "success" : "muted"}>
              {stale ? "stale" : v32.mode}
            </Badge>
          ) : (
            <Badge tone="muted">absent</Badge>
          )}
        </div>
        <span className="muted small">flip-readiness at a glance</span>
      </div>

      {!v32 ? (
        <p className="muted small" data-testid="soak-empty">
          awaiting live buffers (≥40 × 1m per asset) — a broker session must be live to fill the v3.2 register.
        </p>
      ) : (
        <div className="grid grid-4 small" style={{ marginTop: 6, gap: 4 }}>
          <span className="muted">lane <strong>{v32.mode}</strong></span>
          <span className="muted"><strong>{v32.watch.total}</strong> watched</span>
          <span className="muted"><strong>{v32.watch.buffered}</strong> buffered{" "}
            <em className="muted">{v32.watch.reason ? "(no feed)" : "(≥40 × 1m)"}</em></span>
          <span className="muted">decisions <strong>{v32.decisions.resolved} / {v32.decisions.total}</strong></span>
          <span className="muted">breakeven <strong>{v32.breakeven != null ? v32.breakeven : "—"}</strong></span>
          <span className="muted">uptime <strong>{fmtUptime(v32.uptime.seconds)}</strong></span>
          <span className="muted">candidate <strong>{v32.flipGate.candidateTrades} ♣</strong></span>
          <span className="muted">legacy <strong>{v32.flipGate.legacyTrades}</strong></span>
        </div>
      )}

      {v32 ? (
        <>
          <div className="row gap small muted" style={{ marginTop: 6 }}>
            <span>flip gate</span>
            <Badge tone={v32.flipGate.flip ? "success" : "muted"}>{v32.flipGate.flip ? "READY" : "soaking"}</Badge>
            <span className="muted small">{v32.flipGate.reason}</span>
          </div>
          {!v32.enabled && v32.soak?.reason ? (
            <p className="muted small" style={{ marginTop: 6 }}>{v32.soak.reason}</p>
          ) : null}
          {v32.uptime.reason && !v32.enabled ? (
            <p className="muted small" style={{ marginTop: 2 }}>{v32.uptime.reason}</p>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}