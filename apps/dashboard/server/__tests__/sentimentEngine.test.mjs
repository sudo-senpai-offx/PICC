// WS-7 T18 — the sentiment engine's honest contract.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE WAS REWRITTEN RATHER THAN EXTENDED
// ---------------------------------------------------------------------------
//
// The pre-T18 suite asserted four things D17 forbids, and asserting them is how
// they stayed:
//
//   :29  "returns neutral composite for null symbol"        -> score 0
//   :40  "returns neutral for numeric-only EO IDs"          -> score 0
//   :107 "returns neutral when news source errors"           -> score 0
//   and :54 `expect(serperNews).toHaveBeenCalledWith("EURUSD trading news", 10)`
//        -> the sentiment engine's news leg ran on Serper.
//
// Every one of those is INVERTED below rather than deleted. A deleted assertion
// leaves a hole a later edit can fill; an inverted one fails if the fabrication
// comes back. The Serper assertion is replaced by the stronger claim it was
// standing in for: the news leg reads D17's registry, and Serper is absent from
// this module's import graph entirely.
//
// THE SEAM IS INJECTED, NOT MOCKED AWAY. `fetchDigest` supplies real
// `makeDatum` output, so the provenance filter, the symbol matcher, the lexicon
// and the composite arithmetic all run for real with no network and no
// credentials — which is the only way to test AC-038 on this machine.

import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockData } = vi.hoisted(() => ({
  mockData: { cache: {}, history: [] }
}))

vi.mock("../services/localstore.mjs", () => ({
  localStore: () => ({
    data: mockData,
    write: vi.fn()
  })
}))

const { getSentiment, sentimentLastUpdate } = await import("../services/sentimentEngine.mjs")
const { makeDatum, NEWS_SOURCES_ABSENT_REASON } = await import("../services/newsSources.mjs")

const NOW = 1_700_000_000_000
const CONFIGURED = { PICC_NEWS_FEEDS: "https://feeds.test/news" }
const UNCONFIGURED = { PICC_NEWS_FEEDS: "" }

/** A digest seam returning real provenanced datums, at a fixed `now`. */
const digestWith = (texts) => async () => ({
  at: new Date(NOW).toISOString(),
  sources: [{ feed: "feeds.test/news", url: "https://feeds.test/news", status: "ok", ok: true, items: texts.length, reason: null }],
  items: texts.map((t, i) =>
    makeDatum({
      sourceId: "feeds.test/news",
      family: "rss-atom",
      text: t,
      retrievedAt: new Date(NOW).toISOString(),
      verified: null,
      sourceUrl: `https://feeds.test/${i}`,
      publishedAt: null
    })
  ),
  unprovenancedItems: 0,
  absentReason: null
})

const bullFor = (sym) => Array.from({ length: 6 }, () => `${sym} rallies to record highs on strong data`)
const bearFor = (sym) => Array.from({ length: 6 }, () => `${sym} crashes to new lows after weak results`)
const BULL = bullFor("EURUSD")
const BEAR = bearFor("EURUSD")
const MIXED = ["EURUSD rallies on strong data", "EURUSD crashes on weak PMI", "EURUSD trading range bound"]

beforeEach(() => {
  vi.clearAllMocks()
  mockData.cache = {}
  mockData.history = []
})

// ── The absences T18 exists for. Every one of these was a `0` before. ───────

describe("T18 — an unsearchable symbol is an ABSENCE, not a neutral", () => {
  it("a null symbol yields composite null and a reason", async () => {
    const r = await getSentiment(null, { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.composite).toBeNull()
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/not searchable|not normalized/i)
  })

  it("an undefined symbol yields composite null, never score 0", async () => {
    const r = await getSentiment(undefined, { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.composite).toBeNull()
    expect(r.reason).toBeTruthy()
  })

  it("a numeric-only EO id yields composite null — the pre-T18 `score: 0, label: \"Neutral\"`", async () => {
    const r = await getSentiment("12345", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.composite).toBeNull()
    expect(JSON.stringify(r.composite)).not.toMatch(/Neutral/)
    expect(r.reason).toMatch(/not searchable|not normalized/i)
  })

  it("nothing was OBSERVED, so observedAt is null while timestamp is set", async () => {
    const r = await getSentiment("12345", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.observedAt).toBeNull()
    expect(r.timestamp).toBe(NOW)
    // And the store-level reader agrees: an absent reading is not an observation.
    expect(sentimentLastUpdate()).toBeNull()
  })
})

describe("T18 — ZERO SOURCES CONFIGURED IS THE HEADLINE ABSENCE", () => {
  it("reports the D17 absent reason, and no composite", async () => {
    const r = await getSentiment("EURUSD", { env: UNCONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.newsUnavailableReason).toBe(NEWS_SOURCES_ABSENT_REASON)
    expect(r.news).toBeNull()
    expect(r.composite).toBeNull()
    expect(r.available).toBe(false)
  })

  it("never touches the digest seam at all when no source is configured", async () => {
    const seam = vi.fn(digestWith(BULL))
    await getSentiment("EURUSD", { env: UNCONFIGURED, fetchDigest: seam, now: NOW })
    expect(seam).not.toHaveBeenCalled()
  })

  it("a configured source with an EMPTY digest is a MEASURED zero about publishers, not an absence", async () => {
    const empty = async () => ({
      at: new Date(NOW).toISOString(),
      sources: [{ feed: "feeds.test/news", url: "https://feeds.test/news", status: "ok", ok: true, items: 0, reason: null }],
      items: [],
      unprovenancedItems: 0,
      absentReason: null
    })
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: empty, now: NOW })
    expect(r.news).toBeNull()
    expect(r.newsUnavailableReason).toMatch(/MEASURED zero/)
    expect(r.newsUnavailableReason).not.toBe(NEWS_SOURCES_ABSENT_REASON)
  })

  it("a configured source with NO FEED LIST is named as its own absence", async () => {
    // Only a licensed-API source is switched on. There is no RSS list, so the
    // feed leg has nothing to read - which is different from "the feed said
    // nothing" and is named differently.
    const r = await getSentiment("EURUSD", { env: { NEWSAPI_API_KEY: "k", PICC_NEWS_NEWSAPI: "on" }, now: NOW })
    expect(r.news).toBeNull()
    expect(r.newsUnavailableReason).toMatch(/PICC_NEWS_FEEDS is empty/)
  })
})

describe("T18 — a datum must be PROVENANCED to be scored", () => {
  it("every scored item carries source, retrievalMode and licensedBasis", async () => {
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.provenance.length).toBe(BULL.length)
    for (const d of r.provenance) {
      expect(d.source).toBe("feeds.test/news")
      expect(d.retrievalMode).toBe("licensed-feed")
      expect(typeof d.licensedBasis).toBe("string")
      expect(d.licensedBasis.length).toBeGreaterThan(0)
      expect(d.retrievedAt).toBe(new Date(NOW).toISOString())
      // `verified` is boolean|null, never a number (T10's discipline).
      expect(d.verified === null || typeof d.verified === "boolean").toBe(true)
    }
  })

  it("the news leg reports the retrieval modes that produced it", async () => {
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.news.retrievalModes).toEqual(["licensed-feed"])
    expect(r.news.sources).toEqual(["feeds.test/news"])
    expect(r.news.verified).toBeNull()
  })

  it("an UNPROVENANCED item is reported, not scored and not silently dropped", async () => {
    const seam = async () => ({
      at: new Date(NOW).toISOString(),
      sources: [{ feed: "feeds.test/news", status: "ok", ok: true, items: 2, reason: null }],
      items: [
        makeDatum({ sourceId: "feeds.test/news", family: "rss-atom", text: "EURUSD rallies hard", retrievedAt: new Date(NOW).toISOString() }),
        { title: "EURUSD rallies hard", text: "EURUSD rallies hard" } // no provenance at all
      ],
      unprovenancedItems: 1,
      absentReason: null
    })
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: seam, now: NOW })
    expect(r.provenance).toHaveLength(1)
    expect(r.news.sampleSize).toBe(1)
    expect(r.unprovenanced).toHaveLength(1)
    expect(r.unprovenanced[0]).toMatch(/missing provenance/)
  })

  it("a digest item that never mentions the symbol is an absence of COVERAGE", async () => {
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(["GBPUSD rallies to record highs"]), now: NOW })
    expect(r.news).toBeNull()
    expect(r.newsUnavailableReason).toMatch(/absence of COVERAGE/i)
  })
})

describe("T18 — Serper is not on this path, and the lexicon still works", () => {
  it("this module imports nothing from serper.mjs", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../services/sentimentEngine.mjs", import.meta.url), "utf8")
    )
    const imports = src.match(/^\s*import[^\n]*from\s+"[^"]+"/gm) ?? []
    expect(imports.join("\n")).not.toMatch(/serper/i)
  })

  it("strips the OTC suffix before normalizing, as before", async () => {
    const r = await getSentiment("GBPUSD-OTC", { env: CONFIGURED, fetchDigest: digestWith(["GBPUSD rallies hard"]), now: NOW })
    expect(r.symbol).toBe("GBPUSD")
  })

  it("bullish headlines produce a positive composite", async () => {
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.composite.score).toBeGreaterThan(0)
    expect(r.composite.label).toMatch(/bullish/i)
  })

  it("bearish headlines produce a negative composite", async () => {
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(BEAR), now: NOW })
    expect(r.composite.score).toBeLessThan(0)
    expect(r.composite.label).toMatch(/bearish/i)
  })

  it("mixed headlines land inside the neutral band WITHOUT that being a default", async () => {
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(MIXED), now: NOW })
    expect(Math.abs(r.composite.score)).toBeLessThan(0.5)
    // A measured near-zero is not an absent reading: it carries its sample size.
    expect(r.news.sampleSize).toBe(3)
    expect(r.observedAt).toBe(NOW)
  })

  it("caches within the 5-minute window and re-reads after it", async () => {
    const seam = vi.fn(digestWith(BULL))
    await getSentiment("USDCAD", { env: CONFIGURED, fetchDigest: seam, now: NOW })
    await getSentiment("USDCAD", { env: CONFIGURED, fetchDigest: seam, now: NOW + 1000 })
    expect(seam).toHaveBeenCalledTimes(1)
    await getSentiment("USDCAD", { env: CONFIGURED, fetchDigest: seam, now: NOW + 400_000 })
    expect(seam).toHaveBeenCalledTimes(2)
  })
})

describe("T18 — the composite reserves the absent leg's weight and renormalises NOTHING", () => {
  it("on the first reading the derived social leg is absent BY CONSTRUCTION", async () => {
    const r = await getSentiment("EURNZD", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.social).toBeNull()
    expect(r.socialUnavailableReason).toMatch(/velocity needs at least 2/)
  })

  it("the composite reaches only the news leg's 0.6, and says so", async () => {
    const r = await getSentiment("EURNZD", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.composite.legsPresent).toEqual(["news"])
    expect(r.composite.declaredLegWeightReached).toBe(0.6)
    expect(r.composite.legWeightsRenormalised).toBe(false)
    expect(r.composite.weighted.social).toBeNull()
    // The news leg keeps its declared 0.6 - it is not inflated over the 0.4 gap.
    expect(r.composite.weighted.news).toBeCloseTo(r.news.score * 0.6, 6)
    expect(r.composite.score).toBeCloseTo(r.news.score * 0.6, 2)
  })

  it("THE CONTROL: rescaling over the reached weight would give a DIFFERENT, larger number", async () => {
    const r = await getSentiment("EURNZD", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    const renormalised = r.news.score / r.composite.declaredLegWeightReached
    expect(renormalised).not.toBe(r.composite.score)
    expect(Math.abs(renormalised)).toBeGreaterThan(Math.abs(r.composite.score))
  })

  it("once two composites exist the social leg appears and the band widens to 1.0", async () => {
    // Two composites must be MEASURED before a third reading can project a
    // velocity from them, so this is three reads - and the third is the first
    // that can carry the social leg. Reading 2 still has only one prior
    // composite, so it is still news-only.
    const first = await getSentiment("AUDNZD", { env: CONFIGURED, fetchDigest: digestWith(bullFor("AUDNZD")), now: NOW })
    expect(first.composite.legsPresent).toEqual(["news"])
    const second = await getSentiment("AUDNZD", { env: CONFIGURED, fetchDigest: digestWith(bullFor("AUDNZD")), now: NOW + 400_000 })
    expect(second.composite.legsPresent).toEqual(["news"])
    const third = await getSentiment("AUDNZD", { env: CONFIGURED, fetchDigest: digestWith(bullFor("AUDNZD")), now: NOW + 800_000 })
    expect(third.social).not.toBeNull()
    expect(third.social.historySize).toBeGreaterThanOrEqual(2)
    expect(third.composite.legsPresent).toEqual(["news", "social"])
    expect(third.composite.declaredLegWeightReached).toBe(1)
    expect(third.composite.legWeightsRenormalised).toBe(false)
    // With both legs the weight is genuinely spent, so the band is the full one.
    expect(third.composite.score).toBeCloseTo(third.news.score * 0.6 + third.social.score * 0.4, 2)
  })

  it("only MEASURED composites enter the history, so an absent reading is not a hole read as 0", async () => {
    await getSentiment("AUDCAD", { env: UNCONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(mockData.history).toEqual([])
    await getSentiment("AUDCAD", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW + 400_000 })
    expect(mockData.history.every((h) => typeof h.score === "number")).toBe(true)
    expect(mockData.history.some((h) => h.score === null)).toBe(false)
  })
})

describe("T18 — the Copilot producer is CALLED, and is cold by default", () => {
  it("with no sources configured the producer returns no input and names the absence", async () => {
    const r = await getSentiment("EURUSD", { env: UNCONFIGURED, now: NOW })
    expect(r.copilot.sentimentInput).toBeNull()
    expect(r.copilot.stateInput).toBeUndefined()
    expect(r.copilot.reason).toBeTruthy()
  })

  it("with no READER supplied the producer names the reader, not the source", async () => {
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(BULL), now: NOW })
    expect(r.copilot.sourcesConfigured).toBe(1)
    expect(r.copilot.reason).toMatch(/no sentiment reader was supplied/)
  })

  it("with a reader AND provenanced datums the producer supplies the 5% expert's input", async () => {
    const reader = { read: vi.fn(() => ({ available: true, input: { score: -0.5, source: "test-backend via needle3.cact (sha256-verified, D15)" }, reason: null })) }
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(BULL), reader, now: NOW })
    expect(reader.read).toHaveBeenCalledWith({ headlines: expect.arrayContaining(["EURUSD rallies to record highs on strong data"]) })
    expect(r.copilot.sentimentInput).toEqual({ score: -0.5, source: "test-backend via needle3.cact (sha256-verified, D15)" })
    expect(r.copilot.reason).toBeNull()
  })

  it("a reader that reports unavailable passes its reason through verbatim", async () => {
    const reader = { read: vi.fn(() => ({ available: false, input: null, reason: "the model artifact failed D15's supply-chain gate" })) }
    const r = await getSentiment("EURUSD", { env: CONFIGURED, fetchDigest: digestWith(BULL), reader, now: NOW })
    expect(r.copilot.sentimentInput).toBeNull()
    expect(r.copilot.reason).toBe("the model artifact failed D15's supply-chain gate")
  })
})