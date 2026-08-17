import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui"
import type { LiveDecisions, LiveDecision, LiveEvent } from "@/lib/liveTrading"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { getBrowserStatus, openBrowser } from "@/lib/api"
import { isFeatureOn } from "@/lib/settings"

const DETECT_MS = 5_000

function fmtCountdown(target: number, now: number): string {
  const diff = Math.max(0, target - now)
  const s = Math.floor(diff / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return `${mm}:${ss}`
}

function fmtPct(n: number | null, d = 0): string {
  if (n == null) return "—"
  return `${(n * 100).toFixed(d)}%`
}

function HudRow({ d, now }: { d: LiveDecision; now: number }) {
  const tone: "success" | "warn" | "muted" =
    d.verdict === "TRADE" ? "success" : d.verdict === "OBSERVE" ? "warn" : "muted"
  const dir = d.direction === "flat" ? "→" : d.direction === "up" ? "▲" : "▼"
  const expiryAt = d.ts + (d.expiry ?? 0) * 1000
  const mttdAt = d.ts + (d.mttdSec ?? 0) * 1000
  return (
    <div className={`hud-row ${d.verdict === "TRADE" ? "live-cell" : ""}`}>
      <div className="row-between">
        <strong className="small">{d.asset}</strong>
        <div className="row gap">
          <Badge tone={tone}>{d.verdict}</Badge>
          <Badge tone={d.direction === "up" ? "success" : d.direction === "down" ? "danger" : "muted"}>
            {dir} {d.direction}
          </Badge>
        </div>
      </div>
      <div className="row-between muted small" style={{ marginTop: 2 }}>
        <span>{d.phaseLabel ?? "—"}</span>
        <span className="hud-clock">
          <span title="expiry countdown">⏳ {fmtCountdown(expiryAt, now)}</span>
          <span title="mean-time-to-trigger">⇢ {fmtCountdown(mttdAt, now)}</span>
        </span>
      </div>
      <div className="row-between muted small" style={{ marginTop: 2 }}>
        <span>
          win <strong>{fmtPct(d.winProb, 0)}</strong> · EV{" "}
          <strong>{d.ev != null ? (d.ev >= 0 ? "+" : "") + (d.ev * 100).toFixed(1) + "%" : "—"}</strong>
        </span>
        <span>
          payout <strong>{d.payout ?? "—"}%</strong>
          {d.payoutSource === "observed" ? <em className="muted"> (obs)</em> : null}
        </span>
      </div>
    </div>
  )
}

/**
 * Dashboard-side trading HUD — the sibling of the in-page broker overlay. A
 * floating, collapsible read-only view of the adaptive-confluence engine that
 * rides along on every page (bottom-right). It surfaces automatically whenever
 * a trading site is the active studio tab.
 *
 * Transport is the single shared realtime feed (useRealtimeSuite), refcounted
 * with the rest of the suite — no second SSE connection, and failures surface
 * as a "reconnecting" state instead of freezing silently. Display-only —
 * nothing here places orders.
 */
export function TradingHud() {
  const [data, setData] = useState<LiveDecisions | null>(null)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("picc.tradingHud.collapsed") === "1"
    } catch {
      return false
    }
  })
  const [tradingSite, setTradingSite] = useState(false)
  const [autoOpened, setAutoOpened] = useState(false)
  const [now, setNow] = useState(Date.now())
  const lastTs = useRef(0)
  const navigate = useNavigate()

  const onEvent = useCallback((e: LiveEvent) => {
    if (e.type === "decision" && e.ts > lastTs.current) {
      lastTs.current = e.ts
      setData(e)
    }
  }, [])
  const { error: streamError } = useRealtimeSuite(onEvent)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      try {
        const s = await getBrowserStatus()
        if (!alive) return
        const trading = s.suite?.id === "trading" || s.currentSite?.category === "trading"
        setTradingSite(Boolean(trading))
        if (trading && !autoOpened) {
          setAutoOpened(true)
          setCollapsed(false)
        }
      } catch {
        /* browser closed */
      }
      if (alive) timer = setTimeout(check, DETECT_MS)
    }
    void check()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [autoOpened])

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem("picc.tradingHud.collapsed", next ? "1" : "0")
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }

  const decisions = data?.decisions ?? []
  const signals = decisions.filter((d) => d.verdict === "TRADE").length
  const running = data?.status === "connected" || data?.status === "connecting"

  if (!isFeatureOn("trading")) return null

  if (collapsed) {
    return (
      <button className="trading-hud trading-hud-pill" onClick={toggle} title="Expand trading HUD">
        <span className={running ? "hud-dot" : "hud-dot hud-dot-idle"} />
        <strong>PICC DEMO</strong>
        <span className="muted small">{signals} signal{signals === 1 ? "" : "s"}</span>
        <span className="muted small">{tradingSite ? "· trading tab" : ""}</span>
      </button>
    )
  }

  return (
    <div className="trading-hud">
      <div className="hud-head row-between">
        <div className="row gap">
          <strong className="small">Trading Suite</strong>
          <Badge tone={running ? "success" : "muted"}>{running ? "engine live" : "engine idle"}</Badge>
          <Badge tone="warn">DEMO</Badge>
          {streamError ? (
            <Badge tone="warn">{streamError.includes("token") ? "session expired — reconnecting…" : "reconnecting…"}</Badge>
          ) : null}
        </div>
        <div className="row gap">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/suites")} title="Open the full trading suite">
            Full suite
          </button>
          {tradingSite ? (
            <button className="btn btn-ghost btn-sm" onClick={() => void openBrowser()} title="Open the broker page in the browser">
              🌐 Broker
            </button>
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={toggle} title="Collapse trading HUD">
            ▾
          </button>
        </div>
      </div>
      {data ? (
        <div className="hud-meta muted small">
          <span>updated {new Date(data.ts).toLocaleTimeString()}</span>
          <span>· {decisions.length} assets · mode {data.mode ?? "—"}</span>
        </div>
      ) : (
        <div className="hud-meta muted small">waiting for the decision engine…</div>
      )}
      <div className="hud-body">
        {data == null ? (
          <p className="muted small">Engine warming up — needs the live 1m buffers (min 40 bars per asset).</p>
        ) : decisions.length === 0 ? (
          <p className="muted small">No decisions yet — the ExpertOption session must be connected.</p>
        ) : (
          decisions.map((d) => <HudRow key={d.assetId} d={d} now={now} />)
        )}
      </div>
      <div className="hud-foot muted small">
        Read-only display — demo signals only, never trade live without approval.
      </div>
    </div>
  )
}
