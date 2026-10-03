// WS-7 T18 — D17's source contract. AC-038 (licensed and labeled) and the
// matcher half of AC-039 (prohibited scrapers absent and pinned absent).
//
// The three things this file proves that a comment cannot:
//
//   1. A datum CANNOT be constructed without provenance. `makeDatum` throws on
//      each missing field rather than returning a partial, so "every datum
//      carries source and retrieval mode" is enforced by the constructor rather
//      than by reviewer discipline.
//   2. `verified` is `boolean | null` and NEVER a number. A `0` there is a
//      projection with nowhere honest to put a zero (T10's discipline), and it
//      is indistinguishable from a measured `false` on the far side.
//   3. The AC-039 matcher catches a WRAPPER, not just the obvious name —
//      `apify-twitter` and `@vendor/bloomberg` are the shapes an author would
//      actually publish — while leaving every one of this repository's real
//      dependencies alone.
//
// NOTHING HERE TOUCHES THE NETWORK. A credentialed run needs network egress and
// an operator credential; this suite proves the CONTRACT, and a green suite is
// not a claim that any source answered.

import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  NEWS_SOURCES,
  NEWS_SOURCES_ABSENT_REASON,
  PROHIBITED_SOURCE_TARGETS,
  RETRIEVAL_MODE_VALUES,
  RETRIEVAL_MODES,
  classifySourceUrl,
  headlinesFrom,
  hasProvenance,
  makeDatum,
  newsSourceById,
  newsSourceFamily,
  newsSourceRows,
  prohibitedHostFor,
  prohibitedTargetFor,
  provenanceGap,
  publicNewsSourceRows,
  resolveNewsSource,
  resolveNewsSources
} from "../services/newsSources.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const AT = "2026-10-03T00:00:00.000Z"

describe("D17 — the retrieval-mode vocabulary is closed and each source names one", () => {
  it("exactly the four modes D17:241 permits", () => {
    expect([...RETRIEVAL_MODE_VALUES].sort()).toEqual(
      ["licensed-api", "licensed-feed", "licensed-websocket", "picc-own-browser"].sort()
    )
  })

  it("every declared source carries a mode, a licensed BASIS, a config and an absence reason", () => {
    for (const s of NEWS_SOURCES) {
      expect(RETRIEVAL_MODE_VALUES, `${s.id} has an unknown retrievalMode`).toContain(s.retrievalMode)
      expect(typeof s.licensedBasis).toBe("string")
      expect(s.licensedBasis.length).toBeGreaterThan(40)
      expect(typeof s.config).toBe("object")
      expect(typeof s.unconfiguredReason).toBe("string")
      expect(s.unconfiguredReason.length).toBeGreaterThan(20)
      expect(s.url.startsWith("https://")).toBe(true)
    }
  })

  it("D17:241's four named providers are all declared, plus PICC's own browser", () => {
    // NewsAPI, GDELT, CryptoPanic, RSS/Atom are the four D17 enumerates; the
    // fifth is D17's own "(b) PICC's own headed/headless browser".
    expect(new Set(NEWS_SOURCES.map((s) => s.family))).toEqual(
      new Set(["newsapi", "gdelt", "cryptopanic", "rss-atom", "picc-own-browser"])
    )
  })

  it("PICC's own browser is labelled with the OBLIGATION D17:245 attaches to it", () => {
    const own = newsSourceById("picc-own-browser")
    expect(own.retrievalMode).toBe(RETRIEVAL_MODES.PICC_OWN_BROWSER)
    expect(own.licensedBasis).toContain("labeling obligations")
    // And it is never described as a licence claim about the publisher.
    expect(own.licensedBasis).toContain("not a licence claim")
  })

  it("Serper is NOT a declared D17 source — T5 kept it live, D17 kept it off this path", () => {
    expect(newsSourceById("serper")).toBeNull()
    expect(newsSourceFamily("serper")).toBeNull()
    for (const s of NEWS_SOURCES) expect(s.id).not.toMatch(/serper/i)
  })

  it("an undeclared id resolves to null rather than a synthesized entry", () => {
    expect(newsSourceById("scraped-twitter-feed")).toBeNull()
    expect(newsSourceFamily("scraped-twitter-feed")).toBeNull()
  })
})

describe("AC-038 — a datum cannot be constructed without provenance", () => {
  it("a fully-provenanced datum has the whole shape, and passes the predicate", () => {
    const d = makeDatum({ sourceId: "rss-atom", text: "EURUSD rallies", retrievedAt: AT, verified: null })
    expect(hasProvenance(d)).toBe(true)
    expect(d.source).toBe("rss-atom")
    expect(d.sourceFamily).toBe("rss-atom")
    expect(d.retrievalMode).toBe("licensed-feed")
    expect(d.licensedBasis.length).toBeGreaterThan(0)
    expect(d.retrievedAt).toBe(AT)
    expect(d.verified).toBeNull()
    expect(provenanceGap(d)).toBeNull()
  })

  it("an UNDECLARED source is refused — it has no retrieval mode to carry", () => {
    expect(() => makeDatum({ sourceId: "my-scraper", text: "x", retrievedAt: null })).toThrow(/not a declared D17 source/)
  })

  it("an empty text is refused — that is how \"no signal\" and \"measured calm\" collide", () => {
    for (const bad of ["", "   ", "\n\t", null, undefined, 0]) {
      expect(() => makeDatum({ sourceId: "rss-atom", text: bad, retrievedAt: null })).toThrow(/carried no text/)
    }
  })

  it("verified must be boolean|null and NEVER a number", () => {
    for (const bad of [0, 1, "true", {}, []]) {
      expect(() => makeDatum({ sourceId: "rss-atom", text: "x", retrievedAt: null, verified: bad })).toThrow(/never a number/)
    }
    expect(() => makeDatum({ sourceId: "rss-atom", text: "x", retrievedAt: null, verified: null })).not.toThrow()
    expect(() => makeDatum({ sourceId: "rss-atom", text: "x", retrievedAt: null, verified: true })).not.toThrow()
    expect(() => makeDatum({ sourceId: "rss-atom", text: "x", retrievedAt: null, verified: false })).not.toThrow()
  })

  it("retrievedAt must be an ISO-8601 string or null — and null MEANS not retrieved", () => {
    expect(() => makeDatum({ sourceId: "rss-atom", text: "x", retrievedAt: "not-a-date" })).toThrow(/ISO-8601/)
    expect(() => makeDatum({ sourceId: "rss-atom", text: "x", retrievedAt: 1700000000000 })).toThrow(/ISO-8601/)
    const d = makeDatum({ sourceId: "rss-atom", text: "x", retrievedAt: null })
    expect(d.retrievedAt).toBeNull()
    expect(hasProvenance(d)).toBe(true)
  })

  it("the predicate rejects every hand-rolled partial, and says which field is missing", () => {
    const full = makeDatum({ sourceId: "rss-atom", text: "x", retrievedAt: AT })
    expect(hasProvenance({ ...full, source: undefined })).toBe(false)
    expect(provenanceGap({ ...full, source: undefined })).toMatch(/source/)
    expect(hasProvenance({ ...full, retrievalMode: "scraped" })).toBe(false)
    expect(provenanceGap({ ...full, retrievalMode: "scraped" })).toMatch(/retrievalMode/)
    expect(hasProvenance({ ...full, licensedBasis: "" })).toBe(false)
    expect(hasProvenance({ ...full, text: "" })).toBe(false)
    expect(hasProvenance({ ...full, sourceFamily: "invented" })).toBe(false)
    expect(hasProvenance(null)).toBe(false)
    expect(provenanceGap(null)).toMatch(/absent source/)
  })

  it("a SOURCE-LESS datum is null, and no consumer of this module can turn it into a 0", () => {
    // The distinction AC-038 turns on, made explicit: an absent source is
    // `null`; a measured zero is a number on a datum that carries provenance.
    const absent = null
    const measured = makeDatum({ sourceId: "gdelt", text: "EURUSD unchanged", retrievedAt: AT })
    expect(absent).toBeNull()
    expect(hasProvenance(absent)).toBe(false)
    expect(hasProvenance(measured)).toBe(true)
    expect(measured.text).toBe("EURUSD unchanged")
  })
})

describe("AC-038 — an instance inherits its family's licence claim", () => {
  it("a feed instance takes the family's mode and basis, not its own", () => {
    const d = makeDatum({ sourceId: "www.forexlive.com/feed/news", family: "rss-atom", text: "EURUSD rallies", retrievedAt: AT })
    expect(d.source).toBe("www.forexlive.com/feed/news")
    expect(d.sourceFamily).toBe("rss-atom")
    expect(d.retrievalMode).toBe("licensed-feed")
    expect(d.licensedBasis).toBe(newsSourceFamily("rss-atom").licensedBasis)
    expect(hasProvenance(d)).toBe(true)
  })

  it("an undeclared FAMILY is refused, so an operator cannot mint a licence by naming a URL", () => {
    expect(() => makeDatum({ sourceId: "whatever", family: "my-private-scraper", text: "x", retrievedAt: null })).toThrow(
      /not a declared D17 source or family/
    )
  })

  it("an instance with no label is refused", () => {
    expect(() => makeDatum({ sourceId: "", family: "rss-atom", text: "x", retrievedAt: null })).toThrow(/needs a source id/)
  })
})

describe("headlinesFrom — a reader gets headlines AND the gaps beside them", () => {
  it("keeps provenanced datums and REPORTS the ones it refused", () => {
    const good = makeDatum({ sourceId: "rss-atom", text: "EURUSD rallies", retrievedAt: AT })
    const out = headlinesFrom([good, { text: "no provenance" }, null])
    expect(out.headlines).toEqual(["EURUSD rallies"])
    expect(out.datums).toEqual([good])
    expect(out.unprovenanced).toHaveLength(2)
  })

  it("an empty input yields empty headlines, which T13's reader refuses rather than infers over", () => {
    expect(headlinesFrom([]).headlines).toEqual([])
    expect(headlinesFrom(null).headlines).toEqual([])
  })
})

describe("resolveNewsSources — configured is a NAMED state, never a bare true", () => {
  it("with nothing configured every source is absent with a reason, and absentReason is set", () => {
    const r = resolveNewsSources({})
    expect(r.configuredCount).toBe(0)
    expect(r.configuredIds).toEqual([])
    expect(r.absentReason).toBe(NEWS_SOURCES_ABSENT_REASON)
    for (const s of r.sources) {
      expect(s.configured).toBe(false)
      expect(s.configEvidence).toBeNull()
      expect(typeof s.reason).toBe("string")
      expect(s.reason).toMatch(/absence, not a neutral reading/)
    }
  })

  it("a configured source names the evidence that configured it", () => {
    const r = resolveNewsSources({ PICC_NEWS_FEEDS: "https://feeds.test/news" })
    const feeds = r.sources.find((s) => s.id === "rss-atom")
    expect(feeds.configured).toBe(true)
    expect(feeds.configEvidence).toBe("PICC_NEWS_FEEDS=set")
    expect(feeds.reason).toBeNull()
    expect(r.absentReason).toBeNull()
    expect(r.retrievalModes).toEqual(["licensed-feed"])
  })

  it("a CREDENTIAL ALONE IS NOT A DECISION — NewsAPI needs the flag too", () => {
    expect(resolveNewsSources({ NEWSAPI_API_KEY: "k" }).configuredCount).toBe(0)
    const both = resolveNewsSources({ NEWSAPI_API_KEY: "k", PICC_NEWS_NEWSAPI: "on" })
    expect(both.configuredCount).toBe(1)
    expect(both.sources.find((s) => s.id === "newsapi").configEvidence).toBe("NEWSAPI_API_KEY=set + PICC_NEWS_NEWSAPI=on")
  })

  it("the flag must be exactly 'on' (case-insensitive, whitespace-tolerant), not merely present", () => {
    for (const v of ["", "1", "true", "yes", "onn", "on1"]) {
      const r = resolveNewsSources({ PICC_NEWS_GDELT: v })
      expect(r.configuredCount, `PICC_NEWS_GDELT=${JSON.stringify(v)} counted as configured`).toBe(0)
    }
    expect(resolveNewsSources({ PICC_NEWS_GDELT: "on" }).configuredCount).toBe(1)
    expect(resolveNewsSources({ PICC_NEWS_GDELT: "ON" }).configuredCount).toBe(1)
    expect(resolveNewsSources({ PICC_NEWS_GDELT: " ON " }).configuredCount).toBe(1)
  })

  it("an empty-string env var is NOT configuration", () => {
    expect(resolveNewsSources({ PICC_NEWS_FEEDS: "   " }).configuredCount).toBe(0)
    expect(resolveNewsSources({ NEWSAPI_API_KEY: "", PICC_NEWS_NEWSAPI: "" }).configuredCount).toBe(0)
  })

  it("credentialRequired is DERIVED from the declared keys, not restated", () => {
    for (const s of NEWS_SOURCES) {
      const resolved = resolveNewsSource(s, {})
      expect(resolved.credentialRequired).toBe((s.config.keys ?? []).length > 0)
    }
  })
})

// ── AC-039: the matcher ──────────────────────────────────────────────────────

describe("AC-039 — prohibited targets are matched by WRAPPER, not by name alone", () => {
  it("the three D17:241 targets are the declared set", () => {
    expect(PROHIBITED_SOURCE_TARGETS.map((t) => t.label).sort()).toEqual(["Bloomberg", "ForexFactory", "X (Twitter)"].sort())
  })

  it("catches the obvious names", () => {
    expect(prohibitedTargetFor("bloomberg-scraper")).toBe("Bloomberg")
    expect(prohibitedTargetFor("twitter-scraper")).toBe("X (Twitter)")
    expect(prohibitedTargetFor("tweet-scraper")).toBe("X (Twitter)")
    expect(prohibitedTargetFor("x-api-client")).toBe("X (Twitter)")
    expect(prohibitedTargetFor("forexfactory")).toBe("ForexFactory")
  })

  it("catches the WRAPPERS — the shapes AC-039 says must also be caught", () => {
    // "a package that wraps it is still caught". These are the real published
    // wrappers: a vendor namespace, a multi-hyphen name, and a camel-humped
    // one that a substring guard would miss on every one of the three forms.
    expect(prohibitedTargetFor("apify-twitter")).toBe("X (Twitter)")
    expect(prohibitedTargetFor("@apify/twitter-scraper")).toBe("X (Twitter)")
    expect(prohibitedTargetFor("@somevendor/bloomberg")).toBe("Bloomberg")
    expect(prohibitedTargetFor("bloomberg-terminal-sdk")).toBe("Bloomberg")
    expect(prohibitedTargetFor("forex_factory")).toBe("ForexFactory")
    expect(prohibitedTargetFor("ForexFactoryPy")).toBe("ForexFactory")
  })

  it("does NOT fire on this repository's real dependency names", () => {
    for (const n of ["ccxt", "playwright", "web-push", "typescript", "react-dom", "fast-xml-parser", "@playwright/test", "oxc-parser", "xlsx", "ws"]) {
      expect(prohibitedTargetFor(n), `${n} was wrongly flagged`).toBeNull()
    }
  })

  it("catches the URL authorities, including subdomains", () => {
    expect(prohibitedHostFor("https://www.bloomberg.com/feed/podcast")).toBe("Bloomberg")
    expect(prohibitedHostFor("https://x.com/user/status/1")).toBe("X (Twitter)")
    expect(prohibitedHostFor("https://mobile.twitter.com/x")).toBe("X (Twitter)")
    expect(prohibitedHostFor("https://www.forexfactory.com/calendar")).toBe("ForexFactory")
  })

  it("does NOT fire on legitimate news hosts, including ones that look similar", () => {
    for (const u of [
      "https://news.google.com/rss/search?q=crypto",
      "https://www.forexlive.com/feed/news",
      "https://feeds.content.dowjones.io/public/rss/mw_topstories",
      "https://www.x.computer.test/x", // 'x.' inside a longer label is not x.com
      "https://notforexfactory.example/feed"
    ]) {
      expect(prohibitedHostFor(u), `${u} was wrongly flagged`).toBeNull()
    }
  })

  it("a non-URL and an empty string are not a prohibited host", () => {
    expect(prohibitedHostFor("")).toBeNull()
    expect(prohibitedHostFor("not a url")).toBeNull()
    expect(prohibitedHostFor(null)).toBeNull()
    expect(prohibitedTargetFor("")).toBeNull()
    expect(prohibitedTargetFor(undefined)).toBeNull()
  })

  it("classifySourceUrl is the same answer with the reasoning attached", () => {
    expect(classifySourceUrl("https://www.bloomberg.com/feed")).toEqual({
      url: "https://www.bloomberg.com/feed",
      permitted: false,
      prohibitedTarget: "Bloomberg"
    })
    expect(classifySourceUrl("https://feeds.test/news")).toEqual({
      url: "https://feeds.test/news",
      permitted: true,
      prohibitedTarget: null
    })
    // An EMPTY url is not permitted either — "no url given" is not a source.
    expect(classifySourceUrl("").permitted).toBe(false)
  })
})

describe("AC-039 — the declared dependencies of this repository are all clean", () => {
  const manifests = ["package.json", "apps/dashboard/package.json"]

  it("every declared dependency is scanned, and none is a prohibited target", () => {
    const found = []
    let scanned = 0
    for (const rel of manifests) {
      const abs = new URL(rel, `file:///${REPO_ROOT.replace(/\\/g, "/")}`)
      const json = JSON.parse(readFileSync(abs, "utf8"))
      const names = [
        ...Object.keys(json.dependencies ?? {}),
        ...Object.keys(json.devDependencies ?? {})
      ]
      scanned += names.length
      for (const n of names) {
        const target = prohibitedTargetFor(n)
        if (target) found.push(`${rel}: ${n} -> ${target}`)
      }
    }
    // The floor: a sweep that reads zero names passes forever, which is the exact
    // failure `importResolutionGuard.test.mjs:135-147` pins for its own scope.
    expect(scanned, "no dependency names were read, so this sweep proves nothing").toBeGreaterThan(10)
    expect(found.join("\n")).toBe("")
  })

  it("the sweep really reads git, so an untracked package cannot hide from it", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "package.json", "apps/dashboard/package.json"], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    })
      .split(/\r?\n/)
      .filter(Boolean)
    expect(tracked.sort()).toEqual(manifests.sort())
  })
})

describe("the Settings-room rows are DERIVED from this registry, not restated", () => {
  const rows = newsSourceRows({})

  it("one row per declared source, all under the trading ministry", () => {
    expect(rows).toHaveLength(NEWS_SOURCES.length)
    for (const r of rows) expect(r.ministry).toBe("trading")
  })

  it("each row carries the two fields D17's \"licensed and labeled\" needs", () => {
    for (const r of rows) {
      expect(RETRIEVAL_MODE_VALUES).toContain(r.retrievalMode)
      expect(r.licensedBasis.length).toBeGreaterThan(0)
      expect(r.unconfiguredReason).toMatch(/absence, not a neutral reading/)
    }
  })

  it("state is derived from CONFIGURATION and is never `connected`", () => {
    // Nothing here has ever been probed, so a configured source is `degraded`
    // (set but unverified) — the same discipline T5 applied to Serper's badge.
    for (const r of newsSourceRows({})) expect(r.state).toBe("unconfigured")
    const configured = newsSourceRows({ PICC_NEWS_FEEDS: "https://feeds.test/news" })
    const feeds = configured.find((r) => r.id === "rss-atom")
    expect(feeds.state).toBe("degraded")
    expect(feeds.configEvidence).toBe("PICC_NEWS_FEEDS=set")
    expect(configured.find((r) => r.id === "newsapi").state).toBe("unconfigured")
    for (const r of configured) expect(r.state).not.toBe("connected")
  })
})

// ── The projection an UNAUTHENTICATED read is served ─────────────────────────

describe("publicNewsSourceRows carries no environment-derived field", () => {
  /** Every env var name the registry declares. Naming one is the leak. */
  const ALL_KNOBS = [
    "NEWSAPI_API_KEY",
    "PICC_NEWS_NEWSAPI",
    "PICC_NEWS_GDELT",
    "CRYPTOPANIC_AUTH_TOKEN",
    "PICC_NEWS_CRYPTOPANIC",
    "PICC_NEWS_FEEDS",
    "PICC_NEWS_BROWSER_SOURCES"
  ]
  const CONFIGURED = {
    NEWSAPI_API_KEY: "super-secret-value",
    PICC_NEWS_NEWSAPI: "on",
    PICC_NEWS_GDELT: "on"
  }

  it("drops state and configEvidence when the environment CONFIGURED a source", () => {
    const rows = publicNewsSourceRows(CONFIGURED)
    expect(rows).toHaveLength(NEWS_SOURCES.length)
    for (const r of rows) {
      expect(Object.keys(r), `${r.id} must not carry state`).not.toContain("state")
      expect(Object.keys(r), `${r.id} must not carry configEvidence`).not.toContain("configEvidence")
    }
    expect(JSON.stringify(rows)).not.toContain("=set")
    expect(JSON.stringify(rows)).not.toContain("super-secret-value")
  })

  it("drops the absence verdict too — the DECLARED sentence is also a machine claim", () => {
    // `NEWS_SOURCES[i].unconfiguredReason` opens with "NEWSAPI_API_KEY is unset",
    // so emitting it — conditionally or not — tells the reader whether this machine
    // holds the credential. The public catalog therefore offers no verdict at all.
    for (const r of publicNewsSourceRows({})) {
      expect(r.unconfiguredReason, `${r.id} must carry no absence verdict`).toBeNull()
    }
    const text = JSON.stringify(publicNewsSourceRows({}))
    for (const knob of ALL_KNOBS) expect(text).not.toContain(knob)
    expect(text).not.toContain("(observed:")
  })

  it("keeps every REFERENCE field the room's D17 columns are built from", () => {
    const [full, projected] = [newsSourceRows(CONFIGURED), publicNewsSourceRows(CONFIGURED)]
    expect(projected.map((r) => r.id)).toEqual(full.map((r) => r.id))
    for (const r of projected) {
      const original = full.find((f) => f.id === r.id)
      expect(r.url).toBe(original.url)
      expect(r.purpose).toBe(original.purpose)
      expect(r.retrievalMode).toBe(original.retrievalMode)
      expect(r.licensedBasis).toBe(original.licensedBasis)
      expect(r.boundary).toEqual(original.boundary)
      expect(r.ministry).toBe(original.ministry)
      expect(r.name).toBe(original.name)
    }
  })

  it("the two exports differ ONLY in the env-derived fields", () => {
    // A key-set difference, so a future field added to the row is noticed here
    // rather than by a caller reading a credential-configuration answer off a
    // public route. `unconfiguredReason` is PRESENT AND NULL on the projection
    // rather than absent — an explicit null is the honest "no verdict is offered
    // here" — so the key sets differ by exactly the two dropped fields.
    const full = newsSourceRows(CONFIGURED).map((r) => Object.keys(r).sort())
    const projected = publicNewsSourceRows(CONFIGURED).map((r) => Object.keys(r).sort())
    const dropped = new Set(["state", "configEvidence"])
    for (let i = 0; i < full.length; i += 1) {
      expect(projected[i].filter((k) => !dropped.has(k)), `row ${i} key set`).toEqual(
        full[i].filter((k) => !dropped.has(k))
      )
      expect(full[i].filter((k) => dropped.has(k))).toEqual(["configEvidence", "state"])
    }
  })
})