import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui"
import {
  browserOpenSite,
  collectConnector,
  getBrowserPreferences,
  getConnectorHistory,
  getConnectors,
  saveBrowserPreference,
  streamConnector,
  type BrowserPreference,
  type ConnectorDef,
  type ConnectorRegistry,
  type ConnectorSnapshot,
  type StreamEvent
} from "@/lib/api"

function usd(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const CATEGORY_EMOJI: Record<string, string> = {
  trading: "📈",
  bandwidth: "🛰️",
  depin: "🧊",
  nft: "🎨",
  defi: "🏦",
  treasury: "💵",
  other: "🧺"
}

function Sparkline({ points }: { points: ConnectorSnapshot[] }) {
  const values = points.map((p) => p.balance).filter((v): v is number => v != null)
  if (values.length < 2) return <p className="muted small">Not enough data points yet — collect this source a few times.</p>
  const max = Math.max(...values, 0.01)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 0.01)
  return (
    <div className="row" style={{ gap: 2, alignItems: "flex-end", height: 64 }}>
      {values.map((v, i) => (
        <div
          key={`${points[i].lastChecked}-${i}`}
          title={`${new Date(points[i].lastChecked).toLocaleString()} · ${usd(v)}`}
          className="bar-fill"
          style={{ height: `${Math.max(4, ((v - min) / range) * 100)}%`, flex: 1, minWidth: 3 }}
        />
      ))}
    </div>
  )
}

function fmtFrame(e: StreamEvent): string {
  const f = e.frame
  if (!f) return ""
  const dir = f.dir === "sent" ? "↑" : "↓"
  let payload = f.payload
  try {
    const parsed = JSON.parse(f.payload)
    payload = JSON.stringify(parsed.action ?? parsed.type ?? parsed)
  } catch {
    /* keep raw */
  }
  return `${dir} ${String(payload).slice(0, 140)}`
}

/**
 * Per-source browser control: which profile PICC signs into, embedded vs real
 * window, and the dashboard homepage. This is how this category's settings
 * drive the integrated browser — saved per source in the browser preferences.
 */
function SourceBrowserPrefs({
  conn,
  pref,
  busy,
  onSave,
  onOpen
}: {
  conn: ConnectorDef
  pref?: BrowserPreference
  busy: boolean
  onSave: (c: ConnectorDef, p: BrowserPreference) => void
  onOpen: (c: ConnectorDef) => void
}) {
  const [profile, setProfile] = useState(pref?.profile ?? "")
  const [headless, setHeadless] = useState(pref?.headless ?? false)
  const [homepage, setHomepage] = useState(pref?.homepage ?? conn.url)
  const dirty = profile !== (pref?.profile ?? "") || headless !== (pref?.headless ?? false) || homepage !== (pref?.homepage ?? conn.url)

  return (
    <div className="stack" style={{ gap: 8, padding: "10px 0" }}>
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <Button className="btn-sm" disabled={busy} onClick={() => onOpen(conn)}>
          {busy ? "Opening…" : "▶ Open in studio"}
        </Button>
        <span className="muted small">
          Opens the integrated browser, signs into the source's dashboard and shows the PICC overlay.
        </span>
      </div>
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <label className="stack" style={{ gap: 2 }}>
          <span className="muted small">Profile</span>
          <input className="input" style={{ width: 160 }} value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="(default)" />
        </label>
        <label className="stack" style={{ gap: 2 }}>
          <span className="muted small">Homepage</span>
          <input className="input" style={{ width: 240 }} value={homepage} onChange={(e) => setHomepage(e.target.value)} />
        </label>
        <label className="row" style={{ gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
          <span className="small">Embedded (mirror-only)</span>
        </label>
        <Button variant="secondary" className="btn-sm" disabled={!dirty} onClick={() => onSave(conn, { profile: profile || undefined, headless, homepage: homepage || undefined })}>
          Save for this source
        </Button>
      </div>
    </div>
  )
}

export function ConnectorsPanel() {
  const [registry, setRegistry] = useState<ConnectorRegistry | null>(null)
  const [error, setError] = useState("")
  const [msg, setMsg] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState<string | null>(null)
  const [histories, setHistories] = useState<Record<string, ConnectorSnapshot[]>>({})
  const [liveOn, setLiveOn] = useState<Record<string, boolean>>({})
  const [liveLogs, setLiveLogs] = useState<Record<string, StreamEvent[]>>({})
  const liveRef = useRef<Record<string, StreamEvent[]>>({})
  const liveCtrls = useRef<Record<string, { close: () => void }>>({})
  const [browserOpen, setBrowserOpen] = useState<string | null>(null)
  const [browserMsg, setBrowserMsg] = useState("")
  const [browserBusy, setBrowserBusy] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Record<string, BrowserPreference>>({})

  const refresh = useCallback(async () => {
    try {
      setRegistry(await getConnectors())
      setError("")
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const refreshPrefs = useCallback(async () => {
    try {
      setPrefs((await getBrowserPreferences()).prefs)
    } catch {
      /* browser prefs are optional */
    }
  }, [])

  useEffect(() => {
    refresh()
    refreshPrefs()
    const i = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(i)
  }, [refresh, refreshPrefs])

  const collect = async (c: ConnectorDef) => {
    setBusy(c.slug)
    setMsg("")
    try {
      const snap = await collectConnector(c.slug, { headless: true })
      if (snap.status === "error") {
        setMsg(`❌ ${c.label}: ${snap.error || "collection failed"}`)
      } else {
        setMsg(`✅ ${c.label}: balance ${usd(snap.balance)}${snap.today != null ? ` · today ${usd(snap.today)}` : ""} (${snap.source})`)
      }
      await refresh()
    } catch (err) {
      setMsg(`❌ ${c.label}: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const toggleHistory = async (c: ConnectorDef) => {
    if (historyOpen === c.slug) {
      setHistoryOpen(null)
      return
    }
    setHistoryOpen(c.slug)
    if (!histories[c.slug]) {
      try {
        const { history } = await getConnectorHistory(c.slug, 200)
        setHistories((h) => ({ ...h, [c.slug]: history }))
      } catch {
        setHistories((h) => ({ ...h, [c.slug]: [] }))
      }
    }
  }

  const toggleLive = (c: ConnectorDef) => {
    if (liveCtrls.current[c.slug]) {
      liveCtrls.current[c.slug].close()
      delete liveCtrls.current[c.slug]
      setLiveOn((s) => ({ ...s, [c.slug]: false }))
      return
    }
    setLiveOn((s) => ({ ...s, [c.slug]: true }))
    liveRef.current[c.slug] = []
    liveCtrls.current[c.slug] = streamConnector(c.slug, (e) => {
      liveRef.current[c.slug] = [...liveRef.current[c.slug], e].slice(-40)
      setLiveLogs({ ...liveRef.current })
    })
  }

  const closeAllLive = () => {
    for (const ctrl of Object.values(liveCtrls.current)) ctrl.close()
    liveCtrls.current = {}
    liveRef.current = {}
    setLiveOn({})
    setLiveLogs({})
  }

  const openInStudio = async (c: ConnectorDef) => {
    setBrowserBusy(c.slug)
    setBrowserMsg("")
    try {
      const p = prefs[c.slug]
      const s = await browserOpenSite({
        site: c.slug,
        url: p?.homepage ?? c.url,
        headless: p?.headless,
        profile: p?.profile
      })
      setBrowserMsg(`🌐 ${c.label}: opened in the integrated browser (${s.profile ?? "default"} profile, ${s.headless ? "embedded" : "real window"}).`)
    } catch (err) {
      setBrowserMsg(`❌ ${c.label}: ${(err as Error).message}`)
    } finally {
      setBrowserBusy(null)
    }
  }

  const saveSourcePrefs = async (c: ConnectorDef, p: BrowserPreference) => {
    setBrowserMsg("")
    try {
      const r = await saveBrowserPreference(c.slug, p)
      setPrefs((prev) => ({ ...prev, [c.slug]: r.prefs }))
      setBrowserMsg(`🌐 ${c.label}: browser preferences saved — next "Open in studio" uses them.`)
    } catch (err) {
      setBrowserMsg(`❌ ${c.label}: ${(err as Error).message}`)
    }
  }

  const latest = registry?.latest ?? {}
  const balanceTotal = registry?.connectors.reduce((sum, c) => sum + (latest[c.slug]?.balance ?? 0), 0) ?? 0
  const lifetimeTotal = registry?.connectors.reduce((sum, c) => sum + (latest[c.slug]?.lifetime ?? 0), 0) ?? 0
  const okCount = registry?.connectors.filter((c) => latest[c.slug]?.status === "ok").length ?? 0
  const tunedCount = registry?.connectors.filter((c) => c.tuned).length ?? 0
  const totalCount = registry?.connectors.length ?? 0
  const liveSlugs = registry?.connectors.map((c) => c.slug).filter((s) => liveOn[s]) ?? []

  const historyConn = registry?.connectors.find((c) => c.slug === historyOpen)

  return (
    <div className="stack">
      <div className="card">
        <div className="row space-between wrap" style={{ gap: 8 }}>
          <div>
            <h2>🔌 Connector Registry</h2>
            <p className="muted small">
              One interface per income source. The browser transport drives a real Chrome/Edge profile via CDP — log in once,
              then PICC reads the live dashboard DOM plus the page's own WebSocket frames. Read-only by design: nothing is
              ever executed on external platforms.
            </p>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className={`badge ${registry?.browser ? "badge-success" : "badge-warn"}`}>
              {registry?.browser === undefined ? "checking browser…" : registry.browser ? "Chrome/Edge ready" : "No browser found"}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={refresh} disabled={!registry}>Refresh</button>
          </div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Connectors</span>
          <strong>{totalCount}</strong>
          <span className="muted">registered</span>
        </div>
        <div className="stat">
          <span className="stat-label">Live balances</span>
          <strong>{usd(balanceTotal)}</strong>
          <span className="muted">{okCount} sources ok</span>
        </div>
        <div className="stat">
          <span className="stat-label">Lifetime tracked</span>
          <strong>{usd(lifetimeTotal)}</strong>
          <span className="muted">latest snapshots</span>
        </div>
        <div className="stat">
          <span className="stat-label">Selectors tuned</span>
          <strong>{tunedCount}/{totalCount}</strong>
          <span className="muted">verified against live DOM</span>
        </div>
      </div>

      {error ? <p className="muted small" style={{ color: "var(--danger)" }}>⚠ {error}</p> : null}
      {msg ? <p className="muted small">{msg}</p> : null}
      {browserMsg ? <p className="muted small">{browserMsg}</p> : null}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Category</th>
                <th>Transport</th>
                <th>Selectors</th>
                <th>Balance</th>
                <th>Today</th>
                <th>Lifetime</th>
                <th>Last checked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(registry?.connectors ?? []).map((c) => {
                const snap = latest[c.slug]
                const failed = snap?.status === "error"
                return (
                  <Fragment key={c.slug}>
                    <tr>
                      <td>
                        <strong>{CATEGORY_EMOJI[c.category] ?? "🧺"} {c.label}</strong>
                        <div className="muted small">{c.slug}</div>
                      </td>
                      <td className="muted">{c.category}</td>
                      <td>
                        <code>{c.transport}</code>
                      </td>
                      <td>
                        {c.tuned ? (
                          <span className="badge badge-success">tuned</span>
                        ) : (
                          <span className="badge badge-warn" title="DOM selectors need per-site verification">untested</span>
                        )}
                      </td>
                      <td>
                        <strong>{failed ? "—" : usd(snap?.balance)}</strong>
                        {snap?.payoutThreshold && !failed ? <div className="muted small">threshold {usd(snap.payoutThreshold)}</div> : null}
                        {failed && snap?.error ? <div className="muted small" title={snap.error}>⚠ {snap.error.slice(0, 40)}</div> : null}
                      </td>
                      <td>{snap && !failed && snap.today != null ? usd(snap.today) : "—"}</td>
                      <td>{snap && !failed && snap.lifetime != null ? usd(snap.lifetime) : "—"}</td>
                      <td className="muted small">{snap ? new Date(snap.lastChecked).toLocaleString() : "—"}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn btn-primary btn-sm" disabled={busy === c.slug} onClick={() => collect(c)}>
                            {busy === c.slug ? "…" : "Collect"}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => toggleHistory(c)}>
                            {historyOpen === c.slug ? "Hide" : "History"}
                          </button>
                          <button className={liveOn[c.slug] ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"} onClick={() => toggleLive(c)}>
                            {liveOn[c.slug] ? "● Live" : "Live"}
                          </button>
                          <button className={browserOpen === c.slug ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"} onClick={() => setBrowserOpen(browserOpen === c.slug ? null : c.slug)}>
                            Browser
                          </button>
                        </div>
                      </td>
                    </tr>
                    {browserOpen === c.slug ? (
                      <tr>
                        <td colSpan={9} style={{ background: "var(--bg-soft, #141430)" }}>
                          <SourceBrowserPrefs conn={c} pref={prefs[c.slug]} busy={browserBusy === c.slug} onSave={saveSourcePrefs} onOpen={openInStudio} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          "Untested" sources ship with placeholder DOM selectors. Log in to a source in the profile, then run{" "}
          <code>node scripts/tune-connectors.mjs {"<slug>"}</code> to verify and fix them.
        </p>
      </div>

      {historyConn && (
        <div className="card">
          <div className="row space-between">
            <h2>📊 {historyConn.label} — balance history</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setHistoryOpen(null)}>✕</button>
          </div>
          <Sparkline points={histories[historyConn.slug] ?? []} />
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Balance</th>
                  <th>Today</th>
                  <th>Lifetime</th>
                  <th>Source</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(histories[historyConn.slug] ?? []).slice(-15).reverse().map((p, i) => (
                  <tr key={`${p.lastChecked}-${i}`}>
                    <td className="muted small">{new Date(p.lastChecked).toLocaleString()}</td>
                    <td>{usd(p.balance)}</td>
                    <td>{p.today != null ? usd(p.today) : "—"}</td>
                    <td>{p.lifetime != null ? usd(p.lifetime) : "—"}</td>
                    <td className="muted small">{p.source}</td>
                    <td>{p.status === "ok" ? <span className="badge badge-success">ok</span> : <span className="badge badge-danger">error</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {liveSlugs.map((slug) => {
        const c = registry?.connectors.find((x) => x.slug === slug)
        const events = liveLogs[slug] ?? []
        const lastSnap = [...events].reverse().find((e) => e.type === "snapshot" && e.snapshot)?.snapshot
        const frames = events.filter((e) => e.type === "frame").slice(-10)
        return (
          <div className="card" key={slug}>
            <div className="row space-between">
              <h2>🔴 {c?.label ?? slug} — live</h2>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={closeAllLive}>Close all</button>
              </div>
            </div>
            <div className="row wrap" style={{ gap: 16 }}>
              <div className="stat">
                <span className="stat-label">Live balance</span>
                <strong>{lastSnap ? usd(lastSnap.balance) : "connecting…"}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">Today</span>
                <strong>{lastSnap?.today != null ? usd(lastSnap.today) : "—"}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">Frames seen</span>
                <strong>{events.filter((e) => e.type === "frame").length}</strong>
              </div>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              Live page-WebSocket traffic from the source's own dashboard. PICC only reads these frames.
            </p>
            {frames.length > 0 ? (
              <pre className="muted small" style={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", marginTop: 8 }}>
                {frames.map((f, i) => (
                  <div key={i}>{fmtFrame(f)}</div>
                ))}
              </pre>
            ) : (
              <p className="muted small">Waiting for the page to open a WebSocket…</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
