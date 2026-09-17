// @vitest-environment jsdom
// B-FUS-3 — the client side of the documentary fusion layers (spec
// PICC_TRADING_SUITE_REBUILD_v1.md, "B-FUS-3 - client type + card"):
//   • a layered report renders the regime + MTF layer rows with the honest
//     "documentary · evidence only" tag (weight:0 groups never move the score),
//   • a layer group with no observable input renders "documentary · no
//     directional evidence" — never a fake read, never an empty 0.00-only row,
//   • legacy fixtures (3 groups, no observed/source fields) still render —
//     the new fields are optional, and confluence.verdict consumers (header
//     tone/verdict) are untouched.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import type { ProAnalysisResult } from "@/lib/trading"

vi.mock("@/lib/trading", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trading")>()
  return { ...actual, proAnalyzeSymbol: vi.fn(), proAnalyze: vi.fn() }
})

import { proAnalyzeSymbol } from "@/lib/trading"
import { ProAnalysisCard } from "@/components/TradingSuite"

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<ProAnalysisCard />) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

function clickYahoo(host: HTMLElement) {
  const btn = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Pro analyze (Yahoo)"))
  if (!btn) throw new Error("Pro analyze (Yahoo) button not found")
  flushSync(() => { btn.click() })
}

const phase = {
  phase: "trend",
  label: "Trend",
  quadrant: "Q1",
  trend: "up",
  trendStrength: 1,
  trendStrengthLabel: "strong",
  volatility: "low",
  volatilityPercentile: 40,
  bandwidthPercentile: 30,
  squeeze: false,
  expanding: false,
  regressionR2: 0.8,
  persistence: 0.5,
  persistenceLabel: "persistent",
  alligator: "aligned",
  strategy: {}
}

const evidence = (name: string, read: string, source?: string) => ({
  name, value: null, read, bull: source ? 0.9 : 0.5, weight: 1, source
})

/** Layered B-FUS report: 3 classic groups + regime layer + MTF layer. */
const layeredReport: ProAnalysisResult = {
  ok: true,
  platform: "Yahoo",
  symbol: "TEST",
  name: "Test",
  currency: "USD",
  timeframe: "1d",
  bars: 400,
  last: 222,
  bias: { direction: "up", ltf: "up", htf: "up", aligned: true },
  confluence: {
    score: 0.42,
    direction: "up",
    confidence: 68,
    confidenceNotes: [],
    verdict: "BUY",
    groups: [
      { id: "trend", name: "Trend & Structure", weight: 0.45, score: 0.5, evidence: [evidence("Regression slope", "slope 0.12%/bar")] },
      { id: "momentum", name: "Momentum & Strength", weight: 0.35, score: 0.4, evidence: [evidence("RSI(14)", "58.00")] },
      { id: "volatility", name: "Volatility & Cycle", weight: 0.2, score: 0.2, evidence: [evidence("Persistence", "0.05")] },
      {
        id: "regimeLayer", name: "Regime layer", weight: 0, score: 0.9, observed: true,
        evidence: [
          evidence("regime 1d", "TRENDING · conf 90% · votes 2t/0r · lean up", "regimeEngine"),
          evidence("regime 5d", "TRENDING · conf 90% · votes 2t/0r · lean up", "regimeEngine")
        ]
      },
      {
        id: "mtfLayer", name: "MTF layer", weight: 0, score: 1, observed: true,
        evidence: [evidence("mtf 1d", "long 1d · composite LONG · LONG BIAS · score5 5/5 · quality 10/10", "liveEO-buffers")]
      }
    ],
    reasoning: []
  },
  phase
}

/** Legacy report: only the classic groups, no observed/source optional fields. */
const legacyReport: ProAnalysisResult = {
  ok: true,
  platform: "Yahoo",
  symbol: "LEG",
  name: "Legacy",
  currency: "USD",
  timeframe: "1d",
  bars: 400,
  last: 100,
  bias: { direction: "flat", ltf: "flat", htf: "n/a", aligned: false },
  confluence: {
    score: -0.1,
    direction: "flat",
    confidence: 51,
    confidenceNotes: [],
    verdict: "NEUTRAL",
    groups: [
      { id: "trend", name: "Trend & Structure", weight: 0.45, score: -0.1, evidence: [evidence("Regression slope", "slope -0.01%/bar")] },
      { id: "momentum", name: "Momentum & Strength", weight: 0.35, score: -0.1, evidence: [evidence("RSI(14)", "49.00")] },
      { id: "volatility", name: "Volatility & Cycle", weight: 0.2, score: -0.1, evidence: [evidence("Persistence", "0.01")] }
    ],
    reasoning: []
  },
  phase
}

/** Honest-emptiness report: layers present but with no observable input. */
const emptyLayersReport: ProAnalysisResult = {
  ...layeredReport,
  confluence: {
    ...layeredReport.confluence!,
    groups: [
      ...layeredReport.confluence!.groups.slice(0, 3),
      { id: "regimeLayer", name: "Regime layer", weight: 0, score: 0, observed: false, evidence: [] },
      { id: "mtfLayer", name: "MTF layer", weight: 0, score: 0, observed: false, evidence: [] }
    ]
  }
}

describe("ProAnalysisCard fusion layers (B-FUS-3)", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    mounted = []
    vi.mocked(proAnalyzeSymbol).mockReset()
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
    vi.restoreAllMocks()
  })

  it("renders the 5-group matrix — regime + MTF layer rows with the evidence-only tag", async () => {
    vi.mocked(proAnalyzeSymbol).mockResolvedValue(layeredReport)
    const { host, unmount } = mount()
    mounted.push({ unmount })
    clickYahoo(host)

    await waitFor(() => host.textContent?.includes("Regime layer") ?? false, "regime layer row")
    const text = host.textContent ?? ""
    // All five group rows render, classic first, documentary layers included.
    for (const name of ["Trend & Structure", "Momentum & Strength", "Volatility & Cycle", "Regime layer", "MTF layer"]) {
      expect(text).toContain(name)
    }
    // Documentary rows carry the tag; classic rows never do.
    expect(text).toContain("documentary · evidence only")
    expect(text).toContain("regime 1d")
    expect(text).toContain("composite LONG")
    // Verdict consumers are untouched: the header still reads the verdict +
    // the classic score stat is present, and the weight-0 layers change nothing.
    expect(text).toContain("TEST → BUY")
    expect(text).toContain("Confluence score")
    expect(text).toContain("+0.42")
  })

  it("empty layers render the honest 'no directional evidence' state, not a fake read", async () => {
    vi.mocked(proAnalyzeSymbol).mockResolvedValue(emptyLayersReport)
    const { host, unmount } = mount()
    mounted.push({ unmount })
    clickYahoo(host)

    await waitFor(() => host.textContent?.includes("Regime layer") ?? false, "regime layer row")
    const text = host.textContent ?? ""
    expect(text).toContain("documentary · no directional evidence")
    expect(text).not.toContain("documentary · evidence only")
    // No fabricated evidence lines and the layered reports keeps its verdict.
    expect(text).not.toContain("TRENDING · conf")
    expect(text).toContain("TEST → BUY")
  })

  it("legacy 3-group fixtures still render — the new fields are optional and verdict consumers unchanged", async () => {
    vi.mocked(proAnalyzeSymbol).mockResolvedValue(legacyReport)
    const { host, unmount } = mount()
    mounted.push({ unmount })
    clickYahoo(host)

    await waitFor(() => host.textContent?.includes("Momentum & Strength") ?? false, "legacy group rows")
    const text = host.textContent ?? ""
    for (const name of ["Trend & Structure", "Momentum & Strength", "Volatility & Cycle"]) {
      expect(text).toContain(name)
    }
    expect(text).not.toContain("Regime layer")
    expect(text).not.toContain("MTF layer")
    expect(text).not.toContain("documentary")
    expect(text).toContain("LEG → NEUTRAL")
    expect(text).not.toContain("Something went wrong")
  })
})