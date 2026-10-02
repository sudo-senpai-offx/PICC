// WS-7 T18 — the SENTIMENT ENGINE over D17's source contract.
//
// ===========================================================================
// WHAT THIS FILE WAS, AND WHY EVERY DEFAULT IN IT WAS WRONG
// ===========================================================================
//
// Before T18 this module read its news through Serper and manufactured a
// neutral wherever it had nothing. There were four of them, and each is the
// same defect with a different costume:
//
//   :49  an unnormalisable symbol returned `score: 0, label: "Neutral"`;
//   :84  a thrown fetch returned `score: 0, bullish: 0, ...`;
//   :90  an empty history returned `avgScore = 0`;
//   :92  a one-entry history returned `velocity = 0`.
//
// All four are the fabrication D17 forbids and T18's bisect line names: "The
// sentiment expert degrades to `unavailable` with a reason when sources are
// absent; it never defaults to neutral" (spec :1386). A `0` on a [-1, +1]
// band is indistinguishable from a MEASURED neutral, and every consumer —
// `adaptiveConfluence.mjs`, the Copilot's 5% expert, a room — reads the two
// identically.
//
// So the absence is now a NAMED shape with a reason, on the same pattern the
// rest of this branch established: T14's four-state delivery machine, T13's
// `input: null`, T10's `observed: boolean | null`. Nothing here is `0` unless a
// publisher or a prior measurement produced it.
//
// ===========================================================================
// SERPER IS NOT A D17 SENTIMENT SOURCE — AND IT IS NOT REMOVED
// ===========================================================================
//
// This module no longer imports `serper.mjs`, and that is NOT T5 re-deciding
// Serper's existence. AC-017/T5 resolved Serper by making the documentation
// tell the truth: Serper is live in `amazon.mjs`, `/api/trading/news`, the
// handler research paths and `agents/picc_agents/crew.py`, and T5b corrected
// `PICC.md` to say so. It stays live.
//
// What D17:241 decides is narrower and its own list forces it: the permitted
// news sources are "NewsAPI, GDELT, CryptoPanic, RSS/Atom" plus "PICC's own
// headed/headless browser", and Serper is none of those. The 2026-09-13 owner
// decision recorded at `newsDigest.mjs:1-15` had already replaced Serper for
// the digest — "Serper is REPLACED, never supplemented". So the sentiment
// engine moves onto `newsSources.mjs`'s registry and Serper keeps its other
// jobs. The reasoning is recorded in `newsSources.mjs`'s header, and the
// observable consequence is this file's import list.
//
// ===========================================================================
// NO SERPER, NO FABRICATION, AND STILL NO CLOCK WE TRUST
// ===========================================================================
//
// `now` is a parameter with one honest default (`Date.now()`) and is threaded
// through the digest so a reading is reproducible from its inputs. The score
// arithmetic is unchanged from the pre-T18 engine — the lexicon and the 0.6/0.4
// leg weights are NOT T18's subject, and restating them would be unrequested
// refactoring. What changed is that a leg now has to EXIST before it
// contributes, and the composite refuses to be computed from a partial pair
// rather than quietly rescaling itself over the leg that is there.
//
// THE COMPOSITE IS NOT RENORMALISED. If one leg is absent the composite is
// `null` with a reason naming the missing leg. Re-weighting the survivor would
// produce a number on a different scale wearing the same label — the exact move
// AC-030's prohibition names, one layer up from the Copilot.

import { localStore } from "./localstore.mjs"
import { digestVerdict, newsFeedEntries, runDigest } from "./newsDigest.mjs"
import { NEWS_SOURCES_ABSENT_REASON, provenanceGap, resolveNewsSources } from "./newsSources.mjs"
// WS-7 T18: the Copilot's 5% Sentiment expert's PRODUCER, which discharges T13
// entry 0025 handoff #6 ("No caller of the sentiment reader"). It reads the SAME
// digest items this module just fetched, so wiring it costs no second fetch and
// cannot disagree about what was retrieved. `reader` is INJECTED and defaults
// to `null` — the honest default, since Needle 3 has no in-process runtime on
// this host (`modelLayer/sentimentModel.mjs:26-33`). With no reader the producer
// returns its named absence, T11's expert stays unavailable with its own reason,
// and the 95% still scores with an honest confidence penalty.
import { buildSentimentInput } from "./copilot/sentimentSources.mjs"

const store = localStore("sentiment", { cache: {}, history: [] })

// ── Symbol normalization: EO display names / numeric IDs → canonical tickers ──
const SYMBOL_MAP = {
  "EUR/USD": "EURUSD", "EUR/USD (OTC)": "EURUSD", "EURUSD": "EURUSD",
  "GBP/USD": "GBPUSD", "GBP/USD (OTC)": "GBPUSD", "GBPUSD": "GBPUSD",
  "USD/JPY": "USDJPY", "USD/JPY (OTC)": "USDJPY", "USDJPY": "USDJPY",
  "AUD/USD": "AUDUSD", "AUD/USD (OTC)": "AUDUSD", "AUDUSD": "AUDUSD",
  "USD/CAD": "USDCAD", "USD/CAD (OTC)": "USDCAD", "USDCAD": "USDCAD",
  "NZD/USD": "NZDUSD", "NZD/USD (OTC)": "NZDUSD", "NZDUSD": "NZDUSD",
  "USD/CHF": "USDCHF", "USD/CHF (OTC)": "USDCHF", "USDCHF": "USDCHF",
  "EUR/GBP": "EURGBP", "EUR/JPY": "EURJPY", "GBP/JPY": "GBPJPY",
  "AUD/JPY": "AUDJPY", "EUR/AUD": "EURAUD", "EUR/CAD": "EURCAD",
  "EUR/NZD": "EURNZD", "EUR/CHF": "EURCHF", "GBP/AUD": "GBPAUD",
  "GBP/CAD": "GBPCAD", "GBP/NZD": "GBPNZD", "GBP/CHF": "GBPCHF",
  "AUD/CAD": "AUDCAD", "AUD/NZD": "AUDNZD", "AUD/CHF": "AUDCHF",
  "CAD/JPY": "CADJPY", "CHF/JPY": "CHFJPY", "NZD/JPY": "NZDJPY",
  "CAD/CHF": "CADCHF", "NZD/CHF": "NZDCHF",
  "GOLD": "XAUUSD", "XAUUSD": "XAUUSD", "Gold": "XAUUSD",
  "SILVER": "XAGUSD", "XAGUSD": "XAGUSD", "Silver": "XAGUSD",
  "BITCOIN": "BTCUSD", "BTCUSD": "BTCUSD", "Bitcoin": "BTCUSD", "BTC/USD": "BTCUSD",
  "ETHEREUM": "ETHUSD", "ETHUSD": "ETHUSD", "Ethereum": "ETHUSD", "ETH/USD": "ETHUSD",
  "OIL": "USOIL", "USOIL": "USOIL", "Crude Oil": "USOIL",
  "NASDAQ": "NASDAQ", "S&P500": "SPX500", "SP500": "SPX500",
}

/**
 * Canonical ticker, or `null` for an EO numeric ID.
 *
 * `null` MEANS "this label cannot be searched", which is an absence. The
 * pre-T18 caller turned it into a neutral; it now reports it.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeSentimentSymbol(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (SYMBOL_MAP[s]) return SYMBOL_MAP[s]
  const cleaned = s.replace(/[-]?\s*\(otc\)|[-]otc\b/gi, "").replace(/\s+/g, "").toUpperCase()
  if (SYMBOL_MAP[cleaned]) return SYMBOL_MAP[cleaned]
  // Numeric IDs (EO internal) — can't normalize, so there is no symbol to search
  if (/^\d+$/.test(cleaned)) return null
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(cleaned)) return cleaned.replace("/", "")
  if (/^[A-Z]{6}$/.test(cleaned)) return cleaned
  return cleaned.slice(0, 12) || null
}

/**
 * Sentiment for one symbol.
 *
 * The returned object always names what it does and does not have. `composite`
 * is `null` unless BOTH legs exist, so a consumer cannot mistake a partial
 * reading for a measured one.
 *
 * @param {string} symbol An EO display name or canonical ticker.
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {(args:object) => Promise<object>} [opts.fetchDigest] Injectable digest
 *   seam. A test supplies a fixed provenanced item set so the real engine runs
 *   with no network and no credentials.
 * @param {{read: (req: object) => object}|null} [opts.reader] T13's model
 *   reader. Absent by default, which yields the honest absent producer.
 * @param {number} [opts.now]
 * @returns {Promise<object>}
 */
export async function getSentiment(
  symbol,
  { env = process.env, fetchDigest, reader = null, now = Date.now() } = {}
) {
  const normalized = normalizeSentimentSymbol(symbol)
  if (normalized === null) {
    return unavailableReading(symbol, null, {
      reason:
        "the supplied symbol cannot be normalized to a canonical ticker, so there is nothing to look up. " +
        "EO numeric ids carry no ticker; this is an ABSENCE of a searchable subject, not a neutral reading of it.",
      env,
      now
    })
  }

  const cacheKey = normalized
  const cached = store.data.cache[cacheKey]
  if (cached && now - cached.timestamp < 300000) return cached

  const news = await newsLeg(normalized, { env, fetchDigest, now })
  const social = socialVolumeLeg(normalized)
  const composite = computeComposite(news, social)

  const result = {
    symbol: normalized,
    available: composite.composite !== null,
    reason: composite.reason,
    // `reason` above is the COMPOSITE's reason. The derived social leg's
    // absence never blocks a composite (see `computeComposite`) but is named
    // here so a reader knows the band was narrower than 0.6+0.4.
    socialUnavailableReason: social.reason,
    composite: composite.composite,
    news: news.leg,
    newsUnavailableReason: news.reason,
    social: social.leg,
    // The datum-level provenance, verbatim, so a reader of THIS object does not
    // have to trust the score. `provenance` is a list because there is more than
    // one source and collapsing them would lose which publisher said what.
    provenance: news.provenance,
    // Provenance gaps the digest reported. Carried so a caller can see what was
    // refused; never silently dropped, because a dropped datum makes the digest
    // look cleaner than the source is.
    unprovenanced: news.unprovenanced,
    // The Copilot's 5% expert's producer, over the SAME datums. `copilotInput`
    // is `undefined` when the producer has nothing, which is what makes T11's
    // expert report `available: false` with its own named reason rather than
    // reading neutral.
    copilot: buildSentimentInput({ datums: news.provenance, reader, env }),
    // `null` when nothing was measured. `sentimentLastUpdate()` reads THIS and
    // not `timestamp`, so "when was sentiment last observed" stays a fact
    // rather than becoming "when did this module last run".
    observedAt: composite.composite === null ? null : now,
    timestamp: now,
    history: (store.data.history || []).slice(-50)
  }

  store.data.cache[cacheKey] = result
  // Only a MEASURED composite enters the history. A row with `score: null` in a
  // series whose other rows are numbers is a hole, and a hole read as 0 by
  // `socialVolumeLeg` below would be the fifth fabrication.
  store.data.history =
    composite.composite === null
      ? store.data.history || []
      : [...(store.data.history || []), { symbol: normalized, score: composite.composite.score, timestamp: now }].slice(-500)
  store.write()
  return result
}

/**
 * When sentiment was last MEASURED, or `null` when it never has been.
 *
 * Reads `observedAt`, not `timestamp`: a cache entry created by an absent
 * reading has a timestamp and no observation, and conflating them would make an
 * unused engine look like a live one.
 */
export function sentimentLastUpdate() {
  const cacheObserved = Object.values(store.data.cache || {})
    .map((c) => Number(c?.observedAt ?? NaN))
    .filter((t) => Number.isFinite(t) && t > 0)
  const historyTs = Object.values(store.data.history || [])
    .map((h) => Number(h?.timestamp ?? NaN))
    .filter((t) => Number.isFinite(t) && t > 0)
  const stamps = [...cacheObserved, ...historyTs]
  return stamps.length ? Math.max(...stamps) : null
}

/**
 * The news leg, from D17's sources only.
 *
 * @returns {{leg: object|null, reason: string|null, provenance: object[], unprovenanced: string[]}}
 */
async function newsLeg(symbol, { env, fetchDigest, now }) {
  const { feeds } = newsFeedEntries(env)
  const resolved = resolveNewsSources(env)

  if (resolved.configuredCount === 0) {
    return { leg: null, reason: NEWS_SOURCES_ABSENT_REASON, provenance: [], unprovenanced: [] }
  }

  // An operator configured only a licensed-API source (NewsAPI, CryptoPanic)
  // and no feed. The RSS/Atom leg is then genuinely absent — there is no feed
  // list — and saying so beats fetching nothing and reporting a zero.
  if (feeds.length === 0) {
    return {
      leg: null,
      reason:
        `${resolved.configuredCount} D17 source(s) are configured but none of them is an RSS/Atom feed (PICC_NEWS_FEEDS is empty), ` +
        "so this digest pass had no feed to read. The licensed API/websocket legs have no RSS parser in this tree yet, and inventing one is not this task.",
      provenance: [],
      unprovenanced: []
    }
  }

  const digest = await (fetchDigest ? fetchDigest({ feeds, now }) : runDigest({ feeds, now }))

  const verdict = digestVerdict(digest, env)
  if (verdict.state !== "delivered") {
    return { leg: null, reason: verdict.reason, provenance: [], unprovenanced: [] }
  }

  // Only provenanced datums count. An item that lost its provenance upstream is
  // REPORTED here rather than silently scored or silently dropped.
  const usable = []
  const unprovenanced = []
  for (const item of digest.items ?? []) {
    const gap = provenanceGap(item)
    if (gap === null) {
      if (mentions(symbol, item)) usable.push(item)
    } else {
      unprovenanced.push(gap)
    }
  }

  if (usable.length === 0) {
    return {
      leg: null,
      unprovenanced,
      reason:
        unprovenanced.length > 0
          ? `${(digest.items ?? []).length} digest item(s) arrived and none of them both mentioned ${symbol} AND carried full provenance (${unprovenanced[0]}). Nothing was scored.`
          : `${verdict.items} provenanced digest item(s) were retrieved and NONE mentions ${symbol}. ` +
            "That is an absence of COVERAGE for this symbol, not a neutral reading of it: nothing published about this pair in this pass."
    }
  }

  let bullish = 0
  let bearish = 0
  let neutral = 0
  for (const item of usable) {
    const text = item.text.toLowerCase()
    if (/surge|rally|gain|bull|up|rise|soar|jump|high|record|beat|strong/.test(text)) bullish++
    else if (/drop|fall|bear|down|crash|decline|loss|weak|low|miss|slump/.test(text)) bearish++
    else neutral++
  }
  const total = bullish + bearish + neutral
  const score = Math.round(((bullish - bearish) / total) * 100) / 100

  return {
    leg: {
      score,
      bullish,
      bearish,
      neutral,
      sampleSize: usable.length,
      source: "news",
      // The retrieval modes that actually produced the scored items. D17's
      // "every datum carries source and retrieval mode", reduced to the leg.
      retrievalModes: [...new Set(usable.map((i) => i.retrievalMode))].sort(),
      sources: [...new Set(usable.map((i) => i.source))].sort(),
      // `verified: null` on every datum, so no leg can claim a publisher's
      // licence was checked. It was not.
      verified: null
    },
    reason: null,
    provenance: usable,
    unprovenanced
  }
}

/** Does a datum's text mention this symbol? The `/` and no-separator forms. */
function mentions(symbol, datum) {
  const text = String(datum?.text ?? "").toUpperCase()
  if (text.length === 0) return false
  const base = symbol.slice(0, 3)
  return text.includes(symbol) || text.includes(`${symbol.slice(0, 3)}/`) || (base.length === 3 && text.includes(base))
}

/**
 * The social-volume leg, derived from PICC's OWN measured composite history.
 *
 * With fewer than two observations there is no velocity to measure, and the leg
 * reports that. `historySize` is carried so "no history" (`0`) is
 * distinguishable from "history exists and its mean is zero" — the same
 * distinction T14 draws between `acknowledged: 0` and `attempted: 0`.
 *
 * @returns {{leg: object|null, reason: string|null}}
 */
function socialVolumeLeg(symbol) {
  const history = (store.data.history || []).filter((h) => h.symbol === symbol).slice(-20)
  if (history.length < 2) {
    return {
      leg: null,
      reason:
        `${history.length} measured composite(s) exist for ${symbol} and velocity needs at least 2. ` +
        "This is an ABSENCE of the derived signal, not a zero velocity."
    }
  }
  const avgScore = history.reduce((s, h) => s + h.score, 0) / history.length
  const velocity = history[history.length - 1].score - history[history.length - 2].score
  const score = avgScore * 0.6 + velocity * 0.4
  return {
    leg: {
      score: Math.round(score * 100) / 100,
      velocity: Math.round(velocity * 100) / 100,
      historySize: history.length,
      source: "social-derived"
    },
    reason: null
  }
}

/** The declared leg weights. Their sum is 1; the sum NEVER changes. */
const W_NEWS = 0.6
const W_SOCIAL = 0.4

/**
 * The composite, or `null` with a reason.
 *
 * NO NEUTRAL DEFAULT: with no news leg there is no score at all, because a
 * score over an absent leg is an opinion nobody had.
 *
 * NO RENORMALISATION, and this is the same rule AC-030 applies one layer down:
 * an absent leg contributes NOTHING and its declared weight stays reserved. The
 * surviving leg keeps 0.6, the composite's maximum reach shrinks to 0.6, and
 * `declaredLegWeightReached` says so out loud. Rescaling the news leg over the
 * whole 0.6+0.4 band would produce a number on a scale nobody measured — the
 * defect `expertDegradation.test.mjs:142-149` pins against a dividing-by-95
 * control.
 *
 * The social leg is a projection of this module's OWN composite history, so on
 * the first reading of a symbol it is absent BY CONSTRUCTION. Requiring both
 * legs would make the composite permanently unreachable; requiring one and
 * reserving the other's weight is what makes it reachable without inventing
 * anything.
 */
function computeComposite(news, social) {
  if (news.leg === null) {
    return {
      composite: null,
      reason:
        `no composite: the news leg is absent (${news.reason}). The social leg is a projection of ` +
        "measured composites, so there is nothing for it to project either, and a composite over an absent " +
        "leg would be a neutral nobody measured. D17: no neutral default."
    }
  }

  const socialPresent = social.leg !== null
  const score = news.leg.score * W_NEWS + (socialPresent ? social.leg.score * W_SOCIAL : 0)
  let label = "Neutral"
  if (score > 0.3) label = "Bullish"
  else if (score > 0.1) label = "Slightly Bullish"
  else if (score < -0.3) label = "Bearish"
  else if (score < -0.1) label = "Slightly Bearish"
  const extreme = Math.abs(score) > 0.5

  return {
    composite: {
      score: Math.round(score * 100) / 100,
      label,
      extreme,
      weighted: {
        news: Math.round(news.leg.score * W_NEWS * 100) / 100,
        social: socialPresent ? Math.round(social.leg.score * W_SOCIAL * 100) / 100 : null
      },
      legsPresent: socialPresent ? ["news", "social"] : ["news"],
      // The share of the declared 0.6+0.4 leg weight this composite could
      // reach. 1 with both legs, 0.6 with the derived social leg absent — so a
      // reader can see the band the label was drawn from.
      declaredLegWeightReached: socialPresent ? 1 : Math.round(W_NEWS * 100) / 100,
      // Literally false, and asserted literally in the tests. If an edit ever
      // makes it true, the seam is renormalising and AC-030 is broken.
      legWeightsRenormalised: false
    },
    reason: null
  }
}

/** The reading for a symbol that cannot even be named. */
function unavailableReading(symbol, normalized, { env, now }) {
  return {
    symbol: symbol ?? null,
    normalizedSymbol: normalized,
    available: false,
    reason:
      "the supplied symbol is not searchable, so neither leg was evaluated. No news source was asked and no history existed; " +
      "this is a named absence, not a neutral sentiment reading.",
    composite: null,
    news: null,
    newsUnavailableReason: NEWS_SOURCES_ABSENT_REASON,
    social: null,
    socialUnavailableReason: "no canonical ticker, so no composite history could be selected for it.",
    provenance: [],
    observedAt: null,
    timestamp: now,
    history: (store.data.history || []).slice(-50),
    sourcesConfigured: resolveNewsSources(env).configuredCount
  }
}