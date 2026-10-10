// Graduation analytics — recency weighting (W3-04, layer 2 of 4).
//
// WHAT THIS IS. Two pure functions. `decayWeight` turns a window's end instant
// into a recency weight; `weightedMetric` folds a pile of windows into one
// weighted average of one statistic. Task 3's gates read the output of this
// module and nothing else, so "how much does a stale window count" is decided
// here, once.
//
// ADVISORY ONLY. A readout. No permit flip, no unlock, no ceremony gate, no
// credential, no store, no filesystem, no network, no import of any
// backtest/paper/live service. Nothing here mutates a window or decides whether
// a strategy graduates — a weight is an input to a readout, never an
// authorization.
//
// THE HONESTY RULES, which are the reason this module exists at all:
//
//   1. ABSENCE, NEVER ZERO. A statistic that was not measured is `null` and its
//      window is SKIPPED, not averaged in as a zero. This is the same rule
//      `windows.mjs` states, and it is the same defect it had to fix twice: an
//      empty string became a measured `0` and argued a strategy over the floor.
//      So `Number.isFinite` gates every arithmetic step here, and `Number(x)` is
//      never applied to a value that might be null.
//
//   2. NO WEIGHT, NO COUNT. A window whose picked statistic is `null` contributes
//      neither weight nor `windowCount`. It is named in `reasons` instead.
//      Averaging it in would both dilute the mean toward a number nobody
//      measured and inflate the evidence count Task 3 counts consecutive
//      qualifying windows against.
//
//   3. NO FABRICATED RECENCY. A window whose `windowEnd` cannot be parsed yields
//      `null`, not a default weight. Inventing "assume it ended today" would
//      make an undated window the FRESHEST evidence in the pile.
//
// ADVISORY READOUT. What comes out of here moves no permit and unlocks nothing.

/**
 * The half-life used when nothing overrides it.
 *
 * Exported because it is part of the module's contract, not an implementation
 * detail: a caller rendering "measured over a 30-day half-life" needs the number
 * it actually applied, and a test needs it without retyping a literal that could
 * drift from this one.
 */
export const HALFLIFE_DAYS_DEFAULT = 30

/**
 * The environment variable that overrides the half-life.
 *
 * EXPORTED so that no caller — and no test — has to spell the variable out. A
 * literal `PICC_*` name written into a test file is a finding for
 * `ws7TestStoreIsolation`'s test-file scan, and the honest way to avoid minting
 * one is not to write it. It is also the reason this module reads a scalar and
 * nothing else: the name is not path-shaped (`_DAYS`, not `_DIR`/`_FILE`/`_PATH`),
 * so it can never resolve to a store that a test could not redirect.
 *
 * THE READ ITSELF IS DOTTED, and that is not a style preference. Spelled as a
 * bracketed index into `process.env`, `ws7TestStoreIsolation` records it as a
 * COMPUTED read whose name no static scan can resolve, and fails the build for
 * every such read no module has explained by name. The dotted spelling puts the
 * literal in the source where the scan can see it, classify it as a scalar, and
 * move on. The suite asserts the two spellings agree, so the constant and the
 * read cannot drift apart unnoticed.
 *
 * THE BRACKETED FORM IS NOT NAMED HERE IN FULL, deliberately: this guard scans
 * RAW LINES, so a comment that spells the computed read out loud is itself
 * counted as one. `ws7TestStoreIsolation.test.mjs` failed on exactly that while
 * this module was being written.
 */
export const HALFLIFE_DAYS_ENV = "PICC_GRADUATION_HALFLIFE_DAYS"

const MS_PER_DAY = 86_400_000

/**
 * The smallest positive double: the floor the weight is clamped to so it can
 * never UNDERFLOW to exactly 0.
 *
 * A window a million years old has a true weight below the smallest number a
 * double can hold, and `0.5 ** k` for a large enough `k` is literally `0`. That
 * `0` is a floating-point artifact dressed up as a measurement, and it is the
 * same defect this module exists to prevent one layer down: a caller dividing by
 * a `totalWeight` that quietly became `0` gets a division by zero, and a caller
 * summing weights cannot tell "contributed nothing" from "was never counted".
 * Clamping keeps the stated invariant `weight ∈ (0, 1]` true for every input.
 * The floor is 5e-324: it can never move a weighted average, it can only keep the
 * arithmetic total.
 */
const WEIGHT_FLOOR = Number.MIN_VALUE

/**
 * Reason vocabulary. Stable strings, not free text, so Task 3 can branch on them
 * without pattern-matching English — the same contract `windows.mjs` sets with
 * its own `REASONS`.
 */
export const WEIGHT_REASONS = Object.freeze({
  NO_WINDOWS: "windows:none",
  PICK_MISSING: "pick:missing",
  STAT_UNMEASURED: "stat:unmeasured",
  WEIGHT_UNCOMPUTABLE: "weight:no-end-instant",
  NO_MEASURED_WINDOWS: "windows:none-measured",
  AVERAGE_UNFINITE: "average:not-finite"
})

/**
 * A genuinely measured number, or null. Absence is never coerced to a zero.
 *
 * The same discipline, and for the same reason, as `windows.mjs`: `Number("")`
 * is `0`, so a blank field arriving from a CSV import or a JSON column typed
 * `string` would become a MEASURED zero and drag a weighted average toward flat.
 * A written-down zero (`0`, `"0"`) still survives as a measurement.
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
 * Compile a `pick` into a reader, or null if the pick is not usable.
 *
 * A pick is either the NAME of one of a window's statistics (`"sharpe"`) or a
 * function from a window to a value, so a caller can read a derived quantity
 * without this module inventing it. There is deliberately NO default: which
 * statistic a gate is argued on is the gate's decision, not this module's.
 */
function compilePick(pick) {
  if (typeof pick === "function") return (w) => finiteOrNull(pick(w))
  if (typeof pick === "string" && pick.trim() !== "") return (w) => finiteOrNull(w?.[pick])
  return null
}

/**
 * Parse an ISO string / epoch-ms value / Date to an instant in ms, or null.
 *
 * Deliberately a small local copy rather than an import: `windows.mjs` keeps its
 * parser private, and a normalizer that emitted unparseable bounds would be an
 * abstraction worth having only if this module also owned the collector — which
 * it does not. The behaviour is the same shape as the original, including the
 * refusal to guess: a non-finite instant is `null`, never "now" and never epoch.
 */
function instantOf(value) {
  if (value == null) return null
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * The half-life to use: explicit argument, then the environment override, then
 * the default. Nothing here throws, and nothing here can return a non-positive
 * number — a zero or negative half-life divides by zero and yields `Infinity`,
 * which would then flow into `totalWeight` and silently destroy every average
 * computed downstream of it.
 *
 * READ INSIDE THE CALL, DELIBERATELY. Capturing the override once at module load
 * would make it a constant wearing a configuration's name: a process that
 * reconfigures mid-run would be ignored, and no test could exercise the override
 * at all without re-importing the module under a mutated environment. The cost
 * is that `decayWeight` is pure in its ARGUMENTS and in the configured value,
 * not in ambient state; that is the whole scope of the purity claim, and callers
 * who want a total function pass `halfLifeDays` explicitly.
 *
 * THE EMPTY STRING IS ABSENCE, NOT A NUMBER — the same trap `windows.mjs`
 * documents. `Number("")` and `Number("   ")` are both `0`, so a blank override
 * that went straight through `Number` would arrive as a zero half-life. It is
 * rejected before any coercion happens.
 */
function resolveHalfLifeDays(explicit) {
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const raw = process.env.PICC_GRADUATION_HALFLIFE_DAYS
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return HALFLIFE_DAYS_DEFAULT
}

/**
 * Recency weight for a window: `0.5 ** (ageDays / halfLifeDays)`.
 *
 * The weight is exactly 1 at zero age, exactly 0.5 at one half-life, and exactly
 * 0.25 at two — all three are powers of two, so they are exact in IEEE-754 and
 * can be asserted with `toBe` rather than a tolerance.
 *
 * THE RANGE IS (0, 1], AND BOTH ENDS ARE EARNED. A window whose end is in the
 * FUTURE has a negative age, and `0.5 ** negative` is greater than 1 — which would
 * let a future-dated window outweigh a live one and inflate its influence above
 * "as fresh as it is possible to be". So the ceiling is applied by clamping to 1:
 * a future-dated window is treated as maximally recent, which is the most
 * favourable reading its own timestamp supports and no more. The floor is
 * `WEIGHT_FLOOR`, for the underflow reason recorded there.
 *
 * `null` — NOT a number, and NOT an exception — is returned when `windowEnd`
 * cannot be read as an instant. That is the module's absence answer, identical in
 * meaning to a null statistic: nobody measured this. Throwing would push the
 * decision onto every caller; defaulting would invent recency.
 *
 * `@param {string|number|Date} windowEnd` the window's end instant
 * @param {object} [options]
 * @param {number} [options.halfLifeDays] days. PRECEDENCE: this argument first,
 *   then `PICC_GRADUATION_HALFLIFE_DAYS`, then `HALFLIFE_DAYS_DEFAULT` (30). A
 *   reader rendering "measured over a 30-day half-life" from the default alone
 *   would misreport a process running with the override set to 7.
 * @param {string|number|Date} [options.now] the instant to measure age from.
 *   Omitting it means the wall clock; an explicit `now: null` means absence.
 * @returns {number|null} a weight in (0, 1], or null when no age could be measured
 */
export function decayWeight(windowEnd, options = {}) {
  const endMs = instantOf(windowEnd)
  if (endMs == null) return null
  // NOT SUPPLIED and SUPPLIED-BUT-UNREADABLE ARE DIFFERENT, and conflating them
  // is how a replay stops being reproducible. An absent `now` means "measure
  // against the current instant", which is the documented default; a `now` that
  // was given and cannot be read means the caller asked for a specific instant and
  // it did not survive, so the honest answer is `null` rather than a silent
  // substitution of the machine's clock — which would move under a test and under
  // a backtest replay alike.
  const nowMs = options.now === undefined ? Date.now() : instantOf(options.now)
  if (nowMs == null) return null
  const halfLife = resolveHalfLifeDays(options.halfLifeDays)
  const ageDays = (nowMs - endMs) / MS_PER_DAY
  if (ageDays <= 0) return 1
  const weight = 0.5 ** (ageDays / halfLife)
  return weight < WEIGHT_FLOOR ? WEIGHT_FLOOR : weight
}

/**
 * Recency-weighted average of ONE statistic across a pile of windows.
 *
 * THE TWO COUNTS ARE NOT THE SAME NUMBER, and conflating them is the failure this
 * function exists to prevent:
 *
 *   - `windowCount` is how many windows actually contributed a MEASUREMENT. It
 *     is what Task 3's "12 consecutive windows above the bar" count is allowed to
 *     be built on, so an unmeasured window that sneaked in here would manufacture
 *     evidence that nobody collected.
 *   - `totalWeight` is how much recency-weighted influence those windows carry.
 *
 * A window contributes to BOTH only if its picked statistic is a finite number
 * AND its end instant yields a weight. Otherwise it is named in `reasons` and
 * dropped — never averaged in as a zero, which would both dilute the mean toward
 * a number nobody measured and inflate the count.
 *
 * `value` is null whenever `totalWeight` is 0, and NEVER 0: "the weighted average
 * of nothing" is not a flat result, it is the absence of one.
 *
 * @param {Array} windows Task 1 windows (sorted by `windowStart`)
 * @param {string|((w: object) => unknown)} pick statistic name, or a reader function
 * @param {object} [options] forwarded to `decayWeight` — `{ halfLifeDays, now }`
 * @returns {{value: number|null, totalWeight: number, windowCount: number,
 *   reason: string|null, reasons: string[]}}
 */
export function weightedMetric(windows, pick, options = {}) {
  const read = compilePick(pick)
  if (!read) {
    return {
      value: null,
      totalWeight: 0,
      windowCount: 0,
      reason: WEIGHT_REASONS.PICK_MISSING,
      reasons: []
    }
  }
  if (!Array.isArray(windows) || windows.length === 0) {
    return {
      value: null,
      totalWeight: 0,
      windowCount: 0,
      reason: WEIGHT_REASONS.NO_WINDOWS,
      reasons: []
    }
  }

  const reasons = []
  let weightedSum = 0
  let totalWeight = 0
  let windowCount = 0

  for (const window of windows) {
    const value = read(window)
    if (value == null) {
      reasons.push(WEIGHT_REASONS.STAT_UNMEASURED)
      continue
    }
    const weight = decayWeight(window?.windowEnd, options)
    if (weight == null) {
      reasons.push(WEIGHT_REASONS.WEIGHT_UNCOMPUTABLE)
      continue
    }
    weightedSum += value * weight
    totalWeight += weight
    windowCount += 1
  }

  if (windowCount === 0 || totalWeight === 0) {
    return {
      value: null,
      totalWeight: 0,
      windowCount: 0,
      reason: WEIGHT_REASONS.NO_MEASURED_WINDOWS,
      reasons
    }
  }

  const value = weightedSum / totalWeight
  // AN OVERFLOWED AVERAGE IS NOT AN ENORMOUS STRATEGY. Two windows carrying the
  // largest finite double sum to `Infinity`, and `Infinity / 2` is still
  // `Infinity` — a value no gate can be argued against, no floor compared, and no
  // chart can draw. It is reported as absence with a reason instead, because the
  // only honest readings are "these numbers cannot be averaged" and "nobody
  // measured this", and neither of them is a verdict.
  if (!Number.isFinite(value)) {
    return {
      value: null,
      totalWeight,
      windowCount,
      reason: WEIGHT_REASONS.AVERAGE_UNFINITE,
      reasons
    }
  }

  return { value, totalWeight, windowCount, reason: null, reasons }
}