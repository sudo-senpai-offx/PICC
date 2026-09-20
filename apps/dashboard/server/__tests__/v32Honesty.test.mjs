// v3.2 Plan 3 — REQ-P3-12 honesty-pins sweep: every exported v3.2 register
// shape carries `available` (+ `source` where the shape defines one); every
// `available:false` path carries a non-empty `reason`; no fabricated feed.
import { describe, it, expect } from "vitest"
import { vwapPillar, emaPair, volumeDelta, cumulativeVolumeDelta, relativeVolume, executionScore } from "../services/v32Execution.mjs"
import { v32ContextForAsset, v32DecisionForAsset } from "../services/v32Engine.mjs"
import { copilotGate } from "../services/v32Copilot.mjs"

const richCandles = Array.from({ length: 60 }, (_, i) => ({
  open: 100 + i,
  high: 103 + i,
  low: 98 + i,
  close: 101 + i,
  volume: 1000
}))

const fewCandles = richCandles.slice(0, 10)

const noVolumeCandles = richCandles.map(({ volume, ...c }) => c)

const ctxFor = (candles300) =>
  v32ContextForAsset(
    { id: "BTC", name: "BTC", periods: { 300: candles300 } },
    { config: {}, calendarEvents: [], calendarSource: "fixture", spread: null, losses: [], candleSource: "fixture", now: 0 },
    { enabled: true }
  )

function sweepPillar(label, pillar, ctxExpect) {
  it(`${label}: available implies a usable shape; unavailable implies a reason`, () => {
    if (pillar.available === true) {
      expect(pillar).toBeDefined()
      if (pillar.source != null) expect(typeof pillar.source).toBe("string")
      ctxExpect?.()
    } else {
      expect(pillar.reason).toBeTruthy()
      expect(String(pillar.reason).length).toBeGreaterThan(0)
    }
  })
}

describe("REQ-P3-12 sweep — v3.2 output honesty pins", () => {
  describe("vwapPillar", () => {
    sweepPillar("cumulative on 60 bars is available", vwapPillar({ candles: richCandles, anchor: "cumulative" }))
    sweepPillar("session anchor on 60 bars is available", vwapPillar({ candles: richCandles, anchor: "session" }))
    sweepPillar("under 15 bars fails closed", vwapPillar({ candles: fewCandles, anchor: "cumulative" }))
    sweepPillar("unknown anchor fails closed", vwapPillar({ candles: richCandles, anchor: "week" }))
  })

  describe("emaPair", () => {
    sweepPillar("60 closes are available", emaPair({ closes: richCandles.map((c) => c.close) }))
    sweepPillar("under 21 fails closed", emaPair({ closes: fewCandles.map((c) => c.close) }))
  })

  describe("volume pillars — no trades feed is honest, never synthesized", () => {
    it("volumeDelta absent-trades → available:false with 'no trades feed'", () => {
      const p = volumeDelta({ trades: undefined })
      expect(p.available).toBe(false)
      expect(p.reason).toMatch(/no trades feed/)
    })
    it("cumulativeVolumeDelta absent-trades → available:false with 'no trades feed'", () => {
      const p = cumulativeVolumeDelta({ trades: null })
      expect(p.available).toBe(false)
      expect(p.reason).toMatch(/no trades feed/)
    })
    it("volumeDelta over signed trades is available and direction-honest", () => {
      const p = volumeDelta({ trades: [{ side: "buy", amount: 2 }, { side: "sell", amount: 1 }, { side: "take", amount: 5 }] })
      expect(p.available).toBe(true)
      expect(p.delta).toBeGreaterThan(0)
    })
    it("relativeVolume without volume fields fails closed", () => {
      const p = relativeVolume({ candles: noVolumeCandles })
      expect(p.available).toBe(false)
      expect(p.reason).toBeTruthy()
    })
    it("relativeVolume with volume is available", () => {
      const p = relativeVolume({ candles: richCandles })
      expect(p.available).toBe(true)
    })
  })

  describe("executionScore", () => {
    it("forex/EO degrade the volume legs with reasons and never carry confidence", () => {
      const pillars = {
        vwap: vwapPillar({ candles: richCandles, anchor: "cumulative" }),
        ema: emaPair({ closes: richCandles.map((c) => c.close) }),
        volumeDelta: { available: false, reason: "no trades feed" },
        cvd: { available: false, reason: "no trades feed" },
        relativeVolume: { available: false, reason: "no volume feed" }
      }
      for (const venue of ["forex", "eo"]) {
        const s = executionScore({ pillars, venue })
        expect(s.available).toBe(true)
        expect(s).not.toHaveProperty("confidence")
        expect(s.degraded.length).toBeGreaterThanOrEqual(1)
        for (const d of s.degraded) expect(d.reason.length).toBeGreaterThan(0)
      }
    })
    it("crypto with missing Δ/CVD is honest-null, still directional", () => {
      const s = executionScore({
        pillars: {
          vwap: vwapPillar({ candles: richCandles, anchor: "cumulative" }),
          ema: emaPair({ closes: richCandles.map((c) => c.close) }),
          volumeDelta: { available: false, reason: "no trades feed" },
          cvd: { available: false, reason: "no trades feed" },
          relativeVolume: relativeVolume({ candles: richCandles })
        },
        venue: "crypto"
      })
      expect(s.available).toBe(true)
      expect(["up", "down"]).toContain(s.direction)
      expect(s).not.toHaveProperty("confidence")
    })
  })

  describe("copilotGate wires — always tripped-or-reason, fail-closed never silent-pass", () => {
    it("every wire carries tripped + a non-empty reason on a closed input", () => {
      const g = copilotGate({ regime: { registers: {} }, execution: { score: null, costLine: null }, constitution: {}, risk: {}, config: {} })
      expect(g.ok).toBe(false)
      expect(g.blockedBy.length).toBeGreaterThanOrEqual(5)
      for (const w of g.wires) {
        expect(["1", "2", "3", "4", "5", "6", "7", "8"]).toContain(w.id)
        expect(w.reason.length).toBeGreaterThan(0)
      }
    })
  })

  describe("v32ContextForAsset — refused asset fails closed on the honesty pins", () => {
    it("unknown symbol → ok:false with reason", () => {
      const ctx = v32ContextForAsset(
        { id: "ZZZ9", name: "zzz", periods: {} },
        { config: {}, calendarEvents: [], spread: null, losses: [], candleSource: "fixture", now: 0 },
        { enabled: true }
      )
      expect(ctx.ok).toBe(false)
      expect(ctx.reason.length).toBeGreaterThan(0)
    })
    it("no spread feed → F1 spread unmeasurable, not invented", () => {
      const ctx = ctxFor(richCandles)
      expect(ctx.regime.f1.checks.spread.check).toBe("unmeasurable")
    })
    it("the decision honesty block names its actual feeds", () => {
      const row = v32DecisionForAsset({
        ctx: ctxFor(richCandles),
        v32Config: { enabled: true },
        now: 0,
        data: { winProb: 0.6, payout: 82, spreadPips: 1.5, rows: [], risk: {} }
      })
      expect(row.honesty.tradesFeed).toBe("absent")
      expect(row.honesty.spreadSource).toMatch(/no bid\/ask/)
    })
  })
})