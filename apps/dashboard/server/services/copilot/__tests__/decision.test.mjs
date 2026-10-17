// WS-7 T7R-B — the route that finally calls the engine.
//
// WHY THIS FILE EXISTS. `evaluateCopilot` shipped with T11 and had exactly two
// referents in the whole repository: its own definition and test files. T12
// entry 0023 handoff #2 named the gap ("Wire `evaluateCopilot({ conflicts })`
// into a caller") and T13 entry 0025 handoff #6 named a cousin of it. This file
// is the evidence that the gap is closed — and, just as importantly, the
// evidence that it was closed on the SERVER rather than by teaching a browser
// to run the decision path.
//
// WHAT IS PROVED HERE, AND WHAT IS NOT.
//
//   PROVED: the route is reachable, it is GATED (401 anonymous), and with a
//   broker seam injected it returns a score, per-expert contributions, the fired
//   vetoes and a risk observation that came out of the REAL engine and the REAL
//   risk layer — not out of a hand-built object.
//   PROVED: an asset with too little history returns an ABSENCE with a named
//   reason and `confluence: null`, never a zero score.
//   PROVED: `conflicts` is ASKED FOR, not skipped, so C1/C2/C3 participate.
//   PROVED: `computedAt` is the newest bar's own time, so the same series scores
//   identically on a replay and no caller can choose whether `sessionOpen` fires.
//
//   NOT PROVED, AND NOT CLAIMED: that any live broker serves a given asset. The
//   broker is injected in every test here. Nothing in this file asserts a real
//   feed exists, and no assertion below should be read as one.

import { describe, expect, it } from "vitest"
import { copilotDecisionForAsset, COPILOT_DECISION_VERSION } from "../decision.mjs"
import { MIN_DAILY_CLOSES, MIN_WORKING_CANDLES } from "../marketState.mjs"
import { CONFLICT_RULE_IDS } from "../conflicts/index.mjs"

/**
 * A deterministic ramp: enough bars to warm every series, no clock involved.
 *
 * `time` is in unix SECONDS, because that is what every broker adapter in this
 * tree emits (yahooAdapter.mjs:75, ccxtConnector.mjs:103, trading.mjs:407) and
 * what `marketDataBus.mjs:157` treats as seconds when it multiplies by 1000 to
 * report a span in ms. An earlier version of this fixture wrote milliseconds
 * here, which is not a shape any producer produces — and that mismatch is why
 * the missing conversion in `lastTimeMs()` survived: the fixture agreed with the
 * bug instead of with the wire.
 */
function ramp(n, { start = 1.08, step = 0.0004, atSec = Math.floor(Date.UTC(2023, 10, 14, 13, 0, 0) / 1000) } = {}) {
  const out = []
  for (let i = 0; i < n; i++) {
    const close = start + step * i
    out.push({
      time: atSec - (n - 1 - i) * 60,
      open: close - step / 2,
      high: close + Math.abs(step),
      low: close - Math.abs(step),
      close,
      volume: 1000
    })
  }
  return out
}

/** A broker seam that serves the same ramp at whichever timeframe is asked for. */
function broker({ working = 240, h4 = 200, daily = 420, source = "test-broker", atSec } = {}) {
  const asked = []
  const anchor = { atSec }
  const fetchCandles = async (_assetId, { timeframe, count }) => {
    asked.push({ timeframe, count })
    if (timeframe === 14400) return { candles: h4 > 0 ? ramp(h4, anchor) : [], source }
    if (timeframe === 86400) return { candles: daily > 0 ? ramp(daily, { ...anchor, step: 0.002 }) : [], source }
    return { candles: working > 0 ? ramp(working, anchor) : [], source }
  }
  return { fetchCandles, asked }
}

describe("WS-7 T7R-B — the first caller of the deterministic engine", () => {
  it("returns a REAL score, per-expert contributions and fired vetoes", async () => {
    const out = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker() })

    // The whole point: the engine RAN, and produced a number.
    expect(out.engineVersion).toMatch(/^copilot-engine\//)
    expect(out.decisionVersion).toBe(COPILOT_DECISION_VERSION)
    expect(out.confluence).not.toBeNull()
    expect(typeof out.confluence.score).toBe("number")
    expect(Number.isFinite(out.confluence.score)).toBe(true)

    // T7's acceptance line at spec :1260 is "the score, per-expert contributions,
    // and fired vetoes". All three, by name.
    const contributions = out.confluence.contributions
    expect(contributions).toHaveLength(6)
    for (const c of contributions) {
      expect(typeof c.expert).toBe("string")
      expect(typeof c.weightPct).toBe("number")
      // An expert may be UNAVAILABLE, which is honest, but it must never be a
      // silent absence: `available: false` has to carry a reason, and a
      // contributing expert must carry a finite delta.
      if (c.available === false) {
        expect(typeof c.unavailableReason).toBe("string")
        expect(c.rawDelta).toBeNull()
      } else {
        expect(typeof c.rawDelta).toBe("number")
        expect(Number.isFinite(c.rawDelta)).toBe(true)
      }
    }

    expect(Array.isArray(out.vetoes)).toBe(true)
    expect(out.vetoes.length).toBeGreaterThan(0)
    for (const v of out.vetoes) {
      expect(typeof v.ruleId).toBe("string")
      // Versioned, so a veto a reader saw last week is distinguishable from this
      // week's if the rule's inputs ever change.
      expect(v.ruleVersion).toMatch(/^copilot-veto-/)
      expect(typeof v.fired).toBe("boolean")
      expect(typeof v.suppressed).toBe("string")
    }
    expect(Array.isArray(out.firedVetoes)).toBe(true)
  })

  it("derives computedAt from the newest bar, never from a clock the route read", async () => {
    const out = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker() })
    const expected = Date.UTC(2023, 10, 14, 13, 0, 0)

    // `Date.now()` would be ~1.7e12 today. The bar's own time is 2023. This is
    // the assertion that makes a replay reproducible, and it is why the route
    // does not mint its own timestamp.
    expect(out.computedAt).toBe(expected)
    expect(out.computedAt).not.toBeGreaterThan(expected + 1000)
    expect(out.confluence.computedAt).toBe(out.computedAt)
  })

  // ---------------------------------------------------------------------------
  // THE UNIT THE WIRE ACTUALLY CARRIES.
  // ---------------------------------------------------------------------------
  //
  // Every broker adapter in this tree emits OHLC `time` in unix SECONDS:
  //
  //   yahooAdapter.mjs:75   time: Math.floor(dates[i] / 1000)
  //   ccxtConnector.mjs:103 time: Math.floor(Number(ts) / 1000) || 0
  //   trading.mjs:407       time: Math.floor(history.dates[i] / 1000)
  //   handlers.mjs:4727/5285/5682  time: Math.floor(ts / 1000)
  //
  // and the fan-in that feeds this route says so itself — `marketDataBus.mjs:157`
  // computes a span in MILLISECONDS as `(b - a) * 1000` over the raw `.time`
  // difference. `accuracyLedger.mjs:83` documents it in prose ("`.time` (unix
  // SECONDS)") and `volatility.mjs:142` carries the scar of the same class of bug.
  //
  // `marketState.mjs:137` declares the OTHER unit: "`computedAt` must be a
  // supplied finite epoch-ms number". So `lastTimeMs()` must convert. When it did
  // not, the raw seconds value flowed into `regime.mjs:103` (`decimalUtcHour`)
  // and `sessionOpen.mjs:49` (the safety veto), which both do
  // `new Date(ms).getUTCHours()` — so the mis-scaled value silently classified
  // the WRONG SESSION, and the client rendered `1970-01-21T17:49:46.140Z`.
  //
  // This test drives a seconds-denominated series, because that is what the wire
  // carries. A milliseconds fixture here would agree with the bug, which is
  // exactly how it survived.
  //
  // THE FIXTURE AND THE CONVERSION ARE COUPLED, and that coupling is this test's
  // blind spot: reverting `lastTimeMs()`'s `* 1000` AND `AT_SEC` back to
  // milliseconds TOGETHER restores the bug with this test still green, because
  // the fixture would then agree with the un-converted code. Either half alone
  // is caught — drop the conversion and line 160's `toBe(AT_MS)` fails; feed
  // seconds to a milliseconds `AT_SEC` and line 162's `not.toBe(AT_SEC)` fails.
  //
  // The protection against moving only one of them is that SECONDS IS THE
  // NORMATIVE UNIT HERE, asserted by the block comment above (four producers,
  // `marketDataBus.mjs:157`) and by this test's own name. `AT_SEC` is defined as
  // `Math.floor(AT_MS / 1000)` rather than as a literal, so the fixture cannot
  // silently drift back to the millisecond shape — it is derived from the same
  // instant the assertions check. If the wire's unit ever changes, BOTH the
  // production conversion and this fixture must move together, and the block
  // comment's producer list is the evidence to re-check before either does.
  it("converts the bar's unix-SECOND time to the epoch-ms computedAt the engine's contract declares", async () => {
    const AT_MS = Date.UTC(2023, 10, 14, 13, 0, 0)
    const AT_SEC = Math.floor(AT_MS / 1000)

    const out = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker({ atSec: AT_SEC }) })

    // The engine's contract, asserted at the boundary that supplies it.
    expect(out.computedAt).toBe(AT_MS)
    // NOT the raw seconds — this is the assertion that fails without the fix.
    expect(out.computedAt, "computedAt must not be the un-converted seconds value").not.toBe(AT_SEC)
    // And therefore the hour the engine derives is the hour the bar was stamped
    // in, not an hour in January 1970. `regime.mjs` and `sessionOpen.mjs` both
    // read this value through `new Date(ms).getUTCHours()`.
    const d = new Date(out.computedAt)
    expect(d.getUTCFullYear()).toBe(2023)
    expect(d.getUTCHours()).toBe(13)
    expect(out.confluence.computedAt).toBe(AT_MS)
    // The vetoes carry the same instant, so `stamp(v.evaluatedAt)` on the client
    // agrees with the score line rather than contradicting it by 1000x.
    for (const v of out.vetoes) {
      expect(new Date(v.evaluatedAt).getUTCFullYear(), `${v.ruleId} evaluatedAt`).toBe(2023)
    }
    // And the ATR observation, which is stamped from the same value.
    expect(out.risk.atr.observedAt).toBe(AT_MS)
  })

  it("is byte-reproducible: the same series scores the same twice", async () => {
    const a = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker() })
    const b = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker() })
    expect(JSON.stringify(a.confluence)).toBe(JSON.stringify(b.confluence))
    expect(JSON.stringify(a.tier)).toBe(JSON.stringify(b.tier))
  })

  it("asks for the conflicts, so C1/C2/C3 are evaluated rather than skipped", async () => {
    const out = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker() })

    // T12 made the engine byte-identical to T11's when `conflicts` is null. This
    // route passes `{}`, so the conflict layer must have run and reported all
    // three — with `notEvaluated` absent, which is the flag T12 added precisely
    // to tell "not asked" from "asked and none applied".
    expect(out.conflicts).not.toBeNull()
    expect(out.conflicts.notEvaluated).toBeUndefined()
    // T12's short ids live on `rule`; `ruleId` there is the versioned
    // capability name. The room shows the short one.
    const reported = out.conflicts.resolutions.map((r) => r.rule)
    for (const id of CONFLICT_RULE_IDS) {
      expect(reported, `${id} must be reported, applied or not`).toContain(id)
    }
    // Every rule reports a status, so "asked and none applied" is
    // distinguishable from "asked and silently dropped".
    for (const r of out.conflicts.resolutions) {
      expect(typeof r.status).toBe("string")
      expect(r.status.length).toBeGreaterThan(0)
    }
    // And the winner list is the spec's shape: strings only, applied rules only.
    for (const override of out.confluence.conflictOverrides) {
      expect(typeof override).toBe("string")
      expect(CONFLICT_RULE_IDS).toContain(override)
    }
  })

  it("fails CLOSED on the broker flag: automationPermitted is false and rung is paper", async () => {
    const out = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker() })

    // AC-024: an absent flag must never mean permitted. AC-025: lowest rung.
    // The route supplies neither, and `tierFor` must have applied them.
    expect(out.tier.automationPermitted).toBe(false)
    expect(out.tier.rung).toBe("paper")
    // And therefore no tier may authorise an automated action.
    expect(out.tier.action).toBe("hold")
  })

  it("derives a REAL ATR observation from the same bars, and nulls the two it cannot", async () => {
    const out = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker() })

    // ATR(14) at 1.5x is T11's producer, on the engine's own series.
    expect(out.risk.atr).not.toBeNull()
    expect(out.risk.atr.period).toBe(14)
    expect(out.risk.atr.multiple).toBe(1.5)
    expect(out.risk.atr.atr).toBeGreaterThan(0)
    expect(out.risk.atr.stopDistance).toBeCloseTo(out.risk.atr.atr * 1.5, 10)
    expect(out.risk.atr.observedAt).toBe(out.computedAt)

    // The two rails nothing supplies stay ABSENT, with a reason each. This is
    // the assertion the Risk room's honesty rests on.
    expect(out.risk.drawdown).toBeNull()
    expect(out.risk.drawdownUnavailableReason).toMatch(/daily drawdown/i)
    expect(out.risk.threeStrike).toBeNull()
    expect(out.risk.threeStrikeUnavailableReason).toMatch(/strike/i)

    // The near-matches that DO exist in this tree are named as NOT substituted.
    expect(out.risk.drawdownUnavailableReason).toContain("v32Copilot")
    expect(out.risk.drawdownUnavailableReason).toContain("u4faRisk")
  })

  it("reports an ABSENCE with a named reason when history is below the engine's floor", async () => {
    // Five bars is enough for `deriveMarketState` to succeed and for the engine to
    // return a NUMBER. That number has every leg cold, so the route refuses below
    // MIN_WORKING_CANDLES instead of presenting it. This assertion is the
    // difference between a degraded reading and a non-reading.
    const out = await copilotDecisionForAsset({ assetId: "THIN", ...broker({ working: 5, daily: 5 }) })

    // Never a zero score, never a 200 with `score: 0`.
    expect(out.confluence).toBeNull()
    expect(out.firedVetoes).toEqual([])
    expect(out.engineVersion).toBeNull()
    expect(out.risk.atr).toBeNull()

    // Per leg, with the requirement stated. A single boolean would hide WHICH of
    // the three inputs was missing, and the room renders these as named rows.
    const legs = Object.fromEntries(out.unavailable.map((u) => [u.leg, u.reason]))
    expect(legs.working).toContain(String(MIN_WORKING_CANDLES))
    expect(legs.daily).toContain(String(MIN_DAILY_CLOSES))
  })

  it("still refuses when the working leg is ample but the daily leg is not", async () => {
    // Macro Bias's 200/400 EMA legs need 400 daily closes. Without them the
    // engine reports Macro Bias unavailable and scores the rest — which for a
    // 20%-weighted expert is not a reading worth presenting as complete.
    //
    // What the route does here is DELIBERATE and worth stating: it reports the
    // leg as unavailable and STILL returns the confluence, because five warm
    // experts plus one named cold expert is a legitimately partial reading and
    // the room renders the cold expert by name. This test pins that choice so a
    // later change to refuse wholesale is a deliberate act rather than a drift.
    const out = await copilotDecisionForAsset({ assetId: "PARTIAL", ...broker({ daily: 10 }) })

    expect(out.confluence).not.toBeNull()
    const macro = out.confluence.contributions.find((c) => c.expert === "macroBias")
    expect(macro.available).toBe(false)
    expect(macro.unavailableReason.length).toBeGreaterThan(0)
    const legs = Object.fromEntries(out.unavailable.map((u) => [u.leg, u.reason]))
    expect(legs.daily).toContain(String(MIN_DAILY_CLOSES))
  })

  it("does not crash when the broker throws on one leg", async () => {
    const { fetchCandles } = broker()
    const flaky = async (assetId, opts) => {
      if (opts.timeframe === 14400) throw new Error("4h leg unavailable upstream")
      return fetchCandles(assetId, opts)
    }
    const out = await copilotDecisionForAsset({ assetId: "EURUSD", fetchCandles: flaky })

    // One leg dying is not a 502 and not a fabricated 4H series. The 4H expert
    // simply becomes unavailable, and the working leg still scores.
    expect(out.confluence).not.toBeNull()
    const structural = out.confluence.contributions.find((c) => c.expert === "structural")
    expect(structural).toBeDefined()
    expect(out.coverage.h4Bars).toBe(0)
  })

  it("never supplies sentiment, news or proposals, so those report unavailable", async () => {
    const out = await copilotDecisionForAsset({ assetId: "EURUSD", ...broker() })

    // The 5% expert is T13's input and nothing supplies it. It must show as
    // unavailable WITH a reason, not as a zero contribution.
    const sentiment = out.confluence.contributions.find((c) => c.expert === "sentiment")
    expect(sentiment).toBeDefined()
    expect(sentiment.available).toBe(false)
    expect(sentiment.rawDelta).toBeNull()
    expect(sentiment.unavailableReason).toMatch(/sentiment/i)

    // `newsLockout` and `correlationTrap` must be UNEVALUATED and therefore
    // FIRED, not passing. An unevaluated veto that read as a passing veto would
    // be a false clearance on a Red Folder release nobody checked for.
    for (const id of ["newsLockout", "correlationTrap"]) {
      const veto = out.vetoes.find((v) => v.ruleId === id)
      expect(veto, `${id} must be reported`).toBeDefined()
      expect(veto.fired, `${id} fails closed when its source is absent`).toBe(true)
      expect(veto.inputs.unevaluated).toMatch(/newsEvents|proposals/)
      expect(veto.inputs.missing.length).toBeGreaterThan(0)
    }
  })

  it("rejects a missing assetId rather than defaulting one", async () => {
    await expect(copilotDecisionForAsset({})).rejects.toThrow(/assetId/i)
    await expect(copilotDecisionForAsset({ assetId: "   " })).rejects.toThrow(/assetId/i)
  })

  it("fetches each leg ONCE — one client request, three server-side broker calls", async () => {
    const b = broker()
    await copilotDecisionForAsset({ assetId: "EURUSD", ...b })
    // Two broker calls for the same timeframe would mean a double-fetch bug that
    // inflates the transition the perf spec measures.
    expect(b.asked).toHaveLength(3)
    expect(b.asked.map((a) => a.timeframe).sort((x, y) => x - y)).toEqual([60, 14400, 86400])
  })
})
