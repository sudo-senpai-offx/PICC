import { describe, expect, it } from "vitest"
import {
  REQ_CON_2_DEPLOYABLE_FLOOR,
  REQ_CON_3_FORWARD_FLOOR,
  aggregateDayState,
  constitutionSourceOf,
  gateConstitution,
  costAdjustedEv,
  deriveEvRRFloor,
  confidenceShape,
  flipGate,
  EV_RR_MIN,
  PAYOUT_MARGIN
} from "../services/constitution.mjs"
import { evaluateAsset } from "../services/adaptiveConfluence.mjs"

// Canonical resolved ledger entry shape (subset of accuracyLedger.recordDecision
// + flushLedger output that Constitution actually reads).
const entry = (over) => ({
  id: 1,
  assetId: "GBPUSD",
  asset: "GBPUSD",
  direction: "up",
  expirySec: 60,
  entryTs: Date.parse("2026-09-19T10:00:00.000Z"),
  status: "resolved",
  result: "hit",
  engine: "legacy",
  ...over
})

const resolvedHit = (n = 1) => entry({ id: n, result: "hit" })
const resolvedMiss = (n = 2) => entry({ id: n, result: "miss" })
const resolvedPush = (n = 3) => entry({ id: n, result: "push" })

describe("constitution — REQ-CON-1 aggregate sample clock (derive-only, one truth)", () => {
  it("thresholds are the locked floors and carry a REQ source tag", () => {
    expect(REQ_CON_2_DEPLOYABLE_FLOOR).toBe(300)
    expect(REQ_CON_3_FORWARD_FLOOR).toBe(500)
    expect(constitutionSourceOf("REQ_CON_2_DEPLOYABLE_FLOOR")).toContain("REQ-CON-2")
    expect(constitutionSourceOf("REQ_CON_3_FORWARD_FLOOR")).toContain("REQ-CON-3")
  })

  it("derives the day's counts purely from ledger rows — no parallel counter", () => {
    const rows = [resolvedHit(1), resolvedMiss(2), resolvedPush(3)]
    const a = aggregateDayState({ entries: rows, now: Date.parse("2026-09-19T10:00:00.000Z") })
    const b = aggregateDayState({ entries: rows, now: Date.parse("2026-09-19T10:00:00.000Z") })
    expect(a).toEqual(b) // two junctions over the same ledger agree: no drift
    expect(a.dayKey).toBe("2026-09-19")
  })

  it("counts every venue/asset on the SAME UTC day under ONE clock", () => {
    const rows = [
      resolvedHit(1),
      entry({ id: 2, assetId: "BTCUSDT", asset: "BTCUSDT", result: "hit", direction: "up", expirySec: 300 }),
      entry({ id: 3, assetId: "EURUSD", asset: "EURUSD", result: "miss", direction: "down", expirySec: 120 })
    ]
    const s = aggregateDayState({ entries: rows, now: Date.parse("2026-09-19T12:00:00.000Z") })
    expect(s.total).toBe(3)
    expect(s.deployable).toBe(3)
  })

  it("only decided, resolved samples count — pending and unresolved never do", () => {
    const rows = [
      resolvedHit(1),
      entry({ id: 2, status: "pending", result: null }),
      entry({ id: 3, status: "unresolved", result: null })
    ]
    const s = aggregateDayState({ entries: rows, now: Date.parse("2026-09-19T12:00:00.000Z") })
    expect(s.total).toBe(1)
    expect(s.deployable).toBe(1)
  })

  it("rolls the clock at 00:00 GMT — entries on different UTC days never mix", () => {
    const rows = [
      resolvedHit(1), // 2026-09-19 10:00Z
      entry({ id: 2, entryTs: Date.parse("2026-09-21T01:00:00.000Z"), result: "miss" })
    ]
    const s = aggregateDayState({ entries: rows, now: Date.parse("2026-09-21T01:00:00.000Z") })
    expect(s.total).toBe(1) // only the 09-21 row counts on the 09-21 clock
    expect(s.dayKey).toBe("2026-09-21")
  })

  it("tallies per-expiry hit/miss/push buckets over decided samples", () => {
    const rows = [
      entry({ id: 1, expirySec: 60, result: "hit" }),
      entry({ id: 2, expirySec: 60, result: "hit" }),
      entry({ id: 3, expirySec: 60, result: "miss" }),
      entry({ id: 4, expirySec: 120, result: "push" })
    ]
    const s = aggregateDayState({ entries: rows, now: Date.parse("2026-09-19T12:00:00.000Z") })
    expect(s.byExpiry["60"]).toMatchObject({ n: 3, hits: 2, misses: 1, pushes: 0 })
    expect(s.byExpiry["120"]).toMatchObject({ n: 1, hits: 0, misses: 0, pushes: 1 })
    expect(s.byExpiry["60"].hitRate).toBeCloseTo(2 / 3)
    expect(s.byExpiry["120"].hitRate).toBeNull() // push-only bucket: no hitRate
  })

  it("is engine-aware at the aggregation seam (engine tag arrives in T11)", () => {
    const rows = [
      entry({ id: 1, engine: "legacy", result: "hit" }),
      entry({ id: 2, engine: "v3.2", result: "hit" })
    ]
    const s = aggregateDayState({ entries: rows, now: Date.parse("2026-09-19T12:00:00.000Z") })
    expect(s.total).toBe(2)
    const legacy = aggregateDayState({ entries: rows, now: Date.parse("2026-09-19T12:00:00.000Z"), engine: "legacy" })
    expect(legacy.total).toBe(1)
  })
})

describe("constitution — REQ-CON-2/3 real-money gates (paper/demo always open)", () => {
  it("returns ok:true once both floors pass, with the concrete numbers", () => {
    const g = gateConstitution({ deployable: 300, forward: 500 })
    expect(g.ok).toBe(true)
    expect(g.reasons).toEqual([])
    expect(g.deployable).toBe(300)
    expect(g.forward).toBe(500)
  })

  it("blocks below the deployable floor with a stable reason string", () => {
    const g = gateConstitution({ deployable: 299, forward: 500 })
    expect(g.ok).toBe(false)
    expect(g.reasons.some((r) => r.includes("300 deployable"))).toBe(true)
  })

  it("blocks below the forward floor with a stable reason string (500 forward)", () => {
    const g = gateConstitution({ deployable: 300, forward: 499 })
    expect(g.ok).toBe(false)
    expect(g.reasons.some((r) => r.includes("500 forward"))).toBe(true)
  })

  it("reports both blocks at once when both floors are unmet", () => {
    const g = gateConstitution({ deployable: 12, forward: 40 })
    expect(g.ok).toBe(false)
    expect(g.reasons.length).toBe(2)
  })

  it("is a strict AND — a full deployable count never masks an unmet forward floor", () => {
    const g = gateConstitution({ deployable: 5000, forward: 299 })
    expect(g.ok).toBe(false)
    expect(g.reasons.some((r) => r.includes("500 forward"))).toBe(true)
  })
})

describe("constitution — REQ-CON-4 cost-adjusted EV gate (1.5-pip spread model + margin)", () => {
  it("clears costs: payout is reduced by spread+slippage before the EV-RR check", () => {
    const base = costAdjustedEv({ winProb: 0.6, payoutPct: 82, spreadPips: 0, slippagePips: 0 })
    const costed = costAdjustedEv({ winProb: 0.6, payoutPct: 82, spreadPips: 1.5, slippagePips: 0.5 })
    expect(base.ev).toBeGreaterThan(costed.ev) // costed payout < gross payout → lower EV
    expect(costed.costPct).toBe(2) // 2.0 pips of cost expressed in payout-percent units
  })

  it("honestly reports the costed payout and the margin-check that descends from it", () => {
    const g = costAdjustedEv({ winProb: 0.6, payoutPct: 82, spreadPips: 1.5, slippagePips: 0.5 })
    expect(g.netPayoutPct).toBe(80) // 82 − 2
    expect(g.breakevenPayout).toBeCloseTo(66.67, 1) // 100(1−p)/p
    expect(g.payoutBeats).toBe(true) // 80 ≥ 66.67 × 1.15
  })

  it("fails when the margin is not cleared — costed payout below breakeven × margin", () => {
    const nearMarginal = costAdjustedEv({ winProb: 0.6, payoutPct: 77, spreadPips: 1.5, slippagePips: 0.5 })
    // net 75 < 66.67×1.15=76.67 → fails without relying on EV-RR alone
    expect(nearMarginal.netPayoutPct).toBe(75)
    expect(nearMarginal.payoutBeats).toBe(false)
    expect(nearMarginal.evRRPass).toBe(false)
  })

  it("rejects a degenerate winProb/payout (same contract as adaptiveConfluence.evGate)", () => {
    const g = costAdjustedEv({ winProb: 0.5, payoutPct: null })
    expect(g.ev).toBeNull()
    expect(g.evRRPass).toBe(false)
    expect(g.payoutBeats).toBe(false)
  })

  it("fails closed on non-numeric or negative spread/slippage — costs are never silently zero", () => {
    const nan = costAdjustedEv({ winProb: 0.6, payoutPct: 82, spreadPips: "wide" })
    expect(nan.ev).toBeNull()
    expect(nan.evRRPass).toBe(false)
    expect(nan.payoutBeats).toBe(false)
    const neg = costAdjustedEv({ winProb: 0.6, payoutPct: 82, spreadPips: -1 })
    expect(neg.ev).toBeNull()
    expect(neg.evRRPass).toBe(false)
    expect(neg.payoutBeats).toBe(false)
  })

  it("a real-money gate must NEVER open on non-finite deployable/forward counts", () => {
    expect(gateConstitution({ deployable: NaN, forward: 500 }).ok).toBe(false)
    expect(gateConstitution({ deployable: "abc", forward: 500 }).ok).toBe(false)
    expect(gateConstitution({ deployable: 300, forward: undefined }).ok).toBe(false)
    expect(gateConstitution({}).ok).toBe(false) // absent counts = 0 → locked, never open
  })

  it("reports the honest cost-line constituents for the HUD (payout, spread, slippage, margin)", () => {
    const g = costAdjustedEv({ winProb: 0.6, payoutPct: 82, spreadPips: 1.5, slippagePips: 0.5 })
    expect(g.line).toEqual({
      payoutPct: 82,
      spreadPips: 1.5,
      slippagePips: 0.5,
      marginPct: PAYOUT_MARGIN,
      netPayoutPct: 80,
      evRRMin: EV_RR_MIN
    })
  })
})

describe("constitution — derived EV-RR floor (REQ-CON-4 thresholds re-derived from ledger, not hardcoded)", () => {
  it("derives the floor from the ledger's correct-answer table once enough samples exist", () => {
    // 300 samples, 200 hits → realized hit rate 2/3; EV per win = 0.82 payout →
    // realized EV-RR = (200·0.82)/100 = 1.64
    const res = deriveEvRRFloor({ byExpiry: { "60": { n: 300, hits: 200, misses: 100 } } })
    expect(res.derived).toBe(true)
    expect(res.evRRFloor).toBeCloseTo(1.64, 2)
    expect(res.samples).toBe(300)
  })

  it("falls back to the legacy constant honestly when the ledger is too thin (under minSamples)", () => {
    const res = deriveEvRRFloor({ byExpiry: { "60": { n: 10, hits: 7, misses: 3 } } }, { minSamples: 50 })
    expect(res.derived).toBe(false)
    expect(res.evRRFloor).toBe(EV_RR_MIN)
    expect(res.samples).toBe(10)
  })

  it("never derives from a zero-miss bucket (evRR is unbounded → stays honest fallback)", () => {
    const res = deriveEvRRFloor({ byExpiry: { "60": { n: 300, hits: 300, misses: 0 } } })
    expect(res.derived).toBe(false)
    expect(res.evRRFloor).toBe(EV_RR_MIN)
  })

  it("aggregates across expiries by weighted totals, NOT by summing per-bucket ratios", () => {
    // A: 200 hits/100 misses (ratio 1.64), B: 50 hits/50 misses (ratio 0.82).
    // True aggregate EV-RR = (250·0.82)/150 = 1.3667, NOT 1.64 + 0.82 = 2.46.
    const res = deriveEvRRFloor({ byExpiry: { "60": { n: 300, hits: 200, misses: 100 }, "120": { n: 100, hits: 50, misses: 50 } } })
    expect(res.derived).toBe(true)
    expect(res.evRRFloor).toBeCloseTo(1.37, 2)
    expect(res.samples).toBe(400)
  })

  it("reports the FULL table's sample count even when a zero-miss bucket forces the fallback", () => {
    // Zero-miss bucket encountered; samples must reflect every bucket, not just the first.
    const res = deriveEvRRFloor({ byExpiry: { "60": { n: 400, hits: 300, misses: 100, payout: 82 }, "120": { n: 30, hits: 30, misses: 0 } } })
    expect(res.derived).toBe(false)
    expect(res.samples).toBe(430)
  })
})

describe("constitution — REQ-CON-5 confidence is only { sampleSize, costAdjustedExpectancy }", () => {
  it("returns exactly the two allowed keys", () => {
    const c = confidenceShape({ sampleSize: 340, costAdjustedExpectancy: 0.12 })
    expect(c).toEqual({ sampleSize: 340, costAdjustedExpectancy: 0.12 })
    expect(Object.keys(c).sort()).toEqual(["costAdjustedExpectancy", "sampleSize"])
  })

  it("rejects a caller smuggling extra fields (standalone %/score banned from decision inputs)", () => {
    expect(() => confidenceShape({ sampleSize: 340, costAdjustedExpectancy: 0.12, winProb: 0.8 })).toThrow();
    expect(() => confidenceShape({ sampleSize: 340, costAdjustedExpectancy: 0.12, percentile: 88 })).toThrow()
  })

  it("surfaces missing sample/expectancy rather than inventing them", () => {
    expect(() => confidenceShape({ sampleSize: 340 })).toThrow()
    expect(() => confidenceShape({ costAdjustedExpectancy: 0.12 })).toThrow()
  })
})

describe("constitution — flip gate (REQ-STG-3: new path expectancy ≥ old, ≥100 paper trades each)", () => {
  const table = { "60": (engine) => ({ engine, expiry: "60", hits: 70, misses: 30, total: 100 }) }

  it("flips only when both engines have ≥ minTrades and new expectancy is ≥ old", () => {
    const rows = [table["60"]("legacy"), table["60"]("v3.2")]
    // v3.2 identical distribution → equal costAdjustedExpectancy (0.274 with 82 payout)
    const gate = flipGate({ rows, legacy: "legacy", candidate: "v3.2", minTrades: 100 })
    expect(gate.flip).toBe(true) // equal expectancy ≥ old → flip (REQ-STG-3 ≥)
    expect(gate.legacyExpectancy).toBeCloseTo(gate.candidateExpectancy, 4)
    expect(gate.candidateTrades).toBe(100)
    expect(gate.legacyTrades).toBe(100)
  })

  it("holds when the legacy engine itself has fewer than minTrades", () => {
    const rows = [{ engine: "legacy", expiry: "60", hits: 10, misses: 2, total: 12 }, { engine: "v3.2", expiry: "60", hits: 100, misses: 0, total: 100 }]
    const gate = flipGate({ rows, legacy: "legacy", candidate: "v3.2", minTrades: 100 })
    expect(gate.flip).toBe(false)
    expect(gate.reason).toContain("legacy")
  })

  it("holds while the new path underperforms the old", () => {
    const rows = [{ engine: "legacy", expiry: "60", hits: 80, misses: 20, total: 100 }, { engine: "v3.2", expiry: "60", hits: 55, misses: 45, total: 100 }]
    const gate = flipGate({ rows, legacy: "legacy", candidate: "v3.2", minTrades: 100 })
    expect(gate.flip).toBe(false)
    expect(gate.candidateExpectancy).toBeLessThan(gate.legacyExpectancy)
  })

  it("never flips with no candidate rows at all", () => {
    const rows = [{ engine: "legacy", expiry: "60", hits: 80, misses: 20, total: 100 }]
    const gate = flipGate({ rows, legacy: "legacy", candidate: "v3.2", minTrades: 100 })
    expect(gate.flip).toBe(false)
    expect(gate.reason).toContain("no")
  })
})

describe("constitution — honesty pins + spec traceability (REQ-CON / REQ-STG)", () => {
  it("every exported constant carries a non-empty REQ source tag", () => {
    const exported = [
      'REQ_CON_2_DEPLOYABLE_FLOOR', 'REQ_CON_3_FORWARD_FLOOR', 'PAYOUT_MARGIN', 'EV_RR_MIN'
    ]
    for (const name of exported) {
      const src = constitutionSourceOf(name)
      expect(src, `${name} must map to a spec tag`).not.toBe("UNVERIFIED — no spec mapping")
      expect(src).toMatch(/REQ-CON|REQ-STG|REQ-L/)
    }
  })

  it("the derived EV-RR floor is never silent about its fallback", () => {
    const thin = deriveEvRRFloor({ byExpiry: { "60": { n: 3, hits: 3, misses: 0 } } }, { minSamples: 50 })
    expect(thin.derived).toBe(false)
    expect(thin.samples).toBe(3) // the honesty label reports why
    const unknown = deriveEvRRFloor({}, { minSamples: 50 })
    expect(unknown.derived).toBe(false)
    expect(unknown.evRRFloor).toBe(EV_RR_MIN)
  })

  it("the flip gate never claims flips without the floor, even on equal-looking numbers", () => {
    // Both engines identical AND above minTrades → flip; missing either → hold.
    const both = [ { engine: "legacy", expiry: "60", hits: 200, misses: 100, total: 300 },
                   { engine: "v3.2", expiry: "60", hits: 200, misses: 100, total: 300 } ]
    expect(flipGate({ rows: both, legacy: "legacy", candidate: "v3.2", minTrades: 100 }).flip).toBe(true)
    const legacyOnly = [ { engine: "legacy", expiry: "60", hits: 200, misses: 100, total: 300 } ]
    expect(flipGate({ rows: legacyOnly, legacy: "legacy", candidate: "v3.2", minTrades: 100 }).flip).toBe(false)
  })

  it("the Constitution veto is an AND: a TRADE never clears when the gate fails, regardless of other gates", () => {
    // Mirror adaptiveConfluence.test.mjs trendCandles — proven to yield a TRADE.
    const trendCandles = (n = 60, step = 0.2, base = 100) => {
      const out = []
      for (let i = 0; i < n; i++) {
        const close = base + step * i
        const open = close - step
        out.push({ time: i * 60, open, high: close + 0.05, low: close - 0.05, close })
      }
      return out
    }
    const passing = evaluateAsset({ id: "142", name: "EUR / USD", candles: trendCandles(), volume: {}, constitution: { ok: true } })
    expect(passing.verdict).toBe("TRADE") // the underlying signal really is a TRADE
    const failing = evaluateAsset({
      id: "142", name: "EUR / USD", candles: trendCandles(), volume: {},
      constitution: { ok: false, reasons: ["require 500 forward samples (have 4)"] }
    })
    expect(failing.verdict).toBe("NEUTRAL") // veto is an AND, not an OR — TRADE never clears
    expect(failing.gates.constitution).toBe(false)
  })
})

describe("constitution — evaluateAsset honor-path (no behavior change while uninvoked)", () => {
  // Mirror adaptiveConfluence.test.mjs trendCandles — proven to yield a TRADE.
  const trendCandles = (n = 60, step = 0.2, base = 100) => {
    const out = []
    for (let i = 0; i < n; i++) {
      const close = base + step * i
      const open = close - step
      out.push({ time: i * 60, open, high: close + 0.05, low: close - 0.05, close })
    }
    return out
  }

  it("passes an ok Constitution through untouched", () => {
    const d = evaluateAsset({ id: "142", name: "EUR / USD", candles: trendCandles(), volume: {} })
    const d2 = evaluateAsset({ id: "142", name: "EUR / USD", candles: trendCandles(), volume: {}, constitution: { ok: true } })
    expect(d2.verdict).toBe(d.verdict)
    expect(d2.gates?.constitution).toBe(true)
  })

  it("downgrades TRADE to NEUTRAL when the Constitution gate fails, with the reason surfaced", () => {
    const d = evaluateAsset({
      id: "142",
      name: "EUR / USD",
      candles: trendCandles(),
      volume: {},
      constitution: { ok: false, reasons: ["require 300 deployable samples (have 3)"] }
    })
    expect(d.verdict).toBe("NEUTRAL")
    expect(d.gates?.constitution).toBe(false)
    expect(d.reasons.some((r) => r.includes("300 deployable"))).toBe(true)
  })
})