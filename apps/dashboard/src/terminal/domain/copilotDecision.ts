import type {
  ConfluenceScore,
  ExecutionTier,
  ExpertContribution,
  ExpertId,
  VetoOutcome,
  VetoRuleId
} from "../contracts"

/**
 * WS-7 T7 — the deterministic Copilot decision view for the Markets room
 * (COP-22, D1's first room instance).
 *
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT.
 *
 * It is a PURE DERIVATION over the spec §4.3 `ConfluenceScore` / `VetoOutcome` /
 * `ExecutionTier` contracts: given a score the engine produced, work out what
 * the room is allowed to say about it. It performs no I/O, opens no transport,
 * reads no clock of its own, and holds no state.
 *
 * It is NOT the engine. The deterministic engine — regime classifier, six
 * weighted experts, confluence, tiers, six vetoes, four boosters, and the risk
 * layer — is WS-7 T11, and it is not built. Nothing here fabricates a score to
 * stand in for it. `copilotUnavailable()` is the only way to represent the
 * engine's absence, and it produces NO numeric value at all, which is the
 * shape the constitution requires (`availability.ts`: "an unobservable value is
 * `unavailable` with a named reason and an owning workstream… NEVER a zero").
 *
 * It is also NOT the remote explanation. `domain/copilot.ts` holds
 * `CopilotExplanation`, which is remote LLM prose and is never admissible as a
 * signal (`isAdmissibleAsSignal`). Nothing in this module accepts, reads, or
 * forwards a `CopilotExplanation`. Merging the two would let remote prose
 * acquire a score, which AC-014 names as a prohibited side effect.
 *
 * WHY THE INVARIANTS ARE FUNCTIONS AND NOT COMMENTS.
 *
 * AC-023 ("a value between 84 and 85 may not be rounded or interpolated into
 * A+"), AC-024 ("an absent flag must not mean permitted; the default is false"),
 * AC-022 ("a veto may not be absorbed into a lower score") and the "never a
 * fabricated 0" rule are all prohibitions. A prohibition expressed as prose in
 * a component is a prohibition the next author can route around, so each one
 * is a branch in `tierFor` and each branch is table-tested. The order of the
 * branches is load-bearing and is documented on the function.
 */

/**
 * The six experts and their weights, in the spec's order (§4.4). The sum is 100
 * and T11 asserts it; this table is the RENDER side of the same fact, and
 * `EXPERT_WEIGHT_SUM` below re-asserts it so the two cannot drift apart without
 * a test going red.
 */
export const EXPERT_WEIGHTS: ReadonlyArray<{ expert: ExpertId; weightPct: ExpertContribution["weightPct"] }> = [
  { expert: "macroBias", weightPct: 20 },
  { expert: "structural", weightPct: 20 },
  { expert: "trendStrength", weightPct: 20 },
  { expert: "momentumExhaustion", weightPct: 15 },
  { expert: "volatilityBoosters", weightPct: 20 },
  { expert: "sentiment", weightPct: 5 }
]

export const EXPERT_WEIGHT_SUM = EXPERT_WEIGHTS.reduce((n, e) => n + e.weightPct, 0)

/** The six vetoes (§4.4), in the spec's order. Each overrides any score. */
export const VETO_RULE_IDS: readonly VetoRuleId[] = [
  "topDownHierarchy",
  "correlationTrap",
  "wickVsClose",
  "spreadVsTarget",
  "newsLockout",
  "sessionOpen"
] as const

/**
 * The owner of the deterministic engine, named in every honest-unavailability
 * the Markets room shows. It is a WS-7 task, not WS-8, and saying so is the
 * point: a reader must be able to tell "nobody owns this" from "WS-7 T11 owns
 * this and has not run".
 */
export const COPILOT_ENGINE_OWNER = "WS-7 T11"

export type CopilotDecisionView = {
  /** `false` when the engine has produced no reading. Nothing numeric is shown. */
  available: boolean
  score: number | null
  engineVersion: string | null
  computedAt: number | null
  confidence: ConfluenceScore["confidence"] | null
  regime: ConfluenceScore["regime"] | null
  activeBoosters: string[]
  conflictOverrides: ConfluenceScore["conflictOverrides"]
  /** Always all six, in spec order — an honest report shows the missing expert. */
  contributions: ExpertContribution[]
  /** Only the FIRED vetoes. AC-022: an unfired veto is not an outcome. */
  firedVetoes: VetoOutcome[]
  /** Why there is no reading, when there is none. Never null when available is false. */
  unavailableReason: string | null
  /** The tier the score maps to, with every veto and permission applied. */
  tier: ExecutionTier | null
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`confluence: ${field} must be a non-empty string`)
  }
  return value
}

/**
 * AC-023, exactly. `>= 85` is A+, `70..84` is B, anything below 70 is ignore.
 *
 * The comparison is `>=` on 85 and `>=` on 70 with no rounding, no bucketing
 * and no interpolation, because AC-023's prohibited side effect is precisely
 * "a value between 84 and 85 may not be rounded or interpolated into A+". A
 * `Math.round` or a `>= 84.5` here would pass every obvious test and fail that
 * one, so neither appears.
 *
 * `null` — an unscoreable state — maps to `ignore`/`hold`/`0%`, NOT to a score
 * of 0. Zero is a real confluence result meaning "the engine looked and found
 * nothing"; conflating the two is the exact failure the availability contract
 * exists to prevent, and it would also put a fabricated number on the room.
 */
function bandOf(score: number | null): { tier: ExecutionTier["tier"]; riskPct: ExecutionTier["riskPct"] } {
  if (score == null) return { tier: "ignore", riskPct: 0 }
  if (score >= 85) return { tier: "A+", riskPct: 0.01 }
  if (score >= 70) return { tier: "B", riskPct: 0.005 }
  return { tier: "ignore", riskPct: 0 }
}

/**
 * AC-022 + AC-024 + D5 + D6, applied in ONE order that is itself the contract.
 *
 * 1. Start from the score's band.
 * 2. A FIRED VETO forces `hold` and 0% risk, whatever the band said. This is
 *    applied BEFORE the permission check on purpose: a veto is a hard safety
 *    outcome, and letting a broker's `automationPermitted` flag re-enable an
 *    action a veto suppressed would make the veto advisory.
 * 3. `automationPermitted === false` degrades `autoExecute` to
 *    `notifyForApproval` and can never raise the risk percentage. D5's
 *    prohibited side effect is "an absent flag must not mean permitted", so the
 *    check is a positive test for `true`, not a falsy test.
 * 4. `rung` is carried through untouched. D6 makes it a read-only input to the
 *    copilot; a tier function that could move it would let the copilot place
 *    itself on a higher rung.
 */
export function tierFor(
  score: number | null,
  options: {
    vetoes: readonly VetoOutcome[]
    automationPermitted: boolean
    rung: ExecutionTier["rung"]
  }
): ExecutionTier {
  const band = bandOf(score)
  const fired = options.vetoes.filter((v) => v.fired)

  if (fired.length > 0) {
    return {
      tier: band.tier,
      riskPct: 0,
      action: "hold",
      automationPermitted: options.automationPermitted,
      rung: options.rung,
      vetoes: [...options.vetoes]
    }
  }

  const permitted = options.automationPermitted === true
  const action: ExecutionTier["action"] =
    band.tier === "A+" ? (permitted ? "autoExecute" : "notifyForApproval") : band.tier === "B" ? "notifyForApproval" : "hold"

  return {
    tier: band.tier,
    riskPct: band.riskPct,
    action,
    automationPermitted: permitted,
    rung: options.rung,
    vetoes: [...options.vetoes]
  }
}

/**
 * The honest representation of "the deterministic engine has not run".
 *
 * No score, no contributions, no boosters, no tier. The reason names the
 * owner, so the room can say who is building it rather than presenting a gap as
 * a fact about the market.
 */
export function copilotUnavailable(reason: string): CopilotDecisionView {
  return {
    available: false,
    score: null,
    engineVersion: null,
    computedAt: null,
    confidence: null,
    regime: null,
    activeBoosters: [],
    conflictOverrides: [],
    contributions: [],
    firedVetoes: [],
    unavailableReason: text(reason, "unavailableReason"),
    tier: null
  }
}

/**
 * Normalise a `ConfluenceScore` plus its veto records into the room's view.
 *
 * The validations here are the ones a renderer would otherwise have to trust:
 *
 *  - `contributions` is COMPLETED to all six. A producer that omits an expert
 *    is a producer bug, and silently rendering four rows would make a missing
 *    expert look like an absent one. A supplied row for an unknown expert, or
 *    with the wrong weight for its id, is REJECTED rather than corrected: the
 *    weight table is the spec's, and quietly fixing a wrong weight is how a
 *    score stops being auditable.
 *  - an unavailable expert MUST carry a reason. This is the "never a silent
 *    renormalization" rule made executable — the 5% sentiment gap is only
 *    reportable if the room can say what it is.
 *  - a supplied `rawDelta` on an unavailable expert is rejected, because an
 *    unavailable expert contributes nothing and a number beside it would be
 *    read as a contribution.
 */
export function describeConfluence(input: {
  score: ConfluenceScore
  vetoes: readonly VetoOutcome[]
  automationPermitted: boolean
  rung: ExecutionTier["rung"]
}): CopilotDecisionView {
  const s = input.score
  text(s.engineVersion, "engineVersion")
  if (typeof s.computedAt !== "number" || !Number.isFinite(s.computedAt)) {
    throw new TypeError("confluence: computedAt must be a finite number")
  }
  if (s.score !== null && (typeof s.score !== "number" || !Number.isFinite(s.score))) {
    throw new TypeError("confluence: score must be a finite number or null")
  }

  const byExpert = new Map(s.contributions.map((c) => [c.expert, c]))
  const contributions: ExpertContribution[] = EXPERT_WEIGHTS.map((spec) => {
    const found = byExpert.get(spec.expert)
    if (found === undefined) {
      return { expert: spec.expert, weightPct: spec.weightPct, rawDelta: null, available: false, unavailableReason: "not reported by the engine" }
    }
    byExpert.delete(spec.expert)
    if (found.weightPct !== spec.weightPct) {
      throw new TypeError(
        `confluence: expert "${spec.expert}" reported weight ${found.weightPct}, spec weight is ${spec.weightPct}`
      )
    }
    if (found.available === false) {
      if (typeof found.unavailableReason !== "string" || found.unavailableReason.trim().length === 0) {
        throw new TypeError(`confluence: unavailable expert "${spec.expert}" must carry a reason`)
      }
      if (found.rawDelta !== null) {
        throw new TypeError(`confluence: unavailable expert "${spec.expert}" must not carry a rawDelta`)
      }
    }
    return {
      expert: found.expert,
      weightPct: found.weightPct,
      rawDelta: found.available ? found.rawDelta : null,
      available: found.available,
      unavailableReason: found.available ? null : found.unavailableReason
    }
  })

  const unknown = [...byExpert.keys()]
  if (unknown.length > 0) {
    throw new TypeError(`confluence: unknown expert(s) reported: ${unknown.join(", ")}`)
  }

  for (const v of input.vetoes) {
    text(v.ruleId, "vetoes[].ruleId")
    text(v.ruleVersion, "vetoes[].ruleVersion")
    text(v.suppressed, "vetoes[].suppressed")
  }

  return {
    available: true,
    score: s.score,
    engineVersion: s.engineVersion,
    computedAt: s.computedAt,
    confidence: s.confidence,
    regime: s.regime,
    activeBoosters: [...s.activeBoosters],
    conflictOverrides: [...s.conflictOverrides],
    contributions,
    firedVetoes: input.vetoes.filter((v) => v.fired),
    unavailableReason: null,
    tier: tierFor(s.score, {
      vetoes: input.vetoes,
      automationPermitted: input.automationPermitted,
      rung: input.rung
    })
  }
}
