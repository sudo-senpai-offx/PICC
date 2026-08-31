import { useCallback, useEffect, useState } from "react"
import { Card, Badge, Button } from "@/components/ui"
import { getSpread, type SpreadResult } from "@/lib/trading"
import { spreadPanelModel, type SpreadDisplay } from "@/lib/integrationPanels"

/**
 * Cross-venue spread pre-check for the chart asset (spec T5).
 * Honesty: with <2 live venues the edge is "n/a" — NEVER a fabricated 0
 * (the server's `best` is null and its note explains why).
 */
export function SpreadPanel({ assetId }: { assetId: string }) {
  const [model, setModel] = useState<SpreadDisplay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res: SpreadResult = await getSpread(assetId)
      if (res.ok) {
        setModel(spreadPanelModel(res))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "spread check failed")
    }
    setLoading(false)
  }, [assetId])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Cross-Venue Spread</div>
        <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
          {loading ? "..." : "Re-check"}
        </Button>
      </div>

      {error ? (
        <div style={{ fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      ) : !model ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Checking live quotes…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Venues</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{model.quoteCount}</div>
            </div>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Asset</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{assetId}</div>
            </div>
            <div
              style={{
                padding: "4px 8px", borderRadius: 4, textAlign: "center",
                background: model.state === "measured" ? (model.opportunity ? "#4ade8022" : "var(--bg)") : "var(--bg)",
                border: `1px solid ${model.state === "measured" ? (model.opportunity ? "#4ade80" : "var(--border)") : "var(--border)"}`
              }}
            >
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Net edge (after fees)</div>
              {/* Honesty: unmeasured => "n/a", never 0.00% */}
              <div style={{ fontSize: 14, fontWeight: 700, color: model.edgePct === null ? "var(--text-muted)" : model.edgePct >= 0 ? "#4ade80" : "#ff6b6b" }}>
                {model.edgePct === null ? "n/a" : `${model.edgePct >= 0 ? "+" : ""}${model.edgePct}%`}
              </div>
            </div>
            {model.state === "measured" && (
              <Badge tone={model.opportunity ? "success" : "muted"}>
                {model.opportunity ? "opportunity (≥0.1% net)" : "sub-fee noise"}
              </Badge>
            )}
          </div>

          {model.state === "measured" && model.best && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
              Buy {model.best.buyVenue} @ {model.best.buyPrice} · Sell {model.best.sellVenue} @ {model.best.sellPrice} · gross {model.best.grossPct}%
            </div>
          )}

          {model.state === "unmeasured" && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 8 }}>
              {model.quoteCount < 2
                ? "n/a — need ≥2 live venues quoting this instrument"
                : "spread unmeasurable from the venues polled"}
            </div>
          )}

          {model.quoteCount > 0 && (
            <div style={{ maxHeight: 120, overflowY: "auto", marginTop: 4 }}>
              {model.state === "measured" && model.quotes.map((q) => (
                <div key={q.venue} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-muted)" }}>{q.venue}</span>
                  <span>{q.price}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.4 }}>
            {model.quoteCount} venue(s) polled · {model.note}
          </div>
        </>
      )}
    </Card>
  )
}