import { Badge } from "@/components/ui"
import { regimeBadge } from "@/lib/convergenceDisplay"
import type { RegimeBlock } from "@/lib/liveTrading"

/**
 * The additive regime-engine chip (B-REG-5): regime + confidence + factor
 * line, with an honest "advisory, not applied" tag whenever the regime read
 * did NOT modulate the displayed weights. A missing/empty block renders as
 * "unknown" — never a zero-confidence reading (R10). Relocated out of the
 * deleted ConvergencePanel wrapper (slice 7 / T12) with no change in shape:
 * the chip is rendered where the convergence rows are, not in a panel shell.
 */
export function RegimeBadge({ block }: { block: RegimeBlock | null | undefined }) {
  const b = regimeBadge(block)
  return (
    <div className="row-between" style={{ gap: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Badge tone={b.tone}>{b.text}</Badge>
        {b.tag && <Badge tone="muted">{b.tag}</Badge>}
      </div>
      {b.factors.length > 0 && (
        <div className="muted small" style={{ flex: "1 1 auto", minWidth: 180, textAlign: "right" }}>
          {b.factors.join(" · ")}
        </div>
      )}
    </div>
  )
}