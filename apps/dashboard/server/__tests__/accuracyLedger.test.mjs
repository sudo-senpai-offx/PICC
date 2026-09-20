import { describe, expect, test, beforeEach } from "vitest"
import {
  recordDecision,
  resolveResult,
  flushLedger,
  ledgerHistory,
  ledgerStats,
  backtestGates,
  resetLedger,
  sampleEntryPrice,
  correctlyAnsweredByEngine,
  MAX_PENDING_MS
} from "../services/accuracyLedger.mjs"

const trade = {
  assetId: "142",
  asset: "EUR / USD",
  verdict: "TRADE",
  direction: "up",
  expiry: 60,
  winProb: 0.62,
  empirical: 0.58,
  sampled: 25,
  ev: 0.4,
  payout: 82,
  payoutSource: "assumed",
  confidence: 0.7,
  priceRR: 2.4,
  evRR: 4.1,
  gates: { score: true, winProb: true, priceRR: true, evRR: true, payout: true }
}

describe("accuracy ledger", () => {
  beforeEach(() => resetLedger())

  test("records TRADE decisions only, with expiry + predicted edge", () => {
    const entry = recordDecision(trade)
    expect(entry).not.toBeNull()
    expect(entry.verdict).toBeUndefined()
    expect(entry.status).toBe("pending")
    expect(entry.expiresAt - entry.entryTs).toBe(60_000)
    expect(entry.payout).toBe(82)
    expect(entry.gates.score).toBe(true)
    expect(recordDecision({ ...trade, verdict: "OBSERVE" })).toBeNull()
    expect(recordDecision({ ...trade, verdict: "TRADE", expiry: null })).toBeNull()
  })

  test("resolveResult is directionally honest", () => {
    expect(resolveResult("up", 100, 105).outcome).toBe("hit")
    expect(resolveResult("down", 100, 95).outcome).toBe("hit")
    expect(resolveResult("up", 100, 95).outcome).toBe("miss")
    expect(resolveResult("down", 100, 105).outcome).toBe("miss")
    expect(resolveResult("flat", 100, 100).outcome).toBe("push")
    expect(resolveResult("flat", 100, 110).outcome).toBe("miss")
    expect(resolveResult("up", 100, null).outcome).toBe("unresolved")
    expect(resolveResult("up", null, 105).outcome).toBe("unresolved")
  })

  test("flushLedger auto-resolves entries once their expiry has passed", () => {
    const base = Date.now()
    const entry = recordDecision({ ...trade, expiry: 60 })
    entry.entryPrice = 100
    entry.entryTs = base - 90_000
    entry.expiresAt = base - 30_000 // expired 30s ago (> grace)
    const resolved = flushLedger({
      now: base,
      resolve: (e) => (e.assetId === "142" ? 105.5 : null)
    })
    expect(resolved).toHaveLength(1)
    expect(entry.status).toBe("resolved")
    expect(entry.result).toBe("hit")
    expect(entry.exitPrice).toBe(105.5)
  })

  test("flushLedger keeps pending entries before expiry and marks stale ones unresolved", () => {
    const base = Date.now()
    const fresh = recordDecision(trade)
    fresh.entryTs = base
    fresh.expiresAt = base + 30_000
    const stale = recordDecision(trade)
    stale.entryTs = base - MAX_PENDING_MS - 60_000
    stale.expiresAt = base - 10_000
    const resolved = flushLedger({ now: base, resolve: () => 102 })
    expect(resolved).toHaveLength(0)
    expect(fresh.status).toBe("pending")
    expect(stale.status).toBe("unresolved")
  })

  test("ledgerStats computes hit rate, realized EV and expiry buckets", () => {
    const base = Date.now()
    for (const [dir, exit] of [
      ["up", 105], // hit
      ["up", 95], // miss
      ["down", 98], // hit
      ["flat", 100] // push
    ]) {
      const e = recordDecision({ ...trade, direction: dir })
      e.entryTs = base - 90_000
      e.expiresAt = base - 30_000
      e.entryPrice = 100
      flushLedger({ now: base, resolve: () => exit })
    }
    const stats = ledgerStats()
    expect(stats.resolved).toBe(4)
    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
    expect(stats.pushes).toBe(1)
    expect(stats.hitRate).toBeCloseTo(2 / 3, 5)
    // realized EV in fraction-of-stake units (matching predictedEv):
    // hit +0.82, hit +0.82, miss −1, push 0 → 0.64/4 = +0.16 /stake
    expect(stats.realizedEv).toBeCloseTo(0.16, 5)
    expect(stats.byExpiry["60"].n).toBe(4)
    expect(stats.byExpiry["60"].hitRate).toBeCloseTo(2 / 3, 5)
    expect(ledgerHistory(10)).toHaveLength(4)
  })

  test("backtestGates cross-references engine predictions vs demo deals", async () => {
    const base = Date.now()
    for (const [dir, exit] of [
      ["up", 105], // hit
      ["down", 98], // hit
      ["up", 95] // miss
    ]) {
      const e = recordDecision({ ...trade, direction: dir })
      e.entryTs = base - 90_000
      e.expiresAt = base - 30_000
      e.entryPrice = 100
      flushLedger({ now: base, resolve: () => exit })
    }
    const bt = await backtestGates()
    expect(bt.ok).toBe(true)
    expect(bt.engine.n).toBe(3)
    expect(bt.engine.hits).toBe(2)
    expect(bt.engine.misses).toBe(1)
    expect(bt.engine.hitRate).toBeCloseTo(2 / 3, 5)
    expect(bt.engine.predictedEv).toBeCloseTo(0.4, 5)
    // realized EV in fraction-of-stake units: hit +0.82, hit +0.82, miss −1
    // → 0.64/3 ≈ 0.2133 /stake (comparable to predictedEv's fraction scale)
    expect(bt.engine.realizedEv).toBeCloseTo(0.64 / 3, 5)
    // demo-deal side is environment-dependent but must always be a number
    expect(typeof bt.demo.n).toBe("number")
    expect(typeof bt.demo.realizedEv === "number" || bt.demo.realizedEv === null).toBe(true)
    const row = bt.rows.find((r) => r.key === "60")
    expect(row?.engine.n).toBe(3)
    expect(typeof row?.demo.n).toBe("number")
  })
})

describe("accuracy ledger — entry sampling without look-ahead (audit §5.6)", () => {
  const candles = [
    { time: 1700000000, close: 100 },
    { time: 1700000060, close: 101 },
    { time: 1700000120, close: 102 },
    { time: 1700000180, close: 103 } // newest — a post-signal close
  ]

  test("an explicit signal-time price wins over buffer sampling", () => {
    expect(sampleEntryPrice(candles, { at: Date.now(), price: 99.5 })).toEqual({
      price: 99.5,
      candleTime: null
    })
  })

  test("without an explicit price it anchors to the newest candle at-or-before the decision ts", () => {
    // Decision fired during the 101 candle — the 102/103 closes printed AFTER
    // the signal and must never leak into the entry price.
    const at = 1700000090_000 // 90s after epoch → mid-way through the 101 bar (ms)
    expect(sampleEntryPrice(candles, { at })).toEqual({ price: 101, candleTime: 1700000060 })
  })

  test("non-finite/zero explicit prices fall back to signal-time sampling", () => {
    // Invalid preferred prices are ignored — the buffer at/before `at` stands.
    expect(sampleEntryPrice(candles, { price: 0, at: 1700000000_000 }).price).toBe(100)
    expect(sampleEntryPrice(candles, { price: NaN, at: 1700000120_000 }).price).toBe(102)
  })

  test("empty or missing input yields no price, never a throw", () => {
    expect(sampleEntryPrice([], { at: Date.now() })).toEqual({ price: null, candleTime: null })
    expect(sampleEntryPrice(null, { at: Date.now() }).price).toBeNull()
    expect(sampleEntryPrice(undefined).price).toBeNull()
    // A decision ts before any candle exists must not sample the future series.
    expect(sampleEntryPrice(candles, { at: 1 }).price).toBeNull()
  })

  test("recordDecision stores an explicit d.price as the entry price", () => {
    const entry = recordDecision({ ...trade, price: 123.45 })
    expect(entry.entryPrice).toBe(123.45)
    expect(entry.entryCandleTime).toBeNull()
  })

  describe("engine tag + correctly-answered comparator (REQ-STG-1/2, ADR-0004)", () => {
    beforeEach(() => resetLedger())

    test("recordDecision tags entries engine:legacy by default, honoring an explicit engine", () => {
      expect(recordDecision(trade)).toMatchObject({ engine: "legacy" })
      expect(recordDecision({ ...trade, engine: "v3.2" })).toMatchObject({ engine: "v3.2" })
    })

    test("correctlyAnsweredByEngine excludes pushes (a push is never a correct answer)", () => {
      const base = Date.now()
      const hit = recordDecision({ ...trade, engine: "legacy" })
      hit.status = "resolved"; hit.result = "hit"
      const miss = recordDecision({ ...trade, engine: "legacy" })
      miss.status = "resolved"; miss.result = "miss"
      const push = recordDecision({ ...trade, engine: "legacy" })
      push.status = "resolved"; push.result = "push"
      const rows = correctlyAnsweredByEngine()
      const legacy = rows.find((r) => r.engine === "legacy")
      expect(legacy).toEqual({ engine: "legacy", expiry: "60", hits: 1, misses: 1, total: 2 })
    })

    test("splits per engine and per expiry", () => {
      const base = Date.now()
      const mk = (engine, expiry, result) => {
        const e = recordDecision({ ...trade, engine, expiry })
        e.status = "resolved"; e.result = result
      }
      mk("legacy", 60, "hit"); mk("legacy", 60, "hit"); mk("v3.2", 60, "hit")
      mk("legacy", 120, "miss"); mk("v3.2", 120, "hit"); mk("v3.2", 120, "miss")
      const rows = correctlyAnsweredByEngine()
      expect(rows.find((r) => r.engine === "legacy" && r.expiry === "60")).toEqual({ engine: "legacy", expiry: "60", hits: 2, misses: 0, total: 2 })
      expect(rows.find((r) => r.engine === "v3.2" && r.expiry === "60")).toEqual({ engine: "v3.2", expiry: "60", hits: 1, misses: 0, total: 1 })
      expect(rows.find((r) => r.engine === "v3.2" && r.expiry === "120")).toEqual({ engine: "v3.2", expiry: "120", hits: 1, misses: 1, total: 2 })
    })

    test("unresolved and pending entries never count as answers", () => {
      recordDecision({ ...trade, engine: "legacy" }) // pending
      const rows = correctlyAnsweredByEngine()
      expect(rows).toEqual([])
    })
  })
})
