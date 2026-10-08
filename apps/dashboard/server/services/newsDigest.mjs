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
//     governor routing (routeTask, PICC_GOV_T1_MAX_TOKENS ceiling); when
//     enabled the routed digest text is synthesized via the async chatText
//     tier call as advisory text only — a summary is NEVER invented and an
//     LLM failure stays an honest null with a named reason.
import { localStore } from "./localstore.mjs"
import { webFetch } from "./webfetch.mjs"
import { routeTask, defaultBudgets } from "./resourceGovernor.mjs"
// WS-7 T18 / D17 (spec :238-245): every item this digest emits now carries its
// source, its retrieval mode and the basis on which it is trusted. Before T18 an
// item was `{title, link, pubDate, source}` — `source` was the operator's feed
// label and nothing said HOW it was reached, so a datum obtained by scraping was
// indistinguishable from one obtained from a publisher's own feed. That is
// AC-038's "a datum may not appear without provenance".
import {
  NEWS_SOURCES_ABSENT_REASON,
  classifySourceUrl,
  makeDatum,
  newsSourceFamily,
  provenanceGap,
  resolveNewsSources
} from "./newsSources.mjs"

export const DIGEST_CADENCE_MS = 600_000 // envelope cadenceMs: 10min

/**
 * Curated free-source set, probe-verified 2026-09-13 (all returned HTTP 200 +
 * real RSS/Atom XML, no captcha gates, no key). Recorded in the spec S3 notes.
 * Re-extended 2026-09-15 from the free-sources research (docs are in the
 * research pass findings): Seeking Alpha market-currents and the Federal
 * Reserve press feed were re-probed live on 2026-09-15 (both HTTP 200 + real
 * RSS). Operators paste any subset into PICC_NEWS_FEEDS; the digest never
 * hardcodes these as configured (empty default = honest no-news-source-
 * configured skip).
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
  { id: "livemint-markets", url: "https://www.livemint.com/rss/markets" },
  { id: "seeking-alpha", url: "https://seekingalpha.com/market_currents.xml" },
  { id: "fed-press", url: "https://www.federalreserve.gov/feeds/press_all.xml" }
  // investing.com/rss/news_1.rss also probed 200 — excluded from the curated
  // set (heavier anti-bot posture); an operator may still add it.
  // Federal Reserve feeds/monetary_policy.xml listed in research 404s on
  // re-probe (2026-09-15) — never registered.
])

/**
 * The digest's own config: PICC_NEWS_FEEDS (comma-separated URLs). Only valid
 * http(s) URLs count as configured; garbage entries are dropped (never
 * counted). Empty → [] → the registry shows skipped-unconfigured honestly.
 *
 * Every returned feed is an INSTANCE of the declared `rss-atom` family, so it
 * carries that family's retrieval mode and licensed basis. The family is not
 * derived from the host: an operator naming a feed cannot mint a licence claim.
 *
 * A D17-prohibited target (Bloomberg, X, ForexFactory) is REFUSED here rather
 * than fetched, and the refusal is reported by `newsFeedRejections` instead of
 * being a silent drop. AC-039's runtime half.
 */
export function newsFeedsConfig(env = process.env) {
  return newsFeedEntries(env).feeds
}

/**
 * The feed config AND its refusals, in one pass, so the two cannot disagree.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {{feeds: Array<{id:string,url:string,family:string,retrievalMode:string}>,
 *            rejections: Array<{raw:string, reason:string}>, configured: boolean}}
 */
export function newsFeedEntries(env = process.env) {
  const feeds = []
  const rejections = []
  for (const raw of String(env.PICC_NEWS_FEEDS ?? "").split(",")) {
    const u = raw.trim()
    if (!u) continue
    let parsed
    try {
      parsed = new URL(u)
    } catch {
      rejections.push({ raw: u, reason: "not-an-absolute-url" })
      continue
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      rejections.push({ raw: u, reason: `scheme-${parsed.protocol.replace(":", "")}-is-not-http(s)` })
      continue
    }
    const classified = classifySourceUrl(parsed.toString())
    if (!classified.permitted) {
      // Named, not dropped. A prohibited ToS target the operator pasted is a
      // fact the operator needs to read, and AC-039 asks the guard to NAME it.
      rejections.push({
        raw: u,
        reason: `D17 prohibits scraping ${classified.prohibitedTarget}; this URL is refused and was not fetched`
      })
      continue
    }
    feeds.push({
      id: `${parsed.host}${parsed.pathname}`.replace(/\/+$/, ""),
      url: parsed.toString(),
      family: "rss-atom",
      retrievalMode: "licensed-feed"
    })
  }
  return { feeds, rejections, configured: feeds.length > 0 }
}

/** The named refusals from `PICC_NEWS_FEEDS`, for a room or a runbook. */
export function newsFeedRejections(env = process.env) {
  return newsFeedEntries(env).rejections
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

// ── WS-7 T18 / D17 — the DIGEST VERDICT, and the absent-vs-zero distinction ──

/**
 * The three digest states, on T14's vocabulary (`notifications/states.mjs:39-48`)
 * because the distinction is the same one:
 *
 *   absent       - no D17 source is configured. NOTHING WAS ASKED. There is no
 *                  observation to report and none is invented.
 *   unavailable  - sources are configured and a pass ran, and it produced no
 *                  item. That is a MEASURED zero and it is a fact about the
 *                  publishers, not about PICC.
 *   delivered    - at least one fully-provenanced datum came back.
 *
 * `delivered` is not a claim that the news is GOOD or that it is bullish. It is
 * a claim that PICC holds at least one datum whose provenance it can state.
 */
export const DIGEST_STATES = Object.freeze({
  ABSENT: "absent",
  UNAVAILABLE: "unavailable",
  DELIVERED: "delivered"
})

/**
 * Reduce a digest outcome to the state a room may render.
 *
 * `items: []` is deliberately NOT enough to reach `delivered`, and `items: []`
 * alone cannot decide between `absent` and `unavailable` — which is the entire
 * point. A pass that returned nothing from a configured, reachable feed is
 * `unavailable`; a pass over no sources at all is `absent`; and neither may be
 * reported as a sentiment of 0.
 *
 * @param {object|null} outcome A `runDigest` result, or null when none exists.
 * @param {Record<string,string|undefined>} [env]
 * @returns {{state: string, reason: string|null, items: number|null,
 *            sourcesConfigured: number, unprovenancedItems: number|null,
 *            retrievalModes: string[]}}
 */
export function digestVerdict(outcome = null, env = process.env) {
  const resolved = resolveNewsSources(env)
  const sourcesConfigured = resolved.configuredCount

  if (sourcesConfigured === 0) {
    return Object.freeze({
      state: DIGEST_STATES.ABSENT,
      reason: NEWS_SOURCES_ABSENT_REASON,
      // `null`, not 0. Nobody asked, so there is no count to report.
      items: null,
      sourcesConfigured: 0,
      unprovenancedItems: null,
      retrievalModes: []
    })
  }

  if (outcome === null || outcome === undefined) {
    return Object.freeze({
      state: DIGEST_STATES.UNAVAILABLE,
      reason: `${sourcesConfigured} D17 source${sourcesConfigured === 1 ? " is" : "s are"} configured but no digest pass has produced a readout yet`,
      items: null,
      sourcesConfigured,
      unprovenancedItems: null,
      retrievalModes: resolved.retrievalModes
    })
  }

  const items = Array.isArray(outcome.items) ? outcome.items : []
  return Object.freeze({
    state: items.length > 0 ? DIGEST_STATES.DELIVERED : DIGEST_STATES.UNAVAILABLE,
    reason:
      items.length > 0
        ? null
        : `${sourcesConfigured} D17 source${sourcesConfigured === 1 ? "" : "s"} configured and a pass ran, and ${(outcome.sources ?? []).length} source row(s) returned no item. This is a MEASURED zero about the publishers - not a neutral sentiment reading, and not an absence of sources.`,
    items: items.length,
    sourcesConfigured,
    unprovenancedItems: outcome.unprovenancedItems ?? null,
    retrievalModes: resolved.retrievalModes
  })
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
 * WS-7 T18 / D17: every emitted item is a `makeDatum` with
 * `{source, sourceFamily, retrievalMode, licensedBasis, retrievedAt, verified,
 * text, sourceUrl, publishedAt}`, and every source row carries the same
 * retrieval mode. An item that cannot be provenanced is NOT emitted — and the
 * count of refusals is reported, because silently dropping one would make the
 * digest look cleaner than the source is.
 *
 * @param {{feeds?:Array<{id:string, url:string, family?:string, retrievalMode?:string}>,
 *          fetcher?:Function,
 *          budget?:{maxPerSource?:number, windowMs?:number, maxItems?:number},
 *          now?:number}} [opts]
 * @returns {{at:string, sources:Array<object>, items:Array<object>,
 *            unprovenancedItems:number, absentReason:string|null}}
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
  let unprovenancedItems = 0

  for (const feed of list) {
    const feedId = feed.id ?? feed.url ?? "?"
    // An operator-supplied feed is an instance of a DECLARED family. An
    // undeclared family has no retrieval mode, so it cannot be fetched: the
    // source row says so rather than reaching the wire unlabelled.
    const family = feed.family ?? "rss-atom"
    const declared = newsSourceFamily(family)
    const base = {
      feed: feedId,
      url: feed.url ?? "",
      sourceFamily: family,
      retrievalMode: declared?.retrievalMode ?? feed.retrievalMode ?? null
    }
    if (declared === null) {
      sources.push({ ...base, status: "refused", ok: false, items: 0, reason: `"${family}" is not a declared D17 source family, so it has no retrieval mode and was not fetched` })
      continue
    }
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
      // AC-039's runtime half, at the point of emission rather than only at
      // config time: a feed whose body links into a prohibited host is refused
      // per item, because one aggregator can carry a prohibited link among
      // legitimate ones.
      const classified = classifySourceUrl(item.link)
      if (!classified.permitted) {
        unprovenancedItems += 1
        continue
      }
      let datum
      try {
        datum = makeDatum({
          sourceId: feedId,
          family,
          text: item.title.length > 0 ? item.title : item.link,
          retrievedAt: at,
          // `verified` is null, not true: nothing in this tree has verified a
          // publisher's licence, and T10's discipline says an unverified fact is
          // `boolean | null`, never a number.
          verified: null,
          sourceUrl: item.link.length > 0 ? item.link : null,
          publishedAt: item.pubDate.length > 0 ? item.pubDate : null
        })
      } catch (err) {
        unprovenancedItems += 1
        continue
      }
      if (provenanceGap(datum) !== null) {
        unprovenancedItems += 1
        continue
      }
      items.push({
        ...datum,
        // The pre-existing digest fields, kept so every current consumer keeps
        // working and so the two views of an item cannot drift.
        title: datum.text,
        link: item.link,
        pubDate: item.pubDate
      })
      added += 1
    }
    sources.push({ ...base, status: "ok", ok: true, items: added, reason: null })
  }

  return {
    at,
    sources,
    items,
    unprovenancedItems,
    // `items: []` with sources configured is a MEASURED zero ("the feed is live
    // and published nothing"); `items: []` with no source configured is an
    // ABSENCE. The two were the same value before T18, which is the whole of
    // AC-038's complaint.
    absentReason: list.length === 0 ? NEWS_SOURCES_ABSENT_REASON : null
  }
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
 * System prompt for digest synthesis. Advisory text only: the model
 * summarizes what the listed headlines state and never recommends trades,
 * positions, or any other action, and never invents items not listed.
 */
const SYNTHESIS_SYSTEM_PROMPT =
  "You are PICC, a decision-support assistant. Summarize the following market-news headlines " +
  "into a short advisory digest of at most 5 sentences. Describe only what the headlines state. " +
  "Never recommend trades, positions, or actions, and never invent headlines that are not listed."

/**
 * Optional T3 synthesis. OFF unless PICC_NEWS_DIGEST_SYNTHESIS=on; honors
 * governor routing (routeTask with the PICC_GOV_T1_MAX_TOKENS ceiling); never
 * invents a summary. When enabled and routed, the digest text is synthesized
 * via the LLM tier (chatText, governor-recorded) as advisory text only — it
 * summarizes what the headlines state and never recommends an action. An LLM
 * failure stays an honest null summary with a NAMED reason, never a
 * fabricated summary.
 *
 * `synthesize` is the hermetic seam (tests inject a double; production
 * lazy-imports chatText from llm.mjs so this module gains no load-time edge).
 *
 * @param {{items?:Array, enabled?:boolean, route?:Function, budgets?:object,
 *          synthesize?:Function|null}} [opts]
 * @returns {Promise<{summary:string|null, reason?:string, enabled:boolean,
 *            tier:string|null, escalated?:boolean}>}
 */
export async function digestSynthesis({ items = [], enabled = null, route = routeTask, budgets = defaultBudgets(), synthesize = null } = {}) {
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
  const runSynthesis =
    synthesize ??
    (async (system, text, opts) => {
      const { chatText } = await import("./llm.mjs")
      return chatText(system, text, opts)
    })
  const digestText = items
    .slice(0, 30)
    .map((item) => {
      const title = String(item?.title ?? item?.text ?? "").slice(0, 300)
      const link = String(item?.link ?? item?.sourceUrl ?? "")
      return `- ${title}${link ? ` (${link})` : ""}`
    })
    .join("\n")
    .slice(0, 6000)
  try {
    const summary = await runSynthesis(SYNTHESIS_SYSTEM_PROMPT, digestText, {
      maxTokens: budgets.t1MaxTokens,
      task: { taskKind: "synthesis" },
      governor: true
    })
    return { summary, enabled: true, tier: routed.tier, escalated: routed.escalated === true }
  } catch {
    return { summary: null, reason: "synthesis-llm-failed", enabled: true, tier: routed.tier, escalated: routed.escalated === true }
  }
}
