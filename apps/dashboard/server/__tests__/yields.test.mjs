import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetRateLimits, throttle } from "../services/rateLimit.mjs"
import { NATIVE_STAKING, fetchDefiPools, yieldSnapshot } from "../services/yields.mjs"

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  }
}

const POOLS = [
  { pool: "aave-v3-usdc", project: "Aave", symbol: "USDC", chain: "Ethereum", apy: 5.2, apyBase: 5.2, apyReward: 0, tvlUsd: 1.2e9, il7d: 0 },
  { pool: "lido-steth", project: "Lido", symbol: "stETH", chain: "Ethereum", apy: 3.1, apyBase: 3.1, apyReward: 0, tvlUsd: 3e10, il7d: 0 },
  { pool: "lido-steth-arb", project: "Lido", symbol: "stETH", chain: "Arbitrum", apy: 2.9, apyBase: 2.9, apyReward: 0, tvlUsd: 2e10, il7d: 0 },
  { pool: "lido-wsteth", project: "Lido", symbol: "wstETH", chain: "Ethereum", apy: 3.0, apyBase: 3.0, apyReward: 0, tvlUsd: 3.5e10, il7d: 0 },
  { pool: "scam-token", project: "Scam", symbol: "X7", chain: "BSC", apy: 1500, apyBase: 0, apyReward: 1500, tvlUsd: 5e7, il7d: 0 },
  { pool: "tiny-pool", project: "Tiny", symbol: "TOKEN", chain: "Polygon", apy: 25, apyBase: 0, apyReward: 25, tvlUsd: 1e5, il7d: 0 },
  { pool: "lp-vault", project: "Vault", symbol: "ETH-USDC", chain: "Arbitrum", apy: 9.4, apyBase: 1.2, apyReward: 8.2, tvlUsd: 2e7, il7d: -8.1 }
]

beforeEach(() => {
  resetRateLimits()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("yield snapshot", () => {
  it("maps, filters and sorts DeFi pools by APY", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: POOLS })))

    const snap = await yieldSnapshot()

    // Scam pool excluded (apy > maxApy), Tiny excluded (tvl < $10M default).
    expect(snap.defi.map((p) => p.pool)).toEqual(["lp-vault", "aave-v3-usdc", "lido-steth", "lido-wsteth", "lido-steth-arb"])
    expect(snap.defi[0]).toMatchObject({ project: "Vault", apy: 9.4, ilRisk: true })
    expect(snap.defi[1]).toMatchObject({ project: "Aave", apyBase: 5.2, apyReward: 0, ilRisk: false })
  })

  it("honors minTvlUsd / top overrides", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: POOLS })))

    const snap = await yieldSnapshot({ minTvlUsd: 1e5, top: 2 })
    expect(snap.defi).toHaveLength(2)
    expect(snap.defi.some((p) => p.pool === "tiny-pool")).toBe(true)
    expect(snap.filters.minTvlUsd).toBe(1e5)
  })

  it("derives liquid-staking rates from the pools list, best APY per symbol, sorted by APY", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: POOLS })))

    const snap = await yieldSnapshot()
    // stETH appears twice; the higher-APY pool wins the slot. stETH (3.1)
    // outranks wstETH (3.0), which outranks the lower-APY duplicate.
    expect(snap.lsd.map((r) => r.symbol)).toEqual(["stETH", "wstETH"])
    expect(snap.lsd[0]).toMatchObject({ symbol: "stETH", apy: 3.1, tvlUsd: 3e10 })
    expect(snap.lsd[1]).toMatchObject({ symbol: "wstETH", apy: 3.0, tvlUsd: 3.5e10 })
  })

  it("returns the curated native-staking reference table", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: POOLS })))

    const snap = await yieldSnapshot()
    expect(snap.native).toBe(NATIVE_STAKING)
    expect(snap.native.length).toBeGreaterThan(5)
    const atom = snap.native.find((r) => r.symbol === "ATOM")
    expect(atom.apyHigh).toBeGreaterThan(18)
  })

  it("degrades honestly when the source returns no data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})))

    const snap = await yieldSnapshot()
    expect(snap.ok).toBe(true)
    expect(snap.defi).toEqual([])
    expect(snap.lsd).toEqual([])
    expect(snap.native.length).toBeGreaterThan(0)
  })

  it("rejects honestly when the source is rate-limited", async () => {
    // Consume the yield:defi cooldown directly, then a fresh fetch attempt
    // (cache cleared by resetRateLimits) must report the courtesy limit.
    const gated = throttle("yields:defi", 60_000)
    expect(gated.allowed).toBe(true)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [] })))

    await expect(fetchDefiPools()).rejects.toThrow("rate limited")
  })
})
