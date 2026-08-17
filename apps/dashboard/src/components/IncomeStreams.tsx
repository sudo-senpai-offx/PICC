import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { postPresence, pushStreamsSnapshot, testHoneygain, syncCashPilot } from "@/lib/api"
import { STREAM_CATEGORY_LABELS, CATALOG, BANDWIDTH_APPS, DEPIN_APPS, STORAGE_APPS, COMPUTE_APPS, CRYPTO_APPS, DEFI_APPS, NFT_APPS, P2P_APPS, AGENT_APPS, INTEREST_APPS, DIVIDEND_APPS, RENTAL_APPS, CONTENT_APPS } from "@/lib/streamCatalog"
import { StreamSetupWizard } from "@/components/StreamSetupWizard"
import {
  addStream,
  applyAutoEstimates,
  estimateDailyFromHistory,
  getCollectorCredentials,
  getEarnings,
  getStreams,
  recordEarning,
  removeEarning,
  removeStream,
  saveCollectorCredentials,
  streamSummary,
  updateStream,
  upsertPlatformStream
} from "@/lib/streams"
import type { IncomeStream, StreamCategory, StreamStatus } from "@/lib/types"

const CATEGORIES: StreamCategory[] = ["bandwidth", "dividend", "interest", "affiliate", "content", "rental", "p2p", "crypto", "defi", "nft", "agent", "other"]

export { StreamsTab, CatalogTab }

// ---------------------------------------------------------------------
// Streams tab
// ---------------------------------------------------------------------
function StreamsTab() {
  const [streams, setStreams] = useState<IncomeStream[]>(getStreams())
  const [earnings, setEarnings] = useState(getEarnings())
  const [collecting, setCollecting] = useState(false)
  const [collectorMsg, setCollectorMsg] = useState("")
  const collectorsRef = useRef<HTMLDivElement | null>(null)

  const savedCreds = useMemo(getCollectorCredentials, [])
  const [hgToken, setHgToken] = useState(savedCreds.honeygainToken)
  const [cpUrl, setCpUrl] = useState(savedCreds.cashpilotUrl)
  const [cpKey, setCpKey] = useState(savedCreds.cashpilotKey)

  const summary = useMemo(() => streamSummary(streams, earnings), [streams, earnings])

  // Push stream data to the server snapshot so the extension overlay can show
  // balances on platforms without a public earner API. Debounced + best-effort.
  useEffect(() => {
    const t = window.setTimeout(() => {
      pushStreamsSnapshot(streams, earnings).catch(() => undefined)
    }, 1500)
    return () => window.clearTimeout(t)
  }, [streams, earnings])

  // Presence heartbeat so the Automator panel can show this dashboard is live.
  useEffect(() => {
    postPresence("dashboard").catch(() => undefined)
    const i = window.setInterval(() => postPresence("dashboard").catch(() => undefined), 5 * 60 * 1000)
    return () => window.clearInterval(i)
  }, [])

  const addFromWizard = (input: Omit<IncomeStream, "id">) => {
    setStreams(addStream(input))
    setEarnings(getEarnings())
  }

  const jumpToCollectors = () => {
    collectorsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const syncHoneygain = async (record: boolean) => {
    if (!hgToken.trim()) return
    setCollecting(true)
    setCollectorMsg("")
    saveCollectorCredentials({ honeygainToken: hgToken.trim(), cashpilotUrl: cpUrl.trim(), cashpilotKey: cpKey.trim() })
    try {
      const snap = await testHoneygain(hgToken.trim())
      if (!snap.ok) throw new Error(snap.error ?? "sync failed")
      const { stream, streams: next } = upsertPlatformStream("Honeygain", {
        balance: snap.balance,
        totalEarned: snap.lifetimeEarnings,
        payoutThreshold: snap.payoutThreshold,
        payoutMethod: "PayPal, Crypto",
        collector: "honeygain",
        status: "active",
        estimatedDaily: estimateDailyFromHistory(snap.daily),
        note: snap.todayEarnings > 0 ? `Today: ${usd(snap.todayEarnings)}` : undefined,
        lastCollected: new Date().toISOString()
      })
      setStreams(applyAutoEstimates(next, getEarnings()))
      if (record) {
        const today = new Date().toISOString().slice(0, 10)
        let all = getEarnings()
        for (const d of snap.daily.filter((x) => x.date && x.usd > 0)) {
          all = recordEarning(stream.id, d.date, d.usd, "auto")
        }
        if (snap.todayEarnings > 0) all = recordEarning(stream.id, today, snap.todayEarnings, "auto")
        setEarnings(all)
        setStreams(applyAutoEstimates(getStreams(), all))
      }
      setCollectorMsg(
        `✅ Honeygain synced — balance ${usd(snap.balance)}, lifetime ${usd(snap.lifetimeEarnings)}, ` +
          `payout threshold ${usd(snap.payoutThreshold)}`
      )
    } catch (err) {
      setCollectorMsg(`❌ ${(err as Error).message}`)
    } finally {
      setCollecting(false)
    }
  }

  const syncHoneygainTest = () => syncHoneygain(false)
  const syncHoneygainRecord = () => syncHoneygain(true)

  const importCashPilot = async () => {
    if (!cpUrl.trim()) return
    setCollecting(true)
    setCollectorMsg("")
    saveCollectorCredentials({ honeygainToken: hgToken.trim(), cashpilotUrl: cpUrl.trim(), cashpilotKey: cpKey.trim() })
    try {
      const snap = await syncCashPilot(cpUrl.trim(), cpKey.trim())
      if (!snap.ok) throw new Error(snap.error ?? "import failed")
      for (const svc of snap.breakdown) {
        upsertPlatformStream(svc.service, {
          balance: svc.balance,
          totalEarned: svc.total || svc.balance,
          payoutThreshold: svc.threshold,
          collector: "cashpilot",
          status: "active",
          category: "bandwidth",
          lastCollected: new Date().toISOString()
        })
      }
      if (snap.daily.length > 0) {
        const { stream } = upsertPlatformStream("CashPilot (all services)", {
          collector: "cashpilot",
          status: "active",
          category: "bandwidth",
          balance: snap.summary.total,
          totalEarned: snap.summary.total,
          estimatedDaily: estimateDailyFromHistory(snap.daily),
          note: `Today ${usd(snap.summary.today)} · month ${usd(snap.summary.month)}`
        })
        let all = getEarnings()
        for (const d of snap.daily.filter((x) => x.date && x.usd > 0)) {
          all = recordEarning(stream.id, d.date, d.usd, "auto")
        }
        setEarnings(all)
        setStreams(applyAutoEstimates(getStreams(), all))
      } else {
        setStreams(applyAutoEstimates(getStreams(), getEarnings()))
      }
      setCollectorMsg(`✅ CashPilot imported — ${snap.breakdown.length} services, aggregate ${usd(snap.summary.total)}`)
    } catch (err) {
      setCollectorMsg(`❌ ${(err as Error).message}`)
    } finally {
      setCollecting(false)
    }
  }

  const resetForm = () => setForm({ name: "", category: "bandwidth", platform: "", estimatedDaily: "", threshold: "", payoutMethod: "PayPal", balance: "", totalEarned: "", url: "" })
  const [form, setForm] = useState({ name: "", category: "bandwidth" as StreamCategory, platform: "", estimatedDaily: "", threshold: "", payoutMethod: "PayPal", balance: "", totalEarned: "", url: "" })

  const submitStream = () => {
    if (!form.name.trim()) return
    const stream: Omit<IncomeStream, "id"> = {
      name: form.name.trim(),
      platform: form.platform.trim() || form.name.trim(),
      category: form.category,
      status: "active",
      balance: Number(form.balance) || 0,
      totalEarned: Number(form.totalEarned) || 0,
      payoutThreshold: Number(form.threshold) || 0,
      payoutMethod: form.payoutMethod || "—",
      estimatedDaily: Number(form.estimatedDaily) || 0,
      url: form.url.trim() || undefined,
      collector: "manual"
    }
    setStreams(addStream(stream))
    resetForm()
  }

  const setStatus = (id: string, status: StreamStatus) => setStreams(updateStream(id, { status }))
  const del = (id: string) => {
    setStreams(removeStream(id))
    setEarnings(getEarnings())
  }

  const recent = earnings.slice(0, 20)

  return (
    <div className="stack">
      <StreamSetupWizard streams={streams} onAdded={addFromWizard} onSetCollectorsHint={jumpToCollectors} />
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Last 30 days</span>
          <strong>{usd(summary.monthly)}</strong>
          <span className="muted">recorded earnings</span>
        </div>
        <div className="stat">
          <span className="stat-label">Lifetime</span>
          <strong>{usd(summary.lifetime)}</strong>
          <span className="muted">all recorded</span>
        </div>
        <div className="stat">
          <span className="stat-label">Projected /yr</span>
          <strong>{usd(summary.projectedAnnual)}</strong>
          <span className="muted">{summary.activeCount} active streams</span>
        </div>
        <div className="stat">
          <span className="stat-label">Today</span>
          <strong>{usd(summary.today)}</strong>
          <span className="muted">across all streams</span>
        </div>
      </div>

      {summary.cashoutReady.length > 0 && (
        <div className="card" style={{ borderColor: "var(--success)" }}>
          <h2>💵 Ready to cash out</h2>
          {summary.cashoutReady.map((s) => (
            <p key={s.id} className="row">
              <strong>{s.name}</strong> <span className="muted">balance</span> <strong>{usd(s.balance)}</strong>
              <span className="muted">threshold</span> <strong>{usd(s.payoutThreshold)}</strong>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                  Withdraw →
                </a>
              ) : null}
            </p>
          ))}
        </div>
      )}

      <div className="card" ref={collectorsRef}>
        <h2>Auto-collectors</h2>
        <p className="muted small">Free, real balance pulls from services you already use. Credentials stay on this device and are only sent to the provider.</p>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <input className="input" type="password" placeholder="Honeygain bearer token" value={hgToken} onChange={(e) => setHgToken(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
            <button className="btn btn-secondary" disabled={collecting || !hgToken.trim()} onClick={syncHoneygainTest}>Test token</button>
            <button className="btn btn-primary" disabled={collecting || !hgToken.trim()} onClick={syncHoneygainRecord}>Sync Honeygain</button>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <input className="input" placeholder="CashPilot URL (http://localhost:8080)" value={cpUrl} onChange={(e) => setCpUrl(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
            <input className="input" placeholder="CashPilot admin key" value={cpKey} onChange={(e) => setCpKey(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
            <button className="btn btn-primary" disabled={collecting || !cpUrl.trim()} onClick={importCashPilot}>Import from CashPilot</button>
          </div>
          {collectorMsg ? <p className="muted small">{collectorMsg}</p> : null}
          <p className="muted small">
            Honeygain token: log in at dashboard.honeygain.com → DevTools → Network → copy the <code>Authorization: Bearer</code> value.{" "}
            CashPilot: run the self-hosted aggregator, set <code>CASHPILOT_ADMIN_API_KEY</code>.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Streams</h2>
        {streams.length === 0 ? (
          <p className="muted">No streams yet. Add one below, or sync a collector to create it automatically.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Stream</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Balance</th>
                  <th>Est /day</th>
                  <th>Lifetime</th>
                  <th>Last</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {streams.map((s) => {
                  const pct = s.payoutThreshold > 0 ? Math.min(100, (s.balance / s.payoutThreshold) * 100) : 0
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                        <div className="muted">{s.platform}{s.collector !== "manual" ? ` · ${s.collector}` : ""}</div>
                      </td>
                      <td>{STREAM_CATEGORY_LABELS[s.category]}</td>
                      <td>
                        <select className="input" value={s.status} onChange={(e) => setStatus(s.id, e.target.value as StreamStatus)} style={{ padding: 2 }}>
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="retired">Retired</option>
                        </select>
                      </td>
                      <td>
                        <strong>{usd(s.balance)}</strong>
                        {s.payoutThreshold > 0 ? (
                          <>
                            <div className="bar-track">
                              <div className="bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="muted">threshold {usd(s.payoutThreshold)}</span>
                          </>
                        ) : null}
                      </td>
                      <td>{s.estimatedDaily > 0 ? usd(s.estimatedDaily) : "—"}</td>
                      <td>{usd(s.totalEarned)}</td>
                      <td className="muted">{s.lastCollected ? new Date(s.lastCollected).toLocaleDateString() : "—"}</td>
                      <td>
                        <Link to={`/streams/${s.id}`} className="btn btn-ghost btn-sm" style={{ marginRight: 4 }}>
                          View
                        </Link>
                        <button className="btn btn-ghost btn-sm" onClick={() => del(s.id)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="muted" style={{ margin: "12px 0 8px" }}>Add stream</h3>
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input" placeholder="Name (e.g. VOO dividends)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as StreamCategory })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{STREAM_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <input className="input" placeholder="Platform (Honeygain, REIT…)" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
          <input className="input" placeholder="Est $/day" value={form.estimatedDaily} onChange={(e) => setForm({ ...form, estimatedDaily: e.target.value })} type="number" min="0" style={{ width: 100 }} />
          <input className="input" placeholder="Balance" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} type="number" min="0" style={{ width: 100 }} />
          <input className="input" placeholder="Threshold" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} type="number" min="0" style={{ width: 100 }} />
          <input className="input" placeholder="Payout (PayPal…)" value={form.payoutMethod} onChange={(e) => setForm({ ...form, payoutMethod: e.target.value })} style={{ width: 110 }} />
          <input className="input" placeholder="Dashboard URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <button className="btn btn-primary" onClick={submitStream}>Add</button>
        </div>
      </div>

      {summary.daily.length > 0 && (
        <div className="card">
          <h2>Daily earnings (last {summary.daily.length} days)</h2>
          <div className="row" style={{ gap: 2, alignItems: "flex-end", height: 80 }}>
            {summary.daily.map((d) => {
              const max = Math.max(...summary.daily.map((x) => x.total), 0.01)
              return (
                <div key={d.date} title={`${d.date} · ${usd(d.total)}`} className="bar-fill" style={{ height: `${Math.max(2, (d.total / max) * 100)}%`, flex: 1, minWidth: 3 }} />
              )
            })}
          </div>
          <div className="row space-between muted small">
            <span>{summary.daily[0]?.date}</span>
            <span>{summary.daily[summary.daily.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="card">
          <h2>Recent earnings</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Stream</th><th>Amount</th><th>Source</th><th /></tr>
              </thead>
              <tbody>
                {recent.map((e) => {
                  const s = streams.find((x) => x.id === e.streamId)
                  return (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td>{s?.name ?? "removed stream"}</td>
                      <td>+{usd(e.amount)}</td>
                      <td><span className="muted">{e.source}</span></td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => { setEarnings(removeEarning(e.id)) }}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Catalog tab
// ---------------------------------------------------------------------
function CatalogTab() {
  const [filter, setFilter] = useState<"all" | "bandwidth" | "depin" | "storage" | "compute" | "crypto" | "defi" | "nft" | "p2p" | "agent" | "interest" | "dividend" | "rental" | "content">("all")
  const groups = {
    all: CATALOG,
    bandwidth: BANDWIDTH_APPS,
    depin: DEPIN_APPS,
    storage: STORAGE_APPS,
    compute: COMPUTE_APPS,
    crypto: [...CRYPTO_APPS, ...DEFI_APPS],
    defi: DEFI_APPS,
    nft: NFT_APPS,
    p2p: P2P_APPS,
    agent: AGENT_APPS,
    interest: INTEREST_APPS,
    dividend: DIVIDEND_APPS,
    rental: RENTAL_APPS,
    content: CONTENT_APPS
  }
  const rows = groups[filter]
  const filters: { key: typeof filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "bandwidth", label: "Bandwidth" },
    { key: "depin", label: "DePIN" },
    { key: "storage", label: "Storage" },
    { key: "compute", label: "GPU / Compute" },
    { key: "interest", label: "Interest" },
    { key: "dividend", label: "Dividends" },
    { key: "rental", label: "Rental" },
    { key: "content", label: "Content" },
    { key: "crypto", label: "Crypto & Staking" },
    { key: "defi", label: "DeFi & Yield" },
    { key: "nft", label: "NFT & Royalties" },
    { key: "p2p", label: "P2P Lending" },
    { key: "agent", label: "AI Agent" }
  ]
  const onlineOnly = ["crypto", "defi", "nft", "p2p", "agent"]
  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 8 }}>
        {filters.map((f) => (
          <button key={f.key} className={filter === f.key ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Platform</th><th>Category</th><th>Residential IP</th><th>VPS OK</th><th>Payout</th><th>Link</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong></td>
                  <td>{STREAM_CATEGORY_LABELS[e.category] ?? e.category}</td>
                  <td>{onlineOnly.includes(e.category) ? "—" : e.residential ? "Yes" : "No"}</td>
                  <td>{onlineOnly.includes(e.category) ? "—" : e.vps ? "Yes" : "No"}</td>
                  <td>{e.payout}</td>
                  <td><a href={e.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Open →</a></td>
                  <td className="muted small">{e.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Catalog verified against public sources (2026). Dead/broken platforms (Peer2Profit, PacketShare, SpeedShare, Wipter,
          AntGain, GagaNode, earn.cc, WizardGain) are excluded. Earnings vary widely by location, IP type and hardware —
          these are free channels, not income promises.
        </p>
      </div>
    </div>
  )
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
