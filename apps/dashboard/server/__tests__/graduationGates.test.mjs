// Graduation gates — the per-strategy label readout (W3-04, layer 3 of 4).
//
// HERMETIC BY INJECTION. `NOW` is passed to every call, so nothing here reads a
// wall clock and no test sleeps; `windows` are fixtures built below, never a
// store. The half-life is passed explicitly too, so a developer's shell cannot
// change a readout — `weighting.mjs` reads the half-life from the environment and
// this suite must not inherit whatever that happens to hold.
import { beforeAll, describe, expect, it } from "vitest"

import {
  DEMOTE_FRACTION,
  DEMOTE_WINDOWS,
  GATE_REASONS,
  GATE_VERDICTS,
  GATE_WARNINGS,
  PROMOTE_WINDOWS,
  STAGES,
  evaluateStrategy
} from "../services/graduation/gates.mjs"
import { stripComments } from "../scripts/guard-primitives.mjs"

const NOW = Date.parse("2026-10-01T00:00:00Z")
const DAY_MS = 86_400_000
const HALF_LIFE_DAYS = 30
const OPTIONS = { now: NOW, halfLifeDays: HALF_LIFE_DAYS }

const daysBefore = (days) => new Date(NOW - days * DAY_MS).toISOString()

// BARS ARE INJECTED, AND THE FIXTURE STATES WHICH NUMBER IS WHICH. This module
// owns the three window-count constants and nothing else — the platform exports no
// hit-rate or return bar (the sweep recorded at `PROMOTE_WINDOWS` found none), so
// a bar that does not exist is a bar the CALLER supplies or one this layer reports
// `bar-unavailable` for. Inventing one here would let an agent-chosen number argue
// a strategy across a boundary.
const BACKTEST_BAR = 0.55
const PAPER_BAR = 0.5
const BARS = Object.freeze({
  backtest: Object.freeze({ hitRateNet: BACKTEST_BAR }),
  paper: Object.freeze({ returnPct: PAPER_BAR })
})

/**
 * One backtest window, `hitRateNet` UNMEASURED unless a test says otherwise.
 *
 * `hitRateNet` and `decided` are the two fields a walk-forward surface emits:
 * `technicalBacktest.mjs:203` returns `decided: tried` (the sample size) and
 * `:205` returns `hitRateNet` (the cost-adjusted hit rate). That same object
 * carries no `returnPct`, no `sharpe` and no `maxDd`, which is why the nulls below
 * are the honest default: a fixture that forgets to set a statistic is then
 * testing the absence path instead of accidentally arguing a strategy over a bar.
 */
const backtestWindow = (daysAgo, stats = {}) => ({
  source: "backtest",
  strategyTag: "trend",
  windowStart: daysBefore(daysAgo + 10),
  windowEnd: daysBefore(daysAgo),
  returnPct: null,
  sharpe: null,
  maxDd: null,
  costDragUsd: null,
  decided: null,
  hitRateNet: null,
  provenance: "backtest",
  reasons: [],
  ...stats
})

/**
 * `count` windows ending one day apart, the OLDEST ending `oldestDaysAgo` back.
 *
 * Built oldest-FIRST, which is the order `collectWindows` guarantees, because
 * "consecutive" is a predicate against a chronology and a pile handed in newest
 * first would measure the wrong run entirely.
 */
const backtestRun = (count, hitRateNet, oldestDaysAgo = count) =>
  Array.from({ length: count }, (_, i) => backtestWindow(oldestDaysAgo - i, { hitRateNet }))

describe("the published hysteresis numbers", () => {
  // Asserted by VALUE, not merely exported: an exported constant nobody checks is
  // a comment. The design doc records all three as one owner decision (spec
  // section 2, decision 5), so they move together or not at all.
  it("are the three the owner approved", () => {
    expect(PROMOTE_WINDOWS, "promotion takes 12 consecutive above-bar windows").toBe(12)
    expect(DEMOTE_WINDOWS, "demotion takes 6 consecutive sub-70% windows").toBe(6)
    expect(DEMOTE_FRACTION, "demotion fires below 70% of bar").toBe(0.7)
  })
})

describe("evaluateStrategy — the promotion leg", () => {
  // TWELVE, ALL ABOVE. `0.9` clears `BACKTEST_BAR` (0.55) outright rather than
  // sitting on it; the exactly-at-bar boundary is a separate decision and gets
  // its own case further down.
  it("promotes on twelve consecutive above-bar windows and labels it testnet", () => {
    const out = evaluateStrategy({
      tag: "trend",
      windows: backtestRun(12, 0.9),
      bars: BARS,
      options: OPTIONS
    })

    expect(out.stage, "a promoted strategy carries the testnet LABEL").toBe("testnet")
    expect(out.verdict).toBe(GATE_VERDICTS.PROMOTE)
    expect(out.promoted).toBe(true)
    expect(out.demoted, "promotion and demotion are two views of one verdict").toBe(false)
    expect(out.windowsUsed).toBe(12)
    expect(out.reasons, "a clean promotion has no below-floor complaint").not.toContain(
      GATE_REASONS.BELOW_FLOOR
    )
  })

  // ELEVEN IS NOT TWELVE. This is the spec's own honesty rule (section 4, first
  // bullet): "No 12 qualifying windows → no promotion verdict (below-floor state
  // shown)", and "thin-evidence strategies are never extrapolated" is what it
  // defends. Eleven above-bar windows are eleven real windows; extrapolating them
  // to a twelfth is how a nine-window strategy ends up labelled testnet.
  //
  // EVERY FIELD IS ASSERTED, because a below-floor readout that still returned
  // `promoted: true` or `stage: "testnet"` from some other field would be just as
  // wrong as no readout at all.
  it("gives no verdict on eleven qualifying windows, and names the floor", () => {
    const out = evaluateStrategy({
      tag: "trend",
      windows: backtestRun(11, 0.9),
      bars: BARS,
      options: OPTIONS
    })

    expect(out.tag).toBe("trend")
    expect(out.verdict, "thin evidence must never be extrapolated into a verdict").toBe(
      GATE_VERDICTS.NO_VERDICT
    )
    expect(out.promoted).toBe(false)
    expect(out.demoted).toBe(false)
    expect(out.stage, "a thin-evidence strategy stays labelled paper").toBe("paper")
    expect(out.windowsUsed, "eleven qualifying windows is eleven, not twelve").toBe(11)
    expect(out.reasons).toContain(GATE_REASONS.BELOW_FLOOR)
  })

  // DEMOTION IS DECIDED ON THE NEWEST EVIDENCE, NOT THE BEST EVIDENCE, and the
  // pile is built to make the alternative answer wrong: a twelve-window promotion
  // (days 7…18) followed by six sub-70% windows (days 1…6). An implementation that
  // scanned for "was there ever a run of 12?" would report `promote` here and leave
  // a decaying strategy labelled testnet forever.
  //
  // 0.2 is well below 70% of 0.55 (0.385), so this is not a boundary case — the
  // boundaries are their own case, with their own CONTROL, further down.
  it("demotes on six consecutive windows below 70% of bar, overriding the older promotion", () => {
    const out = evaluateStrategy({
      tag: "trend",
      windows: [...backtestRun(12, 0.9, 18), ...backtestRun(6, 0.2, 6)],
      bars: BARS,
      options: OPTIONS
    })

    expect(out.verdict, "the newest six windows decide, not the oldest twelve").toBe(
      GATE_VERDICTS.DEMOTE
    )
    expect(out.demoted).toBe(true)
    expect(out.promoted).toBe(false)
    expect(out.stage, "a demoted strategy falls back to the paper label").toBe("paper")
    expect(out.windowsUsed, "both runs counted as evidence; only the newest decides").toBe(18)
  })
})

describe("the hysteresis band is a real dead zone, not a decorative one", () => {
  const evaluate = (windows, bars = BARS) =>
    evaluateStrategy({ tag: "trend", windows, bars, options: OPTIONS })

  // BOTH BOUNDARIES ARE EXCLUSIVE. The thresholds are computed here with the SAME
  // double arithmetic the module uses (`bar * DEMOTE_FRACTION` rather than a
  // retyped `0.385`), because 0.55 * 0.7 is not exactly 0.385 in IEEE-754 and a
  // retyped literal would make this pass or fail for the wrong reason.
  //
  // The last pile is the CONTROL: without it, "the band does not demote" is
  // indistinguishable from "the demote threshold is unreachable".
  it("breaks both runs on a window exactly on a threshold, and demotes just below", () => {
    const onBar = evaluate([...backtestRun(12, 0.9, 13), backtestWindow(1, { hitRateNet: BACKTEST_BAR })])
    expect(onBar.windowsUsed, "a window exactly on the bar is still EVIDENCE").toBe(13)
    expect(onBar.verdict, "exactly on the bar is not 'above bar'").toBe(GATE_VERDICTS.HOLD)
    expect(onBar.promoted).toBe(false)

    const onSeventy = evaluate([
      ...backtestRun(12, 0.9, 18),
      ...backtestRun(6, BACKTEST_BAR * DEMOTE_FRACTION, 6)
    ])
    expect(onSeventy.windowsUsed).toBe(18)
    expect(onSeventy.verdict, "exactly on 70% of bar is not 'below 70%'").toBe(GATE_VERDICTS.HOLD)
    expect(onSeventy.demoted).toBe(false)

    // THE CONTROL: a hair under the same threshold does demote, so the two
    // assertions above are about a boundary and not about a dead gate.
    const underSeventy = evaluate([
      ...backtestRun(12, 0.9, 18),
      ...backtestRun(6, BACKTEST_BAR * DEMOTE_FRACTION - 1e-9, 6)
    ])
    expect(underSeventy.verdict, "a hair below 70% of bar demotes, so the band is a boundary").toBe(
      GATE_VERDICTS.DEMOTE
    )
  })

  // A NEGATIVE BAR MUST NOT INVERT THE HYSTERESIS. With `bar = -1`, 70% of bar is
  // -0.7, which is GREATER than the bar itself — so a naive `stat > bar` /
  // `stat < bar * 0.7` collapses the dead zone to nothing: every window above the
  // bar would also be "below 70% of it", demotion would quietly become "below
  // bar", and -0.9 would be called a promotion when it sits inside the band.
  //
  // The bar is caller-supplied, so the ordering has to hold for every FINITE bar
  // rather than for the one the fixtures happen to use.
  it("mirrors the band rather than inverting it for a negative bar", () => {
    const negative = Object.freeze({ backtest: Object.freeze({ hitRateNet: -1 }) })

    expect(
      evaluate(backtestRun(12, -0.5), negative).verdict,
      "-0.5 is above the mirrored promote line (-0.7)"
    ).toBe(GATE_VERDICTS.PROMOTE)
    expect(
      evaluate(backtestRun(12, -0.9), negative).verdict,
      "-0.9 sits between -1 and -0.7: in the band, so no verdict either way"
    ).toBe(GATE_VERDICTS.HOLD)
    expect(
      evaluate([...backtestRun(12, -0.5, 18), ...backtestRun(6, -1.5, 6)], negative).verdict,
      "-1.5 is below the mirrored demote line (-1)"
    ).toBe(GATE_VERDICTS.DEMOTE)
  })
})

describe("a window is evidence only if a measured statistic can be argued", () => {
  // A paper close is argued on `returnPct`, the field `windows.mjs:167` reads off
  // the row. It is a DIFFERENT statistic from a backtest window's `hitRateNet`, and
  // each is compared against its OWN source's bar.
  const paperWindow = (daysAgo, stats = {}) => ({
    source: "paper",
    strategyTag: "trend",
    windowStart: daysBefore(daysAgo + 1),
    windowEnd: daysBefore(daysAgo),
    returnPct: null,
    sharpe: null,
    maxDd: null,
    costDragUsd: null,
    provenance: "paper",
    reasons: [],
    ...stats
  })

  it("argues a paper window on returnPct against the paper bar", () => {
    const out = evaluateStrategy({
      tag: "trend",
      windows: backtestRun(12, 0.9),
      bars: BARS,
      options: OPTIONS
    })
    expect(out.stage).toBe("testnet")

    // The same pile with returnPct values ABOVE the paper bar (0.5) also promotes:
    // each source is judged on the statistic it can actually carry.
    const paperOut = evaluateStrategy({
      tag: "trend",
      windows: Array.from({ length: 12 }, (_, i) => paperWindow(12 - i, { returnPct: 0.8 })),
      bars: BARS,
      options: OPTIONS
    })
    expect(paperOut.windowsUsed).toBe(12)
    expect(paperOut.stage, "a paper pile above its own bar promotes too").toBe("testnet")

    // ...and the two statistics are NOT interchangeable: a backtest pile carrying
    // only `returnPct` measures nothing, because a walk-forward surface emits no
    // `returnPct` at all.
    const crossed = evaluateStrategy({
      tag: "trend",
      windows: Array.from({ length: 12 }, (_, i) => backtestWindow(12 - i, { returnPct: 0.9 })),
      bars: BARS,
      options: OPTIONS
    })
    expect(crossed.windowsUsed, "a backtest pile carrying only returnPct measures nothing").toBe(0)
    expect(crossed.stage).toBe("paper")
  })

  // AN UNMEASURED WINDOW IS NOT A QUALIFYING WINDOW. Twelve windows where the
  // statistic was never measured is not twelve windows that missed the bar — it is
  // zero windows, and it must not satisfy the floor. The pile interleaves eleven
  // real above-bar windows with eleven unmeasured ones, so a gate that counted
  // unmeasured windows would see 22 windows and promote on the strength of data
  // that does not exist.
  it("never counts an unmeasured window as qualifying evidence", () => {
    const interleaved = []
    for (let i = 0; i < 11; i += 1) {
      interleaved.push(backtestWindow(22 - i * 2, { hitRateNet: 0.9 }))
      interleaved.push(backtestWindow(21 - i * 2, { hitRateNet: null }))
    }
    const out = evaluateStrategy({ tag: "trend", windows: interleaved, bars: BARS, options: OPTIONS })

    expect(out.windowsUsed, "only the measured windows count").toBe(11)
    expect(out.stage, "unmeasured windows cannot promote a strategy").toBe("paper")
    expect(out.reasons).toContain(GATE_REASONS.BELOW_FLOOR)
  })

  // AND EVERY SKIP IS ACCOUNTED FOR, WITH A COUNT RATHER THAN A LINE PER WINDOW.
  // `reasons` is a small, stable vocabulary; `skipped` is the bounded diagnostic
  // that says how many windows fell out for each named reason. A thousand-window
  // pile that measured nothing must not produce a thousand identical strings.
  it("reports bounded aggregate skip counts, one entry per reason not per window", () => {
    const thousand = Array.from({ length: 1000 }, (_, i) => backtestWindow(1000 - i, { hitRateNet: null }))
    const out = evaluateStrategy({ tag: "trend", windows: thousand, bars: BARS, options: OPTIONS })

    expect(out.windowsUsed).toBe(0)
    expect(out.skipped[GATE_REASONS.STAT_UNMEASURED]).toBe(1000)
    expect(Object.keys(out.skipped).length, "one key per distinct reason, never one per window").toBe(1)
    expect(out.reasons.length, "the reasons array stays a small vocabulary").toBeLessThanOrEqual(3)
  })
})

describe("a gate with no bar says so rather than inventing one", () => {
  // NO BAR MEANS NO VERDICT, and it means it LOUDLY. The platform exports no
  // hit-rate or return bar (the sweep recorded at `PROMOTE_WINDOWS` found none), so
  // every bar here is caller-supplied. If the caller supplies none, this layer's
  // only honest options are to report `bar-unavailable` or to pick a number — and
  // picking one would let an agent-chosen threshold argue a strategy across a
  // boundary. It reports instead.
  const liveWindow = (daysAgo) => ({
    source: "live",
    strategyTag: "trend",
    windowStart: daysBefore(daysAgo + 1),
    windowEnd: daysBefore(daysAgo),
    returnPct: null,
    sharpe: null,
    maxDd: null,
    costDragUsd: null,
    provenance: "live",
    reasons: []
  })

  it("reports bar-unavailable when the caller supplies no bar for the source", () => {
    const out = evaluateStrategy({
      tag: "trend",
      windows: backtestRun(12, 0.9),
      bars: {},
      options: OPTIONS
    })

    expect(out.windowsUsed, "a pile with no bar is not evidence either way").toBe(0)
    expect(out.stage, "nothing is earned without a bar to earn it against").toBe("paper")
    expect(out.reasons).toContain(GATE_REASONS.BAR_UNAVAILABLE)
  })

  // THE LIVE PILE IS THE REAL INSTANCE OF THIS. A live fill carries no gateable
  // statistic at all today, so there is no bar that could make it one. Reporting it
  // as such — rather than silently counting it, or silently dropping it — is what
  // lets a caller see that the live leg contributes nothing yet.
  it("reports bar-unavailable for the live source, which carries nothing gateable", () => {
    const live = Array.from({ length: 5 }, (_, i) => liveWindow(5 - i))
    const out = evaluateStrategy({ tag: "trend", windows: live, bars: BARS, options: OPTIONS })

    expect(out.windowsUsed).toBe(0)
    expect(out.skipped[GATE_REASONS.BAR_UNAVAILABLE]).toBe(5)
    expect(out.reasons).toContain(GATE_REASONS.BAR_UNAVAILABLE)
  })

  // A BAR THAT IS NOT A NUMBER IS NOT A BAR. `NaN`, `Infinity` and a blank string
  // all read as absence rather than being coerced — the empty-string trap
  // `Number("") === 0` would otherwise turn a missing bar into a bar of zero, and a
  // bar of zero is a bar every measured statistic clears.
  it("treats a non-finite or blank bar as no bar at all", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "", "   ", null, undefined]) {
      const out = evaluateStrategy({
        tag: "trend",
        windows: backtestRun(12, 0.9),
        bars: { backtest: { hitRateNet: bad } },
        options: OPTIONS
      })
      expect(out.stage, `a bar of ${String(bad)} must not promote anyone`).toBe("paper")
      expect(out.reasons, `a bar of ${String(bad)} is not a bar`).toContain(
        GATE_REASONS.BAR_UNAVAILABLE
      )
    }
  })
})

describe("the GATE statistic's reader is total: a stat that throws is absence, never a crash", () => {
  // SCOPE, STATED PRECISELY, because the previous title ("a throwing reader is
  // absence, never a crash") claimed more than the fixture tests. `safePick`
  // (`gates.mjs:169`) wraps the STAT read and nothing else, so this describes the
  // stat read only. Two other reads in the path are still UNGUARDED, and are
  // byte-identical to the merge base:
  //
  //   - `GATE_PLANS[window?.source]` (`gates.mjs:380`) — the plan lookup, which
  //     reads `source` through the optional chain but does not catch a throw.
  //   - `window?.windowEnd` (`weighting.mjs:287`) — the recency read, likewise.
  //
  // Both are LATENT AND UNREACHABLE FROM THE ROUTE: a window reaching
  // `evaluateStrategy` is a plain object built by `collectWindows`, so neither
  // getter can throw on the only call path that exists. They are left exactly as
  // they are — widening this fixture's scope to cover them would be a change to
  // the modules' behaviour, not a correction to a test title, and that was not
  // this wave's mandate. What this describe block asserts is the half that IS
  // guarded, and the title now says so.
  //
  // `weightedMetric` does NOT catch a throwing `pick` — it calls the reader and
  // uses the result. A reader that throws therefore turns "this window measured
  // nothing" into "the readout exploded", which is the worst possible failure for a
  // layer whose whole job is to report honestly about incomplete evidence. The
  // fixture below really throws: a getter that throws on access, not a mock that
  // pretends to.
  const throwingWindow = (daysAgo) => ({
    source: "backtest",
    strategyTag: "trend",
    windowStart: daysBefore(daysAgo + 10),
    windowEnd: daysBefore(daysAgo),
    provenance: "backtest",
    reasons: [],
    get hitRateNet() {
      throw new Error("this field blew up")
    }
  })

  it("survives a window whose statistic throws on read", () => {
    const pile = [...backtestRun(12, 0.9, 13), throwingWindow(1)]
    let out = null
    expect(() => {
      out = evaluateStrategy({ tag: "trend", windows: pile, bars: BARS, options: OPTIONS })
    }, "a throwing reader must never propagate out of the gate").not.toThrow()

    expect(out.windowsUsed, "the throwing window contributed nothing").toBe(12)
    expect(out.skipped[GATE_REASONS.STAT_UNMEASURED]).toBe(1)
    expect(out.stage, "a throwing reader breaks the streak rather than extending it").toBe("paper")
  })

  // EVERY FIELD OF `input` IS NULL-SAFE, INCLUDING `options`. `windows: null` and
  // `bars: null` are already guarded, and a destructuring default (`options = {}`)
  // applies to `undefined` ONLY — an explicit `null` sails straight through it into
  // `weightedMetric(pile, pick, null)` and then into `decayWeight(end, null)`, where
  // `options.now` reads a property off `null`. It throws, and it throws AFTER the
  // verdict has already been computed, so a correct answer is computed and thrown
  // away — the worst place for a crash to land.
  it("treats a null options bag as no options at all", () => {
    const pile = backtestRun(12, 0.9)
    let out = null
    expect(() => {
      out = evaluateStrategy({ tag: "trend", windows: pile, bars: BARS, options: null })
    }, "options: null must not throw").not.toThrow()

    expect(out.stage, "a null options bag is the same as omitting it").toBe("testnet")
    expect(out.verdict).toBe(GATE_VERDICTS.PROMOTE)
  })

  // ...AND THE NEIGHBOURS, so the totality of the input contract is pinned rather
  // than half-asserted. A `null` input object is the same story one level up.
  it("survives null in every input field", () => {
    for (const input of [
      { tag: "t", windows: null, bars: null, options: null },
      { tag: "t", windows: undefined, bars: undefined, options: undefined },
      { tag: "t" },
      null
    ]) {
      let out = null
      expect(() => {
        out = evaluateStrategy(input)
      }, `evaluateStrategy(${JSON.stringify(input)}) must not throw`).not.toThrow()
      expect(out.stage).toBe("paper")
      expect(out.windowsUsed).toBe(0)
    }
  })

  // NOTHING IN THE READOUT IS EVER NON-FINITE. A divide-by-zero on an empty
  // weighted set yields `Infinity`, `NaN` or `0` depending on the spelling, and all
  // three are worse than `null`: a renderer draws them, a comparison silently
  // passes, and a downstream average is destroyed by a single poisoned window.
  // This walks the WHOLE object rather than spot-checking fields, so a field added
  // later is covered without editing the test.
  it("emits only finite numbers or null — never Infinity, NaN or a divide-by-zero 0", () => {
    const audit = (value, path = "out") => {
      if (typeof value === "number") {
        expect(Number.isFinite(value), `${path} is ${value}, which is not a real measurement`).toBe(true)
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => audit(item, `${path}[${i}]`))
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) audit(v, `${path}.${k}`)
      }
    }

    // A pile measured against a zero bar — the shape most likely to divide by it —
    // and a pile that ARRIVED but measured nothing, which is the real
    // empty-weighted-set case: the windows are there, the measurement is not.
    const zeroBar = evaluateStrategy({
      tag: "trend",
      windows: backtestRun(12, 0),
      bars: { backtest: { hitRateNet: 0 } },
      options: OPTIONS
    })
    const measuredNothing = evaluateStrategy({
      tag: "trend",
      windows: backtestRun(12, null),
      bars: BARS,
      options: OPTIONS
    })

    audit(zeroBar, "zeroBar")
    audit(measuredNothing, "measuredNothing")

    expect(
      measuredNothing.sources.backtest.weighted.value,
      "the weighted average of twelve unmeasured windows is absence, not 0"
    ).toBeNull()
    expect(
      measuredNothing.sources.backtest.weighted.windowCount,
      "an unmeasured window contributes no weight and no count"
    ).toBe(0)

    // AND THE MEASURED ZERO SURVIVES AS A ZERO, which is the distinction the whole
    // series exists to protect: `0` means "measured, and the measurement was zero".
    expect(zeroBar.sources.backtest.weighted.value, "a measured zero is a measurement").toBe(0)
    expect(zeroBar.windowsUsed, "a measured zero window is still evidence").toBe(12)
    expect(
      zeroBar.sources.backtest.weighted.reasons,
      "the per-window reason pile of the sibling is NOT passed through: it is unbounded"
    ).toBeUndefined()
  })
})

describe("the clock convention is `weighting.mjs`'s, not a third one", () => {
  // OMITTED `now` AND EXPLICIT `now: null` ARE OPPOSITE ANSWERS, and the difference
  // is load-bearing: `weighting.mjs:220` reads an omitted `now` as "measure against
  // the current instant" and an explicit `now: null` as "the caller named an
  // instant and it did not survive". Substituting the machine's clock for a null
  // would move the weights under a test and under a replay. This module forwards
  // `options` verbatim rather than reinterpreting it, so the two layers cannot
  // disagree about what a missing clock means.
  it("treats an omitted now as the wall clock and an explicit null as absence", () => {
    const pile = backtestRun(12, 0.9)

    const omitted = evaluateStrategy({ tag: "trend", windows: pile, bars: BARS, options: { halfLifeDays: HALF_LIFE_DAYS } })
    const explicitNull = evaluateStrategy({
      tag: "trend",
      windows: pile,
      bars: BARS,
      options: { now: null, halfLifeDays: HALF_LIFE_DAYS }
    })

    expect(
      omitted.sources.backtest.weighted.value,
      "an omitted now measures age against the wall clock, so a value exists"
    ).not.toBeNull()
    expect(
      explicitNull.sources.backtest.weighted.value,
      "an explicit null now is absence: no age could be measured, so no average"
    ).toBeNull()
    expect(explicitNull.sources.backtest.weighted.reason).toBe("windows:none-measured")
  })

  // ...AND THE STREAK IS DELIBERATELY UNAFFECTED. The run asks "was a statistic
  // measured and did it clear the bar", which no clock can change. Coupling the two
  // would let an unreadable `now` silently demote a strategy on evidence that did
  // exist — the mirror image of the bug this discipline exists to prevent.
  it("leaves the streak verdict untouched by an unreadable now", () => {
    const pile = backtestRun(12, 0.9)
    const withNow = evaluateStrategy({ tag: "trend", windows: pile, bars: BARS, options: OPTIONS })
    const withNull = evaluateStrategy({
      tag: "trend",
      windows: pile,
      bars: BARS,
      options: { now: null, halfLifeDays: HALF_LIFE_DAYS }
    })

    expect(withNull.verdict).toBe(withNow.verdict)
    expect(withNull.stage).toBe(withNow.stage)
    expect(withNull.windowsUsed, "an unreadable clock does not un-measure a window").toBe(
      withNow.windowsUsed
    )
  })
})

describe("the testnet and mainnet legs read ABSENT, and say which precondition is missing", () => {
  // AN UNMET PRECONDITION IS REPORTED, NOT ASSUMED. The spec (section 2, decision 3)
  // records the testnet leg as blocked until testnet credentials land — "Phase B
  // blocked, expected, not a defect" — and section 3 requires this layer to read
  // both legs ABSENT with reasons while the credentials and the ceremony are missing.
  // Silently omitting them would leave a reader to assume a promoted strategy is
  // one keystroke from a live venue.
  const promoted = () =>
    evaluateStrategy({ tag: "trend", windows: backtestRun(12, 0.9), bars: BARS, options: OPTIONS })

  it("names the missing testnet credentials on a strategy that earned the label", () => {
    const out = promoted()
    expect(out.stage).toBe("testnet")
    expect(out.reasons).toContain(GATE_REASONS.TESTNET_CREDENTIALS_UNSET)
  })

  // MAINNET IS A CEILING, NOT A STAGE ANY INPUT REACHES. No evidence, however
  // strong, may label a strategy `mainnet` here — that is a ceremony, performed by
  // hand (spec section 5 lists permit flips and ceremony unlocks as non-goals). The
  // reason is therefore present on EVERY readout, including a clean promotion, so
  // no caller can ever read "no complaints" and infer mainnet is next.
  it("always names the ceremony as the thing mainnet would require", () => {
    for (const out of [promoted(), evaluateStrategy({ tag: "thin", windows: backtestRun(3, 0.9), bars: BARS, options: OPTIONS })]) {
      expect(out.reasons).toContain(GATE_REASONS.MAINNET_CEREMONY_REQUIRED)
      expect(out.stage, "no input reaches mainnet through this layer").not.toBe("mainnet")
    }
  })

  // `stage` IS A LABEL AND ONLY A LABEL. Every readout names one of exactly three
  // labels — never a fourth spelling, never undefined, never an empty string.
  it("always labels with one of the three published stages", () => {
    const cases = [
      promoted(),
      evaluateStrategy({ tag: "thin", windows: backtestRun(3, 0.9), bars: BARS, options: OPTIONS }),
      evaluateStrategy({ tag: "none", windows: [], bars: BARS, options: OPTIONS }),
      evaluateStrategy({ tag: "nobar", windows: backtestRun(12, 0.9), bars: {}, options: OPTIONS })
    ]
    for (const out of cases) {
      expect(STAGES).toContain(out.stage)
    }
  })
})

describe("demotion warns on the same math that promotes, and no sooner", () => {
  // THE SPEC'S THIRD HONESTY RULE: "Demotion warnings fire on the same math as
  // promotions (no asymmetric courage)". The corollary is that a warning must not
  // fire EARLIER than the verdict does — a readout that shouts "decaying" after two
  // bad windows, while the verdict still says hold, has invented a courage the gate
  // does not have and will train a reader to ignore it.
  const bandRun = (count, hitRateNet) => backtestRun(count, hitRateNet)

  it("warns of demotion exactly when the demotion verdict fires", () => {
    const five = evaluateStrategy({
      tag: "trend",
      windows: [...backtestRun(12, 0.9, 18), ...bandRun(5, 0.2, 5)],
      bars: BARS,
      options: OPTIONS
    })
    expect(five.verdict, "five sub-70% windows do not yet demote").toBe(GATE_VERDICTS.HOLD)
    expect(five.demoted).toBe(false)
    expect(five.warnings, "no demotion warning before the demotion verdict").not.toContain(
      GATE_WARNINGS.DEMOTION
    )

    const six = evaluateStrategy({
      tag: "trend",
      windows: [...backtestRun(12, 0.9, 18), ...bandRun(6, 0.2, 6)],
      bars: BARS,
      options: OPTIONS
    })
    expect(six.demoted).toBe(true)
    expect(six.warnings, "the sixth window both demotes and warns").toContain(GATE_WARNINGS.DEMOTION)
  })

  // THE BAND IS ITS OWN WARNING, and it is scoped to strategies that have cleared
  // the floor. Inside the band a strategy is decaying — evidence is neither above
  // the bar nor badly below it — but not yet demoted, and that is precisely the
  // state a paper-room table exists to surface ("which are decaying"). On a
  // below-floor pile it would be noise: with three windows you cannot tell decay
  // from a strategy that simply has not run yet.
  it("warns about the hysteresis band only once the floor is cleared", () => {
    const thin = evaluateStrategy({
      tag: "trend",
      windows: backtestRun(11, BACKTEST_BAR),
      bars: BARS,
      options: OPTIONS
    })
    expect(thin.verdict).toBe(GATE_VERDICTS.NO_VERDICT)
    expect(thin.warnings, "too little evidence to read decay into it").not.toContain(
      GATE_WARNINGS.IN_HYSTERESIS_BAND
    )

    const decaying = evaluateStrategy({
      tag: "trend",
      windows: backtestRun(12, BACKTEST_BAR * DEMOTE_FRACTION),
      bars: BARS,
      options: OPTIONS
    })
    expect(decaying.verdict, "inside the band is hold, not demote").toBe(GATE_VERDICTS.HOLD)
    expect(decaying.warnings).toContain(GATE_WARNINGS.IN_HYSTERESIS_BAND)
  })

  // A CLEAN PROMOTION SAYS NOTHING BEYOND THE LEG REASONS. The warnings channel is
  // for decay, and a readout that emits warnings on a healthy strategy is the same
  // asymmetry the spec forbids, pointed the other way.
  it("is silent on a clean promotion", () => {
    const out = evaluateStrategy({ tag: "trend", windows: backtestRun(12, 0.9), bars: BARS, options: OPTIONS })
    expect(out.promoted).toBe(true)
    expect(out.warnings).toEqual([])
  })
})

describe("an ungateable source is excluded from the streak, never a veto on it", () => {
  // THE SHAPE `collectWindows` ACTUALLY EMITS. Task 1 merges backtest, paper and
  // live into ONE chronological sort (`windows.mjs:273-279`), so a pile reaches
  // this layer already interleaved. The existing `bar-unavailable` tests use a
  // pure-backtest pile and the live test uses a pure-live pile — neither is
  // interleaved, which is exactly why the bug survived them.
  const liveFill = (daysAgo) => ({
    source: "live",
    strategyTag: "trend",
    windowStart: daysBefore(daysAgo + 1),
    windowEnd: daysBefore(daysAgo),
    returnPct: null,
    sharpe: null,
    maxDd: null,
    costDragUsd: null,
    provenance: "live",
    reasons: []
  })

  // CONTRIBUTING NOTHING MEANS EXCLUDED, NOT VETOING. `live` has no gateable
  // statistic and no plan, so every live window is absent from the argument in both
  // directions — it is neither evidence for promotion nor a failure that should
  // interrupt a run. A strategy that also trades live must therefore reach the same
  // verdict as one with no live history at all.
  it("still promotes when an ungateable source is interleaved with a usable one", () => {
    const interleaved = []
    for (let i = 0; i < 12; i += 1) {
      interleaved.push(backtestWindow(23 - i * 2, { hitRateNet: 0.9 }))
      interleaved.push(liveFill(22 - i * 2))
    }

    const withLive = evaluateStrategy({ tag: "trend", windows: interleaved, bars: BARS, options: OPTIONS })
    const backtestOnly = evaluateStrategy({
      tag: "trend",
      windows: Array.from({ length: 12 }, (_, i) => backtestWindow(23 - i * 2, { hitRateNet: 0.9 })),
      bars: BARS,
      options: OPTIONS
    })

    expect(backtestOnly.verdict).toBe(GATE_VERDICTS.PROMOTE)
    expect(
      withLive.verdict,
      "a live fill is not a backtest failure and must not break a backtest streak"
    ).toBe(backtestOnly.verdict)
    expect(withLive.stage).toBe(backtestOnly.stage)
    expect(withLive.windowsUsed, "the live windows contribute nothing, in either direction").toBe(12)
  })

  // ...AND THE VETO IS NOT WEAKENED FOR A GENUINE MEASUREMENT FAILURE. A window
  // whose SOURCE can be gated but whose statistic was not measured is a real
  // failure to produce evidence, and it still breaks the streak. If this were also
  // excluded, a pile of unmeasured backtest windows would silently stop mattering.
  it("still breaks the streak when a gateable source fails to measure", () => {
    const interleaved = []
    for (let i = 0; i < 12; i += 1) {
      interleaved.push(backtestWindow(23 - i * 2, { hitRateNet: 0.9 }))
      interleaved.push(backtestWindow(22 - i * 2, { hitRateNet: null }))
    }

    const out = evaluateStrategy({ tag: "trend", windows: interleaved, bars: BARS, options: OPTIONS })
    expect(out.stage, "an unmeasured gateable window is a failure, and it breaks the run").toBe("paper")
    expect(out.skipped[GATE_REASONS.STAT_UNMEASURED]).toBe(12)
  })
})

describe("the two evidence counts answer different questions and say so", () => {
  // THERE ARE TWO COUNTS AND THEY ARE BOTH TRUE, which is why neither may be
  // collapsed. They differ on exactly one input:
  //
  //   `windowsUsed` (top level)  — windows that count as EVIDENCE FOR THE STREAK:
  //                                 a measured statistic AND a bar to compare it to.
  //   `windowsMeasured` (per source) — windows that produced a WEIGHTED READING:
  //                                 a measured statistic AND a computable recency
  //                                 weight. No bar is consulted at all, because
  //                                 weighting answers a different question.
  //
  // The old name for the second was `windowsQualifying`, which made them read as the
  // same number and produced a Task 4 table saying "12 measured / 0 used" on one row
  // without explaining itself. The rename is the fix; the data is not.
  it("names the per-source count `windowsMeasured`, and never `windowsQualifying`", () => {
    const out = evaluateStrategy({ tag: "trend", windows: backtestRun(12, 0.9), bars: BARS, options: OPTIONS })
    expect(out.sources.backtest).toHaveProperty("windowsMeasured")
    expect(
      out.sources.backtest,
      "a name that says 'qualifying' for the weighted count reintroduces the ambiguity"
    ).not.toHaveProperty("windowsQualifying")
  })

  // THE NO-BAR CASE IS WHERE THEY DIVERGE MOST, so it is the one to pin: a pile of
  // twelve well-measured windows with no bar available measures everything and
  // qualifies for nothing.
  it("pins the relationship between the two counts when no bar exists", () => {
    const pile = backtestRun(12, 0.9)
    const out = evaluateStrategy({ tag: "trend", windows: pile, bars: {}, options: OPTIONS })
    const source = out.sources.backtest

    expect(out.windowsUsed, "no bar means no window is evidence for the streak").toBe(0)
    expect(source.windowsMeasured, "but every window was still measured").toBe(12)
    expect(source.bar, "and the reason there is no bar is visible on the row itself").toBeNull()
    expect(source.weighted.value, "a weighted reading needs no bar to be computed").not.toBeNull()
    expect(out.reasons).toContain(GATE_REASONS.BAR_UNAVAILABLE)
  })

  // ...AND THE MIRROR: an unreadable clock suppresses the weighted reading without
  // touching the streak, because the two counts fail on different inputs.
  it("pins the relationship when the clock cannot be read", () => {
    const pile = backtestRun(12, 0.9)
    const out = evaluateStrategy({
      tag: "trend",
      windows: pile,
      bars: BARS,
      options: { now: null, halfLifeDays: HALF_LIFE_DAYS }
    })

    expect(out.windowsUsed, "an unreadable clock does not un-measure a statistic").toBe(12)
    expect(out.sources.backtest.windowsMeasured, "but it does prevent a weighted reading").toBe(0)
    expect(out.sources.backtest.weighted.value).toBeNull()
  })
})

describe("sources share ONE streak, each judged against its OWN bar", () => {
  // THE ENDORSED SEMANTICS, PINNED. "Promote on 12 consecutive windows above bar"
  // (spec section 2, decision 5) with a PER-SOURCE bar means one counter across the
  // merged chronology, with each window compared against the bar for its own source.
  // So six above-bar backtest windows plus six above-bar paper windows is twelve
  // consecutive above-bar windows — twelve windows, not six, and not twelve of the
  // same kind. This is the reading the controller endorsed; it is pinned here so the
  // next reader does not have to rediscover whether it was deliberate.
  const paperClose = (daysAgo, returnPct) => ({
    source: "paper",
    strategyTag: "trend",
    windowStart: daysBefore(daysAgo + 1),
    windowEnd: daysBefore(daysAgo),
    returnPct,
    sharpe: null,
    maxDd: null,
    costDragUsd: null,
    provenance: "paper",
    reasons: []
  })

  it("counts six backtest plus six paper above their own bars as twelve", () => {
    const interleaved = []
    for (let i = 0; i < 6; i += 1) {
      interleaved.push(backtestWindow(11 - i * 2, { hitRateNet: 0.9 }))
      interleaved.push(paperClose(10 - i * 2, 0.8))
    }

    const out = evaluateStrategy({ tag: "trend", windows: interleaved, bars: BARS, options: OPTIONS })
    expect(out.windowsUsed).toBe(12)
    expect(out.verdict, "twelve windows above their own bars, shared counter").toBe(
      GATE_VERDICTS.PROMOTE
    )
  })

  // ...AND THE COUNT IS TWELVE, NOT SIXTEEN: each window is judged once, against its
  // own bar. A paper window at 0.8 clears the PAPER bar of 0.5, not the backtest
  // bar of 0.55, and neither window is counted twice because two bars exist.
  it("judges each window against its own source's bar, never both", () => {
    // 0.52 clears the paper bar (0.5) but not the backtest bar (0.55). As a PAPER
    // window it is above-bar evidence; the same number on a backtest window would
    // not be. Six of each is still twelve — the arithmetic is per window, not per bar.
    const interleaved = []
    for (let i = 0; i < 6; i += 1) {
      interleaved.push(backtestWindow(11 - i * 2, { hitRateNet: 0.56 }))
      interleaved.push(paperClose(10 - i * 2, 0.52))
    }
    const out = evaluateStrategy({ tag: "trend", windows: interleaved, bars: BARS, options: OPTIONS })
    expect(out.verdict).toBe(GATE_VERDICTS.PROMOTE)
    expect(out.windowsUsed, "twelve windows, counted once each").toBe(12)
  })

  // THE SHARED COUNTER DOES NOT BLIND THE GATE TO A SOURCE GOING BAD. A paper
  // window below its own demote line breaks the shared run even though the
  // backtest windows around it are fine, so a decaying source cannot be masked by
  // a healthy one.
  it("is not blinded when one source falls below its own demote line", () => {
    const interleaved = []
    for (let i = 0; i < 6; i += 1) {
      interleaved.push(backtestWindow(11 - i * 2, { hitRateNet: 0.9 }))
      interleaved.push(paperClose(10 - i * 2, 0.1))
    }
    const out = evaluateStrategy({ tag: "trend", windows: interleaved, bars: BARS, options: OPTIONS })
    expect(out.verdict, "a paper window below its demote line breaks the shared run").toBe(
      GATE_VERDICTS.HOLD
    )
    expect(out.promoted).toBe(false)
  })
})

describe("the per-source evidence row is never blank where the readout is not", () => {
  const liveFill = (daysAgo) => ({
    source: "live",
    strategyTag: "trend",
    windowStart: daysBefore(daysAgo + 1),
    windowEnd: daysBefore(daysAgo),
    returnPct: null,
    provenance: "live",
    reasons: []
  })

  // A PER-SOURCE RENDERER READS THE ROW, NOT THE TOP-LEVEL LIST. `live` has no plan
  // and no gateable statistic, so its weighted summary is null — but leaving
  // `weighted.reason` null handed a renderer a blank reason cell on the one row
  // whose whole message is "this source is absent", while the same fact sat
  // unrendered in the top-level `reasons` array.
  it("names bar-unavailable on the live row itself", () => {
    const out = evaluateStrategy({
      tag: "trend",
      windows: [liveFill(1), liveFill(2)],
      bars: BARS,
      options: OPTIONS
    })

    expect(out.reasons).toContain(GATE_REASONS.BAR_UNAVAILABLE)
    expect(
      out.sources.live.weighted.reason,
      "the row a renderer reads must carry the same reason the readout does"
    ).toBe(GATE_REASONS.BAR_UNAVAILABLE)
    expect(out.sources.live.weighted.value, "and still no reading").toBeNull()
  })

  // THE ARITHMETIC CLOSES. `windowsUsed + Σskipped` is every window in the pile, so
  // `ΣwindowsSeen` across the source rows has to be every window too. A window whose
  // `source` is not a usable string was counted by the main loop but silently dropped
  // by the summary, so the two sides disagreed by exactly the number of malformed
  // windows — and a reader auditing the evidence could not reconcile the columns.
  it("makes windowsUsed plus every skip equal the sum of windowsSeen", () => {
    const pile = [
      ...backtestRun(12, 0.9),
      { ...backtestWindow(1, { hitRateNet: 0.9 }), source: 42 },
      { ...backtestWindow(1, { hitRateNet: 0.9 }), source: "" }
    ]
    const out = evaluateStrategy({ tag: "trend", windows: pile, bars: BARS, options: OPTIONS })

    const skips = Object.values(out.skipped).reduce((a, n) => a + n, 0)
    const seen = Object.values(out.sources).reduce((a, s) => a + s.windowsSeen, 0)

    expect(out.windowsUsed).toBe(12)
    expect(skips, "both unusable-source windows are accounted for").toBe(2)
    expect(seen, "and both are visible in the per-source evidence").toBe(14)
    expect(
      out.windowsUsed + skips,
      "the top-level counts must exhaust the pile the per-source rows enumerate"
    ).toBe(seen)
  })
})

// THE WHOLE POINT OF THIS FILE. The brief requires the test that asserts the
// absence of permit/unlock/mutation fields, and the honest way to assert absence is
// REAL PROPERTY ACCESS on the returned object — not a regular expression over the
// source, which would pass just as happily against a comment promising never to
// flip a permit.
describe("the readout is advisory: it carries no authorization surface", () => {
  const READOUTS = [
    ["a clean promotion", evaluateStrategy({ tag: "trend", windows: backtestRun(12, 0.9), bars: BARS, options: OPTIONS })],
    ["a demotion", evaluateStrategy({ tag: "trend", windows: [...backtestRun(12, 0.9, 18), ...backtestRun(6, 0.2, 6)], bars: BARS, options: OPTIONS })],
    ["a below-floor pile", evaluateStrategy({ tag: "trend", windows: backtestRun(3, 0.9), bars: BARS, options: OPTIONS })],
    ["a pile with no bar", evaluateStrategy({ tag: "trend", windows: backtestRun(12, 0.9), bars: {}, options: OPTIONS })],
    ["an empty pile", evaluateStrategy({ tag: "trend", windows: [], bars: BARS, options: OPTIONS })]
  ]

  it("exposes no permit, unlock, mutation, credential or ceremony field", () => {
    for (const [name, out] of READOUTS) {
      for (const banned of ["permit", "unlock", "flip", "authorize", "promote", "credential", "ceremony", "mutation"]) {
        expect(banned in out, `${name} readout must not carry a "${banned}" field`).toBe(false)
        expect(banned in Object(out), `${name} readout must not inherit "${banned}" from its prototype`).toBe(false)
      }
      // And the same assertion over the whole surface, nested included, because a
      // `sources.backtest.permit` would authorize exactly as much as a top-level one.
      const keys = []
      const walk = (value) => {
        if (Array.isArray(value)) return value.forEach(walk)
        if (value && typeof value === "object") {
          for (const [k, v] of Object.entries(value)) {
            keys.push(k)
            walk(v)
          }
        }
      }
      walk(out)
      for (const key of keys) {
        expect(key, `"${key}" reads like an authorization surface`).not.toMatch(
          /^(permit|unlock|flip|authorize|credential|ceremony|mutation|canPromote|canUnlock)/i
        )
      }
    }
  })

  // THE LABEL IS THE ONLY THING THIS LAYER DECIDES. `promoted` and `demoted` are
  // REPORTED FACTS about the evidence, so they are kept — they are two views of the
  // one `verdict`. What must not exist is anything that would let a caller treat one
  // of those booleans as a decision it may act on, which is why the output is a plain
  // frozen-by-convention record and not a handle on any state.
  it("reports promoted/demoted as facts about one verdict, and nothing else", () => {
    for (const [name, out] of READOUTS) {
      expect(typeof out.promoted, `${name}: promoted is a reported fact`).toBe("boolean")
      expect(typeof out.demoted, `${name}: demoted is a reported fact`).toBe("boolean")
      expect(out.promoted && out.demoted, `${name}: one verdict cannot be both`).toBe(false)
      expect(Object.keys(out).sort(), `${name}: the readout shape is exactly what is documented`).toEqual(
        ["demoted", "promoted", "reasons", "skipped", "sources", "stage", "tag", "verdict", "warnings", "windowsUsed"]
      )
    }
  })
})

// The same claim about the SOURCE, read as text. A static scan proves a property a
// dynamic one cannot: that there is no unreachable code path performing a write or
// reaching for a venue, even one this suite's fixtures never exercise.
describe("the gates module cannot write, reach the network, or read the environment", () => {
  let code = ""

  beforeAll(async () => {
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    code = stripComments(
      readFileSync(fileURLToPath(new URL("../services/graduation/gates.mjs", import.meta.url)), "utf8")
    )
  })

  it("contains no write, network or store surface", () => {
    for (const banned of [
      "writeFile",
      "appendFile",
      "rmSync",
      "mkdirSync",
      "createWriteStream",
      "fetch(",
      "node:fs",
      "node:http",
      "node:https",
      "node:crypto",
      "DATABASE",
      "setTimeout",
      "sleep"
    ]) {
      expect(code, `the gates layer must not reference ${banned}`).not.toContain(banned)
    }
    // NO ENVIRONMENT READ OF ITS OWN. The half-life override belongs to
    // `weighting.mjs` and is reached by forwarding `options`; a second reader here
    // would be a configuration this layer cannot be tested against.
    expect(code).not.toMatch(/process\.env/)
  })

  // `ceremony` and `credential` are NOT on the ban list, and the reason matters:
  // this layer is REQUIRED to name them. `mainnet-ceremony-required` and
  // `testnet-credentials-unset` are the spec's own absent-leg reasons, and a readout
  // that reported the upper legs as present, or that could not name the missing
  // precondition, would be the dishonest one. What is banned is REACHING them —
  // importing or calling — not naming them in a diagnostic string.
  it("names the ceremony and the credentials in strings, but imports neither", () => {
    expect(code).toContain(GATE_REASONS.MAINNET_CEREMONY_REQUIRED)
    expect(code).toContain(GATE_REASONS.TESTNET_CREDENTIALS_UNSET)

    // It imports exactly one module — its own layer sibling — and no evidence or
    // authorization service. `weightedMetric` is the single owner of recency; the
    // backtest/paper/live collectors are upstream of the windows it is handed.
    const specifiers = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    expect(specifiers).toEqual(["./weighting.mjs"])
    expect(code).not.toMatch(/from\s+"\.\.\/(trading|technicalBacktest|hyperopt|prediction|costs|commandCentre)/)
  })

  // THE CONTROLS. Without them, "strip comments" and "delete the file" are
  // indistinguishable — a scan returning nothing would satisfy every assertion above.
  it("CONTROL: the scan still bites — planted violations are caught, comments are not", () => {
    for (const planted of [
      'writeFileSync("/tmp/x", "x")',
      'await fetch("https://example.invalid")',
      "permit === true && unlock()"
    ]) {
      expect(stripComments(planted), `planted violation went undetected: ${planted}`).toContain(
        planted.split(" ").slice(0, 2).join(" ")
      )
    }
    expect(stripComments('// this module never flips a permit\nconst keep = 1')).not.toContain(
      "flips a permit"
    )
  })
})