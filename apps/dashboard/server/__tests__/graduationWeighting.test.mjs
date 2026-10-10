import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
// THE ONE COMMENT LEXER, by import. This suite scans its own module's source to
// prove it carries no store, permit, ceremony, credential or I/O surface, and a
// hand-rolled stripper for that is the exact shape
// `sharedCommentLexer.test.mjs` exists to prevent. This file is registered as a
// consumer there, so a local sixth lexer cannot be pasted in silently.
import { stripComments } from "../scripts/guard-primitives.mjs"
import {
  HALFLIFE_DAYS_DEFAULT,
  HALFLIFE_DAYS_ENV,
  WEIGHT_REASONS,
  decayWeight,
  weightedMetric
} from "../services/graduation/weighting.mjs"
import { collectWindows } from "../services/graduation/windows.mjs"

// Graduation recency weighting — pure readout arithmetic.
//
// Hermetic by construction: the clock is INJECTED (`now`) on every call that
// computes a weight, so nothing here reads a wall clock, and no test sleeps. The
// one process read the module is allowed is the documented half-life override,
// which the suite varies itself rather than inheriting from the developer shell.
const DAY_MS = 86_400_000

// A frozen "now" far from the fixtures, so a test that forgets to inject `now`
// cannot accidentally agree with the arithmetic it is asserting.
const NOW = Date.parse("2026-10-01T00:00:00Z")

/** An ISO stamp `days` before NOW. */
const daysBefore = (days) => new Date(NOW - days * DAY_MS).toISOString()

// The half-life name is imported from the module rather than written out at every
  // use site, on purpose. `ws7TestStoreIsolation` scans test files for path-shaped
// `PICC_` names and Task 1's suite already learned the hard way that minting such
// a literal — even inside a control fixture — is a finding. Going through the
// export means this file MINT no store variable: the one place the name is spelled
// out is the single assertion that pins the exported constant to the spec's
// literal, and it is a `_DAYS` scalar, never a path-shaped store name.
afterEach(() => {
  vi.unstubAllEnvs()
})

/**
 * A Task 1 window, with every statistic UNMEASURED unless a test says otherwise.
 *
 * The nulls are the point, not laziness: they are the honest default state of a
 * window that measured nothing, and starting every fixture from them means a
 * test that forgets to set a statistic is testing the skip path rather than
 * accidentally asserting a weighted average over a fabricated zero.
 */
const windowEndingDaysAgo = (days, stats = {}) => ({
  source: "backtest",
  strategyTag: "trend",
  windowStart: daysBefore(days + 10),
  windowEnd: daysBefore(days),
  returnPct: null,
  sharpe: null,
  maxDd: null,
  costDragUsd: null,
  provenance: "backtest",
  reasons: [],
  ...stats
})

describe("decayWeight", () => {
  // The half-life claim itself, asserted on the exact values the brief names.
  // `0.5 ** 1` and `0.5 ** 2` are exact in IEEE-754, so `toBe` is available here
  // and an approximation dressed as an equality would be a worse test.
  it("halves the weight at exactly one half-life and quarters it at two", () => {
    expect(HALFLIFE_DAYS_DEFAULT, "the brief pins the default at 30 days").toBe(30)
    expect(decayWeight(daysBefore(0), { now: NOW })).toBe(1)
    expect(decayWeight(daysBefore(30), { now: NOW })).toBe(0.5)
    expect(decayWeight(daysBefore(60), { now: NOW })).toBe(0.25)
  })

  // AN UNDATEABLE WINDOW IS ABSENT, NOT FRESH AND NOT AN ERROR.
  //
  // The tempting defaults are all lies: "assume it ended now" makes an undated
  // window the most persuasive evidence in the pile, and "weight 0" would make
  // the same window silently vanish from `totalWeight` while still being counted.
  // `windows.mjs` already excludes such rows at the boundary; this is the second
  // line of defence for a caller that builds a pile by hand, and it answers with
  // `null` — the same "we could not measure this" that a null statistic means.
  it("yields null for a windowEnd that cannot be an instant, rather than guessing", () => {
    for (const undateable of [null, undefined, "", "not-a-date", {}, Number.NaN]) {
      expect(
        decayWeight(undateable, { now: NOW }),
        `${JSON.stringify(undateable)} must read as absence, not as a fabricated recency`
      ).toBeNull()
    }
  })

  // ---- The configured half-life -----------------------------------------
  //
  // THE OVERRIDE IS READ LAZILY, INSIDE THE CALL, AND THAT IS THE WHOLE POINT OF
  // PINNING IT HERE. Captured once at module load it would be a constant dressed
  // as configuration: `vi.stubEnv` below runs long after the import has completed,
  // so a load-time capture would silently ignore every one of these assertions
  // and the override would look covered while being untestable and, worse,
  // unchangeable for a process that reconfigures at runtime.
  it("honours PICC_GRADUATION_HALFLIFE_DAYS, read at call time rather than at import", () => {
    expect(HALFLIFE_DAYS_ENV).toBe("PICC_GRADUATION_HALFLIFE_DAYS")
    vi.stubEnv(HALFLIFE_DAYS_ENV, "7")
    // Seven days on the configured half-life is exactly one halving.
    expect(decayWeight(daysBefore(7), { now: NOW })).toBe(0.5)
    // ...and at the default half-life the same window is nowhere near a halving,
    // which is what proves the override is live rather than coincidental.
    expect(decayWeight(daysBefore(7), { now: NOW, halfLifeDays: 30 })).toBeCloseTo(0.5 ** (7 / 30), 12)

    // Changed again mid-process: a load-time capture could not see this.
    vi.stubEnv(HALFLIFE_DAYS_ENV, "14")
    expect(decayWeight(daysBefore(14), { now: NOW })).toBe(0.5)
  })

  // A BAD OVERRIDE MUST DEGRADE TO THE DEFAULT, NEVER TO NaN AND NEVER BY
  // THROWING. A half-life of 0 would divide by zero and produce Infinity, which
  // then propagates into `totalWeight` and quietly destroys every downstream
  // average — so the guard is on the VALUE, not on its parseability.
  it("falls back to the default for an invalid override, and never throws", () => {
    // THE CONTROL, and it is here because this test would otherwise be vacuous.
    // Before the override existed, EVERY bad value below already produced 0.5 —
    // not because bad values are handled, but because nothing read the variable
    // at all. So the first step proves the channel is live; if a future change
    // drops the env read, this fails at the control instead of passing all ten
    // bad values for the wrong reason.
    vi.stubEnv(HALFLIFE_DAYS_ENV, "7")
    expect(decayWeight(daysBefore(7), { now: NOW }), "the override must be live before its failures mean anything")
      .toBe(0.5)

    for (const bad of ["", "   ", "abc", "0", "-5", "30days", "NaN", "Infinity", null, undefined]) {
      vi.stubEnv(HALFLIFE_DAYS_ENV, bad)
      expect(() => decayWeight(daysBefore(30), { now: NOW }), `override ${JSON.stringify(bad)} must not throw`)
        .not.toThrow()
      expect(
        decayWeight(daysBefore(30), { now: NOW }),
        `${JSON.stringify(bad)} must degrade to the ${HALFLIFE_DAYS_DEFAULT}-day default, not to NaN or 0`
      ).toBe(0.5)
    }
    // A zero or negative half-life must also not survive as an EXPLICIT argument,
    // which is the same failure arriving through the other door.
    for (const badArgument of [0, -30, Number.NaN, Number.POSITIVE_INFINITY, "30"]) {
      expect(
        decayWeight(daysBefore(30), { now: NOW, halfLifeDays: badArgument }),
        `explicit halfLifeDays ${JSON.stringify(badArgument)} must not be honoured`
      ).toBe(0.5)
    }
  })
})

describe("weightedMetric", () => {
  // THE ZERO THAT IS NOT A ZERO. An empty pile averaging to 0 is the single most
  // dangerous output this module could produce: downstream it reads as "we
  // measured this and it was flat", which is a different claim from "we have
  // nothing", and only one of those two may argue a strategy over a floor.
  it("reports absence for an empty pile, with a named reason and never a zero", () => {
    for (const empty of [[], null, undefined, {}, "nope", 42]) {
      const out = weightedMetric(empty, "sharpe", { now: NOW })
      expect(out.value, `${JSON.stringify(empty) ?? "undefined"} must not produce a value`).toBeNull()
      expect(out.value, "an empty pile must never read as a measured 0").not.toBe(0)
      expect(out.totalWeight).toBe(0)
      expect(out.windowCount).toBe(0)
      expect(out.reason, "absence must be named, so a consumer can branch on it").toBe(
        WEIGHT_REASONS.NO_WINDOWS
      )
      expect(Array.isArray(out.reasons), "per-window reasons are carried alongside the terminal one").toBe(true)
    }
  })

  // A pile of windows that all measured NULL is the same absence reached the long
  // way round, and it must not reach the short way round (0) on the way.
  it("reports absence when no window measured the picked statistic", () => {
    const windows = [windowEndingDaysAgo(1), windowEndingDaysAgo(20)]
    const out = weightedMetric(windows, "sharpe", { now: NOW })
    expect(out.value).toBeNull()
    expect(out.value).not.toBe(0)
    expect(out.totalWeight).toBe(0)
    expect(out.windowCount).toBe(0)
    expect(out.reason).toBe(WEIGHT_REASONS.NO_MEASURED_WINDOWS)
    expect(out.reasons).toContain(WEIGHT_REASONS.STAT_UNMEASURED)
  })

  // No `pick` means no statistic was chosen. Guessing one (defaulting to
  // `returnPct`, say) would answer a question nobody asked with a number nobody
  // chose.
  it("reports a missing pick rather than assuming one", () => {
    const windows = [windowEndingDaysAgo(1, { sharpe: 1.4 })]
    for (const pick of [undefined, null, "", 42, {}]) {
      const out = weightedMetric(windows, pick, { now: NOW })
      expect(out.value, `pick ${JSON.stringify(pick) ?? "undefined"} must not yield a value`).toBeNull()
      expect(out.windowCount, "no window may be counted against a pick that was never made").toBe(0)
      expect(out.reason).toBe(WEIGHT_REASONS.PICK_MISSING)
    }
  })

  // ---- The weighting, actually doing something ---------------------------
  //
  // If recency weighting did nothing, every assertion in the rest of the module
  // would still pass — an arithmetic mean is also a weighted mean with all the
  // weights equal. So this pins the DIFFERENCE from the plain mean, which is the
  // only claim the feature exists to make.
  it("pulls the average toward the fresh window and away from the stale one", () => {
    const windows = [
      windowEndingDaysAgo(0, { sharpe: 2 }),
      windowEndingDaysAgo(60, { sharpe: 0 }) // weight 0.25 on a 30d half-life
    ]
    const out = weightedMetric(windows, "sharpe", { now: NOW })
    // (2 * 1 + 0 * 0.25) / 1.25 = 1.6. The unweighted mean would be 1.
    expect(out.value).toBeCloseTo(1.6, 12)
    expect(out.value, "the result must differ from the plain mean, or nothing is weighted").not.toBe(1)
    expect(out.totalWeight).toBeCloseTo(1.25, 12)
    expect(out.windowCount).toBe(2)
    expect(out.reason).toBeNull()
  })

  // RULING 2. An unmeasured window is not a zero, is not counted, and does not
  // dilute. Both halves are checked against the same pile, because a
  // zero-averaged-in implementation gets ONE of them wrong far more easily than
  // the other: the value shifts while the count still looks right.
  it("excludes an unmeasured window from both the average and the count", () => {
    const windows = [
      windowEndingDaysAgo(0, { sharpe: 2 }),
      windowEndingDaysAgo(0, { sharpe: null, reasons: ["sharpe:insufficient-observations"] }),
      windowEndingDaysAgo(0, { sharpe: -10 })
    ]
    const out = weightedMetric(windows, "sharpe", { now: NOW })
    expect(out.value, "an unmeasured window must not dilute the mean toward zero").toBe(-4)
    expect(out.value, "averaging the unmeasured window in as 0 would give -2.67").not.toBeCloseTo(-8 / 3, 6)
    expect(out.windowCount, "an unmeasured window must not inflate the evidence count").toBe(2)
    expect(out.totalWeight).toBe(2)
    expect(out.reasons).toEqual([WEIGHT_REASONS.STAT_UNMEASURED])
  })

  // THE EMPTY STRING, one layer down from Task 1's fix. A blank `sharpe` that
  // survives a naive `Number()` becomes a measured 0 and drags the mean to 1 —
  // a strategy that looks mediocre because of a column nobody filled in.
  it("reads a blank statistic as absence, while a written-down zero stays a measurement", () => {
    const blank = weightedMetric(
      [windowEndingDaysAgo(0, { sharpe: 2 }), windowEndingDaysAgo(0, { sharpe: "" })],
      "sharpe",
      { now: NOW }
    )
    expect(blank.value, 'a blank sharpe must not become a measured 0 (that would average to 1)').toBe(2)
    expect(blank.windowCount).toBe(1)
    expect(blank.reasons).toEqual([WEIGHT_REASONS.STAT_UNMEASURED])

    // And the complement, so the rule is not "blank-ish values are skipped".
    const zero = weightedMetric(
      [windowEndingDaysAgo(0, { sharpe: 2 }), windowEndingDaysAgo(0, { sharpe: 0 })],
      "sharpe",
      { now: NOW }
    )
    expect(zero.value, "a measured zero is a measurement, and averages in as one").toBe(1)
    expect(zero.windowCount).toBe(2)
    expect(zero.reasons).toEqual([])
  })

  // A measured statistic with an unreadable end instant cannot be dated, so it
  // cannot be weighed. Dropping it entirely (rather than weighting it as fresh)
  // is what keeps the count honest: Task 3 counts windows, and an undated one
  // cannot be placed in the chronology the count runs along.
  it("drops a window whose end instant is unreadable even when its statistic is measured", () => {
    const windows = [
      windowEndingDaysAgo(0, { sharpe: 2 }),
      { ...windowEndingDaysAgo(0, { sharpe: 10 }), windowEnd: "not-a-date" }
    ]
    const out = weightedMetric(windows, "sharpe", { now: NOW })
    expect(out.value, "an undated window must not be weighed as if it were fresh").toBe(2)
    expect(out.windowCount).toBe(1)
    expect(out.reasons).toEqual([WEIGHT_REASONS.WEIGHT_UNCOMPUTABLE])
  })

  // `pick` as a reader, so a caller can average something derived without this
  // module inventing the derivation.
  it("accepts a pick function for a derived quantity", () => {
    const windows = [
      windowEndingDaysAgo(0, { returnPct: 4, costDragUsd: 1 }),
      windowEndingDaysAgo(30, { returnPct: 8, costDragUsd: 2 })
    ]
    const out = weightedMetric(windows, (w) => w.returnPct - w.costDragUsd, { now: NOW })
    // (3 * 1 + 6 * 0.5) / 1.5 = 4
    expect(out.value).toBeCloseTo(4, 12)
    expect(out.windowCount).toBe(2)
  })

  // ---- The clock ---------------------------------------------------------
  //
  // HERMETIC BY INJECTION. `NOW` sits in the fixture's own past, and the two
  // instants below are ~56 and ~74 years away from it, so neither can collide
  // with whatever the machine running this suite thinks the time is — which is
  // what lets them be asserted by VALUE rather than by range. The wall-clock
  // branch at the end of this test cannot be asserted by value at all, so its
  // clock is faked instead.
  it("measures age against the injected `now`, never the wall clock", () => {
    const end = daysBefore(30)
    // 1970 predates the window, so the window is in the future and maximally recent.
    expect(decayWeight(end, { now: Date.parse("1970-01-01T00:00:00Z") })).toBe(1)
    // 2100 puts it ~27 000 days back: the weight is astronomically small but must
    // remain strictly POSITIVE, because `0.5 ** k` underflows to a literal 0 for
    // large enough k and that 0 is an artifact of the arithmetic, not a finding.
    const ancient = decayWeight(end, { now: Date.parse("2100-01-01T00:00:00Z") })
    expect(ancient, "the weight must never underflow to exactly 0").toBeGreaterThan(0)
    expect(ancient).toBeLessThan(1e-100)
    // ...and the two injected clocks give different answers, so `now` is genuinely
    // read rather than recomputed from the same hidden source twice.
    expect(decayWeight(end, { now: Date.parse("1970-01-01T00:00:00Z") })).not.toBe(
      decayWeight(end, { now: Date.parse("2100-01-01T00:00:00Z") })
    )
    // Omitting `now` DOES fall back to the wall clock. That branch is covered for
    // its CONTRACT — "a finite weight inside (0, 1], for whatever instant the
    // machine thinks it is" — and NOT for a specific value.
    //
    // AN EARLIER VERSION OF THIS ASSERTED `.not.toBe(1)` and was wrong: `end` is a
    // fixed 2026-09-01 stamp, so on any machine whose clock is BEFORE that (a
    // restored fixture VM, a CI runner with skewed time, a bisect onto an earlier
    // snapshot) the weight is exactly 1 and the assertion fails. Asserting a
    // specific wall-clock value re-creates in the test suite the very dependence
    // the `now` parameter exists to remove.
    //
    // The clock is therefore FAKED, and both regimes are exercised. That is what
    // turns "probably clock-independent" into a proof: the pre-`end` clock below
    // is precisely the case that broke the old assertion, and it is now asserted
    // as the value it genuinely is — exactly 1 — rather than as "not 1".
    const wallClockAt = (iso) => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(Date.parse(iso))
        return decayWeight(end)
      } finally {
        vi.useRealTimers()
      }
    }

    // Regime 1 — the machine clock predates the window's end, so the window is
    // "future-dated" and maximal. This is the case the old assertion got wrong.
    expect(wallClockAt("2020-01-01T00:00:00Z"), "a clock before the window end yields the maximum weight").toBe(1)

    // Regime 2 — the machine clock is far past it, so the weight is small but
    // must still be a positive finite number inside the documented range.
    const after = wallClockAt("2100-01-01T00:00:00Z")
    expect(typeof after, "the wall-clock branch must return a weight, not absence").toBe("number")
    expect(Number.isFinite(after), "the wall clock must not yield NaN or Infinity").toBe(true)
    expect(after, "the documented range is (0, 1] on every clock").toBeGreaterThan(0)
    expect(after, "the documented range is (0, 1] on every clock").toBeLessThanOrEqual(1)
  })

  // An unusable `now` is the same defect as an unusable `windowEnd`, in the other
  // argument: quietly falling back to the wall clock answers a question nobody
  // asked with an instant nobody chose, and in a replay or a backtest that is the
  // difference between a reproducible number and a moving target.
  it("reports absence for an unusable `now` instead of silently reading the clock", () => {
    for (const undateable of ["not-a-date", "", Number.NaN, {}, null]) {
      expect(
        decayWeight(daysBefore(30), { now: undateable }),
        `now=${JSON.stringify(undateable) ?? "null"} must read as absence, not as a silent wall-clock fallback`
      ).toBeNull()
    }
  })

  // The range invariant, across ages chosen to cross the underflow boundary.
  it("keeps every weight inside (0, 1] for any age", () => {
    const end = "2020-01-01T00:00:00.000Z"
    // CAPPED AT 9e7 DAYS DELIBERATELY, and the cap is measured rather than guessed:
    // a `Date` is valid only out to about ±1e8 days (±8.64e15 ms), and `1e8`
    // already lands on `NaN`. An age past that has no instant to be measured
    // against, so the honest answer there is `null`, not a weight — which is
    // asserted separately below rather than smuggled in as a "range" case.
    for (const days of [0, 1, 29, 30, 31, 365, 3650, 1e5, 1e6, 1e7, 9e7]) {
      const w = decayWeight(end, { now: Date.parse("2026-10-01T00:00:00Z") + days * DAY_MS })
      expect(w, `weight at ${days} days`).toBeGreaterThan(0)
      expect(w, `weight at ${days} days`).toBeLessThanOrEqual(1)
    }
  })

  // A FUTURE-DATED WINDOW, and the negative-age case that makes the clamp
  // load-bearing.
  //
  // `ageDays = (now - windowEnd)` is NEGATIVE for a window that has not closed
  // yet, and `0.5 ** (negative / halfLife)` is therefore GREATER THAN 1. Left
  // unclamped, a window dated 2030 would carry more weight than one that closed
  // today — inverting the entire ordering this module exists to express, and
  // letting a typo in a timestamp argue a strategy over a floor.
  //
  // `halfLifeDays: 30` is passed EXPLICITLY on both lines so the counterfactual
  // below is computed against the same half-life the module is given, rather
  // than against whatever `PICC_GRADUATION_HALFLIFE_DAYS` happens to hold in the
  // developer's shell. Without it this test would read ambient configuration.
  it("clamps a future-dated window to 1 instead of letting the weight exceed the range", () => {
    const now = Date.parse("2026-10-01T00:00:00Z")
    const FAR_FUTURE = "2030-01-01T00:00:00.000Z"
    const NEXT_DAY = "2026-10-02T00:00:00.000Z"

    expect(decayWeight(FAR_FUTURE, { now, halfLifeDays: 30 })).toBe(1)
    expect(decayWeight(NEXT_DAY, { now, halfLifeDays: 30 })).toBe(1)

    // The counterfactual, written out as plain arithmetic and NOT read back from
    // the module — so this pins the clamp rather than restating the result. If
    // the clamp were removed, this value would be what the function returned.
    const unclamped = 0.5 ** ((now - Date.parse(FAR_FUTURE)) / DAY_MS / 30)
    expect(unclamped, "the clamp must be doing real work, not describing a no-op").toBeGreaterThan(1)
  })

  // An instant no `Date` can hold is the same absence as a malformed one: the age
  // is undefined, so there is nothing to weigh. Clamping an unrepresentable
  // `Date.MAX_VALUE`-plus instant to the floor would invent a measurement.
  it("reports absence for an instant beyond the representable range", () => {
    expect(decayWeight("2020-01-01T00:00:00.000Z", { now: 8.64e22 })).toBeNull()
  })

  // An AVERAGE THAT OVERFLOWS IS NOT A VERY GOOD STRATEGY. Two windows at the
  // largest finite double sum to Infinity, and `Infinity / 2` is still Infinity:
  // a number no gate can be argued against and no chart can draw. It must come
  // back as absence with a reason.
  it("reports absence when the weighted sum overflows, rather than returning Infinity", () => {
    const windows = [
      windowEndingDaysAgo(0, { sharpe: Number.MAX_VALUE }),
      windowEndingDaysAgo(0, { sharpe: Number.MAX_VALUE })
    ]
    const out = weightedMetric(windows, "sharpe", { now: NOW })
    expect(out.value).toBeNull()
    expect(out.value).not.toBe(Infinity)
    expect(out.reason).toBe(WEIGHT_REASONS.AVERAGE_UNFINITE)
  })

  // ---- Across the Task 1 boundary ---------------------------------------
  //
  // Every fixture above is hand-built. This one builds its pile with the real
  // producer, so the SHAPE contract between the two modules is asserted rather
  // than assumed: a change to `collectWindows` that renamed a statistic or turned
  // a measured value into `null` would show up here as a wrong average instead of
  // silently producing an "absence" readout that looks like thin evidence.
  it("weights windows straight out of collectWindows, across all three sources", () => {
    const windows = collectWindows({
      backtests: [
        { strategyTag: "trend", windowStart: "2026-09-20T00:00:00Z", windowEnd: "2026-09-25T00:00:00Z", returnPct: 4 },
        { strategyTag: "trend", windowStart: "2026-08-20T00:00:00Z", windowEnd: "2026-08-25T00:00:00Z", returnPct: 8 }
      ],
      paperCloses: [
        { strategyTag: "trend", pnlPct: 0, entryTime: "2026-09-29T00:00:00Z", exitTime: "2026-09-30T00:00:00Z" }
      ],
      liveFills: [
        // No return at all: this one is dropped, and must not drag the average.
        { strategyTag: "trend", entryTime: "2026-09-29T00:00:00Z", exitTime: "2026-09-30T00:00:00Z" }
      ]
    })
    // The live fill and the paper close share both bounds, so the documented
    // tiebreak (start, then end, then source name) puts "live" first.
    expect(windows.map((w) => w.source)).toEqual(["backtest", "backtest", "live", "paper"])
    const out = weightedMetric(windows, "returnPct", { now: NOW })
    // Ages at NOW (2026-10-01): 6d (w≈0.87), 37d (w≈0.43), 1d (w≈0.98); the live
    // window is dropped for being unmeasured.
    expect(out.windowCount, "the live fill measured nothing and must not be counted").toBe(3)
    expect(out.reasons).toEqual([WEIGHT_REASONS.STAT_UNMEASURED])
    expect(Number.isFinite(out.value)).toBe(true)
    // The paper close measured a genuine 0 return — "flat", not "unmeasured" —
    // so it pulls the average DOWN toward it. That is the assertion that
    // distinguishes the two, which is the whole distinction in this module.
    // Recomputed here from the ages BY HAND rather than by calling `decayWeight`,
    // so the expected value cannot inherit a bug from the function under test.
    const w6 = 0.5 ** (6 / 30)
    const w37 = 0.5 ** (37 / 30)
    const w1 = 0.5 ** (1 / 30)
    expect(out.value).toBeCloseTo((4 * w6 + 8 * w37 + 0 * w1) / (w6 + w37 + w1), 12)
    // Directional reading of the same number: the fresh zero outweighs the stale
    // eight, so the result sits BELOW the plain mean of 4 — which a zero silently
    // dropped would never do.
    expect(out.value, "the fresh measured zero must pull the mean below the plain average").toBeLessThan(4)
    // And it sits well below the 5.31 the two backtests alone would give, which
    // is the same claim stated against the counterfactual.
    expect(out.value).toBeLessThan((4 * w6 + 8 * w37) / (w6 + w37))
  })
})

// The module under the guard above, read as text. This proves a STATIC claim —
// that the weighting layer cannot write, cannot authorize, and reads no store —
// about a module whose whole value is that it stays arithmetic.
describe("the weighting module is advisory-only arithmetic", () => {
  let code = ""

  beforeAll(async () => {
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    code = stripComments(
      readFileSync(fileURLToPath(new URL("../services/graduation/weighting.mjs", import.meta.url)), "utf8")
    )
  })

  it("contains no write, network, permit, ceremony or credential surface", () => {
    for (const banned of [
      "writeFile",
      "appendFile",
      "rmSync",
      "mkdirSync",
      "createWriteStream",
      "fetch(",
      "node:fs",
      "node:http",
      "node:crypto",
      "unlock",
      "ceremony",
      "permit",
      "preauthorize",
      "DATABASE"
    ]) {
      expect(code, `the weighting layer must not reference ${banned}`).not.toContain(banned)
    }
    // It must also import nothing from an evidence service: it weighs what it is
    // handed, and collecting evidence is Task 1's job.
    expect(code).not.toMatch(/from\s+"\.\.\/(trading|technicalBacktest|hyperopt|prediction|costs)/)
    expect(code).not.toMatch(/^\s*import\s/m)
  })

  // THE ENV READ IS THE ONE DELIBERATE EXCEPTION, and this is where it is paid
  // for. `ws7TestStoreIsolation` scans every server module for `process.env`
  // reads that resolve a WRITABLE PATH, and requires each one to be either on a
  // shared contract or reasoned about by name. A half-life in days is a scalar
  // and cannot be such a path — so the read must be the dotted, statically
  // nameable spelling, not a bracketed computed index, which the guard can only
  // record as a name nobody can check.
  //
  // THE PLANTED FIXTURE FURTHER DOWN USES A NON-PICC VARIABLE, and that is a
  // correction this suite needed rather than a stylistic choice: its first version
  // planted a fabricated path-shaped `PICC_` read as a control, and
  // `ws7TestStoreIsolation.test.mjs` failed on it — correctly. That guard scans
  // test files for path-shaped `PICC_` names, and a name no module reads redirects
  // nothing, which is precisely the round-4 defect it exists to catch. The control
  // therefore plants the same class of violation (a path-shaped store read)
  // without minting a fake store name.
  //
  // Requiring EXACTLY ONE read is what stops this from becoming a smuggling
  // route: a second `process.env` line is a finding, not a style note.
  it("reads exactly one environment variable: the scalar half-life, by its dotted name", () => {
    const reads = [...code.matchAll(/process\.env(?:\.[A-Z0-9_]+|\[[^\]]+\])/g)].map((m) => m[0])
    expect(reads, "the weighting layer must read no environment variable but the half-life").toEqual([
      `process.env.${HALFLIFE_DAYS_ENV}`
    ])
    // And nothing path-shaped: a `_DIR`/`_FILE`/`_PATH` suffix would make it a
    // store no test could redirect, which is the shape the guard exists for.
    expect(code).not.toMatch(/process\.env\.[A-Z0-9_]+_(DIR|FILE|PATH)\b/)
  })

  // THE CONTROLS. Without them, "strip comments" and "delete the file" are
  // indistinguishable: a scan that returned nothing would satisfy every assertion
  // above. These plant the violations and require them to be caught.
  it("CONTROL: the scan still bites — planted violations are detected, comments are not", () => {
    const violations = [
      'const d = "file:///tmp/x"\nwriteFileSync(d, "x")',
      "permit === true && unlock()",
      "const DATA = process.env.LOCAL_NOTES_FILE",
      'await fetch("https://example.invalid")'
    ]
    for (const planted of violations) {
      expect(stripComments(planted), `planted violation went undetected: ${planted}`).toContain(
        planted.split("\n").pop().trim().slice(0, 12)
      )
    }
    // ...and the mirror image: a violation named only inside a COMMENT is not
    // code, which is the half that keeps the assertions above honest rather than
    // merely noisy.
    expect(stripComments('// the header says "no writes here"\nconst keep = 1')).not.toContain("no writes here")
  })
})