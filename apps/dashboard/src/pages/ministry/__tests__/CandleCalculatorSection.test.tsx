// @vitest-environment jsdom
// UI-3 — CandleCalculatorSection: the three panels for the routes that compute
// FROM a candle series rather than about a symbol.
//
// THE CONTRACT UNDER TEST IS THE HONESTY RULE, IN FOUR PARTS:
//
//   1. NOTHING FETCHES ON MOUNT. These three routes are the ones that fetch
//      NOTHING server-side (`handlers.mjs:5703`, `:5711`, `:5740` all read the
//      series out of the request body), so the panel has to supply it — which is
//      exactly why mounting must not start doing so automatically.
//   2. THE ORIGIN IS PART OF THE READOUT. Every number printed was computed over
//      a specific series from a specific source at a specific resolution, and
//      the BARS SENT can differ from the bars requested, because `fetchCandles`
//      filters unusable bars. Both numbers are shown, plus the drop count.
//   3. THE SERVICE-LEVEL REFUSALS RENDER AS REFUSALS. `detectRegime` under 30
//      bars answers `200 ok:true` with `regime: "unknown"` and a LITERAL
//      `confidence: 0` — the `riskParity.mjs:154` defect in a second service.
//      No `metrics` key exists on that branch and no confidence is printed.
//   4. THE TWO ZEROS NAMED `confidence` ARE NOT THE SAME FACT.
//      `regimeDetection.mjs:39` writes a literal 0 for an abstention;
//      `regimeEngine.mjs` writes a REAL 0 for a measured "directionless RANGING".
//      The panel gates on the regime LABEL, so the second survives.
//
// `act()` IS NOT USED ANYWHERE IN THIS FILE — this harness is not configured for
// it, so it is a no-op that lets assertions run before React commits. Async loads
// settle on the repo's SHARED `waitForText` (`src/test-utils/waitForText.ts`),
// already imported by six sibling suites. No local copy, no `react-dom/test-utils`.
//
// EVERY MARKER BELOW IS FALSE AT MOUNT and was checked against the section's
// static copy: `waitForText` searches the whole container, which holds all three
// panels at once, so a marker borrowed from always-rendered text would settle the
// wait before anything committed.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { waitForText } from "@/test-utils/waitForText"
import { CandleCalculatorSection, MeasuredAt, REGIME_TIMEFRAMES } from "../CandleCalculatorSection"
import { fetchCandles, TIMEFRAME_LABELS } from "@/hooks/useCandleData"
import type { Timeframe } from "@/hooks/useCandleData"
import * as calculators from "@/lib/candleCalculators"
import type {
  AdaptiveStopsResponse,
  ExpiryResponse,
  RegimeResponse
} from "@/lib/candleCalculators"
import type { CandleDatum } from "@/components/CandlestickChart"

// THE SERVICE'S OWN LABEL LOOKUP, NOT A RESTATEMENT OF IT. `tfSecondsOf` decides
// which bias plane the regime route actually runs, so the panel's timeframe list is
// proven against the service's rules rather than against a second copy of the same
// assumption.
//
// The service is plain ESM with no declaration file and no test-side import is
// available (this suite is frontend-only and the server is not to be touched), so
// the two lines that matter are transcribed below and then CHECKED AGAINST THE
// SERVICE'S OWN SOURCE. That is stronger than an import would be: if the map or
// the normalisation ever changes, this file goes red until the transcription is
// updated, instead of quietly disagreeing with a rule nobody re-reads.
// Resolved by walking up from wherever vitest was started. That differs between
// `npm test` (a workspace script, so the cwd IS `apps/dashboard`) and a targeted
// `vitest run --root apps/dashboard` from the repo root, so both shapes are tried at
// each hop. A failure to find it throws with the search path, which is louder than
// the assertion it would otherwise cause.
function findServiceSource(): string {
  let dir = process.cwd()
  for (let hop = 0; hop < 6; hop += 1) {
    for (const candidate of [
      resolve(dir, "server/services/regimeDetection.mjs"),
      resolve(dir, "apps/dashboard/server/services/regimeDetection.mjs")
    ]) {
      if (existsSync(candidate)) return candidate
    }
    dir = resolve(dir, "..")
  }
  throw new Error(`regimeDetection.mjs not found above ${process.cwd()}`)
}

const REGIME_DETECTION_SOURCE = findServiceSource()

/** `regimeDetection.mjs:18-28`, transcribed entry for entry. */
const TF_LABELS: Record<string, number> = {
  m1: 60, "1m": 60, "1min": 60,
  m5: 300, "5m": 300, "5min": 300,
  m15: 900, "15m": 900,
  m30: 1800, "30m": 1800,
  h1: 3600, "1h": 3600, "1hr": 3600,
  h4: 14400, "4h": 14400,
  d1: 86400, "1d": 86400, "1day": 86400,
  w1: 604800, "1w": 604800,
  mn: 2592000, "1mo": 2592000, "1month": 2592000
}

/** `tfSecondsOf` (`regimeDetection.mjs:31-35`), transcribed: null when unrecognised. */
function tfSecondsOf(timeframe: string): number | null {
  const key = timeframe.toLowerCase().replace(/[^a-z0-9]/g, "")
  return TF_LABELS[key] ?? null
}

// The candle source is mocked; the TIMEFRAME VOCABULARY is not, because the
// panel genuinely reads it and a fake would prove nothing about the real labels.
vi.mock("@/hooks/useCandleData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCandleData")>()),
  fetchCandles: vi.fn()
}))

// The three network clients are mocked; the DISCRIMINATORS are not, because a
// component that gates on something other than the service's own branch label is
// the defect under test and a fake would hide it.
vi.mock("@/lib/candleCalculators", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/candleCalculators")>()),
  fetchRegime: vi.fn(),
  fetchExpiry: vi.fn(),
  fetchAdaptiveStops: vi.fn()
}))

const candlesMock = vi.mocked(fetchCandles)
const regimeMock = vi.mocked(calculators.fetchRegime)
const expiryMock = vi.mocked(calculators.fetchExpiry)
const stopsMock = vi.mocked(calculators.fetchAdaptiveStops)

// ---------------------------------------------------------------------
// Fixtures — each one is a shape the SERVER actually serves.
// ---------------------------------------------------------------------

/**
 * A well-formed served series, as `fetchCandles` hands it over.
 *
 * `time` is cast to `CandleDatum["time"]` because that type is
 * `lightweight-charts.Time` — a UNION that admits a string, not a plain number.
 * The cast here is exactly why the panel needs `toWireCandles`: the compiler
 * itself says a chart bar's `time` is not necessarily a number, and
 * `expiryOptimizer.mjs:33` subtracts it.
 */
function servedRows(count = 120): CandleDatum[] {
  return Array.from({ length: count }, (_, i) => ({
    time: (1_700_000_000 + i * 60) as CandleDatum["time"],
    open: 1 + i * 0.001,
    high: 1.05 + i * 0.001,
    low: 0.95 + i * 0.001,
    close: 1 + i * 0.0015
  }))
}

/**
 * `detectRegime` on a trending series, with the label RESOLVED: the adapter now
 * records which bar length it acted on, so a resolved label is visible rather
 * than inferred from `latency.planes`.
 */
const regimeTrending: RegimeResponse = {
  ok: true,
  regime: "trending",
  confidence: 72,
  factors: ["ADX 31.4 > 25"],
  suggestedStrategy: "momentum",
  metrics: { adx: 31.4, atrRatio: 1.21, timeframe: "1m" },
  timeframeResolution: { label: "1m", seconds: 60, biasApplied: true, reason: null },
  regimeEngine: {
    regime: "TRENDING",
    volatile: false,
    confidence: 75,
    confidenceKind: "measured",
    factors: ["plane 60 adx: trending (31.4)"],
    perPlane: { "60": { bars: 120, abstain: false, votes: {}, observed: 4 } },
    latency: { planes: [60], minBars: 120 },
    source: "regimeEngine",
    legacy: "trending"
  }
}

/**
 * Under 30 bars. `confidence: 0` is an abstention, not a score —
 * `confidenceKind` says so — and `suggestedStrategy`/`metrics` are ABSENT keys,
 * which is the whole hazard. The LABEL resolved fine here; it is the bars that
 * were short, and the two reasons must not be conflated.
 */
const regimeUnknown: RegimeResponse = {
  ok: true,
  regime: "unknown",
  confidence: 0,
  factors: [],
  timeframeResolution: { label: "1m", seconds: 60, biasApplied: true, reason: null },
  regimeEngine: {
    regime: "unknown",
    confidence: 0,
    confidenceKind: "abstained",
    factors: ["insufficient bars (< MIN_BARS 30)"],
    perPlane: {},
    volatile: false,
    latency: { planes: [], minBars: 0 },
    source: "regimeEngine",
    reason: "insufficient bars"
  }
}

/**
 * THE MEASURED-ZERO CONTROL. `regimeEngine.mjs` ends its classifier with
 *
 *     } else {
 *       regime = "RANGING" // directionless observed market
 *       confidence = 0
 *       legacy = "ranging"
 *     }
 *
 * so a genuinely OBSERVED read can serve `confidence: 0` — the same field name
 * and the same value as the abstention above, meaning the opposite thing. A panel
 * gated on the number would print this as an abstention.
 */
const regimeEngineMeasuredZero: RegimeResponse = {
  ...regimeTrending,
  regime: "ranging",
  confidence: 70,
  factors: ["ADX 11.2 < 20, ATR low"],
  suggestedStrategy: "mean-reversion",
  metrics: { adx: 11.2, atrRatio: 0.7, timeframe: "1m" },
  regimeEngine: {
    ...regimeTrending.regimeEngine,
    regime: "RANGING",
    confidence: 0,
    factors: ["plane 60 adx: range (11.2)", "plane 60 choppiness: range"],
    legacy: "ranging"
  }
}

/**
 * THE TWO CLASSIFIERS DISAGREEING. `detectRegime`'s legacy read says ranging;
 * its own `regimeEngine` consensus says TRENDING. Real, and the panel must show
 * both rather than silently prefer one.
 */
const regimeDivergent: RegimeResponse = {
  ...regimeTrending,
  regime: "ranging",
  confidence: 70,
  factors: ["ADX 11.2 < 20, ATR low"],
  suggestedStrategy: "mean-reversion",
  metrics: { adx: 11.2, atrRatio: 0.7, timeframe: "1m" },
  regimeEngine: { ...regimeTrending.regimeEngine, regime: "TRENDING", legacy: "trending" }
}

/**
 * `regimeDetection.mjs:70-75` REACHES `ranging` WITH NO FACTORS PUSHED.
 *
 * `regime` and `confidence` are seeded before the four `if`s, so a series whose
 * ADX lands in [20, 25], whose ATR ratio lands in [0.8, 1.5] and whose close is
 * inside the Bollinger bands matches none of them and returns
 * `regime: "ranging", factors: []` — a MEASURED branch with nothing to show. The
 * panel must say the service named none rather than rendering an empty list.
 */
const regimeNoFactors: RegimeResponse = {
  ...regimeTrending,
  regime: "ranging",
  confidence: 50,
  factors: [],
  suggestedStrategy: "mean-reversion",
  metrics: { adx: 22.5, atrRatio: 1.1, timeframe: "1m" },
  regimeEngine: { ...regimeTrending.regimeEngine, factors: [], volatile: false }
}

/**
 * THE ENGINE'S OWN FLAGS, WHICH EVERY OTHER FIXTURE LEFT AT THEIR DEFAULTS.
 *
 * `volatile` is what the engine says about its own consensus, and
 * `latency.planes` is the list of bias planes it actually ran — the second number
 * on the panel, printed right beside the "read at timeframe" label the legacy
 * classifier echoes. Both were rendered and asserted by nobody.
 */
const regimeEngineVolatile: RegimeResponse = {
  ...regimeTrending,
  regimeEngine: {
    ...regimeTrending.regimeEngine,
    volatile: true,
    latency: { planes: [60, 300], minBars: 90 }
  }
}

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  candlesMock.mockReset()
  regimeMock.mockReset()
  expiryMock.mockReset()
  stopsMock.mockReset()
  // The source honours the requested count, as a real one does — so a test that
  // asks for 200 bars and sees 200 sent is proving the round trip, while the
  // "counted the bars the client DROPPED" test below deliberately does not.
  //
  // THE VERIFICATION FIGURES ARE ZERO HERE BECAUSE THAT IS WHAT THE PANEL GETS.
  // It calls `fetchCandles` with `verify` left at its default `false`, so the
  // server takes the plain fan-in and reports no cross-verification at all. A
  // default fixture claiming two agreeing sources described a world these panels
  // cannot reach, and every test built on it inherited that.
  candlesMock.mockImplementation(async (_asset, _tf, count) => ({
    rows: servedRows(count),
    source: "yahoo-finance",
    feed: "studio",
    resolvedTimeframe: 60,
    resolved: false,
    availableSources: [],
    verifySources: 0,
    verifiedCount: 0,
    verifiedRatio: 0,
    stale: false,
    sourceMode: "auto",
    sources: []
  }))
  regimeMock.mockResolvedValue(regimeTrending)
  expiryMock.mockResolvedValue({
    ok: true,
    recommended: { label: "5m", seconds: 300, score: 80, expectedMove: 0.012 },
    recommendation: {
      state: "recommended",
      reason: null,
      requiredCandles: 20,
      suppliedCandles: 60
    },
    all: [{ label: "5m", seconds: 300, score: 80, expectedMove: 0.012 }],
    volatility: 0.0021,
    avgMove: 0.0019
  })
  stopsMock.mockResolvedValue({
    ok: true,
    takeProfit: 1.09,
    stopLoss: 1.04,
    atr: 0.02,
    adx: 31.4,
    atrRatio: 1.21,
    regime: "trending",
    reason: null,
    multipliers: { tp: 2.5, sl: 1.2 }
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  flushSync(() => root.unmount())
  container.remove()
})

const settle = (marker: string) => waitForText({ host: container }, marker)

/**
 * Every wait site, and the ASCII marker each settles on. Each was checked
 * against the section's static copy for falsehood at mount.
 */
const MARKERS = {
  "cc-regime-result": "regimeEngine:",
  "cc-regime-reading": "suggested",
  "cc-regime-metrics": "atr ratio",
  "cc-regime-factors": "factors:",
  "cc-regime-engine": "engine factors:",
  "cc-regime-engine-factors": "engine factors:",
  "cc-regime-refused": "NOT MEASURED",
  "cc-regime-refused-reason": "NOT MEASURED",
  "cc-regime-refused-count": "needs 30 before",
  "cc-regime-origin": "requested bar(s) sent",
  "cc-regime-measured-at": "fetched",
  "cc-regime-error": "regime unavailable",
  // Expiry. "sent regime" and "recommended expiry" are false at mount; the
  // section note mentions "candle series" and nothing else here collides.
  "cc-expiry-origin": "requested bar(s) sent",
  "cc-expiry-measured-at": "fetched",
  "cc-expiry-inputs": "sent regime",
  "cc-expiry-recommended": "recommended expiry",
  "cc-expiry-vol": "average move",
  "cc-expiry-score-5m": "score ",
  "cc-expiry-score-15m": "score ",
  "cc-expiry-unscored": "NOT SCORED",
  "cc-expiry-error": "expiry unavailable",
  // Adaptive stops. "ATR period" is FALSE at mount on purpose: the panel's static
  // copy says "smoothing window", so the exact phrase belongs only to the
  // post-run readout and the wait cannot settle before a run commits.
  "cc-stops-origin": "requested bar(s) sent",
  "cc-stops-measured-at": "fetched",
  "cc-stops-atrperiod": "ATR period",
  "cc-stops-measured": "take profit",
  "cc-stops-atr": "atr ",
  "cc-stops-adx": "adx ",
  "cc-stops-multipliers": "x ATR",
  "cc-stops-refused": "NO STOPS",
  "cc-stops-error": "adaptive stops unavailable",
  // The run button's own busy label. False at mount on all three panels, so it
  // settles exactly when a click has been accepted and the answer has not arrived
  // — the only marker that can hold a run open mid-flight.
  "cc-stops-busy": "computing…"
} as const

const settleOn = (testId: keyof typeof MARKERS) => settle(MARKERS[testId])

const render = (element: React.ReactElement = <CandleCalculatorSection />) => {
  flushSync(() => root.render(element))
}

const id = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)
const ids = (testId: string) => Array.from(container.querySelectorAll(`[data-testid="${testId}"]`))
const text = (testId: string) => id(testId)?.textContent ?? ""

function click(testId: string) {
  const btn = id(testId)
  if (!btn) throw new Error(`${testId} not found`)
  flushSync(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
}

/** The inputs are uncontrolled, so the value is simply set before the click. */
function type(testId: string, value: string) {
  const input = id(testId)
  if (!input) throw new Error(`${testId} not found`)
  ;(input as HTMLInputElement).value = value
}

function setSelect(testId: string, value: string) {
  const el = id(testId)
  if (!el) throw new Error(`${testId} not found`)
  ;(el as HTMLSelectElement).value = value
}

/** The `value` of every option in a select, in DOM order. Throws if it is absent. */
function optionsOf(testId: string): (string | null)[] {
  const el = id(testId)
  if (!el) throw new Error(`${testId} not found`)
  return Array.from(el.querySelectorAll("option")).map((o) => o.getAttribute("value"))
}

// ---------------------------------------------------------------------
// Opt-in — nothing fetches on mount
// ---------------------------------------------------------------------

describe("CandleCalculatorSection — opt-in", () => {
  it("DOES NOT read candles or call a calculator on mount", () => {
    render()
    expect(candlesMock).not.toHaveBeenCalled()
    expect(regimeMock).not.toHaveBeenCalled()
    expect(expiryMock).not.toHaveBeenCalled()
    expect(stopsMock).not.toHaveBeenCalled()
    expect(id("cc-regime-idle")).not.toBeNull()
  })

  it("mounting the section opens no candle request for the OTHER two panels either", async () => {
    render()
    // One panel is run to prove the shared candle source is reachable, and the
    // other two must still be untouched — a shared-source refactor that fired
    // eagerly would break this.
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-result")
    expect(candlesMock).toHaveBeenCalledTimes(1)
    expect(expiryMock).not.toHaveBeenCalled()
    expect(stopsMock).not.toHaveBeenCalled()
  })

  it("refuses a BLANK asset by name, sending neither the candles nor the calculator call", () => {
    render()
    click("cc-regime-run")
    flushSync(() => {})
    expect(candlesMock).not.toHaveBeenCalled()
    expect(regimeMock).not.toHaveBeenCalled()
    expect(text("cc-regime-error")).toContain("asset is blank")
    // The idle line is REPLACED rather than sitting beside the refusal: "not yet
    // detected" and a named refusal together claim two different things about the
    // same panel state.
    expect(id("cc-regime-idle")).toBeNull()
  })

  it("refuses an EMPTY served series by name, naming the asset and the range", async () => {
    // `fetchCandles` filters unusable bars (`:169`), so a symbol that resolved but
    // held nothing arrives as an empty array. Sending it would let `detectRegime`
    // answer `regime: "unknown"` — indistinguishable from a genuinely short series.
    candlesMock.mockResolvedValue({
      rows: [],
      source: "yahoo-finance",
      feed: null,
      resolvedTimeframe: 60,
      resolved: false,
      availableSources: [],
      verifySources: 0,
      verifiedCount: 0,
      verifiedRatio: 0,
      stale: false,
      sourceMode: "auto",
      sources: []
    })
    render()
    type("cc-regime-asset", "NOSUCH")
    click("cc-regime-run")
    await settleOn("cc-regime-error")
    const err = text("cc-regime-error")
    expect(err).toContain("0 usable bars")
    expect(err).toContain("NOSUCH")
    expect(regimeMock).not.toHaveBeenCalled()
    expect(id("cc-regime-result")).toBeNull()
  })
})

// ---------------------------------------------------------------------
// Regime — the origin and the two confidence zeros
// ---------------------------------------------------------------------

describe("CandleCalculatorSection — regime", () => {
  it("reads the dashboard's candle source, then sends the series and the LABEL to the route", async () => {
    render()
    type("cc-regime-asset", "EURUSD")
    setSelect("cc-regime-tf", "300")
    type("cc-regime-bars", "200")
    click("cc-regime-run")
    await settleOn("cc-regime-result")

    // THE ONE CANDLE SOURCE. Asset, bar size in SECONDS and count, exactly as
    // `fetchCandles` is declared (`useCandleData.ts:153`).
    expect(candlesMock).toHaveBeenCalledWith("EURUSD", 300, 200)
    // And the route gets the LABEL, because `tfSecondsOf` (`regimeDetection.mjs:31`)
    // only understands strings and silently falls back to a 60s bias plane on
    // anything else.
    expect(regimeMock).toHaveBeenCalledTimes(1)
    const [sent, label] = regimeMock.mock.calls[0]
    expect(label).toBe("5m")
    expect(sent).toHaveLength(200)
    expect(sent[0]).toMatchObject({ time: 1_700_000_000, close: expect.any(Number) })
  })

  it("STATES THE SERIES ORIGIN — asset, range, bars actually sent, source, resolution", async () => {
    render()
    type("cc-regime-asset", "EURUSD")
    setSelect("cc-regime-tf", "60")
    type("cc-regime-bars", "120")
    click("cc-regime-run")
    await settleOn("cc-regime-origin")

    const origin = text("cc-regime-origin")
    expect(origin).toContain("EURUSD")
    expect(origin).toContain("1m")
    expect(origin).toContain("120 of 120 requested bar(s) sent")
    expect(origin).toContain("served by yahoo-finance")
    expect(origin).toContain("served at 60s")
    expect(origin).toContain("not flagged stale")
    expect(origin).toContain("source selection auto")
    // The cross-verification clause reads as what it is: this run did not ask.
    expect(origin).toContain("not cross-verified — this run did not ask a second source")
  })

  it("counts the bars the client DROPPED, rather than reporting only the request", async () => {
    // THE POINT OF PRINTING BOTH COUNTS. `fetchCandles` returns what it served,
    // and `toWireCandles` drops anything non-finite on top of that. A panel that
    // printed only the request would describe a series the server never saw.
    candlesMock.mockResolvedValue({
      rows: [
        ...servedRows(118),
        { time: "bad-time" as unknown as CandleDatum["time"], open: 1, high: 1, low: 1, close: 1 }
      ],
      source: "yahoo-finance",
      feed: null,
      resolvedTimeframe: 60,
      resolved: false,
      availableSources: [],
      verifySources: 0,
      verifiedCount: 0,
      verifiedRatio: 0,
      stale: false,
      sourceMode: "auto",
      sources: []
    })
    render()
    type("cc-regime-asset", "EURUSD")
    type("cc-regime-bars", "119")
    click("cc-regime-run")
    await settleOn("cc-regime-origin")
    expect(text("cc-regime-origin")).toContain("118 of 119 requested bar(s) sent")
    expect(text("cc-regime-origin")).toContain("1 unusable bar(s) dropped")
    // And the SENT series carries the drop, not the request.
    expect(regimeMock.mock.calls[0][0]).toHaveLength(118)
  })

  it("names a resolution the SERVER chose over the requested one", async () => {
    candlesMock.mockResolvedValue({
      rows: servedRows(),
      source: "yahoo-daily",
      feed: null,
      resolvedTimeframe: 86400,
      resolved: true,
      availableSources: [],
      verifySources: 1,
      verifiedCount: 30,
      verifiedRatio: 0.25,
      stale: true,
      sourceMode: "fallback",
      sources: []
    })
    render()
    type("cc-regime-asset", "EURUSD")
    type("cc-regime-bars", "120")
    click("cc-regime-run")
    await settleOn("cc-regime-origin")
    const origin = text("cc-regime-origin")
    // The request was 60s; the server served daily bars. Reading only its own
    // request would describe a resolution nobody computed over.
    expect(origin).toContain("served at 86400s")
    expect(origin).toContain("NOT the resolution asked for")
    // And a stale series is flagged rather than presented as current.
    expect(origin).toContain("STALE")
  })

  it("renders the measured read with its metrics and factors", async () => {
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-reading")
    expect(text("cc-regime-reading")).toContain("trending")
    expect(text("cc-regime-reading")).toContain("confidence 72")
    expect(text("cc-regime-reading")).toContain("momentum")
    expect(text("cc-regime-metrics")).toContain("adx 31.4")
    expect(text("cc-regime-metrics")).toContain("atr ratio 1.21x")
    expect(text("cc-regime-metrics")).toContain("timeframe 1m")
    expect(text("cc-regime-factors")).toContain("ADX 31.4 > 25")
  })

  it("renders the UNDER-30-BARS branch as a refusal naming the engine's reason", async () => {
    regimeMock.mockResolvedValue(regimeUnknown)
    render()
    type("cc-regime-asset", "EURUSD")
    type("cc-regime-bars", "12")
    click("cc-regime-run")
    await settleOn("cc-regime-refused")
    expect(text("cc-regime-refused")).toContain("NOT MEASURED")
    expect(text("cc-regime-refused")).toContain("insufficient bars")
    expect(text("cc-regime-refused-count")).toContain("12 bar(s) were sent")
    expect(text("cc-regime-refused-count")).toContain("needs 30")
  })

  it("does NOT print the unknown branch's literal `confidence: 0` as a measurement", async () => {
    // THE HAZARD, verbatim: `regimeDetection.mjs:39` returns `confidence: 0` as a
    // literal standing above every computation, and `handlers.mjs:5704` spreads
    // it after `ok: true` so it arrives on a 200. Printed as a measurement it says
    // the classifier is certain — of nothing.
    regimeMock.mockResolvedValue(regimeUnknown)
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-refused")
    // No legacy reading line at all, because `regime`, `confidence` and
    // `suggestedStrategy` are only ever printed on the measured branch.
    expect(id("cc-regime-reading")).toBeNull()
    expect(id("cc-regime-metrics")).toBeNull()
    // And the engine block, which DID run, says it abstained.
    expect(text("cc-regime-engine")).toContain("unknown")
    expect(text("cc-regime-engine")).toContain("ABSTAINED")
    expect(text("cc-regime-engine")).toContain("not a measurement")
  })

  it("renders a MEASURED engine confidence of 0 as a measurement — the control", async () => {
    // THE OPPOSITE SENSE OF THE SAME VALUE. `regimeEngine.mjs` can serve
    // `regime: "RANGING", confidence: 0` for a genuinely observed directionless
    // market. A panel gated on the NUMBER would print "ABSTAINED" here, which is
    // the mirror-image defect of the test above.
    regimeMock.mockResolvedValue(regimeEngineMeasuredZero)
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-engine")
    const engine = text("cc-regime-engine")
    expect(engine).toContain("RANGING")
    expect(engine).toContain("confidence 0")
    expect(engine).toContain("measured consensus")
    expect(engine).not.toContain("ABSTAINED")
    // And the legacy classifier's own reading is still shown — a real one.
    expect(text("cc-regime-reading")).toContain("ranging")
    expect(text("cc-regime-reading")).toContain("confidence 70")
  })

  it("shows BOTH classifiers when they disagree, rather than collapsing to one", async () => {
    regimeMock.mockResolvedValue(regimeDivergent)
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-engine")
    // The legacy consensus says ranging; the engine consensus says TRENDING. Both
    // are on screen because they are different classifiers over the same bars, and
    // picking one silently would hide a real disagreement.
    expect(text("cc-regime-reading")).toContain("ranging")
    expect(text("cc-regime-engine")).toContain("TRENDING")
    expect(text("cc-regime-metrics")).toContain("adx 11.2")
  })

  it("surfaces a transport refusal carrying the reason, and renders no readout", async () => {
    regimeMock.mockRejectedValue(new Error("regime failed: 401"))
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-error")
    expect(text("cc-regime-error")).toContain("401")
    expect(id("cc-regime-result")).toBeNull()
    expect(id("cc-regime-origin")).toBeNull()
  })

  it("a refusal CLEARS the previous readout rather than sitting beside it", async () => {
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-result")

    candlesMock.mockRejectedValue(new Error("candles request failed (500)"))
    click("cc-regime-run")
    await settleOn("cc-regime-error")
    // The second question was refused, so the first question's answer must not
    // stand under the new label.
    expect(id("cc-regime-result")).toBeNull()
    expect(id("cc-regime-origin")).toBeNull()
    expect(id("cc-regime-measured-at")).toBeNull()
  })

  it("offers ONLY timeframes the regime route can resolve, and names the limit in its copy", () => {
    // THE OPTION LIST IS A CLAIM ABOUT THE ROUTE, so it is asserted as one. The
    // full `TIMEFRAME_LABELS` set is 12 wide; four of those labels cannot survive
    // `tfSecondsOf` (see the next test for the proof), and offering them would put
    // "read at timeframe 1M" beside "plane(s) at 60s" on one panel.
    render()
    const offered = optionsOf("cc-regime-tf")
    expect(offered.map(Number)).toEqual([...REGIME_TIMEFRAMES])
    // "1M" is 2592000 seconds and is NOT among them, which is the whole point.
    expect(offered).not.toContain("2592000")
    // And the limit is disclosed on the panel rather than silently imposed.
    expect(text("cc-regime")).toContain(
      "Only timeframes the regime route can resolve are offered"
    )
  })

  it("every regime label it offers resolves to ITS OWN seconds in the service's own lookup", () => {
    render()
    const offered = optionsOf("cc-regime-tf").map(Number)
    for (const seconds of offered) {
      expect(tfSecondsOf(TIMEFRAME_LABELS[seconds as Timeframe])).toBe(seconds)
    }
    const unresolvable = Object.entries(TIMEFRAME_LABELS)
      .map(([s, label]) => ({ seconds: Number(s), label }))
      .filter(({ seconds, label }) => tfSecondsOf(label) !== seconds)
      .map(({ seconds }) => seconds)
      .sort((a, b) => a - b)
    // Named rather than inferred, so a change in the service's map is visible.
    expect(unresolvable).toEqual([5, 15, 30, 2592000])
    expect(offered.filter((s) => unresolvable.includes(s))).toEqual([])
    // The worst of the four, spelled out: "1M" is not merely unrecognised, it
    // resolves to 60 and would classify a MONTHLY series on the 1-minute plane.
    expect(tfSecondsOf(TIMEFRAME_LABELS[2592000])).toBe(60)
  })

  it("the transcription of the service's label rules still matches the service", () => {
    // THE GUARD ON EVERY ASSERTION ABOVE. The two rules this suite leans on — the
    // map and the normalisation — are transcribed, and a transcription with no
    // check is a second assumption rather than a proof. Both are read back out of
    // `regimeDetection.mjs` here, so editing the service turns this red rather than
    // leaving the panel quietly offering a label the route no longer honours.
    const source = readFileSync(REGIME_DETECTION_SOURCE, "utf8")

    // 1. The map, entry for entry and in order.
    const start = source.indexOf("const TF_LABELS")
    const table = source.slice(start, source.indexOf("])", start))
    const fromService = Array.from(table.matchAll(/\["([^"]+)",\s*(\d+)\]/g)).map(
      (m) => `${m[1]}:${m[2]}`
    )
    expect(fromService).toEqual(Object.entries(TF_LABELS).map(([k, v]) => `${k}:${v}`))
    expect(fromService.length).toBeGreaterThan(0)

    // 2. The normalisation that makes "1M" and "1m" the same key.
    expect(source).toContain('String(timeframe).toLowerCase().replace(/[^a-z0-9]/g, "")')

    // 3. And the reason the panel cares at all: an unresolved label does not fail,
    //    it silently becomes the 60s plane.
    expect(source).toContain("[tf ?? 60]: candles")
  })

  it("the stops panel keeps the FULL timeframe list, because it reads the choice as a NUMBER", () => {
    // The restriction is regime-only and must stay that way: `handlers.mjs:5748`
    // passes these seconds as `{ atrPeriod }`, where a 5-bar window and a monthly
    // window are both perfectly meaningful. A shared filter would have removed
    // capability the route actually has.
    render()
    const offered = optionsOf("cc-stops-tf")
    expect(offered).toHaveLength(Object.keys(TIMEFRAME_LABELS).length)
    expect(offered).toContain("5")
    expect(offered).toContain("2592000")
  })

  it("names the FEED the source reported, beside the source that served it", async () => {
    // `source` is which broker won the fan-in and `feed` is which leg it came from
    // (`handlers.mjs:4643`). The default fixture serves `feed: "studio"`, so the
    // "via " clause is the only place that tag reaches an operator — and it was
    // carried in state and asserted by nobody.
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-origin")
    expect(text("cc-regime-origin")).toContain("served by yahoo-finance via studio")
  })

  it("omits the feed clause entirely when the source reported none", async () => {
    // The mirror: a clause that renders with a dangling "via " and nothing after it
    // reads as a truncated line rather than an absent tag.
    candlesMock.mockResolvedValue({
      rows: servedRows(),
      source: "yahoo-finance",
      feed: null,
      resolvedTimeframe: 60,
      resolved: false,
      availableSources: [],
      verifySources: 0,
      verifiedCount: 0,
      verifiedRatio: 0,
      stale: false,
      sourceMode: "auto",
      sources: []
    })
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-origin")
    expect(text("cc-regime-origin")).toContain("served by yahoo-finance · served at 60s")
    expect(text("cc-regime-origin")).not.toContain(" via ")
  })

  it("does NOT print a cross-verification figure it never asked for", async () => {
    // THESE PANELS CALL `fetchCandles` WITH `verify` LEFT AT ITS DEFAULT `false`, so
    // the server takes the plain fan-in and reports zero. Printed unconditionally,
    // `0/120 bar(s) cross-verified across 0 source(s)` is a verdict on the SOURCE
    // ("nothing agreed") when it is a verdict on US ("nobody was asked"), and it
    // sits in the provenance line every other number on these panels trusts. The
    // default fixture above is the production shape: no verification was requested.
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-origin")
    const origin = text("cc-regime-origin")
    expect(origin).toContain("did not ask a second source")
    expect(origin).not.toMatch(/\d+\/\d+ bar\(s\) cross-verified/)
    // And the panel really is not opting in behind the reader's back:
    // `toHaveBeenCalledWith` matches the FULL argument list, so a fourth `verify`
    // argument would already fail this line.
    expect(candlesMock).toHaveBeenCalledWith("EURUSD", 60, 120)
  })

  it("reports cross-verification and source mode when the source DOES report them", async () => {
    // The control for the test above: both figures are real provenance and must
    // still render, and `sourceMode` is the field that explains WHY a different
    // source answered than the operator's preference asked for.
    candlesMock.mockResolvedValue({
      rows: servedRows(),
      source: "yahoo-daily",
      feed: null,
      resolvedTimeframe: 60,
      resolved: false,
      availableSources: [],
      verifySources: 3,
      verifiedCount: 96,
      verifiedRatio: 0.8,
      stale: false,
      sourceMode: "fallback",
      sources: []
    })
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-origin")
    const origin = text("cc-regime-origin")
    expect(origin).toContain("96/120 bar(s) cross-verified across 3 source(s)")
    expect(origin).toContain("source selection fallback")
    expect(origin).toContain("a different one did")
  })

  it("prints the engine's volatile flag and the planes it ACTUALLY ran", async () => {
    // `latency.planes` is the engine's own report of which bias planes it used, and
    // it is the number that would contradict "read at timeframe" if the label could
    // not be resolved. It was rendered and asserted by nobody.
    regimeMock.mockResolvedValue(regimeEngineVolatile)
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-engine")
    expect(text("cc-regime-engine")).toContain("flagged volatile")
    expect(text("cc-regime-engine")).toContain("plane(s) at 60, 300s")
  })

  it("says the service named no factors, on either classifier, instead of printing an empty list", async () => {
    // BOTH EMPTY-FACTOR FALLBACKS. `regimeDetection.mjs:70-75` can return
    // `ranging` with `factors: []` — the seeds at `:70-71` are never overwritten when
    // none of the four `if`s match — and `factors:` followed by nothing reads as a
    // rendering fault rather than as "the classifier said nothing".
    regimeMock.mockResolvedValue(regimeNoFactors)
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-factors")
    expect(text("cc-regime-factors")).toContain("the service named none")
    expect(text("cc-regime-engine-factors")).toContain("the engine named none")
    // And the reading itself survives: no factors is not a refusal.
    expect(id("cc-regime-reading")).not.toBeNull()
    expect(id("cc-regime-refused")).toBeNull()
  })

  it("the unflagged, plane-less control — neither clause is printed when absent", async () => {
    // The mirror of the volatile test above: a clause that appears unconditionally is
    // worse than no clause. `regimeUnknown`'s engine abstained with no planes
    // (`regimeDetection.mjs:48`), so the honest rendering omits both.
    regimeMock.mockResolvedValue(regimeUnknown)
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-engine")
    expect(text("cc-regime-engine")).not.toContain("flagged volatile")
    expect(text("cc-regime-engine")).not.toContain("plane(s) at")
  })
})

// ---------------------------------------------------------------------
// Expiry — the constant recommendation, and the inputs it is meaningless without
// ---------------------------------------------------------------------

/**
 * Under 20 bars — the refusal `expiryOptimizer.mjs` now returns.
 *
 * REWRITTEN AGAINST THE FIXED SHAPE. This fixture used to be
 * `expiryOptimizer.mjs:20` verbatim: `recommended` was `EXPIRY_OPTIONS[3]`, the
 * `"1m"` entry of the service's OWN table, handed back under the field name
 * `recommended` after nothing had been computed, with every option carrying a
 * literal `score: 50`. The panel refused to RENDER that constant as a
 * recommendation, so the fixture survived — but the payload still named an
 * expiry, and the payload is what every other caller of this route reads.
 *
 * The service now refuses instead: `recommended` is `null`, every option carries
 * `score: null`, and `recommendation` names the count that arrived and why no
 * expiry could be scored. Nothing here is a constant any more, so this fixture
 * can no longer enshrine a trade instruction.
 */
const expiryUnscored: ExpiryResponse = {
  ok: true,
  recommended: null,
  recommendation: {
    state: "unavailable",
    reason: "insufficient candles (12 < 20); no expiry is scored and none is recommended",
    requiredCandles: 20,
    suppliedCandles: 12
  },
  all: [
    { label: "5s", seconds: 5, score: null },
    { label: "1m", seconds: 60, score: null }
  ]
}

/** The computed branch, sorted by score descending (`expiryOptimizer.mjs:61`). */
const expiryScored: ExpiryResponse = {
  ok: true,
  recommended: { label: "5m", seconds: 300, score: 80, expectedMove: 0.012 },
  recommendation: {
    state: "recommended",
    reason: null,
    requiredCandles: 20,
    suppliedCandles: 60
  },
  all: [
    { label: "5m", seconds: 300, score: 80, expectedMove: 0.012 },
    { label: "15m", seconds: 900, score: 40, expectedMove: 0.0233 }
  ],
  volatility: 0.0021,
  avgMove: 0.0019
}

/**
 * A FLAT series: every return is 0, so `volatility = sqrt(Σr²/n)` is exactly 0
 * (`expiryOptimizer.mjs:25`). That 0 is REAL and must print as `0`.
 */
const expiryMeasuredZero: ExpiryResponse = {
  ok: true,
  recommended: { label: "1m", seconds: 60, score: 45, expectedMove: 0 },
  recommendation: {
    state: "recommended",
    reason: null,
    requiredCandles: 20,
    suppliedCandles: 60
  },
  all: [{ label: "1m", seconds: 60, score: 45, expectedMove: 0 }],
  volatility: 0,
  avgMove: 0
}

describe("CandleCalculatorSection — expiry", () => {
  it("sends an EXPLICIT regime and signal strength, and shows both beside the score", async () => {
    // `optimizeExpiry(candles, regime = "ranging", signalStrength = 0.5)` invents
    // BOTH when absent and the response does not record which it used, so a score
    // whose inputs are invisible is unattributable. The panel therefore always
    // sends both and always displays what it sent.
    render()
    type("cc-expiry-asset", "EURUSD")
    setSelect("cc-expiry-regime", "trending")
    type("cc-expiry-strength", "0.9")
    click("cc-expiry-run")
    await settleOn("cc-expiry-recommended")

    expect(expiryMock).toHaveBeenCalledTimes(1)
    const [sent, regime, strength] = expiryMock.mock.calls[0]
    expect(sent).toHaveLength(120)
    expect(regime).toBe("trending")
    expect(strength).toBe(0.9)

    const inputs = text("cc-expiry-inputs")
    expect(inputs).toContain("regime trending")
    expect(inputs).toContain("signal strength 0.9")
    // And the score those inputs produced is attributed to them.
    expect(text("cc-expiry-recommended")).toContain("5m")
    expect(text("cc-expiry-recommended")).toContain("score 80")
  })

  it("DOES NOT take its regime from the regime panel — the chain is declined", async () => {
    // THE CHAIN-DECISION TEST. `detectRegime` says `trending` above; this panel's
    // own regime input is at its default. If expiry were wired to the other
    // panel, its number on screen would be derived from a regime the reader
    // cannot see from it — which is exactly what the brief forbids.
    render()
    type("cc-regime-asset", "EURUSD")
    click("cc-regime-run")
    await settleOn("cc-regime-result")
    expect(text("cc-regime-reading")).toContain("trending")

    type("cc-expiry-asset", "EURUSD")
    click("cc-expiry-run")
    await settleOn("cc-expiry-recommended")
    // Its OWN input, not the detected one.
    expect(expiryMock).toHaveBeenCalledWith(expect.any(Array), "ranging", 0.5)
    expect(text("cc-expiry-inputs")).toContain("regime ranging")
  })

  it("does NOT present the unscored branch as a recommendation", async () => {
    // THE HAZARD. Under 20 bars the service used to return its own `"1m"` table
    // entry as `recommended` and score every option at a literal 50. Printed as a
    // recommendation it told an operator to take a 1-minute expiry, which is
    // advice derived from a constant. The service now refuses instead, and this
    // panel's job is to render that refusal as a refusal rather than to be the
    // only thing standing between a constant and an operator.
    expiryMock.mockResolvedValue(expiryUnscored)
    render()
    type("cc-expiry-asset", "EURUSD")
    type("cc-expiry-bars", "12")
    click("cc-expiry-run")
    await settleOn("cc-expiry-unscored")

    const line = text("cc-expiry-unscored")
    expect(line).toContain("NOT SCORED")
    // The reason the SERVICE gave is what is printed, so a reader comparing
    // against the payload sees the same sentence the payload carries.
    expect(line).toContain(expiryUnscored.recommendation!.reason!)
    // And the count it was actually given, rather than a bare dash.
    expect(line).toContain("12")
    // No recommendation cell exists at all — the panel cannot print one even if
    // it wanted to, because there is nothing pointed at as recommended.
    expect(text("cc-expiry-recommended")).toBe("")
    expect(id("cc-expiry-recommended")).toBeNull()
    // And no volatility/avgMove as measurements: those keys do not exist here.
    expect(text("cc-expiry-vol")).toBe("")
    // The per-option scores are absent too, so no score table is offered.
    expect(ids("cc-expiry-scores")).toHaveLength(0)
  })

  it("renders the computed recommendation with its scores and volatility", async () => {
    expiryMock.mockResolvedValue(expiryScored)
    render()
    type("cc-expiry-asset", "EURUSD")
    click("cc-expiry-run")
    await settleOn("cc-expiry-recommended")
    expect(text("cc-expiry-recommended")).toContain("recommended expiry 5m")
    expect(text("cc-expiry-recommended")).toContain("score 80")
    expect(text("cc-expiry-vol")).toContain("volatility 0.0021")
    expect(text("cc-expiry-vol")).toContain("average move 0.0019")
    // The option table is scored and carries its expected move.
    expect(ids("cc-expiry-score-5m")).toHaveLength(1)
    expect(text("cc-expiry-score-15m")).toContain("score 40")
    expect(text("cc-expiry-score-15m")).toContain("expected move 0.0233")
    expect(id("cc-expiry-unscored")).toBeNull()
  })

  it("prints a MEASURED volatility of 0 as 0 — the control for the assertion above", async () => {
    expiryMock.mockResolvedValue(expiryMeasuredZero)
    render()
    type("cc-expiry-asset", "EURUSD")
    click("cc-expiry-run")
    await settleOn("cc-expiry-vol")
    const vol = text("cc-expiry-vol")
    expect(vol).toContain("volatility 0")
    expect(vol).toContain("average move 0")
    expect(vol).not.toContain("absent")
    // And it is still treated as the SCORED branch.
    expect(id("cc-expiry-recommended")).not.toBeNull()
    expect(id("cc-expiry-unscored")).toBeNull()
  })

  it("sends a signal strength of 0 rather than omitting it, because 0 is a strength", async () => {
    render()
    type("cc-expiry-asset", "EURUSD")
    type("cc-expiry-strength", "0")
    click("cc-expiry-run")
    await settleOn("cc-expiry-recommended")
    expect(expiryMock).toHaveBeenCalledWith(expect.any(Array), "ranging", 0)
    expect(text("cc-expiry-inputs")).toContain("signal strength 0")
  })

  it("refuses an unparseable signal strength BY NAME rather than sending NaN", () => {
    // `JSON.stringify({signalStrength: NaN})` is `{"signalStrength":null}`, and
    // `optimizeExpiry` would then run its `signalStrength > 0.7` and `> 0.8`
    // branches against null — silently scoring as though no strength applied.
    render()
    type("cc-expiry-asset", "EURUSD")
    type("cc-expiry-strength", "strong")
    click("cc-expiry-run")
    flushSync(() => {})
    expect(candlesMock).not.toHaveBeenCalled()
    expect(expiryMock).not.toHaveBeenCalled()
    const err = text("cc-expiry-error")
    expect(err).toContain("strong")
    expect(err).toContain("not a finite number")
    expect(id("cc-expiry-idle")).toBeNull()
  })

  it("states the series origin and the time, like every other panel", async () => {
    render()
    type("cc-expiry-asset", "EURUSD")
    click("cc-expiry-run")
    await settleOn("cc-expiry-origin")
    expect(text("cc-expiry-origin")).toContain("EURUSD")
    expect(text("cc-expiry-origin")).toContain("120 of 120 requested bar(s) sent")
    expect(text("cc-expiry-measured-at")).toContain("fetched")
  })

  it("a refusal CLEARS the previous readout", async () => {
    render()
    type("cc-expiry-asset", "EURUSD")
    click("cc-expiry-run")
    await settleOn("cc-expiry-recommended")

    expiryMock.mockRejectedValue(new Error("expiry failed: 401"))
    click("cc-expiry-run")
    await settleOn("cc-expiry-error")
    expect(id("cc-expiry-recommended")).toBeNull()
    expect(id("cc-expiry-origin")).toBeNull()
    expect(text("cc-expiry-error")).toContain("401")
  })

  it("refuses BOTH invalid input shapes before sending anything", () => {
    // THE EXPIRY COPY OF THE SHARED INPUT GUARD, WHICH WAS UNASSERTED. `onRun`
    // calls `readInputs` and checks `"error" in inputs` on its own — three copies of
    // that check exist and only the regime one was ever exercised, so a stops- or
    // expiry-panel regression that dropped it would have fired a real request with
    // an empty asset or a zero bar count.
    render()
    type("cc-expiry-asset", "")
    click("cc-expiry-run")
    flushSync(() => {})
    expect(text("cc-expiry-error")).toContain("asset is blank")
    expect(candlesMock).not.toHaveBeenCalled()
    expect(expiryMock).not.toHaveBeenCalled()

    type("cc-expiry-asset", "EURUSD")
    type("cc-expiry-bars", "0")
    click("cc-expiry-run")
    flushSync(() => {})
    expect(text("cc-expiry-error")).toContain('bar count "0" is not a positive number')
    expect(candlesMock).not.toHaveBeenCalled()
    expect(expiryMock).not.toHaveBeenCalled()
    // And a refusal still REPLACES the idle line rather than standing beside it.
    expect(id("cc-expiry-idle")).toBeNull()
  })
})

// ---------------------------------------------------------------------
// MeasuredAt — the clock clause that a test run cannot otherwise reach
// ---------------------------------------------------------------------

describe("CandleCalculatorSection — MeasuredAt", () => {
  it("flags a readout older than fifteen minutes as possibly out of date", () => {
    // `STALE_AFTER_MS` is 15 minutes, so inside a test run `Date.now() - at` is
    // always a few hundred milliseconds and this branch could never commit. The
    // clock is a prop precisely so the real render path can be driven across the
    // boundary — otherwise "may be out of date" was a branch nothing held.
    render(<MeasuredAt at={1_700_000_000_000} now={1_700_000_000_000 + 15 * 60 * 1000 + 1} testId="m" />)
    expect(text("m")).toContain("fetched")
    expect(text("m")).toContain("may be out of date")
  })

  it("says nothing about age one millisecond inside the window — the control", () => {
    render(<MeasuredAt at={1_700_000_000_000} now={1_700_000_000_000 + 15 * 60 * 1000} testId="m" />)
    expect(text("m")).toContain("fetched")
    expect(text("m")).not.toContain("may be out of date")
  })

  it("every panel's stamp carries the clause, and none of them asserts it at mount", async () => {
    render()
    type("cc-stops-asset", "EURUSD")
    click("cc-stops-run")
    await settleOn("cc-stops-measured-at")
    // Just committed, so this one is provably fresh rather than merely assumed to be.
    expect(text("cc-stops-measured-at")).toContain("fetched")
    expect(text("cc-stops-measured-at")).not.toContain("may be out of date")
  })
})

// ---------------------------------------------------------------------
// Adaptive stops — the ATR-period collision, and the branch that measures ATR
// but cannot produce a stop
// ---------------------------------------------------------------------

/** `computeAdaptiveStops` on a trending read (`trading.mjs`). */
const stopsTrending: AdaptiveStopsResponse = {
  ok: true,
  takeProfit: 1.09,
  stopLoss: 1.04,
  atr: 0.02,
  adx: 31.4,
  atrRatio: 1.21,
  regime: "trending",
  reason: null,
  multipliers: { tp: 2.5, sl: 1.2 }
}

/**
 * THE BRANCH THAT BREAKS A NAIVE GATE.
 *
 * `computeAdaptiveStops` returns
 *   `{ takeProfit: null, stopLoss: null, atr: currentAtr, adx: null,
 *      regime: "unknown", atrRatio, reason: "adx-unobservable: ..." }`
 *
 * — a REAL, non-null ATR beside two null stops. A panel asking "did we get an
 * ATR?" or "is the stop distance zero?" would print that ATR beside stops nobody
 * could produce and read the two as one answer.
 */
const stopsAdxUnobservable: AdaptiveStopsResponse = {
  ok: true,
  takeProfit: null,
  stopLoss: null,
  atr: 0.42,
  adx: null,
  atrRatio: 1.1,
  regime: "unknown",
  reason:
    "adx-unobservable: ADX has not warmed up on these candles, so no trend regime is claimed (unobserved never counts as neutral)"
}

/** A MEASURED `adx` of 0 — a real ranging read, which must survive the gate. */
const stopsMeasuredZeroAdx: AdaptiveStopsResponse = {
  ...stopsTrending,
  takeProfit: 1.02,
  stopLoss: 1.01,
  adx: 0,
  atrRatio: 1,
  regime: "ranging",
  multipliers: { tp: 1.8, sl: 1.5 }
}

/**
 * THE THIRD REFUSAL, WHICH HAD NO PANEL-LEVEL TEST AT ALL.
 *
 * `computeAdaptiveStops` (`trading.mjs:328-337`) reaches this branch when `smma`
 * has produced no finite ATR over the window — which happens whenever the window
 * is wider than the series — and returns `atr: null` too, with NO `atrRatio` key
 * at all. That is three absences at once (ATR, ADX, ATR ratio) beside a reason
 * that names none of them individually, so it is the branch where a panel is most
 * likely to print one measurement and let the other two go unsaid.
 */
const stopsAtrUnobservable: AdaptiveStopsResponse = {
  ok: true,
  takeProfit: null,
  stopLoss: null,
  adx: null,
  regime: "unknown",
  atr: null,
  reason: "atr-unobservable: no measurable ATR on these candles; no stops or regime are claimed"
}

describe("CandleCalculatorSection — adaptive stops", () => {
  it("sends the series, the direction and the timeframe NUMBER", async () => {
    // `handlers.mjs:5748` passes `{ atrPeriod: timeframe }`, so this route's
    // `timeframe` is a SMOOTHING WINDOW, not a label and not a bar size. The
    // regime route's `timeframe` is a string; the two share a name and nothing
    // else.
    render()
    type("cc-stops-asset", "EURUSD")
    setSelect("cc-stops-direction", "down")
    setSelect("cc-stops-tf", "900")
    click("cc-stops-run")
    await settleOn("cc-stops-measured")
    expect(stopsMock).toHaveBeenCalledTimes(1)
    const [sent, direction, seconds] = stopsMock.mock.calls[0]
    expect(sent).toHaveLength(120)
    expect(direction).toBe("down")
    expect(seconds).toBe(900)
  })

  it("STATES the smoothing window the server will use, and flags one too long for the series", async () => {
    // THE COLLISION, SURFACED RATHER THAN HIDDEN. The ATR needs `atrPeriod` bars
    // before it produces anything, so a 900-second window over a 120-bar series
    // can only ever answer `atr-unobservable` — no matter how healthy the series
    // looks. The panel says so before it is discovered the expensive way.
    render()
    type("cc-stops-asset", "EURUSD")
    setSelect("cc-stops-tf", "900")
    type("cc-stops-bars", "120")
    click("cc-stops-run")
    await settleOn("cc-stops-atrperiod")
    const line = text("cc-stops-atrperiod")
    expect(line).toContain("900")
    expect(line).toContain("120 bar(s)")
    expect(line).toContain("too short")
  })

  it("does not warn about a window the series can satisfy", async () => {
    render()
    type("cc-stops-asset", "EURUSD")
    setSelect("cc-stops-tf", "60")
    click("cc-stops-run")
    await settleOn("cc-stops-atrperiod")
    expect(text("cc-stops-atrperiod")).not.toContain("too short")
  })

  it("renders the stops with the regime and multipliers that produced them", async () => {
    stopsMock.mockResolvedValue(stopsTrending)
    render()
    type("cc-stops-asset", "EURUSD")
    setSelect("cc-stops-direction", "up")
    click("cc-stops-run")
    await settleOn("cc-stops-measured")
    const line = text("cc-stops-measured")
    expect(line).toContain("take profit 1.09")
    expect(line).toContain("stop loss 1.04")
    expect(line).toContain("trending")
    expect(text("cc-stops-atr")).toContain("atr 0.02")
    expect(text("cc-stops-multipliers")).toContain("take profit 2.5x ATR")
    expect(text("cc-stops-multipliers")).toContain("stop loss 1.2x ATR")
    expect(id("cc-stops-refused")).toBeNull()
  })

  it("renders a DOWN direction as its own levels, not the up ones", async () => {
    stopsMock.mockResolvedValue({
      ...stopsTrending,
      takeProfit: 0.96,
      stopLoss: 1.01
    })
    render()
    type("cc-stops-asset", "EURUSD")
    setSelect("cc-stops-direction", "down")
    click("cc-stops-run")
    await settleOn("cc-stops-measured")
    // For a short, the take profit sits BELOW the stop loss. A panel that ignored
    // the direction would print the up levels and be wrong by construction.
    const line = text("cc-stops-measured")
    expect(line).toContain("take profit 0.96")
    expect(line).toContain("stop loss 1.01")
    expect(line).toContain("direction down")
    expect(stopsMock).toHaveBeenCalledWith(expect.any(Array), "down", 60)
  })

  it("does NOT present stops on the adx-unobservable branch, though it DID measure an ATR", async () => {
    // THE HAZARD. `atr: 0.42` here is real and computed; `takeProfit` and
    // `stopLoss` are null because the service refused to pick multipliers for a
    // trend it could not observe. Rendering the ATR without saying the stops are
    // absent would show a real number where the operator needed a stop.
    stopsMock.mockResolvedValue(stopsAdxUnobservable)
    render()
    type("cc-stops-asset", "EURUSD")
    click("cc-stops-run")
    await settleOn("cc-stops-refused")
    expect(text("cc-stops-refused")).toContain("NO STOPS")
    expect(text("cc-stops-refused")).toContain("adx-unobservable")
    expect(text("cc-stops-refused")).toContain("unobserved never counts as neutral")
    // No take profit, no stop loss, no multipliers block.
    expect(id("cc-stops-measured")).toBeNull()
    expect(id("cc-stops-multipliers")).toBeNull()
    // And the reading contains no number where a stop would be.
    expect(text("cc-stops-refused")).not.toMatch(/take profit/i)
    expect(text("cc-stops-refused")).not.toMatch(/stop loss/i)
  })

  it("still shows the ATR it really measured, labelled as measured beside the absent stops", async () => {
    stopsMock.mockResolvedValue(stopsAdxUnobservable)
    render()
    type("cc-stops-asset", "EURUSD")
    click("cc-stops-run")
    await settleOn("cc-stops-refused")
    // THE ATTRIBUTION. `atr 0.42` IS measured on this branch and hiding it would
    // be its own dishonesty — but it must sit beside a statement that no stop was
    // produced, so neither can be read as the other.
    const atr = text("cc-stops-atr")
    expect(atr).toContain("atr 0.42")
    expect(atr).toContain("measured")
    expect(atr).toContain("no stop")
    expect(text("cc-stops-refused")).toContain("NO STOPS")
    // And the ADX, which is the thing that was unobservable, reads as absent.
    expect(text("cc-stops-adx")).toContain("adx absent")
  })

  it("renders a MEASURED adx of 0 as 0 — the control for the gate above", async () => {
    stopsMock.mockResolvedValue(stopsMeasuredZeroAdx)
    render()
    type("cc-stops-asset", "EURUSD")
    click("cc-stops-run")
    await settleOn("cc-stops-adx")
    expect(text("cc-stops-adx")).toContain("adx 0")
    expect(text("cc-stops-adx")).not.toContain("absent")
    // The stops ARE shown, because `reason` is null on this branch.
    expect(id("cc-stops-measured")).not.toBeNull()
    expect(id("cc-stops-refused")).toBeNull()
  })

  it("surfaces the ROUTE-level candle refusal with its own words, and renders no stops", async () => {
    // `handlers.mjs:5742` — the only one of these three routes with a
    // route-level refusal, and it arrives as a thrown 400.
    stopsMock.mockRejectedValue(new Error("at least 20 candles required"))
    render()
    type("cc-stops-asset", "EURUSD")
    click("cc-stops-run")
    await settleOn("cc-stops-error")
    expect(text("cc-stops-error")).toContain("at least 20 candles required")
    expect(id("cc-stops-measured")).toBeNull()
    expect(id("cc-stops-refused")).toBeNull()
  })

  it("surfaces the ROUTE-level direction refusal, which is a DIFFERENT refusal", async () => {
    // `handlers.mjs:5746`. Two refusals from one route, and a panel that
    // rendered them identically would hide which constraint was hit.
    stopsMock.mockRejectedValue(new Error("direction must be 'up' or 'down'"))
    render()
    type("cc-stops-asset", "EURUSD")
    click("cc-stops-run")
    await settleOn("cc-stops-error")
    expect(text("cc-stops-error")).toContain("direction must be 'up' or 'down'")
    expect(id("cc-stops-measured")).toBeNull()
  })

  it("states the series origin and the time, like every other panel", async () => {
    render()
    type("cc-stops-asset", "EURUSD")
    click("cc-stops-run")
    await settleOn("cc-stops-origin")
    expect(text("cc-stops-origin")).toContain("EURUSD")
    expect(text("cc-stops-origin")).toContain("120 of 120 requested bar(s) sent")
    expect(text("cc-stops-measured-at")).toContain("fetched")
  })

  it("a refusal CLEARS the previous readout", async () => {
    render()
    type("cc-stops-asset", "EURUSD")
    click("cc-stops-run")
    await settleOn("cc-stops-measured")

    stopsMock.mockRejectedValue(new Error("adaptive-stops failed: 401"))
    click("cc-stops-run")
    await settleOn("cc-stops-error")
    expect(id("cc-stops-measured")).toBeNull()
    expect(id("cc-stops-atrperiod")).toBeNull()
    expect(text("cc-stops-error")).toContain("401")
  })

  it("refuses BOTH invalid input shapes before sending anything", () => {
    // THE STOPS COPY OF THE SAME GUARD. The bar-count branch matters more here
    // than on the other two: the bar count is also the ATR smoothing window, so a
    // `0` that got through would be sent as `{ atrPeriod: 0 }` and silently become
    // the service's 14-bar default rather than an error.
    render()
    type("cc-stops-asset", "")
    click("cc-stops-run")
    flushSync(() => {})
    expect(text("cc-stops-error")).toContain("asset is blank")
    expect(candlesMock).not.toHaveBeenCalled()
    expect(stopsMock).not.toHaveBeenCalled()

    type("cc-stops-asset", "EURUSD")
    type("cc-stops-bars", "-4")
    click("cc-stops-run")
    flushSync(() => {})
    expect(text("cc-stops-error")).toContain('bar count "-4" is not a positive number')
    expect(candlesMock).not.toHaveBeenCalled()
    expect(stopsMock).not.toHaveBeenCalled()
    expect(id("cc-stops-idle")).toBeNull()
  })

  it("keeps labelling a stale answer with the direction it was COMPUTED for", async () => {
    // THE DRIFT, AND IT IS THE SAME CLASS AS THE EXPIRY `sent` THREADING ALREADY IN
    // THE FILE. `StopsReadout` used to be handed `refs.current.direction.value` at
    // RENDER time: the select is uncontrolled, so flipping it while the previous
    // answer was still on screen re-rendered that answer with the NEW direction.
    // For a short that is not a cosmetic mismatch — take profit sits BELOW stop
    // loss — so the panel would show "direction down" beside up levels, an order
    // that is wrong on the one panel whose numbers are directly executable.
    //
    // The second run is held open so the assertions read the DOM DURING it, which
    // is the only window the defect existed in.
    let release: (value: AdaptiveStopsResponse) => void = () => {}
    stopsMock
      .mockResolvedValueOnce(stopsTrending)
      .mockImplementationOnce(
        () => new Promise<AdaptiveStopsResponse>((res) => { release = res })
      )

    render()
    type("cc-stops-asset", "EURUSD")
    setSelect("cc-stops-direction", "up")
    click("cc-stops-run")
    await settleOn("cc-stops-measured")
    expect(text("cc-stops-measured")).toContain("direction up")

    // Flip the select and ask again. The first answer stays on screen while the
    // second is in flight, and it must stay honest.
    setSelect("cc-stops-direction", "down")
    click("cc-stops-run")
    await settleOn("cc-stops-busy")

    const stale = text("cc-stops-measured")
    expect(stale).toContain("take profit 1.09")
    expect(stale).toContain("stop loss 1.04")
    expect(stale).toContain("direction up")
    expect(stale).not.toContain("direction down")

    // And it is not frozen: the answer that actually arrives is the down one.
    release({ ...stopsTrending, takeProfit: 0.96, stopLoss: 1.01 })
    await waitForText({ host: container }, "take profit 0.96")
    const fresh = text("cc-stops-measured")
    expect(fresh).toContain("take profit 0.96")
    expect(fresh).toContain("stop loss 1.01")
    expect(fresh).toContain("direction down")
    expect(stopsMock.mock.calls.map((c) => c[1])).toEqual(["up", "down"])
  })

  it("refuses the ATR-UNOBSERVABLE branch end to end — window too long, three absences", async () => {
    // THE BRANCH THAT HAD NO PANEL-LEVEL TEST AT ALL. The fixture that mentions
    // `adx-unobservable` uses the default MEASURED mock, so neither this branch nor
    // the "window wider than the series → refusal" combination was ever exercised.
    //
    // 900s is the ATR window this run asks for and 120 is what it sends, so
    // `smma` has no finite ATR anywhere in the series (`trading.mjs:328`) and the
    // service takes the `atr-unobservable` exit with `atr: null`, `adx: null` and
    // NO `atrRatio` key. Three absences plus a reason that names none of them
    // individually: a panel that prints one measurement and omits the other two is
    // exactly the failure this guards.
    stopsMock.mockResolvedValue(stopsAtrUnobservable)
    render()
    type("cc-stops-asset", "EURUSD")
    setSelect("cc-stops-tf", "900")
    type("cc-stops-bars", "120")
    click("cc-stops-run")
    await settleOn("cc-stops-refused")

    // The client-side prediction and the service's own refusal agree.
    expect(text("cc-stops-atrperiod")).toContain("too short")
    expect(text("cc-stops-refused")).toContain("NO STOPS — atr-unobservable")

    // All THREE measurements read as absent, and none reads as 0 or as a number.
    const atr = text("cc-stops-atr")
    expect(atr).toContain("absent — no measurable ATR")
    expect(atr).not.toMatch(/atr 0/)
    expect(atr).not.toContain("measured")
    const adx = text("cc-stops-adx")
    expect(adx).toContain("adx absent")
    expect(adx).toContain("atr ratio absent — this branch reports none")

    // No level anywhere in the RESULT block, and no multipliers table.
    expect(id("cc-stops-measured")).toBeNull()
    expect(id("cc-stops-multipliers")).toBeNull()
    // Scoped to the result block, not the whole panel: the panel's own static prose
    // legitimately says "Take profit and stop loss" in describing what it computes.
    expect(text("cc-stops-result")).not.toMatch(/take profit/i)
    expect(text("cc-stops-result")).not.toMatch(/stop loss/i)
    expect(text("cc-stops-result")).not.toMatch(/\d/)
  })
})

export type { ExpiryResponse, AdaptiveStopsResponse }