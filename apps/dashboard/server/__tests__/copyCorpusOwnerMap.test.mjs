import { describe, expect, it } from "vitest"
import { ownerRowsToStates } from "../services/copyCorpusOwnerMap.mjs"
import { behaviourGivenState } from "../services/copyCorpusBehaviour.mjs"

const T0 = Date.parse("2026-01-01T00:00:00Z")
const jrnl = (over = {}) => ({
  status: "closed",
  pnl: 0,
  entryTime: T0,
  pattern: "breakout",
  strategy: "trend-follow",
  ...over,
})
const states = (rows) => ownerRowsToStates(rows).map((r) => r.stateBefore)

describe("ownerRowsToStates", () => {
  it("maps consecutive-loss counts, never identity strings", () => {
    const rows = [
      jrnl({ entryTime: T0, pnl: -100 }),
      jrnl({ entryTime: T0 + 1, pnl: -50 }),
      jrnl({ entryTime: T0 + 2, pnl: 10 }),
    ]
    expect(states(rows)).toEqual(["unknown", "after-1-loss", "after-2-losses"])
  })

  it("maps post-win state from the prior closed trade", () => {
    const rows = [
      jrnl({ entryTime: T0, pnl: 120 }),
      jrnl({ entryTime: T0 + 1, pnl: -5 }),
    ]
    expect(states(rows)).toEqual(["unknown", "after-win"])
  })

  it("maps drawdown bands from cumulative-pnl peak (drawdown overrides streak)", () => {
    const rows = [
      jrnl({ entryTime: T0, pnl: 1000 }),
      jrnl({ entryTime: T0 + 1, pnl: 1000 }),
      jrnl({ entryTime: T0 + 2, pnl: -200 }),
      jrnl({ entryTime: T0 + 3, pnl: -200 }),
      jrnl({ entryTime: T0 + 4, pnl: -10 }),
    ]
    const got = states(rows)
    expect(got[0]).toBe("unknown")
    expect(got[1]).toBe("after-win")
    // stateBefore derives from priors only: row2 still sees peak cum 2000
    expect(got[2]).toBe("after-win")
    // cum 1800 vs peak 2000 -> dd 10%: band overrides the 1-loss streak
    expect(got[3]).toBe("drawdown-5pct")
    expect(got[4]).toBe("drawdown-5pct")
  })

  it("honours an explicit drawdownPctBefore band field when present", () => {
    const rows = [
      jrnl({ entryTime: T0, pnl: 50 }),
      { ...jrnl({ entryTime: T0 + 1, pnl: 5 }), drawdownPctBefore: 7.5 },
    ]
    expect(states(rows)).toEqual(["unknown", "drawdown-5pct"])
  })

  it("unmappable rows become unknown, never invented", () => {
    expect(states([])).toEqual([])
    expect(states([{}])).toEqual(["unknown"]) // no history fields at all
    expect(states([{ pattern: "breakout", strategy: "x" }])).toEqual(["unknown"]) // identity is never mapped
    expect(states([{ status: "open", pnl: null, entryTime: T0 }])).toEqual(["unknown"]) // no priors
    // breakeven priors carry no win/loss state
    expect(
      states([jrnl({ entryTime: T0, pnl: 0 }), jrnl({ entryTime: T0 + 1, pnl: 5 })])
    ).toEqual(["unknown", "unknown"])
  })

  it("is deterministic and chronological regardless of input order", () => {
    const a = jrnl({ entryTime: T0, pnl: -100 })
    const b = jrnl({ entryTime: T0 + 1, pnl: -50 })
    const c = jrnl({ entryTime: T0 + 2, pnl: 10 })
    // output aligns to input positions; the STATE per row is chronological either way
    expect(states([c, a, b])).toEqual(["after-2-losses", "unknown", "after-1-loss"])
    expect(ownerRowsToStates([c, a, b]).find((r, i) => [c, a, b][i] === c).stateBefore).toBe(
      ownerRowsToStates([a, b, c]).find((r, i) => [a, b, c][i] === c).stateBefore
    )
    expect(states([a, b])).toEqual(states([a, b]))
  })

  it("output feeds behaviourGivenState so ownerComparable becomes evaluable", () => {
    const journal = [
      jrnl({ entryTime: T0, pnl: 1000 }),
      jrnl({ entryTime: T0 + 1, pnl: 1000 }),
      jrnl({ entryTime: T0 + 2, pnl: -200 }),
      jrnl({ entryTime: T0 + 3, pnl: 5 }),
    ]
    const ownerRows = ownerRowsToStates(journal)
    expect(ownerRows.every((r) => typeof r.stateBefore === "string")).toBe(true)
    const ext = [{ stateBefore: "drawdown-5pct", sizeResponse: "cut" }]
    const out = behaviourGivenState(ext, { ownerRows })
    expect(out.rules.find((r) => r.state === "drawdown-5pct").ownerComparable).toBe(true)
  })
})
