import { getToken } from "./auth"

/**
 * Typed clients for the three CANDLE-DERIVED calculator routes the frontend
 * never called (UI-3, wave 2 of the surface-less endpoint audit):
 * `POST /api/trading/regime`, `/api/trading/expiry` and
 * `POST /api/trading/adaptive-stops`.
 *
 * WHY THIS FILE EXISTS ALONGSIDE `marketAnalysis.ts`
 *
 * Wave 1's four routes took a SYMBOL and made the server fetch. These three take
 * a CANDLE SERIES and make the server fetch nothing: `handlers.mjs:5703` and
 * `:5711` both read `body?.candles || []`, so with no body they would answer
 * `ok: true` over an empty series. A client that omitted `candles` would get a
 * well-formed 200 describing a market nobody measured, so the array is a
 * required part of every request body below and there is no way to call these
 * three without one.
 *
 * WHERE THE CANDLES COME FROM
 *
 * The dashboard already has exactly one candle source: `fetchCandles` in
 * `src/hooks/useCandleData.ts`, which POSTs `/api/trading/candles` and returns
 * `CandleDatum[]` plus the provenance the server reported (`source`, `feed`,
 * `resolvedTimeframe`, `resolved`, `stale`, `verifySources`, `verifiedCount`,
 * `sourceMode`, `sources`). That is the ONLY series this module's callers use.
 *
 * The `useCandleData` HOOK is deliberately NOT used, and this is a finding rather
 * than a preference. The hook is written to fire on mount — its first effect
 * (`useCandleData.ts:322`) calls `fetchCandles` unconditionally — and it also
 * opens a shared realtime tick subscription (`:365`) for every consumer. A panel
 * whose entire job is to be opt-in would therefore open a websocket and two
 * network calls the instant the room rendered, which is the thing these panels
 * exist to avoid. `fetchCandles` is EXPORTED standalone at `:153`, so the same
 * source, the same auth and the same provenance tags are reachable without the
 * hook's effects. No second candle source is introduced.
 *
 * THE SHAPE QUESTION, ANSWERED
 *
 * `fetchCandles` returns `CandleDatum[]`, whose `time` is typed
 * `lightweight-charts.Time` — a union that permits a string. All three services
 * need a NUMBER:
 *
 *   - `expiryOptimizer.mjs:33` does `Number(candles[i].time) - Number(...)` to
 *     infer the bar interval, and a non-numeric time fills the gap list with
 *     NaN, leaving `barSec` at its assumed 60 and mis-scaling every expected
 *     move by `sqrt(barSec / 60)`.
 *   - `regimeDetection.mjs` and `computeAdaptiveStops` ignore `time` entirely.
 *
 * So one real conversion is needed, and it is `toWireCandles` below. The
 * OHLC fields already match what the services read (`c.close`, `c.high`,
 * `c.low`), and `fetchCandles` has already filtered out non-positive and
 * non-numeric OHLC, so `open` is carried for completeness rather than because a
 * service reads it.
 *
 * THE HONESTY RULES THIS FILE ENCODES
 *
 * The absence shapes are transcribed rather than smoothed, and the discriminators
 * are exported so no renderer can reinvent them by testing a VALUE. Two of these
 * services put a literal constant exactly where a measurement would go, and one
 * puts a genuinely measured zero in a field of the same name:
 *
 *  1. `expiryOptimizer.mjs:20` — under 20 bars, `optimizeExpiry` returns
 *     `recommended: EXPIRY_OPTIONS[3]`, the literal `"1m"` entry of its own
 *     option table, and gives every option a literal `score: 50`. It OMITS
 *     `volatility` and `avgMove` entirely. Presenting that `"1m"` as a
 *     recommendation would be the same defect as `riskParity.mjs:154`'s
 *     `portfolioVol: 0`: a constant wearing a measurement's label. `expiryIsScored`
 *     gates on the PRESENCE of `volatility`, never on its value — because a flat
 *     series makes that volatility exactly `0`, and that zero is real.
 *  2. `regimeDetection.mjs:39` — under 30 bars, `detectRegime` returns
 *     `confidence: 0` as a literal, with no `metrics` and no `suggestedStrategy`.
 *     Meanwhile `regimeEngine.mjs` returns `confidence: 0` for a genuinely
 *     measured "directionless RANGING" read. Two different zeros under one name,
 *     so the regime panel gates on the `regime` LABEL (`"unknown"`).
 *  3. `computeAdaptiveStops` discriminates on `reason`. Its
 *     `adx-unobservable` branch returns a real, non-null `atr` beside null stops
 *     and a null `adx`, so `stopsAreMeasured` cannot ask whether `atr` is
 *     present. `reason === null` is the only honest question.
 */

// ---------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------

function headers(): Record<string, string> {
  const out: Record<string, string> = { "Content-Type": "application/json" }
  // All three routes are behind `requireAuth` (NOT `requireAuthStrict`), so an
  // anonymous call is refused with a 401 that becomes a refusal carrying its
  // reason rather than an empty panel.
  const token = getToken()
  if (token) out.Authorization = `Bearer ${token}`
  return out
}

/**
 * A refusal becomes a thrown Error carrying the server's own words.
 *
 * `400 at least 20 candles required`, `400 direction must be 'up' or 'down'` and
 * the auth 401 all arrive here, and the message is what the panel renders. The
 * bare status code is a last resort: the reason is the only useful part.
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
    headers: headers(),
    body: JSON.stringify(body)
  })
  return readJson<T>(res, label)
}

// ---------------------------------------------------------------------
// The wire candle, and the one conversion that produces it
// ---------------------------------------------------------------------

/** What these three services actually read off a bar. */
export interface WireCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

/** Anything with the shape the chart's series has. `time` may be a string. */
export interface ChartLikeCandle {
  time: unknown
  open: number
  high: number
  low: number
  close: number
}

/**
 * WHAT THE CANDLE SOURCE REPORTED ABOUT ITS OWN SERIES.
 *
 * These are the provenance tags `fetchCandles` already returns, kept because a
 * computed number whose provenance is unknown is the thing every panel here
 * exists to prevent. `resolved` is the honest flag: the server served a
 * DIFFERENT bar size than the one requested, and a caller that read only its own
 * request would describe a resolution nobody used.
 */
export interface CandleOrigin {
  /** The bar size requested, in seconds — not necessarily the one served. */
  timeframeSeconds: number
  /** The slug the SERVER served, which is not the slug that was pinned. */
  servedBy: string | null
  feed: string | null
  servedTimeframe: number | null
  resolved: boolean
  stale: boolean
  verifySources: number
  verifiedCount: number
  sourceMode: "auto" | "forced" | "fallback" | null
}

export interface WireCandleResult {
  candles: WireCandle[]
  /**
   * How many bars were NOT forwarded. Counted rather than swallowed: a caller
   * that reports "60 bars" while the server saw 59 is misstating its own input,
   * and the panels print both numbers beside every readout.
   */
  dropped: number
}

/**
 * Coerce the chart's series into the wire shape.
 *
 * DROPS, AND COUNTS, any bar whose `time` or OHLC is not finite. Forwarding one
 * would put `NaN` into `expiryOptimizer`'s gap loop and into every return it
 * derives from `close`, and the resulting scores would look ordinary.
 */
export function toWireCandles(rows: ChartLikeCandle[] | null | undefined): WireCandleResult {
  if (!Array.isArray(rows)) return { candles: [], dropped: 0 }
  const candles: WireCandle[] = []
  let dropped = 0
  for (const row of rows) {
    const time = Number(row?.time)
    const { open, high, low, close } = row ?? ({} as ChartLikeCandle)
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      dropped += 1
      continue
    }
    candles.push({ time, open, high, low, close })
  }
  return { candles, dropped }
}

// ---------------------------------------------------------------------
// POST /api/trading/regime  (handlers.mjs:5699)
// ---------------------------------------------------------------------

/**
 * The four labels `detectRegime`'s own classifier can emit
 * (`regimeDetection.mjs:72-76`). A readout claiming a fifth is a compile error.
 */
export type LegacyRegime = "trending" | "ranging" | "volatile" | "breakout"

/** `regimeDetection.mjs:76` — including its `"adaptive"` fallback. */
export type SuggestedStrategy =
  | "momentum"
  | "mean-reversion"
  | "volatility-breakout"
  | "breakout-follow"
  | "adaptive"

/**
 * `regimeEngine`'s vocabulary is a DIFFERENT ONE, and uppercased: its consensus
 * is drawn from `trend`/`range` votes, so it can report `UNCERTAIN` where the
 * legacy classifier reports `trending`. These two can therefore disagree on the
 * same candles, which is why they are separate types and never merged.
 */
export type EngineRegime = "TRENDING" | "RANGING" | "UNCERTAIN" | "unknown"

export interface RegimeEnginePlaneAbstained {
  bars: number
  abstain: true
  reason: string
  votes?: never
  observed?: never
}

export interface RegimeEnginePlaneVoted {
  bars: number
  abstain: false
  /** Per-dimension voters. An UNOBSERVED read is a null `value`, never a vote. */
  votes: Record<string, { enabled?: boolean; observed: boolean; value: string | null; reason: string }>
  observed: number
  reason?: never
}

export type RegimeEnginePlane = RegimeEnginePlaneAbstained | RegimeEnginePlaneVoted

export interface RegimeEngineReading {
  regime: EngineRegime
  volatile: boolean
  /**
   * `0` HERE IS AMBIGUOUS BY CONSTRUCTION AND IS NOT A DISCRIMINATOR.
   * `regimeEngine.mjs` returns `confidence: 0` both for an engine that abstained
   * entirely and for a genuinely measured "directionless observed market"
   * (`regime: "RANGING"`). Gate on `regime`, never on this number.
   */
  confidence: number
  factors: string[]
  perPlane: Record<string, RegimeEnginePlane>
  latency: { planes: number[]; minBars: number }
  source: "regimeEngine"
  /** Present only on the hand-built literal `regimeDetection.mjs:43` writes. */
  reason?: string
  /** The legacy label this consensus maps to, when it maps cleanly. */
  legacy?: string | null
}

/**
 * UNDER 30 BARS (`regimeDetection.mjs:38`). The route still answers `200 ok:true`
 * — this is a service-level refusal, not a route-level one — and `confidence: 0`
 * here is a LITERAL CONSTANT, like `riskParity.mjs:154`'s `portfolioVol: 0`.
 * `suggestedStrategy` and `metrics` are ABSENT keys here, which is why they are
 * `?: never`: a renderer that reached for them would be reading a key the server
 * did not send.
 */
export interface RegimeUnknown {
  ok: true
  regime: "unknown"
  confidence: number
  factors: string[]
  suggestedStrategy?: never
  metrics?: never
  regimeEngine: RegimeEngineReading
}

/**
 * The computed branch. Every key present.
 *
 * `confidence` is `Math.round(confidence * 100)` (`regimeDetection.mjs:83`) over a
 * score that starts at `0.5` and is capped at `0.95` (`:71-74`), so the field is
 * an INTEGER percentage in **50..95**, not the 0.5..0.95 fraction it is computed
 * from. Transcribed here because a reader comparing the wire value against the
 * source would otherwise conclude the scaling was wrong.
 */
export interface RegimeMeasured {
  ok: true
  regime: LegacyRegime
  confidence: number
  factors: string[]
  suggestedStrategy: SuggestedStrategy
  metrics: { adx: number; atrRatio: number; timeframe: string }
  regimeEngine: RegimeEngineReading
}

export type RegimeResponse = RegimeUnknown | RegimeMeasured

/**
 * THE DISCRIMINATOR IS THE LABEL, NEVER THE CONFIDENCE.
 *
 * `regime === "unknown"` is emitted by exactly one branch and means the service
 * measured nothing. A gate written as `confidence === 0 → unknown` would also
 * fire on the measured branch's minimum (`regimeDetection.mjs:71` starts
 * confidence at 0.5, so a real read never reaches 0 — but that is a property of
 * today's constants, not a contract, and the engine block proves the field can
 * legitimately be 0).
 */
export function regimeIsMeasured(data: RegimeResponse): data is RegimeMeasured {
  return data.regime !== "unknown"
}

/**
 * `detectRegime` takes a timeframe LABEL. `tfSecondsOf` (`regimeDetection.mjs:31`)
 * only recognises `m5`/`1h`/`d1`-style strings and returns `null` for anything
 * else, which silently drops the bias plane to 60 seconds — so this is typed as
 * the label it must be. NOTE `computeAdaptiveStops` takes a NUMBER in a field of
 * the same name, as an ATR period. They are different units of the same word.
 */
export async function fetchRegime(
  candles: WireCandle[],
  timeframe?: string
): Promise<RegimeResponse> {
  return post<RegimeResponse>(
    "/api/trading/regime",
    timeframe === undefined ? { candles } : { candles, timeframe },
    "regime"
  )
}

// ---------------------------------------------------------------------
// POST /api/trading/expiry  (handlers.mjs:5707)
// ---------------------------------------------------------------------

export interface ExpiryOption {
  label: string
  seconds: number
}

/** A scored option. `expectedMove` is absent from the unscored branch entirely. */
export interface ScoredExpiry extends ExpiryOption {
  score: number
  expectedMove?: number
}

/**
 * UNDER 20 BARS (`expiryOptimizer.mjs:20`).
 *
 * `recommended` IS A CONSTANT: `EXPIRY_OPTIONS[3]`, the `"1m"` entry of the
 * service's own table, with no `score` of its own. `all` gives every option a
 * literal `score: 50`. `volatility` and `avgMove` are NOT PRESENT. This is the
 * same defect shape as `riskParity.mjs:154` and it is why the recommended option
 * must not be rendered as a recommendation on this branch.
 */
export interface ExpiryUnscored {
  ok: true
  recommended: ExpiryOption
  all: Array<ExpiryOption & { score: number }>
  volatility?: never
  avgMove?: never
}

/** The computed branch, which sorts `all` by score descending. */
export interface ExpiryScored {
  ok: true
  recommended: ScoredExpiry
  all: ScoredExpiry[]
  volatility: number
  avgMove: number
}

export type ExpiryResponse = ExpiryUnscored | ExpiryScored

/**
 * GATE ON THE PRESENCE OF `volatility`, NEVER ON ITS VALUE.
 *
 * A perfectly flat candle series yields `sqrt(Σr²/n) === 0` (`expiryOptimizer.mjs:25`),
 * so `volatility: 0` is a REAL MEASUREMENT on the computed branch and must print
 * as `0`. The unscored branch omits the key entirely, which is the fact that
 * distinguishes it.
 */
export function expiryIsScored(data: ExpiryResponse): data is ExpiryScored {
  return typeof (data as ExpiryScored).volatility === "number"
}

/**
 * `optimizeExpiry(candles, regime = "ranging", signalStrength = 0.5)` INVENTS BOTH
 * UPSTREAM INPUTS WHEN THEY ARE ABSENT, and the shape it returns does not record
 * which it used. A panel that sent neither would render a scored recommendation
 * whose regime the operator never chose, so both are REQUIRED here: there is no
 * call shape that leaves either to the server's default.
 *
 * `regime` is typed as the four labels the service's own scorer branches on
 * (`expiryOptimizer.mjs:47-56`) — `trending`, `volatile`, `breakout`, and
 * anything else falling to the ranging branch. `signalStrength: 0` is a real
 * strength, not an absence, so it is sent as a number and never omitted.
 */
export async function fetchExpiry(
  candles: WireCandle[],
  regime: LegacyRegime,
  signalStrength: number
): Promise<ExpiryResponse> {
  return post<ExpiryResponse>(
    "/api/trading/expiry",
    { candles, regime, signalStrength },
    "expiry"
  )
}

// ---------------------------------------------------------------------
// POST /api/trading/adaptive-stops  (handlers.mjs:5737)
// ---------------------------------------------------------------------

export type StopsDirection = "up" | "down"

/** `computeAdaptiveStops` picks exactly these four after its own ADX/ATR read. */
export type StopsRegime = "volatile_trend" | "trending" | "volatile" | "ranging"

/**
 * EVERY SERVICE-LEVEL REFUSAL. `takeProfit`, `stopLoss` and `adx` are null on all
 * three, and `regime` is the literal `"unknown"` because an unobserved read never
 * claims one.
 *
 * THE BRANCHES DIFFER IN WHAT THEY STILL MEASURED, and the type keeps that:
 *
 *  - `insufficient-candles`: `atr` is null too.
 *  - `atr-unobservable`: `atr` is null.
 *  - `adx-unobservable`: **`atr` is a REAL measurement**, `adx` is null and
 *    `atrRatio` is present. This is the branch that breaks a naive gate: a panel
 *    asking "did we get an ATR?" would print a genuine ATR beside stops nobody
 *    could produce and read the two as one answer.
 *
 * `atrRatio` is `?: never` because the first two branches do not send it.
 */
export interface AdaptiveStopsRefused {
  ok: true
  takeProfit: null
  stopLoss: null
  adx: null
  regime: "unknown"
  /** Names the absence. Non-null on every refusal. */
  reason: string
  atr: number | null
  atrRatio?: number
  multipliers?: never
}

export interface AdaptiveStopsMeasured {
  ok: true
  takeProfit: number
  stopLoss: number
  adx: number
  regime: StopsRegime
  /** `null` on the measured branch and ONLY there. This is the discriminator. */
  reason: null
  atr: number
  atrRatio: number
  multipliers: { tp: number; sl: number }
}

export type AdaptiveStopsResponse = AdaptiveStopsRefused | AdaptiveStopsMeasured

/**
 * GATE ON `reason`, WHICH IS THE SERVICE'S OWN DISCRIMINATOR.
 *
 * Not on `takeProfit === null` (true on every refusal, but it says nothing about
 * the branches that still measured an ATR) and certainly not on a value: a
 * measured `adx: 0` is a real ranging read and must survive this test.
 */
export function stopsAreMeasured(data: AdaptiveStopsResponse): data is AdaptiveStopsMeasured {
  return data.reason === null
}

/**
 * `timeframe` IS AN ATR PERIOD HERE, NOT A BAR SIZE.
 *
 * `handlers.mjs:5749` passes `{ atrPeriod: timeframe }`, and
 * `computeAdaptiveStops` uses it as `computeAtr(highs, lows, closes, atrPeriod)`.
 * Two consequences the panel has to surface rather than hide:
 *
 *  - The ATR needs `atrPeriod` bars before it produces anything, so a series
 *    shorter than the period yields `atr: null` and an `atr-unobservable`
 *    refusal no matter how healthy the series looks.
 *  - `opts.atrPeriod || 14` means omitting it yields the 14-bar default, so this
 *    is genuinely optional and this client omits the key rather than sending 0.
 *
 * `regime`'s `timeframe` is a LABEL and `expiry`'s `direction` is a direction;
 * all three routes name a field `timeframe` or `direction` differently.
 */
export async function fetchAdaptiveStops(
  candles: WireCandle[],
  direction: StopsDirection,
  timeframe?: number
): Promise<AdaptiveStopsResponse> {
  const payload: { candles: WireCandle[]; direction: StopsDirection; timeframe?: number } =
    timeframe === undefined ? { candles, direction } : { candles, direction, timeframe }
  return post<AdaptiveStopsResponse>("/api/trading/adaptive-stops", payload, "adaptive-stops")
}