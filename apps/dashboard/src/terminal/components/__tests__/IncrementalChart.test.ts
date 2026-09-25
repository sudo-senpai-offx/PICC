// WS-6 T6 — incremental chart update decision (RED, AC-003).
//
// AC-003: a latest-bar tick must use the library's incremental path, a
// structural change must trigger a bounded refresh, and bar-only missing fields
// must be shown as unavailable rather than filled. The existing
// CandlestickChart.tsx:437-444 calls setData on every series update, which is a
// full replacement per tick.
import { describe, expect, it } from "vitest"
import { planChartUpdate } from "../IncrementalChart"

const bar = (time: number, close = 100) => ({ time, open: close, high: close + 1, low: close - 1, close })

describe("planChartUpdate — incremental path", () => {
  it("uses an incremental update when only the latest bar changed", () => {
    const plan = planChartUpdate([bar(1), bar(2), bar(3)], [bar(1), bar(2), bar(3, 105)])
    expect(plan.kind).toBe("incremental")
    expect(plan.bars).toHaveLength(1)
    expect(plan.bars?.[0].close).toBe(105)
  })

  it("uses an incremental update when a new latest bar is appended", () => {
    const plan = planChartUpdate([bar(1), bar(2)], [bar(1), bar(2), bar(3)])
    expect(plan.kind).toBe("incremental")
    expect(plan.bars).toHaveLength(1)
  })

  it("falls back to a full replace when bar COUNT shrinks", () => {
    const plan = planChartUpdate([bar(1), bar(2), bar(3)], [bar(1), bar(2)])
    expect(plan.kind).toBe("replace")
  })

  it("falls back to a full replace when a historical bar is rewritten", () => {
    const plan = planChartUpdate([bar(1, 100), bar(2, 100)], [bar(1, 999), bar(2, 100)])
    expect(plan.kind).toBe("replace")
  })

  it("falls back to a full replace when the first timestamp changes", () => {
    const plan = planChartUpdate([bar(1), bar(2)], [bar(9), bar(2)])
    expect(plan.kind).toBe("replace")
  })

  it("does not report incremental for an unchanged series", () => {
    // No change means no work; a plan must say so rather than churn.
    const plan = planChartUpdate([bar(1), bar(2)], [bar(1), bar(2)])
    expect(plan.kind).toBe("noop")
  })

  it("falls back to a full replace when going from no series to some", () => {
    expect(planChartUpdate([], [bar(1)]).kind).toBe("replace")
  })
})

describe("planChartUpdate — bar-only honesty (AC-003, D14)", () => {
  it("marks derived-only fields unavailable rather than filling them", () => {
    const plan = planChartUpdate([bar(1), bar(2)], [bar(1), bar(2, 105)])
    expect(plan.unavailableFields).toContain("delta")
    expect(plan.unavailableFields).toContain("cvd")
    expect(plan.unavailableFields).toContain("absorption")
  })

  it("never emits a numeric placeholder for an unavailable field", () => {
    const plan = planChartUpdate([bar(1)], [bar(1, 101)])
    for (const field of plan.unavailableFields) {
      expect(plan.values[field as keyof typeof plan.values], `${field} must not be filled`).toBeUndefined()
    }
  })
})
