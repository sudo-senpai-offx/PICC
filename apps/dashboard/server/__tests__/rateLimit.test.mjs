import { beforeEach, describe, expect, it, vi } from "vitest"
import { cached, rateLimitStatus, resetRateLimits, setGlobalBudget, throttle } from "../services/rateLimit.mjs"

beforeEach(() => {
  resetRateLimits()
  setGlobalBudget(60)
})

describe("polite rate limiter", () => {
  it("allows the first call and blocks within the cooldown window", async () => {
    const first = throttle("honeygain", 60_000)
    expect(first.allowed).toBe(true)
    expect(first.remainingMs).toBe(0)

    const second = throttle("honeygain", 60_000)
    expect(second.allowed).toBe(false)
    expect(second.remainingMs).toBeGreaterThan(0)
    expect(second.remainingMs).toBeLessThanOrEqual(60_000)

    // Different key is independent.
    expect(throttle("pawns", 60_000).allowed).toBe(true)
  })

  it("enforces the shared per-minute budget", () => {
    setGlobalBudget(2)
    expect(throttle("a", 0).allowed).toBe(true)
    expect(throttle("b", 0).allowed).toBe(true)
    const blocked = throttle("c", 0)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remainingMs).toBeGreaterThan(0)
  })

  it("reports cooldown state for the scheduler status view", () => {
    throttle("repocket", 30_000)
    const status = rateLimitStatus()
    expect(status.budgetPerMinute).toBe(60)
    expect(status.keys.some((k) => k.key === "repocket")).toBe(true)
  })
})

describe("single-flight TTL cache", () => {
  it("shares one loader invocation between concurrent callers", async () => {
    const loader = vi.fn(async () => 42)
    const [a, b, c] = await Promise.all([cached("k", 60_000, loader), cached("k", 60_000, loader), cached("k", 60_000, loader)])
    expect(a).toBe(42)
    expect(b).toBe(42)
    expect(c).toBe(42)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it("returns the cached value without re-running the loader", async () => {
    const loader = vi.fn(async () => "value")
    await cached("k", 60_000, loader)
    await cached("k", 60_000, loader)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it("evicts on rejection so a later call retries", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered")
    await expect(cached("k", 60_000, loader)).rejects.toThrow("boom")
    await expect(cached("k", 60_000, loader)).resolves.toBe("recovered")
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
