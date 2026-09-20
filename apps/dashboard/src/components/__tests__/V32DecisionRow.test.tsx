// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { V32DecisionRow } from "../V32DecisionRow"
import type { V32DecisionRow as Row, V32ExplainState } from "@/lib/v32"

const ROW: Row = {
  engine: "v3.2", assetId: "EURUSD", asset: "EURUSD", direction: "up", expiry: 60, ts: 100,
  score: {
    available: true, score: 0.8, direction: "up",
    pillars: [
      { pillar: "vwap", available: true, side: "above", direction: "up" },
      { pillar: "ema", available: true, aligned: "long", direction: "up" },
      { pillar: "volumeDelta", available: false, reason: "volume delta not measured (eo venue)" },
      { pillar: "cvd", available: false, reason: "not measured on eo venue" },
      { pillar: "relativeVolume", available: false, reason: "not measured on eo venue" }
    ],
    degraded: [{ pillar: "volumeDelta", reason: "volume delta not measured (eo venue)" }]
  },
  costLine: { ev: 0.14, evPerWin: null, breakevenPayout: 55, payoutBeats: true, evRR: 2.4, evRRPass: true },
  confidence: 66,
  regime: {},
  copilot: { ok: true, wires: [{ id: 1, tripped: false, reason: "ok" }], blockedBy: [] },
  verdict: "TRADE",
  gates: { score: true, costLine: true, copilot: true },
  reasons: [],
  honesty: { sampleSource: "correctlyAnsweredByEngine", spreadSource: null, calendarSource: "fallback-schedule", candleSource: "liveEO", tradesFeed: "absent" }
}

const EXPLAIN: V32ExplainState = {
  at: 100, ok: true, verdict: "TRADE", blockedBy: [],
  wires: [{ id: 1, tripped: false, reason: "ok" }],
  costLine: ROW.costLine,
  score: { available: true, score: 0.8, direction: "up" },
  regime: { adx: { available: false, chop: null }, session: { available: false, label: null } },
  risk: { dayStartBalance: null, pnl: null, proposalsToday: null },
  config: { proposalCap: 0, consecutiveLossThreshold: null }
}

describe("V32DecisionRow (Decision Register v3.2 branch)", () => {
  function render(host: HTMLDivElement) {
    const root = createRoot(host)
    flushSync(() => { root.render(<V32DecisionRow row={ROW} explain={EXPLAIN} />) })
    return () => { flushSync(() => { root.unmount() }) }
  }

  it("shows the v3.2 engine tag, five pillar glyphs and pillared score", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = render(host)
    const text = host.textContent ?? ""
    expect(text).toContain("v3.2")
    expect(text).toContain("▲")       // vwap up
    expect(text).toContain("▲")       // ema up
    expect(text).toContain("pillars 2/5")
    unmount(); document.body.removeChild(host)
  })

  it("renders the cost line: EV, EV/unit risk, and margin vs EV_RR_MIN", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = render(host)
    const text = host.textContent ?? ""
    expect(text).toContain("EV +0.14")
    expect(text).toContain("EV/RR 2.4")
    expect(text).toContain("margin ✓ (≥2)")
    unmount(); document.body.removeChild(host)
  })

  it("renders confidence, expiry and the explain verdict", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = render(host)
    const text = host.textContent ?? ""
    expect(text).toContain("66%")
    expect(text).toContain("60s")
    expect(text).toContain("TRADE")
    unmount(); document.body.removeChild(host)
  })

  it("renders a ctx-bailout row honestly: OBSERVE, no zeros, no spurious failed gates", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const bail = { engine: "v3.2", assetId: "EURUSD", verdict: "OBSERVE" } as Row
    flushSync(() => { root.render(<V32DecisionRow row={bail} explain={null} />) })
    const text = host.textContent ?? ""
    expect(text).toContain("OBSERVE")
    expect(text).toContain("not tradeable")
    expect(text).not.toContain("0/0")
    expect(text).not.toContain("✗")
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })
})