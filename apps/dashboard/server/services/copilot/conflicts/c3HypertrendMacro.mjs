// WS-7 T12 — conflict resolution C3: HYPERTREND vs MACRO BIAS.
//
// §4.4:701 — "**C3 — Hypertrend vs macro bias.** When `regime == hypertrend`,
// temporarily reduce Macro Bias weight from 20% to **0%**, because a 4H wall is
// irrelevant in a 1–3 minute high-velocity window. The reallocation has a stated
// window and expires; it is not sticky."
//
// AC-029 (:997-1003) is the binding criterion; R9.3 (:432) — "C3 … is a
// temporary weight reallocation with a stated window".
//
// ---------------------------------------------------------------------------
// WHY THE WINDOW IS THE REGIME AND NOT A NUMBER
// ---------------------------------------------------------------------------
//
// §4.4:701 requires "a stated window" and that it "expires", and gives no candle
// count. It does not OMIT one, either: the window is the regime. It opens when
// T11's classifier (`regime.mjs`) says `hypertrend` and closes when the
// classifier stops saying so. So the expiry is derived from the SAME classifier
// the regime itself comes from, and this module holds no counter, no timer, and
// no remembered flag. "It is not sticky" is therefore a STRUCTURAL property —
// there is nothing here that could keep the window open — and a test asserts the
// resolution's key set contains no state at all.
//
// ---------------------------------------------------------------------------
// WHY THE OTHER FIVE WEIGHTS ARE NOT TOUCHED
// ---------------------------------------------------------------------------
//
// AC-029:1000 — "the remaining weights are used as declared". AC-029:1001 — the
// reallocation "may not silently renormalize in a way that hides the change". So
// during hypertrend the effective table sums to 80. Rescaling the five survivors
// back to 100 would hand each of them authority §4.4:682-687 never granted, and
// would restore a 100-point ceiling the rule exists to lower. `C3_RULE.renormalises`
// is `false` as a stated contract, and the effective total is reported so a
// caller who wanted to renormalise would have to do it visibly.
//
// PURE. No clock, no randomness, no network, no filesystem, no model. The only
// time input is `state.computedAt`, supplied by the caller (AC-021:937).

import { EXPERT_WEIGHTS } from "../confluence.mjs"
import { WEIGHT_PCT as MACRO_WEIGHT_PCT } from "../experts/macroBias.mjs"
import { classifyRegime } from "../regime.mjs"

/**
 * C3 as a named, versioned rule. Frozen.
 */
export const C3_RULE = Object.freeze({
  id: "C3",
  ruleId: "copilot.conflict.c3HypertrendMacro",
  ruleVersion: "copilot-conflict-c3HypertrendMacro/1.0.0",
  specRef: "§4.4:701 (R9.3, AC-029)",
  /** §4.4:701 — "When `regime == hypertrend`". */
  regime: "hypertrend",
  /** The window is the regime's own duration. Named because it is a reading. */
  windowAnchor: "regimeWindow",
  /** What closes it. Not a candle count — a condition. */
  expiryCondition: "regimeExit",
  targetExpert: "macroBias",
  /** Read from `experts/macroBias.mjs`, not restated. Risk 6 of plan v1 §2. */
  declaredWeightPct: MACRO_WEIGHT_PCT,
  /** §4.4:701's literal — "reduce Macro Bias weight from 20% to **0%**". */
  reallocatedWeightPct: 0,
  /** AC-029:1001. Stated so it is a contract, not a habit. */
  renormalises: false
})

/**
 * C3's decision for one evaluation.
 *
 * @param {object} args
 * @param {object} args.state A frozen state from `deriveMarketState`.
 * @param {boolean} [args.enabled] `false` disables C3 outright.
 * @returns {Readonly<object>} The resolution. Always a named `status`; never a
 *   "null means no opinion" path.
 */
export function evaluateC3({ state, enabled = true } = {}) {
  const regime = classifyRegime(state).regime
  const isHypertrend = regime === C3_RULE.regime
  const declaredWeightPct = C3_RULE.declaredWeightPct
  const macroWeightPct = isHypertrend ? C3_RULE.reallocatedWeightPct : declaredWeightPct

  const window = Object.freeze({
    anchor: C3_RULE.windowAnchor,
    expiryCondition: C3_RULE.expiryCondition,
    open: isHypertrend,
    // "expired" is about the window's end condition, which has not been reached
    // while the regime stands. A closed window is `open: false`, not expired:
    // expiry is what happens when a window that WAS open stops being true.
    expired: false,
    openedForRegime: C3_RULE.regime,
    // Explicitly null, not 0. There is no candle count — the window is a state.
    candleCount: null
  })

  const base = Object.freeze({
    rule: C3_RULE.id,
    ruleId: C3_RULE.ruleId,
    ruleVersion: C3_RULE.ruleVersion,
    specRef: C3_RULE.specRef,
    targetExpert: C3_RULE.targetExpert,
    supersededBy: null,
    regime,
    macroWeightPct,
    window,
    inputs: Object.freeze({
      regime,
      hypertrend: isHypertrend,
      declaredWeightPct,
      reallocatedWeightPct: C3_RULE.reallocatedWeightPct,
      renormalises: C3_RULE.renormalises,
      remainingWeightsUnchanged: true
    })
  })

  if (enabled !== true) {
    return Object.freeze({
      ...base,
      macroWeightPct: declaredWeightPct,
      window: Object.freeze({ ...window, open: false }),
      status: "disabled",
      applied: false,
      reason: "C3 is disabled for this evaluation, so Macro Bias keeps its declared weight",
      adjustments: Object.freeze([])
    })
  }

  if (!isHypertrend) {
    return Object.freeze({
      ...base,
      status: "notHypertrend",
      applied: false,
      reason:
        `C3 applies only when regime == ${C3_RULE.regime}; this evaluation read ${regime}, ` +
        `so Macro Bias keeps its declared ${declaredWeightPct}%`,
      adjustments: Object.freeze([])
    })
  }

  const reason =
    `C3: regime == ${C3_RULE.regime}, and a 4H wall is irrelevant in a 1–3 minute high-velocity window, ` +
    `so the ${C3_RULE.targetExpert} weight is reallocated from ${declaredWeightPct}% to ` +
    `${C3_RULE.reallocatedWeightPct}%. The remaining five weights are used as declared and the total is ` +
    `NOT renormalised back to ${EXPERT_WEIGHTS.reduce((t, e) => t + e.weightPct, 0)}%. ` +
    `The window closes when the regime is no longer ${C3_RULE.regime}.`

  const adjustment = Object.freeze({
    expert: C3_RULE.targetExpert,
    rule: C3_RULE.id,
    ruleId: C3_RULE.ruleId,
    ruleVersion: C3_RULE.ruleVersion,
    weightPct: C3_RULE.reallocatedWeightPct,
    reason
  })

  return Object.freeze({
    ...base,
    status: "applied",
    applied: true,
    reason,
    adjustments: Object.freeze([adjustment])
  })
}

/**
 * The confluence adjustments C3 contributes. `[]` when it did not apply.
 *
 * @param {object} resolution From `evaluateC3`.
 * @returns {ReadonlyArray<object>}
 */
export function c3Adjustments(resolution) {
  if (resolution === null || resolution === undefined) return Object.freeze([])
  return Object.freeze([...(resolution.adjustments ?? [])])
}

/**
 * Apply C3 to a declared weight table, producing the DISPLAY surface AC-029:1002
 * asks for — "the displayed weights must show the reallocation".
 *
 * Pure, and independent of the confluence, so a room (or a report) can render
 * the weight table without evaluating six experts. `effectiveWeightSum` on the
 * score is the same arithmetic, computed the same way.
 *
 * @param {ReadonlyArray<{expert: string, weightPct: number}>} declared The
 *   declared table — `EXPERT_WEIGHTS`.
 * @param {object} resolution From `evaluateC3`.
 * @returns {ReadonlyArray<{expert, declaredWeightPct, effectiveWeightPct, adjustedBy, reason}>}
 */
export function effectiveWeightsWith(declared, resolution) {
  if (!Array.isArray(declared)) {
    throw new TypeError(`copilot: effectiveWeightsWith requires the declared table as an array; received ${typeof declared}`)
  }
  const adjustment = resolution?.applied === true ? (resolution.adjustments ?? [])[0] : null
  return Object.freeze(
    declared.map((row) =>
      Object.freeze({
        expert: row.expert,
        declaredWeightPct: row.weightPct,
        effectiveWeightPct: adjustment !== null && adjustment.expert === row.expert ? adjustment.weightPct : row.weightPct,
        adjustedBy: adjustment !== null && adjustment.expert === row.expert ? adjustment.rule : null,
        reason: adjustment !== null && adjustment.expert === row.expert ? adjustment.reason : null
      })
    )
  )
}
