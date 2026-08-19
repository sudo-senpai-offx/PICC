// PICC Trading Suite API client — multi-model prediction, read-only
// ExpertOption bridge, and the paper-trading ledger.
import { getToken } from "./auth"

const BASE = "/api"

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {}
  if (init.method && init.method !== "GET") headers["Content-Type"] = "application/json"
  const authToken = token ?? getToken()
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    let detail = ""
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ""
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed: ${res.status}`)
  }
  return (await res.json()) as T
}

function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, token)
}

export interface TradingCredentials {
  expertoptionToken: string
  expertoptionDemo: boolean
  expertoptionWsUrl: string
  paperStartingBalance: number
  riskPerTradePct: number
}

export interface PaperOverview {
  starting: number
  cash: number
  committed: number
  realizedPnl: number
  openCount: number
  closedCount: number
  winRate: number | null
  best: number | null
  worst: number | null
}

export interface TradingStatus {
  ok: boolean
  mode: "paper"
  updatedAt: string
  riskPerTradePct: number
  expertOption: { configured: boolean; demo: boolean; wsUrl: string }
  paper: PaperOverview
}

export interface ModelCalls {
  momentum: number
  meanRevert: number
  trend: number
  monteCarlo: number
}

export interface PredictionResult {
  ok: boolean
  symbol?: string
  name?: string
  currency?: string
  last?: number
  horizonDays: number
  direction: "up" | "down" | "flat"
  strength: number
  confidence: number
  hitRate: number | null
  bestModelHitRate: number | null
  agreement: number
  sampleSize: number
  models: ModelCalls
  note: string
  error?: string
  advisory?: string
  platform?: string
  asset?: { id: string; name: string }
  timeframe?: number
  candles?: number
  account?: { balance: number | null; currency: string | null; demo: boolean | null }
}

export interface PaperPosition {
  id: string
  symbol: string
  side: "up" | "down"
  entry: number
  amount: number
  openedAt: string
  status: "open" | "closed"
}

export interface ClosedTrade extends PaperPosition {
  status: "closed"
  exit: number
  pnl: number
  closedAt: string
  holdingMs: number
}

export interface TradingSignal {
  id: string
  createdAt: string
  symbol?: string
  direction?: string
  confidence?: number
  [key: string]: unknown
}

export function getTradingStatus(): Promise<TradingStatus> {
  return request<TradingStatus>("/trading/status")
}

export function getTradingCredentials(): Promise<TradingCredentials> {
  return request<TradingCredentials>("/trading/credentials")
}

export function saveTradingCredentials(patch: Partial<TradingCredentials>): Promise<TradingCredentials> {
  return post<TradingCredentials>("/trading/credentials", patch)
}

export function predictSymbol(symbol: string, days = 3): Promise<PredictionResult> {
  return post<PredictionResult>("/trading/predict", { symbol, days })
}

export function analyzeExpertOptionAsset(
  assetId: string,
  opts: { timeframe?: number; count?: number; days?: number } = {}
): Promise<PredictionResult> {
  return post<PredictionResult>("/trading/analyze", { assetId, ...opts })
}

export function openPaperTrade(input: {
  symbol: string
  side: "up" | "down"
  entry: number
  amount: number
}): Promise<{ ok: boolean; position: PaperPosition }> {
  return post("/trading/paper/trade", input)
}

export function closePaperTrade(input: { id: string; exit: number }): Promise<{ ok: boolean; closed: ClosedTrade }> {
  return post("/trading/paper/close", input)
}

export function getPaperPositions(): Promise<{ ok: boolean; positions: PaperPosition[] }> {
  return request("/trading/paper/positions")
}

export function getPaperHistory(limit = 50): Promise<{ ok: boolean; closed: ClosedTrade[] }> {
  return post("/trading/paper/history", { limit })
}

export function getTradingSignals(): Promise<{ ok: boolean; signals: TradingSignal[] }> {
  return request("/trading/signals")
}

export function logSignal(input: {
  symbol: string
  direction: string
  confidence: number
  strength?: number
  note?: string
}): Promise<{ ok: boolean; signal: TradingSignal }> {
  return post("/trading/signals", input)
}

/** Resolve a pending signal against a realized outcome price (win/loss/draw). */
export function resolveTradingSignal(input: {
  id: string
  resultPrice: number
  resolvedAt?: string
}): Promise<{ ok: boolean; signal: TradingSignal }> {
  return post("/trading/signals/resolve", input)
}

/** Signal accuracy report: overall + by direction/symbol/horizon. */
export interface AccuracyBucket {
  key: string
  total: number
  wins: number
  losses: number
  draws: number
  winRate: number | null
}

export interface SignalAccuracy {
  ok: boolean
  total: number
  wins: number
  losses: number
  draws: number
  winRate: number | null
  byDirection: AccuracyBucket[]
  bySymbol: AccuracyBucket[]
  byHorizon: AccuracyBucket[]
  recent: TradingSignal[]
}

export function getSignalAccuracy(): Promise<SignalAccuracy> {
  return request<SignalAccuracy>("/trading/accuracy")
}

// ---------------------------------------------------------------------
// Paper ledger analytics (mark-to-market + full metrics suite)
// ---------------------------------------------------------------------
export interface MetricsRow {
  month: string
  trades: number
  pnl: number
  wins: number
  winRate: number | null
}

export interface PerSymbolRow {
  symbol: string
  trades: number
  pnl: number
  wins: number
  winRate: number | null
}

export interface EquityPoint {
  t: string | null
  pnl: number
  equity: number
}

export interface DrawdownPoint {
  t: string | null
  equity: number
  peak: number
  drawdown: number
  drawdownDollars: number
}

export interface TradingMetrics {
  trades: number
  starting: number
  netProfit: number
  grossProfit: number
  grossLoss: number
  profitFactor: number | null
  winRate: number | null
  avgWin: number | null
  avgLoss: number | null
  expectancy: number | null
  totalReturnPct: number | null
  maxDrawdown: number
  maxDrawdownDollars: number
  best: number | null
  worst: number | null
  avgHoldMs: number | null
  perTradeSharpe: number | null
  annualizedSharpe: number | null
  maxWin: number
  maxLoss: number
  currentWin: number
  currentLoss: number
  monthly: MetricsRow[]
  perSymbol: PerSymbolRow[]
  equity: EquityPoint[]
  drawdown: DrawdownPoint[]
}

export interface PaperAnalyticsResult {
  ok: boolean
  overview: {
    starting: number
    cash: number
    committed: number
    realizedPnl: number
    unrealizedPnl: number
    equity: number
    openCount: number
    closedCount: number
    autoClosed: number
  }
  metrics: TradingMetrics
  open: (PaperPosition & { currentPrice: number | null; unrealized: number | null })[]
  autoClosed: ClosedTrade[]
}

export function getPaperAnalytics(): Promise<PaperAnalyticsResult> {
  return request<PaperAnalyticsResult>("/trading/paper/analytics")
}

export function askTradingAssistant(
  question: string,
  context?: Record<string, unknown>
): Promise<{ ok: boolean; source: "llm" | "local"; advice: string }> {
  return post("/trading/assist", { question, context })
}

// ---------------------------------------------------------------------
// ExpertOption demo trading + autopilot (demo account only)
// ---------------------------------------------------------------------

export interface DemoDeal {
  requestId?: string | null
  serverId: string
  assetId: string
  asset: string
  type: "call" | "put"
  amount: number
  openPrice: number
  payout: number
  strikeTime: number
  expTime: number
  openedAt: string
  expiresAt: string | null
  status: "active" | "closed"
  duration?: number
  lastPrice?: number
  result?: "win" | "loss" | "draw"
  closePrice?: number
  profit?: number
  closedAt?: string
}

export interface AutopilotConfig {
  enabled: boolean
  assetId: string
  duration: number
  amount: number | null
  minConfidence: number
  cooldownMs: number
  maxConcurrent: number
  dailyLossLimitPct: number
  maxDailyTrades: number
  aiGate: boolean
  proGate: boolean
  timeframe: number
  count: number
  stopReason: string | null
}

export interface ExpertOptionDemoStatus {
  ok: boolean
  configured: boolean
  demo: boolean
  connected: boolean
  sessionError: string | null
  balance: number | null
  currency: string
  openDeals: DemoDeal[]
  settled: DemoDeal[]
  todayPnl: number
  todayTrades: number
  autopilot: AutopilotConfig & {
    running: boolean
    lastRun: Record<string, unknown> | null
    lastDecision: string | null
  }
}

export function getExpertOptionDemoStatus(): Promise<ExpertOptionDemoStatus> {
  return request("/trading/demo")
}

export function placeDemoTrade(input: {
  assetId: string
  type: "call" | "put"
  amount?: number
  duration?: number
}): Promise<{ ok: boolean; deal: DemoDeal }> {
  return post("/trading/demo/place", input)
}

// ---------------------------------------------------------------------
// Demo analytics + deal history (ExpertOption demo account)
// ---------------------------------------------------------------------
export interface DemoAnalyticsResult {
  ok: boolean
  overview: {
    deals: number
    wins: number
    losses: number
    draws: number
    winRate: number | null
    netProfit: number
    todayPnl: number
    balance: number | null
    currency: string
    starting: number
    avgDurationSec: number | null
  }
  metrics: TradingMetrics
  byType: { type: string; trades: number; wins: number; losses: number; draws: number; pnl: number; winRate: number | null }[]
}

export function getDemoAnalytics(): Promise<DemoAnalyticsResult> {
  return request<DemoAnalyticsResult>("/trading/demo/analytics")
}

export function getDemoDeals(limit = 50): Promise<{ ok: boolean; deals: DemoDeal[] }> {
  return request(`/trading/demo/deals?limit=${limit}`)
}

export function getAutopilotConfig(): Promise<{ ok: boolean; config: AutopilotConfig }> {
  return request("/trading/autopilot")
}

export function saveAutopilotConfig(
  patch: Partial<AutopilotConfig>
): Promise<{ ok: boolean; config: AutopilotConfig }> {
  return post("/trading/autopilot", patch)
}

export function startAutopilot(): Promise<{ ok: boolean; config: AutopilotConfig }> {
  return post("/trading/autopilot/start", {})
}

export function stopAutopilot(reason?: string): Promise<{ ok: boolean; config: AutopilotConfig }> {
  return post("/trading/autopilot/stop", { reason })
}

// ---------------------------------------------------------------------
// Watchlist (tracked symbols + live quotes)
// ---------------------------------------------------------------------
export interface WatchlistQuote {
  symbol: string
  name?: string
  currency?: string
  last: number | null
  source: string | null
  error?: string
}

export function getWatchlistQuotes(): Promise<{ ok: boolean; symbols: WatchlistQuote[] }> {
  return request("/trading/watchlist")
}

export function addToWatchlist(symbol: string): Promise<{ ok: boolean; symbols: string[] }> {
  return post("/trading/watchlist", { symbol })
}

export function removeFromWatchlist(symbol: string): Promise<{ ok: boolean; symbols: string[] }> {
  return request("/trading/watchlist", { method: "DELETE", body: JSON.stringify({ symbol }) })
}

// ---------------------------------------------------------------------
// Market news (Serper) + multi-asset scanner
// ---------------------------------------------------------------------
export interface NewsItem {
  title: string
  link: string
  snippet: string
  source: string
  date: string
}

export interface MarketNewsResult {
  ok: boolean
  query: string
  source: string
  items: NewsItem[]
}

export function getMarketNews(opts: { symbol?: string; query?: string; num?: number } = {}): Promise<MarketNewsResult> {
  return post("/trading/news", opts)
}

export interface ScanSymbolResult {
  ok: boolean
  symbol?: string
  name?: string
  currency?: string
  last?: number
  direction?: string
  confidence?: number
  strength?: number
  hitRate?: number | null
  horizonDays?: number
  sampleSize?: number
  note?: string
  error?: string
}

export interface ScanResult {
  ok: boolean
  horizonDays: number
  scanned: number
  signals: ScanSymbolResult[]
  errors: { ok: boolean; symbol: string; error: string }[]
}

export function scanSymbols(input: { symbols?: string[]; days?: number } = {}): Promise<ScanResult> {
  return post("/trading/scan", input)
}

// Common ExpertOption asset ids for quick analysis buttons.
export const EXPERTOPTION_QUICK_ASSETS = [
  { id: "EURUSD", name: "EUR/USD" },
  { id: "GBPUSD", name: "GBP/USD" },
  { id: "BTCUSD", name: "BTC/USD" },
  { id: "ETHUSD", name: "ETH/USD" },
  { id: "GOLD", name: "Gold" },
  { id: "AUDUSD", name: "AUD/USD" }
]

// ---------------------------------------------------------------------
// Pro Analysis — layered confluence report
// ---------------------------------------------------------------------
export interface ProGroupEvidence {
  name: string
  value: number | null
  read: string
  bull: number
  weight: number
}

export interface ProConfluenceGroup {
  id: string
  name: string
  weight: number
  score: number
  evidence: ProGroupEvidence[]
}

export interface ProPhase {
  phase: string
  label: string
  quadrant: string
  trend: string
  trendStrength: number | null
  trendStrengthLabel: string
  volatility: string
  volatilityPercentile: number
  bandwidthPercentile: number
  squeeze: boolean
  expanding: boolean
  regressionR2: number | null
  persistence: number
  persistenceLabel: string
  alligator: string
  strategy: string
}

export interface ProHtf {
  timeframe: string
  bars: number
  bias: number
  biasLabel: string
  phase: string
  phaseLabel: string
  emaRead: string
  alligator: string
  adx: number | null
  r2: number | null
  last: number | null
}

export interface ProDivergence {
  oscillator: string
  kind: string
  type: string
  ago: number
  price: number | null
  prevBarAgo: number
}

export interface ProSetup {
  id: string
  name: string
  bias: "up" | "down"
  entry: number
  stop: number
  target: number
  rr: number
  trigger: string
}

export interface ProAnalysisResult {
  ok: boolean
  platform?: string
  symbol?: string
  name?: string
  currency?: string
  timeframe?: string
  bars?: number
  last?: number
  lastPrice?: number
  ensemble?: PredictionResult
  phase?: ProPhase
  htf?: ProHtf | null
  bias?: {
    direction: string
    ltf: string
    htf: string
    aligned: boolean
  }
  confluence?: {
    score: number
    direction: string
    confidence: number
    confidenceNotes: string[]
    verdict: "BUY" | "SELL" | "NEUTRAL"
    groups: ProConfluenceGroup[]
    reasoning: string[]
  }
  indicators?: Record<string, unknown>
  divergences?: ProDivergence[]
  levels?: { level: number; kind: string; touches: number }[]
  swings?: { highs: { price: number; ago: number }[]; lows: { price: number; ago: number }[] }
  setups?: ProSetup[]
  risk?: { atr: number | null; atrPct: number | null; suggestedStopPct: number | null; suggestedTargetPct: number | null }
  chartSeries?: Record<string, (number | null)[]>
  advisory?: string
  honesty?: string
  account?: { balance: number | null; currency: string | null; demo: boolean | null }
  error?: string
}

export function proAnalyzeSymbol(
  symbol: string,
  opts: { range?: string; interval?: string; days?: number } = {}
): Promise<ProAnalysisResult> {
  return post<ProAnalysisResult>("/trading/pro/analyze", { symbol, ...opts })
}

export function proAnalyzeExpertOption(
  opts: { assetId?: string; timeframe?: number; count?: number; days?: number } = {}
): Promise<ProAnalysisResult> {
  return post<ProAnalysisResult>("/trading/pro/expertoption", opts)
}

export interface ProNarrativeResult {
  ok: boolean
  source: "llm" | "local"
  provider?: string
  summary: string
  error?: string
}

export function summarizeProAnalysis(report: ProAnalysisResult): Promise<ProNarrativeResult> {
  return post<ProNarrativeResult>("/trading/pro/narrative", { report })
}

// ---------------------------------------------------------------------
// Accuracy ledger — auto-resolving decision tracking + gate backtest
// ---------------------------------------------------------------------
export type LedgerResult = "hit" | "miss" | "push" | "unresolved"
export type LedgerStatus = "pending" | "resolved" | "unresolved"

export interface LedgerEntry {
  id: number
  assetId: string
  asset: string
  direction: "up" | "down" | "flat"
  expirySec: number
  expiresAt: number
  entryTs: number
  winProb: number | null
  empirical: number | null
  sampled: number | null
  ev: number | null
  payout: number | null
  payoutSource: string | null
  confidence: number | null
  priceRR: number | null
  evRR: number | null
  gates: Record<string, boolean> | null
  status: LedgerStatus
  result: LedgerResult | null
  entryPrice: number | null
  exitPrice: number | null
  resolvedAt: number | null
}

export interface LedgerExpiryBucket {
  n: number
  hits: number
  misses: number
  predictedWin: number | null
  predictedEv: number | null
  realizedEv: number | null
  hitRate: number | null
}

export interface LedgerProbBucket {
  n: number
  hits: number
  misses: number
  pushes: number
  hitRate: number | null
}

export interface LedgerStats {
  total: number
  pending: number
  unresolved: number
  resolved: number
  decided: number
  hits: number
  misses: number
  pushes: number
  hitRate: number | null
  predictedEv: number | null
  realizedEv: number | null
  edge: number | null
  byExpiry: Record<string, LedgerExpiryBucket>
  buckets: Record<string, LedgerProbBucket>
}

export interface TradingLedger {
  ok: boolean
  stats: LedgerStats
  engine: { running: boolean; entries: number }
  entries: LedgerEntry[]
}

export function getTradingLedger(limit = 100): Promise<TradingLedger> {
  return request<TradingLedger>(`/trading/ledger?limit=${limit}`)
}

export function flushTradingLedger(): Promise<{ ok: boolean; resolved: number; stats: LedgerStats }> {
  return post("/trading/ledger/flush", {})
}

export interface BacktestRow {
  key: string
  engine: {
    n: number
    hits: number
    misses: number
    pushes: number
    hitRate: number | null
    predictedWin: number | null
    predictedEv: number | null
    realizedEv: number | null
  }
  demo: {
    n: number
    wins: number
    losses: number
    draws: number
    winRate: number | null
    avgPayout: number | null
    realizedEv: number | null
  }
}

export interface GateBacktest {
  ok: boolean
  engine: {
    n: number
    hits: number
    misses: number
    pushes: number
    hitRate: number | null
    predictedEv: number | null
    realizedEv: number | null
  }
  demo: {
    n: number
    wins: number
    losses: number
    draws: number
    winRate: number | null
    avgPayout: number | null
    realizedEv: number | null
  }
  rows: BacktestRow[]
}

export function getLedgerBacktest(): Promise<GateBacktest> {
  return request<GateBacktest>("/trading/ledger/backtest")
}

export interface ObservedPayouts {
  ok: boolean
  source: string
  total: number
  sampled: number
  entries: [string, number][]
  error?: string
}

export function getObservedPayouts(limit = 200): Promise<ObservedPayouts> {
  return request<ObservedPayouts>(`/trading/observed-payouts?limit=${limit}`)
}

export interface BacktestResult {
  ok: boolean
  symbol: string
  days: number
  windows: number
  hitRate: number
  sampleSize: number
  agreement: number
  trades: Array<{ model: string; hitRate: number | null; n: number }>
  equity: Array<{ i: number; v: number }>
  drawdown: Array<{ i: number; v: number }>
  peak: number
  returnPct: number
  maxDrawdown: number
  name?: string
  error?: string
}

export function runBacktest(symbol: string, days = 3, windows = 10): Promise<BacktestResult> {
  return post<BacktestResult>("/trading/backtest", { symbol, days, windows })
}

export interface AdvancedIndicators {
  ichimoku: { tenkan: number | null; kijun: number | null; senkouA: number | null; senkouB: number | null; chikou: number | null; cloudColor: number | null; trend: string }
  fibonacci: { retracements: Array<{ ratio: number; label: string; price: number }>; extensions: Array<{ ratio: number; label: string; price: number }>; swingHigh: number | null; swingLow: number | null; trend: string; range: number | null }
  keltner: { middle: number | null; upper: number | null; lower: number | null; bandwidth: number | null }
  pivots: { classic: { PP: number; R1: number; R2: number; R3: number; S1: number; S2: number; S3: number }; camarilla: Record<string, number>; woodie: Record<string, number> } | null
  volumeProfile: { poc: { price: number; volume: number } | null; vah: number | null; val: number | null; bins: Array<{ price: number; volume: number }> }
  heikinAshi: { time: number; open: number; high: number; low: number; close: number } | null
  ema: { ema20: number | null; ema50: number | null; ema200: number | null; read: string }
  atr: { value: number | null; series: (number | null)[] }
  rsi: { value: number | null; read: string }
  bollinger: { upper: number | null; mid: number | null; lower: number | null; bandwidth: number | null; percentB: number | null }
  macd: { line: number | null; signal: number | null; hist: number | null; cross: string; zero: string }
  stochastic: { k: number | null; d: number | null; cross: string; read: string }
  adx: { adx: number | null; plusDI: number | null; minusDI: number | null; read: string }
  alligator: { state: string; label: string; jaw: number | null; teeth: number | null; lips: number | null }
  aroon: { up: number | null; down: number | null; osc: number | null; read: string }
  psar: { trend: string; value: number | null; reversed: boolean }
  linearRegression: { slope: number | null; slopePct: number | null; r2: number | null; angle: number | null; fit: number | null; upper: number | null; lower: number | null }
}

export interface IndicatorsResult {
  ok: boolean
  assetId: string
  timeframe: string
  bars: number
  last: number
  indicators: AdvancedIndicators
}

export function getAdvancedIndicators(assetId: string, timeframe = "daily", count = 200): Promise<IndicatorsResult> {
  return request<IndicatorsResult>(`/trading/indicators?assetId=${encodeURIComponent(assetId)}&timeframe=${encodeURIComponent(timeframe)}&count=${count}`)
}

export interface Alert {
  id: string
  userId: string
  symbol: string
  condition: string
  value: number
  message: string
  recurring: boolean
  expiresAt: number | null
  status: string
  createdAt: number
  triggeredAt: number | null
  lastPrice: number | null
}

export interface AlertStats {
  total: number
  armed: number
  triggered: number
  expired: number
  disabled: number
  symbols: string[]
}

export function getAlerts(): Promise<{ ok: boolean; alerts: Alert[]; stats: AlertStats }> {
  return request("/trading/alerts")
}

export function createAlert(input: { symbol: string; condition: string; value: number; message?: string; recurring?: boolean; expiresAt?: string }): Promise<{ ok: boolean; alert: Alert }> {
  return post("/trading/alerts", input)
}

export function deleteAlert(id: string): Promise<{ ok: boolean }> {
  return post("/trading/alerts/delete", { id })
}

export function toggleAlert(id: string, enabled: boolean): Promise<{ ok: boolean; alert: Alert }> {
  return post("/trading/alerts/toggle", { id, enabled })
}

export interface CalendarEvent {
  date: string
  time: string
  currency: string
  event: string
  impact: string
  forecast: string
  previous: string
  actual?: string
}

export interface CalendarResult {
  ok: boolean
  events: CalendarEvent[]
  summary: { total: number; high: number; medium: number; low: number; currencies: string[]; nextHigh: CalendarEvent | null }
}

export function getEconomicCalendar(days = 7, currency?: string): Promise<CalendarResult> {
  const params = `days=${days}${currency ? `&currency=${currency}` : ""}`
  return request(`/trading/calendar?${params}`)
}

export interface PortfolioAsset {
  symbol: string
  weight: number
  lastPrice: number
  change24h: number
  dailyReturnVol: number
}

export interface PortfolioAnalytics {
  ok: boolean
  assets: PortfolioAsset[]
  corrMatrix: number[][]
  metrics: {
    sharpeRatio: number
    sortinoRatio: number
    maxDrawdown: number
    valueAtRisk95: number
    stdDev: number
    totalReturn: number
    annualizedReturn: number
    beta: number
  }
  diversificationScore: number
  avgCorrelation: number
  equityCurve: number[]
  assetCount: number
  days: number
}

export function getPortfolioAnalytics(symbols: string[], weights?: number[], days = 90): Promise<PortfolioAnalytics> {
  return post("/trading/portfolio", { symbols, weights, days })
}

export interface WatchlistItem {
  symbol: string
  last: number
  change24h: number
  changeWeek: number
  changeMonth: number
  high30d: number
  low30d: number
  volume: number
}

export interface Watchlist {
  id: string
  name: string
  symbols: string[]
  createdAt: number
  updatedAt: number
  prices: WatchlistItem[]
}

export function getWatchlists(): Promise<{ ok: boolean; watchlists: Watchlist[] }> {
  return request("/trading/watchlists")
}

export function createWatchlist(name: string, symbols: string[] = []): Promise<{ ok: boolean; watchlist: Watchlist }> {
  return post("/trading/watchlists", { name, symbols })
}

export function deleteWatchlistApi(id: string): Promise<{ ok: boolean }> {
  return post("/trading/watchlists/delete", { id })
}

export function addToWatchlistApi(watchlistId: string, symbol: string): Promise<{ ok: boolean; watchlist: Watchlist }> {
  return post("/trading/watchlists", { action: "add", watchlistId, symbol })
}

export function removeFromWatchlistApi(watchlistId: string, symbol: string): Promise<{ ok: boolean; watchlist: Watchlist }> {
  return post("/trading/watchlists", { action: "remove", watchlistId, symbol })
}

export interface ScreenerResult {
  ok: boolean
  results: WatchlistItem[]
  total: number
  universe: number
}

export function screenerRun(opts: { sort?: string; limit?: number; minChange?: number; maxChange?: number; symbols?: string[] } = {}): Promise<ScreenerResult> {
  return post("/trading/screener", opts)
}

export interface PatternDetection {
  index: number
  time: number
  open: number
  high: number
  low: number
  close: number
  patterns: { name: string; direction: string; strength: string; description: string }[]
}

export interface PatternSummary {
  total: number
  uniquePatterns: number
  bullishBias: number
  bearishBias: number
  bias: string
  topPatterns: { name: string; count: number }[]
  recent: PatternDetection[]
}

export function getPatterns(symbol: string, timeframe = "daily", count = 200): Promise<{ ok: boolean; detected: PatternDetection[]; summary: PatternSummary }> {
  return post("/trading/patterns", { symbol, timeframe, count })
}

export interface TradeJournalEntry {
  id: string
  symbol: string
  side: string
  entryPrice: number
  exitPrice: number | null
  quantity: number
  reason: string
  confidence: number
  strategy: string
  tags: string[]
  notes: string
  timeframe: string
  pattern: string
  entryTime: number
  exitTime: number | null
  pnl: number | null
  pnlPct: number | null
  rMultiple: number | null
  status: string
}

export interface JournalStats {
  totalTrades: number
  openTrades: number
  closedTrades: number
  winRate: number
  totalPnl: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  avgRMultiple: number
  maxWinStreak: number
  maxLossStreak: number
  bestTrade: { symbol: string; pnl: number } | null
  worstTrade: { symbol: string; pnl: number } | null
  byStrategy: Record<string, { count: number; pnl: number; wins: number; winRate: number }>
  bySymbol: Record<string, { count: number; pnl: number; wins: number }>
}

export function getJournal(params: { symbol?: string; tag?: string; limit?: number; offset?: number } = {}): Promise<{ ok: boolean; entries: TradeJournalEntry[]; total: number; stats: JournalStats }> {
  const qs = new URLSearchParams()
  if (params.symbol) qs.set("symbol", params.symbol)
  if (params.tag) qs.set("tag", params.tag)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.offset) qs.set("offset", String(params.offset))
  return request(`/trading/journal?${qs}`)
}

export function addJournalEntry(entry: Partial<TradeJournalEntry>): Promise<{ ok: boolean; entry: TradeJournalEntry }> {
  return post("/trading/journal", entry)
}

export function closeJournalEntry(id: string, exitPrice: number, notes?: string): Promise<{ ok: boolean; entry: TradeJournalEntry }> {
  return post("/trading/journal/close", { id, exitPrice, notes })
}

export function deleteJournalEntry(id: string): Promise<{ ok: boolean }> {
  return post("/trading/journal/delete", { id })
}

export interface TradingSession {
  id: string
  name: string
  open: number
  close: number
  color: string
  preferredAssets: string[]
  volatilityFilter: string
  description: string
}

export interface SessionInfo {
  ok: boolean
  current: {
    utcHour: number
    activeSessions: (TradingSession & { hoursRemaining: number })[]
    activeOverlaps: { name: string; start: number; end: number; color: string; volatility: string; description: string; hoursRemaining: number }[]
    nextSession: TradingSession & { hoursUntil: number }
    isHighVolatility: boolean
    preferredAssets: string[]
    description: string
  }
  schedule: {
    schedule: (TradingSession & { isActive: boolean; hoursUntilOpen: number; hoursUntilClose: number | null })[]
    overlaps: { name: string; start: number; end: number; color: string; volatility: string; description: string }[]
    currentTimeUTC: string
    utcHour: number
  }
}

export function getTradingSessions(): Promise<SessionInfo> {
  return request("/trading/sessions")
}

export function getAssetSession(symbol: string): Promise<{ ok: boolean; symbol: string; preferredSessions: { id: string; name: string; color: string }[]; isPreferredNow: boolean; currentSession: string[]; recommendation: string }> {
  return post("/trading/sessions/asset", { symbol })
}

export interface StressScenario {
  name: string
  portfolioImpact: number
  assetImpacts: { symbol: string; weight: number; shock: number; impact: number }[]
}

export interface StressTestResult {
  ok: boolean
  scenarios: StressScenario[]
  worstCase: StressScenario
  bestCase: StressScenario
  avgImpact: number
}

export function runStressTest(symbols: string[], weights?: number[]): Promise<StressTestResult> {
  return post("/trading/stress-test", { symbols, weights })
}

export interface AlertHistoryEntry {
  id: string
  alertId: string
  symbol: string
  condition: string
  value: number
  price: number
  message: string
  ts: number
}

export function getAlertHistoryApi(limit = 50, symbol?: string): Promise<{ ok: boolean; history: AlertHistoryEntry[] }> {
  const params = `limit=${limit}${symbol ? `&symbol=${symbol}` : ""}`
  return request(`/trading/alerts/history?${params}`)
}
