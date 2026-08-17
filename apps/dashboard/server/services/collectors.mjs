// PICC earnings collectors — real, free, self-hosted passive income data sources.
// Each collector talks to a provider's dashboard API using credentials the user owns
// (never shared). Errors are returned as { ok:false, error } so the UI can stay honest.
const DEFAULT_UA = "PICC/1.0 (self-hosted passive income dashboard)"

async function getJSON(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
  if (!res.ok) {
    let detail = ""
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {
      /* no body */
    }
    if (res.status === 401 || res.status === 403) throw new Error("credentials rejected (401/403)")
    if (res.status === 429) throw new Error("rate limited — try again later")
    throw new Error(`HTTP ${res.status}: ${detail || url}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------
// Honeygain — dashboard API with a bearer token (from your browser session).
//   1 credit = USD 0.001
// ---------------------------------------------------------------------
export async function fetchHoneygainSnapshot(token) {
  const base = "https://dashboard.honeygain.com/api/v1"
  const headers = { Authorization: `Bearer ${String(token).trim()}`, "User-Agent": DEFAULT_UA }

  const [balances, today, stats] = await Promise.allSettled([
    getJSON(`${base}/users/balances`, headers),
    getJSON(`${base}/earnings/today`, headers),
    getJSON(`${base}/earnings/stats`, headers)
  ])

  const b = balances.status === "fulfilled" ? balances.value : null
  const t = today.status === "fulfilled" ? today.value : null
  const s = stats.status === "fulfilled" ? stats.value : null

  if (!b && !t && !s) {
    throw new Error("Honeygain API unreachable or token rejected")
  }

  const creditsToUsd = (v) => (typeof v === "number" ? v / 1000 : 0)
  const balanceCredits =
    b?.balances?.credits ??
    b?.balances?.total ??
    (Array.isArray(b?.balances) ? b.balances.reduce((a, x) => a + (x?.credits ?? 0), 0) : 0)
  const thresholdCredits =
    b?.payout_threshold?.credits ??
    b?.payout_threshold?.total ??
    (Array.isArray(b?.payout_threshold) ? b.payout_threshold.reduce((a, x) => a + (x?.credits ?? 0), 0) : 20000)

  const todayCredits = t?.today?.credits ?? t?.today?.amount ?? t?.credits ?? 0
  const lifetimeCredits = s?.summary?.earnings?.credits ?? s?.summary?.total ?? balanceCredits

  // timeline: [{ date, traffic, credits }] or [{ date, value }]
  const timeline = Array.isArray(s?.timeline)
    ? s.timeline.map((d) => ({
        date: String(d.date ?? d.day ?? ""),
        usd: creditsToUsd(d.credits ?? d.earnings ?? d.value ?? 0)
      }))
    : []

  return {
    ok: true,
    platform: "Honeygain",
    currency: "USD",
    balance: creditsToUsd(balanceCredits),
    lifetimeEarnings: creditsToUsd(lifetimeCredits),
    todayEarnings: creditsToUsd(todayCredits),
    payoutThreshold: creditsToUsd(thresholdCredits),
    daily: timeline
  }
}

// ---------------------------------------------------------------------
// Pawns.app (IPRoyal) — dashboard API via email/password login, OR a
// session JWT pasted from the browser (Google sign-in accounts have no
// password). Unofficial endpoints (reverse-engineered from the web app).
// If IPRoyal changes them, the failure is honest: { ok:false, error }.
// Min payout $5.
// ---------------------------------------------------------------------
export async function fetchPawnsSnapshot(email, password, token = "") {
  const base = "https://api.pawns.app/api/v1"
  let session = String(token).trim()
  if (!session) {
    const loginRes = await fetch(`${base}/login/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": DEFAULT_UA },
      body: JSON.stringify({ email: String(email), password: String(password) }),
      signal: AbortSignal.timeout(20000)
    })
    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => null)
      const code = err?.error?.message ?? `HTTP ${loginRes.status}`
      throw new Error(
        `Pawns login failed (${code}) — accounts signed up with Google have no password; set one in your Pawns.app account settings (or via Forgot password) to use email login`
      )
    }
    const loginData = await loginRes.json().catch(() => ({}))
    session = loginData.auth_token ?? loginData.token ?? loginData.access_token
    if (!session) throw new Error("Pawns login returned no auth token")
  } else if (session.split(".").length !== 3) {
    throw new Error("Pawns session token is not a JWT — paste the full token from app.pawns.app browser storage")
  }

  const me = await getJSON(`${base}/users/me`, {
    Authorization: `Bearer ${session}`,
    "User-Agent": DEFAULT_UA
  })
  const bal = me?.balance ?? {}
  const available = Number(bal?.available ?? bal?.balance ?? 0)
  const pending = Number(bal?.pending ?? 0)
  const lifetime = Number(me?.total_earnings ?? me?.total_earned ?? me?.lifetime_earnings ?? 0) || available + pending

  return {
    ok: true,
    platform: "Pawns",
    currency: "USD",
    balance: available + pending,
    lifetimeEarnings: lifetime,
    todayEarnings: Number(me?.today_earnings ?? 0),
    payoutThreshold: 5,
    daily: [],
    devices: Array.isArray(me?.devices) ? me.devices.length : undefined
  }
}

// ---------------------------------------------------------------------
// Traffmonetizer — dashboard API authenticated with the session JWT.
// The dashboard's "Application Token" (base64) is for the CLI/SDK apps, NOT
// the web API. The web API needs the browser-session JWT:
//   app.traffmonetizer.com -> F12 -> Application -> Local Storage
//   -> https://app.traffmonetizer.com -> copy the `access_token` value
// Unofficial endpoint (mirrors the official web app, data.traffmonetizer.com
// /api/app_user/get_balance). Min payout $10.
// ---------------------------------------------------------------------
export async function fetchTraffmonetizerSnapshot(token) {
  const jwt = String(token).trim()
  if (jwt.split(".").length !== 3) {
    throw new Error(
      "Traffmonetizer token is not a JWT — copy the access_token value from app.traffmonetizer.com (F12 → Application → Local Storage)"
    )
  }

  const res = await fetch("https://data.traffmonetizer.com/api/app_user/get_balance", {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Origin: "https://app.traffmonetizer.com",
      Referer: "https://app.traffmonetizer.com/",
      "User-Agent": DEFAULT_UA
    },
    signal: AbortSignal.timeout(20000)
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error("Traffmonetizer token expired or invalid — refresh the access_token from Local Storage")
  }
  if (!res.ok) throw new Error(`Traffmonetizer balance failed (HTTP ${res.status})`)
  const data = await res.json().catch(() => ({}))
  const raw = data?.data?.balance
  if (raw == null) throw new Error("Traffmonetizer response missing balance — API may have changed")
  const balance = Number(raw)
  if (!Number.isFinite(balance)) throw new Error("Traffmonetizer response has a non-numeric balance — API may have changed")

  return {
    ok: true,
    platform: "Traffmonetizer",
    currency: "USD",
    balance,
    lifetimeEarnings: undefined,
    todayEarnings: undefined,
    payoutThreshold: 10,
    daily: []
  }
}

// ---------------------------------------------------------------------
// Repocket — dashboard API via Firebase email/password login, OR a
// session idToken pasted from the browser (Google sign-in accounts have
// no password). Unofficial endpoints (mirrors the official web app's
// auth). If Repocket changes them, the failure is honest: { ok:false,
// error }. VPS accepted at lower rates; max 5 devices/sessions per
// account. Min payout $10.
// ---------------------------------------------------------------------
const REPOCKET_FIREBASE_KEY = "AIzaSyBJf6hyw47O-5TrAwQszkwvDEh-Ri6q6SU"
const REPOCKET_FIREBASE_AUTH = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${REPOCKET_FIREBASE_KEY}`

export async function fetchRepocketSnapshot(email, password, token = "") {
  let idToken = String(token).trim()
  if (!idToken) {
    const loginRes = await fetch(REPOCKET_FIREBASE_AUTH, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": DEFAULT_UA },
      body: JSON.stringify({
        email: String(email),
        password: String(password),
        returnSecureToken: true
      }),
      signal: AbortSignal.timeout(20000)
    })
    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => null)
      const code = err?.error?.message ?? err?.message ?? `HTTP ${loginRes.status}`
      throw new Error(
        `Repocket login failed (${code}) — accounts signed up with Google have no password; use repocket.com "Forgot password" to set one, then save it here`
      )
    }
    const loginData = await loginRes.json().catch(() => ({}))
    idToken = loginData.idToken ?? loginData.id_token
    if (!idToken) throw new Error("Repocket login returned no auth token")
  } else if (idToken.split(".").length !== 3) {
    throw new Error("Repocket session token is not a JWT — paste the full idToken from app.repocket.co (DevTools → Network → any api.repocket.com request → Auth-Token header)")
  }

  const report = await getJSON("https://api.repocket.com/api/reports/current", {
    "Auth-Token": String(idToken),
    "User-Agent": DEFAULT_UA
  })
  const raw = report?.centsCredited ?? report?.balance
  if (raw == null) throw new Error("Repocket report missing centsCredited — API may have changed")
  const cents = Number(raw)
  if (!Number.isFinite(cents)) throw new Error("Repocket report has a non-numeric centsCredited — API may have changed")

  const balanceUsd = Math.round(cents) / 100
  return {
    ok: true,
    platform: "Repocket",
    currency: "USD",
    balance: balanceUsd,
    lifetimeEarnings: undefined,
    todayEarnings: undefined,
    payoutThreshold: 10,
    daily: []
  }
}

// ---------------------------------------------------------------------
// EarnApp — dashboard API via a cookie-based OAuth session (Bright Data).
// Unofficial endpoints (same flow the web app uses). The oauth-refresh-token
// cookie comes from the logged-in earnapp.com dashboard (Application →
// Cookies). Read-only balance fetch — PICC never claims/spends.
// IMPORTANT: EarnApp's ToS prohibits Docker containers, VMs, hosting services
// and home servers (account termination + cancelled payouts). Track it as a
// desktop-only stream; do NOT run it in the Pi provisioning.
// ---------------------------------------------------------------------
export async function fetchEarnAppSnapshot(oauthRefreshToken, brdSessId = "") {
  const base = "https://earnapp.com/dashboard/api"
  const apiParams = "appid=earnapp&version=1.627.783"
  const jar = [
    "auth=1",
    "auth-method=google",
    `oauth-refresh-token=${encodeURIComponent(String(oauthRefreshToken).trim())}`
  ]
  if (brdSessId) jar.push(`brd_sess_id=${encodeURIComponent(String(brdSessId).trim())}`)
  const baseCookie = jar.join("; ")

  // Step 1: rotate the XSRF token (the API sets it as a response cookie).
  const xsrfRes = await fetch(`${base}/sec/rotate_xsrf?${apiParams}`, {
    headers: { Cookie: baseCookie, "User-Agent": DEFAULT_UA },
    signal: AbortSignal.timeout(20000)
  })
  if (!xsrfRes.ok) throw new Error(`EarnApp session rejected (HTTP ${xsrfRes.status})`)
  const xsrf = extractCookie(xsrfRes, "xsrf-token")
  if (!xsrf) throw new Error("EarnApp returned no xsrf-token")

  // Step 2: fetch the balance.
  const moneyRes = await fetch(`${base}/money?${apiParams}`, {
    headers: {
      Cookie: `${baseCookie}; xsrf-token=${encodeURIComponent(xsrf)}`,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": DEFAULT_UA
    },
    signal: AbortSignal.timeout(20000)
  })
  if (moneyRes.status === 401 || moneyRes.status === 403) {
    throw new Error("EarnApp credentials rejected — refresh the OAuth token")
  }
  if (!moneyRes.ok) throw new Error(`EarnApp balance failed (HTTP ${moneyRes.status})`)
  const data = await moneyRes.json().catch(() => ({}))
  if (data?.error) throw new Error(`EarnApp: ${String(data.error).slice(0, 200)}`)

  const raw = data?.balance
  if (raw == null) throw new Error("EarnApp response missing balance — API may have changed")
  const balance = Number(raw)
  if (!Number.isFinite(balance)) throw new Error("EarnApp response has a non-numeric balance — API may have changed")

  return {
    ok: true,
    platform: "EarnApp",
    currency: "USD",
    balance,
    lifetimeEarnings: undefined,
    todayEarnings: undefined,
    payoutThreshold: 5,
    daily: []
  }
}

function extractCookie(res, name) {
  const all = typeof res?.headers?.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res?.headers?.get?.("set-cookie")].flat().filter(Boolean)
  for (const line of all) {
    for (const part of String(line).split(";")) {
      const [k, ...rest] = part.trim().split("=")
      if (k === name) return decodeURIComponent(rest.join("="))
    }
  }
  return ""
}

// ---------------------------------------------------------------------
// CashPilot — self-hosted aggregator REST API (admin key).
//   GET /api/earnings/summary  -> { total, today, month, change, ... }
//   GET /api/earnings/daily    -> [ { date, total } | { date, earnings } ]
//   GET /api/earnings/breakdown-> per-service
// ---------------------------------------------------------------------
function authHeaders(baseUrl, key) {
  const h = { "User-Agent": DEFAULT_UA }
  if (key) {
    h["X-API-Key"] = String(key)
    h["Authorization"] = `Bearer ${String(key)}`
  }
  return h
}

export async function fetchCashPilotSummary(baseUrl, key) {
  const url = new URL("/api/earnings/summary", baseUrl).toString()
  const data = await getJSON(url, authHeaders(baseUrl, key))
  return {
    total: data?.total ?? data?.lifetime ?? 0,
    today: data?.today ?? 0,
    month: data?.month ?? data?.monthly ?? 0,
    changePct: data?.change ?? data?.change_pct ?? null,
    raw: data
  }
}

export async function fetchCashPilotDaily(baseUrl, key, days = 30) {
  const url = new URL(`/api/earnings/daily?days=${days}`, baseUrl).toString()
  const data = await getJSON(url, authHeaders(baseUrl, key))
  const list = Array.isArray(data) ? data : Array.isArray(data?.daily) ? data.daily : Array.isArray(data?.series) ? data.series : []
  return list.map((d) => ({
    date: String(d?.date ?? d?.day ?? ""),
    usd: Number(d?.total ?? d?.earnings ?? d?.amount ?? 0)
  }))
}

export async function fetchCashPilotBreakdown(baseUrl, key) {
  const url = new URL("/api/earnings/breakdown", baseUrl).toString()
  const data = await getJSON(url, authHeaders(baseUrl, key))
  const list = Array.isArray(data) ? data : Array.isArray(data?.services) ? data.services : Array.isArray(data?.breakdown) ? data.breakdown : []
  return list.map((s) => ({
    service: String(s?.service ?? s?.name ?? s?.platform ?? "unknown"),
    balance: Number(s?.balance ?? s?.earnings ?? 0),
    threshold: Number(s?.threshold ?? s?.min_payout ?? s?.payout_threshold ?? 0),
    total: Number(s?.total ?? s?.lifetime ?? 0)
  }))
}
