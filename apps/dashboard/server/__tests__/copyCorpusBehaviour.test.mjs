import { describe, expect, it } from "vitest"
import { behaviourGivenState } from "../services/copyCorpusBehaviour.mjs"

const ext = [
  { stateBefore: "drawdown-5pct", sizeResponse: "increase" },
  { stateBefore: "drawdown-5pct", sizeResponse: "cut" },
  { stateBefore: "drawdown-5pct", sizeResponse: "cut" },
  { stateBefore: "after-2-losses", sizeResponse: "halved" },
]
describe("behaviourGivenState", () => {
  it("conditions on state and marks owner-comparability", () => {
    const out = behaviourGivenState(ext, { ownerRows: [{ stateBefore: "drawdown-5pct" }] })
    const d = out.rules.find((r) => r.state === "drawdown-5pct")
    expect(d.n).toBe(3)
    expect(d.ownerComparable).toBe(true)
    expect(out.rules.find((r) => r.state === "after-2-losses").ownerComparable).toBe(false)
  })
  it("empty input is a named absence, not a zero", () => {
    const out = behaviourGivenState([])
    expect(out.rules).toEqual([])
    expect(typeof out.bias.reason).toBe("string")
  })
})
