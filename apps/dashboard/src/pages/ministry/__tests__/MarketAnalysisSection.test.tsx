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
// worse than no test. Asynchronous loads settle on the repo's shared
// `waitForText` (`src/test-utils/waitForText.ts`): press, then poll the DOM's TEXT
// until the state has actually landed, reporting the last rendered string if it
// never does.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { waitForText } from "@/test-utils/waitForText"
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
  volStatus: {
    EURUSD: { state: "measured", annual: 0.0651, reason: null },
    BTCUSD: { state: "measured", annual: 0.9112, reason: null }
  },
  portfolioVol: null,
  portfolioVolPct: null,
  riskContributions: null,
  iterations: null,
  reason: null
}

/**
 * A symbol the allocator MEASURED and then dropped, plus the count that proves
 * it: `symbolCount: 2` against one weight.
 *
 * This is the payload the ERC exclusion produces — one asset whose real, non-zero
 * volatility falls below the published 4dp precision, so it publishes as 0, has
 * no published volatility to weight, and leaves the matrix. The panel used to
 * render that mismatch as "dropped from the weights without being named", which
 * was false: the payload names the precision limit in `volStatus`, in words.
 */
const rpPrecisionDrop: RiskParityResponse = {
  ok: true,
  weights: { EURUSD: 1 },
  method: "equal-risk-contribution",
  symbolCount: 2,
  vols: { EURUSD: 0.0651, BTCUSD: 0 },
  volStatus: {
    EURUSD: { state: "measured", annual: 0.0651, reason: null },
    BTCUSD: {
      state: "measured-rounded-zero",
      annual: 0,
      reason:
        "the annualized volatility rounds to 0 at the published 4dp precision: the price series does move inside the window, but the computed figure is below 0.00005, so it publishes as 0 without being a measurement of no movement"
    }
  },
  portfolioVol: 0.0041,
  portfolioVolPct: "0.41%",
  riskContributions: [{ symbol: "EURUSD", weight: 1, riskContribution: "100%" }],
  iterations: 500,
  reason: null
}

/** `handlers.mjs:5173` — the route refused before allocating. */
const rpRouteRefused: RiskParityResponse = {
  ok: false,
  error: "no symbols",
  weights: null
}

/**
 * ONE survivor, so the allocator takes the single-asset branch.
 *
 * REWRITTEN. This fixture used to carry `portfolioVol: 0`, which was a LITERAL in
 * the source, returned above the covariance build on a branch that builds no
 * covariance. It is now `portfolioVol: null` with a reason, and — the change
 * that matters for this panel — the asset's own MEASURED volatility is now
 * present in `vols`, where before the branch discarded it entirely.
 *
 * So the two lines below can no longer contradict each other: the weight line
 * prints the volatility that was measured, and the portfolio line says the
 * portfolio-level number does not exist. Previously the weight line said
 * "annual vol absent" beside a "portfolio vol: 0", which is one unmeasured
 * thing called an absence and a second one called a measurement, two lines
 * apart.
 */
const rpSingleAsset: RiskParityResponse = {
  ok: true,
  weights: { EURUSD: 1 },
  method: "single-asset",
  symbolCount: null,
  vols: { EURUSD: 0.0651 },
  volStatus: { EURUSD: { state: "measured", annual: 0.0651, reason: null } },
  portfolioVol: null,
  portfolioVolPct: null,
  reason:
    "single-asset portfolio: no covariance is built, so no portfolio volatility is computed; the asset's own measured volatility is in vols",
  riskContributions: null,
  iterations: null
}

/**
 * `riskParity.mjs:210` — the ERC branch, where `portfolioVol` IS computed.
 *
 * THE CONTROL FOR THE FIX ABOVE, and its justification is NARROWER than it
 * looks. `equalRiskContribution` computes `Math.sqrt(Math.max(portVar, 1e-12))`
 * (`:100`) and rounds to 4dp, so an ERC response can serve `portfolioVol: 0`.
 *
 * What a `0` here does NOT mean, despite this fixture's old name: it is not
 * necessarily a MEASURED zero. The same floor makes a DEGENERATE covariance
 * serve 0 — verified, `equalRiskContribution([[0]], ["A"])` returns
 * `portfolioVol: 0` — so a 0 on that branch may be a measurement below the
 * published precision OR a malformed input, and the panel cannot tell which from
 * the number. (The fixture is renamed for the same reason: a name that asserts
 * "measured" is a claim the fixture cannot support.)
 *
 * The gate is therefore on `method`, never on the value, and the assertion
 * stands on its own terms: `measured()` is `Number.isFinite`, so a 0 the
 * service sent on a branch that claims to compute one must print as `0`, because
 * collapsing zeros by value would swallow a real measurement. The residual
 * defect — an ERC 0 that is really a precision limit printing as a measurement
 * — belongs to the service's 4dp publication, not to this panel.
 */
const rpErcZero: RiskParityResponse = {
  ok: true,
  weights: { EURUSD: 0.5, BTCUSD: 0.5 },
  method: "equal-risk-contribution",
  symbolCount: 2,
  vols: { EURUSD: 0.0651, BTCUSD: 0.9112 },
  volStatus: {
    EURUSD: { state: "measured", annual: 0.0651, reason: null },
    BTCUSD: { state: "measured", annual: 0.9112, reason: null }
  },
  portfolioVol: 0,
  portfolioVolPct: "0%",
  riskContributions: [
    { symbol: "EURUSD", weight: 0.5, riskContribution: "50%" },
    { symbol: "BTCUSD", weight: 0.5, riskContribution: "50%" }
  ],
  iterations: 500
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
 * The repo's shared async-settle helper (`src/test-utils/waitForText.ts`), already
 * imported by six sibling suites.
 *
 * THIS FILE HAD ITS OWN COPY and round 1 removed it. The local version polled
 * element PRESENCE, carried no text, and threw a bare `waitFor timed out waiting for
 * <testid>` — so when a wait expired the report named a test id rather than the state
 * the DOM was actually in, and the reader had to re-run to find out why. It also ran
 * `pollMs 25 / timeoutMs 2000` against the repo's `5 / 5000`: the coarser poll is
 * slower and the shorter timeout is flake on a loaded CI box, in a suite whose slowest
 * test already takes seconds.
 *
 * THE HANDSHAKE IS THE SAME EITHER WAY: an ASCII marker that only appears once the
 * load has committed. `act()` is still not used, for the reason in this file's header —
 * it is a no-op in this harness. What changes is only WHEN the test reads the DOM,
 * never WHAT it asserts.
 */
const settle = (marker: string) => waitForText({ host: container }, marker)

/**
 * Every wait site, and the ASCII marker each one settles on.
 *
 * A MARKER MUST BE FALSE AT MOUNT. `waitForText` searches the whole container, and
 * this container holds all four panels at once, so a marker borrowed from the
 * always-rendered copy — the section note ("Four server-fetched readouts"), the
 * order-flow contract paragraph ("…CVD and absorption…") — is true before anything
 * commits and the wait returns immediately. The previous helper waited on element
 * PRESENCE, which made that class of mistake impossible; migrating to text markers
 * reintroduced it, and two of my first markers hit it. Every entry below was checked
 * against the static copy for that reason.
 */
const MARKERS = {
  // Volatility — measured path.
  "market-vol-result": "ATR regime",
  "market-vol-atr": "ATR regime",
  "market-vol-est-realized": "close-close",
  "market-vol-est-garmanKlass": "garman-klass",
  "market-vol-garch": "GARCH(1,1)",
  // NOT "fetched": the section note above the panels already reads "Four
  // server-fetched readouts", so that marker is true at mount and the wait would
  // return before anything committed. MeasuredAt renders in the same commit as
  // VolatilityResult, so any marker from that commit is equally sound.
  "market-vol-measured-at": "usable candles",
  // Volatility — refusals. `volatility unavailable` is the transport refusal;
  // `volatility refused` is the route's own 200-with-`ok:false`.
  "market-vol-error": "volatility unavailable",
  "market-vol-refused": "volatility refused",
  // Sentiment.
  "market-sent-head": "server answered",
  "market-sent-composite": "declared leg weight",
  "market-sent-composite-absent": "no composite",
  "market-sent-news": "licence checked:",
  "market-sent-observed": "engine last ran at",
  "market-sent-social": "social-derived leg",
  "market-sent-unprovenanced": "digest item(s) arrived without provenance",
  "market-sent-error": "sentiment unavailable",
  // Risk parity.
  "market-rp-result": "coverage: ",
  "market-rp-coverage": "in the allocation",
  "market-rp-coverage-absent-none": "every requested symbol carries a weight",
  "market-rp-weight-EURUSD": "weight ",
  "market-rp-count-mismatch": "the allocation also reports symbolCount",
  "market-rp-refused": "risk parity refused",
  "market-rp-error": "risk parity unavailable",
  "market-rp-portfolio": "portfolio vol:",
  "market-rp-portfolio-vol": "portfolio vol:",
  "market-rp-rc-EURUSD": "risk contribution",
  // Order flow.
  "market-of-result": "lookback ",
  "market-of-unavailable": "NOT MEASURED",
  "market-of-measured": "cumulative ",
  "market-of-fidelity": "data fidelity",
  "market-of-signal": "sell-side absorbed",
  "market-of-error": "order flow unavailable"
} as const

const settleOn = (testId: keyof typeof MARKERS) => settle(MARKERS[testId])

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
    // NO ORDER-FLOW ASSERTION HERE, AND THAT IS THE POINT. A blank click on the
    // order-flow panel DOES call its client — its only input is optional by design —
    // but this test never clicks that button, so `expect(of).not.toHaveBeenCalled()`
    // here was a second mount-fetch check wearing the costume of a blank-input
    // assertion, next to a comment claiming a behaviour it never exercised. The
    // behaviour is now asserted where it happens, in the test below.
    expect(id("market-vol-idle")).not.toBeNull()
    expect(id("market-sent-idle")).not.toBeNull()
    expect(id("market-rp-idle")).not.toBeNull()
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
    await settleOn("market-vol-result")
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
    await settleOn("market-vol-measured-at")
    expect(text("market-vol-measured-at")).toContain("fetched")
    // BOTH sides of the identity: what this panel asked, and what the server said
    // it resolved. A panel that silently re-reads under the same label is lying
    // about when, and a panel that shows only its own input cannot show that the
    // server answered about a different instrument.
    expect(text("market-vol-sample")).toContain("asked for EURUSD")
    expect(text("market-vol-sample")).toContain("server answered EURUSD")
    expect(text("market-vol-stamp")).toContain("2026-10-11T09:15:00.000Z")
  })

  it("shows a DIVERGENT asked/answered pair, so echoing the server twice cannot pass", async () => {
    // EVERY OTHER FIXTURE IN THIS FILE HAS `asked === data.symbol`. With that
    // pairing a panel rewritten to print `data.symbol` in both positions — throwing
    // away what the operator typed — still satisfies every assertion above, which
    // is exactly the failure this test exists to exclude. So the pair diverges here.
    vol.mockResolvedValue(volMeasured({ symbol: "GBPUSD", name: "Pound/US Dollar" }))
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await settleOn("market-vol-result")
    // The client was asked about EURUSD...
    expect(vol).toHaveBeenCalledWith("EURUSD")
    // ...the server answered about GBPUSD, and the panel is the only place that
    // disagreement is visible.
    expect(text("market-vol-result")).toContain("Pound/US Dollar")

    const sample = text("market-vol-sample")
    expect(sample).toContain("asked for EURUSD")
    expect(sample).toContain("server answered GBPUSD")
    // EACH SIDE EXACTLY ONCE. The two negations catch a swapped pair; the two
    // length assertions catch an echo-the-server rewrite, which would print GBPUSD
    // twice and EURUSD not at all.
    expect(sample).not.toContain("server answered EURUSD")
    expect(sample).not.toContain("asked for GBPUSD")
    expect(sample.match(/EURUSD/g)).toHaveLength(1)
    expect(sample.match(/GBPUSD/g)).toHaveLength(1)
  })

  it("renders the route's 200-with-ok:false as a REFUSAL carrying its reason", async () => {
    vol.mockResolvedValue(volRefused)
    render()
    type("market-vol-symbol", "NOPE")
    click("market-vol-run")
    await settleOn("market-vol-refused")
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
    await settleOn("market-vol-est-garmanKlass")
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
    await settleOn("market-vol-est-realized")
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
    await settleOn("market-vol-garch")
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
    await settleOn("market-vol-atr")
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
    await settleOn("market-vol-error")
    expect(text("market-vol-error")).toContain("Yahoo Finance 404 for NOPE")
    expect(id("market-vol-result")).toBeNull()
  })

  it("renders the GARCH forecast steps, which no assertion reached", async () => {
    // `market-vol-garch-forecast` renders one row per step. The fixture has carried
    // a one-step forecast since round 0, but nothing asserted the row existed — so
    // deleting the forecast block, or rendering the steps but not their horizon,
    // would have passed.
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await settleOn("market-vol-garch")
    const rows = ids("market-vol-garch-forecast")
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain("+1 step(s)")
    expect(rows[0].textContent).toContain("0.064")
    expect(rows[0].textContent).toContain("6.4%")
  })

  it("renders NO forecast rows for a model that did not fit", async () => {
    vol.mockResolvedValue(
      volMeasured({
        garch: { ok: false, omega: null, alpha: null, beta: null, currentVol: null, forecast: [] }
      })
    )
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await settleOn("market-vol-garch")
    expect(ids("market-vol-garch-forecast")).toHaveLength(0)
  })

  it("a refusal CLEARS the previous readout rather than sitting beside it", async () => {
    render()
    type("market-vol-symbol", "EURUSD")
    click("market-vol-run")
    await settleOn("market-vol-result")

    vol.mockRejectedValue(new Error("volatility failed: 401"))
    click("market-vol-run")
    await settleOn("market-vol-error")
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
    await settleOn("market-sent-composite-absent")
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
    await settleOn("market-sent-composite")
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
    await settleOn("market-sent-news")
    expect(text("market-sent-news")).toContain("3 item(s)")
    expect(text("market-sent-news")).toContain("Reuters")
    expect(text("market-sent-news")).toContain("licence checked: no")
  })

  it("separates the time sentiment was MEASURED from the time the engine ran", async () => {
    render()
    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await settleOn("market-sent-observed")
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
    await settleOn("market-sent-head")
    expect(text("market-sent-head")).toContain("not searchable")
    expect(text("market-sent-composite-absent")).toContain("not searchable")
    expect(id("market-sent-news")).toBeNull()
    expect(text("market-sent-news-absent")).toContain("no D17 news source is configured")
    expect(id("market-sent-social")).toBeNull()
  })

  it("shows a DIVERGENT asked/answered pair on the head line, which the unsearchable path cannot prove", async () => {
    // `market-sent-head` was previously only exercised on the unsearchable path,
    // where `asked` and `symbol` are IDENTICAL BY CONSTRUCTION (`asked` is the raw
    // input and `symbol` echoes it back at `sentimentEngine.mjs:434`). So that test
    // proved the line renders; it could not prove the line distinguishes the two
    // sides. Here the engine resolved a different canonical ticker than the one
    // typed, which is the only situation the line exists to make visible.
    sent.mockResolvedValue({ ...sentMeasured, symbol: "GBPUSD" })
    render()
    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await settleOn("market-sent-head")
    expect(sent).toHaveBeenCalledWith("EURUSD")

    const head = text("market-sent-head")
    expect(head).toContain("asked for EURUSD")
    expect(head).toContain("server answered GBPUSD")
    // Each side exactly once: a swapped pair and an echo-the-server rewrite both
    // fail here.
    expect(head).not.toContain("server answered EURUSD")
    expect(head).not.toContain("asked for GBPUSD")
    expect(head.match(/EURUSD/g)).toHaveLength(1)
    expect(head.match(/GBPUSD/g)).toHaveLength(1)
    // AND the head line is not the only place the divergence shows. The readout
    // below it is still the GBPUSD reading, so a reader sees the label and the data
    // agree with each other even as the head line names the mismatch.
    expect(id("market-sent-composite")).not.toBeNull()
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
    await settleOn("market-sent-error")
    expect(text("market-sent-error")).toContain("symbol required")
    expect(id("market-sent-result")).toBeNull()
  })

  it("renders a MEASURED social leg, which no fixture reached", async () => {
    // All three sentiment fixtures set `social: null`, so `market-sent-social` was
    // rendered by nothing and its sibling `market-sent-social-absent` by everything.
    sent.mockResolvedValue({
      ...sentMeasured,
      socialUnavailableReason: null,
      composite: {
        ...sentMeasured.composite!,
        score: 0.72,
        label: "Bullish",
        extreme: false,
        weighted: { news: 0.6, social: 0.12 },
        legsPresent: ["news", "social"],
        declaredLegWeightReached: 1
      },
      social: { score: 0.12, velocity: 0.4, historySize: 9, source: "social-derived" }
    })
    render()
    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await settleOn("market-sent-social")
    const line = text("market-sent-social")
    expect(line).toContain("social-derived leg 0.12")
    expect(line).toContain("velocity 0.4")
    expect(line).toContain("9 measured composite(s)")
    // The absent branch must be GONE, not merely accompanied by the present one:
    // printing both would tell the reader the leg was measured and not measured in
    // the same breath.
    expect(id("market-sent-social-absent")).toBeNull()
    // And with both legs present the weight line reaches the full band, which is the
    // contrast the single-leg fixture establishes.
    expect(text("market-sent-weight")).toContain("reached 1 of the declared leg weight")
    expect(text("market-sent-weight")).toContain("legs present: news, social")
    expect(text("market-sent-weight")).toContain("social contribution 0.12")
    expect(text("market-sent-weight")).not.toContain("social contribution absent")
  })

  it("names the digest items that arrived without provenance and were not scored", async () => {
    // `market-sent-unprovenanced` had no fixture: every sentiment fixture set
    // `unprovenanced: []`, so the block rendered only when empty-but-present.
    sent.mockResolvedValue({
      ...sentMeasured,
      unprovenanced: ["headline with no publisher", "a second unattributed item"]
    })
    render()
    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await settleOn("market-sent-unprovenanced")
    const line = text("market-sent-unprovenanced")
    expect(line).toContain("2 digest item(s) arrived without provenance")
    expect(line).toContain("headline with no publisher")
    expect(line).toContain("a second unattributed item")
    expect(line).toContain("were not scored")
  })

  it("renders no unprovenanced block when every item was scored", async () => {
    render()
    type("market-sent-symbol", "EURUSD")
    click("market-sent-run")
    await settleOn("market-sent-composite")
    expect(id("market-sent-unprovenanced")).toBeNull()
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
    await settleOn("market-rp-result")
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
    await settleOn("market-rp-coverage")
    expect(id("market-rp-coverage-absent-none")).toBeNull()
    expect(text("market-rp-coverage-count")).not.toContain("4 of 4")
  })

  it("says so when EVERY requested symbol is present", async () => {
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await settleOn("market-rp-coverage-absent-none")
    expect(text("market-rp-coverage-count")).toContain("coverage: 2 of 2")
    expect(text("market-rp-coverage-absent-none")).toContain("every requested symbol carries a weight")
  })

  it("normalises, splits and prints each weight beside its own volatility", async () => {
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await settleOn("market-rp-weight-EURUSD")
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
    await settleOn("market-rp-count-mismatch")
    expect(text("market-rp-count-mismatch")).toContain("symbolCount 3 against 2 weight(s)")
  })

  // THE MISSPOKEN SENTENCE, CORRECTED. This line used to claim the dropped
  // symbol was "dropped from the weights without being named", while the payload
  // it was describing carries a `volStatus` state and a reason in words — so the
  // panel told an operator the mechanism was unknown in the one field that knows
  // it exactly, and `riskParity.mjs` leaned on that line to justify the ERC
  // exclusion. It renders the name now.
  it("names the measurement and the precision limit behind a dropped symbol", async () => {
    rp.mockResolvedValue(rpPrecisionDrop)
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await settleOn("market-rp-count-mismatch")
    const line = text("market-rp-count-mismatch")
    expect(line).toContain("symbolCount 2 against 1 weight(s)")
    // The dropped symbol is named, with the state that distinguishes a real
    // zero from a real figure the 4dp floor swallowed…
    expect(line).toContain("BTCUSD [measured-rounded-zero]")
    // …and the reason, in the service's own words rather than a paraphrase.
    expect(line).toContain("rounds to 0 at the published 4dp precision")
    // AND the old falsehood is gone. This is the assertion that would have
    // failed on the previous line, and it is the one worth having: a panel that
    // says a thing was unnamed while naming it is worse than one that says
    // nothing.
    expect(line).not.toMatch(/without being named/i)
    expect(line).not.toMatch(/had no usable volatility/i)
    // BTCUSD is dropped, not weighted, so it does not also appear as a holding.
    expect(ids("market-rp-weight-BTCUSD")).toHaveLength(0)
    expect(ids("market-rp-weight-EURUSD")).toHaveLength(1)
  })

  // The OTHER population, which stays honestly unnamed: a requested symbol with
  // NO `volStatus` entry at all was never measured by the allocator — the route
  // dropped its history. The panel must say that rather than implying the whole
  // gap is explained.
  it("says a requested symbol with no measurement anywhere was never seen by the allocator", async () => {
    // EURUSD weighed; ETHUSD requested, absent from `weights` AND absent from
    // `volStatus` — so the response genuinely knows nothing about it.
    rp.mockResolvedValue({
      ...rpPartial,
      weights: { EURUSD: 1 },
      vols: { EURUSD: 0.0651 },
      volStatus: { EURUSD: { state: "measured", annual: 0.0651, reason: null } }
    } as RiskParityResponse)
    render()
    type("market-rp-symbols", "EURUSD, ETHUSD")
    click("market-rp-run")
    await settleOn("market-rp-count-mismatch")
    const line = text("market-rp-count-mismatch")
    expect(line).toContain("ETHUSD")
    expect(line).toMatch(/no measurement anywhere in the response/i)
    // Not credited with a reason the payload does not carry.
    expect(line).not.toMatch(/measured-rounded-zero/)
  })

  // And when the count disagrees with NO explanation in either population — the
  // phantom-third-symbol shape the mock at the top of this describe block
  // produces — the line reports it as unattributable instead of inventing one.
  it("reports an unexplained count difference as unattributable rather than naming a cause", async () => {
    rp.mockResolvedValue({ ...rpPartial, symbolCount: 3 } as RiskParityResponse)
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await settleOn("market-rp-count-mismatch")
    expect(text("market-rp-count-mismatch")).toMatch(/cannot be attributed here/i)
  })

  it("renders the ROUTE-level refusal as a refusal and shows no allocation", async () => {
    rp.mockResolvedValue(rpRouteRefused)
    render()
    type("market-rp-symbols", "EURUSD")
    click("market-rp-run")
    await settleOn("market-rp-refused")
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
    await settleOn("market-rp-refused")
    expect(text("market-rp-refused")).toContain("no symbols with sufficient data")
    expect(text("market-rp-refused")).toContain("refused after fetching")
    expect(id("market-rp-result")).toBeNull()
  })

  it("surfaces a 502 as a refusal carrying its reason, and renders no allocation", async () => {
    rp.mockRejectedValue(new Error("watchlist unavailable"))
    render()
    type("market-rp-symbols", "EURUSD")
    click("market-rp-run")
    await settleOn("market-rp-error")
    expect(text("market-rp-error")).toContain("watchlist unavailable")
    expect(id("market-rp-result")).toBeNull()
  })

  // -------------------------------------------------------------------
  // The single-asset constant — a server 0 that is not a measurement
  // -------------------------------------------------------------------

  it("does NOT render the single-asset branch's absent portfolio vol as a measurement", async () => {
    rp.mockResolvedValue(rpSingleAsset)
    render()
    type("market-rp-symbols", "EURUSD")
    click("market-rp-run")
    await settleOn("market-rp-portfolio")

    const line = text("market-rp-portfolio")
    // THE HAZARD. `riskParity.mjs` used to return `portfolioVol: 0` as a literal
    // constant, before any covariance was built, on the one branch where a
    // fabricated "no risk" is most dangerous. Printed as a measurement beside
    // `weight 1`, it reads as "this position carries no risk".
    expect(line).not.toMatch(/portfolio vol:\s*0\b/)
    expect(id("market-rp-portfolio-absent")).not.toBeNull()
    expect(id("market-rp-portfolio-vol")).toBeNull()
    // The reason is named rather than left as a bare dash.
    expect(line).toContain("absent")
    expect(line).toContain("no covariance")
    expect(line).toContain("single-asset branch")
  })

  it("prints the single-asset asset's OWN measured vol beside its weight", async () => {
    // THE COMPANION TO THE ASSERTION ABOVE, and the reason it is no longer a
    // contradiction. The branch discards no measurement: the asset's own
    // annualized volatility is measured and printed, while the PORTFOLIO-level
    // field says it does not exist. "Not computed at this level" and "not
    // computed at all" are different facts and get different renderings.
    rp.mockResolvedValue(rpSingleAsset)
    render()
    type("market-rp-symbols", "EURUSD")
    click("market-rp-run")
    await settleOn("market-rp-weight-EURUSD")
    const weightLine = text("market-rp-weight-EURUSD")
    expect(weightLine).toContain("weight 1")
    expect(weightLine).toContain("0.0651")
    expect(weightLine).not.toContain("annual vol absent")
    // And the branch is named, so the reader can see which allocator path this is.
    expect(text("market-rp-method")).toContain("single-asset")
  })

  it("still prints an ERC portfolioVol of 0 as 0 — the gate is on method, not value", async () => {
    rp.mockResolvedValue(rpErcZero)
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await settleOn("market-rp-portfolio-vol")
    const line = text("market-rp-portfolio")
    // `equalRiskContribution` DOES compute this one (`:100`), so a 0 it serves
    // must still print as `0`. A gate written on the VALUE rather than on the
    // method would collapse it into an absence and swallow the branch's own
    // claim that it measured something. What the 0 does NOT mean — a riskless
    // measurement — is documented on the fixture; the service owns that
    // distinction, not this panel.
    expect(line).toContain("portfolio vol: 0")
    expect(line).toContain("(0%)")
    expect(line).not.toContain("absent")
    expect(id("market-rp-portfolio-absent")).toBeNull()
  })

  it("renders the ERC risk contributions, which no fixture exercised before", async () => {
    rp.mockResolvedValue(rpErcZero)
    render()
    type("market-rp-symbols", "EURUSD, BTCUSD")
    click("market-rp-run")
    await settleOn("market-rp-rc-EURUSD")
    expect(text("market-rp-method")).toContain("equal-risk-contribution")
    expect(text("market-rp-method")).toContain("500 solver iterations")
    expect(text("market-rp-rc-EURUSD")).toContain("risk contribution 50%")
    expect(text("market-rp-rc-BTCUSD")).toContain("risk contribution 50%")
  })
})

// ---------------------------------------------------------------------
// Order flow — the absence hazard
// ---------------------------------------------------------------------

describe("MarketAnalysisSection — order flow", () => {
  it("renders available:false as NOT MEASURED, with the contract's own reason", async () => {
    render()
    click("market-of-run")
    await settleOn("market-of-unavailable")
    expect(text("market-of-unavailable")).toContain("NOT MEASURED")
    expect(text("market-of-reason")).toContain("no signed-trades feed")
    expect(id("market-of-measured")).toBeNull()
  })

  it("prints the imbalance the server sent, which is 'unavailable' and never 'neutral'", async () => {
    render()
    click("market-of-run")
    await settleOn("market-of-fidelity")
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
    await settleOn("market-of-fidelity")
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
    await settleOn("market-of-measured")
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
    await settleOn("market-of-result")
    expect(of).toHaveBeenCalledWith(50)
    expect(text("market-of-lookback-echo")).toContain("lookback 20")
  })

  it("a BLANK lookback sends `undefined`, which the client omits — not a guess", async () => {
    // The behaviour the removed assertion above claimed to cover. Blank means "the
    // server's own default", and `fetchOrderFlow(undefined)` sends `{}` — no
    // `lookback` key at all. `toHaveBeenCalledWith(undefined)` requires exactly one
    // argument that is undefined, so a panel that called `of()` with no arguments,
    // or that reached for `20` itself, fails here.
    render()
    click("market-of-run")
    await settleOn("market-of-result")
    expect(of).toHaveBeenCalledTimes(1)
    expect(of).toHaveBeenCalledWith(undefined)
    expect(text("market-of-lookback-echo")).toContain("lookback 20")
  })

  it("refuses an unparseable lookback BY NAME rather than sending NaN", async () => {
    // `JSON.stringify({lookback: NaN})` is `{"lookback":null}`. So the unvalidated
    // path turned an operator's typo into a server-side null, the server echoed it
    // back unchanged (`orderFlow.mjs` never validates it), and the panel printed
    // "lookback absent" — indistinguishable from the server having no lookback at
    // all. A named refusal beats a silently-absent echo, so nothing is sent.
    render()
    type("market-of-lookback", "abc")
    click("market-of-run")
    await settleOn("market-of-error")
    expect(of).not.toHaveBeenCalled()
    const err = text("market-of-error")
    expect(err).toContain("abc")
    expect(err).toContain("not a finite number")
    // The refusal REPLACES the idle line rather than sitting beside it: "not yet
    // read" and a named refusal together would claim two different things about the
    // same panel state. And no readout is invented to fill the space.
    expect(id("market-of-idle")).toBeNull()
    expect(id("market-of-result")).toBeNull()
  })

  it("a refused lookback CLEARS a previous readout, on the panel's own rule", async () => {
    render()
    click("market-of-run")
    await settleOn("market-of-unavailable")

    type("market-of-lookback", "not-a-number")
    click("market-of-run")
    await settleOn("market-of-error")
    // The second question was refused, so the first question's answer must not
    // stand under the new label.
    expect(id("market-of-unavailable")).toBeNull()
    expect(id("market-of-result")).toBeNull()
    expect(id("market-of-measured-at")).toBeNull()
  })

  it("renders the signals a signed-trades feed would report", async () => {
    // `market-of-signal` had no fixture at all: `ofMeasuredZero` carries
    // `signals: []`, so the branch was rendered by nothing.
    of.mockResolvedValue({
      ...ofMeasuredZero,
      signals: [
        { type: "absorption", desc: "sell-side absorbed 3.1x average size at 1.0842" },
        { type: "cvd-divergence", desc: "CVD rose while price fell over the last 5 prints" }
      ]
    })
    render()
    click("market-of-run")
    await settleOn("market-of-signal")
    const rows = ids("market-of-signal")
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain("absorption")
    expect(rows[0].textContent).toContain("3.1x average size")
    expect(rows[1].textContent).toContain("cvd-divergence")
  })

  it("surfaces a 502 as a refusal carrying the upstream reason, and renders no result", async () => {
    of.mockRejectedValue(new Error("orderflow unavailable: 401"))
    render()
    click("market-of-run")
    await settleOn("market-of-error")
    expect(text("market-of-error")).toContain("401")
    expect(id("market-of-result")).toBeNull()
    expect(id("market-of-unavailable")).toBeNull()
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