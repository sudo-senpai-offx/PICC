import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { signOutLocal } from "@/lib/auth"
import { useUser } from "@/hooks/useAuth"
import {
  getHealth,
  getProfile,
  saveProfileName,
} from "@/lib/api"
import type { HealthInfo } from "@/lib/api"

type Notice = { kind: "ok" | "warn" | "err"; text: string } | null


export function Profile() {
  const user = useUser()
  const navigate = useNavigate()
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const refresh = () => {
    getProfile()
      .then((p) => setName(p.name))
      .catch(() => {})
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
      <p>
        Signed in as: <strong>{user?.email || "—"}</strong>
      </p>
      <p className="muted">Plan: Free — all features included, no subscriptions.</p>
      <p className="muted small">
        Account and credentials are stored locally on this machine (server/data). Nothing leaves your home.
      </p>

      {notice && (
        <div
          className={`badge ${notice.kind === "ok" ? "badge-success" : notice.kind === "warn" ? "badge-warn" : "badge-danger"}`}
          style={{ marginTop: 16, display: "inline-flex" }}
        >
          {notice.text}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Account settings</h2>
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
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Provider health</h2>
        <ul>
          <li>Market data (Yahoo): {p?.yahoo ? "ok" : "unavailable"}</li>
          <li>LLM rotation ({p?.llmProviders?.join(", ") || "none"}): {p?.llm ? "ok" : "unavailable"}</li>
          <li>Serper research: {p?.serper ? "ok" : "unavailable"}</li>
          <li>BTCPay: {p?.btcpay ? "reachable" : "unreachable"}</li>
          <li>eWallet (TNG): {p?.ewallet ? "ok" : "unavailable"}</li>
          <li>Agents crews: {p?.agents ? "online" : "offline"}</li>
        </ul>
      </div>

      <button style={{ marginTop: 16 }} onClick={signOut}>
        Sign out
      </button>
    </div>
  )
}
