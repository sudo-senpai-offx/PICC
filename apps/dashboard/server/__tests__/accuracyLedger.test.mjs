import { describe, expect, test, beforeEach } from "vitest"
import {
  recordDecision,
  resolveResult,
  flushLedger,
  ledgerHistory,
  ledgerStats,
  backtestGates,
  resetLedger,
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
    // realized EV: hit +82, hit +82, miss -100, push 0 → 64/4 = +16 %/stake
    expect(stats.realizedEv).toBeCloseTo(16, 5)
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
    // realized EV: hit +82, hit +82, miss -100 → 64/3 = 21.33 %/stake
    expect(bt.engine.realizedEv).toBeCloseTo(64 / 3, 5)
    // demo-deal side is environment-dependent but must always be a number
    expect(typeof bt.demo.n).toBe("number")
    expect(typeof bt.demo.realizedEv === "number" || bt.demo.realizedEv === null).toBe(true)
    const row = bt.rows.find((r) => r.key === "60")
    expect(row?.engine.n).toBe(3)
    expect(typeof row?.demo.n).toBe("number")
  })
})
