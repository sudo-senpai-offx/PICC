// Local auth client — sessions are stored in localStorage and validated
// against the self-hosted server. No external identity provider.

export interface LocalUser {
  id: string
  email: string
  name: string
  createdAt?: string
}

export interface LocalSession {
  access_token: string
  user: LocalUser
}

const AUTH_KEY = "picc.auth"

export function getStoredSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as LocalSession
    return s?.access_token ? s : null
  } catch {
    return null
  }
}

export function setStoredSession(s: LocalSession | null): void {
  try {
    if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s))
    else localStorage.removeItem(AUTH_KEY)
  } catch {
    /* storage unavailable */
  }
}

export function getToken(): string | null {
  return getStoredSession()?.access_token ?? null
}

interface AuthResult {
  ok: boolean
  token: string
  user: LocalUser
}

async function authFetch<T = AuthResult>(path: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`)
  return data as T
}

export async function signUpLocal(email: string, password: string, name = ""): Promise<LocalSession> {
  const { token, user } = await authFetch("/auth/signup", { email, password, name })
  const session: LocalSession = { access_token: token, user }
  setStoredSession(session)
  return session
}

export async function signInLocal(email: string, password: string): Promise<LocalSession> {
  const { token, user } = await authFetch("/auth/login", { email, password })
  const session: LocalSession = { access_token: token, user }
  setStoredSession(session)
  return session
}

export async function signOutLocal(): Promise<void> {
  const token = getToken()
  setStoredSession(null)
  if (token) {
    fetch("/api/auth/signout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}"
    }).catch(() => undefined)
  }
}

/** Validate the stored token server-side; clears it when expired/invalid. */
export async function fetchMe(): Promise<LocalUser | null> {
  const token = getToken()
  if (!token) return null
  const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    setStoredSession(null)
    return null
  }
  const data = (await res.json().catch(() => null)) as { user?: LocalUser } | null
  return data?.user ?? null
}

export async function getAuthStatus(): Promise<{ hasUsers: boolean }> {
  try {
    const data = (await authFetch("/auth/status", {}, "POST")) as { hasUsers?: boolean }
    return { hasUsers: Boolean(data.hasUsers) }
  } catch {
    return { hasUsers: true }
  }
}
