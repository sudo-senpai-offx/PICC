import { describe, expect, test } from "vitest"
import { renderVerdict } from "../services/commandCentre/modeEngine.mjs"
import { deliberate } from "../services/commandCentre/deliberation.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"

const ccxt = () => templateForSite("trading:ccxt")

function greenInputs(overrides = {}) {
  return {
    killSwitch: false,
    optIn: true,
    breakers: { dailyLossHalted: false, regimeHalted: false, siteCapped: false },
    staleFeeds: [],
    workability: 1,
    deliberation: null,
    advisory: null,
    demoActive: false,
    breadcrumbs: [],
    ...overrides
  }
}

/** A signed ONE-WAY board converges positive — a +1 surface that only downgrades. */
function plusBoard(maxRounds = 3) {
  return deliberate({
    graph: ccxt(),
    decisionNode: "consensus",
    findings: [
      { agentId: "technical", side: 1, strength: 1 },
      { agentId: "regime", side: 1, strength: 1 },
      { agentId: "volatility", side: 1, strength: 1 }
    ],
    maxRounds,
    convergenceDelta: 0.05
  })
}

/** A genuinely non-converged board: a hop-2 arrival swings the surface again while
 * the 2-round budget is spent — the divergence cutoff fires, honestly. */
function wildBoard() {
  return deliberate({
    graph: templateForSite("bandwidth:browser"),
    decisionNode: "payout",
    findings: [
      { agentId: "credential", side: 1, strength: 1 }, // hop 1
      { agentId: "daily_quest", side: -1, strength: 0.5 }, // hop 1
      { agentId: "uptime_node", side: 1, strength: 1 } // hop 2 — swings at the cut
    ],
    maxRounds: 2,
    convergenceDelta: 0.05
  })
}

describe("Command Centre — Mode Engine slice 3: deliberation wiring", () => {
  test("absent deliberation still yields the honest not-yet-available marker", () => {
    const v = renderVerdict(ccxt(), greenInputs())
    expect(v.deliberation).toBe("not-yet-available")
    expect(v.reason.some((r) => r.includes("not yet available"))).toBe(true)
  })

  test("converged positive board keeps workability ≥ floor → AUTOPILOT (never above gates)", () => {
    const board = plusBoard()
    expect(board.convergence).toBe("converged")
    const v = renderVerdict(ccxt(), greenInputs({ deliberation: board }))
    expect(v.mode).toBe("AUTOPILOT")
    expect(v.deliberation.convergence).toBe("converged")
  })

  test("converged board cannot push an already-BLOCKED site up", () => {
    const board = plusBoard()
    const v = renderVerdict(
      ccxt(),
      greenInputs({ deliberation: board, killSwitch: true })
    )
    expect(v.mode).toBe("BLOCKED")
  })

  test("converged negative surface can downgrade workability below the floor", () => {
    // workability exactly at floor 0.5, board surface −1 → effective 0.40 < floor
    const minusBoard = deliberate({
      graph: ccxt(),
      decisionNode: "consensus",
      findings: [
        { agentId: "technical", side: -1, strength: 1 },
        { agentId: "regime", side: -1, strength: 1 },
        { agentId: "volatility", side: -1, strength: 1 }
      ],
      maxRounds: 3,
      convergenceDelta: 0.05
    })
    expect(minusBoard.convergence).toBe("converged")
    const v = renderVerdict(
      ccxt(),
      greenInputs({ workability: 0.5, deliberation: minusBoard })
    )
    expect(v.mode).toBe("COPILOT")
    expect(v.reason.some((r) => r.includes("reduces effective workability"))).toBe(true)
  })

  test("non-converged board → conservative COPILOT, LLM/advisory excluded (never executes on a failed board)", () => {
    const board = wildBoard()
    expect(board.convergence).toBe("non-converged")
    const v = renderVerdict(
      ccxt(),
      greenInputs({ deliberation: board, advisory: { direction: "up", reason: "LLM confident" } })
    )
    expect(v.mode).toBe("COPILOT") // even with an upgrade-bent advisory, capped at COPILOT and excluded
    expect(v.reason.some((r) => r.includes("non-converged"))).toBe(true)
    expect(v.reason.some((r) => r.includes("advisory input excluded"))).toBe(true)
    expect(v.audit.some((a) => a.kind === "advisory-upgrade-REJECTED")).toBe(false) // not even audited — leg is off
  })

  test("non-converged board + downgrade advisory still stays COPILOT (never silently downgrades further from the cap)", () => {
    const board = wildBoard()
    const v = renderVerdict(
      ccxt(),
      greenInputs({ deliberation: board, advisory: { direction: "down", reason: "turbulence" } })
    )
    expect(v.mode).toBe("COPILOT")
    expect(v.reason.some((r) => r.includes("advisory input excluded"))).toBe(true)
  })

  test("slice-3 non-converged board never fabricates breadcrumbs from dropped findings", () => {
    const board = wildBoard()
    const v = renderVerdict(ccxt(), greenInputs({ deliberation: board }))
    // no wired crumbs; the engine may surface board breadcrumbs, but must not invent agentId
    for (const c of v.breadcrumbs) {
      expect(c.agentId).toBeTypeOf("string")
      expect(c.contribution).toBeTypeOf("number")
    }
  })
})

describe("Command Centre — Mode Engine slice 3: breadcrumb merge", () => {
  test("deliberation breadcrumbs merge with wired breadcrumbs, deduped by agentId", () => {
    const board = plusBoard()
    const v = renderVerdict(
      ccxt(),
      greenInputs({
        deliberation: board,
        breadcrumbs: [{ agentId: "technical", side: 1, contribution: 0.9 }]
      })
    )
    const ids = v.breadcrumbs.map((c) => c.agentId)
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
    expect(ids).toContain("technical")
  })

  test("breadcrumbs are empty only when there is truly nothing to say", () => {
    const v = renderVerdict(ccxt(), greenInputs())
    expect(v.breadcrumbs).toEqual([])
  })
})