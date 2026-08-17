// Serper.dev real-time Google Search + News API.
// Requires SERPER_API_KEY. Returns trimmed result items for research context.
import { env } from "../config.mjs"

const SEARCH_URL = "https://google.serper.dev/search"
const NEWS_URL = "https://google.serper.dev/news"
const SHOPPING_URL = "https://google.serper.dev/shopping"

async function call(url, query, num = 5) {
  if (!env.serperApiKey) return null
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": env.serperApiKey
    },
    body: JSON.stringify({ q: query, num }),
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) throw new Error(`Serper ${res.status}`)
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
