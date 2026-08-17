import { useEffect, useState } from "react"
import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: [
    "https://*.amazon.com/*",
    "https://*.youtube.com/*",
    "https://*.fidelity.com/*",
    "https://*.schwab.com/*",
    "https://dashboard.honeygain.com/*",
    "https://*.honeygain.com/*",
    "https://app.pawns.app/*",
    "https://*.pawns.app/*",
    "https://app.traffmonetizer.com/*",
    "https://*.traffmonetizer.com/*",
    "https://app.repocket.com/*",
    "https://*.repocket.com/*",
    "https://*.packetstream.io/*",
    "https://*.earnapp.com/*",
    "https://*.silencio.network/*",
    "https://*.coinapp.co/*",
    "https://app.expertoption.com/*",
    "https://opensea.io/*",
    "https://*.magiceden.io/*",
    "https://app.aave.com/*",
    "https://app.compound.finance/*",
    "https://yearn.fi/*",
    "https://app.yearn.fi/*",
    "https://app.getgrass.io/*",
    "https://app.gradient.network/*"
  ],
  run_at: "document_idle"
}

// ---------------------------------------------------------------------------
// Tier 0 platform registry — host → provider slug (matches the PICC server)
// ---------------------------------------------------------------------------

interface Tier0Platform {
  slug: string
  label: string
}

const TIER0: Record<string, Tier0Platform> = {
  honeygain: { slug: "honeygain", label: "Honeygain" },
  pawns: { slug: "pawns", label: "Pawns.app" },
  traffmonetizer: { slug: "traffmonetizer", label: "Traffmonetizer" },
  repocket: { slug: "repocket", label: "Repocket" },
  packetstream: { slug: "packetstream", label: "PacketStream" },
  earnapp: { slug: "earnapp", label: "EarnApp" },
  silencio: { slug: "silencio", label: "Silencio" },
  coin: { slug: "coin", label: "COIN (XYO)" }
}

function tier0Of(host: string): Tier0Platform | null {
  for (const [needle, platform] of Object.entries(TIER0)) {
    if (host.includes(needle)) return platform
  }
  return null
}

// ---------------------------------------------------------------------------
// Tier 1 platform registry — host → connector slug (the PICC server connector
// registry). Read-only aggregation via the browser bridge for sources that
// have no public API: NFT marketplaces, DeFi dashboards, DePIN networks and
// the ExpertOption trading dashboard.
// ---------------------------------------------------------------------------

interface Tier1Platform {
  slug: string
  label: string
  category: string
}

const TIER1: Record<string, Tier1Platform> = {
  expertoption: { slug: "expertoption", label: "ExpertOption", category: "trading" },
  opensea: { slug: "opensea", label: "OpenSea", category: "nft" },
  magiceden: { slug: "magiceden", label: "Magic Eden", category: "nft" },
  aave: { slug: "aave", label: "Aave", category: "defi" },
  compound: { slug: "compound", label: "Compound", category: "defi" },
  yearn: { slug: "yearn", label: "Yearn", category: "defi" },
  grass: { slug: "grass", label: "Grass", category: "bandwidth" },
  gradient: { slug: "gradient", label: "Gradient", category: "bandwidth" }
}

function tier1Of(host: string): Tier1Platform | null {
  for (const [needle, platform] of Object.entries(TIER1)) {
    if (host.includes(needle)) return platform
  }
  return null
}

interface ConnectorMeta {
  slug: string
  label: string
  category: string
  transports: string[]
  transport: string
  url: string
  tuned: boolean
}

interface ConnectorSnapshot {
  provider: string
  platform: string
  balance: number | null
  today: number | null
  lifetime: number | null
  payoutThreshold: number | null
  estimatedDaily: number | null
  currency: string
  source: string
  status: string
  error: string | null
  lastChecked: number
  extra?: { url?: string; title?: string; frames?: unknown[] }
}

interface ProviderStatus {
  slug: string
  platform: string
  configured: boolean
  status: "ok" | "error" | "not_configured"
  balance?: number
  lifetimeEarnings?: number
  todayEarnings?: number
  payoutThreshold?: number
  estimatedDaily?: number
  currency?: string
  error?: string | null
  lastChecked?: number | null
}

interface ManualStream {
  id: string
  name: string
  platform: string
  status: string
  balance: number
  totalEarned: number
  payoutThreshold: number
  estimatedDaily: number
}

interface AutomatorStatus {
  ok: boolean
  updatedAt: string
  pollIntervalMinutes: number
  providers: Record<string, ProviderStatus>
  manual: ManualStream[]
}

interface QuestItem {
  id: string
  platform: string
  label: string
  cadence: "daily" | "weekly"
  device: string
  url: string
  reward: string
  note: string
}

const overlay = {
  position: "fixed" as const,
  bottom: 20,
  left: 20,
  width: 300,
  maxHeight: "70vh",
  overflowY: "auto" as const,
  background: "#1a1a2e",
  color: "#eef0ff",
  padding: 16,
  borderRadius: 12,
  border: "1px solid #6c63ff",
  zIndex: 99999,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 14,
  lineHeight: 1.5,
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
}

function fmt(n: number | undefined, currency = "$") {
  if (n == null || Number.isNaN(n)) return "—"
  return `${currency}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

const QUEST_KEY = (platform: string) => `picc.quests.${platform}`

function loadDone(platform: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(QUEST_KEY(platform)) ?? "{}") as Record<string, string>
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Tier 0 overlay — balance, payout progress, quest reminders, keep-alive
// ---------------------------------------------------------------------------

function PiccTier0({ platform }: { platform: Tier0Platform }) {
  const [status, setStatus] = useState<AutomatorStatus | null>(null)
  const [quests, setQuests] = useState<QuestItem[]>([])
  const [backendUrl, setBackendUrl] = useState("")
  const [open, setOpen] = useState(true)
  const [spinned, setSpinned] = useState(false)
  const [err, setErr] = useState("")

  const base = () => backendUrl.replace(/\/+$/, "")

  useEffect(() => {
    chrome.storage.sync.get(["piccSettings"], (result) => {
      const url = (result.piccSettings?.backendUrl as string | undefined) ?? "http://localhost:5173"
      setBackendUrl(url)
    })
  }, [])

  useEffect(() => {
    if (!base()) return
    fetch(`${base()}/api/automator/status`)
      .then((r) => r.json())
      .then((d) => setStatus(d as AutomatorStatus))
      .catch(() => setErr("Dashboard offline — start the PICC server."))
    fetch(`${base()}/api/automator/quests`)
      .then((r) => r.json())
      .then((d) => {
        const all = (d?.quests ?? []) as QuestItem[]
        setQuests(all.filter((q) => q.platform === platform.label || q.platform === "All"))
      })
      .catch(() => undefined)
  }, [backendUrl])

  // Keep-alive presence ping so the dashboard shows the extension as online.
  useEffect(() => {
    if (!backendUrl) return
    const ping = () => {
      fetch(`${base()}/api/automator/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: "extension" })
      }).catch(() => undefined)
    }
    ping()
    const i = window.setInterval(ping, 120_000)
    return () => window.clearInterval(i)
  }, [backendUrl])

  // Honeygain Lucky Pot auto-spin — opt-in, safe in-app reward only.
  useEffect(() => {
    if (!backendUrl || platform.slug !== "honeygain") return
    if (sessionStorage.getItem("picc.hg.spun")) return
    chrome.storage.sync.get(["piccSettings"], (result) => {
      if (result.piccSettings?.tier0_autospin === false) return
      window.setTimeout(() => {
        try {
          const btn = Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) => {
            const text = (b.innerText ?? "").trim().toLowerCase()
            return /spin|open lucky pot/i.test(text) && text.length < 30
          })
          if (btn && btn.offsetParent !== null) {
            btn.click()
            setSpinned(true)
            sessionStorage.setItem("picc.hg.spun", "1")
          }
        } catch {
          /* DOM not available yet */
        }
      }, 6000)
    })
  }, [backendUrl, platform.slug])

  const provider = status?.providers?.[platform.slug]
  const manual =
    status?.manual?.find((s) => s.platform.toLowerCase() === platform.slug) ??
    status?.manual?.find((s) => s.name.toLowerCase().includes(platform.slug))

  const balance = provider?.balance ?? manual?.balance
  const today = provider?.todayEarnings ?? manual?.estimatedDaily
  const lifetime = provider?.lifetimeEarnings ?? manual?.totalEarned
  const threshold = provider?.payoutThreshold ?? manual?.payoutThreshold
  const estDaily = provider?.estimatedDaily ?? manual?.estimatedDaily
  const pct = threshold && balance != null ? Math.min(100, (balance / threshold) * 100) : 0
  const etaDays = estDaily && threshold && balance != null && balance < threshold ? Math.ceil((threshold - balance) / estDaily) : 0

  const [done, setDone] = useState<Record<string, string>>(() => loadDone(platform.slug))
  const doneCount = quests.filter((q) => done[q.id]).length

  const toggleQuest = (q: QuestItem) => {
    const next = { ...done }
    if (next[q.id]) delete next[q.id]
    else next[q.id] = new Date().toISOString()
    setDone(next)
    try {
      localStorage.setItem(QUEST_KEY(platform.slug), JSON.stringify(next))
    } catch {
      /* storage full / blocked */
    }
  }

  if (!open) {
    return (
      <div style={{ ...overlay, width: 44, padding: 8, textAlign: "center", cursor: "pointer" }} onClick={() => setOpen(true)} title="Open PICC Tier 0">
        <span style={{ fontSize: 18 }}>🖥️</span>
        <span style={{ display: "block", fontSize: 11, color: "#4ade80" }}>{doneCount}/{quests.length}</span>
      </div>
    )
  }

  return (
    <div style={overlay}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontWeight: 700, color: "#6c63ff" }}>🖥️ {platform.label}</span>
        <div>
          {platform.slug === "honeygain" && spinned ? (
            <span style={{ color: "#4ade80", fontSize: 11, marginRight: 8 }}>🎁 Spun</span>
          ) : null}
          <button style={{ background: "none", border: "none", color: "#9aa0c0", cursor: "pointer", fontSize: 16 }} onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
      </div>

      {err ? <p style={{ color: "#ff6b6b", fontSize: 12, margin: "0 0 8px" }}>{err}</p> : null}

      {balance != null ? (
        <div style={{ background: "rgba(108,99,255,0.08)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#9aa0c0", fontSize: 12 }}>Balance</span>
            <strong>{fmt(balance, provider?.currency ?? "$")}</strong>
          </div>
          {today != null ? (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ color: "#9aa0c0", fontSize: 12 }}>Today</span>
              <span style={{ color: "#4ade80", fontSize: 13 }}>{fmt(today, provider?.currency ?? "$")}</span>
            </div>
          ) : null}
          {lifetime != null ? (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ color: "#9aa0c0", fontSize: 12 }}>Lifetime</span>
              <span style={{ fontSize: 13 }}>{fmt(lifetime, provider?.currency ?? "$")}</span>
            </div>
          ) : null}
          {threshold ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 6, borderRadius: 999, background: "#2a2a4a", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "#4ade80" : "#6c63ff" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ color: "#9aa0c0", fontSize: 11 }}>{pct.toFixed(0)}% to payout ({fmt(threshold, provider?.currency ?? "$")})</span>
                <span style={{ color: "#fbbf24", fontSize: 11 }}>{etaDays ? `~${etaDays}d` : ""}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p style={{ color: "#9aa0c0", fontSize: 12, margin: "0 0 8px" }}>
          No balance yet. {provider && !provider.configured ? "Add credentials on the PICC dashboard (Streams → Automator)." : "Waiting for data…"}
        </p>
      )}
      {provider?.error ? <p style={{ color: "#ff6b6b", fontSize: 11, margin: "0 0 8px" }}>{provider.error}</p> : null}

      {quests.length > 0 ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 6px" }}>
            <span style={{ color: "#9aa0c0", fontSize: 11 }}>DAILY OPS · {doneCount}/{quests.length}</span>
            {quests.filter((q) => !done[q.id]).length > 0 ? (
              <span style={{ color: "#fbbf24", fontSize: 11 }}>{quests.filter((q) => !done[q.id]).length} due</span>
            ) : (
              <span style={{ color: "#4ade80", fontSize: 11 }}>all clear ✓</span>
            )}
          </div>
          {quests.map((q) => (
            <label
              key={q.id}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                fontSize: 12,
                color: done[q.id] ? "#5a6078" : "#c9cdf0",
                marginBottom: 8,
                cursor: "pointer"
              }}
            >
              <input
                type="checkbox"
                style={{ marginTop: 2, accentColor: "#6c63ff" }}
                checked={!!done[q.id]}
                onChange={() => toggleQuest(q)}
              />
              <span style={{ flex: 1 }}>
                {q.label}
                <span style={{ display: "block", color: "#9aa0c0", fontSize: 11 }}>{q.reward} · {q.cadence}</span>
              </span>
              <a
                href={q.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => toggleQuest(q)}
                style={{ color: "#6c63ff", textDecoration: "none", fontSize: 11, whiteSpace: "nowrap" }}
              >
                open ↗
              </a>
            </label>
          ))}
        </div>
      ) : null}

      <p style={{ color: "#5a6078", fontSize: 10, margin: "8px 0 0" }}>
        PICC tracks, reminds and shows you online. It never spends or submits without your click.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tier 1 overlay — read-only connector aggregation. Tells you what PICC can
// read on this platform and, when you ask, pulls the live numbers straight
// off the page with the browser bridge. Nothing is executed or submitted.
// ---------------------------------------------------------------------------

interface AnalyticsRow {
  label: string
  value: string
  tone?: "ok" | "warn" | "err"
}

// Shortest element whose text contains `needle` (and a digit when
// `needNumber`) — mirrors the server bridge's `text:` selector for hashed
// class names. Used to surface live numbers PICC can already see on the page.
function findByLabel(needle: string, needNumber = true): string | null {
  const tags = "div, span, p, strong, td, h1, h2, h3, li, label, a, dd, dt, button"
  const matches: string[] = []
  for (const el of document.querySelectorAll<HTMLElement>(tags)) {
    const t = (el.textContent ?? "").trim().replace(/\s+/g, " ")
    if (t.includes(needle) && (!needNumber || /\d/.test(t)) && t.length <= 120) matches.push(t)
  }
  if (matches.length === 0) return null
  const withNumber = matches.filter((m) => /\d/.test(m))
  const pool = needNumber && withNumber.length ? withNumber : matches
  pool.sort((a, b) => a.length - b.length)
  return pool[0]?.slice(0, 80) ?? null
}

function nftAnalytics(): AnalyticsRow[] {
  const floor = findByLabel("floor") ?? findByLabel("price")
  return [
    { label: "Floor price", value: floor ?? "not detected on page", tone: floor ? undefined : "err" },
    { label: "Royalty earnings", value: findByLabel("royalt") ?? "—", tone: "warn" },
    { label: "Est. flip spread", value: "advisory — compare listings first", tone: "warn" }
  ]
}

function defiAnalytics(): AnalyticsRow[] {
  const apy = findByLabel("apy") ?? findByLabel("yield")
  const apyNum = Number.parseFloat(String(apy?.match(/[\d.,]+/)?.[0] ?? "").replace(/,/g, ""))
  return [
    { label: "Current APY", value: apy ?? "not detected on page", tone: apy ? undefined : "err" },
    {
      label: "Risk score",
      value: apyNum > 20 ? "high" : apyNum > 8 ? "medium" : apyNum > 0 ? "low" : "—",
      tone: apyNum > 20 ? "err" : apyNum > 8 ? "warn" : "ok"
    },
    { label: "Best yield", value: "advisory — compare on defillama.com", tone: "warn" }
  ]
}

function depinAnalytics(): AnalyticsRow[] {
  return [
    { label: "Earnings today", value: findByLabel("today") ?? findByLabel("earning") ?? "—", tone: "warn" },
    { label: "Node status", value: findByLabel("status") ?? "page-dependent", tone: "ok" }
  ]
}

function categoryAnalytics(category: string): AnalyticsRow[] {
  if (category === "nft") return nftAnalytics()
  if (category === "defi") return defiAnalytics()
  if (category === "bandwidth") return depinAnalytics()
  return []
}

function PiccTier1({ platform }: { platform: Tier1Platform }) {
  const [backendUrl, setBackendUrl] = useState("")
  const [connector, setConnector] = useState<ConnectorMeta | null>(null)
  const [browser, setBrowser] = useState<boolean | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [snapshot, setSnapshot] = useState<ConnectorSnapshot | null>(null)
  const [err, setErr] = useState("")
  const [open, setOpen] = useState(true)
  const [rows, setRows] = useState<AnalyticsRow[]>(() => categoryAnalytics(platform.category))

  const base = () => backendUrl.replace(/\/+$/, "")

  useEffect(() => {
    chrome.storage.sync.get(["piccSettings"], (result) => {
      const url = (result.piccSettings?.backendUrl as string | undefined) ?? "http://localhost:5173"
      setBackendUrl(url)
    })
  }, [])

  useEffect(() => {
    if (!base()) return
    fetch(`${base()}/api/connectors`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d?.connectors ?? []) as ConnectorMeta[]
        setConnector(list.find((c) => c.slug === platform.slug) ?? null)
        setBrowser(d?.browser === true)
      })
      .catch(() => setErr("Dashboard offline — start the PICC server."))
  }, [backendUrl])

  const collect = async () => {
    if (!base()) return
    setCollecting(true)
    setErr("")
    try {
      const r = await fetch(`${base()}/api/connectors/${platform.slug}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
      const data = (await r.json()) as ConnectorSnapshot
      if (!r.ok) throw new Error(data.error ?? `collect failed (${r.status})`)
      setSnapshot(data)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setCollecting(false)
    }
  }

  if (!open) {
    return (
      <div style={{ ...overlay, width: 44, padding: 8, textAlign: "center", cursor: "pointer" }} onClick={() => setOpen(true)} title={`Open PICC · ${platform.label}`}>
        <span style={{ fontSize: 18 }}>📡</span>
      </div>
    )
  }

  return (
    <div style={overlay}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontWeight: 700, color: "#6c63ff" }}>
          📡 {platform.label} <span style={{ color: "#9aa0c0", fontSize: 11, fontWeight: 500 }}>· {platform.category}</span>
        </span>
        <button style={{ background: "none", border: "none", color: "#9aa0c0", cursor: "pointer", fontSize: 16 }} onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      {err ? <p style={{ color: "#ff6b6b", fontSize: 12, margin: "0 0 8px" }}>{err}</p> : null}

      {connector ? (
        <div style={{ background: "rgba(108,99,255,0.08)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#9aa0c0", fontSize: 12 }}>Transport</span>
            <span style={{ fontSize: 12 }}>{connector.transports.join(" / ")}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ color: "#9aa0c0", fontSize: 12 }}>Browser bridge</span>
            <span style={{ color: browser === true ? "#4ade80" : browser === false ? "#fbbf24" : "#9aa0c0", fontSize: 12 }}>
              {browser === true ? "ready" : browser === false ? "no browser found" : "checking…"}
            </span>
          </div>
          {!connector.tuned ? (
            <p style={{ color: "#fbbf24", fontSize: 11, margin: "6px 0 0" }}>
              ⚠️ Page selectors are untested — first collect may need one-time tuning.
            </p>
          ) : null}
        </div>
      ) : (
        <p style={{ color: "#9aa0c0", fontSize: 12, margin: "0 0 8px" }}>No connector registered for this platform.</p>
      )}

      {snapshot ? (
        <div style={{ background: "rgba(108,99,255,0.08)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          {snapshot.status === "error" ? (
            <p style={{ color: "#ff6b6b", fontSize: 12, margin: 0 }}>❌ {snapshot.error}</p>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#9aa0c0", fontSize: 12 }}>Balance</span>
                <strong>{fmt(snapshot.balance ?? undefined, snapshot.currency ?? "$")}</strong>
              </div>
              {snapshot.today != null ? (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ color: "#9aa0c0", fontSize: 12 }}>Today</span>
                  <span style={{ color: "#4ade80", fontSize: 13 }}>{fmt(snapshot.today, snapshot.currency ?? "$")}</span>
                </div>
              ) : null}
              {snapshot.lifetime != null ? (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ color: "#9aa0c0", fontSize: 12 }}>Lifetime</span>
                  <span style={{ fontSize: 13 }}>{fmt(snapshot.lifetime, snapshot.currency ?? "$")}</span>
                </div>
              ) : null}
              <p style={{ color: "#5a6078", fontSize: 10, margin: "6px 0 0" }}>
                read {new Date(snapshot.lastChecked).toLocaleTimeString()} · via {snapshot.source}
              </p>
            </>
          )}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div style={{ background: "rgba(108,99,255,0.08)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: "#c9cdf0" }}>
            📊 Live page read
          </div>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 4 }}>
              <span style={{ color: "#9aa0c0" }}>{r.label}</span>
              <span
                style={{
                  textAlign: "right",
                  color: r.tone === "err" ? "#ff6b6b" : r.tone === "warn" ? "#fbbf24" : r.tone === "ok" ? "#4ade80" : "#eef0ff"
                }}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <button
        style={{
          width: "100%",
          background: "#6c63ff",
          color: "#fff",
          border: "none",
          padding: "8px 12px",
          borderRadius: 6,
          cursor: collecting ? "wait" : "pointer",
          fontSize: 12,
          fontWeight: 600
        }}
        disabled={collecting || !connector}
        onClick={collect}
      >
        {collecting ? "Reading page…" : "🔍 Collect live numbers"}
      </button>

      <p style={{ color: "#5a6078", fontSize: 10, margin: "8px 0 0" }}>
        Read-only aggregation. PICC never spends, trades or submits on your behalf.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Suggestion overlay (existing AI decision-support)
// ---------------------------------------------------------------------------

interface Suggestion {
  id: string
  title: string
  body: string
  confidence: number
}

interface SuggestResponse {
  suggestions: Suggestion[]
  source: string
}

function extractPageData(): Record<string, unknown> {
  const host = location.hostname
  if (host.includes("amazon")) {
    const title = document.querySelector<HTMLElement>("#productTitle")?.innerText?.trim() ?? ""
    const bullets = Array.from(
      document.querySelectorAll<HTMLElement>("#feature-bullets li span.a-list-item")
    )
      .map((el) => el.innerText.trim())
      .filter(Boolean)
    const brand =
      document.querySelector<HTMLElement>("#bylineInfo")?.innerText?.replace(/^Visit the /, "").replace(/" Store.*$/, "") ?? ""
    const asinMatch = location.pathname.match(/\/([A-Z0-9]{10})\/?$/) ?? location.pathname.match(/\/(dp|gp\/product)\/([A-Z0-9]{10})/)
    return {
      asin: asinMatch?.[2] ?? asinMatch?.[1] ?? "",
      brand,
      title,
      bullets
    }
  }
  if (host.includes("youtube")) {
    const videoTitle =
      document.querySelector<HTMLElement>("h1 yt-formatted-string")?.innerText?.trim() ??
      document.title.replace(/\s*[-–]\s*YouTube$/, "").trim()
    const channelName =
      document.querySelector<HTMLElement>("#owner #channel-name")?.innerText?.trim() ??
      document.querySelector<HTMLElement>("#owner yt-formatted-string")?.innerText?.trim() ?? ""
    const description =
      document.querySelector<HTMLElement>("#description-inline-expander")?.innerText?.slice(0, 1500) ??
      document.querySelector<HTMLElement>("meta[name='description']")?.getAttribute("content") ?? ""
    return { videoTitle, channelName, description }
  }
  return {}
}

const REVIEW_SECONDS = 5

const s = {
  overlay: {
    position: "fixed" as const,
    bottom: 20,
    right: 20,
    width: 320,
    maxHeight: "70vh",
    overflowY: "auto" as const,
    background: "#1a1a2e",
    color: "#eef0ff",
    padding: 16,
    borderRadius: 12,
    border: "1px solid #6c63ff",
    zIndex: 99999,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 14,
    lineHeight: 1.5,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
  },
  header: { margin: "0 0 10px", color: "#6c63ff", display: "flex", justifyContent: "space-between" as const, alignItems: "center" as const },
  close: { background: "none", border: "none", color: "#9aa0c0", cursor: "pointer", fontSize: 16 },
  card: { background: "rgba(108,99,255,0.08)", borderRadius: 8, padding: 10, marginBottom: 10 },
  title: { fontWeight: 600 as const, color: "#eef0ff" },
  body: { color: "#c9cdf0", fontSize: 13, margin: "4px 0 8px" },
  conf: { color: "#fbbf24", fontSize: 11 },
  timer: { color: "#ff6b6b", fontSize: 12, margin: "6px 0" },
  ready: { color: "#4ade80", fontSize: 12, margin: "6px 0" },
  check: { display: "flex" as const, gap: 6, alignItems: "flex-start" as const, fontSize: 12, color: "#9aa0c0", marginBottom: 8 },
  btn: {
    background: "#6c63ff",
    color: "#fff",
    border: "none",
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600
  },
  btnDone: {
    background: "rgba(74,222,128,0.15)",
    color: "#4ade80"
  }
}

function confirm(settings: { backendUrl?: string }, surface: string, suggestionId: string) {
  const base = settings.backendUrl?.replace(/\/+$/, "")
  if (base) {
    fetch(`${base}/api/extension/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface, suggestionId, acknowledged: true })
    }).catch(() => undefined)
  }
}

function PiccSuggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [backendUrl, setBackendUrl] = useState("")
  const [counters, setCounters] = useState<Record<string, number>>({})
  const [acked, setAcked] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<Record<string, boolean>>({})

  useEffect(() => {
    chrome.storage.sync.get(["piccSettings"], (result) => {
      const settings = result.piccSettings
      if (settings?.backendUrl) setBackendUrl(settings.backendUrl)
      if (!settings?.auto_suggest) return
      chrome.runtime.sendMessage(
        {
          type: "PICC_GET_SUGGESTIONS",
          url: location.href,
          pageTitle: document.title,
          pageData: extractPageData()
        },
        (res?: SuggestResponse) => {
          if (res?.suggestions?.length) {
            setSuggestions(res.suggestions)
            setSource(res.source)
            const init: Record<string, number> = {}
            for (const sg of res.suggestions) init[sg.id] = REVIEW_SECONDS
            setCounters(init)
          }
        }
      )
    })
  }, [])

  useEffect(() => {
    const anyRunning = Object.values(counters).some((v) => v > 0)
    if (!anyRunning) return
    const t = window.setInterval(() => {
      setCounters((prev) => {
        const next: Record<string, number> = {}
        let changed = false
        for (const [k, v] of Object.entries(prev)) {
          next[k] = v > 0 ? v - 1 : 0
          if (next[k] !== v) changed = true
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [counters])

  if (!open) return null

  const handleCopy = (sg: Suggestion) => {
    navigator.clipboard.writeText(sg.body)
    confirm({ backendUrl }, "extension", sg.id)
    setCopied((c) => ({ ...c, [sg.id]: true }))
    window.setTimeout(() => setCopied((c) => ({ ...c, [sg.id]: false })), 2000)
  }

  return (
    <div style={s.overlay}>
      <div style={s.header}>
        <span>🧠 PICC Assistant</span>
        <button style={s.close} onClick={() => setOpen(false)} aria-label="Close">
          ✕
        </button>
      </div>
      {source && <p style={{ color: "#9aa0c0", fontSize: 11, margin: "0 0 8px" }}>Suggestions: {source === "remote" ? "PICC AI" : "on-device engine"}</p>}
      {suggestions.length === 0 ? (
        <p style={{ color: "#9aa0c0", fontSize: 13 }}>No suggestions for this page yet.</p>
      ) : (
        suggestions.map((sg) => {
          const count = counters[sg.id] ?? 0
          const ready = count <= 0 && acked[sg.id]
          return (
            <div key={sg.id} style={s.card}>
              <div style={s.title}>{sg.title}</div>
              <div style={s.body}>{sg.body}</div>
              <div style={s.conf}>{Math.round(sg.confidence * 100)}% confidence · AI data only</div>
              {count > 0 ? (
                <div style={s.timer}>⏱️ Human review required — {count}s</div>
              ) : (
                <div style={s.ready}>✅ Review complete — you are in control</div>
              )}
              <label style={s.check}>
                <input
                  type="checkbox"
                  disabled={count > 0}
                  checked={!!acked[sg.id]}
                  onChange={(e) => setAcked((a) => ({ ...a, [sg.id]: e.target.checked }))}
                />
                <span>I confirm I am a human making this final decision.</span>
              </label>
              <button
                style={copied[sg.id] ? { ...s.btn, ...s.btnDone } : s.btn}
                disabled={!ready}
                onClick={() => handleCopy(sg)}
              >
                {copied[sg.id] ? "✅ Copied" : "📋 Copy suggestion"}
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}

export default function PiccOverlay() {
  const platform = tier0Of(location.hostname)
  if (platform) return <PiccTier0 platform={platform} />
  const tier1 = tier1Of(location.hostname)
  if (tier1) return <PiccTier1 platform={tier1} />
  return <PiccSuggestions />
}
