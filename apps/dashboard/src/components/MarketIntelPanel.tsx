import { useEffect, useRef, useState } from "react"
import { Badge, Card, Spinner } from "@/components/ui"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { getMarketIntel } from "@/lib/liveTrading"
import type { MarketIntel, MarketIntelRow, MarketIntelStrategy } from "@/lib/liveTrading"

function scorePct(score: number): number {
  return Math.round((score + 1) * 50)
}

function toneFor(pct: number): "success" | "danger" | "muted" {
  return pct >= 65 ? "success" : pct <= 35 ? "danger" : "muted"
}

function StrategyChip({ label, s }: { label: string; s: MarketIntelStrategy }) {
  const pct = scorePct(s.score)
  return (
    <span title={s.reason} style={{ cursor: "help" }}>
      <Badge tone={toneFor(pct)}>
        {label} {pct}%
      </Badge>
    </span>
  )
}

function ActionBadge({ row }: { row: MarketIntelRow }) {
  if (row.action === "call") return <Badge tone="success">CALL ↑</Badge>
  if (row.action === "put") return <Badge tone="danger">PUT ↓</Badge>
  return <Badge tone="muted">stand aside</Badge>
}

function IntelCard({ intel, compact }: { intel: MarketIntel; compact?: boolean }) {
  const r = intel.recommendation
  const best = intel.best

  if (!best) {
    return (
      <Card className="pad stack">
        <div className="row-between">
          <h3 className="h3" style={{ margin: 0 }}>Best market now</h3>
          <Badge tone="muted">no data</Badge>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{intel.honesty}</p>
      </Card>
    )
  }

  const isTradable = Boolean(r)
  return (
    <Card className="pad stack" style={{ borderColor: isTradable ? "var(--success, #22c55e)" : undefined }}>
      <div className="row-between wrap" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ fontSize: "1.05rem" }}>{best.asset}</strong>
          <ActionBadge row={best} />
        </div>
        <div className="row" style={{ gap: 8 }}>
          {best.confidence != null ? <Badge tone={isTradable ? "success" : "muted"}>conf {best.confidence}%</Badge> : null}
          <Badge tone="accent">intel {best.intelScore}</Badge>
        </div>
      </div>

      {!compact ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {best.phaseLabel ? <Badge tone="muted">{best.phaseLabel}</Badge> : null}
          {best.expirySec != null ? <Badge tone="muted">{best.expirySec}s expiry</Badge> : null}
          {best.strategies.duration?.label ? (
            <Badge tone="muted">vol {best.strategies.duration.label}</Badge>
          ) : null}
          {best.winProb != null ? <Badge tone="muted">win prob {(best.winProb * 100).toFixed(0)}%</Badge> : null}
        </div>
      ) : null}

      {isTradable && r ? (
        <div className="stack" style={{ gap: 6 }}>
          <p className="muted small" style={{ margin: 0 }}>
            {r.action === "call" ? "Buy / CALL" : "Sell / PUT"} {r.market} · {r.expirySec}s expiry ·{" "}
            {r.volatility ? `volatility ${r.volatility}` : ""} — size to a per-trade risk cap.
          </p>
          {r.reasons.slice(0, compact ? 2 : 5).map((reason, i) => (
            <p key={i} className="muted small" style={{ margin: 0 }}>· {reason}</p>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          <strong>Watch:</strong> {best.asset} ({best.verdict ?? "insufficient data"}) — {intel.honesty}
        </p>
      )}
    </Card>
  )
}

/**
 * Compact "best market now" banner for the content-window control rail —
 * appears only when the user is actually on a trading platform. Shows the
 * precise manual-entry recommendation (or an honest stand-aside).
 */
export function MarketIntelBanner() {
  const { snapshot } = useRealtimeSuite()
  const intel = snapshot?.intel ?? null
  if (!intel) {
    return (
      <Card className="pad">
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <Spinner label="Analyzing markets…" />
        </div>
      </Card>
    )
  }
  if (intel.error) {
    return (
      <Card className="pad">
        <p className="muted small" style={{ margin: 0 }}>Market intel unavailable — {intel.error}</p>
      </Card>
    )
  }
  return <IntelCard intel={intel} compact />
}

/**
 * Full market meta-analysis: best-market recommendation, the six expert
 * strategies, volatility / trade-duration guidance and the ranked watch set.
 */
export function MarketIntelPanel() {
  const { snapshot } = useRealtimeSuite()
  const [intel, setIntel] = useState<MarketIntel | null>(snapshot?.intel ?? null)
  const lastIntelTs = useRef(snapshot?.intel?.ts ?? 0)

  useEffect(() => {
    getMarketIntel()
      .then((r) => {
        if ((r.ts ?? 0) >= lastIntelTs.current) {
          lastIntelTs.current = r.ts ?? 0
          setIntel(r)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    // Compare server timestamps, never the client clock (NTP skew used to
    // reject perfectly valid streamed intel as "stale").
    if (snapshot?.intel && (snapshot.intel.ts ?? 0) >= lastIntelTs.current) {
      lastIntelTs.current = snapshot.intel.ts ?? 0
      setIntel(snapshot.intel)
    }
  }, [snapshot])

  if (!intel) {
    return (
      <Card className="pad stack">
        <h3 className="h3" style={{ margin: 0 }}>Best market now</h3>
        <Spinner label="Analyzing the whole watch set…" />
      </Card>
    )
  }
  if (intel.error) {
    return (
      <Card className="pad stack">
        <h3 className="h3" style={{ margin: 0 }}>Best market now</h3>
        <p className="danger-text" style={{ margin: 0 }}>{intel.error}</p>
      </Card>
    )
  }

  const best = intel.best
  const strategies = best?.strategies

  return (
    <Card className="pad stack">
      <div className="row-between">
        <h3 className="h3" style={{ margin: 0 }}>Best market now</h3>
        <span className="muted small">
          {new Date(intel.ts).toLocaleTimeString()} · {intel.ranked.length} markets
        </span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Realtime meta-analysis over the watch set — six expert strategies scored per market
        (multi-timeframe top-down, market phase, volume/order flow, asymmetric R:R, realized
        edge, volatility↔duration fit). PICC only recommends an entry when a market clears the bar.
      </p>

      <IntelCard intel={intel} />

      {best && strategies ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <StrategyChip label="MTF" s={strategies.mtf} />
            <StrategyChip label="Phase" s={strategies.phase} />
            <StrategyChip label="Volume" s={strategies.volume} />
            <StrategyChip label="R:R" s={strategies.rr} />
            <StrategyChip label="Edge" s={strategies.edge} />
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {[
              strategies.mtf.reason,
              strategies.phase.reason,
              strategies.volume.reason,
              strategies.rr.reason,
              strategies.edge.reason
            ].map((reason, i) => (
              <p key={i} className="muted small" style={{ margin: 0 }}>· {reason}</p>
            ))}
            {strategies.duration ? (
              <p className="muted small" style={{ margin: 0 }}>
                · {strategies.duration.reason}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {intel.ranked.length > 1 ? (
        <div className="stack" style={{ gap: 6 }}>
          <h4 style={{ margin: 0 }}>Ranked watch set</h4>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Direction</th>
                  <th>Intel</th>
                  <th>Conf</th>
                  <th>Expiry</th>
                  <th>Vol</th>
                  <th>Regime</th>
                </tr>
              </thead>
              <tbody>
                {intel.ranked.slice(0, 8).map((row) => (
                  <tr key={row.assetId}>
                    <td><strong>{row.asset}</strong></td>
                    <td><ActionBadge row={row} /></td>
                    <td><Badge tone={row.intelScore >= 60 ? "success" : "muted"}>{row.intelScore}</Badge></td>
                    <td>{row.confidence != null ? `${row.confidence}%` : "—"}</td>
                    <td>{row.expirySec != null ? `${row.expirySec}s` : "—"}</td>
                    <td>{row.strategies.duration?.label ?? "—"}</td>
                    <td className="muted small">{row.phaseLabel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="muted small" style={{ margin: 0 }}>{intel.honesty}</p>
    </Card>
  )
}
