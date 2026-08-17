import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Card, Badge, Spinner } from "@/components/ui"
import { useUser } from "@/hooks/useAuth"
import { getHealth, getBtcpayStatus, getExtensionStatus } from "@/lib/api"
import { listData } from "@/lib/localdata"
import type { AgentLog, SimulationRow } from "@/lib/types"
import { getHoldings, getSnapshots } from "@/lib/finance"
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

  const money = (n: unknown) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n) || 0)

  const snapshots = getSnapshots()
  const lastSnap = snapshots[snapshots.length - 1] ?? null
  const prevSnap = snapshots[snapshots.length - 2] ?? null
  const netWorth = lastSnap
    ? `MYR ${Math.round(lastSnap.total).toLocaleString("en-US")}`
    : getHoldings().length > 0
      ? "Add a holding"
      : "—"
  const deltaPct = lastSnap && prevSnap && prevSnap.total ? ((lastSnap.total - prevSnap.total) / prevSnap.total) * 100 : null
  const summary = streamSummary(getStreams(), getEarnings())
  const incomeMonthly = summary.monthly ? `$${Math.round(summary.monthly).toLocaleString("en-US")}/mo` : "—"

  const sparkPoints = (() => {
    if (snapshots.length < 2) return ""
    const totals = snapshots.map((s) => s.total)
    const min = Math.min(...totals)
    const max = Math.max(...totals)
    const range = max - min || 1
    return totals
      .map((t, i) => `${(i / (totals.length - 1)) * 100},${100 - ((t - min) / range) * 100}`)
      .join(" ")
  })()

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
                <div className="metric-label">Net worth · last snapshot</div>
                <div className="hero-value">{netWorth}</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {deltaPct != null ? (
                    <Badge tone={deltaPct >= 0 ? "success" : "danger"}>
                      {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}% vs prior snapshot
                    </Badge>
                  ) : (
                    <Badge tone="muted">No prior snapshot</Badge>
                  )}
                  <span className="muted small">
                    {incomeMonthly} passive · {summary.activeCount} active stream{summary.activeCount === 1 ? "" : "s"}
                    {lastSnap ? ` · snapshot ${new Date(lastSnap.date).toLocaleDateString()}` : ""}
                  </span>
                </div>
              </div>
              <div className="hero-spark-wrap">
                {sparkPoints ? (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="hero-spark" aria-hidden>
                    <polyline points={sparkPoints} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                  </svg>
                ) : (
                  <div className="hero-spark-empty muted small">Snapshot history will chart here</div>
                )}
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
