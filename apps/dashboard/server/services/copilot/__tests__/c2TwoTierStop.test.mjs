// WS-7 T12 — C2: the two-tier stop. AC-028.
//
// §4.4:700 — "**C2 — Wick-vs-Close vs ATR hard stop.** Two-tier. The **soft**
// stop at 1.5× ATR alerts and *waits for candle close*. The **hard** stop fires
// only on a **close** beyond 1.5× ATR, or a close below the 50 EMA."
//
// AC-028 (:989-995) is the binding criterion:
//   Scenario:  Price wicks beyond 1.5× ATR but closes inside.
//   Action:    Evaluate the stop.
//   Expected:  The soft stop alerts and waits for the close; no hard stop fires.
//   Prohibited: A wick alone may not trigger the hard stop.
//   Verification: Three cases, three verdicts — wick-inside → alert only;
//                 close beyond 1.5× ATR → hard stop;
//                 close below the 50 EMA → hard stop.
//   Priority:  P0.
//
// The three verdicts are `hardStop` / `softAlert` / `none`, plus `unavailable`.
// `none` exists because a fourth state is needed: "no stop was reached" and "I
// could not evaluate the stop" are different facts, and collapsing them is the
// fabrication this repo treats as a P1 (`marketState.mjs:12-20`).
//
// THE ANCHOR. §4.4:700 does not say what the stop distance is measured FROM. The
// natural reading for an open position is the entry price, so `entryPrice` is a
// first-class input. When a caller has no fill to supply, the prior bar's close
// is used — which is the same reference `vetoes/wickVsClose.mjs:66,72-73` takes,
// so the entry veto and the position stop cannot disagree about where "beyond
// 1.5× ATR" is. Both paths are tested.

import { describe, expect, it } from "vitest"

import { ATR_STOP_MULTIPLE } from "../riskLayer.mjs"
import { ATR_MULTIPLE as WICK_VETO_MULTIPLE } from "../vetoes/wickVsClose.mjs"
import {
  C2_RULE,
  TWO_TIER_VERDICTS,
  evaluateC2,
  c2Adjustments
} from "../conflicts/c2TwoTierStop.mjs"
import { deriveMarketState, lastValue } from "../marketState.mjs"
import { twoTierStopCases } from "./fixtures/conflictFixtures.mjs"

const cases = twoTierStopCases()
const byLabel = new Map(cases.map((c) => [c.label, c]))

describe("C2 is a NAMED, VERSIONED rule", () => {
  it("carries the spec's own id and a ruleVersion", () => {
    expect(C2_RULE.id).toBe("C2")
    expect(C2_RULE.ruleId).toBe("copilot.conflict.c2TwoTierStop")
    expect(C2_RULE.ruleVersion).toMatch(/^copilot-conflict-c2TwoTierStop\/\d+\.\d+\.\d+$/)
    expect(C2_RULE.specRef).toContain("§4.4:700")
  })

  it("reads the 1.5x multiplier from T11's risk layer rather than restating it", () => {
    // Risk 6: two copies of 1.5 is two chances to be wrong. `riskLayer.mjs` owns
    // it for the ATR stop and `vetoes/wickVsClose.mjs` owns it for the entry
    // veto; C2 must agree with both.
    expect(C2_RULE.atrMultiple).toBe(ATR_STOP_MULTIPLE)
    expect(C2_RULE.atrMultiple).toBe(WICK_VETO_MULTIPLE)
    expect(C2_RULE.atrMultiple).toBe(1.5)
  })

  it("names exactly the three verdicts AC-028 names, plus an honest fourth", () => {
    expect([...TWO_TIER_VERDICTS].sort()).toEqual(["hardStop", "none", "softAlert", "unavailable"])
  })

  it("declares both hard clauses by name, so a caller can see which one fired", () => {
    expect([...C2_RULE.hardTriggers].sort()).toEqual(["closeBelowEma50", "closeBeyondAtr"])
  })

  it("is frozen", () => {
    expect(Object.isFrozen(C2_RULE)).toBe(true)
    expect(Object.isFrozen(C2_RULE.hardTriggers)).toBe(true)
  })
})

describe("AC-028 — three cases, three verdicts", () => {
  it("a wick beyond 1.5x ATR with the close inside ALERTS and does not stop", () => {
    const c = byLabel.get("wickInside")
    const r = evaluateC2({ state: deriveMarketState(c.state), direction: c.direction, entryPrice: c.entryPrice })
    expect(r.verdict, "AC-028 case 1").toBe("softAlert")
    expect(r.hardStop).toBe(false)
    expect(r.softAlert).toBe(true)
    expect(r.inputs.wickBeyondStop).toBe(true)
    expect(r.inputs.closeBeyondStop).toBe(false)
    expect(r.inputs.closeBeyondEma50).toBe(false)
  })

  it("a close beyond 1.5x ATR is a HARD stop", () => {
    const c = byLabel.get("closeBeyondAtr")
    const r = evaluateC2({ state: deriveMarketState(c.state), direction: c.direction, entryPrice: c.entryPrice })
    expect(r.verdict, "AC-028 case 2").toBe("hardStop")
    expect(r.hardStop).toBe(true)
    expect(r.triggers).toContain("closeBeyondAtr")
  })

  it("a close below the 50 EMA is a HARD stop", () => {
    const c = byLabel.get("closeBelowEma50")
    const r = evaluateC2({ state: deriveMarketState(c.state), direction: c.direction, entryPrice: c.entryPrice })
    expect(r.verdict, "AC-028 case 3").toBe("hardStop")
    expect(r.hardStop).toBe(true)
    expect(r.triggers).toContain("closeBelowEma50")
  })

  it("isolates the 50-EMA clause: that case is NOT also beyond 1.5x ATR", () => {
    // Without this, case 3 would be indistinguishable from case 2 and AC-028's
    // "or a close below the 50 EMA" clause would be untested.
    const r = evaluateC2({
      state: deriveMarketState(byLabel.get("closeBelowEma50").state),
      direction: "long",
      entryPrice: byLabel.get("closeBelowEma50").entryPrice
    })
    expect(r.triggers).toEqual(["closeBelowEma50"])
    expect(r.inputs.closeBeyondStop).toBe(false)
  })

  it("reports `none` when nothing is breached, distinct from `unavailable`", () => {
    const c = byLabel.get("clean")
    const r = evaluateC2({ state: deriveMarketState(c.state), direction: c.direction, entryPrice: c.entryPrice })
    expect(r.verdict).toBe("none")
    expect(r.hardStop).toBe(false)
    expect(r.softAlert).toBe(false)
    expect(r.available).toBe(true)
  })
})

describe("AC-028 — the prohibited side effect: a wick alone may not stop the trade", () => {
  it("never reports a hard stop for any bar whose CLOSE is inside", () => {
    for (const c of cases) {
      const r = evaluateC2({ state: deriveMarketState(c.state), direction: c.direction, entryPrice: c.entryPrice })
      const closeBreached = r.inputs.closeBeyondStop || r.inputs.closeBeyondEma50
      if (!closeBreached) {
        expect(r.hardStop, `${c.label}: a wick alone must never be a hard stop`).toBe(false)
      }
    }
  })

  it("distinguishes the two tiers explicitly, so 'alerted' is never 'stopped'", () => {
    const c = byLabel.get("wickInside")
    const r = evaluateC2({ state: deriveMarketState(c.state), direction: c.direction, entryPrice: c.entryPrice })
    expect(r.softAlert && !r.hardStop).toBe(true)
    expect(r.waitsForCandleClose).toBe(true)
    expect(r.action).toBe("alert")
  })
})

describe("C2 — direction symmetry", () => {
  it("mirrors every long verdict for a short", () => {
    for (const label of ["shortWickInside", "shortCloseBeyondAtr", "shortClean"]) {
      const c = byLabel.get(label)
      const r = evaluateC2({ state: deriveMarketState(c.state), direction: c.direction, entryPrice: c.entryPrice })
      expect(r.verdict, label).toBe(c.expect)
    }
  })

  it("reads the 50-EMA clause on the correct side of the EMA per direction", () => {
    const c = byLabel.get("shortWickInside")
    const state = deriveMarketState(c.state)
    const r = evaluateC2({ state, direction: "short", entryPrice: c.entryPrice })
    // A short is stopped by a close ABOVE the 50 EMA. The fixture's close is
    // below it, which is why the short wick case can isolate the alert.
    expect(state.last.close).toBeLessThan(lastValue(state.series.ema50))
    expect(r.inputs.closeBeyondEma50).toBe(false)
  })
})

describe("C2 — the arithmetic is the spec's, and is re-derived independently here", () => {
  it("computes the stop level as entry minus 1.5x the observed ATR", () => {
    const c = byLabel.get("clean")
    const state = deriveMarketState(c.state)
    const r = evaluateC2({ state, direction: "long", entryPrice: c.entryPrice })
    const atr = lastValue(state.series.atr14)
    expect(r.inputs.atr).toBe(atr)
    expect(r.inputs.stopDistance).toBe(atr * 1.5)
    expect(r.inputs.stopLevel).toBe(c.entryPrice - atr * 1.5)
  })

  it("falls back to the prior bar's close when no fill is supplied", () => {
    const c = byLabel.get("wickInside")
    const state = deriveMarketState(c.state)
    const r = evaluateC2({ state, direction: "long" })
    expect(r.inputs.entryPriceSource).toBe("priorBarClose")
    expect(r.inputs.entryPrice).toBe(state.candles[state.candles.length - 2].close)
  })

  it("names the supplied fill as the anchor when one is given", () => {
    const c = byLabel.get("wickInside")
    const r = evaluateC2({ state: deriveMarketState(c.state), direction: "long", entryPrice: c.entryPrice })
    expect(r.inputs.entryPriceSource).toBe("callerSupplied")
  })
})

describe("C2 — unavailable is never `none`", () => {
  it("reports unavailable, with a reason, when ATR has not warmed up", () => {
    const state = deriveMarketState({ candles: [{ open: 1, high: 1, low: 1, close: 1 }], computedAt: 0 })
    const r = evaluateC2({ state, direction: "long", entryPrice: 1 })
    expect(r.verdict).toBe("unavailable")
    expect(r.available).toBe(false)
    expect(r.unavailableReason).toContain("ATR")
    expect(r.hardStop).toBe(false)
    expect(r.softAlert).toBe(false)
  })

  it("reports unavailable, with a reason, when the 50 EMA has not warmed up", () => {
    const c = byLabel.get("clean")
    const state = deriveMarketState({ candles: c.candles.slice(0, 10), computedAt: 1773144000000 })
    const r = evaluateC2({ state, direction: "long", entryPrice: c.entryPrice })
    expect(r.verdict).toBe("unavailable")
    expect(r.unavailableReason).toMatch(/EMA|ATR/)
  })

  it("refuses a direction it was not given, rather than assuming one", () => {
    const c = byLabel.get("clean")
    const r = evaluateC2({ state: deriveMarketState(c.state), direction: "sideways", entryPrice: c.entryPrice })
    expect(r.verdict).toBe("unavailable")
    expect(r.unavailableReason).toContain("direction")
  })

  it("refuses a non-finite entry price loudly", () => {
    const c = byLabel.get("clean")
    expect(() =>
      evaluateC2({ state: deriveMarketState(c.state), direction: "long", entryPrice: Number.NaN })
    ).toThrow(TypeError)
  })
})

describe("C2 — what it does to the decision path", () => {
  const c = byLabel.get("closeBeyondAtr")
  const r = evaluateC2({ state: deriveMarketState(c.state), direction: "long", entryPrice: c.entryPrice })

  it("is versioned on its own record, so a stop reading is attributable", () => {
    expect(r.rule).toBe("C2")
    expect(r.ruleId).toBe("copilot.conflict.c2TwoTierStop")
    expect(r.ruleVersion).toBe(C2_RULE.ruleVersion)
    expect(r.evaluatedAt).toBe(deriveMarketState(c.state).computedAt)
  })

  it("adjusts no expert weight: a stop governs an exit, not a score", () => {
    // C2 changing a score would be C1's job. The separation is what makes the
    // C1-vs-C2 precedence a real decision rather than two rules editing one
    // number.
    expect(c2Adjustments(r)).toEqual([])
  })

  it("carries a stop state a caller can render, including the two tiers", () => {
    expect(r.stop).toMatchObject({
      multiple: 1.5,
      period: 14,
      emaPeriod: 50,
      distance: expect.any(Number),
      level: expect.any(Number),
      emaLevel: expect.any(Number),
      // A hard stop is a hard stop, not also a soft alert: the two tiers are
      // exclusive, and a render that showed both would double-count the event.
      softAlertFired: false,
      hardStopFired: true
    })
  })

  it("is independently disable-able, and a disabled C2 evaluates to nothing", () => {
    const off = evaluateC2({
      state: deriveMarketState(c.state),
      direction: "long",
      entryPrice: c.entryPrice,
      enabled: false
    })
    expect(off.status).toBe("disabled")
    expect(off.verdict).toBe("unavailable")
    expect(off.enabled).toBe(false)
  })
})
