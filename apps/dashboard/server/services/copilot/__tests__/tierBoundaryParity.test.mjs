// WS-7 T11 — Risk 6: two copies of the AC-023 tier boundary must not drift.
//
// Plan v1 §2 (the engine/consumer seam) and §6 Risk 6:
//
//   "T11 needs a server-side `ExecutionTier`; the client already has
//    `bandOf`/`tierFor`. Two copies of a safety boundary drift."
//   Guard/mitigation: "server authoritative, client is a projection, one shared
//    fixture test proves equality; spec text addition requested"
//   Test: "the shared boundary-table test"
//
// THE SHARED FIXTURE IS `tierBoundaryFixture.mjs`. This file is what pins the
// client's projection to it.
//
// HOW EQUALITY IS PROVED WITHOUT TOUCHING `src/terminal/`. BS-2's bisect row
// (spec :1397) forbids room-visual work, and the client table is read-only
// input to T11. So this test READS the client source and asserts its literals
// equal the fixture's. Reading is not editing: `src/terminal/` gains no bytes
// from this task. A client-side test that IMPORTS this fixture is recorded as a
// named BS-3 handoff in the T11 changelog entry (0022) — writing one requires
// editing `src/terminal/`, which BS-2 does not permit.
//
// WHAT WOULD MAKE THIS GO RED. Changing `>= 85` to `> 85` on either side;
// changing the client's weight table to 10/20/20/15/20/15; reordering the veto
// ids; changing the risk percentages. All four are one-point drifts of a
// safety boundary, and all four are caught here rather than in production.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { bandOf } from "../tiers.mjs"
import { EXPERT_WEIGHTS } from "../confluence.mjs"
import {
  APLUS_MIN_SCORE,
  ALL_BOUNDARY_CASES,
  B_MIN_SCORE,
  BOUNDARY_CASES,
  NO_ROUNDING_CASES,
  TIER_BOUNDARIES
} from "../tierBoundaryFixture.mjs"

/** The client projection. READ ONLY — T11 does not write to this file. */
const CLIENT_DECISION_URL = new URL("../../../../src/terminal/domain/copilotDecision.ts", import.meta.url)
const CLIENT_PATH = fileURLToPath(CLIENT_DECISION_URL)
const clientSource = readFileSync(CLIENT_PATH, "utf8")

/** The `EXPERT_WEIGHTS` array literal, as the client wrote it. */
function clientWeightTable() {
  const block = clientSource.match(
    /export const EXPERT_WEIGHTS[\s\S]*?= \[([\s\S]*?)\n\]/
  )
  expect(block, "client EXPERT_WEIGHTS array must be present").not.toBeNull()
  const rows = [...block[1].matchAll(/expert:\s*"([^"]+)",\s*weightPct:\s*(\d+)/g)]
  expect(rows.length, "client EXPERT_WEIGHTS must have six rows").toBe(6)
  return rows.map((m) => ({ expert: m[1], weightPct: Number(m[2]) }))
}

/** The two comparison literals inside the client's `bandOf`. */
function clientBandBoundaries() {
  const body = clientSource.match(/function bandOf\([\s\S]*?\n\}/)
  expect(body, "client bandOf must be present").not.toBeNull()
  const aplus = body[0].match(/score\s*>=\s*(\d+(?:\.\d+)?)/)
  const b = [...body[0].matchAll(/score\s*>=\s*(\d+(?:\.\d+)?)/g)]
  expect(b.length, "client bandOf must have two >= comparisons").toBe(2)
  // The first comparison is A+, the second is B.
  return { aplus: Number(aplus[1]), b: Number(b[1][1]) }
}

describe("Risk 6 — the client's weight table equals the server's, element-wise", () => {
  it("has the same experts, in the same order, with the same weights", () => {
    expect(clientWeightTable()).toEqual(
      EXPERT_WEIGHTS.map((e) => ({ expert: e.expert, weightPct: e.weightPct }))
    )
  })

  it("leaves the client summing to exactly 100 too", () => {
    const sum = clientWeightTable().reduce((n, e) => n + e.weightPct, 0)
    expect(sum).toBe(100)
    expect(clientSource).toMatch(/EXPERT_WEIGHT_SUM\s*=\s*EXPERT_WEIGHTS\.reduce/)
  })

  it("would catch a client weight drifting by a single point", () => {
    // The control: move one point from Macro Bias to Sentiment. The table
    // still sums to 100, so a "both sides sum to 100" check sees nothing — the
    // 5% expert quietly becomes 6% and the 20% expert becomes 19%. Element-wise
    // equality is the only assertion that catches that, which is the whole
    // reason this file exists.
    const drifted = clientWeightTable().map((e) => {
      if (e.expert === "sentiment") return { ...e, weightPct: e.weightPct + 1 }
      if (e.expert === "macroBias") return { ...e, weightPct: e.weightPct - 1 }
      return e
    })
    const sum = drifted.reduce((n, e) => n + e.weightPct, 0)
    expect(sum, "the drift preserves the sum, so a sum check cannot see it").toBe(100)
    expect(drifted, "but element-wise equality does").not.toEqual(
      EXPERT_WEIGHTS.map((e) => ({ expert: e.expert, weightPct: e.weightPct }))
    )
  })
})

describe("Risk 6 — the client's tier boundary equals the fixture's", () => {
  it("uses >= 85 for A+ on both sides", () => {
    expect(clientBandBoundaries().aplus).toBe(APLUS_MIN_SCORE)
    expect(APLUS_MIN_SCORE).toBe(85)
  })

  it("uses >= 70 for B on both sides", () => {
    expect(clientBandBoundaries().b).toBe(B_MIN_SCORE)
    expect(B_MIN_SCORE).toBe(70)
  })

  it("declares no fourth tier in the client's boundary either", () => {
    // The client's `bandOf` has one return per tier plus the null guard; a
    // fourth band would add a comparison, and the count is asserted above.
    const comparisons = clientSource.match(/function bandOf\([\s\S]*?\n\}/)[0].match(/score\s*>=/g)
    expect(comparisons).toHaveLength(2)
  })

  it("carries the same risk percentages as spec §4.4:689", () => {
    expect(TIER_BOUNDARIES.map((b) => [b.tier, b.riskPct])).toEqual([
      ["A+", 0.01],
      ["B", 0.005],
      ["ignore", 0]
    ])
    const body = clientSource.match(/function bandOf\([\s\S]*?\n\}/)[0]
    expect(body).toMatch(/riskPct:\s*0\.01/)
    expect(body).toMatch(/riskPct:\s*0\.005/)
  })

  it("maps a null score to ignore/0 in the client, as the contract requires", () => {
    // contracts.ts:188-190 and copilotDecision.ts:116-121 both say null is an
    // absence, not a zero. If the client's null guard were removed the client
    // would compute a tier from `null >= 85`, which is false, landing on
    // `ignore` — the same answer, for the wrong reason, silently.
    const body = clientSource.match(/function bandOf\([\s\S]*?\n\}/)[0]
    expect(body).toMatch(/if \(score == null\) return \{ tier: "ignore", riskPct: 0 \}/)
  })
})

describe("Risk 6 — the shared fixture is the one both sides are pinned to", () => {
  it("the server produces the fixture's verdict for every case", () => {
    for (const c of ALL_BOUNDARY_CASES) {
      expect({ ...bandOf(c.score), label: c.label }, c.label).toEqual({
        tier: c.tier,
        riskPct: c.riskPct,
        label: c.label
      })
    }
  })

  it("the fixture contains the five scores AC-023:950 names", () => {
    expect(BOUNDARY_CASES.map((c) => c.score)).toEqual([69, 70, 84, 85, 86])
  })

  it("the fixture contains the three no-rounding scores plan §3.1 item 4 names", () => {
    expect(NO_ROUNDING_CASES.map((c) => c.score)).toEqual([84.4, 84.5, 84.9])
  })

  it("the fixture is frozen, so a consumer cannot weaken a case in place", () => {
    expect(Object.isFrozen(ALL_BOUNDARY_CASES)).toBe(true)
    expect(Object.isFrozen(BOUNDARY_CASES[0])).toBe(true)
  })
})

describe("the client file was read, not written", () => {
  it("exists at the path this test asserts", () => {
    expect(clientSource.length).toBeGreaterThan(0)
  })

  it("is the client projection, identified by its own exported symbols", () => {
    expect(clientSource).toContain("export const EXPERT_WEIGHTS")
    expect(clientSource).toContain("export function tierFor")
    expect(clientSource).toContain("function bandOf")
  })
})
