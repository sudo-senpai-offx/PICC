import { Badge, Card } from "@/components/ui"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import {
  convergenceDisplayRows,
  fmt,
  headerMetric,
  NDA,
  stateTone,
  whyText
} from "@/lib/convergenceDisplay"
import type { ConvergenceState } from "@/lib/liveTrading"

/**
 * MTF Convergence read for the viewed asset (spec 7c): per-plane matrix
 * (in-buffer live / M1-aggregated / absent), the deterministic state machine
 * output (NO TRADE / WAIT / WATCH / ONLY / BIAS), the why reasons, and the
 * 5-scale alignment / quality / confidence header. Rides the shared realtime
 * stream (useRealtimeSuite) — no second SSE connection. Absent reads render
 * as "—", never 0 (R10 honesty).
 */
function stateBadge(state: string) {
  return <Badge tone={stateTone(state)}>{state}</Badge>
}

function signCell(sign: "▲" | "▼" | "·" | "—", tone: "up" | "down" | "flat" | "none") {
  const color = tone === "up" ? "var(--success)" : tone === "down" ? "var(--danger)" : "var(--text-muted)"
  return <span style={{ color, fontWeight: 700 }}>{sign}</span>
}

export function ConvergencePanel() {
  const { snapshot } = useRealtimeSuite()
  const c = snapshot?.convergence ?? null
  const rows = convergenceDisplayRows(c)
  const ready = c !== null

  return (
    <Card className="pad">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong>MTF Convergence</strong>
        {ready && c?.asset != null && <Badge tone="muted">{c.asset}</Badge>}
      </div>

      {!ready ? (
        <div className="muted small" style={{ padding: 12, textAlign: "center" }}>
          No convergence read yet — connect a broker session to begin evaluation.
        </div>
      ) : (
        <>
          {/* State machine header */}
          <div className="row-between" style={{ marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {stateBadge(c.state as ConvergenceState)}
              {c.meta.conservative && <Badge tone="warn">conservative</Badge>}
              {(c.meta.active ?? 0) > 0 && (
                <Badge tone="muted">
                  {c.meta.active} of {c.meta.available} planes active
                </Badge>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Badge tone={c.score5 == null ? "muted" : c.score5 >= 4 ? "success" : c.score5 >= 2 ? "warn" : "muted"}>
                {headerMetric(c.score5, "score")}
              </Badge>
              <Badge tone="muted">Q {fmt(c.quality)}</Badge>
              <Badge tone={c.confidence == null ? "muted" : c.confidence >= 65 ? "success" : c.confidence >= 55 ? "warn" : "muted"}>
                {headerMetric(c.confidence, "pct")} conf
              </Badge>
            </div>
          </div>

          {/* Why reasons */}
          {whyText(c) !== NDA && (
            <div className="muted small" style={{ marginBottom: 8 }}>
              {whyText(c)}
            </div>
          )}

          {/* Per-plane matrix */}
          {rows.length === 0 ? (
            <div className="muted small" style={{ padding: 12, textAlign: "center" }}>No timeframes requested.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto auto auto auto auto", gap: "4px 12px", alignItems: "center", fontSize: 11 }}>
              <div className="muted">TF</div>
              <div className="muted">Role</div>
              <div className="muted">Source</div>
              <div className="muted" style={{ textAlign: "right" }}>Sign</div>
              <div className="muted" style={{ textAlign: "right" }}>Score</div>
              <div className="muted" style={{ textAlign: "right" }}>Amp</div>
              <div className="muted" style={{ textAlign: "right" }}>ADX</div>
              <div />
              {rows.map((p) => (
                <div key={p.key} style={{ display: "contents" }}>
                  <span>{p.tfLabel}</span>
                  <span>{p.role ?? NDA}</span>
                  <span className="muted">
                    {p.source}
                    {p.stale ? " ⚠" : ""}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {signCell(p.sign, p.sign === "▲" ? "up" : p.sign === "▼" ? "down" : p.sign === "—" ? "none" : "flat")}
                  </span>
                  <span style={{ textAlign: "right" }}>{p.score}</span>
                  <span style={{ textAlign: "right" }}>{p.amplitude}</span>
                  <span style={{ textAlign: "right" }}>{p.adx}</span>
                  <span />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}