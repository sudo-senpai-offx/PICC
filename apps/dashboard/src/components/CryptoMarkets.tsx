import { useEffect, useState } from "react"
import { Card, Spinner } from "./ui"
import { getCryptoMarket } from "@/lib/api"
import type { CryptoMarket, CryptoCoin } from "@/lib/api"

function price(n: number | null): string {
  if (n == null) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 }).format(n)
}

function ChangePill({ change }: { change: number | null }) {
  if (change == null) return <span className="muted small">—</span>
  const up = change >= 0
  const v = Math.abs(change * 100).toFixed(1)
  return (
    <span className="small" style={{ color: up ? "var(--success)" : "var(--danger)" }}>
      {up ? "▲" : "▼"} {v}%
    </span>
  )
}

function CoinCard({ coin }: { coin: CryptoCoin }) {
  return (
    <div className="stat">
      <span className="metric-label">
        {coin.name} <span className="muted small">{coin.symbol}</span>
      </span>
      <span className="metric-value small">{price(coin.price)}</span>
      <ChangePill change={coin.change24h} />
    </div>
  )
}

export function CryptoMarkets() {
  const [data, setData] = useState<CryptoMarket | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(true)

  const load = async () => {
    setBusy(true)
    setError("")
    try {
      setData(await getCryptoMarket())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <Card className="stack">
      <div className="row space-between">
        <h2 className="h2">Crypto &amp; markets</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={busy}>
          ↻ Refresh
        </button>
      </div>
      <p className="muted small">
        Free market data from CoinGecko (no key, no account). Not investment advice.
      </p>

      {busy && !data ? <Spinner label="Loading crypto market…" /> : null}
      {error && !data ? <p className="muted">{error}</p> : null}

      {data ? (
        <>
          <div className="grid-3">
            {data.watchlist.slice(0, 9).map((c) => (
              <CoinCard key={c.id} coin={c} />
            ))}
          </div>

          {data.trending.length > 0 ? (
            <div>
              <span className="metric-label">Trending today</span>
              <div className="row wrap" style={{ gap: 8 }}>
                {data.trending.slice(0, 8).map((t) => (
                  <span key={t.id ?? t.name} className="badge badge-accent">
                    {t.name} <span className="muted small">{t.symbol?.toUpperCase()}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {data.movers.gainers.length > 0 || data.movers.losers.length > 0 ? (
            <div className="grid-2">
              <div>
                <span className="metric-label" style={{ color: "var(--success)" }}>
                  Top gainers (24h)
                </span>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {data.movers.gainers.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.name}</strong>
                            <div className="muted small">{c.symbol}</div>
                          </td>
                          <td>{price(c.price)}</td>
                          <td>
                            <ChangePill change={c.change24h} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <span className="metric-label" style={{ color: "var(--danger)" }}>
                  Top losers (24h)
                </span>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {data.movers.losers.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.name}</strong>
                            <div className="muted small">{c.symbol}</div>
                          </td>
                          <td>{price(c.price)}</td>
                          <td>
                            <ChangePill change={c.change24h} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}
