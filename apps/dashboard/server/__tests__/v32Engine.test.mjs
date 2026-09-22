// v3.2 Plan 3 — Task 4 test bed: v32Engine per-asset composition (REQ-P3-6/8/10/12).
import { describe, it, expect, afterEach } from "vitest"
import {
  v32ContextForAsset,
  v32DecisionForAsset,
  resetV32RegimeStates,
  rederiveExpectancy
} from "../services/v32Engine.mjs"
import { confidenceShape } from "../services/constitution.mjs"
import { flipGate } from "../services/constitution.mjs"

const CANDLE = (i, price, volume = 100) => ({
  open: price - 1,
  high: price + 2,
  low: price - 2,
  close: price,
  volume
})

function trendingCandles(n = 60, base = 100, step = 1.2, volume = 100) {
  return Array.from({ length: n }, (_, i) => CANDLE(i, base + i * step, volume))
}

const FLAT_CANDLES = Array.from({ length: 60 }, (_, i) => CANDLE(i, 100 + Math.sin(i) * 0.001, 100))

const CHOP_CANDLES = Array.from({ length: 60 }, (_, i) => CANDLE(i, 100 + (i % 3) * 0.4, 100))

const FEW_CANDLES = trendingCandles(10)

function assetFixture(overrides = {}) {
  return {
    id: "BTC",
    name: "BTC",
    periods: { 300: trendingCandles(), 3600: trendingCandles(40, 200) },
    ...overrides
  }
}

function ctxFixture(overrides = {}) {
  return {
    config: {},
    calendarEvents: [],
    calendarSource: "observed",
    spread: { spreadPips: 1.2, source: "fixture", at: 0 },
    losses: [],
    candleSource: "fixture",
    now: 1000,
    ...overrides
  }
}

function v32ConfigFixture(overrides = {}) {
  return { enabled: false, proposalCap: 0, consecutiveLossThreshold: null, ...overrides }
}

function riskFixture(overrides = {}) {
  return {
    dayStartBalance: 1000,
    pnl: 0,
    sessionPnL: 0,
    sessionBalance: 1000,
    killSwitch: false,
    proposalsToday: 0,
    consecutiveLosses: 0,
    ...overrides
  }
}

const TRADES_UP = [
  { timeMs: 0, price: 100, side: "buy", amount: 10 },
  { timeMs: 10, price: 101, side: "buy", amount: 10 },
  { timeMs: 20, price: 102, side: "buy", amount: 10 },
  { timeMs: 30, price: 103, side: "sell", amount: 2 },
  { timeMs: 40, price: 104, side: "buy", amount: 10 },
  { timeMs: 50, price: 105, side: "take", amount: 3 }
]

const DATA_ON = { winProb: 0.75, payout: 82, spreadPips: 1.5, slippagePips: 0, risk: riskFixture() }

const ROWS_V32_LEGACY = [
  { engine: "v3.2", expiry: "900", hits: 6, misses: 4, total: 10 },
  { engine: "legacy", expiry: "900", hits: 5, misses: 5, total: 10 }
]

afterEach(() => resetV32RegimeStates())

describe("v32ContextForAsset — per-asset context assembly (REQ-P3-12)", () => {
  it("resolves venue by calibration class", () => {
    const crypto = v32ContextForAsset(assetFixture({ id: "BTC", name: "BTC" }), ctxFixture(), v32ConfigFixture())
    expect(crypto.venue).toBe("crypto")

    const forex = v32ContextForAsset(assetFixture({ id: "GBPUSD", name: "GBPUSD" }), ctxFixture(), v32ConfigFixture())
    expect(forex.venue).toBe("forex")

    const gold = v32ContextForAsset(assetFixture({ id: "XAUUSD", name: "GOLD" }), ctxFixture(), v32ConfigFixture())
    expect(gold.venue).toBe("eo")
  })

  it("assembles the regime registers honestly (adx + session + f1)", () => {
    const res = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    expect(res.ok).toBe(true)
    expect(res.regime.registers.adx.available).toBe(true)
    expect(res.regime.registers.session.label).toBe("normal")
    expect(res.regime.f1.checks.spread.check).toBe("ok")
    expect(res.pipSize).toBeGreaterThan(0)
    expect(res.expiry).toBeGreaterThan(0)
  })

  it("spread null surfaces as unmeasurable (no bid/ask feed)", () => {
    const res = v32ContextForAsset(assetFixture(), ctxFixture({ spread: null }), v32ConfigFixture())
    expect(res.regime.f1.checks.spread.check).toBe("unmeasurable")
  })

  it("refuses an unclassified asset honestly (REQ-CAL)", () => {
    const res = v32ContextForAsset(assetFixture({ id: "ZZZ9", name: "zzz" }), ctxFixture(), v32ConfigFixture())
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/class/)
  })
})

describe("v32DecisionForAsset — the per-asset v3.2 row (REQ-P3-6/8/12)", () => {
  it("produces a TRADE row tagged engine v3.2 on a clean fixture", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: { ...DATA_ON, trades: TRADES_UP } })
    expect(row.engine).toBe("v3.2")
    expect(row.verdict).toBe("TRADE")
    expect(row.copilot.ok).toBe(true)
    expect(row.gates.score).toBe(true)
    expect(row.gates.costLine).toBe(true)
    expect(row.gates.copilot).toBe(true)
    expect(row.gates.pillars5of7).toEqual(expect.objectContaining({ ok: true, agreed: 5, needed: 5 }))
    expect(row.gates.pillars5of7.rows).toHaveLength(7)
    expect(row.gates.pillars5of7.rows.filter((r) => r.agrees === true)).toHaveLength(5)
    expect(row.gates.pillars5of7.rows.find((r) => r.id === "externalclear").available).toBe(false)
    expect(row.copilot.blockedBy).toEqual([])
    expect(row.assetId).toBe("BTC")
    expect(row.ts).toBe(1000)
  })

  it("bans a standalone confidence field on the score (REQ-CON-5)", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    expect(row.score).not.toHaveProperty("confidence")
  })

  it("emits a strict-shape confidence from caller-supplied rows", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({
      ctx,
      v32Config: v32ConfigFixture(),
      now: 1000,
      data: { ...DATA_ON, rows: ROWS_V32_LEGACY }
    })
    expect(row.confidence.available).toBe(true)
    const shaped = confidenceShape({ sampleSize: row.confidence.sampleSize, costAdjustedExpectancy: row.confidence.costAdjustedExpectancy })
    expect(shaped.sampleSize).toBe(10)
    expect(shaped.costAdjustedExpectancy).toBeCloseTo((6 * 0.82 - 4) / 10, 6)
  })

  it("is honestly empty before the v3.2 ledger has decided rows", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    expect(row.confidence.available).toBe(false)
    expect(row.confidence.reason).toMatch(/no v3\.2 decided rows/)
  })

  it("matches flipGate's internal expectancy on shared rows (REQ-P3-10)", () => {
    const gate = flipGate({ rows: ROWS_V32_LEGACY })
    const mine = rederiveExpectancy(ROWS_V32_LEGACY, "v3.2")
    expect(mine).not.toBeNull()
    expect(mine).toBeCloseTo(gate.candidateExpectancy, 10)
  })

  it("a chop regime vetoes TRADE → NEUTRAL with the wire id in reasons", () => {
    const ctx = v32ContextForAsset(assetFixture({ periods: { 300: CHOP_CANDLES } }), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    expect(row.verdict).toBe("NEUTRAL")
    expect(row.copilot.blockedBy).toContain("2")
    expect(row.reasons.join(" ")).toMatch(/wire 2|chop/i)
  })

  it("unmeasurable spread vetoes TRADE → NEUTRAL (wire 4)", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture({ spread: null }), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    expect(row.verdict).toBe("NEUTRAL")
    expect(row.copilot.blockedBy).toContain("4")
  })

  it("OBSERVEs when the score has no measurable pillars (too few bars)", () => {
    // 10 bars: below the VWAP-15 and EMA-21 minimums → pillars honestly unavailable.
    const ctx = v32ContextForAsset(assetFixture({ periods: { 300: FEW_CANDLES } }), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    expect(row.verdict).toBe("OBSERVE")
    expect(row.gates.score).toBe(false)
    expect(row.direction).toBeNull()
    expect(row.score.available).toBe(false)
  })

  it("observe + wire-5 trip when no win probability resolves the cost line", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: { ...DATA_ON, winProb: undefined } })
    expect(row.costLine).toBeNull()
    expect(row.verdict).toBe("OBSERVE")
    expect(row.copilot.blockedBy).toContain("5")
  })

  it("wire 6 trips on a runtime kill switch", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({
      ctx,
      v32Config: v32ConfigFixture(),
      now: 1000,
      data: { ...DATA_ON, risk: riskFixture({ killSwitch: true }) }
    })
    expect(row.verdict).toBe("NEUTRAL")
    expect(row.copilot.blockedBy).toContain("6")
  })

  it("honesty block reports the feeds it actually read", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    expect(row.honesty.tradesFeed).toBe("absent")
    expect(row.honesty.spreadSource).toBe("fixture")
  })
})

describe("5-of-7 pillar gate composed into the verdict (WS-2 decision 9 / R7.4)", () => {
  it("keeps the honest gap visible without a trades feed — TRADE downgrades to OBSERVE (risk 6)", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    expect(row.copilot.ok).toBe(true)
    expect(row.gates.pillars5of7.ok).toBe(false)
    expect(row.gates.pillars5of7.agreed).toBe(3)
    expect(row.verdict).toBe("OBSERVE")
    expect(row.reasons.join(" ")).toMatch(/5-of-7 pillar gate blocked: 3\/5 agreeing/)
    expect(row.reasons.join(" ")).toMatch(/pillar volumedelta: no trades feed/)
    expect(row.reasons.join(" ")).toMatch(/pillar externalclear:/)
  })

  it("v32Config.pillarMin=6 downgrades a fully-green row to OBSERVE — 5 of the 6 remaining pillars", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture({ pillarMin: 6 }), now: 1000, data: { ...DATA_ON, trades: TRADES_UP } })
    expect(row.verdict).toBe("OBSERVE")
    expect(row.gates.pillars5of7).toEqual(expect.objectContaining({ ok: false, agreed: 5, needed: 6 }))
    expect(row.reasons.join(" ")).toMatch(/5-of-7 pillar gate blocked: 5\/6 agreeing/)
    expect(row.reasons.join(" ")).toMatch(/pillar htfbias:/)
  })

  it("gates.pillars5of7 rows carry per-row reasons on every row of a passing verdict", () => {
    const ctx = v32ContextForAsset(assetFixture(), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx, v32Config: v32ConfigFixture(), now: 1000, data: { ...DATA_ON, trades: TRADES_UP } })
    for (const r of row.gates.pillars5of7.rows) {
      expect(typeof r.reason).toBe("string")
      expect(r.reason.length).toBeGreaterThan(0)
    }
    expect(row.gates.pillars5of7.rows.find((r) => r.id === "adxregime").agrees).toBe(true)
    expect(row.gates.pillars5of7.rows.find((r) => r.id === "htfbias").available).toBe(false)
  })
})

describe("chop-latch continuity (2-bar re-arm, mirrors u4faRegimeStates)", () => {
  it("carries the latch across calls and re-arms after two trending readings", () => {
    // Call A: choppy → the latch latches chop.
    const ctxA = v32ContextForAsset(assetFixture({ periods: { 300: CHOP_CANDLES } }), ctxFixture(), v32ConfigFixture())
    v32DecisionForAsset({ ctx: ctxA, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    const latched = ctxA.regime.registers.adx.chop === true
    expect(latched).toBe(true)

    // Call B: one trending reading with the chop latch pending → still chop
    // (2 consecutive good readings required to re-arm).
    const ctxB = v32ContextForAsset(assetFixture({ periods: { 300: trendingCandles(80) } }), ctxFixture(), v32ConfigFixture())
    const rowB = v32DecisionForAsset({ ctx: ctxB, v32Config: v32ConfigFixture(), now: 2000, data: DATA_ON })
    expect(rowB.regime.registers.adx.chop).toBe(true)
    expect(rowB.regime.registers.adx.nextState.rearmed).toBe(false)

    // Call C: second trending reading → re-armed, chop clears.
    const ctxC = v32ContextForAsset(assetFixture({ periods: { 300: trendingCandles(80) } }), ctxFixture(), v32ConfigFixture())
    const rowC = v32DecisionForAsset({ ctx: ctxC, v32Config: v32ConfigFixture(), now: 3000, data: DATA_ON })
    expect(rowC.regime.registers.adx.chop).toBe(false)
    expect(rowC.regime.registers.adx.nextState.rearmed).toBe(true)
  })

  it("resetV32RegimeStates clears the map", () => {
    const ctx1 = v32ContextForAsset(assetFixture({ periods: { 300: CHOP_CANDLES } }), ctxFixture(), v32ConfigFixture())
    v32DecisionForAsset({ ctx: ctx1, v32Config: v32ConfigFixture(), now: 1000, data: DATA_ON })
    resetV32RegimeStates()
    const ctx2 = v32ContextForAsset(assetFixture({ periods: { 300: CHOP_CANDLES } }), ctxFixture(), v32ConfigFixture())
    const row = v32DecisionForAsset({ ctx: ctx2, v32Config: v32ConfigFixture(), now: 2000, data: DATA_ON })
    expect(row.regime.registers.adx.available).toBe(true) // re-latched fresh, not stale
    expect(row.regime.registers.adx.chop).toBe(true)
  })
})