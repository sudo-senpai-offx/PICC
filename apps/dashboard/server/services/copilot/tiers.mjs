// WS-7 T11 — the execution tier, AUTHORITATIVE for `ExecutionTier`.
//
// Spec §4.4:689: "Execution tiers: `>85 = A+` (risk 1%) · `70–84 = B` (notify
// for approval, risk 0.5%) · `<70 = ignore` (stay in cash). There is no fourth
// band and no interpolation between 84 and 85."
//
// AC-023:952, which is the acceptance criterion and therefore wins over the
// prose above where they differ, states "85+ → A+". The two differ at exactly
// one input — a score of exactly 85 — and AC-023's scenario at :950 includes 85
// among the cases to map, with 85+ expected to be A+. So the boundary is
// `>= 85`, and `> 85` in §4.4:689 is treated as the loose phrasing it is. See
// the T11 report; this is a spec-internal contradiction, resolved in favour of
// the acceptance criterion, which is the binding one.
//
// Plan v1 §2 (Risk 6): this server copy authorises execution. The client
// `bandOf`/`tierFor` at `src/terminal/domain/copilotDecision.ts:122-127,145-179`
// is a rendering projection of it. `__tests__/tierBoundaryParity.test.mjs`
// proves the two agree, so a second copy of a safety boundary cannot drift.

import { APLUS_MIN_SCORE, B_MIN_SCORE } from "./tierBoundaryFixture.mjs"

/**
 * The score → band map. EXACT, UNROUNDED.
 *
 * @param {number | null} score 0-100, or `null` when unscoreable.
 * @returns {{tier: "A+"|"B"|"ignore", riskPct: 0.01|0.005|0}}
 */
export function bandOf(score) {
  if (score === null) return { tier: "ignore", riskPct: 0 }
  assertFiniteScore(score)
  if (score >= APLUS_MIN_SCORE) return { tier: "A+", riskPct: 0.01 }
  if (score >= B_MIN_SCORE) return { tier: "B", riskPct: 0.005 }
  return { tier: "ignore", riskPct: 0 }
}

/**
 * The authoritative tier decision.
 *
 * THE ORDER OF THE TWO BRANCHES IS THE CONTRACT, and it is: VETO FIRST,
 * PERMISSION SECOND. D7 makes a veto a first-class inspectable safety outcome,
 * not an advisory input to a score. If the permission check ran first and a
 * broker happened to hold `automationPermitted: true`, the veto would be
 * downgraded from `hold` to `autoExecute` — the veto would still be in the
 * record, and it would still have decided nothing. A veto that can be
 * re-enabled by a flag is a comment.
 *
 * `__tests__/tierOrdering.test.mjs` proves this is load-bearing by running the
 * permission-first order and showing it produces a different, wrong answer.
 *
 * @param {number | null} score
 * @param {{vetoes: readonly object[], automationPermitted: boolean,
 *          rung: "paper"|"demo"|"live"}} options
 * @returns {{tier: string, riskPct: number, action: string,
 *            automationPermitted: boolean, rung: string, vetoes: object[]}}
 */
export function tierFor(score, options) {
  const band = bandOf(score)
  const vetoes = [...(options.vetoes ?? [])]
  const fired = vetoes.filter((v) => v.fired === true)

  // Branch 1 — D7 / AC-022. A fired veto is `hold` and 0% risk whatever the
  // band said, and regardless of any permission the broker carries.
  if (fired.length > 0) {
    return {
      tier: band.tier,
      riskPct: 0,
      action: "hold",
      // Reported as given, never upgraded. Reporting `true` here would be a
      // claim about what the flag means for this decision, and it means
      // nothing at all while a veto is holding.
      automationPermitted: options.automationPermitted === true,
      rung: options.rung,
      vetoes
    }
  }

  // Branch 2 — D5. Positively `=== true`, never a falsy test: D5's prohibited
  // side effect (AC-024:961) is "an absent flag must not mean permitted".
  const permitted = options.automationPermitted === true

  // Branch 3 — D6. `rung` is carried through untouched and has no branch that
  // could change it. AC-025:969 makes the ladder immutable to the Copilot, and
  // the absence of any rung-writing branch is the whole implementation of that.
  const action =
    band.tier === "A+"
      ? permitted
        ? "autoExecute"
        : "notifyForApproval"
      : band.tier === "B"
        ? "notifyForApproval"
        : "hold"

  return {
    tier: band.tier,
    riskPct: band.riskPct,
    action,
    automationPermitted: permitted,
    rung: options.rung,
    vetoes
  }
}

/**
 * Reject a score the engine should never have produced, loudly.
 *
 * AC-021's determinism guarantee is worthless if a `NaN` or `undefined` score
 * silently became `ignore` by falling through `>=`. The previous line's
 * `score === null` is the ONLY absent value admitted, and it is admitted on
 * purpose: `null` is the spec's named "unscoreable" (contracts.ts:188-190),
 * while `undefined` and `NaN` are bugs.
 */
function assertFiniteScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new TypeError(
      `copilot: tierFor requires a finite score or an explicit null (unscoreable); received ${String(score)}`
    )
  }
  if (score < 0 || score > 100) {
    throw new RangeError(`copilot: score must be within 0-100; received ${score}`)
  }
}
