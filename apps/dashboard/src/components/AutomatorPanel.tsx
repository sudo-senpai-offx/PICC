import { useEffect, useMemo, useState } from "react"
import {
  askAutomator,
  getAutomatorCredentials,
  getAutomatorHealth,
  getAutomatorStatus,
  getPresence,
  getQuests,
  getSchedulerStatus,
  getYields,
  saveAutomatorCredentials,
  scanNodes,
  postPresence,
  type AutomatorAlert,
  type AutomatorCredentials,
  type AutomatorHealth,
  type AutomatorIssue,
  type AutomatorStatus,
  type NodeInfo,
  type ProviderStatus,
  type QuestItem,
  type SchedulerStatus,
  type YieldSnapshot
} from "@/lib/api"
import { Badge, Button, Spinner } from "./ui"

const PAYOUT_URLS: Record<string, string> = {
  honeygain: "https://dashboard.honeygain.com",
  pawns: "https://pawns.app",
  traffmonetizer: "https://app.traffmonetizer.com",
  repocket: "https://repocket.com",
  earnapp: "https://earnapp.com"
}

const QUEST_KEY = "picc.quests.done" // { [questId]: "YYYY-MM-DD" }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function readQuestState(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(QUEST_KEY) ?? "{}") as Record<string, string>
  } catch {
    return {}
  }
}

function writeQuestState(state: Record<string, string>) {
  try {
    localStorage.setItem(QUEST_KEY, JSON.stringify(state))
  } catch {
    /* storage unavailable */
  }
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function etaLabel(balance: number, threshold: number, estDaily: number): string {
  if (threshold <= 0) return "no threshold set"
  if (balance >= threshold) return "ready to cash out"
  if (estDaily <= 0) return "add an est. $/day for ETA"
  const days = Math.ceil((threshold - balance) / estDaily)
  if (days <= 1) return "cashout tomorrow"
  return `~${days} days to cashout`
}

export function AutomatorPanel() {
  const [creds, setCreds] = useState<AutomatorCredentials | null>(null)
  const [status, setStatus] = useState<AutomatorStatus | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[] | null>(null)
  const [quests, setQuests] = useState<QuestItem[] | null>(null)
  const [presence, setPresence] = useState<{ extension?: boolean; dashboard?: boolean }>({})
  const [yields, setYields] = useState<YieldSnapshot | null>(null)
  const [sched, setSched] = useState<SchedulerStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState("")
  const [saving, setSaving] = useState(false)
  const [questDone, setQuestDone] = useState<Record<string, string>>(readQuestState())
  const [health, setHealth] = useState<AutomatorHealth | null>(null)
  const [askText, setAskText] = useState("")
  const [asking, setAsking] = useState(false)
  const [advice, setAdvice] = useState<{ source: string; text: string } | null>(null)

  useEffect(() => {
    void getAutomatorCredentials()
      .then((c) => {
        setCreds({
          honeygainToken: "",
          pawnsEmail: c.pawnsEmail || "",
          pawnsPassword: "",
          pawnsToken: "",
          traffmonetizerToken: "",
          repocketEmail: c.repocketEmail || "",
          repocketPassword: "",
          repocketToken: "",
          earnappOAuthToken: "",
          earnappBrdSessionId: c.earnappBrdSessionId || "",
          pollIntervalMinutes: c.pollIntervalMinutes || 15
        })
      })
      .catch(() => setMsg("Could not load automator settings."))
    void getPresence().then((p) => {
      const devices = p.devices ?? {}
      setPresence({
        extension: Boolean(devices.extension && devices.extension.minutesAgo < 30),
        dashboard: Boolean(devices.dashboard && devices.dashboard.minutesAgo < 30)
      })
    }).catch(() => undefined)
  }, [])

  const refresh = async () => {
    setLoading(true)
    setMsg("")
    try {
      const [st, ns, qs, pr, yl, sc, hl] = await Promise.all([
        getAutomatorStatus(),
        scanNodes(),
        getQuests(),
        getPresence().catch(() => null),
        getYields().catch(() => null),
        getSchedulerStatus().catch(() => null),
        getAutomatorHealth().catch(() => null)
      ])
      setStatus(st)
      setNodes(ns.nodes)
      setQuests(qs.quests)
      setYields(yl)
      setSched(sc)
      setHealth(hl)
      const devices = pr?.devices ?? {}
      setPresence({
        extension: Boolean(devices.extension && devices.extension.minutesAgo < 30),
        dashboard: Boolean(devices.dashboard && devices.dashboard.minutesAgo < 30)
      })
      setMsg("✅ Status refreshed.")
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const save = async () => {
    if (!creds) return
    setSaving(true)
    setMsg("")
    try {
      await saveAutomatorCredentials({
        honeygainToken: creds.honeygainToken,
        pawnsEmail: creds.pawnsEmail,
        pawnsPassword: creds.pawnsPassword,
        pawnsToken: creds.pawnsToken,
        traffmonetizerToken: creds.traffmonetizerToken,
        repocketEmail: creds.repocketEmail,
        repocketPassword: creds.repocketPassword,
        repocketToken: creds.repocketToken,
        earnappOAuthToken: creds.earnappOAuthToken,
        earnappBrdSessionId: creds.earnappBrdSessionId,
        pollIntervalMinutes: creds.pollIntervalMinutes
      })
      setCreds((c) => c && { ...c, honeygainToken: "", pawnsPassword: "", pawnsToken: "", traffmonetizerToken: "", repocketPassword: "", repocketToken: "", earnappOAuthToken: "" })
      setMsg("✅ Credentials saved (kept only on this server, used to poll providers).")
      await refresh()
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleQuest = (id: string) => {
    const next = { ...questDone }
    if (next[id] === today()) delete next[id]
    else next[id] = today()
    setQuestDone(next)
    writeQuestState(next)
  }

  const ping = () => {
    postPresence("dashboard").then(() => {
      setPresence((p) => ({ ...p, dashboard: true }))
      setMsg("✅ Dashboard heartbeat recorded.")
    }).catch(() => undefined)
  }

  const ask = async () => {
    setAsking(true)
    setAdvice(null)
    setMsg("")
    try {
      const r = await askAutomator(askText)
      setAdvice({ source: r.source, text: r.advice })
      if (r.issues?.length) setHealth((h) => (h ? { ...h, issues: r.issues } : h))
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`)
    } finally {
      setAsking(false)
    }
  }

  const providers = useMemo(() => (status?.providers ? Object.values(status.providers) : []), [status])

  const radar = useMemo(() => {
    const rows = [
      ...providers
        .filter((p) => p.status === "ok" && p.balance != null)
        .map((p) => ({ name: p.platform, balance: p.balance ?? 0, threshold: p.payoutThreshold ?? 0, estDaily: p.estimatedDaily ?? 0 })),
      ...(status?.manual ?? []).map((s) => ({ name: s.name, balance: s.balance, threshold: s.payoutThreshold, estDaily: s.estimatedDaily }))
    ]
    const ready = rows.filter((r) => r.threshold > 0 && r.balance >= r.threshold)
    let nextDays: number | null = null
    for (const r of rows) {
      if (r.threshold > 0 && r.estDaily > 0 && r.balance < r.threshold) {
        const d = Math.ceil((r.threshold - r.balance) / r.estDaily)
        if (nextDays == null || d < nextDays) nextDays = d
      }
    }
    return {
      rows,
      totalBalance: rows.reduce((a, r) => a + r.balance, 0),
      ready,
      projectedMonthly: rows.reduce((a, r) => a + r.estDaily * 30.4, 0),
      projectedAnnual: rows.reduce((a, r) => a + r.estDaily * 365, 0),
      nextDays
    }
  }, [providers, status])

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card">
        <div className="row space-between wrap" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>🧠 PICC Automator</h2>
          <div className="row" style={{ gap: 8 }}>
            <span className={`badge ${presence.dashboard ? "badge-success" : "badge-muted"}`}>
              dashboard {presence.dashboard ? "online" : "offline"}
            </span>
            <span className={`badge ${presence.extension ? "badge-success" : "badge-muted"}`}>
              extension {presence.extension ? "online" : "offline"}
            </span>
            <Button variant="secondary" onClick={ping}>Ping</Button>
            <Button onClick={refresh} disabled={loading}>Refresh status</Button>
          </div>
        </div>
        <p className="muted small">
          Live balances, cashout ETAs, daily quests and node health for your Tier 0 income streams. Credentials stay on
          this self-hosted server and are only used to poll the provider APIs at a polite interval. PICC never submits,
          claims, or spends on your behalf — payouts and risky actions always stay human-confirmed.
        </p>
      </div>

      <div className="card">
        <h2>📡 Income radar</h2>
        {status ? (
          <div className="row wrap" style={{ gap: 16 }}>
            <div style={{ minWidth: 150 }}>
              <div className="muted small">Combined balance</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{usd(radar.totalBalance)}</div>
            </div>
            <div style={{ minWidth: 150 }}>
              <div className="muted small">Projected / month</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{usd(radar.projectedMonthly)}</div>
              <div className="muted small">≈ {usd(radar.projectedAnnual)} / year</div>
            </div>
            <div style={{ minWidth: 150 }}>
              <div className="muted small">Ready to cash out</div>
              {radar.ready.length ? (
                <div className="row wrap" style={{ gap: 6 }}>
                  {radar.ready.map((r) => (
                    <Badge key={r.name} tone="success">{r.name}</Badge>
                  ))}
                </div>
              ) : (
                <div className="muted small">none yet</div>
              )}
            </div>
            <div style={{ minWidth: 150 }}>
              <div className="muted small">Next cashout</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {radar.nextDays == null ? "—" : radar.nextDays <= 1 ? "tomorrow" : `~${radar.nextDays} days`}
              </div>
              <div className="muted small">{radar.rows.length} tracked stream{radar.rows.length === 1 ? "" : "s"}</div>
            </div>
          </div>
        ) : (
          <p className="muted">Refresh status to compute your income radar.</p>
        )}
      </div>

      <div className="card">
        <h2>🛠️ Health &amp; helpers</h2>
        {!health ? (
          <p className="muted">Refreshes with the status above.</p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {health.issues.length ? (
              <div className="stack" style={{ gap: 6 }}>
                {health.issues.map((issue, i) => (
                  <IssueRow key={i} issue={issue} />
                ))}
              </div>
            ) : (
              <p className="muted small">No open issues — everything looks healthy.</p>
            )}
            {health.alerts.length ? (
              <>
                <h3 className="muted" style={{ margin: "8px 0 4px" }}>Recent alerts</h3>
                <div className="stack" style={{ gap: 6 }}>
                  {health.alerts.map((a) => (
                    <AlertRow key={a.id} alert={a} />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row space-between wrap" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>🤖 Automator assistant</h2>
          <Badge tone={advice?.source === "llm" ? "accent" : "muted"}>{advice ? (advice.source === "llm" ? "cloud LLM" : "local engine") : "local engine"}</Badge>
        </div>
        <p className="muted small">
          Ask anything about your streams — the assistant reads your live balances, node health and issues, and answers
          from the cloud LLM when configured, or the built-in rule engine otherwise. Advice is advisory; payouts and
          signups always stay manual.
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="e.g. What should I do this week? Is anything about to expire?"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !asking) void ask() }}
            style={{ flex: 1, minWidth: 260 }}
          />
          <Button onClick={() => void ask()} disabled={asking || !askText.trim()}>{asking ? "Thinking…" : "Ask"}</Button>
        </div>
        {advice ? (
          <p style={{ whiteSpace: "pre-wrap", margin: "10px 0 0", background: "var(--bg-card)", padding: "10px 12px", borderRadius: 8 }}>
            {advice.text}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>Provider credentials</h2>
        {!creds ? (
          <Spinner label="Loading settings…" />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <input
                className="input"
                type="password"
                placeholder="Honeygain bearer token (saved if left blank when re-saving)"
                value={creds.honeygainToken}
                onChange={(e) => setCreds({ ...creds, honeygainToken: e.target.value })}
                style={{ flex: 1, minWidth: 220 }}
              />
              <input
                className="input"
                placeholder="Pawns.app email"
                value={creds.pawnsEmail}
                onChange={(e) => setCreds({ ...creds, pawnsEmail: e.target.value })}
                style={{ flex: 1, minWidth: 180 }}
              />
              <input
                className="input"
                type="password"
                placeholder="Pawns.app password"
                value={creds.pawnsPassword}
                onChange={(e) => setCreds({ ...creds, pawnsPassword: e.target.value })}
                style={{ flex: 1, minWidth: 160 }}
              />
              <input
                className="input"
                type="password"
                placeholder="Pawns session JWT (optional — Google accounts)"
                value={creds.pawnsToken}
                onChange={(e) => setCreds({ ...creds, pawnsToken: e.target.value })}
                style={{ flex: 1, minWidth: 200 }}
              />
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <input
                className="input"
                type="password"
                placeholder="Traffmonetizer access_token (JWT)"
                value={creds.traffmonetizerToken}
                onChange={(e) => setCreds({ ...creds, traffmonetizerToken: e.target.value })}
                style={{ flex: 1, minWidth: 220 }}
              />
              <label className="row" style={{ gap: 6 }}>
                <span className="muted small">Poll every</span>
                <select
                  className="input"
                  value={creds.pollIntervalMinutes}
                  onChange={(e) => setCreds({ ...creds, pollIntervalMinutes: Number(e.target.value) })}
                  style={{ width: 80 }}
                >
                  {[5, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>{m}m</option>
                  ))}
                </select>
              </label>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save credentials"}</Button>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <input
                className="input"
                placeholder="Repocket email"
                value={creds.repocketEmail}
                onChange={(e) => setCreds({ ...creds, repocketEmail: e.target.value })}
                style={{ flex: 1, minWidth: 200 }}
              />
              <input
                className="input"
                type="password"
                placeholder="Repocket password"
                value={creds.repocketPassword}
                onChange={(e) => setCreds({ ...creds, repocketPassword: e.target.value })}
                style={{ flex: 1, minWidth: 180 }}
              />
              <input
                className="input"
                type="password"
                placeholder="Repocket session idToken (optional — Google accounts)"
                value={creds.repocketToken}
                onChange={(e) => setCreds({ ...creds, repocketToken: e.target.value })}
                style={{ flex: 1, minWidth: 220 }}
              />
              <input
                className="input"
                type="password"
                placeholder="EarnApp OAuth refresh token (cookie)"
                value={creds.earnappOAuthToken}
                onChange={(e) => setCreds({ ...creds, earnappOAuthToken: e.target.value })}
                style={{ flex: 1, minWidth: 240 }}
              />
            </div>
            <p className="muted small">
              Honeygain: copy the <code>Authorization: Bearer</code> token (dashboard.honeygain.com → DevTools →
              Network). Traffmonetizer: copy the <code>access_token</code> JWT (app.traffmonetizer.com → F12 →
              Application → Local Storage). Pawns &amp; Repocket: email/password, <em>or</em> a pasted session JWT if you
              signed up with Google — Pawns: copy the token from app.pawns.app browser storage; Repocket: DevTools →
              Network → any <code>api.repocket.com</code> request → <code>Auth-Token</code> header. EarnApp: the{" "}
              <code>oauth-refresh-token</code> cookie from earnapp.com (DevTools → Application → Cookies). Provider APIs
              are unofficial and may drift — failures are reported honestly, never faked.
            </p>
            <p className="muted small" style={{ color: "var(--warn)" }}>
              EarnApp's terms prohibit Docker containers, VMs, hosting services and home servers (account termination +
              cancelled payouts) — track it as a desktop-only stream and keep it off your Pi node.
            </p>
          </div>
        )}
        {msg ? <p className="muted small">{msg}</p> : null}
      </div>

      {loading && !status ? <Spinner label="Refreshing…" /> : null}

      <div className="card">
        <h2>Live balances</h2>
        {providers.length === 0 && !status ? (
          <p className="muted">Configure credentials above, then Refresh.</p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {providers.map((p) => (
              <ProviderRow key={p.slug} provider={p} />
            ))}
            {status?.manual.length ? (
              <>
                <h3 className="muted" style={{ margin: "8px 0 4px" }}>Tracked manually (no public earner API)</h3>
                {status.manual.map((s) => (
                  <ManualRow key={s.id} name={s.name} platform={s.platform} balance={s.balance} threshold={s.payoutThreshold} estDaily={s.estimatedDaily} url={s.url} />
                ))}
              </>
            ) : null}
            {status && providers.length === 0 && status.manual.length === 0 ? (
              <p className="muted">No provider credentials configured and no manual streams to show yet.</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row space-between wrap" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>🪙 Crypto & staking rates</h2>
          <Button variant="secondary" onClick={refresh} disabled={loading}>Refresh</Button>
        </div>
        {!yields ? (
          <p className="muted">Live DeFi + staking reference rates load with the status refresh (keyless sources).</p>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row wrap" style={{ gap: 16 }}>
              <div style={{ minWidth: 150 }}>
                <div className="muted small">Scheduler</div>
                <Badge tone={sched?.running ? "success" : "warn"}>{sched?.running ? "running" : "off"}</Badge>
              </div>
              <div style={{ minWidth: 150 }}>
                <div className="muted small">Liquid staking</div>
                <div style={{ fontWeight: 700 }}>
                  {yields.lsd.length ? `${yields.lsd[0].symbol} ${yields.lsd[0].apy.toFixed(2)}%` : "—"}
                </div>
              </div>
              <div style={{ minWidth: 150 }}>
                <div className="muted small">Top DeFi pool</div>
                <div style={{ fontWeight: 700 }}>
                  {yields.defi.length ? `${yields.defi[0].symbol} ${yields.defi[0].apy.toFixed(2)}%` : "—"}
                </div>
              </div>
              <div className="muted small" style={{ alignSelf: "center" }}>
                updated {new Date(yields.updatedAt).toLocaleTimeString()} · {yields.sources.defi}
              </div>
            </div>

            <div>
              <h3 className="muted" style={{ margin: "8px 0 4px" }}>Top DeFi pools (TVL ≥ $10M)</h3>
              {yields.defi.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Project</th><th>Symbol</th><th>Chain</th><th>APY</th><th>Base / reward</th><th>TVL</th></tr>
                    </thead>
                    <tbody>
                      {yields.defi.map((p) => (
                        <tr key={p.pool || `${p.project}-${p.symbol}-${p.chain}`}>
                          <td><strong>{p.project}</strong>{p.poolMeta ? <div className="muted small">{p.poolMeta}</div> : null}</td>
                          <td>{p.symbol}</td>
                          <td className="muted">{p.chain}</td>
                          <td><strong>{p.apy.toFixed(2)}%</strong>{p.ilRisk ? <div className="muted small" style={{ color: "var(--warn)" }}>IL risk</div> : null}</td>
                          <td className="muted small">{p.apyBase.toFixed(2)}% / {p.apyReward.toFixed(2)}%</td>
                          <td className="muted">${(p.tvlUsd / 1e6).toFixed(0)}M</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted small">No pools passed the filters right now — check back after the next refresh.</p>
              )}
            </div>

            <div>
              <h3 className="muted" style={{ margin: "8px 0 4px" }}>Liquid staking rates</h3>
              {yields.lsd.length ? (
                <div className="row wrap" style={{ gap: 8 }}>
                  {yields.lsd.map((r) => (
                    <span key={r.symbol} className="badge" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      {r.symbol} <strong>{r.apy.toFixed(2)}%</strong>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted small">No liquid staking rates available.</p>
              )}
            </div>

            <div>
              <h3 className="muted" style={{ margin: "8px 0 4px" }}>Native staking — reference ranges</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Coin</th><th>Network</th><th>APY range</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {yields.native.map((r) => (
                      <tr key={r.symbol}>
                        <td><strong>{r.symbol}</strong></td>
                        <td>{r.name}</td>
                        <td>{r.apyLow.toFixed(1)}–{r.apyHigh.toFixed(1)}%</td>
                        <td className="muted small">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>
                Reference ranges from {yields.sources.native}; they move with network stake levels. Rates are informational
                only — PICC never stakes, lends, or moves funds for you.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row space-between wrap" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>🌱 Sharing node health</h2>
          <Button variant="secondary" onClick={() => void scanNodes().then((r) => setNodes(r.nodes))}>Scan now</Button>
        </div>
        {!nodes ? (
          <p className="muted">Detects which sharing apps are running on this machine (tasklist) and in Docker.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>App</th><th>Status</th><th>Where</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.id}>
                    <td><strong>{n.name}</strong></td>
                    <td>
                      {n.detected ? <Badge tone="success">detected</Badge> : <Badge tone="muted">not running</Badge>}
                    </td>
                    <td className="muted">
                      {[n.process && "process", n.docker && "docker"].filter(Boolean).join(" + ") || "—"}
                    </td>
                    <td className="muted small">{n.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Only checks for running processes/containers — it cannot see apps on other devices (phone, Pi). Use the Pi node
          scripts in <code>infra/pi-node</code> to run these 24/7 on cheap hardware.
        </p>
      </div>

      <div className="card">
        <h2>📋 Daily quests & reminders</h2>
        {!quests ? (
          <p className="muted">Loading quest catalog…</p>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {quests.map((q) => {
              const done = questDone[q.id] === today()
              return (
                <div key={q.id} className="row wrap" style={{ gap: 8, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => toggleQuest(q.id)}
                    style={{ marginTop: 3 }}
                    title="Mark done today"
                  />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <strong style={{ textDecoration: done ? "line-through" : undefined, color: done ? "var(--text-muted)" : undefined }}>
                        {q.label}
                      </strong>
                      <Badge tone={q.device === "mobile" ? "accent" : "warn"}>{q.device}</Badge>
                      <Badge tone={q.cadence === "weekly" ? "muted" : "success"}>{q.cadence}</Badge>
                    </div>
                    <div className="muted small">
                      {q.platform} · {q.reward} · {q.note}
                    </div>
                  </div>
                  <a href={q.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Open →</a>
                </div>
              )
            })}
          </div>
        )}
        <p className="muted small">
          Silencio and COIN are mobile/location apps — PICC can't touch them from a browser, so these are reminders with
          deep links. Web-dashboard quests (e.g. Honeygain Lucky Pot) can be auto-spun from the extension overlay (opt-in).
        </p>
      </div>
    </div>
  )
}

function ProviderRow({ provider }: { provider: ProviderStatus }) {
  const url = PAYOUT_URLS[provider.slug]
  if (provider.status === "not_configured") {
    return (
      <div className="row space-between wrap" style={{ gap: 8 }}>
        <div>
          <strong>{provider.platform}</strong>
          <div className="muted small">Add credentials to monitor.</div>
        </div>
        <Badge tone="muted">not configured</Badge>
      </div>
    )
  }
  const balance = provider.balance ?? 0
  const threshold = provider.payoutThreshold ?? 0
  const pct = threshold > 0 ? Math.min(100, (balance / threshold) * 100) : 0
  const estDaily = provider.estimatedDaily ?? 0
  return (
    <div className="row space-between wrap" style={{ gap: 8 }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong>{provider.platform}</strong>
          {provider.status === "ok" ? (
            <Badge tone="success">live</Badge>
          ) : (
            <Badge tone="warn">error</Badge>
          )}
          {provider.tokenExpiresInDays != null ? (
            <Badge tone={provider.tokenExpiresInDays < 0 ? "danger" : provider.tokenExpiresInDays <= 7 ? "warn" : "muted"}>
              token {provider.tokenExpiresInDays < 0 ? "expired" : provider.tokenExpiresInDays <= 1 ? "expires today" : `expires in ${Math.ceil(provider.tokenExpiresInDays)}d`}
            </Badge>
          ) : null}
          <span className="muted small">
            {provider.lastChecked ? `checked ${new Date(provider.lastChecked).toLocaleTimeString()}` : ""}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <strong>{usd(balance)}</strong>
          <span className="muted small">of {threshold > 0 ? usd(threshold) : "no threshold"}</span>
        </div>
        <div className="bar-track" style={{ maxWidth: 360 }}>
          <div className="bar-fill" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--success)" : undefined }} />
        </div>
        <div className="muted small">{etaLabel(balance, threshold, estDaily)}</div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {provider.todayEarnings != null ? (
          <span className="muted small">today {usd(provider.todayEarnings)}</span>
        ) : null}
        {provider.lifetimeEarnings != null ? (
          <span className="muted small">lifetime {usd(provider.lifetimeEarnings)}</span>
        ) : null}
        {provider.error ? <span className="muted small" style={{ color: "var(--danger)" }}>{provider.error}</span> : null}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Dashboard →</a>
        ) : null}
      </div>
    </div>
  )
}

function ManualRow({ name, platform, balance, threshold, estDaily, url }: {
  name: string
  platform: string
  balance: number
  threshold: number
  estDaily: number
  url?: string
}) {
  const pct = threshold > 0 ? Math.min(100, (balance / threshold) * 100) : 0
  return (
    <div className="row space-between wrap" style={{ gap: 8 }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong>{name}</strong>
          <span className="muted small">{platform}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <strong>{usd(balance)}</strong>
          <span className="muted small">of {threshold > 0 ? usd(threshold) : "no threshold"}</span>
        </div>
        <div className="bar-track" style={{ maxWidth: 300 }}>
          <div className="bar-fill" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--success)" : undefined }} />
        </div>
        <div className="muted small">{etaLabel(balance, threshold, estDaily)}</div>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Open →</a>
      ) : null}
    </div>
  )
}

function IssueRow({ issue }: { issue: AutomatorIssue }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
      <Badge tone={issue.severity === "danger" ? "danger" : issue.severity === "warn" ? "warn" : issue.severity === "success" ? "success" : "muted"}>
        {issue.severity}
      </Badge>
      <div className="muted small" style={{ flex: 1, minWidth: 180 }}>
        {issue.platform ? <strong className="muted">{issue.platform}: </strong> : null}
        {issue.message}
      </div>
    </div>
  )
}

function AlertRow({ alert }: { alert: AutomatorAlert }) {
  const tone: "success" | "warn" | "muted" = alert.level === "danger" ? "warn" : alert.kind === "payout_ready" ? "success" : "muted"
  const label = alert.kind.replace(/_/g, " ")
  return (
    <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
      <Badge tone={tone}>{label}</Badge>
      <div className="muted small" style={{ flex: 1, minWidth: 180 }}>
        {alert.platform ? <strong className="muted">{alert.platform}: </strong> : null}
        {alert.note ?? ""}
      </div>
      <span className="muted small">{alert.created_at ? new Date(alert.created_at).toLocaleDateString() : ""}</span>
    </div>
  )
}
