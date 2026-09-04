import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, Badge, Button, Skeleton } from "@/components/ui"
import { tradingCorrelation, type CorrelationResult } from "@/lib/api"

/**
 * Correlation screen for the held/watchlist portfolio (R6). Consumes
 * /api/trading/correlation (server fetches 3mo histories, returns matrix,
 * ranked pairs, high-correlation pairs and a diversification score).
 *
 * Honesty rules: no measured pairs renders as that observed state — a "—"
 * score, never a fabricated zero; a single instrument cannot produce a
 * meaningful diversification score, so the card says so.
 */
export function CorrelationScreen({ symbols }: { symbols?: string[] | null }) {
  const symbolKey = JSON.stringify(symbols ?? null)
  const [data, setData] = useState<CorrelationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const parsed: string[] | undefined =
        symbols && symbols.length ? symbols.map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined
      setData(await tradingCorrelation(parsed))
    } catch (e) {
      setError(e instanceof Error ? e.message : "correlation fetch failed")
    }
    setLoading(false)
    // symbols identity is captured via symbolKey — a stable primitive dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  useEffect(() => { void refresh() }, [refresh])

  const ranked = useMemo(() => {
    const pairs = [...(data?.pairs ?? [])]
    return pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).slice(0, 8)
  }, [data])

  const measured = (data?.symbols?.length ?? 0) >= 2
  const score = data?.diversificationScore

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Correlation screen</div>
        <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
          {loading ? "..." : "Refresh"}
        </Button>
      </div>

      {error ? (
        <div style={{ fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      ) : !data ? (
        <div aria-busy="true" className="skeleton-row">
          <Skeleton width="70%" />
          <Skeleton width="45%" />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Diversification</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{measured ? (score ?? "—") : "—"}</div>
            </div>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Instruments</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{data.symbols?.length ?? 0}</div>
            </div>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Pairs</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{(data.pairs ?? []).length}</div>
            </div>
          </div>

          {(data.symbols?.length ?? 0) === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 8 }}>
              No instruments measured — add watchlist holdings to screen pairs.
            </div>
          )}

          {(data.symbols?.length ?? 0) === 1 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 8 }}>
              A single instrument can&apos;t be screened — add at least one more.
            </div>
          )}

          {(data.symbols?.length ?? 0) >= 2 && ranked.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 8 }}>
              No measured pairs yet — histories may still be warming up.
            </div>
          )}

          {ranked.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Top pairs by |correlation|</div>
              {ranked.map((p, i) => {
                const hot = Math.abs(p.correlation) >= 0.8
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                    <span>
                      {p.asset1} × {p.asset2}
                      {hot && <span style={{ marginLeft: 6 }}><Badge tone="danger">high corr</Badge></span>}
                    </span>
                    <span style={{ color: hot ? "#ffb86c" : "var(--text)", fontWeight: 700 }}>
                      {p.correlation >= 0 ? "+" : ""}{p.correlation.toFixed(2)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 6 }}>
            advisory · decision support only — correlation ≠ causation
          </div>
        </>
      )}
    </Card>
  )
}
