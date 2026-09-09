import { useEffect, useState } from "react"
import { Card } from "@/components/ui"
import { createBtcpayInvoice, createEwalletOrder, getHealth, openBrowser, browserTab } from "@/lib/api"
import type { HealthInfo } from "@/lib/api"
import { CatalogTab, OverviewTab, StreamsTab } from "@/components/IncomeStreams"
import { getEarnings, getStreams } from "@/lib/streams"
import { SUITE_META } from "@/lib/suites"
import { ConnectorsPanel } from "@/components/ConnectorsPanel"
import { OverlaySettingsPanel } from "@/components/OverlaySettingsPanel"
import type { IncomeStream } from "@/lib/types"

// ---------------------------------------------------------------------
// Earnings Dashboard — cash flow overview + stream management + catalog
// ---------------------------------------------------------------------
type DashboardTab = "overview" | "streams" | "catalog"

export function EarningsDashboardRoom() {
  const [tab, setTab] = useState<DashboardTab>("overview")

  return (
    <div className="stack stack-lg">
      <header data-room="dashboard">
        <h2>Dashboard</h2>
        <p className="muted small">
          Cash flow across all platforms. Track earnings, monitor sources. Payment channels live
          in Settings.
        </p>
      </header>

      <div className="tabs">
        <button type="button" className={tab === "overview" ? "tab active" : "tab"} onClick={() => setTab("overview")}>
          📊 Overview
        </button>
        <button type="button" className={tab === "streams" ? "tab active" : "tab"} onClick={() => setTab("streams")}>
          🌊 Streams
        </button>
        <button type="button" className={tab === "catalog" ? "tab active" : "tab"} onClick={() => setTab("catalog")}>
          📚 Channel Catalog
        </button>
      </div>

      {tab === "overview" ? <OverviewTab /> : null}
      {tab === "streams" ? <StreamsTab /> : null}
      {tab === "catalog" ? <CatalogTab /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// Earnings Settings — payment channels (re-homed from pages/Income.tsx)
// ---------------------------------------------------------------------
type Channel = "btcpay" | "ewallet"

interface PaymentLinkResult {
  ok: boolean
  kind: Channel
  checkoutLink?: string
  tngNumber?: string
  orderId?: string
  amount?: string
  currency?: string
  description?: string
  error?: string
}

/** Honest status from the health payload — no guessing. */
interface ProviderCard {
  key: string
  title: string
  description: string
  configured: boolean | undefined
  hint?: string
}

const PROVIDER_CARDS: Omit<ProviderCard, "configured">[] = [
  {
    key: "btcpay",
    title: "BTCPay (Bitcoin + Lightning)",
    description: "Self-hosted on your own node. Buyers pay a bitcoin invoice and funds go straight to you — no platform cut. Invoice creation needs the BTCPay store + API key wired after mainnet sync."
  },
  {
    key: "ewallet",
    title: "TNG eWallet",
    description: "Manual transfer to your TNG number. Buyers send the amount and submit their transaction reference.",
    hint: "add EWALLET_TNG_NUMBER to .env to enable"
  },
  {
    key: "paypal",
    title: "PayPal",
    description: "Optional channel. Add a PayPal API key to accept card/PayPal payments."
  },
  {
    key: "stripe",
    title: "Stripe",
    description: "Accept card payments via Stripe. Configure STRIPE_SECRET_KEY in .env."
  },
  {
    key: "crypto",
    title: "Crypto (direct)",
    description: "Accept cryptocurrency payments directly. Configure wallet addresses in .env."
  }
]

function ChannelsTab() {
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [amount, setAmount] = useState("25")
  const [currency, setCurrency] = useState("MYR")
  const [description, setDescription] = useState("Digital product")
  const [channel, setChannel] = useState<Channel>("ewallet")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PaymentLinkResult | null>(null)

  useEffect(() => {
    let alive = true
    getHealth()
      .then((h) => {
        if (alive) setHealth(h)
      })
      .catch((err) => {
        if (alive) setHealthError((err as Error).message)
      })
    return () => {
      alive = false
    }
  }, [])

  const createLink = async () => {
    setBusy(true)
    setResult(null)
    try {
      const payload = { amount: Number(amount), currency, description }
      if (channel === "btcpay") {
        const data = await createBtcpayInvoice(payload)
        setResult({
          ok: true,
          kind: channel,
          checkoutLink: data.checkoutLink,
          amount: String(data.amount ?? amount),
          currency: data.currency ?? currency,
          description
        })
      } else {
        const data = await createEwalletOrder(payload)
        setResult({
          ok: true,
          kind: channel,
          orderId: data.orderId,
          tngNumber: data.tngNumber,
          amount: String(data.amount ?? amount),
          currency: data.currency ?? currency,
          description
        })
      }
    } catch (err) {
      setResult({ ok: false, kind: channel, error: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        No plans. No subscriptions. Every PICC feature is free — the payment methods below are
        how you <strong>receive</strong> money from the products, content, and services you build
        here. Link the channels you use, generate a payment link, and share it with your buyer.
      </p>

      <div className="grid-3">
        {healthError ? (
          <Card>
            <h3>Backend unreachable</h3>
            <p className="small" style={{ color: "#b91c1c" }}>
              {healthError} — status checks below may be stale.
            </p>
          </Card>
        ) : null}
        {PROVIDER_CARDS.map((p) => (
          <Card key={p.key}>
            <h3>{p.title}</h3>
            <p className="small">{p.description}</p>
            <p className="muted small">
              Status: {health?.providers[p.key as keyof typeof health.providers] ? "Configured" : "Not configured"}
              {!health?.providers[p.key as keyof typeof health.providers] && p.hint ? ` — ${p.hint}` : ""}
            </p>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="h2">Create a payment link</h2>
        <p className="muted">Generate a link you can attach to your listing, content, or digital product.</p>
        <div className="stack">
          <label>
            Amount
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" step="0.01" />
          </label>
          <label>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option>MYR</option>
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
              <option>SGD</option>
            </select>
          </label>
          <label>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Channel
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              <option value="ewallet">TNG eWallet (instant, manual ref)</option>
              <option value="btcpay">BTCPay (Bitcoin + Lightning)</option>
            </select>
          </label>
          <button onClick={createLink} disabled={busy}>
            {busy ? "Creating…" : "Create payment link"}
          </button>
        </div>

        {result && !result.ok && (
          <p className="muted" style={{ color: "#b91c1c" }}>
            {result.error}
          </p>
        )}

        {result?.ok && result.kind === "ewallet" && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Waiting for transfer</h3>
            {result.tngNumber ? (
              <p>
                Ask the buyer to transfer <strong>{result.amount} {result.currency}</strong> to{" "}
                <code>{result.tngNumber}</code> (TNG eWallet) and submit reference{" "}
                <code>{result.orderId}</code>.
              </p>
            ) : (
              <p style={{ color: "#b91c1c" }}>
                Configure your TNG number (EWALLET_TNG_NUMBER) before accepting eWallet orders.
              </p>
            )}
          </div>
        )}

        {result?.ok && result.kind === "btcpay" && result.checkoutLink && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Invoice ready</h3>
            <p>
              <strong>{result.amount} {result.currency}</strong> — {result.description}
            </p>
            <p>
              <a href={result.checkoutLink} target="_blank" rel="noreferrer">
                Open invoice checkout →
              </a>
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}

export function EarningsSettingsRoom() {
  return (
    <div className="stack stack-lg">
      <header data-room="settings">
        <h2>Settings</h2>
        <p className="muted small">
          Configure the payment channels you use to receive money.
        </p>
      </header>
      <ChannelsTab />
    </div>
  )
}

// ---------------------------------------------------------------------
// Earnings Simulator — per-stream income modelling (re-homed from
// pages/StreamPage.tsx). No MarketsSuite/AutopilotSuite here: the trading
// panels have their own ministry rooms and stay mounted once.
// ---------------------------------------------------------------------
function usd(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const SUITE_PANELS: Record<string, React.FC> = {
  depin: ConnectorsPanel,
  nft: ConnectorsPanel,
  defi: ConnectorsPanel,
  crypto: ConnectorsPanel,
  p2p: ConnectorsPanel,
  agent: ConnectorsPanel,
  other: ConnectorsPanel,
  dividend: ConnectorsPanel,
  interest: ConnectorsPanel,
  affiliate: ConnectorsPanel,
  content: ConnectorsPanel,
  rental: ConnectorsPanel
}

function StreamInfo({ stream }: { stream: IncomeStream }) {
  const meta = SUITE_META[stream.category]
  const earnings = getEarnings().filter((e) => e.streamId === stream.id)
  const today = earnings.filter((e) => {
    const d = new Date()
    return e.date === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  })
  const todayTotal = today.reduce((s, e) => s + e.amount, 0)

  return (
    <Card>
      <div className="row gap" style={{ alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 28 }}>{meta?.icon ?? "🧭"}</span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>{stream.name}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {stream.category} · {stream.platform} · <span className={`badge badge-${stream.status === "active" ? "success" : "muted"}`}>{stream.status}</span>
          </p>
        </div>
      </div>
      <div className="grid-4" style={{ marginTop: 12 }}>
        <div>
          <div className="muted small">Balance</div>
          <strong>{usd(stream.balance)}</strong>
        </div>
        <div>
          <div className="muted small">Today</div>
          <strong>{usd(todayTotal)}</strong>
        </div>
        <div>
          <div className="muted small">Total earned</div>
          <strong>{usd(stream.totalEarned)}</strong>
        </div>
        <div>
          <div className="muted small">Est. daily</div>
          <strong>{usd(stream.estimatedDaily)}</strong>
        </div>
      </div>
      {stream.url ? (
        <p className="muted small" style={{ marginTop: 8 }}>
          URL: <code>{stream.url}</code>
        </p>
      ) : null}
      {stream.note ? (
        <p className="muted small">{stream.note}</p>
      ) : null}
    </Card>
  )
}

function LaunchBar({ stream }: { stream: IncomeStream }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const launch = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await openBrowser()
      if (stream.url) await browserTab({ action: "new", url: stream.url })
      setMsg("Launched — overlay active in the browser window.")
    } catch (err) {
      setMsg(`Failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="row gap" style={{ alignItems: "center" }}>
        <button className="btn" onClick={launch} disabled={busy}>
          {busy ? "Launching…" : "🚀 Launch in Browser"}
        </button>
        {msg ? <span className="muted small">{msg}</span> : null}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Opens a headed browser window to this stream's dashboard with the PICC overlay active.
      </p>
    </Card>
  )
}

function SuitePanel({ category }: { category: string }) {
  if (category === "trading") {
    return (
      <Card>
        <p className="muted small">
          Trading-platform panels live in the Trading ministry — open Markets for quotes,
          prediction, and charting, or Autopilot for the demo-trading engine.
        </p>
      </Card>
    )
  }
  const Panel = SUITE_PANELS[category]
  if (!Panel) {
    return (
      <Card>
        <p className="muted small">
          No PICC suite panel for this category yet. Configure connectors under
          Earnings → Dashboard → Streams.
        </p>
      </Card>
    )
  }
  return <Panel />
}

export function EarningsSimulatorRoom() {
  const streams = getStreams()
  const [streamId, setStreamId] = useState<string | null>(() => streams[0]?.id ?? null)
  const stream = streams.find((s) => s.id === streamId) ?? null
  const suiteMeta = stream ? SUITE_META[stream.category] : undefined

  return (
    <div className="stack stack-lg">
      <header data-room="simulator">
        <h2>Simulator</h2>
        <p className="muted small">
          Income modelling per stream — projected, recorded, and live-captured earnings with
          launch and overlay controls.
        </p>
      </header>

      <div className="stack">
        <label className="muted small">Income stream</label>
        {streams.length === 0 ? (
          <Card>
            <p className="muted">
              No streams yet — add one under Earnings → Dashboard → Streams, or sync a collector
              to create it automatically.
            </p>
          </Card>
        ) : (
          <select
            className="input"
            value={stream?.id ?? ""}
            onChange={(e) => setStreamId(e.target.value)}
          >
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.platform}
              </option>
            ))}
          </select>
        )}
      </div>

      {stream ? (
        <>
          <StreamInfo stream={stream} />
          <LaunchBar stream={stream} />

          <div>
            <h2>{suiteMeta?.icon ?? "🧭"} {suiteMeta?.label ?? stream.category} Suite</h2>
            <p className="muted small">
              Category-appropriate suite panels for this stream. Features and settings are
              managed from the Suites page for broader controls.
            </p>
            <SuitePanel category={stream.category} />
          </div>

          <div>
            <h2>Overlay Settings</h2>
            <p className="muted small">
              Configure the PICC overlay for this stream's site. The overlay appears in the headed
              browser window and provides real-time intervention, assistance, and decision support.
            </p>
            <OverlaySettingsPanel site={stream.platform.toLowerCase().replace(/\s+/g, "")} />
          </div>
        </>
      ) : null}
    </div>
  )
}