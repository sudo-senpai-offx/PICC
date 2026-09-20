// Decision Register — the v3.2 branch (PICC_COPILOT_REDESIGN ch.4 line 48):
// engine tag, five-point execution pillars as a compact score, the cost line
// (EV, cost-adjusted EV, EV/unit risk, margin vs EV_RR_MIN), confidence,
// trip-wire flags with reason text, and the explain verdict. Every figure is
// presence-guarded: null → "—", never a zero.
import type { V32DecisionRow as Row, V32ExplainState, V32Pillar } from "@/lib/v32"
import { EV_RR_MIN, pillarGlyph } from "@/lib/v32"
import { Badge } from "@/components/ui"

function fmtNum(n: number | null | undefined, sign = false): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const s = n.toFixed(2)
  return sign && n > 0 ? `+${s}` : s
}

export function V32DecisionRow({ row, explain }: { row: Row; explain: V32ExplainState | null }) {
  const dir = row.direction === "up" ? "▲" : row.direction === "down" ? "▼" : "→"
  const measured = row.score?.pillars?.filter((p: V32Pillar) => p.available === true).length ?? 0
  const total = row.score?.pillars?.length ?? 0
  const tripped = (row.copilot?.wires ?? []).filter((w) => w.tripped)
  const marginOk = row.costLine?.evRRPass === true

  return (
    <div className={`card pad ${row.verdict === "TRADE" ? "live-cell" : ""}`} data-testid="v32-decision-row">
      <div className="row-between">
        <div className="row gap">
          <Badge tone="success">v3.2</Badge>
          <strong className="small">{row.asset ?? row.assetId}</strong>
          <span className="muted small">{dir} {row.direction ?? "flat"}</span>
        </div>
        <div className="row gap">
          <Badge tone={row.verdict === "TRADE" ? "success" : row.verdict === "OBSERVE" ? "warn" : "muted"}>{row.verdict}</Badge>
          <span className="muted small">conf {row.confidence != null ? `${row.confidence}%` : "—"}</span>
        </div>
      </div>

      <div className="row gap small" style={{ marginTop: 6 }} title="execution pillars (measured / total)">
        <span className="muted">pillars {row.score?.pillars?.length ? `${measured}/${total}` : "—"}</span>
        {(row.score?.pillars ?? []).map((p) => (
          <span key={p.pillar} className={p.available === false ? "muted" : ""} title={p.pillar}>
            {pillarGlyph(p)}
          </span>
        ))}
      </div>

      <div className="grid grid-3 small" style={{ marginTop: 6, gap: 4 }}>
        <span className="muted">EV <strong>{fmtNum(row.costLine?.ev, true)}</strong></span>
        <span className="muted">EV/RR <strong>{row.costLine?.evRR != null ? row.costLine.evRR.toFixed(1) : "—"}</strong></span>
        <span className="muted">margin <strong className={marginOk ? "" : "danger-text"}>{row.costLine == null ? "—" : `${marginOk ? "✓" : "✗"} (≥${EV_RR_MIN})`}</strong></span>
        <span className="muted">payout <strong>{row.costLine?.payoutBeats ? "beats BE" : "—"}</strong></span>
        <span className="muted">expiry <strong>{row.expiry != null ? `${row.expiry}s` : "—"}</strong></span>
        <span className="muted">explain <strong>{explain?.verdict ?? row.verdict}</strong></span>
      </div>

      {tripped.length ? (
        <div className="small danger-text" style={{ marginTop: 4 }}>
          {tripped.map((w) => `${w.id}✕ ${w.reason}`).join(" · ")}
        </div>
      ) : row.verdict !== "TRADE" ? (
        <p className="muted small" style={{ marginTop: 4 }}>{row.copilot?.blockedBy?.join(", ") || "not tradeable"}</p>
      ) : null}
      {/* Ruling I: rows may be a 4-field OBSERVE ctx-bailout (no asset, no reasons) —
          rendered honestly: no zeros when nothing was measured, no spurious failed
          gates — every absent figure is "—". */}
      {(row.reasons ?? []).length ? <p className="muted small" style={{ marginTop: 4 }}>{(row.reasons ?? []).slice(0, 2).join(" · ")}</p> : null}
    </div>
  )
}