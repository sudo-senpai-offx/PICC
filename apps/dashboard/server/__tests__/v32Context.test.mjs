import { describe, expect, test } from "vitest"
import { adxChop, assembleRegime, biasRegister, ema400Context, f1GateRegister, sessionClassify, structureRegister, volatilityRegime } from "../services/v32Context.mjs"
import { computeIndicatorDashboard, swingPoints } from "../services/indicators.mjs"

function trendCandles(n = 60, step = 0.2, base = 100) {
  const out = []
  for (let i = 0; i < n; i++) {
    const close = base + step * i
    out.push({ time: i * 60, open: close - step, high: close + 0.05, low: close - 0.05, close })
  }
  return out
}

describe("adxChop (REQ-CTX-1)", () => {
  test("strong trend reports trending, chop false", () => {
    const candles = trendCandles()
    const r = adxChop({ highs: candles.map((c) => c.high), lows: candles.map((c) => c.low), closes: candles.map((c) => c.close) })
    expect(r.available).toBe(true)
    expect(r.chop).toBe(false)
    expect(r.adx).toBeGreaterThan(25)
  })

  test("honest unavailable on insufficient bars", () => {
    const r = adxChop({ highs: [1, 2, 3], lows: [1, 2, 3], closes: [1, 2, 3] })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/insufficient|bars/i)
  })

  test("reuses the existing nextRegimeState latch semantics (2-bar re-arm)", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.round(Math.sin(i * 0.9) * 2)) // choppy → low ADX
    const h = closes.map((c) => c + 1)
    const lo = closes.map((c) => c - 1)
    const first = adxChop({ highs: h, lows: lo, closes, state: { chop: false, streak: 0 } })
    // then a forced good stretch re-arms after 2
    const strong = trendCandles(80)
    let st = first.nextState
    let out = null
    for (let i = 0; i < 3; i++) {
      out = adxChop({ highs: strong.map((c) => c.high), lows: strong.map((c) => c.low), closes: strong.map((c) => c.close), state: st })
      st = out.nextState
    }
    expect(out.chop).toBe(false)
  })
})

describe("structureRegister (REQ-CTX-2)", () => {
  test("honest unavailable when no candles supplied", () => {
    const r = structureRegister({ hourlyCandles: null, dailyCandles: null, price: 1.08, pipSize: 0.0001 })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/candle|structure/i)
  })

  test("honest unavailable when no price supplied", () => {
    const r = structureRegister({ hourlyCandles: null, dailyCandles: null, price: null, pipSize: 0.0001 })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/price|pipSize/i)
  })
})

describe("biasRegister (REQ-CTX-3)", () => {
  test("register-only: never a veto, always reports per-TF votes", () => {
    const candles = trendCandles(120)
    const dash = computeIndicatorDashboard(candles)
    const highs = candles.map((c) => c.high)
    const lows = candles.map((c) => c.low)
    const swings = swingPoints(highs, lows, { lookback: 2 })
    const r = biasRegister({ byTf: { 900: { dash, swings, lastIndex: candles.length - 1 } } })
    expect(r.available).toBe(true)
    expect(r.register[900]).toBeDefined()
    expect(["trend", "momentum", "structure", "volatility"]).toEqual(expect.arrayContaining(Object.keys(r.register[900])))
  })

  test("honest unavailable when no TF inputs supplied", () => {
    const r = biasRegister({ byTf: {} })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/no tf|input/i)
  })
})

describe("ema400Context (REQ-CTX-4)", () => {
  test("long-only context when price sits above the MA400 chain on D1", () => {
    const n = 500
    const closes = Array.from({ length: n }, (_, i) => 100 + 0.2 * i) // strong uptrend
    const candles = closes.map((c, i) => ({ time: i * 86400, open: c - 0.2, high: c + 0.1, low: c - 0.6, close: c }))
    const r = ema400Context({ planes: { 86400: candles }, sourceByTf: { 86400: "aggregate-plan" } })
    expect(r.available).toBe(true)
    expect(r.register[86400].longContext).toBe(true)
    expect(r.register[86400].ma400).toBeLessThan(r.register[86400].ma200)
    expect(r.register[86400].source).toBe("aggregate-plan")
    expect(r.register[86400].candles).toBe(500)
  })

  test("honest unavailable below 400 bars", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1)
    const candles = closes.map((c, i) => ({ time: i * 86400, open: c, high: c + 1, low: c - 1, close: c }))
    const r = ema400Context({ planes: { 86400: candles } })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/400/)
  })

  test("unmeasured planes are excluded, not crashed on", () => {
    const r = ema400Context({ planes: { 3600: null, 86400: undefined } })
    expect(r.available).toBe(false)
    expect(r.register).toEqual({})
    expect(r.reason).toMatch(/measurable/i)
  })
})

describe("volatilityRegime (REQ-CTX-7)", () => {
  test("HIGH regime when ATR is in the top centile → size cut", () => {
    const base = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i * 0.3) * 0.5)
    const candles = base.map((c, i) => ({ time: i * 300, open: c, high: c + (i > 110 ? 3 : 0.2), low: c - (i > 110 ? 3 : 0.2), close: c }))
    const r = volatilityRegime({ candles })
    expect(r.available).toBe(true)
    expect(r.regime).toBe("HIGH")
    expect(r.sizeCutPct).toBe(0.5)
  })

  test("LOW regime when ATR sits in the bottom centile (compression)", () => {
    const candles = Array.from({ length: 120 }, (_, i) => {
      const c = 100 + Math.sin(i * 0.3) * 0.5
      const r = i > 60 ? 0.005 : 1.5 // volatile first half, tight second half
      return { time: i * 300, open: c, high: c + r, low: c - r, close: c }
    })
    const r = volatilityRegime({ candles })
    expect(r.available).toBe(true)
    expect(r.regime).toBe("LOW")
  })

  test("honest unavailable on too few candles", () => {
    const r = volatilityRegime({ candles: [] })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/insufficient|candles/i)
  })
})

describe("sessionClassify (REQ-CTX-5)", () => {
  test("red-folder when a high-impact USD event is 10 min away", () => {
    const now = Date.UTC(2026, 8, 20, 12, 0, 0)
    const events = [
      { date: "2026-09-20", time: "12:10", currency: "USD", impact: "high", event: "FOMC" },
      { date: "2026-09-20", time: "14:00", currency: "GBP", impact: "low", event: "MPC minutes" }
    ]
    const r = sessionClassify({ tz: "UTC", start: "00:00", end: "23:59", nowMs: now, events, currencies: ["USD"], days: 7 })
    expect(r.label).toBe("red-folder")
    expect(r.source).toBe("observed")
    expect(r.blackout.blocked).toBe(true)
  })

  test("inside a closed session window → dead-zone", () => {
    const r = sessionClassify({ tz: "Europe/London", start: "07:00", end: "16:00", nowMs: Date.UTC(2026, 8, 20, 4, 0, 0), events: [], currencies: ["USD"] })
    expect(r.label).toBe("dead-zone")
    expect(r.window.ok).toBe(false)
  })

  test("fallback-schedule honesty: null events never fabricates a red-folder", () => {
    const r = sessionClassify({ tz: "UTC", start: "00:00", end: "23:59", nowMs: Date.UTC(2026, 8, 20, 12, 0, 0), events: null, currencies: ["USD"] })
    expect(r.source).toBe("fallback-schedule")
    expect(r.label).toBe("normal")
  })
})

describe("f1GateRegister (REQ-CTX-6)", () => {
  test("spread DATA-GAP (null source) → unmeasurable, gate closed", () => {
    const r = f1GateRegister({ assetId: "GBPUSD", spread: null, maxSpreadPips: 1.5, losses: [], correlations: {}, session: { ok: true }, nowMs: Date.now() })
    expect(r.checks.spread.check).toBe("unmeasurable")
    expect(r.ok).toBe(false)
  })

  test("GBPUSD pauses 15 min on a fresh EURUSD loss (correlation lock)", () => {
    const now = Date.now()
    const r = f1GateRegister({
      assetId: "GBPUSD",
      spread: { spreadPips: 1.0, source: "wired", at: now },
      maxSpreadPips: 1.5,
      losses: [{ asset: "EURUSD", ts: now - 60000 }],
      correlations: { GBPUSD: { triggers: ["EURUSD"], pauseMs: 900000 } },
      session: { ok: true },
      nowMs: now
    })
    expect(r.checks.correlation.blocked).toBe(true)
    expect(r.ok).toBe(false)
  })

  test("all four gates open → ok true with per-gate checks", () => {
    const now = Date.now()
    const r = f1GateRegister({
      assetId: "GBPUSD",
      spread: { spreadPips: 1.0, source: "wired", at: now },
      maxSpreadPips: 1.5,
      losses: [],
      correlations: { GBPUSD: { triggers: ["EURUSD"], pauseMs: 900000 } },
      session: { ok: true },
      sessionType: { label: "normal" },
      news: { blocked: false },
      nowMs: now
    })
    expect(r.ok).toBe(true)
    expect(Object.keys(r.checks)).toEqual(["session", "spread", "news", "correlation"])
  })
})

describe("assembleRegime", () => {
  test("folds all registers into one envelope with a sources honesty map", () => {
    const candles = trendCandles(120)
    const dash = computeIndicatorDashboard(candles)
    const highs = candles.map((c) => c.high)
    const lows = candles.map((c) => c.low)
    const swings = swingPoints(highs, lows, { lookback: 2 })
    const r = assembleRegime({
      byTf: { 900: { dash, swings, lastIndex: candles.length - 1 } },
      sourceByTf: {},
      planes: {},
      candles,
      nowMs: Date.now()
    })
    expect(r.registers).toBeDefined()
    expect(Object.keys(r.registers)).toContain("adx")
    expect(Object.keys(r.registers)).toContain("bias")
    expect(Object.keys(r.registers)).toContain("session")
    expect(r.f1).toBeDefined()
    expect(typeof r.at).toBe("number")
    expect(r.sources).toBeDefined()
  })
})