// U4FA × adaptive-confluence integration tests — spec T9 acceptances.
//
// The strategy dimension (spec M4) must leave the U4FA-OFF path byte-identical
// (regression-locked separately by adaptiveConfluence.test.mjs) and then layer
// on: the 1800 candidate only under U4FA, payout honesty for it (R5), the
// F1–F3 NEUTRAL veto, and the weight-merged confidence.
//
// Asset id is "EURUSD" everywhere so BOTH engines resolve: the confluence side
// does not care, evaluateU4FA gets a tradeable forex calibration class.
import { describe, expect, it, beforeEach } from "vitest"
import { sma } from "../services/indicators.mjs"
import {
  evaluateAsset,
  decideAssets,
  evGate,
  CANDIDATE_EXPIRIES,
  U4FA_CANDIDATE_EXPIRIES,
  U4FA_DEFAULT_WEIGHT,
  resetU4faRegimeStates
} from "../services/adaptiveConfluence.mjs"
import { U4FA_DEFAULTS, deepMergeConfig } from "../services/u4faConfig.mjs"

const NOW = Date.parse("2026-03-10T12:00:00Z") // London GMT open — F1 session passes

// ---------------------------------------------------------------------
// Confluence-side fixtures (60s bars)
// ---------------------------------------------------------------------
function confluenceTrend(bars = 240, step = 0.2, base = 100) {
  const out = []
  for (let i = 0; i < bars; i++) {
    const close = base + step * i
    const open = close - step
    out.push({ time: i * 60, open, high: close + 0.05, low: close - 0.05, close })
  }
  return out
}

function confluenceWavy(bars = 80) {
  const out = []
  for (let i = 0; i < bars; i++) {
    const close = 100 + Math.sin(i * 0.7) * 0.5 + i * 0.002
    const open = close - Math.sin(i * 0.7) * 0.1
    out.push({ time: i * 60, open, high: close + 0.1, low: close - 0.1, close })
  }
  return out
}

// ---------------------------------------------------------------------
// U4FA-side fixtures (5m bars + hourly swing floors) — copied verbatim
// from fourFactor.test.mjs so both suites assert on identical behavior.
// ---------------------------------------------------------------------
function trend5m(bars = 180, start = 1.08, perBar = 0.0001) {
  const out = []
  for (let i = 0; i < bars; i++) {
    const wobble = i < bars - 15 ? 0.0002 * Math.sin(i / 3) : 0
    const c = start + i * perBar + wobble
    const o = i === 0 ? c - perBar : out[i - 1].close
    const h = Math.max(o, c) + 0.0003
    const l = Math.min(o, c) - 0.0003
    out.push({ time: 300 * (i + 1), open: o, high: h, low: l, close: c })
  }
  return out
}

function chop5m(bars = 180, base = 1.0805, amp = 0.0005) {
  const out = []
  for (let i = 0; i < bars; i++) {
    const c = base + amp * Math.sin((i * Math.PI) / 3)
    const o = i === 0 ? base : out[i - 1].close
    const h = Math.max(o, c) + 0.0002
    const l = Math.min(o, c) - 0.0002
    out.push({ time: 300 * (i + 1), open: o, high: h, low: l, close: c })
  }
  return out
}

function sma20Of(candles) {
  const closes = candles.map((c) => c.close)
  const s = sma(closes, 20)
  return s[s.length - 1]
}

/** Bullish pin whose BODY sits fully above the 20-SMA (B2 passes). */
function pinAbove(candles = trend5m()) {
  const prior = candles.slice(0, -1)
  const base = sma20Of(prior)
  const o = base + 0.0004
  const c = o + 0.0002
  const last = { time: 300 * candles.length, open: o, high: c + 0.0005, low: o - 0.0001, close: c }
  return { candles: [...prior, last], price: c }
}

/** Bullish pin whose BODY straddles the 20-SMA (B2 fails). */
function pinStraddling(candles = trend5m()) {
  const prior = candles.slice(0, -1)
  const base = sma20Of(prior)
  const o = base - 0.0004
  const c = base - 0.0002
  const last = { time: 300 * candles.length, open: o, high: o + 0.0008, low: o - 0.0001, close: c }
  return { candles: [...prior, last], price: c }
}

/** Swing plane: every 8th bar touches `level`; 1-pip hair keeps pivots strict. */
function swingPlane({ level, kind, bars = 140, gap = 0.002, timeStep = 3600 }) {
  const out = []
  for (let i = 0; i < bars; i++) {
    const isPivot = i % 8 === 3
    const deep = i % 16 === 11
    if (kind === "floor") {
      const low = isPivot ? (deep ? level + 0.0001 : level) : level + gap
      const o = level + gap + 0.0001 * (i % 3)
      const c = o + 0.0002 * (i % 2 ? 1 : -1)
      out.push({ time: timeStep * (i + 1), open: o, high: Math.max(o, c) + 0.0002, low, close: c })
    } else {
      const high = isPivot ? (deep ? level - 0.0001 : level) : level - gap
      const o = level - gap - 0.0001 * (i % 3)
      const c = o - 0.0002 * (i % 2 ? 1 : -1)
      out.push({ time: timeStep * (i + 1), open: o, high, low: Math.min(o, c) - 0.0002, close: c })
    }
  }
  return out
}

/** Hourly floor positioned `offsetPips` below `price`. */
function floorFor(price, offsetPips, bars = 140) {
  return swingPlane({ level: price - offsetPips * 0.0001, kind: "floor", bars })
}

// ---------------------------------------------------------------------
// Strategy row builder (the object decideAssets would attach)
// ---------------------------------------------------------------------
function u4faStrategyOn(over = {}) {
  const pin = over.candles == null ? pinAbove() : null
  const candles = over.candles ?? pin.candles
  const price = over.price ?? candles[candles.length - 1].close
  return {
    u4fa: {
      enabled: true,
      candles,
      hourlyCandles: over.hourlyCandles ?? floorFor(price, over.floorPips ?? 6),
      dailyCandles: null,
      calendarEvents: [],
      calendarSource: "fixture",
      spread: over.spread !== undefined ? over.spread : { spreadPips: 1.2, source: "fixture" },
      losses: [],
      config: U4FA_DEFAULTS,
      regimeState: over.regimeState ?? { chop: false, streak: 0 },
      weight: over.weight ?? U4FA_DEFAULT_WEIGHT,
      candleSource: "fixture",
      now: NOW
    }
  }
}

function runAsset({ strategies = null, observedPayout = null, candles = confluenceTrend(), now = NOW } = {}) {
  return evaluateAsset({ id: "EURUSD", name: "EUR / USD", candles, volume: {}, observedPayout, now, strategies })
}

describe("M4 — OFF path lock (T9 acceptance #1)", () => {
  it("U4FA OFF is byte-identical to no-strategies and carries the disabled shape", () => {
    const plain = runAsset()
    const off = runAsset({ strategies: { u4fa: { enabled: false } } })
    expect(off).toEqual(plain)
    expect(plain.verdict).toBe("TRADE")
    expect(plain.strategies.u4fa).toEqual({ enabled: false })
    expect(plain.strategies.u4fa.result).toBeUndefined()
    expect(plain.payoutSource).toBe("assumed")
  })

  it("1800 is gated behind the U4FA candidate set, never the OFF candidate set", () => {
    expect(CANDIDATE_EXPIRIES).not.toContain(1800)
    expect(U4FA_CANDIDATE_EXPIRIES).toContain(1800)
    expect(U4FA_CANDIDATE_EXPIRIES[U4FA_CANDIDATE_EXPIRIES.length - 1]).toBe(1800)
  })
})

describe("M4 — U4FA TRADE merged onto a confluence TRADE", () => {
  it("stays TRADE, attaches the full U4FA result, veto off; confidence merges by weight", () => {
    const dOff = runAsset()
    const dZero = runAsset({ strategies: u4faStrategyOn({ weight: 0 }) }) // neutral merge control
    const dOn = runAsset({ strategies: u4faStrategyOn({ weight: U4FA_DEFAULT_WEIGHT }) })

    // weight 0 == no change to any confluence field, but the strategy attaches
    expect(dZero.verdict).toBe("TRADE")
    expect(dZero.expiry).toBe(dOff.expiry)
    expect(dZero.confidence).toBe(dOff.confidence)
    expect(dZero.strategies.u4fa.enabled).toBe(true)

    expect(dOn.verdict).toBe("TRADE")
    expect(dOn.confidence).toBe(Math.min(92, dZero.confidence + 40)) // signal +1 * weight 0.4
    expect(dOn.strategies.u4fa.signalStrength).toBe(1)
    expect(dOn.strategies.u4fa.vetoApplied).toBe(false)
    expect(dOn.strategies.u4fa.veto).toBeNull()
    expect(dOn.strategies.u4fa.result.verdict).toBe("TRADE")
    expect(dOn.strategies.u4fa.result.direction).toBe("up")
    expect(dOn.strategies.u4fa.result.factors.f4.passed).toBeGreaterThanOrEqual(2)
    expect(dOn.strategies.u4fa.result.honesty.spreadSource).toBe("fixture")
    expect(dOn.strategies.u4fa.result.honesty.structureSource).toBe("aggregate-h4")
    expect(dOn.reasons.some((r) => r.includes("U4FA strategy: verdict TRADE"))).toBe(true)
  })

  it("U4FA OBSERVE is NOT a veto — signal +0.5 → +20 confidence, TRADE preserved", () => {
    const dZero = runAsset({ strategies: u4faStrategyOn({ weight: 0 }) })
    const straddle = pinStraddling()
    const dOn = runAsset({ strategies: u4faStrategyOn({ candles: straddle.candles, price: straddle.price }) })

    expect(dOn.strategies.u4fa.result.verdict).toBe("OBSERVE") // 1/3 boosters, no majority
    expect(dOn.verdict).toBe("TRADE") // OBSERVE has no veto power
    expect(dOn.strategies.u4fa.vetoApplied).toBe(false)
    expect(dOn.strategies.u4fa.signalStrength).toBe(0.5)
    expect(dOn.confidence).toBe(Math.min(92, dZero.confidence + 20))
  })

  it("U4FA NEUTRAL from an unmeasurable spread vetoes the confluence TRADE to OBSERVE", () => {
    const d = runAsset({ strategies: u4faStrategyOn({ spread: null }) })

    expect(d.strategies.u4fa.result.verdict).toBe("NEUTRAL")
    expect(d.strategies.u4fa.result.factors.f1.checks.spread).toBe("unmeasurable")
    expect(d.strategies.u4fa.result.honesty.spreadSource).toBeNull()
    expect(d.strategies.u4fa.vetoApplied).toBe(true)
    expect(d.strategies.u4fa.veto).toMatch(/F1–F3 NO_TRADE/)
    expect(d.strategies.u4fa.signalStrength).toBe(-0.5)
    expect(d.verdict).toBe("OBSERVE") // confluence TRADE was demoted, never elevated
    // Every candidate took the -20 NEUTRAL merge, so the reported confidence can
    // no longer sit at the 92 ceiling (the OBSERVE winner is the 1800 row here —
    // highest |winProb-0.5|, see the rank comparator — so no exact delta is claimed).
    expect(d.confidence).toBeLessThan(92)
    expect(d.confidence).toBeGreaterThanOrEqual(45)
    expect(d.reasons.some((r) => r.includes("U4FA VETO"))).toBe(true)
  })

  it("Regime-3 Chop also vetoes, and the reason names the chop latch", () => {
    const chop = chop5m()
    const d = runAsset({ strategies: u4faStrategyOn({ candles: chop, price: chop[chop.length - 1].close }) })

    expect(d.strategies.u4fa.result.verdict).toBe("NEUTRAL")
    expect(d.strategies.u4fa.result.factors.f3.chop).toBe(true)
    expect(d.strategies.u4fa.result.regime.chop).toBe(true)
    expect(d.strategies.u4fa.vetoApplied).toBe(true)
    expect(d.verdict).toBe("OBSERVE")
    expect(d.reasons.some((r) => r.includes("chop true"))).toBe(true)
  })
})

describe("M4 — 1800 candidate payout honesty (spec R5)", () => {
  it("an unknown payout can never clear the payout gate — even at winProb 0.9", () => {
    const g = evGate({ winProb: 0.9, payoutPct: null })
    expect(g.payoutBeats).toBe(false)
    expect(g.evRRPass).toBe(false)
    expect(g.ev).toBeNull()
  })

  it("with the 900 payout degraded and 1800 unobserved, nothing trades", () => {
    // Payout 1: below the breakeven margin EVEN at ~1.0 winProb (~1.7% threshold),
    // so 60/120/300/900 all fail the payout gate; 1800 has no observed deal ->
    // payout null + payoutSource "unavailable" -> gates.payout false. Nothing
    // in the candidate space can rank TRADE.
    const observed = { "EURUSD:60": 1, "EURUSD:120": 1, "EURUSD:300": 1, "EURUSD:900": 1 }
    const d = runAsset({ strategies: u4faStrategyOn(), observedPayout: observed })
    expect(d.verdict).not.toBe("TRADE")
  })

  it("an observed 1800 demo payout makes the 30-min candidate tradeable and labelled", () => {
    const observed = { "EURUSD:60": 30, "EURUSD:120": 30, "EURUSD:300": 30, "EURUSD:900": 42, "EURUSD:1800": 88 }
    const d = runAsset({ strategies: u4faStrategyOn(), observedPayout: observed })
    expect(d.verdict).toBe("TRADE")
    expect(d.expiry).toBe(1800)
    expect(d.payout).toBe(88)
    expect(d.payoutSource).toBe("observed")
    expect(d.gates.payout).toBe(true)
  })
})

describe("M4 — composite gates stay on top (G3)", () => {
  it("a confluence NEUTRAL/OBSERVE is not rescued by a U4FA TRADE vote", () => {
    const d = runAsset({ candles: confluenceWavy(), strategies: u4faStrategyOn() })
    expect(d.strategies.u4fa.result.verdict).toBe("TRADE") // U4FA says go...
    expect(d.verdict).not.toBe("TRADE") // ...but the confluence composite gate still refuses
    expect(d.strategies.u4fa.vetoApplied).toBe(false)     // (and this was not a veto)
  })
})

describe("M4 — decideAssets runtime plumbing (context, regime latch, per-asset control)", () => {
  beforeEach(() => resetU4faRegimeStates())

  function runtimeContext() {
    return {
      config: deepMergeConfig(U4FA_DEFAULTS, { assets: { EURUSD: { u4fa: { enabled: true } } } }),
      calendarEvents: [],
      calendarSource: "fixture",
      spread: { spreadPips: 1.2, source: "ctx-fixture" },
      losses: [],
      candleSource: "fixture"
    }
  }

  function dataWith(periods300) {
    const price = periods300[periods300.length - 1].close
    return { assets: [{ id: "EURUSD", name: "EUR / USD", periods: { 60: confluenceTrend(), 300: periods300, 3600: floorFor(price, 6) }, ticks: {} }] }
  }

  it("enabled assets run U4FA inside the engine and the regime latch persists across cycles", async () => {
    // Four in-memory decideAssets passes (fixture data, pure CPU, no I/O) are
    // microseconds of work, but the suite runs 3 workers of heavy files (5-11s
    // candle/order suites) concurrently on shared cores; the default 5s raw
    // ceiling starved this test by ~150ms in a full-suite run. 15s keeps the
    // budget honest for contention without hiding a real regression.
    const pin = pinAbove()
    const d1 = (await decideAssets({ data: dataWith(pin.candles), observedPayout: {}, now: NOW, u4faContext: runtimeContext() }))[0]
    expect(d1.verdict).toBe("TRADE")
    expect(d1.strategies.u4fa.enabled).toBe(true)
    expect(d1.strategies.u4fa.result.verdict).toBe("TRADE")
    expect(d1.strategies.u4fa.vetoApplied).toBe(false)

    // chop 300s buffer trips the latch -> U4FA NEUTRAL -> veto -> no TRADE
    const chop = chop5m()
    const d2 = (await decideAssets({ data: dataWith(chop), observedPayout: {}, now: NOW, u4faContext: runtimeContext() }))[0]
    expect(d2.verdict).toBe("OBSERVE")
    expect(d2.strategies.u4fa.result.regime.chop).toBe(true)
    expect(d2.strategies.u4fa.vetoApplied).toBe(true)

    // first clean reading after chop still halts (post-chop recovery 1/2 confirmations)
    const d3 = (await decideAssets({ data: dataWith(pin.candles), observedPayout: {}, now: NOW, u4faContext: runtimeContext() }))[0]
    expect(d3.verdict).toBe("OBSERVE")
    expect(d3.strategies.u4fa.result.regime).toMatchObject({ chop: true, streak: 1 })

    // second consecutive clean reading re-arms -> TRADE resumes
    const d4 = (await decideAssets({ data: dataWith(pin.candles), observedPayout: {}, now: NOW, u4faContext: runtimeContext() }))[0]
    expect(d4.verdict).toBe("TRADE")
    expect(d4.strategies.u4fa.result.regime).toMatchObject({ chop: false, streak: 0 })
  }, 15000)

  it("assets not opted-in stay OFF (no U4FA result attached)", async () => {
    const data = {
      assets: [
        { id: "EURUSD", name: "EUR / USD", periods: { 60: confluenceTrend() }, ticks: {} },
        { id: "BTCUSD", name: "BTC / USD", periods: { 60: confluenceTrend() }, ticks: {} }
      ]
    }
    const out = await decideAssets({ data, observedPayout: {}, now: NOW, u4faContext: runtimeContext() })
    expect(out.length).toBe(2)
    const btc = out.find((dd) => dd.assetId === "BTCUSD")
    expect(btc.verdict).toBe("TRADE") // confluence works exactly as before
    expect(btc.strategies.u4fa.enabled).toBe(false)
    expect(btc.strategies.u4fa.result).toBeUndefined()
  })

  it("a thin 5m buffer vetoes honestly through insufficient-history, not a guess", async () => {
    const thin = trend5m().slice(0, 45) // < MIN_5M_BARS
    const d = (await decideAssets({ data: dataWith(thin), observedPayout: {}, now: NOW, u4faContext: runtimeContext() }))[0]
    expect(d.strategies.u4fa.enabled).toBe(true)
    expect(d.strategies.u4fa.result.verdict).toBe("NEUTRAL")
    expect(d.strategies.u4fa.result.reasons.some((r) => r.includes("insufficient 5m history"))).toBe(true)
    expect(d.strategies.u4fa.vetoApplied).toBe(true)
    expect(d.verdict).toBe("OBSERVE")
  })
})