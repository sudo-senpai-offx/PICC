// Graduation analytics — gates engine (W3-04, layer 3 of 4).
//
// WHAT THIS IS. The layer that decides what LABEL a strategy tag may carry
// (`paper`, `testnet`, `mainnet`) from the windows Task 1 collected and Task 2
// weighed. It is a readout and nothing else: the word "may" carries the whole
// claim. Nothing here reads a permit, flips one, unlocks a venue class, or
// touches the ceremony path a real graduation goes through by hand.
//
// ADVISORY ONLY. No permit flip, no unlock, no ceremony gate, no credential read,
// no store, no filesystem, no network, no environment read of its own, and no
// import of any backtest/paper/live service. A returned label authorizes nothing.

/**
 * Consecutive above-bar windows that earn a `testnet` label.
 *
 * SPEC SOURCE: `docs/superpowers/specs/2026-10-08-graduation-analytics-design.md`
 * section 2, owner decision 5 — "promote on 12 consecutive windows above bar" —
 * and section 3, which names the same 12 for `gates.mjs`.
 *
 * IT IS OWNED HERE, NOT IMPORTED, and that is a checked fact rather than a
 * preference. The brief asks for the constitution floors to be imported as a
 * single source of truth, so that was looked for first. From `apps/dashboard`:
 *
 *   Select-String -Path (Get-ChildItem -Recurse -Path server -Include *.mjs -File) `
 *     -Pattern '^export const \w*(BAR|FLOOR|GATE|THRESHOLD|TOLERANCE|EMBARGO|MIN_|MINIMUM)\w* ='
 *
 * returns 45 lines, 3 of which are this file's own `GATE_REASONS`, `GATE_VERDICTS`
 * and `GATE_WARNINGS` — leaving 42, and none of the 42 is a graduation bar. The
 * two nearest names are a SAMPLE floor, `constitution.mjs:17`
 * `REQ_CON_2_DEPLOYABLE_FLOOR = 300`, and a payout floor,
 * `commandCentre/ceremonyGates.mjs:15` `BINARY_PAYOUT_FLOOR_PCT = 85`. Neither is a
 * number a window's statistic is compared against: neither names a window, a bar,
 * or a stage. So these three numbers are cited to their spec rather than copied out
 * of a sibling's internals, which is what "single source of truth" has to mean when
 * the truth has exactly one home.
 */
export const PROMOTE_WINDOWS = 12

/**
 * Consecutive sub-`DEMOTE_FRACTION` windows that strip a label back.
 *
 * SPEC SOURCE: the same decision 5 — "demote on 6 windows below 70% of bar
 * (anti-whipsaw)". The count is 6, and the ASYMMETRY against `PROMOTE_WINDOWS` is
 * the design: twice the evidence is required to advance as to retreat, so two
 * windows of noise cannot whip a strategy across a boundary.
 */
export const DEMOTE_WINDOWS = 6

/**
 * The fraction of bar below which a window counts toward demotion.
 *
 * SPEC SOURCE: the same decision 5, the "70%" of "below 70% of bar". A window
 * strictly between `DEMOTE_FRACTION * bar` and `bar` is in the HYSTERESIS BAND:
 * it neither promotes nor demotes, and it breaks both runs. That dead zone is
 * what the anti-whipsaw decision asks for — a strategy oscillating inside it
 * earns no verdict in either direction.
 */
export const DEMOTE_FRACTION = 0.7

/**
 * The three labels a strategy may carry, and nothing else.
 *
 * A LABEL vocabulary, not a ladder this module climbs. `mainnet` is here because
 * the readout must be able to NAME the ceiling it cannot reach, not because any
 * input produces it.
 */
export const STAGES = Object.freeze(["paper", "testnet", "mainnet"])

// The terminal verdicts. ONE field carries the decision, rather than a caller
// reconstructing it out of `promoted`/`demoted` — which are two views of the same
// verdict and could otherwise disagree.
export const GATE_VERDICTS = Object.freeze({
  NO_VERDICT: "no-verdict",
  HOLD: "hold",
  PROMOTE: "promote",
  DEMOTE: "demote"
})

// Reason vocabulary. Stable strings, not free text, the same contract
// `windows.mjs` and `weighting.mjs` each set for themselves.
export const GATE_REASONS = Object.freeze({
  BELOW_FLOOR: "below-floor",
  BAR_UNAVAILABLE: "bar-unavailable",
  STAT_UNMEASURED: "stat-unmeasured",
  TESTNET_CREDENTIALS_UNSET: "testnet-credentials-unset",
  MAINNET_CEREMONY_REQUIRED: "mainnet-ceremony-required"
})

// The warning vocabulary — distinct from reasons, because a WARNING is something a
// reader should act on rather than something wrong with the evidence.
export const GATE_WARNINGS = Object.freeze({
  DEMOTION: "demotion:run-below-threshold",
  IN_HYSTERESIS_BAND: "decay:inside-hysteresis-band"
})

/**
 * Which statistic each source's evidence can ACTUALLY be argued from.
 *
 * This is the seam that matters, and it is not the one the original brief
 * assumed. Measured against the real producers:
 *
 *   - a walk-forward surface emits `decided` (sample size) and `hitRateNet` (the
 *     COST-ADJUSTED hit rate) — `technicalBacktest.mjs:203` and `:205`. It carries
 *     no `returnPct`, no `sharpe` and no `maxDd` of its own.
 *   - a paper close carries `returnPct`, which is the field `windows.mjs:167`
 *     reads (`row.returnPct ?? row.pnlPct`).
 *
 * So a backtest window is argued on `hitRateNet` and a paper window on
 * `returnPct`. Gating a backtest window on `sharpe` would be gating on a field
 * the producer never populates: every such window would read as unmeasured and no
 * backtest strategy could ever be argued about. A gate that cannot fire is not a
 * conservative gate, it is a broken one.
 */
const GATE_PLANS = Object.freeze({
  backtest: Object.freeze({ source: "backtest", stat: "hitRateNet" }),
  paper: Object.freeze({ source: "paper", stat: "returnPct" })
})

/**
 * A genuinely measured number, or null. Absence is never coerced to a zero.
 *
 * A private copy rather than an import, for the reason `weighting.mjs:143` gives
 * for its own `instantOf`: the sibling keeps its parser private and there is no
 * reason to widen it. The empty string is ABSENCE rather than a written-down
 * zero, which is the defect both siblings had to fix separately — `Number("")` is
 * `0`, and a measured `0` here would be a window counted BELOW the demote line on
 * the strength of a blank CSV column.
 */
function finiteOrNull(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Read one field off a window, or null. NEVER THROWS.
 *
 * This exists because a plain `w?.[stat]` is not total. A window can arrive with a
 * getter that throws — a lazily-built object, a proxy, a field backed by a failing
 * parse — and `weightedMetric` does not catch a throwing reader: it calls the pick
 * and uses whatever comes back. So a reader that throws turns "this window measured
 * nothing" into "the whole readout exploded", which is the worst available outcome
 * for a layer whose entire job is to report honestly about incomplete evidence.
 * Absence is the only honest reading of a field that cannot be read, so that is what
 * it returns.
 */
function readStat(window, stat) {
  try {
    return window?.[stat]
  } catch {
    return null
  }
}

/**
 * The `pick` handed to `weightedMetric`, wrapped so the sibling's reader is total.
 *
 * `weightedMetric` compiles a function pick to `(w) => finiteOrNull(pick(w))` — the
 * `finiteOrNull` half is the sibling's, and it does not guard against a throw, so
 * the guard has to live here. Every pick this module hands out is built by this
 * function, so there is no code path that can hand `weightedMetric` a reader that
 * throws.
 */
function safePick(stat) {
  return (window) => readStat(window, stat)
}

/**
 * The bar for one source, or null when there is none to argue against.
 *
 * A bar is a number the platform does not export (see `PROMOTE_WINDOWS` above),
 * so the caller supplies it per source, keyed by the very statistic it is compared
 * against: `bars.backtest.hitRateNet`. Anything that is not a finite number —
 * absent, a string, `NaN`, `Infinity` — reads as NO BAR, and the gate says so
 * rather than inventing one.
 */
function barFor(bars, plan) {
  if (!plan) return null
  return finiteOrNull(bars?.[plan.source]?.[plan.stat])
}

import { weightedMetric } from "./weighting.mjs"

/**
 * How many windows of one source arrived, with the bar they are argued against and
 * the recency-weighted evidence they carry.
 *
 * `weighting.mjs` is the single owner of "how much does a stale window count", so
 * this layer asks it rather than re-deriving a weight. Its `options` are forwarded
 * VERBATIM, which is what makes the clock convention one convention rather than
 * two: `weighting.mjs:220` reads an OMITTED `now` as the wall clock and an
 * explicit `now: null` as absence, and because the same object arrives here
 * unaltered, a caller that passes `now: null` gets identical treatment at both
 * layers. A third convention — treating null as "now" here — is the one thing this
 * forwarding rules out.
 *
 * @param {Array} windows Task 1 windows
 * @param {string} [options.now] forwarded to `decayWeight`. Omitted means the wall
 *   clock; an explicit `now: null` means absence, and the weighted summary then
 *   reports `no-measured-windows` for every source rather than substituting the
 *   machine's clock. The STREAK is deliberately not affected: it asks "was a
 *   statistic measured", which no clock can change, and coupling the two would make
 *   an unreadable `now` silently demote a strategy on evidence that did exist.
 * @param {object} [options.halfLifeDays] forwarded unchanged
 */
function summariseSources(windows, bars, options) {
  const bySource = new Map()
  for (const window of windows) {
    const source = window?.source
    if (typeof source !== "string" || source === "") continue
    if (!bySource.has(source)) bySource.set(source, [])
    bySource.get(source).push(window)
  }

  const sources = {}
  for (const [source, pile] of bySource) {
    const plan = GATE_PLANS[source]
    // The weighted result is read FIELD BY FIELD and its `reasons` array is
    // deliberately dropped: `weightedMetric` appends one entry per skipped window,
    // so passing it through would make this readout grow with the size of the pile
    // and reintroduce exactly the unbounded output this module is built to avoid.
    const { value, totalWeight, windowCount, reason } = plan
      ? weightedMetric(pile, safePick(plan.stat), options)
      : { value: null, totalWeight: 0, windowCount: 0, reason: null }

    sources[source] = Object.freeze({
      stat: plan ? plan.stat : null,
      bar: plan ? barFor(bars, plan) : null,
      windowsSeen: pile.length,
      windowsQualifying: windowCount,
      weighted: Object.freeze({ value, totalWeight, windowCount, reason })
    })
  }
  return Object.freeze(sources)
}

/**
 * Label one strategy's graduation readout. ADVISORY: it returns a label and the
 * evidence behind it, and nothing in this module acts on either.
 *
 * @param {object} [input]
 * @param {string} [input.tag] the strategy tag being labelled
 * @param {Array} [input.windows] Task 1 windows, chronologically sorted by
 *   `windowStart`. The order is NOT re-sorted here: `collectWindows` already
 *   applies one documented tiebreak (start, end, source, tag) and re-sorting with
 *   a different one would silently disagree with the collector this layer reads.
 * @param {object} [input.bars] per-source bars, e.g. `{ backtest: { hitRateNet: 0.55 } }`.
 *   A bar the caller does not supply is a bar this layer refuses to invent; see
 *   `GATE_REASONS.BAR_UNAVAILABLE`.
 * @param {object} [input.options] `{ now, halfLifeDays }`, forwarded UNALTERED to
 *   `weightedMetric`. `now` follows `weighting.mjs:220` exactly: an OMITTED `now`
 *   means the wall clock and an explicit `now: null` means absence. No third
 *   convention is created here, which is why the object is forwarded rather than
 *   unpacked and re-read.
 * @returns {{
 *   tag: string|null,
 *   stage: "paper"|"testnet"|"mainnet",   a LABEL; one of `STAGES`
 *   verdict: string,                        the single terminal field, one of `GATE_VERDICTS`
 *   promoted: boolean,                      a reported FACT about the evidence, not a decision
 *   demoted: boolean,                       likewise, and never true at the same time as `promoted`
 *   windowsUsed: number,                    qualifying windows: those with a measured statistic AND a bar
 *   skipped: Readonly<Record<string, number>>,  one COUNT per distinct skip reason
 *   sources: Readonly<Record<string, {stat: string|null, bar: number|null,
 *     windowsSeen: number, windowsQualifying: number,
 *     weighted: Readonly<{value: number|null, totalWeight: number, windowCount: number, reason: string|null}>}>>,
 *   reasons: string[],
 *   warnings: string[]
 * }} `reasons` and `warnings` are bounded vocabularies, never one entry per window.
 */
export function evaluateStrategy({ tag = null, windows, bars, options = {} } = {}) {
  const pile = Array.isArray(windows) ? windows : []
  let qualifying = 0
  let aboveRun = 0
  let belowRun = 0
  // Where the NEWEST qualifying window landed. A streak of three says "three in a
  // row"; this says "and they stopped there", which is the difference between a
  // strategy still climbing and one whose evidence has gone flat or turned.
  let tail = null

  // ONE COUNT PER REASON, NEVER ONE ENTRY PER WINDOW. The sibling `weightedMetric`
  // appends a reason for every window it skips, so a thousand-window pile that
  // measured nothing returns a thousand identical strings — a readout that grows
  // with the size of the evidence pile is a readout nobody can render. The
  // vocabulary here is bounded at two skip reasons, so this object is bounded at
  // two keys no matter how large the pile grows.
  const skipped = {}

  for (const window of pile) {
    const plan = GATE_PLANS[window?.source]
    const bar = plan ? barFor(bars, plan) : null
    const stat = plan && bar !== null ? finiteOrNull(readStat(window, plan.stat)) : null
    // `stat` and `bar` are each either `null` or a finite number — `finiteOrNull`
    // has no other exit — so the absence checks below are STRICT `=== null` rather
    // than a loose `==`. A loose comparison here would be the very thing this
    // module exists to avoid: `"" == 0` and `"0" == 0` are both true, so a blank
    // field would satisfy an absence test as readily as a written-down zero would
    // satisfy a measurement one.
    // A window that cannot be argued from is an ABSENCE, and it breaks both runs
    // exactly as a measured sub-bar window would. Letting an absence "pass
    // through" a streak would let a pile of unmeasured windows accumulate twelve
    // of them and be called twelve consecutive above-bar windows.
    //
    // The two reasons are kept apart because they are different failures with
    // different fixes: `BAR_UNAVAILABLE` is the CALLER's (no bar supplied, or a
    // source with no gateable statistic at all — the live pile today carries none),
    // while `STAT_UNMEASURED` is the PRODUCER's (the window existed and measured
    // nothing). Collapsing them would hide a wiring mistake behind a data gap.
    if (stat === null) {
      const why = bar === null ? GATE_REASONS.BAR_UNAVAILABLE : GATE_REASONS.STAT_UNMEASURED
      skipped[why] = (skipped[why] ?? 0) + 1
      aboveRun = 0
      belowRun = 0
      continue
    }
    qualifying += 1

    // THE TWO THRESHOLDS ARE ORDERED, AND THE ORDER IS WHAT MAKES THEM A DEAD
    // ZONE. `bar * DEMOTE_FRACTION` is only BELOW `bar` when the bar is positive;
    // for a negative bar 70% of it is numerically GREATER than the bar itself, so
    // comparing against the raw pair collapses the band to nothing and silently
    // demotes at "below bar" instead of "below 70% of bar". Taking the max for
    // promotion and the min for demotion makes the invariant — the promote
    // threshold is never below the demote threshold — hold for EVERY finite bar,
    // mirroring the band rather than inverting it. The caller supplies the bar, so
    // the ordering has to hold for every bar they might supply.
    const promoteAt = Math.max(bar, bar * DEMOTE_FRACTION)
    const demoteAt = Math.min(bar, bar * DEMOTE_FRACTION)

    // STRICTLY greater than, and strictly less than. The spec writes "above bar"
    // against "below 70% of bar", and the symmetry is deliberate: a window sitting
    // EXACTLY on a threshold is on neither side of it, so it falls in the band and
    // breaks both runs rather than being rounded into either direction.
    if (stat > promoteAt) {
      aboveRun += 1
      belowRun = 0
      tail = "above"
    } else if (stat < demoteAt) {
      belowRun += 1
      aboveRun = 0
      tail = "below"
    } else {
      // THE HYSTERESIS BAND: at or above 70% of bar, but not above bar. Neither
      // direction is earned, and both runs break — which is the entire point of the
      // dead zone. A strategy oscillating inside it cannot be whipped across a
      // boundary by noise.
      aboveRun = 0
      belowRun = 0
      tail = "band"
    }
  }

  // THE SKIP REASONS ARE SURFACED, NOT JUST COUNTED, and in a DETERMINISTIC order
  // (vocabulary order, not encounter order) so two runs over the same pile render
  // identically. `reasons` stays bounded — one entry per distinct reason — while
  // `skipped` carries the magnitude.
  const reasons = []
  for (const why of [GATE_REASONS.BAR_UNAVAILABLE, GATE_REASONS.STAT_UNMEASURED]) {
    if (skipped[why]) reasons.push(why)
  }
  // THE FLOOR IS CHECKED BEFORE THE STREAK, and the order is the rule rather than
  // an implementation detail: "no 12 qualifying windows → no promotion verdict"
  // (spec section 4). Eleven above-bar windows are eleven real windows, and a gate
  // that checked the streak first would promote a strategy whose twelfth window does
  // not exist. A below-floor pile earns NO verdict in either direction — there is
  // not enough evidence to demote either.
  if (qualifying < PROMOTE_WINDOWS) {
    reasons.push(GATE_REASONS.BELOW_FLOOR)
  }

  let verdict = GATE_VERDICTS.HOLD
  if (qualifying < PROMOTE_WINDOWS) verdict = GATE_VERDICTS.NO_VERDICT
  else if (aboveRun >= PROMOTE_WINDOWS) verdict = GATE_VERDICTS.PROMOTE
  else if (belowRun >= DEMOTE_WINDOWS) verdict = GATE_VERDICTS.DEMOTE

  const promoted = verdict === GATE_VERDICTS.PROMOTE
  const demoted = verdict === GATE_VERDICTS.DEMOTE
  const stage = promoted ? "testnet" : "paper"

  // THE TWO UPPER LEGS READ ABSENT, AND AN ABSENT LEG IS NAMED, NEVER ASSUMED.
  //
  // `TESTNET_CREDENTIALS_UNSET` appears exactly when the evidence has EARNED the
  // testnet label, because that is the only moment a reader would reasonably ask
  // "why is this not live yet". Emitting it on every paper strategy would bury the
  // thirty that have not earned the label under the one that has.
  //
  // `MAINNET_CEREMONY_REQUIRED` appears on EVERY readout, deliberately including a
  // clean promotion. Mainnet is not a stage any input reaches here — it is a
  // ceremony performed by hand, and the spec lists permit flips and ceremony unlocks
  // as non-goals (section 5). Carrying the reason unconditionally is what makes it
  // structural rather than advisory: a caller cannot read `reasons.length === 0`
  // and conclude that nothing stands between this strategy and real money.
  if (stage === "testnet") reasons.push(GATE_REASONS.TESTNET_CREDENTIALS_UNSET)
  reasons.push(GATE_REASONS.MAINNET_CEREMONY_REQUIRED)

  // WARNINGS FIRE ON THE SAME MATH AS VERDICTS, AND NO SOONER — the spec's third
  // honesty rule ("no asymmetric courage"). A demotion warning is emitted exactly
  // when the demotion verdict is, never on a partial run: shouting "decaying" after
  // two bad windows while the verdict still reads hold invents a courage the gate
  // does not have, and trains a reader to ignore the channel.
  const warnings = []
  if (demoted) warnings.push(GATE_WARNINGS.DEMOTION)
  // The band warning is the "which are decaying" signal a paper-room table needs,
  // and it is scoped to piles that CLEARED THE FLOOR: with three windows you cannot
  // tell decay from a strategy that simply has not run enough yet.
  else if (qualifying >= PROMOTE_WINDOWS && tail === "band") {
    warnings.push(GATE_WARNINGS.IN_HYSTERESIS_BAND)
  }

  return {
    tag,
    stage,
    verdict,
    promoted,
    demoted,
    windowsUsed: qualifying,
    skipped: Object.freeze(skipped),
    sources: summariseSources(pile, bars, options),
    reasons,
    warnings: Object.freeze(warnings)
  }
}