// U4FA pure factor engine tests — spec T3..T8 acceptances.
//
// All fixtures are synthetic candles (no network, no live layer). Deterministic
// plane fixtures ("floor"/"ceiling" swing levels) let the F2 structure leg be
// asserted to the pip: troughs every 8th bar sit exactly at `floor`, so the
// supportResistance cluster is at `floor` and distance from `price` is exact.
import { describe, expect, it } from "vitest"
import { sma } from "../services/indicators.mjs"
import {
  sessionInWindow,
  nextBarAtMs,
  blackoutViolations,
  spreadGateF1,
  correlationBlocked,
  resolveStructureLevels,
  pinBarHit,
  triggerFromCandle,
  boosterB1,
  boosterB2,
  boosterB3,
  nextRegimeState,
  timingRecommendation,
  evaluateU4FA,
  MIN_5M_BARS
} from "../services/fourFactor.mjs"
import { U4FA_DEFAULTS, deepMergeConfig, resolveAssetConfig } from "../services/u4faConfig.mjs"

// ---------------------------------------------------------------------
// Candle fixtures
// ---------------------------------------------------------------------
/** Monotonic uptrend (clean last stretch so stochRSI %K pins high — B1 stays off). */
function trendCandles(bars = 180, start = 1.08, perBar = 0.0001) {
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

/** Chop / ranging 5m series — ADX well under any threshold. */
function chopCandles(bars = 180, base = 1.0805, amp = 0.0005) {
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

/**
 * Replace the last candle with a bullish pin whose BODY sits fully above the
 * 20-SMA of the preceding closes (B2 passes; price = the pin candle's close).
 */
function trendWithPinAbove(candles = trendCandles()) {
  const prior = candles.slice(0, -1)
  const base = sma20Of(prior)
  const o = base + 0.0004
  const c = o + 0.0002 // green body 2e-4
  const last = { time: 300 * candles.length, open: o, high: c + 0.0005, low: o - 0.0001, close: c }
  return { candles: [...prior, last], price: c }
}

/** Bullish pin whose BODY straddles the 20-SMA (B2 fails; price below the SMA). */
function trendWithPinStraddling(candles = trendCandles()) {
  const prior = candles.slice(0, -1)
  const base = sma20Of(prior)
  const o = base - 0.0004
  const c = base - 0.0002
  const last = { time: 300 * candles.length, open: o, high: o + 0.0008, low: o - 0.0001, close: c }
  return { candles: [...prior, last], price: c }
}

/**
 * Swing plane: every 8th bar touches `level` (trough for a support floor, peak
 * for a resistance ceiling); the others sit `gap` away. Pivot depth alternates
 * a 1-pip hair so that after 4x aggregation (H4: troughs land every 2nd brick)
 * adjacent troughs stay STRICTLY below each other — swingPoints needs a strict
 * local extreme, and a perfectly equal periodic floor yields zero confirmed
 * pivots. Both hair variants sit within the 0.5·ATR clustering tolerance, so
 * the level lands exactly at `level` and the pip-distance from `price` is exact.
 */
function swingPlane({ level, kind, bars = 140, gap = 0.002, highAmp = 0.004, timeStep = 3600 }) {
  const out = []
  for (let i = 0; i < bars; i++) {
    const isPivot = i % 8 === 3
    const deep = i % 16 === 11 // shallow pivot (1-pip hair) vs deep pivot (exact level)
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

// ---------------------------------------------------------------------
// T4 — session clock (IANA / DST)
// ---------------------------------------------------------------------
describe("sessionInWindow (T4)", () => {
  const win = { tz: "Europe/London", start: "07:00", end: "16:00" }

  it("is wall-clock in the configured IANA zone, not raw UTC", () => {
    // 2026-03-29: UK DST began 01:00 UTC. 06:30Z = 07:30 BST -> OPEN.
    expect(sessionInWindow(win, Date.parse("2026-03-29T06:30:00Z")).ok).toBe(true)
    // A naive UTC-range check would call the same instant CLOSED (06:30 < 07:00 UTC).
    // 05:59Z = 06:59 BST -> closed (opening is 07:00 BST wall-clock).
    expect(sessionInWindow(win, Date.parse("2026-03-29T05:59:00Z")).ok).toBe(false)
  })

  it("reports the wall-clock string for honest payloads", () => {
    const r = sessionInWindow(win, Date.parse("2026-03-29T06:30:00Z"))
    expect(r.wall).toBe("07:30")
    expect(r.tz).toBe("Europe/London")
  })

  it("before DST the same wall hours map to a different UTC instant", () => {
    // 2026-03-10 London is on GMT. 08:00Z = 08:00 wall -> open; 06:59Z -> 06:59 -> closed.
    expect(sessionInWindow(win, Date.parse("2026-03-10T08:00:00Z")).ok).toBe(true)
    expect(sessionInWindow(win, Date.parse("2026-03-10T06:59:00Z")).ok).toBe(false)
    expect(sessionInWindow(win, Date.parse("2026-03-10T17:00:00Z")).ok).toBe(false)
  })

  it("ny-london overlap profile uses America/New_York wall-clock", () => {
    const nyl = { tz: "America/New_York", start: "13:00", end: "17:00" }
    // 2026-03-06 is pre-DST (EST = UTC-5): 18:00Z = 13:00 EST -> open; 17:00Z = 12:00 EST -> closed.
    expect(sessionInWindow(nyl, Date.parse("2026-03-06T18:00:00Z")).ok).toBe(true)
    expect(sessionInWindow(nyl, Date.parse("2026-03-06T17:00:00Z")).ok).toBe(false)
  })

  it("'any' profile is always open and bad windows fail honestly", () => {
    expect(sessionInWindow({ tz: "UTC", start: "00:00", end: "23:59" }, Date.parse("2026-03-10T03:33:00Z")).ok).toBe(true)
    expect(sessionInWindow({ tz: "Mars/Olympus", start: "07:00", end: "16:00" }, Date.now()).ok).toBe(false)
    expect(sessionInWindow({ tz: "UTC", start: "7:00", end: "16:00" }, Date.now()).ok).toBe(false)
  })
})

describe("nextBarAtMs (T4/REQ-MAIN)", () => {
  it("schedules the next 5-min boundary + 2s", () => {
    const at = nextBarAtMs(Date.parse("2026-03-10T12:03:59.900Z"), 300, 2000)
    expect(new Date(at).toISOString()).toBe("2026-03-10T12:05:02.000Z")
  })
  it("a boundary-aligned now still yields the +2s delay", () => {
    const at = nextBarAtMs(Date.parse("2026-03-10T12:00:00.000Z"), 300, 2000)
    expect(new Date(at).toISOString()).toBe("2026-03-10T12:00:02.000Z")
  })
})

// ---------------------------------------------------------------------
// T5 — news blackout
// ---------------------------------------------------------------------
describe("blackoutViolations (T5)", () => {
  const now = Date.parse("2026-03-10T12:00:00Z")
  const events = [
    { date: "2026-03-10", time: "12:10", currency: "USD", impact: "High", event: "FOMC" },
    { date: "2026-03-10", time: "14:00", currency: "USD", impact: "High", event: "NFP" },
    { date: "2026-03-10", time: "12:10", currency: "JPY", impact: "High", event: "BOJ Decision" },
    { date: "2026-03-10", time: "12:00", currency: "USD", impact: "Medium", event: "Retail Sales" }
  ]

  it("blocks within ±newsBlackoutMin on a currency touch", () => {
    const r = blackoutViolations({ events, nowMs: now, minutes: 15, currencies: ["EUR", "USD"] })
    expect(r.blocked).toBe(true)
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0].event).toBe("FOMC")
    expect(r.hits[0].minutesAway).toBe(10)
  })

  it("widening the window config is honored", () => {
    expect(blackoutViolations({ events, nowMs: now, minutes: 130, currencies: ["EUR", "USD"] }).hits).toHaveLength(2)
  })

  it("a JPY-only event does not block an EURUSD-mapped asset", () => {
    const r = blackoutViolations({ events, nowMs: now, minutes: 15, currencies: ["EUR", "USD"] })
    expect(r.hits.some((h) => h.currency === "JPY")).toBe(false)
  })

  it("never blocks on non-high-impact events", () => {
    const r = blackoutViolations({ events: events.slice(3), nowMs: now, minutes: 15, currencies: ["USD"] })
    expect(r.blocked).toBe(false)
  })
})

// ---------------------------------------------------------------------
// T6 — spread gate
// ---------------------------------------------------------------------
describe("spreadGateF1 (T6)", () => {
  it("null spread source aborts with the exact honest reason", () => {
    const r = spreadGateF1(null, 1.5)
    expect(r.ok).toBe(false)
    expect(r.check).toBe("unmeasurable")
    expect(r.reason).toBe("spread unmeasurable — no bid/ask source")
    expect(r.source).toBeNull()
  })

  it("a fixture-injected reading drives the <=1.5 pips boundary", () => {
    expect(spreadGateF1({ spreadPips: 1.2, source: "fixture" }, 1.5).ok).toBe(true)
    expect(spreadGateF1({ spreadPips: 1.8, source: "fixture" }, 1.5).ok).toBe(false)
    expect(spreadGateF1({ spreadPips: 1.5, source: "fixture" }, 1.5).ok).toBe(true) // <= boundary
    expect(spreadGateF1({ spreadPips: 1.8, source: "fixture" }, 1.5).check).toBe("over-limit")
  })

  it("never fabricates a numeric spread from a non-finite reading", () => {
    const r = spreadGateF1({ spreadPips: NaN }, 1.5)
    expect(r.ok).toBe(false)
    expect(r.spreadPips).toBeNull()
  })
})

// ---------------------------------------------------------------------
// T7 — correlation lock
// ---------------------------------------------------------------------
describe("correlationBlocked (T7)", () => {
  const now = Date.parse("2026-03-10T12:00:00Z")
  const correlations = U4FA_DEFAULTS.correlations

  it("a EURUSD miss 2 min ago blocks GBPUSD within the 15-min pause", () => {
    const r = correlationBlocked({
      assetId: "GBPUSD",
      losses: [{ asset: "EURUSD", ts: now - 2 * 60_000 }],
      correlations,
      nowMs: now
    })
    expect(r.blocked).toBe(true)
    expect(r.triggeredBy).toBe("EURUSD")
  })

  it("16 minutes after the loss the pause has expired", () => {
    const r = correlationBlocked({
      assetId: "GBPUSD",
      losses: [{ asset: "EURUSD", ts: now - 16 * 60_000 }],
      correlations,
      nowMs: now
    })
    expect(r.blocked).toBe(false)
  })

  it("a win (no loss event) does not block, and no ledger data fails open", () => {
    expect(correlationBlocked({ assetId: "GBPUSD", losses: [], correlations, nowMs: now }).blocked).toBe(false)
    expect(correlationBlocked({ assetId: "GBPUSD", losses: undefined, correlations, nowMs: now }).blocked).toBe(false)
  })

  it("carries the static, not-measured honesty label", () => {
    const r = correlationBlocked({ assetId: "GBPUSD", losses: [{ asset: "EURUSD", ts: now - 60_000 }], correlations, nowMs: now })
    expect(r.label).toMatch(/static config/)
  })
})

// ---------------------------------------------------------------------
// T8 — structure levels
// ---------------------------------------------------------------------
describe("resolveStructureLevels (T8)", () => {
  const pip = 0.0001

  it("H4 leg: price 6 pips above the floor support hits (CALL side)", () => {
    const price = 1.0830
    const hourly = swingPlane({ level: price - 6 * pip, kind: "floor", bars: 140, timeStep: 3600 })
    const r = resolveStructureLevels({ hourlyCandles: hourly, dailyCandles: null, price, pipSize: pip, tolerancePips: 10 })
    expect(r.legs.h4.available).toBe(true)
    expect(r.legs.h4.supportHit).toBe(true)
    expect(r.call.hit).toBe(true)
    expect(r.call.legs).toContain("h4")
    expect(r.legs.h4.closestSupport.distancePips).toBeGreaterThan(0)
    expect(r.legs.h4.closestSupport.distancePips).toBeLessThanOrEqual(10)
    expect(r.sources).toBe("aggregate-h4")
  })

  it("H4 leg: price 14 pips away misses", () => {
    const price = 1.0830
    const hourly = swingPlane({ level: price - 14 * pip, kind: "floor", bars: 140, timeStep: 3600 })
    const r = resolveStructureLevels({ hourlyCandles: hourly, dailyCandles: null, price, pipSize: pip, tolerancePips: 10 })
    expect(r.legs.h4.supportHit).toBe(false)
    expect(r.call.hit).toBe(false)
  })

  it("D1 leg: ceiling resistance 6 pips above price hits (PUT side)", () => {
    const price = 1.0830
    const daily = swingPlane({ level: price + 6 * pip, kind: "ceiling", bars: 70, timeStep: 86400 })
    const r = resolveStructureLevels({ hourlyCandles: null, dailyCandles: daily, price, pipSize: pip, tolerancePips: 10 })
    expect(r.legs.d1.available).toBe(true)
    expect(r.legs.d1.resistanceHit).toBe(true)
    expect(r.put.hit).toBe(true)
    expect(r.put.legs).toContain("d1")
    expect(r.sources).toBe("yahoo-d1")
  })

  it("JPY pip conversion applies (0.01) to the same geometry", () => {
    const price = 150.00
    const hourly = swingPlane({ level: price - 6 * 0.01, kind: "floor", bars: 140, timeStep: 3600 })
    const r = resolveStructureLevels({ hourlyCandles: hourly, dailyCandles: null, price, pipSize: 0.01, tolerancePips: 10 })
    expect(r.call.hit).toBe(true)
    expect(r.legs.h4.closestSupport.distancePips).toBeGreaterThan(5.5)
    expect(r.legs.h4.closestSupport.distancePips).toBeLessThan(7)
  })

  it("min-history guard: <120 hourly bars -> H4 unavailable, never fabricated", () => {
    const price = 1.0830
    const short = swingPlane({ level: price - 6 * pip, kind: "floor", bars: 90, timeStep: 3600 })
    const r = resolveStructureLevels({ hourlyCandles: short, dailyCandles: null, price, pipSize: pip, tolerancePips: 10 })
    expect(r.legs.h4.available).toBe(false)
    expect(r.legs.h4.reason).toMatch(/< 120 hourly bars/)
    expect(r.call.hit).toBe(false)
  })

  it("both legs unavailable -> F2 has no level to invent from", () => {
    const r = resolveStructureLevels({ hourlyCandles: null, dailyCandles: null, price: 1.08 })
    expect(r.call.hit).toBe(false)
    expect(r.put.hit).toBe(false)
    expect(r.sources).toBe("none")
  })
})

// ---------------------------------------------------------------------
// F2 trigger + F4 boosters (pure boundaries)
// ---------------------------------------------------------------------
describe("pinBarHit / triggerFromCandle (REQ-F2)", () => {
  it("wick > 2x body is a pin; wick <= 2x body is not", () => {
    expect(pinBarHit({ open: 1.0, high: 1.012, low: 0.999, close: 1.002 })).toBe(true) // body 2e-3, wick 1e-2
    expect(pinBarHit({ open: 1.0, high: 1.005, low: 0.999, close: 1.002 })).toBe(false) // body 2e-3, wick 5e-3
    expect(pinBarHit({ open: 1.0, high: 1.005, low: 0.999, close: 1.0 })).toBe(false) // no body
  })

  it("trigger falls back to a full 20-SMA break with the open across the line", () => {
    expect(triggerFromCandle({ open: 1.000, high: 1.011, low: 0.999, close: 1.010 }, 1.005, "up").trigger).toBe("sma-break")
    expect(triggerFromCandle({ open: 1.006, high: 1.012, low: 1.004, close: 1.010 }, 1.005, "up").trigger).toBe("none")
    expect(triggerFromCandle({ open: 1.010, high: 1.011, low: 1.000, close: 1.001 }, 1.005, "down").trigger).toBe("sma-break")
  })

  it("a pin triggers regardless of its position vs the SMA", () => {
    expect(triggerFromCandle({ open: 1.006, high: 1.014, low: 1.005, close: 1.007 }, 1.005, "up").trigger).toBe("pin-bar")
  })
})

describe("boosterB1 (stochRSI cross)", () => {
  it("CALL: %K below 60 crosses up through %D", () => {
    expect(boosterB1({ kCur: 61, dCur: 59, kPrev: 55, dPrev: 57, direction: "up", levels: { long: 60, short: 40 } }).pass).toBe(true)
  })
  it("CALL fails when %K never dipped below 60 before the cross", () => {
    expect(boosterB1({ kCur: 63, dCur: 61, kPrev: 62, dPrev: 60, direction: "up", levels: { long: 60, short: 40 } }).pass).toBe(false)
  })
  it("PUT: %K above 40 crosses down through %D", () => {
    expect(boosterB1({ kCur: 39, dCur: 41, kPrev: 45, dPrev: 43, direction: "down", levels: { long: 60, short: 40 } }).pass).toBe(true)
    expect(boosterB1({ kCur: 39, dCur: 41, kPrev: 45, dPrev: 43, direction: "up", levels: { long: 60, short: 40 } }).pass).toBe(false)
  })
  it("insufficient history is a fail, not a forged memory", () => {
    expect(boosterB1({ kCur: null, dCur: null, kPrev: 55, dPrev: 57, direction: "up" }).pass).toBe(false)
  })
})

describe("boosterB2 (body beyond 20 SMA)", () => {
  it("CALL: green candle body fully above the SMA", () => {
    expect(boosterB2({ open: 1.006, close: 1.008, sma20: 1.005, direction: "up" }).pass).toBe(true)
  })
  it("CALL fails when the body straddles the SMA", () => {
    expect(boosterB2({ open: 1.004, close: 1.006, sma20: 1.005, direction: "up" }).pass).toBe(false)
  })
  it("PUT: red candle body fully below the SMA", () => {
    expect(boosterB2({ open: 1.004, close: 1.001, sma20: 1.005, direction: "down" }).pass).toBe(true)
    expect(boosterB2({ open: 1.006, close: 1.004, sma20: 1.005, direction: "down" }).pass).toBe(false) // open above, close below -> straddles
  })
})

describe("boosterB3 (BB exhaustion)", () => {
  it("percentB 0.89 is not hugging; 0.91 is (>= bbHugPct)", () => {
    expect(boosterB3({ percentB: 0.89, adxLast: 25, bbHugPct: 0.9, direction: "up" }).pass).toBe(true)
    expect(boosterB3({ percentB: 0.91, adxLast: 25, bbHugPct: 0.9, direction: "up" }).pass).toBe(false)
    expect(boosterB3({ percentB: 0.12, adxLast: 25, bbHugPct: 0.9, direction: "down" }).pass).toBe(true)
    expect(boosterB3({ percentB: 0.08, adxLast: 25, bbHugPct: 0.9, direction: "down" }).pass).toBe(false)
  })
  it("ADX > 30 ignores the rule (auto-pass) per blueprint", () => {
    expect(boosterB3({ percentB: 0.99, adxLast: 35, bbHugPct: 0.9, direction: "up" }).pass).toBe(true)
    expect(boosterB3({ percentB: 0.99, adxLast: 35, bbHugPct: 0.9, direction: "up" }).ignored).toBe("adx>30")
  })
})

// ---------------------------------------------------------------------
// Regime latch + timing
// ---------------------------------------------------------------------
describe("nextRegimeState (Regime-3 Chop latch)", () => {
  it("latch: one bad reading trips chop; one good reading does NOT re-arm", () => {
    const tripped = nextRegimeState({ chop: false, streak: 0 }, false, 2)
    expect(tripped).toMatchObject({ chop: true, streak: 0 })
    const oneGood = nextRegimeState(tripped, true, 2)
    expect(oneGood).toMatchObject({ chop: true, streak: 1, rearmed: false })
  })
  it("latch: two consecutive good readings re-arm", () => {
    const armed = nextRegimeState({ chop: true, streak: 1 }, true, 2)
    expect(armed).toMatchObject({ chop: false, streak: 0, rearmed: true })
  })
  it("armed state stays armed on good readings; a bad reading re-trips", () => {
    expect(nextRegimeState({ chop: false, streak: 0 }, true, 2).chop).toBe(false)
    expect(nextRegimeState({ chop: false, streak: 0 }, false, 2).chop).toBe(true)
  })
  it("the boundary is exact: adx == threshold counts as an adverse (chop) reading", () => {
    expect(nextRegimeState({ chop: false, streak: 0 }, 25 > 25, 2).chop).toBe(true)
  })
})

describe("timingRecommendation (REQ-MAIN)", () => {
  const now = Date.parse("2026-03-10T12:00:00.400Z")
  it("adx below threshold aborts all", () => {
    const t = timingRecommendation(24.9, 25, { nowMs: now })
    expect(t.mode).toBe("abort")
    expect(t.atMs).toBeNull()
  })
  it("adx in [threshold,30] enters at next-bar + 2s", () => {
    const t = timingRecommendation(27.5, 25, { nowMs: now, baseTfSec: 300, delayMs: 2000 })
    expect(t.mode).toBe("next-bar")
    expect(new Date(t.atMs).toISOString()).toBe("2026-03-10T12:05:02.000Z")
    const at30 = timingRecommendation(30, 25, { nowMs: now })
    expect(at30.mode).toBe("next-bar")
  })
  it("adx > 30 enters immediately at the confirmation close", () => {
    const t = timingRecommendation(31, 25, { nowMs: now })
    expect(t.mode).toBe("immediate")
    expect(t.atMs).toBe(now)
  })
  it("unmeasurable adx gives no timing advice rather than a guess", () => {
    expect(timingRecommendation(null, 25, { nowMs: now }).mode).toBe("abort")
  })
})

// ---------------------------------------------------------------------
// T3 — the full pipeline
// ---------------------------------------------------------------------
const NOW = Date.parse("2026-03-10T12:00:00Z") // Europe/London open (GMT)

/** All F1-passing inputs for the forex fixtures. */
function fxInputs({ candles5m, hourlyCandles, dailyCandles = null, spread = { spreadPips: 1.2, source: "fx-fixture", at: NOW }, calendarEvents = [], losses = [], assetId = "EURUSD", regimeState = { chop: false, streak: 0 } }) {
  return {
    assetId,
    candles5m,
    hourlyCandles,
    dailyCandles,
    calendarEvents,
    calendarSource: "feed",
    spread,
    losses,
    config: U4FA_DEFAULTS,
    regimeState,
    nowMs: NOW,
    candleSource: "fixture-candles"
  }
}

/** Hourly floor positioned at `price - offsetPips` pips. */
function floorFor(price, offsetPips, bars = 140, timeStep = 3600) {
  return swingPlane({ level: price - offsetPips * 0.0001, kind: "floor", bars, timeStep })
}

describe("evaluateU4FA — full pipeline (T3)", () => {
  it("F1-F3 pass + 2/3 boosters -> TRADE with honest field provenance", () => {
    const { candles, price } = trendWithPinAbove()
    const result = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6) }))
    expect(result.verdict).toBe("TRADE")
    expect(result.direction).toBe("up")
    expect(result.expiry).toBe(900)
    expect(result.factors.f1.pass).toBe(true)
    expect(result.factors.f2.pass).toBe(true)
    expect(result.factors.f2.structure).toMatchObject({ tf: 14400, trigger: "pin-bar", tolerancePips: 10 })
    expect(result.factors.f3.pass).toBe(true)
    expect(result.factors.f3.chop).toBe(false)
    expect(result.factors.f4.passed).toBeGreaterThanOrEqual(2)
    // fixture sanity: the trend series really is a strong uptrend
    expect(result.indicators.adx).toBeGreaterThan(30)
    // stochRSI %K sits at 33.33 in this fixture (no %K/%D cross -> B1 off, 2/3 boosters);
    // but the payload must still carry a finite, bounded reading — never null
    expect(result.indicators.stochRsi.k).toBeGreaterThanOrEqual(0)
    expect(result.indicators.stochRsi.k).toBeLessThanOrEqual(100)
    expect(result.indicators.stochRsi.k).not.toBeNull()
    expect(result.timing.mode).toBe("immediate")
    expect(result.regime.chop).toBe(false)
    expect(result.regime.pccPhase).toBe("trend")
    expect(result.compliance.requiresHumanApproval).toBe(true) // advisory only
    expect(result.honesty).toMatchObject({
      spreadSource: "fx-fixture",
      structureSource: "aggregate-h4",
      calendarSource: "feed",
      candleSource: "fixture-candles"
    })
    expect(result.reasons.some((r) => r.includes("decision support only"))).toBe(true)
    expect(result.regimeState).toMatchObject({ chop: false, streak: 0 })
  })

  it("F4 with 1/3 boosters -> OBSERVE (no majority, no signal)", () => {
    const { candles, price } = trendWithPinStraddling()
    const result = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6) }))
    expect(result.factors.f1.pass).toBe(true)
    expect(result.factors.f2.pass).toBe(true)
    expect(result.factors.f3.pass).toBe(true)
    expect(result.factors.f4.passed).toBeLessThan(2)
    expect(result.verdict).toBe("OBSERVE")
  })

  it("F1 spread unmeasurable -> NEUTRAL with the honest reason, no fabricated pip count", () => {
    const { candles, price } = trendWithPinAbove()
    const result = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6), spread: null }))
    expect(result.verdict).toBe("NEUTRAL")
    expect(result.factors.f1.checks.spread).toBe("unmeasurable")
    expect(result.reasons.some((r) => r.includes("spread unmeasurable"))).toBe(true)
    expect(result.honesty.spreadSource).toBeNull()
  })

  it("F1 news blackout -> NEUTRAL with the event named", () => {
    const { candles, price } = trendWithPinAbove()
    const events = [{ date: "2026-03-10", time: "12:10", currency: "USD", impact: "High", event: "NFP" }]
    const result = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6), calendarEvents: events }))
    expect(result.verdict).toBe("NEUTRAL")
    expect(result.factors.f1.checks.news).toBe("blocked")
    expect(result.reasons.some((r) => r.includes("NFP"))).toBe(true)
  })

  it("F1 correlation lock -> NEUTRAL naming the trigger asset", () => {
    const { candles, price } = trendWithPinAbove()
    const losses = [{ asset: "EURUSD", ts: NOW - 2 * 60_000 }]
    const result = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6), losses, assetId: "GBPUSD" }))
    expect(result.verdict).toBe("NEUTRAL")
    expect(result.factors.f1.checks.correlation).toBe("blocked")
    expect(result.reasons.some((r) => r.includes("EURUSD"))).toBe(true)
  })

  it("Regime-3 Chop halts everything and the 2-reading latch gates re-arm", () => {
    // chop 5m series -> ADX under threshold -> chop latches
    const chop5m = chopCandles()
    const p1 = chop5m[chop5m.length - 1].close
    const r1 = evaluateU4FA(fxInputs({ candles5m: chop5m, hourlyCandles: floorFor(p1, 6) }))
    expect(r1.indicators.adx).toBeLessThan(20)
    expect(r1.verdict).toBe("NEUTRAL")
    expect(r1.factors.f3.chop).toBe(true)
    expect(r1.factors.f3.reason).toMatch(/Regime 3 Chop/)
    expect(r1.regimeState).toMatchObject({ chop: true, streak: 0 })

    // first TRADE-capable reading after chop still halts (1/2 confirmations)
    const { candles, price } = trendWithPinAbove()
    const r2 = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6), regimeState: r1.regimeState }))
    expect(r2.verdict).toBe("NEUTRAL")
    expect(r2.regimeState).toMatchObject({ chop: true, streak: 1 })
    expect(r2.factors.f3.reason).toMatch(/post-chop recovery/)

    // second consecutive good reading re-arms -> TRADE resumes
    const r3 = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6), regimeState: r2.regimeState }))
    expect(r3.regimeState).toMatchObject({ chop: false, streak: 0 })
    expect(r3.verdict).toBe("TRADE")
  })

  it("an unreadable chop state carries no opinion (insufficient bars cannot wedge the latch)", () => {
    const { candles, price } = trendWithPinAbove()
    const result = evaluateU4FA(fxInputs({ candles5m: candles.slice(0, MIN_5M_BARS - 1), hourlyCandles: floorFor(price, 6) }))
    expect(result.verdict).toBe("NEUTRAL")
    expect(result.reasons.some((r) => r.includes("insufficient 5m history"))).toBe(true)
    expect(result.regimeState).toMatchObject({ chop: false, streak: 0 }) // untouched
  })

  it("AVOID-class and unclassified assets are hard-refused, never evaluated", () => {
    const { candles, price } = trendWithPinAbove()
    const oil = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6), assetId: "OIL" }))
    expect(oil.verdict).toBe("NEUTRAL")
    expect(oil.reasons.some((r) => r.includes("AVOID"))).toBe(true)
    const goo = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: floorFor(price, 6), assetId: "GOO" }))
    expect(goo.reasons.some((r) => r.includes("no calibration class"))).toBe(true)
  })

  it("no level within 10 pips -> structure fail with a truthful 'no swing level' reason", () => {
    const { candles, price } = trendWithPinAbove()
    const farFloor = floorFor(price, 14) // 14 pips away
    const result = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: farFloor }))
    expect(result.verdict).toBe("NEUTRAL")
    expect(result.reasons.some((r) => r.includes("no swing level within 10 pips"))).toBe(true)
  })

  it("structure unavailable (no H4/D1 at all) fails F2 with the honest 'unavailable' reason", () => {
    const { candles, price } = trendWithPinAbove()
    const result = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: null, dailyCandles: null }))
    expect(result.verdict).toBe("NEUTRAL")
    expect(result.reasons.some((r) => r.includes("structure unavailable"))).toBe(true)
    expect(result.honesty.structureSource).toBe("none")
  })

  it("D1 leg alone (Yahoo-EOD daily candles) can carry F2", () => {
    const { candles, price } = trendWithPinAbove()
    const daily = swingPlane({ level: price - 6 * 0.0001, kind: "floor", bars: 70, timeStep: 86400 })
    const result = evaluateU4FA(fxInputs({ candles5m: candles, hourlyCandles: null, dailyCandles: daily }))
    expect(result.factors.f2.structure).toMatchObject({ tf: 86400, trigger: "pin-bar" })
    expect(result.honesty.structureSource).toBe("yahoo-d1")
    expect(result.verdict).toBe("TRADE")
  })

  it("expiry plumbs the calibration class override (EURUSD remapped to crypto -> 1800)", () => {
    const cfg = deepMergeConfig(U4FA_DEFAULTS, { assetClassMap: { EURUSD: "crypto" } })
    const { candles, price } = trendWithPinAbove()
    // crypto pipSize = 1, so the build must use pip=1 distances
    const hourly = swingPlane({ level: price - 6, kind: "floor", bars: 140, timeStep: 3600 })
    const result = evaluateU4FA({ ...fxInputs({ candles5m: candles, hourlyCandles: hourly, assetId: "EURUSD" }), config: cfg })
    expect(result.expiry).toBe(1800)
    expect(result.style).toBe("2")
  })
})