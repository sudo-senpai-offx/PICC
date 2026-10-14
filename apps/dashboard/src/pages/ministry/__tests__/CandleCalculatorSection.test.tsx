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
import { waitForText } from "@/test-utils/waitForText"
import { CandleCalculatorSection } from "../CandleCalculatorSection"
import { fetchCandles } from "@/hooks/useCandleData"
import * as calculators from "@/lib/candleCalculators"
import type {
  AdaptiveStopsResponse,
  ExpiryResponse,
  RegimeResponse
} from "@/lib/candleCalculators"
import type { CandleDatum } from "@/components/CandlestickChart"

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

/** `detectRegime` on a trending series (`regimeDetection.mjs:88`). */
const regimeTrending: RegimeResponse = {
  ok: true,
  regime: "trending",
  confidence: 72,
  factors: ["ADX 31.4 > 25"],
  suggestedStrategy: "momentum",
  metrics: { adx: 31.4, atrRatio: 1.21, timeframe: "1m" },
  regimeEngine: {
    regime: "TRENDING",
    volatile: false,
    confidence: 75,
    factors: ["plane 60 adx: trending (31.4)"],
    perPlane: { "60": { bars: 120, abstain: false, votes: {}, observed: 4 } },
    latency: { planes: [60], minBars: 120 },
    source: "regimeEngine",
    legacy: "trending"
  }
}

/**
 * `regimeDetection.mjs:39` — under 30 bars. `confidence: 0` IS A LITERAL here and
 * `suggestedStrategy`/`metrics` are ABSENT keys, which is the whole hazard.
 */
const regimeUnknown: RegimeResponse = {
  ok: true,
  regime: "unknown",
  confidence: 0,
  factors: [],
  regimeEngine: {
    regime: "unknown",
    confidence: 0,
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
  candlesMock.mockImplementation(async (_asset, _tf, count) => ({
    rows: servedRows(count),
    source: "yahoo-finance",
    feed: "studio",
    resolvedTimeframe: 60,
    resolved: false,
    availableSources: [],
    verifySources: 2,
    verifiedCount: count,
    verifiedRatio: 1,
    stale: false,
    sourceMode: "auto",
    sources: []
  }))
  regimeMock.mockResolvedValue(regimeTrending)
  expiryMock.mockResolvedValue({
    ok: true,
    recommended: { label: "5m", seconds: 300, score: 80, expectedMove: 0.012 },
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
  "cc-stops-error": "adaptive stops unavailable"
} as const

const settleOn = (testId: keyof typeof MARKERS) => settle(MARKERS[testId])

const render = () => {
  flushSync(() => root.render(<CandleCalculatorSection />))
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
    expect(origin).toContain("120/120 bar(s) cross-verified across 2 source(s)")
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
})

// ---------------------------------------------------------------------
// Expiry — the constant recommendation, and the inputs it is meaningless without
// ---------------------------------------------------------------------

/**
 * `expiryOptimizer.mjs:20`, verbatim: under 20 bars.
 *
 * `recommended` is `EXPIRY_OPTIONS[3]` — the `"1m"` entry of the service's OWN
 * table, returned as a constant with no `score` of its own — and every option
 * carries a literal `score: 50`. `volatility` and `avgMove` are ABSENT keys.
 *
 * Rendering that `"1m"` as a RECOMMENDATION is the `riskParity.mjs:154` defect in
 * a second service: a constant wearing a measurement's label, telling an operator
 * to trade a 1-minute expiry when nothing was computed at all.
 */
const expiryUnscored: ExpiryResponse = {
  ok: true,
  recommended: { label: "1m", seconds: 60 },
  all: [
    { label: "5s", seconds: 5, score: 50 },
    { label: "1m", seconds: 60, score: 50 }
  ]
}

/** The computed branch, sorted by score descending (`expiryOptimizer.mjs:61`). */
const expiryScored: ExpiryResponse = {
  ok: true,
  recommended: { label: "5m", seconds: 300, score: 80, expectedMove: 0.012 },
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

  it("does NOT present the unscored branch's CONSTANT as a recommendation", async () => {
    // THE HAZARD. Under 20 bars `optimizeExpiry` returns its own table entry as
    // `recommended` and scores every option at a literal 50. Printed as a
    // recommendation it tells an operator to take a 1-minute expiry, which is
    // advice derived from a constant.
    expiryMock.mockResolvedValue(expiryUnscored)
    render()
    type("cc-expiry-asset", "EURUSD")
    type("cc-expiry-bars", "12")
    click("cc-expiry-run")
    await settleOn("cc-expiry-unscored")

    const line = text("cc-expiry-unscored")
    expect(line).toContain("NOT SCORED")
    expect(line).toContain("constant")
    // The label is named, so a reader comparing against the payload can see where
    // the 1m came from — but it is never called a recommendation.
    expect(line).toContain("1m")
    expect(text("cc-expiry-recommended")).toBe("")
    expect(id("cc-expiry-recommended")).toBeNull()
    // And no volatility/avgMove as measurements: those keys do not exist here.
    expect(text("cc-expiry-vol")).toBe("")
    // The per-option scores are constants too, so no score table is offered.
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

describe("CandleCalculatorSection — adaptive stops", () => {
  it("sends the series, the direction and the timeframe NUMBER", async () => {
    // `handlers.mjs:5749` passes `{ atrPeriod: timeframe }`, so this route's
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
})

export type { ExpiryResponse, AdaptiveStopsResponse }