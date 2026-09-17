import { describe, expect, it } from "vitest"
import { detectRegime, tfSecondsOf } from "../services/regimeDetection.mjs"
import { detectRegimeEnhanced } from "../services/regimeEngine.mjs"
import { TF_SECONDS } from "../services/mtfConvergence.mjs"

// B-REG-4 — the regime-engine adapter surface (spec PICC_TRADING_SUITE_REBUILD_v1.md):
// detectRegime keeps its legacy keys byte-identical AND delegates a single-plane
// regimeEngine read, attached additively. The pre-existing regimeDetection.test.mjs
// and liveTestingPrep.test.mjs pin the legacy contract — this file pins the NEW
// additive surface.
//
// Nightly legacy fixture style mirrors regimeDetection.test.mjs (untouched).

function trendCandles(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i
    return { time: i * 60000, open: close - 1, high: close + 0.6, low: close - 0.6, close }
  })
}

function noiseCandles(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const close = i % 2 === 0 ? 100 : 101
    return { time: i * 60000, open: i % 2 === 0 ? 101 : 100, high: close + 0.5, low: close - 0.5, close }
  })
}

describe("regimeEngine delegation (B-REG-4)", () => {
  it("attachs the additive regimeEngine block while legacy keys stay identical", () => {
    const candles = trendCandles()
    const full = detectRegime(candles)
    // legacy surface unchanged (the pinned consumer contract)
    expect(full.regime).toBe("trending")
    expect(full.confidence).toBeGreaterThanOrEqual(90)
    expect(full.factors.join(" ")).toMatch(/ADX/)
    expect(full.metrics.adx).toBeGreaterThan(25)
    expect(full.suggestedStrategy).toBe("momentum")
    // additive engine block:
    expect(full.regimeEngine.source).toBe("regimeEngine")
    expect(full.regimeEngine.regime).toBe("TRENDING")
    expect(full.regimeEngine.confidence).toBe(100)
    expect(full.regimeEngine.volatile).toBe(false)
    expect(full.regimeEngine.latency.planes).toEqual([TF_SECONDS.H1])
  })

  it("the engine block is the SAME single-plane read the engine returns directly", () => {
    const candles = trendCandles()
    const engine = detectRegimeEnhanced({ planes: { [TF_SECONDS.H1]: candles }, biasTf: TF_SECONDS.H1 })
    const r = detectRegime(candles, "1H")
    expect(r.regimeEngine.regime).toBe(engine.regime)
    expect(r.regimeEngine.confidence).toBe(engine.confidence)
    expect(r.regimeEngine.perPlane[TF_SECONDS.H1].observed).toBe(engine.perPlane[TF_SECONDS.H1].observed)
    expect(r.regimeEngine.factors.join("|")).toBe(engine.factors.join("|"))
  })

  it("noisy candles: legacy says not trending; engine block says RANGING honestly", () => {
    const r = detectRegime(noiseCandles())
    expect(r.regime).not.toBe("trending")
    expect(r.regimeEngine.regime).toBe("RANGING")
    expect(r.regimeEngine.confidence).toBeGreaterThan(0)
  })

  it("insufficient candles: legacy unknown + an honest engine block (never a guess)", () => {
    const r = detectRegime(noiseCandles(29))
    expect(r.regime).toBe("unknown")
    expect(r.confidence).toBe(0)
    expect(r.factors).toEqual([])
    expect(r.regimeEngine.regime).toBe("unknown")
    expect(r.regimeEngine.confidence).toBe(0)
    expect(r.regimeEngine.reason).toContain("insufficient bars")
  })

  it("the default 1H label resolves to 3600 and drives the bias plane", () => {
    expect(tfSecondsOf("1H")).toBe(3600)
    expect(tfSecondsOf("5m")).toBe(300)
    expect(tfSecondsOf("15m")).toBe(900)
    expect(tfSecondsOf("4h")).toBe(14400)
    expect(tfSecondsOf("D1")).toBe(86400)
    expect(tfSecondsOf("1mo")).toBe(2592000)
    expect(tfSecondsOf("garbage")).toBeNull()
    expect(tfSecondsOf(undefined)).toBeNull()
  })

  it("an unknown timeframe label degrades to an unbiased single-plane read", () => {
    const r = detectRegime(trendCandles(), "quarterly")
    expect(tfSecondsOf("quarterly")).toBeNull()
    expect(r.regimeEngine.latency.planes).toEqual([60]) // neutral fallback plane key
    expect(r.regimeEngine.regime).toBe("TRENDING") // still classified, no bias weight
  })
})