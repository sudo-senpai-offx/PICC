// S3/T3.1 + T3.2 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: the news digest is the
// ONLY new engine in Pack 1. Owner decision (2026-09-13): Serper is REPLACED
// by free sources — RSS/Atom feeds from the digest's own config (PICC_NEWS_FEEDS,
// comma-separated; empty default → the honest skipped-unconfigured state) with
// a locally resettable shared rate limiter, fetched through the GLOBAL PICC
// webfetch capability (webfetch.mjs). Honesty floor (T3.1 AC):
//   - items are never fabricated: a feed that returns nothing records the
//     empty row honestly; parse failures and captcha/rate-limit gates are
//     recorded per source with their observed kind;
//   - the per-source fetch budget (≤6 per 10min — B5-strict, rpmCeiling 6)
//     is enforced before the wire; budget trips are recorded, not hidden;
//   - LLM synthesis is OPTIONAL (PICC_NEWS_DIGEST_SYNTHESIS=on) and honors
//     governor routing (routeTask, PICC_GOV_T1_MAX_TOKENS ceiling); the S3
//     completion call is a deliberate stub — routing is recorded, a summary is
//     NEVER invented.
import { localStore } from "./localstore.mjs"
import { webFetch } from "./webfetch.mjs"
import { routeTask, defaultBudgets } from "./resourceGovernor.mjs"

export const DIGEST_CADENCE_MS = 600_000 // envelope cadenceMs: 10min

/**
 * Curated free-source set, probe-verified 2026-09-13 (all returned HTTP 200 +
 * real RSS/Atom XML, no captcha gates, no key). Recorded in the spec S3 notes.
 * Operators paste any subset into PICC_NEWS_FEEDS; the digest never hardcodes
 * these as configured (empty default = honest no-news-source-configured skip).
 */
export const VERIFIED_FREE_FEEDS = Object.freeze([
  { id: "forexlive-news", url: "https://www.forexlive.com/feed/news" },
  { id: "cointelegraph", url: "https://cointelegraph.com/rss" },
  { id: "coindesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { id: "google-news-crypto", url: "https://news.google.com/rss/search?q=crypto&hl=en-US&gl=US&ceid=US:en" },
  { id: "yahoo-finance", url: "https://finance.yahoo.com/news/rssindex" },
  { id: "cryptoslate", url: "https://cryptoslate.com/feed/" },
  { id: "marketwatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { id: "ft-news", url: "https://www.ft.com/news-feed?format=rss" },
  { id: "livemint-markets", url: "https://www.livemint.com/rss/markets" }
  // investing.com/rss/news_1.rss also probed 200 — excluded from the curated
  // set (heavier anti-bot posture); an operator may still add it.
])

/**
 * The digest's own config: PICC_NEWS_FEEDS (comma-separated URLs). Only valid
 * http(s) URLs count as configured; garbage entries are dropped (never
 * counted). Empty → [] → the registry shows skipped-unconfigured honestly.
 */
export function newsFeedsConfig(env = process.env) {
  const feeds = []
  for (const raw of String(env.PICC_NEWS_FEEDS ?? "").split(",")) {
    const u = raw.trim()
    if (!u) continue
    try {
      const parsed = new URL(u)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue
      feeds.push({ id: `${parsed.host}${parsed.pathname}`.replace(/\/+$/, ""), url: parsed.toString() })
    } catch {
      /* invalid URL — not configured */
    }
  }
  return feeds
}

/**
 * The digest's run budget read from env. `maxItems` bounds the bounded digest
 * row (default 50, S3 design); an operator raises it via
 * PICC_NEWS_DIGEST_MAX_ITEMS (e.g. 200) so more healthy sources contribute
 * items per pass instead of the first two saturating the cap. Garbage values
 * fall back honestly to the default — never a fabricated cap.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {{maxPerSource:number, windowMs:number, maxItems:number}}
 */
export function digestBudgetFromEnv(env = process.env) {
  const raw = Number(env.PICC_NEWS_DIGEST_MAX_ITEMS)
  const maxItems = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50
  return { maxPerSource: 6, windowMs: 600_000, maxItems }
}

// ── Minimal dependency-free RSS 2.0 / Atom extractor ──────────────────────
// Regex-scoped on purpose (no XML parser dependency in this repo); enough for
// feed items: title, link, publication date. Deeper Atom namespaces (content,
// media) are ignored — the digest only needs headline-level truth.

function decodeXml(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d))
      } catch {
        return ""
      }
    })
    .replace(/\s+/g, " ")
    .trim()
}

function inner(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))
  return m ? m[1] : ""
}

function atomLink(block) {
  const alt = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]*)"/i)
  if (alt) return alt[1]
  const any = block.match(/<link[^>]*href="([^"]*)"/i)
  return any ? any[1] : ""
}

/**
 * Parse a feed body into headline items. Honest contract: ok:true with zero
 * items when the feed simply returned nothing; ok:false "not-xml" when the
 * body is not RSS/Atom at all (never a fabricated item list).
 *
 * @returns {{items:Array<{title:string, link:string, pubDate:string}>, ok:boolean, reason?:string}}
 */
export function parseFeedXml(xml = "") {
  const text = String(xml ?? "")
  const isRss = /<rss[\s>]/i.test(text.slice(0, 2000)) || /<rdf:RDF[\s>]/i.test(text.slice(0, 2000))
  const isAtom = /<feed[\s>]/i.test(text.slice(0, 2000))
  if (!isRss && !isAtom) return { items: [], ok: false, reason: "not-xml" }

  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi
  const items = []
  for (const m of text.matchAll(blockRe)) {
    const b = m[0]
    const title = decodeXml(inner(b, "title"))
    const link = isAtom ? atomLink(b) : decodeXml(inner(b, "link"))
    const pubDate = decodeXml(inner(b, "pubDate") || inner(b, "published") || inner(b, "updated") || inner(b, "dc:date"))
    if (!title && !link) continue // a malformed empty item is nothing
    items.push({ title, link, pubDate })
  }
  return { items, ok: true }
}

// ── Per-source fetch budget (≤6 per 10min — B5-strict, rpmCeiling 6) ──────
// Module state, resettable via resetDigestBudget() (mirrors the webfetch
// fair-use limiter). Enforcement happens BEFORE any fetch reaches the wire.
const sourceWindows = new Map() // feedId -> ts[]

export function resetDigestBudget() {
  sourceWindows.clear()
}

function sourceFetchCount(feedId, now, windowMs) {
  const cutoff = now - windowMs
  const hits = (sourceWindows.get(feedId) ?? []).filter((t) => t >= cutoff)
  sourceWindows.set(feedId, hits)
  return hits.length
}

/**
 * Run one digest pass over the configured feeds. Each source is fetched via
 * the global webfetch capability (honest outcomes) up to the per-source
 * budget; items are deduped by link across sources and bounded (maxItems).
 *
 * @param {{feeds?:Array<{id:string, url:string}>, fetcher?:Function,
 *          budget?:{maxPerSource?:number, windowMs?:number, maxItems?:number},
 *          now?:number}} [opts]
 * @returns {{at:string, sources:Array<{feed:string, url:string, status:string,
 *           ok:boolean, items:number, reason?:string|null}>,
 *           items:Array<{title:string, link:string, pubDate:string, source:string}>}}
 */
export async function runDigest({
  feeds = [],
  fetcher = webFetch,
  budget = { maxPerSource: 6, windowMs: 600_000, maxItems: 50 },
  now = Date.now()
} = {}) {
  const list = Array.isArray(feeds) ? feeds : []
  const caps = {
    maxPerSource: Number(budget.maxPerSource) > 0 ? Number(budget.maxPerSource) : 6,
    windowMs: Number(budget.windowMs) > 0 ? Number(budget.windowMs) : 600_000,
    maxItems: Number(budget.maxItems) > 0 ? Number(budget.maxItems) : 50
  }
  const at = new Date(now).toISOString()
  const sources = []
  const items = []
  const seen = new Set()

  for (const feed of list) {
    const feedId = feed.id ?? feed.url ?? "?"
    const base = { feed: feedId, url: feed.url ?? "" }
    if (sourceFetchCount(feedId, now, caps.windowMs) >= caps.maxPerSource) {
      sources.push({ ...base, status: "rate-limited-local-budget", ok: false, items: 0, reason: "per-source-fetch-budget" })
      continue
    }

    const hit = async () => {
      const r = await fetcher(feed.url, {})
      return r
    }
    let r
    try {
      r = await hit()
    } catch (err) {
      sources.push({ ...base, status: "error", ok: false, items: 0, reason: String(err?.message ?? err).slice(0, 200) })
      continue
    }

    sourceWindows.set(feedId, [...(sourceWindows.get(feedId) ?? []), now])

    if (!r.ok) {
      // Honest outcome from the webfetch layer: rate-limited / captcha-gated /
      // blocked / error — the source row records the observed kind exactly.
      sources.push({ ...base, status: r.kind, ok: false, items: 0, reason: r.reason ?? null })
      continue
    }

    const parsed = parseFeedXml(r.body)
    if (!parsed.ok) {
      sources.push({ ...base, status: "error", ok: true, items: 0, reason: parsed.reason })
      continue
    }

    let added = 0
    for (const item of parsed.items) {
      if (items.length >= caps.maxItems) break
      const link = item.link.toLowerCase()
      if (link && seen.has(link)) continue
      if (link) seen.add(link)
      items.push({ ...item, source: feedId })
      added += 1
    }
    sources.push({ ...base, status: "ok", ok: true, items: added, reason: null })
  }

  return { at, sources, items }
}

// ── T3.2 digest store + prune (registry evidence backing store) ───────────
const DIGEST_STORE = localStore("news_digest_store", { rows: [], lastRunAt: null, last: null })

function pruneStore(store, nowMs, maxRows) {
  const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000
  store.data.rows = store.data.rows
    .filter((row) => new Date(row.ts).getTime() >= cutoff)
    .slice(-maxRows)
}

/**
 * Persist a digest run (summary row — headline bodies live in the pack
 * registry evidence; this store keeps the run ledger bounded). Prunes to
 * PICC_NEWS_DIGEST_MAX_ROWS (default 200) and 30 days.
 */
export async function storeDigestRun(outcome = {}, { now, maxRows = null } = {}) {
  await DIGEST_STORE.ready
  const ts = now != null ? new Date(now).toISOString() : new Date().toISOString()
  const sources = Array.isArray(outcome.sources) ? outcome.sources : []
  const row = {
    ts,
    feeds: sources.length,
    fetchedOk: sources.filter((s) => s.ok).length,
    gated: sources.filter((s) => s.status === "captcha-gated").length,
    rateLimited: sources.filter((s) => s.status === "rate-limited" || s.status === "rate-limited-local-budget").length,
    items: Number(outcome.items?.length) || 0
  }
  DIGEST_STORE.data.rows.push(row)
  DIGEST_STORE.data.lastRunAt = ts
  DIGEST_STORE.data.last = row
  pruneStore(DIGEST_STORE, new Date(ts).getTime(), maxRows ? Number(maxRows) : digestMaxRows())
  await DIGEST_STORE.write()
  return row
}

/** The persisted digest state — what the observer reports between runs. */
export async function digestState({ store = DIGEST_STORE } = {}) {
  await store.ready
  return { lastRunAt: store.data.lastRunAt ?? null, last: store.data.last ?? null, rows: [...store.data.rows] }
}

/** Recent digest run rows, newest first (read surface for tests/ops). */
export async function recentDigestRows({ limit = 10, store = DIGEST_STORE } = {}) {
  await store.ready
  return [...store.data.rows].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, Math.max(1, Number(limit) || 10))
}

function digestMaxRows() {
  const n = Number(process.env.PICC_NEWS_DIGEST_MAX_ROWS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200
}

/**
 * Optional T3 synthesis routing. OFF unless PICC_NEWS_DIGEST_SYNTHESIS=on;
 * honors governor routing (routeTask with the PICC_GOV_T1_MAX_TOKENS ceiling);
 * never invents a summary. The S3 completion call is a deliberate stub —
 * the routING is recorded, the summary stays null (risk 6 guard).
 *
 * @param {{items?:Array, enabled?:boolean, route?:Function, budgets?:object}} [opts]
 * @returns {{summary:null, reason:string, enabled:boolean, tier:string|null, escalated?:boolean}}
 */
export function digestSynthesis({ items = [], enabled = null, route = routeTask, budgets = defaultBudgets() } = {}) {
  const isEnabled = enabled ?? process.env.PICC_NEWS_DIGEST_SYNTHESIS === "on"
  if (!Array.isArray(items) || items.length === 0) {
    return { summary: null, reason: "no-items", enabled: isEnabled, tier: null }
  }
  if (!isEnabled) {
    return { summary: null, reason: "synthesis-disabled", enabled: false, tier: null }
  }
  const routed = route({ taskKind: "synthesis", maxTokens: budgets.t1MaxTokens })
  if (routed.tier === "unavailable") {
    return { summary: null, reason: "tier-unavailable", enabled: true, tier: "unavailable" }
  }
  return { summary: null, reason: "synthesis-stub-not-wired", enabled: true, tier: routed.tier, escalated: routed.escalated === true }
}