import { describe, expect, test } from "vitest"
import { percentileOfLast } from "../services/contextCoordinates.mjs"

describe("percentileOfLast", () => {
  test("last value equal to the series max is 100th percentile", () => {
    const r = percentileOfLast([1, 2, 3, 4, 5], {})
    expect(r.percentile).toBe(1)
    expect(r.n).toBe(5)
  })

  test("last value equal to the series min is 0th percentile", () => {
    const r = percentileOfLast([5, 4, 3, 2, 1], {})
    expect(r.percentile).toBe(0.2)
    expect(r.n).toBe(5)
  })

  test("empty series is honest null", () => {
    const r = percentileOfLast([], {})
    expect(r.percentile).toBeNull()
    expect(r.n).toBe(0)
  })

  test("window trims to trailing slice", () => {
    const r = percentileOfLast([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { window: 5 })
    expect(r.n).toBe(5)
    expect(r.value).toBe(10)
    expect(r.percentile).toBe(1)
  })

  test("flat window is neutral, not top-ranked", () => {
    const r = percentileOfLast([3, 3, 3, 3, 3], {})
    expect(r.percentile).toBe(0.5)
    expect(r.n).toBe(5)
  })

  test("non-finite values are excluded from the rank", () => {
    const r = percentileOfLast([1, null, 2, 3, NaN, 4, 5], {})
    expect(r.n).toBe(5)
    expect(r.percentile).toBe(1)
  })
})