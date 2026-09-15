// S3/T3.1 + T3.2 — news digest engine tests. Honesty floor under test:
// no fabricated items, per-source fetch budget enforced BEFORE the wire,
// captcha/rate-limit/error outcomes recorded as observed, synthesis routing
// honors the governor and NEVER invents a summary.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tmp = mkdtempSync(join(tmpdir(), "picc-news-digest-"))
process.env.PICC_DATA_DIR = tmp

let digest

beforeAll(async () => {
  digest = await import("../services/newsDigest.mjs")
})

afterAll(() => {
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>FX News</title>
<item>
  <title><![CDATA[EUR/USD rallies on dovish ECB &amp; swap news]]></title>
  <link>https://www.forexlive.com/news/eur-usd-rallies</link>
  <pubDate>Mon, 02 Jun 2025 10:00:00 GMT</pubDate>
</item>
<item>
  <title>Gold hits a new high</title>
  <link>https://www.forexlive.com/news/gold-high</link>
  <pubDate>Tue, 03 Jun 2025 11:00:00 GMT</pubDate>
</item>
</channel></rss>`

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Example Co</title>
<entry>
  <title>Atom entry title &amp; more</title>
  <link rel="alternate" href="https://example.com/a"/>
  <link rel="self" href="https://example.com/feed"/>
  <updated>2025-06-01T09:30:00Z</updated>
</entry>
</feed>`

const okFetch = (body, host = "x.test") => async () => ({
  ok: true, kind: "ok", status: 200, host, reason: null,
  headers: { "content-type": "application/rss+xml" }, contentType: "application/rss+xml", body
})

describe("newsFeedsConfig — PICC_NEWS_FEEDS, empty default is the honest skip", () => {
  it("empty/unset env → no feeds configured (never zero-filled)", () => {
    vi.stubEnv("PICC_NEWS_FEEDS", "")
    expect(digest.newsFeedsConfig()).toEqual([])
    vi.stubEnv("PICC_NEWS_FEEDS", " , , ")
    expect(digest.newsFeedsConfig()).toEqual([])
  })

  it("valid http(s) URLs configure with a host+path feed id", () => {
    vi.stubEnv("PICC_NEWS_FEEDS", "https://www.forexlive.com/feed/news, https://cointelegraph.com/rss")
    const feeds = digest.newsFeedsConfig()
    expect(feeds).toHaveLength(2)
    expect(feeds[0]).toEqual({ id: "www.forexlive.com/feed/news", url: "https://www.forexlive.com/feed/news" })
  })

  it("garbage and non-http entries are dropped, never counted as configured", () => {
    vi.stubEnv("PICC_NEWS_FEEDS", "ftp://nope/x,not-a-url,mailto:x@y.z,https://ok.test/feed")
    const feeds = digest.newsFeedsConfig()
    expect(feeds).toHaveLength(1)
    expect(feeds[0].url).toBe("https://ok.test/feed")
  })
})

describe("VERIFIED_FREE_FEEDS — curated sources shape (originally probe-verified 200+RSS)", () => {
  it("each entry is a plausible http(s) feed URL with an id", () => {
    for (const f of digest.VERIFIED_FREE_FEEDS) {
      const u = new URL(f.url)
      expect(["http:", "https:"]).toContain(u.protocol)
      expect(typeof f.id).toBe("string")
      expect(f.id.length).toBeGreaterThan(0)
    }
  })
})

describe("parseFeedXml — dependency-free RSS 2.0 + Atom, honest on failures", () => {
  it("extracts RSS items, unwraps CDATA and decodes entities", () => {
    const { items, ok } = digest.parseFeedXml(RSS_FIXTURE)
    expect(ok).toBe(true)
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe("EUR/USD rallies on dovish ECB & swap news")
    expect(items[0].link).toBe("https://www.forexlive.com/news/eur-usd-rallies")
    expect(items[0].pubDate).toContain("2025")
    expect(items[1].title).toBe("Gold hits a new high")
  })

  it("extracts Atom entries, preferring the rel=alternate link", () => {
    const { items, ok } = digest.parseFeedXml(ATOM_FIXTURE)
    expect(ok).toBe(true)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("Atom entry title & more")
    expect(items[0].link).toBe("https://example.com/a")
    expect(items[0].pubDate).toBe("2025-06-01T09:30:00Z")
  })

  it("a valid feed that returns zero items is ok:true with zero items (not a lie)", () => {
    const { items, ok } = digest.parseFeedXml('<rss version="2.0"><channel><title>Empty</title></channel></rss>')
    expect(ok).toBe(true)
    expect(items).toEqual([])
  })

  it("a non-feed body is not-xml (never a fabricated item list)", () => {
    const r = digest.parseFeedXml("<html><body>checking your browser</body></html>")
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("not-xml")
    expect(r.items).toEqual([])
  })

  it("malformed items (no title, no link) are nothing and are skipped", () => {
    const xml = '<rss version="2.0"><channel><item><description>no headline</description></item><item><title>OK</title><link>https://x.test/ok</link></item></channel></rss>'
    const { items } = digest.parseFeedXml(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("OK")
  })
})

describe("runDigest — honest per-source outcomes + per-source budget ≤6/10min", () => {
  it("zero configured feeds → empty pass (skipped-unconfigured shape)", async () => {
    const r = await digest.runDigest({ feeds: [], fetcher: okFetch(RSS_FIXTURE), now: 1_700_000_000_000 })
    expect(r.sources).toEqual([])
    expect(r.items).toEqual([])
    expect(typeof r.at).toBe("string")
  })

  it("ok feed → source-row ok, items extracted, exactly one fetch", async () => {
    const fetcher = vi.fn(okFetch(RSS_FIXTURE))
    const r = await digest.runDigest({ feeds: [{ id: "fx-news", url: "https://x.test/feed" }], fetcher, now: 1_700_000_000_000 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(r.sources[0]).toMatchObject({ feed: "fx-news", status: "ok", ok: true, items: 2, reason: null })
    expect(r.items).toHaveLength(2)
  })

  it("upstream rate-limited → source-row rate-limited with the observed reason", async () => {
    const fetcher = async () => ({ ok: false, kind: "rate-limited", status: 429, host: "x.test", reason: "upstream-429", headers: {}, contentType: null, body: "" })
    const r = await digest.runDigest({ feeds: [{ id: "fx-news", url: "https://x.test/feed" }], fetcher, now: 1_700_000_000_000 })
    expect(r.sources[0]).toMatchObject({ status: "rate-limited", ok: false, items: 0 })
    expect(r.sources[0].reason).toBe("upstream-429")
    expect(r.items).toEqual([])
  })

  it("captcha-gated → source-row captcha-gated with observed kind", async () => {
    const fetcher = async () => ({ ok: false, kind: "captcha-gated", status: 403, host: "x.test", reason: "cloudflare-challenge", headers: {}, contentType: null, body: "" })
    const r = await digest.runDigest({ feeds: [{ id: "fx-news", url: "https://x.test/feed" }], fetcher, now: 1_700_000_000_000 })
    expect(r.sources[0]).toMatchObject({ status: "captcha-gated", ok: false })
  })

  it("transport failure → source-row error (no fabrication)", async () => {
    const fetcher = async () => { throw new Error("ECONNRESET") }
    const r = await digest.runDigest({ feeds: [{ id: "fx-news", url: "https://x.test/feed" }], fetcher, now: 1_700_000_000_000 })
    expect(r.sources[0].status).toBe("error")
    expect(r.sources[0].reason).toContain("ECONNRESET")
  })

  it("non-feed body from an ok fetch → error not-xml", async () => {
    const fetcher = okFetch("<html>not a feed</html>")
    const r = await digest.runDigest({ feeds: [{ id: "fx-news", url: "https://x.test/feed" }], fetcher, now: 1_700_000_000_000 })
    expect(r.sources[0]).toMatchObject({ status: "error", items: 0, reason: "not-xml" })
  })

  it("per-source budget trips BEFORE the wire (fetcher never called), resettable", async () => {
    const fetcher = vi.fn(okFetch(RSS_FIXTURE))
    const feeds = Array.from({ length: 8 }, (_, i) => ({ id: "same-source", url: `https://x.test/${i}` }))
    const r1 = await digest.runDigest({
      feeds,
      fetcher,
      budget: { maxPerSource: 6, windowMs: 600_000, maxItems: 50 },
      now: 1_700_000_000_000
    })
    expect(fetcher).toHaveBeenCalledTimes(6)
    const statuses = r1.sources.map((s) => s.status)
    expect(statuses.filter((s) => s === "ok")).toHaveLength(6)
    expect(statuses.filter((s) => s === "rate-limited-local-budget")).toHaveLength(2)
    // the budget honestly resets
    digest.resetDigestBudget()
    const fetcher2 = vi.fn(okFetch(RSS_FIXTURE))
    const r2 = await digest.runDigest({ feeds: feeds.slice(0, 1), fetcher: fetcher2, now: 1_700_000_000_010 })
    expect(fetcher2).toHaveBeenCalledTimes(1)
    expect(r2.sources[0].status).toBe("ok")
  })

  it("the sliding window honestly expires (≤6 per 10min, then allowed again)", async () => {
    const fetcher = vi.fn(okFetch(RSS_FIXTURE))
    const one = [{ id: "s", url: "https://x.test/s" }]
    await digest.runDigest({ feeds: one, fetcher, now: 1_000 }) // 1 fetch
    await digest.runDigest({ feeds: one, fetcher, now: 1_000 + 100_000 }) // 2
    // ...five more within the window → 6 total, supply 6 more runs at distinct nows:
    for (const t of [200_001, 300_002, 400_003, 500_004]) {
      await digest.runDigest({ feeds: one, fetcher, now: 1_000 + t })
    }
    expect(fetcher).toHaveBeenCalledTimes(6)
    const gate = await digest.runDigest({ feeds: one, fetcher, now: 1_000 + 590_000 })
    expect(gate.sources[0].status).toBe("rate-limited-local-budget")
    expect(fetcher).toHaveBeenCalledTimes(6) // wire never hit again inside the window
    const after = await digest.runDigest({ feeds: one, fetcher, now: 1_000 + 600_001 })
    expect(after.sources[0].status).toBe("ok")
    expect(fetcher).toHaveBeenCalledTimes(7) // window slid → allowed again
  })

  it("dedupes identical links across sources; maxItems bounds the headline set", async () => {
    const shared = '<rss version="2.0"><channel><item><title>Same</title><link>https://x.test/same</link></item></channel></rss>'
    const fetcher = vi.fn(okFetch(shared))
    const r = await digest.runDigest({
      feeds: [{ id: "a", url: "https://x.test/a" }, { id: "b", url: "https://x.test/b" }],
      fetcher,
      budget: { maxPerSource: 6, maxItems: 50 },
      now: 1_700_000_000_000
    })
    expect(r.sources).toHaveLength(2)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].source).toBe("a")

    const many = `<rss version="2.0"><channel>${Array.from({ length: 60 }, (_, i) => `<item><title>H${i}</title><link>https://x.test/${i}</link></item>`).join("")}</channel></rss>`
    const fetcher2 = vi.fn(okFetch(many))
    const r2 = await digest.runDigest({ feeds: [{ id: "big", url: "https://x.test/big" }], fetcher: fetcher2, budget: { maxPerSource: 6, maxItems: 3 }, now: 1_700_000_000_000 })
    expect(r2.items).toHaveLength(3)
    expect(r2.sources[0].items).toBe(3)
  })
})

describe("digestBudgetFromEnv — PICC_NEWS_DIGEST_MAX_ITEMS raises the bounded item cap", () => {
  it("unset env → S3 default 50 (bounded-row design preserved)", () => {
    expect(digest.digestBudgetFromEnv({})).toEqual({ maxPerSource: 6, windowMs: 600_000, maxItems: 50 })
    expect(digest.digestBudgetFromEnv({ PICC_NEWS_DIGEST_MAX_ITEMS: "" })).toMatchObject({ maxItems: 50 })
  })

  it("PICC_NEWS_DIGEST_MAX_ITEMS=200 → cap raised to 200", () => {
    expect(digest.digestBudgetFromEnv({ PICC_NEWS_DIGEST_MAX_ITEMS: "200" })).toMatchObject({ maxItems: 200 })
  })

  it("garbage values fall back honestly to the default, never a fabricated cap", () => {
    expect(digest.digestBudgetFromEnv({ PICC_NEWS_DIGEST_MAX_ITEMS: "lots" })).toMatchObject({ maxItems: 50 })
    expect(digest.digestBudgetFromEnv({ PICC_NEWS_DIGEST_MAX_ITEMS: "-3" })).toMatchObject({ maxItems: 50 })
  })

  it("env-derived raised cap lets all healthy sources contribute (default 50 saturates one source)", async () => {
    const feedN = (seed) =>
      `<rss version="2.0"><channel>${Array.from({ length: 60 }, (_, i) => `<item><title>H${seed}-${i}</title><link>https://x.test/${seed}/${i}</link></item>`).join("")}</channel></rss>`
    const bodies = { a: feedN("a"), b: feedN("b"), c: feedN("c") }
    const feeds = [{ id: "a", url: "https://x.test/a" }, { id: "b", url: "https://x.test/b" }, { id: "c", url: "https://x.test/c" }]
    const fetcher = async (url) => okFetch(bodies[url.slice(-1)])(url)

    const capped = await digest.runDigest({ feeds, fetcher, budget: { maxPerSource: 6, windowMs: 600_000, maxItems: 50 }, now: 1_700_000_000_000 })
    expect(capped.items).toHaveLength(50) // first source saturates the default cap
    expect(capped.sources.map((s) => s.items)).toEqual([50, 0, 0])

    const raised = await digest.runDigest({ feeds, fetcher, budget: digest.digestBudgetFromEnv({ PICC_NEWS_DIGEST_MAX_ITEMS: "200" }), now: 1_700_000_000_010 })
    expect(raised.items).toHaveLength(180) // all three healthy sources contribute
    expect(raised.sources.map((s) => s.items)).toEqual([60, 60, 60])
  })
})

describe("digest store — run ledger, bounded + observable", () => {
  it("storeDigestRun writes a summary row; digestState reflects the last run", async () => {
    const row = await digest.storeDigestRun({
      sources: [
        { feed: "a", url: "u", status: "ok", ok: true, items: 2, reason: null },
        { feed: "b", url: "u", status: "captcha-gated", ok: false, items: 0, reason: "cloudflare-challenge" }
      ],
      items: [{ title: "x", link: "l", pubDate: "d", source: "a" }]
    })
    expect(row).toMatchObject({ feeds: 2, fetchedOk: 1, gated: 1, rateLimited: 0, items: 1 })
    const state = await digest.digestState()
    expect(state.last).toMatchObject({ feeds: 2, gated: 1 })
    expect(state.lastRunAt).toBe(row.ts)
  })

  it("recentDigestRows returns newest-first and bounds the ledger", async () => {
    const t0 = Date.now() - 100_000
    for (let i = 0; i < 5; i++) {
      await digest.storeDigestRun({ sources: [{ ok: true, status: "ok" }], items: [] }, { now: t0 + i, maxRows: 3 })
    }
    const recent = await digest.recentDigestRows({ limit: 3 })
    expect(recent).toHaveLength(3)
    expect(new Date(recent[0].ts).getTime()).toBeGreaterThan(new Date(recent[1].ts).getTime())
    // maxRows bound: last row in the pruned store is the newest, size <= 3
    const state = await digest.digestState()
    expect(state.rows.length).toBeLessThanOrEqual(3)
  })
})

describe("digestSynthesis — routing honors the governor, summary is never invented", () => {
  it("no items → no-items (nothing to synthesize)", () => {
    const r = digest.digestSynthesis({ items: [], enabled: true })
    expect(r).toMatchObject({ summary: null, reason: "no-items" })
  })

  it("disabled by default → synthesis-disabled unless PICC_NEWS_DIGEST_SYNTHESIS=on", () => {
    delete process.env.PICC_NEWS_DIGEST_SYNTHESIS
    const off = digest.digestSynthesis({ items: [{ title: "x" }] })
    expect(off).toMatchObject({ summary: null, reason: "synthesis-disabled", enabled: false })
    vi.stubEnv("PICC_NEWS_DIGEST_SYNTHESIS", "on")
    const on = digest.digestSynthesis({ items: [{ title: "x" }] })
    expect(on.enabled).toBe(true)
  })

  it("enabled → routes through the governor but stays an honest stub (no fabrication)", () => {
    vi.stubEnv("PICC_NEWS_DIGEST_SYNTHESIS", "on")
    const r = digest.digestSynthesis({ items: [{ title: "x" }] })
    expect(r).toMatchObject({ summary: null, reason: "synthesis-stub-not-wired", enabled: true })
    expect(["T1", "T2"]).toContain(r.tier)
  })

  it("governor says unavailable → honest tier-unavailable (no fake summary)", () => {
    const route = () => ({ tier: "unavailable", escalated: false, reasons: [] })
    const r = digest.digestSynthesis({ items: [{ title: "x" }], enabled: true, route })
    expect(r).toMatchObject({ summary: null, reason: "tier-unavailable", tier: "unavailable" })
  })
})