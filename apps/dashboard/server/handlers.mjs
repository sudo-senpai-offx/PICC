// Shared API handlers for the PICC dashboard server (dev middleware + prod).
// Real data path: Yahoo Finance -> Monte Carlo, free-source research, hybrid
// cloud+local LLM (groq/others with automatic failover), Stripe billing,
// local JSON billing/subscription sync (Supabase removed — D8). Every
// provider degrades with an honest fallback.
import { env, providers } from "./config.mjs"
import { errorLogEnabled, recordClientReport, writeAuthMeTrace, writeErrorEntry } from "./errorLog.mjs"

/**
 * WS-6 T10 INSTRUMENTATION — one line per /api/auth/me answer.
 *
 * The terminal-performance flake is UNROOTED and this is the tool that would root
 * it, not a hypothesis about it. `src` is "auth-me" so these lines are greppable
 * away from every other entry in the same file, and `run` is the e2e run id so a
 * failing run's lines can be isolated from a noisy shared log.
 *
 * GATED ON PICC_E2E_RUN_ID, NOT ON PICC_ERROR_LOG: round 4 gated this on the master
 * error-log switch, which the e2e harness pins to "0", so no compliant e2e run could
 * produce a line while the file stayed green. See errorLog.mjs. */
function traceAuthMe(branch, extra = {}) {
  try {
    writeAuthMeTrace({ branch, ...extra })
  } catch {
    /* instrumentation must never break the request */
  }
}
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
  storeWriteFailures,
  storeReadFaults,
  hasUsers,
  resolveAuthUser,
  resolveHasUsers,
  firstRunBootstrapAllowed,
  verifyTokenStrict,
  isAuthStoreUnavailable
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
// D2/AC-005: `proAnalyzeExpertOption` (removed with the venue) and the whole
// `liveEO.mjs` import block are gone. Every route that consumed them — the two
// ExpertOption analysis routes, the SSE live-feed subscription, the candles
// liveEO bridge, the quotes/realtime reads, and the EO demo status route — is
// removed in this change.
import { proAnalyzeSymbol, summarizeProAnalysis } from "./services/proanalysis.mjs"
import { subscribeLiveCCXT } from "./services/liveCCXT.mjs"
import { tradingSuiteSnapshot, bustRealtimeSuite } from "./services/realtimeSuite.mjs"
import { subscribeDecisions, subscribeU4faEvents, getDecisions, observedPayouts } from "./services/adaptiveConfluence.mjs"
import { getMarketIntel } from "./services/marketIntel.mjs"
import { ledgerHistory, ledgerStats, ledgerEngineStats, flushLedger, backtestGates } from "./services/accuracyLedger.mjs"
import { pushDispatch, listDispatch, unreadDispatchCount, markDispatchRead } from "./services/dispatch.mjs"
import { onDispatchLive } from "./services/dispatchSection.mjs"
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
  // D2/AC-005: `demoStatus` is no longer imported — the `/api/trading/demo`
  // route it served is removed. `demoDeals` / `demoAnalytics` are RETAINED:
  // they read the local settled-deals ledger, not the venue.
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
import { appendAudit, readAudit } from "./services/commandCentre/auditTrail.mjs"
import { composeCommandCentreOverview } from "./services/commandCentre/commandCentreOverview.mjs"
import { executionStatus } from "./services/commandCentre/commandCentreExecution.mjs"
import {
  CCXT_ORDER_ACTION,
  CCXT_SITE,
  proposeCcxtOrder,
  executeCcxtOrder,
  verifyCcxtOrder,
  proposalOrdersFromAudit,
  limitPriceSanity,
  consentPayloadHash,
  spotOpenConsent,
  perpsOpenConsent,
  perpsCloseConsent
} from "./services/commandCentre/ccxtExecution.mjs"
import { aggregateRiskState, refreshAggregateRisk } from "./services/commandCentre/riskState.mjs"
import { portfolioHeatUsd } from "./services/commandCentre/riskGates.mjs"
import {
  KNOWN_VENUE_CLASSES,
  storeHealth as ceremonyStoreHealth,
  platformVerification as ceremonyPlatformVerification
} from "./services/commandCentre/ceremonyState.mjs"
import { ceremonyScaleReadout, evaluateCeremony } from "./services/commandCentre/ceremonyGates.mjs"
import {
  storeHealth as leaderIdeasStoreHealth,
  listLeaders as leaderListLeaders,
  followLeader as leaderFollow,
  setPlatformTrust as leaderSetPlatformTrust
} from "./services/commandCentre/leaderIdeasState.mjs"
import { getStartupHealth, runStartupHealth } from "./services/commandCentre/startupHealth.mjs"
import { importLeaderFeed } from "./services/copytrade/csvFeedImport.mjs"
import {
  autoUnfollow as leaderAutoUnfollow,
  sevenDayStop as leaderSevenDayStop
} from "./services/copytrade/leaderGuard.mjs"
import { HIP_NOT_WIRED } from "./services/copytrade/leaderFeedContract.mjs"
import {
  CCXT_EQUITY_STALE_MS,
  ccxtEquityLastObserved,
  observeCcxtEquity,
  fetchReferencePrice,
  placeCcxtOrder,
  verifyCcxtFill
} from "./services/ccxtOrdering.mjs"
import { dayKeyOf } from "./services/u4faRisk.mjs"
import {
  PERPS_OPEN_ACTION,
  PERPS_SITE,
  proposePerpsOpen,
  executePerpsOpen,
  verifyPerpsOpen,
  executePerpsClose,
  perpsProposalsFromAudit,
  closeClientOrderIdFor
} from "./services/commandCentre/perpsExecution.mjs"
import {
  openPositions,
  reconcileWithVenue,
  trackOpen,
  recordClose,
  observePerpsWallet
} from "./services/livePositionManager.mjs"
import { hyperliquidPerps } from "./services/venues/hyperliquidPerps.mjs"

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
  // D2/AC-005: `captureExpertOptionSession` is no longer imported — the
  // `/api/browser/capture-session` route it served is removed with the venue.
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
import { getAllIntegrations, getMinistryIntegrations, getUnauthenticatedIntegrations, getUnauthenticatedMinistryIntegrations } from "./services/integrationRegistry.mjs"
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

/**
 * The address of the socket this request arrived on — the ONE thing the server
 * observed rather than was told.
 *
 * Nothing may consult a header to answer this, because it feeds
 * isLocalhostRequest(), and that function is an AUTH BYPASS. A
 * `X-Forwarded-For: 127.0.0.1` from any peer the server can be tricked into
 * trusting a header from would then walk straight through requireAuth(). So the
 * loopback check and the forwarded-identity check are deliberately two functions.
 */
function peerAddress(req) {
  return req.socket?.remoteAddress ?? null
}

/**
 * THE ONE key-namespace hole: a request with no observable peer address.
 *
 * The previous value was the literal string "unknown", which is a bucket like any
 * other — so every such caller shared ONE server-wide budget, a server-wide
 * bucket by another name and easy to miss precisely because the code reads as
 * though it had handled the missing-address case.
 *
 * Why it stays a single shared bucket rather than becoming a per-request key: a
 * limiter with no identity cannot be attributed, and the two available answers
 * are "limit them together" and "do not limit them". The second is the fail-OPEN
 * one — it hands the caller who can suppress their own address an unlimited
 * budget — so this is conservative. What changed is that the value is now (a) not
 * reachable from a header, so nobody can choose to hide in it, and (b) marked as
 * a sentinel, so it can never be confused with an address a header could produce.
 */
const NO_PEER_IDENTITY = "no-peer-address"

/** An IPv4 dotted quad, and nothing else. */
const IPV4_SHAPE = /^(?:\d{1,3}\.){3}\d{1,3}$/
/** One IPv6 hextet: 1-4 hex digits. */
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/
/** A zone index, e.g. the `%eth0` of a link-local literal. */
const ZONE_INDEX = /^[0-9A-Za-z._-]+$/

/**
 * Is this a usable IPv4 literal?
 *
 * NO LEADING ZEROS, and that is a fix rather than a style preference. The
 * previous predicate accepted `10.0.0.01`, which is a second STRING for one host
 * — so a single machine could hold two limiter buckets, and a caller that
 * presented both spellings escaped half of a per-IP limit. That direction is
 * under-limiting rather than over-trusting, and `req.socket.remoteAddress` is
 * canonical so a peer can never use it to gain trust, but the bound is free to
 * close and the honest reading of a dotted quad does not carry one.
 */
function isIpv4Literal(value) {
  if (!IPV4_SHAPE.test(value)) return false
  return value.split(".").every((octet) => (octet.length > 1 && octet.startsWith("0")) === false && Number(octet) <= 255)
}

/**
 * Is this a usable IPv6 literal, compressed forms included?
 *
 * THE PREVIOUS PREDICATE GOT THIS WRONG IN A WAY THAT MATTERED. It was
 * `(?:[0-9A-Fa-f]{1,4}:){1,7}(?::|[0-9A-Fa-f]{1,4})`, which requires at least one
 * hextet before the first colon — so it rejected EVERY address containing `::`:
 * `::1`, `::`, `::ffff:127.0.0.1`, `2001:db8::1`. Meanwhile `.env.example`
 * documents `PICC_TRUSTED_PROXY_IPS=127.0.0.1,::1`, so the shipped example
 * silently dropped its own IPv6 half: a proxy on IPv6 loopback or an IPv6 VPC
 * address was never trusted, every client collapsed onto the proxy's address
 * again, and the B1 defect this whole slice exists to close reappeared behind
 * exactly the deployment the feature was built for. It failed CLOSED, so it was
 * never a bypass — it was a feature that quietly did not work for half the
 * address space.
 *
 * The grammar implemented here, rather than a shape regex:
 *
 *   - a zone index is allowed and stripped (`fe80::1%eth0`);
 *   - `::` may appear AT MOST ONCE, and only as a whole group;
 *   - without `::` an address is exactly eight hextets;
 *   - with `::` the written hextets number FEWER THAN EIGHT, since the
 *     compressed run must stand for at least one all-zero hextet;
 *   - a dotted quad is legal only as the FINAL group, and counts as two hextets
 *     (`::ffff:127.0.0.1`).
 *
 * WHY NOT `net.isIP()`. It is the honest answer on correctness, and the
 * differential test in rateLimitClientIdentity.test.mjs checks this predicate
 * against it over a corpus precisely because it is hand-written. It is not used
 * HERE because importing `node:net` would add a static import to this file, and
 * the 73-static / 84-dynamic import counts in ws7AuthBootstrapGateGuard are the
 * canary that distinguishes "this round added comments and gates" from "this
 * round changed the module graph". Correctness is bought with a test that
 * compares both parsers; the canary keeps its meaning.
 */
function isIpv6Literal(value) {
  const [address, ...zone] = value.split("%")
  if (zone.length > 1) return false
  if (zone.length === 1 && !ZONE_INDEX.test(zone[0])) return false
  if (!address.includes(":")) return false

  const halves = address.split("::")
  if (halves.length > 2) return false
  const sides = halves.map((half) => (half === "" ? [] : half.split(":")))

  // NaN propagates through the accumulator, so one bad group anywhere fails the
  // whole address rather than being counted as zero.
  const hextets = sides.reduce((total, groups, sideIndex) => {
    const isLastSide = sideIndex === sides.length - 1
    return (
      total +
      groups.reduce((count, group, groupIndex) => {
        if (isLastSide && groupIndex === groups.length - 1 && isIpv4Literal(group)) return count + 2
        return HEX_GROUP.test(group) ? count + 1 : Number.NaN
      }, 0)
    )
  }, 0)
  if (Number.isNaN(hextets)) return false
  return halves.length === 1 ? hextets === 8 : hextets < 8
}

/**
 * Is this string an IP address?
 *
 * The predicate that decides whether a value in the trusted-proxy allowlist, or
 * an entry in a forwarded chain, is an address at all. Everything it rejects
 * falls back to the socket address, so the failure direction is conservative —
 * which is why it is worth getting RIGHT rather than merely strict: a predicate
 * that is too strict is not a security hole, it is a feature that silently does
 * nothing in a deployment the author believed it covered.
 */
const isPlausibleAddress = (value) => isIpv4Literal(value) || isIpv6Literal(value)

/**
 * Peer addresses whose X-Forwarded-For is honoured, from PICC_TRUSTED_PROXY_IPS.
 *
 * DEFAULT IS TRUST NOTHING, and the default is the load-bearing part. Reading
 * the header from any peer without a configured allowlist is not a rate limiter
 * at all: a caller varies one header and gets a fresh budget per value, so every
 * per-IP limiter in this file becomes decoration. An unconfigured deployment must
 * therefore behave EXACTLY as it did before this existed, and it does — an unset
 * variable produces an empty set, and an empty set matches no peer.
 *
 * FAIL-CLOSED ON A MALFORMED VALUE, in two senses. An entry that is not a
 * plausible address is DROPPED rather than treated as a wildcard, so a typo in a
 * deployment variable costs that deployment its per-IP accuracy instead of
 * handing every caller a fresh identity. And the parsed set is cached, because
 * this runs once per request on every limited route and re-parsing an environment
 * variable per request is work a request handler should not do.
 *
 * No CIDR support, stated rather than implied. A prefix match is the obvious next
 * request, and it is also the next way to over-trust: a /8 inside a cloud VPC is a
 * large set of addresses the operator may not control. Exact addresses only, so
 * the allowlist can be read as literally as it is written.
 */
let TRUSTED_PROXY_CACHE = { raw: undefined, set: new Set() }
function trustedProxyPeers() {
  const raw = process.env.PICC_TRUSTED_PROXY_IPS
  if (TRUSTED_PROXY_CACHE.raw === raw) return TRUSTED_PROXY_CACHE.set
  const set = new Set(
    String(raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => isPlausibleAddress(entry))
  )
  TRUSTED_PROXY_CACHE = { raw, set }
  return set
}

/**
 * The client identity a request should be rate-limited under.
 *
 * The resolution order, and why each step sits where it does:
 *
 *   1. No observable peer address -> NO_PEER_IDENTITY. Not a header lookup: there
 *      is no peer to have vouched for a header, and a header must never be able to
 *      place a caller in the address-less bucket.
 *   2. Peer is not a trusted proxy -> the peer address. This is the step that
 *      makes the whole feature safe: an untrusted caller sending
 *      X-Forwarded-For changes nothing, so it cannot escape a per-IP limiter by
 *      spoofing one.
 *   3. Peer is trusted -> walk X-Forwarded-For RIGHT TO LEFT and take the first
 *      entry that is not itself a trusted proxy. Right-to-left is the direction
 *      that matters: a proxy APPENDS its own view to the right, so everything to
 *      the right of the client is vouched for by a peer already trusted, and the
 *      first untrusted entry from the right is the furthest the chain vouches
 *      for. Taking the leftmost entry instead would hand a client an unlimited
 *      supply of identities by prepending garbage.
 *   4. No untrusted entry in the list -> the peer address. A list made entirely of
 *      proxies names no client, and guessing which entry to believe is a guess
 *      about identity, which feeds a security control.
 *   5. Malformed or absent header -> the peer address.
 *
 * NOT trusted: an arbitrarily long list, because the walk is bounded by which
 * entries are actually trusted proxies rather than by the header's length.
 */
function clientIp(req) {
  const peer = peerAddress(req)
  if (!peer) return NO_PEER_IDENTITY
  const trusted = trustedProxyPeers()
  if (!trusted.has(peer)) return peer

  const raw = req.headers?.["x-forwarded-for"]
  if (typeof raw !== "string" || raw.trim() === "") return peer
  const chain = raw.split(",").map((entry) => entry.trim())
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const candidate = chain[i]
    // A malformed entry is not evidence for anything, so the walk STOPS rather
    // than skipping past it. Skipping would mean an attacker who injects a junk
    // entry to the left of their own address is handled by a rule that keeps
    // reading past the evidence it just failed to parse.
    if (!isPlausibleAddress(candidate)) return peer
    if (!trusted.has(candidate)) return candidate
  }
  return peer
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

/**
 * True when the TCP connection originates from localhost (studio + dev-loopback routes).
 *
 * peerAddress(), NEVER clientIp(). This is an auth bypass: requireAuth() admits
 * the request outright when it is true. A forwarded loopback address is a claim
 * made by a header, and a claim is not an observation — routing this through the
 * header-resolved identity would let any client whose traffic a trusted proxy
 * forwards as `X-Forwarded-For: 127.0.0.1` skip authentication entirely.
 */
function isLocalhostRequest(req) {
  const ip = (peerAddress(req) ?? "").replace(/^::ffff:/, "")
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost"
}

/**
 * EO asset ids are numeric strings while clients send symbols ("EURUSD",
 * "GOLD", "Bitcoin", "US30"…). Match either, with alias-aware canonical
 * comparison so broker labels like "XAU/USD" resolve to the same instrument
 * the overlay normalized to GOLD.
 */
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

  // Command Centre (WS-4 T4) — leader-ideas import. The payload cap is 64 MB,
  // so the body is read ROUTE-LOCALLY (readBodyMax) BEFORE the shared body read
  // below (readBody's default 2 MB cap would otherwise reject it); over-cap is a
  // 413. Body { label, source: "csv"|"manual", payloadBase64 } decodes to feed
  // rows + optional leaderId; the importer chain writes the store and audits
  // (leader:import:{id}). 200 { ok, leaderId, qualification } or a 400 named deny.
  if (path === "/api/command-centre/leader-ideas/import" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    let body = null
    try {
      body = await readBodyMax(req, 64e6)
    } catch {
      writeJson(res, 413, { ok: false, deny: "leader:deny:payload-too-large" })
      return true
    }
    const envelope = body && typeof body === "object" ? body : null
    if (!envelope || typeof envelope.payloadBase64 !== "string" || envelope.payloadBase64.length === 0) {
      writeJson(res, 400, { ok: false, deny: "leader:deny:empty-payload" })
      return
    }
    let payload = null
    try {
      payload = JSON.parse(Buffer.from(envelope.payloadBase64, "base64").toString("utf8"))
    } catch {
      writeJson(res, 400, { ok: false, deny: "leader:deny:unparsable-feed" })
      return
    }
    const label = typeof envelope.label === "string" && envelope.label.length > 0 ? envelope.label : null
    const source = envelope.source === "csv" || envelope.source === "manual" ? envelope.source : null
    const wrapper = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null
    const rows = Array.isArray(payload) ? payload : Array.isArray(wrapper?.rows) ? wrapper.rows : null
    const leaderId =
      typeof wrapper?.leaderId === "string" && wrapper.leaderId.length > 0 ? wrapper.leaderId : undefined
    if (label === null || source === null || rows === null) {
      writeJson(res, 400, { ok: false, deny: "leader:deny:unsupported-payload" })
      return
    }
    const result = importLeaderFeed({ label, source, leaderId, rows })
    if (!result.ok) {
      writeJson(res, 400, { ok: false, deny: result.deny })
      return
    }
    writeJson(res, 200, { ok: true, leaderId: result.leaderId, qualification: result.qualification })
    return
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
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireAuth(req, res))) return
    try {
      writeJson(res, 200, await withTimeout(tradingStatus(), 8000))
    } catch (err) {
      console.warn("[picc] trading status failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  // D2/AC-005: the `/api/trading/feed-mode` route is REMOVED. It read and wrote
  // the feed-mode preference and reported live-LEG health — every leg it
  // described belonged to the deleted ExpertOption transport (liveEO.mjs owned
  // `getFeedMode`/`setFeedMode` and the leg stats). With one leg gone there is
  // no leg to prefer and no transport to report, so the route would be a
  // preference with nothing behind it. Reported as a product-visible change.

  if (path === "/api/trading/realtime" && req.method === "GET") {
    // Cross-origin EventSource snooping guard (any website can open this from
    // a visitor's machine — reject browser-supplied foreign origins).
    const origin = req.headers.origin
    if (origin && !TRUSTED_ORIGINS.includes(String(origin))) {
      writeJson(res, 403, { error: "origin not allowed" })
      return true
    }
    const token = parsed.searchParams.get("token") ?? ""
    if (!(await requireSessionOrFirstRun(req, res, { token, allowLocalhost: true }))) return true
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
    let offDispatch = null
    let keepalive = null
    let suiteTimer = null
    const detach = () => {
      if (detached) return
      detached = true
      if (off) off()
      if (offDecisions) offDecisions()
      if (offU4fa) offU4fa()
      if (offCCXT) offCCXT()
      if (offDispatch) offDispatch()
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
    // D2/AC-005: the `subscribeLiveEO` subscription is removed with the venue.
    // The decisions / u4fa / ccxt / dispatch subscriptions on this socket are
    // untouched, so the realtime stream still carries every non-EO event.
    offDecisions = subscribeDecisions((msg) => send(msg.type, msg))
    // T12/M8 — `type:"u4fa"` events ride the SAME socket as decision events
    // (no separate endpoint; the client parser routes them on the u4fa name).
    offU4fa = subscribeU4faEvents((msg) => send(msg.type, msg))
    // Slice A — CCXT exchange quotes ride the same socket with identical tick
    // shape (canonical assetId), so the chart routes them on assetId exactly
    // like EO ticks. No-op fan-out until a connected exchange polls data.
    offCCXT = subscribeLiveCCXT((msg) => send(msg.type, msg))
    offDispatch = onDispatchLive((entry) => send("dispatch", entry))
    keepalive = setInterval(() => {
      try {
        res.write(": ping\n\n")
      } catch {
        /* ignore */
      }
    }, 15000)
    send("ready", { ok: true })
    // D2/AC-005: the initial `stats` + `snapshot` frames were the liveEO leg
    // health and live buffer snapshot. No EO transport remains, so the socket
    // opens on `ready` alone and every subsequent frame is a non-EO event.
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
    if (!(await requireSessionOrFirstRun(req, res, { token, allowLocalhost: true }))) return true
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

  if (path === "/api/trading/dispatch" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") ?? 50), 1), 500)
    const unreadOnly = parsed.searchParams.get("unreadOnly") === "true"
    writeJson(res, 200, { ok: true, unread: unreadDispatchCount(), entries: listDispatch({ limit, unreadOnly }) })
    return
  }

  if (path === "/api/trading/dispatch/read" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const id = typeof body?.id === "string" ? body.id.trim() : ""
    if (!id || id.length > 96) {
      writeJson(res, 400, { ok: false, error: "id required" })
      return
    }
    if (!markDispatchRead(id)) {
      writeJson(res, 404, { ok: false, error: `no dispatch entry ${id}` })
      return
    }
    writeJson(res, 200, { ok: true, id, read: true })
    return
  }

  if (path === "/api/trading/engine/v32" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    try {
      const [{ getDecisions }, { loadV32Config }] = await Promise.all([
        import("./services/adaptiveConfluence.mjs"),
        import("./services/v32Config.mjs")
      ])
      const { v32Register } = await import("./services/v32Register.mjs")
      const payload = (await getDecisions())?.decisions ?? []
      const { config } = await loadV32Config({})
      writeJson(res, 200, await v32Register({ decisions: payload, config }))
    } catch (err) {
      console.warn("[picc] engine/v32 failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
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
      writeJson(res, 200, { ...creds })
      return
    }
    try {
      const creds = await saveTradingCredentials(body)
      // D2/AC-005: the `expertoptionToken` masking and the `restartLiveEO`
      // token-change revive are both removed with the venue — there is no EO
      // session left to revive, and the token field is no longer part of the
      // credential store. `reconnectTriggered` is gone from the response
      // rather than left as a permanent `false`. Reported as product-visible.
      writeJson(res, 200, { ok: true, ...creds })
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
    // Slice 6b — trading:perps: the perps wallet equity observation (persisted
    // by the position manager as ccxt-perps-risk.json) is the site's mandatory
    // 5E feed; the same absent-key → not-wired honesty as the ccxt leg applies.
    const perpsRisk = await readPerpsRiskStore()
    if (perpsRisk) {
      const ageMs = perpsRisk.equityAt ? Date.now() - Date.parse(perpsRisk.equityAt) : Number.NaN
      feeds[PERPS_SITE] = [
        {
          name: "perps-equity",
          ageSec: Number.isFinite(ageMs) ? ageMs / 1000 : Number.POSITIVE_INFINITY,
          maxAgeSec: perpsFundingStaleMs() / 1000
        }
      ]
    }
    const lastCcxtOrderAt = readAudit()
      .filter((e) => e.kind === "execution:executed" && String(e.data?.action ?? "").startsWith("ccxt:"))
      .map((e) => e.at ?? null)
      .filter(Boolean)
      .sort()
      .at(-1)
    const lastPerpsExecAt = readAudit()
      .filter((e) => e.kind === "execution:executed" && String(e.data?.action ?? "").startsWith("perps:"))
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
      },
      [PERPS_SITE]: {
        action: PERPS_OPEN_ACTION,
        power: "proposals",
        inFlight: executionNow[PERPS_SITE]?.inFlight ?? 0,
        lastExecutedAt: lastPerpsExecAt ?? null
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
        riskFeed: observeRiskFeed(),
        stream: stream || undefined,
        now: Date.now()
      })
    )
    return
  }

  // Command Centre (WS-3 T3) — ceremony readout. Per venue class: gate state,
  // spendable/scale markers, enablement, platform verification, last credit,
  // and the ledger resolver health. Honesty contract: every cell is store state
  // or a named ceremony:deny:* reason; an UNHEALTHY store still renders per-class
  // honest denies (ok true = the readout executed, never a silent pass).
  if (path === "/api/command-centre/ceremony" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const healthy = ceremonyStoreHealth().ok === true
    const platformMap = healthy ? ceremonyPlatformVerification() : {}
    const binaryClasses =
      platformMap && typeof platformMap === "object" && !Array.isArray(platformMap) && platformMap.locked !== true
        ? Object.keys(platformMap)
        : []
    const ledgerRunning = ledgerEngineStats().running === true
    const scale = ceremonyScaleReadout()
    const scaleMinResolves = scale.ok ? scale.value : null
    const scaleEnvError = scale.ok ? null : `invalid-environment: ${scale.varName}=${scale.raw}`
    const classes = KNOWN_VENUE_CLASSES.map((venueClass) => {
      const e = evaluateCeremony(venueClass, { ledgerRunning })
      const enablement =
        e.enablement && typeof e.enablement === "object" && e.enablement.unlocked === true
          ? { unlocked: true, at: e.enablement.at ?? null, by: e.enablement.by ?? null }
          : null
      const platformVerification =
        e.platformVerification && typeof e.platformVerification === "object" && e.platformVerification.verified === true
          ? {
              verified: true,
              at: e.platformVerification.at ?? null,
              by: e.platformVerification.by ?? null,
              regulator: e.platformVerification.regulator ?? null,
              payoutFloorPct: e.platformVerification.payoutFloorPct ?? null,
              withdrawalTested: e.platformVerification.withdrawalTested === true
            }
          : null
      return {
        venueClass,
        spendableResolved: e.spendableResolved,
        scaleResolved: e.scaleResolved,
        gates: e.gates.map((g) => ({ id: g.id, pass: g.pass === true, reason: g.reason ?? null })),
        enablement,
        binaryOptions: binaryClasses.includes(venueClass),
        platformVerification,
        lastCreditAt: e.lastCreditAt,
        ledgerRunning
      }
    })
    writeJson(res, 200, { ok: true, at: new Date().toISOString(), scaleMinResolves, scaleEnvError, classes })
    return
  }

  // Command Centre (WS-4) — leader-ideas readout: cell = state or named deny; GET never writes.
  if (path === "/api/command-centre/leader-ideas" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const healthy = leaderIdeasStoreHealth().ok === true
    const equityUsd = aggregateRiskState()?.equityUsd ?? null
    const now = Date.now()
    const leaders = healthy
      ? leaderListLeaders().map((rec) => {
          const auto = leaderAutoUnfollow(rec, { now })
          const stop = leaderSevenDayStop(rec.ideas, equityUsd, { now })
          const feedDeny = rec.source === "hip" ? HIP_NOT_WIRED : null
          const trustDeny = rec.platformTrust.value === "ADVERSARIAL" ? "leader:deny:platform-adversarial" : null
          const suppressReason = feedDeny ?? trustDeny ?? (stop.active ? stop.reason : null)
          return {
            id: rec.id,
            label: rec.label,
            source: rec.source,
            followedAt: rec.followedAt,
            lastPositionAt: rec.lastPositionAt,
            status: auto.active ? "auto-unfollowed" : "followed",
            platformTrust: rec.platformTrust,
            qualification: rec.qualification,
            guard: {
              autoUnfollow: { active: auto.active, reason: auto.reason },
              sevenDay: { active: stop.active, reason: stop.reason }
            },
            deny: suppressReason,
            ideas: suppressReason ? [] : rec.ideas
          }
        })
      : []
    writeJson(res, 200, {
      ok: true,
      at: new Date().toISOString(),
      storeUnhealthy: !healthy,
      deny: healthy ? null : "leader:deny:store-unhealthy",
      leaders
    })
    return
  }

  if (path === "/api/command-centre/startup-health" && req.method === "GET") {
    if (!(await requireAuthStrict(req, res))) return true
    // Prefer the value computed once at boot (D5); fall back to computing it if this process was
    // started without the boot import (e.g. a bare vite middleware context).
    writeJson(res, 200, getStartupHealth() ?? (await runStartupHealth()))
    return true
  }

  // Command Centre (WS-4) — follow: only after a qualified import; human-flips-last-switch.
  if (path === "/api/command-centre/leader-ideas/follow" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const leaderId = typeof body?.leaderId === "string" ? body.leaderId.trim() : ""
    if (leaderId === "") {
      writeJson(res, 400, { ok: false, deny: "leader:deny:missing-leader-id" })
      return
    }
    const result = leaderFollow(leaderId)
    if (!result.ok) {
      writeJson(res, 400, { ok: false, deny: result.deny })
      return
    }
    writeJson(res, 200, { ok: true, leaderId, followedAt: result.record.followedAt })
    return
  }

  // Command Centre (WS-4) — platform trust: operator store-write only; evidence-gated.
  if (path === "/api/command-centre/leader-ideas/trust" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const userId = (await verifyUser(req.headers.authorization)) ?? "operator"
    const leaderId = typeof body?.leaderId === "string" ? body.leaderId.trim() : ""
    const value = body?.value
    const evidence = typeof body?.evidence === "string" ? body.evidence : ""
    if (leaderId === "") {
      writeJson(res, 400, { ok: false, deny: "leader:deny:missing-leader-id" })
      return
    }
    if (value !== "VERIFIED" && value !== "ADVERSARIAL" && value !== "UNVERIFIED") {
      writeJson(res, 400, { ok: false, deny: "leader:deny:invalid-trust-value" })
      return
    }
    if (value !== "UNVERIFIED" && (typeof evidence !== "string" || evidence.trim() === "")) {
      writeJson(res, 400, { ok: false, deny: "leader:deny:trust-evidence-required" })
      return
    }
    const result = leaderSetPlatformTrust(leaderId, { value, by: userId, evidence })
    if (!result.ok) {
      writeJson(res, 400, { ok: false, deny: result.deny })
      return
    }
    writeJson(res, 200, { ok: true, leaderId, platformTrust: result.platformTrust })
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
  function envNum(name, dflt) {
    const raw = process.env[name]
    if (raw === undefined || raw === "") return dflt
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : dflt
  }

  function mddStepView(aggregate) {
    const step = envNum("PICC_RISK_MDD_STEP_TRIP_PCT", 10)
    const hard = envNum("PICC_RISK_MDD_HARD_STOP_PCT", 15)
    const factor = envNum("PICC_RISK_MDD_SIZE_STEP_FACTOR", 0.5)
    const dd = Number.isFinite(aggregate?.drawdownFromPeakPct) ? aggregate.drawdownFromPeakPct : null
    if (dd === null || dd < step || dd >= hard) {
      return { mddAdjusted: false, mddRationale: null }
    }
    return {
      mddAdjusted: true,
      mddRationale: `drawdown ${dd}% is in the size-step zone [${step}%,${hard}%) — new per-position exposure is capped at ${factor}× the catalogue cap`
    }
  }

  function observeRiskFeed() {
    const risk = refreshAggregateRisk()
    const heat = portfolioHeatUsd({ audits: readAudit() })
    return { risk, heat, step: mddStepView(risk.aggregate) }
  }

  async function observeCcxtRailState({ exchange, symbol }) {
    const halt = crossSiteHaltState()
    const haltToday = halt && halt.dayKey === dayKeyOf(Date.now())
    const equity = await observeCcxtEquity({ exchange })
    const reference = await fetchReferencePrice({ exchange, symbol })
    const riskFeed = observeRiskFeed()
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
      equity: equity.ok ? equity : null,
      riskAggregate: riskFeed.risk.aggregate ?? null,
      portfolioHeatUsd: riskFeed.heat.usd ?? null,
      mddAdjusted: riskFeed.step.mddAdjusted,
      mddRationale: riskFeed.step.mddRationale,
      riskObservation: { risk: riskFeed.risk, heat: riskFeed.heat }
    }
  }

  function proposalForClientOrderId(clientOrderId) {
    return readAudit().find(
      (e) => e.kind === "proposal:created" && String(e.data?.clientOrderId ?? "") === String(clientOrderId ?? "")
    )
  }

  // WS-2 R5 consent payload-lock: the acting human's EXACT D5 payload must match
  // the durable replay field-for-field AND hash to the stored consent. `sentD5`
  // is the client payload projected onto the D5 set; `expectedD5` is the same
  // projection over the durable replay (proposal data, or the position+exit price
  // for a close). A stored prior hash (open proposals) must also agree. On a pass
  // consent:reconfirmed is audited FIRST so it precedes execution:executed; on a
  // mismatch consent:denied is audited and nothing further runs (no venue touch).
  function consentDecision({ site, clientOrderId, expectedD5, sentD5, storedHash = null }) {
    const expectedHash = consentPayloadHash(expectedD5)
    const sentHash = consentPayloadHash(sentD5)
    const why = []
    for (const key of Object.keys(expectedD5)) {
      if (sentD5[key] !== expectedD5[key]) why.push(`field:${key}`)
    }
    if (sentHash !== expectedHash) why.push("hash")
    if (storedHash !== null && storedHash !== undefined && sentHash !== storedHash) why.push("stored")
    if (why.length > 0) {
      appendAudit({
        site,
        kind: "consent:denied",
        data: { clientOrderId: clientOrderId ?? null, reason: `consent-payload-mismatch (${why.join(", ")})` }
      })
      return { ok: false }
    }
    appendAudit({
      site,
      kind: "consent:reconfirmed",
      data: { clientOrderId: clientOrderId ?? null, consentHash: sentHash }
    })
    return { ok: true, consentHash: sentHash }
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
    const sentPayload = body?.payload
    if (!sentPayload || typeof sentPayload !== "object") {
      appendAudit({
        site: CCXT_SITE,
        kind: "consent:denied",
        data: { clientOrderId, reason: "consent-payload-mismatch (payload missing)" }
      })
      return writeJson(res, 409, { ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
    }
    const consent = consentDecision({
      site: CCXT_SITE,
      clientOrderId,
      expectedD5: spotOpenConsent(proposal.data),
      sentD5: spotOpenConsent(sentPayload),
      storedHash: proposal.data?.consentHash
    })
    if (!consent.ok) {
      return writeJson(res, 409, { ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
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

  // ── trading:perps rail (slice 6b, T7) — mirror of the ccxt orders rail with
  //    the perps 11–15 chain on top ────────────────────────────────────────────

  async function readPerpsRiskStore() {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const url = await import("node:url")
    const dataDir =
      process.env.PICC_COMMAND_CENTRE_DATA_DIR ||
      url.fileURLToPath(new URL("./services/data", import.meta.url))
    const riskFile = path.join(dataDir, "ccxt-perps-risk.json")
    if (!fs.existsSync(riskFile)) return null
    try {
      const data = JSON.parse(fs.readFileSync(riskFile, "utf8"))
      if (!data || typeof data !== "object" || data.version !== 1) return null
      return data
    } catch {
      return null
    }
  }

  function perpsFundingStaleMs() {
    const raw = process.env.PICC_CCXT_FUNDING_STALE_MS
    if (raw === undefined || raw === "") return 7_200_000
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 7_200_000
  }

  // The 5-fn adapter seam (F2): enforcement, the position manager and the rail
  // all read the SAME venue adapter (hyperliquidPerps, verified shapes at
  // :387-509) — one observation source, never a per-route mock of reality.
  const perpsAdapter = {
    positionView: () => hyperliquidPerps.positionView(),
    observeEquity: () => hyperliquidPerps.observeEquity(),
    observeFunding: ({ symbol }) => hyperliquidPerps.observeFunding({ symbol }),
    submitOrder: (params) => hyperliquidPerps.submitOrder(params),
    verifyFill: async (params) => {
      const r = await hyperliquidPerps.verifyFill(params)
      return r?.fill ?? null
    },
    openPositions,
    reconcileWithVenue
  }

  // Composes the perps rail state + a fresh observation: wallet equity (which
  // also rides the reconcile-on-first-boot), funding (normalized to numeric
  // epoch ms — gate 15's contract), open-position count for the position cap,
  // concurrency from the execution seam. Failures are honest (perps-equity
  // stale feed, funding-unobservable) — nothing is assumed.
  async function observePerpsRailState({ symbol }) {
    const halt = crossSiteHaltState()
    const haltToday = halt && halt.dayKey === dayKeyOf(Date.now())
    const wallet = await observePerpsWallet(perpsAdapter)
    const funding = await perpsAdapter.observeFunding({ symbol })
    const fundingAt = funding?.ok && funding.at !== undefined && funding.at !== null
      ? Number.isFinite(funding.at) ? funding.at : Date.parse(funding.at)
      : null
    const fundingObserved = funding?.ok && fundingAt !== null && Number.isFinite(fundingAt)
      ? { ok: true, rate: funding.rate, at: fundingAt, fundingIntervalHrs: funding.fundingIntervalHrs ?? null }
      : { ok: false, reason: funding?.reason ?? "funding-unobservable" }
    const positions = openPositions()
    const position = positions[0] ?? null
    const riskFeed = observeRiskFeed()
    const staleFeeds = []
    if (!wallet.ok) {
      staleFeeds.push({ name: "perps-equity", ageSec: Number.POSITIVE_INFINITY, maxAgeSec: perpsFundingStaleMs() / 1000 })
    }
    return {
      state: {
        killSwitch: anyKillActive(),
        optIn: false, // proposals power: fresh per-action consent, never a standing opt-in
        breakers: {
          dailyLossHalted: haltToday && halt.breaker === "dailyLoss",
          regimeHalted: haltToday && (halt.breaker === "regime" || halt.breaker === "regimeHalted"),
          siteCapped: false
        },
        staleFeeds,
        concurrentUnits: executionStatus()[PERPS_SITE]?.inFlight ?? 0,
        dayLossPct: wallet.ok ? wallet.dayLossPct : null,
        equityUsd: wallet.ok ? wallet.equityUsd : null,
        riskAggregate: riskFeed.risk.aggregate ?? null,
        portfolioHeatUsd: riskFeed.heat.usd ?? null,
        mddAdjusted: riskFeed.step.mddAdjusted,
        mddRationale: riskFeed.step.mddRationale
      },
      observation: {
        leverage: position ? position.leverage : undefined,
        notionalUsd: position ? position.notional : undefined,
        marginMode: position ? position.marginMode : "isolated",
        openNetPositions: positions.length,
        funding: fundingObserved,
        risk: riskFeed.risk,
        heat: riskFeed.heat
      }
    }
  }

  // GET lists the durable perps positions: the persisted records joined with
  // the venue reconcile (closed-unobserved is honest — pnl: null, never a
  // made-up number), plus the durable proposals from the audit. An unobservable
  // venue is returned as positions-unobservable, never a fabricated row.
  if (path === "/api/command-centre/perps/positions" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const consentBy = (await verifyUser(req.headers.authorization)) ?? "default"
    let venueView
    try {
      venueView = await perpsAdapter.positionView()
    } catch (err) {
      venueView = { ok: false, reason: err?.message || "positions-unobservable" }
    }
    const reconcile = reconcileWithVenue(venueView)
    const proposals = perpsProposalsFromAudit(readAudit())
    if (!reconcile.ok) {
      writeJson(res, 200, {
        ok: false,
        consentBy,
        reason: `positions-unobservable: ${reconcile.reason ?? "positions-unobservable"}`,
        positions: openPositions(),
        reconcile,
        proposals,
        at: new Date().toISOString()
      })
      return true
    }
    writeJson(res, 200, {
      ok: true,
      consentBy,
      positions: [...openPositions(), ...reconcile.closedUnobserved],
      reconcile,
      proposals,
      at: new Date().toISOString()
    })
    return true
  }

  // POST proposes a perps order. The server generates the idempotency identity
  // (clientOrderId), sizes the order against the per-position margin cap (the
  // §8.1(5) semantics: cap applies to MARGIN, not traded notional), renders the
  // 5F rationale from observed funding/equity and runs the FULL gate chain
  // (sidecar 10, then perps 11–15). No venue is touched here — the proposal
  // decides WHAT could be executed; both carriers act on ONE reality.
  if (path === "/api/command-centre/perps/propose" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const consentBy = (await verifyUser(req.headers.authorization)) ?? "default"
    const exchange = String(body?.exchange ?? "").trim().toLowerCase()
    if (exchange !== "hyperliquid") {
      return writeJson(res, 400, { ok: false, error: "exchange must be hyperliquid for the perps rail" })
    }
    const symbol = String(body?.symbol ?? "").trim().toUpperCase()
    if (!symbol || !symbol.includes("/")) {
      return writeJson(res, 400, { ok: false, error: "symbol is required (ccxt BASE/QUOTE, e.g. BTC/USDT)" })
    }
    const side = String(body?.side ?? "").trim().toLowerCase()
    if (side !== "buy" && side !== "sell") {
      return writeJson(res, 400, { ok: false, error: "side must be buy or sell" })
    }
    const amount = Number(body?.amount)
    const price = Number(body?.price)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0) {
      return writeJson(res, 400, { ok: false, error: "amount and price must be finite positive numbers" })
    }
    const leverage = Number(body?.leverage)
    if (!Number.isFinite(leverage) || leverage <= 0) {
      return writeJson(res, 400, { ok: false, error: "leverage must be a finite positive number" })
    }
    const marginMode = String(body?.marginMode ?? "isolated").trim().toLowerCase()
    if (marginMode !== "isolated" && marginMode !== "cross") {
      return writeJson(res, 400, { ok: false, error: "marginMode must be isolated or cross" })
    }
    const { state, observation } = await observePerpsRailState({ symbol })
    const result = await proposePerpsOpen({ exchange, symbol, side, amount, price, leverage, marginMode, consentBy, state, observation })
    writeJson(res, 200, {
      ok: result.ok,
      consentBy,
      gate: result.ok ? result.gate : (result.riskGate?.allow === false ? result.riskGate : (result.perpsGate?.allow === false ? result.perpsGate : result.gate)),
      order: result.order,
      idempotencyKey: result.idempotencyKey,
      clientOrderId: result.clientOrderId,
      at: new Date().toISOString()
    })
    return true
  }

  // POST /execute — carrier A: the acting human's click IS the fresh per-action
  // consent. The order is REPLAYED from the durable proposal (the body's price
  // is NEVER re-trusted — the approved proposal decides), the perps 5 re-run at
  // click time over FRESH observations, then the sidecar 10 via executeProposal;
  // an idempotent re-click is denied, the venue is reached once.
  if (path === "/api/command-centre/perps/execute" && req.method === "POST") {
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
    const sentPayload = body?.payload
    if (!sentPayload || typeof sentPayload !== "object") {
      appendAudit({
        site: PERPS_SITE,
        kind: "consent:denied",
        data: { clientOrderId, reason: "consent-payload-mismatch (payload missing)" }
      })
      return writeJson(res, 409, { ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
    }
    const consent = consentDecision({
      site: PERPS_SITE,
      clientOrderId,
      expectedD5: perpsOpenConsent({ action: "open", ...proposal.data }),
      sentD5: perpsOpenConsent(sentPayload),
      storedHash: proposal.data?.consentHash
    })
    if (!consent.ok) {
      return writeJson(res, 409, { ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
    }
    const { exchange, symbol, side, amount, price, leverage, marginMode } = proposal.data
    const { state, observation } = await observePerpsRailState({ symbol })
    const result = await executePerpsOpen({
      exchange,
      symbol,
      side,
      amount,
      price,
      leverage,
      marginMode,
      clientOrderId,
      consentBy,
      state,
      observation,
      executor: async ({ proposal: p }) =>
        perpsAdapter.submitOrder({
          symbol: p.symbol,
          side: p.side,
          amount: p.amount,
          price: p.price,
          leverage: p.leverage,
          marginMode: p.marginMode,
          reduceOnly: false,
          clientOrderId
        })
    })
    writeJson(res, 200, {
      ok: result.ok,
      consentBy,
      gate: result.ok ? result.gate : (result.riskGate?.allow === false ? result.riskGate : (result.perpsGate?.allow === false ? result.perpsGate : result.gate)),
      execution: result.execution,
      state: killSwitchState()
    })
    return true
  }

  // POST /close — the reduce-only other leg, REPLAYED from the durable position
  // record (never from the body): symbol/side/size/leverage come from the
  // position, the exit price is the acting human's fresh input. A reduce-only
  // order is submitted (deploying NO new margin); the close is recorded ONLY on
  // the verified fill. Unknown positionId → 404, nothing durable to close.
  if (path === "/api/command-centre/perps/close" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const consentBy = (await verifyUser(req.headers.authorization)) ?? "default"
    const positionId = String(body?.positionId ?? "").trim()
    const price = Number(body?.price)
    if (!positionId) {
      return writeJson(res, 400, { ok: false, error: "positionId is required — close the exact position the rail recorded" })
    }
    if (!Number.isFinite(price) || price <= 0) {
      return writeJson(res, 400, { ok: false, error: "close price must be a finite positive number" })
    }
    const position = openPositions().find((p) => p.id === positionId)
    if (!position) {
      return writeJson(res, 404, { ok: false, error: `unknown position ${positionId} — nothing durable to close` })
    }
    const sentPayload = body?.payload
    if (!sentPayload || typeof sentPayload !== "object") {
      appendAudit({
        site: PERPS_SITE,
        kind: "consent:denied",
        data: { clientOrderId: closeClientOrderIdFor(position.id), reason: "consent-payload-mismatch (payload missing)" }
      })
      return writeJson(res, 409, { ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
    }
    // The close's durable replay is the POSITION + the acting human's fresh exit
    // price (no pre-existing anchor — the close anchor lands only after execution).
    const consent = consentDecision({
      site: PERPS_SITE,
      clientOrderId: closeClientOrderIdFor(position.id),
      expectedD5: perpsCloseConsent({
        action: "close",
        exchange: "hyperliquid",
        symbol: position.symbol,
        positionId: position.id,
        price,
        side: position.side === "short" ? "buy" : "sell",
        amount: position.size,
        leverage: position.leverage
      }),
      sentD5: perpsCloseConsent(sentPayload),
      storedHash: null
    })
    if (!consent.ok) {
      return writeJson(res, 409, { ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
    }
    const { state, observation } = await observePerpsRailState({ symbol: position.symbol })
    const result = await executePerpsClose({
      exchange: "hyperliquid",
      symbol: position.symbol,
      positionId,
      price,
      consentBy,
      position,
      state,
      observation,
      submit: async ({ proposal: p }) =>
        perpsAdapter.submitOrder({
          symbol: p.symbol,
          side: p.side === "short" ? "buy" : "sell",
          amount: p.amount,
          price: p.price,
          leverage: p.leverage,
          marginMode: p.marginMode,
          reduceOnly: true,
          position: position
        })
    })
    writeJson(res, 200, {
      ok: result.ok,
      consentBy,
      gate: result.ok ? result.gate : (result.riskGate?.allow === false ? result.riskGate : (result.perpsGate?.allow === false ? result.perpsGate : result.gate)),
      execution: result.execution,
      state: killSwitchState()
    })
    return true
  }

  // POST /verify — carrier B: the human performed the venue step on the
  // exchange. The fill is verified READ-ONLY against the venue; the verified
  // fill is the ONLY write into the position manager (trackOpen on an open,
  // recordClose on a close). An unobservable venue is recorded as unobserved,
  // never a fabricated fill.
  if (path === "/api/command-centre/perps/verify" && req.method === "POST") {
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
    const result = await verifyPerpsOpen({
      exchange,
      symbol,
      orderId: venueOrderId,
      clientOrderId,
      positionId: proposal.data.kind === "close" ? proposal.data.positionId : undefined,
      verify: (v) => perpsAdapter.verifyFill({ symbol: v.symbol, orderId: v.orderId })
    })
    // Only a POSITIVE verified filled quantity may book a position change. A
    // zero-fill read (order resting/unfilled) or an unobserved read both leave
    // the stores untouched — P&L is never claimed from an unfilled exit.
    if (result.filled && Number(result.filled?.filled ?? 0) > 0) {
      try {
        if (proposal.data.kind === "open") {
          const order = proposal.data
          trackOpen({
            position: {
              id: venueOrderId,
              symbol: order.symbol,
              side: order.side === "sell" ? "short" : "long",
              size: result.filled.filled,
              entryPrice: result.filled.average,
              leverage: order.leverage,
              marginUsd: order.marginUsd,
              marginMode: order.marginMode,
              openedAt: result.filled.at,
              openOrderId: venueOrderId,
              source: "persisted"
            }
          })
        } else {
          recordClose({ positionId: proposal.data.positionId, fill: result.filled, fundingObservations: [] })
        }
      } catch (err) {
        // A second verify of the same already-tracked venue order id is a
        // duplicate confirmation — answer 409 in place of the global 500.
        if (openPositions().some((p) => p.id === String(venueOrderId))) {
          return writeJson(res, 409, { ok: false, error: "position already tracked", reason: err?.message ?? String(err) })
        }
        throw err
      }
    }
    writeJson(res, 200, {
      ok: result.ok,
      consentBy,
      kind: result.kind,
      clientOrderId: result.clientOrderId,
      at: new Date().toISOString()
    })
    return true
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

  // D2/AC-005: the `/api/trading/analyze` route is REMOVED. It had exactly one
  // implementation — `analyzeExpertOptionAsset` — and that function is deleted
  // with the venue. The route is not left as a 404 shim: AC-005 forbids
  // present-but-disabled, and a route whose only body was the removed venue has
  // no honest 200 to serve. `/api/trading/pro/analyze` and
  // `/api/trading/predict` below are the surviving venue-agnostic analyses.

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

  // D2/AC-005: the `/api/trading/pro/expertoption` route is REMOVED. Its only
  // implementation was `proAnalyzeExpertOption`, deleted with the venue.

  if (path === "/api/trading/pro/narrative" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireAuth(req, res))) return true
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
    // clientIp() in the key, like the seven sibling limiters. The bare "packs"
    // key was ONE budget for the whole process, and `PackRegistryStrip` polls
    // this route every 30s (PackRegistryStrip.tsx:27,127) — so a handful of
    // concurrent users on one host spent 30 requests/minute among themselves with
    // no abuse anywhere, and each saw the others' polls as their own throttle.
    if (rateLimited(`packs:${clientIp(req)}`, 30, 60_000)) {
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
    // Per-client, and this one matters most of the four: the limiter runs BEFORE
    // requireAuth, so on a bare key a single anonymous caller could spend a
    // 10/minute budget that every other user of the process then shares.
    if (rateLimited(`packs-ack:${clientIp(req)}`, 10, 60_000)) {
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
    if (rateLimited(`webfetch-limits:${clientIp(req)}`, 30, 60_000)) {
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
    // Per-client like its GET sibling. An administrative action with a bare key
    // means one caller spending 10/minute locks every other operator out of it.
    if (rateLimited(`webfetch-limits-reset:${clientIp(req)}`, 10, 60_000)) {
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

  // WS-7 T20R. opens a position in the paper-trading ledger, so it is a WRITE
  // and is gated rather than allowlisted — the same gate, and the same spelling,
  // as the /api/trading/alerts/delete precedent further down. The gate is the
  // FIRST statement, ahead of the validateOr400 precondition.
  if (path === "/api/trading/paper/trade" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    if (validateOr400(res, body, "paperTrade")) return
    try {
      writeJson(res, 200, { ok: true, position: await openPaperTrade(body) })
      bustRealtimeSuite()
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  // WS-7 T20R. closes a position in the paper-trading ledger: a WRITE, gated
  // for the same reason as its /trade sibling above.
  if (path === "/api/trading/paper/close" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireAuth(req, res))) return
    writeJson(res, 200, { ok: true, positions: await paperPositions() })
    return
  }

  if (path === "/api/trading/paper/overview" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return
    writeJson(res, 200, { ok: true, ...(await paperOverview()) })
    return
  }

  if (path === "/api/trading/paper/history" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return
    writeJson(res, 200, { ok: true, closed: await paperHistory(Math.min(Math.max(Number(body?.limit) || 50, 1), 500)) })
    return
  }

  if (path === "/api/trading/signals" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return
    writeJson(res, 200, { ok: true, signals: await recentSignals(20) })
    return
  }

  // WS-7 T20R. recordSignal writes a signal AND moves the aggregate accuracy
  // number an anonymous caller can otherwise move — the slice-C sweep recorded
  // exactly that and left the route unruled. It is a WRITE, so it is gated.
  // The GET sibling immediately above is a read and stays as it was.
  if (path === "/api/trading/signals" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    try {
      writeJson(res, 200, { ok: true, signal: await recordSignal(body) })
      bustRealtimeSuite()
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  // WS-7 T20R. resolveSignal settles a signal, and a settlement feeds the accuracy
  // ledger. A WRITE, so it is gated — same reasoning as /signals above.
  if (path === "/api/trading/signals/resolve" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireAuth(req, res))) return
    try {
      writeJson(res, 200, await signalAccuracy())
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/paper/analytics" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return
    try {
      writeJson(res, 200, await withTimeout(paperAnalytics(), 20000))
    } catch (err) {
      console.warn("[picc] paper analytics failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/assist" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
  // D2/AC-005: the `/api/trading/demo` route is REMOVED. It served
  // `expertOptionDemoStatus()` — an ExpertOption demo-account status read. The
  // venue is gone, so there is no demo account to report on.

  // WS-7 T20R. RECORDED HONESTLY, because the security value here is PROPHYLACTIC
  // and not a hole being closed: this route already refuses with a static 410 and
  // mutates nothing today, because order execution was removed with the venue. It
  // is gated anyway, on the owner's ruling, because a POST that once placed an
  // order should not be a route that relies on its own deprecation stub being the
  // only thing standing between an anonymous caller and an order. The gate runs
  // first, so an authenticated caller still sees the same 410 and the deprecation
  // notice is unchanged for every operator.
  if (path === "/api/trading/demo/place" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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

  // WS-7 T20R. Same reasoning as /api/trading/demo/place above: a static 410 stub
  // that mutates nothing today, gated so it cannot become an anonymous order
  // placement by someone deleting one line. The 410 an operator sees is unchanged.
  if (path === "/api/trading/autopilot/start" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    writeJson(res, 410, { ok: false, deprecated: true, error: "order execution removed — PICC is advisory-first" })
    return
  }

  if (path === "/api/trading/autopilot/stop" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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

  // -------------------------------------------------------------------
  // WS-7 T7R-B — THE COPILOT DECISION.
  //
  // The first route that runs the deterministic Copilot engine. Until this
  // landed, `evaluateCopilot` existed in `services/copilot/engine.mjs` and in
  // tests, and NOTHING called it — a gap T12's entry 0023 handoff #2 and T13's
  // entry 0025 handoff #6 both named and neither could close, because each was
  // forbidden from touching `apps/dashboard/src/` and a room cannot fetch.
  //
  // GATED, NOT ALLOWLISTED. `requireAuth` sits in this block before anything is
  // read or answered, so `ws7RouteAuthCoverageGuard.test.mjs` discovers a real
  // gate in the route's own region. This route is deliberately NOT added to the
  // declared-public allowlist and deliberately gets NO `owner: "decision"`
  // entry: it exposes live engine state (regime, score, vetoes, conflict
  // resolutions) and nothing in it is declared-public. The 86 unruled decision
  // entries awaiting the owner are not a pool to draw from.
  //
  // ONE REQUEST. The client supplies an `assetId`, never candles. The server
  // fetches its own working-timeframe, 4H and daily series through the same
  // broker fan-in `/api/trading/candles` uses, derives the state, and evaluates
  // — see `services/copilot/decision.mjs` for why the alternative was rejected,
  // and for what stays absent (sentiment, news, proposals, broker permit, daily
  // drawdown, strike store) and why each is reported rather than filled in.
  // -------------------------------------------------------------------
  if (path === "/api/trading/copilot" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
    const assetId = String(body?.assetId ?? "").trim().toUpperCase()
    if (!assetId) return writeJson(res, 400, { ok: false, error: "assetId required" })
    try {
      const { copilotDecisionForAsset } = await import("./services/copilot/decision.mjs")
      writeJson(res, 200, await withTimeout(copilotDecisionForAsset({ assetId, source: body?.source }), 30000))
    } catch (err) {
      console.warn(`[picc] copilot decision failed for ${assetId}:`, err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  // -------------------------------------------------------------------
  // WS-7 T8 — the MINISTRY governance readout: the authority set, the
  // separation-of-duties state for every frozen room key, and the permit
  // store's change events. This is the route T16 entry 0024 handoff #1
  // pointed at and could not build, because BS-2 forbade touching
  // `apps/dashboard/src/`.
  //
  // GATED, AND DELIBERATELY NOT ALLOWLISTED. It exposes the governance
  // vocabulary — authority ids, room keys, collision and refusal codes.
  // Nothing in it is declared-public, so it gets NO `DECLARED_PUBLIC`
  // entry and NO unruled `decision`-owner entry: the 86 decision entries
  // awaiting the owner are not a pool to draw from. Three guards cover it,
  // and the third exists because a static scan can be satisfied by a gate
  // that never runs: the route-auth coverage scan, the bootstrap-gate
  // guard, and `ministryGovernanceRoute.test.mjs`.
  //
  // THIS COMMENT DELIBERATELY DOES NOT SPELL THE ALLOWLIST MARKER. The
  // sibling `copilotDecisionRoute.test.mjs` proves the route before this one
  // is not allowlisted by slicing a fixed character window forward from that
  // route's dispatch line and asserting no allowlist marker appears in it. A
  // comment here that quoted the marker verbatim would fail that assertion —
  // a prose mention read as a code site, the same class
  // `ws7RouteAuthCoverageGuard.test.mjs` documents for gate names in
  // comments. The fix is to word this accurately rather than to widen that
  // window or relax its assertion.
  //
  // IT READS ITS OWN PRODUCER AND NOBODY ELSE'S. The route depends only on
  // `services/authority/`. It reads no ceremony store and no market data,
  // which is T8's bisect line (spec :1271) stated on the server: a Ceremony
  // outage must not be able to take Ministry down, and the assertion that
  // holds it is in `ministryGovernanceRoute.test.mjs`.
  //
  // NO CANDLES, NO CLOCK OF ITS OWN. The permit store takes `at` as a
  // caller-supplied argument (`brokerAutomationPermit.mjs:166-172`), and
  // with no broker record there is no change event and so no time to
  // invent. `ok: true` means THE READOUT EXECUTED; it never means separation
  // was verified, and `separation.ok` is a separate field precisely so the
  // two cannot be read as one.
  // -------------------------------------------------------------------
  if (path === "/api/trading/ministry" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    try {
      const { ministryGovernance } = await import("./services/authority/governance.mjs")
      writeJson(res, 200, ministryGovernance())
    } catch (err) {
      console.warn("[picc] ministry governance readout failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  // -------------------------------------------------------------------
  // WS-7 T9 — the PAPER/LIVE permit readout: D6's ladder vocabulary and
  // the D5 `automationPermitted` state of every real broker record. This is
  // the route T16 entry 0024 handoff #4 pointed at and could not build,
  // because BS-2 forbade touching `apps/dashboard/src/`.
  //
  // WHY A NEW ROUTE AND NOT A REUSE OF THE MINISTRY READOUT ABOVE. That
  // route already reads the permit store, but its store holds ZERO brokers by
  // construction and `ministryGovernanceRoute.test.mjs` pins that. Reading it
  // would report "nothing is known" — true of that store and false of one
  // seeded with the brokers in `services/brokers.mjs`. It would also couple two
  // rooms at the transport seam, which both their bisect lines forbid. And a
  // second route over one store is the defect T8 refused to create for the
  // ceremony store, so this is ONE store seeded with real broker records,
  // answering the broker-permission question only.
  //
  // IT SERVES NOTHING ELSE. The ceremony rails are read from the pre-existing
  // `GET /api/command-centre/ceremony` and the consent rails from the
  // pre-existing `GET /api/command-centre/overview`; the current ladder rung is
  // read from the pre-existing `GET /api/trading/brokers`. Bundling them here
  // would put one store behind two routes, which is the defect named above.
  //
  // GATED, AND DELIBERATELY NOT ALLOWLISTED. The payload names broker ids and
  // every refusal reason the permit write path can produce. None of it is
  // declared-public, so it gets NO allowlist entry and no unruled owner entry:
  // the decision entries awaiting the owner are not a pool to draw from.
  //
  // NO TIER LOGIC AND NO CLOCK OF ITS OWN. `at` is a caller-supplied argument to
  // the permit store (`brokerAutomationPermit.mjs:166-172`) and with no broker
  // ever granted there is no change event and so no time to invent. `ok: true`
  // means THE READOUT EXECUTED; it never means automation was permitted, and
  // the per-broker verdict is a separate field precisely so the two cannot be
  // read as one.
  // -------------------------------------------------------------------
  if (path === "/api/trading/paper-live/permits" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    try {
      const { paperLivePermit } = await import("./services/authority/paperLivePermit.mjs")
      writeJson(res, 200, paperLivePermit())
    } catch (err) {
      console.warn("[picc] paper/live permit readout failed:", err.message)
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
    if (!(await requireAuth(req, res))) return
    try {
      writeJson(res, 200, await withTimeout(demoAnalytics(), 10000))
    } catch (err) {
      console.warn("[picc] demo analytics failed:", err.message)
      writeJson(res, 502, { ok: false, error: err.message })
    }
    return
  }

  if (path === "/api/trading/demo/deals" && (req.method === "GET" || req.method === "POST")) {
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireAuth(req, res))) return true
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

  // WS-7 T20R. addToWatchlist WRITES the watchlist store, so it is gated rather
  // than allowlisted. The GET sibling above is a read and is untouched.
  if (path === "/api/trading/watchlist" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    try {
      writeJson(res, 200, await addToWatchlist(String(body?.symbol ?? "")))
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message })
    }
    return
  }

  // WS-7 T20R. removeFromWatchlist is a destructive DELETE on the watchlist store.
  if (path === "/api/trading/watchlist" && req.method === "DELETE") {
    if (!(await requireAuth(req, res))) return
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
    let preferredSource = typeof body?.preferredSource === "string" ? body.preferredSource.trim() : null
    // T3 — persisted per-user source preference (chartPrefs.mjs) applies only
    // when the request does NOT explicitly force a source: it is the same
    // mechanism as preferredSource (tried first, falls through the quality
    // order with sourceMode:"fallback"). A stored "auto" pref is a no-op —
    // the plain quality fan-in runs and says sourceMode:"auto".
    if (!preferredSource && (source === "auto" || source === "")) {
      try {
        const { getSourcePref } = await import("./services/chartPrefs.mjs")
        const { verifyUser, hasUsers } = await import("./services/auth.mjs")
        // NOT A GATE. This is preference-key SELECTION, not authorisation: it
        // picks whose saved chart-source preference to read, and both branches
        // collapse to the same "default" key when it cannot be resolved. A
        // degraded store here can only cost a user their saved pin — it cannot
        // admit anyone to anything, and this whole block is already wrapped in
        // a try/catch with a plain `auto` fan-in fallback. It must therefore
        // stay on the lenient hasUsers(): routing it through the strict helper
        // would throw, and the catch would swallow that into the same fallback
        // while making the block look like a security decision. Pinned by
        // ws7AuthBootstrapGateGuard.test.mjs.
        const hasAccts = await hasUsers()
        const userId = hasAccts ? ((await verifyUser(req.headers.authorization)) ?? "default") : "default"
        const pref = getSourcePref(userId)
        if (pref && pref !== "auto") preferredSource = pref
      } catch { /* pref read failure — plain auto fan-in */ }
    }
    try {
      // Unified fan-in: EO push buffers → live EO fetch → CCXT aggregates →
      // Yahoo daily fallback. Source + staleness tagged for honest labeling.
      // A pinned `source`/`preferredSource` is tried first and falls through
      // the quality order when it serves nothing (sourceMode:"fallback").
      const { getBestCandles, listAvailableSources, getCrossSourceCandles } = await import("./services/marketDataBus.mjs")
      // D2/AC-005: the `ensureWatch: ensureWatchingAsset` argument and the
      // `feedProvenance()` leg tag are removed with liveEO.mjs. `getBestCandles`
      // still accepts an inert `ensureWatch` option (see marketDataBus), and the
      // surviving winners (ccxt/yahoo) report their own broker slug as the feed,
      // so `feed` is simply `out.source` — an honest per-source provenance with
      // no fabricated leg.
      // Opt-in cross-source verification (verify:true): wraps the fan-in and
      // tags each bar with how many INDEPENDENT sources agree on it (aggregate
      // trust — "same data across multiple sources is trusted"). Off by default
      // so the standard fan-in shape and cost stay unchanged for other callers.
      const fetchCandles = body?.verify === true ? getCrossSourceCandles : getBestCandles
      const [out, availableSources] = await Promise.all([
        fetchCandles(assetId, { timeframe, count, source, preferredSource }),
        listAvailableSources(assetId, { timeframe })
      ])
      const feed = out.source
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

  // ── Per-user chart source preference (T3) ────────────────────────────────
  // GET  → the active preference for this user ("auto" | broker slug).
  // POST → set it; validated by chartPrefs (registered candle-capable slug or
  //        "auto"; anything else resolves to "auto"). Pre-auth single-user
  //        mode keys "default". Honored by every chart that does not
  //        explicitly force a source on the request (see candles above).
  if (path === "/api/trading/source-preference") {
    if (!(await requireAuth(req, res))) return true
    if (req.method !== "GET" && req.method !== "POST") return false
    const { getSourcePref, setSourcePref } = await import("./services/chartPrefs.mjs")
    const userId = (await verifyUser(req.headers.authorization)) ?? "default"
    if (req.method === "GET") {
      writeJson(res, 200, { ok: true, userId, source: getSourcePref(userId) })
      return true
    }
    const source = setSourcePref(userId, body?.source)
    writeJson(res, 200, { ok: true, userId, source })
    return true
  }

  // ── Advanced indicator calculations ──────────────────────────────────────
  // WS-7 T20R. THE OWNER'S OWN JUDGEMENT CALL, and the answer is that it CAN be
  // gated. Verified rather than assumed: the only consumers are
  // AdvancedIndicatorsPanel (mounted by TradingSuite and by the command-centre
  // Markets room), both behind App.tsx's RequireAuth, and lib/trading.ts sends
  // `Authorization: Bearer <token>` on this call. No pre-auth consumer exists, so
  // gating it breaks nothing. Unlike /api/health and /api/packs/registry, this read
  // is NOT on the must-be-public list, so it leaves the allowlist and gets a gate.
  if (req.method === "GET" && path === "/api/trading/indicators") {
    if (!(await requireAuth(req, res))) return
    const assetId = parsed.searchParams.get("assetId") || "EURUSD"
    const tfRaw = parsed.searchParams.get("timeframe") || "daily"
    const timeframe = canonicalIndicatorTimeframe(tfRaw)
    if (timeframe == null) return writeJson(res, 400, { error: "unsupported timeframe" })
    const count = parsed.searchParams.get("count") || 200
    const safeCount = Math.min(500, Math.max(10, Number(count) || 200))

    try {
      // D2/AC-005: the liveEO buffer read is removed with the venue, so this
      // route now resolves from Yahoo only. The fallback warning is reworded to
      // state the real source rather than name a buffer that no longer exists.
      let candles = []
      {
        const { getHistory } = await import("./services/yahoo.mjs")
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
    if (!(await requireAuth(req, res))) return
    const { listAlerts, alertStats } = await import("./services/alertEngine.mjs")
    writeJson(res, 200, { ok: true, alerts: listAlerts(), stats: alertStats() })
    return
  }
  if (path === "/api/trading/alerts/history" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return
    const { getAlertHistory } = await import("./services/alertEngine.mjs")
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit")) || 50, 1), 200)
    const symbol = parsed.searchParams.get("symbol") || null
    writeJson(res, 200, { ok: true, history: getAlertHistory({ limit, symbol }) })
    return
  }
  // WS-7 T20R. createAlert writes the alert store. Alerts are user-created
  // (symbol/condition/value), so this mutates user-owned state and is a WRITE:
  // gated, not allowlisted — the same reasoning that gated its /delete sibling.
  if (path === "/api/trading/alerts" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    const { createAlert } = await import("./services/alertEngine.mjs")
    if (validateOr400(res, body, "alertCreate")) return true
    const { symbol, condition, value, message, recurring, expiresAt, band, conditions, logic } = body ?? {}
    if (!symbol || !condition || value == null) return writeJson(res, 400, { error: "symbol, condition, and value required" })
    const alert = createAlert({ symbol, condition, value: Number(value), message, recurring, expiresAt, band, conditions, logic })
    writeJson(res, 200, { ok: true, alert })
    return
  }
  if (path === "/api/trading/alerts/delete" && req.method === "POST") {
    // WS-7 slice C. This route had NO auth check of any kind, so an anonymous
    // POST could delete any alert by id — confirmed by execution, which returned
    // 200 {"ok":false} only because the probe's id did not exist. Gated with
    // requireAuth(), the same gate and the same spelling as its sibling
    // /api/trading/journal/delete, which is the destructive-delete precedent in
    // this file. Alerts are user-created (symbol/condition/value), so this
    // mutates user-owned state and is not a "public read" judgement call.
    if (!(await requireAuth(req, res))) return
    const { deleteAlert } = await import("./services/alertEngine.mjs")
    const id = String(body?.id ?? "")
    if (!id) return writeJson(res, 400, { error: "id required" })
    writeJson(res, 200, { ok: deleteAlert(id) })
    return
  }
  // WS-7 T20R. enableAlert / disableAlert write the alert store by id, so an
  // anonymous caller could have silenced or armed any alert. A WRITE, gated.
  if (path === "/api/trading/alerts/toggle" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
  // WS-7 T20R. RECORDED HONESTLY: T20R read this body before gating it, and it is
  // an ANALYTICAL READ — computePortfolioAnalytics over caller-supplied symbols and
  // weights, reading market data and not the caller's own portfolio store. It is
  // named in the owner's ruling as a must-gate, so it is gated; the reader should
  // know the gain here is uniform policy rather than a disclosed hole. Its sibling
  // /api/trading/portfolio/aggregate, which DOES fold in positions, stays an open
  // owner decision and is NOT gated by this task.
  if (path === "/api/trading/portfolio" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
  // WS-7 T20R. addToWatchlist / removeFromWatchlist / createWatchlist all write the
  // watchlist store, and all three are reachable from this one POST via `action`.
  // Gated as a single gate at the head of the branch, so no action is left open by
  // a sibling action being gated.
  if (path === "/api/trading/watchlists" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
    // WS-7 slice C. Same defect and the same fix as /api/trading/alerts/delete
    // above: no auth check of any kind, so an anonymous POST could delete any
    // named watchlist by id — confirmed by execution, which returned 200
    // {"ok":false} only because the probe's id did not exist. A watchlist is
    // user-created (name + symbols), so this mutates user-owned state.
    if (!(await requireAuth(req, res))) return
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
  // All four of these were UNGATED, and the window was checked line by line.
  // This is not a judgement call about whether a route is *meant* to be public:
  // it was unauthenticated READ of the user's full trade journal and P&L/win-rate
  // history, unauthenticated WRITE of a trade record, unauthenticated MUTATION of
  // one, and an unauthenticated destructive DELETE by id. The delete is the
  // serious one: anyone who can reach the port can erase the trading record.
  //
  // requireAuth, the dominant idiom for user-owned data in this file (97 sites,
  // and what /api/profile uses), rather than requireSessionOrFirstRun: a trade
  // journal is personal data, and there is no first-run state in which an
  // anonymous caller has a legitimate journal to read or write.
  //
  // The gate goes FIRST in every route, before the body is inspected, so a
  // refusal cannot leak whether an id exists by returning 400 for a missing one.
  if (path === "/api/trading/journal" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireAuth(req, res))) return
    const { closeEntry } = await import("./services/tradeJournal.mjs")
    const { id, exitPrice, exitTime, notes } = body ?? {}
    if (!id || exitPrice == null) return writeJson(res, 400, { error: "id and exitPrice required" })
    const entry = closeEntry(id, { exitPrice, exitTime, notes })
    writeJson(res, entry ? 200 : 404, { ok: !!entry, entry })
    return
  }
  if (path === "/api/trading/journal/delete" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
    // WS-7 slice C, fix round 1. This gate was CONDITIONAL: it covered only
    // webhook-settings/webhook-test, so GET and POST read / read-all / clear /
    // inject all ran with no session. `clear` calls clearOld(), which DELETES
    // stored notifications, and inject writes an arbitrary title/body/level/meta
    // into the registry that every other route and the UI read back. The comment
    // that stood above the old gate said "mutating actions require auth. Reads
    // stay open" — four of the five mutating actions were outside the gate it
    // described, and the intent was not implemented.
    //
    // Gating the whole block is the same call the owner already accepted for
    // /api/trading/brokers and for the two WS-7 deletes: a route that mutates
    // shared state is not a public read whatever its verb says. Placed before
    // the dynamic import so an unauthenticated request cannot even load the
    // store module. The login page reads notifications through an
    // authenticated session; there is no anonymous consumer of this route.
    if (!(await requireAuth(req, res))) return true
    const { notify, getNotifications, markRead, markAllRead, clearOld, unreadCount, notificationStats, getWebhookSettings, saveWebhookSettings, emitEvent } = await import("./services/notificationCenter.mjs")
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
      // D2/AC-005: the liveEO buffer + on-demand fetch are removed with the
      // venue, so the intraday buffer legs go away and this route resolves from
      // the market-data fan-in / Yahoo below. `source` reports what actually
      // served — never a relabeled "live" for bars that came from Yahoo.
      let candles = []
      let source = "none"
      {
        const { getBestCandles } = await import("./services/marketDataBus.mjs")
        const fanIn = await getBestCandles(assetId, { timeframe, count }).catch(() => null)
        if (fanIn?.candles?.length) {
          candles = fanIn.candles.slice(-count)
          source = fanIn.source ?? "none"
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
      // SECURITY (pre-push review finding 1). `subscriptionEndpoints` was returned
      // HERE, on an ungated branch inside a declared-public wrapper, and a probe
      // confirmed an anonymous non-loopback caller received every subscribed
      // device's push endpoint URL. That is a provider reveal plus a stable
      // per-browser registration identifier: the caller learns the push provider
      // and can poll the route to detect a device being added or removed. (The
      // `p256dh`/`auth` keys are NOT here — only `.endpoint` is mapped — so this
      // was an identifier disclosure, not a takeover. A host plus a path is
      // identifying, so a "redacted" endpoint would still have leaked.)
      //
      // The list moved to a GATED SIBLING below rather than being digested here,
      // because the wrapper cannot carry a gate: the vapid branch always returns,
      // so a gate before it would gate the key the browser needs before it can
      // authenticate. `notifierStatus()` itself is now GATED — see its branch below,
      // beside the other gated sub-routes.
      //
      // BRANCH ORDER IS LOAD-BEARING, and the vapid branch therefore comes FIRST. Every
      // gated sub-route below answers only after its own gate, so whichever gated branch
      // came first would make this declared-public wrapper's own region look like a route
      // whose gate sits inside a conditional — which is exactly what the guard's nesting
      // discriminator reports. Putting the always-answering vapid branch first keeps the
      // wrapper's region answering before it reaches any gate, and it also makes the
      // invariant the push-endpoints comment states — "no gate inside the wrapper precedes
      // the key" — literally true of the source rather than merely of the prose. The
      // branches are mutually exclusive on path and method, so the order carries no
      // behavioural weight.
      //
      // Public by design: the browser needs the VAPID key *before* it can
      // subscribe, so no auth header exists yet on first load.
      if (path === "/api/notifications/vapid-public-key" && req.method === "GET") {
        const publicKey = process.env.VAPID_PUBLIC_KEY
        if (!publicKey) return writeJson(res, 503, { ok: false, error: "web-push not configured (VAPID_PUBLIC_KEY unset)" })
        return writeJson(res, 200, { publicKey })
      }
      // WS-7 T20R. setPrefs WRITES the notification preferences store, so it is
      // gated — as the FIRST statement of its own branch rather than by a gate in
      // the enclosing block, because that block is declared-public for
      // vapid-public-key and cannot carry a gate ahead of it.
      if (path === "/api/notifications/prefs" && req.method === "POST") {
        if (!(await requireAuth(req, res))) return true
        writeJson(res, 200, { ok: true, prefs: n.setPrefs(body) })
        return true
      }
      // WS-7 owner ruling. GET /api/notifications/status is GATED as the FIRST
      // statement of its own branch, ahead of the notifierStatus() call, because it is
      // not the machine-level read its allowlist entry claimed: it serves channel state
      // AND `recent` — the last 20 alert records, each carrying a title and a body — which
      // is operator content rather than machine state. The pre-push review had already
      // moved the per-device push-endpoint list off this branch to the GATED
      // push-endpoints below; the alert records were missed, and this gate closes them.
      //
      // IT SITS BELOW THE VAPID BRANCH, beside the other gated sub-routes, for the same
      // reason push-endpoints does: the wrapper cannot carry a gate ahead of the key the
      // browser needs before it can authenticate.
      if (path === "/api/notifications/status" && req.method === "GET") {
        if (!(await requireAuth(req, res))) return true
        writeJson(res, 200, n.notifierStatus())
        return true
      }
      // WS-7 T20R, extended by the finding above. listPushSubscriptionEndpoints
      // READS the push-subscription store and returns a per-device identifier, so
      // it is gated as the FIRST statement of its own branch — ahead of any
      // precondition, because a gate placed after a 400 or a 503 is dead code.
      //
      // IT SITS BELOW THE VAPID BRANCH, beside the other gated sub-routes, so the
      // invariant the wrapper's allowlist entry states — no gate inside the wrapper
      // precedes the key — stays literally true of the source rather than merely
      // of the prose.
      if (path === "/api/notifications/push-endpoints" && req.method === "GET") {
        if (!(await requireAuth(req, res))) return true
        writeJson(res, 200, { ok: true, subscriptionEndpoints: n.listPushSubscriptionEndpoints() })
        return true
      }
      // WS-7 T20R. addPushSubscription WRITES the push-subscription store.
      if (path === "/api/notifications/subscribe-push" && req.method === "POST") {
        if (!(await requireAuth(req, res))) return true
        if (!body?.endpoint) return writeJson(res, 400, { ok: false, error: "subscription endpoint required" })
        writeJson(res, 200, { ok: n.addPushSubscription(body), subscriptions: n.listPushSubscriptions() })
        return true
      }
      // WS-7 T20R. removePushSubscription WRITES the same store, by endpoint.
      if (path === "/api/notifications/unsubscribe-push" && req.method === "POST") {
        if (!(await requireAuth(req, res))) return true
        if (!body?.endpoint) return writeJson(res, 400, { ok: false, error: "subscription endpoint required" })
        writeJson(res, 200, { ok: n.removePushSubscription(body.endpoint), subscriptions: n.listPushSubscriptions() })
        return true
      }
      // T4 (REQ-5): the SW snooze button POSTs the notification tag. A known
      // tag queues a one-shot 10-minute re-show; an already-snoozed tag is an
      // explicit no-op; an unknown tag is a 404 — never a fake success.
      // WS-7 T20R. snoozeAlert WRITES the snooze set, so it is gated.
      if (path === "/api/notifications/snooze" && req.method === "POST") {
        if (!(await requireAuth(req, res))) return true
        const tag = String(body?.tag ?? "")
        if (!tag) return writeJson(res, 400, { ok: false, error: "tag required" })
        const result = n.snoozeAlert({ tag })
        if (!result.ok) {
          if (result.error === "already snoozed") return writeJson(res, 200, { ok: false, error: result.error })
          return writeJson(res, 404, { ok: false, error: result.error })
        }
        return writeJson(res, 200, { ok: true })
      }
      // WS-7 T20R. dispatchAlert SPENDS the notification delivery budget — it sends to
      // every configured channel. An anonymous caller could spend it at will, so it
      // is gated.
      if (path === "/api/notifications/test" && req.method === "POST") {
        if (!(await requireAuth(req, res))) return true
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
    // This route had NO auth check of any kind - no requireAuth, no
    // requireSessionOrFirstRun - so an anonymous GET answered 200 with the whole
    // broker registry. It is NOT a bootstrap-bypass case: it never consults the
    // user store, so no store fault is needed and no first-run bypass was
    // involved. It simply had no gate.
    //
    // The payload is a reconnaissance surface, not a health check: per adapter it
    // names whether the exchange is CONFIGURED, whether it is connected, the rail
    // mode (sessionLive / demoOnly), and every capability the adapter exposes
    // (market-data, account, positions, close-position, ...), plus which adapter
    // is the active executor. That is exactly the input an attacker chooses a
    // target with.
    //
    // The adjacent route below (system/capabilities) is deliberately public and
    // SAYS SO. This one had no such note, which is what distinguishes an omission
    // from a decision. Pinned by ws7AuthBootstrapGateGuard.
    if (!(await requireSessionOrFirstRun(req, res))) return true
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
        // T14/D11: Telegram is a shipping transport, so a capability probe that
        // named only two of them was reporting an incomplete machine. Derived
        // from the notifier's OWN registry rather than restated here, so this
        // probe cannot drift from what can actually send.
        telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        webhook: Boolean(process.env.WEBHOOK_URL)
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
    if (!(await requireAuth(req, res))) return true
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
      // D2/AC-005: the ExpertOption mid leg is removed with the venue. This
      // route compares venues that are ACTUALLY live, so dropping the EO leg
      // leaves the CCXT-vs-CCXT comparison intact and honest: with a single
      // configured exchange there is no cross-venue pair, and the route's own
      // `quotes.length >= 2` gate reports "no spread available" rather than
      // inventing a second venue.
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
      // D2/AC-005: the liveEO buffer + on-demand fetch are removed with the
      // venue; the fan-in below is now the only live intraday path.
      let candles = []
      let source = "none"
      {
        const { getBestCandles } = await import("./services/marketDataBus.mjs")
        const fanIn = await getBestCandles(assetId, { timeframe, count }).catch(() => null)
        if (fanIn?.candles?.length) {
          candles = fanIn.candles.slice(-count)
          source = fanIn.source ?? "none"
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
    // `trades` is deliberately NOT accepted from the request body: a
    // client-supplied signed-trade series would let any authenticated caller
    // manufacture an `available:true` order-flow readout. Only a server-side
    // feed may satisfy the contract. See orderFlow.mjs honesty contract.
    const bars = Array.isArray(body?.candles) ? body.candles : null
    writeJson(res, 200, { ok: true, ...analyzeOrderFlow({ bars, lookback: body?.lookback }) })
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
    if (!(await requireAuth(req, res))) return true
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
    // D2/AC-005: the `result.expertOption` health block is REMOVED. It reported
    // liveEO transport liveness, the EO connector's tuning, and the EO token's
    // capture age — all venue state. The route itself is retained: it still
    // serves the autopilot, prediction, MTF and source-status health, none of
    // which is EO-specific.
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
      // D2/AC-005: the liveEO first-asset buffer is removed with the venue, so
      // the model backtest and MTF health read from the broker fan-in instead.
      // With no live buffer the `insufficient candle data` branch is the honest
      // outcome and is what the note already said.
      let firstAsset = null
      let closes = []
      try {
        const { getActiveBrokers } = await import("./services/brokers/index.mjs")
        const live = getActiveBrokers().find((b) => {
          try { return b.resolveTimeframe(60) === 60 } catch { return false }
        })
        if (live) {
          const rows = await withTimeout(live.getCandles("EURUSD", { timeframe: 60, count: 200 }), 8000).catch(() => [])
          firstAsset = { name: "EURUSD", periods: { 60: rows ?? [] } }
          closes = (rows ?? []).map((c) => Number(c.close ?? c.c)).filter((v) => Number.isFinite(v) && v > 0)
        }
      } catch { /* no live broker — fall through to the honest empty state */ }
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
  // WS-6 T10 INSTRUMENTATION: the status body carries the two store counters, so a
  // failing run can say WHICH mechanism fired: write>0 -> write fault; read>0 with
  // write===0 -> read/shape fault; both 0 -> the store was healthy, look elsewhere. One
  // counter could not, because a read or shape fault returns before writeJSON is called.
  // Both are keyed on the FILE NAME (auth.mjs): this route is UNAUTHENTICATED and the
  // absolute path disclosed the home directory and OS user name. Read the counters off
  // a `store-fault` or `rejected` auth-me line instead — process-scoped, so this
  // endpoint cannot report a dead process. They live HERE and not inside the block
  // below: that comment is the allowlist marker for its hasUsers() call, and must stay CONTIGUOUS with it.
  if (path === "/api/auth/status" && (req.method === "GET" || req.method === "POST")) {
    // NOT A GATE. hasUsers() here is the first-run SIGNUP HINT: it tells the
    // login page whether to offer "create the first account" instead of "sign
    // in". It authorises nothing — the route discloses no account data, and
    // the bootstrap it hints at is enforced by requireSessionOrFirstRun() /
    // requireAuth on the routes that actually matter. "Probably no accounts"
    // is the right answer to a degraded read here: the failure mode is a login
    // page offering the signup form one time too often, which is recoverable,
    // whereas a wrong guess in the other direction would hide the signup form
    // from a genuinely fresh install. Pinned by ws7AuthBootstrapGateGuard.
      writeJson(res, 200, { ok: true, hasUsers: await hasUsers(), authMode: "local", storeWriteFailures: storeWriteFailures(), storeReadFaults: storeReadFaults() })
      return
    }

  if (path === "/api/auth/signup" && req.method === "POST") {
    if (rateLimited(`auth:${clientIp(req)}`, 10, 60_000)) {
      return writeJson(res, 429, { error: "too many attempts — try again in a minute" })
    }
    const result = await createAccount(body)
    // The status is chosen from the result's `code`, never from string-matching its
    // message. A store fault is not a malformed request: 400 claims the caller sent
    // something wrong, and the client is entitled to believe it. This is the same
    // "a status is a claim" rule /api/auth/me already follows at 503.
    if (result.error) {
      return writeJson(res, result.code === "auth_store_unavailable" ? 503 : 400, { error: result.error })
    }
    writeJson(res, 200, { ok: true, token: result.token, user: result.user })
    return
  }

  if (path === "/api/auth/login" && req.method === "POST") {
    if (rateLimited(`auth:${clientIp(req)}`, 10, 60_000)) {
      return writeJson(res, 429, { error: "too many attempts — try again in a minute" })
    }
    const result = await loginAccount(body)
    // 401 is a claim about the TOKEN, so it is sent only when the credentials
    // really were rejected. A store fault never examined them.
    if (result.error) {
      return writeJson(res, result.code === "auth_store_unavailable" ? 503 : 401, { error: result.error })
    }
    writeJson(res, 200, { ok: true, token: result.token, user: result.user })
    return
  }

  if (path === "/api/auth/signout" && req.method === "POST") {
    // revokeToken throws AuthStoreUnavailable when the store could not be read or
    // the write was refused, precisely so this caller cannot report a revocation
    // that did not happen. Answering {ok:true} there would leave the token live
    // for the rest of its TTL while the client clears its local session and
    // believes it is signed out.
    try {
      const revoked = await revokeToken(auth?.slice(7))
      writeJson(res, 200, { ok: true, revoked })
    } catch (err) {
      if (isAuthStoreUnavailable(err)) {
        return writeJson(res, 503, { error: "auth store unavailable", revoked: false })
      }
      throw err
    }
    return
  }

  if (path === "/api/auth/me" && (req.method === "GET" || req.method === "POST")) {
    // 401 is a CLAIM about the token, and the client acts on it by deleting the
    // session. So it must only ever be sent when the token really was rejected.
    // A store read/parse fault is an inconclusive answer and becomes 503, which
    // the client keeps its session through. See resolveAuthUser().
    //
    // ── WS-6 T10 INSTRUMENTATION (round 4) ─────────────────────────────────
    // The terminal-performance flake is UNROOTED: rounds 1, 2 and 3 each proposed a
    // mechanism, round 2's was disproven, and rounds 1 and 3 are mis-specified on
    // the observable. Rather than propose a fourth, this records which branch
    // answered and what it answered, so ONE failing run names the mechanism:
    //
    //   branch "confirmed"      200, session is real        -> look at the client
    //   branch "rejected"       401, token really was refused -> look at lookup
    //   branch "store-fault"    503, nothing was examined    -> look at the store
    //
    // A 401 line here is what produces the recorded 30s
    // `[data-room='markets']` timeout. Six 503 lines spaced 1/2/4/8/8s would be the
    // inconclusive chain instead — but the app RENDERS on that path, so the
    // selector would be satisfied in about a second and it is not this failure.
    // One of those two lines settles it.
    //
    // Gated by PICC_E2E_RUN_ID (see traceAuthMe above) and never thrown from, so it
    // costs one string check per /me call when unarmed and cannot affect the request.
    let user
    try {
      user = await resolveAuthUser(auth)
    } catch (err) {
      if (isAuthStoreUnavailable(err)) {
        traceAuthMe("store-fault", { reason: err?.message ?? "unknown", storeWriteFailures: storeWriteFailures(), storeReadFaults: storeReadFaults() })
        return writeJson(res, 503, { error: "auth store unavailable" })
      }
      traceAuthMe("unhandled", { reason: err?.message ?? "unknown", storeWriteFailures: storeWriteFailures(), storeReadFaults: storeReadFaults() })
      throw err
    }
    if (!user) {
      traceAuthMe("rejected", { hadToken: Boolean(auth), storeWriteFailures: storeWriteFailures(), storeReadFaults: storeReadFaults() })
      return writeJson(res, 401, { error: "not authenticated" })
    }
    traceAuthMe("confirmed", { userId: user.id })
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

  // WS-7 T20R. saveSnapshot OVERWRITES the income snapshot the dashboard renders,
  // so it is a WRITE and is gated on top of the existing localhost-only check —
  // loopback is not an authorisation. The GET sibling below is a read and is
  // untouched, so the two methods are gated independently.
  if (path === "/api/streams/snapshot" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return true
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
    if (!(await requireAuth(req, res))) return
    writeJson(res, 200, await getSnapshot())
    return
  }

  if (path === "/api/listing/analyze" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    if (validateOr400(res, body, "listingAnalyze")) return true
    writeJson(res, 200, await handleListingAnalyze(body))
    return
  }

  if (path === "/api/listing/keywords" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
    writeJson(res, 200, await handleListingKeywords(body))
    return
  }

  if (path === "/api/listing/rewrite" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireAuth(req, res))) return
    if (validateOr400(res, body, "contentGenerate")) return true
    writeJson(res, 200, await handleContentGenerate(body))
    return
  }

  // Client error reports (web dashboard browser console, incl. the studio
  // window). Gated by PICC_ERROR_LOG — when disabled, reports are acknowledged but
  // dropped so clients stop buffering.
  // WS-7 T20R. recordClientReport writes to the server-side error log from a
  // caller-supplied body. Rate limiting bounds the volume but is not an identity,
  // so the write is gated. Gated FIRST — ahead of the errorLogEnabled() and
  // rateLimited() preconditions — because those two answer 200/429, and a gate
  // behind an answer is dead code.
  if (path === "/api/client-logs" && req.method === "POST") {
    if (!(await requireAuth(req, res))) return
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
    if (!(await requireSessionOrFirstRun(req, res))) return true
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
    if (!(await requireSessionOrFirstRun(req, res))) return true
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
      // WS-7 slice C fix round 1. `await` ADDED. constructWebhookEvent is an
      // `async function` (stripe.mjs:39) that THROWS when the secret is missing,
      // and an async function that throws returns a REJECTED PROMISE rather than
      // raising synchronously — so without `await` the surrounding try/catch never
      // sees the failure, the rejection escapes as an unhandled rejection, and
      // the error handling written on the next two lines is inert. Found by the
      // slice C allowlist behaviour sweep, which fires this route anonymously and
      // made the test FILE exit 1 on an unhandled `STRIPE_SECRET_KEY not
      // configured`; the route still answered 400, which is exactly why a
      // status-only assertion would never have found it.
      const event = await constructWebhookEvent(raw, signature)
      await handleStripeWebhook(event)
      writeJson(res, 200, { received: true })
    } catch (err) {
      console.error("[picc] stripe webhook error:", err)
      writeJson(res, 400, { error: "webhook failed", detail: err.message })
    }
    return
  }

  if (path === "/api/billing/ewallet/order" && req.method === "POST") {
    if (!(await requireSessionOrFirstRun(req, res))) return true
    // Bind the order to an owner. In the single-owner first-run (no accounts
    // configured yet) the local operator is the implicit owner; once accounts
    // exist the order must carry the authenticated user's id (audit Fix 6).
    // The bootstrap answer is the gate's OWN verified answer, reused rather than
    // re-read: an order can only ever be stamped "local-owner" when the store is
    // genuinely empty, never because the store could not be read. A fault was
    // refused at the gate above, so this cannot disagree with it.
    const userId = (await verifyUser(auth)) || (bootstrapAnswer(req) ? "local-owner" : null)
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
    if (!(await requireSessionOrFirstRun(req, res))) return true
    const actorUserId = (await verifyUser(auth)) || (bootstrapAnswer(req) ? "local-owner" : null)
    if (!actorUserId) return writeJson(res, 401, { error: "authentication required" })
    // Self-approve is only allowed in the single-owner admin/demo mode (no
    // real accounts configured). Once real accounts exist, only the order's
    // OWNER may confirm it — never an arbitrary caller (audit Fix 6).
    //
    // THIS IS THE MONEY-STATE GATE, and it reads the answer the gate above
    // already verified — not a second store read, so a mid-request fault cannot
    // turn this into an unhandled 500, and the two cannot disagree.
    // submitEwalletOrder() short-circuits the owner check on selfApprove
    // (ewallet.mjs: `if (!owner && !selfApprove) throw`), so a selfApprove
    // reached without a real session admits a LEGACY OWNERLESS order straight
    // to status:"confirmed", self_approved:true — precisely the guarantee that
    // file's own comment claims a stray caller can never break. Deriving it this
    // way can only ever move it toward false: a store fault is refused at the
    // gate, and an authenticated caller is never a bootstrap caller.
    const selfApprove = bootstrapAnswer(req)
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
    // NO bootstrap gate here, and that is deliberate rather than an omission.
    // This route used to carry a `!(await verifyUser(auth)) && (await
    // hasUsers())` line that was DEAD: the two lines below it re-check
    // `if (!userId) return 401` with no first-user bypass at all, so the earlier
    // check could never be the deciding one. It read as a first-run bypass a
    // future edit could rely on, which is the exact hazard the other thirteen
    // gates carried. A real session is required unconditionally, so there is no
    // store answer to get wrong and no helper to call.
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
    // This aggregate route was the one connector endpoint with NO gate at all,
    // while its own /:slug/history sibling below IS gated and discloses the same
    // class of data. The payload is the full registry (slug, label, category,
    // transports, live url, tuned flag, selectors) plus getLatestSnapshots() —
    // which is connector_latest.json, i.e. balance / today / lifetime /
    // payoutThreshold / currency / extra per connector. That is a live-balance
    // disclosure, and it needs NO store fault to reach, so it was strictly
    // easier to exploit than anything the fail-open class covered. There is no
    // global auth middleware in requestListener, so this line is the only gate
    // there is. Pinned by ws7AuthBootstrapGateGuard ("every /api/connectors route
    // is gated").
    if (!(await requireSessionOrFirstRun(req, res))) return true
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
    if (!(await requireSessionOrFirstRun(req, res))) return true
    const limit = Number(parsed.searchParams.get("limit")) || 100
    writeJson(res, 200, { ok: true, provider: slug, history: await getConnectorHistory(slug, limit) })
    return
  }

  const streamMatch = path.match(/^\/api\/connectors\/([a-z0-9_-]+)\/stream$/)
  if (streamMatch && req.method === "GET") {
    const slug = streamMatch[1].toLowerCase()
    const conn = getConnector(slug)
    if (!conn) return writeJson(res, 404, { ok: false, error: `unknown connector "${slug}"` })
    if (!(await requireSessionOrFirstRun(req, res))) return true
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
    // Auth is the only thing standing between a remote caller and a real
    // browser driven at an arbitrary attacker-supplied body.url, so this gate
    // runs before the rate limiter and before collectSource is reached. See
    // the SSRF note on the report: the auth fix closes the fail-open, NOT the
    // missing URL validation.
    if (!(await requireSessionOrFirstRun(req, res))) return true
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
    if (!(await requireSessionOrFirstRun(req, res))) return true
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

  // Per-ministry integration catalog (R9.2). Read-only reference data: the
  // registry is a static seed plus the rows `newsSources.mjs` derives, every
  // source carries honest boundary metadata, and the declared absence reason says
  // what a source REQUIRES. Unknown ministry -> honest empty list, not 404.
  //
  // SECURITY (pre-push review finding 2). The derived rows used to be served here
  // WITH `state` and `configEvidence`, and a probe confirmed an anonymous caller
  // read `newsapi: state=degraded configuredEvidence="NEWSAPI_API_KEY=set +
  // PICC_NEWS_NEWSAPI=on"`. No secret value crosses — `configEvidence` is built
  // from the env var NAMES — so this was environment reconnaissance rather than a
  // leak: which credentials this deployment holds, pollable. Both ungated routes
  // therefore serve the PROJECTION, which carries no env-derived field, and the
  // configuration state moved to the gated sibling below.
  if (path === "/api/integrations" && req.method === "GET") {
    writeJson(res, 200, getUnauthenticatedIntegrations())
    return
  }

  // The CONFIGURATION surface: the same catalog WITH `state` and
  // `configEvidence`, so it is gated as the FIRST statement of its own branch.
  //
  // IT IS ABOVE THE `startsWith` SIBLING BELOW AND MUST STAY THERE. That branch
  // matches every path under `/api/integrations/`, so a gated `/configuration`
  // placed after it would be swallowed by the ungated projection before its gate
  // ever ran — the same ordering hazard the `/api/notifications` wrapper has, in a
  // different direction: there the vapid key needs to be reached WITHOUT a gate,
  // here the gated path has to be REACHED BEFORE one that has none.
  if (path === "/api/integrations/configuration" && req.method === "GET") {
    if (!(await requireAuth(req, res))) return true
    const ministry = String(parsed.searchParams.get("ministry") ?? "").trim()
    const entries = ministry ? getMinistryIntegrations(ministry) : getAllIntegrations()
    writeJson(res, 200, { ok: true, entries })
    return true
  }

  if (path.startsWith("/api/integrations/") && req.method === "GET") {
    const ministry = path.slice("/api/integrations/".length)
    writeJson(res, 200, { ok: true, entries: getUnauthenticatedMinistryIntegrations(ministry) })
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
  // D2/AC-005: the `/api/browser/capture-session` route is REMOVED. Its only
  // body called `captureExpertOptionSession()` — an ExpertOption session-token
  // capture from the in-app browser. The venue it captured a session for is
  // gone, so there is nothing left to capture. Reported as product-visible.

  // D2/AC-005: `eoAssetMatches` is removed with its last caller (the indicators
  // route's liveEO buffer lookup). `assetsEquivalent` is retained — it is
  // imported and used elsewhere for the non-EO broker matching.
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
    // DELIBERATELY NO `allowLocalhost` HERE, unlike its two /api/trading/*
    // siblings. Adding the loopback bypass to the single most sensitive stream
    // in the file would widen exposure for no functional gain: the dashboard
    // already opens this with `fetch(url, { headers: { Authorization } })`
    // (streamBrowser() in src/lib/api.ts), so a signed-in local operator
    // authenticates normally and never needed the bypass. And the bypass is
    // unsound behind the supported reverse-proxy/tunnel setup, where the proxy
    // itself is loopback — the same reasoning requireAuthStrict() is built on.
    // What this route serves is studioStatus() and latestStudioFrame(): live
    // screen frames of the operator's own logged-in browser session.
    if (!(await requireSessionOrFirstRun(req, res, { token }))) return true
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
  if (await verifyUser(req.headers.authorization)) return true
  // First-user bootstrap: with no accounts at all, anyone may through so the
  // first one can be created. That bypass MUST NOT be satisfied by a store
  // fault — hasUsers() answers false both for "no users" and for "users.json
  // unreadable", so gating on it would serve every route below
  // unauthenticated. resolveHasUsers() tells those two apart and we refuse
  // (fail closed) when the store cannot be read.
  let anyUserExists
  try {
    anyUserExists = await resolveHasUsers()
  } catch (err) {
    if (isAuthStoreUnavailable(err)) {
      // Refuse the request. 503 rather than 401 on purpose: the token was not
      // rejected, we simply could not vouch for anyone, and a 401 would make
      // the browser delete a still-valid session (see resolveAuthUser).
      writeJson(res, 503, { error: "auth store unavailable" })
      return false
    }
    throw err
  }
  if (!anyUserExists) return true
  writeJson(res, 401, { error: "authentication required" })
  return false
}

/**
 * The ONE place the first-user bootstrap bypass is expressed for a route.
 *
 * Fourteen routes each carried their own copy of
 *
 *     if (!(await verifyUser(auth)) && (await hasUsers())) return 401
 *
 * which is fail-OPEN: hasUsers() answers `false` for both "no accounts exist"
 * and "users.json is unreadable or corrupt", so a single damaged store
 * satisfied the bypass and served all fourteen unauthenticated — a live
 * trading feed, live screen frames, the agents proxy (real LLM spend), eWallet
 * order creation and confirmation (real money state), connector earnings
 * history, and a drive-by browser pointed at an attacker-supplied URL. The
 * copies were not wrong individually; the class was simply unenforced, and a
 * fix applied per site does not survive the fifteenth site. So the decision
 * lives here once and every gate routes through it.
 *
 * Returns true when the request may proceed — a real session, or a genuinely
 * empty store. Returns false having ALREADY written the response, so a call
 * site is exactly one line and can never double-write.
 *
 * WHY 503 AND NOT 401 ON A STORE FAULT. A 401 is a claim about the CREDENTIAL:
 * it says these credentials were examined and refused. On a store fault nothing
 * was examined, so 401 is simply false. Two consequences follow, and they are
 * the whole justification — neither depends on client behaviour:
 *
 *   1. TRUTHFULNESS. 503 is a claim about the SERVER's ability to answer, and
 *      "the user store could not be read" is exactly what happened. A 401 would
 *      be an answer the server does not have. It would also be the conventional
 *      "re-authenticate" signal, sending an operator to fix a session that was
 *      never the problem.
 *   2. RETRY SAFETY, which is the part that matters most for the money and cost
 *      POSTs (/api/billing/ewallet/*, /api/agents/*). 503 invites a RETRY, and
 *      this gate runs BEFORE any state is created, so a retry after a 503
 *      re-enters the same refusal having changed nothing — a refused order is
 *      not a half-made one. The routes are also rate-limited, and
 *      submitEwalletOrder answers a repeat confirmation with { already: true },
 *      so even an unbounded retry storm cannot weld an order to confirmed. A 401
 *      would be retry-safe too, but it would misdirect the operator instead.
 *
 * Note the client only treats 401 specially on /api/auth/me, which is why that
 * route's 503 was justified by session-destruction and these are not: no other
 * caller destroys a session on a 401, so the arguments here are the two above.
 *
 * THE CREDENTIAL CHECK IS STRICT TOO. verifyUser()/verifyToken() flatten a store
 * fault to null by contract, and about forty call sites depend on that. An auth
 * GATE is not one of them: answering 401 there on a faulted sessions.json is the
 * same false claim about the credential, on the one path where the user store is
 * never even consulted. So the gate uses verifyTokenStrict(), which reports the
 * fault instead of hiding it.
 *
 * WHY THE LOOPBACK BYPASS IS OPT-IN AND OFF BY DEFAULT. `allowLocalhost`
 * defaults to FALSE, so adding this gate to a route can never silently widen
 * its exposure: a bypass has to be asked for by name and justified in a
 * comment. It is unsound behind a reverse proxy or tunnel, where the proxy
 * itself is loopback — the same reasoning documented on requireAuthStrict
 * below. Only the two /api/trading/* routes that already had it pass it.
 *
 * @param {object} [opts]
 * @param {string} [opts.token] bearer token from the query string, for the
 *   SSE feeds the browser opens with fetch() + a header or ?token=.
 * @param {boolean} [opts.allowLocalhost] documented loopback bypass.
 */
async function requireSessionOrFirstRun(req, res, { token = "", allowLocalhost = false } = {}) {
  // Set BEFORE any early return, so bootstrapAnswer() is never undefined and
  // never has to guess. A caller admitted on a real session or a loopback
  // bypass is NOT a bootstrap caller, and must not be able to derive
  // "local-owner" or selfApprove from this request.
  req.__bootstrap = false
  if (allowLocalhost && isLocalhostRequest(req)) return true

  // A ?token= caller has made the token the credential, so the token decides and
  // the bootstrap is not consulted — the pre-existing precedence, kept.
  const bearer = token || String(req.headers.authorization ?? "").replace(/^Bearer /, "")
  if (bearer) {
    const userId = await strictOrRefuse(res, () => verifyTokenStrict(bearer))
    if (userId === STORE_FAULT) return false
    if (userId) return true
    // A present-but-unknown credential is a real miss on a readable store, so
    // the honest answer is 401. (With no credential at all we fall through to
    // the bootstrap below, which is the genuinely-first-run case.)
    if (token) {
      writeJson(res, 401, { error: "authentication required" })
      return false
    }
  }

  req.__bootstrap = await strictOrRefuse(res, () => firstRunBootstrapAllowed())
  if (req.__bootstrap === STORE_FAULT) return false
  if (req.__bootstrap) return true
  writeJson(res, 401, { error: "authentication required" })
  return false
}

/** Marker for "the store faulted, and the refusal has already been written". */
const STORE_FAULT = Symbol("auth-store-fault")

/**
 * Run a strict store read, turning an AuthStoreUnavailable into a 503 that is
 * written HERE rather than by the caller.
 *
 * Centralised so the fault-to-status mapping exists once. The alternative — a
 * try/catch at every call site — is what put fourteen copies of the bypass in
 * the file in the first place.
 */
async function strictOrRefuse(res, read) {
  try {
    return await read()
  } catch (err) {
    if (!isAuthStoreUnavailable(err)) throw err
    writeJson(res, 503, { error: "auth store unavailable" })
    return STORE_FAULT
  }
}

/**
 * The gate's OWN verified answer to "may an unauthenticated caller through?",
 * for routes that must derive from it.
 *
 * The eWallet routes need the bootstrap answer twice more — for the order's
 * owner stamp and for selfApprove, which short-circuits the owner check in
 * submitEwalletOrder. They used to call firstRunBootstrapAllowed() a second and
 * third time, which meant a second and third store read: a fault there escaped
 * as an unhandled 500 rather than the documented 503. Reading the answer the gate
 * already computed removes the re-read entirely, so the two cannot disagree and
 * there is nothing left to catch. Strict `=== true` so an un-gated request
 * (undefined) can never derive a bypass.
 */
function bootstrapAnswer(req) {
  return req.__bootstrap === true
}

// Stricter gate for routes that disclose credential/venue configuration state. `requireAuth` treats
// any loopback peer as trusted, which is correct for the local single-user dev flow but NOT for a
// readout naming configured exchanges, token age, and rail mode: behind the supported
// reverse-proxy/tunnel setup the proxy itself is loopback, so that bypass would hand operational
// credential metadata to an unauthenticated remote caller. This gate accepts ONLY a real session or
// bearer token — no localhost bypass, no first-user bypass.
async function requireAuthStrict(req, res) {
  if (await verifyUser(req.headers.authorization)) return true
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
