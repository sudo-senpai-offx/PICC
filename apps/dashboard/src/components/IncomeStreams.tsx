import { useEffect, useMemo, useRef, useState } from "react"
import { Link, NavLink } from "react-router-dom"
import type { SuiteId } from "@/lib/suites"
import { pushStreamsSnapshot, syncCashPilot, getSessionPolicy, setSessionPolicy } from "@/lib/api"
import type { SessionPolicyDecision } from "@/lib/api"
import { STREAM_CATEGORY_LABELS, CATALOG, CRYPTO_APPS, DEFI_APPS, NFT_APPS, P2P_APPS, AGENT_APPS, INTEREST_APPS, DIVIDEND_APPS, RENTAL_APPS, CONTENT_APPS, TRADING_PLATFORM_APPS } from "@/lib/streamCatalog"
import { StreamSetupWizard } from "@/components/StreamSetupWizard"
import { HoldingsEditor } from "@/components/HoldingsEditor"
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
  saveStreams,
  streamSummary,
  updateStream,
  upsertPlatformStream
} from "@/lib/streams"
import type { IncomeStream, StreamCategory, StreamStatus } from "@/lib/types"
import {
  listIncomeStreams,
  removeIncomeStream,
  upsertIncomeStream,
  useIncomeOverview
} from "@/lib/income"

// Creatable families come from the registry: active + coming-soon, never the
// unconfigured marker (rows with unknown families are shown as "Uncategorized").
import { FAMILIES, familyLabel, familyToSuite } from "@/lib/registry"
const CATEGORIES: StreamCategory[] = FAMILIES.filter((f) => f.status !== "unconfigured").map((f) => f.familyId)

export { StreamsTab, OverviewTab, CatalogTab }

// ---------------------------------------------------------------------
// Hub per-stream breakdown (UI-reskin REQ-D.1 / T8) — shared by the Income
// Command Centre. Every card resolves its owning ministry through the
// registry (familyToSuite), never a hardcoded path; an unknown family
// renders honestly (no dead link, "Uncategorized"); zero streams renders an
// honest empty state, never fabricated cards.
// ---------------------------------------------------------------------
export interface HubStreamRow {
  id: string
  name: string
  category: IncomeStream["category"]
  family: string
  suite: SuiteId | null
  to: string
  balance: number
}

export function hubBreakdown(streams: IncomeStream[]): HubStreamRow[] {
  return streams.map((s) => {
    const suite = familyToSuite(s.category)
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      family: familyLabel(s.category) ?? "Uncategorized",
      suite,
      to: suite ? `/suites/${suite}` : "",
      balance: s.balance
    }
  })
}

export function StreamBreakdown({ streams }: { streams: IncomeStream[] }) {
  const rows = hubBreakdown(streams)
  if (rows.length === 0) {
    return <p className="muted">No streams yet — add one in the Earnings suite.</p>
  }
  return (
    <div className="row wrap" style={{ gap: 12 }}>
      {rows.map((r) => {
        const inner = (
          <>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div className="muted small">
              {r.family}
              {r.suite ? ` · ${r.suite} suite` : " · unlinked (unknown family)"}
            </div>
            <div className="metric-value">{usd(r.balance)}</div>
          </>
        )
        return r.to ? (
          <NavLink
            key={r.id}
            to={r.to}
            data-testid="stream-card"
            className="nav-link card"
            style={{ flex: "1 1 220px" }}
          >
            {inner}
          </NavLink>
        ) : (
          <div key={r.id} data-testid="stream-card" className="card" style={{ flex: "1 1 220px" }}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------
// Streams tab
// ---------------------------------------------------------------------
function StreamsTab() {
  const [streams, setStreamsState] = useState<IncomeStream[]>(getStreams())
  const [earnings, setEarnings] = useState(getEarnings())
  const [collecting, setCollecting] = useState(false)
  const [collectorMsg, setCollectorMsg] = useState("")
  const collectorsRef = useRef<HTMLDivElement | null>(null)
  // Server-backed mode: once the income store has migrated and the server is
  // reachable, stream CRUD goes through /api/data/income_streams. We keep a
  // local mirror too so the offline/earnings layer (streams.ts) stays coherent.
  const [serverMode, setServerMode] = useState(false)
  const serverIdsRef = useRef<string[]>([])
  const [serverNote, setServerNote] = useState<string | null>(null)

  const savedCreds = useMemo(getCollectorCredentials, [])
  const [cpUrl, setCpUrl] = useState(savedCreds.cashpilotUrl)
  const [cpKey, setCpKey] = useState(savedCreds.cashpilotKey)

  const summary = useMemo(() => streamSummary(streams, earnings), [streams, earnings])

  // Prefer the user's server-side streams; fall back to local while a migration
  // is pending or the server is unreachable (the independence rule).
  useEffect(() => {
    let alive = true
    listIncomeStreams()
      .then((rows) => {
        if (!alive) return
        if (rows) {
          setStreamsState(rows)
          serverIdsRef.current = rows.map((r) => r.id)
          setServerMode(true)
          setServerNote(null)
        } else {
          setServerMode(false)
          setServerNote("Offline — showing streams from this device")
        }
      })
      .catch(() => {
        if (alive) {
          setServerMode(false)
          setServerNote("Offline — showing streams from this device")
        }
      })
    return () => {
      alive = false
    }
  }, [])

  // Single write path: update state + the local mirror, then (in server mode)
  // reconcile the whole list server-side. A server failure degrades to local so
  // a mutation never blocks on storage it can't reach.
  const commit = (next: IncomeStream[]) => {
    setStreamsState(next)
    saveStreams(next)
    if (!serverMode) return
    const gone = serverIdsRef.current.filter((id) => !next.some((s) => s.id === id))
    Promise.all([
      ...gone.map((id) => removeIncomeStream(id).catch(() => false)),
      ...next.map((s) => upsertIncomeStream(s).catch(() => null))
    ])
      .then(() => {
        serverIdsRef.current = next.map((s) => s.id)
      })
      .catch(() => {
        setServerMode(false)
        setServerNote("Server unreachable — edits now stay on this device")
      })
  }

  // Push stream data to the server snapshot so the studio overlay can show
  // balances on platforms without a public earner API. Debounced + best-effort.
  useEffect(() => {
    const t = window.setTimeout(() => {
      pushStreamsSnapshot(streams, earnings).catch(() => undefined)
    }, 1500)
    return () => window.clearTimeout(t)
  }, [streams, earnings])

  const addFromWizard = (input: Omit<IncomeStream, "id">) => {
    commit(addStream(input))
    setEarnings(getEarnings())
  }

  const jumpToCollectors = () => {
    collectorsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const importCashPilot = async () => {
    if (!cpUrl.trim()) return
    setCollecting(true)
    setCollectorMsg("")
    saveCollectorCredentials({ cashpilotUrl: cpUrl.trim(), cashpilotKey: cpKey.trim() })
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
          category: "uncategorized",
          lastCollected: new Date().toISOString()
        })
      }
      if (snap.daily.length > 0) {
        const { stream } = upsertPlatformStream("CashPilot (all services)", {
          collector: "cashpilot",
          status: "active",
          category: "uncategorized",
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
        commit(applyAutoEstimates(getStreams(), all))
      } else {
        commit(applyAutoEstimates(getStreams(), getEarnings()))
      }
      setCollectorMsg(`✅ CashPilot imported — ${snap.breakdown.length} services, aggregate ${usd(snap.summary.total)}`)
    } catch (err) {
      setCollectorMsg(`❌ ${(err as Error).message}`)
    } finally {
      setCollecting(false)
    }
  }

  const resetForm = () => setForm({ name: "", category: CATEGORIES[0], platform: "", estimatedDaily: "", threshold: "", payoutMethod: "PayPal", balance: "", totalEarned: "", url: "" })
  const [form, setForm] = useState({ name: "", category: CATEGORIES[0] as StreamCategory, platform: "", estimatedDaily: "", threshold: "", payoutMethod: "PayPal", balance: "", totalEarned: "", url: "" })

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
    commit(addStream(stream))
    resetForm()
  }

  const setStatus = (id: string, status: StreamStatus) => commit(updateStream(id, { status }))
  const del = (id: string) => {
    commit(removeStream(id))
    setEarnings(getEarnings())
  }

  const recent = earnings.slice(0, 20)

  return (
    <div className="stack">
      {serverNote ? (
        <p className="muted small" style={{ color: "var(--muted)" }}>
          {serverNote}
        </p>
      ) : serverMode ? (
        <p className="muted small">Synced to your server-side income store.</p>
      ) : null}
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
            <input className="input" placeholder="CashPilot URL (http://localhost:8080)" value={cpUrl} onChange={(e) => setCpUrl(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
            <input className="input" placeholder="CashPilot admin key" value={cpKey} onChange={(e) => setCpKey(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
            <button className="btn btn-primary" disabled={collecting || !cpUrl.trim()} onClick={importCashPilot}>Import from CashPilot</button>
          </div>
          {collectorMsg ? <p className="muted small">{collectorMsg}</p> : null}
          <p className="muted small">
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
          <input className="input" placeholder="Platform (REIT, cashback…)" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
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
// Overview tab — unified aggregates + holdings from GET /api/income/overview
// ---------------------------------------------------------------------
function OverviewTab() {
  const { overview, loading, reload } = useIncomeOverview()

  if (loading) return <div className="card"><p className="muted">Loading overview…</p></div>
  if (!overview) return <div className="card"><p className="muted">Overview unavailable.</p></div>

  const { summary, snapshots, holdings, source } = overview
  const snapList = Object.values(snapshots)
  const holdingsCount = holdings.nft.length + holdings.depin.length + holdings.financial.length + holdings.transactions.length

  return (
    <div className="stack">
      <p className="muted small">
        Unified view across connector snapshots and your tracked streams
        {source === "server" ? " — synced from your server-side income store." : " — offline, showing this device."}
      </p>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Last 30 days</span>
          <strong>{summary.monthly > 0 ? usd(summary.monthly) : "—"}</strong>
          <span className="muted">recorded earnings</span>
        </div>
        <div className="stat">
          <span className="stat-label">Lifetime</span>
          <strong>{summary.lifetime > 0 ? usd(summary.lifetime) : "—"}</strong>
          <span className="muted">from snapshots + streams</span>
        </div>
        <div className="stat">
          <span className="stat-label">Projected /yr</span>
          <strong>{summary.projectedAnnual > 0 ? usd(summary.projectedAnnual) : "—"}</strong>
          <span className="muted">{summary.activeCount} active streams</span>
        </div>
        <div className="stat">
          <span className="stat-label">Today</span>
          <strong>{summary.today > 0 ? usd(summary.today) : "—"}</strong>
          <span className="muted">across all sources</span>
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

      {snapList.length > 0 && (
        <div className="card">
          <h2>Connectors</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Source</th><th>Balance</th><th>Lifetime</th><th>Today</th><th>Status</th></tr>
              </thead>
              <tbody>
                {snapList.map((s) => (
                  <tr key={s.provider}>
                    <td><strong>{s.platform ?? s.provider}</strong></td>
                    <td>{typeof s.balance === "number" ? usd(s.balance) : "—"}</td>
                    <td>{typeof s.lifetime === "number" ? usd(s.lifetime) : "—"}</td>
                    <td>{typeof s.today === "number" ? usd(s.today) : "—"}</td>
                    <td>
                      {s.status === "error" ? (
                        <span className="badge" style={{ color: "var(--danger)", fontWeight: 600 }}>⚠ error</span>
                      ) : s.status === "stale" ? (
                        <span className="muted">stale</span>
                      ) : s.status === "unconfigured" ? (
                        <span className="muted">not configured</span>
                      ) : (
                        <span style={{ color: "var(--success)" }}>ok</span>
                      )}
                      {s.error ? <span className="muted small" title={s.error}> — {s.error}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Holdings</h2>
        {holdingsCount === 0 ? (
          <p className="muted">No holdings recorded yet — add one below.</p>
        ) : (
          <div className="row wrap" style={{ gap: 12 }}>
            {[
              { label: "NFT", list: holdings.nft },
              { label: "DePIN nodes", list: holdings.depin },
              { label: "Financial accounts", list: holdings.financial },
              { label: "Transactions", list: holdings.transactions }
            ].map((g) => (
              <div key={g.label} className="card" style={{ flex: "1 1 220px" }}>
                <strong>{g.label}</strong>
                <div className="muted">{(g.list ?? []).length} record(s)</div>
                {g.list.slice(0, 5).map((row, i) => (
                  <div key={i} className="small">{holdingLabel(row, i)}</div>
                ))}
              </div>
            ))}
          </div>
        )}
        <HoldingsEditor onChange={reload} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Catalog tab
// ---------------------------------------------------------------------
function CatalogTab() {
  const [filter, setFilter] = useState<"all" | "crypto" | "defi" | "nft" | "p2p" | "agent" | "interest" | "dividend" | "rental" | "content" | "trading">("all")
  const groups: Record<string, typeof CATALOG> = {
    all: CATALOG,
    crypto: [...CRYPTO_APPS, ...DEFI_APPS],
    defi: DEFI_APPS,
    nft: NFT_APPS,
    p2p: P2P_APPS,
    agent: AGENT_APPS,
    interest: INTEREST_APPS,
    dividend: DIVIDEND_APPS,
    rental: RENTAL_APPS,
    content: CONTENT_APPS,
    trading: TRADING_PLATFORM_APPS
  }
  const rows = groups[filter] ?? CATALOG
  const filters: { key: typeof filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "interest", label: "Interest" },
    { key: "dividend", label: "Dividends" },
    { key: "rental", label: "Rental" },
    { key: "content", label: "Content" },
    { key: "trading", label: "Trading Platform" },
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

      {filter === "trading" ? <TradingSyncSettings /> : null}
    </div>
  )
}

function holdingLabel(row: Record<string, unknown>, index: number): string {
  const raw = row.name ?? row.platform ?? row.id ?? (row.provider ?? "")
  return raw === "" || raw == null ? `#${index + 1}` : String(raw)
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ---------------------------------------------------------------------
// Trading platform sync settings — per-venue first-login decision
// (session-policy API). "Auto-sync" = approved (gate auto-allows),
// "Don't sync" = rejected (gate silently blocks), "Ask each time" =
// undecided (the venue still proposes approval on first visit).
// ---------------------------------------------------------------------
function TradingSyncSettings() {
  const [venues, setVenues] = useState<Record<string, { venueId: string; name: string; decision: SessionPolicyDecision; at: string | null }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getSessionPolicy()
      .then((r) => { if (alive) { setVenues(r.venues); setLoading(false) } })
      .catch((err) => { if (alive) { setError((err as Error).message); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const setMode = async (venueId: string, decision: SessionPolicyDecision) => {
    setSaving(venueId)
    try {
      await setSessionPolicy(venueId, decision)
      setVenues((prev) => ({
        ...prev,
        [venueId]: { ...prev[venueId], decision, at: decision === "ask" ? null : new Date().toISOString() }
      }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="card"><p className="muted">Loading sync settings…</p></div>
  if (error) return <div className="card"><p className="muted" style={{ color: "var(--danger)" }}>{error}</p></div>

  return (
    <div className="card">
      <h2>Per-platform sync mode</h2>
      <p className="muted small">
        First-login approval decisions for the headless capture engine. "Auto-sync" means the session capture
        runs without asking; "Don't sync" means it never captures; "Ask each time" means the server proposes
        approval on the first visit (default). The decision persists across server restarts.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Platform</th><th>Sync mode</th><th>Decided</th></tr>
          </thead>
          <tbody>
            {Object.values(venues).map((v) => (
              <tr key={v.venueId}>
                <td><strong>{v.name}</strong></td>
                <td>
                  <select
                    className="input"
                    value={v.decision}
                    onChange={(e) => setMode(v.venueId, e.target.value as SessionPolicyDecision)}
                    disabled={saving === v.venueId}
                    style={{ padding: 2, minWidth: 140 }}
                  >
                    <option value="ask">Ask each time</option>
                    <option value="approved">Auto-sync</option>
                    <option value="rejected">Don't sync</option>
                  </select>
                </td>
                <td className="muted">{v.at ? new Date(v.at).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
