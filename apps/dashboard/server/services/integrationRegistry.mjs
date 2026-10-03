// Per-ministry integration catalog (R9.2). Read-only: a static seed derived
// from the verified research dossier (research-live-integrations.md). Every
// source reports honest boundary metadata; state defaults to "unconfigured"
// until a probe proves otherwise (no probes today, so nothing is "connected").
//
// ---------------------------------------------------------------------------
// WS-7 T18 — THE NEWS/SENTIMENT ROWS ARE DERIVED, NOT RESTATED
// ---------------------------------------------------------------------------
//
// D17 (spec :238-245) makes licensed/licensed-feed/licensed-websocket/PICC-own-
// browser the only acceptable reach for a news datum, and `newsSources.mjs` is
// the single registry that decides it. The rows below are APPENDED from that
// registry rather than written here, for two reasons:
//
//   1. Two registries over one decision is how sentiment ingestion ended up
//      spread across three files in the first place (D17's own `Context`:
//      "sentiment/news ingestion spread across `newsDigest.mjs`,
//      `sentimentEngine.mjs`, and handler research paths").
//   2. The Settings room this feeds is the CONFIGURATION surface D17-style
//      configuration belongs in, and a room that renders a hand-copied list is
//      a room that can show an operator a source the engine no longer accepts.
//
// So the `gdelt` row that used to be hand-written here is gone: the derived
// `gdelt` row replaces it, carrying the same URL and purpose plus the two
// fields D17's "licensed and labeled" obligation needs and this catalog lacked
// — `retrievalMode` and `licensedBasis`. The catalog entry is preserved; its
// definition moved to where the decision lives.
import { newsSourceRows, publicNewsSourceRows } from "./newsSources.mjs"

const INTEGRATIONS = [
  // Trading — market data APIs
  {
    id: "twelve-data",
    ministry: "trading",
    name: "Twelve Data",
    url: "https://twelvedata.com/pricing",
    purpose: "Real-time US equities, forex, crypto, technical indicators",
    boundary: {
      freeTier: "8 API credits/min, 800/day",
      rateLimit: "8 API credits/min",
      keyRequired: true
    },
    state: "unconfigured"
  },
  {
    id: "binance-public",
    ministry: "trading",
    name: "Binance Public API",
    url: "https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md",
    purpose: "Spot market data, order book depth, trades, klines/candlesticks",
    boundary: {
      freeTier: "Weight-based limits, no key for public endpoints",
      rateLimit: "~1200 weight/min",
      keyRequired: false
    },
    state: "unconfigured"
  },

  // Earnings — income program info sources
  {
    id: "sec-edgar-xbrl",
    ministry: "earnings",
    name: "SEC EDGAR XBRL API",
    url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    purpose: "Company financial filings (10-K, 10-Q, 8-K), structured XBRL data",
    boundary: {
      freeTier: "100% free, no API key, no authentication",
      rateLimit: "Fair access; identify with a User-Agent header",
      keyRequired: false
    },
    state: "unconfigured"
  },
  {
    id: "gotcashback",
    ministry: "earnings",
    name: "GotCashback.com",
    url: "https://www.gotcashback.com/",
    purpose: "Cashback rates across 55+ portals, gift card discounts, payout terms",
    boundary: {
      freeTier: "100% free, no API key, REST + MCP",
      rateLimit: "No published rate limit",
      keyRequired: false
    },
    state: "unconfigured"
  },
  {
    id: "affiliateroll",
    ministry: "earnings",
    name: "AffiliateRoll",
    url: "https://www.affiliateroll.com/developers",
    purpose: "Affiliate program directory with scores, commission rates, cookie durations",
    boundary: {
      freeTier: "100% free, no API key",
      rateLimit: "100 req/min/IP",
      keyRequired: false
    },
    state: "unconfigured"
  },

  // Intelligence — web research / search sources
  {
    id: "tavily",
    ministry: "intelligence",
    name: "Tavily Search",
    url: "https://docs.tavily.com/documentation/api-credits",
    purpose: "Web search, URL extraction, web mapping, AI research",
    boundary: {
      freeTier: "1,000 credits/month, keyless option available",
      rateLimit: "1,000 credits/month",
      keyRequired: false
    },
    state: "unconfigured"
  },
  {
    id: "openalex",
    ministry: "intelligence",
    name: "OpenAlex",
    url: "https://docs.openalex.org/",
    purpose: "Academic publications, authors, institutions, concepts (250M+ works)",
    boundary: {
      freeTier: "100% free, CC0 public domain",
      rateLimit: "10 req/sec polite pool",
      keyRequired: false
    },
    state: "unconfigured"
  },
  {
    id: "arxiv",
    ministry: "intelligence",
    name: "arXiv API",
    url: "https://info.arxiv.org/help/api/index.html",
    purpose: "Academic paper search, abstracts, metadata (CS, physics, math, finance)",
    boundary: {
      freeTier: "100% free, no key",
      rateLimit: "3-second recommended delay between requests",
      keyRequired: false
    },
    state: "unconfigured"
  }
]

/**
 * Entries for a ministry; [] for an unknown ministry.
 *
 * `env` is read at CALL time, not at import time, so the room answers for the
 * configuration that is actually in force when the question is asked rather than
 * for whatever the process happened to hold at boot.
 *
 * THIS IS THE AUTHENTICATED SHAPE, for the same reason `getAllIntegrations` is:
 * the derived rows carry `state` and `configEvidence`. An ungated route wants
 * `getUnauthenticatedMinistryIntegrations`.
 */
export function getMinistryIntegrations(ministry, env = process.env) {
  return [...INTEGRATIONS, ...newsSourceRows(env)].filter((e) => e.ministry === ministry)
}

/**
 * Flat array of every cataloged entry, news/sentiment sources included.
 *
 * THE D17 ROWS ARE APPENDED HERE rather than merged into `INTEGRATIONS`, so the
 * static seed stays readable as the static seed it is and the derived half is
 * visibly derived.
 *
 * THIS IS THE AUTHENTICATED SHAPE. It carries `state`, `configEvidence` and the
 * observed absence clause, so it belongs ONLY behind a gate — see
 * `getUnauthenticatedIntegrations` for the projection an ungated read must serve,
 * and read that function's own comment before choosing between them.
 */
export function getAllIntegrations(env = process.env) {
  return [...INTEGRATIONS, ...newsSourceRows(env)]
}

// ---------------------------------------------------------------------------
// THE UNAUTHENTICATED PROJECTION
// ---------------------------------------------------------------------------
//
// WHAT IT REMOVES, and why each removal is a removal rather than a redaction:
//
//   * `state` on EVERY row, including the static seed's constant
//     `"unconfigured"`. The seed rows' value is not env-derived, so dropping it
//     closes nothing on its own — but leaving it would mean the ungated read
//     answered a question ("is anything configured?") that it must not answer,
//     and a projection that strips the derived half while keeping the constant
//     half is a projection nobody can describe in one sentence.
//   * `configEvidence` and the observed absence clause, on the derived rows.
//
// WHAT IT KEEPS: id, ministry, name, url, purpose, boundary, retrievalMode,
// licensedBasis, and the DECLARED absence reason. Every one of those is REFERENCE
// data - it describes the source, not this machine's configuration of it.
//
// The seed rows carry no `configEvidence` and their `boundary` is hand-written
// reference metadata, so for them the projection is the `state` drop and nothing
// else; they go through the same function so there is exactly one place where the
// rule lives.

/** The fields an unauthenticated reader never receives, named rather than inlined. */
function publicRow(row) {
  const { state, configEvidence, ...rest } = row
  return rest
}

/**
 * Every cataloged entry, projected for a read an ANONYMOUS caller may make.
 *
 * Pairs with `getAllIntegrations`, which is the same catalog WITH the
 * configuration state. A route must pick one deliberately; the two names are
 * chosen so that picking cannot happen by accident.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {Array<object>}
 */
export function getUnauthenticatedIntegrations(env = process.env) {
  return [...INTEGRATIONS.map(publicRow), ...publicNewsSourceRows(env)]
}

/**
 * One ministry's entries, projected for a read an ANONYMOUS caller may make.
 *
 * @param {string} ministry
 * @param {Record<string,string|undefined>} [env]
 * @returns {Array<object>}
 */
export function getUnauthenticatedMinistryIntegrations(ministry, env = process.env) {
  return [...INTEGRATIONS, ...publicNewsSourceRows(env)]
    .filter((e) => e.ministry === ministry)
    .map(publicRow)
}