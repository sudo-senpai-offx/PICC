// @vitest-environment jsdom
// WS-7 T7 room instance 1 of 18 (D1's order): Markets / COP-22.
//
// AC-020 for this room is: it renders real data with honest provenance, holds
// no reserved placeholder a later task was expected to fill, and its own
// invariants are green. Its D27 obligation is that the completion record
// EXPLICITLY states whether the room is genuinely complete or whether scope
// logically belongs to WS-8, naming that scope.
//
// These tests cover the second half as well as the first: the verdict lives in
// `MARKETS_COMPLETION`, and a verdict asserted only in a markdown file is a
// verdict nobody re-reads when the next change lands.
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MarketsRoom, MARKETS_COMPLETION, MARKETS_NO_READING_REASON, buildMarketsDecision } from "../MarketsRoom"
import { CopilotScoreSurface } from "../../components/CopilotScoreSurface"
import {
  COPILOT_ENGINE_OWNER,
  EXPERT_WEIGHTS,
  EXPERT_WEIGHT_SUM,
  VETO_RULE_IDS,
  copilotUnavailable,
  describeConfluence,
  tierFor
} from "../../domain/copilotDecision"
import type { ConfluenceScore, VetoOutcome } from "../../contracts"

const ALL_AVAILABLE: ConfluenceScore["contributions"] = EXPERT_WEIGHTS.map((e) => ({
  expert: e.expert,
  weightPct: e.weightPct,
  rawDelta: 5,
  available: true,
  unavailableReason: null
}))

function score(over: Partial<ConfluenceScore> = {}): ConfluenceScore {
  return {
    score: 88,
    contributions: ALL_AVAILABLE,
    confidence: "high",
    regime: "londonTrend",
    activeBoosters: [],
    conflictOverrides: [],
    computedAt: 1_700_000_000_000,
    engineVersion: "t11-engine-test",
    ...over
  }
}

function veto(over: Partial<VetoOutcome> = {}): VetoOutcome {
  return {
    ruleId: "wickVsClose",
    fired: true,
    inputs: { wickPips: 12, closeOffsetPips: -3 },
    suppressed: "entry",
    evaluatedAt: 1_700_000_000_000,
    ruleVersion: "1",
    ...over
  }
}

describe("T7 room 1 - the Copilot decision view is real when the engine has produced a reading", () => {
  it("surfaces the score, all six expert contributions, and the fired vetoes", () => {
    const view = describeConfluence({
      score: score(),
      vetoes: [veto({ ruleId: "sessionOpen", fired: false, suppressed: "entry" }), veto()],
      automationPermitted: true,
      rung: "paper"
    })

    expect(view.available).toBe(true)
    expect(view.score).toBe(88)
    expect(view.engineVersion).toBe("t11-engine-test")
    expect(view.contributions).toHaveLength(6)
    expect(view.contributions.map((c) => c.expert)).toEqual(EXPERT_WEIGHTS.map((e) => e.expert))
    // Only FIRED vetoes are outcomes. An unfired veto listed as an outcome
    // would read as a suppression that did not happen.
    expect(view.firedVetoes.map((v) => v.ruleId)).toEqual(["wickVsClose"])
  })

  it("keeps the room's own invariants: weights sum to 100 and all six ids are the spec's", () => {
    expect(EXPERT_WEIGHT_SUM).toBe(100)
    expect(EXPERT_WEIGHTS.map((e) => e.expert)).toEqual([
      "macroBias",
      "structural",
      "trendStrength",
      "momentumExhaustion",
      "volatilityBoosters",
      "sentiment"
    ])
    expect([...VETO_RULE_IDS]).toEqual([
      "topDownHierarchy",
      "correlationTrap",
      "wickVsClose",
      "spreadVsTarget",
      "newsLockout",
      "sessionOpen"
    ])
  })

  it("completes a missing expert rather than rendering four rows, and says why", () => {
    // A producer that omits the 5% sentiment expert is a producer bug. Four
    // rows would make a missing expert look like an absent one, which is the
    // silent renormalization the spec forbids.
    const view = describeConfluence({
      score: score({ contributions: ALL_AVAILABLE.slice(0, 5) }),
      vetoes: [],
      automationPermitted: false,
      rung: "paper"
    })
    const sentiment = view.contributions.find((c) => c.expert === "sentiment")
    expect(sentiment).toEqual({
      expert: "sentiment",
      weightPct: 5,
      rawDelta: null,
      available: false,
      unavailableReason: "not reported by the engine"
    })
  })

  it("rejects an unavailable expert with no reason, and one that also carries a delta", () => {
    const noReason = ALL_AVAILABLE.map((c) =>
      c.expert === "sentiment" ? { ...c, available: false, unavailableReason: null } : c
    )
    expect(() =>
      describeConfluence({ score: score({ contributions: noReason }), vetoes: [], automationPermitted: false, rung: "paper" })
    ).toThrow(/must carry a reason/)

    // An expert that is unavailable but still reports a delta is a number a
    // reader would read as a contribution.
    const ghost = ALL_AVAILABLE.map((c) =>
      c.expert === "sentiment" ? { ...c, available: false, unavailableReason: "model offline" } : c
    )
    expect(() =>
      describeConfluence({ score: score({ contributions: ghost }), vetoes: [], automationPermitted: false, rung: "paper" })
    ).toThrow(/must not carry a rawDelta/)
  })

  it("rejects a wrong weight and an unknown expert rather than correcting either", () => {
    const wrongWeight = ALL_AVAILABLE.map((c) => (c.expert === "sentiment" ? { ...c, weightPct: 10 as never } : c))
    expect(() =>
      describeConfluence({ score: score({ contributions: wrongWeight }), vetoes: [], automationPermitted: false, rung: "paper" })
    ).toThrow(/spec weight is 5/)

    const bogus = [...ALL_AVAILABLE, { expert: "astrology" as never, weightPct: 5 as never, rawDelta: 1, available: true, unavailableReason: null }]
    expect(() =>
      describeConfluence({ score: score({ contributions: bogus }), vetoes: [], automationPermitted: false, rung: "paper" })
    ).toThrow(/unknown expert/)
  })
})

describe("T7 room 1 - AC-023 tier boundaries are exact, with no interpolation band", () => {
  const opts = { vetoes: [] as VetoOutcome[], automationPermitted: true, rung: "paper" as const }

  it.each([
    [86, "A+", 0.01],
    [85, "A+", 0.01],
    [84.999, "B", 0.005],
    [84, "B", 0.005],
    [70, "B", 0.005],
    [69.999, "ignore", 0],
    [69, "ignore", 0],
    [0, "ignore", 0]
  ] as const)("score %s maps to %s at %s risk, unrounded", (value, tier, riskPct) => {
    const t = tierFor(value, opts)
    expect(t.tier).toBe(tier)
    expect(t.riskPct).toBe(riskPct)
  })

  it("treats an unscoreable state as ignore/hold, never as a score of 0", () => {
    // 0 is a legitimate confluence result. Mapping `null` onto 0 would put a
    // number on the room for a state nobody evaluated.
    const t = tierFor(null, opts)
    expect(t.tier).toBe("ignore")
    expect(t.action).toBe("hold")
    expect(t.riskPct).toBe(0)
    expect(tierFor(0, opts).tier).toBe("ignore")
  })
})

describe("T7 room 1 - AC-022 and AC-024: a veto holds, and an absent permission is not permission", () => {
  it("forces hold and 0% risk when any veto fires, whatever the tier and whatever the permission", () => {
    // The permission is deliberately TRUE here. If a broker's
    // automationPermitted could re-enable an action a veto suppressed, the
    // veto would be advisory.
    const t = tierFor(95, { vetoes: [veto()], automationPermitted: true, rung: "paper" })
    expect(t.action).toBe("hold")
    expect(t.riskPct).toBe(0)
    expect(t.tier).toBe("A+")
  })

  it("degrades autoExecute to notifyForApproval when automationPermitted is false", () => {
    const t = tierFor(95, { vetoes: [], automationPermitted: false, rung: "paper" })
    expect(t.action).toBe("notifyForApproval")
    expect(t.riskPct).toBe(0.01)
    expect(t.automationPermitted).toBe(false)
  })

  it("carries the rung through untouched, so the copilot cannot place itself higher", () => {
    expect(tierFor(95, { vetoes: [], automationPermitted: true, rung: "paper" }).rung).toBe("paper")
    expect(tierFor(95, { vetoes: [], automationPermitted: true, rung: "demo" }).rung).toBe("demo")
  })
})

describe("T7 room 1 - the engine's absence is reported, not filled in", () => {
  it("produces no numeric value at all when there is no reading", () => {
    const view = copilotUnavailable(MARKETS_NO_READING_REASON)
    expect(view.available).toBe(false)
    expect(view.contributions).toEqual([])
    expect(view.firedVetoes).toEqual([])
    expect(view.activeBoosters).toEqual([])
    expect(view.conflictOverrides).toEqual([])
    // Every field the type declares as `number | null` must be null, and the
    // whole nested tier must be absent. A digit-scan of the JSON was the first
    // attempt at this and it was wrong: the reason string legitimately
    // contains "T11" and "WS-7", so the check could only ever be satisfied by
    // a reason that named no task. Asserting the fields is both stricter and
    // immune to the reason text.
    const numericFields: Array<keyof typeof view> = ["score", "computedAt"]
    for (const field of numericFields) expect(view[field], `${String(field)} must be null, never a fabricated number`).toBeNull()
    expect(view.tier).toBeNull()
    // And no contribution may smuggle a delta through the empty-state path.
    for (const c of view.contributions) expect(c.rawDelta).toBeNull()
    expect(view.unavailableReason).toContain(COPILOT_ENGINE_OWNER)
  })

  it("the live markets room mounts the surface with no reading and names the owner", () => {
    const html = renderToStaticMarkup(<MarketsRoom confluence={null} />)
    expect(html).toContain('data-copilot-decision="unavailable"')
    expect(html).toContain(COPILOT_ENGINE_OWNER)
    // The room frame and the surface must both be present; a room that
    // rendered nothing would satisfy "no fabricated number" trivially.
    expect(html).toContain('data-room-key="markets"')
    expect(html).toContain("Copilot decision")
  })

  it("mounts a real reading when one is supplied", () => {
    const html = renderToStaticMarkup(
      <MarketsRoom
        confluence={score({ score: 72, confidence: "medium" })}
        vetoes={[veto({ ruleId: "newsLockout", suppressed: "entry", inputs: { windowMin: 15 } })]}
        automationPermitted={false}
        rung="demo"
      />
    )
    expect(html).toContain('data-copilot-decision="live"')
    expect(html).toContain("score 72")
    expect(html).toContain('data-tier="B"')
    // A veto is firing in this fixture, so the action is `hold` and the risk is
    // 0% even though the band is B and `automationPermitted` is false. The
    // permission check is the one below; conflating the two here would hide
    // which rule actually won.
    expect(html).toContain('data-action="hold"')
    expect(html).toContain("risk 0%")
    expect(html).toContain("newsLockout")
    expect(html).toContain("suppressed: entry")
    expect(html).toContain("windowMin=15")
    // Every expert row is rendered, so a reader can see the weights.
    for (const e of EXPERT_WEIGHTS) expect(html).toContain(`data-expert="${e.expert}"`)
  })

  it("degrades to notifyForApproval on a B score with no veto, even when permitted", () => {
    const html = renderToStaticMarkup(
      <MarketsRoom confluence={score({ score: 72 })} vetoes={[]} automationPermitted rung="paper" />
    )
    expect(html).toContain('data-action="notifyForApproval"')
    expect(html).toContain("risk 0.5%")
  })

  it("renders an unscoreable state as a word, never as 0", () => {
    const html = renderToStaticMarkup(<CopilotScoreSurface view={buildMarketsDecision({ confluence: score({ score: null }) })} />)
    expect(html).toContain("unscoreable")
    expect(html).toContain('data-score="unscoreable"')
    expect(html).not.toContain('data-score="0"')
  })

  it("shows an unavailable expert's reason inside its own row", () => {
    const degraded = ALL_AVAILABLE.map((c) =>
      c.expert === "sentiment" ? { ...c, rawDelta: null, available: false, unavailableReason: "model layer unavailable" } : c
    )
    const html = renderToStaticMarkup(<MarketsRoom confluence={score({ contributions: degraded })} />)
    expect(html).toContain("unavailable — model layer unavailable")
    expect(html).toContain('data-expert="sentiment" data-available="false"')
  })

  it("says 'none fired' rather than rendering an empty veto block", () => {
    const html = renderToStaticMarkup(<MarketsRoom confluence={score()} />)
    expect(html).toContain('data-vetoes="none"')
  })
})

describe("T7 room 1 - the D27 verdict is present, explicit, and not a trim", () => {
  it("states a completeness verdict and names the pending scope", () => {
    // AC-020's verification is "assert the completion record contains an
    // explicit completeness verdict". This is that assertion.
    expect(MARKETS_COMPLETION.verdict).toBe("surface-complete, producer-pending")
    expect(MARKETS_COMPLETION.verdict).not.toMatch(/^complete$/i)
    expect(MARKETS_COMPLETION.pendingScope).toContain("WS-7 T11")
    expect(MARKETS_COMPLETION.d1Order).toBe(1)
    expect(MARKETS_COMPLETION.reason.trim().length).toBeGreaterThan(40)
  })

  it("records the WS-8 boundary explicitly rather than leaving it implicit", () => {
    // D27 requires the record to say whether scope logically belongs to WS-8.
    // `null` here is a STATEMENT - "no scope in this room belongs to WS-8" -
    // not an omission, and the test is what makes the difference visible if a
    // later change starts quietly leaving the field out.
    expect(MARKETS_COMPLETION).toHaveProperty("ws8Handoff")
    expect(MARKETS_COMPLETION.ws8Handoff).toBeNull()
  })
})
