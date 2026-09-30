// WS-7 T12 — the composition seam: all three conflict resolutions, in one call,
// with the precedence between them settled by `precedence.mjs`.
//
// Spec §4.3:619 puts `conflictOverrides` on the `ConfluenceScore`, and T12's
// bisect line (:1307) requires that "a conflict between them … is resolved by an
// explicit precedence recorded in `conflictOverrides`, not by ordering luck".
//
// ---------------------------------------------------------------------------
// WHAT RETURNS, AND WHERE THE LOSERS GO
// ---------------------------------------------------------------------------
//
//   `conflictOverrides`  §4.3:619's exact shape — `Array<"C1"|"C2"|"C3">`, the
//                        APPLIED rules only, strings only. Never an object, never
//                        a superseded rule, never a reason string in this field.
//   `resolutions`         EVERY rule, always, in the order C1, C2, C3 — applied,
//                        superseded, notTriggered, disabled, unavailable,
//                        notHypertrend. This is where a loser lives: `status:
//                        "superseded"`, `supersededBy`, `supersededReason`, and
//                        `supersededAdjustments` holding the adjustment it would
//                        have made.
//
// The split is deliberate. A caller that only needs to know "was anything
// applied" reads the spec's field and finds nothing new. A caller that needs to
// know why gets the whole story, INCLUDING the losing rule. Collapsing the two —
// putting objects into `conflictOverrides`, or dropping superseded rules from
// `resolutions` — would either break the spec's type or make the loss silent.
//
// ---------------------------------------------------------------------------
// WHY THE IDS ARE BUILT HERE, AND WHY THEY ARE ALSO DECLARED IN `confluence.mjs`
// ---------------------------------------------------------------------------
//
// §4.4's enumeration order and §4.3:619's union are BOTH `["C1","C2","C3"]`, and
// this array is built from the three rules' own `id` fields — so it cannot drift
// from them. `confluence.mjs` declares the same three literals, because it must
// validate `context.conflictOverrides` and importing this layer would invert the
// dependency (the confluence is the thing the conflict layer adjusts). That is
// safe only while the import does not exist, so a test asserts the import is
// absent and the declaration is present. If either ever changes, the two become
// one and the second declaration becomes dead code — which the same test would
// catch.

import { C1_RULE, evaluateC1, observeDualBooster, observeTrend } from "./c1AdxLagging.mjs"
import { C2_RULE, c2Adjustments, evaluateC2 } from "./c2TwoTierStop.mjs"
import { C3_RULE, evaluateC3 } from "./c3HypertrendMacro.mjs"
import { CONFLICT_PRECEDENCE, PRECEDENCE_VERSION, resolvePrecedence } from "./precedence.mjs"

/** §4.3:619's union, in §4.4's order, read from the rules. Frozen. */
export const CONFLICT_RULE_IDS = Object.freeze([C1_RULE.id, C2_RULE.id, C3_RULE.id])

/** What a caller gets when it supplies nothing at all. */
const ALL_ENABLED = Object.freeze({ C1: true, C2: true, C3: true })

/**
 * Evaluate all three conflict resolutions against one derived market state and
 * settle their precedence.
 *
 * Each rule is evaluated INDEPENDENTLY and with only its own inputs, so:
 *   - disabling one cannot affect another;
 *   - a rule that is not enabled is still reported, with `status: "disabled"`;
 *   - a rule that throws throws LOUDLY rather than being dropped — a swallowed
 *     error here would return a plausible score with a conflict silently absent,
 *     which is the one failure mode this whole task exists to prevent.
 *
 * The one shared input is the market state, which is not a conflict between
 * rules; it is the market.
 *
 * @param {object} state A frozen state from `deriveMarketState`.
 * @param {object} [options]
 * @param {{C1?: boolean, C2?: boolean, C3?: boolean}} [options.enabled]
 *   Per-rule switches. Absent means enabled; `false` disables.
 * @param {object} [options.c1] `{ observation, trend, window }` for C1. Omit and
 *   the observation is made here from `state`; omit `window` and C1 opens nothing
 *   (a missing window is not an open one).
 * @param {object} [options.c2] `{ direction, entryPrice }` for C2.
 *   C3 takes NO options — its condition is `regime == hypertrend` and nothing
 *   else, so a `c3` key here would be a parameter that does nothing.
 * @returns {Readonly<object>} `{ conflictOverrides, adjustments, resolutions,
 *   precedence, precedenceVersion }`
 */
export function evaluateConflicts(state, options = {}) {
  if (state === null || typeof state !== "object" || !Array.isArray(state.candles)) {
    throw new TypeError("copilot: evaluateConflicts requires a derived market state with candles")
  }
  const enabled = { ...ALL_ENABLED, ...(options.enabled ?? {}) }

  // --- C1 -------------------------------------------------------------------
  // The observation is made HERE from the state unless the caller supplied one,
  // so a caller that already has it does not pay for it twice, and a caller that
  // does not have to know nothing about how boosters are detected.
  const c1Observation = options.c1?.observation ?? observeDualBooster(state)
  const c1Trend = options.c1?.trend ?? observeTrend(state)
  const c1 = evaluateC1({
    observation: c1Observation,
    trend: c1Trend,
    window: options.c1?.window ?? null,
    enabled: enabled.C1 !== false
  })

  // --- C2 -------------------------------------------------------------------
  const c2 = evaluateC2({
    state,
    direction: options.c2?.direction,
    entryPrice: options.c2?.entryPrice ?? null,
    enabled: enabled.C2 !== false
  })

  // --- C3 -------------------------------------------------------------------
  const c3 = evaluateC3({ state, enabled: enabled.C3 !== false })
  // --- precedence -----------------------------------------------------------
  // C2 is not a resolution of the same KIND as C1 and C3 — it makes no
  // adjustment — so it is presented to the resolver as a rule that wants to
  // apply when it is STOPPING. `c2Adjustments` is `[]` by construction, so
  // whether C2 wins or loses cannot change the score; it decides only what the
  // RECORD says, which is precisely the "reported as superseded rather than
  // silently dropped" half of :1307.
  const settled = resolvePrecedence([c1, c2AsCandidate(c2), c3])

  const resolutions = Object.freeze([...settled.all])
  const adjustments = Object.freeze(
    resolutions.filter((r) => r.applied === true).flatMap((r) => [...(r.adjustments ?? [])])
  )
  const conflictOverrides = Object.freeze(settled.winners.filter((id) => CONFLICT_RULE_IDS.includes(id)))

  return Object.freeze({
    conflictOverrides,
    adjustments,
    resolutions,
    precedence: CONFLICT_PRECEDENCE,
    precedenceVersion: PRECEDENCE_VERSION
  })
}

/**
 * Present a C2 stop reading to the precedence resolver.
 *
 * C2's own vocabulary is `verdict` / `hardStop` / `softAlert`; the resolver's is
 * `applied`. The mapping is `hardStop === true` and nothing else — an ALERT is
 * not a position-safety fact, and letting a soft alert win a precedence contest
 * would put an advisory ahead of a score for no reason a reader could defend.
 *
 * Exported so a caller (and a test) constructs the candidate the same way the
 * seam does, rather than restating the mapping.
 *
 * @param {object} c2 From `evaluateC2`.
 * @returns {object} The candidate.
 */
export function c2AsCandidate(c2) {
  return {
    ...c2,
    applied: c2?.hardStop === true,
    adjustments: c2Adjustments(c2)
  }
}

export { CONFLICT_PRECEDENCE, PRECEDENCE_VERSION, resolvePrecedence }
