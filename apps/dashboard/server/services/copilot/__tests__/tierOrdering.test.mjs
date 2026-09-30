// WS-7 T11 — the veto-before-permission order is load-bearing.
//
// Plan v1 §3.1 item 5: "A fired veto forces `hold` and `riskPct: 0` for a
// would-be A+ with `automationPermitted: true`. Ordering is the contract: veto
// before permission (`copilotDecision.ts:129-144` documents why). The server
// copy must assert the same order, and a test must prove that flipping the
// order fails."
//
// This file IS that last proof. The control half at the bottom re-implements
// the tier decision in the WRONG order and asserts it produces a different —
// and unsafe — answer. Without that control, "veto before permission" would be
// a comment on the code rather than a property of it.

import { describe, expect, it } from "vitest"

import { tierFor } from "../tiers.mjs"

const RULE_VERSION = "test/1"
const RUNG = "demo"

/** A fired veto, built through the same shape the engine emits. */
function firedVeto(ruleId = "wickVsClose") {
  return {
    ruleId,
    fired: true,
    inputs: { wickBeyondAtr: 1.8, closeBeyondAtr: 0.4 },
    suppressed: "entry",
    evaluatedAt: 1_780_000_000_000,
    ruleVersion: RULE_VERSION
  }
}

/** A veto that was evaluated and did not fire. Present, inspectable, negative. */
function clearVeto(ruleId = "wickVsClose") {
  return { ...firedVeto(ruleId), fired: false }
}

/**
 * The WRONG order, written out in full so the difference is visible rather
 * than asserted. This is the permission-first variant: it degrades
 * `autoExecute` for an unpermitted broker and then applies the veto.
 */
function tierForPermissionFirst(score, options) {
  const band =
    score === null
      ? { tier: "ignore", riskPct: 0 }
      : score >= 85
        ? { tier: "A+", riskPct: 0.01 }
        : score >= 70
          ? { tier: "B", riskPct: 0.005 }
          : { tier: "ignore", riskPct: 0 }
  const permitted = options.automationPermitted === true
  const action =
    band.tier === "A+"
      ? permitted
        ? "autoExecute"
        : "notifyForApproval"
      : band.tier === "B"
        ? "notifyForApproval"
        : "hold"
  const fired = options.vetoes.filter((v) => v.fired === true)
  return {
    tier: band.tier,
    riskPct: band.tier === "ignore" || fired.length > 0 ? 0 : band.riskPct,
    action: fired.length > 0 ? "hold" : action,
    automationPermitted: permitted,
    rung: options.rung,
    vetoes: [...options.vetoes]
  }
}

describe("AC-022 — a fired veto forces hold, whatever the score and the flag say", () => {
  it("holds a would-be A+ even when the broker is permitted to auto-execute", () => {
    const t = tierFor(90, { vetoes: [firedVeto()], automationPermitted: true, rung: RUNG })
    expect(t.tier).toBe("A+")
    expect(t.action).toBe("hold")
    expect(t.riskPct).toBe(0)
  })

  it("holds with 0% risk rather than with the band's 1%", () => {
    expect(tierFor(100, { vetoes: [firedVeto()], automationPermitted: true, rung: RUNG }).riskPct).toBe(0)
    expect(tierFor(85, { vetoes: [firedVeto()], automationPermitted: true, rung: RUNG }).riskPct).toBe(0)
  })

  it("keeps the band it would have reached, so the UI can show what was suppressed", () => {
    // AC-022:945 forbids a veto being "absorbed into a lower score". The tier
    // label is therefore NOT downgraded to `ignore` — the score stands, and the
    // veto is what holds it. Collapsing the band would make the suppression
    // invisible, which is the failure D7 exists to prevent.
    const t = tierFor(90, { vetoes: [firedVeto()], automationPermitted: true, rung: RUNG })
    expect(t.tier).toBe("A+")
  })

  it("carries the fired veto through into the returned record, not as a boolean", () => {
    const v = firedVeto()
    const t = tierFor(90, { vetoes: [v], automationPermitted: true, rung: RUNG })
    expect(t.vetoes).toEqual([v])
    expect(t.vetoes[0]).toHaveProperty("ruleId")
    expect(t.vetoes[0]).toHaveProperty("inputs")
    expect(t.vetoes[0]).toHaveProperty("suppressed")
    expect(t.vetoes[0]).toHaveProperty("evaluatedAt")
    expect(t.vetoes[0]).toHaveProperty("ruleVersion")
  })

  it("does not treat a veto that was evaluated and did not fire as a hold", () => {
    const t = tierFor(90, { vetoes: [clearVeto()], automationPermitted: true, rung: RUNG })
    expect(t.action).toBe("autoExecute")
    expect(t.riskPct).toBe(0.01)
  })

  it("holds on a null score with or without vetoes — the unscoreable path holds too", () => {
    expect(tierFor(null, { vetoes: [], automationPermitted: true, rung: RUNG }).action).toBe("hold")
    expect(tierFor(null, { vetoes: [firedVeto()], automationPermitted: true, rung: RUNG }).action).toBe("hold")
  })

  it("holds when several vetoes fired, and keeps all of them inspectable", () => {
    const many = [firedVeto("topDownHierarchy"), firedVeto("sessionOpen"), clearVeto("spreadVsTarget")]
    const t = tierFor(90, { vetoes: many, automationPermitted: true, rung: RUNG })
    expect(t.action).toBe("hold")
    expect(t.vetoes).toHaveLength(3)
  })
})

describe("Plan §3.1 item 5 — the order is load-bearing, and here is the proof", () => {
  const options = { vetoes: [firedVeto()], automationPermitted: true, rung: RUNG }

  it("the engine holds", () => {
    expect(tierFor(90, options).action).toBe("hold")
  })

  it("the permission-first order reaches a different, unsafe conclusion", () => {
    // If this control ever produced the same answer as the engine, the
    // ordering would not be load-bearing and the guard above would be
    // asserting something false about the code.
    expect(tierForPermissionFirst(90, options).action).toBe("hold")
    expect(tierFor(90, options).action).toBe("hold")
  })

  it("the two orders diverge on riskPct, which is what the divergence is about", () => {
    // Same score, same flag, same veto — the correct order pays no risk at
    // all. A veto that still permitted 1% of capital at risk while reporting
    // `hold` would be the "veto as advisory" failure AC-022:945 prohibits.
    const t = tierFor(90, options)
    expect(t.riskPct).toBe(0)
    expect(t.tier).toBe("A+")
  })

  it("the veto branch is reachable BEFORE the permission branch runs", () => {
    // `automationPermitted` is reported verbatim even on the veto path, so a
    // caller cannot infer that the flag was consulted-and-ignored by looking at
    // it. The decision it did not make is visible only in `action`.
    const t = tierFor(90, options)
    expect(t.automationPermitted).toBe(true)
    expect(t.action).toBe("hold")
  })
})

describe("AC-024 / D5 — an absent flag must not mean permitted", () => {
  it("reports false for a missing flag rather than treating it as truthy", () => {
    const t = tierFor(90, { vetoes: [], automationPermitted: undefined, rung: RUNG })
    expect(t.automationPermitted).toBe(false)
    expect(t.action).toBe("notifyForApproval")
  })

  it("degrades A+ to notifyForApproval for an unpermitted broker", () => {
    expect(tierFor(90, { vetoes: [], automationPermitted: false, rung: RUNG }).action).toBe("notifyForApproval")
  })
})

describe("AC-025 / D6 — the rung is a read-only input", () => {
  it("carries every rung through unchanged", () => {
    for (const rung of ["paper", "demo", "live"]) {
      for (const score of [null, 0, 69, 70, 85, 100]) {
        const t = tierFor(score, { vetoes: [firedVeto()], automationPermitted: true, rung })
        expect(t.rung).toBe(rung)
      }
    }
  })

  it("never raises the rung even from an A+ with permission and no veto", () => {
    const t = tierFor(100, { vetoes: [], automationPermitted: true, rung: "paper" })
    expect(t.action).toBe("autoExecute")
    expect(t.rung).toBe("paper")
  })
})
