import { useCallback, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { getStreams, getEarnings } from "@/lib/streams"
import { SUITE_META } from "@/lib/suites"
import { Card } from "@/components/ui"
import { MarketsSuite } from "@/components/TradingSuite"
import { AutomatorPanel } from "@/components/AutomatorPanel"
import { ConnectorsPanel } from "@/components/ConnectorsPanel"
import { OverlaySettingsPanel } from "@/components/OverlaySettingsPanel"
import { openBrowser, browserTab } from "@/lib/api"
import type { IncomeStream } from "@/lib/types"

function usd(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const SUITE_PANELS: Record<string, React.FC> = {
  trading: () => <MarketsSuite />,
  bandwidth: () => <AutomatorPanel />,
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

  const launch = useCallback(async () => {
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
  }, [stream.url])

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
  const Panel = SUITE_PANELS[category]
  if (!Panel) {
    return (
      <Card>
        <p className="muted small">
          No PICC suite panel for this category yet. Configure connectors and automations
          under Income → Connectors.
        </p>
      </Card>
    )
  }
  return <Panel />
}

export function StreamPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const streams = getStreams()
  const stream = streams.find((s) => s.id === id)

  if (!stream) {
    return (
      <div className="stack stack-lg">
        <header>
          <h1>Stream not found</h1>
          <p className="muted">
            No income stream with id <code>{id}</code>.{" "}
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/income")}>
              Back to Income
            </button>
          </p>
        </header>
      </div>
    )
  }

  const suiteMeta = SUITE_META[stream.category]

  return (
    <div className="stack stack-lg">
      <header>
        <div className="row gap" style={{ alignItems: "center" }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate("/income")}
            title="Back to Income"
          >
            ← Income
          </button>
          <h1 style={{ margin: 0 }}>Stream</h1>
        </div>
      </header>

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
    </div>
  )
}
