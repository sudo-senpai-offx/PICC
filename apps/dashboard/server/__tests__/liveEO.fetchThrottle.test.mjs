import { describe, expect, test } from "vitest"
import {
  pruneLiveFetchMap,
  LIVE_FETCH_TTL_MS,
  LIVE_FETCH_MAX_KEYS
} from "../services/liveEO.mjs"

describe("liveEO per-key fetch throttle (audit §5.2 — bounded map)", () => {
  const at = 1_800_000_000_000 // fixed "now" for determinism

  test("drops entries idle past the TTL", () => {
    const map = new Map([
      ["BTCUSD:60", at - LIVE_FETCH_TTL_MS - 1000], // expired
      ["ETHUSD:60", at - 10_000], // still useful
      ["GOLD:60", at - LIVE_FETCH_TTL_MS] // exactly at the boundary → kept (< cutoff is strict)
    ])
    const size = pruneLiveFetchMap(map, { now: at })
    expect(size).toBe(2)
    expect(map.has("BTCUSD:60")).toBe(false)
    expect(map.has("ETHUSD:60")).toBe(true)
    expect(map.has("GOLD:60")).toBe(true)
  })

  test("enforces the hard key cap by evicting oldest-first", () => {
    const map = new Map()
    for (let i = 0; i < LIVE_FETCH_MAX_KEYS + 40; i++) {
      map.set(`asset-${i}:60`, at - 1000) // all fresh (within TTL)
    }
    pruneLiveFetchMap(map, { now: at })
    expect(map.size).toBe(LIVE_FETCH_MAX_KEYS)
    // Oldest keys were evicted first (Map preserves insertion order).
    expect(map.has("asset-0:60")).toBe(false)
    expect(map.has(`asset-${LIVE_FETCH_MAX_KEYS + 39}:60`)).toBe(true)
  })

  test("non-Map input and tiny maps are harmless", () => {
    expect(pruneLiveFetchMap(null, { now: at })).toBe(0)
    expect(pruneLiveFetchMap(undefined, { now: at })).toBe(0)
    expect(pruneLiveFetchMap(new Map([["a:60", at]]), { now: at })).toBe(1)
  })
})
