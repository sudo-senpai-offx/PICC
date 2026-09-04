import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Card, Badge, Spinner } from "@/components/ui"
import { useUser } from "@/hooks/useAuth"
import { getHealth, getBtcpayStatus, getExtensionStatus } from "@/lib/api"
import { listData } from "@/lib/localdata"
import type { AgentLog, SimulationRow } from "@/lib/types"
import { formatMoney, listAccounts, listTransactions, netWorthTotals, syncTradingAccount } from "@/lib/finance"
import { getPaperOverview } from "@/lib/trading"
import { getStreams, getEarnings, streamSummary } from "@/lib/streams"
import { CryptoMarkets } from "@/components/CryptoMarkets"

function SystemStatus() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null)
  const [btcpay, setBtcpay] = useState<Awaited<ReturnType<typeof getBtcpayStatus>> | null>(null)
  const [extStatus, setExtStatus] = useState<Awaited<ReturnType<typeof getExtensionStatus>> | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    Promise.allSettled([getHealth(), getBtcpayStatus(), getExtensionStatus()]).then(([h, b, e]) => {
      if (h.status === "fulfilled") setHealth(h.value)
      else setError("Backend /api not reachable — start it with `npm run dev` or `npm run start:all`.")
      if (b.status === "fulfilled") setBtcpay(b.value)
      if (e.status === "fulfilled") setExtStatus(e.value)
    })
  }, [])

  const rows: [string, boolean, string][] = [
    ["PICC Extension", extStatus?.installed ?? false, extStatus?.installed ? "connected — providing live metrics" : "install from extensions/picc-overlay/"],
    ["Yahoo Finance", health?.providers.yahoo ?? false, "real market data"],
    ["LLM rotation", health?.providers.llm ?? false, "Gemini/Groq/Mistral/Cerebras/OpenAI + more"],
    ["Serper research", health?.providers.serper ?? false, "live news + search"],
    ["Stripe", health?.providers.stripe ?? false, "card billing"],
    ["PayPal", health?.providers.paypal ?? false, "no-business checkout"],
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
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Configure keys in <code>apps/dashboard/.env</code>.
      </p>
    </Card>
  )
}

export function Dashboard() {
  const user = useUser()
  const navigate = useNavigate()
  const [sims, setSims] = useState<SimulationRow[]>([])
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [netWorth, setNetWorth] = useState<{ usdTotal: number; byCurrency: Record<string, number>; accountCount: number } | null>(null)

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
  const incomeMonthly = summary.monthly ? `$${Math.round(summary.monthly).toLocaleString("en-US")}/mo` : "—"

  const quickActions = [
    { icon: "📊", label: "Financial Twin", hint: "Monte Carlo projection", onClick: () => navigate("/simulator") },
    { icon: "📈", label: "Predict market", hint: "Markets & prediction", onClick: () => navigate("/simulator?tab=markets") },
    { icon: "📈", label: "Suites", hint: "Manage all suites", onClick: () => navigate("/suites") },
    { icon: "💰", label: "Income streams", hint: "View streams", onClick: () => navigate("/income") },
    { icon: "💳", label: "Payment link", hint: "Invoice a buyer", onClick: () => navigate("/income") }
  ]

  return (
    <div className="stack stack-lg">
      <header>
        <h1>Command Center</h1>
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
                    {incomeMonthly} passive · {summary.activeCount} active stream{summary.activeCount === 1 ? "" : "s"}
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

          <div className="grid-4">
            <Card>
              <div className="metric-label">Active Simulations</div>
              <div className="metric-value">{sims.length}</div>
              <Link to="/simulator" className="link-btn">
                Run a new simulation →
              </Link>
            </Card>
            <Card>
              <div className="metric-label">AI Agent Status</div>
              <div className="metric-value">
                <Badge tone="success">● Idle</Badge>
              </div>
              <span className="muted">Researcher · Analyst · Content Creator</span>
            </Card>
            <Card>
              <div className="metric-label">Ready to cash out</div>
              <div className="metric-value">{summary.cashoutReady.length}</div>
              <Link to="/income" className="link-btn">
                View streams →
              </Link>
            </Card>
            <Card>
              <div className="metric-label">Agent Insights</div>
              <div className="metric-value">{logs.length}</div>
              <Link to="/agents" className="link-btn">
                View activity →
              </Link>
            </Card>
          </div>

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
                    No simulations yet. Try the Financial Twin emulator — it never touches real money.
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
