// Serper.dev real-time Google Search + News API.
// Requires SERPER_API_KEY. Returns trimmed result items for research context.
import { env } from "../config.mjs"

const SEARCH_URL = "https://google.serper.dev/search"
const NEWS_URL = "https://google.serper.dev/news"
const SHOPPING_URL = "https://google.serper.dev/shopping"

// Serper.dev rejection statuses that point at the API key itself rather than the
// query. 400 is what Serper returns for a missing/invalid/expired X-API-KEY on a
// POST. 401/403 are auth/plan problems; 429 is a plan quota/rate limit.
const KEY_OR_QUOTA_STATUSES = new Set([400, 401, 403, 429])

// ── Observed-health verdict ────────────────────────────────────────────────
// Key presence (providers().serper) says nothing about whether Serper actually
// accepted the key. Every real HTTP outcome is cached here so /api/health and
// the status badges can report what was OBSERVED, not what is configured.
// A verdict is only "fresh" for VERDICT_FRESH_MS — an old success must not read
// as currently-verified.
const VERDICT_FRESH_MS = 10 * 60 * 1000
let lastObserved = null // { probe: "ok"|"rejected"|"error", status, message, at }

/**
 * The last observed Serper outcome.
 *   configured: true when a key exists (env check — never a guess about health)
 *   observed:   null until the first real call resolves (honest "unverified"):
 *               then { probe, status, message, at }
 *   stale:      true when the last probe is old enough that "verified" no longer
 *               holds; the badge must downgrade, not keep claiming ok.
 */
export function serperVerdict({ now = Date.now() } = {}) {
  const configured = Boolean(env.serperApiKey)
  if (!configured) return { configured: false, observed: null, ageMs: null, stale: false }
  if (!lastObserved) return { configured: true, observed: null, ageMs: null, stale: false }
  const ageMs = Math.max(0, now - lastObserved.at)
  return {
    configured: true,
    observed: lastObserved,
    ageMs,
    stale: ageMs > VERDICT_FRESH_MS
  }
}

/** Test hook — hermetically clears the observed verdict. */
export function _resetSerperVerdict() {
  lastObserved = null
}

function recordVerdict(probe, status, message) {
  lastObserved = { probe, status, message, at: Date.now() }
}

async function call(url, query, num = 5) {
  if (!env.serperApiKey) return null
  let res
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": env.serperApiKey
      },
      body: JSON.stringify({ q: query, num }),
      signal: AbortSignal.timeout(15000)
    })
  } catch (err) {
    // Network/timeout — the key may be fine; record the transport failure
    // honestly and rethrow so callers surface the real error.
    recordVerdict("error", null, String(err?.message ?? err))
    throw err
  }
  if (!res.ok) {
    // Attribute the failure to the credential/plan BEFORE blaming the query.
    // A 400/401/403/429 on Serper means the X-API-KEY is missing, invalid,
    // expired, out of quota, or above the plan's rate limit — an external
    // account issue that cannot be fixed in code. Surface the endpoint + status
    // + hint so the operator knows to check SERPER_API_KEY, not the request.
    const endpoint = new URL(url).pathname.split("/").pop()
    let detail = ""
    try {
      const body = await res.json().catch(() => null)
      detail = (body?.message ?? body?.error ?? "") ? ` — ${body?.message ?? body?.error}` : ""
    } catch {
      /* non-JSON body; leave detail empty */
    }
    const hint = KEY_OR_QUOTA_STATUSES.has(res.status)
      ? " (check SERPER_API_KEY: missing/invalid/expired key, out of quota, or rate-limited)"
      : ""
    recordVerdict(KEY_OR_QUOTA_STATUSES.has(res.status) ? "rejected" : "error", res.status, detail.replace(/^ — /, ""))
    throw new Error(`Serper ${endpoint} ${res.status}${detail}${hint}`)
  }
  recordVerdict("ok", res.status, "")
  const json = await res.json()
  return json
}

function trimItems(items = [], max = 5) {
  return items
    .filter((i) => i?.title && i?.link)
    .slice(0, max)
    .map((i) => ({
      title: i.title,
      link: i.link,
      snippet: (i.snippet ?? i.description ?? "").slice(0, 300),
      source: i.source ?? "",
      date: i.date ?? ""
    }))
}

/** Google News results for a query. Returns [] when unconfigured. */
export async function news(query, num = 5) {
  const json = await call(NEWS_URL, query, num)
  if (!json) return []
  return trimItems(json.news, num)
}

const PRICE_RE = /(?:US\$|RM|S\$|€|£|\$)\s?\d{1,3}(?:[.,]\d{2})?/i

function extractPrice(...fields) {
  for (const f of fields) {
    if (typeof f !== "string") continue
    const m = f.match(PRICE_RE)
    if (m) return m[0].replace(/\s/g, "")
  }
  return ""
}

/**
 * Product-style search for competitor intel. Prefers Google Shopping results
 * (real products with prices), falling back to organic hits when shopping has
 * nothing. Returns [] when Serper is not configured. This is Google's live view
 * of the public web — a free, card-free alternative to Amazon's own (paid) APIs.
 */
export async function productSearch(query, num = 10) {
  if (!env.serperApiKey) return []
  const out = []
  const seen = new Set()
  const push = (i) => {
    if (!i?.title || !i?.link || seen.has(i.link)) return
    seen.add(i.link)
    out.push({
      title: i.title.slice(0, 200),
      link: i.link,
      snippet: (i.snippet ?? "").slice(0, 220),
      price: i.price ?? extractPrice(i.snippet ?? "", i.title),
      image: i.imageUrl ?? i.image ?? "",
      source: i.source ?? ""
    })
  }

  // 1) Google Shopping — real products with prices (Amazon + other retailers).
  try {
    const shopping = await call(SHOPPING_URL, query, num)
    for (const s of shopping?.shopping ?? []) push(s)
    if (out.length >= 3) return out.slice(0, num)
  } catch (err) {
    console.warn("[picc] serper shopping failed, using web search:", err.message)
  }

  // 2) Fallback: organic web results (Amazon product/category pages).
  const web = await call(SEARCH_URL, query, num)
  for (const o of web?.organic ?? []) push(o)
  return out.slice(0, num)
}

/**
 * Run a small research batch: one news query + one web query around a topic.
 * Returns context for prompts, or [] when Serper is not configured.
 */
export async function researchTopic(topic, extra = "") {
  if (!env.serperApiKey) return []
  const queries = [topic, `${topic} ${extra}`.trim()].filter(Boolean)
  const results = await Promise.all(queries.map(async (q) => news(q, 3)))
  return results.flat()
}
