import { useEffect, useState } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { Card, Badge, Spinner } from "@/components/ui"
import { useUser } from "@/hooks/useAuth"
import { getHealth, getBtcpayStatus } from "@/lib/api"
import type { HealthInfo, SerperVerdictInfo } from "@/lib/api"
import { listData } from "@/lib/localdata"
import type { AgentLog, SimulationRow } from "@/lib/types"
import { formatMoney, listAccounts, listTransactions, netWorthTotals, syncTradingAccount } from "@/lib/finance"
import { getPaperOverview, getTradingStatus } from "@/lib/trading"
import type { TradingStatus } from "@/lib/trading"
import { getStreams, getEarnings, streamSummary } from "@/lib/streams"
import { StreamBreakdown } from "@/components/IncomeStreams"
import { CryptoMarkets } from "@/components/CryptoMarkets"

// Control-deck entry points. Destinations must be LIVE P1 routes only — the
// de-linked top-level pages (/simulator, /income, /agents, /streams/:id) have
// no routes in P1 and must never appear here (whole-branch review 2026-09-08).
export const QUICK_ACTIONS: ReadonlyArray<{ icon: string; label: string; hint: string; to: string }> = [
  { icon: "📈", label: "Predict market", hint: "Markets & prediction", to: "/suites/trading" },
  { icon: "📈", label: "Suites", hint: "Manage all ministries", to: "/suites" }
]

function SystemStatus() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null)
  const [btcpay, setBtcpay] = useState<Awaited<ReturnType<typeof getBtcpayStatus>> | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    Promise.allSettled([getHealth(), getBtcpayStatus()]).then(([h, b]) => {
      if (h.status === "fulfilled") setHealth(h.value)
      else setError("Backend /api not reachable — start it with `npm run dev` or `npm run start:all`.")
      if (b.status === "fulfilled") setBtcpay(b.value)
    })
  }, [])

  const rows: [string, boolean, string][] = [
    ["Yahoo Finance", health?.providers.yahoo ?? false, "real market data"],
    ["LLM rotation", health?.providers.llm ?? false, "Gemini/Groq/Mistral/Cerebras/OpenAI + more"],
    ["Stripe", health?.providers.stripe ?? false, "card billing"],
    ["BTCPay", health?.providers.btcpay ?? false, "self-hosted crypto checkout"],
    ["eWallet (TNG)", health?.providers.ewallet ?? true, "manual payment"],
    ["CoinGecko", health?.providers.crypto ?? true, "free crypto market data"],
    ["Agents crew", health?.providers.agents ?? false, "CrewAI microservice"],
    ["Amazon SP-API", health?.providers.amazon ?? false, "competitor intel"]
  ]

  const nodeTone = btcpay?.reachable ? (btcpay.synchronized ? "success" : "warn") : btcpay ? "warn" : "muted"

  return (
    <Card className="stack">
      <h2 className="h2">System status</h2>
      {error ? <p className="muted">{error}</p> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, on, note]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>
                  <Badge tone={on ? "success" : "muted"}>{on ? "configured" : "off"}</Badge>
                </td>
                <td className="muted small">{note}</td>
              </tr>
            ))}
            <tr>
              <td>BTCPay node</td>
              <td>
                {btcpay ? (
                  <Badge tone={nodeTone}>
                    {btcpay.reachable ? (btcpay.synchronized ? "synced" : "syncing") : "unreachable"}
                  </Badge>
                ) : (
                  <Badge tone="muted">unknown</Badge>
                )}
              </td>
              <td className="muted small">
                {btcpay ? (btcpay.reachable ? (btcpay.synchronized ? "ready to take invoices" : "node still syncing blockchain") : "set BTCPAY_URL in apps/dashboard/.env") : "probing…"}
              </td>
            </tr>
            <SerperHealthRow serper={health?.serper} />
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Configure keys in <code>apps/dashboard/.env</code>.
      </p>
    </Card>
  )
}

/**
 * Serper status row. Reports OBSERVED verdict (serperVerdict from /api/health),
 * never key presence: a set-but-rejected key must show as rejected, a key that
 * passed once but aged past the freshness window as stale, and an unused key as
 * unverified. providers().serper stays out of this row on purpose.
 */
function SerperHealthRow({ serper }: { serper: SerperVerdictInfo | undefined }) {
  if (!serper) return <tr><td>Serper research</td><td><Badge tone="muted">unknown</Badge></td><td className="muted small">probing…</td></tr>
  if (!serper.configured) {
    return <tr><td>Serper research</td><td><Badge tone="muted">off</Badge></td><td className="muted small">set SERPER_API_KEY in apps/dashboard/.env for live news + search</td></tr>
  }
  const o = serper.observed
  if (!o) {
    return <tr><td>Serper research</td><td><Badge tone="warn">configured · unverified</Badge></td><td className="muted small">key is set but no live request has succeeded yet</td></tr>
  }
  if (o.probe === "ok") {
    return (
      <tr>
        <td>Serper research</td>
        <td><Badge tone={serper.stale ? "warn" : "success"}>{serper.stale ? "verified · stale" : "verified"}</Badge></td>
        <td className="muted small">
          {serper.stale
            ? "last live request succeeded, but more than 10 minutes ago — not currently verified"
            : "live news + search verified against Serper"}
        </td>
      </tr>
    )
  }
  return (
    <tr>
      <td>Serper research</td>
      <td><Badge tone="danger">{o.probe === "rejected" ? `rejected (${String(o.status)})` : "error"}</Badge></td>
      <td className="muted small">
        {o.probe === "rejected" ? `${o.message} · ` : ""}check SERPER_API_KEY
      </td>
    </tr>
  )
}

export function Dashboard() {
  const user = useUser()
  const navigate = useNavigate()
  const [sims, setSims] = useState<SimulationRow[]>([])
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [netWorth, setNetWorth] = useState<{ usdTotal: number; byCurrency: Record<string, number>; accountCount: number } | null>(null)
  const [tradingStatus, setTradingStatus] = useState<TradingStatus | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    Promise.all([listData<SimulationRow>("simulations"), listData<AgentLog>("agent_logs")])
      .then(([s, l]) => {
        const mine = (row: { user_id?: string | null }) => row.user_id === user.id
        setSims(s.rows.filter(mine).slice(0, 5))
        setLogs(l.rows.filter(mine).slice(0, 6))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [user])

  useEffect(() => {
    // PICC_FULL_SCOPE Part 2a: net worth is computed from the real finance
    // tracker (accounts + transactions over /api/data/*), with the paper
    // trading balance wired in as one auto-synced account. No more dead
    // snapshots or temporary fallbacks.
    if (!user) return
    let cancelled = false
    Promise.all([listAccounts(), listTransactions(), getPaperOverview()])
      .then(async ([accs, txs, ov]) => {
        const synced = await syncTradingAccount(accs, ov.ok ? ov.cash : null)
        if (cancelled) return
        const { usdTotal, byCurrency } = netWorthTotals(synced, txs)
        setNetWorth({ usdTotal, byCurrency, accountCount: synced.length })
      })
      .catch(() => {
        if (!cancelled) setNetWorth(null)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    getTradingStatus().then(setTradingStatus).catch(() => setTradingStatus(null))
    getHealth().then(setHealth).catch(() => setHealth(null))
  }, [user])

  const money = (n: unknown) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n) || 0)

  const netWorthHasValue = netWorth !== null && (netWorth.usdTotal !== 0 || Object.keys(netWorth.byCurrency).length > 0)
  const netWorthDisplay = netWorthHasValue && netWorth ? formatMoney(netWorth.usdTotal) : "—"
  const netWorthNote =
    netWorth === null
      ? "Finance tracker unavailable — start the backend, then add accounts on the Profile page."
      : netWorth.accountCount === 0
        ? "No accounts yet — add one on the Profile page → Finance tracker."
        : `computed from ${netWorth.accountCount} live account${netWorth.accountCount === 1 ? "" : "s"}`
  const summary = streamSummary(getStreams(), getEarnings())
  const incomeToday = summary.today ? `$${Math.round(summary.today).toLocaleString("en-US")}` : "—"
  const incomeMonthly = summary.monthly ? `$${Math.round(summary.monthly).toLocaleString("en-US")}/mo` : "—"

  const quickActions = QUICK_ACTIONS.map((a) => ({ ...a, onClick: () => navigate(a.to) }))

  return (
    <div className="stack stack-lg">
      <header>
        <h1>Income Command Centre</h1>
        <p className="muted">
          Welcome{user?.email ? `, ${user.email}` : ""}. Everything financial lives here at a glance —
          your AI agents analyze; you decide.
        </p>
      </header>

      <Card className="hero-card">
            <div className="row space-between wrap">
              <div className="stack">
                <div className="metric-label">Net worth · computed from live accounts</div>
                <div className="hero-value">{netWorthDisplay}</div>
                <div className="muted small">{netWorthNote}</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {netWorth && netWorth.accountCount > 0 ? (
                    <Badge tone="success">
                      ● {netWorth.accountCount} account{netWorth.accountCount === 1 ? "" : "s"} tracked
                    </Badge>
                  ) : (
                    <Badge tone="muted">Finance tracker</Badge>
                  )}
                  <span className="muted small">
                    {incomeToday} today · {incomeMonthly} this month · {summary.activeCount} active stream{summary.activeCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="hero-spark-wrap">
                <div className="hero-spark-empty muted small">
                  Net worth is computed live — manage accounts & transactions on the Profile page
                </div>
              </div>
            </div>
          </Card>

          {/* ── Ministry status hero strip ── */}
          <div className="grid-3">
            <Card>
              <NavLink to="/suites/trading" className={({ isActive }) => (isActive ? "nav-link card active" : "nav-link card")}>
                <div className="row gap" style={{ alignItems: "center" }}>
                  <span style={{ fontSize: 24 }}>📈</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>Launch Trading Suite</div>
                    <div className="muted small">
                      {tradingStatus
                        ? `${formatMoney(tradingStatus.paper.cash)} cash · ${tradingStatus.paper.openCount} open`
                        : "unavailable"}
                    </div>
                  </div>
                </div>
              </NavLink>
            </Card>
            <Card>
              <NavLink to="/suites/earnings" className={({ isActive }) => (isActive ? "nav-link card active" : "nav-link card")}>
                <div className="row gap" style={{ alignItems: "center" }}>
                  <span style={{ fontSize: 24 }}>💰</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>Launch Earnings Suite</div>
                    <div className="muted small">
                      {summary.activeCount > 0
                        ? `${summary.activeCount} stream${summary.activeCount === 1 ? "" : "s"} · ${incomeMonthly}`
                        : "no streams yet"}
                    </div>
                  </div>
                </div>
              </NavLink>
            </Card>
            <Card>
              <NavLink to="/suites/intelligence" className={({ isActive }) => (isActive ? "nav-link card active" : "nav-link card")}>
                <div className="row gap" style={{ alignItems: "center" }}>
                  <span style={{ fontSize: 24 }}>🧠</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>Launch Intelligence Suite</div>
                    <div className="muted small">
                      {health
                        ? `${Object.values(health.providers).filter(Boolean).length} providers configured`
                        : "unavailable"}
                    </div>
                  </div>
                </div>
              </NavLink>
            </Card>
          </div>

          {/* ── Per-stream breakdown (REQ-D.1): each stream links to its owning
               ministry, resolved through the classification registry ── */}
          <Card className="stack">
            <h2 className="h2" style={{ margin: 0 }}>Income streams</h2>
            <p className="muted small">
              Every stream links to the ministry that owns its family, resolved through the registry.
            </p>
            <StreamBreakdown streams={getStreams()} />
          </Card>

          {/* ── Ministry summary grid (real client reads, no fabricated values) ── */}
          <Card className="stack">
            <h2 className="h2" style={{ margin: 0 }}>Ministry summary</h2>
            <div className="grid-4">
              <div>
                <div className="metric-label">Paper PnL realized</div>
                <div className="metric-value">
                  {tradingStatus ? formatMoney(tradingStatus.paper.realizedPnl) : "unavailable"}
                </div>
                <span className="muted small">Trading ministry</span>
              </div>
              <div>
                <div className="metric-label">Active streams</div>
                <div className="metric-value">{summary.activeCount}</div>
                <span className="muted small">Earnings ministry</span>
              </div>
              <div>
                <div className="metric-label">Accounts tracked</div>
                <div className="metric-value">
                  {netWorth ? netWorth.accountCount : "unavailable"}
                </div>
                <span className="muted small">Finance tracker</span>
              </div>
              <div>
                <div className="metric-label">Net worth</div>
                <div className="metric-value">{netWorthDisplay}</div>
                <span className="muted small">{netWorthNote}</span>
              </div>
            </div>
          </Card>

          {/* ── Ministry room quick-links ── */}
          {/* keep in sync with MinistryShell INNER_NAV (SP-1) */}
          <Card className="stack">
            <h2 className="h2" style={{ margin: 0 }}>Ministry rooms</h2>
            <div className="grid-3">
              {[
                { to: "/suites/trading/dashboard", label: "Trading Dashboard", hint: "Overview & status" },
                { to: "/suites/trading/markets", label: "Markets", hint: "Charts & analysis" },
                { to: "/suites/trading/paper", label: "Paper Trading", hint: "Simulated trades" },
                { to: "/suites/earnings/dashboard", label: "Earnings Dashboard", hint: "Revenue overview" },
                { to: "/suites/earnings/simulator", label: "Income Simulator", hint: "Income modelling" },
                { to: "/suites/intelligence/dashboard", label: "Intelligence Dashboard", hint: "Research overview" },
                { to: "/suites/intelligence/guidance", label: "Guidance", hint: "Advisor & insights" }
              ].map((room) => (
                <NavLink
                  key={room.to}
                  to={room.to}
                  className={({ isActive }) => (isActive ? "nav-link card active" : "nav-link card")}
                >
                  <div style={{ fontWeight: 600 }}>{room.label}</div>
                  <div className="muted small">{room.hint}</div>
                </NavLink>
              ))}
            </div>
          </Card>

          <Card className="stack">
            <div className="row-between">
              <h2 className="h2" style={{ margin: 0 }}>⚡ Control Deck</h2>
              <span className="muted small">One-click entry points — everything else is in the ⌘ palette (Ctrl K)</span>
            </div>
            <div className="quick-actions">
              {quickActions.map((a) => (
                <button key={a.label} type="button" className="quick-action" onClick={a.onClick}>
                  <span className="quick-action-icon">{a.icon}</span>
                  <span className="quick-action-label">{a.label}</span>
                  <span className="quick-action-hint muted small">{a.hint}</span>
                </button>
              ))}
            </div>
          </Card>

          <SystemStatus />

          <CryptoMarkets />

          {loading ? (
            <Spinner />
          ) : (
            <>
              <Card>
                <h2 className="h2">Recent simulations</h2>
                {sims.length === 0 ? (
                  <p className="muted">
                    No simulations yet. New simulations will run from the Trading ministry (under development).
                  </p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Median projection</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sims.map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td><Badge>{s.type}</Badge></td>
                          <td>{money((s.results as { medianEnd?: number })?.medianEnd)}</td>
                          <td className="muted">{new Date(s.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card>
                <h2 className="h2">Recent agent activity</h2>
                {logs.length === 0 ? (
                  <p className="muted">No AI agent activity logged yet.</p>
                ) : (
                  <ul className="list">
                    {logs.map((l) => (
                      <li key={l.id} className="list-row">
                        <span>
                          <Badge>{l.agent_name}</Badge> <strong>{l.action}</strong>
                        </span>
                        <span className="muted">{new Date(l.created_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
    </div>
  )
}
