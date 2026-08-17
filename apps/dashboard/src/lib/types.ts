export type RiskTolerance = "conservative" | "moderate" | "aggressive"

/** Where the result came from: a real provider (e.g. "gemini", "groq", "yahoo"), or honest local fallback. */
export type ResultSource = "yahoo" | "local" | (string & {})

export type AssetClassKind = "stock" | "reit" | "bonds" | "crypto" | "index"

export interface FinancialTwinParams {
  ticker: string
  assetClass: AssetClassKind
  capital: number
  riskTolerance: RiskTolerance
  horizonYears: number
  simulations: number
  /** Optional recurring monthly contribution (DCA). Default 0. */
  monthlyContribution?: number
  /** Annual inflation assumption used for inflation-adjusted results. Default 2.5%. */
  inflationRate?: number
  /** When true, monthly contributions grow with inflation over time. */
  inflationAdjustContributions?: boolean
}

export interface Projection {
  medianEnd: number
  p10: number
  p90: number
  /** 5th percentile (expected shortfall). */
  p5: number
  /** Inflation-adjusted percentiles. */
  medianEndReal: number
  p10Real: number
  p90Real: number
  /** Share of paths that end above total contributions. */
  winRate: number
  /** Median / 95th-percentile max drawdown across paths. */
  maxDrawdownP50: number
  maxDrawdownP95: number
  /** Capital + all contributions (nominal). */
  totalContributions: number
  /** Median final value minus total contributions. */
  medianProfit: number
  annualizedReturn: number
  annualizedRealReturn: number
  allocation: Record<string, number>
  horizonYears: number
  simulatedPaths: number
}

export interface HistoricalSeries {
  dates: number[]
  closes: number[]
}

export interface FinancialTwinResult {
  source: ResultSource
  ticker: string
  name?: string
  currency?: string
  lastPrice?: number
  annualizedDrift?: number
  annualizedVol?: number
  /** Trailing dividend yield from Yahoo, if the symbol pays one. */
  dividendYield?: number
  /** Estimated annual dividend income on starting capital. */
  annualDividendEstimate?: number
  projection: Projection
  historical?: HistoricalSeries
  notes: string
}

export interface Suggestion {
  id: string
  title: string
  body: string
  confidence: number
}

export interface ResearchItem {
  title: string
  link: string
  snippet: string
  source: string
  date: string
}

export interface ListingAnalysisResult {
  source: ResultSource
  suggestions: Suggestion[]
  research?: ResearchItem[]
}

export interface Competitor {
  asin: string
  title: string
  brand: string
  image: string
  url?: string
  retailer?: string
  currency: string | null
  buyboxPrice: number | null
  lowestPrice: number | null
  offerCount: number
}

export interface CompetitorResult {
  source: "amazon" | "serper" | "unconfigured" | "error"
  competitors: Competitor[]
  note: string
}

export interface ContentDraft {
  headline: string
  script: string
  tags: string[]
  cta: string
  estimatedReadMinutes?: number
}

export interface ContentResult {
  source: ResultSource
  kind: string
  topic: string
  draft: ContentDraft
  research?: ResearchItem[]
}

export interface AgentLog {
  id: string
  agent_name: string
  action: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  created_at: string
  user_id?: string | null
}

export interface SimulationRow {
  id: string
  type: string
  name: string
  parameters: Record<string, unknown>
  results: Record<string, unknown>
  created_at: string
  user_id?: string | null
}

export interface OverlaySettingsRow {
  enabled: boolean
  platforms: { amazon: boolean; youtube: boolean; brokerage: boolean }
  auto_suggest: boolean
}

// ---------------------------------------------------------------------
// Portfolio — holdings and net-worth snapshots
// ---------------------------------------------------------------------

export type AssetClass = "cash" | "stock" | "etf" | "crypto" | "property" | "ewallet" | "other"

export interface Holding {
  id: string
  name: string
  /** Yahoo symbol ("" for cash / eWallet / property balances). */
  ticker: string
  assetClass: AssetClass
  /** Quantity. Use 1 for flat balances (cash, property, eWallet). */
  units: number
  /** Total cost basis in the holding currency. */
  cost: number
  /** Manual price override for untracked assets. */
  manualPrice?: number
  note?: string
}

export interface NetWorthSnapshot {
  date: string
  total: number
  byClass: Record<AssetClass, number>
}

// ---------------------------------------------------------------------
// Income streams (passive income orchestration)
// ---------------------------------------------------------------------
export type StreamCategory =
  | "bandwidth"
  | "dividend"
  | "interest"
  | "affiliate"
  | "content"
  | "rental"
  | "p2p"
  | "crypto"
  | "defi"
  | "nft"
  | "agent"
  | "other"

export type StreamStatus = "active" | "paused" | "retired"

export interface IncomeStream {
  id: string
  name: string
  category: StreamCategory
  platform: string
  status: StreamStatus
  /** Current pending balance in USD. */
  balance: number
  /** Lifetime earnings in USD. */
  totalEarned: number
  /** Minimum balance required before cash-out. */
  payoutThreshold: number
  payoutMethod: string
  /** Rough daily estimate in USD used for projections. */
  estimatedDaily: number
  lastCollected?: string
  url?: string
  note?: string
  collector?: "honeygain" | "cashpilot" | "manual"
}

export interface StreamEarning {
  id: string
  streamId: string
  date: string // YYYY-MM-DD
  amount: number
  source: "auto" | "manual"
}
