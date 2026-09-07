// PICC earnings collectors — real, free, self-hosted passive income data sources.
// The bandwidth-suite removal left the CashPilot aggregator as the sole
// collector: it fans out to whatever self-hosted services the user actually
// runs. Errors are returned as { ok:false, error } so the UI can stay honest.
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
