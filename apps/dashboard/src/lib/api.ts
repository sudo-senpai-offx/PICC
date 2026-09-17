import { runMonteCarlo, assumptionsFor } from "./monteCarlo"
import { getToken } from "./auth"
import { appendData } from "./localdata"
import type {
  CompetitorResult,
  ContentResult,
  FinancialTwinParams,
  FinancialTwinResult,
  ListingAnalysisResult,
  Suggestion
} from "./types"

// Same-origin backend: Vite dev middleware in dev, `node server/index.mjs` in prod.
const BASE = "/api"

export interface SerperVerdictInfo {
  configured: boolean
  observed: {
    probe: "ok" | "rejected" | "error"
    status: number | null
    message: string
    at: number
  } | null
  ageMs: number | null
  stale: boolean
}

export interface HealthInfo {
  ok: boolean
  version: string
  providers: {
    yahoo: boolean
    llm: boolean
    llmProviders: string[]
    serper: boolean
    stripe: boolean
    btcpay: boolean
    ewallet: boolean
    crypto: boolean
    agents: boolean
    amazon: boolean
  }
  // Observed health of the Serper key: presence says nothing about whether the
  // key was accepted. Badges must read this, not providers.serper.
  serper: SerperVerdictInfo
  agents?: { ok: boolean; agents?: string[] } | null
}

export async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {}
  // Only set Content-Type for non-GET requests to avoid triggering unnecessary CORS preflight
  if (init.method && init.method !== "GET") headers["Content-Type"] = "application/json"
  const authToken = token ?? getToken()
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    throw new Error("Server unreachable — is the PICC backend running?")
  }
  if (!res.ok) {
    let detail = ""
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ""
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed: ${res.status}`)
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new Error("Server returned an unparseable response")
  }
}

export function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, token)
}

export function getHealth(token?: string): Promise<HealthInfo> {
  return request<HealthInfo>("/health", {}, token)
}

export interface CorrelationPair {
  asset1: string
  asset2: string
  correlation: number
}

export interface CorrelationResult {
  ok: boolean
  symbols: string[]
  matrix: number[][]
  pairs: CorrelationPair[]
  highlyCorrelated: CorrelationPair[]
  diversificationScore: number
}

/**
 * Correlation screen over held/watchlist instruments (R6). Symbols optional —
 * the server defaults to the trading watchlist and fetches 3mo Yahoo history.
 */
export function tradingCorrelation(symbols?: string[]): Promise<CorrelationResult> {
  return post<CorrelationResult>("/trading/correlation", symbols && symbols.length ? { symbols } : {})
}

export interface EwalletOrderResult {
  orderId: string
  reference: string
  tngNumber: string
  amount: number
  currency: string
  description: string
  instructions: string
}

export interface BtcpayInvoiceResult {
  id: string
  checkoutLink: string
  amount: number
  currency: string
  description: string
}

export function createEwalletOrder(body: { amount: number; currency: string; description: string }): Promise<EwalletOrderResult> {
  return post<EwalletOrderResult>("/billing/ewallet/order", body)
}

export function createBtcpayInvoice(body: { amount: number; currency: string; description: string }): Promise<BtcpayInvoiceResult> {
  return post<BtcpayInvoiceResult>("/btcpay/invoice", body)
}

// ---------------------------------------------------------------------
// Profile — settings + linked accounts (Google/email via the browser
// vault, GitHub via real OAuth with PKCE)
// ---------------------------------------------------------------------
export interface ProfileLink {
  username: string
  linkedAt: string | null
}

export interface ProfileInfo {
  ok: boolean
  name: string
  links: Record<string, ProfileLink>
  githubOauth: { clientId: string; hasSecret: boolean }
}

export function getProfile(): Promise<ProfileInfo> {
  return request<ProfileInfo>("/profile")
}

export function saveProfileName(name: string): Promise<{ ok: boolean; name: string }> {
  return post<{ ok: boolean; name: string }>("/profile/name", { name })
}

export function linkProfileAccount(
  provider: "google" | "email" | "github",
  opts: { username?: string; password?: string } = {}
): Promise<{ ok: boolean; provider: string; username: string }> {
  return post<{ ok: boolean; provider: string; username: string }>("/profile/link", { provider, ...opts })
}

export function unlinkProfileAccount(provider: string): Promise<{ ok: boolean; provider: string; unlinked: boolean }> {
  return post<{ ok: boolean; provider: string; unlinked: boolean }>("/profile/unlink", { provider })
}

export function saveGithubOauth(clientId: string, clientSecret?: string): Promise<{ ok: boolean; clientId: string; hasSecret: boolean }> {
  return post<{ ok: boolean; clientId: string; hasSecret: boolean }>("/profile/github/oauth", { clientId, clientSecret })
}

export function beginGithubOauth(): Promise<{ ok: boolean; authorizeUrl: string; state: string; callbackUrl: string }> {
  return post<{ ok: boolean; authorizeUrl: string; state: string; callbackUrl: string }>("/profile/github/begin", {})
}


// ---------------------------------------------------------------------
// Agents — runtime LLM settings (free Groq by default, configurable in UI)
// ---------------------------------------------------------------------
export interface AgentSettings {
  model: string
  base_url: string
  api_key_configured: boolean
  enabled: boolean
}

export interface AgentSettingsInput {
  model: string
  base_url: string
  api_key: string
  enabled: boolean
}

export function getAgentSettings(): Promise<AgentSettings> {
  return request<AgentSettings>("/agents/settings")
}

export function saveAgentSettings(input: AgentSettingsInput): Promise<AgentSettings> {
  return post<AgentSettings>("/agents/settings", input)
}

// ---------------------------------------------------------------------
// AI models & providers — runtime LLM settings (Settings page)
// ---------------------------------------------------------------------
export interface LLMProviderView {
  id: string
  label: string
  configured: boolean
  model: string
  apiKeySet: boolean
  serviceAccountSet: boolean
  baseUrl?: string
  enabled?: boolean
}

export interface LLMSettingsView {
  ok: boolean
  providers: Record<string, LLMProviderView>
  order: string[]
}

export interface LLMProviderPatch {
  apiKey?: string
  model?: string
  baseUrl?: string
  enabled?: boolean
}

export interface LLMSaveInput {
  providers?: Record<string, LLMProviderPatch>
  order?: string[]
}

export interface LLMTestResult {
  ok: boolean
  provider?: string
  model?: string
  latencyMs?: number
  reply?: string
  error?: string
}

export function getLLMSettings(): Promise<LLMSettingsView> {
  return request<LLMSettingsView>("/settings/llm")
}

export function saveLLMSettings(input: LLMSaveInput): Promise<{ ok: boolean; settings: { providers: Record<string, LLMProviderPatch>; order: string[] } }> {
  return post("/settings/llm", { settings: input })
}

export function testLLMProvider(providerId: string): Promise<LLMTestResult> {
  return post("/settings/llm/test", { provider: providerId })
}

// ── Session capture (S6/T6.2 — PICC-side kill-switch, owner decision 2026-09-15) ──

export interface SessionCaptureSettingsView {
  ok: boolean
  enabled: boolean
  configured: boolean
}

export interface SessionCaptureSaveResult {
  ok: boolean
  settings: { enabled: boolean; configured: boolean }
}

export function getSessionCaptureSettings(): Promise<SessionCaptureSettingsView> {
  return request<SessionCaptureSettingsView>("/settings/session-capture")
}

export function saveSessionCaptureSettings(enabled: boolean): Promise<SessionCaptureSaveResult> {
  return post("/settings/session-capture", { enabled })
}

// ── Resource governor (G3 — PICC_RESOURCE_GOVERNOR_v1.md §7) ───────────────

export interface ResourceLedgerRow {
  id?: string
  created_at: string
  day?: string
  feature: string
  tier: string
  verdict: "accepted" | "throttled" | "failed" | string
  tokens?: number
  latencyMs?: number
  model?: string
  degraded?: boolean
  error?: string
}

export interface ResourceOverview {
  ok: boolean
  /** The real process flag at request time — governor enforcement is ON or OFF. */
  enabled: boolean
  budgets: {
    t0ConfidenceThreshold: number
    t1MaxTokens: number
    t2BurstPerHour: number
    maxLedgerEntriesPerDay: number
  }
  verdicts: { accepted: number; throttled: number; failed: number }
  perTier: Record<
    string,
    {
      calls: number
      tokens: number
      latencyMs: number
      verdicts: { accepted: number; throttled: number; failed: number }
    }
  >
  burst: { hour: string | null; T2: { callsThisHour: number; limitPerHour: number } }
  ledger: { entriesToday: number; capped: boolean; days: string[] }
  rows: ResourceLedgerRow[]
}

export function getResourceOverview(): Promise<ResourceOverview> {
  return request<ResourceOverview>("/settings/llm/resource")
}

/**
 * Run a CrewAI crew through the backend proxy. `crew` is one of
 * "research" | "listing" | "content"; the backend proxies to the agents
 * microservice. Returns whatever the crew report produced.
 */
export function runAgentCrew(
  input: { crew?: string; inputs?: Record<string, unknown> },
  token?: string
): Promise<{ report?: string; error?: string; source?: string }> {
  return post<{ report?: string; error?: string; source?: string }>("/agents/run", input, token)
}

// ---------------------------------------------------------------------
// Crypto market data — CoinGecko (free, no key)
// ---------------------------------------------------------------------
export interface CryptoCoin {
  id: string
  symbol: string
  name: string
  price: number | null
  change24h: number | null
  marketCap: number | null
}

export interface CryptoMarket {
  updatedAt: number
  watchlist: CryptoCoin[]
  movers: { gainers: CryptoCoin[]; losers: CryptoCoin[] }
  trending: { id?: string; name?: string; symbol?: string; thumb?: string; rank?: number | null }[]
}

export function getCryptoMarket(): Promise<CryptoMarket> {
  return request<CryptoMarket>("/crypto/market")
}

// ---------------------------------------------------------------------
// Trading — first-login session policy (persisted approve/reject). The channel
// catalog's per-platform sync mode reads + writes this. "ask" = undecided
// (cleared) → the venue still prompts on first visit.
// ---------------------------------------------------------------------
export type SessionPolicyDecision = "approved" | "rejected" | "ask"

export interface SessionPolicyRow {
  venueId: string
  name: string
  decision: SessionPolicyDecision
  at: string | null
}

export function getSessionPolicy(token?: string): Promise<{ ok: boolean; userId: string; venues: Record<string, SessionPolicyRow> }> {
  return request("/trading/session-policy", {}, token)
}

export function setSessionPolicy(
  venueId: string,
  decision: SessionPolicyDecision,
  token?: string
): Promise<{ ok: boolean; userId: string; venueId: string; decision: SessionPolicyDecision; at: string | null }> {
  return post("/trading/session-policy", { venueId, decision }, token)
}

// ---------------------------------------------------------------------
// Crypto & staking yield monitor — DeFiLlama (keyless) + curated reference
// ---------------------------------------------------------------------
export interface DefiPool {
  pool: string
  project: string
  symbol: string
  chain: string
  apy: number
  apyBase: number
  apyReward: number
  tvlUsd: number
  il7d: number
  ilRisk: boolean
  poolMeta: string
}

export interface LsdRate {
  symbol: string
  apy: number
  tvlUsd: number
}

export interface NativeStakingRate {
  symbol: string
  name: string
  apyLow: number
  apyHigh: number
  note: string
}

export interface YieldSnapshot {
  ok: boolean
  updatedAt: string
  sources: { defi: string; lsd: string; native: string }
  native: NativeStakingRate[]
  lsd: LsdRate[]
  defi: DefiPool[]
  filters: { minTvlUsd: number; maxApy: number }
  error?: string
}

export function getYields(): Promise<YieldSnapshot> {
  return request<YieldSnapshot>("/yields")
}

export interface SchedulerJobStatus {
  name: string
  intervalMs: number
  lastRunAt: number | null
  lastRunMs: number | null
  lastOk: boolean | null
  error: string | null
  runningNow: boolean
}

export interface SchedulerStatus {
  ok: boolean
  running: boolean
  startedAt: string | null
  jobs: SchedulerJobStatus[]
  rateLimits: { budgetPerMinute: number; usedThisMinute: number; keys: unknown[]; cacheSize: number }
}

export function getSchedulerStatus(): Promise<SchedulerStatus> {
  return request<SchedulerStatus>("/scheduler/status")
}

// ---------------------------------------------------------------------
// Earnings collectors — real balances from free self-hosted sources
// ---------------------------------------------------------------------
export interface CashPilotSnapshot {
  ok: boolean
  summary: { total: number; today: number; month: number; changePct: number | null }
  daily: { date: string; usd: number }[]
  breakdown: { service: string; balance: number; threshold: number; total: number }[]
  error?: string
}

export function syncCashPilot(url: string, key: string): Promise<CashPilotSnapshot> {
  return post<CashPilotSnapshot>("/collectors/cashpilot", { url, key })
}

export function pushStreamsSnapshot(
  streams: unknown[],
  earnings: unknown[]
): Promise<{ ok: boolean; updatedAt: string }> {
  return post("/streams/snapshot", { streams, earnings })
}

// ---------------------------------------------------------------------
// Income connectors — one registry, three transports (api / ws / browser).
// Browser transport drives a real Chrome/Edge profile via CDP; the same
// normalized snapshot shape is returned no matter the source.
// ---------------------------------------------------------------------
export interface ConnectorDef {
  slug: string
  label: string
  category: string
  transports: string[]
  transport: string
  url: string
  tuned: boolean
  selectors: Record<string, string>
}

export interface ConnectorSnapshot {
  provider: string
  platform: string
  balance: number | null
  today: number | null
  lifetime: number | null
  payoutThreshold: number | null
  estimatedDaily: number | null
  currency: string
  source: string
  status: string
  error: string | null
  lastChecked: number
  extra?: { url?: string; title?: string }
}

export interface ConnectorRegistry {
  ok: boolean
  browser: boolean
  connectors: ConnectorDef[]
  latest: Record<string, ConnectorSnapshot>
}

export function getConnectors(): Promise<ConnectorRegistry> {
  return request<ConnectorRegistry>("/connectors")
}

export function collectConnector(
  slug: string,
  opts?: { headless?: boolean; waitMs?: number; url?: string }
): Promise<ConnectorSnapshot> {
  return post<ConnectorSnapshot>(`/connectors/${slug}/collect`, opts ?? {})
}

export function getConnectorHistory(
  slug: string,
  limit = 200
): Promise<{ ok: boolean; provider: string; history: ConnectorSnapshot[] }> {
  return request(`/connectors/${slug}/history?limit=${limit}`)
}

export interface StreamFrame {
  dir: "sent" | "recv"
  payload: string
}

export interface StreamEvent {
  type: string
  frame?: StreamFrame
  snapshot?: ConnectorSnapshot
  error?: string
  ok?: boolean
  slug?: string
}

/**
 * Live SSE stream for a connector. Pushes the page's own WebSocket frames
 * plus a fresh DOM snapshot every few seconds. AbortController-based so it
 * works with a Bearer token (EventSource can't send headers).
 */
export function streamConnector(
  slug: string,
  onEvent: (e: StreamEvent) => void
): { close: () => void } {
  const ctrl = new AbortController()
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  fetch(`${BASE}/connectors/${slug}/stream`, { headers, signal: ctrl.signal })
    .then(async (res) => {
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"))
          if (!dataLine) continue
          try {
            onEvent(JSON.parse(dataLine.slice(5).trim()) as StreamEvent)
          } catch {
            /* ignore malformed events */
          }
        }
      }
    })
    .catch(() => undefined)
  return { close: () => ctrl.abort() }
}

// ---------------------------------------------------------------------
// Financial Twin — real Yahoo drift/vol + Monte Carlo
// ---------------------------------------------------------------------
export async function runFinancialTwin(
  params: FinancialTwinParams,
  userId?: string,
  token?: string
): Promise<FinancialTwinResult> {
  try {
    return await post<FinancialTwinResult>("/twin/run", { ...params, userId }, token)
  } catch (err) {
    console.warn("server twin unavailable, using local engine:", err)
    const a = assumptionsFor(params)
    return {
      source: "local",
      ticker: params.ticker.toUpperCase(),
      projection: {
        ...runMonteCarlo(params),
        allocation: a.allocation
      },
      notes: `Live market data was unavailable (${(err as Error).message}). Using model assumptions instead. Educational only.`
    }
  }
}

// ---------------------------------------------------------------------
// Listing Optimizer — OpenAI + Serper via the backend
// ---------------------------------------------------------------------
export async function analyzeListing(
  params: { asin: string; currentTitle: string; currentBullets: string[] },
  userId?: string,
  token?: string
): Promise<ListingAnalysisResult> {
  return post<ListingAnalysisResult>("/listing/analyze", { ...params, userId }, token)
}

// ---------------------------------------------------------------------
// Amazon competitor intel — real SP-API data when configured
// ---------------------------------------------------------------------
export async function fetchCompetitors(
  params: { keywords: string; asin: string },
  token?: string
): Promise<CompetitorResult> {
  return post<CompetitorResult>("/listing/competitors", params, token)
}

// ---------------------------------------------------------------------
// Keyword research — local extraction + LLM long-tail ideas
// ---------------------------------------------------------------------
export interface KeywordResult {
  source: string
  keywords: {
    unigrams: { word: string; count: number }[]
    phrases: { word: string; count: number }[]
    source: string
  }
  longTail: string[]
  category: string[]
  note: string
}

export function analyzeKeywords(
  params: { currentTitle: string; currentBullets: string[] },
  token?: string
): Promise<KeywordResult> {
  return post<KeywordResult>("/listing/keywords", params, token)
}

// ---------------------------------------------------------------------
// Listing rewrites — alternative titles + bullets
// ---------------------------------------------------------------------
export interface RewriteOption {
  title: string
  bullets: string[]
  note: string
}

export interface RewriteResult {
  source: string
  rewrites: RewriteOption[]
}

export function rewriteListing(
  params: { currentTitle: string; currentBullets: string[] },
  token?: string
): Promise<RewriteResult> {
  return post<RewriteResult>("/listing/rewrite", params, token)
}

// ---------------------------------------------------------------------
// Content Studio — OpenAI + Serper research via the backend
// ---------------------------------------------------------------------
export async function generateContent(
  params: { kind: string; topic: string; tone?: string; length?: string },
  userId?: string,
  token?: string
): Promise<ContentResult> {
  return post<ContentResult>("/content/generate", { ...params, userId }, token)
}

// ---------------------------------------------------------------------
// BTCPay Server (self-hosted, no KYC)
// ---------------------------------------------------------------------
export interface BtcpayNodeStatus {
  configured: boolean
  reachable: boolean
  synchronized: boolean | null
}

export async function getBtcpayStatus(): Promise<BtcpayNodeStatus> {
  return request<BtcpayNodeStatus>("/btcpay/status")
}

// ---------------------------------------------------------------------
// Audit logging (self-hosted JSON store — server/data/agent_logs.json etc.)
// ---------------------------------------------------------------------
export async function logAgentAction(
  userId: string | undefined,
  agentName: string,
  action: string,
  input: unknown,
  output: unknown
): Promise<void> {
  if (!userId) return
  await appendData("agent_logs", {
    user_id: userId,
    agent_name: agentName,
    action,
    input: input as Record<string, unknown>,
    output: output as Record<string, unknown>
  }).catch(() => undefined)
}

export async function logHumanConfirmation(
  userId: string | undefined,
  surface: string,
  suggestionId: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  if (!userId) return
  await appendData("human_confirmations", {
    user_id: userId,
    surface,
    suggestion_id: suggestionId,
    acknowledged: true,
    meta
  }).catch(() => undefined)
}

// ---------------------------------------------------------------------
// Small helpers shared by feature components
// ---------------------------------------------------------------------
export const SOURCE_LABELS: Record<string, { label: string; real: boolean }> = {
  yahoo: { label: "Yahoo Finance", real: true },
  gemini: { label: "Google Gemini", real: true },
  groq: { label: "Groq", real: true },
  mistral: { label: "Mistral", real: true },
  cerebras: { label: "Cerebras", real: true },
  openai: { label: "OpenAI", real: true },
  local: { label: "local engine", real: false }
}

// Keep a typed Suggestion for consumers that still construct defaults.
export type { Suggestion }

/** Report (and rebind when needed) the live Google session of the interactive browser. */
export function profileGoogleState(opts?: { navigate?: boolean }): Promise<{
  ok: boolean
  available?: boolean
  onGooglePage?: boolean
  method?: string
  loggedIn?: boolean
  account?: string | null
  linkedAccount?: string | null
  boundAccount?: string | null
  detail?: string | null
  error?: string | null
}> {
  return post(`/profile/google/state`, opts)
}

// ---------------------------------------------------------------------
// Browser Studio — the integrated browser session (a real interactive
// Edge window by default, mirrored live into the content window).
// One real Chromium (CDP screencast) for ALL income sources. PICC can
// overlay, cast, and drive it; credentials are vaulted server-side.
// ---------------------------------------------------------------------
/** Account model read from the content window's own login state (ExpertOption:
 * guest vs active, which wallet the app is showing, signed-in identity). */
export interface StudioAccountModel {
  type: "guest" | "active"
  guest: boolean
  email: string | null
  name: string | null
  wallet: "demo" | "real" | null
  balance: string | null
}

export interface StudioAuthState {
  ok: boolean
  site: string | null
  host: string
  loggedIn: boolean | null
  confidence: "high" | "medium" | "low"
  method: string
  detail: string
  checkedAt: number
  account?: StudioAccountModel | null
}

export interface StudioTab {
  id: number
  url: string
  title: string
  active: boolean
  auth?: StudioAuthState | null
}

export interface StudioStatus {
  ok: boolean
  available: boolean
  open: boolean
  headless: boolean
  profile?: string
  startedAt: string | null
  tabs: StudioTab[]
  activeTabId: number | null
  currentUrl: string | null
  currentTitle: string | null
  currentSite?: StudioDetectedSite | null
  currentAuth?: StudioAuthState | null
  suite?: StudioSuite | null
  viewport: { width: number; height: number }
  latestFrameAt: number | null
  subscriberCount: number
  /** Active screencast performance profile (resolved from perfMode + host). */
  perf?: {
    mode: "low" | "medium" | "high"
    auto: boolean
    captureFps: number
    idleFps: number
    quality: number
  } | null
  vaultSites?: number
  intel?: StudioIntelStatus
  automation?: StudioAutomationStatus
  /** PICC "only refresh when active" state (frozen background tabs, active suites). */
  pause?: {
    frozenCount: number
    activeSuite: string[]
    tabFreezeMs: number
    suiteDeactivateMs: number
  }
}

/** Real-time page intelligence counters, surfaced on every status broadcast. */
export interface StudioIntelStatus {
  console: number
  network: number
  dom: number
  ws: number
  dialogs: number
  pendingDialogs: number
  latestAt: number
}

/** One entry from the real-time page intelligence feed. */
export interface StudioIntelItem {
  ts: number
  tabId?: number | null
  [key: string]: unknown
}

/** A pending native page dialog (alert/confirm/prompt/beforeunload). */
export interface StudioDialogIntel extends StudioIntelItem {
  id: number
  type: "alert" | "confirm" | "prompt" | "beforeunload"
  message: string
  defaultValue?: string
}

export interface BrowserIntel {
  ok: boolean
  open: boolean
  console: StudioIntelItem[]
  network: StudioIntelItem[]
  dom: StudioIntelItem[]
  ws: StudioIntelItem[]
  dialogs: StudioIntelItem[]
  pendingDialogs: StudioDialogIntel[]
}

export interface StudioAutomateMetrics {
  balance: number | null
  today: number | null
  lifetime: number | null
  payoutThreshold: number | null
  estimatedDaily: number | null
}

export interface StudioAutomateResult {
  ok: boolean
  safe: boolean
  site: StudioDetectedSite | null
  connector: string | null
  metrics: StudioAutomateMetrics
  suggestions: string[]
  readAt: string
  runAt?: string
}

export interface StudioAutomationStatus {
  ok: boolean
  running: boolean
  intervalMs: number
  startedAt: string | null
  lastRun: string | null
  lastMetrics: StudioAutomateMetrics | null
  lastSuggestions: string[] | null
  lastError: string | null
}

export interface StudioDetectedSite {
  id: string | null
  name: string
  category: string
  payoutThreshold: number
  url: string
  note: string
  host: string
}

/**
 * The PICC suite auto-applied for the current site's category (server
 * authority). The trading suite injects a live decision HUD overlay; other
 * suites drive the lighter content-window panels.
 */
export interface StudioSuite {
  id: string
  label: string
  icon: string
  overlay?: boolean
  hud?: boolean
  features?: string[]
}

export interface StudioVaultSite {
  site: string
  username: string
  updatedAt: string | null
}

export function getBrowserStatus(): Promise<StudioStatus> {
  return request<StudioStatus>("/browser/status")
}

export function openBrowser(headless?: boolean): Promise<StudioStatus> {
  return post<StudioStatus>("/browser/open", headless === undefined ? {} : { headless })
}

export function closeBrowser(): Promise<StudioStatus> {
  return post<StudioStatus>("/browser/close", {})
}

export function browserGoto(url: string): Promise<{ ok: boolean; url: string; title: string }> {
  return post(`/browser/goto`, { url })
}

export function browserNav(action: "back" | "forward" | "reload"): Promise<{ ok: boolean; url: string; title: string }> {
  return post(`/browser/nav`, { action })
}

export function browserTab(opts: { action: "new" | "open" | "close" | "switch"; url?: string; id?: number }): Promise<StudioStatus> {
  return post(`/browser/tab`, opts)
}

export interface LoginRefreshResult {
  ok: boolean
  results: { tabId: number; auth: StudioAuthState }[]
}

export function refreshBrowserLogin(): Promise<LoginRefreshResult> {
  return post(`/browser/refresh-login`, {})
}

export interface StudioUploadFile {
  name: string
  type: string
  data: string
}

export function browserInput(input: {
  type: "click" | "dblclick" | "mousemove" | "mousedown" | "mouseup" | "wheel" | "type" | "key" | "drop" | "touch"
  nx?: number
  ny?: number
  button?: string
  clickCount?: number
  deltaX?: number
  deltaY?: number
  text?: string
  key?: string
  /** Touch interaction: kind = start | move | end (Input.dispatchTouchEvent). */
  kind?: "start" | "move" | "end"
  files?: StudioUploadFile[]
}): Promise<{ ok: boolean; x: number; y: number; type: string }> {
  return post(`/browser/input`, input)
}

export interface BrowserFileChooser {
  id: number
  tabId: number | null
  multiple: boolean
  accept: string
  ts: number
}

export interface BrowserDownload {
  id: number
  tabId: number | null
  url: string
  filename: string
  ts: number
}

/** Answer a pending native file chooser with the given files (base64 payloads). */
export function browserUploadFiles(
  id: number,
  files: StudioUploadFile[]
): Promise<{ ok: boolean; handled: boolean; id: number; uploaded?: number }> {
  return post(`/browser/upload`, { id, files })
}

/** Grab the current text selection from the live page (for OS clipboard mirror). */
export function browserCopySelection(): Promise<{ ok: boolean; text: string }> {
  return post(`/browser/clipboard/copy`, {})
}

export function getBrowserDownloads(): Promise<{ ok: boolean; downloads: BrowserDownload[] }> {
  return request(`/browser/downloads`)
}

/** Streaming URL for a captured browser download file. */
export function browserDownloadUrl(id: number): string {
  return `${BASE}/browser/download/${id}`
}

/** One line of the PICC overlay, built with createElement/textContent (Trusted-Types safe). */
export type OverlayNode = { tag?: string; className?: string; style?: string; text: string }

export function browserRead(selectors?: Record<string, string>): Promise<Record<string, string | null>> {
  return post(`/browser/read`, { selectors })
}

export function browserAutofill(site?: string): Promise<{ ok: boolean; site: string; filledUser: boolean; filledPass: boolean }> {
  return post(`/browser/autofill`, { site })
}

export function browserLogin(site?: string): Promise<{
  ok: boolean
  site: string
  mode: "google" | "fill"
  steps: string[]
  submitted: boolean
  error?: string | null
  filledUser?: boolean
  filledPass?: boolean
  loggedIn?: boolean
  account?: string | null
  boundTo?: string | null
  boundAccount?: string | null
  bindError?: string | null
}> {
  return post(`/browser/login`, { site })
}

export function browserAssist(url?: string): Promise<{
  ok: boolean
  site: StudioDetectedSite | null
  suite?: StudioSuite | null
  hasSavedCredentials: boolean
}> {
  return post(`/browser/assist`, { url })
}

export function getBrowserVault(): Promise<{ ok: boolean; sites: StudioVaultSite[] }> {
  return request(`/browser/credentials`)
}

export function saveBrowserCredentials(
  site: string,
  creds: { username: string; password: string }
): Promise<{ ok: boolean; site: string; saved: boolean }> {
  return post(`/browser/credentials`, { site, ...creds })
}

export function deleteBrowserCredentials(site: string): Promise<{ ok: boolean; deleted: boolean }> {
  return request(`/browser/credentials`, { method: "DELETE", body: JSON.stringify({ site }) })
}

// ---------------------------------------------------------------------
// Browser settings — Chrome-style behavior: general settings plus per-site
// permissions, and per-source preferences (profile/headless/homepage) that
// let PICC's other categories drive the browser from their own settings.
// ---------------------------------------------------------------------
export interface BrowserSettings {
  stealth: boolean
  /** Humanized interaction — variable per-key typing latency (anti-detection). */
  humanizeInput: boolean
  defaultProfile: string
  homepage: string
  devTools: boolean
  downloadsDir: string
  /** Use a snapshot of your real logged-in browser so logins behave like a normal returning browser. */
  useRealProfile: boolean
  realProfilePath: string
  /** Fingerprint overrides — empty = follow the OS (recommended). */
  timezone: string
  locale: string
  /** PICC "only refresh when active": background tabs hard-freeze after this
   * many ms of inactivity; a suite deactivates its PICC work after this many ms
   * without any tab in that suite being active. */
  tabFreezeMs: number
  suiteDeactivateMs: number
  /** Screencast performance profile: "auto" (host-based) | "low" | "medium" | "high". */
  perfMode: "auto" | "low" | "medium" | "high"
}

export interface BrowserPermission {
  name: string
  label: string
}

export type BrowserPermissionMap = Record<string, string>

export function getBrowserSettings(): Promise<{ ok: boolean; settings: BrowserSettings }> {
  return request(`/browser/settings`)
}

export function saveBrowserSettings(settings: Partial<BrowserSettings>): Promise<{ ok: boolean; settings: BrowserSettings }> {
  return post(`/browser/settings`, { settings })
}

/** Snapshot the user's real browser profile (Edge/Chrome must be closed) into PICC. */
export function browserImportProfile(
  realProfilePath: string,
  profile = "studio"
): Promise<{ ok: boolean; source: string; dir: string; state: { enabled: boolean; sourceExists: boolean; locked: boolean } }> {
  return post(`/browser/import-profile`, { realProfilePath, profile })
}

/** Grab the active ExpertOption tab's live session token into the trading credentials. */
export function browserCaptureSession(): Promise<{ ok: boolean; token: string; source: string }> {
  return post(`/browser/capture-session`, {})
}

// ---------------------------------------------------------------------
// Browser automation — PICC's safe read-only pass plus the optional
// autonomous loop. Never clicks buy/withdraw; it reads the live dashboard
// DOM and surfaces normalized metrics + suggestions for the human.
// ---------------------------------------------------------------------
export function browserAutomate(): Promise<StudioAutomateResult> {
  return post(`/browser/automate`, {})
}

export function browserAutomationStart(intervalMs?: number): Promise<StudioAutomationStatus> {
  return post(`/browser/automate/start`, intervalMs ? { intervalMs } : {})
}

export function browserAutomationStop(): Promise<StudioAutomationStatus> {
  return post(`/browser/automate/stop`, {})
}

// ---------------------------------------------------------------------
// PICC interventions — the human-in-the-loop layer.
//
// Workflows are a safe step DSL that runs against a chosen tab. Mutating steps
// (fill/click/type/submit) become REVIEW QUEUE proposals that must be
// approved, rejected, executed or interrupted before anything touches the
// page. Read-only steps run on their own.
// ---------------------------------------------------------------------
export interface WorkflowStep {
  type: "goto" | "waitMs" | "read" | "assert" | "fill" | "type" | "click" | "key" | "submit" | "notify"
  label?: string
  message?: string
  url?: string
  ms?: number
  selector?: string
  value?: string
  key?: string
  text?: string
  timeout?: number
  risk?: "low" | "medium" | "high"
  selectors?: Record<string, string>
}

export interface Workflow {
  id: string
  name: string
  description?: string
  suite?: string | null
  approval: "manual" | "auto"
  builtin?: boolean
  steps: WorkflowStep[]
}

export interface InterventionProposal {
  id: string
  source: "workflow" | "capture" | "trade"
  workflowId: string
  workflowName: string
  tabId: number | null
  stepIndex: number
  action: string
  label: string
  detail: string
  risk: "low" | "medium" | "high"
  status: "pending" | "approved" | "rejected" | "executed" | "interrupted"
  createdAt: number
  decidedAt: number | null
}

export interface InterventionRun {
  workflowId: string
  name: string
  tabId: number | null
  status: "running" | "waiting" | "done" | "aborted" | "interrupted" | "error"
  stepIndex: number
  totalSteps: number
  pendingId: string | null
  metrics: Record<string, string>
  log: string[]
  approval: "manual" | "auto"
  startedAt: number
  finishedAt: number | null
  error?: string | null
}

export interface InterventionState {
  ok: boolean
  running: InterventionRun | null
  proposals: InterventionProposal[]
}

export function getInterventions(): Promise<InterventionState> {
  return request(`/browser/interventions`)
}

export function respondIntervention(id: string, decision: "approve" | "reject" | "execute" | "interrupt"): Promise<InterventionState> {
  return post(`/browser/interventions/respond`, { id, decision })
}

export function getWorkflows(): Promise<{ ok: boolean; workflows: Workflow[] }> {
  return request(`/browser/workflows`)
}

export function saveWorkflow(workflow: Partial<Workflow> & { steps: WorkflowStep[] }): Promise<{ ok: boolean; workflow: Workflow }> {
  return post(`/browser/workflows/save`, workflow)
}

export function runWorkflow(workflowId: string, tabId?: number, approval?: "auto"): Promise<InterventionState> {
  return post(`/browser/workflows/run`, { workflowId, tabId, approval })
}

export function stopWorkflow(): Promise<InterventionState> {
  return post(`/browser/workflows/stop`, {})
}

export function getBrowserSitePermissions(): Promise<{
  ok: boolean
  permissions: Record<string, BrowserPermissionMap>
  catalog?: BrowserPermission[]
}> {
  return request(`/browser/permissions`)
}

export function setBrowserSitePermission(
  origin: string,
  permission: string,
  setting: "allow" | "block" | "ask"
): Promise<{ ok: boolean; origin: string; permission: string; setting: string }> {
  return post(`/browser/permissions`, { origin, permission, setting })
}

export function removeBrowserSitePermissions(origin: string): Promise<{ ok: boolean; deleted: boolean }> {
  return request(`/browser/permissions`, { method: "DELETE", body: JSON.stringify({ origin }) })
}

export interface BrowserPreference {
  profile?: string
  headless?: boolean
  homepage?: string
  overlay?: boolean
}

export function getBrowserPreferences(): Promise<{ ok: boolean; prefs: Record<string, BrowserPreference> }> {
  return request(`/browser/prefs`)
}

export function saveBrowserPreference(site: string, prefs: BrowserPreference): Promise<{ ok: boolean; site: string; prefs: BrowserPreference }> {
  return post(`/browser/prefs`, { site, prefs })
}

export function getSuitePresets(): Promise<{ ok: boolean; presets: Record<string, unknown> }> {
  return request(`/browser/suite-presets`)
}

export function saveSuitePreset(suiteId: string, settings: unknown): Promise<{ ok: boolean; suite: string; preset: unknown }> {
  return post(`/browser/suite-presets`, { suite: suiteId, settings })
}

export function browserOpenSite(opts: { site: string; url?: string; headless?: boolean; profile?: string }): Promise<StudioStatus> {
  return post(`/browser/site`, opts)
}

/** Snapshot of the real-time page intelligence ring buffers. */
export function getBrowserIntel(): Promise<BrowserIntel> {
  return request<BrowserIntel>("/browser/intel")
}

/** Respond to a pending native page dialog. */
export function browserDialog(opts: { id: number; action: "accept" | "dismiss" | "type"; text?: string }): Promise<{ ok: boolean; handled: boolean; id: number }> {
  return post(`/browser/dialog`, opts)
}

export interface StudioStreamEvent {
  type: string
  data?: string
  ts?: number
  vp?: { width: number; height: number }
  status?: StudioStatus
  tabs?: StudioTab[]
  activeTabId?: number | null
  error?: string
  ok?: boolean
  automation?: StudioAutomateResult
  intel?: { category: "console" | "network" | "dom" | "ws" | "dialog" | "navigation"; data: StudioIntelItem }
  assist?: { site: StudioDetectedSite | null; suite?: StudioSuite | null; hasSavedCredentials: boolean; tabId?: number | null }
  intervention?: InterventionState
  filechooser?: BrowserFileChooser
  download?: BrowserDownload
  closed?: boolean
}

/**
 * Live SSE stream for the integrated browser. Pushes CDP screencast frames +
 * tab/status events. AbortController-based so it works with a Bearer token.
 */
export function streamBrowser(onEvent: (e: StudioStreamEvent) => void): { close: () => void } {
  const ctrl = new AbortController()
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  fetch(`${BASE}/browser/stream`, { headers, signal: ctrl.signal })
    .then(async (res) => {
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"))
          if (!dataLine) continue
          try {
            onEvent(JSON.parse(dataLine.slice(5).trim()) as StudioStreamEvent)
          } catch {
            /* ignore malformed events */
          }
        }
      }
    })
    .catch(() => undefined)
  return { close: () => ctrl.abort() }
}

// ---------------------------------------------------------------------
// Opportunities — research-driven automation catalog (2026 income research)
// ---------------------------------------------------------------------
export interface OpportunityCategory {
  id: string
  key: string
  label: string
  blurb: string
}

export interface Opportunity {
  id: string
  category: string
  title: string
  description: string
  whatItAutomates: string
  integrations: string[]
  effort: "low" | "medium" | "high"
  expectedValue: string
  verified: boolean
  sourceUrl?: string
  status: "ready" | "track" | "needs_research"
}

export interface AgentCrew {
  id: string
  name: string
  agents: string[]
  description: string
  status: string
}

export interface OpportunityCatalogResult {
  ok: boolean
  updatedAt: string
  categories: OpportunityCategory[]
  opportunities: Opportunity[]
  agents: AgentCrew[]
}

export interface WorkflowTemplate {
  file: string
  name: string
  nodes: number
  triggers: string[]
  description: string
  install: string
  embedded?: boolean
}

export interface WorkflowsResult {
  ok: boolean
  dir: string
  dirFound: boolean
  count: number
  workflows: WorkflowTemplate[]
}

export interface BountyBoardResult {
  id: string
  name: string
  url: string
  kind: "json" | "html"
  note: string
  reachable: boolean
  entries: unknown[]
  error: string | null
  count?: number
  pageTitle?: string
  snippet?: string
}

export interface BountyBoardsResult {
  ok: boolean
  checkedAt: string
  boards: BountyBoardResult[]
}

export function getOpportunities(token?: string): Promise<OpportunityCatalogResult> {
  return request<OpportunityCatalogResult>("/opportunities", {}, token)
}

export function getWorkflowTemplates(token?: string): Promise<WorkflowsResult> {
  return request<WorkflowsResult>("/opportunities/workflows", {}, token)
}

export function getBountyBoards(token?: string): Promise<BountyBoardsResult> {
  return request<BountyBoardsResult>("/opportunities/bounties", {}, token)
}

// ---------------------------------------------------------------------
// Command Centre (slice 4) — per-site command cards + the runtime kill
// switch. The server composes every row from OBSERVED state (or an explicit
// "not-wired" label); this client only ever renders what the server reports.
// ---------------------------------------------------------------------
export type CommandCentreMode = "BLOCKED" | "HOLD" | "COPILOT" | "AUTOPILOT_DEMO" | "AUTOPILOT"
export type CommandCentreGateStatus = "pass" | "block" | "restricted" | "mechanism-on" | "not-wired" | "not-decided"

export interface CommandCentreGate {
  gate: string
  status: CommandCentreGateStatus
  note: string
}

export interface CommandCentreSite {
  site: string
  stream: "trading"
  venue: string
  mode: CommandCentreMode
  executionPower: string
  reasons: string[]
  inputs: {
    killSwitch: boolean
    optIn: { status: string; note: string }
    workability: { value: number | null; note: string }
    // "not-yet-available" today; an evidence object once slice 5+ wires it
    deliberation: unknown
  }
  demo: { demoOnly: boolean; active: boolean; note: string | null }
  // the OBSERVED execution leg per site — null when the site has no live
  // execution leg wired yet (never fabricated)
  executionLeg?: {
    leg: string
    action: string
    inFlight: number
    lastExecutedAt: string | null
    consent: string
  } | null
  metrics: {
    source: "observed" | "not-observed" | "not-wired"
    venueId?: string
    observedAt?: string
    stale?: boolean
    note?: string
  }
  gates: CommandCentreGate[]
}

export interface CommandCentreOverview {
  ok: boolean
  at: string
  stream: string
  killSwitch: { global: boolean; sites: Record<string, boolean> }
  sites: CommandCentreSite[]
}

export function getCommandCentreOverview(token?: string): Promise<CommandCentreOverview> {
  return request<CommandCentreOverview>("/command-centre/overview", {}, token)
}

export function setCommandCentreKillSwitch(
  scope: string,
  kill: boolean,
  token?: string
): Promise<{
  ok: boolean
  scope: string
  kill: boolean
  state: { global: boolean; sites: Record<string, boolean> }
}> {
  return post(`/command-centre/kill-switch`, { scope, kill }, token)
}

// ---- Slice 6: the CCXT order rail (trading:ccxt). One proposal rail, TWO
// carriers: carrier A ("Execute via PICC") runs the full gate at click time and
// only then reaches the venue; carrier B ("I placed it — verify") verifies the
// fill read-only. The rail client only renders what the server reports.
export type CommandCentreOrderStatus = "open" | "executed" | "failed" | "verified-filled" | "verify-unobserved"

export interface CommandCentreOrder {
  clientOrderId: string
  idempotencyKey: string
  exchange: string
  symbol: string
  side: "buy" | "sell"
  amount: number
  price: number
  notionalUsd: number
  clamped: boolean
  rationale: string
  status: CommandCentreOrderStatus
  proposedBy: string | null
  proposedAt: string | null
}

export interface CommandCentreGateDecision {
  allow: boolean
  blockedBy: string | null
  reason?: string | null
}

export function getCommandCentreOrders(token?: string): Promise<{ ok: boolean; at: string; orders: CommandCentreOrder[] }> {
  return request<{ ok: boolean; at: string; orders: CommandCentreOrder[] }>("/command-centre/orders", {}, token)
}

export function proposeCommandCentreOrder(
  body: { exchange: string; symbol: string; side: "buy" | "sell"; amount: number; price: number },
  token?: string
): Promise<{
  ok: boolean
  consentBy: string
  gate: CommandCentreGateDecision
  order: { exchange: string; symbol: string; side: "buy" | "sell"; amount: number; price: number; notionalUsd: number; clamped: boolean }
  idempotencyKey: string
  clientOrderId: string
  at: string
}> {
  return post(`/command-centre/orders`, body, token)
}

export function executeCommandCentreOrder(
  body: { clientOrderId: string },
  token?: string
): Promise<{
  ok: boolean
  consentBy: string
  blockedBeforeVenue?: boolean
  gate: CommandCentreGateDecision
  execution: { status: "executed" | "failed"; idempotencyKey?: string; error?: string } | null
  state: { global: boolean; sites: Record<string, boolean> }
}> {
  return post(`/command-centre/orders/execute`, body, token)
}

export function verifyCommandCentreOrder(
  body: { clientOrderId: string; orderId: string },
  token?: string
): Promise<{ ok: boolean; consentBy: string; kind: string; clientOrderId: string; at: string }> {
  return post(`/command-centre/orders/verify`, body, token)
}
