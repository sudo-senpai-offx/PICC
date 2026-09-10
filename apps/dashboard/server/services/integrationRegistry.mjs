// Per-ministry integration catalog (R9.2). Read-only: a static seed derived
// from the verified research dossier (research-live-integrations.md). Every
// source reports honest boundary metadata; state defaults to "unconfigured"
// until a probe proves otherwise (no probes today, so nothing is "connected").

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
  {
    id: "gdelt",
    ministry: "trading",
    name: "GDELT DOC 2.0",
    url: "https://gdeltproject.org/",
    purpose: "Global news monitoring, tone/sentiment scoring, event detection",
    boundary: {
      freeTier: "100% free, open data",
      rateLimit: "~1 request/5 seconds recommended",
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

/** Entries for a ministry; [] for an unknown ministry. */
export function getMinistryIntegrations(ministry) {
  return INTEGRATIONS.filter((e) => e.ministry === ministry)
}

/** Flat array of every cataloged entry. */
export function getAllIntegrations() {
  return INTEGRATIONS.slice()
}