import { useEffect, useState } from "react"
import { createBtcpayInvoice, createEwalletOrder, getHealth } from "@/lib/api"
import type { HealthInfo } from "@/lib/api"
import { Card } from "@/components/ui"
import { CatalogTab } from "@/components/IncomeStreams"

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
        <Card>
          <h3>BTCPay (Bitcoin + Lightning)</h3>
          <p className="small">
            Self-hosted on your own node. Buyers pay a bitcoin invoice and funds go straight to
            you — no platform cut. Invoice creation needs the BTCPay store + API key wired after
            mainnet sync.
          </p>
          <p className="muted small">Status: {health?.providers.btcpay ? "Configured" : "Not configured"}</p>
        </Card>
        <Card>
          <h3>TNG eWallet</h3>
          <p className="small">
            Manual transfer to your TNG number. Buyers send the amount and submit their transaction
            reference.
          </p>
          <p className="muted small">
            Status: {health?.providers.ewallet ? "Configured" : "Not configured"}
            {!health?.providers.ewallet ? " — add EWALLET_TNG_NUMBER to .env to enable" : ""}
          </p>
        </Card>
        <Card>
          <h3>PayPal</h3>
          <p className="small">Optional channel. Add a PayPal API key to accept card/PayPal payments.</p>
          <p className="muted small">Status: {health?.providers.paypal ? "Configured" : "Not configured"}</p>
        </Card>
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

type IncomeTab = "channels" | "catalog"

export function Income() {
  const [tab, setTab] = useState<IncomeTab>("channels")

  return (
    <div className="stack stack-lg">
      <header>
        <h1>Income</h1>
        <p className="muted">
          Cash flow across all platforms. Track earnings and manage payment channels.
          Overlay activation is managed via the PICC browser extension.
        </p>
      </header>

      <div className="tabs">
        <button type="button" className={tab === "channels" ? "tab active" : "tab"} onClick={() => setTab("channels")}>
          💳 Payment Channels
        </button>
        <button type="button" className={tab === "catalog" ? "tab active" : "tab"} onClick={() => setTab("catalog")}>
          📚 Channel Catalog
        </button>
      </div>

      {tab === "channels" ? <ChannelsTab /> : null}
      {tab === "catalog" ? <CatalogTab /> : null}
    </div>
  )
}
