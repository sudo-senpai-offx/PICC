import { getToken } from "./auth"

/**
 * Typed clients for the four analysis routes the frontend never called:
 * `POST /api/trading/volatility`, `/api/trading/sentiment`,
 * `/api/trading/risk-parity` and `/api/trading/orderflow` (UI-2, wave 1 of the
 * surface-less endpoint audit).
 *
 * THE TYPES ARE A CLOSE TRANSCRIPT OF WHAT THE SERVER SERVES, and the absences
 * are transcribed rather than smoothed. Every field the server can decline to
 * produce is `| null` here, every field it omits entirely on some branch is
 * declared `?: never` on that branch, and where the server's own shape is a
 * two-branch union the union is reproduced with the server's own discriminator.
 * Widening any of these to `number` or `string` at the render boundary is the
 * defect this module exists to prevent: `0` means measured-and-zero and `null`
 * means nobody measured it, and the two must stay distinguishable all the way
 * to the DOM.
 *
 * THREE FACTS THE SHAPES ALONE DO NOT CARRY, so they are carried in comments
 * that the UI is expected to render rather than merely respect:
 *
 *  1. `risk-parity` SILENTLY DROPS symbols. `handlers.mjs:5178` keeps a history
 *     only when it has 30+ closes, `riskParity.mjs:146` then keeps only symbols
 *     with 65+ closes, and a failed fetch is swallowed by an EMPTY catch block
 *     (`handlers.mjs:5179`). NOTHING in the response reports a dropped symbol.
 *     The only statement of coverage the payload makes is the key set of
 *     `weights`, so the UI computes the difference against what it asked for
 *     and shows it.
 *  2. `orderflow` is an ABSENCE, not a zero. `orderFlow.mjs` reports
 *     `available: false` with `cumulative: null` and `avgDelta: null`, and the
 *     route refuses client-supplied `trades` on purpose
 *     (`handlers.mjs:5727`): a client-supplied signed-trade series would let any
 *     authenticated caller manufacture an `available: true` readout.
 *  3. `volatility` SERVES ITS REFUSAL WITH HTTP 200. Under 30 candles,
 *     `volatilitySnapshot` returns `{ok:false, error}` and the route spreads it
 *     after `ok:true`, so the body arrives `ok:false` on a 200. A client that
 *     only branches on `res.ok` renders a refusal as an empty panel.
 */

// ---------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------

function headers(withJson: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  if (withJson) out["Content-Type"] = "application/json"
  // All four routes are behind `requireAuth`. An anonymous call is refused with
  // a 401, which becomes a refusal carrying its reason, never an empty panel.
  const token = getToken()
  if (token) out.Authorization = `Bearer ${token}`
  return out
}

/**
 * A refusal becomes a thrown Error carrying the server's own words.
 *
 * `400 symbol required`, `502 <upstream message>` and a `401` from the auth gate
 * all arrive here, and the message is what the panel renders. Falling back to a
 * bare status code is a last resort, never the first choice: the reason is the
 * only useful part of a refusal.
 */
async function readJson<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(body.error || `${label} failed: ${res.status}`)
  }
  return body
}

async function post<T>(path: string, body: unknown, label: string): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(body)
  })
  return readJson<T>(res, label)
}

// ---------------------------------------------------------------------
// GET|POST /api/trading/volatility  (handlers.mjs:5141)
// ---------------------------------------------------------------------

/**
 * One volatility estimator's result, as `volatility.mjs` actually returns it.
 *
 * THE UNION IS THE HONESTY. Every estimator returns a bare
 * `{daily: null, annual: null, period}` when its sample is too short and the
 * full shape only when it produced an estimate, so `annual` is the server's own
 * discriminator and the union is keyed on it. `annualPct` and `sampleSize` are
 * declared `?: never` on the absent branch because those KEYS ARE ABSENT from
 * the payload there; typing them `string | null` would describe a wire shape the
 * server never sends and would let a renderer read a key that does not exist.
 */
export type VolEstimator =
  | { daily: null; annual: null; period: number; annualPct?: never; sampleSize?: never }
  | { daily: number; annual: number; annualPct: string; period: number; sampleSize?: number }

/**
 * The ATR regime block. Same two-branch shape (`volatility.mjs:342`).
 *
 * `regime` is a CLOSED UNION on the measured branch and the literal `"unknown"`
 * on the absent one, because those six labels are the only ones the classifier
 * can produce; a readout claiming a seventh is a compile error here.
 */
export type VolAtr =
  | {
      regime: "unknown"
      atr: null
      atrPct: null
      percentile: null
      atrPctPct?: never
      avgAtr?: never
      shrinking?: never
      breakoutWarning?: never
    }
  | {
      regime: "normal" | "elevated" | "high" | "low" | "compressed"
      atr: number
      atrPct: number
      atrPctPct: string
      avgAtr: number
      percentile: number
      shrinking: boolean
      breakoutWarning: boolean
    }

export interface VolGarchForecast {
  step: number
  variance: number
  volatility: number
  volatilityPct: string
}

/**
 * GARCH(1,1). `ok: false` carries nulls and an empty forecast rather than
 * zeros (`volatility.mjs:231`), so the UI must never print `omega 0` here: a
 * model that did not fit is not a model with a zero coefficient.
 */
export type VolGarch =
  | {
      ok: false
      omega: null
      alpha: null
      beta: null
      currentVol: null
      forecast: VolGarchForecast[]
      persistence?: never
      longRunVol?: never
      currentVolPct?: never
      sampleSize?: never
    }
  | {
      ok: true
      omega: number
      alpha: number
      beta: number
      persistence: number
      longRunVol: number
      currentVol: number
      currentVolPct: string
      forecast: VolGarchForecast[]
      sampleSize: number
    }

/**
 * The route's own refusal, served with HTTP 200 when the fetched history held
 * fewer than 30 usable closes (`volatility.mjs:434`). `symbol` and `name` are
 * still present because the route spreads the snapshot after them.
 */
export interface VolatilityRefused {
  ok: false
  symbol: string
  name: string
  error: string
}

export interface VolatilitySnapshot {
  ok: true
  symbol: string
  name: string
  atr: VolAtr
  /** Close-to-close, the fallback estimator (`volatility.mjs:218`). */
  realized: VolEstimator
  parkinson: VolEstimator
  garmanKlass: VolEstimator
  yangZhang: VolEstimator
  garch: VolGarch
  lastPrice: number
  /** The sample every estimator above was computed over. */
  candleCount: number
  /** ISO-8601, produced by the snapshot itself (`volatility.mjs:447`). */
  timestamp: string
}

export type VolatilityResponse = VolatilityRefused | VolatilitySnapshot

export async function fetchVolatility(symbol: string): Promise<VolatilityResponse> {
  return post<VolatilityResponse>("/api/trading/volatility", { symbol }, "volatility")
}

// ---------------------------------------------------------------------
// POST /api/trading/sentiment  (handlers.mjs:5714)
// ---------------------------------------------------------------------

export interface SentimentNewsLeg {
  score: number
  bullish: number
  bearish: number
  neutral: number
  sampleSize: number
  source: "news"
  retrievalModes: string[]
  sources: string[]
  /** Always `null`: no leg in this tree checks a publisher's licence. */
  verified: null
}

export interface SentimentSocialLeg {
  score: number
  velocity: number
  historySize: number
  source: "social-derived"
}

export interface SentimentComposite {
  score: number
  label: "Bullish" | "Slightly Bullish" | "Neutral" | "Slightly Bearish" | "Bearish"
  extreme: boolean
  weighted: { news: number; social: number | null }
  legsPresent: string[]
  /**
   * The share of the declared 0.6+0.4 leg weight this composite could reach:
   * 1 with both legs, 0.6 with the derived social leg absent. A label read
   * without it was drawn from a band narrower than the one it is named for, and
   * the server deliberately does NOT renormalise (`legWeightsRenormalised`).
   */
  declaredLegWeightReached: number
  legWeightsRenormalised: false
}

/**
 * What every sentiment shape carries, measured or not.
 *
 * `available` IS NOT A SENTIMENT LEVEL. It is `composite !== null`
 * (`sentimentEngine.mjs:168`), and this engine has no neutral default: an
 * unreadable symbol produces no score at all rather than a zero.
 */
interface SentimentCommon {
  ok: true
  available: boolean
  /** The COMPOSITE's reason. null when a composite exists. */
  reason: string | null
  composite: SentimentComposite | null
  news: SentimentNewsLeg | null
  newsUnavailableReason: string | null
  social: SentimentSocialLeg | null
  socialUnavailableReason: string | null
  /** When sentiment was last MEASURED. Never a substitute for `timestamp`. */
  observedAt: number | null
  /** When the engine last ran, measured or not. */
  timestamp: number
  history: unknown[]
}

export interface SentimentReading extends SentimentCommon {
  symbol: string
  provenance: unknown[]
  unprovenanced: string[]
  copilot: unknown
}

/**
 * The reading for a symbol that cannot even be named (`unavailableReading`).
 *
 * A SEPARATE VARIANT rather than a flag, because `symbol` is `string | null`
 * here and the shape carries two fields the measured reading does not. `news`
 * and `social` are narrowed to `null` so a renderer cannot read a leg off a
 * reading that never evaluated one.
 */
export interface SentimentUnsearchable extends SentimentCommon {
  symbol: string | null
  normalizedSymbol: null
  available: false
  reason: string
  composite: null
  news: null
  social: null
  /** Always empty on this path; no source was asked. */
  provenance: unknown[]
  sourcesConfigured: number
}

export type SentimentResponse = SentimentReading | SentimentUnsearchable

export async function fetchSentiment(symbol: string): Promise<SentimentResponse> {
  return post<SentimentResponse>("/api/trading/sentiment", { symbol }, "sentiment")
}

// ---------------------------------------------------------------------
// GET|POST /api/trading/risk-parity  (handlers.mjs:5164)
// ---------------------------------------------------------------------

export interface RiskContribution {
  symbol: string
  weight: number
  riskContribution: string
}

export type RiskParityMethod = "inverse-vol" | "equal-risk-contribution" | "single-asset"

/**
 * A refusal, from either of two places that mean different things.
 *
 * `weights: null` when the ROUTE refused before allocating
 * (`handlers.mjs:5173`, `{ok:false, error:"no symbols"}`, no weights key at
 * all) and `weights: {}` when the ALLOCATOR refused after fetching
 * (`riskParity.mjs:150`). Normalising the absent key to `null` here, at the parse
 * boundary, is what stops a route-level refusal from reading as a portfolio that
 * was measured and came out empty.
 */
export interface RiskParityRefused {
  ok: false
  error: string
  weights: Record<string, number> | null
}

export interface RiskParityMeasured {
  ok: true
  /**
   * THE ONLY STATEMENT OF COVERAGE THE PAYLOAD MAKES. A requested symbol absent
   * from these keys was dropped somewhere the route does not report, so the UI
   * must not present this as the allocation over everything it asked for.
   */
  weights: Record<string, number>
  method: RiskParityMethod
  /** Set only on the inverse-vol and ERC branches; null on single-asset. */
  symbolCount: number | null
  /**
   * Annualised vol per surviving symbol, INCLUDING the ones that got no weight.
   * A null entry is a symbol the allocator could not measure at all; a 0 entry
   * is a measurement that PUBLISHES as 0 — either measured as exactly 0, or
   * non-zero and below the published 4dp precision (see `VolStatus`). The
   * allocator used to replace both with an invented 0.20 and weight by it.
   */
  vols: Record<string, number | null> | null
  /**
   * Per-symbol record of what the volatility measurement actually was, so a
   * dropped symbol's absence is named rather than visible only as a missing key.
   */
  volStatus: Record<string, VolStatus> | null
  portfolioVol: number | null
  portfolioVolPct: string | null
  riskContributions: RiskContribution[] | null
  iterations: number | null
  /** Present on branches that refuse or decline to compute; null otherwise. */
  reason?: string | null
}

export type RiskParityResponse = RiskParityRefused | RiskParityMeasured

/**
 * WHAT A PER-SYMBOL VOLATILITY MEASUREMENT ACTUALLY WAS.
 *
 * Four states, and the distinction between the last three is the whole point —
 * a published `0` is not one fact but three, and calling all of them "the asset
 * does not move" is a false statement about a measurement:
 *
 *  - `measured`              — a real, positive annualized volatility. The only
 *                              state that may be inverse-volatility weighted.
 *  - `measured-zero`         — a REAL measurement of exactly 0: every
 *                              positive-price transition in the window is
 *                              identical. Collapsing this into "no data" would
 *                              be as dishonest as the constant it replaced, in
 *                              the opposite direction.
 *  - `measured-rounded-zero` — the figure is real and NON-ZERO but falls below
 *                              the published 4dp precision, so it serves as 0.
 *                              Reachable at any window length: one tick among
 *                              N-1 flat prices gives a standard deviation
 *                              proportional to 1/sqrt(N), so a LONGER history
 *                              reaches the floor more easily, not less. This is
 *                              the thinly-traded instrument that prints one tick
 *                              per 200 days; it must not be told it never moved.
 *  - `unmeasured`            — nothing was computed: too few usable log returns
 *                              for the requested period.
 *
 * The two zero states both get no weight (there is no PUBLISHED volatility to
 * invert) and the allocator refuses a portfolio made only of them.
 *
 * The allocator used to collapse all four into an invented 0.20.
 */
export interface VolStatus {
  state: "measured" | "measured-zero" | "measured-rounded-zero" | "unmeasured"
  annual: number | null
  reason: string | null
}

/**
 * The wire shape, before normalisation. Every branch-dependent key is optional
 * because every branch-dependent key IS optional on the wire.
 */
interface RawRiskParity {
  ok: boolean
  error?: string
  reason?: string
  weights?: Record<string, number>
  method?: string
  symbolCount?: number
  vols?: Record<string, number | null>
  volStatus?: Record<string, VolStatus>
  portfolioVol?: number | null
  portfolioVolPct?: string | null
  riskContributions?: RiskContribution[]
  iterations?: number
}

export async function fetchRiskParity(
  symbols: string[],
  method: RiskParityMethod | "erc" = "inverse-vol"
): Promise<RiskParityResponse> {
  const raw = await post<RawRiskParity>("/api/trading/risk-parity", { symbols, method }, "risk-parity")
  if (raw.ok === false) {
    return { ok: false, error: raw.error ?? "risk-parity refused with no reason", weights: raw.weights ?? null }
  }
  return {
    ok: true,
    weights: raw.weights ?? {},
    // The allocator emits exactly these three literals and no others.
    method: raw.method as RiskParityMethod,
    symbolCount: raw.symbolCount ?? null,
    vols: raw.vols ?? null,
    volStatus: raw.volStatus ?? null,
    // `?? null` rather than `|| null`: an explicit `0` from a MEASURED branch
    // must survive as 0. Only an absent key becomes an absence.
    portfolioVol: raw.portfolioVol ?? null,
    portfolioVolPct: raw.portfolioVolPct ?? null,
    riskContributions: raw.riskContributions ?? null,
    iterations: raw.iterations ?? null,
    reason: raw.reason ?? null
  }
}

// ---------------------------------------------------------------------
// POST /api/trading/orderflow  (handlers.mjs:5723)
// ---------------------------------------------------------------------

export interface OrderFlowPoint {
  time: number | null
  side: string | null
  delta: number
  price: number | null
  volume: number
}

export interface OrderFlowSignal {
  type: string
  desc: string
}

/**
 * Order flow is UNAVAILABLE, and the shape says so in words rather than in zeros.
 *
 * `cumulative` and `avgDelta` are `null`, `imbalance` is the literal
 * `"unavailable"` rather than `"neutral"`, and `reason` carries the contract.
 * `delta` and `signals` are typed as empty-able arrays rather than empty tuple
 * types so a fixture can be written literally; both are empty on this path.
 */
export interface OrderFlowUnavailable {
  ok: true
  available: false
  delta: OrderFlowPoint[]
  cumulative: null
  avgDelta: null
  imbalance: "unavailable"
  signals: OrderFlowSignal[]
  /** `"ohlcv-bar-only"` when bars were supplied, `"no-feed"` when none were. */
  dataFidelity: "ohlcv-bar-only" | "no-feed"
  reason: string
  lookback: number | null
}

export interface OrderFlowMeasured {
  ok: true
  available: true
  delta: OrderFlowPoint[]
  cumulative: number
  avgDelta: number
  imbalance: "neutral" | "buy-heavy" | "sell-heavy"
  signals: OrderFlowSignal[]
  dataFidelity: "signed-trades"
  source: string
  lookback: number | null
}

export type OrderFlowResponse = OrderFlowUnavailable | OrderFlowMeasured

/**
 * Order flow. THERE IS NO `trades` PARAMETER AND THERE MUST NEVER BE ONE.
 *
 * The route deliberately refuses a client-supplied signed-trade series
 * (`handlers.mjs:5727`): it would let any authenticated caller manufacture an
 * `available: true` readout, which is exactly the fabrication the `orderFlow.mjs`
 * honesty contract exists to prevent. This function therefore sends `lookback`
 * alone and has no way to send a trade, so the refusal is structural rather than
 * a promise.
 */
export async function fetchOrderFlow(lookback?: number): Promise<OrderFlowResponse> {
  return post<OrderFlowResponse>(
    "/api/trading/orderflow",
    lookback === undefined ? {} : { lookback },
    "orderflow"
  )
}