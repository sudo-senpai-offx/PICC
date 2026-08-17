import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { signOutLocal } from "@/lib/auth"
import { useUser } from "@/hooks/useAuth"
import {
  getHealth,
  getProfile,
  saveProfileName,
  linkProfileAccount,
  unlinkProfileAccount,
  saveGithubOauth,
  beginGithubOauth,
  browserLogin,
  browserOpenSite,
  profileGoogleState
} from "@/lib/api"
import type { HealthInfo, ProfileInfo } from "@/lib/api"

type Notice = { kind: "ok" | "warn" | "err"; text: string } | null

type GoogleSessionState = { checked: boolean; available: boolean; loggedIn: boolean | null; account: string | null; method?: string; detail?: string | null }

export function Profile() {
  const user = useUser()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [name, setName] = useState("")
  const [googleUser, setGoogleUser] = useState("")
  const [googlePass, setGooglePass] = useState("")
  const [emailUser, setEmailUser] = useState("")
  const [emailPass, setEmailPass] = useState("")
  const [ghClientId, setGhClientId] = useState("")
  const [ghSecret, setGhSecret] = useState("")
  const [googleSession, setGoogleSession] = useState<GoogleSessionState>({ checked: false, available: false, loggedIn: null, account: null, method: undefined, detail: null })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const refresh = () => {
    getProfile()
      .then((p) => {
        setProfile(p)
        setName(p.name)
        setGhClientId(p.githubOauth?.clientId ?? "")
      })
      .catch(() => {})
  }

  // Reflect the LIVE Google session in the interactive browser: report whether
  // the browser is signed in (and as whom) and, when the account differs from
  // the stored link, rebind the linked account to the current session account.
  const syncGoogleState = async (opts?: { navigate?: boolean }) => {
    if (opts?.navigate) setBusy("google-sync")
    try {
      const r = await profileGoogleState(opts)
      setGoogleSession({ checked: true, available: r.available ?? false, loggedIn: r.loggedIn ?? null, account: r.account ?? null, method: r.method, detail: r.detail ?? null })
      if (r.boundAccount) {
        setNotice({ kind: "ok", text: `Google session is now bound to ${r.boundAccount} — linked account updated.` })
        refresh()
      } else if (opts?.navigate && r.available && r.loggedIn) {
        setNotice({ kind: "ok", text: r.account ? `Google session is signed in as ${r.account}.` : "The browser is signed in to Google — open accounts.google.com in the content window, then Sync again to resolve the account." })
        refresh()
      } else if (opts?.navigate && r.available) {
        setNotice({ kind: "warn", text: `No signed-in Google session detected in the browser window${r.detail ? ` (${r.detail})` : ""}.` })
      } else if (opts?.navigate && !r.available) {
        setNotice({ kind: "warn", text: r.error ? `Couldn't open the browser: ${r.error}.` : "Couldn't open the browser." })
      }
    } catch (err) {
      if (opts?.navigate) setNotice({ kind: "err", text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {})
    refresh()
    void syncGoogleState()
    if (searchParams.get("github") === "linked") {
      setNotice({ kind: "ok", text: "GitHub account linked." })
    } else if (searchParams.get("github") === "error") {
      setNotice({ kind: "err", text: "GitHub linking failed — check the browser window and try again." })
    }
  }, [])

  const p = health?.providers
  const links = profile?.links ?? {}

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

  const linkGoogle = async () => {
    setBusy("google")
    setNotice(null)
    try {
      const r = await linkProfileAccount("google", { username: googleUser, password: googlePass })
      setGoogleUser("")
      setGooglePass("")
      setNotice({ kind: "ok", text: `Google account linked as ${r.username}.` })
      refresh()
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const linkEmail = async () => {
    setBusy("email")
    setNotice(null)
    try {
      const r = await linkProfileAccount("email", { username: emailUser, password: emailPass })
      setEmailUser("")
      setEmailPass("")
      setNotice({ kind: "ok", text: `Email login linked as ${r.username}.` })
      refresh()
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const unlink = async (provider: string, label: string) => {
    if (!window.confirm(`Unlink your ${label} account from PICC?`)) return
    setBusy(`unlink-${provider}`)
    try {
      await unlinkProfileAccount(provider)
      setNotice({ kind: "ok", text: `${label} unlinked.` })
      refresh()
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const saveGhConfig = async () => {
    setBusy("gh-config")
    setNotice(null)
    try {
      const r = await saveGithubOauth(ghClientId, ghSecret || undefined)
      setGhSecret("")
      setNotice({ kind: "ok", text: r.hasSecret ? "GitHub OAuth configured." : "GitHub OAuth saved (secret kept from before)." })
      refresh()
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const linkGithub = async () => {
    setBusy("github")
    setNotice(null)
    const win = window.open("about:blank", "_blank", "noopener,width=980,height=720")
    try {
      const flow = await beginGithubOauth()
      if (win) {
        win.location.href = flow.authorizeUrl
        setNotice({ kind: "ok", text: "Authorize in the GitHub window, then you'll be returned here automatically." })
      } else {
        window.location.href = flow.authorizeUrl
      }
    } catch (err) {
      win?.close()
      setNotice({ kind: "err", text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const signInGoogle = async () => {
    setBusy("ghost")
    setNotice(null)
    try {
      await browserOpenSite({ site: "google", url: "https://accounts.google.com" })
      const r = await browserLogin("google")
      if (r.boundAccount) {
        setNotice({
          kind: "ok",
          text: `Google session is now bound to ${r.boundAccount} — the linked account was updated.`
        })
        refresh()
      } else if (r.loggedIn && r.account) {
        setNotice({
          kind: "ok",
          text: `Google session is already signed in as ${r.account}.`
        })
      } else if (r.ok && r.submitted) {
        setNotice({
          kind: "warn",
          text: "Google sign-in submitted — check the browser window to confirm and finish any 2FA."
        })
      } else {
        setNotice({
          kind: r.ok ? "warn" : "err",
          text: r.error ?? "Google sign-in could not start in the browser."
        })
      }
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const ghLinked = links.github

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
        <h2>Linked accounts</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Google and email sign-ins are stored in the browser's persistent profile vault so PICC can open and log into them for you.
          GitHub uses a real OAuth connection.
        </p>
        <div className="stack" style={{ marginTop: 12 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
            <div className="row-between">
              <div>
                <strong>Google</strong>
                <div className="muted small">Gmail account used for sign-ins</div>
              </div>
              {links.google ? (
                <div className="row">
                  <span className="badge badge-success">{links.google.username}</span>
                  <button className="btn btn-sm btn-secondary" disabled={busy === "ghost"} onClick={signInGoogle}>
                    {busy === "ghost" ? "Signing in…" : "Sign in in browser"}
                  </button>
                  <button className="btn btn-sm btn-secondary" disabled={busy === "google-sync"} onClick={() => void syncGoogleState({ navigate: true })}>
                    {busy === "google-sync" ? "Checking…" : "Sync Google session"}
                  </button>
                  <button className="btn btn-sm btn-danger" disabled={busy === "unlink-google"} onClick={() => unlink("google", "Google")}>
                    Unlink
                  </button>
                </div>
              ) : (
                <button className="btn btn-sm btn-secondary" disabled={busy === "unlink-google"} onClick={() => unlink("google", "Google")}>
                  Unlink
                </button>
              )}
            </div>
            {googleSession.checked && (
              <div className="muted small" style={{ marginTop: 10 }}>
                {googleSession.available
                  ? googleSession.loggedIn
                    ? googleSession.account
                      ? `Browser session: signed in as ${googleSession.account}`
                      : "Browser session: signed in to Google (account pending — Sync to resolve)"
                    : "Browser session: not signed in to Google"
                  : "Browser not open — open the content window, then Sync to update."}
              </div>
            )}
            {!links.google && (
              <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Gmail address</label>
                  <input className="input" value={googleUser} onChange={(e) => setGoogleUser(e.target.value)} placeholder="you@gmail.com" />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Password / app password</label>
                  <input className="input" type="password" value={googlePass} onChange={(e) => setGooglePass(e.target.value)} placeholder="••••••••" />
                </div>
                <button className="btn btn-primary" disabled={busy === "google" || !googleUser} onClick={linkGoogle}>
                  {busy === "google" ? "Linking…" : "Link Google"}
                </button>
              </div>
            )}
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
            <div className="row-between">
              <div>
                <strong>Email + password</strong>
                <div className="muted small">Any site you log into with a plain email/password</div>
              </div>
              {links.email && (
                <div className="row">
                  <span className="badge badge-success">{links.email.username}</span>
                  <button className="btn btn-sm btn-danger" disabled={busy === "unlink-email"} onClick={() => unlink("email", "email login")}>
                    Unlink
                  </button>
                </div>
              )}
            </div>
            {!links.email && (
              <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Email</label>
                  <input className="input" value={emailUser} onChange={(e) => setEmailUser(e.target.value)} placeholder="you@example.com" />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Password</label>
                  <input className="input" type="password" value={emailPass} onChange={(e) => setEmailPass(e.target.value)} placeholder="••••••••" />
                </div>
                <button className="btn btn-primary" disabled={busy === "email" || !emailUser} onClick={linkEmail}>
                  {busy === "email" ? "Linking…" : "Link email"}
                </button>
              </div>
            )}
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
            <div className="row-between">
              <div>
                <strong>GitHub</strong>
                <div className="muted small">
                  OAuth connection for GitHub automation. Create an OAuth app at{" "}
                  <a className="link" href="https://github.com/settings/developers" target="_blank" rel="noreferrer">
                    github.com/settings/developers
                  </a>{" "}
                  (callback URL: <code>{window.location.origin}/api/profile/github/callback</code>).
                </div>
              </div>
              {ghLinked && (
                <div className="row">
                  <span className="badge badge-success">@{ghLinked.username}</span>
                  <button className="btn btn-sm btn-danger" disabled={busy === "unlink-github"} onClick={() => unlink("github", "GitHub")}>
                    Unlink
                  </button>
                </div>
              )}
            </div>
            <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="field-label">GitHub Client ID</label>
                <input className="input" value={ghClientId} onChange={(e) => setGhClientId(e.target.value)} placeholder="Iv23…" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field-label">Client secret {profile?.githubOauth?.hasSecret ? "(saved)" : ""}</label>
                <input className="input" type="password" value={ghSecret} onChange={(e) => setGhSecret(e.target.value)} placeholder={profile?.githubOauth?.hasSecret ? "•••••••• (leave blank to keep)" : "GitHub client secret"} />
              </div>
              <button className="btn btn-sm btn-secondary" disabled={busy === "gh-config"} onClick={saveGhConfig}>
                {busy === "gh-config" ? "Saving…" : "Save config"}
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy === "github" || !profile?.githubOauth?.hasSecret} onClick={linkGithub}>
                {busy === "github" ? "Opening GitHub…" : ghLinked ? "Reconnect GitHub" : "Link GitHub"}
              </button>
            </div>
          </div>
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
