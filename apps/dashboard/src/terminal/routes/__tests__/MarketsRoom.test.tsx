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
  EXPERT_WEIGHTS,
  EXPERT_WEIGHT_SUM,
  VETO_RULE_IDS,
  copilotUnavailable,
  describeConfluence,
  tierFor
} from "../../domain/copilotDecision"
import type { ConfluenceScore, VetoOutcome } from "../../contracts"
// WS-7 T7R-B: the seam. Imported here so this file can prove the room renders
// the REAL engine's output rather than only hand-built fixtures: the decision
// service is the same one `POST /api/trading/copilot` calls, and `projectDecision`
// is the same projection the adapter applies to its response.
import { projectDecision } from "../../adapters/copilotReading"
import { copilotDecisionForAsset } from "../../../../server/services/copilot/decision.mjs"

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
    // WS-7 T7R-B: this used to assert the reason contains `COPILOT_ENGINE_OWNER`
    // ("WS-7 T11"), which asserted that a COMPLETED task was named as the owner
    // of an absence. The reason now names the engine version instead, so the
    // assertion follows the truth rather than the old wording.
    expect(view.unavailableReason).toBe(MARKETS_NO_READING_REASON)
    expect(view.unavailableReason).toContain("copilot-engine/1.0.0")
  })

  it("the live markets room mounts the surface with no reading and says why", () => {
    const html = renderToStaticMarkup(<MarketsRoom confluence={null} />)
    expect(html).toContain('data-copilot-decision="unavailable"')
    expect(html).toContain("copilot-engine/1.0.0")
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

describe("T7R-B - the room renders REAL engine output through the seam", () => {
  // The anti-goal this exists to prevent: flipping the verdict to `complete`
  // WITHOUT actually wiring the room to its producer. Every test above feeds the
  // room a hand-built score. This block runs the REAL WS-7 T11 engine — through
  // the REAL decision service, then through the REAL projection, then renders
  // whatever comes out — so the verdict's claim is backed by the engine rather
  // than by a fixture.
  //
  // The path under test is exactly the one the room uses in production:
  //   decision.mjs (fetches -> deriveMarketState -> evaluateCopilot)
  //     -> projectDecision (the adapter's pure projection)
  //       -> <MarketsRoom />
  // with the broker as the only injected leaf.
  const AT = Date.UTC(2023, 10, 14, 13, 0, 0)

  function ramp(n: number, { start = 1.08, step = 0.0004 } = {}) {
    const out: Array<{ open: number; high: number; low: number; close: number; volume: number; time: number }> = []
    for (let i = 0; i < n; i++) {
      const close = start + step * i
      const open = close - step / 2
      out.push({
        open,
        high: close + Math.abs(step),
        low: close - Math.abs(step),
        close,
        volume: 1000,
        time: AT - (n - 1 - i) * 60_000
      })
    }
    return out
  }

  /** The REAL server decision, with only the broker injected. */
  function realDecision(over: Record<string, number> = {}) {
    const counts = { working: 240, h4: 200, daily: 420, ...over }
    return copilotDecisionForAsset({
      assetId: "EURUSD",
      fetchCandles: async (_id: string, { timeframe }: { timeframe: number }) => {
        if (timeframe === 14400) return { candles: ramp(counts.h4), source: "test-broker" }
        if (timeframe === 86400) return { candles: ramp(counts.daily, { step: 0.002 }), source: "test-broker" }
        return { candles: ramp(counts.working), source: "test-broker" }
      }
    })
  }

  it("renders the engine's own score, version and vetoes, not a fixture's", async () => {
    const decision = await realDecision()
    expect(decision.confluence, "the engine must produce a score").not.toBeNull()

    const reading = projectDecision("EURUSD", decision as never)
    expect(reading.confluence).not.toBeNull()

    const html = renderToStaticMarkup(
      <MarketsRoom confluence={reading.confluence} vetoes={reading.vetoes} rung={reading.rung} />
    )
    expect(html).toContain('data-copilot-decision="live"')
    // The score the ROOM shows is the engine's own number, copied not restated.
    expect(html).toContain(`data-score="${reading.confluence!.score}"`)
    expect(html).toContain(decision.engineVersion)
    // And it is the SAME number the engine produced, not a rounded fixture value.
    expect(reading.confluence!.score).toBe(decision.confluence!.score)
  })

  it("renders every veto the engine actually fired, each naming what it suppressed", async () => {
    const decision = await realDecision()
    const reading = projectDecision("EURUSD", decision as never)
    expect(reading.vetoes.length, "the engine must fire at least one veto for this test to mean anything").toBeGreaterThan(0)

    const html = renderToStaticMarkup(
      <MarketsRoom confluence={reading.confluence} vetoes={reading.vetoes} rung={reading.rung} />
    )
    for (const v of reading.vetoes) {
      // The surface's own attribute is `data-veto`; `data-veto-id` is the inner
      // span's class hook. Asserting on the attribute the component actually
      // emits is what makes this a real check rather than a string match.
      expect(html, `${v.ruleId} must be rendered`).toContain(`data-veto="${v.ruleId}"`)
      expect(html, `${v.ruleId} must name what it suppressed`).toContain(`suppressed: ${v.suppressed}`)
    }
    // The `sessionOpen` veto is the one this timestamp makes deterministic: 13:00
    // UTC is minutes since the New York open, so it fires and names `entry`.
    expect(reading.vetoes.map((v) => v.ruleId)).toContain("sessionOpen")
    expect(html).not.toContain('data-vetoes="none"')
  })

  it("names every expert contribution the engine produced, including the cold one", async () => {
    const decision = await realDecision()
    const reading = projectDecision("EURUSD", decision as never)

    const html = renderToStaticMarkup(
      <MarketsRoom confluence={reading.confluence} vetoes={reading.vetoes} rung={reading.rung} />
    )
    for (const c of reading.confluence!.contributions) {
      expect(html, `${c.expert} must be rendered`).toContain(`data-expert="${c.expert}"`)
    }
    // The 5% Sentiment expert is genuinely cold and must be shown AS cold, with
    // the engine's own reason, rather than dropped or rendered as a zero.
    const sentiment = reading.confluence!.contributions.find((c) => c.expert === "sentiment")
    expect(sentiment?.available).toBe(false)
    expect(html).toContain('data-available="false"')
    expect(html).toContain("T13")
  })

  it("reports the dead zone honestly when the engine refuses to score", async () => {
    // The engine ran and found the frozen dead zone, which returns a `null`
    // score. The room must render that as an absence and must NOT print a 0.
    const decision = await realDecision()
    const score = decision.confluence!.score
    const reading = projectDecision("EURUSD", {
      ...decision,
      confluence: { ...decision.confluence, regime: "deadZone", score: null }
    } as never)

    if (score === null) {
      expect(reading.confluence).toBeNull()
      expect(reading.reason).toBeTruthy()
    } else {
      expect(reading.confluence?.regime).toBe("deadZone")
      expect(reading.confluence?.score).toBeNull()
    }

    const html = renderToStaticMarkup(
      <MarketsRoom confluence={reading.confluence} vetoes={reading.vetoes} rung={reading.rung} />
    )
    expect(html).toContain('data-score="unscoreable"')
    expect(html).toContain("deadZone")
    // Never a zero dressed as a score.
    expect(html).not.toContain('data-score="0"')
  })

  it("still exposes no write affordance now that a live tier can be rendered", async () => {
    // The room grew a reachable live reading. A live `A+` tier must still not
    // come with a button: T9's Paper/Live room owns the rails, and a control
    // here would be a scope change nobody notices.
    const reading = projectDecision("EURUSD", (await realDecision()) as never)
    const html = renderToStaticMarkup(
      <MarketsRoom confluence={reading.confluence} vetoes={reading.vetoes} rung={reading.rung} />
    )
    expect(html).not.toMatch(/<button/i)
    expect(html).not.toMatch(/<input/i)
    expect(html).not.toMatch(/<form/i)
    expect(html).not.toMatch(/type="submit"/i)
  })
})

describe("T7 room 1 - the D27 verdict is present, explicit, and not a trim", () => {
  it("states a completeness verdict, and no longer names a discharged gap", () => {
    // AC-020's verification is "assert the completion record contains an
    // explicit completeness verdict". This is that assertion.
    //
    // WS-7 T7R-B flipped this verdict. T7 recorded
    // "surface-complete, producer-pending" with a `pendingScope` naming WS-7 T11;
    // T11 has since landed (`a4fac35`) and T7R-B wired the room to it through
    // `adapters/copilotReading.ts`, so both clauses are discharged.
    //
    // The verdict is now `complete` AND `pendingScope` is GONE rather than
    // emptied. A retained-but-empty `pendingScope` would leave a field whose
    // only meaning is "something is still owed", which is the ambiguity AC-020
    // exists to prevent.
    expect(MARKETS_COMPLETION.verdict).toBe("complete")
    expect(MARKETS_COMPLETION).not.toHaveProperty("pendingScope")
    expect(MARKETS_COMPLETION).not.toHaveProperty("routeBlocker")
    expect(MARKETS_COMPLETION.d1Order).toBe(1)
    expect(MARKETS_COMPLETION.reason.trim().length).toBeGreaterThan(40)
  })

  it("no longer names T11 as a pending task, because T11 has run", () => {
    // The unflagged-drift direction: a verdict that still says "producer
    // pending" after the producer landed is a record naming a resolved gap as
    // live. The REASON may still mention T11 — it does, to name what the room
    // now consumes — but it must not present T11 as owed.
    const record = JSON.stringify(MARKETS_COMPLETION)
    expect(record).not.toMatch(/producer-pending/)
    expect(record).not.toMatch(/pendingScope/)
    expect(MARKETS_COMPLETION.reason).toContain("a4fac35")
  })

  it("still names the one capability that is absent BY DESIGN", () => {
    // "complete" must not mean "everything is live". The 5% Sentiment expert's
    // model input is genuinely absent, and the record has to keep saying so.
    expect(MARKETS_COMPLETION.reason).toContain("Sentiment")
  })

  it("records the WS-8 boundary explicitly rather than leaving it implicit", () => {
    // D27 requires the record to say whether scope logically belongs to WS-8.
    // `null` here is a STATEMENT - "no scope in this room belongs to WS-8" -
    // not an omission, and the test is what makes the difference visible if a
    // later change starts quietly leaving the field out.
    expect(MARKETS_COMPLETION).toHaveProperty("ws8Handoff")
    expect(MARKETS_COMPLETION.ws8Handoff).toBeNull()
  })

  it("does not display a stale 'T11 is pending' reason to a reader", () => {
    // `MARKETS_NO_READING_REASON` is what a user READS when no score is shown.
    // Before T7R-B it named T11 as a pending task, which had stopped being true.
    expect(MARKETS_NO_READING_REASON).not.toMatch(/is not built/)
    expect(MARKETS_NO_READING_REASON).not.toMatch(/WS-7 task T11/)
    expect(MARKETS_NO_READING_REASON).toMatch(/BUILT/)
    // It must still be a reason, not a shrug.
    expect(MARKETS_NO_READING_REASON.trim().length).toBeGreaterThan(80)
  })
})
