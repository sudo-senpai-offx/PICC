// Shared API handlers for the PICC dashboard server (dev middleware + prod).
// Real data path: Yahoo Finance -> Monte Carlo, Serper research, hybrid cloud LLM
// (gemini/groq/mistral/cerebras/openai with automatic failover), Stripe billing,
// Supabase sync. Every provider degrades with an honest fallback.
import { createHash } from "node:crypto"
import { env, providers } from "./config.mjs"
import { getHistory, statsFromHistory, downsample, clampDrift, clampVol, getQuote } from "./services/yahoo.mjs"
import { researchTopic } from "./services/serper.mjs"
import { chatJSON, chatText, asSuggestionArray, provider, llmConfigured } from "./services/llm.mjs"
import { createCheckoutSession, createPortalSession, constructWebhookEvent, hasStripe } from "./services/stripe.mjs"
import { createPayPalOrder, capturePayPalOrder, hasPayPal } from "./services/paypal.mjs"
import { createEwalletOrder, submitEwalletOrder, walletInfo, WALLET_IDS } from "./services/ewallet.mjs"
import { createBtcpayInvoice, btcpayInvoiceStatus, hasBtcpay, btcpayNodeHealth } from "./services/btcpay.mjs"
import { getCompetitorData } from "./services/amazon.mjs"
import { fetchHoneygainSnapshot, fetchCashPilotSummary, fetchCashPilotDaily, fetchCashPilotBreakdown } from "./services/collectors.mjs"
import {
  automatorStatus,
  getCredentials,
  saveCredentials,
  getSnapshot,
  saveSnapshot,
  recordPresence,
  presenceStatus,
  scanNodes,
  providerDetail,
  QUEST_CATALOG
} from "./services/automator.mjs"
import { forecastSeries } from "./services/forecast.mjs"
import { getCryptoMarket, getCryptoPrice } from "./services/crypto.mjs"
import { yieldSnapshot } from "./services/yields.mjs"
import { schedulerStatus } from "./services/scheduler.mjs"
import { automatorAssist, automatorHealth } from "./services/automatorAdvice.mjs"
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
import { syncSubscription } from "./services/supabase.mjs"
import { runMonteCarlo } from "./monteCarlo.mjs"
import {
  tradingStatus,
  predictSymbol,
  analyzeExpertOptionAsset,
  openPaperTrade,
  closePaperTrade,
  paperPositions,
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
  getCredentials as getTradingCredentials,
  saveCredentials as saveTradingCredentials
} from "./services/trading.mjs"
import { proAnalyzeSymbol, proAnalyzeExpertOption, summarizeProAnalysis } from "./services/proanalysis.mjs"
import { subscribeLiveEO, liveEOStats, liveSnapshot } from "./services/liveEO.mjs"
import { tradingSuiteSnapshot, bustRealtimeSuite } from "./services/realtimeSuite.mjs"
import { subscribeDecisions, getDecisions, observedPayouts } from "./services/adaptiveConfluence.mjs"
import { getMarketIntel } from "./services/marketIntel.mjs"
import { ledgerHistory, ledgerStats, ledgerEngineStats, flushLedger, backtestGates } from "./services/accuracyLedger.mjs"
import {
  saveLLMSettings,
  llmSettingsView,
  PROVIDER_IDS
} from "./services/llmSettings.mjs"
import { testLLMProvider } from "./services/llm.mjs"
import {
  demoStatus as expertOptionDemoStatus,
  demoDeals,
  demoAnalytics,
  placeDemoTrade,
  getAutopilotConfig,
  saveAutopilotConfig,
  startAutopilot,
  stopAutopilot
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
import { browserAvailable, realProfileState, importRealProfile } from "./services/browserBridge.mjs"
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
import * as interventions from "./services/interventions.mjs"

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function platformOf(url) {
  try {
    const host = new URL(url).hostname
    if (host.includes("amazon")) return "amazon"
    if (host.includes("youtube")) return "youtube"
    if (host.includes("fidelity") || host.includes("schwab") || host.includes("etrade")) return "brokerage"
  } catch {
    /* ignore */
  }
  return null
}

function validTier(tier) {
  return tier === "pro" || tier === "business" ? tier : null
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))])
}

const AUTOMATOR_SECRET_FIELDS = [
  "pawnsPassword",
  "pawnsToken",
  "honeygainToken",
  "traffmonetizerToken",
  "repocketPassword",
  "repocketToken",
  "earnappOAuthToken",
  "earnappBrdSessionId"
]

function maskAutomatorCredentials(creds) {
  const out = { ...creds }
  for (const field of AUTOMATOR_SECRET_FIELDS) {
    out[field] = creds[field] ? "••••••" : ""
  }
  return out
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

function clientIp(req) {
  const xff = req.headers?.["x-forwarded-for"]
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim()
  return req.socket?.remoteAddress ?? "unknown"
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

function ruleBasedExtensionSuggestions(platform, pageTitle) {
  if (platform === "amazon") {
    return [
      {
        id: "amz-title",
        title: "Optimize listing title",
        body: `Based on "${pageTitle}", front-load the top search keyword and move brand/colour to the middle to lift CTR.`,
        confidence: 0.7
      },
      {
        id: "amz-bullets",
        title: "Lead with a benefit bullet",
        body: "Reorder bullets so the first states the #1 customer benefit, not a spec. Keep each under 200 characters.",
        confidence: 0.64
      }
    ]
  }
  if (platform === "youtube") {
    return [
      {
        id: "yt-title",
        title: "Stronger title pattern",
        body: `Titles that start with a concrete outcome or number outperform. Try a variant of: "${pageTitle}" → outcome-first phrasing.`,
        confidence: 0.66
      },
      {
        id: "yt-tags",
        title: "Expand tag coverage",
        body: "Add 3-5 long-tail tags from the passive income niche plus a competitor channel name (tag) to broaden discovery.",
        confidence: 0.58
      }
    ]
  }
  return [
    {
      id: "brk-rebalance",
      title: "Re-balance check",
      body: "Page detected as a brokerage. Compare current holdings against a 60/30/10 equity/bond/cash target; rebalance only if drift exceeds 5%.",
      confidence: 0.62
    },
    {
      id: "brk-dca",
      title: "Dollar-cost averaging",
      body: "Historical data suggests regular contributions beat lump-sum timing. Set an auto-invest schedule at your own brokerage.",
      confidence: 0.6
    }
  ]
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

async function handleExtensionSuggest(body) {
  const platform = body.platform ?? platformOf(body.url ?? "")
  const pageTitle = body.pageTitle ?? ""
  const pageData = body.pageData ?? {}

  if (!platform) return { suggestions: [], source: "unsupported" }

  if (llmConfigured() && pageData && (pageData.title || pageData.videoTitle)) {
    try {
      const context =
        platform === "amazon"
          ? `Amazon listing\nTitle: ${pageData.title ?? pageTitle}\nBrand: ${pageData.brand ?? ""}\nBullets:\n${(pageData.bullets ?? []).map((b) => `- ${b}`).join("\n")}`
          : platform === "youtube"
            ? `YouTube video\nTitle: ${pageData.videoTitle ?? pageTitle}\nChannel: ${pageData.channelName ?? ""}\nDescription: ${(pageData.description ?? "").slice(0, 800)}`
            : `Page title: ${pageTitle}`

      const parsed = await withTimeout(
        chatJSON(
          "You are PICC, a decision-support assistant for passive income creators. " +
            "Return JSON: { suggestions: [ { id, title, body (<=220 chars, specific and actionable), confidence (0-1) } ] }. " +
            "Amazon: optimize listing title/bullets for CTR and conversion. YouTube: better title pattern, tags, description hook. Brokerage: rebalancing or DCA guidance. 2-4 suggestions. No code, no claims of guaranteed results.",
          context,
          { maxTokens: 1000 }
        ),
        25000
      )
      return { suggestions: asSuggestionArray(parsed.suggestions), source: provider() }
    } catch (err) {
      console.warn("[picc] extension AI failed, using rule engine:", err.message)
    }
  }

  return { suggestions: ruleBasedExtensionSuggestions(platform, pageTitle), source: "local" }
}

// ---------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------

export function isApiRequest(url) {
  return url.startsWith("/api/")
}

export async function handleApi(req, res, url) {
  const parsed = new URL(url, `http://${req.headers.host ?? "localhost"}`)
  const path = parsed.pathname
  const body = path === "/api/browser/upload" ? await readBodyMax(req, 64e6) : await readBody(req)
  const auth = req.headers.authorization

  if (path === "/api/health" && (req.method === "GET" || req.method === "POST")) {
    let agents = null
    if (env.agentsUrl) {
      try {
        const r = await withTimeout(fetch(`${env.agentsUrl}/health`), 3000)
        agents = { url: env.agentsUrl, ok: r.ok, ...(await r.json()) }
      } catch {
        agents = { url: env.agentsUrl, ok: false }
      }
    }
    writeJson(res, 200, { ok: true, version: "0.2.0", providers: providers(), agents })
    return
  }

  if (path === "/api/twin/run" && req.method === "POST") {
    try {
      writeJson(res, 200, await handleTwinRun(body))
    } catch (err) {
      console.error("[picc] twin failed:", err)
      writeJson(res, 500, { error: "simulation failed", detail: err.message })
    }
    return
  }

  if (path === "/api/finance/quote" && req.method === "POST") {
    const tickers = Array.isArray(body.tickers) ? body.tickers.map(String).filter(Boolean) : []
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
      writeJson(res, 502, { error: err.message })
    }
    return
  }

  if (path === "/api/crypto/market" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await withTimeout(getCryptoMarket(), 20000))
    } catch (err) {
      console.warn("[picc] crypto market failed:", err.message)
      writeJson(res, 502, { error: err.message })
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

  if (path === "/api/trading/realtime" && req.method === "GET") {
    const token = parsed.searchParams.get("token") ?? ""
    const ok = token ? Boolean(await verifyToken(token)) : !(await hasUsers()) || Boolean(await verifyUser(req.headers.authorization))
    if (!ok) return writeJson(res, 401, { error: "authentication required" })
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
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
    let keepalive = null
    let suiteTimer = null
    const detach = () => {
      if (detached) return
      detached = true
      if (off) off()
      if (offDecisions) offDecisions()
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
    const ok = token ? Boolean(await verifyToken(token)) : !(await hasUsers()) || Boolean(await verifyUser(req.headers.authorization))
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
    const limit = Number(parsed.searchParams.get("limit") ?? 200)
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
    const limit = Number(parsed.searchParams.get("limit") ?? 200)
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
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    if (req.method === "GET") {
      const creds = await getTradingCredentials()
      writeJson(res, 200, {
        ...creds,
        expertoptionToken: creds.expertoptionToken ? "••••••" : ""
      })
      return
    }
    try {
      const creds = await saveTradingCredentials(body)
      writeJson(res, 200, { ok: true, ...creds, expertoptionToken: creds.expertoptionToken ? "••••••" : "" })
    } catch (err) {
      console.error("[picc] trading credentials failed:", err)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/predict" && req.method === "POST") {
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
    try {
      const settings = body?.settings
      if (!settings || typeof settings !== "object") {
        return writeJson(res, 400, { error: "settings object required" })
      }
      const saved = await saveLLMSettings(settings)
      writeJson(res, 200, { ok: true, settings: saved })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/settings/llm/test" && req.method === "POST") {
    const providerId = String(body?.provider ?? "").trim()
    if (!PROVIDER_IDS.includes(providerId)) {
      return writeJson(res, 400, { error: "unknown provider" })
    }
    try {
      writeJson(res, 200, await withTimeout(testLLMProvider(providerId), 20000))
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/paper/trade" && req.method === "POST") {
    try {
      writeJson(res, 200, { ok: true, position: await openPaperTrade(body) })
      bustRealtimeSuite()
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/paper/close" && req.method === "POST") {
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

  if (path === "/api/trading/paper/history" && (req.method === "GET" || req.method === "POST")) {
    writeJson(res, 200, { ok: true, closed: await paperHistory(Number(body?.limit) || 50) })
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
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    try {
      const deal = await withTimeout(
        placeDemoTrade({
          assetId: String(body?.assetId ?? "").trim(),
          type: String(body?.type ?? "call").toLowerCase(),
          amount: body?.amount != null ? Number(body.amount) : null,
          duration: body?.duration != null ? Number(body.duration) : 60
        }),
        25000
      )
      writeJson(res, 200, { ok: true, deal })
      bustRealtimeSuite()
    } catch (err) {
      console.warn("[picc] demo trade failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/autopilot" && req.method === "GET") {
    try {
      writeJson(res, 200, { ok: true, config: await getAutopilotConfig() })
    } catch (err) {
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/autopilot" && req.method === "POST") {
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
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
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    try {
      writeJson(res, 200, { ok: true, config: await startAutopilot() })
      bustRealtimeSuite()
    } catch (err) {
      console.warn("[picc] autopilot start failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/autopilot/stop" && req.method === "POST") {
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    try {
      writeJson(res, 200, { ok: true, config: await stopAutopilot(String(body?.reason ?? "manual")) })
      bustRealtimeSuite()
    } catch (err) {
      console.warn("[picc] autopilot stop failed:", err.message)
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
      writeJson(res, 200, await demoDeals(Number(body?.limit) || Number(parsed.searchParams.get("limit")) || 50))
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
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

  if (path === "/api/collectors/honeygain" && req.method === "POST") {
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    const token = String(body.token || "").trim()
    if (!token) return writeJson(res, 400, { error: "token required" })
    try {
      writeJson(res, 200, await withTimeout(fetchHoneygainSnapshot(token), 25000))
    } catch (err) {
      console.warn("[picc] honeygain collector failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/collectors/cashpilot" && req.method === "POST") {
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    const baseUrl = String(body.url || "").trim()
    const key = String(body.key || "").trim()
    if (!baseUrl) return writeJson(res, 400, { error: "cashpilot url required" })
    if (!isHttpUrl(baseUrl)) return writeJson(res, 400, { error: "cashpilot url must be an http(s) address" })
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
    const redirectUri = `http://${req.headers.host ?? "localhost"}/api/profile/github/callback`
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

  // -------------------------------------------------------------------
  // PICC Automator — Tier 0 stream monitoring, nodes, quests, presence
  // -------------------------------------------------------------------
  if (path === "/api/automator/credentials" && (req.method === "GET" || req.method === "POST")) {
    if (!(await verifyUser(auth)) && (await hasUsers())) {
      return writeJson(res, 401, { error: "authentication required" })
    }
    if (req.method === "GET") {
      const creds = await getCredentials()
      writeJson(res, 200, maskAutomatorCredentials(creds))
      return
    }
    try {
      const creds = await saveCredentials(body)
      // Never echo stored secrets back — mask them exactly like GET.
      writeJson(res, 200, { ok: true, ...maskAutomatorCredentials(creds) })
    } catch (err) {
      console.error("[picc] automator credentials failed:", err)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/automator/status" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await automatorStatus())
    } catch (err) {
      console.error("[picc] automator status failed:", err)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/automator/detail" && (req.method === "GET" || req.method === "POST")) {
    const slug = String(body?.platform ?? body?.slug ?? "").trim().toLowerCase()
    if (!slug) return writeJson(res, 400, { error: "platform slug required" })
    try {
      writeJson(res, 200, await providerDetail(slug))
    } catch (err) {
      console.error("[picc] automator detail failed:", err)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/automator/nodes" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, { ok: true, nodes: await scanNodes() })
    } catch (err) {
      console.error("[picc] automator node scan failed:", err)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/automator/quests" && (req.method === "GET" || req.method === "POST")) {
    writeJson(res, 200, { ok: true, quests: QUEST_CATALOG })
    return
  }

  if (path === "/api/automator/presence" && req.method === "POST") {
    writeJson(res, 200, await recordPresence(body?.device))
    return
  }

  if (path === "/api/automator/presence" && req.method === "GET") {
    writeJson(res, 200, await presenceStatus())
    return
  }

  if (path === "/api/automator/health" && (req.method === "GET" || req.method === "POST")) {
    try {
      writeJson(res, 200, await automatorHealth())
    } catch (err) {
      console.error("[picc] automator health failed:", err)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/automator/assist" && req.method === "POST") {
    try {
      writeJson(res, 200, await automatorAssist(body?.question))
    } catch (err) {
      console.error("[picc] automator assist failed:", err)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
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
    try {
      writeJson(res, 200, await saveSnapshot(body))
    } catch (err) {
      console.error("[picc] streams snapshot failed:", err)
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/streams/snapshot" && req.method === "GET") {
    writeJson(res, 200, await getSnapshot())
    return
  }

  if (path === "/api/listing/analyze" && req.method === "POST") {
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
    writeJson(res, 200, await handleContentGenerate(body))
    return
  }

  if (path === "/api/extension/suggest" && req.method === "POST") {
    writeJson(res, 200, await handleExtensionSuggest(body))
    return
  }

  if (path === "/api/extension/confirm" && req.method === "POST") {
    const id = createHash("sha1").update(`${Date.now()}:${JSON.stringify(body)}`).digest("hex").slice(0, 10)
    console.log(`[picc-confirm] ${id}`, body)
    writeJson(res, 200, { ok: true, id })
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
      const data = await r.json()
      writeJson(res, r.ok ? 200 : 502, data)
    } catch (err) {
      console.error("[picc] agents proxy failed:", err)
      writeJson(res, 502, { error: "agents service unreachable", detail: err.message })
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
      const data = await r.json()
      writeJson(res, r.ok ? 200 : 502, data)
    } catch (err) {
      console.error("[picc] agents settings proxy failed:", err)
      writeJson(res, 502, { error: "agents service unreachable", detail: err.message })
    }
    return
  }

  if (path === "/api/stripe/checkout" && req.method === "POST") {
    if (!hasStripe()) return writeJson(res, 503, { error: "Stripe not configured" })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    const { priceId, tier = "pro" } = body
    if (!priceId) return writeJson(res, 400, { error: "priceId required" })
    try {
      const session = await createCheckoutSession({
        priceId,
        tier,
        userId,
        successUrl: body.successUrl ?? "http://localhost:5173/profile?billing=success",
        cancelUrl: body.cancelUrl ?? "http://localhost:5173/profile"
      })
      writeJson(res, 200, { url: session.url })
    } catch (err) {
      console.error("[picc] stripe checkout failed:", err)
      writeJson(res, 400, { error: "stripe checkout failed", detail: err.message })
    }
    return
  }

  if (path === "/api/stripe/portal" && req.method === "POST") {
    if (!hasStripe()) return writeJson(res, 503, { error: "Stripe not configured" })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    const { customerId } = body
    if (!customerId) return writeJson(res, 400, { error: "customerId required" })
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

  if (path === "/api/paypal/create-order" && req.method === "POST") {
    if (!hasPayPal()) return writeJson(res, 503, { error: "PayPal not configured" })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    const tier = validTier(body.tier)
    if (!tier) return writeJson(res, 400, { error: "tier must be 'pro' or 'business'" })
    try {
      const result = await createPayPalOrder({
        tier,
        userId,
        returnUrl: body.returnUrl ?? "http://localhost:5173/profile?billing=success",
        cancelUrl: body.cancelUrl ?? "http://localhost:5173/pricing"
      })
      writeJson(res, 200, { orderId: result.orderId, url: result.url })
    } catch (err) {
      console.error("[picc] paypal create-order failed:", err)
      writeJson(res, 400, { error: "paypal checkout failed", detail: err.message })
    }
    return
  }

  if (path === "/api/paypal/capture" && req.method === "POST") {
    if (!hasPayPal()) return writeJson(res, 503, { error: "PayPal not configured" })
    const userId = await verifyUser(auth)
    if (!userId) return writeJson(res, 401, { error: "authentication required" })
    const { orderId } = body
    if (!orderId) return writeJson(res, 400, { error: "orderId required" })
    try {
      const result = await capturePayPalOrder(orderId)
      await syncSubscription({ userId: result.userId, status: "active", tier: result.tier, stripeCustomerId: null })
      writeJson(res, 200, { ok: true, tier: result.tier, captureId: result.captureId })
    } catch (err) {
      console.error("[picc] paypal capture failed:", err)
      writeJson(res, 400, { error: "paypal capture failed", detail: err.message })
    }
    return
  }

  if (path === "/api/billing/ewallet/order" && req.method === "POST") {
    if (!(await verifyUser(auth)) && (await hasUsers())) return writeJson(res, 401, { error: "authentication required" })
    const ewallet = String(body.ewallet ?? "tng").toLowerCase()
    if (!walletInfo(ewallet)) return writeJson(res, 400, { error: `unsupported eWallet (use ${WALLET_IDS.join(", ")})` })
    try {
      const result = await createEwalletOrder({
        ewallet,
        amount: body.amount,
        currency: body.currency,
        description: body.description
      })
      writeJson(res, 200, result)
    } catch (err) {
      console.error("[picc] ewallet order failed:", err.message)
      writeJson(res, 400, { error: "ewallet order failed", detail: err.message })
    }
    return
  }

  if (path === "/api/billing/ewallet/submit" && req.method === "POST") {
    const { orderId, confirmRef } = body
    if (!orderId) return writeJson(res, 400, { error: "orderId required" })
    try {
      const result = await submitEwalletOrder({ orderId, confirmRef })
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
    try {
      const result = await createBtcpayInvoice({
        amount: body.amount,
        currency: body.currency,
        description: body.description
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
    const headless = parsed.searchParams.get("headless") !== "false"
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
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
  }

  writeJson(res, 404, { error: "Not found" })
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
      // PICC always renders pages in its own embedded engine and streams them
      // to the content window — a separate headed window is never opened. The
      // headless flag is accepted for API compatibility but not used.
      const status = await withTimeout(openStudio({ headless: Boolean(parsed.body?.headless) }), 45000)
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
    const token = parsed.searchParams.get("token") ?? ""
    const ok = token ? Boolean(await verifyToken(token)) : !(await hasUsers()) || Boolean(await verifyUser(req.headers.authorization))
    if (!ok) return writeJson(res, 401, { error: "authentication required" })
    if (req.method !== "GET") return false
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
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

  // Extension-supplied page metrics (received from content script via background)
  "/api/browser/metrics": async (req, res, parsed) => {
    if (req.method !== "POST") return false
    const body = parsed.body || {}
    // Store latest metrics in memory (broadcast to dashboard via stream)
    if (!globalThis.__picc_ext_metrics) globalThis.__picc_ext_metrics = {}
    globalThis.__picc_ext_metrics[body.tabId || "active"] = { ...body, receivedAt: Date.now() }
    writeJson(res, 200, { ok: true })
    return true
  },

  // Extension installation status
  "/api/extension/status": async (req, res) => {
    const lastHeartbeat = globalThis.__picc_ext_heartbeat || null
    const isAlive = lastHeartbeat && (Date.now() - lastHeartbeat.timestamp < 30_000)
    writeJson(res, 200, {
      installed: isAlive,
      lastSeen: lastHeartbeat?.timestamp || null,
      lastHeartbeat: lastHeartbeat || null,
      metrics: globalThis.__picc_ext_metrics || {}
    })
    return true
  },

  // Extension heartbeat (background.js calls this every ~12s)
  "/api/extension/heartbeat": async (req, res) => {
    if (req.method !== "POST") return writeJson(res, 405, { error: "POST required" })
    const body = typeof req.__body === "object" ? req.__body : {}
    globalThis.__picc_ext_heartbeat = {
      version: body.extensionVersion || "unknown",
      installTime: body.installTime || null,
      activeTab: body.activeTab || null,
      cookieCount: body.cookieCount || 0,
      timestamp: body.timestamp || Date.now(),
      receivedAt: Date.now()
    }
    writeJson(res, 200, { ok: true })
    return true
  },

  // Extension tab-changed event
  "/api/extension/tab-changed": async (req, res) => {
    if (req.method !== "POST") return writeJson(res, 405, { error: "POST required" })
    const body = typeof req.__body === "object" ? req.__body : {}
    // Update heartbeat with current tab
    if (globalThis.__picc_ext_heartbeat) {
      globalThis.__picc_ext_heartbeat.activeTab = body
      globalThis.__picc_ext_heartbeat.receivedAt = Date.now()
    }
    writeJson(res, 200, { ok: true })
    return true
  }
}

async function requireAuth(req, res) {
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
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
      if (raw.length > maxBytes) reject(new Error("body too large"))
    })
    req.on("end", () => resolve(raw))
    req.on("error", reject)
  })
}

function readBody(req) {
  return readRawBody(req).then((raw) => {
    try {
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
}

function readBodyMax(req, maxBytes) {
  return readRawBody(req, maxBytes).then((raw) => {
    try {
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
}

export function writeJson(res, status, payload) {
  const json = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Length": Buffer.byteLength(json)
  })
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
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(html)
  })
  res.end(html)
}
