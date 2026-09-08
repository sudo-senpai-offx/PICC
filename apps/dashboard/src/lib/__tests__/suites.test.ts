import { describe, expect, it } from "vitest"
import { SUITE_META, suiteMeta } from "@/lib/suites"

describe("ministry registry", () => {
  it("exposes exactly the three ministry ids", () => {
    expect(Object.keys(SUITE_META).sort()).toEqual(["earnings", "intelligence", "trading"])
  })

  it("flags Trading as production and Earnings/Intelligence as under-development", () => {
    expect(SUITE_META.trading.status).toBe("production")
    expect(SUITE_META.earnings.status).toBe("under-development")
    expect(SUITE_META.intelligence.status).toBe("under-development")
  })

  it("records a core-purpose blurb per ministry", () => {
    for (const meta of Object.values(SUITE_META)) {
      expect(meta.blurb.length).toBeGreaterThan(0)
    }
  })

  it("resolves an id via suiteMeta", () => {
    expect(suiteMeta("trading")?.label).toBe("Trading")
  })

  it("returns null for a retired category id", () => {
    expect(suiteMeta("depin")).toBeNull()
  })
})
