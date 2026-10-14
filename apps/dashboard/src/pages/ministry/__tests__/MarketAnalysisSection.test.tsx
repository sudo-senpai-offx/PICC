// @vitest-environment jsdom
// UI-2 — MarketAnalysisSection: the four panels for the analysis routes the
// frontend never called.
//
// THE CONTRACT UNDER TEST IS THE HONESTY RULE, IN FOUR PARTS:
//
//   1. NOTHING FETCHES ON MOUNT. Three of these routes make the SERVER fetch —
//      `getHistory(symbol, "3mo")` per symbol — so four auto-firing panels
//      would be four multi-second network calls nobody asked for.
//   2. A REFUSAL IS A REFUSAL CARRYING ITS REASON. A `400`, a `502`, and the
//      `volatility` route's own 200-with-`ok:false` must all produce a named
//      reason and NO readout region, and a refusal must also CLEAR a previous
//      success rather than sitting beside it.
//   3. AN ABSENCE IS NEVER A ZERO. `orderflow.available === false` must not put
//      a number where nobody measured one, and a measured `0` must still print
//      as `0` — so every absence assertion has a measured-zero control beside it.
//   4. `risk-parity` DROPS SYMBOLS WITHOUT SAYING SO, so the panel must state
//      coverage against what it asked for and name what is missing.
//
// `act()` IS NOT USED ANYWHERE IN THIS FILE. This harness is not configured for
// it — react-dom reports "the current testing environment is not configured to
// support act(...)" — so wrapping in it is a no-op that lets these assertions
// run before React commits, and a test that cannot fail on a broken component is
// worse than no test. This is the `waitFor` polling helper from
// `PreMortemSection.test.tsx`: press, then poll the DOM until the state has
// actually landed.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MarketAnalysisSection } from "../MarketAnalysisSection"
import * as marketAnalysis from "@/lib/marketAnalysis"
import type {
  OrderFlowResponse,
  RiskParityResponse,
  SentimentResponse,
  VolatilityResponse
} from "@/lib/marketAnalysis"

vi.mock("@/lib/marketAnalysis", () => ({
  fetchVolatility: vi.fn(),
  fetchSentiment: vi.fn(),
  fetchRiskParity: vi.fn(),
  fetchOrderFlow: vi.fn()
}))

const vol = vi.mocked(marketAnalysis.fetchVolatility)
const sent = vi.mocked(marketAnalysis.fetchSentiment)
const rp = vi.mocked(marketAnalysis.fetchRiskParity)
const of = vi.mocked(marketAnalysis.fetchOrderFlow)

// ---------------------------------------------------------------------
// Fixtures — each one is the shape the SERVER actually serves.
// ---------------------------------------------------------------------

/** `volatilitySnapshot` on a healthy 62-candle history (`volatility.mjs:448`). */
function volMeasured(over: Record<string, unknown> = {}): VolatilityResponse {
  return {
    ok: true,
    symbol: "EURUSD",
    name: "Euro/US Dollar",
    atr: {
      regime: "elevated",
      atr: 0.0042,
      atrPct: 0.0042,
      atrPctPct: "0.42%",
      avgAtr: 0.0039,
      percentile: 73,
      shrinking: false,
      breakoutWarning: false
    },
    realized: { daily: 0.0041, annual: 0.0651, annualPct: "6.51%", period: 20, sampleSize: 62 },
    parkinson: { daily: 0.0043, annual: 0.0683, annualPct: "6.83%", period: 20 },
    // The four estimators decline INDEPENDENTLY, so this is the real shape and
    // not a contrivance: 20 bars that fail the Garman-Klass `h>=l && h>=o &&
    // l<=cl` filter still produced a close-to-close and a Parkinson number.
    garmanKlass: { daily: null, annual: null, period: 20 },
    yangZhang: { daily: 0.0044, annual: 0.0699, annualPct: "6.99%", period: 20 },
    garch: {
      ok: true,
      omega: 0.00001,
      alpha: 0.08,
      beta: 0.88,
      persistence: 0.96,
      longRunVol: 0.05,
      currentVol: 0.064,
      currentVolPct: "6.4%",
      forecast: [{ step: 1, variance: 0.0000041, volatility: 0.064, volatilityPct: "6.4%" }],
      sampleSize: 60
    },
    lastPrice: 1.0842,
    candleCount: 62,
    timestamp: "2026-10-11T09:15:00.000Z",
    ...over
  } as VolatilityResponse
}

/** `volatilitySnapshot` under 30 candles — served on a 200 with `ok:false`. */
const volRefused: VolatilityResponse = {
  ok: false,
  symbol: "NOPE",
  name: "NOPE",
  error: "need at least 30 candles"
}

/** A composite over the news leg alone: 0.6 of the declared band, social absent. */
const sentMeasured: SentimentResponse = {
  ok: true,
  symbol: "EURUSD",
  available: true,
  reason: null,
  socialUnavailableReason:
    "0 measured composite(s) exist for EURUSD and velocity needs at least 2. This is an ABSENCE of the derived signal, not a zero velocity.",
  composite: {
    score: 0.6,
    label: "Bullish",
    extreme: true,
    weighted: { news: 0.6, social: null },
    legsPresent: ["news"],
    declaredLegWeightReached: 0.6,
    legWeightsRenormalised: false
  },
  news: {
    score: 1,
    bullish: 3,
    bearish: 0,
    neutral: 0,
    sampleSize: 3,
    source: "news",
    retrievalModes: ["rss"],
    sources: ["Reuters"],
    verified: null
  },
  newsUnavailableReason: null,
  social: null,
  provenance: [{ text: "EUR/USD rallies" }],
  unprovenanced: [],
  copilot: { available: false },
  observedAt: 1_700_000_000_000,
  timestamp: 1_700_000_005_000,
  history: []
}

/** No news leg, so no composite at all — and no neutral default either. */
const sentAbsent: SentimentResponse = {
  ok: true,
  symbol: "BTCUSD",
  available: false,
  reason:
    "no composite: the news leg is absent (0 provenanced digest item(s) were retrieved and NONE mentions BTCUSD).",
  socialUnavailableReason: "0 measured composite(s) exist for BTCUSD and velocity needs at least 2.",
  composite: null,
  news: null,
  newsUnavailableReason:
    "3 provenanced digest item(s) were retrieved and NONE mentions BTCUSD. That is an absence of COVERAGE for this symbol, not a neutral reading of it.",
  social: null,
  provenance: [],
  unprovenanced: [],
  copilot: { available: false },
  observedAt: null,
  timestamp: 1_700_000_005_000,
  history: []
}

/** The other refusal shape: the symbol cannot even be named. */
const sentUnsearchable: SentimentResponse = {
  ok: true,
  symbol: "12345",
  normalizedSymbol: null,
  available: false,
  reason:
    "the supplied symbol is not searchable, so neither leg was evaluated. No news source was asked and no history existed; this is a named absence, not a neutral sentiment reading.",
  composite: null,
  news: null,
  newsUnavailableReason: "no D17 news source is configured",
  social: null,
  socialUnavailableReason: "no canonical ticker, so no composite history could be selected for it.",
  provenance: [],
  observedAt: null,
  timestamp: 1_700_000_005_000,
  history: [],
  sourcesConfigured: 0
}

/** Two of the four requested symbols survived the route's two silent filters. */
const rpPartial: RiskParityResponse = {
  ok: true,
  weights: { EURUSD: 0.62, BTCUSD: 0.38 },
  method: "inverse-vol",
  symbolCount: 2,
  vols: { EURUSD: 0.0651, BTCUSD: 0.9112 },
  portfolioVol: null,
  portfolioVolPct: null,
  riskContributions: null,
  iterations: null
}

/** `handlers.mjs:5173` — the route refused before allocating. */
const rpRouteRefused: RiskParityResponse = {
  ok: false,
  error: "no symbols",
  weights: null
}

const ofUnavailable: OrderFlowResponse = {
  ok: true,
  available: false,
  delta: [],
  cumulative: null,
  avgDelta: null,
  imbalance: "unavailable",
  signals: [],
  dataFidelity: "no-feed",
  reason:
    "no signed-trades feed: OHLCV bars contain no aggressor-side information, so delta/CVD/absorption cannot be derived from candle structure.",
  lookback: 20
}

/** The measured-zero CONTROL: a real feed that printed a flat tape. */
const ofMeasuredZero: OrderFlowResponse = {
  ok: true,
  available: true,
  delta: [
    { time: 1, side: "buy", delta: 100, price: 1.08, volume: 100 },
    { time: 2, side: "sell", delta: -100, price: 1.08, volume: 100 }
  ],
  cumulative: 0,
  avgDelta: 0,
  imbalance: "neutral",
  signals: [],
  dataFidelity: "signed-trades",
  source: "signed-trades maker flow",
  lookback: 20
}

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vol.mockReset()
  sent.mockReset()
  rp.mockReset()
  of.mockReset()
  vol.mockResolvedValue(volMeasured())
  sent.mockResolvedValue(sentMeasured)
  rp.mockResolvedValue(rpPartial)
  of.mockResolvedValue(ofUnavailable)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  flushSync(() => root.unmount())
  container.remove()
})

/**
 * Polling rather than `act`, for the reason in this file's header. The
 * `flushSync(() => {})` on every tick is what forces React to commit pending
 * work, so the loop exits only once the DOM has actually changed.
 */
async function waitFor(check: () => boolean, what: string, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
    flushSync(() => {})
  }
  flushSync(() => {})
}

const render = () => {
  flushSync(() => root.render(<MarketAnalysisSection />))
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

const waitForId = (testId: string, what = testId) =>
  waitFor(() => id(testId) !== null, what)

// ---------------------------------------------------------------------
// Opt-in: nothing reads on mount
// ---------------------------------------------------------------------

describe("MarketAnalysisSection — opt-in", () => {
  it("DOES NOT fetch on mount; all four routes ask the server for data", () => {
    render()
    expect(vol).not.toHaveBeenCalled()
    expect(sent).not.toHaveBeenCalled()
    expect(rp).not.toHaveBeenCalled()
    expect(of).not.toHaveBeenCalled()
    expect(id("market-vol-idle")).not.toBeNull()
    expect(id("market-sent-idle")).not.toBeNull()
    expect(id("market-rp-idle")).not.toBeNull()
    expect(id("market-of-idle")).not.toBeNull()
  })

  it("does not call a client whose input is blank, rather than sending a guess", () => {
    render()
    click("market-vol-run")
    click("market-sent-run")
    click("market-rp-run")
    flushSync(() => {})
    expect(vol).not.toHaveBeenCalled()
    expect(sent).not.toHaveBeenCalled()
    expect(rp).not.toHaveBeenCalled()
    // Order flow is the exception: its only input is optional by design.
    expect(of).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------
// Volatility
// ---------------------------------------------------------------------

describe("MarketAnalysisSection — volatility", () => {
  it("asks for the symbol typed into its own input and renders the server's snapshot", async () => {
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await waitForId("market-vol-result")
    expect(vol).toHaveBeenCalledTimes(1)
    expect(vol).toHaveBeenCalledWith("EURUSD")
    expect(text("market-vol-result")).toContain("Euro/US Dollar")
    expect(text("market-vol-sample")).toContain("62 usable candles")
    expect(text("market-vol-est-realized")).toContain("0.0651")
  })

  it("stamps the readout with when it was fetched and what the server asked for", async () => {
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await waitForId("market-vol-measured-at")
    expect(text("market-vol-measured-at")).toContain("fetched")
    // BOTH sides of the identity: what this panel asked, and what the server said
    // it resolved. A panel that silently re-reads under the same label is lying
    // about when, and a panel that shows only its own input cannot show that the
    // server answered about a different instrument.
    expect(text("market-vol-sample")).toContain("asked for EURUSD")
    expect(text("market-vol-sample")).toContain("server answered EURUSD")
    expect(text("market-vol-stamp")).toContain("2026-10-11T09:15:00.000Z")
  })

  it("renders the route's 200-with-ok:false as a REFUSAL carrying its reason", async () => {
    vol.mockResolvedValue(volRefused)
    render()
    type("market-vol-symbol", "NOPE")
    click("market-vol-run")
    await waitForId("market-vol-refused")
    expect(text("market-vol-refused")).toContain("need at least 30 candles")
    // NO readout region at all. An empty panel here would read as "the read
    // happened and there was nothing to say", which is the exact impression the
    // 30-candle threshold exists to prevent.
    expect(id("market-vol-result")).toBeNull()
    expect(ids("market-vol-est-realized")).toHaveLength(0)
    expect(ids("market-vol-garch")).toHaveLength(0)
  })

  it("renders an absent ESTIMATOR as absent, never as 0", async () => {
    // garmanKlass is the fixture's absent branch: 20 bars that failed the
    // estimator's own h/l/o/c consistency filter.
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await waitForId("market-vol-est-garmanKlass")
    const line = text("market-vol-est-garmanKlass")
    expect(line).toContain("absent")
    expect(line).toContain("20-bar window")
    // The FORBIDDEN READING, precisely: a number where the label reads annual.
    expect(line).not.toMatch(/annual: -?[\d.]/)
    // And the sibling estimators still print, so "absent" is per-estimator
    // rather than a blanket statement about the asset.
    expect(text("market-vol-est-realized")).toContain("0.0651")
  })

  it("still renders a genuine measured 0 as 0 — the control for the assertion above", async () => {
    vol.mockResolvedValue(
      volMeasured({
        realized: { daily: 0, annual: 0, annualPct: "0%", period: 20, sampleSize: 62 }
      })
    )
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await waitForId("market-vol-est-realized")
    const line = text("market-vol-est-realized")
    expect(line).toContain("0 (0%)")
    expect(line).not.toContain("absent")
  })

  it("renders an unfitted GARCH as a model that did not fit, not as zero parameters", async () => {
    vol.mockResolvedValue(
      volMeasured({
        garch: { ok: false, omega: null, alpha: null, beta: null, currentVol: null, forecast: [] }
      })
    )
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await waitForId("market-vol-garch")
    const line = text("market-vol-garch")
    expect(line).toContain("did not fit")
    // `omega 0` would assert a coefficient nobody estimated.
    expect(line).not.toMatch(/omega 0/)
    expect(line).not.toMatch(/alpha 0/)
  })

  it("renders an ATR regime of unknown as absent, with no reason invented", async () => {
    vol.mockResolvedValue(
      volMeasured({ atr: { regime: "unknown", atr: null, atrPct: null, percentile: null } })
    )
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await waitForId("market-vol-atr")
    const line = text("market-vol-atr")
    expect(line).toContain("unknown")
    expect(line).toContain("absent")
    expect(line).toContain("the route sends no reason")
  })

  it("surfaces a 502 as a refusal carrying the upstream reason, and renders no readout", async () => {
    vol.mockRejectedValue(new Error("Yahoo Finance 404 for NOPE"))
    render()
    type("market-vol-symbol", "NOPE")
    click("market-vol-run")
    await waitForId("market-vol-error")
    expect(text("market-vol-error")).toContain("Yahoo Finance 404 for NOPE")
    expect(id("market-vol-result")).toBeNull()
  })

  it("a refusal CLEARS the previous readout rather than sitting beside it", async () => {
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await waitForId("market-vol-result")

    vol.mockRejectedValue(new Error("volatility failed: 401"))
    click("market-vol-run")
    await waitForId("market-vol-error")
    // The stale success must not remain readable as the answer to the second,
    // failed question. PreMortemSection leaves it on screen; here it does not.
    expect(id("market-vol-result")).toBeNull()
    expect(id("market-vol-measured-at")).toBeNull()
  })
})

// ---------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------

describe("MarketAnalysisSection — sentiment", () => {
  it("renders NO composite as an absence carrying the engine's reason, with no score", async () => {
    sent.mockResolvedValue(sentAbsent)
    render()
    type("market-sent-symbol", "BTCUSD")
    click("market-sent-run")
    await waitForId("market-sent-composite-absent")
    expect(text("market-sent-composite-absent")).toContain("no composite")
    expect(text("market-sent-composite-absent")).toContain("NONE mentions BTCUSD")
    // NO composite block, and no neutral standing in for it. This engine has no
    // neutral default, so a rendered "Neutral" here would be a fabrication.
    expect(id("market-sent-composite")).toBeNull()
    expect(text("market-sent-composite-absent")).not.toMatch(/\bNeutral\b/)
    expect(text("market-sent-observed")).toContain("never observed")
  })

  it("names the BAND a composite was drawn from, and the absent leg beside it", async () => {
    render()
    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await waitForId("market-sent-composite")
    expect(text("market-sent-composite")).toContain("0.6")
    expect(text("market-sent-composite")).toContain("Bullish")
    // 0.6 of the declared band, not 1: the social leg is absent and the engine
    // deliberately does not renormalise, so this label is NOT on the 0.6+0.4
    // scale and must not be read as if it were.
    expect(text("market-sent-weight")).toContain("reached 0.6 of the declared leg weight")
    expect(text("market-sent-weight")).toContain("legs present: news")
    expect(text("market-sent-weight")).toContain("social contribution absent")
    expect(text("market-sent-social-absent")).toContain("velocity needs at least 2")
  })

  it("reports the licence check as not done, because the payload says it was not", async () => {
    render()
    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await waitForId("market-sent-news")
    expect(text("market-sent-news")).toContain("3 item(s)")
    expect(text("market-sent-news")).toContain("Reuters")
    expect(text("market-sent-news")).toContain("licence checked: no")
  })

  it("separates the time sentiment was MEASURED from the time the engine ran", async () => {
    render()
    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await waitForId("market-sent-observed")
    const line = text("market-sent-observed")
    // Both facts, and they are different facts: `observedAt` null would make an
    // unused engine look live if only `timestamp` were read.
    expect(line).toContain("measured at")
    expect(line).toContain("engine last ran at")
  })

  it("renders an unsearchable symbol as a named absence, not as an empty reading", async () => {
    sent.mockResolvedValue(sentUnsearchable)
    render()
    type("market-sent-symbol", "12345")
    click("market-sent-run")
    await waitForId("market-sent-head")
    expect(text("market-sent-head")).toContain("not searchable")
    expect(text("market-sent-composite-absent")).toContain("not searchable")
    expect(id("market-sent-news")).toBeNull()
    expect(text("market-sent-news-absent")).toContain("no D17 news source is configured")
    expect(id("market-sent-social")).toBeNull()
  })

  it("surfaces a 400 as a refusal carrying 'symbol required', and renders no reading", async () => {
    sent.mockRejectedValue(new Error("symbol required"))
    render()
    type("market-sent-symbol", "")
    // The input is blank so the button no-ops; drive the client path directly by
    // typing a symbol the server would reject.
    type("market-sent-symbol", "  ")
    click("market-sent-run")
    expect(sent).not.toHaveBeenCalled()

    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await waitForId("market-sent-error")
    expect(text("market-sent-error")).toContain("symbol required")
    expect(id("market-sent-result")).toBeNull()
  })
})

// ---------------------------------------------------------------------
// Risk parity — the silent-drop hazard
// ---------------------------------------------------------------------

describe("MarketAnalysisSection — risk parity", () => {
  it("states coverage against what it ASKED FOR and names every symbol that is missing", async () => {
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD, SOLUSD, XRPUSD")
    click("market-rp-run")
    await waitForId("market-rp-result")
    expect(rp).toHaveBeenCalledWith(["EURUSD", "BTCUSD", "SOLUSD", "XRPUSD"])

    // THE HAZARD. The route drops a symbol whose history failed or held under 30
    // closes, the allocator then keeps only symbols with 65+ closes, and neither
    // drop is reported anywhere in the payload.
    expect(text("market-rp-coverage-count")).toContain("coverage: 2 of 4 requested symbol(s)")
    // Sorted, because `weights` is a keyed object and its insertion order is not
    // a property anything can assert on.
    expect(text("market-rp-coverage-present")).toContain("BTCUSD, EURUSD")
    const absent = text("market-rp-coverage-absent")
    expect(absent).toContain("requested but NOT in the allocation")
    expect(absent).toContain("SOLUSD")
    expect(absent).toContain("XRPUSD")
    // And it says the mechanism is unknown, rather than guessing which filter
    // applied to which symbol.
    expect(absent).toContain("is unknown")
  })

  it("does not claim completeness it cannot verify", async () => {
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD, SOLUSD, XRPUSD")
    click("market-rp-run")
    await waitForId("market-rp-coverage")
    expect(id("market-rp-coverage-absent-none")).toBeNull()
    expect(text("market-rp-coverage-count")).not.toContain("4 of 4")
  })

  it("says so when EVERY requested symbol is present", async () => {
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await waitForId("market-rp-coverage-absent-none")
    expect(text("market-rp-coverage-count")).toContain("coverage: 2 of 2")
    expect(text("market-rp-coverage-absent-none")).toContain("every requested symbol carries a weight")
  })

  it("normalises, splits and prints each weight beside its own volatility", async () => {
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await waitForId("market-rp-weight-EURUSD")
    expect(text("market-rp-weight-EURUSD")).toContain("weight 0.62")
    expect(text("market-rp-weight-EURUSD")).toContain("0.0651")
    expect(text("market-rp-weight-BTCUSD")).toContain("weight 0.38")
    expect(text("market-rp-method")).toContain("inverse-vol")
  })

  it("surfaces a symbolCount that disagrees with the number of weights", async () => {
    // `inverseVolWeights` drops a symbol whose vol is not finite-and-positive
    // (`riskParity.mjs:31`), so `symbolCount` can exceed the weight count with
    // the difference named nowhere.
    rp.mockResolvedValue({ ...rpPartial, symbolCount: 3 } as RiskParityResponse)
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await waitForId("market-rp-count-mismatch")
    expect(text("market-rp-count-mismatch")).toContain("symbolCount 3 against 2 weight(s)")
  })

  it("renders the ROUTE-level refusal as a refusal and shows no allocation", async () => {
    rp.mockResolvedValue(rpRouteRefused)
    render()
    type("market-rp-symbols", "EURUSD")
    click("market-rp-run")
    await waitForId("market-rp-refused")
    expect(text("market-rp-refused")).toContain("no symbols")
    // `weights: null` means the route refused BEFORE allocating, which is a
    // different fact from the allocator refusing after fetching.
    expect(text("market-rp-refused")).toContain("refused before any allocation ran")
    expect(id("market-rp-result")).toBeNull()
    expect(ids("market-rp-weight-EURUSD")).toHaveLength(0)
  })

  it("renders the ALLOCATOR-level refusal as a different fact from the route's", async () => {
    rp.mockResolvedValue({
      ok: false,
      error: "no symbols with sufficient data",
      weights: {}
    })
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await waitForId("market-rp-refused")
    expect(text("market-rp-refused")).toContain("no symbols with sufficient data")
    expect(text("market-rp-refused")).toContain("refused after fetching")
    expect(id("market-rp-result")).toBeNull()
  })

  it("surfaces a 502 as a refusal carrying its reason, and renders no allocation", async () => {
    rp.mockRejectedValue(new Error("watchlist unavailable"))
    render()
    type("market-rp-symbols", "EURUSD")
    click("market-rp-run")
    await waitForId("market-rp-error")
    expect(text("market-rp-error")).toContain("watchlist unavailable")
    expect(id("market-rp-result")).toBeNull()
  })
})

// ---------------------------------------------------------------------
// Order flow — the absence hazard
// ---------------------------------------------------------------------

describe("MarketAnalysisSection — order flow", () => {
  it("renders available:false as NOT MEASURED, with the contract's own reason", async () => {
    render()
    click("market-of-run")
    await waitForId("market-of-unavailable")
    expect(text("market-of-unavailable")).toContain("NOT MEASURED")
    expect(text("market-of-reason")).toContain("no signed-trades feed")
    expect(id("market-of-measured")).toBeNull()
  })

  it("prints the imbalance the server sent, which is 'unavailable' and never 'neutral'", async () => {
    render()
    click("market-of-run")
    await waitForId("market-of-fidelity")
    const line = text("market-of-fidelity")
    expect(line).toContain("data fidelity: no-feed")
    // THE FORBIDDEN READING, precisely: a neutral tape is a measurement nobody
    // made, and printing the word would reinstate the exact fabrication the
    // `orderFlow.mjs` contract removed.
    expect(line).toContain("imbalance unavailable")
    expect(line).not.toMatch(/imbalance neutral/)
  })

  it("prints absent rather than 0 for the two numeric fields nobody measured", async () => {
    render()
    click("market-of-run")
    await waitForId("market-of-fidelity")
    const line = text("market-of-fidelity")
    expect(line).toContain("cumulative absent")
    expect(line).toContain("average delta absent")
    expect(line).not.toMatch(/cumulative 0\b/)
    expect(line).not.toMatch(/average delta 0\b/)
  })

  it("still prints a genuine measured 0 as 0 — the control for the two assertions above", async () => {
    of.mockResolvedValue(ofMeasuredZero)
    render()
    click("market-of-run")
    await waitForId("market-of-measured")
    const line = text("market-of-measured")
    expect(line).toContain("cumulative 0")
    expect(line).toContain("average delta 0")
    expect(line).toContain("imbalance neutral")
    expect(line).not.toContain("absent")
    expect(text("market-of-fidelity")).toContain("signed-trades")
  })

  it("sends the lookback typed into its input, and no symbol and no trades", async () => {
    render()
    type("market-of-lookback", "50")
    click("market-of-run")
    await waitForId("market-of-result")
    expect(of).toHaveBeenCalledWith(50)
    expect(text("market-of-lookback-echo")).toContain("lookback 20")
  })

  it("states on the panel that it sends neither a symbol nor trades, and why", async () => {
    render()
    // There is no symbol input at all. The route takes no symbol, and it refuses
    // a client-supplied trade series on purpose, so an input for either would
    // invite a caller to do the one thing the contract forbids.
    expect(id("market-of-symbol")).toBeNull()
    const contract = text("market-of-contract")
    expect(contract).toContain("No symbol and no trades are sent")
    expect(contract).toContain("aggressor-side")
  })
})