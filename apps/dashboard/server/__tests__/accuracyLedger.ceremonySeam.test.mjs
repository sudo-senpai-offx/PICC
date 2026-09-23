import { describe, expect, test, beforeEach } from "vitest"
import {
  recordDecision,
  flushLedger,
  resetLedger,
  registerResolveConsumer,
  MAX_PENDING_MS
} from "../services/accuracyLedger.mjs"

const trade = {
  assetId: "142",
  asset: "EUR / USD",
  verdict: "TRADE",
  direction: "up",
  expiry: 60,
  winProb: 0.62
}

const resolveExit = (e) => (e.direction === "flat" ? 100 : 105)

function pastEntry(base, extra = {}) {
  const e = recordDecision({ ...trade, ...extra })
  e.entryPrice = 100
  e.entryTs = base - 90_000
  e.expiresAt = base - 30_000
  return e
}

describe("accuracy ledger — ceremony seam (R2 / M1)", () => {
  beforeEach(() => {
    resetLedger()
    registerResolveConsumer(() => {})
  })

  test("recordDecision defaults venueClass null and provenance real when absent", () => {
    const e = recordDecision(trade)
    expect(e.venueClass).toBeNull()
    expect(e.provenance).toBe("real")
  })

  test("recordDecision stores explicit venueClass and provenance", () => {
    const e = recordDecision({ ...trade, venueClass: "ccxt-crypto", provenance: "sim" })
    expect(e.venueClass).toBe("ccxt-crypto")
    expect(e.provenance).toBe("sim")
  })

  test("a sim row is stored distinguishable and the fixture consumer receives it (provenance passes through)", () => {
    const base = Date.now()
    const calls = []
    registerResolveConsumer(({ entry, verdict }) =>
      calls.push({ verdict, provenance: entry.provenance, venueClass: entry.venueClass })
    )
    const sim = pastEntry(base, { direction: "up", venueClass: "ccxt-crypto", provenance: "sim" })
    flushLedger({ now: base, resolve: resolveExit })
    expect(sim.provenance).toBe("sim")
    expect(sim.venueClass).toBe("ccxt-crypto")
    expect(calls).toEqual([{ verdict: "hit", provenance: "sim", venueClass: "ccxt-crypto" }])
  })

  test("flushLedger behaves identically with no consumer registered (default no-op)", () => {
    const base = Date.now()
    const run = () => {
      const rows = [
        pastEntry(base, { direction: "up" }),
        pastEntry(base, { direction: "down" }),
        pastEntry(base, { direction: "flat" })
      ]
      const resolved = flushLedger({ now: base, resolve: resolveExit })
      return { results: resolved.map((r) => r.result), statuses: rows.map((r) => r.status) }
    }
    const plain = run()
    expect(plain).toEqual({ results: ["hit", "miss", "push"], statuses: ["resolved", "resolved", "resolved"] })
    resetLedger()
    const calls = []
    registerResolveConsumer(({ verdict }) => calls.push(verdict))
    const withConsumer = run()
    expect(withConsumer).toEqual(plain)
    expect(calls).toEqual(["hit", "miss", "push"])
  })

  test("consumer invoked once per resolved row with verdict hit/miss/push and the row entry", () => {
    const base = Date.now()
    const calls = []
    registerResolveConsumer(({ entry, verdict }) => calls.push({ entry, verdict }))
    const hit = pastEntry(base, { direction: "up" })
    const miss = pastEntry(base, { direction: "down" })
    const push = pastEntry(base, { direction: "flat" })
    flushLedger({ now: base, resolve: resolveExit })
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({ entry: hit, verdict: "hit" })
    expect(calls[1]).toEqual({ entry: miss, verdict: "miss" })
    expect(calls[2]).toEqual({ entry: push, verdict: "push" })
  })

  test("a throwing resolve consumer never breaks flushLedger", () => {
    const base = Date.now()
    const calls = []
    registerResolveConsumer(({ entry, verdict }) => {
      if (entry.assetId === "BOOM") throw new Error("consumer boom")
      calls.push(verdict)
    })
    const boom = pastEntry(base, { direction: "up", assetId: "BOOM" })
    const ok = pastEntry(base, { direction: "up" })
    const ok2 = pastEntry(base, { direction: "down" })
    const out = flushLedger({ now: base, resolve: resolveExit })
    expect(out.map((r) => r.result)).toEqual(["hit", "hit", "miss"])
    expect(boom.status).toBe("resolved")
    expect(ok.status).toBe("resolved")
    expect(ok2.status).toBe("resolved")
    expect(calls).toEqual(["hit", "miss"])
    const later = pastEntry(base, { direction: "up" })
    flushLedger({ now: base, resolve: resolveExit })
    expect(later.status).toBe("resolved")
  })

  test("pending and unresolved rows never reach the resolve consumer", () => {
    const base = Date.now()
    const calls = []
    registerResolveConsumer(({ verdict }) => calls.push(verdict))
    const fresh = recordDecision(trade)
    fresh.entryTs = base
    fresh.expiresAt = base + 30_000
    const stale = recordDecision(trade)
    stale.entryTs = base - MAX_PENDING_MS - 60_000
    stale.expiresAt = base - 10_000
    const out = flushLedger({ now: base, resolve: () => 102 })
    expect(out).toHaveLength(0)
    expect(fresh.status).toBe("pending")
    expect(stale.status).toBe("unresolved")
    expect(calls).toEqual([])
  })

  test("registerResolveConsumer is exported and stores a single consumer (last registration wins)", () => {
    expect(typeof registerResolveConsumer).toBe("function")
    const base = Date.now()
    const first = []
    const second = []
    registerResolveConsumer(({ verdict }) => first.push(verdict))
    registerResolveConsumer(({ verdict }) => second.push(verdict))
    pastEntry(base, { direction: "up" })
    flushLedger({ now: base, resolve: resolveExit })
    expect(first).toEqual([])
    expect(second).toEqual(["hit"])
  })
})