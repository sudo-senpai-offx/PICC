import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui"
import { getBrokers, type BrokerRow, type LatencyRow } from "@/lib/trading"

// ── Slice B — honest + searchable Data Sources ─────────────────────────────
// Surfaces why the live chart can show "no data": every registered source and
// its true state (connected / configured-but-idle / unconfigured), the asset
// classes it can serve live vs. only EOD, its net latency, and a plain-language
// diagnosis when intraday is empty. Searchable by name / asset class /
// capability / exchange. Honesty rule: a broker that never connected stays
// "unconfigured" — it is never dressed up as connected with zero data.

// Human truth about each broker's live-vs-EOD coverage per asset class.
const COVERAGE: Record<string, { live: string[]; eod: string[] }> = {
  expertoption: { live: ["Forex", "Metals", "Indices", "Crypto"], eod: [] },
  ccxt: { live: ["Crypto"], eod: [] },
  yahoo: { live: [], eod: ["Forex", "Metals", "Energies", "Indices", "Crypto", "Equities"] },
  paper: { live: [], eod: [] }
}

const CAP_LABEL: Record<string, string> = {
  "market-data": "Market data",
  "binary-options": "Binary options",
  "spot-orders": "Spot orders",
  "demo-trading": "Demo trading",
  "close-position": "Close position",
  positions: "Positions",
  account: "Account"
}

function tfLabel(sec: number): string {
  const m: Record<number, string> = { 5: "5s", 15: "15s", 30: "30s", 60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h", 86400: "1D", 604800: "1W", 2592000: "1M" }
  return m[sec] ?? `${sec}s`
}

export function DataSourcesPanel() {
  const [rows, setRows] = useState<BrokerRow[] | null>(null)
  const [latency, setLatency] = useState<Record<string, LatencyRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let alive = true
    getBrokers()
      .then((res) => {
        if (!alive) return
        setRows(res.brokers ?? null)
        setLatency(res.latency ?? null)
        setLoading(false)
      })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows ?? []
    return (rows ?? []).filter((b) => {
      const hay = [
        b.label, b.slug, b.category, b.notes,
        ...(b.capabilities ?? []),
        ...(b.pairs?.map((p) => `${p.exchange} ${p.symbol}`) ?? []),
        ...(b.liveExchanges ?? []),
        ...(COVERAGE[b.slug]?.live ?? []),
        ...(COVERAGE[b.slug]?.eod ?? [])
      ].join(" ").toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query])

  // A live feed exists when any market-data broker is connected.
  const liveProviderConnected = (rows ?? []).some(
    (b) => b.configured === true && b.connected === true && (b.capabilities ?? []).includes("market-data") && b.slug !== "paper"
  )

  return (
    <Card className="stack">
      <div className="row-between" style={{ alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Data Sources</h3>
        <span className="muted small">
          live feed:{" "}
          <span style={{ color: liveProviderConnected ? "#4ade80" : "#fbbf24", fontWeight: 600 }}>
            {liveProviderConnected ? "live" : "offline"}
          </span>
        </span>
      </div>
      {loading ? (
        <p className="muted small">Loading source status…</p>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sources (crypto, forex, binance, live…)"
            style={{ width: "100%", boxSizing: "border-box", margin: "8px 0", padding: "7px", background: "#16162c", border: "1px solid #2a2a4a", color: "#eef0ff", borderRadius: 6 }}
          />
          {!filtered.length ? (
            <p className="muted small" style={{ margin: 0 }}>No sources match "{query}".</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map((b) => {
                const cov = COVERAGE[b.slug] ?? { live: [], eod: [] }
                const lat = latency?.[b.slug]
                const state = !b.configured
                  ? { text: "unconfigured", color: "#666" }
                  : b.connected
                    ? { text: "connected", color: "#4ade80" }
                    : { text: "configured · idle", color: "#fbbf24" }
                const whyEmpty =
                  b.slug === "expertoption"
                    ? (b.configured && !b.connected
                      ? "Session rejected / not connected — live intraday needs a connected EO session."
                      : "EO only pushes live while its account session is connected.")
                    : b.slug === "ccxt"
                      ? (b.configured && !b.connected
                        ? "Exchanges idle — public market data needs no API key; add a Broker pair in Settings → Trading."
                        : (b.connected ? "Serving live crypto candles now." : "Not configured — add a Broker pair in Settings → Trading for live crypto (no key needed)."))
                      : b.slug === "yahoo"
                        ? "EOD only — no intraday (5s..4h), but always available for daily/weekly/monthly."
                        : b.connected ? "Serving live data now." : "Not configured — enable this source in Settings → Trading."
                return (
                  <div key={b.slug} style={{ border: "1px solid #2a2a4a", borderRadius: 8, padding: "8px 10px" }}>
                    <div className="row-between" style={{ alignItems: "center" }}>
                      <strong style={{ color: "#e6e8ff" }}>{b.label}</strong>
                      <span style={{ color: state.color, fontWeight: 600 }}>{state.text}</span>
                    </div>
                    <div className="muted small" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      <span>class: {b.category}</span>
                      {(b.capabilities ?? []).map((c) => <span key={c}>· {CAP_LABEL[c] ?? c}</span>)}
                    </div>
                    {cov.live.length ? <div className="muted small" style={{ marginTop: 2 }}>live: <strong>{cov.live.join(", ")}</strong></div> : null}
                    {cov.eod.length ? <div className="muted small" style={{ marginTop: 2 }}>EOD only: {cov.eod.join(", ")}</div> : null}
                    {b.pairs?.length ? (
                      <div className="muted small" style={{ marginTop: 2 }}>
                        pairs: {b.pairs.map((p) => `${p.exchange} ${p.symbol}${p.timeframe ? ` ${p.timeframe}` : ""}`).join(" · ")}
                      </div>
                    ) : null}
                    {b.liveExchanges?.length ? (
                      <div className="muted small" style={{ marginTop: 2 }}>connected exchanges: {b.liveExchanges.join(", ")}</div>
                    ) : null}
                    {Array.isArray(b.timeframes) && b.timeframes.length ? (
                      <div className="muted small" style={{ marginTop: 2 }}>
                        serves: {b.timeframes.map(tfLabel).join(" · ")}
                        {lat?.medianMs != null ? <> · fetch {lat.medianMs}ms</> : null}
                      </div>
                    ) : null}
                    <div className="small" style={{ color: state.text === "unconfigured" ? "#888" : "#e2e8f0", marginTop: 4 }}>
                      {whyEmpty}
                    </div>
                    {b.slug === "ccxt" ? (
                      <div
                        className="small"
                        style={{
                          marginTop: 6,
                          background: "#101024",
                          border: "1px solid #2a2a4a",
                          borderRadius: 6,
                          padding: "6px 8px",
                          color: "#9ca3c8",
                          fontFamily: "ui-monospace, monospace",
                          lineHeight: 1.5,
                          overflowX: "auto",
                          whiteSpace: "pre"
                        }}
                      >
{`Add in Settings → Trading → CCXT exchanges (public, no key):
[
 { "exchange": "binance", "symbol": "BTCUSDT", "timeframe": "5m" },
 { "exchange": "coinbase", "symbol": "ETH/USD", "timeframe": "5m" },
 { "exchange": "binance", "symbol": "SOLUSDT", "timeframe": "1m" }
]
Also reachable (crypto): XRP · ADA · DOGE · LINK · AVAX · DOT · LTC`}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
