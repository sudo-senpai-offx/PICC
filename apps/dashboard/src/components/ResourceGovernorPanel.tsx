// G3 — PICC_RESOURCE_GOVERNOR_v1.md §7: Resource surface. Dumb consumer of
// the pure display logic in resourceGovernorDisplay.ts — every string this
// panel renders comes from there ("—" never fabricated zeros). Self-fetches
// on mount, refreshes every 30s, plus a manual Refresh (tick re-runs the
// same effect; the interval is cleaned up on every re-run, so polls never
// stack).
import { useEffect, useState } from "react"
import { getResourceOverview } from "@/lib/api"
import type { ResourceOverview } from "@/lib/api"
import {
  budgetSheet,
  featureBurnDown,
  governorBanner,
  ledgerTable,
  verdictSummary
} from "@/lib/resourceGovernorDisplay"

const th: React.CSSProperties = { textAlign: "left", padding: "4px 10px 4px 0", fontSize: 12, color: "#999", borderBottom: "1px solid #333" }
const td: React.CSSProperties = { padding: "4px 10px 4px 0", fontSize: 13, borderBottom: "1px solid #222" }

export function ResourceGovernorPanel() {
  const [data, setData] = useState<ResourceOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const load = () => {
      getResourceOverview()
        .then((d) => {
          if (!alive) return
          setData(d)
          setError(null)
          setRefreshedAt(new Date().toISOString().slice(0, 19) + "Z")
        })
        .catch((e: unknown) => {
          if (alive) setError(String(e))
        })
    }
    load()
    const id = setInterval(() => setTick((t) => t + 1), 30000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [tick])

  if (error) return <p className="muted">Resource overview unavailable: {error}</p>
  if (!data) return <p className="muted">Loading resource overview…</p>

  const banner = governorBanner(data)
  const v = verdictSummary(data)
  const tiers = budgetSheet(data)
  const burns = featureBurnDown(data)
  const rows = ledgerTable(data)

  const verdictCell = (label: string, value: string, tone: string) => (
    <span style={{ marginRight: 16 }}>
      <span className="muted">{label}: </span>
      <strong style={{ color: tone }}>{value}</strong>
    </span>
  )

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        <strong>
          {banner.enabled ? "●" : "○"} {banner.text}
        </strong>
      </p>

      <div style={{ marginTop: 4 }}>
        {verdictCell("Accepted", v.accepted, "#8bc34a")}
        {verdictCell("Throttled", v.throttled, "#d4a017")}
        {verdictCell("Failed", v.failed, "#e05656")}
      </div>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>Tier</th>
            <th style={th}>Calls</th>
            <th style={th}>Tokens</th>
            <th style={th}>Avg latency</th>
            <th style={th}>Verdicts A·T·F</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t.tier}>
              <td style={td}>
                <strong>{t.tier}</strong> <span className="muted">{t.label}</span>
              </td>
              <td style={td}>{t.calls}</td>
              <td style={td}>{t.tokens}</td>
              <td style={td}>{t.avgLatencyMs}</td>
              <td style={td}>{t.verdicts}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted" style={{ margin: 0 }}>
        T2 burst: <strong>{data.burst.T2.callsThisHour}</strong> / {data.burst.T2.limitPerHour} heavy calls
        this hour <span className="muted">(resets hourly — overflow goes to T3)</span>
      </p>

      <div>
        <strong style={{ fontSize: 13 }}>Per-feature burn</strong>
        {burns.length === 0 ? (
          <p className="muted" style={{ margin: "4px 0 0" }}>No calls recorded yet.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Feature</th>
                <th style={th}>Calls</th>
                <th style={th}>Accepted</th>
                <th style={th}>Throttled</th>
                <th style={th}>Failed</th>
                <th style={th}>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {burns.map((b) => (
                <tr key={b.feature}>
                  <td style={td}>{b.feature}</td>
                  <td style={td}>{b.calls}</td>
                  <td style={td}>{b.accepted}</td>
                  <td style={td}>{b.throttled}</td>
                  <td style={td}>{b.failed}</td>
                  <td style={td}>{b.tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <strong style={{ fontSize: 13 }}>Ledger — live table</strong>
        <span className="muted"> (newest first, up to 50 rows)</span>
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: "4px 0 0" }}>No calls recorded yet.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Time (UTC)</th>
                <th style={th}>Feature</th>
                <th style={th}>Tier</th>
                <th style={th}>Verdict</th>
                <th style={th}>Tokens</th>
                <th style={th}>Latency</th>
                <th style={th}>Model</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.createdAt}-${i}`}>
                  <td style={td} className="muted">{r.createdAt}</td>
                  <td style={td}>{r.feature}</td>
                  <td style={td}>{r.tier}</td>
                  <td style={td}>{r.verdict}</td>
                  <td style={td}>{r.tokens}</td>
                  <td style={td}>{r.latencyMs}</td>
                  <td style={td} className="muted">{r.model}</td>
                  <td style={td}>{r.degraded ? <span className="muted">degraded</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="row" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setTick((t) => t + 1)}>
          Refresh
        </button>
        {refreshedAt && <span className="muted">updated {refreshedAt}</span>}
      </div>
    </div>
  )
}