// WS-7 T19 — the extended perf-budget verdict vocabulary, and the pure
// derivation that makes a fabricated pass impossible.
//
// ---------------------------------------------------------------------------
// WHY THE VOCABULARY HAD TO BE EXTENDED
// ---------------------------------------------------------------------------
// AC-044 (:1117-1123) requires every B1-B12 row to carry `pass`, `BREACH`, or
// `UNMEASURED`. Three tokens cannot honestly describe the twelve rows, and spec
// §4.6:739 says so in the spec's own words:
//
//   "B2's ratified-but-not-directly-measured state is neither `pass` (there is
//    no ARM room-transition sample) nor `UNMEASURED` (the budget is now set,
//    which is no longer an open question). T19 must extend the manifest's
//    accepted verdict vocabulary to represent it explicitly rather than forcing
//    the row into a misleading token."
//
// So the vocabulary is extended here, and — the part that matters more — every
// non-`pass` token is a DISTINCT state rather than a flavour of `pass`.
//
// ---------------------------------------------------------------------------
// THE PROPERTY THAT MATTERS: THE VERDICT IS RE-DERIVABLE
// ---------------------------------------------------------------------------
// `verdictForRow` is a pure function of a row's OWN recorded numbers. It is not
// told what the verdict is; it recomputes it. Concretely:
//
//   * A row that carries raw samples has its p95 recomputed from those samples
//     and compared to its own budget. A `pass` whose own p95 is over budget
//     cannot survive this.
//   * A row with no samples and no defensible budget CANNOT produce `pass`.
//     `verdictForRow` has no code path that returns `pass` without a measured
//     number to compare against a budget.
//   * A row whose budget was withdrawn has no budget to compare against, so it
//     cannot reach `pass` at all.
//
// This mirrors the discipline in
// `apps/dashboard/server/services/copilot/__tests__/perfArtifact.test.mjs:120-136`
// — "the verdict is re-derivable from the raw samples by an independent
// nearest-rank, so a fabricated pass fails" — extended from two rows to twelve
// and from two tokens to seven.

/**
 * The vocabulary. `satisfiesBudget` is the ONLY property the reporting layer is
 * allowed to key on, and it is true for exactly one token. Everything else is a
 * distinct honest state.
 */
export const VERDICTS = Object.freeze({
  pass: {
    satisfiesBudget: true,
    measured: true,
    description:
      "A raw sample exists, the percentile was recomputed from it, and the figure is within budget."
  },
  BREACH: {
    satisfiesBudget: false,
    measured: true,
    description: "A raw sample exists and the recomputed percentile is over budget. Never to be dropped."
  },
  UNMEASURED: {
    satisfiesBudget: false,
    measured: false,
    description:
      "A budget is set and no measurement path produces a sample yet. Not a pass; an open question."
  },
  RATIFIED_UNMEASURED: {
    satisfiesBudget: false,
    measured: false,
    description:
      "The budget was ratified by an owner decision but no sample was ever taken against it. " +
      "Distinct from UNMEASURED (the decision is made) and from pass (nothing was measured). " +
      "This is the ORIGINAL D21 state for B2 and is retained as a reachable, defined state."
  },
  WITHDRAWN_UNMEASURED: {
    satisfiesBudget: false,
    measured: false,
    description:
      "A budget was ratified and then WITHDRAWN as resting on an invalid derivation, and NO " +
      "substitute was adopted. There is no figure to compare a sample against. This is B2's " +
      "actual state under the D21 supersession (spec :277-308, :723)."
  },
  UNVERIFIED: {
    satisfiesBudget: false,
    measured: false,
    description:
      "A figure exists — vendor-reported or owner-relayed — but has not been independently " +
      "reproduced. Recorded verbatim with its provenance; never restated as measured."
  },
  PARTIAL_VERIFICATION: {
    satisfiesBudget: false,
    measured: false,
    description:
      "A row carrying more than one separable claim, where some were independently corroborated " +
      "and others were contradicted or not reproduced. One token for the whole row would be a lie " +
      "in whichever direction it picked; the crossChecks block says which half is which."
  }
})

/** Every accepted token. Anything else is a schema error, not a verdict. */
export const VERDICT_VOCABULARY = Object.freeze(Object.keys(VERDICTS))

/** The only token that may be reported as satisfying a budget. */
export const PASS_LIKE = Object.freeze(
  VERDICT_VOCABULARY.filter((v) => VERDICTS[v].satisfiesBudget)
)

/**
 * Nearest-rank percentile — no interpolation, so a p95 is a real observed
 * sample. Deliberately a DIFFERENT implementation from the harness's own
 * `sorted[floor(p*n)]`, so the guard test comparing the two catches a wrong
 * percentile helper rather than agreeing with its own bug.
 */
export function nearestRank(samples, p) {
  if (!Array.isArray(samples) || samples.length === 0) return null
  const sorted = [...samples].filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return sorted[Math.ceil((p / 100) * sorted.length) - 1]
}

/**
 * The quantity a row is judged on, taken from the row's own samples.
 *
 * `aggregation: "peak"` rows (B10's peak RSS) are decided by the MAXIMUM of
 * their series. Everything else is decided by a percentile. Getting this wrong
 * would let a p95 hide a breach, so it is stated per row rather than assumed.
 */
export function observedFor(row) {
  const samples = Array.isArray(row.rawSamplesMs) ? row.rawSamplesMs : null
  if (!samples || samples.length === 0) return null
  const usable = samples.filter((v) => typeof v === "number" && Number.isFinite(v))
  if (usable.length === 0) return null
  if (row.aggregation === "peak") return Math.max(...usable)
  const p = typeof row.percentile === "number" ? row.percentile : 95
  return nearestRank(usable, p)
}

/**
 * THE DERIVATION. Recomputes a row's verdict from the row's own numbers.
 *
 * Order matters and is deliberate:
 *   1. A row with a WITHDRAWN budget has nothing to compare against, so it can
 *      never pass. Checked FIRST, before any sample arithmetic.
 *   2. A row with raw samples and a numeric budget is decided by those samples.
 *   3. A row declaring separable verification claims is decided by them: some
 *      corroborated is PARTIAL_VERIFICATION, none corroborated is UNVERIFIED.
 *   4. A row naming a source whose figure was never reproduced is UNVERIFIED.
 *   5. A row CARRYING a breach asserted by an earlier authority is BREACH.
 *      This is the one path that yields BREACH without samples, and it is
 *      deliberately one-directional: it can only ever produce a CONSERVATIVE
 *      verdict. It can never manufacture a pass, so it cannot be used to launder
 *      an unmeasured row into a satisfied one.
 *   6. A row ratified by decision but never sampled is RATIFIED_UNMEASURED.
 *   7. Otherwise: unmeasured, which is never a pass.
 *
 * There is deliberately NO branch that returns `pass` without comparing a
 * measured quantity against a numeric budget. That single property is what makes
 * a fabricated pass impossible.
 */
export function verdictForRow(row) {
  if (!row || typeof row !== "object") return "UNMEASURED"

  // 1. Withdrawn budget. No figure exists, so no comparison is possible.
  if (row.budgetStatus === "WITHDRAWN") return "WITHDRAWN_UNMEASURED"

  // 2. Measured against a numeric budget.
  const budget = row.budgetMs
  if (typeof budget === "number" && Number.isFinite(budget)) {
    const observed = observedFor(row)
    if (observed !== null) return observed <= budget ? "pass" : "BREACH"
  }

  // 3. Separable verification claims (B12's shape). Only booleans under an
  //    explicit `verificationClaims` map count, so a provenance note like
  //    "ownerRelayedRetainedVerbatim" cannot be mistaken for a corroboration.
  if (row.verificationClaims && typeof row.verificationClaims === "object") {
    const values = Object.values(row.verificationClaims).filter((v) => typeof v === "boolean")
    if (values.length > 0) return values.some(Boolean) ? "PARTIAL_VERIFICATION" : "UNVERIFIED"
  }

  // 4. A figure that exists but was never reproduced (vendor-reported, B11).
  if (typeof row.unverifiedSource === "string" && row.unverifiedSource.length > 0) return "UNVERIFIED"

  // 5. A breach carried forward from an earlier authority, with its citation.
  //    Conservative by construction — see the note above.
  if (typeof row.carriedBreachFrom === "string" && row.carriedBreachFrom.length > 0) return "BREACH"

  // 6. Ratified by decision, never sampled.
  if (row.ratified === true) return "RATIFIED_UNMEASURED"

  return "UNMEASURED"
}

/**
 * Fail loudly on a row that claims `pass` without the numbers to support it.
 * Used by the guard test; kept here so the rule lives beside the derivation.
 */
export function fabricationFindings(rows) {
  const findings = []
  for (const row of rows) {
    const derived = verdictForRow(row)
    if (row.verdict !== derived) {
      findings.push(`${row.id}: records "${row.verdict}" but its own numbers derive "${derived}"`)
    }
    if (row.verdict === "pass" && !PASS_LIKE.includes(row.verdict)) {
      findings.push(`${row.id}: "pass" is not in the satisfying set`)
    }
    if (row.verdict === "pass" && observedFor(row) === null) {
      findings.push(`${row.id}: claims "pass" with no usable raw samples`)
    }
    if (row.verdict === "pass" && typeof row.budgetMs !== "number") {
      findings.push(`${row.id}: claims "pass" with no numeric budget to have passed against`)
    }
    // A carried breach must name its citation, or it is an unsourced assertion.
    if (row.verdict === "BREACH" && observedFor(row) === null && typeof row.carriedBreachFrom !== "string") {
      findings.push(`${row.id}: records "BREACH" with no samples and no carriedBreachFrom citation`)
    }
  }
  return findings
}