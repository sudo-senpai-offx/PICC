import { useCallback, useEffect, useRef, useState } from "react"
import { Badge, Card, Spinner } from "@/components/ui"
import type { LiveAccount, LiveAsset, LiveEvent, LiveSnapshot } from "@/lib/liveTrading"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"

function fmtPrice(n: number | null): string {
  if (n == null) return "—"
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (Math.abs(n) >= 10) return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  return n.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 })
}

function fmtPct(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return `${v >= 0 ? "+" : ""}${v.toFixed(3)}%`
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—"
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Mini live sparkline of the base-period closes (60s). */
function LiveSpark({ closes, live }: { closes: number[]; live: boolean }) {
  const vals = closes.filter((v): v is number => typeof v === "number")
  const W = 120
  const H = 28
  if (vals.length < 2) return <span className="muted">…</span>
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / span) * H).toFixed(1)}`).join(" ")
  const up = vals[vals.length - 1] >= vals[0]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="live-spark" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={live ? "var(--accent)" : up ? "var(--success)" : "var(--danger)"}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function StatusChip({ status, error }: { status: string; error: string | null }) {
  if (status === "error") return <Badge tone="danger">error</Badge>
  if (status === "connecting") return <Badge tone="warn">connecting…</Badge>
  if (status === "idle") return <Badge tone="muted">idle</Badge>
  if (error) return <Badge tone="warn">degraded</Badge>
  return <Badge tone="success">live</Badge>
}

/**
 * Live market board: realtime ExpertOption prices streamed from the open
 * app.expertoption.com tab (via the broker's own WebSocket frames) + fresh
 * headless history for the whole watch set. Display-only.
 */
export function LiveMarketBoard() {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null)
  const [account, setAccount] = useState<LiveAccount | null>(null)
  const [status, setStatus] = useState<string>("connecting")
  const [error, setError] = useState<string | null>(null)
  const [viewed, setViewed] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const assetsRef = useRef<Map<string, LiveAsset>>(new Map())
  const [, force] = useState(0)

  // Consume the shared realtime feed (one SSE connection for the whole suite)
  // instead of opening a second one for the live board.
  const onEvent = useCallback((e: LiveEvent) => {
    if (e.type === "snapshot") {
      assetsRef.current = new Map(e.snapshot.assets.map((a) => [a.id, a]))
      setSnap(e.snapshot)
      setAccount(e.snapshot.account ?? null)
      setViewed(e.snapshot.viewed)
      if (e.snapshot.watching.length) setStatus("connected")
    } else if (e.type === "tick") {
      const cur = assetsRef.current.get(e.assetId)
      if (cur) {
        const next = { ...cur }
        if (e.period === 60) {
          next.price = e.price
          next.change = e.change
          next.changePct = e.changePct
          if (next.spark.length) next.spark = [...next.spark.slice(1), e.price]
          else next.spark = [e.price]
        }
        assetsRef.current.set(e.assetId, next)
        setSnap((s) => (s ? { ...s, assets: [...assetsRef.current.values()] } : s))
      }
    } else if (e.type === "account") {
      setAccount(e.account)
    } else if (e.type === "status") {
      setStatus(e.status)
      if (e.error) setError(e.error)
      if (e.account) setAccount(e.account)
    } else if (e.type === "stats") {
      setStatus(e.stats.status)
      setError(e.stats.error)
      setViewed(e.stats.viewed)
      if (e.stats.account) setAccount(e.stats.account)
    } else if (e.type === "ready") {
      setConnected(true)
    }
  }, [])
  useRealtimeSuite(onEvent)

  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 2000)
    return () => clearInterval(t)
  }, [])

  return (
    <Card>
      <div className="row-between">
        <div className="row">
          <strong>Live Markets</strong>
          <StatusChip status={status} error={error} />
          {account ? (
            <Badge tone={account.demo ? "muted" : "success"}>{account.demo ? "demo" : "live"}</Badge>
          ) : null}
        </div>
        <div className="row">
          {account ? (
            <span className="muted row" style={{ gap: "10px" }}>
              <span>
                <Badge tone="accent">demo</Badge> {account.demoWallet?.currency ?? account.currency ?? ""}{" "}
                {fmtMoney(account.demoWallet?.balance ?? account.balance)}
              </span>
              <span>
                <Badge tone="success">real</Badge> {account.realWallet?.currency ?? account.currency ?? ""} {fmtMoney(account.realWallet?.balance)}
              </span>
              <Badge tone={account.active === "demo" ? "muted" : "success"}>
                active: {account.active ?? (account.demo ? "demo" : "real")}
              </Badge>
            </span>
          ) : null}
          {viewed ? <Badge tone="accent">viewing: {viewed}</Badge> : null}
        </div>
      </div>
      {error ? <p className="danger-text">{error}</p> : null}
      {!connected && status === "connecting" ? (
        <Spinner label="Connecting to ExpertOption…" />
      ) : (
        <div className="grid-4 live-board">
          {(snap?.watching ?? []).map((n) => {
            const a = [...assetsRef.current.values()].find((x) => x.name === n)
            return a ? (
              <div className="card live-cell" key={a.id}>
                <div className="row-between">
                  <span className="muted">{a.name}</span>
                  {a.id === viewed ? <Badge tone="success">●</Badge> : null}
                </div>
                <div className="live-price" style={{ color: a.changePct >= 0 ? "var(--success)" : "var(--danger)" }}>
                  {fmtPrice(a.price)}
                </div>
                <div className="muted">
                  <span style={{ color: a.changePct >= 0 ? "var(--success)" : "var(--danger)" }}>
                    {fmtPct(a.changePct)}
                  </span>
                  <span className="live-ts"> · 1m</span>
                </div>
                <LiveSpark closes={a.spark} live={a.id === viewed} />
              </div>
            ) : (
              <div className="card live-cell" key={n}>
                <span className="muted">{n}</span>
                <div className="live-price muted">…</div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
