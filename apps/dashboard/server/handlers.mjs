// Shared API handlers for the PICC dashboard server (dev middleware + prod).
// Real data path: Yahoo Finance -> Monte Carlo, free-source research, hybrid
// cloud+local LLM (groq/others with automatic failover), Stripe billing,
// local JSON billing/subscription sync (Supabase removed — D8). Every
// provider degrades with an honest fallback.
import { env, providers } from "./config.mjs"
import { errorLogEnabled, recordClientReport } from "./errorLog.mjs"
import { assetsEquivalent } from "./services/assetCatalog.mjs"
import { getHistory, statsFromHistory, downsample, clampDrift, clampVol, getQuote } from "./services/yahoo.mjs"
import { researchTopic, serperVerdict } from "./services/serper.mjs"
import { chatJSON, chatText, asSuggestionArray, provider, llmConfigured } from "./services/llm.mjs"
import { defaultBudgets, governorStats, recentRows } from "./services/resourceGovernor.mjs"
import { ackStep, getRegistry, resourceCaps } from "./services/packRegistry.mjs"
import { webfetchLimits, webFetchStats, resetWebFetchLimits } from "./services/webfetch.mjs"
import { createCheckoutSession, createPortalSession, constructWebhookEvent, hasStripe } from "./services/stripe.mjs"

import { createEwalletOrder, submitEwalletOrder, walletInfo, WALLET_IDS } from "./services/ewallet.mjs"
import { createBtcpayInvoice, btcpayInvoiceStatus, hasBtcpay, btcpayNodeHealth } from "./services/btcpay.mjs"
import { getCompetitorData } from "./services/amazon.mjs"
import { fetchCashPilotSummary, fetchCashPilotDaily, fetchCashPilotBreakdown } from "./services/collectors.mjs"
import { getSnapshot, saveSnapshot } from "./services/streamSnapshot.mjs"
import { getCredentials as getVenueCredentials } from "./services/venueCredentials.mjs"
import { forecastSeries } from "./services/forecast.mjs"
import { getCryptoMarket, getCryptoPrice } from "./services/crypto.mjs"
import { yieldSnapshot } from "./services/yields.mjs"
import { schedulerStatus } from "./services/scheduler.mjs"
import { opportunityCatalog, listWorkflows, monitorBountyBoards } from "./services/opportunities.mjs"
import { extractKeywords } from "./services/keywords.mjs"
import {
  createAccount,
  loginAccount,
  verifyUser,
  revokeToken,
  getUserById,
  hasUsers,
  verifyToken
} from "./services/auth.mjs"
import {
  getProfile,
  updateProfileName,
  linkIdentity,
  unlinkIdentity,
  saveGithubOauth,
  beginGithubOauth,
  completeGithubOauth
} from "./services/profile.mjs"
import { isTable, listRows, appendRow, upsertRow, removeRow } from "./services/localstore.mjs"
import { syncSubscription } from "./services/billing.mjs"
import { runMonteCarlo } from "./monteCarlo.mjs"
import { log, createRequestId, bindRequest, unbindRequest, recordRequest, getMetrics, prometheusMetrics } from "./logger.mjs"
import {
  tradingStatus,
  predictSymbol,
  analyzeExpertOptionAsset,
  openPaperTrade,
  closePaperTrade,
  paperPositions,
  paperOverview,
  paperHistory,
  paperAnalytics,
  recentSignals,
  recordSignal,
  resolveSignal,
  signalAccuracy,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  watchlistQuotes,
  marketNews,
  scanSymbols,
  tradingAssist,
  riskOfRuin,
  getCredentials as getTradingCredentials,
  saveCredentials as saveTradingCredentials
} from "./services/trading.mjs"
import { proAnalyzeSymbol, proAnalyzeExpertOption, summarizeProAnalysis } from "./services/proanalysis.mjs"
import { subscribeLiveEO, liveEOStats, liveSnapshot, liveEOData } from "./services/liveEO.mjs"
import { subscribeLiveCCXT } from "./services/liveCCXT.mjs"
import { tradingSuiteSnapshot, bustRealtimeSuite } from "./services/realtimeSuite.mjs"
import { subscribeDecisions, subscribeU4faEvents, getDecisions, observedPayouts } from "./services/adaptiveConfluence.mjs"
import { getMarketIntel } from "./services/marketIntel.mjs"
import { ledgerHistory, ledgerStats, ledgerEngineStats, flushLedger, backtestGates } from "./services/accuracyLedger.mjs"
import {
  saveLLMSettings,
  llmSettingsView,
  PROVIDER_IDS
} from "./services/llmSettings.mjs"
import { testLLMProvider } from "./services/llm.mjs"
import {
  saveSessionCaptureSetting,
  sessionCaptureSettingsView
} from "./services/sessionCaptureSettings.mjs"
import {
  demoStatus as expertOptionDemoStatus,
  demoDeals,
  demoAnalytics,
  getAutopilotConfig,
  saveAutopilotConfig,
  getAutopilotDecisions,
  whyAutopilot,
  tradingReadiness,
} from "./services/autopilot.mjs"
import {
  listConnectors,
  getConnector,
  collectSource,
  normalizeEarnings,
  persistSnapshot,
  getLatestSnapshots,
  getHistory as getConnectorHistory,
  openLiveSession,
  subscribeLive,
  closeLiveSession,
  liveSubscriberCount
} from "./services/connectors.mjs"
import { fingerprint } from "./services/autodetect.mjs"
import { browserAvailable, realProfileState, importRealProfile } from "./services/browserBridge.mjs"
import { accountMetricsForUser, getAccountMetrics, staleFrom } from "./services/accountMetrics.mjs"
import { listCaptureProfiles, metricsCadenceMs, saveCaptureConfigForUser, captureConfigForUser, headlessSessionStatus, sessionPolicyForUser, saveSessionPolicy, clearSessionPolicy } from "./services/captureProfiles.mjs"
// Command Centre (slice 4) — the surface must read the SAME observed state the
// enforcement layer reads, so the overview + kill-switch handlers wire the
// sidecar's readers to the runtime store + audit trail at import time: a kill
// shown on a card IS the switch evaluateGate consults; a 5G duplicate check
// survives restarts through the same audit chain the panel reports on.
import { policyGraphSites } from "./services/commandCentre/policyGraphCatalog.mjs"
import {
  crossSiteHaltState,
  takeoverState,
  wireAuditReader,
  wireKillSwitchReader
} from "./services/commandCentre/safetySidecar.mjs"
import { anyKillActive, killSwitchState, setKillSwitch } from "./services/commandCentre/commandCentreRuntime.mjs"
import { readAudit } from "./services/commandCentre/auditTrail.mjs"
import { composeCommandCentreOverview } from "./services/commandCentre/commandCentreOverview.mjs"
import { executionStatus } from "./services/commandCentre/commandCentreExecution.mjs"
import {
  CCXT_ORDER_ACTION,
  CCXT_SITE,
  proposeCcxtOrder,
  executeCcxtOrder,
  verifyCcxtOrder,
  proposalOrdersFromAudit,
  limitPriceSanity
} from "./services/commandCentre/ccxtExecution.mjs"
import {
  CCXT_EQUITY_STALE_MS,
  ccxtEquityLastObserved,
  observeCcxtEquity,
  fetchReferencePrice,
  placeCcxtOrder,
  verifyCcxtFill
} from "./services/ccxtOrdering.mjs"
import { dayKeyOf } from "./services/u4faRisk.mjs"

wireKillSwitchReader(() => anyKillActive())
wireAuditReader(() => readAudit())
import {
  studioStatus,
  openStudio,
  closeStudio,
  subscribeStudio,
  latestStudioFrame,
  studioIsOpen,
  studioGoto,
  studioNav,
  studioTab,
  studioInput,
  studioOverlay,
  studioOverlayToggle,
  studioRead,
  studioAutofill,
  studioLogin,
  captureExpertOptionSession,
  maskToken,
  studioOpenSite,
  detectSite,
  studioGoogleSession,
  getVaultSites,
  getSiteCredentials,
  saveSiteCredentials,
  deleteSiteCredentials,
  getBrowserSettings,
  saveBrowserSettings,
  getSitePermissions,
  setSitePermission,
  removeSitePermissions,
  getBrowserPreferences,
  saveBrowserPreference,
  getSuitePresets,
  saveSuitePreset,
  PERMISSION_CATALOG,
  studioAutomate,
  startStudioAutomation,
  stopStudioAutomation,
  studioAutomationStatus,
  getBrowserIntel,
  studioDialog,
  studioUploadFiles,
  studioCopySelection,
  studioDownloads,
  studioDownloadFile,
  refreshLoginStates
} from "./services/browserStudio.mjs"
import { suiteForSite } from "./services/suites.mjs"
import { collectSourceStatuses } from "./services/dataSources.mjs"
import { getAllIntegrations, getMinistryIntegrations } from "./services/integrationRegistry.mjs"
import * as interventions from "./services/interventions.mjs"

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function validTier(tier) {
  return tier === "pro" || tier === "business" ? tier : null
}

/** Round to 2 decimal places (guards non-finite input like our peers). Exported for tests. */
export function round2(v) {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100
}

/**
 * Resolve the Stripe customer tied to a user WITHOUT trusting any
 * client-supplied value. Reads the profile's stripe_customer_id from the
 * local `billing` store (Supabase removed — D8). stripe_customer_id is
 * written by syncSubscription. Returns null when the user has no Stripe
 * customer on file.
 */
async function stripeCustomerForUser(userId) {
  const rows = await listRows("billing")
  const row = rows.find((b) => b.user_id === userId)
  return row?.stripe_customer_id ?? null
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error("timeout")), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// ---------------------------------------------------------------------
// CSRF / Origin protection (2025 best practice: Sec-Fetch-Site + Origin)
// ---------------------------------------------------------------------
// Trusted origins for CORS and CSRF. Only these may make credentialed requests.
const TRUSTED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000"
]

// Allowed redirect destinations for Stripe (prevents open redirect)
const ALLOWED_REDIRECT_HOSTS = ["localhost", "127.0.0.1"]

/**
 * CSRF check for state-changing requests (POST/PUT/PATCH/DELETE).
 * Uses Sec-Fetch-Site (primary) + Origin (fallback) per Filippo Valsorda's algorithm.
 * GET/HEAD/OPTIONS are always safe.
 */
function checkCsrf(req) {
  const method = (req.method ?? "GET").toUpperCase()
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true

  const origin = req.headers.origin
  const secFetchSite = req.headers["sec-fetch-site"]

  // Step 1: Check trusted origins allow-list
  if (origin && TRUSTED_ORIGINS.includes(origin)) return true

  // Step 2: Check Sec-Fetch-Site (primary defense, all browsers since 2023)
  if (secFetchSite !== undefined) {
    return secFetchSite === "same-origin" || secFetchSite === "none"
  }

  // Step 3: No browser headers at all (curl, API clients) — not a CSRF
  if (!origin) return true

  // Step 4: Fallback — compare Origin host with Host header
  try {
    const originHost = new URL(origin).host
    const reqHost = req.headers.host ?? "localhost"
    return originHost === reqHost
  } catch {
    return false
  }
}

/** Validate a redirect URL is on a trusted host (prevents open redirect). */
function isAllowedRedirect(url) {
  if (!url) return false
  try {
    const u = new URL(url)
    return ALLOWED_REDIRECT_HOSTS.includes(u.hostname)
  } catch {
    return false
  }
}

// Tiny in-memory per-key rate limiter for sensitive/costly endpoints.
const rateBuckets = new Map()
function rateLimited(key, limit, windowMs) {
  const now = Date.now()
  const list = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (list.length >= limit) {
    rateBuckets.set(key, list)
    return true
  }
  list.push(now)
  rateBuckets.set(key, list)
  return false
}

// Evict stale rate-limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, list] of rateBuckets) {
    const fresh = list.filter((t) => now - t < 300_000)
    if (fresh.length === 0) rateBuckets.delete(key)
    else rateBuckets.set(key, fresh)
  }
}, 300_000).unref()

function clientIp(req) {
  return req.socket?.remoteAddress ?? "unknown"
}

// Throttle repeated identical warnings (per-poll candle fallbacks used to
// spam the log once per consumer per poll). One emission per key per window.
const warnThrottle = new Map()
function throttledWarn(message, cooldownMs = 60_000) {
  const now = Date.now()
  if (now - (warnThrottle.get(message) ?? 0) < cooldownMs) return
  warnThrottle.set(message, now)
  console.warn(message)
}

/** True when the TCP connection originates from localhost (studio + dev-loopback routes). */
function isLocalhostRequest(req) {
  const ip = clientIp(req).replace(/^::ffff:/, "")
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost"
}

/**
 * EO asset ids are numeric strings while clients send symbols ("EURUSD",
 * "GOLD", "Bitcoin", "US30"…). Match either, with alias-aware canonical
 * comparison so broker labels like "XAU/USD" resolve to the same instrument
 * the overlay normalized to GOLD.
 */
function eoAssetMatches(a, key) {
  if (!a) return false
  const k = String(key ?? "").toLowerCase()
  if (!k) return false
  if (String(a.id) === String(key)) return true
  return assetsEquivalent(a.name, key) || assetsEquivalent(a.displayName, key)
}

function isHttpUrl(value) {
  try {
    const u = new URL(String(value))
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

function allocationFor(riskTolerance) {
  if (riskTolerance === "conservative") return { equities: 0.4, bonds: 0.45, cash: 0.15 }
  if (riskTolerance === "moderate") return { equities: 0.6, bonds: 0.3, cash: 0.1 }
  return { equities: 0.8, bonds: 0.15, cash: 0.05 }
}

function defaultAssumptions(riskTolerance, assetClass) {
  const base = {
    conservative: { drift: 0.055, vol: 0.09 },
    moderate: { drift: 0.075, vol: 0.14 },
    aggressive: { drift: 0.095, vol: 0.19 }
  }
  const assetMult = {
    bonds: { drift: -0.015, vol: -0.06 },
    reit: { drift: 0.005, vol: 0.02 },
    crypto: { drift: 0.03, vol: 0.15 }
  }
  const m = assetMult[assetClass] ?? { drift: 0, vol: 0 }
  return { drift: base[riskTolerance].drift + m.drift, vol: Math.max(0.04, base[riskTolerance].vol + m.vol) }
}

function ruleBasedListingSuggestions(title, bullets) {
  const suggestions = []
  const wordCount = title.split(/\s+/).filter(Boolean).length
  if (wordCount < 30) {
    suggestions.push({
      id: "s-title-length",
      title: "Expand product title",
      body:
        `Your title is ${wordCount} words. Amazon favours 40-60 words. ` +
        `Add the key benefit and a differentiating feature: "${title} — [primary benefit], [differentiator]".`,
      confidence: 0.72
    })
  }
  if (title.includes(",") || title.includes("&")) {
    suggestions.push({
      id: "s-title-format",
      title: "Add benefit keywords",
      body: "Front-load the most searched keyword and move brand/colour details to the middle. Lead with the benefit users search for.",
      confidence: 0.61
    })
  }
  if (bullets.length < 3) {
    suggestions.push({
      id: "s-bullets-count",
      title: "Add more bullet points",
      body: `You only have ${bullets.length} bullets. Amazon displays 5 by default — add 2 more addressing size, warranty, and use cases.`,
      confidence: 0.68
    })
  }
  for (const b of bullets) {
    if (b.length > 200) {
      suggestions.push({
        id: "s-bullet-length",
        title: "Shorten a bullet point",
        body: `One bullet exceeds 200 characters. Keep bullets to 180-200 chars, one benefit each, capitalise the first word.`,
        confidence: 0.6
      })
      break
    }
  }
  if (suggestions.length === 0) {
    suggestions.push({
      id: "s-a-plus",
      title: "Add A+ content",
      body: "Listing looks solid. Add A+ (EBC) content with a comparison chart and lifestyle images to lift conversion ~5-8%.",
      confidence: 0.58
    })
  }
  return suggestions
}

function ruleBasedContent(kind, topic, tone = "professional", length = "standard") {
  const tagList = [
    "passive income",
    topic.toLowerCase().replace(/\s+/g, "-"),
    "2026 guide",
    "beginner friendly"
  ]
  const punchy = tone === "hype" || tone === "casual"
  const headline =
    kind === "youtube_script" || kind === "short_video" || kind === "tiktok_script"
      ? punchy
        ? `I Tried ${topic} In 2026 (Honest Results)`
        : `How To Start ${topic} In 2026`
      : kind === "newsletter"
        ? `${topic}: What Changed This Week In Passive Income`
        : `How To Start ${topic} In 2026: The Complete Beginner Guide`
  const cta =
    tone === "hype"
      ? "Subscribe + smash the bell — your future self will thank you."
      : tone === "casual"
        ? "Follow along — I'll keep you posted on what actually works."
        : "Subscribe and hit the bell so you don't miss the next passive income breakdown."
  const readMinutes = length === "short" ? 4 : length === "long" ? 12 : 6
  const script =
    `Intro: "Today we're breaking down ${topic} — what it actually takes, what it really pays, ` +
    `and the mistakes beginners make. Stick around to the end for the checklist."\n\n` +
    `Body: Start with the core concept and the numbers (time, capital, expected return). ` +
    `Cover 3 common pitfalls. Show one worked example with real-ish figures.\n\n` +
    `Outro: Summary of the 3 key takeaways, then the call to action.\n\n` +
    `Publish checklist: thumbnail, title with keyword, 3-5 tags, pinned comment with the CTA link.`
  return { headline, script, tags: tagList, cta, estimatedReadMinutes: readMinutes }
}

// ---------------------------------------------------------------------
// Lightweight schema validation (zod-free)
// ---------------------------------------------------------------------

function validate(body, schema) {
  const errors = []
  for (const [key, rules] of Object.entries(schema)) {
    const val = body?.[key]
    for (const rule of rules) {
      const msg = rule(val, body)
      if (msg) errors.push(`${key}: ${msg}`)
    }
  }
  return errors.length ? errors.join("; ") : null
}

function required(val) { return val == null || val === "" ? "required" : null }
function isNumber(lo, hi) {
  return (v) => { const n = Number(v); return v != null && v !== "" && (!Number.isFinite(n) || n < lo || n > hi) ? `must be ${lo}-${hi}` : null }
}
function isString(val) { return (v) => v != null && typeof v !== "string" ? "must be a string" : null }
function oneOf(...opts) { return (v) => v != null && v !== "" && !opts.includes(v) ? `must be one of: ${opts.join(", ")}` : null }
function maxLength(n) { return (v) => typeof v === "string" && v.length > n ? `max ${n} chars` : null }

// Validation schemas for critical POST endpoints
const SCHEMAS = {
  paperTrade: {
    symbol: [required, isString()],
    side: [oneOf("up", "down")],
    entry: [required, isNumber(0, 1e12)],
    amount: [(v) => v != null && v !== "" && (Number(v) <= 0 || !Number.isFinite(Number(v))) ? "must be positive" : null],
    takeProfit: [(v) => v != null && v !== "" && Number(v) <= 0 ? "must be positive" : null],
    stopLoss: [(v) => v != null && v !== "" && Number(v) <= 0 ? "must be positive" : null]
  },
  paperClose: {
    id: [required, isString()],
    exit: [required, isNumber(0, 1e12)]
  },
  autopilot: {
    assetId: [maxLength(24)],
    duration: [isNumber(5, 43200)],
    minConfidence: [isNumber(30, 95)],
    cooldownMs: [isNumber(10000, 86400000)],
    humanReviewMs: [isNumber(0, 60000)],
    maxConcurrent: [isNumber(1, 10)],
    dailyLossLimitPct: [isNumber(1, 100)],
    maxDailyTrades: [isNumber(0, 100)],
    consecutiveLossLimit: [isNumber(1, 20)],
    consecutiveLossWindowMs: [isNumber(60000, 86400000)],
    maxCandleAgeSec: [isNumber(10, 3600)],
    assets: [
      (v) => {
        if (v == null) return null
        if (!Array.isArray(v)) return "must be an array"
        if (v.length > 20) return "max 20 assets"
        for (const a of v) {
          if (!a || typeof a !== "object") return "each asset must be an object"
          if (typeof a.assetId !== "string" || !a.assetId.trim()) return "assetId required per asset"
          if (a.assetId.length > 24) return "assetId max 24 chars"
          if (a.duration != null && a.duration !== "" && (!Number.isFinite(Number(a.duration)) || Number(a.duration) < 5 || Number(a.duration) > 43200)) return "asset duration must be 5-43200"
          if (a.amount != null && a.amount !== "" && Number(a.amount) <= 0) return "asset amount must be positive"
          if (a.minConfidence != null && a.minConfidence !== "" && (!Number.isFinite(Number(a.minConfidence)) || Number(a.minConfidence) < 30 || Number(a.minConfidence) > 95)) return "asset minConfidence must be 30-95"
        }
        return null
      }
    ]
  },
  demoPlace: {
    assetId: [required, maxLength(20)],
    type: [oneOf("call", "put")],
    amount: [(v) => v != null && v !== "" && (Number(v) <= 0 || !Number.isFinite(Number(v))) ? "must be positive" : null],
    duration: [isNumber(5, 43200)]
  },
  alertCreate: {
    symbol: [required, isString()],
    condition: [required, oneOf("price_above", "price_below", "percent_change", "rsi_above", "rsi_below", "volume_spike", "convergence_above")],
    value: [required]
  },
  signalResolve: {
    id: [required, isString()],
    resultPrice: [required, isNumber(0, 1e12)]
  },
  twinRun: {
    ticker: [required, isString(), maxLength(10)],
    capital: [(v) => v != null && v !== "" && (Number(v) <= 0 || !Number.isFinite(Number(v))) ? "must be positive" : null],
    horizonYears: [(v) => v != null && v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0) ? "must be a positive number" : null],
    simulations: [(v) => v != null && v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0) ? "must be a positive number" : null]
  },
  listingAnalyze: {
    currentTitle: [isString(), maxLength(500)]
  },
  contentGenerate: {
    topic: [required, isString(), maxLength(500)],
    kind: [oneOf("blog", "youtube_script", "short_video", "tiktok_script", "x_thread", "newsletter", "affiliate_review", "social")],
    tone: [oneOf("professional", "casual", "hype", "minimal")],
    length: [oneOf("short", "standard", "long")]
  },
  predict: {
    symbol: [required, isString(), maxLength(10)],
    days: [isNumber(1, 30)]
  },
  analyze: {
    assetId: [required, maxLength(20)],
    timeframe: [isNumber(5, 3600)],
    count: [isNumber(30, 500)],
    days: [isNumber(1, 30)]
  },
  journal: {
    symbol: [required, isString()],
    side: [oneOf("up", "down")],
    entry: [required, isNumber(0, 1e12)],
    exit: [(v) => v != null && v !== "" && Number(v) <= 0 ? "must be positive" : null],
    strategy: [isString(), maxLength(100)]
  },
  watchlistAdd: {
    symbol: [required, isString(), maxLength(10)]
  },
  watchlistRemove: {
    symbol: [required, isString(), maxLength(10)]
  },
  forecast: {
    ticker: [required, isString(), maxLength(10)],
    days: [isNumber(5, 365)]
  },
  quote: {
    tickers: [required]
  }
}

function validateOr400(res, body, schemaName) {
  const schema = SCHEMAS[schemaName]
  if (!schema) return null
  const err = validate(body, schema)
  if (err) { writeJson(res, 400, { ok: false, error: err }); return true }
  return false
}

// ---------------------------------------------------------------------
// Feature handlers
// ---------------------------------------------------------------------

async function handleTwinRun(body) {
  const {
    ticker = "VOO",
    assetClass = "stock",
    capital = 10000,
    riskTolerance = "moderate",
    horizonYears: requestedHorizon = 10,
    simulations: requestedSimulations = 10000
  } = body
  // Bound CPU-heavy inputs: unbounded simulations/horizon would let one
  // request spin the event loop for minutes.
  const horizonYears = Math.min(40, Math.max(1, Number(requestedHorizon) || 10))
  const simulations = Math.min(20000, Math.max(100, Math.round(Number(requestedSimulations) || 10000)))
  const monthlyContribution = Math.max(0, Number(body.monthlyContribution) || 0)
  const inflationRate = Math.min(0.15, Math.max(0, Number(body.inflationRate) ?? 0.025))
  const inflationAdjustContributions = Boolean(body.inflationAdjustContributions)

  const run = (drift, vol) => ({
    ...runMonteCarlo({
      capital,
      horizonYears,
      simulations,
      drift,
      vol,
      monthlyContribution,
      inflationRate,
      inflationAdjustContributions
    }),
    allocation: allocationFor(riskTolerance)
  })

  try {
    const history = await withTimeout(getHistory(ticker), 12000)
    const stats = statsFromHistory(history)
    const driftUsed = clampDrift(stats.annualizedDrift)
    const volUsed = clampVol(stats.annualizedVol)
    const projection = run(driftUsed, volUsed)
    const historical = downsample(history.dates, history.closes)

    const dividendYield = history.dividendYield ?? null
    const annualDividendEstimate = dividendYield ? Math.round(capital * dividendYield) : undefined

    let notes =
      `Projection uses real ${history.name} (${ticker}) volatility of ${(volUsed * 100).toFixed(1)}% p.a. observed over the last 5 years.` +
      (monthlyContribution > 0
        ? ` Includes ${monthlyContribution > 0 ? formatMoney(monthlyContribution) : ""} monthly contributions${inflationAdjustContributions ? " that grow with inflation" : ""}.`
        : "") +
      (dividendYield ? ` Current trailing dividend yield ${(dividendYield * 100).toFixed(2)}%.` : "") +
      " Educational only — not investment advice."
    if (llmConfigured()) {
      try {
        notes = await withTimeout(
          chatText(
            "You are PICC, a financial decision-support assistant. Give 2-3 concise sentences of plain-language commentary: what the P10/median/P90 range implies, the main risk, and one balanced takeaway. Do not give personalized investment advice.",
            `Asset: ${ticker} (${history.name}), last price ${history.currency} ${history.lastPrice}. ` +
              `Observed annualized drift ${(driftUsed * 100).toFixed(1)}%, vol ${(volUsed * 100).toFixed(1)}%. ` +
              `Starting capital ${capital}, monthly contributions ${monthlyContribution}, ${horizonYears} years, ${simulations} paths, inflation assumption ${(inflationRate * 100).toFixed(1)}%. ` +
              `P10 ${projection.p10}, median ${projection.medianEnd}, P90 ${projection.p90}; inflation-adjusted median ${projection.medianEndReal}; win rate ${(projection.winRate * 100).toFixed(0)}%; median max drawdown ${(projection.maxDrawdownP50 * 100).toFixed(0)}%.`
          ),
          20000
        )
      } catch {
        /* keep fallback notes */
      }
    }

    return {
      source: "yahoo",
      ticker: history.symbol,
      name: history.name,
      currency: history.currency,
      lastPrice: history.lastPrice,
      annualizedDrift: driftUsed,
      annualizedVol: volUsed,
      ...(dividendYield != null ? { dividendYield, annualDividendEstimate } : {}),
      projection,
      historical,
      notes
    }
  } catch (err) {
    const a = defaultAssumptions(riskTolerance, assetClass)
    const projection = run(a.drift, a.vol)
    return {
      source: "local",
      ticker: ticker.toUpperCase(),
      lastPrice: undefined,
      annualizedVol: a.vol,
      projection,
      notes: `Live market data for ${ticker} was unavailable (${err.message}). Using model assumptions instead. Educational only — not investment advice.`
    }
  }
}

function formatMoney(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

async function handleListingAnalyze(body) {
  const { asin = "", currentTitle = "", currentBullets = [] } = body
  const bullets = Array.isArray(currentBullets) ? currentBullets.map(String) : []

  const research = env.serperApiKey
    ? await researchTopic(currentTitle.slice(0, 60) || "amazon product listing optimization", "amazon")
    : []

  if (llmConfigured()) {
    try {
      const parsed = await withTimeout(
        chatJSON(
          "You are an Amazon listing optimization analyst. Analyze a product title and bullets and return 3-6 concrete, copy-pasteable suggestions. " +
            "Each suggestion: { id, title, body (specific and actionable, <=240 chars), confidence (0-1) }. " +
            "Focus on keyword front-loading, benefit-led bullets, CTR, and conversion. Do not claim anything about Amazon's exact algorithm.",
          `Product page: ${currentTitle}\nBullets:\n${bullets.map((b) => `- ${b}`).join("\n") || "(none)"}` +
            (research.length ? `\n\nCurrent search/news context:\n${research.map((r) => `- ${r.title}`).join("\n")}` : ""),
          { maxTokens: 1500 }
        ),
        30000
      )
      return { source: provider(), suggestions: asSuggestionArray(parsed.suggestions), research }
    } catch (err) {
      console.warn("[picc] listing AI failed, using rule engine:", err.message)
    }
  }
  return { source: "local", suggestions: ruleBasedListingSuggestions(currentTitle, bullets), research }
}

async function handleListingKeywords(body) {
  const { currentTitle = "", currentBullets = [] } = body
  const bullets = Array.isArray(currentBullets) ? currentBullets.map(String) : []

  const local = extractKeywords(currentTitle, bullets)

  if (llmConfigured() && currentTitle.trim()) {
    try {
      const parsed = await withTimeout(
        chatJSON(
          "You are an Amazon keyword researcher. Given a product title and bullet points, return JSON only: " +
            "{ longTail: array of 8 long-tail search phrases shoppers actually type (3-6 words, benefit/use-case driven), " +
            "category: array of 4 broad category keywords, searchVolumeHint: 1-3 sentence plain-language note }. " +
            "Do not invent fake search-volume numbers.",
          `Title: ${currentTitle}\nBullets:\n${bullets.map((b) => `- ${b}`).join("\n") || "(none)"}`,
          { maxTokens: 900 }
        ),
        25000
      )
      return {
        source: provider(),
        keywords: local,
        longTail: Array.isArray(parsed?.longTail) ? parsed.longTail.map(String).filter(Boolean) : [],
        category: Array.isArray(parsed?.category) ? parsed.category.map(String).filter(Boolean) : [],
        note: String(parsed?.searchVolumeHint ?? "").slice(0, 400)
      }
    } catch (err) {
      console.warn("[picc] keyword AI failed, using local extraction:", err.message)
    }
  }
  return { source: "local", keywords: local, longTail: [], category: [], note: "" }
}

async function handleListingRewrite(body) {
  const { currentTitle = "", currentBullets = [] } = body
  const bullets = Array.isArray(currentBullets) ? currentBullets.map(String) : []

  if (llmConfigured() && currentTitle.trim()) {
    try {
      const parsed = await withTimeout(
        chatJSON(
          "You are an Amazon listing copywriter. Rewrite the given listing into 3 distinct, conversion-focused alternatives. " +
            "Return JSON: { rewrites: [ { title (<=200 chars, keyword front-loaded, no ALL CAPS spam), bullets (array of exactly 5, each <=200 chars, benefit-led, first word capitalised), note (one sentence explaining the angle) } ] }. " +
            "Each alternative should have a different angle: value + use-cases, quality + specs, and lifestyle + emotional benefit.",
          `Title: ${currentTitle}\nBullets:\n${bullets.map((b) => `- ${b}`).join("\n") || "(none)"}`,
          { maxTokens: 2200 }
        ),
        35000
      )
      const rewrites = Array.isArray(parsed?.rewrites)
        ? parsed.rewrites.map((r) => ({
            title: String(r?.title ?? ""),
            bullets: Array.isArray(r?.bullets) ? r.bullets.map(String).filter(Boolean).slice(0, 5) : [],
            note: String(r?.note ?? "")
          }))
        : []
      if (rewrites.length) return { source: provider(), rewrites }
    } catch (err) {
      console.warn("[picc] rewrite AI failed, using rule engine:", err.message)
    }
  }
  return { source: "local", rewrites: ruleBasedRewrite(currentTitle, bullets) }
}

function ruleBasedRewrite(title, bullets) {
  const keyword = title.split(/\s+/)[0] ?? "your product"
  return [
    {
      title: `${keyword} — [primary benefit] for [ideal use case] · [differentiator]`,
      bullets: [
        ...bullets.slice(0, 2),
        "[Third benefit] — designed for [use case].",
        "Backed by [warranty/certification] and quality-checked.",
        "Satisfaction guaranteed — reach out before returning."
      ].slice(0, 5),
      note: "Keyword-first structure that front-loads the main search term and use case."
    }
  ]
}

async function handleContentGenerate(body) {
  const { kind = "blog", topic = "" } = body
  const tone = String(body.tone || "professional")
  const length = String(body.length || "standard")

  const research = env.serperApiKey ? await researchTopic(topic) : []

  const lengthHint =
    length === "short" ? "Keep it tight (under ~800 words, ~4 min read)."
    : length === "long" ? "Go deep (over ~2000 words, comprehensive, ~12+ min read)."
    : "Balanced depth (standard article, ~6-8 min read)."

  if (llmConfigured()) {
    try {
      const parsed = await withTimeout(
        chatJSON(
          "You are PICC, a content strategist for the passive income niche. " +
            "Return JSON: { headline, script, tags (array of <=8 short tags), cta, estimatedReadMinutes (number) }. " +
            "For youtube_script: write a timestamped talking-point script with intro/body/outro and publish checklist. " +
            "For blog: script is the article outline with section headings and talking points. " +
            "For affiliate_review: script is a balanced review structure with pros/cons. " +
            "For social / tiktok_script / x_thread: script is the post copy (<=240 chars for social, thread format for x_thread) plus hook line. " +
            "For newsletter: script is a newsletter with greeting, 3 short sections, sign-off. " +
            "For short_video: script is a 30-60s hook/body/outro script with on-screen text cues. " +
            `Tone: ${tone} (professional, casual, hype, or minimal). ${lengthHint} ` +
            "Make everything specific to the topic. No fluff.",
          `Content type: ${kind}\nTopic: ${topic}\nTone: ${tone}\nLength: ${length}\n` +
            (research.length
              ? `Recent news/search context:\n${research.map((r) => `- [${r.date || "recent"}] ${r.title}`).slice(0, 6).join("\n")}`
              : "No live research configured."),
          { maxTokens: 1800 }
        ),
        40000
      )
      return {
        source: provider(),
        kind,
        topic,
        draft: {
          headline: String(parsed.headline ?? ""),
          script: String(parsed.script ?? ""),
          tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).filter(Boolean) : [],
          cta: String(parsed.cta ?? ""),
          estimatedReadMinutes: Number(parsed.estimatedReadMinutes) || undefined
        },
        research
      }
    } catch (err) {
      console.warn("[picc] content AI failed, using rule engine:", err.message)
    }
  }
  return { source: "local", kind, topic, draft: ruleBasedContent(kind, topic, tone, length), research }
}

// ---------------------------------------------------------------------
// Unified income summary (Q5, Task 11)
// ---------------------------------------------------------------------
// Server-side aggregation for GET /api/income/overview. Keeps the honesty
// contract: an unobservable figure is `null`, never a fabricated zero.
// The server has no per-day earnings time-series, so:
//   - lifetime / today come from connector snapshots (the authoritative
//     server-side earnings signal)
//   - projectedAnnual / cashoutReady / activeCount come from stream rows
//   - monthly and daily are left empty/null (no series to derive them from)
function incomeSummaryFromServer(streams, snapshots) {
  const active = (streams || []).filter((s) => s && s.status === "active")
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)

  const snapList = (snapshots || []).filter(
    (s) =>
      s &&
      // Only count trustworthy sources: cite staleness/unconfigured/error as
      // present-but-not-counted (so an error snapshot never lands as a 0 row).
      (s.status == null || s.status === "ok") &&
      typeof s.lifetime === "number" &&
      Number.isFinite(s.lifetime) &&
      s.lifetime > 0
  )
  const lifetime = snapList.reduce((acc, s) => acc + s.lifetime, 0)
  const today = snapList.reduce((acc, s) => acc + (num(s.today) ?? 0), 0)

  const projectedAnnual = active.reduce((acc, s) => {
    const d = num(s.estimatedDaily)
    return d == null ? acc : acc + d * 365
  }, 0)

  const cashoutReady = active.filter(
    (s) => num(s.payoutThreshold) > 0 && num(s.balance) != null && s.balance >= s.payoutThreshold
  )

  return {
    monthly: null, // no trailing-30d series server-side; unobservable -> null
    lifetime: snapList.length ? lifetime : null,
    today: snapList.length ? today : null,
    activeCount: active.length,
    projectedAnnual: projectedAnnual || null,
    cashoutReady,
    daily: [] // no per-day series server-side; honest empty, not fabricated
  }
}

// ---------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------

export function isApiRequest(url) {
  return url.startsWith("/api/")
}

// Whitelist audit (A4, F5): the only timeframes the indicators endpoint can
// serve HONESTLY are the liveEO watch-period buffers (minute keys as seconds
// or their short labels) and the daily family. Chart labels with no minute
// buffer here (4h, 30m, 1wk, ...) used to fall through to a Yahoo DAILY
// series with only a console warning — reject them outright instead of
// silently serving the wrong resolution.
const INDICATOR_TIMEFRAMES = {
  daily: "daily", "1d": "daily", "86400": "daily",
  "60": "60", "300": "300", "900": "900", "3600": "3600",
  "1m": "60", "5m": "300", "15m": "900", "1h": "3600"
}
/** Canonicalize an indicators timeframe request key, or null if unsupported. */
export function canonicalIndicatorTimeframe(raw) {
  return Object.prototype.hasOwnProperty.call(INDICATOR_TIMEFRAMES, raw) ? INDICATOR_TIMEFRAMES[raw] : null
}

export async function handleApi(req, res, url) {
  // Request-ID correlation: accept client ID or generate one
  const reqId = req.headers["x-request-id"] || createRequestId()
  req.__reqId = reqId
  const startTime = Date.now()
  bindRequest(reqId, { method: req.method, path: new URL(url, "http://localhost").pathname })
  if (typeof res.setHeader === "function") res.setHeader("X-Request-Id", reqId)

  try {
    await _handleApiInner(req, res, url, reqId)
  } finally {
    const durationMs = Date.now() - startTime
    recordRequest(durationMs, res.statusCode || 200, new URL(url, "http://localhost").pathname)
    unbindRequest(reqId)
    log.debug("request completed", { reqId, method: req.method, path: new URL(url, "http://localhost").pathname, durationMs, status: res.statusCode })
  }
}

async function _handleApiInner(req, res, url, reqId) {
  // CSRF protection for state-changing requests
  if (!checkCsrf(req)) {
    writeJson(res, 403, { error: "CSRF rejected: cross-origin state-changing request blocked" })
    return
  }

  const parsed = new URL(url, `http://${req.headers.host ?? "localhost"}`)
  const path = parsed.pathname
  const auth = req.headers.authorization

  // General rate limit: 60 requests per 60 seconds per IP for all POST endpoints.
  // Checked BEFORE consuming the body so a 429 never pays the read cost.
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const generalKey = `general:${clientIp(req)}`
    if (rateLimited(generalKey, 60, 60_000)) {
      writeJson(res, 429, { error: "rate limit exceeded — try again later" })
      return true
    }
  }

  const body = path === "/api/browser/upload" ? await readBodyMax(req, 64e6) : await readBody(req)

  // Reject invalid JSON bodies on POST/PUT/PATCH
  if (body === null && ["POST", "PUT", "PATCH"].includes(req.method)) {
    writeJson(res, 400, { error: "invalid JSON in request body" })
    return
  }

  if (path === "/api/health" && (req.method === "GET" || req.method === "POST")) {
    let agents = null
    if (env.agentsUrl) {
      try {
        const r = await withTimeout(fetch(`${env.agentsUrl}/health`), 3000)
        const data = await r.json().catch(() => ({}))
        agents = { url: env.agentsUrl, ok: r.ok, ...data }
      } catch {
        agents = { url: env.agentsUrl, ok: false }
      }
    }
    writeJson(res, 200, { ok: true, version: "0.2.0", providers: providers(), serper: serperVerdict(), agents })
    return
  }

  if (path === "/api/twin/run" && req.method === "POST") {
    if (validateOr400(res, body, "twinRun")) return true
    try {
      writeJson(res, 200, await handleTwinRun(body))
    } catch (err) {
      console.error("[picc] twin failed:", err)
      writeJson(res, 500, { error: "simulation failed", detail: err.message })
    }
    return
  }

  if (path === "/api/finance/quote" && req.method === "POST") {
    const tickers = Array.isArray(body.tickers) ? body.tickers.map(String).filter(Boolean).slice(0, 20) : []
    if (tickers.length === 0) return writeJson(res, 400, { error: "tickers required" })
    const settled = await Promise.allSettled(tickers.map((t) => withTimeout(getQuote(t), 8000)))
    const quotes = {}
    settled.forEach((r, i) => {
      const symbol = tickers[i]
      if (r.status === "fulfilled") {
        quotes[symbol] = { ...r.value, ok: true }
      } else {
        quotes[symbol] = { symbol, name: symbol, currency: "", price: null, ok: false, error: r.reason?.message ?? "quote failed" }
      }
    })
    writeJson(res, 200, { quotes, source: "yahoo" })
    return
  }

  if (path === "/api/finance/forecast" && req.method === "POST") {
    if (validateOr400(res, body, "forecast")) return true
    const ticker = String(body.ticker || "").trim().toUpperCase()
    if (!ticker) return writeJson(res, 400, { error: "ticker required" })
    try {
      const history = await withTimeout(getHistory(ticker, "1y"), 12000)
      const forecast = forecastSeries(history.closes, Math.min(Math.max(Number(body.days) || 30, 5), 365))
      if (!forecast) return writeJson(res, 422, { error: "not enough price history for a forecast" })
      writeJson(res, 200, {
        symbol: history.symbol,
        name: history.name,
        currency: history.currency,
        ...forecast
      })
    } catch (err) {
      console.warn("[picc] forecast failed:", err.message)
      writeJson(res, 502, { error: "forecast service unavailable" })
    }
    return
  }

  if (path === "/api/crypto/market" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await withTimeout(getCryptoMarket(), 20000))
    } catch (err) {
      console.warn("[picc] crypto market failed:", err.message)
      writeJson(res, 502, { error: "crypto market unavailable" })
    }
    return
  }

  if (path === "/api/crypto/price" && (req.method === "GET" || req.method === "POST")) {
    const id = String(body?.coin ?? body?.id ?? "").trim()
    if (!id) return writeJson(res, 400, { error: "coin id required (e.g. bitcoin, ethereum)" })
    try {
      writeJson(res, 200, await withTimeout(getCryptoPrice(id), 15000))
    } catch (err) {
      console.warn("[picc] crypto price failed:", err.message)
      writeJson(res, 502, { error: err.message })
    }
    return
  }

  if (path === "/api/yields" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await withTimeout(yieldSnapshot(body), 20000))
    } catch (err) {
      console.warn("[picc] yields failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/scheduler/status" && (req.method === "GET" || req.method === "POST")) {
    writeJson(res, 200, schedulerStatus())
    return
  }

  // -------------------------------------------------------------------
  // Trading Suite — multi-model prediction, read-only ExpertOption bridge,
  // and a paper-trading ledger. No auto-execution of real orders.
  // -------------------------------------------------------------------
  if (path === "/api/trading/status" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await withTimeout(tradingStatus(), 8000))
    } catch (err) {
      console.warn("[picc] trading status failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  // Feed preference (T4): GET reads the mode + live legs; POST sets the mode.
  // Preference-with-fallback — a future second leg would take over when the
  // preferred one dies, so a live feed is never dropped. The studio bridge is
  // the only browser leg.
  if (path === "/api/trading/feed-mode" && (req.method === "GET" || req.method === "POST")) {
    const { getFeedMode, setFeedMode, liveEOStats } = await import("./services/liveEO.mjs")
    if (req.method === "POST") {
      const want = body?.feedMode
      if (typeof want !== "string" || !["auto", "studio"].includes(want)) {
        writeJson(res, 400, { ok: false, error: "feedMode must be auto | studio" })
        return
      }
      setFeedMode(want)
    }
    const stats = liveEOStats()
    writeJson(res, 200, {
      ok: true,
      feedMode: getFeedMode(),
      preference: getFeedMode(),
      legs: {
        studio: { alive: stats.legs.studio.lastAt > 0 && Date.now() - stats.legs.studio.lastAt < 60_000, lastAt: stats.legs.studio.lastAt }
      }
    })
    return
  }

  if (path === "/api/trading/realtime" && req.method === "GET") {
    // Cross-origin EventSource snooping guard (any website can open this from
    // a visitor's machine — reject browser-supplied foreign origins).
    const origin = req.headers.origin
    if (origin && !TRUSTED_ORIGINS.includes(String(origin))) {
      writeJson(res, 403, { error: "origin not allowed" })
      return true
    }
    const token = parsed.searchParams.get("token") ?? ""
    const ok = isLocalhostRequest(req) || (token ? Boolean(await verifyToken(token)) : !(await hasUsers()) || Boolean(await verifyUser(req.headers.authorization)))
    if (!ok) return writeJson(res, 401, { error: "authentication required" })
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    })
    const send = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch {
        /* socket gone */
      }
    }
    let detached = false
    let off = null
    let offDecisions = null
    let offU4fa = null
    let offCCXT = null
    let keepalive = null
    let suiteTimer = null
    const detach = () => {
      if (detached) return
      detached = true
      if (off) off()
      if (offDecisions) offDecisions()
      if (offU4fa) offU4fa()
      if (offCCXT) offCCXT()
      if (keepalive) clearInterval(keepalive)
      if (suiteTimer) clearInterval(suiteTimer)
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
    // Register cleanup handlers BEFORE any awaited work so a drop mid-await
    // cannot leak subscriptions / keepalive or double-detach.
    req.on("close", detach)
    res.on("close", detach)
    res.on("error", detach)
    if (res.destroyed || res.writableEnded) {
      detach()
      return true
    }
    off = subscribeLiveEO((msg) => send(msg.type, msg))
    offDecisions = subscribeDecisions((msg) => send(msg.type, msg))
    // T12/M8 — `type:"u4fa"` events ride the SAME socket as decision events
    // (no separate endpoint; the client parser routes them on the u4fa name).
    offU4fa = subscribeU4faEvents((msg) => send(msg.type, msg))
    // Slice A — CCXT exchange quotes ride the same socket with identical tick
    // shape (canonical assetId), so the chart routes them on assetId exactly
    // like EO ticks. No-op fan-out until a connected exchange polls data.
    offCCXT = subscribeLiveCCXT((msg) => send(msg.type, msg))
    keepalive = setInterval(() => {
      try {
        res.write(": ping\n\n")
      } catch {
        /* ignore */
      }
    }, 15000)
    send("ready", { ok: true })
    send("stats", liveEOStats())
    const snap = liveSnapshot()
    if (snap.status === "connected") send("snapshot", snap)
    // Fire-and-forget so the first `suite` snapshot is never delayed by a slow
    // decision recompute (getDecisions can take up to 20s when cold).
    void (async () => {
      try {
        send("decisions", await withTimeout(getDecisions(), 20000))
      } catch (err) {
        console.warn("[picc] realtime initial decisions failed:", err.message)
        send("decisions", { ok: false, error: err.message })
      }
    })()
    // Aggregated trading-suite snapshot — every metric the suite shows, kept in
    // sync continuously (paper ~4s, demo ~12s) without per-card polling.
    const sendSuite = async () => {
      try {
        // realtimeSuite now self-times-out every section (max TTL 12s), so this
        // outer guard is just a safety net above that ceiling — it must never
        // be tighter, or a single cold section drops the whole suite event.
        const suite = await withTimeout(tradingSuiteSnapshot(), 15000)
        send("suite", suite)
      } catch {
        /* next tick covers the gap */
      }
    }
    void sendSuite()
    suiteTimer = setInterval(() => void sendSuite(), 5000)
    return true
  }

  if (path === "/api/trading/decisions" && req.method === "GET") {
    const token = parsed.searchParams.get("token") ?? ""
    const ok = isLocalhostRequest(req) || (token ? Boolean(await verifyToken(token)) : !(await hasUsers()) || Boolean(await verifyUser(req.headers.authorization)))
    if (!ok) return writeJson(res, 401, { error: "authentication required" })
    try {
      writeJson(res, 200, { ok: true, ...(await withTimeout(getDecisions(), 20000)) })
    } catch (err) {
      console.warn("[picc] trading decisions failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/intel" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    try {
      writeJson(res, 200, await withTimeout(getMarketIntel(), 20000))
    } catch (err) {
      console.warn("[picc] market intel failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/ledger" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") ?? 200), 1), 1000)
    writeJson(res, 200, { ok: true, stats: ledgerStats(), engine: ledgerEngineStats(), entries: ledgerHistory(limit) })
    return
  }

  if (path === "/api/trading/ledger/backtest" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    writeJson(res, 200, await backtestGates())
    return
  }

  if (path === "/api/trading/observed-payouts" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") ?? 200), 1), 1000)
    writeJson(res, 200, await observedPayouts({ limit }))
    return
  }

  if (path === "/api/trading/ledger/flush" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const resolved = flushLedger()
    writeJson(res, 200, { ok: true, resolved: resolved.length, stats: ledgerStats() })
    return
  }

  if (path === "/api/trading/credentials" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return true
    if (req.method === "GET") {
      const creds = await getTradingCredentials()
      writeJson(res, 200, {
        ...creds,
        expertoptionToken: creds.expertoptionToken ? "••••••" : ""
      })
      return
    }
    try {
      const before = await getTradingCredentials()
      const creds = await saveTradingCredentials(body)
      // A token (re)capture must revive a dead headless EO session WITHOUT a
      // server restart (T11 live finding: authFailed is permanent until the
      // process restarts). Gated on an actual token CHANGE: re-saving the same
      // token never force-restarts a healthy session (no flap), and a
      // settings-only save (risk %, schedule) never forces either.
      // restartLiveEO soft-reconnects, preserving candle buffers.
      const nextToken = typeof body?.expertoptionToken === "string" ? body.expertoptionToken.trim() : ""
      const tokenChanged = Boolean(nextToken) && nextToken !== (before?.expertoptionToken ?? "")
      let reconnectTriggered = false
      if (tokenChanged) {
        try {
          const { restartLiveEO } = await import("./services/liveEO.mjs")
          reconnectTriggered = await restartLiveEO({ force: true })
        } catch (err) {
          console.warn("[picc] EO session refresh on token save failed:", err?.message)
        }
      }
      writeJson(res, 200, { ok: true, reconnectTriggered, ...creds, expertoptionToken: creds.expertoptionToken ? "••••••" : "" })
    } catch (err) {
      console.error("[picc] trading credentials failed:", err)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  // Phase 5 (spec T6) — account-metrics read. Every value is an OBSERVED one:
  // an absent balance is null, never a fabricated 0; a venue with no stored
  // observation is simply absent from `venues`. `stale` is derived live from
  // observedAt vs the venue's current metrics cadence (T7 prefs included).
  if (path === "/api/trading/account-metrics" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const userId = (await verifyUser(req.headers.authorization)) ?? "default"
    const venue = String(parsed.searchParams.get("venue") ?? "")
    const source = venue
      ? { [venue.toLowerCase()]: getAccountMetrics(userId, venue) }
      : accountMetricsForUser(userId)
    const venues = {}
    for (const [vid, rec] of Object.entries(source)) {
      if (!rec || typeof rec !== "object") continue
      venues[vid] = {
        ...rec,
        stale: staleFrom({ record: rec, cadenceMs: metricsCadenceMs(vid) ?? 5 * 60 * 1000 })
      }
    }
    writeJson(res, 200, { ok: true, userId, venues })
    return
  }

  // Phase 5 (spec T7) — per-user capture-config (session + metrics cadence for
  // the headless engine). Read: current user's persisted rows (venue-driven
  // defaults live in the profile table, so this ONLY reports what the user
  // changed). Write: sanitized + clamped per venue, persisted per user, and
  // applied to the RUNTIME policy seam so the scheduler honors it live.
  if (path === "/api/trading/capture-config" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return true
    const userId = (await verifyUser(req.headers.authorization)) ?? "default"
    if (req.method === "GET") {
      writeJson(res, 200, { ok: true, userId, config: captureConfigForUser(userId) })
      return
    }
    const rows = body && typeof body === "object" && !Array.isArray(body) ? body : {}
    try {
      const config = await saveCaptureConfigForUser(userId, rows)
      writeJson(res, 200, { ok: true, userId, config })
    } catch (err) {
      console.error("[picc] capture-config save failed:", err)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  // T-EDGE — first-login session policy: the persisted half of the T9 approval
  // gate. GET returns EVERY venue's decision — "approved" (Auto-sync) /
  // "rejected" (Don't sync) / "ask" (undecided, still prompting) — so the
  // channel catalog can render per-platform sync modes. POST { venueId,
  // decision } sanitizes both (unknown venue/decision → 400) and persists;
  // decision "ask" clears the row back to prompting. Same auth as
  // capture-config above.
  if (path === "/api/trading/session-policy") {
    if (!(await requireAuth(req, res))) return true
    const userId = (await verifyUser(req.headers.authorization)) ?? "default"
    if (req.method === "GET") {
      const saved = sessionPolicyForUser(userId)
      const venues = {}
      for (const p of listCaptureProfiles()) {
        const rec = saved[p.id]
        venues[p.id] = { venueId: p.id, name: p.name, decision: rec?.decision ?? "ask", at: rec?.at ?? null }
      }
      writeJson(res, 200, { ok: true, userId, venues })
      return
    }
    if (req.method === "POST") {
      const venueId = String(body?.venueId ?? "").toLowerCase()
      const decision = String(body?.decision ?? "")
      if (!listCaptureProfiles().some((p) => p.id === venueId)) {
        writeJson(res, 400, { ok: false, error: `unknown venue: ${venueId}` })
        return
      }
      if (!["approved", "rejected", "ask"].includes(decision)) {
        writeJson(res, 400, { ok: false, error: "unknown decision: expected approved | rejected | ask" })
        return
      }
      try {
        const row =
          decision === "ask" ? await clearSessionPolicy(userId, venueId) : await saveSessionPolicy(userId, venueId, decision)
        writeJson(res, 200, { ok: true, userId, venueId, decision, at: row.at })
      } catch (err) {
        console.error("[picc] session-policy save failed:", err)
        writeJson(res, 500, { ok: false, error: err.message })
      }
      return
    }
    writeJson(res, 405, { ok: false, error: "method not allowed" })
    return
  }

  // Phase 5 (spec T8 / Mechanism D) — headless-session status for the
  // studio's routing poll. Read-only + authenticated (localhost passes;
  // remote callers need a valid session token — same gate as the sibling
  // trading endpoints). Rows are the ENGINE's observed state — idle /
  // needs-credentials / not-enabled are reported honestly, never a claimed
  // session; lastMetricsAt merges the account-metrics store so the popup can
  // show capture AND metrics freshness without a second round-trip.
  if (path === "/api/trading/headless-status" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const userId = (await verifyUser(req.headers.authorization)) ?? "default"
    const metrics = accountMetricsForUser(userId)
    const rows = {}
    for (const [vid, row] of Object.entries(headlessSessionStatus())) {
      rows[vid] = {
        ...row,
        lastMetricsAt: metrics[vid]?.observedAt ?? null
      }
    }
    writeJson(res, 200, { ok: true, userId, at: new Date().toISOString(), venues: rows })
    return
  }

  // Command Centre (slice 4) — per-site overview + the runtime kill switch.
  // Every cell of the overview is OBSERVED state or an explicit "not-wired"
  // label (composeCommandCentreOverview enforces that contract); the mode
  // verdict is the real engine's renderVerdict over those observed inputs. The
  // kill switch shown here IS the store the sidecar gate reads — one switch.
  if (path === "/api/command-centre/overview" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const userId = (await verifyUser(req.headers.authorization)) ?? "default"
    const stream = String(parsed.searchParams.get("stream") ?? "").toLowerCase()
    const metricsAll = accountMetricsForUser(userId)
    const metrics = {}
    for (const site of policyGraphSites()) {
      const rec = metricsAll[site]
      metrics[site] = rec
        ? { record: rec, stale: staleFrom({ record: rec, cadenceMs: metricsCadenceMs(site) ?? 5 * 60 * 1000 }) }
        : null
    }
    // Slice 6 — trading:ccxt: the equity observation is the site's mandatory
    // 5E feed (fresh = an observation exists and is within CCXT_EQUITY_STALE_MS).
    // No observation EVER → the feeds key stays ABSENT → the overview reports
    // fresh-data as not-wired (never a silent OK). The execution leg reflects
    // the order rail: in-flight from the seam, lastExecutedAt from the audit.
    const feeds = {}
    const ccxtEquity = ccxtEquityLastObserved()
    if (ccxtEquity) {
      feeds["trading:ccxt"] = [
        { name: "ccxt-equity", ageSec: ccxtEquity.ageSec, maxAgeSec: CCXT_EQUITY_STALE_MS / 1000 }
      ]
    }
    const lastCcxtOrderAt = readAudit()
      .filter((e) => e.kind === "execution:executed" && String(e.data?.action ?? "").startsWith("ccxt:"))
      .map((e) => e.at ?? null)
      .filter(Boolean)
      .sort()
      .at(-1)
    const executionNow = executionStatus()
    const execution = {
      [CCXT_SITE]: {
        action: CCXT_ORDER_ACTION,
        power: "proposals",
        inFlight: executionNow[CCXT_SITE]?.inFlight ?? 0,
        lastExecutedAt: lastCcxtOrderAt ?? null
      }
    }
    writeJson(
      res,
      200,
      composeCommandCentreOverview({
        metrics,
        captureStatus: headlessSessionStatus(),
        haltState: crossSiteHaltState(),
        takeover: takeoverState(),
        killState: killSwitchState(),
        feeds,
        execution,
        stream: stream || undefined,
        now: Date.now()
      })
    )
    return
  }

  // POST toggles the runtime kill switch — scope is a catalog site id or
  // "global" (both sides sanitized; anything else is a 400). Every transition
  // is audited by the store itself; the response echoes the resulting state so
  // the panel can re-render from what actually happened.
  if (path === "/api/command-centre/kill-switch" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const userId = (await verifyUser(req.headers.authorization)) ?? "default"
    const scope = String(body?.scope ?? "").trim()
    const kill = body?.kill
    const validScopes = new Set(["global", ...policyGraphSites()])
    if (!validScopes.has(scope)) {
      writeJson(res, 400, { ok: false, error: `unknown scope: expected ${[...validScopes].join(" | ")}` })
      return
    }
    if (typeof kill !== "boolean") {
      writeJson(res, 400, { ok: false, error: "kill must be a boolean" })
      return
    }
    const result = setKillSwitch(scope, kill)
    writeJson(res, 200, { ok: result.ok, userId, scope, kill, state: killSwitchState() })
    return
  }

  // ---- Command Centre slice 6: CCXT order rail (trading:ccxt), one proposal
  // rail with TWO carriers. Propose runs the FULL 10-gate chain over a clamp-
  // sized, consent-bound order and records the durable proposal; carrier A
  // ("Execute via PICC") re-runs the FULL chain at click time with FRESH
  // observations (equity, reference price) and only then reaches the venue
  // through the ccxtOrdering seam — the ONLY createOrder caller in the process;
  // carrier B ("I placed it — verify") verifies the fill READ-ONLY. Order
  // parameters at execute/verify are REPLAYED from the durable proposal, never
  // re-trusted from the request body.

  // The slice-6 rail state is read at request time from the same stores the
  // enforcement layer reads: kill switch via the wired reader, breakers from
  // the cross-site halt, equity freshness + day P/L from a FRESH balance
  // observation, concurrency from the execution seam, and the reference price
  // from a fresh keyless ticker. Nothing is assumed; failures are honest.
  async function observeCcxtRailState({ exchange, symbol }) {
    const halt = crossSiteHaltState()
    const haltToday = halt && halt.dayKey === dayKeyOf(Date.now())
    const equity = await observeCcxtEquity({ exchange })
    const reference = await fetchReferencePrice({ exchange, symbol })
    const staleFeeds = []
    if (!equity.ok) {
      staleFeeds.push({ name: "ccxt-equity", ageSec: Number.POSITIVE_INFINITY, maxAgeSec: CCXT_EQUITY_STALE_MS / 1000 })
    }
    return {
      killSwitch: anyKillActive(),
      optIn: false, // proposals power: fresh per-action consent, never a standing opt-in
      breakers: {
        dailyLossHalted: haltToday && halt.breaker === "dailyLoss",
        regimeHalted: haltToday && (halt.breaker === "regime" || halt.breaker === "regimeHalted"),
        siteCapped: false
      },
      staleFeeds,
      concurrentUnits: executionStatus()[CCXT_SITE]?.inFlight ?? 0,
      dayLossPct: equity.ok ? equity.dayLossPct : null,
      equityUsd: equity.ok ? equity.equityUsd : null,
      referencePrice: reference?.price ?? null,
      equity: equity.ok ? equity : null
    }
  }

  function proposalForClientOrderId(clientOrderId) {
    return readAudit().find(
      (e) => e.kind === "proposal:created" && String(e.data?.clientOrderId ?? "") === String(clientOrderId ?? "")
    )
  }

  // GET lists the durable proposals (proposal:created audit rows) joined with
  // their honest state: open / executed / failed / verified-filled /
  // verify-unobserved, newest first.
  if (path === "/api/command-centre/orders" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    writeJson(res, 200, { ok: true, at: new Date().toISOString(), orders: proposalOrdersFromAudit(readAudit()) })
    return
  }

  // POST proposes a CCXT order. The server generates the idempotency identity
  // (clientOrderId), clamps the notional to the envelope, renders the rationale
  // and runs the FULL gate. No venue is touched here — the proposal decides
  // WHAT could be executed, and it exists so BOTH carriers act on ONE reality.
  if (path === "/api/command-centre/orders" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const consentBy = (await verifyUser(req.headers.authorization)) ?? "default"
    const exchange = String(body?.exchange ?? "").trim().toLowerCase()
    const symbol = String(body?.symbol ?? "").trim().toUpperCase()
    const side = String(body?.side ?? "").trim().toLowerCase()
    const amount = Number(body?.amount)
    const price = Number(body?.price)
    if (!exchange || !/^[a-z0-9_-]+$/.test(exchange)) {
      return writeJson(res, 400, { ok: false, error: "exchange is required (ccxt exchange id)" })
    }
    if (!symbol || !symbol.includes("/")) {
      return writeJson(res, 400, { ok: false, error: "symbol is required (ccxt BASE/QUOTE, e.g. BTC/USDT)" })
    }
    if (side !== "buy" && side !== "sell") {
      return writeJson(res, 400, { ok: false, error: "side must be buy or sell" })
    }
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0) {
      return writeJson(res, 400, { ok: false, error: "amount and price must be finite positive numbers" })
    }

    const state = await observeCcxtRailState({ exchange, symbol })
    const result = await proposeCcxtOrder({ exchange, symbol, side, amount, price, consentBy, state })
    writeJson(res, 200, {
      ok: result.ok,
      consentBy,
      gate: result.gate,
      order: result.order,
      idempotencyKey: result.idempotencyKey,
      clientOrderId: result.clientOrderId,
      at: new Date().toISOString()
    })
    return
  }

  // POST /execute — carrier A: the acting human's click IS the fresh per-action
  // consent. The order is REPLAYED from the durable proposal, the full chain
  // re-runs over FRESH observations (equity at click time, reference price,
  // kill state) and the approved limit is sanity-checked against the market;
  // only a pass reaches placeCcxtOrder (limit-only, hard-capped, env keys).
  if (path === "/api/command-centre/orders/execute" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const consentBy = (await verifyUser(req.headers.authorization)) ?? "default"
    const clientOrderId = String(body?.clientOrderId ?? "").trim()
    if (!clientOrderId) {
      return writeJson(res, 400, { ok: false, error: "clientOrderId is required — execute the exact proposal the rail recorded" })
    }
    const proposal = proposalForClientOrderId(clientOrderId)
    if (!proposal) {
      return writeJson(res, 404, { ok: false, error: `unknown proposal ${clientOrderId} — nothing durable to execute` })
    }
    const { exchange, symbol, side, amount, price } = proposal.data

    const state = await observeCcxtRailState({ exchange, symbol })
    const sanity = limitPriceSanity({ side, limitPrice: price, referencePrice: state.referencePrice })
    if (!sanity.ok) {
      // The approved limit is no longer defensible against the fresh market —
      // refused BEFORE the venue, reported as a gate-shaped fresh-data deny (5E).
      return writeJson(res, 200, {
        ok: false,
        blockedBeforeVenue: true,
        consentBy,
        gate: { allow: false, blockedBy: "fresh-data", reason: sanity.reason },
        execution: null,
        state: killSwitchState()
      })
    }

    const result = await executeCcxtOrder({
      exchange,
      symbol,
      side,
      amount,
      price,
      clientOrderId,
      consentBy,
      state,
      executor: async () =>
        placeCcxtOrder({
          exchange,
          symbol,
          side: proposal.data.side,
          amount: proposal.data.amount,
          price: proposal.data.price,
          clientOrderId
        })
    })
    writeJson(res, 200, {
      ok: result.ok,
      consentBy,
      gate: result.gate,
      execution: result.execution,
      state: killSwitchState()
    })
    return
  }

  // POST /verify — carrier B: the human performed the venue step on the
  // exchange (same proposal, same idempotencyKey). The fill is verified
  // READ-ONLY against the venue and the honest result is recorded; an
  // unobservable venue is recorded as unobserved, never a fabricated fill.
  if (path === "/api/command-centre/orders/verify" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const consentBy = (await verifyUser(req.headers.authorization)) ?? "default"
    const clientOrderId = String(body?.clientOrderId ?? "").trim()
    const venueOrderId = String(body?.orderId ?? "").trim()
    if (!clientOrderId || !venueOrderId) {
      return writeJson(res, 400, { ok: false, error: "clientOrderId and orderId (the venue's order id) are required" })
    }
    const proposal = proposalForClientOrderId(clientOrderId)
    if (!proposal) {
      return writeJson(res, 404, { ok: false, error: `unknown proposal ${clientOrderId} — nothing to verify` })
    }
    const { exchange, symbol } = proposal.data
    const result = await verifyCcxtOrder({
      exchange,
      symbol,
      orderId: venueOrderId,
      clientOrderId,
      verify: (v) => verifyCcxtFill({ exchange, symbol, orderId: v.orderId })
    })
    writeJson(res, 200, {
      ok: result.ok,
      consentBy,
      kind: result.kind,
      clientOrderId: result.clientOrderId,
      at: new Date().toISOString()
    })
    return
  }

  if (path === "/api/trading/predict" && req.method === "POST") {
    if (validateOr400(res, body, "predict")) return true
    const symbol = String(body?.symbol ?? "").trim()
    if (!symbol) return writeJson(res, 400, { error: "symbol required" })
    try {
      writeJson(res, 200, await withTimeout(predictSymbol(symbol, Number(body?.days) || 3), 15000))
    } catch (err) {
      console.warn("[picc] trading predict failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/analyze" && req.method === "POST") {
    if (validateOr400(res, body, "analyze")) return true
    const assetId = String(body?.assetId ?? "").trim()
    if (!assetId) return writeJson(res, 400, { error: "asset id required (e.g. EURUSD)" })
    try {
      writeJson(
        res,
        200,
        await withTimeout(
          analyzeExpertOptionAsset({
            assetId,
            timeframe: Number(body?.timeframe) || 60,
            count: Math.min(Math.max(Number(body?.count) || 120, 60), 500),
            horizonDays: Number(body?.days) || 3
          }),
          25000
        )
      )
    } catch (err) {
      console.warn("[picc] trading analyze failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/pro/analyze" && req.method === "POST") {
    const symbol = String(body?.symbol ?? "").trim()
    if (!symbol) return writeJson(res, 400, { error: "symbol required" })
    try {
      writeJson(
        res,
        200,
        await withTimeout(
          proAnalyzeSymbol(symbol, {
            range: String(body?.range || "2y"),
            interval: String(body?.interval || "1d"),
            horizonDays: Number(body?.days) || 3
          }),
          25000
        )
      )
    } catch (err) {
      console.warn("[picc] pro analyze failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/pro/expertoption" && req.method === "POST") {
    const assetId = String(body?.assetId ?? "").trim()
    if (!assetId) return writeJson(res, 400, { error: "asset id required (e.g. EURUSD)" })
    try {
      writeJson(
        res,
        200,
        await withTimeout(
          proAnalyzeExpertOption({
            assetId,
            timeframe: Number(body?.timeframe) || 60,
            count: Math.min(Math.max(Number(body?.count) || 240, 60), 500),
            horizonDays: Number(body?.days) || 3
          }),
          25000
        )
      )
    } catch (err) {
      console.warn("[picc] pro expertoption failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/pro/narrative" && req.method === "POST") {
    const report = body?.report
    if (!report || !report.ok) return writeJson(res, 400, { error: "pro-analysis report required" })
    try {
      writeJson(res, 200, await withTimeout(summarizeProAnalysis(report), 20000))
    } catch (err) {
      console.warn("[picc] pro narrative failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/settings/llm" && req.method === "GET") {
    writeJson(res, 200, { ok: true, ...llmSettingsView() })
    return
  }

  if (path === "/api/settings/llm" && req.method === "POST") {
    // These routes configure and echo provider credentials — never public.
    if (!(await requireAuth(req, res))) return true
    try {
      const settings = body?.settings
      if (!settings || typeof settings !== "object") {
        writeJson(res, 400, { error: "settings object required" })
        return true
      }
      await saveLLMSettings(settings)
      // Echo the MASKED view — saveLLMSettings returns raw key material, which
      // must never leave the server.
      writeJson(res, 200, { ok: true, settings: llmSettingsView() })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return true
  }

  // S6/T6.2 — PICC-side session-capture kill-switch (owner decision 2026-09-15).
  // GET stays public like sibling settings GET views (no secret material — just
  // {enabled, configured}, default-ON when untouched). POST flips the switch and
  // is auth-guarded like the other settings POST routes. The studio's capture
  // paths (browserStudio capture hooks + headlessSessionRefresh) respect the
  // same boolean.
  if (path === "/api/settings/session-capture" && req.method === "GET") {
    writeJson(res, 200, { ok: true, ...sessionCaptureSettingsView() })
    return true
  }

  if (path === "/api/settings/session-capture" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    try {
      const enabled = body?.enabled
      if (typeof enabled !== "boolean") {
        writeJson(res, 400, { error: "enabled must be a boolean" })
        return true
      }
      saveSessionCaptureSetting(enabled)
      writeJson(res, 200, { ok: true, settings: sessionCaptureSettingsView() })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return true
  }

  if (path === "/api/settings/llm/test" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const providerId = String(body?.provider ?? "").trim()
    if (!PROVIDER_IDS.includes(providerId)) {
      writeJson(res, 400, { error: "unknown provider" })
      return true
    }
    try {
      writeJson(res, 200, await withTimeout(testLLMProvider(providerId), 20000))
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return true
  }

  // G3 — Resource tab source (PICC_RESOURCE_GOVERNOR_v1.md §7). Masked by
  // construction: ledger rows are tokens+metrics only (prompt content is
  // stripped at write time). GET mirrors the sibling /api/settings/llm read;
  // no secrets cross this surface.
  if (path === "/api/settings/llm/resource" && req.method === "GET") {
    try {
      const [stats, rows] = await Promise.all([governorStats(), recentRows({ limit: 50 })])
      writeJson(res, 200, {
        ok: true,
        enabled: process.env.PICC_RESOURCE_GOVERNOR === "on",
        budgets: defaultBudgets(),
        ...stats,
        rows
      })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // S0/T0.3 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: pack registry read surface.
  // Observational only: per-step status, envelope, evidence. Rows store
  // presence flags only, never credential values ("never echoed back in full").
  // Rate limited like sibling read surfaces. The §8.5 caps ride along:
  // server env truth, read-only — a browser client must never guess them.
  if (path === "/api/packs/registry" && req.method === "GET") {
    if (rateLimited("packs", 30, 60_000)) {
      writeJson(res, 429, { error: "rate limited" })
      return true
    }
    try {
      writeJson(res, 200, { ok: true, registry: await getRegistry(), caps: resourceCaps() })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // S5/T5.1 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: the pack strip's human
  // handoff. POST /api/packs/ack is the ONLY exit from stopped-at-human over
  // HTTP: the server marks doneBy:"human", re-arms the step to idle, and the
  // next observation tick may move it to running. Auth-gated (acknowledging a
  // human handoff is administrative, like limiter resets) and rate limited.
  if (path === "/api/packs/ack" && req.method === "POST") {
    if (rateLimited("packs-ack", 10, 60_000)) {
      writeJson(res, 429, { error: "rate limited" })
      return true
    }
    if (!(await requireAuth(req, res))) return true
    const { packId, stepId } = body ?? {}
    if (!packId || !stepId) {
      writeJson(res, 400, { ok: false, error: "packId and stepId are required" })
      return true
    }
    try {
      writeJson(res, 200, { ok: true, step: await ackStep(packId, stepId) })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return true
  }

  // S3/T3.1 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: the GLOBAL webfetch
  // capability's fair-use surface. GET reads the current per-host sliding-window
  // limits + observed stats (no mutation, rate limited like sibling read
  // routes); POST resets the in-memory windows (auth-gated — clearing a
  // limiter is an administrative action).
  if (path === "/api/webfetch/limits" && req.method === "GET") {
    if (rateLimited("webfetch-limits", 30, 60_000)) {
      writeJson(res, 429, { error: "rate limited" })
      return true
    }
    try {
      writeJson(res, 200, { ok: true, limits: webfetchLimits(), stats: webFetchStats() })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  if (path === "/api/webfetch/limits/reset" && req.method === "POST") {
    if (rateLimited("webfetch-limits-reset", 10, 60_000)) {
      writeJson(res, 429, { error: "rate limited" })
      return true
    }
    if (!(await requireAuth(req, res))) return true
    try {
      resetWebFetchLimits()
      writeJson(res, 200, { ok: true, limits: webfetchLimits(), stats: webFetchStats() })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  if (path === "/api/trading/paper/trade" && req.method === "POST") {
    if (validateOr400(res, body, "paperTrade")) return
    try {
      writeJson(res, 200, { ok: true, position: await openPaperTrade(body) })
      bustRealtimeSuite()
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/paper/close" && req.method === "POST") {
    if (validateOr400(res, body, "paperClose")) return
    try {
      writeJson(res, 200, { ok: true, closed: await closePaperTrade(body) })
      bustRealtimeSuite()
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/paper/positions" && (req.method === "GET" || req.method === "POST")) {
    writeJson(res, 200, { ok: true, positions: await paperPositions() })
    return
  }

  if (path === "/api/trading/paper/overview" && req.method === "GET") {
    writeJson(res, 200, { ok: true, ...(await paperOverview()) })
    return
  }

  if (path === "/api/trading/paper/history" && (req.method === "GET" || req.method === "POST")) {
    writeJson(res, 200, { ok: true, closed: await paperHistory(Math.min(Math.max(Number(body?.limit) || 50, 1), 500)) })
    return
  }

  if (path === "/api/trading/signals" && req.method === "GET") {
    writeJson(res, 200, { ok: true, signals: await recentSignals(20) })
    return
  }

  if (path === "/api/trading/signals" && req.method === "POST") {
    try {
      writeJson(res, 200, { ok: true, signal: await recordSignal(body) })
      bustRealtimeSuite()
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/signals/resolve" && req.method === "POST") {
    if (validateOr400(res, body, "signalResolve")) return
    try {
      writeJson(res, 200, { ok: true, signal: await resolveSignal(body) })
      bustRealtimeSuite()
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/accuracy" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await signalAccuracy())
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/paper/analytics" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await withTimeout(paperAnalytics(), 20000))
    } catch (err) {
      console.warn("[picc] paper analytics failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/assist" && req.method === "POST") {
    try {
      writeJson(res, 200, await withTimeout(tradingAssist(body?.question, body?.context ?? {}), 30000))
    } catch (err) {
      console.warn("[picc] trading assist failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  // -------------------------------------------------------------------
  // ExpertOption demo trading + autopilot. Demo account only — the service
  // refuses to place trades when the account is not marked demo.
  // -------------------------------------------------------------------
  if (path === "/api/trading/demo" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await withTimeout(expertOptionDemoStatus(), 10000))
    } catch (err) {
      console.warn("[picc] expertoption demo status failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/demo/place" && req.method === "POST") {
    writeJson(res, 410, { ok: false, deprecated: true, error: "order execution removed — PICC is advisory-first" })
    return
  }

  if (path === "/api/trading/autopilot" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    try {
      writeJson(res, 200, { ok: true, config: await getAutopilotConfig() })
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/autopilot" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    if (validateOr400(res, body, "autopilot")) return true
    try {
      writeJson(res, 200, { ok: true, config: await saveAutopilotConfig(body) })
      bustRealtimeSuite()
    } catch (err) {
      console.warn("[picc] autopilot save failed:", err.message)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/autopilot/start" && req.method === "POST") {
    writeJson(res, 410, { ok: false, deprecated: true, error: "order execution removed — PICC is advisory-first" })
    return
  }

  if (path === "/api/trading/autopilot/stop" && req.method === "POST") {
    writeJson(res, 410, { ok: false, deprecated: true, error: "order execution removed — PICC is advisory-first" })
    return
  }

  if (path === "/api/trading/autopilot/decisions" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    try {
      writeJson(res, 200, getAutopilotDecisions(Math.min(Math.max(Number(parsed.searchParams.get("limit")) || 50, 1), 500)))
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/autopilot/why" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return true
    try {
      writeJson(res, 200, await whyAutopilot({ assetId: body?.assetId ?? parsed.searchParams.get("assetId") }))
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/readiness" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    try {
      writeJson(res, 200, await withTimeout(tradingReadiness(), 15000))
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/demo/analytics" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await withTimeout(demoAnalytics(), 10000))
    } catch (err) {
      console.warn("[picc] demo analytics failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/demo/deals" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await demoDeals(Math.min(Math.max(Number(body?.limit) || Number(parsed.searchParams.get("limit")) || 50, 1), 500)))
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  // Phase 15 — full export of the decision log + resolved trade history
  // (JSON or CSV) so the data can be analyzed outside the dashboard.
  if (path === "/api/trading/export" && req.method === "GET") {
    try {
      const format = String(parsed.searchParams.get("format") || "json").toLowerCase()
      const [{ getAutopilotDecisions }, { ledgerHistory }, { perAssetStats }] = await Promise.all([
        import("./services/autopilot.mjs"),
        import("./services/accuracyLedger.mjs"),
        import("./services/accuracyLedger.mjs")
      ])
      const decisions = getAutopilotDecisions(50).decisions
      const ledger = ledgerHistory(500).filter((e) => e.status === "resolved")
      const assets = perAssetStats().assets
      if (format === "csv") {
        const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`
        const lines = []
        lines.push("type,at,asset,direction,confidence,outcome,reason")
        for (const d of decisions) lines.push(["decision", d.at, d.assetId ?? "", d.direction ?? "", d.confidence ?? "", d.trade ? "trade" : "skip", d.reason].map(esc).join(","))
        for (const e of ledger) lines.push(["ledger", e.resolvedAt ?? "", e.asset ?? e.assetId ?? "", e.direction ?? "", e.winProb ?? "", e.result ?? "", ""].map(esc).join(","))
        const body = lines.join("\n")
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="picc-trading-export-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Content-Length": Buffer.byteLength(body)
        })
        res.end(body)
        return true
      }
      writeJson(res, 200, { ok: true, exportedAt: new Date().toISOString(), decisions, ledger, perAsset: assets })
      return true
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
      return true
    }
  }

  if (path === "/api/trading/watchlist" && req.method === "GET") {
    try {
      writeJson(res, 200, await withTimeout(watchlistQuotes(), 20000))
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/watchlist" && req.method === "POST") {
    try {
      writeJson(res, 200, await addToWatchlist(String(body?.symbol ?? "")))
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/watchlist" && req.method === "DELETE") {
    try {
      writeJson(res, 200, await removeFromWatchlist(String(body?.symbol ?? "")))
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/news" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(
        res,
        200,
        await withTimeout(
          marketNews({
            symbol: String(body?.symbol ?? parsed.searchParams.get("symbol") ?? "").trim() || undefined,
            query: String(body?.query ?? parsed.searchParams.get("query") ?? "").trim() || undefined,
            num: Math.min(Math.max(Number(body?.num) || 5, 1), 20)
          }),
          20000
        )
      )
    } catch (err) {
      console.warn("[picc] market news failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/scan" && req.method === "POST") {
    try {
      writeJson(
        res,
        200,
        await withTimeout(
          scanSymbols({
            symbols: Array.isArray(body?.symbols) ? body.symbols : undefined,
            horizonDays: Number(body?.days) || 3
          }),
          30000
        )
      )
    } catch (err) {
      console.warn("[picc] trading scan failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  // -------------------------------------------------------------------
  // OHLCV candle data for the chart component. Returns liveEO buffer data
  // (for EO assets) or Yahoo Finance history (for stocks/ETFs).
  // -------------------------------------------------------------------
  if (path === "/api/trading/candles" && req.method === "POST") {
    const assetId = String(body?.assetId ?? "").trim().toUpperCase()
    // Clamp relaxed to 1M (T5): brokers now resolve the request to what they
    // can SERVE and tag it — a 4h request may come back as honest 1h/1D bars
    // (timeframe 3600/86400) or source:"none", never as silent 4h mislabels.
    const timeframe = Math.min(Math.max(Number(body?.timeframe) || 60, 5), 2592000)
    // Count clamp up to 2000 (T3 — deep chart history): the market data bus
    // caps at 2000 bars; the response is shaped by what the source can SERVE,
    // so a 2000-bar request may honestly return far fewer (e.g. Yahoo 3y daily).
    const count = Math.min(Math.max(Number(body?.count) || 200, 20), 2000)
    if (!assetId) return writeJson(res, 400, { error: "assetId required" })
    // Optional source pin (T6 source dropdown / T3 preference): naming a
    // registered market-data broker slug ("expertoption", "ccxt", "yahoo", ...)
    // FORCES that source first — it wins when it serves the request, and the
    // fan-in falls through the quality order when it serves nothing
    // (sourceMode:"fallback", never a blackout). "auto"/omitted keeps the
    // quality-ordered fan-in (best/ideal source wins).
    const source = typeof body?.source === "string" ? body.source.trim() : "auto"
    const preferredSource = typeof body?.preferredSource === "string" ? body.preferredSource.trim() : null
    try {
      // Unified fan-in: EO push buffers → live EO fetch → CCXT aggregates →
      // Yahoo daily fallback. Source + staleness tagged for honest labeling.
      // A pinned `source`/`preferredSource` is tried first and falls through
      // the quality order when it serves nothing (sourceMode:"fallback").
      const { getBestCandles, listAvailableSources, getCrossSourceCandles } = await import("./services/marketDataBus.mjs")
      const { ensureWatchingAsset, feedProvenance } = await import("./services/liveEO.mjs")
      // Opt-in cross-source verification (verify:true): wraps the fan-in and
      // tags each bar with how many INDEPENDENT sources agree on it (aggregate
      // trust — "same data across multiple sources is trusted"). Off by default
      // so the standard fan-in shape and cost stay unchanged for other callers.
      const fetchCandles = body?.verify === true ? getCrossSourceCandles : getBestCandles
      const [out, availableSources] = await Promise.all([
        fetchCandles(assetId, { timeframe, count, ensureWatch: ensureWatchingAsset, source, preferredSource }),
        listAvailableSources(assetId, { timeframe })
      ])
      // Leg-level provenance when the live EO leg served: studio bridge vs
      // data-source buffer frames (mirrors dataSources.collectSourceStatuses).
      const feed = ["expertoption", "live", "buffer"].includes(out.source) ? feedProvenance() : null
      if (!out.candles.length) {
        return writeJson(res, 200, { ok: true, source: "none", feed: null, assetId, requestedTimeframe: timeframe, timeframe, resolved: false, candles: [], availableSources, sourceMode: out.sourceMode ?? "auto", sources: out.sources ?? [], verifySources: 0, verifiedCount: 0, verifiedRatio: 0 })
      }
      writeJson(res, 200, {
        ok: true,
        source: out.source,
        feed,
        stale: out.stale,
        assetId,
        requestedTimeframe: timeframe,
        timeframe: out.timeframe,
        resolved: out.resolved ?? false,
        candles: out.candles,
        // T6 — the selectable source set (additive). Frontend dropdown default:
        // "Auto" = the fan-in winner this response served.
        availableSources,
        // T2 — who won and why (additive): forced/auto/fallback mode + the
        // per-candidate option set with rank + reasons.
        sourceMode: out.sourceMode ?? "auto",
        sources: out.sources ?? [],
        // T3-additive depth tags (always present for a deterministic shape):
        historyDepth: out.historyDepth ?? out.candles.length,
        backfilled: out.backfilled ?? 0,
        historySpanMs: out.historySpanMs ?? 0,
        historySource: out.historySource ?? null,
        // Cross-source verification tags (additive; zero when verify not requested):
        verifySources: out.verifySources ?? 0,
        verifiedCount: out.verifiedCount ?? 0,
        verifiedRatio: out.verifiedRatio ?? 0
      })
    } catch (err) {
      throttledWarn(`[picc] candles failed for ${assetId}: ${err.message}`)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  // ── Advanced indicator calculations ──────────────────────────────────────
  if (req.method === "GET" && path === "/api/trading/indicators") {
    const assetId = parsed.searchParams.get("assetId") || "EURUSD"
    const tfRaw = parsed.searchParams.get("timeframe") || "daily"
    const timeframe = canonicalIndicatorTimeframe(tfRaw)
    if (timeframe == null) return writeJson(res, 400, { error: "unsupported timeframe" })
    const count = parsed.searchParams.get("count") || 200
    const safeCount = Math.min(500, Math.max(10, Number(count) || 200))

    try {
      let candles = []
      try {
        const { liveEOData } = await import("./services/liveEO.mjs")
        const data = liveEOData()
        const asset = data.assets?.find((a) => eoAssetMatches(a, assetId))
        const buffer = asset?.periods?.[timeframe] ?? []
        if (buffer.length > 0) {
          const sliced = buffer.slice(-safeCount)
          candles = sliced.map(c => ({
            time: Math.floor(Number(c.t ?? c.time ?? 0) / 1000) || Math.floor(Number(c.t ?? c.time ?? 0)),
            open: Number(c.o ?? c.open ?? c.close) || 0,
            high: Number(c.h ?? c.high ?? c.close) || 0,
            low: Number(c.l ?? c.low ?? c.close) || 0,
            close: Number(c.c ?? c.close) || 0,
            volume: Number(c.v ?? c.volume ?? 0) || 0
          })).filter(c => c.close > 0)
        }
      } catch { /* liveEO not available */ }

      if (!candles.length) {
        const { getHistory } = await import("./services/yahoo.mjs")
        console.warn(`[picc] ${assetId}: no liveEO candles — Yahoo fallback is DAILY resolution (timeframe 86400), not minute bars`)
        const history = await withTimeout(getHistory(assetId, "6mo"), 12000)
        candles = history.dates.map((ts, i) => ({
          time: Math.floor(ts / 1000),
          open: Number(history.opens[i]) || 0,
          high: Number(history.highs[i]) || 0,
          low: Number(history.lows[i]) || 0,
          close: Number(history.closes[i]) || 0,
          volume: Number(history.volumes?.[i] ?? 0) || 0,
          timeframe: 86400
        })).filter(c => c.close > 0 && c.time > 0).slice(-safeCount)
      }

      if (!candles.length) {
        writeJson(res, 404, { ok: false, error: "No candle data available" })
        return
      }

      const { computeIndicatorDashboard } = await import("./services/indicators.mjs")
      const dashboard = computeIndicatorDashboard(candles)

      writeJson(res, 200, {
        ok: true,
        assetId,
        timeframe,
        bars: dashboard.bars,
        last: dashboard.last,
        indicators: {
          ichimoku: dashboard.ichimoku,
          fibonacci: dashboard.fibonacci,
          keltner: dashboard.keltner,
          pivots: dashboard.pivots,
          volumeProfile: dashboard.volumeProfile,
          heikinAshi: dashboard.heikinAshi,
          // Also include key base indicators for context
          ema: dashboard.ema,
          atr: dashboard.atr,
          rsi: dashboard.rsi,
          bollinger: dashboard.bollinger,
          macd: dashboard.macd,
          stochastic: dashboard.stochastic,
          adx: dashboard.adx,
          alligator: dashboard.alligator,
          aroon: dashboard.aroon,
          psar: dashboard.psar,
          linearRegression: dashboard.linearRegression
        }
      })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
    return
  }

  // ── Alert Engine ──────────────────────────────────────────────────────
  if (path === "/api/trading/alerts" && req.method === "GET") {
    const { listAlerts, alertStats } = await import("./services/alertEngine.mjs")
    writeJson(res, 200, { ok: true, alerts: listAlerts(), stats: alertStats() })
    return
  }
  if (path === "/api/trading/alerts/history" && req.method === "GET") {
    const { getAlertHistory } = await import("./services/alertEngine.mjs")
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit")) || 50, 1), 200)
    const symbol = parsed.searchParams.get("symbol") || null
    writeJson(res, 200, { ok: true, history: getAlertHistory({ limit, symbol }) })
    return
  }
  if (path === "/api/trading/alerts" && req.method === "POST") {
    const { createAlert } = await import("./services/alertEngine.mjs")
    if (validateOr400(res, body, "alertCreate")) return true
    const { symbol, condition, value, message, recurring, expiresAt, band, conditions, logic } = body ?? {}
    if (!symbol || !condition || value == null) return writeJson(res, 400, { error: "symbol, condition, and value required" })
    const alert = createAlert({ symbol, condition, value: Number(value), message, recurring, expiresAt, band, conditions, logic })
    writeJson(res, 200, { ok: true, alert })
    return
  }
  if (path === "/api/trading/alerts/delete" && req.method === "POST") {
    const { deleteAlert } = await import("./services/alertEngine.mjs")
    const id = String(body?.id ?? "")
    if (!id) return writeJson(res, 400, { error: "id required" })
    writeJson(res, 200, { ok: deleteAlert(id) })
    return
  }
  if (path === "/api/trading/alerts/toggle" && req.method === "POST") {
    const { enableAlert, disableAlert } = await import("./services/alertEngine.mjs")
    const id = String(body?.id ?? "")
    const enabled = body?.enabled !== false
    if (!id) return writeJson(res, 400, { error: "id required" })
    const alert = enabled ? enableAlert(id) : disableAlert(id)
    writeJson(res, 200, { ok: true, alert })
    return
  }

  // ── Economic Calendar ─────────────────────────────────────────────────
  if (path === "/api/trading/calendar" && req.method === "GET") {
    const days = Math.min(Math.max(Number(parsed.searchParams.get("days")) || 7, 1), 30)
    const currency = parsed.searchParams.get("currency") || null
    const { getEconomicEvents, getImpactSummary } = await import("./services/economicCalendar.mjs")
    try {
      const events = await getEconomicEvents({ days, currency })
      writeJson(res, 200, { ok: true, events, summary: getImpactSummary(events) })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  // ── Portfolio Analytics ──────────────────────────────────────────────
  if (path === "/api/trading/portfolio" && req.method === "POST") {
    const symbols = Array.isArray(body?.symbols) ? body.symbols : []
    const weights = Array.isArray(body?.weights) ? body.weights : []
    const days = Math.min(Math.max(Number(body?.days) || 90, 10), 365)
    if (symbols.length < 1) return writeJson(res, 400, { error: "At least 1 symbol required" })
    if (symbols.length > 20) return writeJson(res, 400, { error: "Max 20 symbols" })
    try {
      const { computePortfolioAnalytics } = await import("./services/portfolioAnalytics.mjs")
      const result = await computePortfolioAnalytics({ symbols, weights, days })
      if (!result) return writeJson(res, 404, { error: "No data found for any of the provided symbols" })
      writeJson(res, 200, { ok: true, ...result })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  // ── Portfolio Stress Test ────────────────────────────────────────────
  if (path === "/api/trading/stress-test" && req.method === "POST") {
    const symbols = Array.isArray(body?.symbols) ? body.symbols : []
    const weights = Array.isArray(body?.weights) ? body.weights : []
    if (symbols.length < 1) return writeJson(res, 400, { error: "At least 1 symbol required" })
    try {
      const { computePortfolioAnalytics, stressTest } = await import("./services/portfolioAnalytics.mjs")
      const portfolio = await computePortfolioAnalytics({ symbols, weights, days: 90 })
      if (!portfolio) return writeJson(res, 404, { error: "No data" })
      const result = stressTest(portfolio.weights, portfolio.assets)
      writeJson(res, 200, { ok: true, ...result })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  // ── Watchlists ──────────────────────────────────────────────────────
  if (path === "/api/trading/watchlists" && req.method === "GET") {
    const { listWatchlists, fetchWatchlistPrices } = await import("./services/watchlist.mjs")
    const lists = listWatchlists()
    // Attach prices to each watchlist
    const enriched = await Promise.all(lists.map(async (wl) => {
      const prices = await fetchWatchlistPrices(wl.symbols)
      return { ...wl, prices }
    }))
    writeJson(res, 200, { ok: true, watchlists: enriched })
    return
  }
  if (path === "/api/trading/watchlists" && req.method === "POST") {
    const { createWatchlist, addToWatchlist } = await import("./services/watchlist.mjs")
    const action = body?.action
    if (action === "add") {
      const wl = addToWatchlist(body.watchlistId, body.symbol)
      return writeJson(res, wl ? 200 : 404, { ok: !!wl, watchlist: wl })
    }
    if (action === "remove") {
      const { removeFromWatchlist } = await import("./services/watchlist.mjs")
      const wl = removeFromWatchlist(body.watchlistId, body.symbol)
      return writeJson(res, wl ? 200 : 404, { ok: !!wl, watchlist: wl })
    }
    const { name, symbols } = body ?? {}
    if (!name) return writeJson(res, 400, { error: "name required" })
    const wl = createWatchlist({ name, symbols })
    writeJson(res, 200, { ok: true, watchlist: wl })
    return
  }
  if (path === "/api/trading/watchlists/delete" && req.method === "POST") {
    const { deleteWatchlist } = await import("./services/watchlist.mjs")
    const id = String(body?.id ?? "")
    if (!id) return writeJson(res, 400, { error: "id required" })
    writeJson(res, 200, { ok: deleteWatchlist(id) })
    return
  }

  // ── Screener ─────────────────────────────────────────────────────────
  if (path === "/api/trading/screener" && req.method === "POST") {
    const { screenerRun } = await import("./services/watchlist.mjs")
    try {
      const { sort, limit, minChange, maxChange, symbols } = body ?? {}
      const result = await screenerRun({ sort, limit: Math.min(Math.max(Number(limit) || 20, 1), 50), minChange, maxChange, symbols })
      writeJson(res, 200, { ok: true, ...result })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  // ── Pattern Recognition ─────────────────────────────────────────────
  if (path === "/api/trading/patterns" && req.method === "POST") {
    const symbol = String(body?.symbol ?? "EURUSD").toUpperCase()
    const timeframe = String(body?.timeframe ?? "daily")
    const count = Math.min(Math.max(Number(body?.count) || 200, 10), 500)
    try {
      const { getHistory } = await import("./services/yahoo.mjs")
      const { detectPatterns, patternSummary } = await import("./services/patterns.mjs")
      const range = count > 500 ? "5y" : count > 200 ? "2y" : count > 100 ? "1y" : "6mo"
      const hist = await getHistory(symbol, range)
      if (!hist || !hist.closes?.length) return writeJson(res, 404, { error: "No data" })
      // Drop rows with non-finite OHLC — Yahoo FX series carry null gaps and
      // pattern math coerces null→0 into phantom signals (plus a client crash
      // on .toFixed of null OHLC downstream).
      const candles = hist.dates
        .map((time, i) => ({
          time,
          open: hist.opens[i],
          high: hist.highs[i],
          low: hist.lows[i],
          close: hist.closes[i]
        }))
        .filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(Number(v)) && Number(v) > 0))
        .slice(-count)
      const detected = detectPatterns(candles)
      const summary = patternSummary(candles)
      writeJson(res, 200, { ok: true, symbol, count: candles.length, detected, summary })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  // ── Trade Journal ───────────────────────────────────────────────────
  if (path === "/api/trading/journal" && req.method === "GET") {
    const { listEntries, journalStats } = await import("./services/tradeJournal.mjs")
    const symbol = parsed.searchParams.get("symbol") || undefined
    const tag = parsed.searchParams.get("tag") || undefined
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit")) || 50, 1), 200)
    const offset = Math.max(Number(parsed.searchParams.get("offset")) || 0, 0)
    const result = listEntries({ symbol, tag, limit, offset })
    writeJson(res, 200, { ok: true, ...result, stats: journalStats() })
    return
  }
  if (path === "/api/trading/journal" && req.method === "POST") {
    const { addEntry } = await import("./services/tradeJournal.mjs")
    try {
      const entry = addEntry(body ?? {})
      writeJson(res, 200, { ok: true, entry })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }
  if (path === "/api/trading/journal/close" && req.method === "POST") {
    const { closeEntry } = await import("./services/tradeJournal.mjs")
    const { id, exitPrice, exitTime, notes } = body ?? {}
    if (!id || exitPrice == null) return writeJson(res, 400, { error: "id and exitPrice required" })
    const entry = closeEntry(id, { exitPrice, exitTime, notes })
    writeJson(res, entry ? 200 : 404, { ok: !!entry, entry })
    return
  }
  if (path === "/api/trading/journal/delete" && req.method === "POST") {
    const { deleteEntry } = await import("./services/tradeJournal.mjs")
    const id = String(body?.id ?? "")
    if (!id) return writeJson(res, 400, { error: "id required" })
    writeJson(res, 200, { ok: deleteEntry(id) })
    return
  }

  // ── Trading Sessions ────────────────────────────────────────────────
  if (path === "/api/trading/sessions" && req.method === "GET") {
    const { getCurrentSession, getSessionSchedule } = await import("./services/tradingSessions.mjs")
    writeJson(res, 200, { ok: true, current: getCurrentSession(), schedule: getSessionSchedule() })
    return
  }
  if (path === "/api/trading/sessions/asset" && req.method === "POST") {
    const { getSessionForAsset } = await import("./services/tradingSessions.mjs")
    const symbol = String(body?.symbol ?? "EURUSD").toUpperCase()
    writeJson(res, 200, { ok: true, ...getSessionForAsset(symbol) })
    return
  }

  // -------------------------------------------------------------------
  // Strategy backtester — runs multi-model prediction over historical
  // windows and reports walk-forward hit rates, equity curve, drawdown.
  // -------------------------------------------------------------------
  if (path === "/api/trading/backtest" && req.method === "POST") {
    const symbol = String(body?.symbol ?? "").trim().toUpperCase()
    const days = Math.min(Math.max(Number(body?.days) || 3, 1), 30)
    const windows = Math.min(Math.max(Number(body?.windows) || 10, 3), 30)
    if (!symbol) return writeJson(res, 400, { error: "symbol required" })
    try {
      const { getHistory } = await import("./services/yahoo.mjs")
      const { backtestModels } = await import("./services/prediction.mjs")
      const history = await withTimeout(getHistory(symbol, "2y"), 15000)
      const closes = (history.closes ?? []).filter((v) => typeof v === "number" && isFinite(v) && v > 0)
      if (closes.length < 60) return writeJson(res, 400, { error: "insufficient data for backtest" })
      const bt = backtestModels(closes, days, windows)
      const hitRates = bt.hitRates ?? {}
      const sampleSize = bt.sampleSize ?? 0
      const avgHitRate = Object.values(hitRates).filter((v) => v != null).reduce((s, v, _, a) => s + v / a.length, 0)
      const agreement = Object.values(hitRates).filter((v) => v != null).length > 0
        ? Object.values(hitRates).filter((v) => v != null).filter((v) => v > 0.5).length / Object.values(hitRates).filter((v) => v != null).length
        : 0
      const trades = Object.entries(hitRates).map(([model, hr]) => ({ model, hitRate: hr, n: (bt.scores?.[model]?.length ?? 0) }))
      const windowResults = bt.windows ?? []
      let eq = 100
      let pk = 100
      const equity = [{ i: 0, v: 100 }]
      const dd = [{ i: 0, v: 0 }]
      windowResults.forEach((w, idx) => {
        if (w.hit) eq += 0.8
        else eq -= 1
        pk = Math.max(pk, eq)
        equity.push({ i: idx + 1, v: eq })
        dd.push({ i: idx + 1, v: pk > 0 ? ((pk - eq) / pk) * 100 : 0 })
      })
      writeJson(res, 200, {
        ok: true,
        symbol,
        days,
        windows,
        hitRate: avgHitRate,
        sampleSize,
        agreement,
        trades,
        equity,
        drawdown: dd,
        peak: pk,
        returnPct: eq - 100,
        maxDrawdown: dd.length ? Math.max(...dd.map((d) => d.v)) : 0,
        name: history.name
      })
    } catch (err) {
      console.warn("[picc] backtest failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/correlation" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return true
    try {
      const { getWatchlist, watchlistQuotes } = await import("./services/trading.mjs")
      const { getHistory } = await import("./services/yahoo.mjs")
      const symbols = Array.isArray(body?.symbols) ? body.symbols.map(String).map((s) => s.trim().toUpperCase()).filter(Boolean) : null
      const list = symbols || (await getWatchlist())
      if (!list.length) return writeJson(res, 200, { ok: true, symbols: [], matrix: [], pairs: [] })
      const priceHistories = {}
      await Promise.all(list.map(async (s) => {
        try {
          const h = await withTimeout(getHistory(s, "3mo"), 10000)
          if (h?.closes?.length >= 20) priceHistories[s] = h.closes
        } catch { /* skip */ }
      }))
      const { correlationMatrix, pairwiseCorrelation, highlyCorrelated, diversificationScore } = await import("./services/correlation.mjs")
      const corr = correlationMatrix(priceHistories)
      const pairs = pairwiseCorrelation(priceHistories)
      const hot = highlyCorrelated(priceHistories, 0.8)
      const equalW = corr.symbols.map(() => 1 / corr.symbols.length)
      const divScore = diversificationScore(equalW, corr.matrix)
      writeJson(res, 200, { ok: true, symbols: corr.symbols, matrix: corr.matrix, pairs, highlyCorrelated: hot, diversificationScore: divScore })
    } catch (err) {
      console.warn("[picc] correlation failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/volatility" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return true
    const symbol = String(body?.symbol ?? parsed.searchParams.get("symbol") ?? "").trim().toUpperCase()
    if (!symbol) return writeJson(res, 400, { error: "symbol required" })
    try {
      const { getHistory } = await import("./services/yahoo.mjs")
      const { volatilitySnapshot } = await import("./services/volatility.mjs")
      const history = await withTimeout(getHistory(symbol, "3mo"), 10000)
      const candles = (history.closes ?? []).map((c, i) => ({
        close: c,
        open: history.opens?.[i] ?? c,
        high: history.highs?.[i] ?? c,
        low: history.lows?.[i] ?? c
      })).filter((c) => c.close > 0)
      const snap = volatilitySnapshot(candles)
      writeJson(res, 200, { ok: true, symbol: history.symbol, name: history.name, ...snap })
    } catch (err) {
      console.warn("[picc] volatility failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/risk-parity" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return true
    try {
      const { getWatchlist } = await import("./services/trading.mjs")
      const { getHistory } = await import("./services/yahoo.mjs")
      const { riskParityAllocation } = await import("./services/riskParity.mjs")
      const method = String(body?.method || "inverse-vol")
      const symbols = Array.isArray(body?.symbols) ? body.symbols.map(String).map((s) => s.trim().toUpperCase()).filter(Boolean) : null
      const list = symbols || (await getWatchlist())
      if (!list.length) return writeJson(res, 200, { ok: false, error: "no symbols" })
      const priceHistories = {}
      await Promise.all(list.map(async (s) => {
        try {
          const h = await withTimeout(getHistory(s, "3mo"), 10000)
          if (h?.closes?.length >= 30) priceHistories[s] = h.closes
        } catch { /* skip */ }
      }))
      const result = riskParityAllocation(priceHistories, { method })
      writeJson(res, 200, { ok: true, ...result })
    } catch (err) {
      console.warn("[picc] risk-parity failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/notifications" && (req.method === "GET" || req.method === "POST")) {
    const { notify, getNotifications, markRead, markAllRead, clearOld, unreadCount, notificationStats, getWebhookSettings, saveWebhookSettings, emitEvent } = await import("./services/notificationCenter.mjs")
    // Webhook settings/test are a stored-SSRF channel (server POSTs trading
    // activity to any URL) — mutating actions require auth. Reads stay open.
    if (req.method === "POST" && ["webhook-settings", "webhook-test"].includes(String(body?.action))) {
      if (!(await requireAuth(req, res))) return true
    }
    if (req.method === "GET") {
      const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") ?? 50), 1), 200)
      const unreadOnly = parsed.searchParams.get("unread") === "true"
      writeJson(res, 200, { ok: true, notifications: getNotifications({ limit, unreadOnly }), unread: unreadCount(), stats: notificationStats(), webhook: getWebhookSettings() })
      return true
    }
    if (req.method === "POST") {
      if (body.action === "webhook-settings") {
        writeJson(res, 200, { ok: true, settings: await saveWebhookSettings(body.settings ?? body) })
        return true
      }
      if (body.action === "webhook-test") {
        const result = await emitEvent(String(body.event || "autopilot.start"), body.data ?? {})
        writeJson(res, 200, { ok: true, delivery: result })
        return true
      }
      if (body.action === "read" && body.id) { markRead(body.id); writeJson(res, 200, { ok: true }); return true }
      if (body.action === "read-all") { markAllRead(); writeJson(res, 200, { ok: true }); return true }
      if (body.action === "clear") { const age = Number(body.olderThanMs) || 7 * 24 * 60 * 60 * 1000; clearOld(age); writeJson(res, 200, { ok: true }); return true }
      if (body.title && body.body) {
        const n = notify({ title: body.title, body: body.body, level: body.level || "info", channel: body.channel || "in-app", meta: body.meta })
        writeJson(res, 200, { ok: true, notification: n })
        return true
      }
    }
    return false
  }

  if (path === "/api/trading/kelly") {
    if (!(await requireAuth(req, res))) return true
    const { computeKelly, kellySnapshot, getKellySettings, saveKellySettings } = await import("./services/kellyCriterion.mjs")
    if (req.method === "GET") { writeJson(res, 200, { ok: true, ...kellySnapshot() }); return true }
    if (req.method === "POST") {
      if (body.settings) { writeJson(res, 200, { ok: true, settings: saveKellySettings(body.settings) }); return true }
      if (body.winRate != null && body.avgPayout != null) {
        // Accept winRate as EITHER a fraction (0..1) or a percent (1..100) —
        // callers used to get a silent zero-object back for posting 68.
        // computeKelly normalizes units defensively itself; pass through.
        writeJson(res, 200, { ok: true, kelly: computeKelly(Number(body.winRate), Number(body.avgPayout), body.mode) })
        return true
      }
    }
    return false
  }

  // ── Ideal buy/sell price points near the current timeframe ────────────
  if (path === "/api/trading/levels" && req.method === "POST") {
    const assetId = String(body?.assetId ?? "").trim().toUpperCase() || "EURUSD"
    const timeframe = Math.min(Math.max(Number(body?.timeframe) || 60, 5), 3600)
    const count = Math.min(Math.max(Number(body?.count) || 200, 30), 500)
    try {
      const { computeEntryLevels } = await import("./services/entryLevels.mjs")
      const { liveEOData, fetchAssetCandles, ensureWatchingAsset } = await import("./services/liveEO.mjs")
      const data = liveEOData()
      const asset = data.assets.find((a) => eoAssetMatches(a, assetId))
      let candles = []
      let source = "none"
      if (asset && asset.periods[timeframe]?.length) {
        candles = asset.periods[timeframe].slice(-count)
        source = "live"
      }
      if (!candles.length) {
        await ensureWatchingAsset(assetId).catch(() => null)
        const result = await withTimeout(fetchAssetCandles(assetId, timeframe, count), 10000).catch(() => ({ ohlc: [], source: null }))
        if (result.ohlc?.length) {
          candles = result.ohlc
          source = result.source || "live"
        }
      }
      if (!candles.length) {
        try {
          const { getHistory } = await import("./services/yahoo.mjs")
          throttledWarn(`[picc] ${assetId}: entry levels falling back to Yahoo DAILY bars`)
          const history = await withTimeout(getHistory(assetId, "6mo"), 12000)
          candles = history.dates.map((ts, i) => ({
            time: Math.floor(ts / 1000),
            open: Number(history.opens[i]) || 0,
            high: Number(history.highs[i]) || 0,
            low: Number(history.lows[i]) || 0,
            close: Number(history.closes[i]) || 0,
            timeframe: 86400
          })).filter((c) => c.close > 0 && c.time > 0).slice(-count)
          source = "yahoo-daily"
        } catch { /* no data at all */ }
      }
      const levels = computeEntryLevels(candles, { timeframe })
      writeJson(res, 200, { ok: Boolean(levels.ok), assetId, timeframe, source, ...levels })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // ── Trading venues — public redirect metadata (no execution, R5) ──────
  // Read-only: lists venues + best-effort instrument deep-links for a given
  // asset. The suite never places orders; these URLs just open the venue.
  if (path === "/api/trading/venues" && req.method === "GET") {
    try {
      const { tradingVenues, instrumentUrl } = await import("./services/browserStudio.mjs")
      const assetId = String(parsed.searchParams.get("assetId") ?? "").trim() || null
      const venues = tradingVenues().map((v) => {
        const link = assetId ? instrumentUrl(v.id, assetId) : { url: v.url, mode: "venue" }
        return { ...v, tradeUrl: link.url, linkMode: link.mode }
      })
      writeJson(res, 200, { ok: true, assetId, venues })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // ── Trading catalog — full asset breadth for the Live Chart selector ───
  // Read-only: grouped, symbol-resolvable catalog (Decision D in the trading
  // suite upgrade spec). Every symbol is yahooSymbolFor-resolvable; unmapable
  // entries are excluded server-side, so no undefined symbol ever ships.
  if (path === "/api/trading/catalog" && req.method === "GET") {
    try {
      const { tradingCatalog } = await import("./services/tradingCatalog.mjs")
      const { categories } = tradingCatalog()
      writeJson(res, 200, { ok: true, categories })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // ── Notifications — universal attention layer (advisory signals) ──────
  if (path.startsWith("/api/notifications")) {
    try {
      const n = await import("./services/notifier.mjs")
      if (path === "/api/notifications/status" && req.method === "GET") {
        writeJson(res, 200, n.notifierStatus())
        return true
      }
      if (path === "/api/notifications/prefs" && req.method === "POST") {
        writeJson(res, 200, { ok: true, prefs: n.setPrefs(body) })
        return true
      }
      // Public by design: the browser needs the VAPID key *before* it can
      // subscribe, so no auth header exists yet on first load.
      if (path === "/api/notifications/vapid-public-key" && req.method === "GET") {
        const publicKey = process.env.VAPID_PUBLIC_KEY
        if (!publicKey) return writeJson(res, 503, { ok: false, error: "web-push not configured (VAPID_PUBLIC_KEY unset)" })
        return writeJson(res, 200, { publicKey })
      }
      if (path === "/api/notifications/subscribe-push" && req.method === "POST") {
        if (!body?.endpoint) return writeJson(res, 400, { ok: false, error: "subscription endpoint required" })
        writeJson(res, 200, { ok: n.addPushSubscription(body), subscriptions: n.listPushSubscriptions() })
        return true
      }
      if (path === "/api/notifications/unsubscribe-push" && req.method === "POST") {
        if (!body?.endpoint) return writeJson(res, 400, { ok: false, error: "subscription endpoint required" })
        writeJson(res, 200, { ok: n.removePushSubscription(body.endpoint), subscriptions: n.listPushSubscriptions() })
        return true
      }
      // T4 (REQ-5): the SW snooze button POSTs the notification tag. A known
      // tag queues a one-shot 10-minute re-show; an already-snoozed tag is an
      // explicit no-op; an unknown tag is a 404 — never a fake success.
      if (path === "/api/notifications/snooze" && req.method === "POST") {
        const tag = String(body?.tag ?? "")
        if (!tag) return writeJson(res, 400, { ok: false, error: "tag required" })
        const result = n.snoozeAlert({ tag })
        if (!result.ok) {
          if (result.error === "already snoozed") return writeJson(res, 200, { ok: false, error: result.error })
          return writeJson(res, 404, { ok: false, error: result.error })
        }
        return writeJson(res, 200, { ok: true })
      }
      if (path === "/api/notifications/test" && req.method === "POST") {
        const rec = await n.dispatchAlert({
          kind: "TEST",
          assetId: String(body?.assetId ?? "TEST"),
          title: "🔔 PICC test notification",
          body: "If you can read this on any channel, the advisory pipeline is wired end-to-end."
        })
        writeJson(res, 200, { ok: true, record: rec })
        return true
      }
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
      return true
    }
  }

  // ── Signal engine status — advisory window snapshot (T7 / REQ-8) ────────
  // The in-app countdown chip polls this; the push dispatch writes the same
  // state machine. One source of truth — the chip must never count down from a
  // different clock than the engine that opened the window.
  if (path === "/api/signals/status" && req.method === "GET") {
    try {
      const { signalEngineStatus } = await import("./services/signalEngine.mjs")
      writeJson(res, 200, signalEngineStatus())
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // ── Broker adapter registry — plug-and-play venue status ──────────────
  if (path === "/api/trading/brokers" && req.method === "GET") {
    try {
      const { listBrokers } = await import("./services/brokers.mjs")
      const { dataBusStats } = await import("./services/marketDataBus.mjs")
      const result = await listBrokers()
      // Per-source candle-fetch latency (median/p95 over the ring window).
      // Merged by key so rows that have never served a fetch show "—" honestly.
      result.latency = dataBusStats()
      writeJson(res, 200, result)
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // ── System capabilities probe ────────────────────────────────────────────
  // Read-only machine-level snapshot: what this instance can reach and what
  // channels are live. No auth required — intentionally public on localhost.
  if (path === "/api/system/capabilities" && req.method === "POST") {
    try {
      const { getPrefs } = await import("./services/notifier.mjs")
      const prefs = getPrefs()
      const notifierChannels = {
        inApp: true,
        webpush: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      }

      let browserFound = false
      try {
        const { browserAvailable } = await import("./services/browserBridge.mjs")
        browserFound = browserAvailable()
      } catch { /* browser bridge optional */ }

      writeJson(res, 200, {
        ok: true,
        arch: process.arch,
        platform: process.platform,
        node: process.version,
        browserFound,
        notifierChannels,
        signalEngine: process.env.PICC_SIGNAL_ENGINE !== "0",
        uptime: Math.floor(process.uptime()),
      })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // ── Cross-platform portfolio: aggregate exposure + risk check ─────────
  // Own path — POST /api/trading/portfolio is the analytics endpoint above.
  if (path === "/api/trading/portfolio/aggregate" && req.method === "POST") {
    try {
      const { aggregateOpenPositions, combinedTodayPnl, portfolioRiskCheck } = await import("./services/positionManager.mjs")
      const agg = await aggregateOpenPositions()
      const pnl = await combinedTodayPnl()
      const risk = body?.proposed?.amount != null
        ? await portfolioRiskCheck({ symbol: body.proposed.symbol ?? body.proposed.assetId, amount: body.proposed.amount })
        : null
      writeJson(res, 200, { ok: true, ...agg, todayPnl: pnl, riskCheck: risk })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // ── Cross-venue price spread (honest arbitrage pre-check) ─────────────
  // Compares the same instrument across venues that are ACTUALLY live. A raw
  // spread is NOT free money: taker fees on both legs + slippage must clear
  // first, so the result carries the fee-adjusted edge and refuses to call
  // anything an opportunity below that bar.
  if (path === "/api/trading/spread" && req.method === "POST") {
    const assetId = String(body?.assetId ?? "").trim().toUpperCase() || "BTCUSD"
    try {
      const quotes = []
      // EO mid from the newest buffered candle.
      try {
        const { liveEOData, fetchAssetCandles } = await import("./services/liveEO.mjs")
        let eoCandles = []
        const eoAsset = liveEOData().assets.find((a) => assetsEquivalent(a.name, assetId) || String(a.id) === assetId)
        if (eoAsset?.periods?.[60]?.length) eoCandles = eoAsset.periods[60]
        else {
          const r = await withTimeout(fetchAssetCandles(assetId, 60, 3), 8000).catch(() => ({ ohlc: [] }))
          eoCandles = r.ohlc ?? []
        }
        if (eoCandles.length) quotes.push({ venue: "expertoption", price: Number(eoCandles[eoCandles.length - 1].close) })
      } catch { /* EO offline */ }
      // CCXT tickers from configured pairs.
      try {
        const { fetchTicker, toCcxtSymbol } = await import("./services/ccxtConnector.mjs")
const creds = await getVenueCredentials()
        for (const cfg of (Array.isArray(creds.ccxtExchanges) ? creds.ccxtExchanges : []).slice(0, 4)) {
          const sym = toCcxtSymbol(cfg.symbol)
          const wantBase = assetId.replace(/[^A-Z]/g, "").slice(0, 3)
          const symCompact = String(sym).toUpperCase().replace("/", "")
          const alt = wantBase && symCompact.startsWith(wantBase) ? symCompact : null
          if (!alt || (symCompact !== assetId && alt !== assetId.replace(/USD$/, "USDT"))) {
            if (!symCompact.includes(wantBase)) continue
          }
          const t = await withTimeout(fetchTicker(cfg.exchange, sym), 6000).catch(() => null)
          if (t?.price > 0) quotes.push({ venue: `ccxt:${cfg.exchange}`, symbol: sym, price: Number(t.price) })
        }
      } catch { /* CCXT unavailable */ }

      const TAKER_FEE_RATE = 0.001 // 0.1% per leg, conservative default
      let best = null
      if (quotes.length >= 2) {
        for (let i = 0; i < quotes.length; i++) {
          for (let j = 0; j < quotes.length; j++) {
            if (i === j) continue
            const buy = quotes[i].price
            const sell = quotes[j].price
            const grossPct = ((sell - buy) / buy) * 100
            const netPct = grossPct - TAKER_FEE_RATE * 100 * 2 // both legs
            if (!best || netPct > best.netPct) {
              best = {
                buyVenue: quotes[i].venue, sellVenue: quotes[j].venue,
                buyPrice: round2(buy), sellPrice: round2(sell),
                grossPct: Math.round(grossPct * 1000) / 1000,
                netPct: Math.round(netPct * 1000) / 1000,
                opportunity: netPct >= 0.1 // ≥0.1% AFTER fees, else noise
              }
            }
          }
        }
      }
      writeJson(res, 200, {
        ok: true,
        assetId,
        venuesPolled: quotes,
        note: quotes.length < 2
          ? "need ≥2 live venues quoting this instrument for a meaningful spread"
          : "net edge is AFTER ~0.1% taker fees per leg — sub-fee spreads are not opportunities",
        best
      })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  // ── Model matrix — multiplexing multi-model consensus ──────────────────
  if (path === "/api/trading/models" && req.method === "POST") {
    const assetId = String(body?.assetId ?? "").trim().toUpperCase() || "EURUSD"
    const timeframe = Math.min(Math.max(Number(body?.timeframe) || 60, 5), 3600)
    const count = Math.min(Math.max(Number(body?.count) || 200, 40), 500)
    try {
      const { computeModelMatrix } = await import("./services/modelMatrix.mjs")
      const { liveEOData, fetchAssetCandles, ensureWatchingAsset } = await import("./services/liveEO.mjs")
      const data = liveEOData()
      const asset = data.assets.find((a) => eoAssetMatches(a, assetId))
      let candles = []
      let source = "none"
      if (asset && asset.periods[timeframe]?.length) {
        candles = asset.periods[timeframe].slice(-count)
        source = "live"
      }
      if (!candles.length) {
        await ensureWatchingAsset(assetId).catch(() => null)
        const result = await withTimeout(fetchAssetCandles(assetId, timeframe, count), 10000).catch(() => ({ ohlc: [], source: null }))
        if (result.ohlc?.length) {
          candles = result.ohlc
          source = result.source || "live"
        }
      }
      if (!candles.length) {
        try {
          const { getHistory } = await import("./services/yahoo.mjs")
          throttledWarn(`[picc] ${assetId}: model matrix falling back to Yahoo DAILY bars`)
          const history = await withTimeout(getHistory(assetId, "6mo"), 12000)
          candles = history.dates.map((ts, i) => ({
            time: Math.floor(ts / 1000),
            open: Number(history.opens[i]) || 0,
            high: Number(history.highs[i]) || 0,
            low: Number(history.lows[i]) || 0,
            close: Number(history.closes[i]) || 0,
            timeframe: 86400
          })).filter((c) => c.close > 0 && c.time > 0).slice(-count)
          source = "yahoo-daily"
        } catch { /* no data */ }
      }
      writeJson(res, 200, { assetId, timeframe, source, ...computeModelMatrix(candles) })
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }
  if (path === "/api/trading/regime") {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    const { detectRegime } = await import("./services/regimeDetection.mjs")
    const candles = body?.candles || []
    writeJson(res, 200, { ok: true, ...detectRegime(candles, body?.timeframe) })
    return true
  }
  if (path === "/api/trading/expiry") {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    const { optimizeExpiry } = await import("./services/expiryOptimizer.mjs")
    const candles = body?.candles || []
    writeJson(res, 200, { ok: true, ...optimizeExpiry(candles, body?.regime, body?.signalStrength) })
    return true
  }
  if (path === "/api/trading/sentiment") {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    const { getSentiment } = await import("./services/sentimentEngine.mjs")
    const symbol = body?.symbol
    if (!symbol) { writeJson(res, 400, { ok: false, error: "symbol required" }); return true }
    writeJson(res, 200, { ok: true, ...(await getSentiment(symbol)) })
    return true
  }
  if (path === "/api/trading/orderflow") {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    const { analyzeOrderFlow } = await import("./services/orderFlow.mjs")
    const candles = body?.candles || []
    writeJson(res, 200, { ok: true, ...analyzeOrderFlow(candles, body?.lookback) })
    return true
  }

  if (path === "/api/trading/adaptive-stops" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const { computeAdaptiveStops } = await import("./services/trading.mjs")
    const { candles, direction, timeframe } = body ?? {}
    if (!candles || !Array.isArray(candles) || candles.length < 20) {
      writeJson(res, 400, { ok: false, error: "at least 20 candles required" })
      return true
    }
    if (!direction || (direction !== "up" && direction !== "down")) {
      writeJson(res, 400, { ok: false, error: "direction must be 'up' or 'down'" })
      return true
    }
    writeJson(res, 200, { ok: true, ...computeAdaptiveStops(candles, direction, { atrPeriod: timeframe }) })
    return true
  }

  if (path === "/api/trading/walk-forward" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const symbol = String(body?.symbol ?? "").trim().toUpperCase()
    const horizonDays = Math.min(Math.max(Number(body?.horizonDays) || 3, 1), 30)
    const trainWindow = Math.min(Math.max(Number(body?.trainWindow) || 60, 30), 500)
    const testWindow = Math.min(Math.max(Number(body?.testWindow) || 20, 5), 100)
    const stepSize = Math.min(Math.max(Number(body?.stepSize) || testWindow, 5), 200)
    const maxWindows = Math.min(Math.max(Number(body?.maxWindows) || 20, 3), 100)
    if (!symbol) { writeJson(res, 400, { ok: false, error: "symbol required" }); return true }
    try {
      const { getHistory } = await import("./services/yahoo.mjs")
      const { backtestModels, predictDirection } = await import("./services/prediction.mjs")
      const history = await withTimeout(getHistory(symbol, "5y"), 20000)
      const closes = (history.closes ?? []).filter((v) => typeof v === "number" && isFinite(v) && v > 0)
      if (closes.length < trainWindow + testWindow + horizonDays) {
        writeJson(res, 400, { ok: false, error: `need at least ${trainWindow + testWindow + horizonDays} data points` })
        return true
      }
      const windows = []
      let eq = 100
      let peak = 100
      const equity = [{ i: 0, v: 100 }]
      const drawdown = [{ i: 0, v: 0 }]
      for (let start = trainWindow; start + testWindow + horizonDays <= closes.length && windows.length < maxWindows; start += stepSize) {
        const trainSlice = closes.slice(0, start)
        const bt = backtestModels(trainSlice, horizonDays, 10)
        const hitRates = bt.hitRates ?? {}
        const avgHR = Object.values(hitRates).filter((v) => v != null).reduce((s, v, _, a) => s + v / a.length, 0)
        const testSlice = closes.slice(start, start + testWindow)
        const futureSlice = closes.slice(start + testWindow, start + testWindow + horizonDays)
        const entry = testSlice[testSlice.length - 1]
        const exit = futureSlice.length > 0 ? futureSlice[futureSlice.length - 1] : entry
        const direction = avgHR > 0.5 ? "up" : avgHR < 0.5 ? "down" : "flat"
        const mult = direction === "up" ? 1 : direction === "down" ? -1 : 0
        const returnPct = entry > 0 ? (exit / entry - 1) * mult : 0
        const hit = returnPct > 0
        eq = Math.round((eq + eq * returnPct) * 100) / 100
        peak = Math.max(peak, eq)
        windows.push({ idx: windows.length + 1, trainStart: start - trainWindow, testStart: start, hitRate: Math.round(avgHR * 100), hit, returnPct: Math.round(returnPct * 10000) / 100, entry, exit })
        equity.push({ i: windows.length, v: eq })
        drawdown.push({ i: windows.length, v: peak > 0 ? Math.round(((peak - eq) / peak) * 10000) / 100 : 0 })
      }
      const totalHits = windows.filter((w) => w.hit).length
      const totalReturn = eq - 100
      const maxDD = drawdown.length ? Math.max(...drawdown.map((d) => d.v)) : 0
      let gateHyperopt = null
      let gateWalkForward = null
      try {
        const { gridSearchGateThresholds, walkForwardBacktest } = await import("./services/hyperopt.mjs")
        const ohlc = closes.map((c, i) => ({ time: i, open: c, high: c, low: c, close: c }))
        const payoutPct = Math.min(Math.max(Number(body?.payoutPct) || 80, 1), 500)
        const hyperWindows = Math.min(Math.max(Number(body?.hyperoptWindows) || 5, 2), 20)
        gateHyperopt = gridSearchGateThresholds(ohlc, { payoutPct })
        gateWalkForward = walkForwardBacktest(ohlc, { windows: hyperWindows, payoutPct })
      } catch (err) {
        console.warn("[picc] gate hyperopt failed:", err.message)
        gateHyperopt = { ok: false, error: err.message }
        gateWalkForward = { ok: false, error: err.message }
      }
      writeJson(res, 200, {
        ok: true,
        symbol, horizonDays, trainWindow, testWindow, stepSize,
        windowsCompleted: windows.length,
        walkForwardHitRate: windows.length ? Math.round((totalHits / windows.length) * 100) : null,
        totalReturnPct: Math.round(totalReturn * 100) / 100,
        maxDrawdownPct: maxDD,
        equity, drawdown, windowDetails: windows,
        gateHyperopt,
        gateWalkForward,
        name: history.name
      })
    } catch (err) {
      console.warn("[picc] walk-forward failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return true
  }

  if (path === "/api/trading/risk-of-ruin" && req.method === "POST") {
    const winRate = Number(body?.winRate)
    const avgPayout = Number(body?.avgPayout)
    const riskPct = Number(body?.riskPct)
    const balance = Number(body?.balance)
    try {
      const { signalAccuracy } = await import("./services/trading.mjs")
      const acc = await signalAccuracy()
      const wr = Number.isFinite(winRate) ? winRate : (acc.winRate ?? 50)
      const ap = Number.isFinite(avgPayout) ? avgPayout : 0.8
      const rp = Number.isFinite(riskPct) ? riskPct : 2
      const bal = Number.isFinite(balance) ? balance : (acc.balance ?? 1000)
      writeJson(res, 200, riskOfRuin({ winRate: wr, avgPayout: ap, riskPct: rp, balance: bal }))
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  if (path === "/api/trading/health" && (req.method === "GET" || req.method === "POST")) {
    const autopilot = await import("./services/autopilot.mjs").catch(() => null)
    const result = { ok: true, timestamp: new Date().toISOString() }
    try {
      const liveStats = liveEOStats()
      const lastTickAge = Number(liveStats?.lastSeen) > 0 ? Math.round((Date.now() - Number(liveStats.lastSeen)) / 1000) : null
      let sessionAge = null
      try {
        const creds = await getTradingCredentials()
        const capturedAt = Date.parse(creds?.expertoptionTokenCapturedAt ?? "")
        if (Number.isFinite(capturedAt)) sessionAge = Math.max(0, Math.round((Date.now() - capturedAt) / 1000))
      } catch { /* credentials unreadable — leave sessionAge null */ }
      result.expertOption = {
        connected: liveStats?.status === "connected",
        status: liveStats?.status ?? "idle",
        viewed: liveStats?.viewed ?? null,
        lastSeen: Number(liveStats?.lastSeen) > 0 ? new Date(liveStats.lastSeen).toISOString() : null,
        sessionAge,
        lastTickAge,
        stalenessWarning: liveStats?.status === "connected" && lastTickAge != null && lastTickAge > 60,
        connectorTuned: Boolean(getConnector("expertoption")?.tuned)
      }
    } catch { result.expertOption = { connected: false, error: "failed" } }
    try {
      if (autopilot) {
        const config = await autopilot.getAutopilotConfig()
        result.autopilot = {
          enabled: config.enabled,
          assetId: config.assetId ?? "BTCUSD",
          minConfidence: config.minConfidence ?? 55,
          lastEntryAt: config.lastEntryAt ?? 0,
          cooldownMs: config.cooldownMs ?? 0,
          humanReviewMs: config.humanReviewMs ?? 5000,
          dailyLossLimitPct: config.dailyLossLimitPct ?? 10,
          dayStartBalance: config.dayStartBalance ?? null,
          maxDailyTrades: config.maxDailyTrades ?? 0
        }
      }
    } catch { result.autopilot = { enabled: false, error: "failed" } }
    try {
      const { backtestModels } = await import("./services/prediction.mjs")
      const { quickMtfCheck } = await import("./services/multiTimeframe.mjs")
      const liveData = liveEOData()
      const firstAsset = liveData?.assets?.[0]
      const closes = firstAsset?.periods?.[60]?.map((c) => Number(c.close ?? c.c)).filter((v) => Number.isFinite(v) && v > 0) || []
      if (closes.length > 40) {
        const bt = backtestModels(closes, 3, 15)
        result.prediction = {
          models: bt.hitRates,
          sampleSize: bt.sampleSize,
          availableModels: ["momentum", "meanRevert", "trend", "monteCarlo", "arima", "prophet", "lstm", "garch"]
        }
      } else {
        result.prediction = { models: null, sampleSize: 0, availableModels: ["momentum", "meanRevert", "trend", "monteCarlo", "arima", "prophet", "lstm", "garch"], note: "insufficient candle data" }
      }
      if (firstAsset) {
        const mtfUp = quickMtfCheck(firstAsset, 1)
        const mtfDown = quickMtfCheck(firstAsset, -1)
        result.mtf = { up: mtfUp, down: mtfDown }
      } else {
        result.mtf = null
      }
    } catch { result.prediction = { error: "failed" }; result.mtf = null }
    try {
      result.sources = collectSourceStatuses()
    } catch { result.sources = null }
    try {
      const { getCalibrationSummary } = await import("./services/calibration.mjs")
      result.calibration = getCalibrationSummary()
    } catch { result.calibration = { error: "failed" } }
    writeJson(res, 200, result)
    return true
  }

  if (path === "/api/collectors/cashpilot" && req.method === "POST") {
    // This route makes the SERVER fetch an arbitrary URL and reflect the
    // response — a strict token is required even before any account exists.
    if (!(await verifyUser(auth))) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    const baseUrl = String(body.url || "").trim()
    const key = String(body.key || "").trim()
    if (!baseUrl) return writeJson(res, 400, { error: "cashpilot url required" })
    if (!isHttpUrl(baseUrl)) return writeJson(res, 400, { error: "cashpilot url must be an http(s) address" })
    // Block loopback/private/link-local targets — the classic SSRF probe set.
    let host = ""
    try { host = new URL(baseUrl).hostname } catch { /* isHttpUrl already validated */ }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\]|\[fc|\[fd)/i.test(host) || /^\[?f[cd]/i.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      return writeJson(res, 400, { error: "cashpilot url must be a public host" })
    }
    try {
      const [summary, daily, breakdown] = await Promise.all([
        withTimeout(fetchCashPilotSummary(baseUrl, key), 15000),
        body.daily === false ? Promise.resolve([]) : withTimeout(fetchCashPilotDaily(baseUrl, key), 15000),
        withTimeout(fetchCashPilotBreakdown(baseUrl, key), 15000).catch(() => [])
      ])
      writeJson(res, 200, { ok: true, summary, daily, breakdown })
    } catch (err) {
      console.warn("[picc] cashpilot collector failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  // -------------------------------------------------------------------
  // Local auth — fully self-hosted accounts (users + sessions in server/data)
  // -------------------------------------------------------------------
  if (path === "/api/auth/status" && (req.method === "GET" || req.method === "POST")) {
    writeJson(res, 200, { ok: true, hasUsers: await hasUsers(), authMode: "local" })
    return
  }

  if (path === "/api/auth/signup" && req.method === "POST") {
    if (rateLimited(`auth:${clientIp(req)}`, 10, 60_000)) {
      return writeJson(res, 429, { error: "too many attempts — try again in a minute" })
    }
    const result = await createAccount(body)
    if (result.error) return writeJson(res, 400, { error: result.error })
    writeJson(res, 200, { ok: true, token: result.token, user: result.user })
    return
  }

  if (path === "/api/auth/login" && req.method === "POST") {
    if (rateLimited(`auth:${clientIp(req)}`, 10, 60_000)) {
      return writeJson(res, 429, { error: "too many attempts — try again in a minute" })
    }
    const result = await loginAccount(body)
    if (result.error) return writeJson(res, 401, { error: result.error })
    writeJson(res, 200, { ok: true, token: result.token, user: result.user })
    return
  }

  if (path === "/api/auth/signout" && req.method === "POST") {
    await revokeToken(auth?.slice(7))
    writeJson(res, 200, { ok: true })
    return
  }

  if (path === "/api/auth/me" && (req.method === "GET" || req.method === "POST")) {
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "not authenticated" })
    const user = await getUserById(userId)
    if (!user) return writeJson(res, 401, { error: "user not found" })
    writeJson(res, 200, { ok: true, user })
    return
  }

  // -------------------------------------------------------------------
  // Profile — settings + linked accounts (Google/email via the browser
  // vault, GitHub via real OAuth with PKCE)
  // -------------------------------------------------------------------
  if (path === "/api/profile" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return
    const userId = await verifyUser(auth)
    writeJson(res, 200, await getProfile(userId))
    return
  }

  if (path === "/api/profile/name" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    const userId = await verifyUser(auth)
    writeJson(res, 200, await updateProfileName(userId, body?.name))
    return
  }

  if (path === "/api/profile/link" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    const userId = await verifyUser(auth)
    const provider = String(body?.provider ?? "").trim().toLowerCase()
    if (provider !== "google" && provider !== "email" && provider !== "github") {
      return writeJson(res, 400, { error: "provider must be google, email or github" })
    }
    const username = String(body?.username ?? "").trim()
    if (!username) return writeJson(res, 400, { error: "username is required" })
    if ((provider === "google" || provider === "email") && typeof body?.password === "string" && body.password) {
      try {
        await saveSiteCredentials(provider, { username, password: body.password })
      } catch (err) {
        console.error("[picc] profile link: vault save failed:", err)
        return writeJson(res, 502, { ok: false, error: "Could not save the sign-in to the browser vault — try again." })
      }
    }
    const result = await linkIdentity(userId, provider, { username })
    if (result.error) return writeJson(res, 400, result)
    writeJson(res, 200, result)
    return
  }

  if (path === "/api/profile/unlink" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const userId = await verifyUser(auth)
    const provider = String(body?.provider ?? "").trim().toLowerCase()
    if (!provider) return writeJson(res, 400, { error: "provider required" })
    const result = await unlinkIdentity(userId, provider)
    // Google/email unlink also clears the vault credential owned by this card.
    if (provider === "google" || provider === "email") {
      await deleteSiteCredentials(provider).catch(() => {})
    }
    writeJson(res, 200, result)
    return
  }

  // Report (and, when a session account differs, rebind) the LIVE Google
  // session of the embedded browser so the Profile card reflects what is
  // actually signed in. `navigate: true` drives the active tab to
  // accounts.google.com first; the profile mount check uses navigate:false and
  // only reads a tab that is already on accounts.google.com (non-intrusive).
  if (path === "/api/profile/google/state" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const userId = await verifyUser(auth)
    const navigate = Boolean(body?.navigate)
    // A deliberate Sync can self-heal: if the embedded browser is closed (or a
    // previous instance died), reopen it from its saved profile first, then
    // probe the live session.
    if (!studioIsOpen() && navigate) {
      await withTimeout(openStudio(), 45000).catch(() => {})
    }
    if (!studioIsOpen()) {
      return writeJson(res, 200, { ok: true, available: false, onGooglePage: false, method: "none", loggedIn: false, account: null, linkedAccount: null, boundAccount: null, error: "browser not open" })
    }
    try {
      const st = await studioGoogleSession({ navigate })
      let linkedAccount = (await getProfile(userId)).links?.google?.username ?? null
      let boundAccount = null
      if (st.loggedIn && st.account && st.account !== linkedAccount) {
        const creds = await getSiteCredentials("google")
        await linkIdentity(userId, "google", { username: st.account })
        if (creds?.password) await saveSiteCredentials("google", { username: st.account, password: creds.password })
        boundAccount = st.account
        linkedAccount = st.account
      }
      writeJson(res, 200, { ...st, linkedAccount, boundAccount })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/profile/github/oauth" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    const userId = await verifyUser(auth)
    try {
      const saved = await saveGithubOauth(userId, {
        clientId: body?.clientId,
        clientSecret: body?.clientSecret
      })
      writeJson(res, saved.ok ? 200 : 400, saved)
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/profile/github/begin" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    const userId = await verifyUser(auth)
    // Use fixed redirect URI to prevent Host header manipulation
    const redirectUri = `http://localhost:${env.port}/api/profile/github/callback`
    try {
      const flow = await beginGithubOauth(userId, redirectUri)
      writeJson(res, 200, { ok: true, ...flow })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/profile/github/callback" && req.method === "GET") {
    const code = String(parsed.searchParams.get("code") ?? "")
    const state = String(parsed.searchParams.get("state") ?? "")
    if (!code || !state) {
      return sendProfilePage(res, 400, "Missing authorization code or state — start again from the Profile page.", false)
    }
    const result = await completeGithubOauth({ code, state })
    if (!result.ok) return sendProfilePage(res, 400, result.error, false)
    sendProfilePage(res, 200, `GitHub linked as @${result.username}.`, true)
    return
  }

  // -------------------------------------------------------------------
  // Unified income overview (Q5, Task 11) — one honest surface for the
  // Income tab: connector earnings snapshots + user streams + holdings.
  // Per-user scoping mirrors the /api/data rule (handlers.mjs:3233).
  // -------------------------------------------------------------------
  if (path === "/api/income/overview" && req.method === "GET") {
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    const userRows = (rows) => (rows || []).filter((r) => !r.user_id || r.user_id === userId)
    const [streams, nftHoldings, depinNodes, financialAccounts, transactions] = await Promise.all([
      listRows("income_streams"),
      listRows("nft_holdings"),
      listRows("depin_nodes"),
      listRows("financial_accounts"),
      listRows("transactions")
    ])
    const snapshots = (await getLatestSnapshots()) ?? {}
    writeJson(res, 200, {
      ok: true,
      snapshots,
      streams: userRows(streams),
      holdings: {
        nft: userRows(nftHoldings),
        depin: userRows(depinNodes),
        financial: userRows(financialAccounts),
        transactions: userRows(transactions)
      },
      summary: incomeSummaryFromServer(userRows(streams), Object.values(snapshots))
    })
    return
  }

  // -------------------------------------------------------------------
  // Local data store — JSON-backed replacement for Supabase tables
  // -------------------------------------------------------------------
  const dataMatch = path.match(/^\/api\/data\/([a-z_]+)(\/upsert|\/remove)?$/)
  if (dataMatch) {
    const [, table, verb] = dataMatch
    if (!isTable(table)) return writeJson(res, 400, { error: `unknown table "${table}"` })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    if (req.method === "GET") {
      const rows = await listRows(table)
      writeJson(res, 200, { ok: true, rows: rows.filter((r) => !r.user_id || r.user_id === userId) })
      return
    }
    if (req.method === "POST" && verb === "/upsert") {
      writeJson(res, 200, { ok: true, row: await upsertRow(table, body.row ?? body, userId) })
      return
    }
    if (req.method === "POST" && verb === "/remove") {
      const id = String(body?.id ?? "")
      const rows = await listRows(table)
      const target = rows.find((r) => r.id === id)
      if (!target || (target.user_id && target.user_id !== userId)) {
        return writeJson(res, 404, { error: "row not found" })
      }
      writeJson(res, 200, { ok: true, ...(await removeRow(table, id)) })
      return
    }
    if (req.method === "POST") {
      writeJson(res, 200, { ok: true, row: await appendRow(table, body.row ?? body, userId) })
      return
    }
  }

  if (path === "/api/opportunities" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await opportunityCatalog())
    } catch (err) {
      console.error("[picc] opportunities failed:", err)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/opportunities/workflows" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await listWorkflows())
    } catch (err) {
      console.error("[picc] workflows failed:", err)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/opportunities/bounties" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await monitorBountyBoards())
    } catch (err) {
      console.error("[picc] bounty boards failed:", err)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/streams/snapshot" && req.method === "POST") {
    // Overwrites the income snapshot shown on the dashboard — localhost only.
    if (!isLocalhostRequest(req)) { writeJson(res, 403, { error: "local only" }); return true }
    try {
      writeJson(res, 200, await saveSnapshot(body))
    } catch (err) {
      console.error("[picc] streams snapshot failed:", err)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return true
  }

  if (path === "/api/streams/snapshot" && req.method === "GET") {
    writeJson(res, 200, await getSnapshot())
    return
  }

  if (path === "/api/listing/analyze" && req.method === "POST") {
    if (validateOr400(res, body, "listingAnalyze")) return true
    writeJson(res, 200, await handleListingAnalyze(body))
    return
  }

  if (path === "/api/listing/keywords" && req.method === "POST") {
    writeJson(res, 200, await handleListingKeywords(body))
    return
  }

  if (path === "/api/listing/rewrite" && req.method === "POST") {
    writeJson(res, 200, await handleListingRewrite(body))
    return
  }

  if (path === "/api/listing/competitors" && req.method === "POST") {
    const { keywords = "", asin = "" } = body
    if (!String(keywords || "").trim() && !String(asin || "").trim()) {
      return writeJson(res, 400, { error: "provide keywords or an asin" })
    }
    try {
      writeJson(res, 200, await getCompetitorData({ keywords, asin }))
    } catch (err) {
      console.warn("[picc] competitor lookup failed:", err.message)
      writeJson(res, 502, { source: "error", competitors: [], note: err.message })
    }
    return
  }

  if (path === "/api/content/generate" && req.method === "POST") {
    if (validateOr400(res, body, "contentGenerate")) return true
    writeJson(res, 200, await handleContentGenerate(body))
    return
  }

  // Client error reports (web dashboard browser console, incl. the studio
  // window). Gated by PICC_ERROR_LOG — when disabled, reports are acknowledged but
  // dropped so clients stop buffering.
  if (path === "/api/client-logs" && req.method === "POST") {
    if (!errorLogEnabled()) {
      writeJson(res, 200, { ok: true, written: 0, disabled: true })
      return
    }
    if (rateLimited(`clientlogs:${clientIp(req)}`, 30, 60_000)) {
      writeJson(res, 429, { error: "rate limit exceeded — try again later" })
      return
    }
    const written = recordClientReport(body)
    writeJson(res, 200, { ok: true, written })
    return
  }

  if (path === "/api/agents/run" && req.method === "POST") {
    if (!env.agentsUrl) return writeJson(res, 503, { error: "agents service not configured (set PICC_AGENTS_URL)" })
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    if (rateLimited(`agents:${clientIp(req)}`, 30, 60_000)) {
      return writeJson(res, 429, { error: "too many agent runs — try again in a minute" })
    }
    const crew = body.crew ?? "research"
    const target =
      crew === "listing"
        ? `${env.agentsUrl}/analyze-listing`
        : crew === "content"
          ? `${env.agentsUrl}/generate-content`
          : `${env.agentsUrl}/run/research`
    try {
      const r = await withTimeout(
        fetch(target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body.inputs ?? {})
        }),
        60000
      )
      const data = await r.json().catch(() => ({ error: "non-JSON response from agents service" }))
      writeJson(res, r.ok ? 200 : 502, data)
    } catch (err) {
      console.error("[picc] agents proxy failed:", err.message)
      writeJson(res, 502, { error: "agents service unreachable" })
    }
    return
  }

  if (path === "/api/agents/settings" && (req.method === "GET" || req.method === "POST")) {
    if (!env.agentsUrl) return writeJson(res, 503, { error: "agents service not configured (set PICC_AGENTS_URL)" })
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    try {
      const r = await withTimeout(
        fetch(`${env.agentsUrl}/settings`, {
          method: req.method,
          headers: { "Content-Type": "application/json" },
          body: req.method === "POST" ? JSON.stringify(body) : undefined
        }),
        8000
      )
      const data = await r.json().catch(() => ({ error: "non-JSON response from agents service" }))
      writeJson(res, r.ok ? 200 : 502, data)
    } catch (err) {
      console.error("[picc] agents settings proxy failed:", err.message)
      writeJson(res, 502, { error: "agents service unreachable" })
    }
    return
  }

  if (path === "/api/stripe/checkout" && req.method === "POST") {
    if (!hasStripe()) return writeJson(res, 503, { error: "Stripe not configured" })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    const { priceId, tier = "pro" } = body
    if (!priceId) return writeJson(res, 400, { error: "priceId required" })
    const successUrl = body.successUrl || "http://localhost:5173/profile?billing=success"
    const cancelUrl = body.cancelUrl || "http://localhost:5173/profile"
    if (!isAllowedRedirect(successUrl) || !isAllowedRedirect(cancelUrl)) {
      return writeJson(res, 400, { error: "redirect URLs must point to localhost" })
    }
    try {
      const session = await createCheckoutSession({
        priceId,
        tier,
        userId,
        successUrl,
        cancelUrl
      })
      writeJson(res, 200, { url: session.url })
    } catch (err) {
      console.error("[picc] stripe checkout failed:", err)
      writeJson(res, 400, { error: "stripe checkout failed" })
    }
    return
  }

  if (path === "/api/stripe/portal" && req.method === "POST") {
    if (!hasStripe()) return writeJson(res, 503, { error: "Stripe not configured" })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    // Security: never trust a client-supplied customerId. Open the portal for
    // the authenticated user's OWN Stripe customer only (OWASP API1 / IDOR).
    const customerId = await stripeCustomerForUser(userId)
    if (!customerId) return writeJson(res, 400, { error: "no Stripe customer on file for this account" })
    try {
      const session = await createPortalSession(customerId)
      writeJson(res, 200, { url: session.url })
    } catch (err) {
      console.error("[picc] stripe portal failed:", err)
      writeJson(res, 400, { error: "stripe portal failed", detail: err.message })
    }
    return
  }

  if (path === "/api/stripe/webhook" && req.method === "POST") {
    const raw = await readRawBody(req)
    const signature = req.headers["stripe-signature"]
    try {
      const event = constructWebhookEvent(raw, signature)
      await handleStripeWebhook(event)
      writeJson(res, 200, { received: true })
    } catch (err) {
      console.error("[picc] stripe webhook error:", err)
      writeJson(res, 400, { error: "webhook failed", detail: err.message })
    }
    return
  }

  if (path === "/api/billing/ewallet/order" && req.method === "POST") {
    if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "authentication required" })
    // Bind the order to an owner. In the single-owner first-run (no accounts
    // configured yet) the local operator is the implicit owner; once accounts
    // exist the order must carry the authenticated user's id (audit Fix 6).
    const userId = (await verifyUser(auth)) || (!(await hasUsers()) ? "local-owner" : null)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    const ewallet = String(body.ewallet ?? "tng").toLowerCase()
    if (!walletInfo(ewallet)) return writeJson(res, 400, { error: `unsupported eWallet (use ${WALLET_IDS.join(", ")})` })
    try {
      const result = await createEwalletOrder({
        ewallet,
        amount: body.amount,
        currency: body.currency,
        description: body.description,
        userId
      })
      writeJson(res, 200, result)
    } catch (err) {
      console.error("[picc] ewallet order failed:", err.message)
      writeJson(res, 400, { error: "ewallet order failed", detail: err.message })
    }
    return
  }

  if (path === "/api/billing/ewallet/submit" && req.method === "POST") {
    // Confirms a payment order — same auth bar as /api/billing/ewallet/order.
    if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "authentication required" })
    const actorUserId = (await verifyUser(auth)) || (!(await hasUsers()) ? "local-owner" : null)
    if (!actorUserId) return writeJson(res, 401, { error: "authentication required" })
    // Self-approve is only allowed in the single-owner admin/demo mode (no
    // real accounts configured). Once real accounts exist, only the order's
    // OWNER may confirm it — never an arbitrary caller (audit Fix 6).
    const selfApprove = !(await hasUsers())
    const { orderId, confirmRef } = body
    if (!orderId) return writeJson(res, 400, { error: "orderId required" })
    try {
      const result = await submitEwalletOrder({ orderId, confirmRef, actorUserId, selfApprove })
      writeJson(res, 200, result)
    } catch (err) {
      console.error("[picc] ewallet submit failed:", err.message)
      writeJson(res, 400, { error: "ewallet submit failed", detail: err.message })
    }
    return
  }

  if (path === "/api/btcpay/invoice" && req.method === "POST") {
    if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "authentication required" })
    if (!hasBtcpay()) return writeJson(res, 503, { error: "BTCPay Server not configured" })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    // Tier is optional on the body; mirror the other grant paths and default
    // to "pro" so a body with no tier still grants a working subscription.
    const tier = validTier(body.tier) ?? "pro"
    try {
      const result = await createBtcpayInvoice({
        amount: body.amount,
        currency: body.currency,
        description: body.description,
        userId,
        tier
      })
      writeJson(res, 200, result)
    } catch (err) {
      console.error("[picc] btcpay invoice failed:", err.message)
      writeJson(res, 400, { error: "btcpay invoice failed", detail: err.message })
    }
    return
  }

  if (path === "/api/btcpay/check" && req.method === "POST") {
    if (!hasBtcpay()) return writeJson(res, 503, { error: "BTCPay Server not configured" })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    const { id } = body
    if (!id) return writeJson(res, 400, { error: "invoice id required" })
    try {
      const info = await btcpayInvoiceStatus(id)
      if (info.status === "Settled" && info.userId === userId) {
        await syncSubscription({ userId, status: "active", tier: info.tier, stripeCustomerId: null })
        return writeJson(res, 200, { ok: true, status: info.status, tier: info.tier })
      }
      writeJson(res, 200, { ok: false, status: info.status })
    } catch (err) {
      console.error("[picc] btcpay check failed:", err)
      writeJson(res, 400, { error: "btcpay check failed", detail: err.message })
    }
    return
  }

  if (path === "/api/btcpay/status" && (req.method === "GET" || req.method === "POST")) {
    writeJson(res, 200, await btcpayNodeHealth())
    return
  }

  // -------------------------------------------------------------------
  // Connectors — every income source behind one interface. Browser
  // transport drives a real Chrome/Edge profile via CDP (login once, then
  // read the live dashboard DOM + the page's own WebSocket frames).
  // Read-only by design: PICC never executes on external platforms.
  // -------------------------------------------------------------------
  if (path === "/api/connectors" && (req.method === "GET" || req.method === "POST")) {
    const connectors = listConnectors().map((c) => ({
      slug: c.slug,
      label: c.label,
      category: c.category,
      transports: c.transports,
      transport: c.transport,
      url: c.url,
      tuned: c.tuned,
      selectors: c.selectors
    }))
    writeJson(res, 200, { ok: true, browser: await browserAvailable(), connectors, latest: await getLatestSnapshots() })
    return
  }

  const historyMatch = path.match(/^\/api\/connectors\/([a-z0-9_-]+)\/history$/)
  if (historyMatch && req.method === "GET") {
    const slug = historyMatch[1].toLowerCase()
    if (!getConnector(slug)) return writeJson(res, 404, { ok: false, error: `unknown connector "${slug}"` })
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    const limit = Number(parsed.searchParams.get("limit")) || 100
    writeJson(res, 200, { ok: true, provider: slug, history: await getConnectorHistory(slug, limit) })
    return
  }

  const streamMatch = path.match(/^\/api\/connectors\/([a-z0-9_-]+)\/stream$/)
  if (streamMatch && req.method === "GET") {
    const slug = streamMatch[1].toLowerCase()
    const conn = getConnector(slug)
    if (!conn) return writeJson(res, 404, { ok: false, error: `unknown connector "${slug}"` })
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    // Same cross-origin snooping guard as the other SSE streams.
    const origin = req.headers.origin
    if (origin && !TRUSTED_ORIGINS.includes(String(origin))) {
      writeJson(res, 403, { error: "origin not allowed" })
      return true
    }
    const headless = parsed.searchParams.get("headless") !== "false"
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    })
    const send = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch {
        /* socket gone */
      }
    }
    send("ready", { ok: true, slug })
    try {
      const session = await withTimeout(openLiveSession(slug, { headless }), 45000)
      if (session.latest) send("snapshot", session.latest)
      const off = subscribeLive(slug, (msg) => send(msg.type, msg.type === "frame" ? msg.frame : msg))
      const keepalive = setInterval(() => {
        try {
          res.write(": ping\n\n")
        } catch {
          /* ignore */
        }
      }, 15000)
      const detach = () => {
        off()
        clearInterval(keepalive)
        if (liveSubscriberCount(slug) === 0) closeLiveSession(slug).catch(() => {})
      }
      req.on("close", detach)
      res.on("close", detach)
    } catch (err) {
      send("error", { error: err.message })
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
    return
  }

  const collectMatch = path.match(/^\/api\/connectors\/([a-z0-9_-]+)\/collect$/)
  if (collectMatch && req.method === "POST") {
    const slug = collectMatch[1].toLowerCase()
    const conn = getConnector(slug)
    if (!conn) return writeJson(res, 404, { ok: false, error: `unknown connector "${slug}"` })
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    if (rateLimited(`connectors:${clientIp(req)}`, 10, 60_000)) {
      return writeJson(res, 429, { error: "too many collections — try again in a minute" })
    }
    try {
      const snapshot = await withTimeout(
        collectSource(slug, {
          headless: body.headless !== false,
          waitMs: Number(body.waitMs) || 9000,
          url: body.url,
          selectors: body.selectors
        }),
        60000
      )
      if (snapshot.bridge) {
        await snapshot.bridge.close().catch(() => {})
        delete snapshot.bridge
      }
      if (snapshot.status === "ok") await persistSnapshot(snapshot).catch(() => {})
      writeJson(res, 200, snapshot)
    } catch (err) {
      console.warn(`[picc] connector ${slug} collect failed:`, err.message)
      writeJson(res, 502, normalizeEarnings({ provider: slug, platform: conn.label, source: conn.transport, status: "error", error: err.message }))
    }
    return
  }

  // Autodetect (Task 3): propose — never trust — an income-site adaptor.
  // Rate-limited; returns the proposal alone (no write to the registry). A
  // tuned adaptor is only ever reachable by a human, never by this endpoint.
  if (path === "/api/connectors/autodetect" && req.method === "POST") {
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    if (rateLimited(`autodetect:${clientIp(req)}`, 10, 60_000)) {
      return writeJson(res, 429, { error: "too many autodetect calls — try again in a minute" })
    }
    try {
      const proposal = fingerprint({
        url: body.url,
        domNodes: Array.isArray(body.dom) ? body.dom : undefined,
        storageKeys: Array.isArray(body.storageKeys) ? body.storageKeys : undefined,
        wsUrls: Array.isArray(body.wsUrls) ? body.wsUrls : undefined
      })
      writeJson(res, 200, { ok: true, result: proposal })
    } catch (err) {
      console.warn("[picc] autodetect failed:", err.message)
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  // Streaming download of a file captured by the integrated browser. Kept
  // outside BROWSER_ROUTES because it is a raw byte stream, not JSON.
  const downloadMatch = path.match(/^\/api\/browser\/download\/(\d+)$/)
  if (downloadMatch && req.method === "GET") {
    if (!(await requireAuth(req, res))) return
    try {
      const dl = await withTimeout(studioDownloadFile(downloadMatch[1]), 30000)
      const { createReadStream } = await import("node:fs")
      const stat = await import("node:fs/promises").then((fs) => fs.stat(dl.path)).catch(() => null)
      const filename = String(dl.filename || "download.bin").replace(/[^a-zA-Z0-9._-]/g, "_")
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": stat?.size ?? 0
      })
      createReadStream(dl.path).pipe(res)
    } catch (err) {
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "BROWSER_CLOSED" ? 409 : err.code === "NO_BROWSER" ? 424 : 500
      writeJson(res, status, { ok: false, error: err.message })
    }
    return
  }

  const browserHandler = BROWSER_ROUTES[path]
  if (browserHandler) {
    const handled = await browserHandler(req, res, { ...parsed, searchParams: parsed.searchParams, body })
    if (handled) return
    // Handler returned falsy WITHOUT writing a response → fall through to the
    // 404 below. If it DID already write headers (a bug elsewhere in this
    // table), attempting a second write would throw ERR_HTTP_HEADERS_SENT and
    // take the whole process down — stop here instead.
    if (res.headersSent) return
  }

  // ── Prometheus metrics endpoint ───────────────────────────────────────────
  if (path === "/api/metrics" && req.method === "GET") {
    const accept = req.headers.accept ?? ""
    if (accept.includes("text/plain") || accept.includes("text/markdown")) {
      const m = getMetrics()
      writeJson(res, 200, m)
    } else {
      const text = prometheusMetrics()
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" })
      res.end(text)
    }
    return
  }

  // Per-ministry integration catalog (R9.2). Read-only: the registry is a
  // static seed with honest boundary metadata; state is "unconfigured" until
  // a probe proves otherwise. Unknown ministry -> honest empty list, not 404.
  if (path === "/api/integrations" && req.method === "GET") {
    writeJson(res, 200, getAllIntegrations())
    return
  }

  if (path.startsWith("/api/integrations/") && req.method === "GET") {
    const ministry = path.slice("/api/integrations/".length)
    writeJson(res, 200, { ok: true, entries: getMinistryIntegrations(ministry) })
    return
  }

  if (!res.headersSent) writeJson(res, 404, { error: "Not found" })
}

// -------------------------------------------------------------------
// Browser Studio — the integrated browser embedded in the dashboard.
// One real Chromium (CDP screencast) for ALL income sources: PICC can
// overlay, cast, and drive it. Credentials the user entrusts to PICC are
// stored in the vault and offered back as autofill.
// -------------------------------------------------------------------
const BROWSER_ROUTES = {
  "/api/browser/status": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "GET") return false
    const sites = await getVaultSites()
    writeJson(res, 200, { ...studioStatus(), available: await browserAvailable(), vaultSites: sites.length })
    return true
  },
  "/api/browser/open": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    try {
      // WINDOW-FIRST: PICC opens the studio as a real, separate, visible
      // browser window it fully intercepts (inputs, console, network, DOM,
      // dialogs, navigation) and keeps tab state in sync both ways. The
      // headless flag is honored when the client explicitly sends one
      // (headless:true forces the embedded/background mode); when omitted,
      // the window-first default in resolveStudioHeadless applies.
      const status = await withTimeout(openStudio({ headless: parsed.body?.headless }), 45000)
      writeJson(res, 200, status)
    } catch (err) {
      writeJson(res, err.code === "NO_BROWSER" ? 424 : 500, { ok: false, error: err.message })
    }
    return true
  },
  "/api/browser/close": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    writeJson(res, 200, { ...(await closeStudio()), available: await browserAvailable() })
    return true
  },
  "/api/browser/goto": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioGoto(parsed.body?.url))
  },
  "/api/browser/nav": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioNav(parsed.body?.action))
  },
  "/api/browser/tab": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioTab(parsed.body ?? {}))
  },
  "/api/browser/refresh-login": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => refreshLoginStates())
  },
  "/api/browser/input": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioInput(parsed.body ?? {}))
  },
  "/api/browser/upload": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioUploadFiles(parsed.body ?? {}))
  },
  "/api/browser/clipboard/copy": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioCopySelection())
  },
  "/api/browser/downloads": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "GET") return false
    return browserGuard(res, () => studioDownloads())
  },
  "/api/browser/overlay": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioOverlay(parsed.body ?? {}))
  },
  "/api/browser/overlay/toggle": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioOverlayToggle(parsed.body?.force))
  },
  "/api/browser/read": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioRead({ selectors: parsed.body?.selectors }))
  },
  "/api/browser/autofill": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioAutofill({ site: parsed.body?.site }))
  },
  "/api/browser/login": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    let result
    try {
      result = await withTimeout(studioLogin({ site: parsed.body?.site }), 45000)
    } catch (err) {
      writeJson(res, err.code === "BROWSER_CLOSED" ? 409 : err.code === "NO_BROWSER" ? 424 : 400, { ok: false, error: err.message })
      return true
    }
    // Google: when the live browser session is now signed into an account that
    // differs from the stored link, rebind the linked identity to the CURRENT
    // account — covers manual sign-ups / account switches inside the browser.
    if (result?.ok && result.mode === "google" && result.boundTo) {
      const userId = await verifyUser(req.headers.authorization).catch(() => null)
      if (userId) {
        try {
          const creds = await getSiteCredentials("google")
          await linkIdentity(userId, "google", { username: result.boundTo })
          if (creds?.password) await saveSiteCredentials("google", { username: result.boundTo, password: creds.password })
          result.boundAccount = result.boundTo
        } catch (err) {
          result.bindError = String(err?.message ?? err)
        }
      }
    }
    writeJson(res, 200, result)
    return true
  },
  "/api/browser/capture-session": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, async () => {
      const r = await captureExpertOptionSession()
      return { ...r, token: maskToken(r.token) }
    })
  },
  "/api/browser/automate": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioAutomate())
  },
  "/api/browser/automate/start": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    try {
      writeJson(res, 200, startStudioAutomation({ intervalMs: parsed.body?.intervalMs }))
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return true
  },
  "/api/browser/automate/stop": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    writeJson(res, 200, stopStudioAutomation())
    return true
  },
  "/api/browser/automate/status": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "GET") return false
    return browserGuard(res, () => studioAutomationStatus())
  },
  "/api/browser/intel": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "GET") return false
    return browserGuard(res, () => getBrowserIntel())
  },
  "/api/browser/dialog": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioDialog(parsed.body ?? {}))
  },
  "/api/browser/import-profile": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    try {
      const result = importRealProfile({
        realProfilePath: parsed.body?.realProfilePath,
        profile: parsed.body?.profile || "studio"
      })
      writeJson(res, 200, { ok: true, ...result, state: realProfileState(parsed.body?.realProfilePath) })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message, state: realProfileState(parsed.body?.realProfilePath) })
    }
    return true
  },
  "/api/browser/assist": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "GET" && req.method !== "POST") return false
    const site = detectSite(parsed.body?.url ?? studioStatus().currentUrl ?? "")
    if (site && /accounts\.google\.com|gmail\.com|mail\.google\.com|myaccount\.google\.com/i.test(site.host)) {
      site.name = "Google"
      site.category = "login"
      site.url = "https://accounts.google.com"
      site.note = "One-tap login: PICC fills AND submits the two-step Google sign-in (email → Next → password → Next). Save your Google credentials in the vault once, then re-login automatically."
    }
    const creds = site ? await getSiteCredentials(site.name) : null
    writeJson(res, 200, { ok: true, site, suite: suiteForSite(site), hasSavedCredentials: Boolean(creds) })
    return true
  },
  "/api/browser/settings": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method === "GET") {
      writeJson(res, 200, { ok: true, settings: await getBrowserSettings() })
      return true
    }
    if (req.method === "POST") {
      try {
        writeJson(res, 200, { ok: true, settings: await saveBrowserSettings(parsed.body?.settings ?? {}) })
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message })
      }
      return true
    }
    return false
  },
  "/api/browser/permissions": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method === "GET") {
      writeJson(res, 200, { ok: true, permissions: await getSitePermissions(), catalog: PERMISSION_CATALOG })
      return true
    }
    if (req.method === "POST") {
      try {
        writeJson(res, 200, await setSitePermission(parsed.body?.origin, parsed.body?.permission, parsed.body?.setting))
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message })
      }
      return true
    }
    if (req.method === "DELETE") {
      writeJson(res, 200, await removeSitePermissions(parsed.body?.origin))
      return true
    }
    return false
  },
  "/api/browser/prefs": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method === "GET") {
      writeJson(res, 200, { ok: true, prefs: await getBrowserPreferences() })
      return true
    }
    if (req.method === "POST") {
      try {
        writeJson(res, 200, await saveBrowserPreference(parsed.body?.site, parsed.body?.prefs ?? {}))
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message })
      }
      return true
    }
    return false
  },
  "/api/browser/suite-presets": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method === "GET") {
      writeJson(res, 200, { ok: true, presets: await getSuitePresets() })
      return true
    }
    if (req.method === "POST") {
      try {
        writeJson(res, 200, await saveSuitePreset(parsed.body?.suite, parsed.body?.settings ?? {}))
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message })
      }
      return true
    }
    return false
  },
  "/api/browser/site": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    return browserGuard(res, () => studioOpenSite(parsed.body ?? {}))
  },
  "/api/browser/credentials": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method === "GET") {
      const sites = await getVaultSites()
      const list = []
      for (const s of sites) {
        const c = await getSiteCredentials(s)
        list.push({ site: s, username: c?.username ?? "", updatedAt: c?.updatedAt ?? null })
      }
      writeJson(res, 200, { ok: true, sites: list })
      return true
    }
    if (req.method === "POST") {
      try {
        writeJson(res, 200, await saveSiteCredentials(parsed.body?.site, {
          username: parsed.body?.username,
          password: parsed.body?.password
        }))
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message })
      }
      return true
    }
    if (req.method === "DELETE") {
      writeJson(res, 200, await deleteSiteCredentials(parsed.body?.site))
      return true
    }
    return false
  },
  "/api/browser/interventions": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "GET") return false
    writeJson(res, 200, interventions.listInterventions())
    return true
  },
  "/api/browser/interventions/respond": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    try {
      writeJson(res, 200, await interventions.respondIntervention(parsed.body))
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err?.message ?? "bad intervention response" })
    }
    return true
  },
  "/api/browser/workflows": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "GET") return false
    writeJson(res, 200, { ok: true, workflows: interventions.listWorkflows() })
    return true
  },
  "/api/browser/workflows/save": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    try {
      writeJson(res, 200, { ok: true, workflow: interventions.saveWorkflow(parsed.body) })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err?.message ?? "bad workflow" })
    }
    return true
  },
  "/api/browser/workflows/run": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    try {
      writeJson(res, 200, await interventions.runWorkflow(parsed.body))
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err?.message ?? "could not start workflow" })
    }
    return true
  },
  "/api/browser/workflows/stop": async (req, res, parsed) => {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "POST") return false
    writeJson(res, 200, interventions.stopWorkflow())
    return true
  },
  "/api/browser/stream": async (req, res, parsed) => {
    // Cross-origin EventSource snooping: any website can open this stream from
    // a visitor's machine. Reject browser-supplied origins that aren't ours.
    const origin = req.headers.origin
    if (origin && !TRUSTED_ORIGINS.includes(String(origin))) {
      writeJson(res, 403, { error: "origin not allowed" })
      return true
    }
    const token = parsed.searchParams.get("token") ?? ""
    const ok = token ? Boolean(await verifyToken(token)) : !(await hasUsers()) || Boolean(await verifyUser(req.headers.authorization))
    if (!ok) { writeJson(res, 401, { error: "authentication required" }); return true }
    if (req.method !== "GET") return false
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    })
    const send = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch {
        /* socket gone */
      }
    }
    send("ready", { ok: true })
    send("status", studioStatus())
    const frame = latestStudioFrame()
    if (frame) send("frame", { data: frame.data, ts: frame.ts, vp: studioStatus().viewport })
    const off = subscribeStudio((msg) => send(msg.type, msg))
    const keepalive = setInterval(() => {
      try {
        res.write(": ping\n\n")
      } catch {
        /* ignore */
      }
    }, 15000)
    const detach = () => {
      off()
      clearInterval(keepalive)
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
    req.on("close", detach)
    res.on("close", detach)
    return true
  },

  }

async function requireAuth(req, res) {
  if (isLocalhostRequest(req)) return true
  if ((await verifyUser(req.headers.authorization)) || !(await hasUsers())) return true
  writeJson(res, 401, { error: "authentication required" })
  return false
}

async function browserGuard(res, run) {
  try {
    const result = await withTimeout(run(), 45000)
    writeJson(res, 200, result)
  } catch (err) {
    writeJson(res, err.code === "BROWSER_CLOSED" ? 409 : err.code === "NO_BROWSER" ? 424 : 400, { ok: false, error: err.message })
  }
  return true
}

async function handleStripeWebhook(event) {
  const type = event.type
  if (type === "checkout.session.completed") {
    const session = event.data.object
    const userId = session.metadata?.userId ?? session.client_reference_id
    await syncSubscription({
      userId,
      status: "active",
      tier: session.metadata?.tier ?? "pro",
      stripeCustomerId: session.customer
    })
    return
  }
  if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    const sub = event.data.object
    const statusMap = { active: "active", trialing: "trialing", past_due: "past_due", canceled: "canceled", unpaid: "past_due" }
    const priceId = sub.items?.data?.[0]?.price?.id ?? ""
    const tier = priceId === env.stripePriceBusiness ? "business" : "pro"
    await syncSubscription({
      userId: sub.metadata?.userId,
      status: statusMap[sub.status] ?? "canceled",
      tier,
      stripeCustomerId: sub.customer
    })
  }
}

// ---------------------------------------------------------------------
// Body + response helpers
// ---------------------------------------------------------------------

function readRawBody(req, maxBytes = 2e6) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buf.length
      if (size > maxBytes) {
        // Stop consuming immediately — the old code kept appending every
        // chunk after rejection, so the cap never halted intake.
        req.removeAllListeners("data")
        req.removeAllListeners("end")
        try { req.destroy() } catch { /* already gone */ }
        reject(new Error("body too large"))
        return
      }
      chunks.push(buf)
    })
    req.on("end", () => {
      // Buffer-concat then decode once: string += on chunk boundaries splits
      // multibyte UTF-8 sequences and corrupts valid JSON.
      resolve(Buffer.concat(chunks).toString("utf8"))
    })
    req.on("error", reject)
  })
}

function readBody(req) {
  return readRawBody(req).then((raw) => {
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch {
      return null // signal invalid JSON to caller
    }
  })
}

function readBodyMax(req, maxBytes) {
  return readRawBody(req, maxBytes).then((raw) => {
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  })
}

// Baseline hardening headers applied to every JSON response (F-04). The CSP
// keeps the SPA self-only for scripts while allowing the real browser
// surfaces the app uses (dev loopback feeds + cloud data fetch
// https/wss). frame-ancestors none + X-Frame-Options DENY stop clickjacking
// of a page that touches payments and broker tokens.
export const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: wss:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
}

export function writeJson(res, status, payload) {
  const json = JSON.stringify(payload)
  // Origin-specific CORS instead of wildcard — prevents credentialed cross-origin abuse
  const reqOrigin = res.req?.headers?.origin
  const allowedOrigin = reqOrigin && TRUSTED_ORIGINS.includes(reqOrigin) ? reqOrigin : null
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json)
  }
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    headers["Access-Control-Allow-Credentials"] = "true"
    headers["Vary"] = "Origin"
  }
  res.writeHead(status, headers)
  res.end(json)
}

function sendProfilePage(res, status, message, success) {
  const safe = String(message ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0; url=/profile${success ? "?github=linked" : "?github=error"}">
<title>PICC — GitHub link</title></head>
<body style="margin:0;background:#0b0b16;color:#eef0ff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh">
<div style="text-align:center;padding:24px"><h1 style="font-size:48px;margin:0 0 8px">${success ? "&#10003;" : "&#9888;"}</h1>
<p style="opacity:.85">${safe}</p><p style="opacity:.5;font-size:13px">Redirecting to Profile…</p></div></body></html>`
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(html)
  })
  res.end(html)
}
