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

/**
 * The outcome of asking "is this token still good?".
 *
 * This is a discriminated union on purpose. The previous shape was
 * `LocalUser | null`, which cannot express the difference the whole fix turns
 * on — and `!undefined` is `true`, so a caller writing
 * `if (!user) setStoredSession(null)` compiled cleanly and was verbatim the
 * original bug. With a union keyed on `kind`, that mistake is a TYPE ERROR:
 * `result.user` does not exist on the `rejected` and `inconclusive` variants,
 * and forgetting to handle a variant is a compile error too.
 *
 * - `confirmed`     the server vouched for the token and returned the user
 * - `rejected`      the server AUTHORITATIVELY refused the token (401/403)
 * - `inconclusive`  we could not tell: network error, 5xx, 429, or a body that
 *                   did not parse. This says NOTHING about the token, so the
 *                   stored session must survive.
 */
export type SessionCheck =
  | { kind: "confirmed"; user: LocalUser }
  | { kind: "rejected" }
  | { kind: "inconclusive" }

/**
 * Whether a check result means the stored session must be destroyed.
 *
 * Named so the intent is legible at the call site — the dangerous line in this
 * module is the one that clears localStorage, and this makes "should I clear?"
 * an explicit, type-checked question instead of a truthiness test.
 */
export function shouldClearStoredSession(result: SessionCheck): boolean {
  return result.kind === "rejected"
}

/**
 * Validate the stored token server-side.
 *
 * Pure with respect to localStorage: it REPORTS and never mutates, so the
 * decision to destroy a session stays with the caller, in one place. The
 * original version cleared the session inside this function on any non-OK
 * response, which is how one unprovable answer could permanently sign a user
 * out — the WS-6 T10 terminal performance flake, where the app was left
 * rendering /login and `page.waitForSelector("[data-room='markets']")` burned
 * out its full 30s.
 */
export async function fetchMe(): Promise<SessionCheck> {
  const token = getToken()
  if (!token) return { kind: "rejected" }
  let res: Response
  try {
    res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    return { kind: "inconclusive" }
  }
  if (res.status === 401 || res.status === 403) return { kind: "rejected" }
  // 5xx / 429 / anything else: the token is unproven, not rejected.
  if (!res.ok) return { kind: "inconclusive" }
  const data = (await res.json().catch(() => null)) as { user?: LocalUser } | null
  // A 200 that carries no user is a malformed answer, not a rejection.
  return data?.user ? { kind: "confirmed", user: data.user } : { kind: "inconclusive" }
}

export async function getAuthStatus(): Promise<{ hasUsers: boolean }> {
  try {
    const data = (await authFetch("/auth/status", {}, "POST")) as { hasUsers?: boolean }
    return { hasUsers: Boolean(data.hasUsers) }
  } catch {
    return { hasUsers: true }
  }
}
