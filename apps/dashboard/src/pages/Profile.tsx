import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { signOutLocal } from "@/lib/auth"
import { useUser } from "@/hooks/useAuth"
import {
  getHealth,
  getProfile,
  saveProfileName,
} from "@/lib/api"
import type { HealthInfo, ProfileInfo } from "@/lib/api"
import { FinanceTracker } from "@/components/FinanceTracker"

type Notice = { kind: "ok" | "warn" | "err"; text: string } | null

const LINKED_PROVIDERS = ["google", "email", "github"] as const

export function Profile() {
  const user = useUser()
  const navigate = useNavigate()
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [profileError, setProfileError] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const refresh = () => {
    getProfile()
      .then((p) => {
        setProfile(p)
        setName(p.name)
      })
      .catch(() => setProfileError(true))
  }

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {})
    refresh()
  }, [])

  const p = health?.providers

  const signOut = async () => {
    await signOutLocal()
    navigate("/login")
  }

  const saveName = async () => {
    setBusy("name")
    try {
      const r = await saveProfileName(name)
      setNotice({ kind: "ok", text: `Name saved: ${r.name || "(empty)"}` })
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <h1>Profile</h1>

      {/* Identity card */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">Identity</h2>
        <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
          <span className="muted">Email:</span>
          <span>{user?.email || "—"}</span>
        </div>
        {user?.name && (
          <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
            <span className="muted">Name:</span>
            <span>{user.name}</span>
          </div>
        )}
        {user?.createdAt && (
          <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
            <span className="muted">Created:</span>
            <span>{new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          Account and credentials are stored locally on this machine (server/data). Nothing leaves your home.
        </p>
      </div>

      {/* Account settings card */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">Account settings</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="field-label" htmlFor="profile-name">
              Your name
            </label>
            <input
              id="profile-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Tan"
            />
          </div>
          <button className="btn btn-secondary" disabled={busy === "name"} onClick={saveName}>
            {busy === "name" ? "Saving…" : "Save"}
          </button>
        </div>
        {notice && (
          <div
            className={`badge ${notice.kind === "ok" ? "badge-success" : notice.kind === "warn" ? "badge-warn" : "badge-danger"}`}
            style={{ marginTop: 12, display: "inline-flex" }}
          >
            {notice.text}
          </div>
        )}
      </div>

      {/* Provider health card */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">Provider health</h2>
        <div className="row-pad" style={{ gap: 8, alignItems: "baseline" }}>
          <span className="muted">Market data (Yahoo):</span>
          <span className={`badge ${p?.yahoo ? "badge-success" : "badge-muted"}`}>
            {p?.yahoo ? "ok" : "unavailable"}
          </span>
        </div>
        <div className="row-pad" style={{ gap: 8, alignItems: "baseline" }}>
          <span className="muted">LLM rotation ({p?.llmProviders?.join(", ") || "none"}):</span>
          <span className={`badge ${p?.llm ? "badge-success" : "badge-muted"}`}>
            {p?.llm ? "ok" : "unavailable"}
          </span>
        </div>
        <div className="row-pad" style={{ gap: 8, alignItems: "baseline" }}>
          <span className="muted">Serper research:</span>
          <SerperBadge serper={health?.serper} />
        </div>
        <div className="row-pad" style={{ gap: 8, alignItems: "baseline" }}>
          <span className="muted">BTCPay:</span>
          <span className={`badge ${p?.btcpay ? "badge-success" : "badge-danger"}`}>
            {p?.btcpay ? "reachable" : "unreachable"}
          </span>
        </div>
        <div className="row-pad" style={{ gap: 8, alignItems: "baseline" }}>
          <span className="muted">eWallet (TNG):</span>
          <span className={`badge ${p?.ewallet ? "badge-success" : "badge-muted"}`}>
            {p?.ewallet ? "ok" : "unavailable"}
          </span>
        </div>
        <div style={{ gap: 8, alignItems: "baseline" }}>
          <span className="muted">Agents crews:</span>
          <span className={`badge ${p?.agents ? "badge-success" : "badge-danger"}`}>
            {p?.agents ? "online" : "offline"}
          </span>
        </div>
      </div>

      {/* External links card */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">External links</h2>
        {profileError ? (
          <p className="muted">Profile unavailable.</p>
        ) : (
          LINKED_PROVIDERS.map((provider) => {
            const link = profile?.links[provider]
            return (
              <div key={provider} className="row" style={{ gap: 8, alignItems: "baseline" }}>
                <span className="muted">{provider}:</span>
                {link ? (
                  <span>
                    {link.username}
                    {link.linkedAt && (
                      <span className="muted small">
                        {" "}
                        linked {new Date(link.linkedAt).toLocaleDateString()}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="muted">not linked</span>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Sign out */}
      <button className="btn btn-danger" style={{ marginTop: 16 }} onClick={signOut}>
        Sign out
      </button>

      {/* PICC_FULL_SCOPE Part 2a — real finance tracker over /api/data/* */}
      <FinanceTracker />
    </div>
  )
}

/**
 * Serper health badge — observed verdict, never key presence. A set-but-rejected
 * key reads as rejected, an unprobed key as unverified, and an aged success as
 * stale (matching the Dashboard's SerperHealthRow).
 */
function SerperBadge({ serper }: { serper: HealthInfo["serper"] | undefined }) {
  if (!serper) {
    return <span className="badge badge-muted">unknown</span>
  }
  if (!serper.configured) return <span className="badge badge-muted">unavailable</span>
  const o = serper.observed
  if (!o) return <span className="badge badge-warn">configured · unverified</span>
  if (o.probe === "ok") {
    return (
      <span className={serper.stale ? "badge badge-warn" : "badge badge-success"}>
        {serper.stale ? "verified · stale" : "ok"}
      </span>
    )
  }
  const text = o.probe === "rejected" ? `rejected (${String(o.status)})` : "error"
  return <span className="badge badge-danger">{text}</span>
}
