import { describe, expect, it } from "vitest"
import { convertToUsd } from "../services/wealth/fx.mjs"

const readers = (yahoo, ccxt) => ({ yahooQuote: async () => yahoo, ccxtQuote: async () => ccxt })

describe("fx", () => {
  // NOTE (Task 2 executor): the plan's fixture used fixed 2026-10-08T00:00:10Z
  // stamps, which go stale-beyond-threshold under binding decision 19 as the
  // wall clock moves (hermetic-tests global constraint). Fixtures are issued
  // relative to now so the suite is time-independent; assertions unchanged.
  const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString()

  it("freshest quote wins, tie goes to ccxt", async () => {
    const at = secondsAgo(10)
    const r = await convertToUsd("MYR", 18, readers(
      { rate: 0.21, quotedAt: at },
      { rate: 0.22, quotedAt: at }))
    expect(r.usd).toBeCloseTo(18 * 0.22)
    expect(r.fxSource).toBe("ccxt")
  })
  it("freshest quote wins when timestamps differ", async () => {
    const r = await convertToUsd("MYR", 18, readers(
      { rate: 0.21, quotedAt: secondsAgo(5) },
      { rate: 0.22, quotedAt: secondsAgo(60) }))
    expect(r.usd).toBeCloseTo(18 * 0.21)
    expect(r.fxSource).toBe("yahoo")
  })
  it("pegged stables use declared parity without observation", async () => {
    const r = await convertToUsd("USDT", 10, readers(null, null))
    expect(r.usd).toBe(10)
    expect(r.fxSource).toBe("declared-parity")
  })
  it("missing rates exclude with reason", async () => {
    const r = await convertToUsd("MYR", 18, readers(null, null))
    expect(r.usd).toBe(null)
    expect(r.reason).toMatch(/fx-unobservable/)
  })
  it("stale-beyond-threshold quotes exclude with reason", async () => {
    const old = secondsAgo(10 * 60)
    const r = await convertToUsd("MYR", 18, readers(
      { rate: 0.21, quotedAt: old },
      { rate: 0.22, quotedAt: old }))
    expect(r.usd).toBe(null)
    expect(r.reason).toMatch(/fx-unobservable:MYR/)
  })
})
