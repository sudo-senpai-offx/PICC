// WS-7 T18 — D17's DATA-SOURCE CONTRACT. Pure: no network, no clock, no env
// read at import time, no store.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS THE SINGLE REGISTRY
// ---------------------------------------------------------------------------
//
// D17 (spec :238-245) is one decision, and the audit behind it (spec :239) found
// that "sentiment/news ingestion [was] spread across `newsDigest.mjs`,
// `sentimentEngine.mjs`, and handler research paths, with Serper only partially
// replaced". A decision with three registries is how it was spread in the first
// place: each registry had its own list, so each list had its own answer about
// what was licensed, taken at a different moment.
//
// So this module is the ONE place a D17 source is declared, and everything that
// consumes news — the digest, `sentimentEngine.mjs`, the Copilot's sentiment
// producer, and the Settings room's Integrations table — reads it. That is the
// "reuse over duplication" rule the Settings-room work established (T14's
// note at `SettingsRoom.tsx:16-27`): two routes over one store give that store
// two answers.
//
// ---------------------------------------------------------------------------
// WHAT "TRUSTED" MEANS HERE — IT IS A RETRIEVAL MODE, NOT A BRAND
// ---------------------------------------------------------------------------
//
// D17 permits exactly two kinds of reach: (a) "licensed/trusted APIs and feeds —
// NewsAPI, GDELT, CryptoPanic, RSS/Atom — over API/WebSocket", and (b) "PICC's
// own headed/headless browser". A source is acceptable because of HOW it is
// reached, so `RETRIEVAL_MODES` is the closed vocabulary and every datum must
// carry one. A source id that cannot name a mode is not a source; it is a
// URL somebody pasted somewhere.
//
// FOUR MODES, AND THE FOURTH IS PICC'S OBLIGATION
// ---------------------------------------------------------------------------
//
// `picc-own-browser` is not a free pass. D17:245 says it plainly: "PICC's own
// browser is PICC's infrastructure and carries PICC's labeling obligations." So
// a datum obtained that way carries `retrievalMode: "picc-own-browser"` and the
// same `licensedBasis` field every other datum carries — the fact that PICC
// drives the browser is a fact the operator must be able to read, not a
// laundering step that makes a scraped page look like a licensed feed.
//
// T2 removed ExpertOption's capture layer and D22/D25 retain the browser
// capability as a DISCLOSED policy. This module does not reintroduce a capture
// layer, does not click, and does not submit: it names the mode and requires a
// provenance record for it. The seam that would drive the browser is the
// existing, already-gated `browserBridge.mjs` (`openBridge`/`readPage`), and it
// is INJECTED — this file imports nothing that opens a browser.
//
// ---------------------------------------------------------------------------
// ABSENCE IS NAMED, AND IT IS NOT ZERO
// ---------------------------------------------------------------------------
//
// With no source configured, `resolveNewsSources` returns `configuredCount: 0`
// and a non-null `absentReason`. A consumer that wants to render "no datum"
// therefore has to say so out loud, because the alternative shapes are all lies:
//
//   `score: 0`      a measured NEUTRAL, which is an opinion nobody had;
//   `items: []`     "the source is live and found nothing" — a claim about a
//                   source that was never configured;
//   `text: ""`      an empty string that pattern-matches "no signal" in every
//                   consumer and reads as measured calm.
//
// So the absence is a NAMED state with a reason, the same shape T14 gave
// delivery (`notifications/states.mjs:22-27`: "unavailable — nothing was sent
// because there was nothing to send WITH") and the same shape T13 gave the model
// reader (`modelLayer/sentimentModel.mjs:160`: `input: null`, never a number).
//
// `verified` is `boolean | null`. `null` means "not verified", never `0`, for
// T10's reason (`observed: boolean | null`): a projection has nowhere honest to
// put a zero.
//
// ---------------------------------------------------------------------------
// SERPER'S STATUS, RESOLVED PER T5 — AND IT IS NOT A NEUTRAL DECISION
// ---------------------------------------------------------------------------
//
// AC-017/T5 (spec :901-907) resolved Serper by making the DOCUMENTATION tell the
// truth rather than by deleting the import: `sentimentEngine.mjs`, `amazon.mjs`,
// the handler research paths, `agents/picc_agents/crew.py` and `agents/.env.example`
// all still reference Serper, and T5b (commit 78ab322) corrected `PICC.md` to say
// so. T18 does not re-decide that — Serper is live and stays live.
//
// What T18 decides is narrower, and D17's own list forces it: **Serper is not a
// news/sentiment source.** It is absent from D17:241's enumeration, the earlier
// owner decision of 2026-09-13 already recorded in `newsDigest.mjs:1-15` replaced
// Serper for the digest ("Serper is REPLACED, never supplemented"), and it is a
// general web-research provider rather than a licensed news feed. So:
//
//   - the Copilot's 5% sentiment inputs come from this registry, and Serper is
//     not in it (`sentimentEngine.mjs` no longer imports `serper.mjs`);
//   - Serper remains for `/api/trading/news`, `amazon.mjs`'s competitor lookup,
//     and the crewai search tool, and it is LABELLED `licensed-api` on the route
//     that uses it, because that is what it is;
//   - `agents/picc_agents/.env.example` records the distinction rather than
//     leaving a bare `SERPER_API_KEY` that reads as a news-source credential.
//
// ---------------------------------------------------------------------------
// PROHIBITED TARGETS ARE A LIST, AND THE GUARD READS THIS LIST
// ---------------------------------------------------------------------------
//
// D17:241 — "Scraping Bloomberg, X, and ForexFactory is prohibited on ToS
// grounds." AC-039 requires them "absent and pinned absent", verified by "a guard
// test with a synthetic offending dependency" and "a package that wraps it is
// still caught".
//
// `PROHIBITED_SOURCE_TARGETS` is the single array the guard matches against, so
// the guard cannot drift from this decision: adding a fourth prohibited target
// here immediately widens the guard, and removing one immediately narrows it.
// The matcher is deliberately host- and package-shaped rather than a bare
// substring, because "bloomberg" appears legitimately in news TEXT and a
// substring guard would either be useless or demand that PICC delete real
// headlines.

/**
 * The closed vocabulary of acceptable reach. A datum with a mode outside this
 * set is not constructible — `makeDatum` throws rather than guessing.
 *
 * @readonly
 * @enum {string}
 */
export const RETRIEVAL_MODES = Object.freeze({
  /** A vendor's licensed REST/JSON API: NewsAPI, GDELT DOC 2.0. */
  LICENSED_API: "licensed-api",
  /** The publisher's own RSS/Atom feed, over HTTP GET. */
  LICENSED_FEED: "licensed-feed",
  /** A vendor's licensed realtime stream: CryptoPanic. */
  LICENSED_WEBSOCKET: "licensed-websocket",
  /** PICC's own headed/headless Chromium, driving a logged-in session. */
  PICC_OWN_BROWSER: "picc-own-browser"
})

const MODE_VALUES = new Set(Object.values(RETRIEVAL_MODES))

/** Every acceptable mode, for exhaustiveness assertions. */
export const RETRIEVAL_MODE_VALUES = Object.freeze([...MODE_VALUES])

/**
 * D17's prohibited set, with the matcher each entry is pinned by.
 *
 * Matching is on WHOLE TOKENS of a package name (split on `- _ / . @` and
 * camel-hump) rather than on substrings, and it is deliberately WIDE: AC-039
 * requires that "a package that wraps it is still caught", so `apify-twitter`
 * and `@some/vendor/bloomberg-scraper` must both trip even though neither
 * starts with the target's name. Erring wide is the correct direction here —
 * the cost of a false positive is one declined dependency, and the cost of a
 * false negative is the ToS exposure D17 exists to close.
 *
 * `host` matches the authority of an http(s) URL, which is what catches the
 * operator's own pasted URL and any wrapper whose host is the target.
 *
 * @type {ReadonlyArray<{id: string, label: string, tokens: RegExp, host: RegExp}>}
 */
export const PROHIBITED_SOURCE_TARGETS = Object.freeze([
  Object.freeze({
    id: "bloomberg",
    label: "Bloomberg",
    tokens: /^bloomberg$/i,
    host: /(^|\.)bloomberg\.com$/i
  }),
  Object.freeze({
    id: "x-twitter",
    label: "X (Twitter)",
    // `x` alone is included: D17 prohibits X, and a package whose name carries
    // the single-letter platform token is an X client by any other name.
    tokens: /^(x|twitter|tweet)$/i,
    host: /(^|\.)(x|twitter)\.com$/i
  }),
  Object.freeze({
    id: "forexfactory",
    label: "ForexFactory",
    tokens: /^(forexfactory|forexfactorypy)$/i,
    host: /(^|\.)forexfactory\.com$/i
  })
])

/**
 * Every searchable form of a package name or module specifier.
 *
 * `apify-twitter-scraper`  -> ["apify","twitter","scraper","apifytwitter","twitterscraper"]
 * `@vendor/ForexFactory`   -> ["vendor","forexfactory","vendorforexfactory"]
 *
 * The SCOPE of a scoped package is searched too, deliberately: `@vendor/bloomberg`
 * is a wrapper as much as `bloomberg-scraper` is, and dropping the scope would be
 * a gap an author could walk through by publishing under any namespace.
 *
 * Single tokens catch `apify-twitter` and `x-api-client`; adjacent pairs catch a
 * multi-word target whose name is hyphenated, underscored or camel-humped
 * (`forex_factory`, `ForexFactoryPy`) — all three of which are the same package
 * to an operator and must be the same answer here.
 *
 * @param {string} specifier
 * @returns {string[]}
 */
function packageSearchForms(specifier) {
  const text = typeof specifier === "string" ? specifier.trim() : ""
  if (!text) return []
  const tokens = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
  const pairs = []
  for (let i = 0; i + 1 < tokens.length; i += 1) pairs.push(tokens[i] + tokens[i + 1])
  return [...tokens, ...pairs]
}

/**
 * Name the prohibited target a dependency name or module specifier refers to,
 * or `null`. This is the AC-039 matcher, exported so the guard tests THIS and
 * not a private copy of the pattern.
 *
 * @param {string} specifier A package name, or an import/require specifier.
 * @returns {string|null} The prohibited target's label, or null.
 */
export function prohibitedTargetFor(specifier) {
  const forms = packageSearchForms(specifier)
  if (forms.length === 0) return null
  for (const target of PROHIBITED_SOURCE_TARGETS) {
    if (forms.some((form) => target.tokens.test(form))) return target.label
  }
  return null
}

/**
 * Name the prohibited target an http(s) URL points at, or `null`.
 *
 * @param {string} url
 * @returns {string|null} The prohibited target's label, or null.
 */
export function prohibitedHostFor(url) {
  const text = typeof url === "string" ? url.trim() : ""
  if (!text) return null
  let host
  try {
    host = new URL(text).hostname
  } catch {
    return null
  }
  for (const target of PROHIBITED_SOURCE_TARGETS) {
    if (target.host.test(host)) return target.label
  }
  return null
}

/**
 * The D17 registry. Every entry names the mode it is reached by, the basis on
 * which it is trusted, and — when it is not configured — the reason it is
 * absent.
 *
 * `config` names EXACTLY how a source is switched on — `lists` for an
 * operator-supplied URL list, `flag` for an `=on` opt-in, `keys` for a
 * credential. The three are declared per source rather than inferred from the
 * env-var name, because an inferred rule is a rule that silently stops
 * applying when somebody renames a variable.
 *
 * @type {ReadonlyArray<object>}
 */
export const NEWS_SOURCES = Object.freeze([
  Object.freeze({
    id: "rss-atom",
    name: "RSS / Atom feeds",
    family: "rss-atom",
    url: "https://datatracker.ietf.org/doc/html/rfc4287",
    retrievalMode: RETRIEVAL_MODES.LICENSED_FEED,
    licensedBasis:
      "the publisher's own RSS/Atom feed, reached over HTTP GET with no credential. D17:241 names \"RSS/Atom\" inside the licensed/trusted set; the feed is the publisher's sanctioned distribution channel, so a feed URL is a licence grant rather than a scrape.",
    purpose: "headline-level news for the digest and the 5% Sentiment expert",
    config: { lists: ["PICC_NEWS_FEEDS"], flag: null, keys: [] },
    rateLimit: "6 fetches per feed per 10 min, enforced locally before the wire (B5-strict)",
    unconfiguredReason:
      "PICC_NEWS_FEEDS is empty or holds no absolute http(s) URL, so no feed is configured. This is an ABSENCE, not a quiet period: nothing was asked of any publisher."
  }),
  Object.freeze({
    id: "gdelt",
    name: "GDELT DOC 2.0",
    family: "gdelt",
    url: "https://gdeltproject.org/",
    retrievalMode: RETRIEVAL_MODES.LICENSED_API,
    licensedBasis:
      "GDELT publishes DOC 2.0 as open data over a documented, key-less HTTP API. D17:241 names GDELT in the licensed/trusted set, and an open-data licence is the strongest form of that.",
    purpose: "global news monitoring and tone scoring",
    config: { lists: [], flag: "PICC_NEWS_GDELT", keys: [] },
    rateLimit: "~1 request / 5 s recommended by the publisher",
    unconfiguredReason:
      "PICC_NEWS_GDELT is not 'on'. GDELT needs no credential, so this absence is an operator choice rather than a missing key."
  }),
  Object.freeze({
    id: "newsapi",
    name: "NewsAPI",
    family: "newsapi",
    url: "https://newsapi.org/",
    retrievalMode: RETRIEVAL_MODES.LICENSED_API,
    licensedBasis:
      "NewsAPI is a commercial licensed news API with published developer terms. D17:241 names it first in the licensed/trusted set.",
    purpose: "licensed headline search with source attribution",
    config: { lists: [], flag: "PICC_NEWS_NEWSAPI", keys: ["NEWSAPI_API_KEY"] },
    rateLimit: "100 requests/day on the developer tier",
    unconfiguredReason:
      "NEWSAPI_API_KEY is unset, so the licensed NewsAPI leg cannot run. A source with no credential is ABSENT and is reported absent; it is never substituted with an unkeyed scrape of the same publisher."
  }),
  Object.freeze({
    id: "cryptopanic",
    name: "CryptoPanic",
    family: "cryptopanic",
    url: "https://cryptopanic.com/",
    retrievalMode: RETRIEVAL_MODES.LICENSED_WEBSOCKET,
    licensedBasis:
      "CryptoPanic is a licensed crypto news/asset API with a realtime stream. D17:241 names it and D17:241's parenthetical \"over API/WebSocket\" names the transport.",
    purpose: "crypto asset-news stream for the crypto leg of the digest",
    config: { lists: [], flag: "PICC_NEWS_CRYPTOPANIC", keys: ["CRYPTOPANIC_AUTH_TOKEN"] },
    rateLimit: "published plan limits; the local per-source budget still applies first",
    unconfiguredReason:
      "CRYPTOPANIC_AUTH_TOKEN is unset, so the licensed CryptoPanic stream cannot authenticate and the crypto leg is absent rather than empty."
  }),
  Object.freeze({
    id: "picc-own-browser",
    name: "PICC's own browser",
    family: "picc-own-browser",
    url: "https://datatracker.ietf.org/doc/html/rfc9110",
    retrievalMode: RETRIEVAL_MODES.PICC_OWN_BROWSER,
    licensedBasis:
      "PICC's own headed/headless Chromium, operated by PICC, reading a page the operator's own session can see. D17:245: \"PICC's own browser is PICC's infrastructure and carries PICC's labeling obligations.\" The mode is recorded on every datum obtained this way precisely so the obligation is visible; it is not a licence claim about the publisher's terms.",
    purpose: "the sanctioned path for a source that publishes no API or feed",
    config: { lists: ["PICC_NEWS_BROWSER_SOURCES"], flag: null, keys: [] },
    rateLimit: "one page read per configured source per digest pass",
    unconfiguredReason:
      "PICC_NEWS_BROWSER_SOURCES names no page, so PICC's own browser was not asked to read anything. The capability exists and is DISCLOSED (D22); it is not pointed at a page, so it produced no datum."
  })
])

const SOURCES_BY_ID = new Map(NEWS_SOURCES.map((s) => [s.id, s]))
const SOURCES_BY_FAMILY = new Map(NEWS_SOURCES.map((s) => [s.family, s]))

/**
 * One declared source, by id. `null` for an unknown id — never a synthesized
 * entry, because a source nobody declared has no retrieval mode and therefore
 * cannot carry provenance.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function newsSourceById(id) {
  return SOURCES_BY_ID.get(String(id ?? "")) ?? null
}

/**
 * The declared FAMILY a datum belongs to, by id. `null` when undeclared.
 *
 * A family is where the licence claim lives; an instance id is only a label.
 * `forexlive-news` is an instance of the `rss-atom` family, so its retrieval
 * mode and licensed basis are inherited rather than asserted per feed — an
 * operator who pastes a new URL cannot mint a new licence claim by naming it.
 *
 * @param {string} family
 * @returns {object|null}
 */
export function newsSourceFamily(family) {
  return SOURCES_BY_FAMILY.get(String(family ?? "")) ?? null
}

/**
 * The reason reported when NO D17 source is configured. Named and exported so a
 * room can grep for it, a runbook can quote it, and a test can assert on it
 * without reconstructing the sentence.
 */
export const NEWS_SOURCES_ABSENT_REASON =
  "no WS-7 T18 / D17 news source is configured. RSS/Atom needs PICC_NEWS_FEEDS, GDELT needs " +
  "PICC_NEWS_GDELT=on, NewsAPI needs NEWSAPI_API_KEY, CryptoPanic needs CRYPTOPANIC_AUTH_TOKEN, and " +
  "PICC's own browser needs PICC_NEWS_BROWSER_SOURCES. This is a NAMED ABSENCE: the 5% Sentiment " +
  "expert is `unavailable` with this reason and keeps its 5% weight, rather than reading neutral " +
  "(spec :1386, D17, AC-038)."

/**
 * Read one source's configuration out of an environment-shaped object.
 *
 * Returns a NAMED state, never a boolean dressed as one: `configured: true` is
 * reachable only when this function can point at the thing that configured it,
 * and `configEvidence` names it. A credential alone is NOT enough for a
 * flag-and-key source — NewsAPI needs BOTH `PICC_NEWS_NEWSAPI=on` and a key,
 * because a key in the environment is not a decision to publish news from it.
 *
 * @param {object} source A `NEWS_SOURCES` entry.
 * @param {Record<string,string|undefined>} env
 * @returns {{id: string, name: string, retrievalMode: string, licensedBasis: string,
 *            credentialRequired: boolean, configured: boolean, configEvidence: string|null,
 *            reason: string|null}}
 */
export function resolveNewsSource(source, env = process.env) {
  const { lists = [], flag = null, keys = [] } = source.config ?? {}

  const listsPresent = lists.filter((k) => nonEmpty(env[k]))
  const listsMissing = lists.filter((k) => !nonEmpty(env[k]))
  const keysPresent = keys.filter((k) => nonEmpty(env[k]))
  const keysMissing = keys.filter((k) => !nonEmpty(env[k]))
  const flagOn = flag !== null && String(env[flag] ?? "").trim().toLowerCase() === "on"

  const evidence = [
    ...listsPresent.map((k) => `${k}=set`),
    ...keysPresent.map((k) => `${k}=set`),
    flagOn ? `${flag}=on` : null
  ].filter(Boolean)

  // Every declared knob must be satisfied. `some()` would let a configured
  // NewsAPI flag make a keyless call look licensed.
  const satisfied =
    listsMissing.length === 0 && keysMissing.length === 0 && (flag === null ? true : flagOn)
  const configured = satisfied && evidence.length > 0

  const absentBecause = [
    ...listsMissing.map((k) => `${k} unset`),
    ...keysMissing.map((k) => `${k} unset`),
    flag !== null && !flagOn ? `${flag} is not "on"` : null
  ].filter(Boolean)

  return Object.freeze({
    id: source.id,
    name: source.name,
    retrievalMode: source.retrievalMode,
    licensedBasis: source.licensedBasis,
    // Derived from the declared keys rather than restated, so the room's "Key?"
    // column and the resolver can never disagree about whether a key exists.
    credentialRequired: keys.length > 0,
    configured,
    configEvidence: configured ? evidence.join(" + ") : null,
    reason: configured ? null : reasonFor(source, absentBecause)
  })
}

function reasonFor(source, absentBecause) {
  const why = absentBecause.length > 0 ? `${absentBecause.join("; ")}.` : "no enabling configuration was found."
  return `${source.unconfiguredReason} (observed: ${why}) This is an absence, not a neutral reading.`
}

function nonEmpty(v) {
  return typeof v === "string" ? v.trim().length > 0 : false
}

/**
 * Resolve every declared source against an environment.
 *
 * `absentReason` is non-null exactly when NOTHING is configured, which is the
 * single fact the digest, `sentimentEngine.mjs`, the Copilot producer and the
 * Settings room all need and all previously answered separately.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {{sources: ReadonlyArray<object>, configuredCount: number,
 *            configuredIds: ReadonlyArray<string>, absentReason: string|null,
 *            retrievalModes: ReadonlyArray<string>}}
 */
export function resolveNewsSources(env = process.env) {
  const sources = NEWS_SOURCES.map((s) => resolveNewsSource(s, env))
  const configured = sources.filter((s) => s.configured)
  return Object.freeze({
    sources: Object.freeze(sources),
    configuredCount: configured.length,
    configuredIds: Object.freeze(configured.map((s) => s.id)),
    absentReason: configured.length === 0 ? NEWS_SOURCES_ABSENT_REASON : null,
    retrievalModes: Object.freeze(configured.map((s) => s.retrievalMode))
  })
}

/**
 * Reject a configured source whose URL is a D17-prohibited target.
 *
 * This is the runtime half of AC-039. The guard half pins the DEPENDENCY; this
 * half pins the OPERATOR's paste, which no manifest check can see. An operator
 * who puts a prohibited host in `PICC_NEWS_FEEDS` gets a named refusal, not a
 * silent success.
 *
 * @param {string} url
 * @returns {{url: string, permitted: boolean, prohibitedTarget: string|null}}
 */
export function classifySourceUrl(url) {
  const text = typeof url === "string" ? url.trim() : ""
  const prohibitedTarget = prohibitedHostFor(text)
  return Object.freeze({
    url: text,
    permitted: text.length > 0 && prohibitedTarget === null,
    prohibitedTarget
  })
}

/**
 * Build one datum. Every field is required; the function throws rather than
 * emitting a datum with a hole in it, because a datum with a hole is what
 * AC-038's "a datum may not appear without provenance" forbids.
 *
 * `family` is where the licence claim comes from. It defaults to `sourceId`, so
 * a datum from a declared source needs no family; pass it explicitly for an
 * INSTANCE of a declared family (one RSS/Atom feed, one browser-read page),
 * where `sourceId` is the operator's label for that instance and inherits the
 * family's retrieval mode and licensed basis rather than asserting its own.
 *
 * `verified` is `boolean | null` and is checked as such — a datum cannot carry
 * `0`, `""` or a coerced `false` for "we did not check", because those are
 * indistinguishable on the far side from a measured `false`.
 *
 * @param {object} d
 * @param {string} d.sourceId A declared source id, OR the instance label.
 * @param {string} [d.family] The declared family supplying the licence claim.
 * @param {string} [d.sourceName] Display label; defaults to the family's name.
 * @param {string} d.text The headline or snippet. Non-empty after trim.
 * @param {string} d.retrievedAt ISO-8601 string, or `null` when not retrieved.
 * @param {boolean|null} [d.verified] `null` = not verified.
 * @param {string} [d.sourceUrl]
 * @param {string} [d.publishedAt]
 * @returns {Readonly<object>} A frozen, fully-provenanced datum.
 */
export function makeDatum({
  sourceId,
  family = sourceId,
  sourceName = null,
  text,
  retrievedAt,
  verified = null,
  sourceUrl = null,
  publishedAt = null
} = {}) {
  const basis = newsSourceFamily(family) ?? newsSourceById(family)
  if (basis === null) {
    throw new Error(
      `newsSources: "${String(family ?? sourceId)}" is not a declared D17 source or family. A datum from an ` +
        `undeclared source has no retrieval mode, so it cannot carry provenance and is refused (D17, AC-038).`
    )
  }
  const label = String(sourceId ?? "").trim()
  if (label.length === 0) {
    throw new Error(`newsSources: a ${basis.id} datum needs a source id - the instance it came from.`)
  }
  const body = typeof text === "string" ? text.trim() : ""
  if (body.length === 0) {
    throw new Error(
      `newsSources: a datum from "${label}" carried no text. An empty string is how "no signal" and "measured calm" become the same value, so it is refused rather than stored.`
    )
  }
  if (retrievedAt !== null && (typeof retrievedAt !== "string" || !Number.isFinite(Date.parse(retrievedAt)))) {
    throw new Error(
      `newsSources: retrievedAt must be an ISO-8601 string or null (meaning "not retrieved"); received ${JSON.stringify(retrievedAt ?? null)}`
    )
  }
  if (verified !== null && typeof verified !== "boolean") {
    throw new Error(
      `newsSources: verified must be a boolean or null, never a number - T10's observed: boolean | null discipline, because a projection has nowhere honest to put a 0. Received ${JSON.stringify(verified)}`
    )
  }
  return Object.freeze({
    source: label,
    sourceName: sourceName ?? basis.name,
    sourceFamily: basis.id,
    retrievalMode: basis.retrievalMode,
    licensedBasis: basis.licensedBasis,
    retrievedAt,
    verified,
    text: body,
    sourceUrl: sourceUrl ?? null,
    publishedAt: publishedAt ?? null
  })
}

/**
 * THE PROVENANCE ASSERTION AS A FUNCTION, so AC-038's "every datum carries
 * source and retrieval mode" is a predicate rather than a convention that a
 * later edit can quietly stop satisfying.
 *
 * @param {unknown} datum
 * @returns {boolean} true only for a fully-provenanced datum.
 */
export function hasProvenance(datum) {
  if (datum === null || typeof datum !== "object") return false
  const d = /** @type {Record<string, unknown>} */ (datum)
  return (
    typeof d.source === "string" &&
    d.source.length > 0 &&
    typeof d.sourceFamily === "string" &&
    SOURCES_BY_FAMILY.has(d.sourceFamily) &&
    typeof d.retrievalMode === "string" &&
    MODE_VALUES.has(d.retrievalMode) &&
    typeof d.licensedBasis === "string" &&
    d.licensedBasis.length > 0 &&
    typeof d.text === "string" &&
    d.text.length > 0 &&
    (d.retrievedAt === null || typeof d.retrievedAt === "string") &&
    (d.verified === null || typeof d.verified === "boolean")
  )
}

/** Why a datum has no provenance, or `null` when it has all of it. */
export function provenanceGap(datum) {
  if (hasProvenance(datum)) return null
  if (datum === null || datum === undefined) return "the datum is null - an absent source, not a datum"
  if (typeof datum !== "object") return `the datum is a ${typeof datum}, not a provenanced object`
  const d = /** @type {Record<string, unknown>} */ (datum)
  const missing = []
  if (typeof d.source !== "string" || d.source.length === 0) missing.push("source")
  if (typeof d.sourceFamily !== "string" || !SOURCES_BY_FAMILY.has(d.sourceFamily)) missing.push("sourceFamily")
  if (typeof d.retrievalMode !== "string" || !MODE_VALUES.has(d.retrievalMode)) missing.push("retrievalMode")
  if (typeof d.licensedBasis !== "string" || d.licensedBasis.length === 0) missing.push("licensedBasis")
  if (typeof d.text !== "string" || d.text.length === 0) missing.push("text")
  if (missing.length === 0) missing.push("retrievedAt/verified shape")
  return `missing provenance: ${missing.join(", ")}`
}

/**
 * The headline strings a Copilot sentiment read consumes, in datum order.
 *
 * T13's `sentimentModel.read()` refuses an empty or missing headline array
 * (`modelLayer/sentimentModel.mjs:114-120`) rather than inferring over nothing,
 * so an absent source must arrive as `[]` WITH a reason beside it, never as a
 * plausible-looking string.
 *
 * @param {ReadonlyArray<object>} datums
 * @returns {{headlines: string[], datums: object[], unprovenanced: string[]}}
 */
export function headlinesFrom(datums) {
  const list = Array.isArray(datums) ? datums : []
  const good = []
  const unprovenanced = []
  for (const d of list) {
    const gap = provenanceGap(d)
    if (gap === null) good.push(d)
    else unprovenanced.push(gap)
  }
  return {
    headlines: good.map((d) => d.text),
    datums: good,
    // Named, and NOT dropped: a datum that cannot be provenanced is reported,
    // because silently discarding it would make the digest look cleaner than
    // the source is.
    unprovenanced
  }
}

/**
 * Rows for the Settings room's Integrations table, derived from THIS registry
 * so the room and the engine cannot disagree about what is configured.
 *
 * The room already renders source / purpose / free tier / rate limit / key? /
 * status (`SettingsRoom.tsx:163-188`); these rows add the two fields D17's
 * "licensed and labeled" obligation needs and that table lacked — the retrieval
 * mode and the basis on which the source is trusted.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {Array<object>}
 */
export function newsSourceRows(env = process.env) {
  return resolveNewsSources(env).sources.map((s) => {
    const declared = newsSourceById(s.id)
    return {
      id: s.id,
      ministry: "trading",
      name: s.name,
      url: declared.url,
      purpose: declared.purpose,
      retrievalMode: s.retrievalMode,
      licensedBasis: s.licensedBasis,
      boundary: {
        freeTier: s.credentialRequired ? "credentialed - see the named env var" : "key-less",
        rateLimit: declared.rateLimit,
        keyRequired: s.credentialRequired
      },
      // `state` keeps the room's existing three-value vocabulary. It is derived
      // from CONFIGURATION, never from a successful fetch: nothing here has ever
      // been probed, so a configured source reads `degraded` (set but
      // unverified) rather than `connected`, which is the same discipline T5
      // applied to Serper's badge and that the room already renders.
      state: s.configured ? "degraded" : "unconfigured",
      unconfiguredReason: s.reason,
      configEvidence: s.configEvidence
    }
  })
}