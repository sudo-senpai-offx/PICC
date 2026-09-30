// WS-7 T11 — the deterministic confluence engine's weighted sum and score
// arithmetic.
//
// Spec §4.4:678-689 is the weight table's authority:
//   "**Experts and weights** (a test asserts the sum is exactly 100)"
//   Macro Bias 20 · Structural 20 · Trend & Strength 20 · Momentum &
//   Exhaustion 15 · Volatility & Boosters 20 · Sentiment 5.
//
// AC-022 (:1005-1011) restates it as the binding acceptance criterion:
// "Expert weights sum to 100 and degrade honestly". The sum is asserted at
// EXACTLY 100 below — not `>= 100`, not `100 ± ε`. A tolerant assertion is not
// an assertion: it would pass on 99 or 101, and the whole point of pinning a
// weight table is that it cannot drift by a single point without a test going
// red.
//
// NO CLOCK, NO RANDOMNESS, NO NETWORK, NO MODEL. `computedAt` is the only
// permitted time input on the whole decision path (AC-021:937 names wall-clock
// nondeterminism as a prohibited side effect). This module reads no clock at
// all; `evaluate()` takes the clock as a parameter.
//
// NO ROUNDING. Scores are carried as full IEEE-754 doubles and clamped only.
// AC-023:953 prohibits interpolating "a value between 84 and 85" into A+, and a
// `Math.round(score)` would do exactly that to 84.996. Rounding is therefore
// banned on this path, and `tiers.mjs` compares the raw value against the
// boundaries.

/**
 * Bumped whenever the arithmetic, the bands, or the weight table changes.
 * AC-021:936 requires the score to carry an `engineVersion` so two scores can
 * be compared only when they came from the same arithmetic.
 */
export const ENGINE_VERSION = "copilot-engine/1.0.0"

/**
 * The six experts and their weights, in the spec's order (§4.4:682-687 and
 * §4.3:605-606). Frozen, and in a fixed declared order, because AC-021 forbids
 * iteration over an unordered collection where the order is observable.
 *
 * This is the SERVER copy and it is AUTHORITATIVE for `ExecutionTier`
 * (plan v1 §2, Risk 6). The client copy at
 * `src/terminal/domain/copilotDecision.ts:52-59` is a rendering projection;
 * `__tests__/tierBoundaryParity.test.mjs` proves the two tables are
 * element-wise equal so they cannot drift apart silently.
 */
export const EXPERT_WEIGHTS = Object.freeze([
  Object.freeze({ expert: "macroBias", weightPct: 20 }),
  Object.freeze({ expert: "structural", weightPct: 20 }),
  Object.freeze({ expert: "trendStrength", weightPct: 20 }),
  Object.freeze({ expert: "momentumExhaustion", weightPct: 15 }),
  Object.freeze({ expert: "volatilityBoosters", weightPct: 20 }),
  Object.freeze({ expert: "sentiment", weightPct: 5 })
])

export const EXPERT_IDS = Object.freeze(EXPERT_WEIGHTS.map((e) => e.expert))

export const EXPERT_WEIGHT_SUM = EXPERT_WEIGHTS.reduce((total, e) => total + e.weightPct, 0)

/**
 * The AC-022 assertion, at module load.
 *
 * This is deliberately a throw rather than a console warning: a weight table
 * that does not sum to 100 is not a degraded configuration, it is a wrong
 * specification of how much each expert is allowed to matter, and every score
 * the engine produces afterwards would be quietly wrong. Failing at load makes
 * that impossible to ship rather than merely unlikely.
 */
if (EXPERT_WEIGHT_SUM !== 100) {
  throw new Error(
    `copilot: AC-022 weight invariant violated — the six expert weights sum to ${EXPERT_WEIGHT_SUM}, not exactly 100`
  )
}

/**
 * Available-weight coverage → the `confidence` field (§4.3:616).
 *
 * AC-030:1008 requires that "the confidence reflects the gap". These are the
 * four spec-named values and nothing else. The numeric thresholds are NOT in
 * the spec — the spec names the vocabulary (`"high" | "medium" | "low" |
 * "unavailable"`) and the requirement, and leaves the cut-points open. They are
 * declared here as named constants so the choice is auditable and table-tested
 * rather than buried in a comparison chain.
 *
 * Reading: 95% coverage (Sentiment missing) is "medium", not "high". A 5-point
 * hole in a 5% expert is a 5% hole in the score's authority, and saying
 * "high" would hide exactly what AC-030 forbids hiding.
 */
export const CONFIDENCE_THRESHOLDS = Object.freeze({
  /** Coverage at or above this share of the 100-point table is `high`. */
  highAtOrAbovePct: 100,
  /** At or above this and below `highAtOrAbovePct`, `medium`. */
  mediumAtOrAbovePct: 80,
  /** Anything above zero and below `mediumAtOrAbovePct`, `low`. */
  lowAbovePct: 0
})

/**
 * Map available weight coverage onto the spec's confidence vocabulary.
 *
 * This is a pure function of coverage alone. It never consults the score, the
 * regime, or the vetoes, so it cannot be influenced by anything downstream of
 * it — a confidence that depended on the score would be a second, disagreeing
 * opinion about the same evaluation.
 *
 * @param {number} coveragePct Sum of `weightPct` over AVAILABLE experts.
 * @returns {"high"|"medium"|"low"} `low` for any non-zero coverage below the
 *   medium cut. `unavailable` is NOT returned here — it is the caller's job to
 *   decide that an unscoreable state has no confidence at all, because
 *   coverage and scoreability are different questions (a dead-zone evaluation
 *   can have full coverage and still produce no score).
 */
export function confidenceOfCoverage(coveragePct) {
  if (coveragePct >= CONFIDENCE_THRESHOLDS.highAtOrAbovePct) return "high"
  if (coveragePct >= CONFIDENCE_THRESHOLDS.mediumAtOrAbovePct) return "medium"
  return "low"
}

/**
 * The band → 0-100 sub-score map.
 *
 * §4.3:608 types `rawDelta` as "within the expert's own band", and §4.4:686
 * gives each expert a band in delta space (e.g. Macro Bias "+10 / −10 each").
 * The band is therefore the expert's OWN scale; the confluence is on 0-100.
 * `bandToScore` is the one place the two are related, and it is an affine map
 * of each expert's declared band onto 0-100 — no fitted constants, no
 * normalisation across experts, nothing learned.
 *
 * @param {number} rawDelta A value inside the expert's own band.
 * @param {{min: number, max: number}} band The expert's declared band.
 * @returns {number} The expert's sub-score on 0-100, clamped.
 */
export function bandToScore(rawDelta, band) {
  const span = band.max - band.min
  if (!(span > 0)) {
    throw new TypeError(`copilot: band must have max > min, received min=${band.min} max=${band.max}`)
  }
  const mapped = (100 * (rawDelta - band.min)) / span
  return clamp(mapped, 0, 100)
}

export function clamp(value, lo, hi) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`copilot: refusing to score a non-finite value (${value})`)
  }
  return Math.min(hi, Math.max(lo, value))
}

/**
 * The weighted points an available expert contributed to the 0-100 score.
 *
 * `weightPct / 100` is the share of the FINAL score this expert is allowed to
 * move. It is deliberately NOT divided by the available coverage: that
 * division is precisely the renormalisation AC-030:1009 prohibits ("weights may
 * not be renormalized to hide the absence"). A missing expert leaves a hole of
 * exactly its own weight, and the hole lowers the score on its own.
 */
export function weightedPointsOf(subScore, weightPct) {
  return (subScore * weightPct) / 100
}

/**
 * The total available weight across the six contributions, as a percentage of
 * the declared 100. This is the "how much of the table could actually speak"
 * figure that AC-030's confidence penalty is derived from.
 */
export function coverageOf(contributions) {
  return contributions.reduce(
    (total, c) => (c.available ? total + c.weightPct : total),
    0
  )
}

// ---------------------------------------------------------------------------
// The confluence assembly
// ---------------------------------------------------------------------------

import { deriveMarketState } from "./marketState.mjs"
import { classifyRegime } from "./regime.mjs"
import * as macroBias from "./experts/macroBias.mjs"
import * as structural from "./experts/structural.mjs"
import * as trendStrength from "./experts/trendStrength.mjs"
import * as momentumExhaustion from "./experts/momentumExhaustion.mjs"
import * as volatilityBoosters from "./experts/volatilityBoosters.mjs"
import * as sentiment from "./experts/sentiment.mjs"

/**
 * The six expert modules, in §4.4's order. AC-021 forbids the order of an
 * observable collection being incidental, so it is declared here rather than
 * derived from a glob or an object's key order.
 *
 * `volatilityBoosters` reads `{ regime }` because Unicorn is defined against it
 * (§4.2:547, §4.4:693). Every expert takes the same `(state, context)`
 * signature so the registry below is uniform and no expert is silently handed
 * an argument it does not accept.
 */
const EXPERTS = Object.freeze([
  Object.freeze({ expert: "macroBias", mod: macroBias }),
  Object.freeze({ expert: "structural", mod: structural }),
  Object.freeze({ expert: "trendStrength", mod: trendStrength }),
  Object.freeze({ expert: "momentumExhaustion", mod: momentumExhaustion }),
  Object.freeze({ expert: "volatilityBoosters", mod: volatilityBoosters }),
  Object.freeze({ expert: "sentiment", mod: sentiment })
])

/** The regime that permits no trade (§4.4:693, §4.7:747). */
const NO_TRADE_REGIME = "deadZone"

/**
 * Evaluate the whole confluence from market state alone.
 *
 * AC-021:935 — "The same market state is evaluated 100 times" and the result is
 * "an identical `ConfluenceScore` every time, with an `engineVersion`; no model
 * call occurs on the decision path."
 *
 * THE SCORE, EXACTLY AS SPECIFIED:
 *
 *   score = Σ over AVAILABLE experts of ( subScore_i × weightPct_i / 100 )
 *
 * Three properties of that formula are load-bearing:
 *
 *   1. THE DIVISOR IS 100, NOT THE COVERAGE. It is the only way to express "no
 *      renormalisation" (AC-030:1009). A missing expert leaves a hole of exactly
 *      its own weight, so the score falls on its own without anyone rescaling
 *      the survivors to fill the gap. Confidence carries the rest of the
 *      message.
 *   2. EVERY EXPERT IS RETURNED, AVAILABLE OR NOT (AC-030:1008). A caller always
 *      sees all six rows, and an unavailable one carries a non-empty
 *      `unavailableReason` (contracts.ts:162-164).
 *   3. NOTHING IS ROUNDED. AC-023:953 prohibits a value between 84 and 85 being
 *      rounded into A+, so the score reaches `tiers.mjs` at full precision.
 *
 * @param {object} rawState The caller's market state (see `deriveMarketState`),
 *   or an already-derived one.
 * @returns {object} A `ConfluenceScore` per contracts.ts:193-202, plus
 *   `coveragePct` and `expertScores`, which are derived facts a room displays and
 *   which any caller can recompute from the six contributions.
 */
export function evaluateConfluence(rawState) {
  const state = isDerivedState(rawState) ? rawState : deriveMarketState(rawState)
  const classification = classifyRegime(state)

  // Each expert is evaluated EXACTLY ONCE. Re-evaluating would be three times
  // the work for the same answer, and a future expert with internal state would
  // make the third call disagree with the first.
  const evaluated = EXPERTS.map(({ expert, mod }) => {
    const result = mod.evaluate(state, { regime: classification.regime })
    assertContributionShape(expert, result)
    return { expert, mod, result }
  })

  // The DECLARED TABLE is the authority for weights, not the expert modules: a
  // module that exported the wrong weight must not be able to move the score.
  for (let i = 0; i < evaluated.length; i++) {
    const declared = EXPERT_WEIGHTS[i].weightPct
    if (evaluated[i].mod.WEIGHT_PCT !== declared) {
      throw new Error(
        `copilot: expert ${evaluated[i].expert} declares weight ${evaluated[i].mod.WEIGHT_PCT}, but the table at spec §4.4:682-687 declares ${declared}`
      )
    }
  }

  const contributions = evaluated.map(({ expert, result, mod }) =>
    Object.freeze({
      expert,
      // The WEIGHT, always — including when the expert is unavailable. The gap
      // is the information; zeroing the weight would hide it.
      weightPct: mod.WEIGHT_PCT,
      rawDelta: result.available ? result.rawDelta : null,
      available: result.available,
      unavailableReason: result.available ? null : result.unavailableReason
    })
  )

  const expertScores = evaluated.map(({ result, mod }, i) => {
    const c = contributions[i]
    if (!c.available) return Object.freeze({ ...c, subScore: null, weightedPoints: 0 })
    return Object.freeze({
      ...c,
      subScore: result.subScore,
      weightedPoints: weightedPointsOf(result.subScore, c.weightPct)
    })
  })

  const coveragePct = coverageOf(expertScores)
  const rawScore = expertScores.reduce((total, e) => total + e.weightedPoints, 0)

  // A dead zone is "no trading", not a low score (§4.7:747), and no-trade is not
  // a number. `null` is the spec's named unscoreable value (contracts.ts:188)
  // and routes to `ignore`/`hold`/`0%` in `tiers.mjs`. Zero would be a lie: it
  // would say "the engine looked and found nothing" about a state the engine
  // deliberately declined to score.
  const deadZone = classification.regime === NO_TRADE_REGIME
  const unscoreable = deadZone || coveragePct === 0
  const score = unscoreable ? null : clamp(rawScore, 0, 100)

  const confidence = score === null ? "unavailable" : confidenceOfCoverage(coveragePct)
  const activeBoosters = volatilityBoosters.activeBoostersOf(evaluated[4].result)

  return Object.freeze({
    score,
    contributions: Object.freeze(contributions),
    confidence,
    regime: classification.regime,
    activeBoosters: Object.freeze(activeBoosters),
    // T12 owns C1/C2/C3 (spec :1300-1307). T11 emits none: an empty array is
    // the honest statement that no conflict resolution has been applied, not an
    // empty placeholder for one that has.
    conflictOverrides: Object.freeze([]),
    computedAt: state.computedAt,
    engineVersion: ENGINE_VERSION,
    // Derived, recomputable, and declared rather than left for the room to infer.
    coveragePct,
    expertScores: Object.freeze(expertScores),
    regimeDetail: Object.freeze(classification)
  })
}

/** A derived state has already had its series computed; a raw one has not. */
function isDerivedState(candidate) {
  return candidate !== null && typeof candidate === "object" && "series" in candidate && "computedAt" in candidate
}

/**
 * Reject an expert that returned something unscoreable-shaped.
 *
 * The two prohibitions this enforces are AC-030's verbatim: a missing expert
 * may not be treated as a zero contribution, and it may not be returned without
 * a reason. A contributor returning `available: false, rawDelta: 0` would satisfy
 * a naive consumer and violate both.
 */
function assertContributionShape(expert, result) {
  if (result === null || typeof result !== "object") {
    throw new TypeError(`copilot: expert ${expert} returned ${String(result)} instead of a result object`)
  }
  if (typeof result.available !== "boolean") {
    throw new TypeError(
      `copilot: expert ${expert} must return a boolean \`available\`; received ${String(result.available)}`
    )
  }
  if (result.available === false) {
    if (result.rawDelta !== null) {
      throw new Error(
        `copilot: expert ${expert} is unavailable but returned rawDelta ${result.rawDelta} — an absent expert must report null, never a number`
      )
    }
    if (typeof result.unavailableReason !== "string" || result.unavailableReason.length === 0) {
      throw new Error(
        `copilot: expert ${expert} is unavailable and must supply a non-empty unavailableReason (AC-030)`
      )
    }
  }
  if (result.available === true && typeof result.rawDelta !== "number") {
    throw new TypeError(
      `copilot: expert ${expert} is available and must return a numeric rawDelta; received ${String(result.rawDelta)}`
    )
  }
}
