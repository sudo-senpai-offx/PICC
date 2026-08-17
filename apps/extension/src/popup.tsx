import { useEffect, useState } from "react"
import { getSettings, setSettings } from "./background"
import type { PiccSettings } from "./background"

const PLATFORMS = [
  { key: "amazon", label: "Amazon Seller" },
  { key: "youtube", label: "YouTube Studio" },
  { key: "brokerage", label: "Brokerages" }
] as const

interface ProviderStatus {
  slug: string
  platform: string
  configured: boolean
  status: "ok" | "error" | "not_configured"
  balance?: number
  payoutThreshold?: number
  currency?: string
  error?: string | null
}

const TIER0_WATCH = ["honeygain", "pawns", "traffmonetizer"] as const

export default function IndexPopup() {
  const [settings, setSettingsState] = useState<PiccSettings | null>(null)
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({})

  useEffect(() => {
    void getSettings().then((s) => {
      setSettingsState(s)
      if (!s.backendUrl) return
      const base = s.backendUrl.replace(/\/+$/, "")
      fetch(`${base}/api/automator/status`)
        .then((r) => r.json())
        .then((d) => setProviders(d.providers ?? {}))
        .catch(() => undefined)
    })
  }, [])

  if (!settings) {
    return (
      <div style={{ width: 320, padding: 16, background: "#0d0d1a", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        Loading…
      </div>
    )
  }

  const toggle = (patch: Partial<PiccSettings>) => {
    const next = { ...settings, ...patch }
    setSettingsState(next)
    void setSettings(next)
  }

  const togglePlatform = (key: keyof PiccSettings["platforms"]) => {
    toggle({ platforms: { ...settings.platforms, [key]: !settings.platforms[key] } })
  }

  const openDashboard = () => {
    if (settings.backendUrl) chrome.tabs.create({ url: settings.backendUrl })
  }

  return (
    <div style={{ width: 320, padding: 16, background: "#0d0d1a", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ color: "#6c63FF", margin: "0 0 4px", fontSize: 18 }}>🧠 PICC Overlay</h2>
      <p style={{ fontSize: 13, color: "#888", margin: "0 0 14px" }}>
        AI suggestions for your passive income platforms. PICC analyzes — you click.
      </p>

      <Row label="Overlay enabled">
        <Toggle checked={settings.enabled} onChange={(v) => toggle({ enabled: v })} />
      </Row>
      <Row label="Auto-suggest on page load">
        <Toggle checked={settings.auto_suggest} onChange={(v) => toggle({ auto_suggest: v })} />
      </Row>
      <Row label="Auto-spin Honeygain Lucky Pot">
        <Toggle checked={settings.tier0_autospin} onChange={(v) => toggle({ tier0_autospin: v })} />
      </Row>

      <div style={{ margin: "14px 0" }}>
        <div style={{ fontSize: 12, color: "#aaa", marginBottom: 6 }}>TIER 0 STATUS</div>
        {TIER0_WATCH.map((slug) => {
          const p = providers[slug]
          if (!p) {
            return (
              <div key={slug} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, color: "#888" }}>
                <span>{slug}</span>
                <span>…</span>
              </div>
            )
          }
          const ready = p.status === "ok" && p.balance != null
          return (
            <div key={slug} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
              <span style={{ color: "#ddd" }}>{p.platform}</span>
              <span style={{ color: ready ? "#4ade80" : p.error ? "#ff6b6b" : "#fbbf24" }}>
                {ready
                  ? `${(p.currency ?? "$")}${p.balance?.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : p.status === "error"
                    ? "error"
                    : p.configured
                      ? "syncing…"
                      : "not set"}
              </span>
            </div>
          )
        })}
      </div>

      <div style={{ margin: "14px 0" }}>
        <div style={{ fontSize: 12, color: "#aaa", marginBottom: 6 }}>ACTIVE PLATFORMS</div>
        {PLATFORMS.map((p) => (
          <Row key={p.key} label={p.label}>
            <Toggle checked={settings.platforms[p.key]} onChange={() => togglePlatform(p.key)} />
          </Row>
        ))}
      </div>

      <label style={{ display: "block", fontSize: 12, color: "#aaa", marginBottom: 4 }}>PICC dashboard URL</label>
      <input
        value={settings.backendUrl ?? ""}
        onChange={(e) => toggle({ backendUrl: e.target.value })}
        placeholder="http://localhost:5173"
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#161630",
          border: "1px solid #2a2a4a",
          color: "#eef0ff",
          borderRadius: 8,
          padding: 8,
          fontSize: 13
        }}
      />

      <button
        onClick={openDashboard}
        style={{
          width: "100%",
          marginTop: 14,
          padding: 10,
          background: "#6c63FF",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 600
        }}
      >
        ⚙️ Open Dashboard
      </button>

      <p style={{ fontSize: 11, color: "#666", margin: "12px 0 0" }}>
        Every suggestion requires a 5-second human review before copying. PICC never posts, buys, or
        submits anything for you. Auto-spin only claims free in-app rewards.
      </p>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontSize: 13, color: "#ddd" }}>{label}</span>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 44,
        height: 24,
        borderRadius: 999,
        background: checked ? "#6c63FF" : "#3a3a5c",
        border: "none",
        cursor: "pointer",
        transition: "background 0.2s",
        flexShrink: 0
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 22 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s"
        }}
      />
    </button>
  )
}
