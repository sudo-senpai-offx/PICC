// T12/M8 — `type:"u4fa"` payload schema + SSE emission contract pins.
//
// The payloads below are byte-identical captures of the REAL producer
// (evaluateU4FA via evaluateAsset on these fixtures — froze at 2026-08-31, spec
// M8). A missing/renamed/drifted field fails the deep toEqual loudly, exactly
// like the multisource T9 contract locks: the pin is the guarantee, not the
// producer. The ABORT pin holds the honesty contract: an unmeasurable spread
// stays `"unmeasurable"` in f1.checks, `spreadSource: null`, and never a
// numeric estimate.
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sma } from "../services/indicators.mjs"
import {
  evaluateAsset,
  u4faEventFromDecision,
  emitU4faEvents,
  subscribeU4faEvents,
  stopDecisionEngine,
  U4FA_DEFAULT_WEIGHT
} from "../services/adaptiveConfluence.mjs"
import { U4FA_DEFAULTS } from "../services/u4faConfig.mjs"

const NOW = Date.parse("2026-03-10T12:00:00Z") // London GMT open — F1 session passes

// ---------------------------------------------------------------------
// U4FA-side fixtures (5m bars + hourly swing floors) — copied verbatim
// from fourFactor.test.mjs / adaptiveConfluence.u4fa.test.mjs so all three
// suites assert on identical producer behavior.
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

function sma20Of(candles) {
  const s = sma(candles.map((c) => c.close), 20)
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

function confluenceTrend(bars = 240, step = 0.2, base = 100) {
  const out = []
  for (let i = 0; i < bars; i++) {
    const close = base + step * i
    const open = close - step
    out.push({ time: i * 60, open, high: close + 0.05, low: close - 0.05, close })
  }
  return out
}

/** Strategy row builder (the object decideAssets would attach). */
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

function runAsset({ strategies = null, candles = confluenceTrend(), now = NOW } = {}) {
  return evaluateAsset({ id: "EURUSD", name: "EUR / USD", candles, volume: {}, observedPayout: null, now, strategies })
}

// ---------------------------------------------------------------------
// Frozen M8 payloads (real producer, spec M8). Do NOT "normalize" any
// number below — the pin must match the producer byte-for-byte.
// ---------------------------------------------------------------------
const PASS_EVENT = {
  type: "u4fa",
  ts: 1773144000000,
  assetId: "EURUSD",
  style: "2",
  direction: "up",
  verdict: "TRADE",
  expiry: 900,
  factors: {
    f1: {
      pass: true,
      checks: { session: "open", spread: "ok", news: "clear", correlation: "clear" },
      details: {
        session: {
          wall: "12:00",
          tz: "Europe/London",
          window: { tz: "Europe/London", start: "07:00", end: "16:00", label: "blueprint 07:00-16:00 GMT, IANA wall-clock (DST-aware)" }
        },
        spread: { spreadPips: 1.2, reason: "spread 1.2 pips <= 1.5" },
        news: { hits: [], blocked: false },
        correlation: { triggeredBy: null, at: null, label: "static config, not measured covariance" }
      }
    },
    f2: {
      pass: true,
      structure: { tf: 14400, side: "support", level: 1.096829, distancePips: 6.0003, tolerancePips: 10, trigger: "pin-bar" },
      legs: {
        h4: {
          available: true,
          source: "aggregate-h4",
          levelCount: 1,
          closestSupport: { level: 1.096829, distancePips: 6.0002782525003795, touches: 8 },
          closestResistance: null,
          supportHit: true,
          resistanceHit: false,
          supportDistancePips: 6.0002782525003795,
          resistanceDistancePips: null
        },
        d1: {
          available: false,
          source: "none",
          reason: "no daily candles supplied (D1 = Yahoo EOD only; not derivable from live buffers)"
        }
      },
      trigger: { trigger: "pin-bar", pinBar: true, smaBreak: false },
      reasons: []
    },
    f3: {
      pass: true,
      adx: 97.53764716117749,
      adxThreshold: 25,
      ema50Side: "above",
      ema50Slope: 0.000481,
      ema50SlopeLookback: 5,
      chop: false,
      streak: 0,
      confirmBars: 2,
      reason: "EMA50 aligned (slope 0.00048, price above)"
    },
    f4: {
      boosters: [2, 3],
      passed: 2,
      required: 2,
      detail: { stochCross: false, candle20Sma: true, bbExhaustion: "ignored-adx>30" }
    }
  },
  regime: { adx: 97.54, adxThreshold: 25, phase: "trend", pccPhase: "trend", chop: false, streak: 0, atrPct: "0.064" },
  timing: { mode: "immediate", atMs: 1773144000000, note: "ADX > 30 — enter at confirmation candle close" },
  indicators: {
    close: 1.09742902782525,
    ema50: 1.095432,
    adx: 97.54,
    bb: { upper: 1.098055, mid: 1.096902, lower: 1.095748, percentB: 0.7287 },
    stochRsi: { k: 33.33, d: 44.44 }
  },
  risk: { riskPct: 0.5, dailyLossLimitPct: 5, maxDailyTrades: 10 },
  compliance: { requiresHumanApproval: true, proposalId: null },
  honesty: { spreadSource: "fixture", structureSource: "aggregate-h4", calendarSource: "fixture", candleSource: "fixture" }
}

// ---------------------------------------------------------------------

describe("M8 — the type:u4fa payload is exactly the M8 schema", () => {
  it("exposes exactly the M8 top-level fields and honesty keys", () => {
    expect(Object.keys(PASS_EVENT).sort()).toEqual([
      "assetId", "compliance", "direction", "expiry", "factors", "honesty",
      "indicators", "regime", "risk", "style", "timing", "ts", "type", "verdict"
    ])
    expect(Object.keys(PASS_EVENT.honesty).sort()).toEqual([
      "calendarSource", "candleSource", "spreadSource", "structureSource"
    ])
    expect(PASS_EVENT.type).toBe("u4fa")
    expect(PASS_EVENT.compliance.requiresHumanApproval).toBe(true)
  })

  it("pins the full TRADE path payload byte-identically to the real producer", () => {
    const d = runAsset({ strategies: u4faStrategyOn() })
    expect(d.verdict).toBe("TRADE")
    expect(u4faEventFromDecision(d, { ts: NOW })).toEqual(PASS_EVENT)
  })

  it("the decision API carries the same body under strategies.u4fa.result", () => {
    const d = runAsset({ strategies: u4faStrategyOn() })
    const wrapperKeys = Object.keys(d.strategies.u4fa).sort()
    expect(wrapperKeys).toEqual(["enabled", "result", "signalStrength", "veto", "vetoApplied", "weight"])
    expect(d.strategies.u4fa.enabled).toBe(true)
    expect(d.strategies.u4fa.weight).toBe(U4FA_DEFAULT_WEIGHT)
    // API result body == M8 event body (minus the type/ts envelope; plus the
    // engine-only reasons + regimeState latch, which never leave the server).
    const { reasons, regimeState, ...rest } = d.strategies.u4fa.result
    const { type, ts, ...eventRest } = PASS_EVENT
    expect(rest).toEqual(eventRest)
    expect(reasons.some((r) => r.includes("decision support only"))).toBe(true)
    expect(typeof regimeState).toBe("object")
    expect(regimeState).toEqual({ chop: false, streak: 0, rearmed: false })
  })
})

describe("M8 — spread-abort payloads carry the honesty contract", () => {
  it("an unmeasurable spread is a real probe result: 'unmeasurable', source null, never numeric", () => {
    const d = runAsset({ strategies: u4faStrategyOn({ spread: null }) })
    const event = u4faEventFromDecision(d, { ts: NOW })
    expect(event.verdict).toBe("NEUTRAL")
    expect(event.factors.f1.pass).toBe(false)
    expect(event.factors.f1.checks.spread).toBe("unmeasurable")
    expect(event.honesty.spreadSource).toBeNull()
    // every other F1 check is still observed and named
    expect(event.factors.f1.checks).toEqual({ session: "open", spread: "unmeasurable", news: "clear", correlation: "clear" })
    // no numeric estimate anywhere — neither the details block nor the raw JSON
    expect(event.factors.f1.details.spread).toEqual({ spreadPips: null, reason: "spread unmeasurable — no bid/ask source" })
    expect(JSON.stringify(event)).not.toMatch(/"spreadPips":\d/)
    // F4 never runs past a failed F1
    expect(event.factors.f4).toBeNull()
    expect(event.compliance.proposalId).toBeNull()
  })
})

describe("M8 — compliance.proposalId mirrors the trade gate at emit time", () => {
  it("null when nothing is pending; the gate id when a proposal exists for the symbol", () => {
    const d = runAsset({ strategies: u4faStrategyOn() })
    expect(u4faEventFromDecision(d, { ts: NOW }).compliance.proposalId).toBeNull()
    expect(u4faEventFromDecision(d, { ts: NOW, proposalMap: { XAUUSD: "prop-x" } }).compliance.proposalId).toBeNull()
    expect(u4faEventFromDecision(d, { ts: NOW, proposalMap: { EURUSD: "prop-7" } }).compliance.proposalId).toBe("prop-7")
    // matches by any of the decision's symbol aliases, incl. the canonical assetId
    expect(u4faEventFromDecision(d, { ts: NOW, proposalMap: { "EUR / USD": "prop-9" } }).compliance.proposalId).toBe("prop-9")
    expect(u4faEventFromDecision(d, { ts: NOW, proposalMap: { EURUSD: "prop-9" } }).compliance.proposalId).toBe("prop-9")
  })
})

describe("M8 — emission rides the decision tick, one event per enabled decision", () => {
  beforeEach(() => stopDecisionEngine())

  it("never lifts a decision without an enabled U4FA result", () => {
    expect(u4faEventFromDecision(runAsset(), { ts: NOW })).toBeNull() // no strategy at all
    const off = runAsset({ strategies: { u4fa: { enabled: false } } })
    expect(u4faEventFromDecision(off, { ts: NOW })).toBeNull()
    expect(off.strategies.u4fa).toEqual({ enabled: false })
  })

  it("delivers exactly one type:u4fa event per enabled decision to subscribers", () => {
    const pass = runAsset({ strategies: u4faStrategyOn() })
    const off = runAsset({ strategies: { u4fa: { enabled: false } } })
    const seen = []
    const unsubscribe = subscribeU4faEvents((m) => seen.push(m))
    emitU4faEvents([pass, off], { ts: NOW, proposalMap: { EURUSD: "prop-1" } })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({ ...PASS_EVENT, compliance: { requiresHumanApproval: true, proposalId: "prop-1" } })
    unsubscribe()
  })

  it("stops delivery after unsubscribe", () => {
    const pass = runAsset({ strategies: u4faStrategyOn() })
    const seen = []
    const unsubscribe = subscribeU4faEvents((m) => seen.push(m))
    unsubscribe()
    emitU4faEvents([pass], { ts: NOW })
    expect(seen).toHaveLength(0)
  })
})